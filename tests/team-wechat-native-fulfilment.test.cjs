'use strict';
const assert = require('node:assert/strict');
const {createCipheriv, generateKeyPairSync, randomBytes, randomUUID, sign} = require('node:crypto');
const {readFileSync} = require('node:fs');
const {mkdtemp, mkdir, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const test = require('node:test');

const dependencies = Promise.all([
  import('../server/team/wechat-native-billing.mjs'),
  import('../server/team/database.mjs'),
  import('../server/team/subscription-store.mjs'),
  import('../server/team/seat-capacity-store.mjs'),
]);
const merchantKeys = generateKeyPairSync('rsa', {modulusLength: 2048});
const providerKeys = generateKeyPairSync('rsa', {modulusLength: 2048});
const apiV3Key = randomBytes(32);
const appId = 'wxsynthetic12345';
const merchantId = '1000000000';
const keyId = 'PUB_KEY_ID_101';
const initialTime = Date.parse('2026-11-20T15:29:35+08:00');
const annual = 'team-annual-renewal';
const seatAddition = 'team-seat-addition';

function successfulTrade(order, paidAt = order.createdAt + 1000) {
  return {
    appid: appId, mchid: merchantId, out_trade_no: order.merchantOrderId,
    transaction_id: randomBytes(12).toString('hex'), trade_type: 'NATIVE', trade_state: 'SUCCESS',
    success_time: new Date(paidAt).toISOString(),
    amount: {total: order.amountMinor, payer_total: order.amountMinor, currency: 'CNY', payer_currency: 'CNY'},
  };
}

function signedHeaders(body, verifiedAt) {
  const timestamp = String(Math.floor(verifiedAt / 1000));
  const nonce = 'synthetic-fulfilment-evidence';
  const message = Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), body, Buffer.from('\n')]);
  return new Headers({'Wechatpay-Nonce': nonce, 'Wechatpay-Timestamp': timestamp, 'Wechatpay-Serial': keyId,
    'Wechatpay-Signature': sign('RSA-SHA256', message, providerKeys.privateKey).toString('base64')});
}

function encryptedNotice(trade, verifiedAt) {
  const nonce = randomBytes(6).toString('hex');
  const associatedData = 'transaction';
  const cipher = createCipheriv('aes-256-gcm', apiV3Key, Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(trade)), cipher.final(), cipher.getAuthTag()]);
  const body = Buffer.from(JSON.stringify({
    id: randomUUID(), event_type: 'TRANSACTION.SUCCESS', resource_type: 'encrypt-resource',
    create_time: new Date(verifiedAt).toISOString(),
    resource: {nonce, ciphertext: ciphertext.toString('base64'), associated_data: associatedData,
      original_type: 'transaction', algorithm: 'AEAD_AES_256_GCM'},
  }));
  return {headers: signedHeaders(body, verifiedAt), body};
}

function scope(order, overrides = {}) {
  return {teamId: order.teamId, actorId: order.actorId, orderId: order.id, ...overrides};
}

function assertApplied(result, expected) {
  assert.equal(result.payment.status, 'fulfilled');
  assert.deepEqual(pick(result.payment.fulfilment, Object.keys(expected)), expected);
}

function pick(value, fields) {
  return Object.fromEntries(fields.map(key => [key, value[key]]));
}

function rows(db, table) {
  return db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count;
}

