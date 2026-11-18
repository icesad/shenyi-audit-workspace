'use strict';
// Synthetic subscriptions, real SQLite, held-device signatures and scoped app.
const assert=require('node:assert/strict'),{randomBytes,randomUUID}=require('node:crypto'),{test}=require('node:test');
const {createBusinessRoleFixture,source}=require('./helpers/business-role-fixture.cjs');
const DAY=86400000,HEADER='X-Shenyi-Billing-View',VIEW='expiry-reminder-v1',OVERVIEW='/api/teams/team-a/billing/overview';
const offer={id:'synthetic-reminder-annual',revision:1,product:'team-annual-renewal',amountMinor:8000,currency:'CNY'};
const managed={serviceMode:'managed-service',billingSimulation:null};
async function fixture(t){
 const f=await createBusinessRoleFixture(t),admin=await f.ready('administrator-demo');
 const {handleTeamApplicationRequest}=await source('application-api.mjs');
 const now=()=>f.clock.value;
 const options={db:f.db,now,identityProviders:{deviceProofRequired:true},subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1',billingSimulation:{mode:'simulation-v1',merchantId:'synthetic-reminder-merchant',signingKey:randomBytes(32),offers:[offer],annualSeatUnitAmountMinor:2500}};
 const get=async(settings={})=>{
  const {route=OVERVIEW,session=admin,overrides={},method='GET',body,raw}=settings;
  const view=Object.hasOwn(settings,'view')?settings.view:VIEW;
  const headers=view===undefined?{}:{[HEADER]:view};
  const response=await handleTeamApplicationRequest(raw??f.makeRequest(route,{session,headers,method,body}),{...options,...overrides}),text=await response.text();
  return {status:response.status,body:JSON.parse(text),text,headers:response.headers};
 };
 const term=async({startsAt=now()-60*DAY,endsAt=now()+DAY}={})=>(await source('subscription-store.mjs')).recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:0,startsAt,endsAt,sourceRef:'synthetic-expiry-reminder'},{now});
 return {...f,admin,now,options,get,term};
}

for(const [label,remaining,days,state] of [
 ['more than thirty days',30*DAY+1,undefined,'active'],
 ['exactly thirty days',30*DAY,30,'active'],
 ['a fraction over twenty-nine days',29*DAY+1,30,'active'],
 ['a fraction over one day',DAY+1,2,'active'],
 ['exactly one day',DAY,1,'active'],
 ['one millisecond',1,1,'active'],
 ['the exact expiry',0,undefined,'expired'],
 ['an elapsed expiry',-1,undefined,'expired'],
])test('opt-in overview reminder uses ceiling at '+label+' in managed and simulation modes',async t=>{
 const f=await fixture(t),endsAt=f.now()+remaining;await f.term({endsAt});
 for(const overrides of [{},managed]){
  const legacy=await f.get({view:undefined,overrides}),current=await f.get({overrides});
  assert.equal(current.status,200,current.text);assert.equal(current.body.subscription.state,state);assert.equal(current.body.subscription.endsAt,endsAt);
  assert.deepEqual(current.body,days===undefined?legacy.body:{...legacy.body,subscription:{...legacy.body.subscription,renewalReminderDays:days}});
  if(days===undefined)assert.equal(Object.hasOwn(current.body.subscription,'renewalReminderDays'),false);
  else assert.equal(current.body.subscription.renewalReminderDays,days);
 }
});

test('absent, unknown, differently cased and combined view values preserve the exact legacy JSON bytes',async t=>{
 const f=await fixture(t);await f.term();
 for(const overrides of [{},managed]){
  const expected=await f.get({view:undefined,overrides});assert.equal(expected.status,200);
  for(const view of [undefined,'','unknown','expiry-reminder-v2','Expiry-reminder-v1','expiry-reminder-v1, unknown','unknown, expiry-reminder-v1','expiry-reminder-v1, expiry-reminder-v1']){
   const result=await f.get({view,overrides});assert.equal(result.status,200);assert.equal(result.text,expected.text,JSON.stringify({view,overrides}));
  }
  const initial=f.makeRequest(OVERVIEW,{session:f.admin}),headers=new Headers(initial.headers);headers.append(HEADER,VIEW);headers.append(HEADER,VIEW);
  const duplicate=await f.get({raw:new Request(initial,{headers}),overrides});assert.equal(duplicate.status,200);assert.equal(duplicate.text,expected.text);
 }
});

