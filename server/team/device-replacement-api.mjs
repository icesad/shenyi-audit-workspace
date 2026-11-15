import {randomBytes,randomUUID,verify} from 'node:crypto';
import {consume,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {leasedSession} from './device-api.mjs';
import {deviceIdentity,sameDeviceIdentity,currentDeviceLease,deviceServerId,digest,UUID,activeBinding} from './device-policy.mjs';
import {replacementConflict,replacementTime,replacementRevision,replacementIncrement,replacementEpoch,replacementTarget,replacementMatches,replacementAuthority,canReviewReplacement,replacementReviewRows,replacementState,replacementView,replacementChallengeFields,openReplacement} from './device-replacement-policy.mjs';
import {ApiError,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
import proof from '../../shared/device-proof.cjs';
import replacementProof from '../../shared/device-replacement-proof.cjs';
const CHALLENGE_TTL=120000,REQUEST_TTL=24*60*60000,APPROVAL_TTL=30*60000;
const method=allow=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow});
const expired=()=>{throw new ApiError(410,'DEVICE_REPLACEMENT_EXPIRED','换机验证已到期，请重新开始。');};
const fields=row=>replacementProof.replacementChallengeBytes(replacementChallengeFields(row));
function key(value){try{return proof.parsePublicKey(value);}catch{invalid();}}
function signature(value){try{return proof.signatureBytes(value);}catch{invalid();}}
function password(value){if(typeof value!=='string'||!value||Buffer.byteLength(value)>512)invalid();return value;}
function deviceName(value){if(typeof value!=='string'||value!==value.toWellFormed()||!value.trim()||[...value].length>80||/[\p{Cc}\p{Cf}]/u.test(value))invalid();return value.trim();}
function event(db,row,actorId,action,at){db.prepare('INSERT INTO team_device_replacement_events(event_id,request_id,actor_id,action,revision,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(),row.request_id,actorId,action,replacementRevision(row.revision,1),at);}
function revokeChallenges(db,userId,at,requestId){db.prepare(`UPDATE team_device_replacement_challenges SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=? AND consumed_at IS NULL${requestId?' AND request_id=?':''}`).run(at,userId,...(requestId?[requestId]:[]));}
function retireOpen(db,userId,at){
 const row=openReplacement(db,userId);if(!row)return;
 const state=replacementState(db,row,at);if(!['expired','stale'].includes(state))replacementConflict();
 const next=replacementIncrement(row.revision),status=state==='expired'?'expired':'revoked';
 if(db.prepare("UPDATE team_device_replacement_requests SET status=?,revision=? WHERE request_id=? AND revision=? AND status IN ('pending','approved')").run(status,next,row.request_id,row.revision).changes!==1)replacementConflict();
 revokeChallenges(db,userId,at,row.request_id);event(db,{...row,revision:next},userId,state==='expired'?'expire':'stale',at);
}
function targetFor(db,identity){const target=replacementTarget(db,identity.userId);if(!target)deny();return target;}
function currentRequest(db,identity,id,revision,purpose,at){
 const row=db.prepare('SELECT * FROM team_device_replacement_requests WHERE request_id=?').get(id);
 if(!row||row.user_id!==identity.userId)deny();
 if(row.revision!==revision||!['pending','approved'].includes(row.status))replacementConflict();
 if(row.expires_at<=at)expired();if(!replacementMatches(replacementTarget(db,identity.userId),row))replacementConflict();
 if(purpose==='activate'){
  if(row.status!=='approved'||replacementState(db,row,at)!=='approved')replacementConflict();
  const expected=Number.MAX_SAFE_INTEGER-(row.old_binding_status==='active'?3:1);if(replacementEpoch(db,identity.userId)>expected)replacementConflict();
  if(row.old_binding_status==='active'&&row.old_binding_revision>=Number.MAX_SAFE_INTEGER)replacementConflict();
 }
 replacementIncrement(row.revision);return row;
}
function saveChallenge(db,identity,target,purpose,publicKey,at,{requestId,revision=0,displayName,platform}={}){
 const id=randomUUID(),row={challenge_id:id,purpose,server_id:deviceServerId(db),user_id:identity.userId,session_binding:identity.sessionBinding,
 public_key:publicKey.encoded,key_fingerprint:publicKey.fingerprint,identity_epoch:target.epoch,old_device_id:target.binding.device_id,
 old_binding_revision:target.binding.revision,old_binding_status:target.binding.status,request_id:requestId??randomUUID(),request_revision:revision,
 nonce:randomBytes(32).toString('base64url'),issued_at:at,expires_at:replacementTime(at,CHALLENGE_TTL)+CHALLENGE_TTL,
 team_id:target.teamId,target_kind:target.kind,team_name:target.teamName,target_display_name:target.displayName,target_stamp:target.stamp,
 old_binding_stamp:target.oldStamp,old_snapshot:target.oldSnapshot,display_name:displayName,platform};
 fields(row);const names=Object.keys(row);db.prepare(`INSERT INTO team_device_replacement_challenges(${names.join(',')}) VALUES (${names.map(()=>'?').join(',')})`).run(...Object.values(row));
 return json({challenge:replacementChallengeFields(row)},201);
}
function liveChallenge(db,request,identity,id,purpose,at){
 sameDeviceIdentity(db,request,identity,at);
 const row=db.prepare('SELECT * FROM team_device_replacement_challenges WHERE challenge_id=?').get(id);
 if(!row||row.user_id!==identity.userId||row.session_binding!==identity.sessionBinding||row.purpose!==purpose)deny();
 if(row.consumed_at!==null||row.revoked_at!==null||row.attempts>=5)replacementConflict();if(row.expires_at<=at)expired();
 if(row.server_id!==deviceServerId(db)||replacementRevision(row.identity_epoch)!==identity.identityEpoch||!replacementMatches(replacementTarget(db,identity.userId),row))replacementConflict();
 const publicKey=key(row.public_key);if(publicKey.fingerprint!==row.key_fingerprint)replacementConflict();
 let application=null;
 if(purpose==='request'){
  if(row.request_revision!==0)replacementConflict();
  const target=targetFor(db,identity);if(target.binding.status==='active'&&target.binding.key_fingerprint===publicKey.fingerprint)replacementConflict();
  const open=openReplacement(db,identity.userId);if(open&&!['expired','stale'].includes(replacementState(db,open,at)))replacementConflict();
 }else{
  application=currentRequest(db,identity,row.request_id,row.request_revision,purpose,at);
  if(application.public_key!==row.public_key||application.key_fingerprint!==row.key_fingerprint||application.target_stamp!==row.target_stamp||application.old_binding_stamp!==row.old_binding_stamp)replacementConflict();
 }
 return {row,key:publicKey,application,bytes:fields(row)};
}
function consumeChallenge(db,row,at){if(db.prepare('UPDATE team_device_replacement_challenges SET consumed_at=? WHERE challenge_id=? AND consumed_at IS NULL AND revoked_at IS NULL AND attempts<5 AND expires_at>?').run(at,row.challenge_id,at).changes!==1)replacementConflict();}
function requestFromChallenge(db,row,at){
 retireOpen(db,row.user_id,at);
 const names=['request_id','user_id','team_id','target_kind','team_name','target_display_name','target_stamp','identity_epoch','old_device_id','old_binding_revision','old_binding_status','old_binding_stamp','old_snapshot','public_key','key_fingerprint','display_name','platform'];
 const values=names.map(name=>row[name]);names.push('status','revision','created_at','expires_at');values.push('pending',1,at,replacementTime(at,REQUEST_TTL)+REQUEST_TTL);
 db.prepare(`INSERT INTO team_device_replacement_requests(${names.join(',')}) VALUES (${names.map(()=>'?').join(',')})`).run(...values);
 const application=db.prepare('SELECT * FROM team_device_replacement_requests WHERE request_id=?').get(row.request_id);event(db,application,row.user_id,'request',at);return application;
}
function finishActivation(db,identity,row,at){
 const next=replacementIncrement(row.revision),newDeviceId=randomUUID();
 if(db.prepare("UPDATE team_device_replacement_requests SET status='claimed',revision=?,claimed_at=? WHERE request_id=? AND revision=? AND status='approved'").run(next,at,row.request_id,row.revision).changes!==1)replacementConflict();
 if(row.old_binding_status==='active'){
  if(db.prepare("UPDATE team_device_bindings SET status='revoked',revision=revision+1,revoked_at=? WHERE device_id=? AND user_id=? AND status='active' AND revision=?").run(at,row.old_device_id,identity.userId,row.old_binding_revision).changes!==1)replacementConflict();
  db.prepare("INSERT INTO team_device_events(event_id,user_id,device_id,action,revision,created_at) VALUES (?,?,?,'revoked',?,?)").run(randomUUID(),identity.userId,row.old_device_id,row.old_binding_revision+1,at);
 }
 db.prepare('UPDATE team_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?').run(at,identity.userId);
 db.prepare('UPDATE team_device_leases SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?').run(at,identity.userId);
 db.prepare('UPDATE team_device_challenges SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=? AND consumed_at IS NULL').run(at,identity.userId);
 revokeChallenges(db,identity.userId,at);
 db.prepare("INSERT INTO team_device_bindings(device_id,user_id,public_key,key_fingerprint,display_name,platform,status,revision,bound_at) VALUES (?,?,?,?,?,?,'active',1,?)").run(newDeviceId,identity.userId,row.public_key,row.key_fingerprint,row.display_name,row.platform,at);
 replacementEpoch(db,identity.userId);
 db.prepare('UPDATE team_device_replacement_requests SET claimed_device_id=? WHERE request_id=?').run(newDeviceId,row.request_id);
 db.prepare("INSERT INTO team_device_events(event_id,user_id,device_id,action,revision,created_at) VALUES (?,?,?,'bound',1,?)").run(randomUUID(),identity.userId,newDeviceId,at);
 event(db,{...row,revision:next},identity.userId,'claim',at);
 return leasedSession(db,identity,activeBinding(db,identity.userId),at);
}
function reviewerIdentity(db,request,identityProviders,context,at){
 if(identityProviders.deviceProofRequired!==true||!context)throw new ApiError(403,'DEVICE_PROOF_REQUIRED','请在已绑定设备上完成审核。');
 const identity=currentDeviceLease(db,request,at);
 if(identity.userId!==context.userId||identity.deviceId!==context.deviceId||identity.bindingRevision!==context.bindingRevision||identity.leaseId!==context.leaseId)throw new ApiError(403,'DEVICE_PROOF_REQUIRED','当前设备状态已改变，请重新核验。');
 return identity;
}
function sameReviewer(db,request,before,providers,context,at){const fresh=reviewerIdentity(db,request,providers,context,at);if(fresh.userId!==before.userId||fresh.token!==before.token||fresh.stamp!==before.stamp||fresh.leaseId!==before.leaseId)replacementConflict();return fresh;}
export async function handleDeviceReplacementRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
 const url=new URL(request.url),own=/^\/api\/auth\/device-replacements(?:\/(request-challenges|request|withdraw-challenges|withdraw|activate-challenges|activate))?$/.exec(url.pathname),
 access=url.pathname==='/api/account/device-replacement-reviews/access',list=url.pathname==='/api/account/device-replacement-reviews',review=/^\/api\/account\/device-replacement-reviews\/([^/]+)\/review$/.exec(url.pathname);
 if(!own&&!access&&!list&&!review)return null;if(url.search)invalid();
 if(!own){
  if(request.method!==(review?'POST':'GET'))return method(review?'POST':'GET');
  const actor=reviewerIdentity(db,request,identityProviders,deviceContext,replacementTime(now()));
  if(access)return json({canReview:canReviewReplacement(db,actor.userId)});if(!canReviewReplacement(db,actor.userId))deny();
  if(list){const rows=replacementReviewRows(db,actor.userId).filter(row=>replacementAuthority(db,actor.userId,row,{freshTarget:false}));return json({requests:rows.slice(0,50).map(row=>replacementView(db,row,now())),hasMore:rows.length>50});}
  if(!UUID.test(review[1]))deny();const previous=db.prepare('SELECT * FROM team_device_replacement_requests WHERE request_id=?').get(review[1]);
  const before=previous&&replacementAuthority(db,actor.userId,previous);if(!before)deny();
  const body=await readJson(request,['revision','decision','currentPassword']);if(!Number.isSafeInteger(body.revision)||body.revision<1||!['approve','reject','revoke'].includes(body.decision))invalid();password(body.currentPassword);
  const expected=body.decision==='revoke'?'approved':'pending';
  const current=()=>{sameReviewer(db,request,actor,identityProviders,deviceContext,replacementTime(now()));const row=db.prepare('SELECT * FROM team_device_replacement_requests WHERE request_id=?').get(previous.request_id),authority=row&&replacementAuthority(db,actor.userId,row);
   if(!row||!authority||authority.stamp!==before.stamp||row.status!==expected||row.revision!==body.revision)replacementConflict();if(row.expires_at<=now())expired();replacementIncrement(row.revision);return {row,authority};};
  current();consume(db,'device-replacement-review:'+digest(actor.userId),replacementTime(now()),15*60000,20);
  return limitedPasswordWork(db,async()=>{
   const valid=await verifyPassword(body.currentPassword,before.credential.password_hash);current();if(!valid)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
   return transaction(db,()=>{const at=replacementTime(now(),APPROVAL_TTL),{row,authority}=current(),status=body.decision==='approve'?'approved':body.decision==='reject'?'rejected':'revoked',next=replacementIncrement(row.revision);
    const expiresAt=body.decision==='approve'?Math.min(row.expires_at,at+APPROVAL_TTL):row.expires_at;
    if(db.prepare('UPDATE team_device_replacement_requests SET status=?,revision=?,expires_at=?,approved_by=?,approval_stamp=? WHERE request_id=? AND status=? AND revision=?')
     .run(status,next,expiresAt,body.decision==='approve'?actor.userId:row.approved_by,body.decision==='approve'?authority.stamp:row.approval_stamp,row.request_id,expected,row.revision).changes!==1)replacementConflict();
    revokeChallenges(db,row.user_id,at,row.request_id);event(db,{...row,revision:next},actor.userId,body.decision,at);return json({request:replacementView(db,db.prepare('SELECT * FROM team_device_replacement_requests WHERE request_id=?').get(row.request_id),at)});
   });
  });
 }
 const action=own[1];if(request.method!==(action?'POST':'GET'))return method(action?'POST':'GET');
 const identity=deviceIdentity(db,request,replacementTime(now()));
 if(!action){const open=openReplacement(db,identity.userId),row=open??db.prepare('SELECT * FROM team_device_replacement_requests WHERE user_id=? ORDER BY created_at DESC,request_id DESC LIMIT 1').get(identity.userId);return json({canRequest:!!replacementTarget(db,identity.userId)&&(!open||['expired','stale'].includes(replacementState(db,open,now()))),request:row?replacementView(db,row,now()):null});}
 if(action.endsWith('-challenges')){
  const purpose=action.slice(0,-11),body=await readJson(request,purpose==='request'?['publicKey','displayName','platform','currentPassword']:['requestId','revision','publicKey']),publicKey=key(body.publicKey);
  sameDeviceIdentity(db,request,identity,replacementTime(now()));
  if(purpose==='request'){
   const name=deviceName(body.displayName);if(!['win32','darwin'].includes(body.platform))invalid();password(body.currentPassword);
   const target=targetFor(db,identity);if(target.binding.status==='active'&&target.binding.key_fingerprint===publicKey.fingerprint)replacementConflict();
   const open=openReplacement(db,identity.userId);if(open&&!['expired','stale'].includes(replacementState(db,open,now())))replacementConflict();
   consume(db,'device-replacement-request:'+digest(identity.userId),replacementTime(now()),15*60000,20);
   return limitedPasswordWork(db,async()=>{const valid=await verifyPassword(body.currentPassword,identity.passwordHash);sameDeviceIdentity(db,request,identity,replacementTime(now()));if(!valid)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
    return transaction(db,()=>{const at=replacementTime(now(),CHALLENGE_TTL);sameDeviceIdentity(db,request,identity,at);const fresh=targetFor(db,identity);if(fresh.stamp!==target.stamp)replacementConflict();retireOpen(db,identity.userId,at);return saveChallenge(db,identity,fresh,'request',publicKey,at,{displayName:name,platform:body.platform});});
   });
  }
  if(typeof body.requestId!=='string'||!UUID.test(body.requestId)||!Number.isSafeInteger(body.revision)||body.revision<1)invalid();
  consume(db,'device-replacement-challenge:'+purpose+':'+digest(identity.userId),replacementTime(now()),15*60000,20);
  return transaction(db,()=>{const at=replacementTime(now(),CHALLENGE_TTL);sameDeviceIdentity(db,request,identity,at);const row=currentRequest(db,identity,body.requestId,body.revision,purpose,at);if(row.public_key!==publicKey.encoded||row.key_fingerprint!==publicKey.fingerprint)deny();
   return saveChallenge(db,identity,targetFor(db,identity),purpose,publicKey,at,{requestId:row.request_id,revision:row.revision,displayName:row.display_name,platform:row.platform});});
 }
 const body=await readJson(request,['challengeId','signature']);if(typeof body.challengeId!=='string'||!UUID.test(body.challengeId))invalid();const bytes=signature(body.signature);
 const checked=liveChallenge(db,request,identity,body.challengeId,action,replacementTime(now())),valid=verify(null,checked.bytes,checked.key.key,bytes);
 return transaction(db,()=>{const at=replacementTime(now(),REQUEST_TTL),fresh=liveChallenge(db,request,identity,body.challengeId,action,at);if(!fresh.bytes.equals(checked.bytes)||fresh.key.encoded!==checked.key.encoded)replacementConflict();
  if(!valid){db.prepare('UPDATE team_device_replacement_challenges SET attempts=attempts+1,revoked_at=CASE WHEN attempts+1>=5 THEN ? ELSE revoked_at END WHERE challenge_id=? AND consumed_at IS NULL AND revoked_at IS NULL AND attempts<5').run(at,body.challengeId);return json({error:{code:'DEVICE_SIGNATURE_INVALID',message:'设备签名验证未通过，请重新验证。'}},403);}
  consumeChallenge(db,fresh.row,at);
  if(action==='request'){const row=requestFromChallenge(db,fresh.row,at);return json({request:replacementView(db,row,at)},201);}
  if(action==='activate')return json(finishActivation(db,identity,fresh.application,at));
  const row=fresh.application,next=replacementIncrement(row.revision);if(db.prepare("UPDATE team_device_replacement_requests SET status='withdrawn',revision=? WHERE request_id=? AND revision=? AND status IN ('pending','approved')").run(next,row.request_id,row.revision).changes!==1)replacementConflict();
  revokeChallenges(db,identity.userId,at,row.request_id);event(db,{...row,revision:next},identity.userId,'withdraw',at);return json({request:replacementView(db,{...row,status:'withdrawn',revision:next},at)});
 });
}
