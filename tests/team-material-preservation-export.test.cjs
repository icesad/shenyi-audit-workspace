'use strict';
const {laterTeamSchemaLayers:ledgerCheckSchemaLayer}=require('./helpers/workpaper-access-schema-layer.cjs');
const nodeTest=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const test=(name,run)=>nodeTest(name,{timeout:30000},run);
const {createMaterialPreservationExportFixture,digest,preservation,canonical,source}=require('./helpers/material-preservation-export-fixture.cjs');
const P=require('../dist/material-preservation.js');
const PLAN=['teamId','projectId','sourceProjectId','resourceKind','projectStatus','projectRevision','materialRevision','recordSha256','recordSchema','recordRevision','generationId','recordByteLength','fileCount','originalByteLength','filesSha256','packageByteLimit','serverId','planSha256'];
const ORIGIN=['teamId','projectId','sourceProjectId','resourceKind','projectStatus','projectRevision','materialRevision','recordSha256','recordByteLength','filesSha256','serverId','planSha256'];
function keys(value,list){assert.deepEqual(Object.keys(value).sort(),[...list].sort());}
async function capturedPlan(f,actor){const result=await f.plan(actor);assert.equal(result.status,200,JSON.stringify(result.data));keys(result.data,PLAN);return result.data;}
function blobSpy(f){const original=f.db.prepare,spy={reads:0};f.db.prepare=function(sql){if(/original\.bytes/u.test(sql))spy.reads++;return original.call(this,sql);};return {...spy,get reads(){return spy.reads;},restore(){f.db.prepare=original;}};}
function heldDigest(t,choose=()=>true){
 const original=crypto.subtle.digest.bind(crypto.subtle);let release,entered,once=false;
 const gate=new Promise(resolve=>release=resolve),arrived=new Promise(resolve=>entered=resolve);
 t.mock.method(crypto.subtle,'digest',async function(algorithm,data){const result=await original(algorithm,data);if(!once&&choose(data)){once=true;entered();await gate;}return result;});
 return {arrived,release,get entered(){return once;}};
}
for(const [name,options] of [['W differs from Q',{}],['W equals Q',{sameIdentity:true}],['legacy',{legacy:true}]])test(name+' exports the exact current record and all removed and prior-generation original bytes',async t=>{
 const f=await createMaterialPreservationExportFixture(t,options),before=f.businessSnapshot(),plan=await capturedPlan(f),row=f.db.prepare('SELECT * FROM team_material_records').get(),files=P.filesFor(f.pkg.original.record);
 assert.equal(plan.sourceProjectId,f.sourceProjectId);assert.equal(plan.projectId,f.projectId);assert.equal(plan.resourceKind,options.legacy?'legacy':'collection-workspace');assert.equal(plan.recordByteLength,Buffer.byteLength(row.record_json));assert.equal(plan.recordSha256,digest(row.record_json));assert.equal(plan.filesSha256,digest(canonical(files)));assert.equal(plan.fileCount,3);assert.equal(plan.originalByteLength,f.pkg.original.originals.reduce((sum,file)=>sum+file.data.length,0));
 const unsigned={...plan};delete unsigned.planSha256;assert.equal(plan.planSha256,digest(canonical(unsigned)));
 const result=await f.binary(plan);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.headers.get('Content-Type'),'application/zip');assert.equal(result.headers.get('Content-Length'),String(result.bytes.length));assert.equal(result.headers.get('X-Shenyi-Material-Export-Sha256'),digest(result.bytes));assert.equal(result.headers.get('X-Shenyi-Material-Plan-Sha256'),plan.planSha256);assert.match(result.headers.get('Cache-Control'),/private, no-store/);assert.equal(result.headers.get('X-Content-Type-Options'),'nosniff');assert.match(result.headers.get('Content-Disposition'),/^attachment; filename="[^"\\/]+\.zip"$/);
 const inspected=await P.inspect(result.bytes);assert.equal(inspected.manifest.schemaVersion,2);keys(inspected.manifest.origin,ORIGIN);assert.deepEqual(inspected.manifest.origin,Object.fromEntries(ORIGIN.map(key=>[key,plan[key]])));assert.equal(inspected.manifest.policy.teamImported,true);assert.equal(inspected.manifest.policy.identityAuthenticated,false);assert.equal(inspected.manifest.policy.professionalApprovalClaimed,false);assert.equal(inspected.manifest.projectId,f.sourceProjectId);assert.deepEqual(inspected.record,f.pkg.original.record);
 const entries=preservation.unzip(result.bytes);assert.deepEqual(entries.find(entry=>entry.name==='record.json').data,Buffer.from(row.record_json));for(const file of f.pkg.original.originals)assert.deepEqual(entries.find(entry=>entry.name==='originals/'+file.metadata.id+'.bin').data,file.data);
 assert.deepEqual(f.businessSnapshot(),before);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").get().n-ledgerCheckSchemaLayer(f.db).objects,252);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_auth_limits WHERE bucket LIKE 'materials-preservation-export:%'").get().n,1);
});

