'use strict';
// Independent M4K: actual isolated SQLite, strict signed application requests,
// and production client/main seams. No shared profile or customer data is used.
const nodeTest=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {syncBuiltinESMExports}=require('node:module');
const {createProjectAccessFixture,PASSWORD,source}=require('./helpers/project-access-fixture.cjs');
const {migrationSource,REVIEWER}=require('./helpers/project-migration-fixture.cjs');
const legacyCodec=require('../dist/legacy-project-source.js');
const {createTeamClient}=require('../desktop/team-client.cjs'),proof=require('../shared/device-proof.cjs');
const {createCollectionWorkspaceManager}=require('../desktop/collection-workspace.cjs');
const test=(name,fn)=>nodeTest(name,{timeout:45000},fn),uuid=()=>crypto.randomUUID(),sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const ROOT='/api/teams/team-a/collection-workspaces',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const RECEIPT=['requestId','teamId','projectId','kind','title','createdBy','read','manage','review','createdProjectRevision','createdAt'];
const PROJECT=['id','title','status','revision','canRead','canManageAccess','canCreateTask','canReview'];
const CREATIONS='team_collection_workspace_creations';
const exact=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return{promise,resolve,reject};}
async function until(fn){const end=performance.now()+10000;while(!fn()){assert.ok(performance.now()<end,'Independent async boundary not reached');await new Promise(r=>setTimeout(r,5));}}
function good(r,status=200){assert.equal(r.status,status,JSON.stringify(r.data));return r.data;}
function denied(r,status=404){assert.equal(r.status,status,JSON.stringify(r.data));assert.ok(r.data?.error);assert.equal(Object.hasOwn(r.data,'receipt'),false);assert.doesNotMatch(JSON.stringify(r.data),/password_hash|token_hash|scrypt\$|SQLITE|privateKey/);return r;}
const nativeScrypt=crypto.scrypt;let nextPasswordHold=null;
crypto.scrypt=function(...args){const callback=args.pop(),hold=nextPasswordHold;nextPasswordHold=null;return nativeScrypt(...args,(error,value)=>{if(!hold)return callback(error,value);hold.entered.resolve();void hold.release.promise.then(()=>callback(error,value));});};
syncBuiltinESMExports();
nodeTest.after(()=>{crypto.scrypt=nativeScrypt;syncBuiltinESMExports();});

async function fixture(t,{user='manager-a',migration=false}={}){
 const f=await createProjectAccessFixture(t,{register:false});
 if(migration){await(await source('administrator-business-role-demo.mjs')).seedAdministratorBusinessRoleDemo(f.db);await(await source('migration-demo.mjs')).seedProjectMigrationDemo(f.db);}
 const actor=await f.ready(user);
 function body(fields={}){return{requestId:uuid(),title:'Independent collection workspace',read:true,manage:true,review:true,currentPassword:PASSWORD,...fields};}
 function create(value=body(),settings={}){return f.api(settings.teamId?'/api/teams/'+settings.teamId+'/collection-workspaces':ROOT,{method:'POST',session:settings.actor??actor,body:value,...settings.request});}
 function receipt(id,{actor:current=actor,teamId='team-a'}={}){return f.api('/api/teams/'+teamId+'/collection-workspaces/receipts/'+id,{session:current});}
 function view(id,current=actor){return f.api('/api/teams/team-a/projects/'+id,{session:current});}
 function snapshot({resourcesOnly=false}={}){
  const names=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name).filter(n=>!['team_auth_limits','team_device_request_replays'].includes(n)&&(!resourcesOnly||/^team_(?:projects$|project_|collection_|task_|attachment_|material_)/.test(n)||n.includes('workspace')));
  return names.map(name=>{const q=f.db.prepare('SELECT * FROM "'+name+'"');q.setReadBigInts(true);return{name,rows:q.all().map(row=>JSON.stringify(Object.keys(row).sort().map(k=>[k,typeof row[k]==='bigint'?['integer',String(row[k])]:row[k] instanceof Uint8Array?['blob',Buffer.from(row[k]).toString('base64')]:row[k]]))).sort()};});
 }
 function roleABA(current=user){f.db.prepare("UPDATE team_memberships SET role='intern' WHERE user_id=?").run(current);f.db.prepare("UPDATE team_memberships SET role=? WHERE user_id=?").run(current==='partner-a'?'partner':'manager',current);}
 function passwordHold(){assert.equal(nextPasswordHold,null);const h={entered:deferred(),release:deferred()};nextPasswordHold=h;t.after(()=>{if(nextPasswordHold===h)nextPasswordHold=null;h.release.resolve();});return h;}
 async function register(fields={}){assert.ok(migration);const reviewer=await f.ready(REVIEWER),value=migrationSource({id:fields.projectId??uuid(),sequence:fields.sequence??43}),request={requestId:fields.requestId??uuid(),source:value,sourceSha256:sha(legacyCodec.encode(value)),teamId:'team-a',ownerUserId:'manager-a',ownerRevision:f.epoch('manager-a'),read:true,manage:true,review:true,currentPassword:PASSWORD};return f.api('/api/project-migrations',{method:'POST',session:reviewer,body:request});}
 return{...f,actor,user,body,create,receipt,view,snapshot,roleABA,passwordHold,register};
}

