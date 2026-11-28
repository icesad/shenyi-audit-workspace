'use strict';
/* Full app project summary and detail navigation. Synthetic records and files only. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const DIST=path.resolve(__dirname,'../dist');
const QA=path.resolve(process.env.PROJECT_NAV_QA_DIR||path.join(__dirname,'../../v58-ui-qa'));
const DOWNLOADS=['下载合同','下载报告','下载原始资料','下载底稿'];
const HEADERS=['序号','项目编号','被审计单位','项目类型','立项状态','风险等级','项目含税金额','是否完结','是否归档','项目经理','确认人',...DOWNLOADS];
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const row=(p,id)=>p.locator('tr[data-project-register-id="'+id+'"]');
const detail=(p,key)=>p.locator('#project-info-'+key);
const nav=(p,name)=>p.locator((name==='ledger'?'#bidding-navigation':'.workspace-navigation')+' [data-view="'+name+'"]');
async function fillProjectDelivery(p){
 for(const [field,value] of Object.entries({siteStart:'2026-12-03',siteEnd:'2026-12-05',reportDate:'2026-12-20',reportCopies:'2',teamMembers:'合成组员',invoice:'合成开票资料'}))
  await detail(p,field).fill(value);
 for(const [field,value] of Object.entries({procurementMethod:'邀请招标',regulated:'否',listed:'否',ipoPlan:'否'}))
  await detail(p,field).selectOption(value);
}
async function assertTable(p,count){
 await p.waitForFunction(n=>document.querySelector('.pi-summary-table')&&document.querySelectorAll('.pi-summary-table [data-project-register-id]').length===n,count);
 assert.deepEqual(await p.locator('.pi-summary-table thead th > span').allTextContents(),HEADERS);
 assert.equal(await p.locator('#project-init-form').count(),0);
 assert.equal(await p.locator('.pi-summary-table tbody [data-project-register-id] input,.pi-summary-table tbody [data-project-register-id] select').count(),0);
}
async function businessState(p,ids){return p.evaluate(async ids=>{
 const result=[];
 for(const id of ids){const x=await ProjectWorkspaceStore.get(id);result.push({id,rev:x.rev,amountCents:x.amountCents,projectRegister:x.projectRegister,projectLifecycle:x.projectLifecycle,projectClassification:x.projectClassification,projectInitiationDetails:x.projectInitiationDetails,auditWorkflow:x.auditWorkflow,projectIdentity:x.projectIdentity,projectInvoice:x.projectInvoice,firm:x.firm,contract:x.contract?{name:x.contract.name,hash:x.contract.hash,actualHash:await ProjectWorkspaceStore.hash(x.contract.blob)}:null,signedContract:x.signedContract?{name:x.signedContract.name,hash:x.signedContract.hash,actualHash:await ProjectWorkspaceStore.hash(x.signedContract.blob)}:null});}
 return result;
},ids);}
async function originalSources(p){return p.evaluate(async()=>{const s=await QuoteLedger.open();try{return{ledger:JSON.stringify(await s.list()),projects:JSON.stringify((await ProjectInitiation.listSaved()).map(x=>({quoteId:x.quoteId,source:x.source,form:x.form})))}}finally{s.close()}});}

test('project summary uses the bid identifier and opens each project’s existing information form',{timeout:120000},async t=>{
 fs.mkdirSync(QA,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:fs.existsSync(EDGE)?EDGE:chromium.executablePath()});
 const context=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1440,height:900}});
 const p=await context.newPage(),errors=[],remote=[],dialogs=[],layouts=[];
 p.on('pageerror',e=>errors.push(e.message));
 p.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});
 p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
 let ids,baseline,sources;
 try{
  await p.goto(pathToFileURL(path.join(DIST,'index.html')).href);
  await p.waitForFunction(()=>globalThis.QuoteLedger&&globalThis.ProjectRegister&&globalThis.ProjectInitiation&&globalThis.ProjectContract&&globalThis.PageDrafts);
  ids=await p.evaluate(async()=>{
   const ledger=await QuoteLedger.open();
   try{
    const pdf=()=>{const a=new Uint8Array(128).fill(32);a.set(new TextEncoder().encode('%PDF-1.4\n% SYNTHETIC ONLY\n'));a.set(new TextEncoder().encode('\n%%EOF\n'),121);return new File([a],'合成证明.pdf',{type:'application/pdf'});};
    const pair=await Promise.all(['business_license','practice_certificate'].map(k=>QuotePacket.readAttachment(pdf(),k)));
    const ids=[];
    for(let i=0;i<4;i++){
     const snapshot={firmName:'合成事务所',customerName:'合成被审计单位'+i,auditYear:2026,location:'广西壮族自治区',service:'年度财务报表审计',quoteDate:'2026-11-12',issuer:'合成委托方'+i,projectName:'合成导航项目'+i,projectType:'年度财务报表审计',contactName:'合成联系人',contactInfo:'synthetic-only',subtotalCents:100000,taxCents:6000,totalCents:106000,taxRateText:'6%'};
     if(i===0)snapshot.quoteRows=['合成被审计子公司甲','合成被审计子公司乙'].map(name=>({name,assets:'',revenue:'',profit:'',period:'',totalCents:53000}));
     if(i===1)snapshot.riskLevel='B类';
     const item=await ledger.register(snapshot,pair);await ledger.appendResult(item.id,{expectedEventNo:0,outcome:i<3?'won':'lost',note:'仅合成导航回归'});if(i<3){ids.push(item.id);await ProjectInitiation.ensureWon((await ledger.get(item.id)).entry);}
    }
    const reg={schemaVersion:1,riskLevel:'A类',manager:'已存甲项目经理',siteTime:'3天',workpaperReportTime:'已存交付时间',preparationTime:'',preparer:'已存编制人',reviewer:'已存复核人',financialStatementDate:'2026-12-31'};
    await ProjectWorkspaceStore.save(ids[0],0,{amountCents:600000,projectRegister:reg,projectLifecycle:{schemaVersion:1,status:'进行中',paymentReceived:'是'},projectClassification:{schemaVersion:1,projectType:'专项审计'},auditWorkflow:{schemaVersion:1,currentStage:'review',completed:'是',archived:'否',confirmedBy:'合成确认人',files:{}}});
    const cleared=Object.fromEntries(Object.keys(ProjectWorkspaceStore.INITIATION_FIELDS).map(key=>[key,'']));
    await ProjectWorkspaceStore.save(ids[2],0,{amountCents:null,
      projectInitiationDetails:{...cleared,schemaVersion:1,companyName:'合成被审计单位2'}});
    const source=(await ProjectInitiation.listSaved()).find(x=>x.quoteId===ids[0]).source,E=new TextEncoder(),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const parts={'[Content_Types].xml':E.encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),'word/document.xml':E.encode('<w:document xmlns:w="'+ns+'"><w:body><w:p><w:r><w:t>合成合同原件；责任与条款不得因页面导航而修改。</w:t></w:r></w:p></w:body></w:document>')};
    let workspace=await ProjectWorkspaceStore.get(ids[0]);await ProjectContract.uploadTemplate(source,new File([QuoteLayouts.packOfficeParts(parts)],'合成已存合同.docx',{type:QuoteLayouts.docxMime}),{expectedRevision:workspace.rev});
    workspace=await ProjectWorkspaceStore.get(ids[0]);await ProjectContract.uploadSigned(source,pdf(),{expectedRevision:workspace.rev});
    return ids;
   }finally{ledger.close()}
  });
  await p.locator('[data-home-view=project]').click();
  assert.equal(await p.locator('#bidding-navigation').isVisible(),false);
  await p.locator('#bidding-navigation [data-view=proposal]').evaluate(button=>button.click());
  await p.locator('#quote-intake-review > summary').click();
  await p.locator('#client-form [name=clientName]').fill('无关报价草稿不得被项目导航改变');

  await t.test('the summary shows the requested columns, verified prices, and separate manager and confirmer',async()=>{
   await nav(p,'project').click();await assertTable(p,3);
   assert.equal(await p.locator('.pi-summary-table tbody a').count(),3);
   assert.match(await row(p,ids[0]).locator('td').nth(1).textContent(),/^ZXSJ-\d{4}-A-\d{4}$/);
   assert.match(await row(p,ids[1]).locator('td').nth(1).textContent(),/^CWBB-\d{4}-B-\d{4}$/);
   assert.equal(await row(p,ids[2]).locator('td').nth(1).textContent(),'待补齐：风险等级');
   assert.equal(await row(p,ids[1]).locator('td[data-project-column=type]').textContent(),'财务报表审计');
   assert.deepEqual((await row(p,ids[0]).locator('td').allTextContents()).slice(2),
    ['合成被审计子公司甲、合成被审计子公司乙','专项审计','立项中','A类','¥ 6,000.00','是','否','已存甲项目经理','合成确认人',...DOWNLOADS]);
   assert.deepEqual((await row(p,ids[1]).locator('td').allTextContents()).slice(5),['B类','¥ 1,060.00','—','—','—','—',...DOWNLOADS]);
   assert.equal(await row(p,ids[1]).locator('td[data-project-column=amountCents]').getAttribute('title'),'来源：已中标报价金额（待核对）');
   assert.equal(await row(p,ids[2]).locator('td[data-project-column=amountCents]').textContent(),'—');
   assert.equal(await p.locator('.pi-summary-tools').count(),0);
   const clear=p.locator('.page-draft-toolbar').getByRole('button',{name:'清空筛选',exact:true});
   await clear.waitFor();
   assert.equal(await clear.isDisabled(),true);
   assert.equal(await p.locator('#page-save-status').isVisible(),false);
   await p.locator('#page-save').click();
   const feedback=p.getByRole('dialog',{name:'保存失败'});
   await feedback.waitFor();
   assert.match(await feedback.textContent(),/请打开已立项项目/);
   assert.equal(await p.locator('#page-save-status').isVisible(),false);
   await feedback.getByRole('button',{name:'确定',exact:true}).click();
   assert.ok(await clear.evaluate(button=>{
    const create=button.nextElementSibling,save=create.nextElementSibling;
    return create.id==='project-summary-new'&&save.id==='page-save'&&Math.abs(button.getBoundingClientRect().top-save.getBoundingClientRect().top)<2;
   }));
   const summary=p.locator('.pi-summary-table');
   assert.equal(await summary.locator('thead select').count(),0);
   assert.equal(await summary.locator('thead .estimate-filter-trigger').count(),9);
   async function pickFilter(column,value){
    const label='筛选'+column,trigger=summary.getByRole('button',{name:label,exact:true});
    await trigger.click();
    await p.getByRole('dialog',{name:label}).getByRole('button',{name:value,exact:true}).click();
    assert.equal(await trigger.getAttribute('aria-expanded'),'false');
   }
   await pickFilter('风险等级','B类');await assertTable(p,1);
   assert.equal(await row(p,ids[1]).isVisible(),true);
   await clear.click();await assertTable(p,3);
   await pickFilter('项目含税金额','¥ 6,000.00');await assertTable(p,1);
   assert.equal(await row(p,ids[0]).isVisible(),true);
   await pickFilter('项目经理','已存甲项目经理');await assertTable(p,1);
   await pickFilter('确认人','合成确认人');await assertTable(p,1);
   await clear.click();await assertTable(p,3);
   assert.equal(await clear.isDisabled(),true);
   baseline=await businessState(p,ids);sources=await originalSources(p);
   assert.ok(baseline[0].contract&&baseline[0].signedContract);
   assert.equal(baseline[0].contract.hash,baseline[0].contract.actualHash);
   assert.equal(baseline[0].signedContract.hash,baseline[0].signedContract.actualHash);
  });

  await t.test('both the identifier and the history action open the correct project; previous tools are available on the detail',async()=>{
   await row(p,ids[1]).getByRole('link').click();
   await detail(p,'companyName').waitFor();
   assert.equal(await p.locator('#project-summary-clear').isVisible(),false);
   assert.equal(await p.locator('#project-summary-export').isVisible(),false);
   assert.equal(await p.locator('#project-init-form').getAttribute('data-activity-project-id'),ids[1]);
   assert.equal(await detail(p,'companyName').inputValue(),'合成被审计单位1');
   assert.equal(await detail(p,'engagementFirm').inputValue(),'合成事务所');
   await p.getByRole('button',{name:'返回项目汇总表'}).click();await assertTable(p,3);
   await nav(p,'ledger').evaluate(button=>button.click());await p.locator('[data-initiation-id="'+ids[0]+'"]').click();
   await detail(p,'manager').waitFor();assert.equal(await detail(p,'manager').inputValue(),'已存甲项目经理');
   assert.equal(await detail(p,'reviewer').inputValue(),'已存复核人');
   assert.equal(await detail(p,'amount').inputValue(),'1060.00');
   assert.equal(await detail(p,'amount').isEditable(),false);
   assert.equal(await detail(p,'taxRate').inputValue(),'6');
   assert.equal(await detail(p,'taxRate').isDisabled(),true);
   await p.getByRole('button',{name:'登记与附件',exact:true}).click();
   await row(p,ids[0]).locator('[data-project-template-download]:enabled').waitFor();
   assert.equal(await p.locator('.pr-table tbody tr').count(),1);
   await p.getByRole('button',{name:'返回立项信息表'}).click();await detail(p,'manager').waitFor();
   await p.getByRole('button',{name:'返回报价历史'}).click();
   await nav(p,'project').click();await assertTable(p,3);
   assert.deepEqual(await businessState(p,ids),baseline);
   assert.deepEqual(await originalSources(p),sources);
  });

  await t.test('edits remain scoped to one project and its summary reflects a saved change',async()=>{
   await row(p,ids[0]).getByRole('link').click();
   await detail(p,'manager').fill('暂存经理-不应丢失');
   await detail(p,'mailingAddress').fill('合成更正邮寄地址');
   await p.getByRole('button',{name:'返回项目汇总表'}).click();
   assert.equal(await p.locator('#page-title').textContent(),'立项信息表');
   assert.equal(await detail(p,'manager').inputValue(),'暂存经理-不应丢失');
   assert.equal(dialogs.length,1);
   assert.equal(await p.locator('#page-save').isVisible(),false);
   await detail(p,'draft').click();
   await p.getByRole('dialog',{name:'暂存成功'}).getByRole('button',{name:'确定',exact:true}).click();
   assert.deepEqual(await businessState(p,ids),baseline);
   await p.reload();await p.locator('[data-home-view=project]').click();await assertTable(p,3);
   await row(p,ids[0]).getByRole('link').click();
   await p.waitForFunction(()=>document.querySelector('#project-info-manager')?.value==='暂存经理-不应丢失');
   assert.deepEqual(await businessState(p,ids),baseline);
   assert.equal(await detail(p,'amount').isEditable(),false);
   await detail(p,'engagementOwner').fill('合成承接人');
   await detail(p,'reviewer').fill('合成项目复核人');
   await fillProjectDelivery(p);
   await detail(p,'save').click();
   await p.locator('#project-init-status').getByText('立项信息已保存。',{exact:true}).waitFor();
   await p.getByRole('dialog',{name:'保存成功'}).getByRole('button',{name:'确定',exact:true}).click();
   await p.getByRole('button',{name:'返回项目汇总表'}).click();await assertTable(p,3);
   const changed=row(p,ids[0]);
   assert.equal(await changed.locator('td[data-project-column=company]').textContent(),'合成被审计子公司甲、合成被审计子公司乙');
   assert.equal(await changed.locator('td[data-project-column=amountCents]').textContent(),'¥ 1,060.00');
   assert.equal(await changed.locator('td[data-project-column=manager]').textContent(),'暂存经理-不应丢失');
   assert.equal(await changed.locator('td[data-project-column=confirmedBy]').textContent(),'合成确认人');
   const [updated]=await businessState(p,ids);
   assert.equal(updated.projectInitiationDetails.engagementFirm,'合成事务所');
   assert.equal(updated.projectInitiationDetails.engagementOwner,'合成承接人');
   assert.equal(updated.projectInitiationDetails.mailingAddress,'合成更正邮寄地址');
   assert.equal(updated.projectRegister.reviewer,'合成项目复核人');
   assert.deepEqual((await businessState(p,ids)).slice(1),baseline.slice(1));
   assert.deepEqual(await originalSources(p),sources);
   baseline=await businessState(p,ids);
  });

  await t.test('legacy single-project draft is refused in register mode and remains in local temporary storage',async()=>{
   const result=await p.evaluate(async id=>{
    const host=document.createElement('div'),ledger=await QuoteLedger.open();
    const probe=ProjectInitiation.mount(host,{lookup:async x=>(await ledger.get(x)).entry,listWon:()=>ledger.list()});
    const d=PageDrafts.create(),scope={kind:'project-initiation',projectId:id},values={schemaVersion:1,editor:{revision:1,source:'legacy-synthetic',fields:{projectName:'旧单卡暂存',initiationDate:'2026-11-12',manager:'旧单卡经理',notes:'不得自动迁移至22列表'}}};
    d.registerAdapter('project',{capture:()=>({scope,values}),restore:(v,m)=>probe.restorePending(v,m)});
    try{await d.checkpoint('project');let reason='';try{await d.restore('project',{scope})}catch(e){reason=e.message}const remains=(await d.list('project')).some(x=>x.scope.kind===scope.kind&&x.scope.projectId===id);return{reason,remains,legacyForm:!!host.querySelector('#project-init-form')};}finally{d.close();ledger.close()}
   },ids[0]);
   for(const term of ['旧单项目','仍保留','未跨格式覆盖','项目登记表'])assert.ok(result.reason.includes(term),result.reason);assert.equal(result.remains,true);assert.equal(result.legacyForm,false);
   await assertTable(p,3);assert.deepEqual(await businessState(p,ids),baseline);
  });

  await t.test('desktop and narrow screen use local horizontal table scrolling without global overflow',async()=>{
   for(const [width,height]of [[1440,900],[390,844]]){
    await p.setViewportSize({width,height});
    const layout=await p.evaluate(()=>{const x=document.querySelector('#project-initiation .pi-summary-scroll');return{viewport:document.documentElement.clientWidth,page:document.documentElement.scrollWidth,wrapper:x.clientWidth,table:x.scrollWidth,columns:document.querySelectorAll('#project-initiation .pi-summary-table thead th').length}});
    assert.ok(layout.page<=layout.viewport+1,JSON.stringify(layout));if(width===390)assert.ok(layout.table>layout.wrapper,JSON.stringify(layout));assert.equal(layout.columns,HEADERS.length);layouts.push({width,...layout});
    await p.locator('#project-initiation .pi-summary-scroll').evaluate(e=>e.scrollLeft=0);await p.screenshot({path:path.join(QA,'project-register-navigation-'+width+'.png'),fullPage:true});
    const scroll=await p.locator('#project-initiation .pi-summary-scroll').evaluate(e=>{e.scrollLeft=e.scrollWidth;return e.scrollLeft});if(width===390)assert.ok(scroll>0);
   }
   assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);assert.equal(dialogs.length,1);
  });
 }finally{
  fs.writeFileSync(path.join(QA,'project-register-navigation-report.json'),JSON.stringify({syntheticOnly:true,headers:HEADERS,ids,layouts,pageErrors:errors,httpRequests:remote,dialogs},null,2));
  await context.close();await browser.close();
 }
});

test('empty project summary refreshes after the first award through the history dropdown',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true,executablePath:fs.existsSync(EDGE)?EDGE:chromium.executablePath()}),context=await browser.newContext({offline:true,viewport:{width:1440,height:900}}),p=await context.newPage(),errors=[],dialogs=[];
 p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(pathToFileURL(path.join(DIST,'index.html')).href);
  await p.locator('[data-home-view=project]').click();await assertTable(p,0);
  await nav(p,'quote').click();await p.locator('#brand-home').click();await p.locator('[data-home-view=project]').click();await assertTable(p,0);
  const id=await p.evaluate(async()=>{
   const ledger=await QuoteLedger.open();try{
    const pdf=()=>{const a=new Uint8Array(128).fill(32);a.set(new TextEncoder().encode('%PDF-1.4\n% SYNTHETIC ONLY\n'));a.set(new TextEncoder().encode('\n%%EOF\n'),121);return new File([a],'合成证明.pdf',{type:'application/pdf'});};
    const pair=await Promise.all(['business_license','practice_certificate'].map(k=>QuotePacket.readAttachment(pdf(),k)));
    const item=await ledger.register({firmName:'合成事务所',customerName:'合成首中标被审计方',auditYear:2026,location:'广西壮族自治区',service:'年度财务报表审计',quoteDate:'2026-11-12',issuer:'合成首中标委托方',projectName:'空表之后首个中标项目',projectType:'年度财务报表审计',contactName:'合成联系人',contactInfo:'synthetic-only',subtotalCents:100000,taxCents:6000,totalCents:106000,taxRateText:'6%'},pair);
    if((await ledger.get(item.id)).entry.events.length!==0||(await ProjectInitiation.listSaved()).length!==0)throw Error('fixture must remain pending with no project');
    return item.id;
   }finally{ledger.close()}
  });
  await nav(p,'ledger').evaluate(button=>button.click());await p.locator('[data-result-select="'+id+'"]').waitFor();
  p.once('dialog',async d=>{dialogs.push(d.message());await d.accept();});
  await p.locator('[data-result-select="'+id+'"]').selectOption('won');
  await p.locator('[data-initiation-id="'+id+'"]').waitFor();
  await p.waitForFunction(async id=>(await ProjectInitiation.listSaved()).some(x=>x.quoteId===id),id);
  assert.equal(dialogs.length,1);assert.match(dialogs[0],/登记为.*中标/);
  // Use the main project navigation, not the history row's open button: this catches a stale empty-table guard.
  await nav(p,'project').click();await assertTable(p,1);
  assert.equal(await row(p,id).count(),1);
  assert.equal(await row(p,id).getByRole('link').count(),1);
  assert.equal(await row(p,id).locator('td[data-project-column=company]').textContent(),'合成首中标被审计方');
  const event=await p.evaluate(async id=>{const db=await QuoteLedger.open();try{return(await db.get(id)).entry.events.at(-1)}finally{db.close()}},id);
  assert.equal(event.outcome,'won');assert.equal(event.note,'通过下拉选项登记结果');
  fs.mkdirSync(QA,{recursive:true});await p.screenshot({path:path.join(QA,'project-register-first-award.png'),fullPage:true});
  assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close()}
});

test('project summary scrolls inside the table and keeps the filtered total across page changes',async t=>{
 const executablePath=fs.existsSync(EDGE)?EDGE:chromium.executablePath();
 if(!fs.existsSync(executablePath))return t.skip('Existing Chromium unavailable');
 const browser=await chromium.launch({headless:true,executablePath});
 t.after(()=>browser.close());
 const p=await browser.newPage({viewport:{width:1280,height:650}});
 await p.goto(pathToFileURL(path.join(DIST,'index.html')).href);
 await p.evaluate(async()=>{
  const now=new Date().toISOString();
  for(let i=1;i<=22;i++){
   const id=crypto.randomUUID(),totalCents=i*100+1;
   await ProjectInitiation.ensureWon({id,lastEventNo:1,events:[{eventNo:1,outcome:'won',recordedAt:now}],
    snapshot:{projectName:'合成分页项目'+i,issuer:'合成发标方',customerName:'合成分页公司'+i,
     firmName:'合成事务所',auditYear:2026,quoteDate:'2026-11-27',totalCents,projectType:'年度财务报表审计'}});
   await ProjectWorkspaceStore.save(id,0,{amountCents:totalCents});
  }
 });
 await p.locator('[data-home-view=project]').click();
 await assertTable(p,22);
 const table=p.locator('.pi-summary-table'),footer=table.locator('tfoot');
 const pager=p.getByRole('navigation',{name:'项目汇总表分页'});
 const exportButton=p.getByRole('button',{name:'导出',exact:true});
 assert.equal(await exportButton.evaluate(button=>button.previousElementSibling.id),'page-save');
 async function downloadSummary(){
  const [download]=await Promise.all([p.waitForEvent('download'),exportButton.click()]);
  const feedback=p.getByRole('dialog',{name:'导出成功'});
  await feedback.waitFor();
  assert.match(await feedback.textContent(),/已导出 \d+ 条项目记录/);
  await feedback.getByRole('button',{name:'确定',exact:true}).click();
  assert.equal(download.suggestedFilename(),'项目汇总表.xlsx');
  return p.evaluate(async bytes=>{
   const file=new File([Uint8Array.from(bytes)],'项目汇总表.xlsx');
   const [sheet]= (await WorkpaperSheets.read(file)).sheets;
   return {name:sheet.name,range:sheet.range,values:Object.fromEntries(Object.entries(sheet.cells).map(([address,cell])=>[address,cell.v]))};
  },[...fs.readFileSync(await download.path())]);
 }
 const located=()=>table.locator('tbody tr[data-project-register-id]:visible').count();
 assert.equal(await located(),10);
 assert.match(await footer.innerText(),/合计.*22 条.*¥ 253\.22/s);
 assert.ok(await p.locator('.pi-summary-scroll').evaluate(el=>el.scrollHeight>el.clientHeight&&getComputedStyle(el).overflowY==='auto'));
 await pager.getByRole('button',{name:'第 2 页'}).click();
 assert.equal(await located(),10);
 const size=pager.getByRole('combobox',{name:'每页显示条数'});
 assert.equal(await size.inputValue(),'10');
 assert.deepEqual(await size.locator('option').evaluateAll(options=>options.map(o=>o.value)),['10','15','20']);
 await size.selectOption('15');
 assert.equal(await located(),15);
 assert.equal(await pager.getByRole('button',{name:'第 1 页'}).getAttribute('aria-current'),'page');
 await pager.getByRole('button',{name:'下一页'}).click();
 assert.equal(await located(),7);
 await size.selectOption('20');
 assert.equal(await located(),20);
 await pager.getByRole('button',{name:'下一页'}).click();
 assert.equal(await located(),2);
 assert.match(await footer.innerText(),/¥ 253\.22/);
 const all=await downloadSummary();
 assert.equal(all.name,'项目汇总表');
 assert.equal(all.range.e.r,23);
 assert.equal(all.values.F1,'风险等级');
 assert.equal(all.values.G1,'项目含税金额');
 assert.equal(all.values.G24,253.22);
 assert.equal(all.values.A24,'合计（22 条）');
 const company=table.getByRole('button',{name:'筛选被审计单位'});
 await company.click();
 await p.getByRole('dialog',{name:'筛选被审计单位'}).getByRole('button',{name:'合成分页公司12',exact:true}).click();
 assert.equal(await located(),1);
 assert.match(await footer.innerText(),/合计.*1 条.*¥ 12\.01/s);
 const filtered=await downloadSummary();
 assert.equal(filtered.range.e.r,2);
 assert.equal(filtered.values.C2,'合成分页公司12');
 assert.equal(filtered.values.D2,'财务报表审计');
 assert.equal(filtered.values.G2,12.01);
 assert.equal(filtered.values.G3,12.01);
 assert.equal(await pager.getByRole('button',{name:'第 1 页'}).getAttribute('aria-current'),'page');
 assert.equal(await pager.getByRole('button',{name:'下一页'}).isDisabled(),true);
 await p.getByRole('button',{name:'清空筛选',exact:true}).click();
 assert.equal(await size.inputValue(),'20');
 assert.equal(await located(),20);
 assert.match(await footer.innerText(),/¥ 253\.22/);
});

test('manual project opens an editable initiation form and receives a code without creating an award',async t=>{
 const executablePath=fs.existsSync(EDGE)?EDGE:chromium.executablePath();
 if(!fs.existsSync(executablePath))return t.skip('Existing Chromium unavailable');
 const browser=await chromium.launch({headless:true,executablePath});
 t.after(()=>browser.close());
 const p=await browser.newPage();
 await p.goto(pathToFileURL(path.join(DIST,'index.html')).href);
 await p.locator('[data-home-view=project]').click();
 await assertTable(p,0);
 await p.locator('#project-summary-export').click();
 const failure=p.getByRole('dialog',{name:'导出失败'});
 assert.match(await failure.textContent(),/没有可导出的项目/);
 await failure.getByRole('button',{name:'确定',exact:true}).click();
 await p.getByRole('button',{name:'新增项目',exact:true}).click();
 const create=p.getByRole('dialog',{name:'新增项目'});
 await create.getByLabel('被审计单位',{exact:true}).fill('合成手工新增单位');
 await create.getByLabel('项目名称',{exact:true}).fill('合成手工立项');
 await create.getByRole('button',{name:'新增并填写立项信息'}).click();
 await detail(p,'companyName').waitFor();
 assert.equal(await detail(p,'companyName').inputValue(),'合成手工新增单位');
 assert.ok(await detail(p,'companyName').isEditable());
 assert.ok(await detail(p,'engagementFirm').isEditable());
 await detail(p,'engagementFirm').fill('合成事务所');
 await detail(p,'projectType').selectOption({label:'财务报表审计'});
 await detail(p,'riskLevel').selectOption('C类');
 await detail(p,'amount').fill('1250.01');
 const taxRate=detail(p,'taxRate');
 assert.deepEqual(await taxRate.locator('option:enabled').allTextContents(),['1%','3%','6%']);
 await taxRate.selectOption({label:'3%'});
 const manualId=await p.locator('#project-init-form').getAttribute('data-activity-project-id');
 const pdf=await p.evaluate(async()=>{const pdf=await PDFLib.PDFDocument.create();pdf.addPage();return [...await pdf.save()];});
 await detail(p,'contract').setInputFiles({name:'合成暂存合同.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf)});
 assert.equal(await detail(p,'save').isDisabled(),true);
 assert.match(await detail(p,'required').textContent(),/公司联系人/);
 await detail(p,'draft').click();
 await p.getByRole('dialog',{name:'暂存成功'}).getByRole('button',{name:'确定',exact:true}).click();
 const [draftState]=await businessState(p,[manualId]);
 assert.equal(draftState.projectInitiationDetails,undefined);
 assert.equal(draftState.signedContract,null);
 await p.reload();await p.locator('[data-home-view=project]').click();await assertTable(p,1);
 await row(p,manualId).getByRole('link').click();
 await p.getByText('合成暂存合同.pdf',{exact:true}).waitFor();
 assert.equal(await taxRate.inputValue(),'3');
 assert.equal(await detail(p,'save').isDisabled(),true);
 for(const [field,value] of Object.entries({contactName:'合成联系人',contactInfo:'synthetic-only',engagementOwner:'合成承接人',reviewer:'合成复核人',
  manager:'合成项目经理',mailingAddress:'合成邮寄地址'}))await detail(p,field).fill(value);
 await fillProjectDelivery(p);
 assert.equal(await detail(p,'save').isEnabled(),true);
 await detail(p,'save').click();
 await p.getByRole('dialog',{name:'保存成功'}).getByRole('button',{name:'确定',exact:true}).click();
 await p.getByRole('button',{name:'返回项目汇总表'}).click();
 await assertTable(p,1);
 const saved=await p.evaluate(async()=>{
  const [item]=await ProjectInitiation.listSaved(),ledger=await QuoteLedger.open();
  try{return {item,ledgerCount:(await ledger.list()).length};}finally{ledger.close();}
 });
 assert.equal(saved.ledgerCount,0);
 assert.equal(saved.item.source.origin,'manual');
 assert.equal(saved.item.source.wonAt,null);
 assert.match(await row(p,saved.item.quoteId).getByRole('link').textContent(),/^CWBB-\d{4}-C-\d{4}$/);
 assert.equal(await row(p,saved.item.quoteId).locator('[data-project-column=amountCents]').textContent(),'¥ 1,250.01');
 const id=saved.item.quoteId;
 const [complete]=await businessState(p,[id]);
 assert.equal(complete.projectInitiationDetails.taxRate,'3');
 assert.equal(complete.signedContract.name,'合成暂存合同.pdf');
 assert.deepEqual(await p.evaluate(async()=>{const draft=PageDrafts.create();try{return await draft.list('project');}finally{draft.close();}}),[]);
 await p.evaluate(async id=>{
  const project=await ProjectWorkspaceStore.get(id);
  await ProjectWorkspaceStore.save(id,project.rev,{projectInitiationDetails:{...project.projectInitiationDetails,taxRate:'5'}});
 },id);
 await row(p,id).getByRole('link').click();
 await taxRate.waitFor();
 assert.equal(await taxRate.inputValue(),'5');
 assert.equal(await taxRate.locator('option:checked').textContent(),'5%');
 assert.deepEqual(await taxRate.locator('option:enabled').allTextContents(),['1%','3%','6%']);
 await detail(p,'manager').fill('合成税率回归经理');
 await detail(p,'save').click();
 await p.getByRole('dialog',{name:'保存成功'}).getByRole('button',{name:'确定',exact:true}).click();
 assert.equal((await businessState(p,[id]))[0].projectInitiationDetails.taxRate,'5');
 await taxRate.selectOption('1');
 await detail(p,'save').click();
 await p.getByRole('dialog',{name:'保存成功'}).getByRole('button',{name:'确定',exact:true}).click();
 assert.equal((await businessState(p,[id]))[0].projectInitiationDetails.taxRate,'1');
});

test('project summary downloads exactly the saved documents from the selected row',async t=>{
 const executablePath=fs.existsSync(EDGE)?EDGE:chromium.executablePath();
 if(!fs.existsSync(executablePath))return t.skip('Existing Chromium unavailable');
 const browser=await chromium.launch({headless:true,executablePath});
 t.after(()=>browser.close());
 const p=await browser.newPage({acceptDownloads:true,viewport:{width:1280,height:780}});
 const errors=[];p.on('pageerror',error=>errors.push(error.message));
 await p.goto(pathToFileURL(path.join(DIST,'index.html')).href);
 const seeded=await p.evaluate(async()=>{
  const S=ProjectWorkspaceStore,A=AuditChecklist,now=new Date().toISOString();
  const ids=[crypto.randomUUID(),crypto.randomUUID()];
  for(const [i,id] of ids.entries()){
   await ProjectInitiation.ensureWon({id,lastEventNo:1,events:[{eventNo:1,outcome:'won',recordedAt:now}],
    snapshot:{projectName:'合成下载项目'+i,issuer:'合成发标方',customerName:'合成下载公司'+i,
     firmName:'合成事务所',auditYear:2026,quoteDate:'2026-11-27',totalCents:50000,projectType:'年度财务报表审计'}});
  }
  async function pdf(name,title){
   const doc=await PDFLib.PDFDocument.create();
   doc.setTitle(title);doc.addPage();
   return new File([await doc.save()],name,{type:'application/pdf'});
  }
  const doc=await pdf('甲合同盖章版.pdf','synthetic signed contract A');
  const prior=await pdf('甲上年报告.pdf','synthetic prior report A');
  const other=await pdf('乙项目报告.pdf','synthetic saved report B');
  const workpaperBytes=QuoteLayouts.packOfficeParts({'本年底稿.txt':'甲项目已编制底稿'});
  const workpaper=await A.prepareFile(new File([workpaperBytes],'甲已编制底稿.zip',{type:'application/zip'}));
  const loose=new File(['甲流程上传原文'],'客户账页.txt',{type:'text/plain'});
  const checklistFile=new File(['甲资料清单附件原文'],'客户账页.txt',{type:'text/plain'});
  const db=await A.open();
  try{
   let record=await db.importTree({quoteId:ids[0],projectName:'合成下载项目0',firmName:'合成事务所'},
    [{id:'n1',parentId:'',level:1,title:'上年审计报告',description:'',kind:'material'},
     {id:'n2',parentId:'',level:1,title:'其他原始资料',description:'',kind:'material'}],'合成上传人');
   record=await db.attach(ids[0],record.revision,'n1',prior,'合成上传人');
   record=await db.attach(ids[0],record.revision,'n2',checklistFile,'合成上传人');
   record=await db.change(ids[0],record.revision,{type:'item',id:'n1',status:'confirmed',evidence:'合成来源核对',reviewer:'合成核对人'});
   const source=record.attachments.n1[0];
   await S.save(ids[0],0,{
    signedContract:{name:doc.name,hash:await S.hash(doc),blob:doc},
    reportDraft:{schemaVersion:1,projectId:ids[0],source:{nodeId:'n1',fileId:source.id,generationId:record.generationId,
     recordRevision:record.revision,sha256:source.sha256,name:source.name},handover:{year:2026,currency:'CNY',unit:'unit',reviewer:'合成核对人',rows:[]},
     content:'甲项目合成审计报告正文',generatedAt:now,updatedAt:now},
    auditWorkflow:{schemaVersion:1,currentStage:'export',completed:'',archived:'',confirmedBy:'',files:{client:[await A.prepareFile(loose)],export:[workpaper]}}
   });
   await S.save(ids[1],0,{auditWorkflow:{schemaVersion:1,currentStage:'report',completed:'',archived:'',confirmedBy:'',
    files:{report:[await A.prepareFile(other)]}}});
   return {ids,signed:[...new Uint8Array(await doc.arrayBuffer())],workpaper:[...workpaperBytes],other:[...new Uint8Array(await other.arrayBuffer())]};
  }finally{db.close();}
 });
 await p.locator('[data-home-view=project]').click();
 await assertTable(p,2);
 const [first,second]=seeded.ids.map(id=>row(p,id));
 assert.deepEqual(await first.getByRole('button').allTextContents(),DOWNLOADS);
 assert.deepEqual(await second.getByRole('button').allTextContents(),DOWNLOADS);
 const download=async (project,label)=>{
  const [event]=await Promise.all([p.waitForEvent('download'),project.getByRole('button',{name:label,exact:true}).click()]);
  return {name:event.suggestedFilename(),bytes:fs.readFileSync(await event.path())};
 };
 const contract=await download(first,'下载合同');
 assert.equal(contract.name,'甲合同盖章版.pdf');
 assert.deepEqual(contract.bytes,Buffer.from(seeded.signed));
 const report=await download(first,'下载报告');
 assert.equal(report.name,'报告初版（待核对）.docx');
 const reportXml=await p.evaluate(async bytes=>new TextDecoder().decode((await ProjectWorkspaceStore.parts(
  new File([Uint8Array.from(bytes)],'report.docx')))['word/document.xml']),[...report.bytes]);
 assert.match(reportXml,/甲项目合成审计报告正文/);
 const otherReport=await download(second,'下载报告');
 assert.equal(otherReport.name,'乙项目报告.pdf');
 assert.deepEqual(otherReport.bytes,Buffer.from(seeded.other));
 const materials=await download(first,'下载原始资料');
 assert.equal(materials.name,'原始资料.zip');
 const contents=await p.evaluate(async bytes=>{
  const archive=await BidderArchive.open(new File([Uint8Array.from(bytes)],'materials.zip'));
  try{
   const files=await archive.read(archive.entries.map(entry=>entry.name)),decoder=new TextDecoder();
   return Object.fromEntries([...files].map(([name,data])=>[name,decoder.decode(data)]));
  }finally{archive.close();}
 },[...materials.bytes]);
 assert.deepEqual(Object.keys(contents).sort(),['客户资料/客户账页.txt','资料清单/客户账页.txt','资料清单/甲上年报告.pdf'].sort());
 assert.equal(contents['客户资料/客户账页.txt'],'甲流程上传原文');
 assert.equal(contents['资料清单/客户账页.txt'],'甲资料清单附件原文');
 const workpapers=await download(first,'下载底稿');
 assert.equal(workpapers.name,'甲已编制底稿.zip');
 assert.deepEqual(workpapers.bytes,Buffer.from(seeded.workpaper));
 await second.getByRole('button',{name:'下载合同',exact:true}).click();
 await p.locator('#project-init-status').getByText('本项目尚未上传合同盖章版。',{exact:true}).waitFor();
 await second.getByRole('button',{name:'下载原始资料',exact:true}).click();
 await p.locator('#project-init-status').getByText('本项目尚未保存原始资料。',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
});
