'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createProjectMigrationFixture,migrationSource,REVIEWER,PASSWORD,digest,source}=require('./helpers/project-migration-fixture.cjs');
const exact=(value,names)=>assert.deepEqual(Object.keys(value).sort(),[...names].sort());
const BASE='/api/project-migrations',ACCESS='/api/auth/project-migration/access';
function snapshot(f){return f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('team_auth_limits','team_device_request_replays') ORDER BY name").all().map(({name})=>[name,f.db.prepare('SELECT * FROM "'+name+'"').all().map(row=>JSON.stringify(Object.entries(row).map(([key,value])=>[key,value instanceof Uint8Array?['blob',Buffer.from(value).toString('base64')]:value]))).sort()]);}
test('fresh additive schema is 60/138; migration reviewer seed is independent/idempotent and never auto-registers projects',async t=>{
 const f=await createProjectMigrationFixture(t);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,68);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").get().n,204);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_users').get().n,16);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_project_migration_provenance').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_project_migration_events').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_memberships WHERE user_id=?').get(REVIEWER).n,0);
 const before=snapshot(f);await(await source('migration-demo.mjs')).seedProjectMigrationDemo(f.db);assert.deepEqual(snapshot(f),before);
});
test('a real strict approval registers original identity, explicit grants and immutable provenance without moving professional data',async t=>{
 const f=await createProjectMigrationFixture(t),reviewer=await f.ready(REVIEWER),owner=await f.ready('manager-a'),body=f.body(),before=f.db.prepare('SELECT * FROM team_collection_attachments').all();
 assert.deepEqual((await f.api(ACCESS,{session:reviewer})).data,{canReview:true});const r=await f.api(BASE,{method:'POST',session:reviewer,body});assert.equal(r.status,201);exact(r.data,['requestId','projectId','teamId','ownerUserId','businessNumber','sourceSha256','read','manage','review','registeredAt']);
 assert.equal(r.data.projectId,body.source.initiation.quoteId);assert.equal(r.data.businessNumber,'2026-B-专项审计-0042');assert.equal(r.data.ownerUserId,'manager-a');assert.equal(r.data.sourceSha256,body.sourceSha256);
 const row=f.db.prepare('SELECT * FROM team_project_migration_provenance').get();assert.equal(row.original_creator_known,0);assert.equal(row.reviewed_by,REVIEWER);assert.equal(row.legacy_manager_name,'登记表历史经理文字');assert.equal(JSON.parse(row.source_json).initiation.form.manager,'原立项历史文字');assert.equal(row.owner_user_id,'manager-a');
 const detail=await f.api('/api/teams/team-a/projects/'+r.data.projectId,{session:owner});assert.equal(detail.status,200);assert.deepEqual({read:detail.data.project.canRead,manage:detail.data.project.canManageAccess,create:detail.data.project.canCreateTask,review:detail.data.project.canReview},{read:true,manage:true,create:true,review:true});assert.equal(detail.data.project.revision,5);
 assert.deepEqual(f.db.prepare('SELECT * FROM team_collection_attachments').all(),before);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_collection_tasks WHERE project_id=?').get(r.data.projectId).n,0);assert.equal(f.db.prepare('SELECT financial_summary,structure_json FROM team_projects WHERE project_id=?').get(r.data.projectId).financial_summary,'');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_project_migration_events').get().n,1);
 assert.deepEqual((await f.api(BASE+'/receipts/'+body.requestId,{session:reviewer})).data,r.data);
 assert.throws(()=>f.db.prepare('UPDATE team_project_migration_provenance SET owner_user_id=?').run('partner-a'));assert.throws(()=>f.db.prepare('DELETE FROM team_project_migration_provenance').run());assert.throws(()=>f.db.prepare('DELETE FROM team_project_migration_events').run());
});
test('owner-only approval creates governance capability without inferring read/manage/review',async t=>{
 const f=await createProjectMigrationFixture(t),reviewer=await f.ready(REVIEWER),owner=await f.ready('manager-a'),r=await f.register(reviewer,{read:false,manage:false,review:false});assert.equal(r.status,201);const detail=await f.api('/api/teams/team-a/projects/'+r.data.projectId,{session:owner});assert.equal(detail.status,200);assert.equal(detail.data.project.canManageAccess,true);for(const key of ['canRead','canCreateTask','canReview'])assert.equal(detail.data.project[key],false);assert.equal(detail.data.project.revision,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_project_grants WHERE project_id=?').get(r.data.projectId).n,0);
});
for(const user of ['reviewer-demo','recovery-reviewer-demo','access-reviewer-demo','device-reviewer-demo','business-role-reviewer-demo','administrator-demo','manager-a','intern-a'])test('independent migration authority is not inherited by '+user,async t=>{
 const f=await createProjectMigrationFixture(t),actor=await f.ready(user);assert.deepEqual((await f.api(ACCESS,{session:actor})).data,{canReview:false});assert.equal((await f.register(actor)).status,404);assert.equal((await f.api(BASE+'/teams',{session:actor})).status,404);
});
test('bootstrap, diagnostic mode, methods and exact query/body boundaries are closed',async t=>{
 const f=await createProjectMigrationFixture(t),actor=await f.ready(REVIEWER);assert.equal((await f.api(ACCESS,{session:await f.login(REVIEWER)})).status,403);assert.equal((await f.api(ACCESS,{session:actor,strict:false})).status,403);
 for(const path of [ACCESS+'?x=1',BASE+'/teams?extra=1',BASE+'/teams?limit=51',BASE+'/teams?limit=01',BASE+'/teams?q=x&q=y',BASE+'/teams?after=missing'])assert.equal((await f.api(path,{session:actor})).status,path.includes('after=')?404:400);
 assert.equal((await f.api(ACCESS,{session:actor,method:'POST',body:{}})).status,405);assert.equal((await f.api(BASE,{session:actor})).status,405);
 const before=snapshot(f);assert.equal((await f.register(actor,{extra:'forbidden'})).status,400);assert.equal((await f.register(actor,{read:false,manage:true})).status,400);assert.deepEqual(snapshot(f),before);
});
test('teams and eligible owners paginate with accurate totals and no silent truncation or privilege targets',async t=>{
 const f=await createProjectMigrationFixture(t),actor=await f.ready(REVIEWER);for(let i=0;i<53;i++)f.addMember('senior-'+String(i).padStart(2,'0'));
 const one=await f.api(BASE+'/teams/team-a/owners?limit=50',{session:actor});assert.equal(one.status,200);exact(one.data,['items','total','hasMore']);assert.equal(one.data.total,55);assert.equal(one.data.items.length,50);assert.equal(one.data.hasMore,true);const last=one.data.items.at(-1).id;
 const two=await f.api(BASE+'/teams/team-a/owners?limit=50&after='+last,{session:actor});assert.equal(two.data.items.length,5);assert.equal(two.data.hasMore,false);for(const row of [...one.data.items,...two.data.items]){exact(row,['id','displayName','role','revision']);assert.ok(['manager','partner'].includes(row.role));}
 const teams=await f.api(BASE+'/teams?limit=1',{session:actor});assert.equal(teams.data.total,2);assert.equal(teams.data.items.length,1);assert.equal(teams.data.hasMore,true);
});
for(const settings of [{ownerUserId:'intern-a'},{ownerUserId:'manager-b'},{ownerUserId:REVIEWER},{ownerUserId:'administrator-demo'}])test('first owner requires exact current single-team senior qualification '+JSON.stringify(settings),async t=>{
 const f=await createProjectMigrationFixture(t),actor=await f.ready(REVIEWER),before=snapshot(f);assert.equal((await f.register(actor,settings)).status,404);assert.deepEqual(snapshot(f),before);
});
test('bad source/hash, stale owner and duplicate request, UUID or team year-sequence cannot register',async t=>{
 const f=await createProjectMigrationFixture(t),actor=await f.ready(REVIEWER),body=f.body(),bad=structuredClone(body);bad.source.policy.professionalApprovalClaimed=true;assert.equal((await f.api(BASE,{method:'POST',session:actor,body:bad})).status,400);assert.equal((await f.register(actor,{sourceSha256:'a'.repeat(64)})).status,400);assert.equal((await f.register(actor,{ownerRevision:f.epoch('manager-a')+1})).status,409);
 assert.equal((await f.api(BASE,{method:'POST',session:actor,body})).status,201);const before=snapshot(f);assert.equal((await f.api(BASE,{method:'POST',session:actor,body})).status,409);assert.equal((await f.register(actor)).status,409);assert.equal((await f.register(actor,{source:migrationSource({id:randomUUID()})})).status,409);assert.deepEqual(snapshot(f),before);
});

test('registered first owner can use existing task creation, explicit junior assignment/upload and scoped review',async t=>{
 const f=await createProjectMigrationFixture(t),reviewer=await f.ready(REVIEWER),owner=await f.ready('manager-a'),intern=await f.ready('intern-a'),r=await f.register(reviewer);assert.equal(r.status,201);
 const created=await f.createTask(owner,{projectId:r.data.projectId});assert.equal(created.status,201);const taskId=created.data.task.id;
 assert.equal((await f.api('/api/teams/team-a/collection/tasks/'+taskId+'/assignment',{method:'POST',session:owner,body:{revision:0,userId:'intern-a'}})).status,200);
 const original=await f.upload(intern,{taskId,bytes:Buffer.from('Synthetic migrated governance task original\0')}),rows=await f.api('/api/teams/team-a/projects/'+r.data.projectId+'/tasks/'+taskId+'/submissions',{session:owner});assert.equal(rows.status,200);assert.equal(rows.data.submissions[0].id,original.submission.id);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_project_migration_events').get().n,1);
});

test('an approved senior technical administrator is a genuine eligible first owner',async t=>{
 const f=await createProjectMigrationFixture(t),businessOwner=await f.ready('business-role-reviewer-demo');assert.equal((await f.approve(businessOwner,'administrator-demo','manager')).status,200);
 const reviewer=await f.ready(REVIEWER),admin=await f.ready('administrator-demo'),r=await f.register(reviewer,{ownerUserId:'administrator-demo'});assert.equal(r.status,201);const view=await f.api('/api/teams/team-a/projects/'+r.data.projectId,{session:admin});assert.equal(view.status,200);assert.equal(view.data.project.canManageAccess,true);
});

test('own receipt is private to the original current reviewer; credential/ACL revocation does not erase provenance',async t=>{
 const f=await createProjectMigrationFixture(t),reviewer=await f.ready(REVIEWER),body=f.body();assert.equal((await f.api(BASE,{method:'POST',session:reviewer,body})).status,201);
 const other='second-migration-reviewer';f.db.prepare("INSERT INTO team_users VALUES (?,'active')").run(other);f.db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) SELECT ?,?,?,password_hash FROM team_credentials WHERE user_id=?').run(other,other,other,REVIEWER);f.db.prepare("INSERT INTO team_project_migration_reviewers VALUES (?,'project.migrate','active',1)").run(other);const otherActor=await f.ready(other);
 assert.equal((await f.api(BASE+'/receipts/'+body.requestId,{session:otherActor})).status,404);f.db.prepare("UPDATE team_project_migration_reviewers SET status='revoked',revision=revision+1 WHERE user_id=?").run(REVIEWER);assert.equal((await f.api(BASE+'/receipts/'+body.requestId,{session:reviewer})).status,404);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_project_migration_provenance').get().n,1);
});

