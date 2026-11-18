'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, generateKeyPairSync, verify } = require('node:crypto');

const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(version = '0.61.0') {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-candidate-sig-'));
  const bundle = path.join(directory, 'candidate');
  const files = {
    'Shenyi.exe': 'synthetic executable bytes',
    'Shenyi_wer.dll': 'synthetic helper bytes',
    'resources/app/desktop/main.cjs': 'module.exports = {};\n',
    'resources/app/desktop/preload.cjs': 'module.exports = {};\n',
    'resources/app/node_modules/jsdom/package.json': json({ name: 'jsdom', version: '30.1.3' }),
    'resources/app/package-lock.json': json({ fixture: true }),
    'resources/app/package.json': json({ name: 'shenyi-team-desktop', productName: '审易', version, private: true, main: 'desktop/main.cjs', dependencies: { jsdom: '30.1.3' } }),
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
    version, trustedServiceProfileIncluded: false,
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
  return { directory, bundle, manifestPath, manifest, publicKey, publicPath, privatePath, signOptions, verifyOptions, signature: common['--signature'] };
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

function sourceOf(candidate, options) {
  return { ...options, bundle: candidate.bundle, signature: candidate.signature };
}

test('installation switches verified versions and explicit rollback preserves the highest accepted version', async () => {
  const base = await fixture();
  const next = await fixture('0.61.1');
  const { signWindowsCandidate } = await import('../scripts/windows-candidate-signature.mjs');
  const { applyWindowsCandidate, inspectWindowsInstallation, rollbackWindowsInstallation } = await import('../scripts/windows-candidate-install-core.mjs');
  await signWindowsCandidate(base.signOptions);
  await signWindowsCandidate({ ...next.signOptions, '--private-key': base.privatePath });
  const root = path.join(base.directory, 'installed');
  const options = { root, publicKey: base.publicPath };
  const initial = await applyWindowsCandidate(sourceOf(base, options));
  assert.equal(initial.version, '0.61.0');
  assert.equal(initial.highestVersion, '0.61.0');
  assert.equal(initial.previousVersion, null);
  assert.ok(initial.executablePath.startsWith(root + path.sep));
  const sourceExe = path.join(base.bundle, 'Shenyi.exe');
  assert.deepEqual(await fs.readFile(initial.executablePath), await fs.readFile(sourceExe));
  assert.equal((await fs.stat(initial.executablePath)).nlink, 1);
  assert.notEqual((await fs.stat(initial.executablePath, { bigint: true })).ino, (await fs.stat(sourceExe, { bigint: true })).ino);

  const upgraded = await applyWindowsCandidate(sourceOf(next, options));
  assert.equal(upgraded.version, '0.61.1');
  assert.equal(upgraded.previousVersion, initial.version);
  assert.equal(upgraded.highestVersion, upgraded.version);
  assert.notEqual(upgraded.executablePath, initial.executablePath);
  assert.equal((await inspectWindowsInstallation(options)).executablePath, upgraded.executablePath);
  const restored = await rollbackWindowsInstallation(options);
  assert.equal(restored.executablePath, initial.executablePath);
  assert.equal(restored.version, initial.version);
  assert.equal(restored.highestVersion, upgraded.version);
  assert.equal(restored.previousVersion, null);
  await assert.rejects(applyWindowsCandidate(sourceOf(next, options)), { code: 'CANDIDATE_VERSION_NOT_NEWER' });
  await assert.rejects(rollbackWindowsInstallation(options), { code: 'ROLLBACK_UNAVAILABLE' });
  assert.equal((await inspectWindowsInstallation(options)).highestVersion, '0.61.1');
});

test('installed state stays active when an upgrade or its retained rollback target cannot be verified', async () => {
  const old = await fixture();
  const current = await fixture('0.61.1');
  const bad = await fixture('0.61.2');
  const foreign = await fixture('0.61.3');
  const { signWindowsCandidate } = await import('../scripts/windows-candidate-signature.mjs');
  const { applyWindowsCandidate, inspectWindowsInstallation, rollbackWindowsInstallation } = await import('../scripts/windows-candidate-install-core.mjs');
  for (const item of [old, current, bad]) await signWindowsCandidate({ ...item.signOptions, '--private-key': old.privatePath });
  await signWindowsCandidate(foreign.signOptions);
  const options = { root: path.join(old.directory, 'installed'), publicKey: old.publicPath };
  const fallback = await applyWindowsCandidate(sourceOf(old, options));
  const live = await applyWindowsCandidate(sourceOf(current, options));
  await assert.rejects(applyWindowsCandidate(sourceOf(foreign, { ...options, publicKey: foreign.publicPath })), { code: 'INSTALL_KEY_MISMATCH' });
  await fs.appendFile(path.join(bad.bundle, 'Shenyi.exe'), 'changed source');
  await assert.rejects(applyWindowsCandidate(sourceOf(bad, options)), { code: 'CANDIDATE_INVENTORY_INVALID' });
  await fs.appendFile(fallback.executablePath, 'changed installed fallback');
  await assert.rejects(rollbackWindowsInstallation(options));
  const after = await inspectWindowsInstallation(options);
  assert.equal(after.executablePath, live.executablePath);
  assert.equal(after.version, live.version);
  assert.equal(after.highestVersion, live.version);
  assert.equal(after.previousVersion, fallback.version);
});

test('simultaneous first installs yield one active copy and cannot initialize an unrelated directory', async () => {
  const item = await fixture();
  const { signWindowsCandidate } = await import('../scripts/windows-candidate-signature.mjs');
  const { applyWindowsCandidate, inspectWindowsInstallation } = await import('../scripts/windows-candidate-install-core.mjs');
  await signWindowsCandidate(item.signOptions);
  const unrelated = path.join(item.directory, 'unrelated');
  await fs.mkdir(unrelated);
  const sentinel = path.join(unrelated, 'other.txt');
  await fs.writeFile(sentinel, 'preserved', { flag: 'wx' });
  const options = { root: path.join(item.directory, 'install-race'), publicKey: item.publicPath };
  await assert.rejects(applyWindowsCandidate(sourceOf(item, { ...options, root: unrelated })), { code: 'INSTALL_STATE_INVALID' });
  assert.deepEqual(await fs.readdir(unrelated), ['other.txt']);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'preserved');
  const results = await Promise.allSettled([applyWindowsCandidate(sourceOf(item, options)), applyWindowsCandidate(sourceOf(item, options))]);
  const passed = results.filter(item => item.status === 'fulfilled');
  const rejected = results.filter(item => item.status === 'rejected');
  assert.equal(passed.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(['INSTALL_BUSY', 'CANDIDATE_VERSION_NOT_NEWER'].includes(rejected[0].reason.code));
  assert.equal((await inspectWindowsInstallation(options)).executablePath, passed[0].value.executablePath);
});

async function installedFixture() {
  const item = await fixture();
  const { signWindowsCandidate } = await import('../scripts/windows-candidate-signature.mjs');
  const { applyWindowsCandidate } = await import('../scripts/windows-candidate-install-core.mjs');
  await signWindowsCandidate(item.signOptions);
  const options = { root: path.join(item.directory,'installed-launch'),publicKey:item.publicPath };
  const installed = await applyWindowsCandidate(sourceOf(item,options));
  return { ...item,options,installed };
}

test('a release manifest cannot initialize an Ed25519-only installation', async () => {
  const candidate = await fixture();
  candidate.manifest.schemaVersion = 2;
  candidate.manifest.releaseStatus = 'authenticode-signed-portable-candidate';
  candidate.manifest.authenticode = { publisherCertificateSha256: 'a'.repeat(64), unsignedExecutableSha256: 'b'.repeat(64) };
  await fs.writeFile(candidate.manifestPath, json(candidate.manifest));
  const { signWindowsCandidate } = await import('../scripts/windows-candidate-signature.mjs');
  const { applyWindowsCandidate } = await import('../scripts/windows-candidate-install-core.mjs');
  await signWindowsCandidate(candidate.signOptions);
  const root = path.join(candidate.directory, 'unclaimed-installation');
  await assert.rejects(applyWindowsCandidate(sourceOf(candidate, { root, publicKey: candidate.publicPath })), {
    code: 'INSTALL_PUBLISHER_REQUIRED',
  });
  assert.deepEqual(await fs.readdir(root), []);
});

test('installation operations reject omitted or mismatched publisher policy before reading a candidate', async () => {
  const f = await installedFixture();
  const { applyWindowsCandidate, inspectWindowsInstallation, resolveWindowsLaunch, rollbackWindowsInstallation } =
    await import('../scripts/windows-candidate-install-core.mjs');
  const publisherCertificateSha256 = 'a'.repeat(64);
  const pinned = { ...f.options, publisherSha256: publisherCertificateSha256 };
  const state = path.join(f.options.root, 'state.json');
  const legacyState = await fs.readFile(state);
  await assert.rejects(resolveWindowsLaunch(pinned), { code: 'INSTALL_PUBLISHER_MISMATCH' });
  assert.deepEqual(await fs.readFile(state), legacyState);

  // The signed bundle is irrelevant for missing or wrong policy. Change only the isolated test state.
  const strictState = json({ ...JSON.parse(legacyState), schemaVersion: 2, publisherCertificateSha256 });
  await fs.writeFile(state, strictState);
  const apply = options => applyWindowsCandidate(sourceOf(f, options));
  for (const operation of [apply, inspectWindowsInstallation, resolveWindowsLaunch, rollbackWindowsInstallation]) {
    await assert.rejects(operation(f.options), { code: 'INSTALL_PUBLISHER_REQUIRED' });
    await assert.rejects(operation({ ...f.options, publisherSha256: 'b'.repeat(64) }), { code: 'INSTALL_PUBLISHER_MISMATCH' });
    await assert.rejects(operation({ ...f.options, publisherSha256: 'invalid' }), { code: 'INSTALL_PUBLISHER_INVALID' });
  }
  assert.equal(await fs.readFile(state, 'utf8'), strictState);
  assert.deepEqual((await fs.readdir(f.options.root)).sort(), ['releases', 'state.json']);
});

async function installationFacts(root) {
  const records = [];
  async function visit(filename) {
    const entry = await fs.lstat(filename,{bigint:true});
    records.push({path:path.relative(root,filename),kind:entry.isDirectory()?'directory':'file',
      dev:entry.dev.toString(),ino:entry.ino.toString(),mode:entry.mode.toString(),nlink:entry.nlink.toString(),
      size:entry.size.toString(),mtimeNs:entry.mtimeNs.toString(),ctimeNs:entry.ctimeNs.toString(),
      sha256:entry.isFile()?sha(await fs.readFile(filename)):null});
    if (entry.isDirectory()) for (const name of (await fs.readdir(filename)).sort()) await visit(path.join(filename,name));
  }
  await visit(root);
  return records;
}

test('resolve-launch returns the verified inspect receipt without creating locks or changing installed files', async () => {
  const f = await installedFixture();
  const { inspectWindowsInstallation,resolveWindowsLaunch } = await import('../scripts/windows-candidate-install-core.mjs');
  const { runWindowsCandidateInstall } = await import('../scripts/manage-windows-candidate-install.mjs');
  const { syncBuiltinESMExports } = require('node:module');
  const { constants } = require('node:fs');
  const expected = await inspectWindowsInstallation(f.options);
  const before = await installationFacts(f.options.root),opened=[];
  const originalOpen = fs.open;
  fs.open = async function(filename,flags,...rest) {
    opened.push({filename:String(filename),flags});
    return originalOpen.call(this,filename,flags,...rest);
  };
  syncBuiltinESMExports();
  let resolved,command;
  try {
    resolved = await resolveWindowsLaunch(f.options);
    command = await runWindowsCandidateInstall(['resolve-launch','--root',f.options.root,'--public-key',f.publicPath]);
  } finally { fs.open=originalOpen;syncBuiltinESMExports(); }
  assert.deepEqual(resolved,expected);
  assert.deepEqual(command,{ok:true,...expected,operation:'resolve-launch'});
  assert.ok(opened.some(entry=>entry.filename===f.installed.executablePath),'real installed executable must be opened');
  for (const {filename,flags} of opened) {
    assert.notEqual(path.basename(filename),'.install.lock');
    if (typeof flags==='number') assert.equal(flags&(constants.O_WRONLY|constants.O_RDWR|constants.O_CREAT|constants.O_TRUNC|constants.O_APPEND),0,filename);
    else assert.ok(['r','rs','sr'].includes(flags),String(flags));
  }
  assert.deepEqual(await installationFacts(f.options.root),before);
  const { spawnSync } = require('node:child_process');
  const cli = spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/manage-windows-candidate-install.mjs'),
    'resolve-launch','--root',f.options.root,'--public-key',f.publicPath],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(cli.error,undefined);
  assert.equal(cli.status,0,cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout),command);
  assert.deepEqual(await installationFacts(f.options.root),before);
});

