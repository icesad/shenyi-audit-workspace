import {ApiError, json, PRIVATE_HEADERS} from './http-utils.mjs';
import {WECHAT_NATIVE_NOTIFICATION_MAX_BYTES} from './wechat-native-notification.mjs';

export const WECHAT_NATIVE_NOTIFY_PATH = '/api/billing/wechat-native/notify';
const READ_TIMEOUT_MS = 3000;
const JSON_TYPE = /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i;
const SIGNATURE_HEADERS = ['Wechatpay-Timestamp', 'Wechatpay-Nonce', 'Wechatpay-Serial', 'Wechatpay-Signature'];

const fail = (status, message, headers) => json({code:'FAIL', message}, status, headers);

async function rawNotification(request) {
  const advertised = request.headers.get('Content-Length');
  if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > WECHAT_NATIVE_NOTIFICATION_MAX_BYTES)) {
    throw new ApiError(413, 'NOTIFICATION_TOO_LARGE');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'MISSING_NOTIFICATION_BODY');
  const {signal} = request;
  const chunks = [];
  let length = 0, timer, interrupted;
  const deadline = new Promise((_, reject) => {
    interrupted = () => reject(new ApiError(408, 'NOTIFICATION_READ_INTERRUPTED'));
    if (signal.aborted) interrupted();
    else signal.addEventListener('abort', interrupted, {once:true});
    timer = setTimeout(interrupted, READ_TIMEOUT_MS);
  });
  const read = async () => {
    for (;;) {
      const {done, value} = await reader.read();
      if (signal.aborted) throw new ApiError(408, 'NOTIFICATION_READ_INTERRUPTED');
      if (done) break;
      length += value.byteLength;
      if (length > WECHAT_NATIVE_NOTIFICATION_MAX_BYTES) throw new ApiError(413, 'NOTIFICATION_TOO_LARGE');
      chunks.push(value);
    }
    if (!length || (advertised !== null && length !== Number(advertised))) throw new ApiError(400, 'INVALID_NOTIFICATION_LENGTH');
    return Buffer.concat(chunks, length);
  };
  try {
    return await Promise.race([read(), deadline]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', interrupted);
    // The HTTP adapter drains or closes a denied transport; do not destroy the
    // socket here prior to its failure response.
    reader.releaseLock();
  }
}

export async function handleWechatNativeCallback(request, receiveNotification) {
  if (request.method !== 'POST') return fail(405, '请求方法无效。', {Allow:'POST'});
  if (request.headers.has('Origin') || request.headers.has('Sec-Fetch-Site')) return fail(403, '请求来源无效。');
  const encoding = request.headers.get('Content-Encoding');
  if (!JSON_TYPE.test(request.headers.get('Content-Type') ?? '') || (encoding !== null && encoding.toLowerCase() !== 'identity')) {
    return fail(415, '通知格式无效。');
  }
  if (!SIGNATURE_HEADERS.every(name => request.headers.has(name))) return fail(401, '支付通知验签未通过。');
  try {
    const body = await rawNotification(request);
    await receiveNotification({headers:request.headers, body});
    return new Response(null, {status:204, headers:PRIVATE_HEADERS});
  } catch (error) {
    if (error instanceof ApiError && [400, 401, 408, 409, 413].includes(error.status)) {
      return fail(error.status, '未能接收支付通知。');
    }
    return fail(503, '暂时无法保存支付通知。');
  }
}
