const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const KEY='hengdu.audit.quote.records.v2';
function setup(raw){const dir=path.join(__dirname,'../dist'),dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8'),{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window;if(raw!==undefined)w.localStorage.setItem(KEY,raw);w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};for(const file of ['calc.js','rule-catalog.js','regions.js','backup-restore.js','app.js'])w.eval(fs.readFileSync(path.join(dir,file),'utf8'));return {w,d:w.document,dom};}
function change(w,el,value,event='change'){el.value=value;el.dispatchEvent(new w.Event(event,{bubbles:true}));}
const slot=(d,n)=>d.querySelector('[data-comparison-slot="'+n+'"]'),ids=d=>[0,1,2].map(n=>slot(d,n).value);
test('three in-card province dropdowns replace old top selector; each has34 options',()=>{const {d,dom}=setup();assert.equal(d.querySelector('#comparison-province'),null);assert.equal(d.querySelector('.province-control'),null);assert.deepEqual(ids(d),['gx','hb','110000']);assert.equal(d.querySelectorAll('.region-card').length,3);for(let i=0;i<3;i++){assert.equal([...slot(d,i).options].filter(o=>o.value).length,34);assert.equal(slot(d,i).getAttribute('aria-label'),['第一地 · 默认客户所在地','第二地 · 默认执行团队所在地','第三地 · 自选地区'][i]);}dom.window.close();});
test('cards select independently and explicitly show borrowed Hebei provenance',t=>{
  const {w,d,dom}=setup();t.after(()=>dom.window.close());
  change(w,slot(d,1),'210000');assert.deepEqual(ids(d),['gx','210000','110000']);
  assert.equal(d.querySelector('[name=location]').value,'广西');
  const card=d.querySelectorAll('.region-card')[1],hb=w.RuleCatalog.defaultRule('hb');
  assert.match(card.textContent,/河北/);assert.ok(card.textContent.includes(hb.document));
  assert.match(card.querySelector('.region-price').textContent,/20,100\.00/);
  assert.equal(card.querySelector('button').disabled,false);
  card.querySelector('button').click();
  assert.equal(d.querySelector('#quote-form [name=basis]').value,'210000');
  assert.match(d.querySelector('#final-price').textContent,/20,100\.00/);
  assert.match(d.querySelector('#basis-description').textContent,/河北/);
});
test('duplicate selections stay three visible cards, with unique basis options and duplicate hint',()=>{const {w,d,dom}=setup();change(w,slot(d,0),'hb');assert.equal(d.querySelectorAll('.region-card').length,3);assert.deepEqual(ids(d),['hb','hb','110000']);assert.match(d.querySelector('.card-label').textContent,/重复/);const options=[...d.querySelector('#quote-form [name=basis]').options].map(x=>x.value);assert.equal(options.filter(x=>x==='hb').length,1);change(w,slot(d,0),'sh');assert.equal(d.querySelectorAll('.region-card').length,3);assert.deepEqual(ids(d),['sh','hb','110000']);dom.window.close();});
test('customization and reset preserve independently editable provincial defaults',t=>{
  const {w,d,dom}=setup();t.after(()=>dom.window.close());
  change(w,slot(d,0),'210000');d.querySelector('[data-view=rules]').click();
  const editor=d.querySelector('#rule-editor'),before=editor.textContent;
  assert.match(before,/河北/);assert.equal(d.querySelector('#rules-form [name=mode]').value,'progressive');
  assert.equal(d.querySelector('#rules-form [name=fixedYuan]').value,'');
  change(w,d.querySelector('#rules-form [name=mode]'),'fixed');
  change(w,d.querySelector('#rules-form [name=fixedYuan]'),'7654','input');
  d.querySelector('#rules-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  const card=()=>d.querySelector('.region-card');
  assert.match(card().textContent,/7,654.00/);assert.match(card().textContent,/本所自定义 · 待核/);
  assert.match(d.querySelectorAll('.region-card')[1].querySelector('.region-price').textContent,/20,100.00/,'editing borrowed rule must not edit 河北');
  d.querySelector('#restore-rule').click();
  assert.equal(d.querySelector('#rules-form [name=mode]').value,'progressive');
  assert.match(card().textContent,/20,100.00/);assert.match(card().textContent,/河北/);
});
test('all 34 are visible in the separate editor; HK/Macau/Taiwan templates remain read-only and not quotable',t=>{
  const {w,d,dom}=setup();t.after(()=>dom.window.close());
  d.querySelector('[data-view=rules]').click();
  const picker=d.querySelector('#rules-region-select'),codes=[...picker.options].map(o=>o.value).filter(Boolean);
  assert.equal(codes.length,34);assert.equal(new Set(codes).size,34);
  const original=ids(d),hb=w.RuleCatalog.defaultRule('hb');
  for(const code of codes){
    change(w,picker,code);
    const rule=w.RuleCatalog.defaultRule(code),form=d.querySelector('#rules-form');
    assert.equal(picker.value,code);assert.deepEqual(ids(d),original,code+' editor selection must not alter compare slots');
    assert.equal(form.elements.namedItem('mode').value,rule.mode,code);
    assert.equal(form.elements.namedItem('basis').value,rule.basis,code);
    assert.equal(form.querySelectorAll('[data-tier][data-field=upToYuan]').length,rule.tiers.length,code);
    if(rule.status==='scope_reference'){
      assert.equal(d.querySelector('#rule-editor-parameters').disabled,true,code);
      assert.equal(rule.tiers.length,hb.tiers.length);
      assert.match(d.querySelector('#rule-editor').textContent,/仅展示|只读|不计算/,code);
    }
  }
  d.querySelector('[data-view=quote]').click();
  for(const [code,name] of [['810000','香港特别行政区'],['820000','澳门特别行政区'],['710000','台湾省']]){
    change(w,slot(d,0),code);
    const card=d.querySelector('.region-card');
    assert.equal(card.querySelector('.region-price').textContent.trim(),'—');
    assert.equal(card.querySelector('button').disabled,true);
    change(w,d.querySelector('[name=location]'),name,'input');
    assert.equal(d.querySelector('#save').disabled,true);assert.match(d.querySelector('#client-error').textContent,/币种待确认/);
  }
});
test('customer and team each update only their own comparison slot even after manual selections',()=>{const {w,d,dom}=setup();change(w,slot(d,2),'210000');change(w,d.querySelector('[name=location]'),'北京市','input');assert.deepEqual(ids(d),['110000','hb','210000']);change(w,d.querySelector('[name=team]'),'上海','input');assert.deepEqual(ids(d),['110000','sh','210000']);change(w,slot(d,0),'gx');change(w,d.querySelector('[name=team]'),'广西','input');assert.deepEqual(ids(d),['gx','gx','210000']);assert.equal(d.querySelector('[name=location]').value,'北京市');change(w,d.querySelector('[name=location]'),'河北','input');assert.deepEqual(ids(d),['hb','gx','210000']);dom.window.close();});
test('moving active quoted province out of all cards blocks rather than silently switching basis',()=>{const {w,d,dom}=setup();d.querySelector('[data-choose=gx]').click();assert.equal(d.querySelector('#quote-form [name=basis]').value,'gx');change(w,slot(d,0),'hb');assert.equal(d.querySelector('#quote-form [name=basis]').value,'gx');assert.match(d.querySelector('#quote-error').textContent,/移出参考栏/);assert.equal(d.querySelector('#save').disabled,true);dom.window.close();});


test('opening a legacy empty rule never silently rewrites or prices it; explicit restore updates only the current draft',t=>{
  const seed=setup();t.after(()=>seed.dom.window.close());
  change(seed.w,slot(seed.d,0),'210000');
  seed.d.querySelector('#save').click();
  const [old]=JSON.parse(seed.w.localStorage.getItem(KEY)),id='210000';
  delete old.snapshot.regionalDefaults;
  const i=old.snapshot.rules.findIndex(r=>r.id===id);
  assert.ok(i>=0);
  old.snapshot.rules[i]={id,name:'辽宁省',document:'未配置',status:'missing',sourceUrl:'',version:'未配置',basis:'assets',mode:'fixed',minimumYuan:0,fixedYuan:null,tiers:[],notes:'该地区尚未配置规则；自定义规则仅为本所草稿，未核定。'};
  old.calculation.regions[id]={error:'待配置规则',missing:true};
  const raw=JSON.stringify([old]),{w,d,dom}=setup(raw);t.after(()=>dom.window.close());
  assert.equal(d.querySelector('[data-view=history]'),null);d.querySelector('#history-list [data-load="'+old.id+'"]').click();
  const card=()=>d.querySelector('.region-card');
  assert.equal(card().querySelector('.region-price').textContent.trim(),'—');
  assert.equal(d.querySelector('#restore-recalc-warning').hidden,true,'the historical snapshot still reproduces');
  assert.equal(w.localStorage.getItem(KEY),raw);
  d.querySelector('[data-view=rules]').click();
  assert.match(d.querySelector('#rule-editor').textContent,/未配置/);
  w.confirm=()=>false;d.querySelector('#restore-rule').click();
  assert.equal(card().querySelector('.region-price').textContent.trim(),'—');
  w.confirm=()=>true;d.querySelector('#restore-rule').click();
  assert.match(card().querySelector('.region-price').textContent,/20,100\.00/);
  assert.match(d.querySelector('#final-price').textContent,/33,600\.00/,'restoring a reference must not silently change the manual quote basis');
  assert.equal(w.localStorage.getItem(KEY),raw);
});

test('local historical formulas take precedence and keep scope/basis distinct from borrowed references',t=>{
  const {w,d,dom}=setup();t.after(()=>dom.window.close());
  const card=()=>d.querySelectorAll('.region-card')[2];
  for(const [code,document,basis,amount] of [
    ['430000',/湘价服/,/资产总额/,/21,000\.00/],
    ['440000',/粤价/,/孰高/,/20,100\.00/],
    ['500000',/重庆注协/,/平均/,/28,000\.00/],
    ['sh',/本所自定义工时预算/,/工时预算/,/33,600\.00/]
  ]){
    change(w,slot(d,2),code);
    assert.match(card().querySelector('.card-facts').textContent,document,code);
    assert.match(card().querySelector('.card-facts').textContent,basis,code);
    assert.match(card().querySelector('.region-price').textContent,amount,code);
    assert.doesNotMatch(card().textContent,/借用河北/,code);
  }
  change(w,slot(d,2),'500000');
  change(w,d.querySelector('#client-form [name=assets]'),'110000','input');
  change(w,d.querySelector('#client-form [name=revenue]'),'110000','input');
  assert.equal(card().querySelector('.region-price').textContent.trim(),'—');
  assert.match(card().querySelector('.card-label').textContent,/双方协商/);
  assert.equal(card().querySelector('[data-choose]').disabled,true);

  change(w,slot(d,2),'110000');
  d.querySelector('[data-view=rules]').click();
  const editor=d.querySelector('#rule-editor'),rule=w.RuleCatalog.defaultRule('110000');
  assert.match(editor.textContent,/废止/);
  assert.match(editor.textContent,/借用河北/);
  assert.notEqual(rule.sourceUrl,rule.localPolicyUrl);
  assert.equal(editor.querySelector('a[href="'+rule.localPolicyUrl+'"]').textContent.trim().includes('当地政策'),true);
});
