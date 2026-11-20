'use strict';

const assert = require('node:assert/strict');
const {createHash, generateKeyPairSync, randomBytes, randomUUID, sign} = require('node:crypto');
const {mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {test} = require('node:test');
const {childEnvironment, command, generateCertificates} = require('./helpers/trusted-team-https-fixture.cjs');

const project = path.resolve(__dirname, '..');
const startScript = path.join(project, 'scripts', 'start-team-service.mjs');
const dependencies = Promise.all([
  import('../server/team/database.mjs'),
  import('../server/team/wechat-native-billing.mjs'),
  import('../scripts/start-team-service.mjs'),
]);
const providerKeys = generateKeyPairSync('rsa', {modulusLength:2048});
const merchantKeys = generateKeyPairSync('rsa', {modulusLength:2048});
const apiV3Key = randomBytes(32).toString('base64url');
const provider = 'wechat-pay-native-v3';
const appId = 'wxsynthetic12345';
const merchantId = '1000000000';
const providerKeyId = 'PUB_KEY_ID_120';
const billDate = '2024-02-29';
const at = Date.parse('2024-03-01T00:00:00+08:00');
const paidAt = Date.parse('2024-02-29T12:30:01+08:00');
const applicantUrl = 'https://api.mch.weixin.qq.com/v3/bill/tradebill?bill_date=' + billDate + '&bill_type=ALL';
const downloadUrl = 'https://api.mch.weixin.qq.com/v3/bill/downloadurl?token=synthetic-proof%2B';
const openId = 'synthetic-OpenID-must-be-omitted';
const description = '隔离合成商品,附加说明';
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

function statement(orderId, transactionId) {
  const header = [
    '交易时间','公众账号ID','商户号','特约商户号','设备号','微信订单号','商户订单号','用户标识','交易类型','交易状态',
    '付款银行','货币种类','应结订单金额','代金券金额','微信退款单号','商户退款单号','退款金额','充值券退款金额',
    '退款类型','退款状态','商品名称','商户数据包','手续费','费率','订单金额','申请退款金额','费率备注',
  ].join(',');
  const detail = [billDate + ' 12:30:01', appId, merchantId, '0', 'synthetic-device', transactionId, orderId, openId,
    'NATIVE', 'SUCCESS', 'OTHERS', 'CNY', '1.01', '0.08', '0', '0', '0.00', '0.00', '', '',
    description, 'operator-reference', '0.01', '0.60%', '1.09', '0.00', 'synthetic note'];
  const totalsHeader = '总交易单数,应结订单总金额,退款总金额,充值券退款总金额,手续费总金额,订单总金额,申请退款总金额';
  const totals = ['1', '1.01', '0.00', '0.00', '0.01', '1.09', '0.00'];
  const marked = fields => '`' + fields.join(',`');
  return Buffer.from(['\ufeff' + header, marked(detail), totalsHeader, marked(totals), ''].join('\r\n'));
}

function signedDescriptor(bytes, now, sha1 = digest('sha1', bytes)) {
  const raw = Buffer.from(' ' + JSON.stringify({hash_type:'SHA1', hash_value:sha1.toUpperCase(), download_url:downloadUrl}) + '\n');
  const nonce = randomBytes(16).toString('hex');
  const timestamp = String(Math.floor(now / 1000));
  const material = Buffer.concat([Buffer.from(timestamp + '\n' + nonce + '\n'), raw, Buffer.from('\n')]);
  return {raw, headers:{
    'content-type':'application/json', 'wechatpay-serial':providerKeyId, 'wechatpay-timestamp':timestamp, 'wechatpay-nonce':nonce,
    'wechatpay-signature':sign('RSA-SHA256', material, providerKeys.privateKey).toString('base64'),
  }};
}

async function fixture(t) {
  const [{initializeTeamDatabase}, {installWechatNativeBillingSchema}, {reconcileConfiguredWechatNativeBill}] = await dependencies;
  const writable = path.resolve(process.env.SHENYI_TEST_TMPDIR ?? tmpdir());
  await mkdir(writable, {recursive:true});
  const parent = await realpath(writable);
  const directory = await mkdtemp(path.join(parent, 'shenyi-native-reconciliation-cli-'));
  assert.equal(path.dirname(path.resolve(directory)), parent);
  assert.match(path.basename(directory), /^shenyi-native-reconciliation-cli-/);
  t.after(() => rm(directory, {recursive:true}));
  const database = path.join(directory, 'managed.sqlite');
  const filename = path.join(directory, 'managed.json');
  const callback = path.join(directory, 'callback-private.json');
  const checkout = path.join(directory, 'checkout-private.json');
  const certDirectory = path.join(directory, 'certificates');
  const orderId = randomUUID();
  const merchantOrderId = orderId.replaceAll('-', '');
  const requestId = randomUUID();
  const transactionId = randomBytes(12).toString('hex');
  let serverId;
  const db = new DatabaseSync(database);
  try {
    initializeTeamDatabase(db);
    installWechatNativeBillingSchema(db);
    serverId = db.prepare("SELECT value FROM main.team_database_metadata WHERE name='device-server-id'").get().value;
    db.exec(`
      INSERT INTO main.teams VALUES ('cli-team','active');
      INSERT INTO main.team_users VALUES ('cli-admin','active');
      INSERT INTO main.team_operators VALUES ('cli-team','cli-admin','administrator','active');
    `);
    db.prepare(`INSERT INTO main.team_billing_wechat_native_orders
      (order_id,team_id,actor_id,request_id,app_id,merchant_id,product,description,offer_id,offer_revision,seats,term_revision,
        amount_minor,currency,created_at,expires_at)
      VALUES (?,'cli-team','cli-admin',?,?,?,'team-annual-renewal','合成年度订单','synthetic-annual',1,3,NULL,109,'CNY',?,?)`)
      .run(orderId, requestId, appId, merchantId, paidAt - 60000, paidAt + 60000);
    db.prepare(`INSERT INTO main.team_billing_wechat_native_payments(order_id,merchant_id,transaction_id,paid_at,first_verified_at)
      VALUES (?,?,?,?,?)`).run(orderId, merchantId, transactionId, paidAt + 120, paidAt + 1000);
    db.prepare('INSERT INTO main.team_billing_wechat_native_query_confirmations(order_id,verified_at) VALUES (?,?)')
      .run(orderId, paidAt + 1000);
  } finally { db.close(); }
  await generateCertificates(certDirectory);
  const config = {schemaVersion:1, database, apiBase:'https://wrong.invalid', serverId, listenPort:0,
    tlsCertificate:path.join(certDirectory, 'wrong-host.pem'), tlsKey:path.join(certDirectory, 'wrong-host.key'),
    wechatNativeCallbackProfile:callback, wechatNativeWebsiteProfile:checkout};
  const notifyProfile = {schemaVersion:1, provider, appId, merchantId, apiV3Key,
    keys:[{id:providerKeyId, key:providerKeys.publicKey.export({type:'spki', format:'pem'})}]};
  const websiteProfile = {schemaVersion:1, provider, certificateSerial:'AB'.repeat(20),
    merchantPrivateKey:merchantKeys.privateKey.export({type:'pkcs8', format:'pem'})};
  await Promise.all([
    writeFile(filename, JSON.stringify(config), {mode:0o600}),
    writeFile(callback, JSON.stringify(notifyProfile), {mode:0o600}),
    writeFile(checkout, JSON.stringify(websiteProfile), {mode:0o600}),
  ]);
  const originalDb = await readFile(database);
  const rawBill = statement(merchantOrderId, transactionId);
  const calls = [];
  function mockProvider({bytes = rawBill, sha1} = {}) {
    const descriptor = signedDescriptor(rawBill, at, sha1);
    return async (url, init) => {
      calls.push(url);
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.match(init.headers.Authorization, /^WECHATPAY2-SHA256-RSA2048 /);
      if (url === applicantUrl) return new Response(descriptor.raw, {headers:descriptor.headers});
      assert.equal(url, downloadUrl);
      return new Response(bytes);
    };
  }
  return {
    directory, filename, serverId, merchantOrderId, transactionId, rawBill, calls, mockProvider,
    run:(output, options = {}) => reconcileConfiguredWechatNativeBill({filename, output, billDate:options.billDate ?? billDate},
      {fetchImpl:options.fetchImpl ?? mockProvider(), now:() => at}),
    async assertUnchanged() { assert.deepEqual(await readFile(database), originalDb); },
  };
}

async function assertReport(f, output, createdAt) {
  const text = await readFile(output, 'utf8');
  const report = JSON.parse(text);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.billDate, billDate);
  assert.equal(report.createdAt, createdAt);
  assert.equal(report.serverId, f.serverId);
  assert.equal(report.merchantId, merchantId);
  assert.equal(report.appId, appId);
  assert.equal(report.statementSha1, digest('sha1', f.rawBill));
  assert.equal(report.statementSha256, digest('sha256', f.rawBill));
  assert.equal(report.counts.statementRows, 1);
  assert.equal(report.counts.matchedPayments, 1);
  assert.equal(report.orders.length, 1);
  const [entry] = report.orders;
  assert.equal(entry.merchantOrderId, f.merchantOrderId);
  assert.equal(entry.local.amountMinor, 109);
  assert.equal(entry.local.paidAt, paidAt + 120);
  assert.equal(entry.local.transactionId, f.transactionId);
  assert.deepEqual(entry.findings, ['ENTITLEMENT_PENDING']);
  assert.equal(entry.statementPayments[0].amountMinor, 109);
  for (const secret of [openId, apiV3Key, description, 'operator-reference', 'synthetic-proof']) {
    assert.equal(text.includes(secret), false, 'A private profile or excluded bill field appeared in the report');
  }
  assert.doesNotMatch(text, /BEGIN (?:RSA )?PRIVATE KEY/);
  const file = await stat(output);
  assert.equal(file.isFile(), true);
  assert.equal(file.nlink, 1);
  if (process.platform !== 'win32') assert.equal(file.mode & 0o777, 0o600);
  await f.assertUnchanged();
  return report;
}

