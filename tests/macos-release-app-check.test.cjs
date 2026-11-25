'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const teamId = 'A1B2C3D4E5';
const bundleId = 'cn.example.shenyi';
const version = '0.61.0';
const cdHash = '1'.repeat(40);
const codesign = '/usr/bin/codesign';
const spctl = '/usr/sbin/spctl';
const readyMetadata = [
  'Identifier=' + bundleId,
  'CodeDirectory v=20500 size=100 flags=0x10000(runtime)',
  'CDHash=' + cdHash,
  'Timestamp=Nov 19, 2026 at 12:00:00',
  'TeamIdentifier=' + teamId,
].join('\n');

async function fixture(t, arch = 'arm64') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shenyi-mac-app-check-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'Shenyi release.app');
  const main = path.join(app, 'Contents', 'MacOS', 'Shenyi');
  const resource = path.join(app, 'Contents', 'nested.txt');
  await fs.mkdir(path.dirname(main), { recursive: true });
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
  bytes.writeUInt32LE(2, 12);
  await fs.writeFile(main, bytes, { mode: 0o755 });
  await fs.writeFile(path.join(app, 'Contents', 'Info.plist'), 'synthetic metadata');
  await fs.writeFile(resource, 'ordinary resource');
  return { input: { app, teamId, bundleId, version, arch }, main, resource };
}

function model({ osVersion = '14.7.1', policy = 'assessments enabled', display = readyMetadata,
  values = {}, reject, during, verdict } = {}) {
  const calls = [];
  return { calls, async run(program, args) {
    calls.push({ program, args });
    if (reject?.(program, args)) throw Error('synthetic system rejection');
    if (during) await during(program, args);
    const metadata = {
      CFBundleIdentifier: bundleId, CFBundleShortVersionString: version, CFBundleVersion: version,
      CFBundleExecutable: 'Shenyi', ...values,
    };
    if (program === '/usr/bin/plutil') return { stdout: metadata[args[1]] + '\n' };
    if (program === '/usr/bin/sw_vers') return { stdout: osVersion + '\n' };
    if (program === spctl && args[0] === '--status') return { stderr: policy + '\n' };
    if (program === '/usr/bin/syspolicy_check') {
      return { stdout: verdict ?? 'App passed all pre-distribution checks and is ready for distribution.' };
    }
    if (program === spctl && args[0] === '--assess') {
      return { stderr: verdict ?? args.at(-1) + ': accepted\nsource=Notarized Developer ID' };
    }
    if (program === codesign && args[0] === '--display') {
      const count = calls.filter(call => call.program === program && call.args[0] === '--display').length;
      return { stderr: typeof display === 'function' ? display(count) : display };
    }
    return { stdout: '' };
  } };
}

async function check(input, runner) {
  const { checkMacosReleaseApp } = await import('../scripts/check-macos-release-app.mjs');
  return checkMacosReleaseApp(input, { platform: 'darwin', run: runner.run });
}

test('macOS 14 uses fixed system tools and verifies distinct nested and publisher requirements', async t => {
  const { input } = await fixture(t);
  const runner = model();
  const result = await check(input, runner);
  assert.equal(result.teamId, input.teamId);
  assert.equal(result.bundleId, input.bundleId);
  assert.equal(result.version, input.version);
  assert.equal(result.mainExecutableArch, 'arm64');
  assert.equal(result.osVersion, '14.7.1');
  assert.equal(result.assessment, 'syspolicy_check');
  assert.equal(result.cdHash, cdHash);
  assert.match(result.appTreeSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.archiveVerified, false);
  assert.equal(result.appLaunched, false);
  assert.equal(runner.calls.filter(call => call.program === codesign && call.args.includes('--deep')).length, 2);
  const match = runner.calls.find(call => call.program === codesign && call.args.includes('-R'));
  assert.ok(match);
  assert.equal(match.args.includes('--deep'), false);
  for (const value of ['anchor apple generic', '100.6.2.6', '100.6.1.13', 'subject.OU', teamId, bundleId]) {
    assert.ok(match.args.some(arg => arg.includes(value)), value);
  }
  assert.ok(runner.calls.some(call => call.program === '/usr/bin/syspolicy_check' && call.args[0] === 'distribution'));
  const ticket = runner.calls.find(call => call.program === '/usr/bin/xcrun');
  assert.deepEqual(ticket.args, ['stapler', 'validate', result.app]);
  assert.deepEqual(runner.calls.filter(call => call.program === spctl).map(call => call.args), [['--status']]);
});

test('macOS 13 independently verifies the thin Intel app via execute assessment', async t => {
  const { input } = await fixture(t, 'x64');
  const runner = model({ osVersion: '13.7.2' });
  const result = await check(input, runner);
  assert.equal(result.assessment, 'spctl');
  assert.equal(result.mainExecutableArch, 'x64');
  assert.deepEqual(runner.calls.filter(call => call.program === spctl).map(call => call.args), [
    ['--status'], ['--assess', '--type', 'execute', '--verbose=2', result.app],
  ]);
  assert.ok(!runner.calls.some(call => call.program.endsWith('/syspolicy_check')));
});

for (const [label, option] of Object.entries({
  'untrusted Team ID syntax': { teamId: 'A1B2C3D4";' },
  'untrusted Bundle ID syntax': { bundleId: 'cn.example."tamper' },
  'placeholder candidate identity': { bundleId: 'invalid.shenyi.audit.candidate' },
  'pre-release version': { version: '0.61.0-rc.1' },
  'relative app directory': { app: 'Shenyi.app' },
  'unsupported architecture': { arch: 'universal' },
})) {
  test(label + ' is rejected before invoking system tools', async t => {
    const { input } = await fixture(t);
    const runner = model();
    await assert.rejects(check({ ...input, ...option }, runner), { code: 'INVALID_ARGUMENTS' });
    assert.deepEqual(runner.calls, []);
  });
}

