'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, generateKeyPairSync, verify } = require('node:crypto');

const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-candidate-sig-'));
  const bundle = path.join(directory, 'candidate');
  const files = {
    'Shenyi.exe': 'synthetic executable bytes',
    'Shenyi_wer.dll': 'synthetic helper bytes',
    'resources/app/desktop/main.cjs': 'module.exports = {};\n',
    'resources/app/desktop/preload.cjs': 'module.exports = {};\n',
    'resources/app/node_modules/jsdom/package.json': json({ name: 'jsdom', version: '30.1.3' }),
    'resources/app/package-lock.json': json({ fixture: true }),
    'resources/app/package.json': json({ name: 'shenyi-team-desktop', productName: '审易', version: '0.61.0', private: true, main: 'desktop/main.cjs', dependencies: { jsdom: '30.1.3' } }),
  };
  const records = {};
  for (const filename of Object.keys(files).sort()) {
    const content = Buffer.from(files[filename]);
    const destination = path.join(bundle, filename);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, { flag: 'wx' });
    records[filename] = { bytes: content.length, sha256: sha(content) };
  }
  const manifest = {
    schemaVersion: 1, kind: 'shenyi-windows-desktop-candidate', platform: 'win32', arch: 'x64', releaseStatus: 'unsigned-portable-candidate',
    version: '0.61.0', trustedServiceProfileIncluded: false,
    electron: { version: '45.3.2', archive: 'electron-v45.3.2-win32-x64.zip', bytes: 158318730, sha256: 'a'.repeat(64) },
    sourceFileCount: 2, productionPackageCount: 1, files: records,
  };
  const manifestPath = path.join(bundle, 'candidate-manifest.json');
  await fs.writeFile(manifestPath, json(manifest), { flag: 'wx' });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPath = path.join(directory, 'publisher-public.pem');
  const privatePath = path.join(directory, 'publisher-private.pem');
  await fs.writeFile(publicPath, publicKey.export({ format: 'pem', type: 'spki' }), { flag: 'wx' });
  await fs.writeFile(privatePath, privateKey.export({ format: 'pem', type: 'pkcs8' }), { flag: 'wx', mode: 0o600 });
  const common = { '--bundle': bundle, '--signature': path.join(directory, 'candidate.sig') };
  const signOptions = { ...common, '--private-key': privatePath };
  const verifyOptions = { ...common, '--public-key': publicPath, '--installed-version': '0.60.0' };
  return { directory, bundle, manifestPath, manifest, publicKey, privatePath, signOptions, verifyOptions, signature: common['--signature'] };
}

test('detached signature authenticates exact candidate bytes and does not overwrite its output', async () => {
  const f = await fixture();
  const { signWindowsCandidate, verifyWindowsCandidate } = await import('../scripts/windows-candidate-signature.mjs');
  const signed = await signWindowsCandidate(f.signOptions);
  const manifestBytes = await fs.readFile(f.manifestPath);
  const signature = await fs.readFile(f.signature);
  assert.equal(signature.length, 64);
  assert.equal(verify(null, Buffer.concat([Buffer.from('shenyi.windows-candidate.manifest.v1\0'), manifestBytes]), f.publicKey, signature), true);
  assert.equal(verify(null, manifestBytes, f.publicKey, signature), false);
  const verified = await verifyWindowsCandidate(f.verifyOptions);
  assert.equal(verified.version, '0.61.0');
  assert.equal(verified.installedVersion, '0.60.0');
  assert.equal(verified.manifestSha256, sha(manifestBytes));
  assert.equal(verified.publicKeySha256, signed.publicKeySha256);
  assert.equal(verified.fileCount, Object.keys(f.manifest.files).length);
  assert.equal(verified.osSignatureVerified, false);
  await assert.rejects(signWindowsCandidate(f.signOptions), { code: 'SIGNATURE_OUTPUT_INVALID' });
  await assert.rejects(signWindowsCandidate({ ...f.signOptions, '--signature': path.join(f.bundle, 'new-signature.sig') }), { code: 'SIGNATURE_OUTPUT_INVALID' });
  assert.deepEqual(await fs.readFile(f.signature), signature);
  assert.equal((await fs.readdir(f.directory)).some(name => name.endsWith('.pending')), false);
});

