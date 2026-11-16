'use strict';
// Independent M4B acceptance: actual isolated SQLite/application, native scrypt,
// separately encoded Ed25519 proofs and explicit synthetic registration only.
// No project-creation product flow, real provider, OS picker or production claim.
const nodeTest=require('node:test'),assert=require('node:assert/strict');
const test=(name,run)=>nodeTest(name,{timeout:25000},run);
const {DatabaseSync}=require('node:sqlite'),crypto=require('node:crypto');
const {createHash,generateKeyPairSync,randomUUID,randomBytes,sign}=crypto;
const {syncBuiltinESMExports}=require('node:module'),{pathToFileURL}=require('node:url');
const path=require('node:path'),fs=require('node:fs/promises');
const {createTeamClient}=require('../desktop/team-client.cjs'),{registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-15T23:00:00Z'),PASSWORD='ProjectSynthetic!2026',ORIGIN='http://127.0.0.1:8774';
const BASE='/api/teams/team-a/projects',ACCESS='/api/auth/project-access',PROJECT=BASE+'/p-a';
const LEGACY='/api/teams/team-a/collection/tasks';
const CF=['purpose','serverId','userId','sessionBinding','keyFingerprint','identityEpoch','bindingRevision','approvalRequestId','challengeId','nonce','issuedAt','expiresAt'];
const RF=['serverId','userId','sessionBinding','deviceId','bindingRevision','leaseId','method','pathAndQuery','bodySha256','nonce'];
const XF=['purpose','serverId','userId','sessionBinding','keyFingerprint','identityEpoch','oldDeviceId','oldBindingRevision','oldBindingStatus','requestId','requestRevision','challengeId','nonce','issuedAt','expiresAt'];
const digest=v=>createHash('sha256').update(v).digest('hex');
const payload=(domain,value,keys)=>Buffer.concat([Buffer.from(domain+'\0v1\0'),Buffer.from(JSON.stringify(keys.map(k=>value[k])))]);
const challengeBytes=value=>payload('SHENYI-DEVICE-PROOF',value,CF),requestBytes=value=>payload('SHENYI-DEVICE-REQUEST',value,RF),replacementBytes=value=>payload('SHENYI-DEVICE-REPLACEMENT',value,XF);
const pair=()=>{const key=generateKeyPairSync('ed25519'),der=key.publicKey.export({format:'der',type:'spki'});return {...key,encoded:der.toString('base64url'),fingerprint:digest(der)};};
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve};};
const ok=(r,statuses=[200,201])=>{assert.ok(statuses.includes(r.status),r.status+' '+r.raw);return r;};
const deny=(r,statuses=[400,401,403,404,409])=>{assert.ok(statuses.includes(r.status),r.status+' '+r.raw);assert.doesNotMatch(r.raw,/password_hash|token_hash|scrypt\$|SQLITE|Synthetic injected|private-provider|D:\\private/);return r;};
const reviewers={team_platform_reviewers:'team.provision',team_recovery_reviewers:'account.recover',team_access_reviewers:'member.disable',team_device_replacement_reviewers:'device.replace'};
const nativeScrypt=crypto.scrypt;let kdfHold=null;
crypto.scrypt=function(...args){const callback=args.pop(),hold=kdfHold;if(hold)kdfHold=null;return nativeScrypt(...args,(error,result)=>{if(!hold)return callback(error,result);hold.entered.resolve();void hold.release.promise.then(()=>callback(error,result));});};
syncBuiltinESMExports();nodeTest.after(()=>{crypto.scrypt=nativeScrypt;syncBuiltinESMExports();});
let passwordHash;
async function fixture(t,{managed=true}={}){
 const [{initializeTeamDatabase},{hashPassword},{issueSession},{handleTeamApplicationRequest},{registerManagedProject}]=await Promise.all([source('database.mjs'),source('passwords.mjs'),source('auth-api.mjs'),source('application-api.mjs'),source('project-access-policy.mjs')]);
 passwordHash||=hashPassword(PASSWORD);const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);t.after(()=>db.close());
 for(const user of ['creator-a','creator-b','delegate-a','reviewer-a','reader-a','none-a','intern-a','assistant-a','intern-b','tech-a','tech-b','orphan','platform-owner','recovery-owner','access-owner','device-owner']){db.prepare("INSERT INTO team_users VALUES (?,'active')").run(user);db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(user,user,'Synthetic '+user,await passwordHash);}
 for(const team of ['a','b']){db.prepare("INSERT INTO teams VALUES (?,'active')").run('team-'+team);db.prepare('INSERT INTO team_profiles VALUES (?,?)').run('team-'+team,'Synthetic '+team);db.prepare("INSERT INTO team_operators VALUES (?,?,'administrator','active')").run('team-'+team,'tech-'+team);}
 for(const [user,team,role]of [['creator-a','a','manager'],['creator-b','b','partner'],['delegate-a','a','manager'],['reviewer-a','a','partner'],['reader-a','a','manager'],['none-a','a','partner'],['intern-a','a','intern'],['assistant-a','a','assistant'],['intern-b','b','intern']])db.prepare("INSERT INTO team_memberships VALUES (?,?,?,'active')").run('team-'+team,user,role);
 for(const [table,permission]of Object.entries(reviewers))db.prepare('INSERT INTO '+table+'(user_id,permission,status) VALUES (?,?,?)').run({'team_platform_reviewers':'platform-owner','team_recovery_reviewers':'recovery-owner','team_access_reviewers':'access-owner','team_device_replacement_reviewers':'device-owner'}[table],permission,'active');
 for(const [team,id,creator]of [['a','p-a','creator-a'],['a','p-other','delegate-a'],['b','p-b','creator-b'],['a','p-legacy','creator-a']]){db.prepare("INSERT INTO team_projects(team_id,project_id,title,financial_summary,structure_json,status) VALUES (?,?,?,?,?,'active')").run('team-'+team,id,'Synthetic '+id,'PRIVATE-FINANCE-'+id,'PRIVATE-TREE-'+id);if(managed&&id!=='p-legacy')registerManagedProject(db,{teamId:'team-'+team,projectId:id,createdBy:creator,at:NOW,requestId:null,requestSha256:null});}
 for(const [id,project,user,team]of [['t-a','p-a','intern-a','a'],['t-second','p-a','assistant-a','a'],['t-other','p-other','intern-a','a'],['t-b','p-b','intern-b','b'],['t-legacy','p-legacy','intern-a','a']]){db.prepare("INSERT INTO team_collection_tasks(team_id,task_id,project_id,title,instructions,status) VALUES (?,?,?,?,?,'open')").run('team-'+team,id,project,'Synthetic '+id,'Synthetic minimal context');db.prepare("INSERT INTO team_task_assignments VALUES (?,?,?,'active')").run('team-'+team,id,user);}
 db.prepare("INSERT INTO team_phone_credentials VALUES ('creator-a','+8613800138000',?,1)").run(NOW-1000);db.prepare("INSERT INTO team_wechat_identities VALUES ('wx0123456789abcdef','synthetic-project-open','creator-a',?)").run(NOW-1000);
 const f={db,now:NOW,actors:new Map(),calls:[],providers:{deviceProofRequired:true},register:fields=>registerManagedProject(db,fields)};
 f.seedScope=(project,user,{read=false,manage=false,review=false,owner=false}={},team='team-a')=>{for(const [permission,enabled]of [['collection.read',read],['collection.manage',manage]])db.prepare('INSERT INTO team_project_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,?) ON CONFLICT(team_id,project_id,user_id,permission) DO UPDATE SET status=excluded.status').run(team,project,user,permission,enabled?'active':'revoked');for(const [permission,enabled]of [['collection.review',review],['project.owner',owner]])if(enabled||db.prepare('SELECT 1 FROM team_project_access_grants WHERE team_id=? AND project_id=? AND user_id=? AND permission=?').get(team,project,user,permission))db.prepare('INSERT INTO team_project_access_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,?) ON CONFLICT(team_id,project_id,user_id,permission) DO UPDATE SET status=excluded.status,revision=revision+1').run(team,project,user,permission,enabled?'active':'revoked');};
 if(managed){f.seedScope('p-a','creator-a',{read:true,manage:true,review:true,owner:true});f.seedScope('p-other','delegate-a',{read:true,manage:true,review:true,owner:true});f.seedScope('p-b','creator-b',{read:true,manage:true,review:true,owner:true},'team-b');}
 f.bootstrap=user=>issueSession(db,user,f.now).token;
 f.request=(route,{token,method='GET',body,rawBody,headers={}}={})=>new Request(ORIGIN+route,{method,headers:{Origin:'shenyi://app',...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined||rawBody!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined||rawBody!==undefined?{body:rawBody===undefined?JSON.stringify(body):rawBody,...(rawBody instanceof ReadableStream?{duplex:'half'}:{})}:{})});
 f.send=async request=>{const response=await handleTeamApplicationRequest(request,{db,now:()=>f.now,identityProviders:f.providers});assert.ok(response);const bytes=Buffer.from(await response.arrayBuffer()),raw=bytes.toString('utf8'),data=bytes.length&&response.headers.get('content-type')?.startsWith('application/json')?JSON.parse(raw):null;f.calls.push({method:request.method,path:new URL(request.url).pathname,status:response.status});return {status:response.status,headers:response.headers,bytes,raw,data};};
 f.call=(route,options)=>f.send(f.request(route,options));
 f.transport=async(url,settings={})=>{let response=await handleTeamApplicationRequest(new Request(url,settings),{db,now:()=>f.now,identityProviders:f.providers});assert.ok(response);f.calls.push({method:settings.method||'GET',path:new URL(url).pathname,status:response.status});if(f.transportAfter){const next=await f.transportAfter(new URL(url).pathname,response,settings);if(next!==undefined)response=next;}return response;};
 f.bound=async(user='creator-a',key=pair())=>{if(f.actors.has(user))return f.actors.get(user);const token=f.bootstrap(user),c=ok(await f.call('/api/auth/devices/enrollment-challenges',{token,method:'POST',body:{publicKey:key.encoded,displayName:'Synthetic '+user,platform:'win32',currentPassword:PASSWORD}}),[201]).data.challenge,session=ok(await f.call('/api/auth/devices/enroll',{token,method:'POST',body:{challengeId:c.challengeId,signature:sign(null,challengeBytes(c),key.privateKey).toString('base64url')}}),[201]).data;const actor={user,key,session};f.actors.set(user,actor);return actor;};
 f.prove=async(user,key,{token=f.bootstrap(user)}={})=>{const c=ok(await f.call('/api/auth/devices/proof-challenges',{token,method:'POST',body:{publicKey:key.encoded}}),[201]).data.challenge,session=ok(await f.call('/api/auth/devices/prove',{token,method:'POST',body:{challengeId:c.challengeId,signature:sign(null,challengeBytes(c),key.privateKey).toString('base64url')}})).data;const actor={user,key,session};f.actors.set(user,actor);return actor;};
 f.signed=(route,{actor,method='GET',body,rawBody,serialized,headers={},nonce=randomBytes(32).toString('base64url')}={})=>{const input=Buffer.from(serialized??(rawBody===undefined?(body===undefined?'':JSON.stringify(body)):rawBody)),s=actor.session,url=new URL(ORIGIN+route),fields={serverId:s.lease.serverId,userId:actor.user,sessionBinding:digest(s.token),deviceId:s.device.id,bindingRevision:s.device.revision,leaseId:s.lease.id,method,pathAndQuery:url.pathname+url.search,bodySha256:digest(input),nonce};return f.request(route,{token:s.token,method,...(body!==undefined?{body}:{}),...(rawBody!==undefined?{rawBody}:{}),headers:{'X-Shenyi-Device-Lease':s.lease.token,'X-Shenyi-Device-Nonce':nonce,'X-Shenyi-Device-Body-SHA256':fields.bodySha256,'X-Shenyi-Device-Signature':sign(null,requestBytes(fields),actor.key.privateKey).toString('base64url'),...headers}});};
 f.protected=(route,options)=>f.send(f.signed(route,options));
 f.epoch=user=>Number(db.prepare('SELECT CAST(version AS TEXT) version FROM team_recovery_identity_epochs WHERE user_id=?').get(user)?.version??0);
 f.rev=(project='p-a',team='team-a')=>Number(db.prepare('SELECT CAST(revision AS TEXT) revision FROM team_project_access_projects WHERE team_id=? AND project_id=?').get(team,project)?.revision);
 f.grant=async({actor,user='delegate-a',project='p-a',team='team-a',read=true,manage=false,review=false,revision=f.rev(project,team),memberRevision=f.epoch(user),password=PASSWORD,extra={}}={})=>{actor??=await f.bound();return f.protected('/api/teams/'+team+'/projects/'+project+'/access',{actor,method:'POST',body:{revision,userId:user,memberRevision,read,manage,review,currentPassword:password,...extra}});};
 f.task=async({actor,project='p-a',team='team-a',revision=f.rev(project,team),title='Synthetic new task',instructions='Minimal synthetic instructions',extra={}}={})=>{actor??=await f.bound();return f.protected('/api/teams/'+team+'/projects/'+project+'/tasks',{actor,method:'POST',body:{revision,title,instructions,...extra}});};
 f.rows=table=>{const s=db.prepare('SELECT * FROM "'+table.replaceAll('"','""')+'"');s.setReadBigInts(true);return s.all().map(row=>JSON.stringify(Object.keys(row).sort().map(k=>[k,row[k] instanceof Uint8Array?['blob',Buffer.from(row[k]).toString('base64')]:typeof row[k]==='bigint'?['int',String(row[k])]:row[k]]))).sort();};
 f.snapshot=()=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('team_auth_limits','team_device_request_replays') ORDER BY name").all().map(({name})=>[name,f.rows(name)]));
 return f;
}
const eventCount=f=>f.db.prepare('SELECT COUNT(*) n FROM team_project_access_events').get().n;
const noChange=async(f,action,statuses)=>{const before=f.snapshot(),r=deny(await action(),statuses);assert.deepEqual(f.snapshot(),before);return r;};
const fileRoute=(submission,{project='p-a',task='t-a',team='team-a'}={})=>'/api/teams/'+team+'/projects/'+project+'/tasks/'+task+'/submissions/'+submission+'/file';
const history=(project='p-a',task='t-a',team='team-a')=>'/api/teams/'+team+'/projects/'+project+'/tasks/'+task+'/submissions';
const originalBytes=Buffer.from('Synthetic project original.\0\r\n原件; no client data.');
async function upload(f,{user='intern-a',task='t-a',revision=0,bytes=originalBytes}={}){const actor=await f.bound(user);return ok(await f.protected(LEGACY+'/'+task+'/submissions',{actor,method:'POST',body:{filename:'synthetic-project.bin',contentBase64:bytes.toString('base64'),revision}}),[201]).data.submission;}

