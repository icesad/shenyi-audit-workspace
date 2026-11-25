const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {createWorkpaperDataFixture:fixture,good,denied,uuid,sha,source,PASSWORD,codec,restorePasswordWork}=require('./helpers/workpaper-data-fixture.cjs');
after(restorePasswordWork);
const rejected=r=>{assert.ok([401,403,404,409].includes(r.status),JSON.stringify(r));denied(r,r.status);};
const rawResult=async response=>({status:response.status,data:await response.json(),headers:response.headers});

test('signed low roles and technical/reviewer/foreign identities are denied before reading an import body',async t=>{
 const f=await fixture(t);
 for(const user of ['intern-a','assistant-a','administrator-demo','reviewer-demo','manager-b']){const actor=await f.ready(user),body=f.startBody(),raw=f.makeRequest(f.wpRoute()+'/imports',{method:'POST',session:actor,body});let reads=0;const get=raw.body.getReader;raw.body.getReader=function(...args){reads++;return get.apply(this,args);};denied(await rawResult(await f.dispatch(raw)));assert.equal(reads,0);}
 assert.equal(f.dataRows().imports.length,0);
});
test('body-time revoke/regrant with predicted future CAS still fails the original signed context stamp',async t=>{
 const f=await fixture(t),entered=Promise.withResolvers(),release=Promise.withResolvers(),body=f.startBody({grantRevision:f.dataGrantRevision()+2}),bytes=Buffer.from(JSON.stringify(body)),stream=new ReadableStream({async pull(controller){await release.promise;controller.enqueue(bytes);controller.close();}}),raw=f.makeRequest(f.wpRoute()+'/imports',{method:'POST',session:f.actor,body,bodyStream:stream});
 const get=raw.body.getReader;raw.body.getReader=function(...args){entered.resolve();return get.apply(this,args);};t.after(()=>release.resolve());const pending=f.dispatch(raw);await entered.promise;good(await f.wpGrant(f.user,{read:true,write:false}));good(await f.wpGrant(f.user,{read:true,write:true}));assert.equal(f.dataGrantRevision(),body.grantRevision);release.resolve();denied(await rawResult(await pending),409);assert.equal(f.dataRows().imports.length,0);
});
test('KDF-time write revoke cannot publish even after a correct password verifies',async t=>{
 const f=await fixture(t),id=await f.upload(),hold=f.passwordHold(),pending=f.commit(id);await hold.entered.promise;good(await f.wpGrant(f.user,{read:true,write:false}));hold.release.resolve();rejected(await pending);assert.equal(f.dataRows().heads.length,0);assert.equal(f.dataRows().versions.length,0);assert.equal(f.dataRows().chunks.length,1);
 good(await f.api(f.wpRoute()+'/imports/'+id,{session:f.actor,method:'DELETE'}));assert.equal(f.dataRows().chunks.length,0);
});
test('role ABA retires a staged request; new qualification never silently reuses the old source stage',async t=>{
 const f=await fixture(t),id=await f.upload();f.roleABA();const current=await f.ready(f.user);good(await f.wpGrant(f.user,{current,read:true,write:true}));rejected(await f.commit(id,{current,body:f.commitBody()}));assert.equal(f.dataRows().heads.length,0);
});
test('new business login retires old staging while explicit same-owner cancellation can clean it up',async t=>{
 const f=await fixture(t),id=await f.upload(),current=await f.ready(f.user);denied(await f.commit(id,{current}),409);good(await f.api(f.wpRoute()+'/imports/'+id,{session:current,method:'DELETE'}));assert.equal(f.dataRows().imports[0].status,'canceled');assert.equal(f.dataRows().heads.length,0);
});
test('large-work permit prevents overlapping commits and releases after the original outcome',async t=>{
 const f=await fixture(t),id=await f.upload(),hold=f.passwordHold(),pending=f.commit(id);await hold.entered.promise;denied(await f.commit(id),429);hold.release.resolve();const receipt=good(await pending,201).receipt;assert.equal(receipt.version,1);assert.equal(good(await f.dataReceipt(id)).receipt.requestId,id);assert.equal(f.dataRows().versions.length,1);
});
for(const [label,statement] of [
 ['unrelated project write',"UPDATE team_projects SET title='unexpected side effect' WHERE project_id=NEW.project_id"],
 ['module grant revoke',"UPDATE team_workpaper_access_grants SET can_read=0,revision=revision+1 WHERE project_id=NEW.project_id AND user_id=NEW.actor_id"],
 ['abort',"SELECT RAISE(ABORT,'injected version failure')"],
])test('publication rolls back '+label+' with source stage intact',async t=>{
 const f=await fixture(t),id=await f.upload();f.db.exec('CREATE TRIGGER injected_workpaper_version AFTER INSERT ON team_workpaper_data_versions BEGIN '+statement+'; END');const before=f.snapshot();const r=await f.commit(id);assert.ok([404,409,503].includes(r.status),JSON.stringify(r));denied(r,r.status);assert.deepEqual(f.snapshot(),before);assert.equal(f.dataRows().heads.length,0);
});
test('COMMIT fault leaves no partial head/original/version and a later original-ID GET cannot fabricate success',async t=>{
 const f=await fixture(t),id=await f.upload(),hold=f.passwordHold(),pending=f.commit(id);await hold.entered.promise;const exec=f.db.exec;let hit=false;f.db.exec=function(sql){if(sql==='COMMIT'&&!hit){hit=true;throw Error('injected COMMIT fault');}return exec.call(this,sql);};t.after(()=>{f.db.exec=exec;});const before=f.snapshot();hold.release.resolve();denied(await pending,503);assert.equal(hit,true);assert.deepEqual(f.snapshot(),before);denied(await f.dataReceipt(id));
});
test('a lost success response is recovered only through the same immutable receipt, with one published version',async t=>{
 const f=await fixture(t),id=await f.upload();let committed=false;f.state.after=({route},response)=>{if(route.endsWith('/commit')){assert.equal(response.status,201);committed=true;throw Error('synthetic transport lost after commit');}};await assert.rejects(f.commit(id),/lost after commit/);assert.equal(committed,true);f.state.after=null;const receipt=good(await f.dataReceipt(id)).receipt;assert.equal(receipt.version,1);assert.equal(f.dataRows().versions.length,1);assert.equal(f.dataRows().chunks.length,0);
});
test('post-import read revoke or business downgrade blocks original and metadata without deleting saved history',async t=>{
 const f=await fixture(t),id=await f.upload();good(await f.commit(id),201);const partner=await f.ready('partner-a');good(await f.wpGrant('partner-a',{read:true,write:false}));good(await f.dataRecord({current:partner}));good(await f.wpGrant('partner-a',{read:false,write:false}));denied(await f.dataRecord({current:partner}));assert.equal((await f.dataOriginal(f.pack.H,{current:partner})).status,404);const count=f.dataRows().originals.length;f.roleABA('partner-a');assert.equal(f.dataRows().originals.length,count);assert.equal(f.dataRows().versions.length,1);
});
test('frozen project retains read but blocks first import while arbitrary professional actions stay closed',async t=>{
 const f=await fixture(t),id=await f.upload();good(await f.commit(id),201);f.db.prepare("UPDATE team_projects SET status='frozen' WHERE project_id=?").run(f.projectId);good(await f.dataRecord());denied(await f.start(),409);
 for(const suffix of ['entries','save','freeze','unfreeze','review']){const response=await f.api(f.wpRoute()+'/'+suffix,{method:'POST',session:f.actor,body:{}});denied(response,405);}
});

