'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {fixture,PASSWORD,sha,restorePasswordWork}=require('./helpers/workpaper-http-resume-fixture.cjs');
const {createWorkpaperSourceManager}=require('../desktop/workpaper-source.cjs');
after(restorePasswordWork);
const connection='/api/auth/devices/connection';
const postCount=(f,suffix)=>f.state.wire.filter(c=>c.method==='POST'&&c.route.endsWith(suffix)).length;
const headCount=f=>f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_heads').get().n;
const stage=(f,id)=>f.db.prepare('SELECT status,lease_id,session_hash FROM team_workpaper_data_imports WHERE request_id=?').get(id);
async function selectedSource(t,f){
 const manager=createWorkpaperSourceManager({client:f.client,dialog:{async showOpenDialog(){return{canceled:false,filePaths:[f.filename]};}}});t.after(()=>manager.dispose());
 const selected=await manager.chooseWorkpaperSource(f.revisions());
 assert.equal(selected.packageSha256,sha(f.bytes));
 const confirmation=()=>({...f.revisions(),handle:selected.handle,packageSha256:selected.packageSha256,currentPassword:PASSWORD,sourceVerified:true,confirmed:true});
 return{manager,selected,confirmation};
}
function assertActualSignedHTTP(f){
 assert.ok(f.state.wire.length>0);assert.ok(f.state.calls.length>0);
 const availableWire=[...f.state.wire];
 for(const event of f.state.calls){assert.equal(event.realFetchInvoked,true);assert.equal(event.origin,f.address);assert.notEqual(event.responseReplacedByHook,true);const at=availableWire.findIndex(x=>x.method===event.method&&x.route===event.route);assert.ok(at>=0,'every real fetch has an observed request at the owned listener');availableWire.splice(at,1);if(event.status!==undefined){assert.equal(event.responseURL,f.address+event.route);assert.equal(event.responseServerId,f.serverId);}}
 assert.equal(availableWire.length,0);
 const signed=f.state.wire.filter(x=>x.hasLease);assert.ok(signed.length>0);
 for(const event of signed){assert.equal(event.hasAuthorization,true);assert.equal(event.hasSignature,true);assert.equal(event.hasNonce,true);assert.equal(event.localPort,new URL(f.address).port*1);assert.equal(event.remoteAddress,'127.0.0.1');}
}

