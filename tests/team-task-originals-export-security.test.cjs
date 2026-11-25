'use strict';
const {laterTeamSchemaLayers:ledgerCheckSchemaLayer}=require('./helpers/workpaper-access-schema-layer.cjs');
// Independent acceptance: genuine isolated SQLite and application requests with
// separately encoded Ed25519 proofs. No customer/demo database, UI or product
// manifest validator is used as the authorization or canonical-hash oracle.
const nodeTest=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync,constants}=require('node:sqlite');
const {createHash,generateKeyPairSync,randomBytes,sign}=require('node:crypto');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const test=(name,fn)=>nodeTest(name,{timeout:25000},fn);
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-16T04:00:00Z'),PASSWORD='IndependentOriginals!2026',ORIGIN='http://127.0.0.1:8774';
const PROOF_FIELDS=['purpose','serverId','userId','sessionBinding','keyFingerprint','identityEpoch','bindingRevision','approvalRequestId','challengeId','nonce','issuedAt','expiresAt'];
const REQUEST_FIELDS=['serverId','userId','sessionBinding','deviceId','bindingRevision','leaseId','method','pathAndQuery','bodySha256','nonce'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const signedBytes=(domain,fields,keys)=>Buffer.concat([Buffer.from(domain+'\0v1\0'),Buffer.from(JSON.stringify(keys.map(key=>fields[key])))]);
const canonical=value=>JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):value);
const keys=value=>Object.keys(value).sort();
const exactKeys=(value,names)=>assert.deepEqual(keys(value),[...names].sort());
const accepted=(response,status=200)=>{assert.equal(response.status,status,response.status+' '+response.raw);return response.data;};
const denied=(response,status=404)=>{assert.equal(response.status,status,response.status+' '+response.raw);assert.doesNotMatch(response.raw,/PRIVATE|password_hash|token_hash|scrypt\$|SQLITE|provider|local-path/i);return response;};
const ownBase=(team='team-a',task='task-a')=>'/api/teams/'+team+'/collection/tasks/'+task;
const reviewBase=(team='team-a',project='project-a',task='task-a')=>'/api/teams/'+team+'/projects/'+project+'/tasks/'+task;
let passwordHash;

