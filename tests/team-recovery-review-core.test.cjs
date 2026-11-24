'use strict';
// Real in-memory SQL/KDF, synthetic SMS, no external provider or client data.
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{randomBytes}=require('node:crypto'),path=require('node:path'),{pathToFileURL}=require('node:url');
const load=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href),PASSWORD='ShenyiDemo!2026',NEXT='RecoveredNew!2026',NOW=Date.parse('2026-11-15T08:00:00Z');
const PHONES={'intern-a':'+8613800000001','operator-a':'+8613800000002','intern-b':'+8613800000003','operator-b':'+8613800000004'};let baseline;
async function fixture(t){
 baseline||=(async()=>{const {initializeTeamDatabase,seedDemoTeamData}=await load('database.mjs'),db=new DatabaseSync(':memory:');initializeTeamDatabase(db);await seedDemoTeamData(db);const hash=db.prepare("SELECT password_hash FROM team_credentials WHERE user_id='intern-a'").get().password_hash;
  for(const id of ['operator-a','operator-b','owner']){db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(id,id,id,hash);}
  for(const id of ['a','b']){db.prepare('INSERT INTO team_profiles VALUES (?,?)').run('team-'+id,'Synthetic '+id);db.prepare("INSERT INTO team_operators VALUES (?,?,'administrator','active')").run('team-'+id,'operator-'+id);}
  db.prepare("INSERT INTO team_recovery_reviewers(user_id,permission,status) VALUES ('owner','account.recover','active')").run();for(const [id,phone]of Object.entries(PHONES))db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run(id,phone,NOW-1000);
  const rows=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name+'"').all()}));db.close();return rows;})();
 const db=new DatabaseSync(':memory:');(await load('database.mjs')).initializeTeamDatabase(db);db.exec('BEGIN;PRAGMA defer_foreign_keys=ON;');for(const table of await baseline)for(const row of table.rows){const keys=Object.keys(row);db.prepare('INSERT OR REPLACE INTO "'+table.name+'"('+keys.map(x=>'"'+x+'"').join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row));}db.exec('COMMIT;');t.after(()=>db.close());const sent=[];return {db,now:NOW,sent,providers:{reviewedRecovery:true,phonePepper:randomBytes(32),sms:{send:async value=>sent.push(value)}}};
}
async function call(f,route,body,token,method=body===undefined?'GET':'POST'){
 const {handleTeamApplicationRequest}=await load('application-api.mjs');const result=await handleTeamApplicationRequest(new Request('http://127.0.0.1:8774'+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{db:f.db,now:()=>f.now,identityProviders:f.providers});return {status:result.status,data:await result.json()};
}
async function login(f,username){const result=await call(f,'/api/auth/login',{username,password:PASSWORD});assert.equal(result.status,200);return result.data.token;}
async function request(f,user='intern-a',phone=PHONES[user]){const c=await call(f,'/api/auth/phone/challenges',{phone,purpose:'reset'});assert.equal(c.status,202);const sms=f.sent.at(-1);const r=await call(f,'/api/auth/recovery-requests',{challengeId:c.data.challengeId,code:sms.code});assert.equal(r.status,201);return {...r.data,challengeId:c.data.challengeId,code:sms.code};}
async function decide(f,r,token,decision='approve',revision=1){return call(f,'/api/account/recovery-reviews/'+r.requestId+'/review',{decision,revision,currentPassword:PASSWORD},token);}
const reset=(f,r,proof)=>call(f,'/api/auth/phone/reset',{challengeId:r.challengeId,code:r.code,newPassword:NEXT,recoveryProof:proof});
test('reviewed capability is explicit, SMS availability truthful, external adapter cannot override reviewed path',async t=>{
 const f=await fixture(t);assert.deepEqual((await call(f,'/api/auth/recovery-requests/capabilities')).data,{reviewed:true,available:true});delete f.providers.sms;assert.deepEqual((await call(f,'/api/auth/recovery-requests/capabilities')).data,{reviewed:true,available:false});assert.equal((await call(f,'/api/auth/methods')).data.methods.recovery,false);f.providers.reviewedRecovery=false;assert.deepEqual((await call(f,'/api/auth/recovery-requests/capabilities')).data,{reviewed:false,available:false});
});
test('only independent owner or technical operators review; audit managers do not inherit recovery',async t=>{
 const f=await fixture(t);for(const [id,allowed]of [['intern-a',false],['manager-a',false],['partner-a',false],['operator-a',true],['owner',true]])assert.equal((await call(f,'/api/account/recovery-reviews/access',undefined,await login(f,id))).data.canReview,allowed);
});
test('SMS is required and receipts do not expose target identity or account existence',async t=>{
 const f=await fixture(t),known=await request(f),unknown=await request(f,'unknown','+8613800000099');for(const r of [known,unknown]){assert.equal(r.status,'pending');assert.equal(r.revision,1);assert.equal(r.expiresAt,NOW+300000);}const op=await login(f,'operator-a'),rows=(await call(f,'/api/account/recovery-reviews',undefined,op)).data.requests;assert.equal(rows.length,1);assert.equal(rows[0].id,known.requestId);assert.equal(f.db.prepare('SELECT target_user_id FROM team_recovery_requests WHERE request_id=?').get(unknown.requestId).target_user_id,null);
});
test('repeat submission returns the same nonenumerating receipt and spends the shared budget only once',async t=>{
 const f=await fixture(t),r=await request(f);const repeat=await call(f,'/api/auth/recovery-requests',{challengeId:r.challengeId,code:r.code});assert.deepEqual(repeat.data,{requestId:r.requestId,status:'pending',revision:1,expiresAt:r.expiresAt});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_recovery_requests').get().n,1);assert.equal(f.db.prepare("SELECT attempts FROM team_auth_limits WHERE bucket='recovery-request:global'").get().attempts,1);
});
test('own technical administrator approves employee; owner sees only administrator requests',async t=>{
 const f=await fixture(t),employee=await request(f),admin=await request(f,'operator-a'),op=await login(f,'operator-a'),owner=await login(f,'owner'),foreign=await login(f,'operator-b');
 assert.deepEqual((await call(f,'/api/account/recovery-reviews',undefined,op)).data.requests.map(x=>x.id),[employee.requestId]);assert.deepEqual((await call(f,'/api/account/recovery-reviews',undefined,owner)).data.requests.map(x=>x.id),[admin.requestId]);assert.deepEqual((await call(f,'/api/account/recovery-reviews',undefined,foreign)).data.requests,[]);assert.equal((await decide(f,admin,op)).status,404);assert.equal((await decide(f,employee,owner)).status,404);
 const a=await decide(f,employee,op);assert.equal(a.status,200);assert.equal(a.data.recoveryProof.length,43);assert.equal(a.data.request.status,'approved');const b=await decide(f,admin,owner);assert.equal(b.status,200);assert.equal(b.data.request.targetKind,'administrator');
});
test('approval response strips target IDs, phone and hashes; code appears only on approval',async t=>{
 const f=await fixture(t),r=await request(f),op=await login(f,'operator-a'),approved=await decide(f,r,op);assert.deepEqual(Object.keys(approved.data.request).sort(),['id','teamId','teamName','displayName','phoneMasked','targetKind','status','revision','createdAt','expiresAt'].sort());const rows=(await call(f,'/api/account/recovery-reviews',undefined,op)).data.requests;assert.equal(rows[0].recoveryProof,undefined);assert.ok(!JSON.stringify(rows).includes(PHONES['intern-a']));assert.equal(f.db.prepare('SELECT token_hash FROM team_recovery_requests WHERE request_id=?').get(r.requestId).token_hash.length,64);
});
test('wrong reviewer password remains retryable and preserves pending request',async t=>{
 const f=await fixture(t),r=await request(f),op=await login(f,'operator-a');const bad=await call(f,'/api/account/recovery-reviews/'+r.requestId+'/review',{decision:'approve',revision:1,currentPassword:'wrong'},op);assert.equal(bad.status,403);assert.equal((await call(f,'/api/auth/session',undefined,op)).status,200);assert.equal(f.db.prepare('SELECT status FROM team_recovery_requests WHERE request_id=?').get(r.requestId).status,'pending');assert.equal((await decide(f,r,op)).status,200);
});
test('approved recovery updates only target password and revokes own sessions without role changes',async t=>{
 const f=await fixture(t),a=await login(f,'intern-a'),peer=await login(f,'intern-a'),foreign=await login(f,'intern-b'),op=await login(f,'operator-a'),before=JSON.stringify(f.db.prepare('SELECT * FROM team_memberships').all()),r=await request(f),approved=await decide(f,r,op);const done=await reset(f,r,approved.data.recoveryProof);assert.equal(done.status,200);assert.deepEqual(done.data,{signedOut:true});for(const token of [a,peer])assert.equal((await call(f,'/api/auth/session',undefined,token)).status,401);assert.equal((await call(f,'/api/auth/session',undefined,foreign)).status,200);assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM team_memberships').all()),before);assert.equal(f.db.prepare('SELECT status FROM team_recovery_requests WHERE request_id=?').get(r.requestId).status,'consumed');assert.equal((await reset(f,r,approved.data.recoveryProof)).status,400);
});
test('rejected or revoked requests cannot reset even with an external always-true adapter',async t=>{
 for(const decision of ['reject','revoke']){const f=await fixture(t),r=await request(f),op=await login(f,'operator-a');let proof='external-proof';if(decision==='revoke'){const a=await decide(f,r,op);proof=a.data.recoveryProof;assert.equal((await decide(f,r,op,'revoke',2)).status,200);}else assert.equal((await decide(f,r,op,'reject')).status,200);f.providers.recovery={authorize:async()=>true};assert.equal((await reset(f,r,proof)).status,400);}
});
test('authority revocation then identical restoration never revives a previously approved proof',async t=>{
 const f=await fixture(t),r=await request(f),op=await login(f,'operator-a'),a=await decide(f,r,op);f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='operator-a'").run();f.db.prepare("UPDATE team_operators SET status='active' WHERE user_id='operator-a'").run();assert.equal((await reset(f,r,a.data.recoveryProof)).status,400);
});
test('target membership disable then restore invalidates existing approval permanently',async t=>{
 const f=await fixture(t),r=await request(f),op=await login(f,'operator-a'),a=await decide(f,r,op);f.db.prepare("UPDATE team_memberships SET status='disabled' WHERE user_id='intern-a'").run();f.db.prepare("UPDATE team_memberships SET status='active' WHERE user_id='intern-a'").run();assert.equal((await reset(f,r,a.data.recoveryProof)).status,400);
});
test('normal approver logout leaves the approved proof usable until its security state changes',async t=>{
 const f=await fixture(t),r=await request(f),op=await login(f,'operator-a'),a=await decide(f,r,op);assert.equal((await call(f,'/api/auth/logout',{},op)).status,200);assert.equal((await reset(f,r,a.data.recoveryProof)).status,200);
});
test('expired requests show truthful state and cannot approve or consume',async t=>{
 const f=await fixture(t),r=await request(f),op=await login(f,'operator-a');f.now=r.expiresAt;const rows=(await call(f,'/api/account/recovery-reviews',undefined,op)).data.requests;assert.equal(rows[0].status,'expired');assert.equal((await decide(f,r,op)).status,409);
});
test('junior mistaken operator grant and privileged target cannot acquire recovery approval authority',async t=>{
 const f=await fixture(t);f.db.prepare("INSERT INTO team_operators VALUES ('team-a','assistant-a','administrator','active')").run();assert.equal((await call(f,'/api/account/recovery-reviews/access',undefined,await login(f,'assistant-a'))).data.canReview,false);f.db.prepare("INSERT INTO team_platform_reviewers(user_id,permission,status) VALUES ('intern-a','team.provision','active')").run();const r=await request(f);assert.equal(f.db.prepare('SELECT target_user_id FROM team_recovery_requests WHERE request_id=?').get(r.requestId).target_user_id,null);
});
test('late SQL failure rolls approval consumption, password and session changes back together',async t=>{
 const f=await fixture(t),token=await login(f,'intern-a'),op=await login(f,'operator-a'),r=await request(f),a=await decide(f,r,op),before=f.db.prepare("SELECT password_hash FROM team_credentials WHERE user_id='intern-a'").get().password_hash;f.db.exec("CREATE TRIGGER reject_reset BEFORE UPDATE OF password_hash ON team_credentials WHEN NEW.user_id='intern-a' BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END;");assert.equal((await reset(f,r,a.data.recoveryProof)).status,503);assert.equal(f.db.prepare('SELECT status FROM team_recovery_requests WHERE request_id=?').get(r.requestId).status,'approved');assert.equal(f.db.prepare("SELECT password_hash FROM team_credentials WHERE user_id='intern-a'").get().password_hash,before);assert.equal((await call(f,'/api/auth/session',undefined,token)).status,200);f.db.exec('DROP TRIGGER reject_reset');assert.equal((await reset(f,r,a.data.recoveryProof)).status,200);
});
