'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const receiptModule = () => import('../scripts/check-windows-release-msi.mjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const testerVersion = '0.61.1';
const installedVersion = '0.61.0';
const publisherSha256 = '7'.repeat(64);
const productCode = '{2ED3842D-0945-4487-B019-2E0D3A607112}';
const packageCode = '{9A17FBEC-0CD4-466E-B075-0E26382861F0}';
const inspector = path.resolve(__dirname, '../scripts/inspect-windows-release-msi.ps1');
const inputBytes = Buffer.from('Synthetic archive fixture for an injected Windows release pipeline.\n');
const appEntry = 'resources/app/desktop/main.cjs';
const approvedApp = Buffer.from('const revision = 1;\n');
const previousApp = Buffer.from('const revision = 0;\n');
const appPayloadSha256 = app => createHash('sha256')
  .update('shenyi.windows.app-payload.v1\0')
  .update(JSON.stringify(['desktop/main.cjs', app.length, digest(app)]) + '\n')
  .digest('hex');
const fixtureManifest = app => Buffer.from(JSON.stringify({
  version: testerVersion, files: { [appEntry]: { bytes: app.length, sha256: digest(app) } },
}, null, 2) + '\n');
const manifestBytes = fixtureManifest(approvedApp);
const signatureBytes = Buffer.alloc(64, 79);
const executableBytes = Buffer.from('Synthetic executable evidence, never executed.\n');
const publicKeyBytes = Buffer.from('Synthetic public key evidence, never interpreted.\n');

