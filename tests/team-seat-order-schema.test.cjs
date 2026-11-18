'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createHash, randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {
  TABLES, assertSeatOrderSchema, seatOrderSchemaLayer, seatOrderDefinitions,
  withoutEmptySeatOrderLayer, peelSeatOrderSchema, assertSeatOrderSchemaRestored,
} = require('./helpers/seat-order-schema-layer.cjs');
const {withoutEmptySubscriptionDefinitions} = require('./helpers/subscription-schema-layer.cjs');
const {peelLedgerAndWorkpaperSchema} = require('./helpers/workpaper-access-schema-layer.cjs');
const {withoutEmptyAnnualSeatPlanLayer, peelAnnualSeatPlanSchema, assertAnnualSeatPlanSchemaRestored} = require('./helpers/annual-seat-plan-schema-layer.cjs');

const TEAM = 'schema-seat-order-team';
const OTHER_TEAM = 'schema-seat-order-other-team';
const ACTOR = 'schema-seat-order-actor';
const AT = Date.parse('2028-02-29T12:34:56.789+08:00');
const STARTS = AT - 1000;
const ENDS = AT + 86400000;
const sha = value => createHash('sha256').update(value).digest('hex');

async function database(t) {
  const {initializeTeamDatabase} = await import('../server/team/database.mjs');
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  initializeTeamDatabase(db);
  db.prepare("INSERT INTO teams VALUES (?,'active'),(?,'active')").run(TEAM, OTHER_TEAM);
  db.prepare("INSERT INTO team_users VALUES (?,'active')").run(ACTOR);
  db.prepare("INSERT INTO team_memberships VALUES (?,?,'manager','active')").run(TEAM, ACTOR);
  return {db, initializeTeamDatabase};
}

