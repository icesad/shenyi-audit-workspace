'use strict';

const assert = require('node:assert/strict');
const {createHash, generateKeyPairSync, randomBytes, randomUUID, sign} = require('node:crypto');
const {mkdir, mkdtemp, readFile, rm, writeFile} = require('node:fs/promises');
const https = require('node:https');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {before, after, test} = require('node:test');
const deviceProof = require('../shared/device-proof.cjs');
const {childEnvironment, command, generateCertificates} = require('./helpers/trusted-team-https-fixture.cjs');

const dependencies = Promise.all([
  import('../server/team/database.mjs'),
  import('../server/team/managed-service.mjs'),
  import('../server/team/wechat-native-billing.mjs'),
  import('../server/team/passwords.mjs'),
]);
const apiBase = 'https://localhost';
const checkout = '/api/website-pay';
const issuer = teamId => '/api/teams/' + teamId + '/billing/native-website-handoff';
const purchaseIssuer = teamId => '/api/teams/' + teamId + '/billing/native-website-order-handoff';
const billingOverviewRoute = teamId => '/api/teams/' + teamId + '/billing/overview';
const notifyUrl = 'https://shenyi.example.invalid/api/billing/wechat-native/notify';
const appId = 'wxsynthetic1234567';
const merchantId = '1000000000';
const keyId = 'PUB_KEY_ID_101';
const paymentKeys = generateKeyPairSync('rsa', {modulusLength:2048});
const merchantKeys = generateKeyPairSync('rsa', {modulusLength:2048});
const wechatNativeCallback = {appId, merchantId, apiV3Key:randomBytes(32), keys:[{id:keyId, key:paymentKeys.publicKey}]};
const credentials = {phone:'+8613800000001', password:'SyntheticWebsiteOnly!2026'};
const digest = text => createHash('sha256').update(text).digest('hex');
const teamId = 'team-a';
const actorId = 'admin-a';
const annual = 'team-annual-renewal';
const seat = 'team-seat-addition';
const quote = {teamId, actorId, product:annual, offerId:'synthetic-annual',
  offerRevision:1, seats:3, termRevision:null, amountMinor:288000};
const priceCatalog = Object.freeze({
  annual:Object.freeze({id:'synthetic-native-year', revision:3, baseAmountMinor:82500, unitAmountMinor:6850}),
  seat:Object.freeze({id:'synthetic-native-seat', revision:6, annualUnitAmountMinor:123456789,
    prorationBasis:'beijing-calendar-year-from-quote'}),
  quoteDurationMs:60000,
  paymentDurationMs:900000,
});
const pageOrderKeys = ['amountMinor', 'currency', 'expiresAt', 'id', 'product', 'seats', 'status', 'teamName'];
let directory, tls, encodedPassword;

before(async () => {
  const parent = path.resolve(process.env.SHENYI_TEST_TMPDIR ?? tmpdir());
  await mkdir(parent, {recursive:true});
  const created = await mkdtemp(path.join(parent, 'shenyi-native-website-'));
  assert.equal(path.dirname(path.resolve(created)), parent);
  assert.match(path.basename(created), /^shenyi-native-website-/);
  directory = created;
  const certDirectory = path.join(directory, 'certificates');
  const bundle = await generateCertificates(certDirectory);
  const [ca, key, cert] = await Promise.all([
    readFile(bundle.ca), readFile(path.join(certDirectory, 'valid.key')), readFile(path.join(certDirectory, 'valid.pem')),
  ]);
  tls = {ca, key, cert};
  const [,,, {hashPassword}] = await dependencies;
  encodedPassword = await hashPassword(credentials.password);
});

after(async () => {
  if (directory) await rm(directory, {recursive:true});
});

function request(port, route, {method = 'POST', headers = {}, body} = {}) {
  return new Promise((resolve, reject) => {
    const client = https.request({hostname:'127.0.0.1', servername:'localhost', port, path:route, method,
      ca:tls.ca, rejectUnauthorized:true, agent:false, headers:{host:'localhost', ...headers}}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          const data = text && response.headers['content-type']?.startsWith('application/json') ? JSON.parse(text) : null;
          resolve({status:response.statusCode, headers:response.headers, text, data});
        } catch (error) { reject(error); }
      });
    });
    client.setTimeout(9500, () => client.destroy(new Error('Synthetic HTTPS client exceeded its test deadline')));
    client.on('error', reject);
    client.end(body);
  });
}

function signedProviderResponse(data) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString('hex');
  const raw = Buffer.from(' ' + JSON.stringify(data, null, 2) + '\n');
  const signed = Buffer.concat([Buffer.from(timestamp + '\n' + nonce + '\n'), raw, Buffer.from('\n')]);
  return new Response(raw, {headers:{'content-type':'application/json', 'wechatpay-serial':keyId,
    'wechatpay-timestamp':timestamp, 'wechatpay-nonce':nonce,
    'wechatpay-signature':sign('RSA-SHA256', signed, paymentKeys.privateKey).toString('base64')}});
}

function verifiedTrade(order, state = 'SUCCESS') {
  return {appid:appId, mchid:merchantId, out_trade_no:order.merchantOrderId, transaction_id:'401000000001',
    trade_type:'NATIVE', trade_state:state, success_time:new Date().toISOString(),
    amount:{total:order.amountMinor, payer_total:order.amountMinor, currency:'CNY', payer_currency:'CNY'}};
}

