import {administratorBusinessEligibilitySql} from './administrator-business-role-policy.mjs';
import {captureManagementSubscriptionGuard} from './subscription-management-policy.mjs';
import {captureSeatAdmission} from './seat-capacity-policy.mjs';
/** Invite-only activation experiment. SMS adapters are explicit, server-side
 * injections; no real sending, public signup or team creation is bundled. */
import {createHash,createHmac,randomBytes,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {authenticated,consume,limitedPasswordWork} from './auth-api.mjs';
import {normalizePhone} from './phone-api.mjs';
import {hashPassword,verifyPassword,validPassword} from './passwords.mjs';
import {canOperateTeam,hasAffiliation} from './administration-policy.mjs';
import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)&&Buffer.from(value,'base64url').toString('base64url')===value;
const mask=phone=>phone.slice(0,5)+'****'+phone.slice(-4);
const changed=()=>{throw new ApiError(409,'ACTIVATION_CONFLICT','账号或邀请状态已改变，请重新核对。');};
export function onboardingAvailable(providers={}){return typeof providers.sms?.send==='function'&&Buffer.isBuffer(providers.phonePepper)&&providers.phonePepper.length>=32;}
function smsProvider(providers){if(!onboardingAvailable(providers))throw new ApiError(503,'SMS_UNAVAILABLE','手机号验证服务尚未开通。');return {sms:providers.sms,pepper:providers.phonePepper};}
function canBusinessInvite(db,userId,teamId){
  return !!db.prepare(`SELECT 1 FROM team_admin_grants AS grant
    JOIN team_memberships AS member ON member.team_id=grant.team_id AND member.user_id=grant.user_id
    JOIN teams AS team ON team.team_id=member.team_id JOIN team_users AS account ON account.user_id=member.user_id
    WHERE grant.team_id=? AND grant.user_id=? AND grant.permission='member.invite' AND grant.status='active'
      AND member.status='active' AND member.role IN ('manager','partner') AND ${administratorBusinessEligibilitySql('member')}
      AND team.status='active' AND account.status='active'`).get(teamId,userId);
}
// SQL identifiers originate only in these fixed server-owned records.
const SOURCES=Object.freeze([
  Object.freeze({name:'business',invitations:'team_employee_invitations',challenges:'team_employee_activation_challenges',authorized:canBusinessInvite}),
  Object.freeze({name:'operator',invitations:'team_operator_employee_invitations',challenges:'team_operator_employee_activation_challenges',authorized:canOperateTeam}),
]);
const sourceOf=row=>SOURCES.find(source=>source.name===row.source);
function invitationListQuery(url,userId,teamId){
  const keys=[...url.searchParams.keys()];
  if(keys.some(key=>!['after','limit'].includes(key))||new Set(keys).size!==keys.length)invalid();
  const limitText=url.searchParams.get('limit');
  if(limitText!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(limitText))invalid();
  const limit=limitText===null?50:Number(limitText),after=url.searchParams.get('after');
  if(after===null)return {limit,position:null};
  if(!after||after.length>1024||!/^[A-Za-z0-9_-]+$/.test(after))invalid();
  const bytes=Buffer.from(after,'base64url');if(bytes.toString('base64url')!==after)invalid();
  const text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes))invalid();
  let tuple;try{tuple=JSON.parse(text);}catch{invalid();}
  if(!Array.isArray(tuple)||tuple.length!==6||JSON.stringify(tuple)!==text||tuple[0]!==1||
    typeof tuple[1]!=='string'||!ID.test(tuple[1])||tuple[1]!==userId||typeof tuple[2]!=='string'||!ID.test(tuple[2])||tuple[2]!==teamId||
    typeof tuple[3]!=='string'||!SOURCES.some(source=>source.name===tuple[3])||
    !Number.isSafeInteger(tuple[4])||tuple[4]<0||typeof tuple[5]!=='string'||!ID.test(tuple[5]))invalid();
  return {limit,position:{source:tuple[3],createdAt:tuple[4],invitationId:tuple[5]}};
}
function invitationPosition(userId,teamId,row){return Buffer.from(JSON.stringify([1,userId,teamId,row.source,row.created_at,row.invitation_id])).toString('base64url');}
function compareInvitations(a,b){return b.created_at-a.created_at||(a.invitation_id<b.invitation_id?1:a.invitation_id>b.invitation_id?-1:0)||(a.source<b.source?1:a.source>b.source?-1:0);}
function invitationList(db,request,url,userId,teamId,now){
  const {limit,position}=invitationListQuery(url,userId,teamId);
  if(position){const source=SOURCES.find(value=>value.name===position.source);if(!db.prepare('SELECT 1 FROM '+source.invitations+' WHERE team_id=? AND invitation_id COLLATE BINARY=? AND created_at=?').get(teamId,position.invitationId,position.createdAt))invalid();}
  const rows=SOURCES.flatMap(source=>{
    const seek=position?' AND (created_at<? OR (created_at=? AND invitation_id COLLATE BINARY<?) OR (created_at=? AND invitation_id COLLATE BINARY=? AND ? COLLATE BINARY<?))':'';
    const params=position?[teamId,position.createdAt,position.createdAt,position.invitationId,position.createdAt,position.invitationId,source.name,position.source,limit+1]:[teamId,limit+1];
    return db.prepare('SELECT * FROM '+source.invitations+' WHERE team_id=?'+seek+' ORDER BY created_at DESC,invitation_id COLLATE BINARY DESC LIMIT ?').all(...params).map(row=>({...row,source:source.name}));
  }).sort(compareInvitations);
  const at=now();sameActor(db,request,userId,at);if(!canInvite(db,userId,teamId))deny();
  const page=rows.slice(0,limit),nextCursor=rows.length>limit?invitationPosition(userId,teamId,page[page.length-1]):null;
  return json({invitations:page.map(row=>({invitationId:row.invitation_id,...publicInvitation(row),status:row.accepted_at!==null?'accepted':row.revoked_at!==null?'revoked':row.expires_at<=at?'expired':'pending'})),nextCursor});
}
function canInvite(db,userId,teamId){return SOURCES.some(source=>source.authorized(db,userId,teamId));}
function sameActor(db,request,userId,at){const actor=authenticated(db,request,at);if(actor.userId!==userId)deny();return actor;}
function findInvitation(db,where,params){
  const rows=SOURCES.flatMap(source=>db.prepare('SELECT * FROM '+source.invitations+' WHERE '+where).all(...params).map(row=>({...row,source:source.name})));
  if(rows.length!==1)deny();return rows[0];
}
function activeMember(db,userId,teamId){return !!db.prepare(`SELECT 1 FROM team_memberships AS member
  JOIN teams AS team ON team.team_id=member.team_id WHERE member.team_id=? AND member.user_id=? AND member.status='active' AND team.status='active'`).get(teamId,userId);}