test('the configured pipeline reconciles the signed ALL bill into a private report without touching SQLite', async t => {
  const f = await fixture(t);
  const output = path.join(f.directory, 'reconciliation.json');
  const result = await f.run(output);
  assert.deepEqual(f.calls, [applicantUrl, downloadUrl]);
  const report = await assertReport(f, output, new Date(at).toISOString());
  assert.deepEqual(result, {event:'native-bill-reconciled', billDate, counts:report.counts});
  assert.ok(!(await readdir(f.directory)).some(name => name.endsWith('.tmp')));
});

test('today and unsafe or preexisting destinations fail before bill download', async t => {
  const f = await fixture(t);
  const output = path.join(f.directory, 'existing.json');
  const input = 'Existing test report';
  await writeFile(output, input);
  const noNetwork = async url => {
    f.calls.push(url);
    throw new Error('Unexpected synthetic provider request');
  };
  const newOutput = path.join(f.directory, 'today.json');
  await assert.rejects(f.run(newOutput, {billDate:'2024-03-01', fetchImpl:noNetwork}), {code:'WECHAT_NATIVE_BILL_DATE_INVALID'});
  await assert.rejects(stat(newOutput), {code:'ENOENT'});
  const checkoutOutput = path.join(project, 'private-test-' + randomUUID() + '.json');
  for (const target of [output, checkoutOutput, 'relative-report.json']) {
    await assert.rejects(f.run(target, {fetchImpl:noNetwork}), {code:'WECHAT_NATIVE_REPORT_UNAVAILABLE'});
  }
  assert.deepEqual(f.calls, []);
  assert.equal(await readFile(output, 'utf8'), input);
  await assert.rejects(stat(checkoutOutput), {code:'ENOENT'});
  await f.assertUnchanged();
});

