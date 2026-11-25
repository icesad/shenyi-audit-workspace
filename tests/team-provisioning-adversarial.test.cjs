'use strict';
// Independent acceptance: real SQLite/scrypt, exclusively synthetic identities
// and a captured SMS adapter. Statement signals order races without timer sleeps.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{createHash,randomBytes}=require('node:crypto');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const load=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const ORIGIN='https://provision-review.synthetic.invalid',NOW=Date.parse('2026-11-15T11:00:00.000Z');
const PASSWORD='IndependentReview!2026',NEW_PASSWORD='IndependentFirstAdmin!2026',PHONE='+8613800199000',STAFF_PHONE='+8613800199001';
const ROOT='/api/operations/team-requests',PUBLIC='/api/auth/first-administrator';
const hash=value=>createHash('sha256').update(value).digest('hex');
let cachedHash;
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function fixture(t){
  const {initializeTeamDatabase}=await load('database.mjs'),{hashPassword}=await load('passwords.mjs');
  const {issueSession}=await load('auth-api.mjs'),{transaction}=await load('http-utils.mjs');
  const {handleTeamApplicationRequest}=await load('application-api.mjs');
  cachedHash||=hashPassword(PASSWORD);
  const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);t.after(()=>db.close());
  for(const id of ['reviewer-a','reviewer-b','manager-a','intern-a','orphan-a']){
    db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);
    db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(id,id,id,await cachedHash);
  }
  for(const teamId of ['team-a','team-b'])db.prepare("INSERT INTO teams VALUES (?,'active')").run(teamId);
  for(const [id,role]of [['manager-a','manager'],['intern-a','intern']])db.prepare("INSERT INTO team_memberships VALUES ('team-a',?,?,'active')").run(id,role);
  db.prepare("INSERT INTO team_admin_grants VALUES ('team-a','manager-a','member.invite','active')").run();
  for(const id of ['reviewer-a','reviewer-b'])db.prepare("INSERT INTO team_platform_reviewers(user_id,permission,status) VALUES (?,'team.provision','active')").run(id);
  const issue=id=>transaction(db,()=>issueSession(db,id,NOW));
  const f={db,at:NOW,issued:{},sent:[],providers:{phonePepper:randomBytes(32)}};
  f.providers.sms={send:async item=>{f.sent.push({...item});}};
  f.issue=id=>{const session=issue(id);f.issued[id]=session;return session;};
  for(const id of ['reviewer-a','reviewer-b','manager-a','intern-a','orphan-a'])f.issue(id);
  f.call=async(route,{body,token=f.issued['reviewer-a'].token,method='POST',request,providers=f.providers,headers={}}={})=>{
    const response=await handleTeamApplicationRequest(request||new Request(ORIGIN+route,{method,headers:{'Content-Type':'application/json',...headers,...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{db,now:()=>f.at,identityProviders:providers});
    const raw=await response.text();assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('access-control-allow-origin'),null);
    return {status:response.status,raw,data:(response.headers.get('content-type')||'').startsWith('application/json')?JSON.parse(raw):null};
  };
  f.count=table=>db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
  return f;
}
function signalAfterRead(t,db,matches){
  const prepare=db.prepare,entered=deferred();let active=true;
  const restore=()=>{if(active){active=false;db.prepare=prepare;}};
  db.prepare=function(sql){const statement=prepare.call(this,sql);if(active&&matches(sql)){const get=statement.get;statement.get=function(...args){const row=get.apply(this,args);restore();entered.resolve(row);return row;};}return statement;};
  t.after(restore);return entered.promise;
}
async function create(f,phone=PHONE){
  const result=await f.call(ROOT,{body:{teamName:'独立合成审计团队',adminPhone:phone}});assert.equal(result.status,201,result.raw);return result.data.request;
}
async function approve(f,request=undefined){
  request||=await create(f);
  const result=await f.call(ROOT+'/'+request.id+'/review',{body:{decision:'approve',revision:request.revision,currentPassword:PASSWORD}});assert.equal(result.status,200,result.raw);return result.data;
}
async function challenge(f,ticket,phone=PHONE){
  const result=await f.call(PUBLIC+'/challenges',{token:null,body:{invitationCode:ticket.invitationCode,phone}});assert.equal(result.status,202,result.raw);
  const sent=f.sent.find(item=>item.challengeId===result.data.challengeId);assert.equal(sent.purpose,'first-admin');assert.ok(!result.raw.includes(sent.code));return {...result.data,code:sent.code};
}
function activation(ticket,c,phone=PHONE,password=NEW_PASSWORD){return {invitationCode:ticket.invitationCode,phone,challengeId:c.challengeId,code:c.code,password,displayName:'合成首管理员',accept:true};}
const activate=(f,body)=>f.call(PUBLIC+'/activate',{token:null,body});
function snapshots(f){return Object.fromEntries(['teams','team_profiles','team_users','team_credentials','team_phone_credentials','team_operators','team_memberships','team_project_grants','team_task_assignments','team_attachment_grants','team_admin_grants','team_sessions'].map(table=>[table,f.db.prepare('SELECT * FROM '+table).all()]));}

test('a business role or forged actor headers never confer platform review; a junior mistaken grant stays denied',async t=>{
  const f=await fixture(t);
  for(const id of ['manager-a','intern-a']){
    const token=f.issued[id].token;
    assert.deepEqual((await f.call(ROOT+'/access',{token,method:'GET',headers:{'X-Role':'platform-owner','X-User-Id':'reviewer-a'}})).data,{canReview:false});
    assert.equal((await f.call(ROOT,{token,method:'GET'})).status,404);
    assert.equal((await f.call(ROOT,{token,body:{teamName:'合成',adminPhone:PHONE}})).status,404);
  }
  f.db.prepare("INSERT INTO team_platform_reviewers(user_id,permission,status) VALUES ('intern-a','team.provision','active')").run();
  assert.deepEqual((await f.call(ROOT+'/access',{token:f.issued['intern-a'].token,method:'GET'})).data,{canReview:false});
  assert.equal((await f.call(ROOT,{token:f.issued['intern-a'].token,body:{teamName:'合成',adminPhone:PHONE}})).status,404);
  assert.equal(f.count('team_provisioning_requests'),0);
});

test('unapproved intake contains no activation credential and does not create a live team or privilege',async t=>{
  const f=await fixture(t),before=snapshots(f),request=await create(f);
  assert.equal(request.status,'pending');assert.equal(request.expiresAt,null);assert.equal(request.revision,1);
  assert.deepEqual(Object.keys(request).sort(),['createdAt','expiresAt','id','phoneMasked','revision','status','teamId','teamName']);
  assert.ok(!JSON.stringify(request).includes(PHONE));assert.deepEqual(snapshots(f),before);
  const row=f.db.prepare('SELECT * FROM team_provisioning_requests').get();assert.equal(row.token_hash,null);
  const listed=await f.call(ROOT,{method:'GET'});assert.equal(listed.status,200);assert.ok(!listed.raw.includes(PHONE));assert.ok(!listed.raw.includes('token_hash'));
  const denied=await f.call(PUBLIC+'/preview',{token:null,body:{invitationCode:randomBytes(32).toString('base64url'),phone:PHONE}});assert.equal(denied.status,404);
});

test('approval requires current password and original revision; only its one response exposes the one-time code',async t=>{
  const f=await fixture(t),request=await create(f);
  const route=ROOT+'/'+request.id+'/review',body={decision:'approve',revision:request.revision,currentPassword:PASSWORD};
  assert.equal((await f.call(route,{body:{...body,currentPassword:'WrongPassword!2026'}})).status,403);
  assert.equal((await f.call(route,{body:{...body,revision:request.revision+1}})).status,409);
  assert.equal((await f.call(route,{body:{...body,role:'partner'}})).status,400);
  const approved=await f.call(route,{body});assert.equal(approved.status,200,approved.raw);assert.match(approved.data.invitationCode,/^[A-Za-z0-9_-]{43}$/);
  const row=f.db.prepare('SELECT * FROM team_provisioning_requests').get();assert.equal(row.token_hash,hash(approved.data.invitationCode));assert.ok(!JSON.stringify(row).includes(approved.data.invitationCode));
  assert.equal((await f.call(route,{body})).status,409);
  const listed=await f.call(ROOT,{method:'GET'});assert.ok(!listed.raw.includes(approved.data.invitationCode));assert.ok(!listed.raw.includes(PHONE));
  const preview=await f.call(PUBLIC+'/preview',{token:null,body:{invitationCode:approved.data.invitationCode,phone:PHONE}});assert.equal(preview.status,200,preview.raw);assert.ok(!preview.raw.includes(PHONE));
  assert.equal(f.count('teams'),2);assert.equal(f.count('team_operators'),0);
});

for(const [name,mutation]of [
  ['grant revocation',f=>f.db.prepare("UPDATE team_platform_reviewers SET status='revoked' WHERE user_id='reviewer-a'").run()],
  ['reviewer disable',f=>f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='reviewer-a'").run()],
  ['reviewer credential revision',f=>f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='reviewer-a'").run()],
  ['reviewer hash without revision',f=>f.db.prepare("UPDATE team_credentials SET password_hash='synthetic-hash-change' WHERE user_id='reviewer-a'").run()],
])test('an approved first-admin invitation becomes unusable after '+name,async t=>{
  const f=await fixture(t),ticket=await approve(f),c=await challenge(f,ticket),before=snapshots(f);mutation(f);
  const intended=snapshots(f),result=await activate(f,activation(ticket,c));assert.equal(result.status,404,result.raw);assert.deepEqual(snapshots(f),intended);assert.equal(f.count('team_operators'),0);assert.equal(before.teams.length,2);
});

test('reviewer logout does not cancel an approved invitation while active approval authority stays unchanged',async t=>{
  const f=await fixture(t),ticket=await approve(f),c=await challenge(f,ticket),before=f.count('team_sessions');
  f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE user_id=?').run(NOW,'reviewer-a');
  const result=await activate(f,activation(ticket,c));assert.equal(result.status,200,result.raw);assert.equal(f.count('team_sessions'),before);
});

for(const [name,mutation]of [
  ['session revoked',f=>f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(NOW,hash(f.issued['reviewer-a'].token))],
  ['session owner changes',f=>f.db.prepare("UPDATE team_sessions SET user_id='reviewer-b' WHERE token_hash=?").run(hash(f.issued['reviewer-a'].token))],
  ['grant revoked',f=>f.db.prepare("UPDATE team_platform_reviewers SET status='revoked' WHERE user_id='reviewer-a'").run()],
  ['credential changes',f=>f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='reviewer-a'").run()],
])test('approval refuses '+name+' during real KDF without producing a usable invitation',{timeout:15000},async t=>{
  const f=await fixture(t),request=await create(f);
  const entered=signalAfterRead(t,f.db,sql=>sql==='SELECT * FROM team_provisioning_requests WHERE request_id=?');
  const pending=f.call(ROOT+'/'+request.id+'/review',{body:{decision:'approve',revision:request.revision,currentPassword:PASSWORD}});
  const snapshot=await entered;assert.equal(snapshot.status,'pending');assert.equal(snapshot.revision,1);mutation(f);
  const result=await pending;assert.ok([401,404,409].includes(result.status),result.raw);
  const row=f.db.prepare('SELECT * FROM team_provisioning_requests').get();assert.equal(row.status,'pending');assert.equal(row.token_hash,null);assert.equal(f.count('team_operators'),0);assert.equal(f.count('teams'),2);
});

test('revoking approval during SMS delivery invalidates the challenge without creating a team',async t=>{
  const f=await fixture(t),ticket=await approve(f),entered=deferred(),release=deferred();
  f.providers.sms.send=async item=>{f.sent.push({...item});entered.resolve();await release.promise;};
  const pending=f.call(PUBLIC+'/challenges',{token:null,body:{invitationCode:ticket.invitationCode,phone:PHONE}});await entered.promise;
  f.db.prepare("UPDATE team_platform_reviewers SET status='revoked' WHERE user_id='reviewer-a'").run();release.resolve();
  const result=await pending;assert.equal(result.status,404,result.raw);assert.equal(f.count('teams'),2);assert.equal(f.count('team_operators'),0);
  assert.equal(f.db.prepare('SELECT delivery_state FROM team_first_administrator_challenges').get().delivery_state,'failed');
});

test('first administrator activation is atomic and cannot acquire business data, role, grants or a session',async t=>{
  const f=await fixture(t),ticket=await approve(f),c=await challenge(f,ticket),before=f.count('team_sessions');
  const result=await activate(f,activation(ticket,c));assert.equal(result.status,200,result.raw);assert.deepEqual(result.data,{activated:true});assert.equal(f.count('team_sessions'),before);
  const owner=f.db.prepare('SELECT user_id FROM team_phone_credentials WHERE phone=?').get(PHONE);assert.ok(owner);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_memberships WHERE user_id=?').get(owner.user_id).n,0);
  for(const table of ['team_task_assignments','team_project_grants','team_attachment_grants','team_admin_grants'])assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE user_id=?').get(owner.user_id).n,0);
  const login=await f.call('/api/auth/phone/login',{token:null,body:{phone:PHONE,password:NEW_PASSWORD}});assert.equal(login.status,200,login.raw);assert.deepEqual(login.data.memberships,[]);
  const token=login.data.token,admin=await f.call('/api/auth/team-administration',{token,method:'GET'});assert.deepEqual(admin.data,{teams:[{teamId:ticket.request.teamId,teamName:ticket.request.teamName}]});
  assert.equal((await f.call(ROOT,{token,method:'GET'})).status,404);
  for(const teamId of [ticket.request.teamId,'team-a','team-b'])assert.equal((await f.call('/api/teams/'+teamId+'/collection/tasks',{token,method:'GET'})).status,404);
  assert.equal((await f.call(ROOT+'/'+ticket.request.id+'/review',{body:{decision:'revoke',revision:ticket.request.revision,currentPassword:PASSWORD}})).status,409);
  assert.equal(f.count('teams'),3);assert.equal(f.count('team_operators'),1);
});

test('operator creation storage failure rolls back new team, profile, account, phone, operator and consumption',async t=>{
  const f=await fixture(t),ticket=await approve(f),c=await challenge(f,ticket),before=snapshots(f);
  f.db.exec("CREATE TRIGGER synthetic_operator_failure BEFORE INSERT ON team_operators BEGIN SELECT RAISE(ABORT,'SYNTHETIC_INTERNAL_OPERATOR_FAILURE'); END");
  const result=await activate(f,activation(ticket,c));assert.equal(result.status,503,result.raw);assert.ok(!result.raw.includes('SYNTHETIC_INTERNAL_OPERATOR_FAILURE'));assert.deepEqual(snapshots(f),before);
  assert.equal(f.db.prepare('SELECT status FROM team_provisioning_requests').get().status,'approved');assert.equal(f.db.prepare('SELECT consumed_at FROM team_first_administrator_challenges').get().consumed_at,null);
  f.db.exec('DROP TRIGGER synthetic_operator_failure');assert.equal((await activate(f,activation(ticket,c))).status,200);
});

test('no configured SMS means an honest unavailable response and no challenge or activation identity',async t=>{
  const f=await fixture(t),ticket=await approve(f),result=await f.call(PUBLIC+'/challenges',{token:null,providers:{},body:{invitationCode:ticket.invitationCode,phone:PHONE}});
  assert.equal(result.status,503,result.raw);assert.equal(f.sent.length,0);assert.equal(f.count('team_first_administrator_challenges'),0);assert.equal(f.count('team_operators'),0);
});

test('a verified orphan must prove its existing password; activation reuses identity without resetting credentials',async t=>{
  const f=await fixture(t);f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('orphan-a',PHONE,NOW-1);
  const before={...f.db.prepare("SELECT * FROM team_credentials WHERE user_id='orphan-a'").get()},ticket=await approve(f),c=await challenge(f,ticket);
  const wrong=await activate(f,activation(ticket,c));assert.equal(wrong.status,404,wrong.raw);assert.equal(f.count('team_operators'),0);
  const result=await activate(f,activation(ticket,c,PHONE,PASSWORD));assert.equal(result.status,200,result.raw);assert.deepEqual({...f.db.prepare("SELECT * FROM team_credentials WHERE user_id='orphan-a'").get()},before);assert.equal(f.count('team_users'),5);
  assert.equal(f.db.prepare('SELECT user_id FROM team_operators').get().user_id,'orphan-a');
});

for(const mode of ['active-member','disabled-member','revoked-operator','disabled-account'])test('first-admin activation cannot reclassify an existing '+mode,async t=>{
  const f=await fixture(t);f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('orphan-a',PHONE,NOW-1);
  if(mode.includes('member'))f.db.prepare('INSERT INTO team_memberships VALUES (?,?,?,?)').run('team-b','orphan-a','assistant',mode==='disabled-member'?'disabled':'active');
  if(mode==='revoked-operator')f.db.prepare("INSERT INTO team_operators VALUES ('team-b','orphan-a','administrator','revoked')").run();
  if(mode==='disabled-account')f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='orphan-a'").run();
  const ticket=await approve(f),c=await challenge(f,ticket),before=snapshots(f),result=await activate(f,activation(ticket,c,PHONE,PASSWORD));assert.equal(result.status,409,result.raw);assert.deepEqual(snapshots(f),before);
});

test('five wrong first-admin codes consume all attempts and a correct replay cannot activate',async t=>{
  const f=await fixture(t),ticket=await approve(f),c=await challenge(f,ticket),body=activation(ticket,c),wrong=c.code==='000000'?'000001':'000000';
  for(let index=0;index<5;index++)assert.equal((await activate(f,{...body,code:wrong})).status,404);
  assert.equal((await activate(f,body)).status,404);assert.equal(f.db.prepare('SELECT attempts FROM team_first_administrator_challenges').get().attempts,5);assert.equal(f.count('team_operators'),0);
});

test('first-admin SMS and employee SMS share the same per-phone rate budget',async t=>{
  const f=await fixture(t),ticket=await approve(f);
  await challenge(f,ticket);await challenge(f,ticket);await challenge(f,ticket);
  const invitation=await f.call('/api/teams/team-a/employee-invitations',{token:f.issued['manager-a'].token,body:{phone:PHONE,role:'intern'}});assert.equal(invitation.status,201,invitation.raw);
  const result=await f.call('/api/auth/onboarding/challenges',{token:null,body:{invitationCode:invitation.data.invitationCode,phone:PHONE}});assert.equal(result.status,429,result.raw);assert.equal(f.sent.length,3);
});

async function operatorFixture(t){
  const f=await fixture(t);
  f.db.prepare("INSERT INTO team_profiles VALUES ('team-b','合成运营团队')").run();
  f.db.prepare("INSERT INTO team_operators VALUES ('team-b','orphan-a','administrator','active')").run();
  f.operator=f.issued['orphan-a'].token;return f;
}
async function employeeInvite(f){
  const result=await f.call('/api/teams/team-b/employee-invitations',{token:f.operator,body:{phone:STAFF_PHONE,role:'intern'}});assert.equal(result.status,201,result.raw);return result.data;
}
async function employeeChallenge(f,invitation){
  const result=await f.call('/api/auth/onboarding/challenges',{token:null,body:{invitationCode:invitation.invitationCode,phone:STAFF_PHONE}});assert.equal(result.status,202,result.raw);return {...result.data,code:f.sent.find(item=>item.challengeId===result.data.challengeId).code};
}
function staffActivation(invitation,c){return {invitationCode:invitation.invitationCode,phone:STAFF_PHONE,challengeId:c.challengeId,code:c.code,password:NEW_PASSWORD,displayName:'独立合成员工',accept:true};}

test('technical administrator uses the separate invitation source and a newly activated employee has no unassigned data',async t=>{
  const f=await operatorFixture(t),invitation=await employeeInvite(f),c=await employeeChallenge(f,invitation);
  assert.equal(f.count('team_employee_invitations'),0);assert.equal(f.count('team_operator_employee_invitations'),1);assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM team_memberships WHERE user_id='orphan-a'").get().n,0);
  assert.equal((await f.call('/api/teams/team-a/employee-invitations',{token:f.operator,method:'GET'})).status,404);
  assert.equal((await f.call('/api/teams/team-b/collection/tasks',{token:f.operator,method:'GET'})).status,404);
  const activated=await f.call('/api/auth/onboarding/activate',{token:null,body:staffActivation(invitation,c)});assert.equal(activated.status,200,activated.raw);
  const login=await f.call('/api/auth/phone/login',{token:null,body:{phone:STAFF_PHONE,password:NEW_PASSWORD}});assert.equal(login.status,200,login.raw);assert.deepEqual(login.data.memberships,[{teamId:'team-b',role:'intern'}]);
  assert.deepEqual((await f.call('/api/teams/team-b/collection/tasks',{token:login.data.token,method:'GET'})).data.tasks,[]);
  assert.equal((await f.call('/api/teams/team-a/collection/tasks',{token:login.data.token,method:'GET'})).status,404);
  assert.deepEqual((await f.call('/api/auth/team-administration',{token:login.data.token,method:'GET'})).data,{teams:[]});
});

test('mistaken operator assignment to a junior never authorizes invitation or exposes operator team metadata',async t=>{
  const f=await fixture(t);f.db.prepare("INSERT INTO team_operators VALUES ('team-b','intern-a','administrator','active')").run();
  const token=f.issued['intern-a'].token;assert.deepEqual((await f.call('/api/auth/team-administration',{token,method:'GET'})).data,{teams:[]});
  assert.equal((await f.call('/api/teams/team-b/employee-invitations',{token,body:{phone:STAFF_PHONE,role:'intern'}})).status,404);
  assert.equal((await f.call('/api/teams/team-b/employee-invitations/access',{token,method:'GET'})).status,404);assert.equal(f.count('team_operator_employee_invitations'),0);
});

test('a revoked technical administrator cannot leave outstanding employee tickets redeemable',async t=>{
  const f=await operatorFixture(t),invitation=await employeeInvite(f),c=await employeeChallenge(f,invitation),before=snapshots(f);
  f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='orphan-a'").run();const intended=snapshots(f);
  const activated=await f.call('/api/auth/onboarding/activate',{token:null,body:staffActivation(invitation,c)});assert.equal(activated.status,404,activated.raw);assert.deepEqual(snapshots(f),intended);assert.equal(before.team_users.length,5);
});

test('an ambiguous token duplicated across business and operator invitation sources fails closed',async t=>{
  const f=await operatorFixture(t),invitation=await employeeInvite(f);
  f.db.prepare("INSERT INTO team_memberships VALUES ('team-b','manager-a','manager','active')").run();f.db.prepare("INSERT INTO team_admin_grants VALUES ('team-b','manager-a','member.invite','active')").run();
  const row=f.db.prepare('SELECT * FROM team_operator_employee_invitations').get();
  f.db.prepare('INSERT INTO team_employee_invitations(invitation_id,token_hash,team_id,phone,role,invited_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(row.invitation_id,row.token_hash,row.team_id,row.phone,row.role,'manager-a',row.created_at,row.expires_at);
  const result=await f.call('/api/auth/onboarding/preview',{token:null,body:{invitationCode:invitation.invitationCode,phone:STAFF_PHONE}});assert.equal(result.status,404,result.raw);
});

test('the legacy username invitation route cannot add a technical administrator to audit membership',async t=>{
  const f=await operatorFixture(t),invitation=await f.call('/api/teams/team-a/invitations',{token:f.issued['manager-a'].token,body:{username:'orphan-a',role:'assistant'}});assert.equal(invitation.status,201,invitation.raw);
  const result=await f.call('/api/auth/invitations/accept',{token:f.operator,body:{invitationToken:invitation.data.invitationToken}});assert.equal(result.status,409,result.raw);assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM team_memberships WHERE user_id='orphan-a'").get().n,0);
});

for(const [name,mutation]of [
  ['approval revoked',f=>f.db.prepare("UPDATE team_provisioning_requests SET status='revoked',revision=revision+1").run()],
  ['reviewer authority revoked',f=>f.db.prepare("UPDATE team_platform_reviewers SET status='revoked' WHERE user_id='reviewer-a'").run()],
])test('new first-admin activation cannot survive '+name+' during password hashing',{timeout:15000},async t=>{
  const f=await fixture(t),ticket=await approve(f),c=await challenge(f,ticket),before=snapshots(f);
  const entered=signalAfterRead(t,f.db,sql=>sql.startsWith('SELECT phone.user_id,phone.revision AS phone_revision,phone.verified_at,'));
  const pending=activate(f,activation(ticket,c));assert.equal(await entered,undefined);mutation(f);
  const result=await pending;assert.equal(result.status,404,result.raw);assert.deepEqual(snapshots(f),before);assert.equal(f.db.prepare('SELECT consumed_at FROM team_first_administrator_challenges').get().consumed_at,null);
});

for(const [name,mutation]of [
  ['verified phone revision changes',f=>f.db.prepare("UPDATE team_phone_credentials SET revision=revision+1 WHERE user_id='orphan-a'").run()],
  ['existing account is disabled',f=>f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='orphan-a'").run()],
  ['another technical affiliation appears',f=>f.db.prepare("INSERT INTO team_operators VALUES ('team-b','orphan-a','administrator','active')").run()],
  ['existing password hash changes without revision',f=>f.db.prepare("UPDATE team_credentials SET password_hash='synthetic-existing-hash' WHERE user_id='orphan-a'").run()],
])test('existing-account first-admin activation refuses when '+name+' during KDF',{timeout:15000},async t=>{
  const f=await fixture(t);f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('orphan-a',PHONE,NOW-1);
  const ticket=await approve(f),c=await challenge(f,ticket),entered=signalAfterRead(t,f.db,sql=>sql.startsWith('SELECT phone.user_id,phone.revision AS phone_revision,phone.verified_at,'));
  const pending=activate(f,activation(ticket,c,PHONE,PASSWORD));assert.equal((await entered).user_id,'orphan-a');mutation(f);const intended=snapshots(f);
  const result=await pending;assert.equal(result.status,409,result.raw);assert.deepEqual(snapshots(f),intended);assert.equal(f.db.prepare('SELECT status FROM team_provisioning_requests').get().status,'approved');
});

for(const action of ['create','approve'])for(const mode of ['revoked','owner-changed'])test('review '+action+' checks the same initiating actor after a streamed body is '+mode,{timeout:15000},async t=>{
  const f=await fixture(t),request=action==='approve'?await create(f):null,route=action==='create'?ROOT:ROOT+'/'+request.id+'/review';
  const before=f.db.prepare('SELECT * FROM team_provisioning_requests').all();let controller;
  const stream=new ReadableStream({start(value){controller=value;}}),wire=new Request(ORIGIN+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+f.issued['reviewer-a'].token},body:stream,duplex:'half'});
  const entered=signalAfterRead(t,f.db,sql=>sql.includes('SELECT session.user_id FROM team_sessions AS session'));
  const pending=f.call('',{request:wire});assert.equal((await entered).user_id,'reviewer-a');
  if(mode==='revoked')f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(NOW,hash(f.issued['reviewer-a'].token));
  else f.db.prepare("UPDATE team_sessions SET user_id='reviewer-b' WHERE token_hash=?").run(hash(f.issued['reviewer-a'].token));
  controller.enqueue(new TextEncoder().encode(JSON.stringify(action==='create'?{teamName:'延迟合成团队',adminPhone:PHONE}:{decision:'approve',revision:request.revision,currentPassword:PASSWORD})));controller.close();
  const result=await pending;assert.ok([401,404].includes(result.status),result.raw);assert.deepEqual(f.db.prepare('SELECT * FROM team_provisioning_requests').all(),before);assert.equal(f.count('team_operators'),0);
});

test('employee invitation creation also checks the initiating account after body streaming',async t=>{
  const f=await operatorFixture(t);let controller;
  const stream=new ReadableStream({start(value){controller=value;}}),wire=new Request(ORIGIN+'/api/teams/team-b/employee-invitations',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+f.operator},body:stream,duplex:'half'});
  const entered=signalAfterRead(t,f.db,sql=>sql.includes('SELECT session.user_id FROM team_sessions AS session'));
  const pending=f.call('',{request:wire});assert.equal((await entered).user_id,'orphan-a');
  f.db.prepare("UPDATE team_sessions SET user_id='manager-a' WHERE token_hash=?").run(hash(f.operator));
  controller.enqueue(new TextEncoder().encode(JSON.stringify({phone:STAFF_PHONE,role:'intern'})));controller.close();
  const result=await pending;assert.equal(result.status,404,result.raw);assert.equal(f.count('team_operator_employee_invitations'),0);assert.equal(f.count('team_employee_invitations'),0);
});
