'use strict';
const codec=require('../dist/legacy-project-source.js');
const {createHash}=require('node:crypto');
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/,MAX_SOURCE_BYTES=128*1024;
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
function fields(value,allowed,required=allowed){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype)return null;const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
 if(keys.some(k=>typeof k!=='string'||!allowed.includes(k)||!descriptors[k].enumerable||!Object.hasOwn(descriptors[k],'value'))||required.some(k=>!Object.hasOwn(descriptors,k)))return null;
 return Object.fromEntries(keys.map(k=>[k,descriptors[k].value]));
}
const identifier=v=>typeof v==='string'&&ID.test(v),hash=v=>typeof v==='string'&&HASH.test(v);
function dense(value,limit){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>limit)return false;const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
 return keys.length===value.length+1&&keys.every(k=>k==='length'||typeof k==='string'&&/^(?:0|[1-9]\d*)$/.test(k)&&Number(k)<value.length&&d[k].enumerable&&Object.hasOwn(d[k],'value'));
}
function workspaceSourceInput(value,kind,failure){
 const keys=kind==='members'?['teamId','projectId','q','after','limit']:kind==='change'?['teamId','projectId','projectRevision','userId','memberRevision','grantRevision','read','export','currentPassword','confirmed']:kind==='access'?['teamId','projectId']:null;
 const v=keys?fields(value,keys,kind==='members'?['teamId','projectId']:keys):null,invalid=()=>{throw failure('INVALID_INPUT','立项来源参数无效，请核对当前项目及明确授权。');};
 if(!v||!identifier(v.teamId)||!identifier(v.projectId))invalid();
 if(kind==='members'&&(Object.hasOwn(v,'q')&&(typeof v.q!=='string'||!v.q.isWellFormed()||[...v.q].length>80||/[\p{Cc}\p{Cf}]/u.test(v.q))||Object.hasOwn(v,'after')&&!identifier(v.after)||Object.hasOwn(v,'limit')&&(!integer(v.limit,1)||v.limit>50)))invalid();
 if(kind==='change'&&(!integer(v.projectRevision,1)||!identifier(v.userId)||!integer(v.memberRevision)||!integer(v.grantRevision)||v.grantRevision>=Number.MAX_SAFE_INTEGER||typeof v.read!=='boolean'||typeof v.export!=='boolean'||typeof v.currentPassword!=='string'||!v.currentPassword||Buffer.byteLength(v.currentPassword)>512||v.confirmed!==true))invalid();
 return v;
}
function sourceAccessValue(value,target,bad){
 const v=fields(value,['teamId','projectId','projectRevision','grantRevision','canManageAccess','sourceAvailable','read','export']);
 if(!v||!identifier(v.teamId)||!identifier(v.projectId)||v.teamId!==target.teamId||v.projectId!==target.projectId||!integer(v.projectRevision,1)||!integer(v.grantRevision)||!['canManageAccess','sourceAvailable','read','export'].every(k=>typeof v[k]==='boolean')||v.grantRevision===0&&(v.read||v.export))bad();return {...v};
}
function sourceMetadataValue(value,target,bad){
 const v=fields(value,['teamId','projectId','projectRevision','grantRevision','sourceKind','sourceProjectId','sourceSha256','byteLength']);
 if(!v||!identifier(v.teamId)||!identifier(v.projectId)||v.teamId!==target.teamId||v.projectId!==target.projectId||!integer(v.projectRevision,1)||!integer(v.grantRevision,1)||!['workspace-formalization','project-migration'].includes(v.sourceKind)||typeof v.sourceProjectId!=='string'||!UUID.test(v.sourceProjectId)||v.sourceKind==='project-migration'&&v.projectId!==v.sourceProjectId||!hash(v.sourceSha256)||!integer(v.byteLength,1)||v.byteLength>MAX_SOURCE_BYTES)bad();return {...v};
}
function createWorkspaceSourceClient({request,failure,capture}={}){
 if(![request,failure,capture].every(f=>typeof f==='function'))throw Error('Missing workspace-source client dependencies');
 const invalid=()=>{throw failure('INVALID_INPUT','立项来源参数无效，请核对当前项目及明确授权。');},bad=()=>{throw failure('INVALID_RESPONSE','立项来源响应无法核实，未显示或保存来源。');};
 const messagesOverride={400:'立项来源参数无效，请刷新核对。',403:'来源操作未获明确授权或当前密码验证失败。',404:'当前项目或立项来源不可访问。',409:'项目、人员、授权或来源已变化，请刷新核对，勿重复提交。',503:'来源操作结果暂时无法核对；已发授权请先只读刷新，勿重复提交。'};
 const target=(input,allowed=['teamId','projectId'],required=allowed)=>{const v=fields(input,allowed,required);if(!v||!identifier(v.teamId)||!identifier(v.projectId))invalid();return v;};
 const route=v=>'/api/teams/'+v.teamId+'/projects/'+v.projectId+'/initiation-source';
 let sourceReadEpoch=0;
 const hooks=value=>{const h=fields(value,['assertCurrent','signal'],[]);if(!h||Object.hasOwn(h,'assertCurrent')&&typeof h.assertCurrent!=='function'||Object.hasOwn(h,'signal')&&!(h.signal instanceof AbortSignal))invalid();return h;};
 async function access(v,c,h={}){const check=()=>{c.assertCurrent();h.assertCurrent?.();if(h.signal?.aborted)throw failure('WORKSPACE_SOURCE_EXPORT_CANCELED','本次立项来源保存已停止。');};check();const value=await request(route(v)+'/access',{beforeSend:check,workspaceSourceRead:{assertCurrent:check,...(h.signal?{signal:h.signal}:{})},messagesOverride});check();const top=fields(value,['access']);if(!top)bad();const result=sourceAccessValue(top.access,v,bad);check();return result;}
 return Object.freeze({
  async getWorkspaceSourceAccess(input,options={}){const v=workspaceSourceInput(input,'access',failure),h=hooks(options),c=capture();sourceReadEpoch++;return access(v,c,h);},
  async listWorkspaceSourceMembers(input){
   const v=workspaceSourceInput(input,'members',failure);
   const limit=v.limit??20,query=new URLSearchParams();for(const k of ['q','after','limit'])if(Object.hasOwn(v,k))query.set(k,String(v[k]));const c=capture();c.assertCurrent();const value=await request(route(v)+'/members'+(query.size?'?'+query:''),{beforeSend:c.assertCurrent,messagesOverride});c.assertCurrent();
   const top=fields(value,['members','hasMore']);if(!top||typeof top.hasMore!=='boolean'||!dense(top.members,limit)||top.hasMore&&top.members.length!==limit)bad();const members=[];
   for(const row of top.members){const m=fields(row,['id','displayName','role','memberRevision','grantRevision','read','export']);if(!m||!identifier(m.id)||typeof m.displayName!=='string'||!m.displayName.isWellFormed()||m.displayName!==m.displayName.trim()||!m.displayName||[...m.displayName].length>80||/[\p{Cc}\p{Cf}]/u.test(m.displayName)||!['manager','partner'].includes(m.role)||!integer(m.memberRevision)||!integer(m.grantRevision)||typeof m.read!=='boolean'||typeof m.export!=='boolean'||m.grantRevision===0&&(m.read||m.export)||v.after&&m.id<=v.after||members.length&&m.id<=members.at(-1).id)bad();members.push({...m});}
   c.assertCurrent();return {members,hasMore:top.hasMore};
  },
  async changeWorkspaceSourceAccess(input){
   const v=workspaceSourceInput(input,'change',failure);
   const c=capture(),body={projectRevision:v.projectRevision,userId:v.userId,memberRevision:v.memberRevision,grantRevision:v.grantRevision,read:v.read,export:v.export,currentPassword:v.currentPassword};
   try{c.assertCurrent();const value=await request(route(v)+'/access',{method:'POST',body,beforeSend:c.assertCurrent,messagesOverride});c.assertCurrent();const result=fields(value,['changed','projectRevision']);if(!result||result.changed!==true||!integer(result.projectRevision,1)||result.projectRevision!==v.projectRevision)bad();return {...result};}finally{body.currentPassword='';}
  },
  async getWorkspaceSource(input){
   const v=workspaceSourceInput(input,'access',failure),base=capture(),at=++sourceReadEpoch,c={assertCurrent(){base.assertCurrent();if(at!==sourceReadEpoch)throw failure('WORKSPACE_SOURCE_CHANGED','新的立项来源读取已开始，旧响应已丢弃。');}};c.assertCurrent();const value=await request(route(v),{beforeSend:c.assertCurrent,workspaceSourceRead:{assertCurrent:c.assertCurrent},messagesOverride});c.assertCurrent();const top=fields(value,['source','metadata']);if(!top)bad();const metadata=sourceMetadataValue(top.metadata,v,bad);let encoded,source;
   try{try{source=codec.validate(top.source);encoded=codec.encode(source);}catch{bad();}if(encoded.length!==metadata.byteLength||encoded.length>MAX_SOURCE_BYTES)bad();let inspected;try{inspected=await codec.inspect(encoded);}catch{c.assertCurrent();bad();}c.assertCurrent();if(inspected.sha256!==metadata.sourceSha256||inspected.summary.projectId!==metadata.sourceProjectId)bad();source=inspected.source;
    const fresh=await access(v,c);c.assertCurrent();if(!fresh.read||!fresh.sourceAvailable||fresh.projectRevision!==metadata.projectRevision||fresh.grantRevision!==metadata.grantRevision)throw failure('WORKSPACE_SOURCE_CHANGED','来源查阅权或项目版本已变化，未显示旧来源。');return {source,metadata};
   }finally{encoded?.fill(0);}
  },
  // Private main transport; this method is deliberately absent from preload.
  async downloadWorkspaceSource(input,options={}){
   const v=target(input,['teamId','projectId','projectRevision','grantRevision']),h=fields(options,['assertCurrent','signal'],[]);
   if(!integer(v.projectRevision,1)||!integer(v.grantRevision,1)||!h||Object.hasOwn(h,'assertCurrent')&&typeof h.assertCurrent!=='function'||Object.hasOwn(h,'signal')&&!(h.signal instanceof AbortSignal))invalid();
   const c=capture(),check=()=>{c.assertCurrent();h.assertCurrent?.();if(h.signal?.aborted)throw failure('WORKSPACE_SOURCE_EXPORT_CANCELED','本次立项来源保存已停止。');},query=new URLSearchParams({projectRevision:String(v.projectRevision),grantRevision:String(v.grantRevision)}),hooks={assertCurrent:check,...(h.signal?{signal:h.signal}:{})};let raw;
   try{
    check();raw=await request(route(v)+'/export?'+query,{binary:true,beforeSend:check,workspaceSourceExport:hooks,messagesOverride});check();
    const value=fields(raw,['bytes','contentType','contentLength','contentDisposition','cacheControl','sourceSha256','sourceProjectId','sourceKind','projectRevision','grantRevision']);
    if(!value||!(value.bytes instanceof Uint8Array)||!value.bytes.length||value.bytes.length>MAX_SOURCE_BYTES||value.contentType!=='application/json; charset=utf-8'||typeof value.contentLength!=='string'||!(/^[1-9]\d*$/.test(value.contentLength))||Number(value.contentLength)!==value.bytes.length||value.contentDisposition!=='attachment; filename="shenyi-initiation-source.json"'||typeof value.cacheControl!=='string'||!value.cacheControl.toLowerCase().split(',').map(s=>s.trim()).includes('private')||!value.cacheControl.toLowerCase().split(',').map(s=>s.trim()).includes('no-store')||value.projectRevision!==String(v.projectRevision)||value.grantRevision!==String(v.grantRevision)||!hash(value.sourceSha256)||createHash('sha256').update(value.bytes).digest('hex')!==value.sourceSha256)bad();
    const metadata=sourceMetadataValue({...{teamId:v.teamId,projectId:v.projectId,projectRevision:v.projectRevision,grantRevision:v.grantRevision},sourceKind:value.sourceKind,sourceProjectId:value.sourceProjectId,sourceSha256:value.sourceSha256,byteLength:value.bytes.length},v,bad);check();return {bytes:Uint8Array.from(value.bytes),metadata};
   }finally{if(raw?.bytes instanceof Uint8Array)raw.bytes.fill(0);}
  }
 });
}
module.exports={createWorkspaceSourceClient,workspaceSourceInput,sourceAccessValue,sourceMetadataValue,MAX_SOURCE_BYTES};
