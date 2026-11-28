const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const dist = path.resolve(__dirname, '../dist');
function setup(t, storage = []) {
  const dom = new JSDOM(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'), {url:'http://localhost/',runScripts:'outside-only'});
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  t.after(() => w.close());
  for (const [key, value] of storage) w.localStorage.setItem(key, value);
  for (const file of ['calc.js', 'rule-catalog.js', 'regions.js', 'backup-restore.js', 'save-feedback.js', 'app.js']) w.eval(fs.readFileSync(path.join(dist, file), 'utf8'));
  const $ = selector => w.document.querySelector(selector);
  const rows = () => [...w.document.querySelectorAll('#quote-estimates-rows tr')].filter(row => row.cells.length > 1);
  function estimate(name) {
    $('#quote-region').value = name;
    $('#comparison').dispatchEvent(new w.Event('submit', {bubbles:true,cancelable:true}));
    $('#estimate-record-save').click();
  }
  return {w, $, rows, estimate};
}

test('manual province entry rejects foreign regions, unknown names and blank text', t => {
  const {estimate, $, rows} = setup(t);
  assert.equal($('#quote-region[list]'), null);
  assert.deepEqual([...$('#estimate-tax').options].map(option => option.value), ['1','3','6']);
  assert.equal($('#estimate-factor').type, 'text');
  for (const value of ['', '河北市', '安大略省', 'California', '广西省美国']) {
    estimate(value);
    assert.equal($('#quote-region-message').textContent, '输入错误', value);
    assert.equal($('#quote-region').getAttribute('aria-invalid'), 'true');
  }
  assert.equal(rows().length, 0);
});

test('all province-level regions can be typed and scope-limited areas are saved without a price', t => {
  const {w, estimate, $, rows} = setup(t);
  for (const province of w.RuleCatalog.PROVINCES) {
    estimate(province.name);
    assert.equal($('#quote-region').value, province.name);
    assert.match($('#quote-region-message').textContent, /已记录/, province.name);
    if (province.scopePending) assert.match($('#quote-region-message').textContent, /适用范围及币种待确认/);
  }
  assert.equal($('#quote-estimates-status').textContent,'34 条');
  const displayed=[];
  for(const page of [1,2,3,4]){
    $(`#estimate-pagination [data-estimate-page="${page}"]`).click();
    displayed.push(...rows());
  }
  assert.equal(displayed.length,34);
  assert.equal(displayed.filter(row => row.querySelector('.quote-record-amount').textContent.includes('适用范围及币种待确认')).length,3);
});

test('region history keeps repeated submissions, tax, provenance, and prices across a reload', t => {
  const x = setup(t);
  x.$('#estimate-tax').value = '6';
  x.$('#estimate-factor').value = '70%';
  x.estimate('　北京　');
  assert.match(x.rows()[0].textContent, /北京市.*14,914\.20/);
  assert.match(x.rows()[0].querySelector('.quote-record-amount').title, /借用河北历史口径，非当地标准/);
  assert.equal(x.$('#estimate-result').value,'¥ 14,914.20');
  x.$('#estimate-factor').value = '';
  x.estimate('北京');
  assert.equal(x.$('#final-price').textContent, '¥ 21,306.00');
  assert.equal(x.$('#estimate-factor').value, '100%');
  x.estimate('广东省');
  assert.match(x.$('#final-price').textContent,/21,306\.00/);
  assert.equal(x.rows().length, 3);
  assert.equal(new Set(x.rows().map(row => row.querySelector('select').dataset.estimateOutcome)).size, 3);
  assert.ok(x.rows().every(row=>!row.cells[2].textContent));
  const storage = Array.from({length:x.w.localStorage.length}, (_, i) => x.w.localStorage.key(i)).map(key => [key, x.w.localStorage.getItem(key)]);
  const reloaded = setup(t, storage);
  assert.deepEqual(reloaded.rows().map(row => row.textContent), x.rows().map(row => row.textContent));
  assert.equal(reloaded.$('#quote-estimates-status').textContent, '3 条');
});

test('pending historical rows have stable independent identifiers and an empty project code cell', t => {
  const key = 'hengdu.audit.quote.estimates.v1.123-456-789-1234';
  const raw = JSON.stringify({createdAt:1,provinceId:'gx',cents:1500000,project:'原测算项目'});
  const x = setup(t, [[key, raw]]);
  const oldCode = x.rows()[0].querySelector('select').dataset.estimateOutcome;
  assert.match(oldCode, /^[a-f0-9-]{36}$/);
  assert.equal(setup(t, [[key, raw]]).rows()[0].querySelector('select').dataset.estimateOutcome, oldCode);
  x.estimate('广西');
  x.$('#proposal-form [name=projectName]').value = '另一笔合成项目';
  x.estimate('广西');
  assert.equal(new Set(x.rows().map(row => row.querySelector('select').dataset.estimateOutcome)).size, 3);
  assert.equal(x.w.localStorage.getItem(key), raw);
});

test('ambiguous historical awards stay in storage and no longer mark every row as won',t=>{
  const prefix='hengdu.audit.quote.estimates.v1.';
  const group='10000000-0000-4000-8000-000000000000';
  const outcome='hengdu.audit.quote.estimate-outcome.v1.'+group;
  const original=JSON.stringify({outcome:'won',awardedAt:'2026-11-22T00:00:00.000Z'});
  const records=['hb','gx'].map((provinceId,i)=>[prefix+`${i+2}0000000-0000-4000-8000-000000000000`,JSON.stringify({
    projectCode:group,createdAt:i+1,provinceId,auditeeQuotes:[{name:'合成甲公司',cents:100},{name:'合成乙公司',cents:200}]
  })]);
  const x=setup(t,[...records,[outcome,original]]);
  const codes=x.rows().map(row=>row.querySelector('select').dataset.estimateOutcome);
  assert.equal(new Set(codes).size,4);
  assert.ok(x.rows().every(row=>row.querySelector('select').value===''));
  assert.ok(x.rows().every(row=>!row.querySelector('[data-project-info]')));
  assert.ok(x.rows().every(row=>!row.cells[2].textContent));
  assert.equal(x.w.localStorage.getItem(outcome),original);
  assert.ok(records.every(([key,value])=>x.w.localStorage.getItem(key)===value));
  assert.deepEqual(setup(t,[...records,[outcome,original]]).rows().map(row=>row.querySelector('select').dataset.estimateOutcome),codes);
});

test('local formulas keep their basis and provenance and do not silently price an out-of-range project', t => {
  const {w, estimate, $, rows} = setup(t);
  for (const [name, document, basis, amount] of [
    ['湖南', /湘价服/, /资产总额/, /21,210\.00/],
    ['广东', /粤价/, /孰高/, /20,301\.00/],
    ['重庆', /重庆注协/, /平均/, /28,280\.00/],
    ['上海', /本所自定义工时预算/, /工时预算/, /33,936\.00/]
  ]) {
    estimate(name);
    const row = rows().find(row => row.cells[7].textContent.startsWith(name));
    const price = row.querySelector('.quote-record-amount');
    assert.match(price.title, document);
    assert.match(price.title, basis);
    assert.doesNotMatch(price.title, /借用河北/);
    assert.match(price.textContent, amount);
  }
  $('#client-form [name=assets]').value = '110000';
  $('#client-form [name=revenue]').value = '110000';
  $('#client-form [name=revenue]').dispatchEvent(new w.Event('input',{bubbles:true}));
  estimate('重庆');
  assert.match($('#quote-region-message').textContent, /双方协商/);
  assert.ok(rows().some(row => row.cells[7].textContent === '重庆市' && row.querySelector('.quote-record-amount').textContent.includes('须双方协商')));
});

test('date, audited unit, project type and result combine before summing the visible unit prices', t => {
  const prefix = 'hengdu.audit.quote.estimates.v1.';
  const codes = [1,2,3,4].map(i => '00000000-0000-4000-8000-' + String(i).padStart(12,'0'));
  const records = [
    {date:'2026-11-20',project:'年度决算审计',projectType:'年度财务报表审计',cents:350003,
      auditeeQuotes:[{name:'合成北区Ａ公司',cents:120001},{name:'合成南区公司',cents:230002}]},
    {date:'2026-11-21',project:'收支专项审计',projectType:'专项审计',customerName:'合成北区Ａ公司',cents:450003},
    {date:'2026-11-22',project:'待补规模专项',projectType:'专项审计',customerName:'合成北区Ａ公司',cents:null},
    {date:'2026-11-22',project:'验资项目',projectType:'验资服务',customerName:'合成西区公司',cents:0}
  ];
  const measurementIds=records.map((_,i)=>`${i+2}0000000-0000-4000-8000-000000000000`);
  const stored = records.map((record,i)=>[prefix+measurementIds[i],JSON.stringify({provinceId:'hb',createdAt:i+1,projectCode:codes[i],
    firm:'合成投标方'+i,contact:'合成联系人'+i,phone:'010-0000000'+i,email:'test'+i+'@example.invalid',...record})]);
  const outcomes = [[measurementIds[0],'won'],[codes[1],'lost']].map(([code,value])=>['hengdu.audit.quote.estimate-outcome.v1.'+code,value]);
  const {w,$,rows} = setup(t,[...stored,...outcomes]);
  const total = () => $('#quote-estimates-total').textContent;
  function openFilter(name){
    $(`[data-estimate-column="${name}"] button`).click();
  }
  function filterDate(value){
    openFilter('date');
    assert.equal($('#estimate-filter-value').type,'date');
    $('#estimate-filter-value').value=value;
    $('#estimate-filter-form').requestSubmit();
  }
  function filter(name,value,search='') {
    openFilter(name);
    if(search){
      $('#estimate-filter-search').value=search;
      $('#estimate-filter-search').dispatchEvent(new w.Event('input',{bubbles:true}));
      assert.deepEqual([...$('#estimate-filter-options').querySelectorAll('button')].map(button=>button.dataset.value),['',value]);
    }
    const option=[...$('#estimate-filter-options').querySelectorAll('button')].find(button=>button.dataset.value===value);
    assert.ok(option,'filter option '+name+' '+value);
    option.click();
  }
  assert.equal(rows().length,5);
  assert.equal(total(),'¥ 8,000.06');
  assert.equal($('#quote-estimates-total-note').textContent,'（1 条待测算）');
  openFilter('type');
  assert.deepEqual([...$('#estimate-filter-options').querySelectorAll('button')].map(button=>button.dataset.value),
    ['','财务报表审计','专项审计','报表审阅','咨询服务','内控测试','经济责任审计','验资服务','其他']);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  filterDate('2026-11-20');
  assert.equal(rows().length,2);
  assert.equal(total(),'¥ 3,500.03');
  filter('auditee','合成北区Ａ公司','　北区a　');
  assert.equal(rows().length,1);
  assert.equal(total(),'¥ 1,200.01');
  filter('outcome','中标');
  assert.match(rows()[0].textContent,/合成北区Ａ公司.*年度决算审计/);
  assert.equal(total(),'¥ 1,200.01');
  filter('type','专项审计');
  assert.equal(rows().length,0);
  assert.equal(total(),'¥ 0.00');
  assert.match($('#quote-estimates-rows').textContent,/没有符合筛选条件/);
  filterDate('');
  filter('outcome','未中标');
  assert.equal(rows().length,1);
  assert.match(rows()[0].textContent,/收支专项审计/);
  assert.equal(total(),'¥ 4,500.03');
  filter('outcome','待确认');
  assert.equal(rows().length,1);
  assert.equal(rows()[0].querySelector('select').selectedOptions[0].textContent,'待确认');
  assert.equal(total(),'—');
  assert.equal($('#quote-estimates-total-note').textContent,'（1 条待测算）');
  $('#estimate-filter-clear').click();
  assert.equal(total(),'¥ 8,000.06');
  filter('type','验资服务');
  assert.equal(rows().length,1);
  assert.equal(total(),'¥ 0.00');
  assert.equal($('#quote-estimates-total-note').textContent,'');
  assert.deepEqual([...w.document.querySelectorAll('[data-estimate-column]')].map(th=>th.dataset.estimateColumn),
    ['date','auditee','firm','project','type','amount','outcome','contact']);
  for(const [column,value] of Object.entries({firm:'合成投标方2',project:'待补规模专项',contact:'合成联系人2'})){
    $('#estimate-filter-clear').click();
    filter(column,value);
    assert.equal(rows()[0].cells[5].textContent,'待补规模专项');
  }
  assert.ok(stored.every(([key,value])=>w.localStorage.getItem(key)===value));
});

test('minimum price includes the exact amount, excludes pending and below-threshold rows, and composes with date',t=>{
  const prices=[2999999,3000000,3000001,null,0];
  const {$,rows}=setup(t,prices.map((cents,i)=>['hengdu.audit.quote.estimates.v1.'+i,
    JSON.stringify({createdAt:i+1,provinceId:'hb',cents,date:i===2?'2025-11-20':'2026-11-20'})]));
  const field=$('#estimate-filter-value'),form=$('#estimate-filter-form');
  $('[data-estimate-column=amount] button').click();
  field.value='30000';form.requestSubmit();
  assert.deepEqual(rows().map(row=>row.cells[8].textContent),['¥ 30,000.01','¥ 30,000.00']);
  assert.equal($('#quote-estimates-total').textContent,'¥ 60,000.01');
  $('[data-estimate-column=date] button').click();
  field.value='2026-11-20';form.requestSubmit();
  assert.deepEqual(rows().map(row=>row.cells[8].textContent),['¥ 30,000.00']);
  $('[data-estimate-column=amount] button').click();
  assert.equal(field.value,'30000.00');
  $('#estimate-filter-reset').click();
  assert.equal(rows().length,4);
});

test('quote total preserves exact cents even when the combined amount exceeds a safe number', t => {
  const { $ } = setup(t,[1,2].map(i=>['hengdu.audit.quote.estimates.v1.'+i,
    JSON.stringify({createdAt:i,provinceId:'hb',cents:Number.MAX_SAFE_INTEGER})]));
  assert.equal($('#quote-estimates-total').textContent,'¥ 180,143,985,094,819.82');
});

test('45 records paginate ten at a time and keep totals for all filtered rows', t => {
  const {$,rows}=setup(t,Array.from({length:45},(_,i)=>['hengdu.audit.quote.estimates.v1.'+i,
    JSON.stringify({createdAt:i+1,provinceId:'hb',cents:10000,date:i<12?'2026-11-21':'2026-11-22'})]));
  const pageButtons=()=>[...$('#estimate-pagination').querySelectorAll('button')].map(button=>button.textContent);
  assert.deepEqual(pageButtons(),['上一页','1','2','3','4','5','下一页']);
  assert.equal(rows().length,10);
  assert.equal(rows()[0].cells[0].textContent,'45');
  assert.equal($('#quote-estimates-total').textContent,'¥ 4,500.00');
  $('#estimate-pagination [data-estimate-page="5"]').click();
  assert.equal(rows().length,5);
  assert.equal(rows()[0].cells[0].textContent,'5');
  assert.equal($('#estimate-pagination [aria-current]').textContent,'5');
  assert.equal($('#quote-estimates-total').textContent,'¥ 4,500.00');
  $('[data-estimate-column=date] button').click();
  $('#estimate-filter-value').value='2026-11-21';
  $('#estimate-filter-form').requestSubmit();
  assert.deepEqual(pageButtons(),['上一页','1','2','下一页']);
  assert.equal($('#estimate-pagination [aria-current]').textContent,'1');
  assert.equal($('#quote-estimates-total').textContent,'¥ 1,200.00');
  $('#estimate-pagination [data-estimate-page="2"]').click();
  assert.equal(rows().length,2);
  const size=$('#estimate-pagination select');
  for(const value of ['15','20']){
    size.value=value;
    size.dispatchEvent(new size.ownerDocument.defaultView.Event('change',{bubbles:true}));
    assert.equal(rows().length,12);
    assert.deepEqual(pageButtons(),['上一页','1','下一页']);
  }
  $('#estimate-filter-clear').click();
  assert.equal(rows().length,20);
  assert.equal($('#quote-estimates-total').textContent,'¥ 4,500.00');
  $('#estimate-pagination [data-estimate-page="3"]').click();
  assert.equal(rows().length,5);
});