test('new project APIs cannot be used with diagnostic proof disabled or bootstrap/copied identity metadata',async t=>{
 const f=await fixture(t),actor=await f.bound();f.providers.deviceProofRequired=false;
 for(const [route,method,body]of [[ACCESS,'GET'],[BASE,'GET'],[PROJECT,'GET'],[PROJECT+'/tasks','GET'],[PROJECT+'/members','GET'],[history(),'GET'],[fileRoute('missing-submission'),'GET'],[PROJECT+'/tasks','POST',{revision:f.rev(),title:'Synthetic',instructions:''}]])await noChange(f,()=>f.call(route,{token:actor.session.token,method,body,headers:{'X-Shenyi-Device-Lease':actor.session.lease.token,'X-User-Id':'creator-a'}}),[403]);
});

test('without an actual sidecar all new project routes stay closed while the old collection path remains intact',async t=>{
 const f=await fixture(t,{managed:false}),actor=await f.bound();f.db.prepare("INSERT INTO team_project_grants VALUES ('team-a','p-a','creator-a','collection.read','active')").run();f.db.prepare("INSERT INTO team_project_grants VALUES ('team-a','p-a','creator-a','collection.manage','active')").run();
 assert.deepEqual(ok(await f.protected(BASE,{actor})).data,{projects:[],hasMore:false});for(const route of [PROJECT,PROJECT+'/tasks',PROJECT+'/members',history(),fileRoute('missing-submission')])deny(await f.protected(route,{actor}),[404]);
 assert.equal(ok(await f.protected(LEGACY,{actor})).data.tasks.length,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_project_access_projects').get().n,0);
 await noChange(f,()=>f.protected(BASE,{actor,method:'POST',body:{title:'Do not create',createdBy:'creator-a'}}),[404]);
});

for(const user of ['intern-a','assistant-a','tech-a','platform-owner','recovery-owner','access-owner','device-owner','creator-b'])test(user+' has no inherited project ownership or cross-team catalog access',async t=>{
 const f=await fixture(t),actor=await f.bound(user);deny(await f.protected(PROJECT,{actor}),[404]);deny(await f.protected(PROJECT+'/members',{actor}),[404]);await noChange(f,()=>f.grant({actor,user:'delegate-a'}),[404]);await noChange(f,()=>f.task({actor}),[404]);
});

test('owner alone exposes only the minimal project header and does not imply collection read/manage/review',async t=>{
 const f=await fixture(t);f.seedScope('p-a','creator-a',{owner:true});const actor=await f.bound(),r=ok(await f.protected(PROJECT,{actor}));assert.deepEqual(Object.keys(r.data.project).sort(),['id','title','status','revision','canRead','canManageAccess','canCreateTask','canReview'].sort());assert.equal(r.data.project.canRead,false);assert.equal(r.data.project.canManageAccess,true);assert.equal(r.data.project.canCreateTask,false);assert.equal(r.data.project.canReview,false);assert.doesNotMatch(r.raw,/PRIVATE|created_by|request_sha|phone|financial|structure/);deny(await f.protected(PROJECT+'/tasks',{actor}),[404]);deny(await f.protected(history(),{actor}),[404]);
});

for(const [read,manage,review]of [[true,false,false],[true,true,false],[true,false,true],[false,true,true]])test('read/manage/review matrix '+[read,manage,review].join('/')+' does not imply owner or another capability',async t=>{
 const f=await fixture(t);f.seedScope('p-a','reviewer-a',{read,manage,review});const actor=await f.bound('reviewer-a');
 if(!read){deny(await f.protected(PROJECT,{actor}),[404]);deny(await f.protected(PROJECT+'/tasks',{actor}),[404]);deny(await f.protected(history(),{actor}),[404]);return;}
 const view=ok(await f.protected(PROJECT,{actor})).data.project;assert.equal(view.canRead,true);assert.equal(view.canManageAccess,false);assert.equal(view.canCreateTask,manage);assert.equal(view.canReview,review);ok(await f.protected(PROJECT+'/tasks',{actor}));deny(await f.protected(PROJECT+'/members',{actor}),[404]);await noChange(f,()=>f.grant({actor,user:'none-a'}),[404]);
 if(review)ok(await f.protected(history(),{actor}));else deny(await f.protected(history(),{actor}),[404]);
});

for(const [table,permission]of Object.entries(reviewers))for(const status of ['active','revoked'])test('ordinary recipient with '+status+' historical '+table+' is excluded before grant and member paging',async t=>{
 const f=await fixture(t),actor=await f.bound();f.db.prepare('INSERT INTO '+table+'(user_id,permission,status) VALUES (?,?,?)').run('delegate-a',permission,status);const listed=ok(await f.protected(PROJECT+'/members',{actor}));assert.ok(!listed.data.members.some(m=>m.id==='delegate-a'));await noChange(f,()=>f.grant({actor}),[404]);
});

for(const kind of ['self','junior','foreign','operator-history','multi-history','disabled-member','disabled-account'])test('project access rejects '+kind+' recipient without partial changes',async t=>{
 const f=await fixture(t),actor=await f.bound();let user='delegate-a';if(kind==='self')user='creator-a';if(kind==='junior')user='intern-a';if(kind==='foreign')user='creator-b';
 if(kind==='operator-history')f.db.prepare("INSERT INTO team_operators VALUES ('team-a','delegate-a','administrator','revoked')").run();if(kind==='multi-history')f.db.prepare("INSERT INTO team_memberships VALUES ('team-b','delegate-a','manager','disabled')").run();if(kind==='disabled-member')f.db.prepare("UPDATE team_memberships SET status='disabled' WHERE user_id='delegate-a'").run();if(kind==='disabled-account')f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='delegate-a'").run();
 await noChange(f,()=>f.grant({actor,user}),[404]);
});

test('scoped reviewer gets an original without a legacy attachment grant, and the old own-history endpoint stays private',async t=>{
 const f=await fixture(t),submission=await upload(f);f.seedScope('p-a','reviewer-a',{read:true,review:true});const reviewer=await f.bound('reviewer-a');
 const list=ok(await f.protected(history(),{actor:reviewer}));assert.equal(list.data.submissions.length,1);const row=list.data.submissions[0];assert.deepEqual(Object.keys(row).sort(),['id','attachmentId','filename','sha256','byteLength','createdAt','submittedBy'].sort());assert.deepEqual(Object.keys(row.submittedBy).sort(),['id','displayName'].sort());assert.equal(row.submittedBy.id,'intern-a');assert.equal(row.sha256,digest(originalBytes));assert.equal(row.byteLength,originalBytes.length);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_attachment_grants WHERE user_id='reviewer-a'").get().n,0);const file=ok(await f.protected(fileRoute(submission.id),{actor:reviewer}));assert.deepEqual(file.bytes,originalBytes);
 deny(await f.protected(LEGACY+'/t-a/attachments/'+submission.attachmentId,{actor:reviewer}),[404]);assert.deepEqual(ok(await f.protected(LEGACY+'/t-a/submissions',{actor:reviewer})).data.submissions,[]);
 for(const route of [fileRoute(submission.id,{project:'p-other'}),fileRoute(submission.id,{task:'t-second'}),fileRoute(submission.id,{team:'team-b',project:'p-b',task:'t-b'})])deny(await f.protected(route,{actor:reviewer}),[404]);
});

test('manage and old attachment grant do not substitute for independent review authority',async t=>{
 const f=await fixture(t),submission=await upload(f);f.seedScope('p-a','delegate-a',{read:true,manage:true});f.db.prepare("INSERT INTO team_attachment_grants VALUES ('team-a',?,'delegate-a','active')").run(submission.attachmentId);const actor=await f.bound('delegate-a');deny(await f.protected(history(),{actor}),[404]);deny(await f.protected(fileRoute(submission.id),{actor}),[404]);const head=deny(await f.protected(fileRoute(submission.id),{actor,method:'HEAD'}),[404]);assert.equal(head.bytes.length,0);
});

test('trusted registration creates metadata only and never silently mints owner or collection permissions',async t=>{
 const f=await fixture(t,{managed:false});f.register({teamId:'team-a',projectId:'p-a',createdBy:'creator-a',at:NOW});assert.equal(f.rev(),1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_project_access_grants').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_project_grants').get().n,0);const actor=await f.bound();deny(await f.protected(PROJECT,{actor}),[404]);assert.deepEqual(ok(await f.protected(BASE,{actor})).data.projects,[]);
});

