'use strict';
const assert = require('node:assert/strict');
const {generateKeyPairSync, sign, verify} = require('node:crypto');
const {once} = require('node:events');
const http = require('node:http');
const test = require('node:test');

const moduleReady = import('../server/team/wechat-native-orders.mjs');
const merchantKeys = generateKeyPairSync('rsa', {modulusLength: 2048});
const providerKeys = generateKeyPairSync('rsa', {modulusLength: 2048});
const certificateSerial = 'AB'.repeat(20);
const keyId = 'PUB_KEY_ID_101';
const appId = 'wxsynthetic12345';
const merchantId = '1000000000';
const merchantOrderId = 'native-|*_0123';
const notifyUrl = 'https://shenyi.example.invalid/payments/wechat/native';
const codeUrl = 'weixin://wxpay/bizpayurl?pr=syntheticQR123';
const extendedCodeUrls = ['weixin://wxpay/bizpayurl/up?pr=SynthQR&groupid=00',
  'weixin://pay.weixin.qq.com/bizpayurl/up?pr=SynthQR&groupid=00'];
const now = Date.parse('2026-11-20T15:29:35+08:00');
const paidTime = '2026-11-20T15:29:35+08:00';
const description = '审易团队合成续费';
const locked = Object.freeze({id: 'a021e743-4e2e-41a9-b606-2a8982505001', appId, merchantId,
  merchantOrderId, amountMinor: 288000, currency: 'CNY', createdAt: now - 1_000, expiresAt: now + 600_000, description});

async function client(fetchImpl) {
  const {createWechatNativeOrders} = await moduleReady;
  return createWechatNativeOrders({appId, merchantId, certificateSerial, merchantPrivateKey: merchantKeys.privateKey,
    keys: [{id: keyId, key: providerKeys.publicKey}], notifyUrl, now: () => now, fetchImpl});
}

function signedResponse(payload, {signingKey = providerKeys.privateKey, serial = keyId, signedAt = now,
  edited = false, status = 200} = {}) {
  const timestamp = String(signedAt / 1000);
  const nonce = 'synthetic-provider-nonce';
  const serialized = JSON.stringify(payload, null, 2);
  const signature = sign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${serialized}\n`), signingKey).toString('base64');
  const headers = {'Content-Type': 'application/json', 'Wechatpay-Nonce': nonce, 'Wechatpay-Timestamp': timestamp,
    'Wechatpay-Serial': serial, 'Wechatpay-Signature': signature};
  return new Response(edited ? `${serialized}\n` : serialized, {status, headers});
}

function settled(changes = {}) {
  return {appid: appId, mchid: merchantId, out_trade_no: merchantOrderId, transaction_id: '12340001',
    trade_type: 'NATIVE', trade_state: 'SUCCESS', success_time: paidTime,
    amount: {total: 288000, payer_total: 280000, currency: 'CNY', payer_currency: 'CNY'},
    payer: {openid: 'synthetic-payer'}, attach: 'synthetic-internal-metadata', ...changes};
}

function assertRequestSignature({method, path, headers, body}) {
  assert.match(headers.authorization, /^WECHATPAY2-SHA256-RSA2048 /);
  assert.equal(headers['wechatpay-serial'], keyId);
  const fields = Object.fromEntries(Array.from(headers.authorization.matchAll(/([a-z_]+)="([^"]+)"/g),
    ([, field, value]) => [field, value]));
  assert.deepEqual(Object.keys(fields).sort(), ['mchid', 'nonce_str', 'serial_no', 'signature', 'timestamp']);
  assert.equal(fields.mchid, merchantId);
  assert.equal(fields.serial_no, certificateSerial);
  assert.equal(fields.timestamp, String(now / 1000));
  assert.match(fields.nonce_str, /^[A-Za-z0-9_-]{16,64}$/);
  const message = Buffer.concat([Buffer.from(`${method}\n${path}\n${fields.timestamp}\n${fields.nonce_str}\n`),
    body, Buffer.from('\n')]);
  assert.equal(verify('RSA-SHA256', message, merchantKeys.publicKey, Buffer.from(fields.signature, 'base64')), true);
  return fields.nonce_str;
}

const rejectsOrder = promise => assert.rejects(promise, error => Number.isInteger(error.status) && error.status >= 400);

test('Native create and query sign the actual request bytes over a loopback transport', async t => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({method: request.method, path: request.url, headers: request.headers, body: Buffer.concat(chunks)});
    const packet = signedResponse(request.method === 'POST' ? {code_url: codeUrl} : settled());
    response.writeHead(packet.status, Object.fromEntries(packet.headers));
    response.end(Buffer.from(await packet.arrayBuffer()));
  });
  server.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const checkout = await client(async (input, init) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://api.mch.weixin.qq.com');
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url.pathname}${url.search}`, init);
    return new Response(response.body, {status: response.status, headers: response.headers});
  });

  assert.deepEqual(await checkout.createOrder(locked), {merchantOrderId, codeUrl});
  assert.deepEqual(await checkout.createOrder(locked), {merchantOrderId, codeUrl});
  assert.deepEqual(await checkout.queryOrder(locked), {channel: 'wechat-pay-native-v3', orderId: locked.id,
    merchantOrderId, transactionId: '12340001', appId, merchantId, amountMinor: 288000, currency: 'CNY',
    paidAt: Date.parse(paidTime), state: 'SUCCESS'});

  assert.equal(requests.length, 3);
  const [create, retry, query] = requests;
  assert.equal(create.method, 'POST');
  assert.equal(create.path, '/v3/pay/transactions/native');
  assert.match(create.headers['content-type'], /^application\/json\b/);
  assert.match(create.headers.accept, /^application\/json\b/);
  const {time_expire: expires, ...order} = JSON.parse(create.body);
  assert.equal(Date.parse(expires), locked.expiresAt);
  assert.match(expires, /T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/);
  assert.deepEqual(order, {appid: appId, mchid: merchantId, description, out_trade_no: merchantOrderId,
    notify_url: notifyUrl, amount: {total: locked.amountMinor, currency: 'CNY'}});
  assert.equal(retry.method, create.method);
  assert.equal(retry.path, create.path);
  assert.deepEqual(retry.body, create.body);
  assert.notEqual(assertRequestSignature(create), assertRequestSignature(retry));
  assert.equal(query.method, 'GET');
  assert.equal(query.path, `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrderId)}?mchid=${merchantId}`);
  assert.equal(query.body.length, 0);
  assertRequestSignature(query);
});

