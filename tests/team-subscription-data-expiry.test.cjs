'use strict';
// Fresh synthetic SQLite and real signed application requests. Old fixtures
// prepare authorized resources with billing disabled; these calls explicitly
// opt into the server-owned business-data-v1 write policy.
const {test,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createWorkpaperDataFixture,sha,source,PASSWORD,restorePasswordWork}=require('./helpers/workpaper-data-fixture.cjs');
const {entriesFixture,holdOfficeResult}=require('./helpers/workpaper-entries-fixture.cjs');
const {createTeamMaterialsFixture,preservation}=require('./helpers/team-materials-fixture.cjs');
const {createLedgerFixture}=require('./helpers/ledger-check-fixture.cjs');
after(restorePasswordWork);
const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
function unavailable(r){assert.equal(r.status,402,JSON.stringify(r.data));assert.equal(r.data.error.code,'SUBSCRIPTION_WRITE_UNAVAILABLE');assert.equal(Object.hasOwn(r.data,'receipt'),false);}
function conflict(r){assert.equal(r.status,409,JSON.stringify(r.data));assert.equal(r.data.error.code,'SUBSCRIPTION_CONFLICT');assert.equal(Object.hasOwn(r.data,'receipt'),false);}
function dataRows(db){
 const names=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND (name LIKE 'team_material_%' OR name LIKE 'team_workpaper_data_%' OR name LIKE 'team_ledger_check_%') ORDER BY name").all();
 return names.map(({name})=>({name,rows:db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()}));
}
async function billing(f){
 const {handleTeamApplicationRequest}=await source('application-api.mjs'),store=await source('subscription-store.mjs'),actor=f.actor??f.owner;
 const api=async(route,settings={},mode='business-data-v1')=>{
  const request=settings.raw??f.makeRequest(route,{session:actor,...settings});
  const response=await handleTeamApplicationRequest(request,{db:f.db,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true},subscriptionEnforcement:mode});
  const bytes=Buffer.from(await response.arrayBuffer()),json=/application\/json/.test(response.headers.get('Content-Type')??'');
  return{status:response.status,headers:response.headers,bytes,data:json&&bytes.length?JSON.parse(bytes.toString()):null};
 };
 const term=(fields={})=>store.recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:f.db.prepare("SELECT revision FROM team_subscription_heads WHERE team_id='team-a'").get()?.revision??0,startsAt:f.clock.value-100,endsAt:f.clock.value+60000,sourceRef:'synthetic-business-write-acceptance',...fields},{now:()=>f.clock.value});
 return{api,term,actor};
}
function expiryTrigger(f,table,end){
 let reached=0;f.db.function('synthetic_subscription_expiry',()=>{reached++;f.clock.value=end;return 1;});
 f.db.exec('CREATE TRIGGER synthetic_subscription_expiry_boundary AFTER INSERT ON '+table+' BEGIN SELECT synthetic_subscription_expiry(); END');
 return()=>assert.equal(reached,1,'the real publication write was reached exactly once');
}
async function materials(t,{publish=false,maintain=false,closed=false}={}){
 const f=await createTeamMaterialsFixture(t);ok(await f.grant(f.owner));const pack=await f.pack({closed}),b=await billing(f);
 const startBody=()=>({requestId:randomUUID(),projectRevision:f.revision(),packageSha256:sha(pack.bytes),byteLength:pack.bytes.length,chunkCount:Math.ceil(pack.bytes.length/1048576)});
 const start=()=>{const body=startBody();return{body,promise:b.api(f.base+'/imports',{method:'POST',body})};};
 const put=(id,index=0)=>{const bytes=pack.bytes.subarray(index*1048576,(index+1)*1048576);return b.api(f.base+'/imports/'+id+'/chunks/'+index,{method:'PUT',body:{sha256:sha(bytes),data:bytes.toString('base64')}});};
 const commit=id=>b.api(f.base+'/imports/'+id+'/commit',{method:'POST',body:{projectRevision:f.revision(),currentPassword:PASSWORD}});
 const stage=async()=>{const attempt=start();ok(await attempt.promise,201);for(let i=0;i<attempt.body.chunkCount;i++)ok(await put(attempt.body.requestId,i));return attempt.body.requestId;};
 const action=async(value)=>{const view=ok(await b.api(f.base));return b.api(f.base+'/actions',{method:'POST',body:{requestId:randomUUID(),projectRevision:f.revision(),materialRevision:view.materialRevision,recordSha256:view.recordSha256,action:value,currentPassword:value.type==='item'?null:PASSWORD}});};
 const addBody=async()=>{const view=ok(await b.api(f.base)),bytes=Buffer.from('new synthetic subscription original\r\n');return{requestId:randomUUID(),projectRevision:f.revision(),materialRevision:view.materialRevision,recordSha256:view.recordSha256,nodeId:'n2',generationId:view.record.generationId,filename:'subscription-original.txt',mimeType:'text/plain',byteLength:bytes.length,sha256:sha(bytes),contentBase64:bytes.toString('base64')};};
 const removeBody=async()=>{const body=await addBody();return Object.fromEntries([...['requestId','projectRevision','materialRevision','recordSha256','nodeId','generationId'].map(k=>[k,body[k]]),['reason','remove current association only']]);};
 let imported;
 if(publish){const id=await f.stage(f.owner,pack);imported=ok(await f.commit(f.owner,id.requestId),201);}
 if(maintain){const members=ok(await f.api(f.base+'/members',{session:f.owner})).members,m=members.find(x=>x.id==='manager-a');ok(await f.api(f.base+'/access',{method:'POST',session:f.owner,body:{projectRevision:f.revision(),userId:m.id,memberRevision:m.memberRevision,grantRevision:m.grantRevision,maintenanceRevision:m.maintenanceRevision,read:true,import:true,review:true,close:true,maintain:true,currentPassword:PASSWORD}}));}
 return{...f,...b,pack,startBody,start,put,commit,stage,action,addBody,removeBody,imported};
}
async function workpapers(t){const f=await createWorkpaperDataFixture(t),b=await billing(f);return{...f,...b};}
const wpPut=(f,id,index=0)=>{const bytes=f.bytes.subarray(index*1048576,(index+1)*1048576);return f.api(f.wpRoute()+'/imports/'+id+'/chunks/'+index,{method:'PUT',body:{sha256:sha(bytes),data:bytes.toString('base64')}});};
async function wpStage(f){const body=f.startBody();ok(await f.api(f.wpRoute()+'/imports',{method:'POST',body}),201);for(let i=0;i<body.chunkCount;i++)ok(await wpPut(f,body.requestId,i));return body.requestId;}
const wpCommit=(f,id)=>f.api(f.wpRoute()+'/imports/'+id+'/commit',{method:'POST',body:f.commitBody()});
const wpQuery=(f,version=1)=>'?version='+version+'&projectRevision='+f.dataRevision()+'&grantRevision='+f.dataGrantRevision();

