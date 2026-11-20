#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { detachedSignatureFiles } from './detached-release-signature.mjs';

const purposeExtensions = new Map([
  ['windows-review', '.zip'],
  ['macos-presigning', '.zip'],
  ['linux-rehearsal', '.tar'],
]);
const argumentNames = ['--catalog', '--catalog-sha256', '--artifact', '--archive'];
const entryKeys = ['id', 'purpose', 'name', 'sourceCommit', 'bytes', 'sha256'];
const artifactId = /^[a-z0-9][a-z0-9-]{0,63}$/;
const sha256 = /^[a-f0-9]{64}$/;
const maxCatalogBytes = 64 * 1024;
const matches = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
const digest = data => createHash('sha256').update(data).digest('hex');

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

const { localPath, readStableFile } = detachedSignatureFiles(fail);

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const [key, value] = args.slice(index, index + 2);
    if (!argumentNames.includes(key) || values.has(key) || !value) fail('INVALID_ARGUMENTS');
    values.set(key, value);
  }
  const catalogSha256 = values.get('--catalog-sha256')?.toLowerCase();
  const id = values.get('--artifact');
  if (values.size !== argumentNames.length || !matches(sha256, catalogSha256) || !matches(artifactId, id)) {
    fail('INVALID_ARGUMENTS');
  }
  return { catalog: localPath(values.get('--catalog'), 'INVALID_ARGUMENTS'), catalogSha256, id,
    archive: localPath(values.get('--archive'), 'INVALID_ARGUMENTS') };
}

async function selectedArtifact({ catalog, catalogSha256, id }) {
  const data = await readStableFile(catalog, maxCatalogBytes, 'CATALOG_INVALID');
  if (digest(data) !== catalogSha256) fail('CATALOG_DIGEST_MISMATCH');

  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
  catch { fail('CATALOG_INVALID'); }
  if (!exactKeys(parsed, ['schemaVersion', 'artifacts']) || parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.artifacts) || parsed.artifacts.length === 0) fail('CATALOG_INVALID');

  const entries = new Map();
  for (const item of parsed.artifacts) {
    if (!exactKeys(item, entryKeys) || !matches(artifactId, item.id) || entries.has(item.id) ||
        !purposeExtensions.has(item.purpose) || !matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/, item.name) ||
        !item.name.endsWith(purposeExtensions.get(item.purpose)) || !matches(/^[a-f0-9]{40}$/, item.sourceCommit) ||
        !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || !matches(sha256, item.sha256)) fail('CATALOG_INVALID');
    entries.set(item.id, item);
  }
  if (!entries.has(id)) fail('ARTIFACT_NOT_LISTED');
  return entries.get(id);
}

function sameState(a, b) {
  return ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].every(field => a[field] === b[field]);
}

async function archiveState(filename) {
  const entry = await lstat(filename, { bigint: true });
  if (!entry.isFile() || entry.nlink !== 1n || path.relative(filename, await realpath(filename))) fail('ARTIFACT_INVALID');
  return entry;
}

async function verifyArchive(filename, item) {
  let handle;
  try {
    const before = await archiveState(filename);
    if (before.size !== BigInt(item.bytes)) fail('ARTIFACT_SIZE_MISMATCH');
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    if (!sameState(before, await handle.stat({ bigint: true }))) fail('ARTIFACT_INVALID');

    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ start: 0, end: item.bytes - 1, autoClose: false })) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    if (bytes !== item.bytes || !sameState(before, await handle.stat({ bigint: true })) ||
        !sameState(before, await archiveState(filename))) fail('ARTIFACT_INVALID');
    if (hash.digest('hex') !== item.sha256) fail('ARTIFACT_DIGEST_MISMATCH');
  } catch (error) {
    if (['ARTIFACT_SIZE_MISMATCH', 'ARTIFACT_DIGEST_MISMATCH'].includes(error.code)) throw error;
    fail('ARTIFACT_INVALID');
  } finally { await handle?.close(); }
}

async function main(args) {
  const options = parseArgs(args);
  const { id: artifact, ...item } = await selectedArtifact(options);
  await verifyArchive(options.archive, item);
  return { status: 'verified', verification: 'archive-bytes', artifact, ...item, catalogSha256: options.catalogSha256 };
}

main(process.argv.slice(2)).then(receipt => console.log(JSON.stringify(receipt))).catch(error => {
  console.log(JSON.stringify({ status: 'failed', code: error.code ?? 'ARTIFACT_INVALID' }));
  process.exitCode = 1;
});
