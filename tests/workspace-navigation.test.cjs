'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{JSDOM}=require('jsdom');
const dist=path.resolve(__dirname,'../dist');
const html=()=>fs.readFileSync(path.join(dist,'index.html'),'utf8');
function fixture(){
 const dom=new JSDOM(html(),{url:'https://navigation-review.example/',runScripts:'outside-only'}),w=dom.window,d=w.document;
 w.confirm=()=>false;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};
 return {dom,w,d,eval:n=>w.eval(fs.readFileSync(path.join(dist,n),'utf8'))};
}
function boot(f){for(const n of ['calc.js','rule-catalog.js','regions.js','backup-restore.js','workspace-navigation.js','app.js'])f.eval(n);}
test('six groups and six home cards preserve unique existing selector entry points; planned pages are explicit',()=>{
 const f=fixture();try{
  assert.equal(f.d.querySelectorAll('.nav-group').length,6);
  assert.deepEqual([...f.d.querySelectorAll('.nav-group-number')].map(n=>n.textContent),['01','02','03','04','05','06']);
  assert.deepEqual([...f.d.querySelectorAll('[data-home-view]')].map(n=>n.dataset.homeView),['quote','project','audit','report','accounting','basics']);
  for(const key of ['quote','project','audit','rules','ledger','bidders','settings'])assert.equal(f.d.querySelectorAll('.nav-item[data-view="'+key+'"]').length,1,key);
  assert.equal(f.d.querySelectorAll('.workspace-navigation [data-view=proposal]').length,1);assert.equal(f.d.querySelectorAll('.workspace-navigation [data-view=bid]').length,1);assert.equal(f.d.querySelectorAll('[data-view=history]').length,0);assert.equal(f.d.querySelector('.nav-item[data-view=settings]').closest('.nav-group'),null);
  assert.equal(f.d.querySelectorAll('#view-basics [data-view]').length,3);
  assert.match(f.d.querySelector('#view-report').textContent,/建设中/);assert.match(f.d.querySelector('#view-accounting').textContent,/项目成本核算/);
  assert.equal(f.d.querySelectorAll('[data-report-section]').length,2);assert.ok(f.d.querySelector('#report-workspace'));
  assert.match(f.d.querySelector('#view-basics').textContent,/更换平台账号不会隔离/);
  assert.equal(f.d.querySelector('.nav-item[data-view=rules]').textContent,'收费依据');
  const src=[...f.d.scripts].map(n=>n.getAttribute('src'));
  for(const n of ['app-settings.js','account-client.js','workspace-navigation.js','report-workspace.js'])assert.ok(src.indexOf(n)<src.indexOf('app.js'));
 }finally{f.dom.window.close();}
});
test('basic cards and settings lazy mount preserve legacy raw strings and do not fetch on boot',()=>{
 const f=fixture();try{
  const old='{"legacySentinel":"do not migrate"}';f.w.localStorage.setItem('hengdu.audit.quote.records.v1',old);
  let mount=0,read=0,apply=0,callbacks;f.w.AccountClient={adapter:c=>(callbacks=c,{readAccountState:()=>{read++;return Promise.resolve({status:'unavailable'});}})};
  f.w.AppSettings={readPreferences:()=>({density:'compact'}),applyPreferences:()=>apply++,mount:(host,adapter)=>{mount++;adapter.readAccountState();return{refreshAccount:()=>adapter.readAccountState()};}};
  boot(f);assert.equal(mount,0);assert.equal(read,0);assert.equal(apply,1);
  f.d.querySelector('[data-home-view=basics]').click();assert.equal(f.d.querySelector('#view-basics').hidden,false);
  f.d.querySelector('#view-basics [data-view=rules]').click();assert.equal(f.d.querySelector('#view-rules').hidden,false);assert.equal(f.d.querySelector('#breadcrumb').textContent,'基础资料 / 收费依据');
  f.d.querySelector('.account-settings-button').click();assert.equal(mount,1);assert.equal(read,1);assert.equal(f.d.querySelector('#view-settings').hidden,false);
  let backupClicks=0;f.d.querySelector('#export-backup').addEventListener('click',()=>backupClicks++);callbacks.onOpenBackup();assert.equal(backupClicks,1);assert.equal(f.d.querySelector('#view-settings').hidden,false);
  f.d.querySelector('.nav-item[data-view=settings]').click();assert.equal(mount,1);assert.equal(read,1);
  assert.equal(f.w.localStorage.getItem('hengdu.audit.quote.records.v1'),old);
  assert.equal(f.w.localStorage.getItem('hengdu.audit.quote.records.v2'),null);
 }finally{f.dom.window.close();}
});
test('audit sidebar invokes original step button; dirty cancellation never changes page, stage or contents',()=>{
 const f=fixture();try{
  const nav=f.d.createElement('nav');nav.className='pw-steps';let calls=0,allow=false;
  for(let n=1;n<=7;n++){const b=f.d.createElement('button');b.dataset.auditStep=String(n);b.setAttribute('aria-pressed',String(n===3));b.onclick=()=>{calls++;if(!allow)return;for(const p of nav.children)p.setAttribute('aria-pressed',String(p===b));};nav.append(b);}
  f.d.querySelector('#audit-program').append(nav);boot(f);
  const link=f.d.querySelector('[data-nav-audit-step="2"]');link.click();assert.equal(calls,1);assert.equal(f.d.querySelector('#view-home').hidden,false);assert.equal(nav.querySelector('[aria-pressed=true]').dataset.auditStep,'3');
  allow=true;link.click();assert.equal(calls,2);assert.equal(f.d.querySelector('#view-audit').hidden,false);assert.equal(nav.querySelector('[aria-pressed=true]').dataset.auditStep,'2');assert.equal(link.getAttribute('aria-current'),'page');
  const before=calls;nav.querySelector('[data-audit-step="4"]').disabled=true;f.d.querySelector('[data-nav-audit-step="4"]').click();assert.equal(calls,before);assert.equal(nav.querySelector('[aria-pressed=true]').dataset.auditStep,'2');
 }finally{f.dom.window.close();}
});
test('nine visible audit stages remain sequential while retaining legacy stage identities',()=>{
 const f=fixture();try{
  const nodes=[...f.d.querySelectorAll('[data-nav-audit-step]')];
  assert.deepEqual(nodes.map(n=>n.dataset.navAuditStep),['1','8','2','3','4','6','7','5','9']);
  assert.deepEqual(nodes.map(n=>n.textContent),['① 资料收集与核对','② 账表校验','③ 工作底稿目录','④ 初步业务活动','⑤ 计划及风险识别','⑥ 执行一般审计程序','⑦ 执行实质性程序','⑧ 结论和报告阶段','⑨ 补充底稿']);
  assert.ok(nodes.every(n=>n.dataset.view==='audit'));assert.match(f.d.querySelector('.side-note .version').textContent,/v58/);
  const nav=f.d.createElement('nav');nav.className='pw-steps';let allow=false,calls=0;
  for(const n of [1,8,2,3,4,6,7,5,9]){const b=f.d.createElement('button');b.dataset.auditStep=String(n);b.setAttribute('aria-pressed',String(n===5));b.onclick=()=>{calls++;if(!allow)return;for(const p of nav.children)p.setAttribute('aria-pressed',String(p===b));};nav.append(b);}
  f.d.querySelector('#audit-program').append(nav);const sentinel='{"legacyStage":5,"preserve":"unchanged"}';f.w.localStorage.setItem('hengdu.audit.workpapers.v1',sentinel);boot(f);
  const general=f.d.querySelector('[data-nav-audit-step="6"]'),substantive=f.d.querySelector('[data-nav-audit-step="7"]'),other=f.d.querySelector('[data-nav-audit-step="5"]');
  general.click();assert.equal(calls,1);assert.equal(nav.querySelector('[aria-pressed=true]').dataset.auditStep,'5');assert.equal(f.d.querySelector('#view-home').hidden,false);
  allow=true;general.click();assert.equal(nav.querySelector('[aria-pressed=true]').dataset.auditStep,'6');assert.equal(general.getAttribute('aria-current'),'page');assert.equal(f.d.querySelector('#view-audit').hidden,false);
  substantive.click();assert.equal(nav.querySelector('[aria-pressed=true]').dataset.auditStep,'7');assert.equal(substantive.getAttribute('aria-current'),'page');assert.equal(general.hasAttribute('aria-current'),false);
  nav.querySelector('[data-audit-step="6"]').disabled=true;const before=calls;general.click();assert.equal(calls,before);assert.equal(nav.querySelector('[aria-pressed=true]').dataset.auditStep,'7');
  const prep=f.d.querySelector('[data-nav-audit-step="8"]');prep.click();assert.equal(nav.querySelector('[aria-pressed=true]').dataset.auditStep,'8');assert.equal(prep.getAttribute('aria-current'),'page');
  other.click();assert.equal(nav.querySelector('[aria-pressed=true]').dataset.auditStep,'5');assert.equal(other.getAttribute('aria-current'),'page');assert.equal(f.w.localStorage.getItem('hengdu.audit.workpapers.v1'),sentinel);
 }finally{f.dom.window.close();}
});

