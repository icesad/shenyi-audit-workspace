/* Scoped real Chromium/IndexedDB tests. Synthetic records only; no dependency install. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const DIST=path.resolve(__dirname,'../dist');
const headers=['序号','项目编号','委托方名称','被审计单位名称','项目名称','项目状态','项目类型','项目金额（含税价）','项目金额（不含税价）','风险等级','项目经理指派','项目现场时间','项目底稿及报告时间','底稿编制时间','编制人','复核人','财务报表截止日期','合同模板填写','合同盖章版','开票信息','发票','是否已回款'];
test('project register has exactly twenty-two columns and scoped immutable-source integration',()=>{
 const source=fs.readFileSync(path.join(DIST,'project-register.js'),'utf8');
 assert.doesNotMatch(source,/\b(?:localStorage|sessionStorage|fetch|XMLHttpRequest)\b/);
 assert.match(source,/S\.save\(source\.quoteId,state\.workspace\.rev,\{projectRegister:value,amountCents:gross,projectInvoice:/);
 assert.match(source,/root\.ProjectContract\.uploadSigned\(source,selected,\{expectedRevision:state\.workspace\.rev\}\)/);
 assert.match(fs.readFileSync(path.join(DIST,'project-register.css'),'utf8'),/overflow-x:auto/);
});
test('real IndexedDB project register: automatic won rows, source retention, per-row metadata, CAS, and signed routing',async t=>{
 let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('Existing Playwright unavailable; no installation attempted.');}
 const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(executable))return t.skip('Existing Chromium unavailable; no installation attempted.');
 const styles=['styles.css','project-initiation.css','project-register.css'];
 const scripts=['quote-packet.js','quote-ledger.js','project-workspace-store.js','project-register.js','project-initiation.js'];
 const server=http.createServer((req,res)=>{if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});return res.end('<!doctype html><meta charset="utf-8"><title>项目登记表合成测试</title>'+styles.map(x=>'<link rel="stylesheet" href="/'+x+'">').join('')+'<main id="host"></main>'+scripts.map(x=>'<script src="/'+x+'"></script>').join(''));}const file=String(req.url).slice(1);if(!scripts.includes(file)&&!styles.includes(file)){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css;charset=utf-8':'text/javascript;charset=utf-8'});res.end(fs.readFileSync(path.join(DIST,file)));});
 await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});let browser;
 try{browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});const context=await browser.newContext(),errors=[];const url='http://127.0.0.1:'+server.address().port;
  async function page(){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.evaluate(async()=>{
   globalThis.ledger=await QuoteLedger.open();globalThis.project=ProjectInitiation.mount(document.querySelector('#host'),{lookup:async id=>{if(globalThis.waitLookup)await new Promise(ok=>{globalThis.releaseLookup=ok;});return (await ledger.get(id)).entry;},listWon:()=>ledger.list()});
   globalThis.rows=()=>[...document.querySelectorAll('[data-project-register-id]')];globalThis.workspace=id=>ProjectWorkspaceStore.get(id);
   globalThis.uploads=[];globalThis.downloads=[];globalThis.templateUploads=[];globalThis.templateDownloads=[];
   // This contract adapter uses the real project workspace store. It isolates table routing
   // from document parsing, which has separate contract-engine tests.
   globalThis.ProjectContract={uploadTemplate:async(source,file,{expectedRevision}={})=>{const r=await workspace(source.quoteId);if(expectedRevision!==r.rev)throw Error('本项目资料已变化，请刷新后重试。');templateUploads.push({id:source.quoteId,name:file.name});return ProjectWorkspaceStore.save(source.quoteId,r.rev,{contract:{name:file.name,hash:await ProjectWorkspaceStore.hash(file),blob:file}});},downloadFilled:async source=>{templateDownloads.push(source.quoteId);},uploadSigned:async(source,file,{expectedRevision}={})=>{const r=await workspace(source.quoteId);if(expectedRevision!==r.rev)throw Error('本项目资料已变化，请刷新后重试。');uploads.push({id:source.quoteId,name:file.name});return ProjectWorkspaceStore.save(source.quoteId,r.rev,{signedContract:{name:file.name,hash:await ProjectWorkspaceStore.hash(file),blob:file}});},downloadSigned:async source=>{downloads.push(source.quoteId);}};
  });return p;}
  const a=await page();const ids=await a.evaluate(async()=>{
   const sample=(name,extra={})=>({firmName:'合成事务所',customerName:'合成被审计单位',auditYear:2026,location:'广西壮族自治区',service:'年度财务决算审计',quoteDate:'2026-11-06',issuer:'合成委托方',projectName:name,projectType:'年度审计',contactName:'合成联系人',contactInfo:'synthetic-only',subtotalCents:10000,taxCents:600,totalCents:10600,taxRateText:'6%',...extra});
   const file=kind=>{const b=new Uint8Array(128).fill(32);b.set(new TextEncoder().encode('%PDF-1.4\n% SYNTHETIC\n'));b.set(new TextEncoder().encode('\n%%EOF\n'),121);return new File([b],kind+'.pdf',{type:'application/pdf'});};
   const pair=await Promise.all(['business_license','practice_certificate'].map(k=>QuotePacket.readAttachment(file(k),k)));
   const multi={quoteRows:[{name:'合成甲公司',assets:'10',revenue:'5',profit:'1',period:'2026年度',totalCents:5300},{name:'合成乙公司',assets:'20',revenue:'6',profit:'2',period:'2026年度',totalCents:5300}]};
   const one=await ledger.register(sample('<img onerror=alert(1)>合成一号',multi),pair),two=await ledger.register(sample('合成二号',{issuer:'第二委托方',customerName:'合成丙公司'}),pair),lost=await ledger.register(sample('仅未中标'),pair);
   await ledger.appendResult(one.id,{expectedEventNo:0,outcome:'won',note:'合成中标'});await ledger.appendResult(two.id,{expectedEventNo:0,outcome:'won',note:'合成中标'});await ledger.appendResult(lost.id,{expectedEventNo:0,outcome:'lost',note:'合成未中标'});
   await ProjectInitiation.ensureWon((await ledger.get(one.id)).entry);
   // Existing legacy project metadata must not be migrated or replace snapshot labels.
   const db=await new Promise((ok,no)=>{const q=indexedDB.open('hengdu.quote.projects.v1',1);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});
   await new Promise((ok,no)=>{const t=db.transaction('projects','readwrite'),s=t.objectStore('projects'),q=s.get(one.id);q.onsuccess=()=>{q.result.form.manager='旧项目负责人';q.result.form.projectName='旧立项人工名称';s.put(q.result);};t.oncomplete=ok;t.onabort=()=>no(t.error);});db.close();
   globalThis.beforeSources=JSON.stringify((await ProjectInitiation.listSaved()).map(x=>({id:x.quoteId,source:x.source,form:x.form})));globalThis.beforeLedger=JSON.stringify(await ledger.list());return [one.id,two.id,lost.id];
  });
  const row=(p,id)=>p.locator('[data-project-register-id="'+id+'"]');
  const field=(p,id,name)=>row(p,id).locator('[data-project-register-field="'+name+'"]');
  const status=(p,id)=>row(p,id).locator('[role=status]');
  await a.evaluate(()=>project.show());await a.waitForFunction(()=>rows().length===2&&rows().every(r=>!r.querySelector('[data-project-register-save]').disabled));
  for(const [width,height]of [[1440,900],[390,844]]){await a.setViewportSize({width,height});const layout=await a.evaluate(()=>{const r=document.querySelector('.pr-scroll');return {viewport:document.documentElement.clientWidth,page:document.documentElement.scrollWidth,width:r.clientWidth,scroll:r.scrollWidth,cols:document.querySelector('tr').cells.length};});assert.ok(layout.page<=layout.viewport+1,JSON.stringify(layout));assert.ok(layout.scroll>layout.width);assert.equal(layout.cols,22);if(process.env.PROJECT_REGISTER_QA_DIR){fs.mkdirSync(process.env.PROJECT_REGISTER_QA_DIR,{recursive:true});await a.screenshot({path:path.join(process.env.PROJECT_REGISTER_QA_DIR,'project-register-'+width+'.png'),fullPage:true});}}await a.setViewportSize({width:1440,height:900});
  assert.deepEqual(await a.locator('th').allTextContents(),headers);assert.equal(await a.locator('tr[data-project-register-id]').count(),2);assert.equal(await row(a,ids[2]).count(),0);assert.equal(await a.locator('img').count(),0);
  assert.equal(await row(a,ids[0]).locator('td').nth(2).textContent(),'合成委托方');assert.equal(await row(a,ids[0]).locator('td').nth(3).textContent(),'合成甲公司、合成乙公司');assert.match(await row(a,ids[0]).locator('td').nth(4).textContent(),/<img onerror=alert\(1\)>合成一号/);assert.doesNotMatch(await row(a,ids[0]).locator('td').nth(4).textContent(),/旧立项人工名称/);
  assert.equal(await field(a,ids[0],'manager').inputValue(),'旧项目负责人');for(const name of ['siteTime','workpaperReportTime','preparationTime'])assert.equal(await field(a,ids[0],name).inputValue(),'');
  assert.equal(await a.evaluate(id=>(workspace(id)).then(x=>x.projectRegister===undefined),ids[0]),true);
  await a.evaluate(()=>project.show());await a.waitForFunction(()=>rows().length===2&&rows().every(r=>!r.querySelector('[data-project-register-save]').disabled));assert.equal((await a.evaluate(()=>ProjectInitiation.listSaved())).length,2);
  const malformed=await a.evaluate(async id=>{const base={schemaVersion:1,riskLevel:'',manager:'',siteTime:'',workpaperReportTime:'',preparationTime:'',preparer:'',reviewer:'',financialStatementDate:''},values=[null,[],{...base,unknown:'x'},{...base,schemaVersion:2},{...base,manager:'x'.repeat(101)},{...base,siteTime:'x'.repeat(201)},{...base,financialStatementDate:'2026-02-30'},{...base,reviewer:'bad\u0000'}];const before=await workspace(id),out=[];for(const projectRegister of values){try{await ProjectWorkspaceStore.save(id,before.rev,{projectRegister});out.push(false);}catch{out.push(true);}}return {out,unchanged:JSON.stringify(await workspace(id))===JSON.stringify(before)};},ids[0]);assert.equal(malformed.out.every(Boolean),true);assert.equal(malformed.unchanged,true);
  const b=await page();await b.evaluate(()=>project.show());await b.waitForFunction(()=>rows().length===2&&rows().every(r=>!r.querySelector('[data-project-register-save]').disabled));
  await field(a,ids[0],'manager').fill('甲项目经理');await field(a,ids[0],'riskLevel').selectOption('A类');await row(a,ids[0]).locator('[data-project-site-preset]').selectOption('__manual__');await field(a,ids[0],'siteTime').fill('2026-11-20 至 2026-11-25');await field(a,ids[0],'financialStatementDate').fill('2026-10-31');
  a.once('dialog',d=>d.dismiss());assert.equal(await a.evaluate(()=>project.canLeave()),false);
  await a.evaluate(()=>{globalThis.waitLookup=true;globalThis.releaseLookup=null;});
  await row(a,ids[0]).locator('[data-project-register-save]').click();await a.waitForFunction(()=>!!releaseLookup);assert.equal(await a.evaluate(()=>project.canLeave()),false);await a.evaluate(()=>{waitLookup=false;releaseLookup();});await status(a,ids[0]).filter({hasText:'本行已保存'}).waitFor();
  assert.equal((await a.evaluate(id=>workspace(id),ids[0])).projectRegister.manager,'甲项目经理');assert.equal((await a.evaluate(id=>workspace(id),ids[1])).projectRegister,undefined);
  await field(b,ids[0],'manager').fill('过期标签页不得覆盖');await row(b,ids[0]).locator('[data-project-register-save]').click();await b.waitForFunction(id=>document.querySelector('[data-project-register-id="'+id+'"] [role=status]').textContent.includes('未覆盖'),ids[0]);assert.equal(await field(b,ids[0],'manager').inputValue(),'过期标签页不得覆盖');assert.equal((await b.evaluate(id=>workspace(id),ids[0])).projectRegister.manager,'甲项目经理');
  await field(a,ids[1],'manager').fill('乙项目经理');await row(a,ids[1]).locator('[data-project-register-save]').click();await status(a,ids[1]).filter({hasText:'本行已保存'}).waitFor();
  const expected=['schemaVersion','riskLevel','manager','siteTime','workpaperReportTime','preparationTime','preparer','reviewer','financialStatementDate'];assert.deepEqual(Object.keys((await a.evaluate(id=>workspace(id),ids[0])).projectRegister),expected);
  await row(a,ids[1]).locator('[data-project-signed-file]').setInputFiles({name:'第二项目盖章.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% synthetic signed original\n%%EOF')});await status(a,ids[1]).filter({hasText:'本项目盖章版原件已保存'}).waitFor();
  assert.deepEqual(await a.evaluate(()=>uploads),[{id:ids[1],name:'第二项目盖章.pdf'}]);assert.equal((await a.evaluate(id=>workspace(id),ids[0])).signedContract,undefined);assert.equal((await a.evaluate(id=>workspace(id),ids[1])).signedContract.name,'第二项目盖章.pdf');assert.equal(await row(a,ids[1]).locator('[data-project-signed-download]').count(),0);assert.deepEqual(await row(a,ids[1]).locator('td').nth(17).locator('button').allTextContents(),['上传','下载']);assert.deepEqual(await row(a,ids[1]).locator('td').nth(18).locator('button').allTextContents(),['上传']);
  await field(a,ids[1],'manager').fill('保留未存经理');await row(a,ids[1]).locator('[data-project-register-amount]').fill('212');
  await row(a,ids[1]).locator('[data-project-template-file]').setInputFiles({name:'第二项目模板.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from('synthetic template adapter routing')});await status(a,ids[1]).filter({hasText:'本项目合同模板已保存'}).waitFor();assert.equal(await field(a,ids[1],'manager').inputValue(),'保留未存经理');assert.equal(await row(a,ids[1]).locator('[data-project-register-amount]').inputValue(),'212');assert.equal((await a.evaluate(id=>workspace(id),ids[1])).projectRegister.manager,'乙项目经理');assert.deepEqual(await a.evaluate(()=>templateUploads),[{id:ids[1],name:'第二项目模板.docx'}]);
  await row(a,ids[1]).locator('[data-project-template-download]').click();await status(a,ids[1]).filter({hasText:'请先保存本行修改'}).waitFor();assert.deepEqual(await a.evaluate(()=>templateDownloads),[]);
  await row(a,ids[1]).locator('[data-project-register-save]').click();await status(a,ids[1]).filter({hasText:'本行已保存'}).waitFor();assert.equal((await a.evaluate(id=>workspace(id),ids[1])).amountCents,21200);await row(a,ids[1]).locator('[data-project-template-download]').click();await status(a,ids[1]).filter({hasText:'合同下载已完成'}).waitFor();assert.deepEqual(await a.evaluate(()=>templateDownloads),[ids[1]]);
  await field(b,ids[1],'manager').fill('旧行输入需保留');await row(b,ids[1]).locator('[data-project-template-file]').setInputFiles({name:'旧标签页不得覆盖.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from('stale')});await status(b,ids[1]).filter({hasText:'本项目资料已变化'}).waitFor();assert.equal((await a.evaluate(id=>workspace(id),ids[1])).contract.name,'第二项目模板.docx');assert.equal(await field(b,ids[1],'manager').inputValue(),'旧行输入需保留');


  assert.equal(await a.evaluate(async()=>JSON.stringify((await ledger.list()))===beforeLedger),true);
  assert.equal(await a.evaluate(async id=>{const r=(await ProjectInitiation.listSaved()).find(x=>x.quoteId===id);return JSON.stringify({id:r.quoteId,source:r.source,form:r.form})===JSON.stringify(JSON.parse(beforeSources)[0]);},ids[0]),true);
  await a.evaluate(async id=>{await ledger.appendResult(id,{expectedEventNo:1,outcome:'lost',note:'合成更正'});},ids[0]);
  // A stale visible upload is refused before the contract adapter is invoked.
  await row(a,ids[0]).locator('[data-project-signed-file]').setInputFiles({name:'不得串到历史项目.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});await a.waitForFunction(id=>document.querySelector('[data-project-register-id="'+id+'"] [role=status]').textContent.includes('中标结果或来源报价已变化'),ids[0]);assert.equal((await a.evaluate(()=>uploads)).length,1);
  await a.evaluate(()=>project.show());await a.waitForFunction(id=>document.querySelector('[data-project-register-id="'+id+'"] [role=status]').textContent.includes('历史项目'),ids[0]);assert.equal(await a.locator('tr[data-project-register-id]').count(),2);assert.equal(await row(a,ids[2]).count(),0);assert.equal(await field(a,ids[0],'manager').isDisabled(),true);assert.equal(await row(a,ids[0]).locator('[data-project-signed-upload]').isDisabled(),true);assert.equal((await a.evaluate(()=>ProjectInitiation.listSaved())).length,2);assert.deepEqual(errors,[]);
  const cutoffPage=await page();await cutoffPage.evaluate(async()=>{
   const cases=[
    {periods:['2026-10-31','2026-10-31'],expected:'2026-10-31'},
    {periods:['2026年2月28日','2026年02月28日'],expected:'2026-02-28'},
    {periods:['2026-10-31','2026年10月31日'],expected:'2026-10-31'},
    {periods:['2026年度','2026年度'],expected:''},
    {periods:['2026-10-31',''],expected:''},
    {periods:['2026-10-31','2026-11-01'],expected:''},
    {periods:['2026-02-30','2026-02-30'],expected:''},
    {periods:['0000-01-01','0000-01-01'],expected:''},
    {periods:['2024-02-29','2024-02-29'],expected:'2024-02-29'},
    {periods:['2026-10-31','2026-10-31'],saved:'',expected:''},
    {periods:['2026-10-31','2026-10-31'],saved:'2025-12-31',expected:'2025-12-31'},
    {periods:[],expected:''}
   ],records=[],entries=[];
   for(let i=0;i<cases.length;i++){const c=cases[i],id=crypto.randomUUID();if(!Object.hasOwn(c,'saved'))c.expected=new Intl.DateTimeFormat('en-CA',{year:'numeric',timeZone:'Asia/Shanghai'}).format(new Date())+'-12-31';const source={quoteId:id,wonEventNo:1,wonAt:'2026-11-07T02:30:00.000Z',projectName:'截止日合成'+i,issuer:'委托方',customerName:'被审计单位',firmName:'所',auditYear:2026,quoteDate:'2026-11-06',totalCents:100,projectType:'审计'};c.id=id;records.push({quoteId:id,source,form:{manager:''}});const {quoteId,wonEventNo,wonAt,...snapshot}=source;snapshot.quoteRows=c.periods.map((period,n)=>({name:'单位'+n,period}));entries.push({id,lastEventNo:1,events:[{eventNo:1,outcome:'won'}],snapshot});
    if(Object.hasOwn(c,'saved'))await ProjectWorkspaceStore.save(id,0,{projectRegister:{schemaVersion:1,riskLevel:'',manager:'',siteTime:'',workpaperReportTime:'',preparationTime:'',preparer:'',reviewer:'',financialStatementDate:c.saved}});
   }
   globalThis.cutoffCases=cases;globalThis.cutoffRegister=ProjectRegister.mount(document.querySelector('#host'),{records,entries,lookup:async id=>entries.find(x=>x.id===id)});
  });await cutoffPage.waitForFunction(()=>cutoffCases.every(c=>!document.querySelector('[data-project-register-id="'+c.id+'"] [data-project-register-save]').disabled));
  const cutoffs=await cutoffPage.evaluate(()=>cutoffCases.map(c=>({expected:c.expected,actual:document.querySelector('[data-project-register-id="'+c.id+'"] [name=financialStatementDate]').value})));for(const c of cutoffs)assert.equal(c.actual,c.expected);
  assert.equal(await cutoffPage.locator('[data-project-signed-file]').first().getAttribute('accept'),'.pdf,.docx,.png,.jpg,.jpeg');
  assert.equal(await cutoffPage.evaluate(async()=>{for(const c of cutoffCases)if(!Object.hasOwn(c,'saved')&&(await workspace(c.id)).projectRegister!==undefined)return false;return true;}),true);
  await context.close();
 }finally{await browser?.close();await new Promise(ok=>server.close(ok));}
});