test('an authenticated descriptor with a digest mismatch leaves no report or temporary report file', async t => {
  const f = await fixture(t);
  const output = path.join(f.directory, 'corrupt.json');
  const tampered = Buffer.concat([f.rawBill, Buffer.from('tampered bytes')]);
  await assert.rejects(f.run(output, {fetchImpl:f.mockProvider({bytes:tampered})}), {code:'WECHAT_NATIVE_PROVIDER_UNAVAILABLE'});
  assert.deepEqual(f.calls, [applicantUrl, downloadUrl]);
  await assert.rejects(stat(output), {code:'ENOENT'});
  assert.ok(!(await readdir(f.directory)).some(name => name.endsWith('.tmp')));
  await f.assertUnchanged();
});

test('the actual CLI order writes the reconciled report and emits only the summary event', async t => {
  const f = await fixture(t);
  const output = path.join(f.directory, 'command.json');
  const descriptor = signedDescriptor(f.rawBill, Date.now());
  // Replace fetch in the isolated child before loading the production CLI. Every URL stays synthetic.
  const guard = 'globalThis.fetch=async(url)=>{' +
    'if(url===' + JSON.stringify(applicantUrl) + ')return new Response(Buffer.from(' + JSON.stringify(descriptor.raw.toString('base64')) +
    ',"base64"),{headers:' + JSON.stringify(descriptor.headers) + '});' +
    'if(url===' + JSON.stringify(downloadUrl) + ')return new Response(Buffer.from(' + JSON.stringify(f.rawBill.toString('base64')) +
    ',"base64"));throw new Error("Invalid synthetic CLI route");};';
  const preload = 'data:text/javascript,' + encodeURIComponent(guard);
  const result = await command(process.execPath,
    ['--import', preload, startScript, '--reconcile-native-bill', billDate, '--config', f.filename, '--output', output],
    {cwd:f.directory, env:childEnvironment()});
  assert.equal(result.code, 0, result.stderr);
  const published = JSON.parse(await readFile(output, 'utf8'));
  assert.ok(Number.isFinite(Date.parse(published.createdAt)));
  const report = await assertReport(f, output, published.createdAt);
  assert.deepEqual(JSON.parse(result.stdout), {event:'native-bill-reconciled', billDate, counts:report.counts});
  assert.ok(!result.stdout.includes(f.merchantOrderId));
  assert.ok(!result.stdout.includes(output));
});
