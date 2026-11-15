// Deliberately low-level: auth/repository/administration import these predicates.
// Do not import auth, device, administration, member or project policy here.
import {createHash} from 'node:crypto';
import {ApiError,ID,deny} from './http-utils.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
export const administratorBusinessRoles=Object.freeze(['intern','assistant','manager','partner']);
export const administratorBusinessConflict=()=>{throw new ApiError(409,'ADMINISTRATOR_BUSINESS_ROLE_CONFLICT','管理员职级或审核状态已改变，请刷新核对。');};
export function administratorBusinessRevision(value,min=0){const n=Number(value);if(!Number.isSafeInteger(n)||n<min)administratorBusinessConflict();return n;}
export function administratorBusinessIncrement(value,min=1){const n=administratorBusinessRevision(value,min);if(n>=Number.MAX_SAFE_INTEGER)administratorBusinessConflict();return n+1;}
export function administratorBusinessTime(at){return administratorBusinessRevision(at);}
export function administratorBusinessEpoch(db,userId){return administratorBusinessRevision(db.prepare('SELECT CAST(version AS TEXT) AS version FROM team_recovery_identity_epochs WHERE user_id=?').get(userId)?.version??0);}
const safeText=(value,fallback)=>[...String(value??'').toWellFormed().replace(/[\p{Cc}\p{Cf}]/gu,'').trim()].slice(0,80).join('')||[...fallback].slice(0,80).join('');
const owners=['team_platform_reviewers','team_recovery_reviewers','team_access_reviewers','team_device_replacement_reviewers','team_administrator_business_role_reviewers'];
const noOwners=user=>owners.map(table=>`NOT EXISTS (SELECT 1 FROM ${table} WHERE user_id=${user})`).join(' AND ');
function approvalSql(user,team,technical){
 const matches=technical?`((ab_approval.role IS NULL AND ab_member.status='disabled') OR (ab_approval.role=ab_member.role AND ab_member.status='active'))`:`ab_approval.role=ab_member.role AND ab_member.status='active'`;
 return `EXISTS (SELECT 1 FROM team_administrator_business_roles ab_approval
 JOIN team_memberships ab_member ON ab_member.team_id=ab_approval.team_id AND ab_member.user_id=ab_approval.user_id
 JOIN team_operators ab_operator ON ab_operator.team_id=ab_approval.team_id AND ab_operator.user_id=ab_approval.user_id AND ab_operator.role='administrator' AND ab_operator.status='active'
 JOIN team_users ab_account ON ab_account.user_id=ab_approval.user_id AND ab_account.status='active'
 JOIN teams ab_team ON ab_team.team_id=ab_approval.team_id AND ab_team.status='active'
 JOIN team_credentials ab_credential ON ab_credential.user_id=ab_approval.user_id
 WHERE ab_approval.user_id=${user} AND ab_approval.team_id=${team} AND ab_approval.status='active'
 AND ab_approval.member_role=ab_member.role AND ${matches}
 AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=ab_approval.user_id)=1
 AND (SELECT COUNT(*) FROM team_operators WHERE user_id=ab_approval.user_id)=1
 AND ${noOwners('ab_approval.user_id')})`;
}
export function approvedAdministratorBusiness(db,userId,teamId,{technical=false}={}){
 return !!db.prepare('SELECT 1 WHERE '+approvalSql('?','?',technical)).get(userId,teamId);
}
export function administratorBusinessEligibilitySql(memberAlias){
 if(!['member','membership'].includes(memberAlias))throw Error('Untrusted business membership SQL alias');
 return `(${noOwners(memberAlias+'.user_id')} AND (NOT EXISTS (SELECT 1 FROM team_operators WHERE user_id=${memberAlias}.user_id) OR ${approvalSql(memberAlias+'.user_id',memberAlias+'.team_id',false)}))`;
}
export function administratorTechnicalEligibilitySql(operatorAlias='operator'){
 if(!['operator','candidate_operator'].includes(operatorAlias))throw Error('Untrusted technical administrator SQL alias');
 return `(${operatorAlias}.role='administrator' AND ${operatorAlias}.status='active'
 AND EXISTS (SELECT 1 FROM team_users WHERE user_id=${operatorAlias}.user_id AND status='active')
 AND EXISTS (SELECT 1 FROM teams WHERE team_id=${operatorAlias}.team_id AND status='active')
 AND (NOT EXISTS (SELECT 1 FROM team_memberships WHERE user_id=${operatorAlias}.user_id)
 OR ${approvalSql(operatorAlias+'.user_id',operatorAlias+'.team_id',true)}))`;
}
export function administratorTechnicalEligible(db,userId,teamId){
 return !!db.prepare(`SELECT 1 FROM team_operators operator WHERE operator.user_id=? AND operator.team_id=? AND ${administratorTechnicalEligibilitySql()}`).get(userId,teamId);
}

