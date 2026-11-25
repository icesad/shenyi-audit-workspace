'use strict';

const assert = require('node:assert/strict');
const {createCipheriv, generateKeyPairSync, randomBytes, randomUUID, sign} = require('node:crypto');
const {mkdir, mkdtemp, readFile, rm, writeFile} = require('node:fs/promises');
const https = require('node:https');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {after, before, test} = require('node:test');
const {childEnvironment, command, generateCertificates} = require('./helpers/trusted-team-https-fixture.cjs');

const dependencies = Promise.all([
  import('../server/team/database.mjs'),
  import('../server/team/managed-service.mjs'),
  import('../server/team/wechat-native-billing.mjs'),
]);
const namespace = 'team_billing_wechat_native_';
const callbackPath = '/api/billing/wechat-native/notify';
const apiBase = 'https://localhost';
const appId = 'wxsynthetic1234567';
const merchantId = '1000000000';
const keyId = 'PUB_KEY_ID_101';
const paymentKeys = generateKeyPairSync('rsa', {modulusLength: 2048});
const merchantKeys = generateKeyPairSync('rsa', {modulusLength: 2048});
const apiV3Key = randomBytes(32);
const callbackConfiguration = {appId, merchantId, apiV3Key, keys: [{id: keyId, key: paymentKeys.publicKey}]};
const orderScope = {teamId: 'team-a', actorId: 'admin-a'};
const maximumBody = 1_048_576 + 4096;
let directory, tls;

before(async () => {
  const parent = path.resolve(process.env.SHENYI_TEST_TMPDIR ?? tmpdir());
  await mkdir(parent, {recursive: true});
  const created = await mkdtemp(path.join(parent, 'shenyi-native-callback-'));
  assert.equal(path.dirname(path.resolve(created)), parent);
  assert.match(path.basename(created), /^shenyi-native-callback-/);
  directory = created;
  const certDirectory = path.join(directory, 'certificates');
  const bundle = await generateCertificates(certDirectory);
  const [ca, key, cert] = await Promise.all([
    readFile(bundle.ca), readFile(path.join(certDirectory, 'valid.key')), readFile(path.join(certDirectory, 'valid.pem')),
  ]);
  tls = {ca, key, cert};
});

after(async () => {
  if (directory) await rm(directory, {recursive: true});
});

async function fixture(t, {install = true} = {}) {
  const [{initializeTeamDatabase}, {startManagedTeamServer},
    {createWechatNativeBilling, installWechatNativeBillingSchema}] = await dependencies;
  const filename = path.join(directory, `synthetic-${randomUUID()}.sqlite`);
  const db = new DatabaseSync(filename);
  let service;
  t.after(async () => {
    if (service) {
      service.server.closeAllConnections();
      await service.close();
    }
    db.close();
  });
  initializeTeamDatabase(db);
  db.exec(`
    INSERT INTO teams VALUES ('team-a','active');
    INSERT INTO team_users VALUES ('admin-a','active');
    INSERT INTO team_operators VALUES ('team-a','admin-a','administrator','active');
  `);
  const serverId = db.prepare("SELECT value FROM main.team_database_metadata WHERE name = 'device-server-id'").get().value;
  const now = Math.floor(Date.now() / 1000) * 1000;
  let billing;
  if (install) {
    installWechatNativeBillingSchema(db);
    billing = createWechatNativeBilling({...callbackConfiguration, db, certificateSerial: 'AB'.repeat(20),
      merchantPrivateKey: merchantKeys.privateKey, notifyUrl: 'https://shenyi.example.invalid' + callbackPath,
      now: () => now - 120_000, fetchImpl: async () => assert.fail('Callback must not call the payment provider')});
  }
  return {
    db, filename, now, billing, serverId,
    async listen(configuration = callbackConfiguration) {
      service = await startManagedTeamServer({db, apiBase, port: 0, serverId, key: tls.key, cert: tls.cert,
        ...(configuration === null ? {} : {wechatNativeCallback: configuration})});
      assert.equal(service.address.host, '127.0.0.1');
      return service;
    },
    lock(changes = {}) {
      return billing.lockOrder({...orderScope, requestId: randomUUID(), product: 'team-annual-renewal',
        offerId: 'synthetic-annual', offerRevision: 1, seats: 3, termRevision: null, amountMinor: 288000,
        expiresAt: now + 600_000, ...changes});
    },
    request(init = {}) { return request(service.address.port, init); },
  };
}