for(const column of ['team_id','project_id','created_by','created_at','request_id','request_sha256'])test('immutable sidecar '+column+' cannot be rewritten, even when no client endpoint exists',async t=>{
 const f=await fixture(t),before=f.snapshot(),values={team_id:'team-b',project_id:'p-other',created_by:'delegate-a',created_at:NOW+1,request_id:randomUUID(),request_sha256:'a'.repeat(64)};
 assert.throws(()=>f.db.prepare('UPDATE team_project_access_projects SET '+column+'=? WHERE team_id=? AND project_id=?').run(values[column],'team-a','p-a'));assert.deepEqual(f.snapshot(),before);
});

test('sidecar delete/rebuild and owner misgrant cannot transfer ownership or erase creator history',async t=>{
 const f=await fixture(t),before=f.snapshot();assert.throws(()=>f.db.prepare("DELETE FROM team_project_access_projects WHERE team_id='team-a' AND project_id='p-a'").run());assert.throws(()=>f.db.prepare("INSERT INTO team_project_access_grants(team_id,project_id,user_id,permission,status) VALUES ('team-a','p-a','delegate-a','project.owner','active')").run());assert.throws(()=>f.db.prepare("UPDATE team_project_access_grants SET user_id='delegate-a' WHERE project_id='p-a' AND permission='project.owner'").run());assert.throws(()=>f.register({teamId:'team-a',projectId:'p-a',createdBy:'delegate-a',at:NOW+1}));assert.deepEqual(f.snapshot(),before);
});

test('legacy grant/status ABA advances managed revision and never registers an unmanaged project',async t=>{
 const f=await fixture(t),before=f.rev();f.db.prepare("UPDATE team_project_grants SET status='revoked' WHERE project_id='p-a' AND user_id='creator-a' AND permission='collection.read'").run();f.db.prepare("UPDATE team_project_grants SET status='active' WHERE project_id='p-a' AND user_id='creator-a' AND permission='collection.read'").run();assert.equal(f.rev(),before+2);
 const at=f.rev();f.db.prepare("UPDATE team_projects SET status='frozen' WHERE project_id='p-a'").run();f.db.prepare("UPDATE team_projects SET status='active' WHERE project_id='p-a'").run();assert.equal(f.rev(),at+2);
 f.db.prepare("INSERT INTO team_project_grants VALUES ('team-a','p-legacy','creator-a','collection.read','active')").run();f.db.prepare("UPDATE team_projects SET title='Legacy metadata update' WHERE project_id='p-legacy'").run();assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_project_access_projects WHERE project_id='p-legacy'").get().n,0);
});

