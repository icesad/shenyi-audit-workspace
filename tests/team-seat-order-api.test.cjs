'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID, randomBytes, createHmac } = require('node:crypto');
const { createBusinessRoleFixture, source } = require('./helpers/business-role-fixture.cjs');

const day = 86400000;
const routes = {
  offers:'/api/teams/team-a/billing/seat-offer',
  orders:'/api/teams/team-a/billing/seat-orders',
  annual:'/api/teams/team-a/billing/orders',
  seats:'/api/teams/team-a/billing/seats',
  callback:'/api/billing/simulation/notifications',
};
const seatProduct = 'team-seat-addition';
const seatOffer = {id:'synthetic-seats',revision:3,annualUnitAmountMinor:36501,currency:'CNY'};
const annualOffer = {id:'synthetic-renewal',revision:1,product:'team-annual-renewal',amountMinor:9000,currency:'CNY'};

async function fixture(t) {
  const f = await createBusinessRoleFixture(t);
  const admin = await f.ready('administrator-demo');
  const { handleTeamApplicationRequest } = await source('application-api.mjs');
  const { recordSubscriptionTerm, readSubscriptionState } = await source('subscription-store.mjs');
  const now = () => f.clock.value;
  const base = now();
  let upstream = null;
  const options = {
    db:f.db, now, identityProviders:{deviceProofRequired:true},
    subscriptionEnforcement:'team-management-v1',
    seatCapacityEnforcement:'invitation-reservations-v1',
    billingSimulation:{
      mode:'simulation-v1',merchantId:'synthetic-merchant',signingKey:randomBytes(32),
      offers:[annualOffer],seatOffer,lookupPayment:async()=>upstream,
    },
  };
  const term = (revision,start,end) => recordSubscriptionTerm(f.db,{
    teamId:'team-a',operationId:randomUUID(),expectedRevision:revision,
    startsAt:start,endsAt:end,sourceRef:'synthetic-seat-api',
  },{now});
  const currentTerm = () => readSubscriptionState(f.db,'team-a',now());
  const api = async (route, settings={}, overrides={}) => {
    const request = settings.raw ?? f.makeRequest(route,{session:admin,...settings});
    const response = await handleTeamApplicationRequest(request,{...options,...overrides});
    return {status:response.status,body:await response.json()};
  };
  const create = (overrides={}) => api(routes.orders,{method:'POST',body:{
    requestId:randomUUID(),offerId:seatOffer.id,offerRevision:seatOffer.revision,quantity:2,...overrides,
  }});
  const makeReceipt = (order,extra={}) => ({
    protocol:'shenyi-simulation-payment-v1',merchantId:options.billingSimulation.merchantId,
    eventId:randomUUID(),transactionId:randomUUID(),orderId:order.id,product:order.offer.product,
    amountMinor:order.offer.amountMinor,currency:'CNY',status:'succeeded',paidAt:now(),...extra,
  });
  const envelope = (receipt,key=options.billingSimulation.signingKey) => {
    const body = Buffer.from(JSON.stringify(receipt));
    return {body,signature:createHmac('sha256',key).update('shenyi.billing.simulation.v1\0').update(body).digest('hex')};
  };
  const callback = (receipt,key) => {
    const {body,signature} = envelope(receipt,key);
    return api(routes.callback,{raw:new Request('http://127.0.0.1:8774'+routes.callback,{
      method:'POST',body,headers:{'content-type':'application/json','X-Shenyi-Simulation-Signature':signature},
    })});
  };
  const order = id => api(routes.orders+'/'+id);
  const purchased = async () => (await api(routes.seats)).body.seats.purchasedSeats;
  return {...f,admin,options,base,now,term,currentTerm,api,create,makeReceipt,callback,order,purchased,
    setUpstream:value=>{upstream=envelope(value);}};
}

test('a paid seat order uses the quoted amount and original expiry even after annual extension',async t=>{
  const f=await fixture(t);
  const term=f.term(0,f.base-30*day,f.base+100*day);
  const offer=await f.api(routes.offers);
  assert.deepEqual(offer,{status:200,body:{simulation:true,offer:{...seatOffer,product:seatProduct}}});
  const created=await f.create();
  assert.equal(created.status,201,JSON.stringify(created));
  const order=created.body.order;
  assert.equal(order.offer.amountMinor,20001);
  assert.equal(order.quantity,2);
  assert.equal(order.termEndsAt,term.endsAt);
  assert.equal(order.status,'pending');
  assert.equal(await f.purchased(),0);
  const renewed=f.term(1,term.startsAt,term.endsAt+365*day);
  f.clock.value+=1000;
  const receipt=f.makeReceipt(order);
  assert.equal((await f.callback(receipt)).status,200);
  const paid=await f.order(order.id);
  assert.equal(paid.body.order.status,'paid');
  assert.equal(paid.body.order.grant.startsAt,f.clock.value);
  assert.equal(paid.body.order.grant.endsAt,term.endsAt);
  assert.equal(f.currentTerm().endsAt,renewed.endsAt);
  assert.equal(await f.purchased(),2);
  assert.equal((await f.callback(receipt)).status,200);
  assert.equal(await f.purchased(),2);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_seat_capacity_grants').get().n,1);
});

