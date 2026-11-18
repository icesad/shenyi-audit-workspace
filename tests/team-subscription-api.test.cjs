'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {syncBuiltinESMExports}=require('node:module');
// Pause the callback only after the actual native KDF finishes. Its inputs,
// work factor and result are unchanged.
const nativeScrypt=crypto.scrypt;let nextHold;
crypto.scrypt=function(...args){const callback=args.pop(),hold=nextHold;nextHold=null;return nativeScrypt(...args,(error,value)=>{if(!hold)return callback(error,value);hold.entered.resolve();void hold.release.promise.then(()=>callback(error,value));});};
syncBuiltinESMExports();after(()=>{crypto.scrypt=nativeScrypt;syncBuiltinESMExports();});
const {createProjectAccessFixture,PASSWORD,source}=require('./helpers/project-access-fixture.cjs');
const uuid=()=>crypto.randomUUID(),ROOT='/api/teams/team-a/collection-workspaces',STATUS='/api/teams/team-a/subscription-status';
const creation=extra=>({requestId:uuid(),title:'订阅基础合成采集区',read:true,manage:true,review:true,currentPassword:PASSWORD,...extra});
const fields=['teamId','state','revision','startsAt','endsAt','occupiesBusinessSeat','enforcementScope'];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const pauseKdf=()=>{const hold={entered:deferred(),release:deferred()};nextHold=hold;return hold;};
function business(db){return Object.fromEntries(['team_projects','team_project_access_projects','team_project_grants','team_project_access_grants','team_collection_workspace_creations','team_collection_tasks','team_material_records','team_material_files'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));}
async function fixture(t){
 const f=await createProjectAccessFixture(t,{register:false}),actor=await f.ready('manager-a'),{handleTeamApplicationRequest}=await source('application-api.mjs'),store=await source('subscription-store.mjs');
 const api=async(route,settings={},mode='workspace-create-v1')=>{const request=settings.raw??f.makeRequest(route,{session:actor,...settings}),response=await handleTeamApplicationRequest(request,{db:f.db,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true},subscriptionEnforcement:mode}),bytes=Buffer.from(await response.arrayBuffer());return{status:response.status,bytes,headers:response.headers,data:bytes.length?JSON.parse(bytes.toString()):null};};
 const term=(extra={})=>store.recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:uuid(),expectedRevision:0,startsAt:f.clock.value-1000,endsAt:f.clock.value+10000,sourceRef:'synthetic-internal-fact',...extra},{now:()=>f.clock.value});
 return{...f,actor,api,term,store};
}
test('strict own status is minimal, unconfigured by default, and does not reveal roster, seat totals or evidence',async t=>{
 const f=await fixture(t),before=business(f.db);const r=await f.api(STATUS);assert.equal(r.status,200);assert.deepEqual(Object.keys(r.data),['subscription']);assert.deepEqual(Object.keys(r.data.subscription).sort(),fields.sort());assert.deepEqual(r.data.subscription,{teamId:'team-a',state:'unconfigured',revision:0,startsAt:null,endsAt:null,occupiesBusinessSeat:true,enforcementScope:'workspace-create-v1'});
 for(const user of ['intern-a','assistant-a','administrator-demo']){const actor=await f.ready(user),value=await f.api(STATUS,{session:actor});assert.equal(value.status,200);assert.equal(value.data.subscription.occupiesBusinessSeat,user!=='administrator-demo');assert.equal(Object.hasOwn(value.data.subscription,'activeBusinessSeats'),false);}
 const foreign=await f.ready('manager-b');assert.equal((await f.api(STATUS,{session:foreign})).status,404);assert.equal((await f.api(STATUS,{session:null})).status,401);assert.equal((await f.api(STATUS+'?now=0')).status,400);assert.equal((await f.api(STATUS,{method:'POST',body:{state:'active'}})).status,405);assert.deepEqual(business(f.db),before);
});
test('explicit active term permits normal creation; exact expiry blocks another create but keeps original receipt and project reads',async t=>{
 const f=await fixture(t),grant=f.term(),input=creation(),created=await f.api(ROOT,{method:'POST',body:input});assert.equal(created.status,201,JSON.stringify(created.data));const before=business(f.db),id=created.data.receipt.projectId;
 f.clock.value=grant.endsAt;const status=await f.api(STATUS);assert.equal(status.data.subscription.state,'expired');assert.equal((await f.api(ROOT,{method:'POST',body:creation()})).status,402);assert.deepEqual(business(f.db),before);
 const receipt=await f.api(ROOT+'/receipts/'+input.requestId);assert.equal(receipt.status,200);assert.equal(receipt.data.receipt.projectId,id);assert.equal((await f.api('/api/teams/team-a/projects/'+id)).status,200);assert.deepEqual(business(f.db),before);
});
test('unconfigured and scheduled periods fail closed; no request header or field can activate a subscription',async t=>{
 const f=await fixture(t),before=business(f.db);assert.equal((await f.api(ROOT,{method:'POST',body:creation(),headers:{'X-Subscription-Active':'true','X-Subscription-Enforcement':'disabled'}})).status,402);
 const grant=f.term({startsAt:f.clock.value+1000,endsAt:f.clock.value+2000});assert.equal((await f.api(ROOT,{method:'POST',body:creation()})).status,402);assert.deepEqual(business(f.db),before);assert.equal(f.store.readSubscriptionState(f.db,'team-a',grant.startsAt).state,'active');
 f.clock.value=grant.startsAt;assert.equal((await f.api(ROOT,{method:'POST',body:creation({subscriptionEnforcement:'disabled'})})).status,400);assert.deepEqual(business(f.db),before);
});
for(const change of ['expiry','revision','clock-rollback'])test('real password work cannot outlive subscription '+change,async t=>{
 const f=await fixture(t),grant=f.term(),before=business(f.db),hold=pauseKdf();t.after(()=>hold.release.resolve());const pending=f.api(ROOT,{method:'POST',body:creation()});await hold.entered.promise;
 if(change==='expiry')f.clock.value=grant.endsAt;
 else if(change==='revision')f.term({expectedRevision:1,startsAt:grant.startsAt,endsAt:grant.endsAt+1000});
 else f.clock.value-=1;
 hold.release.resolve();const result=await pending;assert.equal(result.status,change==='expiry'?402:409,JSON.stringify(result.data));assert.deepEqual(business(f.db),before);
});
test('expiry reached after the receipt insert rolls back all creation rows in the real publish transaction',async t=>{
 const f=await fixture(t),grant=f.term(),before=business(f.db),prepare=f.db.prepare.bind(f.db);let reached=0;
 f.db.prepare=function(sql,...rest){const statement=prepare(sql,...rest);if(sql.startsWith('INSERT INTO team_collection_workspace_creations(')){const run=statement.run.bind(statement);statement.run=(...values)=>{const result=run(...values);reached++;f.clock.value=grant.endsAt;return result;};}return statement;};
 const result=await f.api(ROOT,{method:'POST',body:creation()});assert.equal(reached,1);assert.equal(result.status,402,JSON.stringify(result.data));assert.deepEqual(business(f.db),before);
});
test('subscription does not grant creation authority to low roles, a technical administrator or a foreign manager',async t=>{
 const f=await fixture(t);f.term();const before=business(f.db);for(const user of ['intern-a','assistant-a','administrator-demo','manager-b']){const actor=await f.ready(user),r=await f.api(ROOT,{session:actor,method:'POST',body:creation()});assert.equal(r.status,404,user+JSON.stringify(r.data));}assert.deepEqual(business(f.db),before);
});
test('configuration scope is server-owned, strict and explicitly bounded; disabled preserves the prior local preview',async t=>{
 const f=await fixture(t),before=business(f.db);for(const mode of [null,false,true,{},'enabled','workspace-create-v2']){const result=await f.api(ROOT,{method:'POST',body:creation()},mode);assert.equal(result.status,503);assert.equal(Object.hasOwn(result.data,'receipt'),false);}assert.deepEqual(business(f.db),before);
 const {startTeamServer}=await source('dev-server.mjs');await assert.rejects(startTeamServer({db:f.db,port:0,subscriptionEnforcement:'enabled'}),/Invalid subscription enforcement/);
 await assert.rejects(startTeamServer({db:f.db,port:0,subscriptionEnforcement:'workspace-create-v1',identityProviders:{deviceProofRequired:false}}),/requires strict device/);
 const {handleTeamApplicationRequest}=await source('application-api.mjs');const malformed=await handleTeamApplicationRequest(f.makeRequest(STATUS,{session:f.actor}),{db:f.db,now:()=>f.clock.value,identityProviders:{deviceProofRequired:false},subscriptionEnforcement:'workspace-create-v1'});assert.equal(malformed.status,503);
 const prior=await f.api(ROOT,{method:'POST',body:creation()},'disabled');assert.equal(prior.status,201);assert.equal((await f.api(STATUS,{},'disabled')).data.subscription.enforcementScope,'disabled');
});
test('expiry while a signed body is streaming cannot open the workspace publish path',async t=>{
 const f=await fixture(t),grant=f.term(),before=business(f.db),input=creation(),bytes=Buffer.from(JSON.stringify(input)),entered=deferred(),release=deferred();let pulls=0;
 const stream=new ReadableStream({pull(controller){if(pulls++===0){controller.enqueue(bytes.subarray(0,1));return;}entered.resolve();return release.promise.then(()=>{controller.enqueue(bytes.subarray(1));controller.close();});}});
 t.after(()=>release.resolve());const raw=f.makeRequest(ROOT,{method:'POST',session:f.actor,body:input,bodyStream:stream}),pending=f.api(ROOT,{raw});await entered.promise;f.clock.value=grant.endsAt;release.resolve();
 const result=await pending;assert.equal(result.status,402,JSON.stringify(result.data));assert.deepEqual(business(f.db),before);
});
test('an expired term preserves only already-authorized source read and export of a populated confirmed project',async t=>{
 const {createCompositeFixture}=require('./helpers/cross-module-isolation-fixture.cjs'),f=await createCompositeFixture(t),{handleTeamApplicationRequest}=await source('application-api.mjs'),store=await source('subscription-store.mjs');
 await f.setGrants({source:true});const at=f.clock.value;store.recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:uuid(),expectedRevision:0,startsAt:at-1000,endsAt:at+1000,sourceRef:'synthetic-expired-source-history'},{now:()=>f.clock.value});f.clock.value=at+1000;const before=f.businessSnapshot();
 const request=async(route,actor=f.partner)=>handleTeamApplicationRequest(f.makeRequest(route,{session:actor}),{db:f.db,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true},subscriptionEnforcement:'workspace-create-v1'});
 const status=await request(STATUS);assert.equal((await status.json()).subscription.state,'expired');const read=await request(f.routes.source);assert.equal(read.status,200);assert.deepEqual((await read.json()).source,JSON.parse(f.expected.source.json));
 const exported=await request(f.routes.source+'/export'+f.query('source',f.partner));assert.equal(exported.status,200);assert.equal(Buffer.from(await exported.arrayBuffer()).toString(),f.expected.source.json);
 const intern=await f.ready('intern-a');const denied=await request(f.routes.source,intern);assert.equal(denied.status,404);assert.deepEqual(await denied.json(),{error:{code:'NOT_FOUND',message:'无法访问此资源。'}});assert.deepEqual(f.businessSnapshot(),before);
});
