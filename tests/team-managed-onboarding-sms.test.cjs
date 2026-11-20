'use strict';

const assert = require('node:assert/strict');
const {createHash, createHmac, generateKeyPairSync, randomBytes, sign} = require('node:crypto');
const fs = require('node:fs/promises');
const https = require('node:https');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {test} = require('node:test');
const {generateCertificates} = require('./helpers/trusted-team-https-fixture.cjs');
const deviceProof = require('../shared/device-proof.cjs');

const apiBase = 'https://localhost';
const operations = '/api/operations/team-requests';
const owner = {phone:'13800009101', password:'Synthetic-Owner-Only!2026'};
const admin = {phone:'＋８６ (138) 0000-9102', normalized:'+8613800009102', password:'Synthetic-Admin-Only!2026'};
const employee = {phone:'0086 138-0000-9103', normalized:'+8613800009103', password:'Synthetic-Assistant-Only!2026'};
const domain = 'dysmsapi.aliyuncs.com';
const algorithm = 'ACS3-HMAC-SHA256';
const provider = {
  accessKeyId:'SyntheticOnboardingKey', accessKeySecret:'synthetic-onboarding-sms-secret',
  securityToken:'SyntheticSmsToken+/=', signName:'合成审易 !',
  templates:{bind:'SMS_991001', reset:'SMS_991002', activate:'SMS_991003', 'first-admin':'SMS_991004'},
};
const providerPrivateDetail = 'synthetic-provider-response-detail';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest('hex');

function controlledSupplier() {
  const calls = [];
  let expected;
  return {
    calls,
    expect() {
      assert.equal(expected, undefined);
      let observe, respond;
      const observed = new Promise(resolve => { observe = resolve; });
      const response = new Promise(resolve => { respond = resolve; });
      expected = {observe, response};
      return {observed, respond};
    },
    async transport(url, options) {
      const call = {url, options};
      calls.push(call);
      const waiting = expected;
      expected = undefined;
      if (!waiting || new URL(url).origin !== 'https://' + domain) throw new Error('Synthetic SMS transport rejected an unexpected call');
      waiting.observe(call);
      return waiting.response;
    },
  };
}

