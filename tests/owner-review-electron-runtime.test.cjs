'use strict';

const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const payload = {
  'README-Owner-Review.md': 'Synthetic reviewer instructions.\n',
  'owner-review-runtime.json': '{"schemaVersion":1,"kind":"shenyi-owner-review-windows-x64"}\n',
  'runtime/electron/electron.exe': 'synthetic Electron program',
  'runtime/electron/locales/en-US.pak': 'synthetic Electron resource',
  'runtime/node/node.exe': 'synthetic Node program',
};

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const assertMissing = filename => assert.rejects(fs.lstat(filename), {code:'ENOENT'});

async function fixture(t) {
  const temp = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temp, 'shenyi-review-electron-'));
  t.after(async () => {
    const resolved = await fs.realpath(directory);
    assert.equal(path.relative(directory, resolved), '');
    assert.equal(path.relative(temp, path.dirname(resolved)), '');
    await fs.rm(resolved, {recursive:true, force:true});
  });

  const appRoot = path.join(directory, 'Verified review package');
  const runDirectory = path.join(directory, 'Private review run');
  await fs.mkdir(runDirectory);
  for (const [member, content] of Object.entries(payload)) {
    const filename = path.join(appRoot, member);
    await fs.mkdir(path.dirname(filename), {recursive:true});
    await fs.writeFile(filename, content);
  }
  const manifestPath = path.join(appRoot, 'owner-review-manifest.json');
  const manifest = JSON.stringify({
    schemaVersion:1, kind:'shenyi-owner-review-windows-x64', version:'0.61.0', syntheticOnly:true,
    runtime:{
      node:{version:'24.22.1', archiveSha256:'a'.repeat(64)},
      electron:{version:'45.3.2', archiveSha256:'b'.repeat(64)},
    },
    files:Object.fromEntries(Object.entries(payload).map(([member, content]) =>
      [member, {bytes:Buffer.byteLength(content), sha256:sha256(content)}])),
  }, null, 2) + '\n';
  await fs.writeFile(manifestPath, manifest);

  const portable = {
    appRoot,
    rootDirectory:path.join(appRoot, 'review-runs'),
    electronExecutable:path.join(appRoot, 'runtime/electron/electron.exe'),
  };
  const {stageOwnerReviewElectronRuntime} = await import('../scripts/owner-review-electron-runtime.mjs');
  const {verifyWindowsOwnerReview} = await import('../scripts/verify-windows-owner-review.mjs');
  const verify = () => verifyWindowsOwnerReview(appRoot);
  const stage = (target = portable, work = runDirectory) => stageOwnerReviewElectronRuntime(target, work);
  return {directory, runDirectory, manifestPath, manifest, portable, stage, verify};
}

test('stages only the verified Electron runtime and retains diagnostics outside the package', async t => {
  const f = await fixture(t);
  const before = await f.verify();
  const staged = await f.stage();
  const runtimeDirectory = path.dirname(staged.executable);
  const relative = path.relative(f.runDirectory, staged.executable);
  assert.ok(relative && !path.isAbsolute(relative) && !relative.startsWith('..' + path.sep));
  assert.notEqual(staged.executable, f.portable.electronExecutable);
  assert.equal(await fs.readFile(staged.executable, 'utf8'), payload['runtime/electron/electron.exe']);
  const resource = path.join(runtimeDirectory, 'locales', 'en-US.pak');
  assert.equal(await fs.readFile(resource, 'utf8'), payload['runtime/electron/locales/en-US.pak']);
  assert.deepEqual((await fs.readdir(runtimeDirectory)).sort(), ['electron.exe', 'locales']);

  const log = path.join(runtimeDirectory, 'log');
  const diagnostic = path.join(runtimeDirectory, 'picker-diagnostic.txt');
  await fs.mkdir(log);
  await fs.writeFile(diagnostic, 'synthetic file picker diagnostic');
  assert.deepEqual(await f.verify(), before);

  await staged.close();
  await assertMissing(staged.executable);
  await assertMissing(resource);
  assert.deepEqual(await fs.readdir(log), []);
  assert.equal(await fs.readFile(diagnostic, 'utf8'), 'synthetic file picker diagnostic');
  assert.deepEqual(await f.verify(), before);
  assert.equal(await fs.readFile(f.manifestPath, 'utf8'), f.manifest);
});

