'use strict';
const {createHash}=require('node:crypto');
const preservation=require('../dist/material-preservation.js');
const {ClientError}=require('./team-client.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,FILE_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,HASH=/^[a-f0-9]{64}$/;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const failure=(code,message)=>new ClientError(code,message);
const exact=(value,keys)=>!!value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

function createMaterialPreviewManager({client,openWindow,setIntervalImpl=setInterval,clearIntervalImpl=clearInterval,setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout}={}){
 if(!client||typeof openWindow!=='function'||!['guardSession','onProjectMigrationContextChange','getProjectMaterials','getProjectMaterialFile','getProjectMaterialPreviewHead'].every(name=>typeof client[name]==='function'))throw failure('INVALID_PREVIEW_CLIENT','原件预览服务尚未准备好。');
 let current=null,disposed=false;const used=new Set();
 function stop(job,fromWindow=false){
  if(!job||job.closed)return false;job.closed=true;if(current===job)current=null;
  if(job.interval!==null)clearIntervalImpl(job.interval);if(job.deadline!==null)clearTimeoutImpl(job.deadline);job.interval=job.deadline=null;
  job.bytes?.fill(0);job.bytes=null;job.metadata=null;job.snapshot=null;job.rejectClosed(failure('PREVIEW_CLOSED','本次原件预览已关闭，请重新选择。'));
  if(!fromWindow)try{job.window?.close();}catch{}
  return true;
 }
 function check(job){if(disposed||job.closed||current!==job)throw failure('PREVIEW_CLOSED','本次原件预览已关闭，请重新选择。');job.guard();}
 const wait=(job,promise)=>Promise.race([promise,job.closedPromise]);
 async function authorize(job){
  check(job);const value=await wait(job,client.getProjectMaterialPreviewHead(job.input));check(job);const expected=job.snapshot;
  if(!exact(value,['projectRevision','materialRevision','sha256','byteLength'])||!expected||Object.keys(expected).some(key=>value[key]!==expected[key]))throw failure('MATERIAL_CHANGED','原件、资料或权限版本已变化，本次预览已终止。');
 }
 function closeAll(){return stop(current);}
 const unsubscribe=client.onProjectMigrationContextChange(closeAll);
 async function previewProjectMaterial(input){
  if(!exact(input,['requestId','teamId','projectId','fileId'])||!UUID.test(input.requestId)||!ID.test(input.teamId)||!ID.test(input.projectId)||!FILE_ID.test(input.fileId))throw failure('INVALID_INPUT','原件预览参数无效，请重新选择历史原件。');
  if(disposed)throw failure('PREVIEW_CLOSED','原件预览服务已关闭。');const guard=client.guardSession();guard();if(used.has(input.requestId))throw failure('PREVIEW_ALREADY_USED','本次预览标识已使用，请重新打开原件。');
  closeAll();const job={id:input.requestId,input:{teamId:input.teamId,projectId:input.projectId,fileId:input.fileId},guard,closed:false,window:null,bytes:null,metadata:null,snapshot:null,interval:null,deadline:null,checking:false,sourceUsed:false};
  job.closedPromise=new Promise((_,reject)=>{job.rejectClosed=reject;});job.closedPromise.catch(()=>{});current=job;used.add(job.id);
  try{
   const view=await wait(job,client.getProjectMaterials({teamId:input.teamId,projectId:input.projectId}));check(job);
   if(!view?.record||view.projectId!==input.projectId||!Number.isSafeInteger(view.projectRevision)||view.projectRevision<1||!Number.isSafeInteger(view.materialRevision)||view.materialRevision<1||!HASH.test(view.recordSha256??'')||digest(JSON.stringify(view.record))!==view.recordSha256)throw failure('INVALID_RESPONSE','资料历史无法确认，未打开原件。');
   let metadata;try{metadata=preservation.filesFor(view.record).find(file=>file.id===input.fileId);}catch{throw failure('INVALID_RESPONSE','资料历史无法确认，未打开原件。');}
   if(view.record.project.quoteId!==input.projectId||!metadata)throw failure('HTTP_404','该原件不属于当前项目资料历史。');
   job.metadata=Object.freeze({filename:metadata.name,type:metadata.type,sha256:metadata.sha256,byteLength:metadata.size});job.snapshot=Object.freeze({projectRevision:view.projectRevision,materialRevision:view.materialRevision,sha256:metadata.sha256,byteLength:metadata.size});
   const file=await wait(job,client.getProjectMaterialFile(job.input));check(job);
   if(!(file?.bytes instanceof Uint8Array)||file.bytes.length!==metadata.size||file.bytes.length<1||file.bytes.length>12*1024*1024)throw failure('MATERIAL_INTEGRITY_FAILED','原件长度或SHA无法确认，未打开预览。');
   job.bytes=Buffer.from(file.bytes);if(digest(job.bytes)!==metadata.sha256)throw failure('MATERIAL_INTEGRITY_FAILED','原件长度或SHA无法确认，未打开预览。');
   await authorize(job);check(job);
   const getSource=async()=>{check(job);if(job.sourceUsed)throw failure('PREVIEW_SOURCE_USED','本次原件只交付一次。');job.sourceUsed=true;try{await authorize(job);check(job);return {bytes:new Uint8Array(job.bytes),...job.metadata};}catch(error){stop(job);throw error;}};
   const reveal=async()=>{try{await authorize(job);check(job);}catch(error){stop(job);throw error;}};
   const opened=openWindow({getSource,authorize:reveal,onClosed:()=>stop(job,true)});
   if(!opened||typeof opened.close!=='function'||!opened.shown||typeof opened.shown.then!=='function')throw failure('INVALID_PREVIEW_WINDOW','原件阅读窗口未能建立。');
   const shown=Promise.resolve(opened.shown);shown.catch(()=>{});
   job.window=opened;if(job.closed){try{opened.close();}catch{}check(job);}check(job);
   job.deadline=setTimeoutImpl(()=>stop(job),50000);job.deadline?.unref?.();
   job.interval=setIntervalImpl(()=>{if(job.closed||job.checking)return;job.checking=true;authorize(job).catch(()=>stop(job)).finally(()=>{job.checking=false;});},5000);job.interval?.unref?.();
   await wait(job,shown);check(job);clearTimeoutImpl(job.deadline);job.deadline=null;
   return {opened:true,previewId:job.id,filename:job.metadata.filename,byteLength:job.metadata.byteLength};
  }catch(error){stop(job);throw error;}
 }
 function closeProjectMaterialPreview(input){if(!exact(input,['previewId'])||!UUID.test(input.previewId))throw failure('INVALID_INPUT','原件预览标识无效。');return {closed:current?.id===input.previewId?stop(current):false};}
 return Object.freeze({previewProjectMaterial,closeProjectMaterialPreview,closeAll,dispose(){if(disposed)return;disposed=true;closeAll();unsubscribe?.();used.clear();}});
}
module.exports={createMaterialPreviewManager};
