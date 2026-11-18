#!/usr/bin/env node
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertManagedDatabaseReady, startManagedTeamServer } from '../server/team/managed-service.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fields = ['schemaVersion', 'database', 'apiBase', 'serverId', 'listenPort', 'tlsCertificate', 'tlsKey'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const configCode = 'MANAGED_SERVICE_CONFIGURATION_INVALID';
const messages = {
  [configCode]: '服务配置无效。请检查配置格式、本机文件路径及监听地址。',
  MANAGED_DATABASE_NOT_READY: '指定数据库未通过服务启动检查。',
  MANAGED_TLS_INVALID: '证书和私钥无法用于配置的 HTTPS 地址。',
  MANAGED_SERVICE_LISTEN_FAILED: '团队服务未能监听配置的本机端口。',
  MANAGED_SERVICE_STOP_FAILED: '团队服务关闭未完成。',
};

function fail(code) {
  throw Object.assign(new Error(messages[code]), { code });
}

function inside(parent, filename) {
  const relative = path.relative(parent, filename);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

function localPath(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || !path.isAbsolute(value) || /^[\\/]{2}|[\x00-\x1f\x7f]/.test(value)) fail(configCode);
  const root = path.parse(value).root;
  if (process.platform === 'win32' && !/^[A-Za-z]:[\\/]$/.test(root)) fail(configCode);
  const parts = value.slice(root.length).split(/[\\/]/);
  if (parts.some(part => part === '.' || part === '..' || (process.platform === 'win32' &&
    /[:*?"<>|]|[. ]$|^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part)))) fail(configCode);
  return path.resolve(value);
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameState(left, right) {
  return sameFile(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.nlink === right.nlink;
}

async function existingFile(filename, code) {
  const stat = await fs.lstat(filename, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || stat.size < 1n || path.relative(filename, await fs.realpath(filename))) fail(code);
  return stat;
}

async function readLocalFile(filename, maxBytes, code) {
  let handle, bytes;
  try {
    const listed = await existingFile(filename, code);
    if (listed.size > BigInt(maxBytes)) fail(code);
    handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (!sameState(listed, await handle.stat({ bigint: true }))) fail(code);
    bytes = Buffer.alloc(Number(listed.size));
    for (let offset = 0; offset < bytes.length;) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) fail(code);
      offset += bytesRead;
    }
    if (!sameState(listed, await handle.stat({ bigint: true })) || !sameState(listed, await existingFile(filename, code))) fail(code);
    return bytes;
  } catch {
    bytes?.fill(0);
    fail(code);
  } finally {
    await handle?.close();
  }
}

function uniqueKeys(text) {
  // JSON.parse validates token syntax. This walk accounts for escaped key
  // spellings and treats duplicate root keys as configuration errors.
  const seen = new Set();
  let depth = 0;
  for (let offset = 0; offset < text.length; offset++) {
    const current = text[offset];
    if (current === '{' || current === '[') depth++;
    if (current === '}' || current === ']') depth--;
    if (current !== '"') continue;
    const start = offset;
    while (++offset < text.length) {
      if (text[offset] === '\\') offset++;
      else if (text[offset] === '"') break;
    }
    if (depth !== 1 || !/^\s*:/.test(text.slice(offset + 1))) continue;
    const key = JSON.parse(text.slice(start, offset + 1));
    if (seen.has(key)) fail(configCode);
    seen.add(key);
  }
}

export async function loadManagedServiceConfiguration(filename) {
  try {
    const configPath = localPath(filename), repository = await fs.realpath(checkout);
    if (inside(repository, configPath)) fail(configCode);
    const bytes = await readLocalFile(configPath, 16 * 1024, configCode);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail(configCode);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value = JSON.parse(text);
    uniqueKeys(text);
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== fields.length ||
      fields.some(name => !Object.hasOwn(value, name)) || value.schemaVersion !== 1 || typeof value.apiBase !== 'string' ||
      typeof value.serverId !== 'string' || !uuid.test(value.serverId) || !Number.isInteger(value.listenPort) || value.listenPort < 0 || value.listenPort > 65535) fail(configCode);
    const origin = new URL(value.apiBase);
    if (origin.protocol !== 'https:' || origin.origin !== value.apiBase) fail(configCode);
    const { database, tlsCertificate, tlsKey } = Object.fromEntries(['database', 'tlsCertificate', 'tlsKey'].map(name => [name, localPath(value[name])]));
    const filenames = [configPath, database, tlsCertificate, tlsKey];
    if (filenames.some((name, index) => inside(repository, name) || filenames.slice(0, index).some(previous => !path.relative(previous, name)))) fail(configCode);
    return Object.freeze({ ...value, database, tlsCertificate, tlsKey });
  } catch {
    fail(configCode);
  }
}

async function openManagedDatabase(filename, serverId) {
  const code = 'MANAGED_DATABASE_NOT_READY';
  let readonly, writable;
  try {
    const entry = await existingFile(filename, code);
    const uri = pathToFileURL(filename).href;
    readonly = new DatabaseSync(uri + '?mode=ro', { readOnly: true });
    assertManagedDatabaseReady(readonly, serverId);
    readonly.close();
    readonly = undefined;
    writable = new DatabaseSync(uri + '?mode=rw', { timeout: 5000 });
    if (path.relative(filename, writable.location()) || !sameFile(entry, await existingFile(filename, code))) fail(code);
    return writable;
  } catch {
    readonly?.close();
    writable?.close();
    fail(code);
  }
}

export async function openConfiguredTeamService(filename) {
  const configuration = await loadManagedServiceConfiguration(filename);
  const { database, serverId, apiBase, listenPort: port, tlsCertificate, tlsKey } = configuration;
  let db, key;
  try {
    const cert = await readLocalFile(tlsCertificate, 128 * 1024, 'MANAGED_TLS_INVALID');
    key = await readLocalFile(tlsKey, 32 * 1024, 'MANAGED_TLS_INVALID');
    db = await openManagedDatabase(database, serverId);
    const service = await startManagedTeamServer({ db, apiBase, port, serverId, cert, key });
    let stopping;
    return { address: service.address, apiBase: service.apiBase, serverId,
      close: () => stopping ??= service.close().finally(() => db.close()) };
  } catch (error) {
    db?.close();
    throw error;
  } finally {
    key?.fill(0);
  }
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--config') fail(configCode);
  const service = await openConfiguredTeamService(args[1]);
  const signals = process.platform === 'win32' ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM'];
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await service.close();
      console.log(JSON.stringify({ event: 'stopped' }));
    } catch {
      process.exitCode = 1;
      console.error(JSON.stringify({ event: 'error', code: 'MANAGED_SERVICE_STOP_FAILED', message: messages.MANAGED_SERVICE_STOP_FAILED }));
    } finally {
      for (const signal of signals) process.removeListener(signal, stop);
    }
  };
  for (const signal of signals) process.once(signal, stop);
  console.log(JSON.stringify({ event: 'ready', address: service.address, apiBase: service.apiBase, serverId: service.serverId }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    const code = Object.hasOwn(messages, error?.code) ? error.code : configCode;
    console.error(JSON.stringify({ event: 'error', code, message: messages[code] }));
    process.exitCode = 1;
  });
}
