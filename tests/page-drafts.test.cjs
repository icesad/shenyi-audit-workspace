'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),P=require('../dist/page-drafts.js');
const D=path.resolve(__dirname,'../dist'),QA=path.resolve(__dirname,'../../v57-page-drafts-qa');
test('temporary draft values are bounded safe scalar trees, not attachments or safety confirmation state',()=>{assert.deepEqual(JSON.parse(JSON.stringify(P.cloneValues({amount:'not-yet-valid',revision:2,rows:[{projectId:'a',notes:'draft only'}],empty:null}))),{amount:'not-yet-valid',revision:2,rows:[{projectId:'a',notes:'draft only'}],empty:null});for(const x of [new Blob(['file']),new Date(),{password:'secret'},{allInvoicesUploaded:true},{confirmed:'yes'},{flag:true},{x:Infinity},{x:()=>{}},{__proto__:null,x:Symbol('x')}])assert.throws(()=>P.cloneValues(x));const circular={};circular.self=circular;assert.throws(()=>P.cloneValues(circular));let called=0;const access={};Object.defineProperty(access,'x',{enumerable:true,get(){called++;return 'unsafe';}});assert.throws(()=>P.cloneValues(access));assert.equal(called,0);assert.throws(()=>P.cloneValues({notes:'a'.repeat(100001)}));assert.throws(()=>P.cloneValues(Array.from({length:12},()=>({text:'a'.repeat(99999)}))));});
test('scope keys canonically include page, project, stage, subject, firm and source, without guessing aliases',()=>{const scope={kind:'workpaper',projectId:'p1',stage:4,subjectId:'subject1',firmId:'firm1',fileHash:'a'.repeat(64)};assert.equal(P.scopeKey('audit',scope),P.scopeKey('audit',Object.fromEntries(Object.entries(scope).reverse())));for(const [k,v]of Object.entries(scope))assert.notEqual(P.scopeKey('audit',scope),P.scopeKey('audit',{...scope,[k]:String(v)+'different'}));assert.notEqual(P.scopeKey('audit',scope),P.scopeKey('report',scope));assert.throws(()=>P.scopeKey('audit',{}));assert.throws(()=>P.scopeKey('audit',{unknown:'x'}));assert.throws(()=>P.scopeKey('bad page',scope));});
test('real IndexedDB temporary drafts CAS, scope restore, local failure and safe form capture',async t=>{let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('Existing Playwright unavailable');}const exe=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(exe))return t.skip('Existing Chromium unavailable');fs.mkdirSync(QA,{recursive:true});const browser=await chromium.launch({headless:true,executablePath:exe});try{const context=await browser.newContext(),page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});await page.goto(pathToFileURL(path.join(D,'rule-catalog.js')).href);await page.evaluate(()=>document.body.replaceChildren());await page.addScriptTag({content:fs.readFileSync(path.join(D,'page-drafts.js'),'utf8')});
await t.test('explicit adapter snapshots do not invoke business save, and same scope restores after remount',async()=>{const x=await page.evaluate(async()=>{globalThis.fields={amount:'6000.15',notes:'未提交文本'},globalThis.scope={kind:'project-editor',projectId:'p1'},globalThis.saves=0;globalThis.a=PageDrafts.create();a.registerAdapter('project',{capture:()=>({scope,values:fields}),scope:()=>scope,restore:(v)=>{fields=JSON.parse(JSON.stringify(v));},save:()=>{saves++;return{saved:1};}});await a.restore('project');const saved=await a.checkpoint('project');fields={amount:'',notes:''};const restored=await a.restore('project');return{saved,restored,fields,saves};});assert.equal(x.saved.saved,true);assert.equal(x.restored.restored,true);assert.deepEqual(x.fields,{amount:'6000.15',notes:'未提交文本'});assert.equal(x.saves,0);});
await t.test('same project different subject/stage/firm/page has no cross-restore',async()=>{const x=await page.evaluate(async()=>{scope={kind:'workpaper',projectId:'p1',stage:'3',subjectId:'1000',firmId:'firm1'};fields={answer:'A original'};await a.restore('project');await a.checkpoint('project');scope={...scope,subjectId:'1100'};fields={answer:'B unsaved'};const missing=await a.restore('project');await a.checkpoint('project');scope={...scope,subjectId:'1000'};await a.restore('project');const A=fields.answer;scope={...scope,firmId:'firm2'};fields={answer:'other firm'};const firm=await a.restore('project');scope={...scope,firmId:'firm1',stage:'4'};const stage=await a.restore('project');return{A,missing,firm,stage,fields};});assert.equal(x.A,'A original');assert.equal(x.missing.restored,false);assert.equal(x.firm.restored,false);assert.equal(x.stage.restored,false);assert.equal(x.fields.answer,'other firm');});
await t.test('two actual manager connections conflict rather than overwrite another tab and preserve losing memory',async()=>{const x=await page.evaluate(async()=>{globalThis.localA={text:'A'},globalThis.localB={text:'B'},globalThis.casScope={kind:'cas',projectId:'race'};globalThis.b=PageDrafts.create();a.registerAdapter('rules',{capture:()=>({scope:casScope,values:localA}),restore:v=>{localA=JSON.parse(JSON.stringify(v));}});b.registerAdapter('rules',{capture:()=>({scope:casScope,values:localB}),restore:v=>{localB=JSON.parse(JSON.stringify(v));}});await Promise.all([a.restore('rules',{scope:casScope}),b.restore('rules',{scope:casScope})]);const results=await Promise.allSettled([a.checkpoint('rules'),b.checkpoint('rules')]);const loser=results[0].status==='rejected'?a:b,winner=loser===a?b:a;const pending=loser.peek('rules',{scope:casScope});let repeat;try{await loser.checkpoint('rules');}catch(e){repeat=e.message;}const existing=(await winner.list('rules'))[0];await loser.restore('rules',{scope:casScope});return{statuses:results.map(r=>r.status),pending,repeat,revision:existing.revision};});assert.equal(x.statuses.filter(x=>x==='fulfilled').length,1);assert.equal(x.statuses.filter(x=>x==='rejected').length,1);assert.ok(x.pending.values.text);assert.match(x.repeat,/其他页面更新/);assert.equal(x.revision,1);});
await t.test('null capture never reports success and owner save is only explicit',async()=>{const x=await page.evaluate(async()=>{a.registerAdapter('home',{capture:()=>null,restore:()=>{},save:()=>{saves++;return{saved:1};}});const empty=await a.checkpoint('home');a.registerAdapter('basics',{capture:()=>({scope:{kind:'empty-fields'},values:null}),restore:()=>{}});const noFields=await a.checkpoint('basics');await a.saveOwner('home');return{empty,noFields,saves};});assert.equal(x.empty.state,'empty');assert.equal(x.empty.saved,false);assert.equal(x.noFields.saved,false);assert.equal(x.saves,1);});
await t.test('safe generic capture excludes files confirmations scope selectors and ambiguous keys',async()=>{const x=await page.evaluate(()=>{document.body.innerHTML='<section id="host"><input id="title" value="未提交标题"><input name="anonymous" value="no row identity"><div data-project-register-id="p1"><input name="notes" value="项目一"></div><div data-project-register-id="p2"><input name="notes" value="项目二"></div><input id="file" type="file"><input id="password" type="password" value="secret"><input id="approved" type="checkbox" checked><input id="radio" type="radio" checked><input id="hidden" type="hidden" value="hidden"><input id="token" value="secret"><input id="derived" readonly value="derived"><input id="disabled" disabled value="disabled"><select id="project-picker"><option value="p1">项目一</option></select><select id="review"><option value="confirmed">核对通过</option></select><input id="duplicate" value="a"><input id="duplicate" value="b"><textarea id="memo">备注草稿</textarea><div contenteditable="true"><input id="inside-editor" value="skip"></div><div data-safety-confirmation><input id="unsafe-text" value="skip"></div></section>';globalThis.host=document.getElementById('host');const values=PageDrafts.captureFields(host);return{values,keys:Object.keys(values)};});assert.equal(x.keys.length,4);assert.ok(x.keys.some(k=>k.includes('p1')));assert.ok(x.keys.some(k=>k.includes('p2')));assert.deepEqual(Object.values(x.values).sort(),['备注草稿','未提交标题','项目一','项目二'].sort());});
await t.test('generic restoration validates complete scope identity before writing any field; attached files never impersonated',async()=>{const x=await page.evaluate(()=>{const values=PageDrafts.captureFields(host);for(const n of host.querySelectorAll('input[type=text],input:not([type]),textarea'))if(!n.readOnly)n.value='changed';let events=0;host.addEventListener('input',()=>events++);const restored=PageDrafts.restoreFields(host,values);const snapshot=PageDrafts.captureFields(host);const invalid={...values,'{"id":"missing","row":[]}':'not present'};let error;try{PageDrafts.restoreFields(host,invalid);}catch(e){error=e.message;}return{restored,snapshot,error,events,fileCount:host.querySelector('input[type=file]').files.length};});assert.equal(x.restored.restored,4);assert.match(x.error,/未回填/);assert.equal(x.events,4);assert.equal(x.fileCount,0);assert.ok(Object.values(x.snapshot).includes('项目二'));});
await t.test('owner restore failures do not delete draft; changed asynchronous scope never receives stale values',async()=>{const x=await page.evaluate(async()=>{let current={kind:'source',projectId:'stable'},values={text:'source text'},restores=0;a.registerAdapter('audit',{capture:()=>({scope:current,values}),scope:()=>current,restore:()=>{restores++;throw Error('底稿已经冻结');}});await a.restore('audit');await a.checkpoint('audit');let frozen;try{await a.restore('audit');}catch(e){frozen=e.message;}const retained=(await a.list('audit')).length;let release;const gate=new Promise(ok=>release=ok);a.registerAdapter('report',{capture:()=>({scope:current,values}),scope:async()=>{await gate;return current;},restore:()=>{restores++;}});const pending=a.restore('report',{scope:{kind:'source',projectId:'stable'}});current={kind:'source',projectId:'different'};release();const stale=await pending;return{frozen,retained,stale,restores};});assert.match(x.frozen,/冻结/);assert.equal(x.retained,1);assert.equal(x.stale.state,'stale');assert.equal(x.restores,1);});
await t.test('local quota/storage failures are visible and never drop current input or change business data',async()=>{const x=await page.evaluate(async()=>{let messages=[],values={amount:'retain invalid amount'};const c=PageDrafts.create({notify:(...x)=>messages.push(x)});c.registerAdapter('costs',{capture:()=>({scope:{kind:'costs',projectId:'p-quota'},values}),restore:()=>{}});await c.restore('costs');const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('synthetic quota','QuotaExceededError');};let error;try{await c.checkpoint('costs');}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=original;}const pending=c.peek('costs',{scope:{kind:'costs',projectId:'p-quota'}});c.close();return{error,messages,pending,values};});assert.ok(x.error);assert.equal(x.messages.at(-1)[1],true);assert.equal(x.pending.values.amount,'retain invalid amount');assert.equal(x.values.amount,'retain invalid amount');});
await t.test('discard uses CAS tombstones to prevent stale ABA overwrite; explicit scope mandatory',async()=>{const x=await page.evaluate(async()=>{const s={kind:'delete',projectId:'p-delete'};a.registerAdapter('templates',{capture:()=>({scope:s,values:{text:'keep'}}),restore:()=>{}});b.registerAdapter('templates',{capture:()=>({scope:s,values:{text:'stale'}}),restore:()=>{}});await a.restore('templates',{scope:s});await a.checkpoint('templates');await b.restore('templates',{scope:s});const removed=await a.discard('templates',{scope:s});let error;try{await b.checkpoint('templates');}catch(e){error=e.message;}const empty=await a.restore('templates',{scope:s});await a.checkpoint('templates');return{removed,error,empty,list:await a.list('templates')};});assert.match(x.error,/其他页面更新/);assert.equal(x.removed.revision,2);assert.equal(x.empty.restored,false);assert.equal(x.list[0].revision,3);});
assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await page.evaluate(()=>{a.close();b.close();});fs.writeFileSync(path.join(QA,'browser.json'),JSON.stringify({errors,requests,scope:'Synthetic IndexedDB data only; not business records'},null,2));await context.close();}finally{await browser.close();}});

