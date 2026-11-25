'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {createLedgerFixture,savedSnapshot,good,denied,uuid,sha,PASSWORD,migrationSource,restorePasswordWork}=require('./helpers/ledger-check-fixture.cjs');
const codec=require('../dist/ledger-check-snapshot.js');
after(restorePasswordWork);
test('owner and role never imply read; explicit self grant permits immutable saved-source import and exact reading',async t=>{
 const f=await createLedgerFixture(t),a=good(await f.ledgerAccess()).access;assert.equal(a.read,false);assert.equal(a.canManageAccess,true);assert.equal(a.canImport,false);assert.equal(Object.hasOwn(a,'headRevision'),false);denied(await f.ledgerList());
 good(await f.ledgerGrant());const access=good(await f.ledgerAccess()).access;assert.equal(access.read,true);assert.equal(access.canImport,true);assert.equal(access.sourceProjectId,f.sourceProjectId);
 const body=await f.ledgerImportBody(),receipt=good(await f.ledgerImport({body}),201).receipt;
 assert.equal(receipt.version,1);assert.equal(receipt.sourceSha256,sha(body.sourceJson));assert.deepEqual(good(await f.ledgerReceipt(body.operationId)).receipt,receipt);
 const read=await f.ledgerRead({snapshotId:receipt.snapshotId});good(read);assert.deepEqual(read.data,JSON.parse(body.sourceJson));assert.equal(read.headers.get('X-Shenyi-Ledger-Sha256'),sha(body.sourceJson));assert.equal(read.headers.get('X-Shenyi-Ledger-Source-Project-Id'),f.sourceProjectId);
 assert.equal(read.data.reconciliation.result.summary.incomplete,11);assert.equal(read.data.reconciliation.result.automaticWriteAllowed,false);
 const list=good(await f.ledgerList());assert.equal(list.headRevision,1);assert.equal(list.snapshots.length,1);assert.equal(Object.hasOwn(list.snapshots[0],'source_json'),false);assert.equal(Object.hasOwn(list.snapshots[0],'operationId'),false);
 const oldScope=await f.api(f.projectRoute()+'/materials',{session:f.actor});denied(oldScope);denied(await f.api(f.projectRoute()+'/initiation-source',{session:f.actor}));
});
test('ledger-only senior has a minimal module project list, reads only its grant, and cannot import or manage',async t=>{
 const f=await createLedgerFixture(t),partner=await f.ready('partner-a');
 good(await f.ledgerGrant('partner-a'));assert.deepEqual(good(await f.api('/api/teams/team-a/projects',{session:partner})).projects,[]);
 const projects=good(await f.api('/api/teams/team-a/ledger-check-projects',{session:partner}));assert.deepEqual(projects.projects.map(x=>x.id),[f.projectId]);assert.deepEqual(Object.keys(projects.projects[0]),['teamId','id','title','status','revision']);
 denied(await f.api('/api/teams/team-b/ledger-check-projects',{session:partner}));denied(await f.ledgerAccess({current:partner,method:'POST',body:f.ledgerGrantBody()}));
 good(await f.ledgerGrant());const r=good(await f.ledgerImport(),201).receipt;good(await f.ledgerRead({current:partner,snapshotId:r.snapshotId}));
 const deniedImport=await f.ledgerImport({current:partner});denied(deniedImport);denied(await f.api(f.ledgerRoute()+'/members',{session:partner}));
});
test('an unconfirmed workspace is truthfully empty and cannot accept a claimed Q source',async t=>{
 const f=await createLedgerFixture(t),created=good(await f.create({read:false,manage:false,review:false}),201).receipt,id=created.projectId;good(await f.ledgerGrant(f.user,{id}));
 const access=good(await f.ledgerAccess({id})).access;assert.equal(access.sourceAvailable,false);assert.equal(access.canImport,false);assert.equal(access.sourceProjectId,null);
 assert.deepEqual(good(await f.ledgerList({id})).snapshots,[]);denied(await f.ledgerImport({id}));assert.equal(f.moduleRows()[3].rows.length,0);
});
test('low roles, technical accounts, foreign teams and unknown project IDs cannot inherit a module grant',async t=>{
 const f=await createLedgerFixture(t);
 for(const user of ['intern-a','assistant-a','manager-b','administrator-demo','reviewer-demo']){
  const current=await f.ready(user);denied(await f.ledgerAccess({current}));denied(await f.ledgerList({current}));
  if(['intern-a','assistant-a'].includes(user))f.db.prepare('INSERT INTO team_ledger_check_grants VALUES (?,?,?,1,1,1)').run('team-a',f.projectId,user);
  denied(await f.ledgerAccess({current}));
 }
 denied(await f.ledgerAccess({id:uuid()}));denied(await f.ledgerAccess({teamId:'team-b'}));
 for(const user of ['intern-a','assistant-a','manager-b','administrator-demo','reviewer-demo'])denied(await f.ledgerGrant(user));
});
test('access requires the current password and exact versions, rejects forged fields, and retains old grants on failure',async t=>{
 const f=await createLedgerFixture(t),before=f.moduleRows();denied(await f.ledgerGrant(f.user,{currentPassword:'wrong'}),403);assert.deepEqual(f.moduleRows(),before);
 for(const patch of [{role:'partner'},{export:true},{projectRevision:f.revision()+1},{memberRevision:f.epoch(f.user)+1},{grantRevision:1}]){
  const response=await f.ledgerGrant(f.user,{body:{...f.ledgerGrantBody(),...patch}});denied(response,patch.role||patch.export?400:409);
 }
 good(await f.ledgerGrant());denied(await f.ledgerGrant(),409);assert.equal(f.moduleRows()[0].rows.length,1);assert.equal(f.moduleRows()[1].rows.length,1);
});
test('import is password checked, append only, version-CAS protected and idempotent for the same operation',async t=>{
 const f=await createLedgerFixture(t);good(await f.ledgerGrant());
 const original=await f.ledgerImportBody();denied(await f.ledgerImport({body:{...original,currentPassword:'wrong'}}),403);assert.equal(f.moduleRows()[2].rows.length,0);
 const r1=good(await f.ledgerImport({body:original}),201).receipt,r2=good(await f.ledgerImport({body:original})).receipt;assert.deepEqual(r1,r2);assert.equal(f.moduleRows()[3].rows.length,1);
 denied(await f.ledgerImport({body:{...original,sourceJson:await savedSnapshot(f.sourceProjectId,{workspaceRevision:8})}}),409);
 denied(await f.ledgerImport({body:{...original,operationId:uuid()}}),409);
 const next=await f.ledgerImportBody({sourceJson:await savedSnapshot(f.sourceProjectId,{workspaceRevision:6})}),second=good(await f.ledgerImport({body:next}),201).receipt;assert.equal(second.version,2);
 const listed=good(await f.ledgerList({query:'?limit=1'}));assert.equal(listed.snapshots[0].id,second.snapshotId);assert.equal(listed.hasMore,true);
 assert.equal(good(await f.ledgerList({query:'?after=2&limit=1'})).snapshots[0].id,r1.snapshotId);assert.deepEqual(good(await f.ledgerRead({snapshotId:r1.snapshotId})),JSON.parse(original.sourceJson));
 assert.equal(good(await f.ledgerReceipt(original.operationId)).receipt.snapshotId,r1.snapshotId);
 for(const sql of ['DELETE FROM team_ledger_check_snapshots','UPDATE team_ledger_check_snapshots SET calculated_at=\'changed\'','DELETE FROM team_ledger_check_heads'])assert.throws(()=>f.db.exec(sql));
});
test('snapshot input, target Q, query grammar, direct paths and devices fail closed',async t=>{
 const f=await createLedgerFixture(t);good(await f.ledgerGrant());
 denied(await f.ledgerImport({sourceJson:await savedSnapshot(uuid())}));
 denied(await f.ledgerImport({sourceJson:'{}'}),400);
 const body=await f.ledgerImportBody(),data=JSON.parse(body.sourceJson);data.reconciliation.inputHash='b'.repeat(64);denied(await f.ledgerImport({body:{...body,sourceJson:JSON.stringify(data,null,2)+'\n'}}),400);
 const r=good(await f.ledgerImport(),201).receipt;
 for(const query of ['', '?projectRevision=01&grantRevision=1','?projectRevision=1&projectRevision=1','?projectRevision=1&grantRevision=1&extra=1'])denied(await f.ledgerRead({snapshotId:r.snapshotId,query}),400);
 denied(await f.ledgerRead({snapshotId:r.snapshotId,query:'?projectRevision=1&grantRevision=1'}),409);
 for(const suffix of ['/run','/calculate','/save','/suggestions','/export'])for(const method of ['GET','POST']){const response=await f.api(f.ledgerRoute()+suffix,{session:f.actor,method,...(method==='POST'?{body:{}}:{})});assert.ok([404,405].includes(response.status));denied(response,response.status);}
 denied(await f.api(f.ledgerRoute()+'/imports',{method:'POST',session:f.actor,body:await f.ledgerImportBody(),strict:false}),403);
 denied(await f.api(f.ledgerRoute()+'/access',{headers:{'X-Shenyi-User-Id':f.user}}),401);
});
test('role ABA does not revive read grants; explicit new authorization is required',async t=>{
 const f=await createLedgerFixture(t),partner=await f.ready('partner-a');good(await f.ledgerGrant());good(await f.ledgerGrant('partner-a'));const r=good(await f.ledgerImport(),201).receipt;
 f.roleABA('partner-a');denied(await f.ledgerRead({current:partner,snapshotId:r.snapshotId}));good(await f.ledgerGrant('partner-a'));good(await f.ledgerRead({current:partner,snapshotId:r.snapshotId}));
 const row=f.db.prepare('SELECT revision FROM team_ledger_check_grants WHERE user_id=? AND project_id=?').get('partner-a',f.projectId);assert.equal(row.revision,3);
});
test('technical administrator disabling a ledger-only senior revokes access and keeps all imported versions',async t=>{
 const f=await createLedgerFixture(t),partner=await f.ready('partner-a'),admin=await f.ready('administrator-demo');good(await f.ledgerGrant());good(await f.ledgerGrant('partner-a'));const r=good(await f.ledgerImport(),201).receipt;
 const response=await f.api('/api/teams/team-a/business-members/partner-a/disable',{method:'POST',session:admin,body:{revision:f.epoch('partner-a'),currentPassword:PASSWORD}});assert.equal(good(response).disabled,true);
 assert.equal(f.db.prepare('SELECT can_read FROM team_ledger_check_grants WHERE project_id=? AND user_id=?').get(f.projectId,'partner-a').can_read,0);denied(await f.ledgerRead({current:partner,snapshotId:r.snapshotId}),401);assert.equal(f.moduleRows()[3].rows.length,1);
});
test('public role downgrade and promotion do not restore a prior ledger read grant',async t=>{
 const f=await createLedgerFixture(t),partner=await f.ready('partner-a'),admin=await f.ready('administrator-demo');good(await f.ledgerGrant('partner-a'));
 good(await f.change(admin,'partner-a','intern'));assert.equal(f.db.prepare('SELECT can_read FROM team_ledger_check_grants WHERE project_id=? AND user_id=?').get(f.projectId,'partner-a').can_read,0);
 good(await f.change(admin,'partner-a','partner'));const relogin=await f.ready('partner-a');denied(await f.ledgerAccess({current:relogin}));denied(await f.ledgerAccess({current:partner}),401);
});
test('historic reviewer identity blocks otherwise valid senior membership and cannot be reauthorized',async t=>{
 const f=await createLedgerFixture(t),partner=await f.ready('partner-a');good(await f.ledgerGrant('partner-a'));
 f.db.prepare("INSERT INTO team_platform_reviewers(user_id,permission,status) VALUES ('partner-a','team.provision','revoked')").run();denied(await f.ledgerAccess({current:partner}));denied(await f.ledgerGrant('partner-a'));
 const grant=f.db.prepare('SELECT eligible,revision FROM team_ledger_check_grants WHERE project_id=? AND user_id=?').get(f.projectId,'partner-a');assert.equal(grant.eligible,0);assert.equal(grant.revision,2);
});
test('global project removal clears ledger-only access, increments the project once and preserves snapshots',async t=>{
 const f=await createLedgerFixture(t),partner=await f.ready('partner-a');good(await f.ledgerGrant());good(await f.ledgerGrant('partner-a'));const r=good(await f.ledgerImport(),201).receipt,before=f.revision();
 good(await f.grant(f.actor,'partner-a',{read:false,manage:false,review:false},{projectId:f.projectId}));assert.equal(f.revision(),before+1);assert.equal(f.db.prepare('SELECT can_read FROM team_ledger_check_grants WHERE project_id=? AND user_id=?').get(f.projectId,'partner-a').can_read,0);
 denied(await f.ledgerRead({current:partner,snapshotId:r.snapshotId}),401);assert.equal(f.moduleRows()[3].rows.length,1);assert.equal(f.moduleRows()[3].rows[0].snapshot_id,r.snapshotId);
});
test('revoke and explicit regrant during KDF cannot resurrect an in-flight import',async t=>{
 const f=await createLedgerFixture(t);good(await f.ledgerGrant());const body=await f.ledgerImportBody(),held=f.passwordHold(),pending=f.ledgerImport({body});await held.entered.promise;
 f.roleABA();good(await f.ledgerGrant());held.release.resolve();denied(await pending,409);assert.equal(f.moduleRows()[2].rows.length,0);assert.equal(f.moduleRows()[3].rows.length,0);
});
test('body-time ABA is rejected even when the actor is qualified and explicitly regranted before dispatch',async t=>{
 const f=await createLedgerFixture(t);good(await f.ledgerGrant());const body=await f.ledgerImportBody(),request=f.makeRequest(f.ledgerRoute()+'/imports',{method:'POST',session:f.actor,body});
 const get=request.body.getReader.bind(request.body);let changed=false;
 request.body.getReader=()=>{const reader=get();return{async read(){const value=await reader.read();if(!changed&&!value.done){changed=true;f.roleABA();good(await f.ledgerGrant());}return value;},cancel:reason=>reader.cancel(reason)};};
 const response=await f.api(f.ledgerRoute()+'/imports',{raw:request});assert.equal(changed,true);denied(response,409);assert.equal(f.moduleRows()[3].rows.length,0);
});
test('extra storage writes roll back both head and snapshot rather than returning a successful import',async t=>{
 const f=await createLedgerFixture(t);good(await f.ledgerGrant());const title=f.db.prepare('SELECT title FROM team_projects WHERE project_id=?').get(f.projectId).title;
 f.db.exec("CREATE TRIGGER ledger_test_extra AFTER INSERT ON team_ledger_check_snapshots BEGIN UPDATE team_projects SET title='synthetic invalid extra write' WHERE project_id=NEW.project_id; END;");
 denied(await f.ledgerImport(),409);assert.equal(f.moduleRows()[2].rows.length,0);assert.equal(f.moduleRows()[3].rows.length,0);assert.equal(f.db.prepare('SELECT title FROM team_projects WHERE project_id=?').get(f.projectId).title,title);
});

