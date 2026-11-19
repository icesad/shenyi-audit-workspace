'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const run = promisify(execFile);
const cli = path.resolve(__dirname, '../scripts/build-macos-desktop-archive.py');
const python = process.platform === 'win32' ? 'python' : 'python3';
const version = '0.61.0';
const bundleId = 'cn.example.shenyi';
const candidateId = 'invalid.shenyi.audit.candidate';

const archiveFixture = String.raw`
import json, plistlib, stat, struct, sys, zipfile

output, architecture, raw_options = sys.argv[1:]
options = json.loads(raw_options)
cpu_types = {'arm64': 0x100000c, 'x64': 0x1000007}
bundle_id = options.get('bundleId', 'cn.example.shenyi')
app = 'Shenyi.app/Contents/'
resources = app + 'Resources/app/'
framework = app + 'Frameworks/Electron Framework.framework/Versions/'
version = '0.61.0'

def mach(arch, kind):
    return struct.pack('<8I', 0xfeedfacf, cpu_types[arch], 0, kind, 0, 0, 0, 0)

def plist(name, identifier, main=False):
    value = {'CFBundleName': name, 'CFBundleExecutable': name, 'CFBundleIdentifier': identifier}
    if main:
        value.update(CFBundlePackageType='APPL', CFBundleShortVersionString=version, CFBundleVersion=version)
    return plistlib.dumps(value)

with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
    def put(name, value, mode=stat.S_IFREG | 0o644):
        entry = zipfile.ZipInfo(name)
        entry.create_system, entry.external_attr = 3, mode << 16
        archive.writestr(entry, value, compress_type=zipfile.ZIP_DEFLATED)

    if options.get('candidateNotices'):
        for notice in ('LICENSE', 'LICENSES.chromium.html', 'version'):
            put(notice, b'Synthetic candidate fixture')
    put(app + 'Info.plist', plist('Shenyi', bundle_id, True))
    put(app + 'MacOS/Shenyi', mach(architecture, 2), stat.S_IFREG | 0o755)
    for suffix, name in (('helper', 'Shenyi Helper'), ('helper.renderer', 'Shenyi Helper (Renderer)')):
        helper = app + 'Frameworks/' + name + '.app/Contents/'
        helper_id = options.get('helperId', bundle_id + '.' + suffix)
        put(helper + 'Info.plist', plist(name, helper_id))
        put(helper + 'MacOS/' + name, mach(architecture, 2), stat.S_IFREG | 0o755)
    framework_arch = options.get('frameworkArch', architecture)
    put(framework + 'A/Electron Framework', mach(framework_arch, 6), stat.S_IFREG | 0o755)
    for library in ('libffmpeg.dylib', 'libvk_swiftshader.dylib'):
        put(framework + 'A/Libraries/' + library, mach(architecture, 6), stat.S_IFREG | 0o755)
    put(framework + 'Current', b'A', stat.S_IFLNK | 0o777)
    put(resources + 'package.json', json.dumps({'name': 'shenyi-team-desktop', 'version': version,
        'private': True, 'main': 'desktop/main.cjs'}))
    required = ('package-lock.json', 'desktop/main.cjs', 'desktop/preload.cjs',
        'desktop/team-ui/index.html', 'node_modules/jsdom/package.json')
    for name in required:
        if name != options.get('missing'):
            put(resources + name, b'{}')
    put(app + 'Resources/LICENSE.Electron.txt', b'Fixture only')
    put(app + 'Resources/LICENSES.chromium.html', b'Fixture only')

    if sidecar := options.get('sidecar'):
        sidecar_target = 'Missing.plist' if sidecar == 'unmatched' else 'Info.plist'
        attributes = bytes(32)
        apple_double = (struct.pack('>II16sH', 0x00051607, 0x00020000, b'Mac OS X        ', 1)
            + struct.pack('>III', 9, 38, len(attributes)) + attributes)
        if sidecar == 'malformed':
            apple_double = b'not AppleDouble'
        put('__MACOSX/' + app + '._' + sidecar_target, apple_double)
    if options.get('unexpectedRoot'):
        put('OTHER.txt', b'Unexpected file')
`;

async function fixture(t, arch, options = {}) {
  const temp = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temp, 'shenyi-macos-release-'));
  t.after(async () => {
    const resolved = await fs.realpath(root);
    assert.equal(resolved, root);
    assert.equal(path.dirname(resolved), temp);
    await fs.rm(resolved, { recursive: true });
  });
  const archive = path.join(root, `Shenyi-macos-${arch}.zip`);
  await run(python, ['-I', '-c', archiveFixture, archive, arch, JSON.stringify(options)], { windowsHide: true });
  const bytes = await fs.readFile(archive);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { archive, bytes, sha256, arch };
}