test('normal manager creates a genuine empty workspace with exact current creator and explicit collection rights',async t=>{
 const f=await fixture(t),oldProjects=f.db.prepare('SELECT * FROM team_projects ORDER BY team_id,project_id').all(),input=f.body(),r=good(await f.create(input),201);exact(r,['receipt']);exact(r.receipt,RECEIPT);const v=r.receipt;assert.match(v.projectId,UUID);assert.equal(v.requestId,input.requestId);assert.equal(v.teamId,'team-a');assert.equal(v.createdBy,'manager-a');assert.equal(v.kind,'collection-workspace');assert.equal(v.createdAt,f.clock.value);assert.ok(Number.isSafeInteger(v.createdProjectRevision)&&v.createdProjectRevision>=2);
 const p=f.db.prepare('SELECT * FROM team_projects WHERE project_id=?').get(v.projectId);assert.deepEqual({...p},{team_id:'team-a',project_id:v.projectId,title:input.title,financial_summary:'',structure_json:'{}',status:'active'});assert.equal(f.db.prepare('SELECT revision FROM team_project_access_projects WHERE project_id=?').get(v.projectId).revision,v.createdProjectRevision);assert.deepEqual(f.db.prepare('SELECT * FROM team_projects WHERE project_id<>? ORDER BY team_id,project_id').all(v.projectId),oldProjects);
 const current=good(await f.view(v.projectId)).project;exact(current,[...PROJECT,'kind']);assert.equal(current.kind,'collection-workspace');assert.equal(current.canRead,true);assert.equal(current.canCreateTask,true);assert.equal(current.canReview,true);assert.equal(current.canManageAccess,true);assert.equal(f.db.prepare('SELECT count(*) n FROM team_collection_tasks WHERE project_id=?').get(v.projectId).n,0);for(const n of ['team_material_grants','team_material_records','team_material_files','team_material_maintenance_grants'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+n).get().n,0);
 assert.deepEqual(good(await f.receipt(input.requestId)),r);assert.equal((await f.api('/api/auth/devices/connection',{session:f.actor})).status,200);
});

test('all false creates owner governance without task read manage review or hidden self grants',async t=>{
 const f=await fixture(t),input=f.body({read:false,manage:false,review:false}),r=good(await f.create(input),201).receipt,p=good(await f.view(r.projectId)).project;assert.equal(p.canManageAccess,true);assert.equal(p.canRead,false);assert.equal(p.canCreateTask,false);assert.equal(p.canReview,false);assert.equal(f.db.prepare('SELECT count(*) n FROM team_project_grants WHERE project_id=?').get(r.projectId).n,0);assert.deepEqual(f.db.prepare('SELECT permission FROM team_project_access_grants WHERE project_id=?').all(r.projectId).map(x=>x.permission),['project.owner']);denied(await f.createTask(f.actor,{projectId:r.projectId}),404);denied(await f.grant(f.actor,'manager-a',{read:true,manage:true,review:true},{projectId:r.projectId}),404);assert.deepEqual(good(await f.receipt(input.requestId)).receipt,r);
});