test('a concurrent import is refused before body reads and completion or failure releases its permit',async t=>{
 const f=await createLedgerFixture(t);good(await f.ledgerGrant());
 const body=await f.ledgerImportBody(),held=f.passwordHold(),pending=f.ledgerImport({body});await held.entered.promise;
 try{
  const request=f.makeRequest(f.ledgerRoute()+'/imports',{method:'POST',session:f.actor,body:{...body,operationId:uuid()}}),original=request.body.getReader.bind(request.body);let reads=0;request.body.getReader=()=>{reads++;return original();};
  const blocked=await f.api(f.ledgerRoute()+'/imports',{raw:request});denied(blocked,429);assert.equal(blocked.data.error.code,'LEDGER_IMPORT_BUSY');assert.equal(reads,0);
 }finally{held.release.resolve();}
 good(await pending,201);denied(await f.ledgerImport({currentPassword:'wrong'}),403);
 assert.equal(good(await f.ledgerImport(),201).receipt.version,2);
});

test('a read transaction refuses an unexpected write and rolls it back with the response',async t=>{
 const f=await createLedgerFixture(t);good(await f.ledgerGrant());good(await f.ledgerImport(),201);
 const before=f.db.prepare('SELECT title FROM team_projects WHERE project_id=?').get(f.projectId).title,original=f.db.prepare;let hit=false;
 f.db.prepare=function(sql){const statement=original.call(this,sql);if(sql.startsWith('SELECT snapshot_id,version,source_project_id,source_sha256,workspace_revision,calculated_at,importer_name,imported_at FROM team_ledger_check_snapshots')){
  const all=statement.all.bind(statement);statement.all=(...args)=>{const result=all(...args);hit=true;original.call(this,'UPDATE team_projects SET title=? WHERE project_id=?').run('synthetic unexpected read write',f.projectId);return result;};
 }return statement;};
 try{denied(await f.ledgerList(),409);}finally{f.db.prepare=original;}
 assert.equal(hit,true);assert.equal(f.db.prepare('SELECT title FROM team_projects WHERE project_id=?').get(f.projectId).title,before);assert.equal(f.moduleRows()[3].rows.length,1);
});
test('frozen projects remain readable but cannot import; archival ABA retires the grant',async t=>{
 const f=await createLedgerFixture(t);good(await f.ledgerGrant());const r=good(await f.ledgerImport(),201).receipt;
 f.db.prepare("UPDATE team_projects SET status='frozen' WHERE project_id=?").run(f.projectId);good(await f.ledgerRead({snapshotId:r.snapshotId}));denied(await f.ledgerImport(),409);
 f.db.prepare("UPDATE team_projects SET status='archived' WHERE project_id=?").run(f.projectId);f.db.prepare("UPDATE team_projects SET status='active' WHERE project_id=?").run(f.projectId);denied(await f.ledgerList());
});
test('the same read/import protocol accepts Q migration without borrowing source or materials permissions',async t=>{
 const f=await createLedgerFixture(t,{migration:true}),legacy=migrationSource({id:uuid(),sequence:45}),id=legacy.initiation.quoteId;good(await f.register({source:legacy}),201);
 good(await f.ledgerGrant(f.user,{id}));const body=await f.ledgerImportBody({id,sourceJson:await savedSnapshot(id)}),r=good(await f.ledgerImport({id,body}),201).receipt;
 const result=good(await f.ledgerRead({id,snapshotId:r.snapshotId}));assert.equal(result.sourceProjectId,id);assert.notEqual(id,f.projectId);
});
test('the exact preauthorized import can exceed the old gateway limit; other paths and users cannot',async t=>{
 const f=await createLedgerFixture(t);good(await f.ledgerGrant());const sourceJson=await savedSnapshot(f.sourceProjectId,{padding:18*1024*1024}),body=await f.ledgerImportBody({sourceJson});assert.ok(Buffer.byteLength(JSON.stringify(body))>17*1024*1024);
 const r=good(await f.ledgerImport({body}),201).receipt;assert.equal(good(await f.ledgerRead({snapshotId:r.snapshotId})).reconciliation.sourceRefs.ledger.syntheticPadding.length,18*1024*1024);
 denied(await f.api(f.ledgerRoute()+'/access',{method:'POST',session:f.actor,body}),413);
 denied(await f.api(f.ledgerRoute()+'/imports?unexpected=1',{method:'POST',session:f.actor,body}),413);
 const partner=await f.ready('partner-a');good(await f.ledgerGrant('partner-a'));const request=f.makeRequest(f.ledgerRoute()+'/imports',{method:'POST',session:partner,body});let reads=0;const original=request.body.getReader.bind(request.body);request.body.getReader=()=>{reads++;return original();};
 denied(await f.api(f.ledgerRoute()+'/imports',{raw:request}));assert.equal(reads,0);
});
test('MAX versions remain exact for reading and incrementing operations reject without overflow or partial writes',async t=>{
 const f=await createLedgerFixture(t);good(await f.ledgerGrant());const r=good(await f.ledgerImport(),201).receipt;
 function boundary(trigger,sql){const definition=f.db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(trigger).sql;f.db.exec('DROP TRIGGER '+trigger);try{f.db.exec(sql);}finally{f.db.exec(definition);}assert.equal(f.db.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(trigger).sql,definition);}
 // Explicit synthetic boundary seeding only; each exact original trigger is
 // restored before the actual API call, which runs under all production guards.
 boundary('ledger_check_grant_monotonic',"UPDATE team_ledger_check_grants SET revision=9007199254740991 WHERE user_id='manager-a'");
 assert.equal(good(await f.ledgerAccess()).access.grantRevision,Number.MAX_SAFE_INTEGER);const read=await f.ledgerRead({snapshotId:r.snapshotId});good(read);assert.equal(read.headers.get('X-Shenyi-Ledger-Grant-Revision'),String(Number.MAX_SAFE_INTEGER));
 let before=f.moduleRows();denied(await f.ledgerGrant(f.user,{read:false}),409);assert.deepEqual(f.moduleRows(),before);
 boundary('ledger_check_snapshot_no_update','UPDATE team_ledger_check_snapshots SET version=9007199254740991');boundary('ledger_check_head_monotonic','UPDATE team_ledger_check_heads SET revision=9007199254740991');
 before=f.moduleRows();denied(await f.ledgerImport(),409);assert.deepEqual(f.moduleRows(),before);assert.equal(good(await f.ledgerList()).headRevision,Number.MAX_SAFE_INTEGER);
});
