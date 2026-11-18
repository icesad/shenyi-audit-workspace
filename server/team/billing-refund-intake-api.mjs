import {createHash} from 'node:crypto';
import {consume,limitedPasswordWork} from './auth-api.mjs';
import {UUID,currentDeviceLease,deviceServerId,deviceConflict,deviceRequired} from './device-policy.mjs';
import {verifyPassword} from './passwords.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {ApiError,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
import {appendBillingRefundIntake,readBillingRefundIntake,readBillingRefundTarget,
 REFUND_INTAKE_REASON_CODES,REFUND_FOLLOW_UP_REASON_CODES,BILLING_REFUND_REFERENCE} from './billing-refund-intake-store.mjs';

const ACCESS='/api/auth/refund-intake/access';
const ORDER=/^\/api\/platform\/billing\/refund-intakes\/(annual|seat)\/([^/]+)$/;
const matches=(pattern,value)=>typeof value==='string'&&pattern.exec(value)?.[0]===value;
const integer=(value,minimum=0)=>Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=minimum;
const conflict=()=>{throw new ApiError(409,'BILLING_REFUND_INTAKE_CONFLICT','受理权限或记录已变更，请重新核对订单。');};
const paymentRequired=()=>{throw new ApiError(409,'BILLING_REFUND_INTAKE_PAYMENT_REQUIRED','尚无已核验的原收款，请先核对该订单。');};
const allow=methods=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:methods});

function serverTime(now){
 const value=now();
 if(!integer(value)||value>8640000000000000)conflict();
 return value;
}
function heldDevice(request,{db,now,identityProviders,deviceContext}){
 if(identityProviders.deviceProofRequired!==true||!deviceContext)deviceRequired();
 const actor=currentDeviceLease(db,request,serverTime(now));
 if(actor.userId!==deviceContext.userId||actor.deviceId!==deviceContext.deviceId
   ||actor.bindingRevision!==deviceContext.bindingRevision||actor.leaseId!==deviceContext.leaseId
   ||actor.stamp!==deviceContext.stamp||deviceServerId(db)!==deviceContext.serverId)deviceConflict();
 return actor;
}
function grant(db,userId){
 const row=db.prepare(`SELECT authority.revision,credential.revision AS credential_revision,credential.password_hash
   FROM team_billing_refund_intake_reviewers authority
   JOIN team_users account ON account.user_id=authority.user_id AND account.status='active'
   JOIN team_credentials credential ON credential.user_id=authority.user_id
   WHERE authority.user_id=? AND authority.permission='billing.refund-intake' AND authority.status='active'
   AND NOT EXISTS(SELECT 1 FROM team_memberships WHERE user_id=authority.user_id)
   AND NOT EXISTS(SELECT 1 FROM team_operators WHERE user_id=authority.user_id)`).get(userId);
 if(!row)return null;
 if(!integer(row.revision,1)||!integer(row.credential_revision,1)||typeof row.password_hash!=='string')conflict();
 return row;
}
function target(db,kind,orderId){
 const order=readBillingRefundTarget(db,kind,orderId);
 if(!order)deny();
 const name=db.prepare('SELECT name FROM team_profiles WHERE team_id=?').get(order.teamId)?.name;
 return {...order,teamName:safeMemberText(name,order.teamId)};
}
function detail(db,kind,orderId,beforeRevision){
 const order=target(db,kind,orderId);
 return {order,...readBillingRefundIntake(db,kind,orderId,{beforeRevision})};
}
function page(url){
 if(!url.search)return undefined;
 const keys=[...url.searchParams.keys()];
 const raw=url.searchParams.get('beforeRevision');
 if(keys.length!==1||keys[0]!=='beforeRevision'||!matches(/^[1-9][0-9]*$/,raw)||!integer(Number(raw),1))invalid();
 return Number(raw);
}
async function readIntake(request){
 const input=await readJson(request,['requestId','expectedRevision','reason','reference','currentPassword'],2048);
 if(!matches(UUID,input.requestId)||!integer(input.expectedRevision)
   ||typeof input.currentPassword!=='string'||!input.currentPassword||Buffer.byteLength(input.currentPassword)>512
   ||(input.reference!==undefined&&!matches(BILLING_REFUND_REFERENCE,input.reference)))invalid();
 const reasons=input.expectedRevision===0?REFUND_INTAKE_REASON_CODES:REFUND_FOLLOW_UP_REASON_CODES;
 if(!reasons.includes(input.reason))invalid();
 return input;
}

export async function handleBillingRefundIntakeRequest(request,{db,now=Date.now,identityProviders={},deviceContext,billingSimulation}={}){
 const url=new URL(request.url),access=url.pathname===ACCESS,match=ORDER.exec(url.pathname);
 if(!access&&!match)return null;
 if(url.hash||url.href.endsWith('?')||((access||request.method==='POST')&&url.search))invalid();
 if(access?request.method!=='GET':!['GET','POST'].includes(request.method))return allow(access?'GET':'GET, POST');
 const options={db,now,identityProviders,deviceContext};
 const actor=heldDevice(request,options);
 const authority=billingSimulation?.refundIntake===true?grant(db,actor.userId):null;
 if(access)return json({canReview:!!authority});
 if(!authority)deny();
 const [,kind,orderId]=match;
 if(!matches(UUID,orderId))deny();

 const ensureCurrent=()=>{
  const current=heldDevice(request,options);
  if(current.userId!==actor.userId||current.token!==actor.token||current.leaseId!==actor.leaseId||current.stamp!==actor.stamp)deviceConflict();
  const rights=grant(db,current.userId);
  if(!rights)deny();
  if(rights.revision!==authority.revision||rights.credential_revision!==authority.credential_revision||rights.password_hash!==authority.password_hash)conflict();
 };
 if(request.method==='GET'){
  const beforeRevision=page(url);
  return transaction(db,()=>{
   ensureCurrent();
   return json(detail(db,kind,orderId,beforeRevision));
  });
 }
 const input=await readIntake(request);
 ensureCurrent();
 if(target(db,kind,orderId).confirmedAt===null)paymentRequired();
 const bucket=createHash('sha256').update(actor.userId).digest('hex');
 consume(db,'billing-refund-intake:'+bucket,serverTime(now),15*60000,60);
 return limitedPasswordWork(db,async()=>{
  const verified=await verifyPassword(input.currentPassword,authority.password_hash);
  ensureCurrent();
  if(!verified)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
  return transaction(db,()=>{
   ensureCurrent();
   if(target(db,kind,orderId).confirmedAt===null)paymentRequired();
   appendBillingRefundIntake(db,{kind,orderId,requestId:input.requestId,expectedRevision:input.expectedRevision,
    reason:input.reason,reference:input.reference??null,actorId:actor.userId,authorityRevision:authority.revision},{now});
   ensureCurrent();
   return json(detail(db,kind,orderId),200);
  });
 });
}
