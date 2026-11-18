'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomUUID,randomBytes,createHmac}=require('node:crypto');
const {createBusinessRoleFixture,source}=require('./helpers/business-role-fixture.cjs');

const day=86400000;
const root='/api/teams/team-a/billing';
const notification='/api/billing/simulation/notifications';
const offer={id:'synthetic-annual',revision:1,product:'team-annual-renewal',amountMinor:8000,currency:'CNY'};
const unitAmountMinor=2500;

async function fixture(t){
  const f=await createBusinessRoleFixture(t);
  const admin=await f.ready('administrator-demo');
  const {handleTeamApplicationRequest}=await source('application-api.mjs');
  const {recordSubscriptionTerm,readSubscriptionState}=await source('subscription-store.mjs');
  const {recordSeatCapacityGrant,readSeatCapacity}=await source('seat-capacity-store.mjs');
  const now=()=>f.clock.value;
  const options={
    db:f.db,now,identityProviders:{deviceProofRequired:true},
    subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1',
    billingSimulation:{mode:'simulation-v1',merchantId:'synthetic-merchant',signingKey:randomBytes(32),offers:[offer],annualSeatUnitAmountMinor:unitAmountMinor},
  };
  const api=async(route,settings={},overrides={})=>{
    const request=settings.raw??f.makeRequest(route,{session:admin,...settings});
    const response=await handleTeamApplicationRequest(request,{...options,...overrides});
    return {status:response.status,body:await response.json()};
  };
  const startsAt=now()-30*day,endsAt=now()+100*day;
  const term=(ends=endsAt)=>recordSubscriptionTerm(f.db,{
    teamId:'team-a',operationId:randomUUID(),expectedRevision:0,
    startsAt,endsAt:ends,sourceRef:'annual-seat-test',
  },{now});
  const grant=(seats,start=startsAt,end=endsAt)=>recordSeatCapacityGrant(f.db,{
    grantId:randomUUID(),teamId:'team-a',seats,startsAt:start,endsAt:end,sourceRef:'annual-seat-test',
  },{now});
  const create=(extra={})=>api(root+'/orders',{method:'POST',body:{
    requestId:randomUUID(),offerId:offer.id,offerRevision:offer.revision,...extra,
  }});
  const receipt=(order,extra={})=>({
    protocol:'shenyi-simulation-payment-v1',merchantId:options.billingSimulation.merchantId,
    eventId:randomUUID(),transactionId:randomUUID(),orderId:order.id,
    product:offer.product,amountMinor:order.offer.amountMinor,currency:'CNY',status:'succeeded',paidAt:now(),...extra,
  });
  const notify=(value,key=options.billingSimulation.signingKey)=>{
    const body=Buffer.from(JSON.stringify(value));
    const signature=createHmac('sha256',key).update('shenyi.billing.simulation.v1\0').update(body).digest('hex');
    return api(notification,{raw:new Request('http://127.0.0.1:8774'+notification,{
      method:'POST',body,headers:{'content-type':'application/json','X-Shenyi-Simulation-Signature':signature},
    })});
  };
  const order=id=>api(root+'/orders/'+id);
  return {...f,admin,now,options,api,term,grant,create,receipt,notify,order,endsAt,
    capacity:(at=now())=>readSeatCapacity(f.db,'team-a',at),
    subscription:()=>readSubscriptionState(f.db,'team-a',now())};
}

test('renewal defaults describe paid seats immediately before the original end and are team scoped',async t=>{
  const f=await fixture(t);
  f.term();
  f.grant(7);
  f.grant(3,f.now()-1,f.endsAt-day);
  f.grant(11,f.endsAt,f.endsAt+day);
  const response=await f.api(root+'/renewal-seats');
  assert.equal(response.status,200,JSON.stringify(response));
  assert.equal(response.body.simulation,true);
  assert.equal(response.body.renewalSeats.defaultSeats,7);
  assert.equal(response.body.renewalSeats.basisEndsAt,f.endsAt);
  assert.equal(response.body.renewalSeats.unitAmountMinor,unitAmountMinor);
  assert.equal(f.capacity().purchasedSeats,10);
  assert.equal((await f.api(root.replace('team-a','team-b')+'/renewal-seats')).status,404);
  const ordinary=await f.ready('manager-a');
  assert.equal((await f.api(root+'/renewal-seats',{session:ordinary})).status,404);
  assert.equal((await f.api('/api/teams/team-a/projects/project-a')).status,404);
});

test('early payment atomically schedules the locked next seat count and grants exactly once',async t=>{
  const f=await fixture(t);
  f.term();
  f.grant(7);
  const created=await f.create();
  assert.equal(created.status,201,JSON.stringify(created));
  const order=created.body.order;
  assert.equal(order.offer.amountMinor,offer.amountMinor+7*unitAmountMinor);
  assert.equal(order.renewalSeats.selectedSeats,7);
  assert.equal(order.renewalSeatGrant,null);
  assert.equal(f.subscription().revision,1);
  assert.equal((await f.notify(f.receipt(order,{amountMinor:offer.amountMinor}))).status,409);
  const valid=f.receipt(order);
  assert.equal((await f.notify(valid,randomBytes(32))).status,403);
  assert.equal((await f.notify(valid)).status,200);
  const paid=(await f.order(order.id)).body.order;
  assert.equal(paid.status,'paid');
  assert.equal(paid.renewalSeatGrant.startsAt,f.endsAt);
  assert.equal(paid.renewalSeatGrant.endsAt,f.subscription().endsAt);
  assert.equal(paid.renewalSeatGrant.seats,7);
  assert.equal(f.subscription().revision,2);
  assert.equal(f.capacity(f.endsAt-1).purchasedSeats,7);
  assert.equal(f.capacity(f.endsAt).purchasedSeats,7);
  assert.equal((await f.notify(valid)).status,200);
  assert.equal(f.subscription().revision,2);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_seat_capacity_grants').get().n,2);
});

