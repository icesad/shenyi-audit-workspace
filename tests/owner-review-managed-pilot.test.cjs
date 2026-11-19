'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {test} = require('node:test');
const {OWNER_REVIEW_RUNTIME_MARKER, loadOwnerReviewManagedPilotConfiguration} = require('../desktop/isolated-preview-config.cjs');

const windows = {skip: process.platform !== 'win32' || process.arch !== 'x64'};
const badCertificate = error => /^(?:DEPTH_|CERT_|UNABLE_|SELF_SIGNED_|ERR_TLS_)/.test(error?.code);

async function packageFixture(t) {
  const parent = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-owner-managed-test-'));
  const appRoot = path.join(parent, "review 'package !");
  const appData = path.join(parent, 'local-app-data');
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

function get(url, ca) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {ca, agent: false}, response => {
      const chunks = [];
      const authorized = response.socket.authorized;
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.once('end', () => resolve({status: response.statusCode, headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8'), authorized}));
    });
    request.once('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('The owned HTTPS listener did not respond.')));
  });
}

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

test('simultaneous managed reviews own separate loopback listeners, credentials and owner-only databases', windows, async t => {
  const {appRoot, appData, runs} = await packageFixture(t);
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
    const db = new DatabaseSync(databasePath, {readOnly: true});
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
