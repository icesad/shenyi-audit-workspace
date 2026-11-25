import {createHash,randomUUID} from 'node:crypto';
import {authenticated} from './auth-api.mjs';
import {ApiError} from './http-utils.mjs';
import proof from '../../shared/device-proof.cjs';
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const DEVICE_SERVER_METADATA='device-server-id';
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const deviceConflict=()=>{throw new ApiError(409,'DEVICE_STATE_CHANGED','设备或账号状态已改变，请重新核对。');};
export const deviceRequired=()=>{throw new ApiError(403,'DEVICE_PROOF_REQUIRED','请在已绑定设备上完成持钥登录后重试。');};
export function ensureDeviceServerId(db){
  const row=db.prepare('SELECT value FROM team_database_metadata WHERE name=?').get(DEVICE_SERVER_METADATA);
  if(row){if(!UUID.test(row.value))throw Error('Invalid device server identity');return row.value;}
  for(const table of ['team_device_bindings','team_device_challenges','team_device_leases','team_device_request_replays','team_device_events','team_device_usage','team_device_replacement_reviewers','team_device_replacement_requests','team_device_replacement_challenges','team_device_replacement_events','team_administrator_business_role_reviewers','team_administrator_business_roles','team_administrator_business_role_events','team_project_migration_reviewers','team_project_migration_provenance','team_project_migration_events','team_material_grants','team_material_records','team_material_files','team_material_events','team_material_imports','team_material_import_chunks','team_material_maintenance_grants','team_material_maintenance_events','team_collection_workspace_creations','team_workspace_formalizations','team_workspace_source_grants','team_workspace_source_events'])if(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())throw Error('Device history has no server identity');
  for(const table of ['team_ledger_check_grants','team_ledger_check_events','team_ledger_check_heads','team_ledger_check_snapshots'])if(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())throw Error('Device history has no server identity');
  for(const table of ['team_workpaper_access_grants','team_workpaper_access_events'])if(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())throw Error('Device history has no server identity');
  for(const table of ['team_workpaper_data_heads','team_workpaper_data_versions','team_workpaper_data_originals','team_workpaper_data_imports','team_workpaper_data_chunks'])if(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())throw Error('Device history has no server identity');
  for(const table of ['team_billing_refund_intake_reviewers','team_billing_refund_intake_events'])if(db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())throw Error('Device history has no server identity');
  const value=randomUUID();db.prepare('INSERT INTO team_database_metadata(name,value) VALUES (?,?) ON CONFLICT(name) DO NOTHING').run(DEVICE_SERVER_METADATA,value);
  return deviceServerId(db);
}
export function deviceServerId(db){const value=db.prepare('SELECT value FROM team_database_metadata WHERE name=?').get(DEVICE_SERVER_METADATA)?.value;if(!UUID.test(value??''))throw Error('Invalid device server identity');return value;}
export function safeRevision(value,minimum=0){const number=Number(value);if(!Number.isSafeInteger(number)||number<minimum)deviceConflict();return number;}
export function deviceIdentity(db,request,at){
  const actor=authenticated(db,request,at),row=db.prepare(`SELECT credential.password_hash,CAST(credential.revision AS TEXT) AS credential_revision,
    CAST(COALESCE(epoch.version,0) AS TEXT) AS identity_epoch FROM team_credentials AS credential
    LEFT JOIN team_recovery_identity_epochs AS epoch ON epoch.user_id=credential.user_id WHERE credential.user_id=?`).get(actor.userId);
  if(!row)deviceRequired();
  const identityEpoch=safeRevision(row.identity_epoch),credentialRevision=safeRevision(row.credential_revision,1),sessionBinding=proof.sessionBinding(actor.token);
  return {...actor,identityEpoch,credentialRevision,passwordHash:row.password_hash,sessionBinding,
    stamp:digest(JSON.stringify([actor.userId,sessionBinding,identityEpoch,credentialRevision,digest(row.password_hash)]))};
}
export function sameDeviceIdentity(db,request,before,at){const fresh=deviceIdentity(db,request,at);if(fresh.userId!==before.userId||fresh.token!==before.token||fresh.stamp!==before.stamp)deviceConflict();return fresh;}
export function activeBinding(db,userId){return db.prepare("SELECT *,CAST(revision AS TEXT) AS revision FROM team_device_bindings WHERE user_id=? AND status='active'").get(userId)||null;}
export function bindingView(row){if(!row)return null;return {id:row.device_id,displayName:row.display_name,platform:row.platform,keyFingerprint:row.key_fingerprint,status:row.status,revision:safeRevision(row.revision,1),boundAt:row.bound_at,revokedAt:row.revoked_at};}
export function challengeFields(row){return {purpose:row.purpose,serverId:row.server_id,userId:row.user_id,sessionBinding:row.session_binding,keyFingerprint:row.key_fingerprint,
  identityEpoch:safeRevision(row.identity_epoch),bindingRevision:safeRevision(row.binding_revision),approvalRequestId:row.approval_request_id,challengeId:row.challenge_id,nonce:row.nonce,issuedAt:row.issued_at,expiresAt:row.expires_at};}
export function currentDeviceLease(db,request,at){
  const identity=deviceIdentity(db,request,at),token=request.headers.get('X-Shenyi-Device-Lease');
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||Buffer.from(token,'base64url').toString('base64url')!==token)deviceRequired();
  const row=db.prepare(`SELECT lease.lease_id,lease.device_id,CAST(lease.binding_revision AS TEXT) AS binding_revision,
    lease.auth_session_hash,lease.expires_at,binding.public_key,binding.key_fingerprint
    FROM team_device_leases AS lease JOIN team_device_bindings AS binding ON binding.device_id=lease.device_id AND binding.user_id=lease.user_id
    WHERE lease.user_id=? AND lease.auth_session_hash=? AND lease.token_hash=? AND lease.revoked_at IS NULL AND lease.expires_at>?
      AND binding.status='active' AND binding.revision=lease.binding_revision`).get(identity.userId,identity.sessionBinding,digest(token),at);
  if(!row)deviceRequired();
  return {...identity,leaseId:row.lease_id,deviceId:row.device_id,bindingRevision:safeRevision(row.binding_revision,1),publicKey:row.public_key,keyFingerprint:row.key_fingerprint,leaseExpiresAt:row.expires_at};
}
