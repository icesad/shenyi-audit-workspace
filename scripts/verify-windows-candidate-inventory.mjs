import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import windowsFiles from './windows-desktop-candidate-files.json' with { type: 'json' };

const manifestName = 'candidate-manifest.json';
const appPayloadPrefix = 'resources/app/';
const appPackageName = appPayloadPrefix + 'package.json';
const manifestLimit = 2 * 1024 * 1024;
const packageLimit = 16 * 1024;
const manifestError = 'CANDIDATE_MANIFEST_INVALID';
export const signedWindowsCandidateStatus = 'authenticode-signed-portable-candidate';
const inventoryError = 'CANDIDATE_INVENTORY_INVALID';
const versionError = 'CANDIDATE_VERSION_INVALID';
const messages = {
  [manifestError]: 'Windows 候选清单无效。',
  [inventoryError]: 'Windows 候选目录与核验清单不符。',
  [versionError]: 'Windows 候选版本必须采用规范的三段稳定版本号。',
};
const runtimeNames = new Set(windowsFiles.runtimeRootFiles.map(name =>
  name === 'electron.exe' ? 'Shenyi.exe' : name === 'electron_wer.dll' ? 'Shenyi_wer.dll' : name));
const localeNames = new Set(windowsFiles.electronLocales.map(name => name + '.pak'));
const expectedAnchors = [
  'Shenyi.exe', 'Shenyi_wer.dll', appPackageName, 'resources/app/package-lock.json',
  'resources/app/desktop/main.cjs', 'resources/app/desktop/preload.cjs',
  'resources/app/node_modules/jsdom/package.json',
];
const pathCharacter = /^[A-Za-z0-9_@+\-][A-Za-z0-9._@+\-]*$/;
const dosDevice = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i;
const packageNamePattern = /^[a-z0-9][a-z0-9._-]*$/;
const samePath = (left, right) => path.relative(left, right) === '';
const positiveSafe = value => Number.isSafeInteger(value) && value > 0;
const validHash = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export class WindowsCandidateInventoryError extends Error {
  constructor(code) {
    super(messages[code]);
    this.name = 'WindowsCandidateInventoryError';
    this.code = code;
  }
}

function invalid(code) { throw new WindowsCandidateInventoryError(code); }

export function parseCandidateVersion(value) {
  const parsed = typeof value === 'string' && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(value);
  if (!parsed || parsed[0] !== value) invalid(versionError);
  const components = parsed.slice(1).map(Number);
  if (!components.every(Number.isSafeInteger)) invalid(versionError);
  return Object.freeze(components);
}

function exact(object, names, code) {
  if (!object || Object.getPrototypeOf(object) !== Object.prototype ||
      JSON.stringify(Object.keys(object)) !== JSON.stringify(names)) invalid(code);
}