test('resolve-launch refuses an existing installation lock and leaves its bytes and installation untouched', async () => {
  const f = await installedFixture();
  const { resolveWindowsLaunch } = await import('../scripts/windows-candidate-install-core.mjs');
  const lock = path.join(f.options.root,'.install.lock'),bytes=Buffer.from('synthetic concurrent install owner');
  await fs.writeFile(lock,bytes,{flag:'wx'});
  const before = await installationFacts(f.options.root);
  await assert.rejects(resolveWindowsLaunch(f.options),{code:'INSTALL_BUSY'});
  assert.deepEqual(await fs.readFile(lock),bytes);
  assert.deepEqual(await installationFacts(f.options.root),before);
});

test('resolve-launch rejects corrupted retained signature, manifest and payload without repairing them', async () => {
  const f = await installedFixture();
  const { resolveWindowsLaunch } = await import('../scripts/windows-candidate-install-core.mjs');
  const bundle = path.dirname(f.installed.executablePath);
  const signature = path.join(path.dirname(bundle),'signature.ed25519');
  const manifest = path.join(bundle,'candidate-manifest.json');
  for (const [filename,code,change] of [
    [signature,'CANDIDATE_SIGNATURE_INVALID',bytes=>{const changed=Buffer.from(bytes);changed[0]^=1;return changed;}],
    [manifest,'CANDIDATE_MANIFEST_INVALID',bytes=>Buffer.concat([bytes,Buffer.from(' ')])],
    [f.installed.executablePath,'CANDIDATE_INVENTORY_INVALID',bytes=>{const changed=Buffer.from(bytes);changed[0]^=1;return changed;}],
  ]) {
    const original = await fs.readFile(filename),altered=change(original);
    await fs.writeFile(filename,altered);
    const before = await installationFacts(f.options.root);
    try {
      await assert.rejects(resolveWindowsLaunch(f.options),{code});
      assert.deepEqual(await installationFacts(f.options.root),before);
      assert.deepEqual(await fs.readFile(filename),altered);
    } finally { await fs.writeFile(filename,original); }
  }
  assert.deepEqual(await resolveWindowsLaunch(f.options),f.installed);
});

