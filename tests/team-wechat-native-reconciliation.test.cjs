'use strict';

const assert = require('node:assert/strict');
const {createHash, randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {test} = require('node:test');

const dependencies = Promise.all([
  import('../server/team/database.mjs'),
  import('../server/team/wechat-native-billing.mjs'),
  import('../server/team/wechat-native-reconciliation.mjs'),
]);
const merchantId = '1000000000';
const appId = 'wxsynthetic12345';
const billDate = '2024-02-29';
const dayStart = Date.parse('2024-02-29T00:00:00+08:00');
const dayEnd = Date.parse('2024-03-01T00:00:00+08:00');
const sha1 = createHash('sha1').update('Synthetic provider bill evidence').digest('hex');
const merchantNumber = () => randomUUID().replaceAll('-', '');
const localOrders = 'main.team_billing_wechat_native_orders';
const localPayments = 'main.team_billing_wechat_native_payments';

async function fixture(t) {
  const [{initializeTeamDatabase}, {installWechatNativeBillingSchema}, {reconcileWechatNativeTradeBill}] = await dependencies;
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  initializeTeamDatabase(db);
  installWechatNativeBillingSchema(db);
  db.exec(`
    INSERT INTO main.teams VALUES ('team-a','active');
    INSERT INTO main.team_users VALUES ('admin-a','active');
    INSERT INTO main.team_operators VALUES ('team-a','admin-a','administrator','active');
  `);
  function order(options = {}) {
    const id = randomUUID();
    const createdAt = options.createdAt ?? dayStart - 2 * 60000;
    const expiresAt = options.expiresAt ?? dayEnd + 60000;
    const amountMinor = options.amountMinor ?? 123456;
    db.prepare(`INSERT INTO ${localOrders}
      (order_id,team_id,actor_id,request_id,app_id,merchant_id,product,description,offer_id,offer_revision,seats,term_revision,
       amount_minor,currency,created_at,expires_at)
      VALUES (?,'team-a','admin-a',?,?,?,'team-annual-renewal','合成续费','synthetic-annual',1,3,NULL,?,'CNY',?,?)`)
      .run(id, randomUUID(), options.appId ?? appId, options.merchantId ?? merchantId, amountMinor, createdAt, expiresAt);
    return {id, merchantOrderId:id.replaceAll('-', ''), amountMinor, createdAt, expiresAt};
  }
  function receipt(locked, options = {}) {
    const paidAt = options.paidAt ?? dayStart + 60000;
    const firstVerifiedAt = options.firstVerifiedAt ?? paidAt + 1000;
    const transactionId = options.transactionId ?? merchantNumber();
    const paid = db.prepare(`INSERT INTO ${localPayments}(order_id,merchant_id,transaction_id,paid_at,first_verified_at)
      VALUES (?,?,?,?,?) RETURNING paid_at`).get(locked.id, options.merchantId ?? merchantId, transactionId, paidAt, firstVerifiedAt);
    assert.equal(paid.paid_at, paidAt);
    db.prepare('INSERT INTO main.team_billing_wechat_native_query_confirmations(order_id,verified_at) VALUES (?,?)')
      .run(locked.id, firstVerifiedAt);
    return {...locked, paidAt, firstVerifiedAt, transactionId};
  }
  function reconcile(bill) {
    const before = db.prepare('SELECT total_changes() AS hits').get();
    db.exec('PRAGMA query_only=ON');
    try { return reconcileWechatNativeTradeBill(db, bill); }
    finally {
      assert.equal(db.isTransaction, false);
      assert.deepEqual(db.prepare('SELECT total_changes() AS hits').get(), before);
      db.exec('PRAGMA query_only=OFF');
    }
  }
  return {db, order, receipt, reconcile};
}

function success(local = {}, changes = {}) {
  return {appId, merchantId, merchantOrderId:local.merchantOrderId ?? merchantNumber(),
    transactionId:local.transactionId ?? merchantNumber(), tradeType:'NATIVE', status:'SUCCESS',
    occurredAt:Math.floor((local.paidAt ?? dayStart + 60000) / 1000) * 1000, amountMinor:local.amountMinor ?? 123456,
    currency:'CNY', refundId:null, merchantRefundId:null, refundAmountMinor:0, refundStatus:null, ...changes};
}

function refund(local, changes = {}) {
  return success(local, {status:'REFUND', amountMinor:0, occurredAt:dayStart + 90000,
    refundId:merchantNumber(), merchantRefundId:merchantNumber(), refundAmountMinor:39, refundStatus:'PROCESSING',
    ...changes});
}

function bill(rows) {
  return {billDate, merchantId, appId, sha1, summary:{rowCount:rows.length}, rows};
}

function find(report, local) {
  const order = report.orders.find(row => row.merchantOrderId === local.merchantOrderId);
  assert.ok(order, 'Expected a reconciliation entry for the synthetic merchant order');
  return order;
}

test('matching gross cents and the provider payment second include the Beijing day start', async t => {
  const f = await fixture(t);
  const local = f.receipt(f.order({amountMinor:109}), {paidAt:dayStart + 137});
  const report = f.reconcile(bill([success(local)]));
  const row = find(report, local);
  assert.equal(report.billDate, billDate);
  assert.equal(report.merchantId, merchantId);
  assert.equal(report.appId, appId);
  assert.equal(report.statementSha1, sha1);
  assert.equal(report.orders.length, 1);
  assert.equal(report.counts.statementRows, 1);
  assert.equal(report.counts.scopedRows, 1);
  assert.equal(report.counts.matchedPayments, 1);
  assert.equal(row.currency, 'CNY');
  assert.equal(row.local.amountMinor, 109);
  assert.equal(row.local.paidAt, dayStart + 137);
  assert.equal(row.local.transactionId, local.transactionId);
  assert.equal(row.statementPayments[0].amountMinor, 109);
  assert.equal(row.statementPayments[0].occurredAt, dayStart);
  assert.deepEqual(row.statementRefunds, []);
  assert.deepEqual(row.findings, ['ENTITLEMENT_PENDING']);
});

test('missing statement items are selected by local payment time through the last millisecond of the Beijing day', async t => {
  const f = await fixture(t);
  const previous = f.receipt(f.order(), {paidAt:dayStart - 1});
  const missing = f.receipt(f.order(), {paidAt:dayEnd - 1, firstVerifiedAt:dayEnd + 2000});
  const next = f.receipt(f.order(), {paidAt:dayEnd});
  const report = f.reconcile(bill([]));
  assert.equal(report.orders.length, 1);
  assert.equal(report.counts.matchedPayments, 0);
  assert.ok(find(report, missing).findings.includes('PAYMENT_MISSING_FROM_STATEMENT'));
  assert.deepEqual(find(report, missing).statementPayments, []);
  assert.ok(!report.orders.some(row => [previous.merchantOrderId, next.merchantOrderId].includes(row.merchantOrderId)));
});

test('verified statement rows can lack a local receipt or the entire local order', async t => {
  const f = await fixture(t);
  const local = f.order();
  const noOrder = success();
  const report = f.reconcile(bill([noOrder, success(local)]));
  assert.equal(report.counts.matchedPayments, 0);
  assert.equal(report.counts.ordersWithFindings, 2);
  assert.ok(find(report, local).findings.includes('PAYMENT_NOT_RECORDED'));
  assert.ok(find(report, noOrder).findings.includes('ORDER_NOT_FOUND'));
  assert.equal(find(report, noOrder).local, null);
  assert.deepEqual(report.orders.map(row => row.merchantOrderId),
    [noOrder.merchantOrderId, local.merchantOrderId].sort());
});

test('other app and trade types are filtered while a same-number local collision is reported', async t => {
  const f = await fixture(t);
  const colliding = f.order();
  const anotherApp = success({}, {appId:'wxother'});
  const anotherType = success({}, {tradeType:'JSAPI'});
  const conflicting = success(colliding, {tradeType:'JSAPI'});
  const report = f.reconcile(bill([anotherApp, anotherType, conflicting]));
  assert.equal(report.counts.statementRows, 3);
  assert.equal(report.counts.scopedRows, 0);
  assert.equal(report.counts.excludedRows, 3);
  assert.equal(report.orders.length, 1);
  assert.deepEqual(find(report, colliding).findings, ['ORDER_SCOPE_MISMATCH']);
  assert.deepEqual(find(report, colliding).statementPayments, []);
});

test('matching the order number still reports transaction, currency, gross amount, and payment-time discrepancies', async t => {
  const f = await fixture(t);
  const paid = f.receipt(f.order());
  const mismatch = success(paid, {transactionId:merchantNumber(), currency:'USD', amountMinor:paid.amountMinor - 1,
    occurredAt:paid.paidAt + 1000});
  const report = f.reconcile(bill([mismatch]));
  const row = find(report, paid);
  assert.equal(report.counts.matchedPayments, 0);
  assert.deepEqual(row.findings.filter(code => code.endsWith('_MISMATCH')).sort(),
    ['AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'PAID_AT_MISMATCH', 'TRANSACTION_ID_MISMATCH']);
  assert.equal(row.currency, 'CNY');
  assert.equal(row.local.amountMinor, paid.amountMinor);
  assert.equal(row.statementPayments[0].amountMinor, paid.amountMinor - 1);
  assert.ok(!row.findings.includes('PAYMENT_MISSING_FROM_STATEMENT'));
});

test('refund snapshots remain review evidence even when a refund claims success or exceeds the locked gross amount', async t => {
  const f = await fixture(t);
  const locked = f.order({createdAt:dayStart - 4 * 60000, amountMinor:109});
  const paid = f.receipt(locked, {paidAt:dayStart - 60000});
  const report = f.reconcile(bill([
    refund(paid),
    refund(paid, {refundAmountMinor:110, refundStatus:'SUCCESS'}),
  ]));
  const row = find(report, paid);
  assert.equal(report.counts.refundRows, 2);
  assert.equal(report.counts.matchedPayments, 0);
  assert.deepEqual(row.statementPayments, []);
  assert.deepEqual(row.statementRefunds.map(item => item.status).sort(), ['PROCESSING', 'SUCCESS']);
  assert.ok(row.findings.includes('REFUND_REQUIRES_REVIEW'));
  assert.ok(row.findings.includes('REFUND_AMOUNT_EXCEEDS_ORDER'));
});

test('payment exactly at the locked expiry reconciles its facts while remaining in local review', async t => {
  const f = await fixture(t);
  const locked = f.order({expiresAt:dayStart + 120000});
  const paid = f.receipt(locked, {paidAt:locked.expiresAt});
  const report = f.reconcile(bill([success(paid)]));
  assert.equal(report.counts.matchedPayments, 1);
  assert.ok(find(report, paid).findings.includes('LOCAL_PAYMENT_REQUIRES_REVIEW'));
  assert.equal(f.db.prepare('SELECT count(*) AS hits FROM main.team_billing_wechat_native_fulfilments').get().hits, 0);
});

test('duplicate payment and refund identities are rejected without changing the ledger', async t => {
  const f = await fixture(t);
  const payment = success();
  const returned = refund(payment);
  const rejected = {code:'WECHAT_NATIVE_TRADE_BILL_INVALID'};
  const lists = [
    [payment, {...payment, transactionId:merchantNumber()}],
    [payment, {...payment, merchantOrderId:merchantNumber()}],
    [returned, {...returned, merchantRefundId:merchantNumber()}],
    [returned, {...returned, refundId:merchantNumber()}],
  ];
  for (const rows of lists) assert.throws(() => f.reconcile(bill(rows)), rejected);
});

test('statement rows outside the Beijing bill window and mismatched evidence metadata are rejected', async t => {
  const f = await fixture(t);
  const payment = success();
  const rejected = {code:'WECHAT_NATIVE_TRADE_BILL_INVALID'};
  for (const occurredAt of [dayStart - 1000, dayStart + 1, dayEnd]) {
    assert.throws(() => f.reconcile(bill([{...payment, occurredAt}])), rejected);
  }
  const source = bill([payment]);
  for (const change of [{summary:{rowCount:2}}, {sha1:'invalid'}, {billDate:'2023-02-29'}, {merchantId:'2000000000'}]) {
    assert.throws(() => f.reconcile({...source, ...change}), rejected);
  }
});