async function fixture(t){
 const [{initializeTeamDatabase},{hashPassword},{issueSession},{handleTeamApplicationRequest},{registerManagedProject}]=await Promise.all(['database.mjs','passwords.mjs','auth-api.mjs','application-api.mjs','project-access-policy.mjs'].map(source));
 passwordHash??=hashPassword(PASSWORD);const raw=new DatabaseSync(':memory:');initializeTeamDatabase(raw);t.after(()=>raw.close());
 const f={raw,now:NOW,strict:true,actors:new Map(),statements:[],afterMetadata:null,metadataRead:false};
 const db=new Proxy(raw,{get(target,key){
  if(key==='prepare')return sql=>{f.statements.push(sql);const statement=target.prepare(sql);return new Proxy(statement,{get(stmt,field){
   const value=stmt[field];if(typeof value!=='function')return value;
   if(['get','all','iterate'].includes(field))return(...args)=>{const result=value.apply(stmt,args);if(/\bSELECT\b/i.test(sql)&&/team_task_submissions/i.test(sql)&&/submission_id/i.test(sql)&&!/^\s*SELECT\s+1\b/i.test(sql)){f.metadataRead=true;const hook=f.afterMetadata;f.afterMetadata=null;hook?.();}return result;};
   return value.bind(stmt);
  }});};
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});f.db=db;
 for(const user of ['intern-a','assistant-a','manager-a','partner-a','no-scope-a','intern-b','manager-b','technical-a','platform-owner']){
  raw.prepare("INSERT INTO team_users VALUES (?,'active')").run(user);raw.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(user,user,'Synthetic '+user,await passwordHash);
 }
 for(const team of ['team-a','team-b'])raw.prepare("INSERT INTO teams VALUES (?,'active')").run(team);
 for(const [team,user,role]of [['team-a','intern-a','intern'],['team-a','assistant-a','assistant'],['team-a','manager-a','manager'],['team-a','partner-a','partner'],['team-a','no-scope-a','manager'],['team-b','intern-b','intern'],['team-b','manager-b','manager']])raw.prepare("INSERT INTO team_memberships VALUES (?,?,?,'active')").run(team,user,role);
 raw.prepare("INSERT INTO team_operators VALUES ('team-a','technical-a','administrator','active')").run();
 raw.prepare("INSERT INTO team_platform_reviewers(user_id,permission,status) VALUES ('platform-owner','team.provision','active')").run();
 for(const [team,project,owner]of [['team-a','project-a','manager-a'],['team-a','project-other','partner-a'],['team-b','project-b','manager-b']]){
  raw.prepare("INSERT INTO team_projects(team_id,project_id,title,financial_summary,structure_json,status) VALUES (?,?,?,'PRIVATE-FINANCE','PRIVATE-TREE','active')").run(team,project,'Synthetic '+project);
  registerManagedProject(raw,{teamId:team,projectId:project,createdBy:owner,at:NOW});
 }
 for(const [team,task,project,user]of [['team-a','task-a','project-a','intern-a'],['team-a','task-second','project-a','intern-a'],['team-a','task-other','project-other','intern-a'],['team-b','task-b','project-b','intern-b']]){
  raw.prepare("INSERT INTO team_collection_tasks VALUES (?,?,?,?,?,'open')").run(team,task,project,'Synthetic '+task,'Minimal original task instructions');
  raw.prepare("INSERT INTO team_task_versions VALUES (?,?,7)").run(team,task);
  raw.prepare("INSERT INTO team_task_assignments VALUES (?,?,?,'active')").run(team,task,user);
 }
 f.seedScope=(user,{read=false,manage=false,review=false,owner=false}={},project='project-a',team='team-a')=>{
  for(const [permission,enabled]of [['collection.read',read],['collection.manage',manage]])raw.prepare("INSERT INTO team_project_grants VALUES (?,?,?,?,?) ON CONFLICT(team_id,project_id,user_id,permission) DO UPDATE SET status=excluded.status").run(team,project,user,permission,enabled?'active':'revoked');
  for(const [permission,enabled]of [['collection.review',review],['project.owner',owner]])if(enabled||raw.prepare('SELECT 1 FROM team_project_access_grants WHERE team_id=? AND project_id=? AND user_id=? AND permission=?').get(team,project,user,permission))raw.prepare("INSERT INTO team_project_access_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,?) ON CONFLICT(team_id,project_id,user_id,permission) DO UPDATE SET status=excluded.status,revision=revision+1").run(team,project,user,permission,enabled?'active':'revoked');
 };
 f.seedScope('manager-a',{read:true,manage:true,review:true,owner:true});f.seedScope('partner-a',{read:true,review:true});
 f.submission=(id,{user='intern-a',task='task-a',team='team-a',filename='same original name.bin',bytes=Buffer.from('opaque original '+id+'\0\r\n原件'),grant=true}={})=>{
  const attachmentId='attachment-'+id,record={id,attachmentId,filename,sha256:digest(bytes),byteLength:bytes.length,createdAt:NOW-100};
  raw.prepare('INSERT INTO team_collection_attachments VALUES (?,?,?,?,?)').run(team,task,attachmentId,filename,bytes);
  raw.prepare('INSERT INTO team_task_submissions VALUES (?,?,?,?,?,?,?,?)').run(team,id,task,attachmentId,user,record.sha256,record.byteLength,record.createdAt);
  if(grant)raw.prepare("INSERT INTO team_attachment_grants VALUES (?,?,?,'active')").run(team,attachmentId,user);
  return {...record,user,task,team,bytes};
 };
 f.a=f.submission('submission-a');f.z=f.submission('submission-z');f.peer=f.submission('submission-peer',{user:'assistant-a'});
 f.second=f.submission('submission-second',{task:'task-second'});f.other=f.submission('submission-other',{task:'task-other'});f.foreign=f.submission('submission-b',{user:'intern-b',task:'task-b',team:'team-b'});
 f.projectRevision=(project='project-a',team='team-a')=>Number(raw.prepare('SELECT revision FROM team_project_access_projects WHERE team_id=? AND project_id=?').get(team,project)?.revision);
 f.taskRevision=(task='task-a',team='team-a')=>Number(raw.prepare('SELECT revision FROM team_task_versions WHERE team_id=? AND task_id=?').get(team,task)?.revision);
 f.request=(route,{token,method='GET',body,headers={}}={})=>new Request(ORIGIN+route,{method,headers:{Origin:'shenyi://app',...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 f.send=async request=>{const response=await handleTeamApplicationRequest(request,{db,now:()=>f.now,identityProviders:{deviceProofRequired:f.strict}});assert.ok(response);const bytes=Buffer.from(await response.arrayBuffer()),raw=bytes.toString('utf8');return {status:response.status,headers:response.headers,bytes,raw,data:raw?JSON.parse(raw):null};};
 f.call=(route,options)=>f.send(f.request(route,options));
 f.bound=async(user='intern-a',{fresh=false}={})=>{
  if(f.actors.has(user)&&!fresh)return f.actors.get(user);const previous=f.actors.get(user),pair=previous?.key??generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url'),token=issueSession(raw,user,NOW).token,purpose=previous?'prove':'enroll';
  const challenge=accepted(await f.call('/api/auth/devices/'+(previous?'proof-challenges':'enrollment-challenges'),{token,method:'POST',body:{publicKey,...(previous?{}:{displayName:'Synthetic '+user,platform:'win32',currentPassword:PASSWORD})}}),201).challenge;
  const session=accepted(await f.call('/api/auth/devices/'+purpose,{token,method:'POST',body:{challengeId:challenge.challengeId,signature:sign(null,signedBytes('SHENYI-DEVICE-PROOF',challenge,PROOF_FIELDS),pair.privateKey).toString('base64url')}}),previous?200:201);
  const actor={user,key:pair,session};f.actors.set(user,actor);return actor;
 };
 f.signed=(route,{actor,method='GET',body,headers={},nonce=randomBytes(32).toString('base64url')}={})=>{
  const s=actor.session,url=new URL(ORIGIN+route),fields={serverId:s.lease.serverId,userId:actor.user,sessionBinding:digest(s.token),deviceId:s.device.id,bindingRevision:s.device.revision,leaseId:s.lease.id,method,pathAndQuery:url.pathname+url.search,bodySha256:digest(body===undefined?'':JSON.stringify(body)),nonce};
  return f.request(route,{token:s.token,method,body,headers:{'X-Shenyi-Device-Lease':s.lease.token,'X-Shenyi-Device-Nonce':nonce,'X-Shenyi-Device-Body-SHA256':fields.bodySha256,'X-Shenyi-Device-Signature':sign(null,signedBytes('SHENYI-DEVICE-REQUEST',fields,REQUEST_FIELDS),actor.key.privateKey).toString('base64url'),...headers}});
 };
 f.api=(route,options)=>f.send(f.signed(route,options));
 f.own=(ids=[f.a.id,f.z.id],{team='team-a',task='task-a',revision=f.taskRevision(task,team)}={})=>ownBase(team,task)+'/export-plan?revision='+revision+'&ids='+[...ids].sort().join(',');
 f.review=(ids=[f.a.id,f.z.id],{team='team-a',project='project-a',task='task-a',revision=f.taskRevision(task,team),projectRevision=f.projectRevision(project,team)}={})=>reviewBase(team,project,task)+'/export-plan?revision='+revision+'&projectRevision='+projectRevision+'&ids='+[...ids].sort().join(',');
 f.snapshot=()=>Object.fromEntries(raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('team_auth_limits','team_device_request_replays') ORDER BY name").all().map(({name})=>[name,raw.prepare('SELECT * FROM "'+name+'"').all().map(row=>JSON.stringify(Object.entries(row).map(([key,value])=>[key,value instanceof Uint8Array?['blob',Buffer.from(value).toString('base64')]:value]))).sort()]));
 f.schema=()=>raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
 f.statements.length=0;return f;
}

test('fixture: strict independent signature reaches existing own history and download authorization differs',async t=>{
 const f=await fixture(t),actor=await f.bound(),history=accepted(await f.api(ownBase()+'/submissions',{actor}));assert.equal(history.submissions.length,2);
 f.raw.prepare("UPDATE team_attachment_grants SET status='revoked' WHERE attachment_id=?").run(f.a.attachmentId);
 assert.equal(accepted(await f.api(ownBase()+'/submissions',{actor})).submissions.length,2);
 denied(await f.api(ownBase()+'/attachments/'+f.a.attachmentId,{actor}),404);
});

test('own plan contains only selected original metadata and independently verifiable canonical digest; no business writes',async t=>{
 const f=await fixture(t),actor=await f.bound(),before=f.snapshot(),schema=f.schema();
 assert.equal(schema.filter(row=>row.type==='table').length-ledgerCheckSchemaLayer(f.db).tables,73);assert.equal(schema.length-ledgerCheckSchemaLayer(f.db).objects,252);
 const response=await f.api(f.own(),{actor}),plan=accepted(response);exactKeys(plan,['manifest','sha256']);
 const m=plan.manifest;exactKeys(m,['format','schemaVersion','scope','task','files','policy']);assert.equal(m.format,'shenyi-task-originals-export');assert.equal(m.schemaVersion,1);
 assert.deepEqual(m.scope,{kind:'own',teamId:'team-a',taskId:'task-a',userId:'intern-a'});
 assert.deepEqual(m.task,{id:'task-a',title:'Synthetic task-a',instructions:'Minimal original task instructions',status:'open',revision:7});
 assert.deepEqual(m.files,[f.a,f.z].map(({id,attachmentId,filename,sha256,byteLength,createdAt})=>({id,attachmentId,filename,sha256,byteLength,createdAt})));
 assert.deepEqual(m.policy,{selectionOnly:true,completeTaskHistory:false,restorableBackup:false,professionalApprovalClaimed:false});
 assert.equal(plan.sha256,digest(Buffer.from(canonical(m))));assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
 assert.doesNotMatch(response.raw,/PRIVATE|projectId|submittedBy|originalBytes|contentBase64|lease|token/);
 assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.schema(),schema);
});

for(const user of ['intern-a','assistant-a','manager-a','partner-a'])test('own export supports current '+user+' business role only for its own submission',async t=>{
 const f=await fixture(t),actor=await f.bound(user);if(user==='assistant-a')f.raw.prepare("INSERT INTO team_task_assignments VALUES ('team-a','task-a','assistant-a','active')").run();
 const record=['manager-a','partner-a'].includes(user)?f.submission('submission-role',{user}):user==='assistant-a'?f.peer:f.a;
 const plan=accepted(await f.api(f.own([record.id]),{actor}));assert.equal(plan.manifest.scope.userId,user);assert.equal(plan.manifest.files.length,1);
 denied(await f.api(f.own([user==='intern-a'?f.peer.id:f.a.id]),{actor}),404);
});

for(const status of ['revoked','missing'])test('visible own history never grants export when original grant is '+status,async t=>{
 const f=await fixture(t),actor=await f.bound();if(status==='missing')f.raw.prepare('DELETE FROM team_attachment_grants WHERE attachment_id=?').run(f.a.attachmentId);else f.raw.prepare("UPDATE team_attachment_grants SET status='revoked' WHERE attachment_id=?").run(f.a.attachmentId);
 assert.equal(accepted(await f.api(ownBase()+'/submissions',{actor})).submissions.length,2);
 denied(await f.api(f.own(),{actor}),404);accepted(await f.api(f.own([f.z.id]),{actor}));
});

test('foreign submitter cannot be exported even with personal attachment grant and current task assignment',async t=>{
 const f=await fixture(t),actor=await f.bound();f.raw.prepare("INSERT INTO team_attachment_grants VALUES ('team-a',?,'intern-a','active')").run(f.peer.attachmentId);
 denied(await f.api(f.own([f.a.id,f.peer.id]),{actor}),404);
});

for(const deniedId of ['submission-second','submission-other','submission-b','nonexistent-submission'])test('one out-of-scope selected submission '+deniedId+' refuses entire own plan',async t=>{
 const f=await fixture(t),actor=await f.bound(),before=f.snapshot();denied(await f.api(f.own([f.a.id,deniedId]),{actor}),404);assert.deepEqual(f.snapshot(),before);
});

for(const scope of ['own','review'])test(scope+' rejects an inconsistent cross-task attachment link instead of borrowing authorized metadata',async t=>{
 const f=await fixture(t),actor=await f.bound(scope==='own'?'intern-a':'partner-a');
 f.raw.prepare('UPDATE team_task_submissions SET attachment_id=? WHERE submission_id=?').run(f.second.attachmentId,f.a.id);
 denied(await f.api(f[scope](),{actor}),404);
});

test('review plan uses explicit read plus review and carries only selected existing submitter identity',async t=>{
 const f=await fixture(t),actor=await f.bound('partner-a'),plan=accepted(await f.api(f.review([f.a.id,f.peer.id]),{actor}));
 assert.deepEqual(plan.manifest.scope,{kind:'project-review',teamId:'team-a',projectId:'project-a',projectRevision:f.projectRevision(),taskId:'task-a'});
 for(const file of plan.manifest.files){exactKeys(file,['id','attachmentId','filename','sha256','byteLength','createdAt','submittedBy']);assert.deepEqual(file.submittedBy,{id:file.id===f.a.id?'intern-a':'assistant-a',displayName:'Synthetic '+(file.id===f.a.id?'intern-a':'assistant-a')});}
 assert.equal(f.raw.prepare("SELECT COUNT(*) n FROM team_attachment_grants WHERE user_id='partner-a'").get().n,0);
 assert.equal(plan.sha256,digest(Buffer.from(canonical(plan.manifest))));assert.doesNotMatch(JSON.stringify(plan),/PRIVATE/);
});

for(const [name,flags]of [['read only',{read:true}],['manage plus read',{read:true,manage:true}],['owner alone',{owner:true}],['owner plus read',{owner:true,read:true}],['review alone',{review:true}],['manage plus review',{manage:true,review:true}],['none',{}]])test('project export rejects '+name+' as replacement for read plus review',async t=>{
 const f=await fixture(t);f.seedScope('manager-a',flags);const actor=await f.bound('manager-a');denied(await f.api(f.review(),{actor}),404);
});

for(const user of ['intern-a','assistant-a'])test('project review refuses junior '+user+' despite forged read review grants',async t=>{
 const f=await fixture(t);f.seedScope(user,{read:true,manage:true,review:true});const actor=await f.bound(user);denied(await f.api(f.review(),{actor}),404);
});

for(const user of ['technical-a','platform-owner','no-scope-a'])test('technical or unrelated identity '+user+' has no automatic task export access',async t=>{
 const f=await fixture(t),actor=await f.bound(user);denied(await f.api(f.own(),{actor}),404);denied(await f.api(f.review(),{actor}),404);
});

for(const options of [{team:'team-b',project:'project-b',task:'task-b'}, {project:'project-other',task:'task-other'}, {task:'task-second'}, {project:'project-other'}, {task:'missing-task',revision:7}])test('project route rejects cross-scope '+JSON.stringify(options),async t=>{
 const f=await fixture(t),actor=await f.bound('partner-a');denied(await f.api(f.review([f.a.id],options),{actor}),404);
});

for(const scope of ['own','review'])test(scope+' plan never selects or materializes attachment BLOB, even when SQLite forbids it',async t=>{
 const f=await fixture(t),actor=await f.bound(scope==='own'?'intern-a':'partner-a'),reads=[];f.raw.setAuthorizer((action,table,column)=>{if(action===constants.SQLITE_READ){reads.push({table,column});if(table==='team_collection_attachments'&&column==='bytes')return constants.SQLITE_DENY;}return constants.SQLITE_OK;});
 try{accepted(await f.api(f[scope](),{actor}));assert.equal(reads.some(row=>row.table==='team_collection_attachments'&&row.column==='bytes'),false);}finally{f.raw.setAuthorizer(null);}
});

for(const scope of ['own','review'])test(scope+' selected metadata queries are bounded and scoped before projection',async t=>{
 const f=await fixture(t),actor=await f.bound(scope==='own'?'intern-a':'partner-a');f.statements.length=0;accepted(await f.api(f[scope]([f.a.id]),{actor}));
 const queries=f.statements.filter(sql=>/\bSELECT\b/i.test(sql)&&/team_task_submissions/i.test(sql)&&/submission_id/i.test(sql)&&!/^\s*SELECT\s+1\b/i.test(sql));assert.ok(queries.length);
 for(const sql of queries){assert.match(sql,/submission_id\s*(?:=|IN\s*\()/i);assert.match(sql,/WHERE[\s\S]*team_id[\s\S]*task_id/i);if(scope==='own'){assert.match(sql,/submitted_by\s*=\s*\?/i);assert.match(sql,/team_attachment_grants/);}else{assert.match(sql,/collection\.read/);assert.match(sql,/collection\.review/);}}
});

for(const scope of ['own','review'])for(const state of ['frozen','closed','frozen-closed'])test(scope+' preserves existing '+state+' read semantics',async t=>{
 const f=await fixture(t),actor=await f.bound(scope==='own'?'intern-a':'partner-a');if(state.includes('frozen'))f.raw.prepare("UPDATE team_projects SET status='frozen' WHERE project_id='project-a'").run();if(state.includes('closed'))f.raw.prepare("UPDATE team_collection_tasks SET status='closed' WHERE task_id='task-a'").run();accepted(await f.api(f[scope](),{actor}));
});

for(const scope of ['own','review'])test(scope+' archived projects stay inaccessible',async t=>{
 const f=await fixture(t),actor=await f.bound(scope==='own'?'intern-a':'partner-a');f.raw.prepare("UPDATE team_projects SET status='archived' WHERE project_id='project-a'").run();denied(await f.api(f[scope](),{actor}),404);
});

for(const scope of ['own','review'])test(scope+' requested task revision mismatch returns conflict only within an authorized task',async t=>{
 const f=await fixture(t),actor=await f.bound(scope==='own'?'intern-a':'partner-a');denied(await f.api(f[scope]([f.a.id],{revision:6}),{actor}),409);
 denied(await f.api(f[scope]([f.a.id],{task:'missing-task',revision:6}),{actor}),404);
});

test('project revision mismatch returns conflict only after scope is established',async t=>{
 const f=await fixture(t),actor=await f.bound('partner-a');denied(await f.api(f.review([f.a.id],{projectRevision:f.projectRevision()+1}),{actor}),409);
 f.seedScope('partner-a',{});denied(await f.api(f.review([f.a.id],{projectRevision:1}),{actor}),404);
});

const invalidQueryCases=[
 ['missing ids','revision=7'],['empty ids','revision=7&ids='],['duplicate query ids','revision=7&ids=submission-a&ids=submission-z'],
 ['duplicate selection','revision=7&ids=submission-a,submission-a'],['unsorted selection','revision=7&ids=submission-z,submission-a'],
 ['invalid id','revision=7&ids=../secret'],['empty entry','revision=7&ids=submission-a,'],['whitespace','revision=7&ids=%20submission-a'],
 ['unknown key','revision=7&ids=submission-a&all=true'],['duplicate revision','revision=7&revision=7&ids=submission-a'],
 ['missing revision','ids=submission-a'],['negative revision','revision=-1&ids=submission-a'],['fraction revision','revision=7.0&ids=submission-a'],
 ['unsafe revision','revision=9007199254740992&ids=submission-a'],['leading zero revision','revision=07&ids=submission-a'],
 ['over selection limit','revision=7&ids='+Array.from({length:21},(_,i)=>'submission-'+String(i).padStart(2,'0')).join(',')],
];
for(const scope of ['own','review'])test(scope+' rejects malformed or broad selection without querying originals',async t=>{
 const f=await fixture(t),actor=await f.bound(scope==='own'?'intern-a':'partner-a');
 for(const [name,query]of invalidQueryCases){f.statements.length=0;const route=(scope==='own'?ownBase():reviewBase())+'/export-plan?'+query+(scope==='review'?'&projectRevision='+f.projectRevision():'');const response=await f.api(route,{actor});assert.equal(response.status,400,name+' '+response.raw);assert.equal(f.statements.some(sql=>/\bSELECT\b/i.test(sql)&&/team_task_submissions/i.test(sql)),false,name);}
});

test('project plan requires a single canonical safe positive project revision',async t=>{
 const f=await fixture(t),actor=await f.bound('partner-a');for(const suffix of ['', '&projectRevision=0','&projectRevision=-1','&projectRevision=1.0','&projectRevision=01','&projectRevision=9007199254740992','&projectRevision=1&projectRevision=1'])denied(await f.api(reviewBase()+'/export-plan?revision=7&ids='+f.a.id+suffix,{actor}),400);
});

for(const [name,sql]of [
 ['unsafe size',"UPDATE team_task_submissions SET byte_length=9007199254740992 WHERE submission_id='submission-a'"],
 ['oversize original',"UPDATE team_task_submissions SET byte_length=12582913 WHERE submission_id='submission-a'"],
 ['invalid SHA',"UPDATE team_task_submissions SET content_sha256='invalid' WHERE submission_id='submission-a'"],
 ['invalid time',"UPDATE team_task_submissions SET created_at=-1 WHERE submission_id='submission-a'"],
 ['filename traversal',"UPDATE team_collection_attachments SET display_name='../private' WHERE attachment_id='attachment-submission-a'"],
])test('malformed trusted selected metadata '+name+' never produces a partial plan',async t=>{
 const f=await fixture(t),actor=await f.bound();f.raw.exec(sql);const response=await f.api(f.own(),{actor});assert.ok([400,409,413,503].includes(response.status),response.status+' '+response.raw);assert.equal(response.data?.manifest,undefined);
});

for(const scope of ['own','review'])test(scope+' metadata alone enforces complete selection total capacity before original download',async t=>{
 const f=await fixture(t),actor=await f.bound(scope==='own'?'intern-a':'partner-a'),ids=[];for(let i=0;i<6;i++){const row=f.submission('large-selected-'+i);ids.push(row.id);f.raw.prepare('UPDATE team_task_submissions SET byte_length=? WHERE submission_id=?').run(12*1024*1024,row.id);}
 const response=await f.api(f[scope](ids),{actor});assert.ok([400,409,413,503].includes(response.status),response.status+' '+response.raw);assert.equal(response.data?.manifest,undefined);
});

for(const scope of ['own','review'])test(scope+' export requires actual strict device context even with global diagnostic gate disabled',async t=>{
 const f=await fixture(t),actor=await f.bound(scope==='own'?'intern-a':'partner-a');f.strict=false;const request=f.signed(f[scope](),{actor});denied(await f.send(request),403);denied(await f.call(f[scope](),{token:actor.session.token,headers:{'X-Shenyi-Device-Lease':actor.session.lease.token,'X-User-Id':actor.user}}),403);
});

for(const scope of ['own','review'])test(scope+' copied bearer and lease cannot replace request proof or current single-session lease',async t=>{
 const f=await fixture(t),actor=await f.bound(scope==='own'?'intern-a':'partner-a');denied(await f.call(f[scope](),{token:actor.session.token,headers:{'X-Shenyi-Device-Lease':actor.session.lease.token}}),400);
 await f.bound(actor.user,{fresh:true});denied(await f.api(f[scope](),{actor}),401);
});

for(const scope of ['own','review'])test(scope+' export refuses replay and signed-query substitution',async t=>{
 const f=await fixture(t),actor=await f.bound(scope==='own'?'intern-a':'partner-a'),request=f.signed(f[scope](),{actor});accepted(await f.send(request));denied(await f.send(request),409);
 const original=f.signed(f[scope]([f.a.id]),{actor}),changed=new Request(ORIGIN+f[scope]([f.z.id]),{headers:original.headers});denied(await f.send(changed),403);
});

for(const scope of ['own','review'])test(scope+' methods other than GET are rejected without plan or original projection',async t=>{
 const f=await fixture(t),actor=await f.bound(scope==='own'?'intern-a':'partner-a');for(const method of ['POST','PUT','DELETE','HEAD']){const response=await f.api(f[scope](),{actor,method});assert.equal(response.status,405,method+' '+response.raw);assert.equal(response.headers.get('allow'),'GET');if(method==='HEAD')assert.equal(response.bytes.length,0);}
});

for(const [name,mutate]of [
 ['personal grant revoke',f=>f.raw.prepare("UPDATE team_attachment_grants SET status='revoked' WHERE attachment_id=?").run(f.a.attachmentId)],
 ['task assignment revoke',f=>f.raw.prepare("UPDATE team_task_assignments SET status='revoked' WHERE task_id='task-a'").run()],
 ['task version change',f=>f.raw.prepare("UPDATE team_task_versions SET revision=revision+1 WHERE task_id='task-a'").run()],
 ['member disabled',f=>f.raw.prepare("UPDATE team_memberships SET status='disabled' WHERE user_id='intern-a'").run()],
 ['session revoked',f=>f.raw.prepare("UPDATE team_sessions SET revoked_at=? WHERE user_id='intern-a'").run(NOW)],
 ['lease revoked',f=>f.raw.prepare("UPDATE team_device_leases SET revoked_at=? WHERE user_id='intern-a'").run(NOW)],
])test('own plan refuses '+name+' arising after selected metadata is read',async t=>{
 const f=await fixture(t),actor=await f.bound();f.afterMetadata=()=>mutate(f);const response=await f.api(f.own(),{actor});assert.equal(f.metadataRead,true);assert.ok([401,403,404,409].includes(response.status),response.status+' '+response.raw);assert.equal(response.data?.manifest,undefined);
});

for(const [name,mutate]of [
 ['read revoke',f=>f.seedScope('partner-a',{read:false,review:true})],['review revoke',f=>f.seedScope('partner-a',{read:true,review:false})],
 ['senior downgraded',f=>f.raw.prepare("UPDATE team_memberships SET role='assistant' WHERE user_id='partner-a'").run()],
 ['project revision change',f=>f.raw.prepare("UPDATE team_project_access_projects SET revision=revision+1 WHERE project_id='project-a'").run()],
 ['lease revoked',f=>f.raw.prepare("UPDATE team_device_leases SET revoked_at=? WHERE user_id='partner-a'").run(NOW)],
])test('review plan refuses '+name+' arising after selected metadata is read',async t=>{
 const f=await fixture(t),actor=await f.bound('partner-a');f.afterMetadata=()=>mutate(f);const response=await f.api(f.review(),{actor});assert.equal(f.metadataRead,true);assert.ok([401,403,404,409].includes(response.status),response.status+' '+response.raw);assert.equal(response.data?.manifest,undefined);
});
