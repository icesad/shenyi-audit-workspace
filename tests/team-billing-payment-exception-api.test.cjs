'use strict';

const assert=require('node:assert/strict');
const {createHmac,randomBytes,randomUUID}=require('node:crypto');
const {test}=require('node:test');
const {createBusinessRoleFixture,source}=require('./helpers/business-role-fixture.cjs');

const billing='/api/teams/team-a/billing';
const exceptionPath='/api/billing/simulation/payment-exceptions';
const capturePath='/api/billing/simulation/notifications';
const annual={id:'exception-annual',revision:1,product:'team-annual-renewal',amountMinor:8000,currency:'CNY'};
const seat={id:'exception-seat',revision:1,annualUnitAmountMinor:2500,currency:'CNY'};
const day=86400000;

async function fixture(t){
  const f=await createBusinessRoleFixture(t);
  const admin=await f.ready('administrator-demo');
  const {handleTeamApplicationRequest}=await source('application-api.mjs');
  const now=()=>f.clock.value;
  const configuration={
    mode:'simulation-v1',merchantId:'synthetic-payment-exception',signingKey:randomBytes(32),
    offers:[annual],seatOffer:seat,paymentExceptions:true,lookupPayment:()=>null,
  };
  const options={db:f.db,now,identityProviders:{deviceProofRequired:true},subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1'};
  async function request(path,settings={},billingSimulation=configuration){
    const response=await handleTeamApplicationRequest(settings.raw??f.makeRequest(path,{session:admin,...settings}),{...options,billingSimulation});
    return {status:response.status,body:await response.json()};
  }
  function envelope(receipt,adverse,key=configuration.signingKey){
    const body=Buffer.from(JSON.stringify(receipt));
    const domain=adverse?'shenyi.billing.simulation.exception.v1\0':'shenyi.billing.simulation.v1\0';
    const signature=createHmac('sha256',key).update(domain).update(body).digest('hex');
    return {body,signature};
  }
  function notice(path,receipt,{key,config=configuration,headers={}}={}){
    const {body,signature}=envelope(receipt,path===exceptionPath,key);
    const raw=new Request('http://127.0.0.1:8774'+path,{method:'POST',body,
      headers:{'Content-Type':'application/json','X-Shenyi-Simulation-Signature':signature,...headers}});
    return request(path,{raw},config);
  }
  function capture(order,fields={}){
    return {protocol:'shenyi-simulation-payment-v1',merchantId:configuration.merchantId,eventId:randomUUID(),
      transactionId:randomUUID(),orderId:order.id,product:order.offer.product,amountMinor:order.offer.amountMinor,
      currency:'CNY',status:'succeeded',paidAt:now(),...fields};
  }
  function adverse(payment,fields={}){
    return {protocol:'shenyi-simulation-payment-exception-v1',merchantId:payment.merchantId,eventId:randomUUID(),
      originalTransactionId:payment.transactionId,orderId:payment.orderId,product:payment.product,amountMinor:payment.amountMinor,
      currency:'CNY',kind:'refund',occurredAt:now(),...fields};
  }
  async function create(offer=annual){
    const isAnnual=offer===annual;
    const result=await request(billing+'/'+(isAnnual?'orders':'seat-orders'),{method:'POST',
      body:{requestId:randomUUID(),offerId:offer.id,offerRevision:offer.revision,...(isAnnual?{}:{quantity:2})}});
    assert.equal(result.status,201,JSON.stringify(result));
    return result.body.order;
  }
  const count=table=>f.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
  return {...f,admin,now,configuration,request,envelope,notice,capture,adverse,create,count};
}

test('synthetic adverse endpoint is opt-in and never accepts an unverified or mismatched full refund',async t=>{
  const f=await fixture(t),order=await f.create(),payment=f.capture(order),event=f.adverse(payment);
  assert.equal((await f.notice(exceptionPath,event,{config:{...f.configuration,paymentExceptions:false}})).status,503);
  assert.equal((await f.notice(exceptionPath,event,{key:randomBytes(32)})).status,403);
  assert.equal((await f.notice(exceptionPath,event,{headers:{Origin:'https://foreign.invalid'}})).status,403);
  assert.equal((await f.notice(exceptionPath,{...event,merchantId:'other-merchant'})).status,400);
  for(const altered of [{amountMinor:event.amountMinor-1},{currency:'USD'},{occurredAt:f.now()+1}]){
    assert.ok((await f.notice(exceptionPath,{...event,...altered})).status>=400);
  }
  assert.equal(f.count('team_billing_payment_exceptions'),0);
  assert.equal((await f.notice(exceptionPath,event)).status,200);
  assert.equal((await f.notice(exceptionPath,event)).status,200);
  assert.equal((await f.notice(exceptionPath,{...event,eventId:randomUUID(),kind:'chargeback'})).status,409);
  assert.equal(f.count('team_billing_payment_exceptions'),1);
  const route=billing+'/orders/'+order.id;
  const projected=(await f.request(route)).body.order;
  assert.equal(projected.status,'pending');
  assert.deepEqual(projected.paymentException,{kind:'refund',occurredAt:event.occurredAt,state:'review-required'});
  assert.equal(JSON.stringify(projected).includes(event.eventId),false);
  assert.equal(JSON.stringify(projected).includes(event.originalTransactionId),false);
  const ordinary=await f.ready('manager-a');
  assert.equal((await f.request(route,{session:ordinary})).status,404);
  assert.equal((await f.request(route.replace('team-a','team-b'))).status,404);
});

test('late matched capture stays factual, unfulfilled reversal releases the next normal annual payment',async t=>{
  const f=await fixture(t),prior=await f.create(),capture=f.capture(prior),event=f.adverse(capture);
  assert.equal((await f.notice(exceptionPath,event)).status,200);
  assert.equal((await f.notice(capturePath,{...capture,transactionId:randomUUID()})).status,409);
  assert.equal((await f.notice(capturePath,capture)).status,200);
  assert.equal((await f.notice(capturePath,capture)).status,200);
  const review=(await f.request(billing+'/orders/'+prior.id)).body.order;
  assert.equal(review.status,'payment-verified');
  assert.equal(review.paymentException.kind,'refund');
  assert.equal(f.count('team_annual_verified_payments'),1);
  assert.equal(f.count('team_annual_fulfilments'),0);
  f.clock.value++;
  const next=await f.create();
  assert.equal((await f.notice(capturePath,f.capture(next,{eventId:event.eventId}))).status,409);
  assert.equal((await f.notice(capturePath,f.capture(next))).status,200);
  assert.equal(f.count('team_annual_fulfilments'),1);
  assert.equal(f.count('team_subscription_events'),1);
  assert.equal((await f.request(billing+'/orders/'+next.id)).body.order.status,'paid');
  assert.equal((await f.request(billing+'/orders/'+prior.id)).body.order.status,'payment-verified');
});

test('trusted lookup only affects its own order and preserves already granted seats and subscription facts',async t=>{
  const f=await fixture(t),initial=await f.create();
  assert.equal((await f.notice(capturePath,f.capture(initial))).status,200);
  const extra=await f.create(seat),capture=f.capture(extra);
  assert.equal((await f.notice(capturePath,capture)).status,200);
  const route=billing+'/seat-orders/'+extra.id;
  const previous=(await f.request(route)).body.order;
  assert.equal(previous.status,'paid');
  const event=f.adverse(capture,{kind:'chargeback'});
  const lookup=(_order)=>({kind:'payment-exception',...f.envelope(event,true)});
  const configuration={...f.configuration,lookupPayment:lookup};
  const overview=(await f.request(billing+'/overview',{},configuration)).body;
  assert.equal(overview.canReconcilePaymentExceptions,true);
  assert.equal((await f.request(billing+'/orders/'+initial.id+'/reconcile',{method:'POST',body:{}},configuration)).status,400);
  assert.equal(f.count('team_billing_payment_exceptions'),0);
  const result=await f.request(route+'/reconcile',{method:'POST',body:{}},configuration);
  assert.equal(result.status,200,JSON.stringify(result));
  assert.deepEqual(result.body.order,{...previous,paymentException:{kind:'chargeback',occurredAt:event.occurredAt,state:'review-required'}});
  assert.equal((await f.notice(capturePath,capture)).status,200);
  assert.equal(f.count('team_seat_capacity_grants'),1);
  assert.equal(f.count('team_subscription_events'),1);
});

test('technical authorization is rechecked in the same transaction that records trusted lookup evidence',async t=>{
  const f=await fixture(t),order=await f.create(),event=f.adverse(f.capture(order));
  const configuration={...f.configuration,lookupPayment:async()=>{
    f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id=?").run(f.admin.account.id);
    return {kind:'payment-exception',...f.envelope(event,true)};
  }};
  const result=await f.request(billing+'/orders/'+order.id+'/reconcile',{method:'POST',body:{}},configuration);
  assert.equal(result.status,409,JSON.stringify(result));
  assert.equal(result.body.error.code,'DEVICE_STATE_CHANGED');
  assert.equal(f.count('team_billing_payment_exceptions'),0);
});
