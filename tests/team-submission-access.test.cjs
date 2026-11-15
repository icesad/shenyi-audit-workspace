'use strict';
// Every assertion exercises the application boundary against isolated real SQLite.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{DatabaseSync}=require('node:sqlite');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-15T08:00:00Z'),ORIGIN='http://127.0.0.1:8774';
const route=(action='submission-access',team='team-a',task='task-a')=>'/api/teams/'+team+'/collection/tasks/'+task+'/'+action;
const upload=(revision=0)=>({revision,filename:'合成资料.txt',contentBase64:Buffer.from('synthetic original\0\r\n原件').toString('base64')});
let baseline;
async function fixture(t){
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');
 baseline||=(async()=>{const db=new DatabaseSync(':memory:');try{initializeTeamDatabase(db);await seedDemoTeamData(db);return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name+'"').all()}));}finally{db.close();}})();
 const snapshot=await baseline,db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);
 db.exec('BEGIN;PRAGMA defer_foreign_keys=ON;');
 for(const {name,rows} of snapshot)for(const row of rows){const keys=Object.keys(row);db.prepare('INSERT OR REPLACE INTO "'+name+'"('+keys.map(key=>'"'+key+'"').join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row));}
 db.exec('COMMIT;');
 const {issueSession}=await source('auth-api.mjs'),{handleTeamApplicationRequest}=await source('application-api.mjs'),tokens={};
 for(const user of ['intern-a','assistant-a','manager-a','partner-a','intern-b','manager-b','invitee-a'])tokens[user]=issueSession(db,user,NOW).token;
 const dispatch=async request=>{
  const response=await handleTeamApplicationRequest(request,{db,now:()=>NOW});assert.ok(response,'recognized route');
  const raw=await response.text();for(const secret of ['password_hash','token_hash','SELECT ','synthetic database failure'])assert.equal(raw.includes(secret),false,raw);
  return {status:response.status,data:JSON.parse(raw),raw,headers:response.headers};
 };
 const call=({actor='intern-a',team='team-a',task='task-a',action='submission-access',query='',method,body,headers={},token=tokens[actor]}={})=>dispatch(new Request(ORIGIN+route(action,team,task)+query,{method:method??(body===undefined?'GET':'POST'),headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 const stream=({actor='intern-a'}={})=>{
  let controller,signal;const reading=new Promise(resolve=>signal=resolve);
  const body=new ReadableStream({start(value){controller=value;},pull(){signal();}},{highWaterMark:0});
  const pending=dispatch(new Request(ORIGIN+route('submissions'),{method:'POST',headers:{Authorization:'Bearer '+tokens[actor],'Content-Type':'application/json'},body,duplex:'half'}));
  return {reading,pending,finish(value=upload()){controller.enqueue(Buffer.from(JSON.stringify(value)));controller.close();}};
 };
 const assign=(user='intern-a',status='active')=>db.prepare("INSERT INTO team_task_assignments VALUES ('team-a','task-a',?,?) ON CONFLICT(team_id,task_id,user_id) DO UPDATE SET status=excluded.status").run(user,status);
 const revision=value=>db.prepare("INSERT INTO team_task_versions VALUES ('team-a','task-a',?) ON CONFLICT(team_id,task_id) DO UPDATE SET revision=excluded.revision").run(value);
 const taskStatus=value=>db.prepare("UPDATE team_collection_tasks SET status=? WHERE team_id='team-a' AND task_id='task-a'").run(value);
 const projectStatus=value=>db.prepare("UPDATE team_projects SET status=? WHERE team_id='team-a' AND project_id='project-a'").run(value);
 return {db,tokens,call,stream,assign,revision,taskStatus,projectStatus};
}
function noSubmissions(f){for(const table of ['team_task_submissions','team_activity'])assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);}
function safeDto(result,canSubmit,revision=0){assert.equal(result.status,200,result.raw);assert.deepEqual(result.data,{canSubmit,revision});assert.equal(Number.isSafeInteger(result.data.revision)&&result.data.revision>=0,true);}

test('assigned interns and assistants receive only their current submission capability',async t=>{
 const f=await fixture(t);safeDto(await f.call(),true);safeDto(await f.call({actor:'assistant-a',task:'task-assistant'}),true);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_task_versions').get().n,0);
});
test('explicit read and management grants do not substitute for a personal assignment',async t=>{
 const f=await fixture(t);for(const actor of ['manager-a','partner-a'])safeDto(await f.call({actor}),false);
 f.db.prepare("UPDATE team_project_grants SET status='revoked' WHERE user_id='manager-a' AND permission='collection.manage'").run();safeDto(await f.call({actor:'manager-a'}),false);
});
test('legacy active manager and partner assignments retain their existing upload permission',async t=>{
 const f=await fixture(t);for(const actor of ['manager-a','partner-a']){
  f.assign(actor);f.db.prepare('DELETE FROM team_project_grants WHERE user_id=?').run(actor);safeDto(await f.call({actor}),true,actor==='manager-a'?0:1);
  const r=await f.call({actor,action:'submissions',body:upload(actor==='manager-a'?0:1)});assert.equal(r.status,201,r.raw);f.taskStatus('returned');
 }
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_task_assignments WHERE team_id='team-a' AND task_id='task-a' AND user_id IN ('manager-a','partner-a') AND status='active'").get().n,2);
});
test('technical operators without business membership cannot inspect submission capability',async t=>{
 const f=await fixture(t);f.db.prepare("INSERT INTO team_operators VALUES ('team-a','invitee-a','administrator','active')").run();assert.equal((await f.call({actor:'invitee-a'})).status,404);
 f.db.prepare("INSERT INTO team_memberships VALUES ('team-a','invitee-a','intern','disabled')").run();f.assign('invitee-a');assert.equal((await f.call({actor:'invitee-a'})).status,404);
});
test('junior users do not gain task scope from mistaken project grants or other employees assignments',async t=>{
 const f=await fixture(t);for(const permission of ['collection.read','collection.manage'])f.db.prepare("INSERT INTO team_project_grants VALUES ('team-a','project-a','assistant-a',?,'active')").run(permission);
 assert.equal((await f.call({actor:'assistant-a'})).status,404);
});
test('management without read scope cannot enumerate a task',async t=>{
 const f=await fixture(t);f.db.prepare("UPDATE team_project_grants SET status='revoked' WHERE user_id='manager-a' AND permission='collection.read'").run();assert.equal((await f.call({actor:'manager-a'})).status,404);
});
test('unknown tasks, unauthorized tasks and foreign teams share the generic denial',async t=>{
 const f=await fixture(t),missing=await f.call({task:'missing'});assert.equal(missing.status,404);
 for(const opts of [{actor:'assistant-a'},{actor:'intern-b'},{actor:'manager-b'},{team:'team-b'},{team:'missing'}]){const denied=await f.call(opts);assert.equal(denied.status,404);assert.deepEqual(denied.data,missing.data);}
});
test('same task IDs in different teams retain independent assignments and revisions',async t=>{
 const f=await fixture(t);f.db.prepare("INSERT INTO team_task_versions VALUES ('team-b','task-a',27)").run();safeDto(await f.call(),true,0);safeDto(await f.call({actor:'intern-b',team:'team-b'}),true,27);assert.equal((await f.call({team:'team-b'})).status,404);
});
test('revoking assignment removes junior task scope and only disables a readable manager',async t=>{
 const f=await fixture(t);f.assign('manager-a');safeDto(await f.call({actor:'manager-a'}),true);f.assign('intern-a','revoked');f.assign('manager-a','revoked');assert.equal((await f.call()).status,404);safeDto(await f.call({actor:'manager-a'}),false);
});
for(const status of ['open','returned','submitted','closed'])test('task '+status+' has an authoritative submission capability',async t=>{
 const f=await fixture(t);f.taskStatus(status);safeDto(await f.call(),['open','returned'].includes(status));
});
test('frozen projects remain readable with false capability while archived projects disappear',async t=>{
 const f=await fixture(t);f.projectStatus('frozen');safeDto(await f.call(),false);safeDto(await f.call({actor:'manager-a'}),false);f.projectStatus('archived');assert.equal((await f.call()).status,404);
});
test('disabled membership and disabled team each deny capability without metadata',async t=>{
 const f=await fixture(t);f.db.prepare("UPDATE team_memberships SET status='disabled' WHERE team_id='team-a' AND user_id='intern-a'").run();assert.equal((await f.call()).status,404);f.db.prepare("UPDATE team_memberships SET status='active' WHERE team_id='team-a' AND user_id='intern-a'").run();f.db.prepare("UPDATE teams SET status='disabled' WHERE team_id='team-a'").run();assert.equal((await f.call()).status,404);
});
for(const condition of ['missing','malformed','expired','revoked','disabled-account'])test(condition+' session cannot read capability',async t=>{
 const f=await fixture(t);let options={};
 if(condition==='missing')options.token=null;
 if(condition==='malformed')options.token='not-a-session';
 if(condition==='expired')f.db.prepare("UPDATE team_sessions SET expires_at=? WHERE user_id='intern-a'").run(NOW);
 if(condition==='revoked')f.db.prepare("UPDATE team_sessions SET revoked_at=? WHERE user_id='intern-a'").run(NOW);
 if(condition==='disabled-account')f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='intern-a'").run();
 const r=await f.call(options);assert.equal(r.status,401);assert.deepEqual(Object.keys(r.data),['error']);
});
test('query parameters cannot inject an actor, role, capability or version',async t=>{
 const f=await fixture(t);for(const query of ['?role=partner','?userId=manager-a','?revision=0','?canSubmit=true','?x=1&x=2','?q='])assert.equal((await f.call({query})).status,400,query);
});
test('only GET is accepted and write-shaped requests never mutate the database',async t=>{
 const f=await fixture(t),before=f.db.prepare('SELECT total_changes() n').get().n;
 for(const method of ['HEAD','POST','PUT','PATCH','DELETE','OPTIONS']){const r=await f.call({method,...(['POST','PUT','PATCH'].includes(method)?{body:{role:'partner',userId:'intern-a'}}:{})});assert.equal(r.status,405,method);assert.equal(r.headers.get('Allow'),'GET');}
 assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);noSubmissions(f);
});
test('forged identity headers never replace the authenticated principal',async t=>{
 const f=await fixture(t);safeDto(await f.call({actor:'manager-a',headers:{'X-User-Id':'intern-a','X-Team-Role':'intern','X-Can-Submit':'true'}}),false);
});
test('the capability response is private, minimally projected and works on read-only SQLite',async t=>{
 const f=await fixture(t),before=f.db.prepare('SELECT total_changes() n').get().n,schema=f.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();f.db.exec('PRAGMA query_only=ON');
 for(const actor of ['intern-a','manager-a']){const r=await f.call({actor});safeDto(r,actor==='intern-a');assert.equal(r.headers.get('Cache-Control'),'private, no-store, max-age=0');assert.equal(r.headers.get('Vary'),'Authorization');assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');}
 assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);assert.deepEqual(f.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all(),schema);
});
test('maximum safe revision disables submission instead of allowing an unsafe increment',async t=>{
 const f=await fixture(t);f.revision(Number.MAX_SAFE_INTEGER);safeDto(await f.call(),false,Number.MAX_SAFE_INTEGER);assert.equal((await f.call({action:'submissions',body:upload(Number.MAX_SAFE_INTEGER)})).status,409);noSubmissions(f);
});
test('the last incrementable revision remains usable and never exceeds the safe integer ceiling',async t=>{
 const f=await fixture(t);f.revision(Number.MAX_SAFE_INTEGER-1);safeDto(await f.call(),true,Number.MAX_SAFE_INTEGER-1);const r=await f.call({action:'submissions',body:upload(Number.MAX_SAFE_INTEGER-1)});assert.equal(r.status,201,r.raw);assert.equal(r.data.revision,Number.MAX_SAFE_INTEGER);f.taskStatus('returned');safeDto(await f.call(),false,Number.MAX_SAFE_INTEGER);
});
test('a noninteger persisted version fails closed without returning an invalid DTO',async t=>{
 const f=await fixture(t);f.revision(1.5);const r=await f.call();assert.equal(r.status,409);assert.equal('revision' in r.data,false);noSubmissions(f);
});
test('a corrupt negative version never becomes a valid capability revision',async t=>{
 const f=await fixture(t);f.db.exec('PRAGMA ignore_check_constraints=ON');f.revision(-1);f.db.exec('PRAGMA ignore_check_constraints=OFF');const r=await f.call();assert.equal(r.status,409);assert.equal('revision' in r.data,false);noSubmissions(f);
});
test('an out-of-range SQLite integer fails safely without leaking its value or SQL',async t=>{
 const f=await fixture(t);f.revision(BigInt(Number.MAX_SAFE_INTEGER)+1n);const r=await f.call();assert.equal(r.status,503);assert.equal(r.raw.includes('9007199254740992'),false);assert.equal('revision' in r.data,false);noSubmissions(f);
});
test('successful upload and return invalidate prior capability and advance the exact revision',async t=>{
 const f=await fixture(t);safeDto(await f.call(),true);assert.equal((await f.call({action:'submissions',body:upload()})).status,201);safeDto(await f.call(),false,1);assert.equal((await f.call({actor:'manager-a',action:'return',body:{revision:1}})).status,200);safeDto(await f.call(),true,2);assert.equal((await f.call({action:'submissions',body:upload()})).status,409);
});
const mutations={
 assignment:f=>f.assign('intern-a','revoked'),
 project:f=>f.projectStatus('frozen'),
 task:f=>f.taskStatus('closed'),
 revision:f=>f.revision(1),
 membership:f=>f.db.prepare("UPDATE team_memberships SET status='disabled' WHERE team_id='team-a' AND user_id='intern-a'").run(),
 session:f=>f.db.prepare("UPDATE team_sessions SET revoked_at=? WHERE user_id='intern-a'").run(NOW),
 actor:f=>f.db.prepare("UPDATE team_sessions SET user_id='assistant-a' WHERE user_id='intern-a'").run(),
};
for(const [condition,mutate] of Object.entries(mutations))test('a true preflight cannot authorize upload after '+condition+' changes while reading its body',{timeout:5000},async t=>{
 const f=await fixture(t);safeDto(await f.call(),true);const pending=f.stream();await pending.reading;mutate(f);pending.finish();const r=await pending.pending;assert.equal(r.status,condition==='session'?401:['project','task','revision'].includes(condition)?409:404,r.raw);noSubmissions(f);
});
