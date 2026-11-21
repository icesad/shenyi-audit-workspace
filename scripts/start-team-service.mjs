#!/usr/bin/env node
import { createHash, createPrivateKey, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { assertManagedDatabaseReady } from '../server/team/managed-database-readiness.mjs';
import { createAliyunSms } from '../server/team/aliyun-sms.mjs';
import { createWechatOpenPlatform } from '../server/team/wechat-open-platform.mjs';
import { assertWechatNativeBillingReady } from '../server/team/wechat-native-billing.mjs';
import { validateWechatNativeCatalog } from '../server/team/wechat-native-checkout-pricing.mjs';
import { APP_ID, MERCHANT_ID, createWechatSignatureVerifier, isRsa2048Key, matches, parsePaymentTime } from '../server/team/wechat-native-protocol.mjs';
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
  WECHAT_NATIVE_BILL_DATE_INVALID: '请选择已经结束的北京时间账单日。',
  WECHAT_NATIVE_REFUND_BILL_DATE_INVALID: '补充的退款交易账单日须早于资金记账日。',
  WECHAT_NATIVE_TRADE_BILL_INVALID: '无法核实微信交易账单的格式或范围。',
  WECHAT_NATIVE_FUND_BILL_INVALID: '无法核实微信基本账户资金账单的格式或汇总。',
  WECHAT_NATIVE_REFUND_ID_INVALID: '请核对商户退款单号。',
  WECHAT_NATIVE_REFUND_NOT_IN_SCOPE: '这笔退款缺少可与微信核对的本地原单或可信交易记录。',
  WECHAT_NATIVE_PROVIDER_UNAVAILABLE: '暂时无法核实微信支付账单或订单状态。',
  WECHAT_NATIVE_REPORT_UNAVAILABLE: '无法在指定的独立目录创建对账报告。',
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
  if (!stat.isFile() || stat.nlink !== 1n || stat.size < 1n) fail(code);
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
    const {schemaVersion, provider, certificateSerial, merchantPrivateKey, catalog, ...unknown} = parseProfile(bytes,code);
    if (schemaVersion !== 1 || provider !== 'wechat-pay-native-v3' || Object.keys(unknown).length !== 0 ||
        !matches(/^[A-Fa-f0-9]{1,64}$/,certificateSerial) || typeof merchantPrivateKey !== 'string') fail(code);
    const key = createPrivateKey(merchantPrivateKey);
    if (!isRsa2048Key(key,'private')) fail(code);
    return {certificateSerial,merchantPrivateKey:key,catalog:validateWechatNativeCatalog(catalog)};
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

async function reportDestination(output) {
  const code = 'WECHAT_NATIVE_REPORT_UNAVAILABLE';
  try {
    const filename = localPath(output), directory = path.dirname(filename);
    const before = await fs.lstat(directory, {bigint:true});
    if (inside(checkout, filename) || path.extname(filename)!=='.json' || !before.isDirectory()) fail(code);
    try {
      await fs.lstat(filename);
      fail(code);
    } catch (error) {
      if (error.code!=='ENOENT') throw error;
    }
    return {filename,directory,before};
  } catch {
    fail(code);
  }
}

async function publishNativeReport({filename,directory,before}, report) {
  const code = 'WECHAT_NATIVE_REPORT_UNAVAILABLE';
  const temp = path.join(directory,'.shenyi-native-'+randomUUID()+'.tmp');
  let created = false;
  try {
    if (!sameFile(before,await fs.lstat(directory,{bigint:true}))) fail(code);
    const handle = await fs.open(temp,'wx',0o600);
    created = true;
    try {
      await handle.writeFile(JSON.stringify(report,null,2)+'\n','utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!sameFile(before,await fs.lstat(directory,{bigint:true}))) fail(code);
    // Publishing a hard link makes the complete report visible atomically without overwriting an existing report.
    await fs.link(temp,filename);
  } catch {
    fail(code);
  } finally {
    if (created) await fs.unlink(temp).catch(()=>{});
  }
}

function beijingBillDay(date) {
  return matches(/^\d{4}-\d{2}-\d{2}$/,date) ? parsePaymentTime(date+'T00:00:00+08:00') : null;
}

export async function reconcileConfiguredWechatNativeBill({
  filename,billDate,output,merchantRefundId,includeBasicFunds=false,refundTradeDate,
}, {fetchImpl,now=Date.now} = {}) {
  const day = beijingBillDay(billDate);
  if (day === null || day+86_400_000>now()) fail('WECHAT_NATIVE_BILL_DATE_INVALID');
  if (typeof includeBasicFunds!=='boolean' || (includeBasicFunds && merchantRefundId!==undefined)) fail(configCode);
  if (refundTradeDate!==undefined) {
    const refundDay = beijingBillDay(refundTradeDate);
    if (!includeBasicFunds || refundDay===null || refundDay>=day) fail('WECHAT_NATIVE_REFUND_BILL_DATE_INVALID');
  }
  const destination = await reportDestination(output);
  const configuration = await loadManagedServiceConfiguration(filename);
  if (!configuration.wechatNativeCallbackProfile || !configuration.wechatNativeWebsiteProfile) {
    fail('MANAGED_WECHAT_NATIVE_WEBSITE_NOT_READY');
  }
  let callback, statement, fundsStatement, earlierStatement;
  try {
    const [{createWechatNativeOrders},{parseWechatNativeTradeBill,MERCHANT_REFUND_ID},
      {reconcileWechatNativeTradeBill,selectWechatNativeRefundQuery},{WECHAT_NATIVE_NOTIFY_PATH}] = await Promise.all([
      import('../server/team/wechat-native-orders.mjs'),
      import('../server/team/wechat-native-trade-bill-parser.mjs'),
      import('../server/team/wechat-native-reconciliation.mjs'),
      import('../server/team/wechat-native-callback.mjs'),
    ]);
    if (merchantRefundId!==undefined && (!matches(MERCHANT_REFUND_ID,merchantRefundId) || merchantRefundId==='0')) {
      fail('WECHAT_NATIVE_REFUND_ID_INVALID');
    }
    const initial = await checkManagedDatabase(configuration);
    callback = await loadWechatNativeCallback(configuration.wechatNativeCallbackProfile);
    const {certificateSerial,merchantPrivateKey} = await loadWechatNativeWebsite(configuration.wechatNativeWebsiteProfile);
    const {merchantId,appId,keys} = callback;
    const provider = createWechatNativeOrders({merchantId,appId,keys,certificateSerial,merchantPrivateKey,fetchImpl,now,
      notifyUrl:configuration.apiBase+WECHAT_NATIVE_NOTIFY_PATH});
    statement = await provider.downloadTradeBill(billDate);
    const {rows,summary} = parseWechatNativeTradeBill(statement.bytes,{billDate,merchantId});
    let basicFunds;
    if (includeBasicFunds) {
      const {parseWechatNativeFundBill} = await import('../server/team/wechat-native-fund-bill-parser.mjs');
      fundsStatement = await provider.downloadBasicFundBill(billDate);
      basicFunds = {...parseWechatNativeFundBill(fundsStatement.bytes,{billDate}),sha1:fundsStatement.sha1,
        sha256:createHash('sha256').update(fundsStatement.bytes).digest('hex')};
    }
    let refundTrade;
    if (refundTradeDate!==undefined) {
      earlierStatement = await provider.downloadTradeBill(refundTradeDate);
      refundTrade = {...parseWechatNativeTradeBill(earlierStatement.bytes,{billDate:refundTradeDate,merchantId}),
        billDate:refundTradeDate,sha1:earlierStatement.sha1,sha256:createHash('sha256').update(earlierStatement.bytes).digest('hex')};
    }
    let report;
    const consulted = await checkManagedDatabase(configuration, db => {
      report = reconcileWechatNativeTradeBill(db,{billDate,merchantId,appId,sha1:statement.sha1,rows,summary,basicFunds,refundTrade});
    });
    if (!sameFile(initial,consulted)) fail('MANAGED_DATABASE_NOT_READY');
    const result = {event:'native-bill-reconciled',billDate,counts:report.counts};
    if (report.basicFunds) {
      const {linkedRows,unlinkedRows} = report.basicFunds;
      result.basicFunds = {linkedRows,unlinkedRows};
    }
    if (merchantRefundId!==undefined) {
      const {statementStatus,...query} = selectWechatNativeRefundQuery(report,rows,merchantRefundId);
      const unverified = {merchantRefundId,outcome:'unverified'};
      try {
        const refund = await provider.queryRefund(query);
        // A completed refund is terminal. Other bill statuses may precede a different current status.
        report.refundVerification = statementStatus==='SUCCESS' && refund.status!=='SUCCESS'
          ? {...unverified,reason:'status_conflict'}
          : {merchantRefundId,outcome:'verified',...refund};
      } catch (error) {
        if (error.code!=='WECHAT_NATIVE_PROVIDER_UNAVAILABLE') throw error;
        report.refundVerification = unverified;
      }
      const code = 'MANAGED_DATABASE_NOT_READY';
      const current = await existingFile(configuration.database,code).catch(()=>fail(code));
      if (!sameFile(consulted,current)) fail(code);
      result.refundVerification = report.refundVerification.outcome;
      if (result.refundVerification==='verified') result.refundStatus = report.refundVerification.status;
    }
    await publishNativeReport(destination,{...report,createdAt:new Date(now()).toISOString(),serverId:configuration.serverId,operatorAccount:userInfo().username,
      statementSha256:createHash('sha256').update(statement.bytes).digest('hex')});
    return result;
  } finally {
    callback?.apiV3Key.fill(0);
    statement?.bytes.fill(0);
    fundsStatement?.bytes.fill(0);
    earlierStatement?.bytes.fill(0);
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
  const hasRefund = args.length === 8 && args[6] === '--verify-refund';
  const hasRefundTradeDate = args.length === 9 && args[7] === '--refund-trade-date';
  const includeBasicFunds = args[6] === '--verify-basic-funds' && (args.length === 7 || hasRefundTradeDate);
  if ((args.length === 6 || hasRefund || includeBasicFunds) && args[0] === '--reconcile-native-bill' &&
      args[2] === '--config' && args[4] === '--output') {
    const result = await reconcileConfiguredWechatNativeBill({
      billDate:args[1],filename:args[3],output:args[5],merchantRefundId:hasRefund?args[7]:undefined,includeBasicFunds,
      refundTradeDate:hasRefundTradeDate?args[8]:undefined,
    });
    if (result.refundVerification==='unverified') process.exitCode = 2;
    console.log(JSON.stringify(result));
    return;
  }
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
