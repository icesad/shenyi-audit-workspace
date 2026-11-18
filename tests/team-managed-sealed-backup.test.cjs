'use strict';
const assert = require('node:assert/strict');
const {createHash,randomBytes,randomUUID} = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const test = require('node:test');

async function fixture() {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-managed-backup-'));
  const sourceDatabase = path.join(dir, 'source.sqlite');
  const keyFile = path.join(dir, 'backup.key');
  const wrongKeyFile = path.join(dir, 'other.key');
  const outputRoot = path.join(dir, 'output');
  const {initializeTeamDatabase} = await import('../server/team/database.mjs');
  const {deviceServerId} = await import('../server/team/device-policy.mjs');
  let serverId;
  const db = new DatabaseSync(sourceDatabase);
  try {
    initializeTeamDatabase(db);
    serverId = deviceServerId(db);
    db.prepare("INSERT INTO teams (team_id,status) VALUES ('synthetic-team','active')").run();
  } finally { db.close(); }
  await fs.writeFile(keyFile, randomBytes(32), {flag:'wx',mode:0o600});
  await fs.writeFile(wrongKeyFile, randomBytes(32), {flag:'wx',mode:0o600});
  return {sourceDatabase,serverId,keyFile,wrongKeyFile,outputRoot,dir};
}

test('managed sealed round trip distinguishes authenticated snapshot from isolated offline rehearsal', async () => {
  const {createManagedSealedBackup,rehearseManagedSealedRestore,rehearseSealedOfflineRestore} = await import('../server/team/offline-backup.mjs');
  const {assertManagedDatabaseReady,MANAGED_REHEARSAL_MARKER} = await import('../server/team/managed-database-readiness.mjs');
  const {sourceDatabase,serverId,keyFile,wrongKeyFile,outputRoot,dir} = await fixture();
  const sourceBytes = await fs.readFile(sourceDatabase);
  const sealed = await createManagedSealedBackup({sourceDatabase,serverId,keyFile,outputRoot});
  assert.deepEqual(await fs.readdir(sealed.directory), ['snapshot.sealed']);
  assert.deepEqual(await fs.readFile(sourceDatabase), sourceBytes);
  const bundleDirectory = sealed.directory;
  const refusal = {code:'SEALED_BUNDLE_INVALID'};
  const rejectedRoot = path.join(dir,'rejected');
  await assert.rejects(rehearseSealedOfflineRestore({bundleDirectory,keyFile,outputRoot:rejectedRoot}), refusal);
  await assert.rejects(rehearseManagedSealedRestore({bundleDirectory,keyFile:wrongKeyFile,serverId,outputRoot:rejectedRoot}), refusal);
  await assert.rejects(rehearseManagedSealedRestore({bundleDirectory,keyFile,serverId:randomUUID(),outputRoot:rejectedRoot}), refusal);
  await assert.rejects(fs.stat(rejectedRoot), {code:'ENOENT'});

  const rehearsal = await rehearseManagedSealedRestore({bundleDirectory,keyFile,serverId,outputRoot});
  const databaseBytes = await fs.readFile(rehearsal.databasePath);
  const receipt = JSON.parse(await fs.readFile(path.join(rehearsal.directory,'rehearsal.json'),'utf8'));
  assert.equal(rehearsal.authenticatedSnapshotSha256, sealed.authenticatedSnapshotSha256);
  assert.equal(receipt.authenticatedSnapshotSha256, sealed.authenticatedSnapshotSha256);
  assert.equal(receipt.database.sha256, createHash('sha256').update(databaseBytes).digest('hex'));
  assert.notEqual(receipt.database.sha256, receipt.authenticatedSnapshotSha256);
  const relocated = path.join(dir,'renamed.sqlite');
  await fs.rename(rehearsal.databasePath,relocated);
  const db = new DatabaseSync(relocated, {readOnly:true});
  try {
    assert.equal(db.prepare('SELECT value FROM team_database_metadata WHERE name=?').get(MANAGED_REHEARSAL_MARKER).value,'1');
    assert.equal(db.prepare("SELECT status FROM teams WHERE team_id='synthetic-team'").get().status,'active');
    assert.throws(() => assertManagedDatabaseReady(db,serverId), {code:'MANAGED_DATABASE_NOT_READY'});
  } finally { db.close(); }
  await assert.rejects(createManagedSealedBackup({sourceDatabase:relocated,serverId,keyFile,outputRoot}), {code:'SOURCE_INVALID'});
});

