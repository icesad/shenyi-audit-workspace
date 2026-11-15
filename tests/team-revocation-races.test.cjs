'use strict';
// Independent race acceptance: real SQLite, real password work and streamed Requests.
// Synthetic databases only; no shared preview database or native window is touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const ORIGIN = 'http://127.0.0.1:8774';
const moduleAt = file => import(pathToFileURL(path.resolve(__dirname, '../server/team', file)).href);

async function fixture(t) {
  const {initializeTeamDatabase, seedDemoTeamData} = await moduleAt('database.mjs');
  const {handleTeamApplicationRequest} = await moduleAt('application-api.mjs');
  const db = new DatabaseSync(':memory:');
  initializeTeamDatabase(db); await seedDemoTeamData(db); t.after(() => db.close());
  const call = (route, method = 'GET', body, token) => handleTeamApplicationRequest(new Request(ORIGIN + route, {
    method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  }), {db});
  const login = async username => {
    const response = await call('/api/auth/login', 'POST', {username, password: 'ShenyiDemo!2026'});
    assert.equal(response.status, 200); return (await response.json()).token;
  };
  const stream = (route, token) => {
    let controller;
    const body = new ReadableStream({start(value) { controller = value; }});
    return {
      pending: handleTeamApplicationRequest(new Request(ORIGIN + route, {
        method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token}, body, duplex: 'half',
      }), {db}),
      finish(value) { controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close(); },
    };
  };
  return {db, call, login, stream, handleTeamApplicationRequest};
}
const TASK = '/api/teams/team-a/collection/tasks/task-a';
const upload = () => ({filename: '合成竞态.txt', contentBase64: Buffer.from('synthetic original').toString('base64'), revision: 0});

test('assignment revoked while upload body is pending denies final write without original or audit orphans', async t => {
  const f = await fixture(t), token = await f.login('intern-a');
  const request = f.stream(TASK + '/submissions', token);
  await new Promise(setImmediate); // Handler has authenticated and is blocked reading the stream.
  f.db.prepare("UPDATE team_task_assignments SET status='revoked' WHERE team_id='team-a' AND task_id='task-a'").run();
  request.finish(upload());
  assert.equal((await request.pending).status, 404);
  for (const table of ['team_collection_attachments', 'team_task_submissions', 'team_attachment_grants', 'team_activity']) {
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 0, table);
  }
  assert.equal(f.db.prepare("SELECT status FROM team_collection_tasks WHERE team_id='team-a' AND task_id='task-a'").get().status, 'open');
});

test('management grant revoked while return body is pending keeps the submitted task and audit unchanged', async t => {
  const f = await fixture(t), collector = await f.login('intern-a'), manager = await f.login('manager-a');
  assert.equal((await f.call(TASK + '/submissions', 'POST', upload(), collector)).status, 201);
  const before = f.db.prepare('SELECT COUNT(*) AS n FROM team_activity').get().n;
  const request = f.stream(TASK + '/return', manager);
  await new Promise(setImmediate);
  f.db.prepare("UPDATE team_project_grants SET status='revoked' WHERE user_id='manager-a' AND permission='collection.manage'").run();
  request.finish({revision:1});
  assert.equal((await request.pending).status, 404);
  assert.equal(f.db.prepare("SELECT status FROM team_collection_tasks WHERE team_id='team-a' AND task_id='task-a'").get().status, 'submitted');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_activity').get().n, before);
});

test('user disabled after credential lookup but before async password verification cannot receive a session', async t => {
  const f = await fixture(t); let scheduled = false;
  // Observe the actual credential SELECT, then schedule revocation before the
  // native asynchronous KDF can finish. SQL and KDF results are never mocked.
  const observed = new Proxy(f.db, {get(target, key) {
    if (key === 'prepare') return sql => {
      const statement = target.prepare(sql);
      if (!sql.includes('SELECT credential.user_id,credential.password_hash')) return statement;
      return {get(...values) {
        const row = statement.get(...values);
        if (values[0] === 'assistant-a') {
          scheduled = true;
          queueMicrotask(() => target.prepare("UPDATE team_users SET status='disabled' WHERE user_id='assistant-a'").run());
        }
        return row;
      }};
    };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }});
  const response = await f.handleTeamApplicationRequest(new Request(ORIGIN + '/api/auth/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username: 'assistant-a', password: 'ShenyiDemo!2026'}),
  }), {db: observed});
  assert.equal(scheduled, true, 'the revocation must run after the real credential read');
  assert.equal(response.status, 401);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM team_sessions WHERE user_id='assistant-a'").get().n, 0);
});