test('wrong password, stale project/member versions and semantic no-op preserve all scope and audit',async t=>{
 const f=await fixture(t),actor=await f.bound();await noChange(f,()=>f.grant({actor,password:'SyntheticWrong!2026'}),[403]);await noChange(f,()=>f.grant({actor,revision:f.rev()-1}),[409]);await noChange(f,()=>f.grant({actor,memberRevision:f.epoch('delegate-a')-1}),[409]);f.seedScope('p-a','delegate-a',{read:true});await noChange(f,()=>f.grant({actor}),[409]);assert.equal(eventCount(f),0);
});

test('access input is exact, boolean and read-dependent, and does not accept client identity or owner fields',async t=>{
 const f=await fixture(t),actor=await f.bound();for(const extra of [{owner:true},{createdBy:'delegate-a'},{role:'partner'},{token:'Synthetic secret'},{confirmed:true},{projectId:'p-b'}])await noChange(f,()=>f.grant({actor,extra}),[400]);
 for(const flags of [{read:false,manage:true},{read:false,review:true},{read:'true'},{manage:1}])await noChange(f,()=>f.grant({actor,...flags}),[400]);
 for(const query of ['?q=a&q=b','?limit=51','?after=bad%2Fcursor','?q='+encodeURIComponent('\u202E')])deny(await f.protected(BASE+query,{actor}),[400]);
 const head=await f.protected(PROJECT+'/tasks',{actor,method:'HEAD'});assert.equal(head.status,405);assert.equal(head.bytes.length,0);
});

test('a nonowner with explicit read/manage creates a UUID task at version zero without assignment or audit authority',async t=>{
 const f=await fixture(t);f.seedScope('p-a','delegate-a',{read:true,manage:true});const actor=await f.bound('delegate-a'),before=f.rev(),result=ok(await f.task({actor,instructions:''}),[201]);assert.deepEqual(Object.keys(result.data).sort(),['revision','task']);assert.match(result.data.task.id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.equal(result.data.task.revision,0);assert.equal(result.data.task.status,'open');assert.equal(result.data.revision,before+1);assert.equal(f.rev(),before+1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_task_assignments WHERE task_id=?').get(result.data.task.id).n,0);assert.equal(f.db.prepare('SELECT revision FROM team_task_versions WHERE task_id=?').get(result.data.task.id).revision,0);deny(await f.protected(PROJECT+'/members',{actor}),[404]);
 const event=f.db.prepare('SELECT * FROM team_project_access_events').get();assert.equal(event.actor_id,'delegate-a');assert.equal(event.task_id,result.data.task.id);assert.equal(event.action,'task.created');assert.equal(event.before_revision,before);assert.equal(event.after_revision,result.data.revision);
});

test('task creation rejects missing manage, stale version, forbidden fields and invalid task text without partial tasks',async t=>{
 const f=await fixture(t),actor=await f.bound();for(const input of [{title:''},{title:'x'.repeat(161)},{title:'Bad\u0000title'},{instructions:'x'.repeat(4001)},{instructions:'Bad\u202Etext'},{extra:{userId:'intern-a'}},{extra:{confirmed:true}},{revision:f.rev()-1}])await noChange(f,()=>f.task({actor,...input}),input.revision!==undefined?[409]:[400]);
 f.seedScope('p-a','reader-a',{read:true});const reader=await f.bound('reader-a');await noChange(f,()=>f.task({actor:reader}),[404]);
});

test('complete read=false removal is project-local, revokes every target token and increments each affected task once',async t=>{
 const f=await fixture(t),submission=await upload(f),other=await upload(f,{task:'t-other'}),owner=await f.bound();f.seedScope('p-a','delegate-a',{read:true,manage:true,review:true});
 for(const task of ['t-a','t-second','t-other'])f.db.prepare("INSERT INTO team_task_assignments VALUES ('team-a',?,'delegate-a','active')").run(task);for(const id of [submission.attachmentId,other.attachmentId])f.db.prepare("INSERT INTO team_attachment_grants VALUES ('team-a',?,'delegate-a','active')").run(id);
 const target=await f.bound('delegate-a'),bootstrap=f.bootstrap('delegate-a'),challenge=ok(await f.call('/api/auth/devices/proof-challenges',{token:bootstrap,method:'POST',body:{publicKey:target.key.encoded}}),[201]).data.challenge;
 const credentials=f.rows('team_credentials'),phone=f.rows('team_phone_credentials'),wechat=f.rows('team_wechat_identities'),bindings=f.rows('team_device_bindings'),original=f.rows('team_collection_attachments'),submissions=f.rows('team_task_submissions');
 const unrelatedGrants=f.db.prepare("SELECT * FROM team_project_access_grants WHERE project_id='p-other' ORDER BY permission").all(),result=ok(await f.grant({actor:owner,read:false,manage:false,review:false}));assert.ok(result.data.revision>1);assert.equal(result.data.revision,f.rev());
 for(const table of ['team_project_grants','team_project_access_grants'])assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+table+" WHERE project_id='p-a' AND user_id='delegate-a' AND status='active'").get().n,0);
 for(const task of ['t-a','t-second'])assert.equal(f.db.prepare("SELECT status FROM team_task_assignments WHERE task_id=? AND user_id='delegate-a'").get(task).status,'revoked');assert.equal(f.db.prepare("SELECT status FROM team_task_assignments WHERE task_id='t-other' AND user_id='delegate-a'").get().status,'active');
 assert.equal(f.db.prepare("SELECT status FROM team_attachment_grants WHERE attachment_id=? AND user_id='delegate-a'").get(submission.attachmentId).status,'revoked');assert.equal(f.db.prepare("SELECT status FROM team_attachment_grants WHERE attachment_id=? AND user_id='delegate-a'").get(other.attachmentId).status,'active');
 assert.equal(f.db.prepare("SELECT revision FROM team_task_versions WHERE task_id='t-a'").get().revision,2);assert.equal(f.db.prepare("SELECT revision FROM team_task_versions WHERE task_id='t-second'").get().revision,1);assert.equal(f.db.prepare("SELECT revision FROM team_task_versions WHERE task_id='t-other'").get().revision,1);
 assert.deepEqual(f.db.prepare("SELECT * FROM team_project_access_grants WHERE project_id='p-other' ORDER BY permission").all(),unrelatedGrants);for(const [table,expected]of [['team_credentials',credentials],['team_phone_credentials',phone],['team_wechat_identities',wechat],['team_device_bindings',bindings],['team_collection_attachments',original],['team_task_submissions',submissions]])assert.deepEqual(f.rows(table),expected,table);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_sessions WHERE user_id='delegate-a' AND revoked_at IS NULL").get().n,0);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_device_leases WHERE user_id='delegate-a' AND revoked_at IS NULL").get().n,0);assert.ok(f.db.prepare('SELECT revoked_at FROM team_device_challenges WHERE challenge_id=?').get(challenge.challengeId).revoked_at!==null);
 deny(await f.protected(PROJECT,{actor:target}),[401]);const fresh=await f.prove('delegate-a',target.key);deny(await f.protected(PROJECT,{actor:fresh}),[404]);assert.equal(ok(await f.protected(BASE+'/p-other',{actor:fresh})).data.project.canManageAccess,true);
});

test('read=false clears surviving legacy assignment/attachment access even when all wide flags were already false',async t=>{
 const f=await fixture(t),submission=await upload(f),owner=await f.bound();f.db.prepare("INSERT INTO team_task_assignments VALUES ('team-a','t-a','delegate-a','active')").run();f.db.prepare("INSERT INTO team_attachment_grants VALUES ('team-a',?,'delegate-a','active')").run(submission.attachmentId);const target=await f.bound('delegate-a');ok(await f.protected(LEGACY+'/t-a/attachments/'+submission.attachmentId,{actor:target}));const before=f.rev();ok(await f.grant({actor:owner,read:false,manage:false,review:false}));assert.ok(f.rev()>before);assert.equal(f.db.prepare("SELECT status FROM team_task_assignments WHERE user_id='delegate-a'").get().status,'revoked');assert.equal(f.db.prepare("SELECT status FROM team_attachment_grants WHERE user_id='delegate-a'").get().status,'revoked');assert.equal(f.db.prepare("SELECT revision FROM team_task_versions WHERE task_id='t-a'").get().revision,2);
});

