'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {setImmediate: nextTurn} = require('node:timers/promises');
const {test} = require('node:test');
const {JSDOM} = require('jsdom');

const site = path.join(__dirname, '../website');
const route = '/api/website-checkout/';
const handoff = Buffer.alloc(32, 11).toString('base64url');
const states = [
  ['pending', '待处理（模拟）'],
  ['paid', '已到账（模拟）'],
  ['payment-verified', '已核验，待到账（模拟）'],
  ['closed', '已关闭（模拟）'],
  ['payment-review', '待复核（模拟）'],
];

function fixture(t, kind, status, {revoked = false, deferRecovery = false, reopen, refreshedAnnualUnitAmountMinor} = {}) {
  const annual = kind === 'annual';
  const asset = annual ? 'checkout' : 'checkout-seats';
  const page = annual ? '/checkout/' : '/checkout/seats/';
  const contextPath = route + (annual ? 'context' : 'seat-context');
  const orderPath = route + (annual ? 'orders' : 'seat-orders');
  const formId = annual ? 'annual-order-form' : 'seat-order-form';
  const at = Date.now(), seats = 3, termEndsAt = at + 86_400_000;
  const offer = annual ? {id:'synthetic-year', revision:1, product:'team-annual-renewal', amountMinor:12_000, currency:'CNY'} :
    {id:'synthetic-seat', revision:1, product:'team-seat-addition', annualUnitAmountMinor:8_600, currency:'CNY'};
  const quote = {id:'8c2e8232-6b98-44ea-ab2f-d6935f43d624', seats, amountMinor:12_576, termEndsAt, expiresAt:at+60_000};
  const initialAnnualUnitAmountMinor = 3_000;
  const initialAnnualTotal = annual ? offer.amountMinor + seats * initialAnnualUnitAmountMinor : null;
  const original = {
    id: 'synthetic-' + kind + '-original', amountMinor: annual ?
      offer.amountMinor + seats * (refreshedAnnualUnitAmountMinor ?? initialAnnualUnitAmountMinor) : quote.amountMinor,
    seats, createdAt: at, status, currency: 'CNY',
    ...(annual ? {} : {termEndsAt, quoteExpiresAt:at+900_000}),
  };
  const context = {
    simulation: true, teamName: '合成团队', offer, order: null,
    ...(annual ? {pricing:{defaultSeats:seats, committedSeats:1, unitAmountMinor:initialAnnualUnitAmountMinor}} : {termEndsAt}),
  };
  const dom = new JSDOM(fs.readFileSync(path.join(site, asset + '.html'), 'utf8'), {
    url: 'https://127.0.0.1:14443' + page + '#handoff=' + handoff, runScripts: 'outside-only',
  });
  const w = dom.window, calls = [];
  t.after(() => w.close());
  w.TextDecoder = TextDecoder;
  let stored = null;
  let recoverySignal;
  const delayedRecovery = deferRecovery ? Promise.withResolvers() : null;
  w.fetch = async (url, request) => {
    assert.equal(request.credentials, 'omit');
    const body = JSON.parse(request.body);
    calls.push({url, method:request.method, body, fragment:w.location.hash});
    if (url === contextPath) {
      if (reopen) return Response.json(reopen({simulation:true, teamName:context.teamName, receiptOnly:true, order:original}));
      if (stored && revoked) return Response.json({error:{code:'WEBSITE_HANDOFF_UNAVAILABLE'}}, {status:403});
      if (stored && delayedRecovery) {
        recoverySignal = request.signal;
        await delayedRecovery.promise;
      }
      return Response.json({...context, order:stored});
    }
    if (url === route + 'seat-quote' && !annual) return Response.json({simulation:true, quote});
    if (url === orderPath) {
      if (refreshedAnnualUnitAmountMinor !== undefined) {
        assert.equal(annual, true);
        context.pricing.unitAmountMinor = refreshedAnnualUnitAmountMinor;
        if (body.expectedAmountMinor !== original.amountMinor) {
          return Response.json({error:{code:'WEBSITE_CHECKOUT_CONFLICT'}}, {status:409});
        }
        stored = original;
        return Response.json({simulation:true, order:stored});
      }
      stored = original;
      throw new Error('Synthetic transport failure after saving the original order');
    }
    throw new Error('Unexpected route: ' + url);
  };
  w.eval(fs.readFileSync(path.join(site, asset + '.js'), 'utf8'));
  const id = (name) => w.document.getElementById(name);
  const submit = () => id(formId).dispatchEvent(new w.Event('submit', {bubbles:true, cancelable:true}));
  return {
    annual, id, submit, calls, contextPath, orderPath, original, formId,
    pageTransition: (type) => w.dispatchEvent(new w.PageTransitionEvent(type, {persisted:true})),
    recoveryAborted: () => recoverySignal?.aborted,
    releaseRecovery: () => delayedRecovery.resolve(),
    orderBody: annual ? {handoff, offerId:offer.id, offerRevision:offer.revision, selectedSeats:seats,
      expectedAmountMinor:initialAnnualTotal} : {handoff, quoteId:quote.id},
    openQuote() {
      const input = id('seat-quantity');
      input.value = String(seats);
      input.dispatchEvent(new w.Event('input', {bubbles:true}));
      submit();
    },
    confirm: () => annual ? submit() : id('confirm-seat-order').click(),
  };
}