test('the app reports real local save results and names required fields even when offline',async t=>{
  const {chromium}=require('playwright');
  const executablePath=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();
  if(!fs.existsSync(executablePath))return t.skip('Existing Chromium unavailable');
  const browser=await chromium.launch({headless:true,executablePath});
  t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(D,'index.html')).href);
  const save=page.locator('#page-save'),feedback=page.locator('#page-save-status');
  const dialog=page.locator('#save-result-dialog'),title=dialog.locator('h2'),body=dialog.locator('p');
  const dismiss=()=>dialog.getByRole('button',{name:'确定'}).click();
  assert.equal(await save.isVisible(),false);
  assert.equal(await page.locator('#page-subtitle').isVisible(),false);
  await page.locator('[data-home-view="project"]').evaluate(node=>node.click());
  await save.click();
  await dialog.getByRole('heading',{name:'保存失败'}).waitFor();
  assert.match(await body.textContent(),/请打开已立项项目/);
  assert.equal(await dialog.getByRole('button',{name:'确定'}).evaluate(button=>document.activeElement===button),true);
  await dismiss();
  await page.locator('.workspace-navigation [data-view="quote"]').evaluate(node=>node.click());
  await context.setOffline(true);
  await save.click();
  await dialog.getByRole('heading',{name:'保存成功'}).waitFor();
  assert.match(await body.textContent(),/已暂存本页输入/);
  assert.match(await feedback.textContent(),/仅本机/);
  await dismiss();
  await page.evaluate(()=>{
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,...args){
      if(this.transaction.db.name===PageDrafts.DATABASE)throw new DOMException('injected quota','QuotaExceededError');
      return original.call(this,value,...args);
    };
    const field=document.querySelector('#bidder-contact');
    field.value='合成输入保留';
    field.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await save.click();
  await page.waitForFunction(()=>document.querySelector('#page-save-status').textContent.includes('本机存储空间不足'));
  assert.match(await feedback.textContent(),/保存失败.*本机存储空间不足/);
  assert.equal(await feedback.isVisible(),false);
  assert.match(await body.textContent(),/本机存储空间不足/);
  await dismiss();
  assert.equal(await page.locator('#bidder-contact').inputValue(),'合成输入保留');
  await page.locator('.workspace-navigation [data-view="bidders"]').evaluate(node=>node.click());
  await page.locator('#view-bidders #bidder-save:enabled').click();
  await dialog.getByRole('heading',{name:'保存失败'}).waitFor();
  assert.match(await body.textContent(),/缺少必要资料.*事务所/);
  await dismiss();
  assert.equal(await dialog.isVisible(),false);
  assert.deepEqual(errors,[]);
});

