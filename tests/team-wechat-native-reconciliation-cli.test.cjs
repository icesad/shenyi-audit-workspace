'use strict';

const assert = require('node:assert/strict');
const {createHash, generateKeyPairSync, randomBytes, randomUUID, sign, verify} = require('node:crypto');
const {copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile} = require('node:fs/promises');
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
const fundsApplicant = 'https://api.mch.weixin.qq.com/v3/bill/fundflowbill?bill_date=' + billDate + '&account_type=BASIC';
const fundsDownload = 'https://api.mch.weixin.qq.com/v3/billdownload/file?token=synthetic-funds%2B';
const merchantRefundId = 'audit-refund@20240229';
const refundId = '5000000000202402290000000031';
const refundUrl = 'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds/audit-refund%4020240229';
const refundCreatedAt = '2024-02-29T13:40:05+08:00';
const refundSucceededAt = '2024-02-29T16:19:50+08:00';
const refundAccount = 'synthetic-receiving-account-must-be-omitted';
const promotionId = 'synthetic-refund-promotion-must-be-omitted';
const openId = 'synthetic-OpenID-must-be-omitted';
const description = '隔离合成商品,附加说明';
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

function yuan(cents) {
  const absolute = Math.abs(cents);
  return (cents < 0 ? '-' : '') + Math.floor(absolute / 100) + '.' + String(absolute % 100).padStart(2, '0');
}

function statement(orderId, transactionId, refunds = []) {
  const header = [
    '交易时间','公众账号ID','商户号','特约商户号','设备号','微信订单号','商户订单号','用户标识','交易类型','交易状态',
    '付款银行','货币种类','应结订单金额','代金券金额','微信退款单号','商户退款单号','退款金额','充值券退款金额',
    '退款类型','退款状态','商品名称','商户数据包','手续费','费率','订单金额','申请退款金额','费率备注',
  ].join(',');
  const detail = [billDate + ' 12:30:01', appId, merchantId, '0', 'synthetic-device', transactionId, orderId, openId,
    'NATIVE', 'SUCCESS', 'OTHERS', 'CNY', '1.01', '0.08', '0', '0', '0.00', '0.00', '', '',
    description, 'operator-reference', '0.01', '0.60%', '1.09', '0.00', 'synthetic note'];
  const totalsHeader = '总交易单数,应结订单总金额,退款总金额,充值券退款总金额,手续费总金额,订单总金额,申请退款总金额';
  const marked = fields => '`' + fields.join(',`');
  let settled = 0;
  let gross = 0;
  const refundRows = refunds.map(spec => {
    const amount = spec.amount ?? 50;
    const settlement = Math.max(0, amount - 4);
    settled += settlement;
    gross += amount;
    return marked([spec.time ?? billDate + ' 13:40:05', spec.appId ?? appId, merchantId, '0', 'synthetic-device',
      spec.transactionId ?? transactionId, spec.merchantOrderId ?? orderId, openId, spec.tradeType ?? 'NATIVE', 'REFUND',
      'OTHERS', spec.currency ?? 'CNY', '0.00', '0.00', spec.refundId ?? refundId, spec.merchantRefundId ?? merchantRefundId,
      yuan(settlement), '0.00', 'ORIGINAL', spec.status ?? 'PROCESSING', description, 'operator-reference', '-0.01', '0.60%',
      '0.00', yuan(amount), 'synthetic note']);
  });
  const totals = [String(1 + refunds.length), '1.01', yuan(settled), '0.00', yuan(1 - refunds.length), '1.09', yuan(gross)];
  return Buffer.from(['\ufeff' + header, marked(detail), ...refundRows, totalsHeader, marked(totals), ''].join('\r\n'));
}

function basicStatement(rows) {
  const header = '记账时间,微信支付业务单号,资金流水单号,业务名称,业务类型,收支类型,收支金额(元),账户结余(元),资金变更提交申请人,备注,业务凭证号';
  const summary = '资金流水总笔数,收入笔数,收入金额,支出笔数,支出金额';
  const count = {收入:0,支出:0}, total = {收入:0,支出:0};
  const marked = columns => '`' + columns.join(',`');
  const data = rows.map(([clock,businessId,flowId,name,type,direction,amount,reference]) => {
    count[direction]++;
    total[direction] += amount;
    return marked([billDate+' '+clock,businessId,flowId,name,type,direction,yuan(amount),'200.00','private-applicant',
      'private-note, keep it in the provider file',reference]);
  });
  return Buffer.from([header,...data,summary,marked([rows.length,count.收入,yuan(total.收入),count.支出,yuan(total.支出)]),''].join('\n'));
}

