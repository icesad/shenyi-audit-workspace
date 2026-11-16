'use strict';
const {createHash}=require('node:crypto');
const plans=require('../shared/task-originals-export.cjs');
const {ClientError}=require('./team-client.cjs');

const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const failure=(code,message)=>new ClientError(code,message);
function exact(value,keys){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)return false;
 const fields=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(fields);
 return names.length===keys.length&&names.every(key=>typeof key==='string'&&keys.includes(key)&&fields[key].enumerable&&Object.hasOwn(fields[key],'value'));
}

function createTaskSubmissionPreviewManager({client,openWindow,setIntervalImpl=setInterval,clearIntervalImpl=clearInterval,setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout}={}){
 const methods=['guardSession','onProjectMigrationContextChange','getTaskExportPlan','getProjectTaskExportPlan','download','checkAttachmentAccess','getProjectSubmissionFile','authorizeProjectSubmissionDownload'];
 if(!client||typeof openWindow!=='function'||!methods.every(name=>typeof client[name]==='function'))throw failure('INVALID_PREVIEW_CLIENT','采集原件预览服务尚未准备好。');
 let current=null,disposed=false;
 const used=new Set();
 function stop(job,fromWindow=false){
  if(!job||job.closed)return false;
  job.closed=true;if(current===job)current=null;
  if(job.interval!==null)clearIntervalImpl(job.interval);
  if(job.deadline!==null)clearTimeoutImpl(job.deadline);
  job.interval=job.deadline=null;
  job.bytes?.fill(0);job.bytes=null;job.metadata=null;job.planSha256=null;
  job.rejectClosed(failure('PREVIEW_CLOSED','本次采集原件预览已关闭，请重新选择。'));
  if(!fromWindow)try{job.window?.close();}catch{}
  return true;
 }
 function check(job){if(disposed||job.closed||current!==job)throw failure('PREVIEW_CLOSED','本次采集原件预览已关闭，请重新选择。');job.guard();}
 const wait=(job,promise)=>Promise.race([promise,job.closedPromise]);
 function closeAll(){return stop(current);}
 const unsubscribe=client.onProjectMigrationContextChange(closeAll);
 async function readPlan(job){
  check(job);
  const value=await wait(job,client[job.review?'getProjectTaskExportPlan':'getTaskExportPlan'](job.selection));check(job);
  let plan;try{plan=plans.validatePlan(value);}catch{throw failure('INVALID_RESPONSE','采集原件的范围或完整性无法确认，未打开预览。');}
  const scope=plan.manifest.scope,task=plan.manifest.task,files=plan.manifest.files,input=job.input;
  if(scope.kind!==(job.review?'project-review':'own')||scope.teamId!==input.teamId||scope.taskId!==input.taskId||task.id!==input.taskId||task.revision!==input.revision
   ||job.review&&(scope.projectId!==input.projectId||scope.projectRevision!==input.projectRevision)||files.length!==1||files[0].id!==input.submissionId)throw failure('INVALID_RESPONSE','采集原件清单与当前任务或所选记录不一致，请刷新核对。');
  return plan;
 }
 async function authorize(job){
  check(job);
  const input=job.input,file=job.metadata;
  if(!file||!job.planSha256)throw failure('INVALID_RESPONSE','采集原件来源尚未确认。');
  const target=job.review?{teamId:input.teamId,projectId:input.projectId,taskId:input.taskId,submissionId:input.submissionId}:{teamId:input.teamId,taskId:input.taskId,attachmentId:file.attachmentId};
  const access=await wait(job,client[job.review?'authorizeProjectSubmissionDownload':'checkAttachmentAccess'](target));check(job);
  if(!exact(access,['canDownload'])||access.canDownload!==true)throw failure('INVALID_RESPONSE','采集原件读取权限无法确认，预览已停止。');
  const plan=await readPlan(job);check(job);
  if(plan.sha256!==job.planSha256)throw failure('PREVIEW_CHANGED','任务、原件或授权版本已变化，本次预览已停止，请刷新核对。');
 }
 async function preview(input,review){
  const keys=['requestId','teamId','taskId','revision','submissionId',...(review?['projectId','projectRevision']:[])];
  if(!exact(input,keys)||!UUID.test(input.requestId)||![input.teamId,input.taskId,input.submissionId,...(review?[input.projectId]:[])].every(id=>typeof id==='string'&&ID.test(id))
   ||!Number.isSafeInteger(input.revision)||input.revision<0||review&&(!Number.isSafeInteger(input.projectRevision)||input.projectRevision<1))throw failure('INVALID_INPUT','采集原件预览参数无效，请刷新任务后重新选择。');
  if(disposed)throw failure('PREVIEW_CLOSED','采集原件预览服务已关闭。');
  const guard=client.guardSession();guard();
  if(used.has(input.requestId))throw failure('PREVIEW_ALREADY_USED','本次预览标识已使用，请重新打开原件。');
  const target=Object.freeze({teamId:input.teamId,taskId:input.taskId,revision:input.revision,submissionId:input.submissionId,...(review?{projectId:input.projectId,projectRevision:input.projectRevision}:{})});
  const selection=Object.freeze({teamId:target.teamId,taskId:target.taskId,revision:target.revision,...(review?{projectId:target.projectId,projectRevision:target.projectRevision}:{}),submissionIds:Object.freeze([target.submissionId])});
  closeAll();
  const job={id:input.requestId,input:target,selection,review,guard,closed:false,window:null,bytes:null,metadata:null,planSha256:null,interval:null,deadline:null,checking:false,sourceUsed:false,sourceDelivered:false,revealUsed:false};
  job.closedPromise=new Promise((_,reject)=>{job.rejectClosed=reject;});job.closedPromise.catch(()=>{});current=job;used.add(job.id);
  try{
   const plan=await readPlan(job);check(job);const metadata=plan.manifest.files[0];
   if(metadata.byteLength===0)throw failure('PREVIEW_EMPTY_FILE','该原件为0字节，无法呈现预览；仍可按原权限下载或导出。');
   job.metadata=Object.freeze({...metadata});job.planSha256=plan.sha256;
   const getTarget=review?{teamId:target.teamId,projectId:target.projectId,taskId:target.taskId,submissionId:target.submissionId}:{teamId:target.teamId,taskId:target.taskId,attachmentId:metadata.attachmentId};
   const file=await wait(job,client[review?'getProjectSubmissionFile':'download'](getTarget));check(job);
   if(!(file?.bytes instanceof Uint8Array)||file.bytes.length!==metadata.byteLength||file.bytes.length<1||file.bytes.length>12*1024*1024)throw failure('PREVIEW_INTEGRITY_FAILED','采集原件长度或SHA不一致，未打开预览。');
   job.bytes=Buffer.from(file.bytes);
   if(digest(job.bytes)!==metadata.sha256)throw failure('PREVIEW_INTEGRITY_FAILED','采集原件长度或SHA不一致，未打开预览。');
   await authorize(job);check(job);
   const getSource=async()=>{
    check(job);if(job.sourceUsed)throw failure('PREVIEW_SOURCE_USED','本次采集原件只交付一次。');job.sourceUsed=true;
    try{await authorize(job);check(job);const source={bytes:new Uint8Array(job.bytes),filename:job.metadata.filename,type:'application/octet-stream',sha256:job.metadata.sha256,byteLength:job.metadata.byteLength};job.sourceDelivered=true;return source;}
    catch(error){stop(job);throw error;}
   };
   const reveal=async()=>{
    check(job);if(!job.sourceDelivered)throw failure('PREVIEW_SOURCE_REQUIRED','采集原件尚未交付，不能显示阅读窗口。');if(job.revealUsed)throw failure('PREVIEW_REVEAL_USED','本次采集原件窗口已经核验显示。');job.revealUsed=true;
    try{await authorize(job);check(job);}catch(error){stop(job);throw error;}
   };
   const opened=openWindow({getSource,authorize:reveal,onClosed:()=>stop(job,true)});
   if(!opened||typeof opened.close!=='function'||!opened.shown||typeof opened.shown.then!=='function')throw failure('INVALID_PREVIEW_WINDOW','采集原件阅读窗口未能建立。');
   const shown=Promise.resolve(opened.shown);shown.catch(()=>{});job.window=opened;
   if(job.closed){try{opened.close();}catch{}check(job);}check(job);
   job.deadline=setTimeoutImpl(()=>stop(job),50000);job.deadline?.unref?.();
   job.interval=setIntervalImpl(()=>{if(job.closed||job.checking)return;job.checking=true;authorize(job).catch(()=>stop(job)).finally(()=>{job.checking=false;});},5000);job.interval?.unref?.();
   await wait(job,shown);check(job);clearTimeoutImpl(job.deadline);job.deadline=null;
   return {opened:true,previewId:job.id,filename:job.metadata.filename,byteLength:job.metadata.byteLength};
  }catch(error){stop(job);throw error;}
 }
 function closeTaskSubmissionPreview(input){if(!exact(input,['previewId'])||typeof input.previewId!=='string'||!UUID.test(input.previewId))throw failure('INVALID_INPUT','采集原件预览标识无效。');return {closed:current?.id===input.previewId?stop(current):false};}
 return Object.freeze({previewTaskSubmission:input=>preview(input,false),previewProjectSubmission:input=>preview(input,true),closeTaskSubmissionPreview,closeAll,dispose(){if(disposed)return;disposed=true;closeAll();unsubscribe?.();used.clear();}});
}
module.exports={createTaskSubmissionPreviewManager};