test('material collection restores its project draft after reload and protects a real concurrent edit',async t=>{
  const {chromium}=require('playwright');
  const executablePath=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();
  if(!fs.existsSync(executablePath))return t.skip('Existing Chromium unavailable');
  const browser=await chromium.launch({headless:true,executablePath});
  t.after(()=>browser.close());
  const context=await browser.newContext(),page=await context.newPage();
  const url=pathToFileURL(path.join(D,'index.html')).href;
  await page.goto(url);
  const projectId=await page.evaluate(async()=>{
    const id=crypto.randomUUID(),now=new Date().toISOString();
    await ProjectInitiation.ensureWon({id,lastEventNo:1,events:[{eventNo:1,outcome:'won',recordedAt:now}],
      snapshot:{projectName:'合成暂存项目',issuer:'合成委托方',customerName:'合成被审计方',firmName:'合成事务所',
        auditYear:2026,quoteDate:'2026-11-28',totalCents:12000,projectType:'专项审计'}});
    return id;
  });
  async function open(tab){
    await tab.locator('[data-audit-overview]').evaluate(button=>button.click());
    await tab.locator('[data-nav-audit-step="1"]').click();
    await tab.locator('#ac-project').selectOption(projectId);
    await tab.locator('#ac-reviewer:enabled').waitFor();
  }
  async function save(tab,title){
    await tab.locator('#page-save').click();
    const dialog=tab.locator('#save-result-dialog');
    await dialog.getByRole('heading',{name:title,exact:true}).waitFor();
    const result=await dialog.locator('p').textContent();
    await dialog.getByRole('button',{name:'确定',exact:true}).click();
    return result;
  }
  await open(page);
  await page.locator('#ac-reviewer').fill('合成核对人');
  assert.equal(await page.locator('#ac-reason').count(),0);
  assert.match(await save(page,'保存成功'),/已暂存本页输入/);
  await page.reload();
  await open(page);
  await page.waitForFunction(()=>document.querySelector('#ac-reviewer').value==='合成核对人');
  assert.equal(await page.locator('#ac-reviewer').inputValue(),'合成核对人');
  await page.locator('#ac-reviewer').fill('合成核对人乙');
  assert.match(await save(page,'保存成功'),/已暂存本页输入/);
  const other=await context.newPage();
  await other.goto(url);await open(other);
  await other.waitForFunction(()=>document.querySelector('#ac-reviewer').value==='合成核对人乙');
  await other.locator('#ac-reviewer').fill('另一窗口核对人');
  assert.match(await save(other,'保存成功'),/已暂存本页输入/);
  await page.locator('#ac-reviewer').fill('本页核对人');
  assert.match(await save(page,'保存失败'),/临时草稿已被其他页面更新/);
  assert.equal(await page.locator('#ac-reviewer').inputValue(),'本页核对人');
  assert.equal(await page.evaluate(async id=>{const db=await AuditChecklist.open();try{return await db.get(id);}finally{db.close();}},projectId),null);
});
