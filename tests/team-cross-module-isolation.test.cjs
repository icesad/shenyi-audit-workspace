'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {createCompositeFixture,MODULES,READ_FLAGS,ALL_FLAGS,sha,good,restorePasswordWork}=require('./helpers/cross-module-isolation-fixture.cjs');
const materials=require('../dist/material-preservation.js');
const {unpack}=require('./helpers/workpaper-export-fixture.cjs');
const {validateMaterialExportPlan}=require('../desktop/material-preservation-export-client.cjs');
// Actual public projections come from http-utils deny/invalid and application-api catch.
function publicError(response,status,code,message,f){
 assert.equal(response.status,status);const expected={error:{code,message}};
 assert.deepEqual(Object.keys(response.data),['error']);assert.deepEqual(Object.keys(response.data.error).sort(),['code','message']);assert.deepEqual(response.data,expected);
 const body=response.bytes?response.bytes.toString('utf8'):JSON.stringify(response.data);
 if(response.bytes)assert.equal(body,JSON.stringify(expected),'binary rejection must contain only the exact public JSON, without private body or file metadata');
 const publicHeaders=new Set(['cache-control','content-type','referrer-policy','vary','x-content-type-options','x-shenyi-server-id','content-length','connection','date','keep-alive','transfer-encoding']);
 for(const [key] of response.headers)assert.ok(publicHeaders.has(key.toLowerCase()),'rejection carried nonpublic resource metadata header: '+key);
 assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 const privateTokens=new Set([sha(f.expected.materials.packageBytes)]);
 const collect=v=>{if(typeof v==='string'){if(v.length>=8&&v!==f.W&&v!==f.Q)privateTokens.add(v);}else if(v&&typeof v==='object'&&!ArrayBuffer.isView(v))for(const x of Object.values(v))collect(x);};
 collect(f.expected);for(const json of [f.expected.source.json,f.expected.ledger.json,f.expected.workpaper.recordJson])collect(JSON.parse(json));
 const headers=[...response.headers].map(([key,value])=>key+': '+value).join('\n');
 // W and Q are shared addressing context, never private canaries by themselves.
 for(const token of privateTokens){assert.equal(body.includes(token),false,'rejection body leaked a private hash, filename or content value');assert.equal(headers.includes(token),false,'rejection headers leaked a private hash, filename or content value');}
 return response;
}
const denied=(response,f)=>publicError(response,404,'NOT_FOUND','无法访问此资源。',f);
const invalidMaterialFlags=(response,f)=>publicError(response,400,'INVALID_INPUT','请求资料无效。',f);
after(restorePasswordWork);
function noSiblingPrivateValues(f,module,value,headers,forbiddenModules=MODULES.filter(m=>m!==module)){
 const source=JSON.parse(f.expected.source.json),ledger=JSON.parse(f.expected.ledger.json),wp=JSON.parse(f.expected.workpaper.recordJson);
 const pools={
  materials:[f.expected.materials.recordSha256,sha(f.expected.materials.packageBytes),f.expected.materials.record.project.projectName,...f.expected.materials.originals.flatMap(x=>[x.id,x.sha256]),...f.expected.materials.record.events.filter(e=>e.type==='attachment-add').map(e=>e.file.name)],
  source:[f.expected.source.sha256,source.initiation.form.notes,source.initiation.form.manager],
  ledger:[f.expected.ledger.sha256,...Object.values(ledger.reconciliation.sourceRefs).map(x=>x.name)],
  workpaper:[f.expected.workpaper.recordSha256,f.expected.workpaper.sourcePackageSha256,...f.expected.workpaper.originals.map(x=>x.sha256),wp.archive.name,...wp.supplementalWorkpapers.map(x=>x.file.name),...Object.values(wp.answers).flatMap(sheets=>Object.values(sheets).flatMap(cells=>Object.values(cells)))]
 };
 const body=JSON.stringify(value),headerText=[...headers].map(([k,v])=>k+': '+v).join('\n');
 // Shared W/Q and the historical business number are addressing/context, not canaries.
 const shared=new Set([f.W,f.Q,source.numbering.businessNumber]);
 for(const sibling of forbiddenModules)for(const token of pools[sibling])if(typeof token==='string'&&token&&!shared.has(token)){assert.equal(body.includes(token),false,module+' response carried '+sibling+' private payload');assert.equal(headerText.includes(token),false,module+' headers carried '+sibling+' private payload');}
}

