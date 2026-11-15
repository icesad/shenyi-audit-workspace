import {randomBytes,randomUUID,verify} from 'node:crypto';
import {consume,issueSession,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {ApiError,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
import {UUID,digest,deviceServerId,deviceIdentity,sameDeviceIdentity,activeBinding,bindingView,challengeFields,safeRevision,deviceConflict} from './device-policy.mjs';
import proof from '../../shared/device-proof.cjs';
const CHALLENGE_TTL=120000,LEASE_TTL=15*60000;
const method=allow=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow});
const wrongSignature=()=>json({error:{code:'DEVICE_SIGNATURE_INVALID',message:'设备签名验证未通过，请重新验证。'}},403);
function parsedPublicKey(value){try{return proof.parsePublicKey(value);}catch{invalid();}}
function signatureBytes(value){try{return proof.signatureBytes(value);}catch{invalid();}}
function timestamp(at,ttl=0){if(!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(at+ttl))deviceConflict();return at;}
function existingBinding(db,identity,purpose,key,revision){
  if(purpose==='enroll'){
    if(db.prepare('SELECT 1 FROM team_device_bindings WHERE user_id=? LIMIT 1').get(identity.userId))deviceConflict();
    return null;
  }
  const binding=activeBinding(db,identity.userId);
  if(!binding||binding.public_key!==key.encoded||binding.key_fingerprint!==key.fingerprint)deviceConflict();
  const current=safeRevision(binding.revision,1);
  if(purpose==='revoke'&&(current!==revision||current>=Number.MAX_SAFE_INTEGER))deviceConflict();
  return binding;
}
function liveChallenge(db,request,identity,id,purpose,at){
  sameDeviceIdentity(db,request,identity,at);
  const row=db.prepare('SELECT * FROM team_device_challenges WHERE challenge_id=?').get(id);
  if(!row||row.user_id!==identity.userId||row.session_binding!==identity.sessionBinding||row.purpose!==purpose)deny();
  if(row.consumed_at!==null||row.revoked_at!==null||row.attempts>=5)deviceConflict();
  if(row.expires_at<=at)throw new ApiError(410,'DEVICE_CHALLENGE_EXPIRED','设备验证已到期，请重新开始。');
  if(row.server_id!==deviceServerId(db)||safeRevision(row.identity_epoch)!==identity.identityEpoch)deviceConflict();
  const key=parsedPublicKey(row.public_key);if(key.fingerprint!==row.key_fingerprint)deviceConflict();
  const binding=existingBinding(db,identity,purpose,key,safeRevision(row.binding_revision));
  if(purpose==='enroll'){if(row.device_id!==null||row.binding_revision!==0)deviceConflict();}
  else if(binding.device_id!==row.device_id||safeRevision(binding.revision,1)!==safeRevision(row.binding_revision))deviceConflict();
  // Rebuilding through the shared strict encoder also rejects corrupt stored
  // purposes, expiry, UUIDs, nonce encodings and non-canonical field shapes.
  const bytes=proof.challengeBytes(challengeFields(row));return {row,key,binding,bytes};
}
function deviceEvent(db,userId,binding,action,at){db.prepare('INSERT INTO team_device_events(event_id,user_id,device_id,action,revision,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(),userId,binding.device_id,action,safeRevision(binding.revision,1),at);}
function leasedSession(db,identity,binding,at){
  // Only the initiating session and historical proved business sessions are
  // displaced. Other password-only bootstrap sessions cannot evict this lease.
  db.prepare(`UPDATE team_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?
    AND (token_hash=? OR token_hash IN (SELECT auth_session_hash FROM team_device_leases WHERE user_id=?))`).run(at,identity.userId,identity.sessionBinding,identity.userId);
  db.prepare('UPDATE team_device_leases SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?').run(at,identity.userId);
  const session=issueSession(db,identity.userId,at),leaseId=randomUUID(),leaseToken=randomBytes(32).toString('base64url');
  const expiresAt=Math.min(timestamp(at,LEASE_TTL)+LEASE_TTL,session.expiresAt);
  // A business session shares the lease deadline, so existing downstream fresh
  // authenticated checks also reject expiry during body/KDF/file-dialog waits.
  db.prepare('UPDATE team_sessions SET expires_at=? WHERE token_hash=?').run(expiresAt,digest(session.token));session.expiresAt=expiresAt;
  db.prepare('INSERT INTO team_device_leases(lease_id,user_id,device_id,binding_revision,auth_session_hash,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(leaseId,identity.userId,binding.device_id,safeRevision(binding.revision,1),digest(session.token),digest(leaseToken),at,expiresAt);
  return {...session,device:bindingView(binding),lease:{id:leaseId,token:leaseToken,serverId:deviceServerId(db),deviceId:binding.device_id,bindingRevision:safeRevision(binding.revision,1),expiresAt}};
}
export async function handleDeviceIdentityRequest(request,{db,now=Date.now}={}){
  const url=new URL(request.url),match=/^\/api\/auth\/devices(?:\/(enrollment-challenges|proof-challenges|revocation-challenges|enroll|prove|revoke))?$/.exec(url.pathname);
  if(!match)return null;if(url.search)invalid();const action=match[1];
  if(request.method!==(action?'POST':'GET'))return method(action?'POST':'GET');
  const identity=deviceIdentity(db,request,now());
  if(!action){const row=db.prepare('SELECT *,CAST(revision AS TEXT) AS revision FROM team_device_bindings WHERE user_id=? ORDER BY bound_at DESC,device_id DESC LIMIT 1').get(identity.userId);return json({hasHistory:!!row,canEnroll:!row,device:bindingView(row)});}
  const create=action.endsWith('-challenges');
  if(create){
    const purpose=action==='enrollment-challenges'?'enroll':action==='proof-challenges'?'prove':'revoke';
    const body=await readJson(request,purpose==='enroll'?['publicKey','displayName','platform','currentPassword']:purpose==='prove'?['publicKey']:['publicKey','revision','currentPassword']);
    const key=parsedPublicKey(body.publicKey);let displayName='',platform='win32';
    if(purpose==='enroll'){
      if(typeof body.displayName!=='string'||body.displayName!==body.displayName.toWellFormed()||!body.displayName.trim()||[...body.displayName].length>80||/[\p{Cc}\p{Cf}]/u.test(body.displayName)||!['win32','darwin'].includes(body.platform))invalid();
      displayName=body.displayName.trim();platform=body.platform;
    }
    if(purpose==='revoke'&&(!Number.isSafeInteger(body.revision)||body.revision<1))invalid();
    if(purpose!=='prove'&&(typeof body.currentPassword!=='string'||!body.currentPassword||Buffer.byteLength(body.currentPassword)>512))invalid();
    const fresh=sameDeviceIdentity(db,request,identity,now());existingBinding(db,fresh,purpose,key,body.revision);
    consume(db,'device-challenge:'+purpose+':'+digest(identity.userId),now(),15*60000,20);
    const save=()=>transaction(db,()=>{
      const at=timestamp(now(),CHALLENGE_TTL),current=sameDeviceIdentity(db,request,identity,at),binding=existingBinding(db,current,purpose,key,body.revision);
      const id=randomUUID(),nonce=randomBytes(32).toString('base64url');
      db.prepare(`INSERT INTO team_device_challenges(challenge_id,purpose,server_id,user_id,session_binding,public_key,key_fingerprint,identity_epoch,binding_revision,device_id,approval_request_id,nonce,display_name,platform,issued_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'',?,?,?,?,?)`).run(id,purpose,deviceServerId(db),current.userId,current.sessionBinding,key.encoded,key.fingerprint,current.identityEpoch,binding?safeRevision(binding.revision,1):0,binding?.device_id??null,nonce,binding?.display_name??displayName,binding?.platform??platform,at,at+CHALLENGE_TTL);
      const row=db.prepare('SELECT * FROM team_device_challenges WHERE challenge_id=?').get(id);const challenge=challengeFields(row);proof.challengeBytes(challenge);return json({challenge},201);
    });
    if(purpose==='prove')return save();
    return limitedPasswordWork(db,async()=>{
      const valid=await verifyPassword(body.currentPassword,identity.passwordHash);sameDeviceIdentity(db,request,identity,now());
      if(!valid)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');return save();
    });
  }
  const body=await readJson(request,['challengeId','signature']);if(typeof body.challengeId!=='string'||!UUID.test(body.challengeId))invalid();const signature=signatureBytes(body.signature);
  const checked=liveChallenge(db,request,identity,body.challengeId,action,now());
  const valid=verify(null,checked.bytes,checked.key.key,signature);
  return transaction(db,()=>{
    const at=timestamp(now(),LEASE_TTL),freshIdentity=sameDeviceIdentity(db,request,identity,at),fresh=liveChallenge(db,request,freshIdentity,body.challengeId,action,at);
    if(!fresh.bytes.equals(checked.bytes)||fresh.key.encoded!==checked.key.encoded)deviceConflict();
    if(!valid){db.prepare(`UPDATE team_device_challenges SET attempts=attempts+1,revoked_at=CASE WHEN attempts+1>=5 THEN ? ELSE revoked_at END
      WHERE challenge_id=? AND consumed_at IS NULL AND revoked_at IS NULL AND attempts<5`).run(at,body.challengeId);return wrongSignature();}
    const consumed=db.prepare('UPDATE team_device_challenges SET consumed_at=? WHERE challenge_id=? AND consumed_at IS NULL AND revoked_at IS NULL AND attempts<5 AND expires_at>?').run(at,body.challengeId,at);if(consumed.changes!==1)deviceConflict();
    let binding=fresh.binding;
    if(action==='enroll'){
      const id=randomUUID();db.prepare("INSERT INTO team_device_bindings(device_id,user_id,public_key,key_fingerprint,display_name,platform,status,revision,bound_at) VALUES (?,?,?,?,?,?,'active',1,?)")
        .run(id,identity.userId,fresh.row.public_key,fresh.row.key_fingerprint,fresh.row.display_name,fresh.row.platform,at);
      binding=activeBinding(db,identity.userId);deviceEvent(db,identity.userId,binding,'bound',at);
    }
    if(action==='revoke'){
      const revision=safeRevision(binding.revision,1);if(revision>=Number.MAX_SAFE_INTEGER)deviceConflict();
      const changed=db.prepare("UPDATE team_device_bindings SET status='revoked',revision=revision+1,revoked_at=? WHERE device_id=? AND status='active' AND revision=?").run(at,binding.device_id,revision);if(changed.changes!==1)deviceConflict();
      db.prepare('UPDATE team_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?').run(at,identity.userId);
      db.prepare('UPDATE team_device_leases SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?').run(at,identity.userId);
      db.prepare('UPDATE team_device_challenges SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=? AND consumed_at IS NULL').run(at,identity.userId);
      deviceEvent(db,identity.userId,{...binding,revision:revision+1},'revoked',at);return json({revoked:true});
    }
    if(action==='prove')deviceEvent(db,identity.userId,binding,'proved',at);
    return json(leasedSession(db,identity,binding,at),action==='enroll'?201:200);
  });
}
