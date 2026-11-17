import codec from '../../dist/workpaper-package.js';
import {dataHead,dataDigest,dataConflict,SHA,UUID} from './workpaper-data-policy.mjs';
import {deny} from './http-utils.mjs';
export const changeCount=db=>{const q=db.prepare('SELECT total_changes() n');q.setReadBigInts(true);return q.get().n;};
export function checkedDataHead(db,context){const head=dataHead(db,context.project.teamId,context.project.id);if(!head)deny();if(head.source_project_id!==context.identity.sourceProjectId||head.identity_stamp!==context.identity.stamp)dataConflict();return head;}
export function originalReferences(record){
 const found=new Map();function add(archive,max){if(archive===null||archive===undefined)return;const v=archive.blob;if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='bytes,entry,mime,sha256'||!SHA.test(v.sha256??'')||v.entry!=='originals/'+v.sha256+'.bin'||!Number.isSafeInteger(v.bytes)||v.bytes<1||v.bytes>max||typeof v.mime!=='string'||v.mime.length>150)dataConflict();const expected=archive.hash??archive.sha256;if(expected!==v.sha256||archive.size!==undefined&&archive.size!==v.bytes||archive.mime!==undefined&&archive.mime!==v.mime)dataConflict();const previous=found.get(v.sha256);if(previous&&previous.bytes!==v.bytes)dataConflict();found.set(v.sha256,{bytes:v.bytes});}
 add(record.archive,codec.LIMITS.archiveBytes);add(record.riskArchive,codec.LIMITS.archiveBytes);
 if(record.workpaperSources!==undefined&&(!record.workpaperSources||typeof record.workpaperSources!=='object'||Array.isArray(record.workpaperSources)))dataConflict();
 for(const [hash,value]of Object.entries(record.workpaperSources||{})){if(value?.archive?.hash!==hash)dataConflict();add(value.archive,codec.LIMITS.archiveBytes);}
 if(record.supplementalWorkpapers!==undefined&&!Array.isArray(record.supplementalWorkpapers))dataConflict();for(const value of record.supplementalWorkpapers||[])add(value.file,codec.LIMITS.supplementBytes);return found;
}
export function checkedDataVersion(db,context,version){
 const head=checkedDataHead(db,context);version??=head.revision;
 const row=db.prepare('SELECT * FROM team_workpaper_data_versions WHERE team_id=? AND project_id=? AND version=?').get(context.project.teamId,context.project.id,version);if(!row)deny();
 if(dataDigest(row.record_json)!==row.record_sha256||Buffer.byteLength(row.record_json)>codec.LIMITS.recordBytes)dataConflict();let record;try{record=JSON.parse(row.record_json);}catch{dataConflict();}
 if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).some(k=>!codec.FIELDS.includes(k))||record.id!==context.identity.sourceProjectId||!UUID.test(record.id)||record.id===codec.TRIAL_ID||record.rev!==row.record_revision||!Number.isSafeInteger(record.rev)||record.rev<1)dataConflict();
 if(version===1&&(row.record_sha256!==head.source_record_sha256||record.rev!==head.source_record_revision))dataConflict();return{head,row,record,references:originalReferences(record)};
}
export const versionMetadata=row=>({version:row.version,recordRevision:row.record_revision,recordSha256:row.record_sha256,kind:row.kind,actorName:row.actor_name,committedAt:row.committed_at});
export function dataReceipt(db,context,userId,operationId){const row=db.prepare('SELECT * FROM team_workpaper_data_versions WHERE team_id=? AND project_id=? AND operation_id=? AND actor_id=?').get(context.project.teamId,context.project.id,operationId,userId);if(!row)deny();const head=checkedDataHead(db,context);return{requestId:row.operation_id,...versionMetadata(row),sourceProjectId:head.source_project_id,sourcePackageSha256:head.source_package_sha256};}
export function writeDataRow(db,table,row){if(!['team_workpaper_data_heads','team_workpaper_data_versions','team_workpaper_data_originals','team_workpaper_data_imports','team_workpaper_data_chunks'].includes(table))throw Error('Untrusted workpaper table');const keys=Object.keys(row);if(db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k])).changes!==1)dataConflict();}
export function purgeDataStages(db,at){db.prepare("UPDATE team_workpaper_data_imports SET status='expired' WHERE status='active' AND expires_at<=?").run(at);db.prepare("DELETE FROM team_workpaper_data_chunks WHERE request_id IN(SELECT request_id FROM team_workpaper_data_imports WHERE status IN('expired','canceled'))").run();}