async function read(f,module,current=f.partner,allowed=true){
 const response=await f.readModule(module,current);if(!allowed){denied(response,f);return;}
 const value=good(response);if(module==='materials'){assert.deepEqual(Object.keys(value).sort(),['projectId','projectRevision','materialRevision','recordSha256','record','packageSha256','importedAt','importedBy','sourceProjectId'].sort());assert.deepEqual(Object.keys(value.importedBy).sort(),['displayName','id']);assert.equal(value.projectId,f.W);assert.equal(value.sourceProjectId,f.Q);assert.deepEqual(value.record,f.expected.materials.record);assert.equal(value.recordSha256,f.expected.materials.recordSha256);assert.equal(value.packageSha256,sha(f.expected.materials.packageBytes));noSiblingPrivateValues(f,module,value,response.headers);}
 else if(module==='source'){assert.deepEqual(Object.keys(value).sort(),['metadata','source']);assert.deepEqual(Object.keys(value.metadata).sort(),['teamId','projectId','projectRevision','grantRevision','sourceKind','sourceProjectId','sourceSha256','byteLength'].sort());assert.deepEqual(value.source,JSON.parse(f.expected.source.json));assert.equal(value.metadata.sourceProjectId,f.Q);assert.equal(value.metadata.sourceSha256,f.expected.source.sha256);assert.equal(value.metadata.byteLength,Buffer.byteLength(f.expected.source.json));noSiblingPrivateValues(f,module,value,response.headers);}
 else if(module==='ledger')assert.deepEqual(value,JSON.parse(f.expected.ledger.json));
 else assert.deepEqual(value,JSON.parse(f.expected.workpaper.recordJson));
}
async function original(f,module,current=f.partner,allowed=true){
 const response=await f.binaryModule(module,current,{kind:'original'});if(!allowed){denied(response,f);return;}
 assert.equal(response.status,200);const expected=module==='materials'?f.expected.materials.originals[0]:f.expected.workpaper.originals[0];assert.deepEqual(response.bytes,expected.bytes);assert.equal(sha(response.bytes),expected.sha256);
}
async function exporting(f,module,current=f.partner,allowed=true){
 let response;
 if(module==='materials'){
  const observed=await f.materialPlan(current);
  if(allowed){const plan=validateMaterialExportPlan(good(observed),f.target);assert.equal(plan.sourceProjectId,f.Q);assert.equal(plan.fileCount,3);assert.equal(plan.recordSha256,f.expected.materials.recordSha256);assert.equal(plan.projectRevision,f.revision(f.W));noSiblingPrivateValues(f,module,plan,observed.headers);response=await f.materialBinaryUsingPlan(plan,current);}
  else{denied(observed,f);response=await f.materialBinaryUsingOwnerPlan(current);}
 }else response=await f.binaryModule(module,current);
 if(!allowed){denied(response,f);return;}
 assert.equal(response.status,200);if(module==='source'){assert.equal(response.bytes.toString(),f.expected.source.json);assert.equal(sha(response.bytes),f.expected.source.sha256);}
 else if(module==='ledger'){assert.equal(response.bytes.toString(),f.expected.ledger.json);assert.equal(sha(response.bytes),f.expected.ledger.sha256);}
 else if(module==='materials'){const out=await materials.inspect(response.bytes);assert.deepEqual(Object.keys(out.manifest).sort(),['format','schemaVersion','packageId','createdAt','sourceNamespace','projectId','record','files','policy','origin'].sort());for(const item of out.manifest.files)assert.deepEqual(Object.keys(item).sort(),['id','entry','bytes','sha256'].sort());noSiblingPrivateValues(f,module,out.manifest,response.headers);assert.deepEqual(out.record,f.expected.materials.record);assert.equal(out.manifest.record.sha256,f.expected.materials.recordSha256);assert.equal(out.manifest.origin.projectId,f.W);assert.equal(out.manifest.projectId,f.Q);assert.equal(out.files.length,3);for(const file of out.files){const expected=f.expected.materials.originals.find(x=>x.id===file.metadata.id);assert.ok(expected);assert.deepEqual(Buffer.from(await file.blob.arrayBuffer()),expected.bytes);}}
 else{const out=await unpack(new Response(response.bytes,{status:response.status,headers:response.headers}));assert.equal(out.files.get('record.json').toString(),f.expected.workpaper.recordJson);assert.equal(out.manifest.scope.projectId,f.W);assert.equal(out.manifest.scope.sourceProjectId,f.Q);for(const expected of f.expected.workpaper.originals)assert.deepEqual(out.files.get('originals/'+expected.sha256+'.bin'),expected.bytes);assert.deepEqual(JSON.parse(out.files.get('record.json')).workpaperLocks,f.expected.workpaper.freeze);assert.doesNotMatch(response.bytes.toString(),/EXCLUDED_(?:REPORT|INVOICE|FIRM)/);}
}
async function discovery(f,expected){
 const genericResponse=await f.api('/api/teams/team-a/projects',{session:f.partner}),ledgerResponse=await f.api('/api/teams/team-a/ledger-check-projects',{session:f.partner}),workpaperResponse=await f.api('/api/teams/team-a/workpaper-projects',{session:f.partner});
 const generic=good(genericResponse).projects,ledger=good(ledgerResponse).projects,wp=good(workpaperResponse).projects,forbidden=MODULES.filter(module=>!expected[module]);
 for(const [label,response] of [['generic discovery',genericResponse],['ledger discovery',ledgerResponse],['workpaper discovery',workpaperResponse]])noSiblingPrivateValues(f,label,response.data,response.headers,forbidden);
 assert.deepEqual(generic.filter(x=>x.id===f.W).map(x=>x.id),expected.materials||expected.source?[f.W]:[]);
 assert.deepEqual(ledger.filter(x=>x.id===f.W).map(x=>x.id),expected.ledger?[f.W]:[]);assert.deepEqual(wp.filter(x=>x.id===f.W).map(x=>x.id),expected.workpaper?[f.W]:[]);
 if(expected.materials||expected.source){const response=await f.api('/api/teams/team-a/projects/'+f.W,{session:f.partner}),view=good(response).project;noSiblingPrivateValues(f,'project context',response.data,response.headers,forbidden);assert.equal(view.canRead,false);assert.equal(view.canCreateTask,false);assert.equal(view.canReview,false);assert.equal(view.canManageAccess,false);}
}
function rights(f,user='partner-a'){return Object.fromEntries(MODULES.map(m=>[m,{...f.rawFlags(m,user)}]));}
function rows(f,user='partner-a'){return Object.fromEntries(MODULES.map(m=>[m,{...f.grantRow(m,user)}]));}