test('trusted key, installed version and signature are checked independently', async () => {
  const f = await fixture();
  const { signWindowsCandidate, verifyWindowsCandidate } = await import('../scripts/windows-candidate-signature.mjs');
  await signWindowsCandidate(f.signOptions);
  const wrongKey = path.join(f.directory, 'wrong-public.pem');
  await fs.writeFile(wrongKey, generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }), { flag: 'wx' });
  await assert.rejects(verifyWindowsCandidate({ ...f.verifyOptions, '--public-key': wrongKey }), { code: 'CANDIDATE_SIGNATURE_INVALID' });
  await assert.rejects(verifyWindowsCandidate({ ...f.verifyOptions, '--public-key': f.privatePath }), { code: 'VERIFICATION_KEY_INVALID' });
  for (const version of ['0.61.0', '1.0.0']) {
    await assert.rejects(verifyWindowsCandidate({ ...f.verifyOptions, '--installed-version': version }), { code: 'CANDIDATE_VERSION_NOT_NEWER' });
  }
  await assert.rejects(verifyWindowsCandidate({ ...f.verifyOptions, '--installed-version': '0.60.00' }), { code: 'CANDIDATE_VERSION_INVALID' });
  const signature = await fs.readFile(f.signature);
  signature[0] ^= 1;
  await fs.writeFile(f.signature, signature);
  await assert.rejects(verifyWindowsCandidate(f.verifyOptions), { code: 'CANDIDATE_SIGNATURE_INVALID' });
});

test('payload changes and unexpected files or directories reject a correctly signed manifest', async () => {
  const f = await fixture();
  const { signWindowsCandidate, verifyWindowsCandidate } = await import('../scripts/windows-candidate-signature.mjs');
  await signWindowsCandidate(f.signOptions);
  const extra = path.join(f.bundle, 'extra.bin');
  await fs.writeFile(extra, 'unexpected', { flag: 'wx' });
  await assert.rejects(verifyWindowsCandidate(f.verifyOptions), { code: 'CANDIDATE_INVENTORY_INVALID' });
  await fs.unlink(extra);
  const empty = path.join(f.bundle, 'unexpected-directory');
  await fs.mkdir(empty);
  await assert.rejects(verifyWindowsCandidate(f.verifyOptions), { code: 'CANDIDATE_INVENTORY_INVALID' });
  await fs.rmdir(empty);
  const file = path.join(f.bundle, 'resources/app/desktop/main.cjs');
  const altered = await fs.readFile(file);
  altered[0] ^= 1;
  await fs.writeFile(file, altered);
  await assert.rejects(verifyWindowsCandidate(f.verifyOptions), { code: 'CANDIDATE_INVENTORY_INVALID' });
  assert.deepEqual(await fs.readFile(file), altered);
});

test('ambiguous or Windows-alias manifest entries cannot be signed', async () => {
  const f = await fixture();
  const { signWindowsCandidate } = await import('../scripts/windows-candidate-signature.mjs');
  const valid = await fs.readFile(f.manifestPath, 'utf8');
  const expected = { code: 'CANDIDATE_MANIFEST_INVALID' };
  await fs.writeFile(f.manifestPath, valid.replace('"schemaVersion": 1,', '"schemaVersion": 1,\n  "schemaVersion": 1,'));
  await assert.rejects(signWindowsCandidate(f.signOptions), expected);
  for (const filename of ['ShEnYi.ExE', 'resources/app/desktop/CON.js', 'resources/app/desktop/../other.js', 'resources/app/desktop/main.cjs:extra']) {
    const files = { ...f.manifest.files, [filename]: { bytes: 1, sha256: 'b'.repeat(64) } };
    const reordered = Object.fromEntries(Object.keys(files).sort().map(key => [key, files[key]]));
    await fs.writeFile(f.manifestPath, json({ ...f.manifest, files: reordered }));
    await assert.rejects(signWindowsCandidate(f.signOptions), expected);
  }
  await assert.rejects(fs.stat(f.signature), { code: 'ENOENT' });
});