function assertProviderWire(call, purpose, normalizedPhone) {
  const {headers, method, redirect, signal} = call.options;
  assert.equal(method, 'POST');
  assert.equal(redirect, 'error');
  assert.ok(signal instanceof AbortSignal && !signal.aborted);
  assert.equal(call.options.body, undefined);
  const target = new URL(call.url);
  assert.equal(target.origin, 'https://' + domain);
  assert.equal(target.pathname, '/');
  const param = JSON.parse(target.searchParams.get('TemplateParam'));
  assert.deepEqual(Object.keys(param), ['code']);
  assert.match(param.code, /^\d{6}$/);
  const query = 'PhoneNumbers=' + normalizedPhone.slice(3) + '&SignName=%E5%90%88%E6%88%90%E5%AE%A1%E6%98%93%20%21' +
    '&TemplateCode=' + provider.templates[purpose] + '&TemplateParam=%7B%22code%22%3A%22' + param.code + '%22%7D';
  assert.ok(target.search === '?' + query, 'SendSms submitted the wrong normalized route, template, or fields');
  const emptyBodyHash = sha256('');
  const nonce = headers['x-acs-signature-nonce'];
  assert.match(nonce, uuid);
  const timestamp = headers['x-acs-date'];
  assert.match(timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const expectedHeaders = {
    host:domain, 'x-acs-action':'SendSms', 'x-acs-content-sha256':emptyBodyHash, 'x-acs-date':timestamp,
    'x-acs-security-token':provider.securityToken, 'x-acs-signature-nonce':nonce, 'x-acs-version':'2017-05-25',
  };
  const headerBlock = Object.entries(expectedHeaders).map(([name, value]) => name + ':' + value + '\n').join('');
  const headerNames = Object.keys(expectedHeaders).join(';');
  const signature = hmac(provider.accessKeySecret, algorithm + '\n' + sha256(['POST', '/', query, headerBlock, headerNames, emptyBodyHash].join('\n')));
  assert.ok(Object.entries(expectedHeaders).every(([name, value]) => headers[name] === value), 'SendSms signed headers differ');
  assert.ok(headers.authorization === algorithm + ' Credential=' + provider.accessKeyId + ',SignedHeaders=' + headerNames + ',Signature=' + signature,
    'SendSms ACS3 signature does not match the canonical request');
  return param.code;
}

function loopbackClient(server, ca, serverId) {
  assert.equal(server.address.host, '127.0.0.1');
  return (route, {body, session} = {}) => new Promise((resolve, reject) => {
    const method = body === undefined ? 'GET' : 'POST';
    const content = body === undefined ? undefined : JSON.stringify(body);
    const headers = {host:'localhost', origin:'shenyi://app'};
    if (content !== undefined) Object.assign(headers, {'content-type':'application/json', 'content-length':Buffer.byteLength(content)});
    if (session) headers.authorization = 'Bearer ' + session.token;
    if (session?.lease) {
      const {deviceId, bindingRevision, id:leaseId, token} = session.lease;
      assert.equal(session.lease.serverId, serverId);
      const fields = {serverId, userId:session.account.id, deviceId, bindingRevision, leaseId,
        sessionBinding:deviceProof.sessionBinding(session.token), method, pathAndQuery:route,
        bodySha256:sha256(content ?? ''), nonce:randomBytes(32).toString('base64url')};
      Object.assign(headers, {'x-shenyi-device-lease':token, 'x-shenyi-device-nonce':fields.nonce,
        'x-shenyi-device-body-sha256':fields.bodySha256,
        'x-shenyi-device-signature':sign(null, deviceProof.requestProofBytes(fields), session.key).toString('base64url')});
    }
    const request = https.request({hostname:'127.0.0.1', port:server.address.port, servername:'localhost',
      path:route, method, headers, ca, rejectUnauthorized:true, agent:false}, response => {
      const bodyParts = [];
      const authorized = response.socket.authorized;
      response.on('data', part => bodyParts.push(part));
      response.on('error', reject);
      response.on('end', () => {
        try {
          assert.equal(authorized, true);
          assert.equal(response.headers['x-shenyi-server-id'], serverId);
          const text = Buffer.concat(bodyParts).toString('utf8');
          resolve({status:response.statusCode, data:JSON.parse(text), text, headers:response.headers});
        } catch (error) { reject(error); }
      });
    });
    request.setTimeout(10_000, () => request.destroy(new Error('Synthetic HTTPS fixture request timed out')));
    request.on('error', reject);
    request.end(content);
  });
}

async function fixture(t) {
  const parent = await fs.realpath(process.env.SHENYI_TEST_TMPDIR ?? tmpdir());
  const directory = await fs.mkdtemp(path.join(parent, 'shenyi-managed-onboarding-sms-'));
  let service, db;
  t.after(async () => {
    try { await service?.close(); }
    finally {
      db?.close();
      assert.equal(await fs.realpath(directory), directory);
      assert.equal(path.dirname(directory), parent);
      assert.match(path.basename(directory), /^shenyi-managed-onboarding-sms-/);
      await fs.rm(directory, {recursive:true});
    }
  });
  const {bootstrapManagedOwner} = await import('../server/team/managed-owner-bootstrap.mjs');
  const {openConfiguredTeamService} = await import('../scripts/start-team-service.mjs');
  const boot = await bootstrapManagedOwner({outputDirectory:path.join(directory,'owner'), displayName:'合成审核员',
    phone:owner.phone, password:owner.password, verifiedOutOfBand:true});
  const certs = await generateCertificates(path.join(directory, 'certificates'));
  const smsProfile = path.join(directory,'sms-private.json');
  const phonePepper = randomBytes(32);
  await fs.writeFile(smsProfile, JSON.stringify({schemaVersion:1, provider:'aliyun', ...provider,
    phonePepper:phonePepper.toString('base64url')}), {flag:'wx', mode:0o600});
  const config = path.join(directory,'service.json');
  await fs.writeFile(config, JSON.stringify({schemaVersion:1, database:boot.databasePath, apiBase, serverId:boot.serverId,
    listenPort:0, tlsCertificate:path.join(certs.directory,'valid.pem'), tlsKey:path.join(certs.directory,'valid.key'), smsProfile}),
    {flag:'wx', mode:0o600});
  const supplier = controlledSupplier();
  const previousFetch = globalThis.fetch;
  // The configured adapter captures this plain function at startup. It never delegates to fetch.
  globalThis.fetch = supplier.transport;
  try { service = await openConfiguredTeamService(config); }
  finally { globalThis.fetch = previousFetch; }
  const ca = await fs.readFile(certs.ca);
  db = new DatabaseSync(path.toNamespacedPath(boot.databasePath), {readOnly:true});
  return {boot, db, phonePepper, supplier, call:loopbackClient(service, ca, boot.serverId), async close() {
    await service.close();
    db.close();
    db = undefined;
  }};
}

function expectStatus(reply, status, code) {
  assert.equal(reply.status, status, 'Response error code ' + (reply.data?.error?.code ?? '(none)'));
  if (code) assert.equal(reply.data.error.code, code);
  return reply.data;
}

async function bind(call, credentials) {
  const {phone, password} = credentials;
  const boot = expectStatus(await call('/api/auth/phone/login', {body:{phone,password}}), 200);
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');
  const {challenge} = expectStatus(await call('/api/auth/devices/enrollment-challenges', {session:boot,
    body:{publicKey, displayName:'合成激活流程电脑', platform:'win32', currentPassword:password}}), 201);
  const signature = sign(null, deviceProof.challengeBytes(challenge), pair.privateKey).toString('base64url');
  return {...expectStatus(await call('/api/auth/devices/enroll', {session:boot,
    body:{challengeId:challenge.challengeId, signature}}), 201), key:pair.privateKey};
}

const durableTables = ['teams','team_users','team_credentials','team_phone_credentials','team_memberships','team_operators',
  'team_provisioning_requests','team_provisioning_events','team_operator_employee_invitations','team_activity',
  'team_sessions','team_device_bindings','team_device_leases'];
const durableFacts = db => durableTables.map(name => sha256(JSON.stringify(db.prepare('SELECT * FROM main.'+name+' ORDER BY rowid').all())));
const count = (db, table) => db.prepare(`SELECT count(*) AS n FROM main.${table}`).get().n;

function assertRedacted(reply, secrets) {
  const publicOutput = reply.text + '\n' + JSON.stringify(reply.headers);
  assert.ok(secrets.every(secret => !publicOutput.includes(secret)), 'Public SMS response disclosed protected data');
}

async function verifyActivation(f, {base, invite, credentials, purpose, table, idColumn, targetId, displayName}) {
  const {phone, normalized, password} = credentials;
  const {call, db, phonePepper, supplier} = f;
  const prior = durableFacts(db);
  const body = {invitationCode:invite,phone};
  const commonSecrets = [provider.accessKeyId, provider.accessKeySecret, provider.securityToken, providerPrivateDetail,
    phonePepper.toString('base64url'), normalized, invite, password];
  const activate = (row, code) => call(base+'/activate', {body:{...body, challengeId:row.challenge_id, code, password, displayName, accept:true}});
  const rows = () => db.prepare(`SELECT * FROM main.${table} WHERE ${idColumn}=? ORDER BY rowid`).all(targetId);
  assert.equal(rows().length, 0);
  const preview = await call(base+'/preview', {body});
  expectStatus(preview, 200);
  assertRedacted(preview, commonSecrets);
  const attempt = async accepted => {
    const before = supplier.calls.length;
    const observed = supplier.expect();
    const pending = call(base+'/challenges', {body});
    const response = Response.json(accepted ? {Code:'OK', RequestId:providerPrivateDetail, BizId:'synthetic-provider-receipt'} :
      {Code:'BUSINESS_LIMIT_CONTROL', Message:providerPrivateDetail + ' ' + provider.accessKeySecret});
    let challenge, code;
    try {
      const wire = await Promise.race([observed.observed, pending.then(() => {
        throw new Error('Activation challenge did not reach the configured synthetic supplier');
      })]);
      code = assertProviderWire(wire, purpose, normalized);
      assert.equal(supplier.calls.length, before+1);
      challenge = rows().at(-1);
      assert.deepEqual([challenge.delivery_state, challenge.attempts, challenge.consumed_at], ['sending',0,null]);
      assert.equal(challenge.phone, normalized);
      assert.equal(challenge.purpose, purpose);
      assert.equal(challenge.invitation_hash, sha256(invite));
      assert.equal(challenge.code_mac, hmac(phonePepper, JSON.stringify([challenge.challenge_id,targetId,sha256(invite),
        purpose,normalized,challenge.expires_at,code])));
      if (!accepted) {
        const premature = await activate(challenge, code);
        expectStatus(premature, 404, 'NOT_FOUND');
        assertRedacted(premature, [...commonSecrets, '"'+code+'"']);
        assert.deepEqual(durableFacts(db), prior);
        assert.equal(rows().at(-1).attempts, 0);
      }
    } finally { observed.respond(response); }
    const reply = await pending;
    assert.equal(supplier.calls.length, before+1);
    assertRedacted(reply, [...commonSecrets, 'synthetic-provider-receipt', '"'+code+'"']);
    const fresh = rows().at(-1);
    assert.equal(fresh.challenge_id, challenge.challenge_id);
    assert.deepEqual([fresh.delivery_state,fresh.attempts,fresh.consumed_at], [accepted?'sent':'failed',0,null]);
    return {reply, fresh, code};
  };

  const rejected = await attempt(false);
  const unavailable = expectStatus(rejected.reply, 503, 'SMS_UNAVAILABLE');
  assert.deepEqual(Object.keys(unavailable), ['error']);
  assert.deepEqual(Object.keys(unavailable.error).sort(), ['code','message']);
  const denied = await activate(rejected.fresh, rejected.code);
  expectStatus(denied, 404, 'NOT_FOUND');
  assertRedacted(denied, [...commonSecrets, '"'+rejected.code+'"']);
  assert.deepEqual(durableFacts(db), prior);
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].consumed_at, null);
  assert.equal(db.prepare('SELECT 1 FROM main.team_phone_credentials WHERE phone=?').get(normalized), undefined);

  const delivered = await attempt(true);
  assert.notEqual(delivered.fresh.challenge_id, rejected.fresh.challenge_id);
  assert.deepEqual(expectStatus(delivered.reply, 202), {challengeId:delivered.fresh.challenge_id,expiresAt:delivered.fresh.expires_at});
  expectStatus(await activate(rejected.fresh, rejected.code), 404, 'NOT_FOUND');
  assert.deepEqual(durableFacts(db), prior);
  const activated = await activate(delivered.fresh, delivered.code);
  assert.deepEqual(expectStatus(activated, 200), {activated:true});
  assertRedacted(activated, [...commonSecrets, '"'+delivered.code+'"']);
  const after = durableFacts(db);
  expectStatus(await activate(delivered.fresh, delivered.code), 404, 'NOT_FOUND');
  assert.deepEqual(durableFacts(db), after);
  assert.deepEqual(rows().map(row => row.delivery_state), ['failed','sent']);
  assert.ok(rows().every(row => Number.isSafeInteger(row.consumed_at)));
  return db.prepare('SELECT user_id FROM main.team_phone_credentials WHERE phone=?').get(normalized).user_id;
}

