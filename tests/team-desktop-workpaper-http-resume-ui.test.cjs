'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {fixture,PASSWORD,restorePasswordWork}=require('./helpers/workpaper-http-resume-fixture.cjs');
const {fixture:uiFixture,tick}=require('./helpers/workpaper-ui-fixture.cjs');
const {createWorkpaperBridge,RPC}=require('../desktop/workpaper-bridge.cjs');
const {createWorkpaperSourceManager}=require('../desktop/workpaper-source.cjs');
after(restorePasswordWork);

async function until(predicate,message){
 const deadline=Date.now()+30000;
 while(!predicate()&&Date.now()<deadline)await tick();
 assert.ok(predicate(),message);
}
async function setup(t){
 const f=await fixture(t),events=[],sourceState={clears:0};
 const bridge=createWorkpaperBridge({client:f.client,dialog:{async showOpenDialog(){return{canceled:false,filePaths:[f.filename]};}},sourceManagerFactory:options=>{
  const manager=createWorkpaperSourceManager(options);
  return Object.freeze({...manager,clearSource(){sourceState.clears++;return manager.clearSource();}});
 }});
 t.after(()=>bridge.dispose());
 // Keep the real HTML, renderer and 15-second timer harness. Only the harness's
 // IPC stand-in is replaced, before opening, with the real passive bridge.
 // This is JSDOM plus injected synthetic file selection, not native Electron.
 const u=uiFixture(t,{empty:true});u.state.userId=f.user;u.state.epoch=f.client.getDeviceStatus().epoch;u.view.sync();
 for(const [name] of RPC)u.api[name]=async input=>{
  const event={name,viewId:input.viewId,handle:input.handle,requestId:input.requestId,completed:false};events.push(event);
  try{const value=await bridge[name](structuredClone(input));event.status=value?.status;return{ok:true,value};}
  catch(error){event.error=error.code;return{ok:false,error:{code:error.code,message:error.message}};}
  finally{event.completed=true;}
 };
 const count=name=>events.filter(e=>e.name===name).length,finished=name=>events.filter(e=>e.name===name&&e.completed).length;
 await u.open();await u.select();assert.equal(u.id('import').hidden,false);
 u.click('source-open');await until(()=>finished('chooseWorkpaperSource')===1&&!u.id('source-discard').disabled,'actual Worker-selected source is ready');
 assert.match(u.id('source-summary').textContent,/SHA-256/);
 return{f,u,bridge,events,sourceState,count,finished};
}
async function pauseAtQuota(s){
 const {f,u,events,finished}=s;await f.fillBusinessTo(117);
 u.field('source-verified',true);u.field('import-confirmed',true);u.field('import-password',PASSWORD);await u.submit('import-form');
 await until(()=>finished('confirmWorkpaperImport')===1&&!u.id('refresh').disabled,'real import receives the first-chunk HTTP 429');
 const operation=events.find(e=>e.name==='confirmWorkpaperImport');assert.equal(operation.status,'paused');assert.equal(operation.error,undefined);assert.equal(f.businessAttempts(),120);
 const requestId=u.id('operation-id').value;assert.equal(operation.handle,requestId);assert.equal(u.id('import-resume').hidden,false);
 const stage=f.db.prepare('SELECT lease_id,session_hash,status FROM team_workpaper_data_imports WHERE request_id=?').get(requestId);assert.equal(stage.status,'active');
 const epoch=f.client.getDeviceStatus().epoch;
 await f.client.checkDeviceConnection();assert.equal(f.client.getDeviceStatus().state,'ready');assert.equal(f.client.getDeviceStatus().epoch,epoch);
 const polls=finished('getWorkpaperAccess');u.field('import-password','Unsent synthetic password');u.poll();
 await until(()=>finished('getWorkpaperAccess')>polls&&u.id('import').hidden,'real permission poll reports business HTTP 429');
 assert.equal(events.findLast(e=>e.name==='getWorkpaperAccess').error,'HTTP_429');
 assert.equal(u.id('source-summary').textContent,'');assert.equal(u.id('receipt-summary').textContent,'');assert.equal(u.id('import-password').value,'');assert.equal(u.id('source-verified').checked,false);assert.equal(u.id('import-confirmed').checked,false);assert.equal(u.id('operation-id').value,requestId);
 return{requestId,stage,epoch,closes:s.count('closeWorkpaperView'),clears:s.sourceState.clears};
}
function mutations(f,suffix){return f.state.calls.filter(e=>e.method==='POST'&&e.path.endsWith(suffix));}
function verifyNetwork(f){
 assert.equal(f.state.calls.length,f.state.wire.length,'every client request reaches the owned production listener');
 const points=rows=>rows.map(e=>[e.method,e.route,e.status].join(' ')).sort();
 assert.deepEqual(points(f.state.calls),points(f.state.wire),'client responses match actual listener finishes');
 for(const e of f.state.calls){assert.equal(e.origin,f.address);assert.equal(e.responseURL,f.address+e.route);assert.equal(e.responseServerId,f.serverId);}
 for(const e of f.state.wire){assert.equal(e.finished,true);assert.equal(e.localPort,Number(new URL(f.address).port));assert.equal(e.remoteAddress,'127.0.0.1');if(e.route.startsWith('/api/teams/'))for(const key of ['hasAuthorization','hasLease','hasSignature','hasNonce'])assert.equal(e[key],true,e.route+' '+key);}
 const heartbeat=f.state.wire.filter(e=>e.route==='/api/auth/devices/connection');assert.equal(heartbeat.length,1);assert.equal(heartbeat[0].status,200);
}
async function close(s,report){
 const {f,u,bridge}=s;u.view.destroy();bridge.dispose();await f.close();
 assert.equal(f.service.server.listening,false,'only this fixture listener is closed');verifyNetwork(f);
 await f.recordEvidence({...report,rpcEvents:s.events,sourceClears:s.sourceState.clears,JSDOM:true,nativePickerPathInjected:true,nativeElectronOrOSAccepted:false,listenerClosed:true});
}