function liveInvitation(db,invitationCode,phone,at){
  if(!opaque(invitationCode))deny();
  const row=findInvitation(db,'token_hash=? AND phone=?',[digest(invitationCode),phone]);
  if(row.revoked_at!==null||row.accepted_at!==null||row.expires_at<=at||!sourceOf(row).authorized(db,row.invited_by,row.team_id))deny();
  return row;
}
function publicInvitation(row){return {teamId:row.team_id,role:row.role,phoneMasked:mask(row.phone),expiresAt:row.expires_at};}
function sameInvitation(before,after){return ['source','invitation_id','token_hash','team_id','phone','role','invited_by','created_at','expires_at'].every(key=>before[key]===after[key]);}
function codeMac(row,code,pepper){return createHmac('sha256',pepper).update(JSON.stringify([row.challenge_id,row.invitation_id,row.invitation_hash,row.purpose,row.phone,row.expires_at,code])).digest('hex');}
function validCode(row,code,pepper){return typeof code==='string'&&/^\d{6}$/.test(code)&&/^[a-f0-9]{64}$/.test(row.code_mac)&&timingSafeEqual(Buffer.from(row.code_mac,'hex'),Buffer.from(codeMac(row,code,pepper),'hex'));}
function liveChallenge(db,id,invitation,at){
  const row=db.prepare(`SELECT * FROM ${sourceOf(invitation).challenges} WHERE challenge_id=? AND invitation_id=? AND invitation_hash=?
    AND phone=? AND purpose='activate' AND delivery_state='sent' AND consumed_at IS NULL AND expires_at>? AND attempts<=5`)
    .get(id,invitation.invitation_id,invitation.token_hash,invitation.phone,at);
  if(!row)deny();return row;
}
function reserveAttempt(db,id,invitation,at){
  const row=db.prepare(`UPDATE ${sourceOf(invitation).challenges} SET attempts=attempts+1
    WHERE challenge_id=? AND invitation_id=? AND invitation_hash=? AND phone=? AND purpose='activate'
      AND delivery_state='sent' AND consumed_at IS NULL AND expires_at>? AND attempts<5 RETURNING *`)
    .get(id,invitation.invitation_id,invitation.token_hash,invitation.phone,at);
  if(!row)deny();return row;
}
function phoneOwner(db,phone){return db.prepare(`SELECT phone.user_id,phone.revision AS phone_revision,phone.verified_at,
  account.status,credential.revision AS credential_revision,credential.password_hash
  FROM team_phone_credentials AS phone JOIN team_users AS account ON account.user_id=phone.user_id
  JOIN team_credentials AS credential ON credential.user_id=phone.user_id WHERE phone.phone=?`).get(phone);}
