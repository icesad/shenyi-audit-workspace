'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const {source}=require('./helpers/project-access-fixture.cjs');
function state(db){
 const definitions=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
 const tables=definitions.filter(x=>x.type==='table').map(({name})=>{const q=db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid');q.setReadBigInts(true);const rows=q.all().map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='bigint'?['integer',v.toString()]:v instanceof Uint8Array?['blob',v.byteLength,createHash('sha256').update(v).digest('hex')]:[v===null?'null':typeof v,v]])));return{name,rows};});return{definitions,tables};
}
test('new ledger schema adds only its four empty tables and 38 definitions; old typed data and DDL survive upgrade',async t=>{
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs'),db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);await seedDemoTeamData(db);
 const all=db.prepare("SELECT type,name FROM sqlite_schema WHERE name LIKE 'ledger_check_%'").all();for(const x of all)if(x.type==='trigger')db.exec('DROP TRIGGER "'+x.name+'"');for(const x of all)if(x.type==='index')db.exec('DROP INDEX "'+x.name+'"');
 for(const name of ['team_ledger_check_snapshots','team_ledger_check_heads','team_ledger_check_events','team_ledger_check_grants'])db.exec('DROP TABLE '+name);
 const before=state(db);assert.equal(before.tables.length,73);assert.equal(before.definitions.length,252);initializeTeamDatabase(db);const after=state(db);
 assert.equal(after.tables.length,77);assert.equal(after.definitions.length,290);assert.deepEqual(after.tables.filter(x=>!x.name.startsWith('team_ledger_check_')),before.tables);assert.deepEqual(after.definitions.filter(x=>!x.name.startsWith('team_ledger_check_')&&!x.name.startsWith('ledger_check_')),before.definitions);
 assert.ok(after.tables.filter(x=>x.name.startsWith('team_ledger_check_')).every(x=>x.rows.length===0));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 const once=state(db);initializeTeamDatabase(db);assert.deepEqual(state(db),once);
});
test('unknown or non-prototype databases are rejected without adding tables',async t=>{
 const {initializeTeamDatabase}=await source('database.mjs'),db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE customer_sentinel (value TEXT); INSERT INTO customer_sentinel VALUES (\'preserve\')');const before=state(db);assert.throws(()=>initializeTeamDatabase(db),/no automatic migration/);assert.deepEqual(state(db),before);
});

for(const table of ['team_ledger_check_grants','team_ledger_check_events','team_ledger_check_heads','team_ledger_check_snapshots'])test('retained orphan '+table+' prevents reissuing a missing server identity',async t=>{
 const {initializeTeamDatabase}=await source('database.mjs'),db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);db.exec('PRAGMA foreign_keys=OFF');
 if(table.endsWith('grants'))db.prepare('INSERT INTO team_ledger_check_grants VALUES (?,?,?,1,1,1)').run('orphan-team','orphan-project','orphan-user');
 else if(table.endsWith('events'))db.prepare("INSERT INTO team_ledger_check_events VALUES (?,?,?,?,?,'access.changed',0,1,0,1,1,'',1)").run('orphan-event','orphan-team','orphan-project','orphan-user','orphan-target');
 else if(table.endsWith('heads'))db.prepare('INSERT INTO team_ledger_check_heads VALUES (?,?,1)').run('orphan-team','orphan-project');
 else db.prepare('INSERT INTO team_ledger_check_snapshots VALUES (?,?,?,1,?,?,?,?,?,?,1,?,?,?,1)').run('orphan-snapshot','orphan-team','orphan-project','orphan-operation','a'.repeat(64),'{}','b'.repeat(64),'orphan-Q','c'.repeat(64),'2026-11-17T00:00:00.000Z','orphan-user','synthetic orphan');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,1);db.prepare("DELETE FROM team_database_metadata WHERE name='device-server-id'").run();const before=state(db);
 assert.throws(()=>initializeTeamDatabase(db),/Device history has no server identity/);assert.deepEqual(state(db),before);assert.equal(db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get(),undefined);
});
