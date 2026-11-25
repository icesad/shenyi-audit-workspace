import {createHash} from 'node:crypto';
import {ApiError,ID,deny,invalid} from './http-utils.mjs';
import {readAnnualOrder} from './billing-store.mjs';
import {readSeatOrder} from './seat-order-store.mjs';

export const REFUND_INTAKE_REASON_CODES=Object.freeze(['duplicate-payment','purchase-change','service-issue','other']);
export const REFUND_FOLLOW_UP_REASON_CODES=Object.freeze(['payment-checked','details-requested','customer-contacted','other']);
export const BILLING_REFUND_REFERENCE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

const PAGE_SIZE=20;
const MAX_REVISION=Number.MAX_SAFE_INTEGER;
const MAX_TIME=8640000000000000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const matches=(pattern,value)=>typeof value==='string'&&pattern.exec(value)?.[0]===value;
const integer=(value,min=0,max=MAX_REVISION)=>Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=min&&value<=max;
const isReference=value=>value===null||matches(BILLING_REFUND_REFERENCE,value);
const isReason=(revision,reason)=>(revision===1?REFUND_INTAKE_REASON_CODES:REFUND_FOLLOW_UP_REASON_CODES).includes(reason);
const conflict=()=>{throw new ApiError(409,'BILLING_REFUND_INTAKE_CONFLICT','退款受理记录已变化，请重新查阅原订单。');};
const paymentRequired=()=>{throw new ApiError(409,'BILLING_REFUND_INTAKE_PAYMENT_REQUIRED','尚无该订单的已核验收款记录。');};

function originalFacts(db,kind,orderId){
  if(!['annual','seat'].includes(kind)||!matches(UUID,orderId))invalid();
  const orders=kind==='annual'?'team_annual_orders':'team_seat_orders';
  const captures=kind==='annual'?'team_annual_verified_payments':'team_seat_verified_payments';
  const row=db.prepare('SELECT team_id FROM '+orders+' WHERE order_id=?').get(orderId);
  if(!row)deny();
  if(!matches(ID,row.team_id))conflict();
  const readOrder=kind==='annual'?readAnnualOrder:readSeatOrder;
  const order=readOrder(db,row.team_id,orderId);
  if(!order)conflict();
  const capture=db.prepare('SELECT payment_id, confirmed_at FROM '+captures+' WHERE team_id=? AND order_id=?').get(row.team_id,orderId);
  if(capture?(!matches(UUID,capture.payment_id)||capture.confirmed_at!==order.confirmedAt):order.confirmedAt!==null)conflict();
  return {
    paymentId:capture?.payment_id??null,
    target:Object.freeze({
      id:order.id,kind,teamId:order.teamId,amountMinor:order.offer.amountMinor,currency:order.offer.currency,
      status:order.status,confirmedAt:order.confirmedAt,paymentException:!!order.paymentException,
      ...(order.closure?{closure:order.closure}:{}),
    }),
  };
}

export function readBillingRefundTarget(db,kind,orderId){
  return originalFacts(db,kind,orderId).target;
}

const digest=record=>createHash('sha256').update(JSON.stringify(record)).digest('hex');

function verifyEvent(row,{target,paymentId}){
  const record={
    kind:row.order_kind,orderId:row.order_id,teamId:row.team_id,paymentId:row.payment_id,
    requestId:row.request_id,revision:row.revision,actorId:row.actor_id,authorityRevision:row.authority_revision,
    reason:row.reason,reference:row.reference,recordedAt:row.recorded_at,
  };
  if(!paymentId||record.kind!==target.kind||record.orderId!==target.id||record.teamId!==target.teamId
    ||record.paymentId!==paymentId||!matches(UUID,record.requestId)||!integer(record.revision,1)
    ||!matches(ID,record.actorId)||!integer(record.authorityRevision,1)||!isReason(record.revision,record.reason)
    ||!isReference(record.reference)||!integer(record.recordedAt,target.confirmedAt,MAX_TIME)
    ||!matches(SHA,row.record_sha256)||digest(record)!==row.record_sha256)conflict();
  return record;
}

function entry(record){
  return Object.freeze({
    revision:record.revision,kind:record.revision===1?'intake':'follow-up',reason:record.reason,
    reference:record.reference,recordedAt:record.recordedAt,recordedBy:record.actorId,
  });
}