test('prepay rejects invalid lock terms locally and preserves supported exact deadlines', async () => {
  let sends = 0;
  const checkout = await client(() => { sends++; return signedResponse({code_url: codeUrl}); });
  for (const order of [
    {...locked, expiresAt: now + 60_000}, {...locked, expiresAt: now + 65_000}, {...locked, expiresAt: now + 66_001},
    {...locked, expiresAt: now + 7 * 86_400_000 + 1_000}, {...locked, appId: 'other-app'},
    {...locked, merchantId: '2000000000'}, {...locked, amountMinor: 288000.5}, {...locked, currency: 'USD'},
  ]) await rejectsOrder(checkout.createOrder(order));
  assert.equal(sends, 0);
  assert.deepEqual(await checkout.createOrder({...locked, expiresAt: now + 66_000}), {merchantOrderId, codeUrl});
  assert.deepEqual(await checkout.createOrder({...locked, expiresAt: now + 7 * 86_400_000}), {merchantOrderId, codeUrl});
  assert.equal(sends, 2);
});

test('prepay requires a current pinned WeChat signature and the official payment URL shape', async () => {
  for (const packet of [
    new Response(JSON.stringify({code_url: codeUrl})),
    signedResponse({code_url: codeUrl}, {signingKey: merchantKeys.privateKey}),
    signedResponse({code_url: codeUrl}, {serial: 'PUB_KEY_ID_999'}),
    signedResponse({code_url: codeUrl}, {signedAt: now - 301_000}),
    signedResponse({code_url: codeUrl}, {edited: true}),
    signedResponse({code_url: codeUrl}, {status: 201}),
    signedResponse({code_url: 'https://payment.example.invalid/order/1'}),
    signedResponse({code_url: 'weixin://profile?pr=syntheticQR123'}),
    signedResponse({code_url: 'weixin://wxpay/bizpayurl?pr='}),
    signedResponse({code_url: `weixin://wxpay/bizpayurl?pr=${'A'.repeat(64)}`}),
  ]) {
    const checkout = await client(() => packet);
    await rejectsOrder(checkout.createOrder(locked));
  }
  for (const url of extendedCodeUrls) {
    const checkout = await client(() => signedResponse({code_url: url}));
    assert.deepEqual(await checkout.createOrder(locked), {merchantOrderId, codeUrl: url});
  }
});

