'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const Backup=require('../dist/backup-restore.js');
const Migration=require('../dist/quote-migration.js');

// All fixtures are generated from the current distribution in memory. These
// tests never launch a browser, read business data, or touch the v1 fixture.
const DIR=path.join(__dirname,'../dist');
const KEY='hengdu.audit.quote.records.v2';
const clone=value=>JSON.parse(JSON.stringify(value));
const v1Envelope=records=>JSON.stringify({app:'hengdu-audit-quote',schema:1,exportedAt:'2026-11-06T00:00:00.000Z',records});
const v2Envelope=records=>JSON.stringify({app:'hengdu-audit-quote-v2',schema:2,exportedAt:'2026-11-06T00:00:00.000Z',records});
const migrationArgs=(legacyRecords,extra={})=>({legacyRecords,firmId:'three-card-test-firm',actor:'three-card-test-operator',migratedAt:'2026-11-06T00:00:00.000Z',...extra});

function setup(raw){
  const dom=new JSDOM(fs.readFileSync(path.join(DIR,'index.html'),'utf8'),{url:'http://localhost/',runScripts:'outside-only'});
  const w=dom.window;
  w.confirm=()=>true;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.HTMLAnchorElement.prototype.click=function(){};
  w.URL.createObjectURL=()=> 'blob:three-card-test';
  w.URL.revokeObjectURL=()=>{};
  if(raw!==undefined)w.localStorage.setItem(KEY,raw);
  for(const file of ['calc.js','rule-catalog.js','regions.js','backup-restore.js','save-feedback.js','app.js']){
    let source=fs.readFileSync(path.join(DIR,file),'utf8');
    // The former selectors are gone. Set ordered historical fixtures without
    // bringing back the old UI or adding a production test hook.
    if(file==='app.js')source=source.replace('  sourceList();hydrate();',`  globalThis.legacyComparisonFixture = {
      ids: comparisonIds,
      set(index,id){const ids=comparisonIds();ids[index]=id;state.comparisonProvinceIds=ids;ensureRule(id,true);activeRule=id;update();}
    };
  sourceList();hydrate();`);
    w.eval(source);
  }
  return {dom,w,d:w.document};
}
function using(t,raw){const x=setup(raw);t.after(()=>x.dom.window.close());return x;}
function records(x){return JSON.parse(x.w.localStorage.getItem(KEY));}
function input(x,selector,value,event='input'){
  const el=x.d.querySelector(selector);assert.ok(el,selector);
  el.value=value;el.dispatchEvent(new x.w.Event(event,{bubbles:true}));
}
function selectSlot(x,index,id){x.w.legacyComparisonFixture.set(index,id);}
function displayedIds(x){return Array.from(x.w.legacyComparisonFixture.ids());}
function estimate(x,province){input(x,'#quote-region',province);x.d.querySelector('#comparison').dispatchEvent(new x.w.Event('submit',{bubbles:true,cancelable:true}));x.d.querySelector('#estimate-record-save').click();}
function load(x,id){assert.equal(x.d.querySelector('[data-view="history"]'),null);const button=x.d.querySelector(`#history-list [data-load="${id}"]`);assert.ok(button,'saved record can be restored');button.click();}
function seed(edit){
  const x=setup();
  try{if(edit)edit(x);x.d.querySelector('#save').click();const saved=records(x);assert.equal(saved?.length,1,'synthetic fixture saved successfully');return saved[0];}
  finally{x.dom.window.close();}
}
async function chooseBackup(x,text){
  const el=x.d.querySelector('#import-backup-file');
  Object.defineProperty(el,'files',{configurable:true,value:[new x.w.File([text],'three-card-test.json',{type:'application/json'})]});
  el.dispatchEvent(new x.w.Event('change',{bubbles:true}));
  for(let i=0;i<100;i++){
    await new Promise(resolve=>setTimeout(resolve,3));
    if(!x.d.querySelector('#import-backup-status').textContent.includes('尚未选择'))return;
  }
  throw Error('backup FileReader did not finish');
}
function blobText(x,blob){return new Promise((resolve,reject)=>{const reader=new x.w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob,'UTF-8');});}
function assertReviewLocked(x){
  assert.equal(x.d.querySelector('#restore-recalc-warning').hidden,false,'historical recalculation still needs explicit acceptance');
  for(const id of ['save','save-revision','csv','preview','register-quote'])assert.equal(x.d.querySelector('#'+id).disabled,true,id+' remains blocked');
}

