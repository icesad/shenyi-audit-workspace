'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash, generateKeyPairSync } = require('node:crypto');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

async function fixture({longPath = false} = {}) {
  const temporaryRoot = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-managed-config-'));
  let directory = temporaryRoot;
  if (longPath) {
    const parent = path.join(temporaryRoot, '审易数据库 # %23 %00');
    const prefix = path.join(parent, '团队资料-');
    directory = prefix + 'x'.repeat(Math.max(1, 280 - prefix.length));
    await fs.mkdir(directory, {recursive:true});
  }
  const filename = path.join(directory, 'service.json');
  const configuration = {
    schemaVersion: 1, database: path.join(directory, 'team.sqlite'), apiBase: 'https://127.0.0.1:9443',
    serverId: randomUUID(), listenPort: 9443, tlsCertificate: path.join(directory, 'server.pem'), tlsKey: path.join(directory, 'server-key.pem'),
  };
  return { temporaryRoot, directory, filename, configuration };
}

test('managed config accepts only an exact HTTPS profile and distinct absolute external paths', async () => {
  const { loadManagedServiceConfiguration } = await import('../scripts/start-team-service.mjs');
  const { filename, configuration } = await fixture();
  await fs.writeFile(filename, JSON.stringify(configuration, null, 2), { flag: 'wx' });
  assert.deepEqual(await loadManagedServiceConfiguration(filename), configuration);
  const invalid = { code: 'MANAGED_SERVICE_CONFIGURATION_INVALID' };
  for (const change of [
    { database: 'relative.sqlite' }, { tlsKey: configuration.tlsCertificate }, { tlsKey: path.join(__dirname, 'team-managed-service-config.test.cjs') },
    { apiBase: 'http://127.0.0.1:9443' }, { apiBase: 'https://127.0.0.1:9443/path' }, { apiBase: 'https://account@127.0.0.1:9443' },
    { serverId: 'unknown' }, { listenPort: 65536 }, { mode: 'demo' },
  ]) {
    await fs.writeFile(filename, JSON.stringify({ ...configuration, ...change }));
    await assert.rejects(loadManagedServiceConfiguration(filename), invalid);
  }
  const duplicate = JSON.stringify(configuration).replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1');
  await fs.writeFile(filename, duplicate);
  await assert.rejects(loadManagedServiceConfiguration(filename), invalid);
});

test('configured service refuses an absent database without creating it', async () => {
  const { openConfiguredTeamService } = await import('../scripts/start-team-service.mjs');
  const { filename, configuration } = await fixture();
  await fs.writeFile(filename, JSON.stringify(configuration), { flag: 'wx' });
  await fs.writeFile(configuration.tlsCertificate, 'synthetic placeholder', { flag: 'wx' });
  await fs.writeFile(configuration.tlsKey, 'synthetic placeholder', { flag: 'wx' });
  await assert.rejects(openConfiguredTeamService(filename), { code: 'MANAGED_DATABASE_NOT_READY' });
  await assert.rejects(fs.stat(configuration.database), { code: 'ENOENT' });
});

test('managed SMS is opt-in through a distinct absolute profile and fails before database access on invalid data', async () => {
  const { loadManagedServiceConfiguration, openConfiguredTeamService } = await import('../scripts/start-team-service.mjs');
  const { directory, filename, configuration } = await fixture();
  const smsProfile = path.join(directory, 'sms-private.json');
  const write = value => fs.writeFile(filename, JSON.stringify(value));
  await write(configuration);
  assert.equal(Object.hasOwn(await loadManagedServiceConfiguration(filename), 'smsProfile'), false);
  for (const value of ['relative.json', configuration.tlsKey, null]) {
    await write({ ...configuration, smsProfile: value });
    await assert.rejects(loadManagedServiceConfiguration(filename), { code: 'MANAGED_SERVICE_CONFIGURATION_INVALID' });
  }
  await write({ ...configuration, smsProfile });
  assert.equal((await loadManagedServiceConfiguration(filename)).smsProfile, smsProfile);
  const sendError = { code: 'MANAGED_SMS_INVALID', message: '短信服务配置无效。请检查独立配置文件及模板。' };
  await assert.rejects(openConfiguredTeamService(filename), sendError);
  const profile = { schemaVersion: 1, provider: 'aliyun', accessKeyId: 'synthetic-key', accessKeySecret: 'synthetic-only',
    phonePepper: Buffer.alloc(32, 42).toString('base64url'), signName: '合成测试',
    templates: { bind: 'SMS_1001', reset: 'SMS_1002', activate: 'SMS_1003', 'first-admin': 'SMS_1004' },
  };
  const validProfile = JSON.stringify(profile);
  await fs.writeFile(smsProfile, validProfile, { flag: 'wx' });
  await assert.rejects(openConfiguredTeamService(filename), { code: 'MANAGED_TLS_INVALID' });
  const ambiguous = validProfile.replace('"bind":"SMS_1001"', '"bind":"SMS_1002","b\\u0069nd":"SMS_1001"');
  await fs.writeFile(smsProfile, ambiguous);
  await assert.rejects(openConfiguredTeamService(filename), sendError);
  await assert.rejects(fs.stat(configuration.database), { code: 'ENOENT' });
});