test('configured Aliyun onboarding rejects undelivered OTPs and activates each scoped identity only with a fresh accepted SMS over TLS', async t => {
  const f = await fixture(t);
  const {call, db, supplier} = f;
  assert.equal(count(db,'team_users'),1);
  for (const table of ['teams','team_memberships','team_operators','team_sessions','team_device_bindings','team_activity']) assert.equal(count(db,table),0);

  const ownerSession = await bind(call, owner);
  assert.equal(ownerSession.account.id, f.boot.ownerUserId);
  const creation = {teamName:'合成首队', adminPhone:admin.phone};
  expectStatus(await call(operations, {session:{token:ownerSession.token},body:creation}), 403, 'DEVICE_PROOF_REQUIRED');
  const {request} = expectStatus(await call(operations, {session:ownerSession,body:creation}), 201);
  const review = operations+'/'+request.id+'/review';
  const firstInvite = expectStatus(await call(review, {session:ownerSession,
    body:{decision:'approve', revision:request.revision, currentPassword:owner.password}}), 200);
  assert.equal(count(db,'teams'),0);
  assert.equal(supplier.calls.length,0);
  const sessionsBeforeAdmin = count(db,'team_sessions');
  const adminId = await verifyActivation(f, {base:'/api/auth/first-administrator', invite:firstInvite.invitationCode,
    credentials:admin, purpose:'first-admin', table:'team_first_administrator_challenges',
    idColumn:'request_id', targetId:request.id, displayName:'合成首管理员'});
  const opened = expectStatus(await call(operations, {session:ownerSession}), 200).requests.find(row => row.id === request.id);
  assert.equal(opened.status,'activated');
  assert.equal(count(db,'team_users'),2);
  assert.equal(count(db,'team_memberships'),0);
  assert.equal(count(db,'team_sessions'),sessionsBeforeAdmin, 'Activation must not mint an administrator session');
  const adminSession = await bind(call, admin);
  assert.equal(adminSession.account.id, adminId);
  assert.deepEqual(adminSession.memberships, []);
  const {request:{pilot}} = expectStatus(await call(review, {session:ownerSession,body:{decision:'approve-pilot',
    revision:opened.revision, currentPassword:owner.password, endsAt:Date.now()+60*60_000, seats:1}}), 200);
  assert.equal(pilot.seats,1);
  const invitationRoute = '/api/teams/'+opened.teamId+'/employee-invitations';
  const staffInvite = expectStatus(await call(invitationRoute, {session:adminSession,body:{phone:employee.phone,role:'assistant'}}), 201);
  const sessionsBeforeEmployee = count(db,'team_sessions');
  const employeeId = await verifyActivation(f, {base:'/api/auth/onboarding', invite:staffInvite.invitationCode,
    credentials:employee, purpose:'activate', table:'team_operator_employee_activation_challenges',
    idColumn:'invitation_id', targetId:staffInvite.invitationId, displayName:'合成采集助理'});
  assert.equal(count(db,'team_sessions'),sessionsBeforeEmployee, 'Activation must not mint an employee session');
  const employeeSession = await bind(call, employee);
  assert.equal(employeeSession.account.id,employeeId);
  assert.deepEqual(employeeSession.memberships,[{teamId:opened.teamId,role:'assistant'}]);
  const tasks = expectStatus(await call('/api/teams/'+opened.teamId+'/collection/tasks', {session:employeeSession}), 200);
  assert.deepEqual(tasks.tasks, []);
  expectStatus(await call(invitationRoute, {session:employeeSession}), 404, 'NOT_FOUND');
  assert.equal(supplier.calls.length,4);
  assert.equal(new Set(supplier.calls.map(call => call.options.headers['x-acs-signature-nonce'])).size,4);

  for (const session of [employeeSession,adminSession,ownerSession]) expectStatus(await call('/api/auth/logout', {session,body:{}}), 200);
  await f.close();

  const cold = new DatabaseSync(path.toNamespacedPath(f.boot.databasePath), {readOnly:true});
  try {
    assert.equal(cold.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.deepEqual(cold.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(count(cold,'team_users'),3);
    assert.equal(count(cold,'team_device_bindings'),3);
    assert.equal(cold.prepare('SELECT count(*) AS n FROM main.team_sessions WHERE revoked_at IS NULL').get().n,0);
    assert.equal(cold.prepare('SELECT count(*) AS n FROM main.team_device_leases WHERE revoked_at IS NULL').get().n,0);
    const grant = cold.prepare('SELECT team_id,user_id,role FROM main.team_operators').all();
    assert.deepEqual(grant.map(row => [row.team_id,row.user_id,row.role]),[[opened.teamId,adminId,'administrator']]);
    const accepted = cold.prepare(`SELECT accepted_by,token_hash,accepted_at FROM main.team_operator_employee_invitations WHERE invitation_id=?`).get(staffInvite.invitationId);
    assert.equal(accepted.accepted_by,employeeId);
    assert.equal(accepted.token_hash,sha256(staffInvite.invitationCode));
    assert.ok(Number.isSafeInteger(accepted.accepted_at));
    const provisionAudit = cold.prepare('SELECT actor_id,action FROM main.team_provisioning_events ORDER BY revision').all();
    assert.deepEqual(provisionAudit.map(row => [row.actor_id,row.action]),[[ownerSession.account.id,'create'],[ownerSession.account.id,'approve'],[adminId,'activate']]);
    const audit = cold.prepare(`SELECT actor_id,action FROM main.team_activity WHERE action IN ('team.activate','member.activate') ORDER BY rowid`).all();
    assert.deepEqual(audit.map(row => [row.actor_id,row.action]),[[adminId,'team.activate'],[employeeId,'member.activate']]);
    const literalSecrets = [owner.password,admin.password,employee.password,provider.accessKeySecret,provider.securityToken,
      f.phonePepper.toString('base64url'),firstInvite.invitationCode,staffInvite.invitationCode,providerPrivateDetail];
    const persisted = await fs.readFile(f.boot.databasePath);
    assert.ok(literalSecrets.every(secret => !persisted.includes(Buffer.from(secret))), 'Database persisted cleartext SMS or activation secrets');
  } finally { cold.close(); }
});