test('resolve-launch detects a real lock or canonical state replacement while native payload verification is in progress', async () => {
  const f = await installedFixture();
  const { resolveWindowsLaunch } = await import('../scripts/windows-candidate-install-core.mjs');
  const { syncBuiltinESMExports } = require('node:module');
  const stateFile = path.join(f.options.root,'state.json'),originalState=await fs.readFile(stateFile);
  const lockFile = path.join(f.options.root,'.install.lock'),lockBytes=Buffer.from('synthetic lock created during actual payload verification');
  for (const mode of ['busy-lock','canonical-state-replaced','invalid-state']) {
    const originalOpen = fs.open;
    const oldStat = await fs.stat(stateFile,{bigint:true});
    let injected=0;
    fs.open = async function(filename,...arguments_) {
      const handle = await originalOpen.call(this,filename,...arguments_);
      if (String(filename)===f.installed.executablePath && injected===0) {
        injected++;
        try {
          if (mode==='busy-lock') await fs.writeFile(lockFile,lockBytes,{flag:'wx'});
          else if (mode==='canonical-state-replaced') {
            const replacement = path.join(f.options.root,'synthetic-state-replacement.pending');
            await fs.writeFile(replacement,originalState,{flag:'wx'});
            await fs.rename(replacement,stateFile);
          } else await fs.writeFile(stateFile,'{}\n');
        } catch (error) { await handle.close();throw error; }
      }
      return handle;
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(resolveWindowsLaunch(f.options),{code:mode==='invalid-state'?'INSTALL_STATE_INVALID':'INSTALL_BUSY'},mode);
    } finally { fs.open=originalOpen;syncBuiltinESMExports(); }
    assert.equal(injected,1,mode+' must occur at the real executable open');
    if (mode==='busy-lock') {
      assert.deepEqual(await fs.readFile(lockFile),lockBytes);
      await fs.unlink(lockFile);
      assert.deepEqual(await fs.readFile(stateFile),originalState);
    } else if (mode==='canonical-state-replaced') {
      assert.deepEqual(await fs.readFile(stateFile),originalState,'valid canonical state was replaced with exactly the same bytes');
      assert.notEqual((await fs.stat(stateFile,{bigint:true})).ino,oldStat.ino,'replacement must be a different real file');
    } else {
      assert.equal(await fs.readFile(stateFile,'utf8'),'{}\n');
      await fs.writeFile(stateFile,originalState);
    }
    assert.deepEqual(await resolveWindowsLaunch(f.options),f.installed);
  }
});

