#!/usr/bin/env node
import { createHash, sign, verify } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCandidateVersion, readWindowsCandidateManifest, verifyWindowsCandidateInventory } from './verify-windows-candidate-inventory.mjs';

import { detachedSignatureFiles, detachedSignatureLength as signatureLength, keyFingerprint } from './detached-release-signature.mjs';
const domain = Buffer.from('shenyi.windows-candidate.manifest.v1\0', 'ascii');
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

const { separatePath, readStableFile, readEd25519Key, publishSignature } = detachedSignatureFiles(fail);

function payload(candidate) {
  return Buffer.concat([domain, candidate.bytes]);
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