function readJson(bytes, code) {
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const data = JSON.parse(raw);
  if (!Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8').equals(bytes)) invalid(code);
  return data;
}

function candidateDirectory(input, code) {
  if (typeof input !== 'string' || !input.isWellFormed() || !path.isAbsolute(input) || /^[\\/]{2}/.test(input) || /[\x00-\x1f\x7f]/.test(input)) invalid(code);
  const volume = path.parse(input).root;
  if (process.platform === 'win32' && !/^[A-Za-z]:[\\/]$/.test(volume)) invalid(code);
  const parts = input.slice(volume.length).split(/[\\/]/);
  if (parts.some(part => part === '.' || part === '..' || (process.platform === 'win32' && /[:]|[. ]$/.test(part)))) invalid(code);
  const absolute = path.resolve(input);
  if (samePath(absolute, volume)) invalid(code);
  return absolute;
}

function facts(stat) {
  return [stat.dev, stat.ino, stat.size, stat.nlink, stat.mode, stat.mtimeNs, stat.ctimeNs];
}

function sameFacts(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function entryStat(filename, type, code) {
  const entry = await lstat(filename, { bigint: true });
  if (entry.isSymbolicLink() || (type === 'directory' ? !entry.isDirectory() : !entry.isFile() || entry.nlink !== 1n) ||
      !samePath(filename, await realpath(filename))) invalid(code);
  return entry;
}

async function inspectParents(directory, code) {
  let next = path.parse(directory).root;
  const ancestors = new Map();
  for (const part of directory.slice(next.length).split(path.sep)) {
    next = path.join(next, part);
    const entry = await entryStat(next, 'directory', code);
    // Unrelated activity beside the candidate may change an ancestor's timestamps.
    ancestors.set(next, next === directory ? facts(entry) : [entry.dev, entry.ino, entry.mode]);
  }
  return ancestors;
}

function snapshotEquals(before, after, code) {
  if (before.size !== after.size || [...before].some(([name, previous]) => !after.has(name) || !sameFacts(previous, after.get(name)))) invalid(code);
}

async function readStable(filename, code, expected, consume) {
  const observed = facts(await entryStat(filename, 'file', code));
  if (expected && !sameFacts(observed, expected)) invalid(code);
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat({ bigint: true });
    if (!sameFacts(observed, facts(before))) invalid(code);
    const value = await consume(handle, before.size);
    if (!sameFacts(observed, facts(await handle.stat({ bigint: true }))) ||
        !sameFacts(observed, facts(await entryStat(filename, 'file', code)))) invalid(code);
    return value;
  } finally {
    await handle.close();
  }
}

async function consumeFile(handle, size, buffer, use, code) {
  for (let offset = 0; offset < size;) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(size - offset, buffer.length), offset);
    if (!bytesRead) invalid(code);
    use(buffer.subarray(0, bytesRead), offset);
    offset += bytesRead;
  }
  const extra = await handle.read(buffer, 0, 1, size);
  if (extra.bytesRead) invalid(code);
}

async function readMetadata(filename, limit, code, expected) {
  return readStable(filename, code, expected, async (handle, size) => {
    if (size < 1n || size > BigInt(limit)) invalid(code);
    const bytes = Buffer.alloc(Number(size));
    await consumeFile(handle, bytes.length, Buffer.alloc(bytes.length), (chunk, offset) => chunk.copy(bytes, offset), code);
    return bytes;
  });
}

function fileTree(files) {
  const entries = new Map();
  const aliases = new Map();
  for (const filename of [manifestName, ...Object.keys(files)]) {
    const parts = filename.split('/');
    for (let width = 1; width <= parts.length; width++) {
      const name = parts.slice(0, width).join('/');
      const kind = width === parts.length ? 'file' : 'directory';
      const alias = name.toLowerCase();
      if ((aliases.has(alias) && aliases.get(alias) !== name) || (entries.has(name) && entries.get(name) !== kind)) invalid(manifestError);
      aliases.set(alias, name);
      entries.set(name, kind);
    }
  }
  return entries;
}

function classify(filename, packages) {
  const parts = filename.split('/');
  if (filename.length > 240 || parts.some(part => part.length > 120 || pathCharacter.exec(part)?.[0] !== part || part.endsWith('.') || dosDevice.test(part))) invalid(manifestError);
  if (parts.length === 1 && runtimeNames.has(filename)) return 0;
  if (parts.length === 2 && parts[0] === 'locales' && localeNames.has(parts[1])) return 0;
  if (parts[0] !== 'resources' || parts[1] !== 'app') invalid(manifestError);
  if (parts.length === 3 && ['package.json', 'package-lock.json'].includes(parts[2])) return 0;
  if (parts.length >= 4 && ['desktop', 'dist', 'shared'].includes(parts[2]) && /\.(?:cjs|js|css|html|png)$/.test(filename)) return 1;
  if (parts[2] === 'node_modules') {
    const packageEnd = parts[3]?.startsWith('@') ? 5 : 4;
    const names = parts.slice(3, packageEnd);
    if (parts.length > packageEnd && names.every((name, index) => packageNamePattern.test(index === 0 && packageEnd === 5 ? name.slice(1) : name)) &&
        !parts.slice(packageEnd).includes('node_modules')) {
      packages.add(parts.slice(0, packageEnd).join('/'));
      return 0;
    }
  }
  invalid(manifestError);
}

