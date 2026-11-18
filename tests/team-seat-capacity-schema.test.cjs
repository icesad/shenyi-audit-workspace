'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash, randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {
  TABLE, assertSeatCapacitySchema, seatCapacitySchemaLayer, seatCapacityDefinitions,
  withoutEmptySeatCapacityDefinitions, withoutEmptySeatCapacityLayer,
  peelSeatCapacitySchema, assertSeatCapacitySchemaRestored,
} = require('./helpers/seat-capacity-schema-layer.cjs');
const {peelLedgerAndWorkpaperSchema} = require('./helpers/workpaper-access-schema-layer.cjs');
const {withoutEmptySeatOrderLayer, peelSeatOrderSchema, assertSeatOrderSchemaRestored} = require('./helpers/seat-order-schema-layer.cjs');

const TEAM = 'schema-capacity-team';
const ACTOR = 'schema-capacity-actor';
const AT = Date.parse('2028-02-29T12:34:56.789+08:00');

async function database(t) {
  const {initializeTeamDatabase} = await import('../server/team/database.mjs');
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  initializeTeamDatabase(db);
  db.prepare("INSERT INTO teams VALUES (?,'active')").run(TEAM);
  db.prepare("INSERT INTO team_users VALUES (?,'active')").run(ACTOR);
  db.prepare("INSERT INTO team_memberships VALUES (?,?,'manager','active')").run(TEAM, ACTOR);
  return {db, initializeTeamDatabase};
}

function snapshot(db) {
  const definitions = db.prepare(`
    SELECT type,name,tbl_name,sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name
  `).all().map(row => ({...row}));
  const tables = definitions.filter(row => row.type === 'table').map(({name}) => {
    const statement = db.prepare('SELECT * FROM "' + name + '"');
    statement.setReadBigInts(true);
    const rows = statement.all().map(row => JSON.stringify(Object.entries(row).map(([key, value]) =>
      [key, typeof value, typeof value === 'bigint' ? value.toString()
        : value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value]))).sort();
    return {name, rows};
  });
  return {definitions, tables};
}

function assertIntegrity(db) {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
}

function grant(overrides = {}) {
  const input = {
    grantId: randomUUID(), teamId: TEAM, seats: 1, startsAt: AT, endsAt: AT + 60000,
    sourceRef: 'synthetic-capacity-schema-fixture', ...overrides,
  };
  const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return [input.grantId, input.teamId, input.seats, input.startsAt, input.endsAt, AT, input.sourceRef, digest];
}

test('fresh initialization installs one strictly typed empty table and its four objects', async t => {
  const {db, initializeTeamDatabase} = await database(t);
  assert.deepEqual(seatCapacitySchemaLayer(db), {tables: 1, objects: 5});
  const before = snapshot(db);
  const historical = withoutEmptySeatOrderLayer(db, before);
  assert.equal(historical.tables.length, 90);
  assert.equal(historical.definitions.length, 360);
  initializeTeamDatabase(db);
  assert.deepEqual(snapshot(db), before);
  assertIntegrity(db);
});

test('existing 89-table billing database gains only the empty seat layer and preserves grants, order and pending invite', async t => {
  const {db, initializeTeamDatabase} = await database(t);
  const store = await import('../server/team/billing-store.mjs');
  const order = store.createAnnualOrder(db, {
    teamId: TEAM, actorId: ACTOR, requestId: randomUUID(), merchantId: 'synthetic-schema-merchant',
    offer: {id: 'synthetic-schema-annual', revision: 1, product: 'team-annual-renewal',
      amountMinor: 1, currency: 'CNY'},
  }, {now: () => AT});
  store.recordVerifiedAnnualPayment(db, {
    protocol: 'shenyi-simulation-payment-v1', merchantId: order.merchantId,
    eventId: randomUUID(), transactionId: randomUUID(), orderId: order.id,
    product: order.offer.product, amountMinor: order.offer.amountMinor, currency: order.offer.currency,
    status: 'succeeded', paidAt: AT,
  }, {now: () => AT});
  store.fulfilAnnualOrder(db, order.id, {now: () => AT});
  db.prepare("INSERT INTO team_invitations VALUES (?,?,?,'assistant',?,?,NULL)")
    .run('a'.repeat(64), TEAM, 'schema-invitee', ACTOR, AT + 60000);

  const seatOrderLayer = peelSeatOrderSchema(db);
  const layer = peelSeatCapacitySchema(db);
  assert.deepEqual(seatCapacityDefinitions(db), []);
  const before = snapshot(db);
  assert.equal(before.tables.length, 89);
  assert.equal(before.definitions.length, 355);
  assert.equal(store.readAnnualOrder(db, TEAM, order.id).status, 'paid');

  initializeTeamDatabase(db);
  assertSeatCapacitySchemaRestored(db, layer);
  assertSeatOrderSchemaRestored(db, seatOrderLayer);
  const upgraded = snapshot(db);
  assert.deepEqual(withoutEmptySeatCapacityLayer(db, withoutEmptySeatOrderLayer(db, upgraded)), before);
  initializeTeamDatabase(db);
  assert.deepEqual(snapshot(db), upgraded);
  assertIntegrity(db);
});