test('actual HTTP renderer preserves the source through business 429 and manually resumes the same signed import', {timeout:60000},async t=>{
 const s=await setup(t),{f,u,events,count,finished}=s,p=await pauseAtQuota(s);
 assert.equal(count('closeWorkpaperView'),p.closes);assert.equal(s.sourceState.clears,p.clears);assert.equal(mutations(f,'/commit').length,0);
 f.clock.value+=60001;const polls=finished('getWorkpaperAccess');u.poll();
 await until(()=>finished('getWorkpaperAccess')>polls&&!u.id('import').hidden&&!u.id('refresh').disabled,'same-view permission and current head reload complete');
 assert.equal(count('closeWorkpaperView'),p.closes);assert.equal(s.sourceState.clears,p.clears);assert.equal(u.id('operation-id').value,p.requestId);assert.equal(u.id('import-resume').hidden,false);assert.equal(u.id('source-open').disabled,true);assert.match(u.id('source-summary').textContent,new RegExp(p.requestId));
 assert.equal(u.id('import-password').value,'');assert.equal(u.id('source-verified').checked,false);assert.equal(u.id('import-confirmed').checked,false);assert.equal(u.id('import-resume').disabled,true);assert.equal(count('resumeWorkpaperImport'),0);assert.equal(mutations(f,'/commit').length,0);
 u.click('receipt');await until(()=>finished('queryWorkpaperImport')===1&&!u.id('refresh').disabled,'explicit read-only query of the original stage completes');assert.match(u.id('message').textContent,/仍有效/);
 u.field('source-verified',true);u.field('import-confirmed',true);u.field('import-password',PASSWORD);u.click('import-resume');
 await until(()=>finished('resumeWorkpaperImport')===1&&finished('getWorkpaperForm')===1&&!u.id('refresh').disabled,'manual HTTP resume imports and reloads the actual valid Excel form');
 assert.equal(events.find(e=>e.name==='resumeWorkpaperImport').handle,p.requestId);assert.equal(events.find(e=>e.name==='resumeWorkpaperImport').status,'imported');assert.equal(events.find(e=>e.name==='getWorkpaperForm').error,undefined);assert.match(u.id('attempts').textContent,/imported/);
 const stage=f.db.prepare('SELECT lease_id,session_hash,status FROM team_workpaper_data_imports WHERE request_id=?').get(p.requestId);assert.equal(stage.status,'published');assert.equal(stage.lease_id,p.stage.lease_id);assert.equal(stage.session_hash,p.stage.session_hash);assert.equal(f.client.getDeviceStatus().epoch,p.epoch);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_heads').get().n,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_chunks').get().n,0);assert.equal(mutations(f,'/imports').length,1);assert.equal(mutations(f,'/commit').length,1);
 assert.equal(u.id('viewer').hidden,false);assert.equal(u.id('form').querySelector('[data-cell=A2]').textContent,'saved valid original sheet answer');assert.equal(u.id('form').querySelector('[data-cell=C1]').getAttribute('contenteditable'),'false');
 await close(s,{case:'same-original-id-explicit-resume',requestId:p.requestId,headCount:1,beginPOSTs:1,commitPOSTs:1,sameLeaseAndSession:true,validExcelReloaded:true});
});

test('actual HTTP grant revocation after quota suspension retires the source instead of restoring import', {timeout:60000},async t=>{
 const s=await setup(t),{f,u,events,count,finished}=s,p=await pauseAtQuota(s);f.clock.value+=60001;
 await f.client.changeWorkpaperAccess({...f.revisions(),userId:f.user,memberRevision:f.epoch(f.user),read:false,write:false,export:false,currentPassword:PASSWORD,confirmed:true});
 const polls=finished('getWorkpaperAccess');u.poll();await until(()=>finished('getWorkpaperAccess')>polls&&count('closeWorkpaperView')>p.closes,'fresh HTTP access observes the real grant transaction and closes the prior view');
 assert.equal(events.findLast(e=>e.name==='getWorkpaperAccess').error,undefined);assert.ok(s.sourceState.clears>p.clears);assert.equal(u.id('source-summary').textContent,'');assert.equal(u.id('import').hidden,true);assert.equal(u.id('import-resume').hidden,true);assert.equal(u.id('import-password').value,'');
 // Programmatic dispatch also reaches the logic guard despite a hidden button.
 u.field('source-verified',true);u.field('import-confirmed',true);u.field('import-password',PASSWORD);u.fire('import-resume','click');await u.submit('import-form');await tick();await tick();
 assert.equal(count('resumeWorkpaperImport'),0);assert.equal(count('confirmWorkpaperImport'),1);assert.equal(mutations(f,'/imports').length,1);assert.equal(mutations(f,'/commit').length,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_heads').get().n,0);
 assert.equal(f.client.getDeviceStatus().state,'ready');assert.equal(f.client.getDeviceStatus().epoch,p.epoch);
 await close(s,{case:'real-grant-revocation-retires-source',requestId:p.requestId,headCount:0,beginPOSTs:1,commitPOSTs:0,resumeRPCs:0,deviceRemainedReady:true});
});
