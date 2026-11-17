const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {createWorkpaperDataFixture:fixture,good,denied,uuid,sha,source,PASSWORD,codec,restorePasswordWork}=require('./helpers/workpaper-data-fixture.cjs');
after(restorePasswordWork);

test('signed owner imports once with read AND write, preserves Q/version/freeze/originals and gets a permanent receipt',async t=>{
 const f=await fixture(t),old=f.snapshot({resourcesOnly:true}),id=await f.upload(),r=good(await f.commit(id),201).receipt;assert.equal(r.requestId,id);assert.equal(r.version,1);assert.equal(r.recordRevision,7);assert.equal(r.sourceProjectId,f.sourceProjectId);assert.equal(r.sourcePackageSha256,sha(f.bytes));assert.deepEqual(good(await f.dataReceipt(id)).receipt,r);
 const got=await f.dataRecord();good(got);assert.equal(got.data.id,f.sourceProjectId);assert.deepEqual(got.data.workpaperLocks,f.pack.record.workpaperLocks);assert.equal(Object.hasOwn(got.data,'amountCents'),false);assert.equal(got.headers.get('X-Shenyi-Workpaper-Record-Sha256'),sha(JSON.stringify(got.data)));
 const a=await f.dataOriginal(f.pack.H);assert.equal(a.status,200);assert.deepEqual(a.bytes,f.pack.raw);assert.equal(a.headers.get('X-Shenyi-Workpaper-Original-Sha256'),f.pack.H);
 const rows=f.dataRows();assert.equal(rows.heads.length,1);assert.equal(rows.versions.length,1);assert.equal(rows.originals.length,2);assert.equal(rows.imports[0].status,'published');assert.equal(rows.chunks.length,0);assert.deepEqual(f.snapshot({resourcesOnly:true}),old);
 denied(await f.start(),409);denied(await f.commit(id),409);assert.deepEqual(f.dataRows(),rows);
});
test('independent reader has no inherited collection/material/source rights but reads authorized metadata/version/originals',async t=>{
 const f=await fixture(t),id=await f.upload();good(await f.commit(id),201);const partner=await f.ready('partner-a');denied(await f.dataRecord({current:partner}));good(await f.wpGrant('partner-a',{read:true,write:false,export:false}));
 good(await f.dataRecord({current:partner}));assert.equal((await f.dataOriginal(f.pack.H,{current:partner})).status,200);const meta=good(await f.api(f.wpRoute(),{session:partner})).data;assert.equal(meta.headRevision,1);assert.equal(meta.sourceProjectId,f.sourceProjectId);assert.equal(Object.hasOwn(meta,'record_json'),false);const history=good(await f.api(f.wpRoute()+'/versions?limit=1',{session:partner}));assert.equal(history.versions.length,1);assert.equal(Object.hasOwn(history.versions[0],'operationId'),false);
 denied(await f.start(undefined,{current:partner}));denied(await f.dataReceipt(id,{current:partner}));denied(await f.api(f.wpRoute().replace('/workpapers','')+'/materials',{session:partner}));denied(await f.api(f.wpRoute().replace('/workpapers','')+'/initiation-source',{session:partner}));
});
test('owner without either read or write cannot stage even though it manages module grants',async t=>{
 const f=await fixture(t,{grant:false});for(const flags of [{read:false,write:false},{read:true,write:false},{read:false,write:true}]){if(flags.read||flags.write)good(await f.wpGrant(f.user,flags));denied(await f.start());assert.equal(f.dataRows().imports.length,0);}
 good(await f.wpGrant(f.user,{read:true,write:true}));good(await f.start(),201);
});
test('commit requires source acknowledgement, current password and exact project/grant versions',async t=>{
 const f=await fixture(t),id=await f.upload();for(const extra of [{sourceVerified:false},{role:'partner'},{projectRevision:0},{currentPassword:'x'.repeat(513)}])denied(await f.commit(id,{body:f.commitBody(extra)}),400);
 denied(await f.commit(id,{body:f.commitBody({currentPassword:'wrong'})}),403);denied(await f.commit(id,{body:f.commitBody({grantRevision:2})}),409);assert.equal(f.dataRows().heads.length,0);good(await f.commit(id),201);
});
test('chunks are canonical, exact-sized and idempotent for the same bytes, never overwritable',async t=>{
 const f=await fixture(t),body=f.startBody();good(await f.start(body),201);good(await f.put(body.requestId,0));good(await f.put(body.requestId,0));denied(await f.put(body.requestId,0,Buffer.from('different')),400);denied(await f.put(body.requestId,1),400);assert.equal(f.dataRows().chunks.length,1);
 const r=await f.api(f.wpRoute()+'/imports/'+body.requestId+'/chunks/0',{method:'PUT',session:f.actor,body:{sha256:sha(f.bytes),data:f.bytes.toString('base64')+'\n'}});denied(r,400);good(await f.commit(body.requestId),201);
});
test('cancel/expiry retains request identity, deletes only temporary bytes and never creates data',async t=>{
 const f=await fixture(t),id=await f.upload();good(await f.api(f.wpRoute()+'/imports/'+id,{method:'DELETE',session:f.actor}));assert.equal(f.dataRows().chunks.length,0);assert.equal(f.dataRows().imports[0].status,'canceled');denied(await f.start(f.startBody({requestId:id})),409);denied(await f.commit(id),409);
 const next=await f.upload();f.clock.value+=1800001;denied(await f.commit(next),401);const fresh=await f.ready(f.user);denied(await f.commit(next,{current:fresh}),410);const stage=good(await f.api(f.wpRoute()+'/imports/'+next,{session:fresh})).stage;assert.equal(stage.status,'expired');assert.equal(f.dataRows().heads.length,0);
});
test('wrong package/Q/digest or incomplete staging cannot partially publish',async t=>{
 const f=await fixture(t),body=f.startBody();good(await f.start(body),201);denied(await f.commit(body.requestId),409);assert.equal(f.dataRows().heads.length,0);good(await f.api(f.wpRoute()+'/imports/'+body.requestId,{method:'DELETE',session:f.actor}));
 const wrong=f.startBody({sourceProjectId:uuid()});denied(await f.start(wrong),409);const invalid=Buffer.from('not a ZIP'),id=await f.upload({input:invalid});denied(await f.commit(id),400);assert.equal(f.dataRows().heads.length,0);assert.equal(f.dataRows().originals.length,0);
});
test('read URLs require exact versions and never read an unreferenced original or foreign project',async t=>{
 const f=await fixture(t),id=await f.upload();good(await f.commit(id),201);for(const search of ['', '?version=01&projectRevision=1&grantRevision=1','?version=1&version=1&grantRevision=1','?version=1&projectRevision=1&grantRevision=1&extra=true'])denied(await f.dataRecord({search}),400);
 denied(await f.dataRecord({version:2}));denied(await f.dataRecord({search:'?version=1&projectRevision=1&grantRevision=1'}),409);assert.equal((await f.dataOriginal('f'.repeat(64))).status,404);denied(await f.api('/api/teams/team-b/projects/'+f.projectId+'/workpapers',{session:f.actor}));
 const before=f.snapshot();good(await f.dataRecord());good(await f.api(f.wpRoute()+'/versions',{session:f.actor}));good(await f.dataReceipt(id));assert.deepEqual(f.snapshot(),before);
});