async function activeTerm(db) {
  const {recordSubscriptionTerm} = await import('../server/team/subscription-store.mjs');
  recordSubscriptionTerm(db, {
    teamId: TEAM, operationId: randomUUID(), expectedRevision: 0, startsAt: STARTS, endsAt: ENDS,
    sourceRef: 'synthetic-seat-order-schema-test',
  }, {now: () => AT});
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

// These statements exercise constraints only. Receipt validity and recording
// real capacity facts are tested through the store and payment adapter.
function order(overrides = {}) {
  return {
    order_id: randomUUID(), team_id: TEAM, actor_id: ACTOR, request_id: randomUUID(),
    merchant_id: 'synthetic-schema-merchant', offer_id: 'synthetic-schema-seat',
    offer_revision: 1, annual_unit_amount_minor: 4000, amount_minor: 3000,
    quantity: 1, currency: 'CNY', environment: 'simulation-v1', created_at: AT,
    quote_expires_at: AT + 300000, term_revision: 1, term_starts_at: STARTS,
    term_ends_at: ENDS, request_sha256: 'a'.repeat(64), ...overrides,
  };
}

function payment(row, overrides = {}) {
  const receipt = JSON.stringify({orderId: row.order_id, purpose: 'schema-constraint-fixture'});
  return {
    payment_id: randomUUID(), order_id: row.order_id, team_id: row.team_id,
    event_id: randomUUID(), transaction_id: randomUUID(),
    receipt_json: receipt, receipt_sha256: sha(receipt), confirmed_at: AT + 1, ...overrides,
  };
}

function insertRow(db, table, row, replace = false) {
  const values = Object.values(row);
  const columns = Object.keys(row).join(',');
  db.prepare(`INSERT${replace ? ' OR REPLACE' : ''} INTO ${table}(${columns})
    VALUES (${values.map(() => '?').join(',')})`).run(...values);
}

async function retainedOldFacts(db) {
  const annual = await import('../server/team/billing-store.mjs');
  const {recordSeatCapacityGrant} = await import('../server/team/seat-capacity-store.mjs');
  const legacyOrder = annual.createAnnualOrder(db, {
    teamId: TEAM, actorId: ACTOR, requestId: randomUUID(), merchantId: 'synthetic-schema-merchant',
    offer: {id: 'synthetic-schema-annual', revision: 1, product: 'team-annual-renewal',
      amountMinor: 500, currency: 'CNY'},
  }, {now: () => AT});
  annual.recordVerifiedAnnualPayment(db, {
    protocol: 'shenyi-simulation-payment-v1', merchantId: legacyOrder.merchantId,
    eventId: randomUUID(), transactionId: randomUUID(), orderId: legacyOrder.id,
    product: legacyOrder.offer.product, amountMinor: legacyOrder.offer.amountMinor,
    currency: legacyOrder.offer.currency, status: 'succeeded', paidAt: AT,
  }, {now: () => AT});
  annual.fulfilAnnualOrder(db, legacyOrder.id, {now: () => AT});
  assert.equal(annual.readAnnualOrder(db, TEAM, legacyOrder.id).status, 'paid');
  recordSeatCapacityGrant(db, {
    grantId: randomUUID(), teamId: TEAM, seats: 2, startsAt: AT, endsAt: ENDS,
    sourceRef: 'synthetic-pre-M5F-capacity',
  }, {now: () => AT});
  db.prepare("INSERT INTO team_invitations VALUES (?,?,?,'assistant',?,?,NULL)")
    .run('b'.repeat(64), TEAM, 'schema-seat-order-invitee', ACTOR, AT + 60000);
}

test('fresh initializer has two empty STRICT rowid seat order tables and exactly six immutable guards', async t => {
  const {db, initializeTeamDatabase} = await database(t);
  assert.deepEqual(seatOrderSchemaLayer(db), {tables: 2, objects: 8});
  const before = snapshot(db);
  const historical = withoutEmptyAnnualSeatPlanLayer(db, before);
  assert.equal(historical.tables.length, 92);
  assert.equal(historical.definitions.length, 368);
  initializeTeamDatabase(db);
  assert.deepEqual(snapshot(db), before);
  checkIntegrity(db);
});

test('upgrade from 90 tables changes only the seat order layer with prior billing, capacity, and invitation rows present', async t => {
  const {db, initializeTeamDatabase} = await database(t);
  await retainedOldFacts(db);
  const annualPlanLayer = peelAnnualSeatPlanSchema(db);
  const layer = peelSeatOrderSchema(db);
  assert.deepEqual(seatOrderDefinitions(db), []);
  const legacy = snapshot(db);
  assert.equal(legacy.tables.length, 90);
  assert.equal(legacy.definitions.length, 360);
  for (const table of ['team_annual_orders', 'team_annual_verified_payments', 'team_annual_fulfilments',
    'team_subscription_events', 'team_seat_capacity_grants', 'team_invitations']) {
    assert.equal(legacy.tables.find(row => row.name === table).rows.length, 1);
  }
  initializeTeamDatabase(db);
  assertSeatOrderSchemaRestored(db, layer);
  assertAnnualSeatPlanSchemaRestored(db, annualPlanLayer);
  const upgraded = snapshot(db);
  assert.deepEqual(withoutEmptySeatOrderLayer(db, withoutEmptyAnnualSeatPlanLayer(db, upgraded)), legacy);
  initializeTeamDatabase(db);
  assert.deepEqual(snapshot(db), upgraded);
  checkIntegrity(db);
});

test('quotes enforce exact integer bounds and valid parent term, team and actor links', async t => {
  const {db} = await database(t);
  await activeTerm(db);
  const base = order();
  for (const invalid of [
    {quantity: 0}, {quantity: 1001}, {quantity: 1.25}, {amount_minor: 0},
    {amount_minor: Number.MAX_SAFE_INTEGER + 1}, {annual_unit_amount_minor: 0},
    {created_at: STARTS - 1}, {quote_expires_at: AT}, {quote_expires_at: ENDS + 1},
    {term_ends_at: 8640000000000001}, {term_revision: 2}, {team_id: OTHER_TEAM},
    {actor_id: 'missing-schema-actor'}, {currency: 'USD'}, {environment: 'real'},
    {order_id: base.order_id + '\0tail'}, {request_id: base.request_id + '\0tail'},
    {merchant_id: base.merchant_id + '\0tail'}, {offer_id: base.offer_id + '\0tail'},
    {request_sha256: base.request_sha256 + '\0tail'},
  ]) {
    assert.throws(() => insertRow(db, TABLES[0], {...base, ...invalid}), /constraint|cannot store/i);
  }
  insertRow(db, TABLES[0], {...base, quote_expires_at: ENDS, quantity: 1000});
  assert.equal(db.prepare('SELECT quantity FROM team_seat_orders').get().quantity, 1000);
  checkIntegrity(db);
});

test('seat payment foreign keys bind the same team and order, with an immutable unique receipt history', async t => {
  const {db, initializeTeamDatabase} = await database(t);
  await activeTerm(db);
  const first = order();
  const second = order();
  insertRow(db, TABLES[0], first);
  insertRow(db, TABLES[0], second);
  assert.throws(() => insertRow(db, TABLES[1], payment(first, {team_id: OTHER_TEAM})), /constraint/i);
  assert.throws(() => insertRow(db, TABLES[1], payment(first, {order_id: randomUUID()})), /constraint/i);
  const receipt = payment(first);
  for (const field of ['payment_id', 'event_id', 'transaction_id', 'receipt_json', 'receipt_sha256']) {
    assert.throws(() => insertRow(db, TABLES[1], {...receipt, [field]: receipt[field] + '\0tail'}), /constraint/i);
  }
  assert.throws(() => insertRow(db, TABLES[1], {...receipt, receipt_json: '续'.repeat(6000)}), /constraint/i);
  insertRow(db, TABLES[1], receipt);
  const before = snapshot(db);
  assertSeatOrderSchema(db, {empty: false});
  db.exec('PRAGMA recursive_triggers=OFF');
  const rowids = TABLES.map(table => db.prepare('SELECT MIN(rowid) id FROM ' + table).get().id);
  for (const operation of [
    () => db.exec('UPDATE team_seat_orders SET quantity=2'),
    () => db.exec('DELETE FROM team_seat_orders WHERE rowid=2'),
    () => db.exec('UPDATE team_seat_verified_payments SET confirmed_at=0'),
    () => db.exec('DELETE FROM team_seat_verified_payments'),
    () => insertRow(db, TABLES[0], order({order_id: first.order_id}), true),
    () => insertRow(db, TABLES[0], order({request_id: first.request_id}), true),
    () => insertRow(db, TABLES[0], order({rowid: rowids[0]}), true),
    () => insertRow(db, TABLES[1], payment(first), true),
    () => insertRow(db, TABLES[1], payment(second, {payment_id: receipt.payment_id}), true),
    () => insertRow(db, TABLES[1], payment(second, {event_id: receipt.event_id}), true),
    () => insertRow(db, TABLES[1], payment(second, {transaction_id: receipt.transaction_id}), true),
    () => insertRow(db, TABLES[1], payment(second, {rowid: rowids[1]}), true),
  ]) {
    assert.throws(operation, /SEAT_ORDER_IMMUTABLE/);
    assert.deepEqual(snapshot(db), before);
  }
  initializeTeamDatabase(db);
  assert.deepEqual(snapshot(db), before);
  checkIntegrity(db);
});

for (const variant of ['populated', 'unexpected attached index', 'modified guard']) {
  test('history reconstruction refuses ' + variant + ' seat order layer before dropping any table', async t => {
    const {db} = await database(t);
    if (variant === 'populated') {
      await activeTerm(db);
      insertRow(db, TABLES[0], order());
    } else if (variant === 'unexpected attached index') {
      db.exec('CREATE INDEX unrelated_index ON team_seat_verified_payments(confirmed_at)');
    } else {
      db.exec(`DROP TRIGGER seat_verified_payments_no_delete;
CREATE TRIGGER seat_verified_payments_no_delete BEFORE DELETE ON team_seat_verified_payments
BEGIN SELECT 1; END`);
    }
    const before = snapshot(db);
    const version = db.prepare('PRAGMA schema_version').get().schema_version;
    const changes = db.prepare('SELECT total_changes() n').get().n;
    for (const attempt of [
      () => withoutEmptySubscriptionDefinitions(db, before.definitions),
      () => withoutEmptySeatOrderLayer(db, before),
      () => peelSeatOrderSchema(db),
      () => peelLedgerAndWorkpaperSchema(db),
    ]) {
      assert.throws(attempt);
      assert.equal(db.prepare('PRAGMA schema_version').get().schema_version, version);
      assert.equal(db.prepare('SELECT total_changes() n').get().n, changes);
      assert.deepEqual(snapshot(db), before);
    }
  });
}