test('managed reviewed recovery requires an explicit boolean and a valid SMS profile to start', async () => {
  const { loadManagedServiceConfiguration, openConfiguredTeamService } = await import('../scripts/start-team-service.mjs');
  const { directory, filename, configuration } = await fixture();
  const smsProfile = path.join(directory, 'sms-private.json');
  const invalid = { code: 'MANAGED_SERVICE_CONFIGURATION_INVALID' };
  const write = value => fs.writeFile(filename, JSON.stringify({ ...configuration, ...value }));

  await write({});
  assert.equal(Object.hasOwn(await loadManagedServiceConfiguration(filename), 'reviewedRecovery'), false);
  await write({ reviewedRecovery: false });
  assert.equal((await loadManagedServiceConfiguration(filename)).reviewedRecovery, false);
  for (const reviewedRecovery of ['true', 1, null, {}, []]) {
    await write({ reviewedRecovery, smsProfile });
    await assert.rejects(loadManagedServiceConfiguration(filename), invalid);
  }
  await write({ reviewedRecovery: true });
  await assert.rejects(openConfiguredTeamService(filename), invalid);
  await write({ reviewedRecovery: true, smsProfile });
  assert.equal((await loadManagedServiceConfiguration(filename)).reviewedRecovery, true);
  await assert.rejects(openConfiguredTeamService(filename), { code: 'MANAGED_SMS_INVALID' });
  await assert.rejects(fs.stat(configuration.database), { code: 'ENOENT' });
});

test('managed WeChat setup validates its external profile and callback origin before database access', async () => {
  const { loadManagedServiceConfiguration, openConfiguredTeamService } = await import('../scripts/start-team-service.mjs');
  const { directory, filename, configuration } = await fixture();
  const wechatProfile = path.join(directory, 'wechat-private.json');
  const configured = { ...configuration, apiBase:'https://login.shenyi.example', wechatProfile };
  const write = value => fs.writeFile(filename, JSON.stringify(value));
  await write(configuration);
  assert.equal(Object.hasOwn(await loadManagedServiceConfiguration(filename), 'wechatProfile'), false);
  for (const change of [{wechatProfile:'relative.json'}, {wechatProfile:configuration.tlsKey}, {smsProfile:wechatProfile}]) {
    await write({ ...configured, ...change });
    await assert.rejects(loadManagedServiceConfiguration(filename), {code:'MANAGED_SERVICE_CONFIGURATION_INVALID'});
  }
  await write(configured);
  assert.equal((await loadManagedServiceConfiguration(filename)).wechatProfile, wechatProfile);
  const invalidProfile = {code:'MANAGED_WECHAT_INVALID'};
  await assert.rejects(openConfiguredTeamService(filename), invalidProfile);
  const provider = {schemaVersion:1,provider:'wechat-open-platform',appId:'wx0123456789abcdef',appSecret:'synthetic-only'};
  await fs.writeFile(wechatProfile, JSON.stringify({...provider,redirectUri:configured.apiBase+'/api/auth/wechat/callback'}));
  await assert.rejects(openConfiguredTeamService(filename), invalidProfile);
  await fs.writeFile(wechatProfile, JSON.stringify(provider));
  for (const apiBase of ['https://127.0.0.1','https://login.shenyi.example:9443']) {
    await write({...configured,apiBase});
    await assert.rejects(openConfiguredTeamService(filename), invalidProfile);
  }
  await write(configured);
  await assert.rejects(openConfiguredTeamService(filename), {code:'MANAGED_TLS_INVALID'});
  await assert.rejects(fs.stat(configuration.database), {code:'ENOENT'});
});

