'use strict';
// Real authorized application fixtures; all recovery products remain offline.
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const sqlite=require('node:sqlite'),{DatabaseSync}=sqlite;
const {pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const {entriesFixture,good,restorePasswordWork}=require('./helpers/workpaper-entries-fixture.cjs');
const {createTeamMaterialsFixture}=require('./helpers/team-materials-fixture.cjs');
const {createLedgerFixture,savedSnapshot}=require('./helpers/ledger-check-fixture.cjs');
after(restorePasswordWork);
const api=import(pathToFileURL(path.resolve(__dirname,'../server/team/offline-backup.mjs')).href);
const BASE=path.join(require('node:fs').realpathSync(os.tmpdir()),'shenyi-offline-business-tests');
const sha=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>'"'+x.replaceAll('"','""')+'"';
function fingerprint(db){
 const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
 const tables=schema.filter(x=>x.type==='table').map(({name})=>{const s=db.prepare('SELECT * FROM '+quote(name));s.setReadBigInts(true);const rows=s.all().map(row=>JSON.stringify(Object.keys(row).sort().map(k=>{const v=row[k];return[k,typeof v==='bigint'?['integer',v.toString()]:v instanceof Uint8Array?['blob',Buffer.from(v).toString('base64')]:[typeof v,v]];}))).sort();return{name,rowCount:rows.length,rowSha256:sha(rows.join('\n'))};});
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 return{schemaSha256:sha(JSON.stringify(schema)),tables};
}
async function own(){await fs.mkdir(BASE,{recursive:true});return fs.mkdtemp(path.join(BASE,'business-'));}
async function persisted(f,directory){const filename=path.join(directory,'source.sqlite');await sqlite.backup(f.db,filename);return filename;}
async function roundtrip(f,{inspect=()=>{},label='business'}={}){
 const directory=await own(),sourceDatabase=await persisted(f,directory),sourceBefore=sha(await fs.readFile(sourceDatabase)),expected=fingerprint(f.db),tool=await api;
 const made=await tool.createOfflineBackup({sourceDatabase,outputRoot:path.join(directory,'products')});assert.equal(made.offlineOnly,true);assert.equal(made.onlineCutoverSupported,false);assert.equal(made.containsCredentials,true);assert.ok(made.tableCount>=84);
 assert.equal(sha(await fs.readFile(sourceDatabase)),sourceBefore);
 const verified=await tool.verifyOfflineBackup({bundleDirectory:made.directory});assert.equal(verified.databaseSha256,made.databaseSha256);
 // A missing source path must not prevent recovery from the independent backup.
 const preserved=path.join(directory,'original-source-preserved.sqlite');await fs.rename(sourceDatabase,preserved);await assert.rejects(fs.stat(sourceDatabase),{code:'ENOENT'});
 const restored=await tool.rehearseOfflineRestore({bundleDirectory:made.directory,outputRoot:path.join(directory,'products')});assert.notEqual(restored.directory,made.directory);assert.equal(restored.offlineOnly,true);assert.equal(restored.onlineCutoverSupported,false);
 assert.equal(sha(await fs.readFile(restored.databasePath)),made.databaseSha256);assert.equal(sha(await fs.readFile(preserved)),sourceBefore);
 const db=new DatabaseSync(restored.databasePath,{readOnly:true});try{assert.deepEqual(fingerprint(db),expected);inspect(db);assert.throws(()=>db.exec("UPDATE teams SET status='active'"));}finally{db.close();}
 await fs.writeFile(path.join(directory,'business-evidence.json'),JSON.stringify({label,sourceBefore,backup:made,rehearsal:restored,allTablesAndSchemaMatch:true,sourceUnavailableDuringRehearsal:true,sourcePreserved:true,onlineStarted:false},null,2)+'\n');
 return{directory,made,restored};
}

test('offline recovery preserves original ZIPs, supplemental bytes, saved entries, UUIDs, CAS and the complete two-version history',{timeout:60000},async t=>{
 const f=await entriesFixture(t);good(await f.write(),201);assert.equal(f.head(),2);
 const original=f.db.prepare('SELECT * FROM team_workpaper_data_originals ORDER BY sha256').all();assert.ok(original.length>=2);assert.ok(original.some(x=>sha(x.bytes)===f.H));
 await roundtrip(f,{label:'saved-workpaper-history',inspect(db){const versions=db.prepare('SELECT * FROM team_workpaper_data_versions ORDER BY version').all();assert.deepEqual(versions.map(x=>x.version),[1,2]);assert.ok(versions[1].record_json.includes('saved original sheet answer'));const raw=Buffer.from(db.prepare('SELECT bytes FROM team_workpaper_data_originals WHERE sha256=?').get(f.H).bytes);assert.deepEqual(raw,f.raw);assert.ok(raw.includes(f.document.bytes));assert.equal(sha(f.document.bytes),f.document.sha256);assert.equal(db.prepare('SELECT source_project_id FROM team_workpaper_data_heads').get().source_project_id,f.sourceProjectId);}});
});
test('offline recovery preserves the existing professional freeze snapshot without creating or reopening a freeze',{timeout:60000},async t=>{
 const f=await entriesFixture(t,{freeze:true}),before=f.db.prepare('SELECT record_json FROM team_workpaper_data_versions WHERE version=1').get().record_json;assert.ok(JSON.parse(before).workpaperLocks['8']);
 await roundtrip(f,{label:'existing-freeze',inspect(db){const row=db.prepare('SELECT record_json FROM team_workpaper_data_versions WHERE version=1').get();assert.equal(row.record_json,before);assert.equal(db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_versions').get().n,1);}});
});
test('offline recovery preserves imported materials, verified item state, close state, originals and audit history',{timeout:60000},async t=>{
 const f=await createTeamMaterialsFixture(t);assert.equal((await f.grant(f.owner)).status,200);const pack=await f.pack(),staged=await f.stage(f.owner,pack);assert.equal((await f.commit(f.owner,staged.requestId)).status,201);
 assert.equal((await f.action(f.owner,{type:'item',id:'n2',status:'confirmed',evidence:'合成恢复演练核对',reason:''})).status,200);assert.equal((await f.action(f.owner,{type:'close'})).status,200);
 const row=f.db.prepare('SELECT * FROM team_material_records').get();assert.ok(JSON.parse(row.record_json).closed);assert.ok(f.db.prepare('SELECT COUNT(*) n FROM team_material_files').get().n>0);
 await roundtrip(f,{label:'materials-and-closed-history',inspect(db){assert.equal(db.prepare('SELECT record_json FROM team_material_records').get().record_json,row.record_json);assert.ok(db.prepare('SELECT COUNT(*) n FROM team_material_events').get().n>=3);}});
});
test('offline recovery preserves immutable ledger snapshots and grants without running reconciliation or writing workpapers',{timeout:60000},async t=>{
 const f=await createLedgerFixture(t);good(await f.ledgerGrant());good(await f.ledgerImport(),201);good(await f.ledgerImport({sourceJson:await savedSnapshot(f.sourceProjectId,{workspaceRevision:8})}),201);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_ledger_check_snapshots').get().n,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_heads').get().n,0);
 await roundtrip(f,{label:'ledger-read-only-snapshots',inspect(db){assert.deepEqual(db.prepare('SELECT version FROM team_ledger_check_snapshots ORDER BY version').all().map(x=>x.version),[1,2]);assert.equal(db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_heads').get().n,0);}});
});
test('historical credentials and deactivation remain historical; offline rehearsal does not claim safe production cutover',{timeout:60000},async t=>{
 const f=await entriesFixture(t),directory=await own(),sourceDatabase=await persisted(f,directory),tool=await api;
 const oldCredential=f.db.prepare("SELECT password_hash FROM team_credentials WHERE user_id='manager-a'").get().password_hash;
 const made=await tool.createOfflineBackup({sourceDatabase,outputRoot:path.join(directory,'products')});
 const writer=new DatabaseSync(sourceDatabase);try{const {hashPassword}=await import(pathToFileURL(path.resolve(__dirname,'../server/team/passwords.mjs')).href);const changed=await hashPassword('SyntheticChanged!2026');writer.prepare("UPDATE team_credentials SET password_hash=? WHERE user_id='manager-a'").run(changed);writer.prepare("UPDATE team_users SET status='disabled' WHERE user_id='manager-a'").run();assert.notEqual(writer.prepare("SELECT password_hash FROM team_credentials WHERE user_id='manager-a'").get().password_hash,oldCredential);
 const restored=await tool.rehearseOfflineRestore({bundleDirectory:made.directory,outputRoot:path.join(directory,'products')});const db=new DatabaseSync(restored.databasePath,{readOnly:true});try{assert.equal(db.prepare("SELECT password_hash FROM team_credentials WHERE user_id='manager-a'").get().password_hash,oldCredential);assert.equal(db.prepare("SELECT status FROM team_users WHERE user_id='manager-a'").get().status,'active');assert.equal(restored.onlineCutoverSupported,false);assert.equal(restored.offlineOnly,true);}finally{db.close();}assert.equal(writer.prepare("SELECT status FROM team_users WHERE user_id='manager-a'").get().status,'disabled');}finally{writer.close();}
});
test('real paged SQLite backup remains one consistent committed snapshot while another WAL connection commits',{timeout:60000},async t=>{
 const f=await entriesFixture(t),directory=await own(),sourceDatabase=await persisted(f,directory),writer=new DatabaseSync(sourceDatabase),tool=await api;
 writer.exec('PRAGMA journal_mode=WAL;CREATE TABLE team_backup_consistency_probe(id TEXT PRIMARY KEY,generation INTEGER NOT NULL,payload BLOB NOT NULL)');const insert=writer.prepare('INSERT INTO team_backup_consistency_probe VALUES(?,?,?)');for(const id of ['left','right'])insert.run(id,0,Buffer.alloc(2*1024*1024,0x31));
 let commitInsideProgress=false,progressCalls=0;t.after(()=>writer.close());
 const made=await tool.createOfflineBackup({sourceDatabase,outputRoot:path.join(directory,'products'),onProgress(state){assert.ok(Object.isFrozen(state));assert.deepEqual(Object.keys(state).sort(),['remainingPages','totalPages']);assert.ok(Number.isSafeInteger(state.remainingPages)&&Number.isSafeInteger(state.totalPages));progressCalls++;if(!commitInsideProgress&&state.remainingPages>1){writer.exec("BEGIN IMMEDIATE;UPDATE team_backup_consistency_probe SET generation=1;COMMIT");commitInsideProgress=true;}}});assert.equal(commitInsideProgress,true);assert.ok(progressCalls>1);const restored=await tool.rehearseOfflineRestore({bundleDirectory:made.directory,outputRoot:path.join(directory,'products')});const db=new DatabaseSync(restored.databasePath,{readOnly:true});try{const rows=db.prepare('SELECT id,generation,length(payload) n FROM team_backup_consistency_probe ORDER BY id').all();assert.equal(rows.length,2);assert.equal(rows[0].generation,rows[1].generation);assert.ok([0,1].includes(rows[0].generation));assert.ok(rows.every(x=>x.n===2*1024*1024));assert.equal(writer.prepare('SELECT MIN(generation) n FROM team_backup_consistency_probe').get().n,1);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{db.close();}
});

test('a failing observer cannot publish a ready bundle or expose its private exception',{timeout:60000},async t=>{
 const f=await entriesFixture(t),directory=await own(),sourceDatabase=await persisted(f,directory),tool=await api,outputRoot=path.join(directory,'products'),before=sha(await fs.readFile(sourceDatabase));let observed=0;
 await assert.rejects(tool.createOfflineBackup({sourceDatabase,outputRoot,onProgress(){observed++;throw Error('SYNTHETIC_CALLBACK_DETAIL');}}),error=>error.code==='BACKUP_FAILED'&&!error.message.includes('SYNTHETIC_CALLBACK_DETAIL'));assert.ok(observed>0);assert.equal(sha(await fs.readFile(sourceDatabase)),before);
 const names=await fs.readdir(outputRoot);assert.equal(names.length,1);const bundleDirectory=path.join(outputRoot,names[0]);await assert.rejects(tool.verifyOfflineBackup({bundleDirectory}));await assert.rejects(tool.rehearseOfflineRestore({bundleDirectory,outputRoot:path.join(directory,'rehearsals')}));
});