async function fixture(t, {enabled = true, provider, catalog} = {}) {
  const [{initializeTeamDatabase}, {startManagedTeamServer}, {createWechatNativeBilling, installWechatNativeBillingSchema}] =
    await dependencies;
  const filename = path.join(directory, 'synthetic-' + randomUUID() + '.sqlite');
  let db = new DatabaseSync(filename), service;
  async function stop() {
    if (service) {
      service.server.closeAllConnections();
      await service.close();
      service = undefined;
    }
  }
  t.after(async () => {
    try { await stop(); }
    finally { db?.close(); }
  });
  initializeTeamDatabase(db);
  installWechatNativeBillingSchema(db);
  const now = Math.floor(Date.now() / 1000) * 1000;
  db.exec(`
    INSERT INTO teams VALUES ('team-a','active'),('team-b','active');
    INSERT INTO team_profiles VALUES ('team-a','合成主团队'),('team-b','合成独立团队');
    INSERT INTO team_users VALUES ('admin-a','active'),('admin-b','active');
    INSERT INTO team_operators VALUES ('team-a','admin-a','administrator','active'),
      ('team-b','admin-b','administrator','active');
  `);
  db.prepare(`INSERT INTO team_credentials(user_id,username,display_name,password_hash)
    VALUES (?,?,?,?)`).run(actorId, actorId, '合成管理员', encodedPassword);
  db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run(actorId, credentials.phone, now);
  const serverId = db.prepare("SELECT value FROM main.team_database_metadata WHERE name = 'device-server-id'").get().value;
  const calls = [];
  const fetchImpl = async (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://api.mch.weixin.qq.com');
    assert.match(init.headers.Authorization, /^WECHATPAY2-SHA256-RSA2048 /);
    calls.push({method:init.method, path:target.pathname, body:init.body === undefined ? undefined : JSON.parse(init.body)});
    if (provider) return provider(target, init);
    assert.equal(init.method, 'POST', 'The test must explicitly stub a query');
    return signedProviderResponse({code_url:'weixin://wxpay/bizpayurl?pr=SyntheticPayload123'});
  };
  const outbound = {certificateSerial:'AB'.repeat(20), merchantPrivateKey:merchantKeys.privateKey, fetchImpl, notifyUrl};
  async function start(activeCatalog) {
    service = await startManagedTeamServer({db, apiBase, port:0, serverId, key:tls.key, cert:tls.cert,
      ...(enabled ? {wechatNativeCallback, wechatNativeWebsite:{...outbound, ...(activeCatalog ? {catalog:activeCatalog} : {})}} : {})});
    assert.equal(service.address.host, '127.0.0.1');
  }
  await start(catalog);
  function send(route, options) { return request(service.address.port, route, options); }
  function post(route, body, headers = {}) {
    const raw = JSON.stringify(body);
    return send(route, {headers:{'content-type':'application/json', 'content-length':Buffer.byteLength(raw), ...headers}, body:raw});
  }

  async function device() {
    const login = await post('/api/auth/phone/login', credentials);
    assert.equal(login.status, 200, login.text);
    const {token} = login.data;
    const pair = generateKeyPairSync('ed25519');
    const auth = {authorization:'Bearer ' + token, origin:'shenyi://app'};
    const challenge = await post('/api/auth/devices/enrollment-challenges', {
      publicKey:pair.publicKey.export({format:'der', type:'spki'}).toString('base64url'),
      displayName:'合成设备', platform:'win32', currentPassword:credentials.password,
    }, auth);
    assert.equal(challenge.status, 201, challenge.text);
    const fields = challenge.data.challenge;
    const activated = await post('/api/auth/devices/enroll', {challengeId:fields.challengeId,
      signature:sign(null, deviceProof.challengeBytes(fields), pair.privateKey).toString('base64url')}, auth);
    assert.equal(activated.status, 201, activated.text);
    const lease = activated.data.lease;
    const heldToken = activated.data.token;
    function heldRequest(method, route, value, headers = {}) {
      const body = method === 'POST' ? JSON.stringify(value) : undefined;
      const claims = {serverId, userId:actorId, sessionBinding:deviceProof.sessionBinding(heldToken),
        deviceId:lease.deviceId, bindingRevision:lease.bindingRevision, leaseId:lease.id, method, pathAndQuery:route,
        bodySha256:digest(body ?? ''), nonce:randomBytes(32).toString('base64url')};
      const deviceHeaders = {...headers, authorization:'Bearer ' + heldToken, origin:'shenyi://app',
        'x-shenyi-device-lease':lease.token, 'x-shenyi-device-nonce':claims.nonce,
        'x-shenyi-device-body-sha256':claims.bodySha256,
        'x-shenyi-device-signature':sign(null, deviceProof.requestProofBytes(claims), pair.privateKey).toString('base64url')};
      return send(route, {method, body, headers:{...deviceHeaders,
        ...(body === undefined ? {} : {'content-type':'application/json', 'content-length':Buffer.byteLength(body)})}});
    }
    return {heldPost:(route, value) => heldRequest('POST', route, value),
      heldGet:(route, headers) => heldRequest('GET', route, undefined, headers), lease,
      revoke() { db.prepare('UPDATE main.team_device_leases SET revoked_at=? WHERE lease_id=?').run(Date.now(), lease.id); },
      expire() { db.prepare('UPDATE main.team_device_leases SET expires_at=? WHERE lease_id=?').run(Date.now() - 1000, lease.id); }};
  }

  function lock(changes = {}) {
    const billing = createWechatNativeBilling({...wechatNativeCallback, ...outbound, db, now:() => now - 60_000});
    return billing.lockOrder({...quote, requestId:randomUUID(), expiresAt:now + 540_000, ...changes});
  }
  async function issueHandoff(session, route, body) {
    const reply = await session.heldPost(route, body);
    assert.equal(reply.status, 201, reply.text);
    assert.deepEqual(Object.keys(reply.data).sort(), ['expiresAt', 'handoff']);
    assert.equal(Buffer.from(reply.data.handoff, 'base64url').toString('base64url'), reply.data.handoff);
    assert.equal(reply.data.handoff.length, 43);
    assert.ok(reply.data.expiresAt > Date.now() && reply.data.expiresAt <= Date.now() + 120_000);
    return reply.data.handoff;
  }
  return {get db() { return db; }, filename, serverId, send, post, calls, device, lock,
    async restart(activeCatalog) {
      await stop();
      db.close();
      db = undefined;
      db = new DatabaseSync(filename);
      await start(activeCatalog);
    },
    issue:(session, orderId) => issueHandoff(session, issuer(teamId), {orderId}),
    purchase:(session, product, requestId = randomUUID(), previousRequestId) =>
      issueHandoff(session, purchaseIssuer(teamId), {product, requestId, ...(previousRequestId === undefined ? {} : {previousRequestId})}),
    browser(action, handoff, {body = {}, headers = {}} = {}) {
      return post(checkout + '/' + action, {handoff, ...body}, {origin:apiBase, ...headers});
    }};
}

function count(db, table) {
  return db.prepare('SELECT count(*) AS n FROM main.' + table).get().n;
}

async function setTerm(db, {startsAt, endsAt, revision = 0, seats} = {}) {
  const {recordSubscriptionTerm} = await import('../server/team/subscription-store.mjs');
  const term = recordSubscriptionTerm(db, {teamId, operationId:randomUUID(), expectedRevision:revision,
    startsAt, endsAt, sourceRef:'synthetic-website-term'});
  if (seats !== undefined) {
    const {recordSeatCapacityGrant} = await import('../server/team/seat-capacity-store.mjs');
    recordSeatCapacityGrant(db, {teamId, grantId:randomUUID(), seats, startsAt, endsAt, sourceRef:'synthetic-website-capacity'});
  }
  return term;
}

function addActiveWorkers(db) {
  db.exec(`
    INSERT INTO main.team_users VALUES ('worker-a','active'),('worker-b','active');
    INSERT INTO main.team_memberships VALUES ('team-a','worker-a','assistant','active'),
      ('team-a','worker-b','assistant','active');
  `);
}

