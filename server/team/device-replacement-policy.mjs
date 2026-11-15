import {createHash} from 'node:crypto';
import {canOperateTeam,restrictedBusinessIdentity} from './administration-policy.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {deviceServerId,safeRevision} from './device-policy.mjs';
import {ApiError} from './http-utils.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
export const replacementConflict=()=>{throw new ApiError(409,'DEVICE_REPLACEMENT_CONFLICT','换机申请或授权状态已改变，请刷新核对。');};
export function replacementTime(at,ttl=0){if(!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(at+ttl))replacementConflict();return at;}
export function replacementRevision(value,min=0){const n=Number(value);if(!Number.isSafeInteger(n)||n<min)replacementConflict();return n;}
export function replacementIncrement(value){const n=replacementRevision(value,1);if(n>=Number.MAX_SAFE_INTEGER)replacementConflict();return n+1;}
export function replacementEpoch(db,userId){return replacementRevision(db.prepare('SELECT CAST(version AS TEXT) AS version FROM team_recovery_identity_epochs WHERE user_id=?').get(userId)?.version??0);}
const credential=(db,userId)=>db.prepare(`SELECT account.status,credential.password_hash,CAST(credential.revision AS TEXT) AS revision,credential.display_name
 FROM team_users account JOIN team_credentials credential ON credential.user_id=account.user_id WHERE account.user_id=?`).get(userId);
export function replacementOwner(db,userId){
 if(restrictedBusinessIdentity(db,userId))return null;
 const row=db.prepare(`SELECT owner.permission,owner.status,CAST(owner.revision AS TEXT) AS revision FROM team_device_replacement_reviewers owner
 JOIN team_users account ON account.user_id=owner.user_id WHERE owner.user_id=? AND account.status='active'
 AND owner.permission='device.replace' AND owner.status='active'`).get(userId);
 return row?{...row,revision:replacementRevision(row.revision,1)}:null;
}
function protectedIdentity(db,userId){return !!db.prepare(`SELECT 1 FROM team_platform_reviewers WHERE user_id=? UNION ALL SELECT 1 FROM team_recovery_reviewers WHERE user_id=?
 UNION ALL SELECT 1 FROM team_access_reviewers WHERE user_id=? UNION ALL SELECT 1 FROM team_device_replacement_reviewers WHERE user_id=? LIMIT 1`).get(userId,userId,userId,userId);}
export function latestReplacementBinding(db,userId){return db.prepare(`SELECT *,CAST(revision AS TEXT) AS revision FROM team_device_bindings WHERE user_id=?
 ORDER BY (status='active') DESC,bound_at DESC,device_id DESC LIMIT 1`).get(userId)||null;}
function snapshotBinding(row){return {device_id:row.device_id,user_id:row.user_id,public_key:row.public_key,key_fingerprint:row.key_fingerprint,
 display_name:row.display_name,platform:row.platform,status:row.status,revision:replacementRevision(row.revision,1),bound_at:row.bound_at,revoked_at:row.revoked_at};}
