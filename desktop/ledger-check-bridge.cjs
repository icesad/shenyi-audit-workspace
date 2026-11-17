'use strict';
const {randomUUID}=require('node:crypto');
const {ClientError}=require('./team-client.cjs');
const {ledgerCheckInput}=require('./ledger-check-client.cjs');
const {createLedgerCheckSourceManager}=require('./ledger-check-source.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=(code,message)=>new ClientError(code,message);
function data(input){if(!input||Object.getPrototypeOf(input)!==Object.prototype)throw fail('INVALID_INPUT','账表操作参数无效。');const ds=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(ds);if(keys.some(k=>typeof k!=='string'||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))throw fail('INVALID_INPUT','账表操作参数无效。');return Object.fromEntries(keys.map(k=>[k,ds[k].value]));}
const exact=(v,keys)=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function createLedgerCheckBridge({client,dialog,window}={}){
 if(!client||!['guardSession','retireLedgerCheckReads'].every(k=>typeof client[k]==='function'))throw fail('INVALID_LEDGER_CLIENT','账表服务尚未准备好。');
 let view=null,sourceManager=null,disposed=false;
 function clear(){view=null;sourceManager?.clearSource();client.retireLedgerCheckReads();}
 function current(viewId,teamId){
  if(disposed||!view||view.viewId!==viewId||teamId!==undefined&&view.teamId!==teamId)throw fail('LEDGER_VIEW_CHANGED','账表窗口已关闭或切换，请重新打开当前项目。');
  const captured=view;const check=()=>{if(disposed||view!==captured)throw fail('LEDGER_VIEW_CHANGED','账表窗口已关闭或切换，旧响应已丢弃。');captured.guard();};check();return check;
 }
 function query(input,kind){const value=data(input),{viewId,...payload}=value;if(typeof viewId!=='string'||!UUID.test(viewId))throw fail('INVALID_INPUT','账表窗口句柄无效。');const target=ledgerCheckInput(payload,kind,(...args)=>new ClientError(...args));return {target,check:current(viewId,target.teamId)};}
 function sourceInput(input,keys){const value=data(input),{viewId,...payload}=value;if(typeof viewId!=='string'||!UUID.test(viewId)||!exact(payload,keys))throw fail('INVALID_INPUT','账表来源参数无效。');return {target:payload,check:current(viewId,payload.teamId)};}
 const sources=()=>sourceManager??=createLedgerCheckSourceManager({client,dialog,window});
 async function read(input,kind,method){const {target,check}=query(input,kind);const result=await client[method](target,{assertCurrent:check});check();return result;}
 const TARGET=['teamId','projectId','projectRevision','grantRevision','headRevision'];
 return Object.freeze({
  openLedgerCheckView(input){const v=data(input);if(!exact(v,['teamId'])||typeof v.teamId!=='string'||!ID.test(v.teamId)||disposed)throw fail('INVALID_INPUT','请先选择当前团队。');const guard=client.guardSession();guard();clear();view={viewId:randomUUID(),teamId:v.teamId,guard};return {viewId:view.viewId,teamId:view.teamId};},
  closeLedgerCheckView(input){const v=data(input);if(!exact(v,['viewId'])||typeof v.viewId!=='string'||!UUID.test(v.viewId))throw fail('INVALID_INPUT','账表窗口句柄无效。');if(view?.viewId!==v.viewId)return {closed:false};clear();return {closed:true};},
  listLedgerCheckProjects:input=>read(input,'projects','listLedgerCheckProjects'),
  getLedgerCheckAccess:input=>read(input,'access','getLedgerCheckAccess'),
  listLedgerCheckMembers:input=>read(input,'members','listLedgerCheckMembers'),
  changeLedgerCheckAccess:input=>read(input,'change','changeLedgerCheckAccess'),
  listLedgerCheckSnapshots:input=>read(input,'history','listLedgerCheckSnapshots'),
  getLedgerCheckSnapshot:input=>read(input,'snapshot','getLedgerCheckSnapshot'),
  getLedgerCheckImportReceipt:input=>read(input,'receipt','getLedgerCheckImportReceipt'),
  async chooseLedgerCheckSource(input){const {target,check}=sourceInput(input,TARGET);const result=await sources().chooseLedgerCheckSource(target);check();return result;},
  async confirmLedgerCheckImport(input){const {target,check}=sourceInput(input,[...TARGET,'handle','sourceSha256','currentPassword','sourceVerified','confirmed']);check();const result=await sources().confirmLedgerCheckImport(target);try{check();return result;}catch{return {status:'unknown',operationId:target.handle};}},
  discardLedgerCheckSource(input){const {target,check}=sourceInput(input,['handle']);check();return sourceManager?sourceManager.discardLedgerCheckSource(target):{discarded:false};},
  clearAll:clear,dispose(){if(disposed)return;disposed=true;clear();sourceManager?.dispose();}
 });
}
module.exports={createLedgerCheckBridge};
