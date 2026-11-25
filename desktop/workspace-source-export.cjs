'use strict';
// Main-only saved-source bytes and publication. No renderer path or network API.
const fs=require('node:fs/promises'),path=require('node:path'),{randomBytes}=require('node:crypto');
const {ClientError}=require('./team-client.cjs'),codec=require('../dist/legacy-project-source.js');
const {sourceAccessValue,sourceMetadataValue}=require('./workspace-source-client.cjs');
const MAX_SOURCE_BYTES=128*1024,HASH=/^[a-f0-9]{64}$/;
const failed=(code,message)=>new ClientError(code,message);
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function fields(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype)return null;const ds=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(ds);if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))return null;return Object.fromEntries(names.map(k=>[k,ds[k].value]));}
function workspaceSourceExportInput(value){
 const v=fields(value,['requestId','teamId','projectId','projectRevision','grantRevision','confirmed']);
 if(!v||typeof v.requestId!=='string'||!UUID.test(v.requestId)||!['teamId','projectId'].every(k=>typeof v[k]==='string'&&ID.test(v[k]))||!Number.isSafeInteger(v.projectRevision)||v.projectRevision<1||!Number.isSafeInteger(v.grantRevision)||v.grantRevision<1||v.confirmed!==true)throw failed('INVALID_INPUT','请明确确认当前已保存立项来源及本次保存操作。');return {...v};
}
function workspaceSourceCancelInput(value){const v=fields(value,['requestId']);if(!v||typeof v.requestId!=='string'||!UUID.test(v.requestId))throw failed('INVALID_INPUT','本次立项来源保存编号无效。');return {...v};}
// Executing an export needs both independently granted source capabilities.
function workspaceSourceExportAllowed(access){return access?.read===true&&access?.export===true;}
async function inspectWorkspaceSourceBytes(bytes,expectedSha256,assertCurrent){
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_SOURCE_BYTES||typeof expectedSha256!=='string'||!HASH.test(expectedSha256)||typeof assertCurrent!=='function')throw failed('INVALID_RESPONSE','已保存立项来源的字节或校验信息无效，未保存文件。');
 assertCurrent();let inspected;
 try{inspected=await codec.inspect(bytes);}catch{assertCurrent();throw failed('INVALID_RESPONSE','已保存立项来源不是有效的规范JSON，未保存文件。');}
 assertCurrent();if(inspected.sha256!==expectedSha256)throw failed('INVALID_RESPONSE','已保存立项来源SHA-256不一致，未保存文件。');
 return {byteLength:bytes.length,sha256:inspected.sha256,sourceProjectId:inspected.summary.projectId};
}
async function publishWorkspaceSource({destination,bytes,job,check,fresh,fsImpl=fs}={}){
 if(typeof destination!=='string'||!destination.isWellFormed()||!path.isAbsolute(destination)||/[\p{Cc}]/u.test(destination)||!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_SOURCE_BYTES||!job||typeof check!=='function'||typeof fresh!=='function')throw failed('INVALID_INPUT','立项来源保存范围无效。');
 const temporary=path.join(path.dirname(destination),'.shenyi-workspace-source-'+randomBytes(16).toString('hex')+'.tmp');let handle,owned=false,primary;
 try{
  check();handle=await fsImpl.open(temporary,'wx',0o600);owned=true;check();await handle.writeFile(bytes);check();await handle.sync();check();await handle.close();handle=null;check();
  await fresh();check();job.publishing=true;
  try{await fsImpl.rename(temporary,destination);}catch{job.publishUnknown=true;throw failed('WORKSPACE_SOURCE_SAVE_UNKNOWN','立项来源保存结果无法确认，请核对先前选择的位置，勿自动重复保存。');}finally{job.publishing=false;}
  job.published=true;
  try{check();}catch{throw failed('WORKSPACE_SOURCE_PUBLISHED','本次立项来源已保存；当前会话或视图已变化，请在原保存位置核对。');}
 }catch(error){primary=error;}finally{
  if(handle)try{await handle.close();}catch(error){primary??=error;}
  if(owned&&!job.published)try{await fsImpl.unlink(temporary);}catch(cleanup){if(cleanup?.code!=='ENOENT'){
   job.cleanupFailed=true;const note=' 所选目录中可能仍留有本次临时来源 '+path.basename(temporary)+'，请核对并清理。';
   if(primary instanceof ClientError)primary.message+=note;else primary=failed('WORKSPACE_SOURCE_SAVE_FAILED','立项来源未确认保存。'+note);
  }}
 }
 if(primary)throw primary instanceof ClientError?primary:failed('WORKSPACE_SOURCE_SAVE_FAILED','立项来源未确认保存，请核对先前选择的位置；不会自动重复写入。');
 return {published:true};
}
function createWorkspaceSourceExporter({client,dialog,window,fsImpl=fs,canExport=workspaceSourceExportAllowed}={}){
 if(!client||!['guardSession','onProjectMigrationContextChange','getWorkspaceSourceAccess','downloadWorkspaceSource'].every(k=>typeof client[k]==='function')||typeof dialog?.showSaveDialog!=='function'||typeof canExport!=='function')throw failed('INVALID_WORKSPACE_SOURCE_CLIENT','立项来源保存服务尚未准备好。');
 let current=null,disposed=false;const jobs=new Set(),used=new Set();
 function stop(job){if(!job||job.publishing||job.published||job.publishUnknown)return false;job.canceled=true;job.controller.abort();if(current===job)current=null;return true;}
 const clear=()=>{for(const job of jobs)stop(job);},unsubscribe=client.onProjectMigrationContextChange(clear);
 async function run(input){
  const v=workspaceSourceExportInput(input);if(disposed)throw failed('WORKSPACE_SOURCE_EXPORT_CANCELED','立项来源保存服务已关闭。');if(current)throw failed('WORKSPACE_SOURCE_EXPORT_IN_PROGRESS','立项来源仍在保存处理中，请先核对本次操作。');if(used.has(v.requestId))throw failed('WORKSPACE_SOURCE_EXPORT_USED','本次保存编号已使用，请核对原位置，不会自动重复写入。');
  const guard=client.guardSession();guard();const job={id:v.requestId,controller:new AbortController(),canceled:false,publishing:false,published:false};current=job;jobs.add(job);used.add(v.requestId);
  const check=()=>{guard();if(disposed||job.canceled)throw failed('WORKSPACE_SOURCE_EXPORT_CANCELED','本次立项来源保存已停止。');},target={teamId:v.teamId,projectId:v.projectId},bad=()=>{throw failed('INVALID_RESPONSE','来源能力或字节无法核实，未保存来源。');};let bytes;
  const fresh=async()=>{check();const access=sourceAccessValue(await client.getWorkspaceSourceAccess(target,{assertCurrent:check,signal:job.controller.signal}),target,bad);check();if(!access.sourceAvailable||access.projectRevision!==v.projectRevision||access.grantRevision!==v.grantRevision)throw failed('WORKSPACE_SOURCE_CHANGED','来源、项目或授权版本已变化，未继续保存。');if(canExport(access)!==true)throw failed('WORKSPACE_SOURCE_EXPORT_DENIED','当前没有执行本次来源保存的明确权限。');return access;};
  try{
   await fresh();check();const selected=await dialog.showSaveDialog(window,{title:'保存已存立项来源JSON',buttonLabel:'保存来源JSON',defaultPath:'shenyi-initiation-source.json',filters:[{name:'规范立项来源JSON',extensions:['json']}]});check();
   const ds=selected&&Object.getPrototypeOf(selected)===Object.prototype?Object.getOwnPropertyDescriptors(selected):null;
   if(!ds||!Object.hasOwn(ds.canceled??{},'value')||typeof ds.canceled.value!=='boolean')throw failed('WORKSPACE_SOURCE_SAVE_DESTINATION_INVALID','无法确认系统保存对话框结果。');
   if(ds.canceled.value)return {canceled:true,requestId:job.id};
   const destination=ds.filePath&&Object.hasOwn(ds.filePath,'value')?ds.filePath.value:null;
   if(typeof destination!=='string'||!destination.isWellFormed()||!path.isAbsolute(destination)||/[\p{Cc}]/u.test(destination))throw failed('WORKSPACE_SOURCE_SAVE_DESTINATION_INVALID','系统返回的来源保存位置无效，未写入文件。');
   await fresh();check();const result=fields(await client.downloadWorkspaceSource({...target,projectRevision:v.projectRevision,grantRevision:v.grantRevision},{assertCurrent:check,signal:job.controller.signal}),['bytes','metadata']);if(result)bytes=result.bytes;check();if(!result)bad();
   const metadata=sourceMetadataValue(result.metadata,target,bad);if(metadata.projectRevision!==v.projectRevision||metadata.grantRevision!==v.grantRevision||!(bytes instanceof Uint8Array)||bytes.length!==metadata.byteLength)bad();const inspected=await inspectWorkspaceSourceBytes(bytes,metadata.sourceSha256,check);check();if(inspected.sourceProjectId!==metadata.sourceProjectId)bad();await fresh();check();
   await publishWorkspaceSource({destination,bytes,job,check,fresh,fsImpl});return {saved:true,requestId:job.id,filename:path.basename(destination),byteLength:bytes.length,sha256:metadata.sourceSha256};
  }catch(error){if(job.published)throw error instanceof ClientError?error:failed('WORKSPACE_SOURCE_PUBLISHED','本次立项来源已保存，请在原保存位置核对。');if(job.canceled&&!job.cleanupFailed&&!['SESSION_CHANGED','SIGN_IN_REQUIRED'].includes(error?.code))return {canceled:true,requestId:job.id};if(error instanceof ClientError)throw error;throw failed('WORKSPACE_SOURCE_EXPORT_FAILED','本次来源保存结果未确认，请核对原位置；不会自动重复写入。');}
  finally{if(bytes instanceof Uint8Array)bytes.fill(0);jobs.delete(job);if(current===job)current=null;}
 }
 function cancel(input){const v=workspaceSourceCancelInput(input);return {canceled:!!current&&current.id===v.requestId&&stop(current)};}
 return Object.freeze({exportWorkspaceSource:run,cancelWorkspaceSourceExport:cancel,closeAll:clear,dispose(){disposed=true;clear();unsubscribe?.();}});
}
module.exports={MAX_SOURCE_BYTES,inspectWorkspaceSourceBytes,publishWorkspaceSource,workspaceSourceExportInput,workspaceSourceCancelInput,workspaceSourceExportAllowed,createWorkspaceSourceExporter};
