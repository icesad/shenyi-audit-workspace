'use strict';
const codec=require('../dist/legacy-project-source.js');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype)return false;const d=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(d);return names.length===keys.length&&names.every(k=>typeof k==='string'&&keys.includes(k)&&d[k].enumerable&&Object.hasOwn(d[k],'value'));}
function optionsValid(v){if(!v||Object.getPrototypeOf(v)!==Object.prototype)return false;return Reflect.ownKeys(v).every(k=>typeof k==='string'&&['assertCurrent','onDispatch'].includes(k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value')&&typeof v[k]==='function');}
const revision=v=>Number.isSafeInteger(v)&&v>=1,legacyTitle=v=>typeof v==='string'&&v.isWellFormed()&&v.length<=300&&!!v.trim()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),numberText=v=>typeof v==='string'&&v.isWellFormed()&&v===v.trim()&&v.length>0&&v.length<=128&&!/[\p{Cc}\p{Cf}]/u.test(v);
function createWorkspaceFormalizationClient({request,failure,capture}={}){
 if(![request,failure,capture].every(f=>typeof f==='function'))throw Error('Missing formalization client dependencies');
 const invalid=()=>{throw failure('INVALID_INPUT','请核对工作区、所选来源、业务确认与当前密码。');},bad=()=>{throw failure('INVALID_RESPONSE','业务确认结果无法核实，请按原编号只读查询，勿重复提交。');};
 const path=i=>'/api/teams/'+i.teamId+'/projects/'+i.projectId+'/formalization';
 const scoped=i=>i&&ID.test(i.teamId??'')&&UUID.test(i.projectId??'');
 const messagesOverride={400:'业务确认参数或来源关系无效，请重新核对。',403:'当前密码验证失败或未获本项目负责人资格。',404:'当前工作区或业务确认记录不可访问；查询404不代表在途操作永不完成。',409:'工作区版本、来源身份或请求编号冲突，请核对原结果；不会自动合并或重复提交。',503:'业务确认结果暂时无法核实，请联网后按原编号只读查询。'};
 function receipt(v,e){
  if(!exact(v,['requestId','teamId','projectId','sourceProjectId','sourceTitle','sourceSha256','businessNumber','confirmedBy','confirmedAt','projectRevisionBefore','projectRevisionAfter','confirmationMode'])||!UUID.test(v.requestId??'')||!ID.test(v.teamId??'')||!UUID.test(v.projectId??'')||!UUID.test(v.sourceProjectId??'')||!legacyTitle(v.sourceTitle)||!SHA.test(v.sourceSha256??'')||!numberText(v.businessNumber)||!ID.test(v.confirmedBy??'')||!Number.isSafeInteger(v.confirmedAt)||v.confirmedAt<0||!revision(v.projectRevisionBefore)||v.projectRevisionBefore>=Number.MAX_SAFE_INTEGER||!revision(v.projectRevisionAfter)||v.projectRevisionAfter!==v.projectRevisionBefore+1||v.confirmationMode!=='owner-attested-local-source'||v.teamId!==e.teamId||v.projectId!==e.projectId||e.requestId!==undefined&&v.requestId!==e.requestId)bad();
  return {...v};
 }
 return Object.freeze({
  async getWorkspaceFormalization(input){
   if(!exact(input,['teamId','projectId'])||!scoped(input))invalid();const target={teamId:input.teamId,projectId:input.projectId},c=capture();c.assertCurrent();const value=await request(path(target),{messagesOverride,beforeSend:c.assertCurrent});c.assertCurrent();if(!exact(value,['context']))bad();const v=value.context;if(!exact(v,['teamId','projectId','projectRevision','canConfirm','confirmation'])||v.teamId!==target.teamId||v.projectId!==target.projectId||!revision(v.projectRevision)||typeof v.canConfirm!=='boolean')bad();let saved=null;if(v.confirmation!==null){saved=receipt(v.confirmation,target);if(v.canConfirm||saved.projectRevisionAfter>v.projectRevision)bad();}return{...v,confirmation:saved};
  },
  async confirmWorkspaceFormalization(input,options={}){
   if(!exact(input,['requestId','teamId','projectId','source','sourceSha256','projectRevision','currentPassword','businessConfirmed'])||!scoped(input)||!UUID.test(input.requestId??'')||!SHA.test(input.sourceSha256??'')||!revision(input.projectRevision)||input.projectRevision>=Number.MAX_SAFE_INTEGER||typeof input.currentPassword!=='string'||!input.currentPassword||Buffer.byteLength(input.currentPassword)>512||input.businessConfirmed!==true||!optionsValid(options))invalid();
   const target={teamId:input.teamId,projectId:input.projectId},c=capture();c.assertCurrent();options.assertCurrent?.();let source;try{source=codec.validate(input.source);}catch{invalid();}
   const body={requestId:input.requestId,source,sourceSha256:input.sourceSha256,projectRevision:input.projectRevision,currentPassword:input.currentPassword,businessConfirmed:true};
   try{let inspected;try{inspected=await codec.inspect(codec.encode(source));}catch{invalid();}c.assertCurrent();options.assertCurrent?.();if(inspected.sha256!==body.sourceSha256)invalid();const value=await request(path(target),{method:'POST',body,messagesOverride,beforeSend:()=>{c.assertCurrent();options.assertCurrent?.();},onDispatch:()=>options.onDispatch?.()});c.assertCurrent();options.assertCurrent?.();if(!exact(value,['receipt']))bad();const saved=receipt(value.receipt,{...target,requestId:body.requestId});if(saved.confirmedBy!==c.actorId||saved.projectRevisionBefore!==body.projectRevision||saved.sourceProjectId!==inspected.summary.projectId||saved.sourceTitle!==inspected.summary.title||saved.businessNumber!==inspected.summary.businessNumber||saved.sourceSha256!==body.sourceSha256)bad();return saved;}finally{body.currentPassword='';}
  },
  async getWorkspaceFormalizationReceipt(input){
   if(!exact(input,['teamId','projectId','requestId'])||!scoped(input)||!UUID.test(input.requestId??''))invalid();const target={teamId:input.teamId,projectId:input.projectId,requestId:input.requestId},c=capture();c.assertCurrent();const value=await request(path(target)+'/receipts/'+target.requestId,{messagesOverride,beforeSend:c.assertCurrent});c.assertCurrent();if(!exact(value,['receipt']))bad();return receipt(value.receipt,target);
  }
 });
}
module.exports={createWorkspaceFormalizationClient};
