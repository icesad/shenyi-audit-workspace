'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const directory = path.join(__dirname, '../desktop/team-ui');
const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(directory, 'billing.js'), 'utf8');
const ok = value => ({ ok: true, value });
const fail = code => ({ ok: false, error: { code } });
const termStart = 1735660800000;
const termEnd = 1767196800000;
const amountMinor = Number.MAX_SAFE_INTEGER;
const annual = { id: 'annual-2026', revision: 3, product: 'team-annual-renewal', amountMinor, currency: 'CNY' };
const seat = { id: 'seat-2026', revision: 2, product: 'team-seat-addition', annualUnitAmountMinor: 48000, currency: 'CNY' };
const teams = [{ id: 'a', name: '甲队' }, { id: 'b', name: '乙队' }];

function order(id, status = 'pending', teamId = 'a') {
  return { id, status, teamId, offer: annual, createdAt: termStart, confirmedAt: status === 'pending' ? null : termStart, fulfilment: status === 'paid' ? { renewalStartsAt: termStart, endsAt: termEnd } : null };
}

function snapshot(teamId, committedSeats = 5, defaultSeats = 8) {
  return {
    teamId, simulation: true, subscription: { state: 'scheduled', startsAt: termStart, endsAt: termEnd },
    seats: { purchasedSeats: 7, activeBusinessSeats: 3, reservedInvitationSeats: 2, usedSeats: 5, availableSeats: 2 },
    annualOffers: [annual], renewalSeats: { defaultSeats, committedSeats }, seatOffer: seat, canReconcile: true
  };
}

function managedSnapshot(teamId, { state = 'active', purchased = 7, reminderDays } = {}) {
  return {
    teamId, simulation: false,
    subscription: { state, startsAt: termStart, endsAt: termEnd, ...(reminderDays === undefined ? {} : { renewalReminderDays: reminderDays }) },
    seats: { purchasedSeats: purchased, activeBusinessSeats: 3, reservedInvitationSeats: 2, usedSeats: 5, availableSeats: purchased - 5 }
  };
}

async function until(expectation) {
  const limit = Date.now() + 3000;
  while (!expectation()) {
    assert.ok(Date.now() < limit, 'billing view did not reach expected state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(settle => { resolve = settle; });
  return { promise, resolve };
}

function fixture(t, overrides = {}) {
  const dom = new JSDOM(html, { url: 'https://synthetic.invalid/', runScripts: 'outside-only' });
  const { window } = dom;
  t.after(() => window.close());
  window.eval(script);
  const context = { identity: 'admin', actor: 'admin:1', device: 'device:1', teamId: 'a', ready: true, busy: false };
  const calls = [];
  const callbacks = [];
  const handlers = {
    getBillingAccess: () => ok({ teams }),
    getBillingOverview: ({ teamId }) => ok(snapshot(teamId)),
    listBillingOrders: () => ok({ orders: [], hasMore: false, nextCursor: null }),
    getBillingOrder: ({ orderId, teamId }) => ok({ order: order(orderId, 'pending', teamId) }),
    createBillingOrder: ({ teamId }) => ok({ order: order('created', 'pending', teamId) }),
    reconcileBillingOrder: ({ orderId, teamId }) => ok({ order: order(orderId, 'paid', teamId) }),
    ...overrides
  };
  const api = Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, typeof handler === 'function' ? async input => {
    calls.push({ name, input });
    return handler(input);
  } : handler]));
  const view = window.createBillingView({ api, getContext: () => context, onUnauthorized: () => callbacks.push('logout'), onDeviceUnavailable: () => callbacks.push('device') });
  const id = name => window.document.getElementById('billing-' + name);
  const panel = id('panel');
  view.update();
  function change(name, value, event = 'change') {
    const input = id(name);
    input.value = value;
    input.dispatchEvent(new window.Event(event, { bubbles: true }));
  }
  async function open() {
    await until(() => !panel.hidden);
    panel.querySelector('summary').click();
    await until(() => !id('overview').hidden);
  }
  return { id, calls, callbacks, context, view, panel, open, change };
}

test('managed billing renders terms and seats while keeping all order actions closed through refresh', async t => {
  let overview = managedSnapshot('a');
  const f = fixture(t, { getBillingOverview: () => ok(overview), reconcileBillingPage: () => ok({}) });
  const metrics = () => [...f.id('seats').querySelectorAll('dt, dd')].map(element => element.textContent);
  const orderCalls = () => f.calls.filter(call => /^(listBillingOrders|createBillingOrder|reconcileBillingOrder|reconcileBillingPage)$/.test(call.name));
  await f.open();
  assert.match(f.id('notice').textContent, /仅可查阅订阅与席位/);
  assert.match(f.id('term').textContent, /有效.*2025.*至.*2026.*北京时间/);
  assert.equal(f.id('expiry-reminder').hidden, true);
  assert.deepEqual(metrics(), ['已购', '7', '已启用', '3', '邀请预留', '2', '合计占用', '5', '可用', '2']);
  assert.equal(f.id('checkout-section').hidden, true);
  assert.equal(f.id('orders-section').hidden, true);
  assert.equal(f.id('order-list').childElementCount, 0);
  assert.deepEqual(orderCalls(), []);

  f.change('order-kind', 'seat');
  for (const button of ['orders-refresh', 'review', 'confirm', 'batch-start']) f.id(button).click();
  overview = managedSnapshot('a', { state: 'expired', purchased: 9 });
  assert.equal(f.id('refresh').disabled, false);
  f.id('refresh').click();
  await until(() => f.id('term').textContent.includes('已到期'));
  assert.equal(f.id('expiry-reminder').hidden, false);
  assert.equal(f.id('expiry-reminder').textContent, '业务新增和修改已暂停。已有资料仍可按原权限查阅或导出。');
  assert.equal(f.calls.filter(call => call.name === 'getBillingOverview').length, 2);
  assert.deepEqual(metrics(), ['已购', '9', '已启用', '3', '邀请预留', '2', '合计占用', '5', '可用', '4']);
  assert.equal(f.id('checkout-section').hidden, true);
  assert.equal(f.id('orders-section').hidden, true);
  assert.equal(f.id('confirmation').hidden, true);
  assert.deepEqual(orderCalls(), []);
});

test('managed billing displays the scoped server reminder and clears it on team change', async t => {
  const next = deferred();
  const f = fixture(t, { getBillingOverview: ({ teamId }) => teamId === 'a' ? ok(managedSnapshot('a', { reminderDays: 1 })) : next.promise });
  await f.open();
  assert.equal(f.id('expiry-reminder').hidden, false);
  assert.equal(f.id('expiry-reminder').textContent, '团队年订阅将在 24 小时内到期。请提前安排续费。');
  assert.equal(f.id('checkout-section').hidden, true);
  f.change('team', 'b');
  assert.equal(f.id('expiry-reminder').hidden, true);
  assert.equal(f.id('expiry-reminder').textContent, '');
  next.resolve(ok(managedSnapshot('b', { reminderDays: 8 })));
  await until(() => !f.id('overview').hidden);
  assert.equal(f.id('expiry-reminder').textContent, '团队年订阅将在 8 天内到期。请提前安排续费。');
});

test('managed billing clears terms and reminders on close and ignores an in-flight overview after sign-out', async t => {
  const pending = deferred();
  let reads = 0;
  const f = fixture(t, { getBillingOverview: () => ++reads === 1 ? ok(managedSnapshot('a', { reminderDays: 30 })) : pending.promise });
  await f.open();
  assert.match(f.id('term').textContent, /有效/);
  assert.match(f.id('expiry-reminder').textContent, /30 天内到期/);
  f.panel.open = false;
  await until(() => f.id('overview').hidden);
  assert.equal(f.id('term').textContent, '');
  assert.equal(f.id('seats').textContent, '');
  assert.equal(f.id('expiry-reminder').hidden, true);
  assert.equal(f.id('expiry-reminder').textContent, '');

  f.panel.open = true;
  await until(() => reads === 2);
  Object.assign(f.context, { ready: false, identity: '' });
  f.view.reset();
  pending.resolve(ok(managedSnapshot('a', { purchased: 9, reminderDays: 1 })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.panel.hidden, true);
  assert.equal(f.id('overview').hidden, true);
  assert.equal(f.id('term').textContent, '');
  assert.equal(f.id('seats').textContent, '');
  assert.equal(f.id('expiry-reminder').hidden, true);
  assert.equal(f.id('expiry-reminder').textContent, '');
  assert.equal(f.id('order-list').childElementCount, 0);
  assert.deepEqual(f.calls.map(call => call.name), ['getBillingAccess', 'getBillingOverview', 'getBillingOverview']);
});

test('simulation-only fields cannot enable simulated checkout in a managed view', async t => {
  const f = fixture(t, { getBillingOverview: () => ok({ ...snapshot('a'), ...managedSnapshot('a') }) });
  await f.open();
  assert.match(f.id('notice').textContent, /只读|仅可查阅/);
  assert.match(f.id('term').textContent, /有效/);
  assert.equal(f.id('checkout-section').hidden, true);
  assert.equal(f.id('orders-section').hidden, true);
  assert.equal(f.id('annual-offer').options.length, 0);
  assert.deepEqual(f.calls.map(call => call.name), ['getBillingAccess', 'getBillingOverview']);
});

test('billing defaults to the prior-term seat quantity, protects reductions and displays the exact server amount', async t => {
  const f = fixture(t);
  await f.open();
  assert.match(f.id('notice').textContent, /本机模拟账务/);
  assert.equal(f.id('checkout-section').hidden, false);
  assert.equal(f.id('orders-section').hidden, false);
  assert.match(f.id('term').textContent, /待生效.*北京时间/);
  assert.deepEqual([...f.id('seats').querySelectorAll('dd')].map(node => node.textContent), ['7', '3', '2', '5', '2']);
  assert.equal(f.id('selected-seats').value, '8');
  assert.equal(f.id('selected-seats').min, '5');
  assert.equal(f.id('batch-section').hidden, true);
  f.change('selected-seats', '4', 'input');
  f.id('review').click();
  assert.equal(f.id('confirmation').hidden, true);
  assert.match(f.id('message').textContent, /至少需要 5 席/);
  f.change('selected-seats', '6', 'input');
  f.id('review').click();
  assert.match(f.id('confirm-text').textContent, /甲队.*模拟订单，续费 6 席/);
  assert.equal(f.calls.some(call => call.name === 'createBillingOrder'), false);
  f.id('confirm').click();
  await until(() => !!f.id('order-list').querySelector('[data-order-id="created"]'));
  assert.match(f.id('order-list').textContent, /90,071,992,547,409\.91/);
  assert.equal(f.calls.find(call => call.name === 'createBillingOrder').input.selectedSeats, 6);
});

test('zero-seat renewal and an uncertain same-intent retry reuse the request UUID through device pause', async t => {
  let attempts = 0;
  const first = deferred();
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok(snapshot(teamId, 0, 0)),
    createBillingOrder: ({ teamId }) => ++attempts === 1 ? first.promise : ok({ order: order('created', 'pending', teamId) })
  });
  await f.open();
  assert.equal(f.id('selected-seats').value, '0');
  f.id('review').click();
  f.id('confirm').click();
  assert.equal(f.id('confirm').disabled, true);
  f.id('confirm').click();
  assert.equal(attempts, 1);
  f.context.ready = false;
  f.view.update();
  assert.equal(f.panel.hidden, true);
  assert.equal(f.id('confirm-text').textContent, '');
  first.resolve(fail('NETWORK'));
  await until(() => f.id('order-list').childElementCount === 0);
  Object.assign(f.context, { ready: true, actor: 'admin:2', device: 'device:2' });
  f.view.update();
  await f.open();
  f.id('review').click();
  f.id('confirm').click();
  await until(() => !!f.id('order-list').querySelector('[data-order-id="created"]'));
  const intents = f.calls.filter(call => call.name === 'createBillingOrder').map(call => call.input);
  assert.deepEqual(intents[0], intents[1]);
  assert.equal(intents[0].selectedSeats, 0);
  assert.match(intents[0].requestId, /^[a-f0-9-]{36}$/);
  f.change('order-kind', 'seat');
  f.change('seat-quantity', '1001', 'input');
  f.id('review').click();
  assert.match(f.id('message').textContent, /1 至 1000/);
  assert.equal(f.id('confirmation').hidden, true);
});

