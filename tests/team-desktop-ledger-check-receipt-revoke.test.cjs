'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,until,tick,deferred,ok,fail,Q}=require('./helpers/ledger-check-ui-fixture.cjs');
const saved=()=>({id:randomUUID(),version:1,sourceProjectId:Q,sourceSha256:'a'.repeat(64),workspaceRevision:3,calculatedAt:'2026-11-17T00:00:00.000Z',confirmedBy:'PRIVATE_HISTORY_NAME',importedAt:1000});
const settled=f=>until(()=>!f.id('refresh').disabled);
async function chooseAndImport(f){
 f.click('source-open');await until(()=>!f.id('source-discard').disabled);
 const id=f.state.selected.handle;
 f.field('source-verified',true);f.field('import-confirmed',true);f.field('import-password','Synthetic ledger import password!');
 await f.submit('import-form');await settled(f);return id;
}
test('idle history revocation clears metadata and the authorization label without opening a snapshot',async t=>{
 const f=fixture(t,{read:true,owner:false,records:[saved()]});await f.open();await f.select();
 assert.match(f.id('history').textContent,/PRIVATE_HISTORY_NAME/);const before=f.count('getLedgerCheckAccess');
 f.state.read=false;f.state.grantRevision++;f.poll();await tick();await tick();
 assert.equal(f.count('getLedgerCheckAccess'),before+1);assert.equal(f.count('getLedgerCheckSnapshot'),0);
 assert.equal(f.id('records').hidden,true);assert.doesNotMatch(f.id('history').textContent,/PRIVATE_HISTORY_NAME/);
 assert.doesNotMatch(f.id('permission').textContent,/已获得/);assert.equal(f.id('data').textContent,'');
});
for(const kind of ['grant','project','source'])test('idle history clears when its '+kind+' binding changes',async t=>{
 let changed=false,f;f=fixture(t,{read:true,owner:false,records:[saved()],overrides:{getLedgerCheckAccess:async v=>{
  const a=f.access(v.projectId);if(changed){if(kind==='grant')a.grantRevision++;if(kind==='project')a.projectRevision++;if(kind==='source')a.sourceProjectId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';}return ok(a);
 }}});await f.open();await f.select();changed=true;const before=f.count('getLedgerCheckAccess');f.poll();await tick();await tick();
 assert.equal(f.count('getLedgerCheckAccess'),before+1);assert.doesNotMatch(f.id('history').textContent,/PRIVATE_HISTORY_NAME/);
 assert.equal(f.count('getLedgerCheckSnapshot'),0);assert.match(f.id('message').textContent,/旧内容已清除/);
});
test('idle history fails closed when the permission poll is unavailable',async t=>{
 let broken=false,f;f=fixture(t,{read:true,owner:false,records:[saved()],overrides:{getLedgerCheckAccess:async v=>broken?fail('SERVICE_UNAVAILABLE','Synthetic offline'):ok(f.access(v.projectId))}});
 await f.open();await f.select();broken=true;f.poll();await tick();await tick();
 assert.equal(f.id('records').hidden,true);assert.doesNotMatch(f.id('history').textContent,/PRIVATE_HISTORY_NAME/);
 assert.match(f.id('permission').textContent,/尚未确认/);assert.equal(f.count('getLedgerCheckSnapshot'),0);
});
test('healthy idle polling rechecks authority and preserves history without reading the body',async t=>{
 const f=fixture(t,{read:true,owner:false,records:[saved()]});await f.open();await f.select();const before=f.count('getLedgerCheckAccess');
 f.poll();await tick();await tick();assert.equal(f.count('getLedgerCheckAccess'),before+1);
 assert.match(f.id('history').textContent,/PRIVATE_HISTORY_NAME/);assert.equal(f.count('getLedgerCheckSnapshot'),0);assert.equal(f.count('chooseLedgerCheckSource'),0);
});
test('a late idle denial cannot clear a later actor or trigger their logout',async t=>{
 const entered=deferred(),release=deferred();let holding=false,f;
 f=fixture(t,{read:true,owner:false,records:[saved()],overrides:{getLedgerCheckAccess:async v=>{if(holding){entered.resolve();await release.promise;return fail('SIGN_IN_REQUIRED','Old actor denial');}return ok(f.access(v.projectId));}}});
 await f.open();await f.select();holding=true;const before=f.count('getLedgerCheckAccess');f.poll();await tick();
 assert.equal(f.count('getLedgerCheckAccess'),before+1);await entered.promise;
 holding=false;f.setActor('later-partner');await f.open();await f.select(1);const title=f.id('title').textContent;
 release.resolve();await tick();await tick();assert.equal(f.id('title').textContent,title);assert.equal(f.state.unauthorized??0,0);assert.equal(f.id('records').hidden,false);
});
for(const action of ['import','receipt'])for(const code of ['HTTP_429','HTTP_403','SERVICE_UNAVAILABLE','INVALID_RESPONSE'])test('known '+action+' receipt survives subsequent '+code+' refresh failure without replay',async t=>{
 let broken=false,f;
 f=fixture(t,{read:true,overrides:{
  getLedgerCheckAccess:async v=>broken?(code==='INVALID_RESPONSE'?ok({}):fail(code,'Synthetic refresh failure')):ok(f.access(v.projectId)),
  confirmLedgerCheckImport:async v=>{const r=f.receipt(v.handle,v.sourceSha256);f.state.headRevision++;f.state.records.push(f.record(r));f.state.lastReceipt=r;if(action==='import')broken=true;return ok({status:'imported',receipt:r});}
 }});await f.open();await f.select();const id=await chooseAndImport(f);
 if(action==='receipt'){broken=true;f.click('receipt');await tick();await settled(f);}
 assert.equal(f.count('confirmLedgerCheckImport'),1);assert.equal(f.state.lastReceipt.version,1);
 assert.match(f.id('receipt-summary').textContent,/已保存版本：1/);assert.ok(f.id('receipt-summary').textContent.includes(id));
 assert.match(f.id('message').textContent,/已确认|已只读核对/);assert.match(f.id('message').textContent,/刷新未完成/);assert.ok(f.id('message').textContent.includes(id));
 assert.equal(f.id('message').hidden,false);assert.equal(f.id('query').hidden,true);assert.equal(f.id('records').hidden,true);
 assert.equal(f.id('source-summary').textContent,'');assert.equal(f.id('data').textContent,'');assert.equal(f.id('import-password').value,'');assert.equal(f.id('grant-password').value,'');
 f.click('source-open');f.click('receipt');await tick();assert.equal(f.count('confirmLedgerCheckImport'),1);
});
test('acknowledgement from a closed import cannot reappear in a later actor after refresh settles',async t=>{
 const entered=deferred(),release=deferred();let holding=false,f;
 f=fixture(t,{read:true,overrides:{
  getLedgerCheckAccess:async v=>{if(holding){entered.resolve();await release.promise;return fail('SIGN_IN_REQUIRED','Old refresh');}return ok(f.access(v.projectId));},
  confirmLedgerCheckImport:async v=>{const r=f.receipt(v.handle,v.sourceSha256);f.state.headRevision++;f.state.records.push(f.record(r));f.state.lastReceipt=r;holding=true;return ok({status:'imported',receipt:r});}
 }});await f.open();await f.select();f.click('source-open');await until(()=>!f.id('source-discard').disabled);const id=f.state.selected.handle;
 f.field('source-verified',true);f.field('import-confirmed',true);f.field('import-password','Synthetic ledger password!');await f.submit('import-form');await entered.promise;
 holding=false;f.setActor('later-partner');await f.open();await f.select(1);release.resolve();await tick();await tick();
 assert.equal(f.id('receipt-summary').textContent,'');assert.ok(!f.id('message').textContent.includes(id));assert.equal(f.state.unauthorized??0,0);assert.equal(f.id('import-password').value,'');
});

test('stable owner without read keeps their unsent grant form during an idle authority recheck',async t=>{
 const f=fixture(t,{read:false,owner:true});await f.open();await f.select();f.d.querySelector('#ledger-check-members button').click();
 f.field('grant-read',true);f.field('grant-confirmed',true);f.field('grant-password','Unsent owner password!');
 const before=f.count('getLedgerCheckAccess');f.poll();await tick();await tick();
 assert.equal(f.count('getLedgerCheckAccess'),before+1);assert.equal(f.id('grant-password').value,'Unsent owner password!');
 assert.equal(f.id('grant-read').checked,true);assert.equal(f.id('grant-confirmed').checked,true);assert.equal(f.id('grant-submit').disabled,false);
 assert.equal(f.id('owner').hidden,false);assert.equal(f.id('records').hidden,true);assert.equal(f.count('getLedgerCheckSnapshot'),0);assert.equal(f.count('changeLedgerCheckAccess'),0);
});
