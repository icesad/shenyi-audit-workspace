#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash, sign, verify } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fileFacts } from './build-windows-desktop-candidate.mjs';
import { detachedSignatureFiles, detachedSignatureLength, keyFingerprint } from './detached-release-signature.mjs';

const run = promisify(execFile);
const archiveTool = fileURLToPath(new URL('./build-macos-desktop-archive.py', import.meta.url));
const domain = Buffer.from('shenyi.macos-candidate.manifest.v1\0', 'ascii');
const manifestName = 'candidate-manifest.json';
const bundleIdentifier = 'invalid.shenyi.audit.candidate';
const architectures = new Set(['arm64', 'x64']);
const maxCompressedBytes = 1024 ** 3;
const digest = value => createHash('sha256').update(value).digest('hex');
const hash = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const manifestError = 'CANDIDATE_MANIFEST_INVALID';
const inventoryError = 'CANDIDATE_INVENTORY_INVALID';
const signatureError = 'CANDIDATE_SIGNATURE_INVALID';
const messages = {
  INVALID_ARGUMENTS: '请提供完整的 macOS 候选签名或验签参数，并明确指定 arm64 或 x64。',
  SIGNING_KEY_INVALID: '无法使用指定的 Ed25519 私钥文件。',
  VERIFICATION_KEY_INVALID: '无法使用独立配置的 Ed25519 公钥文件。',
  SIGNATURE_OUTPUT_INVALID: '签名输出须在候选目录和仓库之外，且尚不存在。',
  CANDIDATE_ARCH_MISMATCH: '候选清单的目标架构与本次明确指定的架构不符。',
  [manifestError]: 'macOS 候选清单不符合约定。',
  [inventoryError]: 'macOS ZIP 的大小、摘要或应用结构不符合候选清单。',
  [signatureError]: '候选发布签名缺失、无效或与受信公钥不符。',
  CANDIDATE_VERSION_INVALID: '请提供有效的三段稳定版本号。',
  CANDIDATE_VERSION_NOT_NEWER: '候选版本须高于已安装版本。',
  CANDIDATE_OPERATION_FAILED: 'macOS 候选签名或验签未完成。',
};

function fail(code) {
  throw Object.assign(new Error(messages[code]), { code });
}

const { localPath, separatePath, readStableFile, readEd25519Key, publishSignature } = detachedSignatureFiles(fail);

function versionParts(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(value)) fail('CANDIDATE_VERSION_INVALID');
  const parts = value.split('.').map(Number);
  if (parts.join('.') !== value || !parts.every(Number.isSafeInteger)) fail('CANDIDATE_VERSION_INVALID');
  return parts;
}

function exactKeys(object, keys) {
  return !!object && Object.getPrototypeOf(object) === Object.prototype && JSON.stringify(Object.keys(object)) === JSON.stringify(keys);
}

function validateManifest(manifest, bytes) {
  const keys = ['schemaVersion', 'kind', 'platform', 'arch', 'releaseStatus', 'version', 'trustedServiceProfileIncluded', 'electron', 'archive',
    'bundleIdentifier', 'archiveEntries', 'symlinkCount', 'applicationFileCount', 'sourceFileCount', 'productionPackageCount'];
  if (!exactKeys(manifest, keys) || !Buffer.from(JSON.stringify(manifest, null, 2) + '\n').equals(bytes) ||
      manifest.schemaVersion !== 1 || manifest.kind !== 'shenyi-macos-desktop-candidate' || manifest.platform !== 'darwin' || !architectures.has(manifest.arch) ||
      manifest.releaseStatus !== 'candidate-requires-macos-signing-and-native-validation' || manifest.trustedServiceProfileIncluded !== false ||
      manifest.bundleIdentifier !== bundleIdentifier || !['archiveEntries', 'symlinkCount', 'applicationFileCount', 'sourceFileCount', 'productionPackageCount'].every(key => positive(manifest[key])) ||
      manifest.archiveEntries > 20_000 || manifest.applicationFileCount + manifest.symlinkCount > manifest.archiveEntries ||
      manifest.sourceFileCount + manifest.productionPackageCount > manifest.applicationFileCount) fail(manifestError);
  for (const part of [manifest.electron, manifest.archive]) {
    const name = part === manifest.electron ? ['version', 'archive'] : ['filename'];
    if (!exactKeys(part, [...name, 'bytes', 'sha256']) || !positive(part.bytes) || part.bytes > maxCompressedBytes || !hash(part.sha256)) fail(manifestError);
  }
  versionParts(manifest.version);
  versionParts(manifest.electron.version);
  if (manifest.archive.filename !== `Shenyi-macos-${manifest.arch}.zip` ||
      manifest.electron.archive !== `electron-v${manifest.electron.version}-darwin-${manifest.arch}.zip`) fail(manifestError);
}

function sameFile(before, after) {
  return ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key]);
}

async function readCandidate(input, expectedArch) {
  const directory = localPath(input, manifestError);
  try {
    const state = await lstat(directory, { bigint: true });
    if (!state.isDirectory() || path.relative(directory, await realpath(directory))) fail(manifestError);
    const filename = path.join(directory, manifestName);
    const bytes = await readStableFile(filename, 16 * 1024, manifestError);
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    validateManifest(manifest, bytes);
    if (manifest.arch !== expectedArch) fail('CANDIDATE_ARCH_MISMATCH');
    return { directory, state, filename, manifest, bytes };
  } catch (error) {
    if (Object.hasOwn(messages, error?.code)) throw error;
    fail(manifestError);
  }
}

