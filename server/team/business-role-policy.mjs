import {createHash} from 'node:crypto';
import {canOperateTeam,restrictedBusinessIdentity} from './administration-policy.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {ApiError,deny} from './http-utils.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
export const businessRoles=Object.freeze(['intern','assistant','manager','partner']);
export const businessRoleConflict=()=>{throw new ApiError(409,'BUSINESS_ROLE_CONFLICT','成员职级或授权状态已改变，请刷新核对。');};
export function businessRoleRevision(value,min=0){const n=Number(value);if(!Number.isSafeInteger(n)||n<min)businessRoleConflict();return n;}
export function businessRoleIncrement(value,min=0){const n=businessRoleRevision(value,min);if(n>=Number.MAX_SAFE_INTEGER)businessRoleConflict();return n+1;}
export function businessRoleEpoch(db,userId){return businessRoleRevision(db.prepare('SELECT CAST(version AS TEXT) AS version FROM team_recovery_identity_epochs WHERE user_id=?').get(userId)?.version??0);}
export function businessRoleTime(value){if(!Number.isSafeInteger(value)||value<0)businessRoleConflict();return value;}
export function businessRoleAuthority(db,userId,teamId){
 if(!canOperateTeam(db,userId,teamId))return null;
 const credential=db.prepare(`SELECT credential.password_hash,CAST(credential.revision AS TEXT) AS revision FROM team_credentials credential
 JOIN team_users account ON account.user_id=credential.user_id WHERE credential.user_id=? AND account.status='active'`).get(userId);if(!credential)return null;
 const grant=db.prepare('SELECT team_id,role,status FROM team_operators WHERE user_id=? AND team_id=?').get(userId,teamId),epoch=businessRoleEpoch(db,userId),revision=businessRoleRevision(credential.revision,1);
 return {credential,stamp:digest(JSON.stringify({userId,teamId,grant,epoch,credentialRevision:revision,credentialHash:digest(credential.password_hash)}))};
}
export function businessRoleAccess(db,userId){
 if(restrictedBusinessIdentity(db,userId))return {teams:[]};
 const rows=db.prepare(`SELECT operator.team_id,profile.name FROM team_operators operator
 JOIN teams team ON team.team_id=operator.team_id AND team.status='active'
 JOIN team_users account ON account.user_id=operator.user_id AND account.status='active'
 JOIN team_credentials credential ON credential.user_id=account.user_id
 LEFT JOIN team_profiles profile ON profile.team_id=team.team_id
 WHERE operator.user_id=? AND operator.role='administrator' AND operator.status='active'
 ORDER BY operator.team_id COLLATE BINARY LIMIT 50`).all(userId);
 return {teams:rows.filter(row=>businessRoleAuthority(db,userId,row.team_id)).map(row=>({teamId:row.team_id,teamName:safeMemberText(row.name,row.team_id)}))};
}
const FROM=`FROM team_memberships member JOIN team_users account ON account.user_id=member.user_id
 JOIN team_credentials credential ON credential.user_id=account.user_id
 JOIN teams team ON team.team_id=member.team_id
 LEFT JOIN team_recovery_identity_epochs epoch ON epoch.user_id=account.user_id`;
const SCOPE=`account.user_id<>? AND member.team_id=? AND account.status='active' AND member.status='active' AND team.status='active'
 AND member.role IN ('intern','assistant','manager','partner')
 AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=account.user_id)=1
 AND NOT EXISTS (SELECT 1 FROM team_operators WHERE user_id=account.user_id)
 AND NOT EXISTS (SELECT 1 FROM team_platform_reviewers WHERE user_id=account.user_id)
 AND NOT EXISTS (SELECT 1 FROM team_recovery_reviewers WHERE user_id=account.user_id)
 AND NOT EXISTS (SELECT 1 FROM team_access_reviewers WHERE user_id=account.user_id)
 AND NOT EXISTS (SELECT 1 FROM team_device_replacement_reviewers WHERE user_id=account.user_id)`;
const FIELDS=`account.user_id,credential.display_name,account.status,member.role,
 CAST(COALESCE(epoch.version,0) AS TEXT) AS identity_revision`;
const view=row=>({id:row.user_id,displayName:safeMemberText(row.display_name,row.user_id),role:row.role,status:row.status,revision:businessRoleRevision(row.identity_revision)});
export function businessRoleTarget(db,actorId,teamId,userId){
 const row=db.prepare(`SELECT ${FIELDS},credential.password_hash,CAST(credential.revision AS TEXT) AS credential_revision ${FROM} WHERE ${SCOPE} AND account.user_id=?`).get(actorId,teamId,userId);if(!row)return null;
 const target=view(row),credentialRevision=businessRoleRevision(row.credential_revision,1);
 return {...target,stamp:digest(JSON.stringify({id:target.id,teamId,role:target.role,status:target.status,epoch:target.revision,credentialRevision,credentialHash:digest(row.password_hash)}))};
}
export function listBusinessRoleTargets(db,actorId,teamId,{q,after,limit}){
 const search=q?" AND credential.display_name LIKE ? ESCAPE '\\'":'',parameters=[actorId,teamId,...(q?['%'+q.replace(/[\\%_]/g,value=>'\\'+value)+'%']:[])];
 if(after&&!db.prepare(`SELECT 1 ${FROM} WHERE ${SCOPE}${search} AND account.user_id=?`).get(...parameters,after))deny();
 const rows=db.prepare(`SELECT ${FIELDS} ${FROM} WHERE ${SCOPE}${search} AND account.user_id>?
 ORDER BY account.user_id COLLATE BINARY LIMIT ?`).all(...parameters,after,limit+1);
 return {members:rows.slice(0,limit).map(view),hasMore:rows.length>limit};
}
