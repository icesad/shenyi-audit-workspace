'use strict';
// Main-process coordinator. Bearers and leases never leave these private hooks.
const {randomBytes,createHash}=require('node:crypto');
const proof=require('../shared/device-proof.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,HEX=/^[a-f0-9]{64}$/;
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)&&Buffer.from(value,'base64url').toString('base64url')===value;
const exact=(value,keys)=>!!value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=value=>typeof value==='string'&&value.isWellFormed()&&!!value.trim()&&[...value].length<=80&&!/[\p{Cc}\p{Cf}]/u.test(value);
const GET_BOOTSTRAP=new Set(['/api/auth/methods','/api/auth/session','/api/auth/onboarding/capabilities','/api/auth/recovery-requests/capabilities','/api/auth/devices']);
const POST_BOOTSTRAP=new Set(['/api/auth/login','/api/auth/logout','/api/auth/phone/login','/api/auth/phone/challenges','/api/auth/phone/reset','/api/auth/recovery-requests',
 '/api/auth/onboarding/preview','/api/auth/onboarding/challenges','/api/auth/onboarding/activate','/api/auth/first-administrator/preview','/api/auth/first-administrator/challenges','/api/auth/first-administrator/activate',
 '/api/auth/devices/enrollment-challenges','/api/auth/devices/proof-challenges','/api/auth/devices/revocation-challenges','/api/auth/devices/enroll','/api/auth/devices/prove','/api/auth/devices/revoke','/api/auth/wechat/transactions']);
