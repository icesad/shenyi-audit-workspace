'use strict';
const assert = require('node:assert/strict');
const {createHash, generateKeyPairSync, sign, verify} = require('node:crypto');
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
  const serialized = status === 204 ? '' : JSON.stringify(payload, null, 2);
  const signature = sign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${serialized}\n`), signingKey).toString('base64');
  const headers = {'Content-Type': 'application/json', 'Wechatpay-Nonce': nonce, 'Wechatpay-Timestamp': timestamp,
    'Wechatpay-Serial': serial, 'Wechatpay-Signature': signature};
  return new Response(status === 204 ? null : edited ? `${serialized}\n` : serialized, {status, headers});
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

test('Native create, query and close sign the actual request bytes over a loopback transport', async t => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({method: request.method, path: request.url, headers: request.headers, body: Buffer.concat(chunks)});
    const packet = request.url.endsWith('/close') ? signedResponse(null, {status: 204}) :
      signedResponse(request.method === 'POST' ? {code_url: codeUrl} : settled());
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
  assert.deepEqual(await checkout.closeOrder({...locked, createdAt: now - 600_000, expiresAt: now}),
    {merchantOrderId, acknowledged: true});

  assert.equal(requests.length, 4);
  const [create, retry, query, close] = requests;
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
  assert.equal(close.method, 'POST');
  assert.equal(close.path, `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrderId)}/close`);
  assert.match(close.headers['content-type'], /^application\/json\b/);
  assert.match(close.headers.accept, /^application\/json\b/);
  assert.deepEqual(JSON.parse(close.body), {mchid: merchantId});
  assertRequestSignature(close);
});

test('close uses the locked merchant identity and requires its exact expiry to have passed', async () => {
  let sends = 0;
  const checkout = await client(() => { sends++; return signedResponse(null, {status: 204}); });
  const expired = {...locked, createdAt: now - 600_000, expiresAt: now};
  for (const order of [locked, {...expired, expiresAt: now - 1}, {...expired, expiresAt: expired.createdAt},
    {...expired, expiresAt: undefined}, {...expired, appId: 'other-app'}, {...expired, merchantId: '2000000000'},
    {...expired, merchantOrderId: 'other/path'}, {...expired, currency: 'USD'}]) {
    await assert.rejects(checkout.closeOrder(order), {code:'WECHAT_NATIVE_LOCK_INVALID'});
  }
  assert.equal(sends, 0);
  assert.deepEqual(await checkout.closeOrder(expired), {merchantOrderId, acknowledged:true});
  assert.equal(sends, 1);
});

test('close accepts only a signed empty 204 without treating other replies as evidence', async () => {
  const expired = {...locked, createdAt: now - 600_000, expiresAt: now};
  const contradictoryLength = signedResponse(null, {status: 204});
  contradictoryLength.headers.set('Content-Length', '1');
  const signatureOfNonemptyBody = signedResponse({state:'CLOSED'}).headers;
  for (const packet of [new Response(null, {status: 204}), contradictoryLength,
    new Response(null, {status: 204, headers: signatureOfNonemptyBody}),
    signedResponse(null, {status: 204, signingKey: merchantKeys.privateKey}),
    signedResponse(null, {status: 204, serial: 'PUB_KEY_ID_202'}),
    signedResponse(null, {status: 204, signedAt: now - 301_000}),
    signedResponse({trade_state:'CLOSED'}), signedResponse({code:'ORDER_NOT_EXIST'}, {status: 404}),
    new Response(null, {status: 302, headers: {Location: 'https://other.example.invalid/next'}})]) {
    const checkout = await client(() => packet);
    await assert.rejects(checkout.closeOrder(expired), {code:'WECHAT_NATIVE_PROVIDER_UNAVAILABLE'});
  }
  const wrongEndpointStatus = await client(() => signedResponse(null, {status: 204}));
  await rejectsOrder(wrongEndpointStatus.createOrder(locked));
  await rejectsOrder(wrongEndpointStatus.queryOrder(locked));
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

const billDate = '2026-11-19';
const billApplyPath = `/v3/bill/tradebill?bill_date=${billDate}&bill_type=ALL`;
const billDownloadPaths = ['/v3/bill/downloadurl?token=one%2fexample%2B%3D', '/v3/billdownload/file?token=two-example'];
const billBytes = Buffer.from('\ufeff合成商户账单,金额\r\n样例,3.50\r\n');
const billHash = createHash('sha1').update(billBytes).digest('hex');
const billDescriptor = (downloadPath = billDownloadPaths[0], changes = {}) => ({hash_type: 'SHA1',
  hash_value: billHash.toUpperCase(), download_url: `https://api.mch.weixin.qq.com${downloadPath}`, ...changes});

