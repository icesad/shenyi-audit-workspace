'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, generateKeyPairSync, verify } = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const run = promisify(execFile);
const cli = path.resolve(__dirname, '../scripts/macos-candidate-signature.mjs');
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = value => createHash('sha256').update(value).digest('hex');
const version = '0.61.0';

const fixtureArchive = String.raw`
import json, plistlib, stat, struct, sys, zipfile
output, architecture, framework_arch = sys.argv[1:]
cpu = {'arm64': 0x100000c, 'x64': 0x1000007}
mach = lambda arch, kind: struct.pack('<8I', 0xfeedfacf, cpu[arch], 0, kind, 0, 0, 0, 0)
bundle = 'invalid.shenyi.audit.candidate'
app = 'Shenyi.app/Contents/'
resources = app + 'Resources/app/'
framework = app + 'Frameworks/Electron Framework.framework/'
version = '0.61.0'
with zipfile.ZipFile(output, 'x') as archive:
    def put(name, value, mode=stat.S_IFREG | 0o644):
        entry = zipfile.ZipInfo(name)
        entry.create_system, entry.external_attr = 3, mode << 16
        archive.writestr(entry, value)
    def plist(name, identifier, main=False):
        value = {'CFBundleName': name, 'CFBundleExecutable': name, 'CFBundleIdentifier': identifier}
        if main:
            value.update(CFBundlePackageType='APPL', CFBundleShortVersionString=version, CFBundleVersion=version)
        return plistlib.dumps(value)
    for notice in ['LICENSE', 'LICENSES.chromium.html', 'version']:
        put(notice, b'Synthetic fixture')
    put(app + 'Info.plist', plist('Shenyi', bundle, True))
    put(app + 'MacOS/Shenyi', mach(architecture, 2), stat.S_IFREG | 0o755)
    for suffix, name in [('helper', 'Shenyi Helper'), ('helper.renderer', 'Shenyi Helper (Renderer)')]:
        helper = app + 'Frameworks/' + name + '.app/Contents/'
        put(helper + 'Info.plist', plist(name, bundle + '.' + suffix))
        put(helper + 'MacOS/' + name, mach(architecture, 2), stat.S_IFREG | 0o755)
    put(framework + 'Versions/A/Electron Framework', mach(framework_arch, 6), stat.S_IFREG | 0o755)
    for library in ['libffmpeg.dylib', 'libvk_swiftshader.dylib']:
        put(framework + 'Versions/A/Libraries/' + library, mach(architecture, 6), stat.S_IFREG | 0o755)
    put(framework + 'Versions/Current', b'A', stat.S_IFLNK | 0o777)
    put(resources + 'package.json', json.dumps({'name': 'shenyi-team-desktop', 'version': version, 'private': True, 'main': 'desktop/main.cjs'}))
    for name in ['package-lock.json', 'desktop/main.cjs', 'desktop/preload.cjs', 'desktop/team-ui/index.html', 'node_modules/jsdom/package.json']:
        put(resources + name, b'{}')
    print(len(archive.infolist()))
`;

async function fixture(architecture, frameworkArchitecture = architecture) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-macos-signature-'));
  const bundle = path.join(root, 'candidate');
  const filename = `Shenyi-macos-${architecture}.zip`;
  const archive = path.join(bundle, filename);
  const manifest = path.join(bundle, 'candidate-manifest.json');
  await fs.mkdir(bundle);
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const { stdout } = await run(python, ['-I', '-c', fixtureArchive, archive, architecture, frameworkArchitecture], { windowsHide: true });
  const bytes = await fs.readFile(archive);
  const metadata = { schemaVersion: 1, kind: 'shenyi-macos-desktop-candidate', platform: 'darwin', arch: architecture,
    releaseStatus: 'candidate-requires-macos-signing-and-native-validation', version, trustedServiceProfileIncluded: false,
    electron: { version: '45.3.2', archive: `electron-v45.3.2-darwin-${architecture}.zip`, bytes: 128_000_000, sha256: 'a'.repeat(64) },
    archive: { filename, bytes: bytes.length, sha256: sha(bytes) }, bundleIdentifier: 'invalid.shenyi.audit.candidate',
    archiveEntries: Number(stdout.trim()), symlinkCount: 1, applicationFileCount: 6, sourceFileCount: 3, productionPackageCount: 1 };
  await fs.writeFile(manifest, json(metadata));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const privatePath = path.join(root, 'publisher.private.pem');
  const publicPath = path.join(root, 'publisher.public.pem');
  const signature = path.join(root, 'candidate.ed25519');
  await fs.writeFile(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  await fs.writeFile(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
  const params = ['--bundle', bundle, '--arch', architecture, '--signature', signature];
  return { publicKey, signature, manifest, signParams: ['sign', ...params, '--private-key', privatePath],
    verifyParams: ['verify', ...params, '--public-key', publicPath, '--installed-version', '0.60.0'] };
}

async function invoke(args) {
  const { stdout } = await run(process.execPath, [cli, ...args], { windowsHide: true, timeout: 15_000 });
  return JSON.parse(stdout);
}

test('detached signature binds the Mac architecture, archive and supported version', async () => {
  const f = await fixture('arm64');
  const signed = await invoke(f.signParams);
  const received = await invoke(f.verifyParams);
  assert.equal(received.archiveSha256, signed.archiveSha256);
  assert.equal(received.osSignatureVerified, false);
  const manifest = await fs.readFile(f.manifest);
  const signature = await fs.readFile(f.signature);
  const data = prefix => Buffer.concat([Buffer.from(prefix + '\0', 'ascii'), manifest]);
  assert.equal(verify(null, data('shenyi.macos-candidate.manifest.v1'), f.publicKey, signature), true);
  assert.equal(verify(null, data('shenyi.windows-candidate.manifest.v1'), f.publicKey, signature), false);
  await assert.rejects(invoke(f.verifyParams.map(value => value === '0.60.0' ? version : value)),
    error => JSON.parse(error.stderr).code === 'CANDIDATE_VERSION_NOT_NEWER');
  await assert.rejects(invoke(f.verifyParams.map(value => value === 'arm64' ? 'x64' : value)),
    error => JSON.parse(error.stderr).code === 'CANDIDATE_ARCH_MISMATCH');
});

test('the signer refuses an opposite-architecture Electron framework inside a matching Mac archive', async () => {
  const f = await fixture('x64', 'arm64');
  await assert.rejects(invoke(f.signParams), error => JSON.parse(error.stderr).code === 'CANDIDATE_INVENTORY_INVALID');
  await assert.rejects(fs.lstat(f.signature), { code: 'ENOENT' });
});
