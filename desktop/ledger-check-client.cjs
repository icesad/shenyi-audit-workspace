'use strict';
const {createHash}=require('node:crypto');
const codec=require('../dist/ledger-check-snapshot.js');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
const identifier=v=>typeof v==='string'&&ID.test(v),uuid=v=>typeof v==='string'&&UUID.test(v),hash=v=>typeof v==='string'&&HASH.test(v);
const text=(v,max=80)=>typeof v==='string'&&v.isWellFormed()&&!!v&&v===v.trim()&&[...v].length<=max&&!/[\p{Cc}\p{Cf}]/u.test(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const sha=v=>createHash('sha256').update(v).digest('hex');
function fields(v,allowed,required=allowed){
 if(!v||Object.getPrototypeOf(v)!==Object.prototype)return null;
 const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);
 if(keys.some(k=>typeof k!=='string'||!allowed.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value'))||required.some(k=>!Object.hasOwn(ds,k)))return null;
 return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
function dense(v,max){
 if(!Array.isArray(v)||Object.getPrototypeOf(v)!==Array.prototype||v.length>max)return false;
 const ds=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(ds);
 return keys.length===v.length+1&&keys.every(k=>k==='length'||typeof k==='string'&&/^(?:0|[1-9]\d*)$/.test(k)&&Number(k)<v.length&&ds[k].enumerable&&Object.hasOwn(ds[k],'value'));
}
function ledgerCheckInput(input,kind,failure){
 const base=['teamId','projectId'],keys={projects:['teamId','q','after','limit'],access:base,members:[...base,'q','after','limit'],history:[...base,'after','limit'],snapshot:[...base,'snapshotId','projectRevision','grantRevision'],receipt:[...base,'operationId'],change:[...base,'projectRevision','userId','memberRevision','grantRevision','read','currentPassword','confirmed'],import:[...base,'operationId','projectRevision','grantRevision','headRevision','sourceJson','currentPassword','sourceVerified','confirmed']}[kind];
 const optional=['projects','members','history'].includes(kind),v=keys&&fields(input,keys,optional?(kind==='projects'?['teamId']:base):keys);
 const bad=()=>{throw failure('INVALID_INPUT','账表快照参数无效，请核对当前项目、来源及明确授权。');};
 if(!v||!identifier(v.teamId)||kind!=='projects'&&!identifier(v.projectId))bad();
 if(optional){
  if(Object.hasOwn(v,'q')&&(typeof v.q!=='string'||!v.q.isWellFormed()||[...v.q].length>80||/[\p{Cc}\p{Cf}]/u.test(v.q))||Object.hasOwn(v,'limit')&&(!integer(v.limit,1)||v.limit>50)||Object.hasOwn(v,'after')&&(kind==='history'?!integer(v.after,1):!identifier(v.after)))bad();
 }
 if(['snapshot','change','import'].includes(kind)&&(!integer(v.projectRevision,1)||!integer(v.grantRevision,kind==='change'?0:1)))bad();
 if(kind==='snapshot'&&!uuid(v.snapshotId)||kind==='receipt'&&!uuid(v.operationId))bad();
 if(kind==='change'&&(!identifier(v.userId)||!integer(v.memberRevision)||v.grantRevision===Number.MAX_SAFE_INTEGER||typeof v.read!=='boolean'))bad();
 if(['change','import'].includes(kind)&&(typeof v.currentPassword!=='string'||!v.currentPassword||Buffer.byteLength(v.currentPassword)>512||v.confirmed!==true))bad();
 if(kind==='import'&&(!uuid(v.operationId)||!integer(v.headRevision)||v.headRevision===Number.MAX_SAFE_INTEGER||typeof v.sourceJson!=='string'||Buffer.byteLength(v.sourceJson)>codec.LIMITS.bytes||v.sourceVerified!==true))bad();
 return v;
}
// Private transport flag: no arbitrary large-response exception is accepted.
function ledgerTransportValid(route,{method,binary,body,snapshot}){
 const id='[A-Za-z0-9][A-Za-z0-9_-]{0,127}',uuid='[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',base='/api/teams/'+id+'/projects/'+id+'/ledger-checks';
 if(snapshot)return method==='GET'&&binary&&body===undefined&&new RegExp('^'+base+'/snapshots/'+uuid+'\\?projectRevision=[1-9]\\d*&grantRevision=[1-9]\\d*$').test(route);
 if(binary)return false;
 if(method==='POST')return body!==undefined&&new RegExp('^'+base+'/(?:access|imports)$').test(route);
 return method==='GET'&&body===undefined&&new RegExp('^(?:/api/teams/'+id+'/ledger-check-projects|'+base+'(?:/(?:access|members|imports/'+uuid+'))?)(?:\\?[^#]*)?$').test(route);
}
function accessValue(value,target,bad){
 const required=['teamId','projectId','projectRevision','grantRevision','read','canManageAccess','canImport','sourceAvailable'];
 const v=fields(value,[...required,'sourceProjectId','headRevision'],required);if(!v)bad();
 if(v.teamId!==target.teamId||v.projectId!==target.projectId||!integer(v.projectRevision,1)||!integer(v.grantRevision)||!['read','canManageAccess','canImport','sourceAvailable'].every(k=>typeof v[k]==='boolean')||v.read&&v.grantRevision===0)bad();
 if(v.read){if(!Object.hasOwn(v,'sourceProjectId')||!integer(v.headRevision)||(v.sourceAvailable?!uuid(v.sourceProjectId):v.sourceProjectId!==null))bad();}
 else if(Object.hasOwn(v,'sourceProjectId')||Object.hasOwn(v,'headRevision'))bad();
 if(v.canImport&&(!v.read||!v.canManageAccess||!v.sourceAvailable)||v.headRevision>0&&!v.sourceAvailable)bad();return {...v};
}
function metadataValue(value,bad){
 const v=fields(value,['id','version','sourceProjectId','sourceSha256','workspaceRevision','calculatedAt','confirmedBy','importedAt']);
 if(!v||!uuid(v.id)||!integer(v.version,1)||!uuid(v.sourceProjectId)||!hash(v.sourceSha256)||!integer(v.workspaceRevision,1)||!iso(v.calculatedAt)||!text(v.confirmedBy)||!integer(v.importedAt))bad();return {...v};
}
function receiptValue(value,operationId,bad){
 const v=fields(value,['operationId','snapshotId','version','sourceSha256','importedAt']);
 if(!v||v.operationId!==operationId||!uuid(v.operationId)||!uuid(v.snapshotId)||!integer(v.version,1)||!hash(v.sourceSha256)||!integer(v.importedAt))bad();return {...v};
}
function createLedgerCheckClient({request,failure,capture}={}){
 if(![request,failure,capture].every(f=>typeof f==='function'))throw Error('Missing ledger client dependencies');
 const bad=()=>{throw failure('INVALID_RESPONSE','账表快照响应无法核实；已发导入请按原操作编号只读核对。');};
 const changed=()=>{throw failure('LEDGER_CHECK_CHANGED','项目、账表授权或当前查阅已改变，旧内容已丢弃。');};
 const messagesOverride={400:'账表快照或参数无效，请核对已保存来源。',403:'当前密码验证失败或操作未获明确授权。',404:'当前项目、账表来源或原操作不可访问；在途操作仍须核对。',409:'项目、授权、来源或版本已改变，请刷新或查询原操作，勿重复提交。',413:'账表快照超过32MiB文件限制，未裁剪或上传为有效来源。',429:'导入或验证仍在处理中，请稍后查询原操作。',503:'账表操作结果暂时无法核实；已发导入请保留原编号，勿重复提交。'};
 const route=v=>'/api/teams/'+v.teamId+'/projects/'+v.projectId+'/ledger-checks';
 let readEpoch=0;
 function context(options={},epoch){
  const h=fields(options,['assertCurrent','signal','onDispatch'],[]);if(!h||Object.hasOwn(h,'assertCurrent')&&typeof h.assertCurrent!=='function'||Object.hasOwn(h,'onDispatch')&&typeof h.onDispatch!=='function'||Object.hasOwn(h,'signal')&&!(h.signal instanceof AbortSignal))throw failure('INVALID_INPUT','账表操作上下文无效。');
  const c=capture(),check=()=>{c.assertCurrent();h.assertCurrent?.();if(epoch!==undefined&&epoch!==readEpoch)changed();if(h.signal?.aborted)throw failure('LEDGER_CHECK_CANCELED','本次账表查阅已停止；已发导入仍须查询原操作。');};check();
  return {check,h,call:(path,settings={})=>request(path,{...settings,beforeSend:check,onDispatch:settings.method==='POST'?h.onDispatch:undefined,messagesOverride,ledgerCheck:{assertCurrent:check,snapshot:settings.binary===true,...(h.signal?{signal:h.signal}:{})}})};
 }
 async function access(v,c){const response=await c.call(route(v)+'/access');c.check();const top=fields(response,['access']);if(!top)bad();return accessValue(top.access,v,bad);}
 function query(v){const q=new URLSearchParams();for(const k of ['q','after','limit'])if(Object.hasOwn(v,k))q.set(k,String(v[k]));return q.size?'?'+q:'';}
 function page(v,top,key){if(typeof top.hasMore!=='boolean'||!dense(top[key],v.limit??20)||top.hasMore&&top[key].length!==(v.limit??20))bad();}
 return Object.freeze({
  retireLedgerCheckReads(){readEpoch++;},
  async getLedgerCheckAccess(input,options={}){const v=ledgerCheckInput(input,'access',failure),c=context(options,++readEpoch);return access(v,c);},
  async listLedgerCheckProjects(input,options={}){
   const v=ledgerCheckInput(input,'projects',failure),c=context(options,readEpoch),response=await c.call('/api/teams/'+v.teamId+'/ledger-check-projects'+query(v));c.check();const top=fields(response,['projects','hasMore']);if(!top)bad();page(v,top,'projects');const projects=[];
   for(const value of top.projects){const p=fields(value,['teamId','id','title','status','revision']);if(!p||p.teamId!==v.teamId||!identifier(p.id)||!text(p.title,300)||!['active','frozen'].includes(p.status)||!integer(p.revision,1)||v.after&&p.id<=v.after||projects.length&&p.id<=projects.at(-1).id)bad();projects.push({...p});}return {projects,hasMore:top.hasMore};
  },
  async listLedgerCheckMembers(input,options={}){
   const v=ledgerCheckInput(input,'members',failure),c=context(options,readEpoch),response=await c.call(route(v)+'/members'+query(v));c.check();const top=fields(response,['members','hasMore']);if(!top)bad();page(v,top,'members');const members=[];
   for(const value of top.members){const p=fields(value,['id','displayName','role','memberRevision','grantRevision','read']);if(!p||!identifier(p.id)||!text(p.displayName)||!['manager','partner'].includes(p.role)||!integer(p.memberRevision)||!integer(p.grantRevision)||typeof p.read!=='boolean'||p.read&&p.grantRevision===0||v.after&&p.id<=v.after||members.length&&p.id<=members.at(-1).id)bad();members.push({...p});}return {members,hasMore:top.hasMore};
  },
  async changeLedgerCheckAccess(input,options={}){
   const v=ledgerCheckInput(input,'change',failure),c=context(options),body={projectRevision:v.projectRevision,userId:v.userId,memberRevision:v.memberRevision,grantRevision:v.grantRevision,read:v.read,currentPassword:v.currentPassword};
   try{const response=await c.call(route(v)+'/access',{method:'POST',body});c.check();const result=fields(response,['changed','projectRevision']);if(!result||result.changed!==true||result.projectRevision!==v.projectRevision)bad();return {...result};}finally{body.currentPassword='';}
  },
  async listLedgerCheckSnapshots(input,options={}){
   const v=ledgerCheckInput(input,'history',failure),c=context(options,readEpoch),response=await c.call(route(v)+query(v));c.check();const top=fields(response,['snapshots','hasMore','headRevision','projectRevision','grantRevision']);if(!top||!integer(top.headRevision)||!integer(top.projectRevision,1)||!integer(top.grantRevision,1))bad();page(v,top,'snapshots');const snapshots=[],ids=new Set();
   for(const value of top.snapshots){const p=metadataValue(value,bad);if(p.version>top.headRevision||v.after&&p.version>=v.after||snapshots.length&&p.version>=snapshots.at(-1).version||ids.has(p.id))bad();ids.add(p.id);snapshots.push(p);}
   if(!v.after&&(top.headRevision===0?snapshots.length!==0:!snapshots.length||snapshots[0].version!==top.headRevision))bad();return {...top,snapshots};
  },
  async getLedgerCheckImportReceipt(input,options={}){
   const v=ledgerCheckInput(input,'receipt',failure),c=context(options,readEpoch),response=await c.call(route(v)+'/imports/'+v.operationId);c.check();const top=fields(response,['receipt']);if(!top)bad();return receiptValue(top.receipt,v.operationId,bad);
  },
  // Private main-process import; raw JSON and the password never enter preload.
  async importLedgerCheckSnapshot(input,options={}){
   const v=ledgerCheckInput(input,'import',failure),c=context(options);let source;try{source=await codec.parse(v.sourceJson);}catch{throw failure('INVALID_INPUT','来源快照无法通过原格式与项目绑定检查。');}c.check();const current=await access(v,c);c.check();if(!current.canImport||current.projectRevision!==v.projectRevision||current.grantRevision!==v.grantRevision||current.headRevision!==v.headRevision||current.sourceProjectId!==source.sourceProjectId)changed();
   const body={operationId:v.operationId,projectRevision:v.projectRevision,grantRevision:v.grantRevision,headRevision:v.headRevision,sourceJson:v.sourceJson,currentPassword:v.currentPassword};
   try{const response=await c.call(route(v)+'/imports',{method:'POST',body});c.check();const top=fields(response,['receipt']);if(!top)bad();const receipt=receiptValue(top.receipt,v.operationId,bad);if(receipt.sourceSha256!==sha(v.sourceJson)||receipt.version!==v.headRevision+1)bad();return receipt;}finally{body.currentPassword='';body.sourceJson='';}
  },
  async getLedgerCheckSnapshot(input,options={}){
   const v=ledgerCheckInput(input,'snapshot',failure),c=context(options,++readEpoch),before=await access(v,c);c.check();if(!before.read||!before.sourceAvailable||before.projectRevision!==v.projectRevision||before.grantRevision!==v.grantRevision)changed();
   const q=new URLSearchParams({projectRevision:String(v.projectRevision),grantRevision:String(v.grantRevision)});let raw;
   try{
    raw=await c.call(route(v)+'/snapshots/'+v.snapshotId+'?'+q,{binary:true});c.check();const data=fields(raw,['bytes','contentType','contentLength','cacheControl','sourceSha256','snapshotId','version','sourceProjectId','projectRevision','grantRevision']);
    if(!data||!(data.bytes instanceof Uint8Array)||!data.bytes.length||data.bytes.length>codec.LIMITS.bytes||data.contentType!=='application/json; charset=utf-8'||typeof data.contentLength!=='string'||!(/^[1-9]\d*$/.test(data.contentLength))||Number(data.contentLength)!==data.bytes.length||typeof data.cacheControl!=='string'||!['private','no-store'].every(k=>data.cacheControl.toLowerCase().split(',').map(s=>s.trim()).includes(k))||!hash(data.sourceSha256)||sha(data.bytes)!==data.sourceSha256||data.snapshotId!==v.snapshotId||data.projectRevision!==String(v.projectRevision)||data.grantRevision!==String(v.grantRevision)||typeof data.version!=='string'||!(/^[1-9]\d*$/.test(data.version))||!integer(Number(data.version),1)||Number(data.version)>before.headRevision||data.sourceProjectId!==before.sourceProjectId)bad();
    let snapshot;try{snapshot=await codec.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.bytes));}catch{c.check();bad();}c.check();if(snapshot.sourceProjectId!==data.sourceProjectId)bad();
    const after=await access(v,c);c.check();if(!after.read||!after.sourceAvailable||after.projectRevision!==before.projectRevision||after.grantRevision!==before.grantRevision||after.sourceProjectId!==before.sourceProjectId||after.headRevision<Number(data.version))changed();
    return {snapshot,metadata:{teamId:v.teamId,projectId:v.projectId,snapshotId:v.snapshotId,version:Number(data.version),sourceProjectId:data.sourceProjectId,sourceSha256:data.sourceSha256,projectRevision:v.projectRevision,grantRevision:v.grantRevision,byteLength:data.bytes.length}};
   }finally{if(raw?.bytes instanceof Uint8Array)raw.bytes.fill(0);}
  }
 });
}
module.exports={createLedgerCheckClient,ledgerCheckInput,ledgerTransportValid,MAX_LEDGER_SNAPSHOT_BYTES:codec.LIMITS.bytes};