function expectLease(reply, fields) {
  assert.equal(reply.status, 200, reply.text);
  assert.deepEqual(Object.keys(reply.data).sort(), [...fields, 'handoffExpiresInMs'].sort());
  assert.ok(Number.isSafeInteger(reply.data.handoffExpiresInMs) &&
    reply.data.handoffExpiresInMs > 0 && reply.data.handoffExpiresInMs <= 120_000);
}

function expectOrder(reply, order, status, qr = false) {
  expectLease(reply, qr ? ['order', 'qr'] : ['order']);
  assert.deepEqual(Object.keys(reply.data.order).sort(), pageOrderKeys);
  assert.equal(reply.data.order.id, order.id);
  assert.equal(reply.data.order.amountMinor, order.amountMinor);
  assert.equal(reply.data.order.product, order.product);
  assert.equal(reply.data.order.expiresAt, order.expiresAt);
  assert.equal(reply.data.order.teamName, '合成主团队');
  assert.equal(reply.data.order.seats, order.seats);
  assert.equal(reply.data.order.currency, 'CNY');
  assert.equal(reply.data.order.status, status);
  if (qr) {
    assert.match(reply.data.qr, /^data:image\/gif;base64,[A-Za-z0-9+/]+=*$/);
    const gif = Buffer.from(reply.data.qr.split(',')[1], 'base64');
    assert.match(gif.subarray(0, 6).toString('ascii'), /^GIF8[79]a$/);
    assert.ok(gif.readUInt16LE(6) >= 100 && gif.readUInt16LE(8) >= 100);
  }
}

function expectCheckout(checkoutData, product) {
  assert.deepEqual(Object.keys(checkoutData).sort(), ['defaultSeats', 'maximumSeats', 'minimumSeats', 'product', 'teamName']);
  assert.equal(checkoutData.product, product);
  assert.equal(checkoutData.teamName, '合成主团队');
  for (const field of ['minimumSeats', 'defaultSeats', 'maximumSeats']) {
    assert.ok(Number.isSafeInteger(checkoutData[field]) && checkoutData[field] >= 0);
  }
  assert.ok(checkoutData.minimumSeats <= checkoutData.defaultSeats);
  assert.ok(checkoutData.defaultSeats <= checkoutData.maximumSeats);
}

async function getQuote(f, handoff, product, seats) {
  const reply = await f.browser('quote', handoff, {body:{seats}});
  expectLease(reply, ['checkout', 'quote']);
  expectCheckout(reply.data.checkout, product);
  const snapshot = reply.data.quote;
  assert.deepEqual(Object.keys(snapshot).sort(), ['amountMinor', 'currency', 'id', 'quoteExpiresAt', 'quoteExpiresInMs', 'seats', 'termEndsAt']);
  assert.match(snapshot.id, /^[a-f0-9-]{36}$/);
  assert.equal(snapshot.seats, seats);
  assert.equal(snapshot.currency, 'CNY');
  assert.ok(Number.isSafeInteger(snapshot.amountMinor) && snapshot.amountMinor > 0);
  assert.ok(snapshot.quoteExpiresAt > Date.now() && snapshot.quoteExpiresAt <= Date.now() + priceCatalog.quoteDurationMs);
  assert.ok(Number.isSafeInteger(snapshot.quoteExpiresInMs) && snapshot.quoteExpiresInMs > 0 &&
    snapshot.quoteExpiresInMs <= Math.min(reply.data.handoffExpiresInMs, priceCatalog.quoteDurationMs));
  return snapshot;
}

function assertNoNativePayment(f) {
  assert.equal(f.calls.length, 0);
  assert.equal(count(f.db, 'team_billing_wechat_native_payments'), 0);
  assert.equal(count(f.db, 'team_billing_wechat_native_fulfilments'), 0);
}

test('an authorized original order returns a QR and a signed query fulfils it without creating a second order', async t => {
  let order;
  const f = await fixture(t, {provider:(target, init) => init.method === 'POST'
    ? signedProviderResponse({code_url:'weixin://wxpay/bizpayurl?pr=SyntheticPayload123'})
    : signedProviderResponse(verifiedTrade(order))});
  order = f.lock();
  const handle = await f.issue(await f.device(), order.id);
  const page = await f.send(checkout + '/', {method:'GET'});
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /frame-ancestors\s+'none'/);
  assert.match(page.headers['cache-control'], /no-store/);
  assert.doesNotMatch(page.text, new RegExp(handle));
  expectOrder(await f.browser('order', handle), order, 'pending');
  assert.equal(f.calls.length, 0);
  expectOrder(await f.browser('code', handle), order, 'pending', true);
  assert.equal(f.calls[0].body.out_trade_no, order.merchantOrderId);
  assert.deepEqual(f.calls[0].body.amount, {total:order.amountMinor,currency:'CNY'});
  assert.equal(count(f.db, 'team_billing_wechat_native_payments'), 0);
  expectOrder(await f.browser('check', handle), order, 'fulfilled');
  assert.ok(f.calls[1].path.endsWith('/' + order.merchantOrderId));
  expectOrder(await f.browser('order', handle), order, 'fulfilled');
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 1);
  assert.equal(count(f.db, 'team_billing_wechat_native_payments'), 1);
  assert.equal(count(f.db, 'team_billing_wechat_native_fulfilments'), 1);
  assert.equal(count(f.db, 'team_subscription_events'), 1);
  assert.equal(count(f.db, 'team_seat_capacity_grants'), 1);
  assert.equal(count(f.db, 'team_annual_verified_payments'), 0);
});

test('website handoff protects order identity, locked price, origin, and browser credential boundaries', async t => {
  const f = await fixture(t);
  const session = await f.device();
  const local = f.lock();
  const foreign = f.lock({teamId:'team-b', actorId:'admin-b'});
  assert.equal((await session.heldPost(issuer(teamId), {orderId:foreign.id})).status, 404);
  assert.equal((await session.heldPost(issuer('team-b'), {orderId:foreign.id})).status, 404);
  assert.equal((await session.heldPost(issuer(teamId), {orderId:local.id, amountMinor:1})).status, 400);
  assert.equal((await f.post(issuer(teamId), {orderId:local.id})).status, 401);
  const handoff = await f.issue(session, local.id);
  assert.equal((await f.browser('code', handoff, {body:{amountMinor:1}})).status, 400);
  assert.equal((await f.browser('code', handoff, {body:{orderId:foreign.id}})).status, 400);
  for (const headers of [{origin:'https://other.invalid'}, {cookie:'synthetic=yes'},
    {authorization:'Bearer ignored'}, {'x-shenyi-device-lease':'synthetic'}]) {
    assert.equal((await f.browser('code', handoff, {headers})).status, 403);
  }
  assert.ok([400, 404].includes((await f.browser('code?extra=1', handoff)).status));
  expectOrder(await f.browser('order', handoff), local, 'pending');
  assert.equal(f.calls.length, 0);
  assert.equal(count(f.db, 'team_billing_wechat_native_payments'), 0);
});

