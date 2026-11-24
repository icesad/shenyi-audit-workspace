'use strict';
// Real SQLite/KDF/loopback HTTP; explicitly synthetic SMS, no real delivery.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const load=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const ORIGIN='http://127.0.0.1:8774',PASSWORD='ShenyiDemo!2026',NEW_PASSWORD='SyntheticStaff!2026',PHONE='+8613800000011',PHONE2='+8613800000012';
const hash=value=>createHash('sha256').update(value).digest('hex');
let baseline;
async function fixture(t){
  baseline||=(async()=>{const {initializeTeamDatabase,seedDemoTeamData}=await load('database.mjs');const db=new DatabaseSync(':memory:');try{initializeTeamDatabase(db);await seedDemoTeamData(db);return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name+'"').all()}));}finally{db.close();}})();
  const db=new DatabaseSync(':memory:');(await load('database.mjs')).initializeTeamDatabase(db);
  db.exec('BEGIN;PRAGMA defer_foreign_keys=ON');for(const {name,rows} of await baseline)for(const row of rows){const keys=Object.keys(row);db.prepare('INSERT OR REPLACE INTO "'+name+'"('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row));}db.exec('COMMIT');t.after(()=>db.close());
  const f={db,now:Date.parse('2026-11-15T08:00:00Z'),sent:[]};f.providers={phonePepper:randomBytes(32),sms:{send:async value=>{f.sent.push({...value});}}};
  const session=userId=>{const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO team_sessions VALUES (?,?,?,NULL)').run(hash(token),userId,f.now+48*60*60000);return token;};f.manager=session('manager-a');f.partner=session('partner-a');f.intern=session('intern-a');f.foreign=session('manager-b');return f;
}
async function call(f,route,{method='POST',body,token,providers=f.providers,headers={}}={}){
  const response=await (await load('application-api.mjs')).handleTeamApplicationRequest(new Request(ORIGIN+route,{method,headers:{'Content-Type':'application/json',...headers,...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{db:f.db,now:()=>f.now,identityProviders:providers});
  const raw=await response.text();assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('access-control-allow-origin'),null);return {status:response.status,data:JSON.parse(raw),raw};
}
const admin='/api/teams/team-a/employee-invitations';
async function invite(f,{phone=PHONE,role='intern',token=f.manager}={}){const r=await call(f,admin,{token,body:{phone,role}});assert.equal(r.status,201,r.raw);return r.data;}
async function challenge(f,invitation,phone=PHONE){const r=await call(f,'/api/auth/onboarding/challenges',{body:{invitationCode:invitation.invitationCode,phone}});assert.equal(r.status,202,r.raw);const delivered=f.sent.find(x=>x.challengeId===r.data.challengeId);assert.equal(delivered.purpose,'activate');assert.ok(!r.raw.includes(delivered.code));return {...r.data,code:delivered.code};}
function payload(invitation,c,phone=PHONE,password=NEW_PASSWORD){return {invitationCode:invitation.invitationCode,phone,challengeId:c.challengeId,code:c.code,password,displayName:'合成员工',accept:true};}
const activate=(f,body)=>call(f,'/api/auth/onboarding/activate',{body});
const count=(f,table)=>f.db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;

test('onboarding capability is honest, supplier-independent, and separate from original auth methods',async t=>{
  const f=await fixture(t);assert.deepEqual((await call(f,'/api/auth/onboarding/capabilities',{method:'GET',providers:{}})).data,{available:false,invitationOnly:true});
  assert.deepEqual((await call(f,'/api/auth/onboarding/capabilities',{method:'GET'})).data,{available:true,invitationOnly:true});
  assert.deepEqual(Object.keys((await call(f,'/api/auth/methods',{method:'GET'})).data).sort(),['methods','mode']);
  const i=await invite(f);assert.equal((await call(f,'/api/auth/onboarding/challenges',{providers:{},body:{invitationCode:i.invitationCode,phone:PHONE}})).status,503);assert.equal(f.sent.length,0);
});
test('access is separate member.invite permission, never inferred from role or another team',async t=>{
  const f=await fixture(t);assert.deepEqual((await call(f,admin+'/access',{method:'GET',token:f.manager})).data,{canInvite:true,creationLookup:true});
  assert.deepEqual((await call(f,admin+'/access',{method:'GET',token:f.intern})).data,{canInvite:false});
  assert.equal((await call(f,admin+'/access',{method:'GET',token:f.foreign})).status,404);
  f.db.prepare("UPDATE team_admin_grants SET status='revoked' WHERE user_id='partner-a'").run();assert.deepEqual((await call(f,admin+'/access',{method:'GET',token:f.partner})).data,{canInvite:false});
  assert.equal((await call(f,admin,{token:f.intern,body:{phone:PHONE,role:'intern'}})).status,404);
});
test('manager may issue only intern/assistant invitations and list never returns full phone or raw token',async t=>{
  const f=await fixture(t);const i=await invite(f,{role:'assistant'});assert.deepEqual(Object.keys(i).sort(),['expiresAt','invitationCode','invitationId','phoneMasked','role','teamId']);assert.match(i.invitationCode,/^[A-Za-z0-9_-]{43}$/);
  const row=f.db.prepare('SELECT * FROM team_employee_invitations').get();assert.equal(row.token_hash,hash(i.invitationCode));assert.ok(!JSON.stringify(row).includes(i.invitationCode));
  const listed=await call(f,admin,{method:'GET',token:f.manager});assert.equal(listed.data.invitations.length,1);assert.equal(listed.data.invitations[0].status,'pending');assert.ok(!listed.raw.includes(PHONE));assert.ok(!listed.raw.includes(i.invitationCode));assert.ok(!listed.raw.includes('token_hash'));
  for(const role of ['manager','partner','owner',''])assert.equal((await call(f,admin,{token:f.manager,body:{phone:PHONE2,role}})).status,400);assert.equal(count(f,'team_employee_invitations'),1);
});
test('creation receipts look up only the authorized issuer and team and repeated requests never duplicate rows',async t=>{
  const f=await fixture(t),requestId=randomUUID(),lookup=admin+'?requestId='+requestId;
  const body={phone:PHONE,role:'intern',requestId};
  const missing={invitations:[],nextCursor:null,requestId};
  assert.deepEqual((await call(f,lookup,{method:'GET',token:f.manager})).data,missing);
  const submissions=await Promise.all([
    call(f,admin,{token:f.manager,body}),call(f,admin,{token:f.manager,body}),
  ]);
  assert.deepEqual(submissions.map(reply=>reply.status).sort(),[201,409]);
  const created=submissions.find(reply=>reply.status===201).data;
  const duplicate=submissions.find(reply=>reply.status===409);
  const invitationId='ei-'+hash(JSON.stringify(['employee-invitation-v1','team-a','manager-a',requestId])).slice(0,32);
  assert.equal(duplicate.data.error.code,'INVITATION_CREATION_ALREADY_RECORDED');
  assert.equal(duplicate.raw.includes(created.invitationCode),false);
  assert.equal(duplicate.raw.includes(invitationId),false);
  assert.equal(created.requestId,requestId);
  assert.equal(created.invitationId,invitationId);
  assert.equal(count(f,'team_employee_invitations'),1);

  const receipt={invitationId,teamId:'team-a',role:'intern',phoneMasked:created.phoneMasked,expiresAt:created.expiresAt,status:'pending'};
  const recovered=await call(f,lookup,{method:'GET',token:f.manager});
  assert.deepEqual(recovered.data,{invitations:[receipt],nextCursor:null,requestId});
  assert.equal(recovered.raw.includes(created.invitationCode),false);
  assert.equal(recovered.raw.includes(PHONE),false);
  assert.deepEqual((await call(f,lookup,{method:'GET',token:f.partner})).data,missing);
  assert.equal((await call(f,lookup,{method:'GET',token:f.intern})).status,404);
  assert.equal((await call(f,lookup,{method:'GET',token:f.foreign})).status,404);
  const otherTeam=admin.replace('team-a','team-b');
  assert.deepEqual((await call(f,otherTeam+'?requestId='+requestId,{method:'GET',token:f.foreign})).data,missing);
  const otherIssuer=await call(f,admin,{token:f.partner,body});
  const otherTeamCreated=await call(f,otherTeam,{token:f.foreign,body});
  assert.equal(otherIssuer.status,201);
  assert.equal(otherTeamCreated.status,201);
  assert.equal(new Set([invitationId,otherIssuer.data.invitationId,otherTeamCreated.data.invitationId]).size,3);
  assert.deepEqual((await call(f,lookup,{method:'GET',token:f.manager})).data.invitations,[receipt]);

  for(const malformed of [null,{},'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA','00000000-0000-5000-8000-000000000000',
    '00000000-0000-4000-7000-000000000000',requestId+'\n']){
    assert.equal((await call(f,admin,{token:f.manager,body:{...body,requestId:malformed}})).status,400);
    assert.equal((await call(f,admin+'?requestId='+encodeURIComponent(malformed),{method:'GET',token:f.manager})).status,400);
  }
  for(const mixedQuery of ['&limit=1','&after=anything','&requestId='+requestId]){
    assert.equal((await call(f,lookup+mixedQuery,{method:'GET',token:f.manager})).status,400);
  }
  assert.equal(count(f,'team_employee_invitations'),3);
});

test('creation lookup and duplicate protection survive an invitation authority source change',async t=>{
  const f=await fixture(t),requestId=randomUUID(),body={phone:PHONE,role:'assistant',requestId};
  const first=await call(f,admin,{token:f.manager,body});
  assert.equal(first.status,201);
  const lookup=admin+'?requestId='+requestId;
  f.db.prepare("INSERT INTO team_operators VALUES ('team-a','manager-a','administrator','active')").run();
  f.db.prepare("UPDATE team_admin_grants SET status='revoked' WHERE user_id='manager-a'").run();
  assert.equal((await call(f,lookup,{method:'GET',token:f.manager})).status,404);
  f.db.prepare(`INSERT INTO team_administrator_business_roles(team_id,user_id,role,status,member_role,reviewed_by,reviewed_at)
    VALUES ('team-a','manager-a','manager','active','manager','invitee-a',?)`).run(f.now);
  const inherited=await call(f,lookup,{method:'GET',token:f.manager});
  assert.equal(inherited.status,200);
  assert.equal(inherited.data.invitations[0].invitationId,first.data.invitationId);
  const duplicate=await call(f,admin,{token:f.manager,body});
  assert.equal(duplicate.status,409);
  assert.equal(duplicate.data.error.code,'INVITATION_CREATION_ALREADY_RECORDED');
  assert.equal(count(f,'team_employee_invitations'),1);
  assert.equal(count(f,'team_operator_employee_invitations'),0);
  assert.equal((await call(f,admin+'/'+first.data.invitationId+'/revoke',{token:f.manager,body:{}})).status,200);
  assert.equal((await call(f,lookup,{method:'GET',token:f.manager})).data.invitations[0].status,'revoked');
  assert.equal((await call(f,admin,{token:f.manager,body})).data.error.code,'INVITATION_CREATION_ALREADY_RECORDED');

  const nextRequestId=randomUUID(),next=await call(f,admin,{token:f.manager,body:{...body,requestId:nextRequestId}});
  assert.equal(next.status,201);
  assert.equal(count(f,'team_operator_employee_invitations'),1);
  f.now=next.data.expiresAt;
  const expired=await call(f,admin+'?requestId='+nextRequestId,{method:'GET',token:f.manager});
  assert.equal(expired.data.invitations[0].invitationId,next.data.invitationId);
  assert.equal(expired.data.invitations[0].status,'expired');
});
test('new staff explicitly verifies and sets own password, creates one scoped membership and no session or grants',async t=>{
  const f=await fixture(t),i=await invite(f),c=await challenge(f,i),before=count(f,'team_sessions');
  const preview=await call(f,'/api/auth/onboarding/preview',{body:{invitationCode:i.invitationCode,phone:'13800000011'}});assert.deepEqual(preview.data,{teamId:'team-a',role:'intern',phoneMasked:i.phoneMasked,expiresAt:i.expiresAt});assert.ok(!preview.raw.includes('registered'));
  const result=await activate(f,payload(i,c));assert.equal(result.status,200,result.raw);assert.deepEqual(result.data,{activated:true});assert.equal(count(f,'team_sessions'),before);
  const owner=f.db.prepare('SELECT * FROM team_phone_credentials WHERE phone=?').get(PHONE);assert.ok(owner.user_id);assert.equal(owner.verified_at,f.now);assert.equal(count(f,'team_users'),10);
  const credential=f.db.prepare('SELECT * FROM team_credentials WHERE user_id=?').get(owner.user_id);assert.match(credential.username,/^employee-[a-z0-9-]+$/);assert.notEqual(credential.password_hash,NEW_PASSWORD);
  const login=await call(f,'/api/auth/phone/login',{body:{phone:PHONE,password:NEW_PASSWORD}});assert.equal(login.status,200,login.raw);assert.equal(login.data.account.id,owner.user_id);assert.deepEqual(login.data.memberships,[{teamId:'team-a',role:'intern'}]);
  assert.deepEqual((await call(f,'/api/teams/team-a/collection/tasks',{method:'GET',token:login.data.token})).data.tasks,[]);assert.equal((await call(f,'/api/teams/team-b/collection/tasks',{method:'GET',token:login.data.token})).status,404);
  for(const table of ['team_task_assignments','team_project_grants','team_attachment_grants','team_admin_grants'])assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE user_id=?').get(owner.user_id).n,0);
});
test('existing verified account without membership reuses identity, password and display name',async t=>{
  const f=await fixture(t);f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('invitee-a',PHONE,f.now-1);
  const original=f.db.prepare("SELECT * FROM team_credentials WHERE user_id='invitee-a'").get(),i=await invite(f,{role:'assistant'}),c=await challenge(f,i);
  const result=await activate(f,payload(i,c,PHONE,PASSWORD));assert.equal(result.status,200,result.raw);assert.equal(count(f,'team_users'),9);assert.deepEqual(f.db.prepare("SELECT * FROM team_credentials WHERE user_id='invitee-a'").get(),original);
  assert.deepEqual({...f.db.prepare("SELECT * FROM team_memberships WHERE user_id='invitee-a'").get()},{team_id:'team-a',user_id:'invitee-a',role:'assistant',status:'active'});
});
test('SMS alone never replaces an existing account password',async t=>{
  const f=await fixture(t);f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('invitee-a',PHONE,f.now-1);const original=f.db.prepare("SELECT * FROM team_credentials WHERE user_id='invitee-a'").get(),i=await invite(f),c=await challenge(f,i);
  assert.equal((await activate(f,payload(i,c,PHONE,NEW_PASSWORD))).status,404);assert.deepEqual(f.db.prepare("SELECT * FROM team_credentials WHERE user_id='invitee-a'").get(),original);assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM team_memberships WHERE user_id='invitee-a'").get().n,0);
  assert.equal((await activate(f,payload(i,c,PHONE,PASSWORD))).status,200);
});
for(const user of ['intern-a','intern-b'])for(const state of ['active','disabled'])test('existing '+user+' with '+state+' membership cannot be re-enabled, promoted or moved',async t=>{
  const f=await fixture(t);f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run(user,PHONE,f.now-1);f.db.prepare('UPDATE team_memberships SET status=? WHERE user_id=?').run(state,user);const original=f.db.prepare('SELECT * FROM team_memberships WHERE user_id=?').all(user),i=await invite(f,{role:'assistant'}),c=await challenge(f,i);
  assert.equal((await activate(f,payload(i,c,PHONE,PASSWORD))).status,409);assert.deepEqual(f.db.prepare('SELECT * FROM team_memberships WHERE user_id=?').all(user),original);assert.equal(count(f,'team_users'),9);
});
test('unknown, mismatched, revoked and expired invitations share the same public denial',async t=>{
  const f=await fixture(t),i=await invite(f);const query=body=>call(f,'/api/auth/onboarding/preview',{body});
  const unknown=await query({invitationCode:randomBytes(32).toString('base64url'),phone:PHONE});assert.equal(unknown.status,404);
  assert.equal((await query({invitationCode:i.invitationCode,phone:PHONE2})).raw,unknown.raw);
  await call(f,admin+'/'+i.invitationId+'/revoke',{token:f.partner,body:{}});assert.equal((await query({invitationCode:i.invitationCode,phone:PHONE})).raw,unknown.raw);
  const j=await invite(f,{phone:PHONE2});f.now=j.expiresAt;assert.equal((await query({invitationCode:j.invitationCode,phone:PHONE2})).raw,unknown.raw);
});
test('revocation cancels outstanding SMS challenges and never restores accepted membership',async t=>{
  const f=await fixture(t),i=await invite(f),c=await challenge(f,i);assert.equal((await call(f,admin+'/'+i.invitationId+'/revoke',{token:f.manager,body:{}})).status,200);assert.equal((await activate(f,payload(i,c))).status,404);assert.equal(count(f,'team_users'),9);assert.equal(f.db.prepare('SELECT delivery_state FROM team_employee_activation_challenges').get().delivery_state,'failed');
  const j=await invite(f,{phone:PHONE2}),d=await challenge(f,j,PHONE2);assert.equal((await activate(f,payload(j,d,PHONE2))).status,200);assert.equal((await call(f,admin+'/'+j.invitationId+'/revoke',{token:f.manager,body:{}})).status,409);assert.equal(count(f,'team_memberships'),9);
});
test('successful activation consumes invitation and all its challenges exactly once',async t=>{
  const f=await fixture(t),i=await invite(f),c=await challenge(f,i),other=await challenge(f,i);assert.equal((await activate(f,payload(i,c))).status,200);assert.equal((await activate(f,payload(i,other))).status,404);assert.equal((await activate(f,payload(i,c))).status,404);assert.equal(count(f,'team_users'),10);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_employee_activation_challenges WHERE consumed_at IS NULL').get().n,0);
});
test('concurrent redemption has one atomic winner and no duplicate account or membership',async t=>{
  const f=await fixture(t),i=await invite(f),c=await challenge(f,i);
  const results=await Promise.all([activate(f,payload(i,c)),activate(f,payload(i,c))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,404]);assert.equal(count(f,'team_users'),10);assert.equal(count(f,'team_memberships'),9);assert.equal(count(f,'team_phone_credentials'),1);
});
test('five bad code attempts remain consumed and block the correct code afterwards',async t=>{
  const f=await fixture(t),i=await invite(f),c=await challenge(f,i),wrong=c.code==='000000'?'000001':'000000';
  for(let n=0;n<5;n++)assert.equal((await activate(f,{...payload(i,c),code:wrong})).status,404);
  assert.equal((await activate(f,payload(i,c))).status,404);assert.equal(f.db.prepare('SELECT attempts FROM team_employee_activation_challenges').get().attempts,5);assert.equal(count(f,'team_users'),9);
});
test('challenge expiry, wrong invite and different pepper do not create identities',async t=>{
  const f=await fixture(t),i=await invite(f),j=await invite(f),c=await challenge(f,i);assert.equal((await activate(f,{...payload(i,c),invitationCode:j.invitationCode})).status,404);
  assert.equal((await call(f,'/api/auth/onboarding/activate',{body:payload(i,c),providers:{...f.providers,phonePepper:randomBytes(32)}})).status,404);f.now=c.expiresAt;assert.equal((await activate(f,payload(i,c))).status,404);assert.equal(count(f,'team_users'),9);
});
test('SMS provider errors including ApiError never leak supplier details or mark delivery sent',async t=>{
  const f=await fixture(t),i=await invite(f);const {ApiError}=await load('http-utils.mjs');f.providers.sms.send=async()=>{throw new ApiError(404,'NOT_FOUND','SYNTHETIC_PROVIDER_SECRET');};
  const result=await call(f,'/api/auth/onboarding/challenges',{body:{invitationCode:i.invitationCode,phone:PHONE}});assert.equal(result.status,503);assert.ok(!result.raw.includes('SYNTHETIC_PROVIDER_SECRET'));assert.equal(f.db.prepare('SELECT delivery_state FROM team_employee_activation_challenges').get().delivery_state,'failed');
});
test('SMS phone rate limit is shared across separate invitations',async t=>{
  const f=await fixture(t);for(let n=0;n<3;n++)await challenge(f,await invite(f));const i=await invite(f);assert.equal((await call(f,'/api/auth/onboarding/challenges',{body:{invitationCode:i.invitationCode,phone:PHONE}})).status,429);assert.equal(f.sent.length,3);
});
test('no explicit acceptance, malformed fields and privileged extra fields cannot activate',async t=>{
  const f=await fixture(t),i=await invite(f),c=await challenge(f,i);
  for(const extra of [{accept:false},{role:'partner'},{teamId:'team-b'},{userId:'manager-a'},{displayName:'\u202Ehidden'},{displayName:''},{password:'short'}])assert.equal((await activate(f,{...payload(i,c),...extra})).status,400);
  assert.equal(count(f,'team_users'),9);assert.equal(count(f,'team_memberships'),8);
});
test('invitation list is team-scoped, bounded and does not expose redemption credentials',async t=>{
  const f=await fixture(t);for(let n=0;n<55;n++)f.db.prepare('INSERT INTO team_employee_invitations(invitation_id,token_hash,team_id,phone,role,invited_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),hash('synthetic-'+n),'team-a',PHONE,'intern','manager-a',f.now+n,f.now+60000);
  const r=await call(f,admin,{method:'GET',token:f.manager});assert.equal(r.data.invitations.length,50);assert.ok(!r.raw.includes(PHONE));assert.ok(!r.raw.includes('token_hash'));assert.equal((await call(f,admin,{method:'GET',token:f.foreign})).status,404);
});
test('initialization is additive/idempotent and refuses arbitrary existing databases',async t=>{
  const f=await fixture(t),i=await invite(f);const {initializeTeamDatabase}=await load('database.mjs');initializeTeamDatabase(f.db);initializeTeamDatabase(f.db);assert.equal(f.db.prepare('SELECT token_hash FROM team_employee_invitations WHERE invitation_id=?').get(i.invitationId).token_hash,hash(i.invitationCode));
  const other=new DatabaseSync(':memory:');try{other.exec('CREATE TABLE customer_original(bytes BLOB)');assert.throws(()=>initializeTeamDatabase(other),/isolated/);assert.deepEqual(other.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name),['customer_original']);}finally{other.close();}
});
test('loopback HTTP uses the same invitation and origin boundaries without exposing suppliers',async t=>{
  const f=await fixture(t),{startTeamServer}=await load('dev-server.mjs');const service=await startTeamServer({db:f.db,port:0,identityProviders:f.providers,now:()=>f.now});t.after(()=>service.close());
  const caps=await fetch(service.address.url+'/api/auth/onboarding/capabilities');assert.equal(caps.status,200);assert.deepEqual(await caps.json(),{available:true,invitationOnly:true});
  const crossed=await fetch(service.address.url+'/api/auth/onboarding/capabilities',{headers:{Origin:'https://foreign.invalid'}});assert.equal(crossed.status,403);
  const created=await fetch(service.address.url+admin,{method:'POST',headers:{'Content-Type':'application/json',Origin:'shenyi://app',Authorization:'Bearer '+f.manager},body:JSON.stringify({phone:PHONE,role:'intern'})});assert.equal(created.status,201);const invitation=await created.json();
  const preview=await fetch(service.address.url+'/api/auth/onboarding/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitationCode:invitation.invitationCode,phone:PHONE})});assert.equal(preview.status,200);assert.ok(!(await preview.text()).includes(PHONE));assert.equal(preview.headers.get('access-control-allow-origin'),null);
});

test('invalid anonymous onboarding requests cannot exhaust another source or the shared valid-invitation budget',async t=>{
  const f=await fixture(t),invitation=await invite(f),invalidCode=randomBytes(32).toString('base64url');
  const sources=['203.0.113.10','203.0.113.11'];
  for(const action of ['preview','challenges']){
    for(let i=0;i<60;i++){
      const r=await call(f,'/api/auth/onboarding/'+action,{body:{invitationCode:invalidCode,phone:PHONE},headers:{'X-Shenyi-Client-IP':sources[0]}});
      assert.equal(r.status,404,action+': '+r.raw);
    }
    const limited=await call(f,'/api/auth/onboarding/'+action,{body:{invitationCode:invalidCode,phone:PHONE},headers:{'X-Shenyi-Client-IP':sources[0]}});
    assert.equal(limited.status,429,action+': '+limited.raw);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_auth_limits WHERE bucket=?').get('onboarding:'+action+':global').n,0);
    if(action==='preview'){
      const valid=await call(f,'/api/auth/onboarding/preview',{body:{invitationCode:invitation.invitationCode,phone:PHONE},headers:{'X-Shenyi-Client-IP':sources[1]}});
      assert.equal(valid.status,200,valid.raw);
    }else{
      const valid=await call(f,'/api/auth/onboarding/challenges',{body:{invitationCode:invitation.invitationCode,phone:PHONE},headers:{'X-Shenyi-Client-IP':sources[1]}});
      assert.equal(valid.status,202,valid.raw);
      assert.equal(f.db.prepare('SELECT attempts FROM team_auth_limits WHERE bucket=?').get('onboarding:challenges:global').attempts,1);
    }
  }
  const delivered=f.sent.at(-1),activationBody={invitationCode:invitation.invitationCode,phone:PHONE,challengeId:delivered.challengeId,code:delivered.code,password:NEW_PASSWORD,displayName:'合成员工',accept:true};
  for(let i=0;i<60;i++){
    const r=await call(f,'/api/auth/onboarding/activate',{body:{...activationBody,invitationCode:invalidCode},headers:{'X-Shenyi-Client-IP':sources[0]}});
    assert.equal(r.status,404);
  }
  const limited=await call(f,'/api/auth/onboarding/'+'activate',{body:{...activationBody,invitationCode:invalidCode},headers:{'X-Shenyi-Client-IP':sources[0]}});
  assert.equal(limited.status,429,limited.raw);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_auth_limits WHERE bucket=?').get('onboarding:activate:global').n,0);
  const valid=await call(f,'/api/auth/onboarding/activate',{body:activationBody,headers:{'X-Shenyi-Client-IP':sources[1]}});
  assert.equal(valid.status,200,valid.raw);
});

test('employee onboarding accepts valid tickets from new sources when anonymous source storage is full',async t=>{
  const {fullSourcePool}=require('./helpers/onboarding-rate-limit-capacity.cjs');
  for(const action of ['preview','challenges','activate']){
    await t.test(action,async t=>{
      const f=await fixture(t);
      const invitation=await invite(f);
      const proof=action==='activate'?await challenge(f,invitation):null;
      const body=proof?payload(invitation,proof):{invitationCode:invitation.invitationCode,phone:PHONE};
      const prefix='onboarding:'+action+':ip:',global='onboarding:'+action+':global';
      const pool=fullSourcePool(f.db,prefix,f.now);
      const route='/api/auth/onboarding/'+action;
      const request=(address,value)=>call(f,route,{body:value,headers:{'X-Shenyi-Client-IP':address}});
      const businessBudget=()=>JSON.stringify(f.db.prepare(
        'SELECT bucket,window_start,attempts FROM team_auth_limits WHERE substr(bucket,1,length(?))<>? AND bucket<>? ORDER BY bucket'
      ).all(prefix,prefix,'onboarding:'+action+':overflow'));
      const beforeBudget=businessBudget(),beforeMessages=f.sent.length;
      const invalid=await request(pool.invalidAddress,{...body,invitationCode:randomBytes(32).toString('base64url')});
      assert.ok([404,429].includes(invalid.status),invalid.raw);
      assert.equal(businessBudget(),beforeBudget,'invalid tickets must not spend shared business or SMS budgets');
      assert.equal(f.sent.length,beforeMessages,'invalid tickets must not send SMS');
      pool.assertUnchanged();

      // A source that has already spent its 60 attempts must not acquire a
      // fresh allowance by presenting a valid ticket at the capacity boundary.
      const limited=await request(pool.blockedAddress,body);
      assert.equal(limited.status,429,limited.raw);
      assert.equal(businessBudget(),beforeBudget);
      pool.assertUnchanged();

      const valid=await request(pool.validAddress,body);
      assert.equal(valid.status,action==='challenges'?202:200,valid.raw);
      assert.equal(f.db.prepare('SELECT attempts FROM team_auth_limits WHERE bucket=?').get(global).attempts,1);
      assert.equal(f.sent.length,beforeMessages+(action==='challenges'?1:0));
      pool.assertUnchanged();
    });
  }
});


test('employee onboarding bounds invalid ticket validation when a source pool is full',async t=>{
  const {fullSourcePool}=require('./helpers/onboarding-rate-limit-capacity.cjs');
  const f=await fixture(t),prefix='onboarding:preview:ip:';
  const pool=fullSourcePool(f.db,prefix,f.now),invalidCode=randomBytes(32).toString('base64url');
  for(let i=0;i<300;i++){
    const address='198.51.'+Math.floor(i/250)+'.'+(i%250+1);
    const response=await call(f,'/api/auth/onboarding/preview',{
      body:{invitationCode:invalidCode,phone:PHONE},
      headers:{'X-Shenyi-Client-IP':address},
    });
    assert.equal(response.status,404,response.raw);
  }
  const blocked=await call(f,'/api/auth/onboarding/preview',{
    body:{invitationCode:invalidCode,phone:PHONE},
    headers:{'X-Shenyi-Client-IP':'198.51.2.1'},
  });
  assert.equal(blocked.status,429,blocked.raw);
  assert.equal(f.db.prepare("SELECT attempts FROM team_auth_limits WHERE bucket='onboarding:preview:overflow'").get().attempts,300);
  assert.equal(f.db.prepare("SELECT 1 FROM team_auth_limits WHERE bucket='onboarding:preview:global'").get(),undefined);
  assert.equal(f.sent.length,0);
  pool.assertUnchanged();
});