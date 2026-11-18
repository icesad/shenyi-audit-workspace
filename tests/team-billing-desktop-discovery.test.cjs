'use strict';

const assert=require('node:assert/strict');
const {randomBytes,randomUUID}=require('node:crypto');
const {test}=require('node:test');
const {createBusinessRoleFixture,source}=require('./helpers/business-role-fixture.cjs');

const access='/api/auth/billing/access';
const overview='/api/teams/team-a/billing/overview';
const annualOffer={id:'synthetic-annual',revision:2,product:'team-annual-renewal',amountMinor:8000,currency:'CNY'};
const seatOffer={id:'synthetic-seat',revision:3,annualUnitAmountMinor:2500,currency:'CNY'};

async function fixture(t){
  const f=await createBusinessRoleFixture(t);
  const {handleTeamApplicationRequest}=await source('application-api.mjs');
  const now=()=>f.clock.value;
  const admin=await f.ready('administrator-demo');
  const billingSimulation={mode:'simulation-v1',merchantId:'synthetic-billing-desktop',signingKey:randomBytes(32),offers:[annualOffer],seatOffer,annualSeatUnitAmountMinor:2500,lookupPayment:()=>null};
  const options={db:f.db,now,identityProviders:{deviceProofRequired:true},subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1',billingSimulation};
  async function get(path,session=admin,overrides={}){
    const response=await handleTeamApplicationRequest(f.makeRequest(path,{session}),{...options,...overrides});
    return {status:response.status,body:await response.json()};
  }
  return {...f,now,admin,billingSimulation,get};
}

test('billing discovery is device-held and lists only teams the current user technically administers',async t=>{
  const f=await fixture(t);
  f.db.prepare('INSERT OR REPLACE INTO team_profiles(team_id,name) VALUES (?,?)').run('team-a','Synthetic Team A');
  f.db.prepare('INSERT OR REPLACE INTO team_profiles(team_id,name) VALUES (?,?)').run('team-b','Synthetic Private Team B');
  assert.deepEqual(await f.get(access),{status:200,body:{teams:[{id:'team-a',name:'Synthetic Team A'}]}});
  const ordinary=await f.ready('manager-a');
  assert.deepEqual(await f.get(access,ordinary),{status:200,body:{teams:[]}});
  assert.equal((await f.get(overview,ordinary)).status,404);
  assert.equal((await f.get(overview.replace('team-a','team-b'))).status,404);
  assert.equal((await f.get('/api/teams/team-a/projects/project-a')).status,404);
  for(const path of [access,overview]){
    const bootstrap={token:f.admin.token};
    const result=await f.get(path,bootstrap);
    assert.equal(result.status,403,JSON.stringify(result));
    assert.equal(JSON.stringify(result).includes('Synthetic'),false);
  }
  assert.deepEqual(await f.get(access,f.admin,{billingSimulation:null}),{status:200,body:{teams:[]}});
  assert.equal((await f.get(overview,f.admin,{billingSimulation:null})).status,503);
});

test('billing overview returns one team snapshot and withholds annual offers unless seat renewal is configured',async t=>{
  const f=await fixture(t);
  const {recordSubscriptionTerm}=await source('subscription-store.mjs');
  const {recordSeatCapacityGrant}=await source('seat-capacity-store.mjs');
  const startsAt=f.now()-86400000,endsAt=f.now()+86400000;
  recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:0,startsAt,endsAt,sourceRef:'desktop-billing-test'},{now:f.now});
  recordSeatCapacityGrant(f.db,{teamId:'team-a',grantId:randomUUID(),seats:12,startsAt,endsAt,sourceRef:'desktop-billing-test'},{now:f.now});
  const {status,body}=await f.get(overview);
  assert.equal(status,200,JSON.stringify(body));
  const {activeBusinessSeats,reservedInvitationSeats}=body.seats;
  assert.ok(activeBusinessSeats>0);
  const committedSeats=activeBusinessSeats+reservedInvitationSeats;
  assert.deepEqual(body,{
    teamId:'team-a',simulation:true,subscription:{state:'active',revision:1,startsAt,endsAt},
    seats:{purchasedSeats:12,activeBusinessSeats,reservedInvitationSeats,usedSeats:committedSeats,availableSeats:12-committedSeats},
    annualOffers:[annualOffer],renewalSeats:{defaultSeats:12,basisRevision:1,basisEndsAt:endsAt,committedSeats,unitAmountMinor:2500,currency:'CNY'},
    seatOffer:{...seatOffer,product:'team-seat-addition'},canReconcile:true,
  });
  const {annualSeatUnitAmountMinor,lookupPayment,...legacy}=f.billingSimulation;
  const unconfigured=await f.get(overview,f.admin,{billingSimulation:legacy});
  assert.equal(unconfigured.status,200);
  assert.deepEqual(unconfigured.body.annualOffers,[]);
  assert.equal(unconfigured.body.renewalSeats,null);
  assert.equal(unconfigured.body.canReconcile,false);
  assert.equal(unconfigured.body.seatOffer.id,seatOffer.id);
});