test('the signed bill descriptor and either official file path preserve raw request and bill bytes', async t => {
  const requests = [];
  let applied = 0;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({method: request.method, path: request.url, headers: request.headers, body: Buffer.concat(chunks)});
    if (request.url === billApplyPath) {
      const packet = signedResponse(billDescriptor(billDownloadPaths[applied++]));
      response.writeHead(packet.status, Object.fromEntries(packet.headers));
      response.end(Buffer.from(await packet.arrayBuffer()));
    } else {
      response.writeHead(200, {'Content-Type': 'application/octet-stream'});
      response.end(billBytes);
    }
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
  for (const path of billDownloadPaths) {
    const bill = await checkout.downloadTradeBill(billDate);
    assert.deepEqual(bill, {billDate, bytes: billBytes, sha1: billHash});
    const [application, download] = requests.splice(0);
    assert.equal(application.path, billApplyPath);
    assert.equal(download.path, path);
    assert.equal(application.headers.accept, 'application/json');
    assert.equal(download.headers.accept, '*/*');
    assert.equal(download.headers['accept-encoding'], 'identity');
    for (const request of [application, download]) {
      assert.equal(request.method, 'GET');
      assert.equal(request.body.length, 0);
      assertRequestSignature(request);
    }
  }
});

test('bill dates and signed descriptor scope are checked before any file download', async () => {
  let calls = 0;
  const unused = await client(() => { calls++; throw new Error('Unexpected request'); });
  for (const value of [undefined, '2026-11-31', '2026-02-29', '2026-11-19\n', '2026-11-19&bill_type=REFUND']) {
    await assert.rejects(unused.downloadTradeBill(value), {code: 'WECHAT_NATIVE_BILL_DATE_INVALID'});
  }
  assert.equal(calls, 0);
  const invalidUrls = ['http://api.mch.weixin.qq.com/v3/billdownload/file?token=x',
    'https://api.mch.weixin.qq.com.example.invalid/v3/billdownload/file?token=x',
    'https://api.mch.weixin.qq.com:443/v3/billdownload/file?token=x',
    'https://api.mch.weixin.qq.com@other.invalid/v3/billdownload/file?token=x',
    'https://api.mch.weixin.qq.com/v3/billdownload/../bill/downloadurl?token=x',
    'https://api.mch.weixin.qq.com/v3/billdownload/file?token=',
    'https://api.mch.weixin.qq.com/v3/billdownload/file?token=x&token=y',
    'https://api.mch.weixin.qq.com/v3/billdownload/file?token=x&tar_type=GZIP',
    'https://api.mch.weixin.qq.com/v3/billdownload/file?token=x%26token%3Dy',
    'https://api.mch.weixin.qq.com/v3/billdownload/file?token=x#y'];
  for (const packet of [signedResponse(billDescriptor(), {edited: true}),
    signedResponse(billDescriptor(), {signingKey: merchantKeys.privateKey}),
    signedResponse(billDescriptor(undefined, {hash_type:'SHA256'})),
    signedResponse(billDescriptor(undefined, {hash_value:'0'.repeat(39)})),
    ...invalidUrls.map(download_url => signedResponse(billDescriptor(undefined, {download_url})))]) {
    let sends = 0;
    const checkout = await client(() => { sends++; return packet; });
    await assert.rejects(checkout.downloadTradeBill(billDate), {code: 'WECHAT_NATIVE_PROVIDER_UNAVAILABLE'});
    assert.equal(sends, 1);
  }
});

test('bill downloads reject wrong digest, unexpected status, redirection and files over 32 MiB', async () => {
  const largest = Buffer.alloc(32 * 1024 * 1024, 97);
  const fullHash = createHash('sha1').update(largest).digest('hex');
  const maxFile = await client(input => input.endsWith(billApplyPath)
    ? signedResponse(billDescriptor(undefined, {hash_value: fullHash})) : new Response(largest));
  assert.deepEqual(await maxFile.downloadTradeBill(billDate), {billDate, bytes: largest, sha1: fullHash});

  let cancelled = false;
  const largeStream = new ReadableStream({
    start(controller) { controller.enqueue(largest); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  });
  for (const response of [new Response('changed bytes'), new Response(null), new Response(null, {status: 404}),
    new Response(null, {status: 302, headers:{Location:'https://other.example.invalid/bill'}}),
    new Response(billBytes, {headers:{'Content-Length':String(largest.length + 1)}}), new Response(largeStream)]) {
    const checkout = await client((input, init) => {
      assert.equal(init.redirect, 'error');
      return input.endsWith(billApplyPath) ? signedResponse(billDescriptor()) : response;
    });
    await assert.rejects(checkout.downloadTradeBill(billDate), {code: 'WECHAT_NATIVE_PROVIDER_UNAVAILABLE'});
  }
  assert.equal(cancelled, true);
  assert.equal(largeStream.locked, false);
});

test('a stalled bill download uses the same deadline and releases its response stream', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const {promise: started, resolve: markStarted} = Promise.withResolvers();
  let signal, cancelled = false;
  const body = new ReadableStream({
    pull() { markStarted(); return new Promise(() => {}); },
    cancel() { cancelled = true; },
  }, {highWaterMark: 0});
  const checkout = await client((input, init) => {
    if (input.endsWith(billApplyPath)) return signedResponse(billDescriptor());
    signal = init.signal;
    return new Response(body);
  });
  const failure = assert.rejects(checkout.downloadTradeBill(billDate), {code: 'WECHAT_NATIVE_PROVIDER_UNAVAILABLE'});
  await started;
  t.mock.timers.tick(4_999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await failure;
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
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
