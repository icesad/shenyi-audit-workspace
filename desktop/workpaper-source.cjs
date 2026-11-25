'use strict';
const fs=require('node:fs/promises'),{randomUUID,createHash}=require('node:crypto');
const {ClientError}=require('./team-client.cjs');
const {inspectWorkpaperPackage}=require('./workpaper-package-worker.cjs');
const codec=require('../dist/workpaper-package.js');
const TARGET=['teamId','projectId','projectRevision','grantRevision'],CHUNK_BYTES=1048576;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const matches=(re,v)=>typeof v==='string'&&re.exec(v)?.[0]===v;
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>new ClientError(code,message);
const changed=()=>fail('WORKPAPER_SOURCE_CHANGED','底稿来源、项目或当前授权已改变；已发操作请核对原编号。');
const busy=()=>fail('WORKPAPER_SOURCE_BUSY','底稿来源选择或操作仍在处理中，请先核对原编号。');
function wipe(bytes){try{bytes?.fill(0);}catch{}}
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype)return false;const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);return names.length===keys.length&&names.every(k=>typeof k==='string'&&keys.includes(k)&&ds[k].enumerable&&Object.hasOwn(ds[k],'value'));}
function dense(v,max){if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length>max)return false;const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);return keys.length===v.length+1&&keys.every(k=>k==='length'||typeof k==='string'&&matches(/^(?:0|[1-9][0-9]*)$/,k)&&Number(k)<v.length&&ds[k].enumerable&&Object.hasOwn(ds[k],'value'));}
const scoped=v=>matches(ID,v.teamId)&&matches(ID,v.projectId)&&integer(v.projectRevision,1)&&integer(v.grantRevision,1);
const sameTarget=(a,b)=>TARGET.every(k=>a[k]===b[k]);
const sameOperation=(s,v)=>!!s&&s.teamId===v.teamId&&s.projectId===v.projectId&&s.handle===v.requestId;
const definite=error=>/^HTTP_(?:400|403|404|409|413|429)$/.test(error?.code??'');
function validateSummary(v,length){
 const keys=['sourceProjectId','workspaceRevision','recordSha256','packageSha256','byteLength','originalCount','originalBytes','freezeCount'];
 if(!exact(v,keys)||!matches(UUID,v.sourceProjectId)||v.sourceProjectId===codec.TRIAL_ID||!integer(v.workspaceRevision,1)||!matches(HASH,v.recordSha256)||!matches(HASH,v.packageSha256)||v.byteLength!==length||!integer(v.originalCount)||v.originalCount>218||!integer(v.originalBytes)||v.originalBytes>codec.LIMITS.originalBytes||!integer(v.freezeCount)||v.freezeCount>512)throw fail('WORKPAPER_SOURCE_INVALID','底稿包核验结果无法确认，来源未上传。');
}
function validateReceipt(receipt,requestId,s){
 const keys=['requestId','version','recordRevision','recordSha256','kind','actorName','committedAt','sourceProjectId','sourcePackageSha256'];
 if(!exact(receipt,keys)||receipt.requestId!==requestId||receipt.version!==1||receipt.kind!=='import'||!integer(receipt.recordRevision,1)||!matches(HASH,receipt.recordSha256)||!matches(UUID,receipt.sourceProjectId)||!matches(HASH,receipt.sourcePackageSha256)||typeof receipt.actorName!=='string'||!receipt.actorName||!receipt.actorName.isWellFormed()||[...receipt.actorName].length>80||/[\p{Cc}\p{Cf}]/u.test(receipt.actorName)||!integer(receipt.committedAt))throw fail('INVALID_RESPONSE','底稿迁入回执无法确认，请保留原编号查询。');
 if(s&&(receipt.sourceProjectId!==s.summary.sourceProjectId||receipt.sourcePackageSha256!==s.packageSha256||receipt.recordRevision!==s.summary.workspaceRevision||receipt.recordSha256!==s.summary.recordSha256))throw fail('INVALID_RESPONSE','底稿迁入回执与所选原包不一致，请核对原编号。');
 return {...receipt};
}
function validateStage(value,requestId,s){
 if(!exact(value,Object.hasOwn(value??{},'receipt')?['stage','receipt']:['stage']))throw fail('INVALID_RESPONSE','底稿上传状态无法确认。');
 const stage=value.stage,keys=['requestId','status','byteLength','chunkBytes','expiresAt','receivedChunks'];
 if(!exact(stage,keys)||stage.requestId!==requestId||!['active','published','canceled','expired'].includes(stage.status)||!integer(stage.byteLength,1)||stage.byteLength>codec.LIMITS.packageBytes||stage.chunkBytes!==CHUNK_BYTES||!integer(stage.expiresAt)||!dense(stage.receivedChunks,530))throw fail('INVALID_RESPONSE','底稿上传状态无法确认。');
 const count=Math.ceil(stage.byteLength/CHUNK_BYTES);if(stage.receivedChunks.length>count||stage.receivedChunks.some((n,i)=>!integer(n)||n>=count||i&&n<=stage.receivedChunks[i-1])||stage.status!=='active'&&stage.receivedChunks.length||s&&stage.byteLength!==s.bytes.length||stage.status==='published'!==Object.hasOwn(value,'receipt'))throw fail('INVALID_RESPONSE','底稿上传分块状态无法确认。');
 const receipt=stage.status==='published'?validateReceipt(value.receipt,requestId,s):null;
 return{stage:{...stage,receivedChunks:[...stage.receivedChunks]},...(receipt?{receipt}:{})};
}