function hasMembership(db,userId){return hasAffiliation(db,userId);}
function displayName(value){if(typeof value!=='string'||value!==value.toWellFormed())invalid();const name=value.normalize('NFKC').trim();if(!name||[...name].length>80||/[\p{Cc}\p{Cf}]/u.test(name))invalid();return name;}

export async function handleEmployeeInvitationRequest(request,{db,now=Date.now,identityProviders={},subscriptionEnforcement='disabled',seatCapacityEnforcement='disabled'}={}){
  const url=new URL(request.url),path=url.pathname;
  const base=/^\/api\/teams\/([^/]+)\/employee-invitations(?:\/(access)|\/([^/]+)\/(revoke))?$/.exec(path);
  const action=path.startsWith('/api/auth/onboarding/')?path.slice('/api/auth/onboarding/'.length):null;
  if(!base&&!action)return null;
  if(url.search&&!(base&&!base[2]&&!base[3]&&request.method==='GET'))invalid();
  if(action==='capabilities'){
    if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
    return json({available:onboardingAvailable(identityProviders),invitationOnly:true});
  }
  if(base){
    const [,teamId,access,invitationId,revoke]=base;
    if(!ID.test(teamId)||(invitationId&&!ID.test(invitationId)))deny();
    const identity=authenticated(db,request,now());
    if(access){
      if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
      if(!activeMember(db,identity.userId,teamId)&&!canOperateTeam(db,identity.userId,teamId))deny();
      return json({canInvite:canInvite(db,identity.userId,teamId)});
    }
    if(!canInvite(db,identity.userId,teamId))deny();
    if(revoke){
      if(request.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'POST'});
      await readJson(request,[]);
      return transaction(db,()=>{
        sameActor(db,request,identity.userId,now());if(!canInvite(db,identity.userId,teamId))deny();
        const row=findInvitation(db,'invitation_id=? AND team_id=?',[invitationId,teamId]),source=sourceOf(row);
        if(row.accepted_at!==null)changed();
        db.prepare('UPDATE '+source.invitations+' SET revoked_at=COALESCE(revoked_at,?) WHERE invitation_id=?').run(now(),invitationId);
        db.prepare('UPDATE '+source.challenges+" SET delivery_state='failed' WHERE invitation_id=? AND consumed_at IS NULL").run(invitationId);
        return json({revoked:true});
      });
    }
    if(request.method==='GET')return invitationList(db,request,url,identity.userId,teamId,now);
    if(request.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET, POST'});
    const body=await readJson(request,['phone','role']),phone=normalizePhone(body.phone);
    if(!['intern','assistant'].includes(body.role))invalid();
    sameActor(db,request,identity.userId,now());if(!canInvite(db,identity.userId,teamId))deny();
    const subscriptionGuard=captureManagementSubscriptionGuard(db,teamId,{now,identityProviders,subscriptionEnforcement});
    consume(db,'employee-invite:'+identity.userId,now(),15*60000,20);
    return transaction(db,()=>{
      sameActor(db,request,identity.userId,now());const source=SOURCES.find(value=>value.authorized(db,identity.userId,teamId));if(!source)deny();subscriptionGuard?.assertCurrent();
      const seatAdmission = captureSeatAdmission(db, teamId, {now,seatCapacityEnforcement});
      const invitationCode=randomBytes(32).toString('base64url'),invitationId=randomUUID(),at=now(),expiresAt=at+24*60*60000;
      db.prepare(`INSERT INTO ${source.invitations}(invitation_id,token_hash,team_id,phone,role,invited_by,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(invitationId,digest(invitationCode),teamId,phone,body.role,identity.userId,at,expiresAt);
      const publishedAt=subscriptionGuard?.assertCurrent();
      if (seatAdmission && expiresAt <= seatAdmission.assertPublished(publishedAt)) changed();
      return json({invitationCode,invitationId,expiresAt,teamId,role:body.role,phoneMasked:mask(phone)},201);
    });
  }
  if(!['preview','challenges','activate'].includes(action))deny();
  if(request.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'POST'});
  const fields=action==='activate'?['invitationCode','phone','challengeId','code','password','displayName','accept']:['invitationCode','phone'];
  const body=await readJson(request,fields),phone=normalizePhone(body.phone);
  consume(db,'onboarding:'+action+':global',now(),60000,60);
  const invitation=liveInvitation(db,body.invitationCode,phone,now());
  if(action==='preview')return json(publicInvitation(invitation));
  const {sms,pepper}=smsProvider(identityProviders);
  if(action==='challenges'){
    const subscriptionGuard=captureManagementSubscriptionGuard(db,invitation.team_id,{now,identityProviders,subscriptionEnforcement});
    consume(db,'sms:global',now(),60000,60);consume(db,'sms:phone:'+digest(phone),now(),10*60000,3);consume(db,'sms:invitation:'+invitation.invitation_id,now(),10*60000,3);
    const row={challenge_id:randomUUID(),invitation_id:invitation.invitation_id,invitation_hash:invitation.token_hash,purpose:'activate',phone,expires_at:Math.min(now()+5*60000,invitation.expires_at)};
    const code=String(randomInt(0,1000000)).padStart(6,'0');
    const source=sourceOf(invitation);
    db.prepare(`INSERT INTO ${source.challenges}(challenge_id,invitation_id,invitation_hash,purpose,phone,code_mac,expires_at,delivery_state)
      VALUES (?,?,?,?,?,?,?,'sending')`).run(row.challenge_id,row.invitation_id,row.invitation_hash,row.purpose,row.phone,codeMac(row,code,pepper),row.expires_at);
    try{subscriptionGuard?.assertCurrent();}
    catch(error){db.prepare('UPDATE '+source.challenges+" SET delivery_state='failed' WHERE challenge_id=? AND consumed_at IS NULL").run(row.challenge_id);throw error;}
    try{await sms.send({phone,code,purpose:'activate',challengeId:row.challenge_id});}
    catch{db.prepare('UPDATE '+source.challenges+" SET delivery_state='failed' WHERE challenge_id=? AND consumed_at IS NULL").run(row.challenge_id);throw new ApiError(503,'SMS_UNAVAILABLE','手机号验证服务暂不可用。');}
    try{
      transaction(db,()=>{
        const fresh=liveInvitation(db,body.invitationCode,phone,now());if(!sameInvitation(invitation,fresh)||row.expires_at<=now())deny();subscriptionGuard?.assertCurrent();
        const changed=db.prepare('UPDATE '+source.challenges+" SET delivery_state='sent' WHERE challenge_id=? AND delivery_state='sending' AND consumed_at IS NULL").run(row.challenge_id);if(changed.changes!==1)deny();subscriptionGuard?.assertCurrent();
      });
    }catch(error){
      db.prepare('UPDATE '+source.challenges+" SET delivery_state='failed' WHERE challenge_id=? AND consumed_at IS NULL").run(row.challenge_id);
      throw error;
    }
    return json({challengeId:row.challenge_id,expiresAt:row.expires_at},202);
  }
  if(body.accept!==true||typeof body.challengeId!=='string'||!ID.test(body.challengeId)||typeof body.password!=='string'||!body.password||Buffer.byteLength(body.password)>512)invalid();
  const challenge=reserveAttempt(db,body.challengeId,invitation,now());
  if(!validCode(challenge,body.code,pepper))deny();
  const owner=phoneOwner(db,phone);
  if(owner&&(owner.status!=='active'||owner.verified_at<=0||owner.verified_at>now()||hasMembership(db,owner.user_id)))changed();
  const name=owner?null:displayName(body.displayName);
  if(!owner&&!validPassword(body.password))invalid();
  const subscriptionGuard=captureManagementSubscriptionGuard(db,invitation.team_id,{now,identityProviders,subscriptionEnforcement});
  return limitedPasswordWork(db,async()=>{
    let encoded;
    if(owner){if(!await verifyPassword(body.password,owner.password_hash))deny();}
    else encoded=await hashPassword(body.password);
    return transaction(db,()=>{
      const currentInvite=liveInvitation(db,body.invitationCode,phone,now());
      if(!sameInvitation(invitation,currentInvite))changed();
      const fresh=liveChallenge(db,body.challengeId,currentInvite,now());if(!validCode(fresh,body.code,pepper))deny();
      const currentOwner=phoneOwner(db,phone);
      if(owner){
        if(!currentOwner||currentOwner.user_id!==owner.user_id||currentOwner.status!=='active'||currentOwner.phone_revision!==owner.phone_revision||currentOwner.verified_at!==owner.verified_at||currentOwner.credential_revision!==owner.credential_revision||currentOwner.password_hash!==owner.password_hash||hasMembership(db,owner.user_id))changed();
      }else if(currentOwner||db.prepare('SELECT 1 FROM team_phone_credentials WHERE phone=?').get(phone))changed();
      subscriptionGuard?.assertCurrent();
      const seatAdmission = captureSeatAdmission(db, currentInvite.team_id, {now,seatCapacityEnforcement}, 0);
      const userId=owner?.user_id||randomUUID();
      if(!owner){
        db.prepare("INSERT INTO team_users VALUES (?,'active')").run(userId);
        db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(userId,'employee-'+randomUUID(),name,encoded);
        db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run(userId,phone,now());
      }
      db.prepare("INSERT INTO team_memberships VALUES (?,?,?,'active')").run(currentInvite.team_id,userId,currentInvite.role);
      const source=sourceOf(currentInvite);
      const accepted = db.prepare('UPDATE '+source.invitations+' SET accepted_at=?,accepted_by=? WHERE invitation_id=? AND accepted_at IS NULL AND revoked_at IS NULL').run(now(),userId,currentInvite.invitation_id);
      if (accepted.changes !== 1) changed();
      db.prepare('UPDATE '+source.challenges+' SET consumed_at=? WHERE invitation_id=? AND consumed_at IS NULL').run(now(),currentInvite.invitation_id);
      db.prepare('INSERT INTO team_activity VALUES (?,?,?,?,NULL,?)').run(randomUUID(),currentInvite.team_id,userId,'member.activate',now());
      const publishedAt=subscriptionGuard?.assertCurrent();
      if (seatAdmission && Math.min(currentInvite.expires_at,fresh.expires_at) <= seatAdmission.assertPublished(publishedAt)) deny();
      return json({activated:true});
    });
  });
}
