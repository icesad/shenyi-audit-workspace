'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { createAdministratorBusinessRoleFixture, OWNER, ADMIN, PASSWORD, source } =
  require('./helpers/administrator-business-role-fixture.cjs');

const mode = 'invitation-reservations-v1';
const seatsRoute = '/api/teams/team-a/billing/seats';
const roleRoute = '/api/administrator-business-roles/' + ADMIN;

async function fixture(t) {
  const f = await createAdministratorBusinessRoleFixture(t, {register:false});
  const { handleTeamApplicationRequest } = await source('application-api.mjs');
  const { recordSubscriptionTerm } = await source('subscription-store.mjs');
  const { readSeatCapacity, recordSeatCapacityGrant } = await source('seat-capacity-store.mjs');
  const now = () => f.clock.value;
  recordSubscriptionTerm(f.db, {
    teamId:'team-a', operationId:randomUUID(), expectedRevision:0, startsAt:now()-1,
    endsAt:now()+86400000, sourceRef:'seat-api-fixture-term',
  }, {now});
  const options = {db:f.db, now, identityProviders:{deviceProofRequired:true},
    subscriptionEnforcement:'team-management-v1', seatCapacityEnforcement:mode};
  const api = async (route, settings={}, overrides={}) => {
    const response = await handleTeamApplicationRequest(f.makeRequest(route,settings), {...options,...overrides});
    return {status:response.status, body:await response.json()};
  };
  const grant = (seats, endsAt=now()+86400000) => recordSeatCapacityGrant(f.db,{
    teamId:'team-a', grantId:randomUUID(), seats, startsAt:now()-1, endsAt, sourceRef:'seat-api-fixture-grant',
  },{now});
  const usage = () => readSeatCapacity(f.db,'team-a',now());
  const change = (session,role) => api(roleRoute, {
    method:'POST', session, body:{revision:f.epoch(ADMIN),role,currentPassword:PASSWORD},
  });
  return {...f,api,options,grant,usage,change};
}

test('capacity balance is scoped to the signed technical administrator and reveals counts only', async t => {
  const f = await fixture(t);
  const admin = await f.ready(ADMIN);
  const manager = await f.ready('manager-a');
  const occupied = f.usage().activeBusinessSeats;
  f.grant(occupied+2);
  assert.deepEqual(await f.api(seatsRoute,{session:admin}), {
    status:200,
    body:{seats:{purchasedSeats:occupied+2,activeBusinessSeats:occupied,
      reservedInvitationSeats:0,usedSeats:occupied,availableSeats:2}},
  });
  assert.equal((await f.api(seatsRoute,{session:manager})).status,404);
  assert.equal((await f.api(seatsRoute.replace('team-a','team-b'),{session:admin})).status,404);
  assert.equal((await f.api(seatsRoute)).status,401);
  assert.equal((await f.api(seatsRoute+'?team=team-b',{session:admin})).status,400);
  assert.equal((await f.api(seatsRoute,{session:admin},{seatCapacityEnforcement:'disabled'})).status,503);
});

test('reviewer approval uses one available seat, preserves it on role change, and releases it on withdrawal', async t => {
  const f = await fixture(t);
  const owner = await f.ready(OWNER);
  const occupied = f.usage().activeBusinessSeats;
  f.grant(occupied);
  const revision = f.epoch(ADMIN);
  const denied = await f.change(owner,'assistant');
  assert.equal(denied.status,409);
  assert.equal(denied.body.error.code,'SEAT_CAPACITY_EXHAUSTED');
  assert.equal(f.epoch(ADMIN),revision);
  assert.equal(f.approval(ADMIN),undefined);
  f.grant(1);
  assert.equal((await f.change(owner,'assistant')).status,200);
  assert.equal(f.usage().availableSeats,0);
  assert.equal((await f.change(owner,'manager')).status,200);
  assert.equal(f.usage().activeBusinessSeats,occupied+1);
  assert.equal((await f.change(owner,null)).status,200);
  assert.equal(f.usage().activeBusinessSeats,occupied);
  assert.equal(f.usage().availableSeats,1);
});

test('capacity ending after the approval audit insert rolls back membership and approval together', async t => {
  const f = await fixture(t);
  const owner = await f.ready(OWNER);
  const endsAt = f.clock.value+1000;
  const occupied = f.usage().activeBusinessSeats;
  f.grant(occupied+1,endsAt);
  const revision = f.epoch(ADMIN);
  const prepare = f.db.prepare.bind(f.db);
  let inserted = false;
  f.db.prepare = function (sql,...args) {
    const statement = prepare(sql,...args);
    if (sql.startsWith('INSERT INTO team_administrator_business_role_events(')) {
      const run = statement.run.bind(statement);
      statement.run = (...values) => {
        const result = run(...values);
        inserted = true;
        f.clock.value = endsAt;
        return result;
      };
    }
    return statement;
  };
  const denied = await f.change(owner,'assistant');
  assert.equal(inserted,true);
  assert.equal(denied.status,409);
  assert.equal(denied.body.error.code,'SEAT_CAPACITY_EXHAUSTED');
  assert.equal(f.approval(ADMIN),undefined);
  assert.equal(f.usage().activeBusinessSeats,occupied);
  assert.equal(f.epoch(ADMIN),revision);
});

test('capacity mode is a server setting requiring strict devices and management subscription enforcement', async t => {
  const f = await fixture(t);
  const admin = await f.ready(ADMIN);
  const { startTeamServer } = await source('dev-server.mjs');
  await assert.rejects(startTeamServer({...f.options,port:0,subscriptionEnforcement:'disabled'}),/Seat capacity enforcement requires/);
  await assert.rejects(startTeamServer({...f.options,port:0,seatCapacityEnforcement:true}),/Invalid seat capacity/);
  assert.equal((await f.api(seatsRoute,{session:admin},{identityProviders:{}})).status,503);
  assert.equal((await f.api(seatsRoute,{session:admin,headers:{'X-Shenyi-Seat-Capacity':'100'}},{seatCapacityEnforcement:'disabled'})).status,503);
});