function signedDescriptor(bytes, now, sha1 = digest('sha1', bytes), downloadAddress = downloadUrl) {
  return signedResponse({hash_type:'SHA1', hash_value:sha1.toUpperCase(), download_url:downloadAddress}, now);
}

function signedResponse(body, now, key = providerKeys.privateKey) {
  const raw = Buffer.from(' ' + JSON.stringify(body) + '\n');
  const nonce = randomBytes(16).toString('hex');
  const timestamp = String(Math.floor(now / 1000));
  const material = Buffer.concat([Buffer.from(timestamp + '\n' + nonce + '\n'), raw, Buffer.from('\n')]);
  return {raw, headers:{
    'content-type':'application/json', 'wechatpay-serial':providerKeyId, 'wechatpay-timestamp':timestamp, 'wechatpay-nonce':nonce,
    'wechatpay-signature':sign('RSA-SHA256', material, key).toString('base64'),
  }};
}

function refundBody(f, alterations = {}) {
  return {
    refund_id:refundId, out_refund_no:merchantRefundId, transaction_id:f.transactionId, out_trade_no:f.merchantOrderId,
    channel:'ORIGINAL', user_received_account:refundAccount, create_time:refundCreatedAt, success_time:refundSucceededAt,
    status:'SUCCESS', funds_account:'UNSETTLED', amount:{total:109, refund:50, payer_total:101, payer_refund:46,
      settlement_refund:46, settlement_total:101, discount_refund:4, currency:'CNY'},
    promotion_detail:[{promotion_id:promotionId, scope:'GLOBAL', type:'NOCASH', amount:8, refund_amount:4}],
    ...alterations,
  };
}

function assertRefundRequest(url, init) {
  assert.equal(init.headers.Accept, 'application/json');
  assert.equal(init.headers['Wechatpay-Serial'], providerKeyId);
  assert.equal(init.body, undefined);
  const signed = Object.fromEntries([...init.headers.Authorization.matchAll(/([a-z_]+)="([^"]+)"/g)]
    .map(([, name, value]) => [name, value]));
  assert.equal(signed.mchid, merchantId);
  assert.equal(signed.serial_no, 'AB'.repeat(20));
  const payload = Buffer.from(`GET\n${new URL(url).pathname}\n${signed.timestamp}\n${signed.nonce_str}\n\n`);
  assert.ok(verify('RSA-SHA256', payload, merchantKeys.publicKey, Buffer.from(signed.signature, 'base64')));
}

