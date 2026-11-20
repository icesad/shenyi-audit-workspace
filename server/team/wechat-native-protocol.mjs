import {constants, createPublicKey, KeyObject, verify} from 'node:crypto';

export const SIGNATURE_TYPE = 'WECHATPAY2-SHA256-RSA2048';
export const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
export const APP_ID = /^[A-Za-z0-9_-]{1,32}$/;
export const MERCHANT_ID = /^[0-9]{1,32}$/;
export const MERCHANT_ORDER_ID = /^[A-Za-z0-9_*|-]{6,32}$/;
export const TRANSACTION_ID = /^[A-Za-z0-9_-]{1,32}$/;
export const MAX_AMOUNT_MINOR = 2_147_483_647;

const KEY_ID = /^PUB_KEY_ID_[0-9]{1,64}$/;
const RFC3339 = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export const matches = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
export const record = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
export const boundedInteger = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
export const isRsa2048Key = (key, type) => key instanceof KeyObject && key.type === type &&
  key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails?.modulusLength === 2048;

export function parsePaymentTime(value) {
  if (!matches(RFC3339, value)) return null;
  const date = value.slice(0, 10);
  const midnight = new Date(date + 'T00:00:00Z');
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || time < 0 || !Number.isFinite(midnight.valueOf()) ||
      midnight.toISOString().slice(0, 10) !== date) return null;
  return time;
}

// WeChat reports payment time to the second. A payment in the order's creation second is valid.
export const paidOnOrAfterCreation = (paidAt, createdAt) => paidAt >= Math.floor(createdAt / 1000) * 1000;

export function decodeBase64(value, maxLength) {
  if (typeof value !== 'string' || !value.length || value.length > maxLength) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

export function parseWechatRecord(bytes) {
  try {
    const data = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    return record(data) ? data : null;
  } catch {
    return null;
  }
}

export function createWechatSignatureVerifier(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new TypeError('Missing WeChat Pay public keys');
  const keys = new Map();
  for (const {id, key} of entries) {
    if (!matches(KEY_ID, id) || keys.has(id)) throw new TypeError('Invalid WeChat Pay public key ID');
    const publicKey = typeof key === 'string' && key.trimStart().startsWith('-----BEGIN PUBLIC KEY-----') ? createPublicKey(key) : key;
    if (!isRsa2048Key(publicKey, 'public')) throw new TypeError('Expected a 2048-bit WeChat Pay RSA public key');
    keys.set(id, publicKey);
  }

  return function verifyWechatSignature(headers, body, now) {
    if (!(headers instanceof Headers)) return null;
    const timestamp = headers.get('Wechatpay-Timestamp');
    const nonce = headers.get('Wechatpay-Nonce');
    const type = headers.get('Wechatpay-Signature-Type');
    const key = keys.get(headers.get('Wechatpay-Serial'));
    const signature = decodeBase64(headers.get('Wechatpay-Signature'), 344);
    if (!key || signature?.length !== 256 || !matches(/^[0-9]{1,12}$/, timestamp) ||
        !matches(/^[\x21-\x2b\x2d-\x7e]{1,128}$/, nonce) ||
        (type !== null && type !== SIGNATURE_TYPE)) return null;
    const signedAt = Number(timestamp) * 1000;
    if (!Number.isSafeInteger(now) || now < 0 || Math.abs(now - signedAt) > SIGNATURE_TOLERANCE_MS) return null;
    const message = Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), body, Buffer.from('\n')]);
    return verify('sha256', message, {key, padding: constants.RSA_PKCS1_PADDING}, signature) ? signedAt : null;
  };
}