test('a late order or access response cannot populate another team or ended session', async t => {
  const delayedA = deferred();
  const delayedB = deferred();
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => teamId === 'a' ? delayedA.promise : delayedB.promise
  });
  await until(() => !f.panel.hidden);
  f.panel.querySelector('summary').click();
  await until(() => f.calls.some(call => call.name === 'getBillingOverview'));
  f.change('team', 'b');
  delayedA.resolve(ok(snapshot('a')));
  await until(() => f.calls.filter(call => call.name === 'getBillingOverview').length === 2);
  f.context.ready = false;
  f.context.identity = '';
  f.view.reset();
  delayedB.resolve(ok(snapshot('b')));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.panel.hidden, true);
  assert.equal(f.id('team').options.length, 0);
  assert.equal(f.id('seats').textContent, '');
  assert.equal(f.calls.some(call => call.name === 'listBillingOrders'), false);
});

test('all cursor pages remain reachable and reconciling a paid order keeps its page', async t => {
  const f = fixture(t, {
    listBillingOrders: ({ after }) => {
      const index = after == null ? 0 : Number(after);
      return ok({ orders: [order('row-' + index)], hasMore: index < 6, nextCursor: index < 6 ? String(index + 1) : null });
    }
  });
  await f.open();
  await until(() => !!f.id('order-list').querySelector('[data-order-id="row-0"]'));
  for (let i = 1; i <= 6; i++) {
    f.id('orders-more').click();
    await until(() => !!f.id('order-list').querySelector('[data-order-id="row-' + i + '"]'));
    assert.equal(f.id('order-list').childElementCount, 1);
  }
  assert.equal(f.id('orders-more').hidden, true);
  f.id('order-list').querySelector('[data-billing-reconcile]').click();
  await until(() => f.id('message').textContent === '模拟订单已到账。');
  assert.ok(f.id('order-list').querySelector('[data-order-id="row-6"] [data-state="paid"]'));
  f.id('orders-previous').click();
  await until(() => !!f.id('order-list').querySelector('[data-order-id="row-5"]'));
  assert.equal(f.calls.filter(call => call.name === 'listBillingOrders').at(-1).input.after, '5');
});

test('a trusted exception stays visible with historical order facts and clears on a team change', async t => {
  const refund = { kind: 'refund', occurredAt: termStart + 1000, state: 'review-required' };
  const chargeback = { kind: 'chargeback', occurredAt: termStart + 2000, state: 'review-required' };
  const pending = { ...order('pending'), quantity: 2, termEndsAt: termEnd, paymentException: chargeback };
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok({ ...snapshot(teamId), ...(teamId === 'a' ? { canReconcilePaymentExceptions: true } : {}) }),
    listBillingOrders: ({ teamId, kind }) => ok({ orders: kind === 'seat' ? [pending] : [order('annual-paid', 'paid', teamId)], hasMore: false, nextCursor: null }),
    reconcileBillingOrder: ({ kind }) => kind === 'annual'
      ? ok({ order: { ...order('annual-paid', 'paid'), paymentException: refund } })
      : ok({ order: { ...pending, status: 'payment-verified', confirmedAt: termStart + 3000 } })
  });
  const row = id => f.id('order-list').querySelector('[data-order-id="' + id + '"]');
  const action = id => row(id)?.querySelector('[data-billing-reconcile]');
  await f.open();
  await until(() => !!action('annual-paid') && !action('annual-paid').disabled);
  const previousTerm = f.id('term').textContent;
  const previousSeats = f.id('seats').textContent;
  action('annual-paid').click();
  await until(() => f.id('message').textContent === '模拟订单 · 退款待复核。');
  assert.equal(row('annual-paid').querySelector('[data-state="paid"]').textContent, '已到账');
  assert.equal(row('annual-paid').querySelector('[data-payment-exception="refund"]').textContent, '退款待复核');
  assert.match(row('annual-paid').textContent, /异常发生于.*北京时间，模拟.*续费期限/);
  assert.equal(action('annual-paid'), null);
  assert.equal(f.id('term').textContent, previousTerm);
  assert.equal(f.id('seats').textContent, previousSeats);

  f.change('order-kind', 'seat');
  await until(() => !!action('pending') && !action('pending').disabled);
  assert.equal(row('pending').querySelector('[data-state="pending"]').textContent, '未确认收款');
  assert.equal(row('pending').querySelector('[data-payment-exception="chargeback"]').textContent, '拒付待复核');
  action('pending').click();
  await until(() => f.id('message').textContent === '模拟订单 · 拒付待复核。');
  assert.equal(row('pending').querySelector('[data-state="payment-verified"]').textContent, '已核验收款');

  f.change('order-kind', 'annual');
  f.change('team', 'b');
  await until(() => f.calls.some(call => call.name === 'listBillingOrders' && call.input.teamId === 'b') && !!row('annual-paid'));
  assert.equal(f.id('order-list').querySelector('[data-payment-exception]'), null);
  assert.equal(action('annual-paid'), null);
  assert.doesNotMatch(f.id('message').textContent, /退款|拒付/);
});

test('a late trusted exception response cannot populate a signed-out billing view', async t => {
  const review = deferred();
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok({ ...snapshot(teamId), canReconcilePaymentExceptions: true }),
    listBillingOrders: () => ok({ orders: [order('annual-paid', 'paid')], hasMore: false, nextCursor: null }),
    reconcileBillingOrder: () => review.promise
  });
  await f.open();
  const button = () => f.id('order-list').querySelector('[data-billing-reconcile]');
  await until(() => !!button() && !button().disabled);
  button().click();
  await until(() => f.calls.some(call => call.name === 'reconcileBillingOrder'));
  Object.assign(f.context, { ready: false, identity: '' });
  f.view.reset();
  review.resolve(ok({ order: { ...order('annual-paid', 'paid'), paymentException: { kind: 'refund', occurredAt: termStart, state: 'review-required' } } }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.panel.hidden, true);
  assert.equal(f.id('order-list').childElementCount, 0);
  assert.equal(f.id('message').textContent, '');
});

test('only a verified eligible order can recover without a gateway lookup action', async t => {
  const verified = order('current', 'payment-verified');
  const pending = order('pending');
  const exceptional = { ...order('exceptional', 'payment-verified'), paymentException: { kind: 'refund', occurredAt: termStart + 1 } };
  const closed = { ...order('closed', 'payment-verified'), closure: { closedAt: termStart + 1, deadlineAt: termStart + 1 } };
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok({ ...snapshot(teamId), canReconcile: false, canResumeFulfilment: true }),
    listBillingOrders: () => ok({ orders: [verified, pending, exceptional, closed], hasMore: false, nextCursor: null })
  });
  await f.open();
  const actions = () => [...f.id('order-list').querySelectorAll('[data-billing-reconcile]')];
  await until(() => actions().length === 1 && !actions()[0].disabled);
  assert.equal(actions()[0].dataset.billingReconcile, 'current');
  assert.equal(actions()[0].textContent, '恢复兑现');
  actions()[0].click();
  await until(() => f.id('message').textContent === '模拟订单已按原收款记录恢复兑现。');
  assert.equal(actions().length, 0);
  const calls = f.calls.filter(call => call.name === 'reconcileBillingOrder');
  assert.equal(calls.length, 1);
  assert.deepEqual({ ...calls[0].input }, { teamId: 'a', kind: 'annual', orderId: 'current', source: 'recorded-payment' });
});

test('reconciliation restores a replacement action for the same order or the order heading when the action ends', async t => {
  const responses = [order('current'), order('current', 'paid')];
  const f = fixture(t, {
    listBillingOrders: () => ok({ orders: [order('current')], hasMore: false, nextCursor: null }),
    reconcileBillingOrder: () => ok({ order: responses.shift() })
  });
  const document = f.panel.ownerDocument;
  const action = () => f.id('order-list').querySelector('[data-billing-reconcile="current"]');
  document.getElementById('workspace-view').hidden = false;
  await f.open();
  await until(() => action() && !action().disabled);
  const before = action();
  before.focus();
  before.click();
  await until(() => action() !== before && document.activeElement === action());
  action().click();
  await until(() => document.activeElement === f.id('orders-heading'));
  assert.equal(action(), null);
  assert.equal(f.calls.filter(call => call.name === 'reconcileBillingOrder').length, 2);
});

