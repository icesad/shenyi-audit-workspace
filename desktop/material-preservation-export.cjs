'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {randomBytes}=require('node:crypto');
const {ClientError}=require('./team-client.cjs');
const defaultCodec=require('../dist/material-preservation.js');
const {validateMaterialExportPlan,ORIGIN_KEYS,canonical,digest,PACKAGE_MAX}=require('./material-preservation-export-client.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const matches=(pattern,value)=>typeof value==='string'&&pattern.test(value);
const failed=(code,message)=>new ClientError(code,message),exact=(v,keys)=>{if(!v||Object.getPrototypeOf(v)!==Object.prototype)return false;const names=Reflect.ownKeys(v),ds=Object.getOwnPropertyDescriptors(v);return names.length===keys.length&&names.every(k=>typeof k==='string'&&keys.includes(k)&&ds[k].enumerable&&Object.hasOwn(ds[k],'value'));};
function createMaterialPreservationExporter({client,dialog,window,fsImpl=fs,codec=defaultCodec}={}){
 if(!client||!['guardSession','onProjectMigrationContextChange','getProject','getProjectMaterialExportPlan','downloadProjectMaterialExport'].every(k=>typeof client[k]==='function')||typeof dialog?.showSaveDialog!=='function'||typeof codec?.inspect!=='function'||typeof codec?.filesFor!=='function')throw failed('INVALID_EXPORT_CLIENT','资料保全服务尚未准备好。');
 let current=null,disposed=false;const jobs=new Set(),used=new Set();
 function stop(job){if(!job||job.publishing||job.published)return false;job.canceled=true;job.controller.abort();if(current===job)current=null;return true;}
 function clear(){for(const job of jobs)stop(job);}
 const unsubscribe=client.onProjectMigrationContextChange(clear);
 function validateInput(input){if(!exact(input,['requestId','teamId','projectId','projectRevision','materialRevision','recordSha256','confirmed'])||!matches(UUID,input.requestId??'')||!matches(ID,input.teamId??'')||!matches(ID,input.projectId??'')||!Number.isSafeInteger(input.projectRevision)||input.projectRevision<1||!Number.isSafeInteger(input.materialRevision)||input.materialRevision<1||!matches(HASH,input.recordSha256??'')||input.confirmed!==true)throw failed('INVALID_INPUT','请明确确认当前完整资料及全部历史原件范围。');}
 function parsePlan(value,target){try{return validateMaterialExportPlan(value,target);}catch{throw failed('INVALID_RESPONSE','资料保全计划无法确认，未保存文件。');}}
 function identity(project,input){const p=project?.project,marked=!!p&&Object.hasOwn(p,'kind'),keys=['id','title','status','revision','canRead','canManageAccess','canCreateTask','canReview',...(marked?['kind','businessConfirmed']:[])];if(!exact(p,keys)||p.id!==input.projectId||!['active','frozen'].includes(p.status)||p.revision!==input.projectRevision||marked&&(p.kind!=='collection-workspace'||p.businessConfirmed!==true))throw failed('MATERIAL_EXPORT_CHANGED','项目身份或版本无法确认，请刷新核对。');return {kind:marked?'collection-workspace':'legacy',status:p.status};}
 function verifyPackage(parsed,plan){
  if(parsed?.manifest?.schemaVersion!==2||!exact(parsed.manifest.origin,ORIGIN_KEYS))throw failed('INVALID_RESPONSE','资料保全包来源无法确认，未保存文件。');
  const m=parsed.manifest,r=parsed.record,origin=m.origin;
  for(const k of ORIGIN_KEYS)if(origin[k]!==plan[k])throw failed('MATERIAL_EXPORT_CHANGED','资料保全包与当前计划不一致，未保存文件。');
  if(m.projectId!==plan.sourceProjectId||r?.project?.quoteId!==plan.sourceProjectId||m.sourceNamespace!=='hengdu.audit.materials.v1')throw failed('INVALID_RESPONSE','资料原业务身份不一致，未保存文件。');
  const raw=Buffer.from(JSON.stringify(r),'utf8'),files=codec.filesFor(r);
  const rebuilt={...origin,recordSchema:r.schema,recordRevision:r.revision,generationId:r.schema===2?r.generationId:null,fileCount:files.length,originalByteLength:files.reduce((n,f)=>n+f.size,0),packageByteLimit:PACKAGE_MAX};
  if(raw.length!==plan.recordByteLength||digest(raw)!==plan.recordSha256||digest(canonical(files))!==plan.filesSha256||!Array.isArray(parsed.files)||parsed.files.length!==files.length||!parsed.summary||parsed.summary.fileCount!==files.length)throw failed('INVALID_RESPONSE','保全记录或完整历史原件范围无法确认，未保存文件。');
  const checked=parsePlan(rebuilt,{teamId:plan.teamId,projectId:plan.projectId});if(canonical(checked)!==canonical(plan))throw failed('MATERIAL_EXPORT_CHANGED','保全快照已变化，未保存文件。');
 }
 async function publish(destination,bytes,job,check,fresh){
  const temporary=path.join(path.dirname(destination),'.shenyi-material-preservation-'+randomBytes(16).toString('hex')+'.tmp');let handle,owned=false,primary;
  try{check();handle=await fsImpl.open(temporary,'wx',0o600);owned=true;check();await handle.writeFile(bytes);check();await handle.sync();check();await handle.close();handle=null;check();await fresh();check();job.publishing=true;await fsImpl.rename(temporary,destination);job.published=true;job.publishing=false;
   try{check();}catch{throw failed('MATERIAL_EXPORT_PUBLISHED','本次资料保全包已发布；当前会话或视图已变化，请在原保存位置核对。');}
  }catch(error){primary=error;}finally{
   if(handle)try{await handle.close();}catch(error){primary??=error;}
   if(owned&&!job.published)try{await fsImpl.unlink(temporary);}catch(cleanup){if(cleanup?.code!=='ENOENT'){
    job.cleanupFailed=true;const note=' 所选目录中可能仍留有本次临时保全包 '+path.basename(temporary)+'，请核对并清理。';
    if(primary instanceof ClientError)primary.message+=note;else primary=failed('MATERIAL_EXPORT_SAVE_FAILED','保全包保存未完成。'+note);
   }}
  }
  if(primary)throw primary;
 }
 async function run(input){
  validateInput(input);input={...input};if(disposed)throw failed('MATERIAL_EXPORT_CANCELED','资料保全服务已关闭。');if(current)throw failed('MATERIAL_EXPORT_IN_PROGRESS','资料保全仍在处理中，请稍候核对。');if(used.has(input.requestId))throw failed('MATERIAL_EXPORT_CANCELED','本次导出编号已使用，请重新明确选择范围。');
  const guard=client.guardSession();guard();const job={id:input.requestId,controller:new AbortController(),canceled:false,publishing:false,published:false};current=job;jobs.add(job);used.add(job.id);
  const check=()=>{guard();if(job.deadline&&Date.now()>job.deadline){job.controller.abort();throw failed('MATERIAL_EXPORT_TIMEOUT','资料保全处理超过时间上限，未继续发布。');}if(disposed||job.canceled)throw failed('MATERIAL_EXPORT_CANCELED','本次资料保全导出已停止，尚未发布。');},target={teamId:input.teamId,projectId:input.projectId},hooks={assertCurrent:check,signal:job.controller.signal};let bytes;
  try{
   check();const resource=identity(await client.getProject(target),input);check();const plan=parsePlan(await client.getProjectMaterialExportPlan(target,hooks),target);check();
   if(plan.resourceKind!==resource.kind||plan.projectStatus!==resource.status||plan.projectRevision!==input.projectRevision||plan.materialRevision!==input.materialRevision||plan.recordSha256!==input.recordSha256)throw failed('MATERIAL_EXPORT_CHANGED','当前资料或项目版本已变化，请刷新后重新确认。');
   const fresh=async()=>{check();const value=parsePlan(await client.getProjectMaterialExportPlan(target,hooks),target);check();if(canonical(value)!==canonical(plan))throw failed('MATERIAL_EXPORT_CHANGED','资料、原件或读取权已变化，整个保全导出已停止。');};
   const selected=await dialog.showSaveDialog(window,{title:'保存完整团队资料保全包',buttonLabel:'保存完整保全包',defaultPath:'资料保全-'+plan.sourceProjectId+'-r'+plan.recordRevision+'.zip',filters:[{name:'资料保全包',extensions:['zip']}]});check();if(selected.canceled||!selected.filePath)return {canceled:true,requestId:job.id};
   await fresh();job.deadline=Date.now()+180000;const value=await client.downloadProjectMaterialExport({...target,projectRevision:plan.projectRevision,materialRevision:plan.materialRevision,recordSha256:plan.recordSha256,planSha256:plan.planSha256},hooks);check();bytes=value.bytes;
   if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>PACKAGE_MAX||value.planSha256!==plan.planSha256||value.sha256!==digest(bytes))throw failed('INVALID_RESPONSE','资料保全包完整性无法确认，未保存文件。');
   let parsed;try{parsed=await codec.inspect(bytes,{assertCurrent:check});check();verifyPackage(parsed,plan);}catch(error){check();if(error instanceof ClientError)throw error;throw failed('INVALID_RESPONSE','资料保全包结构、历史或来源无法确认，未保存文件。');}if(parsed.sha256!==value.sha256)throw failed('INVALID_RESPONSE','资料保全包SHA-256无法确认，未保存文件。');check();await fresh();
   await publish(selected.filePath,bytes,job,check,fresh);
   return {saved:true,requestId:job.id,filename:path.basename(selected.filePath),byteLength:bytes.length,sha256:value.sha256,fileCount:plan.fileCount};
  }catch(error){if(job.published)throw error instanceof ClientError?error:failed('MATERIAL_EXPORT_PUBLISHED','本次资料保全包已发布，请在原保存位置核对。');if(job.canceled&&!job.cleanupFailed&&error.code!=='SESSION_CHANGED'&&error.code!=='SIGN_IN_REQUIRED')return {canceled:true,requestId:job.id};if(error instanceof ClientError)throw error;throw failed('MATERIAL_EXPORT_FAILED','资料保全导出未完成，未确认发布；请核对保存位置后再操作。');}
  finally{bytes?.fill(0);jobs.delete(job);if(current===job)current=null;}
 }
 function cancel(input){if(!exact(input,['requestId'])||!matches(UUID,input.requestId??''))throw failed('INVALID_INPUT','本次导出编号无效。');return {canceled:!!current&&current.id===input.requestId&&stop(current)};}
 return Object.freeze({exportProjectMaterialPreservation:run,cancelProjectMaterialPreservationExport:cancel,closeAll:clear,dispose(){disposed=true;clear();unsubscribe?.();}});
}
module.exports={createMaterialPreservationExporter};