const managedOptions={serviceMode:'managed-service',billingSimulation:null};

test('managed read-only billing discovery requires an eligible own-team technician and held device',async t=>{
  const f=await fixture(t);
  f.db.prepare('INSERT OR REPLACE INTO team_profiles(team_id,name) VALUES (?,?)').run('team-a','Managed Synthetic A');
  f.db.prepare('INSERT OR REPLACE INTO team_profiles(team_id,name) VALUES (?,?)').run('team-b','Managed Synthetic B');
  f.db.prepare("INSERT INTO team_users(user_id,status) VALUES ('managed-tech-b','active')").run();
  f.db.prepare(`INSERT INTO team_credentials(user_id,username,display_name,password_hash)
    SELECT 'managed-tech-b','managed-tech-b','Synthetic Other Technician',password_hash
    FROM team_credentials WHERE user_id=?`).run(f.admin.account.id);
  f.db.prepare("INSERT INTO team_operators(team_id,user_id,role,status) VALUES ('team-b','managed-tech-b','administrator','active')").run();
  const employee=await f.ready('intern-a'),otherTechnician=await f.ready('managed-tech-b');
  assert.deepEqual(await f.get(access,f.admin,managedOptions),{
    status:200,body:{teams:[{id:'team-a',name:'Managed Synthetic A'}]},
  });
  assert.deepEqual(await f.get(access,otherTechnician,managedOptions),{
    status:200,body:{teams:[{id:'team-b',name:'Managed Synthetic B'}]},
  });
  assert.deepEqual(await f.get(access,employee,managedOptions),{status:200,body:{teams:[]}});
  assert.equal((await f.get(overview,employee,managedOptions)).status,404);
  assert.equal((await f.get(overview,otherTechnician,managedOptions)).status,404);
  assert.equal((await f.get(overview.replace('team-a','team-b'),f.admin,managedOptions)).status,404);
  assert.equal((await f.get(overview.replace('team-a','team-b'),otherTechnician,managedOptions)).status,200);
  for(const route of [access,overview]){
    const result=await f.get(route,{token:f.admin.token},managedOptions);
    assert.equal(result.status,403,JSON.stringify(result));
    assert.equal(JSON.stringify(result.body).includes('Managed Synthetic'),false);
  }
  const noSeats={...managedOptions,seatCapacityEnforcement:'disabled'};
  assert.deepEqual(await f.get(access,f.admin,noSeats),{status:200,body:{teams:[]}});
  assert.equal((await f.get(overview,f.admin,noSeats)).status,503);
  // Merely having a null gateway in the existing local mode does not enable it.
  assert.deepEqual(await f.get(access,f.admin,{billingSimulation:null}),{status:200,body:{teams:[]}});
  assert.equal((await f.get(overview,f.admin,{billingSimulation:null})).status,503);
});

