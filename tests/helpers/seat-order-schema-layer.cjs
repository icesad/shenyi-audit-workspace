'use strict';

const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');

const TABLES = Object.freeze(['team_seat_orders', 'team_seat_verified_payments']);
const EXPECTED_DDL_SHA = 'f72c8b7b84cf3062eccef248fb5a09b84ede3fddc560213f13956e8f9104ce80';

function seatOrderDefinitions(db) {
  return db.prepare(`
SELECT type,name,tbl_name,sql FROM sqlite_schema
WHERE sql IS NOT NULL AND (
  name GLOB 'seat_orders_*' OR name GLOB 'team_seat_orders*'
  OR name GLOB 'seat_verified_payments_*' OR name GLOB 'team_seat_verified_payments*'
  OR tbl_name IN ('team_seat_orders','team_seat_verified_payments')
)
ORDER BY type,name`).all().map(row => ({...row}));
}

function assertSeatOrderSchema(db, {allowAbsent = false, empty = true} = {}) {
  const definitions = seatOrderDefinitions(db);
  if (allowAbsent && definitions.length === 0) return definitions;
  assert.deepEqual(definitions.map(row => [row.type, row.name]), [
    ...TABLES.map(name => ['table', name]),
    ['trigger', 'seat_orders_no_delete'],
    ['trigger', 'seat_orders_no_replace'],
    ['trigger', 'seat_orders_no_update'],
    ['trigger', 'seat_verified_payments_no_delete'],
    ['trigger', 'seat_verified_payments_no_replace'],
    ['trigger', 'seat_verified_payments_no_update'],
  ]);
  assert.equal(createHash('sha256').update(JSON.stringify(definitions)).digest('hex'), EXPECTED_DDL_SHA,
    'Only the reviewed exact seat order DDL may be projected');
  const tables = db.prepare('PRAGMA table_list').all().filter(row => TABLES.includes(row.name));
  assert.equal(tables.length, TABLES.length);
  for (const table of tables) {
    assert.equal(table.schema, 'main');
    assert.equal(table.strict, 1);
    assert.equal(table.wr, 0);
  }
  if (empty) for (const table of TABLES) {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM main.' + table).get().n, 0,
      'No seat order or verified seat payment history may be projected');
  }
  return definitions;
}

function seatOrderSchemaLayer(db, options) {
  const definitions = assertSeatOrderSchema(db, options);
  return {tables: definitions.length ? TABLES.length : 0, objects: definitions.length};
}

function withoutEmptySeatOrderDefinitions(db, definitions) {
  const names = new Set(assertSeatOrderSchema(db, {allowAbsent: true}).map(row => row.name));
  return definitions.filter(row => !names.has(row.name));
}

function withoutEmptySeatOrderLayer(db, state) {
  const names = new Set(assertSeatOrderSchema(db, {allowAbsent: true}).map(row => row.name));
  if (names.size === 0) return state;
  const filterDefinitions = rows => rows.filter(row => !names.has(row.name));
  return {
    ...state,
    ...(state.definitions ? {definitions: filterDefinitions(state.definitions)} : {}),
    ...(state.schema ? {schema: filterDefinitions(state.schema)} : {}),
    ...(state.tables ? {
      tables: state.tables.filter(row => !TABLES.includes(typeof row === 'string' ? row : row.name)),
    } : {}),
  };
}

function peelSeatOrderSchema(db) {
  const definitions = assertSeatOrderSchema(db);
  db.exec('DROP TABLE main.team_seat_verified_payments; DROP TABLE main.team_seat_orders');
  assert.deepEqual(seatOrderDefinitions(db), []);
  return {definitions, tables: [...TABLES]};
}

function assertSeatOrderSchemaRestored(db, layer) {
  assert.deepEqual(assertSeatOrderSchema(db), layer.definitions);
}

module.exports = {
  TABLES, seatOrderDefinitions, assertSeatOrderSchema, seatOrderSchemaLayer,
  withoutEmptySeatOrderDefinitions, withoutEmptySeatOrderLayer, peelSeatOrderSchema,
  assertSeatOrderSchemaRestored,
};