test('review HEAD authorizes without reading or materializing the original blob',async t=>{
 const f=await fixture(t),submission=await upload(f);f.seedScope('p-a','reviewer-a',{read:true,review:true});const actor=await f.bound('reviewer-a'),{constants}=require('node:sqlite'),reads=[];f.db.setAuthorizer((action,table,column)=>{if(action===constants.SQLITE_READ){reads.push({table,column});if(table==='team_collection_attachments'&&column==='bytes')return constants.SQLITE_DENY;}return constants.SQLITE_OK;});
 try{const head=ok(await f.protected(fileRoute(submission.id),{actor,method:'HEAD'}));assert.equal(head.bytes.length,0);assert.equal(reads.some(r=>r.table==='team_collection_attachments'&&r.column==='bytes'),false);assert.equal(head.headers.get('cache-control'),'private, no-store, max-age=0');deny(await f.protected(fileRoute(submission.id),{actor}),[503]);assert.ok(reads.some(r=>r.table==='team_collection_attachments'&&r.column==='bytes'));}finally{f.db.setAuthorizer(null);}
});

test('every review HEAD error is bodyless and does not reveal names, paths or foreign resources',async t=>{
 const f=await fixture(t),submission=await upload(f),actor=await f.bound('reader-a');for(const id of [submission.id,'unknown-submission']){const r=deny(await f.protected(fileRoute(id),{actor,method:'HEAD'}),[404]);assert.equal(r.bytes.length,0);assert.equal(r.headers.get('content-disposition'),null);}
 f.seedScope('p-a','reader-a',{read:true,review:true});const cross=f.signed(fileRoute(submission.id),{actor,method:'HEAD',headers:{Origin:'https://hostile.synthetic.invalid'}}),r=deny(await f.send(cross),[403]);assert.equal(r.bytes.length,0);
});

const roleChange=(f,admin,user,role)=>f.protected('/api/teams/team-a/business-role-members/'+user+'/role',{actor:admin,method:'POST',body:{revision:f.epoch(user),role,currentPassword:PASSWORD}});
test('a creator downgraded then promoted never regains old owner authority and remains an ordinary HR target',async t=>{
 const f=await fixture(t),admin=await f.bound('tech-a'),owner=await f.bound();f.seedScope('p-a','delegate-a',{read:true,manage:true,review:true});const delegate=await f.bound('delegate-a'),otherFlags=f.db.prepare("SELECT * FROM team_project_grants WHERE project_id='p-a' AND user_id='delegate-a' ORDER BY permission").all();
 const members=ok(await f.protected('/api/teams/team-a/business-role-members',{actor:admin}));assert.ok(members.data.members.some(row=>row.id==='creator-a'));ok(await roleChange(f,admin,'creator-a','intern'));ok(await roleChange(f,admin,'creator-a','manager'));
 assert.equal(f.db.prepare("SELECT created_by FROM team_project_access_projects WHERE project_id='p-a'").get().created_by,'creator-a');assert.equal(f.db.prepare("SELECT status FROM team_project_access_grants WHERE project_id='p-a' AND user_id='creator-a' AND permission='project.owner'").get().status,'revoked');
 const fresh=await f.prove('creator-a',owner.key);deny(await f.protected(PROJECT,{actor:fresh}),[404]);await noChange(f,()=>f.grant({actor:fresh,user:'none-a'}),[404]);assert.throws(()=>f.register({teamId:'team-a',projectId:'p-a',createdBy:'creator-a',at:NOW}));
 assert.deepEqual(f.db.prepare("SELECT * FROM team_project_grants WHERE project_id='p-a' AND user_id='delegate-a' ORDER BY permission").all(),otherFlags);const created=ok(await f.task({actor:delegate}),[201]);assert.equal(created.data.task.status,'open');
});

test('disabling the creator revokes their owner ACL without canceling another effective senior grant',async t=>{
 const f=await fixture(t),admin=await f.bound('tech-a'),owner=await f.bound();f.seedScope('p-a','delegate-a',{read:true,manage:true,review:true});const delegate=await f.bound('delegate-a');ok(await f.protected('/api/teams/team-a/business-members/creator-a/disable',{actor:admin,method:'POST',body:{revision:f.epoch('creator-a'),currentPassword:PASSWORD}}));
 assert.equal(f.db.prepare("SELECT status FROM team_users WHERE user_id='creator-a'").get().status,'disabled');assert.equal(f.db.prepare("SELECT status FROM team_project_access_grants WHERE project_id='p-a' AND permission='project.owner'").get().status,'revoked');deny(await f.protected(PROJECT,{actor:owner}),[401]);assert.equal(ok(await f.protected(PROJECT,{actor:delegate})).data.project.canReview,true);ok(await f.task({actor:delegate}),[201]);
});

test('normal password change rotates the creator session but preserves their permanent project authority',async t=>{
 const f=await fixture(t),owner=await f.bound(),before=f.rows('team_project_access_grants'),revision=f.rev(),newPassword='FreshProjectOwner!2026';ok(await f.protected('/api/auth/password',{actor:owner,method:'POST',body:{currentPassword:PASSWORD,newPassword}}));const login=ok(await f.call('/api/auth/login',{method:'POST',body:{username:'creator-a',password:newPassword}}));const fresh=await f.prove('creator-a',owner.key,{token:login.data.token});assert.deepEqual(f.rows('team_project_access_grants'),before);assert.equal(f.rev(),revision);assert.equal(ok(await f.protected(PROJECT,{actor:fresh})).data.project.canManageAccess,true);deny(await f.protected(PROJECT,{actor:owner}),[401]);
});

test('an actual approved same-user device replacement preserves owner ACL without keeping the old token alive',async t=>{
 const f=await fixture(t),old=await f.bound(),admin=await f.bound('tech-a'),before=f.rows('team_project_access_grants'),revision=f.rev(),token=f.bootstrap('creator-a'),key=pair();
 const challenge=ok(await f.call('/api/auth/device-replacements/request-challenges',{token,method:'POST',body:{publicKey:key.encoded,displayName:'Synthetic replacement',platform:'darwin',currentPassword:PASSWORD}}),[201]).data.challenge;let request=ok(await f.call('/api/auth/device-replacements/request',{token,method:'POST',body:{challengeId:challenge.challengeId,signature:sign(null,replacementBytes(challenge),key.privateKey).toString('base64url')}}),[201]).data.request;
 request=ok(await f.protected('/api/account/device-replacement-reviews/'+request.id+'/review',{actor:admin,method:'POST',body:{decision:'approve',revision:request.revision,currentPassword:PASSWORD}})).data.request;
 const activate=ok(await f.call('/api/auth/device-replacements/activate-challenges',{token,method:'POST',body:{requestId:request.id,revision:request.revision,publicKey:key.encoded}}),[201]).data.challenge,session=ok(await f.call('/api/auth/device-replacements/activate',{token,method:'POST',body:{challengeId:activate.challengeId,signature:sign(null,replacementBytes(activate),key.privateKey).toString('base64url')}})).data;
 const fresh={user:'creator-a',key,session};assert.deepEqual(f.rows('team_project_access_grants'),before);assert.equal(f.rev(),revision);assert.equal(ok(await f.protected(PROJECT,{actor:fresh})).data.project.canManageAccess,true);deny(await f.protected(PROJECT,{actor:old}),[401]);assert.notEqual(session.device.id,old.session.device.id);
});

