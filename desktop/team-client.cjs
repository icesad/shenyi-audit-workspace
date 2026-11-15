'use strict';
const {createWechatLogin}=require('./wechat-login.cjs');

// Main-process only. The renderer never receives bearer tokens or raw fetch.
const API_BASE = 'http://127.0.0.1:8774';
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ROLES = new Set(['intern', 'assistant', 'manager', 'partner']);
const SESSION_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
class ClientError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status; }
}
const failure = (code, message, status) => new ClientError(code, message, status);
function id(value) { if (typeof value !== 'string' || !ID.test(value)) throw failure('INVALID_INPUT', '任务标识无效。'); return value; }
function exactKeys(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key))) throw failure('INVALID_INPUT', '操作参数无效。');
}
function phoneInput(value) {
  if (typeof value !== 'string' || value.length > 32 || !/^(?:\+86)?1[3-9]\d{9}$/.test(value.trim())) throw failure('INVALID_INPUT', '请填写有效的中国大陆手机号。');
  return value.trim();
}
function passwordInput(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024) throw failure('INVALID_INPUT', '请填写账号密码。');
  return value;
}
function invitationCodeInput(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value)||Buffer.from(value,'base64url').toString('base64url')!==value)throw failure('INVALID_INPUT','请填写本次收到的完整邀请码。');return value;}
function invitationView(value,expectedTeam){
  if(!value||typeof value.teamId!=='string'||!ID.test(value.teamId)||(expectedTeam&&value.teamId!==expectedTeam)||!['intern','assistant'].includes(value.role)||typeof value.phoneMasked!=='string'||!/^[+0-9* ]{7,32}$/.test(value.phoneMasked)||!value.phoneMasked.includes('*')||!Number.isSafeInteger(value.expiresAt))throw failure('INVALID_RESPONSE','邀请信息格式无效。');
  return {teamId:value.teamId,role:value.role,phoneMasked:value.phoneMasked,expiresAt:value.expiresAt};
}
function sessionIdInput(value){if(typeof value!=='string'||!SESSION_ID.test(value))throw failure('INVALID_INPUT','登录会话标识无效，请刷新后重试。');return value;}
function securityPasswordInput(value){passwordInput(value);if(Buffer.byteLength(value)>512)throw failure('INVALID_INPUT','当前密码内容无效，请核对后重试。');return value;}
function sessionView(value){
  if(!value||typeof value.id!=='string'||!SESSION_ID.test(value.id)||typeof value.isCurrent!=='boolean'||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=0||(value.createdAt!==null&&(!Number.isSafeInteger(value.createdAt)||value.createdAt<0||value.createdAt>value.expiresAt)))throw failure('INVALID_RESPONSE','登录会话列表格式无效。');
  return {id:value.id,isCurrent:value.isCurrent,createdAt:value.createdAt,expiresAt:value.expiresAt};
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

function createTeamClient({baseUrl = API_BASE, fetchImpl = globalThis.fetch,wechatPolicy,openAuthorization,now=Date.now} = {}) {
  if (baseUrl !== API_BASE || typeof fetchImpl !== 'function') throw failure('INVALID_SERVER', '预览版只连接本机审易服务。');
  let token = null, current = null, generation = 0,wechat;
  const clear = () => { token = null; current = null; generation++;wechat?.reset(); };
  const snapshot = () => current ? structuredClone(current) : null;
  async function revokeResponseToken(bytes){
    try{const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(typeof data?.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(data.token))await detachedPost('/api/auth/logout',{},data.token);}catch{}
  }
  async function request(route, {method = 'GET', body, authenticated = true, binary = false, unavailableMessage,temporaryBearer,discardSessionOnChange=false,messagesOverride} = {}) {
    if (authenticated && !token && !temporaryBearer) throw failure('SIGN_IN_REQUIRED', '请先登录。', 401);
    const at = generation, bearer = temporaryBearer||token;
    let response;
    try { response = await fetchImpl(API_BASE + route, {method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {'Origin': 'shenyi://app', ...(authenticated ? {Authorization: `Bearer ${bearer}`} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})}); }
    catch { if (at !== generation) throw failure('SESSION_CHANGED', '账号状态已改变，请重新操作。'); throw failure('SERVICE_UNAVAILABLE', '无法连接本机团队服务，请先启动服务后重试。'); }
    if (at !== generation) {
      if(discardSessionOnChange&&response.ok)try{await revokeResponseToken(await boundedBytes(response,1024*1024));}catch{}
      throw failure('SESSION_CHANGED', '账号状态已改变，请重新操作。');
    }
    if (response.status === 401 && authenticated && !temporaryBearer) { clear(); throw failure('SIGN_IN_REQUIRED', '登录已失效，请重新登录。', 401); }
    if (!response.ok) {
      const messages = {400:'提交内容无效，请检查后重试。',401:'账号或密码无效，请检查后重试。',403:'当前操作未获授权。',404:'任务不存在或当前账号无权访问。',409:'任务状态或版本已更新，请刷新后重试。',413:'资料超过12 MiB，请选择较小的文件。',429:'尝试过于频繁，请稍后重试。'};
      // Do not forward arbitrary provider messages, stack traces, or response bodies.
      throw failure(`HTTP_${response.status}`, response.status === 503 && unavailableMessage ? unavailableMessage : messagesOverride?.[response.status]||messages[response.status] || '团队服务暂时无法完成操作。', response.status);
    }
    const bytes = await boundedBytes(response, binary ? MAX_FILE_BYTES : 1024 * 1024);
    if (at !== generation) {if(discardSessionOnChange)await revokeResponseToken(bytes);throw failure('SESSION_CHANGED', '账号状态已改变，请重新操作。');}
    if (binary) return {bytes, contentDisposition: response.headers.get('content-disposition') || ''};
    try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
    catch { throw failure('INVALID_RESPONSE', '团队服务返回格式无效。'); }
  }
  async function detachedPost(route,body,bearer){
    // Only closure-created cancel/logout paths use this cleanup transport. It
    // may outlive generation changes; it never adopts or exposes a response.
    const response=await fetchImpl(API_BASE+route,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Origin:'shenyi://app','Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body)});
    await response.body?.cancel();
  }
  wechat=createWechatLogin({policy:wechatPolicy,openAuthorization,request,now,error:failure,getGeneration:()=>generation,isSignedIn:()=>!!token,
    cancelRemote:(route,body)=>detachedPost(route,body),revokeTemporary:bearer=>detachedPost('/api/auth/logout',{},bearer),
    adoptSession:data=>{if(typeof data?.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.token))throw failure('INVALID_RESPONSE','账号服务返回格式无效。');const value=cleanSession(data);current=value;token=data.token;generation++;return snapshot();}});
  const onboardingRequest=(route,options)=>request(route,{...options,unavailableMessage:'员工邀请或手机号验证服务尚未开通或暂不可用。',messagesOverride:{400:'验证内容无效，请核对后重试。',404:'邀请码或手机号无效，或邀请已失效；管理操作也可能未获授权。',409:'当前账号或邀请状态不适用于激活，请联系管理员核对。',410:'本次验证已过期，请重新获取。'}});
  const sessionsRequest=(route,options)=>request(route,{...options,messagesOverride:{403:'当前密码验证未通过，请核对后重试。',404:'无法访问该登录会话，请刷新列表。',409:'账号或登录状态已改变，请刷新后重试。'}});
  async function bulkRevokeSessions(input,all){
    exactKeys(input,['currentPassword']);const data=await sessionsRequest('/api/auth/sessions/'+(all?'revoke-all':'revoke-others'),{method:'POST',body:{currentPassword:securityPasswordInput(input.currentPassword)}});
    if(!Number.isSafeInteger(data?.revokedCount)||data.revokedCount<(all?1:0)||data.signedOut!==all)throw failure('INVALID_RESPONSE','登录退出结果格式无效。');
    if(data.signedOut)clear();return {revokedCount:data.revokedCount,signedOut:data.signedOut};
  }
  const invitationPath=teamId=>'/api/teams/'+id(teamId)+'/employee-invitations';
  function activationTarget(input,keys){exactKeys(input,keys);if(token)throw failure('SIGN_OUT_REQUIRED','请先退出当前账号再激活受邀账号。');return {invitationCode:invitationCodeInput(input.invitationCode),phone:phoneInput(input.phone)};}
  function path(teamId, taskId) { return `/api/teams/${id(teamId)}/collection/tasks${taskId ? '/' + id(taskId) : ''}`; }
  return Object.freeze({
    async listAccountSessions(input={}){
      exactKeys(input,['limit','after']);const params=new URLSearchParams(),limit=input.limit??20;
      if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw failure('INVALID_INPUT','每次只能读取1至50个登录会话。');
      if(input.limit!==undefined)params.set('limit',String(limit));if(input.after!==undefined)params.set('after',sessionIdInput(input.after));
      const data=await sessionsRequest('/api/auth/sessions'+(params.size?'?'+params:''));
      if(!Array.isArray(data?.sessions)||data.sessions.length>limit||typeof data.hasMore!=='boolean'||(data.hasMore&&data.sessions.length===0))throw failure('INVALID_RESPONSE','登录会话列表格式无效。');
      const sessions=data.sessions.map(sessionView);if(new Set(sessions.map(item=>item.id)).size!==sessions.length||sessions.filter(item=>item.isCurrent).length>1)throw failure('INVALID_RESPONSE','登录会话列表格式无效。');return {sessions,hasMore:data.hasMore};
    },
    async revokeAccountSession(input){
      exactKeys(input,['sessionId','currentPassword']);const data=await sessionsRequest('/api/auth/sessions/'+sessionIdInput(input.sessionId)+'/revoke',{method:'POST',body:{currentPassword:securityPasswordInput(input.currentPassword)}});
      if(data?.revoked!==true||typeof data.signedOut!=='boolean')throw failure('INVALID_RESPONSE','登录退出结果格式无效。');if(data.signedOut)clear();return {revoked:true,signedOut:data.signedOut};
    },
    revokeOtherSessions:input=>bulkRevokeSessions(input,false),
    revokeAllSessions:input=>bulkRevokeSessions(input,true),
    async getOnboardingStatus(){const data=await onboardingRequest('/api/auth/onboarding/capabilities',{authenticated:false});if(typeof data?.available!=='boolean'||data.invitationOnly!==true)throw failure('INVALID_RESPONSE','员工激活服务状态无效。');return {available:data.available,invitationOnly:true};},
    async getInvitationAccess(input){exactKeys(input,['teamId']);const data=await onboardingRequest(invitationPath(input.teamId)+'/access');if(typeof data?.canInvite!=='boolean')throw failure('INVALID_RESPONSE','邀请权限状态无效。');return {canInvite:data.canInvite};},
    async createEmployeeInvitation(input){
      exactKeys(input,['teamId','phone','role']);if(!['intern','assistant'].includes(input.role))throw failure('INVALID_INPUT','邀请职级只可选择实习生或助理。');
      const data=await onboardingRequest(invitationPath(input.teamId),{method:'POST',body:{phone:phoneInput(input.phone),role:input.role}}),view=invitationView(data,input.teamId);
      if(typeof data.invitationId!=='string'||!ID.test(data.invitationId))throw failure('INVALID_RESPONSE','邀请信息格式无效。');
      return {...view,invitationId:data.invitationId,invitationCode:invitationCodeInput(data.invitationCode)};
    },
    async listEmployeeInvitations(input){exactKeys(input,['teamId']);const data=await onboardingRequest(invitationPath(input.teamId));if(!Array.isArray(data?.invitations)||data.invitations.length>50)throw failure('INVALID_RESPONSE','邀请列表格式无效。');return {invitations:data.invitations.map(item=>{const view=invitationView(item,input.teamId);if(typeof item.invitationId!=='string'||!ID.test(item.invitationId)||!['pending','revoked','accepted','expired'].includes(item.status))throw failure('INVALID_RESPONSE','邀请列表格式无效。');return {...view,invitationId:item.invitationId,status:item.status};})};},
    async revokeEmployeeInvitation(input){exactKeys(input,['teamId','invitationId']);const data=await onboardingRequest(invitationPath(input.teamId)+'/'+id(input.invitationId)+'/revoke',{method:'POST',body:{}});if(data?.revoked!==true)throw failure('INVALID_RESPONSE','撤销结果无效。');return {revoked:true};},
    async previewEmployeeInvitation(input){const body=activationTarget(input,['invitationCode','phone']);return invitationView(await onboardingRequest('/api/auth/onboarding/preview',{method:'POST',authenticated:false,body}));},
    async requestEmployeeActivation(input){const body=activationTarget(input,['invitationCode','phone']);const data=await onboardingRequest('/api/auth/onboarding/challenges',{method:'POST',authenticated:false,body});if(typeof data?.challengeId!=='string'||!ID.test(data.challengeId)||!Number.isSafeInteger(data.expiresAt))throw failure('INVALID_RESPONSE','员工验证信息格式无效。');return {challengeId:data.challengeId,expiresAt:data.expiresAt};},
    async activateEmployee(input){
      const body=activationTarget(input,['invitationCode','phone','challengeId','code','password','displayName','accept']);
      const displayName=input.displayName??'';
      if(typeof input.challengeId!=='string'||!ID.test(input.challengeId)||typeof input.code!=='string'||!/^\d{6}$/.test(input.code)||input.accept!==true||typeof displayName!=='string'||[...displayName].length>80||/[\x00-\x1f\x7f]/.test(displayName))throw failure('INVALID_INPUT','请填写验证资料并确认加入邀请中的团队。');
      const data=await onboardingRequest('/api/auth/onboarding/activate',{method:'POST',authenticated:false,body:{...body,challengeId:input.challengeId,code:input.code,password:passwordInput(input.password),displayName:displayName.trim(),accept:true}});
      if(data?.activated!==true)throw failure('INVALID_RESPONSE','账号激活结果无效。');return {activated:true};
    },
    async getAuthMethods() {
      const data = await request('/api/auth/methods', {authenticated:false});
      const keys=['demoUsername','phonePassword','phoneVerification','wechat','recovery'];
      if(data?.mode!=='local-preview'||!data.methods||!keys.every(key=>typeof data.methods[key]==='boolean')) throw failure('INVALID_RESPONSE','身份服务状态格式无效。');
      return {mode:data.mode,methods:Object.fromEntries(keys.map(key=>[key,data.methods[key]])),desktopWechatReady:wechat.configured};
    },
    startWechatLogin:()=>wechat.start(),
    pollWechatLogin:()=>wechat.poll(),
    cancelWechatLogin:()=>wechat.cancel(),
    async linkWechatAccount(input){exactKeys(input,['phone','password']);return wechat.link({phone:phoneInput(input.phone),password:passwordInput(input.password)});},
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
    async loginPhone(input) {
      exactKeys(input,['phone','password']);
      const body={phone:phoneInput(input.phone),password:passwordInput(input.password)};
      clear();const at=generation;
      const data=await request('/api/auth/phone/login',{method:'POST',body,authenticated:false});
      if(at!==generation)throw failure('SESSION_CHANGED','账号状态已改变，请重新登录。');
      if(typeof data.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.token))throw failure('INVALID_RESPONSE','账号服务返回格式无效。');
      current=cleanSession(data);token=data.token;return snapshot();
    },
    async requestPhoneBind(input) {
      exactKeys(input,['phone']);
      const result=await request('/api/auth/phone/challenges',{method:'POST',body:{phone:phoneInput(input.phone),purpose:'bind'},unavailableMessage:'短信验证服务尚未开通或暂不可用，未完成手机号验证。'});
      if(typeof result?.challengeId!=='string'||!ID.test(result.challengeId)||!Number.isSafeInteger(result.expiresAt))throw failure('INVALID_RESPONSE','验证服务返回格式无效。');
      return {challengeId:result.challengeId,expiresAt:result.expiresAt};
    },
    async bindPhone(input) {
      exactKeys(input,['challengeId','code','currentPassword']);
      if(typeof input.challengeId!=='string'||!ID.test(input.challengeId)||typeof input.code!=='string'||!/^\d{6}$/.test(input.code))throw failure('INVALID_INPUT','请填写本次收到的6位验证码。');
      const result=await request('/api/auth/phone/bind',{method:'POST',body:{challengeId:input.challengeId,code:input.code,currentPassword:passwordInput(input.currentPassword)},unavailableMessage:'短信验证服务尚未开通或暂不可用，未完成手机号验证。'});
      if(result?.phoneVerified!==true||typeof result.phoneMasked!=='string'||!/^[+0-9* ]{7,32}$/.test(result.phoneMasked)||!result.phoneMasked.includes('*'))throw failure('INVALID_RESPONSE','手机号验证结果格式无效。');
      return {phoneVerified:true,phoneMasked:result.phoneMasked};
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
