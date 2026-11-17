'use strict';
// Actual strict application/SQLite/Ed25519 requests; all identities are synthetic.
// The shared fixture owns only an in-memory database, never an existing preview.
const test=require('node:test'),assert=require('node:assert/strict');
const {randomBytes,createHash,sign}=require('node:crypto');
const {createBusinessRoleFixture,keyPair}=require('./helpers/business-role-fixture.cjs');
const proof=require('../shared/device-proof.cjs');
const ORIGIN='http://127.0.0.1:8774',CONNECTION='/api/auth/devices/connection',TASKS='/api/teams/team-a/collection/tasks';
const hash=value=>createHash('sha256').update(value).digest('hex');
const business=user=>'device-request:'+hash(user),control=user=>'device-connection:'+hash(user);
const quota=(f,bucket)=>f.db.prepare('SELECT window_start,attempts FROM team_auth_limits WHERE bucket=?').get(bucket);
const replayCount=(f,session)=>f.db.prepare('SELECT COUNT(*) n FROM team_device_request_replays WHERE lease_id=?').get(session.lease.id).n;
function setQuota(f,bucket,attempts,at=f.clock.value){f.db.prepare('INSERT INTO team_auth_limits VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start,attempts=excluded.attempts').run(bucket,at,attempts);}
function signed(session,route=CONNECTION,{method='GET',body,key=session.key,nonce=randomBytes(32).toString('base64url'),claimedHash,headers={}}={}){
 const url=new URL(ORIGIN+route),bytes=body===undefined?Buffer.alloc(0):Buffer.from(JSON.stringify(body));
 // Sign the canonical request path/query, rather than an unnormalized input string.
 // Empty ? and fragments remain visible in Request.url for the routing matrix.
 const fields={serverId:session.lease.serverId,userId:session.account.id,sessionBinding:proof.sessionBinding(session.token),deviceId:session.lease.deviceId,bindingRevision:session.lease.bindingRevision,leaseId:session.lease.id,method,pathAndQuery:url.pathname+url.search,bodySha256:claimedHash??hash(bytes),nonce};
 return new Request(url,{method,headers:{Origin:'shenyi://app',Authorization:'Bearer '+session.token,'X-Shenyi-Device-Lease':session.lease.token,'X-Shenyi-Device-Nonce':nonce,'X-Shenyi-Device-Body-SHA256':fields.bodySha256,'X-Shenyi-Device-Signature':sign(null,proof.requestProofBytes(fields),key.privateKey).toString('base64url'),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:bytes})});
}
async function send(f,request){const response=await f.dispatch(request),text=await response.text();assert.ok(!/password_hash|token_hash|scrypt\$|PRIVATE KEY|SQLITE/.test(text));return{status:response.status,data:text?JSON.parse(text):null};}
async function fixture(t){const f=await createBusinessRoleFixture(t),session=await f.ready('intern-a');assert.equal(quota(f,business('intern-a')),undefined);assert.equal(quota(f,control('intern-a')),undefined);return{...f,session};}
function denied(result,status,code){assert.equal(result.status,status);if(code)assert.equal(result.data?.error?.code,code);}