async function fixture(t, {persistent = false, baseOnly = false, now = initialTime} = {}) {
  const [{createWechatNativeBilling, installWechatNativeBillingSchema}, {initializeTeamDatabase},
    {recordSubscriptionTerm, readSubscriptionState}, {recordSeatCapacityGrant, readSeatCapacity}] = await dependencies;
  const handles = [];
  const time = {value: now};
  const provider = {calls: []};
  let filename = ':memory:';
  let directory;
  if (persistent) {
    const parent = path.resolve(process.env.SHENYI_TEST_TMPDIR ?? tmpdir());
    await mkdir(parent, {recursive: true});
    directory = await mkdtemp(path.join(parent, 'shenyi-native-fulfilment-'));
    assert.equal(path.dirname(path.resolve(directory)), parent);
    assert.match(path.basename(directory), /^shenyi-native-fulfilment-/);
    filename = path.join(directory, 'isolated.sqlite');
  }
  t.after(async () => {
    for (const handle of handles) if (handle.isOpen) handle.close();
    if (directory) await rm(directory, {recursive: true});
  });
  function open() {
    const db = new DatabaseSync(filename);
    handles.push(db);
    initializeTeamDatabase(db);
    return db;
  }
  const db = open();
  db.exec(`
    INSERT INTO teams VALUES ('team-a','active'),('team-b','active');
    INSERT INTO team_users VALUES ('admin-a','active'),('admin-b','active'),('manager-a','active');
    INSERT INTO team_operators VALUES ('team-a','admin-a','administrator','active'),
      ('team-b','admin-b','administrator','active');
    INSERT INTO team_memberships VALUES ('team-a','manager-a','manager','active');
  `);
  if (baseOnly) {
    const base = readFileSync(path.join(__dirname, '../server/team/wechat-native-billing-schema.sql'), 'utf8');
    db.exec(base);
  } else {
    installWechatNativeBillingSchema(db);
  }
  function billingFor(handle) {
    return createWechatNativeBilling({db: handle, appId, merchantId, certificateSerial: 'AB'.repeat(20),
      merchantPrivateKey: merchantKeys.privateKey, keys: [{id: keyId, key: providerKeys.publicKey}], apiV3Key,
      notifyUrl: 'https://shenyi.example.invalid/payments/wechat/native', now: () => time.value,
      fetchImpl: (url, options) => {
        assert.equal(new URL(url).origin, 'https://api.mch.weixin.qq.com');
        assert.ok(['GET', 'POST'].includes(options.method));
        provider.calls.push(options.method);
        assert.ok(provider.reply, 'Unexpected synthetic provider request');
        return typeof provider.reply === 'function' ? provider.reply() : provider.reply;
      }});
  }
  const billing = baseOnly ? null : billingFor(db);
  function term({startsAt, endsAt, expectedRevision = 0}) {
    return recordSubscriptionTerm(db, {teamId: 'team-a', operationId: randomUUID(), expectedRevision, startsAt, endsAt,
      sourceRef: 'synthetic-fulfilment-term'}, {now: () => time.value});
  }
  function grant({startsAt, endsAt, seats}) {
    return recordSeatCapacityGrant(db, {teamId: 'team-a', grantId: randomUUID(), startsAt, endsAt, seats,
      sourceRef: 'synthetic-fulfilment-capacity'}, {now: () => time.value});
  }
  function hold() {
    const id = randomUUID();
    db.prepare(`INSERT INTO team_operator_employee_invitations
      (invitation_id,token_hash,team_id,phone,role,invited_by,created_at,expires_at)
      VALUES (?,?,'team-a','+8613800000001','intern','admin-a',?,?)`)
      .run(id, randomBytes(32).toString('hex'), time.value, time.value + 900_000);
    return id;
  }
  return {
    db, billing, time, term, grant, hold, billingFor, provider, install: () => installWechatNativeBillingSchema(db),
    other: () => billingFor(open()), state: at => readSubscriptionState(db, 'team-a', at ?? time.value),
    capacity: at => readSeatCapacity(db, 'team-a', at ?? time.value),
    lock(overrides = {}) {
      return billing.lockOrder({teamId: 'team-a', actorId: 'admin-a', requestId: randomUUID(), product: annual,
        offerId: 'synthetic-annual', offerRevision: 1, seats: 3, termRevision: null,
        amountMinor: 288000, expiresAt: time.value + 600_000, ...overrides});
    },
    async pay(order, paidAt) {
      if (time.value <= order.createdAt) time.value = order.createdAt + 1000;
      return billing.receiveNotification(encryptedNotice(successfulTrade(order, paidAt), time.value));
    },
    async queryState(order, state, {signed = true} = {}) {
      const body = Buffer.from(JSON.stringify({appid: appId, mchid: merchantId,
        out_trade_no: order.merchantOrderId, trade_state: state}));
      provider.reply = new Response(body, {headers: signed ? signedHeaders(body, time.value) : {}});
      return billing.queryPayment(scope(order));
    },
  };
}

