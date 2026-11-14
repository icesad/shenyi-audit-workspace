const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const KEY='hengdu.audit.quote.records.v2',dir=path.join(__dirname,'../dist');
function setup(raw){
 const dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8'),{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window;
 w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){};w.HTMLDialogElement.prototype.close=function(){};
 if(raw!==undefined)w.localStorage.setItem(KEY,raw);
 for(const f of ['calc.js','rule-catalog.js','regions.js','backup-restore.js','app.js'])w.eval(fs.readFileSync(path.join(dir,f),'utf8'));
 return {dom,w,d:w.document};
}
function sample(){const x=setup();x.d.querySelector('#save').click();const r=JSON.parse(x.w.localStorage.getItem(KEY))[0];x.dom.window.close();return r;}
const record=sample();
const envelope=(rs)=>JSON.stringify({app:'hengdu-audit-quote-v2',schema:2,exportedAt:'2026-11-04T00:00:00Z',records:rs});
async function choose(x,text){
 const file=new x.w.File([text],'backup.json',{type:'application/json'}),input=x.d.querySelector('#import-backup-file');
 Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new x.w.Event('change',{bubbles:true}));
 for(let i=0;i<50;i++){await new Promise(resolve=>setTimeout(resolve,2));if(!x.d.querySelector('#import-backup-status').textContent.includes('尚未选择'))return;}
 throw Error('FileReader did not finish');
}
test('preview adds only after user confirms, duplicate import is skipped',async()=>{
 const x=setup();await choose(x,envelope([record]));assert.match(x.d.querySelector('#import-backup-status').textContent,/新增 1 条/);assert.equal(x.w.localStorage.getItem(KEY),null);
 x.w.confirm=()=>false;x.d.querySelector('#import-backup-confirm').click();assert.equal(x.w.localStorage.getItem(KEY),null);
 x.w.confirm=()=>true;x.d.querySelector('#import-backup-confirm').click();assert.equal(JSON.parse(x.w.localStorage.getItem(KEY)).length,1);
 await choose(x,envelope([record]));assert.match(x.d.querySelector('#import-backup-status').textContent,/完全相同跳过 1 条/);assert.equal(x.d.querySelector('#import-backup-confirm').disabled,true);x.dom.window.close();
});
test('conflicting id refuses entire import, even alongside new record',async()=>{
 const raw=JSON.stringify([record]),x=setup(raw),conflict=JSON.parse(JSON.stringify(record));conflict.snapshot.client.clientName='different';const extra=JSON.parse(JSON.stringify(record));extra.id='different-id';
 await choose(x,envelope([extra,conflict]));assert.match(x.d.querySelector('#import-backup-status').textContent,/冲突/);assert.equal(x.d.querySelector('#import-backup-confirm').disabled,true);assert.equal(x.w.localStorage.getItem(KEY),raw);x.dom.window.close();
});
test('invalid and unknown version backups never alter records',async()=>{
 for(const text of ['{bad',JSON.stringify({app:'other',schema:2,exportedAt:'2026-11-04',records:[]})]){const x=setup();await choose(x,text);assert.match(x.d.querySelector('#import-backup-status').textContent,/未导入/);assert.equal(x.w.localStorage.getItem(KEY),null);x.dom.window.close()}
});
test('new data written in another tab between preview and confirmation is preserved',async()=>{
 const x=setup();await choose(x,envelope([record]));const raw='[{"id":"other-tab","snapshot":{"schema":2}}]';x.w.localStorage.setItem(KEY,raw);x.d.querySelector('#import-backup-confirm').click();assert.equal(x.w.localStorage.getItem(KEY),raw);assert.match(x.d.querySelector('#import-backup-status').textContent,/已变化/);assert.equal(x.d.querySelector('#import-backup-confirm').disabled,true);x.dom.window.close();
});
test('record accepted by standalone parser but invalid for page is refused before writing',async()=>{
 const x=setup(),bad=JSON.parse(JSON.stringify(record));bad.snapshot.rules=bad.snapshot.rules.filter(r=>r.id!=='hb');await choose(x,envelope([bad]));assert.match(x.d.querySelector('#import-backup-status').textContent,/不能被当前页面安全恢复/);assert.equal(x.w.localStorage.getItem(KEY),null);x.dom.window.close();
});
test('legacy records infer known province, but unknown location requires correction and original raw remains untouched',()=>{
 for(const [location,expected] of [['河北','hb'],['上海','sh'],['广西','gx'],['其他地区','']]){
  const old=JSON.parse(JSON.stringify(record));old.snapshot.client.location=location;delete old.snapshot.selectedProvince;delete old.snapshot.comparisonProvinceIds;const raw=JSON.stringify([old]),x=setup(raw);
  x.d.querySelector('#history-list [data-load]').click();assert.equal(x.d.querySelector('[data-comparison-slot="0"]').value,expected);
  if(!expected){assert.match(x.d.querySelector('#client-error').textContent,/待确认/);assert.equal(x.d.querySelector('#save').disabled,true);assert.ok(![...x.d.querySelectorAll('[data-comparison-slot]')].some(e=>e.value==='gx'));}
  assert.equal(x.w.localStorage.getItem(KEY),raw);x.dom.window.close();
 }
});
test('oversized file is rejected without loading or writing',()=>{
 const x=setup(),input=x.d.querySelector('#import-backup-file');Object.defineProperty(input,'files',{configurable:true,value:[{size:10*1024*1024+1}]});input.dispatchEvent(new x.w.Event('change',{bubbles:true}));assert.match(x.d.querySelector('#import-backup-status').textContent,/超过/);assert.equal(x.w.localStorage.getItem(KEY),null);x.dom.window.close();
});

test('backup with region id and name mismatch is rejected without modifying storage',async()=>{const x=setup(),bad=JSON.parse(JSON.stringify(record));bad.snapshot.rules.find(r=>r.id==='gx').name='北京市';await choose(x,envelope([bad]));assert.match(x.d.querySelector('#import-backup-status').textContent,/不能被当前页面安全恢复/);assert.equal(x.w.localStorage.getItem(KEY),null);x.dom.window.close()});
