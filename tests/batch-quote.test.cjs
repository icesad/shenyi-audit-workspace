const {test}=require('node:test');
const assert=require('node:assert/strict');
const Q=require('../dist/batch-quote.js');
const row=(n,year='2026')=>({clientName:'合成单位'+n,year,assets:'2.01',revenue:'3.02',profit:n===1?'-1.01':'',dataPeriod:'期末'});
const key=r=>JSON.stringify([r.clientName.normalize('NFKC').trim(),r.year.trim()]);
const value=(r,raw)=>({basis:JSON.stringify([r.assets,r.revenue,r.profit,r.dataPeriod,r.location]),raw});
test('six distinct confirmed prices and exact cents, row sum and VAT',()=>{
  const rows=Array.from({length:6},(_,i)=>row(i+1)), amounts=new Map(rows.map((r,i)=>[key(r),value(r,(100+i)+'.01')]));
  const out=Q.capture(rows,amounts,'6');
  assert.deepEqual(out.quoteRows.map(x=>x.totalCents),[10001,10101,10201,10301,10401,10501]);
  assert.equal(out.totalCents,61506);assert.equal(out.subtotalCents+out.taxCents,61506);
  assert.equal(out.quoteRows[0].profit,'-1.01');assert.equal(out.quoteRows[1].profit,'');
});
test('missing, invalid, duplicate or changed financial rows cannot silently generate',()=>{
  const a=row(1),b=row(2), m=new Map([[key(a),value(a,'10.10')],[key(b),value(b,'20.20')]]);
  assert.throws(()=>Q.capture([a,b],new Map(),'0'),/请填写第 1 家/);
  assert.throws(()=>Q.capture([a,{...b,assets:'4.00'}],m,'0'),/请填写第 2 家/);
  assert.throws(()=>Q.capture([a,a],m,'0'),/重复/);
  assert.throws(()=>Q.capture([a,b],m,'100.01'),/税率/);
  m.set(key(b),value(b,'20.201'));assert.throws(()=>Q.capture([a,b],m,'0'),/小数/);
  m.set(key(b),value(b,'0.00'));assert.equal(Q.capture([a,b],m,'0').totalCents,1010);
});

test('mounted batch auto-fills by row, scopes override to row and policy, and never fills a failed estimate',()=>{
  const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="host"></div>');
  try{
    const d=dom.window.document,$=x=>d.querySelector(x),host=$('#host'),rows=[{...row(1),location:'广西'},{...row(2),location:'广西'}];
    let active=0,multiplier=100,missing=false,count=0,ui;
    ui=Q.mount(host,{
      getRegister:()=>({rows,active}),getFinal:()=>null,getTax:()=>0,
      estimateRow:(r,i)=>missing&&i===1?{error:'未配置规则'}:{totalCents:Math.round((i===0?10001:23045)*multiplier/100),source:'独立地区参考 · '+r.location},
      getEstimateKey:()=>String(multiplier),onChange:()=>{count++;ui.refresh();},format:String
    });
    const first=()=> $('[data-batch-amount="0"]'),second=()=> $('[data-batch-amount="1"]');
    const set=(el,v)=>{el.value=v;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
    ui.refresh();
    assert.equal(first().value,'100.01');assert.equal(second().value,'230.45');
    assert.match($('[data-batch-source="0"]').textContent,/自动测算 · 独立地区参考 · 广西/);
    assert.equal(ui.capture().totalCents,33046);
    set(first(),'80.07');active=1;ui.refresh();assert.equal(first().value,'80.07');
    set(second(),'');assert.equal(second().value,'');assert.throws(()=>ui.capture(),/第 2 家/);
    $('[data-batch-auto="1"]').click();assert.equal(second().value,'230.45');
    multiplier=70;ui.refresh();assert.equal(first().value,'70.01');assert.equal(second().value,'161.32');
    multiplier=120;ui.refresh();assert.equal(first().value,'120.01');assert.equal(second().value,'276.54');
    set(first(),'1.01');rows[0]={...rows[0],location:'河北'};ui.refresh();assert.equal(first().value,'120.01');
    missing=true;ui.refresh();assert.equal(second().value,'');assert.throws(()=>ui.capture(),/未配置规则/);
    assert.equal($('[data-batch-source="1"]').textContent,'未自动测算 · 未配置规则');
    assert.ok(count>=4);
  }finally{dom.window.close();}
});
