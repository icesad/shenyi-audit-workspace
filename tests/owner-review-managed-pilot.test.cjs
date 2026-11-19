'use strict';

const assert = require('node:assert/strict');
const {randomBytes, sign} = require('node:crypto');
const fs = require('node:fs/promises');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {test} = require('node:test');
const {OWNER_REVIEW_RUNTIME_MARKER, loadOwnerReviewManagedPilotConfiguration} = require('../desktop/isolated-preview-config.cjs');
const proof = require('../shared/device-proof.cjs');
const {digest, keyPair} = require('./helpers/business-role-fixture.cjs');

const windows = {skip: process.platform !== 'win32' || process.arch !== 'x64'};
const badCertificate = error => /^(?:DEPTH_|CERT_|UNABLE_|SELF_SIGNED_|ERR_TLS_)/.test(error?.code);

async function packageFixture(t, {longAppDataPath = false} = {}) {
  const parent = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-owner-managed-test-'));
  const appRoot = path.join(parent, "review 'package !");
  const localAppData = path.join(parent, 'local-app-data');
  const appData = longAppDataPath && localAppData.length < 176
    ? localAppData + '-' + 'x'.repeat(176 - localAppData.length - 1)
    : localAppData;
  const previousAppData = process.env.LOCALAPPDATA;
  const runs = [];
  t.after(async () => {
    if (previousAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousAppData;
    const closed = await Promise.allSettled(runs.map(run => run.close()));
    for (const result of closed) assert.equal(result.status, 'fulfilled');
    assert.equal(path.relative(parent, await fs.realpath(parent)), '');
    await fs.rm(parent, {recursive: true, force: true});
  });
  await fs.mkdir(path.join(appRoot, 'runtime', 'electron'), {recursive: true});
  await fs.mkdir(appData);
  process.env.LOCALAPPDATA = appData;
  await fs.writeFile(path.join(appRoot, 'runtime', 'electron', 'electron.exe'), 'non-executable test fixture');
  return {appRoot, appData, runs};
}

function request(url, ca, {method = 'GET', headers, body} = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = https.request(url, {ca, agent: false, method, headers}, response => {
      const chunks = [];
      const authorized = response.socket.authorized;
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.once('end', () => resolve({status: response.statusCode, headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8'), authorized}));
    });
    outgoing.once('error', reject);
    outgoing.setTimeout(5000, () => outgoing.destroy(new Error('The owned HTTPS listener did not respond.')));
    outgoing.end(body);
  });
}

const get = (url, ca) => request(url, ca);

test('managed pilot refuses an unpackaged runtime before allocating review files', windows, async t => {
  const {appRoot, appData} = await packageFixture(t);
  const {createOwnerReviewManagedPilot} = await import('../scripts/owner-review-managed-pilot-service.mjs');
  await assert.rejects(createOwnerReviewManagedPilot({appRoot, onVerificationCode: () => assert.fail('Unexpected code')}));
  assert.deepEqual(await fs.readdir(appData), []);
  await fs.writeFile(path.join(appRoot, 'owner-review-runtime.json'), OWNER_REVIEW_RUNTIME_MARKER);
  process.env.LOCALAPPDATA = appRoot;
  await assert.rejects(createOwnerReviewManagedPilot({appRoot, onVerificationCode: () => assert.fail('Unexpected code')}));
  assert.deepEqual((await fs.readdir(appRoot)).sort(), ['owner-review-runtime.json', 'runtime']);
});

test('simultaneous managed reviews own separate listeners, credentials and databases with long Windows paths', windows, async t => {
  const {appRoot, appData, runs} = await packageFixture(t, {longAppDataPath: true});
  await fs.writeFile(path.join(appRoot, 'owner-review-runtime.json'), OWNER_REVIEW_RUNTIME_MARKER);
  const {createOwnerReviewManagedPilot} = await import('../scripts/owner-review-managed-pilot-service.mjs');
  let syntheticMessages = 0;
  const onVerificationCode = () => { syntheticMessages++; };
  const pending = () => createOwnerReviewManagedPilot({appRoot, onVerificationCode}).then(run => { runs.push(run); return run; });
  const settled = await Promise.allSettled([pending(), pending()]);
  const [first, second] = settled.map(result => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
  assert.notEqual(first.directory, second.directory);
  assert.notEqual(first.profile.serverId, second.profile.serverId);
  assert.notEqual(first.address.url, second.address.url);
  assert.notEqual(first.credentials.ownerPassword, second.credentials.ownerPassword);
  assert.equal(syntheticMessages, 0);
  const firstCa = await fs.readFile(first.caFile);
  const secondCa = await fs.readFile(second.caFile);
  assert.notDeepEqual(firstCa, secondCa);

  for (const [run, ca] of [[first, firstCa], [second, secondCa]]) {
    assert.equal(path.dirname(run.directory), path.join(appData, 'ShenyiManagedPilotReview'));
    assert.equal(path.dirname(run.desktopDataDirectory), run.directory);
    assert.equal(run.deviceVaultDirectory, path.join(run.directory, 'local-app-data', 'ShenyiTeamPreview', 'device-vault'));
    assert.equal(run.address.host, '127.0.0.1');
    assert.equal(run.address.url, run.profile.apiBase);
    assert.match(run.address.url, /^https:\/\/127\.0\.0\.1:\d+$/);
    const ready = await get(run.address.url+'/ready', ca);
    assert.equal(ready.status, 200);
    assert.equal(ready.authorized, true);
    const methods = await get(run.address.url+'/api/auth/methods', ca);
    assert.equal(methods.status, 200);
    assert.equal(methods.headers['x-shenyi-server-id'], run.profile.serverId);
    const {mode, methods: auth, deviceBinding} = JSON.parse(methods.text);
    assert.equal(mode, 'managed-service');
    assert.equal(auth.demoUsername, false);
    assert.equal(auth.phoneVerification, true);
    assert.equal(auth.wechat, false);
    assert.deepEqual(deviceBinding, {required: true, serverId: run.profile.serverId, protocolVersion: 1});
    const env = {
      SHENYI_OWNER_REVIEW_MANAGED_PILOT: '1', SHENYI_TEAM_SERVICE_CONFIG: run.configFile,
      SHENYI_DESKTOP_DATA_DIR: run.desktopDataDirectory, NODE_EXTRA_CA_CERTS: run.caFile,
      LOCALAPPDATA: path.join(run.directory, 'local-app-data'), APPDATA: path.join(run.directory, 'roaming-app-data'),
      TEMP: path.join(run.directory, 'temp'),
    };
    env.TMP = env.TMPDIR = env.TEMP;
    for (const directory of [env.LOCALAPPDATA, env.APPDATA, env.TEMP]) await fs.mkdir(directory);
    const options = {appRoot, env, userDataDirectory: run.desktopDataDirectory, profile: run.profile};
    const context = await loadOwnerReviewManagedPilotConfiguration(options);
    assert.equal(context.desktopDataDirectory, run.desktopDataDirectory);
    assert.equal(context.deviceVaultDirectory, run.deviceVaultDirectory);
    const reject = {code: 'ISOLATED_PREVIEW_CONFIGURATION_INVALID'};
    for (const conflict of [{SHENYI_OWNER_REVIEW_WEBSITE_CHECKOUT: '1'}, {SHENYI_ISOLATED_PREVIEW_CONFIG: 'other'},
      {NODE_TLS_REJECT_UNAUTHORIZED: '0'}, {NODE_EXTRA_CA_CERTS: run === first ? second.caFile : first.caFile},
      {LOCALAPPDATA: appData}]) {
      await assert.rejects(loadOwnerReviewManagedPilotConfiguration({...options, env: {...env, ...conflict}}), reject);
    }
    await assert.rejects(loadOwnerReviewManagedPilotConfiguration({...options, isPackaged: true}), reject);
    await assert.rejects(loadOwnerReviewManagedPilotConfiguration({...options, userDataDirectory: appData}), reject);
    await assert.rejects(loadOwnerReviewManagedPilotConfiguration({...options, profile: run === first ? second.profile : first.profile}), reject);
    const started = await fs.readFile(path.join(run.directory, 'started.json'), 'utf8');
    assert.equal(started.includes(run.credentials.ownerPassword), false);
    const {databasePath} = JSON.parse(started);
    assert.equal(path.relative(run.directory, databasePath).startsWith('..'), false);
    assert.equal(databasePath, run.databasePath);
    assert.ok(databasePath.length >= 260);
    assert.match(databasePath, /^[a-z]:\\/i);
    assert.deepEqual(await fs.readdir(path.dirname(databasePath)), ['team.sqlite']);
    const db = new DatabaseSync(path.toNamespacedPath(databasePath), {readOnly: true});
    try {
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM team_users').get().n, 1);
      for (const table of ['teams', 'team_memberships', 'team_operators', 'team_collection_tasks', 'team_task_submissions',
        'team_device_bindings', 'team_sessions', 'team_subscription_events', 'team_annual_orders', 'team_seat_orders']) {
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n, 0, table);
      }
    } finally { db.close(); }
    const original = await fs.readFile(run.originalFile);
    assert.equal(original.length, 2048);
    assert.match(original.toString('utf8'), /合成/);
    for (const file of [run.configFile, run.caFile, run.originalFile]) {
      assert.equal(path.dirname(file), run.directory);
      const response = await get(run.address.url+'/'+path.basename(file), ca);
      assert.equal(response.status, 401);
      assert.doesNotMatch(response.text, /BEGIN CERTIFICATE|apiBase|合成原件/);
    }
  }

  await assert.rejects(get(first.address.url+'/api/auth/methods', secondCa), badCertificate);
  await assert.rejects(get(first.address.url+'/api/auth/methods'), badCertificate);
  await first.close();
  await first.close();
  assert.equal(JSON.parse(await fs.readFile(path.join(first.directory, 'closed.json'), 'utf8')).candidateId, first.candidateId);
  await assert.rejects(get(first.address.url+'/api/auth/methods', firstCa), {code: 'ECONNREFUSED'});
  assert.equal((await get(second.address.url+'/ready', secondCa)).status, 200);
});

test('managed review delivers codes for its first administrator and four employee numbers only', windows, async t => {
  const {appRoot, runs} = await packageFixture(t);
  await fs.writeFile(path.join(appRoot, 'owner-review-runtime.json'), OWNER_REVIEW_RUNTIME_MARKER);
  const {createOwnerReviewManagedPilot} = await import('../scripts/owner-review-managed-pilot-service.mjs');
  const deliveries = [];
  const run = await createOwnerReviewManagedPilot({appRoot, onVerificationCode: value => { deliveries.push(value); }});
  runs.push(run);
  const ca = await fs.readFile(run.caFile);
  const {ownerPhone, ownerPassword, adminPhone} = run.credentials;
  const employeeNumbers = [
    ['assistantPhone', '+8613800000993', 'assistant'],
    ['internPhone', '+8613800000994', 'intern'],
    ['managerCandidatePhone', '+8613800000996', 'assistant'],
    ['partnerCandidatePhone', '+8613800000997', 'assistant'],
  ];
  const outsidePhone = '+8613800000995';
  const password = 'Synthetic-Managed-Review-2026!';
  const provisioning = '/api/operations/team-requests';
  const firstAdmin = '/api/auth/first-administrator';
  const activation = '/api/auth/onboarding';

  async function call(route, expected, body, session) {
    const method = body === undefined ? 'GET' : 'POST';
    const content = body === undefined ? undefined : JSON.stringify(body);
    const headers = {Origin: 'shenyi://app'};
    if (content !== undefined) headers['Content-Type'] = 'application/json';
    if (session) headers.Authorization = 'Bearer ' + session.token;
    if (session?.lease) {
      const {serverId, deviceId, bindingRevision, id:leaseId, token} = session.lease;
      const fields = {
        serverId, deviceId, bindingRevision, leaseId, userId:session.account.id,
        sessionBinding:proof.sessionBinding(session.token), method, pathAndQuery:route,
        bodySha256:digest(content ?? ''), nonce:randomBytes(32).toString('base64url'),
      };
      Object.assign(headers, {
        'X-Shenyi-Device-Lease':token, 'X-Shenyi-Device-Nonce':fields.nonce,
        'X-Shenyi-Device-Body-SHA256':fields.bodySha256,
        'X-Shenyi-Device-Signature':sign(null, proof.requestProofBytes(fields), session.key.privateKey).toString('base64url'),
      });
    }
    const raw = await request(run.profile.apiBase+route, ca, {method, headers, body:content});
    const data = JSON.parse(raw.text);
    assert.equal(raw.authorized, true);
    assert.equal(raw.headers['x-shenyi-server-id'], run.profile.serverId);
    assert.equal(raw.status, expected, route + (data.error ? ' ' + data.error.code : ''));
    return data;
  }

  async function bind(phone, currentPassword) {
    const boot = await call('/api/auth/phone/login', 200, {phone, password:currentPassword});
    const key = keyPair();
    const {challenge} = await call('/api/auth/devices/enrollment-challenges', 201, {
      publicKey:key.encoded, displayName:'Synthetic managed review device', platform:'win32', currentPassword,
    }, boot);
    const account = await call('/api/auth/devices/enroll', 201, {
      challengeId:challenge.challengeId,
      signature:sign(null, proof.challengeBytes(challenge), key.privateKey).toString('base64url'),
    }, boot);
    return {...account, key};
  }

  async function activate(base, purpose, phone, invitationCode, displayName) {
    const before = deliveries.length;
    const {challengeId} = await call(base + '/challenges', 202, {phone, invitationCode});
    assert.equal(deliveries.length, before+1);
    const delivery = deliveries[before];
    assert.deepEqual(Object.keys(delivery).sort(), ['code','phone','purpose']);
    assert.equal(delivery.phone, phone);
    assert.equal(delivery.purpose, purpose);
    assert.match(delivery.code, /^\d{6}$/);
    await call(base + '/activate', 200, {phone, invitationCode, challengeId, code:delivery.code, password, displayName, accept:true});
  }

  assert.equal(adminPhone, '+8613800000992');
  const owner = await bind(ownerPhone, ownerPassword);
  const {request:created} = await call(provisioning, 201, {
    teamName:'Synthetic managed review team', adminPhone,
  }, owner);
  const review = provisioning+'/'+created.id+'/review';
  const firstInvitation = await call(review, 200, {
    decision:'approve', revision:created.revision, currentPassword:ownerPassword,
  }, owner);
  await activate(firstAdmin, 'first-admin', adminPhone, firstInvitation.invitationCode, 'Synthetic first administrator');
  const {requests} = await call(provisioning, 200, undefined, owner);
  const opened = requests.find(row=>row.id === created.id);
  assert.equal(opened.status, 'activated');
  const admin = await bind(adminPhone, password);
  assert.deepEqual(admin.memberships, []);

  // Keep one extra test-only seat so the out-of-scope phone reaches the isolated SMS adapter.
  const {request:approved} = await call(review, 200, {
    decision:'approve-pilot', revision:opened.revision, currentPassword:ownerPassword, seats:5,
    endsAt:Date.now()+60*60_000,
  }, owner);
  assert.equal(approved.pilot.seats, 5);
  const invitations = '/api/teams/'+opened.teamId+'/employee-invitations';
  for (const [field, phone, role] of employeeNumbers) {
    const {invitationCode} = await call(invitations, 201, {phone, role}, admin);
    await activate(activation, 'activate', phone, invitationCode, 'Synthetic '+field);
  }
  assert.ok(employeeNumbers.every(([field, number]) => run.credentials[field] === number));
  const {invitationCode} = await call(invitations, 201, {phone:outsidePhone, role:'assistant'}, admin);
  await call(activation+'/preview', 200, {phone:outsidePhone, invitationCode});
  const rejected = await call(activation+'/challenges', 503, {phone:outsidePhone, invitationCode});
  assert.equal(rejected.error.code, 'SMS_UNAVAILABLE');
  assert.deepEqual(deliveries.map(({phone, purpose})=>[phone,purpose]),
    [[adminPhone,'first-admin'], ...employeeNumbers.map(([,phone])=>[phone,'activate'])]);
  await call('/api/auth/logout', 200, {}, admin);
  await call('/api/auth/logout', 200, {}, owner);
  await run.close();

  const db = new DatabaseSync(path.toNamespacedPath(run.databasePath), {readOnly:true});
  try {
    const members = db.prepare('SELECT phone.phone, member.role FROM team_memberships AS member ' +
      'JOIN team_phone_credentials AS phone USING (user_id) WHERE member.team_id=? ORDER BY phone.phone').all(opened.teamId);
    assert.deepEqual(members.map(({phone,role})=>[phone,role]), employeeNumbers.map(([,phone,role])=>[phone,role]));
    const outcome = db.prepare('SELECT delivery_state,consumed_at FROM team_operator_employee_activation_challenges ' +
      'WHERE phone=?').get(outsidePhone);
    assert.equal(outcome.delivery_state, 'failed');
    assert.equal(outcome.consumed_at, null);
    assert.equal(db.prepare('SELECT 1 FROM team_phone_credentials WHERE phone=?').get(outsidePhone), undefined);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});