test('same confirmed W/Q holds four valid nonempty modules while an all-none senior sees no private data or module project',async t=>{
 const f=await createCompositeFixture(t),before=f.businessSnapshot();assert.notEqual(f.W,f.Q);assert.equal(Object.keys(f.expected.workpaper.freeze).length,1);assert.equal(f.expected.materials.originals.length,3);assert.equal(f.expected.workpaper.originals.length,2);assert.equal(f.expected.ledger.receipt.version,1);
 for(const module of MODULES){await read(f,module,f.owner);await read(f,module,f.partner,false);await exporting(f,module,f.partner,false);}await original(f,'materials',f.partner,false);await original(f,'workpaper',f.partner,false);await discovery(f,{});assert.deepEqual(f.businessSnapshot(),before);
});
test('one stable non-owner session receives one module at a time, with exact data and no sibling grant or collection authority',async t=>{
 const f=await createCompositeFixture(t),before=f.businessSnapshot(),session=f.partner.token,lease=f.partner.lease.id;
 for(const selected of MODULES){await f.setGrants({[selected]:true});for(const module of MODULES){assert.equal(f.rawFlags(module).read,module===selected);await read(f,module,f.partner,module===selected);}await original(f,'materials',f.partner,selected==='materials');await original(f,'workpaper',f.partner,selected==='workpaper');await exporting(f,'source',f.partner,selected==='source');await exporting(f,'workpaper',f.partner,selected==='workpaper');if(selected==='materials')assert.deepEqual(f.rawFlags('materials'),READ_FLAGS.materials);await exporting(f,'materials',f.partner,selected==='materials');await discovery(f,{[selected]:true});assert.equal(f.partner.token,session);assert.equal(f.partner.lease.id,lease);assert.deepEqual(f.businessSnapshot(),before);}
});
test('explicit all-four read authority permits each real read/export without rewriting UUIDs, source bytes, originals, versions or existing freeze',async t=>{
 const f=await createCompositeFixture(t);await f.setGrants(Object.fromEntries(MODULES.map(m=>[m,true])));const before=f.businessSnapshot();for(const module of MODULES){await read(f,module);await exporting(f,module);}await original(f,'materials');await original(f,'workpaper');await discovery(f,Object.fromEntries(MODULES.map(m=>[m,true])));assert.deepEqual(f.businessSnapshot(),before);
});
test('source and workpaper export-only flags never replace read, while read-only and read+export behave independently in the populated composite',async t=>{
 const f=await createCompositeFixture(t),before=f.businessSnapshot();
 for(const module of ['source','workpaper']){
  await f.setGrants({[module]:{read:false,export:true,...module==='workpaper'?{write:true}:{}}});assert.equal(f.rawFlags(module).export,true);await read(f,module,f.partner,false);await exporting(f,module,f.partner,false);
  await f.setGrants({[module]:{read:true,export:false,...module==='workpaper'?{write:false}:{}}});await read(f,module);await exporting(f,module,f.partner,false);
  await f.setGrants({[module]:true});await read(f,module);await exporting(f,module);for(const sibling of MODULES.filter(m=>m!==module))await read(f,sibling,f.partner,false);
 }
 assert.deepEqual(f.businessSnapshot(),before);
});
for(const revoked of MODULES)test('module-specific '+revoked+' read revocation preserves the other three grants and every business row',async t=>{
 const f=await createCompositeFixture(t);await f.setGrants(ALL_FLAGS);
 if(revoked==='materials'){
  good(await f.configureModule('materials','partner-a',{...READ_FLAGS.materials,review:true}));
  const beforeInvalid=f.businessSnapshot(),grantsBefore=f.grantSnapshot();invalidMaterialFlags(await f.configureModule('materials','partner-a',{...READ_FLAGS.materials,read:false,review:true}),f);assert.deepEqual(f.businessSnapshot(),beforeInvalid);assert.deepEqual(f.grantSnapshot(),grantsBefore);
 }
 const before=f.businessSnapshot(),grants=rows(f),flags=rights(f),oldRevision=f.revision(f.W);
 const desired=revoked==='materials'?{read:false,import:false,review:false,close:false,maintain:false}:{...f.rawFlags(revoked),read:false};good(await f.configureModule(revoked,'partner-a',desired));
 assert.equal(f.rawFlags(revoked).read,false);if(revoked==='source'||revoked==='workpaper')assert.equal(f.rawFlags(revoked).export,true);if(revoked==='workpaper')assert.equal(f.rawFlags(revoked).write,true);
 if(revoked==='materials')assert.ok(f.revision(f.W)>oldRevision);else assert.equal(f.revision(f.W),oldRevision);
 await read(f,revoked,f.partner,false);await exporting(f,revoked,f.partner,false);if(revoked==='materials'||revoked==='workpaper')await original(f,revoked,f.partner,false);
 for(const sibling of MODULES.filter(m=>m!==revoked)){assert.deepEqual({...f.grantRow(sibling)},grants[sibling]);assert.deepEqual(f.rawFlags(sibling),flags[sibling]);await read(f,sibling);if(sibling==='materials'||sibling==='workpaper')await original(f,sibling);else await exporting(f,sibling);}
 for(const module of MODULES)await read(f,module,f.owner);assert.deepEqual(f.businessSnapshot(),before);
});
test('technical administration, both junior roles and a foreign-team manager remain outside all four populated module read/export chains',async t=>{
 const f=await createCompositeFixture(t);await f.setGrants(Object.fromEntries(MODULES.map(m=>[m,true])));const before=f.businessSnapshot();for(const module of MODULES)await read(f,module);
 for(const user of ['administrator-demo','intern-a','assistant-a','manager-b']){const current=await f.ready(user);for(const module of MODULES){await read(f,module,current,false);await exporting(f,module,current,false);}await original(f,'materials',current,false);await original(f,'workpaper',current,false);assert.deepEqual(f.businessSnapshot(),before);}
});
