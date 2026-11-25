'use strict';
const {withoutEmptyPaymentExceptionLayer,peelPaymentExceptionSchema,assertPaymentExceptionSchemaRestored}=require('./helpers/billing-payment-exception-schema-layer.cjs');

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {
  TABLE, assertAnnualSeatPlanSchema, annualSeatPlanSchemaLayer, annualSeatPlanDefinitions,
  withoutEmptyAnnualSeatPlanLayer, peelAnnualSeatPlanSchema, assertAnnualSeatPlanSchemaRestored,
} = require('./helpers/annual-seat-plan-schema-layer.cjs');
const {withoutEmptySubscriptionDefinitions} = require('./helpers/subscription-schema-layer.cjs');
const {peelBillingSchema} = require('./helpers/billing-schema-layer.cjs');
const {peelLedgerAndWorkpaperSchema} = require('./helpers/workpaper-access-schema-layer.cjs');

const TEAM = 'schema-annual-seat-plan-team';
const OTHER_TEAM = 'schema-annual-seat-plan-other';
const ACTOR = 'schema-annual-seat-plan-actor';
const AT = Date.parse('2028-02-29T12:34:56.789+08:00');
const MAX = Number.MAX_SAFE_INTEGER;

async function database(t) {
  const {initializeTeamDatabase} = await import('../server/team/database.mjs');
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  initializeTeamDatabase(db);
  db.prepare("INSERT INTO teams VALUES (?,'active'),(?,'active')").run(TEAM, OTHER_TEAM);
  db.prepare("INSERT INTO team_users VALUES (?,'active')").run(ACTOR);
  db.prepare("INSERT INTO team_memberships VALUES (?,?,'manager','active')").run(TEAM, ACTOR);
  const annual = await import('../server/team/billing-store.mjs');
  return {db, initializeTeamDatabase, annual};
}

