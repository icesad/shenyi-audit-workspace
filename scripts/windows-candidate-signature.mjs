#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCandidateVersion, readWindowsCandidateManifest, verifyWindowsCandidateInventory } from './verify-windows-candidate-inventory.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const domain = Buffer.from('shenyi.windows-candidate.manifest.v1\0', 'ascii');
const signatureLength = 64;
const messages = {
  INVALID_ARGUMENTS: '请提供完整的 Windows 候选签名或验签参数。',
  SIGNING_KEY_INVALID: '无法使用指定的 Ed25519 私钥文件。',
  VERIFICATION_KEY_INVALID: '无法使用独立配置的 Ed25519 公钥文件。',
  SIGNATURE_OUTPUT_INVALID: '签名输出需要位于候选目录和仓库外，并且尚未存在。',
  CANDIDATE_SIGNATURE_INVALID: '候选发布签名缺失、无效或与受信公钥不符。',
  CANDIDATE_VERSION_INVALID: '请提供有效的正式三段版本号。',
  CANDIDATE_VERSION_NOT_NEWER: '候选版本必须高于当前已安装版本。',
  CANDIDATE_MANIFEST_INVALID: 'Windows 候选清单不符合约定。',
  CANDIDATE_INVENTORY_INVALID: 'Windows 候选文件与清单不一致。',
  CANDIDATE_OPERATION_FAILED: '候选签名或验签未完成。',
};

function fail(code) {
  throw Object.assign(new Error(messages[code]), { code });
}