test('active material import, review, close/reopen and maintenance publish once; expired history and exports stay authorized',async t=>{
 const f=await materials(t,{maintain:true}),term=f.term(),id=await f.stage(),imported=ok(await f.commit(id),201);assert.equal(imported.kind,'import');assert.equal(imported.requestId,id);assert.equal(imported.packageSha256,sha(f.pack.bytes));
 ok(await f.action({type:'item',id:'n2',status:'confirmed',evidence:'synthetic reviewer evidence',reason:''}));ok(await f.action({type:'close'}));ok(await f.action({type:'reopen',reason:'synthetic permitted reopen'}));
 const body=await f.addBody(),added=ok(await f.api(f.base+'/files',{method:'POST',body}),201);assert.equal(added.kind,'attachment-add');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_material_files').get().n,4);
 const removed=ok(await f.api(f.base+'/files/'+added.fileId+'/remove',{method:'POST',body:await f.removeBody()}));assert.equal(removed.kind,'attachment-remove');assert.equal(removed.materialRevision,6);
 ok(await f.action({type:'item',id:'n2',status:'confirmed',evidence:'fresh review after maintenance',reason:''}));
 const before=dataRows(f.db);f.clock.value=term.endsAt;
 const view=ok(await f.api(f.base));assert.equal(view.materialRevision,7);assert.equal(view.record.closed,null);assert.deepEqual(ok(await f.api(f.base+'/receipts/'+id)),imported);
 const file=await f.api(f.base+'/files/'+added.fileId);ok(file);assert.equal(sha(file.bytes),body.sha256);assert.equal((await f.api(f.base+'/files/'+added.fileId,{method:'HEAD'})).status,200);
 const plan=ok(await f.api(f.base+'/export-plan')),query=new URLSearchParams(Object.fromEntries(['projectRevision','materialRevision','recordSha256','planSha256'].map(k=>[k,String(plan[k])])));
 const exported=await f.api(f.base+'/export-package?'+query);ok(exported);assert.equal(sha(exported.bytes),exported.headers.get('X-Shenyi-Material-Export-Sha256'));
 unavailable(await f.action({type:'item',id:'n2',status:'na',evidence:'',reason:'expired cannot edit'}));unavailable(await f.action({type:'close'}));
 unavailable(await f.api(f.base+'/files',{method:'POST',body:await f.addBody()}));unavailable(await f.api(f.base+'/files/'+preservation.FIDS[2]+'/remove',{method:'POST',body:await f.removeBody()}));assert.deepEqual(dataRows(f.db),before);
});

