'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {createWorkspaceSourceFixture,source,uuid,restorePasswordWork}=require('./helpers/workspace-source-fixture.cjs');
after(restorePasswordWork);
const definitions=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY type,name").all().map(r=>({...r}));
const tableNames=db=>db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
const snapshot=(db,names)=>names.map(name=>{const statement=db.prepare('SELECT * FROM "'+name+'"');statement.setReadBigInts(true);return {name,rows:statement.all().map(row=>JSON.stringify(Object.keys(row).sort().map(k=>[k,typeof row[k]==='bigint'?['integer',String(row[k])]:row[k] instanceof Uint8Array?['blob',Buffer.from(row[k]).toString('base64')]:row[k]]))).sort()};});
test('source initialization adds exactly two empty tables and 29 objects while every old typed row definition and UUID stays exact',async t=>{
 const f=await createWorkspaceSourceFixture(t),{initializeTeamDatabase}=await source('database.mjs'),all=definitions(f.db),newObjects=all.filter(r=>r.name.startsWith('workspace_source_')||r.name.startsWith('team_workspace_source_'));
 assert.equal(tableNames(f.db).length,73);assert.equal(all.length,252);assert.equal(newObjects.length,29);assert.equal(newObjects.filter(r=>r.type==='trigger').length,26);assert.equal(newObjects.filter(r=>r.type==='index').length,1);
 const oldNames=tableNames(f.db).filter(n=>!n.startsWith('team_workspace_source_')),oldDefinitions=all.filter(r=>!newObjects.includes(r)),oldRows=snapshot(f.db,oldNames),serverId=f.db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value;
 for(const r of newObjects.filter(r=>r.type==='trigger'))f.db.exec('DROP TRIGGER "'+r.name+'"');f.db.exec('DROP TABLE team_workspace_source_events; DROP TABLE team_workspace_source_grants');
 assert.equal(tableNames(f.db).length,71);assert.equal(definitions(f.db).length,223);assert.deepEqual(definitions(f.db),oldDefinitions);assert.deepEqual(snapshot(f.db,oldNames),oldRows);
 initializeTeamDatabase(f.db);assert.deepEqual(definitions(f.db),all);assert.deepEqual(snapshot(f.db,oldNames),oldRows);assert.equal(f.db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value,serverId);
 assert.equal(f.db.prepare('SELECT count(*) n FROM team_workspace_source_grants').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM team_workspace_source_events').get().n,0);initializeTeamDatabase(f.db);assert.deepEqual(definitions(f.db),all);assert.deepEqual(snapshot(f.db,oldNames),oldRows);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
for(const table of ['team_workspace_source_grants','team_workspace_source_events'])test('orphan '+table+' is retained history and prevents a replacement server UUID',async t=>{
 const {initializeTeamDatabase}=await source('database.mjs'),db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);db.exec('PRAGMA foreign_keys=OFF');
 if(table.endsWith('grants'))db.prepare('INSERT INTO team_workspace_source_grants VALUES (?,?,?,1,0,1,1)').run('orphan-team','orphan-project','orphan-user');
 else db.prepare("INSERT INTO team_workspace_source_events VALUES (?,?,?,?,?,'access.changed',0,1,0,0,1,0,1,'',1)").run(uuid(),'orphan-team','orphan-project','orphan-actor','orphan-target');
 db.prepare("DELETE FROM team_database_metadata WHERE name='device-server-id'").run();const before=snapshot(db,[table]),defs=definitions(db);assert.throws(()=>initializeTeamDatabase(db),/Device history has no server identity/);assert.equal(db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get(),undefined);assert.deepEqual(snapshot(db,[table]),before);assert.deepEqual(definitions(db),defs);
});
