'use strict';
// Independent WeChat contract acceptance: real SQLite and synthetic server adapters.
// No real WeChat authorization, browser, SMS, AppID credential or external request.
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {createHash, randomBytes} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://auth.synthetic.invalid';
const REDIRECT = ORIGIN + '/api/auth/wechat/callback';
const APP = 'synthetic-wx';
const PASSWORD = 'ShenyiDemo!2026';
const NOW = Date.parse('2026-11-15T05:00:00.000Z');
const sha = value => createHash('sha256').update(value).digest('hex');
const challenge = verifier => createHash('sha256').update(verifier).digest('base64url');
const moduleAt = name => import(pathToFileURL(path.join(ROOT, 'server/team', name)).href);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
let baseline;

async function fixture(t) {
  baseline ||= (async () => {
    const {initializeTeamDatabase, seedDemoTeamData} = await moduleAt('database.mjs');
    const source = new DatabaseSync(':memory:');
    try {
      initializeTeamDatabase(source); await seedDemoTeamData(source);
      return source.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all()
        .map(({name}) => ({name, rows: source.prepare('SELECT * FROM ' + quote(name)).all()}));
    } finally { source.close(); }
  })();
  const rows = await baseline;
  const {initializeTeamDatabase} = await moduleAt('database.mjs');
  const db = new DatabaseSync(':memory:'); initializeTeamDatabase(db);
  db.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');
  try {
    for (const table of rows) for (const row of table.rows) {
      const keys = Object.keys(row);
      db.prepare('INSERT OR REPLACE INTO ' + quote(table.name) + '(' + keys.map(quote).join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')').run(...Object.values(row));
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  t.after(() => db.close());
  const f = {db, now: NOW, exchangeCalls: [], authorizedStates: [], identity: {appId: APP, openId: 'wx-new'}, run: (sql, ...params) => db.prepare(sql).run(...params)};
  f.wechat = {
    appId: APP, redirectUri: REDIRECT,
    createAuthorizationUrl({state, redirectUri}) {
      f.authorizedStates.push(state);
      const query = new URLSearchParams({appid: APP, redirect_uri: redirectUri, response_type: 'code', scope: 'snsapi_login', state});
      return 'https://open.weixin.qq.com/connect/qrconnect?' + query + '#wechat_redirect';
    },
    async exchangeCode(input) { f.exchangeCalls.push(input); return {...f.identity}; },
  };
  f.providers = {wechat: f.wechat};
  return f;
}

function request(route, {method = 'POST', token, body, headers = {}, origin = ORIGIN} = {}) {
  return new Request(origin + route, {method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}), ...headers}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
}
async function call(f, route, options = {}) {
  const {handleTeamApplicationRequest} = await moduleAt('application-api.mjs');
  const response = await handleTeamApplicationRequest(request(route, options), {db: f.db, now: () => f.now, identityProviders: f.providers});
  const raw = await response.text();
  return {response, raw, json: (response.headers.get('content-type') || '').startsWith('application/json') ? JSON.parse(raw) : null};
}
function privacy(result) {
  assert.match(result.response.headers.get('cache-control') || '', /private/i);
  assert.match(result.response.headers.get('cache-control') || '', /no-store/i);
  assert.equal(result.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(result.response.headers.get('access-control-allow-origin'), null);
  for (const forbidden of [PASSWORD, 'password_hash', 'token_hash', 'PROVIDER_SECRET', 'SELECT ']) assert.ok(!result.raw.includes(forbidden), forbidden);
}
function rejected(result, statuses = [400, 401, 403, 404, 409, 410]) {
  assert.ok(statuses.includes(result.response.status), `expected denial, received ${result.response.status}: ${result.raw}`);
  privacy(result);
}
async function login(f, username = 'intern-a') {
  const result = await call(f, '/api/auth/login', {body: {username, password: PASSWORD}});
  assert.equal(result.response.status, 200, result.raw); return result.json.token;
}
async function begin(f, options = {}) {
  const verifier = options.verifier || randomBytes(32).toString('base64url');
  const result = await call(f, '/api/auth/wechat/transactions', {body: {codeChallenge: challenge(verifier)}});
  assert.equal(result.response.status, 201, result.raw); privacy(result);
  assert.deepEqual(Object.keys(result.json).sort(), ['authorizationUrl', 'expiresAt', 'pollToken', 'transactionId'].sort());
  assert.match(result.json.pollToken, /^[A-Za-z0-9_-]{43}$/);
  const url = new URL(result.json.authorizationUrl), state = url.searchParams.get('state');
  assert.equal(url.origin, 'https://open.weixin.qq.com'); assert.equal(url.pathname, '/connect/qrconnect');
  assert.equal(url.searchParams.get('appid'), APP); assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(url.searchParams.get('response_type'), 'code'); assert.equal(url.searchParams.get('scope'), 'snsapi_login');
  assert.ok(state && !result.json.authorizationUrl.includes(result.json.pollToken));
  assert.ok(result.json.expiresAt > f.now && result.json.expiresAt <= f.now + 10 * 60_000);
  return {...result.json, verifier, state};
}
const route = (transaction, action) => '/api/auth/wechat/transactions/' + transaction.transactionId + '/' + action;
const poll = (f, transaction, pollToken = transaction.pollToken) => call(f, route(transaction, 'status'), {body: {pollToken}});
const exchange = (f, transaction, verifier = transaction.verifier) => call(f, route(transaction, 'exchange'), {body: {pollToken: transaction.pollToken, codeVerifier: verifier}});
const callback = (f, transaction, code = randomBytes(20).toString('hex'), options = {}) => call(f, '/api/auth/wechat/callback?' + new URLSearchParams({state: transaction.state, code}), {method: 'GET', ...options});
const sessionCount = f => f.db.prepare('SELECT COUNT(*) AS n FROM team_sessions').get().n;
function linked(f, user = 'intern-a', openId = 'wx-known', appId = APP) {
  f.run('INSERT INTO team_wechat_identities(app_id,open_id,user_id,created_at) VALUES (?,?,?,?)', appId, openId, user, f.now);
  f.identity = {appId: APP, openId};
}
function verifiedPhone(f, user = 'intern-a', phone = '+8613800000001') {
  f.run('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)', user, phone, f.now);
}

test('unconfigured WeChat is unavailable and never fabricates an authorization URL or transaction', async t => {
  const f = await fixture(t); f.providers = {};
  const result = await call(f, '/api/auth/wechat/transactions', {body: {codeChallenge: challenge('v'.repeat(43))}});
  assert.equal(result.response.status, 503); assert.equal(result.json.error.code, 'WECHAT_UNAVAILABLE'); privacy(result);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_wechat_transactions').get().n, 0);
  assert.equal(f.exchangeCalls.length, 0); assert.equal(sessionCount(f), 0);
});

test('transaction creation validates S256 challenge and persists only state/poll digests', async t => {
  const f = await fixture(t);
  for (const body of [{}, {codeChallenge: 'short'}, {codeChallenge: challenge('v'.repeat(43)), role: 'partner'}, {codeChallenge: ' '.repeat(43)}]) {
    rejected(await call(f, '/api/auth/wechat/transactions', {body}));
  }
  const transaction = await begin(f);
  const row = f.db.prepare('SELECT * FROM team_wechat_transactions WHERE transaction_id=?').get(transaction.transactionId);
  assert.equal(row.state_hash, sha(transaction.state)); assert.equal(row.poll_hash, sha(transaction.pollToken));
  assert.equal(row.code_challenge, challenge(transaction.verifier)); assert.equal(row.status, 'pending');
  assert.ok(!JSON.stringify(row).includes(transaction.pollToken)); assert.ok(!JSON.stringify(row).includes(transaction.verifier));
  const status = await poll(f, transaction); assert.equal(status.response.status, 200); assert.equal(status.json.status, 'pending'); privacy(status);
});

test('invalid WeChat transaction requests do not consume the address budget', async t => {
  const f = await fixture(t), headers = {'X-Shenyi-Client-IP': '203.0.113.10'};
  const body = {codeChallenge: challenge('v'.repeat(43))};
  const invalidBodies = [{}, {codeChallenge: 'short'}, {...body, role: 'partner'}, {codeChallenge: ' '.repeat(43)}];
  for (let n = 0; n < 61; n++) {
    const result = await call(f, '/api/auth/wechat/transactions', {headers, body: invalidBodies[n % invalidBodies.length]});
    assert.equal(result.response.status, 400, result.raw); privacy(result);
  }
  assert.equal(f.authorizedStates.length, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_wechat_transactions').get().n, 0);
  for (let n = 0; n < 60; n++) {
    const result = await call(f, '/api/auth/wechat/transactions', {headers, body});
    assert.equal(result.response.status, 201, result.raw);
  }
  const limited = await call(f, '/api/auth/wechat/transactions', {headers, body});
  assert.equal(limited.response.status, 429, limited.raw); privacy(limited);
  assert.equal(f.authorizedStates.length, 60);
});

test('WeChat transaction limits isolate edge addresses and reset after their server window', async t => {
  const f = await fixture(t), body = {codeChallenge: challenge('v'.repeat(43))};
  const create = address => call(f, '/api/auth/wechat/transactions', {body, headers: {'X-Shenyi-Client-IP': address}});
  for (let n = 0; n < 60; n++) {
    const result = await create(n % 2 ? '2001:DB8::A' : '2001:db8::a');
    assert.equal(result.response.status, 201, result.raw);
  }
  const limited = await create('2001:db8::a');
  assert.equal(limited.response.status, 429, limited.raw);
  assert.equal(limited.json.error.code, 'TOO_MANY_ATTEMPTS'); privacy(limited);
  assert.equal(f.authorizedStates.length, 60);
  const independent = await create('198.51.100.21');
  assert.equal(independent.response.status, 201, independent.raw);
  f.now += 59_999;
  assert.equal((await create('2001:DB8::A')).response.status, 429);
  f.now++;
  const renewed = await create('2001:db8::a');
  assert.equal(renewed.response.status, 201, renewed.raw);
  assert.equal(f.authorizedStates.length, 62);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_wechat_transactions').get().n, 62);
});

test('untrusted WeChat source headers share the local fallback and cannot evade its limit', async t => {
  const f = await fixture(t), body = {codeChallenge: challenge('v'.repeat(43))};
  const create = headers => call(f, '/api/auth/wechat/transactions', {body, headers});
  const invalidAddresses = [undefined, 'not-an-ip', '203.0.113.1, 198.51.100.1', '203.0.113.1:1234'];
  for (let n = 0; n < 60; n++) {
    const address = invalidAddresses[n % invalidAddresses.length];
    const headers = {'X-Forwarded-For': '198.51.100.' + (n + 1), Forwarded: 'for=198.51.100.' + (n + 1)};
    if (address !== undefined) headers['X-Shenyi-Client-IP'] = address;
    const result = await create(headers);
    assert.equal(result.response.status, 201, result.raw);
  }
  for (const headers of [{}, {'X-Shenyi-Client-IP': 'another-invalid-ip'}, {'X-Forwarded-For': '203.0.113.99'}]) {
    const limited = await create(headers);
    assert.equal(limited.response.status, 429, limited.raw); privacy(limited);
  }
  assert.equal(f.authorizedStates.length, 60);
  const independent = await create({'X-Shenyi-Client-IP': '203.0.113.20'});
  assert.equal(independent.response.status, 201, independent.raw);
});

test('wrong poll token and unknown transaction use private 404 without disclosing identity', async t => {
  const f = await fixture(t), transaction = await begin(f);
  const wrong = await poll(f, transaction, randomBytes(32).toString('base64url'));
  const missing = await poll(f, {...transaction, transactionId: 'missing-transaction'});
  assert.equal(wrong.response.status, 404); assert.equal(missing.response.status, 404); privacy(wrong); privacy(missing);
  assert.equal(wrong.raw, missing.raw); assert.ok(!wrong.raw.includes('wx-new'));
});

test('authorization URL is restricted to exact trusted WeChat origin, path and configured parameters', async t => {
  const f = await fixture(t);
  const valid = f.wechat.createAuthorizationUrl;
  for (const rewrite of [url => url.replace('open.weixin.qq.com', 'attacker.invalid'), url => url.replace('/connect/qrconnect', '/evil'), url => url.replace('https:', 'http:'), url => url.replace('synthetic-wx', 'other-app'), url => url.replace('snsapi_login', 'snsapi_userinfo'), url => url.replace('#wechat_redirect', '&pollToken=LEAK#wechat_redirect')]) {
    f.wechat.createAuthorizationUrl = data => rewrite(valid(data));
    const result = await call(f, '/api/auth/wechat/transactions', {body: {codeChallenge: challenge(randomBytes(32).toString('base64url'))}});
    assert.ok(result.response.status >= 400, result.raw); privacy(result);
  }
  assert.equal(sessionCount(f), 0);
});

test('existing identity callback permits cross-site navigation but exchange is PKCE bound and single use', async t => {
  const f = await fixture(t); linked(f); const transaction = await begin(f);
  const returned = await callback(f, transaction, 'single-use-code', {headers: {'Sec-Fetch-Site': 'cross-site', Origin: 'https://open.weixin.qq.com'}});
  assert.equal(returned.response.status, 200, returned.raw); privacy(returned);
  assert.ok(!returned.raw.includes('wx-known')); assert.ok(!returned.raw.includes('intern-a')); assert.ok(!returned.raw.includes('token'));
  assert.equal(f.exchangeCalls.length, 1); assert.deepEqual(f.exchangeCalls[0], {code: 'single-use-code', redirectUri: REDIRECT});
  const ready = await poll(f, transaction); assert.equal(ready.json.status, 'ready');
  rejected(await exchange(f, transaction, randomBytes(32).toString('base64url')));
  assert.equal(sessionCount(f), 0);
  const result = await exchange(f, transaction); assert.equal(result.response.status, 200, result.raw); privacy(result);
  assert.equal(result.json.account.id, 'intern-a'); assert.deepEqual(result.json.memberships, [{teamId: 'team-a', role: 'intern'}]);
  assert.match(result.json.token, /^[A-Za-z0-9_-]{43}$/); assert.equal(sessionCount(f), 1);
  assert.equal((await poll(f, transaction)).json.status, 'consumed');
  rejected(await exchange(f, transaction)); assert.equal(sessionCount(f), 1);
});

test('wrong state, callback origin/path, duplicate parameters and client identity injection do not reach provider', async t => {
  const f = await fixture(t); linked(f); const transaction = await begin(f);
  const routes = [
    '/api/auth/wechat/callback?state=wrong&code=code',
    '/api/auth/wechat/callback?state=' + transaction.state + '&state=' + transaction.state + '&code=code',
    '/api/auth/wechat/callback?state=' + transaction.state + '&code=code&openid=wx-known&userId=partner-a&role=partner',
  ];
  for (const path of routes) rejected(await call(f, path, {method: 'GET'}));
  rejected(await callback(f, transaction, 'code', {origin: 'https://attacker.invalid'}));
  assert.equal(f.exchangeCalls.length, 0); assert.equal(sessionCount(f), 0);
  assert.equal((await poll(f, transaction)).json.status, 'pending');
});

test('a callback state and an authorization code cannot be reused across transactions', async t => {
  const f = await fixture(t); linked(f);
  const first = await begin(f); assert.equal((await callback(f, first, 'replayed-provider-code')).response.status, 200);
  rejected(await callback(f, first, 'another-code'));
  const second = await begin(f); rejected(await callback(f, second, 'replayed-provider-code'));
  assert.equal(f.exchangeCalls.length, 1); assert.equal(sessionCount(f), 0);
  const used = f.db.prepare('SELECT code_hash FROM team_wechat_codes').all();
  assert.deepEqual(used.map(row => row.code_hash), [sha('replayed-provider-code')]);
});

test('new WeChat identity requires current password and existing verified phone before explicit linking', async t => {
  const f = await fixture(t), transaction = await begin(f), token = await login(f);
  const usersBefore = f.db.prepare('SELECT COUNT(*) AS n FROM team_users').get().n;
  const membershipsBefore = f.db.prepare('SELECT COUNT(*) AS n FROM team_memberships').get().n;
  assert.equal((await callback(f, transaction)).response.status, 200);
  assert.equal((await poll(f, transaction)).json.status, 'binding_required');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_wechat_identities').get().n, 0);
  rejected(await call(f, route(transaction, 'link'), {body: {pollToken: transaction.pollToken, codeVerifier: transaction.verifier, currentPassword: PASSWORD}}));
  rejected(await call(f, route(transaction, 'link'), {token, body: {pollToken: transaction.pollToken, codeVerifier: transaction.verifier, currentPassword: PASSWORD}}));
  verifiedPhone(f);
  rejected(await call(f, route(transaction, 'link'), {token, body: {pollToken: transaction.pollToken, codeVerifier: transaction.verifier, currentPassword: 'wrong-password'}}));
  rejected(await call(f, route(transaction, 'link'), {token, body: {pollToken: transaction.pollToken, codeVerifier: 'z'.repeat(43), currentPassword: PASSWORD}}));
  const result = await call(f, route(transaction, 'link'), {token, body: {pollToken: transaction.pollToken, codeVerifier: transaction.verifier, currentPassword: PASSWORD}});
  assert.equal(result.response.status, 200, result.raw); assert.deepEqual(result.json, {linked: true}); privacy(result);
  assert.equal((await poll(f, transaction)).json.status, 'ready');
  assert.equal(f.db.prepare('SELECT user_id FROM team_wechat_identities WHERE app_id=? AND open_id=?').get(APP, 'wx-new').user_id, 'intern-a');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_users').get().n, usersBefore);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_memberships').get().n, membershipsBefore);
  const resultLogin = await exchange(f, transaction); assert.equal(resultLogin.response.status, 200);
  assert.equal(resultLogin.json.account.id, 'intern-a'); assert.deepEqual(resultLogin.json.memberships, [{teamId: 'team-a', role: 'intern'}]);
});

test('linking cannot replace another account mapping or silently overwrite current account WeChat identity', async t => {
  const f = await fixture(t), token = await login(f); verifiedPhone(f);
  f.run('INSERT INTO team_wechat_identities VALUES (?,?,?,?)', APP, 'wx-existing-for-intern', 'intern-a', f.now);
  const transaction = await begin(f); assert.equal((await callback(f, transaction)).response.status, 200);
  const r = await call(f, route(transaction, 'link'), {token, body: {pollToken: transaction.pollToken, codeVerifier: transaction.verifier, currentPassword: PASSWORD}});
  assert.equal(r.response.status, 409, r.raw);
  assert.deepEqual(f.db.prepare('SELECT open_id,user_id FROM team_wechat_identities').all().map(row => ({...row})), [{open_id: 'wx-existing-for-intern', user_id: 'intern-a'}]);
  const another = await begin(f); f.run('INSERT INTO team_wechat_identities VALUES (?,?,?,?)', APP, 'wx-new', 'partner-a', f.now);
  assert.equal((await callback(f, another)).response.status, 200);
  rejected(await call(f, route(another, 'link'), {token, body: {pollToken: another.pollToken, codeVerifier: another.verifier, currentPassword: PASSWORD}}));
  assert.equal(f.db.prepare('SELECT user_id FROM team_wechat_identities WHERE app_id=? AND open_id=?').get(APP, 'wx-new').user_id, 'partner-a');
});

test('openid is app scoped, unionid does not silently merge accounts, and mismatched provider app is rejected', async t => {
  const f = await fixture(t);
  linked(f, 'partner-a', 'wx-new', 'other-app'); f.identity = {appId: APP, openId: 'wx-new', unionId: 'UNTRUSTED_UNION_HINT'};
  const transaction = await begin(f); assert.equal((await callback(f, transaction)).response.status, 200);
  assert.equal((await poll(f, transaction)).json.status, 'binding_required'); assert.equal(sessionCount(f), 0);
  const other = await begin(f); f.identity = {appId: 'wrong-app', openId: 'wx-new'};
  const result = await callback(f, other); privacy(result);
  assert.equal((await poll(f, other)).json.status, 'failed'); assert.equal(sessionCount(f), 0);
});

test('provider errors remain private, fail the transaction and do not fabricate identities', async t => {
  const f = await fixture(t), transaction = await begin(f);
  f.wechat.exchangeCode = async () => { throw new Error('PROVIDER_SECRET access_token=private provider details'); };
  const result = await callback(f, transaction); privacy(result);
  assert.equal((await poll(f, transaction)).json.status, 'failed');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_wechat_identities').get().n, 0); assert.equal(sessionCount(f), 0);
});

test('provider token-shaped fields never enter callback, status, or persisted identity projection', async t => {
  const f = await fixture(t); linked(f); f.identity.access_token = 'PROVIDER_SECRET'; f.identity.refresh_token = 'PROVIDER_SECRET';
  const transaction = await begin(f); privacy(await callback(f, transaction)); privacy(await poll(f, transaction));
  const row = f.db.prepare('SELECT * FROM team_wechat_transactions WHERE transaction_id=?').get(transaction.transactionId);
  assert.ok(!JSON.stringify(row).includes('PROVIDER_SECRET'));
  const result = await exchange(f, transaction); assert.equal(result.response.status, 200); privacy(result);
});

test('expired flow cannot complete callback, link or exchange and remains visibly expired to its owner', async t => {
  const f = await fixture(t); linked(f); const pending = await begin(f); f.now = pending.expiresAt;
  rejected(await callback(f, pending)); assert.equal((await poll(f, pending)).json.status, 'expired');
  const ready = await begin(f); assert.equal((await callback(f, ready)).response.status, 200); f.now = ready.expiresAt;
  rejected(await exchange(f, ready)); assert.equal(sessionCount(f), 0);
});

test('disabled account, changed credential revision and revoked identity prevent exchange', async t => {
  for (const mutation of [
    f => f.run("UPDATE team_users SET status='disabled' WHERE user_id='intern-a'"),
    f => f.run("UPDATE team_credentials SET revision=revision+1 WHERE user_id='intern-a'"),
    f => f.run('DELETE FROM team_wechat_identities WHERE app_id=? AND open_id=?', APP, 'wx-known'),
  ]) {
    const f = await fixture(t); linked(f); const transaction = await begin(f); assert.equal((await callback(f, transaction)).response.status, 200);
    mutation(f); rejected(await exchange(f, transaction)); assert.equal(sessionCount(f), 0);
  }
});

test('only one parallel exchange can consume a ready transaction', async t => {
  const f = await fixture(t); linked(f); const transaction = await begin(f); assert.equal((await callback(f, transaction)).response.status, 200);
  const results = await Promise.all([exchange(f, transaction), exchange(f, transaction)]);
  assert.equal(results.filter(r => r.response.status === 200).length, 1);
  assert.equal(sessionCount(f), 1); rejected(results.find(r => r.response.status !== 200));
});

test('cancel during asynchronous provider exchange cannot be revived by its late result', async t => {
  const f = await fixture(t); linked(f); const transaction = await begin(f);
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  f.wechat.exchangeCode = async () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const pending = callback(f, transaction);
  assert.equal(await Promise.race([waiting.then(() => true), pending.then(() => false)]), true, 'callback must reach the trusted provider before race mutation');
  const canceled = await call(f, route(transaction, 'cancel'), {body: {pollToken: transaction.pollToken}});
  assert.equal(canceled.response.status, 200); assert.deepEqual(canceled.json, {canceled: true});
  release({appId: APP, openId: 'wx-known'}); privacy(await pending);
  assert.equal((await poll(f, transaction)).json.status, 'canceled'); rejected(await exchange(f, transaction)); assert.equal(sessionCount(f), 0);
});

test('disable while asynchronous provider exchange is pending prevents a usable ready identity', async t => {
  const f = await fixture(t); linked(f); const transaction = await begin(f);
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  f.wechat.exchangeCode = async () => { entered(); return new Promise(resolve => { release = resolve; }); };
  const pending = callback(f, transaction);
  assert.equal(await Promise.race([waiting.then(() => true), pending.then(() => false)]), true, 'callback must reach the trusted provider before race mutation');
  f.run("UPDATE team_users SET status='disabled' WHERE user_id='intern-a'"); release({appId: APP, openId: 'wx-known'});
  privacy(await pending); rejected(await exchange(f, transaction)); assert.equal(sessionCount(f), 0);
});

test('cross-site POST APIs remain blocked even though callback navigation is allowed', async t => {
  const f = await fixture(t), transaction = await begin(f);
  for (const action of ['status', 'cancel', 'exchange']) {
    const body = {pollToken: transaction.pollToken, ...(action === 'exchange' ? {codeVerifier: transaction.verifier} : {})};
    const result = await call(f, route(transaction, action), {body, headers: {Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'cross-site'}});
    assert.equal(result.response.status, 403); privacy(result);
  }
  assert.equal((await poll(f, transaction)).json.status, 'pending');
});

test('user-declined authorization cancels its transaction without calling provider', async t => {
  const f = await fixture(t);
  for(const decline of [{error:'access_denied'},{}]){
    const transaction = await begin(f);
    const result = await call(f, '/api/auth/wechat/callback?' + new URLSearchParams({state: transaction.state, ...decline}), {method: 'GET', headers: {'Sec-Fetch-Site': 'cross-site'}});
    assert.equal(result.response.status, 200, result.raw); privacy(result);
    assert.equal((await poll(f, transaction)).json.status, 'canceled');
  }
  assert.equal(f.exchangeCalls.length, 0); assert.equal(sessionCount(f), 0);
});