test('material begin rejects unconfigured, scheduled and exact-end periods without changing any material table',async t=>{
 const f=await materials(t),before=dataRows(f.db);unavailable(await f.start().promise);f.term({startsAt:f.clock.value+100,endsAt:f.clock.value+200});unavailable(await f.start().promise);f.clock.value+=200;unavailable(await f.start().promise);assert.deepEqual(dataRows(f.db),before);
});

test('material chunks and commit stop at expiry while owned cancellation still cleans only the temporary stage',async t=>{
 const f=await materials(t),term=f.term(),id=await f.stage(),before=dataRows(f.db);f.clock.value=term.endsAt;unavailable(await f.put(id));unavailable(await f.commit(id));assert.deepEqual(dataRows(f.db),before);
 ok(await f.api(f.base+'/imports/'+id,{method:'DELETE'}));assert.equal(f.db.prepare('SELECT status FROM team_material_imports WHERE request_id=?').get(id).status,'canceled');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_material_import_chunks').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_material_records').get().n,0);
});

test('material begin and chunk insert expiry roll back their real staging transactions',async t=>{
 for(const phase of ['begin','chunk']){const f=await materials(t),term=f.term();let id;if(phase==='chunk'){const a=f.start();id=ok(await a.promise,201).requestId;}const before=dataRows(f.db),reached=expiryTrigger(f,phase==='begin'?'team_material_imports':'team_material_import_chunks',term.endsAt);unavailable(await(phase==='begin'?f.start().promise:f.put(id)));reached();assert.deepEqual(dataRows(f.db),before);}
});

test('material package admission cannot publish after a real inspection awaited across expiry',async t=>{
 const f=await materials(t),term=f.term(),id=await f.stage(),before=dataRows(f.db),admission=require('../shared/material-admission.cjs'),original=admission.inspectMaterialPackage,entered=Promise.withResolvers(),release=Promise.withResolvers();
 admission.inspectMaterialPackage=async(bytes,options)=>{const result=await original(bytes,options);entered.resolve();await release.promise;options.assertCurrent();return result;};t.after(()=>{admission.inspectMaterialPackage=original;release.resolve();});
 const pending=f.commit(id);await entered.promise;f.clock.value=term.endsAt;release.resolve();unavailable(await pending);assert.deepEqual(dataRows(f.db),before);
});

test('material final import audit expiry rolls back record, originals, receipt and stage publication together',async t=>{
 const f=await materials(t),term=f.term(),id=await f.stage(),before=dataRows(f.db),reached=expiryTrigger(f,'team_material_events',term.endsAt);unavailable(await f.commit(id));reached();assert.deepEqual(dataRows(f.db),before);
});

test('material review final-audit expiry rolls back its new revision and receipt',async t=>{
 const f=await materials(t,{publish:true}),term=f.term(),before=dataRows(f.db),reached=expiryTrigger(f,'team_material_events',term.endsAt);unavailable(await f.action({type:'item',id:'n2',status:'na',evidence:'',reason:'valid synthetic review'}));reached();assert.deepEqual(dataRows(f.db),before);
});

