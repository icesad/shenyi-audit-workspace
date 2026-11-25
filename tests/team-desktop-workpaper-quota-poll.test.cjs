'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,until,tick,deferred,ok,fail}=require('./helpers/workpaper-ui-fixture.cjs');

async function selectedPaused(t){
 let limited=false;
 const f=fixture(t,{empty:true,overrides:{getWorkpaperAccess:async(v,s)=>limited?fail('HTTP_429','Synthetic business quota exhausted'):ok({teamId:'team-a',projectId:v.projectId,projectRevision:s.projectRevision,grantRevision:s.grantRevision,read:s.read,write:s.write,export:s.exportable,canWrite:s.read&&s.write,canExport:s.read&&s.exportable,canManageAccess:s.owner}),confirmWorkpaperImport:async v=>ok({status:'paused',requestId:v.handle,phase:'chunk'}),resumeWorkpaperImport:async v=>ok({status:'paused',requestId:v.handle,phase:'chunk'})}});
 await f.open();await f.select();f.click('source-open');await until(()=>!f.id('source-discard').disabled);
 f.field('source-verified',true);f.field('import-confirmed',true);f.field('import-password','Synthetic initial proof');await f.submit('import-form');await until(()=>f.count('confirmWorkpaperImport')===1&&!f.id('refresh').disabled);
 const requestId=f.state.selected.handle;assert.equal(f.id('operation-id').value,requestId);assert.equal(f.id('import-resume').hidden,false);
 return{f,requestId,limit(v=true){limited=v;}};
}

test('access poll 429 closes sensitive controls while same-revision recovery preserves original explicit import resume',async t=>{
 const {f,requestId,limit}=await selectedPaused(t),opens=f.count('openWorkpaperView'),closes=f.count('closeWorkpaperView');
 f.field('grant-password','Unsent grant proof');f.field('import-password','Unsent import proof');f.field('source-verified',true);f.field('import-confirmed',true);limit();f.poll();await until(()=>f.id('import').hidden);
 assert.equal(f.id('grant-password').value,'');assert.equal(f.id('import-password').value,'');assert.equal(f.id('source-verified').checked,false);assert.equal(f.id('import-confirmed').checked,false);assert.equal(f.id('viewer').hidden,true);assert.equal(f.id('form').textContent,'');assert.equal(f.id('history').textContent,'');assert.equal(f.id('operation-id').value,requestId);assert.equal(f.count('confirmWorkpaperImport'),1);assert.equal(f.count('resumeWorkpaperImport'),0);
 const accessCalls=f.count('getWorkpaperAccess');limit(false);f.poll();await until(()=>f.count('getWorkpaperAccess')>accessCalls&&!f.id('refresh').disabled);await tick();await tick();
 assert.equal(f.count('openWorkpaperView'),opens,'same authorization must retain the original project view');assert.equal(f.count('closeWorkpaperView'),closes,'same authorization must not clear the main-process source by closing its view');assert.equal(f.id('import').hidden,false);assert.equal(f.id('import-resume').hidden,false);assert.equal(f.id('source-open').disabled,true);assert.equal(f.id('operation-id').value,requestId);
 f.field('source-verified',true);f.field('import-confirmed',true);f.field('import-password','Synthetic resume proof');f.click('import-resume');await until(()=>f.count('resumeWorkpaperImport')===1&&!f.id('refresh').disabled);assert.equal(f.calls.find(c=>c.name==='resumeWorkpaperImport').input.handle,requestId);assert.equal(f.count('confirmWorkpaperImport'),1);
});

for(const revision of ['projectRevision','grantRevision'])test('a quota-paused authorization does not hide a later real '+revision+' change',async t=>{
 const {f,limit}=await selectedPaused(t),closes=f.count('closeWorkpaperView');limit();f.poll();await until(()=>f.id('import').hidden);f.state[revision]++;limit(false);f.poll();await until(()=>f.count('closeWorkpaperView')>closes);assert.equal(f.id('import-resume').hidden,true);assert.equal(f.id('source-summary').textContent,'');f.click('refresh');await until(()=>!f.id('import').hidden&&!f.id('refresh').disabled);assert.equal(f.id('source-open').disabled,false);assert.equal(f.count('resumeWorkpaperImport'),0);
});

test('quota-unknown authorization clears visible source proof and guards direct action handlers',async t=>{
 const {f,limit}=await selectedPaused(t);limit();f.poll();await until(()=>f.id('import').hidden);assert.equal(f.id('source-summary').textContent,'');assert.equal(f.id('receipt-summary').textContent,'');
 const names=['queryWorkpaperImport','cancelWorkpaperSourceImport','discardWorkpaperSource','resumeWorkpaperImport','chooseWorkpaperSource','changeWorkpaperAccess','exportWorkpapers','saveWorkpaperEntries'],before=Object.fromEntries(names.map(n=>[n,f.count(n)]));
 // Dispatch still exercises each handler when a disabled DOM control is invoked.
 // Access unknown must remain a logic guard, in addition to hiding controls.
 for(const name of ['receipt','import-cancel','source-discard','import-resume','source-open','save','export']){f.field('operation-cancel-confirmed',true);f.field('source-verified',true);f.field('import-confirmed',true);f.field('import-password','Synthetic unavailable proof');f.field('export-confirmed',true);f.fire(name,'click');await tick();await tick();}
 await f.submit('import-form');await f.submit('grant-form');for(const name of names)assert.equal(f.count(name),before[name],name+' must not dispatch with unknown access');
});

