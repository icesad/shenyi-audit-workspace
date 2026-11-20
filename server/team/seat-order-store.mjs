import {randomUUID,createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {ApiError,ID,deny,invalid} from './http-utils.mjs';
import {readSubscriptionState} from './subscription-store.mjs';
import {addBeijingCalendarYear} from './renewal-calendar.mjs';
import {recordSeatCapacityGrantWithinTransaction,readSeatCapacity} from './seat-capacity-store.mjs';
import {validateSimulationPaymentReceipt,simulationReceiptBytes} from './billing-simulation.mjs';
import {assertBillingCaptureCompatible,assertBillingPaymentFulfillable,readBillingPaymentException} from './billing-payment-exception-store.mjs';
import {readBillingOrderClosure,assertBillingClosureEventUnused,assertBillingOrderOpenForFulfilment} from './billing-order-closure-store.mjs';

const MAX=Number.MAX_SAFE_INTEGER,DATE_MAX=8640000000000000,PRODUCT='team-seat-addition',TTL=15*60*1000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/;
const CREATE=['teamId','actorId','requestId','merchantId','offer','quantity'],OFFER=['id','revision','annualUnitAmountMinor','currency'];
const integer=(v,min=0,max=MAX)=>typeof v==='number'&&Number.isSafeInteger(v)&&!Object.is(v,-0)&&v>=min&&v<=max;
const matches=(re,v)=>typeof v==='string'&&re.exec(v)?.[0]===v;
const digest=v=>createHash('sha256').update(v).digest('hex');
const conflict=()=>{throw new ApiError(409,'SEAT_ORDER_CONFLICT','模拟席位订单或收款记录无法核实，请核对原回执。');};
const reconcile=()=>{throw new ApiError(409,'SEAT_ORDER_RECONCILIATION_REQUIRED','模拟收款已保存，当前报价或期限不允许自动发放席位，请核对处理。');};
function fields(value,keys){
 if(!value||typeof value!=='object'||isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)invalid();const ds=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(ds);
 if(actual.length!==keys.length||actual.some(k=>typeof k!=='string'||!keys.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))invalid();return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
function seatSelection({teamId,offer:value,quantity}){
 const offer=fields(value,OFFER);
 if(!matches(ID,teamId)||!matches(ID,offer.id)||!integer(offer.revision,1)||
    !integer(offer.annualUnitAmountMinor,1)||offer.currency!=='CNY'||!integer(quantity,1,1000))invalid();
 return{teamId,offer,quantity};
}
function createInput(value){
 const v=fields(value,CREATE),selection=seatSelection(v);
 if(!matches(ID,v.actorId)||!matches(UUID,v.requestId)||!matches(ID,v.merchantId))invalid();
 return{teamId:selection.teamId,actorId:v.actorId,requestId:v.requestId,merchantId:v.merchantId,
  offer:selection.offer,quantity:selection.quantity};
}
function at(now){if(typeof now!=='function')invalid();const time=now();if(!integer(time,0,DATE_MAX))conflict();return time;}
function stored(v,min=0,max=MAX){if(typeof v!=='bigint'||v<BigInt(min)||v>BigInt(max))conflict();return Number(v);}
function one(db,sql,...args){const q=db.prepare(sql);q.setReadBigInts(true);return q.get(...args);}
function all(db,sql,...args){const q=db.prepare(sql);q.setReadBigInts(true);return q.all(...args);}
function own(db,work){
 if(db.isTransaction===true)conflict();
 let began=false;
 try{
  db.exec('BEGIN IMMEDIATE');
  began=true;
  const result=work();
  db.exec('COMMIT');
  began=false;
  return result;
 }catch(error){
  if(began)try{db.exec('ROLLBACK');}catch{}
  if(error instanceof ApiError)throw error;
  if(typeof error?.errcode==='number'&&[5,6,19].includes(error.errcode&255))conflict();
  throw error;
 }
}
function teamId(v){if(!matches(ID,v))invalid();return v;}
function orderId(v){if(!matches(UUID,v))invalid();return v;}
const baseOf=order=>Object.fromEntries(CREATE.map(k=>[k,order[k]]));
const locked=(v,revision,startsAt,endsAt,createdAt)=>({...v,termRevision:revision,termStartsAt:startsAt,termEndsAt:endsAt,createdAt});
function price(v,createdAt,endsAt){
 const remaining=endsAt-createdAt;
 if(!integer(remaining,1))conflict();
 let yearEnd;
 try{yearEnd=addBeijingCalendarYear(createdAt);}catch{conflict();}
 const denominator=BigInt(yearEnd-createdAt);
 const numerator=BigInt(v.offer.annualUnitAmountMinor)*BigInt(v.quantity)*BigInt(remaining);
 const amount=(numerator+denominator-1n)/denominator;
 if(amount<1n||amount>BigInt(MAX))conflict();
 return Number(amount);
}
function orderPricing(db,selection,createdAt){
 const term=readSubscriptionState(db,selection.teamId,createdAt);
 if(term.state!=='active')throw new ApiError(402,'SUBSCRIPTION_WRITE_UNAVAILABLE','当前团队订阅不允许新增或修改业务资料。');
 return{
  amountMinor:price(selection,createdAt,term.endsAt),
  quoteExpiresAt:Math.min(createdAt+TTL,term.endsAt),
  termRevision:term.revision,termStartsAt:term.startsAt,termEndsAt:term.endsAt,
 };
}
export function readSeatOrderQuote(db,value,{now=Date.now}={}){
 return orderPricing(db,seatSelection(fields(value,['teamId','offer','quantity'])),at(now));
}
function termFact(db,team,revision){
 const row=one(db,'SELECT * FROM team_subscription_events WHERE team_id=? AND revision=?',team,revision);if(!row||!matches(UUID,row.operation_id)||!matches(SHA,row.request_sha256)||typeof row.source_ref!=='string'||!row.source_ref.isWellFormed()||[...row.source_ref].length<1||[...row.source_ref].length>128||/[\p{Cc}\p{Cf}]/u.test(row.source_ref))conflict();
 const value={teamId:row.team_id,operationId:row.operation_id,revision:stored(row.revision,1),startsAt:stored(row.starts_at,0,DATE_MAX),endsAt:stored(row.ends_at,0,DATE_MAX),recordedAt:stored(row.recorded_at),sourceRef:row.source_ref};
 const input={teamId:value.teamId,operationId:value.operationId,expectedRevision:value.revision-1,startsAt:value.startsAt,endsAt:value.endsAt,sourceRef:value.sourceRef};
 if(value.teamId!==team||value.revision!==revision||value.endsAt<=value.startsAt||digest(JSON.stringify(input))!==row.request_sha256)conflict();return value;
}
function orderValue(db,row){
 if(!row)return null;
 let v;
 try{
  v=createInput({
   teamId:row.team_id,actorId:row.actor_id,requestId:row.request_id,merchantId:row.merchant_id,
   offer:{
    id:row.offer_id,revision:stored(row.offer_revision,1),
    annualUnitAmountMinor:stored(row.annual_unit_amount_minor,1),currency:row.currency,
   },
   quantity:stored(row.quantity,1,1000),
  });
 }catch{conflict();}
 const createdAt=stored(row.created_at,0,DATE_MAX);
 const termRevision=stored(row.term_revision,1);
 const termStartsAt=stored(row.term_starts_at,0,DATE_MAX);
 const termEndsAt=stored(row.term_ends_at,0,DATE_MAX);
 const quoteExpiresAt=stored(row.quote_expires_at,0,DATE_MAX);
 const amountMinor=stored(row.amount_minor,1);
 const source=termFact(db,v.teamId,termRevision);
 if(!matches(UUID,row.order_id)||row.environment!=='simulation-v1'||!matches(SHA,row.request_sha256)
  ||createdAt<termStartsAt||createdAt>=termEndsAt
  ||source.startsAt!==termStartsAt||source.endsAt!==termEndsAt
  ||quoteExpiresAt!==Math.min(createdAt+TTL,termEndsAt)
  ||amountMinor!==price(v,createdAt,termEndsAt)
  ||digest(JSON.stringify(locked(v,termRevision,termStartsAt,termEndsAt,createdAt)))!==row.request_sha256)conflict();
 return{...v,id:row.order_id,createdAt,termRevision,termStartsAt,termEndsAt,quoteExpiresAt,amountMinor,requestSha256:row.request_sha256};
}
const orderFact=(db,id)=>orderValue(db,one(db,'SELECT * FROM team_seat_orders WHERE order_id=?',id));
function matchesOrder(order,receipt){if(receipt.orderId!==order.id||receipt.merchantId!==order.merchantId||receipt.product!==PRODUCT||receipt.amountMinor!==order.amountMinor||receipt.currency!==order.offer.currency)conflict();}
function noAnnualCollision(db,receipt){if(one(db,'SELECT 1 FROM team_annual_verified_payments WHERE event_id=? OR transaction_id=?',receipt.eventId,receipt.transactionId))conflict();}
function paymentValue(db,row,order){
 if(!row)return null;
 if(typeof row.receipt_json!=='string'||Buffer.byteLength(row.receipt_json)>16384)conflict();
 let receipt;
 try{receipt=validateSimulationPaymentReceipt(JSON.parse(row.receipt_json));}catch{conflict();}
 const bytes=simulationReceiptBytes(receipt);
 if(!matches(UUID,row.payment_id)||row.order_id!==order.id||row.team_id!==order.teamId
  ||row.event_id!==receipt.eventId||row.transaction_id!==receipt.transactionId
  ||!matches(SHA,row.receipt_sha256)||row.receipt_json!==bytes.toString('utf8')
  ||digest(bytes)!==row.receipt_sha256)conflict();
 matchesOrder(order,receipt);
 noAnnualCollision(db,receipt);
 const confirmedAt=stored(row.confirmed_at,0,DATE_MAX);
 if(receipt.paidAt<order.createdAt||receipt.paidAt>confirmedAt)conflict();
 return Object.freeze({paymentId:row.payment_id,orderId:order.id,teamId:order.teamId,confirmedAt,receipt,receiptSha256:row.receipt_sha256});
}
const paymentFact=(db,order)=>paymentValue(db,one(db,'SELECT * FROM team_seat_verified_payments WHERE order_id=?',order.id),order);
function grantFact(db,order,payment){
 const row=one(db,'SELECT * FROM team_seat_capacity_grants WHERE grant_id=?',order.id);
 if(!row)return null;
 if(!payment)conflict();
 const request={
  grantId:row.grant_id,teamId:row.team_id,seats:stored(row.seats,1),
  startsAt:stored(row.starts_at),endsAt:stored(row.ends_at),sourceRef:row.source_ref,
 };
 const recordedAt=stored(row.recorded_at);
 if(request.grantId!==order.id||request.teamId!==order.teamId||request.seats!==order.quantity
  ||request.startsAt!==payment.confirmedAt||request.endsAt!==order.termEndsAt
  ||request.sourceRef!=='simulation-seat:'+order.id||payment.receipt.paidAt>=order.quoteExpiresAt||recordedAt<payment.confirmedAt
  ||recordedAt>=order.termEndsAt||!matches(SHA,row.request_sha256)
  ||digest(JSON.stringify(request))!==row.request_sha256)conflict();
 return Object.freeze({grantId:order.id,seats:request.seats,startsAt:request.startsAt,endsAt:request.endsAt,recordedAt});
}
function view(db,order){
 const payment=paymentFact(db,order),grant=grantFact(db,order,payment);
 const paymentException=readBillingPaymentException(db,PRODUCT,order.id);
 const closure=readBillingOrderClosure(db,PRODUCT,order.id);
 if(closure&&(grant||payment&&payment.confirmedAt<closure.closedAt))conflict();
 return Object.freeze({
  id:order.id,teamId:order.teamId,actorId:order.actorId,requestId:order.requestId,merchantId:order.merchantId,
  offer:Object.freeze({id:order.offer.id,revision:order.offer.revision,product:PRODUCT,amountMinor:order.amountMinor,currency:order.offer.currency}),
  quantity:order.quantity,annualUnitAmountMinor:order.offer.annualUnitAmountMinor,
  quoteExpiresAt:order.quoteExpiresAt,termStartsAt:order.termStartsAt,termEndsAt:order.termEndsAt,termRevision:order.termRevision,
  simulation:true,createdAt:order.createdAt,status:grant?'paid':payment?'payment-verified':closure?'closed':'pending',
  confirmedAt:payment?.confirmedAt??null,grant,...(paymentException?{paymentException}:{}),...(closure?{closure}:{}),
 });
}

export function createSeatOrderWithinTransaction(db,value,{now=Date.now}={}){
 const v=createInput(value);
 if(db.isTransaction!==true)conflict();
 if(typeof now!=='function')invalid();
 if(!one(db,"SELECT 1 FROM teams WHERE team_id=? AND status='active'",v.teamId)||!one(db,"SELECT 1 FROM team_users WHERE user_id=? AND status='active'",v.actorId))deny();
 const prior=orderValue(db,one(db,'SELECT * FROM team_seat_orders WHERE team_id=? AND request_id=?',v.teamId,v.requestId));
 if(prior){
  if(JSON.stringify(baseOf(prior))!==JSON.stringify(v))conflict();
  return view(db,prior);
 }
 const createdAt=at(now);
 const {amountMinor,quoteExpiresAt,termRevision,termStartsAt,termEndsAt}=orderPricing(db,v,createdAt);
 const hash=digest(JSON.stringify(locked(v,termRevision,termStartsAt,termEndsAt,createdAt)));
 const id=randomUUID();
 if(one(db,'SELECT 1 FROM team_annual_orders WHERE order_id=?',id)||one(db,'SELECT 1 FROM team_seat_capacity_grants WHERE grant_id=?',id))conflict();
 const result=db.prepare('INSERT INTO team_seat_orders(order_id,team_id,actor_id,request_id,merchant_id,offer_id,offer_revision,annual_unit_amount_minor,amount_minor,quantity,currency,environment,created_at,quote_expires_at,term_revision,term_starts_at,term_ends_at,request_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
  id,v.teamId,v.actorId,v.requestId,v.merchantId,v.offer.id,v.offer.revision,
  v.offer.annualUnitAmountMinor,amountMinor,v.quantity,v.offer.currency,'simulation-v1',
  createdAt,quoteExpiresAt,termRevision,termStartsAt,termEndsAt,hash,
 );
 if(result.changes!==1)conflict();
 const saved=orderFact(db,id);
 if(!saved||saved.requestSha256!==hash)conflict();
 return view(db,saved);
}
export function readSeatOrder(db,team,order){teamId(team);orderId(order);const row=orderValue(db,one(db,'SELECT * FROM team_seat_orders WHERE team_id=? AND order_id=?',team,order));return row?view(db,row):null;}
export function readSeatOrderRequest(db,team,actor,request){teamId(team);if(!matches(ID,actor)||!matches(UUID,request))invalid();const row=orderValue(db,one(db,'SELECT * FROM team_seat_orders WHERE team_id=? AND actor_id=? AND request_id=?',team,actor,request));return row?view(db,row):null;}
export function listSeatOrders(db,team,{limit=20,after=null}={}){teamId(team);if(!integer(limit,1,50)||after!==null&&!matches(UUID,after))invalid();if(after!==null&&!one(db,'SELECT 1 FROM team_seat_orders WHERE team_id=? AND order_id=?',team,after))deny();const rows=all(db,'SELECT * FROM team_seat_orders WHERE team_id=? AND order_id COLLATE BINARY>? ORDER BY order_id COLLATE BINARY LIMIT ?',team,after??'',limit+1);return{orders:rows.slice(0,limit).map(row=>view(db,orderValue(db,row))),hasMore:rows.length>limit};}

// Only an authenticated trusted gateway adapter may supply this exact receipt.
// Save the verified inbox before attempting fulfilment, including late receipts.
export function recordVerifiedSeatPayment(db,receipt,{now=Date.now,authorize,onRecorded}={}){
 const value=validateSimulationPaymentReceipt(receipt);
 const bytes=simulationReceiptBytes(value),hash=digest(bytes);
 if(typeof now!=='function')invalid();
 return own(db,()=>{
  authorize?.();
  const order=orderFact(db,value.orderId);
  if(!order)deny();
  matchesOrder(order,value);
  assertBillingClosureEventUnused(db,value.eventId);
  assertBillingCaptureCompatible(db,value);
  noAnnualCollision(db,value);
  const collisions=all(db,'SELECT * FROM team_seat_verified_payments WHERE order_id=? OR event_id=? OR transaction_id=?',value.orderId,value.eventId,value.transactionId);
  if(collisions.length){
   if(collisions.length!==1)conflict();
   const prior=paymentValue(db,collisions[0],order);
   if(prior.receiptSha256!==hash)conflict();
   onRecorded?.(prior);
   return prior;
  }
  if(one(db,'SELECT 1 FROM team_seat_capacity_grants WHERE grant_id=?',order.id))conflict();
  const closure=readBillingOrderClosure(db,PRODUCT,order.id);
  const confirmedAt=at(now);
  if(value.paidAt<order.createdAt||value.paidAt>confirmedAt||closure&&confirmedAt<closure.closedAt)conflict();
  const id=randomUUID();
  const inserted=db.prepare('INSERT INTO team_seat_verified_payments(payment_id,order_id,team_id,event_id,transaction_id,receipt_json,receipt_sha256,confirmed_at) VALUES (?,?,?,?,?,?,?,?)').run(
   id,order.id,order.teamId,value.eventId,value.transactionId,bytes.toString('utf8'),hash,confirmedAt,
  );
  if(inserted.changes!==1)conflict();
  const saved=paymentFact(db,order);
  if(!saved||saved.paymentId!==id||saved.confirmedAt!==confirmedAt||saved.receiptSha256!==hash
   ||one(db,'SELECT 1 FROM team_seat_capacity_grants WHERE grant_id=?',order.id))conflict();
  onRecorded?.(saved);
  return saved;
 });
}
export function fulfilSeatOrder(db,id,{now=Date.now,authorize,onFulfilled}={}){
 orderId(id);
 if(typeof now!=='function')invalid();
 return own(db,()=>{
  authorize?.();
  const order=orderFact(db,id);
  if(!order)deny();
  const payment=paymentFact(db,order);
  if(!payment)conflict();
  const prior=grantFact(db,order,payment);
  if(prior){
   const result={order:view(db,order),grant:prior};
   authorize?.();
   onFulfilled?.(result);
   return result;
  }
  assertBillingOrderOpenForFulfilment(db,PRODUCT,order.id);
  assertBillingPaymentFulfillable(db,payment.receipt);
  let latest=payment.confirmedAt;
  const fresh=()=>{
   const time=at(now);
   if(time<latest)conflict();
   latest=time;
   if(payment.receipt.paidAt>=order.quoteExpiresAt||time>=order.termEndsAt)reconcile();
   let current;
   try{current=readSubscriptionState(db,order.teamId,time);}catch(error){
    if(error instanceof ApiError&&error.status===404)reconcile();
    throw error;
   }
   if(current.startsAt===null||current.startsAt>payment.confirmedAt||current.endsAt<order.termEndsAt)reconcile();
   return time;
  };
  const time=fresh();
  const written=recordSeatCapacityGrantWithinTransaction(db,{
   grantId:order.id,teamId:order.teamId,seats:order.quantity,
   startsAt:payment.confirmedAt,endsAt:order.termEndsAt,sourceRef:'simulation-seat:'+order.id,
  },{now:()=>time});
  const finalTime=fresh();
  readSeatCapacity(db,order.teamId,finalTime);
  const finalOrder=orderFact(db,id),finalPayment=paymentFact(db,finalOrder);
  const grant=grantFact(db,finalOrder,finalPayment);
  if(finalOrder.requestSha256!==order.requestSha256||finalPayment.paymentId!==payment.paymentId
   ||!grant||grant.recordedAt!==written.recordedAt)conflict();
  fresh();
  const result={order:view(db,finalOrder),grant};
  authorize?.();
  onFulfilled?.(result);
  return result;
 });
}
