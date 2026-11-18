import {randomUUID,createHash} from 'node:crypto';
import {isProxy} from 'node:util/types';
import {ApiError,ID,deny,invalid} from './http-utils.mjs';
import {appendSubscriptionTermWithinTransaction,readSubscriptionState} from './subscription-store.mjs';
import {annualRenewalWindow} from './renewal-calendar.mjs';
import {ANNUAL_PRODUCT,validateSimulationPaymentReceipt,simulationReceiptBytes} from './billing-simulation.mjs';
import {readSeatCapacity,recordSeatCapacityGrantWithinTransaction} from './seat-capacity-store.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,SHA=/^[0-9a-f]{64}$/,MAX=Number.MAX_SAFE_INTEGER,DATE_MAX=8640000000000000;
const CREATE=['teamId','actorId','requestId','merchantId','offer'],OFFER=['id','revision','product','amountMinor','currency'];
const matches=(re,value)=>typeof value==='string'&&re.exec(value)?.[0]===value;
const integer=(value,min=0,max=MAX)=>typeof value==='number'&&Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=min&&value<=max;
const digest=value=>createHash('sha256').update(value).digest('hex');
const conflict=()=>{throw new ApiError(409,'BILLING_CONFLICT','模拟订单或收款记录无法核实，请核对原回执。');};
function fields(value,keys){
 if(!value||isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)invalid();
 const ds=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(ds);
 if(actual.length!==keys.length||actual.some(key=>typeof key!=='string'||!keys.includes(key)||!ds[key].enumerable||!Object.hasOwn(ds[key],'value')))invalid();
 return Object.fromEntries(keys.map(key=>[key,ds[key].value]));
}
function createInput(input){const v=fields(input,CREATE),offer=fields(v.offer,OFFER);
 if(!matches(ID,v.teamId)||!matches(ID,v.actorId)||!matches(UUID,v.requestId)||!matches(ID,v.merchantId)||!matches(ID,offer.id)||!integer(offer.revision,1)||offer.product!=='team-annual-renewal'||!integer(offer.amountMinor,1)||offer.currency!=='CNY')invalid();
 return{teamId:v.teamId,actorId:v.actorId,requestId:v.requestId,merchantId:v.merchantId,offer};
}
function at(now){if(typeof now!=='function')invalid();const value=now();if(!integer(value,0,DATE_MAX))conflict();return value;}
function stored(value,min=0,max=MAX){if(typeof value!=='bigint'||value<BigInt(min)||value>BigInt(max))conflict();return Number(value);}
function one(db,sql,...args){const s=db.prepare(sql);s.setReadBigInts(true);return s.get(...args);}
function all(db,sql,...args){const s=db.prepare(sql);s.setReadBigInts(true);return s.all(...args);}
function ownTransaction(db,work){if(db.isTransaction===true)conflict();let began=false;try{db.exec('BEGIN IMMEDIATE');began=true;const result=work();db.exec('COMMIT');began=false;return result;}catch(error){if(began)try{db.exec('ROLLBACK');}catch{}if(error instanceof ApiError)throw error;if(typeof error?.errcode==='number'&&[5,6,19].includes(error.errcode&255))conflict();throw error;}}
function requireTeamId(teamId){if(!matches(ID,teamId))invalid();return teamId;}
function requireOrderId(orderId){if(!matches(UUID,orderId))invalid();return orderId;}
function orderValue(db,row){
 if(!row)return null;
 const input={teamId:row.team_id,actorId:row.actor_id,requestId:row.request_id,merchantId:row.merchant_id,offer:{id:row.offer_id,revision:stored(row.offer_revision,1),product:row.product,amountMinor:stored(row.amount_minor,1),currency:row.currency}};
 let v;try{v=createInput(input);}catch{conflict();}
 if(!matches(UUID,row.order_id)||!matches(UUID,row.term_operation_id)||row.environment!=='simulation-v1'||!matches(SHA,row.request_sha256))conflict();
 const order={...v,id:row.order_id,termOperationId:row.term_operation_id,createdAt:stored(row.created_at,0,DATE_MAX),requestSha256:row.request_sha256};
 const plan=seatPlanFact(db,order);
 if(!plan&&digest(JSON.stringify(v))!==row.request_sha256)conflict();
 return order;
}
function orderFact(db,orderId){return orderValue(db,one(db,'SELECT * FROM team_annual_orders WHERE order_id=?',orderId));}
function matchesOrder(order,receipt){if(receipt.orderId!==order.id||receipt.merchantId!==order.merchantId||receipt.product!==order.offer.product||receipt.amountMinor!==order.offer.amountMinor||receipt.currency!==order.offer.currency)conflict();}
function paymentValue(row,order){
 if(!row)return null;let receipt;try{receipt=validateSimulationPaymentReceipt(JSON.parse(row.receipt_json));}catch{conflict();}
 const bytes=simulationReceiptBytes(receipt);
 if(!matches(UUID,row.payment_id)||!matches(SHA,row.receipt_sha256)||row.receipt_json!==bytes.toString('utf8')||digest(bytes)!==row.receipt_sha256||row.order_id!==order.id||row.team_id!==order.teamId||row.event_id!==receipt.eventId||row.transaction_id!==receipt.transactionId)conflict();matchesOrder(order,receipt);
 const confirmedAt=stored(row.confirmed_at,0,DATE_MAX);if(confirmedAt<order.createdAt)conflict();
 return Object.freeze({paymentId:row.payment_id,orderId:order.id,teamId:order.teamId,confirmedAt,receipt,receiptSha256:row.receipt_sha256});
}
function paymentFact(db,order){return paymentValue(one(db,'SELECT * FROM team_annual_verified_payments WHERE order_id=?',order.id),order);}
function termReceipt(db,teamId,revision){
 const row=one(db,'SELECT * FROM team_subscription_events WHERE team_id=? AND revision=?',teamId,revision);if(!row||!matches(UUID,row.operation_id)||!matches(SHA,row.request_sha256)||typeof row.source_ref!=='string')conflict();
 const value={teamId:row.team_id,operationId:row.operation_id,revision:stored(row.revision,1),startsAt:stored(row.starts_at),endsAt:stored(row.ends_at),recordedAt:stored(row.recorded_at),sourceRef:row.source_ref};
 const input={teamId:value.teamId,operationId:value.operationId,expectedRevision:value.revision-1,startsAt:value.startsAt,endsAt:value.endsAt,sourceRef:value.sourceRef};
 if(value.teamId!==teamId||value.revision!==revision||value.endsAt<=value.startsAt||digest(JSON.stringify(input))!==row.request_sha256)conflict();return Object.freeze(value);
}
function fulfilmentValue(db,row,order,payment){
 if(!row)return null;if(!payment||!matches(UUID,row.fulfilment_id)||row.order_id!==order.id||row.payment_id!==payment.paymentId||row.team_id!==order.teamId||row.term_operation_id!==order.termOperationId||row.calendar_version!=='beijing-calendar-year-v1')conflict();
 const beforeRevision=stored(row.before_revision,0,MAX-1),revision=stored(row.subscription_revision,1);if(revision!==beforeRevision+1)conflict();
 const value={id:row.fulfilment_id,orderId:order.id,teamId:order.teamId,operationId:row.term_operation_id,subscriptionRevision:revision,startsAt:stored(row.starts_at,0,DATE_MAX),endsAt:stored(row.ends_at,0,DATE_MAX),renewalStartsAt:stored(row.renewal_starts_at,0,DATE_MAX),confirmedAt:stored(row.confirmed_at,0,DATE_MAX),fulfilledAt:stored(row.fulfilled_at,0,DATE_MAX)};
 if(value.confirmedAt!==payment.confirmedAt||value.fulfilledAt<value.confirmedAt)conflict();const before=beforeRevision?termReceipt(db,order.teamId,beforeRevision):null;
 let window;try{window=annualRenewalWindow(before?{startsAt:before.startsAt,endsAt:before.endsAt}:null,payment.confirmedAt);}catch{conflict();}
 if(['startsAt','endsAt','renewalStartsAt'].some(key=>value[key]!==window[key]))conflict();
 const receipt=termReceipt(db,order.teamId,revision);if(receipt.operationId!==order.termOperationId||receipt.startsAt!==value.startsAt||receipt.endsAt!==value.endsAt||receipt.recordedAt!==value.fulfilledAt||receipt.sourceRef!=='simulation-annual:'+order.id)conflict();return Object.freeze(value);
}
function fulfilmentFact(db,order,payment){return fulfilmentValue(db,one(db,'SELECT * FROM team_annual_fulfilments WHERE order_id=?',order.id),order,payment);}
const PLAN_KEYS=['defaultSeats','selectedSeats','baseAmountMinor','unitAmountMinor','basisRevision','basisEndsAt'];
const PLAN_DOMAIN='shenyi.annual-order-seat-plan.v1';
const seatHold=()=>{throw new ApiError(409,'BILLING_RENEWAL_SEATS_RECONCILIATION_REQUIRED','模拟续费席位数量或区间无法自动匹配，请先释放足够席位或核对待处理订单。');};
function renewalSeatOptions(value){
 if(value===undefined)return null;
 if(!value||typeof value!=='object'||isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)invalid();
 const ds=Object.getOwnPropertyDescriptors(value),keys=Object.hasOwn(ds,'selectedSeats')?['unitAmountMinor','selectedSeats']:['unitAmountMinor'];
 const v=fields(value,keys);
 if(!integer(v.unitAmountMinor,1)||Object.hasOwn(v,'selectedSeats')&&!integer(v.selectedSeats))invalid();
 return v;
}
function pricedAmount(base,unit,seats){
 const total=BigInt(base)+BigInt(unit)*BigInt(seats);
 if(total>BigInt(MAX))conflict();
 return Number(total);
}
function plannedOrderHash(input,plan){return digest(JSON.stringify({domain:PLAN_DOMAIN,input,renewalSeats:plan}));}
function planHash(order,plan){return digest(JSON.stringify({
 orderId:order.id,teamId:order.teamId,actorId:order.actorId,requestId:order.requestId,merchantId:order.merchantId,
 offer:order.offer,createdAt:order.createdAt,termOperationId:order.termOperationId,orderRequestSha256:order.requestSha256,renewalSeats:plan,
}));}
function seatPlanFact(db,order){
 const row=one(db,'SELECT * FROM team_annual_order_seat_plans WHERE order_id=?',order.id);
 if(!row)return null;
 const basisRevision=stored(row.basis_revision),basisEndsAt=basisRevision?stored(row.basis_ends_at,1):null;
 if(!basisRevision&&row.basis_ends_at!==null)conflict();
 const plan=Object.freeze({
  defaultSeats:stored(row.default_seats),selectedSeats:stored(row.selected_seats),
  baseAmountMinor:stored(row.base_amount_minor,1),unitAmountMinor:stored(row.unit_amount_minor,1),basisRevision,basisEndsAt,
 });
 if(row.order_id!==order.id||row.team_id!==order.teamId||!matches(SHA,row.request_sha256))conflict();
 if(basisRevision&&termReceipt(db,order.teamId,basisRevision).endsAt!==basisEndsAt)conflict();
 if(pricedAmount(plan.baseAmountMinor,plan.unitAmountMinor,plan.selectedSeats)!==order.offer.amountMinor)conflict();
 const input={teamId:order.teamId,actorId:order.actorId,requestId:order.requestId,merchantId:order.merchantId,offer:order.offer};
 if(plannedOrderHash(input,plan)!==order.requestSha256||planHash(order,plan)!==row.request_sha256)conflict();
 return plan;
}
function annualSeatGrantFact(db,order,plan,payment,fulfilment){
 const row=one(db,'SELECT * FROM team_seat_capacity_grants WHERE grant_id=?',order.id);
 if(!fulfilment){if(row)conflict();return null;}
 if(!plan.selectedSeats){if(row)conflict();return null;}
 if(!row||!payment)conflict();
 const request={grantId:row.grant_id,teamId:row.team_id,seats:stored(row.seats,1),startsAt:stored(row.starts_at),endsAt:stored(row.ends_at),sourceRef:row.source_ref};
 const recordedAt=stored(row.recorded_at);
 if(request.grantId!==order.id||request.teamId!==order.teamId||request.seats!==plan.selectedSeats
  ||request.startsAt!==fulfilment.renewalStartsAt||request.endsAt!==fulfilment.endsAt
  ||recordedAt!==fulfilment.fulfilledAt||request.sourceRef!=='simulation-annual-seats:'+order.id
  ||!matches(SHA,row.request_sha256)||digest(JSON.stringify(request))!==row.request_sha256)conflict();
 return Object.freeze({grantId:order.id,seats:request.seats,startsAt:request.startsAt,endsAt:request.endsAt,recordedAt});
}
function renewalDefaults(db,teamId,time){
 const state=readSubscriptionState(db,teamId,time),committed=readSeatCapacity(db,teamId,time);
 return Object.freeze({defaultSeats:state.revision?readSeatCapacity(db,teamId,state.endsAt-1).purchasedSeats:0,basisRevision:state.revision,basisEndsAt:state.endsAt,committedSeats:committed.usedSeats});
}
export function readAnnualSeatRenewalDefaults(db,teamId,time){
 requireTeamId(teamId);
 if(!integer(time,0,DATE_MAX))invalid();
 if(db.isTransaction===true)return renewalDefaults(db,teamId,time);
 let began=false;
 try{db.exec('BEGIN');began=true;const result=renewalDefaults(db,teamId,time);db.exec('COMMIT');began=false;return result;}
 catch(error){if(began)try{db.exec('ROLLBACK');}catch{}throw error;}
}
function assertSeatWindow(db,order,plan,window,time){
 const capacity=readSeatCapacity(db,order.teamId,time);
 if(plan.selectedSeats<capacity.usedSeats)seatHold();
 if(one(db,`SELECT 1 FROM team_seat_capacity_grants
  WHERE team_id=? AND grant_id<>? AND starts_at<? AND ends_at>? LIMIT 1`,order.teamId,order.id,window.endsAt,window.renewalStartsAt))seatHold();
}
function view(db,order){
 const payment=paymentFact(db,order),fulfilment=fulfilmentFact(db,order,payment),plan=seatPlanFact(db,order);
 const seats=plan?{renewalSeats:plan,renewalSeatGrant:annualSeatGrantFact(db,order,plan,payment,fulfilment)}:{};
 return Object.freeze({id:order.id,teamId:order.teamId,actorId:order.actorId,requestId:order.requestId,merchantId:order.merchantId,offer:Object.freeze({...order.offer}),simulation:true,createdAt:order.createdAt,status:fulfilment?'paid':payment?'payment-verified':'pending',confirmedAt:payment?.confirmedAt??null,fulfilment,...seats});
}

