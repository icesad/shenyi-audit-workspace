'use strict';
// Independent M4L: isolated real SQLite, strict signed requests and actual desktop seams.
const nodeTest=require('node:test'),assert=require('node:assert/strict');
const {fixture,actualClient,good,denied,uuid,sha,deferred,codec,migrationSource,PASSWORD,restorePasswordWork}=require('./helpers/workspace-formalization-security-fixture.cjs');
nodeTest.after(restorePasswordWork);
const test=(name,fn)=>nodeTest(name,{timeout:45000},fn);
const FORMAL='team_workspace_formalizations',MODE='owner-attested-local-source';
const RECEIPT=['requestId','teamId','projectId','sourceProjectId','sourceTitle','sourceSha256','businessNumber','confirmedBy','confirmedAt','projectRevisionBefore','projectRevisionAfter','confirmationMode'];
const PROJECT=['id','title','status','revision','canRead','canManageAccess','canCreateTask','canReview'];
const exact=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
const rejected=response=>{assert.ok([401,403,404,409].includes(response.status),JSON.stringify(response.data));assert.ok(response.data?.error);};

test('normal owner confirms saved source while preserving W original data rights creation and source policy',async t=>{
 const f=await fixture(t),task=good(await f.createTask(f.actor,{projectId:f.projectId}),201).task;
 const before=f.snapshot({omit:[FORMAL],revisionOf:f.projectId}),value=f.body(),oldView=good(await f.view()).project,context=good(await f.context()).context;exact(context,['teamId','projectId','projectRevision','canConfirm','confirmation']);assert.equal(context.canConfirm,true);assert.equal(context.confirmation,null);
 const result=good(await f.confirm(value),201);exact(result,['receipt']);exact(result.receipt,RECEIPT);const r=result.receipt;
 assert.equal(r.requestId,value.requestId);assert.equal(r.projectId,f.projectId);assert.notEqual(r.projectId,r.sourceProjectId);assert.equal(r.sourceProjectId,value.source.quote.id);assert.equal(r.sourceSha256,value.sourceSha256);assert.equal(r.confirmedBy,'manager-a');assert.equal(r.confirmedAt,f.clock.value);assert.equal(r.projectRevisionBefore,value.projectRevision);assert.equal(r.projectRevisionAfter,value.projectRevision+1);assert.equal(r.confirmationMode,MODE);
 assert.deepEqual(f.snapshot({omit:[FORMAL],revisionOf:f.projectId}),before);const row=f.db.prepare('SELECT * FROM '+FORMAL).get();assert.equal(row.source_json,Buffer.from(codec.encode(value.source)).toString('utf8'));assert.equal(sha(row.source_json),r.sourceSha256);assert.equal(JSON.parse(row.source_json).policy.identityAuthenticated,false);assert.equal(JSON.parse(row.source_json).policy.professionalApprovalClaimed,false);assert.equal(f.db.prepare('SELECT project_id FROM team_collection_tasks WHERE task_id=?').get(task.id).project_id,f.projectId);
 const current=good(await f.view()).project;exact(current,[...PROJECT,'kind','businessConfirmed']);assert.deepEqual(current,{...oldView,revision:oldView.revision+1,businessConfirmed:true});assert.deepEqual(good(await f.receipt(r.requestId)).receipt,r);assert.equal(good(await f.context()).context.canConfirm,false);
 const historical=good(await f.api('/api/teams/team-a/collection-workspaces/receipts/'+f.creation.requestId,{session:f.actor})).receipt;assert.deepEqual(historical,f.creation);
});