test('explicit ordered three-card selection survives save, reload, revision and exact backup roundtrip',async t=>{
  const x=using(t);
  selectSlot(x,0,'sh');selectSlot(x,1,'gx');selectSlot(x,2,'hb');
  x.d.querySelector('#save').click();
  const original=records(x)[0],before=JSON.stringify(original),raw=x.w.localStorage.getItem(KEY);
  assert.deepEqual(original.snapshot.comparisonProvinceIds,['sh','gx','hb']);
  assert.equal(original.snapshot.selectedProvince,'sh');

  const y=using(t,raw);load(y,original.id);
  assert.deepEqual(displayedIds(y),['sh','gx','hb']);
  assert.equal(y.d.querySelector('#restore-recalc-warning').hidden,true);
  assert.equal(y.w.localStorage.getItem(KEY),raw,'restore does not normalize or rewrite the original');
  input(y,'#client-form [name="location"]','河北');
  assert.deepEqual(displayedIds(y),['hb','gx','hb'],'only the client slot follows the changed customer location');
  y.d.querySelector('#save-revision').click();
  const revised=records(y);
  assert.equal(revised.length,2);assert.equal(revised[0].revisionRoot,original.id);assert.equal(revised[0].revisionNo,2);
  assert.deepEqual(revised[0].snapshot.comparisonProvinceIds,['hb','gx','hb']);
  assert.equal(JSON.stringify(revised[1]),before,'a revision does not retrofit fields into its root');

  let blob=null;y.w.URL.createObjectURL=b=>(blob=b,'blob:three-card-backup');
  y.d.querySelector('#export-backup').click();assert.ok(blob);
  const backup=await blobText(y,blob),envelope=JSON.parse(backup.replace(/^\uFEFF/,''));
  assert.deepEqual(envelope.records,revised);
  const z=using(t);await chooseBackup(z,backup);
  assert.match(z.d.querySelector('#import-backup-status').textContent,/新增 2 条/);
  assert.equal(z.w.localStorage.getItem(KEY),null,'preview is read-only');
  z.d.querySelector('#import-backup-confirm').click();assert.deepEqual(records(z),revised);
  load(z,revised[0].id);assert.deepEqual(displayedIds(z),['hb','gx','hb']);
  assert.equal(z.d.querySelector('#restore-recalc-warning').hidden,true);
});

test('new drafts persist Beijing and keep customer/team synchronization across save and restore',t=>{
  const original=seed();assert.deepEqual(original.snapshot.comparisonProvinceIds,['gx','hb','110000']);
  const raw=JSON.stringify([original]),x=using(t,raw);load(x,original.id);
  input(x,'#client-form [name="location"]','上海');
  assert.deepEqual(displayedIds(x),['sh','hb','110000']);
  assert.equal(x.w.localStorage.getItem(KEY),raw);
  x.d.querySelector('#save-revision').click();
  assert.deepEqual(records(x)[0].snapshot.comparisonProvinceIds,['sh','hb','110000']);
});

