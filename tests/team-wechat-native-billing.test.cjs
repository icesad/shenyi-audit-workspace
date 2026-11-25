'use strict';
const assert = require('node:assert/strict');
const {createCipheriv, generateKeyPairSync, randomBytes, randomUUID, sign} = require('node:crypto');
const {mkdtemp, mkdir, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const test = require('node:test');

const ledgerReady = import('../server/team/wechat-native-billing.mjs');
const databaseReady = import('../server/team/database.mjs');
const subscriptionReady = import('../server/team/subscription-store.mjs');
const merchantKeys = generateKeyPairSync('rsa', {modulusLength: 2048});
const providerKeys = generateKeyPairSync('rsa', {modulusLength: 2048});
const apiV3Key = randomBytes(32);
const appId = 'wxsynthetic12345';
const merchantId = '1000000000';
const keyId = 'PUB_KEY_ID_101';
const at = Date.parse('2026-11-20T15:29:35+08:00');
const annual = 'team-annual-renewal';
const seat = 'team-seat-addition';
const simulatedAndEntitlementTables = ['team_annual_orders', 'team_annual_verified_payments', 'team_annual_fulfilments',
  'team_seat_orders', 'team_seat_verified_payments', 'team_seat_capacity_grants', 'team_subscription_events', 'team_subscription_heads'];

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get().value;
}

function onlyFinancialEvidence(db, {orders, payments, events, queries, preexistingTerms = 0}) {
  assert.equal(count(db, 'team_billing_wechat_native_orders'), orders);
  assert.equal(count(db, 'team_billing_wechat_native_payments'), payments);
  assert.equal(count(db, 'team_billing_wechat_native_events'), events);
  assert.equal(count(db, 'team_billing_wechat_native_query_confirmations'), queries);
  for (const table of simulatedAndEntitlementTables) {
    const expected = table.startsWith('team_subscription_') ? preexistingTerms : 0;
    assert.equal(count(db, table), expected, table);
  }
}

function signedHeaders(body, time) {
  const nonce = 'synthetic-provider-signature-nonce';
  const timestamp = String(Math.floor(time / 1000));
  const message = Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), body, Buffer.from('\n')]);
  return new Headers({'Content-Type': 'application/json', 'Wechatpay-Nonce': nonce,
    'Wechatpay-Timestamp': timestamp, 'Wechatpay-Serial': keyId,
    'Wechatpay-Signature': sign('RSA-SHA256', message, providerKeys.privateKey).toString('base64')});
}

function transaction(order, {paidAt = order.createdAt + 1000, transactionId = randomBytes(12).toString('hex')} = {}) {
  return {appid: appId, mchid: merchantId, out_trade_no: order.merchantOrderId, transaction_id: transactionId,
    trade_type: 'NATIVE', trade_state: 'SUCCESS', success_time: new Date(paidAt).toISOString(),
    amount: {total: order.amountMinor, payer_total: order.amountMinor - 1, currency: 'CNY', payer_currency: 'CNY'},
    payer: {openid: 'synthetic-payer'}};
}

function providerResponse(payload, time, signed = true) {
  const body = Buffer.from(JSON.stringify(payload, null, 2));
  return new Response(body, {headers: signed ? signedHeaders(body, time) : {'Content-Type': 'application/json'}});
}

function notification(trade, time, eventId = randomUUID()) {
  const nonce = randomBytes(6).toString('hex');
  const associatedData = 'transaction';
  const cipher = createCipheriv('aes-256-gcm', apiV3Key, Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(trade)), cipher.final(), cipher.getAuthTag()]);
  const body = Buffer.from(JSON.stringify({id: eventId, event_type: 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource', create_time: new Date(time).toISOString(),
    resource: {nonce, ciphertext: ciphertext.toString('base64'), associated_data: associatedData,
      original_type: 'transaction', algorithm: 'AEAD_AES_256_GCM'}}));
  return {headers: signedHeaders(body, time), body};
}

