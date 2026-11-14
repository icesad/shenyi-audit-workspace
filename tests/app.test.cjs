const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
function setup(raw){const dir=path.join(__dirname,'../dist');const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only'});const w=dom.window;if(raw)w.localStorage.setItem(KEY,raw);w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};for(const file of ['calc.js','rule-catalog.js','regions.js','backup-restore.js','app.js'])w.eval(fs.readFileSync(path.join(dir,file),'utf8'));return {dom,w,d:w.document};}
const KEY='hengdu.audit.quote.records.v2';
function legacyBudgetRecord(invalid=false){
 const x=setup();x.d.querySelector('#save').click();
 const [r]=JSON.parse(x.w.localStorage.getItem(KEY));
 // Model the old saved v14 shape with custom hours and its exact calculated fields.
 r.snapshot.comparisonProvinceIds[2]='sh';
 r.snapshot.quote.basis='budget';r.snapshot.quote.manual='30000';delete r.snapshot.quote.pricePercent;r.snapshot.quote.discount='10';
 r.snapshot.budget[0].hours='25';
 const b=x.w.QuoteCalc.calculateHours(r.snapshot.budget);
 r.calculation.budget=b;
 r.calculation.regions.sh={...b,baseLabel:'本所人员工时预算',custom:true};
 r.calculation.quote={...x.w.QuoteCalc.applyAdjustment({baseCents:b.totalCents,discountPercent:10,extraYuan:0,taxPercent:0,roundingUnit:'none'}),baseCents:b.totalCents,label:'本所工时预算'};
 r.totalCents=r.calculation.quote.totalCents;
 if(invalid)r.snapshot.budget[0].hours='';
 x.dom.window.close();return JSON.parse(JSON.stringify(r));
}
// Legacy records remain rendered but hidden: restore programmatically without reviving removed navigation.
function loadDraft(x){assert.equal(x.d.querySelector('[data-view=history]'),null);x.d.querySelector('#history-list [data-load]').click();}
function input(w,d,selector,value,event='input'){const el=d.querySelector(selector);assert.ok(el,selector);el.value=value;el.dispatchEvent(new w.Event(event,{bubbles:true}));}
test('initialization renders three reference cards, including the labeled Beijing fallback, and the quote',()=>{const {dom,d}=setup();assert.equal(d.querySelectorAll('.region-card').length,3);assert.match(d.querySelector('#comparison').textContent,/15,000.00/);assert.match(d.querySelector('#comparison').textContent,/20,100.00/);assert.equal(d.querySelector('[data-comparison-slot="2"]').value,'110000');assert.match(d.querySelector('.region-card:nth-child(3) .card-label').textContent,/借用河北.*非当地标准/);assert.equal(d.querySelector('#final-price').textContent,'¥ 33,600.00');dom.window.close();});
test('negative profit allowed but never changes fee',()=>{const {dom,w,d}=setup();input(w,d,'[name=profit]','-200');assert.equal(d.querySelector('#client-error').textContent,'');assert.equal(d.querySelector('#final-price').textContent,'¥ 33,600.00');input(w,d,'[name=assets]','-1');assert.equal(d.querySelector('#preview').disabled,true);dom.window.close();});
test('quote factor defaults to 100, supports 70 and 120, and rejects an invalid factor',()=>{const {dom,w,d}=setup();d.querySelector('[data-choose=gx]').click();assert.equal(d.querySelector('[name=pricePercent]').value,'100');assert.equal(d.querySelector('#final-price').textContent,'¥ 15,000.00');input(w,d,'[name=pricePercent]','70');assert.equal(d.querySelector('#final-price').textContent,'¥ 10,500.00');input(w,d,'[name=pricePercent]','120');assert.equal(d.querySelector('#final-price').textContent,'¥ 18,000.00');assert.match(d.querySelector('#summary-lines').textContent,/加价金额/);input(w,d,'[name=tax]','6');assert.equal(d.querySelector('#final-price').textContent,'¥ 19,080.00');input(w,d,'[name=pricePercent]','10001');assert.equal(d.querySelector('#final-price').textContent,'—');dom.window.close();});
test('GX out of supported range never silently zeroes',()=>{const {dom,w,d}=setup();d.querySelector('[data-choose=gx]').click();input(w,d,'[name=assets]','20001');assert.match(d.querySelector('#comparison').textContent,/超出/);assert.equal(d.querySelector('#preview').disabled,true);dom.window.close();});
test('empty data disables save, export and preview',()=>{const {dom,w,d}=setup();input(w,d,'[name=assets]','');for(const id of ['save','preview','csv'])assert.equal(d.querySelector('#'+id).disabled,true);dom.window.close();});
test('new work hides the hours module, uses an editable manual price and retains Shanghai reference',t=>{
 const {dom,w,d}=setup();t.after(()=>dom.window.close());const basis=d.querySelector('#quote-form [name=basis]');
 assert.equal(d.querySelector('[data-view=budget],#view-budget,#budget-rows,#add-role'),null);
 assert.equal(basis.querySelector('[value=budget]'),null);
 assert.equal(basis.value,'manual');assert.equal(d.querySelector('[name=manual]').disabled,false);
 assert.equal(d.querySelector('#final-price').textContent,'¥ 33,600.00');
 input(w,d,'[data-comparison-slot="2"]','sh','change');assert.match(d.querySelector('#comparison').textContent,/33,600.00/);
 d.querySelector('[data-choose=sh]').click();assert.equal(basis.value,'sh');
 assert.equal(d.querySelector('#final-price').textContent,'¥ 33,600.00');
 d.querySelector('#demo').click();assert.equal(basis.value,'manual');assert.equal(basis.querySelector('[value=budget]'),null);
});
test('restoring legacy hours preserves original input, calculations and revision until a different basis is chosen',t=>{
 const original=legacyBudgetRecord(),raw=JSON.stringify([original]);const x=setup(raw);t.after(()=>x.dom.window.close());loadDraft(x);
 const {d,w}=x,basis=d.querySelector('#quote-form [name=basis]');const saved=()=>JSON.parse(w.localStorage.getItem(KEY));
 assert.equal(d.querySelector('#restore-recalc-warning').hidden,true);
 assert.equal(basis.value,'budget');assert.equal(basis.selectedOptions[0].disabled,true);
 assert.match(d.querySelector('#basis-description').textContent,/只读/);
 assert.match(d.querySelector('#comparison').textContent,/34,200.00/);
 assert.equal(d.querySelector('#final-price').textContent,'¥ 30,780.00');
 assert.equal(w.localStorage.getItem(KEY),raw);
 d.querySelector('#save-revision').click();
 const [rev,untouched]=saved();assert.deepEqual(untouched,original);
 assert.equal(rev.snapshot.quote.basis,'budget');assert.deepEqual(rev.snapshot.budget,original.snapshot.budget);
 assert.deepEqual(rev.calculation,original.calculation);
 input(w,d,'#quote-form [name=basis]','manual');
 assert.equal(basis.querySelector('[value=budget]'),null);assert.equal(d.querySelector('#final-price').textContent,'¥ 27,000.00');
 assert.deepEqual(saved()[1],original);
});
test('pending rule edits do not mutate live quote; apply does',()=>{const {dom,w,d}=setup();d.querySelector('[data-view=rules]').click();input(w,d,'#rules-form [name=mode]','fixed','change');assert.match(d.querySelector('#comparison').textContent,/15,000.00/);input(w,d,'#rules-form [name=fixedYuan]','8888');d.querySelector('#rules-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert.match(d.querySelector('#comparison').textContent,/8,888.00/);assert.match(d.querySelector('#comparison').textContent,/本机自定义规则/);dom.window.close();});
test('Hebei first fixed tier is explicitly editable in yuan',()=>{const {dom,d}=setup();d.querySelector('[data-view=rules]').click();d.querySelector('[data-rule=hb]').click();const first=d.querySelector('[data-tier="0"][data-field=feeYuan]');assert.equal(first.value,'2000');assert.equal(d.querySelector('[data-tier="1"][data-field=ratePerMille]').value,'2');dom.window.close();});
test('save preserves snapshot and resume restores original inputs',()=>{const {dom,w,d}=setup();d.querySelector('#save').click();const data=JSON.parse(w.localStorage.getItem('hengdu.audit.quote.records.v2'));assert.equal(data.length,1);assert.equal(data[0].calculation.quote.totalCents,3360000);input(w,d,'[name=assets]','200');d.querySelector('#history-list [data-load]').click();assert.equal(d.querySelector('[name=assets]').value,'3000');dom.window.close();});
test('customer preview requires both certificate files and never leaks legacy internal reasons or unsafe client text',()=>{const seed=setup();seed.d.querySelector('#save').click();const [record]=JSON.parse(seed.w.localStorage.getItem(KEY));seed.dom.window.close();record.snapshot.quote.reason='内部底价999元，秘密折扣';const raw=JSON.stringify([record]),x=setup(raw);loadDraft(x);const {dom,w,d}=x;assert.equal(d.querySelector('[name=reason]'),null);assert.equal(w.localStorage.getItem(KEY),raw);input(w,d,'[name=clientName]','<img src=x onerror=alert(1)>');assert.equal(d.querySelector('#preview').disabled,true);d.querySelector('#preview').click();const p=d.querySelector('#customer-preview');assert.equal(p.querySelector('img'),null);assert.ok(!p.textContent.includes('秘密折扣'));assert.ok(!p.textContent.includes('33,600'));assert.ok(!p.textContent.includes('桂价费'));assert.equal(p.textContent,'');assert.equal(d.querySelector('#quote-dialog').open,false);assert.equal(d.querySelector('#register-quote').disabled,true);dom.window.close();});
test('restored invalid legacy hours cannot become a silent zero or fallback quote',t=>{
 const raw=JSON.stringify([legacyBudgetRecord(true)]),x=setup(raw);t.after(()=>x.dom.window.close());loadDraft(x);
 assert.equal(x.d.querySelector('#restore-recalc-warning').hidden,false);
 assert.match(x.d.querySelector('#quote-error').textContent,/原草稿工时数据无效/);
 assert.equal(x.d.querySelector('#final-price').textContent,'—');
 assert.equal(x.d.querySelector('#save').disabled,true);assert.equal(x.w.localStorage.getItem(KEY),raw);
});
test('runtime static HTML contains no external script or fetch',()=>{const dir=path.join(__dirname,'../dist');const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');const app=fs.readFileSync(path.join(dir,'app.js'),'utf8');assert.ok(!/<script[^>]*src=["']https?:/i.test(html));assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon)\s*\(/.test(app));});

test('customer identity roundtrip cannot silently adopt another customer proposal contacts',()=>{const {dom,w,d}=setup();const original=d.querySelector('#client-form [name=clientName]').value;input(w,d,'#client-form [name=clientName]','合成客户B');input(w,d,'#proposal-form [name=contactName]','合成B联系人');input(w,d,'#proposal-form [name=projectName]','合成B项目');input(w,d,'#client-form [name=clientName]',original);assert.match(d.querySelector('#proposal-client-status').textContent,/请明确/);assert.equal(d.querySelector('#register-quote').disabled,true);w.confirm=()=>true;d.querySelector('#sync-proposal').click();assert.equal(d.querySelector('#proposal-form [name=contactName]').value,'');assert.equal(d.querySelector('#proposal-form [name=issuer]').value,original);assert.doesNotMatch(d.querySelector('#proposal-form [name=projectName]').value,/年度年度/);assert.match(d.querySelector('#proposal-client-status').textContent,/对应当前客户/);dom.window.close();});
