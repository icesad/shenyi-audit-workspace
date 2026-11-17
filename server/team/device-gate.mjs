import {verify} from 'node:crypto';
import {consume} from './auth-api.mjs';
import {ApiError,invalid,transaction} from './http-utils.mjs';
import {UUID,digest,deviceServerId,currentDeviceLease,deviceConflict,deviceRequired} from './device-policy.mjs';
import proof from '../../shared/device-proof.cjs';
import {recordDeviceUsage} from './device-usage.mjs';
import {ledgerRequestBodyPolicy} from './ledger-check-policy.mjs';
import {acquireLedgerImportPermit} from './ledger-check-import-budget.mjs';
import {workpaperDataBodyPolicy} from './workpaper-data-policy.mjs';
import {acquireWorkpaperDataPermit} from './workpaper-data-budget.mjs';
const BODY_LIMIT=17*1024*1024,NONCE_LIMIT=2048;
const BOOTSTRAP_GET=new Set(['/api/auth/methods','/api/auth/session','/api/auth/onboarding/capabilities','/api/auth/recovery-requests/capabilities','/api/auth/devices','/api/auth/device-replacements']);
const BOOTSTRAP_POST=new Set(['/api/auth/login','/api/auth/logout','/api/auth/phone/login','/api/auth/phone/challenges','/api/auth/phone/reset','/api/auth/recovery-requests',
  '/api/auth/onboarding/preview','/api/auth/onboarding/challenges','/api/auth/onboarding/activate',
  '/api/auth/first-administrator/preview','/api/auth/first-administrator/challenges','/api/auth/first-administrator/activate',
  '/api/auth/devices/enrollment-challenges','/api/auth/devices/proof-challenges','/api/auth/devices/revocation-challenges','/api/auth/devices/enroll','/api/auth/devices/prove','/api/auth/devices/revoke',
  '/api/auth/wechat/transactions',
  '/api/auth/device-replacements/request-challenges','/api/auth/device-replacements/request','/api/auth/device-replacements/withdraw-challenges','/api/auth/device-replacements/withdraw','/api/auth/device-replacements/activate-challenges','/api/auth/device-replacements/activate']);