for(const code of ['HTTP_403','HTTP_404'])test('poll '+code+' after 429 still retires the old source rather than restoring it',async t=>{
 const {f,limit}=await selectedPaused(t),read=f.api.getWorkpaperAccess,closes=f.count('closeWorkpaperView');limit();f.poll();await until(()=>f.id('import').hidden);f.api.getWorkpaperAccess=async()=>fail(code);f.poll();await tick();await tick();assert.equal(f.id('import').hidden,true);assert.equal(f.id('import-resume').hidden,true);assert.equal(f.id('source-summary').textContent,'');assert.equal(f.id('import-password').value,'');assert.equal(f.count('resumeWorkpaperImport'),0);f.api.getWorkpaperAccess=read;limit(false);f.poll();await until(()=>f.count('closeWorkpaperView')>closes);assert.equal(f.id('import-resume').hidden,true);assert.equal(f.id('source-summary').textContent,'');
});

for(const change of ['close','account','device'])test('source kept across quota cannot survive '+change+' context retirement',async t=>{
 const {f,limit}=await selectedPaused(t),closes=f.count('closeWorkpaperView');limit();f.poll();await until(()=>f.id('import').hidden);if(change==='close')f.id('panel').querySelector('summary').click();else{if(change==='account')f.state.userId='other-manager';else f.state.epoch++;f.view.sync();}await until(()=>f.count('closeWorkpaperView')>closes);assert.equal(f.id('source-summary').textContent,'');assert.equal(f.id('import-resume').hidden,true);assert.equal(f.id('import-password').value,'');assert.equal(f.count('resumeWorkpaperImport'),0);
});

for(const change of ['close','account','device'])test('late same-revision recovery poll cannot restore source after '+change,async t=>{
 const {f,limit}=await selectedPaused(t);limit();f.poll();await until(()=>f.id('import').hidden);const gate=deferred(),entered=deferred();f.api.getWorkpaperAccess=async v=>{entered.resolve();await gate.promise;return ok(f.access(v));};f.poll();await entered.promise;if(change==='close')f.id('panel').querySelector('summary').click();else{if(change==='account')f.state.userId='other-manager';else f.state.epoch++;f.view.sync();}gate.resolve();await tick();await tick();assert.equal(f.id('source-summary').textContent,'');assert.equal(f.id('import-resume').hidden,true);assert.equal(f.id('panel').open,false);assert.equal(f.count('resumeWorkpaperImport'),0);
});

test('known imported receipt remains settled across poll 429 and recovery without an automatic import POST',async t=>{
 let limited=false;const f=fixture(t,{empty:true,overrides:{getWorkpaperAccess:async(v,s)=>limited?fail('HTTP_429'):ok({teamId:'team-a',projectId:v.projectId,projectRevision:s.projectRevision,grantRevision:s.grantRevision,read:true,write:true,export:true,canWrite:true,canExport:true,canManageAccess:true})}});await f.open();await f.select();f.click('source-open');await until(()=>!f.id('source-discard').disabled);f.field('source-verified',true);f.field('import-confirmed',true);f.field('import-password','Synthetic proof');await f.submit('import-form');await until(()=>f.count('confirmWorkpaperImport')===1&&!f.id('refresh').disabled);const requestId=f.id('operation-id').value;assert.match(f.id('attempts').textContent,/imported/);limited=true;f.poll();await until(()=>f.id('viewer').hidden);assert.match(f.id('attempts').textContent,/imported/);assert.equal(f.id('operation-id').value,requestId);assert.equal(f.count('confirmWorkpaperImport'),1);assert.equal(f.count('resumeWorkpaperImport'),0);limited=false;const calls=f.count('getWorkpaperAccess');f.poll();await until(()=>f.count('getWorkpaperAccess')>calls&&!f.id('refresh').disabled);await tick();await tick();assert.match(f.id('attempts').textContent,/imported/);assert.equal(f.id('operation-id').value,requestId);assert.equal(f.count('confirmWorkpaperImport'),1);assert.equal(f.count('resumeWorkpaperImport'),0);
});

async function recoveryFormPending(t){
 let limited=false;
 const f=fixture(t,{overrides:{getWorkpaperAccess:async(v,s)=>limited?fail('HTTP_429','Synthetic quota exhausted'):ok({teamId:'team-a',projectId:v.projectId,projectRevision:s.projectRevision,grantRevision:s.grantRevision,read:s.read,write:s.write,export:s.exportable,canWrite:s.read&&s.write,canExport:s.read&&s.exportable,canManageAccess:s.owner})}});
 await f.open();await f.select();limited=true;f.poll();await until(()=>f.id('viewer').hidden);
 const original=f.api.getWorkpaperForm,gate=deferred(),entered=deferred();
 f.api.getWorkpaperForm=async input=>{entered.resolve();await gate.promise;return original(input);};
 limited=false;f.poll();await entered.promise;
 return{f,gate};
}

test('429 recovery keeps records and viewer hidden while the first form reload is pending',{timeout:5000},async t=>{
 const {f,gate}=await recoveryFormPending(t);
 try{assert.equal(f.id('viewer').hidden,true,'recovery is incomplete before the form response');assert.equal(f.id('records').hidden,true,'record controls must remain suspended');assert.equal(f.id('export-controls').hidden,true);}
 finally{gate.resolve();await tick();await tick();}
 await until(()=>!f.id('viewer').hidden&&!f.id('refresh').disabled);assert.match(f.id('form').textContent,/已保存填写/);
});

test('hidden export cancel cannot dispatch through the internal recovery read exception',{timeout:5000},async t=>{
 const {f,gate}=await recoveryFormPending(t),before=f.count('cancelWorkpaperExport');
 try{assert.equal(f.id('export-cancel').hidden,true);f.id('export-cancel').dataset.requestId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';f.fire('export-cancel','click');await tick();await tick();assert.equal(f.count('cancelWorkpaperExport'),before,'read recovery must not grant a mutation IPC exception');}
 finally{gate.resolve();await tick();await tick();}
});