test('first-import capabilities are a readonly owner/read/write preflight before picking a local file',async t=>{const f=await fixture(t),before=f.snapshot(),value=good(await f.api(f.wpRoute()+'/import-capabilities',{session:f.actor})).import;assert.equal(value.sourceProjectId,f.sourceProjectId);assert.equal(value.chunkBytes,1048576);assert.equal(value.maxPackageBytes,codec.LIMITS.packageBytes);assert.deepEqual(f.snapshot(),before);const partner=await f.ready('partner-a');good(await f.wpGrant('partner-a',{read:true,write:true}));denied(await f.api(f.wpRoute()+'/import-capabilities',{session:partner}));const id=await f.upload();good(await f.commit(id),201);denied(await f.api(f.wpRoute()+'/import-capabilities',{session:f.actor}),409);});

test('a genuine package above one MiB uses two exact signed chunks and keeps the saved JSON and originals',async t=>{
 const f=await fixture(t);f.pack.record.answers[f.pack.E]['另一页']={NOTE:'x'.repeat(1200000)};const made=await codec.create({record:f.pack.record,readCurrent:async()=>f.pack.record}),input=Buffer.from(made.bytes);assert.ok(input.length>1048576&&input.length<2097152);const id=await f.upload({input});assert.equal(f.dataRows().chunks.length,2);good(await f.commit(id),201);assert.equal(good(await f.dataRecord()).answers[f.pack.E]['另一页'].NOTE.length,1200000);assert.equal(f.dataRows().chunks.length,0);assert.equal((await f.dataOriginal(f.pack.H)).status,200);
});