function inside(parent, filename) {
  const relative = path.relative(parent, filename);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

function localPath(value, code) {
  if (typeof value !== 'string' || !value.isWellFormed() || !path.isAbsolute(value) || /^[\\/]{2}|[\x00-\x1f\x7f]/.test(value)) fail(code);
  if (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(value)) fail(code);
  const parts = value.slice(path.parse(value).root.length).split(/[\\/]/);
  if (parts.some(part => part === '.' || part === '..')) fail(code);
  if (process.platform === 'win32' && parts.some(part => /[:*?"<>|]|[. ]$|^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) fail(code);
  return path.resolve(value);
}

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

function sameState(a, b) {
  return sameFile(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;
}

async function separatePath(value, bundleDirectory, code) {
  const filename = localPath(value, code);
  try {
    const parent = path.dirname(filename);
    const [actualParent, canonicalCheckout] = await Promise.all([fs.realpath(parent), fs.realpath(checkout)]);
    if (path.relative(parent, actualParent) || inside(canonicalCheckout, filename) || inside(bundleDirectory, filename)) fail(code);
    return filename;
  } catch {
    fail(code);
  }
}

async function readStableFile(filename, maxBytes, code) {
  let handle, bytes;
  try {
    const entry = await fs.lstat(filename, { bigint: true });
    if (!entry.isFile() || entry.nlink !== 1n || entry.size < 1n || entry.size > BigInt(maxBytes)) fail(code);
    if (path.relative(filename, await fs.realpath(filename))) fail(code);
    handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const state = await handle.stat({ bigint: true });
    if (!sameState(entry, state)) fail(code);
    bytes = Buffer.alloc(Number(state.size));
    for (let offset = 0; offset < bytes.length;) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) fail(code);
      offset += bytesRead;
    }
    const final = await handle.stat({ bigint: true });
    if (!sameState(state, final) || !sameState(state, await fs.lstat(filename, { bigint: true }))) fail(code);
    return bytes;
  } catch {
    bytes?.fill(0);
    fail(code);
  } finally {
    await handle?.close();
  }
}

async function readEd25519Key(value, directory, privateKey) {
  const code = privateKey ? 'SIGNING_KEY_INVALID' : 'VERIFICATION_KEY_INVALID';
  const filename = await separatePath(value, directory, code);
  const bytes = await readStableFile(filename, 4096, code);
  try {
    const label = privateKey ? 'PRIVATE KEY' : 'PUBLIC KEY';
    const pem = new RegExp(`^-----BEGIN ${label}-----\\r?\\n(?:[A-Za-z0-9+/=]+\\r?\\n)+-----END ${label}-----(?:\\r?\\n)?$`);
    if (!pem.test(bytes.toString('latin1'))) fail(code);
    const key = privateKey ? createPrivateKey(bytes) : createPublicKey(bytes);
    if (key.asymmetricKeyType !== 'ed25519') fail(code);
    return key;
  } catch {
    fail(code);
  } finally {
    bytes.fill(0);
  }
}

async function unlinkIfOwned(filename, expected) {
  if (!expected) return;
  try {
    const current = await fs.lstat(filename, { bigint: true });
    if (current.isFile() && sameFile(expected, current)) await fs.unlink(filename);
  } catch {
    // Preserve paths that cannot be confirmed as this invocation's file.
  }
}

async function publishSignature(filename, bytes) {
  const code = 'SIGNATURE_OUTPUT_INVALID';
  const parent = path.dirname(filename);
  const temporary = path.join(parent, `.shenyi-signature-${randomUUID()}.pending`);
  let handle, owned, linked = false;
  try {
    const directory = await fs.lstat(parent, { bigint: true });
    if (!directory.isDirectory() || path.relative(parent, await fs.realpath(parent))) fail(code);
    handle = await fs.open(temporary, 'wx', 0o600);
    owned = await handle.stat({ bigint: true });
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const current = await fs.lstat(temporary, { bigint: true });
    if (!sameFile(owned, current) || !current.isFile() || current.nlink !== 1n || current.size !== BigInt(signatureLength)) fail(code);
    if (path.relative(parent, await fs.realpath(parent)) || !sameFile(directory, await fs.lstat(parent, { bigint: true }))) fail(code);
    await fs.link(temporary, filename);
    linked = true;
    const published = await fs.lstat(filename, { bigint: true });
    if (!sameFile(owned, published) || !published.isFile() || published.nlink !== 2n) fail(code);
    await fs.unlink(temporary);
    if (!(await readStableFile(filename, signatureLength, code)).equals(bytes)) fail(code);
  } catch {
    await handle?.close().catch(() => {});
    if (linked) await unlinkIfOwned(filename, owned);
    await unlinkIfOwned(temporary, owned);
    fail(code);
  }
}

function payload(candidate) {
  return Buffer.concat([domain, candidate.bytes]);
}

function keyFingerprint(key) {
  const publicKey = key.type === 'public' ? key : createPublicKey(key);
  return createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('hex');
}

function candidateIsNewer(candidate, installed) {
  const firstDifference = candidate.findIndex((part, index) => part !== installed[index]);
  return firstDifference >= 0 && candidate[firstDifference] > installed[firstDifference];
}

function result(operation, candidate, inventory, key, bytes) {
  return {
    operation, version: candidate.manifest.version, platform: 'win32', arch: 'x64',
    manifestSha256: candidate.manifestSha256, publicKeySha256: keyFingerprint(key),
    signatureSha256: createHash('sha256').update(bytes).digest('hex'),
    ...inventory, offline: true, osSignatureVerified: false,
  };
}

export async function signWindowsCandidate(options) {
  const candidate = await readWindowsCandidateManifest(options['--bundle']);
  const target = await separatePath(options['--signature'], candidate.directory, 'SIGNATURE_OUTPUT_INVALID');
  const key = await readEd25519Key(options['--private-key'], candidate.directory, true);
  const inventory = await verifyWindowsCandidateInventory(candidate);
  const bytes = sign(null, payload(candidate), key);
  if (bytes.length !== signatureLength) fail('CANDIDATE_OPERATION_FAILED');
  await publishSignature(target, bytes);
  return result('sign', candidate, inventory, key, bytes);
}

export async function verifyWindowsCandidate(options) {
  const installedVersion = options['--installed-version'];
  const installed = parseCandidateVersion(installedVersion);
  const candidate = await readWindowsCandidateManifest(options['--bundle']);
  const key = await readEd25519Key(options['--public-key'], candidate.directory, false);
  const filename = await separatePath(options['--signature'], candidate.directory, 'CANDIDATE_SIGNATURE_INVALID');
  const bytes = await readStableFile(filename, signatureLength, 'CANDIDATE_SIGNATURE_INVALID');
  if (bytes.length !== signatureLength || !verify(null, payload(candidate), key, bytes)) fail('CANDIDATE_SIGNATURE_INVALID');
  if (!candidateIsNewer(parseCandidateVersion(candidate.manifest.version), installed)) fail('CANDIDATE_VERSION_NOT_NEWER');
  const inventory = await verifyWindowsCandidateInventory(candidate);
  if (!(await readStableFile(filename, signatureLength, 'CANDIDATE_SIGNATURE_INVALID')).equals(bytes)) fail('CANDIDATE_SIGNATURE_INVALID');
  return { ...result('verify', candidate, inventory, key, bytes), installedVersion };
}

function parseArguments(args) {
  const [command, ...rest] = args;
  const common = ['--bundle', '--signature'];
  const required = command === 'sign' ? [...common, '--private-key'] : command === 'verify' ? [...common, '--public-key', '--installed-version'] : [];
  if (!required.length || rest.length !== required.length * 2) fail('INVALID_ARGUMENTS');
  const fields = Object.create(null);
  for (let index = 0; index < rest.length; index += 2) {
    const [name, value] = rest.slice(index, index + 2);
    if (!required.includes(name) || Object.hasOwn(fields, name) || !value || value.startsWith('--')) fail('INVALID_ARGUMENTS');
    fields[name] = value;
  }
  return [command, fields];
}

async function main(args) {
  const [command, fields] = parseArguments(args);
  const outcome = command === 'sign' ? await signWindowsCandidate(fields) : await verifyWindowsCandidate(fields);
  console.log(JSON.stringify({ ok: true, ...outcome }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    const code = Object.hasOwn(messages, error.code) ? error.code : 'CANDIDATE_OPERATION_FAILED';
    console.error(JSON.stringify({ ok: false, code, message: messages[code] }));
    process.exitCode = 1;
  });
}
