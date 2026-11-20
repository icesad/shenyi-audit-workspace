'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const cli = path.resolve(__dirname, '../scripts/check-release-handoff.mjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const payloadSize = 128 * 1024 + 1;
const artifactDefinitions = [
  { id: 'windows-review', purpose: 'windows-review', name: 'Shenyi-Windows-Review.zip', sourceCommit: 'a123'.repeat(10) },
  { id: 'macos-arm64', purpose: 'macos-presigning', name: 'Shenyi-macOS-arm64.zip', sourceCommit: 'b234'.repeat(10) },
  { id: 'linux-rehearsal', purpose: 'linux-rehearsal', name: 'shenyi-team-ubuntu.tar', sourceCommit: 'c345'.repeat(10) },
];

function invoke(directory, args) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(process.execPath, [cli, ...args], {
    cwd: directory, env, encoding: 'utf8', timeout: 12_000, windowsHide: true,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  const reports = [child.stdout, child.stderr].filter(stream => stream.trim());
  assert.equal(reports.length, 1, child.stdout + child.stderr);
  assert.equal(reports[0].trim().split(/\r?\n/).length, 1, reports[0]);
  assert.equal(reports[0].includes(directory), false, 'Receipt exposes the receiver directory');
  assert.equal(reports[0].includes('SYNTHETIC_NONREPORTABLE_CONTENT'), false);
  return { code: child.status, report: JSON.parse(reports[0]) };
}

async function fixture(t) {
  const temp = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temp, 'shenyi release receiver '));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(resolved, directory);
    assert.equal(path.dirname(resolved), temp);
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const artifacts = [];
  const archives = new Map();
  for (const [index, definition] of artifactDefinitions.entries()) {
    const bytes = Buffer.alloc(payloadSize, 65 + index);
    bytes.write('SYNTHETIC_NONREPORTABLE_CONTENT');
    const archive = path.join(directory, definition.name);
    await fs.writeFile(archive, bytes, { flag: 'wx' });
    archives.set(definition.id, archive);
    artifacts.push({ ...definition, bytes: bytes.length, sha256: digest(bytes) });
  }

  const catalog = path.join(directory, 'handoff-catalog.json');
  const manifest = { schemaVersion: 1, artifacts };
  const catalogBytes = Buffer.from(JSON.stringify(manifest) + '\n');
  const catalogSha256 = digest(catalogBytes);
  await fs.writeFile(catalog, catalogBytes, { flag: 'wx' });
  const artifact = artifacts[0].id;
  const archive = archives.get(artifact);
  function args(fields = {}) {
    const values = { catalog, catalogSha256, artifact, archive, ...fields };
    return ['--catalog', values.catalog, '--catalog-sha256', values.catalogSha256,
      '--artifact', values.artifact, '--archive', values.archive];
  }
  return { directory, catalog, catalogSha256, manifest, archives, artifact, archive, args,
    run(fields = {}) { return invoke(directory, args(fields)); } };
}

function failed(receipt, code) {
  assert.deepEqual(receipt, { code: 1, report: { status: 'failed', code } });
}

async function stamp(filename) {
  const info = await fs.stat(filename, { bigint: true });
  return { size: info.size, ino: info.ino, dev: info.dev, mtimeNs: info.mtimeNs, ctimeNs: info.ctimeNs,
    sha256: digest(await fs.readFile(filename)) };
}

test('handoff CLI verifies Windows, macOS and Linux archive bytes without writing received files', async t => {
  const f = await fixture(t);
  const renamed = path.join(f.directory, 'received.tar');
  await fs.copyFile(f.archives.get('linux-rehearsal'), renamed);
  const files = [f.catalog, ...f.archives.values(), renamed];
  const before = await Promise.all(files.map(stamp));
  const entries = await fs.readdir(f.directory);
  for (const { id, ...entry } of f.manifest.artifacts) {
    const result = id === 'linux-rehearsal'
      ? f.run({ artifact: id, archive: renamed, catalogSha256: f.catalogSha256.toUpperCase() })
      : f.run({ artifact: id, archive: f.archives.get(id) });
    assert.deepEqual(result, { code: 0, report: { status: 'verified', verification: 'archive-bytes',
      artifact: id, ...entry, catalogSha256: f.catalogSha256 } });
  }
  assert.deepEqual(await Promise.all(files.map(stamp)), before);
  assert.deepEqual(await fs.readdir(f.directory), entries);
});

test('handoff CLI diagnoses an incorrect archive size, last-byte corruption, and bytes from a different slot', async t => {
  const f = await fixture(t);
  const copy = path.join(f.directory, 'received-again');
  await fs.mkdir(copy);
  const incorrect = path.join(copy, path.basename(f.archive));
  const bytes = await fs.readFile(f.archive);
  await fs.writeFile(incorrect, bytes.subarray(0, -1));
  failed(f.run({ archive: incorrect }), 'ARTIFACT_SIZE_MISMATCH');

  bytes[bytes.length - 1] ^= 1;
  await fs.writeFile(incorrect, bytes);
  failed(f.run({ archive: incorrect }), 'ARTIFACT_DIGEST_MISMATCH');

  const other = f.archives.get('macos-arm64');
  const otherContents = await fs.readFile(other);
  assert.equal(otherContents.length, bytes.length);
  await fs.writeFile(incorrect, otherContents);
  failed(f.run({ archive: incorrect }), 'ARTIFACT_DIGEST_MISMATCH');
  assert.deepEqual(await fs.readFile(incorrect), otherContents);
});