async function fixture(t, hooks = {}, app = approvedApp) {
  const bundleManifestBytes = fixtureManifest(app);
  const temp = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temp, "shenyi msi's receipt-"));
  t.after(async () => {
    assert.equal(path.dirname(root), temp);
    assert.equal(await fs.realpath(root), root);
    await fs.rm(root, { recursive: true, force: true });
  });
  const temporaryRoot = path.join(root, 'isolated receiver');
  const expected = {
    msi: path.join(root, 'original delivery.msi'), sha256: digest(inputBytes),
    publicKey: path.join(root, 'independent publisher key.pem'), publisherSha256,
    version: testerVersion, installedVersion, appPayloadSha256: appPayloadSha256(approvedApp),
  };
  const events = [];
  await fs.mkdir(temporaryRoot);
  await fs.writeFile(expected.msi, inputBytes, { flag: 'wx' });
  await fs.writeFile(expected.publicKey, publicKeyBytes, { flag: 'wx' });
  const systemDirectory = path.join(root, 'synthetic System32');
  const executable = path.join(systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const msiexec = path.join(systemDirectory, 'msiexec.exe');
  const release = {
    version: testerVersion, installedVersion, platform: 'win32', arch: 'x64',
    manifestSha256: digest(bundleManifestBytes), signatureSha256: digest(signatureBytes),
    publicKeySha256: digest(publicKeyBytes), publisherCertificateSha256: publisherSha256,
    fileCount: 2, totalBytes: executableBytes.length + app.length, osSignatureVerified: true,
  };
  const policy = {
    ok: true, sourcePolicyVerified: true, sha256: expected.sha256, version: testerVersion,
    arch: 'x64', productCode, packageCode, payloadFileCount: release.fileCount + 2,
    payloadBytes: release.totalBytes + bundleManifestBytes.length + signatureBytes.length,
    machineScope: true, releaseSourceDirectory: `ProgramFiles64Folder/Shenyi/ReleaseSource/${testerVersion}`,
    installationPerformed: false, installerSignatureVerified: false,
  };
  const state = { msi: '', extracted: '', workspace: '', protectedWorkspace: '' };
  const protectedWorkspaces = new Set();
  const deps = {
    platform: 'win32', temporaryRoot,
    async protectWorkspace(workspace) {
      assert.equal(path.dirname(workspace), temporaryRoot);
      assert.ok(!protectedWorkspaces.has(workspace));
      assert.deepEqual(await fs.readdir(workspace), []);
      protectedWorkspaces.add(workspace);
      state.protectedWorkspace = workspace;
      if (hooks.protect) await hooks.protect(workspace);
    },
    async verifyInstaller(options) {
      events.push('outer');
      state.msi = options['--msi'];
      state.workspace = path.dirname(state.msi);
      assert.equal(path.dirname(state.workspace), temporaryRoot);
      assert.equal(state.workspace, state.protectedWorkspace);
      assert.equal(path.basename(state.msi), 'shenyi-release.msi');
      assert.notEqual(state.msi, expected.msi);
      assert.deepEqual(options, {
        '--msi': state.msi, '--msi-sha256': expected.sha256, '--publisher-sha256': publisherSha256,
      });
      assert.deepEqual(await fs.readFile(state.msi), inputBytes);
      const verified = {
        file: state.msi, bytes: inputBytes.length, sha256: expected.sha256,
        publisherCertificateSha256: publisherSha256,
        installerOsSignatureVerified: true, timestampVerified: true, installerDatabaseVerified: true,
      };
      return hooks.outer ? hooks.outer(verified, state) : verified;
    },
    async resolveShell() {
      return { executable, systemDirectory, env: { SYSTEMROOT: root } };
    },
    async run(program, args, options) {
      if (program === executable) {
        events.push('inspect');
        assert.deepEqual(args, ['-NoProfile', '-NonInteractive', '-File', inspector,
          '-MsiPath', state.msi, '-ExpectedVersion', testerVersion, '-ExpectedSha256', expected.sha256]);
        assert.deepEqual(await fs.readFile(state.msi), inputBytes);
        const result = hooks.inspect ? await hooks.inspect(policy, state) : policy;
        return { stdout: typeof result === 'string' ? result : JSON.stringify(result), stderr: '' };
      }
      assert.equal(program, msiexec);
      events.push('extract');
      assert.equal(options.windowsVerbatimArguments, true);
      assert.equal(args[0], '/a');
      assert.equal(args[1], `"${state.msi}"`);
      assert.ok(!args.includes('/i'));
      assert.ok(args.includes('/qn'));
      assert.ok(args.includes('/norestart'));
      const target = /^TARGETDIR="([^"]+)"$/.exec(args.find(value => value.startsWith('TARGETDIR=')));
      assert.ok(target);
      state.extracted = target[1];
      assert.equal(path.dirname(state.extracted), state.workspace);
      assert.equal(path.dirname(args[args.indexOf('/L*V') + 1].slice(1, -1)), state.workspace);
      assert.deepEqual(await fs.readFile(state.msi), inputBytes);
      await fs.mkdir(path.join(state.extracted, 'bundle'), { recursive: true });
      await fs.writeFile(path.join(state.extracted, 'bundle', 'Shenyi.exe'), executableBytes);
      await fs.writeFile(path.join(state.extracted, 'bundle', 'candidate-manifest.json'), bundleManifestBytes);
      const appFile = path.join(state.extracted, 'bundle', appEntry);
      await fs.mkdir(path.dirname(appFile), { recursive: true });
      await fs.writeFile(appFile, app);
      await fs.writeFile(path.join(state.extracted, 'signature.ed25519'), signatureBytes);
      await fs.writeFile(path.join(state.extracted, 'shenyi-release.msi'), 'Synthetic transformed administrative metadata');
      if (hooks.extract) await hooks.extract(state);
      return { stdout: '', stderr: '' };
    },
    async verifyRelease(options) {
      events.push('inner');
      assert.deepEqual(options, {
        '--bundle': path.join(state.extracted, 'bundle'), '--signature': path.join(state.extracted, 'signature.ed25519'),
        '--public-key': expected.publicKey, '--publisher-sha256': publisherSha256, '--installed-version': installedVersion,
      });
      assert.deepEqual(await fs.readFile(path.join(options['--bundle'], 'Shenyi.exe')), executableBytes);
      assert.deepEqual(await fs.readFile(path.join(options['--bundle'], appEntry)), app);
      assert.deepEqual(await fs.readFile(options['--signature']), signatureBytes);
      return hooks.inner ? hooks.inner(release, state) : release;
    },
    async readManifest(bundle) {
      events.push('manifest');
      assert.equal(bundle, path.join(state.extracted, 'bundle'));
      const bytes = await fs.readFile(path.join(bundle, 'candidate-manifest.json'));
      const actualApp = await fs.readFile(path.join(bundle, appEntry));
      const source = { directory: bundle, bytes, manifestSha256: digest(bytes), manifest: JSON.parse(bytes),
        appPayloadSha256: appPayloadSha256(actualApp) };
      return hooks.manifest ? hooks.manifest(source, state) : source;
    },
  };
  const { checkWindowsReleaseMsi } = await receiptModule();
  const receive = (request = {}, mock = {}) => checkWindowsReleaseMsi({ ...expected, ...request }, { ...deps, ...mock });
  const unchanged = async () => {
    assert.deepEqual(await fs.readFile(expected.msi), inputBytes);
    assert.deepEqual(await fs.readFile(expected.publicKey), publicKeyBytes);
  };
  const cleaned = async () => {
    await unchanged();
    assert.deepEqual(await fs.readdir(temporaryRoot), []);
  };
  return { cleaned, unchanged, receive, events, expected, root, state, temporaryRoot };
}

