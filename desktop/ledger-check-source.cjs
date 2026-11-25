'use strict';
const fs=require('node:fs/promises'),{randomUUID,createHash}=require('node:crypto');
const {ClientError}=require('./team-client.cjs'),codec=require('../dist/ledger-check-snapshot.js');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
const fail=(code,message)=>new ClientError(code,message);
const changed=()=>fail('LEDGER_SOURCE_CHANGED','所选账表来源、项目或授权已变化；已发导入须按原编号核对。');
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype)return false;const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);return names.length===keys.length&&names.every(k=>typeof k==='string'&&keys.includes(k)&&ds[k].enumerable&&Object.hasOwn(ds[k],'value'));}
const TARGET=['teamId','projectId','projectRevision','grantRevision','headRevision'];
const scoped=v=>typeof v.teamId==='string'&&ID.test(v.teamId)&&typeof v.projectId==='string'&&ID.test(v.projectId)&&integer(v.projectRevision,1)&&integer(v.grantRevision,1)&&integer(v.headRevision)&&v.headRevision<Number.MAX_SAFE_INTEGER;
const sameTarget=(a,b)=>TARGET.every(k=>a[k]===b[k]);
function createLedgerCheckSourceManager({client,dialog,window,fsImpl=fs}={}){
 if(!client||!['guardSession','getLedgerCheckAccess','importLedgerCheckSnapshot','onProjectMigrationContextChange'].every(k=>typeof client[k]==='function')||typeof dialog?.showOpenDialog!=='function')throw fail('INVALID_LEDGER_CLIENT','账表来源导入服务尚未准备好。');
 let source=null,epoch=0,opening=false,mutation=null,disposed=false;
 function clear(){epoch++;source?.bytes.fill(0);source=null;}
 const unsubscribe=client.onProjectMigrationContextChange(clear);
 async function context(target,check){
  check();const a=await client.getLedgerCheckAccess({teamId:target.teamId,projectId:target.projectId},{assertCurrent:check});check();
  if(a.teamId!==target.teamId||a.projectId!==target.projectId||a.read!==true||a.canImport!==true||a.sourceAvailable!==true||!sameTarget(a,target)||typeof a.sourceProjectId!=='string'||!UUID.test(a.sourceProjectId))throw changed();return a;
 }
 async function readFile(filename,check){
  let handle;const chunks=[];let size=0;
  try{
   check();handle=await fsImpl.open(filename,'r');check();const stat=await handle.stat();check();
   if(!stat.isFile()||!integer(stat.size,1)||stat.size>codec.LIMITS.bytes)throw fail('LEDGER_SOURCE_INVALID','请选择不超过32MiB、从旧版显式导出的账表校验快照JSON。');
   for(;;){check();const buffer=Buffer.alloc(Math.min(65536,codec.LIMITS.bytes-size+1));let count=0;
    try{const part=await handle.read(buffer,0,buffer.length,null);check();count=part.bytesRead;if(!integer(count)||count>buffer.length)throw fail('LEDGER_SOURCE_INVALID','来源文件读取未完成。');if(!count)break;size+=count;if(size>codec.LIMITS.bytes)throw fail('LEDGER_SOURCE_INVALID','来源超过32MiB，未裁剪或上传。');chunks.push(Buffer.from(buffer.subarray(0,count)));}finally{buffer.fill(0);}
   }
   check();return Buffer.concat(chunks);
  }finally{for(const b of chunks)b.fill(0);await handle?.close();}
 }
 async function chooseLedgerCheckSource(input){
  if(!exact(input,TARGET)||!scoped(input))throw fail('INVALID_INPUT','请先刷新当前项目的账表导入权限和版本。');
  if(disposed)throw changed();if(opening||mutation)throw fail('LEDGER_SOURCE_BUSY','来源选择或导入仍在处理中，请先核对原操作。');
  const target={...input},guard=client.guardSession();guard();clear();opening=true;const at=epoch,check=()=>{guard();if(disposed||at!==epoch)throw changed();};let bytes;
  try{
   const before=await context(target,check),selected=await dialog.showOpenDialog(window,{title:'选择旧版导出的账表校验快照',buttonLabel:'核对快照来源',properties:['openFile'],filters:[{name:'账表校验快照JSON',extensions:['json']}]});check();
   if(selected.canceled)return {status:'cancelled'};
   if(!Array.isArray(selected.filePaths)||selected.filePaths.length!==1||typeof selected.filePaths[0]!=='string')throw fail('LEDGER_SOURCE_INVALID','请只选择一个快照文件。');
   const current=await context(target,check);if(current.sourceProjectId!==before.sourceProjectId)throw changed();
   bytes=await readFile(selected.filePaths[0],check);let snapshot;
   try{snapshot=await codec.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{check();throw fail('LEDGER_SOURCE_INVALID','快照格式、原输入哈希或保存映射绑定无效；来源未上传。');}
   check();if(snapshot.sourceProjectId!==current.sourceProjectId)throw fail('LEDGER_SOURCE_INVALID','所选快照不属于当前项目已确认的来源Q。');
   const after=await context(target,check);if(after.sourceProjectId!==current.sourceProjectId)throw changed();
   const handle=randomUUID(),sourceSha256=createHash('sha256').update(bytes).digest('hex'),summary={sourceProjectId:snapshot.sourceProjectId,workspaceRevision:snapshot.workspaceRevision,calculatedAt:snapshot.reconciliation.calculatedAt,byteLength:bytes.length,rowCounts:Object.fromEntries(['ledger','trialBalance','statements'].map(k=>[k,snapshot.reconciliation.input[k].rows.length]))};
   source={...target,handle,sourceSha256,sourceProjectId:snapshot.sourceProjectId,bytes,guard};bytes=null;
   return {status:'selected',handle,sourceSha256,summary};
  }catch(error){throw error instanceof ClientError?error:fail('LEDGER_SOURCE_INVALID','快照无法安全读取或预检，来源未上传。');}
  finally{bytes?.fill(0);opening=false;}
 }
 async function confirmLedgerCheckImport(input){
  const keys=[...TARGET,'handle','sourceSha256','currentPassword','sourceVerified','confirmed'];
  if(!exact(input,keys)||!scoped(input)||typeof input.handle!=='string'||!UUID.test(input.handle)||typeof input.sourceSha256!=='string'||!HASH.test(input.sourceSha256)||typeof input.currentPassword!=='string'||!input.currentPassword||Buffer.byteLength(input.currentPassword)>512||input.sourceVerified!==true||input.confirmed!==true)throw fail('INVALID_INPUT','请核验所选快照来源、明确确认并输入当前密码。');
  if(disposed)throw changed();if(opening||mutation)throw fail('LEDGER_SOURCE_BUSY','导入仍在处理中，请先查询原操作。');
  const captured=source;if(!captured||captured.handle!==input.handle||captured.sourceSha256!==input.sourceSha256||!sameTarget(captured,input))throw changed();captured.guard();
  const at=epoch,operation={operationId:captured.handle},body={...Object.fromEntries(TARGET.map(k=>[k,captured[k]])),operationId:captured.handle,sourceJson:'',currentPassword:input.currentPassword,sourceVerified:true,confirmed:true};
  const check=()=>{captured.guard();if(disposed||epoch!==at||source!==captured)throw changed();};let dispatched=false;mutation=operation;
  try{
   check();if(createHash('sha256').update(captured.bytes).digest('hex')!==captured.sourceSha256)throw changed();let snapshot;
   try{body.sourceJson=new TextDecoder('utf-8',{fatal:true}).decode(captured.bytes);snapshot=await codec.parse(body.sourceJson);}catch{check();throw fail('LEDGER_SOURCE_INVALID','私有快照无法重新核验，请重新选择。');}
   check();const a=await context(captured,check);if(snapshot.sourceProjectId!==a.sourceProjectId||a.sourceProjectId!==captured.sourceProjectId)throw changed();
   const receipt=await client.importLedgerCheckSnapshot(body,{assertCurrent:check,onDispatch(){dispatched=true;}});check();
   if(!receipt||receipt.operationId!==captured.handle||receipt.sourceSha256!==captured.sourceSha256||receipt.version!==captured.headRevision+1)throw fail('INVALID_RESPONSE','导入回执无法核实，请按原操作编号查询。');
   return {status:'imported',receipt};
  }catch(error){
   const definite=/^HTTP_(?:400|403|404|409|413|429)$/.test(error?.code??'');
   if(dispatched&&!definite)return {status:'unknown',operationId:operation.operationId};
   throw error instanceof ClientError?error:fail('LEDGER_IMPORT_FAILED','导入未完成；已发操作请先查询原编号，不会自动重发。');
  }finally{if(mutation===operation)mutation=null;if(source===captured)clear();captured.bytes.fill(0);body.currentPassword='';body.sourceJson='';}
 }
 return Object.freeze({chooseLedgerCheckSource,confirmLedgerCheckImport,clearSource:clear,
  discardLedgerCheckSource(input){if(!exact(input,['handle'])||typeof input.handle!=='string'||!UUID.test(input.handle))throw fail('INVALID_INPUT','快照句柄无效。');if(source?.handle!==input.handle)return {discarded:false};clear();return {discarded:true};},
  dispose(){if(disposed)return;disposed=true;clear();unsubscribe?.();}
 });
}
module.exports={createLedgerCheckSourceManager};
