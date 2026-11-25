'use strict';
// Real SQLite, async scrypt and loopback HTTP; synthetic identities only.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-15T09:00:00.000Z'),PASSWORD='PasswordFixture!2026',REPLACEMENT='ReplacementFixture!2026';
const digest=value=>createHash('sha256').update(value).digest('hex');
let originalHash;
async function fixture(t){
  const {initializeTeamDatabase}=await source('database.mjs'),{hashPassword}=await source('passwords.mjs');
  const {issueSession}=await source('auth-api.mjs'),{transaction}=await source('http-utils.mjs'),{handleTeamApplicationRequest}=await source('application-api.mjs');
  originalHash||=hashPassword(PASSWORD);const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);t.after(()=>db.close());
  db.prepare("INSERT INTO teams VALUES ('team-a','active')").run();
  for(const [id,role] of [['user-a','intern'],['user-b','partner']]){db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(id,id,'Synthetic '+id,await originalHash);db.prepare("INSERT INTO team_memberships VALUES ('team-a',?,?,'active')").run(id,role);}
  db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('user-a','+8613800138000',NOW-1000);
  const issue=user=>transaction(db,()=>issueSession(db,user,NOW));const actor=issue('user-a'),peer=issue('user-a'),foreign=issue('user-b');
  const call=async(route,{body,token=actor.token,method=body===undefined?'GET':'POST',headers={}}={})=>{
    const response=await handleTeamApplicationRequest(new Request('https://password.synthetic.invalid'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),{db,now:()=>NOW});
    const raw=await response.text();return {status:response.status,headers:response.headers,raw,data:raw?JSON.parse(raw):null};
  };
  const credential=()=>db.prepare("SELECT * FROM team_credentials WHERE user_id='user-a'").get();
  const revoked=token=>db.prepare('SELECT revoked_at FROM team_sessions WHERE token_hash=?').get(digest(token)).revoked_at;
  const change=(currentPassword=PASSWORD,newPassword=REPLACEMENT)=>call('/api/auth/password',{body:{currentPassword,newPassword}});
  return {db,actor,peer,foreign,call,credential,revoked,change};
}
function privateResponse(result){assert.match(result.headers.get('cache-control'),/private.*no-store/);assert.equal(result.headers.get('x-content-type-options'),'nosniff');assert.equal(result.headers.get('access-control-allow-origin'),null);for(const value of [PASSWORD,REPLACEMENT,'password_hash','token_hash','scrypt$','SELECT '])assert.ok(!result.raw.includes(value));}