test('preserves the Windows Zone.Identifier stream on the staged Electron executable', {
  skip:process.platform !== 'win32',
}, async t => {
  const f = await fixture(t);
  const before = await f.verify();
  const sourceStream = f.portable.electronExecutable + ':Zone.Identifier';
  const zone = Buffer.from('[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://download.example.test/review.zip\r\n');
  await fs.writeFile(sourceStream, zone, {flag:'wx'});
  assert.deepEqual(await f.verify(), before);

  const staged = await f.stage();
  const stagedStream = staged.executable + ':Zone.Identifier';
  assert.deepEqual(await fs.readFile(stagedStream), zone);
  await staged.close();

  await assertMissing(staged.executable);
  assert.deepEqual(await fs.readFile(sourceStream), zone);
  assert.deepEqual(await f.verify(), before);
});

test('rejects a same-size runtime hash mismatch without staging or changing source bytes', async t => {
  const f = await fixture(t);
  const altered = payload['runtime/electron/electron.exe'].replace('Electron', 'electron');
  await fs.writeFile(f.portable.electronExecutable, altered);

  await assert.rejects(f.stage());
  assert.deepEqual(await fs.readdir(f.runDirectory), []);
  assert.equal(await fs.readFile(f.portable.electronExecutable, 'utf8'), altered);
  assert.equal(await fs.readFile(f.manifestPath, 'utf8'), f.manifest);
  await fs.writeFile(f.portable.electronExecutable, payload['runtime/electron/electron.exe']);
  assert.equal((await f.verify()).manifestSha256, sha256(f.manifest));
});

test('rejects a linked work location and preserves both the real work directory and source package', async t => {
  const f = await fixture(t);
  const before = await f.verify();
  const alias = path.join(f.directory, 'Aliased work directory');
  await fs.symlink(f.runDirectory, alias, 'junction');

  await assert.rejects(f.stage(f.portable, alias));
  assert.ok((await fs.lstat(alias)).isSymbolicLink());
  assert.deepEqual(await fs.readdir(f.runDirectory), []);
  assert.deepEqual(await f.verify(), before);
});

test('permits an owned review run inside the package and leaves other manifest directories protected', async t => {
  const f = await fixture(t);
  const before = await f.verify();
  const tracked = path.dirname(f.portable.electronExecutable);
  await assert.rejects(f.stage(f.portable, tracked));
  assert.deepEqual(await f.verify(), before);

  const work = path.join(f.portable.rootDirectory, 'Synthetic preview');
  await fs.mkdir(work, {recursive:true});
  const staged = await f.stage(f.portable, work);
  await Promise.all([staged.close(), staged.close()]);
  await staged.close();
  assert.deepEqual(await fs.readdir(work), []);
  assert.deepEqual(await f.verify(), {...before, reviewRunsPresent:true});
});

test('refuses cleanup of a replaced working runtime and preserves both directory trees', async t => {
  const f = await fixture(t);
  const before = await f.verify();
  const staged = await f.stage();
  const original = path.dirname(staged.executable);
  const moved = path.join(f.runDirectory, 'Displaced runtime');
  await fs.rename(original, moved);
  await fs.mkdir(original);
  // Same names and bytes must not let cleanup adopt a directory it did not create.
  await fs.writeFile(staged.executable, payload['runtime/electron/electron.exe']);
  const marker = path.join(original, 'foreign-data.txt');
  await fs.writeFile(marker, 'synthetic foreign data');

  await assert.rejects(staged.close());
  assert.equal(await fs.readFile(staged.executable, 'utf8'), payload['runtime/electron/electron.exe']);
  assert.equal(await fs.readFile(path.join(moved, 'electron.exe'), 'utf8'), payload['runtime/electron/electron.exe']);
  assert.equal(await fs.readFile(marker, 'utf8'), 'synthetic foreign data');
  assert.deepEqual(await f.verify(), before);
});