async function replacePrivateBytes(state) {
  const before = await fs.stat(state.msi);
  const data = Buffer.from(inputBytes);
  data[0] ^= 1;
  try {
    await fs.chmod(state.msi, before.mode | 0o200);
    await fs.writeFile(state.msi, data);
    await fs.utimes(state.msi, before.atime, before.mtime);
  } finally {
    await fs.chmod(state.msi, before.mode);
  }
  assert.equal((await fs.stat(state.msi)).size, before.size);
}

test('a receipt binds the approved input to one private MSI through source inspection and admin extraction', async t => {
  const f = await fixture(t);
  const receipt = await f.receive();
  assert.deepEqual(f.events.slice(0, 3), ['outer', 'inspect', 'extract']);
  assert.deepEqual(f.events.slice(3).sort(), ['inner', 'manifest']);
  assert.equal(receipt.kind, 'shenyi-windows-final-msi-receipt');
  for (const flag of ['installerOsSignatureVerified', 'sourcePolicyVerified',
    'administrativeExtractionVerified', 'releaseOsSignatureVerified', 'timestampVerified',
    'installerDatabaseVerified']) assert.equal(receipt[flag], true, flag);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.systemInstallPerformed, false);
  assert.equal(receipt.msi, f.expected.msi);
  assert.equal(receipt.sha256, f.expected.sha256);
  assert.equal(receipt.bytes, inputBytes.length);
  assert.equal(receipt.version, testerVersion);
  assert.equal(receipt.installedVersion, installedVersion);
  assert.equal(receipt.platform, 'win32');
  assert.equal(receipt.arch, 'x64');
  assert.equal(receipt.publisherCertificateSha256, publisherSha256);
  assert.equal(receipt.releaseManifestSha256, digest(manifestBytes));
  assert.equal(receipt.releaseSignatureSha256, digest(signatureBytes));
  assert.equal(receipt.publicKeySha256, digest(publicKeyBytes));
  assert.equal(receipt.productCode, productCode);
  assert.equal(receipt.packageCode, packageCode);
  assert.equal(receipt.releaseFileCount, 2);
  assert.equal(receipt.releaseBytes, executableBytes.length + approvedApp.length);
  assert.equal(receipt.appPayloadSha256, f.expected.appPayloadSha256);
  assert.ok(!JSON.stringify(receipt).includes(JSON.stringify(f.state.workspace).slice(1, -1)));
  await f.cleaned();
});

test('the approved application digest is checked and reported after both signatures', async t => {
  const f = await fixture(t);
  const approvedDigest = appPayloadSha256(approvedApp);
  const receipt = await f.receive({ appPayloadSha256: approvedDigest.toUpperCase() });
  assert.deepEqual(f.events, ['outer', 'inspect', 'extract', 'inner', 'manifest']);
  assert.equal(receipt.appPayloadSha256, approvedDigest);
  assert.equal(receipt.systemInstallPerformed, false);
  await f.cleaned();
});