function onPassword(t,f,mutate){const prepare=f.db.prepare;let fired=false;f.db.prepare=function(sql){const statement=prepare.call(this,sql);if(/^INSERT INTO team_auth_limits/.test(sql)){const run=statement.run;statement.run=function(...args){const result=run.apply(this,args);if(!fired&&String(args[0]).startsWith('project-access:')){fired=true;queueMicrotask(mutate);}return result;};}return statement;};t.after(()=>f.db.prepare=prepare);return ()=>fired;}
function onFinalTransaction(t,f,mutate){const exec=f.db.exec;let count=0,fired=false;f.db.exec=function(sql){if(/^BEGIN IMMEDIATE/.test(sql)&&++count===2){fired=true;mutate();}return exec.call(this,sql);};t.after(()=>f.db.exec=exec);return ()=>fired;}
const races={
 'owner ACL ABA':f=>{f.db.prepare("UPDATE team_project_access_grants SET status='revoked',revision=revision+1 WHERE project_id='p-a' AND permission='project.owner'").run();f.db.prepare("UPDATE team_project_access_grants SET status='active',revision=revision+1 WHERE project_id='p-a' AND permission='project.owner'").run();},
 'legacy read grant ABA':f=>{f.db.prepare("UPDATE team_project_grants SET status='revoked' WHERE project_id='p-a' AND user_id='creator-a' AND permission='collection.read'").run();f.db.prepare("UPDATE team_project_grants SET status='active' WHERE project_id='p-a' AND user_id='creator-a' AND permission='collection.read'").run();},
 'owner credential ABA':f=>{const row=f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='creator-a'").get();f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='creator-a'").run();f.db.prepare("UPDATE team_credentials SET password_hash=?,revision=? WHERE user_id='creator-a'").run(row.password_hash,row.revision);},
 'project freeze ABA':f=>{f.db.prepare("UPDATE team_projects SET status='frozen' WHERE project_id='p-a'").run();f.db.prepare("UPDATE team_projects SET status='active' WHERE project_id='p-a'").run();},
 'target role ABA':f=>{f.db.prepare("UPDATE team_memberships SET role='partner' WHERE user_id='delegate-a'").run();f.db.prepare("UPDATE team_memberships SET role='manager' WHERE user_id='delegate-a'").run();},
 'target reviewer history':f=>f.db.prepare("INSERT INTO team_device_replacement_reviewers(user_id,permission,status) VALUES ('delegate-a','device.replace','revoked')").run(),
 'target foreign history':f=>f.db.prepare("INSERT INTO team_memberships VALUES ('team-b','delegate-a','manager','disabled')").run(),
 'actor token revoked':f=>f.db.prepare("UPDATE team_sessions SET revoked_at=? WHERE user_id='creator-a'").run(f.now),
};
for(const phase of ['KDF','final BEGIN'])for(const [name,mutate]of Object.entries(races))test(name+' during '+phase+' cannot authorize the displayed stale grant action',async t=>{
 const f=await fixture(t),owner=await f.bound();let expected;const fired=(phase==='KDF'?onPassword:onFinalTransaction)(t,f,()=>{mutate(f);expected=f.snapshot();});deny(await f.grant({actor:owner}),[401,403,404,409]);assert.equal(fired(),true);assert.deepEqual(f.snapshot(),expected);assert.equal(eventCount(f),0);
});

test('a grant held after real KDF completion cannot commit after the actor rotates to a new actual leased token',async t=>{
 const f=await fixture(t),owner=await f.bound(),hold={entered:deferred(),release:deferred()};t.after(()=>hold.release.resolve());kdfHold=hold;const pending=f.grant({actor:owner});await hold.entered.promise;const fresh=await f.prove('creator-a',owner.key);hold.release.resolve();deny(await pending,[401,403,409]);assert.equal(ok(await f.protected(PROJECT,{actor:fresh})).data.project.canManageAccess,true);assert.equal(eventCount(f),0);
});

test('an old real password KDF cannot commit after project permission change revokes that target session',async t=>{
 const f=await fixture(t),owner=await f.bound();f.seedScope('p-a','delegate-a',{read:true,manage:true});const target=await f.bound('delegate-a'),before=f.rows('team_credentials'),hold={entered:deferred(),release:deferred()};t.after(()=>hold.release.resolve());kdfHold=hold;const pending=f.protected('/api/auth/password',{actor:target,method:'POST',body:{currentPassword:PASSWORD,newPassword:'NeverCommittedProject!2026'}});await hold.entered.promise;ok(await f.grant({actor:owner,read:false}));hold.release.resolve();deny(await pending,[401]);assert.deepEqual(f.rows('team_credentials'),before);
});

test('revoking and regranting project scope cannot revive an old collection assignment body or token',async t=>{
 const f=await fixture(t),owner=await f.bound();f.seedScope('p-a','delegate-a',{read:true,manage:true});const target=await f.bound('delegate-a'),raw=JSON.stringify({userId:'intern-a',revision:0}),entered=deferred();let controller;
 const body=new ReadableStream({start(value){controller=value;},pull(){entered.resolve();}},{highWaterMark:0}),pending=f.send(f.signed(LEGACY+'/t-a/assignment',{actor:target,method:'POST',rawBody:body,serialized:raw}));await entered.promise;ok(await f.grant({actor:owner,read:false}));ok(await f.grant({actor:owner,read:true,manage:true}));controller.enqueue(Buffer.from(raw));controller.close();deny(await pending,[401,409]);assert.equal(f.db.prepare("SELECT COALESCE(MAX(revision),0) version FROM team_task_versions WHERE task_id='t-a'").get().version,0);assert.equal(f.db.prepare("SELECT status FROM team_task_assignments WHERE task_id='t-a' AND user_id='intern-a'").get().status,'active');
});

for(const scenario of ['grant target ABA','task creator role change'])test('signed streamed body observes '+scenario+' before any new write',async t=>{
 const f=await fixture(t),owner=await f.bound(),admin=await f.bound('tech-a'),isGrant=scenario==='grant target ABA',raw=JSON.stringify(isGrant?{revision:f.rev(),userId:'delegate-a',memberRevision:f.epoch('delegate-a'),read:true,manage:false,review:false,currentPassword:PASSWORD}:{revision:f.rev(),title:'Late synthetic task',instructions:''}),entered=deferred();let controller;
 const body=new ReadableStream({start(value){controller=value;},pull(){entered.resolve();}},{highWaterMark:0}),pending=f.send(f.signed(PROJECT+(isGrant?'/access':'/tasks'),{actor:owner,method:'POST',rawBody:body,serialized:raw}));await entered.promise;if(isGrant)races['target role ABA'](f);else ok(await roleChange(f,admin,'creator-a','intern'));const before=f.snapshot();controller.enqueue(Buffer.from(raw));controller.close();deny(await pending,isGrant?[409]:[401,403,409]);assert.deepEqual(f.snapshot(),before);
});

for(const revision of [Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER-1])test('project version '+revision+' cannot overflow a multi-grant mutation or partially revoke a target token',async t=>{
 const f=await fixture(t),owner=await f.bound();await f.bound('delegate-a');f.db.prepare("UPDATE team_project_access_projects SET revision=? WHERE project_id='p-a'").run(revision);await noChange(f,()=>f.grant({actor:owner,read:true,manage:true,review:true}),[409]);
});

test('the final safe project revision can be reached by one operation and then disables further mutation capabilities',async t=>{
 const f=await fixture(t),owner=await f.bound();f.db.prepare("UPDATE team_project_access_projects SET revision=? WHERE project_id='p-a'").run(Number.MAX_SAFE_INTEGER-1);const result=ok(await f.grant({actor:owner}));assert.equal(result.data.revision,Number.MAX_SAFE_INTEGER);const view=ok(await f.protected(PROJECT,{actor:owner})).data.project;assert.equal(view.canManageAccess,false);assert.equal(view.canCreateTask,false);assert.equal(view.canReview,true);await noChange(f,()=>f.task({actor:owner}),[409]);
});

test('exhausted target review ACL and affected task counters both roll back all project changes',async t=>{
 const f=await fixture(t),owner=await f.bound();f.seedScope('p-a','delegate-a',{read:true,review:true});f.db.prepare("UPDATE team_project_access_grants SET revision=? WHERE project_id='p-a' AND user_id='delegate-a' AND permission='collection.review'").run(Number.MAX_SAFE_INTEGER);await noChange(f,()=>f.grant({actor:owner,read:false}),[409]);
 f.db.prepare("UPDATE team_project_access_grants SET revision=1 WHERE project_id='p-a' AND user_id='delegate-a' AND permission='collection.review'").run();f.db.prepare("INSERT INTO team_task_assignments VALUES ('team-a','t-a','delegate-a','active')").run();f.db.prepare("INSERT INTO team_task_versions VALUES ('team-a','t-a',?)").run(Number.MAX_SAFE_INTEGER);await noChange(f,()=>f.grant({actor:owner,read:false}),[409]);
});

for(const action of ['role','disable'])test('MAX project revision during '+action+' cleanup atomically preserves the existing account and all old authority',async t=>{
 const f=await fixture(t),admin=await f.bound('tech-a');await f.bound();f.db.prepare("UPDATE team_project_access_projects SET revision=? WHERE project_id='p-a'").run(Number.MAX_SAFE_INTEGER);await noChange(f,()=>action==='role'?roleChange(f,admin,'creator-a','intern'):f.protected('/api/teams/team-a/business-members/creator-a/disable',{actor:admin,method:'POST',body:{revision:f.epoch('creator-a'),currentPassword:PASSWORD}}),[409]);
});

