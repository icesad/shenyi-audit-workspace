#!/usr/bin/env node
import { createHash, sign, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detachedSignatureFiles, detachedSignatureLength, keyFingerprint } from './detached-release-signature.mjs';

const messages = {
  INVALID_ARGUMENTS: '请提供归档、完整 Git 提交及本次操作需要的签名或密钥路径。',
  ARCHIVE_INVALID: '请选择稳定的本机 Git TAR 发行归档。',
  ARCHIVE_REVISION_MISMATCH: '归档记录的 Git 提交与指定的发行提交不一致。',
  SIGNING_KEY_INVALID: '无法读取独立的 Ed25519 签发私钥。',
  VERIFICATION_KEY_INVALID: '无法读取独立交付的 Ed25519 验签公钥。',
  SIGNATURE_INVALID: '签名未通过该发行提交和归档字节的核验。',
  SIGNATURE_OUTPUT_INVALID: '签名无法写入指定的新文件。',
};
const revisionPattern = /^[0-9a-f]{40}$/;
const format = 'shenyi-linux-team-release-v1';
const tarBlock = 512;

function fail(code) {
  throw Object.assign(new Error(messages[code]), { code });
}

const { localPath, separatePath, readEd25519Key, readStableFile, publishSignature } = detachedSignatureFiles(fail);

function fieldsOf(args) {
  const [operation, ...rest] = args;
  const options = operation === 'sign' ? ['--private-key', '--output'] :
    operation === 'verify' ? ['--public-key', '--signature'] : null;
  if (!options || rest.length !== 8) fail('INVALID_ARGUMENTS');
  const remaining = new Set(['--archive', '--revision', ...options]);
  const fields = {};
  for (let index = 0; index < rest.length; index += 2) {
    const [name, value] = rest.slice(index, index + 2);
    if (!remaining.delete(name) || typeof value !== 'string' || !value || value.startsWith('--')) fail('INVALID_ARGUMENTS');
    fields[name] = value;
  }
  if (fields['--revision'].length !== 40 || !revisionPattern.test(fields['--revision'])) fail('INVALID_ARGUMENTS');
  return { operation, fields };
}

function archiveRevision(bytes) {
  const header = bytes.subarray(0, tarBlock);
  const name = header.subarray(0, 100).toString('latin1');
  const size = header.subarray(124, 136).toString('latin1');
  const checksum = header.subarray(148, 156).toString('latin1');
  if (!/^pax_global_header\0+$/.test(name) || header[156] !== 0x67 ||
      header.subarray(257, 265).toString('latin1') !== 'ustar\0' + '00' ||
      !/^[0-7]{11}\0$/.test(size) || !/^[0-7]{7}\0$/.test(checksum)) fail('ARCHIVE_INVALID');
  const computed = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
  if (computed !== Number.parseInt(checksum, 8) || Number.parseInt(size, 8) !== 52) fail('ARCHIVE_INVALID');
  const payload = bytes.subarray(tarBlock, tarBlock + 52).toString('latin1');
  const match = /^52 comment=([0-9a-f]{40})\n$/.exec(payload);
  if (!match || bytes.subarray(tarBlock + 52).some(byte => byte !== 0)) fail('ARCHIVE_INVALID');
  return match[1];
}

function sameState(previous, current) {
  return ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => previous[key] === current[key]);
}

async function assertStable(filename, state) {
  if (path.relative(filename, await realpath(filename)) || !sameState(state, await lstat(filename, { bigint: true }))) {
    fail('ARCHIVE_INVALID');
  }
}

async function inspectArchive(filename, expectedRevision) {
  let handle;
  try {
    const state = await lstat(filename, { bigint: true });
    const bytes = Number(state.size);
    if (!filename.endsWith('.tar') || !state.isFile() || state.nlink !== 1n || !Number.isSafeInteger(bytes) ||
        bytes < 5 * tarBlock || bytes % tarBlock !== 0) fail('ARCHIVE_INVALID');
    await assertStable(filename, state);
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (!sameState(state, await handle.stat({ bigint: true }))) fail('ARCHIVE_INVALID');
    const header = Buffer.alloc(2 * tarBlock);
    const trailer = Buffer.alloc(2 * tarBlock);
    if ((await handle.read(header, 0, header.length, 0)).bytesRead !== header.length ||
        (await handle.read(trailer, 0, trailer.length, bytes - trailer.length)).bytesRead !== trailer.length ||
        trailer.some(byte => byte !== 0)) fail('ARCHIVE_INVALID');
    const revision = archiveRevision(header);
    if (revision !== expectedRevision) fail('ARCHIVE_REVISION_MISMATCH');
    const hash = createHash('sha256');
    let read = 0;
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
      hash.update(chunk);
      read += chunk.length;
    }
    if (read !== bytes || !sameState(state, await handle.stat({ bigint: true }))) fail('ARCHIVE_INVALID');
    await assertStable(filename, state);
    return { revision, bytes, sha256: hash.digest('hex'), state };
  } catch (error) {
    if (error.code === 'ARCHIVE_REVISION_MISMATCH') throw error;
    fail('ARCHIVE_INVALID');
  } finally {
    await handle?.close();
  }
}

export async function runLinuxReleaseSignature(args) {
  const { operation, fields } = fieldsOf(args);
  const filename = localPath(fields['--archive'], 'ARCHIVE_INVALID');
  const { state, ...archive } = await inspectArchive(filename, fields['--revision']);
  const payload = Buffer.from(`${format}\n${archive.revision}\n${archive.bytes}\n${archive.sha256}\n`, 'ascii');
  const signing = operation === 'sign';
  const key = await readEd25519Key(fields[signing ? '--private-key' : '--public-key'], path.dirname(filename), signing);
  const signaturePath = await separatePath(fields[signing ? '--output' : '--signature'], filename,
    signing ? 'SIGNATURE_OUTPUT_INVALID' : 'SIGNATURE_INVALID');
  let signature;
  if (signing) {
    signature = sign(null, payload, key);
    await publishSignature(signaturePath, signature, () => assertStable(filename, state));
  } else {
    signature = await readStableFile(signaturePath, detachedSignatureLength, 'SIGNATURE_INVALID');
    if (signature.length !== detachedSignatureLength || !verify(null, payload, key, signature)) fail('SIGNATURE_INVALID');
    await assertStable(filename, state).catch(() => fail('ARCHIVE_INVALID'));
  }
  return { ok: true, operation, format, archive, signatureSha256: createHash('sha256').update(signature).digest('hex'),
    publicKeySha256: keyFingerprint(key), archiveExtracted: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLinuxReleaseSignature(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    const code = Object.hasOwn(messages, error.code) ? error.code : 'ARCHIVE_INVALID';
    console.error(JSON.stringify({ ok: false, code, message: messages[code] }));
    process.exitCode = 1;
  });
}
