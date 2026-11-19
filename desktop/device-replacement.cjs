'use strict';
// Main-only replacement workflow. No signing material enters the renderer.
const proof=require('../shared/device-proof.cjs');
const replacementProof=require('../shared/device-replacement-proof.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,HEX=/^[a-f0-9]{64}$/;
const REVIEW_LIST_PATH='/api/account/device-replacement-reviews';
const exact=(value,keys)=>!!value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=value=>typeof value==='string'&&value.isWellFormed()&&!!value.trim()&&[...value].length<=80&&!/[\p{Cc}\p{Cf}]/u.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=1;
function createDeviceReplacement({identity,getAccount,getContext,bootstrap,reviewRequest,adopt,revoke,clearAccount,error}){
 let pending=null,retainedReceipt=null;
 const fail=(code,message,status=0)=>error(code,message,status);
 const invalid=()=>fail('INVALID_INPUT','请核对本次换机申请、版本与确认信息。');
 const malformed=()=>fail('INVALID_RESPONSE','换机资料格式无效，请刷新核对。');
 const changed=()=>fail('SESSION_CHANGED','账号或设备状态已改变，请重新操作。');
 const unchanged=account=>{const current=getAccount();return current.generation===account.generation&&current.token===account.token&&current.current?.account.id===account.current?.account.id;};
 function view(value){
  if(!exact(value,['id','teamId','teamName','displayName','targetKind','status','revision','createdAt','expiresAt','oldDevice','newDevice'])||!UUID.test(value.id)||!ID.test(value.teamId)||!text(value.teamName)||!text(value.displayName)||!['employee','administrator'].includes(value.targetKind)||!['pending','approved','claimed','rejected','withdrawn','revoked','expired','stale'].includes(value.status)||!revision(value.revision)||!Number.isSafeInteger(value.createdAt)||value.createdAt<0||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=value.createdAt)throw malformed();
  const old=value.oldDevice,next=value.newDevice;
  if(!exact(old,['id','displayName','platform','keyFingerprint','status','revision'])||!UUID.test(old.id)||!text(old.displayName)||!['win32','darwin'].includes(old.platform)||!HEX.test(old.keyFingerprint)||!['active','revoked'].includes(old.status)||!revision(old.revision)||!exact(next,['displayName','platform','keyFingerprint'])||!text(next.displayName)||!['win32','darwin'].includes(next.platform)||!HEX.test(next.keyFingerprint))throw malformed();
  return {id:value.id,teamId:value.teamId,teamName:value.teamName,displayName:value.displayName,targetKind:value.targetKind,status:value.status,revision:value.revision,createdAt:value.createdAt,expiresAt:value.expiresAt,oldDevice:{...old},newDevice:{...next}};
 }
 function capture(){
  const account=getAccount(),context=getContext();
  if(!account.token||!ID.test(account.current?.account.id??''))throw fail('SIGN_IN_REQUIRED','请先登录本人账号。',401);
  if(!identity||!['win32','darwin'].includes(identity.platform)||typeof identity.vault?.signReplacementChallenge!=='function'||!context||!UUID.test(context.serverId)||!HEX.test(context.fingerprint)||typeof context.publicKey!=='string'||!context.device)throw fail('DEVICE_NOT_READY','请先在线核对当前账号和设备身份。');
  const assertCurrent=()=>{const latest=getContext();if(!unchanged(account)||!latest||latest.epoch!==context.epoch||latest.serverId!==context.serverId||latest.fingerprint!==context.fingerprint)throw changed();};
  return {account,context,assertCurrent};
 }
 async function ownRead(captured){const value=await bootstrap('/api/auth/device-replacements',{token:captured.account.token});captured.assertCurrent();if(!exact(value,['canRequest','request'])||typeof value.canRequest!=='boolean')throw malformed();return {canRequest:value.canRequest,request:value.request===null?null:view(value.request)};}
 function requireTarget(value,input,captured,purpose){
  const item=value.request,old=captured.context.device;
  if(!item||item.id!==input.requestId||item.revision!==input.revision||item.newDevice.keyFingerprint!==captured.context.fingerprint||item.newDevice.platform!==identity.platform||item.oldDevice.id!==old.id||item.oldDevice.revision!==old.revision||item.oldDevice.status!==old.status||!(purpose==='withdraw'?['pending','approved']:['approved']).includes(item.status))throw fail('DEVICE_REPLACEMENT_CHANGED','本次申请、设备或审核状态已改变，请刷新核对。',409);
  return item;
 }
 function checkedChallenge(value,purpose,captured,requestId,requestRevision){
  if(!exact(value,['challenge']))throw malformed();const fields=value.challenge;
  try{replacementProof.replacementChallengeBytes(fields);}catch{throw malformed();}
  const {account,context}=captured,old=context.device;
  if(fields.purpose!==purpose||fields.serverId!==context.serverId||fields.userId!==account.current.account.id||fields.sessionBinding!==proof.sessionBinding(account.token)||fields.keyFingerprint!==context.fingerprint||fields.oldDeviceId!==old.id||fields.oldBindingRevision!==old.revision||fields.oldBindingStatus!==old.status||fields.requestRevision!==requestRevision||(requestId&&fields.requestId!==requestId))throw fail('INVALID_RESPONSE','换机挑战与本次账号或设备不一致，已停止操作。');
  return fields;
 }
 async function sign(fields,captured){
  const {account,context}=captured;let signature;
  try{signature=await identity.vault.signReplacementChallenge(fields,{purpose:fields.purpose,serverId:context.serverId,userId:account.current.account.id,sessionToken:account.token,oldDeviceId:context.device.id,oldBindingRevision:context.device.revision,oldBindingStatus:context.device.status,requestId:fields.requestId,requestRevision:fields.requestRevision});}
  catch{captured.assertCurrent();throw fail('DEVICE_VAULT_UNAVAILABLE','系统设备密钥无法完成本次换机验证，请保留原密钥并重试。');}
  captured.assertCurrent();try{proof.signatureBytes(signature);}catch{throw fail('DEVICE_VAULT_UNAVAILABLE','系统设备签名格式无效，已停止换机操作。');}return signature;
 }
 async function write(captured,operation){
  if(pending&&unchanged(pending.account))throw fail('DEVICE_BUSY','换机操作仍在处理中，请稍候刷新核对。');
  const owner={account:captured.account};pending=owner;
  try{return await operation();}finally{if(pending===owner)pending=null;}
 }
 async function finalPost(purpose,fields,signature,captured){
  try{const data=await bootstrap('/api/auth/device-replacements/'+purpose,{method:'POST',token:captured.account.token,body:{challengeId:fields.challengeId,signature},minted:purpose==='activate'});try{captured.assertCurrent();}catch(cause){if(purpose==='activate'&&typeof data?.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(data.token))await revoke(data.token).catch(()=>{});throw cause;}return data;}
  catch(cause){if(!unchanged(captured.account))throw changed();if(['SERVICE_UNAVAILABLE','INVALID_RESPONSE','RESPONSE_TOO_LARGE'].includes(cause.code))throw fail('OPERATION_UNCONFIRMED','已发换机操作的结果未确认，可能已经完成；请重新登录或刷新本人申请核对，系统不会自动重试。');throw cause;}
 }
 function assertReviewReady(){
  const context=getContext();
  if(!identity||context?.state!=='ready')throw fail('DEVICE_NOT_READY','换机审核需要当前已持钥核验的业务登录。');
  return context;
 }
 function actionInput(input,confirmed=false){if(!exact(input,confirmed?['requestId','revision','confirmed']:['requestId','revision'])||!UUID.test(input.requestId)||!revision(input.revision)||input.revision>=Number.MAX_SAFE_INTEGER||(confirmed&&input.confirmed!==true))throw invalid();}
 return Object.freeze({
  async getStatus(input){if(input!==undefined)throw invalid();return ownRead(capture());},
  async request(input){
   if(!exact(input,['displayName','currentPassword','confirmed'])||!text(input.displayName)||typeof input.currentPassword!=='string'||!input.currentPassword||Buffer.byteLength(input.currentPassword)>512||input.confirmed!==true)throw invalid();const captured=capture();
   return write(captured,async()=>{const available=await ownRead(captured);if(!available.canRequest||!['different_key','revoked'].includes(captured.context.state))throw fail('DEVICE_REPLACEMENT_NOT_AVAILABLE','当前账号不能提交新的换机申请，请刷新本人申请核对。',409);
    const value=await bootstrap('/api/auth/device-replacements/request-challenges',{method:'POST',token:captured.account.token,body:{publicKey:captured.context.publicKey,displayName:input.displayName.trim(),platform:identity.platform,currentPassword:input.currentPassword}});captured.assertCurrent();const fields=checkedChallenge(value,'request',captured,null,0),signature=await sign(fields,captured),data=await finalPost('request',fields,signature,captured);
    if(!exact(data,['request']))throw malformed();const item=view(data.request);if(item.id!==fields.requestId||item.revision!==1||item.status!=='pending'||item.newDevice.keyFingerprint!==captured.context.fingerprint||item.newDevice.displayName!==input.displayName.trim()||item.newDevice.platform!==identity.platform||item.oldDevice.id!==captured.context.device.id||item.oldDevice.revision!==captured.context.device.revision||item.oldDevice.status!==captured.context.device.status)throw malformed();return {request:item};
   });
  },
  async withdraw(input){
   actionInput(input);const captured=capture();return write(captured,async()=>{requireTarget(await ownRead(captured),input,captured,'withdraw');const value=await bootstrap('/api/auth/device-replacements/withdraw-challenges',{method:'POST',token:captured.account.token,body:{requestId:input.requestId,revision:input.revision,publicKey:captured.context.publicKey}});captured.assertCurrent();const fields=checkedChallenge(value,'withdraw',captured,input.requestId,input.revision),signature=await sign(fields,captured),data=await finalPost('withdraw',fields,signature,captured);if(!exact(data,['request']))throw malformed();const item=view(data.request);if(item.id!==input.requestId||item.revision!==input.revision+1||item.status!=='withdrawn'||item.newDevice.keyFingerprint!==captured.context.fingerprint)throw malformed();return {request:item};});
  },
  async activate(input,receiveReceipt){
   actionInput(input,true);const captured=capture();let receipt;
   const result=await write(captured,async()=>{const item=requireTarget(await ownRead(captured),input,captured,'activate');const value=await bootstrap('/api/auth/device-replacements/activate-challenges',{method:'POST',token:captured.account.token,body:{requestId:input.requestId,revision:input.revision,publicKey:captured.context.publicKey}});captured.assertCurrent();const fields=checkedChallenge(value,'activate',captured,input.requestId,input.revision),signature=await sign(fields,captured);let data;
    try{data=await finalPost('activate',fields,signature,captured);const adopted=adopt(data,{...captured.context,userId:captured.account.current.account.id,displayName:item.newDevice.displayName,platform:item.newDevice.platform,challengeExpiresAt:fields.expiresAt},captured.assertCurrent),owner=getAccount();let cancelled=false,cleanup;
     receipt={assertCurrent(){if(cancelled||!unchanged(owner))throw changed();},rollback({clear=true}={}){cancelled=true;if(retainedReceipt===receipt)retainedReceipt=null;if(!cleanup){cleanup=Promise.resolve().then(()=>revoke(data.token)).catch(()=>{});if(clear&&unchanged(owner))clearAccount();}return cleanup;}};retainedReceipt=receipt;receiveReceipt?.(receipt);receipt.assertCurrent();return adopted;}
    catch(cause){if(receipt)await receipt.rollback();else if(typeof data?.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(data.token))await revoke(data.token).catch(()=>{});throw cause;}
   });receipt.assertCurrent();return result;
  },
  reset(){if(retainedReceipt)void retainedReceipt.rollback({clear:false});},
  async getReviewAccess(input){if(input!==undefined)throw invalid();assertReviewReady();const data=await reviewRequest('/api/account/device-replacement-reviews/access');if(!exact(data,['canReview'])||typeof data.canReview!=='boolean')throw malformed();return {canReview:data.canReview};},
  async listReviews(input){
   let paged=input!==undefined;
   if(paged&&!exact(input,[])&&(!exact(input,['after'])||typeof input.after!=='string'||!UUID.test(input.after)))throw invalid();
   const after=input?.after,account=getAccount(),epoch=assertReviewReady().epoch;
   const query=paged?'?paging=1'+(after===undefined?'':'&after='+after):'';
   let data;
   try{data=await reviewRequest(REVIEW_LIST_PATH+query);}
   catch(cause){
    if(!paged||after!==undefined||cause?.code!=='HTTP_400'||cause.status!==400)throw cause;
    // Older services reject even the first page query. Retry only the same actor's read.
    if(!unchanged(account)||getContext()?.epoch!==epoch)throw changed();
    assertReviewReady();
    data=await reviewRequest(REVIEW_LIST_PATH);paged=false;
   }
   if(!exact(data,paged?['requests','hasMore','nextCursor']:['requests','hasMore'])||!Array.isArray(data.requests)||data.requests.length>50||typeof data.hasMore!=='boolean')throw malformed();
   const requests=data.requests.map(view),ids=new Set(requests.map(item=>item.id));
   if(ids.size!==requests.length||paged&&requests.some(item=>typeof item.id!=='string'||item.id===after))throw malformed();
   if(!paged)return {requests,hasMore:data.hasMore};
   if(data.hasMore?(typeof data.nextCursor!=='string'||data.nextCursor!==requests.at(-1)?.id):data.nextCursor!==null)throw malformed();
   return {requests,hasMore:data.hasMore,nextCursor:data.nextCursor};
  },
  async review(input){if(!exact(input,['requestId','revision','decision','currentPassword'])||!UUID.test(input.requestId)||!revision(input.revision)||input.revision>=Number.MAX_SAFE_INTEGER||!['approve','reject','revoke'].includes(input.decision)||typeof input.currentPassword!=='string'||!input.currentPassword||Buffer.byteLength(input.currentPassword)>512)throw invalid();assertReviewReady();const data=await reviewRequest('/api/account/device-replacement-reviews/'+input.requestId+'/review',{method:'POST',body:{revision:input.revision,decision:input.decision,currentPassword:input.currentPassword}});if(!exact(data,['request']))throw malformed();const item=view(data.request);if(item.id!==input.requestId||item.revision!==input.revision+1||item.status!==({approve:'approved',reject:'rejected',revoke:'revoked'})[input.decision])throw malformed();return {request:item};}
 });
}
module.exports={createDeviceReplacement};
