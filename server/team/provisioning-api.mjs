/** Owner-reviewed, invitation-only team opening. No route grants reviewer power.
 * Providers are injected for isolated verification; no real SMS is configured. */
import {createHash,createHmac,randomBytes,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {authenticated,consume,limitedPasswordWork} from './auth-api.mjs';
import {canOperateTeam,hasAffiliation,platformReviewer,restrictedBusinessIdentity} from './administration-policy.mjs';
import {normalizePhone} from './phone-api.mjs';
import {onboardingAvailable} from './employee-invitations-api.mjs';
import {hashPassword,validPassword,verifyPassword} from './passwords.mjs';
import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
import {approvePilot,pilotApprovalReader} from './pilot-approval.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const mask=phone=>phone.slice(0,5)+'****'+phone.slice(-4);
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)&&Buffer.from(value,'base64url').toString('base64url')===value;
const conflict=()=>{throw new ApiError(409,'PROVISIONING_CONFLICT','开通申请或账号状态已改变，请重新核对。');};
const verification=()=>{throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');};
const method=allow=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow});
function text(value,maximum){
  if(typeof value!=='string'||value!==value.toWellFormed())invalid();
  const clean=value.normalize('NFKC').trim();if(!clean||[...clean].length>maximum||/[\p{Cc}\p{Cf}]/u.test(clean))invalid();return clean;
}
function sameActor(db,request,userId,at){const actor=authenticated(db,request,at);if(actor.userId!==userId)deny();return actor;}
function reviewer(db,userId){const row=platformReviewer(db,userId);if(!row)deny();return row;}
function sameReviewer(before,after){return !!after&&before.revision===after.revision&&before.credential_revision===after.credential_revision&&before.password_hash===after.password_hash;}
function requestView(row,pilot){return {id:row.request_id,teamId:row.team_id,teamName:row.team_name,phoneMasked:mask(row.admin_phone),status:row.status,revision:row.revision,createdAt:row.created_at,expiresAt:row.expires_at,...(pilot===undefined?{}:{pilot})};}
function record(db,row,actor,action,at){db.prepare('INSERT INTO team_provisioning_events VALUES (?,?,?,?,?,?)').run(randomUUID(),row.request_id,actor,action,row.revision,at);}
function liveTicket(db,code,phone,at){
  if(!opaque(code))deny();
  const row=db.prepare('SELECT * FROM team_provisioning_requests WHERE token_hash=? AND admin_phone=?').get(digest(code),phone);
  if(!row||row.status!=='approved'||row.expires_at===null||row.expires_at<=at)deny();
  const source=platformReviewer(db,row.approved_by);
  if(!source||source.revision!==row.reviewer_revision||source.credential_revision!==row.credential_revision||digest(source.password_hash)!==row.credential_fingerprint)deny();
  return row;
}
function sameTicket(before,after){return ['request_id','team_id','team_name','admin_phone','status','revision','approved_by','approved_at','reviewer_revision','credential_revision','credential_fingerprint','token_hash','expires_at'].every(key=>before[key]===after[key]);}
function mac(row,code,pepper){return createHmac('sha256',pepper).update(JSON.stringify([row.challenge_id,row.request_id,row.invitation_hash,row.purpose,row.phone,row.expires_at,code])).digest('hex');}
function validCode(row,code,pepper){return typeof code==='string'&&/^\d{6}$/.test(code)&&/^[a-f0-9]{64}$/.test(row.code_mac)&&timingSafeEqual(Buffer.from(row.code_mac,'hex'),Buffer.from(mac(row,code,pepper),'hex'));}
function challenge(db,id,ticket,at,reserve=false){
  const row=reserve?db.prepare(`UPDATE team_first_administrator_challenges SET attempts=attempts+1
    WHERE challenge_id=? AND request_id=? AND invitation_hash=? AND phone=? AND purpose='first-admin'
      AND delivery_state='sent' AND consumed_at IS NULL AND expires_at>? AND attempts<5 RETURNING *`)
    .get(id,ticket.request_id,ticket.token_hash,ticket.admin_phone,at)
    :db.prepare(`SELECT * FROM team_first_administrator_challenges WHERE challenge_id=? AND request_id=? AND invitation_hash=?
      AND phone=? AND purpose='first-admin' AND delivery_state='sent' AND consumed_at IS NULL AND expires_at>? AND attempts<=5`)
      .get(id,ticket.request_id,ticket.token_hash,ticket.admin_phone,at);
  if(!row)deny();return row;
}
function phoneOwner(db,phone){return db.prepare(`SELECT phone.user_id,phone.revision AS phone_revision,phone.verified_at,
  account.status,credential.revision AS credential_revision,credential.password_hash
  FROM team_phone_credentials AS phone JOIN team_users AS account ON account.user_id=phone.user_id
  JOIN team_credentials AS credential ON credential.user_id=phone.user_id WHERE phone.phone=?`).get(phone);}
