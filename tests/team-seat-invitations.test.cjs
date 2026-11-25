'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomBytes, randomUUID} = require('node:crypto');
const {createBusinessRoleFixture, source} = require('./helpers/business-role-fixture.cjs');

const TEAM = 'team-a';
const LEGACY = '/api/teams/team-a/invitations';
const EMPLOYEE = '/api/teams/team-a/employee-invitations';
const PHONE = '+8613800000093';
const DAY = 86_400_000;

async function fixture(t, seats, {capacityEndsIn = 2 * DAY} = {}) {
  const f = await createBusinessRoleFixture(t);
  const {handleTeamApplicationRequest} = await source('application-api.mjs');
  const {countActiveBusinessSeats, recordSubscriptionTerm} = await source('subscription-store.mjs');
  const {readSeatCapacity, recordSeatCapacityGrant} = await source('seat-capacity-store.mjs');
  const now = () => f.clock.value;
  const sent = [];
  const active = countActiveBusinessSeats(f.db, TEAM);
  const identityProviders = {deviceProofRequired:true,phonePepper:randomBytes(32),sms:{send:async value => { sent.push(value); }}};
  recordSubscriptionTerm(f.db, {
    teamId:TEAM,operationId:randomUUID(),expectedRevision:0,startsAt:now()-1000,endsAt:now()+3*DAY,sourceRef:'synthetic-invitation-term',
  }, {now});
  if (seats !== null) {
    recordSeatCapacityGrant(f.db, {
      teamId:TEAM,grantId:randomUUID(),seats:active+seats,startsAt:now()-1000,endsAt:now()+capacityEndsIn,sourceRef:'synthetic-invitation-capacity',
    }, {now});
  }
  async function post(route, body, session, extra = {}) {
    const request = f.makeRequest(route, {method:'POST',session,body,...extra});
    const response = await handleTeamApplicationRequest(request, {
      db:f.db,now,identityProviders,subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1',
    });
    return {status:response.status,data:await response.json()};
  }
  const capacity = () => readSeatCapacity(f.db, TEAM, now());
  const legacy = actor => post(LEGACY,{username:'invitee-a',role:'assistant'},actor);
  const employee = (actor, phone=PHONE) => post(EMPLOYEE,{phone,role:'intern'},actor);
  const revoke = (id, actor) => post(`${EMPLOYEE}/${id}/revoke`,{},actor);
  const legacyAccept = (token, actor) => post('/api/auth/invitations/accept',{invitationToken:token},actor);
  async function obtainChallenge(invite) {
    const data = {invitationCode:invite.invitationCode,phone:PHONE};
    const challenge = await post('/api/auth/onboarding/challenges',data);
    assert.equal(challenge.status,202,JSON.stringify(challenge));
    assert.equal(sent.length,1);
    return {
      ...data,challengeId:challenge.data.challengeId,code:sent[0].code,accept:true,
      password:'SyntheticSeatEmployee!2026',displayName:'合成席位测试员工',
    };
  }
  return {...f,active,capacity,legacy,employee,legacyAccept,revoke,post,obtainChallenge};
}

function assertCapacity(f, {reserved, occupied=f.active, available}) {
  const capacity = f.capacity();
  assert.equal(capacity.reservedInvitationSeats,reserved);
  assert.equal(capacity.activeBusinessSeats,occupied);
  assert.equal(capacity.usedSeats,occupied+reserved);
  assert.equal(capacity.availableSeats,available);
}

function expectStatus(result, status) {
  assert.equal(result.status,status,JSON.stringify(result));
  return result.data;
}

function expectUnavailable(result) {
  assert.equal(expectStatus(result,409).error.code,'SEAT_CAPACITY_EXHAUSTED');
}

