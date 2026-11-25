'use strict';

const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {pathToFileURL} = require('node:url');
const {promisify} = require('node:util');

const run = promisify(execFile);
const entry = path.resolve(__dirname, '../scripts/verify-windows-owner-review.mjs');
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
const serialize = value => JSON.stringify(value, null, 2) + '\n';
const payload = {
  'README-Owner-Review.md': 'Synthetic reviewer instructions.\n',
  'owner-review-runtime.json': '{"schemaVersion":1,"kind":"shenyi-owner-review-windows-x64"}\n',
  'runtime/electron/electron.exe': 'synthetic electron file',
  'runtime/node/node.exe': 'synthetic node file',
  'scripts/review-fixture.mjs': 'export const value = 1;\n',
};

async function fixture(t) {
  const temp = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temp, 'shenyi-review-verifier-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.relative(directory, resolved), '');
    assert.equal(path.relative(temp, path.dirname(resolved)), '');
    await fs.rm(resolved, {recursive:true, force:true});
  });
  const root = path.join(directory, 'Review package with spaces');
  const manifestPath = path.join(root, 'owner-review-manifest.json');
  const files = {};
  for (const [name, content] of Object.entries(payload)) {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), {recursive:true});
    await fs.writeFile(file, content);
    files[name] = {bytes:Buffer.byteLength(content), sha256:checksum(content)};
  }
  const manifest = {
    schemaVersion:1, kind:'shenyi-owner-review-windows-x64', version:'0.61.0', syntheticOnly:true,
    runtime:{
      node:{version:'24.22.1', archiveSha256:'a'.repeat(64)},
      electron:{version:'45.3.2', archiveSha256:'b'.repeat(64)},
    },
    files,
  };
  const original = serialize(manifest);
  await fs.writeFile(manifestPath, original);
  const {verifyWindowsOwnerReview} = await import(pathToFileURL(entry));
  return {root,directory,manifest,manifestPath,original,verify:() => verifyWindowsOwnerReview(root),verifyWindowsOwnerReview};
}

test('checks the extracted payload and supports an explicit package directory from another CWD', async t => {
  const f = await fixture(t);
  const result = await f.verify();
  assert.deepEqual(result, {
    version:f.manifest.version,
    files:Object.keys(payload).length,
    bytes:Object.values(f.manifest.files).reduce((total, file) => total + file.bytes, 0),
    manifestSha256:checksum(f.original),
    reviewRunsPresent:false,
  });
  const launched = await run(process.execPath, [entry, f.root], {cwd:f.directory, windowsHide:true});
  assert.match(launched.stdout, new RegExp(result.manifestSha256));
  assert.equal(launched.stderr, '');
  assert.equal(await fs.readFile(f.manifestPath, 'utf8'), f.original);
});

test('skips the exact top-level review-runs subtree while preserving its contents', async t => {
  const f = await fixture(t);
  const evidenceDirectory = path.join(f.root, 'review-runs', 'candidate-synthetic');
  await fs.mkdir(evidenceDirectory, {recursive:true});
  const evidenceFile = path.join(evidenceDirectory, 'synthetic-private-evidence.json');
  const evidence = '{"synthetic":"an opaque rehearsal record"}\n';
  await fs.writeFile(evidenceFile, evidence);
  const external = path.join(f.directory, 'unlisted evidence');
  await fs.mkdir(external);
  await fs.symlink(external, path.join(evidenceDirectory, 'ignored-directory-link'), 'junction');
  const result = await f.verify();
  assert.equal(result.files, Object.keys(payload).length);
  assert.equal(result.reviewRunsPresent, true);
  assert.equal(await fs.readFile(evidenceFile, 'utf8'), evidence);
  assert.equal(await fs.readFile(f.manifestPath, 'utf8'), f.original);
  assert.equal((await fs.lstat(path.join(evidenceDirectory, 'ignored-directory-link'))).isSymbolicLink(), true);
});

test('rejects changed, missing, and undeclared files or directories', async t => {
  for (const mutation of [
    ['same-length substitution', f => fs.writeFile(path.join(f.root, 'scripts/review-fixture.mjs'), 'export const value = 2;\n')],
    ['missing payload', f => fs.unlink(path.join(f.root, 'scripts/review-fixture.mjs'))],
    ['extra payload', f => fs.writeFile(path.join(f.root, 'runtime/electron/extra.dll'), 'synthetic extra')],
    ['undeclared empty directory', f => fs.mkdir(path.join(f.root, 'undeclared'))],
    ['file at rehearsal root', f => fs.writeFile(path.join(f.root, 'review-runs'), 'synthetic file')],
    ['alternate rehearsal casing', f => fs.mkdir(path.join(f.root, 'Review-Runs'))],
    ['nested rehearsal directory', f => fs.mkdir(path.join(f.root, 'scripts/review-runs'))],
  ]) {
    await t.test(mutation[0], async subtest => {
      const f = await fixture(subtest);
      await mutation[1](f);
      await assert.rejects(f.verify());
      assert.equal(await fs.readFile(f.manifestPath, 'utf8'), f.original);
    });
  }
});