for(const fault of ['access-audit','access-write','task-CAS','task-insert','task-version-insert'])test('forced '+fault+' failure leaves no partial ACL/session/project/task state',async t=>{
 const f=await fixture(t),owner=await f.bound();await f.bound('delegate-a');let remove=false;
 if(fault==='access-audit')f.db.exec("CREATE TRIGGER synthetic_project_audit BEFORE INSERT ON team_project_access_events BEGIN SELECT RAISE(ABORT,'Synthetic injected private-provider audit'); END");
 if(fault==='access-write')f.db.exec("CREATE TRIGGER synthetic_project_acl BEFORE INSERT ON team_project_access_grants BEGIN SELECT RAISE(ABORT,'Synthetic injected private-provider ACL'); END");
 if(fault==='task-CAS'){remove=true;f.seedScope('p-a','delegate-a',{read:true,review:true});f.db.prepare("INSERT INTO team_task_assignments VALUES ('team-a','t-a','delegate-a','active')").run();f.db.prepare("INSERT INTO team_task_versions VALUES ('team-a','t-a',0)").run();f.db.exec("CREATE TRIGGER synthetic_project_task_cas BEFORE UPDATE ON team_task_versions BEGIN SELECT RAISE(IGNORE); END");}
 if(fault==='task-insert')f.db.exec("CREATE TRIGGER synthetic_project_task_insert BEFORE INSERT ON team_collection_tasks BEGIN SELECT RAISE(ABORT,'Synthetic injected private-provider task'); END");
 if(fault==='task-version-insert')f.db.exec("CREATE TRIGGER synthetic_project_version_insert BEFORE INSERT ON team_task_versions BEGIN SELECT RAISE(ABORT,'Synthetic injected private-provider task version'); END");
 await noChange(f,()=>fault.startsWith('task-')&&fault!=='task-CAS'?f.task({actor:owner}):f.grant({actor:owner,read:!remove,review:!remove}),fault==='task-CAS'?[409]:[503]);assert.equal(eventCount(f),0);
});

test('frozen project stays reviewable but closes new writes while HR security revocation remains effective',async t=>{
 const f=await fixture(t),submission=await upload(f),owner=await f.bound(),admin=await f.bound('tech-a');f.db.prepare("UPDATE team_projects SET status='frozen' WHERE project_id='p-a'").run();const view=ok(await f.protected(PROJECT,{actor:owner})).data.project;assert.equal(view.canManageAccess,false);assert.equal(view.canCreateTask,false);assert.equal(view.canReview,true);ok(await f.protected(fileRoute(submission.id),{actor:owner,method:'HEAD'}));await noChange(f,()=>f.grant({actor:owner}),[409]);await noChange(f,()=>f.task({actor:owner}),[409]);ok(await roleChange(f,admin,'creator-a','partner'));assert.equal(f.db.prepare("SELECT status FROM team_projects WHERE project_id='p-a'").get().status,'frozen');assert.equal(f.db.prepare("SELECT status FROM team_project_access_grants WHERE project_id='p-a' AND permission='project.owner'").get().status,'revoked');
});

test('large foreign project populations are excluded by SQL before project pagination and cursor validation',async t=>{
 const f=await fixture(t),owner=await f.bound();for(let i=0;i<600;i++){const id='aa-foreign-'+String(i).padStart(4,'0');f.db.prepare("INSERT INTO team_projects(team_id,project_id,title,status) VALUES ('team-b',?,?,'active')").run(id,'FOREIGN PRIVATE '+i);f.register({teamId:'team-b',projectId:id,createdBy:'creator-b',at:NOW});f.db.prepare("INSERT INTO team_project_access_grants(team_id,project_id,user_id,permission,status) VALUES ('team-b',?,'creator-b','project.owner','active')").run(id);}
 for(let i=0;i<4;i++){const id='own-'+i;f.db.prepare("INSERT INTO team_projects(team_id,project_id,title,status) VALUES ('team-a',?,?,'active')").run(id,'Literal %_\\ '+i);f.register({teamId:'team-a',projectId:id,createdBy:'creator-a',at:NOW});f.db.prepare("INSERT INTO team_project_access_grants(team_id,project_id,user_id,permission,status) VALUES ('team-a',?,'creator-a','project.owner','active')").run(id);}
 const prepare=f.db.prepare,counts=[];f.db.prepare=function(sql){const statement=prepare.call(this,sql);if(/^SELECT/i.test(sql.trim())){const all=statement.all;statement.all=function(...args){const rows=all.apply(this,args);counts.push(rows.length);return rows;};}return statement;};t.after(()=>f.db.prepare=prepare);
 const first=ok(await f.protected(BASE+'?limit=2',{actor:owner}));assert.deepEqual(first.data.projects.map(p=>p.id),['own-0','own-1']);assert.equal(first.data.hasMore,true);assert.ok(counts.every(n=>n<=3),'No foreign candidate set may be materialized then filtered');assert.doesNotMatch(first.raw,/FOREIGN|PRIVATE|financial|structure|created_by|phone/);
 const literal=ok(await f.protected(BASE+'?'+new URLSearchParams({q:'%_\\',limit:'2'}),{actor:owner}));assert.deepEqual(literal.data.projects.map(p=>p.id),['own-0','own-1']);const foreign=deny(await f.protected(BASE+'?after=aa-foreign-0000',{actor:owner}),[404]),unknown=deny(await f.protected(BASE+'?after=missing-project',{actor:owner}),[404]);assert.equal(foreign.raw,unknown.raw);
});

test('candidate SQL excludes large foreign staff sets and scoped search/cursor never reveal their private metadata',async t=>{
 const f=await fixture(t),owner=await f.bound();for(let i=0;i<600;i++){const id='aa-foreign-staff-'+String(i).padStart(4,'0');f.db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);f.db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(id,id,'FOREIGN PRIVATE '+i,await passwordHash);f.db.prepare("INSERT INTO team_memberships VALUES ('team-b',?,'manager','active')").run(id);}
 const prepare=f.db.prepare,counts=[];f.db.prepare=function(sql){const statement=prepare.call(this,sql);if(/^SELECT/i.test(sql.trim())){const all=statement.all;statement.all=function(...args){const rows=all.apply(this,args);counts.push(rows.length);return rows;};}return statement;};t.after(()=>f.db.prepare=prepare);
 const first=ok(await f.protected(PROJECT+'/members?limit=2',{actor:owner}));assert.deepEqual(first.data.members.map(m=>m.id),['delegate-a','none-a']);assert.equal(first.data.hasMore,true);assert.ok(counts.every(n=>n<=3),'No foreign member candidates may be materialized then filtered');for(const member of first.data.members)assert.deepEqual(Object.keys(member).sort(),['id','displayName','role','status','revision','read','manage','review'].sort());assert.doesNotMatch(first.raw,/FOREIGN|PRIVATE|phone|password|token/);
 const foreign=deny(await f.protected(PROJECT+'/members?after=aa-foreign-staff-0000',{actor:owner}),[404]),unknown=deny(await f.protected(PROJECT+'/members?after=missing-user',{actor:owner}),[404]);assert.equal(foreign.raw,unknown.raw);
});

function memoryVault(key){return {async getPublicIdentity(){return {publicKey:key.encoded,fingerprint:key.fingerprint};},async signChallenge(fields,context){for(const name of ['purpose','serverId','userId','bindingRevision'])assert.equal(fields[name],context[name]);assert.equal(fields.sessionBinding,digest(context.sessionToken));return sign(null,challengeBytes(fields),key.privateKey).toString('base64url');},async signRequest(fields,context){for(const name of ['serverId','userId','deviceId','bindingRevision','leaseId'])assert.equal(fields[name],context[name]);assert.equal(fields.sessionBinding,digest(context.sessionToken));return sign(null,requestBytes(fields),key.privateKey).toString('base64url');},dispose(){}};}
function normalClient(t,f,key){const client=createTeamClient({fetchImpl:f.transport,now:()=>f.now,deviceIdentity:{vault:memoryVault(key),platform:'win32',displayName:'Synthetic project boundary'}});t.after(()=>client.clearSession());return client;}
function desktopBridge(t,client,dialog={}){const handlers=new Map(),frame={url:APP_URL},window={webContents:{mainFrame:frame}},dispose=registerDesktopBridge({ipcMain:{handle:(name,action)=>handlers.set(name,action),removeHandler:name=>handlers.delete(name)},window,client,dialog:{showOpenDialog:async()=>({canceled:true,filePaths:[]}),showSaveDialog:async()=>({canceled:true}),...dialog}});t.after(dispose);const event={sender:window.webContents,senderFrame:frame};return {call:(name,input)=>handlers.get('shenyi:'+name)(event,input),handlers};}

