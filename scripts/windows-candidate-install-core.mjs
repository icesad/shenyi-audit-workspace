import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCandidateVersion, readWindowsCandidateManifest } from './verify-windows-candidate-inventory.mjs';
import { verifyWindowsCandidate } from './windows-candidate-signature.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateKind = 'shenyi-windows-portable-installation';
const stateName = 'state.json';
const lockName = '.install.lock';
const directoryName = 'releases';
const signatureName = 'signature.ed25519';
const stateLimit = 16 * 1024;
const stateKeys = ['schemaVersion', 'kind', 'highestVersion', 'publicKeySha256', 'active', 'previous'];
const releaseKeys = ['releaseId', 'version', 'manifestSha256', 'signatureSha256'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const samePath = (left, right) => path.relative(left, right) === '';
const sameInode = (left, right) => left.dev === right.dev && left.ino === right.ino;
const sameFile = (left, right) => sameInode(left, right) && left.size === right.size && left.nlink === right.nlink &&
  left.mode === right.mode && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
const canonical = value => Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
const messages = {
  INSTALL_ROOT_INVALID: '安装演练目录无效。请选择仓库和源文件之外的本机目录。',
  INSTALL_STATE_INVALID: '安装演练状态或已记录的候选无法核验。',
  INSTALL_BUSY: '安装演练目录正在使用，或有未处理的锁。',
  ROLLBACK_UNAVAILABLE: '当前没有可回退的上一版记录。',
  INSTALL_PUBLISH_FAILED: '本次安装演练未完成，未切换活动版本。',
  INSTALL_KEY_MISMATCH: '所提供的公钥与此安装演练目录绑定的发布者不一致。',
  CANDIDATE_INVENTORY_INVALID: '候选文件在复制时与已核验清单不一致。',
};

function fail(code) { throw Object.assign(new Error(messages[code]), { code }); }

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

function localPath(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || !path.isAbsolute(value) || /^[\\/]{2}|[\x00-\x1f\x7f]/.test(value)) fail('INSTALL_ROOT_INVALID');
  const volume = path.parse(value).root;
  if (process.platform === 'win32' && !/^[A-Za-z]:[\\/]$/.test(volume)) fail('INSTALL_ROOT_INVALID');
  const parts = value.slice(volume.length).split(/[\\/]/);
  if (parts.some(part => part === '.' || part === '..' || (process.platform === 'win32' &&
      /[:*?"<>|]|[. ]$|^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part)))) fail('INSTALL_ROOT_INVALID');
  const resolved = path.resolve(value);
  if (samePath(resolved, volume)) fail('INSTALL_ROOT_INVALID');
  return resolved;
}

async function directoryStat(directory, code) {
  const entry = await fs.lstat(directory, { bigint: true });
  if (!entry.isDirectory() || entry.isSymbolicLink() || !samePath(directory, await fs.realpath(directory))) fail(code);
  return entry;
}

async function directoryChain(directory, code) {
  let current = path.parse(directory).root;
  for (const segment of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    await directoryStat(current, code);
  }
}

async function fileStat(filename, code) {
  const entry = await fs.lstat(filename, { bigint: true });
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1n || !samePath(filename, await fs.realpath(filename))) fail(code);
  return entry;
}

async function readStateBytes(filename) {
  const code = 'INSTALL_STATE_INVALID';
  const listed = await fileStat(filename, code);
  if (listed.size < 1n || listed.size > BigInt(stateLimit)) fail(code);
  const file = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    if (!sameFile(listed, await file.stat({ bigint: true }))) fail(code);
    const bytes = Buffer.alloc(Number(listed.size));
    for (let offset = 0; offset < bytes.length;) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) fail(code);
      offset += bytesRead;
    }
    if (!sameFile(listed, await file.stat({ bigint: true })) || !sameFile(listed, await fileStat(filename, code))) fail(code);
    return { bytes, stat: listed };
  } finally { await file.close(); }
}

async function unlinkOwned(filename, identity) {
  try {
    await directoryChain(path.dirname(filename), 'INSTALL_ROOT_INVALID');
    const current = await fileStat(filename, 'INSTALL_ROOT_INVALID');
    if (sameInode(identity, current)) await fs.unlink(filename);
  } catch { /* A changed or inaccessible path is left to the operator. */ }
}