export function administratorBusinessReviewer(db,userId){
 const row=db.prepare(`SELECT owner.permission,owner.status,CAST(owner.revision AS TEXT) AS revision,
 credential.password_hash,CAST(credential.revision AS TEXT) AS credential_revision
 FROM team_administrator_business_role_reviewers owner JOIN team_users account ON account.user_id=owner.user_id AND account.status='active'
 JOIN team_credentials credential ON credential.user_id=owner.user_id
 WHERE owner.user_id=? AND owner.permission='administrator.business-role' AND owner.status='active'`).get(userId);
 if(!row)return null;
 const revision=administratorBusinessRevision(row.revision,1),credentialRevision=administratorBusinessRevision(row.credential_revision,1),epoch=administratorBusinessEpoch(db,userId);
 return {credential:{password_hash:row.password_hash,revision:credentialRevision},stamp:digest(JSON.stringify({userId,permission:row.permission,status:row.status,revision,epoch,credentialRevision,passwordHash:digest(row.password_hash)}))};
}
const FROM=`FROM team_operators operator JOIN team_users account ON account.user_id=operator.user_id
 JOIN teams team ON team.team_id=operator.team_id JOIN team_credentials credential ON credential.user_id=operator.user_id
 LEFT JOIN team_profiles profile ON profile.team_id=operator.team_id
 LEFT JOIN team_memberships member ON member.user_id=operator.user_id AND member.team_id=operator.team_id
 LEFT JOIN team_administrator_business_roles approval ON approval.user_id=operator.user_id
 LEFT JOIN team_recovery_identity_epochs epoch ON epoch.user_id=operator.user_id`;
const SCOPE=`operator.user_id<>? AND operator.role='administrator' AND operator.status='active' AND account.status='active' AND team.status='active'
 AND (SELECT COUNT(*) FROM team_operators WHERE user_id=operator.user_id)=1
 AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=operator.user_id)<=1
 AND NOT EXISTS (SELECT 1 FROM team_memberships WHERE user_id=operator.user_id AND team_id<>operator.team_id)
 AND (approval.user_id IS NULL OR approval.team_id=operator.team_id)
 AND ${noOwners('operator.user_id')}`;
const FIELDS=`operator.user_id,operator.team_id,operator.role AS operator_role,operator.status AS operator_status,
 credential.display_name,profile.name AS team_name,member.role AS member_role,member.status AS member_status,
 approval.role AS approval_role,approval.status AS approval_status,CAST(approval.revision AS TEXT) AS approval_revision,
 approval.member_role AS approval_member_role,approval.reviewed_by,approval.reviewed_at,
 CAST(COALESCE(epoch.version,0) AS TEXT) AS identity_revision`;
function rowView(row){
 const exact=row.approval_status==='active'&&row.approval_member_role===row.member_role&&(row.approval_role===null?row.member_status==='disabled':row.member_status==='active'&&row.approval_role===row.member_role);
 return {id:row.user_id,displayName:safeText(row.display_name,row.user_id),teamId:row.team_id,teamName:safeText(row.team_name,row.team_id),
 role:row.member_status==='active'?row.member_role:null,status:'active',revision:administratorBusinessRevision(row.identity_revision),
 approvalStatus:row.approval_revision===null?'unreviewed':exact?(row.approval_role===null?'withdrawn':'approved'):'invalidated'};
}
export function administratorBusinessTarget(db,actorId,userId){
 const row=db.prepare(`SELECT ${FIELDS},credential.password_hash,CAST(credential.revision AS TEXT) AS credential_revision ${FROM} WHERE ${SCOPE} AND operator.user_id=?`).get(actorId,userId);
 if(!row)return null;
 const value=rowView(row),approvalRevision=row.approval_revision===null?null:administratorBusinessRevision(row.approval_revision,1),credentialRevision=administratorBusinessRevision(row.credential_revision,1);
 return {...value,member:row.member_role===null?null:{role:row.member_role,status:row.member_status},approval:approvalRevision===null?null:{role:row.approval_role,status:row.approval_status,revision:approvalRevision,memberRole:row.approval_member_role,reviewedBy:row.reviewed_by,reviewedAt:row.reviewed_at},
 stamp:digest(JSON.stringify({row,credentialRevision,passwordHash:digest(row.password_hash)}))};
}
export function administratorBusinessQuery(params){
 for(const key of params.keys())if(!['q','after','limit'].includes(key)||params.getAll(key).length!==1)throw new ApiError(400,'INVALID_REQUEST','请求参数无效。');
 const q=params.get('q')??'',after=params.get('after')??'',raw=params.get('limit');
 if([...q].length>80||!q.isWellFormed()||/[\p{Cc}\p{Cf}]/u.test(q)||(params.has('after')&&!ID.test(after))||(raw!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(raw)))throw new ApiError(400,'INVALID_REQUEST','请求参数无效。');
 return {q,after,limit:raw===null?20:Number(raw)};
}
export function listAdministratorBusinessTargets(db,actorId,{q,after,limit}){
 const currentReviewer=`EXISTS (SELECT 1 FROM team_administrator_business_role_reviewers scoped_reviewer JOIN team_users scoped_account ON scoped_account.user_id=scoped_reviewer.user_id AND scoped_account.status='active' JOIN team_credentials scoped_credential ON scoped_credential.user_id=scoped_reviewer.user_id WHERE scoped_reviewer.user_id=? AND scoped_reviewer.permission='administrator.business-role' AND scoped_reviewer.status='active')`;
 const search=q?" AND credential.display_name LIKE ? ESCAPE '\\'":'',parameters=[actorId,actorId,...(q?['%'+q.replace(/[\\%_]/g,part=>'\\'+part)+'%']:[])],where=`${SCOPE} AND ${currentReviewer}`;
 if(after&&!db.prepare(`SELECT 1 ${FROM} WHERE ${where}${search} AND operator.user_id=?`).get(...parameters,after))deny();
 const rows=db.prepare(`SELECT ${FIELDS} ${FROM} WHERE ${where}${search} AND operator.user_id>? ORDER BY operator.user_id COLLATE BINARY LIMIT ?`).all(...parameters,after,limit+1);
 return {members:rows.slice(0,limit).map(rowView),hasMore:rows.length>limit};
}