test('legacy snapshots without the new field infer three ordered slots without rewriting raw data',t=>{
  const base=seed();
  const cases=[
    {name:'saved comparison takes precedence over customer',location:'广西',selectedProvince:'hb',expected:['hb','hb','sh']},
    {name:'missing comparison infers Hebei',location:'河北',expected:['hb','hb','sh']},
    {name:'missing comparison infers Shanghai',location:'上海',expected:['sh','hb','sh']},
    {name:'missing comparison infers Guangxi',location:'广西',expected:['gx','hb','sh']},
    {name:'unknown historical customer keeps an empty first slot',location:'其他地区',expected:['','hb','sh']}
  ];
  for(const c of cases){
    const old=clone(base);delete old.snapshot.comparisonProvinceIds;delete old.snapshot.selectedProvince;
    old.snapshot.client.location=c.location;
    if(Object.hasOwn(c,'selectedProvince'))old.snapshot.selectedProvince=c.selectedProvince;
    const raw=JSON.stringify([old]),x=using(t,raw);load(x,old.id);
    assert.deepEqual(displayedIds(x),c.expected,c.name);
    assert.equal(x.w.localStorage.getItem(KEY),raw,c.name+' leaves old storage untouched');
    if(c.expected[0])assert.equal(x.d.querySelector('#restore-recalc-warning').hidden,true,c.name+' does not change any historical calculation');
    else{
      assert.match(x.d.querySelector('#client-error').textContent,/待确认/);
      assert.equal(x.d.querySelector('#save').disabled,true);
      assert.equal(x.d.querySelector('#quote-form [name=basis] option[value=gx]'),null);
    }
  }
});

test('an explicitly empty first slot is not overwritten by a known customer location on restore',t=>{
  const original=seed();original.snapshot.comparisonProvinceIds=['','hb','sh'];original.snapshot.selectedProvince='';
  const raw=JSON.stringify([original]),x=using(t,raw);load(x,original.id);
  assert.deepEqual(displayedIds(x),['','hb','sh']);
  input(x,'#client-form [name="location"]','上海');assert.deepEqual(displayedIds(x),['sh','hb','sh']);
  assert.equal(x.w.localStorage.getItem(KEY),raw);
});

const malformedSelections=[
  ['null',null],['object',{0:'gx',1:'hb',2:'sh',length:3}],['empty',[]],
  ['short',['gx','hb']],['long',['gx','hb','sh','gx']],['non-string',[450000,'hb','sh']],
  ['unknown',['999999','hb','sh']],['second empty',['gx','','sh']],['third empty',['gx','hb','']]
];
test('malformed present comparison selections are rejected by local restore, backup parser and migration without data loss',async t=>{
  const good=seed();
  for(const [label,value] of malformedSelections){
    const bad=clone(good);bad.snapshot.comparisonProvinceIds=clone(value);
    const raw=JSON.stringify([bad]),before=JSON.stringify(bad),x=using(t,raw);
    assert.equal(x.d.querySelector('[data-view="history"]'),null);
    assert.match(x.d.querySelector('#history-list').textContent,/禁止写入和删除/,label);
    assert.equal(x.d.querySelector('#history-list [data-load]'),null,label+' is not normalized into a usable record');
    x.d.querySelector('#save').dispatchEvent(new x.w.Event('click',{bubbles:true}));
    x.d.querySelector('#clear-history').click();assert.equal(x.w.localStorage.getItem(KEY),raw,label+' keeps local raw');
    let blob=null;x.w.URL.createObjectURL=b=>(blob=b,'blob:invalid-three-card-raw');
    x.d.querySelector('#export-backup').click();assert.ok(blob,label+' can still export original raw');
    assert.equal(await blobText(x,blob),raw,label+' raw export is byte-for-string exact');
    assert.throws(()=>Backup.previewBackup(v1Envelope([bad]),null),undefined,label+' backup parser refuses malformed new field');
    const other=clone(good);other.id='three-card-valid-before-'+label.replace(/ /g,'-');
    const preview=Migration.preview(migrationArgs([other,bad]));
    assert.equal(preview.ok,false,label);assert.equal(preview.added.length,0,label+' blocks the entire migration batch');
    assert.equal(preview.unchanged.length,0,label);assert.equal(JSON.stringify(bad),before,label+' original remains untouched');
    x.dom.window.close();
  }
});