test('concurrent requests from all three invitation sources share the last available seat',async t => {
  const f = await fixture(t,1);
  const manager = await f.ready('manager-a');
  const operator = await f.ready('administrator-demo');
  const results = await Promise.all([
    f.legacy(manager),f.employee(manager),f.employee(operator,'+8613800000094'),
  ]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409,409],JSON.stringify(results));
  for (const result of results.filter(r=>r.status!==201)) expectUnavailable(result);
  assertCapacity(f,{reserved:1,available:0});
  const stored = ['team_invitations','team_employee_invitations','team_operator_employee_invitations'];
  assert.equal(stored.reduce((n,table) => n+f.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE team_id=?`).get(TEAM).n,0),1);
});

test('legacy invitation accepts at full capacity by exchanging the reservation for an active member',async t => {
  const f = await fixture(t,1);
  const manager = await f.ready('manager-a');
  const invitee = await f.ready('invitee-a');
  const invite = expectStatus(await f.legacy(manager),201);
  assertCapacity(f,{reserved:1,available:0});
  expectStatus(await f.legacyAccept(invite.invitationToken,invitee),200);
  assertCapacity(f,{reserved:0,occupied:f.active+1,available:0});
  expectStatus(await f.legacyAccept(invite.invitationToken,invitee),404);
  expectUnavailable(await f.employee(manager));
  assertCapacity(f,{reserved:0,occupied:f.active+1,available:0});
});

for (const [actorName,table] of [
  ['manager-a','team_employee_invitations'],['administrator-demo','team_operator_employee_invitations'],
]) {
  test(`${table} activates at full capacity and cannot consume its reservation twice`,async t => {
    const f = await fixture(t,1);
    const actor = await f.ready(actorName);
    const invite = expectStatus(await f.employee(actor),201);
    assertCapacity(f,{reserved:1,available:0});
    const input = await f.obtainChallenge(invite);
    assertCapacity(f,{reserved:1,available:0});
    expectStatus(await f.post('/api/auth/onboarding/activate',input),200);
    assertCapacity(f,{reserved:0,occupied:f.active+1,available:0});
    expectStatus(await f.post('/api/auth/onboarding/activate',input),404);
    assert.notEqual(f.db.prepare(`SELECT accepted_at FROM ${table} WHERE invitation_id=?`).get(invite.invitationId).accepted_at,null);
    assertCapacity(f,{reserved:0,occupied:f.active+1,available:0});
  });
}

test('only an authorized revocation frees the reservation for another invitation',async t => {
  const f = await fixture(t,1);
  const manager = await f.ready('manager-a');
  const operator = await f.ready('administrator-demo');
  const foreign = await f.ready('manager-b');
  const invite = expectStatus(await f.employee(operator),201);
  expectStatus(await f.revoke(invite.invitationId,foreign),404);
  assertCapacity(f,{reserved:1,available:0});
  expectUnavailable(await f.legacy(manager));
  expectStatus(await f.revoke(invite.invitationId,operator),200);
  assertCapacity(f,{reserved:0,available:1});
  expectStatus(await f.legacy(manager),201);
  assertCapacity(f,{reserved:1,available:0});
});

test('legacy reservation releases at exact expiry and permits an invitation from another source',async t => {
  const f = await fixture(t,1);
  const manager = await f.ready('manager-a');
  const invite = expectStatus(await f.legacy(manager),201);
  f.clock.value = invite.expiresAt-1;
  assertCapacity(f,{reserved:1,available:0});
  f.clock.value = invite.expiresAt;
  assertCapacity(f,{reserved:0,available:1});
  const invitee = await f.ready('invitee-a');
  expectStatus(await f.legacyAccept(invite.invitationToken,invitee),404);
  expectStatus(await f.employee(await f.ready('administrator-demo')),201);
  assertCapacity(f,{reserved:1,available:0});
});

test('capacity expiry after the actual insert rolls back the invitation',async t => {
  const f = await fixture(t,1,{capacityEndsIn:1000});
  const manager = await f.ready('manager-a');
  const before = f.clock.value;
  const prepare = f.db.prepare.bind(f.db);
  let inserts = 0;
  t.mock.method(f.db,'prepare',function(sql,...args) {
    const statement = prepare(sql,...args);
    if (sql.startsWith('INSERT INTO team_employee_invitations(')) {
      const run = statement.run.bind(statement);
      statement.run = (...values) => {
        const result = run(...values);
        inserts++;
        f.clock.value = before+1000;
        return result;
      };
    }
    return statement;
  });
  expectUnavailable(await f.employee(manager));
  assert.equal(inserts,1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM team_employee_invitations WHERE team_id=?').get(TEAM).n,0);
  assertCapacity(f,{reserved:0,available:0});
});

test('expiry of the target invite after final activation SQL rolls back user, seat and invitation',async t => {
  const f = await fixture(t,1);
  const manager = await f.ready('manager-a');
  const invite = expectStatus(await f.employee(manager),201);
  const deadline = f.clock.value+1000;
  f.db.prepare('UPDATE team_employee_invitations SET expires_at=? WHERE invitation_id=?').run(deadline,invite.invitationId);
  const input = await f.obtainChallenge(invite);
  const prepare = f.db.prepare.bind(f.db);
  let activityWrites = 0;
  t.mock.method(f.db,'prepare',function(sql,...args) {
    const statement = prepare(sql,...args);
    if (sql.startsWith('INSERT INTO team_activity ')) {
      const run = statement.run.bind(statement);
      statement.run = (...values) => {
        const result = run(...values);
        activityWrites++;
        f.clock.value = deadline;
        return result;
      };
    }
    return statement;
  });
  expectStatus(await f.post('/api/auth/onboarding/activate',input),404);
  assert.equal(activityWrites,1);
  assert.equal(f.db.prepare('SELECT user_id FROM team_phone_credentials WHERE phone=?').get(PHONE),undefined);
  assert.equal(f.db.prepare('SELECT accepted_at FROM team_employee_invitations WHERE invitation_id=?').get(invite.invitationId).accepted_at,null);
  assert.equal(f.db.prepare('SELECT consumed_at FROM team_employee_activation_challenges WHERE challenge_id=?').get(input.challengeId).consumed_at,null);
  assertCapacity(f,{reserved:0,available:1});
});

test('missing purchased capacity admits no invitation and leaves active staff intact',async t => {
  const f = await fixture(t,null);
  const manager = await f.ready('manager-a');
  expectUnavailable(await f.legacy(manager));
  expectUnavailable(await f.employee(manager));
  assertCapacity(f,{reserved:0,available:0});
});
