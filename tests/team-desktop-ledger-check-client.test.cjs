'use strict';
// Actual main TeamClient + signed Request application boundary, not TCP/native UI.
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {fixture,PASSWORD,savedSnapshot,uuid,sha,deferred,metadata,restorePasswordWork}=require('./helpers/ledger-check-client-fixture.cjs');
const {ledgerTransportValid,ledgerCheckInput}=require('../desktop/ledger-check-client.cjs');
after(restorePasswordWork);
const invalid=e=>Object.assign(Error(e),{code:e});

test('normal client grants independent read then imports, lists and reads the exact saved record without professional writes',async t=>{
 const f=await fixture(t,{grant:false}),a=await f.access();assert.equal(a.read,false);assert.equal(Object.hasOwn(a,'headRevision'),false);assert.equal(Object.hasOwn(a,'sourceProjectId'),false);assert.equal(a.canManageAccess,true);
 const projects=await f.client.listLedgerCheckProjects({teamId:'team-a'});assert.deepEqual(projects.projects.map(p=>p.id),[f.projectId]);await assert.rejects(f.client.listLedgerCheckSnapshots(f.target),{code:'HTTP_404'});
 await f.change(true);const members=await f.client.listLedgerCheckMembers(f.target);assert.equal(members.members.find(m=>m.id==='manager-a').read,true);
 const {input,receipt}=await f.importing(),list=await f.client.listLedgerCheckSnapshots(f.target);assert.equal(list.headRevision,1);assert.equal(list.snapshots[0].sourceSha256,sha(input.sourceJson));
 const saved=await f.client.getLedgerCheckSnapshot(await f.readInput(receipt.snapshotId));assert.deepEqual(saved.snapshot,JSON.parse(input.sourceJson));assert.equal(saved.metadata.sourceSha256,receipt.sourceSha256);assert.equal(Object.hasOwn(saved,'bytes'),false);
 assert.deepEqual(await f.client.getLedgerCheckImportReceipt({...f.target,operationId:input.operationId}),receipt);
 await assert.rejects(f.client.getWorkspaceSource(f.target),{code:'HTTP_404'});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_material_records').get().n,0);
 assert.equal(f.state.calls.filter(c=>c.route===f.root+'/imports'&&c.settings.method==='POST').length,1);assert.ok(f.state.calls.every(c=>!c.route.endsWith('/run')&&!c.route.endsWith('/calculate')));
});

test('input descriptors, extra fields, MAX increments and nonexplicit confirmations are rejected before dispatch',()=>{
 const base={teamId:'team-a',projectId:uuid()},change={...base,projectRevision:1,userId:'manager-a',memberRevision:0,grantRevision:0,read:true,currentPassword:PASSWORD,confirmed:true};
 for(const [value,kind]of [[{...base,role:'partner'},'access'],[{...change,confirmed:false},'change'],[{...change,grantRevision:Number.MAX_SAFE_INTEGER},'change'],[{...base,after:0},'history'],[{...base,after:'1'},'history'],[{...base,snapshotId:uuid(),projectRevision:1,grantRevision:0},'snapshot']])assert.throws(()=>ledgerCheckInput(value,kind,invalid),{code:'INVALID_INPUT'});
 let reads=0;const accessor={...base};Object.defineProperty(accessor,'teamId',{enumerable:true,get(){reads++;return'team-a';}});assert.throws(()=>ledgerCheckInput(accessor,'access',invalid));assert.equal(reads,0);
});

test('private response-size capability only accepts exact ledger paths and snapshot versions',()=>{
 const root='/api/teams/team-a/projects/'+uuid()+'/ledger-checks',snapshot=root+'/snapshots/'+uuid()+'?projectRevision=1&grantRevision=1';
 assert.equal(ledgerTransportValid(snapshot,{method:'GET',binary:true,snapshot:true}),true);
 for(const route of [snapshot+'&extra=1',snapshot.replace('projectRevision=1','projectRevision=01'),root+'/run',root.replace('ledger-checks','materials')])assert.equal(ledgerTransportValid(route,{method:'GET',binary:true,snapshot:true}),false);
 assert.equal(ledgerTransportValid(root+'/imports',{method:'POST',binary:false,body:{},snapshot:false}),true);assert.equal(ledgerTransportValid(root+'/imports?extra=1',{method:'POST',binary:false,body:{},snapshot:false}),false);
});

