'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const Layouts = require('../dist/quote-layouts.js');

const dist = path.resolve(__dirname,'../dist');
const engine = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(dist,'workpaper-xlsx-source.js'),'utf8'),engine);
vm.runInContext(engine.WorkpaperXlsxSource,engine);
const XLSX = engine.XLSX;

function workbook(rows,name='资料',formula=false) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if(formula)sheet.C1={t:'n',v:0,f:'B1*2'};
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,sheet,name);
  return Buffer.from(XLSX.write(book,{type:'array',bookType:'xlsx'}));
}

const ENTITY = '合成甲公司', PERIOD='会计期间：2026-01 - 2026-02';
const trialHeader = ['科目编码','科目名称','期初借方余额','期初贷方余额','本期借方发生额','本期贷方发生额','期末借方余额','期末贷方余额'];
const sheetHeader = ['年','月','日','公司代码','凭证编号','摘要','借方','贷方','方向','余额','客户名称','制单人'];
const scoping = ['核算单位：'+ENTITY,'账套名称：合成账套','币种：CNY','金额单位：元',PERIOD];
function ledger(code,name,debit,credit,summary) {
  return workbook([
    ['科目三栏账'],[scoping[0],scoping[1],scoping[2],scoping[3],PERIOD,'所选行科目：'+code+' '+name],sheetHeader,
    [2026,1,null,'TEST',null,'上期结转',null,null,'平',0],
    [2026,2,28,'TEST','000017',summary,debit,credit,debit?'借':'贷',debit||credit,'专用敏感客户','专用敏感人员']
  ]);
}
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const upload = (name,buffer) => ({name,mimeType:mime,buffer});
const wb = b => XLSX.read(b,{type:'buffer',cellFormula:true});
function data(file,sheet) {
  return XLSX.utils.sheet_to_json(file.Sheets[sheet],{header:1,defval:''});
}