test('an independently approved application digest cannot match stale same-version content', async t => {
  assert.equal(previousApp.length, approvedApp.length);
  assert.equal(fixtureManifest(previousApp).length, manifestBytes.length);
  const f = await fixture(t, {}, previousApp);
  const oldReceipt = await f.receive({ appPayloadSha256: appPayloadSha256(previousApp) });
  assert.equal(oldReceipt.version, testerVersion);
  assert.equal(oldReceipt.releaseOsSignatureVerified, true);
  assert.equal(oldReceipt.installerOsSignatureVerified, true);
  const approvedDigest = appPayloadSha256(approvedApp);
  assert.notEqual(appPayloadSha256(previousApp), approvedDigest);
  f.events.length = 0;
  await assert.rejects(f.receive({ appPayloadSha256: approvedDigest }), { code: 'MSI_APP_PAYLOAD_MISMATCH' });
  assert.deepEqual(f.events, ['outer', 'inspect', 'extract', 'inner', 'manifest']);
  await f.cleaned();
});

test('an approved digest still requires application evidence from the verified manifest', async t => {
  const f = await fixture(t, { manifest: source => ({ ...source, appPayloadSha256: undefined }) });
  await assert.rejects(f.receive({ appPayloadSha256: appPayloadSha256(approvedApp) }), { code: 'MSI_APP_PAYLOAD_MISMATCH' });
  assert.deepEqual(f.events, ['outer', 'inspect', 'extract', 'inner', 'manifest']);
  await f.cleaned();
});

test('an omitted or malformed approved application digest stops before workspace protection', async t => {
  const f = await fixture(t);
  for (const appPayloadSha256 of [undefined, null, '', 'g'.repeat(64), '1'.repeat(63), 123]) {
    await assert.rejects(f.receive({ appPayloadSha256 }), { code: 'INVALID_ARGUMENTS' });
  }
  assert.equal(f.state.protectedWorkspace, '');
  assert.deepEqual(f.events, []);
  await f.cleaned();
});

test('the Windows CLI requires the approved application digest before looking for the MSI', {
  skip: process.platform !== 'win32',
}, async t => {
  const f = await fixture(t);
  const { sha256, publicKey, publisherSha256, version, installedVersion } = f.expected;
  const checker = path.resolve(__dirname, '../scripts/check-windows-release-msi.mjs');
  const missingMsi = path.join(f.root, 'missing release.msi');
  const result = spawnSync(process.execPath, [checker, '--msi', missingMsi, '--msi-sha256', sha256,
    '--public-key', publicKey, '--publisher-sha256', publisherSha256, '--version', version,
    '--installed-version', installedVersion, '--scratch-root', f.temporaryRoot], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).code, 'INVALID_ARGUMENTS');
  await f.cleaned();
});

