'use strict';
// Real strict server/SQLite. Synthetic key material remains only in test memory;
// the OS vault itself has separate native acceptance.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{generateKeyPairSync,sign,createHash,randomUUID}=require('node:crypto');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const {createTeamClient,API_BASE}=require('../desktop/team-client.cjs'),proof=require('../shared/device-proof.cjs');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-15T13:00:00Z'),PASSWORD='ShenyiDemo!2026';
const POLICY={appId:'wx0123456789abcdef',redirectUri:'https://login.shenyi.invalid/api/auth/wechat/callback'};
const hash=value=>createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function syntheticVault(){
 const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url'),fingerprint=proof.parsePublicKey(publicKey).fingerprint,state={unavailable:false,holdChallenge:null,requests:[]};
 return {state,vault:{
  async getPublicIdentity(){if(state.unavailable)throw Error('synthetic secret path must not escape');return {publicKey,fingerprint};},
  async signChallenge(fields,context){assert.deepEqual(Object.keys(context).sort(),['bindingRevision','purpose','serverId','sessionToken','userId']);assert.equal(fields.sessionBinding,proof.sessionBinding(context.sessionToken));for(const key of ['purpose','serverId','userId','bindingRevision'])assert.equal(fields[key],context[key]);assert.equal(fields.keyFingerprint,fingerprint);if(state.holdChallenge)await state.holdChallenge();return sign(null,proof.challengeBytes(fields),pair.privateKey).toString('base64url');},
  async signRequest(fields,context){assert.deepEqual(Object.keys(context).sort(),['bindingRevision','deviceId','keyFingerprint','leaseId','serverId','sessionToken','userId']);assert.equal(fields.sessionBinding,proof.sessionBinding(context.sessionToken));assert.equal(context.keyFingerprint,fingerprint);for(const key of ['serverId','userId','deviceId','bindingRevision','leaseId'])assert.equal(fields[key],context[key]);state.requests.push({...fields});return sign(null,proof.requestProofBytes(fields),pair.privateKey).toString('base64url');},
 },publicKey,fingerprint};
}
let baseline;
async function fixture(t,{managed=false}={}){
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');baseline||=(async()=>{const db=new DatabaseSync(':memory:');try{initializeTeamDatabase(db);await seedDemoTeamData(db);return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name+'"').all()}));}finally{db.close();}})();
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);db.exec('BEGIN;PRAGMA defer_foreign_keys=ON;');for(const {name,rows} of await baseline)for(const row of rows){const columns=Object.keys(row);db.prepare('INSERT OR REPLACE INTO "'+name+'"('+columns.map(key=>'"'+key+'"').join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').run(...Object.values(row));}db.exec('COMMIT;');
 db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('intern-a','+8613800000011',NOW-1000);
 const {handleTeamApplicationRequest}=await source('application-api.mjs'),clock={value:NOW},state={offline:false,strict:true,after:null},calls=[],secrets=[],opened=[];
 const apiBase=new URL(POLICY.redirectUri).origin,serverId=db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value;
 const providers={deviceProofRequired:true,wechat:{...POLICY,createAuthorizationUrl({state}){const url=new URL('https://open.weixin.qq.com/connect/qrconnect');for(const [key,value] of Object.entries({appid:POLICY.appId,redirect_uri:POLICY.redirectUri,response_type:'code',scope:'snsapi_login',state}))url.searchParams.set(key,value);return url.href+'#wechat_redirect';},async exchangeCode(){return {appId:POLICY.appId,openId:'synthetic-open'};}}};
 const callApp=(request,strict=true)=>handleTeamApplicationRequest(request,{
  db,now:()=>clock.value,identityProviders:{...providers,deviceProofRequired:strict,...(managed?{wechatLinkRequiresDevice:true}:{})},...(managed?{serviceMode:'managed-service'}:{})});
 const client=(identity=syntheticVault(),options={})=>createTeamClient({deviceIdentity:{vault:identity.vault,platform:'win32',displayName:'合成设备'},now:()=>clock.value,wechatPolicy:POLICY,openAuthorization:async url=>opened.push(url),
  ...(managed?{trustedService:{schemaVersion:1,apiBase,serverId}}:{}),fetchImpl:async(url,settings)=>{
  const route=new URL(url).pathname,call={route,method:settings.method,body:settings.body,headers:settings.headers};calls.push(call);if(state.offline)throw Error('synthetic provider secret must not escape');
  let response=await callApp(new Request(url,settings),state.strict);
  if((response.headers.get('Content-Type')||'').startsWith('application/json')){const data=await response.clone().json();if(data.token)secrets.push(data.token);if(data.lease?.token)secrets.push(data.lease.token);}
  if(state.after){const changed=await state.after(call,response);if(changed)response=changed;}if(managed)Object.defineProperty(response,'url',{value:url});return response;
 },...options});
 const login=(c,username='intern-a')=>c.login({username,password:PASSWORD});
 const enroll=async(c,username='intern-a')=>{const pending=await login(c,username);assert.equal(pending.device.state,'enrollment_required');return c.enrollDevice({displayName:'合成电脑',currentPassword:PASSWORD,confirmed:true});};
 const completeWechat=async()=>{const url=new URL(opened.at(-1)),response=await callApp(new Request(POLICY.redirectUri+'?state='+url.searchParams.get('state')+'&code=synthetic-code'));assert.equal(response.status,200);};
 return {db,clock,state,calls,secrets,opened,client,login,enroll,providers,completeWechat};
}
function noSecrets(value,f){const raw=JSON.stringify(value);for(const secret of f.secrets)assert.equal(raw.includes(secret),false);for(const key of ['publicKey','privateKey','leaseId','sessionToken','Authorization'])assert.equal(raw.includes('"'+key+'"'),false);}
const tasks=c=>c.listTasks({teamId:'team-a'});

test('normal status is local and a bootstrap cannot expose business memberships or perform business RPC',async t=>{
 const f=await fixture(t),c=f.client(),before=f.calls.length;assert.deepEqual(Object.keys(c.getDeviceStatus()).sort(),['device','epoch','expiresAt','localFingerprint','required','state']);assert.equal(c.getDeviceStatus().state,'signed_out');assert.equal(f.calls.length,before);const value=await f.login(c);assert.equal(value.device.state,'enrollment_required');assert.deepEqual(value.memberships,[]);assert.equal(value.device.required,true);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_bindings').get().n,0);const at=f.calls.length;await assert.rejects(tasks(c),{code:'DEVICE_NOT_READY'});assert.equal(f.calls.length,at);assert.deepEqual((await c.getSession()).memberships,[]);noSecrets(value,f);
});
test('first enrollment requires explicit confirmation and current password and returns only a ready safe session',async t=>{
 const f=await fixture(t),c=f.client();await f.login(c);for(const input of [{displayName:'合成电脑',currentPassword:PASSWORD,confirmed:false},{displayName:'合成电脑',currentPassword:'',confirmed:true},{displayName:'合成电脑',currentPassword:PASSWORD,confirmed:true,path:'C:/secret'}])await assert.rejects(c.enrollDevice(input),{code:'INVALID_INPUT'});const ready=await c.enrollDevice({displayName:'合成电脑',currentPassword:PASSWORD,confirmed:true});assert.equal(ready.device.state,'ready');assert.equal(ready.memberships.length,1);assert.equal(ready.device.expiresAt,NOW+900000);assert.equal((await tasks(c)).tasks.length,1);noSecrets(ready,f);
});
test('wrong enrollment password keeps the pending account usable for a correct retry',async t=>{
 const f=await fixture(t),c=f.client();await f.login(c);await assert.rejects(c.enrollDevice({displayName:'合成电脑',currentPassword:'Incorrect synthetic password',confirmed:true}),{code:'HTTP_403'});assert.equal(c.getDeviceStatus().state,'enrollment_required');assert.equal((await c.getSession()).account.id,'intern-a');assert.equal((await c.enrollDevice({displayName:'合成电脑',currentPassword:PASSWORD,confirmed:true})).device.state,'ready');
});
test('logout cancels enrollment without a binding and clears the pending account',async t=>{
 const f=await fixture(t),c=f.client();await f.login(c);const at=c.getDeviceStatus().epoch;await c.logout();assert.equal(c.getDeviceStatus().state,'signed_out');assert.ok(c.getDeviceStatus().epoch>at);assert.equal(await c.getSession(),null);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_bindings').get().n,0);
});
test('same local key signs in through prove while a different key remains blocked and cannot kick it',async t=>{
 const f=await fixture(t),identity=syntheticVault(),a=f.client(identity);await f.enroll(a);await a.logout();const b=f.client(identity),ready=await f.login(b);assert.equal(ready.device.state,'ready');assert.equal(f.calls.filter(call=>call.route==='/api/auth/devices/enroll').length,1);assert.equal(f.calls.filter(call=>call.route==='/api/auth/devices/prove').length,1);const wrong=f.client(),blocked=await f.login(wrong);assert.equal(blocked.device.state,'different_key');assert.deepEqual(blocked.memberships,[]);await assert.rejects(tasks(wrong),{code:'DEVICE_NOT_READY'});assert.equal((await tasks(b)).tasks.length,1);noSecrets(blocked,f);
});
test('revoked device history never becomes a new first-enrollment path',async t=>{
 const f=await fixture(t),identity=syntheticVault(),a=f.client(identity);await f.enroll(a);await a.logout();f.db.prepare("UPDATE team_device_bindings SET status='revoked',revision=revision+1,revoked_at=?").run(NOW);const b=f.client(identity),blocked=await f.login(b);assert.equal(blocked.device.state,'revoked');assert.deepEqual(blocked.memberships,[]);await assert.rejects(b.enrollDevice({displayName:'新电脑',currentPassword:PASSWORD,confirmed:true}),{code:'DEVICE_NOT_READY'});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_bindings').get().n,1);
});
test('phone login uses the identical pending device gate and never auto-enrolls',async t=>{
 const f=await fixture(t),c=f.client(),pending=await c.loginPhone({phone:'13800000011',password:PASSWORD});assert.equal(pending.device.state,'enrollment_required');assert.deepEqual(pending.memberships,[]);assert.equal((await c.enrollDevice({displayName:'合成手机登录电脑',currentPassword:PASSWORD,confirmed:true})).device.state,'ready');noSecrets(pending,f);
});
test('old or non-strict server and unavailable vault both fail closed',async t=>{
 const f=await fixture(t);f.state.strict=false;const c=f.client();await assert.rejects(f.login(c),{code:'DEVICE_CAPABILITY_REQUIRED'});assert.equal(c.getDeviceStatus().state,'paused');await assert.rejects(tasks(c),{code:'DEVICE_NOT_READY'});f.state.strict=true;const identity=syntheticVault();identity.state.unavailable=true;const bad=f.client(identity);await assert.rejects(f.login(bad),{code:'DEVICE_VAULT_UNAVAILABLE'});assert.equal(bad.getDeviceStatus().state,'vault_unavailable');noSecrets(bad.getDeviceStatus(),f);
});
test('protected JSON, literal query and empty HEAD sign exactly the bytes sent to the strict API',async t=>{
 const f=await fixture(t),identity=syntheticVault(),c=f.client(identity);await f.enroll(c);const bytes=Buffer.from('Synthetic client original\0\r\n原件');await c.listTasks({teamId:'team-a',q:'银行'});const sent=await c.upload({teamId:'team-a',taskId:'task-a',revision:0},{filename:'original.txt',bytes});const target={teamId:'team-a',taskId:'task-a',attachmentId:sent.submission.attachmentId};assert.deepEqual(Buffer.from((await c.download(target)).bytes),bytes);assert.deepEqual(await c.checkAttachmentAccess(target),{canDownload:true});const upload=f.calls.find(call=>call.route.endsWith('/submissions')&&call.method==='POST');assert.equal(upload.headers['X-Shenyi-Device-Body-SHA256'],hash(Buffer.from(upload.body)));assert.equal(identity.state.requests.at(-1).method,'HEAD');assert.equal(identity.state.requests.at(-1).bodySha256,hash(Buffer.alloc(0)));assert.equal(new Set(identity.state.requests.map(value=>value.nonce)).size,identity.state.requests.length);noSecrets(sent,f);
});
test('network loss invalidates guards and repeated forced business calls do not contact the server',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);const guard=c.guardSession(),epoch=c.getDeviceStatus().epoch;f.state.offline=true;await assert.rejects(tasks(c),cause=>cause.code==='SERVICE_UNAVAILABLE'&&!cause.message.includes('synthetic provider secret'));assert.equal(c.getDeviceStatus().state,'paused');assert.ok(c.getDeviceStatus().epoch>epoch);assert.throws(guard,{code:'SESSION_CHANGED'});const calls=f.calls.length;await assert.rejects(tasks(c),{code:'DEVICE_NOT_READY'});assert.equal(f.calls.length,calls);f.state.offline=false;const recovered=await c.reconnectDevice();assert.equal(recovered.device.state,'ready');assert.equal((await tasks(c)).tasks.length,1);assert.throws(guard,{code:'SESSION_CHANGED'});
});
test('server-committed mutation followed by transport failure is reported unknown and never replayed',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);let dropped=false;f.state.after=(call)=>{if(!dropped&&call.route.endsWith('/submissions')&&call.method==='POST'){dropped=true;throw Error('synthetic commit then transport loss');}};await assert.rejects(c.upload({teamId:'team-a',taskId:'task-a',revision:0},{filename:'committed.txt',bytes:Buffer.from('committed synthetic')}),cause=>cause.code==='SERVICE_UNAVAILABLE'&&/结果未确认/.test(cause.message)&&/先核对/.test(cause.message));assert.equal(c.getDeviceStatus().state,'paused');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_task_submissions').get().n,1);f.state.after=null;await c.reconnectDevice();assert.equal((await c.getSubmissions({teamId:'team-a',taskId:'task-a'})).submissions.length,1);assert.equal(f.calls.filter(call=>call.route.endsWith('/submissions')&&call.method==='POST').length,1);
});
test('server-committed mutation with malformed JSON is reported unknown and never replayed',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);let changed=false;f.state.after=call=>{if(!changed&&call.route.endsWith('/submissions')&&call.method==='POST'){changed=true;return new Response('{"invalid":',{status:201,headers:{'Content-Type':'application/json'}});}};await assert.rejects(c.upload({teamId:'team-a',taskId:'task-a',revision:0},{filename:'committed.txt',bytes:Buffer.from('committed before malformed synthetic response')}),cause=>cause.code==='INVALID_RESPONSE'&&/结果未确认/.test(cause.message)&&/先核对/.test(cause.message));assert.equal(c.getDeviceStatus().state,'paused');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_task_submissions').get().n,1);f.state.after=null;await c.reconnectDevice();assert.equal((await c.getSubmissions({teamId:'team-a',taskId:'task-a'})).submissions.length,1);assert.equal(f.calls.filter(call=>call.route.endsWith('/submissions')&&call.method==='POST').length,1);
});
test('heartbeat and near-expiry rotation are each single-flight and rotate exactly once',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);const entered=deferred(),release=deferred();f.state.after=async(call)=>{if(call.route==='/api/auth/devices/connection'){entered.resolve();await release.promise;}};const calls=Array.from({length:8},()=>c.checkDeviceConnection());await entered.promise;release.resolve();await Promise.all(calls);assert.equal(f.calls.filter(call=>call.route==='/api/auth/devices/connection').length,1);f.state.after=null;const oldEpoch=c.getDeviceStatus().epoch,guard=c.guardSession();f.clock.value=c.getDeviceStatus().expiresAt-60000;await Promise.all(Array.from({length:8},()=>c.checkDeviceConnection()));assert.equal(f.calls.filter(call=>call.route==='/api/auth/devices/prove').length,1);assert.equal(c.getDeviceStatus().state,'ready');assert.ok(c.getDeviceStatus().epoch>oldEpoch);assert.throws(guard,{code:'SESSION_CHANGED'});
});
test('a replaced old instance clears itself and cannot use a retained bootstrap to steal the lease back',async t=>{
 const f=await fixture(t),identity=syntheticVault(),a=f.client(identity),b=f.client(identity);await f.enroll(a);await f.login(b);const before=f.calls.filter(call=>call.route==='/api/auth/devices/prove').length;await assert.rejects(a.checkDeviceConnection(),{code:'SIGN_IN_REQUIRED'});assert.equal(a.getDeviceStatus().state,'signed_out');assert.equal(await a.getSession(),null);await assert.rejects(a.reconnectDevice(),{code:'SIGN_IN_REQUIRED'});assert.equal(f.calls.filter(call=>call.route==='/api/auth/devices/prove').length,before);assert.equal((await tasks(b)).tasks.length,1);
});
test('natural expiry requires fresh credentials and system resume pauses synchronously',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);const guard=c.guardSession(),before=f.calls.length;c.pauseDeviceConnection();assert.equal(c.getDeviceStatus().state,'paused');assert.throws(guard,{code:'SESSION_CHANGED'});assert.equal(f.calls.length,before);await c.checkDeviceConnection();assert.equal(c.getDeviceStatus().state,'ready');f.clock.value=c.getDeviceStatus().expiresAt;await assert.rejects(c.checkDeviceConnection(),{code:'SIGN_IN_REQUIRED'});assert.equal(c.getDeviceStatus().state,'signed_out');assert.equal(await c.getSession(),null);
});
test('late heartbeat success from an old account cannot pause a new ready account',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);const entered=deferred(),release=deferred();let held=false;f.state.after=async call=>{if(!held&&call.route==='/api/auth/devices/connection'){held=true;entered.resolve();await release.promise;}};const stale=c.checkDeviceConnection();await entered.promise;await c.logout();await f.enroll(c,'assistant-a');const epoch=c.getDeviceStatus().epoch;release.resolve();await assert.rejects(stale,{code:'SESSION_CHANGED'});assert.equal(c.getDeviceStatus().state,'ready');assert.equal(c.getDeviceStatus().epoch,epoch);assert.equal((await c.getSession()).account.id,'assistant-a');
});
test('logout wins over a delayed minted renewal and the late lease is best-effort revoked',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);const entered=deferred(),release=deferred();f.state.after=async call=>{if(call.route==='/api/auth/devices/prove'){entered.resolve();await release.promise;}};const pending=c.reconnectDevice();await entered.promise;try{await c.logout();}catch(cause){assert.equal(cause.code,'SIGN_IN_REQUIRED');}release.resolve();await assert.rejects(pending,{code:'SESSION_CHANGED'});assert.equal(c.getDeviceStatus().state,'signed_out');assert.equal(await c.getSession(),null);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_leases WHERE revoked_at IS NULL').get().n,0);
});
test('WeChat exchange awaits the same device proof and never returns a Promise as session',async t=>{
 const f=await fixture(t),identity=syntheticVault(),c=f.client(identity);await f.enroll(c);await c.logout();f.db.prepare('INSERT INTO team_wechat_identities VALUES (?,?,?,?)').run(POLICY.appId,'synthetic-open','intern-a',NOW);await c.startWechatLogin();await f.completeWechat();const result=await c.pollWechatLogin();assert.equal(result.status,'signed_in');assert.equal(typeof result.session?.then,'undefined');assert.equal(result.session.device.state,'ready');assert.equal((await tasks(c)).tasks.length,1);noSecrets(result,f);
});
test('cancel during WeChat device signing clears its bootstrap and prevents a late proof install',async t=>{
 const f=await fixture(t),identity=syntheticVault(),c=f.client(identity);await f.enroll(c);await c.logout();f.db.prepare('INSERT INTO team_wechat_identities VALUES (?,?,?,?)').run(POLICY.appId,'synthetic-open','intern-a',NOW);await c.startWechatLogin();await f.completeWechat();const entered=deferred(),release=deferred();identity.state.holdChallenge=async()=>{entered.resolve();await release.promise;};const pending=c.pollWechatLogin();await entered.promise;await c.cancelWechatLogin();release.resolve();await assert.rejects(pending,{code:'SESSION_CHANGED'});assert.equal(await c.getSession(),null);assert.equal(c.getDeviceStatus().state,'signed_out');assert.equal(f.calls.filter(call=>call.route==='/api/auth/devices/prove').length,0);
});
test('WeChat cancellation retains authority over its completed main result until a later login replaces it',async t=>{
 const f=await fixture(t),identity=syntheticVault(),c=f.client(identity);await f.enroll(c);await c.logout();f.db.prepare('INSERT INTO team_wechat_identities VALUES (?,?,?,?)').run(POLICY.appId,'synthetic-open','intern-a',NOW);await c.startWechatLogin();await f.completeWechat();const result=await c.pollWechatLogin();assert.equal(result.session.device.state,'ready');await c.cancelWechatLogin();assert.equal(c.getDeviceStatus().state,'signed_out');assert.equal(await c.getSession(),null);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_leases WHERE revoked_at IS NULL').get().n,0);await f.login(c,'assistant-a');await c.cancelWechatLogin();assert.equal((await c.getSession()).account.id,'assistant-a');assert.equal(c.getDeviceStatus().state,'enrollment_required');
});
test('tampered challenge server identity is never signed or adopted',async t=>{
 const f=await fixture(t),c=f.client();await f.login(c);f.state.after=async(call,response)=>{if(call.route==='/api/auth/devices/enrollment-challenges'){const value=await response.json();value.challenge.serverId=randomUUID();return new Response(JSON.stringify(value),{status:201,headers:{'Content-Type':'application/json'}});}};await assert.rejects(c.enrollDevice({displayName:'合成电脑',currentPassword:PASSWORD,confirmed:true}),{code:'INVALID_RESPONSE'});assert.equal(c.getDeviceStatus().state,'paused');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_bindings').get().n,0);
});