function createWorkpaperSourceManager({client,dialog,window,fsImpl=fs}={}){
 const methods=['guardSession','onProjectMigrationContextChange','getWorkpaperImportCapabilities','beginWorkpaperImport','putWorkpaperImportChunk','getWorkpaperImportStatus','cancelWorkpaperImport','commitWorkpaperImport'];
 if(!client||!methods.every(k=>typeof client[k]==='function')||typeof dialog?.showOpenDialog!=='function')throw fail('INVALID_WORKPAPER_CLIENT','底稿迁入服务尚未准备好。');
 let source=null,epoch=0,opening=false,mutation=null,disposed=false,selectionController=null;
 function clear(){epoch++;selectionController?.abort();mutation?.controller.abort();wipe(source?.bytes);source=null;}
 const unsubscribe=client.onProjectMigrationContextChange(clear);
 const checkWindow=()=>{if(disposed||typeof window?.isDestroyed==='function'&&window.isDestroyed())throw changed();};
 async function context(target,check){
  check();let a;try{a=await client.getWorkpaperImportCapabilities({teamId:target.teamId,projectId:target.projectId},{assertCurrent:check});}catch(error){check();if(/^HTTP_(?:403|404|409)$/.test(error?.code??''))throw changed();throw error;}check();
  if(!exact(a,['teamId','projectId','sourceProjectId','projectRevision','grantRevision','chunkBytes','maxPackageBytes'])||!sameTarget(a,target)||!matches(UUID,a.sourceProjectId)||a.sourceProjectId===codec.TRIAL_ID||a.chunkBytes!==CHUNK_BYTES||a.maxPackageBytes!==codec.LIMITS.packageBytes)throw changed();return a;
 }
 async function readFile(filename,check){
  let handle,bytes;
  try{
   check();handle=await fsImpl.open(filename,'r');check();const stat=await handle.stat();check();
   if(!stat.isFile()||!integer(stat.size,1)||stat.size>codec.LIMITS.packageBytes)throw fail('WORKPAPER_SOURCE_INVALID','请选择不超过530MiB、由旧版显式导出的完整底稿包。');
   bytes=new Uint8Array(stat.size);let offset=0;
   while(offset<bytes.length){check();const size=Math.min(65536,bytes.length-offset),part=await handle.read(bytes,offset,size,null);check();if(!integer(part?.bytesRead,1)||part.bytesRead>size)throw fail('WORKPAPER_SOURCE_INVALID','完整底稿包未读完或读取期间发生变化。');offset+=part.bytesRead;}
   const extra=new Uint8Array(1);try{const part=await handle.read(extra,0,1,null);check();if(part?.bytesRead!==0)throw fail('WORKPAPER_SOURCE_INVALID','完整底稿包读取期间发生变化。');}finally{extra.fill(0);}
   const final=await handle.stat();check();if(!final.isFile()||final.size!==stat.size)throw fail('WORKPAPER_SOURCE_INVALID','完整底稿包读取期间发生变化。');
   const result=bytes;bytes=null;return result;
  }finally{wipe(bytes);await handle?.close();}
 }
 async function chooseWorkpaperSource(input){
  if(!exact(input,TARGET)||!scoped(input))throw fail('INVALID_INPUT','请先刷新当前项目的底稿迁入权限和版本。');
  checkWindow();if(opening||mutation||source?.attempted)throw busy();const target={...input},guard=client.guardSession();guard();clear();opening=true;const at=epoch,controller=new AbortController();selectionController=controller;
  const check=()=>{checkWindow();guard();if(at!==epoch||controller.signal.aborted)throw changed();};let bytes;
  try{
   const before=await context(target,check),selection=await dialog.showOpenDialog(window,{title:'选择旧版导出的完整底稿包',buttonLabel:'核对底稿包来源',properties:['openFile'],filters:[{name:'完整底稿包ZIP',extensions:['zip']}]});check();
   if(selection.canceled)return{status:'cancelled'};
   if(!Array.isArray(selection.filePaths)||selection.filePaths.length!==1||typeof selection.filePaths[0]!=='string'||!selection.filePaths[0]||selection.filePaths[0].includes('\0'))throw fail('WORKPAPER_SOURCE_INVALID','请只选择一个完整底稿包文件。');
   const current=await context(target,check);if(current.sourceProjectId!==before.sourceProjectId)throw changed();
   bytes=await readFile(selection.filePaths[0],check);const length=bytes.length;let inspected;
   try{inspected=await inspectWorkpaperPackage(bytes,{signal:controller.signal,assertCurrent:check});}catch(error){check();throw fail('WORKPAPER_SOURCE_INVALID','完整底稿包格式、原件或既有冻结快照未通过核验，来源未上传。');}
   bytes=inspected.bytes;check();if(bytes.length!==length)throw fail('WORKPAPER_SOURCE_INVALID','底稿包核验字节长度不一致。');validateSummary(inspected.summary,length);
   if(inspected.summary.sourceProjectId!==current.sourceProjectId)throw fail('WORKPAPER_SOURCE_INVALID','完整底稿包不属于当前项目已确认的来源Q。');
   const after=await context(target,check);if(after.sourceProjectId!==current.sourceProjectId)throw changed();
   const handle=randomUUID(),summary={...inspected.summary};source={...target,handle,packageSha256:summary.packageSha256,summary,bytes,guard,phase:'selected',attempted:false,commitUncertain:false};bytes=null;
   return{status:'selected',handle,packageSha256:summary.packageSha256,summary:{sourceProjectId:summary.sourceProjectId,workspaceRevision:summary.workspaceRevision,byteLength:summary.byteLength,originalCount:summary.originalCount,originalBytes:summary.originalBytes,freezeCount:summary.freezeCount}};
  }catch(error){throw error instanceof ClientError?error:fail('WORKPAPER_SOURCE_INVALID','完整底稿包无法安全读取或核验，来源未上传。');}
  finally{wipe(bytes);opening=false;if(selectionController===controller)selectionController=null;}
 }
 function confirmation(input){
  const keys=[...TARGET,'handle','packageSha256','currentPassword','sourceVerified','confirmed'];
  if(!exact(input,keys)||!scoped(input)||!matches(UUID,input.handle)||!matches(HASH,input.packageSha256)||typeof input.currentPassword!=='string'||!input.currentPassword||Buffer.byteLength(input.currentPassword)>512||input.sourceVerified!==true||input.confirmed!==true)throw fail('INVALID_INPUT','请核验完整底稿包、明确确认并输入当前密码。');
  checkWindow();if(opening||mutation)throw busy();const s=source;if(!s||s.handle!==input.handle||s.packageSha256!==input.packageSha256||!sameTarget(s,input))throw changed();s.guard();return s;
 }
 function finishImported(s,receipt){const value=validateReceipt(receipt,s.handle,s);if(source===s)clear();else wipe(s.bytes);return{status:'imported',requestId:s.handle,receipt:value};}
 async function runImport(input,resume){
  const s=confirmation(input);if(!resume&&s.attempted||resume&&!s.attempted)throw fail('WORKPAPER_IMPORT_QUERY_REQUIRED','请核对原上传编号；不会自动重新建立或重复提交。');
  const at=epoch,controller=new AbortController(),operation={controller},check=()=>{checkWindow();s.guard();if(source!==s||at!==epoch||controller.signal.aborted)throw changed();};let phase='preflight',dispatched=false,password=input.currentPassword;mutation=operation;
  const options=()=>({assertCurrent:check,signal:controller.signal,onDispatch(){dispatched=true;}});
  try{
   check();let received=new Set(),retryBegin=false;
   if(resume){
    phase='query';let value;try{value=await client.getWorkpaperImportStatus({teamId:s.teamId,projectId:s.projectId,requestId:s.handle},{assertCurrent:check,signal:controller.signal});}catch(error){if(error?.code==='HTTP_404'){await context(s,check);if(s.beginRetryAllowed&&!s.beginKnown)retryBegin=true;else return{status:'unknown',requestId:s.handle,phase:s.phase};}else throw error;}
    check();if(!retryBegin){const result=validateStage(value,s.handle,s);
     if(result.stage.status==='published')return finishImported(s,result.receipt);
     if(result.stage.status!=='active'){clear();return{status:result.stage.status,requestId:s.handle};}
     if(s.commitUncertain)return{status:'unknown',requestId:s.handle,phase:'commit'};
     received=new Set(result.stage.receivedChunks);
    }else{
     // Only an explicit user resume after a definite begin429 may retry begin.
     // Reinspect the private original, never reread or silently replace the file.
     const inspected=await inspectWorkpaperPackage(s.bytes,{signal:controller.signal,assertCurrent:check});s.bytes=inspected.bytes;check();validateSummary(inspected.summary,s.summary.byteLength);
     if(inspected.summary.packageSha256!==s.packageSha256||inspected.summary.recordSha256!==s.summary.recordSha256||inspected.summary.sourceProjectId!==s.summary.sourceProjectId)throw changed();
    }
   }
   const cap=await context(s,check);if(cap.sourceProjectId!==s.summary.sourceProjectId)throw changed();
   if(!resume||retryBegin){
    phase='begin';dispatched=false;s.attempted=true;s.phase=phase;s.beginRetryAllowed=false;
    const started=await client.beginWorkpaperImport({...Object.fromEntries(TARGET.map(k=>[k,s[k]])),requestId:s.handle,sourceProjectId:s.summary.sourceProjectId,packageSha256:s.packageSha256,byteLength:s.bytes.length,chunkCount:Math.ceil(s.bytes.length/CHUNK_BYTES)},options());check();
    if(!exact(started,['requestId','chunkBytes','expiresAt'])||started.requestId!==s.handle||started.chunkBytes!==CHUNK_BYTES||!integer(started.expiresAt))throw fail('INVALID_RESPONSE','底稿上传建立结果无法确认，请查询原编号。');s.beginKnown=true;
   }
   const count=Math.ceil(s.bytes.length/CHUNK_BYTES);
   for(let index=0;index<count;index++){
    if(received.has(index))continue;check();phase='chunk';dispatched=false;s.phase=phase;const bytes=s.bytes.subarray(index*CHUNK_BYTES,Math.min((index+1)*CHUNK_BYTES,s.bytes.length));
    const body={teamId:s.teamId,projectId:s.projectId,requestId:s.handle,chunkIndex:index,sha256:sha(bytes),data:Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64')};
    try{const ack=await client.putWorkpaperImportChunk(body,options());check();if(!exact(ack,['requestId','index','received'])||ack.requestId!==s.handle||ack.index!==index||ack.received!==true)throw fail('INVALID_RESPONSE','底稿分块上传结果无法确认，请查询原编号。');}finally{body.data='';}
   }
   phase='precommit';dispatched=false;const final=await context(s,check);if(final.sourceProjectId!==s.summary.sourceProjectId)throw changed();
   phase='commit';s.phase=phase;const body={...Object.fromEntries(TARGET.map(k=>[k,s[k]])),requestId:s.handle,currentPassword:password,sourceVerified:true,confirmed:true};
   try{const receipt=await client.commitWorkpaperImport(body,options());check();return finishImported(s,receipt);}finally{body.currentPassword='';}
  }catch(error){
   if(error?.code==='WORKPAPER_SOURCE_CHANGED'){if(source===s)clear();}
   if(dispatched&&!definite(error)){if(phase==='commit')s.commitUncertain=true;return{status:'unknown',requestId:s.handle,phase};}
   if(error?.code==='HTTP_429'&&s.attempted){if(phase==='begin'&&!s.beginKnown)s.beginRetryAllowed=true;return{status:'paused',requestId:s.handle,phase};}
   throw error instanceof ClientError?error:fail('WORKPAPER_IMPORT_FAILED','底稿迁入未完成；请按原编号核对，不会自动重发。');
  }finally{password='';if(mutation===operation)mutation=null;}
 }
 function queryInput(v,cancel=false){const keys=['teamId','projectId','requestId',...(cancel?['confirmed']:[])];if(!exact(v,keys)||!matches(ID,v.teamId)||!matches(ID,v.projectId)||!matches(UUID,v.requestId)||cancel&&v.confirmed!==true)throw fail('INVALID_INPUT','请核对原底稿上传编号。');checkWindow();if(opening||mutation)throw busy();return{...v};}
 async function inspectStatus(v,check){const value=await client.getWorkpaperImportStatus({teamId:v.teamId,projectId:v.projectId,requestId:v.requestId},{assertCurrent:check});check();return validateStage(value,v.requestId,sameOperation(source,v)?source:null);}
 async function queryWorkpaperImport(input){
  const v=queryInput(input),guard=client.guardSession(),at=epoch,check=()=>{checkWindow();guard();if(at!==epoch)throw changed();};
  try{const value=await inspectStatus(v,check);if(value.stage.status==='published'){const receipt=value.receipt;if(sameOperation(source,v))clear();return{status:'imported',requestId:v.requestId,receipt};}if(value.stage.status!=='active'){if(sameOperation(source,v))clear();return{status:value.stage.status,requestId:v.requestId};}return{status:'active',requestId:v.requestId,receivedChunks:value.stage.receivedChunks.length,totalChunks:Math.ceil(value.stage.byteLength/CHUNK_BYTES),expiresAt:value.stage.expiresAt};}
  catch(error){if(error?.code==='HTTP_404')return{status:'unknown',requestId:v.requestId,phase:'query'};throw error instanceof ClientError?error:fail('WORKPAPER_IMPORT_QUERY_FAILED','原底稿上传状态暂时无法核对。');}
 }
 async function cancelWorkpaperSourceImport(input){
  const v=queryInput(input,true),guard=client.guardSession(),at=epoch,controller=new AbortController(),operation={controller},check=()=>{checkWindow();guard();if(at!==epoch||controller.signal.aborted)throw changed();};let dispatched=false;mutation=operation;
  try{
   let value;try{value=await inspectStatus(v,check);}catch(error){if(error?.code==='HTTP_404')return{status:'unknown',requestId:v.requestId,phase:'cancel'};throw error;}
   if(value.stage.status==='published'){if(sameOperation(source,v))clear();return{status:'imported',requestId:v.requestId,receipt:value.receipt};}
   const result=await client.cancelWorkpaperImport({teamId:v.teamId,projectId:v.projectId,requestId:v.requestId},{assertCurrent:check,signal:controller.signal,onDispatch(){dispatched=true;}});check();if(!exact(result,['canceled'])||result.canceled!==true)throw fail('INVALID_RESPONSE','取消结果无法核对。');if(sameOperation(source,v))clear();return{status:'canceled',requestId:v.requestId};
  }catch(error){if(dispatched&&(!definite(error)||error?.code==='HTTP_409'))return{status:'unknown',requestId:v.requestId,phase:'cancel'};throw error instanceof ClientError?error:fail('WORKPAPER_IMPORT_CANCEL_FAILED','取消未完成；请核对原上传编号。');}
  finally{if(mutation===operation)mutation=null;}
 }
 return Object.freeze({chooseWorkpaperSource,confirmWorkpaperImport:input=>runImport(input,false),resumeWorkpaperImport:input=>runImport(input,true),queryWorkpaperImport,cancelWorkpaperSourceImport,clearSource:clear,
  discardWorkpaperSource(input){if(!exact(input,['handle'])||!matches(UUID,input.handle))throw fail('INVALID_INPUT','底稿来源句柄无效。');if(source?.handle!==input.handle)return{discarded:false};const requestId=source.attempted?source.handle:null;clear();return{discarded:true,...(requestId?{requestId,remoteStageUnchanged:true}:{})};},
  dispose(){if(disposed)return;disposed=true;clear();unsubscribe?.();}
 });
}
module.exports={createWorkpaperSourceManager};