test('query allows authenticated non-success states after expiry and returns only the state', async () => {
  const queryOrder = {id: locked.id, appId, merchantId, merchantOrderId, amountMinor: locked.amountMinor,
    currency: 'CNY', createdAt: locked.createdAt};
  const unpaid = await client(() => signedResponse({appid: appId, mchid: merchantId,
    out_trade_no: merchantOrderId, trade_state: 'NOTPAY', trade_state_desc: '等待支付'}));
  assert.deepEqual(await unpaid.queryOrder(queryOrder), {merchantOrderId, state: 'NOTPAY'});
  assert.deepEqual(await unpaid.queryOrder({...queryOrder, expiresAt: now - 1}),
    {merchantOrderId, state: 'NOTPAY'});
  for (const state of ['REFUND', 'CLOSED']) {
    const checkout = await client(() => signedResponse(settled({trade_state: state})));
    assert.deepEqual(await checkout.queryOrder(queryOrder), {merchantOrderId, state});
  }
});

test('query requires the authenticated transaction to match the locked order before reporting payment', async () => {
  for (const changes of [
    {appid: 'wxdifferent'}, {mchid: '2000000000'}, {out_trade_no: 'another-order'}, {trade_type: 'JSAPI'},
    {transaction_id: ''}, {success_time: '2026-11-20T15:29:33+08:00'}, {trade_state: 'unexpected-state'},
    {amount: {total: 280000, payer_total: 280000, currency: 'CNY', payer_currency: 'CNY'}},
    {amount: {total: 288000, payer_total: 290000, currency: 'CNY', payer_currency: 'CNY'}},
    {amount: {total: 288000, payer_total: 280000, currency: 'USD', payer_currency: 'USD'}},
  ]) {
    const checkout = await client(() => signedResponse(settled(changes)));
    await rejectsOrder(checkout.queryOrder(locked));
  }
  const checkout = await client(() => signedResponse(settled(), {edited: true}));
  await rejectsOrder(checkout.queryOrder(locked));
});

test('changes to the caller object during the query do not alter the locked comparison', async () => {
  const order = {...locked};
  const checkout = await client(async () => {
    await Promise.resolve();
    order.amountMinor = 1;
    order.merchantOrderId = 'changed-order-id';
    return signedResponse(settled());
  });
  const result = await checkout.queryOrder(order);
  assert.equal(result.merchantOrderId, locked.merchantOrderId);
  assert.equal(result.amountMinor, locked.amountMinor);
});

test('redirects and provider error bodies are never treated as successful order data', async () => {
  let calls = 0;
  const redirect = await client((input, init) => {
    calls++;
    assert.ok(['manual', 'error'].includes(init.redirect));
    return new Response(null, {status: 302, headers: {Location: 'https://other.example.invalid/next'}});
  });
  await rejectsOrder(redirect.createOrder(locked));
  assert.equal(calls, 1);

  const nonSuccess = await client(() => signedResponse(settled(), {status: 500}));
  await rejectsOrder(nonSuccess.queryOrder(locked));
});

test('only a signed order-not-exist body with HTTP 404 reports an absent WeChat order', async () => {
  const missing = {code: 'ORDER_NOT_EXIST', message: '合成订单尚未创建'};
  const checkout = await client(() => signedResponse(missing, {status: 404}));
  assert.deepEqual(await checkout.queryOrder(locked), {merchantOrderId, state: 'NOT_FOUND'});
  for (const packet of [
    new Response(JSON.stringify(missing), {status: 404}),
    signedResponse(missing, {status: 500}),
    signedResponse({...missing, code: 'RESOURCE_NOT_EXIST'}, {status: 404}),
  ]) {
    const rejected = await client(() => packet);
    await rejectsOrder(rejected.queryOrder(locked));
  }
});

test('an oversized response stream is cancelled without accepting its body', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(256 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelled = true; },
  });
  const checkout = await client(() => new Response(body));
  await rejectsOrder(checkout.createOrder(locked));
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('the end-to-end provider deadline aborts and releases a stalled response stream', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let signal;
  let cancelled = false;
  const {promise: started, resolve: markStarted} = Promise.withResolvers();
  const body = new ReadableStream({
    pull() {
      markStarted();
      return new Promise(() => {});
    },
    cancel() { cancelled = true; },
  });
  const checkout = await client((input, init) => {
    signal = init.signal;
    return new Response(body);
  });
  const completion = rejectsOrder(checkout.queryOrder(locked));
  await started;
  t.mock.timers.tick(4_999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await completion;
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});
