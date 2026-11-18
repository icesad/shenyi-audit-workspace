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
    createBillingOrder: ({ teamId }) => ok({ order: order('created', 'pending', teamId) }),
    reconcileBillingOrder: ({ orderId, teamId }) => ok({ order: order(orderId, 'paid', teamId) }),
    ...overrides
  };
  const api = Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, async input => {
    calls.push({ name, input });
    return handler(input);
  }]));
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

test('billing defaults to the prior-term seat quantity, protects reductions and displays the exact server amount', async t => {
  const f = fixture(t);
  await f.open();
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
