'use strict';
const {ledgerOldChannelNames}=require('./helpers/ledger-check-entry-layer.cjs');
// Independent acceptance using the real client, main bridge, application API and
// isolated SQLite. Login adoption uses explicitly issued synthetic sessions.
// The picker is a deterministic synthetic dialog: this is NOT OS-picker proof,
// real login, provider, Mac, device binding, customer-data or production proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {createTeamClient} = require('../desktop/team-client.cjs');
const {registerDesktopBridge, APP_URL} = require('../desktop/bridge.cjs');
const source = name => import(pathToFileURL(path.resolve(__dirname, '../server/team/' + name)).href);
const NOW = Date.parse('2026-11-15T10:00:00Z');
const ORIGIN = 'http://127.0.0.1:8774';
const TASK = '/api/teams/team-a/collection/tasks/task-a';
const INPUT = {teamId:'team-a', taskId:'task-a', revision:0};
const ROOT = 'D:/codex-temp/shenyi-upload-preflight-20261115/security-fixtures';
const BYTES = Buffer.from([0, 255, 128, 13, 10, 65, 228, 184, 173, 0]);
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const json = (value, status=200) => new Response(JSON.stringify(value), {status, headers:{'Content-Type':'application/json'}});
let baseline;

async function fixture(t, actor='intern-a') {
  baseline ||= (async () => {
    const {initializeTeamDatabase, seedDemoTeamData} = await source('database.mjs');
    const db = new DatabaseSync(':memory:');
    try {
      initializeTeamDatabase(db);
      await seedDemoTeamData(db);
      return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all()
        .map(({name}) => ({name, rows:db.prepare('SELECT * FROM ' + quote(name)).all()}));
    } finally { db.close(); }
  })();
  const {initializeTeamDatabase} = await source('database.mjs');
  const {issueSession} = await source('auth-api.mjs');
  const {handleTeamApplicationRequest} = await source('application-api.mjs');
  const db = new DatabaseSync(':memory:');
  initializeTeamDatabase(db);
  db.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');
  try {
    for (const {name, rows} of await baseline) for (const row of rows) {
      const keys = Object.keys(row);
      db.prepare('INSERT OR REPLACE INTO ' + quote(name) + '(' + keys.map(quote).join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')').run(...Object.values(row));
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  await fs.mkdir(ROOT, {recursive:true});
  const directory = await fs.mkdtemp(path.join(ROOT, 'synthetic-'));
  const selectedPath = path.join(directory, '合成原件.bin');
  await fs.writeFile(selectedPath, BYTES);
  const calls = {cap:0, dialog:0, open:0, reads:0, post:0, routes:[]};
  const f = {db, calls, selectedPath, beforeRequest:null, afterResponse:null, inDialog:null, onRead:null, canceled:false};
  const fetchImpl = async (url, options) => {
    const request = new Request(url, options), route = new URL(url).pathname;
    if (route === '/api/auth/login') {
      const {username} = await request.json();
      return json(issueSession(db, username, NOW));
    }
    calls.routes.push({method:request.method, route});
    if (route.endsWith('/submission-access')) calls.cap++;
    if (route.endsWith('/submissions') && request.method === 'POST') calls.post++;
    await f.beforeRequest?.(request);
    const response = await handleTeamApplicationRequest(request, {db, now:() => NOW});
    return await f.afterResponse?.(request, response) || response;
  };
  const client = createTeamClient({fetchImpl, now:() => NOW});
  f.client = client;
  const handlers = new Map(), mainFrame = {url:APP_URL}, window = {webContents:{mainFrame}};
  const event = {sender:window.webContents, senderFrame:mainFrame};
  const dispose = registerDesktopBridge({
    ipcMain:{handle:(name, action) => handlers.set(name, action), removeHandler:name => handlers.delete(name)}, window, client,
    dialog:{showOpenDialog:async () => {
      calls.dialog++;
      await f.inDialog?.();
      return f.canceled ? {canceled:true, filePaths:[]} : {canceled:false, filePaths:[selectedPath]};
    }},
  });
  f.handlers = handlers;
  f.call = (name, arg, sender=event) => handlers.get('shenyi:' + name)(sender, arg);
  f.upload = (arg=INPUT) => f.call('upload', arg);
  f.raw = async (route, currentActor=actor, method='GET', body) => {
    const {token} = issueSession(db, currentActor, NOW);
    const response = await handleTeamApplicationRequest(new Request(ORIGIN + route, {
      method, headers:{Origin:'shenyi://app', Authorization:'Bearer ' + token, 'Content-Type':'application/json'},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),
    }), {db, now:() => NOW});
    return {status:response.status, value:await response.json()};
  };
  const originalOpen = fs.open;
  fs.open = async (...args) => {
    calls.open++;
    const handle = await originalOpen(...args), originalRead = handle.read.bind(handle);
    handle.read = async (...readArgs) => {
      calls.reads++;
      const result = await originalRead(...readArgs);
      await f.onRead?.(result);
      return result;
    };
    return handle;
  };
  t.after(async () => {
    fs.open = originalOpen;
    dispose();
    db.close();
    if (!path.resolve(directory).startsWith(path.resolve(ROOT) + path.sep)) throw Error('Refuse cleanup outside synthetic fixture root');
    await fs.rm(directory, {recursive:true, force:true});
  });
  await client.login({username:actor, password:'synthetic-session-adoption'});
  return f;
}

function business(f) {
  return ['team_task_assignments', 'team_task_versions', 'team_collection_tasks', 'team_collection_attachments', 'team_task_submissions', 'team_attachment_grants', 'team_activity']
    .map(name => ({name, rows:f.db.prepare('SELECT * FROM ' + quote(name)).all()}));
}
function noSubmission(f) {
  for (const name of ['team_collection_attachments', 'team_task_submissions', 'team_attachment_grants', 'team_activity']) assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM ' + name).get().n, 0, name);
}
function denied(result) { assert.equal(result.ok, false, JSON.stringify(result)); assert.ok(result.error?.code); }
function noFileTransport(f) { assert.equal(f.calls.open, 0); assert.equal(f.calls.reads, 0); assert.equal(f.calls.post, 0); noSubmission(f); }
function revoke(f) { f.db.prepare("UPDATE team_task_assignments SET status='revoked' WHERE team_id='team-a' AND task_id='task-a' AND user_id='intern-a'").run(); }
function revision(f, value) { f.db.prepare("INSERT INTO team_task_versions VALUES ('team-a','task-a',?) ON CONFLICT(team_id,task_id) DO UPDATE SET revision=excluded.revision").run(value); }

test('read-only manager cannot force the narrow upload RPC to open, read or post', async t => {
  const f = await fixture(t, 'manager-a');
  f.db.prepare("DELETE FROM team_project_grants WHERE user_id='manager-a' AND permission='collection.manage'").run();
  const before = business(f);
  assert.deepEqual(await f.client.getTaskSubmissionAccess({teamId:'team-a', taskId:'task-a'}), {canSubmit:false, revision:0});
  denied(await f.upload());
  assert.equal(f.calls.dialog, 0); noFileTransport(f); assert.deepEqual(business(f), before);
});

test('manager management permission cannot substitute for an active assignment', async t => {
  const f = await fixture(t, 'manager-a');
  const before = business(f);
  denied(await f.upload()); assert.equal(f.calls.dialog, 0); noFileTransport(f); assert.deepEqual(business(f), before);
});

test('an intern with mistaken read/manage grants still cannot substitute grants for assignment', async t => {
  const f = await fixture(t);
  revoke(f);
  for (const permission of ['collection.read', 'collection.manage']) f.db.prepare('INSERT INTO team_project_grants VALUES (?,?,?,?,?)').run('team-a', 'project-a', 'intern-a', permission, 'active');
  const before = business(f);
  const result = await f.upload(); denied(result); assert.equal(result.error.code, 'HTTP_404');
  assert.equal(f.calls.dialog, 0); noFileTransport(f); assert.deepEqual(business(f), before);
});

test('foreign and nonexistent task capabilities are indistinguishable and do not leak structure', async t => {
  const f = await fixture(t);
  const foreign = await f.raw('/api/teams/team-b/collection/tasks/task-a/submission-access');
  const unknown = await f.raw('/api/teams/team-a/collection/tasks/no-such-task/submission-access');
  assert.equal(foreign.status, 404); assert.deepEqual(foreign, unknown);
  for (const arg of [{teamId:'team-b', taskId:'task-a', revision:0}, {teamId:'team-a', taskId:'no-such-task', revision:0}]) denied(await f.upload(arg));
  assert.equal(f.calls.dialog, 0); noFileTransport(f);
});

for (const [label, mutate, expected] of [
  ['assignment revoked', revoke, 'HTTP_404'],
  ['account disabled', f => f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='intern-a'").run(), 'SIGN_IN_REQUIRED'],
  ['project frozen', f => f.db.prepare("UPDATE team_projects SET status='frozen' WHERE team_id='team-a' AND project_id='project-a'").run(), null],
  ['version changed', f => revision(f, 7), 'HTTP_409'],
  ['task closed', f => f.db.prepare("UPDATE team_collection_tasks SET status='closed' WHERE team_id='team-a' AND task_id='task-a'").run(), null],
]) test('fresh check after synthetic dialog rejects ' + label + ' before opening the file', async t => {
  const f = await fixture(t);
  let afterMutation;
  f.inDialog = () => { mutate(f); afterMutation = business(f); };
  const result = await f.upload(); denied(result);
  if (expected) assert.equal(result.error.code, expected);
  assert.equal(f.calls.dialog, 1); assert.equal(f.calls.cap, 2); noFileTransport(f); assert.deepEqual(business(f), afterMutation);
});

test('stale displayed revision is rejected before the picker, file read and post', async t => {
  const f = await fixture(t);
  revision(f, 2);
  const before = business(f), result = await f.upload(); denied(result); assert.equal(result.error.code, 'HTTP_409');
  assert.equal(f.calls.dialog, 0); noFileTransport(f); assert.deepEqual(business(f), before);
});

test('synthetic dialog cancellation performs no file read and no submission', async t => {
  const f = await fixture(t);
  f.canceled = true;
  const before = business(f);
  assert.deepEqual(await f.upload(), {ok:true, value:{canceled:true}});
  assert.equal(f.calls.cap, 1); assert.equal(f.calls.dialog, 1); noFileTransport(f); assert.deepEqual(business(f), before);
});

for (const [label, mutate, expected] of [
  ['assignment revoked', revoke, 'HTTP_404'],
  ['project frozen', f => f.db.prepare("UPDATE team_projects SET status='frozen' WHERE team_id='team-a'").run(), null],
  ['version changed', f => revision(f, 4), 'HTTP_409'],
  ['account disabled', f => f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='intern-a'").run(), 'SIGN_IN_REQUIRED'],
]) test('third fresh check stops upload transport when ' + label + ' during file read', async t => {
  const f = await fixture(t);
  let afterMutation, fired = false;
  f.onRead = ({bytesRead}) => { if (bytesRead && !fired) { fired = true; mutate(f); afterMutation = business(f); } };
  const result = await f.upload(); denied(result); if (expected) assert.equal(result.error.code, expected);
  assert.equal(fired, true); assert.equal(f.calls.open, 1); assert.ok(f.calls.reads >= 1); assert.equal(f.calls.cap, 3);
  assert.equal(f.calls.post, 0); noSubmission(f); assert.deepEqual(business(f), afterMutation);
});

test('changing session generation in the dialog rejects the old selection and preserves the new actor', async t => {
  const f = await fixture(t);
  const before = business(f);
  f.inDialog = () => f.client.login({username:'assistant-a', password:'synthetic-session-adoption'});
  const result = await f.upload(); denied(result); assert.equal(result.error.code, 'SESSION_CHANGED');
  assert.equal((await f.client.getSession()).account.id, 'assistant-a');
  assert.equal(f.calls.cap, 1); noFileTransport(f); assert.deepEqual(business(f), before);
});

test('changing session generation during read rejects old bytes without invoking upload transport', async t => {
  const f = await fixture(t);
  const before = business(f); let fired = false;
  f.onRead = async ({bytesRead}) => { if (bytesRead && !fired) { fired = true; await f.client.login({username:'assistant-a', password:'synthetic-session-adoption'}); } };
  const result = await f.upload(); denied(result); assert.equal(result.error.code, 'SESSION_CHANGED');
  assert.equal((await f.client.getSession()).account.id, 'assistant-a');
  assert.equal(f.calls.open, 1); assert.equal(f.calls.cap, 2); assert.equal(f.calls.post, 0); noSubmission(f); assert.deepEqual(business(f), before);
});

for (const [label, mutate, expected] of [
  ['assignment revoked', revoke, 'HTTP_404'],
  ['version changed', f => revision(f, 9), 'HTTP_409'],
  ['project frozen', f => f.db.prepare("UPDATE team_projects SET status='frozen' WHERE team_id='team-a'").run(), 'HTTP_409'],
]) test('three successful capabilities do not bypass final server checks when ' + label + ' immediately before POST', async t => {
  const f = await fixture(t); let afterMutation;
  f.beforeRequest = request => { if (request.method === 'POST' && new URL(request.url).pathname === TASK + '/submissions') { mutate(f); afterMutation = business(f); } };
  const result = await f.upload(); denied(result); assert.equal(result.error.code, expected);
  assert.equal(f.calls.cap, 3); assert.equal(f.calls.dialog, 1); assert.equal(f.calls.open, 1); assert.equal(f.calls.post, 1);
  noSubmission(f); assert.deepEqual(business(f), afterMutation);
});

test('assigned low-role upload retains original file name, exact bytes, digest and readable history', async t => {
  const f = await fixture(t), result = await f.upload();
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.value.revision, 1);
  const submission = result.value.submission;
  assert.equal(submission.filename, '合成原件.bin'); assert.equal(submission.byteLength, BYTES.length);
  assert.equal(submission.sha256, createHash('sha256').update(BYTES).digest('hex'));
  assert.equal(f.calls.cap, 3); assert.equal(f.calls.open, 1); assert.equal(f.calls.post, 1);
  const history = await f.client.getSubmissions({teamId:'team-a', taskId:'task-a'});
  assert.equal(history.revision, 1); assert.deepEqual(history.submissions, [submission]);
  const file = await f.client.download({teamId:'team-a', taskId:'task-a', attachmentId:submission.attachmentId});
  assert.deepEqual(Buffer.from(file.bytes), BYTES);
  assert.equal(JSON.stringify(result).includes(f.selectedPath), false);
});

test('legitimate preexisting manager assignment is retained without role-based upload removal', async t => {
  const f = await fixture(t, 'manager-a');
  f.db.prepare('INSERT INTO team_task_assignments VALUES (?,?,?,?)').run('team-a', 'task-a', 'manager-a', 'active');
  const result = await f.upload(); assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(f.calls.cap, 3); assert.equal(f.calls.post, 1); assert.equal(result.value.submission.sha256, createHash('sha256').update(BYTES).digest('hex'));
});

test('capability RPC is fixed, rejects identity/role/path injection and has exactly 64 channels', async t => {
  const f = await fixture(t);
  assert.equal(ledgerOldChannelNames(f.handlers).length,123);
  const count = f.calls.routes.length;
  for (const extra of [{userId:'intern-a'}, {role:'partner'}, {url:'https://provider-secret.invalid'}, {path:f.selectedPath}, {revision:0}]) {
    await assert.rejects(() => f.client.getTaskSubmissionAccess({teamId:'team-a', taskId:'task-a', ...extra}), error => error.code === 'INVALID_INPUT');
  }
  assert.equal(f.calls.routes.length, count); assert.equal(f.calls.dialog, 0); noFileTransport(f);
  const value = await f.client.getTaskSubmissionAccess({teamId:'team-a', taskId:'task-a'});
  assert.deepEqual(value, {canSubmit:true, revision:0});
  assert.deepEqual(f.calls.routes.at(-1), {method:'GET', route:TASK + '/submission-access'});
  for (const extra of [{userId:'intern-a'}, {role:'partner'}, {url:'https://provider-secret.invalid'}, {path:f.selectedPath}, {revision:0}]) {
    denied(await f.call('task-submission-access', {teamId:'team-a', taskId:'task-a', ...extra}));
  }
  assert.equal(f.calls.routes.length, count + 1);
  assert.deepEqual(await f.call('task-submission-access', {teamId:'team-a', taskId:'task-a'}), {ok:true, value:{canSubmit:true, revision:0}});
});

test('capability failures never echo provider bodies or a main-process selected path', async t => {
  const f = await fixture(t);
  const secret = 'PROVIDER_PRIVATE_BODY D:/private/client-ledger.sqlite';
  f.afterResponse = request => new URL(request.url).pathname.endsWith('/submission-access') ? json({error:{message:secret, stack:secret}}, 503) : null;
  const result = await f.upload(); denied(result); assert.equal(result.error.code, 'HTTP_503');
  assert.equal(JSON.stringify(result).includes(secret), false); assert.equal(f.calls.dialog, 0); noFileTransport(f);
});

test('malformed capability cannot open the picker even when truthy or revision coercible', async t => {
  const f = await fixture(t);
  for (const value of [{canSubmit:'true', revision:0}, {canSubmit:true, revision:'0'}, {canSubmit:true, revision:-1}, {canSubmit:true, revision:Number.MAX_SAFE_INTEGER + 1}]) {
    f.afterResponse = request => new URL(request.url).pathname.endsWith('/submission-access') ? json(value) : null;
    const result = await f.upload(); denied(result); assert.equal(result.error.code, 'INVALID_RESPONSE');
  }
  assert.equal(f.calls.dialog, 0); noFileTransport(f);
});

test('side-effect-free capability projects away unrelated response fields', async t => {
  const f = await fixture(t), before = business(f);
  f.afterResponse = request => new URL(request.url).pathname.endsWith('/submission-access') ? json({canSubmit:true, revision:0, project:'private', userId:'private', path:f.selectedPath}) : null;
  assert.deepEqual(await f.client.getTaskSubmissionAccess({teamId:'team-a', taskId:'task-a'}), {canSubmit:true, revision:0});
  assert.deepEqual(business(f), before); assert.equal(f.calls.dialog, 0); noFileTransport(f);
});

test('an untrusted renderer cannot query the new capability or trigger an upload', async t => {
  const f = await fixture(t), before = business(f);
  const result = await f.call('task-submission-access', {teamId:'team-a', taskId:'task-a'}, {sender:{}, senderFrame:{url:APP_URL}});
  assert.equal(result.error.code, 'UNTRUSTED_SENDER');
  const upload = await f.call('upload', INPUT, {sender:{}, senderFrame:{url:APP_URL}});
  assert.equal(upload.error.code, 'UNTRUSTED_SENDER');
  assert.equal(f.calls.cap, 0); assert.equal(f.calls.dialog, 0); noFileTransport(f); assert.deepEqual(business(f), before);
});

test('a selected-file filesystem failure never reveals the chosen local path', async t => {
  const f = await fixture(t), before = business(f);
  f.inDialog = () => fs.unlink(f.selectedPath);
  const result = await f.upload(); denied(result); assert.equal(result.error.code, 'OPERATION_FAILED');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(f.selectedPath), false); assert.equal(serialized.includes(path.basename(f.selectedPath)), false);
  assert.equal(f.calls.cap, 2); assert.equal(f.calls.open, 1); assert.equal(f.calls.reads, 0); assert.equal(f.calls.post, 0);
  noSubmission(f); assert.deepEqual(business(f), before);
});

for (const phase of [1, 2, 3]) test('session generation change while fresh capability #' + phase + ' resolves cannot continue the old operation', async t => {
  const f = await fixture(t), before = business(f); let changed = false;
  f.afterResponse = async (request, response) => {
    if (!changed && new URL(request.url).pathname.endsWith('/submission-access') && f.calls.cap === phase) {
      changed = true;
      await f.client.login({username:'assistant-a', password:'synthetic-session-adoption'});
    }
    return response;
  };
  const result = await f.upload(); denied(result); assert.equal(result.error.code, 'SESSION_CHANGED');
  assert.equal(changed, true); assert.equal(f.calls.cap, phase); assert.equal(f.calls.dialog, phase === 1 ? 0 : 1);
  assert.equal(f.calls.open, phase === 3 ? 1 : 0); assert.equal(f.calls.post, 0);
  assert.equal((await f.client.getSession()).account.id, 'assistant-a'); noSubmission(f); assert.deepEqual(business(f), before);
});
