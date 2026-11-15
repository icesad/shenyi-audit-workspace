'use strict';
// Independent M2 network acceptance. Real loopback listener, SQL and original bytes.
// This does not exercise public deployment, TLS, desktop IPC or device binding.
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {request: httpRequest} = require('node:http');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const at = name => import(pathToFileURL(path.join(ROOT, 'server/team', name)).href);
const PASSWORD = 'ShenyiDemo!2026';

async function fixture(t) {
  const {initializeTeamDatabase, seedDemoTeamData} = await at('database.mjs');
  const {startTeamServer} = await at('dev-server.mjs');
  const db = new DatabaseSync(':memory:'); initializeTeamDatabase(db); await seedDemoTeamData(db);
  const running = await startTeamServer({db, port: 0});
  const listener = running.server.address();
  assert.equal(listener.address, '127.0.0.1');
  const base = typeof running.address === 'string' ? running.address : running.address?.url || `http://127.0.0.1:${listener.port}`;
  t.after(async () => { await running.close(); db.close(); });
  return {db, base, server: running.server};
}
async function call(f, route, {method = 'GET', token, body, headers = {}} = {}) {
  const response = await fetch(f.base + route, {method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}), ...headers}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  const bytes = Buffer.from(await response.arrayBuffer());
  const raw = bytes.toString('utf8');
  const json = (response.headers.get('content-type') || '').startsWith('application/json') ? JSON.parse(raw) : null;
  return {response, bytes, raw, json};
}
function raw(f, route, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(f.base + route, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}}, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8')}));
    });
    request.on('error', reject); request.end(JSON.stringify({username: 'intern-a', password: PASSWORD}));
  });
}

test('loopback HTTP supports login, authorized collection upload/download and real session logout', async t => {
  const f = await fixture(t);
  const login = await call(f, '/api/auth/login', {method: 'POST', body: {username: 'intern-a', password: PASSWORD}});
  assert.equal(login.response.status, 200, login.raw); const token = login.json.token;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const list = await call(f, '/api/teams/team-a/collection/tasks', {token});
  assert.equal(list.response.status, 200); assert.deepEqual(list.json.tasks.map(task => task.id), ['task-a']);
  const bytes = Buffer.from('HTTP合成原件\r\n\0end');
  const upload = await call(f, '/api/teams/team-a/collection/tasks/task-a/submissions', {method: 'POST', token, body: {filename: 'HTTP合成.txt', contentBase64: bytes.toString('base64'), revision: 0}});
  assert.equal(upload.response.status, 201, upload.raw);
  const download = await call(f, '/api/teams/team-a/collection/tasks/task-a/attachments/' + upload.json.submission.attachmentId, {token});
  assert.equal(download.response.status, 200); assert.deepEqual(download.bytes, bytes);
  assert.match(download.response.headers.get('cache-control') || '', /private.*no-store/);
  assert.equal(download.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(download.response.headers.get('access-control-allow-origin'), null);
  assert.equal((await call(f, '/api/teams/team-b/collection/tasks/task-a', {token})).response.status, 404);
  assert.equal((await call(f, '/api/auth/logout', {method: 'POST', token, body: {}})).response.status, 200);
  assert.equal((await call(f, '/api/auth/session', {token})).response.status, 401);
});

test('loopback HTTP rejects attacker Host and Origin without offering cross-origin access', async t => {
  const f = await fixture(t);
  for (const headers of [{Host: 'attacker.example.invalid'}, {Origin: 'https://attacker.example.invalid'}, {Origin: 'null'}, {'Sec-Fetch-Site': 'cross-site'}]) {
    const r = await raw(f, '/api/auth/login', headers);
    assert.equal(r.status, 403, r.body);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    assert.ok(!r.body.includes(PASSWORD));
  }
  const valid = await raw(f, '/api/auth/login', {Origin: 'shenyi://app'});
  assert.equal(valid.status, 200, valid.body);
  const options = await fetch(f.base + '/api/auth/login', {method: 'OPTIONS', headers: {Origin: 'https://attacker.example.invalid', 'Access-Control-Request-Method': 'POST'}});
  assert.equal(options.status, 403);
  assert.equal(options.headers.get('access-control-allow-origin'), null);
});

test('network boundary rejects wrong media types and never exposes internal files or full module data', async t => {
  const f = await fixture(t);
  const bad = await fetch(f.base + '/api/auth/login', {method: 'POST', headers: {'Content-Type': 'text/plain'}, body: JSON.stringify({username: 'intern-a', password: PASSWORD})});
  assert.equal(bad.status, 415);
  const login = await call(f, '/api/auth/login', {method: 'POST', body: {username: 'intern-a', password: PASSWORD}});
  assert.equal(login.response.status, 200); const token = login.json.token;
  for (const route of ['/server/team/schema.sql', '/.env', '/api/teams/team-a/structure', '/api/teams/team-a/export']) {
    const r = await call(f, route, {token}); assert.equal(r.response.status, 404, route);
    assert.ok(!r.raw.includes('CREATE TABLE')); assert.ok(!r.raw.includes('password_hash'));
    assert.match(r.response.headers.get('cache-control') || '', /no-store/);
  }
});