test('receipt transport can complete while the requester loses the lease, with no website disclosure or grant', async t => {
  let order;
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const f = await fixture(t, {provider:async () => {
    entered.resolve();
    await release.promise;
    return signedProviderResponse(verifiedTrade(order));
  }});
  order = f.lock();
  const session = await f.device();
  const handoff = await f.issue(session, order.id);
  const check = f.browser('check', handoff);
  try {
    await Promise.race([entered.promise, check.then(reply => assert.fail(reply.text))]);
    session.revoke();
  } finally { release.resolve(); }
  const denied = await check;
  assert.equal(denied.status, 403, denied.text);
  assert.doesNotMatch(denied.text, new RegExp(order.id));
  assert.equal(count(f.db, 'team_billing_wechat_native_payments'), 1);
  assert.equal(count(f.db, 'team_billing_wechat_native_fulfilments'), 0);
  assert.equal((await f.browser('code', handoff)).status, 403);
});

test('a provider-issued code is withheld if the requester loses the device lease during creation', async t => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const f = await fixture(t, {provider:async () => {
    entered.resolve();
    await release.promise;
    return signedProviderResponse({code_url:'weixin://wxpay/bizpayurl?pr=SyntheticPayload123'});
  }});
  const order = f.lock();
  const session = await f.device();
  const handoff = await f.issue(session, order.id);
  const code = f.browser('code', handoff);
  try {
    await Promise.race([entered.promise, code.then(reply => assert.fail(reply.text))]);
    session.revoke();
  } finally { release.resolve(); }
  const denied = await code;
  assert.equal(denied.status, 403, denied.text);
  assert.doesNotMatch(denied.text, /data:image\/gif|weixin:\/\//);
  assert.equal(count(f.db, 'team_billing_wechat_native_payments'), 0);
  assert.equal(f.calls.length, 1);
});

test('a verified payment with insufficient seat capacity stays pending fulfilment', async t => {
  let order;
  const f = await fixture(t, {catalog:priceCatalog, provider:() => signedProviderResponse(verifiedTrade(order))});
  order = f.lock({seats:1});
  const session = await f.device();
  const handoff = await f.issue(session, order.id);
  addActiveWorkers(f.db);
  expectOrder(await f.browser('check', handoff), order, 'pending_fulfilment');
  expectOrder(await f.browser('order', handoff), order, 'pending_fulfilment');
  expectUnresolved(await session.heldPost(purchaseIssuer(teamId),
    {product:annual, requestId:randomUUID(), previousRequestId:order.requestId}));
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 1);
  assert.equal(count(f.db, 'team_billing_wechat_native_payments'), 1);
  assert.equal(count(f.db, 'team_billing_wechat_native_fulfilments'), 0);
  assert.equal(count(f.db, 'team_subscription_events'), 0);
});

test('a signed closed order stays closed and cannot generate another payment QR', async t => {
  let order;
  const f = await fixture(t, {provider:() => signedProviderResponse(verifiedTrade(order, 'CLOSED'))});
  order = f.lock();
  const handoff = await f.issue(await f.device(), order.id);
  expectOrder(await f.browser('check', handoff), order, 'closed');
  const response = await f.browser('code', handoff);
  if (response.status === 200) expectOrder(response, order, 'closed');
  else assert.equal(response.status, 409, response.text);
  assert.equal(f.calls.length, 1);
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 1);
  assert.equal(count(f.db, 'team_billing_wechat_native_payments'), 0);
  assert.equal(count(f.db, 'team_billing_wechat_native_fulfilments'), 0);
});

test('an expired original device lease prevents the website from calling the provider', async t => {
  const f = await fixture(t);
  const order = f.lock();
  const session = await f.device();
  const handoff = await f.issue(session, order.id);
  session.expire();
  assert.equal((await f.browser('order', handoff)).status, 403);
  assert.equal((await f.browser('code', handoff)).status, 403);
  assert.equal((await f.browser('check', handoff)).status, 403);
  assert.equal(f.calls.length, 0);
});

test('the managed service omits Native payment pages and operations without explicit configuration', async t => {
  const f = await fixture(t, {enabled:false});
  assert.equal((await f.send(checkout + '/', {method:'GET'})).status, 404);
  const fabricated = randomBytes(32).toString('base64url');
  assert.equal((await f.browser('order', fabricated)).status, 404);
  assert.equal((await f.browser('code', fabricated)).status, 404);
  assert.equal((await f.browser('check', fabricated)).status, 404);
  assert.equal((await f.send('/ready', {method:'GET'})).status, 200);
  assert.equal(f.calls.length, 0);
});

test('the managed CLI configuration requires separate Native website and callback profiles', async () => {
  const {loadManagedServiceConfiguration} = await import('../scripts/start-team-service.mjs');
  const filename = path.join(directory, 'managed.json');
  const profile = {
    schemaVersion:1, apiBase:'https://checkout.shenyi.example', listenPort:0, serverId:randomUUID(),
    database:path.join(directory, 'managed.sqlite'), tlsKey:path.join(directory, 'certificates', 'valid.key'),
    tlsCertificate:path.join(directory, 'certificates', 'valid.pem'),
    wechatNativeWebsiteProfile:path.join(directory, 'native-merchant.json'),
  };
  const write = current => writeFile(filename, JSON.stringify(current));
  const rejected = {code:'MANAGED_SERVICE_CONFIGURATION_INVALID'};
  await write(profile);
  await assert.rejects(loadManagedServiceConfiguration(filename), rejected);
  await write({...profile, wechatNativeCallbackProfile:profile.wechatNativeWebsiteProfile});
  await assert.rejects(loadManagedServiceConfiguration(filename), rejected);
  const distinct = {...profile, wechatNativeCallbackProfile:path.join(directory, 'native-callback.json')};
  await write(distinct);
  assert.deepEqual(await loadManagedServiceConfiguration(filename), distinct);
});