async function withLaunchSpawn(spawn,action) {
  const childProcess = require('node:child_process');
  const {syncBuiltinESMExports} = require('node:module');
  const previous = childProcess.spawn;
  childProcess.spawn=spawn;
  syncBuiltinESMExports();
  try { return await action(); }
  finally { childProcess.spawn=previous;syncBuiltinESMExports(); }
}

async function withLaunchEnvironment(values,action) {
  const previous = Object.fromEntries(Object.keys(values).map(name=>[name,{present:Object.hasOwn(process.env,name),value:process.env[name]}]));
  for (const [name,value] of Object.entries(values)) {
    if (value===undefined) delete process.env[name];
    else process.env[name]=value;
  }
  try { return await action(); }
  finally {
    for (const [name,old] of Object.entries(previous)) {
      if (old.present) process.env[name]=old.value;
      else delete process.env[name];
    }
  }
}

const launchArguments = (f,serviceConfig) => ['launch','--root',f.options.root,'--public-key',f.publicPath,'--service-config',serviceConfig];
const windowsLaunchTest = {skip:process.platform!=='win32'};

test('verified launch spawns only the installed executable with exact safe options and a pid receipt',windowsLaunchTest,async () => {
  const f = await installedFixture();
  const {runWindowsCandidateInstall} = await import('../scripts/manage-windows-candidate-install.mjs');
  const {EventEmitter} = require('node:events');
  const profile = {schemaVersion:1,apiBase:'https://team.synthetic.invalid',serverId:require('node:crypto').randomUUID()};
  const serviceConfig = path.join(f.directory,'trusted-service.json'),caFile=path.join(f.directory,'synthetic-ca.pem');
  await fs.writeFile(serviceConfig,json(profile),{flag:'wx'});
  await fs.writeFile(caFile,'synthetic CA path policy fixture; no TLS or real process',{flag:'wx'});
  const before=await installationFacts(f.options.root),calls=[];
  let unrefs=0;
  const fakeSpawn = (executable,args,options) => {
    calls.push({executable,args,options});
    const child=new EventEmitter();child.pid=42001;child.unref=()=>{unrefs++;};
    queueMicrotask(()=>child.emit('spawn'));
    return child;
  };
  const injection={NODE_TLS_REJECT_UNAUTHORIZED:'1',NODE_OPTIONS:'--require synthetic-injected-code',NODE_PATH:'synthetic-module-path',
    NODE_EXTRA_CA_CERTS:caFile,ELECTRON_RUN_AS_NODE:'1',ELECTRON_ENABLE_LOGGING:'1',OPENSSL_CONF:'synthetic-ssl-config',
    SSL_CERT_FILE:'synthetic-cert-file',SSL_CERT_DIR:'synthetic-cert-directory',HTTP_PROXY:'http://proxy.synthetic.invalid',
    HTTPS_PROXY:'http://proxy.synthetic.invalid',ALL_PROXY:'socks://proxy.synthetic.invalid',NO_PROXY:'*',GLOBAL_AGENT_HTTP_PROXY:'http://proxy.synthetic.invalid',
    SHENYI_TEAM_SERVICE_CONFIG:'synthetic-inherited-config',SHENYI_TEAM_API:'https://foreign.synthetic.invalid',
    SHENYI_ISOLATED_PREVIEW_CONFIG:'synthetic-preview',SHENYI_DESKTOP_DATA_DIR:'synthetic-private-data',
    SHENYI_WECHAT_APP_ID:'wx-synthetic-public-app',SHENYI_WECHAT_REDIRECT_URI:'https://team.synthetic.invalid/api/auth/wechat/callback'};
  await withLaunchEnvironment(injection,()=>withLaunchSpawn(fakeSpawn,async()=>{
    const result=await runWindowsCandidateInstall(launchArguments(f,serviceConfig));
    assert.deepEqual(result,{ok:true,...f.installed,pid:42001,operation:'launch'});
    assert.equal(calls.length,1);
    const {executable,args,options}=calls[0];
    assert.equal(executable,f.installed.executablePath);
    assert.deepEqual(args,[]);
    assert.deepEqual(options,{cwd:path.dirname(executable),env:options.env,detached:true,stdio:'ignore',shell:false});
    assert.equal(options.env.SHENYI_TEAM_SERVICE_CONFIG,await fs.realpath(serviceConfig));
    assert.equal(options.env.SHENYI_WECHAT_APP_ID,injection.SHENYI_WECHAT_APP_ID);
    assert.equal(options.env.SHENYI_WECHAT_REDIRECT_URI,injection.SHENYI_WECHAT_REDIRECT_URI);
    for (const name of Object.keys(injection).filter(name=>!['SHENYI_TEAM_SERVICE_CONFIG','SHENYI_WECHAT_APP_ID','SHENYI_WECHAT_REDIRECT_URI'].includes(name))) {
      assert.equal(Object.hasOwn(options.env,name),false,name+' must not enter a public HTTPS child');
    }
    if (process.env.LOCALAPPDATA!==undefined) assert.equal(options.env.LOCALAPPDATA,process.env.LOCALAPPDATA);
    assert.equal(unrefs,1);

    await fs.writeFile(serviceConfig,json({...profile,apiBase:'https://127.0.0.1:9443'}));
    await runWindowsCandidateInstall(launchArguments(f,serviceConfig));
    assert.equal(calls[1].options.env.NODE_EXTRA_CA_CERTS,caFile,'explicit IPv4 loopback may use a local absolute synthetic CA');
    await withLaunchEnvironment({NODE_EXTRA_CA_CERTS:'relative-ca.pem'},async()=>{
      await runWindowsCandidateInstall(launchArguments(f,serviceConfig));
      assert.equal(Object.hasOwn(calls[2].options.env,'NODE_EXTRA_CA_CERTS'),false);
    });
    assert.equal(unrefs,3);
  }));
  assert.deepEqual(await installationFacts(f.options.root),before);
});

