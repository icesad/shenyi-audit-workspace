const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {createWorkpaperAccessFixture:fixture,good,denied,source,PASSWORD,restorePasswordWork}=require('./helpers/workpaper-access-fixture.cjs');
after(restorePasswordWork);
const rejected=response=>{assert.ok([401,403,404,409].includes(response.status),JSON.stringify(response));denied(response,response.status);};
const assertCleared=(f,user='partner-a')=>{const row=f.db.prepare('SELECT * FROM team_workpaper_access_grants WHERE user_id=? AND project_id=?').get(user,f.projectId);for(const key of ['can_read','can_write','can_export','eligible'])assert.equal(row[key],0);return row;};

for(const who of ['manager-a','partner-a'])test('held password work detects '+who+' role ABA before granting',async t=>{
 const f=await fixture(t),hold=f.passwordHold(),pending=f.wpGrant('partner-a',{read:true,write:true,export:true});await hold.entered.promise;f.roleABA(who);const before=f.wpRows();hold.release.resolve();rejected(await pending);assert.deepEqual(f.wpRows(),before);
});

test('owner grant ABA during held password work cannot authorize after the owner row returns active',async t=>{
 const f=await fixture(t),hold=f.passwordHold(),pending=f.wpGrant('partner-a');await hold.entered.promise;
 f.db.prepare("UPDATE team_project_access_grants SET status='revoked',revision=revision+1 WHERE project_id=? AND user_id=? AND permission='project.owner'").run(f.projectId,f.user);
 f.db.prepare("UPDATE team_project_access_grants SET status='active',revision=revision+1 WHERE project_id=? AND user_id=? AND permission='project.owner'").run(f.projectId,f.user);
 const before=f.wpRows();hold.release.resolve();rejected(await pending);assert.deepEqual(f.wpRows(),before);
});

test('target grant changes during held password work cannot be overwritten by a stale request',async t=>{
 const f=await fixture(t);good(await f.wpGrant('partner-a'));const hold=f.passwordHold(),pending=f.wpGrant('partner-a',{read:true,write:true,export:true});await hold.entered.promise;
 f.db.prepare('UPDATE team_workpaper_access_grants SET can_read=0,revision=revision+1 WHERE project_id=? AND user_id=?').run(f.projectId,'partner-a');const before=f.wpRows();hold.release.resolve();rejected(await pending);assert.deepEqual(f.wpRows(),before);
});

for(const kind of ['member','account','team'])test(kind+' ABA invalidates all flags until a new explicit password grant',async t=>{
 const f=await fixture(t),actor=await f.ready('partner-a');good(await f.wpGrant('partner-a',{read:true,write:true,export:true}));
 const [table,column,value]=kind==='member'?['team_memberships','user_id','partner-a']:kind==='account'?['team_users','user_id','partner-a']:['teams','team_id','team-a'];
 f.db.prepare(`UPDATE ${table} SET status='disabled' WHERE ${column}=?`).run(value);f.db.prepare(`UPDATE ${table} SET status='active' WHERE ${column}=?`).run(value);
 rejected(await f.wpAccess({current:actor}));const row=f.db.prepare("SELECT * FROM team_workpaper_access_grants WHERE user_id='partner-a'").get();assert.equal(row.eligible,0);assert.equal(row.can_write,1);assert.equal(row.can_export,1);
 // Account/team qualification changes also retire the old owner lease. A fresh
 // signed login is required before that same owner can explicitly regrant.
 const fresh=await f.ready(f.user);good(await f.wpGrant('partner-a',{current:fresh,read:true,write:true,export:true}));const current=await f.ready('partner-a');assert.equal(good(await f.wpAccess({current})).access.canWrite,true);
});

test('role downgrade and restoration do not revive stored write/export-only grants',async t=>{
 const f=await fixture(t);good(await f.wpGrant('partner-a',{read:false,write:true,export:true}));f.roleABA('partner-a');const row=f.db.prepare("SELECT * FROM team_workpaper_access_grants WHERE user_id='partner-a'").get();assert.equal(row.eligible,0);assert.equal(row.revision,2);
 good(await f.wpGrant('partner-a',{read:true,write:true,export:true}));assert.equal(f.db.prepare("SELECT revision FROM team_workpaper_access_grants WHERE user_id='partner-a'").get().revision,3);
});

