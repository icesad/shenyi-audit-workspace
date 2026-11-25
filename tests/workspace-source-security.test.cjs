'use strict';
const nodeTest=require('node:test'),assert=require('node:assert/strict');
const {createWorkspaceSourceFixture,good,denied,uuid,sha,codec,migrationSource,source,restorePasswordWork}=require('./helpers/workspace-source-fixture.cjs');
nodeTest.after(restorePasswordWork);
const test=(name,fn)=>nodeTest(name,{timeout:45000},fn);
const rejected=r=>{assert.ok([401,403,404,409].includes(r.status),JSON.stringify(r.data));assert.ok(r.data?.error);assert.equal(Object.hasOwn(r.data,'source'),false);};
test('source endpoints require a signed current device and the same origin',async t=>{
 const f=await createWorkspaceSourceFixture(t),boot=await f.login('manager-a'),before=f.sourceSnapshot();
 denied(await f.access({current:boot}),403);denied(await f.access({headers:{Origin:'https://foreign.invalid'}}),403);
 denied(await f.access({strict:false}),403);assert.equal((await f.access({method:'DELETE'})).status,405);assert.deepEqual(f.sourceSnapshot(),before);
});
test('source request rejects coercible IDs, extra keys, unsafe versions and nonboolean flags',async t=>{
 const f=await createWorkspaceSourceFixture(t),before=f.sourceSnapshot();
 for(const patch of [{userId:['manager-a']},{userId:{}},{memberRevision:'0'},{grantRevision:-1},{grantRevision:1.5},{projectRevision:9007199254740992},{read:1},{export:'false'},{currentPassword:[]},{actorId:'manager-a'},{confirmed:true}])denied(await f.sourceGrant(f.user,{body:{...f.grantBody(),...patch}}),400);
 assert.deepEqual(f.sourceSnapshot(),before);
});
test('only the owner can configure eligible team seniors and role does not grant source read',async t=>{
 const f=await createWorkspaceSourceFixture(t),before=f.sourceSnapshot();
 for(const user of ['intern-a','manager-b','administrator-demo','recovery-reviewer-demo'])denied(await f.sourceGrant(user));
 const partner=await f.ready('partner-a');denied(await f.sourceGrant('partner-a',{current:partner}));denied(await f.read({current:partner}));assert.deepEqual(f.sourceSnapshot(),before);
});
test('member pagination includes self, uses exact filtered anchors and discloses no credential fields',async t=>{
 const f=await createWorkspaceSourceFixture(t);for(let i=0;i<3;i++)f.addMember('source-senior-'+i,{displayName:'Source candidate '+i});
 const first=good(await f.members({query:'?q=Source&limit=2'}));assert.equal(first.members.length,2);assert.equal(first.hasMore,true);assert.deepEqual(first.members.map(m=>m.id),['source-senior-0','source-senior-1']);
 const next=good(await f.members({query:'?q=Source&limit=2&after='+first.members.at(-1).id}));assert.equal(next.members.length,1);assert.equal(next.hasMore,false);assert.equal(next.members[0].id,'source-senior-2');
 assert.deepEqual(Object.keys(next.members[0]).sort(),['id','displayName','role','memberRevision','grantRevision','read','export'].sort());assert.doesNotMatch(JSON.stringify(first),/password|hash|token|team_id|epoch/);
 assert.ok(good(await f.members()).members.some(m=>m.id==='manager-a'));denied(await f.members({query:'?q=Source&after=manager-a'}));
 for(const query of ['?after=','?limit=0','?limit=51','?q=a&q=b','?userId=manager-a','?q=%00','?q='+('x'.repeat(81))])denied(await f.members({query}),400);
});
test('partial collection grants do not add or remove independent source permissions',async t=>{
 const f=await createWorkspaceSourceFixture(t);good(await f.sourceGrant('partner-a'));const before=f.sourceSnapshot();
 good(await f.grant(f.actor,'partner-a',{read:true,manage:false,review:false},{projectId:f.projectId}));assert.deepEqual(f.sourceSnapshot(),before);
 good(await f.grant(f.actor,'partner-a',{read:true,manage:true,review:true},{projectId:f.projectId}));assert.deepEqual(f.sourceSnapshot(),before);
});
test('frozen source remains readable while grant writes close and archive permanently latches old grants',async t=>{
 const f=await createWorkspaceSourceFixture(t);good(await f.confirm(),201);good(await f.sourceGrant());f.db.prepare("UPDATE team_projects SET status='frozen' WHERE project_id=?").run(f.projectId);
 good(await f.read());assert.equal(good(await f.access()).access.canManageAccess,false);denied(await f.sourceGrant(f.user,{read:false}),409);
 f.db.prepare("UPDATE team_projects SET status='archived' WHERE project_id=?").run(f.projectId);denied(await f.read());f.db.prepare("UPDATE team_projects SET status='active' WHERE project_id=?").run(f.projectId);denied(await f.read());assert.equal(good(await f.access()).access.read,false);
});
for(const [label,mutate] of [
 ['role',f=>f.db.exec("UPDATE team_memberships SET role='intern' WHERE user_id='partner-a'; UPDATE team_memberships SET role='partner' WHERE user_id='partner-a'")],
 ['account',f=>f.db.exec("UPDATE team_users SET status='disabled' WHERE user_id='partner-a'; UPDATE team_users SET status='active' WHERE user_id='partner-a'")],
 ['team',f=>f.db.exec("UPDATE teams SET status='disabled' WHERE team_id='team-a'; UPDATE teams SET status='active' WHERE team_id='team-a'")]
])test(label+' revoke/restore ABA cannot revive an old source grant',async t=>{
 const f=await createWorkspaceSourceFixture(t);good(await f.confirm(),201);good(await f.sourceGrant('partner-a'));mutate(f);
 const partner=await f.ready('partner-a'),owner=await f.ready('manager-a');denied(await f.read({current:partner}));const row=f.db.prepare("SELECT * FROM team_workspace_source_grants WHERE user_id='partner-a'").get();assert.equal(row.eligible,0);assert.equal(row.revision,2);
 good(await f.sourceGrant('partner-a',{current:owner}));good(await f.read({current:partner}));assert.equal(f.db.prepare("SELECT revision FROM team_workspace_source_grants WHERE user_id='partner-a'").get().revision,3);
});
test('owner ACL loss and restore does not resurrect its personal source read',async t=>{
 const f=await createWorkspaceSourceFixture(t);good(await f.confirm(),201);good(await f.sourceGrant());f.db.prepare("UPDATE team_project_access_grants SET status='revoked',revision=revision+1 WHERE project_id=? AND user_id='manager-a' AND permission='project.owner'").run(f.projectId);f.db.prepare("UPDATE team_project_access_grants SET status='active',revision=revision+1 WHERE project_id=? AND user_id='manager-a' AND permission='project.owner'").run(f.projectId);
 const current=await f.ready('manager-a');denied(await f.read({current}));assert.equal(good(await f.access({current})).access.read,false);good(await f.sourceGrant(f.user,{current}));good(await f.read({current}));
});
for(const who of ['manager-a','partner-a'])test(who+' role ABA during password work cannot publish a stale source grant',async t=>{
 const f=await createWorkspaceSourceFixture(t),h=f.passwordHold(),pending=f.sourceGrant('partner-a');await h.entered.promise;f.roleABA(who);const before=f.sourceSnapshot();h.release.resolve();rejected(await pending);assert.deepEqual(f.sourceSnapshot(),before);
});
test('body await repeats owner identity capture',async t=>{
 const f=await createWorkspaceSourceFixture(t),prepare=f.db.prepare;let hit=false;
 f.db.prepare=function(sql){const s=prepare.call(this,sql);if(sql.includes('SELECT member.role,credential.password_hash')){const get=s.get;s.get=function(...args){const row=get.apply(this,args);if(!hit){hit=true;queueMicrotask(()=>f.roleABA());}return row;};}return s;};t.after(()=>{f.db.prepare=prepare;});
 const before=f.sourceSnapshot();rejected(await f.sourceGrant());assert.equal(hit,true);assert.deepEqual(f.sourceSnapshot(),before);
});
test('BEGIN identity mutation rolls back source state and transaction-local identity changes',async t=>{
 const f=await createWorkspaceSourceFixture(t),before=f.snapshot(),h=f.passwordHold(),pending=f.sourceGrant();await h.entered.promise;const exec=f.db.exec;let hit=false;
 f.db.exec=function(sql){const result=exec.call(this,sql);if(sql==='BEGIN IMMEDIATE'&&!hit){hit=true;f.roleABA();}return result;};t.after(()=>{f.db.exec=exec;});h.release.resolve();rejected(await pending);assert.equal(hit,true);assert.deepEqual(f.snapshot(),before);
});
for(const [label,statement] of [
 ['audit failure',"SELECT RAISE(ABORT,'injected audit failure')"],
 ['target role ABA',"UPDATE team_memberships SET role='intern' WHERE user_id=NEW.target_user_id; UPDATE team_memberships SET role='partner' WHERE user_id=NEW.target_user_id"],
 ['unrelated task smuggle',"UPDATE team_collection_tasks SET title='Injected task' WHERE project_id=NEW.project_id"],
 ['project revision change',"UPDATE team_project_access_projects SET revision=revision+1 WHERE project_id=NEW.project_id"]
])test(label+' during source audit causes full rollback',async t=>{
 const f=await createWorkspaceSourceFixture(t);good(await f.createTask(f.actor,{projectId:f.projectId}),201);f.db.exec('CREATE TRIGGER independent_source_fault AFTER INSERT ON team_workspace_source_events BEGIN '+statement+'; END');const before=f.snapshot();const result=await f.sourceGrant('partner-a');assert.ok([409,503].includes(result.status),JSON.stringify(result));assert.deepEqual(f.snapshot(),before);
});
test('COMMIT failure rolls back the complete grant and immutable event',async t=>{
 const f=await createWorkspaceSourceFixture(t),before=f.snapshot(),h=f.passwordHold(),pending=f.sourceGrant();await h.entered.promise;const exec=f.db.exec;let hit=false;
 f.db.exec=function(sql){if(sql==='COMMIT'&&!hit){hit=true;throw Error('injected COMMIT fault');}return exec.call(this,sql);};t.after(()=>{f.db.exec=exec;});h.release.resolve();denied(await pending,503);assert.equal(hit,true);assert.deepEqual(f.snapshot(),before);
});
for(const change of ['epoch','server UUID'])test('original device nonce stamp rejects '+change+' mutation before source handler capture',async t=>{
 const f=await createWorkspaceSourceFixture(t),app=await source('application-api.mjs'),prepare=f.db.prepare,request=f.makeRequest(f.sourceRoute()+'/access',{session:f.actor}),n=f.db.prepare('SELECT count(*) n FROM team_device_request_replays').get().n;let hit=false;
 const now=()=>{if(!hit&&prepare.call(f.db,'SELECT count(*) n FROM team_device_request_replays').get().n>n){hit=true;if(change==='epoch')prepare.call(f.db,"UPDATE team_recovery_identity_epochs SET version=version+1 WHERE user_id='manager-a'").run();else prepare.call(f.db,"UPDATE team_database_metadata SET value=? WHERE name='device-server-id'").run(uuid());}return f.clock.value;};
 const response=await app.handleTeamApplicationRequest(request,{db:f.db,now,identityProviders:{deviceProofRequired:true}});assert.equal(hit,true);assert.notEqual(response.status,200);assert.equal(Object.hasOwn(await response.json(),'access'),false);
});
test('MAX grant revision, replacement and immutable audit guards cannot reset source history',async t=>{
 const f=await createWorkspaceSourceFixture(t);good(await f.sourceGrant());const row=f.db.prepare('SELECT * FROM team_workspace_source_grants').get(),before=f.sourceSnapshot();
 assert.throws(()=>f.db.prepare('INSERT OR REPLACE INTO team_workspace_source_grants VALUES (?,?,?,?,?,?,?)').run(row.team_id,row.project_id,row.user_id,1,0,1,1));assert.throws(()=>f.db.exec('DELETE FROM team_workspace_source_grants'));assert.throws(()=>f.db.exec('UPDATE team_workspace_source_events SET reason=reason'));assert.deepEqual(f.sourceSnapshot(),before);
 f.db.exec('DROP TRIGGER workspace_source_grant_monotonic');f.db.prepare('UPDATE team_workspace_source_grants SET revision=9007199254740991').run();const max=f.sourceSnapshot();denied(await f.sourceGrant(f.user,{read:false}),409);assert.deepEqual(f.sourceSnapshot(),max);
});
test('W equal to Q is read under the team resource namespace without recomputing its local quote',async t=>{
 const f=await createWorkspaceSourceFixture(t),value=migrationSource({id:f.projectId,sequence:43});good(await f.confirm(f.body({source:value})),201);good(await f.sourceGrant());const result=good(await f.read());assert.equal(result.metadata.sourceProjectId,result.metadata.projectId);assert.equal(result.metadata.sourceKind,'workspace-formalization');assert.deepEqual(result.source,value);assert.equal(result.metadata.sourceSha256,sha(codec.encode(value)));
});
for(const kind of ['source view','automatic formalization','formal receipt'])test(kind+' discards the response if source read is revoked inside its source query',async t=>{
 const f=await createWorkspaceSourceFixture(t),body=f.body();good(await f.confirm(body),201);good(await f.sourceGrant());const prepare=f.db.prepare;let hit=false;
 f.db.prepare=function(sql){const statement=prepare.call(this,sql);if(kind==='source view'?sql==='SELECT * FROM team_workspace_formalizations WHERE project_id=?':sql.startsWith('SELECT formal.request_id')){const get=statement.get;statement.get=function(...args){const row=get.apply(this,args);if(!hit){hit=true;prepare.call(f.db,'UPDATE team_workspace_source_grants SET can_read=0,revision=revision+1 WHERE project_id=? AND user_id=?').run(f.projectId,f.user);}return row;};}return statement;};t.after(()=>{f.db.prepare=prepare;});
 const result=kind==='source view'?await f.read():kind==='formal receipt'?await f.receipt(body.requestId):await f.context();rejected(result);assert.equal(hit,true);assert.equal(Object.hasOwn(result.data,'source'),false);assert.equal(Object.hasOwn(result.data,'context'),false);
});
test('old full-project revoke rolls back a source audit which attempts to restore source access',async t=>{
 const f=await createWorkspaceSourceFixture(t);good(await f.sourceGrant('partner-a'));f.db.exec("CREATE TRIGGER independent_source_restore AFTER INSERT ON team_workspace_source_events WHEN NEW.action='access.revoked' BEGIN UPDATE team_workspace_source_grants SET can_read=1,eligible=1,revision=revision+1 WHERE team_id=NEW.team_id AND project_id=NEW.project_id AND user_id=NEW.target_user_id; END");const before=f.snapshot();denied(await f.grant(f.actor,'partner-a',{read:false,manage:false,review:false},{projectId:f.projectId}),409);assert.deepEqual(f.snapshot(),before);
});
test('legitimate team-admin role change clears source-only flags and records its revocation',async t=>{
 const f=await createWorkspaceSourceFixture(t);good(await f.sourceGrant('partner-a'));const admin=await f.ready('administrator-demo');good(await f.change(admin,'partner-a','manager'));
 const row=f.db.prepare("SELECT * FROM team_workspace_source_grants WHERE user_id='partner-a'").get();assert.equal(row.eligible,0);assert.equal(row.can_read,0);assert.equal(row.can_export,0);assert.ok(f.db.prepare("SELECT 1 FROM team_workspace_source_events WHERE target_user_id='partner-a' AND action='access.revoked' AND reason='business-role.changed'").get());
});
test('legitimate team-admin member disable clears source-only grants in the same transaction',async t=>{
 const f=await createWorkspaceSourceFixture(t);good(await f.sourceGrant('partner-a'));const admin=await f.ready('administrator-demo');good(await f.api('/api/teams/team-a/business-members/partner-a/disable',{method:'POST',session:admin,body:{revision:f.epoch('partner-a'),currentPassword:require('./helpers/workspace-source-fixture.cjs').PASSWORD}}));
 const row=f.db.prepare("SELECT * FROM team_workspace_source_grants WHERE user_id='partner-a'").get();assert.equal(row.eligible,0);assert.equal(row.can_read,0);assert.ok(f.db.prepare("SELECT 1 FROM team_workspace_source_events WHERE target_user_id='partner-a' AND action='access.revoked' AND reason='member.disabled'").get());
});