for(const mutation of ['review','read','role','disable','lease'])test('new review download held at the synthetic save dialog writes nothing after '+mutation+' revocation',async t=>{
 const f=await fixture(t),submission=await upload(f),owner=await f.bound(),admin=await f.bound('tech-a');f.seedScope('p-a','reviewer-a',{read:true,review:true});const target=await f.bound('reviewer-a'),client=normalClient(t,f,target.key);assert.equal((await client.login({username:'reviewer-a',password:PASSWORD})).device.state,'ready');let writes=0;t.mock.method(fs,'writeFile',async()=>{writes++;});
 const bridge=desktopBridge(t,client,{showSaveDialog:async()=>{if(mutation==='review')ok(await f.grant({actor:owner,user:'reviewer-a',read:true,review:false}));if(mutation==='read')ok(await f.grant({actor:owner,user:'reviewer-a',read:false}));if(mutation==='role')ok(await roleChange(f,admin,'reviewer-a','assistant'));if(mutation==='disable')ok(await f.protected('/api/teams/team-a/business-members/reviewer-a/disable',{actor:admin,method:'POST',body:{revision:f.epoch('reviewer-a'),currentPassword:PASSWORD}}));if(mutation==='lease')await f.prove('reviewer-a',target.key);return {canceled:false,filePath:'D:/synthetic-project-never-written.bin'};}});
 const result=await bridge.call('project-submission-download',{teamId:'team-a',projectId:'p-a',taskId:'t-a',submissionId:submission.id});assert.equal(result.ok,false);assert.equal(writes,0);assert.equal(client.getDeviceStatus().state,'signed_out');assert.ok(f.calls.some(call=>call.method==='HEAD'&&call.path.endsWith('/'+submission.id+'/file')&&call.status===401));assert.deepEqual(Buffer.from(f.db.prepare('SELECT bytes FROM team_collection_attachments WHERE attachment_id=?').get(submission.attachmentId).bytes),originalBytes);
});

test('review save cancellation skips HEAD/write and a malformed successful HEAD also fails closed',async t=>{
 const f=await fixture(t),submission=await upload(f);f.seedScope('p-a','reviewer-a',{read:true,review:true});const target=await f.bound('reviewer-a'),client=normalClient(t,f,target.key);await client.login({username:'reviewer-a',password:PASSWORD});let writes=0,cancel=true;t.mock.method(fs,'writeFile',async()=>{writes++;});const bridge=desktopBridge(t,client,{showSaveDialog:async()=>cancel?{canceled:true}:{canceled:false,filePath:'D:/synthetic-malformed-review.bin'}}),input={teamId:'team-a',projectId:'p-a',taskId:'t-a',submissionId:submission.id};
 const canceled=await bridge.call('project-submission-download',input);assert.equal(canceled.ok,true);assert.equal(canceled.value.canceled,true);assert.equal(f.calls.filter(c=>c.method==='HEAD'&&c.path.endsWith('/file')).length,0);assert.equal(writes,0);
 cancel=false;f.transportAfter=async(route,response,options)=>options.method==='HEAD'&&route.endsWith('/file')?new Response('unexpected body',{status:200}):response;const malformed=await bridge.call('project-submission-download',input);assert.equal(malformed.ok,false);assert.equal(malformed.error.code,'INVALID_RESPONSE');assert.equal(writes,0);
});

test('a bodyless scoped HEAD 404 stays ready while ambiguous device errors pause and 401 clears without writing',async t=>{
 const f=await fixture(t),submission=await upload(f);f.seedScope('p-a','reviewer-a',{read:true,review:true});const target=await f.bound('reviewer-a');let writes=0;t.mock.method(fs,'writeFile',async()=>{writes++;});
 for(const status of [404,400,403,409,429,503,401]){
  const client=normalClient(t,f,target.key);await client.login({username:'reviewer-a',password:PASSWORD});assert.equal(client.getDeviceStatus().state,'ready');let selected=0;
  // 404 is an actual fresh SQL-scope denial. Other empty error responses are
  // explicitly synthetic transport replacements of an actual authorized HEAD.
  f.transportAfter=status===404?null:async(route,response,options)=>options.method==='HEAD'&&route.endsWith('/file')?new Response(null,{status}):response;
  const start=f.calls.length,bridge=desktopBridge(t,client,{showSaveDialog:async()=>{selected++;if(status===404)f.db.prepare("UPDATE team_projects SET status='archived' WHERE project_id='p-a'").run();return {canceled:false,filePath:'D:/synthetic-head-error-never-written.bin'};}});
  const result=await bridge.call('project-submission-download',{teamId:'team-a',projectId:'p-a',taskId:'t-a',submissionId:submission.id});assert.equal(selected,1);assert.equal(result.ok,false);assert.equal(result.error.code,status===404?'HTTP_404':status===401?'SIGN_IN_REQUIRED':'SERVICE_UNAVAILABLE');assert.equal(client.getDeviceStatus().state,status===404?'ready':status===401?'signed_out':'paused');assert.equal(writes,0);assert.doesNotMatch(JSON.stringify(result),/filePath|private-provider|Synthetic injected|stack|Bearer|D:\/synthetic/);
  const calls=f.calls.slice(start).filter(c=>c.path.endsWith('/'+submission.id+'/file'));assert.deepEqual(calls.map(c=>[c.method,c.status]),[['GET',200],['HEAD',status===404?404:200]]);
  f.transportAfter=null;if(status===404)f.db.prepare("UPDATE team_projects SET status='active' WHERE project_id='p-a'").run();
 }
});

test('positive review save traverses real GET/HEAD, writes the same bytes and returns only basename metadata',async t=>{
 const f=await fixture(t),submission=await upload(f);f.seedScope('p-a','reviewer-a',{read:true,review:true});const target=await f.bound('reviewer-a'),client=normalClient(t,f,target.key);await client.login({username:'reviewer-a',password:PASSWORD});const saved=[];t.mock.method(fs,'writeFile',async(file,bytes)=>{saved.push({file,bytes:Buffer.from(bytes)});});const bridge=desktopBridge(t,client,{showSaveDialog:async()=>({canceled:false,filePath:'D:/synthetic-reviewed-original.bin'})});assert.equal(bridge.handlers.size,100);
 const result=await bridge.call('project-submission-download',{teamId:'team-a',projectId:'p-a',taskId:'t-a',submissionId:submission.id});assert.equal(result.ok,true);assert.deepEqual(result.value,{saved:true,filename:'synthetic-reviewed-original.bin',byteLength:originalBytes.length});assert.equal(saved.length,1);assert.deepEqual(saved[0].bytes,originalBytes);assert.equal(digest(saved[0].bytes),submission.sha256);assert.equal(f.calls.filter(c=>c.method==='HEAD'&&c.path.endsWith('/file')).length,1);assert.equal(result.value.filePath,undefined);assert.equal(result.value.bytes,undefined);
});

for(const action of ['grant','task'])test('a committed '+action+' response lost in transit is reconciled without replaying that POST',async t=>{
 const f=await fixture(t),owner=await f.bound(),client=normalClient(t,f,owner.key);await client.login({username:'creator-a',password:PASSWORD});const suffix=action==='grant'?'/access':'/tasks',before=f.db.prepare('SELECT COUNT(*) n FROM team_collection_tasks').get().n;let lost=false;
 f.transportAfter=async(route,response,options)=>{if(!lost&&options.method==='POST'&&route===PROJECT+suffix&&response.ok){lost=true;await response.arrayBuffer();throw Error('Synthetic committed response lost');}return response;};
 const invoke=()=>action==='grant'?client.changeProjectAccess({teamId:'team-a',projectId:'p-a',revision:f.rev(),userId:'delegate-a',memberRevision:f.epoch('delegate-a'),read:true,manage:false,review:true,currentPassword:PASSWORD,confirmed:true}):client.createProjectTask({teamId:'team-a',projectId:'p-a',revision:f.rev(),title:'One unknown task',instructions:'Synthetic only',confirmed:true});
 await assert.rejects(invoke(),error=>error.code==='SERVICE_UNAVAILABLE'&&/结果未确认/.test(error.message));assert.equal(lost,true);assert.equal(client.getDeviceStatus().state,'paused');assert.equal(eventCount(f),1);assert.equal(f.calls.filter(c=>c.method==='POST'&&c.path===PROJECT+suffix).length,1);f.transportAfter=null;await client.reconnectDevice();if(action==='grant')assert.equal((await client.listProjectMembers({teamId:'team-a',projectId:'p-a'})).members.find(m=>m.id==='delegate-a').review,true);else{assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_collection_tasks').get().n,before+1);assert.equal((await client.listProjectTasks({teamId:'team-a',projectId:'p-a'})).tasks.filter(task=>task.title==='One unknown task').length,1);}assert.equal(f.calls.filter(c=>c.method==='POST'&&c.path===PROJECT+suffix).length,1);
});
