'use strict';
// Real SQL/KDF and explicit synthetic SMS/recovery adapters; no SMS is sent.
// These tests do not prove supplier setup, production recovery, phone ownership
// outside the injected adapter, desktop interaction or customer acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {createHash,randomBytes} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const ROOT = path.resolve(__dirname,'..'), ORIGIN='http://127.0.0.1:8774';
const PASSWORD='ShenyiDemo!2026', NEW_PASSWORD='SyntheticNew!2026';
const PHONE='+8613800000001', OTHER_PHONE='+8613800000002';
const hash = value => createHash('sha256').update(value).digest('hex');
const load = name => import(pathToFileURL(path.join(ROOT,'server/team',name)).href);
let baseline;

async function fixture(t) {
  baseline ||= (async()=>{
    const {initializeTeamDatabase,seedDemoTeamData}=await load('database.mjs');
    const source=new DatabaseSync(':memory:');
    try { initializeTeamDatabase(source);await seedDemoTeamData(source);
      return source.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all()
        .map(({name})=>({name,rows:source.prepare('SELECT * FROM "'+name+'"').all()}));
    } finally { source.close(); }
  })();
  const snapshot=await baseline, db=new DatabaseSync(':memory:');
  (await load('database.mjs')).initializeTeamDatabase(db);
  db.exec('BEGIN;PRAGMA defer_foreign_keys=ON;');
  for (const {name,rows} of snapshot) for(const row of rows) {
    const keys=Object.keys(row);
    db.prepare('INSERT OR REPLACE INTO "'+name+'"('+keys.map(key=>'"'+key+'"').join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row));
  }
  db.exec('COMMIT;');t.after(()=>db.close());
  const sent=[], approved=new Set();
  const f={db,now:Date.parse('2026-11-15T08:00:00Z'),sent,approved};
  f.providers={phonePepper:randomBytes(32),sms:{async send(message){sent.push({...message});}},recovery:{async authorize({recoveryProof}){if(!approved.has(recoveryProof))return false;approved.delete(recoveryProof);return true;}}};
  return f;
}
function request(route,{token,body,method='POST'}={}) {
  return new Request(ORIGIN+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function call(f,route,options={},providers=f.providers) {
  const req=request(route,options), helpers=await load('http-utils.mjs');
  let response;
  try {
    response=route.startsWith('/api/auth/phone/')
      ? await (await load('phone-api.mjs')).handlePhoneRequest(req,{db:f.db,now:()=>f.now,identityProviders:providers})
      : await (await load('application-api.mjs')).handleTeamApplicationRequest(req,{db:f.db,now:()=>f.now});
  } catch(error) {
    if(!(error instanceof helpers.ApiError))throw error;
    response=helpers.json({error:{code:error.code,message:error.message}},error.status);
  }
  const raw=await response.text(), json=JSON.parse(raw);
  assert.match(response.headers.get('cache-control')||'',/private.*no-store/);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  return {status:response.status,json,raw};
}
async function login(f,username='intern-a',password=PASSWORD) {
  const r=await call(f,'/api/auth/login',{body:{username,password}});
  assert.equal(r.status,200,r.raw);return r.json;
}
async function challenge(f,token,phone=PHONE,purpose='bind') {
  const r=await call(f,'/api/auth/phone/challenges',{token,body:{phone,purpose}});
  assert.equal(r.status,202,r.raw);assert.deepEqual(Object.keys(r.json).sort(),['challengeId','expiresAt']);
  const sent=f.sent.find(item=>item.challengeId===r.json.challengeId);
  assert.match(sent.code,/^\d{6}$/);return {...r.json,code:sent.code};
}
async function bind(f,token,phone=PHONE) {
  const c=await challenge(f,token,phone);
  const r=await call(f,'/api/auth/phone/bind',{token,body:{challengeId:c.challengeId,code:c.code,currentPassword:PASSWORD}});
  assert.equal(r.status,200,r.raw);return {result:r,challenge:c};
}
const sessions=f=>f.db.prepare('SELECT token_hash,user_id,expires_at,revoked_at FROM team_sessions ORDER BY token_hash').all();

test('phone normalization accepts only supported mainland representations',async()=>{
  const {normalizePhone}=await load('phone-api.mjs');
  for(const p of ['13800000001','+86 138-0000-0001','0086(138)00000001','＋８６１３８０００００００１'])assert.equal(normalizePhone(p),PHONE);
  for(const p of ['',null,13800000001,'+113800000001','12800000001','138000000011','x'.repeat(65)])assert.throws(()=>normalizePhone(p));
});

test('missing supplier/pepper and missing recovery policy fail closed without fake challenge records',async t=>{
  const f=await fixture(t), user=await login(f);
  for(const providers of [{},{sms:f.providers.sms},{sms:f.providers.sms,phonePepper:Buffer.alloc(31)}]) {
    const r=await call(f,'/api/auth/phone/challenges',{token:user.token,body:{phone:PHONE,purpose:'bind'}},providers);
    assert.equal(r.status,503);assert.equal(r.json.error.code,'SMS_UNAVAILABLE');
  }
  const r=await call(f,'/api/auth/phone/challenges',{body:{phone:PHONE,purpose:'reset'}},{sms:f.providers.sms,phonePepper:f.providers.phonePepper});
  assert.equal(r.status,503);assert.equal(r.json.error.code,'RECOVERY_NOT_CONFIGURED');
  assert.equal(f.sent.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_phone_challenges').get().n,0);
});

test('bind challenge requires authentication and stores only a purpose/session-bound HMAC',async t=>{
  const f=await fixture(t);
  assert.equal((await call(f,'/api/auth/phone/challenges',{body:{phone:PHONE,purpose:'bind'}})).status,401);
  const user=await login(f), c=await challenge(f,user.token);
  const row=f.db.prepare('SELECT * FROM team_phone_challenges WHERE challenge_id=?').get(c.challengeId);
  assert.equal(row.phone,PHONE);assert.equal(row.user_id,'intern-a');assert.equal(row.session_hash,hash(user.token));
  assert.match(row.code_mac,/^[a-f0-9]{64}$/);assert.notEqual(row.code_mac,c.code);assert.equal(row.delivery_state,'sent');
  assert.equal(row.expires_at,f.now+5*60_000);assert.equal(row.attempts,0);assert.ok(!Object.hasOwn(row,'code'));
});

test('password plus correct SMS binds exactly the existing employee without granting new teams or exposing phone',async t=>{
  const f=await fixture(t), user=await login(f), before=f.db.prepare('SELECT * FROM team_memberships ORDER BY team_id,user_id').all();
  const {result,challenge:c}=await bind(f,user.token);
  assert.deepEqual(result.json,{phoneVerified:true,phoneMasked:'+8613****0001'});
  assert.ok(!result.raw.includes(PHONE));
  assert.equal(f.db.prepare('SELECT user_id FROM team_phone_credentials WHERE phone=?').get(PHONE).user_id,user.account.id);
  assert.deepEqual(f.db.prepare('SELECT * FROM team_memberships ORDER BY team_id,user_id').all(),before);
  assert.ok(f.db.prepare('SELECT consumed_at FROM team_phone_challenges WHERE challenge_id=?').get(c.challengeId).consumed_at);
  assert.equal((await call(f,'/api/auth/phone/bind',{token:user.token,body:{challengeId:c.challengeId,code:c.code,currentPassword:PASSWORD}})).status,400);
});

test('a bind challenge cannot be used by another user or another session of the same user',async t=>{
  const f=await fixture(t), first=await login(f), second=await login(f), other=await login(f,'assistant-a'), c=await challenge(f,first.token);
  for(const token of [second.token,other.token])assert.equal((await call(f,'/api/auth/phone/bind',{token,body:{challengeId:c.challengeId,code:c.code,currentPassword:PASSWORD}})).status,400);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_phone_credentials').get().n,0);
  assert.equal((await call(f,'/api/auth/phone/bind',{token:first.token,body:{challengeId:c.challengeId,code:c.code,currentPassword:'incorrect-password'}})).status,401);
  assert.equal(f.db.prepare('SELECT consumed_at FROM team_phone_challenges WHERE challenge_id=?').get(c.challengeId).consumed_at,null);
});

test('five wrong code attempts remain spent and a sixth correct code cannot recover the challenge',async t=>{
  const f=await fixture(t), user=await login(f), c=await challenge(f,user.token), wrong=c.code==='000000'?'999999':'000000';
  for(let n=0;n<5;n++)assert.equal((await call(f,'/api/auth/phone/bind',{token:user.token,body:{challengeId:c.challengeId,code:wrong,currentPassword:PASSWORD}})).status,400);
  assert.equal(f.db.prepare('SELECT attempts FROM team_phone_challenges WHERE challenge_id=?').get(c.challengeId).attempts,5);
  assert.equal((await call(f,'/api/auth/phone/bind',{token:user.token,body:{challengeId:c.challengeId,code:c.code,currentPassword:PASSWORD}})).status,400);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_phone_credentials').get().n,0);
});

test('expired challenges, altered purpose/HMAC and changed credential version cannot bind',async t=>{
  for(const kind of ['expired','purpose','mac','revision']) {
    const f=await fixture(t), user=await login(f), c=await challenge(f,user.token);
    if(kind==='expired')f.now=c.expiresAt;
    if(kind==='purpose')f.db.prepare("UPDATE team_phone_challenges SET purpose='reset' WHERE challenge_id=?").run(c.challengeId);
    if(kind==='mac')f.db.prepare('UPDATE team_phone_challenges SET code_mac=? WHERE challenge_id=?').run('0'.repeat(64),c.challengeId);
    if(kind==='revision')f.db.prepare('UPDATE team_credentials SET revision=revision+1 WHERE user_id=?').run('intern-a');
    const r=await call(f,'/api/auth/phone/bind',{token:user.token,body:{challengeId:c.challengeId,code:c.code,currentPassword:PASSWORD}});
    assert.ok([400,401].includes(r.status),r.raw);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_phone_credentials').get().n,0);
  }
});

test('SMS failure leaves no usable challenge and no false sent response',async t=>{
  const f=await fixture(t), user=await login(f);
  f.providers.sms.send=async message=>{f.sent.push(message);throw Error('PRIVATE_SMS_PROVIDER_DETAILS');};
  const failed=await call(f,'/api/auth/phone/challenges',{token:user.token,body:{phone:PHONE,purpose:'bind'}});
  assert.equal(failed.status,503);assert.equal(failed.json.error.code,'SMS_UNAVAILABLE');assert.ok(!failed.raw.includes('PRIVATE'));
  const item=f.sent[0];assert.equal(f.db.prepare('SELECT delivery_state FROM team_phone_challenges WHERE challenge_id=?').get(item.challengeId).delivery_state,'failed');
  assert.equal((await call(f,'/api/auth/phone/bind',{token:user.token,body:{challengeId:item.challengeId,code:item.code,currentPassword:PASSWORD}})).status,400);
});

test('provider-thrown ApiError is sanitized instead of disclosing its supplier message',async t=>{
  const f=await fixture(t), user=await login(f), {ApiError}=await load('http-utils.mjs');
  f.providers.sms.send=async()=>{throw new ApiError(400,'PRIVATE_VENDOR_CODE','PRIVATE_PROVIDER_CREDENTIAL');};
  const r=await call(f,'/api/auth/phone/challenges',{token:user.token,body:{phone:PHONE,purpose:'bind'}});
  assert.equal(r.status,503);assert.equal(r.json.error.code,'SMS_UNAVAILABLE');assert.ok(!r.raw.includes('PRIVATE'));
});

test('session revoked while SMS delivery is pending cannot produce a usable bind challenge',async t=>{
  const f=await fixture(t), user=await login(f);let release,entered;
  const started=new Promise(resolve=>entered=resolve), gate=new Promise(resolve=>release=resolve);
  f.providers.sms.send=async message=>{f.sent.push(message);entered();await gate;};
  const pending=call(f,'/api/auth/phone/challenges',{token:user.token,body:{phone:PHONE,purpose:'bind'}});
  await started;f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(f.now,hash(user.token));release();
  const r=await pending;assert.equal(r.status,401);
  assert.equal(f.db.prepare('SELECT delivery_state FROM team_phone_challenges WHERE challenge_id=?').get(f.sent[0].challengeId).delivery_state,'failed');
});

test('SMS phone limits apply equally across users and expire only after their server window',async t=>{
  const f=await fixture(t), user=await login(f);
  for(let n=0;n<3;n++)await challenge(f,user.token);
  assert.equal((await call(f,'/api/auth/phone/challenges',{token:user.token,body:{phone:PHONE,purpose:'bind'}})).status,429);
  f.now+=10*60_000;assert.equal((await call(f,'/api/auth/phone/challenges',{token:user.token,body:{phone:PHONE,purpose:'bind'}})).status,202);
});

test('existing phone or existing user binding is never silently replaced or merged',async t=>{
  const f=await fixture(t), a=await login(f), b=await login(f,'assistant-a');await bind(f,a.token);
  for(const [token,phone]of [[b.token,PHONE],[a.token,OTHER_PHONE]]) {
    const c=await challenge(f,token,phone), r=await call(f,'/api/auth/phone/bind',{token,body:{challengeId:c.challengeId,code:c.code,currentPassword:PASSWORD}});
    assert.equal(r.status,409);assert.equal(r.json.error.code,'PHONE_ALREADY_BOUND');
  }
  assert.deepEqual(f.db.prepare('SELECT user_id,phone FROM team_phone_credentials').all().map(r=>({...r})),[{user_id:'intern-a',phone:PHONE}]);
});

test('phone/password signs into the same employee and still works if the SMS adapter is unavailable',async t=>{
  const f=await fixture(t), user=await login(f);await bind(f,user.token);
  const r=await call(f,'/api/auth/phone/login',{body:{phone:'13800000001',password:PASSWORD}},{});
  assert.equal(r.status,200,r.raw);assert.equal(r.json.account.id,user.account.id);assert.deepEqual(r.json.memberships,user.memberships);
  assert.match(r.json.token,/^[A-Za-z0-9_-]{43}$/);assert.ok(!r.raw.includes(PHONE));
  assert.ok(f.db.prepare('SELECT user_id FROM team_sessions WHERE token_hash=?').get(hash(r.json.token)));
});

test('unknown phone, wrong password and disabled account share the same authentication error',async t=>{
  const f=await fixture(t), user=await login(f);await bind(f,user.token);
  const results=[];
  results.push(await call(f,'/api/auth/phone/login',{body:{phone:OTHER_PHONE,password:PASSWORD}}));
  results.push(await call(f,'/api/auth/phone/login',{body:{phone:PHONE,password:'incorrect-password'}}));
  f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='intern-a'").run();
  results.push(await call(f,'/api/auth/phone/login',{body:{phone:PHONE,password:PASSWORD}}));
  for(const r of results){assert.equal(r.status,401);assert.equal(r.raw,results[0].raw);}
});

test('phone login limits failures and never accepts client-supplied role or user identity',async t=>{
  const f=await fixture(t);
  for(let n=0;n<10;n++)assert.equal((await call(f,'/api/auth/phone/login',{body:{phone:PHONE,password:'wrong-password'}})).status,401);
  assert.equal((await call(f,'/api/auth/phone/login',{body:{phone:PHONE,password:PASSWORD}})).status,429);
  assert.equal((await call(f,'/api/auth/phone/login',{body:{phone:OTHER_PHONE,password:PASSWORD,role:'partner'}})).status,400);
  assert.equal(sessions(f).length,0);
});

test('pure SMS cannot reset without an explicit independent recovery approval strategy',async t=>{
  const f=await fixture(t), user=await login(f);await bind(f,user.token);
  const providers={sms:f.providers.sms,phonePepper:f.providers.phonePepper};
  const r=await call(f,'/api/auth/phone/reset',{body:{challengeId:'any-id',code:'123456',newPassword:NEW_PASSWORD,recoveryProof:'not-approved'}},providers);
  assert.equal(r.status,503);assert.equal(r.json.error.code,'RECOVERY_NOT_CONFIGURED');
});

test('reset challenge acceptance has no account-existence bit and cannot create a new employee',async t=>{
  const f=await fixture(t), user=await login(f);await bind(f,user.token);
  const known=await challenge(f,null,PHONE,'reset'), unknown=await challenge(f,null,OTHER_PHONE,'reset');
  assert.deepEqual(Object.keys(known).sort(),Object.keys(unknown).sort());
  const row=f.db.prepare('SELECT user_id FROM team_phone_challenges WHERE challenge_id=?').get(unknown.challengeId);assert.equal(row.user_id,null);
  f.approved.add('approved-for-test');const r=await call(f,'/api/auth/phone/reset',{body:{challengeId:unknown.challengeId,code:unknown.code,newPassword:NEW_PASSWORD,recoveryProof:'approved-for-test'}});
  assert.equal(r.status,400);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_users').get().n,9);
});

test('SMS plus one-time independent recovery proof changes password and revokes all existing sessions/challenges',async t=>{
  const f=await fixture(t), user=await login(f);await login(f);await bind(f,user.token);
  const c=await challenge(f,null,PHONE,'reset'), before=f.db.prepare('SELECT password_hash,revision FROM team_credentials WHERE user_id=?').get(user.account.id);
  const denied=await call(f,'/api/auth/phone/reset',{body:{challengeId:c.challengeId,code:c.code,newPassword:NEW_PASSWORD,recoveryProof:'unapproved'}});assert.equal(denied.status,400);
  f.approved.add('one-time-approval');
  const done=await call(f,'/api/auth/phone/reset',{body:{challengeId:c.challengeId,code:c.code,newPassword:NEW_PASSWORD,recoveryProof:'one-time-approval'}});
  assert.equal(done.status,200,done.raw);assert.deepEqual(done.json,{signedOut:true});
  const after=f.db.prepare('SELECT password_hash,revision FROM team_credentials WHERE user_id=?').get(user.account.id);
  assert.notEqual(before.password_hash,after.password_hash);assert.equal(after.revision,before.revision+1);
  assert.ok(sessions(f).filter(row=>row.user_id===user.account.id).every(row=>row.revoked_at!==null));
  assert.ok(f.db.prepare('SELECT consumed_at FROM team_phone_challenges WHERE user_id=?').all(user.account.id).every(row=>row.consumed_at!==null));
  assert.equal((await call(f,'/api/auth/phone/login',{body:{phone:PHONE,password:PASSWORD}})).status,401);
  const fresh=await call(f,'/api/auth/phone/login',{body:{phone:PHONE,password:NEW_PASSWORD}});assert.equal(fresh.status,200);assert.equal(fresh.json.account.id,user.account.id);
  assert.equal((await call(f,'/api/auth/phone/reset',{body:{challengeId:c.challengeId,code:c.code,newPassword:PASSWORD,recoveryProof:'one-time-approval'}})).status,400);
});

test('bind-purpose code cannot be reinterpreted as a reset code',async t=>{
  const f=await fixture(t), user=await login(f), c=await challenge(f,user.token);f.approved.add('approved-for-test');
  assert.equal((await call(f,'/api/auth/phone/reset',{body:{challengeId:c.challengeId,code:c.code,newPassword:NEW_PASSWORD,recoveryProof:'approved-for-test'}})).status,400);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_phone_credentials').get().n,0);
});

test('phone owner changed during recovery approval denies reset without changing credentials',async t=>{
  const f=await fixture(t), user=await login(f);await bind(f,user.token);
  const c=await challenge(f,null,PHONE,'reset'), before=f.db.prepare('SELECT password_hash FROM team_credentials WHERE user_id=?').get(user.account.id).password_hash;
  f.providers.recovery.authorize=async()=>{f.db.prepare('UPDATE team_phone_credentials SET phone=?,revision=revision+1 WHERE user_id=?').run(OTHER_PHONE,user.account.id);return true;};
  const r=await call(f,'/api/auth/phone/reset',{body:{challengeId:c.challengeId,code:c.code,newPassword:NEW_PASSWORD,recoveryProof:'approved-for-test'}});
  assert.equal(r.status,400);assert.equal(f.db.prepare('SELECT password_hash FROM team_credentials WHERE user_id=?').get(user.account.id).password_hash,before);
});

test('unknown query/fields and unsupported phone methods are rejected before creating identity',async t=>{
  const f=await fixture(t), user=await login(f);
  assert.equal((await call(f,'/api/auth/phone/login?role=partner',{body:{phone:PHONE,password:PASSWORD}})).status,400);
  assert.equal((await call(f,'/api/auth/phone/challenges',{token:user.token,body:{phone:PHONE,purpose:'bind',userId:'partner-a'}})).status,400);
  assert.equal((await call(f,'/api/auth/phone/login',{method:'GET'})).status,405);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_phone_credentials').get().n,0);
});
