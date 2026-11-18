'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const inventory = require('../scripts/windows-desktop-candidate-files.json');
const tools = import('../scripts/build-windows-desktop-candidate.mjs');

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(parent, 'shenyi-windows-candidate-test-'));
  t.after(async () => {
    const owned = await fs.realpath(directory);
    assert.equal(path.dirname(owned), parent);
    assert.match(path.basename(owned), /^shenyi-windows-candidate-test-/);
    await fs.rm(owned, { recursive: true });
  });
  return directory;
}

test('candidate inventory is the exact main, preload, worker and protocol file graph', async () => {
  const main = await fs.readFile(path.join(root, 'desktop/main.cjs'), 'utf8');
  const rel = file => path.relative(root, file).split(path.sep).join('/');
  const mainRoutes = [...main.matchAll(/file:path\.join\(__dirname,'([^']+)'\)/g)].map(([, file]) => rel(path.resolve(root, 'desktop', file)));
  const { ASSETS: previewRoutes } = require('../desktop/material-preview-window.cjs');
  const pending = ['desktop/main.cjs', 'desktop/preload.cjs', ...mainRoutes, ...Object.values(previewRoutes).map(asset => rel(asset.file))];
  const files = new Set();
  const external = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (files.has(file)) continue;
    assert.equal((await fs.lstat(path.join(root, file))).isFile(), true);
    files.add(file);
    if (!/\.(?:cjs|js)$/.test(file)) continue;
    const source = await fs.readFile(path.join(root, file), 'utf8');
    for (const [, dependency] of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (dependency.startsWith('.')) pending.push(rel(path.resolve(root, path.dirname(file), dependency)));
      else if (dependency !== 'electron' && !dependency.startsWith('node:')) external.add(dependency);
    }
  }
  assert.deepEqual([...files].sort(), [...inventory.sourceFiles].sort());
  assert.deepEqual([...external], ['jsdom']);
  const worker = await fs.readFile(path.join(root, 'desktop/workpaper-package-worker.cjs'), 'utf8');
  assert.match(worker, /new Worker\(__filename,/);
  assert.ok(files.has('desktop/workpaper-package-worker.cjs'));
  assert.ok(!inventory.runtimeRootFiles.includes('resources/default_app.asar'));
});

test('archive integrity requires the complete pinned digest of a regular file', async t => {
  const directory = await fixture(t);
  const archive = path.join(directory, 'electron-fixture.zip');
  const bytes = Buffer.from('local integrity fixture');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(archive, bytes);
  const { verifyElectronArchive } = await tools;
  const facts = await verifyElectronArchive(archive, sha256);
  assert.equal(facts.file, await fs.realpath(archive));
  assert.equal(facts.bytes, bytes.length);
  assert.equal(facts.sha256, sha256);
  await assert.rejects(verifyElectronArchive(archive, '0'.repeat(64)), /与官方校验值不符/);
  await assert.rejects(verifyElectronArchive(archive, sha256.slice(1)), /缺少/);
  await assert.rejects(verifyElectronArchive(directory, sha256), /普通文件/);
});

test('output refuses existing targets and checkout paths including aliases', async t => {
  const directory = await fixture(t);
  const checkout = path.join(directory, 'checkout');
  const existing = path.join(directory, 'existing');
  const newFolder = path.join(directory, 'new');
  const alias = path.join(directory, 'outside-alias');
  await Promise.all([fs.mkdir(checkout), fs.mkdir(existing)]);
  await fs.writeFile(path.join(existing, 'preserve.txt'), 'existing');
  await fs.symlink(checkout, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const { resolveBuildOutput } = await tools;
  await assert.rejects(resolveBuildOutput(existing, checkout), /已存在/);
  await assert.rejects(resolveBuildOutput(path.join(checkout, 'new'), checkout), /仓库外/);
  await assert.rejects(resolveBuildOutput(path.join(alias, 'new'), checkout), /实际位置/);
  assert.equal(await resolveBuildOutput(newFolder, checkout), newFolder);
  assert.equal(await fs.readFile(path.join(existing, 'preserve.txt'), 'utf8'), 'existing');
  assert.deepEqual(await fs.readdir(checkout), []);
});