test('a reconciliation response leaves focus alone once the user has moved to another field', async t => {
  const response = deferred();
  const f = fixture(t, {
    listBillingOrders: () => ok({ orders: [order('current')], hasMore: false, nextCursor: null }),
    reconcileBillingOrder: () => response.promise
  });
  const document = f.panel.ownerDocument;
  const action = () => f.id('order-list').querySelector('[data-billing-reconcile="current"]');
  document.getElementById('workspace-view').hidden = false;
  await f.open();
  await until(() => action() && !action().disabled);
  const before = action();
  before.focus();
  before.click();
  const other = document.getElementById('username');
  other.focus();
  assert.equal(document.activeElement, other);
  other.blur();
  response.resolve(ok({ order: order('current') }));
  await until(() => action() !== before && !action().disabled);
  assert.equal(document.activeElement, document.body);
});

test('a failed first batch moves keyboard focus to the existing retry action without issuing another request', async t => {
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok({ ...snapshot(teamId), canReconcileBillingBatch: true }),
    reconcileBillingPage: () => fail('UNAVAILABLE')
  });
  const document = f.panel.ownerDocument;
  document.getElementById('workspace-view').hidden = false;
  await f.open();
  await until(() => !f.id('batch-start').disabled);
  f.id('batch-start').focus();
  f.id('batch-start').click();
  await until(() => document.activeElement === f.id('batch-retry'));
  assert.match(f.id('batch-message').textContent, /请重试本批/);
  assert.equal(f.calls.filter(call => call.name === 'reconcileBillingPage').length, 1);
});

test('elapsed annual deadlines stay pending until closure evidence, and later verified receipts stay in review', async t => {
  const deadlineAt = termStart + 3000, closedAt = deadlineAt + 500, id = 'closure-order';
  const pending = { ...order(id), paymentDeadlineAt: deadlineAt };
  const closed = { ...pending, status: 'closed', closure: { deadlineAt, closedAt } };
  const late = { ...closed, status: 'payment-verified', confirmedAt: closedAt + 500 };
  const verified = [closed, late];
  const f = fixture(t, {
    listBillingOrders: () => ok({ orders: [pending], hasMore: false, nextCursor: null }),
    reconcileBillingOrder: () => ok({ order: verified.shift() })
  });
  const row = () => f.id('order-list').querySelector(`[data-order-id="${id}"]`);
  const state = () => row()?.querySelector('[data-state]');
  const reconcile = () => row()?.querySelector('[data-billing-reconcile]');
  await f.open();
  await until(() => reconcile() && !reconcile().disabled);
  assert.equal(state().dataset.state, 'pending');
  assert.match(row().textContent, /支付期限至 .*北京时间/u);
  assert.equal(row().querySelector('[data-order-closure]'), null);

  reconcile().click();
  await until(() => state()?.dataset.state === 'closed' && !reconcile().disabled);
  assert.equal(state().textContent, '超时关闭');
  assert.match(row().querySelector('[data-order-closure]').textContent, /超时关闭于 .*北京时间/u);
  assert.match(f.id('message').textContent, /超时关闭/u);
  assert.doesNotMatch(row().textContent, /收款确认|已到账/u);

  reconcile().click();
  await until(() => !!row()?.querySelector('[data-closure-review]'));
  assert.equal(state().dataset.state, 'payment-verified');
  assert.equal(state().textContent, '迟到收款待复核');
  assert.match(row().textContent, /收款确认.*超时关闭于/u);
  assert.doesNotMatch(row().textContent, /已到账|续费期限|席位适用期限/u);
  assert.match(f.id('message').textContent, /迟到收款待复核/u);
  assert.equal(f.calls.filter(call => call.name === 'getBillingOverview').length, 1);
  assert.equal(f.calls.filter(call => call.name === 'reconcileBillingOrder').length, 2);
});

test('a coalesced close and reopen suppresses an ended billing read', async t => {
  const old = deferred();
  const fresh = deferred();
  let readings = 0;
  const f = fixture(t, { getBillingOverview: () => ++readings === 1 ? old.promise : fresh.promise });
  await until(() => !f.panel.hidden);
  f.panel.open = true;
  await until(() => readings === 1);
  old.resolve(fail('SIGN_IN_REQUIRED'));
  f.panel.open = false;
  f.panel.open = true;
  await until(() => readings === 2);
  fresh.resolve(ok(snapshot('a')));
  await until(() => !f.id('overview').hidden);
  assert.deepEqual(f.callbacks, []);
});

const batchId = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const batchRow = (number, outcome, status = 'pending', paymentException = false) =>
  ({ orderId: batchId(number), outcome, status, paymentException });

test('batch results show confirmed closure distinctly from an unconfirmed gateway response', async t => {
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok({ ...snapshot(teamId), canReconcileBillingBatch: true }),
    reconcileBillingPage: () => ok({
      results: [batchRow(1, 'closed', 'closed'), batchRow(2, 'no-evidence')],
      nextCursor: null
    })
  });
  await f.open();
  await until(() => !f.id('batch-start').disabled);
  f.id('batch-start').click();
  await until(() => f.id('batch-results').childElementCount === 2);
  const found = f.id('batch-results').querySelector('[data-outcome="closed"]');
  assert.equal(found.dataset.batchOrderId, batchId(1));
  assert.match(found.textContent, /超时关闭.*账本 · 超时关闭/u);
  const unconfirmed = f.id('batch-results').querySelector('[data-outcome="no-evidence"]');
  assert.match(unconfirmed.textContent, /未返回可信凭据.*账本 · 待支付/u);
  assert.match(f.id('batch-message').textContent, /超时关闭 1 笔/u);
});

test('batch reports retain the independent order page while refreshing, and retry the attempted cursor', async t => {
  const first = deferred();
  const firstBatch = [
    batchRow(0, 'no-evidence'), batchRow(1, 'matched', 'paid'),
    batchRow(2, 'awaiting-review', 'payment-verified', true), batchRow(3, 'lookup-unavailable'),
    batchRow(4, 'evidence-rejected'), batchRow(5, 'local-failure'),
    batchRow(6, 'matched', 'paid'), batchRow(7, 'no-evidence')
  ];
  let attempts = 0, matched = false;
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => {
      const overview = snapshot(teamId);
      if (matched) overview.seats.purchasedSeats = 9;
      return ok({ ...overview, canReconcileBillingBatch: true });
    },
    listBillingOrders: ({ after }) => ok(after
      ? { orders: [order('second-page', matched ? 'paid' : 'pending')], hasMore: false, nextCursor: null }
      : { orders: [order('first-page')], hasMore: true, nextCursor: 'list-page-2' }),
    reconcileBillingPage: () => {
      attempts++;
      if (attempts === 1) return first.promise;
      if (attempts === 2) return fail('NETWORK');
      return ok({ results: [batchRow(8, 'matched', 'paid')], nextCursor: null });
    }
  });
  const batchCalls = () => f.calls.filter(call => call.name === 'reconcileBillingPage').map(call => ({ ...call.input }));
  await f.open();
  await until(() => !f.id('orders-more').disabled);
  f.id('orders-more').click();
  await until(() => !f.id('batch-start').disabled);
  f.change('selected-seats', '6', 'input');
  f.id('batch-start').click();
  assert.equal(f.id('batch-start').disabled, true);
  f.id('batch-start').click();
  assert.equal(attempts, 1);
  matched = true;
  first.resolve(ok({ results: firstBatch, nextCursor: batchId(7) }));
  await until(() => !f.id('batch-next').disabled);
  assert.equal(f.id('batch-section').hidden, false);
  assert.equal(f.id('batch-next').hidden, false);
  assert.equal(f.id('batch-results').childElementCount, 8);
  assert.match(f.id('batch-message').textContent, /本批 8 笔.*已核实 2 笔.*待复核 1 笔.*未返回可信凭据 2 笔/u);
  assert.match(f.id('batch-results').querySelector('[data-outcome="awaiting-review"]').textContent, /支付异常待复核/u);
  assert.ok(f.id('order-list').querySelector('[data-order-id="second-page"] [data-state="paid"]'));
  assert.equal(f.id('seats').querySelector('dd').textContent, '9');
  assert.equal(f.id('selected-seats').value, '6');

  f.id('orders-refresh').click();
  await until(() => !f.id('batch-next').disabled);
  assert.equal(f.id('batch-results').childElementCount, 8);

  f.id('batch-next').click();
  await until(() => f.id('batch-message').classList.contains('error'));
  assert.equal(f.id('batch-next').hidden, true);
  assert.equal(f.id('batch-results').childElementCount, 8);
  f.id('batch-retry').click();
  await until(() => !!f.id('batch-results').querySelector('[data-batch-order-id="' + batchId(8) + '"]'));
  assert.equal(f.id('batch-results').childElementCount, 1);
  assert.equal(f.id('batch-next').hidden, true);
  assert.deepEqual(batchCalls(), [
    { teamId: 'a', kind: 'annual' },
    { teamId: 'a', kind: 'annual', after: batchId(7) },
    { teamId: 'a', kind: 'annual', after: batchId(7) }
  ]);
  assert.equal(f.calls.filter(call => call.name === 'listBillingOrders').at(-1).input.after, 'list-page-2');
  f.change('order-kind', 'seat');
  await until(() => !f.id('batch-start').disabled);
  assert.equal(f.id('batch-results').childElementCount, 0);
  f.id('batch-start').click();
  assert.deepEqual(batchCalls().at(-1), { teamId: 'a', kind: 'seat' });
});

test('batch responses from a coalesced reopen, changed team, or ended session cannot update the report', async t => {
  const reopened = deferred();
  const switched = deferred();
  const signedOut = deferred();
  const queue = [reopened, switched, signedOut];
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok({ ...snapshot(teamId), canReconcileBillingBatch: true }),
    reconcileBillingPage: () => queue.shift().promise
  });
  await f.open();
  await until(() => !f.id('batch-start').disabled);
  f.id('batch-start').click();
  reopened.resolve(fail('SIGN_IN_REQUIRED'));
  f.panel.open = false;
  f.panel.open = true;
  await until(() => !f.id('batch-start').disabled);
  assert.equal(f.id('batch-message').textContent, '');
  assert.deepEqual(f.callbacks, []);

  f.id('batch-start').click();
  f.context.teamId = 'b';
  f.view.update();
  switched.resolve(ok({ results: [batchRow(0, 'matched', 'paid')], nextCursor: null }));
  await f.open();
  await until(() => !f.id('batch-start').disabled);
  assert.equal(f.id('batch-results').childElementCount, 0);
  assert.equal(f.id('batch-message').textContent, '');
  assert.equal(f.id('team').value, 'b');

  f.id('batch-start').click();
  Object.assign(f.context, { ready: false, identity: '' });
  f.view.reset();
  signedOut.resolve(ok({ results: [batchRow(1, 'matched', 'paid')], nextCursor: null }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.panel.hidden, true);
  assert.equal(f.id('batch-section').hidden, true);
  assert.equal(f.id('batch-results').childElementCount, 0);
  assert.equal(f.id('batch-message').textContent, '');
});

