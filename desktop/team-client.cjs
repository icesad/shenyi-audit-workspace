'use strict';
const taskOriginalsExport=require('../shared/task-originals-export.cjs');
const {createHash}=require('node:crypto');
const {createWechatLogin}=require('./wechat-login.cjs');
const {createDeviceSession}=require('./device-session.cjs');
const {createDeviceReplacement}=require('./device-replacement.cjs');
const {createProjectMaterialsClient}=require('./project-materials-client.cjs');
const {createCollectionWorkspaceClient}=require('./collection-workspace-client.cjs');

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
function teamNameInput(value){if(typeof value!=='string'||!value.isWellFormed())throw failure('INVALID_INPUT','团队名称需要1至80个字符。');const clean=value.normalize('NFKC').trim();if(!clean||[...clean].length>80||/[\p{Cc}\p{Cf}]/u.test(clean))throw failure('INVALID_INPUT','团队名称需要1至80个字符。');return clean;}
function provisioningView(value){
  if(!value||typeof value.id!=='string'||!ID.test(value.id)||typeof value.teamId!=='string'||!ID.test(value.teamId)||typeof value.teamName!=='string'||!value.teamName.isWellFormed()||!value.teamName.trim()||[...value.teamName].length>80||/[\x00-\x1f\x7f]/.test(value.teamName)||typeof value.phoneMasked!=='string'||!/^[+0-9* ]{7,32}$/.test(value.phoneMasked)||!value.phoneMasked.includes('*')||!['pending','approved','rejected','revoked','activated'].includes(value.status)||!Number.isSafeInteger(value.revision)||value.revision<1||!Number.isSafeInteger(value.createdAt)||value.createdAt<0||(value.expiresAt!==null&&(!Number.isSafeInteger(value.expiresAt)||value.expiresAt<value.createdAt)))throw failure('INVALID_RESPONSE','团队审核信息格式无效。');
  return {id:value.id,teamId:value.teamId,teamName:value.teamName,phoneMasked:value.phoneMasked,status:value.status,revision:value.revision,createdAt:value.createdAt,expiresAt:value.expiresAt};
}
function firstAdministratorView(value){
  if(!value||typeof value.teamId!=='string'||!ID.test(value.teamId)||typeof value.teamName!=='string'||!value.teamName.isWellFormed()||!value.teamName.trim()||[...value.teamName].length>80||/[\x00-\x1f\x7f]/.test(value.teamName)||typeof value.phoneMasked!=='string'||!/^[+0-9* ]{7,32}$/.test(value.phoneMasked)||!value.phoneMasked.includes('*')||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=0)throw failure('INVALID_RESPONSE','首管理员邀请信息格式无效。');
  return {teamId:value.teamId,teamName:value.teamName,phoneMasked:value.phoneMasked,expiresAt:value.expiresAt};
}
function recoveryReviewView(value){
  const string=(item,max)=>typeof item==='string'&&item.isWellFormed()&&!!item.trim()&&[...item].length<=max&&!/[\p{Cc}\p{Cf}]/u.test(item);
  if(!value||typeof value.id!=='string'||!ID.test(value.id)||typeof value.teamId!=='string'||!ID.test(value.teamId)||!string(value.teamName,80)||!string(value.displayName,80)||typeof value.phoneMasked!=='string'||!/^[+0-9* ]{7,32}$/.test(value.phoneMasked)||!value.phoneMasked.includes('*')||!['employee','administrator'].includes(value.targetKind)||!['pending','approved','rejected','revoked','consumed','expired'].includes(value.status)||!Number.isSafeInteger(value.revision)||value.revision<1||!Number.isSafeInteger(value.createdAt)||value.createdAt<0||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=value.createdAt)throw failure('INVALID_RESPONSE','恢复审核资料格式无效。');
  return {id:value.id,teamId:value.teamId,teamName:value.teamName,displayName:value.displayName,phoneMasked:value.phoneMasked,targetKind:value.targetKind,status:value.status,revision:value.revision,createdAt:value.createdAt,expiresAt:value.expiresAt};
}
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
function taskMemberView(value){
  if(!value||typeof value.id!=='string'||!ID.test(value.id)||typeof value.displayName!=='string'||!value.displayName.isWellFormed()||!value.displayName.trim()||[...value.displayName].length>80||/[\p{Cc}\p{Cf}]/u.test(value.displayName)||!ROLES.has(value.role))throw failure('INVALID_RESPONSE','任务分工成员资料格式无效。');return {id:value.id,displayName:value.displayName,role:value.role};
}
function taskRevisionInput(value){if(!Number.isSafeInteger(value)||value<0||value>=Number.MAX_SAFE_INTEGER)throw failure('INVALID_INPUT','请刷新任务后再提交分工或退回。');return value;}
function memberText(value){return typeof value==='string'&&value.isWellFormed()&&!!value.trim()&&[...value].length<=80&&!/[\p{Cc}\p{Cf}]/u.test(value);}
function memberView(value,administrator){
  if(!value||typeof value.id!=='string'||!ID.test(value.id)||!memberText(value.displayName)||!['active','disabled'].includes(value.status)||!Number.isSafeInteger(value.revision)||value.revision<0||(administrator?value.role!=='administrator':!ROLES.has(value.role)))throw failure('INVALID_RESPONSE','成员状态格式无效，请刷新后核对。');
  const result={id:value.id,displayName:value.displayName,role:value.role,status:value.status,revision:value.revision};
  if(administrator){if(typeof value.teamId!=='string'||!ID.test(value.teamId)||!memberText(value.teamName))throw failure('INVALID_RESPONSE','管理员团队资料格式无效。');result.teamId=value.teamId;result.teamName=value.teamName;}
  return result;
}
function memberQuery(input,keys){
  exactKeys(input,keys);const limit=input.limit??20,params=new URLSearchParams();
  if(!Number.isSafeInteger(limit)||limit<1||limit>50||input.q!==undefined&&(typeof input.q!=='string'||!input.q.isWellFormed()||input.q.length>80||/[\p{Cc}\p{Cf}]/u.test(input.q)))throw failure('INVALID_INPUT','请使用80个字符以内的姓名搜索，每次最多读取50人。');
  if(input.q!==undefined)params.set('q',input.q);if(input.after!==undefined)params.set('after',id(input.after));if(input.limit!==undefined)params.set('limit',String(limit));return {limit,suffix:params.size?'?'+params:''};
}
function memberPage(data,limit,administrator){
  if(!Array.isArray(data?.members)||data.members.length>limit||typeof data.hasMore!=='boolean'||data.hasMore&&data.members.length!==limit)throw failure('INVALID_RESPONSE','成员列表格式无效，请刷新后核对。');
  const members=data.members.map(value=>memberView(value,administrator));if(new Set(members.map(value=>value.id)).size!==members.length)throw failure('INVALID_RESPONSE','成员列表格式无效，请刷新后核对。');return {members,hasMore:data.hasMore};
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

function createTeamClient({baseUrl = API_BASE, fetchImpl = globalThis.fetch,wechatPolicy,openAuthorization,now=Date.now,deviceIdentity} = {}) {
  if (baseUrl !== API_BASE || typeof fetchImpl !== 'function') throw failure('INVALID_SERVER', '预览版只连接本机审易服务。');
  let token = null, current = null, generation = 0,wechat,device,replacement;
  const projectMigrationInvalidators=new Set();
  const invalidateProjectMigrationSources=()=>{for(const invalidate of projectMigrationInvalidators)try{invalidate();}catch{}};
  const clear = () => { invalidateProjectMigrationSources();replacement?.reset();token = null; current = null; generation++;device?.reset();wechat?.reset(); };
  const snapshot = () => {
    if(!current)return null;const value=structuredClone(current);
    if(device?.required){value.device=device.status();if(!device.isReady())value.memberships=[];}
    return value;
  };
  async function revokeResponseToken(bytes){
    try{const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(typeof data?.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(data.token))await detachedPost('/api/auth/logout',{},data.token);}catch{}
  }
  async function request(route, {method = 'GET', body, authenticated = true, binary = false, unavailableMessage,temporaryBearer,discardSessionOnChange=false,messagesOverride,beforeSend,onDispatch,responseLimit,materialPreviewHead=false} = {}) {
    if(materialPreviewHead&&(method!=='HEAD'||!binary||!/^\/api\/teams\/[A-Za-z0-9_-]+\/projects\/[A-Za-z0-9_-]+\/materials\/files\/[A-Fa-f0-9-]+$/.test(route)))throw failure('INVALID_INPUT','预览响应范围无效。');
    if(responseLimit!==undefined&&(responseLimit!==26*1024*1024||method!=='GET'||binary||!/^\/api\/teams\/[A-Za-z0-9_-]+\/projects\/[A-Za-z0-9_-]+\/materials$/.test(route)))throw failure('INVALID_INPUT','响应范围无效。');
    if (authenticated && !token && !temporaryBearer) throw failure('SIGN_IN_REQUIRED', '请先登录。', 401);
    const at = generation, bearer = temporaryBearer||token,serialized=body===undefined?undefined:JSON.stringify(body),bytes=serialized===undefined?Buffer.alloc(0):Buffer.from(serialized,'utf8');
    const protectedRoute=device?.required&&!device.isBootstrap(method,route);
    if(protectedRoute&&(!authenticated||temporaryBearer))throw failure('INVALID_INPUT','此操作需要当前已证明的设备会话。');
    const signed=protectedRoute?await device.prepare(method,route,bytes):null;
    if(at!==generation)throw failure('SESSION_CHANGED','账号状态已改变，请重新操作。');signed?.assertCurrent();
    beforeSend?.();let response;
    try { onDispatch?.();response = await fetchImpl(API_BASE + route, {method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {'Origin': 'shenyi://app', ...(authenticated ? {Authorization: `Bearer ${bearer}`} : {}), ...(body === undefined ? {} : {'Content-Type': 'application/json'}),...(signed?.headers??{})},
      ...(serialized === undefined ? {} : {body: serialized})}); }
    catch { if (at !== generation) throw failure('SESSION_CHANGED', '账号状态已改变，请重新操作。');signed?.assertCurrent();if(!temporaryBearer||temporaryBearer===token)device?.pause();throw failure('SERVICE_UNAVAILABLE', protectedRoute&&!['GET','HEAD'].includes(method)?'已发操作结果未确认，业务已暂停；联网后请先核对结果，再决定是否重新操作。':'无法连接本机团队服务，业务已暂停；联网后请重新核验。'); }
    if (at !== generation) {
      if(discardSessionOnChange&&response.ok)try{await revokeResponseToken(await boundedBytes(response,1024*1024));}catch{}
      throw failure('SESSION_CHANGED', '账号状态已改变，请重新操作。');
    }
    signed?.assertCurrent();
    if (response.status === 401 && authenticated && bearer===token) { clear(); throw failure('SIGN_IN_REQUIRED', '登录已失效，请重新登录。', 401); }
    if (!response.ok) {
      const messages = {400:'提交内容无效，请检查后重试。',401:'账号或密码无效，请检查后重试。',403:'当前操作未获授权。',404:'任务不存在或当前账号无权访问。',409:'任务状态或版本已更新，请刷新后重试。',413:'资料超过12 MiB，请选择较小的文件。',429:'尝试过于频繁，请稍后重试。'};
      if(device?.required&&signed&&!(method==='HEAD'&&response.status===404)){
        let code;try{const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(response,65536)));code=payload?.error?.code;}catch{if(at!==generation)throw failure('SESSION_CHANGED','账号状态已改变，请重新操作。');signed.assertCurrent();device.pause();throw failure('SERVICE_UNAVAILABLE','服务响应无法确认，业务已暂停，请联网后核对结果。');}
        if(at!==generation)throw failure('SESSION_CHANGED','账号状态已改变，请重新操作。');signed.assertCurrent();
        if(['DEVICE_PROOF_REQUIRED','DEVICE_BODY_MISMATCH','DEVICE_REQUEST_REPLAY','DEVICE_PROOF_LIMIT','DEVICE_STATE_CHANGED'].includes(code)){device.pause();throw failure(code,'设备业务状态需要重新在线核验；已发操作请先核对结果。',response.status);}
      }
      // Do not forward arbitrary provider messages, stack traces, or response bodies.
      throw failure(`HTTP_${response.status}`, response.status === 503 && unavailableMessage ? unavailableMessage : messagesOverride?.[response.status]||messages[response.status] || '团队服务暂时无法完成操作。', response.status);
    }
    let responseBytes;
    try{responseBytes=await boundedBytes(response, responseLimit??(binary ? MAX_FILE_BYTES : 1024 * 1024));}catch(cause){if(at!==generation)throw failure('SESSION_CHANGED','账号状态已改变，请重新操作。');signed?.assertCurrent();if(!temporaryBearer||temporaryBearer===token)device?.pause();if(protectedRoute&&!['GET','HEAD'].includes(method))throw failure('SERVICE_UNAVAILABLE','已发操作结果未确认，业务已暂停；联网后请先核对结果，再决定是否重新操作。');throw cause instanceof ClientError?cause:failure('SERVICE_UNAVAILABLE','服务响应未读完，业务已暂停，请联网后核对结果。');}
    if (at !== generation) {if(discardSessionOnChange)await revokeResponseToken(responseBytes);throw failure('SESSION_CHANGED', '账号状态已改变，请重新操作。');}signed?.assertCurrent();
    if(materialPreviewHead)return {bytes:responseBytes,projectRevision:response.headers.get('x-project-revision'),materialRevision:response.headers.get('x-material-revision'),sha256:response.headers.get('x-content-sha256'),byteLength:response.headers.get('content-length')};
    if (binary) return {bytes:responseBytes, contentDisposition: response.headers.get('content-disposition') || ''};
    try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(responseBytes)); }
    catch {if(!temporaryBearer||temporaryBearer===token)device?.pause();throw failure('INVALID_RESPONSE',protectedRoute&&!['GET','HEAD'].includes(method)?'已发操作结果未确认，业务已暂停；联网后请先核对结果，再决定是否重新操作。':'团队服务返回格式无效。'); }
  }
  async function detachedPost(route,body,bearer){
    // Only closure-created cancel/logout paths use this cleanup transport. It
    // may outlive generation changes; it never adopts or exposes a response.
    const response=await fetchImpl(API_BASE+route,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Origin:'shenyi://app','Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{})},body:JSON.stringify(body)});
    await response.body?.cancel();
  }
  device=createDeviceSession({identity:deviceIdentity,now,error:failure,getAccount:()=>({token,current,generation}),clearAccount:clear,onContextChange:invalidateProjectMigrationSources,
    adopt:data=>{const value=cleanSession(data);if(typeof data.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.token))throw failure('INVALID_RESPONSE','账号服务返回格式无效。');current=value;token=data.token;generation++;return snapshot();},
    bootstrap:(route,options={})=>{const {token:bearer,minted,...settings}=options;return request(route,{...settings,...(bearer?{temporaryBearer:bearer}:{}),discardSessionOnChange:minted===true});},
    protectedRequest:route=>request(route),revoke:bearer=>detachedPost('/api/auth/logout',{},bearer)});
  replacement=createDeviceReplacement({identity:deviceIdentity,getAccount:()=>({token,current,generation}),getContext:()=>device.getReplacementContext(),clearAccount:clear,error:failure,
    bootstrap:(route,options={})=>{const {token:bearer,minted,...settings}=options;return request(route,{...settings,...(bearer?{temporaryBearer:bearer}:{}),discardSessionOnChange:minted===true});},
    reviewRequest:(route,options={})=>request(route,{...options,messagesOverride:{403:'当前密码验证未通过或换机审核未获授权。',404:'无法访问该换机申请。',409:'换机申请、设备或授权已改变，请刷新核对。',410:'本次换机申请或挑战已过期，请刷新核对。'}}),
    adopt:(data,expected,assertCurrent)=>device.adoptReplacementSession(data,expected,assertCurrent),revoke:bearer=>detachedPost('/api/auth/logout',{},bearer)});
  async function finalizeSession(data,external=()=>{},receiveReceipt){
    external();if(typeof data?.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.token)||device.required&&Buffer.from(data.token,'base64url').toString('base64url')!==data.token)throw failure('INVALID_RESPONSE','账号服务返回格式无效。');
    const value=cleanSession(data);current=value;token=data.token;generation++;const at=generation,bootstrap=data.token;
    // The OAuth caller keeps this private receipt until its result is delivered.
    // Cancellation can clear the installed result synchronously, while cleanup
    // revokes only this login's token even if a later account has replaced it.
    let receiptToken=bootstrap,receiptGeneration=at,cleanup;
    const receipt={assertCurrent(){external();if(receiptGeneration!==generation||receiptToken!==token)throw failure('SESSION_CHANGED','账号状态已改变，请重新操作。');},rollback(){if(!cleanup){if(receiptGeneration===generation&&receiptToken===token)clear();cleanup=detachedPost('/api/auth/logout',{},receiptToken).catch(()=>{});}return cleanup;}};
    receiveReceipt?.(receipt);
    if(!device.required)return snapshot();
    try{await device.finalize(()=>{if(at!==generation||token!==bootstrap)throw failure('SESSION_CHANGED','账号状态已改变，请重新操作。');external();},minted=>{receiptToken=minted;receiptGeneration=generation;});receipt.assertCurrent();return snapshot();}
    catch(cause){if(cause.code==='SESSION_CHANGED')await receipt.rollback();throw cause;}
  }
  wechat=createWechatLogin({policy:wechatPolicy,openAuthorization,request,now,error:failure,getGeneration:()=>generation,isSignedIn:()=>!!token,
    cancelRemote:(route,body)=>detachedPost(route,body),revokeTemporary:bearer=>detachedPost('/api/auth/logout',{},bearer),
    adoptSession:(data,external,receiveReceipt)=>finalizeSession(data,external,receiveReceipt)});
  const onboardingRequest=(route,options)=>request(route,{...options,unavailableMessage:'员工邀请或手机号验证服务尚未开通或暂不可用。',messagesOverride:{400:'验证内容无效，请核对后重试。',404:'邀请码或手机号无效，或邀请已失效；管理操作也可能未获授权。',409:'当前账号或邀请状态不适用于激活，请联系管理员核对。',410:'本次验证已过期，请重新获取。'}});
  const sessionsRequest=(route,options)=>request(route,{...options,messagesOverride:{403:'当前密码验证未通过，请核对后重试。',404:'无法访问该登录会话，请刷新列表。',409:'账号或登录状态已改变，请刷新后重试。'}});
  const provisioningRequest=(route,options)=>request(route,{...options,unavailableMessage:'团队开通或手机号验证服务尚未开通或暂不可用。',messagesOverride:{400:'团队开通资料无效，请核对后重试。',403:'当前密码验证未通过或操作未获授权。',404:'无法访问本次开通申请或邀请，请核对后重试。',409:'申请、账号或授权状态已改变，请刷新后核对。',410:'本次验证已过期，请重新获取。'}});
  async function bulkRevokeSessions(input,all){
    exactKeys(input,['currentPassword']);const data=await sessionsRequest('/api/auth/sessions/'+(all?'revoke-all':'revoke-others'),{method:'POST',body:{currentPassword:securityPasswordInput(input.currentPassword)}});
    if(!Number.isSafeInteger(data?.revokedCount)||data.revokedCount<(all?1:0)||data.signedOut!==all)throw failure('INVALID_RESPONSE','登录退出结果格式无效。');
    if(data.signedOut)clear();return {revokedCount:data.revokedCount,signedOut:data.signedOut};
  }
  const invitationPath=teamId=>'/api/teams/'+id(teamId)+'/employee-invitations';
  function activationTarget(input,keys){exactKeys(input,keys);if(token)throw failure('SIGN_OUT_REQUIRED','请先退出当前账号再激活受邀账号。');return {invitationCode:invitationCodeInput(input.invitationCode),phone:phoneInput(input.phone)};}
  function path(teamId, taskId) { return `/api/teams/${id(teamId)}/collection/tasks${taskId ? '/' + id(taskId) : ''}`; }
  const membersRequest=(route,options)=>request(route,{...options,messagesOverride:{400:'停用资料无效，请核对后重试。',403:'当前密码验证未通过，请核对后重试。',404:'无法访问该成员或当前操作未获授权。',409:'成员、分工或授权状态已改变，请刷新列表后核对。'}});
  async function disableMember(input,administrator){
    exactKeys(input,['teamId','userId','revision','currentPassword']);if(!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER)throw failure('INVALID_INPUT','请刷新成员状态后再停用。');
    const route='/api/teams/'+id(input.teamId)+'/'+(administrator?'administrators':'business-members')+'/'+id(input.userId)+'/disable';
    const data=await membersRequest(route,{method:'POST',body:{revision:input.revision,currentPassword:securityPasswordInput(input.currentPassword)}});if(data?.disabled!==true)throw failure('INVALID_RESPONSE','无法确认停用结果，请刷新成员列表核对。');return {disabled:true};
  }
  const businessRoleRequest=(route,options={})=>{if(!device.required)throw failure('DEVICE_NOT_READY','职级管理需要当前已持钥核验的业务登录。');device.guard();return request(route,{...options,messagesOverride:{403:'当前密码验证未通过或职级调整未获授权。',404:'无法访问该员工或当前操作未获授权。',409:'员工职级、版本或授权已改变，请刷新列表核对。'}});};
  function businessRoleMember(value){if(!value||Object.keys(value).length!==5||!['id','displayName','role','status','revision'].every(key=>Object.hasOwn(value,key))||value.status!=='active')throw failure('INVALID_RESPONSE','员工职级资料格式无效，请刷新核对。');return memberView(value,false);}
  const administratorBusinessRoleRequest=(route,options={})=>{if(!device.required)throw failure('DEVICE_NOT_READY','管理员业务兼任审核需要当前已持钥核验的业务登录。');device.guard();return request(route,{...options,messagesOverride:{403:'当前密码验证未通过或管理员兼任审核未获授权。',404:'无法访问该管理员或当前审核未获授权。',409:'管理员、业务兼任或授权版本已改变，请刷新核对。'}});};
  function administratorBusinessRoleMember(value){if(!responseKeys(value,['id','displayName','teamId','teamName','role','status','revision','approvalStatus'])||!ID.test(value.id)||!ID.test(value.teamId)||!memberText(value.displayName)||!memberText(value.teamName)||value.status!=='active'||value.role!==null&&!ROLES.has(value.role)||!Number.isSafeInteger(value.revision)||value.revision<0||!['unreviewed','approved','withdrawn','invalidated'].includes(value.approvalStatus)||value.approvalStatus==='approved'&&value.role===null||value.approvalStatus==='withdrawn'&&value.role!==null)throw failure('INVALID_RESPONSE','管理员业务兼任资料格式无效，请刷新核对。');return {...value};}
  const projectRequest=(route,options={})=>{if(!device.required)throw failure('DEVICE_NOT_READY','项目采集需要当前已持钥核验的业务登录。');device.guard();return request(route,{...options,messagesOverride:{403:'当前密码验证未通过或项目操作未获授权。',404:'无法访问该项目、任务或资料。',409:'项目、员工或授权版本已改变，请刷新核对。'}});};
  const responseKeys=(value,keys)=>!!value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  const projectText=(value,max,empty=false)=>typeof value==='string'&&value.isWellFormed()&&(empty||!!value.trim())&&[...value].length<=max&&!/[\p{Cc}\p{Cf}]/u.test(value);
  const projectInstructions=value=>typeof value==='string'&&value.isWellFormed()&&[...value].length<=4000&&!/[\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value);
  const projectRevision=value=>Number.isSafeInteger(value)&&value>=0;
  const projectCollectionPath=input=>'/api/teams/'+id(input.teamId)+'/projects';
  const projectPath=input=>projectCollectionPath(input)+'/'+id(input.projectId);
  function projectQuery(input,keys,qMax=100){exactKeys(input,keys);const params=new URLSearchParams(),limit=input.limit??20;if(!Number.isSafeInteger(limit)||limit<1||limit>50||input.q!==undefined&&!projectText(input.q,qMax,true))throw failure('INVALID_INPUT','项目查询或分页参数无效。');if(input.q!==undefined)params.set('q',input.q);if(input.after!==undefined)params.set('after',id(input.after));if(input.limit!==undefined)params.set('limit',String(limit));return {limit,suffix:params.size?'?'+params:''};}
  function projectView(value){const marked=!!value&&Object.hasOwn(value,'kind'),keys=['id','title','status','revision','canRead','canManageAccess','canCreateTask','canReview',...(marked?['kind']:[])];if(!responseKeys(value,keys)||marked&&value.kind!=='collection-workspace'||!ID.test(value.id)||!projectText(value.title,300)||!['active','frozen'].includes(value.status)||!projectRevision(value.revision)||value.revision<1||!['canRead','canManageAccess','canCreateTask','canReview'].every(key=>typeof value[key]==='boolean')||!value.canRead&&(value.canCreateTask||value.canReview)||value.status==='frozen'&&(value.canManageAccess||value.canCreateTask))throw failure('INVALID_RESPONSE','项目能力或版本格式无效，请刷新核对。');return {...value};}
  function projectTaskView(value){if(!responseKeys(value,['id','title','instructions','status','revision'])||!ID.test(value.id)||!projectText(value.title,160)||!projectInstructions(value.instructions)||!['open','submitted','returned','closed'].includes(value.status)||!projectRevision(value.revision))throw failure('INVALID_RESPONSE','项目任务格式无效，请刷新核对。');return {...value};}
  function projectMemberView(value){if(!responseKeys(value,['id','displayName','role','status','revision','read','manage','review'])||!ID.test(value.id)||!memberText(value.displayName)||!['manager','partner'].includes(value.role)||value.status!=='active'||!projectRevision(value.revision)||!['read','manage','review'].every(key=>typeof value[key]==='boolean')||!value.read&&(value.manage||value.review))throw failure('INVALID_RESPONSE','项目授权对象格式无效，请刷新核对。');return {...value};}
  function projectSubmissionView(value){if(!responseKeys(value,['id','attachmentId','filename','sha256','byteLength','createdAt','submittedBy'])||!ID.test(value.id)||!ID.test(value.attachmentId)||!projectText(value.filename,240)||!/^[a-f0-9]{64}$/.test(value.sha256)||!Number.isSafeInteger(value.byteLength)||value.byteLength<0||value.byteLength>MAX_FILE_BYTES||!Number.isSafeInteger(value.createdAt)||value.createdAt<0||!responseKeys(value.submittedBy,['id','displayName'])||!ID.test(value.submittedBy.id)||!memberText(value.submittedBy.displayName))throw failure('INVALID_RESPONSE','项目资料核对记录格式无效，请刷新核对。');return {...value,submittedBy:{...value.submittedBy}};}
  function projectPage(data,key,limit,view){if(!responseKeys(data,[key,'hasMore'])||!Array.isArray(data[key])||data[key].length>limit||typeof data.hasMore!=='boolean'||data.hasMore&&data[key].length!==limit)throw failure('INVALID_RESPONSE','项目列表格式无效，请刷新核对。');const rows=data[key].map(view);if(new Set(rows.map(value=>value.id)).size!==rows.length)throw failure('INVALID_RESPONSE','项目列表包含重复记录，请刷新核对。');return {[key]:rows,hasMore:data.hasMore};}
  function projectFilePath(input){exactKeys(input,['teamId','projectId','taskId','submissionId']);return projectPath(input)+'/tasks/'+id(input.taskId)+'/submissions/'+id(input.submissionId)+'/file';}
  async function taskExportPlan(input,project){
    exactKeys(input,project?['teamId','projectId','taskId','revision','projectRevision','submissionIds']:['teamId','taskId','revision','submissionIds']);
    if(!device.required)throw failure('DEVICE_NOT_READY','原件导出需要当前已持钥核验的业务登录。');
    device.guard();
    if(!Number.isSafeInteger(input.revision)||input.revision<0||project&&(!Number.isSafeInteger(input.projectRevision)||input.projectRevision<1))throw failure('INVALID_INPUT','请刷新当前任务和项目版本后再导出。');
    let ids;try{ids=taskOriginalsExport.selectionIds(input.submissionIds);}catch{throw failure('INVALID_INPUT','请明确选择1至20份不重复的当前提交记录。');}
    const team=id(input.teamId),task=id(input.taskId),projectId=project?id(input.projectId):null,expectedUser=current?.account.id;
    const route=project?'/api/teams/'+team+'/projects/'+projectId+'/tasks/'+task+'/export-plan':path(team,task)+'/export-plan';
    const params=new URLSearchParams({revision:String(input.revision),...(project?{projectRevision:String(input.projectRevision)}:{}),ids:ids.join(',')});
    let plan;try{plan=taskOriginalsExport.validatePlan(await request(route+'?'+params,{messagesOverride:{413:'导出原件每份最多12 MiB，所选原件合计不超过64 MiB，请减少本次选择。'}}));}catch(error){if(error instanceof ClientError)throw error;throw failure('INVALID_RESPONSE','原件导出清单格式无效，请刷新后核对。');}
    const scope=plan.manifest.scope,files=plan.manifest.files;
    if(scope.kind!==(project?'project-review':'own')||scope.teamId!==team||scope.taskId!==task||plan.manifest.task.id!==task||plan.manifest.task.revision!==input.revision||project&&(scope.projectId!==projectId||scope.projectRevision!==input.projectRevision)||!project&&scope.userId!==expectedUser||files.length!==ids.length||files.some((file,index)=>file.id!==ids[index]))throw failure('INVALID_RESPONSE','原件导出清单与所选任务或记录不一致，请刷新核对。');
    return plan;
  }
  const projectMigrationRequest=(route,options={})=>{if(!device.required)throw failure('DEVICE_NOT_READY','旧项目归属审核需要当前已持钥核验的业务登录。');device.guard();return request(route,{...options,messagesOverride:{400:'来源或审核内容无效，请重新预检后核对。',403:'当前密码验证未通过或旧项目审核未获授权。',404:'无法访问该团队、负责人或审核查询记录。',409:'来源项目、编号、负责人或审核状态已改变，请刷新核对；不要重复提交。',413:'来源文件或审批内容超过大小限制，未裁剪来源。'}});};
  function migrationQuery(input,owner){exactKeys(input,owner?['teamId','q','after','limit']:['q','after','limit']);const params=new URLSearchParams(),limit=input.limit??20;if(!Number.isSafeInteger(limit)||limit<1||limit>50||input.q!==undefined&&(typeof input.q!=='string'||!input.q.isWellFormed()||[...input.q].length>80||/[\p{Cc}\p{Cf}]/u.test(input.q)))throw failure('INVALID_INPUT','请使用80个字符以内的查询，每次最多读取50项。');if(input.q!==undefined)params.set('q',input.q);if(input.after!==undefined)params.set('after',id(input.after));if(input.limit!==undefined)params.set('limit',String(limit));return {limit,suffix:params.size?'?'+params:''};}
  function migrationPage(data,limit,owner){if(!responseKeys(data,['items','total','hasMore'])||!Array.isArray(data.items)||data.items.length>limit||!Number.isSafeInteger(data.total)||data.total<0||data.total<data.items.length+(data.hasMore?1:0)||typeof data.hasMore!=='boolean'||data.hasMore&&data.items.length!==limit)throw failure('INVALID_RESPONSE','旧项目审核候选列表格式无效，请刷新核对。');const items=data.items.map(item=>{if(owner){if(!responseKeys(item,['id','displayName','role','revision'])||!ID.test(item.id)||!memberText(item.displayName)||!['manager','partner'].includes(item.role)||!Number.isSafeInteger(item.revision)||item.revision<0)throw failure('INVALID_RESPONSE','首位项目负责人资料格式无效。');}else if(!responseKeys(item,['id','name'])||!ID.test(item.id)||!memberText(item.name))throw failure('INVALID_RESPONSE','目标团队资料格式无效。');return {...item};});if(new Set(items.map(item=>item.id)).size!==items.length)throw failure('INVALID_RESPONSE','审核候选包含重复记录。');return {items,total:data.total,hasMore:data.hasMore};}
  function migrationReceipt(value,requestId){if(!responseKeys(value,['requestId','projectId','teamId','ownerUserId','businessNumber','sourceSha256','read','manage','review','registeredAt'])||value.requestId!==requestId||!SESSION_ID.test(value.requestId)||!SESSION_ID.test(value.projectId)||!ID.test(value.teamId)||!ID.test(value.ownerUserId)||!projectText(value.businessNumber,160)||!/^[a-f0-9]{64}$/.test(value.sourceSha256)||!['read','manage','review'].every(key=>typeof value[key]==='boolean')||!value.read&&(value.manage||value.review)||!Number.isSafeInteger(value.registeredAt)||value.registeredAt<0)throw failure('INVALID_RESPONSE','旧项目登记回执格式无效，请按查询编号核对结果。');return {...value};}
  const materials=createProjectMaterialsClient({request,failure,ensureDevice:()=>{if(!device.required)throw failure('DEVICE_NOT_READY','资料清单需要当前已持钥核验的业务登录。');device.guard();}});
  return Object.freeze({
    ...materials,
    async getProjectMigrationAccess(input){if(input!==undefined)throw failure('INVALID_INPUT','审核能力不接受额外参数。');const data=await projectMigrationRequest('/api/auth/project-migration/access');if(!responseKeys(data,['canReview'])||typeof data.canReview!=='boolean')throw failure('INVALID_RESPONSE','旧项目审核能力格式无效。');return {canReview:data.canReview};},
    async listProjectMigrationTeams(input={}){const query=migrationQuery(input,false);return migrationPage(await projectMigrationRequest('/api/project-migrations/teams'+query.suffix),query.limit,false);},
    async listProjectMigrationOwners(input){const query=migrationQuery(input,true);return migrationPage(await projectMigrationRequest('/api/project-migrations/teams/'+id(input.teamId)+'/owners'+query.suffix),query.limit,true);},
    async registerProjectMigration(input,{assertCurrent=()=>{},onDispatch=()=>{}}={}){exactKeys(input,['requestId','source','sourceSha256','teamId','ownerUserId','ownerRevision','read','manage','review','currentPassword']);if(!SESSION_ID.test(input.requestId)||!Number.isSafeInteger(input.ownerRevision)||input.ownerRevision<0||input.ownerRevision>=Number.MAX_SAFE_INTEGER||!['read','manage','review'].every(key=>typeof input[key]==='boolean')||!input.read&&(input.manage||input.review))throw failure('INVALID_INPUT','请核对首位负责人、版本及明确的初始权限。');const codec=require('../dist/legacy-project-source.js');let source;try{source=codec.validate(input.source);if(createHash('sha256').update(codec.encode(source)).digest('hex')!==input.sourceSha256)throw Error();}catch{throw failure('INVALID_INPUT','旧项目来源或SHA无法确认，请重新选择文件预检。');}const teamId=id(input.teamId),ownerUserId=id(input.ownerUserId),body={requestId:input.requestId,source,sourceSha256:input.sourceSha256,teamId,ownerUserId,ownerRevision:input.ownerRevision,read:input.read,manage:input.manage,review:input.review,currentPassword:securityPasswordInput(input.currentPassword)};assertCurrent();const value=migrationReceipt(await projectMigrationRequest('/api/project-migrations',{method:'POST',body,beforeSend:assertCurrent,onDispatch}),input.requestId);assertCurrent();if(value.projectId!==source.initiation.quoteId||value.teamId!==teamId||value.ownerUserId!==ownerUserId||value.businessNumber!==source.numbering.businessNumber||value.sourceSha256!==input.sourceSha256||['read','manage','review'].some(key=>value[key]!==input[key]))throw failure('INVALID_RESPONSE','登记回执与本次来源或审核选择不一致，请按查询编号核对。');return value;},
    async getProjectMigrationReceipt(input){exactKeys(input,['requestId']);if(!SESSION_ID.test(input.requestId))throw failure('INVALID_INPUT','审核查询编号无效。');return migrationReceipt(await projectMigrationRequest('/api/project-migrations/receipts/'+input.requestId),input.requestId);},
    onProjectMigrationContextChange(listener){if(typeof listener!=='function')throw failure('INVALID_INPUT','来源清理机制无效。');projectMigrationInvalidators.add(listener);return()=>projectMigrationInvalidators.delete(listener);},
    async getTaskExportPlan(input){return taskExportPlan(input,false);},
    async getProjectTaskExportPlan(input){return taskExportPlan(input,true);},
    async getProjectAccess(input){if(input!==undefined)throw failure('INVALID_INPUT','项目能力不接受额外参数。');const data=await projectRequest('/api/auth/project-access');if(!responseKeys(data,['teams'])||!Array.isArray(data.teams)||data.teams.length>50)throw failure('INVALID_RESPONSE','项目团队能力格式无效。');const teams=data.teams.map(value=>{if(!responseKeys(value,['teamId','teamName'])||!ID.test(value.teamId)||!memberText(value.teamName))throw failure('INVALID_RESPONSE','项目团队格式无效。');return {...value};});if(new Set(teams.map(value=>value.teamId)).size!==teams.length)throw failure('INVALID_RESPONSE','项目团队格式无效。');return {teams};},
    async listProjects(input){const {limit,suffix}=projectQuery(input,['teamId','q','after','limit']);return projectPage(await projectRequest(projectCollectionPath(input)+suffix),'projects',limit,projectView);},
    async getProject(input){exactKeys(input,['teamId','projectId']);const data=await projectRequest(projectPath(input));if(!responseKeys(data,['project']))throw failure('INVALID_RESPONSE','项目详情格式无效。');const project=projectView(data.project);if(project.id!==input.projectId)throw failure('INVALID_RESPONSE','项目详情归属不一致。');return {project};},
    async listProjectMembers(input){const {limit,suffix}=projectQuery(input,['teamId','projectId','q','after','limit'],80);return projectPage(await projectRequest(projectPath(input)+'/members'+suffix),'members',limit,projectMemberView);},
    async changeProjectAccess(input){exactKeys(input,['teamId','projectId','revision','userId','memberRevision','read','manage','review','currentPassword','confirmed']);if(input.confirmed!==true||!projectRevision(input.revision)||input.revision<1||input.revision>=Number.MAX_SAFE_INTEGER||!projectRevision(input.memberRevision)||input.memberRevision>=Number.MAX_SAFE_INTEGER||!['read','manage','review'].every(key=>typeof input[key]==='boolean')||!input.read&&(input.manage||input.review))throw failure('INVALID_INPUT','请核对项目、员工、版本及本次授权确认。');const data=await projectRequest(projectPath(input)+'/access',{method:'POST',body:{revision:input.revision,userId:id(input.userId),memberRevision:input.memberRevision,read:input.read,manage:input.manage,review:input.review,currentPassword:securityPasswordInput(input.currentPassword)}});if(!responseKeys(data,['changed','revision'])||data.changed!==true||!projectRevision(data.revision)||data.revision<=input.revision)throw failure('INVALID_RESPONSE','无法确认项目授权结果，请刷新核对。');return {changed:true,revision:data.revision};},
    async listProjectTasks(input){const {limit,suffix}=projectQuery(input,['teamId','projectId','q','after','limit']);return projectPage(await projectRequest(projectPath(input)+'/tasks'+suffix),'tasks',limit,projectTaskView);},
    async createProjectTask(input){exactKeys(input,['teamId','projectId','revision','title','instructions','confirmed']);if(input.confirmed!==true||!projectRevision(input.revision)||input.revision<1||input.revision>=Number.MAX_SAFE_INTEGER||!projectText(input.title,160)||!projectInstructions(input.instructions))throw failure('INVALID_INPUT','请填写有效的任务标题、说明并明确确认创建。');const title=input.title.trim(),instructions=input.instructions,data=await projectRequest(projectPath(input)+'/tasks',{method:'POST',body:{revision:input.revision,title,instructions}});if(!responseKeys(data,['task','revision'])||!projectRevision(data.revision)||data.revision<=input.revision)throw failure('INVALID_RESPONSE','无法确认任务创建结果，请刷新项目核对。');const task=projectTaskView(data.task);if(!SESSION_ID.test(task.id)||task.status!=='open'||task.revision!==0||task.title!==title||task.instructions!==instructions)throw failure('INVALID_RESPONSE','新任务返回资料不一致，请刷新核对。');return {task,revision:data.revision};},
    async listProjectSubmissions(input){const {limit,suffix}=projectQuery(input,['teamId','projectId','taskId','after','limit']);return projectPage(await projectRequest(projectPath(input)+'/tasks/'+id(input.taskId)+'/submissions'+suffix),'submissions',limit,projectSubmissionView);},
    async getProjectSubmissionFile(input){return projectRequest(projectFilePath(input),{binary:true});},
    async authorizeProjectSubmissionDownload(input){const data=await projectRequest(projectFilePath(input),{method:'HEAD',binary:true});if(data.bytes.length!==0)throw failure('INVALID_RESPONSE','无法确认原件保存权限，请刷新核对。');return {canDownload:true};},
    async getAdministratorBusinessRoleAccess(input){if(input!==undefined)throw failure('INVALID_INPUT','管理员兼任审核权限不接受额外参数。');const data=await administratorBusinessRoleRequest('/api/auth/administrator-business-role/access');if(!responseKeys(data,['canReview'])||typeof data.canReview!=='boolean')throw failure('INVALID_RESPONSE','管理员兼任审核权限格式无效。');return {canReview:data.canReview};},
    async listAdministratorBusinessRoles(input){exactKeys(input,['q','after','limit']);const params=new URLSearchParams(),limit=input.limit??20;if(!Number.isSafeInteger(limit)||limit<1||limit>50||input.q!==undefined&&(typeof input.q!=='string'||!input.q.isWellFormed()||[...input.q].length>80||/[\p{Cc}\p{Cf}]/u.test(input.q)))throw failure('INVALID_INPUT','请使用80个字符以内的管理员姓名搜索，每次最多读取50人。');if(input.q!==undefined)params.set('q',input.q);if(input.after!==undefined)params.set('after',id(input.after));if(input.limit!==undefined)params.set('limit',String(limit));const data=await administratorBusinessRoleRequest('/api/administrator-business-roles'+(params.size?'?'+params:''));if(!responseKeys(data,['members','hasMore'])||!Array.isArray(data.members)||data.members.length>limit||typeof data.hasMore!=='boolean'||data.hasMore&&data.members.length!==limit)throw failure('INVALID_RESPONSE','管理员业务兼任列表格式无效，请刷新核对。');const members=data.members.map(administratorBusinessRoleMember);if(new Set(members.map(value=>value.id)).size!==members.length)throw failure('INVALID_RESPONSE','管理员业务兼任列表含重复记录，请刷新核对。');return {members,hasMore:data.hasMore};},
    async changeAdministratorBusinessRole(input){exactKeys(input,['userId','revision','role','currentPassword','confirmed']);if(input.confirmed!==true||input.role!==null&&!ROLES.has(input.role)||!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER)throw failure('INVALID_INPUT','请核对管理员、目标职级或收回、当前版本，并明确确认收回旧业务权限。');const data=await administratorBusinessRoleRequest('/api/administrator-business-roles/'+id(input.userId),{method:'POST',body:{revision:input.revision,role:input.role,currentPassword:securityPasswordInput(input.currentPassword)}});if(!responseKeys(data,['changed','role','revision'])||data.changed!==true||data.role!==input.role||!Number.isSafeInteger(data.revision)||data.revision<=input.revision)throw failure('INVALID_RESPONSE','无法确认管理员兼任审核结果，请刷新列表核对。');return {changed:true,role:data.role,revision:data.revision};},
    async getBusinessRoleManagementAccess(input){
      if(input!==undefined)throw failure('INVALID_INPUT','职级管理权限不接受额外参数。');const data=await businessRoleRequest('/api/auth/business-role-management/access');
      if(!data||Object.keys(data).length!==1||!Array.isArray(data.teams)||data.teams.length>50)throw failure('INVALID_RESPONSE','职级管理权限状态无效。');const teams=data.teams.map(value=>{if(!value||Object.keys(value).length!==2||!ID.test(value.teamId)||!memberText(value.teamName))throw failure('INVALID_RESPONSE','职级管理团队资料无效。');return {teamId:value.teamId,teamName:value.teamName};});if(new Set(teams.map(value=>value.teamId)).size!==teams.length)throw failure('INVALID_RESPONSE','职级管理团队资料无效。');return {teams};
    },
    async listBusinessRoleMembers(input){
      const {limit,suffix}=memberQuery(input,['teamId','q','after','limit']),data=await businessRoleRequest('/api/teams/'+id(input.teamId)+'/business-role-members'+suffix);
      if(!data||Object.keys(data).length!==2||!Array.isArray(data.members)||data.members.length>limit||typeof data.hasMore!=='boolean'||data.hasMore&&data.members.length!==limit)throw failure('INVALID_RESPONSE','员工职级列表格式无效，请刷新核对。');const members=data.members.map(businessRoleMember);if(new Set(members.map(value=>value.id)).size!==members.length)throw failure('INVALID_RESPONSE','员工职级列表格式无效，请刷新核对。');return {members,hasMore:data.hasMore};
    },
    async changeBusinessRole(input){
      exactKeys(input,['teamId','userId','revision','role','currentPassword','confirmed']);if(input.confirmed!==true||!ROLES.has(input.role)||!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER)throw failure('INVALID_INPUT','请核对员工、新职级、当前版本并明确确认收回旧权限。');
      const data=await businessRoleRequest('/api/teams/'+id(input.teamId)+'/business-role-members/'+id(input.userId)+'/role',{method:'POST',body:{revision:input.revision,role:input.role,currentPassword:securityPasswordInput(input.currentPassword)}});
      if(!data||Object.keys(data).length!==3||data.changed!==true||data.role!==input.role||!Number.isSafeInteger(data.revision)||data.revision<=input.revision)throw failure('INVALID_RESPONSE','无法确认职级调整结果，请刷新员工列表核对。');return {changed:true,role:data.role,revision:data.revision};
    },
    getDeviceStatus(input){if(input!==undefined)throw failure('INVALID_INPUT','设备状态不接受额外参数。');return device.status();},
    async enrollDevice(input){await device.enroll(input);return snapshot();},
    async reconnectDevice(input){if(input!==undefined)throw failure('INVALID_INPUT','设备续接不接受额外参数。');await device.reconnect();return snapshot();},
    getDeviceReplacementStatus:input=>replacement.getStatus(input),
    requestDeviceReplacement:input=>replacement.request(input),
    withdrawDeviceReplacement:input=>replacement.withdraw(input),
    activateDeviceReplacement:(input,receiveReceipt)=>replacement.activate(input,receiveReceipt),
    getDeviceReplacementReviewAccess:input=>replacement.getReviewAccess(input),
    listDeviceReplacementReviews:input=>replacement.listReviews(input),
    reviewDeviceReplacement:input=>replacement.review(input),
    checkDeviceConnection:()=>device.check(),
    pauseDeviceConnection:()=>device.pause(),
    async getMemberManagementAccess(input){
      if(input!==undefined)throw failure('INVALID_INPUT','成员管理权限不接受额外参数。');const data=await membersRequest('/api/auth/member-management/access');
      if(!Array.isArray(data?.teams)||data.teams.length>100||typeof data.canReviewAdministrators!=='boolean')throw failure('INVALID_RESPONSE','成员管理权限状态无效。');
      const teams=data.teams.map(team=>{if(typeof team?.teamId!=='string'||!ID.test(team.teamId)||!memberText(team.teamName))throw failure('INVALID_RESPONSE','成员管理团队格式无效。');return {teamId:team.teamId,teamName:team.teamName};});if(new Set(teams.map(team=>team.teamId)).size!==teams.length)throw failure('INVALID_RESPONSE','成员管理团队格式无效。');return {teams,canReviewAdministrators:data.canReviewAdministrators};
    },
    async listTeamBusinessMembers(input){const {limit,suffix}=memberQuery(input,['teamId','q','after','limit']);return memberPage(await membersRequest('/api/teams/'+id(input.teamId)+'/business-members'+suffix),limit,false);},
    async listTeamAdministrators(input={}){const {limit,suffix}=memberQuery(input,['q','after','limit']);return memberPage(await membersRequest('/api/administration/team-administrators'+suffix),limit,true);},
    disableTeamBusinessMember:input=>disableMember(input,false),
    disableTeamAdministrator:input=>disableMember(input,true),
    async getTaskManagement(input){
      exactKeys(input,['teamId','taskId']);const data=await request(path(input.teamId,input.taskId)+'/management');if(typeof data?.canManage!=='boolean')throw failure('INVALID_RESPONSE','任务管理权限状态无效。');if(!data.canManage)return {canManage:false};
      if(!Number.isSafeInteger(data.revision)||data.revision<0||!['open','submitted','returned','closed'].includes(data.status)||!Array.isArray(data.assignees)||data.assignees.length>50||typeof data.hasMoreAssignees!=='boolean'||(data.hasMoreAssignees&&data.assignees.length!==50))throw failure('INVALID_RESPONSE','任务分工状态格式无效。');
      const assignees=data.assignees.map(taskMemberView);if(new Set(assignees.map(item=>item.id)).size!==assignees.length)throw failure('INVALID_RESPONSE','任务分工状态格式无效。');return {canManage:true,revision:data.revision,status:data.status,assignees,hasMoreAssignees:data.hasMoreAssignees};
    },
    async listTaskAssignees(input){
      exactKeys(input,['teamId','taskId','q','after','limit']);const params=new URLSearchParams(),limit=input.limit??20;
      if(!Number.isSafeInteger(limit)||limit<1||limit>50||input.q!==undefined&&(typeof input.q!=='string'||input.q.length>80||/[\p{Cc}\p{Cf}]/u.test(input.q)))throw failure('INVALID_INPUT','请使用80个字符以内的姓名搜索，每次最多读取50人。');
      if(input.q!==undefined)params.set('q',input.q);if(input.after!==undefined)params.set('after',id(input.after));if(input.limit!==undefined)params.set('limit',String(limit));
      const data=await request(path(input.teamId,input.taskId)+'/assignees'+(params.size?'?'+params:''));if(!Array.isArray(data?.members)||data.members.length>limit||typeof data.hasMore!=='boolean'||(data.hasMore&&data.members.length!==limit))throw failure('INVALID_RESPONSE','可指派成员列表格式无效。');const members=data.members.map(taskMemberView);if(new Set(members.map(item=>item.id)).size!==members.length)throw failure('INVALID_RESPONSE','可指派成员列表格式无效。');return {members,hasMore:data.hasMore};
    },
    async assignTask(input){
      exactKeys(input,['teamId','taskId','userId','revision']);const revision=taskRevisionInput(input.revision),data=await request(path(input.teamId,input.taskId)+'/assignment',{method:'POST',body:{userId:id(input.userId),revision}});
      if(!Number.isSafeInteger(data?.revision)||data.revision!==revision+1)throw failure('INVALID_RESPONSE','无法确认任务分工结果，请刷新任务核对。');return {revision:data.revision};
    },
    async returnTask(input){
      exactKeys(input,['teamId','taskId','revision']);const revision=taskRevisionInput(input.revision),data=await request(path(input.teamId,input.taskId)+'/return',{method:'POST',body:{revision}});
      if(!Number.isSafeInteger(data?.revision)||data.revision!==revision+1)throw failure('INVALID_RESPONSE','无法确认任务退回结果，请刷新任务核对。');return {revision:data.revision};
    },
    async getRecoveryReviewStatus(){const data=await request('/api/auth/recovery-requests/capabilities',{authenticated:false});if(typeof data?.reviewed!=='boolean'||typeof data.available!=='boolean'||(!data.reviewed&&data.available))throw failure('INVALID_RESPONSE','恢复审核服务状态无效。');return {reviewed:data.reviewed,available:data.available};},
    async createRecoveryReviewRequest(input){
      exactKeys(input,['challengeId','code']);if(token)throw failure('SIGN_OUT_REQUIRED','请先退出当前账号再申请恢复。');
      if(typeof input.challengeId!=='string'||!ID.test(input.challengeId)||typeof input.code!=='string'||!/^\d{6}$/.test(input.code))throw failure('INVALID_INPUT','请填写本次收到的6位恢复验证码。');
      const data=await request('/api/auth/recovery-requests',{method:'POST',authenticated:false,body:{challengeId:input.challengeId,code:input.code},unavailableMessage:'恢复审核服务尚未开通或暂不可用。',messagesOverride:{400:'本次手机号验证或申请无效，请重新核对。'}});
      if(typeof data?.requestId!=='string'||!ID.test(data.requestId)||data.status!=='pending'||!Number.isSafeInteger(data.revision)||data.revision<1||!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=0)throw failure('INVALID_RESPONSE','无法确认恢复申请，请核对后联系管理员。');return {requestId:data.requestId,status:'pending',revision:data.revision,expiresAt:data.expiresAt};
    },
    async getRecoveryReviewAccess(){const data=await provisioningRequest('/api/account/recovery-reviews/access');if(typeof data?.canReview!=='boolean')throw failure('INVALID_RESPONSE','恢复审核权限状态无效。');return {canReview:data.canReview};},
    async listRecoveryReviewRequests(){const data=await provisioningRequest('/api/account/recovery-reviews');if(!Array.isArray(data?.requests)||data.requests.length>50)throw failure('INVALID_RESPONSE','恢复审核列表格式无效。');const requests=data.requests.map(recoveryReviewView);if(new Set(requests.map(item=>item.id)).size!==requests.length)throw failure('INVALID_RESPONSE','恢复审核列表格式无效。');return {requests};},
    async reviewRecoveryReviewRequest(input){
      exactKeys(input,['requestId','decision','revision','currentPassword']);if(!['approve','reject','revoke'].includes(input.decision)||!Number.isSafeInteger(input.revision)||input.revision<1)throw failure('INVALID_INPUT','请核对恢复申请版本及审核操作。');
      const requestId=id(input.requestId),data=await request('/api/account/recovery-reviews/'+requestId+'/review',{method:'POST',body:{decision:input.decision,revision:input.revision,currentPassword:securityPasswordInput(input.currentPassword)},messagesOverride:{403:'当前密码验证未通过或审核未获授权。',404:'无法访问该恢复申请。',409:'恢复申请或授权已更新，请刷新核对。'}}),view=recoveryReviewView(data?.request);
      if(view.id!==requestId||view.revision<=input.revision||view.status!==({approve:'approved',reject:'rejected',revoke:'revoked'})[input.decision])throw failure('INVALID_RESPONSE','无法确认恢复审核结果，请刷新记录核对。');
      if(input.decision!=='approve')return {request:view};
      if(typeof data.recoveryProof!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.recoveryProof)||Buffer.from(data.recoveryProof,'base64url').toString('base64url')!==data.recoveryProof)throw failure('INVALID_RESPONSE','无法确认一次性恢复凭据，请刷新记录核对。');return {request:view,recoveryProof:data.recoveryProof};
    },
    async requestPasswordRecovery(input){
      exactKeys(input,['phone']);if(token)throw failure('SIGN_OUT_REQUIRED','请先退出当前账号再找回密码。');
      const data=await request('/api/auth/phone/challenges',{method:'POST',authenticated:false,body:{phone:phoneInput(input.phone),purpose:'reset'},unavailableMessage:'账号恢复或短信服务尚未开通或暂不可用，未完成密码恢复。',messagesOverride:{400:'手机号或恢复资料无效，请核对后重试。'}});
      if(typeof data?.challengeId!=='string'||!ID.test(data.challengeId)||!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=0)throw failure('INVALID_RESPONSE','账号恢复验证信息格式无效。');return {challengeId:data.challengeId,expiresAt:data.expiresAt};
    },
    async recoverPassword(input){
      exactKeys(input,['challengeId','code','newPassword','recoveryProof']);if(token)throw failure('SIGN_OUT_REQUIRED','请先退出当前账号再找回密码。');
      if(typeof input.challengeId!=='string'||!ID.test(input.challengeId)||typeof input.code!=='string'||!/^\d{6}$/.test(input.code)||typeof input.newPassword!=='string'||[...input.newPassword].length<12||[...input.newPassword].length>128||Buffer.byteLength(input.newPassword)>512||typeof input.recoveryProof!=='string'||!input.recoveryProof||input.recoveryProof.length>1024)throw failure('INVALID_INPUT','请填写本次验证码、独立恢复授权凭据和12至128个字符的新密码。');
      const data=await request('/api/auth/phone/reset',{method:'POST',authenticated:false,body:{challengeId:input.challengeId,code:input.code,newPassword:input.newPassword,recoveryProof:input.recoveryProof},unavailableMessage:'账号恢复或短信服务尚未开通或暂不可用，请核对后重试。',messagesOverride:{400:'本次验证或独立恢复授权未通过，请重新核对。',409:'账号状态已改变，请重新验证后核对。'}});
      if(data?.signedOut!==true)throw failure('INVALID_RESPONSE','无法确认密码恢复结果，请使用新密码登录核对。');clear();return {signedOut:true};
    },
    async getTeamProvisioningAccess(){const data=await provisioningRequest('/api/operations/team-requests/access');if(typeof data?.canReview!=='boolean')throw failure('INVALID_RESPONSE','团队审核权限状态无效。');return {canReview:data.canReview};},
    async listTeamProvisioningRequests(){
      const data=await provisioningRequest('/api/operations/team-requests');if(!Array.isArray(data?.requests)||data.requests.length>50)throw failure('INVALID_RESPONSE','团队审核列表格式无效。');
      const requests=data.requests.map(provisioningView);if(new Set(requests.map(item=>item.id)).size!==requests.length)throw failure('INVALID_RESPONSE','团队审核列表格式无效。');return {requests};
    },
    async createTeamProvisioningRequest(input){
      exactKeys(input,['teamName','adminPhone']);const teamName=teamNameInput(input.teamName),data=await provisioningRequest('/api/operations/team-requests',{method:'POST',body:{teamName,adminPhone:phoneInput(input.adminPhone)}}),view=provisioningView(data?.request);
      if(view.status!=='pending'||view.teamName!==teamName)throw failure('INVALID_RESPONSE','无法确认开通申请，请刷新列表核对。');return {request:view};
    },
    async reviewTeamProvisioningRequest(input){
      exactKeys(input,['requestId','decision','revision','currentPassword']);if(!['approve','reject','revoke'].includes(input.decision)||!Number.isSafeInteger(input.revision)||input.revision<1)throw failure('INVALID_INPUT','请选择有效的审核操作并刷新申请版本。');
      const requestId=id(input.requestId),data=await provisioningRequest('/api/operations/team-requests/'+requestId+'/review',{method:'POST',body:{decision:input.decision,revision:input.revision,currentPassword:securityPasswordInput(input.currentPassword)}}),view=provisioningView(data?.request);
      if(view.id!==requestId||view.revision<=input.revision||view.status!==({approve:'approved',reject:'rejected',revoke:'revoked'})[input.decision])throw failure('INVALID_RESPONSE','无法确认审核结果，请刷新列表核对。');
      return {request:view,...(input.decision==='approve'?{invitationCode:invitationCodeInput(data.invitationCode)}:{})};
    },
    async getTeamAdministration(){
      const data=await provisioningRequest('/api/auth/team-administration');if(!Array.isArray(data?.teams)||data.teams.length>50)throw failure('INVALID_RESPONSE','团队管理信息格式无效。');
      const teams=data.teams.map(item=>{if(!item||typeof item.teamId!=='string'||!ID.test(item.teamId)||typeof item.teamName!=='string'||!item.teamName.isWellFormed()||!item.teamName.trim()||[...item.teamName].length>80||/[\x00-\x1f\x7f]/.test(item.teamName))throw failure('INVALID_RESPONSE','团队管理信息格式无效。');return {teamId:item.teamId,teamName:item.teamName};});
      if(new Set(teams.map(item=>item.teamId)).size!==teams.length)throw failure('INVALID_RESPONSE','团队管理信息格式无效。');return {teams};
    },
    async previewFirstAdministrator(input){const body=activationTarget(input,['invitationCode','phone']);return firstAdministratorView(await provisioningRequest('/api/auth/first-administrator/preview',{method:'POST',authenticated:false,body}));},
    async requestFirstAdministratorActivation(input){
      const body=activationTarget(input,['invitationCode','phone']),data=await provisioningRequest('/api/auth/first-administrator/challenges',{method:'POST',authenticated:false,body});
      if(typeof data?.challengeId!=='string'||!ID.test(data.challengeId)||!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=0)throw failure('INVALID_RESPONSE','首管理员验证信息格式无效。');return {challengeId:data.challengeId,expiresAt:data.expiresAt};
    },
    async activateFirstAdministrator(input){
      const body=activationTarget(input,['invitationCode','phone','challengeId','code','password','displayName','accept']),displayName=input.displayName??'';
      if(typeof input.challengeId!=='string'||!ID.test(input.challengeId)||typeof input.code!=='string'||!/^\d{6}$/.test(input.code)||input.accept!==true||typeof displayName!=='string'||!displayName.isWellFormed()||[...displayName].length>80||/[\x00-\x1f\x7f]/.test(displayName))throw failure('INVALID_INPUT','请填写本人验证资料并确认开通团队。');
      const data=await provisioningRequest('/api/auth/first-administrator/activate',{method:'POST',authenticated:false,body:{...body,challengeId:input.challengeId,code:input.code,password:passwordInput(input.password),displayName:displayName.trim(),accept:true}});
      if(data?.activated!==true)throw failure('INVALID_RESPONSE','无法确认首管理员激活结果，请使用手机号登录核对。');return {activated:true};
    },
    async changeOwnPassword(input){
      exactKeys(input,['currentPassword','newPassword']);
      if(typeof input.newPassword!=='string'||[...input.newPassword].length<12||[...input.newPassword].length>128||Buffer.byteLength(input.newPassword)>512)throw failure('INVALID_INPUT','新密码需要12至128个字符。');
      const data=await request('/api/auth/password',{method:'POST',body:{currentPassword:securityPasswordInput(input.currentPassword),newPassword:input.newPassword},messagesOverride:{400:'当前密码或新密码格式无效，请核对后重试。',403:'当前密码验证未通过，请核对后重试。',409:'账号状态已改变，请重新登录核对。'}});
      if(data?.signedOut!==true)throw failure('INVALID_RESPONSE','无法确认改密结果，请使用新密码重新登录核对。');
      clear();return {signedOut:true};
    },
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
      const data = await request('/api/auth/login', {method:'POST', body:{username:input.username,password:input.password},authenticated:false,discardSessionOnChange:device.required});
      if (at !== generation) throw failure('SESSION_CHANGED', '账号状态已改变，请重新登录。');
      if (typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.token)) throw failure('INVALID_RESPONSE', '账号服务返回格式无效。');
      return finalizeSession(data);
    },
    async loginPhone(input) {
      exactKeys(input,['phone','password']);
      const body={phone:phoneInput(input.phone),password:passwordInput(input.password)};
      clear();const at=generation;
      const data=await request('/api/auth/phone/login',{method:'POST',body,authenticated:false,discardSessionOnChange:device.required});
      if(at!==generation)throw failure('SESSION_CHANGED','账号状态已改变，请重新登录。');
      if(typeof data.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(data.token))throw failure('INVALID_RESPONSE','账号服务返回格式无效。');
      return finalizeSession(data);
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
    async getTaskSubmissionAccess(input) {
      exactKeys(input,['teamId','taskId']);const data=await request(path(input.teamId,id(input.taskId))+'/submission-access');
      if(typeof data?.canSubmit!=='boolean'||!Number.isSafeInteger(data.revision)||data.revision<0||(data.canSubmit&&data.revision===Number.MAX_SAFE_INTEGER))throw failure('INVALID_RESPONSE','资料提交权限状态无效，请刷新任务后重试。');
      return {canSubmit:data.canSubmit,revision:data.revision};
    },
    async getSubmissions(input) { exactKeys(input,['teamId','taskId']); const data=await request(path(input.teamId,input.taskId)+'/submissions'); if (!Number.isSafeInteger(data.revision) || data.revision<0 || !Array.isArray(data.submissions)) throw failure('INVALID_RESPONSE','提交记录返回格式无效。'); return {revision:data.revision,submissions:data.submissions.map(submissionView)}; },
    async upload(input, file) { exactKeys(input,['teamId','taskId','revision']); if (!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER||!file||typeof file.filename!=='string'||!(file.bytes instanceof Uint8Array)||file.bytes.length>MAX_FILE_BYTES) throw failure('INVALID_INPUT','上传资料无效或超过12 MiB。');
      const data=await request(path(input.teamId,input.taskId)+'/submissions',{method:'POST',body:{filename:file.filename,contentBase64:Buffer.from(file.bytes).toString('base64'),revision:input.revision}});
      if (!Number.isSafeInteger(data.revision)||data.revision<1) throw failure('INVALID_RESPONSE','提交记录返回格式无效。'); return {revision:data.revision,submission:submissionView(data.submission)}; },
    async download(input) { exactKeys(input,['teamId','taskId','attachmentId']); return request(path(input.teamId,input.taskId)+'/attachments/'+id(input.attachmentId),{binary:true}); },
    async checkAttachmentAccess(input) {
      exactKeys(input,['teamId','taskId','attachmentId']);
      const result=await request(path(input.teamId,id(input.taskId))+'/attachments/'+id(input.attachmentId),{method:'HEAD',binary:true});
      if(result.bytes.length!==0)throw failure('INVALID_RESPONSE','无法确认原件保存权限，请刷新任务后重试。');
      return {canDownload:true};
    },
    guardSession() { const at=generation; if(!token)throw failure('SIGN_IN_REQUIRED','请先登录。',401);const deviceGuard=device.guard();return ()=>{if(at!==generation||!token)throw failure('SESSION_CHANGED','账号状态已改变，请重新操作。');deviceGuard();}; },
    clearSession: clear,
    ...createCollectionWorkspaceClient({request,failure,capture(){if(!token||!current)throw failure('SIGN_IN_REQUIRED','请先登录。',401);if(!device.required)throw failure('DEVICE_NOT_READY','创建工作区需要当前已持钥核验的业务登录。');const at=generation,actorId=current.account.id,deviceGuard=device.guard();const assertCurrent=()=>{if(at!==generation||!token||current?.account.id!==actorId)throw failure('SESSION_CHANGED','账号状态已改变，请重新操作。');deviceGuard();};assertCurrent();return{actorId,assertCurrent};}}),
  });
}
module.exports = {createTeamClient,ClientError,API_BASE,MAX_FILE_BYTES,boundedBytes};