test('invalid comparison array in an imported backup refuses the entire batch and preserves current storage',async t=>{
  const good=seed(),raw=JSON.stringify([good]),x=using(t,raw),bad=clone(good),extra=clone(good);
  bad.id='three-card-invalid-incoming';bad.snapshot.comparisonProvinceIds=['gx','','sh'];extra.id='three-card-valid-incoming';
  const backup=v2Envelope([extra,bad]);await chooseBackup(x,backup);
  assert.match(x.d.querySelector('#import-backup-status').textContent,/未导入/);
  assert.equal(x.d.querySelector('#import-backup-confirm').disabled,true);
  x.d.querySelector('#import-backup-confirm').dispatchEvent(new x.w.Event('click',{bubbles:true}));
  assert.equal(x.w.localStorage.getItem(KEY),raw);
});

test('hidden custom rules and their calculation snapshots survive switching cards and normal restore',t=>{
  const x=using(t);selectSlot(x,2,'sh');selectSlot(x,1,'110000');x.d.querySelector('[data-view="rules"]').click();
  x.d.querySelector('[data-rule="110000"]').click();
  input(x,'#rules-form [name="mode"]','fixed','change');input(x,'#rules-form [name="fixedYuan"]','7654');
  x.d.querySelector('#rules-form').dispatchEvent(new x.w.Event('submit',{bubbles:true,cancelable:true}));
  x.d.querySelector('[data-view="quote"]').click();
  selectSlot(x,1,'hb');x.d.querySelector('#save').click();
  const original=records(x)[0],raw=x.w.localStorage.getItem(KEY),hidden=original.snapshot.rules.find(r=>r.id==='110000');
  assert.ok(hidden,'switching away does not discard the custom rule');
  assert.equal(original.calculation.regions['110000'].totalCents,765400,'hidden outputs remain in the historical calculation');
  assert.equal(original.snapshot.rules.filter(r=>r.id==='110000').length,1);

  const y=using(t,raw);load(y,original.id);
  assert.equal(y.d.querySelector('#restore-recalc-warning').hidden,true,'non-visible historical outputs also reproduce exactly');
  assert.equal(y.w.localStorage.getItem(KEY),raw);
  estimate(y,'北京');
  const amount=y.d.querySelector('#quote-estimates-rows .quote-record-amount');assert.match(amount.textContent,/7,730\.54/);
  assert.ok(amount.title.includes(hidden.version));assert.ok(amount.title.includes(hidden.document));
  y.d.querySelector('#save-revision').click();
  assert.deepEqual(records(y)[0].snapshot.rules.find(r=>r.id==='110000'),hidden);
  assert.equal(JSON.stringify(records(y)[1]),JSON.stringify(original));
});

test('legacy duplicate selections use unique rule tabs and basis options',t=>{
  const x=using(t);selectSlot(x,0,'hb');selectSlot(x,2,'hb');
  assert.deepEqual(displayedIds(x),['hb','hb','hb']);
  const basis=x.d.querySelector('#quote-form [name="basis"]'),values=[...basis.options].map(o=>o.value);
  assert.equal(values.filter(id=>id==='hb').length,1);assert.equal(new Set(values).size,values.length);
  x.d.querySelector('[data-view="rules"]').click();
  const tabs=[...x.d.querySelectorAll('#rule-tabs [data-rule]')].map(el=>el.dataset.rule);assert.deepEqual(tabs,['hb']);
  x.d.querySelector('[data-view="quote"]').click();x.d.querySelector('#save').click();
  assert.deepEqual(records(x)[0].snapshot.comparisonProvinceIds,['hb','hb','hb']);
  assert.equal(new Set(records(x)[0].snapshot.rules.map(r=>r.id)).size,records(x)[0].snapshot.rules.length);
});