function request(port, {method = 'POST', route = callbackPath, headers = {}, body, leaveOpen = false} = {}) {
  return new Promise((resolve, reject) => {
    const client = https.request({hostname: '127.0.0.1', servername: 'localhost', port, path: route, method,
      ca: tls.ca, rejectUnauthorized: true, agent: false, headers: {host: 'localhost', ...headers}}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        resolve({status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8')});
        if (leaveOpen) client.destroy();
      });
    });
    client.setTimeout(7500, () => client.destroy(new Error('Synthetic HTTPS client exceeded its test deadline')));
    client.on('error', reject);
    if (body !== undefined) client.write(body);
    if (!leaveOpen) client.end();
  });
}

function notice(order, now, {signingKey = paymentKeys.privateKey, amount = order.amountMinor,
  paidAt = now, eventId = randomUUID(), transactionId = randomBytes(12).toString('hex')} = {}) {
  const nonce = randomBytes(6).toString('hex');
  const associatedData = 'transaction';
  const cipher = createCipheriv('aes-256-gcm', apiV3Key, Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const payment = JSON.stringify({
    appid: appId, mchid: merchantId, out_trade_no: order.merchantOrderId, transaction_id: transactionId,
    trade_type: 'NATIVE', trade_state: 'SUCCESS', success_time: new Date(paidAt).toISOString(),
    amount: {total: amount, payer_total: amount, currency: 'CNY', payer_currency: 'CNY'},
  });
  const ciphertext = Buffer.concat([cipher.update(payment), cipher.final(), cipher.getAuthTag()]);
  // Preserve deliberate spacing and multibyte UTF-8 through the HTTPS transport.
  const body = Buffer.from(' ' + JSON.stringify({id: eventId, event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource', create_time: new Date(Math.max(now, paidAt)).toISOString(), summary: '合成支付通知',
    resource: {nonce, ciphertext: ciphertext.toString('base64'), associated_data: associatedData, original_type: 'transaction',
      algorithm: 'AEAD_AES_256_GCM'}}, null, 2) + '\n');
  const timestamp = String(Math.floor(now / 1000));
  const headerNonce = randomBytes(16).toString('hex');
  const material = Buffer.concat([Buffer.from(`${timestamp}\n${headerNonce}\n`), body, Buffer.from('\n')]);
  return {body, headers: {'content-type': 'application/json; charset=UTF-8', 'wechatpay-serial': keyId,
    'wechatpay-timestamp': timestamp, 'wechatpay-nonce': headerNonce,
    'wechatpay-signature': sign('RSA-SHA256', material, signingKey).toString('base64')}};
}

function rows(db, table) {
  return db.prepare(`SELECT COUNT(*) count FROM main.${table}`).get().count;
}

function verifyNoEntitlements(db) {
  for (const table of ['team_subscription_events', 'team_seat_capacity_grants',
    namespace + 'fulfilments', 'team_annual_verified_payments', 'team_seat_verified_payments']) {
    assert.equal(rows(db, table), 0, table);
  }
}

function assertFailure(response, status) {
  assert.equal(response.status, status, response.body);
  const value = JSON.parse(response.body);
  assert.deepEqual(Object.keys(value).sort(), ['code', 'message']);
  assert.equal(value.code, 'FAIL');
  assert.equal(typeof value.message, 'string');
}

test('managed callback defaults to disabled and does not affect service readiness', async t => {
  const f = await fixture(t);
  await f.listen(null);
  const response = await f.request(notice(f.lock(), f.now));
  assert.equal(response.status, 404);
  assert.equal(rows(f.db, namespace + 'payments'), 0);
  assert.equal((await f.request({method: 'GET', route: '/ready'})).status, 200);
  verifyNoEntitlements(f.db);
});

test('callback startup fails closed with missing schema or credentials', async t => {
  const missingSchema = await fixture(t, {install: false});
  const invalidConfig = await fixture(t);
  const countLedgerTables = db => db.prepare("SELECT count(*) count FROM main.sqlite_schema WHERE type = 'table' AND name GLOB 'team_billing_wechat_native_*'").get().count;
  await assert.rejects(missingSchema.listen(), {code: 'MANAGED_WECHAT_NATIVE_CALLBACK_NOT_READY'});
  assert.equal(countLedgerTables(missingSchema.db), 0, 'startup never installs payment tables');
  await assert.rejects(invalidConfig.listen({...callbackConfiguration, apiV3Key: Buffer.alloc(31)}),
    {code: 'MANAGED_WECHAT_NATIVE_CALLBACK_NOT_READY'});
  assert.equal(rows(invalidConfig.db, namespace + 'payments'), 0);
});

test('standard managed startup loads the external callback profile and rejects a malformed key', async t => {
  const f = await fixture(t);
  const order = f.lock();
  const configuredPath = path.join(directory, 'managed-service.json');
  const profilePath = path.join(directory, 'managed-payment-private.json');
  const certificates = path.join(directory, 'certificates');
  const profile = {schemaVersion: 1, provider: 'wechat-pay-native-v3', appId, merchantId,
    apiV3Key: apiV3Key.toString('base64url'), keys: [{
      id: keyId, key: String(paymentKeys.publicKey.export({type: 'spki', format: 'pem'})),
    }]};
  const config = {schemaVersion: 1, apiBase, listenPort: 0, database: f.filename, serverId: f.serverId,
    tlsCertificate: path.join(certificates, 'valid.pem'), tlsKey: path.join(certificates, 'valid.key'),
    wechatNativeCallbackProfile: profilePath};
  await writeFile(configuredPath, JSON.stringify(config), {flag: 'wx'});
  await writeFile(profilePath, JSON.stringify({...profile, apiV3Key: profile.apiV3Key + '='}), {flag: 'wx', mode: 0o600});
  const startScript = path.join(__dirname, '..', 'scripts', 'start-team-service.mjs');
  const preflight = () => command(process.execPath, [startScript, '--check-startup', '--config', configuredPath],
    {cwd: directory, env: childEnvironment()});
  const {openConfiguredTeamService} = await import('../scripts/start-team-service.mjs');
  await assert.rejects(openConfiguredTeamService(configuredPath), error => {
    assert.equal(typeof error.code, 'string');
    assert.ok(!error.message.includes(profile.apiV3Key));
    return true;
  });
  const refused = await preflight();
  assert.equal(refused.code, 1);
  assert.ok(!refused.stderr.includes(profile.apiV3Key));
  assert.equal(rows(f.db, namespace + 'payments'), 0);
  await writeFile(profilePath, JSON.stringify(profile));
  const checked = await preflight();
  assert.equal(checked.code, 0, checked.stderr);
  assert.deepEqual(JSON.parse(checked.stdout), {event: 'startup-ready'});
  const service = await openConfiguredTeamService(configuredPath);
  t.after(() => service.close());
  assert.equal((await request(service.address.port, {method: 'GET', route: '/ready'})).status, 200);
  const reply = await request(service.address.port, notice(order, f.now));
  assert.equal(reply.status, 204, reply.body);
  assert.equal(reply.body, '');
  assert.equal(rows(f.db, namespace + 'payments'), 1);
  verifyNoEntitlements(f.db);
});

test('managed readiness and callback refuse a changed ledger until original schema is restored', async t => {
  const f = await fixture(t);
  await f.listen();
  const signed = notice(f.lock(), f.now);
  const trigger = 'wechat_native_events_no_update';
  const original = f.db.prepare("SELECT sql FROM main.sqlite_schema WHERE type = 'trigger' AND name = ?")
    .get(trigger).sql;
  assert.equal((await f.request({method: 'GET', route: '/ready'})).status, 200);
  f.db.exec(`DROP TRIGGER main.${trigger}`);
  assert.equal((await f.request({method: 'GET', route: '/ready'})).status, 503);
  assertFailure(await f.request(signed), 503);
  assert.equal(rows(f.db, namespace + 'payments'), 0);
  f.db.exec(original);
  assert.equal((await f.request({method: 'GET', route: '/ready'})).status, 200);
  assert.equal((await f.request(signed)).status, 204);
  assert.equal(rows(f.db, namespace + 'payments'), 1);
});

test('signed HTTPS callback saves before acknowledging and duplicate delivery never grants seats', async t => {
  const f = await fixture(t);
  await f.listen();
  const order = f.lock();
  const captured = notice(order, f.now);
  const observer = new DatabaseSync(f.filename, {readOnly: true});
  t.after(() => observer.close());
  const payment = () => observer.prepare(`SELECT * FROM main.${namespace}payments WHERE order_id = ?`).get(order.id);

  const first = await f.request(captured);
  assert.equal(first.status, 204);
  assert.equal(first.body, '');
  assert.equal(first.headers['x-shenyi-server-id'], f.serverId);
  const committed = payment();
  assert.ok(committed, 'independent connection observes the committed receipt as soon as HTTP 204 arrives');
  assert.equal(rows(observer, namespace + 'events'), 1);
  for (const repeated of await Promise.all([f.request(captured), f.request(captured)])) {
    assert.equal(repeated.status, 204);
    assert.equal(repeated.body, '');
  }
  assert.deepEqual(payment(), committed);
  assert.equal(rows(observer, namespace + 'payments'), 1);
  assert.equal(rows(observer, namespace + 'events'), 1);
  verifyNoEntitlements(observer);
});

test('verified late payment is durably recorded without an entitlement grant', async t => {
  const f = await fixture(t);
  await f.listen();
  const overdue = f.lock({expiresAt: f.now - 5000});
  const response = await f.request(notice(overdue, f.now, {paidAt: overdue.expiresAt}));
  assert.equal(response.status, 204, response.body);
  const receipt = f.billing.readOrder({...orderScope, orderId: overdue.id}).payment;
  assert.equal(receipt.paidAt, overdue.expiresAt);
  assert.equal(receipt.status, 'needs_review');
  verifyNoEntitlements(f.db);
});

test('bad signatures, bad amounts and mismatched request shapes cannot create a receipt', async t => {
  const f = await fixture(t);
  await f.listen();
  const order = f.lock();
  const signed = notice(order, f.now);
  const unsigned = notice(order, f.now, {signingKey: merchantKeys.privateKey});
  const wrongAmount = notice(order, f.now, {amount: order.amountMinor + 1});
  const altered = {...signed, body: Buffer.concat([signed.body, Buffer.from(' ')])};
  for (const [requestOptions, expected] of [
    [unsigned, 401], [altered, 401], [wrongAmount, 409],
    [{...signed, headers: {...signed.headers, 'content-type': 'text/plain'}}, 415],
    [{...signed, headers: {...signed.headers, 'content-encoding': 'gzip'}}, 415],
    [{...signed, headers: {...signed.headers, origin: 'https://localhost'}}, 403],
    [{...signed, headers: {...signed.headers, 'sec-fetch-site': 'same-origin'}}, 403],
    [{headers: signed.headers, body: Buffer.alloc(0)}, 400],
  ]) assertFailure(await f.request(requestOptions), expected);
  const get = await f.request({method: 'GET'});
  assertFailure(get, 405);
  assert.equal(get.headers.allow, 'POST');
  const suffix = await f.request({...signed, route: callbackPath + '/'});
  assert.equal(suffix.status, 401, 'trailing slash stays under the ordinary device guard');
  for (const route of [callbackPath + '?', callbackPath + '?a=1']) {
    assert.equal((await f.request({...signed, route})).status, 404);
  }
  assert.equal(rows(f.db, namespace + 'payments'), 0);
  assert.equal(rows(f.db, namespace + 'events'), 0);
  verifyNoEntitlements(f.db);
});

test('receipt write failure preserves the original order and leaves delivery retryable', async t => {
  const f = await fixture(t);
  await f.listen();
  const order = f.lock();
  const signed = notice(order, f.now);
  f.db.exec(`CREATE TEMP TRIGGER callback_receipt_failure BEFORE INSERT ON main.${namespace}events
    BEGIN SELECT RAISE(ABORT, 'synthetic db write fault'); END`);
  const response = await f.request(signed);
  assertFailure(response, 503);
  assert.doesNotMatch(response.body, /synthetic db write fault/);
  assert.equal(rows(f.db, namespace + 'orders'), 1);
  assert.equal(rows(f.db, namespace + 'payments'), 0);
  assert.equal(rows(f.db, namespace + 'events'), 0);
  f.db.exec('DROP TRIGGER temp.callback_receipt_failure');
  assert.equal((await f.request(signed)).status, 204);
  assert.equal(rows(f.db, namespace + 'payments'), 1);
  assert.equal(rows(f.db, namespace + 'events'), 1);
  verifyNoEntitlements(f.db);
});

test('busy database returns a timely retryable refusal and restores its connection timeout', async t => {
  const f = await fixture(t);
  await f.listen();
  const signed = notice(f.lock(), f.now);
  const owner = new DatabaseSync(f.filename);
  f.db.exec('PRAGMA busy_timeout = 1234');
  const previous = f.db.prepare('PRAGMA busy_timeout').get().timeout;
  try {
    for (const transaction of ['BEGIN IMMEDIATE', 'BEGIN EXCLUSIVE']) {
      owner.exec(transaction);
      try {
        const startedAt = Date.now();
        assertFailure(await f.request(signed), 503);
        assert.ok(Date.now() - startedAt < 5000, 'retryable refusal must beat provider timeout');
        assert.equal(f.db.prepare('PRAGMA busy_timeout').get().timeout, previous);
      } finally {
        owner.exec('ROLLBACK');
      }
      assert.equal(rows(f.db, namespace + 'payments'), 0);
      assert.equal(rows(f.db, namespace + 'events'), 0);
    }
  } finally {
    owner.close();
  }
  assert.equal((await f.request(signed)).status, 204);
  assert.equal(rows(f.db, namespace + 'payments'), 1);
});

test('oversized and stalled chunks are bounded without a partially captured receipt', async t => {
  const f = await fixture(t);
  await f.listen();
  const signed = notice(f.lock(), f.now);
  const headers = {...signed.headers, 'transfer-encoding': 'chunked'};
  assertFailure(await f.request({headers, body: Buffer.alloc(maximumBody + 1, 32)}), 413);
  const startedAt = Date.now();
  try {
    const response = await f.request({headers, body: signed.body.subarray(0, 7), leaveOpen: true});
    assertFailure(response, 408);
  } catch (error) {
    if (error.code !== 'ECONNRESET') throw error;
  }
  assert.ok(Date.now() - startedAt < 5500, 'stalled stream must fail near the provider deadline');
  assert.equal(rows(f.db, namespace + 'payments'), 0);
  assert.equal(rows(f.db, namespace + 'events'), 0);
  verifyNoEntitlements(f.db);
});
