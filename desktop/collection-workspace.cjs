'use strict';
const {ClientError}=require('./team-client.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const fail=(code,message)=>new ClientError(code,message);
const uncertain=error=>['SERVICE_UNAVAILABLE','INVALID_RESPONSE','RESPONSE_TOO_LARGE','SESSION_CHANGED','SIGN_IN_REQUIRED','DEVICE_NOT_READY','DEVICE_PROOF_REQUIRED','DEVICE_STATE_CHANGED','DEVICE_BODY_MISMATCH','DEVICE_REQUEST_REPLAY','DEVICE_PROOF_LIMIT'].includes(error?.code)||/^HTTP_5\d\d$/.test(error?.code??'');
function exact(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype)return false;const fields=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(fields);return names.length===keys.length&&names.every(k=>typeof k==='string'&&keys.includes(k)&&fields[k].enumerable&&Object.hasOwn(fields[k],'value'));}
function createCollectionWorkspaceManager({client}={}){
 if(!client||!['guardSession','onProjectMigrationContextChange','createCollectionWorkspace'].every(k=>typeof client[k]==='function'))throw fail('INVALID_CREATION_CLIENT','采集工作区创建服务尚未准备好。');
 let disposed=false,epoch=0,pending=null;const used=new Set(),unsubscribe=client.onProjectMigrationContextChange(()=>{epoch++;});
 async function createCollectionWorkspace(input){
  if(!exact(input,['requestId','teamId','title','read','manage','review','currentPassword','confirmed'])||input.confirmed!==true||!UUID.test(input.requestId??'')||!ID.test(input.teamId??'')||typeof input.title!=='string'||!input.title.isWellFormed()||[...input.title].length>300||!input.title.trim()||/[\p{Cc}\p{Cf}]/u.test(input.title)||!['read','manage','review'].every(k=>typeof input[k]==='boolean')||!input.read&&(input.manage||input.review)||typeof input.currentPassword!=='string'||!input.currentPassword||Buffer.byteLength(input.currentPassword)>512)throw fail('INVALID_INPUT','请明确确认工作区名称、初始采集权限并输入当前密码。');
  if(disposed)throw fail('CREATION_CLOSED','创建窗口已关闭。');const sessionGuard=client.guardSession(),at=epoch;const assertCurrent=()=>{sessionGuard();if(disposed||at!==epoch)throw fail('SESSION_CHANGED','账号或设备上下文已改变，请先按原编号核对结果。');};assertCurrent();
  if(pending)throw fail('CREATION_IN_PROGRESS','仍有创建操作正在处理中，请先核对原查询编号。');
  if(used.has(input.requestId))throw fail('CREATION_ALREADY_USED','此创建编号已使用，请只读查询原回执，不会重复提交。');
  const body={requestId:input.requestId,teamId:input.teamId,title:input.title,read:input.read,manage:input.manage,review:input.review,currentPassword:input.currentPassword},operation={requestId:input.requestId};let dispatched=false;pending=operation;used.add(input.requestId);
  try{const receipt=await client.createCollectionWorkspace(body,{assertCurrent,onDispatch(){dispatched=true;}});assertCurrent();if(!receipt||receipt.requestId!==body.requestId||receipt.teamId!==body.teamId||receipt.kind!=='collection-workspace')throw fail('INVALID_RESPONSE','创建回执无法确认，请按原查询编号核对。');return{status:'created',receipt};}
  catch(error){if(dispatched&&(uncertain(error)||!(error instanceof ClientError)))return{status:'unknown',requestId:body.requestId};throw error instanceof ClientError?error:fail('CREATION_FAILED','创建未完成，请保留查询编号后核对，不会自动重发。');}
  finally{if(pending===operation)pending=null;body.currentPassword='';}
 }
 return Object.freeze({createCollectionWorkspace,dispose(){if(disposed)return;disposed=true;epoch++;unsubscribe?.();used.clear();}});
}
module.exports={createCollectionWorkspaceManager};
