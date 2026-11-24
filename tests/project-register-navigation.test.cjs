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
const HEADERS=['序号','项目编号','立项状态','被审计单位','项目类型','当前步骤','是否完结','是否归档','确认人'];
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const row=(p,id)=>p.locator('tr[data-project-register-id="'+id+'"]');
const detail=(p,key)=>p.locator('#project-info-'+key);
const nav=(p,name)=>p.locator((name==='ledger'?'#bidding-navigation':'.workspace-navigation')+' [data-view="'+name+'"]');
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
 p.on('dialog',async d=>{dialogs.push(d.message());if(d.message()==='确认保存立项信息？')await d.accept();else await d.dismiss();});
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
     const item=await ledger.register(snapshot,pair);await ledger.appendResult(item.id,{expectedEventNo:0,outcome:i<3?'won':'lost',note:'仅合成导航回归'});if(i<3){ids.push(item.id);await ProjectInitiation.ensureWon((await ledger.get(item.id)).entry);}
    }
    const reg={schemaVersion:1,riskLevel:'A类',manager:'已存甲项目经理',siteTime:'3天',workpaperReportTime:'已存交付时间',preparationTime:'',preparer:'已存编制人',reviewer:'已存复核人',financialStatementDate:'2026-12-31'};
    await ProjectWorkspaceStore.save(ids[0],0,{amountCents:600000,projectRegister:reg,projectLifecycle:{schemaVersion:1,status:'进行中',paymentReceived:'是'},projectClassification:{schemaVersion:1,projectType:'专项审计'},auditWorkflow:{schemaVersion:1,currentStage:'review',completed:'是',archived:'否',confirmedBy:'合成确认人',files:{}}});
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

  await t.test('the summary uses exactly nine columns and one row per project, including multi-unit quotes',async()=>{
   await nav(p,'project').click();await assertTable(p,3);
   assert.equal(await p.locator('.pi-summary-table tbody a').count(),3);
   for(const id of ids)assert.equal(await row(p,id).locator('td').nth(1).textContent(),id);
   assert.deepEqual((await row(p,ids[0]).locator('td').allTextContents()).slice(2),
    ['立项中','合成被审计子公司甲、合成被审计子公司乙','专项审计','项目复核','是','否','已存甲项目经理']);
   assert.deepEqual((await row(p,ids[1]).locator('td').allTextContents()).slice(5),['—','—','—','—']);
   assert.equal(await p.locator('.pi-summary-tools').count(),0);
   const clear=p.locator('.page-draft-toolbar').getByRole('button',{name:'清空筛选',exact:true});
   await clear.waitFor();
   assert.equal(await clear.isDisabled(),true);
   assert.ok(await clear.evaluate(button=>{
    const save=button.nextElementSibling;
    return save.id==='page-save'&&Math.abs(button.getBoundingClientRect().top-save.getBoundingClientRect().top)<2;
   }));
   const summary=p.locator('.pi-summary-table');
   assert.equal(await summary.locator('thead select').count(),0);
   assert.equal(await summary.locator('thead .estimate-filter-trigger').count(),7);
   async function pickFilter(column,value){
    const label='筛选'+column,trigger=summary.getByRole('button',{name:label,exact:true});
    await trigger.click();
    await p.getByRole('dialog',{name:label}).getByRole('button',{name:value,exact:true}).click();
    assert.equal(await trigger.getAttribute('aria-expanded'),'false');
   }
   await pickFilter('当前步骤','项目复核');await assertTable(p,1);
   assert.equal(await row(p,ids[0]).isVisible(),true);
   await pickFilter('确认人','已存甲项目经理');await assertTable(p,1);
   await clear.click();await assertTable(p,3);
   assert.equal(await clear.isDisabled(),true);
   baseline=await businessState(p,ids);sources=await originalSources(p);
   assert.ok(baseline[0].contract&&baseline[0].signedContract);
   assert.equal(baseline[0].contract.hash,baseline[0].contract.actualHash);
   assert.equal(baseline[0].signedContract.hash,baseline[0].signedContract.actualHash);
  });

  await t.test('both the identifier and the history action open the correct project; previous tools are available on the detail',async()=>{
   await row(p,ids[1]).getByRole('link',{name:ids[1],exact:true}).click();
   await detail(p,'companyName').waitFor();
   assert.equal(await p.locator('#project-summary-clear').isVisible(),false);
   assert.equal(await p.locator('#project-init-form').getAttribute('data-activity-project-id'),ids[1]);
   assert.equal(await detail(p,'companyName').inputValue(),'合成被审计单位1');
   await p.getByRole('button',{name:'返回项目汇总表'}).click();await assertTable(p,3);
   await nav(p,'ledger').evaluate(button=>button.click());await p.locator('[data-initiation-id="'+ids[0]+'"]').click();
   await detail(p,'manager').waitFor();assert.equal(await detail(p,'manager').inputValue(),'已存甲项目经理');
   assert.equal(await detail(p,'amount').inputValue(),'6000.00');
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
   await row(p,ids[0]).getByRole('link',{name:ids[0],exact:true}).click();
   await detail(p,'manager').fill('暂存经理-不应丢失');
   await detail(p,'companyName').fill('合成更正被审计单位');
   await p.getByRole('button',{name:'返回项目汇总表'}).click();
   assert.equal(await p.locator('#page-title').textContent(),'立项信息表');
   assert.equal(await detail(p,'manager').inputValue(),'暂存经理-不应丢失');
   assert.equal(dialogs.length,1);
   await p.locator('#page-save').click();
   await p.waitForFunction(()=>document.getElementById('page-save-status').textContent.startsWith('已暂存'));
   assert.deepEqual(await businessState(p,ids),baseline);
   await p.reload();await p.locator('[data-home-view=project]').click();await assertTable(p,3);
   await row(p,ids[0]).getByRole('link',{name:ids[0],exact:true}).click();
   await p.waitForFunction(()=>document.querySelector('#project-info-manager')?.value==='暂存经理-不应丢失');
   assert.deepEqual(await businessState(p,ids),baseline);
   await detail(p,'save').click();
   await p.getByText('立项信息已保存。',{exact:true}).waitFor();
   await p.getByRole('button',{name:'返回项目汇总表'}).click();await assertTable(p,3);
   assert.equal(await row(p,ids[0]).locator('td').nth(3).textContent(),'合成更正被审计单位');
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
    const layout=await p.evaluate(()=>{const x=document.querySelector('#project-initiation .pi-summary-scroll');return{viewport:document.documentElement.clientWidth,page:document.documentElement.scrollWidth,wrapper:x.clientWidth,table:x.scrollWidth,columns:document.querySelectorAll('#project-initiation .pi-summary-table th').length}});
    assert.ok(layout.page<=layout.viewport+1,JSON.stringify(layout));if(width===390)assert.ok(layout.table>layout.wrapper,JSON.stringify(layout));assert.equal(layout.columns,HEADERS.length);layouts.push({width,...layout});
    await p.locator('#project-initiation .pi-summary-scroll').evaluate(e=>e.scrollLeft=0);await p.screenshot({path:path.join(QA,'project-register-navigation-'+width+'.png'),fullPage:true});
    const scroll=await p.locator('#project-initiation .pi-summary-scroll').evaluate(e=>{e.scrollLeft=e.scrollWidth;return e.scrollLeft});if(width===390)assert.ok(scroll>0);
   }
   assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);assert.equal(dialogs.length,2);assert.equal(dialogs[1],'确认保存立项信息？');
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
  assert.equal(await row(p,id).getByRole('link',{name:id,exact:true}).count(),1);
  assert.equal(await row(p,id).locator('td').nth(3).textContent(),'合成首中标被审计方');
  const event=await p.evaluate(async id=>{const db=await QuoteLedger.open();try{return(await db.get(id)).entry.events.at(-1)}finally{db.close()}},id);
  assert.equal(event.outcome,'won');assert.equal(event.note,'通过下拉选项登记结果');
  fs.mkdirSync(QA,{recursive:true});await p.screenshot({path:path.join(QA,'project-register-first-award.png'),fullPage:true});
  assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close()}
});