function orderInput(changes = {}) {
  return {teamId: 'team-a', actorId: 'admin-a', requestId: randomUUID(), product: annual, offerId: 'synthetic-annual',
    offerRevision: 1, seats: 6, termRevision: null, amountMinor: 288000, expiresAt: at + 600_000, ...changes};
}

function scope(order, changes = {}) {
  return {teamId: order.teamId, actorId: order.actorId, orderId: order.id, ...changes};
}

async function fixture(t, {persist = false} = {}) {
  const {initializeTeamDatabase} = await databaseReady;
  const {createWechatNativeBilling, installWechatNativeBillingSchema} = await ledgerReady;
  const clock = {value: at};
  const provider = {calls: [], respond: () => { throw new Error('Unexpected synthetic provider request'); }};
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.mch.weixin.qq.com');
    provider.calls.push({method: init.method, path: url.pathname, query: url.search});
    return provider.respond(url, init);
  };
  const handles = new Set();
  let filename = ':memory:';
  let directory, parent;
  t.after(async () => {
    for (const db of handles) if (db.isOpen) db.close();
    if (directory) {
      assert.equal(path.dirname(path.resolve(directory)), parent);
      assert.match(path.basename(directory), /^shenyi-native-billing-test-/);
      await rm(directory, {recursive: true});
    }
  });
  if (persist) {
    parent = path.resolve(process.env.SHENYI_TEST_TMPDIR ?? tmpdir());
    await mkdir(parent, {recursive: true});
    directory = await mkdtemp(path.join(parent, 'shenyi-native-billing-test-'));
    filename = path.join(directory, 'owned.sqlite');
  }
  const connect = () => {
    const db = new DatabaseSync(filename);
    handles.add(db);
    initializeTeamDatabase(db);
    installWechatNativeBillingSchema(db);
    const billing = createWechatNativeBilling({db, appId, merchantId, certificateSerial: 'AB'.repeat(20),
      merchantPrivateKey: merchantKeys.privateKey, keys: [{id: keyId, key: providerKeys.publicKey}],
      apiV3Key, notifyUrl: 'https://shenyi.example.invalid/payments/wechat/native', fetchImpl, now: () => clock.value});
    return {db, billing};
  };
  let connection = connect();
  connection.db.exec(`INSERT INTO teams VALUES ('team-a','active'),('team-b','active');
    INSERT INTO team_users VALUES ('admin-a','active'),('admin-b','active'),('manager-a','active');
    INSERT INTO team_operators VALUES ('team-a','admin-a','administrator','active'),('team-b','admin-b','administrator','active');
    INSERT INTO team_memberships VALUES ('team-a','manager-a','manager','active');`);
  return {get db() { return connection.db; }, get billing() { return connection.billing; }, clock, provider, connect,
    reopen() { connection.db.close(); connection = connect(); }};
}

test('billing schema installs repeatedly and refuses disabled foreign keys or an incompatible partial schema', async t => {
  const f = await fixture(t);
  const {installWechatNativeBillingSchema} = await ledgerReady;
  const objects = () => f.db.prepare("SELECT name,sql FROM sqlite_schema WHERE name GLOB '*billing_wechat_native*' ORDER BY name").all();
  const initial = objects();
  assert.ok(initial.length >= 4);
  installWechatNativeBillingSchema(f.db);
  assert.deepEqual(objects(), initial);

  const {initializeTeamDatabase} = await databaseReady;
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  initializeTeamDatabase(db);
  db.exec('PRAGMA foreign_keys = OFF');
  assert.throws(() => installWechatNativeBillingSchema(db));
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE name GLOB 'team_billing_wechat_native_*'").all(), []);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE team_billing_wechat_native_orders(incompatible_column TEXT)');
  assert.throws(() => installWechatNativeBillingSchema(db));
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_schema WHERE name GLOB 'team_billing_wechat_native_*'").all()
    .map(row => row.name), ['team_billing_wechat_native_orders']);
});