test('report entries mount once on demand and pass the exact selected project/index to the existing controller',async()=>{
 const f=fixture();try{
  let mounts=0,api,opened=null,scrolls=0;
  f.w.ProjectInitiation={mount:()=>({show(){}}),listSaved:async()=>[]};
  f.w.AuditProgram={mount:()=>({show(){throw Error('must not reset selected audit project');}})};
  f.w.WorkpaperWorkspace={mount:()=>({openDirectoryIndex:async value=>{opened=value;return 'opened';}})};
  f.w.ReportWorkspace={mount:(host,opts)=>{mounts++;api=opts;host.innerHTML='<section id="report-trial-balance"></section><section id="report-audit-report"></section>';host.querySelector('#report-audit-report').scrollIntoView=()=>scrolls++;return{};}};
  boot(f);assert.equal(mounts,0);
  f.d.querySelector('[data-report-section="audit-report"]').click();assert.equal(mounts,1);assert.equal(scrolls,1);assert.equal(f.d.querySelector('#view-report').hidden,false);
  f.d.querySelector('[data-report-section="trial-balance"]').click();assert.equal(mounts,1);
  assert.equal(await api.openTrialBalance({projectId:'synthetic-project-id',index:'9200'}),'opened');assert.equal(opened.projectId,'synthetic-project-id');assert.equal(opened.index,'9200');assert.equal(f.d.querySelector('#view-audit').hidden,false);
 }finally{f.dom.window.close();}
});
test('quotation and bid navigation show independent pages and preserve intake draft values',()=>{
 const f=fixture();try{
  boot(f);f.d.querySelector('[name=issuer]').value='独立导航草稿';f.d.querySelector('.workspace-navigation [data-view=bid]').click();assert.equal(f.d.getElementById('view-bid').hidden,false);assert.equal(f.d.getElementById('view-quote').hidden,true);assert.equal(f.d.querySelector('[name=issuer]').value,'独立导航草稿');
  assert.equal(f.d.querySelector('.workspace-navigation [data-view=bid]').getAttribute('aria-current'),'page');
  f.d.querySelector('#brand-home').click();assert.equal(f.d.querySelector('#view-home').hidden,false);
 }finally{f.dom.window.close();}
});
test('desktop and 390px real browser navigation, lazy settings, brand return and overflow checks',async t=>{
 let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('existing Playwright unavailable');}
 const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(executable))return t.skip('existing Chromium unavailable');
 const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true}),context=await browser.newContext({viewport:{width:1440,height:1000}});
 const errors=[],remote=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});
 const out=process.env.V50_NAV_QA_DIR?path.resolve(process.env.V50_NAV_QA_DIR,'navigation-'+Date.now()):null;if(out)fs.mkdirSync(out,{recursive:true});
 const shot=async n=>{if(out)await page.screenshot({path:path.join(out,n+'.png'),fullPage:true});};
 try{
  await page.goto(pathToFileURL(path.join(dist,'index.html')).href);await page.locator('#view-home').waitFor({state:'visible'});
  assert.equal(await page.locator('.nav-group').count(),6);assert.equal(await page.locator('[data-home-view]').count(),6);
  assert.equal(await page.locator('#app-settings').evaluate(n=>n.childElementCount),0);assert.deepEqual(remote,[]);
  await shot('desktop-home');
  const original=await page.evaluate(()=>{const key='hengdu.audit.quote.records.v1',value='{"navigationSentinel":"preserve original"}';localStorage.setItem(key,value);return{key,value};});
  await page.locator('[data-home-view=basics]').click();await shot('desktop-basics');
  await page.locator('#view-basics [data-view=rules]').click();assert.equal(await page.locator('#breadcrumb').textContent(),'基础资料 / 收费依据');
  await page.locator('.nav-item[data-view=quote]').click();await page.locator('[name=issuer]').fill('虚构导航资料');await page.locator('.workspace-navigation [data-view=bid]').click();assert.equal(await page.locator('#view-bid').isVisible(),true);assert.equal(await page.locator('[name=issuer]').inputValue(),'虚构导航资料');
  await page.locator('.nav-item[data-view=audit]').click();await page.locator('[data-nav-audit-step="2"]').click();assert.equal(await page.locator('.pw-steps [data-audit-step="2"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-nav-audit-step="4"]').click();assert.equal(await page.locator('.pw-steps [data-audit-step="4"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-nav-audit-step="6"]').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.pw-steps [data-audit-step="6"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-nav-audit-step="6"]').getAttribute('aria-current'),'page');
  await page.locator('[data-nav-audit-step="7"]').click();assert.equal(await page.locator('.pw-steps [data-audit-step="7"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-nav-audit-step="7"]').getAttribute('aria-current'),'page');
  await page.locator('[data-nav-audit-step="5"]').click();assert.equal(await page.locator('.pw-steps [data-audit-step="5"]').getAttribute('aria-pressed'),'true');
  await page.locator('.account-settings-button').click();await page.locator('#app-settings .as-page').waitFor({state:'visible'});await shot('desktop-settings');
  assert.match(await page.locator('#app-settings').textContent(),/本机业务数据|本机业务资料|本机业务记录/);
  await page.locator('#brand-home').click();assert.equal(await page.locator('#view-home').isVisible(),true);
  await page.setViewportSize({width:390,height:844});await shot('mobile-home');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('[data-home-view=basics]').click();await page.locator('#view-basics [data-view=bidders]').click();assert.equal(await page.locator('#view-bidders').isVisible(),true);
  await page.locator('.account-settings-button').click();await shot('mobile-settings');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('#brand-home').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#view-home').isVisible(),true);
  assert.equal(await page.evaluate(k=>localStorage.getItem(k),original.key),original.value);
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  if(out)fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({scope:'synthetic file-origin browser navigation only;no platform login or business acceptance',viewport:[{width:1440,height:1000},{width:390,height:844}],errors,remote,businessStorageSentinelPreserved:true,passed:true},null,2)+'\n',{flag:'wx'});
 }finally{await context.close();await browser.close();}
});


