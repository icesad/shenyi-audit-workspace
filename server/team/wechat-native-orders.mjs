import {constants, createHash, createPrivateKey, randomBytes, sign} from 'node:crypto';
import {isIP} from 'node:net';
import {ApiError, ID} from './http-utils.mjs';
import {MERCHANT_REFUND_ID} from './wechat-native-trade-bill-parser.mjs';
import {
  APP_ID, MERCHANT_ID, MERCHANT_ORDER_ID, TRANSACTION_ID, MAX_AMOUNT_MINOR, SIGNATURE_TYPE, SIGNATURE_TOLERANCE_MS,
  REQUEST_TIMEOUT_MS, MIN_PAYMENT_WINDOW_MS, MAX_PAYMENT_WINDOW_MS, MAX_PAYMENT_TIME,
  boundedInteger, createWechatSignatureVerifier, isRsa2048Key, matches, paidOnOrAfterCreation,
  parsePaymentTime, parseWechatRecord, record,
} from './wechat-native-protocol.mjs';

const API_ORIGIN = 'https://api.mch.weixin.qq.com';
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_BILL_BYTES = 32 * 1024 * 1024;
const NATIVE_STATES = new Set(['NOTPAY', 'CLOSED', 'REFUND', 'SUCCESS']);
const REFUND_STATES = new Set(['SUCCESS', 'CLOSED', 'PROCESSING', 'ABNORMAL']);

const invalidOrder = () => { throw new ApiError(400, 'WECHAT_NATIVE_LOCK_INVALID', '微信支付订单资料或付款期限无效。'); };
const invalidRefund = () => { throw new ApiError(400, 'WECHAT_NATIVE_REFUND_LOOKUP_INVALID', '无法核对微信支付退款标识、金额或时间。'); };
const providerUnavailable = () => { throw new ApiError(502, 'WECHAT_NATIVE_PROVIDER_UNAVAILABLE', '暂时无法核实微信支付订单状态。'); };

export function isWechatNativeNotifyUrl(value) {
  if (typeof value !== 'string' || value.length > 255) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !isIP(url.hostname) && url.hostname.includes('.') &&
      url.hostname.split('.').every(label => matches(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, label)) &&
      value === url.origin + url.pathname;
  } catch {
    return false;
  }
}

function isPaymentCodeUrl(value) {
  if (typeof value !== 'string' || value.length > 64) return false;
  if (!matches(/^weixin:\/\/(?:wxpay|pay\.weixin\.qq\.com)\/bizpayurl(?:\/[A-Za-z0-9_-]+)?\?[A-Za-z0-9._~%=&+-]+$/, value)) return false;
  const references = new URL(value).searchParams.getAll('pr');
  return references.length === 1 && references[0].length > 0;
}

function billDownloadPath(downloadUrl) {
  if (typeof downloadUrl !== 'string' || downloadUrl.length > 2048 || !downloadUrl.startsWith(API_ORIGIN)) providerUnavailable();
  const path = downloadUrl.slice(API_ORIGIN.length);
  const match = /^\/(?:v3\/bill\/downloadurl|v3\/billdownload\/file)\?token=((?:[A-Za-z0-9._~+/=-]|%[0-9A-Fa-f]{2})+)$/.exec(path);
  if (!match || match[0] !== path) providerUnavailable();
  try {
    if (matches(/^[A-Za-z0-9._~+/=-]+$/, decodeURIComponent(match[1]))) return path;
  } catch {
    // The opaque token is signed exactly as issued, but must be a single safe query value.
  }
  providerUnavailable();
}