test('verified launch never spawns for invalid service configuration, retained signature or a busy installation',windowsLaunchTest,async () => {
  const f = await installedFixture();
  const {runWindowsCandidateInstall} = await import('../scripts/manage-windows-candidate-install.mjs');
  const profile={schemaVersion:1,apiBase:'https://team.synthetic.invalid',serverId:require('node:crypto').randomUUID()};
  const serviceConfig=path.join(f.directory,'trusted-service.json');
  await fs.writeFile(serviceConfig,json(profile),{flag:'wx'});
  let spawns=0;
  await withLaunchEnvironment({NODE_TLS_REJECT_UNAUTHORIZED:'1'},()=>withLaunchSpawn(()=>{spawns++;throw Error('unexpected synthetic spawn');},async()=>{
    await assert.rejects(runWindowsCandidateInstall(['launch','--root',f.options.root,'--public-key',f.publicPath]),{code:'INVALID_ARGUMENTS'});
    for (const filename of ['relative-service.json',path.join(f.directory,'missing-service.json')]) {
      await assert.rejects(runWindowsCandidateInstall(launchArguments(f,filename)),{code:'TEAM_SERVICE_CONFIGURATION_INVALID'});
    }
    for (const invalid of [{...profile,apiBase:'http://127.0.0.1:9443'},{...profile,apiBase:'https://user:secret@team.synthetic.invalid'},
      {...profile,serverId:'not-an-instance-uuid'},{...profile,allowInsecure:true}]) {
      await fs.writeFile(serviceConfig,json(invalid));
      await assert.rejects(runWindowsCandidateInstall(launchArguments(f,serviceConfig)),{code:'TEAM_SERVICE_CONFIGURATION_INVALID'});
    }
    await fs.writeFile(serviceConfig,json(profile));
    const insideConfig=path.join(f.options.root,'untrusted-service.json');
    await fs.writeFile(insideConfig,json(profile),{flag:'wx'});
    try {
      await assert.rejects(runWindowsCandidateInstall(launchArguments(f,insideConfig)),{code:'TEAM_SERVICE_CONFIGURATION_INVALID'});
      assert.equal(await fs.readFile(insideConfig,'utf8'),json(profile));
    } finally { await fs.unlink(insideConfig); }
    await withLaunchEnvironment({NODE_TLS_REJECT_UNAUTHORIZED:'0'},async()=>{
      await assert.rejects(runWindowsCandidateInstall(launchArguments(f,serviceConfig)),{code:'TEAM_SERVICE_CONFIGURATION_INVALID'});
    });
    const lock=path.join(f.options.root,'.install.lock'),lockBytes=Buffer.from('synthetic installer busy before verified launch');
    await fs.writeFile(lock,lockBytes,{flag:'wx'});
    try {
      const before=await installationFacts(f.options.root);
      await assert.rejects(runWindowsCandidateInstall(launchArguments(f,serviceConfig)),{code:'INSTALL_BUSY'});
      assert.deepEqual(await installationFacts(f.options.root),before);
      assert.deepEqual(await fs.readFile(lock),lockBytes);
    } finally { await fs.unlink(lock); }
    const signature=path.join(path.dirname(path.dirname(f.installed.executablePath)),'signature.ed25519');
    const original=await fs.readFile(signature),altered=Buffer.from(original);altered[0]^=1;
    await fs.writeFile(signature,altered);
    const before=await installationFacts(f.options.root);
    await assert.rejects(runWindowsCandidateInstall(launchArguments(f,serviceConfig)),{code:'CANDIDATE_SIGNATURE_INVALID'});
    assert.deepEqual(await installationFacts(f.options.root),before);
    assert.equal(spawns,0,'all failures must precede process creation');
  }));
});

