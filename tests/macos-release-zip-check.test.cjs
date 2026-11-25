'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const wrapper = path.resolve(__dirname, '../scripts/check-macos-release-zip.mjs');
const verifier = path.resolve(__dirname, '../scripts/build-macos-desktop-archive.py');
const nativeCodesignError = Object.assign(new Error('synthetic signature refusal'), { code: 'CODE_SIGNATURE_INVALID' });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-zip-check-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const temporaryRoot = path.join(directory, 'private-staging');
  const archive = path.join(directory, 'received release.zip');
  const bytes = Buffer.from('synthetic archive bytes for isolated command-boundary tests');
  await fs.mkdir(temporaryRoot, { mode: 0o700 });
  await fs.writeFile(archive, bytes);
  const { checkMacosReleaseZip } = await import('../scripts/check-macos-release-zip.mjs');
  return { directory, temporaryRoot, bytes, checkMacosReleaseZip, input: {
    archive, sha256: createHash('sha256').update(bytes).digest('hex'), python: process.execPath,
    appPayloadSha256: 'a'.repeat(64),
    teamId: 'A1B2C3D4E5', bundleId: 'cn.example.shenyi', version: '0.61.0', installedVersion: '0.60.0', arch: 'arm64',
  } };
}

function archiveReceipt({ input, bytes }) {
  return {
    format: 'shenyi-macos-release-zip', archiveSha256: input.sha256, archiveBytes: bytes.length,
    archiveEntries: 28, symlinks: 4, appFiles: 8, bundleIdentifier: input.bundleId,
    arch: input.arch, version: input.version,
    appPayloadSha256: input.appPayloadSha256,
  };
}

async function replaceCopyContents(filename, bytes) {
  const mode = (await fs.stat(filename)).mode & 0o777;
  const changed = Buffer.from(bytes);
  changed[0] ^= 1;
  await fs.chmod(filename, 0o600);
  await fs.writeFile(filename, changed);
  await fs.chmod(filename, mode);
}

