import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {authenticated,consume,consumeBounded,assertRateLimitAvailable,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {verifyRecoveryRequestChallenge} from './phone-api.mjs';
import {canReviewRecovery,recoveryAuthority,recoveryTarget,recoveryReviewView,recoveryOwner,reviewedRecovery,reviewedRecoveryAvailable} from './recovery-review-policy.mjs';
import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const conflict=()=>{throw new ApiError(409,'RECOVERY_REVIEW_CONFLICT','恢复申请或授权状态已改变，请刷新核对。');};
const unavailable=()=>{throw new ApiError(503,'RECOVERY_NOT_CONFIGURED','恢复审核服务尚未开通。');};
const method=allow=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow});
const receipt=row=>({requestId:row.request_id,status:'pending',revision:1,expiresAt:row.expires_at});
function currentActor(db,request,userId,at){const actor=authenticated(db,request,at);if(actor.userId!==userId)deny();return actor;}
export async function handleRecoveryReviewRequest(request,{db,now=Date.now,identityProviders={}}={}){
  const url=new URL(request.url),path=url.pathname,capability=path==='/api/auth/recovery-requests/capabilities',create=path==='/api/auth/recovery-requests',access=path==='/api/account/recovery-reviews/access',list=path==='/api/account/recovery-reviews',review=/^\/api\/account\/recovery-reviews\/([^/]+)\/review$/.exec(path);
  if(!capability&&!create&&!access&&!list&&!review)return null;if(url.search)invalid();
  if(capability){if(request.method!=='GET')return method('GET');return json({reviewed:reviewedRecovery(identityProviders),available:reviewedRecoveryAvailable(identityProviders)});}
  if(create){
    if(request.method!=='POST')return method('POST');if(!reviewedRecoveryAvailable(identityProviders))unavailable();
    // Reject malformed bodies before consuming any anonymous rate-limit budget.
    const body=await readJson(request,['challengeId','code']);
    if(typeof body.challengeId!=='string'||!ID.test(body.challengeId)||typeof body.code!=='string'||!/^\d{6}$/.test(body.code))invalid();
    // The edge proxy overwrites this header with the observed client address.
    const suppliedAddress=request.headers.get('x-shenyi-client-ip')||'local';
    const clientAddress=isIP(suppliedAddress)?suppliedAddress.toLowerCase():'local';
    consumeBounded(db,'recovery-request:ip:','recovery-request:ip:'+digest(clientAddress),now(),60000,60);

    // First verify the SMS proof without spending an attempt. If the code itself
    // is wrong, reserve one attempt and preserve that counter before returning.
    try {
      verifyRecoveryRequestChallenge(db,body.challengeId,body.code,identityProviders.phonePepper,now(),{reserve:false});
    } catch (error) {
      verifyRecoveryRequestChallenge(db,body.challengeId,body.code,identityProviders.phonePepper,now());
      throw error;
    }

    return transaction(db,()=>{
      const existing=db.prepare('SELECT * FROM team_recovery_requests WHERE challenge_id=?').get(body.challengeId);
      if(existing){
        // Keep the historical behavior for an idempotent repeat: validate the
        // same proof and account for an attempt, but do not spend global budget.
        verifyRecoveryRequestChallenge(db,body.challengeId,body.code,identityProviders.phonePepper,now());
        return json(receipt(existing),201);
      }

      // Check shared capacity before reserving the SMS attempt. Since this and
      // the later consume() run in one IMMEDIATE transaction, another writer
      // cannot fill the budget between the check and the consume.
      assertRateLimitAvailable(db,'recovery-request:global',now(),60000,60);

      // Reserve the valid proof attempt only after capacity is known to exist.
      const reserved=verifyRecoveryRequestChallenge(db,body.challengeId,body.code,identityProviders.phonePepper,now());
      const at=now();
      // Recheck expiry and binding at the insert boundary. A proof expiring
      // between the preflight and this transaction must not create a request.
      const {row,eligible}=verifyRecoveryRequestChallenge(db,body.challengeId,body.code,identityProviders.phonePepper,at,{reserve:false});
      if(row.challenge_id!==reserved.row.challenge_id)throw new ApiError(400,'INVALID_CHALLENGE','验证请求无效或已失效，请重新验证。');

      consume(db,'recovery-request:global',at,60000,60);
      const target=eligible?recoveryTarget(db,row.user_id,at):null,id=randomUUID();
      db.prepare(`INSERT INTO team_recovery_requests(request_id,challenge_id,target_user_id,team_id,target_kind,target_stamp,status,created_at,expires_at)
        VALUES (?,?,?,?,?,?,'pending',?,?)`).run(id,row.challenge_id,target?.userId??null,target?.teamId??null,target?.kind??null,target?.stamp??null,at,row.expires_at);
      return json(receipt(db.prepare('SELECT * FROM team_recovery_requests WHERE request_id=?').get(id)),201);
    });
  }
  const actor=authenticated(db,request,now());
  if(access){if(request.method!=='GET')return method('GET');return json({canReview:reviewedRecovery(identityProviders)&&canReviewRecovery(db,actor.userId)});}
  if(!reviewedRecovery(identityProviders))unavailable();if(!canReviewRecovery(db,actor.userId))deny();
  if(list){
    if(request.method!=='GET')return method('GET');
    // Authorization precedes the 50-row projection. Stale grants or targets do
    // not expose a list, and unrelated teams cannot starve the caller's page.
    const rows=db.prepare(`SELECT * FROM team_recovery_requests WHERE target_user_id IS NOT NULL AND target_user_id<>?
      AND ((target_kind='administrator' AND ?=1) OR (target_kind='employee' AND team_id IN
        (SELECT team_id FROM team_operators WHERE user_id=? AND role='administrator' AND status='active')))
      ORDER BY created_at DESC,request_id DESC`).all(actor.userId,recoveryOwner(db,actor.userId)?1:0,actor.userId);
    return json({requests:rows.filter(row=>recoveryAuthority(db,actor.userId,row,now(),{freshTarget:false})).slice(0,50).map(row=>recoveryReviewView(db,row,now()))});
  }
  if(request.method!=='POST')return method('POST');if(!ID.test(review[1]))deny();
  consume(db,'recovery-review:'+digest(actor.userId),now(),15*60000,20);
  const body=await readJson(request,['decision','revision','currentPassword']);if(!['approve','reject','revoke'].includes(body.decision)||!Number.isSafeInteger(body.revision)||body.revision<1||typeof body.currentPassword!=='string'||!body.currentPassword||Buffer.byteLength(body.currentPassword)>512)invalid();
  currentActor(db,request,actor.userId,now());
  const previous=db.prepare('SELECT * FROM team_recovery_requests WHERE request_id=?').get(review[1]);if(!previous)deny();
  const expected=body.decision==='revoke'?'approved':'pending';
  const before=recoveryAuthority(db,actor.userId,previous,now(),{freshTarget:body.decision!=='revoke'});if(!before)deny();
  if(previous.status!==expected||previous.revision!==body.revision||previous.expires_at<=now())conflict();
  return limitedPasswordWork(db,async()=>{
    if(!await verifyPassword(body.currentPassword,before.credential.password_hash))throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
    return transaction(db,()=>{
      currentActor(db,request,actor.userId,now());const row=db.prepare('SELECT * FROM team_recovery_requests WHERE request_id=?').get(previous.request_id);
      const fresh=row&&recoveryAuthority(db,actor.userId,row,now(),{freshTarget:body.decision!=='revoke'});
      if(!row||!fresh||fresh.stamp!==before.stamp||row.status!==expected||row.revision!==body.revision||row.expires_at<=now())conflict();
      const proof=body.decision==='approve'?randomBytes(32).toString('base64url'):null,status=body.decision==='approve'?'approved':body.decision==='reject'?'rejected':'revoked';
      const changed=db.prepare(`UPDATE team_recovery_requests SET status=?,revision=revision+1,approved_by=?,approval_stamp=?,token_hash=?
        WHERE request_id=? AND status=? AND revision=?`).run(status,proof?actor.userId:row.approved_by,proof?fresh.stamp:row.approval_stamp,proof?digest(proof):row.token_hash,row.request_id,expected,row.revision);
      if(changed.changes!==1)conflict();
      db.prepare('INSERT INTO team_recovery_events VALUES (?,?,?,?,?,?)').run(randomUUID(),row.request_id,actor.userId,body.decision,row.revision+1,now());
      return json({request:recoveryReviewView(db,db.prepare('SELECT * FROM team_recovery_requests WHERE request_id=?').get(row.request_id),now()),...(proof?{recoveryProof:proof}:{})});
    });
  });
}
