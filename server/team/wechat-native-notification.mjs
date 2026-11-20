import {constants, createDecipheriv, createPublicKey, KeyObject, verify} from 'node:crypto';
import {ApiError, ID} from './http-utils.mjs';

const MAX_CIPHERTEXT = 1_048_576;
const MAX_BODY = MAX_CIPHERTEXT + 4096;
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
const KEY_ID = /^PUB_KEY_ID_[0-9]{1,64}$/;
const APP_ID = /^[A-Za-z0-9_-]{1,32}$/;
const MERCHANT_ID = /^[0-9]{1,32}$/;
const MERCHANT_ORDER_ID = /^[A-Za-z0-9_*|-]{6,32}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{1,36}$/;
const TRANSACTION_ID = /^[A-Za-z0-9_-]{1,32}$/;
const RFC3339 = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

const matches = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
const record = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const boundedInteger = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const invalid = () => { throw new ApiError(400, 'WECHAT_NATIVE_NOTIFICATION_INVALID', '微信支付通知内容无效。'); };
const unauthenticated = () => { throw new ApiError(401, 'WECHAT_NATIVE_SIGNATURE_INVALID', '微信支付通知验签未通过。'); };
const mismatch = () => { throw new ApiError(409, 'WECHAT_NATIVE_ORDER_MISMATCH', '微信支付通知与已锁定订单不一致。'); };

function signedTime(value) {
  if (!matches(RFC3339, value)) invalid();
  const date = value.slice(0, 10);
  const midnight = new Date(date + 'T00:00:00Z');
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || time < 0 || !Number.isFinite(midnight.valueOf()) ||
      midnight.toISOString().slice(0, 10) !== date) invalid();
  return time;
}

function decodeBase64(value, maxLength) {
  if (typeof value !== 'string' || !value.length || value.length > maxLength) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

function parseRecord(bytes) {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    invalid();
  }
  if (!record(parsed)) invalid();
  return parsed;
}

function publicKeys(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new TypeError('Missing WeChat Pay public keys');
  const result = new Map();
  for (const {id, key} of entries) {
    if (!matches(KEY_ID, id) || result.has(id)) throw new TypeError('Invalid WeChat Pay public key ID');
    const publicKey = typeof key === 'string' && key.trimStart().startsWith('-----BEGIN PUBLIC KEY-----') ? createPublicKey(key) : key;
    if (!(publicKey instanceof KeyObject) || publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'rsa' ||
        publicKey.asymmetricKeyDetails?.modulusLength !== 2048) throw new TypeError('Expected a 2048-bit WeChat Pay RSA public key');
    result.set(id, publicKey);
  }
  return result;
}

function verifySignature(headers, body, keys, now) {
  if (!(headers instanceof Headers)) unauthenticated();
  const timestamp = headers.get('Wechatpay-Timestamp');
  const nonce = headers.get('Wechatpay-Nonce');
  const type = headers.get('Wechatpay-Signature-Type');
  const key = keys.get(headers.get('Wechatpay-Serial'));
  const signature = decodeBase64(headers.get('Wechatpay-Signature'), 344);
  if (!key || signature?.length !== 256 || !matches(/^[0-9]{1,12}$/, timestamp) ||
      !matches(/^[\x21-\x2b\x2d-\x7e]{1,128}$/, nonce) ||
      (type !== null && type !== 'WECHATPAY2-SHA256-RSA2048')) unauthenticated();
  const signedAt = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(now) || now < 0 || Math.abs(now - signedAt) > SIGNATURE_TOLERANCE_MS) unauthenticated();
  const message = Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), body, Buffer.from('\n')]);
  if (!verify('sha256', message, {key, padding: constants.RSA_PKCS1_PADDING}, signature)) unauthenticated();
  return signedAt;
}

function decryptResource(resource, apiKey) {
  if (!record(resource) || resource.original_type !== 'transaction' || resource.algorithm !== 'AEAD_AES_256_GCM' ||
      typeof resource.nonce !== 'string' || Buffer.byteLength(resource.nonce) !== 12) invalid();
  const associatedData = resource.associated_data === undefined ? '' : resource.associated_data;
  if (typeof associatedData !== 'string' || Buffer.byteLength(associatedData) > 16) invalid();
  const ciphertext = decodeBase64(resource.ciphertext, MAX_CIPHERTEXT);
  if (!ciphertext || ciphertext.length <= 16) invalid();
  let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', apiKey, Buffer.from(resource.nonce), {authTagLength: 16});
    decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(ciphertext.subarray(-16));
    plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  } catch {
    invalid();
  }
  return parseRecord(plaintext);
}

export function createWechatNativeNotificationVerifier({appId, merchantId, apiV3Key, keys, readOrder, now = Date.now}) {
  if (!matches(APP_ID, appId) || !matches(MERCHANT_ID, merchantId) || !Buffer.isBuffer(apiV3Key) || apiV3Key.length !== 32 ||
      typeof readOrder !== 'function' || typeof now !== 'function') throw new TypeError('Invalid WeChat Pay configuration');
  const trustedKeys = publicKeys(keys);
  const apiKey = Buffer.from(apiV3Key);

  return async function verifyNotification({headers, body}) {
    if (!Buffer.isBuffer(body) || !body.length || body.length > MAX_BODY) invalid();
    const receivedAt = now();
    const signedAt = verifySignature(headers, body, trustedKeys, receivedAt);
    const notification = parseRecord(body);
    if (!matches(EVENT_ID, notification.id) || notification.event_type !== 'TRANSACTION.SUCCESS' ||
        notification.resource_type !== 'encrypt-resource') invalid();
    const notifiedAt = signedTime(notification.create_time);
    const trade = decryptResource(notification.resource, apiKey);
    if (trade.trade_type !== 'NATIVE' || trade.trade_state !== 'SUCCESS' ||
        !matches(MERCHANT_ORDER_ID, trade.out_trade_no) || !matches(TRANSACTION_ID, trade.transaction_id)) invalid();
    const amount = trade.amount;
    if (!record(amount) || !boundedInteger(amount.total, 1, 2_147_483_647) ||
        !boundedInteger(amount.payer_total, 0, amount.total) || amount.currency !== 'CNY' || amount.payer_currency !== 'CNY') invalid();
    const paidAt = signedTime(trade.success_time);
    if (paidAt > notifiedAt || notifiedAt > Math.min(signedAt, receivedAt) + SIGNATURE_TOLERANCE_MS) invalid();
    if (trade.appid !== appId || trade.mchid !== merchantId) mismatch();

    // The lookup is local and read-only. Transactional deduplication and fulfilment belong at the caller.
    const stored = await readOrder({appId, merchantId, merchantOrderId: trade.out_trade_no});
    if (!stored || !matches(ID, stored.id) || stored.appId !== appId || stored.merchantId !== merchantId ||
        stored.merchantOrderId !== trade.out_trade_no || stored.amountMinor !== amount.total || stored.currency !== amount.currency ||
        !boundedInteger(stored.createdAt, 0, receivedAt)) mismatch();
    // WeChat reports payment time to the second. A payment in the order's creation second is valid.
    if (paidAt < Math.floor(stored.createdAt / 1000) * 1000) mismatch();

    return Object.freeze({channel: 'wechat-pay-native-v3', orderId: stored.id, eventId: notification.id,
      merchantOrderId: trade.out_trade_no, transactionId: trade.transaction_id, appId, merchantId,
      amountMinor: amount.total, currency: amount.currency, paidAt});
  };
}
