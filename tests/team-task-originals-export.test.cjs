'use strict';
// Genuine isolated SQLite + strict application routes. Direct SQL only prepares
// synthetic edge states; all requests traverse the real device gate and API.
const test=require('node:test'),assert=require('node:assert/strict');
const {constants}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const {createProjectAccessFixture,digest,source}=require('./helpers/project-access-fixture.cjs');
const codec=require('../shared/task-originals-export.cjs');
const exact=(value,names)=>assert.deepEqual(Object.keys(value).sort(),[...names].sort());
const canonical=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):value);
const taskRevision=(f,task='task-a',team='team-a')=>Number(f.db.prepare('SELECT CAST(revision AS TEXT) revision FROM team_task_versions WHERE team_id=? AND task_id=?').get(team,task)?.revision??0);
function route(f,ids,{review=false,team='team-a',project='project-a',task='task-a',revision=taskRevision(f,task,team),projectRevision=f.revision(project,team)}={}){
 return '/api/teams/'+team+(review?'/projects/'+project:'/collection')+'/tasks/'+task+'/export-plan?revision='+revision+(review?'&projectRevision='+projectRevision:'')+'&ids='+[...ids].sort().join(',');
}
async function setup(t){const f=await createProjectAccessFixture(t),intern=await f.ready(),upload=await f.upload(intern);return {...f,uploadAgain:f.upload,intern,upload};}
function submission(f,{id=randomUUID(),user='intern-a',task='task-a',team='team-a',bytes=Buffer.from('Synthetic original\0原件'),filename='same original.bin',grant=true,byteLength=bytes.length}={}){
 const attachmentId='attachment-'+id;f.db.prepare('INSERT INTO team_collection_attachments VALUES (?,?,?,?,?)').run(team,task,attachmentId,filename,bytes);
 f.db.prepare('INSERT INTO team_task_submissions VALUES (?,?,?,?,?,?,?,?)').run(team,id,task,attachmentId,user,digest(bytes),byteLength,f.clock.value);
 if(grant)f.db.prepare("INSERT INTO team_attachment_grants VALUES (?,?,?,'active')").run(team,attachmentId,user);
 return {id,attachmentId,filename,bytes,sha256:digest(bytes),byteLength,createdAt:f.clock.value};
}
function snapshot(f){return f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('team_auth_limits','team_device_request_replays') ORDER BY name").all().map(({name})=>({name,rows:f.db.prepare('SELECT * FROM "'+name+'"').all().map(row=>JSON.stringify(Object.entries(row).map(([key,value])=>[key,value instanceof Uint8Array?['blob',Buffer.from(value).toString('base64')]:value]))).sort()}));}
async function afterSnapshot(f,path,session,change){
 const {handleTeamApplicationRequest}=await source('application-api.mjs');let changed=false,businessRead=false;
 const db=new Proxy(f.db,{get(target,key){if(key==='exec')return sql=>{const result=target.exec(sql);if(sql==='BEGIN')businessRead=true;if(sql==='COMMIT'&&businessRead&&!changed){changed=true;change();}return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const response=await handleTeamApplicationRequest(f.makeRequest(path,{session}),{db,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true}});
 const raw=await response.text();assert.equal(changed,true);return {status:response.status,data:raw?JSON.parse(raw):null};
}

test('public own upload yields exact deterministic metadata with no business data or schema changes',async t=>{
 const f=await setup(t),before=snapshot(f),schema=f.db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
 assert.equal(schema.filter(row=>row.type==='table').length,66);assert.equal(schema.length,189);
 const path=route(f,[f.upload.submission.id]),result=await f.api(path,{session:f.intern});assert.equal(result.status,200);exact(result.data,['manifest','sha256']);
 const m=result.data.manifest;exact(m,['format','schemaVersion','scope','task','files','policy']);
 assert.deepEqual(m.scope,{kind:'own',teamId:'team-a',taskId:'task-a',userId:'intern-a'});exact(m.task,['id','title','instructions','status','revision']);
 assert.equal(m.task.revision,f.upload.revision);assert.equal(m.task.status,'submitted');assert.equal(m.files.length,1);
 exact(m.files[0],['id','attachmentId','filename','sha256','byteLength','createdAt']);assert.equal(m.files[0].sha256,digest(f.upload.bytes));
 assert.deepEqual(m.policy,{selectionOnly:true,completeTaskHistory:false,restorableBackup:false,professionalApprovalClaimed:false});
 assert.equal(result.data.sha256,digest(Buffer.from(canonical(m))));assert.equal(result.headers.get('cache-control'),'private, no-store, max-age=0');
 assert.deepEqual((await f.api(path,{session:f.intern})).data,result.data);assert.deepEqual(snapshot(f),before);
 assert.deepEqual(f.db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(),schema);
 assert.doesNotMatch(JSON.stringify(result.data),/financial|structure|submittedBy|projectId|password|token|lease|contentBase64/u);
});

test('two public uploads with one filename preserve distinct selected versions and original bytes',async t=>{
 const f=await setup(t),manager=await f.ready('manager-a');
 const returned=await f.api('/api/teams/team-a/collection/tasks/task-a/return',{method:'POST',session:manager,body:{revision:f.upload.revision}});assert.equal(returned.status,200);
 const next=await f.uploadAgain(f.intern,{filename:'synthetic.bin',bytes:Buffer.from('second opaque body\0\xff\r\n')});
 const one=await f.api(route(f,[f.upload.submission.id]),{session:f.intern});assert.equal(one.status,200);assert.deepEqual(one.data.manifest.files.map(row=>row.id),[f.upload.submission.id]);
 const both=await f.api(route(f,[next.submission.id,f.upload.submission.id]),{session:f.intern});assert.equal(both.status,200);
 assert.deepEqual(both.data.manifest.files.map(row=>row.id),[next.submission.id,f.upload.submission.id].sort());assert.deepEqual(both.data.manifest.files.map(row=>row.filename),['synthetic.bin','synthetic.bin']);
 const out=codec.create(both.data,[{id:f.upload.submission.id,bytes:f.upload.bytes},{id:next.submission.id,bytes:next.bytes}]);assert.equal(out.fileCount,2);
 assert.equal(out.planSha256,both.data.sha256);assert.ok(out.bytes.includes(f.upload.bytes));assert.ok(out.bytes.includes(next.bytes));
});

test('project reviewer needs no personal attachment grant and receives only minimal submitter identity',async t=>{
 const f=await setup(t),manager=await f.ready('manager-a');assert.equal(f.db.prepare('SELECT 1 FROM team_attachment_grants WHERE user_id=? AND attachment_id=?').get('manager-a',f.upload.submission.attachmentId),undefined);
 const result=await f.api(route(f,[f.upload.submission.id],{review:true}),{session:manager});assert.equal(result.status,200);
 assert.deepEqual(result.data.manifest.scope,{kind:'project-review',teamId:'team-a',projectId:'project-a',projectRevision:f.revision(),taskId:'task-a'});
 exact(result.data.manifest.files[0],['id','attachmentId','filename','sha256','byteLength','createdAt','submittedBy']);exact(result.data.manifest.files[0].submittedBy,['id','displayName']);assert.equal(result.data.manifest.files[0].submittedBy.id,'intern-a');
});

test('revoked personal grant leaves history visible while export fails completely',async t=>{
 const f=await setup(t);f.db.prepare("UPDATE team_attachment_grants SET status='revoked' WHERE attachment_id=?").run(f.upload.submission.attachmentId);
 const history=await f.api('/api/teams/team-a/collection/tasks/task-a/submissions',{session:f.intern});assert.equal(history.status,200);assert.ok(history.data.submissions.some(row=>row.id===f.upload.submission.id));assert.equal((await f.api(route(f,[f.upload.submission.id]),{session:f.intern})).status,404);
});

test('personal attachment grant cannot substitute for self-submitter; mixed selection is never filtered',async t=>{
 const f=await setup(t),peer=submission(f,{user:'assistant-a'});f.db.prepare("INSERT INTO team_attachment_grants VALUES ('team-a',?,'intern-a','active')").run(peer.attachmentId);
 for(const ids of [[peer.id],[peer.id,f.upload.submission.id]]){const r=await f.api(route(f,ids),{session:f.intern});assert.equal(r.status,404);assert.equal(r.data.manifest,undefined);}
});

for(const mode of ['manage-without-review','review-without-read','owner-only','junior-with-grants','technical-only'])test('review never infers authority from '+mode,async t=>{
 const f=await setup(t);let user='manager-a';
 if(mode==='manage-without-review')f.db.prepare("UPDATE team_project_access_grants SET status='revoked',revision=revision+1 WHERE user_id='manager-a' AND permission='collection.review'").run();
 if(mode==='review-without-read'||mode==='owner-only')f.db.prepare("UPDATE team_project_grants SET status='revoked' WHERE user_id='manager-a'").run();
 if(mode==='owner-only')f.db.prepare("UPDATE team_project_access_grants SET status='revoked',revision=revision+1 WHERE user_id='manager-a' AND permission='collection.review'").run();
 if(mode==='junior-with-grants'){user='intern-a';f.db.prepare("INSERT INTO team_project_grants VALUES ('team-a','project-a','intern-a','collection.read','active')").run();f.db.prepare("INSERT INTO team_project_access_grants(team_id,project_id,user_id,permission,status) VALUES ('team-a','project-a','intern-a','collection.review','active')").run();}
 if(mode==='technical-only')user='administrator-demo';
 const actor=user==='intern-a'?f.intern:await f.ready(user);assert.equal((await f.api(route(f,[f.upload.submission.id],{review:true}),{session:actor})).status,404);
});

for(const options of [{team:'team-b'},{task:'missing-task'},{task:'task-other'},{review:true,project:'missing-project'},{review:true,project:'project-other'}])test('selection is scoped to its exact team/project/task '+JSON.stringify(options),async t=>{
 const f=await setup(t),actor=options.review?await f.ready('manager-a'):f.intern;assert.equal((await f.api(route(f,[f.upload.submission.id],{...options,projectRevision:5}),{session:actor})).status,404);
});

test('frozen project plus closed task remain readable in both scopes; archived project is denied',async t=>{
 const f=await setup(t),manager=await f.ready('manager-a');f.db.prepare("UPDATE team_projects SET status='frozen' WHERE team_id='team-a' AND project_id='project-a'").run();f.db.prepare("UPDATE team_collection_tasks SET status='closed' WHERE team_id='team-a' AND task_id='task-a'").run();
 for(const review of [false,true]){const r=await f.api(route(f,[f.upload.submission.id],{review}),{session:review?manager:f.intern});assert.equal(r.status,200);assert.equal(r.data.manifest.task.status,'closed');}
 f.db.prepare("UPDATE team_projects SET status='archived' WHERE team_id='team-a' AND project_id='project-a'").run();
 for(const review of [false,true])assert.equal((await f.api(route(f,[f.upload.submission.id],{review}),{session:review?manager:f.intern})).status,404);
});

test('MAX_SAFE task/project revisions stay readable with no increment or business mutation',async t=>{
 const f=await setup(t),manager=await f.ready('manager-a');f.db.prepare("UPDATE team_task_versions SET revision=? WHERE team_id='team-a' AND task_id='task-a'").run(Number.MAX_SAFE_INTEGER);f.db.prepare("UPDATE team_project_access_projects SET revision=? WHERE team_id='team-a' AND project_id='project-a'").run(Number.MAX_SAFE_INTEGER);
 const before=snapshot(f),r=await f.api(route(f,[f.upload.submission.id],{review:true}),{session:manager});assert.equal(r.status,200);assert.equal(r.data.manifest.task.revision,Number.MAX_SAFE_INTEGER);assert.equal(r.data.manifest.scope.projectRevision,Number.MAX_SAFE_INTEGER);assert.deepEqual(snapshot(f),before);
});

for(const review of [false,true])test('authorized stale '+(review?'project':'task')+' revision returns 409',async t=>{
 const f=await setup(t),actor=review?await f.ready('manager-a'):f.intern;assert.equal((await f.api(route(f,[f.upload.submission.id],review?{review:true,projectRevision:f.revision()-1}:{revision:0}),{session:actor})).status,409);
});

const badQueries=['','revision=1','revision=1&ids=','revision=01&ids=a','revision=-1&ids=a','revision=9007199254740992&ids=a','revision=1&ids=b,a','revision=1&ids=a,a','revision=1&ids=a&ids=b','revision=1&ids=a&revision=1','revision=1&ids=a&extra=1','revision=1&ids='+Array.from({length:21},(_,i)=>'s'+String(i).padStart(2,'0')).join(',')];
for(const suffix of badQueries)test('strict bounded query rejects '+(suffix||'missing query'),async t=>{
 const f=await createProjectAccessFixture(t),actor=await f.ready();const r=await f.api('/api/teams/team-a/collection/tasks/task-a/export-plan'+(suffix?'?'+suffix:''),{session:actor});assert.equal(r.status,400);
});

test('only GET is exposed; HEAD is bodyless and bootstrap/diagnostic sessions cannot bypass strict requirement',async t=>{
 const f=await setup(t),path=route(f,[f.upload.submission.id]);const post=await f.api(path,{method:'POST',session:f.intern,body:{}});assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET');
 const head=await f.dispatch(f.makeRequest(path,{method:'HEAD',session:f.intern}));assert.equal(head.status,405);assert.equal((await head.arrayBuffer()).byteLength,0);
 const boot=await f.login();assert.equal((await f.api(path,{session:boot})).status,403);assert.equal((await f.api(path,{session:f.intern,strict:false})).status,403);
});

test('plan succeeds with SQLite authorizer forbidding every attachment BLOB read',async t=>{
 const f=await setup(t);let attempts=0;f.db.setAuthorizer((action,table,column)=>{if(action===constants.SQLITE_READ&&table==='team_collection_attachments'&&column==='bytes'){attempts++;return constants.SQLITE_DENY;}return constants.SQLITE_OK;});
 try{const r=await f.api(route(f,[f.upload.submission.id]),{session:f.intern});assert.equal(r.status,200);assert.equal(attempts,0);}finally{f.db.setAuthorizer(null);}
});

test('zero-length originals keep exact names/hash; aggregate over 64 MiB gives explicit 413 without writes',async t=>{
 const f=await setup(t),empty=submission(f,{bytes:Buffer.alloc(0),filename:' 原始文件名 .bin'}),zero=await f.api(route(f,[empty.id]),{session:f.intern});assert.equal(zero.status,200);assert.equal(zero.data.manifest.files[0].filename,empty.filename);assert.equal(zero.data.manifest.files[0].byteLength,0);assert.equal(zero.data.manifest.files[0].sha256,digest(Buffer.alloc(0)));
 const large=Array.from({length:6},()=>submission(f,{byteLength:12*1024*1024}));const before=snapshot(f),r=await f.api(route(f,large.map(row=>row.id)),{session:f.intern});assert.equal(r.status,413);assert.equal(r.data.error.code,'EXPORT_TOO_LARGE');assert.deepEqual(snapshot(f),before);
});

test('task instructions preserve line endings and indentation without exposing project professional data',async t=>{
 const f=await setup(t),instructions='\t第一行\r\n第二行\n  原缩进  ';f.db.prepare("UPDATE team_collection_tasks SET instructions=? WHERE team_id='team-a' AND task_id='task-a'").run(instructions);
 const r=await f.api(route(f,[f.upload.submission.id]),{session:f.intern});assert.equal(r.status,200);assert.equal(r.data.manifest.task.instructions,instructions);assert.doesNotMatch(JSON.stringify(r.data),/financial_summary|structure_json/u);
});

for(const [name,change,expected]of [
 ['personal grant',f=>f.db.prepare("UPDATE team_attachment_grants SET status='revoked' WHERE attachment_id=?").run(f.upload.submission.attachmentId),404],
 ['assignment',f=>f.db.prepare("UPDATE team_task_assignments SET status='revoked' WHERE user_id='intern-a' AND task_id='task-a'").run(),404],
 ['task revision',f=>f.db.prepare("UPDATE team_task_versions SET revision=revision+1 WHERE team_id='team-a' AND task_id='task-a'").run(),409],
 ['filename metadata',f=>f.db.prepare('UPDATE team_collection_attachments SET display_name=? WHERE attachment_id=?').run('Changed after snapshot.bin',f.upload.submission.attachmentId),409],
 ['actual session',f=>f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(f.clock.value,digest(f.intern.token)),401]
])test('released read snapshot cannot authorize a stale own plan after '+name+' changes',async t=>{
 const f=await setup(t),r=await afterSnapshot(f,route(f,[f.upload.submission.id]),f.intern,()=>change(f));assert.equal(r.status,expected);assert.equal(r.data.manifest,undefined);
});

test('released read snapshot rechecks the project read/review authority',async t=>{
 const f=await setup(t),manager=await f.ready('manager-a'),r=await afterSnapshot(f,route(f,[f.upload.submission.id],{review:true}),manager,()=>f.db.prepare("UPDATE team_project_access_grants SET status='revoked',revision=revision+1 WHERE user_id='manager-a' AND permission='collection.review'").run());assert.equal(r.status,404);assert.equal(r.data.manifest,undefined);
});

test('approved junior technical administrator exports a genuinely assigned own original without acquiring review',async t=>{
 const {createAdministratorBusinessRoleFixture,OWNER,ADMIN}=require('./helpers/administrator-business-role-fixture.cjs');const f=await createAdministratorBusinessRoleFixture(t),owner=await f.ready(OWNER);assert.equal((await f.approve(owner,ADMIN,'assistant')).status,200);
 const admin=await f.ready(ADMIN),manager=await f.ready('manager-a'),assigned=await f.api('/api/teams/team-a/collection/tasks/task-a/assignment',{method:'POST',session:manager,body:{revision:0,userId:ADMIN}});assert.equal(assigned.status,200);
 const uploaded=await f.upload(admin),r=await f.api(route(f,[uploaded.submission.id]),{session:admin});assert.equal(r.status,200);assert.equal(r.data.manifest.scope.userId,ADMIN);assert.equal((await f.api(route(f,[uploaded.submission.id],{review:true}),{session:admin})).status,404);
});