const associationInput={phone:'13800000011',password:PASSWORD};
async function startManagedAssociation(f,client){
 await client.startWechatLogin();
 await f.completeWechat();
 assert.equal((await client.pollWechatLogin()).status,'binding_required');
}
async function enrollManaged(client){
 const first=await client.loginPhone(associationInput);
 assert.equal(first.device.state,'enrollment_required');
 const value=await client.enrollDevice({displayName:'合成已绑定电脑',currentPassword:PASSWORD,confirmed:true});
 assert.equal(value.device.state,'ready');
 await client.logout();
}
const activeLeases=f=>f.db.prepare('SELECT COUNT(*) n FROM team_device_leases WHERE revoked_at IS NULL').get().n;
const activeSessions=f=>f.db.prepare('SELECT COUNT(*) n FROM team_sessions WHERE revoked_at IS NULL').get().n;
const associationCount=f=>f.db.prepare('SELECT COUNT(*) n FROM team_wechat_identities').get().n;

test('managed first association requires an existing device and signs exactly the link with its private temporary lease',async t=>{
 const f=await fixture(t,{managed:true}),identity=syntheticVault(),c=f.client(identity);
 await enrollManaged(c);
 await startManagedAssociation(f,c);
 const commonTables=['team_users','teams','team_memberships','team_operators','team_employee_invitations','team_device_bindings'];
 const inventory=()=>Object.fromEntries(commonTables.map(name=>[name,f.db.prepare('SELECT * FROM '+name).all()]));
 const before=inventory();
 const result=await c.linkWechatAccount(associationInput);
 assert.equal(result.status,'signed_in');
 assert.equal(result.session.account.id,'intern-a');
 assert.deepEqual(result.session.memberships,[{teamId:'team-a',role:'intern'}]);
 assert.equal(result.session.device.state,'ready');
 assert.deepEqual(inventory(),before);
 assert.equal(associationCount(f),1);
 const link=f.calls.find(call=>call.route.endsWith('/link'));
 const proofs=f.calls.filter(call=>call.route==='/api/auth/devices/prove');
 assert.equal(proofs.length,2);
 assert.ok(link.headers['X-Shenyi-Device-Lease']);
 assert.equal(link.headers['X-Shenyi-Device-Body-SHA256'],hash(link.body));
 assert.ok(identity.state.requests.some(fields=>fields.pathAndQuery===link.route&&fields.bodySha256===hash(link.body)));
 assert.ok(f.calls.some(call=>call.route==='/api/auth/logout'&&call.headers.Authorization===link.headers.Authorization));
 assert.equal(activeSessions(f),1);
 assert.equal(activeLeases(f),1);
 noSecrets(result,f);
 await c.logout();
 assert.equal(activeSessions(f),0);
 assert.equal(activeLeases(f),0);
});