test('business preview filters project pages, exports paired standard accounts, and keeps each generated supplement', async t => {
  const executablePath=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  if(!fs.existsSync(executablePath))return t.skip('Chromium unavailable');
  const browser=await chromium.launch({headless:true,executablePath});
  t.after(()=>browser.close());
  const page=await browser.newPage({acceptDownloads:true,viewport:{width:1360,height:960}});
  page.setDefaultTimeout(9000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(dist,'index.html')).href);
  const [a,b,c]=await page.evaluate(async()=>{
    const set=[['合成甲公司','合成甲年度项目','年度财务报表审计'],['合成乙公司','合成乙年度项目','年度财务报表审计'],['合成甲公司','合成甲经责项目','经济责任审计']];
    const now=new Date().toISOString(),ids=[];
    for(const [customerName,projectName,projectType]of set){
      const id=crypto.randomUUID();ids.push(id);
      await ProjectInitiation.ensureWon({id,lastEventNo:1,events:[{eventNo:1,outcome:'won',recordedAt:now}],
        snapshot:{projectName,issuer:'合成发标方',customerName,firmName:'合成甲事务所',auditYear:2026,quoteDate:'2026-11-27',totalCents:120000,projectType}});
    }
    return ids;
  });

  const sidebar = selector=>page.locator('.workspace-navigation '+selector).evaluate(el=>el.click());
  await sidebar('[data-nav-audit-step="8"]');
  const company=page.locator('#pw-company'),type=page.locator('#pw-project-type'),project=page.locator('#pw-project');
  await company.selectOption(ENTITY);
  assert.equal(await type.isVisible(),false);
  assert.equal(await project.isEnabled(),true);
  assert.equal(await project.inputValue(),'');
  assert.equal(await project.locator('option[value="'+b+'"]').count(),0);
  await project.selectOption(c);
  await page.getByLabel('三栏账',{exact:true}).waitFor();
  await company.selectOption('合成乙公司');
  assert.equal(await project.inputValue(),b);
  assert.equal(await project.locator('option[value="'+a+'"],option[value="'+c+'"]').count(),0);
  await company.selectOption(ENTITY);
  await project.selectOption(a);
  const privacy=page.locator('#pw-privacy-tools'),privacyToggle=privacy.locator('summary');
  const ledgerButton=privacy.getByRole('button',{name:'直接导出',exact:true});
  assert.equal(await project.getAttribute('id'),await page.getByRole('combobox',{name:'审计项目名称',exact:true}).getAttribute('id'));
  assert.equal(await privacyToggle.textContent(),'导出序时账');
  assert.equal(await page.locator('#pw-journal-export').count(),0);
  const ledgerPanel=page.locator('[data-audit-auto-check]');
  await page.waitForFunction(()=>document.querySelector('[data-audit-auto-check] [role=status]')?.textContent.includes('尚无已上传'));
  assert.equal(await page.getByRole('heading',{name:'账表校验',exact:true}).count(),1);
  assert.deepEqual(await ledgerPanel.locator('.ledger-standard-actions button').allTextContents(),['使用已上传资料','核验']);
  assert.equal(await page.getByRole('button',{name:'导出已保存完整底稿包',exact:true}).isVisible(),false);
  await privacyToggle.click();
  await ledgerButton.click();
  await page.locator('#pw-status').getByText('请先选择账表资料并点击「核验」。').waitFor();
  await privacyToggle.click();
  assert.deepEqual(await privacy.getByRole('button').allTextContents(),['导出脱敏版','导出删除摘要列版','直接导出']);
  await privacyToggle.press('Escape');
  assert.equal(await privacy.getByRole('button').count(),0);

  const l1=ledger('100101','库存现金明细',100,null,' 转账。 '),l2=ledger('2202','应付账款',null,90,'支付转账手续费');
  const parent=ledger('1001','库存现金',100,null,' 转账。 ');
  const balances=workbook([
    ['科目余额表'],scoping,trialHeader,
    ['1001','库存现金',0,0,100,0,100,0],['100101','  库存现金明细',0,0,100,0,100,0],['2202','应付账款',0,0,0,100,0,100]
  ]);
  await page.getByLabel('三栏账',{exact:true}).setInputFiles([
    upload('三栏账甲.xlsx',l1),upload('三栏账甲副本.xlsx',l1),upload('三栏账乙.xlsx',l2),upload('三栏账上级汇总.xlsx',parent)
  ]);
  await page.getByLabel('科目余额表',{exact:true}).setInputFiles(upload('科目余额表.xlsx',balances));
  const statements=workbook([
    ['未审资产负债表'],['编制单位：'+ENTITY,'2026年2月28日','币种：CNY'],['项目','期初数','期末数'],
    ['资产总计',0,105],['负债合计',0,100],['所有者权益合计',0,0]
  ]);
  await page.getByLabel('未审报表',{exact:true}).setInputFiles(upload('未审报表.xlsx',statements));
  await page.getByRole('button',{name:'核验',exact:true}).click();
  await page.getByRole('heading',{name:'差异及待核事项'}).waitFor();
  assert.match(await page.locator('[data-audit-auto-check]').innerText(),/2202.*贷方发生额.*差额 -10/u);
  assert.match(await page.locator('[data-audit-auto-check]').innerText(),/资产负债表期末.*差额 5\.00/u);
  assert.equal(await page.getByText('选择被审计单位和审计项目后，核对凭证流水、三栏账与科目余额表。',{exact:true}).count(),0);
  async function download(button) {
    const [event] = await Promise.all([page.waitForEvent('download'),button.click()]);
    return {name:event.suggestedFilename(),buffer:fs.readFileSync(await event.path())};
  }
  const journal = await download(page.getByRole('button',{name:'下载标准版凭证流水查询'}));
  const balance = await download(page.getByRole('button',{name:'下载标准版科目余额表'}));
  assert.equal(journal.name,'标准版凭证流水查询.xlsx');
  assert.equal(balance.name,'标准版科目余额表.xlsx');
  const j=wb(journal.buffer),bt=wb(balance.buffer),lines=data(j,'凭证流水查询');
  assert.deepEqual(Array.from(lines[0]),['核算单位','账套名称','会计年度','会计期间','凭证日期','凭证字','凭证号','分录行号','摘要','科目编码','科目名称（全路径）','客户','供应商','部门','项目','个人','币种','汇率','原币借方金额','原币贷方金额','本位币借方金额','本位币贷方金额','附件张数','制单人','审核人','记账人','记账状态']);
  assert.equal(lines.length,3);
  assert.equal(lines[1][6],'000017');
  assert.equal(lines[1][7],'');
  assert.equal(lines[1][20],100);
  assert.equal(lines[1][21],'');
  assert.equal(data(j,'摘要筛查').length,2);
  assert.equal(data(j,'排除及重复').length,2);
  assert.equal(data(bt,'科目余额表').length,4);
  assert.equal(bt.SheetNames.at(-1),'差异及待核');
  assert.ok(data(bt,'发生额勾稽').some(row=>row[0]==='差异'&&row[3]==='2202'&&row[7]===-10));
  await privacyToggle.click();
  const journalExport=await download(ledgerButton);
  assert.equal(journalExport.name,'序时账.xlsx');
  assert.deepEqual(Array.from(data(wb(journalExport.buffer),'凭证流水查询'),row=>Array.from(row)),Array.from(lines,row=>Array.from(row)));
  await privacyToggle.click();
  const maskedFile=await download(privacy.getByRole('button',{name:'导出脱敏版',exact:true}));
  assert.equal(maskedFile.name,'账表-脱敏副本.xlsx');
  const masked=wb(maskedFile.buffer),maskedJournal=data(masked,'凭证流水查询'),maskedBalance=data(masked,'科目余额表');
  assert.deepEqual(Array.from(masked.SheetNames),['凭证流水查询','科目余额表']);
  assert.equal(maskedJournal[1][0],maskedBalance[1][0]);
  assert.equal(maskedJournal[1][9],lines[1][9]);
  assert.equal(maskedJournal[1][20],lines[1][20]);
  assert.equal(maskedJournal[1][8],'已脱敏');
  assert.doesNotMatch(JSON.stringify([maskedJournal,maskedBalance]),/合成甲公司|合成账套|专用敏感|支付转账手续费|三栏账甲|000017/);
  await privacyToggle.click();
  const removed=await download(privacy.getByRole('button',{name:'导出删除摘要列版'}));
  assert.equal(removed.name,'序时账-已删除摘要列-合成-0001.xlsx');
  const noSummary=wb(removed.buffer);
  assert.deepEqual(Array.from(noSummary.SheetNames),['凭证流水查询']);
  const redactedRows=data(noSummary,'凭证流水查询');
  assert.deepEqual(Array.from(redactedRows,row=>Array.from(row)),Array.from(lines,row=>Array.from(row).filter((_,i)=>![0,1,8].includes(i))));
  assert.doesNotMatch(JSON.stringify(redactedRows),/合成甲公司|合成账套|支付转账手续费/u);
  await privacyToggle.click();
  assert.equal((await download(privacy.getByRole('button',{name:'导出删除摘要列版'}))).name,'序时账-已删除摘要列-合成-0002.xlsx');
  await privacyToggle.click();
  const originalAfter=await download(ledgerButton);
  assert.equal(data(wb(originalAfter.buffer),'凭证流水查询')[1][8],lines[1][8]);
  await page.evaluate(async ({id,files,mime})=>{
    const S=ProjectWorkspaceStore,record=await S.get(id);
    const client=await Promise.all(files.map(([name,bytes])=>AuditChecklist.prepareFile(new File([Uint8Array.from(bytes)],name,{type:mime}))));
    await S.save(id,record.rev,{auditWorkflow:{schemaVersion:1,currentStage:'client',completed:'',archived:'',confirmedBy:'',files:{client}}});
  },{id:a,files:[['已上传三栏账.xlsx',[...l1]],['已上传科目余额表.xlsx',[...balances]],['已上传未审报表.xlsx',[...statements]]],mime});
  const saved=ledgerPanel.getByRole('button',{name:'使用已上传资料',exact:true});
  await saved.click();
  await ledgerPanel.getByText(/资产负债表期末.*差额 5\.00/u).waitFor();
  assert.match(await ledgerPanel.innerText(),/已上传未审报表\.xlsx/);
  assert.equal(await ledgerPanel.getByText('本轮已选',{exact:false}).count(),0);

  await sidebar('[data-nav-audit-step="9"]');
  await page.locator('.swp-generate').waitFor();
  assert.equal(await company.inputValue(),ENTITY);
  assert.equal(await type.count(),0);
  assert.equal(await page.locator('#pw-package-export').isVisible(),false);
  assert.equal(await privacy.isVisible(),false);
  assert.equal(await ledgerButton.isVisible(),false);
  assert.equal(await project.inputValue(),a);
  assert.deepEqual(new Set(await project.locator('option:not([hidden])').evaluateAll(options=>options.map(option=>option.value))),new Set(['',a,c]));
  const directory=page.getByRole('table',{name:'补充底稿目录'});
  await project.selectOption('');
  await directory.getByText('选择审计项目后查看该项目的补充底稿。',{exact:true}).waitFor();
  assert.deepEqual(await directory.getByRole('columnheader').allTextContents(),['序号','底稿名称','编制日期','下载']);
  await project.selectOption(c);
  await page.locator('.swp-generate').waitFor();
  await directory.getByText('本项目暂无补充底稿。',{exact:true}).waitFor();
  assert.equal(await project.inputValue(),c);
  await project.selectOption(a);
  const maker=page.locator('.swp-generate');
  const template=workbook([['名称','{{期末金额}}',0],['待补','{{经办人}}']],'补充样表',true);
  const materials=workbook([['期末金额',123.45]]);
  for(const [i,name]of ['第一份盘点底稿','第二份盘点底稿'].entries()){
    await maker.getByRole('textbox',{name:'补充底稿名称'}).fill(name);
    const tr=await page.evaluateHandle(({bytes,name})=>{
      const transfer=new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(bytes)],name));return transfer;
    },{bytes:[...template],name:'盘点底稿模板.xlsx'});
    await maker.locator('.quote-file-drop').first().dispatchEvent('drop',{dataTransfer:tr});
    await maker.getByLabel('拖入补充底稿资料').setInputFiles(upload('盘点资料.xlsx',materials));
    await maker.getByRole('button',{name:'生成并保存补充底稿'}).click();
    await page.getByRole('dialog',{name:'保存成功'}).getByRole('button',{name:'确定'}).click();
    await maker.getByRole('button',{name:'下载 '+name}).waitFor();
    assert.equal(await maker.locator('[data-generated-supplement]').count(),i+1);
  }
  const result=await download(maker.getByRole('button',{name:'下载 第一份盘点底稿'}));
  const filled=wb(result.buffer).Sheets.补充样表;
  assert.equal(filled.B1.v,123.45);
  assert.equal(filled.C1.f,'B1*2');
  assert.equal(filled.B2.v,'{{经办人}}');
  const records=await page.evaluate(async id=>(await ProjectWorkspaceStore.get(id)).supplementalWorkpapers.map(r=>r.generation),a);
  assert.equal(records.length,2);
  assert.equal(records[0].pending[0].field,'经办人');
  assert.ok(records[0].trace[0].source.includes('盘点资料.xlsx'));
  assert.deepEqual(await directory.locator('tbody tr td:first-child').allTextContents(),['1','2']);
  assert.match(await directory.locator('tbody tr').first().innerText(),/第二份盘点底稿/);
  for(const date of await directory.locator('time').allTextContents())assert.match(date,/^\d{4}-\d{2}-\d{2}$/);
  await maker.getByText('管理已上传的底稿原件',{exact:true}).click();
  await maker.locator('#supplemental-add').click();
  await maker.getByRole('textbox',{name:'科目名称',exact:true}).fill('已上传的盘点记录');
  await maker.getByRole('textbox',{name:'科目编码',exact:true}).fill('4100');
  await maker.locator('[data-supplemental-upload]').setInputFiles({name:'盘点记录.txt',mimeType:'text/plain',buffer:Buffer.from('合成盘点记录')});
  await maker.locator('#supplemental-save').click();
  await page.getByRole('dialog',{name:'保存成功'}).getByRole('button',{name:'确定'}).click();
  const uploaded=directory.getByRole('row',{name:/已上传的盘点记录/});
  await uploaded.waitFor();
  assert.equal(await uploaded.getByRole('cell').nth(2).innerText(),'未记录');
  const uploadedCopy=await download(uploaded.getByRole('button',{name:'下载 已上传的盘点记录'}));
  assert.equal(uploadedCopy.name,'盘点记录.txt');
  assert.equal(uploadedCopy.buffer.toString(),'合成盘点记录');
  await project.selectOption(c);
  await directory.getByText('本项目暂无补充底稿。',{exact:true}).waitFor();
  await project.selectOption(a);
  await uploaded.waitFor();
  assert.equal(await directory.locator('[data-supplemental-entry]').count(),3);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.setViewportSize({width:1360,height:960});

  await sidebar('[data-view="archive"]');
  const archiveCompany=page.locator('#audit-archive-company'),archiveProject=page.locator('#audit-archive-project');
  await archiveCompany.selectOption(ENTITY);
  assert.equal(await archiveProject.locator('option[value="'+b+'"]').count(),0);
  await archiveProject.selectOption(a);
  await page.getByText('已读取该项目本机工作区与当前资料清单。',{exact:false}).waitFor();
  await archiveCompany.selectOption('合成乙公司');
  assert.equal(await archiveProject.inputValue(),'');
  assert.equal(await archiveProject.locator('option[value="'+a+'"]').count(),0);
  await archiveProject.selectOption(b);
  assert.equal(await page.evaluate(async b=>!!(await ProjectWorkspaceStore.get(b)).supplementalWorkpapers,b),false);

  await sidebar('[data-report-section="audit-report"]');
  const footer=page.locator('#report-audit-report .rw-tb-footer');
  await footer.waitFor();
  assert.deepEqual(await footer.locator('button').allTextContents(),['上一张表','下一张表','保存本表填写','下载报告','刷新报告']);
  assert.ok(await footer.getByRole('button',{name:'下载报告',exact:true}).isDisabled());
  assert.deepEqual(errors,[]);
});