test('new reviewer history blocks business affiliation, all old target flows and current business projection even when revoked',async t=>{
 const f=await createProjectMigrationFixture(t);f.db.prepare("UPDATE team_project_migration_reviewers SET status='revoked',revision=revision+1 WHERE user_id=?").run(REVIEWER);
 const {hasAffiliation}=await source('administration-policy.mjs');assert.equal(hasAffiliation(f.db,REVIEWER),true);
 f.db.prepare("INSERT INTO team_memberships VALUES ('team-a',?,'partner','active')").run(REVIEWER);
 const {businessRoleTarget}=await source('business-role-policy.mjs'),{memberAccessTarget}=await source('member-access-policy.mjs'),{recoveryTarget}=await source('recovery-review-policy.mjs'),{replacementTarget}=await source('device-replacement-policy.mjs'),{ordinaryTeamContext}=await source('project-access-policy.mjs');
 assert.equal(businessRoleTarget(f.db,'administrator-demo','team-a',REVIEWER),null);assert.equal(memberAccessTarget(f.db,'administrator-demo','business','team-a',REVIEWER),null);assert.equal(recoveryTarget(f.db,REVIEWER,f.clock.value),null);assert.equal(replacementTarget(f.db,REVIEWER),null);assert.equal(ordinaryTeamContext(f.db,REVIEWER,'team-a'),null);
 const session=await f.login(REVIEWER);assert.deepEqual(session.memberships,[]);const reviewer=await f.ready(REVIEWER);assert.equal((await f.api(ACCESS,{session:reviewer})).data.canReview,false);
});