test('project activity resolver only follows explicitly selected visible formal project contexts',()=>{
 const f=fixture();try{let resolver,refreshes=0;f.w.ProjectActivity={mount:opts=>(resolver=opts.resolveProject,{refreshContext:()=>{refreshes++;return Promise.resolve();}})};boot(f);
  assert.equal(resolver(),'');const form=f.d.createElement('form');form.id='project-init-form';form.dataset.activityProjectId='11111111-1111-4111-8111-111111111111';f.d.getElementById('project-initiation').append(form);
  f.d.querySelector('[data-home-view=project]').click();assert.equal(resolver(),form.dataset.activityProjectId);f.d.querySelector('.brand').click();assert.equal(resolver(),'');
  const ac=f.d.createElement('select');ac.id='ac-project';ac.append(new f.w.Option('项目甲','22222222-2222-4222-8222-222222222222'));ac.getClientRects=()=>[{}];f.d.getElementById('audit-program').append(ac);f.d.querySelector('[data-home-view=audit]').click();assert.equal(resolver(),ac.value);ac.disabled=true;assert.equal(resolver(),'');
  f.d.querySelector('.brand').click();assert.equal(resolver(),'');assert.ok(refreshes>=4);
 }finally{f.dom.window.close();}
});


test('new accounting pages mount lazily and retain unsubmitted DOM across navigation without replaying identities',async()=>{
 const f=fixture();try{
  let travel=0,costs=0,travelDestroyed=0,costDestroyed=0,allow=false,options;
  f.w.ProjectInitiation={mount:()=>({show(){}}),listSaved:async()=>[]};
  f.w.AccountClient={readAccountState:async()=>({status:'signed-in',account:{displayName:'合成账号'}})};
  f.w.TravelExpenses={mount:(host,opts)=>{travel++;assert.equal(host.id,'travel-expenses-host');options=opts;return{canLeave:()=>allow,destroy:()=>travelDestroyed++};}};
  f.w.ProjectCosts={mount:(host,opts)=>{costs++;assert.equal(host.id,'project-costs');assert.equal(opts.incomeBasis,'gross');assert.equal(opts.returnBasis,'cost');return{canLeave:()=>allow,destroy:()=>costDestroyed++};}};
  boot(f);assert.equal(travel,0);assert.equal(costs,0);
  const enterCosts=()=>f.d.querySelector('#view-accounting [data-view=costs]').click(),enterTravel=()=>f.d.querySelector('.nav-sub-item[data-view=travel]').click(),home=()=>f.d.querySelector('.brand').click();
  enterCosts();assert.equal(costs,1);home();assert.equal(f.d.querySelector('#view-home').hidden,false);assert.equal(costDestroyed,0);
  allow=true;home();assert.equal(costDestroyed,0);enterTravel();assert.equal(travel,1);assert.equal((await options.readAccountState()).account.displayName,'合成账号');assert.equal(f.d.querySelectorAll('#travel-expenses-host').length,1);
  allow=false;home();assert.equal(f.d.querySelector('#view-home').hidden,false);assert.equal(travelDestroyed,0);
  allow=true;home();assert.equal(travelDestroyed,0);enterTravel();assert.equal(travel,1);home();assert.equal(travelDestroyed,0);enterCosts();assert.equal(costs,1);
  assert.equal(f.d.querySelector('[data-nav-section=scope-accounting-invoice]'),null);
 }finally{f.dom.window.close();}
});