function eligibleOwner(db,owner,at){return owner.status==='active'&&owner.verified_at>0&&owner.verified_at<=at&&!hasAffiliation(db,owner.user_id);}
function sameOwner(db,before,after,at){return !!after&&before.user_id===after.user_id&&eligibleOwner(db,after,at)&&['phone_revision','verified_at','credential_revision','password_hash'].every(key=>before[key]===after[key]);}

export async function handleTeamProvisioningRequest(request,{db,now=Date.now,identityProviders={},...serviceOptions}={}){
  const url=new URL(request.url),path=url.pathname;
  const base=path==='/api/operations/team-requests';
  const access=path==='/api/operations/team-requests/access';
  const review=/^\/api\/operations\/team-requests\/([^/]+)\/review$/.exec(path);
  const administration=path==='/api/auth/team-administration';
  const first=/^\/api\/auth\/first-administrator\/(preview|challenges|activate)$/.exec(path);
  if(!base&&!access&&!review&&!administration&&!first)return null;
  if(url.search)invalid();
  if(base||access||review||administration){
    const actor=authenticated(db,request,now());
    if(access){if(request.method!=='GET')return method('GET');return json({canReview:!!platformReviewer(db,actor.userId)});}
    if(administration){
      if(request.method!=='GET')return method('GET');
      if(restrictedBusinessIdentity(db,actor.userId))return json({teams:[]});
      const rows=db.prepare(`SELECT operator.team_id,profile.name FROM team_operators AS operator
        JOIN team_profiles AS profile ON profile.team_id=operator.team_id JOIN teams AS team ON team.team_id=operator.team_id
        WHERE operator.user_id=? AND operator.role='administrator' AND operator.status='active' AND team.status='active'
        ORDER BY operator.team_id LIMIT 50`).all(actor.userId);
      return json({teams:rows.filter(row=>canOperateTeam(db,actor.userId,row.team_id)).map(row=>({teamId:row.team_id,teamName:row.name}))});
    }
    reviewer(db,actor.userId);
    const pilotOptions={...serviceOptions,now,identityProviders};
    if(base&&request.method==='GET'){
      const pilot=pilotApprovalReader(db,actor.userId,pilotOptions);
      return json({requests:db.prepare('SELECT * FROM team_provisioning_requests ORDER BY created_at DESC,request_id DESC LIMIT 50').all().map(row=>requestView(row,pilot?.(row)))});
    }
    if(request.method!=='POST')return method(base?'GET, POST':'POST');
    consume(db,'team-provisioning:'+digest(actor.userId),now(),15*60000,20);
    if(base){
      const body=await readJson(request,['teamName','adminPhone']),teamName=text(body.teamName,80),phone=normalizePhone(body.adminPhone);
      return transaction(db,()=>{
        sameActor(db,request,actor.userId,now());reviewer(db,actor.userId);
        const id=randomUUID(),at=now();
        db.prepare(`INSERT INTO team_provisioning_requests(request_id,team_id,team_name,admin_phone,status,created_by,created_at)
          VALUES (?,?,?,?,'pending',?,?)`).run(id,randomUUID(),teamName,phone,actor.userId,at);
        const row=db.prepare('SELECT * FROM team_provisioning_requests WHERE request_id=?').get(id);record(db,row,actor.userId,'create',at);
        return json({request:requestView(row)},201);
      });
    }
    if(!ID.test(review[1]))deny();
    const body=await readJson(request,['decision','revision','currentPassword','endsAt','seats']);
    if(!['approve','reject','revoke','approve-pilot'].includes(body.decision)||!Number.isSafeInteger(body.revision)||body.revision<1||typeof body.currentPassword!=='string'||!body.currentPassword||Buffer.byteLength(body.currentPassword)>512)invalid();
    if(body.decision==='approve-pilot'){
      const {row,pilot}=await approvePilot(db,request,review[1],body,pilotOptions);
      return json({request:requestView(row,pilot)});
    }
    if(Object.hasOwn(body,'endsAt')||Object.hasOwn(body,'seats'))invalid();
    sameActor(db,request,actor.userId,now());const source=reviewer(db,actor.userId);
    const previous=db.prepare('SELECT * FROM team_provisioning_requests WHERE request_id=?').get(review[1]);if(!previous)deny();
    const expected=body.decision==='revoke'?'approved':'pending';
    if(previous.status!==expected||previous.revision!==body.revision)conflict();
    return limitedPasswordWork(db,async()=>{
      if(!await verifyPassword(body.currentPassword,source.password_hash))verification();
      return transaction(db,()=>{
        sameActor(db,request,actor.userId,now());if(!sameReviewer(source,reviewer(db,actor.userId)))conflict();
        const current=db.prepare('SELECT * FROM team_provisioning_requests WHERE request_id=?').get(previous.request_id);
        if(!current||current.status!==expected||current.revision!==body.revision)conflict();
        const invitationCode=body.decision==='approve'?randomBytes(32).toString('base64url'):null,at=now();
        const status=body.decision==='approve'?'approved':body.decision==='reject'?'rejected':'revoked';
        const result=db.prepare(`UPDATE team_provisioning_requests SET status=?,revision=revision+1,
          approved_by=?,approved_at=?,reviewer_revision=?,credential_revision=?,credential_fingerprint=?,token_hash=?,expires_at=?
          WHERE request_id=? AND revision=? AND status=?`).run(status,
            invitationCode?actor.userId:current.approved_by,invitationCode?at:current.approved_at,
            invitationCode?source.revision:current.reviewer_revision,invitationCode?source.credential_revision:current.credential_revision,
            invitationCode?digest(source.password_hash):current.credential_fingerprint,
            invitationCode?digest(invitationCode):current.token_hash,invitationCode?at+24*60*60000:current.expires_at,
            current.request_id,body.revision,expected);
        if(result.changes!==1)conflict();
        if(body.decision==='revoke')db.prepare("UPDATE team_first_administrator_challenges SET delivery_state='failed' WHERE request_id=? AND consumed_at IS NULL").run(current.request_id);
        const row=db.prepare('SELECT * FROM team_provisioning_requests WHERE request_id=?').get(current.request_id);record(db,row,actor.userId,body.decision,at);
        return json({request:requestView(row),...(invitationCode?{invitationCode}:{})});
      });
    });
  }
  if(request.method!=='POST')return method('POST');
  const action=first[1],fields=action==='activate'?['invitationCode','phone','challengeId','code','password','displayName','accept']:['invitationCode','phone'];
  const body=await readJson(request,fields),phone=normalizePhone(body.phone);
  consume(db,'first-administrator:'+action+':global',now(),60000,60);
  const ticket=liveTicket(db,body.invitationCode,phone,now());
  if(action==='preview')return json({teamId:ticket.team_id,teamName:ticket.team_name,phoneMasked:mask(phone),expiresAt:ticket.expires_at});
  if(!onboardingAvailable(identityProviders))throw new ApiError(503,'SMS_UNAVAILABLE','手机号验证服务尚未开通。');
  const {sms,phonePepper:pepper}=identityProviders;
  if(action==='challenges'){
    consume(db,'sms:global',now(),60000,60);consume(db,'sms:phone:'+digest(phone),now(),10*60000,3);consume(db,'sms:first-admin:'+ticket.request_id,now(),10*60000,3);
    const row={challenge_id:randomUUID(),request_id:ticket.request_id,invitation_hash:ticket.token_hash,purpose:'first-admin',phone,expires_at:Math.min(now()+5*60000,ticket.expires_at)};
    const code=String(randomInt(0,1000000)).padStart(6,'0');
    db.prepare(`INSERT INTO team_first_administrator_challenges(challenge_id,request_id,invitation_hash,purpose,phone,code_mac,expires_at,delivery_state)
      VALUES (?,?,?,?,?,?,?,'sending')`).run(row.challenge_id,row.request_id,row.invitation_hash,row.purpose,row.phone,mac(row,code,pepper),row.expires_at);
    try{await sms.send({phone,code,purpose:'first-admin',challengeId:row.challenge_id});}
    catch{db.prepare("UPDATE team_first_administrator_challenges SET delivery_state='failed' WHERE challenge_id=? AND consumed_at IS NULL").run(row.challenge_id);throw new ApiError(503,'SMS_UNAVAILABLE','手机号验证服务暂不可用。');}
    try{
      transaction(db,()=>{
        if(!sameTicket(ticket,liveTicket(db,body.invitationCode,phone,now()))||row.expires_at<=now())deny();
        const change=db.prepare("UPDATE team_first_administrator_challenges SET delivery_state='sent' WHERE challenge_id=? AND delivery_state='sending' AND consumed_at IS NULL").run(row.challenge_id);if(change.changes!==1)deny();
      });
    }catch(error){db.prepare("UPDATE team_first_administrator_challenges SET delivery_state='failed' WHERE challenge_id=? AND consumed_at IS NULL").run(row.challenge_id);throw error;}
    return json({challengeId:row.challenge_id,expiresAt:row.expires_at},202);
  }
  if(body.accept!==true||typeof body.challengeId!=='string'||!ID.test(body.challengeId)||typeof body.password!=='string'||!body.password||Buffer.byteLength(body.password)>512)invalid();
  const proof=challenge(db,body.challengeId,ticket,now(),true);if(!validCode(proof,body.code,pepper))deny();
  const owner=phoneOwner(db,phone);if(owner&&!eligibleOwner(db,owner,now()))conflict();
  const name=owner?null:text(body.displayName,80);if(!owner&&!validPassword(body.password))invalid();
  return limitedPasswordWork(db,async()=>{
    let encoded;if(owner){if(!await verifyPassword(body.password,owner.password_hash))deny();}else encoded=await hashPassword(body.password);
    return transaction(db,()=>{
      const fresh=liveTicket(db,body.invitationCode,phone,now());if(!sameTicket(ticket,fresh))conflict();
      const currentProof=challenge(db,body.challengeId,fresh,now());if(!validCode(currentProof,body.code,pepper))deny();
      const currentOwner=phoneOwner(db,phone);
      if(owner){if(!sameOwner(db,owner,currentOwner,now()))conflict();}
      else if(currentOwner||db.prepare('SELECT 1 FROM team_phone_credentials WHERE phone=?').get(phone))conflict();
      if(db.prepare('SELECT 1 FROM teams WHERE team_id=?').get(fresh.team_id))conflict();
      const userId=owner?.user_id||randomUUID(),at=now();
      if(!owner){
        db.prepare("INSERT INTO team_users VALUES (?,'active')").run(userId);
        db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(userId,'administrator-'+randomUUID(),name,encoded);
        db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run(userId,phone,at);
      }
      db.prepare("INSERT INTO teams VALUES (?,'active')").run(fresh.team_id);
      db.prepare('INSERT INTO team_profiles VALUES (?,?)').run(fresh.team_id,fresh.team_name);
      db.prepare("INSERT INTO team_operators VALUES (?,?,'administrator','active')").run(fresh.team_id,userId);
      const changed=db.prepare("UPDATE team_provisioning_requests SET status='activated',revision=revision+1,activated_at=?,activated_by=? WHERE request_id=? AND revision=? AND status='approved'").run(at,userId,fresh.request_id,fresh.revision);if(changed.changes!==1)conflict();
      db.prepare('UPDATE team_first_administrator_challenges SET consumed_at=? WHERE request_id=? AND consumed_at IS NULL').run(at,fresh.request_id);
      db.prepare('INSERT INTO team_activity VALUES (?,?,?,?,NULL,?)').run(randomUUID(),fresh.team_id,userId,'team.activate',at);
      record(db,{...fresh,revision:fresh.revision+1},userId,'activate',at);
      return json({activated:true});
    });
  });
}