test('plan is stable, metadata-only and exposes no record, credential, business source or original bytes',async t=>{
 const f=await createMaterialPreservationExportFixture(t),spy=blobSpy(f);try{const first=await capturedPlan(f),second=await capturedPlan(f);assert.deepEqual(first,second);assert.equal(spy.reads,0);assert.equal(Object.keys(first).length,18);assert.equal(JSON.stringify(first).includes('password'),false);assert.equal(JSON.stringify(first).includes('record_json'),false);}finally{spy.restore();}
});
test('only material read is required, with no collection owner review close import or maintain capability',async t=>{
 const f=await createMaterialPreservationExportFixture(t);assert.equal((await f.grant(f.owner,'partner-a',{read:true,import:false,review:false,close:false,maintain:false})).status,200);const reader=await f.ready('partner-a');const access=(await f.access(reader)).data;assert.equal(access.read,true);for(const flag of ['canManageAccess','review','close','import','maintain'])assert.equal(access[flag],false);const project=await f.api('/api/teams/team-a/projects/'+f.projectId,{session:reader});for(const flag of ['canRead','canReview','canCreateTask','canManageAccess'])assert.equal(project.data.project[flag],false);assert.equal((await f.binary(await capturedPlan(f,reader),reader)).status,200);
});
test('empty material area refuses both exports with zero BLOB reads',async t=>{
 const f=await createMaterialPreservationExportFixture(t,{empty:true}),spy=blobSpy(f);try{assert.equal((await f.plan()).status,404);const r=await f.dispatch(f.makeRequest(f.base+'/export-package?projectRevision=1&materialRevision=1&recordSha256='+ 'a'.repeat(64)+'&planSha256='+'b'.repeat(64),{session:f.owner}));assert.equal(r.status,404);assert.equal(spy.reads,0);}finally{spy.restore();}
});
for(const v1 of [false,true])test('closed frozen schema'+(v1?1:2)+' record is exportable, including zero originals',async t=>{
 const f=await createMaterialPreservationExportFixture(t,{v1});f.db.prepare("UPDATE team_projects SET status='frozen' WHERE project_id=?").run(f.projectId);const plan=await capturedPlan(f);assert.equal(plan.projectStatus,'frozen');assert.equal(plan.fileCount,v1?0:3);assert.equal(plan.generationId,v1?null:f.pkg.original.record.generationId);const result=await f.binary(plan);assert.equal(result.status,200);assert.deepEqual((await P.inspect(result.bytes)).record.closed,f.pkg.original.record.closed);
});
test('archived projects reject plan and binary without reading any original',async t=>{
 const f=await createMaterialPreservationExportFixture(t),plan=await capturedPlan(f);f.db.prepare("UPDATE team_projects SET status='archived' WHERE project_id=?").run(f.projectId);const spy=blobSpy(f);try{assert.equal((await f.plan()).status,404);assert.equal((await f.binary(plan)).status,404);assert.equal(spy.reads,0);}finally{spy.restore();}
});
test('owner, other senior, junior, assistant, foreign member and technical identity cannot substitute for material read',async t=>{
 const f=await createMaterialPreservationExportFixture(t),plan=await capturedPlan(f);for(const user of ['partner-a','intern-a','assistant-a','manager-b','administrator-demo']){const actor=await f.ready(user);assert.equal((await f.plan(actor)).status,404,user);assert.equal((await f.binary(plan,actor)).status,404,user);}assert.equal((await f.grant(f.owner,'manager-a',{read:false,import:false,review:false,close:false,maintain:false})).status,200);assert.equal((await f.plan()).status,404);
});
test('strict signed device context is mandatory; arbitrary or old diagnostic sessions are rejected',async t=>{
 const f=await createMaterialPreservationExportFixture(t);const boot=await f.login('partner-a');assert.equal((await f.api(f.base+'/export-plan',{session:boot})).status,403);assert.equal((await f.api(f.base+'/export-plan',{strict:false,session:f.owner})).status,403);assert.equal((await f.api(f.base+'/export-plan')).status,401);
});
test('all methods and exact query grammar are enforced without changing the two-GET contract',async t=>{
 const f=await createMaterialPreservationExportFixture(t),plan=await capturedPlan(f),route=f.packageRoute(plan);
 for(const suffix of ['?x=1','?projectRevision=1'])assert.equal((await f.plan(f.owner,suffix)).status,400);
 for(const change of [s=>s+'&extra=1',s=>s+'&projectRevision=1',s=>s.replace('projectRevision=','projectRevision=0'),s=>s.replace('projectRevision=','projectRevision=%31'),s=>s.replace('materialRevision=1','materialRevision=01'),s=>s.replace(plan.planSha256,plan.planSha256.toUpperCase()),s=>s.replace('projectRevision='+plan.projectRevision,'projectRevision=9007199254740992'),s=>s.replace(/&planSha256=.*/,''),s=>s.replace('projectRevision='+plan.projectRevision,'projectRevision='+plan.projectRevision+'%0A'),s=>s+'&materialRevision=1%0A',s=>s.replace(plan.planSha256,plan.planSha256+'%0A')]){
  const response=await f.dispatch(f.makeRequest(change(route),{session:f.owner}));assert.equal(response.status,400,change(route));
 }
 for(const tail of ['/export-plan','/export-package'])for(const method of ['POST','PUT','DELETE','HEAD']){const response=await f.dispatch(f.makeRequest(f.base+tail,{method,session:f.owner}));assert.equal(response.status,405);assert.equal(response.headers.get('Allow'),'GET');if(method==='HEAD')assert.equal((await response.arrayBuffer()).byteLength,0);}
});
test('cross-team, Q routes and unknown resource IDs cannot borrow the authorized W plan',async t=>{
 const f=await createMaterialPreservationExportFixture(t),plan=await capturedPlan(f);for(const route of [f.base.replace('/team-a/','/team-b/')+'/export-plan',f.base.replace(f.projectId,f.sourceProjectId)+'/export-plan',f.base.replace(f.projectId,randomUUID())+'/export-plan',f.packageRoute(plan).replace(f.projectId,f.sourceProjectId)])assert.equal((await f.dispatch(f.makeRequest(route,{session:f.owner}))).status,404);
});
test('stale project revision material revision record hash or plan hash is rejected before BLOB selection',async t=>{
 const f=await createMaterialPreservationExportFixture(t),plan=await capturedPlan(f),spy=blobSpy(f);try{for(const changed of [{projectRevision:plan.projectRevision+1},{materialRevision:plan.materialRevision+1},{recordSha256:'e'.repeat(64)},{planSha256:'f'.repeat(64)}])assert.equal((await f.binary({...plan,...changed})).status,409);assert.equal(spy.reads,0);}finally{spy.restore();}
});
test('MAX safe project and material revisions remain readable without any increment or business mutation',async t=>{
 const f=await createMaterialPreservationExportFixture(t);f.db.prepare('UPDATE team_project_access_projects SET revision=? WHERE project_id=?').run(Number.MAX_SAFE_INTEGER,f.projectId);f.db.prepare('UPDATE team_material_records SET material_revision=?').run(Number.MAX_SAFE_INTEGER);const before=f.businessSnapshot(),plan=await capturedPlan(f);assert.equal(plan.projectRevision,Number.MAX_SAFE_INTEGER);assert.equal(plan.materialRevision,Number.MAX_SAFE_INTEGER);assert.equal((await f.binary(plan)).status,200);assert.deepEqual(f.businessSnapshot(),before);
});
test('four expensive exports per actor per minute do not rate-limit cheap plans or write any business row',async t=>{
 const f=await createMaterialPreservationExportFixture(t),before=f.businessSnapshot(),plan=await capturedPlan(f);for(let i=0;i<4;i++)assert.equal((await f.binary(plan)).status,200);assert.equal((await f.binary(plan)).status,429);assert.equal((await f.plan()).status,200);assert.deepEqual(f.businessSnapshot(),before);const row=f.db.prepare("SELECT attempts FROM team_auth_limits WHERE bucket LIKE 'materials-preservation-export:%'").get();assert.equal(row.attempts,4);
});
test('missing extra or inconsistent history metadata is refused before BLOB materialization',async t=>{
 const f=await createMaterialPreservationExportFixture(t),row=f.db.prepare('SELECT * FROM team_material_files LIMIT 1').get();f.db.exec('DROP TRIGGER material_files_no_update');f.db.prepare('UPDATE team_material_files SET filename=? WHERE file_id=?').run('different.txt',row.file_id);const spy=blobSpy(f);try{assert.equal((await f.plan()).status,503);assert.equal(spy.reads,0);}finally{spy.restore();}
});
test('a valid metadata plan never hides a damaged original BLOB hash',async t=>{
 const f=await createMaterialPreservationExportFixture(t),plan=await capturedPlan(f),row=f.db.prepare('SELECT file_id,bytes FROM team_material_files LIMIT 1').get();f.db.exec('DROP TRIGGER material_files_no_update');const damaged=Buffer.from(row.bytes);damaged[0]^=1;f.db.prepare('UPDATE team_material_files SET bytes=? WHERE file_id=?').run(damaged,row.file_id);assert.equal((await f.binary(plan)).status,503);
});
test('record JSON must retain original compact ordering and cannot hide duplicate keys or unchecked whitespace',async t=>{
 const f=await createMaterialPreservationExportFixture(t),row=f.db.prepare('SELECT record_json FROM team_material_records').get(),text=' '+row.record_json;f.db.prepare('UPDATE team_material_records SET record_json=?,record_sha256=?').run(text,digest(text));assert.equal((await f.plan()).status,503);
});
test('record and history bounds fail before loading original bytes',async t=>{
 const f=await createMaterialPreservationExportFixture(t),row=f.db.prepare('SELECT record_json FROM team_material_records').get(),record=JSON.parse(row.record_json),example=record.events.find(event=>event.type==='attachment-add');record.events=Array.from({length:5001},()=>example);const text=JSON.stringify(record);f.db.prepare('UPDATE team_material_records SET record_json=?,record_sha256=?').run(text,digest(text));const spy=blobSpy(f);try{assert.equal((await f.plan()).status,413);assert.equal(spy.reads,0);}finally{spy.restore();}
});

