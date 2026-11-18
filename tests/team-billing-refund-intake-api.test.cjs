'use strict';

const assert=require('node:assert/strict');
const {createHmac,randomBytes,randomUUID}=require('node:crypto');
const {test}=require('node:test');
const {createBusinessRoleFixture,PASSWORD,source}=require('./helpers/business-role-fixture.cjs');

const access='/api/auth/refund-intake/access';
const intake='/api/platform/billing/refund-intakes';
const offers=[{id:'refund-test-annual',revision:1,product:'team-annual-renewal',amountMinor:8200,currency:'CNY'}];
const ownerName='refund-owner-test';

async function fixture(t){
 const f=await createBusinessRoleFixture(t);
 const admin=await f.ready('administrator-demo');
 f.db.prepare("INSERT INTO team_users(user_id,status) VALUES (?,'active')").run(ownerName);
 f.db.prepare(`INSERT INTO team_credentials(user_id,username,display_name,password_hash)
   SELECT ?,?,'Synthetic refund owner',password_hash FROM team_credentials WHERE user_id=?`).run(ownerName,ownerName,admin.account.id);
 f.db.prepare("INSERT INTO team_billing_refund_intake_reviewers(user_id,permission,status) VALUES (?,'billing.refund-intake','active')").run(ownerName);
 const owner=await f.ready(ownerName);
 const {handleTeamApplicationRequest}=await source('application-api.mjs');
 const billingSimulation={mode:'simulation-v1',merchantId:'synthetic-refund-test',signingKey:randomBytes(32),offers,refundIntake:true};
 const options={db:f.db,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true},
  subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1',billingSimulation};
 async function request(path,settings={},overrides={}){
  const result=await handleTeamApplicationRequest(settings.raw??f.makeRequest(path,{session:owner,...settings}),{...options,...overrides});
  return {status:result.status,body:await result.json()};
 }
 async function create(){
  const response=await request('/api/teams/team-a/billing/orders',{session:admin,method:'POST',
   body:{requestId:randomUUID(),offerId:offers[0].id,offerRevision:1}});
  assert.equal(response.status,201,JSON.stringify(response));
  return response.body.order;
 }
 async function pay(order){
  const notification='/api/billing/simulation/notifications';
  const receipt={protocol:'shenyi-simulation-payment-v1',merchantId:billingSimulation.merchantId,eventId:randomUUID(),
   transactionId:randomUUID(),orderId:order.id,product:offers[0].product,amountMinor:order.offer.amountMinor,
   currency:'CNY',status:'succeeded',paidAt:f.clock.value};
  const body=Buffer.from(JSON.stringify(receipt));
  const signature=createHmac('sha256',billingSimulation.signingKey).update('shenyi.billing.simulation.v1\0').update(body).digest('hex');
  const raw=new Request('http://127.0.0.1:8774'+notification,{method:'POST',body,
   headers:{'Content-Type':'application/json','X-Shenyi-Simulation-Signature':signature}});
  assert.equal((await request(notification,{raw})).status,200);
  return receipt;
 }
 const orderPath=order=>intake+'/annual/'+order.id;
 const post=(order,body,settings={})=>request(orderPath(order),{...settings,method:'POST',body});
 return {...f,owner,admin,billingSimulation,request,create,pay,orderPath,post};
}

const initial=()=>({requestId:randomUUID(),expectedRevision:0,reason:'duplicate-payment',reference:'CASE-255',currentPassword:PASSWORD});

