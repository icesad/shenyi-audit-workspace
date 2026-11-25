'use strict';
// Independent M2 acceptance: actual SQL, password verification and direct Requests.
// Synthetic data only. Does not prove production signup, devices, payment or Mac acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://127.0.0.1:8774';
const NOW = Date.parse('2026-11-15T03:00:00.000Z');
const PASSWORD = 'ShenyiDemo!2026';
const digest = value => createHash('sha256').update(value).digest('hex');
const moduleAt = name => import(pathToFileURL(path.join(ROOT, 'server/team', name)).href);
const qid = value => '"' + value.replaceAll('"', '""') + '"';
let baseline;

async function fixture(t) {
  // Seed once, then copy only synthetic table rows into a fresh real database.
  // This keeps expensive password hashing genuine without repeating seed work.
  baseline ||= (async () => {
    const {initializeTeamDatabase, seedDemoTeamData} = await moduleAt('database.mjs');
    const source = new DatabaseSync(':memory:');
    try {
      initializeTeamDatabase(source);
      await seedDemoTeamData(source);
      return source.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all()
        .map(({name}) => ({name, rows: source.prepare('SELECT * FROM ' + qid(name)).all()}));
    } finally { source.close(); }
  })();
  const snapshot = await baseline;
  const {initializeTeamDatabase} = await moduleAt('database.mjs');
  const db = new DatabaseSync(':memory:');
  initializeTeamDatabase(db);
  db.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');
  try {
    for (const {name, rows} of snapshot) for (const row of rows) {
      const keys = Object.keys(row);
      db.prepare('INSERT OR REPLACE INTO ' + qid(name) + '(' + keys.map(qid).join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')').run(...Object.values(row));
    }
    db.exec('COMMIT;');
  } catch (error) { db.exec('ROLLBACK;'); db.close(); throw error; }
  t.after(() => db.close());
  return {db, now: NOW, run: (sql, ...params) => db.prepare(sql).run(...params)};
}