for(const mutation of ['read-revoke','read-ABA','lease','credential','project','material'])test('held codec digest rejects '+mutation+' before delivering private package bytes',async t=>{
 const f=await createMaterialPreservationExportFixture(t),plan=await capturedPlan(f),hold=heldDigest(t),pending=f.binary(plan);await hold.arrived;
 try{
  if(mutation==='read-revoke'||mutation==='read-ABA'){f.db.prepare('UPDATE team_material_grants SET can_read=0,can_import=0,can_review=0,can_close=0,revision=revision+1').run();if(mutation==='read-ABA')f.db.prepare('UPDATE team_material_grants SET can_read=1,revision=revision+1').run();}
  else if(mutation==='lease')f.db.prepare('UPDATE team_device_leases SET revoked_at=? WHERE lease_id=?').run(f.clock.value,f.owner.lease.id);
  else if(mutation==='credential')f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='manager-a'").run();
  else if(mutation==='project')f.db.prepare('UPDATE team_project_access_projects SET revision=revision+1 WHERE project_id=?').run(f.projectId);
  else f.db.prepare('UPDATE team_material_records SET material_revision=material_revision+1').run();
 }finally{hold.release();}
 const result=await pending;assert.notEqual(result.status,200);assert.notEqual(result.headers.get('Content-Type'),'application/zip');
});
test('final full record check detects same-declared-SHA tampering that cheap per-file checks cannot accept',async t=>{
 const f=await createMaterialPreservationExportFixture(t),plan=await capturedPlan(f),data=f.pkg.original.originals.at(-1).data,hold=heldDigest(t,value=>Buffer.from(value).equals(data)),pending=f.binary(plan);await hold.arrived;const row=f.db.prepare('SELECT record_json FROM team_material_records').get(),record=JSON.parse(row.record_json);record.project.projectName+=' changed';f.db.prepare('UPDATE team_material_records SET record_json=?').run(JSON.stringify(record));hold.release();assert.equal((await pending).status,503);
});
test('global one-build guard has no queue and does not turn unauthorized requests into busy information',async t=>{
 const f=await createMaterialPreservationExportFixture(t);assert.equal((await f.grant(f.owner,'partner-a',{read:true,import:false,review:false,close:false,maintain:false})).status,200);const reader=await f.ready('partner-a'),junior=await f.ready('intern-a'),plan=await capturedPlan(f),hold=heldDigest(t),pending=f.binary(plan);await hold.arrived;
 assert.equal((await f.binary(plan,reader)).status,503);assert.equal((await f.binary(plan,junior)).status,404);hold.release();assert.equal((await pending).status,200);assert.equal((await f.binary(plan,reader)).status,200);
});
test('cancel aborts a held export and releases the build only after its original work has settled',async t=>{
 const f=await createMaterialPreservationExportFixture(t),plan=await capturedPlan(f),controller=new AbortController(),request=new Request(f.makeRequest(f.packageRoute(plan),{session:f.owner}),{signal:controller.signal}),hold=heldDigest(t),pending=f.binary(plan,f.owner,{request});await hold.arrived;controller.abort();const result=await pending;assert.equal(result.status,409);assert.equal(result.data.error.code,'MATERIAL_EXPORT_CANCELED');hold.release();await new Promise(resolve=>setImmediate(resolve));assert.equal((await f.binary(plan)).status,200);
});
test('180 second generation deadline returns an error and stale continuation cannot publish later',async t=>{
 const f=await createMaterialPreservationExportFixture(t),plan=await capturedPlan(f),hold=heldDigest(t);t.mock.timers.enable({apis:['setTimeout']});const pending=f.binary(plan);await hold.arrived;t.mock.timers.tick(180000);const result=await pending;assert.equal(result.status,504);assert.equal(result.data.error.code,'MATERIAL_EXPORT_TIMEOUT');hold.release();await new Promise(resolve=>setImmediate(resolve));t.mock.timers.reset();assert.equal((await f.binary(plan)).status,200);
});
test('real isolated loopback HTTP preserves binary length private headers and all original ZIP bytes',async t=>{
 const f=await createMaterialPreservationExportFixture(t),plan=await capturedPlan(f),{startTeamServer}=await source('dev-server.mjs');
 const server=await startTeamServer({db:f.db,port:0,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true}});
 try{
  const http=require('node:http'),route=f.packageRoute(plan),request=f.makeRequest(route,{session:f.owner});
  const result=await new Promise((resolve,reject)=>{const connection=http.get(new URL(route,server.address.url),{headers:Object.fromEntries(request.headers)},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,bytes:Buffer.concat(chunks)}));response.on('error',reject);});connection.on('error',reject);});
  assert.equal(result.status,200);assert.equal(result.headers['content-type'],'application/zip');assert.equal(result.headers['content-length'],String(result.bytes.length));assert.equal(result.headers['x-shenyi-material-export-sha256'],digest(result.bytes));assert.equal(result.headers['x-shenyi-material-plan-sha256'],plan.planSha256);assert.deepEqual((await P.inspect(result.bytes)).record,f.pkg.original.record);
 }finally{await server.close();}
});
test('real HTTP peer disconnect aborts a held build and prevents concurrent reuse until its work settles',async t=>{
 const f=await createMaterialPreservationExportFixture(t),plan=await capturedPlan(f),{startTeamServer}=await source('dev-server.mjs'),server=await startTeamServer({db:f.db,port:0,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true}}),hold=heldDigest(t);
 const abortedSignals=[],nativeAbort=AbortController.prototype.abort;t.mock.method(AbortController.prototype,'abort',function(...args){abortedSignals.push(this.signal);return nativeAbort.apply(this,args);});
 const peerClosed=new Promise(resolve=>server.server.once('request',(incoming,outgoing)=>outgoing.once('close',resolve)));
 let connection;
 try{
  const http=require('node:http'),route=f.packageRoute(plan),request=f.makeRequest(route,{session:f.owner}),ended=new Promise(resolve=>{
   connection=http.get(new URL(route,server.address.url),{headers:Object.fromEntries(request.headers)},response=>{response.resume();response.once('end',()=>resolve({status:response.statusCode}));});connection.once('error',error=>resolve({code:error.code}));
  });
  await hold.arrived;connection.destroy();assert.equal((await ended).code,'ECONNRESET');await peerClosed;assert.ok(abortedSignals.some(signal=>signal.aborted),'the real HTTP adapter must abort a Request controller on premature response close');
  const busy=await f.binary(plan);assert.equal(busy.status,503);assert.equal(busy.data.error.code,'MATERIAL_EXPORT_BUSY');
  hold.release();await new Promise(resolve=>setImmediate(resolve));const result=await f.binary(plan);assert.equal(result.status,200);
 }finally{hold.release();connection?.destroy();await server.close();}
});
