import {constants, createPrivateKey, randomBytes, sign} from 'node:crypto';
import {isIP} from 'node:net';
import {ApiError, ID} from './http-utils.mjs';
import {
  APP_ID, MERCHANT_ID, MERCHANT_ORDER_ID, TRANSACTION_ID, MAX_AMOUNT_MINOR, SIGNATURE_TYPE, SIGNATURE_TOLERANCE_MS,
  REQUEST_TIMEOUT_MS, MIN_PAYMENT_WINDOW_MS, MAX_PAYMENT_WINDOW_MS, MAX_PAYMENT_TIME,
  boundedInteger, createWechatSignatureVerifier, isRsa2048Key, matches, paidOnOrAfterCreation,
  parsePaymentTime, parseWechatRecord, record,
} from './wechat-native-protocol.mjs';

const API_ORIGIN = 'https://api.mch.weixin.qq.com';
const MAX_RESPONSE_BYTES = 256 * 1024;
const NATIVE_STATES = new Set(['NOTPAY', 'CLOSED', 'REFUND', 'SUCCESS']);

const invalidOrder = () => { throw new ApiError(400, 'WECHAT_NATIVE_LOCK_INVALID', '微信支付订单资料或付款期限无效。'); };
const providerUnavailable = () => { throw new ApiError(502, 'WECHAT_NATIVE_PROVIDER_UNAVAILABLE', '暂时无法核实微信支付订单状态。'); };

function validNotifyUrl(value) {
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

async function readResponseBytes(response, signal) {
  const declaredLength = response.headers.get('Content-Length');
  if (!response.body || (declaredLength !== null &&
      (!matches(/^\d+$/, declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES))) {
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
      if (length > MAX_RESPONSE_BYTES) providerUnavailable();
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
      !validNotifyUrl(notifyUrl) || typeof fetchImpl !== 'function' || typeof now !== 'function') {
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

  async function request(method, path, at, body) {
    const timestamp = Math.floor(at / 1000);
    const nonce = randomBytes(16).toString('hex');
    const canonical = Buffer.from(`${method}\n${path}\n${timestamp}\n${nonce}\n${body ?? ''}\n`);
    const signature = sign('sha256', canonical, {key: privateKey, padding: constants.RSA_PKCS1_PADDING}).toString('base64');
    const headers = {
      Accept: 'application/json',
      Authorization: `${SIGNATURE_TYPE} mchid="${merchantId}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${certificateSerial}"`,
      'Wechatpay-Serial': preferredPublicKeyId,
      ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
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
      const mayBeMissingOrder = method === 'GET' && response.status === 404;
      if (signal.aborted || response.redirected || (response.url && response.url !== url) ||
          (response.status !== 200 && !mayBeMissingOrder)) {
        void response.body?.cancel().catch(() => {});
        providerUnavailable();
      }
      const bytes = await readResponseBytes(response, signal);
      const receivedAt = now();
      const signedAt = verifySignature(response.headers, bytes, receivedAt);
      if (signedAt === null) providerUnavailable();
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

    async queryOrder(order) {
      const at = now();
      const locked = readLockedOrder(order, at);
      const {merchantOrderId} = locked;
      const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrderId)}?mchid=${merchantId}`;
      const {data, missing, receivedAt, signedAt} = await request('GET', path, at);
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
  });
}