test('annual renewal quotes the catalog price, locks one order on confirmation, and needs an explicit QR request', async t => {
  const f = await fixture(t, {catalog:priceCatalog});
  const startsAt = Date.now() - 120000;
  await setTerm(f.db, {startsAt, endsAt:startsAt + 30 * 86400000, seats:4});
  const session = await f.device();
  const purchaseId = randomUUID();
  const handoff = await f.purchase(session, annual, purchaseId);
  const page = await f.browser('order', handoff);
  expectLease(page, ['checkout']);
  expectCheckout(page.data.checkout, annual);
  assert.equal(page.data.checkout.defaultSeats, 4);
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 0);
  for (const action of ['code', 'check']) {
    const response = await f.browser(action, handoff);
    assert.equal(response.status, 409, response.text);
  }
  const selectedSeats = 5;
  const snapshot = await getQuote(f, handoff, annual, selectedSeats);
  assert.equal(snapshot.amountMinor, priceCatalog.annual.baseAmountMinor + selectedSeats * priceCatalog.annual.unitAmountMinor);
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 0);
  assertNoNativePayment(f);

  const confirmed = await f.browser('confirm', handoff, {body:{quoteId:snapshot.id}});
  const order = confirmed.data?.order;
  assert.ok(order, confirmed.text);
  expectOrder(confirmed, {...order, amountMinor:snapshot.amountMinor, seats:selectedSeats, product:annual}, 'pending');
  assert.equal(order.expiresAt % 1000, 0);
  assert.ok(order.expiresAt > Date.now() && order.expiresAt <= Date.now() + priceCatalog.paymentDurationMs);
  const row = f.db.prepare(`SELECT request_id, offer_id, offer_revision, currency, merchant_order_id
    FROM main.team_billing_wechat_native_orders WHERE order_id=?`).get(order.id);
  assert.equal(row.request_id, purchaseId);
  assert.equal(row.offer_id, priceCatalog.annual.id);
  assert.equal(row.offer_revision, priceCatalog.annual.revision);
  assert.equal(row.currency, 'CNY');
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 1);
  assertNoNativePayment(f);

  const reopened = await f.purchase(session, annual, purchaseId);
  expectOrder(await f.browser('order', reopened), order, 'pending');
  assert.equal((await f.browser('confirm', reopened, {body:{quoteId:snapshot.id}})).status, 409);
  expectOrder(await f.browser('confirm', handoff, {body:{quoteId:snapshot.id}}), order, 'pending');
  expectOrder(await f.browser('code', reopened), order, 'pending', true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.out_trade_no, row.merchant_order_id);
  assert.deepEqual(f.calls[0].body.amount, {total:snapshot.amountMinor, currency:'CNY'});
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 1);
  assert.equal(count(f.db, 'team_billing_wechat_native_payments'), 0);
});

test('concurrent annual confirmations for the same purchase resolve to the same locked order', async t => {
  const f = await fixture(t, {catalog:priceCatalog});
  const session = await f.device();
  const requestId = randomUUID();
  const first = await f.purchase(session, annual, requestId);
  const second = await f.purchase(session, annual, requestId);
  assert.notEqual(first, second);
  const firstQuote = await getQuote(f, first, annual, 3);
  const secondQuote = await getQuote(f, second, annual, 3);
  const [a, b] = await Promise.all([
    f.browser('confirm', first, {body:{quoteId:firstQuote.id}}),
    f.browser('confirm', second, {body:{quoteId:secondQuote.id}}),
  ]);
  assert.ok(a.data?.order, a.text);
  expectOrder(a, a.data.order, 'pending');
  expectOrder(b, a.data.order, 'pending');
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 1);
  assertNoNativePayment(f);
});

test('formal Native checkout confines setup and prices to the current bound team administrator', async t => {
  const f = await fixture(t, {catalog:priceCatalog});
  const session = await f.device();
  const input = {product:annual, requestId:randomUUID()};
  assert.equal((await f.post(purchaseIssuer(teamId), input)).status, 401);
  assert.equal((await session.heldPost(purchaseIssuer('team-b'), input)).status, 404);
  for (const fields of [{amountMinor:1}, {teamId:'team-b'}, {termRevision:1}, {seats:2}]) {
    assert.equal((await session.heldPost(purchaseIssuer(teamId), {...input, ...fields})).status, 400);
  }
  const handoff = await f.purchase(session, annual, input.requestId);
  for (const fields of [{amountMinor:1}, {currency:'USD'}, {termEndsAt:Date.now()}, {offerRevision:99}]) {
    assert.equal((await f.browser('quote', handoff, {body:{seats:3, ...fields}})).status, 400);
  }
  const snapshot = await getQuote(f, handoff, annual, 3);
  for (const fields of [{amountMinor:1}, {seats:2}, {termEndsAt:Date.now()}, {orderId:randomUUID()}]) {
    assert.equal((await f.browser('confirm', handoff, {body:{quoteId:snapshot.id, ...fields}})).status, 400);
  }
  for (const headers of [{origin:'https://other.invalid'}, {cookie:'synthetic=yes'}, {authorization:'Bearer ignored'}]) {
    assert.equal((await f.browser('confirm', handoff, {body:{quoteId:snapshot.id}, headers})).status, 403);
  }

  f.db.prepare('DELETE FROM main.team_operators WHERE team_id=? AND user_id=?').run(teamId, actorId);
  f.db.prepare("INSERT INTO main.team_memberships VALUES (?,?,'assistant','active')").run(teamId, actorId);
  assert.equal((await session.heldPost(purchaseIssuer(teamId), input)).status, 404);
  assert.equal((await f.browser('confirm', handoff, {body:{quoteId:snapshot.id}})).status, 403);
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 0);
  assertNoNativePayment(f);
});

test('an annual renewal quote is rechecked after additional active members raise seat pressure', async t => {
  const f = await fixture(t, {catalog:priceCatalog});
  const startsAt = Date.now() - 120000;
  await setTerm(f.db, {startsAt, endsAt:startsAt + 30 * 86400000, seats:4});
  const session = await f.device();
  const handoff = await f.purchase(session, annual);
  const old = await getQuote(f, handoff, annual, 1);
  addActiveWorkers(f.db);
  const rejected = await f.browser('confirm', handoff, {body:{quoteId:old.id}});
  assert.equal(rejected.status, 409, rejected.text);
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 0);
  assertNoNativePayment(f);
  const page = await f.browser('order', handoff);
  expectLease(page, ['checkout']);
  assert.equal(page.data.checkout.minimumSeats, 2);
  const updated = await getQuote(f, handoff, annual, 2);
  const confirmed = await f.browser('confirm', handoff, {body:{quoteId:updated.id}});
  assert.ok(confirmed.data?.order, confirmed.text);
  expectOrder(confirmed, {...confirmed.data.order, seats:2, amountMinor:updated.amountMinor}, 'pending');
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 1);
  assertNoNativePayment(f);
});

