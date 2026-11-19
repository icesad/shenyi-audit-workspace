'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
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
  const guard=path.join(f.directory,'no-startup-network.cjs');
  await fs.writeFile(guard, `'use strict';
const forbidden=()=>{process.stderr.write('unexpected network');process.exit(97);};
require('node:net').Server.prototype.listen=forbidden;
require('node:net').Socket.prototype.connect=forbidden;
globalThis.fetch=forbidden;
`,{flag:'wx'});

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