test('only snapshot import and download extend the signed transport deadline', async t => {
 const f = await fixture(t, {grant:false});
 const nativeTimeout = AbortSignal.timeout;
 const timeoutBySignal = new WeakMap();
 t.mock.method(AbortSignal, 'timeout', milliseconds => {
  const signal = nativeTimeout(milliseconds);
  timeoutBySignal.set(signal, milliseconds);
  return signal;
 });

 await f.change(true);
 const {input, receipt} = await f.importing();
 await f.client.getLedgerCheckImportReceipt({...f.target, operationId:input.operationId});
 await f.client.listLedgerCheckSnapshots(f.target);
 await f.client.getLedgerCheckSnapshot(await f.readInput(receipt.snapshotId));

 const calls = f.state.calls.filter(call => call.route.startsWith(f.root) && timeoutBySignal.has(call.settings.signal));
 const bulk = calls.filter(call => call.route === f.root + '/imports' || call.route.startsWith(f.root + '/snapshots/'));
 assert.deepEqual(bulk.map(call => [call.settings.method, timeoutBySignal.get(call.settings.signal)]), [['POST', 90000], ['GET', 90000]]);
 const controls = calls.filter(call => !bulk.includes(call));
 assert.ok(controls.some(call => call.route === f.root + '/access' && call.settings.method === 'POST'));
 assert.ok(controls.some(call => call.route === f.root + '/imports/' + input.operationId));
 assert.ok(controls.some(call => call.route === f.root && call.settings.method === 'GET'));
 assert.ok(controls.every(call => timeoutBySignal.get(call.settings.signal) === 15000));
});

test('password failure preserves existing history and a second explicit import appends a new version',async t=>{
 const f=await fixture(t),input=await f.importInput();await assert.rejects(f.client.importLedgerCheckSnapshot({...input,currentPassword:'wrong'}),{code:'HTTP_403'});assert.equal(f.moduleRows()[3].rows.length,0);
 const first=await f.client.importLedgerCheckSnapshot(input),second=await f.importing();assert.equal(first.version,1);assert.equal(second.receipt.version,2);assert.equal((await f.client.listLedgerCheckSnapshots({...f.target,limit:1})).hasMore,true);
 const old=await f.client.listLedgerCheckSnapshots({...f.target,after:2,limit:1});assert.equal(old.snapshots[0].id,first.snapshotId);
});

test('snapshot headers, byte hashes and Q binding are checked before returning a readonly DTO',async t=>{
 const f=await fixture(t),{receipt}=await f.importing(),input=await f.readInput(receipt.snapshotId);
 for(const [header,value]of [['X-Shenyi-Ledger-Sha256','a'.repeat(64)],['X-Shenyi-Ledger-Snapshot-Id',uuid()],['X-Shenyi-Ledger-Version','01'],['X-Shenyi-Ledger-Source-Project-Id',uuid()],['X-Shenyi-Ledger-Grant-Revision','2'],['Content-Type','text/html'],['Content-Length','1'],['Cache-Control','public, max-age=100']]){
  f.state.after=(call,r)=>{if(call.route!==f.root+'/snapshots/'+receipt.snapshotId)return r;const headers=new Headers(r.headers);headers.set(header,value);return metadata(new Response(r.body,{headers}),call.url);};
  await assert.rejects(f.client.getLedgerCheckSnapshot(input),{code:'INVALID_RESPONSE'});assert.equal(f.client.getDeviceStatus().state,'ready');
 }
});

test('large saved snapshots traverse only the private 32MiB readonly response path',async t=>{
 const f=await fixture(t),sourceJson=await savedSnapshot(f.sourceProjectId,{padding:18*1024*1024}),{receipt}=await f.importing({sourceJson});
 const data=await f.client.getLedgerCheckSnapshot(await f.readInput(receipt.snapshotId));assert.equal(data.snapshot.reconciliation.sourceRefs.ledger.syntheticPadding.length,18*1024*1024);
});

test('snapshot content-length overflow stops before a private DTO is published',async t=>{
 const f=await fixture(t),{receipt}=await f.importing(),input=await f.readInput(receipt.snapshotId);
 f.state.after=(call,r)=>{if(!call.route.includes('/snapshots/'))return r;const headers=new Headers(r.headers);headers.set('content-length',String(32*1024*1024+1));return metadata(new Response('{}',{headers}),call.url);};
 await assert.rejects(f.client.getLedgerCheckSnapshot(input),{code:'RESPONSE_TOO_LARGE'});assert.equal(f.client.getDeviceStatus().state,'paused');
});