test('the actual 120 business requests and 24 control requests have independent finite budgets',async t=>{
 const f=await fixture(t),s=f.session;
 for(let n=0;n<120;n++)assert.equal((await send(f,signed(s,TASKS))).status,200);
 const before=quota(f,business('intern-a'));assert.equal(before.attempts,120);denied(await send(f,signed(s,TASKS)),429,'TOO_MANY_ATTEMPTS');
 for(let n=0;n<24;n++){const result=await send(f,signed(s));assert.equal(result.status,200);assert.deepEqual(result.data,{connected:true});}
 assert.deepEqual(quota(f,business('intern-a')),before);assert.equal(quota(f,control('intern-a')).attempts,24);
 denied(await send(f,signed(s)),429,'TOO_MANY_ATTEMPTS');denied(await send(f,signed(s,TASKS)),429,'TOO_MANY_ATTEMPTS');assert.equal(replayCount(f,s),144);
});
test('exhausting the real control budget does not consume or block the original 120 business requests',async t=>{
 const f=await fixture(t),s=f.session;
 for(let n=0;n<24;n++)assert.equal((await send(f,signed(s))).status,200);
 assert.equal(quota(f,business('intern-a')),undefined);denied(await send(f,signed(s)),429,'TOO_MANY_ATTEMPTS');
 const before=quota(f,control('intern-a'));for(let n=0;n<120;n++)assert.equal((await send(f,signed(s,TASKS))).status,200);
 assert.deepEqual(quota(f,control('intern-a')),before);denied(await send(f,signed(s,TASKS)),429,'TOO_MANY_ATTEMPTS');assert.equal(replayCount(f,s),144);
});
test('control and business buckets are scoped to the authenticated user, including another team',async t=>{
 const f=await fixture(t),other=await f.ready('intern-b');setQuota(f,control('intern-a'),24);setQuota(f,business('intern-a'),120);
 denied(await send(f,signed(f.session)),429,'TOO_MANY_ATTEMPTS');denied(await send(f,signed(f.session,TASKS)),429,'TOO_MANY_ATTEMPTS');
 assert.equal((await send(f,signed(other))).status,200);assert.equal((await send(f,signed(other,'/api/teams/team-b/collection/tasks'))).status,200);
 assert.equal(quota(f,control('intern-b')).attempts,1);assert.equal(quota(f,business('intern-b')).attempts,1);assert.equal(quota(f,control('intern-a')).attempts,24);assert.equal(quota(f,business('intern-a')).attempts,120);
});
test('URL and verb variants cannot use the control bucket to bypass exhausted business quota',async t=>{
 const f=await fixture(t),s=f.session;setQuota(f,business('intern-a'),120);
 const variants=[{route:CONNECTION+'?x=1'},{route:CONNECTION+'?'},{route:CONNECTION+'#client-only'},{route:CONNECTION+'#'},{route:CONNECTION+'/'},{route:'/api/auth/devices/%63onnection'},{route:'/api/auth/devices//connection'},{route:CONNECTION,method:'HEAD'},{route:CONNECTION,method:'POST',body:{}}];
 for(const v of variants){const request=signed(s,v.route,v);assert.notEqual(request.method==='GET'&&request.url===ORIGIN+CONNECTION,true,'variant must remain distinct after WHATWG normalization');const result=await send(f,request);assert.equal(result.status,429,v.route+' '+(v.method??'GET'));if(v.method!=='HEAD')assert.equal(result.data.error.code,'TOO_MANY_ATTEMPTS');assert.equal(quota(f,control('intern-a')),undefined);}
 assert.equal(quota(f,business('intern-a')).attempts,120);assert.equal(replayCount(f,s),0);assert.equal((await send(f,signed(s))).status,200);assert.equal(quota(f,control('intern-a')).attempts,1);assert.equal(replayCount(f,s),1);
});
test('connection remains protected: missing, copied or malformed proof cannot consume either quota',async t=>{
 const f=await fixture(t),s=f.session,wrong=keyPair(),boot=await f.login('intern-a');
 const requests=[new Request(ORIGIN+CONNECTION),new Request(ORIGIN+CONNECTION,{headers:{Authorization:'Bearer '+s.token}}),new Request(ORIGIN+CONNECTION,{headers:{Authorization:'Bearer '+boot.token}}),signed(s,CONNECTION,{key:wrong}),signed(s,CONNECTION,{headers:{'X-Shenyi-Device-Signature':Buffer.alloc(64).toString('base64url')}}),signed(s,CONNECTION,{headers:{'X-Shenyi-Device-Lease':randomBytes(32).toString('base64url')}}),signed(s,CONNECTION,{headers:{Authorization:'Bearer '+randomBytes(32).toString('base64url')}}),signed(s,CONNECTION,{headers:{'X-Shenyi-Device-Nonce':'bad-nonce'}})];
 for(const request of requests){const r=await send(f,request);assert.ok([400,401,403].includes(r.status),r.status);assert.equal(quota(f,control('intern-a')),undefined);assert.equal(quota(f,business('intern-a')),undefined);assert.equal(replayCount(f,s),0);}
 assert.equal((await send(f,signed(s))).status,200);
});
test('control requests still verify actual empty body and declared length before consuming a nonce',async t=>{
 const f=await fixture(t),s=f.session;
 denied(await send(f,signed(s,CONNECTION,{claimedHash:hash('different actual body')})),403,'DEVICE_BODY_MISMATCH');
 denied(await send(f,signed(s,CONNECTION,{headers:{'Content-Length':'1'}})),400);
 assert.equal(quota(f,control('intern-a')).attempts,2);assert.equal(quota(f,business('intern-a')),undefined);assert.equal(replayCount(f,s),0);assert.equal((await send(f,signed(s))).status,200);assert.equal(replayCount(f,s),1);
});
test('a valid proof cannot be moved between quota classes or HTTP methods',async t=>{
 const f=await fixture(t),s=f.session,fromBusiness=signed(s,TASKS),fromControl=signed(s);
 const changed=[new Request(ORIGIN+CONNECTION,{headers:fromBusiness.headers}),new Request(ORIGIN+TASKS,{headers:fromControl.headers}),new Request(ORIGIN+CONNECTION,{method:'HEAD',headers:fromControl.headers}),new Request(ORIGIN+CONNECTION,{method:'POST',headers:fromControl.headers})];
 for(const request of changed){assert.equal((await send(f,request)).status,403);assert.equal(quota(f,business('intern-a')),undefined);assert.equal(quota(f,control('intern-a')),undefined);assert.equal(replayCount(f,s),0);}
 // The unchanged requests still work, proving the rejected variants carried
 // valid original signatures rather than a fixture-generated invalid proof.
 assert.equal((await send(f,fromBusiness)).status,200);assert.equal((await send(f,fromControl)).status,200);assert.equal(replayCount(f,s),2);
});
test('a successful control request consumes the shared nonce and records actual device usage',async t=>{
 const f=await fixture(t),s=f.session,prior=f.db.prepare('SELECT * FROM team_device_usage WHERE device_id=?').get(s.lease.deviceId);f.clock.value+=1000;
 const request=signed(s),again=new Request(request.url,{headers:request.headers});assert.equal((await send(f,request)).status,200);assert.equal(replayCount(f,s),1);
 const usage=f.db.prepare('SELECT * FROM team_device_usage WHERE device_id=?').get(s.lease.deviceId);assert.equal(usage.user_id,s.account.id);assert.equal(usage.last_used_at,f.clock.value);assert.ok(usage.last_used_at>prior.last_used_at);
 denied(await send(f,again),409,'DEVICE_REQUEST_REPLAY');assert.equal(replayCount(f,s),1);assert.equal(quota(f,control('intern-a')).attempts,2);
});
test('the existing shared 2048 nonce ceiling also rejects connection proofs',async t=>{
 // Set only this fixture's owned SQLite rows to the cap boundary. The last
 // accepted nonce is inserted by a real authenticated connection request.
 const f=await fixture(t),s=f.session,insert=f.db.prepare('INSERT INTO team_device_request_replays VALUES(?,?,?)');f.db.exec('BEGIN');try{for(let n=0;n<2047;n++)insert.run(s.lease.id,hash('synthetic-control-nonce-'+n),f.clock.value);f.db.exec('COMMIT');}catch(e){f.db.exec('ROLLBACK');throw e;}
 assert.equal((await send(f,signed(s))).status,200);assert.equal(replayCount(f,s),2048);
 denied(await send(f,signed(s)),429,'DEVICE_PROOF_LIMIT');assert.equal(replayCount(f,s),2048);assert.equal(quota(f,control('intern-a')).attempts,2);assert.equal(quota(f,business('intern-a')),undefined);
});
test('revoked session, lease, binding and account, and exact expiry all close control checks before quota',async t=>{
 for(const kind of ['session','lease','binding','account','expiry']){
  const f=await fixture(t),s=f.session;
  if(kind==='session')f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(f.clock.value,hash(s.token));
  if(kind==='lease')f.db.prepare('UPDATE team_device_leases SET revoked_at=? WHERE lease_id=?').run(f.clock.value,s.lease.id);
  if(kind==='binding')f.db.prepare("UPDATE team_device_bindings SET status='revoked',revoked_at=? WHERE device_id=?").run(f.clock.value,s.lease.deviceId);
  if(kind==='account')f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id=?").run(s.account.id);
  if(kind==='expiry')f.clock.value=s.lease.expiresAt;
  const r=await send(f,signed(s));assert.ok([401,403].includes(r.status),kind+' '+r.status);assert.equal(quota(f,control('intern-a')),undefined);assert.equal(quota(f,business('intern-a')),undefined);assert.equal(replayCount(f,s),0);
 }
});
test('a lease or account changed at the authenticated body await is rechecked before connection dispatch',async t=>{
 for(const kind of ['lease','account']){
  const f=await fixture(t),s=f.session,pending=send(f,signed(s));
  if(kind==='lease')f.db.prepare('UPDATE team_device_leases SET revoked_at=? WHERE lease_id=?').run(f.clock.value,s.lease.id);else f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id=?").run(s.account.id);
  const r=await pending;assert.ok([401,403].includes(r.status),kind+' '+r.status);assert.equal(quota(f,control('intern-a')).attempts,1);assert.equal(replayCount(f,s),0);
 }
});
test('a saturated control window resets exactly at 60000ms without resetting the business bucket',async t=>{
 const f=await fixture(t),s=f.session,start=f.clock.value;setQuota(f,control('intern-a'),24);setQuota(f,business('intern-a'),120);denied(await send(f,signed(s)),429,'TOO_MANY_ATTEMPTS');f.clock.value=start+59999;denied(await send(f,signed(s)),429,'TOO_MANY_ATTEMPTS');assert.equal(replayCount(f,s),0);
 f.clock.value=start+60000;assert.equal((await send(f,signed(s))).status,200);assert.deepEqual({...quota(f,control('intern-a'))},{window_start:f.clock.value,attempts:1});assert.deepEqual({...quota(f,business('intern-a'))},{window_start:start,attempts:120});assert.equal((await send(f,signed(s,TASKS))).status,200);assert.deepEqual({...quota(f,business('intern-a'))},{window_start:f.clock.value,attempts:1});assert.equal(quota(f,control('intern-a')).attempts,1);
});