test('annual renewal applies the purchased capacity only to the new year and returns one receipt on retry', async t => {
  const f = await fixture(t, {persistent: true});
  const previousEnd = Date.parse('2028-02-29T11:34:56+08:00');
  const previousStart = Date.parse('2027-02-28T11:34:56+08:00');
  f.time.value = previousEnd - 120_000;
  f.term({startsAt: previousStart, endsAt: previousEnd});
  f.grant({startsAt: previousStart, endsAt: previousEnd, seats: 5});
  const order = f.lock({seats: 3});
  const second = f.other();
  await f.pay(order);
  const verifiedAt = f.time.value;
  f.time.value += 1000;
  const applied = await f.billing.fulfilPayment(scope(order));
  const end = Date.parse('2029-02-28T11:34:56+08:00');
  assertApplied(applied, {subscriptionRevision: 2, seats: 3, startsAt: previousEnd, endsAt: end, fulfilledAt: f.time.value});
  assert.deepEqual(pick(f.state(), ['revision', 'startsAt', 'endsAt']), {revision: 2, startsAt: previousStart, endsAt: end});
  assert.equal(applied.payment.firstVerifiedAt, verifiedAt);
  assert.equal(f.capacity(previousEnd - 1).purchasedSeats, 5);
  assert.equal(f.capacity(previousEnd).purchasedSeats, 3);
  assert.equal(f.capacity(end).purchasedSeats, 0);
  f.time.value += 1000;
  assert.deepEqual(await second.fulfilPayment(scope(order)), applied);
  assert.deepEqual(f.billing.readOrder(scope(order)), applied);
  assert.equal(rows(f.db, 'team_billing_wechat_native_fulfilments'), 1);
  assert.equal(rows(f.db, 'team_subscription_events'), 2);
  assert.equal(rows(f.db, 'team_seat_capacity_grants'), 2);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('expired renewal starts at the original trusted verification instant', async t => {
  const verifiedAt = Date.parse('2028-02-29T23:30:00+08:00');
  const f = await fixture(t, {now: verifiedAt - 120_000});
  f.term({startsAt: verifiedAt - 86400_000, endsAt: verifiedAt});
  const order = f.lock();
  f.time.value = verifiedAt;
  const paidAt = verifiedAt - 6000;
  await f.pay(order, paidAt);
  f.time.value += 30_000;
  const applied = await f.billing.fulfilPayment(scope(order));
  const end = Date.parse('2029-02-28T23:30:00+08:00');
  assertApplied(applied, {subscriptionRevision: 2, seats: 3, startsAt: verifiedAt, endsAt: end, fulfilledAt: f.time.value});
  assert.equal(applied.payment.paidAt, paidAt);
  assert.equal(applied.payment.firstVerifiedAt, verifiedAt);
  assert.equal(f.state().startsAt, verifiedAt);
  assert.equal(f.capacity(verifiedAt - 1).purchasedSeats, 0);
  assert.equal(f.capacity(verifiedAt).purchasedSeats, 3);
});

test('annual seat reductions protect active members and live invitation holds at both checkpoints', async t => {
  const f = await fixture(t);
  const firstHold = f.hold();
  assert.equal(f.capacity().usedSeats, 2);
  assert.throws(() => f.lock({seats: 1}), {status: 409});
  const order = f.lock({seats: 2});
  const secondHold = f.hold();
  await f.pay(order);
  await assert.rejects(async () => f.billing.fulfilPayment(scope(order)), {status: 409});
  assert.equal(f.billing.readOrder(scope(order)).payment.status, 'pending_fulfilment');
  assert.equal(rows(f.db, 'team_subscription_events'), 0);
  assert.equal(rows(f.db, 'team_seat_capacity_grants'), 0);
  assert.equal(rows(f.db, 'team_billing_wechat_native_payments'), 1);
  f.db.prepare('UPDATE team_operator_employee_invitations SET revoked_at = ? WHERE invitation_id = ?').run(f.time.value, secondHold);
  const applied = await f.billing.fulfilPayment(scope(order));
  assert.equal(applied.payment.status, 'fulfilled');
  assert.equal(f.capacity().purchasedSeats, 2);
  assert.equal(f.capacity().activeBusinessSeats, 1);
  assert.equal(f.capacity().reservedInvitationSeats, 1);
  assert.ok(f.db.prepare('SELECT 1 FROM team_operator_employee_invitations WHERE invitation_id = ? AND revoked_at IS NULL').get(firstHold));
});

test('an incremental purchase is additive until its locked term end after early renewal', async t => {
  const f = await fixture(t);
  const startsAt = initialTime - 86400_000;
  const originalEnd = initialTime + 900_000;
  f.term({startsAt, endsAt: originalEnd});
  f.grant({startsAt, endsAt: originalEnd, seats: 4});
  const addOrder = f.lock({product: seatAddition, offerId: 'synthetic-seat', termRevision: 1, seats: 2});
  const renewalOrder = f.lock({seats: 5});
  await f.pay(renewalOrder);
  await f.billing.fulfilPayment(scope(renewalOrder));
  f.time.value += 5000;
  await f.pay(addOrder);
  const firstVerifiedAt = f.time.value;
  f.time.value += 1000;
  const applied = await f.billing.fulfilPayment(scope(addOrder));
  assertApplied(applied, {subscriptionRevision: 1, seats: 2, startsAt: firstVerifiedAt, endsAt: originalEnd, fulfilledAt: f.time.value});
  assert.equal(f.state().revision, 2);
  assert.equal(f.capacity(firstVerifiedAt - 1).purchasedSeats, 4);
  assert.equal(f.capacity(firstVerifiedAt).purchasedSeats, 6);
  assert.equal(f.capacity(originalEnd - 1).purchasedSeats, 6);
  assert.equal(f.capacity(originalEnd).purchasedSeats, 5);
});

test('a replacement term with a later start cannot fulfil a seat addition for the original term', async t => {
  const f = await fixture(t);
  const endsAt = initialTime + 900_000;
  f.term({startsAt: initialTime - 86_400_000, endsAt});
  const order = f.lock({product: seatAddition, offerId: 'synthetic-seat', termRevision: 1, seats: 2});
  f.time.value += 5000;
  f.term({expectedRevision: 1, startsAt: f.time.value, endsAt});
  f.time.value += 1000;
  await f.pay(order);
  await assert.rejects(async () => f.billing.fulfilPayment(scope(order)), {status: 409});
  assert.equal(f.billing.readOrder(scope(order)).payment.status, 'pending_fulfilment');
  assert.equal(rows(f.db, 'team_billing_wechat_native_fulfilments'), 0);
  assert.equal(rows(f.db, 'team_seat_capacity_grants'), 0);
  assert.equal(f.state().revision, 2);
});

test('expired locked seat term and late annual receipt cannot publish entitlements', async t => {
  const f = await fixture(t);
  const termEnd = initialTime + 900_000;
  f.term({startsAt: initialTime - 86_400_000, endsAt: termEnd});
  const addOrder = f.lock({product: seatAddition, offerId: 'synthetic-seat', termRevision: 1, seats: 2});
  const lateOrder = f.lock();
  f.time.value = termEnd;
  await f.pay(addOrder, addOrder.expiresAt - 1000);
  await f.pay(lateOrder, lateOrder.expiresAt);
  await assert.rejects(async () => f.billing.fulfilPayment(scope(addOrder)), {status: 409});
  await assert.rejects(async () => f.billing.fulfilPayment(scope(lateOrder)), {status: 409});
  assert.equal(f.billing.readOrder(scope(lateOrder)).payment.status, 'needs_review');
  assert.equal(rows(f.db, 'team_billing_wechat_native_payments'), 2);
  assert.equal(rows(f.db, 'team_billing_wechat_native_fulfilments'), 0);
  assert.equal(rows(f.db, 'team_seat_capacity_grants'), 0);
  assert.equal(f.state().revision, 1);
});

test('a failed receipt insert rolls back term and seats but preserves the paid order for retry', async t => {
  const f = await fixture(t);
  const order = f.lock();
  await f.pay(order);
  const before = f.billing.readOrder(scope(order));
  f.db.exec(`CREATE TEMP TRIGGER reject_synthetic_fulfilment BEFORE INSERT ON main.team_billing_wechat_native_fulfilments
    BEGIN SELECT RAISE(ABORT,'synthetic fulfilment persistence failure'); END`);
  await assert.rejects(async () => f.billing.fulfilPayment(scope(order)));
  assert.deepEqual(f.billing.readOrder(scope(order)), before);
  assert.equal(f.state().revision, 0);
  assert.equal(rows(f.db, 'team_billing_wechat_native_payments'), 1);
  assert.equal(rows(f.db, 'team_billing_wechat_native_fulfilments'), 0);
  assert.equal(rows(f.db, 'team_seat_capacity_grants'), 0);
  f.db.exec('DROP TRIGGER reject_synthetic_fulfilment');
  assert.equal((await f.billing.fulfilPayment(scope(order))).payment.status, 'fulfilled');
  assert.equal(f.state().revision, 1);
  assert.equal(f.capacity().purchasedSeats, order.seats);
});

test('seat addition rolls back when its locked term ends while publishing the receipt', async t => {
  const f = await fixture(t);
  const termEnd = initialTime + 900_000;
  f.term({startsAt: initialTime - 86_400_000, endsAt: termEnd});
  const order = f.lock({product: seatAddition, offerId: 'synthetic-seat', termRevision: 1, seats: 2});
  await f.pay(order);
  f.time.value = termEnd - 1;
  f.db.function('advance_synthetic_clock', () => { f.time.value = termEnd; return 1; });
  f.db.exec(`CREATE TEMP TRIGGER expire_synthetic_term AFTER INSERT ON main.team_billing_wechat_native_fulfilments
    BEGIN SELECT advance_synthetic_clock(); END`);
  await assert.rejects(async () => f.billing.fulfilPayment(scope(order)), {status: 409});
  assert.equal(f.time.value, termEnd);
  assert.equal(rows(f.db, 'team_billing_wechat_native_payments'), 1);
  assert.equal(rows(f.db, 'team_billing_wechat_native_fulfilments'), 0);
  assert.equal(rows(f.db, 'team_seat_capacity_grants'), 0);
  assert.equal(f.state().revision, 1);
});

test('fulfilment requires the scoped administrator and a trusted payment', async t => {
  const f = await fixture(t);
  const order = f.lock();
  await assert.rejects(async () => f.billing.fulfilPayment(scope(order)), {status: 409});
  const packet = encryptedNotice(successfulTrade(order), f.time.value + 1000);
  packet.headers.set('Wechatpay-Signature', 'invalid-fixture-signature');
  f.time.value += 1000;
  await assert.rejects(f.billing.receiveNotification(packet), {status: 401});
  await assert.rejects(async () => f.billing.fulfilPayment(scope(order)), {status: 409});
  await f.pay(order);
  for (const requested of [scope(order, {actorId: 'manager-a'}), scope(order, {actorId: 'admin-b', teamId: 'team-b'})]) {
    await assert.rejects(async () => f.billing.fulfilPayment(requested), {status: 404});
  }
  assert.equal(f.state().revision, 0);
  assert.equal(rows(f.db, 'team_billing_wechat_native_fulfilments'), 0);
  assert.equal(f.billing.readOrder(scope(order)).payment.status, 'pending_fulfilment');
});

test('fulfilment from a signed query remains fulfilled when the matching callback arrives', async t => {
  const f = await fixture(t);
  const order = f.lock();
  f.time.value += 1000;
  const trade = successfulTrade(order);
  const body = Buffer.from(JSON.stringify(trade));
  f.provider.reply = new Response(body, {headers: signedHeaders(body, f.time.value)});
  const queried = await f.billing.queryPayment(scope(order));
  assert.deepEqual(queried.payment.sources, ['query']);
  const applied = await f.billing.fulfilPayment(scope(order));
  f.time.value += 1000;
  const received = await f.billing.receiveNotification(encryptedNotice(trade, f.time.value));
  assert.equal(received.status, 'fulfilled');
  assert.deepEqual(received.fulfilment, applied.payment.fulfilment);
  assert.deepEqual(received.sources, ['notification', 'query']);
  assert.equal(rows(f.db, 'team_billing_wechat_native_payments'), 1);
  assert.equal(rows(f.db, 'team_billing_wechat_native_fulfilments'), 1);
  assert.equal(rows(f.db, 'team_seat_capacity_grants'), 1);
});

for (const state of ['REFUND', 'CLOSED']) {
  test(`a signed ${state} before SUCCESS holds later payment for review across two connections and retry`, async t => {
    const f = await fixture(t, {persistent: true});
    const order = f.lock();
    f.time.value += 1000;
    await f.queryState(order, state);
    const trade = successfulTrade(order);
    const received = await f.billing.receiveNotification(encryptedNotice(trade, f.time.value));
    assert.equal(received.status, 'needs_review');
    assert.deepEqual(received.providerReviewStates, [state]);
    const reopened = f.other();
    f.time.value += 1000;
    const body = Buffer.from(JSON.stringify(trade));
    f.provider.reply = new Response(body, {headers: signedHeaders(body, f.time.value)});
    assert.deepEqual((await reopened.queryPayment(scope(order))).payment.providerReviewStates, [state]);
    assert.equal(reopened.readOrder(scope(order)).payment.status, 'needs_review');
    await assert.rejects(async () => reopened.fulfilPayment(scope(order)), {status: 409});
    assert.equal(rows(f.db, 'team_billing_wechat_native_payments'), 1);
    assert.equal(rows(f.db, 'team_billing_wechat_native_fulfilments'), 0);
    assert.equal(f.state().revision, 0);
  });
}

test('only authenticated terminal observations can hold an already captured payment', async t => {
  const f = await fixture(t);
  const unaffected = f.lock();
  const held = f.lock();
  await f.pay(unaffected);
  f.time.value += 1000;
  await f.pay(held);
  await assert.rejects(f.queryState(unaffected, 'REFUND', {signed: false}));
  const staleUnpaid = await f.queryState(unaffected, 'NOTPAY');
  assert.equal(staleUnpaid.payment.status, 'pending_fulfilment');
  assert.deepEqual(staleUnpaid.payment.providerReviewStates ?? [], []);

  const refunded = await f.queryState(held, 'REFUND');
  assert.equal(refunded.payment.status, 'needs_review');
  assert.deepEqual(refunded.payment.providerReviewStates, ['REFUND']);
  await assert.rejects(async () => f.billing.fulfilPayment(scope(held)), {status: 409});

  const applied = await f.billing.fulfilPayment(scope(unaffected));
  const lateReport = await f.queryState(unaffected, 'REFUND');
  assert.equal(lateReport.payment.status, 'fulfilled');
  assert.deepEqual(lateReport.payment.providerReviewStates, ['REFUND']);
  assert.deepEqual(lateReport.payment.fulfilment, applied.payment.fulfilment);
  assert.equal(f.capacity().purchasedSeats, unaffected.seats);
  assert.equal(f.state().revision, 1);
});

test('seat addition checks capacity at fulfilment when a grant began after payment capture', async t => {
  const f = await fixture(t);
  const endsAt = initialTime + 900_000;
  f.term({startsAt: initialTime - 86_400_000, endsAt});
  const order = f.lock({product: seatAddition, offerId: 'synthetic-seat', termRevision: 1, seats: 1});
  await f.pay(order);
  const capturedAt = f.time.value;
  f.time.value += 1000;
  f.grant({startsAt: f.time.value, endsAt, seats: Number.MAX_SAFE_INTEGER});
  assert.equal(f.capacity(capturedAt).purchasedSeats, 0);
  assert.equal(f.capacity().purchasedSeats, Number.MAX_SAFE_INTEGER);
  await assert.rejects(async () => f.billing.fulfilPayment(scope(order)), {status: 409});
  assert.equal(f.billing.readOrder(scope(order)).payment.status, 'pending_fulfilment');
  assert.equal(f.capacity().purchasedSeats, Number.MAX_SAFE_INTEGER);
  assert.equal(rows(f.db, 'team_seat_capacity_grants'), 1);
  assert.equal(rows(f.db, 'team_billing_wechat_native_fulfilments'), 0);
});

test('annual QR creation checks used seats before outbound and after the provider response', async t => {
  const f = await fixture(t);
  const order = f.lock({seats: 1});
  const firstHold = f.hold();
  await assert.rejects(f.billing.createPaymentCode(scope(order)), {status: 409});
  assert.deepEqual(f.provider.calls, []);
  f.db.prepare('UPDATE team_operator_employee_invitations SET revoked_at = ? WHERE invitation_id = ?').run(f.time.value, firstHold);

  const codeUrl = 'weixin://wxpay/bizpayurl?pr=SynthQR';
  f.provider.reply = () => {
    f.hold();
    const body = Buffer.from(JSON.stringify({code_url: codeUrl}));
    return new Response(body, {headers: signedHeaders(body, f.time.value)});
  };
  await assert.rejects(f.billing.createPaymentCode(scope(order)), {status: 409});
  assert.deepEqual(f.provider.calls, ['POST']);
  assert.equal(f.billing.readOrder(scope(order)).payment, null);
  assert.equal(f.capacity().usedSeats, 2);
});

test('earlier verified annual payments are processed first and a late receipt cannot block them', async t => {
  const f = await fixture(t);
  const late = f.lock({expiresAt: initialTime + 90_000});
  const first = f.lock({seats: 4});
  const second = f.lock({seats: 2});
  f.time.value += 90_000;
  await f.pay(late, f.time.value);
  f.time.value += 1000;
  await f.pay(first);
  f.time.value += 1000;
  await f.pay(second);
  await assert.rejects(async () => f.billing.fulfilPayment(scope(second)), {status: 409});
  const firstApplied = await f.billing.fulfilPayment(scope(first));
  const secondApplied = await f.billing.fulfilPayment(scope(second));
  assert.equal(firstApplied.payment.fulfilment.subscriptionRevision, 1);
  assert.equal(secondApplied.payment.fulfilment.subscriptionRevision, 2);
  assert.equal(secondApplied.payment.fulfilment.startsAt, firstApplied.payment.fulfilment.endsAt);
  assert.equal(f.billing.readOrder(scope(late)).payment.status, 'needs_review');
  assert.equal(rows(f.db, 'team_billing_wechat_native_fulfilments'), 2);
});

test('annual payments with the same verification instant use the stable order identifier', async t => {
  const f = await fixture(t);
  const orders = [f.lock(), f.lock()].sort((left, right) => left.id < right.id ? -1 : 1);
  f.time.value += 1000;
  await f.pay(orders[1]);
  await f.pay(orders[0]);
  await assert.rejects(async () => f.billing.fulfilPayment(scope(orders[1])), {status: 409});
  assert.equal((await f.billing.fulfilPayment(scope(orders[0]))).payment.status, 'fulfilled');
  assert.equal((await f.billing.fulfilPayment(scope(orders[1]))).payment.status, 'fulfilled');
  assert.equal(rows(f.db, 'team_subscription_events'), 2);
});

test('zero-seat renewal publishes no capacity and holds if a capacity grant would overlap', async t => {
  const allowed = await fixture(t);
  allowed.db.prepare("UPDATE team_memberships SET status='disabled' WHERE user_id='manager-a'").run();
  const zeroSeats = allowed.lock({seats: 0});
  await allowed.pay(zeroSeats);
  assert.equal((await allowed.billing.fulfilPayment(scope(zeroSeats))).payment.status, 'fulfilled');
  assert.equal(allowed.state().revision, 1);
  assert.equal(rows(allowed.db, 'team_seat_capacity_grants'), 0);

  const blocked = await fixture(t);
  blocked.db.prepare("UPDATE team_memberships SET status='disabled' WHERE user_id='manager-a'").run();
  const overlapping = blocked.lock({seats: 0});
  await blocked.pay(overlapping);
  blocked.grant({startsAt: initialTime + 120_000, endsAt: initialTime + 240_000, seats: 2});
  await assert.rejects(async () => blocked.billing.fulfilPayment(scope(overlapping)), {status: 409});
  assert.equal(blocked.state().revision, 0);
  assert.equal(rows(blocked.db, 'team_seat_capacity_grants'), 1);
  assert.equal(rows(blocked.db, 'team_billing_wechat_native_payments'), 1);
});

test('the four-table billing baseline upgrades additively and preserves order rows', async t => {
  const f = await fixture(t, {baseOnly: true});
  const schema = () => f.db.prepare(`SELECT name, sql FROM main.sqlite_schema
    WHERE tbl_name GLOB 'team_billing_wechat_native_*' ORDER BY name`).all();
  const baseline = schema();
  assert.equal(baseline.filter(row => row.sql?.startsWith('CREATE TABLE')).length, 4);
  const id = randomUUID();
  f.db.prepare(`INSERT INTO team_billing_wechat_native_orders
    (order_id,team_id,actor_id,request_id,app_id,merchant_id,product,description,offer_id,
      offer_revision,seats,term_revision,amount_minor,currency,created_at,expires_at)
    VALUES (?,'team-a','admin-a',?,?,?,'team-annual-renewal','synthetic annual','synthetic-annual',
      1,3,NULL,288000,'CNY',?,?)`).run(id, randomUUID(), appId, merchantId, f.time.value, f.time.value + 600_000);
  const priorOrder = f.db.prepare('SELECT * FROM team_billing_wechat_native_orders WHERE order_id = ?').get(id);
  f.install();
  assert.deepEqual(schema().filter(row => baseline.some(previous => previous.name === row.name)), baseline);
  assert.equal(rows(f.db, 'team_billing_wechat_native_fulfilments'), 0);
  assert.deepEqual(f.db.prepare('SELECT * FROM team_billing_wechat_native_orders WHERE order_id = ?').get(id), priorOrder);
  const nextSchema = schema();
  f.install();
  assert.deepEqual(schema(), nextSchema);
  const billing = f.billingFor(f.db);
  assert.equal(billing.readOrder({teamId: 'team-a', actorId: 'admin-a', orderId: id}).payment, null);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});