export function deviceBootstrapAllowed(request){
  const url=new URL(request.url);
  // This one exact external callback keeps its own strict state/code/error
  // query validation. No prefix, arbitrary query or alternate verb is exempt.
  if(request.method==='GET'&&url.pathname==='/api/auth/wechat/callback')return true;
  if(url.search)return false;
  if(request.method==='GET')return BOOTSTRAP_GET.has(url.pathname);
  if(request.method!=='POST')return false;
  if(BOOTSTRAP_POST.has(url.pathname))return true;
  const wechat=/^\/api\/auth\/wechat\/transactions\/([^/]+)\/(status|cancel|link|exchange)$/.exec(url.pathname);
  return !!wechat&&UUID.test(wechat[1]);
}
async function bodyBytes(request,maximum=BODY_LIMIT){
  const length=request.headers.get('Content-Length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maximum))throw new ApiError(413,'TOO_LARGE','资料超过大小限制。');
  if(['GET','HEAD'].includes(request.method)){if(length!==null&&Number(length)!==0)invalid();return Buffer.alloc(0);}
  const reader=request.body?.getReader();if(!reader)return Buffer.alloc(0);
  const chunks=[];let total=0;
  for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>maximum){await reader.cancel();throw new ApiError(413,'TOO_LARGE','资料超过大小限制。');}chunks.push(part.value);}
  return Buffer.concat(chunks);
}
function freshLease(db,request,before,serverId,at){
  const fresh=currentDeviceLease(db,request,at);
  if(fresh.userId!==before.userId||fresh.token!==before.token||fresh.stamp!==before.stamp||fresh.leaseId!==before.leaseId||fresh.deviceId!==before.deviceId||fresh.bindingRevision!==before.bindingRevision||fresh.keyFingerprint!==before.keyFingerprint||deviceServerId(db)!==serverId)deviceConflict();
  return fresh;
}
export async function authorizeDeviceRequest(request,{db,now=Date.now,identityProviders={}}={}){
  if(identityProviders.deviceProofRequired!==true||deviceBootstrapAllowed(request))return {request,context:null};
  const at=now(),identity=currentDeviceLease(db,request,at),serverId=deviceServerId(db);
  const nonce=request.headers.get('X-Shenyi-Device-Nonce'),bodySha256=request.headers.get('X-Shenyi-Device-Body-SHA256'),signature=request.headers.get('X-Shenyi-Device-Signature');
  let nonceRaw,signatureRaw;
  try{nonceRaw=proof.nonceBytes(nonce);signatureRaw=proof.signatureBytes(signature);}catch{invalid();}
  if(typeof bodySha256!=='string'||!/^[a-f0-9]{64}$/.test(bodySha256))invalid();
  const url=new URL(request.url),fields={serverId,userId:identity.userId,sessionBinding:identity.sessionBinding,deviceId:identity.deviceId,bindingRevision:identity.bindingRevision,leaseId:identity.leaseId,
    method:request.method,pathAndQuery:url.pathname+url.search,bodySha256,nonce};
  const key=proof.parsePublicKey(identity.publicKey);
  let payload;try{payload=proof.requestProofBytes(fields);}catch{invalid();}
  if(!verify(null,payload,key.key,signatureRaw))deviceRequired();
  consume(db,'device-request:'+digest(identity.userId),now(),60000,120);
  // Verify the claimed hash first, so unauthenticated payloads do not cause a
  // large body read. Then retain exactly the authenticated bytes for dispatch.
  const requestBodyPolicy=workpaperDataBodyPolicy(db,request,identity,ledgerRequestBodyPolicy(db,request,identity.userId,BODY_LIMIT),now());
  const release=requestBodyPolicy.workpaperDataPermit?acquireWorkpaperDataPermit(db,identity.userId,{large:requestBodyPolicy.workpaperDataPermit==='large'}):requestBodyPolicy.ledgerImportStamp?acquireLedgerImportPermit(db,identity.userId):undefined;
  try {
  const bytes=await bodyBytes(request,requestBodyPolicy.maximum);if(digest(bytes)!==bodySha256)throw new ApiError(403,'DEVICE_BODY_MISMATCH','请求资料与设备签名不一致。');
  const fresh=freshLease(db,request,identity,serverId,now()),nonceHash=digest(nonceRaw);
  const context=transaction(db,()=>{
    const time=now(),current=freshLease(db,request,fresh,serverId,time);
    db.prepare(`DELETE FROM team_device_request_replays WHERE lease_id IN
      (SELECT lease_id FROM team_device_leases WHERE revoked_at IS NOT NULL OR expires_at<=?)`).run(time);
    if(db.prepare('SELECT 1 FROM team_device_request_replays WHERE lease_id=? AND nonce_hash=?').get(current.leaseId,nonceHash))throw new ApiError(409,'DEVICE_REQUEST_REPLAY','请求已处理，请重新核对当前状态。');
    if(db.prepare('SELECT COUNT(*) n FROM team_device_request_replays WHERE lease_id=?').get(current.leaseId).n>=NONCE_LIMIT)throw new ApiError(429,'DEVICE_PROOF_LIMIT','设备请求过于频繁，请稍后重新持钥登录。');
    db.prepare('INSERT INTO team_device_request_replays(lease_id,nonce_hash,created_at) VALUES (?,?,?)').run(current.leaseId,nonceHash,time);
    recordDeviceUsage(db,current.userId,current.deviceId,time);
    return {userId:current.userId,deviceId:current.deviceId,bindingRevision:current.bindingRevision,leaseId:current.leaseId,stamp:current.stamp,serverId,...(requestBodyPolicy.ledgerImportStamp?{ledgerImportStamp:requestBodyPolicy.ledgerImportStamp}:{}),...(requestBodyPolicy.workpaperDataStamp?{workpaperDataStamp:requestBodyPolicy.workpaperDataStamp,workpaperStageStamp:requestBodyPolicy.workpaperStageStamp}:{})};
  });
  const rebuilt=new Request(request.url,{method:request.method,headers:new Headers(request.headers),signal:request.signal,
    ...(!['GET','HEAD'].includes(request.method)&&request.body!==null?{body:bytes}:{} )});
  return {request:rebuilt,context,...(release?{release}:{})};
  } catch(error) { release?.();throw error; }
}
