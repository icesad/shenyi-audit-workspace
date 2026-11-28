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
  await page.addLocatorHandler(page.locator('#save-result-dialog[open]').filter({has:page.getByRole('heading',{name:/^保存/})}),
    dialog=>dialog.getByRole('button',{name:'确定',exact:true}).click());
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
  for(const [section,id,i] of [['trial-balance',first,1],['audit-report',second,2]]){
    await page.locator('[data-report-section="'+section+'"]').click();
    const reportProject=page.locator('#report-project');
    await page.waitForFunction(id=>[...document.querySelector('#report-project').options].some(option=>option.value===id),id);
    await reportProject.selectOption(id);
    await page.locator('#view-report').getByRole('button',{name:'返回',exact:true}).click();
    assert.equal(await page.locator('#page-title').textContent(),'流程总览');
    await page.waitForFunction(id=>document.querySelector('#audit-flow-project').value===id,id);
    assert.equal(await company.inputValue(),'合成被审计单位'+i);
  }
  await page.locator('[data-report-section=trial-balance]').click();
  await page.locator('#report-project').selectOption('');
  await page.locator('#report-back-to-overview').click();
  await page.waitForFunction(()=>document.querySelector('#audit-flow-project').value==='');
  assert.equal(await company.inputValue(),'');
  const planning=stage('initial');
  assert.equal(await planning.getByRole('button',{name:'风险评估'}).isDisabled(),true);
  for(const width of [1440,1180,760,400]){
    await page.setViewportSize({width,height:900});
    const aligned=await flow.locator('.af-stage > .upload-drop').evaluateAll(zones=>zones.every(zone=>{
      const face=zone.querySelector('.upload-drop-face').getBoundingClientRect();
      const sibling=zone.parentElement.querySelector(':scope > .btn:not(.upload-drop)')||zone;
      const button=sibling.getBoundingClientRect(),card=zone.parentElement.getBoundingClientRect();
      return Math.abs(face.left-button.left)<1&&Math.abs(face.right-button.right)<1&&face.right<card.right;
    }));
    assert.equal(aligned,true,'upload alignment at '+width);
  }
  await page.setViewportSize({width:1440,height:950});
  await company.selectOption('合成被审计单位1');
  for(const [name,tree,folder] of [['初步业务活动','#pw-initial-tree','1、初步业务活动工作底稿'],['风险评估','#pw-risk-tree','2、计划及风险识别阶段工作底稿']]){
    await planning.getByRole('button',{name,exact:true}).click();
    await page.locator(tree).waitFor({state:'attached'});
    await page.locator('#pw-archive').locator('..').waitFor();
    assert.equal(await page.locator('#pw-project').inputValue(),first);
    assert.equal(await page.locator('#pw-company').inputValue(),'合成被审计单位1');
    const sample=await page.evaluate(async folder=>{
      const book=await LedgerStandard.workbook([{name:'测试',columns:['项目','金额'],rows:[['合成记录',1]]}]);
      return [...QuoteLayouts.packOfficeParts({[folder+'/测试底稿.xlsx']:book})];
    },folder);
    await page.locator('#pw-archive').setInputFiles({name:'合成'+name+'.zip',mimeType:'application/zip',buffer:Buffer.from(sample)});
    await page.locator(tree).getByText('测试底稿.xlsx',{exact:true}).waitFor({timeout:5000});
    await overview.click();
    await flow.locator('[data-audit-flow-project="'+first+'"]').getByRole('button',{name,exact:true}).click();
    await page.locator(tree).getByText('测试底稿.xlsx',{exact:true}).waitFor();
    if(name==='风险评估'){
      await page.locator('#pw-company').selectOption('合成被审计单位2');
      await page.locator('#pw-risk-tree').waitFor({state:'attached'});
      assert.equal(await page.locator('#pw-project').inputValue(),second);
      assert.equal(await page.locator('#pw-risk-tree').getByText('测试底稿.xlsx',{exact:true}).count(),0);
    }
    await overview.click();
  }
  await company.selectOption('合成被审计单位1');
  assert.equal(await project.inputValue(),first);
  assert.deepEqual(await project.locator('option').allTextContents(),['请选择已立项项目','合成项目1']);
  await stage('ledger').getByRole('button',{name:'校验',exact:true}).click();
  await page.getByRole('heading',{name:'三栏账、科目余额表、未审报表核验'}).waitFor();
  assert.deepEqual(await page.locator('.ledger-file-boxes .upload-drop-face').allTextContents(),['三栏账','科目余额表','未审报表']);
  assert.equal(await page.locator('#pw-company').inputValue(),'合成被审计单位1');
  assert.equal(await page.locator('#pw-project').inputValue(),first);
  await overview.click();
  await company.selectOption('');
  assert.deepEqual(await flow.locator('[data-workflow-stage] > h2').allTextContents(),['初步业务活动及风险评估','客户资料','账表校验','函证制作模板','全套底稿上传','报告出具']);
  assert.deepEqual(await stage('report').getByRole('button').allTextContents(),['下载报告初版','打开报告编制','审定表盖章版','下载最终版全套报告']);
  assert.equal(await flow.locator('[data-workflow-stage] input[type=file]').count(),4);
  assert.equal(await stage('review').count(),0);
  assert.equal(await flow.getByText('底稿模板管理',{exact:true}).count(),0);
  const exportCard=stage('export'),uploadButton=exportCard.getByRole('button',{name:'上传已编制底稿'});
  assert.deepEqual(await exportCard.getByRole('button').allTextContents(),['已编制底稿']);
  assert.equal(await uploadButton.isEnabled(),true);
  assert.equal(await exportCard.locator('input[type=file]').isVisible(),false);
  const row=flow.locator('[data-audit-flow-project="'+first+'"]');
  const currentStep=row.locator('td').nth(4);
  assert.equal(await currentStep.textContent(),'账表校验');
  const otherRow=flow.locator('[data-audit-flow-project="'+second+'"]');
  await company.selectOption('合成被审计单位2');
  await row.locator('.af-project-number').click();
  assert.equal(await company.inputValue(),'合成被审计单位1');
  assert.equal(await project.inputValue(),first);
  assert.equal(await flow.isVisible(),true);
  await otherRow.getByRole('button',{name:'合成被审计单位2',exact:true}).click();
  await page.waitForFunction(id=>document.querySelector('#ac-project').value===id,second);
  assert.equal(await page.locator('#ac-company').inputValue(),'合成被审计单位2');
  await overview.click();
  assert.equal(await otherRow.locator('td').nth(4).textContent(),'—');
  await row.getByRole('button',{name:'合成被审计单位1',exact:true}).click();
  await page.getByRole('heading',{name:'三栏账、科目余额表、未审报表核验'}).waitFor();
  assert.equal(await page.locator('#pw-company').inputValue(),'合成被审计单位1');
  assert.equal(await page.locator('#pw-project').inputValue(),first);
  await overview.click();
  await currentStep.getByRole('button',{name:'账表校验',exact:true}).click();
  await page.getByRole('heading',{name:'三栏账、科目余额表、未审报表核验'}).waitFor();
  assert.equal(await page.locator('#pw-project').inputValue(),first);
  await overview.click();
  const confirmation=stage('confirmation'),getLetter=confirmation.getByRole('button',{name:'下载函证',exact:true});
  const sourceButton=confirmation.getByRole('button',{name:'函证控制信息表与三栏账',exact:true});
  const sourceDialog=confirmation.getByRole('dialog',{name:'函证控制信息表与三栏账',exact:true});
  assert.deepEqual(await confirmation.getByRole('button').allTextContents(),['函证模板','函证控制信息表与三栏账','下载函证']);
  await getLetter.click();await flow.getByText('请先上传本项目的函证控制信息表和三栏账。',{exact:true}).waitFor();
  const inputs=await page.evaluate(async()=>{
    const make=(columns,rows)=>LedgerStandard.workbook([{name:'资料',columns,rows}]);
    const columns=['函证编号','被询证单位','函证基准日','科目名称','函证金额','币种'];
    const control=[['X-01','甲方公司','2026-09-30','应收账款',1234.56,'CNY'],['X-02','乙方公司','2026-09-30','应付账款',230,'CNY']];
    const ledger=await make(['日期','往来单位','科目名称','方向','往来单位余额','币种'],[['2026-09-30','甲方公司','应收账款','借',1234.56,'CNY'],['2026-09-30','乙方公司','应付账款','贷',230,'CNY']]);
    const good=await make(columns,control);control[0][4]=777;
    return {good:[...good],bad:[...await make(columns,control)],ledger:[...ledger]};
  });
  const xlsx=(name,bytes)=>({name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
  async function sources(control,ledger){
    await sourceButton.click();
    await sourceDialog.getByLabel('函证控制信息表',{exact:true}).setInputFiles(xlsx('函证控制表.xlsx',control));
    if(ledger)await sourceDialog.getByLabel('函证用三栏账',{exact:true}).setInputFiles(xlsx('往来三栏账.xlsx',ledger));
    await sourceDialog.getByRole('button',{name:'上传资料'}).click();await sourceDialog.waitFor({state:'hidden'});
  }
  await sources(inputs.bad,inputs.ledger);
  await getLetter.click();await flow.getByText(/甲方公司.*777.00.*1,234.56.*存在差异/u).waitFor({timeout:8000});
  await sources(inputs.good);
  await page.evaluate(()=>{
    window.confirmationDrawn=[];
    const prev=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(t,...args){window.confirmationDrawn.push(t);return prev.call(this,t,...args);};
  });
  async function downloadLetter(){
    const [file]=await Promise.all([page.waitForEvent('download',{timeout:10000}),getLetter.click()]);
    assert.equal(file.suggestedFilename(),'合成被审计单位1-函证.pdf');
    const bytes=fs.readFileSync(await file.path());
    assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
    assert.equal(await page.evaluate(async raw=>(await PDFLib.PDFDocument.load(Uint8Array.from(raw))).getPageCount(),[...bytes]),2);
    return bytes;
  }
  const builtIn=await downloadLetter();
  if(process.env.CONFIRMATION_QA_PDF)fs.writeFileSync(process.env.CONFIRMATION_QA_PDF,builtIn);
  const drawn=await page.evaluate(()=>window.confirmationDrawn.join(' '));
  for(const s of ['企业往来款项询证函','甲方公司','乙方公司','1,234.56','230.00','2026-09-30','合成事务所','X-01','X-02','回函意见'])assert.ok(drawn.includes(s),s);
  assert.doesNotMatch(drawn,/\{\{/u);
  const templatePicker=confirmation.getByRole('dialog',{name:'上传/选择函证模板'});
  await confirmation.getByRole('button',{name:'上传/选择函证模板',exact:true}).click();
  const customBytes=Buffer.from(await page.evaluate(async()=>{
    const doc=await PDFLib.PDFDocument.create(),p=doc.addPage(),form=doc.getForm();p.drawText('Confirmation form');
    for(const [i,name] of ['被询证单位','函证金额'].entries())form.createTextField(name).addToPage(p,{x:50,y:600-i*50,width:260,height:30});
    return [...await doc.save()];
  }));
  await templatePicker.locator('input[type=file]').setInputFiles({name:'合成函证模板.pdf',mimeType:'application/pdf',buffer:customBytes});
  await templatePicker.getByText('已上传并选用：合成函证模板.pdf',{exact:true}).waitFor();
  await templatePicker.getByRole('button',{name:'关闭',exact:true}).click();
  await page.reload();await overview.click();await company.selectOption('合成被审计单位2');
  await getLetter.click();await flow.getByText('请先上传本项目的函证控制信息表和三栏账。',{exact:true}).waitFor();
  await company.selectOption('合成被审计单位1');
  const filled=await downloadLetter();assert.notDeepEqual(filled,customBytes);
  await confirmation.getByRole('button',{name:'上传/选择函证模板',exact:true}).click();
  await templatePicker.getByRole('button',{name:'使用内置模板',exact:true}).click();
  await templatePicker.getByText('当前模板：内置往来款项询证函',{exact:true}).waitFor();
  await templatePicker.getByRole('button',{name:'关闭',exact:true}).click();
  await downloadLetter();
  const finalButton=stage('report').getByRole('button',{name:'下载最终版全套报告',exact:true});
  await finalButton.click();
  await flow.getByText('请先上传本项目的审定表盖章版 PDF。',{exact:true}).waitFor();
  const approvedPdfs=await page.evaluate(async()=>{
    const result=[];
    for(const [title,pages] of [['合成审定表',1],['合成全套报告',3]]){
      const doc=await PDFLib.PDFDocument.create();doc.setTitle(title);
      for(let i=0;i<pages;i++)doc.addPage();
      result.push([...await doc.save()]);
    }
    return result;
  });
  const reportUpload=stage('report').getByRole('button',{name:'上传审定表盖章版'});
  await reportUpload.evaluate((zone,bytes)=>{
    const transfer=new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(bytes)],'合成审定表.pdf',{type:'application/pdf'}));
    zone.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
  },approvedPdfs[0]);
  const reportEditor=flow.getByRole('dialog',{name:'上传审定表盖章版'});
  assert.equal(await reportEditor.locator('input[type=file]').count(),1);
  await reportEditor.getByRole('button',{name:'保存所选 PDF'}).click();
  await reportEditor.waitFor({state:'hidden'});
  await finalButton.click();
  await flow.getByText('请先在报告编制中保存本项目的报告正文。',{exact:true}).waitFor();
  assert.equal(await currentStep.textContent(),'报告出具');
  assert.deepEqual(await page.evaluate(async id=>{
    const state=(await ProjectWorkspaceStore.get(id)).auditWorkflow;
    return [state.files.signedTables[0].name,state.files.finalReport?.length||0];
  },first),['合成审定表.pdf',0]);
  await stage('report').getByRole('button',{name:'下载报告初版'}).click();
  await flow.getByText('本项目尚未保存报告初版，请先打开报告编制。',{exact:true}).waitFor();
  assert.equal(await currentStep.textContent(),'报告出具');
  const text='仅供界面测试';
  const client=stage('client');
  assert.deepEqual(await client.getByRole('button').allTextContents(),['资料收集','下载全部资料']);
  assert.equal(await client.locator('input[type=file],ul').count(),0);
  const allFiles=client.getByRole('button',{name:'下载全部资料'});
  await allFiles.click();
  await flow.getByText('本项目尚未保存原始资料。',{exact:true}).waitFor();
  await page.evaluate(async({id,text})=>{
    const w=await ProjectWorkspaceStore.get(id),s=w.auditWorkflow;
    const f=await AuditChecklist.prepareFile(new File([text],'合成客户资料.txt',{type:'text/plain'}));
    await ProjectWorkspaceStore.save(id,w.rev,{auditWorkflow:{...s,files:{...s.files,client:[f]}}});
  },{id:first,text});
  const [original]=await Promise.all([page.waitForEvent('download'),allFiles.click()]);
  assert.equal(fs.readFileSync(await original.path(),'utf8'),text);
  const pdf=await page.evaluate(async()=>{const doc=await PDFLib.PDFDocument.create();doc.addPage();return [...await doc.save()];});
  await page.evaluate(async ({id,pdf,text})=>{
    const workspace=await ProjectWorkspaceStore.get(id),state=workspace.auditWorkflow;
    const file=await AuditChecklist.prepareFile(new File([Uint8Array.from(pdf)],'合成归档.pdf',{type:'application/pdf'}));
    const review=await AuditChecklist.prepareFile(new File([text],'合成审核资料.txt',{type:'text/plain'}));
    const blob=new File([QuoteLayouts.packOfficeParts({'合成说明.txt':'历史模板'})],'历史模板.zip',{type:'application/zip'});
    const store=await AuditTemplates.open();let template;
    try{template=(await store.put(blob)).record;}finally{store.close();}
    const compilation={startedAt:'2026-11-26T02:00:00.000Z',completedAt:'2026-11-26T03:00:00.000Z'};
    await ProjectWorkspaceStore.save(id,workspace.rev,{auditWorkflow:{...state,compilation,completed:'否',currentStage:'review',files:{...state.files,review:[review],print:[file],template:[{kind:'template-library',name:template.name,size:template.size,type:template.type,sha256:template.sha256}]}}});
  },{id:first,pdf,text});
  await flow.getByRole('button',{name:'刷新项目'}).click();
  await currentStep.getByText('项目复核',{exact:true}).waitFor();
  assert.equal(await currentStep.textContent(),'项目复核');
  await currentStep.getByRole('button',{name:'项目复核',exact:true}).click();
  await page.waitForFunction(id=>document.querySelector('#audit-archive-project')?.value===id,first);
  assert.equal(await page.locator('#audit-archive-company').inputValue(),'合成被审计单位1');
  await overview.click();
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
  assert.equal(await editor.getByRole('combobox',{name:'是否完成'}).inputValue(),'否');
  assert.equal(await editor.getByRole('combobox',{name:'是否归档'}).inputValue(),'');
  await editor.getByRole('combobox',{name:'是否完成'}).selectOption('是');
  await editor.getByRole('combobox',{name:'是否归档'}).selectOption('否');
  await editor.getByRole('textbox',{name:'确认人'}).fill('合成审核人员');
  await editor.getByRole('button',{name:'保存进度'}).click();
  await flow.getByText('进度已保存。',{exact:true}).waitFor();
  await pickFilter('是否完成','是');
  assert.equal(await flow.locator('tbody [data-audit-flow-project]').count(),1);
  await pickFilter('是否归档','是');
  assert.equal(await flow.locator('tbody [data-audit-flow-project]').count(),0);
  await pickFilter('是否完成','全部');
  await pickFilter('是否归档','全部');
  await company.selectOption('合成被审计单位2');
  assert.equal(await stage('client').getByText('合成客户资料.txt',{exact:true}).count(),0);
  assert.equal(await flow.locator('[data-audit-flow-project="'+second+'"] td').nth(4).textContent(),'—');
  await page.reload();
  await overview.click();
  await project.selectOption(first);
  assert.match(await row.locator('td').last().textContent(),/合成审核人员/);
  const alignment=await row.evaluate(line=>{
    const midpoint=element=>{const bounds=element.getBoundingClientRect();return (bounds.top+bounds.bottom)/2;};
    const actions=line.querySelector('.af-confirmer-actions');
    return [Math.abs(midpoint(actions.querySelector('span'))-midpoint(actions.querySelector('button'))),
      Math.abs(midpoint(actions.querySelector('button'))-midpoint(line.cells[0]))];
  });
  assert.ok(alignment.every(delta=>delta<=1),alignment.join(', '));
  assert.deepEqual(await exportCard.getByRole('button').allTextContents(),['已编制底稿']);
  assert.equal(await currentStep.textContent(),'项目复核');
  assert.deepEqual(await page.evaluate(async id=>{const {files}= (await ProjectWorkspaceStore.get(id)).auditWorkflow;return [files.review[0].name,files.print[0].name,files.template[0].name];},first),['合成审核资料.txt','合成归档.pdf','历史模板.zip']);
  if(process.env.QUOTE_WORKBENCH_QA_DIR)await page.screenshot({path:path.join(process.env.QUOTE_WORKBENCH_QA_DIR,'audit-workflow.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await stage('client').getByRole('button',{name:'资料收集'}).click();
  await page.waitForFunction(id=>document.querySelector('#ac-project').value===id,first);
  assert.equal(await flow.isVisible(),false);
  assert.equal(await page.locator('#audit-program').isVisible(),true);
  assert.equal(await page.locator('#ac-company').inputValue(),'合成被审计单位1');
  await page.locator('#ac-company').selectOption('合成被审计单位2');
  assert.equal(await page.locator('#ac-project').inputValue(),second);
  assert.deepEqual(await page.locator('#ac-project option').allTextContents(),['请选择已保存的立项','合成项目2']);
  assert.equal(await page.getByRole('combobox',{name:'审计项目名称',exact:true}).count(),1);
  assert.equal(await page.locator('#ac-template-box,#ac-reason,#ac-preservation-import,.ac-history,[data-history-download]').count(),0);
  assert.deepEqual(await page.locator('.ac-project-fields').evaluate(node=>Array.from(node.children).filter(n=>!n.hidden).map(n=>n.firstChild.textContent)),['被审计单位','审计项目名称','核对人','自制清单']);
  assert.equal(await page.getByRole('button',{name:'使用模板',exact:true}).count(),0);
  await page.locator('#audit-program .ac-list').waitFor({state:'visible'});
  assert.equal(await page.locator('#audit-program .ac-list').isVisible(),true);
  assert.equal(await page.locator('#ac-import-pending').isVisible(),false);
  assert.deepEqual(await page.evaluate(async id=>{
    const db=await AuditChecklist.open();
    try{
      const record=await db.get(id);
      return {nodes:record.nodes.length,allPending:Object.values(record.states).every(state=>state.status==='pending')};
    }finally{db.close();}
  },second),{nodes:112,allPending:true});
  await page.evaluate(async id=>{
    const db=await AuditChecklist.open();
    try{
      let record=await db.get(id);
      const leaves=AuditChecklist.leafNodes(record);
      record=await db.attach(id,record.revision,leaves[0].id,new File(['合成原件'],'合成已上传.txt',{type:'text/plain'}),'合成核对人');
      await db.change(id,record.revision,{type:'item',id:leaves[1].id,status:'na',reason:'合成不适用理由',reviewer:'合成核对人'});
    }finally{db.close();}
  },second);
  await page.locator('#ac-project').selectOption('');
  await page.locator('#ac-project').selectOption(second);
  const attached=page.locator('.ac-item').filter({has:page.getByRole('button',{name:'合成已上传.txt · 预览'})}).first();
  await page.locator('#ac-reviewer').fill('合成初核人');
  await attached.locator('[data-confirm-item]').click();
  await attached.getByRole('button',{name:'✓ 已核对通过'}).waitFor();
  assert.equal(await attached.locator('[data-material-remove]').isDisabled(),true);
  assert.equal(await attached.locator('[data-confirmed-feedback],.ac-evidence,input[id^="ac-evidence-"]').count(),0);
  assert.equal(await page.locator('#ac-close,#ac-reopen').count(),0);
  const fileRow=attached.locator('.ac-material-files > li').first();
  const reviewBar=fileRow.getByRole('group',{name:'本资料项核对操作'});
  assert.equal(await reviewBar.getByRole('button').count(),3);
  assert.equal(await fileRow.evaluate(row=>row.scrollWidth<=row.clientWidth+1),true);
  await page.setViewportSize({width:1280,height:900});
  const centered=await fileRow.evaluate(row=>{
    const center=x=>{const r=x.getBoundingClientRect();return r.top+r.height/2;};
    return Math.abs(center(row.querySelector('[data-material-preview]'))-center(row.querySelector('[data-save-item]')))<1;
  });
  assert.equal(centered,true);
  const green=await attached.evaluate(el=>getComputedStyle(el).backgroundColor);
  const blocked=await page.evaluate(async id=>{
    const db=await AuditChecklist.open();try{
      const r=await db.get(id),leaf=AuditChecklist.leafNodes(r)[0].id;
      try{await db.removeAttachment(id,r.revision,leaf,r.attachments[leaf][0].id,'复核人','移除测试');}
      catch(e){return e.message;}
    }finally{db.close();}
  },second);
  assert.match(blocked,/先打回/);
  const backDialog=page.getByRole('dialog',{name:'打回资料'});
  await attached.locator('[data-reject-item]').click();
  await backDialog.getByRole('button',{name:'取消'}).click();
  assert.equal(await attached.getAttribute('data-review-status'),'confirmed');
  await attached.locator('[data-reject-item]').click();
  await backDialog.getByLabel('核对人',{exact:true}).fill('合成复核人');
  await backDialog.getByLabel('打回原因').fill(' ');
  await backDialog.getByRole('button',{name:'确认打回'}).click();
  await backDialog.getByText('请填写打回原因。',{exact:true}).waitFor();
  await backDialog.getByLabel('打回原因').fill('原件缺少第二页');
  await backDialog.getByRole('button',{name:'确认打回'}).click();
  await attached.getByRole('button',{name:'✕ 已打回'}).waitFor();
  assert.equal(await attached.locator('[data-material-remove]').isEnabled(),true);
  const red=await attached.evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.notEqual(red,green);
  assert.equal(await attached.getAttribute('data-review-status'),'problem');
  assert.equal(await attached.getByText(/打回原因|原件缺少第二页/).count(),0);
  assert.deepEqual(await page.evaluate(async id=>{
    const db=await AuditChecklist.open();try{
      const record=await db.get(id),leaf=AuditChecklist.leafNodes(record)[0].id;
      return [record.states[leaf].status,record.states[leaf].reason,record.states[leaf].reviewer,
        record.events.filter(e=>e.id===leaf&&e.type==='item').map(e=>e.after.status),record.attachments[leaf].length];
    }finally{db.close();}
  },second),['problem','原件缺少第二页','合成复核人',['confirmed','problem'],1]);
  const checklistMenu=page.locator('#audit-checklist-export');
  for(const [mode,operation,count] of [['all','导出全部清单',89],['missing','导出未上传清单',87]]){
    await checklistMenu.locator('summary').click();
    const [download]=await Promise.all([page.waitForEvent('download'),checklistMenu.getByRole('button',{name:operation,exact:true}).click()]);
    const feedback=page.getByRole('dialog',{name:'导出成功'});
    assert.match(await feedback.textContent(),new RegExp('已导出 '+count+' 项'));
    await feedback.getByRole('button',{name:'确定',exact:true}).click();
    assert.equal(download.suggestedFilename(),'合成项目2-'+(mode==='all'?'全部清单':'未上传清单')+'.xlsx');
    const sheet=await page.evaluate(async bytes=>{
      const [sheet]=(await WorkpaperSheets.read(new File([Uint8Array.from(bytes)],'清单.xlsx'))).sheets;
      return {rows:sheet.range.e.r,hasUploaded:Object.values(sheet.cells).some(cell=>cell.v==='合成已上传.txt')};
    },[...fs.readFileSync(await download.path())]);
    assert.deepEqual(sheet,{rows:count,hasUploaded:mode==='all'});
  }
  await attached.locator('[data-material-remove]').click();
  await page.getByRole('dialog',{name:'确认移除'}).getByRole('button',{name:'确认移除'}).click();
  await page.locator('#ac-status').getByText(/已移除当前附件关联/u).waitFor();
  const yellow=await page.locator('.ac-item[data-review-status=pending]').first().evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.equal(new Set([green,red,yellow]).size,3);
  const customChecklist=await page.evaluate(async()=>[...await LedgerStandard.workbook([{name:'自制资料清单',columns:['资料分类','资料名称','说明'],rows:[['往来','函证控制信息表','本期'],['往来','三栏账','本期']]}])]);
  const customDrop=page.getByRole('button',{name:'上传自制清单'});
  await customDrop.evaluate((node,bytes)=>{
    const transfer=new DataTransfer();
    for(const name of ['甲.xlsx','乙.xlsx'])transfer.items.add(new File([Uint8Array.from(bytes)],name));
    node.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
  },customChecklist);
  await customDrop.getByText('此处每次只能上传一份文件。').waitFor();
  await customDrop.evaluate((node,bytes)=>{
    const transfer=new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(bytes)],'自制资料清单.xlsx'));
    node.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
  },customChecklist);
  const preview=page.getByRole('dialog',{name:'上传自制清单'});
  await preview.getByRole('checkbox').check();
  await preview.getByRole('button',{name:'确认替换清单'}).click();
  await preview.waitFor({state:'hidden'});await page.locator('#ac-status').getByText(/已导入 2 项/u).waitFor();
  assert.equal(await page.locator('.ac-item').count(),2);
  await overview.click();
  await project.selectOption(first);
  assert.equal(await currentStep.textContent(),'客户资料');
  await page.evaluate(async ({id,pdf})=>{
    const db=await AuditChecklist.open();
    try{
      const now=new Date().toISOString(),nodeId='n1';
      let record=await db.importTree({quoteId:id,projectName:'合成项目1',firmName:'合成事务所'},
        [{id:nodeId,parentId:'',level:1,title:'上年审计报告',description:'',kind:'material'}],'合成导入人','合成测试清单替换',(await db.get(id))?.revision||0);
      record=await db.attach(id,record.revision,nodeId,new File([Uint8Array.from(pdf)],'合成上年审计报告.pdf',{type:'application/pdf'}),'合成导入人');
      record=await db.change(id,record.revision,{type:'item',id:nodeId,status:'confirmed',evidence:'合成来源核对',reviewer:'合成核对人'});
      const file=record.attachments[nodeId][0],workspace=await ProjectWorkspaceStore.get(id);
      await ProjectWorkspaceStore.save(id,workspace.rev,{reportDraft:{schemaVersion:1,projectId:id,
        source:{nodeId,fileId:file.id,generationId:record.generationId,recordRevision:record.revision,sha256:file.sha256,name:file.name},
        handover:{year:2026,currency:'CNY',unit:'unit',reviewer:'合成核对人',rows:[]},
        content:'合成报告初版正文',generatedAt:now,updatedAt:now}});
    }finally{db.close();}
  },{id:first,pdf});
  const [full]=await Promise.all([page.waitForEvent('download'),finalButton.click()]);
  assert.equal(full.suggestedFilename(),'合成项目1-全套报告.pdf');
  const pages=await page.evaluate(async bytes=>(await PDFLib.PDFDocument.load(Uint8Array.from(bytes))).getPageCount(),[...fs.readFileSync(await full.path())]);
  assert.equal(pages,2);
  const [all]=await Promise.all([page.waitForEvent('download'),allFiles.click()]);
  const paths=await page.evaluate(async bytes=>Object.keys(await ProjectWorkspaceStore.parts(new File([Uint8Array.from(bytes)],'资料.zip'))),[...fs.readFileSync(await all.path())]);
  assert.deepEqual(paths.sort(),['客户资料/合成客户资料.txt','资料清单/合成上年审计报告.pdf'].sort());
  const reportDownload=page.waitForEvent('download');
  await stage('report').getByRole('button',{name:'下载报告初版'}).click();
  const downloadedReport=await reportDownload;
  assert.equal(downloadedReport.suggestedFilename(),'报告初版（待核对）.docx');
  const bytes=[...fs.readFileSync(await downloadedReport.path())];
  assert.match(await page.evaluate(async bytes=>new TextDecoder().decode((await ProjectWorkspaceStore.parts(new File([Uint8Array.from(bytes)],'draft.docx')))['word/document.xml']),bytes),/合成报告初版正文/);
  await currentStep.getByText('报告出具',{exact:true}).waitFor();

  await currentStep.getByRole('button',{name:'报告出具',exact:true}).click();
  await page.waitForFunction(id=>document.querySelector('#report-project')?.value===id,first);
  assert.equal(await page.locator('#report-audit-report').isVisible(),true);
  await overview.click();
  await company.selectOption('合成被审计单位2');
  assert.equal(await exportCard.getByRole('button').first().innerText(),'已编制底稿');
  const archive=Buffer.from(await page.evaluate(()=>Array.from(QuoteLayouts.packOfficeParts({'合成底稿.txt':'本机合成文件'}))));
  await exportCard.locator('input[type=file]').setInputFiles({name:'已编制底稿.zip',mimeType:'application/zip',buffer:archive});
  await flow.getByText('全套底稿上传已保存 1 份资料。',{exact:true}).waitFor();
  const savedPackage=await page.evaluate(async id=>{const file=(await ProjectWorkspaceStore.get(id)).auditWorkflow.files.export[0];return {name:file.name,bytes:[...new Uint8Array(await file.blob.arrayBuffer())]};},second);
  assert.equal(savedPackage.name,'已编制底稿.zip');
  assert.deepEqual(Buffer.from(savedPackage.bytes),archive);
  assert.deepEqual(await exportCard.getByRole('button').allTextContents(),['已编制底稿']);
  await otherRow.locator('td').nth(4).getByRole('button',{name:'全套底稿上传',exact:true}).click();
  assert.equal(await uploadButton.evaluate(e=>e===document.activeElement),true);
  assert.equal(await company.inputValue(),'合成被审计单位2');
  assert.equal(await project.inputValue(),second);
  assert.deepEqual(errors,[]);
});