function validateManifest(data) {
  const signed = data?.schemaVersion === 2;
  exact(data, ['schemaVersion', 'kind', 'platform', 'arch', 'releaseStatus', 'version', 'trustedServiceProfileIncluded',
    'electron', 'sourceFileCount', 'productionPackageCount', 'files', ...(signed ? ['authenticode'] : [])], manifestError);
  if ((!signed && data.schemaVersion !== 1) || data.kind !== 'shenyi-windows-desktop-candidate' || data.platform !== 'win32' || data.arch !== 'x64' ||
      data.releaseStatus !== (signed ? signedWindowsCandidateStatus : 'unsigned-portable-candidate') || data.trustedServiceProfileIncluded !== false ||
      !positiveSafe(data.sourceFileCount) || !positiveSafe(data.productionPackageCount) ||
      !data.files || Object.getPrototypeOf(data.files) !== Object.prototype) invalid(manifestError);
  if (signed) {
    exact(data.authenticode, ['publisherCertificateSha256', 'unsignedExecutableSha256'], manifestError);
    if (!validHash(data.authenticode.publisherCertificateSha256) || !validHash(data.authenticode.unsignedExecutableSha256) ||
        data.authenticode.unsignedExecutableSha256 === data.files['Shenyi.exe']?.sha256) invalid(manifestError);
    Object.freeze(data.authenticode);
  }
  parseCandidateVersion(data.version);
  exact(data.electron, ['version', 'archive', 'bytes', 'sha256'], manifestError);
  parseCandidateVersion(data.electron.version);
  if (data.electron.archive !== `electron-v${data.electron.version}-win32-x64.zip` ||
      !positiveSafe(data.electron.bytes) || !validHash(data.electron.sha256)) invalid(manifestError);
  const filenames = Object.keys(data.files);
  if (JSON.stringify(filenames) !== JSON.stringify([...filenames].sort()) ||
      !expectedAnchors.every(name => Object.hasOwn(data.files, name) && positiveSafe(data.files[name]?.bytes))) invalid(manifestError);
  let sourceFiles = 0;
  let totalBytes = 0;
  const packages = new Set();
  for (const [name, info] of Object.entries(data.files)) {
    sourceFiles += classify(name, packages);
    exact(info, ['bytes', 'sha256'], manifestError);
    if (!Number.isSafeInteger(info.bytes) || info.bytes < 0 || Object.is(info.bytes, -0) || !validHash(info.sha256)) invalid(manifestError);
    totalBytes += info.bytes;
    if (!Number.isSafeInteger(totalBytes)) invalid(manifestError);
    Object.freeze(info);
  }
  if (data.sourceFileCount !== sourceFiles || data.productionPackageCount !== packages.size ||
      [...packages].some(name => !Object.hasOwn(data.files, name + '/package.json'))) invalid(manifestError);
  fileTree(data.files);
  Object.freeze(data.electron);
  Object.freeze(data.files);
  return Object.freeze(data);
}

function applicationPayloadSha256(files) {
  const hash = createHash('sha256').update('shenyi.windows.app-payload.v1\0', 'ascii');
  // Manifest validation requires the filenames to be in ordinal order.
  for (const [name, { bytes, sha256 }] of Object.entries(files)) {
    if (name.startsWith(appPayloadPrefix)) {
      const relative = name.slice(appPayloadPrefix.length);
      hash.update(JSON.stringify([relative, bytes, sha256]) + '\n');
    }
  }
  return hash.digest('hex');
}

export async function readWindowsCandidateManifest(input) {
  try {
    const directory = candidateDirectory(input, manifestError);
    const parents = await inspectParents(directory, manifestError);
    const bytes = await readMetadata(path.join(directory, manifestName), manifestLimit, manifestError);
    const manifest = validateManifest(readJson(bytes, manifestError));
    snapshotEquals(parents, await inspectParents(directory, manifestError), manifestError);
    return Object.freeze({ directory, bytes, manifest, manifestSha256: digest(bytes),
      appPayloadSha256: applicationPayloadSha256(manifest.files) });
  } catch { invalid(manifestError); }
}

