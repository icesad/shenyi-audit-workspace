'use strict';
// Independent acceptance of owner/operator recovery review. Real SQLite and
// scrypt, explicitly synthetic SMS; no external provider or real account.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{randomBytes,randomUUID,createHash}=require('node:crypto');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-15T09:00:00Z'),PASSWORD='ReviewOldDemo!2026',NEW='ReviewNewDemo!2026';
const PHONES={'employee-a':'+8613800000001','employee-b':'+8613800000002','admin-a':'+8613800000003','admin-b':'+8613800000004',owner:'+8613800000005',orphan:'+8613800000006',provision:'+8613800000007'};
let encoded;
async function fixture(t){
  const {initializeTeamDatabase}=await source('database.mjs'),{hashPassword}=await source('passwords.mjs'),{issueSession}=await source('auth-api.mjs');encoded||=hashPassword(PASSWORD);
  const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);t.after(()=>db.close());
  for(const id of Object.keys(PHONES)){db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(id,id,'Synthetic '+id,await encoded);db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run(id,PHONES[id],NOW-1000);}
  for(const team of ['a','b']){db.prepare("INSERT INTO teams VALUES (?,'active')").run('team-'+team);db.prepare('INSERT INTO team_profiles VALUES (?,?)').run('team-'+team,'Synthetic team '+team);db.prepare("INSERT INTO team_memberships VALUES (?,?,'intern','active')").run('team-'+team,'employee-'+team);db.prepare("INSERT INTO team_operators VALUES (?,?,'administrator','active')").run('team-'+team,'admin-'+team);}
  db.prepare("INSERT INTO team_platform_reviewers(user_id,permission,status) VALUES ('provision','team.provision','active')").run();
  db.prepare("INSERT INTO team_recovery_reviewers(user_id,permission,status) VALUES ('owner','account.recover','active')").run();
  const tokens={};for(const id of Object.keys(PHONES))tokens[id]=issueSession(db,id,NOW).token;
  const sent=[],f={db,tokens,sent,now:NOW};f.providers={reviewedRecovery:true,phonePepper:randomBytes(32),sms:{send:async value=>sent.push({...value})}};return f;
}
async function rawCall(f,request,providers=f.providers){const response=await(await source('application-api.mjs')).handleTeamApplicationRequest(request,{db:f.db,now:()=>f.now,identityProviders:providers}),raw=await response.text();return {status:response.status,data:JSON.parse(raw),raw};}
function request(route,body,token){return new Request('http://127.0.0.1:8774'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const call=(f,route,body,token,providers)=>rawCall(f,request(route,body,token),providers);
const list=(f,actor)=>call(f,'/api/account/recovery-reviews',undefined,f.tokens[actor]);
async function sms(f,id='employee-a',phone=PHONES[id]){const r=await call(f,'/api/auth/phone/challenges',{phone,purpose:'reset'});assert.equal(r.status,202,r.raw);return {...r.data,code:f.sent.find(x=>x.challengeId===r.data.challengeId).code};}
async function submit(f,c){const r=await call(f,'/api/auth/recovery-requests',{challengeId:c.challengeId,code:c.code});assert.equal(r.status,201,r.raw);assert.deepEqual(Object.keys(r.data).sort(),['expiresAt','requestId','revision','status']);return r.data;}
async function pending(f,id='employee-a'){const c=await sms(f,id),receipt=await submit(f,c);return {c,receipt};}
const decision=(f,id,revision,actor='admin-a',action='approve',password=PASSWORD)=>call(f,'/api/account/recovery-reviews/'+id+'/review',{decision:action,revision,currentPassword:password},f.tokens[actor]);
async function approved(f,id='employee-a',actor='admin-a'){const p=await pending(f,id),r=await decision(f,p.receipt.requestId,p.receipt.revision,actor);assert.equal(r.status,200,r.raw);assert.match(r.data.recoveryProof,/^[A-Za-z0-9_-]{43}$/);return {...p,approval:r.data};}
const reset=(f,p,patch={})=>call(f,'/api/auth/phone/reset',{challengeId:p.c.challengeId,code:p.c.code,newPassword:NEW,recoveryProof:p.approval.recoveryProof,...patch});
const credential=(f,id='employee-a')=>({...f.db.prepare('SELECT * FROM team_credentials WHERE user_id=?').get(id)});
const activeSessions=(f,id)=>f.db.prepare('SELECT COUNT(*) n FROM team_sessions WHERE user_id=? AND revoked_at IS NULL').get(id).n;
function mutateBeforeTransaction(t,db,mutate,occurrence=1){const original=db.exec;let seen=0,hit=false;db.exec=function(sql){if(/^BEGIN IMMEDIATE/.test(sql)){seen++;if(!hit&&seen===occurrence){hit=true;mutate();}}return original.call(this,sql);};t.after(()=>db.exec=original);return ()=>hit;}

test('reviewed mode capability requires explicit mode and SMS but does not grant reviewer power',async t=>{const f=await fixture(t);const r=await call(f,'/api/auth/recovery-requests/capabilities');assert.deepEqual(r.data,{reviewed:true,available:true});const disabled=await call(f,'/api/auth/recovery-requests/capabilities',undefined,undefined,{reviewedRecovery:true});assert.deepEqual(disabled.data,{reviewed:true,available:false});for(const actor of ['employee-a','orphan','provision'])assert.deepEqual((await call(f,'/api/account/recovery-reviews/access',undefined,f.tokens[actor])).data,{canReview:false});for(const actor of ['admin-a','owner'])assert.deepEqual((await call(f,'/api/account/recovery-reviews/access',undefined,f.tokens[actor])).data,{canReview:true});});

test('verified known, unknown and unroutable phones receive identical pending-shaped receipts',async t=>{const f=await fixture(t),known=await pending(f),unknownCode=await sms(f,'orphan','+8613900000000'),unknown=await submit(f,unknownCode),orphan=await pending(f,'orphan');for(const value of [known.receipt,unknown,orphan.receipt]){assert.equal(value.status,'pending');assert.equal(value.expiresAt,NOW+300000);assert.equal(value.revision,1);assert.equal(JSON.stringify(value).includes('employee'),false);}assert.equal((await list(f,'admin-a')).data.requests.length,1);assert.deepEqual((await list(f,'owner')).data.requests,[]);});

test('wrong SMS, altered purpose and caller-selected identity cannot create review requests',async t=>{const f=await fixture(t),c=await sms(f),bad=c.code==='000000'?'999999':'000000';assert.equal((await call(f,'/api/auth/recovery-requests',{challengeId:c.challengeId,code:bad})).status,400);assert.equal(f.db.prepare('SELECT attempts FROM team_phone_challenges WHERE challenge_id=?').get(c.challengeId).attempts,1);for(const patch of [{userId:'employee-b'},{teamId:'team-b'},{approved:true},{role:'partner'},{phone:PHONES['employee-b']}])assert.equal((await call(f,'/api/auth/recovery-requests',{challengeId:c.challengeId,code:c.code,...patch})).status,400);assert.deepEqual((await list(f,'admin-a')).data.requests,[]);});

test('pending submission is idempotent for one verified challenge without creating extra review records',async t=>{const f=await fixture(t),p=await pending(f),again=await call(f,'/api/auth/recovery-requests',{challengeId:p.c.challengeId,code:p.c.code});assert.ok([200,201].includes(again.status),again.raw);assert.deepEqual(again.data,p.receipt);assert.equal((await list(f,'admin-a')).data.requests.length,1);});

test('operator lists only own employees; independent owner lists only technical administrators',async t=>{const f=await fixture(t);const ea=await pending(f),eb=await pending(f,'employee-b'),aa=await pending(f,'admin-a'),ab=await pending(f,'admin-b');assert.deepEqual((await list(f,'admin-a')).data.requests.map(x=>x.id),[ea.receipt.requestId]);assert.deepEqual((await list(f,'admin-b')).data.requests.map(x=>x.id),[eb.receipt.requestId]);assert.deepEqual(new Set((await list(f,'owner')).data.requests.map(x=>x.id)),new Set([aa.receipt.requestId,ab.receipt.requestId]));const view=(await list(f,'admin-a')).data.requests[0];assert.deepEqual(Object.keys(view).sort(),['createdAt','displayName','expiresAt','id','phoneMasked','revision','status','targetKind','teamId','teamName']);assert.ok(view.phoneMasked.includes('*'));assert.equal(view.targetKind,'employee');for(const forbidden of ['userId','targetUserId','recoveryProof','password','token','phone'])assert.equal(view[forbidden],undefined);});

test('cross-team, self, provision-only and ordinary business review attempts are denied identically',async t=>{const f=await fixture(t),p=await pending(f),admin=await pending(f,'admin-a');for(const actor of ['admin-b','employee-a','provision','orphan','owner']){const r=await decision(f,p.receipt.requestId,1,actor);assert.equal(r.status,404,r.raw);}assert.equal((await decision(f,admin.receipt.requestId,1,'admin-a')).status,404);const unknown=await decision(f,'00000000-0000-4000-8000-000000000000',1,'admin-b');assert.equal(unknown.status,404);});

test('wrong current reviewer password leaves request pending and existing sessions valid',async t=>{const f=await fixture(t),p=await pending(f),before=credential(f);const r=await decision(f,p.receipt.requestId,1,'admin-a','approve','WrongDemo!2026');assert.equal(r.status,403,r.raw);assert.equal((await list(f,'admin-a')).data.requests[0].status,'pending');assert.deepEqual(credential(f),before);assert.equal((await call(f,'/api/auth/session',undefined,f.tokens['admin-a'])).status,200);});

test('approved proof appears once, is not a session and is bound to exact user and challenge',async t=>{const f=await fixture(t),p=await approved(f),other=await pending(f,'employee-b');const row=(await list(f,'admin-a')).data.requests[0];assert.equal(row.status,'approved');assert.equal(row.recoveryProof,undefined);assert.equal(p.approval.token,undefined);const before=credential(f);assert.equal((await call(f,'/api/auth/phone/reset',{challengeId:other.c.challengeId,code:other.c.code,newPassword:NEW,recoveryProof:p.approval.recoveryProof})).status,400);assert.deepEqual(credential(f),before);assert.equal((await decision(f,p.receipt.requestId,p.approval.request.revision,'admin-a')).status,409);});

test('reviewed recovery ignores an external always-true authorizer and refuses pure SMS',async t=>{const f=await fixture(t),p=await pending(f),before=credential(f);let external=0;f.providers.recovery={authorize:async()=>{external++;return true;}};const r=await call(f,'/api/auth/phone/reset',{challengeId:p.c.challengeId,code:p.c.code,newPassword:NEW,recoveryProof:'not-an-issued-reviewed-proof'});assert.equal(r.status,400,r.raw);assert.equal(external,0);assert.deepEqual(credential(f),before);});

test('owner-reviewed administrator recovery preserves business scope and affects only target sessions',async t=>{const f=await fixture(t),p=await approved(f,'admin-a','owner'),beforeMembers=JSON.stringify(f.db.prepare('SELECT * FROM team_memberships ORDER BY user_id').all()),foreign=f.db.prepare("SELECT * FROM team_sessions WHERE user_id='employee-a'").get();assert.equal((await reset(f,p)).status,200);assert.equal(activeSessions(f,'admin-a'),0);assert.deepEqual(f.db.prepare("SELECT * FROM team_sessions WHERE user_id='employee-a'").get(),foreign);assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM team_memberships ORDER BY user_id').all()),beforeMembers);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_memberships WHERE user_id='admin-a'").get().n,0);});

test('normal reviewer logout does not revoke an already issued target recovery proof',async t=>{const f=await fixture(t),p=await approved(f);assert.equal((await call(f,'/api/auth/logout',{},f.tokens['admin-a'])).status,200);assert.equal((await reset(f,p)).status,200);assert.equal(activeSessions(f,'employee-a'),0);assert.equal(activeSessions(f,'employee-b'),1);});

test('reject and revoke cannot leave a usable proof or reset the target password',async t=>{const f=await fixture(t),p=await pending(f);assert.equal((await decision(f,p.receipt.requestId,1,'admin-a','reject')).status,200);assert.equal((await decision(f,p.receipt.requestId,2)).status,409);const q=await approved(f,'employee-b','admin-b'),revoked=await decision(f,q.receipt.requestId,q.approval.request.revision,'admin-b','revoke');assert.equal(revoked.status,200);assert.equal(revoked.data.recoveryProof,undefined);const before=credential(f,'employee-b');assert.equal((await reset(f,q)).status,400);assert.deepEqual(credential(f,'employee-b'),before);});

for(const [name,mutate] of [
 ['reviewer disabled',f=>f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='admin-a'").run()],
 ['operator revoked',f=>f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='admin-a'").run()],
 ['reviewer password revision changed',f=>f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='admin-a'").run()],
 ['reviewer hash changed without revision',f=>f.db.prepare("UPDATE team_credentials SET password_hash='not-a-valid-password' WHERE user_id='admin-a'").run()],
 ['target disabled',f=>f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='employee-a'").run()],
 ['target role changed',f=>f.db.prepare("UPDATE team_memberships SET role='assistant' WHERE user_id='employee-a'").run()],
 ['target membership disabled',f=>f.db.prepare("UPDATE team_memberships SET status='disabled' WHERE user_id='employee-a'").run()],
 ['target second membership',f=>f.db.prepare("INSERT INTO team_memberships VALUES ('team-b','employee-a','assistant','active')").run()],
 ['target password version changed',f=>f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='employee-a'").run()],
 ['target same phone rebound',f=>f.db.prepare("UPDATE team_phone_credentials SET revision=revision+1 WHERE user_id='employee-a'").run()],
 ['target phone verification changed',f=>f.db.prepare("UPDATE team_phone_credentials SET verified_at=verified_at+1 WHERE user_id='employee-a'").run()],
 ['team disabled',f=>f.db.prepare("UPDATE teams SET status='disabled' WHERE team_id='team-a'").run()],
])test('approved recovery cannot outlive '+name,async t=>{const f=await fixture(t),p=await approved(f);mutate(f);const before=credential(f);const r=await reset(f,p);assert.equal(r.status,400,r.raw);assert.deepEqual(credential(f),before);assert.equal(activeSessions(f,'employee-a'),1);});

for(const [name,mutate] of [
 ['operator revocation',f=>f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='admin-a'").run()],
 ['target reassignment',f=>f.db.prepare("UPDATE team_memberships SET role='assistant' WHERE user_id='employee-a'").run()],
 ['reviewer credential revision',f=>f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='admin-a'").run()],
])test('post-KDF reset transaction freshly rechecks '+name,async t=>{const f=await fixture(t),p=await approved(f),before=credential(f),hit=mutateBeforeTransaction(t,f.db,()=>mutate(f));const r=await reset(f,p);assert.equal(hit(),true);assert.equal(r.status,400,r.raw);assert.deepEqual(credential(f),before);assert.equal(activeSessions(f,'employee-a'),1);assert.equal(f.db.prepare('SELECT consumed_at FROM team_phone_challenges WHERE challenge_id=?').get(p.c.challengeId).consumed_at,null);});

test('authority revocation and same-value regrant cannot revive an old approved proof',async t=>{const f=await fixture(t),p=await approved(f);f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='admin-a'").run();f.db.prepare("UPDATE team_operators SET status='active' WHERE user_id='admin-a'").run();const before=credential(f);assert.equal((await reset(f,p)).status,400);assert.deepEqual(credential(f),before);});

test('independent owner grant changes invalidate administrator recovery even if status is restored',async t=>{const f=await fixture(t),p=await approved(f,'admin-a','owner');f.db.prepare("UPDATE team_recovery_reviewers SET status='revoked' WHERE user_id='owner'").run();f.db.prepare("UPDATE team_recovery_reviewers SET status='active' WHERE user_id='owner'").run();const before=credential(f,'admin-a');assert.equal((await reset(f,p)).status,400);assert.deepEqual(credential(f,'admin-a'),before);});

test('storage failure rolls back approved-proof consumption, password and session revocation together',async t=>{const f=await fixture(t),p=await approved(f),before=credential(f),sessions=JSON.stringify(f.db.prepare('SELECT * FROM team_sessions ORDER BY user_id').all());f.db.exec("CREATE TRIGGER recovery_review_session_failure BEFORE UPDATE OF revoked_at ON team_sessions WHEN NEW.user_id='employee-a' BEGIN SELECT RAISE(ABORT,'synthetic transaction failure'); END");const failed=await reset(f,p);assert.equal(failed.status,503,failed.raw);assert.equal(failed.raw.includes('synthetic transaction'),false);assert.deepEqual(credential(f),before);assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM team_sessions ORDER BY user_id').all()),sessions);assert.equal(f.db.prepare('SELECT consumed_at FROM team_phone_challenges WHERE challenge_id=?').get(p.c.challengeId).consumed_at,null);f.db.exec('DROP TRIGGER recovery_review_session_failure');assert.equal((await reset(f,p)).status,200,'proof remained unconsumed after rollback');});

test('concurrent reviews commit exactly one decision and concurrent reset commits one password change',async t=>{const f=await fixture(t),p=await pending(f);const reviews=await Promise.all([decision(f,p.receipt.requestId,1),decision(f,p.receipt.requestId,1)]);assert.deepEqual(reviews.map(x=>x.status).sort(),[200,409]);const won=reviews.find(x=>x.status===200),approvedValue={...p,approval:won.data},before=credential(f);const results=await Promise.all([reset(f,approvedValue),reset(f,approvedValue)]);assert.deepEqual(results.map(x=>x.status).sort(),[200,400]);assert.equal(credential(f).revision,before.revision+1);assert.equal((await reset(f,approvedValue)).status,400);assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);});

test('expired requests cannot be approved or consumed at their server deadline',async t=>{const f=await fixture(t),p=await pending(f);f.now=p.receipt.expiresAt;assert.equal((await decision(f,p.receipt.requestId,1)).status,409);const f2=await fixture(t),q=await approved(f2);f2.now=q.receipt.expiresAt;assert.equal((await reset(f2,q)).status,400);});

test('privileged and junior-misgranted identities cannot route recovery to an easier reviewer',async t=>{const f=await fixture(t);f.db.prepare("INSERT INTO team_platform_reviewers(user_id,permission,status) VALUES ('employee-a','team.provision','active')").run();f.db.prepare("INSERT INTO team_operators VALUES ('team-b','employee-b','administrator','active')").run();await pending(f);await pending(f,'employee-b');await pending(f,'owner');await pending(f,'provision');assert.deepEqual((await list(f,'admin-a')).data.requests,[]);assert.deepEqual((await list(f,'owner')).data.requests,[]);assert.deepEqual((await call(f,'/api/account/recovery-reviews/access',undefined,f.tokens['employee-b'])).data,{canReview:false});});

test('ordinary business manager and junior-misgranted owner cannot acquire recovery authority',async t=>{const f=await fixture(t);f.db.prepare("UPDATE team_memberships SET role='manager' WHERE user_id='employee-a'").run();f.db.prepare("INSERT INTO team_admin_grants VALUES ('team-a','employee-a','member.invite','active')").run();assert.deepEqual((await call(f,'/api/account/recovery-reviews/access',undefined,f.tokens['employee-a'])).data,{canReview:false});f.db.prepare("INSERT INTO team_recovery_reviewers(user_id,permission,status) VALUES ('employee-b','account.recover','active')").run();assert.deepEqual((await call(f,'/api/account/recovery-reviews/access',undefined,f.tokens['employee-b'])).data,{canReview:false});});

test('approved proof is hashed at rest and never appears in review list or audit events',async t=>{const f=await fixture(t),p=await approved(f),row=f.db.prepare('SELECT * FROM team_recovery_requests WHERE request_id=?').get(p.receipt.requestId);assert.equal(row.token_hash,createHash('sha256').update(p.approval.recoveryProof).digest('hex'));for(const value of [JSON.stringify(row),JSON.stringify(f.db.prepare('SELECT * FROM team_recovery_events').all()),(await list(f,'admin-a')).raw])assert.equal(value.includes(p.approval.recoveryProof),false);assert.equal((await list(f,'admin-a')).raw.includes(PHONES['employee-a']),false);});

for(const [name,mutate] of [
 ['reviewer operator revoked',f=>f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='admin-a'").run()],
 ['reviewer credential replaced',f=>f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='admin-a'").run()],
 ['target reassigned',f=>f.db.prepare("UPDATE team_memberships SET role='assistant' WHERE user_id='employee-a'").run()],
])test('password review transaction rechecks '+name+' after verification',async t=>{const f=await fixture(t),p=await pending(f),hit=mutateBeforeTransaction(t,f.db,()=>mutate(f));const r=await decision(f,p.receipt.requestId,1);assert.equal(hit(),true);assert.equal(r.status,409,r.raw);const row=f.db.prepare('SELECT * FROM team_recovery_requests WHERE request_id=?').get(p.receipt.requestId);assert.equal(row.status,'pending');assert.equal(row.token_hash,null);});

test('streamed review body cannot migrate its authorizing session to another same-team operator',async t=>{const f=await fixture(t),p=await pending(f);f.db.prepare("UPDATE team_operators SET team_id='team-a' WHERE user_id='admin-b'").run();let controller,entered;const seen=new Promise(resolve=>entered=resolve),original=f.db.prepare,hash=createHash('sha256').update(f.tokens['admin-a']).digest('hex');f.db.prepare=function(sql){const statement=original.call(this,sql);if(sql.includes('team_sessions')){const get=statement.get;statement.get=function(...args){const value=get.apply(this,args);if(args.includes(hash))entered();return value;};}return statement;};t.after(()=>f.db.prepare=original);
  const body=new ReadableStream({start(value){controller=value;}}),requestValue=new Request('http://127.0.0.1:8774/api/account/recovery-reviews/'+p.receipt.requestId+'/review',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+f.tokens['admin-a']},body,duplex:'half'}),operation=rawCall(f,requestValue);await seen;f.db.prepare('UPDATE team_sessions SET user_id=? WHERE token_hash=?').run('admin-b',hash);controller.enqueue(new TextEncoder().encode(JSON.stringify({decision:'approve',revision:1,currentPassword:PASSWORD})));controller.close();const result=await operation;assert.equal(result.status,404,result.raw);assert.equal(f.db.prepare('SELECT status FROM team_recovery_requests WHERE request_id=?').get(p.receipt.requestId).status,'pending');
});

test('review list applies own-scope before the fifty-row limit and exposes no other-team records',async t=>{const f=await fixture(t),own=await pending(f),other=await pending(f,'employee-b');function clone(p,index){const requestRow={...f.db.prepare('SELECT * FROM team_recovery_requests WHERE request_id=?').get(p.receipt.requestId)},challengeRow={...f.db.prepare('SELECT * FROM team_phone_challenges WHERE challenge_id=?').get(p.c.challengeId)};challengeRow.challenge_id=randomUUID();requestRow.request_id=randomUUID();requestRow.challenge_id=challengeRow.challenge_id;requestRow.created_at=NOW+index;for(const [table,row]of [['team_phone_challenges',challengeRow],['team_recovery_requests',requestRow]]){const keys=Object.keys(row);f.db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row));}}
  for(let i=1;i<=55;i++)clone(own,i);for(let i=100;i<160;i++)clone(other,i);const rows=(await list(f,'admin-a')).data.requests;assert.equal(rows.length,50);assert.ok(rows.every(row=>row.teamId==='team-a'&&row.displayName==='Synthetic employee-a'));assert.ok(rows.every(row=>row.createdAt<NOW+100));assert.equal(new Set(rows.map(row=>row.id)).size,50);
});

test('approval storage failure returns no proof and rolls back review and event state',async t=>{const f=await fixture(t),p=await pending(f);f.db.exec("CREATE TRIGGER recovery_approval_event_failure BEFORE INSERT ON team_recovery_events BEGIN SELECT RAISE(ABORT,'synthetic event failure'); END");const result=await decision(f,p.receipt.requestId,1);assert.equal(result.status,503,result.raw);assert.equal(result.raw.includes('synthetic event'),false);const row=f.db.prepare('SELECT * FROM team_recovery_requests WHERE request_id=?').get(p.receipt.requestId);assert.equal(row.status,'pending');assert.equal(row.revision,1);assert.equal(row.token_hash,null);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_recovery_events').get().n,0);});

test('request creation rechecks the SMS deadline inside its insert transaction',async t=>{const f=await fixture(t),c=await sms(f);f.now=c.expiresAt-1;const hit=mutateBeforeTransaction(t,f.db,()=>{f.now=c.expiresAt;},2);const result=await call(f,'/api/auth/recovery-requests',{challengeId:c.challengeId,code:c.code});assert.equal(hit(),true);const stored=f.db.prepare('SELECT created_at,expires_at,status FROM team_recovery_requests WHERE challenge_id=?').get(c.challengeId);assert.equal(result.status,400,JSON.stringify({response:result.data,stored}));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_recovery_requests WHERE challenge_id=?').get(c.challengeId).n,0);assert.equal(f.db.prepare("SELECT 1 FROM team_auth_limits WHERE bucket='recovery-request:global'").get(),undefined);assert.deepEqual((await list(f,'admin-a')).data.requests,[]);});


test('anonymous recovery requests are source-isolated and malformed or invalid proofs cannot consume the shared budget',async t=>{
  const f=await fixture(t),route='/api/auth/recovery-requests';
  const malformedAddress='198.51.100.20',blockedAddress='198.51.100.21',validAddress='198.51.100.22';
  const post=(address,value)=>new Request('http://127.0.0.1:8774'+route,{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Shenyi-Client-IP':address},
    body:JSON.stringify(value),
  });
  // A malformed anonymous body is rejected before even creating a source bucket.
  for(let i=0;i<60;i++)assert.equal((await rawCall(f,post(malformedAddress,{}))).status,400);
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const malformedBucket='recovery-request:ip:'+hash(malformedAddress);
  assert.equal(f.db.prepare('SELECT 1 FROM team_auth_limits WHERE bucket=?').get(malformedBucket),undefined);

  // Structurally valid but nonexistent challenges consume only this source's
  // bounded bucket; they never consume the shared recovery-request budget.
  const unknownChallenge=randomUUID(),invalidBody={challengeId:unknownChallenge,code:'000000'};
  for(let i=0;i<60;i++)assert.equal((await rawCall(f,post(blockedAddress,invalidBody))).status,400);
  assert.equal((await rawCall(f,post(blockedAddress,invalidBody))).status,429);
  const blockedBucket='recovery-request:ip:'+hash(blockedAddress);
  assert.equal(f.db.prepare('SELECT attempts FROM team_auth_limits WHERE bucket=?').get(blockedBucket).attempts,60);
  assert.equal(f.db.prepare("SELECT 1 FROM team_auth_limits WHERE bucket='recovery-request:global'").get(),undefined);

  // A different legitimate source can still submit a live SMS proof.
  const challenge=await sms(f),created=await rawCall(f,post(validAddress,{challengeId:challenge.challengeId,code:challenge.code}));
  assert.equal(created.status,201,created.raw);
  const validBucket='recovery-request:ip:'+hash(validAddress);
  assert.equal(f.db.prepare('SELECT attempts FROM team_auth_limits WHERE bucket=?').get(validBucket).attempts,1);
  assert.equal(f.db.prepare("SELECT attempts FROM team_auth_limits WHERE bucket='recovery-request:global'").get().attempts,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_recovery_requests').get().n,1);
});


test('shared recovery budget rejection preserves a valid SMS proof for retry',async t=>{
  const f=await fixture(t),c=await sms(f);
  f.db.prepare('INSERT INTO team_auth_limits(bucket,window_start,attempts) VALUES (?,?,?)')
    .run('recovery-request:global',f.now,60);
  const submit=()=>call(f,'/api/auth/recovery-requests',{challengeId:c.challengeId,code:c.code});
  for(let i=0;i<5;i++){
    const rejected=await submit();
    assert.equal(rejected.status,429,rejected.raw);
  }
  assert.equal(f.db.prepare('SELECT attempts FROM team_phone_challenges WHERE challenge_id=?').get(c.challengeId).attempts,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_recovery_requests').get().n,0);

  f.now+=60000;
  const accepted=await submit();
  assert.equal(accepted.status,201,accepted.raw);
  assert.equal(f.db.prepare('SELECT attempts FROM team_phone_challenges WHERE challenge_id=?').get(c.challengeId).attempts,1);
  assert.equal(f.db.prepare("SELECT attempts FROM team_auth_limits WHERE bucket='recovery-request:global'").get().attempts,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_recovery_requests').get().n,1);
});