test('owner with no collection rights may attest without gaining task read review or materials rights',async t=>{
 const f=await fixture(t,{flags:{read:false,manage:false,review:false}}),input=f.body(),r=good(await f.confirm(input),201).receipt,p=good(await f.view()).project;assert.equal(p.canRead,false);assert.equal(p.canCreateTask,false);assert.equal(p.canReview,false);assert.equal(p.canManageAccess,true);assert.equal(p.businessConfirmed,true);denied(await f.createTask(f.actor,{projectId:f.projectId}),404);
 f.db.prepare('INSERT INTO team_material_grants VALUES (?,?,?,1,1,1,1,1,1)').run('team-a',f.projectId,'manager-a');const before=f.snapshot({resourcesOnly:true});for(const tail of ['', '/access','/members','/receipts/'+r.requestId,'/files/'+uuid()])denied(await f.api(f.route().replace('/formalization','/materials')+tail,{session:f.actor}),404);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('read manage and review together do not substitute owner or permit foreign source context',async t=>{
 const f=await fixture(t);good(await f.grant(f.actor,'partner-a',{read:true,manage:true,review:true},{projectId:f.projectId}));const value=f.body();for(const user of ['partner-a','intern-a','administrator-demo','recovery-reviewer-demo','manager-b']){const current=await f.ready(user),before=f.snapshot({resourcesOnly:true});denied(await f.context({current}),404);denied(await f.confirm(value,{current}),404);denied(await f.receipt(uuid(),{current}),404);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);}denied(await f.context({teamId:'team-b'}),404);denied(await f.context({id:uuid()}),404);
});

test('strict device proof origin exact route query and method gates cannot be bypassed',async t=>{
 const f=await fixture(t),boot=await f.login('manager-a'),before=f.snapshot({resourcesOnly:true});denied(await f.confirm(f.body(),{current:boot}),403);denied(await f.confirm(f.body(),{headers:{Origin:'https://outside.invalid'}}),403);denied(await f.api(f.route()+'?extra=1',{session:f.actor}),400);assert.equal((await f.api(f.route(),{method:'DELETE',session:f.actor})).status,405);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('exact six body fields require explicit business confirmation canonical source and matching SHA',async t=>{
 const f=await fixture(t),base=f.body(),before=f.snapshot({resourcesOnly:true});for(const patch of [{businessConfirmed:false},{businessConfirmed:'true'},{confirmedBy:'partner-a'},{confirmationMode:'automatic'},{sourceProjectId:uuid()},{projectRevision:0},{projectRevision:1.5},{sourceSha256:'A'.repeat(64)},{sourceSha256:'0'.repeat(64)},{requestId:'NOT-A-UUID'},{currentPassword:''}])denied(await f.confirm({...base,...patch}),400);
 for(const mutate of [v=>{v.policy.identityAuthenticated=true;},v=>{v.policy.professionalApprovalClaimed=true;},v=>{v.quote.events.at(-1).outcome='lost';},v=>{v.initiation.source.quoteId=uuid();},v=>{v.numbering.businessNumber='2026-A-专项审计-0043';}]){const value=structuredClone(base.source);mutate(value);denied(await f.confirm({...base,source:value}),400);}const missing={...base};delete missing.businessConfirmed;denied(await f.confirm(missing),400);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('wrong owner password cannot publish formal facts or advance workspace revision',async t=>{
 const f=await fixture(t),before=f.snapshot();denied(await f.confirm(f.body({currentPassword:'Incorrect-current-password'})),403);assert.deepEqual(f.snapshot(),before);
});

test('frozen context and committed receipt remain readable while new confirmation and archived reads close',async t=>{
 const f=await fixture(t),first=f.body();f.db.prepare("UPDATE team_projects SET status='frozen' WHERE project_id=?").run(f.projectId);assert.equal(good(await f.context()).context.canConfirm,false);denied(await f.confirm(first),409);f.db.prepare("UPDATE team_projects SET status='active' WHERE project_id=?").run(f.projectId);const r=good(await f.confirm({...first,projectRevision:f.revision(f.projectId)}),201).receipt;f.db.prepare("UPDATE team_projects SET status='frozen' WHERE project_id=?").run(f.projectId);assert.deepEqual(good(await f.receipt(r.requestId)).receipt,r);assert.equal(good(await f.context()).context.canConfirm,false);f.db.prepare("UPDATE team_projects SET status='archived' WHERE project_id=?").run(f.projectId);denied(await f.context(),404);denied(await f.receipt(r.requestId),404);
});

test('MAX safe project revision refuses confirmation without overflowing or writing audit',async t=>{
 const f=await fixture(t);f.db.prepare('UPDATE team_project_access_projects SET revision=9007199254740991 WHERE project_id=?').run(f.projectId);const before=f.snapshot();assert.equal(good(await f.context()).context.canConfirm,false);denied(await f.confirm(f.body()),409);assert.deepEqual(f.snapshot(),before);
});

test('Q equal to its own W is legal and retains the immutable collection origin',async t=>{
 const f=await fixture(t),value=f.body({source:migrationSource({id:f.projectId,sequence:43})}),r=good(await f.confirm(value),201).receipt;assert.equal(r.sourceProjectId,f.projectId);const p=good(await f.view()).project;assert.equal(p.id,f.projectId);assert.equal(p.kind,'collection-workspace');assert.equal(p.businessConfirmed,true);assert.equal(f.db.prepare('SELECT count(*) n FROM team_projects WHERE project_id=?').get(f.projectId).n,1);
});

test('Q already belonging to another team project or collection workspace cannot be adopted',async t=>{
 const f=await fixture(t),q=uuid();f.db.prepare("INSERT INTO team_projects(team_id,project_id,title,status) VALUES ('team-b',?,'Foreign old unmanaged project','active')").run(q);const before=f.snapshot({resourcesOnly:true});denied(await f.confirm(f.body({source:migrationSource({id:q,sequence:43})})),409);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);const other=good(await f.create(),201).receipt;denied(await f.confirm(f.body({source:migrationSource({id:other.projectId,sequence:44})})),409);
});

test('W and Q are globally one to one and a duplicate request never republishes',async t=>{
 const f=await fixture(t),value=f.body(),r=good(await f.confirm(value),201).receipt,other=good(await f.create(),201).receipt,before=f.snapshot({resourcesOnly:true});denied(await f.confirm(value),409);denied(await f.confirm(f.body({source:migrationSource({id:uuid(),sequence:44})})),409);denied(await f.confirm({...value,requestId:uuid(),projectRevision:f.revision(other.projectId)},{id:other.projectId}),409);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);assert.deepEqual(good(await f.receipt(r.requestId)).receipt,r);denied(await f.receipt(r.requestId,{id:other.projectId}),404);
});

test('same team year sequence conflicts in both M4F directions even with changed display risk',async t=>{
 const f=await fixture(t,{migration:true}),old=migrationSource({id:uuid(),sequence:43});good(await f.register({source:old}),201);const variant=migrationSource({id:uuid(),sequence:43});variant.numbering.riskLevel='A类';variant.numbering.businessNumber='2026-A-专项审计-0043';codec.validate(variant);denied(await f.confirm(f.body({source:variant})),409);
 const value=f.body({source:migrationSource({id:uuid(),sequence:44})});good(await f.confirm(value),201);const before=f.snapshot({resourcesOnly:true});denied(await f.register({source:migrationSource({id:uuid(),sequence:44})}),409);denied(await f.register({source:migrationSource({id:value.source.quote.id,sequence:45})}),409);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('creation and M4F request identities are permanently unavailable to formalization',async t=>{
 const f=await fixture(t,{migration:true}),m=good(await f.register(),201),before=f.snapshot({resourcesOnly:true});denied(await f.confirm(f.body({requestId:f.creation.requestId})),409);denied(await f.confirm(f.body({requestId:m.requestId})),409);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('formalization request cannot be reused by workspace creation or M4F in any target team',async t=>{
 const f=await fixture(t,{migration:true}),value=f.body();good(await f.confirm(value),201);const other=await f.ready('manager-b'),before=f.snapshot({resourcesOnly:true});denied(await f.create({requestId:value.requestId}),409);denied(await f.create({requestId:value.requestId,current:other,teamId:'team-b'}),409);denied(await f.register({requestId:value.requestId}),409);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);denied(await f.receipt(value.requestId,{current:other,teamId:'team-b'}),404);
});

test('reserved Q rejects raw project INSERT and genuine key UPDATE but accepts a same key UPDATE',async t=>{
 const f=await fixture(t),value=f.body();good(await f.confirm(value),201);const q=value.source.quote.id;assert.throws(()=>f.db.prepare("INSERT INTO team_projects(team_id,project_id,title,status) VALUES ('team-b',?,'Conflicting Q','active')").run(q),/WORKSPACE_FORMALIZATION_CONFLICT/);assert.throws(()=>f.db.prepare("UPDATE team_projects SET project_id=? WHERE team_id='team-a' AND project_id='project-a'").run(q),/WORKSPACE_FORMALIZATION_CONFLICT/);assert.equal(f.db.prepare('UPDATE team_projects SET team_id=team_id,project_id=project_id WHERE project_id=?').run(f.projectId).changes,1);assert.equal(good(await f.view()).project.businessConfirmed,true);
});

test('formalization retains immutable facts with precisely one new table and seven guards',async t=>{
 const f=await fixture(t),value=f.body();good(await f.confirm(value),201);const before=f.snapshot();assert.throws(()=>f.db.prepare('UPDATE '+FORMAL+' SET source_title=? WHERE request_id=?').run('replacement',value.requestId),/immutable/);assert.throws(()=>f.db.prepare('DELETE FROM '+FORMAL+' WHERE request_id=?').run(value.requestId),/retained/);assert.deepEqual(f.snapshot(),before);
 const definitions=f.db.prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL").all();assert.equal(definitions.filter(v=>/^workspace_formalization_/.test(v.name)).length,7);assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n,70);
 assert.equal(definitions.length,217);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('real password work cannot survive owner role revoke and restore ABA',async t=>{
 const f=await fixture(t),before=f.snapshot({resourcesOnly:true}),h=f.passwordHold(),pending=f.confirm();await h.entered.promise;f.roleABA();h.release.resolve();rejected(await pending);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('team disabled and restored during real password work invalidates the captured identity',async t=>{
 const f=await fixture(t),before=f.snapshot({resourcesOnly:true}),h=f.passwordHold(),pending=f.confirm();await h.entered.promise;f.db.exec("UPDATE teams SET status='disabled' WHERE team_id='team-a'; UPDATE teams SET status='active' WHERE team_id='team-a'");h.release.resolve();rejected(await pending);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('credential change and restoration during real password work cannot authenticate an old stamp',async t=>{
 const f=await fixture(t),before=f.snapshot({resourcesOnly:true}),old=f.db.prepare("SELECT password_hash FROM team_credentials WHERE user_id='manager-a'").get().password_hash,h=f.passwordHold(),pending=f.confirm();await h.entered.promise;f.db.prepare("UPDATE team_credentials SET password_hash=? WHERE user_id='manager-a'").run(old.replace(/.$/,old.endsWith('0')?'1':'0'));f.db.prepare("UPDATE team_credentials SET password_hash=? WHERE user_id='manager-a'").run(old);h.release.resolve();rejected(await pending);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('replacing a lease during password work rejects old confirmation without harming the new session',async t=>{
 const f=await fixture(t),before=f.snapshot({resourcesOnly:true}),h=f.passwordHold(),pending=f.confirm();await h.entered.promise;const current=await f.ready('manager-a',f.keys.get('manager-a'));h.release.resolve();rejected(await pending);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);assert.equal((await f.api('/api/auth/devices/connection',{session:current})).status,200);
});

test('body await rechecks identity when a role ABA follows initial owner capture',async t=>{
 const f=await fixture(t),before=f.snapshot({resourcesOnly:true}),prepare=f.db.prepare;let hit=false;f.db.prepare=function(sql){const st=prepare.call(this,sql);if(sql.includes('SELECT member.role,credential.password_hash')){const get=st.get;st.get=function(...args){const value=get.apply(this,args);if(!hit){hit=true;queueMicrotask(()=>f.roleABA());}return value;};}return st;};t.after(()=>{f.db.prepare=prepare;});rejected(await f.confirm());assert.equal(hit,true);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('BEGIN rechecks an identity ABA and rolls back all transaction local changes',async t=>{
 const f=await fixture(t),before=f.snapshot(),h=f.passwordHold(),pending=f.confirm();await h.entered.promise;const exec=f.db.exec;let hit=false;f.db.exec=function(sql){const result=exec.call(this,sql);if(sql==='BEGIN IMMEDIATE'&&!hit){hit=true;f.roleABA();}return result;};t.after(()=>{f.db.exec=exec;});h.release.resolve();rejected(await pending);assert.equal(hit,true);assert.deepEqual(f.snapshot(),before);
});

test('audit INSERT failure rolls back metadata CAS and every preserved typed row',async t=>{
 const f=await fixture(t);f.db.exec('CREATE TRIGGER independent_formal_abort BEFORE INSERT ON '+FORMAL+" BEGIN SELECT RAISE(ABORT,'independent audit failure'); END");const before=f.snapshot();denied(await f.confirm(),503);assert.deepEqual(f.snapshot(),before);
});

test('AFTER audit role ABA cannot commit despite a restored visible role',async t=>{
 const f=await fixture(t);f.db.exec('CREATE TRIGGER independent_formal_role AFTER INSERT ON '+FORMAL+" BEGIN UPDATE team_memberships SET role='intern' WHERE user_id=NEW.confirmed_by; UPDATE team_memberships SET role='manager' WHERE user_id=NEW.confirmed_by; END");const before=f.snapshot();rejected(await f.confirm());assert.deepEqual(f.snapshot(),before);
});

test('audit mutation of title permissions or maximum project version causes exact full rollback',async t=>{
 const f=await fixture(t);for(const statement of ["UPDATE team_projects SET title='Injected title' WHERE project_id=NEW.project_id", "UPDATE team_project_grants SET status='revoked' WHERE project_id=NEW.project_id AND permission='collection.read'",'UPDATE team_project_access_projects SET revision=9007199254740991 WHERE project_id=NEW.project_id']){f.db.exec('CREATE TRIGGER independent_formal_resources AFTER INSERT ON '+FORMAL+' BEGIN '+statement+'; END');const before=f.snapshot();denied(await f.confirm(),409);assert.deepEqual(f.snapshot(),before);f.db.exec('DROP TRIGGER independent_formal_resources');}
});

test('an audit trigger cannot smuggle a task mutation outside the explicit owner resource facts',async t=>{
 const f=await fixture(t);good(await f.createTask(f.actor,{projectId:f.projectId}),201);f.db.exec('CREATE TRIGGER independent_formal_task AFTER INSERT ON '+FORMAL+" BEGIN UPDATE team_collection_tasks SET title='Injected task change' WHERE project_id=NEW.project_id; END");const before=f.snapshot();denied(await f.confirm(),409);assert.deepEqual(f.snapshot(),before);
});

test('receipt SELECT followed by actual owner revocation returns no stale source facts',async t=>{
 const f=await fixture(t),value=f.body();good(await f.confirm(value),201);const prepare=f.db.prepare;let hit=false;f.db.prepare=function(sql){const st=prepare.call(this,sql);if(sql.startsWith('SELECT formal.request_id')){const get=st.get;st.get=function(...args){const row=get.apply(this,args);if(!hit){hit=true;prepare.call(f.db,"UPDATE team_project_access_grants SET status='revoked',revision=revision+1 WHERE project_id=? AND permission='project.owner'").run(f.projectId);}return row;};}return st;};t.after(()=>{f.db.prepare=prepare;});const r=await f.receipt(value.requestId);rejected(r);assert.equal(hit,true);assert.equal(Object.hasOwn(r.data,'receipt'),false);
});

test('approved administrator owner is eligible but its approval ABA during KDF cannot publish',async t=>{
 const f=await fixture(t,{migration:true}),reviewer=await f.ready('business-role-reviewer-demo');good(await f.api('/api/administrator-business-roles/administrator-demo',{method:'POST',session:reviewer,body:{revision:f.epoch('administrator-demo'),role:'manager',currentPassword:PASSWORD}}));const admin=await f.ready('administrator-demo'),w=good(await f.create({current:admin}),201).receipt;
 const first=f.body({projectRevision:f.revision(w.projectId),source:migrationSource({id:uuid(),sequence:44})});assert.equal(good(await f.confirm(first,{current:admin,id:w.projectId}),201).receipt.confirmedBy,'administrator-demo');const second=good(await f.create({current:admin}),201).receipt,h=f.passwordHold(),pending=f.confirm(f.body({projectRevision:f.revision(second.projectId),source:migrationSource({id:uuid(),sequence:45})}),{current:admin,id:second.projectId});await h.entered.promise;f.db.exec("UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE user_id='administrator-demo'; UPDATE team_administrator_business_roles SET status='active',revision=revision+1 WHERE user_id='administrator-demo'");const before=f.snapshot({resourcesOnly:true});h.release.resolve();rejected(await pending);assert.deepEqual(f.snapshot({resourcesOnly:true}),before);
});

test('normal new lease reconciles immutable owner receipt while foreign owner and old lease are denied',async t=>{
 const f=await fixture(t),value=f.body(),r=good(await f.confirm(value),201).receipt,current=await f.ready('manager-a',f.keys.get('manager-a'));assert.notEqual(current.lease.id,f.actor.lease.id);assert.deepEqual(good(await f.receipt(value.requestId,{current})).receipt,r);rejected(await f.receipt(value.requestId));const other=await f.ready('partner-a');denied(await f.receipt(value.requestId,{current:other}),404);denied(await f.receipt(uuid(),{current}),404);
});

test('actual main keeps a private chosen byte snapshot and public handle is the outgoing request identity',async t=>{
 const f=await fixture(t),c=await actualClient(f,t),selected=await c.choose();exact(selected,['status','handle','sourceSha256','summary']);assert.equal(selected.status,'selected');exact(selected.summary,['projectId','title','businessNumber','initiationRevision','workspaceRevision','firstWonAt','initiationWonAt','latestWonAt','quoteSnapshot']);exact(selected.summary.quoteSnapshot,['projectName','issuer','customerName','firmName','auditYear','quoteDate','totalCents','projectType']);assert.equal(selected.summary.quoteSnapshot.totalCents,c.value.quote.snapshot.totalCents);assert.doesNotMatch(JSON.stringify(selected),/saved-formal-source\.json|filePaths|source_json|currentPassword|password_hash|identityAuthenticated/);
 const opens=c.io.opens,reads=c.io.reads;await require('node:fs/promises').writeFile(c.filename,'A later disk edit does not replace the chosen private snapshot');const result=await c.manager.confirmWorkspaceFormalization(c.input(selected));assert.equal(result.status,'confirmed');assert.equal(result.receipt.requestId,selected.handle);assert.equal(result.receipt.sourceSha256,sha(codec.encode(c.value)));assert.equal(c.io.opens,opens);assert.equal(c.io.reads,reads);assert.equal(c.posts().length,1);assert.deepEqual(c.posts()[0].bodyKeys,['businessConfirmed','currentPassword','projectRevision','requestId','source','sourceSha256']);
});

test('actual COMMIT followed by lost reply returns unknown with one POST and only GET reconciliation',async t=>{
 const f=await fixture(t),c=await actualClient(f,t),selected=await c.choose();let drop=true;c.transport.rewrite=(info,response)=>{if(drop&&info.method==='POST'&&info.path.endsWith('/formalization')){drop=false;assert.equal(response.status,201);throw Error('Independent loss after real COMMIT');}return response;};const result=await c.manager.confirmWorkspaceFormalization(c.input(selected));assert.deepEqual(result,{status:'unknown',requestId:selected.handle});assert.equal(c.posts().length,1);assert.equal(f.db.prepare('SELECT count(*) n FROM '+FORMAL).get().n,1);assert.equal((await c.client.getDeviceStatus()).state,'paused');await c.client.reconnectDevice();const receipt=await c.client.getWorkspaceFormalizationReceipt({teamId:'team-a',projectId:f.projectId,requestId:selected.handle});exact(receipt,RECEIPT);assert.equal(receipt.confirmedBy,'manager-a');await assert.rejects(c.manager.confirmWorkspaceFormalization(c.input(selected)),e=>e.code==='FORMALIZATION_SOURCE_CHANGED');assert.equal(c.posts().length,1);
});

test('held native picker loses real owner rights before it returns and opens no source file',async t=>{
 const f=await fixture(t),c=await actualClient(f,t),entered=deferred(),release=deferred();t.after(()=>release.resolve());c.io.picker=async()=>{entered.resolve();await release.promise;return{canceled:false,filePaths:[c.filename]};};const pending=c.choose();await entered.promise;f.db.prepare("UPDATE team_project_access_grants SET status='revoked',revision=revision+1 WHERE project_id=? AND permission='project.owner'").run(f.projectId);release.resolve();await assert.rejects(pending,e=>e.status===404||e.code==='FORMALIZATION_STATE_CHANGED');assert.equal(c.io.opens,0);assert.equal(c.io.reads,0);assert.equal(c.posts().length,0);
});

test('actual late old actor denial cannot sign out actor B or replay the old source',async t=>{
 const f=await fixture(t),c=await actualClient(f,t),selected=await c.choose(),h=c.hold('before'),pending=c.manager.confirmWorkspaceFormalization(c.input(selected));await h.entered.promise;await c.client.logout();await f.ready('partner-a',f.keys.get('manager-a'));await c.client.login({username:'partner-a',password:PASSWORD});assert.equal((await c.client.getDeviceStatus()).state,'ready');h.release.resolve();assert.deepEqual(await pending,{status:'unknown',requestId:selected.handle});assert.ok([401,403].includes(c.posts()[0].status));assert.equal((await c.client.getSession()).account.id,'partner-a');assert.equal((await c.client.getDeviceStatus()).state,'ready');assert.equal(f.db.prepare('SELECT count(*) n FROM '+FORMAL).get().n,0);assert.equal(c.posts().length,1);
});

test('obsolete source A discard cannot erase source B and malformed renderer source fields never dispatch',async t=>{
 const f=await fixture(t),c=await actualClient(f,t),a=await c.choose(),b=await c.choose();assert.notEqual(a.handle,b.handle);assert.deepEqual(c.manager.discardWorkspaceFormalizationSource({handle:a.handle}),{discarded:false});for(const patch of [{source:c.value},{path:c.filename},{businessConfirmed:false},{confirmed:false}])await assert.rejects(c.manager.confirmWorkspaceFormalization({...c.input(b),...patch}),e=>e.code==='INVALID_INPUT');assert.equal(c.posts().length,0);const result=await c.manager.confirmWorkspaceFormalization(c.input(b));assert.equal(result.status,'confirmed');assert.equal(result.receipt.requestId,b.handle);
});

test('actual strict client rejects malformed context and receipt projections instead of exposing extra source fields',async t=>{
 const f=await fixture(t),c=await actualClient(f,t);for(const patch of [v=>{v.context.source_json='private source';},v=>{v.context.canConfirm='true';},v=>{v.context.projectId=uuid();}]){c.transport.rewrite=async(info,response)=>{if(info.method==='GET'&&info.path.endsWith('/formalization')){const value=await response.json();patch(value);return new Response(JSON.stringify(value),{status:200});}return response;};await assert.rejects(c.client.getWorkspaceFormalization({teamId:'team-a',projectId:f.projectId}),e=>e.code==='INVALID_RESPONSE');}c.transport.rewrite=null;const selected=await c.choose(),saved=(await c.manager.confirmWorkspaceFormalization(c.input(selected))).receipt;
 for(const patch of [v=>{v.receipt.source_json='extra';},v=>{v.receipt.confirmationMode='server-verified';},v=>{v.receipt.projectRevisionAfter++;},v=>{v.receipt.projectId=uuid();}]){c.transport.rewrite=async(info,response)=>{if(info.path.endsWith('/receipts/'+saved.requestId)){const value=await response.json();patch(value);return new Response(JSON.stringify(value),{status:200});}return response;};await assert.rejects(c.client.getWorkspaceFormalizationReceipt({teamId:'team-a',projectId:f.projectId,requestId:saved.requestId}),e=>e.code==='INVALID_RESPONSE');}assert.equal(c.posts().length,1);
});

test('actual project client accepts only old eight unconfirmed nine and true confirmed ten key views',async t=>{
 const f=await fixture(t),c=await actualClient(f,t);f.registerProject('old-independent-fixture');exact((await c.client.getProject({teamId:'team-a',projectId:'old-independent-fixture'})).project,PROJECT);exact((await c.client.getProject({teamId:'team-a',projectId:f.projectId})).project,[...PROJECT,'kind']);const selected=await c.choose();await c.manager.confirmWorkspaceFormalization(c.input(selected));exact((await c.client.getProject({teamId:'team-a',projectId:f.projectId})).project,[...PROJECT,'kind','businessConfirmed']);
 for(const patch of [v=>{v.project.businessConfirmed=false;},v=>{v.project.businessConfirmed='true';},v=>{delete v.project.kind;},v=>{v.project.sourceProjectId=uuid();}]){c.transport.rewrite=async(info,response)=>{if(info.path==='/api/teams/team-a/projects/'+f.projectId){const value=await response.json();patch(value);return new Response(JSON.stringify(value),{status:200});}return response;};await assert.rejects(c.client.getProject({teamId:'team-a',projectId:f.projectId}),e=>e.code==='INVALID_RESPONSE');}
});

test('clearing the panel after actual COMMIT cannot replay and preserves the preknown unknown request ID',async t=>{
 const f=await fixture(t),c=await actualClient(f,t),selected=await c.choose(),h=c.hold('after'),pending=c.manager.confirmWorkspaceFormalization(c.input(selected));const actual=await h.entered.promise;assert.equal(actual.status,201);assert.equal(f.db.prepare('SELECT request_id FROM '+FORMAL).get().request_id,selected.handle);assert.deepEqual(c.manager.discardWorkspaceFormalizationSource({handle:selected.handle}),{discarded:true});h.release.resolve();assert.deepEqual(await pending,{status:'unknown',requestId:selected.handle});const receipt=await c.client.getWorkspaceFormalizationReceipt({teamId:'team-a',projectId:f.projectId,requestId:selected.handle});assert.equal(receipt.requestId,selected.handle);await assert.rejects(c.manager.confirmWorkspaceFormalization(c.input(selected)),e=>e.code==='FORMALIZATION_SOURCE_CHANGED');assert.equal(c.posts().length,1);
});
