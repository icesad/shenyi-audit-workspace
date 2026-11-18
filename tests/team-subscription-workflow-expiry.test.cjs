'use strict';
const {test:nodeTest,after}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const test=(name,run)=>nodeTest(name,{timeout:60000},run);
const {syncBuiltinESMExports}=require('node:module');
// Hold only after the actual native scrypt callback computes its unchanged result.
const nativeScrypt=crypto.scrypt;let nextHold;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
crypto.scrypt=function(...args){const callback=args.pop(),hold=nextHold;nextHold=undefined;return nativeScrypt(...args,(error,value)=>{if(!hold)return callback(error,value);hold.entered.resolve();void hold.release.promise.then(()=>callback(error,value));});};syncBuiltinESMExports();after(()=>{crypto.scrypt=nativeScrypt;syncBuiltinESMExports();});
const {workflowFixture,PASSWORD}=require('./helpers/subscription-workflow-expiry-fixture.cjs');
const kinds=['submission','return','task','formalization','migration'];
for(const kind of kinds)test(kind+' permits its normal authorized write during the active term',async t=>{const f=await workflowFixture(t,kind);f.term();const before=f.business(),r=await f.run(f.operation);assert.equal(r.status,f.operation.status,JSON.stringify(r.data));assert.notDeepEqual(f.business(),before);});
for(const state of ['missing','expired'])for(const kind of kinds)test(kind+' '+state+' subscription publishes no business change',async t=>{const f=await workflowFixture(t,kind);if(state==='expired')f.term({startsAt:f.clock.value-2000,endsAt:f.clock.value});const before=f.business(),r=await f.run(f.operation);assert.equal(r.status,402,JSON.stringify(r.data));assert.equal(r.data.error.code,'SUBSCRIPTION_WRITE_UNAVAILABLE');assert.deepEqual(f.business(),before);});
for(const kind of kinds)test(kind+' expiry while the real signed body is held cannot publish',async t=>{
 const f=await workflowFixture(t,kind),term=f.term(),before=f.business(),entered=deferred(),release=deferred(),bytes=Buffer.from(JSON.stringify(f.operation.body));let pulls=0;
 const stream=new ReadableStream({pull(controller){if(pulls++===0){controller.enqueue(bytes.subarray(0,1));return;}entered.resolve();return release.promise.then(()=>{controller.enqueue(bytes.subarray(1));controller.close();});}});t.after(()=>release.resolve());
 const raw=f.makeRequest(f.operation.route,{method:'POST',session:f.operation.actor,body:f.operation.body,bodyStream:stream}),pending=f.run(f.operation,{raw});await entered.promise;f.clock.value=term.endsAt;release.resolve();const r=await pending;assert.equal(r.status,402,JSON.stringify(r.data));assert.deepEqual(f.business(),before);
});
for(const change of ['expiry','revision','clock-rollback'])for(const kind of ['formalization','migration'])test(kind+' real password work rechecks '+change,async t=>{
 const f=await workflowFixture(t,kind),term=f.term(),before=f.business(),hold={entered:deferred(),release:deferred()};assert.equal(nextHold,undefined);nextHold=hold;t.after(()=>{nextHold=undefined;hold.release.resolve();});
 const pending=f.run(f.operation);await hold.entered.promise;
 if(change==='expiry')f.clock.value=term.endsAt;else if(change==='revision')f.term({expectedRevision:1,startsAt:term.startsAt,endsAt:term.endsAt+1000});else f.clock.value-=1;
 hold.release.resolve();const r=await pending;assert.equal(r.status,change==='expiry'?402:409,JSON.stringify(r.data));assert.deepEqual(f.business(),before);
});
for(const kind of kinds)test(kind+' final transaction expiry rolls back its last business row and prior writes',async t=>{
 const f=await workflowFixture(t,kind),term=f.term(),before=f.business(),prepare=f.db.prepare.bind(f.db);let reached=0;
 t.mock.method(f.db,'prepare',function(sql,...args){const s=prepare(sql,...args);if(sql.includes(f.operation.marker)){const run=s.run.bind(s);s.run=(...values)=>{const r=run(...values);reached++;f.clock.value=term.endsAt;return r;};}return s;});
 const r=await f.run(f.operation);assert.equal(reached,1);assert.equal(r.status,402,JSON.stringify(r.data));assert.deepEqual(f.business(),before);
});
for(const kind of kinds)test(kind+' active subscription does not grant missing role or cross-team authority',async t=>{
 const f=await workflowFixture(t,kind);f.term();const before=f.business(),users=kind==='submission'?['manager-a','intern-b']:kind==='migration'?['manager-a','manager-b']:['intern-a','manager-b'];
 for(const user of users){const actor=await f.ready(user),r=await f.run({...f.operation,actor});assert.equal(r.status,404,user+JSON.stringify(r.data));}assert.deepEqual(f.business(),before);
});
for(const kind of kinds)test(kind+' keeps the previous workspace-create-only enforcement scope bounded',async t=>{const f=await workflowFixture(t,kind),r=await f.run(f.operation,{mode:'workspace-create-v1'});assert.equal(r.status,f.operation.status,JSON.stringify(r.data));});
test('expired collection preserves own submission history and project review GET/HEAD permissions',async t=>{
 const f=await workflowFixture(t,'submission'),term=f.term(),made=await f.run(f.operation);assert.equal(made.status,201);f.clock.value=term.endsAt;const before=f.business();
 const own=await f.read('/api/teams/team-a/collection/tasks/task-a/submissions',f.intern);assert.equal(own.status,200);assert.equal(own.data.submissions[0].id,made.data.submission.id);
 const reviewRoute='/api/teams/team-a/projects/project-a/tasks/task-a/submissions',review=await f.read(reviewRoute);assert.equal(review.status,200);assert.equal(review.data.submissions[0].id,made.data.submission.id);
 const {handleTeamApplicationRequest}=await require('./helpers/subscription-workflow-expiry-fixture.cjs').source('application-api.mjs');const file=reviewRoute+'/'+made.data.submission.id+'/file';for(const method of ['GET','HEAD']){const r=await handleTeamApplicationRequest(f.makeRequest(file,{method,session:f.actor}),{db:f.db,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true},subscriptionEnforcement:'business-data-v1'});assert.equal(r.status,200);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.length,method==='HEAD'?0:Buffer.from(f.operation.body.contentBase64,'base64').length);}assert.deepEqual(f.business(),before);
});
test('expired migration preserves the original reviewer receipt',async t=>{const f=await workflowFixture(t,'migration'),term=f.term(),made=await f.run(f.operation);assert.equal(made.status,201);f.clock.value=term.endsAt;const before=f.business(),receipt=await f.read('/api/project-migrations/receipts/'+f.operation.body.requestId);assert.equal(receipt.status,200);assert.equal(receipt.data.requestId??receipt.data.receipt?.requestId,f.operation.body.requestId);assert.deepEqual(f.business(),before);});
test('expired task assignment remains outside this business-write slice',async t=>{const f=await workflowFixture(t,'task');f.term({startsAt:f.clock.value-1000,endsAt:f.clock.value});const r=await f.run({route:'/api/teams/team-a/collection/tasks/task-a/assignment',actor:f.actor,body:{revision:0,userId:'assistant-a'}});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(f.db.prepare("SELECT status FROM team_task_assignments WHERE team_id='team-a' AND task_id='task-a' AND user_id='assistant-a'").get().status,'active');});
test('scheduled term refuses an otherwise authorized task create',async t=>{const f=await workflowFixture(t,'task');f.term({startsAt:f.clock.value+1,endsAt:f.clock.value+10000});const before=f.business(),r=await f.run(f.operation);assert.equal(r.status,402);assert.deepEqual(f.business(),before);});
