'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {createWorkspaceSourceFixture,good,denied,uuid,sha,codec,migrationSource,restorePasswordWork}=require('./helpers/workspace-source-fixture.cjs');
after(restorePasswordWork);
test('source grant is explicit before source exists and preserves project version',async t=>{
 const f=await createWorkspaceSourceFixture(t),revision=f.revision(f.projectId);
 assert.deepEqual(Object.keys(good(await f.access()).access).sort(),['teamId','projectId','projectRevision','grantRevision','canManageAccess','sourceAvailable','read','export'].sort());
 assert.deepEqual(good(await f.access()).access,{teamId:'team-a',projectId:f.projectId,projectRevision:revision,grantRevision:0,canManageAccess:true,sourceAvailable:false,read:false,export:false});
 denied(await f.read());good(await f.sourceGrant());assert.equal(f.revision(f.projectId),revision);denied(await f.read());
 assert.equal(good(await f.access()).access.grantRevision,1);assert.equal(good(await f.members()).members.find(m=>m.id===f.user).read,true);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workspace_source_events').get().n,1);
});
test('W source returns the original canonical bytes only after explicit read; old automatic GET is safe',async t=>{
 const f=await createWorkspaceSourceFixture(t),body=f.body(),ack=good(await f.confirm(body),201).receipt;
 assert.equal(ack.sourceProjectId,body.source.initiation.quoteId);
 const context=good(await f.context()).context;assert.equal(context.canConfirm,false);assert.equal(context.confirmation,null);
 denied(await f.receipt(body.requestId));denied(await f.read());
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workspace_source_grants').get().n,0);
 good(await f.sourceGrant());const view=good(await f.read());assert.deepEqual(Object.keys(view).sort(),['metadata','source']);
 assert.deepEqual(view.source,body.source);assert.equal(view.metadata.sourceKind,'workspace-formalization');assert.equal(view.metadata.sourceProjectId,body.source.initiation.quoteId);assert.equal(view.metadata.sourceSha256,sha(codec.encode(body.source)));assert.equal(view.metadata.byteLength,codec.encode(body.source).length);
 assert.equal(good(await f.context()).context.confirmation.requestId,body.requestId);assert.equal(good(await f.receipt(body.requestId)).receipt.requestId,body.requestId);
});
test('source-only recipient enters normal projects without collection or material rights; full removal clears it once',async t=>{
 const f=await createWorkspaceSourceFixture(t);good(await f.confirm(),201);good(await f.sourceGrant('partner-a'));const partner=await f.ready('partner-a');
 assert.ok(good(await f.api('/api/teams/team-a/projects',{session:partner})).projects.some(p=>p.id===f.projectId));
 const detail=good(await f.api(f.route(f.projectId).replace(/\/formalization$/,''),{session:partner})).project;assert.equal(detail.canRead,false);assert.equal(detail.canCreateTask,false);assert.equal(detail.canReview,false);
 good(await f.read({current:partner}));denied(await f.api(f.route(f.projectId).replace(/\/formalization$/,'')+'/tasks',{session:partner}));denied(await f.members({current:partner}));
 const revision=f.revision(f.projectId);const result=good(await f.grant(f.actor,'partner-a',{read:false,manage:false,review:false},{projectId:f.projectId}));assert.equal(result.revision,revision+1);
 const row=f.db.prepare('SELECT * FROM team_workspace_source_grants WHERE user_id=?').get('partner-a');assert.equal(row.eligible,0);assert.equal(row.can_read,0);assert.equal(row.revision,2);
 const partner2=await f.ready('partner-a');denied(await f.read({current:partner2}));assert.ok(!good(await f.api('/api/teams/team-a/projects',{session:partner2})).projects.some(p=>p.id===f.projectId));
});
test('Q migration uses its saved original source and reviewer receipt grants no source authority',async t=>{
 const f=await createWorkspaceSourceFixture(t,{migration:true}),value=migrationSource({id:uuid(),sequence:44}),registered=good(await f.register({source:value}),201);
 const id=value.initiation.quoteId;assert.equal(registered.projectId,id);denied(await f.read({id}));good(await f.sourceGrant(f.user,{id}));
 const view=good(await f.read({id}));assert.equal(view.metadata.sourceKind,'project-migration');assert.equal(view.metadata.projectId,view.metadata.sourceProjectId);assert.deepEqual(view.source,value);
});
test('wrong password, no-op, foreign project and invalid request have no source side effects',async t=>{
 const f=await createWorkspaceSourceFixture(t),before=f.sourceSnapshot();denied(await f.sourceGrant(f.user,{currentPassword:'wrong'}),403);assert.deepEqual(f.sourceSnapshot(),before);
 denied(await f.access({method:'POST',body:{...f.grantBody(),confirmed:true}}),400);denied(await f.sourceGrant('manager-b'));assert.deepEqual(f.sourceSnapshot(),before);
 good(await f.sourceGrant());const granted=f.sourceSnapshot();denied(await f.sourceGrant(),409);assert.deepEqual(f.sourceSnapshot(),granted);
 denied(await f.read({id:'unknown-project'}));denied(await f.access({method:'POST',body:{...f.grantBody(),projectRevision:0}}),400);
});
