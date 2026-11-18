'use strict';

const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');

const TABLE = 'team_annual_order_seat_plans';
const EXPECTED_DDL_SHA = 'b04d3d87f72c0d2318e496f3a0ed87a79dc8339265464bd8059edb24c92d389a';

function annualSeatPlanDefinitions(db) {
  return db.prepare(`
SELECT type,name,tbl_name,sql FROM sqlite_schema
WHERE sql IS NOT NULL AND (
  name GLOB 'annual_seat_plans_*' OR name GLOB 'team_annual_order_seat_plans*'
  OR tbl_name='team_annual_order_seat_plans'
)
ORDER BY type,name`).all().map(row => ({...row}));
}

function assertAnnualSeatPlanSchema(db, {allowAbsent = false, empty = true} = {}) {
  const definitions = annualSeatPlanDefinitions(db);
  if (allowAbsent && definitions.length === 0) return definitions;
  assert.deepEqual(definitions.map(row => [row.type, row.name]), [
    ['table', TABLE],
    ['trigger', 'annual_seat_plans_no_delete'],
    ['trigger', 'annual_seat_plans_no_replace'],
    ['trigger', 'annual_seat_plans_no_update'],
  ]);
  assert.equal(createHash('sha256').update(JSON.stringify(definitions)).digest('hex'), EXPECTED_DDL_SHA,
    'Only the reviewed exact annual seat plan DDL may be projected');
  const tables = db.prepare('PRAGMA table_list').all().filter(row => row.name === TABLE);
  assert.equal(tables.length, 1);
  const [table] = tables;
  assert.equal(table.schema, 'main');
  assert.equal(table.strict, 1);
  assert.equal(table.wr, 0);
  if (empty) {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM main.team_annual_order_seat_plans').get().n, 0,
      'No annual order seat plan may be projected');
  }
  return definitions;
}

function annualSeatPlanSchemaLayer(db, options) {
  const definitions = assertAnnualSeatPlanSchema(db, options);
  return {tables: definitions.length ? 1 : 0, objects: definitions.length};
}

function withoutEmptyAnnualSeatPlanDefinitions(db, definitions) {
  const names = new Set(assertAnnualSeatPlanSchema(db, {allowAbsent: true}).map(row => row.name));
  return definitions.filter(row => !names.has(row.name));
}

function withoutEmptyAnnualSeatPlanLayer(db, state) {
  const names = new Set(assertAnnualSeatPlanSchema(db, {allowAbsent: true}).map(row => row.name));
  if (names.size === 0) return state;
  const filterDefinitions = rows => rows.filter(row => !names.has(row.name));
  return {
    ...state,
    ...(state.definitions ? {definitions: filterDefinitions(state.definitions)} : {}),
    ...(state.schema ? {schema: filterDefinitions(state.schema)} : {}),
    ...(state.tables ? {
      tables: state.tables.filter(row => (typeof row === 'string' ? row : row.name) !== TABLE),
    } : {}),
  };
}

function peelAnnualSeatPlanSchema(db) {
  const definitions = assertAnnualSeatPlanSchema(db);
  db.exec('DROP TABLE main.team_annual_order_seat_plans');
  assert.deepEqual(annualSeatPlanDefinitions(db), []);
  return {definitions, tables: [TABLE]};
}

function assertAnnualSeatPlanSchemaRestored(db, layer) {
  assert.deepEqual(assertAnnualSeatPlanSchema(db), layer.definitions);
}

module.exports = {
  TABLE, annualSeatPlanDefinitions, assertAnnualSeatPlanSchema, annualSeatPlanSchemaLayer,
  withoutEmptyAnnualSeatPlanDefinitions, withoutEmptyAnnualSeatPlanLayer, peelAnnualSeatPlanSchema,
  assertAnnualSeatPlanSchemaRestored,
};