test('failed managed capture does not leave a plaintext staging file or a successful bundle', async () => {
  const {createManagedSealedBackup} = await import('../server/team/offline-backup.mjs');
  const {sourceDatabase,serverId,keyFile,outputRoot} = await fixture();
  const sourceBytes = await fs.readFile(sourceDatabase);
  await assert.rejects(createManagedSealedBackup({sourceDatabase,serverId,keyFile,outputRoot,
    onProgress() { throw new Error('synthetic observer failure'); }}), {code:'BACKUP_FAILED'});
  const [failed] = await fs.readdir(outputRoot);
  assert(failed.startsWith('sealed-'));
  assert.deepEqual(await fs.readdir(path.join(outputRoot,failed)), ['failure.json']);
  assert.deepEqual(await fs.readFile(sourceDatabase), sourceBytes);
});

function changeSource(sourceDatabase, sql, ...parameters) {
  const db = new DatabaseSync(sourceDatabase);
  try {
    if (parameters.length) db.prepare(sql).run(...parameters);
    else db.exec(sql);
  } finally { db.close(); }
}

async function compareWithoutWrites(options) {
  const {compareManagedSealedBackup} = await import('../server/team/offline-backup.mjs');
  const archivePath = path.join(options.bundleDirectory,'snapshot.sealed');
  const sourceBefore = await fs.readFile(options.sourceDatabase);
  const archiveBefore = await fs.readFile(archivePath);
  const keyBefore = await fs.readFile(options.keyFile);
  try { return await compareManagedSealedBackup(options); }
  finally {
    assert.deepEqual(await fs.readFile(options.sourceDatabase),sourceBefore);
    assert.deepEqual(await fs.readFile(archivePath),archiveBefore);
    assert.deepEqual(await fs.readFile(options.keyFile),keyBefore);
  }
}

const noTableChanges = {changed:0,added:0,removed:0};
const noAreaChanges = {identityAndDevices:0,teamAndProjectAccess:0,billingAndEntitlements:0,other:0};

test('managed comparison reports logical match without requiring physically identical SQLite bytes', async () => {
  const {createManagedSealedBackup} = await import('../server/team/offline-backup.mjs');
  const f = await fixture();
  const sealed = await createManagedSealedBackup({sourceDatabase:f.sourceDatabase,serverId:f.serverId,keyFile:f.keyFile,outputRoot:f.outputRoot});
  const options = {sourceDatabase:f.sourceDatabase,bundleDirectory:sealed.directory,serverId:f.serverId,keyFile:f.keyFile};
  const original = await compareWithoutWrites(options);
  assert.equal(original.status,'match');
  assert.equal(original.schemaMatches,true);
  assert.equal(typeof original.databaseBytesMatch,'boolean');
  assert.deepEqual(original.tables,noTableChanges);
  assert.deepEqual(original.changedAreas,noAreaChanges);
  assert.equal(original.offlineOnly,true);
  assert.equal(original.onlineCutoverSupported,false);
  // Header-only user_version changes no SQLite schema object or typed row.
  changeSource(f.sourceDatabase,'PRAGMA user_version=7');
  const logical = await compareWithoutWrites(options);
  assert.equal(logical.status,'match');
  assert.equal(logical.schemaMatches,true);
  assert.equal(logical.databaseBytesMatch,false);
  assert.deepEqual(logical.tables,noTableChanges);
  assert.deepEqual(logical.changedAreas,noAreaChanges);
});