test('the supplemental workpaper page processes 1000 worksheets and rejects 1001',async t=>{
  const executablePath=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  if(!fs.existsSync(executablePath))return t.skip('Chromium unavailable');
  const browser=await chromium.launch({headless:true,executablePath});
  t.after(()=>browser.close());
  const page=await browser.newPage({acceptDownloads:true,viewport:{width:1360,height:900}});
  await page.goto(pathToFileURL(path.join(dist,'index.html')).href);
  await page.evaluate(async()=>{
    const id=crypto.randomUUID(),now=new Date().toISOString();
    await ProjectInitiation.ensureWon({id,lastEventNo:1,events:[{eventNo:1,outcome:'won',recordedAt:now}],
      snapshot:{projectName:'合成多表补充底稿项目',issuer:'合成发标方',customerName:'合成多表公司',firmName:'合成事务所',
        auditYear:2026,quoteDate:'2026-11-27',totalCents:120000,projectType:'年度财务报表审计'}});
  });
  await page.locator('.workspace-navigation [data-nav-audit-step="9"]').evaluate(node=>node.click());
  await page.locator('#pw-company').selectOption('合成多表公司');

  function manySheets(count,template){
    const book=XLSX.utils.book_new();
    for(let i=1;i<=count;i++){
      const sheet=XLSX.utils.aoa_to_sheet([[template&&i===1000?'{{第1000张!A1}}':i,42]]);
      if(template&&i===1000)sheet.B1={t:'n',v:42,f:'6*7'};
      XLSX.utils.book_append_sheet(book,sheet,'第'+i+'张');
    }
    return Buffer.from(XLSX.write(book,{type:'array',bookType:'xlsx',compression:true}));
  }
  const template=manySheets(1000,true),source=manySheets(1000,false),oversized=manySheets(1001,false);
  const form=page.locator('.swp-generate');
  const templateInput=form.getByLabel('拖入补充底稿模板'),sourceInput=form.getByLabel('拖入补充底稿资料');
  const generate=form.getByRole('button',{name:'生成并保存补充底稿'});
  const name=form.getByRole('textbox',{name:'补充底稿名称'});
  await name.fill('合成1000张');
  await templateInput.setInputFiles(upload('1000张模板.xlsx',template));
  await sourceInput.setInputFiles(upload('1000张资料.xlsx',source));
  await generate.click();
  await page.getByRole('dialog',{name:'保存成功'}).getByRole('button',{name:'确定'}).click();
  const download=form.getByRole('button',{name:'下载 合成1000张'});
  const [file]=await Promise.all([page.waitForEvent('download'),download.click()]);
  const result=wb(fs.readFileSync(await file.path()));
  assert.equal(result.SheetNames.length,1000);
  assert.equal(result.Sheets['第1000张'].A1.v,1000);
  assert.equal(result.Sheets['第1000张'].B1.f,'6*7');

  await name.fill('超出上限');
  await templateInput.setInputFiles(upload('1000张模板.xlsx',template));
  await sourceInput.setInputFiles(upload('1001张资料.xlsx',oversized));
  await generate.click();
  const errorDialog=page.getByRole('dialog',{name:'保存失败'});
  await errorDialog.getByText('工作表超过1000张',{exact:true}).waitFor();
  await errorDialog.getByRole('button',{name:'确定'}).click();
  assert.equal(await form.locator('[data-generated-supplement]').count(),1);

  await templateInput.setInputFiles(upload('1001张模板.xlsx',oversized));
  await sourceInput.setInputFiles(upload('1000张资料.xlsx',source));
  await generate.click();
  await errorDialog.getByText('工作表超过1000张',{exact:true}).waitFor();
  await errorDialog.getByRole('button',{name:'确定'}).click();
  assert.equal(await form.locator('[data-generated-supplement]').count(),1);
});