function snapshot(db) {
  const definitions = db.prepare(`
SELECT type,name,tbl_name,sql FROM sqlite_schema
WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all().map(row => ({...row}));
  const tables = definitions.filter(row => row.type === 'table').map(({name}) => {
    const select = db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid');
    select.setReadBigInts(true);
    return {name, rows: select.all()};
  });
  return {definitions, tables};
}

function checkIntegrity(db) {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
}

function annualOrder({db, annual}, teamId = TEAM) {
  return annual.createAnnualOrder(db, {
    teamId, actorId: ACTOR, requestId: randomUUID(), merchantId: 'synthetic-plan-schema-merchant',
    offer: {id: 'synthetic-schema-annual', revision: 1, product: 'team-annual-renewal',
      amountMinor: 500, currency: 'CNY'},
  }, {now: () => AT});
}

function receipt(order) {
  return {
    protocol: 'shenyi-simulation-payment-v1', merchantId: order.merchantId,
    eventId: randomUUID(), transactionId: randomUUID(), orderId: order.id,
    product: order.offer.product, amountMinor: order.offer.amountMinor,
    currency: order.offer.currency, status: 'succeeded', paidAt: AT,
  };
}

// The raw row tests below exercise SQL constraints only.
function plan(order, overrides = {}) {
  return {
    order_id: order.id, team_id: order.teamId, default_seats: 2, selected_seats: 3,
    base_amount_minor: 100, unit_amount_minor: 100, basis_revision: 1,
    basis_ends_at: AT + 86400000, request_sha256: 'a'.repeat(64), ...overrides,
  };
}

function insertPlan(db, row, replace = false) {
  const values = Object.values(row);
  const columns = Object.keys(row).join(',');
  db.prepare(`INSERT${replace ? ' OR REPLACE' : ''} INTO ${TABLE}(${columns})
    VALUES (${values.map(() => '?').join(',')})`).run(...values);
}

async function retainedOldFacts(f) {
  const {db, annual} = f;
  const old = annualOrder(f);
  annual.recordVerifiedAnnualPayment(db, receipt(old), {now: () => AT});
  annual.fulfilAnnualOrder(db, old.id, {now: () => AT});
  assert.equal(annual.readAnnualOrder(db, TEAM, old.id).status, 'paid');

  const seats = await import('../server/team/seat-order-store.mjs');
  const {transaction} = await import('../server/team/http-utils.mjs');
  const seatOrder = transaction(db, () => seats.createSeatOrderWithinTransaction(db, {
    teamId: TEAM, actorId: ACTOR, requestId: randomUUID(), merchantId: old.merchantId,
    offer: {id: 'synthetic-schema-seat', revision: 1, annualUnitAmountMinor: 100,
      currency: 'CNY'}, quantity: 2,
  }, {now: () => AT}));
  seats.recordVerifiedSeatPayment(db, receipt(seatOrder), {now: () => AT});
  assert.equal(seats.fulfilSeatOrder(db, seatOrder.id, {now: () => AT}).order.status, 'paid');
  db.prepare("INSERT INTO team_invitations VALUES (?,?,?,'assistant',?,?,NULL)")
    .run('b'.repeat(64), TEAM, 'schema-annual-plan-invitee', ACTOR, AT + 60000);
}

test('fresh database adds one empty STRICT rowid plan table and exactly three immutable guards', async t => {
  const {db, initializeTeamDatabase} = await database(t);
  assert.deepEqual(annualSeatPlanSchemaLayer(db), {tables: 1, objects: 4});
  const before = snapshot(db);
  const historical = withoutEmptyPaymentExceptionLayer(db, before);
  assert.equal(historical.tables.length, 93);
  assert.equal(historical.definitions.length, 372);
  initializeTeamDatabase(db);
  assert.deepEqual(snapshot(db), before);
  checkIntegrity(db);
});

test('pre-plan database upgrades with only the exact empty layer and preserves annual and seat order history', async t => {
  const f = await database(t);
  await retainedOldFacts(f);
  const paymentExceptionLayer = peelPaymentExceptionSchema(f.db);
  const layer = peelAnnualSeatPlanSchema(f.db);
  assert.deepEqual(annualSeatPlanDefinitions(f.db), []);
  const old = snapshot(f.db);
  assert.equal(old.tables.length, 92);
  assert.equal(old.definitions.length, 368);
  for (const table of ['team_annual_orders', 'team_annual_verified_payments',
    'team_annual_fulfilments', 'team_subscription_events', 'team_seat_orders',
    'team_seat_verified_payments', 'team_seat_capacity_grants', 'team_invitations']) {
    assert.equal(old.tables.find(row => row.name === table).rows.length, 1, table);
  }
  f.initializeTeamDatabase(f.db);
  assertAnnualSeatPlanSchemaRestored(f.db, layer);
  assertPaymentExceptionSchemaRestored(f.db, paymentExceptionLayer);
  const upgraded = snapshot(f.db);
  assert.deepEqual(withoutEmptyAnnualSeatPlanLayer(f.db, withoutEmptyPaymentExceptionLayer(f.db, upgraded)), old);
  f.initializeTeamDatabase(f.db);
  assert.deepEqual(snapshot(f.db), upgraded);
  checkIntegrity(f.db);
});

test('plan enforces a same-team parent order, integer ranges and the basis null convention', async t => {
  const f = await database(t);
  const base = plan(annualOrder(f));
  for (const invalid of [
    {team_id: OTHER_TEAM}, {order_id: randomUUID()}, {order_id: base.order_id + '\0tail'},
    {default_seats: -1}, {default_seats: MAX + 1}, {selected_seats: 1.25},
    {selected_seats: MAX + 1}, {base_amount_minor: 0}, {base_amount_minor: MAX + 1},
    {unit_amount_minor: -1}, {unit_amount_minor: MAX + 1},
    {basis_revision: -1}, {basis_revision: MAX + 1}, {basis_revision: 0},
    {basis_ends_at: null}, {basis_ends_at: 0}, {basis_ends_at: MAX + 1},
    {request_sha256: 'A'.repeat(64)}, {request_sha256: base.request_sha256 + '\0tail'},
  ]) {
    assert.throws(() => insertPlan(f.db, {...base, ...invalid}), /constraint|cannot store/i);
  }
  insertPlan(f.db, {...base, default_seats: 0, selected_seats: 0, basis_revision: 0, basis_ends_at: null});
  assert.equal(f.db.prepare('SELECT selected_seats FROM ' + TABLE).get().selected_seats, 0);
  checkIntegrity(f.db);
});

test('saved plans survive reinitialization and reject update, delete and either replacement key', async t => {
  const f = await database(t);
  const first = annualOrder(f);
  const second = annualOrder(f);
  insertPlan(f.db, plan(first));
  const before = snapshot(f.db);
  const rowid = f.db.prepare('SELECT rowid FROM ' + TABLE).get().rowid;
  assertAnnualSeatPlanSchema(f.db, {empty: false});
  f.db.exec('PRAGMA recursive_triggers=OFF');
  for (const operation of [
    () => f.db.exec('UPDATE ' + TABLE + ' SET selected_seats=4'),
    () => f.db.exec('DELETE FROM ' + TABLE),
    () => insertPlan(f.db, plan(first, {selected_seats: 4}), true),
    () => insertPlan(f.db, plan(second, {rowid}), true),
  ]) {
    assert.throws(operation, /ANNUAL_SEAT_PLAN_IMMUTABLE/);
    assert.deepEqual(snapshot(f.db), before);
  }
  f.initializeTeamDatabase(f.db);
  assert.deepEqual(snapshot(f.db), before);
  checkIntegrity(f.db);
});

for (const variant of ['populated', 'unexpected attached index', 'modified guard']) {
  test('historical reconstructors refuse a ' + variant + ' plan layer before changing schema', async t => {
    const f = await database(t);
    if (variant === 'populated') {
      insertPlan(f.db, plan(annualOrder(f)));
    } else if (variant === 'unexpected attached index') {
      f.db.exec('CREATE INDEX unrelated_index ON ' + TABLE + '(basis_revision)');
    } else {
      f.db.exec(`DROP TRIGGER annual_seat_plans_no_delete;
CREATE TRIGGER annual_seat_plans_no_delete BEFORE DELETE ON ${TABLE}
BEGIN SELECT 1; END`);
    }
    const before = snapshot(f.db);
    const version = f.db.prepare('PRAGMA schema_version').get().schema_version;
    for (const project of [
      () => withoutEmptySubscriptionDefinitions(f.db, before.definitions),
      () => withoutEmptyAnnualSeatPlanLayer(f.db, before),
      () => peelAnnualSeatPlanSchema(f.db),
      () => peelBillingSchema(f.db),
      () => peelLedgerAndWorkpaperSchema(f.db),
    ]) {
      assert.throws(project);
      assert.equal(f.db.prepare('PRAGMA schema_version').get().schema_version, version);
      assert.deepEqual(snapshot(f.db), before);
    }
  });
}