async function verifyArchive(candidate) {
  const { directory, manifest } = candidate;
  const expectedNames = [manifestName, manifest.archive.filename].sort();
  const filename = path.join(directory, manifest.archive.filename);
  try {
    const before = await lstat(filename, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(manifest.archive.bytes) || path.relative(filename, await realpath(filename)) ||
        JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(expectedNames)) fail(inventoryError);
    const python = process.platform === 'win32' ? 'python' : 'python3';
    const inspection = run(python, ['-I', archiveTool, '--verify', filename, manifest.arch, manifest.version],
      { timeout: 120_000, windowsHide: true, maxBuffer: 64 * 1024 });
    const [{ stdout }, facts] = await Promise.all([inspection, fileFacts(filename)]);
    const reported = JSON.parse(stdout);
    if (facts.bytes !== manifest.archive.bytes || facts.sha256 !== manifest.archive.sha256 ||
        reported.archiveBytes !== facts.bytes || reported.archiveSha256 !== facts.sha256 || reported.bundleIdentifier !== manifest.bundleIdentifier ||
        reported.archiveEntries !== manifest.archiveEntries || reported.symlinks !== manifest.symlinkCount || reported.appFiles !== manifest.applicationFileCount ||
        !sameFile(before, await lstat(filename, { bigint: true })) || !sameFile(candidate.state, await lstat(directory, { bigint: true })) ||
        !(await readStableFile(candidate.filename, 16 * 1024, manifestError)).equals(candidate.bytes) ||
        JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(expectedNames)) fail(inventoryError);
  } catch { fail(inventoryError); }
}

function payload(candidate) {
  return Buffer.concat([domain, candidate.bytes]);
}

function result(operation, candidate, key, signature) {
  const { manifest } = candidate;
  return { operation, platform: 'darwin', arch: manifest.arch, version: manifest.version, manifestSha256: digest(candidate.bytes),
    publicKeySha256: keyFingerprint(key), signatureSha256: digest(signature), archiveSha256: manifest.archive.sha256, archiveBytes: manifest.archive.bytes,
    archiveEntries: manifest.archiveEntries, symlinkCount: manifest.symlinkCount, applicationFileCount: manifest.applicationFileCount,
    offline: true, osSignatureVerified: false };
}

async function signCandidate(options, candidate) {
  const target = await separatePath(options['--signature'], candidate.directory, 'SIGNATURE_OUTPUT_INVALID');
  const key = await readEd25519Key(options['--private-key'], candidate.directory, true);
  await verifyArchive(candidate);
  const signature = sign(null, payload(candidate), key);
  if (signature.length !== detachedSignatureLength) fail('CANDIDATE_OPERATION_FAILED');
  await publishSignature(target, signature);
  return result('sign', candidate, key, signature);
}

async function verifyCandidate(options, candidate) {
  const installedVersion = options['--installed-version'];
  const installed = versionParts(installedVersion);
  const key = await readEd25519Key(options['--public-key'], candidate.directory, false);
  const signaturePath = await separatePath(options['--signature'], candidate.directory, signatureError);
  const signature = await readStableFile(signaturePath, detachedSignatureLength, signatureError);
  if (signature.length !== detachedSignatureLength || !verify(null, payload(candidate), key, signature)) fail(signatureError);
  const version = versionParts(candidate.manifest.version);
  const change = version.findIndex((component, index) => component !== installed[index]);
  if (change === -1 || version[change] < installed[change]) fail('CANDIDATE_VERSION_NOT_NEWER');
  await verifyArchive(candidate);
  if (!(await readStableFile(signaturePath, detachedSignatureLength, signatureError)).equals(signature)) fail(signatureError);
  return { ...result('verify', candidate, key, signature), installedVersion };
}

async function main(args) {
  const [operation, ...fields] = args;
  const common = ['--bundle', '--arch', '--signature'];
  const required = new Set(operation === 'sign' ? [...common, '--private-key'] :
    operation === 'verify' ? [...common, '--public-key', '--installed-version'] : []);
  if (!required.size || fields.length !== required.size * 2) fail('INVALID_ARGUMENTS');
  const options = Object.create(null);
  for (let index = 0; index < fields.length; index += 2) {
    const [name, value] = fields.slice(index, index + 2);
    if (!required.delete(name) || !value || value.startsWith('--')) fail('INVALID_ARGUMENTS');
    options[name] = value;
  }
  if (!architectures.has(options['--arch'])) fail('INVALID_ARGUMENTS');
  const candidate = await readCandidate(options['--bundle'], options['--arch']);
  const receipt = await (operation === 'sign' ? signCandidate(options, candidate) : verifyCandidate(options, candidate));
  console.log(JSON.stringify({ ok: true, ...receipt }));
}

if (process.argv[1] && !path.relative(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => {
    const code = Object.hasOwn(messages, error?.code) ? error.code : 'CANDIDATE_OPERATION_FAILED';
    console.error(JSON.stringify({ ok: false, code, message: messages[code] }));
    process.exitCode = 1;
  });
}