test('managed readiness requires WeChat tables only when that provider is enabled', async t => {
  const { initializeTeamDatabase } = await import('../server/team/database.mjs');
  const { deviceServerId } = await import('../server/team/device-policy.mjs');
  const { assertManagedDatabaseReady } = await import('../server/team/managed-database-readiness.mjs');
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  initializeTeamDatabase(db);
  const serverId = deviceServerId(db);
  assertManagedDatabaseReady(db,serverId,{wechatEnabled:true});
  db.exec('DROP TABLE team_wechat_codes');
  assertManagedDatabaseReady(db,serverId);
  assert.throws(() => assertManagedDatabaseReady(db,serverId,{wechatEnabled:true}), {code:'MANAGED_DATABASE_NOT_READY'});
});

test('managed readiness rejects missing or inconsistent bounded source-pool metadata without mutating the database',async t=>{
  const {initializeTeamDatabase}=await import('../server/team/database.mjs');
  const {deviceServerId}=await import('../server/team/device-policy.mjs');
  const {assertManagedDatabaseReady}=await import('../server/team/managed-database-readiness.mjs');
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);
  const serverId=deviceServerId(db),ready=()=>assertManagedDatabaseReady(db,serverId);
  ready();
  const original=db.prepare("SELECT name,sql FROM sqlite_schema WHERE name LIKE 'team_auth_limit_pool_%' ORDER BY name").all();
  db.exec('DROP INDEX team_auth_limit_pool_expiry');
  assert.throws(ready,{code:'MANAGED_DATABASE_NOT_READY'});
  db.exec('CREATE INDEX team_auth_limit_pool_expiry ON team_auth_limit_pool_buckets(prefix,window_start,bucket) WHERE window_start<0');
  assert.throws(ready,{code:'MANAGED_DATABASE_NOT_READY'},'partial indexes cannot satisfy bounded expiry cleanup');
  db.exec('DROP INDEX team_auth_limit_pool_expiry');
  initializeTeamDatabase(db);ready();
  db.exec('DROP TABLE team_auth_limit_pool_buckets');
  const missing=db.prepare("SELECT name,sql FROM sqlite_schema WHERE name LIKE 'team_auth_limit_pool_%' ORDER BY name").all();
  assert.throws(ready,{code:'MANAGED_DATABASE_NOT_READY'});
  assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_schema WHERE name LIKE 'team_auth_limit_pool_%' ORDER BY name").all(),missing,'readiness must not auto-migrate an old managed database');
  initializeTeamDatabase(db);ready();
  db.prepare("UPDATE team_auth_limit_pools SET active_count=1 WHERE prefix='recovery-request:ip:'").run();
  assert.throws(ready,{code:'MANAGED_DATABASE_NOT_READY'});
  db.prepare("UPDATE team_auth_limit_pools SET active_count=0 WHERE prefix='recovery-request:ip:'").run();
  db.prepare('INSERT INTO team_auth_limits(bucket,window_start,attempts) VALUES (?,?,?)').run('recovery-request:ip:orphan',Date.now(),1);
  assert.throws(ready,{code:'MANAGED_DATABASE_NOT_READY'});
  initializeTeamDatabase(db);ready();

  // Keep both aggregate counts equal and each member joined to a real limiter
  // row, but swap the membership rows across prefixes. Prefix reconciliation
  // must reject this or recovery expiry could delete a live SMS source row.
  const at=Date.now(),recoveryPrefix='recovery-request:ip:',smsPrefix='sms:source:';
  const recoveryBucket=recoveryPrefix+'real-source',smsBucket=smsPrefix+'real-source';
  const insertLimit=db.prepare('INSERT INTO team_auth_limits(bucket,window_start,attempts) VALUES (?,?,?)');
  insertLimit.run(recoveryBucket,at,1);insertLimit.run(smsBucket,at,1);
  const insertMember=db.prepare('INSERT INTO team_auth_limit_pool_buckets(prefix,bucket,window_start) VALUES (?,?,?)');
  insertMember.run(recoveryPrefix,smsBucket,at);insertMember.run(smsPrefix,recoveryBucket,at);
  db.prepare('UPDATE team_auth_limit_pools SET active_count=1 WHERE prefix IN (?,?)').run(recoveryPrefix,smsPrefix);
  assert.throws(ready,{code:'MANAGED_DATABASE_NOT_READY'},'members must belong to their own source prefix');
  assert.equal(original.length,3);
});

