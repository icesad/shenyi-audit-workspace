'use strict';

// The client and server handler are real. Fetch, the WeChat provider and the
// external browser openers remain in-process fixtures with no external traffic.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, sign, verify } = require('node:crypto');
const { createTeamClient } = require('../desktop/team-client.cjs');
const { createTrustedTeamServiceTransport } = require('../desktop/trusted-team-service-client.cjs');
const proof = require('../shared/device-proof.cjs');
const { createBusinessRoleFixture, keyPair, PASSWORD, source } = require('./helpers/business-role-fixture.cjs');

const apiBase = 'https://team.shenyi.test';
const checkoutOrigin = 'https://checkout.shenyi.test';
const callbackPath = '/api/auth/wechat/callback';
const callback = apiBase + callbackPath;
const appId = 'wx0123456789abcdef';
const legacyAppId = 'wxfedcba9876543210';
const teamId = 'team-a';
const billing = `/api/teams/${teamId}/billing`;
const transactions = '/api/auth/wechat/transactions';
const annualOffer = { id: 'synthetic-combined-annual', revision: 1, product: 'team-annual-renewal', amountMinor: 12000, currency: 'CNY' };
const seatOffer = { id: 'synthetic-combined-seat', revision: 1, annualUnitAmountMinor: 10000, currency: 'CNY' };

async function fixture(t, { wechat = true, checkout = true, providerAppId = appId, providerCallback = callback } = {}) {
  const { db, clock } = await createBusinessRoleFixture(t);
  const [{ handleTeamApplicationRequest }, { createWebsiteCheckoutCandidate, initializeWebsiteCheckoutStore }, subscription, capacity] = await Promise.all([
    source('application-api.mjs'), source('website-checkout.mjs'), source('subscription-store.mjs'), source('seat-capacity-store.mjs'),
  ]);
  const startsAt = clock.value - 1000;
  const endsAt = clock.value + 360 * 86400000;
  const now = () => clock.value;
  const sourceRef = 'synthetic-combined-profile';
  subscription.recordSubscriptionTerm(db, {
    teamId, operationId: randomUUID(), expectedRevision: 0, startsAt, endsAt, sourceRef,
  }, { now });
  capacity.recordSeatCapacityGrant(db, { teamId, grantId: randomUUID(), seats: 8, startsAt, endsAt, sourceRef }, { now });
  db.prepare("INSERT INTO team_database_metadata(name,value) VALUES ('website-checkout-demo','true')").run();
  if (checkout) initializeWebsiteCheckoutStore(db);

  const provider = {
    appId: providerAppId,
    redirectUri: providerCallback,
    createAuthorizationUrl({ state }) {
      const query = new URLSearchParams({ appid: providerAppId, redirect_uri: providerCallback, response_type: 'code', scope: 'snsapi_login', state });
      return `https://open.weixin.qq.com/connect/qrconnect?${query}#wechat_redirect`;
    },
    async exchangeCode() { throw new Error('No provider exchange is part of this fixture'); },
  };
  const options = {
    db, now, serviceMode: 'local-preview', identityProviders: { deviceProofRequired: true, ...(wechat && { wechat: provider }) },
    subscriptionEnforcement: 'team-management-v1', seatCapacityEnforcement: 'invitation-reservations-v1',
    billingSimulation: { mode: 'simulation-v1', merchantId: 'synthetic-combined-profile', signingKey: randomBytes(32),
      offers: [annualOffer], annualSeatUnitAmountMinor: 2000, seatOffer },
    // The existing synthetic issuer deliberately retains its loopback-only
    // browser policy. Only the client-selected URL is asserted on the DNS host.
    websiteCheckout: checkout ? createWebsiteCheckoutCandidate({ origin: 'https://127.0.0.1:14443' }) : undefined,
  };
  const profile = {
    schemaVersion: 4, apiBase, serverId: db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value,
    wechatAppId: appId, checkoutOrigin,
  };
  const pair = keyPair();
  const fingerprint = proof.parsePublicKey(pair.encoded).fingerprint;
  const calls = [], opened = [], signatures = [];
  let alterHandoff;
  const vault = {
    getPublicIdentity: async () => ({ publicKey: pair.encoded, fingerprint }),
    signChallenge: async fields => sign(null, proof.challengeBytes(fields), pair.privateKey).toString('base64url'),
    async signRequest(fields) {
      signatures.push(fields);
      return sign(null, proof.requestProofBytes(fields), pair.privateKey).toString('base64url');
    },
  };
  const client = createTeamClient({
    now, trustedService: profile, wechatPolicy: { appId: legacyAppId, redirectUri: callback },
    deviceIdentity: { vault, platform: 'win32', displayName: 'Synthetic combined-profile device' },
    openAuthorization: async url => { opened.push({ kind: 'wechat', url }); },
    openCheckoutExternal: async url => { opened.push({ kind: 'checkout', url }); },
    async fetchImpl(url, settings) {
      const target = new URL(url);
      assert.equal(target.origin, apiBase);
      assert.equal(settings.redirect, 'error');
      const headers = new Headers(settings.headers);
      const call = { route: target.pathname, method: settings.method, body: settings.body, headers };
      calls.push(call);
      let response = await handleTeamApplicationRequest(new Request(url, settings), options);
      call.status = response.status;
      if (response.ok && /\/website(?:-seat)?-handoff$/.test(call.route)) {
        call.ticket = await response.clone().json();
        if (alterHandoff) response = alterHandoff(response, call.ticket);
      }
      Object.defineProperty(response, 'url', { value: url });
      return response;
    },
  });
  t.after(() => client.clearSession());
  return {
    client, db, profile, calls, opened, signatures, pair, now,
    setHandoffOverride(fn) { alterHandoff = fn; },
    async loginAndBind() {
      await client.login({ username: 'administrator-demo', password: PASSWORD });
      await client.enrollDevice({ displayName: 'Synthetic combined-profile device', currentPassword: PASSWORD, confirmed: true });
    },
  };
}

