'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'scripts', 'linux-release-signature.mjs');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "shenyi linux's release "));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const delivery = path.join(directory, 'delivery');
  const trust = path.join(directory, 'trust');
  await Promise.all([fs.mkdir(delivery), fs.mkdir(trust)]);
  const archive = path.join(delivery, 'release.tar');
  const signature = path.join(delivery, 'release.ed25519');
  const publicKey = path.join(trust, 'release.pub.pem');
  const privateKey = path.join(trust, 'release.private.pem');
  const wrongKey = path.join(trust, 'another.pub.pem');
  const keys = generateKeyPairSync('ed25519');
  const revision = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync('git', ['archive', '--format=tar', '--output=' + archive, revision, '--', 'package.json'], { cwd: root });
  await Promise.all([
    fs.writeFile(publicKey, keys.publicKey.export({ format: 'pem', type: 'spki' })),
    fs.writeFile(privateKey, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 }),
    fs.writeFile(wrongKey, generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' })),
  ]);
  function invoke(operation, overrides = {}) {
    const values = { archive, revision, publicKey, privateKey, signature, ...overrides };
    const flags = operation === 'sign' ? ['--private-key', values.privateKey, '--output', values.signature] :
      ['--public-key', values.publicKey, '--signature', values.signature];
    return JSON.parse(execFileSync(process.execPath,
      [cli, operation, '--archive', values.archive, '--revision', values.revision, ...flags],
      { encoding: 'utf8', stdio: 'pipe', windowsHide: true }));
  }
  return { archive, delivery, signature, publicKey, wrongKey, keys, revision, invoke };
}

function refused(run, code) {
  assert.throws(run, error => error.status === 1 && error.stdout === '' && JSON.parse(error.stderr).code === code);
}

test('Linux Git TAR signs and verifies the whole archive with a detached signature', async t => {
  const f = await fixture(t);
  const bytes = await fs.readFile(f.archive);
  const issued = f.invoke('sign');
  const verified = f.invoke('verify');
  const signature = await fs.readFile(f.signature);
  assert.equal(signature.length, 64);
  assert.equal(verified.archiveExtracted, false);
  assert.deepEqual(verified, { ...issued, operation: 'verify' });
  assert.deepEqual(verified.archive, { revision: f.revision, bytes: bytes.length, sha256: sha256(bytes) });
  assert.equal(verified.signatureSha256, sha256(signature));
  refused(() => f.invoke('sign'), 'SIGNATURE_OUTPUT_INVALID');
  assert.deepEqual(await fs.readFile(f.signature), signature);
  assert.deepEqual(await fs.readFile(f.archive), bytes);
});

test('Linux archive verification rejects changed data, a foreign key and a different signature domain', async t => {
  const f = await fixture(t);
  const issued = f.invoke('sign');
  refused(() => f.invoke('verify', { publicKey: f.wrongKey }), 'SIGNATURE_INVALID');
  const alternate = path.join(f.delivery, 'alternate.tar');
  const altered = await fs.readFile(f.archive);
  altered[3 * 512] ^= 1;
  await fs.writeFile(alternate, altered);
  refused(() => f.invoke('verify', { archive: alternate }), 'SIGNATURE_INVALID');
  const otherSignature = path.join(f.delivery, 'other.ed25519');
  const { revision, bytes, sha256: archiveDigest } = issued.archive;
  await fs.writeFile(otherSignature, sign(null, Buffer.from(`another-release-domain\n${revision}\n${bytes}\n${archiveDigest}\n`), f.keys.privateKey));
  refused(() => f.invoke('verify', { signature: otherSignature }), 'SIGNATURE_INVALID');
  await fs.writeFile(otherSignature, Buffer.alloc(63));
  refused(() => f.invoke('verify', { signature: otherSignature }), 'SIGNATURE_INVALID');
});

test('Linux archive signing rejects mismatched provenance and invalid Git header metadata before writing', async t => {
  const f = await fixture(t);
  refused(() => f.invoke('sign', { revision: f.revision.slice(0, 7) }), 'INVALID_ARGUMENTS');
  refused(() => f.invoke('sign', { revision: '0'.repeat(40) }), 'ARCHIVE_REVISION_MISMATCH');
  const wrongHeader = path.join(f.delivery, 'wrong-header.tar');
  const changed = await fs.readFile(f.archive);
  changed[100] ^= 1;
  await fs.writeFile(wrongHeader, changed);
  refused(() => f.invoke('sign', { archive: wrongHeader }), 'ARCHIVE_INVALID');
  const treeArchive = path.join(f.delivery, 'tree-only.tar');
  execFileSync('git', ['archive', '--format=tar', '--output=' + treeArchive, f.revision + '^{tree}', '--', 'package.json'], { cwd: root });
  refused(() => f.invoke('sign', { archive: treeArchive }), 'ARCHIVE_INVALID');
  await assert.rejects(fs.stat(f.signature), { code: 'ENOENT' });
});

test('Linux deployment public key is independent of the delivered files', async t => {
  const f = await fixture(t);
  f.invoke('sign');
  const packagedKey = path.join(f.delivery, 'public-key.pem');
  await fs.copyFile(f.publicKey, packagedKey);
  refused(() => f.invoke('verify', { publicKey: packagedKey }), 'VERIFICATION_KEY_INVALID');
  const linked = path.join(f.delivery, 'alias.tar');
  await fs.link(f.archive, linked);
  refused(() => f.invoke('verify', { archive: linked }), 'ARCHIVE_INVALID');
});

test('a source stability failure during publication removes only the new detached signature', async t => {
  const f = await fixture(t);
  const { detachedSignatureFiles } = await import('../scripts/detached-release-signature.mjs');
  const { publishSignature } = detachedSignatureFiles(code => { throw Object.assign(new Error(code), { code }); });
  let checks = 0;
  await assert.rejects(publishSignature(f.signature, Buffer.alloc(64), async () => {
    if (++checks === 2) throw new Error('source changed');
  }), { code: 'SIGNATURE_OUTPUT_INVALID' });
  assert.equal(checks, 2);
  assert.deepEqual(await fs.readdir(f.delivery), ['release.tar']);
});