test('resumable batch retries keep a failed UUID and cursor while a completed manual retry creates a fresh request',async t=>{
  const first=deferred();let attempts=0;
  const results=Array.from({length:8},(_,index)=>batchRow(index,'no-evidence'));
  const page={results,nextCursor:batchId(7)};
  const f=fixture(t,{
    getBillingOverview:({teamId})=>ok({...snapshot(teamId),canReconcileBillingBatch:true,canResumeBillingBatch:true}),
    reconcileBillingPage:({after})=>++attempts===1?first.promise:ok(after?{results:[batchRow(8,'no-evidence')],nextCursor:null}:page),
  });
  const calls=()=>f.calls.filter(call=>call.name==='reconcileBillingPage').map(call=>({...call.input}));
  await f.open();await until(()=>!f.id('batch-start').disabled);
  f.id('batch-start').click();f.id('batch-start').click();assert.equal(attempts,1);
  const original=calls()[0];assert.match(original.requestId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  first.resolve(fail('BILLING_RECONCILIATION_RECEIPT_FAILED'));await until(()=>!f.id('batch-retry').hidden&&!f.id('batch-retry').disabled);
  assert.match(f.id('batch-message').textContent,/沿用原请求/);
  f.id('batch-retry').click();await until(()=>!f.id('batch-next').disabled);
  assert.deepEqual(calls()[1],original);
  f.id('batch-retry').click();await until(()=>calls().length===3&&!f.id('batch-next').disabled);
  assert.notEqual(calls()[2].requestId,original.requestId);
  assert.equal(Object.hasOwn(calls()[2],'after'),false);
  f.id('batch-next').click();await until(()=>calls().length===4&&!f.id('batch-next').disabled);
  assert.equal(calls()[3].after,batchId(7));assert.equal(calls()[3].kind,'annual');
  assert.notEqual(calls()[3].requestId,calls()[2].requestId);
  assert.equal(f.id('batch-next').hidden,true);
});

test('one uncertain batch resumes only after the same owner and actual binding recover from a transient pause',async t=>{
  const first=deferred();let attempts=0;
  const f=fixture(t,{
    getBillingOverview:({teamId})=>ok({...snapshot(teamId),canReconcileBillingBatch:true,canResumeBillingBatch:true}),
    reconcileBillingPage:()=>++attempts===1?first.promise:ok({results:[],nextCursor:null}),
  });
  Object.assign(f.context,{binding:'same-public-device-binding',paused:false});
  const calls=()=>f.calls.filter(call=>call.name==='reconcileBillingPage').map(call=>({...call.input}));
  await f.open();await until(()=>!f.id('batch-start').disabled);f.id('batch-start').click();const original=calls()[0];
  Object.assign(f.context,{ready:false,paused:true,actor:'undefined:2',device:'paused:2',teamId:''});f.view.update();
  assert.equal(f.panel.hidden,true);first.resolve(fail('SERVICE_UNAVAILABLE'));await new Promise(resolve=>setTimeout(resolve,10));
  Object.assign(f.context,{ready:false,paused:false,actor:'undefined:2',device:'same-binding:3'});f.view.update();
  Object.assign(f.context,{ready:true,paused:false,actor:'admin:3',device:'same-binding:3',teamId:'a'});f.view.update();
  await f.open();await until(()=>!f.id('batch-retry').hidden&&!f.id('batch-retry').disabled);
  assert.equal(calls().length,1);assert.match(f.id('batch-message').textContent,/不会自动提交/);
  f.id('batch-retry').click();await until(()=>calls().length===2&&!f.id('batch-retry').disabled);
  assert.deepEqual(calls()[1],original);assert.deepEqual(f.callbacks,[]);
});

test('uncertain batch IDs are retired on deliberate close, order kind, account, or actual device changes',async t=>{
  for(const change of ['close','kind','team','account','binding','actor','paused-binding','logout']){
    const f=fixture(t,{
      getBillingOverview:({teamId})=>ok({...snapshot(teamId),canReconcileBillingBatch:true,canResumeBillingBatch:true}),
      reconcileBillingPage:()=>fail('NETWORK'),
    });
    Object.assign(f.context,{binding:'first-public-binding',paused:false});
    const calls=()=>f.calls.filter(call=>call.name==='reconcileBillingPage').map(call=>({...call.input}));
    await f.open();await until(()=>!f.id('batch-start').disabled);f.id('batch-start').click();
    await until(()=>!f.id('batch-retry').hidden&&!f.id('batch-retry').disabled);const original=calls()[0];
    if(change==='close'){f.panel.querySelector('summary').click();await f.open();}
    else if(change==='kind')f.change('order-kind','seat');
    else if(change==='team')f.change('team','b');
    else if(change==='paused-binding'){
      Object.assign(f.context,{ready:false,paused:true,actor:'undefined:2',device:'paused:2'});f.view.update();
      Object.assign(f.context,{ready:true,paused:false,actor:'admin:3',device:'different-device:3',binding:'different-public-binding'});f.view.update();await f.open();
    }
    else if(change==='logout'){
      f.view.reset();Object.assign(f.context,{actor:'admin:new-login',device:'device:new-login'});f.view.update();await f.open();
    }
    else{
      if(change==='account')f.context.identity='next-account';
      if(change==='binding')f.context.binding='different-public-binding';
      f.context.actor='admin:changed';f.context.device='device:changed';f.view.update();await f.open();
    }
    await until(()=>!f.id('batch-start').disabled);assert.equal(f.id('batch-retry').hidden,true,change);
    f.id('batch-start').click();await until(()=>calls().length===2&&!f.id('batch-retry').disabled);
    assert.notEqual(calls()[1].requestId,original.requestId,change);
  }
});

test('a paused non-default team seat batch restores its authorized scope and cursor after a late successful response',async t=>{
  const pending=deferred();let attempts=0;
  const first={results:Array.from({length:8},(_,index)=>batchRow(index,'no-evidence')),nextCursor:batchId(7)};
  const second={results:[batchRow(8,'matched','paid')],nextCursor:null};
  const f=fixture(t,{
    getBillingOverview:({teamId})=>ok({...snapshot(teamId),canReconcileBillingBatch:true,canResumeBillingBatch:true}),
    reconcileBillingPage:()=>++attempts===1?ok(first):attempts===2?pending.promise:ok(second),
  });
  Object.assign(f.context,{binding:'same-public-device-binding',paused:false});
  const calls=()=>f.calls.filter(call=>call.name==='reconcileBillingPage').map(call=>({...call.input}));
  await f.open();f.change('team','b');await until(()=>!f.id('batch-start').disabled);
  f.change('order-kind','seat');await until(()=>!f.id('batch-start').disabled);f.id('batch-start').click();
  await until(()=>!f.id('batch-next').hidden&&!f.id('batch-next').disabled);f.id('batch-next').click();
  const original=calls()[1];assert.equal(original.teamId,'b');assert.equal(original.kind,'seat');assert.equal(original.after,batchId(7));
  Object.assign(f.context,{ready:false,paused:true,actor:'undefined:2',device:'paused:2',teamId:''});f.view.update();
  assert.equal(f.panel.hidden,true);assert.equal(f.id('order-kind').value,'annual');assert.equal(f.id('team').value,'');
  pending.resolve(ok(second));await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.id('batch-results').childElementCount,0);assert.equal(f.id('batch-message').textContent,'');
  Object.assign(f.context,{ready:true,paused:false,actor:'admin:3',device:'same-binding:3',teamId:'a'});f.view.update();
  await f.open();await until(()=>!f.id('batch-retry').hidden&&!f.id('batch-retry').disabled);
  assert.equal(f.id('team').value,'b');assert.equal(f.id('order-kind').value,'seat');assert.equal(calls().length,2);
  assert.equal(f.calls.filter(call=>call.name==='listBillingOrders').at(-1).input.kind,'seat');
  f.id('batch-retry').click();await until(()=>calls().length===3&&!f.id('batch-retry').disabled);
  assert.deepEqual(calls()[2],original);assert.deepEqual(f.callbacks,[]);
});

test('a paused batch is retired when fresh billing discovery no longer authorizes its original team',async t=>{
  let allowed=teams;
  const f=fixture(t,{
    getBillingAccess:()=>ok({teams:allowed}),
    getBillingOverview:({teamId})=>ok({...snapshot(teamId),canReconcileBillingBatch:true,canResumeBillingBatch:true}),
    reconcileBillingPage:()=>fail('NETWORK'),
  });
  Object.assign(f.context,{binding:'same-public-device-binding',paused:false});
  const calls=()=>f.calls.filter(call=>call.name==='reconcileBillingPage').map(call=>({...call.input}));
  await f.open();f.change('team','b');await until(()=>!f.id('batch-start').disabled);
  f.change('order-kind','seat');await until(()=>!f.id('batch-start').disabled);f.id('batch-start').click();
  await until(()=>!f.id('batch-retry').hidden&&!f.id('batch-retry').disabled);const original=calls()[0];
  Object.assign(f.context,{ready:false,paused:true,actor:'undefined:2',device:'paused:2',teamId:''});f.view.update();allowed=[teams[0]];
  Object.assign(f.context,{ready:true,paused:false,actor:'admin:3',device:'same-binding:3',teamId:'a'});f.view.update();
  await f.open();await until(()=>!f.id('batch-start').disabled);
  assert.equal(f.id('team').value,'a');assert.equal(f.id('order-kind').value,'annual');assert.equal(f.id('batch-retry').hidden,true);
  f.id('batch-start').click();await until(()=>calls().length===2&&!f.id('batch-retry').disabled);
  assert.notEqual(calls()[1].requestId,original.requestId);assert.equal(calls()[1].teamId,'a');assert.equal(calls()[1].kind,'annual');
});

const lookupId = 'abcdef01-0000-4000-8000-000000000001';
const otherLookupId = 'abcdef02-0000-4000-8000-000000000002';
const lookupCalls = f => f.calls.filter(call => call.name === 'getBillingOrder');
function lookUp(f, value) {
  f.change('order-lookup-id', value, 'input');
  f.id('order-lookup-submit').click();
}