test('one v4 client pins WeChat and signed annual/seat handoffs to their distinct destinations', async t => {
  const f = await fixture(t);
  Object.assign(f.profile, { apiBase: 'https://changed.shenyi.test', wechatAppId: legacyAppId, checkoutOrigin: apiBase });

  const methods = await f.client.getAuthMethods();
  assert.equal(methods.methods.wechat, true);
  assert.equal(methods.desktopWechatReady, true);
  assert.deepEqual(await f.client.startWechatLogin(), { status: 'pending', expiresAt: f.now() + 5 * 60000 });
  assert.equal(f.opened.length, 1);
  assert.equal(f.opened[0].kind, 'wechat');
  const authorization = new URL(f.opened[0].url);
  assert.equal(authorization.origin, 'https://open.weixin.qq.com');
  assert.equal(authorization.pathname, '/connect/qrconnect');
  assert.deepEqual(authorization.searchParams.getAll('appid'), [appId]);
  assert.deepEqual(authorization.searchParams.getAll('redirect_uri'), [callback]);
  assert.equal(f.calls.find(call => call.route === transactions).headers.get('Authorization'), null);
  assert.deepEqual(await f.client.cancelWechatLogin(), { canceled: true });

  await f.loginAndBind();
  const overview = await f.client.getBillingOverview({ teamId });
  assert.equal(overview.websiteCheckout, true);
  assert.equal(overview.websiteCheckoutReady, true);
  assert.equal(JSON.stringify(overview).includes(checkoutOrigin), false);
  const handoffs = [
    { kind: 'annual', route: `${billing}/website-handoff`, page: '/checkout/' },
    { kind: 'seat', route: `${billing}/website-seat-handoff`, page: '/checkout/seats/' },
  ];
  const tickets = [];
  for (const { kind, route, page } of handoffs) {
    assert.deepEqual(await f.client.openWebsiteCheckout({ teamId, kind }), { opened: true });
    const [call, ...duplicate] = f.calls.filter(item => item.route === route);
    assert.deepEqual(duplicate, []);
    assert.equal(call.method, 'POST');
    assert.equal(call.body, '{}');
    assert.equal(call.status, 201);
    assert.ok(call.headers.get('Authorization'));
    assert.ok(call.headers.get('X-Shenyi-Device-Lease'));
    const fields = f.signatures.find(item => item.pathAndQuery === route);
    const signed = Buffer.from(call.headers.get('X-Shenyi-Device-Signature'), 'base64url');
    assert.equal(verify(null, proof.requestProofBytes(fields), f.pair.publicKey, signed), true);
    assert.deepEqual(f.opened.at(-1), { kind: 'checkout', url: checkoutOrigin + page + '#handoff=' + call.ticket.handoff });
    tickets.push(call.ticket.handoff);
  }
  assert.notEqual(tickets[0], tickets[1]);
  assert.equal(f.opened.length, 3);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM team_annual_orders').get().count, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM team_seat_orders').get().count, 0);
});

