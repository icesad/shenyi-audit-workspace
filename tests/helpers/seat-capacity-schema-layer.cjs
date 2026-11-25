'use strict';

const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');

const TABLE = 'team_seat_capacity_grants';
const EXPECTED_DDL_SHA = '732869c4a5505a392b9e640b5e701b916d684c1ec00ced9cea30d86e4a9cd03c';

function seatCapacityDefinitions(db) {
  return db.prepare(`
SELECT type,name,tbl_name,sql FROM sqlite_schema
WHERE sql IS NOT NULL AND (
  name GLOB 'seat_capacity_*' OR name GLOB 'team_seat_capacity_*'
  OR tbl_name='team_seat_capacity_grants'
)
ORDER BY type,name`).all().map(row => ({...row}));
}

// Historical tests may omit only the reviewed layer and only when it is empty.
function assertSeatCapacitySchema(db, {allowAbsent = false, empty = true} = {}) {
  const definitions = seatCapacityDefinitions(db);
  if (allowAbsent && definitions.length === 0) return definitions;
  assert.deepEqual(definitions.map(row => [row.type, row.name]), [
    ['index', 'seat_capacity_grants_team_interval'],
    ['table', TABLE],
    ['trigger', 'seat_capacity_grants_no_delete'],
    ['trigger', 'seat_capacity_grants_no_replace'],
    ['trigger', 'seat_capacity_grants_no_update'],
  ]);
  assert.equal(createHash('sha256').update(JSON.stringify(definitions)).digest('hex'), EXPECTED_DDL_SHA,
    'Only the reviewed exact seat capacity DDL may be projected');
  const matches = db.prepare('PRAGMA table_list').all().filter(row => row.name === TABLE);
  assert.equal(matches.length, 1);
  const [table] = matches;
  assert.equal(table.schema, 'main');
  assert.equal(table.strict, 1);
  assert.equal(table.wr, 0);
  if (empty) {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM team_seat_capacity_grants').get().n, 0,
      'No seat capacity grants may be projected');
  }
  return definitions;
}

function seatCapacitySchemaLayer(db, options) {
  const definitions = assertSeatCapacitySchema(db, options);
  return {tables: definitions.length ? 1 : 0, objects: definitions.length};
}

function withoutEmptySeatCapacityDefinitions(db, definitions) {
  const names = new Set(assertSeatCapacitySchema(db, {allowAbsent: true}).map(row => row.name));
  return definitions.filter(row => !names.has(row.name));
}

function withoutEmptySeatCapacityLayer(db, state) {
  const names = new Set(assertSeatCapacitySchema(db, {allowAbsent: true}).map(row => row.name));
  if (names.size === 0) return state;
  const filterDefinitions = rows => rows.filter(row => !names.has(row.name));
  return {
    ...state,
    ...(state.definitions ? {definitions: filterDefinitions(state.definitions)} : {}),
    ...(state.schema ? {schema: filterDefinitions(state.schema)} : {}),
    ...(state.tables ? {tables: state.tables.filter(row => (typeof row === 'string' ? row : row.name) !== TABLE)} : {}),
  };
}

function peelSeatCapacitySchema(db) {
  const definitions = assertSeatCapacitySchema(db);
  // The table owns the validated attached index and triggers.
  db.exec('DROP TABLE main.team_seat_capacity_grants');
  assert.deepEqual(seatCapacityDefinitions(db), []);
  return {definitions, tables: [TABLE]};
}

function assertSeatCapacitySchemaRestored(db, layer) {
  assert.deepEqual(assertSeatCapacitySchema(db), layer.definitions);
}

module.exports = {
  TABLE, seatCapacityDefinitions, assertSeatCapacitySchema, seatCapacitySchemaLayer,
  withoutEmptySeatCapacityDefinitions, withoutEmptySeatCapacityLayer, peelSeatCapacitySchema,
  assertSeatCapacitySchemaRestored,
};