test('historical recalculation warnings cannot be bypassed by card, customer, basis or rule changes',t=>{
  for(const kind of ['budget','regional-detail']){
    const original=seed();
    if(kind==='budget')original.snapshot.budget[0].hours='99';
    else original.calculation.regions.hb.lines[1].amountCents++;
    const raw=JSON.stringify([original]),x=using(t,raw);load(x,original.id);assertReviewLocked(x);
    estimate(x,'广西');assertReviewLocked(x);assert.match(x.d.querySelector('#quote-region-message').textContent,/确认历史复算/);
    input(x,'#client-form [name="location"]','上海');assertReviewLocked(x);
    input(x,'#quote-form [name="basis"]','manual');input(x,'#quote-form [name="manual"]','12345');assertReviewLocked(x);
    x.d.querySelector('[data-view="rules"]').click();input(x,'#rules-region-select','gx','change');
    input(x,'#rules-form [name="mode"]','fixed','change');input(x,'#rules-form [name="fixedYuan"]','8888');
    x.d.querySelector('#rules-form').dispatchEvent(new x.w.Event('submit',{bubbles:true,cancelable:true}));assertReviewLocked(x);
    x.d.querySelector('[data-view="quote"]').click();x.w.confirm=()=>false;x.d.querySelector('#accept-recalculation').click();assertReviewLocked(x);
    x.d.querySelector('#save').dispatchEvent(new x.w.Event('click',{bubbles:true}));
    x.d.querySelector('#save-revision').dispatchEvent(new x.w.Event('click',{bubbles:true}));
    assert.equal(x.w.localStorage.getItem(KEY),raw,kind+' keeps the original history unchanged');
    x.w.confirm=()=>true;x.d.querySelector('#accept-recalculation').click();
    assert.equal(x.d.querySelector('#restore-recalc-warning').hidden,true);assert.equal(x.w.localStorage.getItem(KEY),raw);
  }
});

test('an invalid historical regional basis produces an explicit error instead of falling back to budget',t=>{
  const original=seed();delete original.snapshot.comparisonProvinceIds;original.snapshot.quote.basis='not-a-province';
  const raw=JSON.stringify([original]),x=using(t,raw);load(x,original.id);
  assert.equal(x.d.querySelector('#final-price').textContent,'—');
  assert.notEqual(x.d.querySelector('#quote-form [name="basis"]').value,'budget');
  assert.ok(x.d.querySelector('#quote-error').textContent.trim(),'invalid saved basis has an explicit explanation');
  assertReviewLocked(x);assert.equal(x.w.localStorage.getItem(KEY),raw);
});

test('same-id records differing only in comparison order conflict rather than merge as identical',async t=>{
  const original=seed(x=>selectSlot(x,0,'gx')),incoming=clone(original),raw=JSON.stringify([original]);
  incoming.snapshot.comparisonProvinceIds=['gx','sh','hb'];
  assert.throws(()=>Backup.previewBackup(v1Envelope([incoming]),raw),/冲突/);
  const x=using(t,raw);await chooseBackup(x,v2Envelope([incoming]));
  assert.match(x.d.querySelector('#import-backup-status').textContent,/冲突/);assert.equal(x.w.localStorage.getItem(KEY),raw);
  const first=Migration.preview(migrationArgs([original]));assert.equal(first.ok,true);
  const next=Migration.preview(migrationArgs([incoming],{existing:first.added}));assert.equal(next.ok,false);
  assert.equal(next.added.length,0);assert.match(next.errors[0].reason,/冲突/);
});

test('migration preserves exact ordered duplicate selection in original and remains idempotent',()=>{
  const original=seed(x=>{selectSlot(x,0,'hb');selectSlot(x,2,'hb');}),before=clone(original);
  const preview=Migration.preview(migrationArgs([original]));assert.equal(preview.ok,true,JSON.stringify(preview.errors));assert.equal(preview.added.length,1);
  const entry=preview.added[0];assert.deepEqual(entry.original,before);
  assert.deepEqual(entry.original.snapshot.comparisonProvinceIds,['hb','hb','hb']);
  assert.ok(Object.isFrozen(entry.original.snapshot.comparisonProvinceIds));
  assert.deepEqual(entry.quote.revisions[0].details.rules.map(r=>r.snapshot),before.snapshot.rules);
  const repeated=Migration.preview(migrationArgs([original],{existing:[entry],actor:'another-test-operator'}));
  assert.equal(repeated.ok,true);assert.equal(repeated.added.length,0);assert.deepEqual(repeated.unchanged[0],entry);
  original.snapshot.comparisonProvinceIds[0]='gx';assert.deepEqual(entry.original,before,'migration is detached from the caller');
});