export function replacementTarget(db,userId){
 const account=credential(db,userId);if(account?.status!=='active'||protectedIdentity(db,userId))return null;
 const memberships=db.prepare('SELECT team_id,role,status FROM team_memberships WHERE user_id=? ORDER BY team_id').all(userId);
 const operators=db.prepare('SELECT team_id,role,status FROM team_operators WHERE user_id=? ORDER BY team_id').all(userId);let kind,teamId;
 if(operators.length){
  if(operators.length!==1||operators[0].role!=='administrator'||operators[0].status!=='active'||!canOperateTeam(db,userId,operators[0].team_id)||memberships.length>1||memberships.some(row=>row.team_id!==operators[0].team_id||row.status!=='active'||['intern','assistant'].includes(row.role)))return null;
  kind='administrator';teamId=operators[0].team_id;
 }else{
  if(memberships.length!==1||memberships[0].status!=='active'||!['intern','assistant','manager','partner'].includes(memberships[0].role))return null;
  kind='employee';teamId=memberships[0].team_id;
 }
 if(!db.prepare("SELECT 1 FROM teams WHERE team_id=? AND status='active'").get(teamId))return null;
 const binding=latestReplacementBinding(db,userId);if(!binding)return null;
 const old=snapshotBinding(binding),epoch=replacementEpoch(db,userId),credentialRevision=replacementRevision(account.revision,1);
 const oldSnapshot=JSON.stringify(old),oldStamp=digest(oldSnapshot),teamName=safeMemberText(db.prepare('SELECT name FROM team_profiles WHERE team_id=?').get(teamId)?.name,teamId);
 const stamp=digest(JSON.stringify({serverId:deviceServerId(db),userId,teamId,kind,memberships,operators,epoch,credentialRevision,credentialHash:digest(account.password_hash),oldStamp}));
 return {userId,teamId,kind,teamName,displayName:safeMemberText(account.display_name,userId),credential:account,epoch,stamp,binding:old,oldSnapshot,oldStamp};
}
export function replacementMatches(target,row){return !!target&&target.teamId===row.team_id&&target.kind===row.target_kind&&target.stamp===row.target_stamp&&target.epoch===replacementRevision(row.identity_epoch)&&target.oldStamp===row.old_binding_stamp&&target.binding.device_id===row.old_device_id&&target.binding.revision===replacementRevision(row.old_binding_revision,1)&&target.binding.status===row.old_binding_status;}
export function replacementAuthority(db,actorId,row,{freshTarget=true}={}){
 if(row.user_id===actorId)return null;
 const target=replacementTarget(db,row.user_id),account=credential(db,actorId);if(!target||target.teamId!==row.team_id||target.kind!==row.target_kind||freshTarget&&!replacementMatches(target,row)||account?.status!=='active')return null;
 let grant;
 if(row.target_kind==='employee'){
  if(!canOperateTeam(db,actorId,row.team_id))return null;
  grant=db.prepare('SELECT team_id,role,status FROM team_operators WHERE team_id=? AND user_id=?').get(row.team_id,actorId);
 }else{grant=replacementOwner(db,actorId);if(!grant)return null;}
 const epoch=replacementEpoch(db,actorId),revision=replacementRevision(account.revision,1);
 return {target,credential:account,stamp:digest(JSON.stringify({actorId,grant,epoch,credentialRevision:revision,credentialHash:digest(account.password_hash)}))};
}
export function canReviewReplacement(db,userId){
 if(credential(db,userId)?.status!=='active')return false;
 if(replacementOwner(db,userId))return true;
 return db.prepare("SELECT team_id FROM team_operators WHERE user_id=? AND role='administrator' AND status='active'").all(userId).some(row=>canOperateTeam(db,userId,row.team_id));
}
export function replacementReviewRows(db,actorId){
 const owner=!!replacementOwner(db,actorId),technical=!restrictedBusinessIdentity(db,actorId);
 // All historic affiliations and protected identities are scoped in SQL before
 // the bounded page. Foreign tenants cannot occupy or expand this result set.
 return db.prepare(`SELECT request.* FROM team_device_replacement_requests request
 JOIN team_users account ON account.user_id=request.user_id AND account.status='active'
 JOIN team_credentials credential ON credential.user_id=account.user_id
 JOIN teams team ON team.team_id=request.team_id AND team.status='active'
 WHERE request.user_id<>? AND EXISTS (SELECT 1 FROM team_device_bindings WHERE user_id=account.user_id)
 AND NOT EXISTS (SELECT 1 FROM team_platform_reviewers WHERE user_id=account.user_id)
 AND NOT EXISTS (SELECT 1 FROM team_recovery_reviewers WHERE user_id=account.user_id)
 AND NOT EXISTS (SELECT 1 FROM team_access_reviewers WHERE user_id=account.user_id)
 AND NOT EXISTS (SELECT 1 FROM team_device_replacement_reviewers WHERE user_id=account.user_id)
 AND ((request.target_kind='employee' AND ?=1
   AND request.team_id IN (SELECT team_id FROM team_operators WHERE user_id=? AND role='administrator' AND status='active')
   AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=account.user_id)=1
   AND EXISTS (SELECT 1 FROM team_memberships WHERE user_id=account.user_id AND team_id=request.team_id AND status='active' AND role IN ('intern','assistant','manager','partner'))
   AND NOT EXISTS (SELECT 1 FROM team_operators WHERE user_id=account.user_id))
 OR (request.target_kind='administrator' AND ?=1
   AND (SELECT COUNT(*) FROM team_operators WHERE user_id=account.user_id)=1
   AND EXISTS (SELECT 1 FROM team_operators WHERE user_id=account.user_id AND team_id=request.team_id AND status='active' AND role='administrator')
   AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=account.user_id)<=1
   AND NOT EXISTS (SELECT 1 FROM team_memberships WHERE user_id=account.user_id AND (team_id<>request.team_id OR status<>'active' OR role IN ('intern','assistant')))))
 ORDER BY request.created_at DESC,request.request_id DESC LIMIT 51`).all(actorId,technical?1:0,actorId,owner?1:0);
}
export function replacementState(db,row,at){
 if(!['pending','approved'].includes(row.status))return row.status;
 if(row.expires_at<=replacementTime(at))return 'expired';
 if(!replacementMatches(replacementTarget(db,row.user_id),row))return 'stale';
 if(row.status==='approved'){const authority=row.approved_by&&replacementAuthority(db,row.approved_by,row);if(!authority||authority.stamp!==row.approval_stamp)return 'stale';}
 return row.status;
}
export function replacementView(db,row,at){
 const old=JSON.parse(row.old_snapshot);
 return {id:row.request_id,teamId:row.team_id,teamName:safeMemberText(row.team_name,row.team_id),displayName:safeMemberText(row.target_display_name,row.user_id),targetKind:row.target_kind,
 status:replacementState(db,row,at),revision:replacementRevision(row.revision,1),createdAt:replacementTime(row.created_at),expiresAt:replacementTime(row.expires_at),
 oldDevice:{id:old.device_id,displayName:safeMemberText(old.display_name,old.device_id),platform:old.platform,keyFingerprint:old.key_fingerprint,status:old.status,revision:safeRevision(old.revision,1)},
 newDevice:{displayName:safeMemberText(row.display_name,row.user_id),platform:row.platform,keyFingerprint:row.key_fingerprint}};
}
export function replacementChallengeFields(row){return {purpose:row.purpose,serverId:row.server_id,userId:row.user_id,sessionBinding:row.session_binding,keyFingerprint:row.key_fingerprint,
 identityEpoch:replacementRevision(row.identity_epoch),oldDeviceId:row.old_device_id,oldBindingRevision:replacementRevision(row.old_binding_revision,1),oldBindingStatus:row.old_binding_status,
 requestId:row.request_id,requestRevision:replacementRevision(row.request_revision),challengeId:row.challenge_id,nonce:row.nonce,issuedAt:replacementTime(row.issued_at),expiresAt:replacementTime(row.expires_at)};}
export const openReplacement=(db,userId)=>db.prepare("SELECT * FROM team_device_replacement_requests WHERE user_id=? AND status IN ('pending','approved') LIMIT 1").get(userId)||null;