test('financial facts have no implicit rowid and their normal keys reject replace, update and delete', async t => {
  const f = await fixture(t);
  const order = f.billing.lockOrder(orderInput());
  f.clock.value += 10_000;
  const trade = transaction(order);
  await f.billing.receiveNotification(notification(trade, f.clock.value));
  f.provider.respond = () => providerResponse(trade, f.clock.value);
  await f.billing.queryPayment(scope(order));
  const keyColumns = {orders: ['order_id'], payments: ['order_id'], events: ['merchant_id', 'event_id'],
    query_confirmations: ['order_id']};
  const tables = f.db.prepare('PRAGMA main.table_list').all();
  for (const [suffix, keys] of Object.entries(keyColumns)) {
    const table = `team_billing_wechat_native_${suffix}`;
    const entry = tables.find(row => row.name === table);
    assert.equal(entry.wr, 1, table);
    assert.equal(entry.strict, 1, table);
    const columns = f.db.prepare(`PRAGMA main.table_xinfo(${table})`).all();
    assert.deepEqual(columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name), keys);
    assert.throws(() => f.db.prepare(`SELECT rowid FROM ${table}`).get(), /no such column: rowid/);
    const values = columns.filter(column => column.hidden === 0).map(column => column.name).join(', ');
    const snapshot = f.db.prepare(`SELECT * FROM ${table}`).get();
    assert.throws(() => f.db.exec(`INSERT OR REPLACE INTO ${table} (${values}) SELECT ${values} FROM ${table}`),
      /WECHAT_NATIVE_IMMUTABLE/);
    assert.throws(() => f.db.exec(`UPDATE ${table} SET ${keys[0]} = ${keys[0]}`), /WECHAT_NATIVE_IMMUTABLE/);
    assert.throws(() => f.db.exec(`DELETE FROM ${table}`), /WECHAT_NATIVE_IMMUTABLE/);
    assert.deepEqual(f.db.prepare(`SELECT * FROM ${table}`).get(), snapshot);
  }
});

test('the ledger locks an idempotent order and scopes creation, lookup and checkout to its team administrator', async t => {
  const f = await fixture(t);
  const input = orderInput();
  const first = f.billing.lockOrder(input);
  f.clock.value++;
  assert.deepEqual(f.billing.lockOrder({...input}), first);
  assert.throws(() => f.billing.lockOrder({...input, amountMinor: input.amountMinor + 1}), {status: 409});
  assert.throws(() => f.billing.lockOrder(orderInput({actorId: 'manager-a'})), {status: 404});
  assert.throws(() => f.billing.readOrder(scope(first, {teamId: 'team-b', actorId: 'admin-b'})), {status: 404});
  assert.throws(() => f.billing.readOrder(scope(first, {actorId: 'manager-a'})), {status: 404});
  await assert.rejects(f.billing.createPaymentCode(scope(first, {actorId: 'manager-a'})), {status: 404});
  await assert.rejects(f.billing.queryPayment(scope(first, {actorId: 'admin-b'})), {status: 404});
  assert.equal(f.provider.calls.length, 0);

  const codeUrl = 'weixin://wxpay/bizpayurl?pr=SynthQR';
  f.provider.respond = (url, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.out_trade_no, first.merchantOrderId);
    assert.deepEqual(request.amount, {total: input.amountMinor, currency: 'CNY'});
    return providerResponse({code_url: codeUrl}, f.clock.value);
  };
  assert.deepEqual(await f.billing.createPaymentCode(scope(first)), {merchantOrderId: first.merchantOrderId, codeUrl});
  assert.deepEqual(f.billing.readOrder(scope(first)), {order: first, payment: null});
  assert.equal(f.provider.calls[0].path, '/v3/pay/transactions/native');
  onlyFinancialEvidence(f.db, {orders: 1, payments: 0, events: 0, queries: 0});
});