test('scheduled and unconfigured terms never gain reminders or a different state',async t=>{
 for(const configured of [false,true]){
  const f=await fixture(t);if(configured)await f.term({startsAt:f.now()+1,endsAt:f.now()+DAY});
  for(const overrides of [{},managed]){
   const legacy=await f.get({view:undefined,overrides}),current=await f.get({overrides});assert.equal(current.status,200);assert.equal(current.text,legacy.text);assert.equal(current.body.subscription.state,configured?'scheduled':'unconfigured');assert.equal(Object.hasOwn(current.body.subscription,'renewalReminderDays'),false);
  }
 }
});

test('reminder and seat summary use the already captured overview at even when the clock crosses expiry during reading',async t=>{
 const f=await fixture(t),at=f.now(),endsAt=at+1;await f.term({endsAt});
 const {recordSeatCapacityGrant}=await source('seat-capacity-store.mjs');recordSeatCapacityGrant(f.db,{teamId:'team-a',grantId:randomUUID(),seats:8,startsAt:at-1,endsAt,sourceRef:'synthetic-reminder-snapshot'},{now:f.now});
 const prepare=f.db.prepare.bind(f.db);let moved=0;
 f.db.prepare=function(sql,...args){const statement=prepare(sql,...args);if(sql.includes('head.team_id AS head_team_id')){const get=statement.get.bind(statement);statement.get=(...values)=>{const result=get(...values);if(!moved++){f.clock.value=endsAt;}return result;};}return statement;};
 const response=await f.get({overrides:managed});assert.equal(response.status,200,response.text);assert.ok(moved>0);assert.equal(f.now(),endsAt);assert.equal(response.body.subscription.state,'active');assert.equal(response.body.subscription.renewalReminderDays,1);assert.equal(response.body.seats.purchasedSeats,8);
});

test('opt-in header adds no authority or foreign-team reminder disclosure',async t=>{
 const f=await fixture(t);await f.term();const employee=await f.ready('intern-a'),manager=await f.ready('manager-a');
 for(const overrides of [{},managed]){
  for(const session of [employee,manager]){
   const legacy=await f.get({session,view:undefined,overrides}),opted=await f.get({session,overrides});assert.equal(opted.status,404);assert.equal(opted.text,legacy.text);assert.equal(opted.text.includes('renewalReminderDays'),false);
  }
  const foreign=await f.get({route:OVERVIEW.replace('team-a','team-b'),overrides});assert.equal(foreign.status,404);assert.equal(foreign.text.includes('renewalReminderDays'),false);
  const bootstrap=await f.get({session:{token:f.admin.token},overrides});assert.equal(bootstrap.status,403);assert.equal(bootstrap.text.includes('renewalReminderDays'),false);
 }
 const raw=f.makeRequest(OVERVIEW,{session:f.admin,headers:{[HEADER]:VIEW,Origin:'https://untrusted.invalid'}});const crossSite=await f.get({raw});assert.equal(crossSite.status,403);assert.equal(crossSite.text.includes('renewalReminderDays'),false);
});

test('header cannot enable an unavailable overview or change its existing methods and access JSON',async t=>{
 const f=await fixture(t);await f.term();
 for(const overrides of [{billingSimulation:null},{...managed,seatCapacityEnforcement:'disabled'}]){const r=await f.get({overrides});assert.equal(r.status,503);assert.equal(r.text.includes('renewalReminderDays'),false);}
 const post=await f.get({method:'POST',body:{},overrides:managed});assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET');
 const before=await f.get({route:'/api/auth/billing/access',view:undefined,overrides:managed}),after=await f.get({route:'/api/auth/billing/access',overrides:managed});assert.equal(after.status,200);assert.equal(after.text,before.text);
});

test('reminder overviews do not write subscription, seat, billing or authorization facts',async t=>{
 const f=await fixture(t);await f.term();
 const tables=['team_subscription_events','team_subscription_heads','team_seat_capacity_grants','team_annual_orders','team_seat_orders','team_annual_verified_payments','team_seat_verified_payments','team_billing_payment_exceptions','team_billing_order_closures','team_billing_refund_intake_events','team_memberships','team_operators','team_project_grants'];
 const facts=()=>tables.map(table=>({table,rows:f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()}));const original=facts();
 for(const overrides of [{},managed]){const r=await f.get({overrides});assert.equal(r.status,200);assert.equal(r.body.subscription.renewalReminderDays,1);}
 assert.deepEqual(facts(),original);
});