function deviceBootstrapRequest(method,route){
 if(typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')||route.includes('?')||route.includes('#'))return false;
 if(method==='GET')return GET_BOOTSTRAP.has(route);if(method!=='POST')return false;if(POST_BOOTSTRAP.has(route))return true;
 const match=/^\/api\/auth\/wechat\/transactions\/([^/]+)\/(status|cancel|link|exchange)$/.exec(route);return !!match&&UUID.test(match[1]);
}
function createDeviceSession({identity,getAccount,adopt,clearAccount,bootstrap,protectedRequest,revoke,error,now=Date.now}){
 const required=identity!==undefined;
 let state=required?'signed_out':'diagnostic',epoch=0,work=0,device=null,local=null,lease=null,serverId=null,pending=null;
 const fail=(code,message,status=0)=>error(code,message,status);
 const changed=()=>fail('SESSION_CHANGED','账号或设备状态已改变，请重新操作。');
 function bump(){if(epoch>=Number.MAX_SAFE_INTEGER)throw changed();epoch++;}
 function transition(next,{force=false}={}){if(state!==next||force){state=next;bump();}}
 function status(){return {required,state,epoch,device:device?structuredClone(device):null,localFingerprint:local?.fingerprint??null,expiresAt:lease?.expiresAt??null};}
 function reset(){work++;lease=null;device=null;local=null;serverId=null;transition(required?'signed_out':'diagnostic',{force:true});}
 function pause(){if(required&&['ready','paused'].includes(state)){work++;transition('paused',{force:true});}}
 function matches(account){const current=getAccount();return !!account&&current.generation===account.generation&&current.token===account.token&&current.current?.account.id===account.current?.account.id;}
 function accountGuard(account,version,external=()=>{}){return ()=>{if(!matches(account)||work!==version)throw changed();external();};}
 function expire(){clearAccount();throw fail('SIGN_IN_REQUIRED','设备业务登录已到期，请重新登录。',401);}
 function assertReady(){if(!required)return;if(!getAccount().token)throw fail('SIGN_IN_REQUIRED','请先登录。',401);if(lease&&lease.expiresAt<=now())expire();if(state!=='ready'||!lease)throw fail('DEVICE_NOT_READY',state==='enrollment_required'?'请先明确确认绑定本机后再使用团队业务。':'设备业务已暂停，请在线核验后重试。');}
 function guard(){if(!required)return ()=>{};assertReady();const account=getAccount(),version=work,at=epoch;return ()=>{if(!matches(account)||version!==work||at!==epoch)throw changed();assertReady();};}
 async function vaultIdentity(assertCurrent){
  if(!identity||!['win32','darwin'].includes(identity.platform)||!identity.vault||!['getPublicIdentity','signChallenge','signRequest'].every(name=>typeof identity.vault[name]==='function'))throw fail('DEVICE_VAULT_UNAVAILABLE','系统设备密钥保护暂不可用，请退出后重试。');
  let value;try{value=await identity.vault.getPublicIdentity();}catch{throw fail('DEVICE_VAULT_UNAVAILABLE','系统设备密钥保护暂不可用，请保留原密钥并联系管理员。');}assertCurrent();
  try{if(!exact(value,['publicKey','fingerprint']))throw Error();const parsed=proof.parsePublicKey(value.publicKey);if(value.fingerprint!==parsed.fingerprint)throw Error();return {publicKey:value.publicKey,fingerprint:value.fingerprint};}catch{throw fail('DEVICE_VAULT_UNAVAILABLE','设备密钥身份无效，请保留原密钥并联系管理员。');}
 }
 function viewDevice(value){
  if(!exact(value,['id','displayName','platform','keyFingerprint','status','revision','boundAt','revokedAt'])||!UUID.test(value.id)||!text(value.displayName)||!['win32','darwin'].includes(value.platform)||!HEX.test(value.keyFingerprint)||!['active','revoked'].includes(value.status)||!Number.isSafeInteger(value.revision)||value.revision<1||!Number.isSafeInteger(value.boundAt)||value.boundAt<0||(value.revokedAt!==null&&(!Number.isSafeInteger(value.revokedAt)||value.revokedAt<value.boundAt)))throw fail('INVALID_RESPONSE','设备状态格式无效，请重新核对。');
  return Object.fromEntries(['id','displayName','platform','keyFingerprint','status','revision','boundAt','revokedAt'].map(key=>[key,value[key]]));
 }
 async function observe(account,assertCurrent){
  const methods=await bootstrap('/api/auth/methods',{authenticated:false});assertCurrent();
  const capability=methods?.deviceBinding;
  if(!exact(capability,['required','serverId','protocolVersion'])||capability.required!==true||!UUID.test(capability.serverId)||capability.protocolVersion!==1)throw fail('DEVICE_CAPABILITY_REQUIRED','服务端尚未启用设备绑定，当前客户端拒绝进入业务。');
  if(serverId!==null&&serverId!==capability.serverId)throw fail('DEVICE_SERVER_CHANGED','设备服务身份已改变，请重新登录并核对。');serverId=capability.serverId;
  const publicPart=await vaultIdentity(assertCurrent);if(!local||local.fingerprint!==publicPart.fingerprint){local=publicPart;bump();}
  const value=await bootstrap('/api/auth/devices',{token:account.token});assertCurrent();
  if(!exact(value,['hasHistory','canEnroll','device'])||typeof value.hasHistory!=='boolean'||typeof value.canEnroll!=='boolean'||value.hasHistory===value.canEnroll||(!value.hasHistory&&value.device!==null)||(value.hasHistory&&value.device===null))throw fail('INVALID_RESPONSE','设备登记状态无效，请重新核对。');
  device=value.device===null?null:viewDevice(value.device);
  if(!value.hasHistory){lease=null;transition('enrollment_required',{force:true});return false;}
  if(device.status==='revoked'){lease=null;transition('revoked',{force:true});return false;}
  if(device.keyFingerprint!==local.fingerprint){lease=null;transition('different_key',{force:true});return false;}
  return true;
 }
 function checkedChallenge(value,purpose,account,revision){
  if(!exact(value,['challenge']))throw fail('INVALID_RESPONSE','设备验证资料格式无效。');const fields=value.challenge;
  try{proof.challengeBytes(fields);}catch{throw fail('INVALID_RESPONSE','设备验证资料格式无效。');}
  if(fields.purpose!==purpose||fields.serverId!==serverId||fields.userId!==account.current.account.id||fields.sessionBinding!==proof.sessionBinding(account.token)||fields.keyFingerprint!==local.fingerprint||fields.bindingRevision!==revision)throw fail('INVALID_RESPONSE','设备验证上下文不一致，已停止操作。');
  return fields;
 }
 function validateMinted(data,account,purpose,challenge){
  if(!exact(data,['token','account','memberships','expiresAt','device','lease'])||!opaque(data.token)||data.token===account.token||data.account?.id!==account.current.account.id||!Array.isArray(data.memberships)||!Number.isSafeInteger(data.expiresAt))throw fail('INVALID_RESPONSE','持钥登录结果无效，请重新登录。');
  const bound=viewDevice(data.device),value=data.lease,revision=purpose==='enroll'?1:challenge.bindingRevision;
  if(!exact(value,['id','token','serverId','deviceId','bindingRevision','expiresAt'])||!UUID.test(value.id)||!opaque(value.token)||value.serverId!==serverId||value.deviceId!==bound.id||!Number.isSafeInteger(value.bindingRevision)||value.bindingRevision!==revision||bound.revision!==revision||bound.status!=='active'||bound.keyFingerprint!==local.fingerprint||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now()||value.expiresAt!==data.expiresAt||value.expiresAt>challenge.expiresAt+15*60000||(purpose!=='enroll'&&bound.id!==device.id))throw fail('INVALID_RESPONSE','设备业务会话返回状态无效，请重新登录。');
  return {device:bound,lease:{...value}};
 }
 async function prove(account,assertCurrent,purpose='prove',enrollment,onAdopt){
  const revision=purpose==='enroll'?0:device.revision;
  const route='/api/auth/devices/'+(purpose==='enroll'?'enrollment-challenges':'proof-challenges');
  const value=await bootstrap(route,{method:'POST',token:account.token,body:{publicKey:local.publicKey,...(purpose==='enroll'?{displayName:enrollment.displayName,platform:identity.platform,currentPassword:enrollment.currentPassword}:{})}});assertCurrent();
  const challenge=checkedChallenge(value,purpose,account,revision);let signature;
  try{signature=await identity.vault.signChallenge(challenge,{purpose,serverId,userId:account.current.account.id,sessionToken:account.token,bindingRevision:revision});}catch{assertCurrent();throw fail('DEVICE_VAULT_UNAVAILABLE','系统设备密钥无法完成验证，请保留原密钥并联系管理员。');}assertCurrent();
  let data;
  try{
   data=await bootstrap('/api/auth/devices/'+purpose,{method:'POST',token:account.token,body:{challengeId:challenge.challengeId,signature},minted:true});assertCurrent();
   const ready=validateMinted(data,account,purpose,challenge);assertCurrent();
   device=ready.device;lease=ready.lease;work++;transition('ready',{force:true});
   const result=adopt(data);onAdopt?.(data.token);return result;
  }catch(cause){if(opaque(data?.token))await revoke(data.token).catch(()=>{});throw cause;}
 }
 function failed(cause,account){
  if(!matches(account))return;
  if(cause.code==='DEVICE_VAULT_UNAVAILABLE'){lease=null;work++;transition('vault_unavailable',{force:true});}
  else if(['SERVICE_UNAVAILABLE','RESPONSE_TOO_LARGE','INVALID_RESPONSE','DEVICE_CAPABILITY_REQUIRED','DEVICE_SERVER_CHANGED'].includes(cause.code)){work++;transition('paused',{force:true});}
 }
 async function finalize(assertExternal=()=>{},onAdopt){
  if(!required)return null;const account=getAccount();if(!account.token||!ID.test(account.current?.account.id??''))throw fail('INVALID_RESPONSE','账号服务返回格式无效。');
  work++;lease=null;transition('paused',{force:true});const version=work,assertCurrent=accountGuard(account,version,assertExternal);
  const operation=(async()=>{try{if(!await observe(account,assertCurrent))return null;return await prove(account,assertCurrent,'prove',undefined,onAdopt);}catch(cause){failed(cause,account);throw cause;}})();pending=operation;
  try{return await operation;}finally{if(pending===operation)pending=null;}
 }
 async function enroll(input){
  if(!required)throw fail('DEVICE_NOT_REQUIRED','当前隔离诊断不执行设备登记。');
  if(!exact(input,['displayName','currentPassword','confirmed'])||input.confirmed!==true||!text(input.displayName)||typeof input.currentPassword!=='string'||!input.currentPassword||Buffer.byteLength(input.currentPassword)>512)throw fail('INVALID_INPUT','请填写设备名称、当前密码并明确同意绑定本机。');
  if(pending)throw fail('DEVICE_BUSY','设备操作正在进行，请稍候。');if(state!=='enrollment_required'||!local||!serverId)throw fail('DEVICE_NOT_READY','当前账号不适用于首次绑定，请退出后重新核对。');
  const account=getAccount(),version=work,assertCurrent=accountGuard(account,version);
  const operation=(async()=>{try{return await prove(account,assertCurrent,'enroll',{displayName:input.displayName.trim(),currentPassword:input.currentPassword});}catch(cause){failed(cause,account);throw cause;}})();pending=operation;
  try{return await operation;}finally{if(pending===operation)pending=null;}
 }
 async function reconnect(){
  if(!required)return null;if(pending)return pending;const account=getAccount();if(!account.token)throw fail('SIGN_IN_REQUIRED','请先登录。',401);
  if(lease&&lease.expiresAt<=now())expire();
  if(['enrollment_required','different_key','revoked'].includes(state))throw fail('DEVICE_NOT_READY','当前设备尚未获准使用，请核对绑定状态或联系负责人。');
  pause();const version=work,assertCurrent=accountGuard(account,version);
  const operation=(async()=>{try{
   const confirmed=await bootstrap('/api/auth/session',{token:account.token});assertCurrent();if(confirmed?.account?.id!==account.current.account.id)throw fail('INVALID_RESPONSE','账号状态核验不一致。');
   if(!await observe(account,assertCurrent))return null;return await prove(account,assertCurrent);
  }catch(cause){failed(cause,account);throw cause;}})();pending=operation;
  try{return await operation;}finally{if(pending===operation)pending=null;}
 }
 let checking=null;
 async function check(){
  if(!required||pending||!getAccount().token||!['ready','paused'].includes(state))return status();if(checking)return checking;
  const observedAccount=getAccount(),observedWork=work,observedEpoch=epoch;
  const operation=(async()=>{try{
   if(lease&&lease.expiresAt<=now())expire();
   if(state==='paused'||!lease||lease.expiresAt-now()<=60000)await reconnect();
   else{const value=await protectedRequest('/api/auth/devices/connection');if(!exact(value,['connected'])||value.connected!==true){pause();throw fail('INVALID_RESPONSE','设备在线核验结果无效。');}}
  }catch(cause){if(matches(observedAccount)&&work===observedWork&&epoch===observedEpoch&&state==='ready')pause();throw cause;}return status();})();checking=operation;
  try{return await operation;}finally{if(checking===operation)checking=null;}
 }
 async function prepare(method,route,bytes){
  if(!required||deviceBootstrapRequest(method,route))return null;const assertCurrent=guard(),account=getAccount(),currentLease=lease;
  const fields={serverId,userId:account.current.account.id,sessionBinding:proof.sessionBinding(account.token),deviceId:currentLease.deviceId,bindingRevision:currentLease.bindingRevision,leaseId:currentLease.id,method,pathAndQuery:route,bodySha256:createHash('sha256').update(bytes).digest('hex'),nonce:randomBytes(32).toString('base64url')};
  let signature;try{signature=await identity.vault.signRequest(fields,{serverId,userId:account.current.account.id,sessionToken:account.token,deviceId:currentLease.deviceId,bindingRevision:currentLease.bindingRevision,leaseId:currentLease.id,keyFingerprint:local.fingerprint});}catch{assertCurrent();lease=null;work++;transition('vault_unavailable',{force:true});throw fail('DEVICE_VAULT_UNAVAILABLE','系统设备密钥无法完成请求签名。');}assertCurrent();
  try{proof.signatureBytes(signature);}catch{lease=null;work++;transition('vault_unavailable',{force:true});throw fail('DEVICE_VAULT_UNAVAILABLE','系统设备签名返回格式无效。');}
  return {headers:{'X-Shenyi-Device-Lease':currentLease.token,'X-Shenyi-Device-Nonce':fields.nonce,'X-Shenyi-Device-Body-SHA256':fields.bodySha256,'X-Shenyi-Device-Signature':signature},assertCurrent};
 }
 return Object.freeze({required,status,reset,pause,guard,prepare,finalize,enroll,reconnect,check,isReady:()=>state==='ready',isBootstrap:deviceBootstrapRequest});
}
module.exports={createDeviceSession,deviceBootstrapRequest};
