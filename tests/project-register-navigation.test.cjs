'use strict';
/* Full app, original 22-column register navigation. Synthetic records and files only. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const DIST=path.resolve(__dirname,'../dist');
const QA=path.resolve(process.env.PROJECT_NAV_QA_DIR||path.join(__dirname,'../../v58-ui-qa'));
const HEADERS=['序号','项目编号','委托方名称','被审计单位名称','项目名称','项目状态','项目类型','项目金额（含税价）','项目金额（不含税价）','风险等级','项目经理指派','项目现场时间','项目底稿及报告时间','底稿编制时间','编制人','复核人','财务报表截止日期','合同模板填写','合同盖章版','开票信息','发票','是否已回款'];
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const row=(p,id)=>p.locator('tr[data-project-register-id="'+id+'"]');
const field=(p,id,key)=>row(p,id).locator('[data-project-register-field="'+key+'"]');
const nav=(p,name)=>p.locator('.workspace-navigation [data-view="'+name+'"]');
async function ready(p,count){await p.waitForFunction(n=>{const rows=[...document.querySelectorAll('#project-initiation tr[data-project-register-id]')];return document.querySelector('#project-initiation .pr-table')&&rows.length===n&&rows.every(r=>!r.querySelector('[data-project-register-save]').disabled);},count);}
async function assertTable(p,count){await ready(p,count);assert.deepEqual(await p.locator('#project-initiation .pr-table thead th').allTextContents(),HEADERS);assert.equal(await p.locator('#project-initiation .pi-editor,#project-init-form').count(),0);assert.equal(await p.locator('#project-initiation tr[data-project-register-id]').count(),count);}
async function businessState(p,ids){return p.evaluate(async ids=>{
 const result=[];
 for(const id of ids){const x=await ProjectWorkspaceStore.get(id);result.push({id,rev:x.rev,amountCents:x.amountCents,projectRegister:x.projectRegister,projectLifecycle:x.projectLifecycle,projectClassification:x.projectClassification,projectIdentity:x.projectIdentity,projectInvoice:x.projectInvoice,firm:x.firm,contract:x.contract?{name:x.contract.name,hash:x.contract.hash,actualHash:await ProjectWorkspaceStore.hash(x.contract.blob)}:null,signedContract:x.signedContract?{name:x.signedContract.name,hash:x.signedContract.hash,actualHash:await ProjectWorkspaceStore.hash(x.signedContract.blob)}:null});}
 return result;
},ids);}
async function originalSources(p){return p.evaluate(async()=>{const s=await QuoteLedger.open();try{return{ledger:JSON.stringify(await s.list()),projects:JSON.stringify((await ProjectInitiation.listSaved()).map(x=>({quoteId:x.quoteId,source:x.source,form:x.form})))}}finally{s.close()}});}

test('whole app project navigation retains the original all-project register without changing business records',{timeout:120000},async t=>{
 fs.mkdirSync(QA,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:fs.existsSync(EDGE)?EDGE:chromium.executablePath()});
 const context=await browser.newContext({offline:true,acceptDownloads:true,viewport:{width:1440,height:900}});
 const p=await context.newPage(),errors=[],remote=[],dialogs=[],layouts=[];
 p.on('pageerror',e=>errors.push(e.message));
 p.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});
 p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
 let ids,baseline,sources,quoteDOM;
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
     const item=await ledger.register(snapshot,pair);await ledger.appendResult(item.id,{expectedEventNo:0,outcome:i<3?'won':'lost',note:'仅合成导航回归'});if(i<3){ids.push(item.id);await ProjectInitiation.ensureWon((await ledger.get(item.id)).entry);}
    }
    const reg={schemaVersion:1,riskLevel:'A类',manager:'已存甲项目经理',siteTime:'3天',workpaperReportTime:'已存交付时间',preparationTime:'',preparer:'已存编制人',reviewer:'已存复核人',financialStatementDate:'2026-12-31'};
    await ProjectWorkspaceStore.save(ids[0],0,{amountCents:600000,projectRegister:reg,projectLifecycle:{schemaVersion:1,status:'进行中',paymentReceived:'是'},projectClassification:{schemaVersion:1,projectType:'专项审计'}});
    const source=(await ProjectInitiation.listSaved()).find(x=>x.quoteId===ids[0]).source,E=new TextEncoder(),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const parts={'[Content_Types].xml':E.encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),'word/document.xml':E.encode('<w:document xmlns:w="'+ns+'"><w:body><w:p><w:r><w:t>合成合同原件；责任与条款不得因页面导航而修改。</w:t></w:r></w:p></w:body></w:document>')};
    let workspace=await ProjectWorkspaceStore.get(ids[0]);await ProjectContract.uploadTemplate(source,new File([QuoteLayouts.packOfficeParts(parts)],'合成已存合同.docx',{type:QuoteLayouts.docxMime}),{expectedRevision:workspace.rev});
    workspace=await ProjectWorkspaceStore.get(ids[0]);await ProjectContract.uploadSigned(source,pdf(),{expectedRevision:workspace.rev});
    return ids;
   }finally{ledger.close()}
  });
  await nav(p,'quote').click();
  await p.locator('#client-form [name=clientName]').fill('无关报价草稿不得被项目导航改变');
  quoteDOM=await p.locator('#view-quote').evaluate(e=>e.innerHTML);

  await t.test('main establishment entry shows every won project in the unchanged 22-column register',async()=>{
   await nav(p,'project').click();await assertTable(p,3);
   assert.equal(await field(p,ids[0],'manager').inputValue(),'已存甲项目经理');
   assert.equal(await row(p,ids[0]).locator('[data-project-register-amount]').inputValue(),'6000.00');
   assert.equal(await row(p,ids[0]).locator('[data-project-lifecycle-field=paymentReceived]').inputValue(),'是');
   assert.match(await row(p,ids[0]).locator('[data-project-template-download]').isEnabled()?'合同可下载':'',/可下载/);
   await p.locator('#project-initiation .pr-table').evaluate(e=>e.dataset.navigationSentinel='preserve-original-table');
   baseline=await businessState(p,ids);sources=await originalSources(p);
   assert.ok(baseline[0].contract&&baseline[0].signedContract);
   assert.equal(baseline[0].contract.hash,baseline[0].contract.actualHash);
   assert.equal(baseline[0].signedContract.hash,baseline[0].signedContract.actualHash);
  });

  await t.test('row Open and quotation-history establishment link focus the original row without rendering a single-project card',async()=>{
   await row(p,ids[1]).locator('[data-project-open]').click();await assertTable(p,3);
   assert.equal(await p.evaluate(()=>document.activeElement?.dataset.projectOpen),ids[1]);
   assert.equal(await p.locator('#project-initiation .pr-table').getAttribute('data-navigation-sentinel'),'preserve-original-table');
   await nav(p,'ledger').click();await p.locator('[data-initiation-id="'+ids[0]+'"]').waitFor();
   await p.locator('[data-initiation-id="'+ids[0]+'"]').click();await assertTable(p,3);
   assert.equal(await p.evaluate(()=>document.activeElement?.dataset.projectOpen),ids[0]);
   assert.deepEqual(await businessState(p,ids),baseline);
   assert.deepEqual(await originalSources(p),sources);
  });

  await t.test('unsaved row input survives page switches and repeated row opening; temporary save and reload do not formally commit',async()=>{
   await field(p,ids[0],'manager').fill('暂存经理-不应丢失');
   await row(p,ids[0]).locator('[data-project-register-amount]').fill('7777.70');
   await field(p,ids[1],'reviewer').fill('第二行未提交复核人');
   await row(p,ids[2]).locator('[data-project-open]').click();await assertTable(p,3);
   assert.equal(await field(p,ids[0],'manager').inputValue(),'暂存经理-不应丢失');
   await nav(p,'quote').click();assert.equal(await p.locator('#client-form [name=clientName]').inputValue(),'无关报价草稿不得被项目导航改变');
   assert.equal(await p.locator('#view-quote').evaluate(e=>e.innerHTML),quoteDOM,'project navigation must not rewrite the quotation-page DOM');
   await nav(p,'project').click();await assertTable(p,3);
   assert.equal(await field(p,ids[0],'manager').inputValue(),'暂存经理-不应丢失');
   assert.equal(await field(p,ids[1],'reviewer').inputValue(),'第二行未提交复核人');
   await p.locator('#page-save').click();await p.waitForFunction(()=>document.getElementById('page-save-status').textContent.startsWith('已暂存'));
   assert.deepEqual(await businessState(p,ids),baseline);
   await p.reload();await nav(p,'project').click();await assertTable(p,3);
   await p.waitForFunction(id=>document.querySelector('[data-project-register-id="'+id+'"] [data-project-register-field=manager]').value==='暂存经理-不应丢失',ids[0]);
   assert.equal(await row(p,ids[0]).locator('[data-project-register-amount]').inputValue(),'7777.70');
   assert.equal(await field(p,ids[1],'reviewer').inputValue(),'第二行未提交复核人');
   assert.deepEqual(await businessState(p,ids),baseline);
   assert.deepEqual(await originalSources(p),sources);
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
    const layout=await p.evaluate(()=>{const x=document.querySelector('#project-initiation .pr-scroll');return{viewport:document.documentElement.clientWidth,page:document.documentElement.scrollWidth,wrapper:x.clientWidth,table:x.scrollWidth,columns:document.querySelectorAll('#project-initiation .pr-table th').length}});
    assert.ok(layout.page<=layout.viewport+1,JSON.stringify(layout));assert.ok(layout.table>layout.wrapper,JSON.stringify(layout));assert.equal(layout.columns,22);layouts.push({width,...layout});
    await p.locator('#project-initiation .pr-scroll').evaluate(e=>e.scrollLeft=0);await p.screenshot({path:path.join(QA,'project-register-navigation-'+width+'.png'),fullPage:true});
    const scroll=await p.locator('#project-initiation .pr-scroll').evaluate(e=>{e.scrollLeft=e.scrollWidth;return e.scrollLeft});assert.ok(scroll>0);
   }
   assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);assert.deepEqual(dialogs,[]);
  });
 }finally{
  fs.writeFileSync(path.join(QA,'project-register-navigation-report.json'),JSON.stringify({syntheticOnly:true,headers:HEADERS,ids,layouts,pageErrors:errors,httpRequests:remote,dialogs},null,2));
  await context.close();await browser.close();
 }
});

test('empty full-app register refreshes after the first award is registered through the real history dropdown',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true,executablePath:fs.existsSync(EDGE)?EDGE:chromium.executablePath()}),context=await browser.newContext({offline:true,viewport:{width:1440,height:900}}),p=await context.newPage(),errors=[],dialogs=[];
 p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto(pathToFileURL(path.join(DIST,'index.html')).href);
  await nav(p,'project').click();await assertTable(p,0);
  await nav(p,'quote').click();await nav(p,'project').click();await assertTable(p,0);
  const id=await p.evaluate(async()=>{
   const ledger=await QuoteLedger.open();try{
    const pdf=()=>{const a=new Uint8Array(128).fill(32);a.set(new TextEncoder().encode('%PDF-1.4\n% SYNTHETIC ONLY\n'));a.set(new TextEncoder().encode('\n%%EOF\n'),121);return new File([a],'合成证明.pdf',{type:'application/pdf'});};
    const pair=await Promise.all(['business_license','practice_certificate'].map(k=>QuotePacket.readAttachment(pdf(),k)));
    const item=await ledger.register({firmName:'合成事务所',customerName:'合成首中标被审计方',auditYear:2026,location:'广西壮族自治区',service:'年度财务报表审计',quoteDate:'2026-11-12',issuer:'合成首中标委托方',projectName:'空表之后首个中标项目',projectType:'年度财务报表审计',contactName:'合成联系人',contactInfo:'synthetic-only',subtotalCents:100000,taxCents:6000,totalCents:106000,taxRateText:'6%'},pair);
    if((await ledger.get(item.id)).entry.events.length!==0||(await ProjectInitiation.listSaved()).length!==0)throw Error('fixture must remain pending with no project');
    return item.id;
   }finally{ledger.close()}
  });
  await nav(p,'ledger').click();await p.locator('[data-result-select="'+id+'"]').waitFor();
  p.once('dialog',async d=>{dialogs.push(d.message());await d.accept();});
  await p.locator('[data-result-select="'+id+'"]').selectOption('won');
  await p.locator('[data-initiation-id="'+id+'"]').waitFor();
  await p.waitForFunction(async id=>(await ProjectInitiation.listSaved()).some(x=>x.quoteId===id),id);
  assert.equal(dialogs.length,1);assert.match(dialogs[0],/登记为.*中标/);
  // Use the sidebar, not the history row's open button: this catches a stale empty-table guard.
  await nav(p,'project').click();await assertTable(p,1);
  assert.equal(await row(p,id).count(),1);
  assert.match(await row(p,id).locator('td').nth(4).textContent(),/空表之后首个中标项目/);
  const event=await p.evaluate(async id=>{const db=await QuoteLedger.open();try{return(await db.get(id)).entry.events.at(-1)}finally{db.close()}},id);
  assert.equal(event.outcome,'won');assert.equal(event.note,'通过下拉选项登记结果');
  fs.mkdirSync(QA,{recursive:true});await p.screenshot({path:path.join(QA,'project-register-first-award.png'),fullPage:true});
  assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close()}
});
