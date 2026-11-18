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
