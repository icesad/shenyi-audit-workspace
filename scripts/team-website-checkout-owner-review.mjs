#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdir, open, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import configuration from '../desktop/isolated-preview-config.cjs';
import {initializeTeamDatabase, seedDemoTeamData} from '../server/team/database.mjs';
import {transaction} from '../server/team/http-utils.mjs';
import {hashPassword} from '../server/team/passwords.mjs';
import {addBeijingCalendarYear} from '../server/team/renewal-calendar.mjs';
import {recordSeatCapacityGrantWithinTransaction} from '../server/team/seat-capacity-store.mjs';
import {appendSubscriptionTermWithinTransaction} from '../server/team/subscription-store.mjs';
import {createOwnerReviewCheckoutCertificate} from './owner-review-checkout-certificate.mjs';
import {BILLING_PREVIEW_ADMIN, BILLING_PREVIEW_PASSWORD} from './team-billing-preview-fixture.mjs';
import {assertNode24, candidateChildEnvironment} from './team-isolated-preview.mjs';
import {startWebsiteCheckoutPreview} from './website-checkout-preview.mjs';

const DAY = 24 * 60 * 60 * 1000;
const TEAM = 'team-a';
const {loadOwnerReviewRuntime, prepareIsolatedPreviewDirectory} = configuration;
const writeNew = (file, value) => writeFile(file,value,{flag:'wx',mode:0o600});
const record = (directory, file, value) => writeNew(path.join(directory,file),JSON.stringify(value,null,2)+'\n');

async function seedCheckout(db, at) {
  await seedDemoTeamData(db);
  const hash = await hashPassword(BILLING_PREVIEW_PASSWORD);
  const termEndsAt = at + (addBeijingCalendarYear(at)-at)/2;
  transaction(db,() => {
    db.prepare("INSERT INTO team_database_metadata(name,value) VALUES ('website-checkout-demo','true')").run();
    db.prepare("INSERT INTO team_users VALUES (?,'active')").run(BILLING_PREVIEW_ADMIN);
    db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)')
      .run(BILLING_PREVIEW_ADMIN,BILLING_PREVIEW_ADMIN,'合成账务管理员',hash);
    db.prepare("INSERT INTO team_operators VALUES (?,?,'administrator','active')").run(TEAM,BILLING_PREVIEW_ADMIN);
    appendSubscriptionTermWithinTransaction(db,{teamId:TEAM,operationId:randomUUID(),expectedRevision:0,
      startsAt:at-DAY,endsAt:termEndsAt,sourceRef:'owner-review-website-checkout'},{now:()=>at});
    recordSeatCapacityGrantWithinTransaction(db,{teamId:TEAM,grantId:randomUUID(),seats:8,
      startsAt:at-DAY,endsAt:termEndsAt,sourceRef:'owner-review-website-checkout'},{now:()=>at});
  });
}

