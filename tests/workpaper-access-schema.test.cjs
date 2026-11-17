const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {createWorkpaperAccessFixture:fixture,good,denied,source,restorePasswordWork}=require('./helpers/workpaper-access-fixture.cjs');
const {withoutEmptyDataDefinitions}=require('./helpers/workpaper-data-schema-layer.cjs');
after(restorePasswordWork);
const defs=db=>withoutEmptyDataDefinitions(db,db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(x=>({...x})));
function typedRows(db,names){return names.map(name=>{const query=db.prepare('SELECT * FROM "'+name+'"');query.setReadBigInts(true);return{name,rows:query.all().map(row=>JSON.stringify(Object.keys(row).sort().map(key=>[key,typeof row[key]==='bigint'?['integer',String(row[key])]:row[key] instanceof Uint8Array?['blob',Buffer.from(row[key]).toString('base64')]:row[key]]))).sort()};});}

test('upgrade adds only two empty tables and 29 definitions; all old 77 typed tables and 290 DDL persist',async t=>{
 const f=await fixture(t),{initializeTeamDatabase}=await source('database.mjs');
 const layer=defs(f.db).filter(x=>x.name.startsWith('workpaper_access_')||x.name.startsWith('team_workpaper_access_'));assert.equal(layer.length,29);
 for(const x of layer.filter(x=>x.type==='trigger'))f.db.exec('DROP TRIGGER "'+x.name+'"');
 f.db.exec('DROP TABLE team_workpaper_access_events; DROP TABLE team_workpaper_access_grants');
 const beforeDefs=defs(f.db),oldTables=beforeDefs.filter(x=>x.type==='table').map(x=>x.name),beforeRows=typedRows(f.db,oldTables);assert.equal(oldTables.length,77);assert.equal(beforeDefs.length,290);
 initializeTeamDatabase(f.db);assert.deepEqual(defs(f.db).filter(x=>!x.name.startsWith('workpaper_access_')&&!x.name.startsWith('team_workpaper_access_')),beforeDefs);assert.deepEqual(typedRows(f.db,oldTables),beforeRows);
 assert.equal(defs(f.db).length,319);assert.deepEqual(f.wpRows().map(x=>x.rows),[[],[]]);const afterDefs=defs(f.db),afterRows=typedRows(f.db,defs(f.db).filter(x=>x.type==='table').map(x=>x.name));initializeTeamDatabase(f.db);assert.deepEqual(defs(f.db),afterDefs);assert.deepEqual(typedRows(f.db,afterRows.map(x=>x.name)),afterRows);
 assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('grant identity/history and audit are immutable, including INSERT OR REPLACE',async t=>{
 const f=await fixture(t);good(await f.wpGrant());const before=f.wpRows();
 for(const sql of ['DELETE FROM team_workpaper_access_grants',"UPDATE team_workpaper_access_grants SET user_id='partner-a'",'UPDATE team_workpaper_access_grants SET revision=revision','UPDATE team_workpaper_access_events SET reason=reason','DELETE FROM team_workpaper_access_events'])assert.throws(()=>f.db.exec(sql));
 assert.throws(()=>f.db.prepare('INSERT OR REPLACE INTO team_workpaper_access_grants VALUES (?,?,?,1,1,1,1,1)').run('team-a',f.projectId,f.user));assert.deepEqual(f.wpRows(),before);
});

for(const column of ['can_read','can_write','can_export','eligible'])test('schema rejects non-boolean '+column,async t=>{
 const f=await fixture(t);const columns=['team_id','project_id','user_id','can_read','can_write','can_export','eligible','revision'],values=['team-a',f.projectId,f.user,0,0,0,1,1];values[columns.indexOf(column)]=2;assert.throws(()=>f.db.prepare('INSERT INTO team_workpaper_access_grants('+columns.join(',')+') VALUES (?,?,?,?,?,?,?,?)').run(...values));assert.deepEqual(f.wpRows().map(x=>x.rows),[[],[]]);
});

test('grant revision exhaustion rejects authorization without partial writes',async t=>{
 const f=await fixture(t);good(await f.wpGrant());const trigger=f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='workpaper_access_grant_monotonic'").get().sql;f.db.exec('DROP TRIGGER workpaper_access_grant_monotonic');f.db.exec('UPDATE team_workpaper_access_grants SET revision=9007199254740991');f.db.exec(trigger);const before=f.wpRows();denied(await f.wpGrant(f.user,{write:true}),409);assert.deepEqual(f.wpRows(),before);
});

for(const history of ['grant','event'])test('orphan '+history+' history alone prevents automatic server UUID recreation',async t=>{
 const {DatabaseSync}=require('node:sqlite'),{initializeTeamDatabase}=await source('database.mjs'),db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);db.exec('PRAGMA foreign_keys=OFF');
 if(history==='grant')db.prepare('INSERT INTO team_workpaper_access_grants VALUES (?,?,?,1,1,1,1,1)').run('orphan-team','orphan-project','orphan-user');
 else db.prepare("INSERT INTO team_workpaper_access_events(event_id,team_id,project_id,actor_id,target_user_id,action,before_revision,after_revision,read_before,read_after,write_before,write_after,export_before,export_after,eligible_before,eligible_after,project_revision,reason,created_at) VALUES (?,?,?,?,?,'access.changed',0,1,0,1,0,1,0,1,0,1,1,'',1)").run('orphan-event','orphan-team','orphan-project','orphan-actor','orphan-user');
 db.prepare("DELETE FROM team_database_metadata WHERE name='device-server-id'").run();
 const beforeDefs=defs(db),before=typedRows(db,beforeDefs.filter(x=>x.type==='table').map(x=>x.name));assert.throws(()=>initializeTeamDatabase(db),/Device history has no server identity/);assert.deepEqual(typedRows(db,before.map(x=>x.name)),before);assert.deepEqual(defs(db),beforeDefs);assert.equal(db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get(),undefined);
});