async function until(predicate) {
  for (let turn = 0; turn < 40; turn++) {
    if (predicate()) return;
    await nextTurn();
  }
  assert.fail('Checkout did not reach the expected UI state');
}

async function submitWithoutConfirmedReceipt(f) {
  await until(() => !f.id('checkout-fields').disabled);
  if (!f.annual) {
    f.openQuote();
    await until(() => !f.id('confirm-seat-order').disabled);
  }
  f.confirm();
  await until(() => !f.id('recover-context').hidden && !f.id('recover-context').disabled);
  assert.equal(f.id('checkout-status-title').textContent, '订单结果尚未确认');
  assert.equal(f.id('checkout-fields').disabled, true);
  f.confirm();
  assert.deepEqual(f.calls.filter(call => call.url === f.orderPath).map(call => call.body), [f.orderBody]);
}

test('annual checkout requires a new confirmation at the refreshed total after a stale amount', async t => {
  const f = fixture(t, 'annual', 'pending', {refreshedAnnualUnitAmountMinor:3_500});
  await until(() => !f.id('checkout-fields').disabled);
  assert.equal(f.id('order-total').textContent, '¥210.00');

  await submitWithoutConfirmedReceipt(f);
  await nextTurn();
  assert.deepEqual(f.calls.map(call => call.url), [f.contextPath, f.orderPath]);
  assert.equal(f.id('receipt-panel').hidden, true);

  f.id('recover-context').click();
  await until(() => !f.id('checkout-fields').disabled);
  await nextTurn();
  assert.equal(f.id('order-total').textContent, '¥225.00');
  assert.equal(f.id('seat-unit-amount').textContent, '¥35.00 / 席 / 年');
  assert.equal(f.id('receipt-panel').hidden, true);
  assert.deepEqual(f.calls.map(call => call.url), [f.contextPath, f.orderPath, f.contextPath]);

  f.id('create-order').click();
  await until(() => !f.id('receipt-panel').hidden);
  assert.deepEqual(f.calls.map(call => call.url), [f.contextPath, f.orderPath, f.contextPath, f.orderPath]);
  assert.deepEqual(f.calls.at(-1).body, {...f.orderBody, expectedAmountMinor:22_500});
  assert.equal(f.id('receipt-id').textContent, f.original.id);
  assert.equal(f.id('receipt-seats').textContent, '3 席');
  assert.equal(f.id('receipt-amount').textContent, '¥225.00');
  assert.equal(f.id('checkout-fields').disabled, true);
});