test('verified launch maps synchronous and asynchronous child errors to a failed launch without a success pid',windowsLaunchTest,async () => {
  const f = await installedFixture();
  const {runWindowsCandidateInstall} = await import('../scripts/manage-windows-candidate-install.mjs');
  const {EventEmitter} = require('node:events');
  const serviceConfig=path.join(f.directory,'trusted-service.json');
  await fs.writeFile(serviceConfig,json({schemaVersion:1,apiBase:'https://team.synthetic.invalid',serverId:require('node:crypto').randomUUID()}),{flag:'wx'});
  const before=await installationFacts(f.options.root),canary='synthetic private child failure detail';
  for (const mode of ['synchronous','error-event']) {
    let spawns=0,unrefs=0;
    await withLaunchEnvironment({NODE_TLS_REJECT_UNAUTHORIZED:'1'},()=>withLaunchSpawn(()=>{
      spawns++;
      if(mode==='synchronous')throw Error(canary);
      const child=new EventEmitter();child.unref=()=>{unrefs++;};
      queueMicrotask(()=>child.emit('error',Error(canary)));
      return child;
    },async()=>{
      await assert.rejects(runWindowsCandidateInstall(launchArguments(f,serviceConfig)),error=>{
        assert.equal(error.code,'WINDOWS_LAUNCH_FAILED');
        assert.equal(error.message.includes(canary),false);
        assert.equal(Object.hasOwn(error,'pid'),false);
        return true;
      });
    }));
    assert.equal(spawns,1);
    assert.equal(unrefs,0,'a child that failed before spawn must not be detached as success');
    assert.deepEqual(await installationFacts(f.options.root),before);
  }
});

test('verified launch refuses non-Windows before reading configuration or creating a process',async () => {
  const {runWindowsCandidateInstall} = await import('../scripts/manage-windows-candidate-install.mjs');
  const originalPlatform=Object.getOwnPropertyDescriptor(process,'platform');
  let spawns=0;
  try {
    Object.defineProperty(process,'platform',{...originalPlatform,value:'linux'});
    await withLaunchSpawn(()=>{spawns++;throw Error('must not spawn');},async()=>{
      await assert.rejects(runWindowsCandidateInstall(['launch','--root','intentionally-invalid-root','--public-key','intentionally-invalid-key',
        '--service-config','intentionally-invalid-config']),{code:'WINDOWS_LAUNCH_UNAVAILABLE'});
    });
    assert.equal(spawns,0);
  } finally { Object.defineProperty(process,'platform',originalPlatform); }
});
