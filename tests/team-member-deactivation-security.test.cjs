'use strict';
// Independent adversarial acceptance. Real isolated SQLite, application APIs and
// async scrypt; explicit synthetic sessions/SMS/WeChat only. No customer data,
// real provider, native UI, OS picker, Mac or production acceptance is claimed.
const nodeTest=require('node:test'),assert=require('node:assert/strict');
const test=(name,action)=>nodeTest(name,{timeout:10000},action);
const {DatabaseSync}=require('node:sqlite'),{createHash,randomBytes}=require('node:crypto');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-15T12:00:00Z'),ORIGIN='http://127.0.0.1:8774',PASSWORD='SyntheticDisable!2026';
const BYTES=Buffer.from('Synthetic retained original\0\r\n原件; no client data.');
const quote=value=>'"'+value.replaceAll('"','""')+'"',hash=value=>createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve;return {promise:new Promise(value=>resolve=value),resolve};};
let encoded;
async function fixture(t){
 const {initializeTeamDatabase}=await source('database.mjs'),{hashPassword}=await source('passwords.mjs'),{issueSession}=await source('auth-api.mjs'),{handleTeamApplicationRequest}=await source('application-api.mjs');
 encoded||=hashPassword(PASSWORD);const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);t.after(()=>db.close());
 const users=['tech-a','tech-b','owner','provision','recovery','intern-a','assistant-a','manager-a','partner-a','intern-b','orphan'];
 for(const id of users){db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(id,id,'Synthetic '+id,await encoded);}
 for(const team of ['a','b']){db.prepare("INSERT INTO teams VALUES (?,'active')").run('team-'+team);db.prepare('INSERT INTO team_profiles VALUES (?,?)').run('team-'+team,'Synthetic team '+team);db.prepare("INSERT INTO team_projects(team_id,project_id,title,status) VALUES (?,?,?,'active')").run('team-'+team,'project-'+team,'Synthetic project '+team);db.prepare("INSERT INTO team_operators VALUES (?,?,'administrator','active')").run('team-'+team,'tech-'+team);}
 for(const role of ['intern','assistant','manager','partner'])db.prepare("INSERT INTO team_memberships VALUES (?,?,?,'active')").run('team-a',role+'-a',role);
 db.prepare("INSERT INTO team_memberships VALUES ('team-b','intern-b','intern','active')").run();
 db.prepare("INSERT INTO team_access_reviewers(user_id,permission,status) VALUES ('owner','member.disable','active')").run();
 db.prepare("INSERT INTO team_platform_reviewers(user_id,permission,status) VALUES ('provision','team.provision','active')").run();
 db.prepare("INSERT INTO team_recovery_reviewers(user_id,permission,status) VALUES ('recovery','account.recover','active')").run();
 for(const task of ['task-a','task-second']){db.prepare("INSERT INTO team_collection_tasks(team_id,task_id,project_id,title,instructions,status) VALUES ('team-a',?,'project-a',?,'synthetic only','open')").run(task,task);db.prepare("INSERT INTO team_task_assignments VALUES ('team-a',?,'intern-a','active')").run(task);}
 const tokens={};for(const id of users)tokens[id]=issueSession(db,id,NOW).token;
 const sent=[],f={db,tokens,sent,now:NOW};
 f.providers={reviewedRecovery:true,phonePepper:Buffer.alloc(32,7),sms:{send:async value=>sent.push({...value})},wechat:{appId:'synthetic-disable',redirectUri:'https://auth.synthetic.invalid/api/auth/wechat/callback',createAuthorizationUrl({state,redirectUri}){return 'https://open.weixin.qq.com/connect/qrconnect?'+new URLSearchParams({appid:'synthetic-disable',redirect_uri:redirectUri,response_type:'code',scope:'snsapi_login',state})+'#wechat_redirect';},exchangeCode:async()=>({appId:'synthetic-disable',openId:'synthetic-open'})}};
 f.send=async request=>{const response=await handleTeamApplicationRequest(request,{db,now:()=>f.now,identityProviders:f.providers}),raw=await response.text();return {status:response.status,data:(response.headers.get('Content-Type')||'').startsWith('application/json')&&raw?JSON.parse(raw):null,raw};};
 f.call=(route,actor,body,method=body===undefined?'GET':'POST')=>f.send(new Request(ORIGIN+route,{method,headers:{Origin:'shenyi://app','Content-Type':'application/json',...(actor?{Authorization:'Bearer '+(tokens[actor]||actor)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 f.stream=(route,actor)=>{let controller;const seen=deferred(),body=new ReadableStream({start(value){controller=value;},pull(){seen.resolve();}},{highWaterMark:0});return {reading:seen.promise,pending:f.send(new Request(ORIGIN+route,{method:'POST',headers:{Origin:'shenyi://app','Content-Type':'application/json',Authorization:'Bearer '+tokens[actor]},body,duplex:'half'})),finish(value){controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));controller.close();}};};
 return f;
}
const revision=(f,id)=>Number(f.db.prepare('SELECT CAST(version AS TEXT) version FROM team_recovery_identity_epochs WHERE user_id=?').get(id)?.version??0);
const route=(id='intern-a',kind='business',team='team-a')=>'/api/teams/'+team+'/'+(kind==='business'?'business-members':'administrators')+'/'+id+'/disable';
const disable=(f,{id='intern-a',kind='business',team='team-a',actor=kind==='business'?'tech-a':'owner',at=revision(f,id),password=PASSWORD}={})=>f.call(route(id,kind,team),actor,{revision:at,currentPassword:password});
const status=(f,id)=>f.db.prepare('SELECT status FROM team_users WHERE user_id=?').get(id).status;
const activeSessions=(f,id)=>f.db.prepare('SELECT COUNT(*) n FROM team_sessions WHERE user_id=? AND revoked_at IS NULL').get(id).n;
function snapshot(f){return f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'team_auth_limits' ORDER BY name").all().map(({name})=>{const rows=f.db.prepare('SELECT * FROM '+quote(name)).all();return {name,count:rows.length,sha256:hash(JSON.stringify(rows.map(row=>JSON.stringify(row)).sort()))};});}
function denied(result,codes=[401,403,404,409]){assert.ok(codes.includes(result.status),result.status+' '+result.raw);assert.ok(!/password_hash|token_hash|scrypt\$|SQLITE|synthetic abort/i.test(result.raw));}
function beforeTransaction(t,f,mutate){const original=f.db.exec;let fired=false;f.db.exec=function(sql){if(!fired&&/^BEGIN IMMEDIATE/.test(sql)){fired=true;mutate();}return original.call(this,sql);};t.after(()=>f.db.exec=original);return ()=>fired;}
function duringPassword(t,f,mutate){const original=f.db.prepare;let fired=false;f.db.prepare=function(sql){const statement=original.call(this,sql);if(/^INSERT INTO team_auth_limits/.test(sql)){const run=statement.run;statement.run=function(...args){const value=run.apply(this,args);if(!fired&&String(args[0]).startsWith('member-disable:')){fired=true;queueMicrotask(mutate);}return value;};}return statement;};t.after(()=>f.db.prepare=original);return ()=>fired;}
function phone(f,id,number){f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run(id,number,NOW-1000);}
async function sms(f,id='intern-a',number='+8613800000001'){const r=await f.call('/api/auth/phone/challenges',null,{phone:number,purpose:'reset'});assert.equal(r.status,202,r.raw);return {...r.data,code:f.sent.find(value=>value.challengeId===r.data.challengeId).code};}
async function recovery(f,id='intern-a',number='+8613800000001'){const challenge=await sms(f,id,number),pending=await f.call('/api/auth/recovery-requests',null,{challengeId:challenge.challengeId,code:challenge.code});assert.equal(pending.status,201,pending.raw);const approved=await f.call('/api/account/recovery-reviews/'+pending.data.requestId+'/review','tech-a',{decision:'approve',revision:pending.data.revision,currentPassword:PASSWORD});assert.equal(approved.status,200,approved.raw);return {challenge,pending:pending.data,approved:approved.data};}
const reset=(f,p)=>f.call('/api/auth/phone/reset',null,{challengeId:p.challenge.challengeId,code:p.challenge.code,recoveryProof:p.approved.recoveryProof,newPassword:'SyntheticReplaced!2026'});

test('global disable atomically revokes target scope, increments each affected task once and preserves originals/history',async t=>{
 const f=await fixture(t),uploaded=await f.call('/api/teams/team-a/collection/tasks/task-a/submissions','intern-a',{revision:0,filename:'synthetic-original.bin',contentBase64:BYTES.toString('base64')});assert.equal(uploaded.status,201,uploaded.raw);
 f.db.prepare("INSERT INTO team_task_assignments VALUES ('team-a','task-a','assistant-a','active')").run();
 for(const permission of ['collection.read','collection.manage'])f.db.prepare("INSERT INTO team_project_grants VALUES ('team-a','project-a','intern-a',?,'active')").run(permission);
 f.db.prepare("INSERT INTO team_admin_grants VALUES ('team-a','intern-a','member.invite','active')").run();
 const beforeRevision=revision(f,'intern-a'),oldCredential=f.db.prepare("SELECT password_hash FROM team_credentials WHERE user_id='intern-a'").get().password_hash;
 const result=await disable(f);assert.equal(result.status,200,result.raw);assert.deepEqual(result.data,{disabled:true});assert.equal(status(f,'intern-a'),'disabled');assert.equal(activeSessions(f,'intern-a'),0);
 assert.equal(f.db.prepare("SELECT status FROM team_memberships WHERE user_id='intern-a'").get().status,'disabled');
 for(const table of ['team_task_assignments','team_project_grants','team_attachment_grants','team_admin_grants'])assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+table+" WHERE team_id='team-a' AND user_id='intern-a' AND status='active'").get().n,0,table);
 assert.equal(f.db.prepare("SELECT revision FROM team_task_versions WHERE task_id='task-a'").get().revision,2);assert.equal(f.db.prepare("SELECT revision FROM team_task_versions WHERE task_id='task-second'").get().revision,1);
 assert.equal(f.db.prepare("SELECT status FROM team_task_assignments WHERE user_id='assistant-a'").get().status,'active');assert.equal(f.db.prepare("SELECT status FROM team_collection_tasks WHERE task_id='task-a'").get().status,'submitted');
 const original=f.db.prepare('SELECT bytes FROM team_collection_attachments WHERE attachment_id=?').get(uploaded.data.submission.attachmentId);assert.deepEqual(Buffer.from(original.bytes),BYTES);assert.equal(hash(original.bytes),uploaded.data.submission.sha256);assert.equal(f.db.prepare("SELECT password_hash FROM team_credentials WHERE user_id='intern-a'").get().password_hash,oldCredential);
 const event=f.db.prepare('SELECT * FROM team_member_access_events').get();assert.equal(event.actor_id,'tech-a');assert.equal(event.target_user_id,'intern-a');assert.equal(event.target_kind,'business');assert.equal(event.before_revision,beforeRevision);assert.equal(event.created_at,NOW);assert.ok(!/password|token|phone|hash/i.test(Object.keys(event).join(' ')));
 assert.ok(revision(f,'intern-a')>beforeRevision);assert.equal((await disable(f)).status,409);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_member_access_events').get().n,1);assert.equal((await f.call('/api/auth/session','intern-a')).status,401);
});

for(const table of ['team_platform_reviewers','team_recovery_reviewers','team_access_reviewers'])test('a revoked '+table+' record protects an otherwise eligible target from both lists and disable',async t=>{
 const f=await fixture(t),permission=table==='team_platform_reviewers'?'team.provision':table==='team_recovery_reviewers'?'account.recover':'member.disable';f.db.prepare('INSERT INTO '+table+'(user_id,permission,status) VALUES (?,?,?)').run('intern-a',permission,'revoked');const before=snapshot(f);
 denied(await disable(f),[404]);const list=await f.call('/api/teams/team-a/business-members','tech-a');assert.equal(list.status,200,list.raw);assert.ok(!list.data.members.some(member=>member.id==='intern-a'));assert.deepEqual(snapshot(f),before);
});

for(const affiliation of ['membership','operator'])test('historic disabled/revoked other-team '+affiliation+' prevents global business disable',async t=>{
 const f=await fixture(t);if(affiliation==='membership')f.db.prepare("INSERT INTO team_memberships VALUES ('team-b','intern-a','assistant','disabled')").run();else f.db.prepare("INSERT INTO team_operators VALUES ('team-b','intern-a','administrator','revoked')").run();const before=snapshot(f);
 denied(await disable(f),[404]);assert.equal(status(f,'intern-a'),'active');assert.deepEqual(snapshot(f),before);
});

test('administrator with any historical other-team business affiliation is not globally disabled by the owner',async t=>{
 const f=await fixture(t);f.db.prepare("INSERT INTO team_memberships VALUES ('team-b','tech-a','manager','disabled')").run();const before=snapshot(f);denied(await disable(f,{id:'tech-a',kind:'administrator'}),[404]);assert.deepEqual(snapshot(f),before);
});

test('owner may finish disabling an already-revoked administrator in a disabled team without touching another team',async t=>{
 const f=await fixture(t);f.db.prepare("UPDATE teams SET status='disabled' WHERE team_id='team-a'").run();f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='tech-a'").run();
 const result=await disable(f,{id:'tech-a',kind:'administrator'});assert.equal(result.status,200,result.raw);assert.equal(status(f,'tech-a'),'disabled');assert.equal(activeSessions(f,'tech-a'),0);assert.equal(status(f,'tech-b'),'active');assert.equal(activeSessions(f,'tech-b'),1);
});

test('recovery and provisioning owner grants cannot substitute for member.disable',async t=>{
 const f=await fixture(t),before=snapshot(f);for(const actor of ['provision','recovery','manager-a','partner-a','tech-b'])denied(await disable(f,{id:'tech-a',kind:'administrator',actor}),[404]);assert.deepEqual(snapshot(f),before);
});

const races={
 'operator grant ABA':f=>{f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='tech-a'").run();f.db.prepare("UPDATE team_operators SET status='active' WHERE user_id='tech-a'").run();},
 'actor credential ABA':f=>{f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='tech-a'").run();f.db.prepare("UPDATE team_credentials SET revision=revision-1 WHERE user_id='tech-a'").run();},
 'target role ABA':f=>{f.db.prepare("UPDATE team_memberships SET role='assistant' WHERE user_id='intern-a'").run();f.db.prepare("UPDATE team_memberships SET role='intern' WHERE user_id='intern-a'").run();},
 'target extra-team affiliation':f=>f.db.prepare("INSERT INTO team_memberships VALUES ('team-b','intern-a','assistant','disabled')").run(),
 'target protected ACL ABA':f=>{f.db.prepare("INSERT INTO team_access_reviewers(user_id,permission,status) VALUES ('intern-a','member.disable','revoked')").run();f.db.prepare("DELETE FROM team_access_reviewers WHERE user_id='intern-a'").run();},
};
for(const [label,mutate] of Object.entries(races))test('real password work cannot commit after '+label,async t=>{
 const f=await fixture(t),at=revision(f,'intern-a');let afterMutation;const fired=duringPassword(t,f,()=>{mutate(f);afterMutation=snapshot(f);});
 const result=await disable(f,{at});denied(result);assert.equal(fired(),true);assert.ok(afterMutation);assert.equal(status(f,'intern-a'),'active');assert.deepEqual(snapshot(f),afterMutation);
});

test('owner ACL revoke-and-identical-regrant ABA during password work cannot disable an administrator',async t=>{
 const f=await fixture(t);let afterMutation;const fired=duringPassword(t,f,()=>{f.db.prepare("UPDATE team_access_reviewers SET status='revoked' WHERE user_id='owner'").run();f.db.prepare("UPDATE team_access_reviewers SET status='active' WHERE user_id='owner'").run();afterMutation=snapshot(f);});
 denied(await disable(f,{id:'tech-a',kind:'administrator'}),[409]);assert.equal(fired(),true);assert.deepEqual(snapshot(f),afterMutation);
});

test('the transaction repeats all target affiliation and authority checks after password verification',async t=>{
 const f=await fixture(t);let afterMutation;const fired=beforeTransaction(t,f,()=>{f.db.prepare("INSERT INTO team_memberships VALUES ('team-b','intern-a','manager','disabled')").run();afterMutation=snapshot(f);});denied(await disable(f),[404]);assert.equal(fired(),true);assert.deepEqual(snapshot(f),afterMutation);
});

test('a streamed request cannot migrate its initial operator session to a different authorized same-team operator',async t=>{
 const f=await fixture(t);f.db.prepare("UPDATE team_operators SET team_id='team-a' WHERE user_id='tech-b'").run();const at=revision(f,'intern-a'),request=f.stream(route(),'tech-a');await request.reading;
 f.db.prepare('UPDATE team_sessions SET user_id=? WHERE token_hash=?').run('tech-b',hash(f.tokens['tech-a']));const before=snapshot(f);request.finish({revision:at,currentPassword:PASSWORD});denied(await request.pending,[404]);assert.deepEqual(snapshot(f),before);
});

test('a streamed request cannot use a target revision captured before membership ABA',async t=>{
 const f=await fixture(t),at=revision(f,'intern-a'),request=f.stream(route(),'tech-a');await request.reading;races['target role ABA'](f);const before=snapshot(f);request.finish({revision:at,currentPassword:PASSWORD});denied(await request.pending,[409]);assert.deepEqual(snapshot(f),before);
});

test('two real concurrent password checks produce exactly one disable and one audit event',async t=>{
 const f=await fixture(t),at=revision(f,'intern-a'),results=await Promise.all([disable(f,{at}),disable(f,{at})]);assert.equal(results.filter(value=>value.status===200).length,1,JSON.stringify(results));assert.equal(results.filter(value=>value.status===409).length,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_member_access_events').get().n,1);assert.equal(status(f,'intern-a'),'disabled');
});

for(const value of [Number.MAX_SAFE_INTEGER,1.5])test('unincrementable task revision '+value+' aborts the entire account, grants, sessions and audit change',async t=>{
 const f=await fixture(t);f.db.prepare("INSERT INTO team_task_versions VALUES ('team-a','task-second',?)").run(value);const before=snapshot(f);denied(await disable(f),[409]);assert.deepEqual(snapshot(f),before);
});

test('a target identity epoch at MAX cannot overflow through several identity triggers',async t=>{
 const f=await fixture(t);f.db.prepare("UPDATE team_recovery_identity_epochs SET version=? WHERE user_id='intern-a'").run(Number.MAX_SAFE_INTEGER);const before=snapshot(f);denied(await disable(f),[409]);assert.deepEqual(snapshot(f),before);
});

test('audit storage failure rolls back all account, sessions, task versions and grant changes',async t=>{
 const f=await fixture(t);f.db.exec("CREATE TRIGGER synthetic_member_audit_abort BEFORE INSERT ON team_member_access_events BEGIN SELECT RAISE(ABORT,'synthetic abort'); END");const before=snapshot(f),result=await disable(f);denied(result,[503]);assert.deepEqual(snapshot(f),before);
});

test('new member.disable reviewers cannot become targets of ordinary team-admin password recovery',async t=>{
 const f=await fixture(t);phone(f,'intern-a','+8613800000001');f.db.prepare("INSERT INTO team_access_reviewers(user_id,permission,status) VALUES ('intern-a','member.disable','revoked')").run();const challenge=await sms(f),receipt=await f.call('/api/auth/recovery-requests',null,{challengeId:challenge.challengeId,code:challenge.code});assert.equal(receipt.status,201,receipt.raw);const list=await f.call('/api/account/recovery-reviews','tech-a');assert.equal(list.status,200,list.raw);assert.deepEqual(list.data.requests,[]);
});

test('disable consumes old SMS and approved recovery proof while retaining the original identity bindings',async t=>{
 const f=await fixture(t);phone(f,'intern-a','+8613800000001');const p=await recovery(f),credential=f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='intern-a'").get();assert.equal((await disable(f)).status,200);
 const challenge=f.db.prepare('SELECT consumed_at FROM team_phone_challenges WHERE challenge_id=?').get(p.challenge.challengeId);assert.equal(challenge.consumed_at,NOW);assert.equal(f.db.prepare('SELECT status FROM team_recovery_requests WHERE request_id=?').get(p.pending.requestId).status,'revoked');denied(await reset(f,p),[400]);assert.deepEqual(f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='intern-a'").get(),credential);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_phone_credentials WHERE user_id='intern-a'").get().n,1);assert.equal(activeSessions(f,'intern-a'),0);
});

test('a reset held inside synthetic recovery authorization cannot reactivate or rotate a disabled account',async t=>{
 const f=await fixture(t);phone(f,'intern-a','+8613800000001');const entered=deferred(),release=deferred();f.providers.reviewedRecovery=false;f.providers.recovery={authorize:async()=>{entered.resolve();return release.promise;}};
 const challenge=await sms(f),beforeCredential=f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='intern-a'").get();const pending=f.call('/api/auth/phone/reset',null,{challengeId:challenge.challengeId,code:challenge.code,recoveryProof:'synthetic-authorized-proof',newPassword:'SyntheticReplacement!2026'});await entered.promise;assert.equal((await disable(f)).status,200);release.resolve(true);denied(await pending,[400]);assert.equal(status(f,'intern-a'),'disabled');assert.deepEqual(f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='intern-a'").get(),beforeCredential);assert.equal(activeSessions(f,'intern-a'),0);
});

test('SMS provider completion after disable cannot resurrect a previously sending reset challenge',async t=>{
 const f=await fixture(t);phone(f,'intern-a','+8613800000001');const entered=deferred(),release=deferred();f.providers.sms.send=async value=>{f.sent.push(value);entered.resolve();await release.promise;};const pending=f.call('/api/auth/phone/challenges',null,{phone:'+8613800000001',purpose:'reset'});await entered.promise;assert.equal((await disable(f)).status,200);release.resolve();const receipt=await pending;assert.equal(receipt.status,202,receipt.raw);const row=f.db.prepare("SELECT consumed_at,delivery_state FROM team_phone_challenges WHERE user_id='intern-a'").get();assert.equal(row.consumed_at,NOW);assert.equal(row.delivery_state,'failed');denied(await f.call('/api/auth/phone/reset',null,{challengeId:receipt.data.challengeId,code:f.sent[0].code,recoveryProof:'synthetic-proof',newPassword:'SyntheticReplacement!2026'}),[400]);assert.equal(activeSessions(f,'intern-a'),0);
});

test('a ready linked WeChat transaction is canceled without deleting its identity or issuing another session',async t=>{
 const f=await fixture(t),poll=randomBytes(32).toString('base64url'),verifier='v'.repeat(43),id='synthetic-ready';f.db.prepare('INSERT INTO team_wechat_identities VALUES (?,?,?,?)').run('synthetic-disable','synthetic-open','intern-a',NOW);
 f.db.prepare("INSERT INTO team_wechat_transactions(transaction_id,state_hash,poll_hash,code_challenge,app_id,redirect_uri,status,expires_at,open_id,user_id,credential_revision) VALUES (?,?,?,?,?,?,'ready',?,?,?,1)").run(id,hash('synthetic-state'),hash(poll),createHash('sha256').update(verifier).digest('base64url'),'synthetic-disable',f.providers.wechat.redirectUri,NOW+60000,'synthetic-open','intern-a');assert.equal((await disable(f)).status,200);assert.equal(f.db.prepare('SELECT status FROM team_wechat_transactions WHERE transaction_id=?').get(id).status,'canceled');denied(await f.call('/api/auth/wechat/transactions/'+id+'/exchange',null,{pollToken:poll,codeVerifier:verifier}),[404]);assert.equal(activeSessions(f,'intern-a'),0);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_wechat_identities WHERE user_id='intern-a'").get().n,1);
});

test('a processing WeChat callback with initially unknown user cannot produce a ready login after target disable',async t=>{
 const f=await fixture(t),entered=deferred(),release=deferred(),verifier='x'.repeat(43);f.db.prepare('INSERT INTO team_wechat_identities VALUES (?,?,?,?)').run('synthetic-disable','synthetic-open','intern-a',NOW);f.providers.wechat.exchangeCode=async()=>{entered.resolve();await release.promise;return {appId:'synthetic-disable',openId:'synthetic-open'};};
 const started=await f.call('/api/auth/wechat/transactions',null,{codeChallenge:createHash('sha256').update(verifier).digest('base64url')});assert.equal(started.status,201,started.raw);const state=new URL(started.data.authorizationUrl).searchParams.get('state');const pending=f.send(new Request(f.providers.wechat.redirectUri+'?'+new URLSearchParams({state,code:'synthetic-provider-code'})));await entered.promise;assert.equal((await disable(f)).status,200);release.resolve();assert.equal((await pending).status,200);assert.equal(f.db.prepare('SELECT status FROM team_wechat_transactions WHERE transaction_id=?').get(started.data.transactionId).status,'failed');denied(await f.call('/api/auth/wechat/transactions/'+started.data.transactionId+'/exchange',null,{pollToken:started.data.pollToken,codeVerifier:verifier}),[404]);assert.equal(activeSessions(f,'intern-a'),0);
});

test('issued employee invitations and their in-flight SMS challenges stop when the issuing manager is disabled',async t=>{
 const f=await fixture(t);f.db.prepare("INSERT INTO team_admin_grants VALUES ('team-a','manager-a','member.invite','active')").run();const invite=await f.call('/api/teams/team-a/employee-invitations','manager-a',{phone:'+8613800000019',role:'intern'});assert.equal(invite.status,201,invite.raw);
 const entered=deferred(),release=deferred();f.providers.sms.send=async value=>{f.sent.push(value);entered.resolve();await release.promise;};const pending=f.call('/api/auth/onboarding/challenges',null,{invitationCode:invite.data.invitationCode,phone:'+8613800000019'});await entered.promise;assert.equal((await disable(f,{id:'manager-a'})).status,200);release.resolve();denied(await pending,[404]);const row=f.db.prepare('SELECT revoked_at,accepted_at FROM team_employee_invitations WHERE invitation_id=?').get(invite.data.invitationId);assert.equal(row.revoked_at,NOW);assert.equal(row.accepted_at,null);assert.equal(f.db.prepare('SELECT delivery_state FROM team_employee_activation_challenges WHERE invitation_id=?').get(invite.data.invitationId).delivery_state,'failed');
});

test('legacy invitations are expired without inventing acceptance and other issuers retain their pending invitations',async t=>{
 const f=await fixture(t);for(const id of ['manager-a','partner-a']){f.db.prepare("INSERT INTO team_admin_grants VALUES ('team-a',?,'member.invite','active')").run(id);f.db.prepare("INSERT INTO team_invitations VALUES (?,'team-a','orphan','intern',?,?,NULL)").run(hash(id),id,NOW+60000);}assert.equal((await disable(f,{id:'manager-a'})).status,200);
 const stopped=f.db.prepare('SELECT expires_at,accepted_at FROM team_invitations WHERE token_hash=?').get(hash('manager-a')),other=f.db.prepare('SELECT expires_at,accepted_at FROM team_invitations WHERE token_hash=?').get(hash('partner-a'));assert.equal(stopped.expires_at,NOW);assert.equal(stopped.accepted_at,null);assert.equal(other.expires_at,NOW+60000);assert.equal(other.accepted_at,null);
});

test('owner disable closes a technical administrator operator invitation whose SMS delivery is still pending',async t=>{
 const f=await fixture(t),invite=await f.call('/api/teams/team-a/employee-invitations','tech-a',{phone:'+8613800000018',role:'assistant'});assert.equal(invite.status,201,invite.raw);
 const entered=deferred(),release=deferred();f.providers.sms.send=async value=>{f.sent.push(value);entered.resolve();await release.promise;};const pending=f.call('/api/auth/onboarding/challenges',null,{invitationCode:invite.data.invitationCode,phone:'+8613800000018'});await entered.promise;
 assert.equal((await disable(f,{id:'tech-a',kind:'administrator'})).status,200);release.resolve();denied(await pending,[404]);const invitation=f.db.prepare('SELECT revoked_at,accepted_at FROM team_operator_employee_invitations WHERE invitation_id=?').get(invite.data.invitationId);assert.equal(invitation.revoked_at,NOW);assert.equal(invitation.accepted_at,null);assert.equal(f.db.prepare('SELECT delivery_state FROM team_operator_employee_activation_challenges WHERE invitation_id=?').get(invite.data.invitationId).delivery_state,'failed');assert.equal(activeSessions(f,'tech-a'),0);
});

test('an old recovery approval issued by the disabled administrator cannot reset another still-active employee',async t=>{
 const f=await fixture(t);phone(f,'assistant-a','+8613800000002');const p=await recovery(f,'assistant-a','+8613800000002'),credential=f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='assistant-a'").get();assert.equal((await disable(f,{id:'tech-a',kind:'administrator'})).status,200);
 denied(await reset(f,p),[400]);assert.equal(status(f,'assistant-a'),'active');assert.equal(activeSessions(f,'assistant-a'),1);assert.deepEqual(f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='assistant-a'").get(),credential);
});