for (const kind of ['annual', 'seat']) {
  test(`${kind} checkout opens a receipt-only handoff without quoting or creating an order`, async t => {
    const f = fixture(t, kind, 'paid', {reopen: context => context});
    await until(() => !f.id('receipt-panel').hidden);
    assert.equal(f.id('team-title').textContent, '合成团队');
    assert.equal(f.id('receipt-id').textContent, f.original.id);
    assert.equal(f.id('receipt-status').textContent, '已到账（模拟）');
    assert.equal(f.id('receipt-amount').textContent, f.annual ? '¥210.00' : '¥125.76');
    assert.equal(f.id('receipt-seats').textContent, '3 席');
    assert.equal(f.id(f.formId).hidden, true);
    assert.equal(f.id('checkout-fields').disabled, true);
    assert.equal(f.id('recover-context').hidden, true);
    if (!f.annual) {
      assert.equal(f.id('quote-panel').hidden, true);
      f.openQuote();
    }
    f.confirm();
    f.id('recover-context').click();
    await nextTurn();
    assert.deepEqual(f.calls, [{url:f.contextPath, method:'POST', body:{handoff}, fragment:''}]);
  });

  const malformedReceipts = [
    ['missing order', value => ({...value, order:null})],
    ['invalid order identifier', value => ({...value, order:{...value.order, id:'/invalid'}})],
    ['unknown order state', value => ({...value, order:{...value.order, status:'refunded'}})],
    ['unexpected order field', value => ({...value, order:{...value.order, payer:'hidden'}})],
    ['mixed offer and receipt', value => ({...value, offer:{}})],
    ['inactive receipt-only marker', value => ({...value, receiptOnly:false})],
  ];
  if (kind === 'seat') {
    malformedReceipts.push(['invalid order term', value => ({...value, order:{...value.order, termEndsAt:null}})]);
  }
  for (const [reason, reopen] of malformedReceipts) {
    test(`${kind} checkout rejects a receipt-only context with ${reason}`, async t => {
      const f = fixture(t, kind, 'paid', {reopen});
      await until(() => f.id('status-panel').getAttribute('aria-busy') === 'false');
      assert.equal(f.id('checkout-status-title').textContent, f.annual ? '暂时无法核对订单' : '暂时无法核对增购');
      assert.equal(f.id('checkout-content').hidden, true);
      assert.equal(f.id('receipt-panel').hidden, true);
      assert.equal(f.id('receipt-id').textContent, '');
      assert.equal(f.id('checkout-fields').disabled, true);
      if (!f.annual) f.openQuote();
      f.confirm();
      await nextTurn();
      assert.deepEqual(f.calls, [{url:f.contextPath, method:'POST', body:{handoff}, fragment:''}]);
    });
  }

  for (const [state, label] of states) {
    test(`${kind} checkout recovers the original ${state} receipt without a second order request`, async t => {
      const f = fixture(t, kind, state);
      await submitWithoutConfirmedReceipt(f);
      f.id('recover-context').click();
      await until(() => !f.id('receipt-panel').hidden);
      assert.equal(f.id('checkout-status-title').textContent, '原订单已确认');
      assert.equal(f.id('receipt-status').textContent, label);
      assert.equal(f.id('receipt-id').textContent, f.original.id);
      const amount = f.annual ? '¥210.00' : '¥125.76';
      assert.equal(f.id('receipt-amount').textContent, amount);
      assert.equal(f.id('order-total').textContent, amount);
      assert.equal(f.id('receipt-seats').textContent, '3 席');
      assert.equal(f.id(f.formId).hidden, true);
      assert.equal(f.id('recover-context').hidden, true);
      f.confirm();
      f.id('recover-context').click();
      assert.deepEqual(f.calls.map(call => call.url), f.annual ? [f.contextPath, f.orderPath, f.contextPath] :
        [f.contextPath, route + 'seat-quote', f.orderPath, f.contextPath]);
      assert.ok(f.calls.every(call => call.method === 'POST' && call.body.handoff === handoff && call.fragment === ''));
    });
  }

  test(`${kind} checkout refuses a receipt after the handoff has been revoked`, async t => {
    const f = fixture(t, kind, 'paid', {revoked:true});
    await submitWithoutConfirmedReceipt(f);
    f.id('recover-context').click();
    await until(() => f.id('checkout-status-title').textContent.includes('授权已失效'));
    assert.match(f.id('checkout-status').textContent, /在官网核对原单/);
    assert.equal(f.id('receipt-panel').hidden, true);
    assert.equal(f.id('receipt-id').textContent, '');
    assert.equal(f.id('recover-context').hidden, true);
    f.confirm();
    f.id('recover-context').click();
    assert.equal(f.calls.filter(call => call.url === f.orderPath).length, 1);
    assert.equal(f.calls.filter(call => call.url === f.contextPath).length, 2);
  });

  test(`${kind} checkout removes the recovered receipt before a cached page can be restored`, async t => {
    const f = fixture(t, kind, 'paid');
    await submitWithoutConfirmedReceipt(f);
    f.id('recover-context').click();
    await until(() => !f.id('receipt-panel').hidden);
    assert.equal(f.id('receipt-id').textContent, f.original.id);
    assert.equal(f.id('team-title').textContent, '合成团队');
    const requestCount = f.calls.length;

    f.pageTransition('pagehide');
    assert.equal(f.id('checkout-status-title').textContent, '请从桌面重新打开');
    f.pageTransition('pageshow');

    const content = f.id('checkout-content');
    assert.equal(content.hidden, true);
    for (const value of [f.original.id, '合成团队', '已到账（模拟）', f.annual ? '¥210.00' : '¥125.76']) {
      assert.equal(content.textContent.includes(value), false, value);
    }
    assert.equal(f.id('checkout-status-title').textContent, '请从桌面重新打开');
    assert.equal(f.id('recover-context').hidden, true);
    f.id('recover-context').click();
    await nextTurn();
    assert.equal(f.calls.length, requestCount);
  });

  test(`${kind} checkout ignores an in-flight recovery response after leaving the page`, async t => {
    const f = fixture(t, kind, 'paid', {deferRecovery:true});
    await submitWithoutConfirmedReceipt(f);
    f.id('recover-context').click();
    await until(() => f.recoveryAborted() === false);
    const requestCount = f.calls.length;

    f.pageTransition('pagehide');
    assert.equal(f.recoveryAborted(), true);
    f.pageTransition('pageshow');
    f.releaseRecovery();
    await nextTurn();

    assert.equal(f.id('checkout-content').hidden, true);
    assert.equal(f.id('checkout-content').textContent.includes(f.original.id), false);
    assert.equal(f.id('checkout-status-title').textContent, '请从桌面重新打开');
    assert.equal(f.id('status-panel').getAttribute('aria-busy'), 'false');
    assert.equal(f.id('recover-context').hidden, true);
    assert.equal(f.calls.length, requestCount);
  });
}
