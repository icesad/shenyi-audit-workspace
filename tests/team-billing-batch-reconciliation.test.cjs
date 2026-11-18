'use strict';

const assert=require('node:assert/strict');
const {createHmac,randomBytes,randomUUID}=require('node:crypto');
const {test}=require('node:test');
const {createBusinessRoleFixture,source}=require('./helpers/business-role-fixture.cjs');

const root='/api/teams/team-a/billing',batch=root+'/reconciliation';
const annual={id:'batch-annual',revision:1,product:'team-annual-renewal',amountMinor:16000,currency:'CNY'};

async function fixture(t){
 const f=await createBusinessRoleFixture(t),admin=await f.ready('administrator-demo');
 const {handleTeamApplicationRequest}=await source('application-api.mjs');
 const now=()=>f.clock.value,returned=new Map(),calls=[];
 const billingSimulation={
  mode:'simulation-v1',merchantId:'synthetic-batch-test',signingKey:randomBytes(32),offers:[annual],
  batchReconciliation:true,paymentExceptions:true,
  lookupPayment:order=>{
   calls.push(order.id);
   const response=returned.get(order.id);
   if(response instanceof Error)throw response;
   return response??null;
  },
 };
 const options={db:f.db,now,billingSimulation,identityProviders:{deviceProofRequired:true},
  subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1'};
 async function request(route,settings={},overrides={}){
  const response=await handleTeamApplicationRequest(f.makeRequest(route,{session:admin,...settings}),{...options,...overrides});
  return {status:response.status,body:await response.json()};
 }
 function signed(receipt,exception=false){
  const body=Buffer.from(JSON.stringify(receipt));
  const domain=exception?'shenyi.billing.simulation.exception.v1\0':'shenyi.billing.simulation.v1\0';
  const signature=createHmac('sha256',billingSimulation.signingKey).update(domain).update(body).digest('hex');
  return exception?{kind:'payment-exception',body,signature}:{body,signature};
 }
 function capture(order,overrides={}){
  return {protocol:'shenyi-simulation-payment-v1',merchantId:billingSimulation.merchantId,eventId:randomUUID(),
   transactionId:randomUUID(),orderId:order.id,product:order.offer.product,amountMinor:order.offer.amountMinor,
   currency:'CNY',status:'succeeded',paidAt:now(),...overrides};
 }
 function refund(payment){
  return {protocol:'shenyi-simulation-payment-exception-v1',merchantId:payment.merchantId,eventId:randomUUID(),
   originalTransactionId:payment.transactionId,orderId:payment.orderId,product:payment.product,amountMinor:payment.amountMinor,
   currency:payment.currency,kind:'refund',occurredAt:now()};
 }
 async function create(){
  const created=await request(root+'/orders',{method:'POST',body:{requestId:randomUUID(),offerId:annual.id,offerRevision:1}});
  assert.equal(created.status,201,JSON.stringify(created));
  return created.body.order;
 }
 const reconcile=(body={kind:'annual'},overrides)=>request(batch,{method:'POST',body},overrides);
 const count=table=>f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n;
 return {...f,admin,billingSimulation,request,reconcile,signed,capture,refund,create,returned,calls,count};
}

test('batch requires explicit enablement, current same-team technical authority and an existing in-kind cursor',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request(root+'/overview')).body.canReconcileBillingBatch,true);
 const disabled={billingSimulation:{...f.billingSimulation,batchReconciliation:false}};
 assert.equal((await f.reconcile({kind:'annual'},disabled)).status,503);
 assert.equal(Object.hasOwn((await f.request(root+'/overview',{},disabled)).body,'canReconcileBillingBatch'),false);
 const ordinary=await f.ready('manager-a');
 for(const request of [
  f.request(batch,{method:'POST',body:{kind:'annual'},session:ordinary}),
  f.request(batch.replace('team-a','team-b'),{method:'POST',body:{kind:'annual'}}),
  f.reconcile({kind:'annual',after:randomUUID()}),
 ])assert.equal((await request).status,404);
 assert.equal((await f.request(batch,{method:'POST',body:{kind:'annual'},session:{token:f.admin.token}})).status,403);
 assert.equal((await f.reconcile({kind:'annual',orders:[randomUUID()]})).status,400);
 assert.equal((await f.reconcile({kind:'anything'})).status,400);
 assert.equal((await f.request(batch)).status,405);
 assert.deepEqual(f.calls,[]);
});

test('batch uses a bounded stable cursor and independently verifies evidence without duplicate rights',async t=>{
 const f=await fixture(t);
 const orders=[];
 for(let index=0;index<10;index++)orders.push(await f.create());
 orders.sort((left,right)=>left.id.localeCompare(right.id,'en'));
 const [paid,exception,rejected,failed]=orders;
 const capture=f.capture(paid),refund=f.refund(f.capture(exception));
 f.returned.set(paid.id,f.signed(capture));
 f.returned.set(exception.id,f.signed(refund,true));
 f.returned.set(rejected.id,f.signed(f.capture(rejected,{amountMinor:1})));
 f.returned.set(failed.id,new Error('internal gateway detail must not be shown'));
 const first=await f.reconcile();
 assert.equal(first.status,200,JSON.stringify(first));
 const expected=orders.slice(0,8).map(({id},index)=>({
  orderId:id,outcome:['matched','awaiting-review','evidence-rejected','lookup-unavailable'][index]??'no-evidence',
  status:index===0?'paid':'pending',paymentException:index===1,
 }));
 assert.deepEqual(first.body,{teamId:'team-a',kind:'annual',simulation:true,results:expected,nextCursor:orders[7].id});
 assert.deepEqual(f.calls,orders.slice(0,8).map(order=>order.id));
 assert.equal((await f.reconcile({kind:'seat',after:first.body.nextCursor})).status,404);
 const second=await f.reconcile({kind:'annual',after:first.body.nextCursor});
 assert.deepEqual(second.body.results,orders.slice(8).map(({id})=>({orderId:id,outcome:'no-evidence',status:'pending',paymentException:false})));
 assert.equal(second.body.nextCursor,null);
 assert.deepEqual((await f.reconcile()).body,first.body);
 assert.equal(f.count('team_annual_verified_payments'),1);
 assert.equal(f.count('team_subscription_events'),1);
 assert.equal(f.count('team_billing_payment_exceptions'),1);
});

test('overlapping batches do not duplicate upstream work and a revoked waiting actor cannot post any durable fact',async t=>{
 const f=await fixture(t),order=await f.create();
 let signalStarted,respond;
 const started=new Promise(resolve=>{signalStarted=resolve;});
 const pending=new Promise(resolve=>{respond=resolve;});
 const fetches=[];
 const config={billingSimulation:{...f.billingSimulation,lookupPayment:record=>{
   fetches.push(record.id);signalStarted();return pending;
 }}};
 const first=f.reconcile({kind:'annual'},config);
 await started;
 try{
  const busy=await f.reconcile({kind:'annual'},config);
  assert.equal(busy.status,409);
  assert.equal(busy.body.error.code,'BILLING_RECONCILIATION_BUSY');
  f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id=?").run(f.admin.account.id);
 }finally{respond(f.signed(f.capture(order)));}
 const result=await first;
 assert.equal(result.status,409,JSON.stringify(result));
 assert.equal(result.body.error.code,'DEVICE_STATE_CHANGED');
 assert.deepEqual(fetches,[order.id]);
 assert.equal(f.count('team_annual_verified_payments'),0);
 assert.equal(f.count('team_subscription_events'),0);
});
