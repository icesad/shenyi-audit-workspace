'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const source=fs.readFileSync(path.resolve(__dirname,'../dist/project-activity.js'),'utf8'),sandbox={};vm.runInNewContext(source,sandbox);const API=sandbox.ProjectActivity;
const A='99111111-1111-4111-8111-111111111111',B='99222222-2222-4222-8222-222222222222',TRIAL='00000000-0000-4000-8000-000000000033';
const plain=v=>JSON.parse(JSON.stringify(v));
test('activity clock requires an operation and does not retroactively count earlier work',()=>{
 const c=API.createClock();c.step(0,{projectId:A,foreground:true});c.step(100000);assert.deepEqual(plain(c.take()),[]);c.step(100000,{activity:true});c.step(105000);assert.deepEqual(plain(c.take()),[{projectId:A,deltaMs:5000}]);assert.deepEqual(plain(c.take()),[]);
});
test('activity clock caps idle time at five minutes and resumes only from the next operation',()=>{
 const c=API.createClock();c.step(0,{projectId:A,foreground:true,activity:true});c.step(900000);assert.deepEqual(plain(c.take()),[{projectId:A,deltaMs:300000}]);c.step(1000000);assert.deepEqual(plain(c.take()),[]);c.step(1000000,{activity:true});c.step(1001500);assert.deepEqual(plain(c.take()),[{projectId:A,deltaMs:1500}]);
});
test('activity clock settles old project before a switch and never counts project-list time',()=>{
 const c=API.createClock();c.step(0,{projectId:A,foreground:true,activity:true});c.step(10000,{projectId:B});c.step(15000,{projectId:''});c.step(20000);assert.deepEqual(plain(c.take()),[{projectId:A,deltaMs:10000},{projectId:B,deltaMs:5000}]);c.step(25000,{projectId:A,activity:true});c.step(26000);assert.deepEqual(plain(c.take()),[{projectId:A,deltaMs:1000}]);
});
test('activity clock pauses hidden or unfocused time without catch-up',()=>{
 const c=API.createClock();c.step(0,{projectId:A,foreground:true,activity:true});c.step(10000,{foreground:false});c.step(70000,{foreground:true});c.step(75000);assert.deepEqual(plain(c.take()),[{projectId:A,deltaMs:15000}]);c.step(80000,{foreground:false});c.step(800000,{foreground:true});c.step(801000);assert.deepEqual(plain(c.take()),[{projectId:A,deltaMs:5000}]);
});
test('activity clock rejects trial and non-formal project contexts',()=>{
 for(const projectId of ['',TRIAL,'not-a-project','11111111-1111-1111-1111-111111111111']){const c=API.createClock();c.step(0,{projectId,foreground:true,activity:true});c.step(10000);assert.deepEqual(plain(c.take()),[]);}
});
test('activity clock preserves fractions and is monotonic under a backwards wall-clock sample',()=>{
 const c=API.createClock();c.step(0,{projectId:A,foreground:true,activity:true});c.step(.6);assert.deepEqual(plain(c.take()),[]);c.step(1.2);assert.deepEqual(plain(c.take()),[{projectId:A,deltaMs:1}]);c.step(.2);assert.deepEqual(plain(c.take()),[]);c.step(2.2);assert.deepEqual(plain(c.take()),[{projectId:A,deltaMs:1}]);
});
test('activity display handles zero, sub-minute, minutes and hours',()=>{
 assert.equal(API.format(0),'0分钟');assert.equal(API.format(1),'不足1分钟');assert.equal(API.format(60000),'1分钟');assert.equal(API.format(3660000),'1小时 1分钟');for(const value of [-1,NaN,Infinity])assert.throws(()=>API.format(value));
});
test('activity module has no network, business field content or workspace-revision coupling',()=>{
 assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|ProjectWorkspaceStore)\b/);assert.doesNotMatch(source,/(?:event|target|input)\.(?:key|code|value|textContent)\b/);assert.match(source,/hengdu\.project\.activity\.v1/);assert.match(source,/CHECKPOINT_MS=10000/);
});
test('real IndexedDB activity accumulation: project binding, additive concurrent writes, lifecycle, failure retry and local-only schema',async()=>{
 const {chromium}=require('playwright'),server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end('<!doctype html><button id="operate">操作（合成）</button>');});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));let browser;
 try{browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()});const context=await browser.newContext(),errors=[];const url='http://127.0.0.1:'+server.address().port;
  async function makePage(){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.addScriptTag({content:source});await p.evaluate(({A})=>{globalThis.at=0;globalThis.fg=true;globalThis.projectId=A;globalThis.events=[];window.addEventListener('project-activity-updated',e=>events.push(e.detail));const interval=window.setInterval;window.setInterval=(fn,ms)=>{globalThis.checkpoint=fn;globalThis.checkpointDelay=ms;return interval(fn,ms);};globalThis.ctl=ProjectActivity.mount({resolveProject:()=>projectId,now:()=>at,getForeground:()=>fg});window.setInterval=interval;globalThis.operate=async()=>{document.querySelector('#operate').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await Promise.resolve();};}, {A});return p;}
  const a=await makePage();assert.deepEqual(await a.evaluate(id=>ProjectActivity.read(id),A),{totalMs:0});
  assert.equal(await a.evaluate(async trial=>{for(const key of [trial,'bad-id']){try{await ProjectActivity.read(key);return false;}catch{}}return true;},TRIAL),true);
  await a.evaluate(async()=>{at=1000;await ctl.flush();});assert.equal((await a.evaluate(id=>ProjectActivity.read(id),A)).totalMs,0);
  await a.evaluate(async()=>{await operate();at=6000;const x=ctl.flush();at=7000;const y=ctl.flush();at=8000;const z=ctl.flush();await Promise.all([x,y,z]);});assert.equal((await a.evaluate(id=>ProjectActivity.read(id),A)).totalMs,7000);
  await a.evaluate(async B=>{projectId=B;at=9000;await ctl.refreshContext();at=11000;await ctl.flush();},B);assert.equal((await a.evaluate(id=>ProjectActivity.read(id),A)).totalMs,8000);assert.equal((await a.evaluate(id=>ProjectActivity.read(id),B)).totalMs,2000);
  await a.evaluate(async()=>{at=12000;projectId='';await ctl.refreshContext();at=50000;await ctl.flush();});assert.equal((await a.evaluate(id=>ProjectActivity.read(id),B)).totalMs,3000);
  // Context is sampled after the application's synchronous event handler selects B.
  await a.evaluate(async B=>{document.querySelector('#operate').addEventListener('pointerdown',()=>{projectId=B;},{once:true});at=51000;await operate();at=52000;await ctl.flush();},B);assert.equal((await a.evaluate(id=>ProjectActivity.read(id),B)).totalMs,4000);
  await a.evaluate(async()=>{at=53000;fg=false;window.dispatchEvent(new Event('blur'));await ctl.flush();at=65000;await ctl.flush();fg=true;window.dispatchEvent(new Event('focus'));at=66000;await ctl.flush();});assert.equal((await a.evaluate(id=>ProjectActivity.read(id),B)).totalMs,6000);
  // Failed transaction retains its unsaved additive delta and reports the error.
  const retry=await a.evaluate(async()=>{at=67000;const real=indexedDB.open;indexedDB.open=()=>{throw Error('synthetic denied');};let rejected=false;try{await ctl.flush();}catch{rejected=true;}indexedDB.open=real;at=68000;await ctl.flush();return{rejected,error:events.some(e=>e.error&&e.projectId===projectId)};});assert.deepEqual(retry,{rejected:true,error:true});assert.equal((await a.evaluate(id=>ProjectActivity.read(id),B)).totalMs,8000);
  // Two tabs use additive IndexedDB transactions; the unfocused tab contributes no time.
  await a.evaluate(async()=>{at=69000;fg=false;window.dispatchEvent(new Event('blur'));await ctl.flush();});const b=await makePage();await b.evaluate(async B=>{projectId=B;await ctl.refreshContext();await operate();at=4000;await ctl.flush();},B);assert.equal((await a.evaluate(id=>ProjectActivity.read(id),B)).totalMs,13000);
  await b.evaluate(async()=>{at=5000;fg=false;window.dispatchEvent(new Event('blur'));await ctl.flush();});await a.evaluate(async()=>{at=70000;fg=true;window.dispatchEvent(new Event('focus'));await operate();at=72000;await ctl.flush();});assert.equal((await a.evaluate(id=>ProjectActivity.read(id),B)).totalMs,16000);
  await a.evaluate(async()=>{at=73000;window.dispatchEvent(new Event('pagehide'));await ctl.flush();at=79000;await ctl.flush();});assert.equal((await a.evaluate(id=>ProjectActivity.read(id),B)).totalMs,17000);
  await a.evaluate(async()=>{await ctl.stop();at=99000;await operate();await ctl.flush();});assert.equal((await a.evaluate(id=>ProjectActivity.read(id),B)).totalMs,17000);
  const stored=await a.evaluate(async()=>{const q=indexedDB.open('hengdu.project.activity.v1',1),db=await new Promise((ok,no)=>{q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});try{return await new Promise((ok,no)=>{const tx=db.transaction('totals'),r=tx.objectStore('totals').getAll();tx.oncomplete=()=>ok(r.result);tx.onabort=()=>no(tx.error);});}finally{db.close();}});assert.equal(stored.length,2);for(const r of stored)assert.deepEqual(Object.keys(r).sort(),['projectId','schemaVersion','totalMs','updatedAt']);
  // Independent active sessions commit their deltas concurrently without read-modify-write loss.
  const c=await makePage(),d=await makePage();await Promise.all([c.evaluate(async()=>{await operate();at=1500;await ctl.flush();}),d.evaluate(async()=>{await operate();at=2500;await ctl.flush();})]);assert.equal((await a.evaluate(id=>ProjectActivity.read(id),A)).totalMs,12000);
  // Exercise the actual checkpoint callback without a wall-clock ten-second wait.
  assert.equal(await c.evaluate(()=>checkpointDelay),10000);await c.evaluate(async()=>{at=2500;checkpoint();await ctl.flush();});assert.equal((await a.evaluate(id=>ProjectActivity.read(id),A)).totalMs,13000);
  // A corrupted total must reject, never silently reset or replace earlier information.
  const corruption=await a.evaluate(async()=>{const projectId='99333333-3333-4333-8333-333333333333',q=indexedDB.open('hengdu.project.activity.v1',1),db=await new Promise((ok,no)=>{q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});try{await new Promise((ok,no)=>{const tx=db.transaction('totals','readwrite');tx.objectStore('totals').put({schemaVersion:1,projectId,totalMs:-1});tx.oncomplete=ok;tx.onabort=()=>no(tx.error);});}finally{db.close();}try{await ProjectActivity.read(projectId);return false;}catch{return true;}});assert.equal(corruption,true);assert.deepEqual(errors,[]);
  await context.close();
 }finally{await browser?.close();await new Promise(ok=>server.close(ok));}
});