test('exact order lookup normalizes a pasted UUID and Enter without changing pagination or reconciling', async t => {
  let pages = 0;
  const f = fixture(t, { listBillingOrders: () => ok(++pages === 1
    ? { orders: [order(otherLookupId)], hasMore: true, nextCursor: otherLookupId }
    : { orders: [], hasMore: false, nextCursor: null }) });
  await f.open();
  await until(() => f.id('order-list').childElementCount === 1);
  f.change('order-lookup-id', ' \t' + lookupId.toUpperCase() + '  ', 'input');
  const window = f.id('order-lookup-id').ownerDocument.defaultView;
  const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  f.id('order-lookup-id').dispatchEvent(event);
  await until(() => f.id('order-lookup-result').childElementCount === 1);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(lookupCalls(f).map(call => ({ ...call.input })), [{ teamId: 'a', kind: 'annual', orderId: lookupId }]);
  assert.equal(f.id('order-lookup-id').value, lookupId);
  assert.equal(f.id('order-lookup-message').getAttribute('role'), 'status');
  assert.equal(f.id('order-lookup-message').getAttribute('aria-live'), 'polite');
  assert.match(f.id('order-lookup-message').textContent, /仅供查阅/);
  assert.equal(f.id('order-lookup-result').querySelector('button'), null);
  assert.equal(f.id('order-list').firstElementChild.dataset.orderId, otherLookupId);
  assert.equal(f.id('orders-more').hidden, false);
  assert.equal(f.calls.filter(call => /^(createBillingOrder|reconcileBillingOrder|reconcileBillingPage)$/.test(call.name)).length, 0);
  f.id('orders-more').click();
  await until(() => pages === 2 && !f.id('orders-previous').hidden);
  assert.deepEqual({ ...f.calls.filter(call => call.name === 'listBillingOrders').at(-1).input },
    { teamId: 'a', kind: 'annual', after: otherLookupId });
  assert.equal(f.id('order-lookup-result').firstElementChild.dataset.orderId, lookupId);
});

test('lookup rejects partial IDs and unrelated text before RPC, and editing clears the prior answer', async t => {
  const f = fixture(t);
  await f.open();
  for (const invalid of ['', 'abcdef01', lookupId + '?team=b', lookupId.replace('-4000-', '-7000-'), lookupId.replace('-', '–'), '订单 ' + lookupId]) {
    lookUp(f, invalid);
    assert.match(f.id('order-lookup-message').textContent, /完整.*UUID/);
  }
  assert.equal(lookupCalls(f).length, 0);
  lookUp(f, lookupId);
  await until(() => f.id('order-lookup-result').childElementCount === 1);
  f.change('order-lookup-id', otherLookupId, 'input');
  assert.equal(f.id('order-lookup-result').childElementCount, 0);
  assert.equal(f.id('order-lookup-message').textContent, '');
  assert.equal(lookupCalls(f).length, 1);
});

test('lookup uses the selected seat kind and existing read-only amount and status conventions', async t => {
  const f = fixture(t, { getBillingOrder: ({ orderId, teamId }) => ok({ order: {
    ...order(orderId, 'pending', teamId), offer: { ...seat, amountMinor: 96000 }, quantity: 2,
    quoteExpiresAt: termStart + 60000, termEndsAt: termEnd
  } }) });
  await f.open();
  f.change('order-kind', 'seat');
  lookUp(f, lookupId);
  await until(() => f.id('order-lookup-result').childElementCount === 1);
  assert.deepEqual({ ...lookupCalls(f)[0].input }, { teamId: 'a', kind: 'seat', orderId: lookupId });
  assert.match(f.id('order-lookup-result').textContent, /增购 2 席/);
  assert.match(f.id('order-lookup-result').textContent, /待支付/);
  assert.match(f.id('order-lookup-result').textContent, /960\.00/);
  assert.equal(f.id('order-lookup-result').querySelector('[data-billing-reconcile]'), null);
});

test('a missing or inaccessible exact order leaves the scoped list and navigation intact', async t => {
  const f = fixture(t, { getBillingOrder: () => fail('HTTP_404'), listBillingOrders: () => ok({ orders: [order(otherLookupId)], hasMore: false, nextCursor: null }) });
  await f.open();
  await until(() => f.id('order-list').childElementCount === 1);
  lookUp(f, lookupId);
  await until(() => f.id('order-lookup-message').textContent.includes('未找到该订单'));
  assert.match(f.id('order-lookup-message').textContent, /或当前无权查阅/);
  assert.equal(f.id('order-lookup-result').childElementCount, 0);
  assert.equal(f.id('order-list').firstElementChild.dataset.orderId, otherLookupId);
  assert.equal(f.id('team').value, 'a');
  assert.equal(f.id('overview').hidden, false);
  assert.deepEqual(f.callbacks, []);
});

test('unexpected order IDs or a different response team cannot populate the lookup result', async t => {
  for (const wrong of [order(otherLookupId), order(lookupId, 'pending', 'b')]) {
    const f = fixture(t, { getBillingOrder: () => ok({ order: wrong }) });
    await f.open();
    lookUp(f, lookupId);
    await until(() => f.id('order-lookup-message').textContent.includes('暂时无法查询'));
    assert.equal(f.id('order-lookup-result').childElementCount, 0);
    assert.equal(f.id('team').value, 'a');
  }
});

test('managed billing and a legacy bridge never enable or dispatch order lookup', async t => {
  const managed = fixture(t, { getBillingOverview: ({ teamId }) => ok(managedSnapshot(teamId)) });
  await managed.open();
  const legacy = fixture(t, { getBillingOrder: undefined });
  await legacy.open();
  for (const f of [managed, legacy]) {
    assert.equal(f.id('order-lookup').hidden, true);
    assert.equal(f.id('order-lookup-submit').disabled, true);
    lookUp(f, lookupId);
    const window = f.id('order-lookup-id').ownerDocument.defaultView;
    f.id('order-lookup-id').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(lookupCalls(f).length, 0);
    assert.equal(f.id('order-lookup-result').childElementCount, 0);
  }
  assert.equal(legacy.id('orders-section').hidden, false);
});

test('switching team or order kind clears the exact input and rejects its late response', async t => {
  for (const change of ['team', 'order-kind']) {
    const pending = deferred();
    const f = fixture(t, { getBillingOrder: () => pending.promise });
    await f.open();
    lookUp(f, lookupId);
    assert.equal(lookupCalls(f).length, 1);
    f.change(change, change === 'team' ? 'b' : 'seat');
    assert.equal(f.id('order-lookup-id').value, '');
    pending.resolve(ok({ order: order(lookupId) }));
    await until(() => !f.id('order-lookup-submit').disabled);
    assert.equal(f.id('order-lookup-result').childElementCount, 0);
    assert.equal(f.id('order-lookup-message').textContent, '');
    assert.deepEqual(f.callbacks, []);
  }
});

test('a coalesced panel close and reopen invalidates lookup and its late unauthorized result', async t => {
  const pending = deferred();
  const f = fixture(t, { getBillingOrder: () => pending.promise });
  await f.open();
  lookUp(f, lookupId);
  f.panel.open = false;
  f.panel.open = true;
  pending.resolve(fail('SIGN_IN_REQUIRED'));
  await until(() => !f.id('order-lookup-submit').disabled);
  assert.equal(f.id('order-lookup-id').value, '');
  assert.equal(f.id('order-lookup-result').childElementCount, 0);
  assert.equal(f.id('order-lookup-message').textContent, '');
  assert.deepEqual(f.callbacks, []);
});

