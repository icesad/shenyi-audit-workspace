'use strict';
// Independent race acceptance: in-memory SQLite and synthetic identities only.
// A real statement read signals when the pre-KDF snapshot has been captured.
// No timer decides when to mutate; no SMS, WeChat or shared demo service is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {createHash, randomBytes} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const moduleAt = name => import(pathToFileURL(path.resolve(__dirname, '../server/team', name)).href);
const ORIGIN = 'https://review.synthetic.invalid';
const NOW = Date.parse('2026-11-15T05:00:00.000Z');
const PASSWORD = 'ShenyiDemo!2026';
const PHONE = '+8613800138000';

async function fixture(t) {
  const {initializeTeamDatabase, seedDemoTeamData} = await moduleAt('database.mjs');
  const db = new DatabaseSync(':memory:');
  initializeTeamDatabase(db);
  await seedDemoTeamData(db);
  t.after(() => db.close());
  return {db, providers: {}};
}

async function call(f, route, {body, token, method = 'POST'} = {}) {
  const {handleTeamApplicationRequest} = await moduleAt('application-api.mjs');
  const request = new Request(ORIGIN + route, {
    method,
    headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const response = await handleTeamApplicationRequest(request, {db: f.db, now: () => NOW, identityProviders: f.providers});
  const raw = await response.text();
  return {status: response.status, raw, data: (response.headers.get('content-type') || '').startsWith('application/json') ? JSON.parse(raw) : null};
}

function verifiedPhone(db) {
  db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('intern-a', PHONE, NOW);
}

function signalAfterRead(t, db, matches) {
  const prepare = db.prepare;
  let resolve, active = true;
  const entered = new Promise(done => { resolve = done; });
  const restore = () => { if (active) { active = false; db.prepare = prepare; } };
  db.prepare = function(sql) {
    const statement = prepare.call(this, sql);
    if (active && matches(sql)) {
      const get = statement.get;
      statement.get = function(...parameters) {
        const value = get.apply(this, parameters);
        restore();
        // The caller finishes its current JS stack and starts scrypt before the
        // test's awaiting microtask resumes, so the mutation is during real KDF.
        resolve(value);
        return value;
      };
    }
    return statement;
  };
  t.after(restore);
  return entered;
}

const phoneMutations = [
  ['phone mapping revision changes', db => db.prepare("UPDATE team_phone_credentials SET revision=revision+1 WHERE user_id='intern-a'").run()],
  ['password credential revision changes', db => db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='intern-a'").run()],
  ['employee is disabled', db => db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='intern-a'").run()],
];

for (const [name, mutate] of phoneMutations) {
  test('phone login cannot issue a session when ' + name + ' during KDF', {timeout: 15000}, async t => {
    const f = await fixture(t);
    verifiedPhone(f.db);
    const entered = signalAfterRead(t, f.db, sql => sql.includes('FROM team_users AS account JOIN team_credentials AS credential'));
    const pending = call(f, '/api/auth/phone/login', {body: {phone: PHONE, password: PASSWORD}});
    const snapshot = await entered;
    assert.equal(snapshot.status, 'active');
    assert.equal(snapshot.revision, 1);
    mutate(f.db);
    const result = await pending;
    assert.equal(result.status, 401, result.raw);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_sessions').get().n, 0);
  });
}

async function pendingWechatLink(t, f) {
  const login = await call(f, '/api/auth/login', {body: {username: 'intern-a', password: PASSWORD}});
  assert.equal(login.status, 200, login.raw);
  verifiedPhone(f.db);
  const appId = 'synthetic-review', redirectUri = ORIGIN + '/api/auth/wechat/callback';
  f.providers.wechat = {
    appId, redirectUri,
    createAuthorizationUrl: ({state}) => 'https://open.weixin.qq.com/connect/qrconnect?' + new URLSearchParams({appid: appId, redirect_uri: redirectUri, response_type: 'code', scope: 'snsapi_login', state}),
    exchangeCode: async () => ({appId, openId: 'synthetic-review-new'}),
  };
  const verifier = randomBytes(32).toString('base64url');
  const start = await call(f, '/api/auth/wechat/transactions', {body: {codeChallenge: createHash('sha256').update(verifier).digest('base64url')}});
  assert.equal(start.status, 201, start.raw);
  const state = new URL(start.data.authorizationUrl).searchParams.get('state');
  const callback = await call(f, '/api/auth/wechat/callback?' + new URLSearchParams({state, code: 'synthetic-review-code'}), {method: 'GET'});
  assert.equal(callback.status, 200, callback.raw);
  const route = '/api/auth/wechat/transactions/' + start.data.transactionId;
  const entered = signalAfterRead(t, f.db, sql => sql === 'SELECT phone,revision,verified_at FROM team_phone_credentials WHERE user_id=?');
  const pending = call(f, route + '/link', {token: login.data.token, body: {pollToken: start.data.pollToken, codeVerifier: verifier, currentPassword: PASSWORD}});
  const snapshot = await entered;
  assert.equal(snapshot.phone, PHONE);
  assert.equal(snapshot.revision, 1);
  return {pending, route, pollToken: start.data.pollToken};
}

for (const change of ['cancel', 'phone', 'session']) {
  const names = {cancel: 'its transaction is canceled', phone: 'its verified phone revision changes', session: 'its current session is revoked'};
  test('first WeChat link cannot survive when ' + names[change] + ' during KDF', {timeout: 15000}, async t => {
    const f = await fixture(t);
    const {pending, route, pollToken} = await pendingWechatLink(t, f);
    if (change === 'cancel') {
      const canceled = await call(f, route + '/cancel', {body: {pollToken}});
      assert.equal(canceled.status, 200, canceled.raw);
    } else if (change === 'phone') {
      f.db.prepare("UPDATE team_phone_credentials SET revision=revision+1 WHERE user_id='intern-a'").run();
    } else {
      f.db.prepare('UPDATE team_sessions SET revoked_at=?').run(NOW);
    }
    const result = await pending;
    assert.ok([401, 404, 409].includes(result.status), result.raw);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_wechat_identities').get().n, 0);
    const status = await call(f, route + '/status', {body: {pollToken}});
    assert.equal(status.data.status, change === 'cancel' ? 'canceled' : 'binding_required');
  });
}