test('a reviewed legacy Q project imports against its own saved source without creating a new W or source authority',async t=>{
 const {createWorkpaperAccessFixture}=require('./helpers/workpaper-access-fixture.cjs'),{migrationSource}=require('./helpers/project-migration-fixture.cjs'),{fixture:packageFixture}=require('./helpers/workpaper-package-fixture.cjs'),f=await createWorkpaperAccessFixture(t,{migration:true}),value=migrationSource({id:uuid(),sequence:44}),Q=value.initiation.quoteId;
 assert.equal(good(await f.register({source:value}),201).projectId,Q);good(await f.wpGrant(f.user,{id:Q,read:true,write:true}));const old=f.snapshot({resourcesOnly:true}),pack=await packageFixture({id:Q,freeze:true}),made=await codec.create({record:pack.record,readCurrent:async()=>pack.record}),bytes=Buffer.from(made.bytes),base=f.wpRoute(Q),grantRevision=1,projectRevision=f.revision(Q),requestId=uuid();
 good(await f.api(base+'/imports',{method:'POST',session:f.actor,body:{requestId,projectRevision,grantRevision,sourceProjectId:Q,packageSha256:sha(bytes),byteLength:bytes.length,chunkCount:1}}),201);good(await f.api(base+'/imports/'+requestId+'/chunks/0',{method:'PUT',session:f.actor,body:{sha256:sha(bytes),data:bytes.toString('base64')}}));const result=good(await f.api(base+'/imports/'+requestId+'/commit',{method:'POST',session:f.actor,body:{projectRevision,grantRevision,sourceVerified:true,currentPassword:PASSWORD}}),201).receipt;assert.equal(result.sourceProjectId,Q);
 const record=good(await f.api(base+'/record?version=1&projectRevision='+projectRevision+'&grantRevision=1',{session:f.actor}));assert.equal(record.id,Q);assert.deepEqual(record.workpaperLocks,pack.record.workpaperLocks);assert.deepEqual(f.snapshot({resourcesOnly:true}),old);denied(await f.api(base.replace('/workpapers','/initiation-source'),{session:f.actor}));
});

test('logical staging reservations admit at most two maximum packages across distinct eligible owners without allocating large bodies',async t=>{
 const f=await fixture(t),max=codec.LIMITS.packageBytes,requests=[],member=f.addMember('capacity-manager');
 for(const [i,user]of [f.user,'partner-a',member].entries()){
  const current=i===0?f.actor:await f.ready(user),id=i===0?f.projectId:good(await f.create({current}),201).receipt.projectId;
  if(i){good(await f.confirm(f.body({source:require('./helpers/project-migration-fixture.cjs').migrationSource({id:uuid(),sequence:43+i}),projectRevision:f.revision(id)}),{current,id}),201);good(await f.wpGrant(user,{current,id,read:true,write:true}));}
  const Q=f.db.prepare('SELECT source_project_id FROM team_workspace_formalizations WHERE team_id=? AND project_id=?').get('team-a',id).source_project_id;
  const body={requestId:uuid(),projectRevision:f.revision(id),grantRevision:1,sourceProjectId:Q,packageSha256:'a'.repeat(64),byteLength:max,chunkCount:Math.ceil(max/1048576)},url=f.wpRoute(id)+'/imports',r=await f.api(url,{method:'POST',session:current,body});if(i<2)good(r,201);else denied(r,429);requests.push({body,url,current});
 }
 assert.equal(f.dataRows().imports.length,2);assert.equal(f.dataRows().chunks.length,0);good(await f.api(requests[0].url+'/'+requests[0].body.requestId,{method:'DELETE',session:requests[0].current}));good(await f.api(requests[2].url,{method:'POST',session:requests[2].current,body:requests[2].body}),201);assert.equal(f.dataRows().imports.filter(x=>x.status==='active').length,2);
});