async function heldResponse(f,{errorBody}={}){
 const entered=deferred(),release=deferred();let held=false,canceled=false;
 f.state.after=async(call,r)=>{if(held||!call.route.includes('/snapshots/'))return r;held=true;const bytes=errorBody??new Uint8Array(await r.arrayBuffer());return metadata(new Response(new ReadableStream({async pull(c){entered.resolve();await release.promise;if(!canceled){c.enqueue(bytes);c.close();}},cancel(){canceled=true;}},{highWaterMark:0}),{status:errorBody?403:r.status,headers:r.headers}),call.url);};
 return {entered,release,isCanceled:()=>canceled};
}
test('permission revoked while snapshot bytes are held discards the late data without pausing a valid current device',async t=>{
 const f=await fixture(t),{receipt}=await f.importing(),input=await f.readInput(receipt.snapshotId),h=await heldResponse(f),pending=f.client.getLedgerCheckSnapshot(input),rejected=assert.rejects(pending,{code:'LEDGER_CHECK_CHANGED'});await h.entered.promise;
 await f.client.changeLedgerCheckAccess({...f.target,projectRevision:input.projectRevision,userId:'manager-a',memberRevision:f.epoch('manager-a'),grantRevision:input.grantRevision,read:false,currentPassword:PASSWORD,confirmed:true});h.release.resolve();await rejected;assert.equal(f.client.getDeviceStatus().state,'ready');assert.equal(f.moduleRows()[3].rows.length,1);
});
test('later actor is preserved when an older snapshot response arrives',async t=>{
 const f=await fixture(t),{receipt}=await f.importing(),input=await f.readInput(receipt.snapshotId),h=await heldResponse(f),pending=f.client.getLedgerCheckSnapshot(input),rejected=assert.rejects(pending,{code:'SESSION_CHANGED'});await h.entered.promise;
 await f.switchActor();h.release.resolve();await rejected;assert.equal((await f.client.getSession()).account.id,'partner-a');assert.equal(f.client.getDeviceStatus().state,'ready');
});
for(const body of [Uint8Array.of(255),Buffer.from(JSON.stringify({error:{code:'DEVICE_PROOF_REQUIRED'}}))])test('an old snapshot error cannot pause a newer access opening on the same account',async t=>{
 const f=await fixture(t),{receipt}=await f.importing(),input=await f.readInput(receipt.snapshotId),h=await heldResponse(f,{errorBody:body}),pending=f.client.getLedgerCheckSnapshot(input),rejected=assert.rejects(pending,{code:'LEDGER_CHECK_CHANGED'});await h.entered.promise;
 const epoch=f.client.getDeviceStatus().epoch;await f.access();h.release.resolve();await rejected;assert.equal(f.client.getDeviceStatus().state,'ready');assert.equal(f.client.getDeviceStatus().epoch,epoch);
});
test('cancelled byte reads release their stream and do not pause a valid later view',async t=>{
 const f=await fixture(t),{receipt}=await f.importing(),input=await f.readInput(receipt.snapshotId),h=await heldResponse(f),controller=new AbortController(),pending=f.client.getLedgerCheckSnapshot(input,{signal:controller.signal}),rejected=assert.rejects(pending,{code:'LEDGER_CHECK_CANCELED'});await h.entered.promise;
 controller.abort();await rejected;assert.equal(h.isCanceled(),true);h.release.resolve();assert.equal((await f.access()).read,true);assert.equal(f.client.getDeviceStatus().state,'ready');
});
test('retired metadata error cannot pause a newer ledger opening on the same account',async t=>{
 const f=await fixture(t),entered=deferred(),release=deferred();let held=false;
 f.state.after=(call,r)=>{if(held||!call.route.endsWith('/ledger-check-projects'))return r;held=true;return metadata(new Response(new ReadableStream({async pull(c){entered.resolve();await release.promise;c.enqueue(Uint8Array.of(255));c.close();}},{highWaterMark:0}),{status:403,headers:r.headers}),call.url);};
 const pending=f.client.listLedgerCheckProjects({teamId:'team-a'}),rejected=assert.rejects(pending,{code:'LEDGER_CHECK_CHANGED'});await entered.promise;const epoch=f.client.getDeviceStatus().epoch;
 f.client.retireLedgerCheckReads();await f.access();release.resolve();await rejected;assert.equal(f.client.getDeviceStatus().state,'ready');assert.equal(f.client.getDeviceStatus().epoch,epoch);
});
test('untrusted HTTPS preflight sends neither import JSON nor bearer or device proof',async t=>{
 const f=await fixture(t),input=await f.importInput();f.state.after=(call,r)=>{if(call.route!=='/api/auth/methods')return r;const headers=new Headers(r.headers);headers.set('X-Shenyi-Server-Id',uuid());return metadata(new Response(r.body,{headers}),call.url);};const start=f.state.calls.length;
 await assert.rejects(f.client.importLedgerCheckSnapshot(input),{code:'UNTRUSTED_SERVER'});const calls=f.state.calls.slice(start);assert.equal(calls.length,1);assert.equal(calls[0].route,'/api/auth/methods');assert.deepEqual(calls[0].settings.headers,{Origin:'shenyi://app'});assert.equal(calls[0].settings.body,undefined);assert.equal(f.moduleRows()[3].rows.length,0);
});
test('a committed import whose response is lost is queried by its original operation without automatic POST retry',async t=>{
 const f=await fixture(t),input=await f.importInput();let lost=false;f.state.after=(call,r)=>{if(!lost&&call.route===f.root+'/imports'&&r.status===201){lost=true;throw Error('Synthetic response lost after commit');}return r;};
 await assert.rejects(f.client.importLedgerCheckSnapshot(input),{code:'SERVICE_UNAVAILABLE'});assert.equal(f.moduleRows()[3].rows.length,1);assert.equal(f.client.getDeviceStatus().state,'paused');
 f.state.after=null;await f.client.reconnectDevice();const receipt=await f.client.getLedgerCheckImportReceipt({...f.target,operationId:input.operationId});assert.equal(receipt.sourceSha256,sha(input.sourceJson));assert.equal(f.state.calls.filter(c=>c.route===f.root+'/imports'&&c.settings.method==='POST').length,1);
});
