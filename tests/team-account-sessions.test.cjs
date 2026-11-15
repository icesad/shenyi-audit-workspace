'use strict';
// Actual SQL/KDF/loopback HTTP. All accounts and credentials are synthetic.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{randomBytes,randomUUID,createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url'),path=require('node:path'),fs=require('node:fs/promises');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const ORIGIN='http://127.0.0.1:8774',NOW=Date.parse('2026-11-15T09:00:00Z'),PASSWORD='ShenyiDemo!2026';
const digest=value=>createHash('sha256').update(value).digest('hex');
let baseline;
async function fixture(t){
  baseline||=(async()=>{const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');const db=new DatabaseSync(':memory:');try{initializeTeamDatabase(db);await seedDemoTeamData(db);return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name+'"').all()}));}finally{db.close();}})();
  const db=new DatabaseSync(':memory:');(await source('database.mjs')).initializeTeamDatabase(db);db.exec('BEGIN;PRAGMA defer_foreign_keys=ON');
  for(const {name,rows} of await baseline)for(const row of rows){const keys=Object.keys(row);db.prepare('INSERT OR REPLACE INTO "'+name+'"('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row));}db.exec('COMMIT');t.after(()=>db.close());
  const {issueSession}=await source('auth-api.mjs'),{transaction}=await source('http-utils.mjs');
  const f={db,now:NOW};f.session=(userId='intern-a')=>transaction(db,()=>issueSession(db,userId,f.now));f.id=token=>db.prepare('SELECT session_id FROM team_session_metadata WHERE token_hash=?').get(digest(token)).session_id;
  return f;
}
async function call(f,route,{method='GET',body,token,headers={},identityProviders={}}={}){
  const response=await(await source('application-api.mjs')).handleTeamApplicationRequest(new Request(ORIGIN+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),{db:f.db,now:()=>f.now,identityProviders});
  const raw=await response.text();assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('access-control-allow-origin'),null);return {status:response.status,data:JSON.parse(raw),raw,response};
}
const list=(f,token,query='')=>call(f,'/api/auth/sessions'+query,{token});
const revoke=(f,token,id,password=PASSWORD)=>call(f,'/api/auth/sessions/'+id+'/revoke',{token,method:'POST',body:{currentPassword:password}});
const bulk=(f,token,action)=>call(f,'/api/auth/sessions/revoke-'+action,{token,method:'POST',body:{currentPassword:PASSWORD}});
const valid=(f,token)=>call(f,'/api/auth/session',{token});

