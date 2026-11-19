'use strict';
const {randomUUID}=require('node:crypto');
const {ClientError}=require('./team-client.cjs');
const {workpaperInput}=require('./workpaper-client.cjs');
const {createWorkpaperSourceManager}=require('./workpaper-source.cjs');
const {createWorkpaperExporter,workpaperExportInput}=require('./workpaper-export.cjs');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const match=(re,v)=>typeof v==='string'&&re.exec(v)?.[0]===v,fail=(code,message)=>new ClientError(code,message);
const RPC=Object.freeze([
 ['openWorkpaperView','workpaper-view-open'],['closeWorkpaperView','workpaper-view-close'],['listWorkpaperProjects','workpaper-projects'],['getWorkpaperAccess','workpaper-access'],['listWorkpaperMembers','workpaper-members'],['changeWorkpaperAccess','workpaper-access-change'],['getWorkpaperData','workpaper-data'],['listWorkpaperVersions','workpaper-versions'],['getWorkpaperRecord','workpaper-record'],['getWorkpaperForm','workpaper-form'],['saveWorkpaperEntries','workpaper-entries-save'],['getWorkpaperReceipt','workpaper-receipt'],['chooseWorkpaperSource','workpaper-source-open'],['confirmWorkpaperImport','workpaper-source-confirm'],['resumeWorkpaperImport','workpaper-source-resume'],['queryWorkpaperImport','workpaper-import-query'],['cancelWorkpaperSourceImport','workpaper-import-cancel'],['discardWorkpaperSource','workpaper-source-discard'],['exportWorkpapers','workpaper-export'],['cancelWorkpaperExport','workpaper-export-cancel']
].map(Object.freeze));
// Only passive JSON enters the private managers. Renderer-supplied functions,
// paths, binary values, prototypes and accessor side effects are never adopted.
function data(value){
 let nodes=0;const active=new Set(),bad=()=>{throw fail('INVALID_INPUT','底稿操作参数无效。');};
 function copy(v,depth){
  if(++nodes>12000||depth>8)bad();if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||typeof v==='string'&&v.isWellFormed())return v;
  if(!v||typeof v!=='object'||active.has(v))bad();active.add(v);let out;
  if(Array.isArray(v)){const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);if(Object.getPrototypeOf(v)!==Array.prototype||keys.length!==v.length+1||keys.some(k=>k!=='length'&&(typeof k!=='string'||!match(/^(?:0|[1-9][0-9]*)$/,k)||Number(k)>=v.length||!ds[k].enumerable||!Object.hasOwn(ds[k],'value'))))bad();out=v.map(x=>copy(x,depth+1));}
  else{if(Object.getPrototypeOf(v)!==Object.prototype)bad();out={};for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!k.isWellFormed()||!d.enumerable||!Object.hasOwn(d,'value'))bad();Object.defineProperty(out,k,{value:copy(d.value,depth+1),enumerable:true,writable:true,configurable:true});}}
  active.delete(v);return out;
 }
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)bad();const result=copy(value,0);if(Buffer.byteLength(JSON.stringify(result))>2*1024*1024)bad();return result;
}
const exact=(v,keys)=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const TARGET=['teamId','projectId','projectRevision','grantRevision'];
const SOURCE_CONFIRM=[...TARGET,'handle','packageSha256','currentPassword','sourceVerified','confirmed'];
const definite=e=>/^HTTP_(?:400|403|404|409|410|413|422|429)$/.test(e?.code??'');
function createWorkpaperBridge({client,dialog,window,sourceManagerFactory=createWorkpaperSourceManager,exporterFactory=createWorkpaperExporter}={}){
 if(!client||!['guardSession','retireWorkpaperReads'].every(k=>typeof client[k]==='function'))throw fail('INVALID_WORKPAPER_CLIENT','底稿服务尚未准备好。');
 let view=null,sourceManager=null,exporter=null,disposed=false;
 const changed=()=>fail('WORKPAPER_VIEW_CHANGED','底稿窗口已关闭或切换，旧响应已丢弃。');
 function clear(){const previous=view;view=null;previous?.controller.abort();sourceManager?.clearSource();exporter?.closeAll();client.retireWorkpaperReads();}
 function current(viewId,teamId,projectId,projectRequired=true){
  if(disposed||!view||view.viewId!==viewId||teamId!==undefined&&view.teamId!==teamId||projectRequired&&(!view.projectId||view.projectId!==projectId))throw changed();const captured=view;
  const check=()=>{if(disposed||view!==captured||captured.controller.signal.aborted||typeof window?.isDestroyed==='function'&&window.isDestroyed())throw changed();captured.guard();};check();return{captured,check};
 }
 function input(value,kind){const v=data(value),{viewId,...payload}=v;if(!match(UUID,viewId))throw fail('INVALID_INPUT','底稿窗口句柄无效。');const target=workpaperInput(payload,kind,(...args)=>new ClientError(...args));return{target,...current(viewId,target.teamId,target.projectId,kind!=='projects')};}
 function managedInput(value,keys,{project=true}={}){const v=data(value),{viewId,...target}=v;if(!match(UUID,viewId)||!exact(target,keys))throw fail('INVALID_INPUT','底稿来源或保存参数无效。');return{target,...current(viewId,target.teamId,target.projectId,project)};}
 const sources=()=>sourceManager??=sourceManagerFactory({client,dialog,window});
 const exports=()=>exporter??=exporterFactory({client,dialog,window});
 const options=c=>({assertCurrent:c.check,signal:c.captured.controller.signal});
 async function read(value,kind,method){const c=input(value,kind),result=await client[method](c.target,options(c));c.check();return result;}
 async function sourceMutation(value,method,keys=SOURCE_CONFIRM){const c=managedInput(value,keys);try{if(keys===SOURCE_CONFIRM&&!c.captured.sources.has(c.target.handle))throw fail('WORKPAPER_SOURCE_CHANGED','请在当前项目窗口重新选择并核验完整底稿包。');c.check();const result=await sources()[method](c.target);try{c.check();return result;}catch{return{status:'unknown',requestId:c.target.handle??c.target.requestId,phase:result?.phase??'view'};}}finally{if(Object.hasOwn(c.target,'currentPassword'))c.target.currentPassword='';}}
 return Object.freeze({
  openWorkpaperView(value){const v=data(value),keys=Object.hasOwn(v,'projectId')?['teamId','projectId']:['teamId'];if(!exact(v,keys)||!match(ID,v.teamId)||Object.hasOwn(v,'projectId')&&!match(ID,v.projectId)||disposed||typeof window?.isDestroyed==='function'&&window.isDestroyed())throw fail('INVALID_INPUT','请先选择当前团队和项目。');const guard=client.guardSession();guard();clear();view={viewId:randomUUID(),teamId:v.teamId,...(v.projectId?{projectId:v.projectId}:{}),guard,controller:new AbortController(),sources:new Set(),exports:new Set()};return{viewId:view.viewId,teamId:view.teamId,...(view.projectId?{projectId:view.projectId}:{})};},
  closeWorkpaperView(value){const v=data(value);if(!exact(v,['viewId'])||!match(UUID,v.viewId))throw fail('INVALID_INPUT','底稿窗口句柄无效。');if(view?.viewId!==v.viewId)return{closed:false};clear();return{closed:true};},
  listWorkpaperProjects:value=>read(value,'projects','listWorkpaperProjects'),
  getWorkpaperAccess:value=>read(value,'access','getWorkpaperAccess'),
  listWorkpaperMembers:value=>read(value,'members','listWorkpaperMembers'),
  async changeWorkpaperAccess(value){const c=input(value,'grant');let dispatched=false;try{const result=await client.changeWorkpaperAccess(c.target,{...options(c),onDispatch(){dispatched=true;}});c.check();return result;}catch(error){if(dispatched&&!definite(error))throw fail('WORKPAPER_ACCESS_UNKNOWN','本次底稿授权结果未确认，请刷新核对当前权限，勿重复提交原授权。');throw error;}finally{c.target.currentPassword='';}},
  getWorkpaperData:value=>read(value,'data','getWorkpaperData'),
  listWorkpaperVersions:value=>read(value,'versions','listWorkpaperVersions'),
  getWorkpaperRecord:value=>read(value,'record','getWorkpaperRecord'),
  getWorkpaperForm:value=>read(value,'form','getWorkpaperForm'),
  async saveWorkpaperEntries(value){const c=input(value,'entries');let dispatched=false;try{const receipt=await client.saveWorkpaperEntries(c.target,{...options(c),onDispatch(){dispatched=true;}});c.check();return{status:'saved',receipt};}catch(error){
   const confirmedConflict=error?.status===409&&['WORKPAPER_HEAD_CHANGED','WORKPAPER_CHANGED'].includes(error.code);
   if(dispatched&&!definite(error)&&!confirmedConflict)return{status:'unknown',requestId:c.target.requestId};throw error;
  }},
  getWorkpaperReceipt:value=>read(value,'receipt','getWorkpaperReceipt'),
  async chooseWorkpaperSource(value){const c=managedInput(value,TARGET);const result=await sources().chooseWorkpaperSource(c.target);c.check();if(result?.status==='selected'){if(!match(UUID,result.handle))throw fail('INVALID_RESPONSE','底稿来源句柄无法核实。');c.captured.sources.add(result.handle);}return result;},
  confirmWorkpaperImport:value=>sourceMutation(value,'confirmWorkpaperImport'),
  resumeWorkpaperImport:value=>sourceMutation(value,'resumeWorkpaperImport'),
  async queryWorkpaperImport(value){const c=managedInput(value,['teamId','projectId','requestId']);const result=await sources().queryWorkpaperImport(c.target);c.check();return result;},
  cancelWorkpaperSourceImport:value=>sourceMutation(value,'cancelWorkpaperSourceImport',['teamId','projectId','requestId','confirmed']),
  discardWorkpaperSource(value){const c=managedInput(value,['handle'],{project:false});if(!match(UUID,c.target.handle))throw fail('INVALID_INPUT','底稿来源句柄无效。');if(!c.captured.sources.has(c.target.handle))return{discarded:false};c.check();const result=sourceManager?sourceManager.discardWorkpaperSource(c.target):{discarded:false};c.captured.sources.delete(c.target.handle);return result;},
  async exportWorkpapers(value){const v=data(value),{viewId,...payload}=v;if(!match(UUID,viewId))throw fail('INVALID_INPUT','底稿窗口句柄无效。');const target=workpaperExportInput(payload),c=current(viewId,target.teamId,target.projectId);c.captured.exports.add(target.requestId);const result=await exports().exportWorkpapers(target);try{c.check();return result;}catch{if(result?.status==='saved')throw fail('WORKPAPER_EXPORT_PUBLISHED','底稿包已保存；当前窗口已变化，请在原保存位置核对。');throw changed();}},
  cancelWorkpaperExport(value){const c=managedInput(value,['requestId'],{project:false});if(!match(UUID,c.target.requestId))throw fail('INVALID_INPUT','底稿保存编号无效。');if(!c.captured.exports.has(c.target.requestId))return{canceled:false};c.check();return exporter?exporter.cancelWorkpaperExport(c.target):{canceled:false};},
  clearAll:clear,dispose(){if(disposed)return;disposed=true;clear();sourceManager?.dispose();exporter?.dispose();}
 });
}
module.exports={createWorkpaperBridge,RPC};
