import preservation from '../../dist/material-preservation.js';
import {performance} from 'node:perf_hooks';
import {consume} from './auth-api.mjs';
import {projectActor,currentActor,projectTime} from './project-access-policy.mjs';
import {materialContext,materialSqlScope,materialRecordVersion,materialInteger,materialDigest} from './materials-policy.mjs';
import {deviceServerId,UUID} from './device-policy.mjs';
import {ApiError,ID,PRIVATE_HEADERS,deny,invalid,json} from './http-utils.mjs';

const FILE_BYTES=12*1048576,ORIGINAL_BYTES=150*1048576,RECORD_BYTES=24*1048576,PACKAGE_BYTES=180*1048576,MAX_FILES=5000,TIMEOUT_MS=180000;
const HASH=/^[a-f0-9]{64}$/;
let building=false;
const conflict=()=>{throw new ApiError(409,'MATERIAL_EXPORT_CONFLICT','资料、权限或导出计划已改变，请刷新后重新导出。');};
const tooLarge=()=>{throw new ApiError(413,'MATERIAL_EXPORT_TOO_LARGE','资料保全导出超过文件数量或大小上限。');};
const corrupted=()=>{throw Error('Invalid trusted material export source');};
function canonical(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
function integerQuery(value){if(typeof value!=='string'||!/^[1-9]\d*$/u.test(value)||!Number.isSafeInteger(Number(value)))invalid();return Number(value);}
function query(url,binary){
 if(!binary){if(url.search)invalid();return null;}
 const names=['projectRevision','materialRevision','recordSha256','planSha256'];
 if(url.search.length>1024||url.search.slice(1)!==url.searchParams.toString())invalid();
 for(const name of url.searchParams.keys())if(!names.includes(name)||url.searchParams.getAll(name).length!==1)invalid();
 if(names.some(name=>!url.searchParams.has(name)))invalid();
 const recordSha256=url.searchParams.get('recordSha256'),planSha256=url.searchParams.get('planSha256');
 if(!HASH.test(recordSha256)||!HASH.test(planSha256))invalid();
 return {projectRevision:integerQuery(url.searchParams.get('projectRevision')),materialRevision:integerQuery(url.searchParams.get('materialRevision')),recordSha256,planSha256};
}
function snapshot(db,work){
 db.exec('BEGIN');let open=true;
 try{const value=work();db.exec('COMMIT');open=false;return value;}
 catch(error){if(open)try{db.exec('ROLLBACK');}catch{}throw error;}
}
function scopedFrom(actor){
 const scope=materialSqlScope(actor);
 return {from:`FROM team_material_records material
 JOIN team_projects project ON project.team_id=material.team_id AND project.project_id=material.project_id
 JOIN team_project_access_projects metadata ON metadata.team_id=project.team_id AND metadata.project_id=project.project_id`,scope};
}
function recordRow(db,actor,teamId,projectId,full){
 const {from,scope}=scopedFrom(actor);
 return db.prepare(`SELECT CAST(material.material_revision AS TEXT) material_revision,material.record_sha256
 ${full?',material.record_json,CAST(material.source_record_revision AS TEXT) source_record_revision':''}
 ${from} WHERE material.team_id=? AND material.project_id=? AND ${scope.sql}`).get(teamId,projectId,...scope.parameters)||null;
}
function fileRows(db,actor,teamId,projectId){
 const {from,scope}=scopedFrom(actor);
 return db.prepare(`SELECT original.file_id,original.generation_id,original.node_id,original.metadata_json,original.filename,original.mime,
 CAST(original.byte_length AS TEXT) byte_length,original.sha256 ${from}
 JOIN team_material_files original ON original.team_id=material.team_id AND original.project_id=material.project_id
 WHERE material.team_id=? AND material.project_id=? AND ${scope.sql} ORDER BY original.file_id COLLATE BINARY LIMIT ?`).all(teamId,projectId,...scope.parameters,MAX_FILES+1);
}
function fileMatches(row,meta){
 return row&&row.file_id===meta.id&&row.generation_id===meta.generationId&&row.node_id===meta.nodeId
 &&row.filename===meta.name&&row.mime===meta.type&&row.byte_length===String(meta.size)&&row.sha256===meta.sha256
 &&row.metadata_json===JSON.stringify(meta);
}
function fullState(db,actor,context,teamId,projectId){
 const row=recordRow(db,actor,teamId,projectId,true);if(!row)deny();
 if(typeof row.record_json!=='string'||!HASH.test(row.record_sha256))corrupted();
 const recordByteLength=Buffer.byteLength(row.record_json);if(recordByteLength>RECORD_BYTES)tooLarge();
 let raw;try{raw=JSON.parse(row.record_json);}catch{corrupted();}
 if(JSON.stringify(raw)!==row.record_json)corrupted();
 // Bound known histories before invoking the original complete model validator.
 if(Array.isArray(raw?.events)){
  let count=0,total=0;
  for(const event of raw.events)if(event?.type==='attachment-add'){
   if(++count>MAX_FILES)tooLarge();
   const size=event.file?.size;if(Number.isSafeInteger(size)&&size>FILE_BYTES)tooLarge();
   if(Number.isSafeInteger(size)&&size>=0){total+=size;if(total>ORIGINAL_BYTES)tooLarge();}
  }
 }
 const record=materialRecordVersion(row,context.identity),files=preservation.filesFor(record);
 if(files.length>MAX_FILES)tooLarge();
 let originalByteLength=0;
 for(const meta of files){if(!Number.isSafeInteger(meta.size)||meta.size<1)corrupted();if(meta.size>FILE_BYTES)tooLarge();originalByteLength+=meta.size;if(originalByteLength>ORIGINAL_BYTES)tooLarge();}
 const rows=fileRows(db,actor,teamId,projectId);if(rows.length>MAX_FILES)tooLarge();
 if(rows.length!==files.length)corrupted();const byId=new Map(rows.map(value=>[value.file_id,value]));
 for(const meta of files)if(!fileMatches(byId.get(meta.id),meta))corrupted();
 const plan={teamId,projectId,sourceProjectId:context.identity.sourceProjectId,resourceKind:context.identity.workspace?'collection-workspace':'legacy',projectStatus:context.project.status,
  projectRevision:context.project.revision,materialRevision:materialInteger(row.material_revision,1),recordSha256:row.record_sha256,recordSchema:record.schema,recordRevision:materialInteger(record.revision,1),
  generationId:record.schema===2?record.generationId:null,recordByteLength,fileCount:files.length,originalByteLength,filesSha256:materialDigest(canonical(files)),packageByteLimit:PACKAGE_BYTES,serverId:deviceServerId(db)};
 plan.planSha256=materialDigest(canonical(plan));
 return {record,recordJson:row.record_json,files,byId,plan};
}
function originFor(plan){return Object.fromEntries(['teamId','projectId','sourceProjectId','resourceKind','projectStatus','projectRevision','materialRevision','recordSha256','recordByteLength','filesSha256','serverId','planSha256'].map(key=>[key,plan[key]]));}
function contextStamp(context){return [context.member.stamp,context.project.revision,context.project.status,context.grant.revision,context.maintenance.revision,context.identity.stamp].join('|');}
function expectPlan(plan,expected){if(expected&&['projectRevision','materialRevision','recordSha256','planSha256'].some(key=>plan[key]!==expected[key]))conflict();}

export async function handleMaterialPreservationRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
 const url=new URL(request.url),match=/^\/api\/teams\/([^/]+)\/projects\/([^/]+)\/materials\/(export-plan|export-package)$/.exec(url.pathname);if(!match)return null;
 if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
 const teamId=match[1],projectId=match[2],binary=match[3]==='export-package';if(!ID.test(teamId)||!UUID.test(projectId))deny();
 const expected=query(url,binary),options={identityProviders,deviceContext},actor=projectActor(db,request,options,projectTime(now()));
 const before=materialContext(db,actor,teamId,projectId,{read:true}),stamp=contextStamp(before),serverId=deviceServerId(db);
 const initial=snapshot(db,()=>fullState(db,currentActor(db,request,actor,options,projectTime(now())),before,teamId,projectId));expectPlan(initial.plan,expected);
 let stopped=null,deadline=Infinity;
 const assertCurrent=()=>{
  if(stopped)throw stopped;
  if(request.signal.aborted)throw new ApiError(409,'MATERIAL_EXPORT_CANCELED','资料导出已取消。');
  if(performance.now()>=deadline)throw new ApiError(504,'MATERIAL_EXPORT_TIMEOUT','资料导出超过时限，请重新选择。');
  const current=currentActor(db,request,actor,options,projectTime(now())),context=materialContext(db,current,teamId,projectId,{read:true});
  if(contextStamp(context)!==stamp||deviceServerId(db)!==serverId)conflict();
  const row=recordRow(db,current,teamId,projectId,false);if(!row)deny();
  if(materialInteger(row.material_revision,1)!==initial.plan.materialRevision||row.record_sha256!==initial.plan.recordSha256)conflict();
 };
 const readCurrent=()=>{
  assertCurrent();const current=snapshot(db,()=>fullState(db,currentActor(db,request,actor,options,projectTime(now())),materialContext(db,actor,teamId,projectId,{read:true}),teamId,projectId));
  if(current.plan.planSha256!==initial.plan.planSha256||current.recordJson!==initial.recordJson)conflict();assertCurrent();return {record:current.record,origin:originFor(current.plan)};
 };
 assertCurrent();
 if(!binary){readCurrent();return json(initial.plan);}
 if(building)throw new ApiError(503,'MATERIAL_EXPORT_BUSY','资料保全导出繁忙，请稍后重新操作。');
 consume(db,'materials-preservation-export:'+materialDigest(actor.userId),projectTime(now()),60000,4);
 assertCurrent();building=true;deadline=performance.now()+TIMEOUT_MS;
 let timer,abort;
 const interruption=new Promise((resolve,reject)=>{
  abort=()=>{stopped=new ApiError(409,'MATERIAL_EXPORT_CANCELED','资料导出已取消。');reject(stopped);};
  timer=setTimeout(()=>{stopped=new ApiError(504,'MATERIAL_EXPORT_TIMEOUT','资料导出超过时限，请重新选择。');reject(stopped);},TIMEOUT_MS);timer.unref?.();
  request.signal.addEventListener('abort',abort,{once:true});
 });
 const work=(async()=>{
  try{
   assertCurrent();
   const readFile=meta=>{
    assertCurrent();const captured=initial.byId.get(meta.id);if(!fileMatches(captured,meta))corrupted();
    const {from,scope}=scopedFrom(actor),row=db.prepare(`SELECT original.file_id,original.generation_id,original.node_id,original.metadata_json,original.filename,original.mime,
     CAST(original.byte_length AS TEXT) byte_length,original.sha256,original.bytes ${from}
     JOIN team_material_files original ON original.team_id=material.team_id AND original.project_id=material.project_id
     WHERE material.team_id=? AND material.project_id=? AND original.file_id=? AND ${scope.sql}`).get(teamId,projectId,meta.id,...scope.parameters);
    if(!row)deny();if(!fileMatches(row,meta))corrupted();
    if(!(row.bytes instanceof Uint8Array)||row.bytes.byteLength!==meta.size)corrupted();const bytes=Uint8Array.from(row.bytes);
    if(materialDigest(bytes)!==meta.sha256)corrupted();assertCurrent();return {metadata:structuredClone(meta),blob:new Blob([bytes],{type:meta.type})};
   };
   const result=await preservation.createTeam({record:initial.record,origin:originFor(initial.plan),readFile,readCurrent,assertCurrent});assertCurrent();
   if(!(result?.blob instanceof Blob)||result.blob.size>PACKAGE_BYTES)tooLarge();
   const bytes=new Uint8Array(await result.blob.arrayBuffer());assertCurrent();if(bytes.length!==result.blob.size||bytes.length>PACKAGE_BYTES)tooLarge();
   const sha256=materialDigest(bytes);if(sha256!==result.sha256)corrupted();readCurrent();assertCurrent();
   return new Response(bytes,{headers:{...PRIVATE_HEADERS,'Content-Type':'application/zip','Content-Length':String(bytes.length),
    'Content-Disposition':'attachment; filename="shenyi-material-preservation.zip"','X-Shenyi-Material-Export-Sha256':sha256,'X-Shenyi-Material-Plan-Sha256':initial.plan.planSha256}});
  }finally{building=false;}
 })();
 try{return await Promise.race([work,interruption]);}
 finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
}