test('adjusted quantity, amount, and offer revision stay locked across retries and catalog changes',async t=>{
  const f=await fixture(t);
  f.term();
  f.grant(7);
  const requestId=randomUUID();
  const created=await f.create({requestId,selectedSeats:5});
  assert.equal(created.status,201,JSON.stringify(created));
  assert.equal(created.body.order.renewalSeats.defaultSeats,7);
  assert.equal(created.body.order.renewalSeats.selectedSeats,5);
  assert.equal(created.body.order.offer.amountMinor,offer.amountMinor+5*unitAmountMinor);
  f.options.billingSimulation.annualSeatUnitAmountMinor=9000;
  assert.deepEqual(await f.create({requestId,selectedSeats:5}),created);
  assert.equal((await f.create({requestId,selectedSeats:6})).status,409);
  assert.equal((await f.create({requestId})).status,409);
  assert.equal((await f.create({selectedSeats:5,amountMinor:1})).status,400);
  assert.equal((await f.create({selectedSeats:'5'})).status,400);
  assert.equal((await f.create({selectedSeats:-1})).status,400);
});

test('expired term retains its previous paid default but starts new capacity at trusted confirmation',async t=>{
  const f=await fixture(t);
  const oldEnd=f.now()-1000;
  f.term(oldEnd);
  f.grant(6,f.now()-day,oldEnd);
  assert.equal(f.capacity().purchasedSeats,0);
  const result=await f.create();
  assert.equal(result.status,201,JSON.stringify(result));
  const order=result.body.order;
  assert.equal(order.renewalSeats.defaultSeats,6);
  f.clock.value+=200;
  const r=f.receipt(order,{paidAt:f.now()-100});
  assert.equal((await f.notify(r)).status,200);
  const paid=(await f.order(order.id)).body.order;
  assert.equal(paid.renewalSeatGrant.startsAt,f.now());
  assert.equal(f.subscription().startsAt,f.now());
  assert.equal(f.capacity().purchasedSeats,6);
});

test('a later invitation must release its reservation before an already paid reduction can settle',async t=>{
  const f=await fixture(t);
  f.term();
  f.grant(7);
  const committed=f.capacity().usedSeats;
  assert.equal((await f.create({selectedSeats:committed-1})).status,409);
  const result=await f.create({selectedSeats:committed});
  assert.equal(result.status,201,JSON.stringify(result));
  const invitationPath='/api/teams/team-a/employee-invitations';
  const invitation=await f.api(invitationPath,{method:'POST',body:{phone:'+8613800001042',role:'intern'}});
  assert.equal(invitation.status,201,JSON.stringify(invitation));
  assert.equal(f.capacity().usedSeats,committed+1);
  const r=f.receipt(result.body.order);
  const blocked=await f.notify(r);
  assert.equal(blocked.status,409,JSON.stringify(blocked));
  assert.equal((await f.order(result.body.order.id)).body.order.status,'payment-verified');
  assert.equal(f.subscription().revision,1);
  const revoked=await f.api(invitationPath+'/'+invitation.body.invitationId+'/revoke',{method:'POST',body:{}});
  assert.equal(revoked.status,200,JSON.stringify(revoked));
  assert.equal(f.capacity().usedSeats,committed);
  assert.equal((await f.notify(r)).status,200);
  assert.equal((await f.order(result.body.order.id)).body.order.renewalSeatGrant.seats,committed);
  assert.equal(f.subscription().revision,2);
});

test('an old annual order remains distinct when seat renewal configuration is later enabled',async t=>{
  const f=await fixture(t);
  const {startTeamServer}=await source('dev-server.mjs');
  await assert.rejects(startTeamServer({...f.options,port:0,seatCapacityEnforcement:'disabled'}),/Invalid billing simulation/);
  const requestId=randomUUID();
  f.options.billingSimulation.annualSeatUnitAmountMinor=undefined;
  assert.equal((await f.api(root+'/renewal-seats')).status,503);
  assert.equal((await f.create({selectedSeats:7})).status,503);
  const created=await f.create({requestId});
  assert.equal(created.status,201);
  assert.equal(Object.hasOwn(created.body.order,'renewalSeats'),false);
  f.options.billingSimulation.annualSeatUnitAmountMinor=unitAmountMinor;
  assert.deepEqual(await f.create({requestId}),created);
  assert.equal((await f.create({requestId,selectedSeats:7})).status,409);
  assert.equal((await f.notify(f.receipt(created.body.order))).status,200);
  assert.equal(Object.hasOwn((await f.order(created.body.order.id)).body.order,'renewalSeatGrant'),false);
});
