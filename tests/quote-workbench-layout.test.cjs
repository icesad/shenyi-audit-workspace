'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {crc32} = require('node:zlib');
const {JSDOM} = require('jsdom');
const {chromium} = require('playwright');

const index = path.resolve(__dirname, '../dist/index.html');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

test('tender and quote-reference uploads are separate, with one province field and one sidebar entry', () => {
  const {window} = new JSDOM(fs.readFileSync(index, 'utf8'));
  try {
    const d = window.document;
    const $ = selector => d.querySelector(selector);
    const ids = [...d.querySelectorAll('[id]')].map(node => node.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal($('#view-quote form form'), null);
    assert.equal(d.querySelectorAll('#view-quote input[type=file]').length, 2);
    assert.equal($('#tender-file').closest('label').id, 'tender-dropzone');
    assert.equal($('#quote-reference-input').closest('label').id, 'quote-reference-dropzone');
    assert.equal($('.quote-file-panel').nextElementSibling, $('.quote-reference-panel'));
    assert.deepEqual([...$('.quote-setup').children], [$('.quote-file-stack'),$('.quote-region-panel'),$('.quote-final-panel')]);
    assert.equal($('#comparison-title').textContent, '报价参数');
    assert.equal($('#estimate-result').closest('.panel'), $('.quote-final-panel'));
    assert.equal($('#estimate-details').closest('.panel'), $('.quote-final-panel'));
    assert.equal($('.quote-reference-panel details'), null);
    assert.equal($('#demo'), null);
    assert.equal($('#quote-region').form.id, 'comparison');
    assert.equal($('#quote-intake-review').open, false);
    assert.equal($('#quote-intake-review').closest('.view').id, 'view-proposal');
    assert.equal($('#bidder-picker').closest('.view').id, 'view-quote');
    assert.deepEqual([...$('#quote-download-layout').options].filter(option=>!option.disabled).map(option=>option.textContent),['模板一','模板二','模板三']);
    assert.equal(d.querySelectorAll('.quote-unit-panel [id^=quote-download-][type=button]').length,1);
    assert.deepEqual([...d.querySelectorAll('.quote-estimates-heading button')].map(button=>button.id),['estimate-filter-clear']);
    const group = $('[data-nav-group=quote]');
    assert.equal(group.firstElementChild.firstElementChild, group.querySelector('button[data-quote-home]'));
    assert.equal(group.querySelector('#quote-nav-toggle').getAttribute('aria-controls'),'quote-nav-items');
    assert.deepEqual([...group.querySelectorAll('[data-view]')].map(node=>node.textContent),['招投标及记录','项目汇总表']);
    assert.match(group.textContent, /招投标及立项/);
    assert.deepEqual([...d.querySelectorAll('#bidding-navigation button')].map(button => button.dataset.view), ['proposal','bid','ledger','project']);
    assert.equal($('#client-form').elements.team.form.id, 'client-form');
    for (const name of ['issuer','projectName','contactName','contactInfo','firmName','quoteDate','projectType']) {
      assert.equal($('#proposal-form').elements.namedItem(name).form.id,'proposal-form', name);
    }
    assert.equal($('#quote-documents').closest('.view').id, 'view-proposal');
    assert.equal($('#bid-documents').closest('.view').id, 'view-bid');
    assert.deepEqual([...d.querySelectorAll('.quote-estimates-table thead th')].slice(2,10).map(node => node.textContent),
      ['编码','被审计单位','投标方','项目名称','项目类型','计价地区','价格（含税）','投标结果']);
  } finally { window.close(); }
});

function syntheticTender(issuer = '合成项目采购方', auditees = [], fields = []) {
  const paragraphs = ['发标单位：'+issuer, '项目名称：'+(fields.length?'虚构集团所属某公司2026年度财务决算审计项目':'合成测算项目'), '公司联系人：李示', '联系电话：010-12345678', '邮箱：quote@example.invalid',...fields];
  const p = value => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;
  const table = auditees.length ? '<w:tbl>' + [['被审计单位名称','审计年度','资产总额（万元）','营业收入（万元）'],...auditees]
    .map(row => '<w:tr>'+row.map(cell=>'<w:tc>'+p(cell)+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>' : '';
  const word = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paragraphs.map(p).join('') + table + '</w:body></w:document>';
  const locals = [], central = [];
  let offset = 0;
  for (const [name, value] of [['[Content_Types].xml','<Types/>'],['word/document.xml', word]]) {
    const file = Buffer.from(name), data = Buffer.from(value), local = Buffer.alloc(30), entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); entry.writeUInt32LE(0x02014b50);
    local.writeUInt32LE(crc32(data), 14); entry.writeUInt32LE(crc32(data), 16);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24);
    local.writeUInt16LE(file.length, 26); entry.writeUInt16LE(file.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, file, data); central.push(entry, file);
    offset += local.length + file.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(2, 8); end.writeUInt16LE(2, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('six audited units keep separate prices, project codes and bid results', async t => {
  const executablePath = process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE ||
    (fs.existsSync(chromium.executablePath()) ? chromium.executablePath() : EDGE);
  if (!fs.existsSync(executablePath)) return t.skip('Existing Chromium or Edge unavailable');
  const browser = await chromium.launch({headless:true, executablePath});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1280,height:950}});
  await page.goto(pathToFileURL(index).href);
  await page.getByRole('button',{name:'招投标及立项',exact:true}).click();
  const subjects = Array.from({length:6},(_,i)=>['合成北区项目管理有限公司'+(i+1),'2025',String(4000+2000*i),String(5000+2000*i)]);
  const upload = async rows => {
    await page.locator('#tender-file').setInputFiles({name:'合成六家询价.docx', mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:syntheticTender('合成委托方',rows)});
    await page.waitForFunction(()=>document.querySelector('#tender-status').textContent==='上传成功');
  };
  const details = page.locator('#estimate-details tbody tr');
  const records = page.locator('#quote-estimates-rows > tr:has(> .quote-record-amount)');
  await upload(subjects);
  assert.deepEqual(await details.locator('th').allTextContents(), subjects.map(row=>row[0]));
  await page.locator('#estimate-tax').selectOption('6');
  await page.locator('#estimate-factor').fill('80％');
  await page.locator('#quote-region').fill('河北');
  await page.getByRole('button',{name:'测算并记录',exact:true}).click();
  assert.equal(await page.locator('#quote-region').inputValue(),'河北');
  assert.equal(await page.locator('#estimate-tax').inputValue(),'6');
  assert.equal(await page.locator('#estimate-factor').inputValue(),'80％');
  assert.equal(await page.locator('#tender-status').textContent(),'上传成功');
  const expected = await page.evaluate(rows=>{
    const rule=RuleCatalog.defaultRule('hb');
    const prices=rows.map(row=>QuoteCalc.applyAdjustment({baseCents:QuoteCalc.calculateScale({...rule,baseYuan:String(Number(row[2])*10000)}).totalCents,pricePercent:'80',taxPercent:'6',extraYuan:'0'}));
    const fmt=cents=>'¥ '+QuoteCalc.formatMoney(cents);
    return {rows:prices.map(price=>[fmt(price.totalCents)]),total:fmt(prices.reduce((sum,price)=>sum+price.totalCents,0))};
  },subjects);
  assert.equal(new Set(expected.rows.map(row=>row[0])).size,6);
  assert.deepEqual(await page.locator('#estimate-details thead th').allTextContents(),['被审计单位','含税报价']);
  assert.deepEqual(await details.evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('td')].map(cell=>cell.textContent))),expected.rows);
  assert.equal(await page.locator('#estimate-result').textContent(),expected.total);
  const expectedNames = subjects.map(row=>row[0]);
  const expectedPrices = expected.rows.map(row=>row[0]);
  assert.equal(await records.count(),6);
  assert.deepEqual(await records.locator('select').evaluateAll(selects=>selects.map(select=>select.selectedOptions[0].textContent)),Array(6).fill('待确认'));
  await page.getByRole('button',{name:'筛选投标结果'}).click();
  const resultFilter=page.getByRole('dialog',{name:'筛选投标结果'});
  assert.deepEqual(await resultFilter.getByRole('button').allTextContents(),['全部','中标','未中标','待确认']);
  await resultFilter.getByRole('button',{name:'待确认',exact:true}).click();
  assert.equal(await records.count(),6);
  await page.getByRole('button',{name:'清空筛选'}).click();
  assert.equal(await page.locator('#quote-estimates-status').textContent(),'6 条');
  assert.deepEqual(await records.locator('td:nth-child(4)').allTextContents(),expectedNames);
  assert.deepEqual(await records.locator('.quote-record-amount').allTextContents(),expectedPrices);
  assert.equal(await page.locator('#quote-estimates-total').textContent(),expected.total);
  const codes = await records.locator('select').evaluateAll(selects=>selects.map(select=>select.dataset.estimateOutcome));
  assert.equal(new Set(codes).size,6);
  assert.equal(await records.locator('code').count(),0);
  await records.nth(2).getByRole('combobox').selectOption('won');
  await page.waitForFunction(()=>document.querySelectorAll('#quote-estimates-rows [data-project-info]').length===1);
  assert.deepEqual(await records.locator('select').evaluateAll(selects=>selects.map(select=>select.value)),['','','won','','','']);
  assert.deepEqual(await records.locator('[data-project-info]').evaluateAll(links=>links.map(link=>link.dataset.projectInfo)),[codes[2]]);
  assert.deepEqual(await records.locator('code').allTextContents(),[codes[2]]);
  const awards=await page.evaluate(()=>ProjectInitiation.listSaved());
  assert.deepEqual(awards.map(project=>[project.quoteId,project.source.customerName,project.source.totalCents]),
    [[codes[2],expectedNames[2],Math.round(Number(expectedPrices[2].replace(/[^\d.]/g,''))*100)]]);
  await page.evaluate(async ({id,total})=>{
    const signed=await ProjectWorkspaceStore.get(id);
    await ProjectWorkspaceStore.save(id,signed.rev,{amountCents:1234});
    const older=JSON.parse(localStorage.getItem('hengdu.audit.quote.estimates.v1.'+document.querySelector('[data-estimate-id]').dataset.estimateId));
    await ProjectInitiation.ensureWon({id:older.projectCode,lastEventNo:1,
      events:[{eventNo:1,outcome:'won',recordedAt:new Date().toISOString()}],
      snapshot:{origin:'estimate',projectName:older.project,issuer:'合成委托方',customerName:older.auditeeQuotes.map(line=>line.name).join('、'),
        firmName:'合成事务所',quoteDate:older.date,auditYear:2026,totalCents:total,projectType:older.projectType}});
  },{id:codes[2],total:awards[0].source.totalCents});
  const nav=page.locator('.workspace-navigation');
  await nav.getByRole('button',{name:'项目汇总表'}).click();
  await page.locator('.pi-summary-table [data-project-register-id]').waitFor();
  assert.deepEqual(await page.locator('.pi-summary-table tbody td:nth-child(4)').allTextContents(),[expectedNames[2]]);
  await nav.getByRole('button',{name:'项目成本核算',exact:true}).evaluate(button=>button.click());
  const costRow=page.locator('[data-project-cost-id="'+codes[2]+'"]');
  await costRow.getByRole('button',{name:'保存本行'}).waitFor();
  const costIncome=expectedPrices[2].replace('¥ ','');
  await costRow.getByText(costIncome,{exact:true}).waitFor();
  assert.deepEqual(await page.locator('.pc-table thead tr').first().getByRole('columnheader').allTextContents(),
    ['序号','项目编号','被审计单位','项目名称','收入（元）','成本','项目收益率']);
  assert.equal(await costRow.locator('td').nth(2).textContent(),expectedNames[2]);
  assert.equal(await page.locator('.pc-table tbody tr').count(),1);
  await nav.getByRole('button',{name:'招投标及记录'}).click();
  async function pick(column,value,search=''){
    const name='筛选'+column,menu=page.getByRole('dialog',{name});
    await page.getByRole('button',{name,exact:true}).click();
    if(search)await menu.getByRole('searchbox').fill(search);
    await menu.getByRole('button',{name:value,exact:true}).click();
  }
  assert.equal(await page.locator('[data-estimate-column] button').count(),8);
  await page.getByRole('button',{name:'筛选价格（含税）'}).click();
  const priceFilter=page.getByRole('dialog',{name:'筛选价格（含税）'});
  await priceFilter.getByLabel('最低含税价格（元）').fill('30000');
  await priceFilter.getByRole('button',{name:'筛选',exact:true}).click();
  assert.deepEqual(await records.locator('.quote-record-amount').allTextContents(),expectedPrices.filter(price=>Number(price.replace(/[^\d.]/g,''))>=30000));
  await page.getByRole('button',{name:'清空筛选'}).click();
  await pick('被审计单位',expectedNames[2],'有限公司3');
  await pick('投标结果','中标');
  assert.deepEqual(await records.locator('td:nth-child(4)').allTextContents(),[expectedNames[2]]);
  assert.equal(await page.locator('#quote-estimates-total').textContent(),expectedPrices[2]);
  await records.first().getByRole('combobox').selectOption('lost');
  await page.getByText('没有符合筛选条件的记录',{exact:true}).waitFor();
  assert.equal(await page.locator('#quote-estimates-total').textContent(),'¥ 0.00');
  await pick('投标结果','未中标');
  assert.deepEqual(await records.locator('td:nth-child(4)').allTextContents(),[expectedNames[2]]);
  assert.equal(await page.locator('#quote-estimates-total').textContent(),expectedPrices[2]);
  await page.getByRole('button',{name:'清空筛选'}).click();
  assert.equal(await records.count(),6);
  assert.equal(await records.locator('code').count(),0);
  assert.equal(await page.locator('#quote-estimates-total').textContent(),expected.total);
  assert.ok(await page.locator('#estimate-details .table-scroll').evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  if (process.env.QUOTE_WORKBENCH_QA_DIR) {
    await page.evaluate(()=>window.scrollTo(0, 0));
    await page.screenshot({path:path.join(process.env.QUOTE_WORKBENCH_QA_DIR,'quote-workbench-six-units.png'),fullPage:true});
  }
  await page.reload();
  await page.getByRole('button',{name:'招投标及立项',exact:true}).click();
  assert.deepEqual(await records.locator('td:nth-child(4)').allTextContents(),expectedNames);
  assert.deepEqual(await records.locator('.quote-record-amount').allTextContents(),expectedPrices);
  assert.deepEqual(await records.locator('select').evaluateAll(selects=>selects.map(select=>select.value)),['','','lost','','','']);
  page.on('dialog',dialog=>dialog.accept());
  const incomplete = subjects.map((row,i)=>i===5?[row[0],row[1],'',row[3]]:row);
  await upload(incomplete);
  await page.locator('#quote-region').fill('河北');
  await page.locator('#quote-region').press('Enter');
  assert.equal(await details.last().locator('td').last().textContent(),'待补资产总额');
  assert.equal(await page.locator('#estimate-result').textContent(),'5/6 家已测算');
  assert.equal(await page.locator('#quote-estimates-status').textContent(),'12 条');
  assert.equal(await records.count(),10);
  assert.equal(await records.nth(5).locator('td:nth-child(4)').textContent(),expectedNames[5]);
  assert.equal(await records.nth(5).locator('.quote-record-amount').textContent(),'待补资产总额');
  const pagination=page.getByRole('navigation',{name:'招投标记录分页'});
  const scroll=page.locator('.quote-estimates-scroll');
  await page.setViewportSize({width:800,height:480});
  assert.equal(await scroll.evaluate(node=>node.scrollHeight>node.clientHeight&&getComputedStyle(node).overflowY==='auto'),true);
  await scroll.evaluate(node=>{node.scrollTop=100;});
  await pagination.getByRole('button',{name:'2',exact:true}).click();
  assert.equal(await records.count(),2);
  assert.equal(await scroll.evaluate(node=>node.scrollTop),0);
  await pagination.getByRole('button',{name:'1',exact:true}).click();
  await page.setViewportSize({width:320,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.ok(await page.locator('#estimate-details .table-scroll').evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  await page.getByRole('button',{name:'筛选联系人',exact:true}).click();
  const narrowFilter = page.getByRole('dialog',{name:'筛选联系人'});
  assert.ok(await narrowFilter.evaluate(node=>{
    const rect=node.getBoundingClientRect();
    return rect.width>0 && rect.left>=0 && rect.right<=innerWidth;
  }));
  await page.keyboard.press('Escape');
  assert.equal(await narrowFilter.isVisible(),false);
});

test('won code opens the editable initiation form and shares saved data with the project summary',async t=>{
  const executablePath=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||EDGE;
  if(!fs.existsSync(executablePath))return t.skip('Existing Chromium or Edge unavailable');
  const browser=await chromium.launch({headless:true,executablePath});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(pathToFileURL(index).href);
  const nav=page.locator('[data-nav-group=quote] .nav-group-items');
  await nav.getByRole('button',{name:'招投标及记录'}).click();
  const tender=syntheticTender('合成发标单位',[],['被审计单位：合成被审计单位有限公司','项目类型：专项审计','风险等级：B类']);
  await page.locator('#tender-file').setInputFiles({name:'合成立项询价.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:tender});
  await page.waitForFunction(()=>document.querySelector('#tender-status').textContent==='上传成功');
  await page.locator('#quote-region').fill('河北');
  await page.locator('#quote-region').press('Enter');
  const row=page.locator('#quote-estimates-rows tr').first();
  assert.equal(await row.locator('td').nth(3).textContent(),'合成被审计单位有限公司');
  assert.equal(await row.locator('td').nth(5).textContent(),'2026年财务决算审计');
  assert.equal(await row.getByRole('link').count(),0);
  await row.getByRole('combobox').selectOption('won');
  await row.getByRole('link',{name:/^[0-9a-f-]{36}$/}).click();
  const code=await row.locator('code').textContent();
  const field=key=>page.locator('#project-info-'+key);
  await field('companyName').waitFor();
  assert.deepEqual(await field('procurementMethod').locator('option[value=""]').evaluate(option=>[option.textContent,option.hidden,option.disabled]),['请选择',true,true]);
  assert.equal(await field('companyName').inputValue(),'合成被审计单位有限公司');
  assert.equal(await field('contactName').inputValue(),'李示');
  assert.equal(await field('contactInfo').inputValue(),'010-12345678 / quote@example.invalid');
  assert.equal(await field('projectType').inputValue(),'专项审计');
  assert.equal(await field('riskLevel').inputValue(),'B类');
  assert.equal(await field('amount').inputValue(),'');
  for(const [key,value] of Object.entries({companyName:'合成更正被审计单位',contactName:'合成更正联系人',contactInfo:'010-87654321',amount:'31800',taxRate:'6',manager:'合成项目经理',teamMembers:'合成甲、合成乙',siteStart:'2026-12-03',siteEnd:'2026-12-05',reportDate:'2026-12-20',reportCopies:'3',mailingAddress:'合成邮寄地址',invoice:'合成抬头及税号'}))await field(key).fill(value);
  for(const [key,value] of Object.entries({projectType:'经济责任审计',riskLevel:'A类',procurementMethod:'邀请招标',regulated:'是',listed:'否',ipoPlan:'否'}))await field(key).selectOption(value);
  const contract=await page.evaluate(async()=>{const document=await PDFLib.PDFDocument.create();document.addPage();return [...await document.save()];});
  await field('contract').setInputFiles({name:'合成合同.pdf',mimeType:'application/pdf',buffer:Buffer.from(contract)});
  await page.evaluate(()=>{window.originalInitiationConfirm=window.confirm;window.confirm=message=>{window.lastInitiationConfirm=message;return false;};});
  await field('save').click();
  await page.waitForFunction(()=>window.lastInitiationConfirm==='确认保存立项信息？'&&!document.getElementById('project-info-save').disabled);
  assert.equal(await field('companyName').inputValue(),'合成更正被审计单位');
  assert.equal(await field('contract').evaluate(input=>input.files.length),1);
  assert.equal(await page.evaluate(id=>ProjectWorkspaceStore.get(id).then(w=>w.projectInitiationDetails),code),undefined);
  await page.evaluate(()=>{window.confirm=window.originalInitiationConfirm;delete window.originalInitiationConfirm;});
  await field('save').click();
  await page.waitForFunction(()=>document.querySelector('#project-init-status').textContent==='立项信息已保存。');
  const saved=await page.evaluate(async id=>{const w=await ProjectWorkspaceStore.get(id);return {details:w.projectInitiationDetails,amount:w.amountCents,manager:w.projectRegister.manager,type:w.projectClassification.projectType,invoice:w.projectInvoice.information,contract:w.signedContract.name};},code);
  assert.equal(saved.amount,3180000);
  assert.equal(saved.details.reportCopies,'3');
  assert.equal(saved.manager,'合成项目经理');
  assert.equal(saved.type,'经济责任审计');
  assert.equal(saved.invoice,'合成抬头及税号');
  assert.equal(saved.contract,'合成合同.pdf');
  await page.reload();
  await nav.getByRole('button',{name:'招投标及记录'}).click();
  await row.getByRole('link',{name:code}).click();
  await field('companyName').waitFor();
  assert.equal(await field('companyName').inputValue(),'合成更正被审计单位');
  assert.equal(await field('contactName').inputValue(),'合成更正联系人');
  assert.equal(await field('riskLevel').inputValue(),'A类');
  if (process.env.QUOTE_WORKBENCH_QA_DIR) {
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(process.env.QUOTE_WORKBENCH_QA_DIR,'project-information.png'),fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await nav.getByRole('button',{name:'项目汇总表'}).click();
  assert.equal(await page.locator('#page-title').textContent(),'项目汇总表');
  const summary=page.locator(`[data-project-register-id="${code}"]`);
  await summary.getByText('合成更正被审计单位',{exact:true}).waitFor();
  assert.equal(await summary.locator('td').nth(2).textContent(),'已完成');
  assert.equal(await summary.locator('td').nth(3).textContent(),'合成更正被审计单位');
  await summary.getByRole('link',{name:code,exact:true}).click();
  await field('reportCopies').fill('');
  await field('save').click();
  await page.waitForFunction(()=>document.querySelector('#project-init-status').textContent==='立项信息已保存。');
  await page.getByRole('button',{name:'返回项目汇总表'}).click();
  assert.equal(await summary.locator('td').nth(2).textContent(),'立项中');
  await nav.getByRole('button',{name:'招投标及记录'}).click();
  await row.getByRole('combobox').selectOption('lost');
  await page.waitForFunction(()=>document.querySelector('#estimate-outcome-status').textContent==='已保存未中标结果。');
  await row.getByRole('link').waitFor({state:'detached'});
  await nav.getByRole('button',{name:'项目汇总表'}).click();
  await page.locator('#project-init-list').getByText('暂无已立项项目。',{exact:true}).waitFor();
  assert.equal(await summary.count(),0);
  assert.equal(await page.evaluate(id=>ProjectWorkspaceStore.get(id).then(w=>w.projectInitiationDetails.companyName),code),'合成更正被审计单位');
  assert.deepEqual(errors,[]);
});

test('browser measurement carries the same project code to initiation, workpapers and reports', async t => {
  const executablePath = process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE ||
    (fs.existsSync(chromium.executablePath()) ? chromium.executablePath() : EDGE);
  if (!fs.existsSync(executablePath)) return t.skip('Existing Chromium or Edge unavailable');
  const browser = await chromium.launch({headless:true, executablePath});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1440,height:950}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(index).href);
  const bidder = await page.evaluate(async () => {
    async function certificate(kind, color) {
      const canvas = document.createElement('canvas');
      canvas.width = 160; canvas.height = 100;
      const drawing = canvas.getContext('2d');
      drawing.fillStyle = color; drawing.fillRect(0, 0, 160, 100);
      const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
      return BidderLibrary.readProfileFile(new File([blob],kind+'.png',{type:'image/png'}),kind);
    }
    const db = await BidderLibrary.open();
    try {
      const evidence = await Promise.all([certificate('business_license','#336655'), certificate('practice_certificate','#254877')]);
      const own=await db.create({kind:'own',name:'合成投标事务所',team:'广西',contactName:'',phone:'',email:''},evidence);
      const partner=await db.create({kind:'partner',name:'合成合作事务所',team:'上海',contactName:'合成报价联系人',phone:'010-00000000',email:'word@example.invalid'},[]);
      return {own:own.id,partner:partner.id};
    } finally { db.close(); }
  });
  await page.reload();
  const quote = page.locator('.workspace-navigation [data-view=quote]');
  await quote.click();
  assert.equal(await page.locator('#page-title').textContent(), '招投标');
  assert.equal(await page.locator('#bidding-navigation').isVisible(), false);
  assert.equal(await page.getByText('选择内置格式',{exact:true}).count(), 0);
  assert.equal(await page.getByRole('button',{name:'载入演示'}).count(), 0);
  const drop = page.locator('#tender-dropzone'), region = page.locator('#quote-region');
  async function openProposal() {
    await page.locator('#brand-home').click();
    await page.locator('[data-home-view=project]').click();
    assert.equal(await page.locator('#bidding-navigation').isVisible(),false);
    await page.locator('#bidding-navigation [data-view=proposal]').evaluate(button=>button.click());
  }
  const rows = page.locator('#quote-estimates-rows tr:has(.quote-record-amount)');
  assert.equal(await page.locator('#proposal-form').isVisible(), false);
  assert.equal(await page.locator('#quote-documents').isVisible(), false);
  const unit = page.locator('#bidder-picker-select');
  assert.match(await page.locator('label[for=bidder-picker-select]').textContent(), /^选择报价单位/);
  await unit.locator(`option[value="${bidder.partner}"]`).waitFor({state:'attached'});
  assert.deepEqual((await unit.locator('option[value]:not([value=""])').allTextContents()).sort(),['合成合作事务所','合成投标事务所'].sort());
  const builtIn=page.getByRole('combobox',{name:'下载内置模板报价',exact:true});
  const referenceVersion=page.getByRole('button',{name:'下载以往报价参考资料版',exact:true});
  assert.equal(await builtIn.isEnabled(),false);
  await unit.selectOption(bidder.partner);
  assert.equal(await builtIn.isEnabled(),false);
  assert.equal(await referenceVersion.isEnabled(),false);
  await unit.selectOption(bidder.own);
  await page.waitForFunction(() => document.querySelector('[name=firmName]').value === '合成投标事务所');
  const fileTransfer = (bytes, name = '合成招标.docx') => page.evaluateHandle(({bytes,name}) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(bytes)], name));
    return data;
  }, {bytes:[...bytes],name});
  const reference = syntheticTender('合成历史报价单位',[],['被审计单位：合成旧客户','报价单位：合成旧事务所','含税报价：¥ 123.45 元']);
  await page.locator('#quote-reference-dropzone').dispatchEvent('drop', {dataTransfer:await fileTransfer(reference,'合成参考报价.docx')});
  assert.equal(await page.locator('#quote-reference-status').textContent(), '上传成功');
  assert.equal(await page.locator('#quote-reference-name').textContent(), '合成参考报价.docx');
  assert.equal(await page.locator('#tender-status').textContent(), '');
  await page.locator('#quote-reference-preview').click();
  const preview = page.locator('.ac-preview-dialog');
  await preview.locator('.ap-area').getByText('发标单位：合成历史报价单位').waitFor();
  await preview.getByRole('button',{name:'关闭预览'}).click();
  const referenceDownload = page.waitForEvent('download');
  await page.locator('#quote-reference-download').click();
  const downloaded = await referenceDownload;
  assert.equal(downloaded.suggestedFilename(), '合成参考报价.docx');
  assert.deepEqual(fs.readFileSync(await downloaded.path()), reference);
  const transfer = await fileTransfer(syntheticTender());
  await drop.dispatchEvent('dragover', {dataTransfer:transfer});
  assert.match(await drop.getAttribute('class'), /is-dragover/);
  await drop.dispatchEvent('drop', {dataTransfer:transfer});
  await page.waitForFunction(() => document.querySelector('#tender-status').textContent === '上传成功');
  let confirmation;
  page.once('dialog', async dialog => { confirmation=dialog.message(); await dialog.dismiss(); });
  await drop.dispatchEvent('drop', {dataTransfer:await fileTransfer(syntheticTender('替换测试采购方'))});
  await page.waitForFunction(() => document.querySelector('#tender-status').textContent === '已取消上传');
  assert.equal(confirmation,'替换当前招标资料？');
  await openProposal();
  await page.locator('#complete-proposal').click();
  assert.equal(await page.locator('[name=issuer]').inputValue(), '合成项目采购方');
  assert.equal(await page.locator('[name=projectName]').inputValue(), '合成测算项目');
  await page.locator('[name=clientName]').fill('合成被审计单位');
  await page.locator('#client-form [name=location]').selectOption('广西');
  await page.locator('#client-form [name=year]').fill('2025');
  await page.locator('#client-form [name=assets]').fill('3000');
  await page.locator('#client-form [name=revenue]').fill('2000');
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#keep-issuer').click();
  assert.equal(await page.locator('#proposal-form').isVisible(), true);
  await quote.click();
  await region.fill('安大略省');
  await region.press('Enter');
  assert.equal(await page.locator('#quote-region-message').textContent(), '输入错误');
  assert.equal(await rows.count(), 0);
  await page.locator('#estimate-tax').selectOption('3');
  await page.locator('#estimate-factor').fill('10％');
  for (const name of ['重庆','北京市']) {
    await region.fill(name);
    await region.press('Enter');
  }
  assert.equal(await rows.count(), 2);
  const latest = rows.first();
  assert.match(await latest.textContent(), /合成被审计单位.*合成投标事务所.*合成测算项目.*北京市.*2,070\.30/);
  assert.equal(await page.locator('#estimate-result').textContent(),'¥ 2,070.30');
  const codes = await rows.locator('select').evaluateAll(selects=>selects.map(select=>select.dataset.estimateOutcome));
  assert.match(codes[0],/^[a-f0-9-]{36}$/);
  assert.notEqual(codes[0],codes[1]);
  assert.equal(await rows.locator('code').count(),0);
  async function quoteText(downloadAction){
    const downloading=page.waitForEvent('download');
    await downloadAction();
    const download=await downloading;
    assert.match(download.suggestedFilename(),/\.docx$/);
    return page.evaluate(async bytes=>{
      const parts=await ProjectWorkspaceStore.parts(new File([Uint8Array.from(bytes)],'quote.docx'));
      const doc=ProjectWorkspaceStore.xml(parts['word/document.xml']);
      return doc.documentElement.textContent;
    },[...fs.readFileSync(await download.path())]);
  }
  for(const template of ['模板一','模板二','模板三']){
    const rendered=await quoteText(()=>builtIn.selectOption({label:template}));
    assert.match(rendered,/合成投标事务所/);
    assert.match(rendered,/合成被审计单位/);
    assert.match(rendered,/2,070\.30/);
    assert.doesNotMatch(rendered,/税前金额|另计税额/);
  }
  const referenceText=await quoteText(()=>referenceVersion.click());
  assert.match(referenceText,/合成被审计单位/);
  assert.match(referenceText,/合成投标事务所/);
  assert.match(referenceText,/2,070\.30/);
  assert.doesNotMatch(referenceText,/合成旧客户|合成旧事务所|123\.45/);
  assert.deepEqual(await latest.locator('select option:not(:disabled)').allTextContents(), ['中标','未中标']);
  await latest.locator('select').selectOption('won');
  await page.waitForFunction(() => document.querySelector('#estimate-outcome-status').textContent.includes('已保存中标'));
  await openProposal();
  await page.locator('#quote-layout-format2').check();
  assert.equal(await page.locator('#quote-layout-format2').isChecked(),true);
  await page.locator('#register-quote').click();
  await page.waitForFunction(code => ProjectInitiation.listSaved().then(items => items.some(p => p.quoteId === code)), codes[0]);
  await page.locator('#bidding-navigation [data-view=project]').click();
  const projectRow = page.locator(`[data-project-register-id="${codes[0]}"]`);
  await projectRow.waitFor();
  assert.match(await projectRow.locator('[data-project-internal-id]').getAttribute('title'), new RegExp(codes[0]));
  await page.locator('[data-nav-audit-step="2"]').click();
  await page.locator('#pw-project').selectOption(codes[0]);
  await page.locator('[data-report-section=trial-balance]').click();
  await page.locator('#report-project').selectOption(codes[0]);
  await page.reload();
  await page.locator('[data-home-view=quote]').click();
  assert.equal(await rows.count(), 2);
  assert.deepEqual(await rows.locator('code').allTextContents(), [codes[0]]);
  assert.equal(await rows.first().locator('select').inputValue(),'won');
  assert.equal(await rows.last().locator('select').inputValue(),'');
  const qa = process.env.QUOTE_WORKBENCH_QA_DIR;
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({width,height:950});
    const layout = await page.evaluate(() => {
      const bounds = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {
        doc:document.documentElement.scrollWidth, drop:bounds('.quote-file-panel'), reference:bounds('.quote-reference-panel'),
        parameters:bounds('.quote-region-panel'), final:bounds('.quote-final-panel'), table:bounds('.quote-estimates')
      };
    });
    assert.ok(layout.doc <= width + 1, 'layout scroll stays within the table');
    assert.ok(layout.table.top > layout.final.bottom, 'the record table follows the final quote');
    assert.ok(layout.reference.top > layout.drop.bottom, 'reference follows the tender file');
    assert.equal(layout.reference.left, layout.drop.left, 'both uploads use the same column');
    if (width === 390) {
      assert.ok(layout.parameters.top > layout.reference.bottom, 'parameters follow uploads on mobile');
      assert.ok(layout.final.top > layout.parameters.bottom, 'result follows parameters on mobile');
    } else {
      assert.equal(layout.parameters.top, layout.drop.top);
      assert.equal(layout.final.top, layout.drop.top);
      assert.equal(layout.final.bottom, layout.parameters.bottom);
      assert.equal(layout.reference.bottom, layout.parameters.bottom);
      assert.ok(layout.parameters.left > layout.drop.right);
      assert.ok(layout.final.left > layout.parameters.right);
    }
    if (qa) {
      await page.evaluate(()=>window.scrollTo(0, 0));
      await page.screenshot({path:path.join(qa, `quote-workbench-${width}.png`), fullPage:true});
    }
  }
  await page.evaluate(() => document.getElementById('quote-dialog').showModal());
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('.shell').evaluate(node => getComputedStyle(node).display), 'none');
  assert.deepEqual(errors, []);
});
