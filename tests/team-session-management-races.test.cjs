'use strict';
// Independent deterministic session-revocation races: actual SQLite and scrypt.
// No shared demo, timer-driven ordering, real identities or external services.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-15T08:00:00.000Z'),PASSWORD='IndependentSession!2026';
const digest=token=>createHash('sha256').update(token).digest('hex');
let passwordHash;
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function fixture(t){
  const {initializeTeamDatabase}=await source('database.mjs'),{hashPassword}=await source('passwords.mjs');
  const {issueSession}=await source('auth-api.mjs'),{transaction}=await source('http-utils.mjs');
  const {handleTeamApplicationRequest}=await source('application-api.mjs');
  passwordHash||=hashPassword(PASSWORD);
  const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);t.after(()=>db.close());
  for(const user of ['review-a','review-b']){db.prepare("INSERT INTO team_users VALUES (?,'active')").run(user);db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(user,user,user,await passwordHash);}
  const issue=user=>transaction(db,()=>issueSession(db,user,NOW));
  const actor=issue('review-a'),peer=issue('review-a'),foreign=issue('review-b');
  const call=async(route,{body,token=actor.token,method='POST',request}={})=>{
    const response=await handleTeamApplicationRequest(request||new Request('https://review.synthetic.invalid'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body===undefined?{}:{body:JSON.stringify(body)})}),{db,now:()=>NOW});
    const raw=await response.text();return {status:response.status,raw,data:JSON.parse(raw)};
  };
  const id=token=>db.prepare('SELECT session_id FROM team_session_metadata WHERE token_hash=?').get(digest(token)).session_id;
  const revoked=token=>db.prepare('SELECT revoked_at FROM team_sessions WHERE token_hash=?').get(digest(token)).revoked_at;
  return {db,actor,peer,foreign,issue,call,id,revoked};
}
function signalAfterRead(t,db,matches){
  const prepare=db.prepare,entered=deferred();let active=true;
  const restore=()=>{if(active){active=false;db.prepare=prepare;}};
  db.prepare=function(sql){const statement=prepare.call(this,sql);if(active&&matches(sql)){const get=statement.get;statement.get=function(...args){const result=get.apply(this,args);restore();entered.resolve(result);return result;};}return statement;};
  t.after(restore);return entered.promise;
}
const credentialSnapshot=(t,db)=>signalAfterRead(t,db,sql=>sql==='SELECT password_hash,revision FROM team_credentials WHERE user_id=?');
const mutations=[
  ['the initiating session is revoked',f=>f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(NOW,digest(f.actor.token)),401],
  ['the initiating user is disabled',f=>f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='review-a'").run(),401],
  ['the credential revision changes',f=>f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='review-a'").run(),409],
  ['the credential hash changes without a revision update',f=>f.db.prepare("UPDATE team_credentials SET password_hash='synthetic-no-longer-valid' WHERE user_id='review-a'").run(),409],
];
for(const [name,mutate,status] of mutations){
  test('pending personal revocation cannot complete when '+name+' during KDF',{timeout:15000},async t=>{
    const f=await fixture(t),entered=credentialSnapshot(t,f.db);
    const pending=f.call('/api/auth/sessions/'+f.id(f.peer.token)+'/revoke',{body:{currentPassword:PASSWORD}});
    const snapshot=await entered;assert.equal(snapshot.revision,1);assert.match(snapshot.password_hash,/^scrypt\$/);
    mutate(f);const result=await pending;assert.equal(result.status,status,result.raw);
    assert.equal(f.revoked(f.peer.token),null);assert.equal(f.revoked(f.foreign.token),null);
  });
}
test('a target changing account owner during KDF cannot revoke the new owner session',{timeout:15000},async t=>{
  const f=await fixture(t),entered=credentialSnapshot(t,f.db),targetId=f.id(f.peer.token);
  const pending=f.call('/api/auth/sessions/'+targetId+'/revoke',{body:{currentPassword:PASSWORD}});await entered;
  f.db.prepare("UPDATE team_sessions SET user_id='review-b' WHERE token_hash=?").run(digest(f.peer.token));
  const result=await pending;assert.equal(result.status,404,result.raw);assert.equal(f.revoked(f.peer.token),null);assert.equal(f.revoked(f.actor.token),null);assert.equal(f.revoked(f.foreign.token),null);
});
test('revoke-others commits all new own sessions while preserving current and foreign sessions',{timeout:15000},async t=>{
  const f=await fixture(t),entered=credentialSnapshot(t,f.db);
  const pending=f.call('/api/auth/sessions/revoke-others',{body:{currentPassword:PASSWORD}});await entered;
  const newOwn=f.issue('review-a'),newForeign=f.issue('review-b');
  const result=await pending;assert.equal(result.status,200,result.raw);assert.deepEqual(result.data,{revokedCount:2,signedOut:false});
  assert.equal(f.revoked(f.peer.token),NOW);assert.equal(f.revoked(newOwn.token),NOW);
  assert.equal(f.revoked(f.actor.token),null);assert.equal(f.revoked(f.foreign.token),null);assert.equal(f.revoked(newForeign.token),null);
  assert.equal((await f.call('/api/auth/session',{method:'GET',token:newOwn.token})).status,401);
  assert.equal((await f.call('/api/auth/session',{method:'GET',token:f.actor.token})).status,200);
});
test('revocation blocked on a streamed body rechecks the initiating session before password work',{timeout:15000},async t=>{
  const f=await fixture(t);let controller;
  const body=new ReadableStream({start(value){controller=value;}});
  const request=new Request('https://review.synthetic.invalid/api/auth/sessions/revoke-others',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+f.actor.token},body,duplex:'half'});
  const entered=signalAfterRead(t,f.db,sql=>sql.includes('SELECT session.user_id FROM team_sessions AS session'));
  const pending=f.call('',{request});assert.equal((await entered).user_id,'review-a');
  f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(NOW,digest(f.actor.token));
  controller.enqueue(new TextEncoder().encode(JSON.stringify({currentPassword:PASSWORD})));controller.close();
  const result=await pending;assert.equal(result.status,401,result.raw);assert.equal(f.revoked(f.peer.token),null);assert.equal(f.revoked(f.foreign.token),null);
  assert.equal(f.db.prepare("SELECT 1 FROM team_auth_limits WHERE bucket LIKE 'session-revoke:%'").get(),undefined);
});
test('a storage failure in bulk revoke rolls back all affected own sessions',{timeout:15000},async t=>{
  const f=await fixture(t),extra=f.issue('review-a');
  f.db.exec("CREATE TRIGGER review_reject_session_revoke BEFORE UPDATE OF revoked_at ON team_sessions WHEN NEW.revoked_at IS NOT NULL AND NEW.user_id='review-a' BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END;");
  const result=await f.call('/api/auth/sessions/revoke-all',{body:{currentPassword:PASSWORD}});assert.equal(result.status,503,result.raw);assert.ok(!result.raw.includes('synthetic storage failure'));
  for(const token of [f.actor.token,f.peer.token,extra.token,f.foreign.token])assert.equal(f.revoked(token),null);
  assert.equal(f.db.prepare("SELECT attempts FROM team_auth_limits WHERE bucket LIKE 'session-revoke:%'").get().attempts,1);
});
