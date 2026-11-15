'use strict';
// Independent adversarial acceptance: real isolated SQLite and application APIs.
// Sessions are explicitly issued synthetic fixtures; these are not login, native
// UI, real SMS, device, customer-data or production acceptance tests.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const ORIGIN='http://127.0.0.1:8774',NOW=Date.parse('2026-11-15T10:00:00Z');
const TASK='/api/teams/team-a/collection/tasks/task-a',digest=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
let baseline;
async function fixture(t){
 baseline||=(async()=>{const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');const db=new DatabaseSync(':memory:');try{initializeTeamDatabase(db);await seedDemoTeamData(db);return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM '+quote(name)).all()}));}finally{db.close();}})();
 const {initializeTeamDatabase}=await source('database.mjs'),{issueSession}=await source('auth-api.mjs'),{handleTeamApplicationRequest}=await source('application-api.mjs');
 const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);db.exec('BEGIN;PRAGMA defer_foreign_keys=ON;');try{for(const {name,rows} of await baseline)for(const row of rows){const keys=Object.keys(row);db.prepare('INSERT OR REPLACE INTO '+quote(name)+'('+keys.map(quote).join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row));}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');db.close();throw error;}t.after(()=>db.close());
 const tokens={};for(const id of ['intern-a','assistant-a','manager-a','partner-a','intern-b','manager-b','invitee-a'])tokens[id]=issueSession(db,id,NOW).token;
 async function send(request){const response=await handleTeamApplicationRequest(request,{db,now:()=>NOW}),raw=await response.text();return {status:response.status,data:(response.headers.get('content-type')||'').startsWith('application/json')?JSON.parse(raw):null,raw,headers:response.headers};}
 const call=(route,actor='manager-a',body,method=body===undefined?'GET':'POST')=>send(new Request(ORIGIN+route,{method,headers:{'Content-Type':'application/json',...(actor?{Authorization:'Bearer '+(tokens[actor]||actor)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 function stream(route,actor){let controller,read;const reading=new Promise(resolve=>read=resolve),body=new ReadableStream({start(value){controller=value;},pull(){read();}},{highWaterMark:0});return {reading,pending:send(new Request(ORIGIN+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tokens[actor]},body,duplex:'half'})),finish(value){controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));controller.close();}};}
 return {db,tokens,call,stream};
}
const upload=(revision=0,text='synthetic original\r\n原件\0')=>({revision,filename:'合成资料.txt',contentBase64:Buffer.from(text).toString('base64')});
async function submit(f,revision=0,actor='intern-a',text){const r=await f.call(TASK+'/submissions',actor,upload(revision,text));assert.equal(r.status,201,r.raw);return r.data;}
function business(f){return ['team_task_assignments','team_task_versions','team_collection_tasks','team_collection_attachments','team_task_submissions','team_attachment_grants','team_activity'].map(name=>({name,rows:f.db.prepare('SELECT * FROM '+quote(name)).all()}));}
function beforeTransaction(t,db,action){const original=db.exec;let hit=false;db.exec=function(sql){if(!hit&&/^BEGIN IMMEDIATE/.test(sql)){hit=true;action();}return original.call(this,sql);};t.after(()=>{db.exec=original;});return ()=>hit;}
function member(f,id,displayName,team='team-a',role='intern',status='active'){
 f.db.prepare('INSERT INTO team_users VALUES (?,?)').run(id,status);const hash=f.db.prepare("SELECT password_hash FROM team_credentials WHERE user_id='intern-a'").get().password_hash;f.db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(id,id,displayName,hash);f.db.prepare('INSERT INTO team_memberships VALUES (?,?,?,?)').run(team,id,role,'active');
}
function privateError(r){assert.ok(!r.raw.includes('password_hash'));assert.ok(!r.raw.includes('token_hash'));assert.ok(!r.raw.includes('SELECT '));assert.ok(!r.raw.includes('synthetic injected'));assert.match(r.headers.get('cache-control')||'',/no-store/);}

test('low roles see only false management capability and no assignee metadata even with mistaken manage grants',async t=>{
 const f=await fixture(t);f.db.prepare("INSERT INTO team_task_assignments VALUES ('team-a','task-a','assistant-a','active')").run();
 for(const actor of ['intern-a','assistant-a']){for(const permission of ['collection.read','collection.manage'])f.db.prepare("INSERT INTO team_project_grants VALUES ('team-a','project-a',?,?,'active')").run(actor,permission);assert.deepEqual((await f.call(TASK+'/management',actor)).data,{canManage:false});for(const route of ['/assignees','/assignment','/return']){const r=await f.call(TASK+route,actor,route==='/assignees'?undefined:route==='/assignment'?{userId:'assistant-a',revision:0}:{revision:0});assert.equal(r.status,404,r.raw);privateError(r);}}
});
test('technical operator without audit membership cannot read or manage tasks or obtain employee picker data',async t=>{
 const f=await fixture(t);f.db.prepare("INSERT INTO team_operators VALUES ('team-a','invitee-a','administrator','active')").run();
 for(const route of ['', '/management','/assignees'])assert.equal((await f.call(TASK+route,'invitee-a')).status,404);assert.equal((await f.call(TASK+'/assignment','invitee-a',{userId:'intern-a',revision:0})).status,404);assert.equal((await f.call(TASK+'/return','invitee-a',{revision:0})).status,404);
});
test('manager and partner need readable task plus the exact project management grant',async t=>{
 const f=await fixture(t);for(const actor of ['manager-a','partner-a'])assert.equal((await f.call(TASK+'/management',actor)).data.canManage,true);
 f.db.prepare("UPDATE team_project_grants SET status='revoked' WHERE user_id='manager-a' AND permission='collection.read'").run();assert.equal((await f.call(TASK+'/management')).status,404);assert.equal((await f.call(TASK+'/assignees')).status,404);
 f.db.prepare("INSERT INTO team_task_assignments VALUES ('team-a','task-a','manager-a','active')").run();assert.equal((await f.call(TASK+'/management')).data.canManage,true,'explicit task assignment remains a legitimate read scope');
 f.db.prepare("UPDATE team_project_grants SET status='revoked' WHERE user_id='manager-a' AND permission='collection.manage'").run();assert.deepEqual((await f.call(TASK+'/management')).data,{canManage:false});assert.equal((await f.call(TASK+'/assignees')).status,404);
});
test('unrelated project management grants never authorize the selected task',async t=>{
 const f=await fixture(t);f.db.prepare("UPDATE team_project_grants SET status='revoked' WHERE user_id='manager-a' AND permission='collection.manage'").run();f.db.prepare("INSERT INTO team_projects(team_id,project_id,title,status) VALUES ('team-a','other-project','合成其他项目','active')").run();f.db.prepare("INSERT INTO team_project_grants VALUES ('team-a','other-project','manager-a','collection.manage','active')").run();assert.deepEqual((await f.call(TASK+'/management')).data,{canManage:false});assert.equal((await f.call(TASK+'/assignees')).status,404);
});
test('cross-team and unknown task management endpoints use the same private refusal',async t=>{
 const f=await fixture(t);for(const suffix of ['/management','/assignees']){const foreign=await f.call('/api/teams/team-b/collection/tasks/task-a'+suffix),unknown=await f.call('/api/teams/team-a/collection/tasks/missing'+suffix);assert.equal(foreign.status,404);assert.equal(unknown.status,404);privateError(foreign);privateError(unknown);}
});
test('management DTO contains only capability, task version/status and minimum assignee fields',async t=>{
 const f=await fixture(t),r=await f.call(TASK+'/management');assert.equal(r.status,200,r.raw);assert.deepEqual(Object.keys(r.data).sort(),['assignees','canManage','hasMoreAssignees','revision','status'].sort());assert.equal(r.data.revision,0);assert.equal(r.data.status,'open');assert.deepEqual(r.data.assignees,[{id:'intern-a',displayName:'intern-a',role:'intern'}]);assert.equal(r.data.hasMoreAssignees,false);privateError(r);assert.ok(!r.raw.includes('phone'));
});
test('frozen and closed tasks do not expose operative capability or permit management writes',async t=>{
 const f=await fixture(t);f.db.prepare("UPDATE team_projects SET status='frozen' WHERE team_id='team-a'").run();assert.deepEqual((await f.call(TASK+'/management')).data,{canManage:false});assert.ok([404,409].includes((await f.call(TASK+'/assignees')).status));for(const suffix of ['/assignment','/return'])assert.ok([404,409].includes((await f.call(TASK+suffix,'manager-a',suffix==='/assignment'?{userId:'assistant-a',revision:0}:{revision:0})).status));
 f.db.prepare("UPDATE team_projects SET status='active' WHERE team_id='team-a'").run();f.db.prepare("UPDATE team_collection_tasks SET status='closed' WHERE team_id='team-a' AND task_id='task-a'").run();assert.deepEqual((await f.call(TASK+'/management')).data,{canManage:false});assert.equal((await f.call(TASK+'/assignment','manager-a',{userId:'assistant-a',revision:0})).status,409);assert.equal((await f.call(TASK+'/return','manager-a',{revision:0})).status,409);
});
test('candidate search treats percent, underscore and backslash literally instead of wildcard authority expansion',async t=>{
 const f=await fixture(t);for(const [id,name] of [['member-percent','Literal%staff'],['member-underscore','Literal_staff'],['member-backslash','Literal\\staff'],['member-ordinary','Literal ordinary']])member(f,id,name);
 for(const [q,id] of [['%','member-percent'],['_','member-underscore'],['\\','member-backslash']]){const r=await f.call(TASK+'/assignees?q='+encodeURIComponent(q));assert.equal(r.status,200,r.raw);assert.deepEqual(r.data.members.map(item=>item.id),[id]);assert.equal(r.data.hasMore,false);}
 const sql=await f.call(TASK+'/assignees?q='+encodeURIComponent("' OR 1=1 --"));assert.equal(sql.status,200);assert.deepEqual(sql.data.members,[]);
});
test('candidate filtering and cursor authorization precede pagination and omit disabled or other-team accounts',async t=>{
 const f=await fixture(t);for(const id of ['a-candidate','z-candidate'])member(f,id,'Needle '+id);member(f,'a-foreign','Needle foreign','team-b');member(f,'a-disabled','Needle disabled','team-a','intern','disabled');f.db.prepare("UPDATE team_memberships SET status='disabled' WHERE user_id='assistant-a'").run();
 const first=await f.call(TASK+'/assignees?q=Needle&limit=1');assert.equal(first.status,200,first.raw);assert.deepEqual(first.data.members,[{id:'a-candidate',displayName:'Needle a-candidate',role:'intern'}]);assert.equal(first.data.hasMore,true);
 const second=await f.call(TASK+'/assignees?q=Needle&limit=1&after=a-candidate');assert.deepEqual(second.data.members.map(item=>item.id),['z-candidate']);assert.equal(second.data.hasMore,false);
 for(const after of ['a-foreign','a-disabled','assistant-a','intern-b','not-present','intern-a']){const r=await f.call(TASK+'/assignees?q=Needle&after='+after);assert.equal(r.status,404,r.raw);privateError(r);}
});
test('candidate result and current assignment pages are bounded without leaking counts or private fields',async t=>{
 const f=await fixture(t);for(let i=0;i<52;i++){const id='many-'+String(i).padStart(3,'0');member(f,id,'多人 '+i);f.db.prepare("INSERT INTO team_task_assignments VALUES ('team-a','task-a',?,'active')").run(id);}
 const list=await f.call(TASK+'/assignees?limit=50');assert.equal(list.status,200);assert.equal(list.data.members.length,50);assert.equal(list.data.hasMore,true);assert.deepEqual(Object.keys(list.data).sort(),['hasMore','members']);for(const m of list.data.members)assert.deepEqual(Object.keys(m).sort(),['displayName','id','role']);
 const management=await f.call(TASK+'/management');assert.equal(management.data.assignees.length,50);assert.equal(management.data.hasMoreAssignees,true);
});
test('the confirmed picker and new assignments admit only active intern and assistant members',async t=>{
 const f=await fixture(t),r=await f.call(TASK+'/assignees');assert.equal(r.status,200,r.raw);assert.deepEqual(r.data.members.map(item=>item.id).sort(),['assistant-a','intern-a']);
 for(const userId of ['manager-a','partner-a'])assert.equal((await f.call(TASK+'/assignment','manager-a',{userId,revision:0})).status,404);
 // Existing legacy assignment metadata may still describe higher business roles;
 // showing it does not authorize newly assigning another high-role account.
 f.db.prepare("INSERT INTO team_task_assignments VALUES ('team-a','task-a','partner-a','active')").run();const state=await f.call(TASK+'/management');assert.ok(state.data.assignees.some(item=>item.id==='partner-a'&&item.role==='partner'));
});
test('candidate query grammar rejects duplicate parameters, oversized limits and identity injection',async t=>{
 const f=await fixture(t);for(const query of ['limit=0','limit=51','limit=1&limit=2','q=a&q=b','after=x&after=y','userId=intern-b','role=partner','q='+encodeURIComponent('x'.repeat(81)),'q='+encodeURIComponent('a\nb')])assert.equal((await f.call(TASK+'/assignees?'+query)).status,400,query);
});
test('management writes require exact nonnegative versions and cannot use a legacy unversioned path',async t=>{
 const f=await fixture(t);await submit(f);const before=business(f);for(const body of [{},{revision:-1},{revision:'1'},{revision:1.5},{revision:Number.MAX_SAFE_INTEGER},{revision:1,role:'partner'},{revision:1,userId:'intern-b'}])assert.equal((await f.call(TASK+'/return','manager-a',body)).status,400);for(const body of [{userId:'assistant-a'},{userId:'assistant-a',revision:-1},{userId:'assistant-a',revision:Number.MAX_SAFE_INTEGER},{userId:'assistant-a',revision:1,approved:true}])assert.equal((await f.call(TASK+'/assignment','manager-a',body)).status,400);assert.deepEqual(business(f),before);
});
test('stale task versions cannot return or reassign a newer submission',async t=>{
 const f=await fixture(t);await submit(f);const before=business(f);assert.equal((await f.call(TASK+'/return','manager-a',{revision:0})).status,409);assert.equal((await f.call(TASK+'/assignment','manager-a',{userId:'assistant-a',revision:0})).status,409);assert.deepEqual(business(f),before);
});
test('concurrent returns commit once and preserve a single version and audit transition',async t=>{
 const f=await fixture(t);await submit(f);const results=await Promise.all([f.call(TASK+'/return','manager-a',{revision:1}),f.call(TASK+'/return','partner-a',{revision:1})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.db.prepare("SELECT revision FROM team_task_versions WHERE team_id='team-a' AND task_id='task-a'").get().revision,2);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_activity WHERE action='task.returned'").get().n,1);
});
test('concurrent assignments cannot silently overwrite a different manager choice',async t=>{
 const f=await fixture(t);const results=await Promise.all([f.call(TASK+'/assignment','manager-a',{userId:'assistant-a',revision:0}),f.call(TASK+'/assignment','partner-a',{userId:'intern-a',revision:0})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_task_assignments WHERE team_id='team-a' AND task_id='task-a' AND status='active'").get().n,1);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_activity WHERE action='task.assigned'").get().n,1);
});
test('return and resubmission preserve old original bytes, hashes and history without giving manager access',async t=>{
 const f=await fixture(t),first=await submit(f,0,'intern-a','first original\0'),old=f.db.prepare('SELECT * FROM team_collection_attachments WHERE attachment_id=?').get(first.submission.attachmentId);assert.equal((await f.call(TASK+'/return','manager-a',{revision:1})).status,200);await submit(f,2,'intern-a','second original\0');assert.deepEqual(f.db.prepare('SELECT * FROM team_collection_attachments WHERE attachment_id=?').get(first.submission.attachmentId),old);const own=await f.call(TASK+'/submissions','intern-a');assert.equal(own.data.submissions.length,2);assert.equal(own.data.submissions.find(item=>item.id===first.submission.id).sha256,digest(Buffer.from('first original\0')));assert.deepEqual((await f.call(TASK+'/submissions')).data.submissions,[]);assert.equal((await f.call(TASK+'/attachments/'+first.submission.attachmentId)).status,404);assert.equal((await f.call(TASK+'/return','manager-a',{revision:1})).status,409);
});
test('reassignment revokes old collector access but gives the new collector no old attachment grants or history',async t=>{
 const f=await fixture(t),first=await submit(f),original=f.db.prepare('SELECT * FROM team_task_submissions WHERE submission_id=?').get(first.submission.id),file=f.db.prepare('SELECT * FROM team_collection_attachments WHERE attachment_id=?').get(first.submission.attachmentId);const assigned=await f.call(TASK+'/assignment','manager-a',{userId:'assistant-a',revision:1});assert.equal(assigned.status,200,assigned.raw);assert.equal(assigned.data.revision,2);
 for(const suffix of ['', '/submissions','/attachments/'+first.submission.attachmentId])assert.equal((await f.call(TASK+suffix,'intern-a')).status,404);assert.equal((await f.call(TASK,'assistant-a')).status,200);assert.deepEqual((await f.call(TASK+'/submissions','assistant-a')).data.submissions,[]);assert.equal((await f.call(TASK+'/attachments/'+first.submission.attachmentId,'assistant-a')).status,404);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_attachment_grants WHERE user_id=? AND attachment_id=?').get('assistant-a',first.submission.attachmentId).n,0);assert.deepEqual(f.db.prepare('SELECT * FROM team_task_submissions WHERE submission_id=?').get(first.submission.id),original);assert.deepEqual(f.db.prepare('SELECT * FROM team_collection_attachments WHERE attachment_id=?').get(first.submission.attachmentId),file);
});
test('assignment cannot target foreign, disabled, missing or technical-only identities',async t=>{
 const f=await fixture(t);f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='assistant-a'").run();f.db.prepare("INSERT INTO team_operators VALUES ('team-a','invitee-a','administrator','active')").run();const before=business(f);for(const userId of ['intern-b','assistant-a','missing-user','invitee-a']){const r=await f.call(TASK+'/assignment','manager-a',{userId,revision:0});assert.equal(r.status,404,r.raw);privateError(r);}assert.deepEqual(business(f),before);
});
test('assignment audit failure rolls back assignments and task version without exposing SQL',async t=>{
 const f=await fixture(t),before=business(f);f.db.exec("CREATE TRIGGER management_audit_fail BEFORE INSERT ON team_activity BEGIN SELECT RAISE(ABORT,'synthetic injected assignment failure'); END");const r=await f.call(TASK+'/assignment','manager-a',{userId:'assistant-a',revision:0});assert.equal(r.status,503);privateError(r);assert.deepEqual(business(f),before);
});
test('return audit failure rolls back task status and version together',async t=>{
 const f=await fixture(t);await submit(f);const before=business(f);f.db.exec("CREATE TRIGGER management_audit_fail BEFORE INSERT ON team_activity BEGIN SELECT RAISE(ABORT,'synthetic injected return failure'); END");const r=await f.call(TASK+'/return','manager-a',{revision:1});assert.equal(r.status,503);privateError(r);assert.deepEqual(business(f),before);
});
test('streamed return rechecks management grant after body read',async t=>{
 const f=await fixture(t);await submit(f);const before=business(f),pending=f.stream(TASK+'/return','manager-a');await pending.reading;f.db.prepare("UPDATE team_project_grants SET status='revoked' WHERE user_id='manager-a' AND permission='collection.manage'").run();pending.finish({revision:1});assert.equal((await pending.pending).status,404);assert.deepEqual(business(f),before);
});
test('streamed assignment cannot switch to another authorized actor behind the same bearer',async t=>{
 const f=await fixture(t),before=business(f),pending=f.stream(TASK+'/assignment','manager-a');await pending.reading;f.db.prepare("UPDATE team_sessions SET user_id='partner-a' WHERE token_hash=?").run(digest(f.tokens['manager-a']));pending.finish({userId:'assistant-a',revision:0});assert.equal((await pending.pending).status,404);assert.deepEqual(business(f),before);
});
test('streamed upload cannot switch authors even when the second identity is independently assigned',async t=>{
 const f=await fixture(t);f.db.prepare("INSERT INTO team_task_assignments VALUES ('team-a','task-a','assistant-a','active')").run();const before=business(f),pending=f.stream(TASK+'/submissions','intern-a');await pending.reading;f.db.prepare("UPDATE team_sessions SET user_id='assistant-a' WHERE token_hash=?").run(digest(f.tokens['intern-a']));pending.finish(upload());assert.equal((await pending.pending).status,404);assert.deepEqual(business(f),before);
});
test('streamed assignment rechecks target membership and account state',async t=>{
 const f=await fixture(t),before=business(f),pending=f.stream(TASK+'/assignment','manager-a');await pending.reading;f.db.prepare("UPDATE team_memberships SET status='disabled' WHERE user_id='assistant-a'").run();pending.finish({userId:'assistant-a',revision:0});assert.equal((await pending.pending).status,404);assert.deepEqual(business(f),before);
});
test('streamed return rejects a project frozen while the request body was pending',async t=>{
 const f=await fixture(t);await submit(f);const before=business(f),pending=f.stream(TASK+'/return','manager-a');await pending.reading;f.db.prepare("UPDATE team_projects SET status='frozen' WHERE team_id='team-a'").run();pending.finish({revision:1});assert.equal((await pending.pending).status,409);assert.deepEqual(business(f),before);
});
test('transaction rechecks the version after a concurrent update at its boundary',async t=>{
 const f=await fixture(t),hit=beforeTransaction(t,f.db,()=>f.db.prepare("INSERT INTO team_task_versions VALUES ('team-a','task-a',1)").run());const r=await f.call(TASK+'/assignment','manager-a',{userId:'assistant-a',revision:0});assert.equal(hit(),true);assert.equal(r.status,409,r.raw);assert.equal(f.db.prepare("SELECT revision FROM team_task_versions WHERE team_id='team-a' AND task_id='task-a'").get().revision,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_activity').get().n,0);assert.deepEqual(f.db.prepare("SELECT user_id FROM team_task_assignments WHERE team_id='team-a' AND task_id='task-a' AND status='active'").all().map(r=>r.user_id),['intern-a']);
});
test('transaction rechecks authority rather than retaining the pre-body grant decision',async t=>{
 const f=await fixture(t),before=business(f),hit=beforeTransaction(t,f.db,()=>f.db.prepare("UPDATE team_project_grants SET status='revoked' WHERE user_id='manager-a' AND permission='collection.manage'").run());const r=await f.call(TASK+'/assignment','manager-a',{userId:'assistant-a',revision:0});assert.equal(hit(),true);assert.equal(r.status,404);assert.deepEqual(business(f),before);
});