test('maintenance real admission and final audit separately recheck expiry without losing historical bytes',async t=>{
 for(const phase of ['admission','publication','remove-publication']){const f=await materials(t,{publish:true,maintain:true}),term=f.term(),before=dataRows(f.db),body=await f.addBody();
  if(phase!=='admission'){const reached=expiryTrigger(f,'team_material_maintenance_events',term.endsAt);unavailable(await f.api(phase==='publication'?f.base+'/files':f.base+'/files/'+preservation.FIDS[2]+'/remove',{method:'POST',body:phase==='publication'?body:await f.removeBody()}));reached();}
  else{const admission=require('../shared/material-admission.cjs'),original=admission.prepareMaterialFile,entered=Promise.withResolvers(),release=Promise.withResolvers();admission.prepareMaterialFile=async(input,options)=>{const result=await original(input,options);entered.resolve();await release.promise;options.assertCurrent();return result;};t.after(()=>{admission.prepareMaterialFile=original;release.resolve();});try{const pending=f.api(f.base+'/files',{method:'POST',body});await entered.promise;f.clock.value=term.endsAt;release.resolve();unavailable(await pending);}finally{admission.prepareMaterialFile=original;release.resolve();}}
  assert.deepEqual(dataRows(f.db),before);
 }
});

test('subscription never masks dynamic material review/close, maintenance, actor or cross-team authorization',async t=>{
 const f=await materials(t,{publish:true});ok(await f.grant(f.owner,'manager-a',{read:true,import:false,review:false,close:false}));f.term({endsAt:f.clock.value});const before=dataRows(f.db);
 for(const action of [{type:'item',id:'n2',status:'na',evidence:'',reason:'no grant'},{type:'close'},{type:'reopen',reason:'no grant'}])assert.equal((await f.action(action)).status,404);
 assert.equal((await f.api(f.base+'/files',{method:'POST',body:await f.addBody()})).status,404);
 for(const user of ['intern-a','administrator-demo','manager-b']){const current=await f.ready(user);assert.equal((await f.api(f.base+'/imports',{session:current,method:'POST',body:f.startBody()})).status,404);}
 assert.deepEqual(dataRows(f.db),before);
});

test('active workpaper import preserves record, originals and freeze; expired history and export remain authorized',async t=>{
 const f=await workpapers(t);ok(await f.wpGrant(f.user,{read:true,write:true,export:true}));const term=f.term(),id=await wpStage(f),receipt=ok(await wpCommit(f,id),201).receipt;assert.equal(receipt.version,1);assert.equal(receipt.kind,'import');
 const rows=f.dataRows(),source=JSON.parse(rows.versions[0].record_json);assert.ok(Object.keys(source.workpaperLocks).length>0);assert.equal(rows.heads[0].source_package_sha256,sha(f.bytes));for(const file of rows.originals)assert.equal(sha(file.bytes),file.sha256);
 const before=dataRows(f.db);f.clock.value=term.endsAt;assert.deepEqual(ok(await f.api(f.wpRoute()+'/receipts/'+id)).receipt,receipt);assert.equal(ok(await f.api(f.wpRoute())).data.headRevision,1);assert.equal(ok(await f.api(f.wpRoute()+'/versions')).versions.length,1);
 const record=await f.api(f.wpRoute()+'/record'+wpQuery(f));ok(record);assert.equal(sha(record.bytes),rows.versions[0].record_sha256);
 for(const original of rows.originals){const r=await f.api(f.wpRoute()+'/originals/'+original.sha256+wpQuery(f));ok(r);assert.deepEqual(r.bytes,Buffer.from(original.bytes));}
 const exported=await f.api(f.wpRoute()+'/export'+wpQuery(f));ok(exported);assert.equal(sha(exported.bytes),exported.headers.get('X-Shenyi-Workpaper-Export-Sha256'));assert.deepEqual(dataRows(f.db),before);
 assert.equal((await f.api(f.wpRoute()+'/imports/'+id,{method:'DELETE'})).status,409);assert.deepEqual(dataRows(f.db),before);
});

test('workpaper begin rejects missing/scheduled/expired terms and previous modes retain their behavior',async t=>{
 const f=await workpapers(t),before=dataRows(f.db),route=f.wpRoute()+'/imports';unavailable(await f.api(route,{method:'POST',body:f.startBody()}));f.term({startsAt:f.clock.value+100,endsAt:f.clock.value+200});unavailable(await f.api(route,{method:'POST',body:f.startBody()}));f.clock.value+=200;unavailable(await f.api(route,{method:'POST',body:f.startBody()}));assert.deepEqual(dataRows(f.db),before);
 const old=ok(await f.api(route,{method:'POST',body:f.startBody()},'workspace-create-v1'),201);ok(await f.api(f.wpRoute()+'/imports/'+old.requestId,{method:'DELETE'}));const disabled=ok(await f.api(route,{method:'POST',body:f.startBody()},'disabled'),201);ok(await f.api(f.wpRoute()+'/imports/'+disabled.requestId,{method:'DELETE'}));
});