test('arm64 expectation rejects an Intel main executable before any signature claim', async t => {
  const { input } = await fixture(t, 'x64');
  const runner = model();
  await assert.rejects(check({ ...input, arch: 'arm64' }, runner), { code: 'APP_ARCH_MISMATCH' });
  assert.equal(runner.calls.some(call => call.program === codesign), false);
});

for (const [label, settings, code] of [
  ['unexpected signed product metadata', { values: { CFBundleIdentifier: 'cn.example.other' } }, 'APP_METADATA_MISMATCH'],
  ['unexpected release version', { values: { CFBundleShortVersionString: '0.60.0' } }, 'APP_METADATA_MISMATCH'],
  ['unexpected bundle build version', { values: { CFBundleVersion: '0.60.0' } }, 'APP_METADATA_MISMATCH'],
  ['invalid nested signature', { reject: (p, a) => p === codesign && a.includes('--deep') }, 'CODE_SIGNATURE_INVALID'],
  ['wrong Developer ID signer', { reject: (p, a) => p === codesign && a.includes('-R') }, 'DEVELOPER_ID_MISMATCH'],
  ['missing Hardened Runtime flag', { display: readyMetadata.replace('0x10000(runtime)', '0x0(none)') }, 'SIGNING_METADATA_INVALID'],
  ['non-timestamp signing time', { display: readyMetadata.replace('Timestamp=', 'Signed Time=') }, 'SIGNING_METADATA_INVALID'],
  ['ambiguous signer metadata', { display: readyMetadata + '\nTeamIdentifier=A9A9A9A9A9' }, 'SIGNING_METADATA_INVALID'],
  ['unsupported host', { osVersion: '12.7.0' }, 'MACOS_VERSION_UNKNOWN'],
  ['Gatekeeper disabled', { policy: 'assessments disabled' }, 'GATEKEEPER_NOT_ENABLED'],
  ['policy rejected on macOS 14+', { reject: p => p === '/usr/bin/syspolicy_check' }, 'DISTRIBUTION_POLICY_REJECTED'],
  ['policy rejected on macOS 13', { osVersion: '13.7.0', reject: (p, a) => p === spctl && a.includes('--assess') }, 'DISTRIBUTION_POLICY_REJECTED'],
  ['inconclusive exit-zero distribution output', { verdict: '' }, 'DISTRIBUTION_POLICY_UNKNOWN'],
  ['inconclusive exit-zero execute assessment', { osVersion: '13.7.0', verdict: 'rejected' }, 'DISTRIBUTION_POLICY_UNKNOWN'],
  ['missing or invalid stapled ticket', { reject: p => p === '/usr/bin/xcrun' }, 'STAPLED_TICKET_INVALID'],
  ['changed CodeDirectory digest', { display: count => count === 1 ? readyMetadata : readyMetadata.replace(cdHash, '2'.repeat(40)) }, 'APP_CHANGED_DURING_CHECK'],
]) {
  test(label + ' cannot produce a pass receipt', async t => {
    const { input } = await fixture(t);
    await assert.rejects(check(input, model(settings)), { code });
  });
}

test('a nested resource changed during assessment is rejected even if signature output is repeated', async t => {
  const { input, resource } = await fixture(t);
  const runner = model({
    during: async p => {
      if (p === '/usr/bin/syspolicy_check') await fs.writeFile(resource, 'changed during check');
    },
  });
  await assert.rejects(check(input, runner), { code: 'APP_CHANGED_DURING_CHECK' });
});

test('the filesystem check rejects an absolute link before native commands access the app', async t => {
  const { input } = await fixture(t);
  const outside = path.join(path.dirname(input.app), 'other-directory');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(input.app, 'Contents', 'External'), process.platform === 'win32' ? 'junction' : 'dir');
  const runner = model();
  await assert.rejects(check(input, runner), { code: 'APP_LINK_INVALID' });
  assert.deepEqual(runner.calls, []);
});

test('bundle link resolution accepts an internal Electron framework link chain', async () => {
  const { checkLinks } = await import('../scripts/check-macos-release-app.mjs');
  const nodes = new Map([
    ['Framework', 'directory'], ['Framework/Versions', 'directory'], ['Framework/Versions/A', 'directory'],
    ['Framework/Versions/Current', 'link'], ['Framework/Versions/A/Binary', 'file'], ['Framework/Binary', 'link'],
  ]);
  checkLinks(nodes, new Map([
    ['Framework/Binary', 'Versions/Current/Binary'], ['Framework/Versions/Current', './A'],
  ]));
});

for (const [description, target] of [['escaping', '../inside'], ['dangling', 'missing'], ['cyclic', 'other/../other']]) {
  test('bundle link resolution rejects ' + description + ' targets', async () => {
    const { checkLinks } = await import('../scripts/check-macos-release-app.mjs');
    const nodes = new Map([['inside', 'file'], ['link', 'link'], ['other', 'link']]);
    const links = new Map([['link', target], ['other', 'link']]);
    assert.throws(() => checkLinks(nodes, links), { code: 'APP_LINK_INVALID' });
  });
}

test('the real command rejects non-Mac hosts without consulting app or tools', { skip: process.platform === 'darwin' }, () => {
  const script = path.join(__dirname, '..', 'scripts', 'check-macos-release-app.mjs');
  assert.throws(() => execFileSync(process.execPath, [script], { encoding: 'utf8', stdio: 'pipe' }), error => {
    assert.equal(error.status, 1);
    assert.equal(error.stdout, '');
    assert.equal(JSON.parse(error.stderr).code, 'MACOS_REQUIRED');
    return true;
  });
});
