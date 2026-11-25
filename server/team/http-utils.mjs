export const PRIVATE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', Vary: 'Authorization',
});
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: {...PRIVATE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers},
});
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const deny = () => { throw new ApiError(404, 'NOT_FOUND', '无法访问此资源。'); };
export const invalid = () => { throw new ApiError(400, 'INVALID_INPUT', '请求资料无效。'); };
export const conflict = () => { throw new ApiError(409, 'CONFLICT', '任务状态或版本已改变，请刷新后重试。'); };
export const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export function getBearer(request) {
  const value = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.get('Authorization') || '')?.[1];
  return value && Buffer.from(value, 'base64url').toString('base64url') === value ? value : null;
}
export async function readJson(request, keys, maximum = 16384) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new ApiError(415, 'JSON_REQUIRED', '请使用JSON格式。');
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new ApiError(413, 'TOO_LARGE', '资料超过大小限制。');
  const reader = request.body?.getReader();
  if (!reader) invalid();
  const chunks = []; let total = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    total += part.value.byteLength;
    if (total > maximum) { await reader.cancel(); throw new ApiError(413, 'TOO_LARGE', '资料超过大小限制。'); }
    chunks.push(part.value);
  }
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); } catch { invalid(); }
  if (!data || Array.isArray(data) || typeof data !== 'object' || Object.getPrototypeOf(data) !== Object.prototype || Object.keys(data).some(key => !keys.includes(key))) invalid();
  return data;
}
export function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
