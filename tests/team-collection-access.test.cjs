'use strict';
// Independent server-boundary acceptance: real SQLite, synthetic tenants and direct Requests.
// This does not exercise password login, desktop/device binding or a deployed cloud service.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const NOW = Date.parse('2026-11-15T01:00:00.000Z');
const ORIGIN = 'https://synthetic-team.example.invalid';
const ROLES = ['intern', 'assistant', 'manager', 'partner'];
const hash = text => createHash('sha256').update(text).digest('hex');
const token = user => createHash('sha256').update('synthetic-test-session:' + user).digest('base64url');
let apiPromise;
const api = () => apiPromise ||= import(pathToFileURL(path.join(ROOT, 'server/team/collection-api.mjs')).href);

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(path.join(ROOT, 'server/team/schema.sql'), 'utf8'));
  t.after(() => db.close());
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  for (const team of ['a', 'b']) {
    const tid = 'team-' + team;
    run('INSERT INTO teams(team_id,status) VALUES (?,?)', tid, 'active');
    for (const role of ROLES) {
      const uid = team + '-' + role;
      run('INSERT INTO team_users(user_id,status) VALUES (?,?)', uid, 'active');
      run('INSERT INTO team_memberships(team_id,user_id,role,status) VALUES (?,?,?,?)', tid, uid, role, 'active');
      run('INSERT INTO team_sessions(token_hash,user_id,expires_at,revoked_at) VALUES (?,?,?,?)', hash(token(uid)), uid, NOW + 60_000, null);
    }
    for (const pid of ['project-shared', 'project-private']) {
      run('INSERT INTO team_projects(team_id,project_id,title,financial_summary,structure_json,status) VALUES (?,?,?,?,?,?)', tid, pid,
        team + ' CONFIDENTIAL CLIENT', 'DO_NOT_EXPOSE_FINANCIAL_' + team, '{"private_structure":"DO_NOT_EXPOSE_TREE_' + team + '"}', 'active');
    }
    for (const role of ROLES) {
      const taskId = 'task-' + role;
      const projectId = ['intern', 'assistant'].includes(role) ? 'project-shared' : 'project-private';
      run('INSERT INTO team_collection_tasks(team_id,task_id,project_id,title,instructions,status) VALUES (?,?,?,?,?,?)', tid, taskId, projectId,
        team + ' ' + role + ' collection', 'Only collect ' + team + ' ' + role + ' records', 'open');
      run('INSERT INTO team_task_assignments(team_id,task_id,user_id,status) VALUES (?,?,?,?)', tid, taskId, team + '-' + role, 'active');
      // Identical attachment/task/project IDs across tenants deliberately exercise composite scoping.
      run('INSERT INTO team_collection_attachments(team_id,task_id,attachment_id,display_name,bytes) VALUES (?,?,?,?,?)', tid, taskId,
        'file-' + role, team + ' private original.txt', Buffer.from('ORIGINAL_' + team + '_' + role));
    }
  }
  run('INSERT INTO team_users(user_id,status) VALUES (?,?)', 'outsider', 'active');
  run('INSERT INTO team_sessions(token_hash,user_id,expires_at,revoked_at) VALUES (?,?,?,?)', hash(token('outsider')), 'outsider', NOW + 60_000, null);
  return { db, run };
}

function req(route = '/tasks', user = 'a-intern', options = {}) {
  const { team = 'team-a', method = 'GET', headers = {}, body } = options;
  return new Request(ORIGIN + '/api/teams/' + team + '/collection' + route, {
    method,
    headers: { ...(user ? { Authorization: 'Bearer ' + token(user) } : {}), ...headers },
    ...(body === undefined ? {} : { body }),
  });
}

