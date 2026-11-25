'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createProjectAccessFixture,PASSWORD,source}=require('./helpers/project-access-fixture.cjs');
const ROOT='/api/teams/team-a/collection-workspaces',STATUS='/api/teams/team-a/subscription-status';
const input=extra=>({requestId:randomUUID(),title:'业务到期控制合成工作区',read:true,manage:true,review:true,currentPassword:PASSWORD,...extra});
function workspaceRows(db){return Object.fromEntries(['team_projects','team_project_access_projects','team_project_grants','team_project_access_grants','team_collection_workspace_creations'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));}
async function fixture(t){
 const f=await createProjectAccessFixture(t,{register:false}),actor=await f.ready('manager-a'),{handleTeamApplicationRequest}=await source('application-api.mjs'),{recordSubscriptionTerm}=await source('subscription-store.mjs');
 const api=async(route,settings={},mode='business-data-v1',providers={deviceProofRequired:true})=>{const response=await handleTeamApplicationRequest(f.makeRequest(route,{session:actor,...settings}),{db:f.db,now:()=>f.clock.value,identityProviders:providers,subscriptionEnforcement:mode});return{status:response.status,data:await response.json()};};
 const term=()=>recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:0,startsAt:f.clock.value-1000,endsAt:f.clock.value+10000,sourceRef:'synthetic-business-scope'},{now:()=>f.clock.value});
 return{...f,actor,api,term};
}
test('business-data-v1 exposes its exact own scope and preserves active create and expired receipt read',async t=>{
 const f=await fixture(t),initial=workspaceRows(f.db);
 const own=await f.api(STATUS);assert.equal(own.status,200);assert.equal(own.data.subscription.enforcementScope,'business-data-v1');
 assert.equal((await f.api(ROOT,{method:'POST',body:input()})).status,402);assert.deepEqual(workspaceRows(f.db),initial);
 const term=f.term(),body=input(),created=await f.api(ROOT,{method:'POST',body});assert.equal(created.status,201);assert.equal(created.data.receipt.requestId,body.requestId);
 const after=workspaceRows(f.db);f.clock.value=term.endsAt;
 const expired=await f.api(ROOT,{method:'POST',body:input()});assert.equal(expired.status,402);assert.equal(expired.data.error.code,'SUBSCRIPTION_WRITE_UNAVAILABLE');assert.deepEqual(workspaceRows(f.db),after);
 const receipt=await f.api(ROOT+'/receipts/'+body.requestId);assert.equal(receipt.status,200);assert.equal(receipt.data.receipt.projectId,created.data.receipt.projectId);
});
test('business-data-v1 requires server-side strict device pairing before app handling or listener startup',async t=>{
 const f=await fixture(t),before=workspaceRows(f.db),{startTeamServer}=await source('dev-server.mjs');
 for(const providers of [{},{deviceProofRequired:false}]){
  assert.equal((await f.api(ROOT,{method:'POST',body:input()},'business-data-v1',providers)).status,503);
  await assert.rejects(startTeamServer({db:f.db,port:0,identityProviders:providers,subscriptionEnforcement:'business-data-v1'}),/requires strict device proof/);
 }
 assert.deepEqual(workspaceRows(f.db),before);
});
test('headers and payload cannot select a weaker mode and the original role denial precedes expiry',async t=>{
 const f=await fixture(t),before=workspaceRows(f.db);
 const forged=await f.api(ROOT,{method:'POST',body:input(),headers:{'x-subscription-enforcement':'disabled','x-subscription-state':'active'}});assert.equal(forged.status,402);
 const intern=await f.ready('intern-a');assert.equal((await f.api(ROOT,{method:'POST',session:intern,body:input()})).status,404);
 assert.deepEqual(workspaceRows(f.db),before);
 f.term();const injected=await f.api(ROOT,{method:'POST',body:input({subscriptionEnforcement:'disabled'})});assert.equal(injected.status,400);assert.deepEqual(workspaceRows(f.db),before);
});
test('existing local preview and workspace-only scopes retain their explicit behavior',async t=>{
 const f=await fixture(t);
 const legacy=await f.api(ROOT,{method:'POST',body:input()},'disabled');assert.equal(legacy.status,201);
 assert.equal((await f.api(STATUS,{},'disabled')).data.subscription.enforcementScope,'disabled');
 assert.equal((await f.api(ROOT,{method:'POST',body:input()},'workspace-create-v1')).status,402);
 assert.equal((await f.api(STATUS,{},'workspace-create-v1')).data.subscription.enforcementScope,'workspace-create-v1');
});