async function fixture(t, {withReceipt = true, includeOtherApp = false} = {}) {
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
  const otherOrderId = randomUUID(), otherTransactionId = randomBytes(12).toString('hex');
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
    const insertOrder = db.prepare(`INSERT INTO main.team_billing_wechat_native_orders
      (order_id,team_id,actor_id,request_id,app_id,merchant_id,product,description,offer_id,offer_revision,seats,term_revision,
        amount_minor,currency,created_at,expires_at)
      VALUES (?,'cli-team','cli-admin',?,?,?,'team-annual-renewal','合成年度订单','synthetic-annual',1,3,NULL,109,'CNY',?,?)`);
    const insertPayment = db.prepare(`INSERT INTO main.team_billing_wechat_native_payments
      (order_id,merchant_id,transaction_id,paid_at,first_verified_at) VALUES (?,?,?,?,?)`);
    insertOrder.run(orderId, requestId, appId, merchantId, paidAt - 60000, paidAt + 60000);
    if (includeOtherApp) {
      insertOrder.run(otherOrderId,randomUUID(),'wxotherapp12345',merchantId,paidAt-60000,paidAt+60000);
      insertPayment.run(otherOrderId,merchantId,otherTransactionId,paidAt+120,paidAt+1000);
    }
    if (withReceipt) {
      insertPayment.run(orderId, merchantId, transactionId, paidAt + 120, paidAt + 1000);
      db.prepare('INSERT INTO main.team_billing_wechat_native_query_confirmations(order_id,verified_at) VALUES (?,?)')
        .run(orderId, paidAt + 1000);
    }
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
  function mockProvider({bill = rawBill, bytes = bill, sha1, refundResponse} = {}) {
    const descriptor = signedDescriptor(bill, at, sha1);
    return async (url, init) => {
      calls.push(url);
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.match(init.headers.Authorization, /^WECHATPAY2-SHA256-RSA2048 /);
      if (url === applicantUrl) return new Response(descriptor.raw, {headers:descriptor.headers});
      if (url === downloadUrl) return new Response(bytes);
      assert.equal(url, refundUrl);
      assertRefundRequest(url, init);
      assert.ok(refundResponse, 'Unexpected synthetic refund query');
      return new Response(refundResponse.raw, {headers:refundResponse.headers});
    };
  }
  return {
    directory, database, filename, serverId, merchantOrderId, transactionId, rawBill, calls, mockProvider,
    otherMerchantOrderId:otherOrderId.replaceAll('-', ''), otherTransactionId,
    billWithRefunds:(...rows) => statement(merchantOrderId, transactionId, rows),
    run:(output, options = {}) => reconcileConfiguredWechatNativeBill({filename, output, billDate:options.billDate ?? billDate,
      merchantRefundId:options.merchantRefundId,includeBasicFunds:options.includeBasicFunds},
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
  assert.equal(Object.hasOwn(report, 'refundVerification'), false);
  assert.equal(Object.hasOwn(report, 'basicFunds'), false);
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

async function assertRefundReport(f, output, bill, expected) {
  const text = await readFile(output, 'utf8');
  const report = JSON.parse(text);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.billDate, billDate);
  assert.equal(report.serverId, f.serverId);
  assert.equal(report.statementSha1, digest('sha1', bill));
  assert.equal(report.statementSha256, digest('sha256', bill));
  assert.equal(report.counts.statementRows, 2);
  assert.equal(report.counts.matchedPayments, 1);
  assert.equal(report.counts.refundRows, 1);
  assert.deepEqual(report.refundVerification, {merchantRefundId, ...expected});
  const [order] = report.orders;
  assert.equal(order.merchantOrderId, f.merchantOrderId);
  assert.equal(order.local.amountMinor, 109);
  assert.equal(order.local.transactionId, f.transactionId);
  assert.deepEqual(order.findings, ['ENTITLEMENT_PENDING', 'REFUND_REQUIRES_REVIEW']);
  const [refund] = order.statementRefunds;
  assert.equal(refund.merchantRefundId, merchantRefundId);
  assert.equal(refund.refundId, refundId);
  assert.equal(refund.amountMinor, 50);
  assert.equal(refund.currency, 'CNY');
  for (const privateValue of [openId, description, apiV3Key, refundAccount, promotionId, 'operator-reference', 'synthetic-proof']) {
    assert.ok(!text.includes(privateValue), 'An excluded bill field or provider response detail appeared in the report');
  }
  assert.doesNotMatch(text, /BEGIN (?:RSA )?PRIVATE KEY/);
  const file = await stat(output);
  assert.equal(file.nlink, 1);
  if (process.platform !== 'win32') assert.equal(file.mode & 0o777, 0o600);
  assert.ok(!(await readdir(f.directory)).some(name => name.endsWith('.tmp')));
  await f.assertUnchanged();
  return report;
}

function runCli(f, output, {bill = f.rawBill, merchantRefundId, refund, funds, fundsSha1} = {}) {
  const now = Date.now();
  const replies = [[applicantUrl, signedDescriptor(bill, now)], [downloadUrl, {raw:bill, headers:{}}]];
  if (refund) replies.push([refundUrl, signedResponse(refund.body, now, refund.key)]);
  if (funds) replies.push([fundsApplicant,signedDescriptor(funds,now,fundsSha1,fundsDownload)],
    [fundsDownload,{raw:funds,headers:{}}]);
  // Every URL in the isolated child is handled by this synthetic in-memory table.
  const fixtures = replies.map(([url, reply]) => [url, {bytes:reply.raw.toString('base64'), headers:reply.headers}]);
  const guard = `const fixtures=new Map(${JSON.stringify(fixtures)});
    globalThis.fetch=async(url,init)=>{
      const reply=fixtures.get(url);
      if(!reply||init.method!=='GET')process.exit(97);
      return new Response(Buffer.from(reply.bytes,'base64'),{headers:reply.headers});
    };`;
  const preload = 'data:text/javascript,' + encodeURIComponent(guard);
  const flags = merchantRefundId === undefined ? [] : ['--verify-refund', merchantRefundId];
  if (funds) flags.push('--verify-basic-funds');
  return command(process.execPath,
    ['--import', preload, startScript, '--reconcile-native-bill', billDate, '--config', f.filename, '--output', output, ...flags],
    {cwd:f.directory, env:childEnvironment()});
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
  const result = await runCli(f, output);
  assert.equal(result.code, 0, result.stderr);
  const published = JSON.parse(await readFile(output, 'utf8'));
  assert.ok(Number.isFinite(Date.parse(published.createdAt)));
  const report = await assertReport(f, output, published.createdAt);
  assert.deepEqual(JSON.parse(result.stdout), {event:'native-bill-reconciled', billDate, counts:report.counts});
  assert.ok(!result.stdout.includes(f.merchantOrderId));
  assert.ok(!result.stdout.includes(output));
});

test('the production BASIC option verifies both bills and projects only corroborated account movements', async t => {
  const f = await fixture(t,{includeOtherApp:true});
  const {transactionId,merchantOrderId} = f;
  const secondRefundId = '5000000000202402290000000032';
  const secondReference = 'audit-refund@second';
  const bill = f.billWithRefunds({}, {refundId:secondRefundId,merchantRefundId:secondReference});
  const funds = basicStatement([
    ['12:30:02',transactionId,'test-flow-shared','交易','交易','收入',101,merchantOrderId],
    ['12:30:02',transactionId,'test-flow-shared','交易','扣除交易手续费','支出',1,merchantOrderId],
    ['16:18:01',refundId,'test-flow-refund','退款','退款','支出',46,merchantRefundId],
    ['16:18:02',transactionId,'test-flow-original-refund','退款','退款','支出',46,secondReference],
    ['16:18:03',refundId,'private-conflicting-flow','退款','退款','支出',46,secondReference],
    ['16:18:04',transactionId,'private-empty-ref','交易','交易','收入',101,''],
    ['16:18:05',f.otherTransactionId,'private-other-app','交易','交易','收入',101,f.otherMerchantOrderId],
    ['16:18:06',transactionId,'private-unknown-flow','交易','新类型','收入',9,merchantOrderId],
    ['12:00:00',transactionId,'private-before-payment','交易','交易','收入',42,merchantOrderId],
    ['16:18:07',transactionId,'private-wrong-direction','交易','交易','支出',7,merchantOrderId],
  ]);
  const output = path.join(f.directory,'basic-funds.json');
  const result = await runCli(f,output,{bill,funds});
  assert.equal(result.code,0,result.stderr);
  const text = await readFile(output,'utf8');
  const report = JSON.parse(text);
  assert.equal(report.statementSha256,digest('sha256',bill));
  const {basicFunds} = report;
  assert.equal(basicFunds.accountType,'BASIC');
  assert.equal(basicFunds.statementSha1,digest('sha1',funds));
  assert.equal(basicFunds.statementSha256,digest('sha256',funds));
  assert.deepEqual(basicFunds.summary,{rowCount:10,creditCount:5,creditAmountMinor:354,debitCount:5,debitAmountMinor:146});
  assert.deepEqual(basicFunds.entries.map(row=>[row.kind,row.flowId,row.amountMinor,row.refundId]), [
    ['payment','test-flow-shared',101,undefined],['payment_fee','test-flow-shared',1,undefined],
    ['refund','test-flow-refund',46,refundId],['refund','test-flow-original-refund',46,secondRefundId],
  ]);
  assert.ok(basicFunds.entries.every(row=>row.merchantOrderId===merchantOrderId && row.transactionId===transactionId));
  assert.equal(basicFunds.linkedRows,4);
  assert.equal(basicFunds.unlinkedRows,6);
  assert.doesNotMatch(text,/private-|synthetic-funds|balanceMinor/);
  assert.ok(!text.includes(f.otherMerchantOrderId));
  assert.ok(!text.includes(f.otherTransactionId));
  assert.deepEqual(JSON.parse(result.stdout).basicFunds,{linkedRows:4,unlinkedRows:6});
  assert.ok(!result.stdout.includes(merchantOrderId));
  await f.assertUnchanged();
});

test('the BASIC option leaves no report for an inconsistent signed file or a failed digest check', async t => {
  const f = await fixture(t);
  const output = path.join(f.directory,'invalid-basic-funds.json');
  const valid = basicStatement([['12:30:02',f.transactionId,'test-flow','交易','交易','收入',101,f.merchantOrderId]]);
  for (const [funds,fundsSha1,code] of [
    [valid,'0'.repeat(40),'WECHAT_NATIVE_PROVIDER_UNAVAILABLE'],
    [Buffer.from(valid.toString('utf8').replace('`1.01,`0,`0.00','`0.01,`0,`0.00')),undefined,'WECHAT_NATIVE_FUND_BILL_INVALID'],
  ]) {
    const result = await runCli(f,output,{funds,fundsSha1});
    assert.equal(result.code,1,result.stderr);
    assert.equal(JSON.parse(result.stderr).code,code);
    assert.equal(result.stdout,'');
    await assert.rejects(stat(output),{code:'ENOENT'});
    assert.ok(!(await readdir(f.directory)).some(name=>name.endsWith('.tmp')));
    await f.assertUnchanged();
  }
});

test('an identity change during the BASIC download prevents publication against a replaced ledger', async t => {
  const f = await fixture(t);
  const output = path.join(f.directory,'replaced-basic-funds.json');
  const saved = path.join(f.directory,'initial.sqlite');
  const funds = basicStatement([['12:30:02',f.transactionId,'test-flow','交易','交易','收入',101,f.merchantOrderId]]);
  const descriptor = signedDescriptor(funds,at,undefined,fundsDownload);
  const trade = f.mockProvider();
  let replaced = false;
  await assert.rejects(f.run(output,{includeBasicFunds:true,fetchImpl:async (url,init) => {
    if (url===fundsApplicant) return new Response(descriptor.raw,{headers:descriptor.headers});
    if (url===fundsDownload) {
      await rename(f.database,saved);
      await copyFile(saved,f.database);
      replaced = true;
      return new Response(funds);
    }
    return trade(url,init);
  }}),{code:'MANAGED_DATABASE_NOT_READY'});
  assert.equal(replaced,true);
  await assert.rejects(stat(output),{code:'ENOENT'});
  await f.assertUnchanged();
});

test('a signed refund result is checked against gross amounts and preserves the bill-time PROCESSING status', async t => {
  const f = await fixture(t);
  const bill = f.billWithRefunds({});
  const output = path.join(f.directory, 'signed-refund.json');
  const response = signedResponse(refundBody(f), at);
  const result = await f.run(output, {merchantRefundId, fetchImpl:f.mockProvider({bill, refundResponse:response})});
  assert.deepEqual(f.calls, [applicantUrl, downloadUrl, refundUrl]);
  const report = await assertRefundReport(f, output, bill, {outcome:'verified', status:'SUCCESS',
    createdAt:Date.parse(refundCreatedAt), succeededAt:Date.parse(refundSucceededAt), verifiedAt:at});
  assert.equal(report.orders[0].statementRefunds[0].status, 'PROCESSING');
  assert.deepEqual(result, {event:'native-bill-reconciled', billDate, counts:report.counts, refundVerification:'verified', refundStatus:'SUCCESS'});
});

test('invalid refund selectors fail before any network call', async t => {
  const f = await fixture(t);
  const output = path.join(f.directory, 'invalid-refund-id.json');
  for (const id of ['0', '', 'audit/refund', merchantRefundId + '\n', 'a'.repeat(65), 42]) {
    await assert.rejects(f.run(output, {merchantRefundId:id}), {code:'WECHAT_NATIVE_REFUND_ID_INVALID'});
  }
  assert.deepEqual(f.calls, []);
  await assert.rejects(stat(output), {code:'ENOENT'});
  await f.assertUnchanged();
});

test('the verified bill and matching local receipt are both required before querying a selected refund', async t => {
  const f = await fixture(t);
  const withoutReceipt = await fixture(t, {withReceipt:false});
  const other = {appId:'wxotheraudit', merchantOrderId:'different-order', refundId:'5000000000202402290000000042'};
  const cases = [
    [f, f.rawBill],
    [f, f.billWithRefunds({merchantRefundId:'refund-other'})],
    [f, f.billWithRefunds(other)],
    [f, f.billWithRefunds({}, other)],
    [f, f.billWithRefunds({tradeType:'JSAPI'})],
    [f, f.billWithRefunds({merchantOrderId:'order-not-in-local-ledger'})],
    [f, f.billWithRefunds({transactionId:'wrong-transaction-row'})],
    [f, f.billWithRefunds({currency:'USD'})],
    [f, f.billWithRefunds({amount:110})],
    [f, f.billWithRefunds({time:billDate + ' 12:30:00'})],
    [withoutReceipt, withoutReceipt.billWithRefunds({})],
  ];
  for (const [fixture, bill] of cases) {
    const output = path.join(fixture.directory, 'selection-failure.json');
    const start = fixture.calls.length;
    await assert.rejects(fixture.run(output, {merchantRefundId, fetchImpl:fixture.mockProvider({bill})}),
      {code:'WECHAT_NATIVE_REFUND_NOT_IN_SCOPE'});
    assert.deepEqual(fixture.calls.slice(start), [applicantUrl, downloadUrl]);
    await assert.rejects(stat(output), {code:'ENOENT'});
    await fixture.assertUnchanged();
  }
  const duplicate = f.billWithRefunds({}, {});
  const start = f.calls.length;
  const output = path.join(f.directory,'invalid-duplicate-bill.json');
  await assert.rejects(f.run(output, {merchantRefundId, fetchImpl:f.mockProvider({bill:duplicate})}),
    {code:'WECHAT_NATIVE_TRADE_BILL_INVALID'});
  assert.deepEqual(f.calls.slice(start), [applicantUrl, downloadUrl]);
  await assert.rejects(stat(output), {code:'ENOENT'});
  await f.assertUnchanged();
});

test('refund provider identifier, gross amount or signature mismatches retain an unverified read-only report', async t => {
  const f = await fixture(t);
  const bill = f.billWithRefunds({});
  const correct = refundBody(f);
  const cases = [
    signedResponse({...correct, out_refund_no:'wrong-merchant-refund'}, at),
    signedResponse({...correct, refund_id:'5000000000202402290000000070'}, at),
    signedResponse({...correct, transaction_id:'wrong-transaction-signature-valid'}, at),
    signedResponse({...correct, out_trade_no:'wrong-order-signature-valid'}, at),
    signedResponse({...correct, amount:{...correct.amount, refund:46}}, at),
    signedResponse({...correct, amount:{...correct.amount, total:101}}, at),
    signedResponse({...correct, amount:{...correct.amount, currency:'USD'}}, at),
    signedResponse({...correct, create_time:'2024-02-29T13:40:06+08:00'}, at),
    signedResponse(correct, at, merchantKeys.privateKey),
  ];
  for (const [index, response] of cases.entries()) {
    const output = path.join(f.directory, 'ambiguous-refund-' + index + '.json');
    const result = await f.run(output, {merchantRefundId, fetchImpl:f.mockProvider({bill, refundResponse:response})});
    assert.deepEqual(f.calls.slice(index * 3), [applicantUrl, downloadUrl, refundUrl]);
    const report = await assertRefundReport(f, output, bill, {outcome:'unverified'});
    assert.deepEqual(result, {event:'native-bill-reconciled', billDate, counts:report.counts, refundVerification:'unverified'});
  }
});

test('verified PROCESSING remains processing and a frozen SUCCESS bill cannot revert', async t => {
  const f = await fixture(t);
  const response = signedResponse(refundBody(f, {status:'PROCESSING', success_time:undefined}), at);
  const processingBill = f.billWithRefunds({});
  const processingPath = path.join(f.directory, 'still-processing.json');
  const current = await f.run(processingPath, {merchantRefundId, fetchImpl:f.mockProvider({bill:processingBill, refundResponse:response})});
  const processing = await assertRefundReport(f, processingPath, processingBill, {outcome:'verified', status:'PROCESSING',
    createdAt:Date.parse(refundCreatedAt), succeededAt:null, verifiedAt:at});
  assert.deepEqual(current, {event:'native-bill-reconciled', billDate, counts:processing.counts,
    refundVerification:'verified', refundStatus:'PROCESSING'});
  const successBill = f.billWithRefunds({status:'SUCCESS'});
  const conflictPath = path.join(f.directory, 'status-conflict.json');
  const conflict = await f.run(conflictPath, {merchantRefundId, fetchImpl:f.mockProvider({bill:successBill, refundResponse:response})});
  const report = await assertRefundReport(f, conflictPath, successBill, {outcome:'unverified', reason:'status_conflict'});
  assert.equal(report.orders[0].statementRefunds[0].status, 'SUCCESS');
  assert.deepEqual(conflict, {event:'native-bill-reconciled', billDate, counts:report.counts, refundVerification:'unverified'});
});

test('a missing or byte-identically replaced SQLite file during refund GET prevents report publication', async t => {
  const f = await fixture(t);
  const bill = f.billWithRefunds({});
  const refundResponse = signedResponse(refundBody(f), at);
  const original = await readFile(f.database);
  for (const change of ['removed', 'replaced']) {
    const held = path.join(f.directory, change + '-original.sqlite');
    const copy = path.join(f.directory, change + '-copy.sqlite');
    const output = path.join(f.directory, change + '-database-report.json');
    const provider = f.mockProvider({bill, refundResponse});
    const start = f.calls.length;
    let moved = false;
    let replaced = false;
    const fetchImpl = async (url, init) => {
      const response = await provider(url, init);
      if (url === refundUrl) {
        await rename(f.database, held);
        moved = true;
        if (change === 'replaced') {
          await copyFile(held, f.database);
          replaced = true;
        }
      }
      return response;
    };
    try {
      await assert.rejects(f.run(output, {merchantRefundId, fetchImpl}), {code:'MANAGED_DATABASE_NOT_READY'});
      assert.deepEqual(f.calls.slice(start), [applicantUrl, downloadUrl, refundUrl]);
      assert.deepEqual(await readFile(held), original);
      if (change === 'replaced') await f.assertUnchanged();
      await assert.rejects(stat(output), {code:'ENOENT'});
      assert.ok(!(await readdir(f.directory)).some(name => name.endsWith('.tmp')));
    } finally {
      if (replaced) await rename(f.database, copy);
      if (moved) await rename(held, f.database);
    }
    await f.assertUnchanged();
  }
});

test('the production CLI --verify-refund returns 0 for verified status and 2 with the retained report when verification fails', async t => {
  const f = await fixture(t);
  const bill = f.billWithRefunds({});
  const body = refundBody(f);
  const output = path.join(f.directory, 'refund-command.json');
  const started = Date.now();
  const result = await runCli(f, output, {bill, merchantRefundId, refund:{body}});
  assert.equal(result.code, 0, result.stderr);
  const published = JSON.parse(await readFile(output, 'utf8'));
  const verifiedAt = published.refundVerification.verifiedAt;
  assert.ok(Number.isSafeInteger(verifiedAt) && started <= verifiedAt && verifiedAt <= Date.parse(published.createdAt));
  const report = await assertRefundReport(f, output, bill, {outcome:'verified', status:'SUCCESS', createdAt:Date.parse(refundCreatedAt),
    succeededAt:Date.parse(refundSucceededAt), verifiedAt});
  assert.deepEqual(JSON.parse(result.stdout), {event:'native-bill-reconciled', billDate, counts:report.counts,
    refundVerification:'verified', refundStatus:'SUCCESS'});

  const failure = path.join(f.directory, 'refund-command-unverified.json');
  const unverified = await runCli(f, failure, {bill, merchantRefundId, refund:{body, key:merchantKeys.privateKey}});
  assert.equal(unverified.code, 2, unverified.stderr);
  const retained = await assertRefundReport(f, failure, bill, {outcome:'unverified'});
  assert.deepEqual(JSON.parse(unverified.stdout), {event:'native-bill-reconciled', billDate, counts:retained.counts, refundVerification:'unverified'});

  const unsafe = path.join(f.directory, 'refund-command-invalid.json');
  const invalid = await runCli(f, unsafe, {merchantRefundId:'refund/invalid'});
  assert.equal(invalid.code, 1, invalid.stderr);
  assert.equal(JSON.parse(invalid.stderr).code, 'WECHAT_NATIVE_REFUND_ID_INVALID');
  assert.equal(invalid.stdout, '');
  await assert.rejects(stat(unsafe), {code:'ENOENT'});
  for (const child of [result, unverified, invalid]) for (const value of [merchantRefundId, f.merchantOrderId, refundAccount, output, failure]) {
    assert.ok(!`${child.stdout}\n${child.stderr}`.includes(value));
  }
  await f.assertUnchanged();
});
