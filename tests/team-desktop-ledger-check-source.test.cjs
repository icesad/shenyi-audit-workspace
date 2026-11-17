'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,PASSWORD,savedSnapshot,uuid,sha,deferred,restorePasswordWork}=require('./helpers/ledger-check-client-fixture.cjs');
const {createLedgerCheckSourceManager}=require('../desktop/ledger-check-source.cjs');
after(restorePasswordWork);
async function setup(t,{json,grant=true}={}){
 const f=await fixture(t,{grant}),root='D:/codex-temp/shenyi-ledger-check-desktop-20261117/source-files';await fs.mkdir(root,{recursive:true});const directory=await fs.mkdtemp(path.join(root,'case-')),filename=path.join(directory,'synthetic-saved-snapshot.json');json??=await savedSnapshot(f.sourceProjectId);await fs.writeFile(filename,json);
 const state={pickers:0,opens:0,closes:0,reads:0,picker:null,stat:null,read:null};
 const manager=createLedgerCheckSourceManager({client:f.client,window:{},dialog:{async showOpenDialog(){state.pickers++;return state.picker?state.picker():{canceled:false,filePaths:[filename]};}},fsImpl:{async open(...args){state.opens++;const handle=await fs.open(...args);return{async stat(){return state.stat?state.stat(await handle.stat()):handle.stat();},async read(...args){state.reads++;return state.read?state.read(handle,args):handle.read(...args);},async close(){state.closes++;return handle.close();}};}}});t.after(()=>manager.dispose());
 const a=await f.access(),target={...f.target,projectRevision:a.projectRevision,grantRevision:a.grantRevision,headRevision:a.headRevision??0};
 async function choose(){return manager.chooseLedgerCheckSource(target);}
 const confirmation=selected=>({...target,handle:selected.handle,sourceSha256:selected.sourceSha256,currentPassword:PASSWORD,sourceVerified:true,confirmed:true});
 const posts=()=>f.state.calls.filter(c=>c.route===f.root+'/imports'&&c.settings.method==='POST');
 return {...f,manager,fileState:state,filename,json,target,choose,confirmation,posts};
}