test('an annual checkout reports the configured seat limit without silently reducing purchased seats', async t => {
  const f = await fixture(t, {catalog:priceCatalog});
  const startsAt = Date.now() - 120000;
  await setTerm(f.db, {startsAt, endsAt:startsAt + 30 * 86400000, seats:1001});
  const handoff = await f.purchase(await f.device(), annual);
  for (const reply of [await f.browser('order', handoff), await f.browser('quote', handoff, {body:{seats:1000}})]) {
    assert.equal(reply.status, 409, reply.text);
    assert.equal(reply.data.error.code, 'WECHAT_NATIVE_SEAT_LIMIT');
  }
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 0);
  assertNoNativePayment(f);
});

test('seat addition uses millisecond proration rounded once and caps the locked order at the original term end', async t => {
  const f = await fixture(t, {catalog:priceCatalog});
  const endsAt = Date.now() + 5 * 60000 + 337;
  await setTerm(f.db, {startsAt:endsAt - 86400000, endsAt, seats:4});
  const session = await f.device();
  const handoff = await f.purchase(session, seat);
  const selectedSeats = 3;
  const snapshot = await getQuote(f, handoff, seat, selectedSeats);
  assert.equal(snapshot.termEndsAt, endsAt);
  const issuedAt = snapshot.quoteExpiresAt - priceCatalog.quoteDurationMs;
  const offset = 8 * 60 * 60000;
  const beijing = new Date(issuedAt + offset);
  const month = beijing.getUTCMonth();
  beijing.setUTCFullYear(beijing.getUTCFullYear() + 1);
  if (beijing.getUTCMonth() !== month) beijing.setUTCDate(0);
  const denominator = BigInt(beijing.getTime() - offset - issuedAt);
  const numerator = BigInt(priceCatalog.seat.annualUnitAmountMinor) * BigInt(selectedSeats) * BigInt(endsAt - issuedAt);
  assert.equal(snapshot.amountMinor, Number((numerator + denominator - 1n) / denominator));
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 0);
  assertNoNativePayment(f);

  const confirmed = await f.browser('confirm', handoff, {body:{quoteId:snapshot.id}});
  const order = confirmed.data?.order;
  assert.ok(order, confirmed.text);
  expectOrder(confirmed, {...order, amountMinor:snapshot.amountMinor, seats:selectedSeats, product:seat,
    expiresAt:Math.floor(endsAt / 1000) * 1000}, 'pending');
  const row = f.db.prepare(`SELECT term_revision, offer_id, offer_revision FROM main.team_billing_wechat_native_orders
    WHERE order_id=?`).get(order.id);
  assert.equal(row.term_revision, 1);
  assert.equal(row.offer_id, priceCatalog.seat.id);
  assert.equal(row.offer_revision, priceCatalog.seat.revision);
  assertNoNativePayment(f);
  expectOrder(await f.browser('code', handoff), order, 'pending', true);
  assert.deepEqual(f.calls[0].body.amount, {total:snapshot.amountMinor, currency:'CNY'});
});

test('seat checkout refuses a term that cannot cover the remaining handoff plus the provider payment window', async t => {
  t.mock.timers.enable({apis:['Date'], now:Date.now()});
  const f = await fixture(t, {catalog:priceCatalog});
  await setTerm(f.db, {startsAt:Date.now() - 120000, endsAt:Date.now() + 100000, seats:4});
  const handoff = await f.purchase(await f.device(), seat);
  const quote = await f.browser('quote', handoff, {body:{seats:2}});
  assert.equal(quote.status, 409, quote.text);
  assert.equal(quote.data.error.code, 'WECHAT_NATIVE_PAYMENT_WINDOW');
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 0);
  assertNoNativePayment(f);
});

test('a locked original order with too little time remains readable but cannot request a payment code', async t => {
  t.mock.timers.enable({apis:['Date'], now:Date.now()});
  const f = await fixture(t);
  const expiresAt = Math.floor(Date.now() / 1000) * 1000 + 60000;
  const order = f.lock({expiresAt});
  const handoff = await f.issue(await f.device(), order.id);
  expectOrder(await f.browser('order', handoff), order, 'pending');
  const rejected = await f.browser('code', handoff);
  assert.equal(rejected.status, 409, rejected.text);
  assert.equal(rejected.data.error.code, 'WECHAT_NATIVE_PAYMENT_WINDOW');
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 1);
  assertNoNativePayment(f);
});

test('a new subscription revision invalidates a seat quote before order creation', async t => {
  const f = await fixture(t, {catalog:priceCatalog});
  const startsAt = Date.now() - 120000;
  const endsAt = startsAt + 30 * 86400000;
  await setTerm(f.db, {startsAt, endsAt, seats:4});
  const handoff = await f.purchase(await f.device(), seat);
  const snapshot = await getQuote(f, handoff, seat, 2);
  await setTerm(f.db, {startsAt, endsAt, revision:1});
  const stale = await f.browser('confirm', handoff, {body:{quoteId:snapshot.id}});
  assert.equal(stale.status, 409, stale.text);
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 0);
  assertNoNativePayment(f);
  const fresh = await getQuote(f, handoff, seat, 2);
  assert.equal(fresh.termEndsAt, endsAt);
  const locked = await f.browser('confirm', handoff, {body:{quoteId:fresh.id}});
  assert.ok(locked.data?.order, locked.text);
  expectOrder(locked, {...locked.data.order, amountMinor:fresh.amountMinor}, 'pending');
  assert.equal(f.db.prepare('SELECT term_revision FROM main.team_billing_wechat_native_orders').get().term_revision, 2);
});

test('a quote expires at its exact deadline while the original handoff can obtain a fresh quote', async t => {
  t.mock.timers.enable({apis:['Date'], now:Date.now()});
  const f = await fixture(t, {catalog:priceCatalog});
  const session = await f.device();
  const purchaseId = randomUUID();
  const handoff = await f.purchase(session, annual, purchaseId);
  const old = await getQuote(f, handoff, annual, 2);
  t.mock.timers.setTime(old.quoteExpiresAt);
  const stale = await f.browser('confirm', handoff, {body:{quoteId:old.id}});
  assert.equal(stale.status, 409, stale.text);
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 0);
  assertNoNativePayment(f);

  const fresh = await getQuote(f, handoff, annual, 2);
  assert.notEqual(fresh.id, old.id);
  const locked = await f.browser('confirm', handoff, {body:{quoteId:fresh.id}});
  assert.ok(locked.data?.order, locked.text);
  expectOrder(locked, {...locked.data.order, amountMinor:fresh.amountMinor}, 'pending');
  t.mock.timers.setTime(fresh.quoteExpiresAt);
  const reopened = await f.purchase(session, annual, purchaseId);
  expectOrder(await f.browser('order', reopened), locked.data.order, 'pending');
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 1);
  assertNoNativePayment(f);
});