test('managed request readiness avoids scanning bounded source-pool members',async t=>{
  const {initializeTeamDatabase}=await import('../server/team/database.mjs');
  const {deviceServerId}=await import('../server/team/device-policy.mjs');
  const {assertManagedDatabaseReady,assertManagedDatabaseRequestReady}=await import('../server/team/managed-database-readiness.mjs');
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);
  const prefix='recovery-request:ip:',now=Date.now();
  const insert=db.prepare('INSERT INTO team_auth_limits(bucket,window_start,attempts) VALUES (?,?,?)');
  for(let i=0;i<10_000;i++)insert.run(prefix+String(i).padStart(5,'0'),now,1);
  initializeTeamDatabase(db);
  const serverId=deviceServerId(db);
  const originalPrepare=db.prepare.bind(db),seen=[];
  db.prepare=function(sql){
    const normalized=String(sql).replace(/\\s+/g,' ').trim();
    seen.push(normalized);
    if(/COUNT\\s*\\(/i.test(normalized))throw new Error('request readiness must not count source-pool rows');
    if(normalized.includes('team_auth_limit_pool_buckets')&&!normalized.startsWith('PRAGMA')&&!/LIMIT 0$/i.test(normalized))
      throw new Error('request readiness must not scan source-pool members');
    return originalPrepare(sql);
  };
  assertManagedDatabaseRequestReady(db,serverId,{reviewedRecovery:true});
  assert.equal(seen.some(sql=>/COUNT\\s*\\(/i.test(sql)),false);
  db.prepare=originalPrepare;
  assertManagedDatabaseReady(db,serverId,{reviewedRecovery:true});
});

test('managed readiness requires recovery epoch triggers and challenge bindings only when reviewed recovery is enabled', async t => {
  const { initializeTeamDatabase } = await import('../server/team/database.mjs');
  const { deviceServerId } = await import('../server/team/device-policy.mjs');
  const { assertManagedDatabaseReady } = await import('../server/team/managed-service.mjs');
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  initializeTeamDatabase(db);
  const serverId = deviceServerId(db);
  const enabled = { reviewedRecovery: true };
  const notReady = { code: 'MANAGED_DATABASE_NOT_READY' };
  assertManagedDatabaseReady(db, serverId, enabled);

  db.exec('DROP TRIGGER recovery_epoch_team_recovery_reviewers_update;');
  assertManagedDatabaseReady(db, serverId);
  assert.throws(() => assertManagedDatabaseReady(db, serverId, enabled), notReady);

  initializeTeamDatabase(db);
  assertManagedDatabaseReady(db, serverId, enabled);
  db.exec('DROP TABLE team_phone_challenge_bindings;');
  assertManagedDatabaseReady(db, serverId);
  assert.throws(() => assertManagedDatabaseReady(db, serverId, enabled), notReady);
});

async function databasePreflightFixture(t, options) {
  const value = await fixture(options);
  t.after(() => fs.rm(value.temporaryRoot, {recursive:true,force:true}));
  const {initializeTeamDatabase} = await import('../server/team/database.mjs');
  const {deviceServerId} = await import('../server/team/device-policy.mjs');
  const db = new DatabaseSync(path.toNamespacedPath(value.configuration.database));
  try {
    initializeTeamDatabase(db);
    value.configuration.serverId = deviceServerId(db);
    db.prepare("INSERT INTO team_users VALUES ('preflight-member','active')").run();
    db.prepare("INSERT INTO teams VALUES ('preflight-team','active')").run();
    db.prepare("INSERT INTO team_memberships VALUES ('preflight-team','preflight-member','intern','active')").run();
  } finally { db.close(); }
  const unexpectedListen = path.join(value.directory,'unexpected-listen');
  const unexpectedBootstrap = path.join(value.directory,'unexpected-bootstrap');
  const bootstrapModule = pathToFileURL(path.resolve(__dirname,'../server/team/managed-service.mjs')).href;
  const guard = path.join(value.directory,'no-listener.cjs');
  await fs.writeFile(guard, "'use strict';\nrequire('node:net').Server.prototype.listen=function(){require('node:fs').writeFileSync("+
    JSON.stringify(unexpectedListen)+",'unexpected listener');throw new Error('Database preflight must not listen');};\n"+
    "require('node:module').registerHooks({load(url,context,nextLoad){if(url==="+JSON.stringify(bootstrapModule)+"){"+
    "require('node:fs').writeFileSync("+JSON.stringify(unexpectedBootstrap)+",'unexpected managed-service import');"+
    "throw new Error('DATABASE_PREFLIGHT_EAGER_BOOTSTRAP');}return nextLoad(url,context);}});\n", {flag:'wx'});
  return {...value,guard,unexpectedListen,unexpectedBootstrap,bootstrapModule};
}

async function preflightFileFacts(directory) {
  return Promise.all((await fs.readdir(directory)).sort().map(async name => {
    const filename=path.join(directory,name),info=await fs.lstat(filename,{bigint:true});
    assert.ok(info.isFile()&&!info.isSymbolicLink());
    return {name,bytes:String(info.size),mtimeNs:String(info.mtimeNs),
      sha256:createHash('sha256').update(await fs.readFile(filename)).digest('hex')};
  }));
}

function runPreflightCli(filename, guard, mode) {
  return new Promise(resolve=>execFile(process.execPath,
    ['--disable-warning=ExperimentalWarning','--require',guard,path.resolve(__dirname,'../scripts/start-team-service.mjs'),
      ...(mode ? [mode] : []),'--config',filename],
    {windowsHide:true,timeout:15000,maxBuffer:65536},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
}

async function startupNetworkGuard(directory) {
  const guard = path.join(directory, 'no-startup-network.cjs');
  await fs.writeFile(guard, `'use strict';
const forbidden=()=>{process.stderr.write('unexpected network');process.exit(97);};
require('node:net').Server.prototype.listen=forbidden;
require('node:net').Socket.prototype.connect=forbidden;
globalThis.fetch=forbidden;
`,{flag:'wx'});
  return guard;
}

async function databasePreflightCli(f,configuration,expectedCode) {
  await fs.writeFile(f.filename,JSON.stringify(configuration));
  const sources=['../scripts/start-team-service.mjs','../server/team/managed-database-readiness.mjs','../server/team/managed-service.mjs'].map(name=>path.resolve(__dirname,name));
  const sourceBytes=await Promise.all(sources.map(name=>fs.readFile(name)));
  const before=await preflightFileFacts(f.directory);
  const result=await runPreflightCli(f.filename,f.guard,'--check-database');
  assert.equal(result.error?.signal??null,null,result.stderr);
  assert.notEqual(result.error?.killed,true,result.stderr);
  if(expectedCode){
    assert.ok(Number.isInteger(result.error?.code)&&result.error.code!==0,result.stdout+result.stderr);
    assert.equal(result.stdout,'');
    assert.deepEqual(JSON.parse(result.stderr),{event:'error',code:expectedCode,message:'指定数据库未通过服务启动检查。'});
  }else{
    assert.equal(result.error,null,result.stderr);
    assert.equal(result.stdout,JSON.stringify({event:'database-ready'})+'\n');
    assert.equal(result.stderr,'');
  }
  assert.deepEqual(await preflightFileFacts(f.directory),before,'CLI must not alter SQLite, config, sidecars or other fixture files');
  await assert.rejects(fs.stat(f.unexpectedListen),{code:'ENOENT'});
  await assert.rejects(fs.stat(f.unexpectedBootstrap),{code:'ENOENT'});
  for(const [index,name] of sources.entries())assert.deepEqual(await fs.readFile(name),sourceBytes[index],name);
}

test('database-only CLI checks an active database without loading app bootstrap or missing provider files or opening a listener', async t => {
  const f=await databasePreflightFixture(t);
  // Positive control proves the preload blocks the real ESM app module before
  // evaluating it; the subsequent CLI calls must succeed with this hook active.
  const blocked=await new Promise(resolve=>execFile(process.execPath,
    ['--disable-warning=ExperimentalWarning','--require',f.guard,'--input-type=module','-e','await import('+JSON.stringify(f.bootstrapModule)+');'],
    {windowsHide:true,timeout:15000,maxBuffer:65536},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
  assert.equal(blocked.error?.code,1);
  assert.match(blocked.stderr,/DATABASE_PREFLIGHT_EAGER_BOOTSTRAP/);
  assert.equal(blocked.stdout,'');
  assert.equal(await fs.readFile(f.unexpectedBootstrap,'utf8'),'unexpected managed-service import');
  await fs.unlink(f.unexpectedBootstrap);
  await databasePreflightCli(f,f.configuration);
  await databasePreflightCli(f,{...f.configuration,apiBase:'https://login.shenyi.example',reviewedRecovery:true,
    smsProfile:path.join(f.directory,'absent-sms.json'),wechatProfile:path.join(f.directory,'absent-wechat.json')});
});

test('database-only CLI applies optional provider schema requirements without initializing or repairing the database', async t => {
  for(const optional of ['wechat','reviewed-recovery']){
    const f=await databasePreflightFixture(t),db=new DatabaseSync(f.configuration.database);
    try{db.exec(optional==='wechat'?'DROP TABLE team_wechat_codes':'DROP TRIGGER recovery_epoch_team_recovery_reviewers_update');}
    finally{db.close();}
    const enabled=optional==='wechat'?{wechatProfile:path.join(f.directory,'absent-wechat.json')}:
      {reviewedRecovery:true,smsProfile:path.join(f.directory,'absent-sms.json')};
    await databasePreflightCli(f,{...f.configuration,apiBase:'https://login.shenyi.example',...enabled},'MANAGED_DATABASE_NOT_READY');
    await databasePreflightCli(f,f.configuration);
  }
});

test('database-only CLI rejects an absent database and wrong instance without creating or changing files', async t => {
  const f=await databasePreflightFixture(t);
  await databasePreflightCli(f,{...f.configuration,database:path.join(f.directory,'absent.sqlite')},'MANAGED_DATABASE_NOT_READY');
  await databasePreflightCli(f,{...f.configuration,serverId:randomUUID()},'MANAGED_DATABASE_NOT_READY');
});

test('managed CLI opens long Windows SQLite paths and cannot recreate a vanished database', {skip:process.platform!=='win32'}, async t => {
  const f = await databasePreflightFixture(t, {longPath:true});
  const {database,tlsCertificate,tlsKey} = f.configuration;
  assert.ok(database.length > 280);
  await databasePreflightCli(f, f.configuration);
  await databasePreflightCli(f, {...f.configuration,serverId:randomUUID()}, 'MANAGED_DATABASE_NOT_READY');
  await fs.writeFile(f.filename, JSON.stringify({...f.configuration,database:path.toNamespacedPath(database)}));
  const invalid = await runPreflightCli(f.filename,f.guard,'--check-database');
  assert.equal(invalid.error?.code,1,invalid.stderr);
  assert.equal(JSON.parse(invalid.stderr).code,'MANAGED_SERVICE_CONFIGURATION_INVALID');

  const {createOwnerReviewCheckoutCertificate} = await import('../scripts/owner-review-checkout-certificate.mjs');
  const {key,cert} = createOwnerReviewCheckoutCertificate();
  await fs.writeFile(tlsCertificate,cert);
  await fs.writeFile(tlsKey,key);
  await fs.writeFile(f.filename,JSON.stringify(f.configuration));

  // Remove the fixture after the real read-only check, just before SQLite opens for writes.
  const displaced = path.join(f.directory, 'displaced.sqlite');
  const guard = path.join(f.directory, 'displace-database.cjs');
  await fs.writeFile(guard, `'use strict';
const sqlite = require('node:sqlite');
const fs = require('node:fs');
sqlite.DatabaseSync = class extends sqlite.DatabaseSync {
  constructor(filename, options) {
    if (!options.readOnly) fs.renameSync(${JSON.stringify(database)}, ${JSON.stringify(displaced)});
    super(filename, options);
  }
};
require('node:module').syncBuiltinESMExports();
`);
  const original = await fs.readFile(database);
  const result = await runPreflightCli(f.filename,guard);
  assert.equal(result.error?.code,1,result.stderr);
  assert.equal(result.stdout,'');
  assert.equal(JSON.parse(result.stderr).code,'MANAGED_DATABASE_NOT_READY');
  await assert.rejects(fs.stat(database),{code:'ENOENT'});
  assert.deepEqual(await fs.readFile(displaced),original);
});

test('startup CLI validates TLS, opt-in providers and database with no writes or network', async t => {
  const f=await databasePreflightFixture(t);
  const {createOwnerReviewCheckoutCertificate}=await import('../scripts/owner-review-checkout-certificate.mjs');
  const valid=createOwnerReviewCheckoutCertificate();
  const expired=createOwnerReviewCheckoutCertificate({now:()=>Date.now()-86_400_000});
  const {configuration}=f;
  const guard=await startupNetworkGuard(f.directory);

  async function check(profile, code) {
    await fs.writeFile(f.filename, JSON.stringify(profile));
    const before=await preflightFileFacts(f.directory);
    const {error,stdout,stderr}=await runPreflightCli(f.filename,guard,'--check-startup');
    if (code) {
      assert.equal(error?.code,1,stderr);
      assert.equal(stdout,'');
      const report=JSON.parse(stderr);
      assert.deepEqual(Object.keys(report).sort(),['code','event','message']);
      assert.equal(report.event,'error');
      assert.equal(report.code,code);
      assert.match(report.message,/^[\p{L}\p{P} HTTPS]+$/u);
      assert.doesNotMatch(stderr,/synthetic-only|PRIVATE KEY|sqlite|\.json/);
    } else {
      assert.equal(error,null,stderr);
      assert.equal(stdout,'{"event":"startup-ready"}\n');
      assert.equal(stderr,'');
    }
    assert.deepEqual(await preflightFileFacts(f.directory),before);
  }

  await check(configuration,'MANAGED_TLS_INVALID');
  await fs.writeFile(configuration.tlsCertificate,valid.cert);
  await fs.writeFile(configuration.tlsKey,expired.key);
  await check(configuration,'MANAGED_TLS_INVALID');
  await fs.writeFile(configuration.tlsCertificate,expired.cert);
  await check(configuration,'MANAGED_TLS_INVALID');
  await fs.writeFile(configuration.tlsCertificate,valid.cert+'\n-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----\n');
  await fs.writeFile(configuration.tlsKey,valid.key);
  await check(configuration,'MANAGED_TLS_INVALID');
  await fs.writeFile(configuration.tlsCertificate,valid.cert+'\n'+valid.ca);
  await check({...configuration,apiBase:'https://wrong.shenyi.example'},'MANAGED_TLS_INVALID');
  await check({...configuration,serverId:randomUUID()},'MANAGED_DATABASE_NOT_READY');
  await check(configuration);

  const withSms={...configuration,reviewedRecovery:true,smsProfile:path.join(f.directory,'sms.json')};
  await check(withSms,'MANAGED_SMS_INVALID');
  await fs.writeFile(withSms.smsProfile,JSON.stringify({schemaVersion:1,provider:'aliyun',
    accessKeyId:'synthetic-key',accessKeySecret:'synthetic-only',phonePepper:Buffer.alloc(32,42).toString('base64url'),signName:'合成测试',
    templates:{bind:'SMS_1001',reset:'SMS_1002',activate:'SMS_1003','first-admin':'SMS_1004'}}));
  await check(withSms);
  const withWechat={...withSms,apiBase:'https://login.shenyi.example',wechatProfile:path.join(f.directory,'wechat.json')};
  await fs.writeFile(withWechat.wechatProfile,JSON.stringify({schemaVersion:1,provider:'wechat-open-platform',appSecret:'synthetic-only'}));
  await check(withWechat,'MANAGED_WECHAT_INVALID');
});

test('first pilot preflight requires local SMS, activation schema and an eligible reviewer while ordinary startup remains available', async t => {
  const f = await databasePreflightFixture(t);
  const guard = await startupNetworkGuard(f.directory);
  const {createOwnerReviewCheckoutCertificate} = await import('../scripts/owner-review-checkout-certificate.mjs');
  const {hashPassword} = await import('../server/team/passwords.mjs');
  const {key,cert} = createOwnerReviewCheckoutCertificate();
  const {configuration} = f;
  const smsProfile = path.join(f.directory,'sms.json');
  await fs.writeFile(configuration.tlsCertificate,cert);
  await fs.writeFile(configuration.tlsKey,key);
  await fs.writeFile(smsProfile,JSON.stringify({schemaVersion:1, provider:'aliyun', accessKeyId:'synthetic-key',
    accessKeySecret:'synthetic-only', phonePepper:Buffer.alloc(32,42).toString('base64url'), signName:'合成测试',
    templates:{bind:'SMS_1001',reset:'SMS_1002',activate:'SMS_1003','first-admin':'SMS_1004'}}));

  async function check({mode='--check-pilot-readiness', code} = {}) {
    const before = await preflightFileFacts(f.directory);
    const {error,stdout,stderr} = await runPreflightCli(f.filename,guard,mode);
    if (code) {
      assert.equal(error?.code,1,stderr);
      assert.equal(stdout,'');
      const report = JSON.parse(stderr);
      assert.deepEqual(Object.keys(report).sort(),['code','event','message']);
      assert.equal(report.event,'error');
      assert.equal(report.code,code);
      assert.doesNotMatch(stderr,/pilot-reviewer|13800138000|synthetic-only|PRIVATE KEY|\.json/);
    } else {
      assert.equal(error,null,stderr);
      assert.equal(stderr,'');
      assert.deepEqual(JSON.parse(stdout),{event:mode==='--check-startup'?'startup-ready':'pilot-ready'});
    }
    assert.deepEqual(await preflightFileFacts(f.directory),before);
  }

  await fs.writeFile(f.filename,JSON.stringify(configuration));
  await check({mode:'--check-startup'});
  await check({code:'MANAGED_PILOT_SMS_REQUIRED'});
  await fs.writeFile(f.filename,JSON.stringify({...configuration,smsProfile}));
  await check({code:'MANAGED_PILOT_SCHEMA_NOT_READY'});
  function edit(operation) {
    const db = new DatabaseSync(configuration.database);
    try { operation(db); } finally { db.close(); }
  }
  const pilotSchema = await fs.readFile(path.resolve(__dirname,'../server/team/pilot-approval-schema.sql'),'utf8');
  const passwordHash = await hashPassword('SyntheticOnly!2026');
  edit(db => {
    db.exec(pilotSchema);
    db.prepare("INSERT INTO team_users (user_id,status) VALUES ('pilot-reviewer','active')").run();
    db.prepare("INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES ('pilot-reviewer','pilot-reviewer','合成审核员',?)").run(passwordHash);
    db.prepare("INSERT INTO team_platform_reviewers(user_id,permission,status) VALUES ('pilot-reviewer','team.provision','active')").run();
    db.prepare("INSERT INTO team_pilot_approval_reviewers(user_id,permission,status) VALUES ('pilot-reviewer','team.pilot.approve','active')").run();
  });
  await check({code:'MANAGED_PILOT_REVIEWER_NOT_READY'});
  edit(db => db.prepare("INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES ('pilot-reviewer','+8613800138000',?)").run(Date.now()));
  edit(db => db.exec("UPDATE team_credentials SET password_hash='invalid-format' WHERE user_id='pilot-reviewer'"));
  await check({code:'MANAGED_PILOT_REVIEWER_NOT_READY'});
  edit(db => db.prepare("UPDATE team_credentials SET password_hash=? WHERE user_id='pilot-reviewer'").run(passwordHash));
  // A reviewer without binding history can still complete normal first enrollment.
  await check();
  const deviceId = randomUUID();
  const deviceKey = generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'});
  const encodedDeviceKey = deviceKey.toString('base64url');
  const fingerprint = createHash('sha256').update(deviceKey).digest('hex');
  edit(db => db.prepare(`INSERT INTO team_device_bindings
    (device_id,user_id,public_key,key_fingerprint,display_name,platform,status,revision,bound_at)
    VALUES (?,'pilot-reviewer',?,?,'合成审核员电脑','win32','active',1,?)`)
    .run(deviceId,encodedDeviceKey,fingerprint,Date.now()-1000));
  await check();
  edit(db => db.prepare("UPDATE team_device_bindings SET status='revoked',revision=2,revoked_at=? WHERE device_id=?")
    .run(Date.now(),deviceId));
  await check({code:'MANAGED_PILOT_REVIEWER_NOT_READY'});
  await check({mode:'--check-startup'});
  edit(db => {
    db.prepare("INSERT INTO team_users (user_id,status) VALUES ('pilot-reviewer-standby','active')").run();
    db.prepare(`INSERT INTO team_credentials(user_id,username,display_name,password_hash)
      VALUES ('pilot-reviewer-standby','pilot-reviewer-standby','合成备用审核员',?)`).run(passwordHash);
    db.prepare(`INSERT INTO team_phone_credentials(user_id,phone,verified_at)
      VALUES ('pilot-reviewer-standby','+8613800138001',?)`).run(Date.now());
    db.prepare(`INSERT INTO team_platform_reviewers(user_id,permission,status)
      VALUES ('pilot-reviewer-standby','team.provision','active')`).run();
    db.prepare(`INSERT INTO team_pilot_approval_reviewers(user_id,permission,status)
      VALUES ('pilot-reviewer-standby','team.pilot.approve','active')`).run();
  });
  await check();
  let activitySchema;
  edit(db => {
    activitySchema = db.prepare("SELECT sql FROM main.sqlite_schema WHERE name='team_activity'").get().sql;
    db.exec('DROP TABLE team_activity');
  });
  await check({code:'MANAGED_PILOT_SCHEMA_NOT_READY'});
  edit(db => db.exec(activitySchema));
  edit(db => db.exec("UPDATE team_pilot_approval_reviewers SET status='revoked',revision=2"));
  await check({code:'MANAGED_PILOT_REVIEWER_NOT_READY'});
  edit(db => db.exec('DROP TRIGGER pilot_approval_no_update'));
  await check({code:'MANAGED_PILOT_SCHEMA_NOT_READY'});
  await check({mode:'--check-startup'});
});