test('ended actor, device or signed-out scope ignores a late lookup response and its callbacks', async t => {
  for (const change of ['actor', 'device', 'signed-out']) {
    const pending = deferred();
    const f = fixture(t, { getBillingOrder: () => pending.promise });
    await f.open();
    lookUp(f, lookupId);
    if (change === 'signed-out') { Object.assign(f.context, { identity: '', ready: false }); f.view.reset(); }
    else { f.context[change] += ':new'; f.view.update(); }
    pending.resolve(fail(change === 'device' ? 'DEVICE_STATE_CHANGED' : 'SIGN_IN_REQUIRED'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.id('order-lookup-result').childElementCount, 0);
    assert.equal(f.id('order-lookup-message').textContent, '');
    assert.deepEqual(f.callbacks, []);
  }
});

test('a current lookup authentication or device failure clears scope through the existing callbacks', async t => {
  for (const [code, callback] of [['SIGN_IN_REQUIRED', 'logout'], ['DEVICE_STATE_CHANGED', 'device']]) {
    const f = fixture(t, { getBillingOrder: () => fail(code) });
    await f.open();
    lookUp(f, lookupId);
    await until(() => f.callbacks.length === 1);
    assert.deepEqual(f.callbacks, [callback]);
    assert.equal(f.id('order-lookup-result').childElementCount, 0);
    assert.equal(f.id('order-lookup-id').value, '');
    assert.equal(f.panel.hidden, true);
  }
});

test('editing a pending lookup supersedes it without allowing its later answer to replace a newer result', async t => {
  const previous = deferred();
  const f = fixture(t, { getBillingOrder: ({ orderId }) => orderId === lookupId ? previous.promise : ok({ order: order(orderId) }) });
  const document = f.panel.ownerDocument;
  document.getElementById('workspace-view').hidden = false;
  await f.open();
  f.change('order-lookup-id', lookupId, 'input');
  f.id('order-lookup-id').focus();
  const event = new document.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  f.id('order-lookup-id').dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.id('order-lookup-id').disabled, false);
  assert.equal(document.activeElement, f.id('order-lookup-id'));
  assert.equal(f.id('order-lookup-submit').disabled, true);
  lookUp(f, otherLookupId);
  await until(() => f.id('order-lookup-result').childElementCount === 1);
  previous.resolve(ok({ order: order(lookupId, 'paid') }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(lookupCalls(f).length, 2);
  assert.equal(f.id('order-lookup-result').firstElementChild.dataset.orderId, otherLookupId);
  assert.equal(f.id('order-lookup-id').value, otherLookupId);
});

test('only an explicit existing-list reconciliation mutates, and it invalidates a prior pending lookup', async t => {
  const pending = deferred();
  const f = fixture(t, { getBillingOrder: () => pending.promise, listBillingOrders: () => ok({ orders: [order(otherLookupId)], hasMore: false, nextCursor: null }) });
  await f.open();
  await until(() => f.id('order-list').querySelector('[data-billing-reconcile]'));
  lookUp(f, lookupId);
  assert.equal(f.calls.filter(call => call.name === 'reconcileBillingOrder').length, 0);
  f.id('order-list').querySelector('[data-billing-reconcile]').click();
  await until(() => f.calls.some(call => call.name === 'reconcileBillingOrder'));
  pending.resolve(ok({ order: order(lookupId, 'paid') }));
  await until(() => f.id('order-list').textContent.includes('已到账'));
  assert.equal(f.id('order-lookup-result').childElementCount, 0);
  assert.equal(f.id('order-lookup-id').value, '');
  assert.equal(f.id('order-list').children.length, 1);
  assert.equal(f.id('order-list').firstElementChild.dataset.orderId, otherLookupId);
});

test('lookup reuses trusted closure and exception facts without enabling a reconciliation action', async t => {
  const result = { ...order(lookupId, 'payment-verified'), confirmedAt: termStart + 40,
    closure: { deadlineAt: termStart + 10, closedAt: termStart + 20 },
    paymentException: { kind: 'chargeback', occurredAt: termStart + 30, state: 'review-required' } };
  const f = fixture(t, { getBillingOrder: () => ok({ order: result }) });
  await f.open();
  lookUp(f, lookupId);
  await until(() => f.id('order-lookup-result').childElementCount === 1);
  const row = f.id('order-lookup-result').firstElementChild;
  assert.match(row.textContent, /迟到收款待复核/);
  assert.match(row.textContent, /拒付待复核/);
  assert.ok(row.querySelector('[data-order-closure]'));
  assert.equal(row.querySelector('button'), null);
  assert.equal(f.calls.filter(call => /^reconcileBilling/.test(call.name)).length, 0);
});


function websiteSnapshot(teamId,ready=true){return {...snapshot(teamId),websiteCheckout:true,websiteCheckoutReady:ready};}
test('a configured website candidate exposes one deliberate action and suppresses only desktop order creation',async t=>{
 const f=fixture(t,{getBillingOverview:({teamId})=>ok(websiteSnapshot(teamId)),openWebsiteCheckout:()=>ok({opened:true})});await f.open();await until(()=>!f.id('website-checkout').disabled);assert.equal(f.calls.filter(c=>c.name==='openWebsiteCheckout').length,0);assert.equal(f.id('website-checkout').hidden,false);assert.equal(f.id('review').hidden,true);assert.equal(f.id('annual-fields').hidden,true);assert.equal(f.id('renewal-fields').hidden,true);assert.equal(f.id('confirmation').hidden,true);assert.equal(f.id('orders-section').hidden,false);assert.equal(f.id('order-kind').disabled,false);f.id('review').click();f.id('confirm').click();assert.equal(f.calls.some(c=>c.name==='createBillingOrder'),false);
 f.id('website-checkout').click();await until(()=>f.id('message').textContent.includes('已请求打开官网'));assert.deepEqual({...f.calls.find(c=>c.name==='openWebsiteCheckout').input},{teamId:'a'});assert.equal(f.calls.filter(c=>c.name==='openWebsiteCheckout').length,1);f.change('order-kind','seat');await until(()=>f.calls.some(c=>c.name==='listBillingOrders'&&c.input.kind==='seat'));assert.equal(f.id('seat-fields').hidden,true);
});
test('missing pinned checkout configuration or old bridge does not fall back to a desktop write',async t=>{
 for(const overrides of [{getBillingOverview:({teamId})=>ok(websiteSnapshot(teamId,false)),openWebsiteCheckout:()=>ok({opened:true})},{getBillingOverview:({teamId})=>ok(websiteSnapshot(teamId,true)),openWebsiteCheckout:undefined}]){const f=fixture(t,overrides);await f.open();assert.equal(f.id('website-checkout').hidden,true);assert.match(f.id('website-checkout-hint').textContent,/联系管理员/);assert.equal(f.id('review').hidden,true);f.id('website-checkout').click();f.id('review').click();f.id('confirm').click();assert.equal(f.calls.some(c=>['openWebsiteCheckout','createBillingOrder'].includes(c.name)),false);}
});
test('legacy simulation and managed read-only views never gain the website candidate behavior',async t=>{
 const legacy=fixture(t,{openWebsiteCheckout:()=>ok({opened:true})});await legacy.open();assert.equal(legacy.id('website-checkout-section').hidden,true);assert.equal(legacy.id('review').hidden,false);
 const managed=fixture(t,{getBillingOverview:({teamId})=>ok({...managedSnapshot(teamId),websiteCheckout:true,websiteCheckoutReady:true}),openWebsiteCheckout:()=>ok({opened:true})});await managed.open();assert.equal(managed.id('website-checkout-section').hidden,true);managed.id('website-checkout').click();assert.equal(managed.calls.some(c=>c.name==='openWebsiteCheckout'),false);
});
test('website handoff stays single-flight across panel closure and never resurfaces its late result',async t=>{
 const wait=deferred(),f=fixture(t,{getBillingOverview:({teamId})=>ok(websiteSnapshot(teamId)),openWebsiteCheckout:()=>wait.promise});await f.open();await until(()=>!f.id('website-checkout').disabled);f.id('website-checkout').click();f.id('website-checkout').click();assert.equal(f.calls.filter(c=>c.name==='openWebsiteCheckout').length,1);assert.equal(f.id('team').disabled,true);f.panel.querySelector('summary').click();f.panel.querySelector('summary').click();await new Promise(r=>setTimeout(r,0));f.id('website-checkout').click();assert.equal(f.calls.filter(c=>c.name==='openWebsiteCheckout').length,1);wait.resolve(ok({opened:true}));await until(()=>!f.id('website-checkout').disabled);assert.equal(f.id('message').textContent.includes('已请求打开官网'),false);
});
test('a stale website result cannot act on another actor or sign out the replacement view',async t=>{
 const wait=deferred(),f=fixture(t,{getBillingOverview:({teamId})=>ok(websiteSnapshot(teamId)),openWebsiteCheckout:()=>wait.promise});await f.open();await until(()=>!f.id('website-checkout').disabled);f.id('website-checkout').click();f.context.identity='next';f.context.actor='next:1';f.view.update();wait.resolve(fail('SIGN_IN_REQUIRED'));await new Promise(r=>setTimeout(r,10));assert.deepEqual(f.callbacks,[]);assert.equal(f.id('message').textContent.includes('已请求打开官网'),false);
});
test('browser uncertainty stays generic, never renders a handoff and never retries automatically',async t=>{
 const f=fixture(t,{getBillingOverview:({teamId})=>ok(websiteSnapshot(teamId)),openWebsiteCheckout:()=>({ok:false,error:{code:'WEBSITE_CHECKOUT_OPEN_FAILED',message:'https://private.invalid/checkout/#handoff=PRIVATE_TICKET'}})});await f.open();await until(()=>!f.id('website-checkout').disabled);f.id('website-checkout').click();await until(()=>f.id('message').textContent.includes('入口可能已签发'));assert.equal(f.calls.filter(c=>c.name==='openWebsiteCheckout').length,1);assert.equal(f.id('panel').textContent.includes('PRIVATE_TICKET'),false);assert.equal(f.id('panel').textContent.includes('private.invalid'),false);assert.match(f.id('message').textContent,/不会自动重试/);
});


function seatWebsiteSnapshot(teamId,patch={}){return {...websiteSnapshot(teamId),subscription:{...snapshot(teamId).subscription,state:'active'},...patch};}
test('website seat action requires the active simulated candidate, pinned profile readiness and a seat offer',async t=>{
 const eligible=fixture(t,{getBillingOverview:({teamId})=>ok(seatWebsiteSnapshot(teamId)),openWebsiteCheckout:()=>ok({opened:true})});await eligible.open();await until(()=>!eligible.id('website-seat-checkout').disabled);assert.equal(eligible.id('website-seat-checkout').hidden,false);assert.equal(eligible.id('website-checkout').hidden,false);assert.equal(eligible.calls.some(c=>c.name==='openWebsiteCheckout'),false);
 for(const patch of [{seatOffer:null},{websiteCheckoutReady:false},{websiteCheckout:undefined},{simulation:false},...['scheduled','expired','unconfigured'].map(state=>({subscription:{...snapshot('a').subscription,state}}))]){const f=fixture(t,{getBillingOverview:({teamId})=>ok(seatWebsiteSnapshot(teamId,patch)),openWebsiteCheckout:()=>ok({opened:true})});await f.open();assert.equal(f.id('website-seat-checkout').hidden,true);assert.equal(f.id('website-seat-checkout').disabled,true);f.id('website-seat-checkout').click();assert.equal(f.calls.some(c=>c.name==='openWebsiteCheckout'),false);}
 const legacy=fixture(t,{getBillingOverview:({teamId})=>ok(seatWebsiteSnapshot(teamId)),openWebsiteCheckout:undefined});await legacy.open();assert.equal(legacy.id('website-seat-checkout').hidden,true);
});
test('website seat action sends only the current team and exact seat kind while local purchase controls stay hidden',async t=>{
 const f=fixture(t,{getBillingOverview:({teamId})=>ok(seatWebsiteSnapshot(teamId)),openWebsiteCheckout:()=>ok({opened:true})});await f.open();await until(()=>!f.id('website-seat-checkout').disabled);f.id('website-seat-checkout').click();await until(()=>f.id('message').textContent.includes('已请求打开官网合成席位增购页'));assert.deepEqual({...f.calls.find(c=>c.name==='openWebsiteCheckout').input},{teamId:'a',kind:'seat'});assert.equal(f.calls.filter(c=>c.name==='openWebsiteCheckout').length,1);assert.equal(f.id('annual-fields').hidden,true);assert.equal(f.id('seat-fields').hidden,true);assert.equal(f.id('review').hidden,true);assert.equal(f.id('confirmation').hidden,true);f.id('review').click();f.id('confirm').click();assert.equal(f.calls.some(c=>c.name==='createBillingOrder'),false);assert.equal(f.id('orders-section').hidden,false);assert.equal(f.id('order-kind').value,'annual');
});
test('annual and seat website buttons share one pending mutation across close and reopening',async t=>{
 const wait=deferred(),f=fixture(t,{getBillingOverview:({teamId})=>ok(seatWebsiteSnapshot(teamId)),openWebsiteCheckout:()=>wait.promise});await f.open();await until(()=>!f.id('website-seat-checkout').disabled);f.id('website-seat-checkout').click();f.id('website-checkout').click();f.id('website-seat-checkout').click();assert.equal(f.calls.filter(c=>c.name==='openWebsiteCheckout').length,1);assert.equal(f.id('website-seat-checkout').disabled,true);assert.equal(f.id('website-checkout').disabled,true);f.panel.querySelector('summary').click();f.panel.querySelector('summary').click();await new Promise(r=>setTimeout(r,0));f.id('website-seat-checkout').click();assert.equal(f.calls.filter(c=>c.name==='openWebsiteCheckout').length,1);wait.resolve(ok({opened:true}));await until(()=>!f.id('website-seat-checkout').disabled);assert.equal(f.id('message').textContent.includes('已请求打开官网合成席位增购页'),false);
});
test('seat handoff failure after a changed team or actor cannot affect the replacement view',async t=>{
 for(const change of ['team','actor']){const wait=deferred(),f=fixture(t,{getBillingOverview:({teamId})=>ok(seatWebsiteSnapshot(teamId)),openWebsiteCheckout:()=>wait.promise});await f.open();await until(()=>!f.id('website-seat-checkout').disabled);f.id('website-seat-checkout').click();if(change==='team')f.change('team','b');else{f.context.identity='next';f.context.actor='next:1';f.view.update();}wait.resolve(fail('SIGN_IN_REQUIRED'));await new Promise(r=>setTimeout(r,10));assert.deepEqual(f.callbacks,[]);assert.equal(f.id('message').textContent.includes('已请求打开官网合成席位增购页'),false);if(change==='team')assert.equal(f.id('team').value,'b');}
});

const websiteReceiptSelector = '[data-billing-website-receipt]';
const websiteOpenInputs = f => f.calls.filter(call => call.name === 'openWebsiteCheckout').map(call => ({ ...call.input }));

test('an eligible annual order row explicitly opens only its original order on the website', async t => {
  const existing = { ...order(lookupId), renewalSeats: { selectedSeats: 0, defaultSeats: 8 } };
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok(websiteSnapshot(teamId)),
    listBillingOrders: () => ok({ orders: [existing, order(otherLookupId)], hasMore: false, nextCursor: null }),
    openWebsiteCheckout: () => ok({ opened: true })
  });
  await f.open();
  const buttons = () => [...f.id('order-list').querySelectorAll(websiteReceiptSelector)];
  await until(() => buttons().length === 1 && !buttons()[0].disabled);
  const [button] = buttons();
  assert.equal(button.textContent, '在官网核对原单');
  assert.equal(button.closest('li').dataset.orderId, lookupId);
  assert.deepEqual(websiteOpenInputs(f), []);
  const previousCalls = f.calls.length;
  button.click();
  await until(() => f.id('message').textContent.includes('已请求打开官网原单核对页'));
  assert.deepEqual(websiteOpenInputs(f), [{ teamId: 'a', kind: 'annual', orderId: lookupId }]);
  assert.deepEqual(f.calls.slice(previousCalls).map(call => call.name), ['openWebsiteCheckout']);
  assert.equal(button.disabled, false);
  assert.equal(f.id('order-list').childElementCount, 2);
});