test('provider, input, trust and downgrade failures run no inspection or installer', async t => {
  const f = await fixture(t);
  await assert.rejects(f.receive({}, { platform: 'linux' }), { code: 'WINDOWS_MSI_REQUIRED' });
  await assert.rejects(f.receive({ msi: path.basename(f.expected.msi) }), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(f.receive({ publicKey: path.basename(f.expected.publicKey) }), { code: 'INVALID_ARGUMENTS' });
  await assert.rejects(f.receive({ sha256: '0'.repeat(64) }), { code: 'MSI_DIGEST_MISMATCH' });
  await assert.rejects(f.receive({ installedVersion: testerVersion }), { code: 'CANDIDATE_VERSION_NOT_NEWER' });
  await assert.rejects(f.receive({ installedVersion: '0.62.0' }), { code: 'CANDIDATE_VERSION_NOT_NEWER' });
  const linked = path.join(f.root, 'second hardlink.msi');
  await fs.link(f.expected.msi, linked);
  await assert.rejects(f.receive({ msi: linked }), { code: 'MSI_PATH_INVALID' });
  assert.deepEqual(f.events, []);
  await f.cleaned();
});

test('workspace protection failure prevents the private copy and every validation tool call', async t => {
  const f = await fixture(t, { protect: () => { throw new Error('synthetic workspace protection failure'); } });
  await assert.rejects(f.receive({ msi: path.join(f.root, 'absent original archive.msi') }), { code: 'MSI_WORKSPACE_UNSAFE' });
  assert.ok(f.state.protectedWorkspace);
  assert.deepEqual(f.events, []);
  await f.cleaned();
});

test('a substituted workspace after protection is refused before archive access', async t => {
  let moved;
  const f = await fixture(t, { protect: async workspace => {
    moved = `${workspace}-old`;
    await fs.rename(workspace, moved);
    await fs.mkdir(workspace);
    await fs.writeFile(path.join(workspace, 'retain.txt'), 'unrelated replacement directory');
  } });
  await assert.rejects(f.receive({ msi: path.join(f.root, 'absent original archive.msi') }), { code: 'MSI_WORKSPACE_CHANGED' });
  assert.deepEqual(f.events, []);
  assert.deepEqual(await fs.readdir(moved), []);
  assert.deepEqual(await fs.readdir(f.state.protectedWorkspace), ['retain.txt']);
  await f.unchanged();
});

test('outer signing rejection or an incomplete outer receipt never reaches the structure or extraction tools', async t => {
  for (const [name, outer] of [
    ['authenticode rejection', () => { throw Object.assign(new Error('synthetic refusal'), { code: 'AUTHENTICODE_UNTRUSTED' }); }],
    ['wrong digest', valid => ({ ...valid, sha256: '0'.repeat(64) })],
    ['wrong publisher', valid => ({ ...valid, publisherCertificateSha256: '0'.repeat(64) })],
    ['unknown timestamp', valid => ({ ...valid, timestampVerified: false })],
    ['no MSI database proof', valid => ({ ...valid, installerDatabaseVerified: false })],
  ]) await t.test(name, async st => {
    const f = await fixture(st, { outer });
    await assert.rejects(f.receive(), { code: name === 'authenticode rejection' ? 'AUTHENTICODE_UNTRUSTED' : 'MSI_SIGNATURE_RECEIPT_MISMATCH' });
    assert.deepEqual(f.events, ['outer']);
    await f.cleaned();
  });
});

test('wrong structure receipt prevents all extraction and inner verification', async t => {
  for (const [name, inspect] of [
    ['invalid JSON', () => 'bad json'],
    ['unverified policy', policy => ({ ...policy, sourcePolicyVerified: false })],
    ['wrong approval digest', policy => ({ ...policy, sha256: '0'.repeat(64) })],
    ['wrong version', policy => ({ ...policy, version: '0.62.0' })],
    ['wrong architecture', policy => ({ ...policy, arch: 'arm64' })],
    ['system installation claimed', policy => ({ ...policy, installationPerformed: true })],
  ]) await t.test(name, async st => {
    const f = await fixture(st, { inspect });
    await assert.rejects(f.receive(), { code: 'MSI_SOURCE_POLICY_FAILED' });
    assert.deepEqual(f.events, ['outer', 'inspect']);
    await f.cleaned();
  });
});

test('admin image must have only the prescribed real bundle directory and files', async t => {
  for (const [name, extract] of [
    ['extractor rejection', async () => { throw new Error('synthetic admin extraction refusal'); }],
    ['extra root member', async ({ extracted }) => fs.writeFile(path.join(extracted, 'extra.txt'), 'unexpected')],
    ['missing signature', async ({ extracted }) => fs.unlink(path.join(extracted, 'signature.ed25519'))],
    ['wrong type for root signature', async ({ extracted }) => {
      const item = path.join(extracted, 'signature.ed25519');
      await fs.unlink(item);
      await fs.mkdir(item);
    }],
    ['linked root signature', async ({ extracted }) => {
      const item = path.join(extracted, 'signature.ed25519');
      const other = path.join(path.dirname(extracted), 'extra source');
      await fs.rename(item, other);
      await fs.link(other, item);
    }],
  ]) await t.test(name, async st => {
    const f = await fixture(st, { extract });
    await assert.rejects(f.receive(), { code: name === 'extractor rejection' ? 'MSI_EXTRACTION_FAILED' : 'MSI_IMAGE_INVALID' });
    assert.deepEqual(f.events, ['outer', 'inspect', 'extract']);
    await f.cleaned();
  });
});

test('inner release and manifest must reconcile with approved version, publisher and policy count and bytes', async t => {
  for (const [name, hooks] of [
    ['failed inner signature', { inner: () => { throw Object.assign(new Error('synthetic bundle signature refusal'), { code: 'AUTHENTICODE_BUNDLE_INVALID' }); } }],
    ['OS signature unverified', { inner: release => ({ ...release, osSignatureVerified: false }) }],
    ['wrong inner publisher', { inner: release => ({ ...release, publisherCertificateSha256: '0'.repeat(64) }) }],
    ['wrong inner version', { inner: release => ({ ...release, version: '0.62.0' }) }],
    ['payload count mismatch', { inspect: policy => ({ ...policy, payloadFileCount: policy.payloadFileCount + 1 }) }],
    ['payload byte mismatch', { inspect: policy => ({ ...policy, payloadBytes: policy.payloadBytes + 1 }) }],
    ['manifest digest mismatch', { manifest: source => ({ ...source, manifestSha256: '0'.repeat(64) }) }],
  ]) await t.test(name, async st => {
    const f = await fixture(st, hooks);
    await assert.rejects(f.receive(), { code: name === 'failed inner signature' ? 'AUTHENTICODE_BUNDLE_INVALID' : 'MSI_RELEASE_MISMATCH' });
    assert.deepEqual(f.events.slice(0, 3), ['outer', 'inspect', 'extract']);
    assert.ok(f.events.includes('inner') || f.events.includes('manifest'));
    await f.cleaned();
  });
});

test('same-size private MSI changes cannot survive an approval phase', async t => {
  for (const [boundary, expectedEvents] of [
    ['outer', ['outer']], ['inspect', ['outer', 'inspect']], ['extract', ['outer', 'inspect', 'extract']],
  ]) await t.test(boundary, async st => {
    const hook = boundary === 'extract' ? replacePrivateBytes : async (value, state) => {
      await replacePrivateBytes(state);
      return value;
    };
    const f = await fixture(st, { [boundary]: hook });
    await assert.rejects(f.receive(), { code: 'MSI_CHANGED' });
    assert.deepEqual(f.events, expectedEvents);
    await f.cleaned();
  });
  await t.test('positive inner verifier cannot bless subsequently changed MSI', async st => {
    const f = await fixture(st, { inner: async (value, state) => {
      await replacePrivateBytes(state);
      return value;
    } });
    await assert.rejects(f.receive(), { code: 'MSI_CHANGED' });
    assert.ok(f.events.includes('inner'));
    await f.cleaned();
  });
});

test('finalization preserves a real directory unexpectedly substituted for the private workspace', async t => {
  const ownerData = 'unrelated simulated directory marker';
  let moved;
  const f = await fixture(t, { inner: async (value, { workspace }) => {
    moved = `${workspace}-old`;
    await fs.rename(workspace, moved);
    await fs.mkdir(workspace);
    await fs.writeFile(path.join(workspace, 'retain.txt'), ownerData);
    return value;
  } });
  await assert.rejects(f.receive(), { code: 'MSI_WORKSPACE_CHANGED' });
  assert.ok(f.events.includes('inner'));
  const { workspace } = f.state;
  assert.equal(await fs.readFile(path.join(workspace, 'retain.txt'), 'utf8'), ownerData);
  assert.deepEqual(await fs.readFile(path.join(moved, 'shenyi-release.msi')), inputBytes);
  await f.unchanged();
});
