'use strict';
// Independent password-change boundaries. Real SQLite/scrypt and synthetic
// identities only; real statement/transaction signals decide ordering, not sleep.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{createHash,randomBytes}=require('node:crypto');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const ORIGIN='https://password-review.synthetic.invalid',NOW=Date.parse('2026-11-15T09:00:00.000Z');
const PASSWORD='IndependentPassword!2026',NEW_PASSWORD='IndependentReplacement!2026',PHONE='+8613800138000';
const digest=value=>createHash('sha256').update(value).digest('hex');
let cachedHash;
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function fixture(t){
  const {initializeTeamDatabase}=await source('database.mjs'),{hashPassword}=await source('passwords.mjs');
  const {issueSession}=await source('auth-api.mjs'),{transaction}=await source('http-utils.mjs');
  const {handleTeamApplicationRequest}=await source('application-api.mjs');
  cachedHash||=hashPassword(PASSWORD);
  const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);t.after(()=>db.close());
  for(const user of ['review-a','review-b']){db.prepare("INSERT INTO team_users VALUES (?,'active')").run(user);db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(user,user,user,await cachedHash);}
  const issue=user=>transaction(db,()=>issueSession(db,user,NOW));
  const actor=issue('review-a'),peer=issue('review-a'),foreign=issue('review-b'),providers={};
  const call=async(route,{body,token=actor.token,method='POST',request}={})=>{
    const response=await handleTeamApplicationRequest(request||new Request(ORIGIN+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{db,now:()=>NOW,identityProviders:providers});
    const raw=await response.text();return {status:response.status,raw,data:(response.headers.get('content-type')||'').startsWith('application/json')?JSON.parse(raw):null};
  };
  const credential=user=>({...db.prepare('SELECT password_hash,revision FROM team_credentials WHERE user_id=?').get(user)});
  const revoked=token=>db.prepare('SELECT revoked_at FROM team_sessions WHERE token_hash=?').get(digest(token)).revoked_at;
  return {db,actor,peer,foreign,providers,issue,call,credential,revoked};
}
function signalAfterRead(t,db,matches,count=1){
  const prepare=db.prepare,entered=deferred(),snapshots=[];let active=true;
  const restore=()=>{if(active){active=false;db.prepare=prepare;}};
  db.prepare=function(sql){const statement=prepare.call(this,sql);if(active&&matches(sql)){const get=statement.get;statement.get=function(...args){const row=get.apply(this,args);snapshots.push(row);if(snapshots.length===count){restore();entered.resolve(snapshots);}return row;};}return statement;};
  t.after(restore);return entered.promise;
}
const beforeKdf=(t,db,count)=>signalAfterRead(t,db,sql=>sql==='SELECT password_hash,revision FROM team_credentials WHERE user_id=?',count);
const change=f=>f.call('/api/auth/password',{body:{currentPassword:PASSWORD,newPassword:NEW_PASSWORD}});
const mutations=[
  ['the initiating session is revoked',f=>f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(NOW,digest(f.actor.token)),401],
  ['the initiating session changes account owner',f=>f.db.prepare("UPDATE team_sessions SET user_id='review-b' WHERE token_hash=?").run(digest(f.actor.token)),401],
  ['the initiating user is disabled',f=>f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='review-a'").run(),401],
  ['the credential revision changes',f=>f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='review-a'").run(),409],
  ['the credential hash changes without a revision update',f=>f.db.prepare("UPDATE team_credentials SET password_hash='synthetic-replaced-hash' WHERE user_id='review-a'").run(),409],
];
for(const [name,mutate,status] of mutations){
  test('pending password change cannot complete when '+name+' during KDF',{timeout:15000},async t=>{
    const f=await fixture(t),foreignBefore=f.credential('review-b'),entered=beforeKdf(t,f.db);
    const pending=change(f);const [snapshot]=await entered;assert.equal(snapshot.revision,1);assert.match(snapshot.password_hash,/^scrypt\$/);
    mutate(f);const intended=f.credential('review-a'),result=await pending;assert.equal(result.status,status,result.raw);
    assert.deepEqual(f.credential('review-a'),intended);assert.deepEqual(f.credential('review-b'),foreignBefore);assert.equal(f.revoked(f.peer.token),null);assert.equal(f.revoked(f.foreign.token),null);
  });
}

for(const mode of ['revoked','owner-changed']){
  test('password change rechecks its actor after a streamed body is '+mode,{timeout:15000},async t=>{
    const f=await fixture(t),beforeA=f.credential('review-a'),beforeB=f.credential('review-b');let controller;
    const body=new ReadableStream({start(value){controller=value;}}),request=new Request(ORIGIN+'/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+f.actor.token},body,duplex:'half'});
    const entered=signalAfterRead(t,f.db,sql=>sql.includes('SELECT session.user_id FROM team_sessions AS session'));
    const pending=f.call('',{request});assert.equal((await entered)[0].user_id,'review-a');
    if(mode==='revoked')f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(NOW,digest(f.actor.token));
    else f.db.prepare("UPDATE team_sessions SET user_id='review-b' WHERE token_hash=?").run(digest(f.actor.token));
    controller.enqueue(new TextEncoder().encode(JSON.stringify({currentPassword:PASSWORD,newPassword:NEW_PASSWORD})));controller.close();
    const result=await pending;assert.equal(result.status,401,result.raw);assert.deepEqual(f.credential('review-a'),beforeA);assert.deepEqual(f.credential('review-b'),beforeB);assert.equal(f.revoked(f.peer.token),null);assert.equal(f.revoked(f.foreign.token),null);
  });
}

test('an actor revoked after hashing but before the write transaction cannot change credentials',{timeout:15000},async t=>{
  const f=await fixture(t),before=f.credential('review-a'),exec=f.db.exec;let intercepted=false;
  f.db.exec=function(sql){if(!intercepted&&sql==='BEGIN IMMEDIATE'){intercepted=true;f.db.exec=exec;f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(NOW,digest(f.actor.token));}return exec.call(this,sql);};
  t.after(()=>{f.db.exec=exec;});const result=await change(f);assert.equal(intercepted,true);assert.equal(result.status,401,result.raw);assert.deepEqual(f.credential('review-a'),before);assert.equal(f.revoked(f.peer.token),null);assert.equal(f.revoked(f.foreign.token),null);
});

test('two password changes sharing the old credential have exactly one committed winner',{timeout:15000},async t=>{
  const f=await fixture(t),entered=beforeKdf(t,f.db,2),alternative='IndependentAlternative!2026';
  const one=change(f),two=f.call('/api/auth/password',{token:f.peer.token,body:{currentPassword:PASSWORD,newPassword:alternative}});
  const snapshots=await entered;assert.equal(snapshots.length,2);assert.ok(snapshots.every(row=>row.revision===1));
  const results=await Promise.all([one,two]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);assert.equal(f.credential('review-a').revision,2);
  const {verifyPassword}=await source('passwords.mjs'),hash=f.credential('review-a').password_hash;
  assert.notEqual(await verifyPassword(NEW_PASSWORD,hash),await verifyPassword(alternative,hash));assert.equal(await verifyPassword(PASSWORD,hash),false);
  assert.equal(f.revoked(f.actor.token),NOW);assert.equal(f.revoked(f.peer.token),NOW);assert.equal(f.revoked(f.foreign.token),null);
});

test('session-revocation storage failure rolls back hash, revision and all session changes',{timeout:15000},async t=>{
  const f=await fixture(t),before=f.credential('review-a'),beforeMeta=f.db.prepare('SELECT * FROM team_session_metadata ORDER BY session_id').all();
  f.db.exec("CREATE TRIGGER review_reject_password_logout BEFORE UPDATE OF revoked_at ON team_sessions WHEN NEW.revoked_at IS NOT NULL AND NEW.user_id='review-a' BEGIN SELECT RAISE(ABORT,'synthetic password rollback detail'); END;");
  const result=await change(f);assert.equal(result.status,503,result.raw);assert.ok(!result.raw.includes('synthetic password rollback detail'));assert.deepEqual(f.credential('review-a'),before);
  for(const item of [f.actor,f.peer,f.foreign])assert.equal(f.revoked(item.token),null);assert.deepEqual(f.db.prepare('SELECT * FROM team_session_metadata ORDER BY session_id').all(),beforeMeta);
  assert.equal(f.db.prepare('SELECT attempts FROM team_auth_limits WHERE bucket=?').get('password:'+digest('review-a')).attempts,1);
});

test('a phone-reset challenge issued before a password change cannot overwrite the new password',{timeout:15000},async t=>{
  const f=await fixture(t),sent=[];f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('review-a',PHONE,NOW);
  Object.assign(f.providers,{sms:{send:async item=>sent.push(item)},phonePepper:randomBytes(32),recovery:{authorize:async()=>true}});
  const challenge=await f.call('/api/auth/phone/challenges',{body:{phone:PHONE,purpose:'reset'},token:null});assert.equal(challenge.status,202,challenge.raw);assert.equal(sent.length,1);
  assert.equal((await change(f)).status,200);const after=f.credential('review-a');
  const reset=await f.call('/api/auth/phone/reset',{token:null,body:{challengeId:challenge.data.challengeId,code:sent[0].code,newPassword:'UnauthorizedReplacement!2026',recoveryProof:'synthetic-approved-proof'}});
  assert.equal(reset.status,400,reset.raw);assert.deepEqual(f.credential('review-a'),after);assert.equal(f.credential('review-a').revision,2);
});

test('an old phone-bind challenge cannot be used with a new login after changing password',{timeout:15000},async t=>{
  const f=await fixture(t),sent=[];Object.assign(f.providers,{sms:{send:async item=>sent.push(item)},phonePepper:randomBytes(32)});
  const challenge=await f.call('/api/auth/phone/challenges',{body:{phone:PHONE,purpose:'bind'}});assert.equal(challenge.status,202,challenge.raw);assert.equal(sent.length,1);
  assert.equal((await change(f)).status,200);const current=f.issue('review-a');
  const bound=await f.call('/api/auth/phone/bind',{token:current.token,body:{challengeId:challenge.data.challengeId,code:sent[0].code,currentPassword:NEW_PASSWORD}});
  assert.equal(bound.status,400,bound.raw);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_phone_credentials').get().n,0);
});

test('a ready WeChat transaction from the old credential revision cannot issue a session',{timeout:15000},async t=>{
  const f=await fixture(t),appId='synthetic-password-review',redirectUri=ORIGIN+'/api/auth/wechat/callback';
  f.providers.wechat={appId,redirectUri,createAuthorizationUrl:({state})=>'https://open.weixin.qq.com/connect/qrconnect?'+new URLSearchParams({appid:appId,redirect_uri:redirectUri,response_type:'code',scope:'snsapi_login',state}),exchangeCode:async()=>({appId,openId:'synthetic-password-open-id',access_token:'SUPPLIER_SECRET'})};
  f.db.prepare('INSERT INTO team_wechat_identities VALUES (?,?,?,?)').run(appId,'synthetic-password-open-id','review-a',NOW);
  const verifier=randomBytes(32).toString('base64url'),started=await f.call('/api/auth/wechat/transactions',{token:null,body:{codeChallenge:createHash('sha256').update(verifier).digest('base64url')}});assert.equal(started.status,201,started.raw);
  const state=new URL(started.data.authorizationUrl).searchParams.get('state'),callback=await f.call('/api/auth/wechat/callback?'+new URLSearchParams({state,code:'synthetic-password-code'}),{token:null,method:'GET'});assert.equal(callback.status,200);assert.ok(!callback.raw.includes('SUPPLIER_SECRET'));
  const prefix='/api/auth/wechat/transactions/'+started.data.transactionId,status=await f.call(prefix+'/status',{token:null,body:{pollToken:started.data.pollToken}});assert.equal(status.data.status,'ready');
  assert.equal((await change(f)).status,200);const count=f.db.prepare('SELECT COUNT(*) AS n FROM team_sessions').get().n;
  const exchanged=await f.call(prefix+'/exchange',{token:null,body:{pollToken:started.data.pollToken,codeVerifier:verifier}});assert.equal(exchanged.status,404,exchanged.raw);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_sessions').get().n,count);assert.equal(f.db.prepare('SELECT status FROM team_wechat_transactions').get().status,'ready');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_wechat_identities').get().n,1);
});