test('an expired team can reopen seat receipts from the list and exact lookup without enabling a new seat order', async t => {
  const seatOrder = (id, teamId) => ({
    ...order(id, 'pending', teamId), offer: { ...seat, amountMinor: 96000 }, quantity: 2,
    quoteExpiresAt: termStart + 60000, termEndsAt: termEnd
  });
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok(seatWebsiteSnapshot(teamId, {
      subscription: { ...snapshot(teamId).subscription, state: 'expired' }, seatOffer: null
    })),
    listBillingOrders: ({ teamId, kind }) => ok({ orders: kind === 'seat' ? [seatOrder(otherLookupId, teamId)] : [], hasMore: false, nextCursor: null }),
    getBillingOrder: ({ orderId, teamId }) => ok({ order: seatOrder(orderId, teamId) }),
    openWebsiteCheckout: () => ok({ opened: true })
  });
  await f.open();
  f.change('order-kind', 'seat');
  await until(() => !!f.id('order-list').querySelector(websiteReceiptSelector));
  assert.equal(f.id('website-seat-checkout').hidden, true);
  assert.equal(f.id('website-seat-checkout').disabled, true);
  lookUp(f, lookupId);
  const lookupButton = () => f.id('order-lookup-result').querySelector(websiteReceiptSelector);
  await until(() => lookupButton() && !lookupButton().disabled);
  assert.equal(f.id('order-lookup-result').querySelector('[data-billing-reconcile]'), null);
  assert.match(f.id('order-lookup-message').textContent, /仅供查阅/);
  const listButton = f.id('order-list').querySelector(websiteReceiptSelector);
  const previousCalls = f.calls.length;
  listButton.click();
  await until(() => !listButton.disabled);
  lookupButton().click();
  await until(() => !lookupButton().disabled);
  assert.deepEqual(websiteOpenInputs(f), [
    { teamId: 'a', kind: 'seat', orderId: otherLookupId },
    { teamId: 'a', kind: 'seat', orderId: lookupId }
  ]);
  assert.deepEqual(f.calls.slice(previousCalls).map(call => call.name), ['openWebsiteCheckout', 'openWebsiteCheckout']);
});

test('website receipt actions stay scoped and single-flight across a lookup and a replacement view', async t => {
  const lookupWait = deferred(), websiteWait = deferred();
  const existing = { ...order(lookupId), renewalSeats: { selectedSeats: 5, defaultSeats: 8 } };
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok(websiteSnapshot(teamId)),
    listBillingOrders: ({ teamId }) => ok({ orders: [{ ...existing, teamId }], hasMore: false, nextCursor: null }),
    getBillingOrder: () => lookupWait.promise,
    openWebsiteCheckout: () => websiteWait.promise
  });
  await f.open();
  const rowButton = () => f.id('order-list').querySelector(websiteReceiptSelector);
  await until(() => rowButton() && !rowButton().disabled);
  const original = rowButton();
  lookUp(f, lookupId);
  assert.equal(original.disabled, true);
  original.click();
  assert.deepEqual(websiteOpenInputs(f), []);
  lookupWait.resolve(ok({ order: existing }));
  await until(() => !original.disabled);
  original.click();
  assert.equal(original.disabled, true);
  assert.equal(f.id('order-lookup-result').querySelector(websiteReceiptSelector).disabled, true);
  assert.equal(f.id('website-checkout').disabled, true);
  original.click();
  f.id('website-checkout').click();
  assert.deepEqual(websiteOpenInputs(f), [{ teamId: 'a', kind: 'annual', orderId: lookupId }]);
  f.change('team', 'b');
  await until(() => rowButton() && rowButton() !== original);
  assert.equal(f.id('order-lookup-result').childElementCount, 0);
  assert.equal(rowButton().disabled, true);
  original.click();
  websiteWait.resolve(fail('SIGN_IN_REQUIRED'));
  await until(() => !rowButton().disabled);
  assert.deepEqual(f.callbacks, []);
  assert.equal(f.id('message').textContent, '');
  assert.equal(websiteOpenInputs(f).length, 1);
});

test('an unavailable original receipt leaves the current team and list in place', async t => {
  const existing = { ...order(lookupId), renewalSeats: { selectedSeats: 5, defaultSeats: 8 } };
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok(websiteSnapshot(teamId)),
    listBillingOrders: () => ok({ orders: [existing], hasMore: false, nextCursor: null }),
    openWebsiteCheckout: () => fail('HTTP_404')
  });
  await f.open();
  const button = () => f.id('order-list').querySelector(websiteReceiptSelector);
  await until(() => button() && !button().disabled);
  const original = button();
  original.click();
  await until(() => f.id('message').textContent.includes('暂时无法查阅该订单'));
  assert.equal(f.id('team').value, 'a');
  assert.equal(button(), original);
  assert.equal(button().disabled, false);
  assert.equal(websiteOpenInputs(f).length, 1);
});

const nativeOverview = (teamId, canPurchase = true) => ({ ...managedSnapshot(teamId), nativeCheckout: { canPurchase } });
const nativeOpenInputs = f => f.calls.filter(call => call.name === 'openNativeWebsiteCheckout').map(call => ({ ...call.input }));
const nativeOrderId = 'e38cc747-0e49-4746-8e11-1fe03ff7b4fb';
const nativeHistoryOverview = (teamId, canPurchase = false) => ({
  ...managedSnapshot(teamId), nativeCheckout: { canPurchase, orderHistory: true }
});
const historyInputs = f => f.calls.filter(call => call.name === 'listNativeBillingOrders').map(call => ({ ...call.input }));
const nativeHistoryId = number => 'e38cc747-0e49-4746-8e11-' + String(number).padStart(12, '0');
const nativeHistoryOrder = (number, fields = {}) => ({
  id: nativeHistoryId(number), product: 'team-annual-renewal', createdAt: termStart + number,
  amountMinor: 103050, currency: 'CNY', seats: 3, status: 'pending', ...fields
});
const nativeHistoryPage = (teamId, orders, nextCursor = null) => ({ teamId, orders, hasMore: nextCursor !== null, nextCursor });
const nativeRows = f => [...f.id('native-history-list').querySelectorAll('li')].map(row => row.dataset.orderId);

test('Native history finds and opens an existing official order with no local number or purchase catalog', async t => {
  const order = nativeHistoryOrder(2, { status: 'fulfilled' });
  const older = nativeHistoryOrder(1, { product: 'team-seat-addition', status: 'pending_fulfilment', seats: 1, amountMinor: 335 });
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok(nativeHistoryOverview(teamId)),
    listNativeBillingOrders: ({ teamId }) => ok(nativeHistoryPage(teamId, [order, older])),
    openNativeWebsiteCheckout: () => ok({ opened: true })
  });
  await f.open();
  await until(() => nativeRows(f).length === 2);
  assert.equal(f.id('native-history').hidden, false);
  assert.equal(f.id('native-purchase').hidden, true);
  assert.equal(f.id('native-order-id').value, '');
  assert.equal(f.id('orders-section').hidden, true);
  assert.equal(f.id('native-history-list').getAttribute('aria-busy'), 'false');
  assert.deepEqual(historyInputs(f), [{ teamId: 'a' }]);
  assert.deepEqual(nativeOpenInputs(f), []);
  assert.deepEqual(nativeRows(f), [order.id, older.id]);
  const list = f.id('native-history-list');
  assert.match(list.textContent, /团队年订阅.*权益已到账.*[¥￥]1,030\.50.*3 席.*北京时间/);
  assert.match(list.textContent, /增购席位.*收款已核实，待到账.*[¥￥]3\.35/);
  const button = list.querySelector(`[data-billing-native-receipt="${older.id}"]`);
  assert.match(button.getAttribute('aria-label'), new RegExp(older.id));
  button.click();
  await until(() => f.id('message').textContent.includes('已打开官网原订单'));
  assert.deepEqual(nativeOpenInputs(f), [{ teamId: 'a', orderId: older.id }]);
  assert.equal(f.id('native-order-id').value, '');
  assert.deepEqual(f.calls.map(call => call.name), ['getBillingAccess', 'getBillingOverview', 'listNativeBillingOrders', 'openNativeWebsiteCheckout']);
});

