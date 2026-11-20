'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net');
const {randomUUID}=require('node:crypto');
const {ROOT,api,fixture,mutateDatabase,fileHash,exists,successMarkers,createBundle,cli}=require('./helpers/offline-backup-basic-fixture.cjs');

async function rejectUnchanged(f,action){const before=await fileHash(f.sourceDatabase);await assert.rejects(action);assert.equal(await fileHash(f.sourceDatabase),before);}
async function cloneBundle(f,label){
 const parent=path.join(f.directory,label);await fs.mkdir(parent);const bundleDirectory=path.join(parent,path.basename(f.bundleDirectory));
 await fs.cp(f.bundleDirectory,bundleDirectory,{recursive:true,errorOnExist:true,force:false});
 const {verifyOfflineBackup}=await api();await verifyOfflineBackup({bundleDirectory});
 return {bundleDirectory,manifestPath:path.join(bundleDirectory,'manifest.json'),snapshotPath:path.join(bundleDirectory,path.basename(f.snapshotPath))};
}

test('missing source is rejected without creating a database',async()=>{
 const f=await fixture('missing'),missing=path.join(f.directory,'not-created.sqlite'),{createOfflineBackup}=await api();
 await assert.rejects(()=>createOfflineBackup({sourceDatabase:missing,outputRoot:f.outputRoot}));assert.equal(await exists(missing),false);assert.deepEqual(await successMarkers(f.outputRoot),[]);
});
test('directory and arbitrary non-SQLite sources are rejected without changing their contents',async()=>{
 const f=await fixture('invalid-file'),{createOfflineBackup}=await api(),bad=path.join(f.directory,'not-sqlite.bin');await fs.writeFile(bad,'synthetic invalid database\0not a customer file');const before=await fileHash(bad);
 await assert.rejects(()=>createOfflineBackup({sourceDatabase:f.directory,outputRoot:f.outputRoot}));
 await assert.rejects(()=>createOfflineBackup({sourceDatabase:bad,outputRoot:f.outputRoot}));assert.equal(await fileHash(bad),before);assert.deepEqual(await successMarkers(f.outputRoot),[]);
});
for(const [name,value]of [['demo','false'],['prototype-version','other-prototype'],['device-server-id','not-a-uuid']])test('unrecognized synthetic database metadata '+name+' fails closed',async()=>{
 const f=await fixture('bad-identity'),{createOfflineBackup}=await api();await mutateDatabase(f.sourceDatabase,db=>db.prepare('UPDATE team_database_metadata SET value=? WHERE name=?').run(value,name));
 await rejectUnchanged(f,()=>createOfflineBackup({sourceDatabase:f.sourceDatabase,outputRoot:f.outputRoot}));assert.deepEqual(await successMarkers(f.outputRoot),[]);
});
test('relative and noncanonical source/output paths are refused before any successful artifact',async()=>{
 const f=await fixture('canonical'),{createOfflineBackup}=await api();
 const badSources=[path.relative(f.directory,f.sourceDatabase),':memory:',f.directory+path.sep+'.'+path.sep+'source.sqlite'];
 for(const sourceDatabase of badSources)await rejectUnchanged(f,()=>createOfflineBackup({sourceDatabase,outputRoot:f.outputRoot}));
 for(const outputRoot of [path.relative(f.directory,f.outputRoot),f.directory+path.sep+'.'+path.sep+'artifacts'])await rejectUnchanged(f,()=>createOfflineBackup({sourceDatabase:f.sourceDatabase,outputRoot}));
 assert.deepEqual(await successMarkers(f.outputRoot),[]);
});
test('output inside the checkout is refused and does not create a repository directory',async()=>{
 const f=await fixture('repository-root'),{createOfflineBackup}=await api(),outputRoot=path.join(ROOT,'__offline-backup-refusal-'+randomUUID());
 assert.equal(await exists(outputRoot),false);await rejectUnchanged(f,()=>createOfflineBackup({sourceDatabase:f.sourceDatabase,outputRoot}));assert.equal(await exists(outputRoot),false);
});
test('actual source-parent and output-root junctions/symlinks cannot redirect the operation',async()=>{
 const f=await fixture('links'),{createOfflineBackup}=await api(),sourceParent=path.join(f.directory,'source-parent-link'),outputParent=path.join(f.directory,'output-parent-link'),backing=path.join(f.directory,'output-backing');
 await fs.mkdir(backing);await fs.symlink(f.directory,sourceParent,process.platform==='win32'?'junction':'dir');await fs.symlink(backing,outputParent,process.platform==='win32'?'junction':'dir');
 assert.equal((await fs.lstat(sourceParent)).isSymbolicLink(),true);assert.equal((await fs.lstat(outputParent)).isSymbolicLink(),true);
 await rejectUnchanged(f,()=>createOfflineBackup({sourceDatabase:path.join(sourceParent,'source.sqlite'),outputRoot:f.outputRoot}));
 await rejectUnchanged(f,()=>createOfflineBackup({sourceDatabase:f.sourceDatabase,outputRoot:outputParent}));assert.deepEqual(await fs.readdir(backing),[]);
});
test('repeated backups create distinct artifacts and preserve the source and existing sentinels',async()=>{
 const f=await fixture('fresh-artifacts'),{createOfflineBackup}=await api();await fs.mkdir(f.outputRoot);const sentinel=path.join(f.outputRoot,'existing-sentinel.txt');await fs.writeFile(sentinel,'owned sentinel must survive');const sourceHash=await fileHash(f.sourceDatabase);
 const first=await createOfflineBackup({sourceDatabase:f.sourceDatabase,outputRoot:f.outputRoot}),second=await createOfflineBackup({sourceDatabase:f.sourceDatabase,outputRoot:f.outputRoot});
 assert.notEqual(first.directory,second.directory);assert.notEqual(first.snapshotId,second.snapshotId);assert.equal(first.serverId,second.serverId);assert.equal(await fileHash(f.sourceDatabase),sourceHash);assert.equal(await fs.readFile(sentinel,'utf8'),'owned sentinel must survive');
 assert.equal(first.offlineOnly,true);assert.equal(second.onlineCutoverSupported,false);assert.ok((await fs.stat(first.databasePath)).isFile());assert.ok((await fs.stat(second.databasePath)).isFile());
 const secret=await mutateDatabase(f.sourceDatabase,db=>db.prepare("SELECT password_hash FROM team_credentials WHERE user_id='intern-a'").get().password_hash);
 for(const summary of [first,second]){const text=JSON.stringify(summary);assert.ok(!text.includes(secret));assert.ok(!text.includes('ShenyiDemo!2026'));}
});
test('verify and actual fresh restore rehearsal preserve raw bytes and historical security rows without listening',async t=>{
 const f=await createBundle('restore'),{verifyOfflineBackup,rehearseOfflineRestore}=await api(),sourceHash=await fileHash(f.sourceDatabase),snapshotHash=await fileHash(f.snapshotPath);let listens=0;
 t.mock.method(net.Server.prototype,'listen',function(){listens++;throw Error('offline tool must not create a listener');});
 const verified=await verifyOfflineBackup({bundleDirectory:f.bundleDirectory}),first=await rehearseOfflineRestore({bundleDirectory:f.bundleDirectory,outputRoot:f.outputRoot}),second=await rehearseOfflineRestore({bundleDirectory:f.bundleDirectory,outputRoot:f.outputRoot});
 assert.equal(verified.offlineOnly,true);assert.equal(first.offlineOnly,true);assert.equal(first.onlineCutoverSupported,false);assert.notEqual(first.directory,f.bundleDirectory);assert.notEqual(first.directory,second.directory);
 assert.equal(await fileHash(first.databasePath),snapshotHash);assert.equal(await fileHash(second.databasePath),snapshotHash);assert.equal(await fileHash(f.snapshotPath),snapshotHash);assert.equal(await fileHash(f.sourceDatabase),sourceHash);assert.equal(listens,0);
});
test('bundle-directory junctions/symlinks are rejected by both verify and rehearse',async()=>{
 const f=await createBundle('bundle-link'),{verifyOfflineBackup,rehearseOfflineRestore}=await api(),link=path.join(f.directory,'bundle-link');await fs.symlink(f.bundleDirectory,link,process.platform==='win32'?'junction':'dir');assert.equal((await fs.lstat(link)).isSymbolicLink(),true);
 await assert.rejects(()=>verifyOfflineBackup({bundleDirectory:link}));const outputRoot=path.join(f.directory,'rejected-rehearsal');await assert.rejects(()=>rehearseOfflineRestore({bundleDirectory:link,outputRoot}));assert.deepEqual(await successMarkers(outputRoot),[]);
});
test('missing success manifest cannot be verified or rehearsed',async()=>{
 const f=await createBundle('missing-manifest'),{verifyOfflineBackup,rehearseOfflineRestore}=await api();await fs.rename(f.manifestPath,f.manifestPath+'.retained');
 await assert.rejects(()=>verifyOfflineBackup({bundleDirectory:f.bundleDirectory}));const outputRoot=path.join(f.directory,'no-ready');await assert.rejects(()=>rehearseOfflineRestore({bundleDirectory:f.bundleDirectory,outputRoot}));assert.deepEqual(await successMarkers(outputRoot),[]);
});
test('snapshot mutation, truncation and unrelated SQLite substitution fail verification and rehearsal',async()=>{
 const f=await createBundle('bad-snapshot'),{verifyOfflineBackup,rehearseOfflineRestore}=await api();
 for(const [label,change]of [['mutation',async filename=>{const b=await fs.readFile(filename);b[Math.floor(b.length/2)]^=1;await fs.writeFile(filename,b);}],['truncation',filename=>fs.truncate(filename,256)],['substitution',filename=>fs.copyFile(f.sourceDatabase,filename)]]){
  const mutant=await cloneBundle(f,label);
  if(label==='substitution')await mutateDatabase(f.sourceDatabase,db=>db.prepare("UPDATE team_credentials SET display_name=? WHERE user_id='intern-a'").run('synthetic changed source'));
  await change(mutant.snapshotPath);await assert.rejects(()=>verifyOfflineBackup({bundleDirectory:mutant.bundleDirectory}));const outputRoot=path.join(f.directory,'no-ready-'+label);await assert.rejects(()=>rehearseOfflineRestore({bundleDirectory:mutant.bundleDirectory,outputRoot}));assert.deepEqual(await successMarkers(outputRoot),[]);
 }
});
test('manifest byte grammar, unknown fields and metadata type corruption are refused',async()=>{
 const f=await createBundle('bad-manifest'),{verifyOfflineBackup}=await api(),raw=await fs.readFile(f.manifestPath),record=JSON.parse(raw.toString('utf8'));
 const cases=[['bom',Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),raw])],['truncated',raw.subarray(0,Math.floor(raw.length/2))],['oversize',Buffer.alloc(1024*1024+1,0x20)],['extra',Buffer.from(JSON.stringify({...record,unlisted:true},null,2)+'\n')],['duplicate',Buffer.from(raw.toString().replace('{','{"schemaVersion":1,'))],['top-array',Buffer.from(JSON.stringify([record]))],['schema-type',Buffer.from(JSON.stringify({...record,schemaVersion:'1'},null,2)+'\n')],['snapshot-id-array',Buffer.from(JSON.stringify({...record,snapshotId:[record.snapshotId]},null,2)+'\n')],['path-injection',Buffer.from(JSON.stringify({...record,database:{...record.database,filename:'../../outside.sqlite'}},null,2)+'\n')],['byte-length-type',Buffer.from(JSON.stringify({...record,database:{...record.database,byteLength:String(record.database.byteLength)}},null,2)+'\n')],['identity-type',Buffer.from(JSON.stringify({...record,identity:{...record.identity,serverId:[record.identity.serverId]}},null,2)+'\n')],['row-digest',Buffer.from(JSON.stringify({...record,inventory:{...record.inventory,tables:record.inventory.tables.map((row,i)=>i===0?{...row,rowSha256:'0'.repeat(64)}:row)}},null,2)+'\n')]];
 for(const [label,bytes]of cases){const mutant=await cloneBundle(f,label);await fs.writeFile(mutant.manifestPath,bytes);await assert.rejects(()=>verifyOfflineBackup({bundleDirectory:mutant.bundleDirectory}),label);}
});
test('CLI create, verify and rehearse operate on real files with offline summaries',async()=>{
 const f=await fixture('cli-success');const made=await cli(['create','--source',f.sourceDatabase,'--output-root',f.outputRoot]);assert.equal(made.code,0,made.stderr);const result=JSON.parse(made.stdout.trim());assert.equal(result.offlineOnly,true);assert.equal(result.onlineCutoverSupported,false);assert.ok((await fs.stat(result.databasePath)).isFile());
 const verified=await cli(['verify','--bundle',result.directory]);assert.equal(verified.code,0,verified.stderr);assert.equal(JSON.parse(verified.stdout.trim()).offlineOnly,true);
 const restored=await cli(['rehearse','--bundle',result.directory,'--output-root',f.outputRoot]);assert.equal(restored.code,0,restored.stderr);const rehearsal=JSON.parse(restored.stdout.trim());assert.equal(rehearsal.offlineOnly,true);assert.equal(rehearsal.onlineCutoverSupported,false);assert.equal(await fileHash(rehearsal.databasePath),await fileHash(result.databasePath));
 for(const child of [made,verified,restored]){assert.equal(child.signal,null);assert.ok(!child.stdout.includes('ShenyiDemo!2026'));assert.ok(!child.stderr.includes('ShenyiDemo!2026'));}
});
test('CLI rejects unknown/repeated flags, extra arguments and relative paths without success output',async()=>{
 const f=await fixture('cli-invalid'),before=await fileHash(f.sourceDatabase);
 const variants=[[],['start'],['create','--source',f.sourceDatabase,'--output-root',f.outputRoot,'--overwrite'],['create','--source',f.sourceDatabase,'--source',f.sourceDatabase,'--output-root',f.outputRoot],['create','--source',f.sourceDatabase,'extra'],['create','--source',path.relative(f.directory,f.sourceDatabase),'--output-root',f.outputRoot],['verify','--bundle','relative-bundle']];
 for(const args of variants){const child=await cli(args,{cwd:f.directory});assert.notEqual(child.code,0,JSON.stringify(args));assert.ok(!child.stdout.includes('"offlineOnly":true'));}
 assert.equal(await fileHash(f.sourceDatabase),before);assert.deepEqual(await successMarkers(f.outputRoot),[]);
});