test('v4 does not supply a capability absent from the corresponding server service', async t => {
  await t.test('WeChat off leaves checkout available', async t => {
    const f = await fixture(t, { wechat: false });
    const methods = await f.client.getAuthMethods();
    assert.equal(methods.desktopWechatReady, true);
    assert.equal(methods.methods.wechat, false);
    await assert.rejects(f.client.startWechatLogin(), { code: 'HTTP_503' });
    assert.equal(f.calls.find(call => call.route === transactions).status, 503);
    assert.deepEqual(f.opened, []);
    await f.loginAndBind();
    assert.equal((await f.client.getBillingOverview({ teamId })).websiteCheckoutReady, true);
  });
  await t.test('checkout off leaves WeChat available', async t => {
    const f = await fixture(t, { checkout: false });
    assert.equal((await f.client.startWechatLogin()).status, 'pending');
    await f.client.cancelWechatLogin();
    await f.loginAndBind();
    const overview = await f.client.getBillingOverview({ teamId });
    assert.equal(Object.hasOwn(overview, 'websiteCheckoutReady'), false);
    await assert.rejects(f.client.openWebsiteCheckout({ teamId }), { code: 'HTTP_503' });
    assert.equal(f.calls.find(call => call.route === `${billing}/website-handoff`).status, 503);
    assert.deepEqual(f.opened.map(item => item.kind), ['wechat']);
  });
});

test('another provider AppID or a checkout-host WeChat callback cannot open an authorization URL', async t => {
  for (const settings of [{ providerAppId: legacyAppId }, { providerCallback: checkoutOrigin + callbackPath }]) {
    const f = await fixture(t, settings);
    await assert.rejects(f.client.startWechatLogin(), { code: 'INVALID_RESPONSE' });
    assert.deepEqual(f.opened, []);
    assert.equal(f.calls.find(call => call.route === transactions).status, 201);
    assert.deepEqual(await f.client.pollWechatLogin(), { status: 'idle' });
  }
});

test('checkout rejects an extra redirect DTO field and a valid DTO with the wrong server identity', async t => {
  const f = await fixture(t);
  await f.loginAndBind();
  f.setHandoffOverride((response, ticket) => Response.json({ ...ticket, url: apiBase + '/checkout/' }, {
    status: response.status, headers: response.headers,
  }));
  await assert.rejects(f.client.openWebsiteCheckout({ teamId, kind: 'annual' }), { code: 'INVALID_RESPONSE' });
  f.setHandoffOverride(response => {
    response.headers.set('X-Shenyi-Server-Id', '55555555-5555-4555-8555-555555555555');
    return response;
  });
  await assert.rejects(f.client.openWebsiteCheckout({ teamId, kind: 'seat' }), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(await f.client.getSession(), null);
  assert.deepEqual(f.opened, []);
});

test('only validated own WeChat AppID fields enable the transport policy', () => {
  const base = { apiBase, serverId: '11111111-1111-4111-8111-111111111111' };
  const transport = profile => createTrustedTeamServiceTransport({ profile, error: (_code, message) => new Error(message) });
  assert.equal(Object.hasOwn(Object.prototype, 'wechatAppId'), false);
  Object.defineProperty(Object.prototype, 'wechatAppId', { value: legacyAppId, writable: true, configurable: true });
  try {
    assert.equal(transport({ ...base, schemaVersion: 1 }).wechatPolicy, undefined);
    assert.equal(transport({ ...base, schemaVersion: 3, checkoutOrigin }).wechatPolicy, undefined);
    assert.deepEqual(transport({ ...base, schemaVersion: 2, wechatAppId: appId }).wechatPolicy, { appId, redirectUri: callback });
    assert.deepEqual(transport({ ...base, schemaVersion: 4, wechatAppId: appId, checkoutOrigin }).wechatPolicy, { appId, redirectUri: callback });
  } finally {
    delete Object.prototype.wechatAppId;
  }
});

test('only validated own checkout origin fields enable desktop checkout', async () => {
  const base = { apiBase, serverId: '11111111-1111-4111-8111-111111111111' };
  const fail = () => assert.fail('An unsigned-in client must not fetch or open a checkout page');
  const makeClient = profile => createTeamClient({
    trustedService: profile, fetchImpl: fail, openCheckoutExternal: fail,
    deviceIdentity: { platform: 'win32', vault: { getPublicIdentity: fail, signChallenge: fail, signRequest: fail } },
  });
  let clients;
  assert.equal(Object.hasOwn(Object.prototype, 'checkoutOrigin'), false);
  Object.defineProperty(Object.prototype, 'checkoutOrigin', { value: checkoutOrigin, writable: true, configurable: true });
  try {
    clients = [
      makeClient({ ...base, schemaVersion: 1 }),
      makeClient({ ...base, schemaVersion: 2, wechatAppId: appId }),
      makeClient({ ...base, schemaVersion: 3, checkoutOrigin }),
      makeClient({ ...base, schemaVersion: 4, wechatAppId: appId, checkoutOrigin }),
    ];
  } finally {
    delete Object.prototype.checkoutOrigin;
  }
  for (const [index, client] of clients.entries()) {
    await assert.rejects(client.openWebsiteCheckout({ teamId }), {
      code: index < 2 ? 'WEBSITE_CHECKOUT_UNAVAILABLE' : 'SIGN_IN_REQUIRED',
    });
  }
});
