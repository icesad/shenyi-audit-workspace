'use strict';
// node tests/browser/project-initiation-smoke.cjs [site index or packaged offline HTML]
// Uses only self-generated, synthetic credentials and quote snapshots in an isolated browser context.
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const entry=path.resolve(process.argv[2]||path.join(__dirname,'../../dist/index.html'));
const modules=['招投标','立项','审计程序','报告','核算'];
const homeViews=['quote','project','audit','report','accounting'];
const source={
  firmName:'虚构试验事务所',customerName:'虚构被审计单位',auditYear:2025,location:'河北省',service:'年度财务报表审计',
  quoteDate:'2026-11-07',issuer:'虚构招标单位',projectName:'测试项目',projectType:'年度财务报表审计',
  contactName:'',contactInfo:'',subtotalCents:1234500,taxCents:0,totalCents:1234500,taxRateText:'0%'
};
async function main(){
 const checks=[],requests=[],errors=[];
 const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true});
 try{
  const ctx=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1440,height:900}});
  ctx.on('request',r=>{if(/^(https?|wss?):/.test(r.url()))requests.push(r.url());});
  await ctx.route(/^https?:/,r=>r.abort());
  const setup=async()=>{const p=await ctx.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));await p.goto(pathToFileURL(entry).href);return p;};
  const p=await setup(),q=s=>p.locator(s),home=q('#view-home');
  const go=(page,name)=>page.locator('#view-home [data-home-view='+homeViews[modules.indexOf(name)]+']').click();
  const saved=(page)=>page.locator('#project-init-list').getByRole('button',{name:'查看立项信息',exact:true});
  const visible=async selector=>q(selector).waitFor({state:'visible'});
  const waitText=(selector,needle)=>p.waitForFunction(([s,n])=>document.querySelector(s)?.textContent.includes(n),[selector,needle]);
  const projectName='#project-init-form [name=projectName]';
  await visible('#view-home');
  assert.deepEqual(await home.locator('[data-home-view]').evaluateAll(nodes=>nodes.map(n=>n.dataset.homeView)),homeViews);
  for(const [i,name]of modules.entries())assert.match(await home.locator('[data-home-view='+homeViews[i]+']').innerText(),new RegExp(name));
  for(const [i,name]of modules.entries()){
    if(i<2)continue;
    if(i===2){
      assert.doesNotMatch(await home.locator('[data-home-view=audit]').innerText(),/待建设/);
      await go(p,name);await visible('#audit-program');await q('#ac-project').waitFor();
      assert.equal(await q('#ac-import').isDisabled(),true,'materials require a saved project');
    }else{
      assert.match(await home.locator('[data-home-view='+homeViews[i]+']').innerText(),/待建设/);
      await go(p,name);await visible('#view-'+homeViews[i]);
      assert.equal(await q('#view-'+homeViews[i]+' form').count(),0);
    }
    await q('[data-view=home]').click();await visible('#view-home');
  }
  assert.equal(await q('#view-quote').isVisible(),false);
  await go(p,'招投标');await visible('#view-quote');
  assert.ok(await q('#tender-file').isVisible());assert.equal(await q('#quote-form [name=basis]').inputValue(),'manual');
  checks.push('five homepage entries, existing quote calculator opened from 招投标, future sections explicitly not active');

  const ids=await p.evaluate(async base=>{
    const c=document.createElement('canvas');c.width=90;c.height=55;
    const pen=c.getContext('2d');pen.fillStyle='#fff';pen.fillRect(0,0,90,55);pen.fillStyle='#000';pen.fillText('SYNTHETIC',9,30);
    const bytes=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
    const pair=await Promise.all(['business_license','practice_certificate'].map((kind,i)=>
      QuotePacket.readAttachment(new File([bytes],'synthetic-credential-'+i+'.png',{type:'image/png'}),kind)));
    const ledger=await QuoteLedger.open(),ids={};
    try{
      for(const [suffix,outcome] of [['PENDING',null],['LOST','lost'],['WON','won'],['STALE','won']]){
        const e=await ledger.register({...base,projectName:base.projectName+' '+suffix},pair);
        if(outcome)await ledger.appendResult(e.id,{outcome,expectedEventNo:0,note:'虚构测试'});
        ids[suffix]=e.id;
      }
      return ids;
    }finally{ledger.close();}
  },source);
  await q('[data-view=ledger]').click();await q('#ledger-rows tr').first().waitFor();
  const ledgerRow=(page,suffix)=>page.locator('#ledger-rows tr').filter({has:page.getByText(source.projectName+' '+suffix,{exact:true})});
  const cta=(page,suffix)=>ledgerRow(page,suffix).getByRole('button',{name:/立项/});
  assert.equal(await q('#ledger-rows tr').count(),4);
  assert.equal(await cta(p,'PENDING').count(),0);
  assert.equal(await cta(p,'LOST').count(),0);
  assert.equal(await cta(p,'WON').count(),1);
  checks.push('only latest won quote rows offer initiation, not pending/lost');

  await cta(p,'WON').click();await visible('#project-init-form');
  assert.equal(await q(projectName).inputValue(),source.projectName+' WON');
  assert.match(await q('#project-init-form [name=initiationDate]').inputValue(),/^\d{4}-\d{2}-\d{2}$/);
  for(const token of [source.issuer,source.customerName,source.firmName,String(source.auditYear),'12,345'])await waitText('#project-init-source',token);
  assert.equal(await saved(p).count(),0,'opening won quote must not save a project');
  await q('#project-init-form [name=manager]').fill('未保存测试人员');
  await p.reload();await visible('#view-home');await go(p,'立项');await visible('#project-init-list');
  await waitText('#project-init-list','本机暂无已保存的立项信息');
  assert.equal(await saved(p).count(),0);
  checks.push('winning quote prefills source/date, navigating or reloading does not auto-create a project');

  await q('[data-view=ledger]').click();await cta(p,'WON').click();await visible('#project-init-form');
  assert.equal(await q('#project-init-form [name=manager]').inputValue(),'');
  await q(projectName).fill('虚构立项登记');
  await q('#project-init-form [name=manager]').fill('合成项目负责人');
  await q('#project-init-form [name=notes]').fill('合成立项说明');
  await q('#project-init-save').click();await waitText('#project-init-status','立项信息已保存');
  await p.reload();await visible('#view-home');await go(p,'立项');
  await saved(p).waitFor();assert.equal(await saved(p).count(),1);
  await saved(p).click();await visible('#project-init-form');
  assert.equal(await q(projectName).inputValue(),'虚构立项登记');
  assert.equal(await q('#project-init-form [name=manager]').inputValue(),'合成项目负责人');
  assert.equal(await q('#project-init-form [name=notes]').inputValue(),'合成立项说明');
  checks.push('explicit save persists only one project and reopens same values on reload');

  // Keep a second editing tab at the same revision; the winner tab saves first.
  const staleTab=await setup();await go(staleTab,'立项');
  await saved(staleTab).click();
  await staleTab.locator(projectName).fill('不得覆盖的旧版');
  await q(projectName).fill('已确认的新修订');
  await q('#project-init-save').click();await waitText('#project-init-status','立项信息已保存');
  await staleTab.locator('#project-init-save').click();
  await staleTab.waitForFunction(()=>/其他页面更新/.test(document.querySelector('#project-init-status')?.textContent||''));
  await staleTab.close();await p.reload();await go(p,'立项');
  await saved(p).waitFor();assert.equal(await saved(p).count(),1);
  await saved(p).click();
  assert.equal(await q(projectName).inputValue(),'已确认的新修订');
  checks.push('repeated saving updates the original record; stale tab cannot overwrite it');

  await q('[data-view=ledger]').click();await cta(p,'STALE').click();await visible('#project-init-form');
  assert.equal(await q(projectName).inputValue(),source.projectName+' STALE');
  await p.evaluate(async id=>{
    const ledger=await QuoteLedger.open();
    try{await ledger.appendResult(id,{outcome:'lost',expectedEventNo:1,note:'虚构结果更正'});}finally{ledger.close();}
  },ids.STALE);
  await q('#project-init-save').click();
  await p.waitForFunction(()=>/仅可为最新结果/.test(document.querySelector('#project-init-status')?.textContent||''));
  await p.reload();await go(p,'立项');
  await saved(p).waitFor();assert.equal(await saved(p).count(),1);
  await q('[data-view=ledger]').click();await ledgerRow(p,'STALE').waitFor();assert.equal(await cta(p,'STALE').count(),0);
  const original=await p.evaluate(async id=>{
    const l=await QuoteLedger.open();
    try{return (await l.get(id)).entry.snapshot;}finally{l.close();}
  },ids.WON);
  assert.deepEqual(original,{...source,projectName:source.projectName+' WON'});
  checks.push('quote status corrected after opening blocks new project; saved project edits do not mutate the quote snapshot');
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,entry,browser:browser.version(),checks,requests,errors,syntheticOnly:true}));
 }catch(e){
  console.error(JSON.stringify({ok:false,entry,checks,requests,errors,error:String(e.stack||e)}));
  process.exitCode=1;
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