test('managed first association on an unbound or different computer does not dispatch link, enroll or leave a session',async t=>{
 for(const bindAnotherDevice of [false,true]){
  const f=await fixture(t,{managed:true});
  if(bindAnotherDevice)await enrollManaged(f.client());
  const c=f.client();
  await startManagedAssociation(f,c);
  const startedAt=f.calls.length;
  await assert.rejects(c.linkWechatAccount(associationInput),{code:'DEVICE_NOT_READY'});
  const dispatched=f.calls.slice(startedAt).map(call=>call.route);
  assert.equal(dispatched.some(route=>/\/(link|exchange|enroll|prove)$/.test(route)),false);
  assert.ok(dispatched.includes('/api/auth/logout'));
  assert.equal(associationCount(f),0);
  assert.equal(activeSessions(f),0);
  assert.equal(activeLeases(f),0);
  assert.equal(await c.getSession(),null);
  assert.equal(c.getDeviceStatus().state,'signed_out');
 }
});

test('managed cancellation during late temporary device proof revokes the minted proof without dispatching link',async t=>{
 const f=await fixture(t,{managed:true}),c=f.client();
 await enrollManaged(c);
 await startManagedAssociation(f,c);
 const entered=deferred(),release=deferred();
 f.state.after=async(call,response)=>{
  if(call.route==='/api/auth/devices/prove'&&response.ok){entered.resolve();await release.promise;}
 };
 const pending=c.linkWechatAccount(associationInput);
 const rejected=assert.rejects(pending,{code:'SESSION_CHANGED'});
 await entered.promise;
 assert.equal(activeLeases(f),1);
 try{await c.cancelWechatLogin();}finally{release.resolve();}
 await rejected;
 assert.equal(f.calls.some(call=>call.route.endsWith('/link')),false);
 assert.equal(associationCount(f),0);
 assert.equal(activeSessions(f),0);
 assert.equal(activeLeases(f),0);
 assert.equal(await c.getSession(),null);
});

test('managed desktop disables its browser policy when the trusted service origin disagrees',async t=>{
 const f=await fixture(t,{managed:true}),c=f.client(undefined,{wechatPolicy:{...POLICY,redirectUri:'https://separate.synthetic.invalid/api/auth/wechat/callback'}});
 const result=await c.getAuthMethods();
 assert.equal(result.methods.wechat,true);
 assert.equal(result.desktopWechatReady,false);
 await assert.rejects(c.startWechatLogin(),{code:'WECHAT_UNAVAILABLE'});
 assert.deepEqual(f.opened,[]);
});
