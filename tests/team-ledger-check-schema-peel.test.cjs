'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {peelLedgerAndWorkpaperSchema:peelLedgerCheckSchema,assertLedgerAndWorkpaperSchemaRestored:assertLedgerCheckSchemaRestored}=require('./helpers/workpaper-access-schema-layer.cjs');
const {source}=require('./helpers/project-access-fixture.cjs');
const {createLedgerFixture,good}=require('./helpers/ledger-check-fixture.cjs');
const {withoutEmptySubscriptionDefinitions}=require('./helpers/subscription-schema-layer.cjs');
const schema=db=>withoutEmptySubscriptionDefinitions(db,db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({...row})));
test('historical reconstruction removes only four empty ledger tables and restores their exact DDL',async t=>{
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs'),db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);await seedDemoTeamData(db);const before=schema(db),layer=peelLedgerCheckSchema(db),old=schema(db);
 assert.equal(old.length,252);assert.equal(old.filter(x=>x.type==='table').length,73);assert.deepEqual(old,before.filter(x=>!layer.names.includes(x.name)));
 initializeTeamDatabase(db);assertLedgerCheckSchemaRestored(db,layer);assert.deepEqual(schema(db),before);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('historical reconstruction rejects nonempty ledger grants before deleting any schema or data',async t=>{
 const f=await createLedgerFixture(t);good(await f.ledgerGrant());const before=schema(f.db),rows=f.moduleRows();assert.throws(()=>peelLedgerCheckSchema(f.db),/No default ledger grant/);assert.deepEqual(schema(f.db),before);assert.deepEqual(f.moduleRows(),rows);
});
test('an unexpected ledger object is rejected before any destructive historical reconstruction',async t=>{
 const {initializeTeamDatabase}=await source('database.mjs'),db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);db.exec("CREATE TRIGGER ledger_check_unexpected AFTER INSERT ON team_users BEGIN SELECT 1; END");const before=schema(db);assert.throws(()=>peelLedgerCheckSchema(db));assert.deepEqual(schema(db),before);
});