test('managed billing overview is the exact read-only term and committed-seat snapshot at expiry boundaries',async t=>{
  const f=await fixture(t);
  const {recordSubscriptionTerm}=await source('subscription-store.mjs');
  const {recordSeatCapacityGrant}=await source('seat-capacity-store.mjs');
  const startsAt=f.now()-86400000,endsAt=f.now()+1000,invitationEndsAt=endsAt+1000;
  recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:0,startsAt,endsAt,sourceRef:'managed-read-only-test'},{now:f.now});
  recordSeatCapacityGrant(f.db,{teamId:'team-a',grantId:randomUUID(),seats:8,startsAt,endsAt,sourceRef:'managed-read-only-test'},{now:f.now});
  f.db.prepare(`INSERT INTO team_operator_employee_invitations(
    invitation_id,token_hash,team_id,phone,role,invited_by,created_at,expires_at,revoked_at,accepted_at,accepted_by
  ) VALUES (?,?,?,'+8613800000000','intern',?,?,?,NULL,NULL,NULL)`).run(
    randomUUID(),'a'.repeat(64),'team-a',f.admin.account.id,f.now(),invitationEndsAt,
  );
  const tables=['team_subscription_events','team_subscription_heads','team_seat_capacity_grants',
    'team_memberships','team_operators','team_project_grants','team_operator_employee_invitations'];
  const facts=()=>tables.map(table=>({table,rows:f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()}));
  const original=facts();
  const expected=(state,purchasedSeats,reservedInvitationSeats)=>({status:200,body:{
    teamId:'team-a',simulation:false,subscription:{state,revision:1,startsAt,endsAt},
    seats:{purchasedSeats,activeBusinessSeats:4,reservedInvitationSeats,
      usedSeats:4+reservedInvitationSeats,availableSeats:Math.max(0,purchasedSeats-4-reservedInvitationSeats)},
  }});
  assert.deepEqual(await f.get(overview,f.admin,managedOptions),expected('active',8,1));
  f.clock.value=endsAt;
  assert.deepEqual(await f.get(overview,f.admin,managedOptions),expected('expired',0,1));
  assert.deepEqual(await f.get(access,f.admin,managedOptions),{status:200,body:{teams:[{id:'team-a',name:'team-a'}]}});
  f.clock.value=invitationEndsAt;
  assert.deepEqual(await f.get(overview,f.admin,managedOptions),expected('expired',0,0));
  assert.deepEqual(facts(),original,'read-only overview must not rewrite expiry, commitments or project access');
});

test('managed read-only billing never enables simulation payment, order, reconciliation or refund writes',async t=>{
  const f=await fixture(t),{handleTeamApplicationRequest}=await source('application-api.mjs');
  const options={db:f.db,now:f.now,identityProviders:{deviceProofRequired:true},
    subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1',...managedOptions};
  const request=async(route,method='GET',body)=>{
    const response=await handleTeamApplicationRequest(f.makeRequest(route,{session:f.admin,method,body}),options);
    return {status:response.status,body:await response.json()};
  };
  const tables=['team_annual_orders','team_seat_orders','team_annual_verified_payments','team_seat_verified_payments',
    'team_billing_payment_exceptions','team_billing_order_closures','team_billing_refund_intake_events',
    'team_subscription_events','team_subscription_heads','team_seat_capacity_grants'];
  const facts=()=>tables.map(table=>({table,rows:f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()}));
  const original=facts(),orderId=randomUUID(),billing='/api/teams/team-a/billing';
  for(const route of ['offers','seat-offer','renewal-seats','orders','seat-orders']){
    const result=await request(billing+'/'+route);
    assert.equal(result.status,503,route+': '+JSON.stringify(result));
  }
  for(const route of ['orders','seat-orders','orders/'+orderId+'/reconcile','seat-orders/'+orderId+'/reconcile','reconciliation']){
    const result=await request(billing+'/'+route,'POST',{});
    assert.equal(result.status,503,route+': '+JSON.stringify(result));
  }
  for(const suffix of ['notifications','payment-exceptions','order-closures']){
    const result=await request('/api/billing/simulation/'+suffix,'POST',{});
    assert.equal(result.status,503,suffix+': '+JSON.stringify(result));
  }
  assert.deepEqual(await request('/api/auth/refund-intake/access'),{status:200,body:{canReview:false}});
  for(const method of ['GET','POST']){
    assert.equal((await request('/api/platform/billing/refund-intakes/annual/'+orderId,method,method==='POST'?{}:undefined)).status,404);
  }
  assert.equal((await request(overview,'POST',{})).status,405);
  assert.equal((await request(access,'POST',{})).status,405);
  assert.deepEqual(facts(),original,'managed read-only routes must not create any payment, refund or entitlement fact');
});