test('permission revoked during actual package digest admission cannot publish a late valid package',{timeout:20000},async t=>{
 const f=await fixture(t),id=await f.upload(),subtle=require('node:crypto').webcrypto.subtle,native=subtle.digest,entered=Promise.withResolvers(),release=Promise.withResolvers();let hit=false;
 subtle.digest=async function(...args){const result=await native.apply(this,args);if(!hit){hit=true;entered.resolve();await release.promise;}return result;};t.after(()=>{subtle.digest=native;release.resolve();});const pending=f.commit(id);await entered.promise;good(await f.wpGrant(f.user,{read:true,write:false}));release.resolve();rejected(await pending);assert.equal(hit,true);assert.equal(f.dataRows().heads.length,0);assert.equal(f.dataRows().versions.length,0);
});


test('cancel never claims an unknown stage was canceled or rolls back an already published version',async t=>{
 const f=await fixture(t),missing=uuid();denied(await f.api(f.wpRoute()+'/imports/'+missing,{method:'DELETE',session:f.actor}));assert.equal(f.dataRows().imports.length,0);
 const id=await f.upload();good(await f.commit(id),201);const before=f.dataRows();denied(await f.api(f.wpRoute()+'/imports/'+id,{method:'DELETE',session:f.actor}),409);assert.deepEqual(f.dataRows(),before);assert.equal(good(await f.dataReceipt(id)).receipt.version,1);
});

test('explicit cancellation while password verification is in flight retires temporary bytes and prevents publication',async t=>{
 const f=await fixture(t),id=await f.upload(),hold=f.passwordHold(),pending=f.commit(id);await hold.entered.promise;good(await f.api(f.wpRoute()+'/imports/'+id,{method:'DELETE',session:f.actor}));hold.release.resolve();denied(await pending,409);const rows=f.dataRows();assert.equal(rows.heads.length,0);assert.equal(rows.versions.length,0);assert.equal(rows.originals.length,0);assert.equal(rows.chunks.length,0);assert.equal(rows.imports[0].status,'canceled');denied(await f.dataReceipt(id));
});