test('wrong password, existing unregistered UUID and audit failure leave all business facts untouched',async t=>{
 const f=await createProjectMigrationFixture(t),reviewer=await f.ready(REVIEWER),before=snapshot(f);assert.equal((await f.register(reviewer,{currentPassword:'WrongPassword!2026'})).status,403);assert.deepEqual(snapshot(f),before);
 const migration=migrationSource();f.db.prepare("INSERT INTO team_projects(team_id,project_id,title,status) VALUES ('team-b',?,'existing project','active')").run(migration.initiation.quoteId);const existing=snapshot(f);assert.equal((await f.register(reviewer)).status,409);assert.deepEqual(snapshot(f),existing);f.db.prepare('DELETE FROM team_projects WHERE project_id=?').run(migration.initiation.quoteId);
 f.db.exec("CREATE TRIGGER synthetic_migration_audit_abort BEFORE INSERT ON team_project_migration_events BEGIN SELECT RAISE(ABORT,'Synthetic audit failure'); END");const auditBefore=snapshot(f);assert.equal((await f.register(reviewer)).status,503);assert.deepEqual(snapshot(f),auditBefore);
});

test('source title of the original 300-character bound is preserved as the team project title',async t=>{
 const f=await createProjectMigrationFixture(t),reviewer=await f.ready(REVIEWER),migration=migrationSource();migration.initiation.form.projectName='原'.repeat(300);const r=await f.register(reviewer,{source:migration});assert.equal(r.status,201);assert.equal(f.db.prepare('SELECT title FROM team_projects WHERE project_id=?').get(r.data.projectId).title,migration.initiation.form.projectName);
});