test('capacity grant constraints reject unsafe counts, timestamps, IDs and missing teams', async t => {
  const {db} = await database(t);
  const insert = db.prepare('INSERT INTO team_seat_capacity_grants VALUES (?,?,?,?,?,?,?,?)');
  for (const invalid of [
    {seats: 0}, {seats: 2.5}, {seats: Number.MAX_SAFE_INTEGER + 1},
    {startsAt: -1}, {endsAt: AT}, {endsAt: AT - 1},
    {grantId: '12345678-1234-1234-8234-1234567890ab'}, {teamId: 'missing-capacity-team'},
    {sourceRef: ''}, {sourceRef: 'invalid\0ref'},
  ]) {
    assert.throws(() => insert.run(...grant(invalid)), /constraint|cannot store/i);
  }
  assertSeatCapacitySchema(db);
  assertIntegrity(db);
});

test('inserted grants survive reinitialization and resist update, delete and replacement', async t => {
  const {db, initializeTeamDatabase} = await database(t);
  const input = grant();
  db.prepare('INSERT INTO team_seat_capacity_grants VALUES (?,?,?,?,?,?,?,?)').run(...input);
  const rowid = db.prepare('SELECT rowid FROM team_seat_capacity_grants').get().rowid;
  const before = snapshot(db);
  assertSeatCapacitySchema(db, {empty: false});
  db.exec('PRAGMA recursive_triggers=OFF');
  for (const attempt of [
    () => db.exec('UPDATE team_seat_capacity_grants SET seats=2'),
    () => db.exec('DELETE FROM team_seat_capacity_grants'),
    () => db.prepare('INSERT OR REPLACE INTO team_seat_capacity_grants VALUES (?,?,?,?,?,?,?,?)')
      .run(...grant({grantId: input[0], seats: 2})),
    () => db.prepare(`INSERT OR REPLACE INTO team_seat_capacity_grants(
      rowid,grant_id,team_id,seats,starts_at,ends_at,recorded_at,source_ref,request_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?)`).run(rowid, ...grant({seats: 2})),
  ]) {
    assert.throws(attempt, /SEAT_CAPACITY_GRANTS_IMMUTABLE/);
    assert.deepEqual(snapshot(db), before);
  }
  initializeTeamDatabase(db);
  assert.deepEqual(snapshot(db), before);
  assertIntegrity(db);
});

for (const kind of ['nonempty', 'unknown attached index', 'replaced guard']) {
  test('historical projection refuses ' + kind + ' capacity schema before any DROP', async t => {
    const {db} = await database(t);
    if (kind === 'nonempty') {
      db.prepare('INSERT INTO team_seat_capacity_grants VALUES (?,?,?,?,?,?,?,?)').run(...grant());
    } else if (kind === 'unknown attached index') {
      db.exec('CREATE INDEX unrelated_index ON team_seat_capacity_grants(seats)');
    } else {
      db.exec(`DROP TRIGGER seat_capacity_grants_no_update;
        CREATE TRIGGER seat_capacity_grants_no_update
        BEFORE UPDATE ON team_seat_capacity_grants BEGIN SELECT 1; END`);
    }
    const before = snapshot(db);
    const version = db.prepare('PRAGMA schema_version').get().schema_version;
    const changes = db.prepare('SELECT total_changes() n').get().n;
    for (const project of [
      () => withoutEmptySeatCapacityDefinitions(db, before.definitions),
      () => withoutEmptySeatCapacityLayer(db, before),
      () => peelSeatCapacitySchema(db),
      () => peelLedgerAndWorkpaperSchema(db),
    ]) {
      assert.throws(project);
      assert.equal(db.prepare('PRAGMA schema_version').get().schema_version, version);
      assert.equal(db.prepare('SELECT total_changes() n').get().n, changes);
      assert.deepEqual(snapshot(db), before);
    }
    assertIntegrity(db);
  });
}