test('partner can independently choose read-only read-review or read-manage initial facts',async t=>{
 const f=await fixture(t,{user:'partner-a'});for(const flags of [{read:true,manage:false,review:false},{read:true,manage:false,review:true},{read:true,manage:true,review:false}]){const r=good(await f.create(f.body(flags)),201).receipt,p=good(await f.view(r.projectId)).project;for(const key of ['read','manage','review'])assert.equal(r[key],flags[key]);assert.equal(p.canRead,true);assert.equal(p.canCreateTask,flags.manage);assert.equal(p.canReview,flags.review);assert.equal(r.createdBy,'partner-a');}
});

test('junior technical administrator and protected reviewer cannot create using guessed team routes',async t=>{
 const f=await fixture(t);for(const user of ['intern-a','administrator-demo','recovery-reviewer-demo']){const actor=await f.ready(user),before=f.snapshot({resourcesOnly:true});denied(await f.create(f.body(),{actor}),404);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);}
});

test('foreign target team is denied before exposing request metadata',async t=>{
 const f=await fixture(t),before=f.snapshot({resourcesOnly:true});denied(await f.create(f.body(),{teamId:'team-b'}),404);denied(await f.create(f.body(),{teamId:'team-does-not-exist'}),404);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('wrong current password publishes no project grants provenance or audit',async t=>{
 const f=await fixture(t),before=f.snapshot();denied(await f.create(f.body({currentPassword:'wrong-current-password'})),403);assert.deepEqual(f.snapshot(),before);
});

test('body rejects creator kind quote number malformed titles and permission dependency violations',async t=>{
 const f=await fixture(t),before=f.snapshot({resourcesOnly:true});for(const patch of [{createdBy:'partner-a'},{projectId:uuid()},{kind:'formal'},{quoteId:uuid()},{businessNumber:'2026-B-0001'},{title:''},{title:'   '},{title:'bad\u0000title'},{title:'bad\u202etitle'},{title:'\ud800'},{title:'A'.repeat(301)},{read:false,manage:true,review:false},{read:false,manage:false,review:true},{read:'true'},{requestId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'}])denied(await f.create(f.body(patch)),400);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('title is trimmed and the exact 300 codepoint boundary preserves supplementary characters',async t=>{
 const f=await fixture(t),title='😀'.repeat(300),r=good(await f.create(f.body({title})),201).receipt;assert.equal(r.title,title);assert.equal(f.db.prepare('SELECT title FROM team_projects WHERE project_id=?').get(r.projectId).title,title);assert.equal(good(await f.create(f.body({title:'  Explicit trimmed title  '})),201).receipt.title,'Explicit trimmed title');
});

test('same title is not a request identity and distinct intentions get distinct server UUIDs',async t=>{
 const f=await fixture(t),a=good(await f.create(),201).receipt,b=good(await f.create(),201).receipt;assert.equal(a.title,b.title);assert.notEqual(a.projectId,b.projectId);assert.notEqual(a.requestId,b.requestId);
});

test('a committed request ID is global across actors and teams and never republishes',async t=>{
 const f=await fixture(t),input=f.body(),r=good(await f.create(input),201).receipt,partner=await f.ready('partner-a'),other=await f.ready('manager-b'),before=f.snapshot({resourcesOnly:true});for(const settings of [{},{actor:partner},{actor:other,teamId:'team-b'}])denied(await f.create({...input,title:'A different attempted meaning'},settings),409);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);denied(await f.receipt(input.requestId,{actor:partner}),404);denied(await f.receipt(input.requestId,{actor:other,teamId:'team-b'}),404);assert.equal(good(await f.receipt(input.requestId)).receipt.projectId,r.projectId);
});

test('receipt is exact creator owner and team scoped and unknown IDs disclose no facts',async t=>{
 const f=await fixture(t),r=good(await f.create(),201).receipt,partner=await f.ready('partner-a');denied(await f.receipt(r.requestId,{actor:partner}),404);denied(await f.receipt(r.requestId,{teamId:'team-b'}),404);denied(await f.receipt(uuid()),404);f.db.prepare("UPDATE team_project_access_grants SET status='revoked',revision=revision+1 WHERE project_id=? AND permission='project.owner'").run(r.projectId);denied(await f.receipt(r.requestId),404);
});

test('same creator normal new device lease can reconcile original immutable receipt',async t=>{
 const f=await fixture(t),r=good(await f.create(),201).receipt,fresh=await f.ready('manager-a',f.keys.get('manager-a'));assert.deepEqual(good(await f.receipt(r.requestId,{actor:fresh})).receipt,r);assert.notEqual(fresh.lease.id,f.actor.lease.id);const old=await f.receipt(r.requestId);assert.ok([401,403].includes(old.status));
});

test('receipt creation revision stays historical while current permissions and revision change',async t=>{
 const f=await fixture(t),r=good(await f.create(),201).receipt;good(await f.grant(f.actor,'partner-a',{read:true,manage:false,review:true},{projectId:r.projectId}));const p=good(await f.view(r.projectId)).project;assert.ok(p.revision>r.createdProjectRevision);assert.deepEqual(good(await f.receipt(r.requestId)).receipt,r);
});

test('frozen owner can read receipt and kind while task mutation closes and archived hides receipt',async t=>{
 const f=await fixture(t),r=good(await f.create(),201).receipt;f.db.prepare("UPDATE team_projects SET status='frozen' WHERE project_id=?").run(r.projectId);assert.deepEqual(good(await f.receipt(r.requestId)).receipt,r);const p=good(await f.view(r.projectId)).project;assert.equal(p.kind,'collection-workspace');assert.equal(p.canRead,true);assert.equal(p.canCreateTask,false);denied(await f.createTask(f.actor,{projectId:r.projectId}),409);f.db.prepare("UPDATE team_projects SET status='archived' WHERE project_id=?").run(r.projectId);denied(await f.receipt(r.requestId),404);
});

test('old registered project remains exact eight-key view beside exact nine-key workspace',async t=>{
 const f=await fixture(t);f.registerProject('old-explicit-fixture');const old=good(await f.view('old-explicit-fixture')).project;exact(old,PROJECT);assert.equal(Object.hasOwn(old,'kind'),false);const r=good(await f.create(),201).receipt;exact(good(await f.view(r.projectId)).project,[...PROJECT,'kind']);
});

test('strict device proof cross-origin query and old formal-create route cannot be bypassed',async t=>{
 const f=await fixture(t),before=f.snapshot({resourcesOnly:true}),boot=await f.login('manager-a');denied(await f.api(ROOT,{method:'POST',session:boot,body:f.body()}),403);denied(await f.create(f.body(),{request:{headers:{Origin:'https://outside.invalid'}}}),403);denied(await f.api(ROOT+'?unexpected=1',{method:'POST',session:f.actor,body:f.body()}),400);const old=await f.api('/api/teams/team-a/projects',{method:'POST',session:f.actor,body:f.body()});assert.ok([404,405].includes(old.status));assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('actual password work rejects role revoke-and-restore ABA without any published resource',async t=>{
 const f=await fixture(t),before=f.snapshot({resourcesOnly:true}),h=f.passwordHold(),pending=f.create();await h.entered.promise;f.roleABA();h.release.resolve();const r=await pending;assert.ok([401,403,404,409].includes(r.status));assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('actual password work rejects a replaced lease and does not kill the new legitimate session',async t=>{
 const f=await fixture(t),before=f.snapshot({resourcesOnly:true}),h=f.passwordHold(),pending=f.create();await h.entered.promise;const fresh=await f.ready('manager-a',f.keys.get('manager-a'));h.release.resolve();const r=await pending;assert.ok([401,403,404,409].includes(r.status));assert.deepEqual(f.snapshot({resourcesOnly:true}),before);assert.equal((await f.api('/api/auth/devices/connection',{session:fresh})).status,200);
});

test('M4F formal request ID cannot be reused by ordinary workspace creation',async t=>{
 const f=await fixture(t,{migration:true}),id=uuid();good(await f.register({requestId:id}),201);const before=f.snapshot({resourcesOnly:true});denied(await f.create(f.body({requestId:id})),409);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('M4F cannot reuse a workspace request ID or replace a workspace UUID as a formal project',async t=>{
 const f=await fixture(t,{migration:true}),r=good(await f.create(),201).receipt,before=f.snapshot({resourcesOnly:true});denied(await f.register({requestId:r.requestId}),409);denied(await f.register({projectId:r.projectId,sequence:44}),409);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);assert.equal(f.db.prepare('SELECT count(*) n FROM team_project_migration_provenance WHERE project_id=?').get(r.projectId).n,0);
});

test('workspace denies every material path even when a trusted fixture accidentally inserts all material grants',async t=>{
 const f=await fixture(t),r=good(await f.create(),201).receipt;f.db.prepare('INSERT INTO team_material_grants VALUES (?,?,?,1,1,1,1,1,1)').run('team-a',r.projectId,'manager-a');const base='/api/teams/team-a/projects/'+r.projectId+'/materials',before=f.snapshot({resourcesOnly:true});for(const tail of ['', '/access','/members','/receipts/'+uuid(),'/files/'+uuid()])denied(await f.api(base+tail,{session:f.actor}),404);denied(await f.api(base+'/imports',{method:'POST',session:f.actor,body:{requestId:uuid(),projectRevision:good(await f.view(r.projectId)).project.revision,packageSha256:'a'.repeat(64),byteLength:1,chunkCount:1}}),404);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('body-read await cannot accept a role ABA scheduled after the captured team identity',async t=>{
 const f=await fixture(t),before=f.snapshot({resourcesOnly:true}),prepare=f.db.prepare;let fired=false;
 f.db.prepare=function(sql){const st=prepare.call(this,sql);if(sql.includes('SELECT member.role,credential.password_hash')){const get=st.get;st.get=function(...args){const value=get.apply(this,args);if(!fired){fired=true;queueMicrotask(()=>f.roleABA());}return value;};}return st;};t.after(()=>{f.db.prepare=prepare;});
 const r=await f.create();assert.equal(fired,true);assert.ok([401,403,404,409].includes(r.status));assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('password hash change and restoration during actual KDF invalidates the captured credential revision',async t=>{
 const f=await fixture(t),before=f.snapshot({resourcesOnly:true}),old=f.db.prepare("SELECT password_hash FROM team_credentials WHERE user_id='manager-a'").get().password_hash,h=f.passwordHold(),pending=f.create();await h.entered.promise;f.db.prepare("UPDATE team_credentials SET password_hash=? WHERE user_id='manager-a'").run(old.replace(/.$/,old.endsWith('0')?'1':'0'));f.db.prepare("UPDATE team_credentials SET password_hash=? WHERE user_id='manager-a'").run(old);h.release.resolve();const r=await pending;assert.ok([401,403,404,409].includes(r.status));assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('business transaction beginning rechecks role ABA and rolls the new resource back',async t=>{
 const f=await fixture(t),before=f.snapshot(),h=f.passwordHold(),pending=f.create();await h.entered.promise;const exec=f.db.exec;let hit=false;f.db.exec=function(sql){const value=exec.call(this,sql);if(sql==='BEGIN IMMEDIATE'&&!hit){hit=true;f.roleABA();}return value;};t.after(()=>{f.db.exec=exec;});h.release.resolve();const r=await pending;assert.equal(hit,true);assert.ok([401,403,404,409].includes(r.status));assert.deepEqual(f.snapshot(),before);
});

test('creation audit insertion failure rolls back project sidecar all flags and permanent request record',async t=>{
 const f=await fixture(t);f.db.exec('CREATE TRIGGER independent_fail_workspace_audit BEFORE INSERT ON '+CREATIONS+" BEGIN SELECT RAISE(ABORT,'independent audit failure'); END");const before=f.snapshot();denied(await f.create(),503);assert.deepEqual(f.snapshot(),before);
});

test('qualification mutation by an actual AFTER INSERT audit trigger cannot survive final recheck',async t=>{
 const f=await fixture(t);f.db.exec('CREATE TRIGGER independent_role_after_workspace_audit AFTER INSERT ON '+CREATIONS+" BEGIN UPDATE team_memberships SET role='intern' WHERE user_id=NEW.created_by; END");const before=f.snapshot(),r=await f.create();assert.ok([401,403,404,409].includes(r.status));assert.deepEqual(f.snapshot(),before);
});

test('audit triggers changing title initial flags or MAX revision cause an exact full rollback',async t=>{
 const f=await fixture(t);for(const sql of ["UPDATE team_projects SET title='unexpected audit mutation' WHERE team_id=NEW.team_id AND project_id=NEW.project_id", "UPDATE team_project_grants SET status='revoked' WHERE team_id=NEW.team_id AND project_id=NEW.project_id AND permission='collection.read'", 'UPDATE team_project_access_projects SET revision=9007199254740991 WHERE team_id=NEW.team_id AND project_id=NEW.project_id']){f.db.exec('CREATE TRIGGER independent_resource_after_workspace_audit AFTER INSERT ON '+CREATIONS+' BEGIN '+sql+'; END');const before=f.snapshot();denied(await f.create(),409);assert.deepEqual(f.snapshot(),before);f.db.exec('DROP TRIGGER independent_resource_after_workspace_audit');}
});

test('creation provenance is immutable and cannot be grafted onto an old managed project or formal origin',async t=>{
 const f=await fixture(t,{migration:true}),r=good(await f.create(),201).receipt,before=f.snapshot({resourcesOnly:true});assert.throws(()=>f.db.prepare('UPDATE '+CREATIONS+" SET title='forged' WHERE request_id=?").run(r.requestId));assert.throws(()=>f.db.prepare('DELETE FROM '+CREATIONS+' WHERE request_id=?').run(r.requestId));assert.deepEqual(f.snapshot({resourcesOnly:true}),before);const row=f.db.prepare('SELECT * FROM '+CREATIONS+' WHERE request_id=?').get(r.requestId),other=uuid();f.registerProject(other);const beforeGraft=f.snapshot({resourcesOnly:true}),graft={...row,request_id:uuid(),project_id:other},keys=Object.keys(graft);assert.throws(()=>f.db.prepare('INSERT INTO '+CREATIONS+'('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(graft)));
 const form=migrationSource({id:r.projectId,sequence:45}),sourceJson=legacyCodec.encode(form);assert.throws(()=>f.db.prepare('INSERT INTO team_project_migration_provenance(request_id,project_id,team_id,owner_user_id,source_sha256,source_json,business_number,number_year,number_sequence,legacy_manager_name,reviewed_by,registered_at,can_read,can_manage,can_review) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(uuid(),r.projectId,'team-a','manager-a',sha(sourceJson),sourceJson,form.numbering.businessNumber,form.numbering.identity.year,45,form.numbering.legacyManagerName,REVIEWER,f.clock.value,1,1,1));assert.deepEqual(f.db.prepare('SELECT * FROM '+CREATIONS).all(),[row]);assert.equal(f.db.prepare('SELECT count(*) n FROM team_project_migration_provenance WHERE project_id=?').get(r.projectId).n,0);assert.deepEqual(f.snapshot({resourcesOnly:true}),beforeGraft);
});

test('semantic request hash excludes request ID and session token but binds explicit flags',async t=>{
 const f=await fixture(t),a=good(await f.create(),201).receipt,fresh=await f.ready('manager-a',f.keys.get('manager-a')),b=good(await f.create(f.body(),{actor:fresh}),201).receipt,c=good(await f.create(f.body({manage:false}),{actor:fresh}),201).receipt,get=id=>f.db.prepare('SELECT request_sha256 FROM '+CREATIONS+' WHERE request_id=?').get(id).request_sha256;assert.match(get(a.requestId),/^[a-f0-9]{64}$/);assert.equal(get(a.requestId),get(b.requestId));assert.notEqual(get(a.requestId),get(c.requestId));
});

test('approved administrator senior uses ordinary business rights while approval ABA during KDF is denied',async t=>{
 const f=await fixture(t,{migration:true}),reviewer=await f.ready('business-role-reviewer-demo');good(await f.api('/api/administrator-business-roles/administrator-demo',{method:'POST',session:reviewer,body:{revision:f.epoch('administrator-demo'),role:'manager',currentPassword:PASSWORD}}));const admin=await f.ready('administrator-demo');assert.equal(good(await f.create(f.body(),{actor:admin}),201).receipt.createdBy,'administrator-demo');const before=f.snapshot({resourcesOnly:true}),h=f.passwordHold(),pending=f.create(f.body(),{actor:admin});await h.entered.promise;f.db.prepare("UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE user_id='administrator-demo'").run();f.db.prepare("UPDATE team_administrator_business_roles SET status='active',revision=revision+1 WHERE user_id='administrator-demo'").run();h.release.resolve();assert.ok([401,403,404,409].includes((await pending).status));assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

async function actualClient(f,t){
 const pair=f.keys.get('manager-a'),transport={trace:[],holds:[],rewrite:null};
 const client=createTeamClient({now:()=>f.clock.value,deviceIdentity:{platform:'win32',displayName:'Independent creation device',vault:{async getPublicIdentity(){return{publicKey:pair.encoded,fingerprint:sha(Buffer.from(pair.encoded,'base64url'))};},async signChallenge(fields){return crypto.sign(null,proof.challengeBytes(fields),pair.privateKey).toString('base64url');},async signRequest(fields){return crypto.sign(null,proof.requestProofBytes(fields),pair.privateKey).toString('base64url');}}},fetchImpl:async(url,settings)=>{
  const request=new Request(url,settings),info={method:request.method,path:new URL(url).pathname};if(info.method==='POST'&&info.path.endsWith('/collection-workspaces'))info.bodyKeys=Object.keys(JSON.parse(await request.clone().text())).sort();transport.trace.push(info);
  for(const phase of ['before','after']){if(phase==='after'){info.response=await f.dispatch(request);info.status=info.response.status;}const i=transport.holds.findIndex(h=>h.phase===phase&&h.match(info));if(i>=0){const h=transport.holds.splice(i,1)[0];h.entered.resolve(info);await h.release.promise;}}
  return transport.rewrite?transport.rewrite(info,info.response):info.response;
 }});
 await client.login({username:'manager-a',password:PASSWORD});assert.equal((await client.getDeviceStatus()).state,'ready');const manager=createCollectionWorkspaceManager({client});t.after(()=>{manager.dispose();client.clearSession();for(const h of transport.holds)h.release.resolve();});
 function hold(phase='after'){const h={phase,match:i=>i.method==='POST'&&i.path.endsWith('/collection-workspaces'),entered:deferred(),release:deferred()};transport.holds.push(h);t.after(()=>h.release.resolve());return h;}
 return{client,manager,transport,hold,input:()=>({...f.body(),teamId:'team-a',confirmed:true}),posts:()=>transport.trace.filter(i=>i.method==='POST'&&i.path.endsWith('/collection-workspaces'))};
}

test('actual strict client commit with lost response is unknown once and reconciles only by receipt GET',async t=>{
 const f=await fixture(t),c=await actualClient(f,t),input=c.input();let drop=true;c.transport.rewrite=(info,response)=>{if(drop&&info.method==='POST'&&info.path.endsWith('/collection-workspaces')){drop=false;assert.equal(response.status,201);throw Error('Independent loss after actual COMMIT');}return response;};const r=await c.manager.createCollectionWorkspace(input);assert.deepEqual(r,{status:'unknown',requestId:input.requestId});assert.equal(c.posts().length,1);assert.deepEqual(c.posts()[0].bodyKeys,['currentPassword','manage','read','requestId','review','title']);assert.equal((await c.client.getDeviceStatus()).state,'paused');await assert.rejects(c.manager.createCollectionWorkspace(input),e=>e.code==='DEVICE_NOT_READY');assert.equal(c.posts().length,1);await c.client.reconnectDevice();assert.equal((await c.client.getDeviceStatus()).state,'ready');await assert.rejects(c.manager.createCollectionWorkspace(input),e=>e.code==='CREATION_ALREADY_USED');assert.equal(c.posts().length,1);const receipt=await c.client.getCollectionWorkspaceReceipt({teamId:'team-a',requestId:input.requestId});exact(receipt,RECEIPT);assert.equal(receipt.createdBy,'manager-a');assert.equal(f.db.prepare('SELECT count(*) n FROM '+CREATIONS).get().n,1);assert.equal((await c.client.getProject({teamId:'team-a',projectId:receipt.projectId})).project.kind,'collection-workspace');assert.equal(c.posts().length,1);
});

test('disposed creation manager cannot turn an already committed held response into a cancelled operation',async t=>{
 const f=await fixture(t),c=await actualClient(f,t),input=c.input(),h=c.hold(),pending=c.manager.createCollectionWorkspace(input);const info=await h.entered.promise;assert.equal(info.status,201);c.manager.dispose();h.release.resolve();assert.deepEqual(await pending,{status:'unknown',requestId:input.requestId});assert.equal(c.posts().length,1);assert.equal((await c.client.getCollectionWorkspaceReceipt({teamId:'team-a',requestId:input.requestId})).requestId,input.requestId);await assert.rejects(c.manager.createCollectionWorkspace(c.input()),e=>e.code==='CREATION_CLOSED');
});

test('actual old-session denial after actor switch cannot sign out the newer actor or replay its creation',async t=>{
 const f=await fixture(t),c=await actualClient(f,t),input=c.input(),h=c.hold('before'),pending=c.manager.createCollectionWorkspace(input);await h.entered.promise;const pair=f.keys.get('manager-a');await f.ready('manager-a',pair);await f.ready('partner-a',pair);c.client.clearSession();await c.client.login({username:'partner-a',password:PASSWORD});assert.equal((await c.client.getDeviceStatus()).state,'ready');h.release.resolve();assert.deepEqual(await pending,{status:'unknown',requestId:input.requestId});assert.ok([401,403].includes(c.posts()[0].status));assert.equal((await c.client.getSession()).account.id,'partner-a');assert.equal((await c.client.getDeviceStatus()).state,'ready');assert.equal(f.db.prepare('SELECT count(*) n FROM '+CREATIONS).get().n,0);const result=await c.manager.createCollectionWorkspace(c.input());assert.equal(result.status,'created');assert.equal(result.receipt.createdBy,'partner-a');assert.equal(c.posts().length,2);
});

test('actual strict client preserves old eight-key views and only accepts the literal ninth workspace kind',async t=>{
 const f=await fixture(t),c=await actualClient(f,t);f.registerProject('old-explicit-client-fixture');exact((await c.client.getProject({teamId:'team-a',projectId:'old-explicit-client-fixture'})).project,PROJECT);const result=await c.manager.createCollectionWorkspace(c.input()),id=result.receipt.projectId;exact((await c.client.getProject({teamId:'team-a',projectId:id})).project,[...PROJECT,'kind']);for(const patch of [{kind:'formal'},{kind:true},{unexpected:'metadata'}]){c.transport.rewrite=async(info,response)=>{if(info.method==='GET'&&info.path==='/api/teams/team-a/projects/'+id&&response.ok){const value=await response.json();Object.assign(value.project,patch);return new Response(JSON.stringify(value),{status:response.status,headers:response.headers});}return response;};await assert.rejects(c.client.getProject({teamId:'team-a',projectId:id}),e=>e.code==='INVALID_RESPONSE');}
});
