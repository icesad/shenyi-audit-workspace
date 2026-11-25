'use strict';

const assert=require('node:assert/strict');
const {createHmac,randomBytes,randomUUID}=require('node:crypto');
const {test}=require('node:test');
const {createBusinessRoleFixture,source}=require('./helpers/business-role-fixture.cjs');

const root='/api/teams/team-a/billing';
const closePath='/api/billing/simulation/order-closures';
const capturePath='/api/billing/simulation/notifications';
const exceptionPath='/api/billing/simulation/payment-exceptions';
const annual={id:'timeout-annual',revision:1,product:'team-annual-renewal',amountMinor:8000,currency:'CNY'};
const seat={id:'timeout-seat',revision:1,annualUnitAmountMinor:2500,currency:'CNY'};
const domains={
 'order-closure':'shenyi.billing.simulation.closure.v1\0',
 'payment-exception':'shenyi.billing.simulation.exception.v1\0',
 capture:'shenyi.billing.simulation.v1\0',
};

async function fixture(t){
 const f=await createBusinessRoleFixture(t),admin=await f.ready('administrator-demo');
 const {handleTeamApplicationRequest}=await source('application-api.mjs');
 const now=()=>f.clock.value,found=new Map();
 const simulation={mode:'simulation-v1',merchantId:'synthetic-timeout',signingKey:randomBytes(32),offers:[annual],seatOffer:seat,
  batchReconciliation:true,paymentExceptions:true,timeoutClosure:{annualTimeoutMs:1000},lookupPayment:order=>found.get(order.id)??null};
 const options={db:f.db,now,identityProviders:{deviceProofRequired:true},subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1'};
 async function request(path,settings={},billingSimulation=simulation){
  const response=await handleTeamApplicationRequest(settings.raw??f.makeRequest(path,{session:admin,...settings}),{...options,billingSimulation});
  return {status:response.status,body:await response.json()};
 }
 function envelope(receipt,kind,key=simulation.signingKey){
  const body=Buffer.from(JSON.stringify(receipt)),signature=createHmac('sha256',key).update(domains[kind]).update(body).digest('hex');
  return {kind,body,signature};
 }
 function notify(path,receipt,{kind='capture',config=simulation,key}={}){
  const {body,signature}=envelope(receipt,kind,key);
  const raw=new Request('http://127.0.0.1:8774'+path,{method:'POST',body,
   headers:{'Content-Type':'application/json','X-Shenyi-Simulation-Signature':signature}});
  return request(path,{raw},config);
 }
 const closure=(order,fields={})=>({protocol:'shenyi-simulation-order-closure-v1',merchantId:simulation.merchantId,
  eventId:randomUUID(),orderId:order.id,product:order.offer.product,amountMinor:order.offer.amountMinor,currency:'CNY',
  status:'closed',closedAt:now(),...fields});
 const capture=(order,fields={})=>({protocol:'shenyi-simulation-payment-v1',merchantId:simulation.merchantId,
  eventId:randomUUID(),transactionId:randomUUID(),orderId:order.id,product:order.offer.product,
  amountMinor:order.offer.amountMinor,currency:'CNY',status:'succeeded',paidAt:now(),...fields});
 const exception=(order,payment,fields={})=>({protocol:'shenyi-simulation-payment-exception-v1',merchantId:simulation.merchantId,
  eventId:randomUUID(),originalTransactionId:payment.transactionId,orderId:order.id,product:order.offer.product,
  amountMinor:order.offer.amountMinor,currency:'CNY',kind:'refund',occurredAt:now(),...fields});
 const orderRoot=offer=>root+'/'+(offer===seat?'seat-orders':'orders');
 async function create(offer=annual,config=simulation,requestId=randomUUID()){
  const result=await request(orderRoot(offer),{method:'POST',body:{requestId,offerId:offer.id,offerRevision:offer.revision,
   ...(offer===seat?{quantity:2}:{})}},config);
  assert.equal(result.status,201,JSON.stringify(result));
  return result.body.order;
 }
 const close=(record,settings)=>notify(closePath,record,{kind:'order-closure',...settings});
 const pay=record=>notify(capturePath,record);
 const refund=record=>notify(exceptionPath,record,{kind:'payment-exception'});
 const read=(order,settings={})=>request(root+'/'+(order.offer.product===annual.product?'orders':'seat-orders')+'/'+order.id,settings);
 const count=table=>f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n;
 return {...f,admin,now,simulation,request,found,envelope,closure,capture,exception,create,close,pay,refund,read,count};
}

test('only an opted-in, matched gateway receipt at the pinned deadline closes a renewal',async t=>{
 const f=await fixture(t),requestId=randomUUID(),{timeoutClosure,...disabled}=f.simulation;
 const legacy=await f.create(annual,disabled);
 const order=await f.create(annual,f.simulation,requestId);
 assert.equal(legacy.paymentDeadlineAt,undefined);
 assert.equal(order.paymentDeadlineAt,order.createdAt+1000);
 const changed=await f.create(annual,{...f.simulation,timeoutClosure:{annualTimeoutMs:30000}},requestId);
 assert.equal(changed.paymentDeadlineAt,order.paymentDeadlineAt);
 f.clock.value=order.paymentDeadlineAt-1;
 assert.equal((await f.close(f.closure(order))).status,409);
 f.clock.value++;
 const valid=f.closure(order);
 assert.equal((await f.read(order)).body.order.status,'pending');
 assert.equal((await f.close(valid,{config:disabled})).status,503);
 assert.equal((await f.close(valid,{key:randomBytes(32)})).status,403);
 assert.equal((await f.close({...valid,amountMinor:valid.amountMinor+1})).status,409);
 assert.equal((await f.close({...valid,closedAt:valid.closedAt+1})).status,409);
 assert.equal((await f.close(f.closure(legacy))).status,409);
 assert.equal(f.count('team_billing_order_closures'),0);
 assert.equal((await f.close(valid)).status,200);
 assert.equal((await f.close(valid)).status,200);
 const recorded=(await f.read(order)).body.order;
 assert.equal(recorded.status,'closed');
 assert.equal(recorded.confirmedAt,null);
 assert.deepEqual(recorded.closure,{closedAt:valid.closedAt,deadlineAt:order.paymentDeadlineAt});
 assert.equal(JSON.stringify(recorded).includes(valid.eventId),false);
 const ordinary=await f.ready('manager-a');
 assert.equal((await f.read(order,{session:ordinary})).status,404);
 assert.equal(f.count('team_subscription_events'),0);
});

test('late verified money remains pending review and does not stop the next normal renewal',async t=>{
 const f=await fixture(t),order=await f.create();
 f.clock.value=order.paymentDeadlineAt;
 const closed=f.closure(order);
 assert.equal((await f.close(closed)).status,200);
 f.clock.value++;
 assert.equal((await f.pay(f.capture(order,{eventId:closed.eventId}))).status,409);
 const late=f.capture(order,{paidAt:order.createdAt});
 assert.equal((await f.pay(late)).status,200);
 assert.equal((await f.pay(late)).status,200);
 assert.equal((await f.close(closed)).status,200);
 assert.equal((await f.refund(f.exception(order,late,{eventId:closed.eventId}))).status,409);
 const reviewed=(await f.read(order)).body.order;
 assert.equal(reviewed.status,'payment-verified');
 assert.equal(reviewed.closure.closedAt,closed.closedAt);
 assert.equal(reviewed.fulfilment,null);
 assert.equal(f.count('team_annual_verified_payments'),1);
 assert.equal(f.count('team_subscription_events'),0);
 const ordinary=await f.create();
 f.clock.value++;
 assert.equal((await f.pay(f.capture(ordinary))).status,200);
 assert.equal(f.count('team_subscription_events'),1);
 f.clock.value=ordinary.paymentDeadlineAt;
 assert.equal((await f.close(f.closure(ordinary))).status,409);
 const reversed=await f.create();
 f.clock.value=reversed.paymentDeadlineAt;
 assert.equal((await f.refund(f.exception(reversed,f.capture(reversed)))).status,200);
 assert.equal((await f.close(f.closure(reversed))).status,409);
 assert.equal(f.count('team_billing_order_closures'),1);
});

test('batch and single lookup close a seat order only at the locked quote deadline',async t=>{
 const f=await fixture(t);
 const {recordSubscriptionTerm}=await source('subscription-store.mjs');
 recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:0,
  startsAt:f.now()-86400000,endsAt:f.now()+1500,sourceRef:'closure-seat-test'},{now:f.now});
 const order=await f.create(seat);
 const reconcile=root+'/seat-orders/'+order.id+'/reconcile';
 f.found.set(order.id,f.envelope(f.closure(order),'order-closure'));
 assert.equal((await f.request(reconcile,{method:'POST',body:{}})).status,409);
 f.clock.value=order.quoteExpiresAt;
 const closed=f.closure(order);
 f.found.set(order.id,f.envelope(closed,'order-closure'));
 const batch=await f.request(root+'/reconciliation',{method:'POST',body:{kind:'seat'}});
 assert.deepEqual(batch.body.results,[{orderId:order.id,outcome:'closed',status:'closed',paymentException:false}]);
 const single=await f.request(reconcile,{method:'POST',body:{}});
 assert.equal(single.status,200);
 assert.equal(single.body.order.closure.deadlineAt,order.quoteExpiresAt);
 assert.equal((await f.pay(f.capture(order))).status,200);
 assert.equal((await f.read(order)).body.order.status,'payment-verified');
 assert.equal(f.count('team_seat_capacity_grants'),0);
 assert.equal(f.count('team_subscription_events'),1);
});
