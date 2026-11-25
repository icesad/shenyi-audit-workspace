'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const core=require('../shared/task-originals-export.cjs');
const {ClientError}=require('./team-client.cjs');

const failed=(code,message)=>new ClientError(code,message);
function createTaskOriginalsExporter({client,dialog,window,fsImpl=fs}){
  let pending=false;
  async function publish(destination,bytes,assertCurrent){
    const temporary=path.join(path.dirname(destination),'.shenyi-export-'+randomBytes(16).toString('hex')+'.tmp');
    let handle,owned=false,published=false,primary;
    try{
      assertCurrent();handle=await fsImpl.open(temporary,'wx',0o600);owned=true;assertCurrent();
      await handle.writeFile(bytes);assertCurrent();await handle.sync();assertCurrent();
      await handle.close();handle=null;assertCurrent();
      await fsImpl.rename(temporary,destination);published=true;
    }catch(error){primary=error;}finally{
      if(handle)try{await handle.close();}catch(error){primary??=error;}
      if(owned&&!published)try{await fsImpl.unlink(temporary);}catch{
        const note='所选目录中可能仍留有本次临时原件包 '+path.basename(temporary)+'，请核对并清理。';
        if(primary instanceof ClientError)primary.message+=' '+note;
        else primary=failed('EXPORT_SAVE_FAILED','原件包未能发布，原有目标文件未被截断。'+note);
      }
    }
    if(primary)throw primary;
  }
  async function run(input,project){
    if(pending)throw failed('EXPORT_IN_PROGRESS','原件导出仍在处理中，请稍候核对。');
    pending=true;
    try{
      const assertCurrent=client.guardSession();assertCurrent();
      let ids;try{ids=core.selectionIds(input.submissionIds);}catch{throw failed('INVALID_INPUT','请明确选择1至20份不重复的当前提交记录。');}const target={...input,submissionIds:ids};
      const planMethod=project?'getProjectTaskExportPlan':'getTaskExportPlan';
      const plan=core.validatePlan(await client[planMethod](target));assertCurrent();
      const originals=[];
      for(const file of plan.manifest.files){
        assertCurrent();
        const data=project?await client.getProjectSubmissionFile({teamId:target.teamId,projectId:target.projectId,taskId:target.taskId,submissionId:file.id}):await client.download({teamId:target.teamId,taskId:target.taskId,attachmentId:file.attachmentId});
        assertCurrent();originals.push({id:file.id,bytes:data.bytes});
      }
      let archive;try{archive=await core.create(plan,originals);}catch{throw failed('EXPORT_INTEGRITY_FAILED','所选原件大小或完整性无法确认，整个导出已停止。');}
      assertCurrent();
      const selected=await dialog.showSaveDialog(window,{title:'导出所选任务原件副本',defaultPath:archive.filename,buttonLabel:'保存所选原件包',filters:[{name:'任务原件包',extensions:['zip']}]});
      assertCurrent();if(selected.canceled||!selected.filePath)return {canceled:true};
      const fresh=core.validatePlan(await client[planMethod](target));assertCurrent();
      if(fresh.sha256!==plan.sha256||archive.planSha256!==plan.sha256)throw failed('EXPORT_CHANGED','任务、所选记录或授权已变化，未保存原件包，请刷新核对。');
      try{await publish(selected.filePath,archive.bytes,assertCurrent);}catch(error){if(error instanceof ClientError)throw error;throw failed('EXPORT_SAVE_FAILED','原件包未能发布，请核对保存位置后重新操作；原有目标文件未被截断。');}
      return {saved:true,filename:path.basename(selected.filePath),byteLength:archive.bytes.length,fileCount:archive.fileCount};
    }finally{pending=false;}
  }
  return Object.freeze({exportTaskOriginals:input=>run(input,false),exportProjectTaskOriginals:input=>run(input,true)});
}
module.exports={createTaskOriginalsExporter};
