'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');

test('audit workflow stores files and reported progress by project and opens the selected checklist',async t=>{
  const executablePath=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();
  if(!fs.existsSync(executablePath))return t.skip('Existing browser unavailable');
  const browser=await chromium.launch({headless:true,executablePath});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:950}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve(__dirname,'../dist/index.html')).href);
  const [first,second]=await page.evaluate(async()=>{
    const ids=[crypto.randomUUID(),crypto.randomUUID()],now=new Date().toISOString();
    for(const [i,id] of ids.entries())await ProjectInitiation.ensureWon({
      id,lastEventNo:1,events:[{eventNo:1,outcome:'won',recordedAt:now}],
      snapshot:{projectName:'合成项目'+(i+1),issuer:'合成发标公司',customerName:'合成被审计单位'+(i+1),firmName:'合成事务所',
        auditYear:2026,quoteDate:'2026-11-22',totalCents:100000,projectType:'年度财务报表审计'}
    });
    return ids;
  });
  const flow=page.locator('#audit-flow'),project=page.locator('#audit-flow-project');
  const overview=page.getByRole('button',{name:'流程总览',exact:true});
  const stage=key=>flow.locator('[data-workflow-stage='+key+']');
  await overview.click();
  const company=flow.getByRole('combobox',{name:'被审计单位',exact:true});
  await company.selectOption('合成被审计单位1');
  assert.equal(await project.inputValue(),first);
  assert.deepEqual(await project.locator('option').allTextContents(),['请选择已立项项目','合成项目1']);
  await company.selectOption('');
  assert.deepEqual(await flow.locator('[data-workflow-stage] h2').allTextContents(),['客户资料','底稿模板','全套底稿导出','项目复核','报告初版（待核对）']);
  assert.equal(await flow.locator('[data-workflow-stage] input[type=file]').count(),2);
  assert.equal(await stage('template').getByRole('combobox',{name:'选择资料库模板'}).inputValue(),'');
  assert.equal(await stage('template').getByRole('button',{name:'应用模板'}).isDisabled(),true);
  assert.equal(await stage('export').getByRole('button',{name:'下载已保存底稿'}).isEnabled(),true);
  const row=flow.locator('[data-audit-flow-project="'+first+'"]');
  const currentStep=row.locator('td').nth(4);
  assert.equal(await currentStep.textContent(),'—');
  await stage('report').getByRole('button',{name:'下载报告初版'}).click();
  await flow.getByText('本项目尚未保存报告初版，请先打开报告编制。',{exact:true}).waitFor();
  assert.equal(await currentStep.textContent(),'—');
  assert.equal(await page.locator('#audit-program').isVisible(),false);
  const text='仅供界面测试';
  const transfer=await page.evaluateHandle(text=>{
    const data=new DataTransfer();
    data.items.add(new File([text],'合成客户资料.txt',{type:'text/plain'}));return data;
  },text);
  await stage('client').locator('.af-drop').dispatchEvent('drop',{dataTransfer:transfer});
  await stage('client').getByText('合成客户资料.txt',{exact:true}).waitFor();
  assert.equal(await currentStep.textContent(),'客户资料');
  await stage('review').locator('input').setInputFiles({name:'合成审核资料.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
  await stage('review').getByText('合成审核资料.txt',{exact:true}).waitFor();
  assert.equal(await currentStep.textContent(),'项目复核');
  const downloading=page.waitForEvent('download');
  await stage('client').getByRole('button',{name:'下载 合成客户资料.txt'}).click();
  assert.equal(fs.readFileSync(await (await downloading).path(),'utf8'),text);
  const pdf=await page.evaluate(async()=>{const doc=await PDFLib.PDFDocument.create();doc.addPage();return [...await doc.save()];});
  await page.evaluate(async ({id,pdf})=>{
    const workspace=await ProjectWorkspaceStore.get(id),state=workspace.auditWorkflow;
    const file=await AuditChecklist.prepareFile(new File([Uint8Array.from(pdf)],'合成归档.pdf',{type:'application/pdf'}));
    await ProjectWorkspaceStore.save(id,workspace.rev,{auditWorkflow:{...state,files:{...state.files,print:[file]}}});
  },{id:first,pdf});
  await flow.getByRole('button',{name:'刷新项目'}).click();
  await stage('review').getByText('合成归档.pdf',{exact:true}).waitFor();
  assert.equal(await currentStep.textContent(),'项目复核');
  assert.equal(await row.locator('select').count(),0);
  assert.equal(await flow.locator('.af-summary thead .estimate-filter-trigger').count(),3);
  assert.equal(await flow.locator('.af-summary thead select').count(),0);
  async function pickFilter(column,value){
    const name='筛选'+column;
    await flow.getByRole('button',{name,exact:true}).click();
    await flow.getByRole('dialog',{name}).getByRole('button',{name:value,exact:true}).click();
  }
  await pickFilter('当前步骤','项目复核');
  assert.equal(await flow.locator('tbody [data-audit-flow-project]').count(),1);
  await pickFilter('当前步骤','全部');
  await row.getByRole('button',{name:'编辑进度'}).click();
  const editor=flow.getByRole('dialog',{name:'编辑进度'});
  assert.equal(await editor.getByRole('combobox',{name:'是否完成'}).inputValue(),'');
  assert.equal(await editor.getByRole('combobox',{name:'是否归档'}).inputValue(),'');
  await editor.getByRole('combobox',{name:'是否完成'}).selectOption('是');
  await editor.getByRole('combobox',{name:'是否归档'}).selectOption('否');
  await editor.getByRole('textbox',{name:'确认人'}).fill('合成审核人员');
  await editor.getByRole('button',{name:'保存进度'}).click();
  await page.getByText('进度已保存。',{exact:true}).waitFor();
  await pickFilter('是否完成','是');
  assert.equal(await flow.locator('tbody [data-audit-flow-project]').count(),1);
  await pickFilter('是否归档','是');
  assert.equal(await flow.locator('tbody [data-audit-flow-project]').count(),0);
  await pickFilter('是否完成','全部');
  await pickFilter('是否归档','全部');
  await project.selectOption(second);
  assert.equal(await stage('client').getByText('合成客户资料.txt',{exact:true}).count(),0);
  assert.equal(await flow.locator('[data-audit-flow-project="'+second+'"] td').nth(4).textContent(),'—');
  await page.reload();
  await overview.click();
  await project.selectOption(first);
  assert.match(await row.locator('td').last().textContent(),/合成审核人员/);
  assert.equal(await currentStep.textContent(),'项目复核');
  await stage('review').getByText('合成归档.pdf',{exact:true}).waitFor();
  if(process.env.QUOTE_WORKBENCH_QA_DIR)await page.screenshot({path:path.join(process.env.QUOTE_WORKBENCH_QA_DIR,'audit-workflow.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await stage('client').getByRole('button',{name:'资料清单与核对'}).click();
  await page.waitForFunction(id=>document.querySelector('#ac-project').value===id,first);
  assert.equal(await flow.isVisible(),false);
  assert.equal(await page.locator('#audit-program').isVisible(),true);
  await overview.click();
  await project.selectOption(first);
  assert.equal(await currentStep.textContent(),'客户资料');
  await page.evaluate(async ({id,pdf})=>{
    const db=await AuditChecklist.open();
    try{
      const now=new Date().toISOString(),nodeId='n1';
      let record=await db.importTree({quoteId:id,projectName:'合成项目1',firmName:'合成事务所'},
        [{id:nodeId,parentId:'',level:1,title:'上年审计报告',description:'',kind:'material'}],'合成导入人');
      record=await db.attach(id,record.revision,nodeId,new File([Uint8Array.from(pdf)],'合成上年审计报告.pdf',{type:'application/pdf'}),'合成导入人');
      record=await db.change(id,record.revision,{type:'item',id:nodeId,status:'confirmed',evidence:'合成来源核对',reviewer:'合成核对人'});
      const file=record.attachments[nodeId][0],workspace=await ProjectWorkspaceStore.get(id);
      await ProjectWorkspaceStore.save(id,workspace.rev,{reportDraft:{schemaVersion:1,projectId:id,
        source:{nodeId,fileId:file.id,generationId:record.generationId,recordRevision:record.revision,sha256:file.sha256,name:file.name},
        handover:{year:2026,currency:'CNY',unit:'unit',reviewer:'合成核对人',rows:[]},
        content:'合成报告初版正文',generatedAt:now,updatedAt:now}});
    }finally{db.close();}
  },{id:first,pdf});
  const reportDownload=page.waitForEvent('download');
  await stage('report').getByRole('button',{name:'下载报告初版'}).click();
  const downloadedReport=await reportDownload;
  assert.equal(downloadedReport.suggestedFilename(),'报告初版（待核对）.docx');
  const bytes=[...fs.readFileSync(await downloadedReport.path())];
  assert.match(await page.evaluate(async bytes=>new TextDecoder().decode((await ProjectWorkspaceStore.parts(new File([Uint8Array.from(bytes)],'draft.docx')))['word/document.xml']),bytes),/合成报告初版正文/);
  await currentStep.getByText('报告初版（待核对）',{exact:true}).waitFor();
  const templateSha=await page.evaluate(async projectId=>{
    const store=await AuditTemplates.open();
    let known;
    try{
      const {record}=await store.put(new File(['合成预置模板内容'],'合成底稿模板.zip'));
      known={name:record.name,sha256:record.sha256,files:1};
      await store.put(new File(['其他合成原件'],'未登记版式.xlsx'));
    }finally{store.close();}
    const routing=WorkpaperRouting;
    globalThis.WorkpaperRouting={...routing,archives:()=>[...routing.archives(),known],
      identifyArchive:hash=>hash===known.sha256?known:routing.identifyArchive(hash)};
    globalThis.WorkpaperLibrary={...WorkpaperLibrary,async importFiles(files,workspace){
      if(workspace.id!==projectId||files.length!==1||await ProjectWorkspaceStore.hash(files[0])!==known.sha256)throw Error('未收到所选项目与模板原件');
      return {patch:{workpaperSources:workspace.workpaperSources||{}}};
    }};
    return known.sha256;
  },first);
  await flow.getByRole('button',{name:'刷新项目'}).click();
  const templates=stage('template').getByRole('combobox',{name:'选择资料库模板'});
  await templates.selectOption(templateSha);
  assert.deepEqual(await templates.locator('option').allTextContents(),['请选择资料库模板','合成底稿模板.zip']);
  await stage('template').getByRole('button',{name:'应用模板'}).click();
  await page.waitForFunction(()=>!document.querySelector('#audit-flow-project').disabled);
  assert.equal(await flow.locator('#audit-flow-status').textContent(),'已应用所选底稿模板。');
  assert.equal(await currentStep.textContent(),'底稿模板');
  await stage('report').getByRole('button',{name:'打开报告编制'}).click();
  await page.waitForFunction(id=>document.querySelector('#report-project')?.value===id,first);
  assert.equal(await page.locator('#report-audit-report').isVisible(),true);
  assert.deepEqual(errors,[]);
});