test('actual HTTP business429 preserves the original signed source and lease until explicit same-ID resume',async t=>{
 const f=await fixture(t),s=await selectedSource(t,f);await f.fillBusinessTo(117);
 const epoch=f.client.getDeviceStatus().epoch,first=await s.manager.confirmWorkpaperImport(s.confirmation());
 assert.deepEqual(first,{status:'paused',requestId:s.selected.handle,phase:'chunk'});assert.equal(f.businessAttempts(),120);
 const before={...stage(f,s.selected.handle)};assert.equal(before.status,'active');assert.equal(headCount(f),0);
 assert.equal(f.state.wire.findLast(x=>x.method==='PUT').status,429);
 await f.client.checkDeviceConnection();assert.equal(f.client.getDeviceStatus().state,'ready');assert.equal(f.client.getDeviceStatus().epoch,epoch);
 assert.equal(f.state.wire.findLast(x=>x.route===connection).status,200);assert.deepEqual({...stage(f,s.selected.handle)},before);
 assert.equal(postCount(f,'/imports'),1);assert.equal(postCount(f,'/commit'),0);
 f.clock.value+=60001;await f.client.checkDeviceConnection();assert.equal(f.client.getDeviceStatus().epoch,epoch);
 const query=await s.manager.queryWorkpaperImport({...f.target,requestId:s.selected.handle});assert.equal(query.status,'active');assert.equal(postCount(f,'/commit'),0);
 const result=await s.manager.resumeWorkpaperImport(s.confirmation());assert.equal(result.status,'imported');assert.equal(result.requestId,s.selected.handle);assert.equal(result.receipt.sourcePackageSha256,s.selected.packageSha256);
 const published={...stage(f,s.selected.handle)};assert.equal(published.status,'published');assert.equal(published.lease_id,before.lease_id);assert.equal(published.session_hash,before.session_hash);
 assert.equal(f.client.getDeviceStatus().epoch,epoch);assert.equal(headCount(f),1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_chunks').get().n,0);
 assert.equal(postCount(f,'/imports'),1);assert.equal(postCount(f,'/commit'),1);
 const saved=await f.client.getWorkpaperRecord({...f.revisions(),version:1});assert.equal(saved.record.answers[f.document.sha256]['原表'].A2,'saved valid original sheet answer');
 const form=await f.client.getWorkpaperForm({...f.revisions(),version:1,sha256:f.document.sha256});assert.equal(form.form.kind,'excel');assert.ok(form.form.sheets.find(x=>x.name==='原表').cells.C1.f);
 assertActualSignedHTTP(f);await f.recordEvidence({case:'business429_same_ID_resume',originalID:s.selected.handle,businessAttemptsAtPause:120,heartbeatStatus:200,sameLeaseAndSession:true,sameEpoch:true,beginCount:1,commitCount:1,headCount:1,validOfficeRead:true});
});

test('actual TCP response loss after commit remains unknown until a fresh lease queries the original receipt without POST replay',async t=>{
 const f=await fixture(t),s=await selectedSource(t,f),epoch=f.client.getDeviceStatus().epoch;
 f.state.dropCommitResponseOnce=true;const result=await s.manager.confirmWorkpaperImport(s.confirmation());
 assert.deepEqual(result,{status:'unknown',requestId:s.selected.handle,phase:'commit'});assert.equal(headCount(f),1);assert.equal(stage(f,s.selected.handle).status,'published');
 const dropped=f.state.wire.find(x=>x.responseDroppedAfterCommit);assert.ok(dropped);await f.waitForWireClose(dropped);assert.equal(dropped.headCountBeforeDrop,1);assert.equal(dropped.finished,false);assert.equal(dropped.closed,true);assert.equal(Object.hasOwn(dropped,'status'),false);
 assert.equal(f.client.getDeviceStatus().state,'paused');assert.ok(f.client.getDeviceStatus().epoch>epoch);assert.equal(postCount(f,'/imports'),1);assert.equal(postCount(f,'/commit'),1);
 await assert.rejects(s.manager.resumeWorkpaperImport(s.confirmation()),{code:'WORKPAPER_SOURCE_CHANGED'});assert.equal(postCount(f,'/commit'),1);
 await f.client.checkDeviceConnection();assert.equal(f.client.getDeviceStatus().state,'ready');
 const receipt=await s.manager.queryWorkpaperImport({...f.target,requestId:s.selected.handle});assert.equal(receipt.status,'imported');assert.equal(receipt.receipt.sourcePackageSha256,s.selected.packageSha256);
 assert.equal(postCount(f,'/imports'),1);assert.equal(postCount(f,'/commit'),1);assert.equal(headCount(f),1);
 assertActualSignedHTTP(f);await f.recordEvidence({case:'real_socket_drop_after_commit',originalID:s.selected.handle,dropLayer:'own HTTP response socket destroyed before end after application commit',headCountBeforeDrop:1,dropFinished:false,dropClosed:true,knownImportedOnlyAfterFreshReceiptQuery:true,beginCount:1,commitCount:1,headCount:1});
});

test('actual HTTP control25th429 pauses the device and clears private continuation while leaving its remote stage unpublished',async t=>{
 const f=await fixture(t),s=await selectedSource(t,f);await f.fillBusinessTo(117);
 assert.equal((await s.manager.confirmWorkpaperImport(s.confirmation())).status,'paused');const epoch=f.client.getDeviceStatus().epoch,before={...stage(f,s.selected.handle)};
 for(let n=0;n<24;n++){await f.client.checkDeviceConnection();assert.equal(f.client.getDeviceStatus().state,'ready');assert.equal(f.client.getDeviceStatus().epoch,epoch);}
 await assert.rejects(f.client.checkDeviceConnection(),{code:'HTTP_429'});assert.equal(f.client.getDeviceStatus().state,'paused');assert.ok(f.client.getDeviceStatus().epoch>epoch);
 const heartbeats=f.state.wire.filter(x=>x.route===connection);assert.equal(heartbeats.length,25);assert.equal(heartbeats.filter(x=>x.status===200).length,24);assert.equal(heartbeats.at(-1).status,429);
 assert.deepEqual(s.manager.discardWorkpaperSource({handle:s.selected.handle}),{discarded:false});await assert.rejects(s.manager.resumeWorkpaperImport(s.confirmation()),{code:'WORKPAPER_SOURCE_CHANGED'});
 assert.deepEqual({...stage(f,s.selected.handle)},before);assert.equal(headCount(f),0);assert.equal(postCount(f,'/imports'),1);assert.equal(postCount(f,'/commit'),0);
 assertActualSignedHTTP(f);await f.recordEvidence({case:'control25th429_fail_closed',originalID:s.selected.handle,acceptedHeartbeats:24,rejectedHeartbeat:429,devicePaused:true,privateContinuationCleared:true,remoteStageUnchanged:true,beginCount:1,commitCount:0,headCount:0});
});