// Real Windows hard links also exercise file alias refusal without symlink privileges.
test('snapshot hard-link alias and pending WAL/journal files cannot be accepted as a standalone snapshot',async()=>{
 const f=await createBundle('file-alias'),{verifyOfflineBackup}=await api();
 const linked=await cloneBundle(f,'hard-link');await fs.link(linked.snapshotPath,path.join(f.directory,'snapshot-alias.sqlite'));assert.ok((await fs.stat(linked.snapshotPath)).nlink>1);await assert.rejects(()=>verifyOfflineBackup({bundleDirectory:linked.bundleDirectory}));
 for(const suffix of ['-wal','-shm','-journal']){const mutant=await cloneBundle(f,'sidecar'+suffix);await fs.writeFile(mutant.snapshotPath+suffix,'owned uncheckpointed sidecar');await assert.rejects(()=>verifyOfflineBackup({bundleDirectory:mutant.bundleDirectory}),suffix);}
});
test('runtime guard accepts supported 24.x releases and refuses unsupported or malformed versions',async()=>{
 const {assertOfflineBackupRuntime}=await api();
 for(const version of ['24.15.0','24.22.1','24.99.4'])assert.doesNotThrow(()=>assertOfflineBackupRuntime(version));
 for(const version of ['24.14.999','25.0.0','22.22.0','24.015.0','24.15','v24.15.0','24.15.0-rc.1','',null,24])assert.throws(()=>assertOfflineBackupRuntime(version),{code:'RUNTIME_UNSUPPORTED'});
});
const { syncBuiltinESMExports }=require('node:module');
test('manifest durability failure cannot later be verified or rehearsed as a successful backup',async t=>{
 const f=await fixture('manifest-sync-failure'),{createOfflineBackup,verifyOfflineBackup,rehearseOfflineRestore}=await api(),originalOpen=fs.open.bind(fs),sourceHash=await fileHash(f.sourceDatabase);let injected=0;
 t.mock.method(fs,'open',async function(filename,flags,...rest){const handle=await originalOpen(filename,flags,...rest);if(typeof filename==='string'&&path.basename(filename).includes('manifest')&&flags==='wx'){t.mock.method(handle,'sync',async()=>{injected++;throw Error('synthetic manifest durability failure');});}return handle;});syncBuiltinESMExports();
 try{await assert.rejects(()=>createOfflineBackup({sourceDatabase:f.sourceDatabase,outputRoot:f.outputRoot}));}finally{t.mock.restoreAll();syncBuiltinESMExports();}
 assert.equal(injected,1,'fault must reach the manifest publication fsync');assert.equal(await fileHash(f.sourceDatabase),sourceHash);
 const directories=(await fs.readdir(f.outputRoot,{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>path.join(f.outputRoot,x.name));assert.equal(directories.length,1);const failed=directories[0];assert.ok(await exists(path.join(failed,'failure.json')));
 await assert.rejects(()=>verifyOfflineBackup({bundleDirectory:failed}),'create failure must never become a verified success');const restoreRoot=path.join(f.directory,'no-successful-restore');await assert.rejects(()=>rehearseOfflineRestore({bundleDirectory:failed,outputRoot:restoreRoot}));assert.deepEqual(await successMarkers(restoreRoot),[]);
});
