import {createHash} from 'node:crypto';
import {ordinaryTeamContext} from './project-access-policy.mjs';
import {administratorBusinessEligibilitySql} from './administrator-business-role-policy.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {ApiError,ID,deny,invalid} from './http-utils.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
export const migrationConflict=()=>{throw new ApiError(409,'PROJECT_MIGRATION_CONFLICT','来源、归属或审核状态已改变，请核对登记回执。');};
export function migrationInteger(value,min=0){const n=Number(value);if(!Number.isSafeInteger(n)||n<min)migrationConflict();return n;}
export function migrationEpoch(db,userId){return migrationInteger(db.prepare('SELECT CAST(version AS TEXT) version FROM team_recovery_identity_epochs WHERE user_id=?').get(userId)?.version??0);}
export function migrationReviewer(db,userId){
 const row=db.prepare(`SELECT owner.permission,owner.status,CAST(owner.revision AS TEXT) revision,credential.password_hash,CAST(credential.revision AS TEXT) credential_revision
 FROM team_project_migration_reviewers owner JOIN team_users account ON account.user_id=owner.user_id AND account.status='active'
 JOIN team_credentials credential ON credential.user_id=owner.user_id WHERE owner.user_id=? AND owner.permission='project.migrate' AND owner.status='active'`).get(userId);
 if(!row)return null;const revision=migrationInteger(row.revision,1),credentialRevision=migrationInteger(row.credential_revision,1),epoch=migrationEpoch(db,userId);
 return {credential:{password_hash:row.password_hash,revision:credentialRevision},stamp:digest(JSON.stringify({userId,permission:row.permission,status:row.status,revision,credentialRevision,epoch,passwordHash:digest(row.password_hash)}))};
}
export function migrationReviewerScope(userId){return {sql:`EXISTS (SELECT 1 FROM team_project_migration_reviewers current_reviewer JOIN team_users current_account ON current_account.user_id=current_reviewer.user_id AND current_account.status='active'
 JOIN team_credentials current_credential ON current_credential.user_id=current_reviewer.user_id WHERE current_reviewer.user_id=? AND current_reviewer.permission='project.migrate' AND current_reviewer.status='active')`,parameters:[userId]};}
export function migrationOwner(db,teamId,userId){const value=ordinaryTeamContext(db,userId,teamId);if(!value)deny();return value;}
export function migrationQuery(params){
 for(const key of params.keys())if(!['q','after','limit'].includes(key)||params.getAll(key).length!==1)invalid();
 const q=params.get('q')??'',after=params.get('after')??'',raw=params.get('limit');
 if([...q].length>80||!q.isWellFormed()||/[\p{Cc}\p{Cf}]/u.test(q)||params.has('after')&&!ID.test(after)||raw!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(raw))invalid();
 return {q,after,limit:raw===null?20:Number(raw)};
}
const like=value=>'%'+value.replace(/[\\%_]/g,part=>'\\'+part)+'%';
export function listMigrationTeams(db,actorId,{q,after,limit}){
 const authority=migrationReviewerScope(actorId),from='FROM teams team LEFT JOIN team_profiles profile ON profile.team_id=team.team_id',where=`team.status='active' AND ${authority.sql}${q?" AND COALESCE(profile.name,team.team_id) LIKE ? ESCAPE '\\'":''}`;
 const parameters=[...authority.parameters,...(q?[like(q)]:[])];
 if(after&&!db.prepare(`SELECT 1 ${from} WHERE ${where} AND team.team_id=?`).get(...parameters,after))deny();
 const total=migrationInteger(db.prepare(`SELECT COUNT(*) total ${from} WHERE ${where}`).get(...parameters).total),rows=db.prepare(`SELECT team.team_id,profile.name ${from} WHERE ${where} AND team.team_id>? ORDER BY team.team_id COLLATE BINARY LIMIT ?`).all(...parameters,after,limit+1);
 return {items:rows.slice(0,limit).map(row=>({id:row.team_id,name:safeMemberText(row.name,row.team_id)})),total,hasMore:rows.length>limit};
}
export function listMigrationOwners(db,actorId,teamId,{q,after,limit}){
 const authority=migrationReviewerScope(actorId),from=`FROM team_memberships member JOIN team_users account ON account.user_id=member.user_id JOIN teams team ON team.team_id=member.team_id JOIN team_credentials credential ON credential.user_id=member.user_id LEFT JOIN team_recovery_identity_epochs epoch ON epoch.user_id=member.user_id`;
 const where=`member.team_id=? AND member.status='active' AND account.status='active' AND team.status='active' AND member.role IN ('manager','partner') AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=member.user_id)=1 AND ${administratorBusinessEligibilitySql('member')} AND ${authority.sql}${q?" AND credential.display_name LIKE ? ESCAPE '\\'":''}`;
 const parameters=[teamId,...authority.parameters,...(q?[like(q)]:[])];
 if(!db.prepare(`SELECT 1 FROM teams team WHERE team.team_id=? AND team.status='active' AND ${authority.sql}`).get(teamId,...authority.parameters))deny();
 if(after&&!db.prepare(`SELECT 1 ${from} WHERE ${where} AND member.user_id=?`).get(...parameters,after))deny();
 const total=migrationInteger(db.prepare(`SELECT COUNT(*) total ${from} WHERE ${where}`).get(...parameters).total),rows=db.prepare(`SELECT member.user_id,member.role,credential.display_name,CAST(COALESCE(epoch.version,0) AS TEXT) revision ${from} WHERE ${where} AND member.user_id>? ORDER BY member.user_id COLLATE BINARY LIMIT ?`).all(...parameters,after,limit+1);
 return {items:rows.slice(0,limit).map(row=>({id:row.user_id,displayName:safeMemberText(row.display_name,row.user_id),role:row.role,revision:migrationInteger(row.revision)})),total,hasMore:rows.length>limit};
}
export function migrationReceipt(row){return {requestId:row.request_id,projectId:row.project_id,teamId:row.team_id,ownerUserId:row.owner_user_id,businessNumber:row.business_number,sourceSha256:row.source_sha256,read:row.can_read===1,manage:row.can_manage===1,review:row.can_review===1,registeredAt:migrationInteger(row.registered_at)};}
