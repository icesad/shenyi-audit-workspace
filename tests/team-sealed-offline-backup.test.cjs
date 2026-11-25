'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { api, createBundle, ownDirectory, fileHash, exists, cli } = require('./helpers/offline-backup-basic-fixture.cjs');

async function newKey(directory, name, length = 32) {
  const filename = path.join(directory, name);
  await fs.writeFile(filename, randomBytes(length), { mode: 0o600, flag: 'wx' });
  return filename;
}

test('sealed CLI requires a separate key file and keeps the operation offline', async () => {
  const directory = await ownDirectory('sealed-cli-options');
  const bundle = path.join(directory, 'placeholder');
  const key = path.join(directory, 'operator-key.bin');
  for (const args of [
    ['seal', '--bundle', bundle],
    ['rehearse-sealed', '--key-file', key],
    ['seal', '--bundle', bundle, '--key-file', key, '--key-file', key],
    ['rehearse-sealed', '--bundle', bundle, '--key-file', key, '--serve', 'yes'],
    ['verify', '--bundle', bundle, '--key-file', key],
  ]) {
    const result = await cli(args);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    const failure = JSON.parse(result.stderr.trim().split(/\r?\n/).at(-1));
    assert.equal(failure.code, 'INVALID_INPUT');
    assert.equal(failure.onlineCutoverSupported, false);
    assert.equal(result.stderr.includes(key), false);
  }
});

test('authenticated sealed backup restores exact SQLite bytes from a new location', async () => {
  const f = await createBundle('sealed-roundtrip');
  const keyFile = await newKey(f.directory, 'operator-key.bin');
  const { sealOfflineBackup, rehearseSealedOfflineRestore } = await api();
  const expected = await fileHash(f.snapshotPath);
  const originalHash = await fileHash(f.sourceDatabase);
  const options = { bundleDirectory: f.bundleDirectory, keyFile, outputRoot: path.join(f.directory, 'sealed') };
  const first = await sealOfflineBackup(options);
  const second = await sealOfflineBackup(options);
  assert.equal(first.offlineOnly, true);
  assert.equal(first.onlineCutoverSupported, false);
  assert.equal(first.archiveSha256, await fileHash(first.archivePath));
  assert.equal(first.archiveBytes, (await fs.stat(first.archivePath)).size);
  assert.notEqual(first.archiveSha256, second.archiveSha256);
  assert.deepEqual(await fs.readdir(first.directory), ['snapshot.sealed']);
  const bytes = await fs.readFile(first.archivePath);
  assert.equal(bytes.includes('SQLite format 3\0'), false);
  assert.equal(bytes.includes(f.result.serverId), false);
  assert.equal(bytes.includes(await fs.readFile(keyFile)), false);
  assert.equal(await fileHash(f.sourceDatabase), originalHash);
  assert.equal(await fileHash(f.snapshotPath), expected);

  const transported = path.join(f.directory, 'transported');
  const transportedBundle = path.join(transported, path.basename(first.directory));
  await fs.mkdir(transported);
  await fs.cp(first.directory, transportedBundle, { recursive: true, errorOnExist: true, force: false });
  await fs.rename(f.bundleDirectory, path.join(f.outputRoot, 'retained-offline-bundle'));
  await fs.rename(f.sourceDatabase, path.join(f.directory, 'retained-source.sqlite'));
  const restored = await rehearseSealedOfflineRestore({ bundleDirectory: transportedBundle, keyFile, outputRoot: path.join(f.directory, 'restored') });
  assert.equal(restored.databaseSha256, expected);
  assert.equal(await fileHash(restored.databasePath), expected);
  assert.equal(restored.serverId, f.result.serverId);
  assert.equal(restored.schemaSha256, f.result.schemaSha256);
  assert.equal(restored.offlineOnly, true);
  assert.equal(restored.onlineCutoverSupported, false);
});