test('rejects linked roots, tracked directories, rehearsal roots, and files', async t => {
  await t.test('package directory alias', async subtest => {
    const f = await fixture(subtest);
    const alias = path.join(f.directory, 'linked package');
    await fs.symlink(f.root, alias, 'junction');
    await assert.rejects(f.verifyWindowsOwnerReview(alias));
  });
  await t.test('tracked directory alias with correct payload', async subtest => {
    const f = await fixture(subtest);
    const runtime = path.join(f.root, 'runtime');
    const moved = path.join(f.directory, 'original runtime');
    assert.equal(path.relative(f.directory, path.dirname(await fs.realpath(runtime))), path.basename(f.root));
    await fs.rename(runtime, moved);
    await fs.symlink(moved, runtime, 'junction');
    await assert.rejects(f.verify());
    assert.equal(await fs.readFile(path.join(moved, 'node/node.exe'), 'utf8'), payload['runtime/node/node.exe']);
  });
  await t.test('linked top-level rehearsal directory', async subtest => {
    const f = await fixture(subtest);
    const outside = path.join(f.directory, 'outside rehearsal');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(f.root, 'review-runs'), 'junction');
    await assert.rejects(f.verify());
  });
  await t.test('tracked file with another link outside the extraction', async subtest => {
    const f = await fixture(subtest);
    const outside = path.join(f.directory, 'linked text');
    await fs.link(path.join(f.root, 'README-Owner-Review.md'), outside);
    await assert.rejects(f.verify());
    assert.equal(await fs.readFile(outside, 'utf8'), payload['README-Owner-Review.md']);
  });
  await t.test('manifest with another link outside the extraction', async subtest => {
    const f = await fixture(subtest);
    await fs.link(f.manifestPath, path.join(f.directory, 'manifest alias'));
    await assert.rejects(f.verify());
  });
});

test('refuses malformed metadata even when declared file bytes are unchanged', async t => {
  const f = await fixture(t);
  const fact = f.manifest.files['scripts/review-fixture.mjs'];
  for (const name of ['../other.txt', 'runtime\\node.exe', 'C:/fixture/other.txt', 'runtime/NUL.txt',
    'runtime/spaced. ', 'runtime//child.txt', 'Runtime/node/node.exe', 'runtime/node', 'review-runs/unlisted.txt',
    'owner-review-manifest.json']) {
    const manifest = {...f.manifest, files:{...f.manifest.files, [name]:fact}};
    await fs.writeFile(f.manifestPath, serialize(manifest));
    await assert.rejects(f.verify(), name);
  }
  for (const document of [
    {...f.manifest, schemaVersion:2},
    {...f.manifest, syntheticOnly:false},
    {...f.manifest, runtime:{...f.manifest.runtime, node:{version:'24.22.1', archiveSha256:'invalid'}}},
    {...f.manifest, files:{...f.manifest.files, 'scripts/review-fixture.mjs':{...fact, bytes:-1}}},
    {...f.manifest, files:{...f.manifest.files, 'scripts/review-fixture.mjs':{...fact, extra:1}}},
  ]) {
    await fs.writeFile(f.manifestPath, serialize(document));
    await assert.rejects(f.verify());
  }
  const duplicate = f.original.replace('  "schemaVersion": 1,', '  "schemaVersion": 1,\n  "schemaVersion": 1,');
  assert.deepEqual(JSON.parse(duplicate), f.manifest);
  await fs.writeFile(f.manifestPath, duplicate);
  await assert.rejects(f.verify());
  await fs.writeFile(f.manifestPath, f.original);
  assert.equal((await f.verify()).manifestSha256, checksum(f.original));
});

test('requires expected runtime files even when the manifest omits them too', async t => {
  const f = await fixture(t);
  const name = 'runtime/node/node.exe';
  const nodeDirectory = path.dirname(path.join(f.root, name));
  await fs.unlink(path.join(f.root, name));
  await fs.rmdir(nodeDirectory);
  delete f.manifest.files[name];
  await fs.writeFile(f.manifestPath, serialize(f.manifest));
  await assert.rejects(f.verify());
});

test('CLI returns a failure status for an altered file without writing anything', async t => {
  const f = await fixture(t);
  const changed = path.join(f.root, 'runtime/node/node.exe');
  await fs.writeFile(changed, 'synthetic file altered');
  const entries = await fs.readdir(f.root);
  await assert.rejects(run(process.execPath, [entry, f.root], {cwd:f.directory, windowsHide:true}), error => {
    assert.equal(error.code, 1);
    assert.ok(error.stderr.length > 0);
    return true;
  });
  assert.deepEqual(await fs.readdir(f.root), entries);
  assert.equal(await fs.readFile(f.manifestPath, 'utf8'), f.original);
  assert.equal(await fs.readFile(changed, 'utf8'), 'synthetic file altered');
});
