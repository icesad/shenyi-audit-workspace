'use strict';
const {test:nativeTest,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
// This fixture installs the hold before passwords.mjs captures native scrypt.
const {createWorkspaceSourceFixture,PASSWORD,source,restorePasswordWork}=require('./helpers/workspace-source-fixture.cjs');
after(restorePasswordWork);
const test=(name,run)=>nativeTest(name,{timeout:60000},run);
const TEAM='team-a',MODE='team-management-v1';
async function fixture(t,{formalized=false}={}){
 const f=await createWorkspaceSourceFixture(t);
 if(formalized)assert.equal((await f.confirm()).status,201);
 const {handleTeamApplicationRequest}=await source('application-api.mjs'),{recordSubscriptionTerm}=await source('subscription-store.mjs');
 const base='/api/teams/'+TEAM+'/projects/'+f.projectId,sourceBase=base+'/initiation-source';
 const api=async(path,settings={},mode=MODE,providers={deviceProofRequired:true})=>{const r=await handleTeamApplicationRequest(f.makeRequest(path,{session:f.actor,...settings}),{db:f.db,now:()=>f.clock.value,identityProviders:providers,subscriptionEnforcement:mode});return{status:r.status,data:await r.json()};};
 function term(kind='active'){
  if(kind==='unconfigured')return null;
  const at=f.clock.value,revision=Number(f.db.prepare('SELECT revision FROM team_subscription_heads WHERE team_id=?').get(TEAM)?.revision??0);
  return recordSubscriptionTerm(f.db,{teamId:TEAM,operationId:randomUUID(),expectedRevision:revision,startsAt:kind==='scheduled'?at+1000:at-2000,endsAt:kind==='expired'?at-1000:at+10000,sourceRef:'synthetic-management-term'},{now:()=>f.clock.value});
 }
 const projectBody=(extra={})=>({revision:f.revision(f.projectId),userId:'partner-a',memberRevision:f.epoch('partner-a'),read:true,manage:false,review:false,currentPassword:PASSWORD,...extra});
 const sourceBody=(extra={})=>({projectRevision:f.revision(f.projectId),userId:f.user,memberRevision:f.epoch(f.user),grantRevision:Number(f.db.prepare('SELECT revision FROM team_workspace_source_grants WHERE team_id=? AND project_id=? AND user_id=?').get(TEAM,f.projectId,extra.userId??f.user)?.revision??0),read:true,export:false,currentPassword:PASSWORD,...extra});
 const projectGrant=(flags={},mode=MODE)=>api(base+'/access',{method:'POST',body:projectBody(flags)},mode);
 const sourceGrant=(flags={},mode=MODE)=>api(sourceBase+'/access',{method:'POST',body:sourceBody(flags)},mode);
 async function task(){const r=await f.createTask(f.actor,{projectId:f.projectId});assert.equal(r.status,201);return r.data.task.id;}
 const taskRevision=id=>Number(f.db.prepare('SELECT revision FROM team_task_versions WHERE team_id=? AND task_id=?').get(TEAM,id)?.revision??0);
 const assign=(id,userId,mode=MODE)=>api('/api/teams/'+TEAM+'/collection/tasks/'+id+'/assignment',{method:'POST',body:{revision:taskRevision(id),userId}},mode);
 return{...f,base,sourceBase,api,term,projectBody,sourceBody,projectGrant,sourceGrant,task,taskRevision,assign};
}
function business(f){
 const omitted=new Set(['team_auth_limits','team_device_request_replays','team_device_usage','team_subscription_events','team_subscription_heads']);
 return f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().filter(x=>!omitted.has(x.name)).map(({name})=>{
  const q=f.db.prepare('SELECT * FROM "'+name+'"');q.setReadBigInts(true);
  return{name,rows:q.all().map(row=>JSON.stringify(Object.entries(row).map(([key,v])=>[key,v===null?['null']:typeof v==='bigint'?['integer',String(v)]:v instanceof Uint8Array?['blob',Buffer.from(v).toString('base64')]:[typeof v,v]]))).sort()};
 });
}
async function unavailable(f,work){const before=business(f),r=await work();assert.equal(r.status,402,JSON.stringify(r.data));assert.equal(r.data.error.code,'SUBSCRIPTION_WRITE_UNAVAILABLE');assert.deepEqual(business(f),before);}
function afterInsert(f,prefix,work){
 const prepare=f.db.prepare.bind(f.db);let witnessed=false;
 f.db.prepare=function(sql,...args){const statement=prepare(sql,...args);if(!sql.startsWith(prefix))return statement;const run=statement.run.bind(statement);statement.run=(...values)=>{const result=run(...values);if(!witnessed){witnessed=true;work();}return result;};return statement;};
 return{restore(){f.db.prepare=prepare;},witnessed:()=>witnessed};
}
test('new management mode keeps strict configuration, exact own status and the original business create guard',async t=>{
 const f=await fixture(t),status='/api/teams/'+TEAM+'/subscription-status';assert.equal((await f.api(status)).data.subscription.enforcementScope,MODE);
 const body=()=>({requestId:randomUUID(),title:'M5C synthetic workspace',read:true,manage:true,review:true,currentPassword:PASSWORD});
 await unavailable(f,()=>f.api('/api/teams/'+TEAM+'/collection-workspaces',{method:'POST',body:body()}));
 const {startTeamServer}=await source('dev-server.mjs');await assert.rejects(startTeamServer({db:f.db,port:0,identityProviders:{deviceProofRequired:false},subscriptionEnforcement:MODE}),/requires strict device/);
 assert.equal((await f.api(status,{},MODE,{deviceProofRequired:false})).status,503);
 const term=f.term();assert.equal((await f.api('/api/teams/'+TEAM+'/collection-workspaces',{method:'POST',body:body()})).status,201);f.clock.value=term.endsAt;await unavailable(f,()=>f.api('/api/teams/'+TEAM+'/collection-workspaces',{method:'POST',body:body()}));
});
test('management mode also enforces the shared business-data guard on task creation',async t=>{
 const f=await fixture(t),create=()=>f.api(f.base+'/tasks',{method:'POST',body:{revision:f.revision(f.projectId),title:'Inherited business guard',instructions:'Synthetic task instructions'}});
 await unavailable(f,create);const term=f.term();assert.equal((await create()).status,201);f.clock.value=term.endsAt;await unavailable(f,create);
});
test('project active grants work and a mixed increase/revocation is refused after expiry',async t=>{
 const f=await fixture(t),term=f.term();assert.equal((await f.projectGrant({read:true,manage:false,review:true})).status,200);f.clock.value=term.endsAt;
 await unavailable(f,()=>f.projectGrant({read:true,manage:true,review:false}));assert.equal((await f.projectGrant({read:true,manage:false,review:false})).status,200);
 await unavailable(f,()=>f.projectGrant({read:true,manage:false,review:true}));assert.equal((await f.projectGrant({read:false,manage:false,review:false})).status,200);
});
for(const kind of ['unconfigured','scheduled','expired'])test(kind+' permits project revocation but cannot restore a flag',async t=>{
 const f=await fixture(t);assert.equal((await f.projectGrant({read:true,manage:true,review:true},'disabled')).status,200);f.term(kind);
 assert.equal((await f.projectGrant({read:true,manage:false,review:true})).status,200);await unavailable(f,()=>f.projectGrant({read:true,manage:true,review:false}));
 assert.equal((await f.projectGrant({read:false,manage:false,review:false})).status,200);
});
test('source active independent flags and expiry preserve latent assigned export while reducing read',async t=>{
 const f=await fixture(t,{formalized:true}),term=f.term();assert.equal((await f.sourceGrant({read:true,export:true})).status,200);assert.equal((await f.api(f.sourceBase)).status,200);f.clock.value=term.endsAt;
 assert.equal((await f.sourceGrant({read:false,export:true})).status,200);const grant=f.db.prepare('SELECT can_read,can_export,eligible FROM team_workspace_source_grants WHERE team_id=? AND project_id=? AND user_id=?').get(TEAM,f.projectId,f.user);assert.equal(grant.can_read,0);assert.equal(grant.can_export,1);assert.equal(grant.eligible,1);assert.equal((await f.api(f.sourceBase)).status,404);
 await unavailable(f,()=>f.sourceGrant({read:true,export:false}));assert.equal((await f.sourceGrant({read:false,export:false})).status,200);await unavailable(f,()=>f.sourceGrant({read:false,export:true}));
});
for(const kind of ['unconfigured','scheduled','expired'])test(kind+' source grant cannot preinstall an export bit and still permits actual withdrawal',async t=>{
 const f=await fixture(t);assert.equal((await f.sourceGrant({read:true,export:false},'disabled')).status,200);f.term(kind);
 await unavailable(f,()=>f.sourceGrant({read:false,export:true}));assert.equal((await f.sourceGrant({read:false,export:false})).status,200);
});
test('ineligible retained source bits cannot be reactivated without a subscription',async t=>{
 const f=await fixture(t);assert.equal((await f.sourceGrant({read:true,export:true},'disabled')).status,200);f.db.prepare('UPDATE team_workspace_source_grants SET eligible=0,revision=revision+1 WHERE team_id=? AND project_id=? AND user_id=?').run(TEAM,f.projectId,f.user);
 await unavailable(f,()=>f.sourceGrant({read:true,export:true}));assert.equal((await f.sourceGrant({read:false,export:false})).status,200);
});
for(const domain of ['project','source'])for(const change of ['expiry','revision'])test(domain+' increase rechecks after actual native password work: '+change,async t=>{
 const f=await fixture(t),term=f.term(),before=business(f),hold=f.passwordHold(),pending=domain==='project'?f.projectGrant({read:true,manage:true,review:true}):f.sourceGrant({read:true,export:true});
 await hold.entered.promise;if(change==='expiry')f.clock.value=term.endsAt;else f.term();hold.release.resolve();const r=await pending;assert.equal(r.status,change==='expiry'?402:409,JSON.stringify(r.data));assert.deepEqual(business(f),before);
});
test('pure source revocation survives a billing revision and expiry during native password work',async t=>{
 const f=await fixture(t);f.term();assert.equal((await f.sourceGrant({read:true,export:true})).status,200);const hold=f.passwordHold(),pending=f.sourceGrant({read:false,export:true});await hold.entered.promise;const next=f.term();f.clock.value=next.endsAt;hold.release.resolve();assert.equal((await pending).status,200);const q=f.db.prepare('SELECT can_read,can_export FROM team_workspace_source_grants WHERE team_id=? AND project_id=? AND user_id=?').get(TEAM,f.projectId,f.user);assert.equal(q.can_read,0);assert.equal(q.can_export,1);
});
for(const domain of ['project','source'])test(domain+' late actual audit insert expiry rolls back all business rows',async t=>{
 const f=await fixture(t),term=f.term(),before=business(f),hook=afterInsert(f,domain==='project'?'INSERT INTO team_project_access_events':'INSERT INTO team_workspace_source_events',()=>{f.clock.value=term.endsAt;});
 try{const r=domain==='project'?await f.projectGrant({read:true,manage:true,review:true}):await f.sourceGrant({read:true,export:true});assert.equal(r.status,402,JSON.stringify(r.data));assert.equal(hook.witnessed(),true);assert.deepEqual(business(f),before);}finally{hook.restore();}
});
test('task new assignee needs an active term and expiry cannot replace it with a new person',async t=>{
 const f=await fixture(t),id=await f.task();await unavailable(f,()=>f.assign(id,'intern-a'));const term=f.term();assert.equal((await f.assign(id,'intern-a')).status,200);f.clock.value=term.endsAt;await unavailable(f,()=>f.assign(id,'assistant-a'));
 // Retaining the current assignee adds no authority; original version checks still apply.
 assert.equal((await f.assign(id,'intern-a')).status,200);
});
test('expired task assignment uses membership in the complete existing set, not the first51 UI rows',async t=>{
 const f=await fixture(t),id=await f.task(),ids=[];for(let i=0;i<65;i++){const user=f.addMember('bulk-'+String(i).padStart(2,'0'),{role:'intern'});ids.push(user);f.db.prepare("INSERT INTO team_task_assignments VALUES (?,?,?,'active')").run(TEAM,id,user);}
 f.term('expired');assert.equal((await f.assign(id,ids[64])).status,200);const remaining=f.db.prepare("SELECT user_id FROM team_task_assignments WHERE team_id=? AND task_id=? AND status='active'").all(TEAM,id);assert.deepEqual(remaining.map(x=>x.user_id),[ids[64]]);
});
test('assignment last audit expiry rolls back target grant, task revision and audit together',async t=>{
 const f=await fixture(t),id=await f.task(),term=f.term(),before=business(f),hook=afterInsert(f,'INSERT INTO team_activity',()=>{f.clock.value=term.endsAt;});try{const r=await f.assign(id,'intern-a');assert.equal(r.status,402,JSON.stringify(r.data));assert.equal(hook.witnessed(),true);assert.deepEqual(business(f),before);}finally{hook.restore();}
});
test('original ownership, target team and assignee role checks precede subscription refusal',async t=>{
 const f=await fixture(t),id=await f.task(),partner=await f.ready('partner-a'),before=business(f);assert.equal((await f.api(f.base+'/access',{method:'POST',session:partner,body:f.projectBody()})).status,404);assert.equal((await f.sourceGrant({userId:'manager-b',memberRevision:f.epoch('manager-b')})).status,404);assert.equal((await f.assign(id,'manager-b')).status,404);assert.deepEqual(business(f),before);
});
test('old partial modes retain their explicit management boundary',async t=>{
 const f=await fixture(t),id=await f.task();assert.equal((await f.projectGrant({read:true,manage:true,review:true},'business-data-v1')).status,200);assert.equal((await f.sourceGrant({read:true,export:true},'workspace-create-v1')).status,200);assert.equal((await f.assign(id,'intern-a','business-data-v1')).status,200);
});