/** Create one portable Windows review run with its own DB, device store and ephemeral TLS identities. */
export async function createOwnerReviewWebsiteCheckout({appRoot,now=Date.now}={}) {
  assertNode24();
  const portable = await loadOwnerReviewRuntime({appRoot});
  if (!portable) throw new Error('请在完整的 Windows 双人评审包内双击官网下单演练入口。');
  const prepared = await prepareIsolatedPreviewDirectory({appRoot:portable.appRoot});
  const {directory,candidateId,desktopDataDirectory,deviceVaultDirectory} = prepared;
  const configFile = path.join(directory,'checkout-service.json');
  const certificateFile = path.join(directory,'checkout-tls.pem');
  const caFile = path.join(directory,'checkout-ca.pem');
  const storefrontCertificateFile = path.join(directory,'storefront-tls.pem');
  const storefrontCaFile = path.join(directory,'storefront-ca.pem');
  let db, service;
  try {
    await mkdir(desktopDataDirectory,{mode:0o700});
    db = new DatabaseSync(path.join(directory,'team-demo.sqlite'));
    initializeTeamDatabase(db);
    await seedCheckout(db,now());
    const {cert,ca,key,fingerprint256,expiresAt} = createOwnerReviewCheckoutCertificate({now});
    const storefront = createOwnerReviewCheckoutCertificate({now});
    await writeNew(certificateFile,cert);
    await writeNew(caFile,ca);
    await writeNew(storefrontCertificateFile,storefront.cert);
    await writeNew(storefrontCaFile,storefront.ca);
    service = await startWebsiteCheckoutPreview({db,key,cert,checkoutTLS:{key:storefront.key,cert:storefront.cert},now,billingSimulation:{
      mode:'simulation-v1',merchantId:'owner-review-checkout',signingKey:randomBytes(32),
      offers:[{id:'annual-demo',revision:1,product:'team-annual-renewal',amountMinor:128_000,currency:'CNY'}],
      annualSeatUnitAmountMinor:20_000,
      seatOffer:{id:'seat-demo',revision:1,annualUnitAmountMinor:20_000,currency:'CNY'},
    }});
    const {profile,server,address,checkoutAddress} = service;
    await writeNew(configFile,JSON.stringify(profile)+'\n');
    await record(directory,'started.json',{schemaVersion:1,kind:'shenyi-owner-review-website-checkout',
      candidateId,directory,desktopDataDirectory,deviceVaultDirectory,apiBase:profile.apiBase,serverId:profile.serverId,
      checkoutOrigin:profile.checkoutOrigin,tlsFingerprint256:fingerprint256,tlsExpiresAt:expiresAt,
      checkoutTlsFingerprint256:storefront.fingerprint256,launcherPid:process.pid,startedAt:new Date().toISOString()});
    let closing;
    const close = () => closing ??= (async() => {
      try { await service.close(); } finally { db.close(); }
      await record(directory,'closed.json',{schemaVersion:1,candidateId,closedAt:new Date().toISOString()});
    })();
    return Object.freeze({directory,candidateId,desktopDataDirectory,deviceVaultDirectory,configFile,certificateFile,caFile,
      storefrontCertificateFile,storefrontCaFile,profile,server,address,checkoutAddress,close});
  } catch (error) {
    try { await service?.close(); } finally { db?.close(); }
    await record(directory,'startup-failed.json',{schemaVersion:1,candidateId,code:'CHECKOUT_STARTUP_FAILED',
      failedAt:new Date().toISOString()});
    throw error;
  }
}

async function launch() {
  const portable = await loadOwnerReviewRuntime();
  if (!portable) throw new Error('请在完整的 Windows 双人评审包内双击官网下单演练入口。');
  const run = await createOwnerReviewWebsiteCheckout();
  let log;
  try {
    log = await open(path.join(run.directory,'desktop-process.log'),'wx',0o600);
    const env = candidateChildEnvironment({context:run});
    delete env.SHENYI_ISOLATED_PREVIEW_CONFIG;
    Object.assign(env,{SHENYI_OWNER_REVIEW_WEBSITE_CHECKOUT:'1',SHENYI_TEAM_SERVICE_CONFIG:run.configFile,
      NODE_EXTRA_CA_CERTS:run.caFile});
    const child = spawn(portable.electronExecutable,[path.join(portable.appRoot,'desktop'),'--user-data-dir='+run.desktopDataDirectory],
      {cwd:portable.appRoot,windowsHide:false,stdio:['ignore',log.fd,log.fd],env});
    const stop = () => { if (child.exitCode === null) child.kill(); };
    process.once('SIGINT',stop);
    process.once('SIGTERM',stop);
    console.log('审易 · 官网下单演练。请使用演练账号登录并绑定当前电脑。');
    console.log('合成账号 '+BILLING_PREVIEW_ADMIN+'，合成密码 '+BILLING_PREVIEW_PASSWORD+'。');
    console.log('本机地址 '+run.address.url+'，本次演练记录 '+run.directory);
    console.log('官网演练地址 '+run.checkoutAddress.url);
    console.log('打开「订阅与席位」走查官网年费和增购。本次演练无收款，关闭桌面窗口即停止服务。');
    let failed = false;
    child.once('error',()=>{failed=true;});
    const code = await new Promise(resolve=>child.once('close',resolve));
    process.removeListener('SIGINT',stop);
    process.removeListener('SIGTERM',stop);
    if (failed || code !== 0) throw new Error('官网下单演练的桌面程序未正常退出。请查看本次日志。');
  } finally {
    try { await log?.close(); } finally { await run.close(); }
  }
}

if (process.argv[1] && path.relative(path.resolve(process.argv[1]),fileURLToPath(import.meta.url))==='') {
  if (process.argv.length !== 2) {
    console.error('官网下单演练入口不接收参数。');
    process.exitCode = 1;
  } else launch().catch(error=>{
    console.error(error.message);
    process.exitCode = 1;
  });
}