test('normal source selection exposes only an opaque handle and minimal summary then imports the exact private bytes',async t=>{
 const f=await setup(t),selected=await f.choose();assert.deepEqual(Object.keys(selected).sort(),['status','handle','sourceSha256','summary'].sort());assert.equal(selected.status,'selected');assert.equal(selected.sourceSha256,sha(f.json));assert.equal(selected.summary.sourceProjectId,f.sourceProjectId);assert.equal(selected.summary.byteLength,Buffer.byteLength(f.json));
 const dto=JSON.stringify(selected);assert.ok(!dto.includes(f.filename));assert.ok(!dto.includes('sourceJson'));assert.ok(!dto.includes('currentPassword'));assert.equal(f.posts().length,0);
 // Later disk replacement cannot substitute a different record for the bytes
 // whose SHA and summary were already presented for explicit confirmation.
 await fs.writeFile(f.filename,await savedSnapshot(f.sourceProjectId,{workspaceRevision:10}));const result=await f.manager.confirmLedgerCheckImport(f.confirmation(selected));assert.equal(result.status,'imported');assert.equal(result.receipt.operationId,selected.handle);assert.equal(result.receipt.sourceSha256,sha(f.json));
 assert.equal(f.posts().length,1);assert.equal(f.moduleRows()[3].rows[0].source_json,f.json);assert.equal(f.fileState.opens,1);assert.equal(f.fileState.closes,1);assert.equal(f.posts()[0].settings.body.includes('sourceVerified'),false);
 await assert.rejects(f.manager.confirmLedgerCheckImport(f.confirmation(selected)),{code:'LEDGER_SOURCE_CHANGED'});
});
test('without explicit read and import capability no native picker or source file is opened',async t=>{
 const f=await setup(t,{grant:false});const a=await f.access();assert.equal(a.canImport,false);
 await assert.rejects(f.manager.chooseLedgerCheckSource({...f.target,grantRevision:1}),{code:'LEDGER_SOURCE_CHANGED'});assert.equal(f.fileState.pickers,0);assert.equal(f.fileState.opens,0);assert.equal(f.posts().length,0);
});
test('closing a held picker invalidates its result without opening a file or accepting a new overlapping operation',async t=>{
 const f=await setup(t),entered=deferred(),release=deferred();f.fileState.picker=async()=>{entered.resolve();await release.promise;return {canceled:false,filePaths:[f.filename]};};
 const pending=f.choose(),rejected=assert.rejects(pending,{code:'LEDGER_SOURCE_CHANGED'});await entered.promise;f.manager.clearSource();await assert.rejects(f.choose(),{code:'LEDGER_SOURCE_BUSY'});release.resolve();await rejected;assert.equal(f.fileState.opens,0);assert.equal(f.posts().length,0);
});
test('revocation during the picker is checked before opening the selected local file',async t=>{
 const f=await setup(t);f.fileState.picker=async()=>{await f.change(false);return {canceled:false,filePaths:[f.filename]};};
 await assert.rejects(f.choose(),{code:'LEDGER_SOURCE_CHANGED'});assert.equal(f.fileState.opens,0);assert.equal(f.posts().length,0);
});
test('wrong Q and malformed canonical source files are refused before any upload',async t=>{
 for(const json of ['{}',await savedSnapshot(uuid())]){const f=await setup(t,{json});await assert.rejects(f.choose(),{code:'LEDGER_SOURCE_INVALID'});assert.equal(f.fileState.opens,1);assert.equal(f.fileState.closes,1);assert.equal(f.posts().length,0);}
});
test('size overflow and failed reads always close the selected file without uploading a partial record',async t=>{
 const f=await setup(t);f.fileState.stat=stat=>({isFile:()=>stat.isFile(),size:32*1024*1024+1});await assert.rejects(f.choose(),{code:'LEDGER_SOURCE_INVALID'});assert.equal(f.fileState.reads,0);assert.equal(f.fileState.closes,1);
 f.fileState.stat=null;f.fileState.read=()=>{throw Error('Synthetic storage failure');};await assert.rejects(f.choose(),{code:'LEDGER_SOURCE_INVALID'});assert.equal(f.fileState.closes,2);assert.equal(f.posts().length,0);
});
test('canceling the native picker does not read any source or create a receipt',async t=>{
 const f=await setup(t);f.fileState.picker=async()=>({canceled:true,filePaths:[]});assert.deepEqual(await f.choose(),{status:'cancelled'});assert.equal(f.fileState.opens,0);assert.equal(f.posts().length,0);
});
test('caller cannot provide paths or raw JSON, forge a handle, skip source verification or alter selection versions',async t=>{
 const f=await setup(t),s=await f.choose(),v=f.confirmation(s);
 for(const bad of [{...v,sourceJson:f.json},{...v,filePath:f.filename},{...v,sourceVerified:false},{...v,confirmed:false}])await assert.rejects(f.manager.confirmLedgerCheckImport(bad),{code:'INVALID_INPUT'});
 for(const bad of [{...v,handle:uuid()},{...v,sourceSha256:'a'.repeat(64)},{...v,headRevision:1},{...v,projectId:uuid()}])await assert.rejects(f.manager.confirmLedgerCheckImport(bad),{code:'LEDGER_SOURCE_CHANGED'});
 assert.equal(f.posts().length,0);assert.equal((await f.manager.confirmLedgerCheckImport(v)).status,'imported');
});
test('stale source discard cannot clear a more recently selected private snapshot',async t=>{
 const f=await setup(t),first=await f.choose(),second=await f.choose();assert.notEqual(first.handle,second.handle);assert.deepEqual(f.manager.discardLedgerCheckSource({handle:first.handle}),{discarded:false});assert.equal((await f.manager.confirmLedgerCheckImport(f.confirmation(second))).status,'imported');
});
test('password failure creates no import receipt and does not falsely report an unknown outcome',async t=>{
 const f=await setup(t),s=await f.choose();await assert.rejects(f.manager.confirmLedgerCheckImport({...f.confirmation(s),currentPassword:'wrong'}),{code:'HTTP_403'});assert.equal(f.moduleRows()[3].rows.length,0);assert.equal(f.posts().length,1);assert.equal(f.client.getDeviceStatus().state,'ready');
});
test('source preflight failure is not marked as POST dispatched and creates no unknown mutation',async t=>{
 const f=await setup(t),s=await f.choose();let accessCalls=0;f.state.after=(call,r)=>{if(call.route===f.root+'/access'&&++accessCalls===2)throw Error('Synthetic client preflight unavailable');return r;};
 await assert.rejects(f.manager.confirmLedgerCheckImport(f.confirmation(s)),{code:'SERVICE_UNAVAILABLE'});assert.equal(f.posts().length,0);assert.equal(f.moduleRows()[3].rows.length,0);
});
test('closing during server KDF retains the mutation lock and reports possible commit with only the original operation ID',async t=>{
 const f=await setup(t),s=await f.choose(),held=f.passwordHold(),pending=f.manager.confirmLedgerCheckImport(f.confirmation(s));await held.entered.promise;f.manager.clearSource();await assert.rejects(f.choose(),{code:'LEDGER_SOURCE_BUSY'});held.release.resolve();
 assert.deepEqual(await pending,{status:'unknown',operationId:s.handle});assert.equal(f.moduleRows()[3].rows.length,1);assert.equal(f.posts().length,1);const receipt=await f.client.getLedgerCheckImportReceipt({teamId:f.target.teamId,projectId:f.target.projectId,operationId:s.handle});assert.equal(receipt.sourceSha256,s.sourceSha256);
});
test('lost confirmed response produces an original-ID query path and never retries the import',async t=>{
 const f=await setup(t),s=await f.choose();f.state.after=(call,r)=>{if(call.route===f.root+'/imports'&&r.status===201)throw Error('Synthetic lost committed response');return r;};
 assert.deepEqual(await f.manager.confirmLedgerCheckImport(f.confirmation(s)),{status:'unknown',operationId:s.handle});assert.equal(f.moduleRows()[3].rows.length,1);assert.equal(f.posts().length,1);
 f.state.after=null;await f.client.reconnectDevice();const receipt=await f.client.getLedgerCheckImportReceipt({teamId:f.target.teamId,projectId:f.target.projectId,operationId:s.handle});assert.equal(receipt.sourceSha256,s.sourceSha256);assert.equal(f.posts().length,1);
});