async function scanTree(directory, expected) {
  const entries = new Map();
  async function walk(parent, prefix) {
    const before = facts(await entryStat(parent, 'directory', inventoryError));
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      const name = prefix + entry.name;
      const type = expected.get(name);
      if (!type || entries.has(name) || entry.isSymbolicLink()) invalid(inventoryError);
      const target = path.join(parent, entry.name);
      if (type === 'directory' && entry.isDirectory()) await walk(target, name + '/');
      else if (type === 'file' && entry.isFile()) entries.set(name, facts(await entryStat(target, 'file', inventoryError)));
      else invalid(inventoryError);
    }
    if (!sameFacts(before, facts(await entryStat(parent, 'directory', inventoryError)))) invalid(inventoryError);
    if (prefix) entries.set(prefix.slice(0, -1), before);
  }
  await walk(directory, '');
  if (entries.size !== expected.size) invalid(inventoryError);
  return entries;
}

function validateAppPackage(bytes, manifest) {
  const data = readJson(bytes, inventoryError);
  exact(data, ['name', 'productName', 'version', 'private', 'main', 'dependencies'], inventoryError);
  exact(data.dependencies, ['jsdom'], inventoryError);
  if (data.name !== 'shenyi-team-desktop' || !['审迹','审易'].includes(data.productName) || data.version !== manifest.version ||
      data.private !== true || data.main !== 'desktop/main.cjs') invalid(inventoryError);
  parseCandidateVersion(data.dependencies.jsdom);
}

export async function verifyWindowsCandidateInventory(candidate) {
  try {
    if (!candidate || !Buffer.isBuffer(candidate.bytes) || !validHash(candidate.manifestSha256)) invalid(inventoryError);
    const current = await readWindowsCandidateManifest(candidate.directory);
    if (current.manifestSha256 !== candidate.manifestSha256 || !current.bytes.equals(candidate.bytes)) invalid(inventoryError);
    const { directory, manifest } = current;
    const parents = await inspectParents(directory, inventoryError);
    const expected = fileTree(manifest.files);
    const beginning = await scanTree(directory, expected);
    const readBuffer = Buffer.alloc(128 * 1024);
    let totalBytes = 0;
    for (const [name, info] of Object.entries(manifest.files)) {
      await readStable(path.join(directory, name), inventoryError, beginning.get(name), async (handle, size) => {
        if (size !== BigInt(info.bytes)) invalid(inventoryError);
        const hash = createHash('sha256');
        await consumeFile(handle, info.bytes, readBuffer, chunk => hash.update(chunk), inventoryError);
        if (hash.digest('hex') !== info.sha256) invalid(inventoryError);
      });
      totalBytes += info.bytes;
    }
    const packageBytes = await readMetadata(path.join(directory, appPackageName), packageLimit, inventoryError, beginning.get(appPackageName));
    if (digest(packageBytes) !== manifest.files[appPackageName].sha256) invalid(inventoryError);
    validateAppPackage(packageBytes, manifest);
    snapshotEquals(beginning, await scanTree(directory, expected), inventoryError);
    const manifestBytes = await readMetadata(path.join(directory, manifestName), manifestLimit, inventoryError, beginning.get(manifestName));
    if (!manifestBytes.equals(current.bytes)) invalid(inventoryError);
    snapshotEquals(parents, await inspectParents(directory, inventoryError), inventoryError);
    return Object.freeze({ fileCount: Object.keys(manifest.files).length, totalBytes });
  } catch { invalid(inventoryError); }
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--bundle') invalid(manifestError);
  const candidate = await readWindowsCandidateManifest(args[1]);
  const inventory = await verifyWindowsCandidateInventory(candidate);
  console.log(JSON.stringify({
    kind: 'shenyi-windows-candidate-inventory', version: candidate.manifest.version,
    platform: candidate.manifest.platform, arch: candidate.manifest.arch,
    manifestSha256: candidate.manifestSha256, appPayloadSha256: candidate.appPayloadSha256, ...inventory,
  }));
}

if (process.argv[1] && samePath(fileURLToPath(import.meta.url), path.resolve(process.argv[1]))) {
  main(process.argv.slice(2)).catch(error => {
    const code = error instanceof WindowsCandidateInventoryError ? error.code : inventoryError;
    console.error(JSON.stringify({ code, message: messages[code] }));
    process.exitCode = 1;
  });
}
