'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const { TextEncoder } = require('node:util');

const html = readFileSync('desktop/team-ui/index.html', 'utf8');
const script = readFileSync('desktop/team-ui/refund-intake.js', 'utf8');
const orderId = '01000000-0000-4000-8000-000000000000';
const owner = 'refund-reviewer-demo';
const instant = 1795000000000;
const order = { id: orderId, kind: 'annual', teamId: 'team-a', teamName: '合成团队',
  amountMinor: 9007199254740991, currency: 'CNY', status: 'paid', confirmedAt: instant, paymentException: false };
const intake = { revision: 1, kind: 'intake', reason: 'duplicate-payment', reference: 'case-a', recordedAt: instant + 1, recordedBy: owner };
const initial = { order, revision: 0, entries: [], nextBeforeRevision: null };
const ok = value => ({ ok: true, value });
const err = code => ({ ok: false, error: { code } });
const wait = async fn => {
  const until = Date.now() + 2500;
  while (!fn()) {
    assert.ok(Date.now() < until, 'refund intake view did not reach expected state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
function deferred() {
  let resolve;
  const promise = new Promise(settle => { resolve = settle; });
  return { promise, resolve };
}

function fixture(t, override = {}) {
  const dom = new JSDOM(html, { url: 'https://synthetic.invalid/', runScripts: 'outside-only' });
  const { window } = dom;
  window.TextEncoder = TextEncoder;
  window.eval(script);
  const context = { ready: true, identity: owner, actor: owner + ':1', device: 'device:1', busy: false };
  const calls = [], signals = [];
  const handlers = {
    getRefundIntakeAccess: () => ok({ canReview: true }),
    getRefundIntake: () => ok(initial),
    recordRefundIntake: () => ok({ ...initial, revision: 1, entries: [intake] }),
    ...override,
  };
  const api = Object.fromEntries(Object.entries(handlers).map(([method, run]) => [method, async args => {
    calls.push({ method, args });
    return run(args);
  }]));
  const view = window.createRefundIntakeView({ api, getContext: () => context, onUnauthorized: () => signals.push('expired'),
    onDeviceUnavailable: () => signals.push('device') });
  t.after(() => { view.destroy(); window.close(); });
  const id = name => window.document.getElementById('refund-intake-' + name);
  const set = (field, value) => {
    const node = id(field);
    node.value = value;
    node.dispatchEvent(new window.Event(field === 'kind' ? 'change' : 'input', { bubbles: true }));
  };
  async function open() {
    await wait(() => !id('panel').hidden);
    id('panel').open = true;
    await new Promise(resolve => setTimeout(resolve, 0));
    await wait(() => !id('order-id').disabled);
  }
  async function lookup() {
    set('order-id', orderId);
    id('lookup').click();
    await wait(() => !id('details').hidden);
  }
  function enter(reason, reference = '', password = 'synthetic-current-password') {
    set('reason', reason);
    set('reference', reference);
    set('password', password);
    id('record').click();
  }
  return { id, context, calls, signals, view, set, open, lookup, enter, window };
}

test('held workspace and owner capability gate refund intake; the exact original order query displays no case yet', async t => {
  let allowed = false;
  const f = fixture(t, { getRefundIntakeAccess: () => ok({ canReview: allowed }) });
  f.context.ready = false;
  f.view.update();
  assert.equal(f.calls.length, 0);
  f.context.ready = true;
  f.view.update();
  await wait(() => f.calls.length === 1);
  assert.equal(f.id('panel').hidden, true);
  allowed = true;
  f.context.actor = owner + ':2';
  f.view.update();
  await f.open();
  f.set('order-id', 'team-a');
  assert.equal(f.id('lookup').disabled, true);
  await f.lookup();
  assert.match(f.id('order').textContent, /合成团队.*90,071,992,547,409.91/);
  assert.equal(f.id('entry').hidden, false);
  assert.equal(f.id('history').children.length, 0);
  assert.deepEqual({ ...f.calls.find(row => row.method === 'getRefundIntake').args }, { kind: 'annual', orderId });
});

test('intake and follow-up require password, clear it promptly and preserve a known intent across uncertain retries', async t => {
  const first = deferred();
  let submitted = 0;
  const followUp = { revision: 2, kind: 'follow-up', reason: 'payment-checked', reference: null, recordedAt: instant + 2, recordedBy: owner };
  const f = fixture(t, { recordRefundIntake() {
    submitted++;
    if (submitted === 1) return first.promise;
    if (submitted === 2) return ok({ ...initial, revision: 1, entries: [intake] });
    return ok({ ...initial, revision: 2, entries: [followUp, intake] });
  } });
  f.view.update();
  await f.open();
  await f.lookup();
  f.set('reason', 'duplicate-payment');
  assert.equal(f.id('record').disabled, true);
  f.enter('duplicate-payment', 'case-a');
  assert.equal(f.id('password').value, '');
  assert.equal(f.id('record').disabled, true);
  first.resolve(err('SERVICE_UNAVAILABLE'));
  await wait(() => f.id('message').textContent.includes('结果暂未确认'));
  f.enter('duplicate-payment', 'case-a');
  await wait(() => f.id('history').querySelector('[data-revision="1"]'));
  f.enter('payment-checked');
  await wait(() => f.id('history').querySelector('[data-revision="2"]'));
  const calls = f.calls.filter(row => row.method === 'recordRefundIntake').map(row => row.args);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].requestId, calls[1].requestId);
  assert.notEqual(calls[1].requestId, calls[2].requestId);
  assert.equal(calls[2].expectedRevision, 1);
  assert.equal(Object.hasOwn(calls[2], 'reference'), false);
  assert.equal(f.id('password').value, '');
  assert.ok(!f.id('panel').textContent.includes('synthetic-current-password'));
});

test('pending payment can be inspected while its refund intake action stays unavailable', async t => {
  const f = fixture(t, { getRefundIntake: () => ok({
    ...initial, order: { ...order, status: 'pending', confirmedAt: null, paymentException: true }
  }) });
  f.view.update();
  await f.open();
  await f.lookup();
  assert.equal(f.id('entry').hidden, true);
  assert.match(f.id('order').textContent, /未确认收款.*支付异常待复核/);
  f.enter('duplicate-payment');
  assert.equal(f.id('record').disabled, true);
  assert.equal(f.calls.filter(row => row.method === 'recordRefundIntake').length, 0);
});

test('a closed order becomes eligible for intake only after a verified receipt', async t => {
  const closure = { deadlineAt: instant - 1000, closedAt: instant - 500 };
  const closed = { ...order, status: 'closed', confirmedAt: null, closure };
  const late = { ...order, status: 'payment-verified', closure, paymentException: true };
  let currentOrder = closed;
  const f = fixture(t, {
    getRefundIntake: () => ok({ ...initial, order: currentOrder }),
    recordRefundIntake: () => ok({ ...initial, order: currentOrder, revision: 1, entries: [intake] })
  });
  f.view.update();
  await f.open();
  await f.lookup();
  assert.match(f.id('order').textContent, /超时关闭/u);
  assert.match(f.id('order').querySelector('[data-order-closure]').textContent, /超时关闭时间（北京时间）/u);
  assert.equal(f.id('entry').hidden, true);
  f.enter('duplicate-payment');
  assert.equal(f.calls.filter(row => row.method === 'recordRefundIntake').length, 0);

  currentOrder = late;
  await f.lookup();
  assert.match(f.id('order').textContent, /迟到收款待复核.*支付异常待复核/u);
  assert.ok(f.id('order').querySelector('[data-order-closure]'));
  assert.equal(f.id('entry').hidden, false);
  f.enter('duplicate-payment');
  await wait(() => f.id('history').querySelector('[data-revision="1"]'));
  assert.equal(f.calls.filter(row => row.method === 'recordRefundIntake').length, 1);
  assert.match(f.id('order').textContent, /迟到收款待复核/u);
});

test('permission removal clears order and password; stale replies from simultaneous closing and reopening cannot show a case', async t => {
  const held = deferred();
  let authorize = true, count = 0;
  const f = fixture(t, { getRefundIntakeAccess: () => ok({ canReview: authorize }), getRefundIntake: () => count++ === 0 ? held.promise : ok(initial) });
  f.view.update();
  await f.open();
  f.set('order-id', orderId);
  f.id('lookup').click();
  assert.equal(f.id('details').hidden, true);
  f.id('panel').open = false;
  f.id('panel').open = true;
  held.resolve(ok({ ...initial, revision: 1, entries: [intake] }));
  await wait(() => f.id('order-id').value === '' && !f.id('order-id').disabled);
  assert.equal(f.id('history').children.length, 0);
  await f.lookup();
  f.set('password', 'secret-draft');
  authorize = false;
  f.id('panel').open = false;
  f.id('panel').open = true;
  await wait(() => f.id('panel').hidden);
  assert.equal(f.id('password').value, '');
  assert.equal(f.id('order').children.length, 0);
  assert.equal(f.id('order-id').value, '');
});

test('history continues at the exclusive revision; hiding the desktop clears private detail and login fields', async t => {
  const recent = Array.from({length:20}, (_, index) => ({
    revision:21-index,kind:'follow-up',reason:'payment-checked',reference:null,recordedAt:instant+21-index,recordedBy:owner,
  }));
  const f = fixture(t, {getRefundIntake: ({beforeRevision}) => ok(beforeRevision === undefined ?
    {...initial,revision:21,entries:recent,nextBeforeRevision:2} : {...initial,revision:21,entries:[intake]})});
  f.view.update();
  await f.open();
  await f.lookup();
  f.id('older').click();
  await wait(() => f.id('history').children.length === 21);
  assert.equal(f.calls.filter(row => row.method === 'getRefundIntake').at(-1).args.beforeRevision, 2);
  assert.equal(f.id('older').hidden, true);
  f.set('password', 'hidden-draft');
  Object.defineProperty(f.window.document,'visibilityState',{configurable:true,value:'hidden'});
  f.window.document.dispatchEvent(new f.window.Event('visibilitychange'));
  assert.equal(f.id('panel').hidden, true);
  assert.equal(f.id('history').children.length, 0);
  assert.equal(f.id('password').value, '');
});
