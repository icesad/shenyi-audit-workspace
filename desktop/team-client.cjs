'use strict';

// Main-process only. The renderer never receives bearer tokens or raw fetch.
const API_BASE = 'http://127.0.0.1:8774';
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ROLES = new Set(['intern', 'assistant', 'manager', 'partner']);
class ClientError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status; }
}
const failure = (code, message, status) => new ClientError(code, message, status);
function id(value) { if (typeof value !== 'string' || !ID.test(value)) throw failure('INVALID_INPUT', '任务标识无效。'); return value; }
function exactKeys(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key))) throw failure('INVALID_INPUT', '操作参数无效。');
}
function cleanSession(value) {
  if (!value?.account || typeof value.account.id !== 'string' || typeof value.account.displayName !== 'string' || !Array.isArray(value.memberships) || !Number.isSafeInteger(value.expiresAt)) throw failure('INVALID_RESPONSE', '账号服务返回格式无效。');
  return {account: {id: value.account.id, displayName: value.account.displayName}, expiresAt: value.expiresAt,
    memberships: value.memberships.map(member => { if (!ID.test(member.teamId) || !ROLES.has(member.role)) throw failure('INVALID_RESPONSE', '团队资料格式无效。'); return {teamId: member.teamId, role: member.role}; })};
}
function taskView(task) {
  if (!task || !ID.test(task.id) || !['title', 'instructions', 'status'].every(key => typeof task[key] === 'string')) throw failure('INVALID_RESPONSE', '任务服务返回格式无效。');
  return {id: task.id, title: task.title, instructions: task.instructions, status: task.status};
}
function submissionView(item) {
  if (!item || !ID.test(item.id) || !ID.test(item.attachmentId) || typeof item.filename !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256) || !Number.isSafeInteger(item.byteLength) || item.byteLength < 0 || item.byteLength > MAX_FILE_BYTES || !Number.isSafeInteger(item.createdAt)) throw failure('INVALID_RESPONSE', '提交记录返回格式无效。');
  return {id: item.id, attachmentId: item.attachmentId, filename: item.filename, sha256: item.sha256, byteLength: item.byteLength, createdAt: item.createdAt};
}
async function boundedBytes(response, limit) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw failure('RESPONSE_TOO_LARGE', '服务返回内容超过大小限制。');
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0; const chunks = [];
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) { await reader.cancel(); throw failure('RESPONSE_TOO_LARGE', '服务返回内容超过大小限制。'); } chunks.push(part.value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function createTeamClient({baseUrl = API_BASE, fetchImpl = globalThis.fetch} = {}) {
  if (baseUrl !== API_BASE || typeof fetchImpl !== 'function') throw failure('INVALID_SERVER', '预览版只连接本机审易服务。');
  let token = null, current = null, generation = 0;
  const clear = () => { token = null; current = null; generation++; };
  const snapshot = () => current ? structuredClone(current) : null;
  async function request(route, {method = 'GET', body, authenticated = true, binary = false} = {}) {
    if (authenticated && !token) throw failure('SIGN_IN_REQUIRED', '请先登录。', 401);
    const at = generation, bearer = token;
    let response;
    try { response = await fetchImpl(API_BASE + route, {method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {'Origin': 'shenyi://app', ...(authenticated ? {Authorization: `Bearer ${bearer}`} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})}); }
    catch { if (at !== generation) throw failure('SESSION_CHANGED', '账号状态已改变，请重新操作。'); throw failure('SERVICE_UNAVAILABLE', '无法连接本机团队服务，请先启动服务后重试。'); }
    if (at !== generation) throw failure('SESSION_CHANGED', '账号状态已改变，请重新操作。');
    if (response.status === 401 && authenticated) { clear(); throw failure('SIGN_IN_REQUIRED', '登录已失效，请重新登录。', 401); }
    if (!response.ok) {
      const messages = {400:'提交内容无效，请检查后重试。',403:'当前操作未获授权。',404:'任务不存在或当前账号无权访问。',409:'任务状态或版本已更新，请刷新后重试。',413:'资料超过12 MiB，请选择较小的文件。',429:'尝试过于频繁，请稍后重试。'};
      // Do not forward arbitrary provider messages, stack traces, or response bodies.
      throw failure(`HTTP_${response.status}`, messages[response.status] || '团队服务暂时无法完成操作。', response.status);
    }
    const bytes = await boundedBytes(response, binary ? MAX_FILE_BYTES : 1024 * 1024);
    if (at !== generation) throw failure('SESSION_CHANGED', '账号状态已改变，请重新操作。');
    if (binary) return {bytes, contentDisposition: response.headers.get('content-disposition') || ''};
    try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
    catch { throw failure('INVALID_RESPONSE', '团队服务返回格式无效。'); }
  }
  function path(teamId, taskId) { return `/api/teams/${id(teamId)}/collection/tasks${taskId ? '/' + id(taskId) : ''}`; }
  return Object.freeze({
    async login(input) {
      exactKeys(input, ['username', 'password']);
      if (typeof input.username !== 'string' || input.username.length < 1 || input.username.length > 128 || typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 1024) throw failure('INVALID_INPUT', '请填写账号和密码。');
      clear(); const at = generation;
      const data = await request('/api/auth/login', {method:'POST', body:{username:input.username,password:input.password},authenticated:false});
      if (at !== generation) throw failure('SESSION_CHANGED', '账号状态已改变，请重新登录。');
      if (typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.token)) throw failure('INVALID_RESPONSE', '账号服务返回格式无效。');
      current = cleanSession(data); token = data.token;
      return snapshot();
    },
    async getSession() { if (!token) return null; const data = await request('/api/auth/session'); current = cleanSession(data); return snapshot(); },
    async logout() { try { if (token) await request('/api/auth/logout', {method:'POST',body:{}}); } finally { clear(); } return {signedOut:true}; },
    async listTasks(input) { exactKeys(input, ['teamId','q','after','limit']);
      const params = new URLSearchParams();
      if (input.q !== undefined) { if (typeof input.q !== 'string' || input.q.length > 100) throw failure('INVALID_INPUT','搜索内容最多100字。'); params.set('q', input.q); }
      if (input.after !== undefined) params.set('after', id(input.after));
      if (input.limit !== undefined) { if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw failure('INVALID_INPUT','分页参数无效。'); params.set('limit', String(input.limit)); }
      const result = await request(path(input.teamId) + (params.size ? '?' + params : ''));
      if (!Array.isArray(result.tasks) || result.tasks.length > 100 || typeof result.hasMore !== 'boolean') throw failure('INVALID_RESPONSE','任务服务返回格式无效。');
      return {tasks:result.tasks.map(taskView),hasMore:result.hasMore}; },
    async getTask(input) { exactKeys(input,['teamId','taskId']); return {task:taskView((await request(path(input.teamId,input.taskId))).task)}; },
    async getSubmissions(input) { exactKeys(input,['teamId','taskId']); const data=await request(path(input.teamId,input.taskId)+'/submissions'); if (!Number.isSafeInteger(data.revision) || data.revision<0 || !Array.isArray(data.submissions)) throw failure('INVALID_RESPONSE','提交记录返回格式无效。'); return {revision:data.revision,submissions:data.submissions.map(submissionView)}; },
    async upload(input, file) { exactKeys(input,['teamId','taskId','revision']); if (!Number.isSafeInteger(input.revision)||input.revision<0||!file||typeof file.filename!=='string'||!(file.bytes instanceof Uint8Array)||file.bytes.length>MAX_FILE_BYTES) throw failure('INVALID_INPUT','上传资料无效或超过12 MiB。');
      const data=await request(path(input.teamId,input.taskId)+'/submissions',{method:'POST',body:{filename:file.filename,contentBase64:Buffer.from(file.bytes).toString('base64'),revision:input.revision}});
      if (!Number.isSafeInteger(data.revision)||data.revision<1) throw failure('INVALID_RESPONSE','提交记录返回格式无效。'); return {revision:data.revision,submission:submissionView(data.submission)}; },
    async download(input) { exactKeys(input,['teamId','taskId','attachmentId']); return request(path(input.teamId,input.taskId)+'/attachments/'+id(input.attachmentId),{binary:true}); },
    guardSession() { const at=generation; if(!token)throw failure('SIGN_IN_REQUIRED','请先登录。',401);return ()=>{if(at!==generation||!token)throw failure('SESSION_CHANGED','账号状态已改变，请重新操作。');}; },
    clearSession: clear,
  });
}
module.exports = {createTeamClient,ClientError,API_BASE,MAX_FILE_BYTES,boundedBytes};