test('wrong current password returns retryable 403 without changing credentials or old sessions',async t=>{
  const f=await fixture(t),before=f.credential(),result=await f.change('WrongCurrent!2026');assert.equal(result.status,403,result.raw);assert.equal(result.data.error.code,'VERIFICATION_FAILED');privateResponse(result);
  assert.deepEqual(f.credential(),before);for(const value of [f.actor,f.peer,f.foreign])assert.equal(f.revoked(value.token),null);
  assert.equal((await f.call('/api/auth/session')).status,200);assert.equal((await f.call('/api/auth/login',{token:null,body:{username:'user-a',password:PASSWORD}})).status,200);
});
test('a missing credential is a conflict rather than a wrong-password signout',async t=>{
  const f=await fixture(t);f.db.prepare("DELETE FROM team_credentials WHERE user_id='user-a'").run();const result=await f.change();assert.equal(result.status,409,result.raw);assert.equal(result.data.error.code,'CREDENTIAL_CHANGED');privateResponse(result);assert.equal(f.revoked(f.actor.token),null);assert.equal(f.revoked(f.foreign.token),null);
});
test('confirmed change revokes every old own session and preserves identity, role, phone and other users',async t=>{
  const f=await fixture(t),before=f.credential(),foreignCredential=f.db.prepare("SELECT * FROM team_credentials WHERE user_id='user-b'").get(),membership=f.db.prepare('SELECT * FROM team_memberships ORDER BY user_id').all(),phone=f.db.prepare('SELECT * FROM team_phone_credentials').all(),metadata=f.db.prepare('SELECT * FROM team_session_metadata ORDER BY session_id').all();
  const result=await f.change();assert.equal(result.status,200,result.raw);assert.deepEqual(result.data,{signedOut:true});privateResponse(result);
  assert.equal(f.credential().revision,before.revision+1);assert.notEqual(f.credential().password_hash,before.password_hash);
  assert.deepEqual(f.db.prepare("SELECT * FROM team_credentials WHERE user_id='user-b'").get(),foreignCredential);
  assert.deepEqual(f.db.prepare('SELECT * FROM team_memberships ORDER BY user_id').all(),membership);assert.deepEqual(f.db.prepare('SELECT * FROM team_phone_credentials').all(),phone);assert.deepEqual(f.db.prepare('SELECT * FROM team_session_metadata ORDER BY session_id').all(),metadata);
  for(const value of [f.actor,f.peer])assert.equal((await f.call('/api/auth/session',{token:value.token})).status,401);assert.equal((await f.call('/api/auth/session',{token:f.foreign.token})).status,200);
  assert.equal((await f.call('/api/auth/login',{token:null,body:{username:'user-a',password:PASSWORD}})).status,401);
  const login=await f.call('/api/auth/phone/login',{token:null,body:{phone:'13800138000',password:REPLACEMENT}});assert.equal(login.status,200,login.raw);assert.equal(login.data.account.id,'user-a');assert.deepEqual(login.data.memberships,[{teamId:'team-a',role:'intern'}]);
});
test('invalid new-password boundaries and unlisted target fields cannot mutate the account',async t=>{
  const f=await fixture(t),before=f.credential();
  for(const newPassword of ['short','x'.repeat(129),'😀'.repeat(129),null,{}]){const result=await f.change(PASSWORD,newPassword);assert.equal(result.status,400,result.raw);privateResponse(result);}
  for(const field of ['userId','role','token']){const result=await f.call('/api/auth/password',{body:{currentPassword:PASSWORD,newPassword:REPLACEMENT,[field]:'user-b'}});assert.equal(result.status,400,result.raw);}
  assert.deepEqual(f.credential(),before);assert.equal(f.revoked(f.actor.token),null);assert.equal(f.revoked(f.foreign.token),null);
});
test('passwords preserve spaces and decomposed Unicode rather than trimming or normalizing',async t=>{
  const f=await fixture(t),value='  密码e\u0301😀Unicode账户!  ';assert.notEqual(value,value.normalize('NFC'));
  assert.equal((await f.change(PASSWORD,value)).status,200);
  for(const password of [value.trim(),value.normalize('NFC')])assert.equal((await f.call('/api/auth/login',{token:null,body:{username:'user-a',password}})).status,401);
  const exact=await f.call('/api/auth/login',{token:null,body:{username:'user-a',password:value}});assert.equal(exact.status,200,exact.raw);assert.equal(exact.data.account.id,'user-a');
});
test('the existing 128-code-point Unicode upper boundary remains usable',async t=>{
  const f=await fixture(t),value='密'.repeat(128);assert.equal((await f.change(PASSWORD,value)).status,200);assert.equal((await f.call('/api/auth/login',{token:null,body:{username:'user-a',password:value}})).status,200);
});
test('change does not invent a new password-history policy and still revokes sessions for the same value',async t=>{
  const f=await fixture(t);assert.equal((await f.change(PASSWORD,PASSWORD)).status,200);assert.equal(f.revoked(f.actor.token),NOW);assert.equal(f.revoked(f.peer.token),NOW);assert.equal(f.revoked(f.foreign.token),null);
});
test('request authentication, method and query boundaries remain closed',async t=>{
  const f=await fixture(t),before=f.credential();assert.equal((await f.call('/api/auth/password',{token:null,body:{currentPassword:PASSWORD,newPassword:REPLACEMENT}})).status,401);
  assert.equal((await f.call('/api/auth/password',{method:'GET'})).status,405);assert.equal((await f.call('/api/auth/password?userId=user-b',{body:{currentPassword:PASSWORD,newPassword:REPLACEMENT}})).status,400);
  assert.equal((await f.call('/api/auth/password',{body:{currentPassword:PASSWORD,newPassword:REPLACEMENT},headers:{Origin:'https://foreign.invalid'}})).status,403);assert.deepEqual(f.credential(),before);
});
test('wrong current-password attempts remain bounded without revoking a valid account',async t=>{
  const f=await fixture(t),before=f.credential();for(let i=0;i<10;i++)assert.equal((await f.change('WrongCurrent!2026')).status,403);const blocked=await f.change();assert.equal(blocked.status,429,blocked.raw);assert.equal(blocked.headers.get('retry-after'),'60');assert.deepEqual(f.credential(),before);assert.equal((await f.call('/api/auth/session')).status,200);
});
test('a credential storage error cannot leak SQL or falsely revoke the account',async t=>{
  const f=await fixture(t),before=f.credential(),prepare=f.db.prepare;f.db.prepare=function(sql){if(sql==='SELECT password_hash,revision FROM team_credentials WHERE user_id=?')throw Error('SELECT password_hash PRIVATE_STORAGE_PATH');return prepare.call(this,sql);};
  const result=await f.change();f.db.prepare=prepare;assert.equal(result.status,503,result.raw);assert.ok(!result.raw.includes('PRIVATE_STORAGE_PATH'));privateResponse(result);assert.deepEqual(f.credential(),before);assert.equal(f.revoked(f.actor.token),null);
});
test('real loopback HTTP enforces origin and password rotation without supplier configuration',async t=>{
  const f=await fixture(t),{startTeamServer}=await source('dev-server.mjs'),service=await startTeamServer({db:f.db,port:0,now:()=>NOW});t.after(()=>service.close());
  const send=async(route,body,token=f.actor.token,origin)=>{const r=await fetch(service.address.url+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...(origin?{Origin:origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:await r.json(),headers:r.headers};};
  const denied=await send('/api/auth/password',{currentPassword:PASSWORD,newPassword:REPLACEMENT},f.actor.token,'https://foreign.invalid');assert.equal(denied.status,403);
  const wrong=await send('/api/auth/password',{currentPassword:'WrongCurrent!2026',newPassword:REPLACEMENT});assert.equal(wrong.status,403);assert.equal((await send('/api/auth/session')).status,200);
  const result=await send('/api/auth/password',{currentPassword:PASSWORD,newPassword:REPLACEMENT});assert.equal(result.status,200);assert.deepEqual(result.data,{signedOut:true});assert.match(result.headers.get('cache-control'),/no-store/);assert.equal(result.headers.get('access-control-allow-origin'),null);
  assert.equal((await send('/api/auth/session',undefined,f.peer.token)).status,401);assert.equal((await send('/api/auth/session',undefined,f.foreign.token)).status,200);
});