function head(db,facts){
  const {kind,id}=facts.target;
  const row=db.prepare(`SELECT * FROM team_billing_refund_intake_events
    WHERE order_kind=? AND order_id=? ORDER BY revision DESC LIMIT 1`).get(kind,id);
  return row?verifyEvent(row,facts):null;
}

export function readBillingRefundIntake(db,kind,orderId,{beforeRevision}={}){
  if(beforeRevision!==undefined&&!integer(beforeRevision,1))invalid();
  const facts=originalFacts(db,kind,orderId),latest=head(db,facts);
  const revision=latest?.revision??0;
  if(beforeRevision!==undefined&&beforeRevision>revision)invalid();
  const before=beforeRevision===undefined?[]:[beforeRevision];
  const rows=db.prepare(`SELECT * FROM team_billing_refund_intake_events WHERE order_kind=? AND order_id=?
    ${before.length?'AND revision < ?':''} ORDER BY revision DESC LIMIT ?`).all(kind,orderId,...before,PAGE_SIZE+1);
  let expected=beforeRevision===undefined?revision:beforeRevision-1;
  if(rows.length!==Math.min(expected,PAGE_SIZE+1))conflict();
  let newerAt=latest?.recordedAt??MAX_TIME;
  const entries=rows.map(row=>{
    const record=verifyEvent(row,facts);
    if(record.revision!==expected--||record.recordedAt>newerAt)conflict();
    newerAt=record.recordedAt;
    return entry(record);
  });
  const more=entries.length>PAGE_SIZE;
  if(more)entries.pop();
  return Object.freeze({revision,entries:Object.freeze(entries),nextBeforeRevision:more?entries.at(-1).revision:null});
}

function requireAuthority(db,actorId,authorityRevision){
  const active=db.prepare(`SELECT 1 FROM team_billing_refund_intake_reviewers reviewer
    JOIN team_users user ON user.user_id=reviewer.user_id AND user.status='active'
    JOIN team_credentials credential ON credential.user_id=reviewer.user_id
    WHERE reviewer.user_id=? AND reviewer.permission='billing.refund-intake'
      AND reviewer.status='active' AND reviewer.revision=?
      AND NOT EXISTS(SELECT 1 FROM team_memberships WHERE user_id=reviewer.user_id)
      AND NOT EXISTS(SELECT 1 FROM team_operators WHERE user_id=reviewer.user_id)`).get(actorId,authorityRevision);
  if(!active)deny();
}

export function appendBillingRefundIntake(db,input,{now=Date.now}={}){
  if(db.isTransaction!==true)conflict();
  if(!input||typeof now!=='function')invalid();
  const {kind,orderId,requestId,expectedRevision,actorId,authorityRevision,reason,reference=null}=input;
  if(!matches(UUID,requestId)||!integer(expectedRevision,0,MAX_REVISION-1)||!matches(ID,actorId)
    ||!integer(authorityRevision,1)||!isReason(expectedRevision+1,reason)||!isReference(reference))invalid();
  requireAuthority(db,actorId,authorityRevision);
  const facts=originalFacts(db,kind,orderId);
  if(!facts.paymentId)paymentRequired();
  const prior=db.prepare('SELECT * FROM team_billing_refund_intake_events WHERE request_id=?').get(requestId);
  if(prior){
    const saved=verifyEvent(prior,facts);
    if(saved.actorId!==actorId||saved.revision!==expectedRevision+1||saved.reason!==reason||saved.reference!==reference)conflict();
    return entry(saved);
  }
  const latest=head(db,facts);
  if((latest?.revision??0)!==expectedRevision)conflict();
  const recordedAt=now();
  if(!integer(recordedAt,latest?.recordedAt??facts.target.confirmedAt,MAX_TIME))conflict();
  const record={
    kind,orderId,teamId:facts.target.teamId,paymentId:facts.paymentId,
    requestId,revision:expectedRevision+1,actorId,authorityRevision,reason,reference,recordedAt,
  };
  const inserted=db.prepare(`INSERT INTO team_billing_refund_intake_events(
    order_kind,order_id,team_id,payment_id,request_id,revision,actor_id,authority_revision,reason,reference,recorded_at,record_sha256
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(kind,orderId,record.teamId,record.paymentId,
    requestId,record.revision,actorId,authorityRevision,reason,reference,recordedAt,digest(record));
  if(inserted.changes!==1)conflict();
  const saved=head(db,facts);
  if(!saved||saved.requestId!==requestId)conflict();
  return entry(saved);
}