function commandBoundary(f, { verify, extract, verifyExpanded, native } = {}) {
  const calls = [];
  let privateZip;
  let expectedApp;
  let scans = 0;
  const receipt = archiveReceipt(f);
  return { calls, options: {
    platform: 'darwin', temporaryRoot: f.temporaryRoot,
    async run(program, args) {
      if (program === f.input.python) {
        if (args[2] === '--verify-extracted-payload') {
          const phase = ++scans === 1 ? 'before' : 'after';
          calls.push(`verify expanded payload ${phase}`);
          assert.deepEqual(args, ['-I', verifier, '--verify-extracted-payload', expectedApp,
            '--app-payload-sha256', f.input.appPayloadSha256]);
          const result = { format: 'shenyi-macos-extracted-app-payload', appFiles: receipt.appFiles,
            appPayloadSha256: f.input.appPayloadSha256 };
          const stdout = verifyExpanded ? await verifyExpanded({ phase, receipt: result }) : JSON.stringify(result);
          return { stdout };
        }
        calls.push('verify ZIP');
        privateZip = args[3];
        const expectedArgs = ['-I', verifier, '--verify-release', privateZip, f.input.arch, f.input.version,
          '--bundle-id', f.input.bundleId, '--sha256', f.input.sha256, '--app-payload-sha256', f.input.appPayloadSha256];
        assert.deepEqual(args, expectedArgs);
        assert.notEqual(privateZip, f.input.archive);
        const relative = path.relative(f.temporaryRoot, privateZip);
        assert.ok(relative && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..');
        assert.equal(await fs.realpath(privateZip), privateZip);
        assert.deepEqual(await fs.readFile(privateZip), f.bytes);
        if (process.platform !== 'win32') {
          assert.equal((await fs.stat(path.dirname(privateZip))).mode & 0o777, 0o700);
          assert.equal((await fs.stat(privateZip)).mode & 0o777, 0o400);
        }
        const stdout = verify ? await verify({ receipt, privateZip }) : JSON.stringify(receipt);
        return { stdout };
      }
      assert.equal(program, '/usr/bin/ditto');
      calls.push('extract approved ZIP');
      const destination = args.at(-1);
      assert.deepEqual(args, ['-x', '-k', '--rsrc', privateZip, destination]);
      assert.deepEqual(await fs.readFile(privateZip), f.bytes);
      assert.deepEqual(await fs.readdir(destination), []);
      expectedApp = path.join(destination, 'Shenyi.app');
      await fs.mkdir(expectedApp);
      if (extract) await extract({ privateZip, destination, app: expectedApp });
      return { stdout: '' };
    },
    async checkApp(input) {
      calls.push('assess expanded application');
      const { teamId, bundleId, version, arch } = f.input;
      assert.deepEqual(input, { app: expectedApp, teamId, bundleId, version, arch });
      assert.equal(await fs.realpath(input.app), input.app);
      const receipt = {
        schemaVersion: 1, kind: 'shenyi-macos-native-release-app-check', app: expectedApp,
        osVersion: '14.7.1', hostProcessArch: arch, assessment: 'syspolicy_check',
        teamId, bundleId, version, mainExecutableArch: arch, cdHash: '1'.repeat(40),
        timestamp: 'Nov 19, 2026 at 12:00:00', appTreeSha256: '2'.repeat(64),
        archiveVerified: false, appLaunched: false, checkedAt: '2026-11-19T12:00:00Z',
      };
      return (await native?.(input, receipt, privateZip)) ?? receipt;
    },
  } };
}

async function checkFixture(f, model) {
  try {
    return await f.checkMacosReleaseZip(f.input, model.options);
  } finally {
    assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
    assert.deepEqual(await fs.readFile(f.input.archive), f.bytes);
  }
}

test('receipt binds one held archive copy to extraction and native app assessment', async t => {
  const f = await fixture(t);
  const model = commandBoundary(f);
  const result = await checkFixture(f, model);
  assert.deepEqual(model.calls, ['verify ZIP', 'extract approved ZIP', 'verify expanded payload before',
    'assess expanded application', 'verify expanded payload after']);
  assert.equal(result.kind, 'shenyi-macos-native-release-zip-check');
  assert.equal(result.archiveVerified, true);
  assert.equal(result.appLaunched, false);
  assert.equal(result.archiveSha256, f.input.sha256);
  assert.equal(result.archiveBytes, f.bytes.length);
  assert.equal(result.appPayloadSha256, f.input.appPayloadSha256);
  assert.equal(result.extractedAppPayloadVerified, true);
  assert.equal(result.archiveEntries, 28);
  assert.equal(result.symlinks, 4);
  assert.equal(result.appFiles, 8);
  assert.equal(result.teamId, f.input.teamId);
  assert.equal(result.bundleId, f.input.bundleId);
  assert.equal(result.version, f.input.version);
  assert.equal(result.installedVersion, f.input.installedVersion);
  assert.equal(result.mainExecutableArch, f.input.arch);
  assert.equal(result.appTreeSha256, '2'.repeat(64));
  assert.ok(!Object.hasOwn(result, 'app'));
  assert.ok(!JSON.stringify(result).includes('private-staging'));
});

test('final ZIP receipt records a first install and compares version segments numerically', async t => {
  for (const [version, installedVersion] of [
    ['0.61.0', '0.0.0'],
    ['10.0.0', '9.99.99'],
    ['1.10.0', '1.9.99'],
    ['1.0.10', '1.0.9'],
  ]) {
    await t.test(`${installedVersion} to ${version}`, async t => {
      const f = await fixture(t);
      Object.assign(f.input, { version, installedVersion });
      const model = commandBoundary(f);
      const result = await checkFixture(f, model);
      assert.equal(result.version, version);
      assert.equal(result.installedVersion, installedVersion);
      assert.equal(result.extractedAppPayloadVerified, true);
    });
  }
});

test('invalid final ZIP versions fail before reading the archive, staging or running native commands', async t => {
  const f = await fixture(t);
  const model = commandBoundary(f);
  const input = { ...f.input, archive: path.join(f.directory, 'missing release.zip') };
  await fs.rmdir(f.temporaryRoot);
  for (const field of ['version', 'installedVersion']) {
    const absent = { ...input };
    delete absent[field];
    await assert.rejects(f.checkMacosReleaseZip(absent, model.options), { code: 'INVALID_ARGUMENTS' }, `${field} absent`);
    for (const value of [null, '', 1, '0.60', '0.60.0-rc1', '00.60.0', '0.060.0', '0.60.00',
      '0.60.0\n', '0.60.0\r\n', '0.60.1e2', '9007199254740992.0.0']) {
      await assert.rejects(f.checkMacosReleaseZip({ ...input, [field]: value }, model.options),
        { code: 'INVALID_ARGUMENTS' }, `${field} = ${JSON.stringify(value)}`);
    }
  }
  await assert.rejects(fs.lstat(f.temporaryRoot), { code: 'ENOENT' });
  assert.deepEqual(model.calls, []);
});

test('same or older final ZIP versions are refused before reading the archive, staging or running native commands', async t => {
  const f = await fixture(t);
  const model = commandBoundary(f);
  const input = { ...f.input, archive: path.join(f.directory, 'missing release.zip') };
  await fs.rmdir(f.temporaryRoot);
  for (const installedVersion of ['0.61.0', '0.61.1', '0.100.0', '1.0.0']) {
    await assert.rejects(f.checkMacosReleaseZip({ ...input, installedVersion }, model.options),
      { code: 'CANDIDATE_VERSION_NOT_NEWER' }, `${input.version} cannot replace ${installedVersion}`);
  }
  await assert.rejects(fs.lstat(f.temporaryRoot), { code: 'ENOENT' });
  assert.deepEqual(model.calls, []);
});

test('wrong trusted digest and linked inputs are refused before running external commands', async t => {
  const f = await fixture(t);
  const model = commandBoundary(f);
  await assert.rejects(f.checkMacosReleaseZip({ ...f.input, sha256: '3'.repeat(64) }, model.options),
    { code: 'ARCHIVE_DIGEST_MISMATCH' });
  assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
  await fs.link(f.input.archive, path.join(f.directory, 'hardlink.zip'));
  await assert.rejects(checkFixture(f, model), { code: 'ARCHIVE_PATH_INVALID' });
  assert.deepEqual(model.calls, []);
});

test('unusable or mismatching ZIP verifier responses cannot reach extraction', async t => {
  const f = await fixture(t);
  const overrides = [
    ['invalid JSON', () => 'unusable'],
    ['unexpected format', r => JSON.stringify({ ...r, format: 'candidate' })],
    ['different hash', r => JSON.stringify({ ...r, archiveSha256: '4'.repeat(64) })],
    ['different byte count', r => JSON.stringify({ ...r, archiveBytes: r.archiveBytes + 1 })],
    ['different bundle identity', r => JSON.stringify({ ...r, bundleIdentifier: 'cn.example.other' })],
    ['different architecture', r => JSON.stringify({ ...r, arch: 'x64' })],
    ['different version', r => JSON.stringify({ ...r, version: '0.61.1' })],
    ['invalid count', r => JSON.stringify({ ...r, appFiles: '8' })],
    ['count exceeds archive', r => JSON.stringify({ ...r, appFiles: r.archiveEntries })],
  ];
  for (const [label, reply] of overrides) {
    await t.test(label, async () => {
      const model = commandBoundary(f, { verify: ({ receipt }) => reply(receipt) });
      await assert.rejects(checkFixture(f, model));
      assert.deepEqual(model.calls, ['verify ZIP']);
    });
  }
});

test('missing or invalid approved payload digest stops before staging or release commands', async t => {
  const f = await fixture(t);
  const model = commandBoundary(f);
  const { appPayloadSha256: _approvedDigest, ...withoutDigest } = f.input;
  await fs.rmdir(f.temporaryRoot);
  await assert.rejects(f.checkMacosReleaseZip(withoutDigest, model.options), { code: 'INVALID_ARGUMENTS' });
  for (const appPayloadSha256 of [null, '', 'A'.repeat(64), 'a'.repeat(63), 123]) {
    await assert.rejects(f.checkMacosReleaseZip({ ...withoutDigest, appPayloadSha256 }, model.options),
      { code: 'INVALID_ARGUMENTS' });
  }
  await assert.rejects(fs.lstat(f.temporaryRoot), { code: 'ENOENT' });
  assert.deepEqual(model.calls, []);
});

test('missing or different approved application payload evidence stops before extraction and signature assessment', async t => {
  const f = await fixture(t);
  for (const [label, appPayloadSha256] of [['missing', undefined], ['mismatched', 'b'.repeat(64)]]) {
    await t.test(label, async () => {
      const model = commandBoundary(f, {
        verify: ({ receipt }) => JSON.stringify({ ...receipt, appPayloadSha256 }),
      });
      await assert.rejects(checkFixture(f, model), { code: 'ARCHIVE_RECEIPT_MISMATCH' });
      assert.deepEqual(model.calls, ['verify ZIP']);
    });
  }
});

test('extraction failures and unexpected siblings are refused without app assessment', async t => {
  const f = await fixture(t);
  for (const extract of [
    async () => { throw new Error('synthetic ditto failure'); },
    async ({ destination }) => fs.writeFile(path.join(destination, 'extra.txt'), 'extraneous'),
    async ({ app }) => { await fs.rmdir(app); await fs.writeFile(app, 'regular file'); },
  ]) {
    const model = commandBoundary(f, { extract });
    await assert.rejects(checkFixture(f, model));
    assert.deepEqual(model.calls, ['verify ZIP', 'extract approved ZIP']);
  }
});

test('expanded payload disagreement blocks the receipt before or after Apple assessment', async t => {
  const f = await fixture(t);
  const before = ['verify ZIP', 'extract approved ZIP', 'verify expanded payload before'];
  const after = [...before, 'assess expanded application', 'verify expanded payload after'];
  for (const [phase, reported, code] of [
    ['before', { appPayloadSha256: 'b'.repeat(64) }, 'APP_PAYLOAD_RECEIPT_MISMATCH'],
    ['before', { appFiles: 9 }, 'APP_PAYLOAD_RECEIPT_MISMATCH'],
    ['after', null, 'APP_PAYLOAD_INVALID'],
  ]) {
    const model = commandBoundary(f, { verifyExpanded: ({ phase: current, receipt }) => {
      if (current !== phase) return JSON.stringify(receipt);
      if (!reported) throw new Error('The on-disk payload changed');
      return JSON.stringify({ ...receipt, ...reported });
    } });
    await assert.rejects(checkFixture(f, model), { code });
    assert.deepEqual(model.calls, phase === 'before' ? before : after);
  }
});

test('same-length change to the private copy breaks the receipt before native assessment', async t => {
  const f = await fixture(t);
  const afterVerify = commandBoundary(f, { async verify({ receipt, privateZip }) {
    await replaceCopyContents(privateZip, f.bytes);
    return JSON.stringify(receipt);
  } });
  await assert.rejects(checkFixture(f, afterVerify));
  assert.deepEqual(afterVerify.calls, ['verify ZIP']);

  const afterExtraction = commandBoundary(f, { extract: ({ privateZip }) => replaceCopyContents(privateZip, f.bytes) });
  await assert.rejects(checkFixture(f, afterExtraction));
  assert.deepEqual(afterExtraction.calls, ['verify ZIP', 'extract approved ZIP']);

  const afterNative = commandBoundary(f, { native: (input, receipt, privateZip) => replaceCopyContents(privateZip, f.bytes) });
  await assert.rejects(checkFixture(f, afterNative));
  assert.deepEqual(afterNative.calls, ['verify ZIP', 'extract approved ZIP', 'verify expanded payload before', 'assess expanded application']);
});

test('refused app signature preserves native error and removes the temporary extraction', async t => {
  const f = await fixture(t);
  const model = commandBoundary(f, { native() { throw nativeCodesignError; } });
  await assert.rejects(checkFixture(f, model), { code: 'CODE_SIGNATURE_INVALID' });
  assert.deepEqual(model.calls, ['verify ZIP', 'extract approved ZIP', 'verify expanded payload before', 'assess expanded application']);
});

test('native evidence must identify the exact expansion and show that no app was launched', async t => {
  const f = await fixture(t);
  for (const change of [{ app: path.join(f.directory, 'another approved app.app') }, { appLaunched: true }]) {
    const model = commandBoundary(f, { native: (input, receipt) => ({ ...receipt, ...change }) });
    await assert.rejects(checkFixture(f, model), { code: 'APP_RECEIPT_MISMATCH' });
    assert.deepEqual(model.calls, ['verify ZIP', 'extract approved ZIP', 'verify expanded payload before', 'assess expanded application']);
  }
});

test('cleanup refuses a replacement directory and leaves its contents alone', async t => {
  const f = await fixture(t);
  const original = path.join(f.directory, 'moved workspace');
  let marker;
  const model = commandBoundary(f, { async native({ app }) {
    const workspace = path.dirname(path.dirname(app));
    await fs.rename(workspace, original);
    await fs.mkdir(workspace);
    marker = path.join(workspace, 'replacement-owner.txt');
    await fs.writeFile(marker, 'retain this unrelated file');
  } });
  await assert.rejects(f.checkMacosReleaseZip(f.input, model.options), { code: 'WORKSPACE_CHANGED' });
  assert.deepEqual(model.calls, ['verify ZIP', 'extract approved ZIP', 'verify expanded payload before', 'assess expanded application']);
  assert.equal(await fs.readFile(marker, 'utf8'), 'retain this unrelated file');
  assert.ok((await fs.stat(original)).isDirectory());
  assert.deepEqual(await fs.readFile(f.input.archive), f.bytes);
});

test('non-Mac host cannot produce a native receipt or start any commands', async t => {
  const f = await fixture(t);
  const model = commandBoundary(f);
  await assert.rejects(checkFixture(f, { ...model, options: { ...model.options, platform: 'linux' } }),
    { code: 'MACOS_REQUIRED' });
  assert.deepEqual(model.calls, []);
  if (process.platform !== 'darwin') {
    for (const payloadArgs of [[], ['--app-payload-sha256', 'a'.repeat(64)]]) {
      const cli = spawnSync(process.execPath, [wrapper, '--archive', f.input.archive, '--sha256', f.input.sha256,
        '--python', f.input.python, '--team-id', f.input.teamId, '--bundle-id', f.input.bundleId,
        '--version', f.input.version, '--installed-version', f.input.installedVersion,
        '--arch', f.input.arch, ...payloadArgs], { encoding: 'utf8', timeout: 15_000 });
      assert.equal(cli.error, undefined);
      assert.equal(cli.status, 1);
      assert.equal(cli.stdout, '');
      assert.equal(JSON.parse(cli.stderr).code, 'MACOS_REQUIRED');
    }
  }
});
