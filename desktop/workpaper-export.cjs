'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomBytes,createHash}=require('node:crypto');
const {ClientError}=require('./team-client.cjs');
const {inspectWorkpaperExportFile}=require('./workpaper-export-file.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,SHA=/^[a-f0-9]{64}$/;
const match=(re,v)=>typeof v==='string'&&re.exec(v)?.[0]===v,fail=(code,message)=>new ClientError(code,message);
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype)return false;const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);return names.length===keys.length&&names.every(k=>typeof k==='string'&&keys.includes(k)&&ds[k].enumerable&&Object.hasOwn(ds[k],'value'));}
const TARGET=['teamId','projectId','version','headRevision','recordSha256','sourceProjectId','projectRevision','grantRevision'];
function exportInput(input){if(!exact(input,[...TARGET,'requestId','confirmed'])||!match(UUID,input.requestId)||!match(UUID,input.sourceProjectId)||!match(ID,input.teamId)||!match(ID,input.projectId)||!match(SHA,input.recordSha256)||!['version','headRevision','projectRevision','grantRevision'].every(k=>Number.isSafeInteger(input[k])&&input[k]>0)||input.version>input.headRevision||input.confirmed!==true)throw fail('INVALID_INPUT','请先核对已保存底稿版本，并明确确认本次导出。');return{...input};}
function createWorkpaperExporter({client,dialog,window,fsImpl=fs,inspect=inspectWorkpaperExportFile}={}){
 if(!client||!['guardSession','getWorkpaperAccess','getWorkpaperData','downloadWorkpaperExport','onProjectMigrationContextChange'].every(k=>typeof client[k]==='function')||typeof dialog?.showSaveDialog!=='function'||typeof inspect!=='function')throw fail('INVALID_WORKPAPER_EXPORT_CLIENT','底稿导出服务尚未准备好。');
 let current=null,disposed=false;const jobs=new Map(),used=new Set();
 function stop(job){if(!job||job.publishing||job.published||job.publishUnknown)return false;job.canceled=true;job.controller.abort();return true;}
 const clear=()=>{for(const job of jobs.values())stop(job);},unsubscribe=client.onProjectMigrationContextChange(clear);
 async function run(input){
  const v=exportInput(input);if(disposed)throw fail('WORKPAPER_CANCELED','底稿导出服务已关闭。');if(current)throw fail('WORKPAPER_EXPORT_BUSY','底稿仍在保存处理中，请先核对原操作。');if(used.has(v.requestId)||used.size>=4096)throw fail('WORKPAPER_EXPORT_USED','本次导出编号已使用或当前会话操作过多，请核对原保存位置。');
  const guard=client.guardSession();guard();const job={id:v.requestId,controller:new AbortController(),canceled:false,publishing:false,published:false,publishUnknown:false};used.add(job.id);jobs.set(job.id,job);current=job;
  const check=()=>{guard();if(disposed||job.canceled)throw fail('WORKPAPER_CANCELED','本次底稿导出已停止，尚未发布文件。');},target={teamId:v.teamId,projectId:v.projectId},hooks={assertCurrent:check,signal:job.controller.signal};let handle,temporary,identity,owned=false,primary,summary,destination;
  const sameFile=(a,b)=>a?.isFile()&&b?.isFile()&&a.ino!==0n&&a.dev===b.dev&&a.ino===b.ino;
  const fresh=async()=>{check();const a=await client.getWorkpaperAccess(target,hooks);check();if(!a.read||!a.export||!a.canExport||a.projectRevision!==v.projectRevision||a.grantRevision!==v.grantRevision)throw fail('WORKPAPER_CHANGED','底稿查阅和导出权限已改变，未发布文件。');const head=await client.getWorkpaperData(target,hooks);check();if(head.headRevision!==v.headRevision||head.sourceProjectId!==v.sourceProjectId||head.projectRevision!==v.projectRevision||head.grantRevision!==v.grantRevision)throw fail('WORKPAPER_CHANGED','底稿来源或固定版本已改变，未发布文件。');};
  try{
   await fresh();const chosen=await dialog.showSaveDialog(window,{title:'保存已保存版本的团队底稿包',buttonLabel:'保存底稿包',defaultPath:'审易团队底稿-v'+v.version+'.zip',properties:['showOverwriteConfirmation'],filters:[{name:'团队底稿导出包',extensions:['zip']}]});check();if(chosen.canceled)return{status:'cancelled'};
   destination=chosen.filePath;if(typeof destination!=='string'||!destination.isWellFormed()||!path.isAbsolute(destination)||/[\p{Cc}]/u.test(destination))throw fail('INVALID_EXPORT_DESTINATION','保存位置无效，请通过保存对话框重新选择。');await fresh();
   let written=0;const expected=Object.fromEntries(TARGET.map(k=>[k,v[k]]));
   const downloaded=await client.downloadWorkpaperExport(expected,{...hooks,async onHeaders(){check();temporary=path.join(path.dirname(destination),'.shenyi-workpaper-export-'+randomBytes(16).toString('hex')+'.tmp');try{handle=await fsImpl.open(temporary,'wx+',0o600);owned=true;identity=await handle.stat({bigint:true});}catch{throw fail('WORKPAPER_EXPORT_WRITE_FAILED','底稿临时文件无法在所选位置安全建立。');}check();},async onChunk(bytes){check();let at=0;while(at<bytes.length){let result;try{result=await handle.write(bytes,at,bytes.length-at,written);}catch{throw fail('WORKPAPER_EXPORT_WRITE_FAILED','底稿包无法完整写入所选位置，请核对磁盘空间与权限。');}check();if(!Number.isSafeInteger(result.bytesWritten)||result.bytesWritten<1||result.bytesWritten>bytes.length-at)throw fail('WORKPAPER_EXPORT_WRITE_FAILED','底稿包未完整写入临时文件。');at+=result.bytesWritten;written+=result.bytesWritten;}}});
   check();if(!handle||written!==downloaded.byteLength)throw fail('INVALID_RESPONSE','底稿导出长度无法核实，未发布文件。');await handle.sync();check();summary=await inspect({handle,byteLength:downloaded.byteLength,sha256:downloaded.sha256,expected,assertCurrent:check});check();if(!summary||summary.byteLength!==downloaded.byteLength||summary.sha256!==downloaded.sha256||summary.sourceProjectId!==v.sourceProjectId||summary.version!==v.version||summary.recordSha256!==v.recordSha256)throw fail('INVALID_RESPONSE','落盘底稿包与本次固定版本不一致，未发布文件。');
   const fileStat=await handle.stat({bigint:true}),nameStat=await fsImpl.lstat(temporary,{bigint:true});check();if(!sameFile(identity,fileStat)||!sameFile(fileStat,nameStat)||fileStat.size!==BigInt(downloaded.byteLength)||nameStat.size!==fileStat.size)throw fail('WORKPAPER_EXPORT_FILE_CHANGED','临时底稿文件身份或长度已改变，未发布文件。');await handle.close();handle=null;check();const prepared=await fsImpl.lstat(temporary,{bigint:true});check();if(!sameFile(fileStat,prepared)||prepared.size!==fileStat.size)throw fail('WORKPAPER_EXPORT_FILE_CHANGED','准备发布的底稿文件已被替换，未发布文件。');await fresh();check();job.publishing=true;
   try{await fsImpl.rename(temporary,destination);}catch{job.publishUnknown=true;throw fail('WORKPAPER_EXPORT_SAVE_UNKNOWN','底稿包保存结果无法确认，请核对刚才选择的位置；不会自动重复保存。');}finally{job.publishing=false;}
   job.published=true;
   // Re-open the published name: a checked descriptor is not proof of the name
   // that an asynchronous rename actually moved. Do not endorse replacements.
   let publishedHandle;const buffer=Buffer.alloc(65536);
   try{check();publishedHandle=await fsImpl.open(destination,'r');check();const start=await publishedHandle.stat({bigint:true});if(!sameFile(fileStat,start)||start.size!==fileStat.size)throw Error('Published identity changed');const hash=createHash('sha256');let position=0;while(position<downloaded.byteLength){check();const part=await publishedHandle.read(buffer,0,Math.min(buffer.length,downloaded.byteLength-position),position);check();if(!Number.isSafeInteger(part.bytesRead)||part.bytesRead<1||part.bytesRead>Math.min(buffer.length,downloaded.byteLength-position))throw Error('Published short read');hash.update(buffer.subarray(0,part.bytesRead));position+=part.bytesRead;}const end=await publishedHandle.stat({bigint:true});check();if(!sameFile(start,end)||end.size!==start.size||end.mtimeNs!==start.mtimeNs||end.ctimeNs!==start.ctimeNs||hash.digest('hex')!==downloaded.sha256)throw Error('Published bytes changed');}
   catch{throw fail('WORKPAPER_EXPORT_SAVE_UNKNOWN','保存位置发生了变化或最终文件无法核实；请核对原位置，不会自动重写或删除替换文件。');}
   finally{buffer.fill(0);await publishedHandle?.close();}
   try{check();}catch{throw fail('WORKPAPER_EXPORT_PUBLISHED','底稿包已保存；当前会话或视图已改变，请在原保存位置核对。');}
   return{status:'saved',requestId:job.id,summary};
  }catch(error){primary=error;}finally{
   if(handle)try{await handle.close();}catch(error){primary??=error;}
   if(owned&&!job.published)try{const now=await fsImpl.lstat(temporary,{bigint:true});if(!identity||!sameFile(identity,now))throw fail('WORKPAPER_EXPORT_FILE_CHANGED','本次临时路径已被替换，未清理替换文件。');await fsImpl.unlink(temporary);}catch(error){if(error?.code!=='ENOENT'){const note=' 本次临时文件 '+path.basename(temporary)+' 可能仍在所选目录中，请核对清理。';if(primary instanceof ClientError)primary.message+=note;else primary=fail('WORKPAPER_EXPORT_CLEANUP_FAILED','底稿保存未确认。'+note);}}
   jobs.delete(job.id);if(current===job)current=null;
  }
  if(primary)throw primary instanceof ClientError?primary:fail('WORKPAPER_EXPORT_FAILED','底稿导出未完整保存，请核对原位置；不会自动重复写入。');
 }
 return Object.freeze({exportWorkpapers:run,cancelWorkpaperExport(input){if(!exact(input,['requestId'])||!match(UUID,input.requestId))throw fail('INVALID_INPUT','本次底稿导出编号无效。');return{canceled:stop(jobs.get(input.requestId))};},closeAll:clear,dispose(){if(disposed)return;disposed=true;clear();unsubscribe?.();}});
}
module.exports={createWorkpaperExporter,workpaperExportInput:exportInput};
