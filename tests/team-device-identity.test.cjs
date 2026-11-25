'use strict';
// Real SQLite/application boundaries; synthetic private keys live only in memory.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{generateKeyPairSync,sign,randomBytes,randomUUID,createHash}=require('node:crypto');
const {readFileSync}=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const proof=require('../shared/device-proof.cjs');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-15T12:00:00Z'),ORIGIN='http://127.0.0.1:8774',ROOT='/api/auth/devices',PASSWORD='ShenyiDemo!2026';
const hash=value=>createHash('sha256').update(value).digest('hex');
function keys(){const pair=generateKeyPairSync('ed25519');return {...pair,encoded:pair.publicKey.export({format:'der',type:'spki'}).toString('base64url')};}
let baseline;
async function fixture(t){
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs'),{ensureDeviceServerId}=await source('device-policy.mjs');
 const initialize=db=>{initializeTeamDatabase(db);db.exec(readFileSync(path.resolve(__dirname,'../server/team/device-schema.sql'),'utf8'));ensureDeviceServerId(db);};
 baseline||=(async()=>{const db=new DatabaseSync(':memory:');try{initialize(db);await seedDemoTeamData(db);return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name+'"').all()}));}finally{db.close();}})();
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());initialize(db);db.exec('BEGIN;PRAGMA defer_foreign_keys=ON;');for(const {name,rows} of await baseline)for(const row of rows){const columns=Object.keys(row);db.prepare('INSERT OR REPLACE INTO "'+name+'"('+columns.map(key=>'"'+key+'"').join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').run(...Object.values(row));}db.exec('COMMIT;');
 const {issueSession}=await source('auth-api.mjs'),{handleTeamApplicationRequest}=await source('application-api.mjs'),{handleDeviceIdentityRequest}=await source('device-api.mjs'),{authorizeDeviceRequest}=await source('device-gate.mjs'),{ApiError,json}=await source('http-utils.mjs');
 const clock={value:NOW},tokens={};for(const actor of ['intern-a','assistant-a','manager-a','partner-a'])tokens[actor]=issueSession(db,actor,NOW).token;
 const session=(actor='intern-a')=>issueSession(db,actor,clock.value).token;
 const dispatch=async(request,{strict=false}={})=>{
  // Use the actual product application once root's central integration exists;
  // direct device routing is also available to exercise the exported API itself.
  const response=await handleTeamApplicationRequest(request,{db,now:()=>clock.value,identityProviders:{deviceProofRequired:strict}});assert.ok(response);const bytes=Buffer.from(await response.arrayBuffer()),raw=bytes.toString('utf8');
  for(const secret of ['password_hash','token_hash','SELECT ','synthetic device audit failure'])assert.equal(raw.includes(secret),false);
  return {status:response.status,data:(response.headers.get('Content-Type')||'').startsWith('application/json')&&raw?JSON.parse(raw):null,bytes,raw,headers:response.headers};
 };
 const call=(route=ROOT,{actor='intern-a',token=tokens[actor],body,method=body===undefined?'GET':'POST',headers={},strict=false}={})=>dispatch(new Request(ORIGIN+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),{strict});
 const challenge=async(purpose='enroll',key=keys(),{token=tokens['intern-a'],revision=1,password=PASSWORD,actor='intern-a'}={})=>{
  const action={enroll:'enrollment-challenges',prove:'proof-challenges',revoke:'revocation-challenges'}[purpose];
  const body={publicKey:key.encoded,...(purpose==='enroll'?{displayName:'合成电脑',platform:'win32',currentPassword:password}:purpose==='revoke'?{revision,currentPassword:password}:{})};
  const response=await call(ROOT+'/'+action,{actor,token,body});return {response,fields:response.data?.challenge,key,token};
 };
 const complete=(value,{purpose=value.fields.purpose,token=value.token,signature=sign(null,proof.challengeBytes(value.fields),value.key.privateKey).toString('base64url')}={})=>call(ROOT+'/'+purpose,{token,body:{challengeId:value.fields.challengeId,signature}});
 const enroll=async()=>{const pending=await challenge();assert.equal(pending.response.status,201,pending.response.raw);const response=await complete(pending);assert.equal(response.status,201,response.raw);return {data:response.data,key:pending.key,challenge:pending};};
 const signed=(route,login,{method='GET',body,nonce=randomBytes(32).toString('base64url'),claimedHash,headers={}}={})=>{
  const bytes=body===undefined?Buffer.alloc(0):Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  const fields={serverId:login.data.lease.serverId,userId:login.data.account.id,sessionBinding:proof.sessionBinding(login.data.token),deviceId:login.data.lease.deviceId,bindingRevision:login.data.lease.bindingRevision,leaseId:login.data.lease.id,method,pathAndQuery:route,bodySha256:claimedHash??hash(bytes),nonce};
  return new Request(ORIGIN+route,{method,headers:{Authorization:'Bearer '+login.data.token,'Content-Type':'application/json','X-Shenyi-Device-Lease':login.data.lease.token,'X-Shenyi-Device-Nonce':nonce,'X-Shenyi-Device-Body-SHA256':fields.bodySha256,'X-Shenyi-Device-Signature':sign(null,proof.requestProofBytes(fields),login.key.privateKey).toString('base64url'),...headers},...(body===undefined?{}:{body:bytes})});
 };
 return {db,clock,tokens,session,call,dispatch,challenge,complete,enroll,signed,ensureDeviceServerId,authorizeDeviceRequest,handleDeviceIdentityRequest,ApiError,json};
}
function count(f,table){return f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n;}
function deviceState(f){return ['team_device_bindings','team_device_challenges','team_device_leases','team_device_request_replays','team_device_events','team_sessions'].map(name=>({name,rows:f.db.prepare('SELECT * FROM '+name).all()}));}
const TASKS='/api/teams/team-a/collection/tasks';

test('own device status is minimal and a new account can enroll without creating state on GET',async t=>{
 const f=await fixture(t),before=deviceState(f),result=await f.call();assert.equal(result.status,200);assert.deepEqual(result.data,{hasHistory:false,canEnroll:true,device:null});assert.deepEqual(deviceState(f),before);assert.equal((await f.call(ROOT+'?userId=partner-a')).status,400);
});
test('enrollment challenge is canonical, session scoped, nonce based and exactly two minutes',async t=>{
 const f=await fixture(t),pending=await f.challenge();assert.equal(pending.response.status,201,pending.response.raw);assert.deepEqual(Object.keys(pending.fields),proof.CHALLENGE_FIELDS);assert.equal(pending.fields.sessionBinding,proof.sessionBinding(f.tokens['intern-a']));assert.equal(pending.fields.keyFingerprint,proof.parsePublicKey(pending.key.encoded).fingerprint);assert.equal(pending.fields.expiresAt-pending.fields.issuedAt,120000);assert.equal(pending.fields.bindingRevision,0);assert.equal(proof.nonceBytes(pending.fields.nonce).length,32);assert.equal(count(f,'team_device_bindings'),0);
});
test('wrong enrollment password, unsupported platform and malformed keys fail without binding',async t=>{
 const f=await fixture(t),key=keys();assert.equal((await f.challenge('enroll',key,{password:'Incorrect synthetic password'})).response.status,403);
 for(const extra of [{platform:'linux'},{displayName:'\u200funsafe'},{publicKey:key.encoded+'A'},{publicKey:'-----BEGIN PUBLIC KEY-----'}])assert.equal((await f.call(ROOT+'/enrollment-challenges',{body:{publicKey:key.encoded,displayName:'合成电脑',platform:'win32',currentPassword:PASSWORD,...extra}})).status,400);assert.equal(count(f,'team_device_bindings'),0);
});
test('first enrollment issues a new immutable business session and a fifteen minute lease',async t=>{
 const f=await fixture(t),login=await f.enroll();assert.notEqual(login.data.token,f.tokens['intern-a']);assert.equal(login.data.expiresAt,NOW+15*60000);assert.equal(login.data.lease.expiresAt,login.data.expiresAt);assert.equal(count(f,'team_device_bindings'),1);assert.equal(count(f,'team_device_leases'),1);assert.equal(count(f,'team_device_events'),1);assert.equal((await f.call('/api/auth/session')).status,401);
 const lease=f.db.prepare('SELECT * FROM team_device_leases').get();assert.equal(lease.auth_session_hash,proof.sessionBinding(login.data.token));assert.equal(lease.token_hash,hash(login.data.lease.token));assert.equal(lease.expires_at,login.data.expiresAt);const own=await f.call(ROOT,{token:login.data.token});assert.deepEqual(Object.keys(own.data.device).sort(),['boundAt','displayName','id','keyFingerprint','platform','revision','revokedAt','status']);assert.equal(own.data.canEnroll,false);
});
test('password-only bootstrap and wrong-key attempts never kick the proved instance',async t=>{
 const f=await fixture(t),login=await f.enroll(),bootstrap=f.session();assert.equal((await f.challenge('prove',keys(),{token:bootstrap})).response.status,409);assert.equal((await f.call('/api/auth/session',{token:login.data.token})).status,200);assert.equal((await f.dispatch(f.signed(TASKS,login),{strict:true})).status,200);assert.equal(f.db.prepare('SELECT revoked_at FROM team_device_leases').get().revoked_at,null);
});
test('new proved login kicks all old business sessions and its initiator but retains unrelated bootstraps',async t=>{
 const f=await fixture(t),old=await f.enroll(),initiator=f.session(),otherBootstrap=f.session(),pending=await f.challenge('prove',old.key,{token:initiator});assert.equal(pending.response.status,201);const fresh=await f.complete(pending);assert.equal(fresh.status,200,fresh.raw);assert.notEqual(fresh.data.token,old.data.token);for(const token of [old.data.token,initiator])assert.equal((await f.call('/api/auth/session',{token})).status,401);assert.equal((await f.call('/api/auth/session',{token:otherBootstrap})).status,200);assert.equal((await f.call('/api/auth/session',{token:fresh.data.token})).status,200);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_leases WHERE revoked_at IS NULL').get().n,1);
});
test('signed revocation keeps history and prevents first-enrollment reuse forever',async t=>{
 const f=await fixture(t),login=await f.enroll(),other=f.session(),pending=await f.challenge('revoke',login.key,{token:login.data.token});assert.equal(pending.response.status,201,pending.response.raw);assert.deepEqual((await f.complete(pending)).data,{revoked:true});for(const token of [login.data.token,other])assert.equal((await f.call('/api/auth/session',{token})).status,401);const bootstrap=f.session(),status=await f.call(ROOT,{token:bootstrap});assert.equal(status.data.hasHistory,true);assert.equal(status.data.canEnroll,false);assert.equal(status.data.device.status,'revoked');assert.equal(status.data.device.revision,2);assert.equal((await f.challenge('enroll',login.key,{token:bootstrap})).response.status,409);assert.equal(count(f,'team_device_bindings'),1);
});
test('challenge user, exact initiating token and purpose are not interchangeable',async t=>{
 const f=await fixture(t),pending=await f.challenge(),other=f.session();assert.equal((await f.complete(pending,{token:f.tokens['assistant-a']})).status,404);assert.equal((await f.complete(pending,{token:other})).status,404);assert.equal((await f.complete(pending,{purpose:'prove'})).status,404);assert.equal((await f.complete(pending)).status,201);
});
test('five wrong signatures revoke the challenge and never create a device',async t=>{
 const f=await fixture(t),pending=await f.challenge(),signature=Buffer.alloc(64).toString('base64url');for(let i=0;i<5;i++)assert.equal((await f.complete(pending,{signature})).status,403);const row=f.db.prepare('SELECT attempts,revoked_at FROM team_device_challenges').get();assert.equal(row.attempts,5);assert.equal(row.revoked_at,NOW);assert.equal((await f.complete(pending)).status,409);assert.equal(count(f,'team_device_bindings'),0);
});
test('expired challenge rejects exactly at its server deadline',async t=>{
 const f=await fixture(t),pending=await f.challenge();f.clock.value=pending.fields.expiresAt;assert.equal((await f.complete(pending)).status,410);assert.equal(f.db.prepare('SELECT consumed_at FROM team_device_challenges').get().consumed_at,null);
});
test('identity ABA or server identity changes invalidate a signed challenge',async t=>{
 const f=await fixture(t),pending=await f.challenge();f.db.prepare("UPDATE team_memberships SET status='disabled' WHERE user_id='intern-a'").run();f.db.prepare("UPDATE team_memberships SET status='active' WHERE user_id='intern-a'").run();assert.equal((await f.complete(pending)).status,409);const next=await f.challenge();f.db.prepare("UPDATE team_database_metadata SET value=? WHERE name='device-server-id'").run(randomUUID());assert.equal((await f.complete(next)).status,409);assert.equal(count(f,'team_device_bindings'),0);
});
test('concurrent completion produces only one binding, lease, event and new business session',async t=>{
 const f=await fixture(t),pending=await f.challenge(),results=await Promise.all([f.complete(pending),f.complete(pending)]);assert.equal(results.filter(row=>row.status===201).length,1);assert.ok(results.some(row=>[401,409].includes(row.status)));for(const table of ['team_device_bindings','team_device_leases','team_device_events'])assert.equal(count(f,table),1);
});
test('binding or lease audit/storage failure rolls back challenge consumption and old-session revocation',async t=>{
 const f=await fixture(t),pending=await f.challenge();f.db.exec("CREATE TRIGGER device_audit_abort BEFORE INSERT ON team_device_events BEGIN SELECT RAISE(ABORT,'synthetic device audit failure'); END");const before=deviceState(f);assert.equal((await f.complete(pending)).status,503);assert.deepEqual(deviceState(f),before);f.db.exec('DROP TRIGGER device_audit_abort');assert.equal((await f.complete(pending)).status,201);
});
test('failed proved replacement leaves the old instance and pending proof intact',async t=>{
 const f=await fixture(t),login=await f.enroll(),bootstrap=f.session(),pending=await f.challenge('prove',login.key,{token:bootstrap});f.db.exec("CREATE TRIGGER device_lease_abort BEFORE INSERT ON team_device_leases BEGIN SELECT RAISE(ABORT,'synthetic device audit failure'); END");const before=deviceState(f);assert.equal((await f.complete(pending)).status,503);assert.deepEqual(deviceState(f),before);assert.equal((await f.call('/api/auth/session',{token:login.data.token})).status,200);
});
test('binding revision ceiling refuses revocation before an unsafe increment',async t=>{
 const f=await fixture(t),login=await f.enroll();f.db.prepare('UPDATE team_device_bindings SET revision=?').run(Number.MAX_SAFE_INTEGER);assert.equal((await f.challenge('revoke',login.key,{token:login.data.token,revision:Number.MAX_SAFE_INTEGER})).response.status,409);assert.equal(f.db.prepare('SELECT status FROM team_device_bindings').get().status,'active');
});
test('server identity is stable, corruption fails closed and history prevents regeneration',async t=>{
 const f=await fixture(t),id=f.ensureDeviceServerId(f.db);assert.equal(f.ensureDeviceServerId(f.db),id);await f.challenge();f.db.prepare("DELETE FROM team_database_metadata WHERE name='device-server-id'").run();assert.throws(()=>f.ensureDeviceServerId(f.db));f.db.prepare("INSERT INTO team_database_metadata VALUES ('device-server-id','invalid')").run();assert.throws(()=>f.ensureDeviceServerId(f.db));
});
test('strict mode admits only exact bootstrap routes and protects audit and account high-risk routes',async t=>{
 const f=await fixture(t);assert.equal((await f.call('/api/auth/session',{strict:true})).status,200);assert.equal((await f.call(ROOT,{strict:true})).status,200);for(const route of [TASKS,'/api/auth/password','/api/auth/phone/bind','/api/auth/sessions','/api/auth/team-administration','/api/auth/member-management/access','/api/operations/team-requests','/api/account/recovery-reviews']){const result=await f.call(route,{strict:true});assert.equal(result.status,403,route+' '+result.raw);}assert.equal((await f.call('/api/auth/session?bypass=true',{strict:true})).status,403);
});
test('signed strict reads preserve the existing junior task scope and literal query',async t=>{
 const f=await fixture(t),login=await f.enroll();const allowed=await f.dispatch(f.signed(TASKS+'?q='+encodeURIComponent('银行'),login),{strict:true});assert.equal(allowed.status,200,allowed.raw);assert.deepEqual(allowed.data.tasks.map(row=>row.id),['task-a']);const tampered=f.signed(TASKS,login);const changed=new Request(ORIGIN+TASKS+'?role=partner',{headers:tampered.headers});assert.equal((await f.dispatch(changed,{strict:true})).status,403);
});
test('strict upload dispatch receives exact authenticated body bytes and HEAD is also signed and bodyless',async t=>{
 const f=await fixture(t),login=await f.enroll(),bytes=Buffer.from('Synthetic strict original\0\r\n原件');const body={filename:'strict.txt',contentBase64:bytes.toString('base64'),revision:0};const submitted=await f.dispatch(f.signed(TASKS+'/task-a/submissions',login,{method:'POST',body}),{strict:true});assert.equal(submitted.status,201,submitted.raw);assert.equal(submitted.data.submission.sha256,hash(bytes));assert.deepEqual(Buffer.from(f.db.prepare('SELECT bytes FROM team_collection_attachments WHERE attachment_id=?').get(submitted.data.submission.attachmentId).bytes),bytes);const route=TASKS+'/task-a/attachments/'+submitted.data.submission.attachmentId;const head=await f.dispatch(f.signed(route,login,{method:'HEAD'}),{strict:true});assert.equal(head.status,200,head.raw);assert.equal(head.bytes.length,0);const missing=await f.call(route,{method:'HEAD',token:login.data.token,strict:true});assert.equal(missing.status,403);assert.equal(missing.bytes.length,0);
});
test('a per-lease nonce is consumed once and an identical proof cannot replay a request',async t=>{
 const f=await fixture(t),login=await f.enroll(),request=f.signed(TASKS,login);assert.equal((await f.dispatch(request,{strict:true})).status,200);assert.equal((await f.dispatch(new Request(request.url,{headers:request.headers}),{strict:true})).status,409);assert.equal(count(f,'team_device_request_replays'),1);
});
test('signed declared hash must equal the actual bounded body before JSON dispatch',async t=>{
 const f=await fixture(t),login=await f.enroll(),request=f.signed(TASKS+'/task-a/submissions',login,{method:'POST',body:{revision:0},claimedHash:hash('different bytes')});assert.equal((await f.dispatch(request,{strict:true})).status,403);assert.equal(count(f,'team_device_request_replays'),0);assert.equal(count(f,'team_task_submissions'),0);
});
test('invalid declared-hash signature is rejected without reading a streamed body',{timeout:5000},async t=>{
 const f=await fixture(t),login=await f.enroll(),original=f.signed(TASKS+'/task-a/submissions',login,{method:'POST',body:{revision:0}});let reads=0;const stream=new ReadableStream({pull(){reads++;}},{highWaterMark:0});original.headers.set('X-Shenyi-Device-Signature',Buffer.alloc(64).toString('base64url'));const request=new Request(original.url,{method:'POST',headers:original.headers,body:stream,duplex:'half'});assert.equal((await f.dispatch(request,{strict:true})).status,403);assert.equal(reads,0);await stream.cancel();
});
test('a newly proved login invalidates an old request while its body is being read',{timeout:5000},async t=>{
 const f=await fixture(t),old=await f.enroll(),body=Buffer.from(JSON.stringify({filename:'stale.txt',contentBase64:Buffer.from('stale bytes').toString('base64'),revision:0})),original=f.signed(TASKS+'/task-a/submissions',old,{method:'POST',body});let controller,signal;const reading=new Promise(resolve=>signal=resolve),stream=new ReadableStream({start(value){controller=value;},pull(){signal();}},{highWaterMark:0});const pending=f.dispatch(new Request(original.url,{method:'POST',headers:original.headers,body:stream,duplex:'half'}),{strict:true});await reading;const proofPending=await f.challenge('prove',old.key,{token:f.session()});assert.equal((await f.complete(proofPending)).status,200);controller.enqueue(body);controller.close();assert.equal((await pending).status,401);assert.equal(count(f,'team_task_submissions'),0);
});
test('natural lease expiry invalidates its auth token and cannot finish an in-flight body',{timeout:5000},async t=>{
 const f=await fixture(t),login=await f.enroll(),body=Buffer.from('{}'),original=f.signed(TASKS+'/task-a/submissions',login,{method:'POST',body});let controller,signal;const reading=new Promise(resolve=>signal=resolve),stream=new ReadableStream({start(value){controller=value;},pull(){signal();}},{highWaterMark:0});const pending=f.dispatch(new Request(original.url,{method:'POST',headers:original.headers,body:stream,duplex:'half'}),{strict:true});await reading;f.clock.value=login.data.lease.expiresAt;controller.enqueue(body);controller.close();assert.equal((await pending).status,401);assert.equal((await f.call('/api/auth/session',{token:login.data.token})).status,401);assert.equal(count(f,'team_task_submissions'),0);
});
test('active nonce cap rejects growth and old-lease metadata is cleared only after replacement',async t=>{
 const f=await fixture(t),login=await f.enroll();const insert=f.db.prepare('INSERT INTO team_device_request_replays VALUES (?,?,?)');for(let i=0;i<2048;i++)insert.run(login.data.lease.id,hash('synthetic nonce '+i),NOW);assert.equal((await f.dispatch(f.signed(TASKS,login),{strict:true})).status,429);assert.equal(count(f,'team_device_request_replays'),2048);const pending=await f.challenge('prove',login.key,{token:f.session()}),fresh=await f.complete(pending);const next={data:fresh.data,key:login.key};assert.equal((await f.dispatch(f.signed(TASKS,next),{strict:true})).status,200);assert.equal(count(f,'team_device_request_replays'),1);assert.equal(count(f,'team_device_bindings'),1);assert.equal(count(f,'team_device_events'),2);
});
test('proof requests have a 120-per-minute user limit independent of unique nonces',async t=>{
 const f=await fixture(t),login=await f.enroll();for(let i=0;i<120;i++)assert.equal((await f.dispatch(f.signed(TASKS,login),{strict:true})).status,200);assert.equal((await f.dispatch(f.signed(TASKS,login),{strict:true})).status,429);assert.equal(count(f,'team_device_request_replays'),120);
});
test('lease auth context is immutable and revoking its session automatically revokes the lease',async t=>{
 const f=await fixture(t),login=await f.enroll(),other=f.session();assert.throws(()=>f.db.prepare('UPDATE team_device_leases SET auth_session_hash=?').run(proof.sessionBinding(other)));assert.equal((await f.dispatch(f.signed(TASKS,login),{strict:true})).status,200);f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(NOW,proof.sessionBinding(login.data.token));assert.equal(f.db.prepare('SELECT revoked_at FROM team_device_leases').get().revoked_at,NOW);assert.equal((await f.dispatch(f.signed(TASKS,login),{strict:true})).status,401);
});
test('strict body buffering rejects an actual body larger than seventeen MiB before nonce consumption',async t=>{
 const f=await fixture(t),login=await f.enroll(),body=Buffer.alloc(17*1024*1024+1,97);const result=await f.dispatch(f.signed(TASKS+'/task-a/submissions',login,{method:'POST',body}),{strict:true});assert.equal(result.status,413);assert.equal(count(f,'team_device_request_replays'),0);assert.equal(count(f,'team_task_submissions'),0);
});
for(const race of ['replacement','expiry'])test('final password KDF transaction rejects a business session after '+race,{timeout:10000},async t=>{
 const f=await fixture(t),login=await f.enroll(),old=f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='intern-a'").get();
 const originalPrepare=f.db.prepare;let signal,observed=false;const reading=new Promise(resolve=>signal=resolve);
 f.db.prepare=function(sql){const statement=originalPrepare.call(this,sql);if(sql==='SELECT password_hash,revision FROM team_credentials WHERE user_id=?'){const originalGet=statement.get;statement.get=function(...args){const row=originalGet.apply(this,args);if(!observed){observed=true;queueMicrotask(signal);}return row;};}return statement;};t.after(()=>{f.db.prepare=originalPrepare;});
 const pending=f.dispatch(f.signed('/api/auth/password',login,{method:'POST',body:{currentPassword:PASSWORD,newPassword:'SyntheticChanged!2026'}}),{strict:true});await reading;
 if(race==='replacement'){const next=await f.challenge('prove',login.key,{token:f.session()});assert.equal((await f.complete(next)).status,200);}else f.clock.value=login.data.lease.expiresAt;
 assert.equal((await pending).status,401);assert.deepEqual(f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='intern-a'").get(),old);assert.equal(count(f,'team_device_bindings'),1);
});