test('handoff CLI binds the catalog digest before selecting or opening an archive', async t => {
  const f = await fixture(t);
  const neverOpened = path.join(f.directory, 'SYNTHETIC_NONREPORTABLE_CONTENT.zip');
  failed(f.run({ catalogSha256: '0'.repeat(64), artifact: 'unlisted', archive: neverOpened }), 'CATALOG_DIGEST_MISMATCH');
  failed(f.run({ artifact: 'unlisted', archive: neverOpened }), 'ARTIFACT_NOT_LISTED');
  await fs.appendFile(f.catalog, ' ');
  failed(f.run(), 'CATALOG_DIGEST_MISMATCH');
  assert.equal(await fs.stat(f.catalog).then(info => info.isFile()), true);
  await assert.rejects(fs.lstat(neverOpened), { code: 'ENOENT' });
});

test('handoff CLI refuses malformed and ambiguous metadata even with a matching catalog digest', async t => {
  const f = await fixture(t);
  const valid = f.manifest.artifacts[0];
  const manifest = artifact => ({ schemaVersion: 1, artifacts: [artifact] });
  const invalid = [
    Buffer.from('{ synthetic malformed catalog'),
    Buffer.from([0xff]),
    { ...f.manifest, schemaVersion: 2 },
    { ...f.manifest, unknown: 'SYNTHETIC_NONREPORTABLE_CONTENT' },
    { schemaVersion: 1, artifacts: [valid, { ...valid, name: 'Another-File.zip' }] },
    manifest({ ...valid, unexpected: 'value' }),
    manifest({ ...valid, name: '../archive.zip' }),
    manifest({ ...valid, name: 'wrong-type.tar' }),
    manifest({ ...valid, id: 'Capital' }),
    manifest({ ...valid, purpose: 'unofficial' }),
    manifest({ ...valid, sourceCommit: valid.sourceCommit.slice(0, 7) }),
    manifest({ ...valid, sourceCommit: valid.sourceCommit.toUpperCase() }),
    manifest({ ...valid, bytes: 0 }),
    manifest({ ...valid, bytes: 4.25 }),
    manifest({ ...valid, bytes: Number.MAX_SAFE_INTEGER + 1 }),
    manifest({ ...valid, sha256: valid.sha256.toUpperCase() }),
  ];
  for (const value of invalid) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    await fs.writeFile(f.catalog, bytes);
    failed(f.run({ catalogSha256: digest(bytes) }), 'CATALOG_INVALID');
    assert.deepEqual(await fs.readFile(f.catalog), bytes);
  }
});

test('handoff CLI accepts only its four exact flags and accesses only absolute local paths', async t => {
  const f = await fixture(t);
  const normal = f.args();
  for (const args of [
    [], normal.slice(0, -2), [...normal, '--artifact', f.artifact], [...normal, '--extra', 'option'],
    f.args({ catalog: 'handoff-catalog.json' }), f.args({ archive: path.basename(f.archive) }),
    f.args({ catalogSha256: 'xyz' }), f.args({ artifact: '../outside' }),
  ]) failed(invoke(f.directory, args), 'INVALID_ARGUMENTS');
});

test('handoff CLI rejects directory entries and paths through aliases without editing the real files', async t => {
  const f = await fixture(t);
  const directoryEntry = path.join(f.directory, 'archive-folder', path.basename(f.archive));
  await fs.mkdir(path.dirname(directoryEntry));
  await fs.mkdir(directoryEntry);
  failed(f.run({ archive: directoryEntry }), 'ARTIFACT_INVALID');
  failed(f.run({ catalog: directoryEntry }), 'CATALOG_INVALID');
  const alias = path.join(f.directory, 'receiver-alias');
  const aliasTarget = path.join(f.directory, 'physical-receiver');
  await fs.mkdir(aliasTarget);
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  await fs.symlink(aliasTarget, alias, linkType);
  const realArchive = path.join(aliasTarget, path.basename(f.archive));
  const realCatalog = path.join(aliasTarget, path.basename(f.catalog));
  await fs.copyFile(f.archive, realArchive);
  await fs.copyFile(f.catalog, realCatalog);
  const before = await Promise.all([realArchive, realCatalog].map(stamp));
  failed(f.run({ archive: path.join(alias, path.basename(realArchive)) }), 'ARTIFACT_INVALID');
  failed(f.run({ catalog: path.join(alias, path.basename(realCatalog)) }), 'CATALOG_INVALID');
  assert.deepEqual(await Promise.all([realArchive, realCatalog].map(stamp)), before);

  await fs.link(realArchive, path.join(f.directory, 'archive-hardlink.zip'));
  await fs.link(realCatalog, path.join(f.directory, 'catalog-hardlink.json'));
  const linked = await Promise.all([realArchive, realCatalog].map(stamp));
  failed(f.run({ archive: realArchive }), 'ARTIFACT_INVALID');
  failed(f.run({ catalog: realCatalog }), 'CATALOG_INVALID');
  assert.deepEqual(await Promise.all([realArchive, realCatalog].map(stamp)), linked);
});
