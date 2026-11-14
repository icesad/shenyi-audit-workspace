'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const file=path.join(__dirname,'..','dist','auditee-rows.js'), api=require(file);
const row=(name,attrs={})=>({clientName:name,location:'广西',year:'2025',assets:'10',revenue:'4',profit:'-2',dataPeriod:'2025 年度',...attrs});
test('strict subject row state shape prevents partial restore',()=>{
  const r=row('Mock');assert.equal(api.valid({rows:[r],active:0}),true);
  for(const v of [null,{rows:[],active:0},{rows:Array(2),active:0},{rows:[{...r,extra:1}],active:0},{rows:[{...r,assets:1}],active:0},{rows:[r],active:'0'},{rows:[r],active:1},{rows:[r],active:-1},{rows:[r],active:0,extra:1},{rows:[{...r,year:'a'.repeat(90)}],active:0},{rows:Array(51).fill(r),active:0}]){
    assert.equal(api.valid(v),false);
  }
});
test('subject table edits, switches, preserves financial periods, safe rendering and cap',()=>{
  const dom=new JSDOM('<main><div id="auditee-list"></div></main>',{runScripts:'outside-only'});
  try{const w=dom.window,d=w.document,selected=[],edits=[],r=row('Synthetic A'),s=row('<img onerror=alert(1)>',{dataPeriod:'2026 年度'});w.eval(fs.readFileSync(file,'utf8'));
    w.confirm=()=>false;const roster=w.AuditeeRows.mount({getClient:()=>r,onSelect:v=>selected.push(v),onEdit:()=>edits.push(1)});
    roster.load([r,s],0);assert.equal(selected.length,0);assert.equal(edits.length,0);assert.equal(d.querySelector('#auditee-list img'),null);
    roster.syncClient({...r,assets:'12.3',dataPeriod:undefined});
    assert.equal(roster.snapshot().rows[0].dataPeriod,r.dataPeriod);assert.equal(d.querySelector('[data-auditee-row="0"]').cells[3].textContent,'12.3');
    d.querySelector('[data-auditee-select="1"]').click();assert.equal(selected.at(-1).clientName,s.clientName);
    const p=d.querySelector('[data-auditee-period]');p.value='核对后更新';p.dispatchEvent(new w.Event('input'));assert.equal(roster.snapshot().rows[1].dataPeriod,'核对后更新');assert.equal(d.querySelector('[data-auditee-row="1"]').cells[6].textContent,'核对后更新');assert.equal(roster.snapshot().rows[0].assets,'12.3');
    const snapshot=roster.snapshot();snapshot.rows[0].assets='0';assert.equal(roster.snapshot().rows[0].assets,'12.3');
    d.querySelector('[data-auditee-add]').click();assert.equal(selected.at(-1).clientName,'');assert.equal(roster.snapshot().active,2);
    d.querySelector('[data-auditee-remove="2"]').click();assert.equal(roster.snapshot().rows.length,3);w.confirm=()=>true;
    d.querySelector('[data-auditee-remove="2"]').click();assert.equal(roster.snapshot().rows.length,2);assert.equal(selected.at(-1).clientName,s.clientName);
    const count=selected.length;d.querySelector('[data-auditee-remove="0"]').click();assert.equal(roster.snapshot().active,0);assert.equal(selected.length,count);assert.equal(d.querySelector('[data-auditee-remove="0"]').disabled,true);
    roster.load(Array(50).fill(r),49);assert.equal(d.querySelector('[data-auditee-add]').disabled,true);assert.equal(d.querySelector('[aria-current=true]').getAttribute('data-auditee-row'),'49');
    assert.throws(()=>roster.load(Array(51).fill(r)));assert.equal(roster.snapshot().rows.length,50);
  }finally{dom.window.close();}
});