test('invalid key, wrong key and corrupted archives cannot produce a restored result', async t => {
  const f = await createBundle('sealed-reject');
  const keyFile = await newKey(f.directory, 'operator-key.bin');
  const wrongKey = await newKey(f.directory, 'wrong-key.bin');
  const shortKey = await newKey(f.directory, 'short-key.bin', 31);
  const { sealOfflineBackup, rehearseSealedOfflineRestore } = await api();
  const sealedRoot = path.join(f.directory, 'sealed');
  const restoredRoot = path.join(f.directory, 'restored');
  await assert.rejects(sealOfflineBackup({ bundleDirectory: f.bundleDirectory, keyFile: shortKey, outputRoot: sealedRoot }), { code: 'INVALID_BACKUP_KEY' });
  assert.equal(await exists(sealedRoot), false);
  const sealed = await sealOfflineBackup({ bundleDirectory: f.bundleDirectory, keyFile, outputRoot: sealedRoot });
  const recover = (bundleDirectory, selectedKey) => rehearseSealedOfflineRestore({ bundleDirectory, keyFile: selectedKey, outputRoot: restoredRoot });
  await assert.rejects(recover(sealed.directory, wrongKey), { code: 'SEALED_BUNDLE_INVALID' });
  const archive = await fs.readFile(sealed.archivePath);
  const corrupted = Buffer.from(archive);
  corrupted[Math.floor(corrupted.length / 2)] ^= 1;
  for (const [caseName, bytes] of [
    ['corrupt', corrupted],
    ['truncated', archive.subarray(0, -1)],
    ['trailing', Buffer.concat([archive, Buffer.of(0)])],
  ]) {
    const bundle = path.join(f.directory, caseName, path.basename(sealed.directory));
    await fs.mkdir(bundle, { recursive: true });
    await fs.writeFile(path.join(bundle, 'snapshot.sealed'), bytes, { flag: 'wx' });
    await assert.rejects(recover(bundle, keyFile), { code: 'SEALED_BUNDLE_INVALID' });
  }
  const extra = path.join(f.directory, 'extra-entry', path.basename(sealed.directory));
  await fs.mkdir(path.dirname(extra));
  await fs.cp(sealed.directory, extra, { recursive: true, errorOnExist: true, force: false });
  const sentinel = path.join(extra, 'unexpected.txt');
  await fs.writeFile(sentinel, 'unrelated file', { flag: 'wx' });
  await assert.rejects(recover(extra, keyFile), { code: 'SEALED_BUNDLE_INVALID' });
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'unrelated file');
  assert.equal(await exists(restoredRoot), false);
  assert.equal(await fileHash(sealed.archivePath), sealed.archiveSha256);

  await t.test('a changed second-pass frame cannot reach the SQLite writer', async () => {
    const { readBackupEnvelope, decryptBackupEnvelope, SealedEnvelopeError } = await import('../server/team/sealed-backup-envelope.mjs');
    const original = await fs.open(sealed.archivePath, 'r');
    const tampered = await fs.open(path.join(f.directory, 'corrupt', path.basename(sealed.directory), 'snapshot.sealed'), 'r');
    const key = await fs.readFile(keyFile);
    try {
      const header = await readBackupEnvelope(original, archive.length);
      const authenticated = await decryptBackupEnvelope(original, header, key);
      const written = [];
      await assert.rejects(decryptBackupEnvelope(tampered, header, key, {
        authenticatedFrames: authenticated.frames,
        writeDatabase: bytes => written.push(Buffer.from(bytes)),
      }), SealedEnvelopeError);
      const prefix = Buffer.concat(written);
      const expected = await fs.readFile(f.snapshotPath);
      assert.ok(prefix.length > 0 && prefix.length < expected.length);
      assert.deepEqual(prefix, expected.subarray(0, prefix.length));
    } finally {
      key.fill(0);
      await original.close();
      await tampered.close();
    }
  });
});