test('Native order history pages by the last canonical order and refreshes from the newest page', async t => {
  const orders = Array.from({ length: 20 }, (_, index) => nativeHistoryOrder(21 - index));
  const cursor = orders.at(-1).id;
  const older = nativeHistoryOrder(1);
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok(nativeHistoryOverview(teamId, true)),
    listNativeBillingOrders: ({ teamId, after }) => ok(after === cursor
      ? nativeHistoryPage(teamId, [older]) : nativeHistoryPage(teamId, orders, cursor)),
    openNativeWebsiteCheckout: () => ok({ opened: true })
  });
  const document = f.panel.ownerDocument;
  document.getElementById('workspace-view').hidden = false;
  await f.open();
  await until(() => nativeRows(f).length === 20);
  assert.equal(f.id('native-history-previous').hidden, true);
  const next = f.id('native-history-next');
  next.focus();
  assert.equal(document.activeElement, next);
  next.click();
  await until(() => nativeRows(f)[0] === older.id);
  assert.deepEqual(nativeRows(f), [older.id]);
  assert.equal(next.hidden, true);
  assert.equal(document.activeElement, f.id('native-history-heading'));
  assert.match(f.id('native-history-message').textContent, /第 2 页/);
  f.id('native-history-previous').click();
  await until(() => nativeRows(f).length === 20);
  f.id('native-history-next').click();
  await until(() => nativeRows(f)[0] === older.id);
  f.id('native-history-refresh').click();
  await until(() => nativeRows(f).length === 20);
  assert.equal(f.id('native-history-previous').hidden, true);
  assert.deepEqual(historyInputs(f), [{ teamId: 'a' }, { teamId: 'a', after: cursor }, { teamId: 'a' },
    { teamId: 'a', after: cursor }, { teamId: 'a' }]);
  assert.deepEqual(nativeOpenInputs(f), []);
});

test('changing team and signing out clear Native history and ignore late page answers and old row clicks', async t => {
  const pendingA = deferred();
  const pendingB = deferred();
  const a = nativeHistoryOrder(3);
  const b = nativeHistoryOrder(2);
  let bReads = 0;
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok(nativeHistoryOverview(teamId)),
    listNativeBillingOrders: ({ teamId, after }) => teamId === 'a' ? (after ? pendingA.promise : ok(nativeHistoryPage('a', [a], a.id)))
      : ++bReads === 1 ? ok(nativeHistoryPage('b', [b])) : pendingB.promise,
    openNativeWebsiteCheckout: () => ok({ opened: true })
  });
  await f.open();
  await until(() => nativeRows(f)[0] === a.id);
  f.id('native-history-next').click();
  const old = f.id('native-history-list').querySelector('[data-billing-native-receipt]');
  assert.equal(old.disabled, true);
  assert.equal(f.id('native-history-list').getAttribute('aria-busy'), 'true');
  f.change('team', 'b');
  assert.deepEqual(nativeRows(f), []);
  await until(() => nativeRows(f)[0] === b.id);
  old.click();
  pendingA.resolve(ok(nativeHistoryPage('a', [nativeHistoryOrder(1)])));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(nativeRows(f), [b.id]);
  assert.deepEqual(nativeOpenInputs(f), []);
  f.id('native-history-refresh').click();
  await until(() => bReads === 2);
  Object.assign(f.context, { ready: false, identity: '' });
  f.view.update();
  assert.deepEqual(nativeRows(f), []);
  assert.equal(f.id('native-history').hidden, true);
  pendingB.resolve(fail('SIGN_IN_REQUIRED'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(nativeRows(f), []);
  assert.deepEqual(f.callbacks, []);
});

test('Native history ignores unsupported capabilities and refuses a mismatched team, cursor or response order', async t => {
  const orders = [nativeHistoryOrder(2), nativeHistoryOrder(1)];
  const reader = ({ teamId }) => ok(nativeHistoryPage(teamId, orders));
  for (const [overview, listNativeBillingOrders] of [
    [nativeOverview('a'), reader],
    [nativeHistoryOverview('a'), undefined],
    [{ ...snapshot('a'), nativeCheckout: { canPurchase: true, orderHistory: true } }, reader]
  ]) {
    const f = fixture(t, {
      getBillingOverview: () => ok(overview), listNativeBillingOrders,
      openNativeWebsiteCheckout: () => ok({ opened: true })
    });
    await f.open();
    assert.equal(f.id('native-history').hidden, true);
    f.id('native-history-refresh').click();
    assert.deepEqual(historyInputs(f), []);
  }
  for (const page of [nativeHistoryPage('b', orders), nativeHistoryPage('a', orders, orders[0].id),
    nativeHistoryPage('a', orders.toReversed())]) {
    const f = fixture(t, {
      getBillingOverview: () => ok(nativeHistoryOverview('a')),
      listNativeBillingOrders: () => ok(page),
      openNativeWebsiteCheckout: () => ok({ opened: true })
    });
    await f.open();
    await until(() => f.id('native-history-message').textContent.includes('无法读取官网订单'));
    assert.deepEqual(nativeRows(f), []);
    assert.deepEqual(nativeOpenInputs(f), []);
  }
});

test('managed Native checkout keeps continuing a purchase distinct from explicit advancement', async t => {
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok(nativeOverview(teamId)),
    openNativeWebsiteCheckout: input => input.newPurchase ? fail('WECHAT_NATIVE_PREVIOUS_ORDER_UNRESOLVED') : ok({ opened: true })
  });
  await f.open();
  assert.equal(f.id('native-checkout-section').hidden, false);
  assert.equal(f.id('native-purchase').hidden, false);
  assert.equal(f.id('checkout-section').hidden, true);
  assert.equal(f.id('orders-section').hidden, true);
  assert.deepEqual(nativeOpenInputs(f), []);
  assert.match(f.id('native-purchase-hint').textContent, /确认已到账或已关闭/);
  f.id('native-continue').click();
  await until(() => f.id('message').textContent.includes('已打开官网购买页'));
  f.change('native-kind', 'seat');
  f.id('native-next').click();
  await until(() => f.id('message').textContent.includes('上一笔购买尚无'));
  f.id('native-continue').click();
  await until(() => f.id('message').textContent.includes('已打开官网购买页'));
  assert.deepEqual(nativeOpenInputs(f), [
    { teamId: 'a', kind: 'annual' },
    { teamId: 'a', kind: 'seat', newPurchase: true },
    { teamId: 'a', kind: 'seat' }
  ]);
  assert.equal(f.calls.some(call => /^(createBillingOrder|listBillingOrders|reconcileBillingOrder)$/.test(call.name)), false);
});

test('Native receipt opens without a pricing catalog only for an exact canonical order identifier', async t => {
  const f = fixture(t, {
    getBillingOverview: ({ teamId }) => ok(nativeOverview(teamId, false)),
    openNativeWebsiteCheckout: () => ({ ok: false, error: { code: 'WEBSITE_CHECKOUT_OPEN_FAILED', message: 'https://private.invalid/#handoff=PRIVATE_TICKET' } })
  });
  await f.open();
  assert.equal(f.id('native-checkout-section').hidden, false);
  assert.equal(f.id('native-purchase').hidden, true);
  f.id('native-continue').click();
  f.id('native-next').click();
  for (const value of ['', nativeOrderId.toUpperCase(), ' ' + nativeOrderId, nativeOrderId + ' ', nativeOrderId + '0']) {
    f.change('native-order-id', value, 'input');
    f.id('native-open-order').click();
    assert.equal(f.id('native-order-id').getAttribute('aria-invalid'), 'true');
    assert.deepEqual(nativeOpenInputs(f), []);
  }
  f.change('native-order-id', nativeOrderId, 'input');
  const field = f.id('native-order-id');
  field.dispatchEvent(new field.ownerDocument.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await until(() => f.id('message').textContent.includes('按原编号重试'));
  assert.deepEqual(nativeOpenInputs(f), [{ teamId: 'a', orderId: nativeOrderId }]);
  assert.equal(f.id('panel').textContent.includes('PRIVATE_TICKET'), false);
  assert.equal(f.id('panel').textContent.includes('private.invalid'), false);
});

test('only managed billing with a supported bridge can expose Native checkout', async t => {
  for (const [overview, bridge] of [
    [{ ...snapshot('a'), nativeCheckout: { canPurchase: true } }, () => ok({ opened: true })],
    [nativeOverview('a'), undefined],
    [{ ...managedSnapshot('a'), nativeCheckout: { canPurchase: 'true' } }, () => ok({ opened: true })]
  ]) {
    const f = fixture(t, { getBillingOverview: () => ok(overview), openNativeWebsiteCheckout: bridge });
    await f.open();
    assert.equal(f.id('native-checkout-section').hidden, true);
    f.id('native-continue').click();
    f.id('native-open-order').click();
    assert.deepEqual(nativeOpenInputs(f), []);
  }
});

test('Native checkout allows one open at a time and discards a stale result after team changes', async t => {
  const opening = deferred();
  const f = fixture(t, { getBillingOverview: ({ teamId }) => ok(nativeOverview(teamId)), openNativeWebsiteCheckout: () => opening.promise });
  await f.open();
  f.change('native-order-id', nativeOrderId, 'input');
  f.id('native-open-order').click();
  f.id('native-continue').click();
  f.id('native-next').click();
  f.id('native-open-order').click();
  assert.equal(f.id('native-open-order').disabled, true);
  assert.equal(f.id('native-continue').disabled, true);
  assert.deepEqual(nativeOpenInputs(f), [{ teamId: 'a', orderId: nativeOrderId }]);
  f.change('team', 'b');
  await until(() => f.id('team').value === 'b' && !f.id('overview').hidden);
  assert.equal(f.id('native-order-id').value, '');
  assert.equal(f.id('native-open-order').disabled, true);
  opening.resolve(fail('SIGN_IN_REQUIRED'));
  await until(() => !f.id('native-open-order').disabled);
  assert.equal(f.id('message').textContent, '');
  assert.deepEqual(f.callbacks, []);
});