for(const [label,statement] of [
 ['resource edit',"UPDATE team_projects SET title='unauthorized side effect' WHERE project_id=NEW.project_id"],
 ['other grant mutation',"UPDATE team_workpaper_access_grants SET can_read=0,revision=revision+1 WHERE user_id=NEW.target_user_id AND project_id=NEW.project_id"],
 ['audit abort',"SELECT RAISE(ABORT,'injected audit failure')"],
])test('grant transaction rolls back unexpected '+label,async t=>{
 const f=await fixture(t);f.db.exec('CREATE TRIGGER injected_workpaper_fault AFTER INSERT ON team_workpaper_access_events BEGIN '+statement+'; END');const before=f.snapshot();const r=await f.wpGrant('partner-a',{read:true,write:true,export:true});assert.ok([409,503].includes(r.status),JSON.stringify(r));denied(r,r.status);assert.deepEqual(f.snapshot(),before);
});

test('failure at COMMIT rolls back the grant and its audit',async t=>{
 const f=await fixture(t),hold=f.passwordHold(),pending=f.wpGrant('partner-a');await hold.entered.promise;const exec=f.db.exec;let hit=false;
 f.db.exec=function(sql){if(sql==='COMMIT'&&!hit){hit=true;throw Error('injected COMMIT fault');}return exec.call(this,sql);};t.after(()=>{f.db.exec=exec;});const before=f.snapshot();hold.release.resolve();denied(await pending,503);assert.equal(hit,true);assert.deepEqual(f.snapshot(),before);
});

test('old full-project removal revokes workpaper-only access and keeps history',async t=>{
 const f=await fixture(t);good(await f.wpGrant('partner-a',{read:true,write:true,export:true}));good(await f.grant(f.actor,'partner-a',{read:false,manage:false,review:false},{projectId:f.projectId}));assertCleared(f);
 const events=f.wpRows()[1].rows;assert.equal(events.length,2);assert.equal(events[1].action,'access.revoked');assert.equal(events[1].reason,'project-access.removed');assert.equal(events[1].write_before,1);assert.equal(events[1].write_after,0);
});

test('project removal rolls back an audit attempting to silently restore workpaper grants',async t=>{
 const f=await fixture(t);good(await f.wpGrant('partner-a',{read:true,write:true,export:true}));f.db.exec("CREATE TRIGGER injected_workpaper_restore AFTER INSERT ON team_workpaper_access_events WHEN NEW.action='access.revoked' BEGIN UPDATE team_workpaper_access_grants SET can_read=1,can_write=1,can_export=1,eligible=1,revision=revision+1 WHERE project_id=NEW.project_id AND user_id=NEW.target_user_id; END");const prepare=f.db.prepare;let auditReached=false;f.db.prepare=function(sql){const statement=prepare.call(this,sql);if(sql.startsWith('INSERT INTO team_workpaper_access_events')){const run=statement.run;statement.run=function(...args){if(args[5]==='access.revoked')auditReached=true;return run.apply(this,args);};}return statement;};t.after(()=>{f.db.prepare=prepare;});const before=f.snapshot();denied(await f.grant(f.actor,'partner-a',{read:false,manage:false,review:false},{projectId:f.projectId}),409);assert.equal(auditReached,true);assert.deepEqual(f.snapshot(),before);
});

test('team administrator role change atomically clears all three module-only flags',async t=>{
 const f=await fixture(t);good(await f.wpGrant('partner-a',{read:true,write:true,export:true}));const admin=await f.ready('administrator-demo');good(await f.change(admin,'partner-a','manager'));assertCleared(f);assert.ok(f.wpRows()[1].rows.some(row=>row.reason==='business-role.changed'&&row.action==='access.revoked'));
});

test('team administrator member disable atomically clears all three flags',async t=>{
 const f=await fixture(t);good(await f.wpGrant('partner-a',{read:true,write:true,export:true}));const admin=await f.ready('administrator-demo');good(await f.api('/api/teams/team-a/business-members/partner-a/disable',{session:admin,method:'POST',body:{revision:f.epoch('partner-a'),currentPassword:PASSWORD}}));assertCleared(f);assert.ok(f.wpRows()[1].rows.some(row=>row.reason==='member.disabled'));
});

test('authorization requires bound proof and same-origin even with a live session',async t=>{
 const f=await fixture(t);denied(await f.wpAccess({strict:false}),403);denied(await f.wpAccess({headers:{Origin:'https://foreign.example'}}),403);const boot=await f.login(f.user);denied(await f.wpAccess({current:boot}),403);assert.deepEqual(f.wpRows().map(x=>x.rows),[[],[]]);
});