function onMigrationLimit(f,hook){
 const prepare=f.db.prepare;f.db.prepare=function(sql){const statement=prepare.call(this,sql);if(!/^INSERT INTO team_auth_limits/.test(sql))return statement;return new Proxy(statement,{get(target,key){if(key==='run')return(...args)=>{const result=target.run(...args);if(String(args[0]).startsWith('project-migration:'))hook();return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});};
}
async function beginRace(f,actor,body,mutate,armed=()=>true){
 const {handleTeamApplicationRequest}=await source('application-api.mjs');let fired=false;const db=new Proxy(f.db,{get(target,key){if(key==='exec')return sql=>{const result=target.exec(sql);if(sql==='BEGIN IMMEDIATE'&&!fired&&armed()){fired=true;mutate();}return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const response=await handleTeamApplicationRequest(f.makeRequest(BASE,{method:'POST',session:actor,body}),{db,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true}});return {status:response.status,fired};
}
for(const [name,mutate]of [
 ['reviewer ACL ABA',f=>{f.db.prepare("UPDATE team_project_migration_reviewers SET status='revoked' WHERE user_id=?").run(REVIEWER);f.db.prepare("UPDATE team_project_migration_reviewers SET status='active' WHERE user_id=?").run(REVIEWER);}],
 ['owner role ABA',f=>{f.db.prepare("UPDATE team_memberships SET role='assistant' WHERE user_id='manager-a'").run();f.db.prepare("UPDATE team_memberships SET role='manager' WHERE user_id='manager-a'").run();}],
 ['reviewer credential ABA',f=>{f.db.prepare('UPDATE team_credentials SET revision=revision+1 WHERE user_id=?').run(REVIEWER);f.db.prepare('UPDATE team_credentials SET revision=revision-1 WHERE user_id=?').run(REVIEWER);}]
])test('async KDF cannot approve after '+name,async t=>{
 const f=await createProjectMigrationFixture(t),reviewer=await f.ready(REVIEWER),body=f.body();let changed=false;onMigrationLimit(f,()=>{if(!changed){changed=true;queueMicrotask(()=>mutate(f));}});
 const r=await f.api(BASE,{method:'POST',session:reviewer,body});assert.equal(changed,true);assert.ok([401,404,409].includes(r.status));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_project_migration_provenance').get().n,0);
});

test('an independent transaction-boundary session revocation cannot publish a project',async t=>{
 const f=await createProjectMigrationFixture(t),reviewer=await f.ready(REVIEWER),body=f.body();let migrationBegin=false;
 // BEGIN for the device nonce occurs before the password limiter. Arm the
 // transaction injector only once actual password verification has started.
 onMigrationLimit(f,()=>{migrationBegin=true;});
 const r=await beginRace(f,reviewer,body,()=>f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(f.clock.value,digest(reviewer.token)),()=>migrationBegin);
 assert.equal(r.fired,true);assert.equal(r.status,401);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_project_migration_provenance').get().n,0);
});

test('review-only seed refuses an ordinary database without adding an account or privilege',async t=>{
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(':memory:');t.after(()=>db.close());const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');initializeTeamDatabase(db);await seedDemoTeamData(db);const before=snapshot({db});
 await assert.rejects(()=>(source('migration-demo.mjs').then(module=>module.seedProjectMigrationDemo(db))));assert.deepEqual(snapshot({db}),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM team_users').get().n,9);
});

test('review seed never repurposes a pre-existing account with its synthetic username',async t=>{
 const {createAdministratorBusinessRoleFixture}=require('./helpers/administrator-business-role-fixture.cjs'),f=await createAdministratorBusinessRoleFixture(t);f.db.prepare("INSERT INTO team_users VALUES (?,'active')").run(REVIEWER);const before=snapshot(f);
 await assert.rejects(()=>(source('migration-demo.mjs').then(module=>module.seedProjectMigrationDemo(f.db))));assert.deepEqual(snapshot(f),before);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_project_migration_reviewers').get().n,0);
});