test('a Native installation without a price catalog can still access an existing order', async t => {
  const f = await fixture(t);
  const session = await f.device();
  const disabled = await session.heldPost(purchaseIssuer(teamId), {product:annual, requestId:randomUUID()});
  assert.equal(disabled.status, 404, disabled.text);
  const existing = f.lock();
  const handoff = await f.issue(session, existing.id);
  expectOrder(await f.browser('order', handoff), existing, 'pending');
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 1);
  assertNoNativePayment(f);
});

test('an order survives a service restart and repricing with its original amount and merchant order number', async t => {
  const f = await fixture(t, {catalog:priceCatalog});
  const session = await f.device();
  const requestId = randomUUID();
  const handoff = await f.purchase(session, annual, requestId);
  const snapshot = await getQuote(f, handoff, annual, 3);
  const locked = await f.browser('confirm', handoff, {body:{quoteId:snapshot.id}});
  const order = locked.data?.order;
  assert.ok(order, locked.text);
  expectOrder(locked, {...order, amountMinor:snapshot.amountMinor}, 'pending');
  const merchantOrder = f.db.prepare('SELECT merchant_order_id FROM main.team_billing_wechat_native_orders WHERE order_id=?').get(order.id);

  const repriced = {...priceCatalog, annual:{...priceCatalog.annual, revision:4, baseAmountMinor:99900}};
  await f.restart(repriced);
  assert.equal((await f.browser('order', handoff)).status, 403);
  const resumed = await f.purchase(session, annual, requestId);
  expectOrder(await f.browser('order', resumed), order, 'pending');
  assert.equal((await session.heldPost(purchaseIssuer(teamId), {product:seat, requestId})).status, 404);
  assert.equal((await f.browser('quote', resumed, {body:{seats:4}})).status, 409);

  const fresh = await f.purchase(session, annual);
  const newQuote = await getQuote(f, fresh, annual, 3);
  assert.equal(newQuote.amountMinor, repriced.annual.baseAmountMinor + 3 * repriced.annual.unitAmountMinor);
  assert.notEqual(newQuote.amountMinor, snapshot.amountMinor);
  assertNoNativePayment(f);
  expectOrder(await f.browser('code', resumed), order, 'pending', true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.out_trade_no, merchantOrder.merchant_order_id);
  assert.equal(f.calls[0].body.amount.total, snapshot.amountMinor);
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 1);
});

test('managed CLI startup validates the optional Native merchant price catalog without contacting a provider', async t => {
  const f = await fixture(t, {enabled:false});
  const certificates = path.join(directory, 'certificates');
  const filename = path.join(directory, 'managed-catalog.json');
  const callbackPath = path.join(directory, 'managed-catalog-callback.json');
  const websitePath = path.join(directory, 'managed-catalog-website.json');
  const config = {
    schemaVersion:1, apiBase:'https://wrong.invalid', listenPort:0, serverId:f.serverId, database:f.filename,
    tlsCertificate:path.join(certificates, 'wrong-host.pem'), tlsKey:path.join(certificates, 'wrong-host.key'),
  };
  const provider = 'wechat-pay-native-v3';
  const callback = {schemaVersion:1, provider, appId, merchantId, apiV3Key:wechatNativeCallback.apiV3Key.toString('base64url'),
    keys:[{id:keyId, key:paymentKeys.publicKey.export({format:'pem', type:'spki'})}]};
  const website = {schemaVersion:1, provider, certificateSerial:'AB'.repeat(20),
    merchantPrivateKey:merchantKeys.privateKey.export({format:'pem', type:'pkcs8'})};
  await writeFile(callbackPath, JSON.stringify(callback), {mode:0o600});
  await writeFile(websitePath, JSON.stringify(website), {mode:0o600});

  const args = [path.join(__dirname, '..', 'scripts', 'start-team-service.mjs'), '--check-startup', '--config', filename];
  const preflight = () => command(process.execPath, args, {cwd:directory, env:childEnvironment()});
  const expectReady = async () => {
    const result = await preflight();
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {event:'startup-ready'});
  };
  await writeFile(filename, JSON.stringify(config));
  await expectReady();
  await writeFile(filename, JSON.stringify({...config, wechatNativeCallbackProfile:callbackPath, wechatNativeWebsiteProfile:websitePath}));
  await expectReady();
  await writeFile(websitePath, JSON.stringify({...website, catalog:{...priceCatalog, paymentDurationMs:187000}}));
  await expectReady();

  for (const invalid of [{...priceCatalog, paymentDurationMs:186000},
    {...priceCatalog, seat:{...priceCatalog.seat, prorationBasis:'fixed-365-days'}}]) {
    await writeFile(websitePath, JSON.stringify({...website, catalog:invalid}));
    const result = await preflight();
    assert.equal(result.code, 1);
    assert.equal(result.stdout.trim(), '');
    const failure = result.stderr.split(/\r?\n/).find(line => line.startsWith('{'));
    assert.ok(failure, result.stderr);
    const error = JSON.parse(failure);
    assert.equal(error.event, 'error');
    assert.equal(error.code, 'MANAGED_WECHAT_NATIVE_WEBSITE_NOT_READY');
    assert.ok(!result.stderr.includes(callback.apiV3Key));
    assert.doesNotMatch(result.stderr, /BEGIN PRIVATE KEY/);
  }
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 0);
  assertNoNativePayment(f);
});

test('managed billing overview exposes Native checkout capability only to the negotiated authorized view', async t => {
  const capability = {'X-Shenyi-Native-Checkout':'native-v1'};
  const route = billingOverviewRoute(teamId);
  const f = await fixture(t, {catalog:priceCatalog});
  const session = await f.device();
  const normal = await session.heldGet(route);
  assert.equal(normal.status, 200, normal.text);
  assert.equal(Object.hasOwn(normal.data, 'nativeCheckout'), false);
  const unsupported = await session.heldGet(route, {'X-Shenyi-Native-Checkout':'future-v2'});
  assert.equal(unsupported.status, 200, unsupported.text);
  assert.deepEqual(unsupported.data, normal.data);
  const optedIn = await session.heldGet(route, capability);
  assert.equal(optedIn.status, 200, optedIn.text);
  assert.deepEqual(optedIn.data, {...normal.data, nativeCheckout:{canPurchase:true}});
  assert.equal((await f.send(route, {method:'GET', headers:capability})).status, 401);
  const foreign = await session.heldGet(billingOverviewRoute('team-b'), capability);
  assert.equal(foreign.status, 404, foreign.text);
  assert.equal(Object.hasOwn(foreign.data, 'nativeCheckout'), false);

  await f.restart();
  const existing = await session.heldGet(route, capability);
  assert.equal(existing.status, 200, existing.text);
  assert.deepEqual(existing.data, {...normal.data, nativeCheckout:{canPurchase:false}});
  assertNoNativePayment(f);

  const disabled = await fixture(t, {enabled:false});
  const disabledSession = await disabled.device();
  const originView = await disabledSession.heldGet(route);
  const disabledView = await disabledSession.heldGet(route, capability);
  assert.equal(originView.status, 200, originView.text);
  assert.equal(disabledView.status, 200, disabledView.text);
  assert.equal(Object.hasOwn(originView.data, 'nativeCheckout'), false);
  assert.deepEqual(disabledView.data, originView.data);
  assertNoNativePayment(disabled);
});

