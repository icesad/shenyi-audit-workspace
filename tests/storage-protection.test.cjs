const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const KEY='hengdu.audit.quote.records.v2';const dir=path.join(__dirname,'../dist');
function setup(raw){const dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8'),{url:'http://localhost/',runScripts:'outside-only'});const w=dom.window;w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};let captured=null;w.URL.createObjectURL=blob=>(captured=blob,'blob:test');w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};if(raw!==undefined)w.localStorage.setItem(KEY,raw);for(const file of ['calc.js','rule-catalog.js','regions.js','backup-restore.js','app.js'])w.eval(fs.readFileSync(path.join(dir,file),'utf8'));return {dom,w,d:w.document,getBlob:()=>captured};}
function readBlob(w,blob){return new Promise((resolve,reject)=>{const r=new w.FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsText(blob,'utf-8');});}
function validRaw(){const x=setup();x.d.querySelector('#save').click();const raw=x.w.localStorage.getItem(KEY);x.dom.window.close();return raw;}
for(const [name,raw] of [
  ['malformed JSON','{ broken 中文'],
  ['unknown schema',JSON.stringify([{id:'future',snapshot:{schema:2}}])],
  ['nonarray','{"unexpected":true}'],
  ['partially malformed',JSON.stringify([{id:'broken',snapshot:{schema:1}}])],
  ['unknown app version',(()=>{const r=JSON.parse(validRaw());r[0].appVersion='9.0';return JSON.stringify(r);})()],
  ['mixed known and unknown',(()=>{const r=JSON.parse(validRaw());r.push({id:'future',snapshot:{schema:2}});return JSON.stringify(r);})()],
]) test('refuses destructive writes and exports exact stored string: '+name,async()=>{
  const {dom,w,d,getBlob}=setup(raw);assert.match(d.querySelector('#history-list').textContent,/禁止写入和删除/);assert.equal(d.querySelector('[data-delete]'),null);
  d.querySelector('#clear-history').click();assert.equal(w.localStorage.getItem(KEY),raw);
  d.querySelector('#save').click();assert.equal(w.localStorage.getItem(KEY),raw);
  // Even synthetic delete attempts cannot select silently discarded records.
  const fake=d.createElement('button');fake.dataset.delete='future';d.querySelector('#history-list').appendChild(fake);fake.click();assert.equal(w.localStorage.getItem(KEY),raw);
  d.querySelector('#export-backup').click();assert.ok(getBlob());assert.equal(await readBlob(w,getBlob()),raw);dom.window.close();
});
test('another tab modifying storage is detected before save, delete or clear and its raw value can be exported',async()=>{
  for(const action of ['save','delete','clear']){const {dom,w,d,getBlob}=setup(validRaw());const unknown='[{"id":"next","snapshot":{"schema":2}}]';w.localStorage.setItem(KEY,unknown);
    if(action==='save')d.querySelector('#save').click();else if(action==='delete')d.querySelector('[data-delete]').click();else d.querySelector('#clear-history').click();
    assert.equal(w.localStorage.getItem(KEY),unknown);assert.match(d.querySelector('#history-list').textContent,/禁止写入和删除/);d.querySelector('#export-backup').click();assert.equal(await readBlob(w,getBlob()),unknown);dom.window.close();}
});
test('known records continue to support normal deletion and save',()=>{const {dom,w,d}=setup(validRaw());d.querySelector('[data-delete]').click();assert.deepEqual(JSON.parse(w.localStorage.getItem(KEY)),[]);d.querySelector('#save').click();assert.equal(JSON.parse(w.localStorage.getItem(KEY)).length,1);dom.window.close();});
test('malformed nested tiers locks records before rendering or deletion',async()=>{const items=JSON.parse(validRaw());items[0].snapshot.rules[0].tiers='broken';const raw=JSON.stringify(items);const {dom,w,d,getBlob}=setup(raw);assert.match(d.querySelector('#history-list').textContent,/禁止写入和删除/);d.querySelector('#clear-history').click();assert.equal(w.localStorage.getItem(KEY),raw);d.querySelector('#export-backup').click();assert.equal(await readBlob(w,getBlob()),raw);dom.window.close()});
test('export notices another tab changed storage even without attempted write',async()=>{const {dom,w,d,getBlob}=setup(validRaw());const next='[{"id":"future","snapshot":{"schema":2}}]';w.localStorage.setItem(KEY,next);d.querySelector('#export-backup').click();assert.equal(await readBlob(w,getBlob()),next);assert.match(d.querySelector('#history-list').textContent,/禁止写入和删除/);dom.window.close()});