test('workpaper stage PUT/commit reject expiry and preserve all blocks; owned cancel remains usable',async t=>{
 const f=await workpapers(t),term=f.term(),id=await wpStage(f),before=dataRows(f.db);f.clock.value=term.endsAt;unavailable(await wpPut(f,id));unavailable(await wpCommit(f,id));assert.deepEqual(dataRows(f.db),before);assert.equal(ok(await f.api(f.wpRoute()+'/imports/'+id)).stage.status,'active');ok(await f.api(f.wpRoute()+'/imports/'+id,{method:'DELETE'}));assert.equal(f.dataRows().imports[0].status,'canceled');assert.equal(f.dataRows().chunks.length,0);assert.equal(f.dataRows().heads.length,0);
});

test('workpaper begin/chunk transaction-end expiry rolls back new stages or bytes',async t=>{
 for(const phase of ['begin','chunk']){const f=await workpapers(t),term=f.term();let id;if(phase==='chunk')id=ok(await f.api(f.wpRoute()+'/imports',{method:'POST',body:f.startBody()}),201).requestId;const before=dataRows(f.db),reached=expiryTrigger(f,phase==='begin'?'team_workpaper_data_imports':'team_workpaper_data_chunks',term.endsAt);unavailable(await(phase==='begin'?f.api(f.wpRoute()+'/imports',{method:'POST',body:f.startBody()}):wpPut(f,id)));reached();assert.deepEqual(dataRows(f.db),before);}
});

test('workpaper commit real KDF rejects expiry and changed subscription revision while preserving staged originals',async t=>{
 for(const mode of ['expiry','revision']){const f=await workpapers(t),term=f.term(),id=await wpStage(f),before=dataRows(f.db),hold=f.passwordHold();const pending=wpCommit(f,id);await hold.entered.promise;if(mode==='expiry')f.clock.value=term.endsAt;else f.term({endsAt:term.endsAt+1000});hold.release.resolve();const result=await pending;mode==='expiry'?unavailable(result):conflict(result);assert.deepEqual(dataRows(f.db),before);}
});

test('workpaper final version expiry rolls back head, originals, version and stage cleanup',async t=>{
 const f=await workpapers(t),term=f.term(),id=await wpStage(f),before=dataRows(f.db),reached=expiryTrigger(f,'team_workpaper_data_versions',term.endsAt);unavailable(await wpCommit(f,id));reached();assert.deepEqual(dataRows(f.db),before);
});

test('entries save actual original cells only while active; expired form/history stays readable and unauthorized actors stay denied',async t=>{
 const f=await entriesFixture(t),b=await billing(f),term=b.term(),old=f.dataRows(),body=f.entryBody(),result=ok(await b.api(f.wpRoute()+'/entries/'+f.document.sha256,{method:'POST',body}),201);assert.equal(result.receipt.version,2);assert.deepEqual(f.dataRows().originals,old.originals);
 const record=ok(await b.api(f.wpRoute()+'/record'+wpQuery(f,2)));assert.equal(record.answers[f.document.sha256]['原表'].A2,f.change.value);const before=dataRows(f.db);f.clock.value=term.endsAt;
 unavailable(await b.api(f.wpRoute()+'/entries/'+f.document.sha256,{method:'POST',body:f.entryBody({changes:[{...f.change,value:'expired replacement'}]})}));
 const form=ok(await b.api(f.wpRoute()+'/forms/'+f.document.sha256+wpQuery(f,2))).form;assert.equal(form.sha256,f.document.sha256);assert.deepEqual(ok(await b.api(f.wpRoute()+'/receipts/'+body.requestId)).receipt,result.receipt);
 for(const user of ['partner-a','intern-a','administrator-demo','manager-b']){const actor=await f.ready(user);assert.equal((await b.api(f.wpRoute()+'/entries/'+f.document.sha256,{method:'POST',session:actor,body:f.entryBody({},actor)})).status,404);}
 assert.deepEqual(dataRows(f.db),before);
});