test('session list returns only current account active sessions and non-credential DTOs',async t=>{
  const f=await fixture(t),a=f.session(),b=f.session(),other=f.session('manager-b');
  const expired=f.session(),revoked=f.session();f.db.prepare('UPDATE team_sessions SET expires_at=? WHERE token_hash=?').run(f.now,digest(expired.token));f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(f.now,digest(revoked.token));
  const result=await list(f,a.token);assert.equal(result.status,200);assert.equal(result.data.sessions.length,2);assert.equal(result.data.hasMore,false);
  for(const item of result.data.sessions){assert.deepEqual(Object.keys(item).sort(),['createdAt','expiresAt','id','isCurrent']);assert.equal(item.createdAt,NOW);assert.match(item.id,/^[0-9a-f-]{36}$/);}
  assert.deepEqual(result.data.sessions.filter(s=>s.isCurrent).map(s=>s.id),[f.id(a.token)]);assert.ok(result.data.sessions.some(s=>s.id===f.id(b.token)));
  for(const secret of [a.token,b.token,other.token,digest(a.token),digest(b.token),'user_id','token_hash','manager-b','device','ipAddress'])assert.ok(!result.raw.includes(secret),secret);
});
test('all four roles may manage only their personal session security',async t=>{
  const f=await fixture(t);for(const userId of ['intern-a','assistant-a','manager-a','partner-a']){const session=f.session(userId),r=await list(f,session.token);assert.equal(r.status,200);assert.equal(r.data.sessions.length,1);assert.equal(r.data.sessions[0].isCurrent,true);}
});
test('opaque management ID and session digest cannot authenticate as bearer credentials',async t=>{
  const f=await fixture(t),a=f.session();for(const token of [f.id(a.token),digest(a.token)])assert.equal((await list(f,token)).status,401);assert.equal((await list(f)).status,401);
});
test('pagination is owner-scoped and bounded before hasMore, not counted from another user',async t=>{
  const f=await fixture(t),a=f.session();for(let i=0;i<4;i++)f.session();for(let i=0;i<10;i++)f.session('intern-b');
  const seen=[];let after='';for(let i=0;i<3;i++){const r=await list(f,a.token,'?limit=2'+(after?'&after='+after:''));assert.equal(r.status,200);seen.push(...r.data.sessions.map(s=>s.id));assert.equal(r.data.hasMore,i<2);after=seen.at(-1);}
  assert.equal(new Set(seen).size,5);const again=await list(f,a.token,'?limit=50');assert.deepEqual(seen,again.data.sessions.map(s=>s.id));
  const only=f.session('partner-b');assert.equal((await list(f,only.token,'?limit=1')).data.hasMore,false);
});
test('foreign, expired, revoked and unknown cursors have identical rejection',async t=>{
  const f=await fixture(t),a=f.session(),foreign=f.session('intern-b'),old=f.session(),gone=f.session();f.db.prepare('UPDATE team_sessions SET expires_at=? WHERE token_hash=?').run(f.now,digest(old.token));f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(f.now,digest(gone.token));
  const results=[];for(const id of [f.id(foreign.token),f.id(old.token),f.id(gone.token),randomUUID()])results.push(await list(f,a.token,'?after='+id));assert.ok(results.every(r=>r.status===404));assert.ok(results.every(r=>r.raw===results[0].raw));
});
test('limits and query keys reject duplicates, forged scope and malformed values',async t=>{
  const f=await fixture(t),a=f.session();for(const query of ['?limit=0','?limit=51','?limit=01','?limit=1.5','?limit=1&limit=2','?userId=intern-b','?after=x&after=y'])assert.equal((await list(f,a.token,query)).status,400,query);
  const r=await list(f,a.token,'?after='+digest(a.token));assert.equal(r.status,404);
});
test('cross-account single revoke cannot distinguish an existing ID from an unknown ID',async t=>{
  const f=await fixture(t),a=f.session(),b=f.session('intern-b');const foreign=await revoke(f,a.token,f.id(b.token)),unknown=await revoke(f,a.token,randomUUID());assert.equal(foreign.status,404);assert.equal(unknown.status,404);assert.equal(foreign.raw,unknown.raw);assert.equal((await valid(f,b.token)).status,200);
});
test('wrong current password is a 403 verification failure and keeps the caller logged in',async t=>{
  const f=await fixture(t),a=f.session(),b=f.session();const r=await revoke(f,a.token,f.id(b.token),'WrongCurrent!2026');assert.equal(r.status,403);assert.equal(r.data.error.code,'VERIFICATION_FAILED');assert.equal((await valid(f,a.token)).status,200);assert.equal((await valid(f,b.token)).status,200);
});
test('single other-session revocation does not sign out the current or foreign account',async t=>{
  const f=await fixture(t),a=f.session(),b=f.session(),foreign=f.session('intern-b');const r=await revoke(f,a.token,f.id(b.token));assert.equal(r.status,200);assert.deepEqual(r.data,{revoked:true,signedOut:false});assert.equal((await valid(f,a.token)).status,200);assert.equal((await valid(f,b.token)).status,401);assert.equal((await valid(f,foreign.token)).status,200);
  assert.equal((await revoke(f,a.token,f.id(b.token))).status,404);
});
test('single current-session revocation reports signedOut and blocks subsequent API access',async t=>{
  const f=await fixture(t),a=f.session();const r=await revoke(f,a.token,f.id(a.token));assert.deepEqual(r.data,{revoked:true,signedOut:true});assert.equal((await list(f,a.token)).status,401);assert.equal((await call(f,'/api/teams/team-a/collection/tasks',{token:a.token})).status,401);
});
test('revoke-others keeps exactly the initiating active session and is safely repeatable',async t=>{
  const f=await fixture(t),a=f.session(),b=f.session(),c=f.session(),foreign=f.session('manager-b');const r=await bulk(f,a.token,'others');assert.equal(r.status,200);assert.deepEqual(r.data,{revokedCount:2,signedOut:false});assert.equal((await valid(f,a.token)).status,200);for(const s of [b,c])assert.equal((await valid(f,s.token)).status,401);assert.equal((await valid(f,foreign.token)).status,200);
  assert.deepEqual((await bulk(f,a.token,'others')).data,{revokedCount:0,signedOut:false});
});
test('revoke-all signs out this account only and counts its effective sessions',async t=>{
  const f=await fixture(t),a=f.session(),b=f.session(),foreign=f.session('intern-b');const r=await bulk(f,a.token,'all');assert.equal(r.status,200);assert.deepEqual(r.data,{revokedCount:2,signedOut:true});for(const s of [a,b])assert.equal((await valid(f,s.token)).status,401);assert.equal((await valid(f,foreign.token)).status,200);
});
test('session management does not grant business access or depend on current team membership',async t=>{
  const f=await fixture(t),a=f.session();f.db.prepare("UPDATE team_memberships SET status='disabled' WHERE user_id='intern-a'").run();assert.equal((await list(f,a.token)).status,200);assert.equal((await call(f,'/api/teams/team-a/collection/tasks',{token:a.token})).status,404);assert.deepEqual((await bulk(f,a.token,'others')).data,{revokedCount:0,signedOut:false});
});
test('legacy rows gain stable management IDs without invented times or changing base sessions',async t=>{
  const f=await fixture(t),a=f.session(),legacy=randomBytes(32).toString('base64url');f.db.prepare('INSERT INTO team_sessions VALUES (?,?,?,NULL)').run(digest(legacy),'intern-a',f.now+60000);const before=f.db.prepare('SELECT * FROM team_sessions ORDER BY token_hash').all();
  const r=await list(f,a.token),item=r.data.sessions.find(s=>s.id!==f.id(a.token));assert.equal(item.createdAt,null);const stable=item.id;(await source('database.mjs')).initializeTeamDatabase(f.db);assert.equal(f.id(legacy),stable);assert.deepEqual(f.db.prepare('SELECT * FROM team_sessions ORDER BY token_hash').all(),before);assert.deepEqual(f.db.prepare('PRAGMA table_info(team_sessions)').all().map(r=>r.name),['token_hash','user_id','expires_at','revoked_at']);
});
test('metadata IDs persist across database close and reopen',async()=>{
  const directory=await fs.mkdtemp('D:/codex-temp/shenyi-sessions-20261115/reopen-'),filename=path.join(directory,'synthetic.sqlite');const {initializeTeamDatabase}=await source('database.mjs');let db=new DatabaseSync(filename);initializeTeamDatabase(db);db.prepare("INSERT INTO team_users VALUES ('synthetic','active')").run();const tokenHash=digest('synthetic-legacy');db.prepare('INSERT INTO team_sessions VALUES (?,?,?,NULL)').run(tokenHash,'synthetic',NOW+60000);initializeTeamDatabase(db);const id=db.prepare('SELECT session_id,created_at FROM team_session_metadata').get();db.close();db=new DatabaseSync(filename);try{initializeTeamDatabase(db);assert.deepEqual(db.prepare('SELECT session_id,created_at FROM team_session_metadata').get(),id);assert.equal(id.created_at,null);}finally{db.close();}
});
test('username, phone and synthetic WeChat exchange all use timestamped metadata issuance',async t=>{
  const f=await fixture(t);const username=await call(f,'/api/auth/login',{method:'POST',body:{username:'intern-a',password:PASSWORD}});assert.equal(username.status,200);
  f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('intern-a','+8613800138000',NOW);
  const phone=await call(f,'/api/auth/phone/login',{method:'POST',body:{phone:'13800138000',password:PASSWORD}});assert.equal(phone.status,200);
  const appId='synthetic-session-app',redirectUri='https://session.synthetic.invalid/api/auth/wechat/callback',providers={wechat:{appId,redirectUri,createAuthorizationUrl:({state})=>'https://open.weixin.qq.com/connect/qrconnect?'+new URLSearchParams({appid:appId,redirect_uri:redirectUri,response_type:'code',scope:'snsapi_login',state}),exchangeCode:async()=>({appId,openId:'synthetic-open'})}};
  f.db.prepare('INSERT INTO team_wechat_identities VALUES (?,?,?,?)').run(appId,'synthetic-open','intern-a',NOW);const verifier=randomBytes(32).toString('base64url');const started=await call(f,'/api/auth/wechat/transactions',{method:'POST',body:{codeChallenge:createHash('sha256').update(verifier).digest('base64url')},identityProviders:providers});assert.equal(started.status,201);
  const state=new URL(started.data.authorizationUrl).searchParams.get('state');const callback=await(await source('application-api.mjs')).handleTeamApplicationRequest(new Request(redirectUri+'?'+new URLSearchParams({state,code:'synthetic-session-code'})),{db:f.db,now:()=>f.now,identityProviders:providers});assert.equal(callback.status,200);
  const exchanged=await call(f,'/api/auth/wechat/transactions/'+started.data.transactionId+'/exchange',{method:'POST',body:{pollToken:started.data.pollToken,codeVerifier:verifier},identityProviders:providers});assert.equal(exchanged.status,200);
  for(const result of [username,phone,exchanged])assert.equal(f.db.prepare('SELECT created_at FROM team_session_metadata WHERE token_hash=?').get(digest(result.data.token)).created_at,NOW);
});
test('changed password revokes every session independently of stored management metadata',async t=>{
  const f=await fixture(t),a=f.session(),b=f.session();const r=await call(f,'/api/auth/password',{method:'POST',token:a.token,body:{currentPassword:PASSWORD,newPassword:'SyntheticChanged!2026'}});assert.equal(r.status,200);assert.equal((await list(f,a.token)).status,401);assert.equal((await valid(f,b.token)).status,401);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_session_metadata').get().n,2);
});
test('invalid fields, unsupported methods and cross-site requests do not mutate sessions',async t=>{
  const f=await fixture(t),a=f.session();const before=f.db.prepare('SELECT * FROM team_sessions').all();
  assert.equal((await call(f,'/api/auth/sessions',{method:'POST',token:a.token,body:{}})).status,405);
  assert.equal((await call(f,'/api/auth/sessions/revoke-all',{token:a.token})).status,405);
  assert.equal((await call(f,'/api/auth/sessions/revoke-all?user=other',{method:'POST',token:a.token,body:{currentPassword:PASSWORD}})).status,400);
  assert.equal((await call(f,'/api/auth/sessions/revoke-all',{method:'POST',token:a.token,body:{currentPassword:PASSWORD,userId:'intern-b'}})).status,400);
  assert.equal((await call(f,'/api/auth/sessions/revoke-all',{method:'POST',token:a.token,body:{currentPassword:PASSWORD},headers:{Origin:'https://untrusted.invalid'}})).status,403);assert.deepEqual(f.db.prepare('SELECT * FROM team_sessions').all(),before);
});
test('reauthentication is rate-limited without invalidating the current session',async t=>{
  const f=await fixture(t),a=f.session();for(let i=0;i<10;i++)assert.equal((await call(f,'/api/auth/sessions/revoke-others',{method:'POST',token:a.token,body:{currentPassword:'Incorrect!2026'}})).status,403);const r=await bulk(f,a.token,'others');assert.equal(r.status,429);assert.equal(r.response.headers.get('Retry-After'),'60');assert.equal((await valid(f,a.token)).status,200);
});
test('shared password-work capacity rejects excess concurrent reauthentication',async t=>{
  const f=await fixture(t),a=f.session();const results=await Promise.all([bulk(f,a.token,'others'),bulk(f,a.token,'others'),bulk(f,a.token,'others')]);assert.deepEqual(results.map(r=>r.status).sort(),[200,200,429]);assert.equal((await valid(f,a.token)).status,200);
});
test('loopback HTTP exposes the same own-session scope and revocation immediately',async t=>{
  const f=await fixture(t),a=f.session(),b=f.session();const service=await(await source('dev-server.mjs')).startTeamServer({db:f.db,port:0,now:()=>f.now});t.after(()=>service.close());
  const r=await fetch(service.address.url+'/api/auth/sessions',{headers:{Authorization:'Bearer '+a.token,Origin:'shenyi://app'}});assert.equal(r.status,200);const data=await r.json();assert.equal(data.sessions.length,2);assert.ok(!JSON.stringify(data).includes(digest(a.token)));
  const changed=await fetch(service.address.url+'/api/auth/sessions/'+f.id(b.token)+'/revoke',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+a.token,Origin:'shenyi://app'},body:JSON.stringify({currentPassword:PASSWORD})});assert.deepEqual(await changed.json(),{revoked:true,signedOut:false});
  assert.equal((await fetch(service.address.url+'/api/auth/session',{headers:{Authorization:'Bearer '+b.token}})).status,401);assert.equal((await fetch(service.address.url+'/api/auth/sessions',{headers:{Authorization:'Bearer '+a.token,Origin:'https://untrusted.invalid'}})).status,403);
});