test('only signed own-team technical administrators can quote and inspect orders',async t=>{
  const f=await fixture(t);
  f.term(0,f.base-1,f.base+100*day);
  const manager=await f.ready('manager-a');
  const requestId=randomUUID();
  const body={requestId,offerId:seatOffer.id,offerRevision:seatOffer.revision,quantity:2};
  assert.equal((await f.api(routes.orders,{method:'POST',session:manager,body})).status,404);
  assert.equal((await f.api(routes.orders.replace('team-a','team-b'),{method:'POST',body})).status,404);
  assert.equal((await f.create({amountMinor:1})).status,400);
  assert.equal((await f.create({quantity:1001})).status,400);
  const created=await f.create({requestId});
  assert.equal(created.status,201);
  f.options.billingSimulation.seatOffer=undefined;
  assert.deepEqual(await f.create({requestId}),created);
  assert.equal((await f.create({requestId,quantity:3})).status,409);
  assert.equal((await f.create()).status,409);
  assert.equal((await f.api(routes.orders)).body.orders.length,1);
  assert.equal((await f.api(routes.orders+'/'+created.body.order.id,{session:manager})).status,404);
  assert.equal((await f.api('/api/teams/team-a/projects/project-a')).status,404);
});

test('signed receipt must match amount, product and gateway identity before any capacity is issued',async t=>{
  const f=await fixture(t);
  f.term(0,f.base-1,f.base+100*day);
  const created=await f.create();
  assert.equal(created.status,201);
  const order=created.body.order;
  const good=f.makeReceipt(order);
  assert.equal((await f.callback(good,randomBytes(32))).status,403);
  assert.equal((await f.callback({...good,amountMinor:good.amountMinor-1})).status,409);
  assert.equal((await f.callback({...good,merchantId:'another-simulation'})).status,400);
  assert.equal((await f.callback({...good,product:annualOffer.product})).status,404);
  assert.equal((await f.order(order.id)).body.order.status,'pending');
  assert.equal(await f.purchased(),0);
  f.setUpstream(good);
  const reconciled=await f.api(routes.orders+'/'+order.id+'/reconcile',{method:'POST',body:{}});
  assert.equal(reconciled.status,200,JSON.stringify(reconciled));
  assert.equal(reconciled.body.order.status,'paid');
  assert.equal(await f.purchased(),2);
});

test('gateway identifiers cannot be reused for both annual renewal and seat addition',async t=>{
  const f=await fixture(t);
  f.term(0,f.base-1,f.base+100*day);
  const seat=(await f.create()).body.order;
  const annual=(await f.api(routes.annual,{method:'POST',body:{
    requestId:randomUUID(),offerId:annualOffer.id,offerRevision:annualOffer.revision,
  }})).body.order;
  const approvedSeat=f.makeReceipt(seat);
  assert.equal((await f.callback(approvedSeat)).status,200);
  assert.equal((await f.callback(f.makeReceipt(annual,{transactionId:approvedSeat.transactionId}))).status,409);
  const approvedAnnual=f.makeReceipt(annual);
  assert.equal((await f.callback(approvedAnnual)).status,200);
  const another=(await f.create()).body.order;
  assert.equal((await f.callback(f.makeReceipt(another,{eventId:approvedAnnual.eventId}))).status,409);
  assert.equal((await f.order(another.id)).body.order.status,'pending');
  assert.equal(await f.purchased(),2);
});

test('a signed payment at the quote deadline stays verified without usable capacity',async t=>{
  const f=await fixture(t);
  f.term(0,f.base-1,f.base+100*day);
  const order=(await f.create()).body.order;
  f.clock.value=order.quoteExpiresAt;
  const late=await f.callback(f.makeReceipt(order));
  assert.equal(late.status,409);
  assert.equal(late.body.error.code,'SEAT_ORDER_RECONCILIATION_REQUIRED');
  const session=await f.ready('administrator-demo');
  const observed=await f.api(routes.orders+'/'+order.id,{session});
  assert.equal(observed.status,200,JSON.stringify(observed));
  const actual=observed.body.order;
  assert.equal(actual.status,'payment-verified');
  assert.equal(actual.confirmedAt,order.quoteExpiresAt);
  assert.equal(actual.grant,null);
  assert.equal((await f.api(routes.seats,{session})).body.seats.purchasedSeats,0);
});

test('seat catalog is explicit and requires the capacity mode',async t=>{
  const f=await fixture(t);
  const {startTeamServer}=await source('dev-server.mjs');
  await assert.rejects(startTeamServer({...f.options,port:0,seatCapacityEnforcement:'disabled'}),/Invalid billing simulation/);
  const disabled={...f.options.billingSimulation,seatOffer:undefined};
  assert.equal((await f.api(routes.offers,{}, {billingSimulation:disabled})).status,503);
});
