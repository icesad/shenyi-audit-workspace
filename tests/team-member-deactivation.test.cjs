'use strict';
// Real application requests and SQLite. Credentials are actual scrypt hashes;
// fixture session issuance avoids repeating unrelated password-login coverage.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-15T11:00:00Z'),ORIGIN='http://127.0.0.1:8774',PASSWORD='ShenyiDemo!2026';
const hash=value=>createHash('sha256').update(value).digest('hex');
const ACCESS='/api/auth/member-management/access',ADMINS='/api/administration/team-administrators';
const members=(team='team-a')=>'/api/teams/'+team+'/business-members';
const disable=(user='intern-a',team='team-a',kind='business-members')=>members(team).replace('business-members',kind)+'/'+user+'/disable';
let baseline;
async function fixture(t){
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');
 baseline||=(async()=>{const db=new DatabaseSync(':memory:');try{initializeTeamDatabase(db);await seedDemoTeamData(db);return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name+'"').all()}));}finally{db.close();}})();
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);db.exec('BEGIN;PRAGMA defer_foreign_keys=ON;');
 for(const {name,rows} of await baseline)for(const row of rows){const keys=Object.keys(row);db.prepare('INSERT OR REPLACE INTO "'+name+'"('+keys.map(key=>'"'+key+'"').join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row));}db.exec('COMMIT;');
 const run=(sql,...args)=>db.prepare(sql).run(...args);
 const add=(id,{role,team='team-a',operator=false,owner=false,name=id,status='active'}={})=>{
  run('INSERT INTO team_users VALUES (?,?)',id,status);run('INSERT INTO team_credentials(user_id,username,display_name,password_hash) SELECT ?,?,?,password_hash FROM team_credentials WHERE user_id=?',id,id,name,'intern-a');
  if(role)run("INSERT INTO team_memberships VALUES (?,?,?,'active')",team,id,role);if(operator)run("INSERT INTO team_operators VALUES (?,?,'administrator','active')",team,id);if(owner)run("INSERT INTO team_access_reviewers(user_id,permission,status) VALUES (?,'member.disable','active')",id);
 };
 add('administrator-a',{operator:true});add('administrator-b',{operator:true,team:'team-b'});add('access-owner',{owner:true});add('platform-only');add('recovery-only');
 run("INSERT INTO team_platform_reviewers VALUES ('platform-only','team.provision','active',1)");run("INSERT INTO team_recovery_reviewers VALUES ('recovery-only','account.recover','active',1)");
 for(const [team,name] of [['team-a','合成团队A'],['team-b','合成团队B']])run('INSERT OR IGNORE INTO team_profiles VALUES (?,?)',team,name);
 const {issueSession}=await source('auth-api.mjs'),{handleTeamApplicationRequest}=await source('application-api.mjs'),tokens={};
 for(const {user_id} of db.prepare("SELECT user_id FROM team_users WHERE status='active'").all())tokens[user_id]=issueSession(db,user_id,NOW).token;
 const dispatch=async request=>{const response=await handleTeamApplicationRequest(request,{db,now:()=>NOW});assert.ok(response);const raw=await response.text();for(const secret of ['password_hash','token_hash','SELECT ','synthetic audit failure'])assert.equal(raw.includes(secret),false,raw);return {status:response.status,data:raw?JSON.parse(raw):null,raw,headers:response.headers};};
 const call=(pathname=ACCESS,{actor='administrator-a',body,method=body===undefined?'GET':'POST',headers={}}={})=>dispatch(new Request(ORIGIN+pathname,{method,headers:{Authorization:'Bearer '+tokens[actor],'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 const revision=id=>Number(db.prepare('SELECT CAST(version AS TEXT) version FROM team_recovery_identity_epochs WHERE user_id=?').get(id)?.version??0);
 const stop=(id='intern-a',{actor='administrator-a',team='team-a',kind='business-members',password=PASSWORD,version=revision(id)}={})=>call(disable(id,team,kind),{actor,body:{revision:version,currentPassword:password}});
 const stream=(pathname=disable(),actor='administrator-a')=>{let controller,signal;const reading=new Promise(resolve=>signal=resolve);const body=new ReadableStream({start(value){controller=value;},pull(){signal();}},{highWaterMark:0});const pending=dispatch(new Request(ORIGIN+pathname,{method:'POST',headers:{Authorization:'Bearer '+tokens[actor],'Content-Type':'application/json'},body,duplex:'half'}));return {reading,pending,finish(value){controller.enqueue(Buffer.from(JSON.stringify(value)));controller.close();}};};
 return {db,run,add,tokens,call,revision,stop,stream};
}
function businessState(f){return ['team_users','team_memberships','team_operators','team_task_assignments','team_task_versions','team_project_grants','team_attachment_grants','team_admin_grants','team_sessions','team_recovery_identity_epochs','team_member_access_events'].map(name=>({name,rows:f.db.prepare('SELECT * FROM '+name).all()}));}
function active(f,id='intern-a'){assert.equal(f.db.prepare('SELECT status FROM team_users WHERE user_id=?').get(id).status,'active');}

test('access follows independent technical and owner authority, never audit or unrelated reviewer roles',async t=>{
 const f=await fixture(t);assert.deepEqual((await f.call()).data,{teams:[{teamId:'team-a',teamName:'合成团队A'}],canReviewAdministrators:false});assert.deepEqual((await f.call(ACCESS,{actor:'access-owner'})).data,{teams:[],canReviewAdministrators:true});
 for(const actor of ['intern-a','assistant-a','manager-a','partner-a','platform-only','recovery-only'])assert.deepEqual((await f.call(ACCESS,{actor})).data,{teams:[],canReviewAdministrators:false});
});
test('technical administrators see four business roles without audit grants and owners see minimum administrator rows',async t=>{
 const f=await fixture(t),business=await f.call(members()),admins=await f.call(ADMINS,{actor:'access-owner'});assert.equal(business.status,200);assert.deepEqual(business.data.members.map(row=>row.role).sort(),['assistant','intern','manager','partner']);assert.equal(business.data.hasMore,false);assert.deepEqual(Object.keys(business.data.members[0]).sort(),['displayName','id','revision','role','status']);
 assert.equal(admins.status,200);assert.deepEqual(admins.data.members.map(row=>row.id),['administrator-a','administrator-b']);assert.deepEqual(Object.keys(admins.data.members[0]).sort(),['displayName','id','revision','role','status','teamId','teamName']);
});
for(const role of ['intern','assistant','manager','partner'])test('technical administrator disables '+role+' without requiring a phone and invalidates old sessions',async t=>{
 const f=await fixture(t),id=role+'-a',before=f.revision(id);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_phone_credentials WHERE user_id=?').get(id).n,0);const result=await f.stop(id);assert.equal(result.status,200,result.raw);assert.deepEqual(result.data,{disabled:true});assert.equal(f.db.prepare('SELECT status FROM team_users WHERE user_id=?').get(id).status,'disabled');assert.equal(f.db.prepare("SELECT status FROM team_memberships WHERE team_id='team-a' AND user_id=?").get(id).status,'disabled');assert.equal(f.revision(id),before+3);assert.equal((await f.call('/api/auth/session',{actor:id})).status,401);assert.equal((await f.call('/api/auth/login',{actor:id,body:{username:id,password:PASSWORD}})).status,401);assert.equal((await f.stop(id)).status,409);
});
test('wrong password changes no business state and permits a correct retry in the same session',async t=>{
 const f=await fixture(t),before=businessState(f);assert.equal((await f.stop('intern-a',{password:'Incorrect synthetic password'})).status,403);assert.deepEqual(businessState(f),before);assert.equal((await f.call('/api/auth/session')).status,200);assert.equal((await f.stop()).status,200);
});
test('self, other administrators, foreign teams and unrelated reviewer authority are denied',async t=>{
 const f=await fixture(t);for(const options of [{actor:'administrator-a',id:'administrator-a',kind:'administrators'},{actor:'administrator-a',id:'administrator-b',team:'team-b',kind:'administrators'},{actor:'administrator-a',id:'intern-b',team:'team-b'},{actor:'access-owner',id:'intern-a'},{actor:'platform-only',id:'administrator-a',kind:'administrators'},{actor:'recovery-only',id:'administrator-a',kind:'administrators'}]){const {id,...rest}=options;assert.equal((await f.stop(id,rest)).status,404);}
 for(const actor of ['intern-a','assistant-a','manager-a','partner-a']){assert.equal((await f.call(members(),{actor})).status,404);assert.equal((await f.stop('assistant-a',{actor})).status,404);}assert.equal((await f.call(ADMINS)).status,404);
});
test('any privileged reviewer record protects a target, including revoked grants',async t=>{
 const f=await fixture(t);f.run("INSERT INTO team_platform_reviewers VALUES ('manager-a','team.provision','revoked',1)");f.run("INSERT INTO team_recovery_reviewers VALUES ('partner-a','account.recover','revoked',1)");f.run("INSERT INTO team_access_reviewers VALUES ('assistant-a','member.disable','revoked',1)");
 assert.deepEqual((await f.call(members())).data.members.map(row=>row.id),['intern-a']);for(const id of ['manager-a','partner-a','assistant-a'])assert.equal((await f.stop(id)).status,404);
});
test('all historical team affiliations count before listing or global account disable',async t=>{
 const f=await fixture(t);f.run("INSERT INTO team_memberships VALUES ('team-b','intern-a','intern','disabled')");f.run("INSERT INTO team_operators VALUES ('team-a','manager-a','administrator','revoked')");assert.equal((await f.stop()).status,404);assert.equal((await f.stop('manager-a')).status,404);assert.deepEqual((await f.call(members())).data.members.map(row=>row.id),['assistant-a','partner-a']);
 f.run("INSERT INTO team_memberships VALUES ('team-b','administrator-a','manager','disabled')");assert.equal((await f.stop('administrator-a',{actor:'access-owner',kind:'administrators'})).status,404);assert.deepEqual((await f.call(ADMINS,{actor:'access-owner'})).data.members.map(row=>row.id),['administrator-b','manager-a']);
});
test('list status is the account status and a disabled membership can still be completely deactivated',async t=>{
 const f=await fixture(t);f.run("UPDATE team_memberships SET status='disabled' WHERE user_id='intern-a'");f.run("UPDATE team_users SET status='disabled' WHERE user_id='assistant-a'");const list=(await f.call(members())).data.members;assert.equal(list.find(row=>row.id==='intern-a').status,'active');assert.equal(list.find(row=>row.id==='assistant-a').status,'disabled');assert.equal((await f.stop()).status,200);assert.equal((await f.stop('assistant-a')).status,409);
});
test('owner can finish a revoked administrator and act after its team is disabled',async t=>{
 const f=await fixture(t);f.run("UPDATE team_operators SET status='revoked' WHERE user_id='administrator-a'");f.run("UPDATE teams SET status='disabled' WHERE team_id='team-a'");const listed=await f.call(ADMINS,{actor:'access-owner'});assert.equal(listed.data.members.find(row=>row.id==='administrator-a').status,'active');assert.equal((await f.call(members())).status,404);const result=await f.stop('administrator-a',{actor:'access-owner',kind:'administrators'});assert.equal(result.status,200,result.raw);assert.equal(f.db.prepare("SELECT status FROM team_users WHERE user_id='administrator-a'").get().status,'disabled');assert.equal((await f.call('/api/auth/session')).status,401);
});
test('search is literal and eligibility is applied before cursor and pagination',async t=>{
 const f=await fixture(t);f.add('literal',{role:'intern',name:'Member %_\\ literal'});f.add('plain',{role:'intern',name:'Plain member'});assert.deepEqual((await f.call(members()+'?q='+encodeURIComponent('%_\\'))).data.members.map(row=>row.id),['literal']);for(const query of ['?after=intern-b','?after=access-owner','?after=missing','?q=Plain&after=literal'])assert.equal((await f.call(members()+query)).status,404,query);
 const first=(await f.call(members()+'?limit=1')).data;assert.equal(first.members.length,1);assert.equal(first.hasMore,true);const next=(await f.call(members()+'?limit=50&after='+first.members[0].id)).data;assert.equal(new Set([...first.members,...next.members].map(row=>row.id)).size,6);assert.equal(next.hasMore,false);
});
test('pages are bounded without cross-team totals and unsafe names are projected as text',async t=>{
 const f=await fixture(t);for(let i=0;i<52;i++)f.add('collector-'+String(i).padStart(2,'0'),{role:'intern'});f.run("UPDATE team_credentials SET display_name=? WHERE user_id='assistant-a'",'\u200f\n'+ '名'.repeat(90));const page=await f.call(members()+'?limit=50');assert.equal(page.data.members.length,50);assert.equal(page.data.hasMore,true);assert.deepEqual(Object.keys(page.data).sort(),['hasMore','members']);assert.equal([...page.data.members.find(row=>row.id==='assistant-a').displayName].length,80);assert.equal(f.db.prepare("SELECT display_name FROM team_credentials WHERE user_id='assistant-a'").get().display_name.startsWith('\u200f\n'),true);
});
test('query grammar and exact body keys reject identity injection and unsafe revisions',async t=>{
 const f=await fixture(t);for(const query of ['?role=partner','?userId=intern-a','?q='+encodeURIComponent('x'.repeat(81)),'?q='+encodeURIComponent('x\n'),'?q='+encodeURIComponent('\u200f'),'?q=a&q=b','?after=','?limit=0','?limit=51','?limit=01'])assert.equal((await f.call(members()+query)).status,400,query);
 for(const revision of [undefined,-1,0.1,'0'])assert.equal((await f.call(disable(),{body:{revision,currentPassword:PASSWORD}})).status,400);
 for(const body of [{revision:f.revision('intern-a'),currentPassword:PASSWORD,userId:'partner-a'},{revision:f.revision('intern-a'),currentPassword:''},{revision:f.revision('intern-a'),currentPassword:'x'.repeat(513)}])assert.equal((await f.call(disable(),{body})).status,400);active(f);
});
test('method restrictions, current bearer and private response headers stay precise',async t=>{
 const f=await fixture(t);for(const [pathname,method,allow] of [[ACCESS,'POST','GET'],[members(),'POST','GET'],[ADMINS,'POST','GET'],[disable(),'GET','POST']]){const r=await f.call(pathname,{method});assert.equal(r.status,405);assert.equal(r.headers.get('Allow'),allow);}
 const list=await f.call(members());assert.equal(list.headers.get('Cache-Control'),'private, no-store, max-age=0');assert.equal(list.headers.get('Vary'),'Authorization');assert.equal(list.headers.get('X-Content-Type-Options'),'nosniff');assert.equal((await f.call(members(),{headers:{Authorization:'Bearer bad'}})).status,401);assert.equal((await f.call(members(),{headers:{Origin:'https://untrusted.example.invalid'}})).status,403);
});
test('task revocation increments every affected active assignment once and preserves frozen originals and history',async t=>{
 const f=await fixture(t),bytes=Buffer.from('Immutable synthetic original\0\r\n');const upload=await f.call('/api/teams/team-a/collection/tasks/task-a/submissions',{actor:'intern-a',body:{filename:'original.txt',contentBase64:bytes.toString('base64'),revision:0}});assert.equal(upload.status,201);f.run("UPDATE team_projects SET status='frozen' WHERE team_id='team-a'");f.run("INSERT INTO team_task_assignments VALUES ('team-a','task-assistant','intern-a','active')");f.run("INSERT INTO team_task_versions VALUES ('team-a','task-assistant',9)");const before=f.revision('intern-a');assert.equal((await f.stop()).status,200);
 assert.deepEqual(f.db.prepare("SELECT task_id,revision FROM team_task_versions WHERE team_id='team-a' ORDER BY task_id").all().map(row=>({...row})),[{task_id:'task-a',revision:2},{task_id:'task-assistant',revision:10}]);assert.equal(f.db.prepare("SELECT status FROM team_collection_tasks WHERE team_id='team-a' AND task_id='task-a'").get().status,'submitted');assert.equal(f.db.prepare("SELECT status FROM team_projects WHERE team_id='team-a'").get().status,'frozen');assert.deepEqual(Buffer.from(f.db.prepare('SELECT bytes FROM team_collection_attachments WHERE attachment_id=?').get(upload.data.submission.attachmentId).bytes),bytes);assert.equal(f.db.prepare('SELECT content_sha256 FROM team_task_submissions WHERE attachment_id=?').get(upload.data.submission.attachmentId).content_sha256,hash(bytes));
 const event=f.db.prepare('SELECT * FROM team_member_access_events').get();assert.deepEqual(Object.keys(event).sort(),['actor_id','before_revision','created_at','event_id','target_kind','target_user_id','team_id']);assert.equal(event.before_revision,before);assert.equal(event.target_kind,'business');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_activity').get().n,1);assert.equal(f.db.prepare("SELECT status FROM team_attachment_grants WHERE user_id='intern-a'").get().status,'revoked');
});
for(const version of [Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,1.5])test('unsafe task revision '+version+' rejects the entire deactivation',async t=>{
 const f=await fixture(t);f.run("INSERT INTO team_task_versions VALUES ('team-a','task-a',?)",version);
 const state={epoch:f.revision('intern-a'),sessions:f.db.prepare("SELECT revoked_at FROM team_sessions WHERE user_id='intern-a'").all()};assert.equal((await f.stop()).status,409);active(f);assert.equal(f.revision('intern-a'),state.epoch);assert.deepEqual(f.db.prepare("SELECT revoked_at FROM team_sessions WHERE user_id='intern-a'").all(),state.sessions);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_member_access_events').get().n,0);
});
test('target identity ceiling rejects overflow and permits the final safe multi-trigger transition',async t=>{
 const f=await fixture(t);f.run("UPDATE team_recovery_identity_epochs SET version=? WHERE user_id='intern-a'",Number.MAX_SAFE_INTEGER-2);assert.equal((await f.stop()).status,409);active(f);f.run("UPDATE team_recovery_identity_epochs SET version=? WHERE user_id='intern-a'",Number.MAX_SAFE_INTEGER-3);assert.equal((await f.stop()).status,200);assert.equal(f.revision('intern-a'),Number.MAX_SAFE_INTEGER);
});
test('audit failure rolls back account, memberships, sessions, assignments, epochs and task versions',async t=>{
 const f=await fixture(t),before=businessState(f);f.db.exec("CREATE TRIGGER member_audit_abort BEFORE INSERT ON team_member_access_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");const result=await f.stop();assert.equal(result.status,503);assert.deepEqual(businessState(f),before);assert.equal((await f.call('/api/auth/session',{actor:'intern-a'})).status,200);
});
test('concurrent requests can disable a target only once and record one event',async t=>{
 const f=await fixture(t),version=f.revision('intern-a');const results=await Promise.all([f.stop('intern-a',{version}),f.stop('intern-a',{version})]);assert.deepEqual(results.map(row=>row.status).sort(),[200,409]);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_member_access_events').get().n,1);assert.equal(f.db.prepare("SELECT revision FROM team_task_versions WHERE team_id='team-a' AND task_id='task-a'").get().revision,1);
});
test('body-read actor and target ABA changes invalidate the request rather than adopting fresh authority',{timeout:5000},async t=>{
 const f=await fixture(t),version=f.revision('intern-a'),pending=f.stream();await pending.reading;f.run("UPDATE team_operators SET status='revoked' WHERE user_id='administrator-a'");f.run("UPDATE team_operators SET status='active' WHERE user_id='administrator-a'");pending.finish({revision:version,currentPassword:PASSWORD});assert.equal((await pending.pending).status,409);active(f);
 const second=f.stream();await second.reading;f.run("UPDATE team_memberships SET status='disabled' WHERE user_id='intern-a'");f.run("UPDATE team_memberships SET status='active' WHERE user_id='intern-a'");second.finish({revision:version,currentPassword:PASSWORD});assert.equal((await second.pending).status,409);active(f);
});
test('owner ACL default and three triggers add ABA history without editing old epoch triggers',async t=>{
 const f=await fixture(t),id='access-owner',before=f.revision(id);assert.equal(f.db.prepare('SELECT revision FROM team_access_reviewers WHERE user_id=?').get(id).revision,1);f.run("UPDATE team_access_reviewers SET status='revoked' WHERE user_id=?",id);f.run("UPDATE team_access_reviewers SET status='active' WHERE user_id=?",id);assert.equal(f.revision(id),before+4);f.run('DELETE FROM team_access_reviewers WHERE user_id=?',id);f.run("INSERT INTO team_access_reviewers(user_id,permission,status) VALUES (?,'member.disable','active')",id);assert.equal(f.revision(id),before+6);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='trigger' AND name LIKE 'member_access_epoch_%'").get().n,3);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='trigger' AND name LIKE 'recovery_epoch_%'").get().n,20);
});
test('deactivation terminates all three invitation sources and known in-flight identity flows while retaining accepted history and mappings',async t=>{
 const f=await fixture(t),id='administrator-a',phone='+8613800000011';
 f.run("INSERT INTO team_memberships VALUES ('team-a',?,'manager','active')",id);f.run("INSERT INTO team_admin_grants VALUES ('team-a',?,'member.invite','active')",id);
 f.add('other-administrator',{operator:true});f.run('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)',id,phone,NOW-1000);
 f.run("INSERT INTO team_wechat_identities VALUES ('synthetic-app','synthetic-open',?,?)",id,NOW-1000);
 f.run("INSERT INTO team_recovery_reviewers VALUES ('access-owner','account.recover','active',1)");
 for(const [key,issuer,accepted] of [['own-unused',id,null],['own-accepted',id,NOW-100],['other-unused','partner-a',null]])f.run('INSERT INTO team_invitations VALUES (?,?,?,?,?,?,?)',hash(key),'team-a','invitee-a','intern',issuer,NOW+60_000,accepted);
 for(const [table,challenges,other] of [['team_employee_invitations','team_employee_activation_challenges','partner-a'],['team_operator_employee_invitations','team_operator_employee_activation_challenges','other-administrator']]){
  for(const [suffix,issuer,accepted] of [['own-unused',id,null],['own-accepted',id,NOW-100],['other-unused',other,null]]){
   const key=table+'-'+suffix,tokenHash=hash(key);f.run(`INSERT INTO ${table}(invitation_id,token_hash,team_id,phone,role,invited_by,created_at,expires_at,accepted_at,accepted_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,key,tokenHash,'team-a',phone,'intern',issuer,NOW-1000,NOW+60_000,accepted,accepted?'intern-a':null);
   f.run(`INSERT INTO ${challenges}(challenge_id,invitation_id,invitation_hash,purpose,phone,code_mac,expires_at,consumed_at,delivery_state) VALUES (?,?,?,'activate',?,?,?,?, 'sent')`,key+'-challenge',key,tokenHash,phone,'0'.repeat(64),NOW+60_000,accepted);
  }
 }
 for(const [key,user,consumed] of [['pending',id,null],['approved',id,null],['consumed',id,NOW-100],['other','intern-a',null],['unknown',null,null]])f.run(`INSERT INTO team_phone_challenges(challenge_id,purpose,phone,user_id,credential_revision,code_mac,expires_at,consumed_at,delivery_state) VALUES (?,'reset',?,?,1,?,?,?,'sent')`,key,phone,user,'0'.repeat(64),NOW+60_000,consumed);
 const {recoveryTarget,recoveryAuthority,validateReviewedRecovery}=await source('recovery-review-policy.mjs'),identity=recoveryTarget(f.db,id,NOW);assert.equal(identity.kind,'administrator');
 const proof=createHash('sha256').update('synthetic-approved-recovery-proof').digest('base64url');
 for(const status of ['pending','approved','consumed']){
  f.run(`INSERT INTO team_recovery_requests(request_id,challenge_id,target_user_id,team_id,target_kind,target_stamp,status,created_at,expires_at,approved_by,token_hash) VALUES (?,?,?,'team-a','administrator',?,?,?,?,?,?)`,status,status,id,identity.stamp,status,NOW-1000,NOW+60_000,status==='approved'?'access-owner':null,status==='approved'?hash(proof):null);
  if(status==='approved'){const row=f.db.prepare('SELECT * FROM team_recovery_requests WHERE request_id=?').get(status),authority=recoveryAuthority(f.db,'access-owner',row,NOW);assert.ok(authority);f.run('UPDATE team_recovery_requests SET approval_stamp=? WHERE request_id=?',authority.stamp,status);}
 }
 assert.equal(validateReviewedRecovery(f.db,id,'approved',proof,NOW).status,'approved');
 for(const [key,user,status] of [['own-ready',id,'ready'],['other-ready','intern-a','ready'],['unknown-pending',null,'pending']])f.run('INSERT INTO team_wechat_transactions(transaction_id,state_hash,poll_hash,code_challenge,app_id,redirect_uri,status,expires_at,user_id,credential_revision) VALUES (?,?,?,?,?,?,?,?,?,1)',key,hash(key),hash('poll:'+key),'synthetic-challenge','synthetic-app','https://synthetic.example.invalid/callback',status,NOW+60_000,user);
 const mappings={credentials:f.db.prepare('SELECT * FROM team_credentials WHERE user_id=?').get(id),phone:f.db.prepare('SELECT * FROM team_phone_credentials WHERE user_id=?').get(id),wechat:f.db.prepare('SELECT * FROM team_wechat_identities WHERE user_id=?').all(id)};
 const stopped=await f.stop(id,{actor:'access-owner',kind:'administrators'});assert.equal(stopped.status,200,stopped.raw);
 assert.equal(f.db.prepare('SELECT expires_at FROM team_invitations WHERE token_hash=?').get(hash('own-unused')).expires_at,NOW);for(const key of ['own-accepted','other-unused'])assert.equal(f.db.prepare('SELECT expires_at FROM team_invitations WHERE token_hash=?').get(hash(key)).expires_at,NOW+60_000);
 for(const [table,challenges] of [['team_employee_invitations','team_employee_activation_challenges'],['team_operator_employee_invitations','team_operator_employee_activation_challenges']]){
  assert.equal(f.db.prepare(`SELECT revoked_at FROM ${table} WHERE invitation_id=?`).get(table+'-own-unused').revoked_at,NOW);assert.equal(f.db.prepare(`SELECT delivery_state FROM ${challenges} WHERE challenge_id=?`).get(table+'-own-unused-challenge').delivery_state,'failed');
  for(const suffix of ['own-accepted','other-unused']){assert.equal(f.db.prepare(`SELECT revoked_at FROM ${table} WHERE invitation_id=?`).get(table+'-'+suffix).revoked_at,null);assert.equal(f.db.prepare(`SELECT delivery_state FROM ${challenges} WHERE challenge_id=?`).get(table+'-'+suffix+'-challenge').delivery_state,'sent');}
 }
 for(const status of ['pending','approved']){assert.equal(f.db.prepare('SELECT status FROM team_recovery_requests WHERE request_id=?').get(status).status,'revoked');assert.equal(f.db.prepare('SELECT consumed_at FROM team_phone_challenges WHERE challenge_id=?').get(status).consumed_at,NOW);}
 assert.throws(()=>validateReviewedRecovery(f.db,id,'approved',proof,NOW));assert.equal(f.db.prepare("SELECT status FROM team_recovery_requests WHERE request_id='consumed'").get().status,'consumed');assert.equal(f.db.prepare("SELECT consumed_at FROM team_phone_challenges WHERE challenge_id='consumed'").get().consumed_at,NOW-100);for(const key of ['other','unknown'])assert.equal(f.db.prepare('SELECT consumed_at FROM team_phone_challenges WHERE challenge_id=?').get(key).consumed_at,null);
 assert.deepEqual(f.db.prepare('SELECT transaction_id,status FROM team_wechat_transactions ORDER BY transaction_id').all().map(row=>({...row})),[{transaction_id:'other-ready',status:'ready'},{transaction_id:'own-ready',status:'canceled'},{transaction_id:'unknown-pending',status:'pending'}]);
 assert.deepEqual({credentials:f.db.prepare('SELECT * FROM team_credentials WHERE user_id=?').get(id),phone:f.db.prepare('SELECT * FROM team_phone_credentials WHERE user_id=?').get(id),wechat:f.db.prepare('SELECT * FROM team_wechat_identities WHERE user_id=?').all(id)},mappings);assert.equal((await f.call('/api/auth/session',{actor:id})).status,401);assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