function expectUnresolved(reply) {
  assert.equal(reply.status, 409, reply.text);
  assert.equal(reply.data.error.code, 'WECHAT_NATIVE_PREVIOUS_ORDER_UNRESOLVED');
  assert.deepEqual(Object.keys(reply.data), ['error']);
}

test('desktop cannot replace a missing, pending, or expired order without verified closure', async t => {
  t.mock.timers.enable({apis:['Date'], now:Date.now()});
  const f = await fixture(t, {catalog:priceCatalog});
  const pending = f.lock();
  const foreign = f.lock({teamId:'team-b', actorId:'admin-b'});
  const expired = f.lock({expiresAt:Math.floor(Date.now() / 1000) * 1000 + 60000});
  const session = await f.device();
  t.mock.timers.setTime(expired.expiresAt);
  const original = await f.issue(session, expired.id);
  expectOrder(await f.browser('order', original), expired, 'expired');

  const route = purchaseIssuer(teamId);
  for (const previousRequestId of [randomUUID(), pending.requestId, expired.requestId, foreign.requestId]) {
    expectUnresolved(await session.heldPost(route, {product:annual, requestId:randomUUID(), previousRequestId}));
  }
  const repeat = await session.heldPost(route, {product:annual, requestId:pending.requestId, previousRequestId:pending.requestId});
  assert.equal(repeat.status, 400, repeat.text);
  const malformed = await session.heldPost(route, {product:annual, requestId:randomUUID(), previousRequestId:42});
  assert.equal(malformed.status, 400, malformed.text);
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 3);
  assertNoNativePayment(f);
});

test('desktop can start a new purchase after verified fulfilment of the same actor and product', async t => {
  let old;
  const f = await fixture(t, {catalog:priceCatalog, provider:() => signedProviderResponse(verifiedTrade(old))});
  old = f.lock();
  const session = await f.device();
  const original = await f.issue(session, old.id);
  expectOrder(await f.browser('check', original), old, 'fulfilled');
  expectUnresolved(await session.heldPost(purchaseIssuer(teamId),
    {product:seat, requestId:randomUUID(), previousRequestId:old.requestId}));
  const nextId = randomUUID();
  const replacement = await f.purchase(session, annual, nextId, old.requestId);
  const page = await f.browser('order', replacement);
  expectLease(page, ['checkout']);
  expectCheckout(page.data.checkout, annual);
  const quote = await getQuote(f, replacement, annual, 3);
  const response = await f.browser('confirm', replacement, {body:{quoteId:quote.id}});
  const order = response.data?.order;
  assert.ok(order, response.text);
  expectOrder(response, {...order, amountMinor:quote.amountMinor}, 'pending');
  assert.notEqual(order.id, old.id);
  assert.equal(f.db.prepare('SELECT request_id FROM main.team_billing_wechat_native_orders WHERE order_id=?').get(order.id).request_id,
    nextId);
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 2);
  assert.equal(count(f.db, 'team_billing_wechat_native_payments'), 1);
  assert.equal(count(f.db, 'team_billing_wechat_native_fulfilments'), 1);
  assert.equal(f.calls.length, 1);
});

test('a verified refund blocks a new purchase while preserving the already locked successor', async t => {
  t.mock.timers.enable({apis:['Date'], now:Date.now()});
  let old, coworker, providerState = 'CLOSED';
  const f = await fixture(t, {catalog:priceCatalog, provider:target => {
    if (target.pathname.endsWith('/' + coworker.merchantOrderId)) return signedProviderResponse(verifiedTrade(coworker, 'CLOSED'));
    assert.ok(target.pathname.endsWith('/' + old.merchantOrderId));
    return signedProviderResponse(verifiedTrade(old, providerState));
  }});
  f.db.exec("UPDATE main.team_operators SET team_id='team-a' WHERE user_id='admin-b'");
  coworker = f.lock({actorId:'admin-b'});
  old = f.lock();
  const session = await f.device();
  const coworkerHandoff = await f.issue(session, coworker.id);
  expectOrder(await f.browser('check', coworkerHandoff), coworker, 'closed');
  expectUnresolved(await session.heldPost(purchaseIssuer(teamId),
    {product:annual, requestId:randomUUID(), previousRequestId:coworker.requestId}));
  const original = await f.issue(session, old.id);
  expectOrder(await f.browser('check', original), old, 'closed');
  const candidateId = randomUUID();
  const candidate = await f.purchase(session, annual, candidateId, old.requestId);
  const toQuote = await f.purchase(session, annual, candidateId, old.requestId);
  const quote = await getQuote(f, candidate, annual, 3);
  const successorId = randomUUID();
  const successor = await f.purchase(session, annual, successorId, old.requestId);
  const successorQuote = await getQuote(f, successor, annual, 3);
  const locked = await f.browser('confirm', successor, {body:{quoteId:successorQuote.id}});
  const order = locked.data?.order;
  assert.ok(order, locked.text);
  expectOrder(locked, {...order, amountMinor:successorQuote.amountMinor}, 'pending');

  t.mock.timers.tick(2000);
  providerState = 'REFUND';
  expectOrder(await f.browser('check', original), old, 'needs_review');
  const reopened = await f.purchase(session, annual, successorId, old.requestId);
  expectOrder(await f.browser('order', reopened), order, 'pending');
  expectUnresolved(await session.heldPost(purchaseIssuer(teamId),
    {product:annual, requestId:candidateId, previousRequestId:old.requestId}));
  expectUnresolved(await f.browser('quote', toQuote, {body:{seats:3}}));
  expectUnresolved(await f.browser('confirm', candidate, {body:{quoteId:quote.id}}));
  assert.equal(count(f.db, 'team_billing_wechat_native_orders'), 3);
  assert.equal(count(f.db, 'team_billing_wechat_native_payments'), 0);
  assert.equal(count(f.db, 'team_billing_wechat_native_fulfilments'), 0);
  assert.equal(f.calls.length, 3);
});
