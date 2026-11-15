import {createHash,randomUUID} from 'node:crypto';
import {canOperateTeam,restrictedBusinessIdentity} from './administration-policy.mjs';
import {ApiError} from './http-utils.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const invalidProof=()=>{throw new ApiError(400,'INVALID_CHALLENGE','验证请求无效或已失效，请重新验证。');};
export const reviewedRecovery=providers=>providers.reviewedRecovery===true;
export const recoveryConfigured=providers=>reviewedRecovery(providers)||typeof providers.recovery?.authorize==='function';
export const reviewedRecoveryAvailable=providers=>reviewedRecovery(providers)&&typeof providers.sms?.send==='function'&&Buffer.isBuffer(providers.phonePepper)&&providers.phonePepper.length>=32;
const epoch=(db,userId)=>db.prepare('SELECT version FROM team_recovery_identity_epochs WHERE user_id=?').get(userId)?.version??0;
export function recoveryCredential(db,userId){return db.prepare(`SELECT account.status,credential.password_hash,credential.revision,credential.display_name
  FROM team_users AS account JOIN team_credentials AS credential ON credential.user_id=account.user_id WHERE account.user_id=?`).get(userId);}
export function recoveryOwner(db,userId){
  if(restrictedBusinessIdentity(db,userId))return null;
  return db.prepare(`SELECT permission,status,revision FROM team_recovery_reviewers WHERE user_id=? AND permission='account.recover' AND status='active'`).get(userId)||null;
}
export function recoveryTarget(db,userId,at){
  const credential=recoveryCredential(db,userId);if(!credential||credential.status!=='active')return null;
  // A privileged reviewer's own recovery requires a separate human bootstrap.
  if(db.prepare('SELECT 1 FROM team_platform_reviewers WHERE user_id=? UNION ALL SELECT 1 FROM team_recovery_reviewers WHERE user_id=? LIMIT 1').get(userId,userId))return null;
  const phone=db.prepare('SELECT phone,revision,verified_at FROM team_phone_credentials WHERE user_id=?').get(userId);
  if(!phone||!Number.isSafeInteger(phone.revision)||phone.revision<1||!Number.isSafeInteger(phone.verified_at)||phone.verified_at<=0||phone.verified_at>at)return null;
  const memberships=db.prepare('SELECT team_id,role,status FROM team_memberships WHERE user_id=? ORDER BY team_id').all(userId);
  const operators=db.prepare('SELECT team_id,role,status FROM team_operators WHERE user_id=? ORDER BY team_id').all(userId);
  let teamId,kind;
  if(operators.length){
    if(operators.length!==1||!canOperateTeam(db,userId,operators[0].team_id)||memberships.some(row=>row.team_id!==operators[0].team_id))return null;
    teamId=operators[0].team_id;kind='administrator';
  }else{
    if(memberships.length!==1||memberships[0].status!=='active')return null;
    teamId=memberships[0].team_id;kind='employee';
  }
  if(!db.prepare("SELECT 1 FROM teams WHERE team_id=? AND status='active'").get(teamId))return null;
  const teamName=db.prepare('SELECT name FROM team_profiles WHERE team_id=?').get(teamId)?.name||teamId;
  const stamp=digest(JSON.stringify({userId,teamId,kind,phone,memberships,operators,credentialRevision:credential.revision,credentialHash:digest(credential.password_hash),epoch:epoch(db,userId)}));
  return {userId,teamId,kind,phone:phone.phone,teamName:[...teamName.toWellFormed()].slice(0,80).join(''),displayName:[...credential.display_name.toWellFormed()].slice(0,80).join(''),stamp};
}
export function recoveryAuthority(db,userId,row,at,{freshTarget=true}={}){
  if(!row.target_user_id||row.target_user_id===userId)return null;
  const target=recoveryTarget(db,row.target_user_id,at),credential=recoveryCredential(db,userId);
  if(!target||target.teamId!==row.team_id||target.kind!==row.target_kind||(freshTarget&&target.stamp!==row.target_stamp)||credential?.status!=='active')return null;
  let grant;
  if(row.target_kind==='employee'){
    if(!canOperateTeam(db,userId,row.team_id))return null;
    grant=db.prepare('SELECT team_id,role,status FROM team_operators WHERE team_id=? AND user_id=?').get(row.team_id,userId);
  }else{grant=recoveryOwner(db,userId);if(!grant)return null;}
  return {target,credential,stamp:digest(JSON.stringify({actor:userId,epoch:epoch(db,userId),grant,credentialRevision:credential.revision,credentialHash:digest(credential.password_hash)}))};
}
export function canReviewRecovery(db,userId){
  if(recoveryCredential(db,userId)?.status!=='active')return false;
  if(recoveryOwner(db,userId))return true;
  return db.prepare("SELECT team_id FROM team_operators WHERE user_id=? AND status='active'").all(userId).some(row=>canOperateTeam(db,userId,row.team_id));
}
export function recoveryReviewView(db,row,at){
  const target=recoveryTarget(db,row.target_user_id,at);if(!target)return null;
  return {id:row.request_id,teamId:row.team_id,teamName:target.teamName,displayName:target.displayName,phoneMasked:target.phone.slice(0,5)+'****'+target.phone.slice(-4),targetKind:row.target_kind,
    status:['pending','approved'].includes(row.status)&&row.expires_at<=at?'expired':row.status,revision:row.revision,createdAt:row.created_at,expiresAt:row.expires_at};
}
export function validateReviewedRecovery(db,userId,challengeId,proof,at){
  if(typeof proof!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(proof)||Buffer.from(proof,'base64url').toString('base64url')!==proof)invalidProof();
  const row=db.prepare('SELECT * FROM team_recovery_requests WHERE token_hash=? AND target_user_id=? AND challenge_id=?').get(digest(proof),userId,challengeId);
  if(!row||row.status!=='approved'||row.expires_at<=at)invalidProof();
  const authority=recoveryAuthority(db,row.approved_by,row,at);if(!authority||authority.stamp!==row.approval_stamp)invalidProof();
  return row;
}
export function consumeReviewedRecovery(db,userId,challengeId,proof,at){
  const row=validateReviewedRecovery(db,userId,challengeId,proof,at);
  const change=db.prepare("UPDATE team_recovery_requests SET status='consumed',revision=revision+1,consumed_at=? WHERE request_id=? AND revision=? AND status='approved'").run(at,row.request_id,row.revision);
  if(change.changes!==1)invalidProof();
  db.prepare('INSERT INTO team_recovery_events VALUES (?,?,?,?,?,?)').run(randomUUID(),row.request_id,userId,'consume',row.revision+1,at);
}
