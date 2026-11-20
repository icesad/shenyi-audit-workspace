#!/usr/bin/env node
import { createPrivateKey } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { assertManagedDatabaseReady } from '../server/team/managed-database-readiness.mjs';
import { createAliyunSms } from '../server/team/aliyun-sms.mjs';
import { createWechatOpenPlatform } from '../server/team/wechat-open-platform.mjs';
import { assertWechatNativeBillingReady } from '../server/team/wechat-native-billing.mjs';
import { APP_ID, MERCHANT_ID, createWechatSignatureVerifier, isRsa2048Key, matches } from '../server/team/wechat-native-protocol.mjs';
import { sqliteExistingFileUri } from '../server/team/sqlite-existing-file.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fields = ['schemaVersion', 'database', 'apiBase', 'serverId', 'listenPort', 'tlsCertificate', 'tlsKey'];
const optionalFields = ['smsProfile', 'reviewedRecovery', 'wechatProfile', 'wechatNativeCallbackProfile', 'wechatNativeWebsiteProfile'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const configCode = 'MANAGED_SERVICE_CONFIGURATION_INVALID';
const messages = {
  [configCode]: '服务配置无效。请检查配置格式、本机文件路径及监听地址。',
  MANAGED_DATABASE_NOT_READY: '指定数据库未通过服务启动检查。',
  MANAGED_PILOT_SMS_REQUIRED: '首队试点需要先配置用于账号激活的短信服务。',
  MANAGED_PILOT_SCHEMA_NOT_READY: '指定数据库缺少首队试点所需的开通、激活或审批结构。',
  MANAGED_PILOT_REVIEWER_NOT_READY: '首队试点需要一名手机号已验证且具备开通和试点审批权限的有效审核员。',
  MANAGED_TLS_INVALID: '证书和私钥无法用于配置的 HTTPS 地址。',
  MANAGED_SMS_INVALID: '短信服务配置无效。请检查独立配置文件及模板。',
  MANAGED_WECHAT_INVALID: '微信扫码服务配置无效。请检查独立配置文件、应用和回调域名。',
  MANAGED_WECHAT_NATIVE_CALLBACK_NOT_READY: '微信支付通知配置或账本未就绪。',
  MANAGED_WECHAT_NATIVE_WEBSITE_NOT_READY: '微信支付官网订单页配置未就绪。',
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

function uniqueKeys(text, code) {
  // JSON.parse validates token syntax. This walk accounts for escaped key
  // spellings and rejects duplicates within each object.
  const objects = [];
  for (let offset = 0; offset < text.length; offset++) {
    const current = text[offset];
    if (current === '{' || current === '[') objects.push(current === '{' ? new Set() : null);
    if (current === '}' || current === ']') objects.pop();
    if (current !== '"') continue;
    const start = offset;
    while (++offset < text.length) {
      if (text[offset] === '\\') offset++;
      else if (text[offset] === '"') break;
    }
    const seen = objects.at(-1);
    if (!seen || !/^\s*:/.test(text.slice(offset + 1))) continue;
    const key = JSON.parse(text.slice(start, offset + 1));
    if (seen.has(key)) fail(code);
    seen.add(key);
  }
}

function parseProfile(bytes, code) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail(code);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(text);
  uniqueKeys(text, code);
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  return value;
}

export async function loadManagedServiceConfiguration(filename) {
  try {
    const configPath = localPath(filename), repository = await fs.realpath(checkout);
    if (inside(repository, configPath)) fail(configCode);
    const bytes = await readLocalFile(configPath, 16 * 1024, configCode);
    const value = parseProfile(bytes, configCode);
    if (Object.keys(value).some(name => !fields.includes(name) && !optionalFields.includes(name)) ||
      fields.some(name => !Object.hasOwn(value, name)) || value.schemaVersion !== 1 || typeof value.apiBase !== 'string' ||
      typeof value.serverId !== 'string' || !uuid.test(value.serverId) || !Number.isInteger(value.listenPort) || value.listenPort < 0 || value.listenPort > 65535) fail(configCode);
    const origin = new URL(value.apiBase);
    if (origin.protocol !== 'https:' || origin.origin !== value.apiBase) fail(configCode);
    const { database, tlsCertificate, tlsKey } = Object.fromEntries(['database', 'tlsCertificate', 'tlsKey'].map(name => [name, localPath(value[name])]));
    const filenames = [configPath, database, tlsCertificate, tlsKey];
    const smsProfile = Object.hasOwn(value, 'smsProfile') ? localPath(value.smsProfile) : undefined;
    const wechatProfile = Object.hasOwn(value, 'wechatProfile') ? localPath(value.wechatProfile) : undefined;
    const wechatNativeCallbackProfile = Object.hasOwn(value, 'wechatNativeCallbackProfile') ? localPath(value.wechatNativeCallbackProfile) : undefined;
    const wechatNativeWebsiteProfile = Object.hasOwn(value, 'wechatNativeWebsiteProfile') ? localPath(value.wechatNativeWebsiteProfile) : undefined;
    if ((Object.hasOwn(value, 'reviewedRecovery') && typeof value.reviewedRecovery !== 'boolean') ||
      (value.reviewedRecovery === true && !smsProfile)) fail(configCode);
    if (smsProfile) filenames.push(smsProfile);
    if (wechatProfile) filenames.push(wechatProfile);
    if (wechatNativeCallbackProfile) filenames.push(wechatNativeCallbackProfile);
    if (wechatNativeWebsiteProfile) {
      if (!wechatNativeCallbackProfile) fail(configCode);
      filenames.push(wechatNativeWebsiteProfile);
    }
    if (filenames.some((name, index) => inside(repository, name) || filenames.slice(0, index).some(previous => !path.relative(previous, name)))) fail(configCode);
    return Object.freeze({ ...value, database, tlsCertificate, tlsKey, ...(smsProfile ? { smsProfile } : {}),
      ...(wechatProfile ? { wechatProfile } : {}), ...(wechatNativeCallbackProfile ? { wechatNativeCallbackProfile } : {}),
      ...(wechatNativeWebsiteProfile ? { wechatNativeWebsiteProfile } : {}) });
  } catch {
    fail(configCode);
  }
}

async function loadSmsProvider(filename) {
  if (filename === undefined) return;
  const code = 'MANAGED_SMS_INVALID';
  let bytes, pepper;
  try {
    if (Object.hasOwn(process.env, 'NODE_TLS_REJECT_UNAUTHORIZED') && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '1') fail(code);
    bytes = await readLocalFile(filename, 16 * 1024, code);
    const { schemaVersion, provider, phonePepper, ...settings } = parseProfile(bytes, code);
    if (schemaVersion !== 1 || provider !== 'aliyun' || typeof phonePepper !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(phonePepper)) fail(code);
    pepper = Buffer.from(phonePepper, 'base64url');
    if (pepper.length !== 32 || pepper.toString('base64url') !== phonePepper) fail(code);
    return { sms: createAliyunSms(settings), phonePepper: pepper };
  } catch {
    pepper?.fill(0);
    fail(code);
  } finally {
    bytes?.fill(0);
  }
}

async function loadWechatProvider(filename, apiBase) {
  if (filename === undefined) return;
  const code = 'MANAGED_WECHAT_INVALID';
  let bytes;
  try {
    if (Object.hasOwn(process.env, 'NODE_TLS_REJECT_UNAUTHORIZED') && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '1') fail(code);
    bytes = await readLocalFile(filename, 16 * 1024, code);
    const { schemaVersion, provider, ...settings } = parseProfile(bytes, code);
    if (schemaVersion !== 1 || provider !== 'wechat-open-platform' || Object.keys(settings).length !== 2 ||
      !Object.hasOwn(settings, 'appSecret') || typeof settings.appId !== 'string' || !/^wx[a-zA-Z0-9]{16}$/.test(settings.appId)) fail(code);
    return createWechatOpenPlatform({ ...settings, redirectUri: apiBase + '/api/auth/wechat/callback' });
  } catch {
    fail(code);
  } finally {
    bytes?.fill(0);
  }
}

async function loadWechatNativeCallback(filename) {
  if (filename === undefined) return;
  const code = 'MANAGED_WECHAT_NATIVE_CALLBACK_NOT_READY';
  let bytes, key;
  try {
    bytes = await readLocalFile(filename, 16 * 1024, code);
    const {schemaVersion, provider, ...settings} = parseProfile(bytes, code);
    const {appId, merchantId, apiV3Key, keys} = settings;
    if (schemaVersion !== 1 || provider !== 'wechat-pay-native-v3' || Object.keys(settings).length !== 4 ||
        !matches(APP_ID, appId) || !matches(MERCHANT_ID, merchantId) || !matches(/^[A-Za-z0-9_-]{43}$/, apiV3Key) ||
        !Array.isArray(keys) || keys.some(entry => !entry || Object.keys(entry).length !== 2 ||
          typeof entry.id !== 'string' || typeof entry.key !== 'string')) fail(code);
    key = Buffer.from(apiV3Key, 'base64url');
    if (key.length !== 32 || key.toString('base64url') !== apiV3Key) fail(code);
    createWechatSignatureVerifier(keys);
    return {appId, merchantId, apiV3Key:key, keys};
  } catch {
    key?.fill(0);
    fail(code);
  } finally {
    bytes?.fill(0);
  }
}

async function loadWechatNativeWebsite(filename) {
  if (filename === undefined) return;
  const code = 'MANAGED_WECHAT_NATIVE_WEBSITE_NOT_READY';
  let bytes;
  try {
    if (Object.hasOwn(process.env, 'NODE_TLS_REJECT_UNAUTHORIZED') && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '1') fail(code);
    bytes = await readLocalFile(filename, 16 * 1024, code);
    const {schemaVersion, provider, certificateSerial, merchantPrivateKey, ...unknown} = parseProfile(bytes,code);
    if (schemaVersion !== 1 || provider !== 'wechat-pay-native-v3' || Object.keys(unknown).length !== 0 ||
        !matches(/^[A-Fa-f0-9]{1,64}$/,certificateSerial) || typeof merchantPrivateKey !== 'string') fail(code);
    const key = createPrivateKey(merchantPrivateKey);
    if (!isRsa2048Key(key,'private')) fail(code);
    return {certificateSerial,merchantPrivateKey:key};
  } catch {
    fail(code);
  } finally {
    bytes?.fill(0);
  }
}

function databaseReadinessOptions({ reviewedRecovery = false, wechatProfile }) {
  return { reviewedRecovery, wechatEnabled: wechatProfile !== undefined };
}

async function checkManagedDatabase(configuration, examine) {
  const { database, serverId } = configuration;
  const code = 'MANAGED_DATABASE_NOT_READY';
  let readonly;
  try {
    let entry;
    try {
      entry = await existingFile(database, code);
      readonly = new DatabaseSync(sqliteExistingFileUri(database, 'ro'), { readOnly: true, timeout: 5000 });
      assertManagedDatabaseReady(readonly, serverId, databaseReadinessOptions(configuration));
      if (configuration.wechatNativeCallbackProfile !== undefined) assertWechatNativeBillingReady(readonly);
      if (path.relative(path.toNamespacedPath(database), readonly.location()) || !sameFile(entry, await existingFile(database, code))) fail(code);
    } catch {
      fail(code);
    }
    examine?.(readonly);
    return entry;
  } finally {
    readonly?.close();
  }
}

async function openManagedDatabase(configuration) {
  const { database } = configuration;
  const code = 'MANAGED_DATABASE_NOT_READY';
  const entry = await checkManagedDatabase(configuration);
  let writable;
  try {
    writable = new DatabaseSync(sqliteExistingFileUri(database, 'rw'), { timeout: 5000 });
    if (path.relative(path.toNamespacedPath(database), writable.location()) || !sameFile(entry, await existingFile(database, code))) fail(code);
    return writable;
  } catch {
    writable?.close();
    fail(code);
  }
}

async function withManagedServiceInputs(filename, use) {
  const configuration = await loadManagedServiceConfiguration(filename);
  const { serverId, apiBase, listenPort: port, tlsCertificate, tlsKey, smsProfile, reviewedRecovery = false,
    wechatProfile, wechatNativeCallbackProfile, wechatNativeWebsiteProfile } = configuration;
  let key, smsProvider, wechatNativeCallback;
  try {
    smsProvider = await loadSmsProvider(smsProfile);
    const wechat = await loadWechatProvider(wechatProfile, apiBase);
    wechatNativeCallback = await loadWechatNativeCallback(wechatNativeCallbackProfile);
    const wechatNativeWebsite = await loadWechatNativeWebsite(wechatNativeWebsiteProfile);
    const cert = await readLocalFile(tlsCertificate, 128 * 1024, 'MANAGED_TLS_INVALID');
    key = await readLocalFile(tlsKey, 32 * 1024, 'MANAGED_TLS_INVALID');
    return await use(configuration, { apiBase, port, serverId, cert, key, ...smsProvider, reviewedRecovery, wechat,
      wechatNativeCallback, wechatNativeWebsite });
  } finally {
    key?.fill(0);
    smsProvider?.phonePepper.fill(0);
    wechatNativeCallback?.apiV3Key.fill(0);
  }
}

export function openConfiguredTeamService(filename) {
  return withManagedServiceInputs(filename, async (configuration, inputs) => {
    const { startManagedTeamServer } = await import('../server/team/managed-service.mjs');
    const db = await openManagedDatabase(configuration);
    try {
      const service = await startManagedTeamServer({ db, ...inputs });
      let stopping;
      return { address: service.address, apiBase: service.apiBase, serverId: inputs.serverId,
        close: () => stopping ??= service.close().finally(() => db.close()) };
    } catch (error) {
      db.close();
      throw error;
    }
  });
}

async function main(args) {
  if (args.length === 3 && args[0] === '--check-database' && args[1] === '--config') {
    await checkManagedDatabase(await loadManagedServiceConfiguration(args[2]));
    console.log(JSON.stringify({ event: 'database-ready' }));
    return;
  }
  const firstPilot = args[0] === '--check-pilot-readiness';
  if (args.length === 3 && (args[0] === '--check-startup' || firstPilot) && args[1] === '--config') {
    await withManagedServiceInputs(args[2], async (configuration, inputs) => {
      const { checkManagedServiceStartup } = await import('../server/team/managed-service.mjs');
      if (firstPilot) {
        const { assertManagedFirstPilotReady } = await import('../server/team/managed-first-pilot-readiness.mjs');
        await checkManagedDatabase(configuration, db => assertManagedFirstPilotReady(db, inputs));
      } else {
        await checkManagedDatabase(configuration);
      }
      checkManagedServiceStartup(inputs);
      if (inputs.wechatNativeWebsite) {
        const {checkWechatNativeWebsiteAssets} = await import('../server/team/wechat-native-website.mjs');
        try { await checkWechatNativeWebsiteAssets(); }
        catch { fail('MANAGED_WECHAT_NATIVE_WEBSITE_NOT_READY'); }
      }
    });
    console.log(JSON.stringify({ event: firstPilot ? 'pilot-ready' : 'startup-ready' }));
    return;
  }
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
