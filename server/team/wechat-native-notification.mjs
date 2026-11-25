import {createDecipheriv} from 'node:crypto';
import {ApiError, ID} from './http-utils.mjs';
import {
  APP_ID, MERCHANT_ID, MERCHANT_ORDER_ID, TRANSACTION_ID, MAX_AMOUNT_MINOR, SIGNATURE_TOLERANCE_MS,
  boundedInteger, createWechatSignatureVerifier, decodeBase64, matches, paidOnOrAfterCreation, parsePaymentTime,
  parseWechatRecord, record,
} from './wechat-native-protocol.mjs';

const MAX_CIPHERTEXT = 1_048_576;
export const WECHAT_NATIVE_NOTIFICATION_MAX_BYTES = MAX_CIPHERTEXT + 4096;
const EVENT_ID = /^[A-Za-z0-9_-]{1,36}$/;

const invalid = () => { throw new ApiError(400, 'WECHAT_NATIVE_NOTIFICATION_INVALID', '微信支付通知内容无效。'); };
const unauthenticated = () => { throw new ApiError(401, 'WECHAT_NATIVE_SIGNATURE_INVALID', '微信支付通知验签未通过。'); };
const mismatch = () => { throw new ApiError(409, 'WECHAT_NATIVE_ORDER_MISMATCH', '微信支付通知与已锁定订单不一致。'); };

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
  return parseWechatRecord(plaintext) ?? invalid();
}

export function createWechatNativeNotificationVerifier({appId, merchantId, apiV3Key, keys, readOrder, now = Date.now}) {
  if (!matches(APP_ID, appId) || !matches(MERCHANT_ID, merchantId) || !Buffer.isBuffer(apiV3Key) || apiV3Key.length !== 32 ||
      typeof readOrder !== 'function' || typeof now !== 'function') throw new TypeError('Invalid WeChat Pay configuration');
  const verifySignature = createWechatSignatureVerifier(keys);
  const apiKey = Buffer.from(apiV3Key);

  return async function verifyNotification({headers, body}) {
    if (!Buffer.isBuffer(body) || !body.length || body.length > WECHAT_NATIVE_NOTIFICATION_MAX_BYTES) invalid();
    const receivedAt = now();
    const signedAt = verifySignature(headers, body, receivedAt) ?? unauthenticated();
    const notification = parseWechatRecord(body) ?? invalid();
    if (!matches(EVENT_ID, notification.id) || notification.event_type !== 'TRANSACTION.SUCCESS' ||
        notification.resource_type !== 'encrypt-resource') invalid();
    const notifiedAt = parsePaymentTime(notification.create_time) ?? invalid();
    const trade = decryptResource(notification.resource, apiKey);
    if (trade.trade_type !== 'NATIVE' || trade.trade_state !== 'SUCCESS' ||
        !matches(MERCHANT_ORDER_ID, trade.out_trade_no) || !matches(TRANSACTION_ID, trade.transaction_id)) invalid();
    const amount = trade.amount;
    if (!record(amount) || !boundedInteger(amount.total, 1, MAX_AMOUNT_MINOR) ||
        !boundedInteger(amount.payer_total, 0, amount.total) || amount.currency !== 'CNY' || amount.payer_currency !== 'CNY') invalid();
    const paidAt = parsePaymentTime(trade.success_time) ?? invalid();
    if (paidAt > notifiedAt || notifiedAt > Math.min(signedAt, receivedAt) + SIGNATURE_TOLERANCE_MS) invalid();
    if (trade.appid !== appId || trade.mchid !== merchantId) mismatch();

    // The lookup is local and read-only. Transactional deduplication and fulfilment belong at the caller.
    const stored = await readOrder({appId, merchantId, merchantOrderId: trade.out_trade_no});
    if (!stored || !matches(ID, stored.id) || stored.appId !== appId || stored.merchantId !== merchantId ||
        stored.merchantOrderId !== trade.out_trade_no || stored.amountMinor !== amount.total || stored.currency !== amount.currency ||
        !boundedInteger(stored.createdAt, 0, receivedAt)) mismatch();
    if (!paidOnOrAfterCreation(paidAt, stored.createdAt)) mismatch();

    return Object.freeze({channel: 'wechat-pay-native-v3', orderId: stored.id, eventId: notification.id,
      merchantOrderId: trade.out_trade_no, transactionId: trade.transaction_id, appId, merchantId,
      amountMinor: amount.total, currency: amount.currency, paidAt});
  };
}