for (const delivery of ['query-first', 'notification-first', 'concurrent']) {
  test(`payment observations merge for ${delivery} without issuing terms, even on replay`, async t => {
    const concurrent = delivery === 'concurrent';
    const f = await fixture(t, {persist: concurrent});
    const notifying = concurrent ? f.connect() : f;
    if (concurrent) assert.notEqual(notifying.db, f.db);
    const order = f.billing.lockOrder(orderInput());
    f.clock.value += 10_000;
    const firstVerifiedAt = f.clock.value;
    const state = transaction(order);
    const eventId = randomUUID();
    f.provider.respond = () => providerResponse(state, f.clock.value);
    const query = () => f.billing.queryPayment(scope(order));
    const receive = () => notifying.billing.receiveNotification(notification(state, f.clock.value, eventId));

    if (delivery === 'query-first') {
      assert.deepEqual((await query()).payment.sources, ['query']);
      f.clock.value += 1000;
      assert.deepEqual((await receive()).sources, ['notification', 'query']);
    } else if (delivery === 'notification-first') {
      assert.deepEqual((await receive()).sources, ['notification']);
      f.clock.value += 1000;
      assert.deepEqual((await query()).payment.sources, ['notification', 'query']);
    } else {
      const [queryRead, notified] = await Promise.all([query(), receive()]);
      assert.equal(queryRead.payment.transactionId, state.transaction_id);
      assert.equal(notified.transactionId, state.transaction_id);
    }
    f.clock.value += 1000;
    await query();
    await receive();
    const read = f.billing.readOrder(scope(order));
    assert.equal(read.payment.status, 'pending_fulfilment');
    assert.equal(read.payment.paidAt, Date.parse(state.success_time));
    assert.equal(read.payment.transactionId, state.transaction_id);
    assert.deepEqual(read.payment.sources, ['notification', 'query']);
    onlyFinancialEvidence(f.db, {orders: 1, payments: 1, events: 1, queries: 1});
    assert.equal(f.db.prepare('SELECT first_verified_at FROM team_billing_wechat_native_payments WHERE order_id = ?')
      .get(order.id).first_verified_at, firstVerifiedAt);
  });
}