// Trusted service primitive. HTTP caller owns its lease/technical-authority checks.
export function createAnnualOrderWithinTransaction(db,input,{now=Date.now,renewalSeats}={}){
 const v=createInput(input),selection=renewalSeatOptions(renewalSeats);
 if(db.isTransaction!==true)conflict();
 if(typeof now!=='function')invalid();
 if(!one(db,"SELECT 1 FROM teams WHERE team_id=? AND status='active'",v.teamId)||!one(db,"SELECT 1 FROM team_users WHERE user_id=? AND status='active'",v.actorId))deny();
 const prior=orderValue(db,one(db,'SELECT * FROM team_annual_orders WHERE team_id=? AND request_id=?',v.teamId,v.requestId));
 if(prior){
  const plan=seatPlanFact(db,prior);
  if(plan){
   if(!selection||selection.unitAmountMinor!==plan.unitAmountMinor
    ||(selection.selectedSeats??plan.defaultSeats)!==plan.selectedSeats)conflict();
   const original={teamId:prior.teamId,actorId:prior.actorId,requestId:prior.requestId,merchantId:prior.merchantId,offer:{...prior.offer,amountMinor:plan.baseAmountMinor}};
   if(JSON.stringify(original)!==JSON.stringify(v))conflict();
  }else if(selection||prior.requestSha256!==digest(JSON.stringify(v)))conflict();
  return view(db,prior);
 }
 const id=randomUUID(),operationId=randomUUID(),createdAt=at(now);
 if(one(db,'SELECT 1 FROM team_seat_orders WHERE order_id=?',id))conflict();
 let plan=null,priced=v;
 if(selection){
  const defaults=readAnnualSeatRenewalDefaults(db,v.teamId,createdAt);
  const selectedSeats=selection.selectedSeats??defaults.defaultSeats;
  if(selectedSeats<defaults.committedSeats)seatHold();
  plan=Object.freeze({defaultSeats:defaults.defaultSeats,selectedSeats,baseAmountMinor:v.offer.amountMinor,
   unitAmountMinor:selection.unitAmountMinor,basisRevision:defaults.basisRevision,basisEndsAt:defaults.basisEndsAt});
  priced={...v,offer:{...v.offer,amountMinor:pricedAmount(plan.baseAmountMinor,plan.unitAmountMinor,selectedSeats)}};
  if(one(db,'SELECT 1 FROM team_seat_capacity_grants WHERE grant_id=?',id))conflict();
 }
 const hash=plan?plannedOrderHash(priced,plan):digest(JSON.stringify(v));
 const inserted=db.prepare('INSERT INTO team_annual_orders(order_id,team_id,actor_id,request_id,term_operation_id,merchant_id,offer_id,offer_revision,product,amount_minor,currency,environment,created_at,request_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,v.teamId,v.actorId,v.requestId,operationId,v.merchantId,v.offer.id,v.offer.revision,v.offer.product,priced.offer.amountMinor,v.offer.currency,'simulation-v1',createdAt,hash);
 if(inserted.changes!==1)conflict();
 if(plan){
  const order={...priced,id,termOperationId:operationId,createdAt,requestSha256:hash};
  const saved=db.prepare('INSERT INTO team_annual_order_seat_plans(order_id,team_id,default_seats,selected_seats,base_amount_minor,unit_amount_minor,basis_revision,basis_ends_at,request_sha256) VALUES (?,?,?,?,?,?,?,?,?)').run(
   id,v.teamId,plan.defaultSeats,plan.selectedSeats,plan.baseAmountMinor,plan.unitAmountMinor,plan.basisRevision,plan.basisEndsAt,planHash(order,plan));
  if(saved.changes!==1||plan.selectedSeats<readSeatCapacity(db,v.teamId,createdAt).usedSeats)seatHold();
 }
 const result=orderFact(db,id);if(!result||result.requestSha256!==hash||result.createdAt!==createdAt||result.termOperationId!==operationId)conflict();return view(db,result);
}
export function createAnnualOrder(db,input,options={}){createInput(input);return ownTransaction(db,()=>createAnnualOrderWithinTransaction(db,input,options));}
export function readAnnualOrder(db,teamId,orderId){requireTeamId(teamId);requireOrderId(orderId);const order=orderValue(db,one(db,'SELECT * FROM team_annual_orders WHERE team_id=? AND order_id=?',teamId,orderId));return order?view(db,order):null;}
export function readAnnualOrderRequest(db,teamId,actorId,requestId){requireTeamId(teamId);if(!matches(ID,actorId)||!matches(UUID,requestId))invalid();const order=orderValue(db,one(db,'SELECT * FROM team_annual_orders WHERE team_id=? AND actor_id=? AND request_id=?',teamId,actorId,requestId));return order?view(db,order):null;}
export function listAnnualOrders(db,teamId,{limit=20,after=null}={}){
 requireTeamId(teamId);if(!integer(limit,1,50)||after!==null&&!matches(UUID,after))invalid();
 if(after!==null&&!one(db,'SELECT 1 FROM team_annual_orders WHERE team_id=? AND order_id=?',teamId,after))deny();
 const rows=all(db,'SELECT * FROM team_annual_orders WHERE team_id=? AND order_id COLLATE BINARY>? ORDER BY order_id COLLATE BINARY LIMIT ?',teamId,after??'',limit+1);return{orders:rows.slice(0,limit).map(row=>view(db,orderValue(db,row))),hasMore:rows.length>limit};
}

// Called only after the server gateway verifies HMAC. Repeat passive validation
// and locked-order matching here; never accept a browser's success assertion.
export function recordVerifiedAnnualPayment(db,receipt,{now=Date.now}={}){
 const value=validateSimulationPaymentReceipt(receipt),bytes=simulationReceiptBytes(value),hash=digest(bytes);if(value.product!==ANNUAL_PRODUCT||typeof now!=='function')invalid();
 return ownTransaction(db,()=>{
  const order=orderFact(db,value.orderId);if(!order)deny();matchesOrder(order,value);
  const plan=seatPlanFact(db,order);
  if(one(db,'SELECT 1 FROM team_seat_verified_payments WHERE event_id=? OR transaction_id=?',value.eventId,value.transactionId))conflict();
  const collisions=all(db,'SELECT * FROM team_annual_verified_payments WHERE order_id=? OR event_id=? OR transaction_id=?',value.orderId,value.eventId,value.transactionId);
  if(collisions.length){if(collisions.length!==1)conflict();const old=paymentValue(collisions[0],order);if(old.receiptSha256!==hash)conflict();return old;}
  if(plan&&one(db,'SELECT 1 FROM team_seat_capacity_grants WHERE grant_id=?',order.id))conflict();
  const paymentId=randomUUID(),confirmedAt=at(now);if(confirmedAt<order.createdAt)conflict();
  if(db.prepare('INSERT INTO team_annual_verified_payments(payment_id,order_id,team_id,event_id,transaction_id,receipt_json,receipt_sha256,confirmed_at) VALUES (?,?,?,?,?,?,?,?)').run(paymentId,order.id,order.teamId,value.eventId,value.transactionId,bytes.toString('utf8'),hash,confirmedAt).changes!==1)conflict();
  const payment=paymentFact(db,order);if(!payment||payment.paymentId!==paymentId||payment.confirmedAt!==confirmedAt||payment.receiptSha256!==hash)conflict();
  if(plan&&one(db,'SELECT 1 FROM team_seat_capacity_grants WHERE grant_id=?',order.id))conflict();
  return payment;
 });
}

export function fulfilAnnualOrder(db,orderId,{now=Date.now}={}){
 requireOrderId(orderId);if(typeof now!=='function')invalid();return ownTransaction(db,()=>{
  const order=orderFact(db,orderId);if(!order)deny();const payment=paymentFact(db,order);if(!payment)conflict();const currentTime=at(now);if(currentTime<payment.confirmedAt)conflict();
  const plan=seatPlanFact(db,order);
  const current=readSubscriptionState(db,order.teamId,currentTime),prior=fulfilmentFact(db,order,payment);
  if(prior)return{order:view(db,order),fulfilment:prior,subscription:termReceipt(db,order.teamId,prior.subscriptionRevision)};
  const earliest=one(db,`SELECT payment.payment_id FROM team_annual_verified_payments payment LEFT JOIN team_annual_fulfilments fulfil ON fulfil.payment_id=payment.payment_id
    WHERE payment.team_id=? AND fulfil.order_id IS NULL ORDER BY payment.confirmed_at,payment.payment_id COLLATE BINARY LIMIT 1`,order.teamId);if(earliest?.payment_id!==payment.paymentId)conflict();
  const window=annualRenewalWindow(current.revision?{startsAt:current.startsAt,endsAt:current.endsAt}:null,payment.confirmedAt);
  if(plan){
   if(one(db,'SELECT 1 FROM team_seat_capacity_grants WHERE grant_id=?',order.id))conflict();
   assertSeatWindow(db,order,plan,window,currentTime);
  }
  const subscription=appendSubscriptionTermWithinTransaction(db,{teamId:order.teamId,operationId:order.termOperationId,expectedRevision:current.revision,startsAt:window.startsAt,endsAt:window.endsAt,sourceRef:'simulation-annual:'+order.id},{now:()=>currentTime});
  if(subscription.revision!==current.revision+1)conflict();const id=randomUUID();
  if(db.prepare('INSERT INTO team_annual_fulfilments(fulfilment_id,order_id,payment_id,team_id,term_operation_id,before_revision,subscription_revision,starts_at,ends_at,renewal_starts_at,confirmed_at,fulfilled_at,calendar_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,order.id,payment.paymentId,order.teamId,order.termOperationId,current.revision,subscription.revision,window.startsAt,window.endsAt,window.renewalStartsAt,payment.confirmedAt,currentTime,'beijing-calendar-year-v1').changes!==1)conflict();
  if(plan){
   if(plan.selectedSeats)recordSeatCapacityGrantWithinTransaction(db,{
    grantId:order.id,teamId:order.teamId,seats:plan.selectedSeats,
    startsAt:window.renewalStartsAt,endsAt:window.endsAt,sourceRef:'simulation-annual-seats:'+order.id,
   },{now:()=>currentTime});
   const finalTime=at(now);
   if(finalTime<currentTime)conflict();
   assertSeatWindow(db,order,plan,window,finalTime);
   readSeatCapacity(db,order.teamId,window.renewalStartsAt);
   const checked=orderFact(db,orderId),checkedPlan=seatPlanFact(db,checked);
   if(JSON.stringify(checkedPlan)!==JSON.stringify(plan))conflict();
   annualSeatGrantFact(db,checked,checkedPlan,payment,fulfilmentFact(db,checked,payment));
  }
  const finalOrder=orderFact(db,orderId),finalPayment=paymentFact(db,finalOrder),fulfilment=fulfilmentFact(db,finalOrder,finalPayment),head=readSubscriptionState(db,order.teamId,currentTime);
  if(finalOrder.requestSha256!==order.requestSha256||finalPayment.paymentId!==payment.paymentId||fulfilment?.id!==id||head.revision!==subscription.revision||head.startsAt!==subscription.startsAt||head.endsAt!==subscription.endsAt)conflict();return{order:view(db,finalOrder),fulfilment,subscription};
 });
}