test('managed comparison treats a schema-only index change as different even when every table digest matches', async () => {
  const {createManagedSealedBackup} = await import('../server/team/offline-backup.mjs');
  const f = await fixture();
  const sealed = await createManagedSealedBackup({sourceDatabase:f.sourceDatabase,serverId:f.serverId,keyFile:f.keyFile,outputRoot:f.outputRoot});
  changeSource(f.sourceDatabase,'CREATE INDEX synthetic_teams_status ON teams(status)');
  const result = await compareWithoutWrites({sourceDatabase:f.sourceDatabase,bundleDirectory:sealed.directory,serverId:f.serverId,keyFile:f.keyFile});
  assert.equal(result.status,'different');
  assert.equal(result.schemaMatches,false);
  assert.equal(result.databaseBytesMatch,false);
  assert.deepEqual(result.tables,noTableChanges);
  assert.deepEqual(result.changedAreas,noAreaChanges);
});

test('managed comparison counts added and removed tables separately when total table count is unchanged', async () => {
  const {createManagedSealedBackup} = await import('../server/team/offline-backup.mjs');
  const f = await fixture();
  changeSource(f.sourceDatabase,"CREATE TABLE synthetic_retired(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO synthetic_retired VALUES (1,'synthetic old row')");
  const sealed = await createManagedSealedBackup({sourceDatabase:f.sourceDatabase,serverId:f.serverId,keyFile:f.keyFile,outputRoot:f.outputRoot});
  changeSource(f.sourceDatabase,"DROP TABLE synthetic_retired; CREATE TABLE synthetic_added(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO synthetic_added VALUES (1,'synthetic new row')");
  const result = await compareWithoutWrites({sourceDatabase:f.sourceDatabase,bundleDirectory:sealed.directory,serverId:f.serverId,keyFile:f.keyFile});
  assert.equal(result.status,'different');
  assert.equal(result.schemaMatches,false);
  assert.equal(result.databaseBytesMatch,false);
  assert.deepEqual(result.tables,{changed:0,added:1,removed:1});
  assert.deepEqual(result.changedAreas,{...noAreaChanges,other:2});
  assert.equal(JSON.stringify(result).includes('synthetic old row'),false);
  assert.equal(JSON.stringify(result).includes('synthetic_added'),false);
});

test('managed comparison rejects sidecars, demo, rehearsal, wrong-instance and structurally incomplete sources', async () => {
  const {createManagedSealedBackup} = await import('../server/team/offline-backup.mjs');
  const {MANAGED_REHEARSAL_MARKER} = await import('../server/team/managed-database-readiness.mjs');
  const f = await fixture();
  const sealed = await createManagedSealedBackup({sourceDatabase:f.sourceDatabase,serverId:f.serverId,keyFile:f.keyFile,outputRoot:f.outputRoot});
  const options = {sourceDatabase:f.sourceDatabase,bundleDirectory:sealed.directory,serverId:f.serverId,keyFile:f.keyFile};
  for (const suffix of ['-wal','-shm','-journal']) {
    const sidecar = f.sourceDatabase+suffix;
    const bytes = Buffer.from('synthetic sidecar must remain untouched');
    await fs.writeFile(sidecar,bytes,{flag:'wx'});
    try {
      await assert.rejects(compareWithoutWrites(options),{code:'SOURCE_INVALID'});
      assert.deepEqual(await fs.readFile(sidecar),bytes);
    } finally { await fs.unlink(sidecar); }
  }
  const changes = [
    ['demo',"INSERT INTO team_database_metadata(name,value) VALUES ('demo','true')"],
    ['rehearsal','INSERT INTO team_database_metadata(name,value) VALUES (?,?)',MANAGED_REHEARSAL_MARKER,'1'],
    ['other-instance',"UPDATE team_database_metadata SET value=? WHERE name='device-server-id'",randomUUID()],
    ['missing-required-table','DROP TABLE team_memberships'],
  ];
  for (const [name,sql,...parameters] of changes) {
    const sourceDatabase = path.join(f.dir,name+'.sqlite');
    await fs.copyFile(f.sourceDatabase,sourceDatabase,require('node:fs').constants.COPYFILE_EXCL);
    changeSource(sourceDatabase,sql,...parameters);
    await assert.rejects(compareWithoutWrites({...options,sourceDatabase}),{code:'SOURCE_INVALID'},name);
  }
});

