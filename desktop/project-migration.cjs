'use strict';
const fs=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const {ClientError}=require('./team-client.cjs');
const codec=require('../dist/legacy-project-source.js');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const fail=(code,message,status=0)=>new ClientError(code,message,status);
const uncertain=error=>['SERVICE_UNAVAILABLE','INVALID_RESPONSE','RESPONSE_TOO_LARGE','SESSION_CHANGED','SIGN_IN_REQUIRED','DEVICE_NOT_READY','MIGRATION_SOURCE_CHANGED'].includes(error?.code)||/^HTTP_5\d\d$/.test(error?.code??'');
function createProjectMigrationManager({client,dialog,window,fsImpl=fs}){
  let source=null,version=0,opening=false,mutation=null,disposed=false;
  function clear(){version++;if(source?.bytes)source.bytes.fill(0);source=null;}
  const unsubscribe=client.onProjectMigrationContextChange?.(clear);
  async function access(assertCurrent){assertCurrent();const value=await client.getProjectMigrationAccess();assertCurrent();if(value?.canReview!==true)throw fail('HTTP_404','当前账号未获旧项目归属审核权。',404);}
  async function readFile(file,assertCurrent){
    const handle=await fsImpl.open(file,'r');let result;
    try{assertCurrent();const info=await handle.stat();assertCurrent();if(!info.isFile()||!Number.isSafeInteger(info.size)||info.size<1||info.size>codec.MAX_BYTES)throw fail('MIGRATION_SOURCE_INVALID','请选择不超过128 KiB的旧正式项目来源JSON。');const chunks=[];let size=0;for(;;){assertCurrent();const buffer=Buffer.alloc(Math.min(16384,codec.MAX_BYTES-size+1)),part=await handle.read(buffer,0,buffer.length,null);assertCurrent();if(!part.bytesRead)break;size+=part.bytesRead;if(size>codec.MAX_BYTES)throw fail('MIGRATION_SOURCE_INVALID','来源文件超过128 KiB，未裁剪或读取为有效来源。');chunks.push(buffer.subarray(0,part.bytesRead));}result=Buffer.concat(chunks);return result;}finally{await handle.close();}
  }
  async function choose(){
    if(disposed)throw fail('MIGRATION_SOURCE_CHANGED','来源窗口已关闭。');if(opening||mutation)throw fail('MIGRATION_IN_PROGRESS','来源选择或审核仍在处理中，请稍候核对。');
    clear();const guard=client.guardSession();opening=true;const at=version,assertCurrent=()=>{guard();if(disposed||at!==version)throw fail('MIGRATION_SOURCE_CHANGED','来源选择已取消或上下文已改变，请重新选择。');};let bytes;
    try{await access(assertCurrent);const selected=await dialog.showOpenDialog(window,{title:'选择旧正式项目来源JSON',buttonLabel:'预检所选来源',properties:['openFile'],filters:[{name:'旧正式项目来源',extensions:['json']}]});assertCurrent();if(selected.canceled||!selected.filePaths||selected.filePaths.length!==1)return {canceled:true};await access(assertCurrent);bytes=await readFile(selected.filePaths[0],assertCurrent);assertCurrent();let inspected;try{inspected=await codec.inspect(bytes);}catch{throw fail('MIGRATION_SOURCE_INVALID','来源格式、编号或中标关系未通过预检；未上传来源。');}assertCurrent();await access(assertCurrent);const handle=randomUUID();source={handle,bytes,sha256:inspected.sha256,summary:structuredClone(inspected.summary),guard,submitted:false};bytes=null;return {handle,sha256:source.sha256,summary:structuredClone(source.summary)};
    }catch(error){if(error instanceof ClientError)throw error;throw fail('MIGRATION_SOURCE_INVALID','来源文件无法安全读取或预检，未上传来源。');}finally{bytes?.fill(0);opening=false;}
  }
  function proof(input){
    if(!input||!UUID.test(input.handle??'')||!/^[a-f0-9]{64}$/.test(input.sourceSha256??'')||!ID.test(input.teamId??'')||!ID.test(input.ownerUserId??'')||!Number.isSafeInteger(input.ownerRevision)||input.ownerRevision<0||input.ownerRevision>=Number.MAX_SAFE_INTEGER||input.confirmed!==true||!['read','manage','review'].every(key=>typeof input[key]==='boolean')||!input.read&&(input.manage||input.review)||typeof input.currentPassword!=='string'||!input.currentPassword||Buffer.byteLength(input.currentPassword,'utf8')>512)throw fail('INVALID_INPUT','请明确核对来源、团队、首位负责人、初始权限和当前密码。');
  }
  async function approve(input){
    proof(input);if(disposed||opening||mutation)throw fail('MIGRATION_IN_PROGRESS','旧项目审核仍在处理中，请稍候核对。');const captured=source;if(!captured||captured.handle!==input.handle||captured.sha256!==input.sourceSha256)throw fail('MIGRATION_SOURCE_CHANGED','来源已清除或改变，请重新选择预检。');captured.guard();if(captured.submitted)throw fail('MIGRATION_ALREADY_SUBMITTED','本次来源已提交过；请先按查询编号核对，不会重复提交。');
    const at=version,assertCurrent=()=>{captured.guard();if(disposed||at!==version||source!==captured)throw fail('MIGRATION_SOURCE_CHANGED','来源已取消或上下文已改变，未继续发出审批。');};let dispatched=false;const operation={requestId:captured.handle};mutation=operation;
    try{let inspected;try{inspected=await codec.inspect(captured.bytes);}catch{throw fail('MIGRATION_SOURCE_INVALID','私有来源无法重新核验，请重新选择。');}assertCurrent();if(inspected.sha256!==captured.sha256)throw fail('MIGRATION_SOURCE_CHANGED','来源SHA已变化，请重新选择。');captured.submitted=true;const receipt=await client.registerProjectMigration({requestId:captured.handle,source:inspected.source,sourceSha256:captured.sha256,teamId:input.teamId,ownerUserId:input.ownerUserId,ownerRevision:input.ownerRevision,read:input.read,manage:input.manage,review:input.review,currentPassword:input.currentPassword},{assertCurrent,onDispatch:()=>{dispatched=true;}});return {status:'registered',receipt};}
    catch(error){if(dispatched&&uncertain(error))return {status:'unknown',requestId:captured.handle};throw error instanceof ClientError?error:fail('MIGRATION_FAILED','审批未完成，请按查询编号核对；不会自动重发。');}
    finally{if(mutation===operation)mutation=null;if(source===captured)clear();captured.bytes.fill(0);}
  }
  return Object.freeze({chooseProjectMigrationSource:choose,approveProjectMigration:approve,discardProjectMigrationSource(input){if(!input||!UUID.test(input.handle??''))throw fail('INVALID_INPUT','来源句柄无效。');if(source?.handle===input.handle)clear();return {discarded:true};},dispose(){disposed=true;clear();unsubscribe?.();}});
}
module.exports={createProjectMigrationManager};