function invoke(fixture, overrides = {}) {
  const expected = { arch: fixture.arch, version, bundleId, sha256: fixture.sha256, ...overrides };
  const args = ['-I', cli, '--verify-release', fixture.archive, expected.arch, expected.version,
    '--bundle-id', expected.bundleId, '--sha256', expected.sha256];
  return run(python, args, { windowsHide: true, timeout: 15_000 });
}

function refused(error) {
  assert.equal(error.code, 1, error.stderr);
  assert.equal(error.stdout.trim(), '');
  assert.match(error.stderr, /failed/i);
  return true;
}

test('formal Mac ZIP receipt checks both fixed application architectures without extracting', async t => {
  for (const [arch, options] of [['arm64', {}], ['x64', { sidecar: 'matched' }]]) {
    await t.test(arch, async t => {
      const f = await fixture(t, arch, options);
      const receipt = JSON.parse((await invoke(f)).stdout);
      assert.equal(receipt.format, 'shenyi-macos-release-zip');
      assert.equal(receipt.bundleIdentifier, bundleId);
      assert.equal(receipt.arch, arch);
      assert.equal(receipt.version, version);
      assert.equal(receipt.archiveSha256, f.sha256);
      assert.equal(receipt.archiveBytes, f.bytes.length);
      assert.equal(receipt.symlinks, 1);
      assert.equal(receipt.appFiles, 6);
      assert.equal(receipt.archiveEntries, options.sidecar ? 19 : 18);
      assert.notEqual(receipt.osSignatureVerified, true);
      assert.deepEqual(await fs.readFile(f.archive), f.bytes);
      assert.deepEqual(await fs.readdir(path.dirname(f.archive)), [path.basename(f.archive)]);
    });
  }
});

test('formal Mac ZIP receipt checks the supplied SHA-256 before ZIP parsing', async t => {
  const f = await fixture(t, 'arm64');
  await assert.rejects(invoke(f, { sha256: 'f'.repeat(64) }), refused);

  const sameSizeInvalidZip = Buffer.alloc(f.bytes.length);
  await fs.writeFile(f.archive, sameSizeInvalidZip);
  await assert.rejects(invoke(f), error => {
    refused(error);
    assert.match(error.stderr, /sha-?256|digest|hash/i);
    return true;
  });
});

test('formal Mac ZIP receipt refuses mismatched expected release facts', async t => {
  const f = await fixture(t, 'x64');
  for (const [name, overrides] of [
    ['architecture', { arch: 'arm64' }],
    ['version', { version: '0.61.1' }],
    ['bundle identity', { bundleId: 'cn.example.other' }],
    ['candidate identity as expected production identity', { bundleId: candidateId }]
  ]) {
    await t.test(name, async () => assert.rejects(invoke(f, overrides), refused));
  }
});

test('malformed formal archive entries cannot produce an intake receipt', async t => {
  for (const [name, options] of [
    ['opposite-architecture framework', { frameworkArch: 'arm64' }],
    ['mismatched helper identity', { helperId: 'cn.example.other.helper' }],
    ['missing application entry point support', { missing: 'desktop/preload.cjs' }],
    ['unmatched AppleDouble counterpart', { sidecar: 'unmatched' }],
    ['malformed AppleDouble metadata', { sidecar: 'malformed' }],
    ['unexpected regular ZIP root entry', { unexpectedRoot: true }]
  ]) {
    await t.test(name, async t => {
      const f = await fixture(t, 'x64', options);
      await assert.rejects(invoke(f), refused);
    });
  }
});

test('legacy built candidate verification and formal archive acceptance stay distinct', async t => {
  const candidate = await fixture(t, 'arm64', { bundleId: candidateId, candidateNotices: true });
  const { stdout } = await run(python, ['-I', cli, '--verify', candidate.archive, 'arm64', version], { windowsHide: true });
  assert.equal(JSON.parse(stdout).bundleIdentifier, candidateId);
  await assert.rejects(invoke(candidate), refused);

  const formal = await fixture(t, 'arm64');
  await assert.rejects(run(python, ['-I', cli, '--verify', formal.archive, 'arm64', version], { windowsHide: true }), refused);
});
