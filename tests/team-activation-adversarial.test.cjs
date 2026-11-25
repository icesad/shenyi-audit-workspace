'use strict';
// Independent acceptance of actual SQLite transactions and asynchronous races.
// No real SMS, desktop/shared demo data or timer-driven race assumptions.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {randomBytes}=require('node:crypto');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-15T06:00:00.000Z'),PASSWORD='ShenyiDemo!2026',PHONE='+8613800138000';
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function fixture(t){
  const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');
  const {handleTeamApplicationRequest}=await source('application-api.mjs');
  const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);await seedDemoTeamData(db);t.after(()=>db.close());
  const sent=[],providers={phonePepper:randomBytes(32),sms:{send:async message=>{sent.push(message);}}};
  const call=async(route,{body,token,method='POST'}={})=>{
    const response=await handleTeamApplicationRequest(new Request('https://review.synthetic.invalid'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{db,identityProviders:providers,now:()=>NOW});
    const raw=await response.text();return {status:response.status,data:JSON.parse(raw),raw};
  };
  const login=await call('/api/auth/login',{body:{username:'manager-a',password:PASSWORD}});assert.equal(login.status,200,login.raw);
  const created=await call('/api/teams/team-a/employee-invitations',{token:login.data.token,body:{phone:PHONE,role:'assistant'}});assert.equal(created.status,201,created.raw);
  return {db,sent,providers,call,token:login.data.token,invite:created.data};
}
const counts=db=>Object.fromEntries(['team_users','team_credentials','team_phone_credentials','team_memberships','team_activity','team_sessions'].map(table=>[table,db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n]));
async function activation(f){
  const body={invitationCode:f.invite.invitationCode,phone:PHONE};
  const challenge=await f.call('/api/auth/onboarding/challenges',{body});assert.equal(challenge.status,202,challenge.raw);
  assert.equal(f.sent.length,1);
  return {...body,challengeId:challenge.data.challengeId,code:f.sent[0].code,password:PASSWORD,displayName:'合成受邀员工',accept:true};
}
function signalPhoneSnapshot(t,db){
  const prepare=db.prepare,entered=deferred();let active=true;
  const restore=()=>{if(active){active=false;db.prepare=prepare;}};
  db.prepare=function(sql){
    const statement=prepare.call(this,sql);
    if(active&&sql.includes('phone.revision AS phone_revision')){
      const get=statement.get;
      statement.get=function(...args){const value=get.apply(this,args);restore();entered.resolve(value);return value;};
    }
    return statement;
  };
  t.after(restore);return entered.promise;
}
function assertUnconsumed(f,challengeId){
  const invitation=f.db.prepare('SELECT accepted_at,accepted_by FROM team_employee_invitations WHERE invitation_id=?').get(f.invite.invitationId);
  assert.equal(invitation.accepted_at,null);assert.equal(invitation.accepted_by,null);
  const challenge=f.db.prepare('SELECT consumed_at,attempts FROM team_employee_activation_challenges WHERE challenge_id=?').get(challengeId);
  assert.equal(challenge.consumed_at,null);assert.equal(challenge.attempts,1);
}
for(const mutation of ['revoke','disable']){
  test('SMS completion cannot revive activation after inviter '+mutation,{timeout:15000},async t=>{
    const f=await fixture(t),entered=deferred(),release=deferred();
    f.providers.sms.send=async message=>{f.sent.push(message);entered.resolve();await release.promise;};
    const baseline=counts(f.db);
    const pending=f.call('/api/auth/onboarding/challenges',{body:{invitationCode:f.invite.invitationCode,phone:PHONE}});await entered.promise;
    if(mutation==='revoke'){
      const result=await f.call('/api/teams/team-a/employee-invitations/'+f.invite.invitationId+'/revoke',{body:{},token:f.token});assert.equal(result.status,200,result.raw);
    }else f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='manager-a'").run();
    release.resolve();const result=await pending;assert.equal(result.status,404,result.raw);
    assert.deepEqual(counts(f.db),baseline);
    assert.equal(f.db.prepare('SELECT delivery_state FROM team_employee_activation_challenges').get().delivery_state,'failed');
    assert.equal((await f.call('/api/auth/onboarding/preview',{body:{invitationCode:f.invite.invitationCode,phone:PHONE}})).status,404);
  });
}
test('inviter grant revoked during password KDF denies account creation without orphans',{timeout:15000},async t=>{
  const f=await fixture(t),body=await activation(f),entered=signalPhoneSnapshot(t,f.db);
  const pending=f.call('/api/auth/onboarding/activate',{body});assert.equal(await entered,undefined);
  f.db.prepare("UPDATE team_admin_grants SET status='revoked' WHERE team_id='team-a' AND user_id='manager-a'").run();
  const baseline=counts(f.db),result=await pending;assert.equal(result.status,404,result.raw);assert.deepEqual(counts(f.db),baseline);assertUnconsumed(f,body.challengeId);
});
test('a phone owner appearing during new-account KDF is never silently merged',{timeout:15000},async t=>{
  const f=await fixture(t),body=await activation(f),entered=signalPhoneSnapshot(t,f.db);
  const pending=f.call('/api/auth/onboarding/activate',{body});assert.equal(await entered,undefined);
  f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('invitee-a',PHONE,NOW);
  const baseline=counts(f.db),result=await pending;assert.equal(result.status,409,result.raw);assert.deepEqual(counts(f.db),baseline);assertUnconsumed(f,body.challengeId);
  assert.equal(f.db.prepare("SELECT 1 FROM team_memberships WHERE user_id='invitee-a'").get(),undefined);
});
test('existing phone revision changed during current-password KDF cannot join',{timeout:15000},async t=>{
  const f=await fixture(t);f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('invitee-a',PHONE,NOW);
  const body=await activation(f),entered=signalPhoneSnapshot(t,f.db),pending=f.call('/api/auth/onboarding/activate',{body});assert.equal((await entered).user_id,'invitee-a');
  f.db.prepare("UPDATE team_phone_credentials SET revision=revision+1 WHERE user_id='invitee-a'").run();
  const baseline=counts(f.db),result=await pending;assert.equal(result.status,409,result.raw);assert.deepEqual(counts(f.db),baseline);assertUnconsumed(f,body.challengeId);
});
test('a disabled membership appearing during KDF blocks a second-team assignment',{timeout:15000},async t=>{
  const f=await fixture(t);f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('invitee-a',PHONE,NOW);
  const body=await activation(f),entered=signalPhoneSnapshot(t,f.db),pending=f.call('/api/auth/onboarding/activate',{body});assert.equal((await entered).user_id,'invitee-a');
  f.db.prepare("INSERT INTO team_memberships VALUES ('team-b','invitee-a','intern','disabled')").run();
  const baseline=counts(f.db),result=await pending;assert.equal(result.status,409,result.raw);assert.deepEqual(counts(f.db),baseline);assertUnconsumed(f,body.challengeId);
  assert.equal(f.db.prepare("SELECT 1 FROM team_memberships WHERE team_id='team-a' AND user_id='invitee-a'").get(),undefined);
});
test('membership storage failure rolls back all new identity and acceptance rows while preserving the attempt',{timeout:15000},async t=>{
  const f=await fixture(t),body=await activation(f),baseline=counts(f.db);
  f.db.exec("CREATE TRIGGER review_reject_new_member BEFORE INSERT ON team_memberships WHEN NEW.team_id='team-a' BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END;");
  const result=await f.call('/api/auth/onboarding/activate',{body});assert.equal(result.status,503,result.raw);assert.ok(!result.raw.includes('synthetic storage failure'));
  assert.deepEqual(counts(f.db),baseline);assertUnconsumed(f,body.challengeId);
  f.db.exec('DROP TRIGGER review_reject_new_member');
  assert.equal((await f.call('/api/auth/onboarding/activate',{body})).status,200);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_users').get().n,baseline.team_users+1);
});