function request(route, {method = 'GET', token, body, headers = {}} = {}) {
  const base = {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {}), ...headers};
  return new Request(ORIGIN + route, {method, headers: base, ...(body === undefined ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)})});
}
async function call(f, route, options = {}) {
  const {handleTeamApplicationRequest} = await moduleAt('application-api.mjs');
  const response = await handleTeamApplicationRequest(request(route, options), {db: f.db, now: () => f.now});
  const bytes = Buffer.from(await response.arrayBuffer());
  const raw = bytes.toString('utf8');
  const json = (response.headers.get('content-type') || '').startsWith('application/json') ? JSON.parse(raw) : null;
  return {response, bytes, raw, json};
}
function privacy(r) {
  assert.match(r.response.headers.get('cache-control') || '', /private/);
  assert.match(r.response.headers.get('cache-control') || '', /no-store/);
  assert.equal(r.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.response.headers.get('access-control-allow-origin'), null);
  assert.ok(!r.raw.includes(PASSWORD));
  assert.ok(!r.raw.includes('password_hash'));
  assert.ok(!r.raw.includes('token_hash'));
  assert.ok(!r.raw.includes('SELECT '));
}
async function login(f, username = 'intern-a', password = PASSWORD) {
  const r = await call(f, '/api/auth/login', {method: 'POST', body: {username, password}});
  assert.equal(r.response.status, 200, r.raw); privacy(r);
  assert.match(r.json.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(r.json.account.id);
  assert.equal(typeof r.json.account.displayName, 'string');
  assert.ok(Number.isSafeInteger(r.json.expiresAt) && r.json.expiresAt > f.now);
  return r.json;
}
const task = (suffix = '', team = 'team-a', id = 'task-a') => `/api/teams/${team}/collection/tasks/${id}${suffix}`;
const upload = (patch = {}) => ({filename: '合成采集材料.txt', contentBase64: Buffer.from('synthetic collection\r\n原始字节\0').toString('base64'), revision: 0, ...patch});
const session = (f, token) => call(f, '/api/auth/session', {token});

test('real password login returns only own memberships and stores opaque sessions by digest', async t => {
  const f = await fixture(t);
  const a = await login(f), a2 = await login(f);
  assert.notEqual(a.token, a2.token);
  assert.deepEqual(a.memberships, [{teamId: 'team-a', role: 'intern'}]);
  const stored = f.db.prepare('SELECT token_hash FROM team_sessions WHERE user_id=?').all(a.account.id).map(r => r.token_hash);
  assert.ok(stored.includes(digest(a.token)));
  assert.ok(!stored.includes(a.token));
  const s = await session(f, a.token); assert.equal(s.response.status, 200); privacy(s);
  assert.equal(s.json.token, undefined);
  assert.deepEqual(s.json.account, a.account);
  assert.deepEqual(s.json.memberships, a.memberships);
});

test('demo credentials never store plaintext passwords and same-password accounts have distinct verifier material', async t => {
  const f = await fixture(t);
  const tables = f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const credentialRows = [];
  for (const {name} of tables) {
    const rows = f.db.prepare('SELECT * FROM ' + qid(name)).all();
    for (const row of rows) for (const value of Object.values(row)) {
      if (typeof value === 'string') assert.ok(!value.includes(PASSWORD), name + ' must not retain the original password');
    }
    if (/credential|password/i.test(name)) credentialRows.push(...rows);
  }
  assert.ok(credentialRows.length >= 2, 'real password credential rows must exist');
  const material = row => Object.entries(row).filter(([key]) => /hash|salt|verifier/i.test(key)).map(([, value]) => String(value)).join('|');
  assert.ok(material(credentialRows[0]).length > 30, 'passwords require actual nontrivial verifier material');
  assert.notEqual(material(credentialRows[0]), material(credentialRows[1]), 'equal demo passwords must use independent salts');
});

test('unknown user and wrong password use the same failure and cannot impersonate roles with headers or fields', async t => {
  const f = await fixture(t);
  const wrong = await call(f, '/api/auth/login', {method: 'POST', body: {username: 'intern-a', password: 'wrong-password'}});
  const absent = await call(f, '/api/auth/login', {method: 'POST', body: {username: 'not-a-user', password: 'wrong-password'}});
  assert.equal(wrong.response.status, 401); assert.equal(absent.response.status, 401);
  assert.deepEqual(wrong.json, absent.json); privacy(wrong); privacy(absent);
  const injected = await call(f, '/api/auth/login', {method: 'POST', body: {username: 'intern-a', password: PASSWORD, role: 'partner'}});
  assert.equal(injected.response.status, 400); privacy(injected);
  const impersonated = await call(f, '/api/auth/session', {headers: {'X-ChatGPT-User-Id': 'manager-a', 'X-User-Id': 'partner-a'}});
  assert.equal(impersonated.response.status, 401); privacy(impersonated);
});

test('login validates JSON and a fixed field set without creating sessions', async t => {
  const f = await fixture(t);
  for (const body of ['{bad-json', '{}', 'null', '[]', {username: 'intern-a'}, {username: 'intern-a', password: PASSWORD, userId: 'partner-a'}]) {
    const r = await call(f, '/api/auth/login', {method: 'POST', body});
    assert.equal(r.response.status, 400); privacy(r);
  }
  const r = await call(f, '/api/auth/login', {method: 'POST', body: {username: 'intern-a', password: PASSWORD}, headers: {'Content-Type': 'text/plain'}});
  assert.equal(r.response.status, 415); privacy(r);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_sessions').get().n, 0);
});

test('failed username attempts are bounded and expire after the rate-limit window', async t => {
  const f = await fixture(t);
  for (let n = 0; n < 10; n++) {
    assert.equal((await call(f, '/api/auth/login', {method: 'POST', body: {username: 'intern-a', password: 'wrong-password'}})).response.status, 401);
  }
  const blocked = await call(f, '/api/auth/login', {method: 'POST', body: {username: 'intern-a', password: PASSWORD}});
  assert.equal(blocked.response.status, 429); privacy(blocked);
  f.now += 15 * 60_000 + 1;
  await login(f);
});

test('different usernames cannot bypass the global login attempt budget', async t => {
  const f = await fixture(t);
  for (let n = 0; n < 60; n++) {
    const r = await call(f, '/api/auth/login', {method: 'POST', body: {username: 'missing-' + n, password: 'wrong-password'}});
    assert.equal(r.response.status, 401);
  }
  const r = await call(f, '/api/auth/login', {method: 'POST', body: {username: 'intern-a', password: PASSWORD}});
  assert.equal(r.response.status, 429); privacy(r);
});

test('logout revokes its session, expiration and disabled users also fail closed', async t => {
  const f = await fixture(t);
  const a = await login(f), b = await login(f);
  const out = await call(f, '/api/auth/logout', {method: 'POST', token: a.token, body: {}});
  assert.equal(out.response.status, 200); assert.deepEqual(out.json, {signedOut: true}); privacy(out);
  assert.equal((await session(f, a.token)).response.status, 401);
  assert.equal((await session(f, b.token)).response.status, 200);
  f.run('UPDATE team_users SET status=? WHERE user_id=?', 'disabled', b.account.id);
  assert.equal((await session(f, b.token)).response.status, 401);
  f.run('UPDATE team_users SET status=? WHERE user_id=?', 'active', b.account.id);
  f.now = b.expiresAt;
  assert.equal((await session(f, b.token)).response.status, 401);
});

test('password change checks current password and revokes every old session atomically', async t => {
  const f = await fixture(t);
  const a = await login(f), b = await login(f);
  const wrong = await call(f, '/api/auth/password', {method: 'POST', token: a.token, body: {currentPassword: 'wrong-password', newPassword: 'A-replacement-password!'}});
  assert.equal(wrong.response.status, 403);
  assert.equal(wrong.json.error.code, 'VERIFICATION_FAILED');
  assert.equal((await session(f, a.token)).response.status, 200);
  const changed = await call(f, '/api/auth/password', {method: 'POST', token: a.token, body: {currentPassword: PASSWORD, newPassword: 'A-replacement-password!'}});
  assert.equal(changed.response.status, 200); assert.deepEqual(changed.json, {signedOut: true}); privacy(changed);
  assert.equal((await session(f, a.token)).response.status, 401);
  assert.equal((await session(f, b.token)).response.status, 401);
  assert.equal((await call(f, '/api/auth/login', {method: 'POST', body: {username: 'intern-a', password: PASSWORD}})).response.status, 401);
  await login(f, 'intern-a', 'A-replacement-password!');
});

test('password constraints do not silently trim input and reject unknown properties', async t => {
  const f = await fixture(t); const a = await login(f);
  for (const newPassword of ['short', 'x'.repeat(129), null]) {
    const r = await call(f, '/api/auth/password', {method: 'POST', token: a.token, body: {currentPassword: PASSWORD, newPassword}});
    assert.equal(r.response.status, 400); privacy(r);
  }
  const injected = await call(f, '/api/auth/password', {method: 'POST', token: a.token, body: {currentPassword: PASSWORD, newPassword: 'A-replacement-password!', userId: 'manager-a'}});
  assert.equal(injected.response.status, 400);
  const spaces = '  A-replacement-password!  ';
  assert.equal((await call(f, '/api/auth/password', {method: 'POST', token: a.token, body: {currentPassword: PASSWORD, newPassword: spaces}})).response.status, 200);
  assert.equal((await call(f, '/api/auth/login', {method: 'POST', body: {username: 'intern-a', password: spaces.trim()}})).response.status, 401);
  await login(f, 'intern-a', spaces);
});

test('new login retains two-team isolation and a collector sees only their assigned task', async t => {
  const f = await fixture(t); const a = await login(f);
  const list = await call(f, '/api/teams/team-a/collection/tasks', {token: a.token});
  assert.equal(list.response.status, 200); privacy(list);
  assert.deepEqual(list.json.tasks.map(row => row.id), ['task-a']);
  assert.equal((await call(f, task('', 'team-b'), {token: a.token})).response.status, 404);
  assert.equal((await call(f, task('', 'team-a', 'task-assistant'), {token: a.token})).response.status, 404);
  assert.equal((await call(f, '/api/teams/team-a/collection/tasks?role=partner', {token: a.token})).response.status, 400);
});

test('upload preserves source bytes and hash, submits task and grants only own exact attachment download', async t => {
  const f = await fixture(t); const a = await login(f);
  const before = await call(f, task('/submissions'), {token: a.token});
  assert.equal(before.response.status, 200); assert.deepEqual(before.json, {revision: 0, submissions: []});
  const body = upload(); const original = Buffer.from(body.contentBase64, 'base64');
  const sent = await call(f, task('/submissions'), {method: 'POST', token: a.token, body});
  assert.equal(sent.response.status, 201, sent.raw); privacy(sent);
  assert.equal(sent.json.revision, 1);
  const s = sent.json.submission;
  assert.equal(s.filename, body.filename); assert.equal(s.byteLength, original.length);
  assert.equal(s.sha256, digest(original)); assert.ok(Number.isSafeInteger(s.createdAt));
  assert.ok(s.id && s.attachmentId);
  const dl = await call(f, task('/attachments/' + s.attachmentId), {token: a.token});
  assert.equal(dl.response.status, 200); assert.deepEqual(dl.bytes, original);
  assert.equal(dl.response.headers.get('content-type'), 'application/octet-stream'); privacy(dl);
  const after = await call(f, task('/submissions'), {token: a.token});
  assert.deepEqual(after.json, {revision: 1, submissions: [s]});
  const detail = await call(f, task(), {token: a.token}); assert.equal(detail.json.task.status, 'submitted');
  assert.equal(detail.json.task.projectId, undefined);
});

test('duplicate submit is rejected without replacing or duplicating the first original', async t => {
  const f = await fixture(t); const a = await login(f);
  const first = await call(f, task('/submissions'), {method: 'POST', token: a.token, body: upload()});
  assert.equal(first.response.status, 201);
  const repeated = await call(f, task('/submissions'), {method: 'POST', token: a.token, body: upload({contentBase64: Buffer.from('replacement').toString('base64')})});
  assert.equal(repeated.response.status, 409); privacy(repeated);
  assert.equal((await call(f, task('/submissions'), {token: a.token})).json.submissions.length, 1);
  const dl = await call(f, task('/attachments/' + first.json.submission.attachmentId), {token: a.token});
  assert.deepEqual(dl.bytes, Buffer.from(upload().contentBase64, 'base64'));
});

test('submission input rejects unsafe filenames, malformed base64 and field injection before writing', async t => {
  const f = await fixture(t); const a = await login(f);
  const invalid = [
    upload({filename: '../escape.txt'}), upload({filename: 'folder/file.txt'}), upload({filename: 'folder\\file.txt'}),
    upload({filename: 'bad\r\nname.txt'}), upload({filename: 'bad\0name.txt'}),
    upload({contentBase64: 'not-base64!'}), upload({contentBase64: 'YQ'}), upload({contentBase64: 'YR=='}),
    upload({revision: -1}), upload({revision: 0.5}), upload({role: 'partner'}), upload({userId: 'manager-a'}),
  ];
  for (const body of invalid) {
    const r = await call(f, task('/submissions'), {method: 'POST', token: a.token, body});
    assert.equal(r.response.status, 400, JSON.stringify(body)); privacy(r);
  }
  assert.deepEqual((await call(f, task('/submissions'), {token: a.token})).json, {revision: 0, submissions: []});
});

test('oversize original is rejected and cannot leave orphan attachment or submission rows', async t => {
  const f = await fixture(t); const a = await login(f);
  const before = f.db.prepare('SELECT COUNT(*) AS n FROM team_collection_attachments').get().n;
  const r = await call(f, task('/submissions'), {method: 'POST', token: a.token, body: upload({contentBase64: Buffer.alloc(12 * 1024 * 1024 + 1, 65).toString('base64')})});
  assert.equal(r.response.status, 413); privacy(r);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_collection_attachments').get().n, before);
  assert.deepEqual((await call(f, task('/submissions'), {token: a.token})).json, {revision: 0, submissions: []});
});

test('frozen project, closed task, stale revision and missing assignment reject uploads without mutations', async t => {
  const f = await fixture(t); const a = await login(f);
  const initial = await call(f, task('/submissions'), {token: a.token});
  f.run('UPDATE team_projects SET status=? WHERE team_id=? AND project_id=?', 'frozen', 'team-a', 'project-a');
  assert.equal((await call(f, task('/submissions'), {method: 'POST', token: a.token, body: upload()})).response.status, 409);
  f.run('UPDATE team_projects SET status=? WHERE team_id=? AND project_id=?', 'active', 'team-a', 'project-a');
  f.run('UPDATE team_collection_tasks SET status=? WHERE team_id=? AND task_id=?', 'closed', 'team-a', 'task-a');
  assert.equal((await call(f, task('/submissions'), {method: 'POST', token: a.token, body: upload()})).response.status, 409);
  f.run('UPDATE team_collection_tasks SET status=? WHERE team_id=? AND task_id=?', 'open', 'team-a', 'task-a');
  assert.equal((await call(f, task('/submissions'), {method: 'POST', token: a.token, body: upload({revision: 1})})).response.status, 409);
  f.run('UPDATE team_task_assignments SET status=? WHERE team_id=? AND task_id=? AND user_id=?', 'revoked', 'team-a', 'task-a', a.account.id);
  assert.equal((await call(f, task('/submissions'), {method: 'POST', token: a.token, body: upload()})).response.status, 404);
  const before = initial.json;
  f.run('UPDATE team_task_assignments SET status=? WHERE team_id=? AND task_id=? AND user_id=?', 'active', 'team-a', 'task-a', a.account.id);
  assert.deepEqual((await call(f, task('/submissions'), {token: a.token})).json, before);
});

test('project-read permission does not allow uploading another employee task or reading their submission history', async t => {
  const f = await fixture(t); const a = await login(f), manager = await login(f, 'manager-a');
  const sent = await call(f, task('/submissions'), {method: 'POST', token: a.token, body: upload()}); assert.equal(sent.response.status, 201);
  const list = await call(f, task('/submissions'), {token: manager.token});
  assert.equal(list.response.status, 200); assert.deepEqual(list.json.submissions, []);
  const dl = await call(f, task('/attachments/' + sent.json.submission.attachmentId), {token: manager.token}); assert.equal(dl.response.status, 404);
  assert.equal((await call(f, task('/submissions'), {method: 'POST', token: manager.token, body: upload({revision: 1})})).response.status, 404);
});

test('explicit manager capability permits return and resubmission, stale versions do not override work', async t => {
  const f = await fixture(t); const a = await login(f), manager = await login(f, 'manager-a');
  assert.equal((await call(f, task('/return'), {method: 'POST', token: a.token, body: {revision:0}})).response.status, 404);
  assert.equal((await call(f, task('/return'), {method: 'POST', token: manager.token, body: {revision:0}})).response.status, 409);
  assert.equal((await call(f, task('/submissions'), {method: 'POST', token: a.token, body: upload()})).response.status, 201);
  const returned = await call(f, task('/return'), {method: 'POST', token: manager.token, body: {revision:1}});
  assert.equal(returned.response.status, 200);
  assert.equal((await call(f, task(), {token: a.token})).json.task.status, 'returned');
  const state = await call(f, task('/submissions'), {token: a.token}); assert.equal(state.json.revision, 2);
  assert.equal((await call(f, task('/submissions'), {method: 'POST', token: a.token, body: upload({revision: 0})})).response.status, 409);
  const sent = await call(f, task('/submissions'), {method: 'POST', token: a.token, body: upload({revision: state.json.revision})});
  assert.equal(sent.response.status, 201); assert.equal(sent.json.revision, 3);
  assert.equal((await call(f, task('/submissions'), {token: a.token})).json.submissions.length, 2);
});

test('assignment is project-management scoped, rejects cross-team users and revokes previous collector access', async t => {
  const f = await fixture(t); const a = await login(f), assistant = await login(f, 'assistant-a'), manager = await login(f, 'manager-a');
  assert.equal((await call(f, task('/assignment'), {method: 'POST', token: a.token, body: {userId: assistant.account.id,revision:0}})).response.status, 404);
  const b = await login(f, 'intern-b');
  const bad = await call(f, task('/assignment'), {method: 'POST', token: manager.token, body: {userId: b.account.id,revision:0}});
  assert.equal(bad.response.status, 404); privacy(bad);
  const assigned = await call(f, task('/assignment'), {method: 'POST', token: manager.token, body: {userId: assistant.account.id,revision:0}});
  assert.equal(assigned.response.status, 200);
  assert.equal((await call(f, task(), {token: a.token})).response.status, 404);
  assert.equal((await call(f, task(), {token: assistant.token})).response.status, 200);
  f.run("UPDATE team_project_grants SET status='revoked' WHERE team_id='team-a' AND user_id=? AND permission='collection.manage'", manager.account.id);
  assert.equal((await call(f, task('/assignment'), {method: 'POST', token: manager.token, body: {userId: a.account.id,revision:1}})).response.status, 404);
});

test('membership removal immediately prevents original download, upload and submission history access', async t => {
  const f = await fixture(t); const a = await login(f);
  const sent = await call(f, task('/submissions'), {method: 'POST', token: a.token, body: upload()}); assert.equal(sent.response.status, 201);
  f.run('UPDATE team_memberships SET status=? WHERE team_id=? AND user_id=?', 'disabled', 'team-a', a.account.id);
  for (const route of [task(), task('/submissions'), task('/attachments/' + sent.json.submission.attachmentId)]) {
    const r = await call(f, route, {token: a.token}); assert.equal(r.response.status, 404); privacy(r);
  }
  const put = await call(f, task('/submissions'), {method: 'POST', token: a.token, body: upload({revision: 1})}); assert.equal(put.response.status, 404);
});

test('unexpected database errors remain private generic failures and do not expose credentials or SQL', async t => {
  const {handleTeamApplicationRequest} = await moduleAt('application-api.mjs');
  const response = await handleTeamApplicationRequest(request('/api/auth/login', {method: 'POST', body: {username: 'intern-a', password: PASSWORD}}),
    {db: {prepare() { throw new Error('SELECT password_hash SECRET_PROVIDER_PATH'); }}, now: () => NOW});
  const raw = await response.text();
  assert.equal(response.status, 503);
  assert.ok(!raw.includes('SECRET_PROVIDER_PATH')); assert.ok(!raw.includes('password_hash')); assert.ok(!raw.includes(PASSWORD));
  assert.match(response.headers.get('cache-control') || '', /no-store/);
});

test('explicit invitation capability joins the named account once without granting a higher role', async t => {
  const f = await fixture(t); const manager = await login(f, 'manager-a'), invitee = await login(f, 'invitee-a');
  assert.deepEqual(invitee.memberships, []);
  const created = await call(f, '/api/teams/team-a/invitations', {method: 'POST', token: manager.token, body: {username: 'invitee-a', role: 'assistant'}});
  assert.equal(created.response.status, 201, created.raw); privacy(created);
  assert.match(created.json.invitationToken, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(created.json.expiresAt > f.now);
  const body = {invitationToken: created.json.invitationToken};
  const joined = await call(f, '/api/auth/invitations/accept', {method: 'POST', token: invitee.token, body});
  assert.equal(joined.response.status, 200, joined.raw);
  assert.deepEqual(joined.json, {joined: true, teamId: 'team-a', role: 'assistant'});
  const repeated = await call(f, '/api/auth/invitations/accept', {method: 'POST', token: invitee.token, body});
  assert.ok(repeated.response.status >= 400 && repeated.response.status < 500); privacy(repeated);
  assert.deepEqual((await session(f, invitee.token)).json.memberships, [{teamId: 'team-a', role: 'assistant'}]);
  const ownTasks = await call(f, '/api/teams/team-a/collection/tasks', {token: invitee.token});
  assert.deepEqual(ownTasks.json.tasks, [], 'joining a team does not grant its complete project tree or task data');
});

test('invitation cannot be claimed by another account or used to choose partner role or override a member', async t => {
  const f = await fixture(t); const manager = await login(f, 'manager-a'), intern = await login(f), invitee = await login(f, 'invitee-a');
  assert.equal((await call(f, '/api/teams/team-a/invitations', {method: 'POST', token: intern.token, body: {username: 'invitee-a', role: 'assistant'}})).response.status, 404);
  const raised = await call(f, '/api/teams/team-a/invitations', {method: 'POST', token: manager.token, body: {username: 'invitee-a', role: 'partner'}});
  assert.equal(raised.response.status, 400);
  const created = await call(f, '/api/teams/team-a/invitations', {method: 'POST', token: manager.token, body: {username: 'invitee-a', role: 'intern'}});
  assert.equal(created.response.status, 201);
  const wrong = await call(f, '/api/auth/invitations/accept', {method: 'POST', token: intern.token, body: {invitationToken: created.json.invitationToken}});
  assert.ok(wrong.response.status >= 400 && wrong.response.status < 500); privacy(wrong);
  assert.equal((await call(f, '/api/auth/invitations/accept', {method: 'POST', token: invitee.token, body: {invitationToken: created.json.invitationToken}})).response.status, 200);
  const existing = await call(f, '/api/teams/team-a/invitations', {method: 'POST', token: manager.token, body: {username: 'intern-a', role: 'assistant'}});
  if (existing.response.status === 201) {
    const accepted = await call(f, '/api/auth/invitations/accept', {method: 'POST', token: intern.token, body: {invitationToken: existing.json.invitationToken}});
    assert.ok(accepted.response.status >= 400 && accepted.response.status < 500);
  } else assert.ok(existing.response.status >= 400 && existing.response.status < 500);
  assert.deepEqual((await session(f, intern.token)).json.memberships, [{teamId: 'team-a', role: 'intern'}]);
});

test('expired invitations and invitation-creator grant revocation prevent joining without side effects', async t => {
  const f = await fixture(t); const manager = await login(f, 'manager-a'), invitee = await login(f, 'invitee-a');
  const created = await call(f, '/api/teams/team-a/invitations', {method: 'POST', token: manager.token, body: {username: 'invitee-a', role: 'intern'}});
  assert.equal(created.response.status, 201);
  f.run('UPDATE team_invitations SET expires_at=? WHERE token_hash=?', f.now, digest(created.json.invitationToken));
  const expired = await call(f, '/api/auth/invitations/accept', {method: 'POST', token: invitee.token, body: {invitationToken: created.json.invitationToken}});
  assert.ok(expired.response.status >= 400 && expired.response.status < 500);
  const another = await call(f, '/api/teams/team-a/invitations', {method: 'POST', token: manager.token, body: {username: 'invitee-a', role: 'intern'}});
  assert.equal(another.response.status, 201);
  f.run("UPDATE team_admin_grants SET status='revoked' WHERE team_id='team-a' AND user_id=? AND permission='member.invite'", manager.account.id);
  const revoked = await call(f, '/api/auth/invitations/accept', {method: 'POST', token: invitee.token, body: {invitationToken: another.json.invitationToken}});
  assert.ok(revoked.response.status >= 400 && revoked.response.status < 500); privacy(revoked);
  assert.deepEqual((await session(f, invitee.token)).json.memberships, []);
});
