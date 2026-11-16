import A from '../../dist/audit-checklist.js';
import admission from '../../shared/material-admission.cjs';
import {randomUUID} from 'node:crypto';
import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
import {projectIncrement,projectTime} from './project-access-policy.mjs';
import {materialConflict,materialDigest,materialInteger,scopedMaterialRecord,materialRecordVersion,trustedMaterialReviewer,materialReceipt,materialReceiptRow} from './materials-policy.mjs';
import {materialRequestUsed} from './materials-maintenance-grant.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,HISTORIC_UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,SHA=/^[a-f0-9]{64}$/,FILE_MAX=12*1024*1024;
function exact(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))invalid();}
export async function handleMaterialMaintenanceMutation({request,db,now,actor,before,fresh,teamId,projectId,fileId}){
 const adding=fileId===null,common=['requestId','projectRevision','materialRevision','recordSha256','nodeId','generationId'],keys=adding?[...common,'filename','mimeType','byteLength','sha256','contentBase64']:[...common,'reason'];
 if(!adding&&!HISTORIC_UUID.test(fileId))deny();
 const body=await readJson(request,keys,adding?17*1024*1024:16384);exact(body,keys);
 if(!UUID.test(body.requestId??'')||!Number.isSafeInteger(body.projectRevision)||body.projectRevision<1||!Number.isSafeInteger(body.materialRevision)||body.materialRevision<1||!SHA.test(body.recordSha256??'')||!ID.test(body.nodeId??'')||!HISTORIC_UUID.test(body.generationId??'')||!adding&&typeof body.reason!=='string')invalid();
 const permission={read:true,maintain:true,active:true},check=()=>{
  fresh(permission);if(body.projectRevision!==before.project.revision||materialRequestUsed(db,body.requestId))materialConflict();
  const row=scopedMaterialRecord(db,actor,teamId,projectId);if(!row||materialInteger(row.material_revision,1)!==body.materialRevision||row.record_sha256!==body.recordSha256)materialConflict();
   const record=materialRecordVersion(row,before.identity);if(record.schema!==2||record.closed)throw new ApiError(409,'MATERIAL_NOT_EDITABLE','仅已开门的层级资料清单可以维护原件，请按原规则处理。');
  if(record.generationId!==body.generationId)materialConflict();if(!Object.hasOwn(record.attachments,body.nodeId))invalid();
  if(!adding&&!record.attachments[body.nodeId].some(file=>file.id===fileId))materialConflict();return {row,record};
 };
 check();let bytes=null,admitted=null;
 if(adding){
  if(typeof body.filename!=='string'||body.filename.length>180||typeof body.mimeType!=='string'||body.mimeType.length>100||!Number.isSafeInteger(body.byteLength)||body.byteLength<1||body.byteLength>FILE_MAX||!SHA.test(body.sha256??'')||typeof body.contentBase64!=='string'||body.contentBase64.length>Math.ceil(FILE_MAX/3)*4)invalid();
  bytes=Buffer.from(body.contentBase64,'base64');if(!bytes.length||bytes.length!==body.byteLength||bytes.toString('base64')!==body.contentBase64||materialDigest(bytes)!==body.sha256)invalid();
  try{admitted=await admission.prepareMaterialFile({name:body.filename,type:body.mimeType,size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer},{assertCurrent:check});}
  catch(error){check();if(error instanceof ApiError)throw error;throw new ApiError(400,'MATERIAL_ORIGINAL_INVALID','原件正文未通过原入库规则，未发布。');}
  check();if(admitted.name!==body.filename||admitted.type!==body.mimeType||admitted.size!==body.byteLength||admitted.sha256!==body.sha256||admitted.blob.size!==body.byteLength)invalid();
 }
 return transaction(db,()=>{
  const {row,record}=check(),nextRevision=projectIncrement(body.materialRevision),reviewer=trustedMaterialReviewer(db.prepare('SELECT display_name FROM team_credentials WHERE user_id=?').get(actor.userId)?.display_name,actor.userId),id=adding?randomUUID():fileId;
  const countBefore=db.prepare('SELECT COUNT(*) n FROM team_material_files WHERE team_id=? AND project_id=?').get(teamId,projectId).n;
  const action=adding?{type:'attachment-add',nodeId:body.nodeId,file:{id,nodeId:body.nodeId,generationId:body.generationId,name:admitted.name,size:admitted.size,type:admitted.type,sha256:admitted.sha256},reviewer}:{type:'attachment-remove',nodeId:body.nodeId,fileId:id,reason:body.reason,reviewer};
  let next;try{next=A.apply(record,action);}catch{throw new ApiError(400,'MATERIAL_ACTION_INVALID','该原件变化不符合原资料维护规则，原记录未改。');}
  const recordJson=JSON.stringify(next),sha=materialDigest(recordJson);if(Buffer.byteLength(recordJson)>24*1024*1024)throw new ApiError(413,'MATERIAL_RECORD_TOO_LARGE','资料留痕达到上限，未发布。');
  if(adding){const m=next.events.at(-1).file;if(bytes.length!==m.size||materialDigest(bytes)!==m.sha256)throw Error('Admitted material original changed');db.prepare('INSERT INTO team_material_files VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(teamId,projectId,m.id,m.generationId,m.nodeId,JSON.stringify(m),m.name,m.type,m.size,m.sha256,bytes);}
  if(db.prepare('UPDATE team_material_records SET material_revision=?,record_json=?,record_sha256=? WHERE team_id=? AND project_id=? AND material_revision=? AND record_sha256=?').run(nextRevision,recordJson,sha,teamId,projectId,body.materialRevision,body.recordSha256).changes!==1)materialConflict();
  db.prepare('INSERT INTO team_material_maintenance_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),body.requestId,teamId,projectId,actor.userId,action.type,id,body.nodeId,body.generationId,before.project.revision,body.materialRevision,nextRevision,sha,row.package_sha256,materialInteger(row.source_record_revision,1),next.revision,adding?'':body.reason,projectTime(now()));
  const final=scopedMaterialRecord(db,actor,teamId,projectId),countAfter=db.prepare('SELECT COUNT(*) n FROM team_material_files WHERE team_id=? AND project_id=?').get(teamId,projectId).n;fresh(permission);
  if(!final||materialInteger(final.material_revision,1)!==nextRevision||final.record_json!==recordJson||final.record_sha256!==sha||final.source_record_json!==row.source_record_json||final.package_sha256!==row.package_sha256||countAfter!==countBefore+Number(adding))materialConflict();
  const receipt=materialReceipt(materialReceiptRow(db,body.requestId,actor.userId,teamId,projectId));return json(receipt,adding?201:200);
 });
}
