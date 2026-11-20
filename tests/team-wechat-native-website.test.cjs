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
const {generateCertificates} = require('./helpers/trusted-team-https-fixture.cjs');

const dependencies = Promise.all([
  import('../server/team/database.mjs'),
  import('../server/team/managed-service.mjs'),
  import('../server/team/wechat-native-billing.mjs'),
  import('../server/team/passwords.mjs'),
]);
const apiBase = 'https://localhost';
const checkout = '/api/website-pay';
const issuer = teamId => '/api/teams/' + teamId + '/billing/native-website-handoff';
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
const quote = {teamId, actorId, product:'team-annual-renewal', offerId:'synthetic-annual',
  offerRevision:1, seats:3, termRevision:null, amountMinor:288000};
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

async function fixture(t, {enabled = true, provider} = {}) {
  const [{initializeTeamDatabase}, {startManagedTeamServer}, {createWechatNativeBilling, installWechatNativeBillingSchema}] =
    await dependencies;
  const filename = path.join(directory, 'synthetic-' + randomUUID() + '.sqlite');
  const db = new DatabaseSync(filename);
  let service;
  t.after(async () => {
    try {
      if (service) {
        service.server.closeAllConnections();
        await service.close();
      }
    } finally { db.close(); }
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
  const billing = createWechatNativeBilling({...wechatNativeCallback, ...outbound, db, now:() => now - 60_000});
  service = await startManagedTeamServer({db, apiBase, port:0, serverId, key:tls.key, cert:tls.cert,
    ...(enabled ? {wechatNativeCallback, wechatNativeWebsite:outbound} : {})});
  assert.equal(service.address.host, '127.0.0.1');
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
    function heldPost(route, value) {
      const claims = {serverId, userId:actorId, sessionBinding:deviceProof.sessionBinding(heldToken),
        deviceId:lease.deviceId, bindingRevision:lease.bindingRevision, leaseId:lease.id, method:'POST', pathAndQuery:route,
        bodySha256:digest(JSON.stringify(value)), nonce:randomBytes(32).toString('base64url')};
      return post(route, value, {authorization:'Bearer ' + heldToken, origin:'shenyi://app',
        'x-shenyi-device-lease':lease.token, 'x-shenyi-device-nonce':claims.nonce,
        'x-shenyi-device-body-sha256':claims.bodySha256,
        'x-shenyi-device-signature':sign(null, deviceProof.requestProofBytes(claims), pair.privateKey).toString('base64url')});
    }
    return {heldPost, lease,
      revoke() { db.prepare('UPDATE main.team_device_leases SET revoked_at=? WHERE lease_id=?').run(Date.now(), lease.id); },
      expire() { db.prepare('UPDATE main.team_device_leases SET expires_at=? WHERE lease_id=?').run(Date.now() - 1000, lease.id); }};
  }

  function lock(changes = {}) {
    return billing.lockOrder({...quote, requestId:randomUUID(), expiresAt:now + 540_000, ...changes});
  }
  async function issue(session, orderId) {
    const reply = await session.heldPost(issuer(teamId), {orderId});
    assert.equal(reply.status, 201, reply.text);
    assert.deepEqual(Object.keys(reply.data).sort(), ['expiresAt', 'handoff']);
    assert.equal(Buffer.from(reply.data.handoff, 'base64url').toString('base64url'), reply.data.handoff);
    assert.equal(reply.data.handoff.length, 43);
    assert.ok(reply.data.expiresAt > Date.now() && reply.data.expiresAt <= Date.now() + 120_000);
    return reply.data.handoff;
  }
  return {db, send, post, calls, device, lock, issue,
    browser(action, handoff, {body = {}, headers = {}} = {}) {
      return post(checkout + '/' + action, {handoff, ...body}, {origin:apiBase, ...headers});
    }};
}

function count(db, table) {
  return db.prepare('SELECT count(*) AS n FROM main.' + table).get().n;
}

function expectOrder(reply, order, status, qr = false) {
  assert.equal(reply.status, 200, reply.text);
  assert.deepEqual(Object.keys(reply.data).sort(), qr ? ['handoffExpiresInMs', 'order', 'qr'] : ['handoffExpiresInMs', 'order']);
  assert.ok(Number.isSafeInteger(reply.data.handoffExpiresInMs) &&
    reply.data.handoffExpiresInMs > 0 && reply.data.handoffExpiresInMs <= 120_000);
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
  const f = await fixture(t, {provider:() => signedProviderResponse(verifiedTrade(order))});
  order = f.lock({seats:1});
  const handoff = await f.issue(await f.device(), order.id);
  f.db.exec(`
    INSERT INTO main.team_users VALUES ('worker-a','active'),('worker-b','active');
    INSERT INTO main.team_memberships VALUES ('team-a','worker-a','assistant','active'),
      ('team-a','worker-b','assistant','active');
  `);
  expectOrder(await f.browser('check', handoff), order, 'pending_fulfilment');
  expectOrder(await f.browser('order', handoff), order, 'pending_fulfilment');
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
