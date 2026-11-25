'use strict';
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function exact(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype)return false;const fields=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(fields);return names.length===keys.length&&names.every(key=>typeof key==='string'&&keys.includes(key)&&fields[key].enumerable&&Object.hasOwn(fields[key],'value'));}
const title=value=>typeof value==='string'&&value.isWellFormed()&&value===value.trim()&&[...value].length>=1&&[...value].length<=300&&!/[\p{Cc}\p{Cf}]/u.test(value);
function createCollectionWorkspaceClient({request,failure,capture}={}){
 if(![request,failure,capture].every(f=>typeof f==='function'))throw Error('Missing collection workspace client dependencies');
 const invalid=()=>{throw failure('INVALID_INPUT','请核对采集工作区名称、初始权限及当前密码。');};
 const bad=()=>{throw failure('INVALID_RESPONSE','创建回执无法确认，请按原查询编号只读核对，勿重复创建。');};
 const route=teamId=>'/api/teams/'+teamId+'/collection-workspaces';
 const messagesOverride={400:'创建内容无效，请核对名称与独立采集权限。',403:'当前密码验证失败或未获创建资格。',404:'当前团队或创建请求不可访问；查询404不代表在途创建永远未完成。',409:'创建编号或状态冲突，请先按原查询编号核对，勿重复创建。',503:'创建结果无法确认，请联网后按原查询编号核对。'};
 function receipt(value,expected){
  const keys=['requestId','teamId','projectId','kind','title','createdBy','read','manage','review','createdProjectRevision','createdAt'];
  if(!exact(value,keys)||!UUID.test(value.requestId??'')||!ID.test(value.teamId??'')||!UUID.test(value.projectId??'')||value.kind!=='collection-workspace'||!title(value.title)||!ID.test(value.createdBy??'')||!['read','manage','review'].every(k=>typeof value[k]==='boolean')||!value.read&&(value.manage||value.review)||!Number.isSafeInteger(value.createdProjectRevision)||value.createdProjectRevision<1||!Number.isSafeInteger(value.createdAt)||value.createdAt<0||value.requestId!==expected.requestId||value.teamId!==expected.teamId||value.createdBy!==expected.actorId)bad();
  return {...value};
 }
 return Object.freeze({
  async createCollectionWorkspace(input,options={}){
   if(!exact(input,['requestId','teamId','title','read','manage','review','currentPassword'])||!UUID.test(input.requestId??'')||!ID.test(input.teamId??'')||typeof input.title!=='string'||!input.title.isWellFormed()||[...input.title].length>300||/[\p{Cc}\p{Cf}]/u.test(input.title)||!title(input.title.trim())||!['read','manage','review'].every(k=>typeof input[k]==='boolean')||!input.read&&(input.manage||input.review)||typeof input.currentPassword!=='string'||!input.currentPassword||Buffer.byteLength(input.currentPassword)>512)invalid();
   if(!options||Object.getPrototypeOf(options)!==Object.prototype||Object.keys(options).some(k=>!['assertCurrent','onDispatch'].includes(k))||options.assertCurrent!==undefined&&typeof options.assertCurrent!=='function'||options.onDispatch!==undefined&&typeof options.onDispatch!=='function')invalid();
   const context=capture(),body={requestId:input.requestId,title:input.title.trim(),read:input.read,manage:input.manage,review:input.review,currentPassword:input.currentPassword},expected={requestId:body.requestId,teamId:input.teamId,actorId:context.actorId};context.assertCurrent();options.assertCurrent?.();
   const value=await request(route(expected.teamId),{method:'POST',body,messagesOverride,beforeSend:()=>{context.assertCurrent();options.assertCurrent?.();},onDispatch:()=>options.onDispatch?.()});context.assertCurrent();options.assertCurrent?.();
   if(!exact(value,['receipt']))bad();const result=receipt(value.receipt,expected);if(result.title!==body.title||['read','manage','review'].some(k=>result[k]!==body[k]))bad();return result;
  },
  async getCollectionWorkspaceReceipt(input){
   if(!exact(input,['teamId','requestId'])||!ID.test(input.teamId??'')||!UUID.test(input.requestId??''))invalid();const context=capture();context.assertCurrent();const value=await request(route(input.teamId)+'/receipts/'+input.requestId,{messagesOverride,beforeSend:context.assertCurrent});context.assertCurrent();if(!exact(value,['receipt']))bad();return receipt(value.receipt,{teamId:input.teamId,requestId:input.requestId,actorId:context.actorId});
  }
 });
}
module.exports={createCollectionWorkspaceClient};