async function call(f, request, options = {}) {
  const { handleTeamCollectionRequest } = await api();
  const response = await handleTeamCollectionRequest(request, { db: f.db, now: () => NOW, ...options });
  const bytes = Buffer.from(await response.arrayBuffer());
  const raw = bytes.toString('utf8');
  const json = (response.headers.get('content-type') || '').startsWith('application/json') ? JSON.parse(raw) : null;
  return { response, bytes, raw, json };
}

function privateResponse(result) {
  assert.match(result.response.headers.get('cache-control') || '', /private/i);
  assert.match(result.response.headers.get('cache-control') || '', /no-store/i);
  assert.equal(result.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(result.response.headers.get('access-control-allow-origin'), null);
  assert.equal(result.response.headers.get('set-cookie'), null);
  assert.ok(!result.raw.includes('token_hash'));
  assert.ok(!result.raw.includes('DO_NOT_EXPOSE'));
  assert.ok(!result.raw.includes('CONFIDENTIAL CLIENT'));
}

function expectedTask(team, role) {
  return { id: 'task-' + role, title: team + ' ' + role + ' collection', instructions: 'Only collect ' + team + ' ' + role + ' records', status: 'open' };
}

test('all four roles in both teams see only their assigned task, never project structure or financial fields', async t => {
  const f = fixture(t);
  for (const team of ['a', 'b']) for (const role of ROLES) {
    const r = await call(f, req('/tasks', team + '-' + role, { team: 'team-' + team }));
    assert.equal(r.response.status, 200); privateResponse(r);
    assert.deepEqual(r.json, { tasks: [expectedTask(team, role)], hasMore: false });
    const detail = await call(f, req('/tasks/task-' + role, team + '-' + role, { team: 'team-' + team }));
    assert.equal(detail.response.status, 200); privateResponse(detail);
    assert.deepEqual(detail.json, { task: expectedTask(team, role) });
  }
});

test('higher business roles receive no automatic tenant-wide or project-wide access', async t => {
  const f = fixture(t);
  for (const role of ['manager', 'partner']) {
    const r = await call(f, req('/tasks/task-intern', 'a-' + role));
    assert.equal(r.response.status, 404); privateResponse(r);
  }
  for (const role of ['intern', 'assistant']) {
    f.run('INSERT INTO team_project_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,?)', 'team-a', 'project-private', 'a-' + role, 'collection.read', 'active');
    assert.equal((await call(f, req('/tasks/task-partner', 'a-' + role))).response.status, 404);
  }
});

test('explicit project collection grant expands only manager/partner scope and only that project', async t => {
  const f = fixture(t);
  for (const role of ['manager', 'partner']) {
    f.run('INSERT INTO team_project_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,?)', 'team-a', 'project-shared', 'a-' + role, 'collection.read', 'active');
    const r = await call(f, req('/tasks', 'a-' + role));
    assert.equal(r.response.status, 200); privateResponse(r);
    assert.deepEqual(r.json.tasks.map(x => x.id).sort(), ['task-assistant', 'task-intern', 'task-' + role].sort());
    const excludedRole = role === 'manager' ? 'partner' : 'manager';
    assert.equal((await call(f, req('/tasks/task-' + excludedRole, 'a-' + role))).response.status, 404);
  }
});

test('cross-tenant IDs, nonmembers, absent and disabled teams all return the same private 404', async t => {
  const f = fixture(t);
  const cases = [req('/tasks/task-intern', 'a-intern', { team: 'team-b' }), req('/tasks', 'outsider'),
    req('/tasks', 'a-intern', { team: 'missing-team' }), req('/tasks/missing-task')];
  f.run('UPDATE teams SET status=? WHERE team_id=?', 'disabled', 'team-b');
  cases.push(req('/tasks', 'b-partner', { team: 'team-b' }));
  let body;
  for (const request of cases) {
    const r = await call(f, request); assert.equal(r.response.status, 404); privateResponse(r);
    body ??= r.raw; assert.equal(r.raw, body);
  }
});

test('missing, malformed, unknown, expired and revoked bearer credentials fail without identity hints', async t => {
  const f = fixture(t);
  const cases = [req('/tasks', null), req('/tasks', null, { headers: { Authorization: 'Bearer bad' } }),
    req('/tasks', null, { headers: { Authorization: 'Basic ' + token('a-intern') } }),
    req('/tasks', null, { headers: { Authorization: 'Bearer ' + token('never-issued') } }),
    req('/tasks', null, { headers: { 'x-chatgpt-user-id': 'a-partner', 'x-user-id': 'a-partner', 'x-role': 'partner' } })];
  f.run('UPDATE team_sessions SET expires_at=? WHERE user_id=?', NOW, 'a-assistant');
  f.run('UPDATE team_sessions SET revoked_at=? WHERE user_id=?', NOW - 1, 'a-manager');
  cases.push(req('/tasks', 'a-assistant'), req('/tasks', 'a-manager'));
  let body;
  for (const request of cases) {
    const r = await call(f, request); assert.equal(r.response.status, 401); privateResponse(r);
    body ??= r.raw; assert.equal(r.raw, body);
  }
});

test('disabled user/membership and unknown database role fail closed without changing task data', async t => {
  const f = fixture(t);
  f.run('UPDATE team_users SET status=? WHERE user_id=?', 'disabled', 'a-intern');
  assert.equal((await call(f, req('/tasks'))).response.status, 401);
  f.run('UPDATE team_memberships SET status=? WHERE team_id=? AND user_id=?', 'disabled', 'team-a', 'a-assistant');
  assert.equal((await call(f, req('/tasks', 'a-assistant'))).response.status, 404);
  // A damaged/unmigrated role must never become a fallback administrator.
  f.db.exec('PRAGMA ignore_check_constraints = ON');
  f.run('UPDATE team_memberships SET role=? WHERE team_id=? AND user_id=?', 'future-super-admin', 'team-a', 'a-partner');
  f.db.exec('PRAGMA ignore_check_constraints = OFF');
  const unknown = await call(f, req('/tasks', 'a-partner'));
  assert.equal(unknown.response.status, 404); privateResponse(unknown);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM team_collection_tasks').get().n, 8);
});

test('search, summary, pagination and hasMore reveal only authorized tasks', async t => {
  const f = fixture(t);
  const own = await call(f, req('/tasks?q=intern'));
  assert.deepEqual(own.json, { tasks: [expectedTask('a', 'intern')], hasMore: false });
  const hidden = await call(f, req('/tasks?q=partner'));
  assert.deepEqual(hidden.json, { tasks: [], hasMore: false });
  assert.deepEqual((await call(f, req('/summary'))).json, { taskCount: 1 });
  f.run('INSERT INTO team_project_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,?)', 'team-a', 'project-shared', 'a-manager', 'collection.read', 'active');
  const p1 = await call(f, req('/tasks?limit=1', 'a-manager'));
  assert.deepEqual(p1.json, { tasks: [expectedTask('a', 'assistant')], hasMore: true });
  const p2 = await call(f, req('/tasks?limit=1&after=task-assistant', 'a-manager'));
  assert.deepEqual(p2.json, { tasks: [expectedTask('a', 'intern')], hasMore: true });
  const p3 = await call(f, req('/tasks?limit=1&after=task-intern', 'a-manager'));
  assert.deepEqual(p3.json, { tasks: [expectedTask('a', 'manager')], hasMore: false });
  assert.deepEqual((await call(f, req('/summary', 'a-manager'))).json, { taskCount: 3 });
});

test('search uses literal parameterized text; SQL and LIKE metacharacters cannot widen scope', async t => {
  const f = fixture(t);
  for (const search of ["' OR 1=1 --", '%', '_', '\\', 'DO_NOT_EXPOSE_TREE', 'b intern']) {
    const r = await call(f, req('/tasks?q=' + encodeURIComponent(search)));
    assert.equal(r.response.status, 200); privateResponse(r);
    assert.deepEqual(r.json, { tasks: [], hasMore: false });
  }
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM team_collection_tasks').get().n, 8);
});

test('query identity/role overrides, duplicate controls, malformed and oversized controls are rejected', async t => {
  const f = fixture(t);
  for (const query of ['role=partner', 'userId=a-partner', 'tenantId=team-b', 'fields=*', 'include=project',
    'limit=0', 'limit=101', 'limit=-1', 'limit=1.5', 'limit=1e2', 'limit=abc', 'limit=1&limit=2',
    'q=a&q=b', 'q=' + 'x'.repeat(101), 'after=x%27%20OR%201%3D1', 'after=a&after=b']) {
    const r = await call(f, req('/tasks?' + query));
    assert.equal(r.response.status, 400, query); privateResponse(r);
  }
  for (const route of ['/summary?role=partner', '/tasks/task-intern?fields=*']) {
    const r = await call(f, req(route)); assert.equal(r.response.status, 400); privateResponse(r);
  }
});

test('forged identity headers cannot expand a valid intern session', async t => {
  const f = fixture(t);
  const r = await call(f, req('/tasks', 'a-intern', { headers: {
    'x-chatgpt-user-id': 'b-partner', 'x-user-id': 'a-partner', 'x-team-id': 'team-b', 'x-role': 'partner',
  } }));
  assert.equal(r.response.status, 200); privateResponse(r);
  assert.deepEqual(r.json, { tasks: [expectedTask('a', 'intern')], hasMore: false });
});

test('task visibility alone never authorizes an original attachment, for any role', async t => {
  const f = fixture(t);
  for (const role of ROLES) {
    const r = await call(f, req('/tasks/task-' + role + '/attachments/file-' + role, 'a-' + role));
    assert.equal(r.response.status, 404); privateResponse(r);
    assert.ok(!r.raw.includes('private original'));
    assert.ok(!r.raw.includes('ORIGINAL_'));
  }
});

test('attachment access requires both exact task scope and exact user/tenant attachment grant', async t => {
  const f = fixture(t);
  f.run('INSERT INTO team_attachment_grants(team_id,attachment_id,user_id,status) VALUES (?,?,?,?)', 'team-a', 'file-intern', 'a-intern', 'active');
  const allowed = await call(f, req('/tasks/task-intern/attachments/file-intern'));
  assert.equal(allowed.response.status, 200); privateResponse(allowed);
  assert.equal(allowed.response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(allowed.raw, 'ORIGINAL_a_intern');
  for (const request of [req('/tasks/task-assistant/attachments/file-intern'),
    req('/tasks/task-intern/attachments/file-intern', 'a-assistant'),
    req('/tasks/task-intern/attachments/file-intern', 'a-intern', { team: 'team-b' })]) {
    const denied = await call(f, request); assert.equal(denied.response.status, 404); privateResponse(denied);
    assert.ok(!denied.raw.includes('ORIGINAL_'));
  }
  // An attachment grant cannot rescue a task the user was never assigned.
  f.run('INSERT INTO team_attachment_grants(team_id,attachment_id,user_id,status) VALUES (?,?,?,?)', 'team-a', 'file-partner', 'a-intern', 'active');
  assert.equal((await call(f, req('/tasks/task-partner/attachments/file-partner'))).response.status, 404);
});

test('assignment, project grant, role and attachment revocation apply on the next request', async t => {
  const f = fixture(t);
  f.run('INSERT INTO team_attachment_grants(team_id,attachment_id,user_id,status) VALUES (?,?,?,?)', 'team-a', 'file-intern', 'a-intern', 'active');
  assert.equal((await call(f, req('/tasks/task-intern/attachments/file-intern'))).response.status, 200);
  f.run('UPDATE team_attachment_grants SET status=? WHERE team_id=? AND attachment_id=? AND user_id=?', 'revoked', 'team-a', 'file-intern', 'a-intern');
  assert.equal((await call(f, req('/tasks/task-intern/attachments/file-intern'))).response.status, 404);
  f.run('UPDATE team_task_assignments SET status=? WHERE team_id=? AND task_id=? AND user_id=?', 'revoked', 'team-a', 'task-intern', 'a-intern');
  assert.equal((await call(f, req('/tasks/task-intern'))).response.status, 404);
  assert.deepEqual((await call(f, req('/summary'))).json, { taskCount: 0 });
  f.run('INSERT INTO team_project_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,?)', 'team-a', 'project-shared', 'a-manager', 'collection.read', 'active');
  assert.equal((await call(f, req('/tasks/task-assistant', 'a-manager'))).response.status, 200);
  f.run('UPDATE team_memberships SET role=? WHERE team_id=? AND user_id=?', 'assistant', 'team-a', 'a-manager');
  assert.equal((await call(f, req('/tasks/task-assistant', 'a-manager'))).response.status, 404);
  f.run('UPDATE team_memberships SET role=? WHERE team_id=? AND user_id=?', 'manager', 'team-a', 'a-manager');
  f.run('UPDATE team_project_grants SET status=? WHERE team_id=? AND user_id=?', 'revoked', 'team-a', 'a-manager');
  assert.equal((await call(f, req('/tasks/task-assistant', 'a-manager'))).response.status, 404);
});

test('unknown routes, whole structure, export, history and administration surfaces deny by default', async t => {
  const f = fixture(t);
  for (const role of ROLES) for (const route of ['/projects', '/tree', '/export', '/tasks/export/all', '/history', '/users', '/reports', '/billing', '/tasks/task-intern/preview']) {
    const r = await call(f, req(route, 'a-' + role)); assert.equal(r.response.status, 404, role + route); privateResponse(r);
  }
});

test('write verbs and body role injection never modify the read-only prototype', async t => {
  const f = fixture(t);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    const r = await call(f, req('/tasks/task-intern', 'a-intern', {
      method, ...(method === 'HEAD' ? {} : { body: JSON.stringify({ role: 'partner', userId: 'a-partner', teamId: 'team-b' }) }),
    }));
    assert.equal(r.response.status, 405, method); privateResponse(r);
    assert.equal(r.response.headers.get('allow'), 'GET');
  }
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM team_collection_tasks').get().n, 8);
});

test('malformed resource identifiers and encoded separators cannot escape routing or leak structure', async t => {
  const f = fixture(t);
  for (const route of ['/tasks/%27%20OR%201%3D1', '/tasks/task-intern%2Fattachments%2Ffile-intern',
    '/tasks/%00', '/tasks/%ZZ', '/tasks/' + 'x'.repeat(129), '/tasks//task-intern', '/tasks/task-intern/']) {
    const r = await call(f, req(route)); assert.ok([400, 404].includes(r.response.status), route); privateResponse(r);
  }
});

test('database failure is a generic private service error, never SQL, credentials or provider details', async t => {
  const f = fixture(t);
  const maliciousError = 'SQL SELECT token_hash FROM team_sessions; provider_password=DO_NOT_EXPOSE';
  const r = await call(f, req(), { db: { prepare() { throw new Error(maliciousError); } } });
  assert.equal(r.response.status, 503); privateResponse(r);
  assert.ok(!r.raw.includes('SQL'));
  assert.ok(!r.raw.includes('provider_password'));
  assert.ok(!r.raw.includes('team_sessions'));
});

test('frozen projects retain authorized reads; archived projects stop all collection data exits', async t => {
  const f = fixture(t);
  f.run('INSERT INTO team_attachment_grants(team_id,attachment_id,user_id,status) VALUES (?,?,?,?)', 'team-a', 'file-intern', 'a-intern', 'active');
  f.run('UPDATE team_projects SET status=? WHERE team_id=? AND project_id=?', 'frozen', 'team-a', 'project-shared');
  assert.equal((await call(f, req('/tasks/task-intern'))).response.status, 200);
  assert.equal((await call(f, req('/tasks/task-intern/attachments/file-intern'))).response.status, 200);
  f.run('UPDATE team_projects SET status=? WHERE team_id=? AND project_id=?', 'archived', 'team-a', 'project-shared');
  assert.deepEqual((await call(f, req('/tasks'))).json, { tasks: [], hasMore: false });
  assert.deepEqual((await call(f, req('/summary'))).json, { taskCount: 0 });
  assert.equal((await call(f, req('/tasks/task-intern'))).response.status, 404);
  assert.equal((await call(f, req('/tasks/task-intern/attachments/file-intern'))).response.status, 404);
});

test('default list cap and hasMore are computed after scope, not from other users or teams', async t => {
  const f = fixture(t);
  for (let i = 0; i < 101; i++) {
    const id = 'bulk-' + String(i).padStart(3, '0');
    f.run('INSERT INTO team_collection_tasks(team_id,task_id,project_id,title,instructions,status) VALUES (?,?,?,?,?,?)', 'team-a', id, 'project-shared', 'Synthetic item ' + i, 'Minimal collection instruction', 'open');
    f.run('INSERT INTO team_task_assignments(team_id,task_id,user_id,status) VALUES (?,?,?,?)', 'team-a', id, 'a-assistant', 'active');
  }
  const intern = await call(f, req('/tasks'));
  assert.deepEqual(intern.json, { tasks: [expectedTask('a', 'intern')], hasMore: false });
  const assistant = await call(f, req('/tasks', 'a-assistant'));
  assert.equal(assistant.response.status, 200); privateResponse(assistant);
  assert.equal(assistant.json.tasks.length, 100);
  assert.equal(assistant.json.hasMore, true);
  assert.deepEqual((await call(f, req('/summary', 'a-assistant'))).json, { taskCount: 102 });
  const tail = await call(f, req('/tasks?after=bulk-099', 'a-assistant'));
  assert.deepEqual(tail.json.tasks.map(x => x.id), ['bulk-100', 'task-assistant']);
  assert.equal(tail.json.hasMore, false);
});

test('cross-site fetch is denied and an invalid trusted clock fails closed', async t => {
  const f = fixture(t);
  const crossSite = await call(f, req('/tasks', 'a-intern', { headers: { 'Sec-Fetch-Site': 'cross-site' } }));
  assert.equal(crossSite.response.status, 403); privateResponse(crossSite);
  for (const at of [NaN, Infinity, -1, '2026-11-15', 1.5]) {
    const r = await call(f, req(), { now: () => at });
    assert.equal(r.response.status, 503); privateResponse(r);
  }
});

test('authorized download retains a valid filename when the length boundary meets a Unicode surrogate pair', async t => {
  const f = fixture(t);
  f.run('UPDATE team_collection_attachments SET display_name=? WHERE team_id=? AND attachment_id=?',
    'a'.repeat(179) + '😀.txt', 'team-a', 'file-intern');
  f.run('INSERT INTO team_attachment_grants(team_id,attachment_id,user_id,status) VALUES (?,?,?,?)',
    'team-a', 'file-intern', 'a-intern', 'active');
  const r = await call(f, req('/tasks/task-intern/attachments/file-intern'));
  assert.equal(r.response.status, 200); privateResponse(r);
  assert.equal(r.response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(r.raw, 'ORIGINAL_a_intern');
  const disposition = r.response.headers.get('content-disposition');
  assert.match(disposition || '', /^attachment; filename="download\.bin"; filename\*=UTF-8''/);
  const encoded = disposition.split("filename*=UTF-8''")[1];
  assert.doesNotThrow(() => decodeURIComponent(encoded));
  assert.ok(!/[\r\n]/.test(disposition));
});