test('a dedicated current product owner alone can read billing intake and previous functions grant no intake authority',async t=>{
 const f=await fixture(t);
 const order=await f.create(),path=f.orderPath(order);
 const unrelated=await f.ready('reviewer-demo');
 assert.equal((await f.request(access)).body.canReview,true);
 assert.deepEqual(f.owner.memberships,[]);
 assert.equal((await f.request('/api/teams/team-a/projects/project-a')).status,404);
 for(const session of [f.admin,unrelated]){
  assert.deepEqual((await f.request(access,{session})).body,{canReview:false});
  assert.equal((await f.request(path,{session})).status,404);
  assert.equal((await f.post(order,initial(),{session})).status,404);
 }
 assert.equal((await f.request(path,{session:{token:f.owner.token}})).status,403);
 const disabled={billingSimulation:{...f.billingSimulation,refundIntake:false}};
 assert.deepEqual((await f.request(access,{},disabled)).body,{canReview:false});
 assert.equal((await f.request(path,{},disabled)).status,404);
 assert.equal((await f.request(path.replace('/annual/','/seat/'))).status,404);
 assert.equal((await f.request(path+'?beforeRevision=1&beforeRevision=2')).status,400);
 const prior=(await f.request(path)).body;
 assert.equal(prior.order.status,'pending');
 assert.equal(prior.order.amountMinor,8200);
 assert.equal(prior.revision,0);
 const unpaid=await f.post(order,initial());
 assert.equal(unpaid.status,409);
 assert.equal(unpaid.body.error.code,'BILLING_REFUND_INTAKE_PAYMENT_REQUIRED');
});

test('verified order receipt and follow-ups are immutable and idempotent and cannot modify money or entitlement',async t=>{
 const f=await fixture(t),order=await f.create(),capture=await f.pay(order),path=f.orderPath(order);
 const financialTables=['team_annual_orders','team_annual_verified_payments','team_annual_fulfilments',
  'team_billing_payment_exceptions','team_subscription_events','team_subscription_heads','team_seat_capacity_grants'];
 const record=()=>Object.fromEntries(financialTables.map(name=>[name,f.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
 const original=record(),body=initial();
 assert.equal((await f.post(order,{...body,currentPassword:'wrong synthetic password'})).status,403);
 assert.equal((await f.post(order,{...body,amountMinor:100})).status,400);
 assert.equal((await f.post(order,{...body,reference:'private account @ example'})).status,400);
 const result=await f.post(order,body);
 assert.equal(result.status,200,JSON.stringify(result));
 assert.deepEqual(result.body.entries,[{revision:1,kind:'intake',reason:body.reason,reference:body.reference,
  recordedAt:f.clock.value,recordedBy:ownerName}]);
 assert.equal(result.body.order.status,'paid');
 assert.equal(result.body.order.amountMinor,order.offer.amountMinor);
 assert.equal(JSON.stringify(result).includes(capture.transactionId),false);
 assert.equal(JSON.stringify(result).includes(PASSWORD),false);
 assert.deepEqual((await f.post(order,body)).body,result.body);
 assert.equal((await f.post(order,{...body,reference:'SECOND-REFERENCE'})).status,409);
 assert.equal((await f.post(order,initial())).status,409);
 f.clock.value++;
 const follow={requestId:randomUUID(),expectedRevision:1,reason:'payment-checked',currentPassword:PASSWORD};
 const followed=await f.post(order,follow);
 assert.equal(followed.status,200,JSON.stringify(followed));
 assert.deepEqual(followed.body.entries.map(entry=>entry.kind),['follow-up','intake']);
 assert.equal(followed.body.entries[0].reference,null);
 assert.deepEqual((await f.post(order,body)).body,followed.body);
 assert.deepEqual((await f.request(path+'?beforeRevision=2')).body.entries,result.body.entries);
 assert.deepEqual(record(),original);
});

test('revoked owner grant removes discovery and record access without deleting established state',async t=>{
 const f=await fixture(t),order=await f.create();
 await f.pay(order);
 assert.equal((await f.post(order,initial())).status,200);
 f.db.prepare("UPDATE team_billing_refund_intake_reviewers SET status='revoked',revision=revision+1 WHERE user_id=?").run(ownerName);
 assert.deepEqual((await f.request(access)).body,{canReview:false});
 assert.equal((await f.request(f.orderPath(order))).status,404);
 assert.equal((await f.post(order,{...initial(),expectedRevision:1,reason:'customer-contacted'})).status,404);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_billing_refund_intake_events').get().n,1);
 assert.deepEqual(f.owner.memberships,[]);
});
