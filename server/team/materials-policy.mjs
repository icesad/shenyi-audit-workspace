import {createHash,randomUUID} from 'node:crypto';
import {ordinaryTeamContext,managedProject,projectContext,projectScope,projectRevision,projectIncrement} from './project-access-policy.mjs';
import {administratorBusinessEligibilitySql} from './administrator-business-role-policy.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {ApiError,ID,deny,invalid} from './http-utils.mjs';
import A from '../../dist/audit-checklist.js';
import {maintenanceGrant} from './materials-maintenance-grant.mjs';
export const CHUNK_BYTES=1048576,PACKAGE_BYTES=180*1048576,STAGING_BYTES=360*1048576,STAGE_TTL=30*60000;
export const materialConflict=()=>{throw new ApiError(409,'MATERIALS_CONFLICT','资料、授权或版本已改变，请刷新并核对回执。');};
export const materialDigest=value=>createHash('sha256').update(value).digest('hex');
export function materialInteger(value,min=0){return projectRevision(value,min);}
export function materialGrant(db,teamId,projectId,userId){
 const row=db.prepare('SELECT *,CAST(revision AS TEXT) revision FROM team_material_grants WHERE team_id=? AND project_id=? AND user_id=?').get(teamId,projectId,userId);
 return {revision:row?materialInteger(row.revision,1):0,read:row?.eligible===1&&row.can_read===1,import:row?.eligible===1&&row.can_import===1,review:row?.eligible===1&&row.can_review===1,close:row?.eligible===1&&row.can_close===1};
}
export function materialContext(db,actor,teamId,projectId,{read=false,import:importing=false,review=false,close=false,maintain=false,owner=false,active=false,visible=false}={}){
 const member=ordinaryTeamContext(db,actor.userId,teamId);if(!member)deny();const project=managedProject(db,teamId,projectId);if(!project||!['active','frozen'].includes(project.status))deny();
 const grant=materialGrant(db,teamId,projectId,actor.userId),isOwner=!!db.prepare("SELECT 1 FROM team_project_access_grants WHERE team_id=? AND project_id=? AND user_id=? AND permission='project.owner' AND status='active'").get(teamId,projectId,actor.userId)&&project.createdBy===actor.userId;
 const maintenance=maintenanceGrant(db,teamId,projectId,actor.userId,grant);
 if(owner&&!isOwner||read&&!grant.read||importing&&!grant.import||review&&!grant.review||close&&!grant.close||maintain&&!maintenance.maintain)deny();
 if(visible&&!isOwner&&!grant.read){projectContext(db,actor,teamId,projectId,{read:true});}
 if(active&&project.status!=='active')materialConflict();
 return {member,project,grant,maintenance,owner:isOwner};
}
export function materialSqlScope(actor,{owner=false,read=true}={}){
 const scope=projectScope(actor,{owner,...(owner?{}:{})}),parameters=[...scope.parameters];
 // projectScope's generic visibility is deliberately broader than collection
 // read, but material data always requires its independent explicit read grant.
 let sql=scope.sql;if(read){sql+=` AND EXISTS(SELECT 1 FROM team_material_grants material_scope WHERE material_scope.team_id=project.team_id AND material_scope.project_id=project.project_id AND material_scope.user_id=? AND material_scope.eligible=1 AND material_scope.can_read=1)`;parameters.push(actor.userId);}
 return {sql,parameters};
}
export function materialListQuery(params){
 for(const key of params.keys())if(!['q','after','limit'].includes(key)||params.getAll(key).length!==1)invalid();
 const q=params.get('q')??'',after=params.get('after')??'',raw=params.get('limit');if([...q].length>80||!q.isWellFormed()||/[\p{Cc}\p{Cf}]/u.test(q)||params.has('after')&&!ID.test(after)||raw!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(raw))invalid();return {q,after,limit:raw===null?20:Number(raw)};
}
export function materialMembers(db,actor,teamId,projectId,{q,after,limit}){
 const scope=materialSqlScope(actor,{owner:true,read:false}),from=`FROM team_memberships member JOIN team_users account ON account.user_id=member.user_id JOIN team_credentials credential ON credential.user_id=member.user_id JOIN teams team ON team.team_id=member.team_id
 JOIN team_projects project ON project.team_id=member.team_id AND project.project_id=? JOIN team_project_access_projects metadata ON metadata.team_id=project.team_id AND metadata.project_id=project.project_id
 LEFT JOIN team_recovery_identity_epochs epoch ON epoch.user_id=member.user_id LEFT JOIN team_material_grants material ON material.team_id=member.team_id AND material.project_id=project.project_id AND material.user_id=member.user_id
 LEFT JOIN team_material_maintenance_grants maintenance ON maintenance.team_id=material.team_id AND maintenance.project_id=material.project_id AND maintenance.user_id=material.user_id`;
 const where=`member.team_id=? AND member.status='active' AND account.status='active' AND team.status='active' AND member.role IN ('manager','partner') AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=member.user_id)=1 AND ${administratorBusinessEligibilitySql('member')} AND ${scope.sql}${q?" AND credential.display_name LIKE ? ESCAPE '\\'":''}`,parameters=[projectId,teamId,...scope.parameters,...(q?['%'+q.replace(/[\\%_]/g,v=>'\\'+v)+'%']:[])];
 if(after&&!db.prepare(`SELECT 1 ${from} WHERE ${where} AND member.user_id=?`).get(...parameters,after))deny();
 const rows=db.prepare(`SELECT member.user_id,member.role,credential.display_name,CAST(COALESCE(epoch.version,0) AS TEXT) member_revision,CAST(COALESCE(material.revision,0) AS TEXT) grant_revision,material.eligible,material.can_read,material.can_import,material.can_review,material.can_close,CAST(COALESCE(maintenance.revision,0) AS TEXT) maintenance_revision,maintenance.eligible maintenance_eligible,maintenance.can_maintain,CAST(maintenance.read_grant_revision AS TEXT) read_grant_revision ${from} WHERE ${where} AND member.user_id>? ORDER BY member.user_id COLLATE BINARY LIMIT ?`).all(...parameters,after,limit+1);
 return {members:rows.slice(0,limit).map(row=>({id:row.user_id,displayName:safeMemberText(row.display_name,row.user_id),role:row.role,memberRevision:materialInteger(row.member_revision),grantRevision:materialInteger(row.grant_revision),maintenanceRevision:materialInteger(row.maintenance_revision),read:row.eligible===1&&row.can_read===1,import:row.eligible===1&&row.can_import===1,review:row.eligible===1&&row.can_review===1,close:row.eligible===1&&row.can_close===1,maintain:row.eligible===1&&row.can_read===1&&row.maintenance_eligible===1&&row.can_maintain===1&&row.read_grant_revision!==null&&materialInteger(row.read_grant_revision,1)===materialInteger(row.grant_revision,1)})),hasMore:rows.length>limit};
}
export function materialAudit(db,{requestId=randomUUID(),teamId,projectId,actorId,targetUserId=null,kind,projectRevision,beforeRevision,afterRevision,record=null,sourceBeforeRevision=null,details={},at}){
 db.prepare('INSERT INTO team_material_events(event_id,request_id,team_id,project_id,actor_id,target_user_id,kind,project_revision,before_revision,after_revision,material_revision,record_sha256,package_sha256,source_record_revision,record_revision,source_before_revision,details_json,committed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),requestId,teamId,projectId,actorId,targetUserId,kind,projectRevision,beforeRevision,afterRevision,record?.material_revision??null,record?.record_sha256??null,record?.package_sha256??null,record?.source_record_revision??null,record?JSON.parse(record.record_json).revision:null,sourceBeforeRevision,JSON.stringify(details),at);
}
export function materialReceipt(row){return {requestId:row.request_id,kind:row.kind,projectId:row.project_id,projectRevision:materialInteger(row.project_revision,1),materialRevision:materialInteger(row.material_revision,1),recordSha256:row.record_sha256,packageSha256:row.package_sha256,sourceRecordRevision:materialInteger(row.source_record_revision,1),recordRevision:materialInteger(row.record_revision,1),committedAt:materialInteger(row.committed_at),...(['attachment-add','attachment-remove'].includes(row.kind)?{fileId:row.file_id,nodeId:row.node_id,generationId:row.generation_id}:{})};}
export function materialReceiptRow(db,requestId,actorId,teamId,projectId){return db.prepare("SELECT * FROM team_material_events WHERE request_id=? AND actor_id=? AND team_id=? AND project_id=? AND kind IN ('import','item','close','reopen')").get(requestId,actorId,teamId,projectId)||db.prepare('SELECT * FROM team_material_maintenance_events WHERE request_id=? AND actor_id=? AND team_id=? AND project_id=?').get(requestId,actorId,teamId,projectId);}
export function scopedMaterialRecord(db,actor,teamId,projectId){const scope=materialSqlScope(actor);return db.prepare(`SELECT material.*,CAST(material.material_revision AS TEXT) material_revision,CAST(material.source_record_revision AS TEXT) source_record_revision,credential.display_name importer_name FROM team_material_records material JOIN team_projects project ON project.team_id=material.team_id AND project.project_id=material.project_id JOIN team_project_access_projects metadata ON metadata.team_id=project.team_id AND metadata.project_id=project.project_id JOIN team_credentials credential ON credential.user_id=material.imported_by WHERE material.team_id=? AND material.project_id=? AND ${scope.sql}`).get(teamId,projectId,...scope.parameters)||null;}
export function materialRecordVersion(row){if(!row)materialConflict();materialInteger(row.material_revision,1);materialInteger(row.source_record_revision,1);if(materialDigest(row.record_json)!==row.record_sha256)throw Error('Invalid trusted material record');return A.validate(JSON.parse(row.record_json));}
export function trustedMaterialReviewer(value,fallback){let label='';for(const point of safeMemberText(value,fallback)){if(label.length+point.length>100)break;label+=point;}return label;}
export function revokeMaterialAccess(db,{actorId,teamId,userId,reason,at}){
 const rows=db.prepare('SELECT *,CAST(revision AS TEXT) revision FROM team_material_grants WHERE team_id=? AND user_id=? AND can_read=1').all(teamId,userId);
 for(const row of rows){const revision=materialInteger(row.revision,1),next=projectIncrement(revision);db.prepare('UPDATE team_material_grants SET can_read=0,can_import=0,can_review=0,can_close=0,eligible=0,revision=? WHERE team_id=? AND project_id=? AND user_id=? AND revision=?').run(next,teamId,row.project_id,userId,revision);const project=managedProject(db,teamId,row.project_id);materialAudit(db,{teamId,projectId:row.project_id,actorId,targetUserId:userId,kind:'access.revoked',projectRevision:project.revision,beforeRevision:revision,afterRevision:next,details:{reason},at});}
}