test('managed comparison CLI distinguishes match, differences and authenticated payload-manifest inconsistency without success output on error', async () => {
  const {createManagedSealedBackup} = await import('../server/team/offline-backup.mjs');
  const {createCipheriv,createDecipheriv} = require('node:crypto');
  const {spawnSync} = require('node:child_process');
  const f = await fixture();
  const sealed = await createManagedSealedBackup({sourceDatabase:f.sourceDatabase,serverId:f.serverId,keyFile:f.keyFile,outputRoot:f.outputRoot});
  const cli = (bundleDirectory=sealed.directory) => spawnSync(process.execPath,[
    path.resolve(__dirname,'../scripts/team-database-backup.mjs'),'compare-managed-sealed',
    '--source',f.sourceDatabase,'--bundle',bundleDirectory,'--server-id',f.serverId,'--key-file',f.keyFile,
  ],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024*1024});
  const matched = cli();
  assert.equal(matched.error,undefined);
  assert.equal(matched.status,0,matched.stderr);
  assert.equal(JSON.parse(matched.stdout).status,'match');
  changeSource(f.sourceDatabase,"INSERT INTO teams(team_id,status) VALUES ('synthetic-new-team','active')");
  const different = cli();
  assert.equal(different.status,2,different.stderr);
  assert.equal(JSON.parse(different.stdout).status,'different');
  assert.deepEqual(JSON.parse(different.stdout).changedAreas,{...noAreaChanges,teamAndProjectAccess:1});

  // Re-encrypt a syntactically valid envelope with the fixture key: GCM is valid,
  // but its authenticated manifest falsely describes the actual SQLite bytes.
  const archive = await fs.readFile(sealed.archivePath),key = await fs.readFile(f.keyFile);
  const header = Buffer.from(archive.subarray(0,32));
  const decipher = createDecipheriv('aes-256-gcm',key,header.subarray(8,20));
  decipher.setAAD(header);
  decipher.setAuthTag(archive.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(archive.subarray(32,-16)),decipher.final()]);
  const manifestBytes = header.readUInt32BE(20),manifest = JSON.parse(plaintext.subarray(0,manifestBytes));
  manifest.database.sha256 = '0'.repeat(64);
  const replacement = Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  assert.equal(replacement.length,manifestBytes);
  replacement.copy(plaintext);
  randomBytes(12).copy(header,8);
  const cipher = createCipheriv('aes-256-gcm',key,header.subarray(8,20));
  cipher.setAAD(header);
  const forgedBytes = Buffer.concat([header,cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
  key.fill(0);
  plaintext.fill(0);
  const forgedDirectory = path.join(f.dir,'authenticated-inconsistent',path.basename(sealed.directory));
  await fs.mkdir(forgedDirectory,{recursive:true});
  await fs.writeFile(path.join(forgedDirectory,'snapshot.sealed'),forgedBytes,{flag:'wx'});
  await assert.rejects(compareWithoutWrites({sourceDatabase:f.sourceDatabase,bundleDirectory:forgedDirectory,serverId:f.serverId,keyFile:f.keyFile}),{code:'SEALED_BUNDLE_INVALID'});
  const rejected = cli(forgedDirectory);
  assert.equal(rejected.status,1,rejected.stderr);
  assert.equal(rejected.stdout,'');
  const errors = rejected.stderr.trim().split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
  assert.equal(errors.length,1,rejected.stderr);
  assert.equal(errors[0].code,'SEALED_BUNDLE_INVALID');
  assert.equal(errors[0].offlineOnly,true);
  assert.equal(errors[0].onlineCutoverSupported,false);
  assert.equal(rejected.stderr.includes(f.keyFile),false);
  assert.equal(rejected.stderr.includes('synthetic-new-team'),false);
});