function requireBillDate(billDate) {
  if (matches(/^\d{4}-\d{2}-\d{2}$/, billDate)) {
    const date = new Date(`${billDate}T00:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === billDate) return;
  }
  throw new ApiError(400, 'WECHAT_NATIVE_BILL_DATE_INVALID', '请核对微信支付账单日期。');
}

async function readResponseBytes(response, signal, maximum = MAX_RESPONSE_BYTES) {
  const declaredLength = response.headers.get('Content-Length');
  if (!response.body || (declaredLength !== null &&
      (!matches(/^\d+$/, declaredLength) || Number(declaredLength) > maximum))) {
    void response.body?.cancel().catch(() => {});
    providerUnavailable();
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, {once: true});
  const chunks = [];
  let length = 0, complete = false;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (signal.aborted) providerUnavailable();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) providerUnavailable();
      chunks.push(value);
    }
    complete = true;
    return Buffer.concat(chunks, length);
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}

export function createWechatNativeOrders({
  appId, merchantId, certificateSerial, merchantPrivateKey, keys, notifyUrl, fetchImpl = globalThis.fetch, now = Date.now,
}) {
  if (!matches(APP_ID, appId) || !matches(MERCHANT_ID, merchantId) || !matches(/^[A-Fa-f0-9]{1,64}$/, certificateSerial) ||
      !isWechatNativeNotifyUrl(notifyUrl) || typeof fetchImpl !== 'function' || typeof now !== 'function') {
    throw new TypeError('Invalid WeChat Pay order configuration');
  }
  const privateKey = typeof merchantPrivateKey === 'string' ? createPrivateKey(merchantPrivateKey) : merchantPrivateKey;
  if (!isRsa2048Key(privateKey, 'private')) throw new TypeError('Expected a 2048-bit WeChat Pay merchant RSA private key');
  const verifySignature = createWechatSignatureVerifier(keys);
  const preferredPublicKeyId = keys[0].id;

  function readLockedOrder(order, at) {
    if (!order || !boundedInteger(at, 0, MAX_PAYMENT_TIME)) invalidOrder();
    const {id, appId: orderAppId, merchantId: orderMerchantId, merchantOrderId, amountMinor, currency, createdAt} = order;
    if (!matches(ID, id) || orderAppId !== appId || orderMerchantId !== merchantId ||
        !matches(MERCHANT_ORDER_ID, merchantOrderId) || !boundedInteger(amountMinor, 1, MAX_AMOUNT_MINOR) ||
        currency !== 'CNY' || !boundedInteger(createdAt, 0, at)) invalidOrder();
    return {id, merchantOrderId, amountMinor, currency, createdAt};
  }

  async function request(method, path, at, body, {emptyResponse = false, allowMissingOrder = false, fileSha1} = {}) {
    const timestamp = Math.floor(at / 1000);
    const nonce = randomBytes(16).toString('hex');
    const canonical = Buffer.from(`${method}\n${path}\n${timestamp}\n${nonce}\n${body ?? ''}\n`);
    const signature = sign('sha256', canonical, {key: privateKey, padding: constants.RSA_PKCS1_PADDING}).toString('base64');
    const headers = {
      Accept: fileSha1 === undefined ? 'application/json' : '*/*',
      Authorization: `${SIGNATURE_TYPE} mchid="${merchantId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${certificateSerial}"`,
      'Wechatpay-Serial': preferredPublicKeyId,
      ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
      ...(fileSha1 !== undefined ? {'Accept-Encoding': 'identity'} : {}),
    };
    const url = API_ORIGIN + path;
    const controller = new AbortController();
    const signal = controller.signal;
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('WeChat Pay request timed out'));
      }, REQUEST_TIMEOUT_MS);
    });
    const read = async () => {
      const response = await fetchImpl(url, {method, body, headers, signal, redirect: 'error', cache: 'no-store',
        credentials: 'omit', referrerPolicy: 'no-referrer'});
      const mayBeMissingOrder = allowMissingOrder && response.status === 404;
      const expectedStatus = emptyResponse ? 204 : 200;
      if (signal.aborted || response.redirected || (response.url && response.url !== url) ||
          (response.status !== expectedStatus && !mayBeMissingOrder)) {
        void response.body?.cancel().catch(() => {});
        providerUnavailable();
      }
      if (emptyResponse) {
        const length = response.headers.get('Content-Length');
        if (response.body || (length !== null && length !== '0')) {
          void response.body?.cancel().catch(() => {});
          providerUnavailable();
        }
      }
      const bytes = emptyResponse ? Buffer.alloc(0) :
        await readResponseBytes(response, signal, fileSha1 === undefined ? MAX_RESPONSE_BYTES : MAX_BILL_BYTES);
      if (fileSha1 !== undefined) {
        // WeChat signs the descriptor. The download itself is authenticated by that descriptor's digest.
        if (!bytes.length || createHash('sha1').update(bytes).digest('hex') !== fileSha1) providerUnavailable();
        return bytes;
      }
      const receivedAt = now();
      const signedAt = verifySignature(response.headers, bytes, receivedAt);
      if (signedAt === null) providerUnavailable();
      if (emptyResponse) return;
      const data = parseWechatRecord(bytes);
      if (!data || (mayBeMissingOrder && data.code !== 'ORDER_NOT_EXIST')) providerUnavailable();
      return {data, missing: mayBeMissingOrder, receivedAt, signedAt};
    };
    try {
      return await Promise.race([read(), deadline]);
    } catch {
      providerUnavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    async createOrder(order) {
      const at = now();
      const {merchantOrderId, amountMinor, currency} = readLockedOrder(order, at);
      const {expiresAt, description} = order;
      if (!boundedInteger(expiresAt, at + MIN_PAYMENT_WINDOW_MS, Math.min(at + MAX_PAYMENT_WINDOW_MS, MAX_PAYMENT_TIME)) ||
          expiresAt % 1000 !== 0 || typeof description !== 'string' || !description.trim() ||
          Array.from(description).length > 127 || /[\x00-\x1f\x7f]/.test(description)) invalidOrder();
      const body = JSON.stringify({
        appid: appId, mchid: merchantId, description, out_trade_no: merchantOrderId, notify_url: notifyUrl,
        time_expire: new Date(expiresAt).toISOString().replace('.000Z', 'Z'), amount: {total: amountMinor, currency},
      });
      const {data} = await request('POST', '/v3/pay/transactions/native', at, body);
      if (!isPaymentCodeUrl(data.code_url)) providerUnavailable();
      return Object.freeze({merchantOrderId, codeUrl: data.code_url});
    },

    async closeOrder(order) {
      const at = now();
      const {merchantOrderId, createdAt} = readLockedOrder(order, at);
      const {expiresAt} = order;
      if (!boundedInteger(expiresAt, createdAt + 1, at) || expiresAt % 1000 !== 0) invalidOrder();
      const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrderId)}/close`;
      await request('POST', path, at, JSON.stringify({mchid: merchantId}), {emptyResponse: true});
      return Object.freeze({merchantOrderId, acknowledged: true});
    },

    async queryOrder(order) {
      const at = now();
      const locked = readLockedOrder(order, at);
      const {merchantOrderId} = locked;
      const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrderId)}?mchid=${merchantId}`;
      const {data, missing, receivedAt, signedAt} = await request('GET', path, at, undefined, {allowMissingOrder: true});
      if (missing) return Object.freeze({merchantOrderId, state: 'NOT_FOUND'});
      const state = data.trade_state;
      if (data.appid !== appId || data.mchid !== merchantId || data.out_trade_no !== merchantOrderId ||
          !NATIVE_STATES.has(state) || (data.trade_type !== undefined && data.trade_type !== 'NATIVE')) providerUnavailable();
      if (state !== 'SUCCESS') return Object.freeze({merchantOrderId, state});

      const paidAt = parsePaymentTime(data.success_time);
      const amount = data.amount;
      if (data.trade_type !== 'NATIVE' || !matches(TRANSACTION_ID, data.transaction_id) || paidAt === null ||
          !paidOnOrAfterCreation(paidAt, locked.createdAt) || paidAt > Math.min(receivedAt, signedAt) + SIGNATURE_TOLERANCE_MS ||
          !record(amount) || amount.total !== locked.amountMinor || amount.currency !== locked.currency ||
          (amount.payer_total !== undefined && !boundedInteger(amount.payer_total, 0, amount.total)) ||
          (amount.payer_currency !== undefined && amount.payer_currency !== locked.currency)) providerUnavailable();
      return Object.freeze({channel: 'wechat-pay-native-v3', orderId: locked.id, merchantOrderId,
        transactionId: data.transaction_id, appId, merchantId, amountMinor: locked.amountMinor, currency: locked.currency, paidAt, state});
    },

    async queryRefund(expected) {
      const at = now();
      if (!record(expected) || !boundedInteger(at, 0, MAX_PAYMENT_TIME)) invalidRefund();
      const {merchantRefundId, refundId, merchantOrderId, transactionId, amountMinor, refundAmountMinor, currency,
        refundCreatedAt} = expected;
      if (!matches(MERCHANT_REFUND_ID, merchantRefundId) || merchantRefundId === '0' ||
          !matches(TRANSACTION_ID, refundId) || refundId === '0' || !matches(MERCHANT_ORDER_ID, merchantOrderId) ||
          !matches(TRANSACTION_ID, transactionId) || transactionId === '0' ||
          !boundedInteger(amountMinor, 1, MAX_AMOUNT_MINOR) || !boundedInteger(refundAmountMinor, 1, amountMinor) ||
          currency !== 'CNY' || !boundedInteger(refundCreatedAt, 0, at) || refundCreatedAt % 1000 !== 0) invalidRefund();

      const path = '/v3/refund/domestic/refunds/' + encodeURIComponent(merchantRefundId);
      const {data, receivedAt, signedAt} = await request('GET', path, at);
      const {status, amount} = data;
      const createdAt = parsePaymentTime(data.create_time);
      const succeededAt = status === 'SUCCESS' ? parsePaymentTime(data.success_time) : null;
      const latestProviderTime = Math.min(receivedAt, signedAt) + SIGNATURE_TOLERANCE_MS;
      if (data.out_refund_no !== merchantRefundId || data.refund_id !== refundId ||
          data.out_trade_no !== merchantOrderId || data.transaction_id !== transactionId || !REFUND_STATES.has(status) ||
          !record(amount) || amount.total !== amountMinor || amount.refund !== refundAmountMinor || amount.currency !== currency ||
          !boundedInteger(receivedAt, 0, MAX_PAYMENT_TIME) || createdAt === null ||
          Math.floor(createdAt / 1000) * 1000 !== refundCreatedAt || createdAt > latestProviderTime ||
          (status === 'SUCCESS' && (succeededAt === null || succeededAt < createdAt ||
            succeededAt > latestProviderTime || succeededAt > MAX_PAYMENT_TIME))) providerUnavailable();
      return Object.freeze({status, createdAt, succeededAt, verifiedAt: receivedAt});
    },

    async downloadTradeBill(billDate) {
      requireBillDate(billDate);
      const at = now();
      if (!boundedInteger(at, 0, MAX_PAYMENT_TIME)) providerUnavailable();
      const {data} = await request('GET', `/v3/bill/tradebill?bill_date=${billDate}&bill_type=ALL`, at);
      if (data.hash_type !== 'SHA1' || !matches(/^[0-9a-fA-F]{40}$/, data.hash_value)) providerUnavailable();
      const path = billDownloadPath(data.download_url);
      const sha1 = data.hash_value.toLowerCase();
      const downloadAt = now();
      if (!boundedInteger(downloadAt, at, MAX_PAYMENT_TIME)) providerUnavailable();
      const bytes = await request('GET', path, downloadAt, undefined, {fileSha1: sha1});
      return Object.freeze({billDate, bytes, sha1});
    },
  });
}
