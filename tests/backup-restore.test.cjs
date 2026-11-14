'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const B=require('../dist/backup-restore.js');
const dir=path.join(__dirname,'../dist');
function record(){
  const dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8'),{url:'http://localhost/',runScripts:'outside-only'});
  const w=dom.window;w.confirm=()=>true;
  for(const f of ['calc.js','regions.js','rule-catalog.js','app.js'])w.eval(fs.readFileSync(path.join(dir,f),'utf8'));
  w.document.querySelector('#save').click();
  const raw=w.localStorage.getItem('hengdu.audit.quote.records.v2');dom.window.close();
  assert.ok(raw);return JSON.parse(raw)[0];
}
const r=record();const clone=x=>JSON.parse(JSON.stringify(x));
const envelope=rows=>JSON.stringify({app:'hengdu-audit-quote',schema:1,exportedAt:'2026-11-04T00:00:00.000Z',records:rows});
test('accepts real v0.1 exported envelope with BOM and freezes entire preview',()=>{
  const p=B.previewBackup('\ufeff'+envelope([r]),null);
  assert.equal(p.addedCount,1);assert.equal(p.existingCount,0);assert.equal(p.expectedCurrentRaw,null);
  assert.deepEqual(p.mergedRecords[0],r);assert.ok(Object.isFrozen(p));assert.ok(Object.isFrozen(p.mergedRecords[0].snapshot.rules[0].tiers));
  assert.throws(()=>{p.mergedRecords[0].id='other'},TypeError);
});
test('merges without mutation, preserves existing order and skips semantically identical object with reordered fields',()=>{
  const existing=JSON.stringify([r]);const next=clone(r);next.id='other';
  const reversed=Object.fromEntries(Object.entries(clone(r)).reverse());
  const p=B.previewBackup(envelope([reversed,next]),existing);
  assert.equal(p.addedCount,1);assert.equal(p.identicalCount,1);assert.deepEqual(p.mergedRecords.map(x=>x.id),[r.id,'other']);assert.equal(p.expectedCurrentRaw,existing);
});
test('different data with same ID is rejected and all inputs remain unchanged',()=>{
  const updated=clone(r);updated.snapshot.client.clientName='other';const before=JSON.stringify([r]);const backup=envelope([updated]);
  assert.throws(()=>B.previewBackup(backup,before),/冲突/);assert.equal(JSON.stringify([r]),before);assert.equal(backup,envelope([updated]));
});
test('rejects unknown application, schema, record and mixed bad records',()=>{
  for(const edit of [x=>x.app='future',x=>x.schema=2,x=>x.records[0].appVersion='9',x=>x.records[0].snapshot.schema=2,x=>x.records.push({id:'new',snapshot:{schema:2}})]){
    const backup=JSON.parse(envelope([r]));edit(backup);assert.throws(()=>B.previewBackup(JSON.stringify(backup),null));
  }
});
test('rejects corrupt current storage, duplicates and malformed nested snapshots',()=>{
  assert.throws(()=>B.previewBackup(envelope([r]),'{broken'));
  assert.throws(()=>B.previewBackup(envelope([r]),JSON.stringify([r,r])),/重复/);
  assert.throws(()=>B.previewBackup(envelope([r,r]),null),/重复/);
  for(const edit of [x=>delete x.snapshot.client.assets,x=>x.snapshot.budget=[{}],x=>x.snapshot.rules[0].tiers=null,x=>x.totalCents=NaN,x=>x.calculation.quote.totalCents=0]){
    const bad=clone(r);edit(bad);assert.throws(()=>B.previewBackup(envelope([bad]),null));
  }
});
test('rejects prototype-pollution keys recursively even when otherwise harmless',()=>{
  for(const key of ['__proto__','prototype','constructor']){
    const bad=envelope([r]).replace('"snapshot":{','"snapshot":{"'+key+'":{"polluted":true},');
    assert.throws(()=>B.previewBackup(bad,null),/禁止/);
  }
  assert.equal({}.polluted,undefined);
});
test('rejects oversized strings, records, depth, unsupported raw array export and nontext current',()=>{
  assert.throws(()=>B.previewBackup('x'.repeat(B.MAX_BYTES+1),null),/过大/);
  assert.throws(()=>B.previewBackup(envelope(new Array(B.MAX_RECORDS+1).fill(r)),null));
  let deep={};for(let i=0;i<35;i++)deep={inner:deep};const bad=clone(r);bad.extra=deep;assert.throws(()=>B.previewBackup(envelope([bad]),null),/层级/);
  assert.throws(()=>B.previewBackup(JSON.stringify([r]),null),/备份格式/);
  assert.throws(()=>B.previewBackup(envelope([r]),[]),/原始文本/);
});
test('supports a browser-like global without CommonJS or network',()=>{
  const sandbox={TextEncoder};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(dir,'backup-restore.js'),'utf8'),sandbox);
  const old=clone(r);delete old.snapshot.comparisonProvinceIds;assert.equal(sandbox.QuoteBackup.previewBackup(envelope([old]),null).addedCount,1);
  assert.throws(()=>sandbox.QuoteBackup.previewBackup(envelope([r]),null));vm.runInContext(fs.readFileSync(path.join(dir,'rule-catalog.js'),'utf8'),sandbox);vm.runInContext(fs.readFileSync(path.join(dir,'backup-restore.js'),'utf8'),sandbox);assert.equal(sandbox.QuoteBackup.previewBackup(envelope([r]),null).addedCount,1);
});