for(const user of ['intern-a','assistant-a'])for(const endpoint of ['invitations','employee-invitations']){
  test(user+' cannot manage '+endpoint+' even with an accidentally granted member.invite',{timeout:15000},async t=>{
    const f=await fixture(t);
    f.db.prepare("INSERT INTO team_admin_grants VALUES ('team-a',?,'member.invite','active')").run(user);
    const login=await f.call('/api/auth/login',{body:{username:user,password:PASSWORD}});assert.equal(login.status,200,login.raw);
    const before={legacy:f.db.prepare('SELECT COUNT(*) AS n FROM team_invitations').get().n,employee:f.db.prepare('SELECT COUNT(*) AS n FROM team_employee_invitations').get().n};
    const body=endpoint==='invitations'?{username:'invitee-a',role:'intern'}:{phone:'+8613900139000',role:'intern'};
    const result=await f.call('/api/teams/team-a/'+endpoint,{token:login.data.token,body});
    assert.equal(result.status,404,'a collection-only role must not gain invitation management from a mistaken grant: '+result.raw);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_invitations').get().n,before.legacy);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_employee_invitations').get().n,before.employee);
    if(endpoint==='employee-invitations'){
      const access=await f.call('/api/teams/team-a/employee-invitations/access',{token:login.data.token,method:'GET'});
      assert.equal(access.status,200,access.raw);assert.deepEqual(access.data,{canInvite:false});
      assert.equal((await f.call('/api/teams/team-a/employee-invitations',{token:login.data.token,method:'GET'})).status,404);
      assert.equal((await f.call('/api/teams/team-a/employee-invitations/'+f.invite.invitationId+'/revoke',{token:login.data.token,body:{}})).status,404);
    }
  });
}

test('demoted inviter cannot keep a phone invitation redeemable through an old challenge',{timeout:15000},async t=>{
  const f=await fixture(t),body=await activation(f),baseline=counts(f.db);
  f.db.prepare("UPDATE team_memberships SET role='intern' WHERE team_id='team-a' AND user_id='manager-a'").run();
  assert.equal((await f.call('/api/auth/onboarding/preview',{body:{invitationCode:f.invite.invitationCode,phone:PHONE}})).status,404);
  assert.equal((await f.call('/api/auth/onboarding/activate',{body})).status,404);
  assert.deepEqual(counts(f.db),baseline);
  assert.equal(f.db.prepare('SELECT accepted_at FROM team_employee_invitations WHERE invitation_id=?').get(f.invite.invitationId).accepted_at,null);
});

test('demoted inviter cannot keep a legacy account invitation redeemable',{timeout:15000},async t=>{
  const f=await fixture(t);
  const invite=await f.call('/api/teams/team-a/invitations',{token:f.token,body:{username:'invitee-a',role:'assistant'}});assert.equal(invite.status,201,invite.raw);
  const login=await f.call('/api/auth/login',{body:{username:'invitee-a',password:PASSWORD}});assert.equal(login.status,200,login.raw);
  f.db.prepare("UPDATE team_memberships SET role='intern' WHERE team_id='team-a' AND user_id='manager-a'").run();
  const result=await f.call('/api/auth/invitations/accept',{token:login.data.token,body:{invitationToken:invite.data.invitationToken}});assert.equal(result.status,404,result.raw);
  assert.equal(f.db.prepare("SELECT 1 FROM team_memberships WHERE user_id='invitee-a'").get(),undefined);
});
