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