test('a durable receipt survives reopening a SQLite file and stale query states cannot downgrade it', async t => {
  const f = await fixture(t, {persist: true});
  const order = f.billing.lockOrder(orderInput());
  f.clock.value += 10_000;
  const state = transaction(order);
  const eventId = randomUUID();
  const unpaid = {appid: appId, mchid: merchantId, out_trade_no: order.merchantOrderId, trade_state: 'NOTPAY'};
  f.provider.respond = () => providerResponse(unpaid, f.clock.value);
  assert.deepEqual(await f.billing.queryPayment(scope(order)), {order, payment: null, state: 'NOTPAY'});
  await f.billing.receiveNotification(notification(state, f.clock.value, eventId));
  f.provider.respond = () => providerResponse(state, f.clock.value);
  const original = await f.billing.queryPayment(scope(order));
  f.reopen();
  assert.deepEqual(f.billing.readOrder(scope(order)), original);
  f.provider.respond = () => providerResponse(unpaid, f.clock.value);
  assert.deepEqual(await f.billing.queryPayment(scope(order)), original);
  assert.deepEqual(await f.billing.receiveNotification(notification(state, f.clock.value, eventId)), original.payment);
  onlyFinancialEvidence(f.db, {orders: 1, payments: 1, events: 1, queries: 1});
  assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('a payment event or provider transaction id cannot be associated with another order', async t => {
  const f = await fixture(t);
  const first = f.billing.lockOrder(orderInput());
  const second = f.billing.lockOrder(orderInput({teamId: 'team-b', actorId: 'admin-b'}));
  f.clock.value += 10_000;
  const trade = transaction(first);
  const eventId = randomUUID();
  await f.billing.receiveNotification(notification(trade, f.clock.value, eventId));
  await assert.rejects(f.billing.receiveNotification(notification(transaction(second), f.clock.value, eventId)), {status: 409});
  const duplicate = transaction(second, {transactionId: trade.transaction_id});
  await assert.rejects(f.billing.receiveNotification(notification(duplicate, f.clock.value)), {status: 409});
  f.provider.respond = () => providerResponse(duplicate, f.clock.value);
  await assert.rejects(f.billing.queryPayment(scope(second)), {status: 409});
  assert.equal(f.billing.readOrder(scope(second)).payment, null);
  onlyFinancialEvidence(f.db, {orders: 2, payments: 1, events: 1, queries: 0});
});

test('a failed evidence publication rolls back its payment and allows a clean retry', async t => {
  const f = await fixture(t);
  const order = f.billing.lockOrder(orderInput());
  f.clock.value += 10_000;
  const state = transaction(order);
  const eventId = randomUUID();
  f.db.exec(`CREATE TRIGGER synthetic_evidence_failure BEFORE INSERT ON team_billing_wechat_native_events
    BEGIN SELECT RAISE(ABORT, 'synthetic-evidence-write'); END`);
  await assert.rejects(f.billing.receiveNotification(notification(state, f.clock.value, eventId)));
  onlyFinancialEvidence(f.db, {orders: 1, payments: 0, events: 0, queries: 0});
  assert.equal(f.db.isTransaction, false);

  f.db.exec('DROP TRIGGER synthetic_evidence_failure');
  assert.equal((await f.billing.receiveNotification(notification(state, f.clock.value, eventId))).transactionId,
    state.transaction_id);
  onlyFinancialEvidence(f.db, {orders: 1, payments: 1, events: 1, queries: 0});
});

test('signed late and on-time payments use the exclusive effective cutoff and preserve each fact', async t => {
  const f = await fixture(t);
  const beforeCutoff = f.billing.lockOrder(orderInput());
  const atCutoff = f.billing.lockOrder(orderInput());
  const afterCutoff = f.billing.lockOrder(orderInput());
  f.clock.value = atCutoff.expiresAt + 30_000;
  const before = transaction(beforeCutoff, {paidAt: beforeCutoff.expiresAt - 1_000});
  assert.equal((await f.billing.receiveNotification(notification(before, f.clock.value))).status, 'pending_fulfilment');
  const exact = transaction(atCutoff, {paidAt: atCutoff.expiresAt});
  assert.equal((await f.billing.receiveNotification(notification(exact, f.clock.value))).status, 'needs_review');
  const late = transaction(afterCutoff, {paidAt: afterCutoff.expiresAt + 1_000});
  f.provider.respond = () => providerResponse(late, f.clock.value);
  const read = await f.billing.queryPayment(scope(afterCutoff));
  assert.equal(read.payment.paidAt, afterCutoff.expiresAt + 1_000);
  assert.equal(read.payment.status, 'needs_review');
  onlyFinancialEvidence(f.db, {orders: 3, payments: 3, events: 2, queries: 1});
});

test('an invalid notification or query cannot record payment and operator revocation does not invalidate a receipt', async t => {
  const f = await fixture(t);
  const order = f.billing.lockOrder(orderInput());
  f.clock.value += 30_000;
  const trade = transaction(order);
  const invalid = notification(trade, f.clock.value);
  invalid.headers.delete('Wechatpay-Signature');
  await assert.rejects(f.billing.receiveNotification(invalid), {status: 401});
  f.provider.respond = () => providerResponse(trade, f.clock.value, false);
  await assert.rejects(f.billing.queryPayment(scope(order)), {status: 502});
  onlyFinancialEvidence(f.db, {orders: 1, payments: 0, events: 0, queries: 0});
  f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='admin-a'").run();
  assert.throws(() => f.billing.readOrder(scope(order)), {status: 404});
  assert.equal((await f.billing.receiveNotification(notification(trade, f.clock.value))).transactionId, trade.transaction_id);
  onlyFinancialEvidence(f.db, {orders: 1, payments: 1, events: 1, queries: 0});
});

test('a signed query finishing after operator revocation is kept without disclosing the order', async t => {
  const f = await fixture(t);
  const order = f.billing.lockOrder(orderInput());
  f.clock.value += 30_000;
  const trade = transaction(order);
  const entered = Promise.withResolvers();
  const proceed = Promise.withResolvers();
  t.after(() => proceed.resolve());
  f.provider.respond = async () => {
    entered.resolve();
    await proceed.promise;
    return providerResponse(trade, f.clock.value);
  };
  const denied = assert.rejects(f.billing.queryPayment(scope(order)), {status: 404});
  await Promise.race([entered.promise, denied.then(() => assert.fail('Provider lookup must start before revocation'))]);
  f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='admin-a'").run();
  proceed.resolve();
  await denied;
  onlyFinancialEvidence(f.db, {orders: 1, payments: 1, events: 0, queries: 1});
  assert.throws(() => f.billing.readOrder(scope(order)), {status: 404});
});

test('seat additions lock against the current active term and preserve the existing entitlement on receipt', async t => {
  const f = await fixture(t);
  const {recordSubscriptionTerm, readSubscriptionState} = await subscriptionReady;
  const input = orderInput({product: seat, offerId: 'synthetic-seats', termRevision: 1});
  const rejectSeatLock = value => assert.throws(() => f.billing.lockOrder(value), error => [400, 402, 409].includes(error.status));
  rejectSeatLock(input);
  recordSubscriptionTerm(f.db, {teamId: 'team-a', operationId: randomUUID(), expectedRevision: 0, startsAt: at - 60_000,
    endsAt: at + 900_000, sourceRef: 'synthetic-existing-term'}, {now: () => at});
  rejectSeatLock({...input, termRevision: 2});
  rejectSeatLock({...input, expiresAt: at + 901_000});
  const before = readSubscriptionState(f.db, 'team-a', at);
  const order = f.billing.lockOrder(input);
  assert.equal(order.product, seat);
  assert.equal(order.termRevision, before.revision);
  f.clock.value += 10_000;
  const payment = await f.billing.receiveNotification(notification(transaction(order), f.clock.value));
  assert.equal(payment.status, 'pending_fulfilment');
  assert.deepEqual(readSubscriptionState(f.db, 'team-a', f.clock.value), before);
  onlyFinancialEvidence(f.db, {orders: 1, payments: 1, events: 1, queries: 0, preexistingTerms: 1});
});

test('a stale seat lock cannot publish a QR code before or during a provider call', async t => {
  const {recordSubscriptionTerm} = await subscriptionReady;
  for (const changeDuringCall of [false, true]) {
    const f = await fixture(t);
    const setTerm = revision => recordSubscriptionTerm(f.db, {teamId: 'team-a', operationId: randomUUID(),
      expectedRevision: revision, startsAt: at - 60_000, endsAt: at + (revision + 1) * 900_000,
      sourceRef: 'synthetic-existing-term'}, {now: () => f.clock.value});
    setTerm(0);
    const order = f.billing.lockOrder(orderInput({product: seat, offerId: 'synthetic-seats', termRevision: 1}));
    if (changeDuringCall) {
      const entered = Promise.withResolvers();
      const proceed = Promise.withResolvers();
      t.after(() => proceed.resolve());
      f.provider.respond = async () => {
        entered.resolve();
        await proceed.promise;
        return providerResponse({code_url: 'weixin://wxpay/bizpayurl?pr=SynthQR'}, f.clock.value);
      };
      const rejected = assert.rejects(f.billing.createPaymentCode(scope(order)), {status: 409});
      await Promise.race([entered.promise, rejected.then(() => assert.fail('Provider call must start before changing the term'))]);
      setTerm(1);
      proceed.resolve();
      await rejected;
      assert.equal(f.provider.calls.length, 1);
    } else {
      setTerm(1);
      await assert.rejects(f.billing.createPaymentCode(scope(order)), {status: 409});
      assert.equal(f.provider.calls.length, 0);
    }
    assert.deepEqual(f.billing.readOrder(scope(order)), {order, payment: null});
    if (changeDuringCall) {
      f.clock.value += 10_000;
      const trade = transaction(order);
      const payment = await f.billing.receiveNotification(notification(trade, f.clock.value));
      assert.equal(payment.transactionId, trade.transaction_id);
    }
    assert.equal(count(f.db, 'team_subscription_events'), 2);
    assert.equal(count(f.db, 'team_seat_capacity_grants'), 0);
  }
});