async function prepareRoot(input, excluded, create) {
  try {
    const root = localPath(input);
    const repository = await fs.realpath(checkout);
    if (inside(repository, root) || inside(root, repository) || excluded.some(name => inside(root, name) || inside(name, root))) fail('INSTALL_ROOT_INVALID');
    await directoryChain(path.dirname(root), 'INSTALL_ROOT_INVALID');
    if (create) {
      try { await fs.mkdir(root, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    return { root, rootIdentity: await directoryStat(root, 'INSTALL_ROOT_INVALID') };
  } catch { fail('INSTALL_ROOT_INVALID'); }
}

async function checkLock(context) {
  await directoryChain(context.root, 'INSTALL_ROOT_INVALID');
  if (!sameInode(context.rootIdentity, await directoryStat(context.root, 'INSTALL_ROOT_INVALID')) ||
      !sameInode(context.lockIdentity, await fileStat(context.lockPath, 'INSTALL_BUSY'))) fail('INSTALL_BUSY');
}

async function locked(input, exclusions, create, action) {
  const context = await prepareRoot(input, exclusions, create);
  const lockPath = path.join(context.root, lockName);
  let lock;
  try { lock = await fs.open(lockPath, 'wx', 0o600); }
  catch (error) { fail(error.code === 'EEXIST' ? 'INSTALL_BUSY' : 'INSTALL_ROOT_INVALID'); }
  let lockIdentity;
  try {
    lockIdentity = await lock.stat({ bigint: true });
    Object.assign(context, { lockPath, lockIdentity });
    await checkLock(context);
    return await action(context);
  } catch (error) {
    if (Object.hasOwn(messages, error?.code) || error?.code === 'VERIFICATION_KEY_INVALID' || /^CANDIDATE_[A-Z_]+$/.test(error?.code ?? '')) throw error;
    fail('INSTALL_PUBLISH_FAILED');
  } finally {
    await lock.close().catch(() => {});
    if (lockIdentity) await unlinkOwned(lockPath, lockIdentity);
  }
}

function exact(object, keys) {
  return !!object && Object.getPrototypeOf(object) === Object.prototype &&
    JSON.stringify(Object.keys(object)) === JSON.stringify(keys);
}

function compareVersions(left, right) {
  const first = parseCandidateVersion(left);
  const second = parseCandidateVersion(right);
  const different = first.findIndex((component, index) => component !== second[index]);
  return different < 0 ? 0 : first[different] > second[different] ? 1 : -1;
}

function validRelease(release) {
  return exact(release, releaseKeys) && typeof release.releaseId === 'string' && release.releaseId.length === 36 && uuid.test(release.releaseId) &&
    hash(release.manifestSha256) && hash(release.signatureSha256) && compareVersions(release.version, '0.0.0') > 0;
}

function parseState(bytes) {
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!exact(value, stateKeys) || !canonical(value).equals(bytes) || value.schemaVersion !== 1 || value.kind !== stateKind || !hash(value.publicKeySha256)) fail('INSTALL_STATE_INVALID');
  parseCandidateVersion(value.highestVersion);
  if (value.active === null) {
    if (value.highestVersion !== '0.0.0' || value.previous !== null) fail('INSTALL_STATE_INVALID');
  } else {
    if (!validRelease(value.active) || compareVersions(value.active.version, value.highestVersion) > 0) fail('INSTALL_STATE_INVALID');
    if (value.previous !== null && (!validRelease(value.previous) || value.highestVersion !== value.active.version ||
        value.previous.releaseId === value.active.releaseId || compareVersions(value.previous.version, value.active.version) >= 0)) fail('INSTALL_STATE_INVALID');
  }
  return value;
}

async function readInstallation(context, allowEmpty) {
  try {
    await checkLock(context);
    const names = await fs.readdir(context.root);
    if (!names.includes(stateName)) {
      if (allowEmpty && names.length === 1 && names[0] === lockName) return null;
      fail('INSTALL_STATE_INVALID');
    }
    if (names.some(name => ![stateName, directoryName, lockName].includes(name))) fail('INSTALL_STATE_INVALID');
    const observed = await readStateBytes(path.join(context.root, stateName));
    const state = parseState(observed.bytes);
    if (names.includes(directoryName)) await directoryStat(path.join(context.root, directoryName), 'INSTALL_STATE_INVALID');
    else if (state.active) fail('INSTALL_STATE_INVALID');
    return { ...observed, state };
  } catch (error) {
    if (['INSTALL_BUSY', 'INSTALL_ROOT_INVALID'].includes(error.code)) throw error;
    fail('INSTALL_STATE_INVALID');
  }
}

async function checkExpectedState(context, expected) {
  const current = await readStateBytes(path.join(context.root, stateName));
  if (!current.bytes.equals(expected.bytes) || !sameFile(current.stat, expected.stat)) fail('INSTALL_STATE_INVALID');
}

async function publishState(context, previous, state) {
  const filename = path.join(context.root, stateName);
  const temporary = path.join(context.root, '.state.pending-' + randomUUID());
  const expected = canonical(state);
  let pending, identity;
  try {
    pending = await fs.open(temporary, 'wx', 0o600);
    identity = await pending.stat({ bigint: true });
    await pending.writeFile(expected);
    await pending.sync();
    await pending.close();
    pending = undefined;
    await checkLock(context);
    if (previous) {
      await checkExpectedState(context, previous);
    } else {
      const names = (await fs.readdir(context.root)).sort();
      const own = [lockName, path.basename(temporary)].sort();
      if (JSON.stringify(names) !== JSON.stringify(own)) fail('INSTALL_STATE_INVALID');
    }
    const ready = await readStateBytes(temporary);
    if (!sameInode(identity, ready.stat) || !ready.bytes.equals(expected)) fail('INSTALL_PUBLISH_FAILED');
    await fs.rename(temporary, filename);
  } catch (error) {
    await pending?.close().catch(() => {});
    if (identity) await unlinkOwned(temporary, identity);
    if (['INSTALL_STATE_INVALID', 'INSTALL_ROOT_INVALID', 'INSTALL_BUSY'].includes(error.code)) throw error;
    fail('INSTALL_PUBLISH_FAILED');
  }
}

function verifyBundle(bundle, signature, publicKey, version) {
  return verifyWindowsCandidate({ '--bundle': bundle, '--signature': signature, '--public-key': publicKey, '--installed-version': version });
}

function releaseLocation(root, id) {
  const directory = path.join(root, directoryName, id);
  const bundle = path.join(directory, 'bundle');
  return { directory, bundle, signature: path.join(directory, signatureName), executable: path.join(bundle, 'Shenyi.exe') };
}

function requireEvidence(result, state, release) {
  if (result.publicKeySha256 !== state.publicKeySha256) fail('INSTALL_KEY_MISMATCH');
  if (result.version !== release.version || result.manifestSha256 !== release.manifestSha256 || result.signatureSha256 !== release.signatureSha256) fail('INSTALL_STATE_INVALID');
}

async function verifyRetained(context, state, release, publicKey) {
  const location = releaseLocation(context.root, release.releaseId);
  try {
    await directoryChain(location.directory, 'INSTALL_STATE_INVALID');
    const names = (await fs.readdir(location.directory)).sort();
    if (names.length !== 2 || names[0] !== 'bundle' || names[1] !== signatureName) fail('INSTALL_STATE_INVALID');
  } catch { fail('INSTALL_STATE_INVALID'); }
  requireEvidence(await verifyBundle(location.bundle, location.signature, publicKey, '0.0.0'), state, release);
  return location;
}

async function createStagedParents(stage, directory) {
  const code = 'INSTALL_PUBLISH_FAILED';
  await directoryChain(stage, code);
  if (!inside(stage, directory)) fail(code);
  let current = stage;
  for (const segment of path.relative(stage, directory).split(path.sep).filter(Boolean)) {
    await directoryStat(current, code);
    current = path.join(current, segment);
    try { await fs.mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  await directoryChain(directory, code);
}

async function copyPinned(input, output, size, digest, stage) {
  const code = 'CANDIDATE_INVENTORY_INVALID';
  let source, destination;
  try {
    await directoryChain(path.dirname(input), code);
    const entry = await fileStat(input, code);
    if (entry.size !== BigInt(size)) fail(code);
    source = await fs.open(input, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (!sameFile(entry, await source.stat({ bigint: true }))) fail(code);
    await createStagedParents(stage, path.dirname(output));
    destination = await fs.open(output, 'wx', 0o600);
    const buffer = Buffer.alloc(128 * 1024);
    const sha256 = createHash('sha256');
    for (let offset = 0; offset < size;) {
      const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (!bytesRead) fail(code);
      sha256.update(buffer.subarray(0, bytesRead));
      for (let written = 0; written < bytesRead;) {
        const { bytesWritten } = await destination.write(buffer, written, bytesRead - written, null);
        if (!bytesWritten) fail('INSTALL_PUBLISH_FAILED');
        written += bytesWritten;
      }
      offset += bytesRead;
    }
    if (sha256.digest('hex') !== digest || !sameFile(entry, await source.stat({ bigint: true })) ||
        !sameFile(entry, await fileStat(input, code))) fail(code);
    await destination.sync();
  } finally {
    try { await destination?.close(); } finally { await source?.close(); }
  }
}

async function stageRelease(context, state, candidate, verified, signature, publicKey) {
  await checkLock(context);
  const releases = path.join(context.root, directoryName);
  try { await fs.mkdir(releases, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await directoryStat(releases, 'INSTALL_STATE_INVALID');
  const release = { releaseId: randomUUID(), version: verified.version, manifestSha256: verified.manifestSha256, signatureSha256: verified.signatureSha256 };
  const location = releaseLocation(context.root, release.releaseId);
  await fs.mkdir(location.directory, { mode: 0o700 });
  await fs.mkdir(location.bundle, { mode: 0o700 });
  for (const [name, facts] of Object.entries(candidate.manifest.files)) {
    await copyPinned(path.join(candidate.directory, name), path.join(location.bundle, name), facts.bytes, facts.sha256, location.bundle);
  }
  await copyPinned(path.join(candidate.directory, 'candidate-manifest.json'), path.join(location.bundle, 'candidate-manifest.json'), candidate.bytes.length, verified.manifestSha256, location.bundle);
  await copyPinned(signature, location.signature, 64, verified.signatureSha256, location.directory);
  requireEvidence(await verifyBundle(location.bundle, location.signature, publicKey, state.highestVersion), state, release);
  return { release, location };
}

function result(state, location) {
  return Object.freeze({ version: state.active.version, highestVersion: state.highestVersion,
    previousVersion: state.previous?.version ?? null, executablePath: location.executable, manifestSha256: state.active.manifestSha256,
    publicKeySha256: state.publicKeySha256, osSignatureVerified: false });
}

export async function applyWindowsCandidate({ root, bundle, signature, publicKey }) {
  const source = localPath(bundle);
  const signed = localPath(signature);
  const key = localPath(publicKey);
  return locked(root, [source, signed, key], true, async context => {
    let previous = await readInstallation(context, true);
    // Verify the supplied source before claiming an otherwise empty root.
    const verified = await verifyBundle(source, signed, key, previous?.state.highestVersion ?? '0.0.0');
    const candidate = await readWindowsCandidateManifest(source);
    if (candidate.manifestSha256 !== verified.manifestSha256 || candidate.manifest.version !== verified.version) fail('CANDIDATE_INVENTORY_INVALID');
    if (!previous) {
      const prepared = { schemaVersion: 1, kind: stateKind, highestVersion: '0.0.0', publicKeySha256: verified.publicKeySha256, active: null, previous: null };
      await publishState(context, null, prepared);
      previous = await readInstallation(context, false);
    }
    const state = previous.state;
    if (state.publicKeySha256 !== verified.publicKeySha256) fail('INSTALL_KEY_MISMATCH');
    if (state.active) await verifyRetained(context, state, state.active, key);
    const { release, location } = await stageRelease(context, state, candidate, verified, signed, key);
    const next = { ...state, highestVersion: release.version, active: release, previous: state.active };
    await publishState(context, previous, next);
    return result(next, location);
  });
}

export async function inspectWindowsInstallation({ root, publicKey }) {
  const key = localPath(publicKey);
  return locked(root, [key], false, async context => {
    const previous = await readInstallation(context, false);
    const { state } = previous;
    if (!state.active) fail('INSTALL_STATE_INVALID');
    const location = await verifyRetained(context, state, state.active, key);
    await checkLock(context);
    await checkExpectedState(context, previous);
    return result(state, location);
  });
}

export async function rollbackWindowsInstallation({ root, publicKey }) {
  const key = localPath(publicKey);
  return locked(root, [key], false, async context => {
    const previous = await readInstallation(context, false);
    const { state } = previous;
    if (!state.previous) fail('ROLLBACK_UNAVAILABLE');
    const location = await verifyRetained(context, state, state.previous, key);
    const next = { ...state, active: state.previous, previous: null };
    await publishState(context, previous, next);
    return result(next, location);
  });
}