test('entries actual Office result awaited across expiry cannot publish a new version',async t=>{
 const f=await entriesFixture(t),b=await billing(f),term=b.term(),before=dataRows(f.db),held=holdOfficeResult(t),pending=b.api(f.wpRoute()+'/entries/'+f.document.sha256,{method:'POST',body:f.entryBody()});assert.equal(await held.entered,f.document.sha256);f.clock.value=term.endsAt;held.release();unavailable(await pending);assert.deepEqual(dataRows(f.db),before);
});

test('entries final version expiry rolls back saved values and an active term cannot bypass an existing freeze',async t=>{
 const f=await entriesFixture(t),b=await billing(f),term=b.term(),before=dataRows(f.db),reached=expiryTrigger(f,'team_workpaper_data_versions',term.endsAt);unavailable(await b.api(f.wpRoute()+'/entries/'+f.document.sha256,{method:'POST',body:f.entryBody()}));reached();assert.deepEqual(dataRows(f.db),before);
 const frozen=await entriesFixture(t,{freeze:true}),c=await billing(frozen);c.term();const locked=dataRows(frozen.db);assert.equal((await c.api(frozen.wpRoute()+'/entries/'+frozen.document.sha256,{method:'POST',body:frozen.entryBody()})).status,409);assert.deepEqual(dataRows(frozen.db),locked);
});

test('ledger saved-source import stays read-only data; expiry blocks first/subsequent imports without hiding saved history',async t=>{
 const f=await createLedgerFixture(t);ok(await f.ledgerGrant());const b=await billing(f),body=await f.ledgerImportBody(),before=dataRows(f.db);unavailable(await b.api(f.ledgerRoute()+'/imports',{method:'POST',body}));b.term({startsAt:f.clock.value+100,endsAt:f.clock.value+200});unavailable(await b.api(f.ledgerRoute()+'/imports',{method:'POST',body}));assert.deepEqual(dataRows(f.db),before);
 f.clock.value+=100;const result=ok(await b.api(f.ledgerRoute()+'/imports',{method:'POST',body}),201).receipt;assert.equal(result.version,1);assert.equal(result.sourceSha256,sha(body.sourceJson));const saved=dataRows(f.db);f.clock.value+=100;
 unavailable(await b.api(f.ledgerRoute()+'/imports',{method:'POST',body:await f.ledgerImportBody()}));assert.deepEqual(ok(await b.api(f.ledgerRoute()+'/imports/'+body.operationId)).receipt,result);
 const access=ok(await b.api(f.ledgerRoute()+'/access')).access,query='?projectRevision='+f.revision()+'&grantRevision='+access.grantRevision,read=await b.api(f.ledgerRoute()+'/snapshots/'+result.snapshotId+query);ok(read);assert.equal(sha(read.bytes),sha(body.sourceJson));assert.equal(read.data.reconciliation.result.automaticWriteAllowed,false);assert.equal(ok(await b.api(f.ledgerRoute())).snapshots.length,1);
 const partner=await f.ready('partner-a');assert.equal((await b.api(f.ledgerRoute()+'/imports',{method:'POST',session:partner,body:await f.ledgerImportBody({current:partner})})).status,404);assert.deepEqual(dataRows(f.db),saved);
});

test('ledger real KDF expiry/revision and final snapshot expiry each leave no partial history',async t=>{
 for(const mode of ['expiry','revision','publication']){const f=await createLedgerFixture(t);ok(await f.ledgerGrant());const b=await billing(f),term=b.term(),body=await f.ledgerImportBody(),before=dataRows(f.db);let reached;
  if(mode==='publication')reached=expiryTrigger(f,'team_ledger_check_snapshots',term.endsAt);
  const hold=mode==='publication'?null:f.passwordHold(),pending=b.api(f.ledgerRoute()+'/imports',{method:'POST',body});if(hold){await hold.entered.promise;if(mode==='expiry')f.clock.value=term.endsAt;else b.term({endsAt:term.endsAt+1000});hold.release.resolve();}
  const result=await pending;mode==='revision'?conflict(result):unavailable(result);if(reached)reached();assert.deepEqual(dataRows(f.db),before);
 }
});
