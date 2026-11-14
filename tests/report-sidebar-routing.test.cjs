/* Report sidebar regression. No hosted credentials or live business data; synthetic local drafts only. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const DIST=path.resolve(__dirname,'../dist'),EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const TRIAL='00000000-0000-4000-8000-000000000033';
async function fixture(t){
 let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('Existing Playwright unavailable');}
 const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||(fs.existsSync(EDGE)?EDGE:chromium.executablePath());if(!fs.existsSync(executable))return t.skip('Existing browser unavailable');
 const browser=await chromium.launch({headless:true,executablePath:executable}),context=await browser.newContext({viewport:{width:1440,height:1000},offline:true}),page=await context.newPage(),errors=[],remote=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});page.on('dialog',d=>d.dismiss());
 t.after(async()=>{await browser.close();assert.deepEqual(errors,[],'no app runtime errors');assert.deepEqual(remote,[],'no remote business data requests');});
 await page.goto(pathToFileURL(path.join(DIST,'index.html')).href,{waitUntil:'load'});return{page,context};
}
const link=(p,section)=>p.locator('.workspace-navigation [data-report-section="'+section+'"]');
async function assertPane(p,section){
 assert.equal(await p.locator('#view-report').isVisible(),true);
 assert.equal(await p.locator('#report-trial-balance').isVisible(),section==='trial-balance');
 assert.equal(await p.locator('#report-audit-report').isVisible(),section==='audit-report');
 assert.equal(await link(p,section).getAttribute('aria-current'),'page');
 assert.equal(await link(p,section==='audit-report'?'trial-balance':'audit-report').getAttribute('aria-current'),null);
 assert.equal(await p.locator('.view:visible').count(),1);
 assert.equal(await p.locator('#report-pane-audit').count(),0,'only the in-page report button was removed, not the sidebar entry');
 assert.equal(await p.locator('#report-pane-tb').isVisible(),section==='trial-balance','audit-report page must not show the in-page 9200 button');
 assert.equal(await link(p,'trial-balance').count(),1,'sidebar 9200 entry remains available');
}
test('real app report sidebar opens its exact pane and retains selected project when switching audit report and 9200',async t=>{
 const f=await fixture(t);if(!f)return;const p=f.page;
 await link(p,'audit-report').click();await p.waitForFunction(()=>document.querySelector('#report-project')?.options.length>=2);await assertPane(p,'audit-report');
 assert.match(await p.locator('#report-audit-report h3').first().textContent(),/审计报告/);
 for(const id of ['rc-currentTB','rc-priorReport','rc-priorTB','rc-workpapers'])assert.equal(await p.locator('#'+id).isVisible(),true,'four-source report field '+id);
 assert.match(await p.locator('#report-audit-report').textContent(),/本年TB/);assert.match(await p.locator('#report-audit-report').textContent(),/以前年度审计报告/);assert.match(await p.locator('#report-audit-report').textContent(),/以前年度TB/);assert.match(await p.locator('#report-audit-report').textContent(),/本次审计工作底稿/);
 assert.equal(await p.locator('#report-project').inputValue(),'','no implicit project selection');
 await p.locator('#report-project').selectOption(TRIAL);await p.waitForFunction(id=>document.querySelector('#report-project').value===id,TRIAL);
 for(const section of ['trial-balance','audit-report','trial-balance','audit-report']){
  await link(p,section).click();await assertPane(p,section);assert.equal(await p.locator('#report-project').inputValue(),TRIAL);
 }
 const out=process.env.REPORT_SIDEBAR_QA_DIR;if(out){fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,'audit-sidebar-exact-pane.png'),fullPage:true});}
 await p.setViewportSize({width:390,height:844});for(const section of ['trial-balance','audit-report']){await link(p,section).click();await assertPane(p,section);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
});
test('report sidebar transitions neither reset nor resubmit saved quotation inputs',async t=>{
 const f=await fixture(t);if(!f)return;const p=f.page;
 await p.locator('.workspace-navigation [data-view="quote"]').click();await p.locator('#client-form [name=clientName]').fill('合成报告侧栏留存测试');await p.locator('#proposal-form [name=issuer]').fill('合成发标单位');
 await p.locator('.workspace-navigation [data-view="proposal"]').click();await p.locator('#quote-form [name=manual]').fill('42888.35');await p.locator('#quote-form [name=pricePercent]').fill('70');
 await p.locator('#page-save').click();await p.waitForFunction(()=>document.querySelector('#page-save-status').textContent.startsWith('已暂存'));
 for(const section of ['audit-report','trial-balance','audit-report']){await link(p,section).click();await assertPane(p,section);}
 await p.locator('.workspace-navigation [data-view="proposal"]').click();assert.equal(await p.locator('#quote-form [name=manual]').inputValue(),'42888.35');assert.equal(await p.locator('#quote-form [name=pricePercent]').inputValue(),'70');
 await p.reload();await p.waitForFunction(()=>document.querySelector('#client-form [name=clientName]').value==='合成报告侧栏留存测试');
 assert.equal(await p.locator('#quote-form [name=manual]').inputValue(),'42888.35');assert.equal(await p.locator('#quote-form [name=pricePercent]').inputValue(),'70');
 assert.equal(await p.evaluate(async()=>{const db=await QuoteLedger.open();try{return(await db.list()).length;}finally{db.close();}}),0,'report navigation is not a quotation registration');
});

// Read downloaded OOXML directly, so this acceptance check cannot pass on a renamed text file.
function zipPart(bytes,name){
 let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 assert.ok(eocd>=0,'valid ZIP end record');let cursor=bytes.readUInt32LE(eocd+16);const count=bytes.readUInt16LE(eocd+10);
 for(let i=0;i<count;i++){assert.equal(bytes.readUInt32LE(cursor),0x02014b50);const method=bytes.readUInt16LE(cursor+10),size=bytes.readUInt32LE(cursor+20),nameLength=bytes.readUInt16LE(cursor+28),extraLength=bytes.readUInt16LE(cursor+30),commentLength=bytes.readUInt16LE(cursor+32),offset=bytes.readUInt32LE(cursor+42),entry=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8');if(entry===name){assert.equal(bytes.readUInt32LE(offset),0x04034b50);const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28),data=bytes.subarray(start,start+size);assert.ok([0,8].includes(method),'supported standard ZIP compression');return method===8?require('node:zlib').inflateRawSync(data):data;}cursor+=46+nameLength+extraLength+commentLength;}
 assert.fail('OOXML missing part '+name);
}
test('real four-source report UI creates editable draft and downloads edited content as genuine Word; sources remain unchanged',async t=>{
 const f=await fixture(t);if(!f)return;const p=f.page,P='99111111-1111-4111-8111-111111111111';
 await p.evaluate(P=>{
  const SHA='a'.repeat(64),workspace={id:P,rev:0},choice=(id,c,name)=>({id,sha256:c.repeat(64),name,label:name,kind:id==='report'?'word':'excel',projectId:P,version:1});
  const choices={currentTB:[choice('current','b','本年TB.xlsx')],priorTB:[choice('prior','c','上年TB.xlsx')],priorReport:[choice('report','d','上年审计报告.docx')]};
  const sheet=value=>[{name:'审定TB',cells:{A1:{v:'科目名称'},B1:{v:'审定期末'},A2:{v:'货币资金'},B2:{v:value}},visibility:0}];
  window.__reportSourceSnapshot=JSON.stringify({choices,current:sheet(200),prior:sheet(100)});window.__reportWorkspace=workspace;window.__evidenceCalls=[];
  const S=ProjectWorkspaceStore;window.ProjectWorkspaceStore={...S,get:async id=>{if(id!==P)throw Error('wrong synthetic project');return structuredClone(window.__reportWorkspace);},save:async(id,expected,patch)=>{if(id!==P||expected!==window.__reportWorkspace.rev)throw Error('synthetic CAS mismatch');window.__reportWorkspace={...window.__reportWorkspace,...structuredClone(patch),rev:expected+1};return structuredClone(window.__reportWorkspace);}};
  window.ProjectInitiation={...ProjectInitiation,listSaved:async()=>[{quoteId:P,source:{auditYear:2026,customerName:'合成报告验收单位'},form:{projectName:'合成2026年度报告项目'}}]};
  window.ReportEvidence={load:async id=>{if(id!==P)throw Error('wrong evidence project');return{projectId:P,workspace:structuredClone(window.__reportWorkspace),choices:structuredClone(choices),workpapers:{projectId:P,id:'workpapers',sha256:SHA,version:1,verified:true,fresh:true,name:'本项目已保存审计底稿',summary:{total:1,completed:1,issues:[],conclusions:[{index:'3100',title:'货币资金',text:'合成函证核对记录',confirmed:true}]}},fingerprint:SHA};},assertFresh:async loaded=>{if(loaded.projectId!==P||loaded.fingerprint!==SHA)throw Error('stale synthetic evidence');return{...loaded,workspace:structuredClone(window.__reportWorkspace)};},read:async(loaded,c,{role})=>{if(loaded.projectId!==P||c.projectId!==P)throw Error('foreign source');window.__evidenceCalls.push(role);return{...structuredClone(c),verified:true,fresh:true,year:role==='currentTB'?2026:2025,...(c.id==='report'?{text:'一、财务报表附注\n我们认为旧意见不应复制'}:{sheets:sheet(c.id==='current'?200:100)})};}};
  window.__reportInputsAfter=()=>JSON.stringify({choices,current:sheet(200),prior:sheet(100)});
 },P);
 await link(p,'audit-report').click();await p.waitForFunction(P=>[...document.querySelector('#report-project').options].some(o=>o.value===P),P);await p.locator('#report-project').selectOption(P);
 await p.waitForFunction(()=>document.querySelector('#rc-workpapers')?.textContent.includes('已保存填写 1'));await assertPane(p,'audit-report');
 assert.equal(await p.locator('#rc-currentTB').inputValue(),'current');assert.equal(await p.locator('#rc-priorTB').inputValue(),'prior');assert.equal(await p.locator('#rc-priorReport').inputValue(),'report');
 await p.locator('#rc-currency').selectOption('CNY');await p.locator('#rc-unit').selectOption('unit');await p.locator('#rc-read').click();await p.waitForSelector('[data-rc-field=confirmed]');
 assert.equal(await p.locator('[data-rc-field=priorClosing]').inputValue(),'100.00');assert.equal(await p.locator('[data-rc-field=currentClosing]').inputValue(),'200.00');
 await p.locator('[aria-label="报表归属 1"]').selectOption('balance-sheet');await p.locator('[data-rc-field=confirmed]').check();await p.locator('#rc-confirm').check();await p.locator('#rc-generate').click();await p.locator('#rc-editor').waitFor({state:'visible'});
 const content=await p.locator('#rc-editor').inputValue();assert.match(content,/货币资金 \| 100\.00 \| 100\.00 \| 200\.00/);assert.match(content,/合成函证核对记录/);assert.doesNotMatch(content,/我们认为旧意见不应复制/);
 await p.locator('#rc-editor').fill(content+'\n人工复核修订：现金及银行存款对应关系已确认。');await p.locator('#rc-save').click();await p.waitForFunction(()=>!document.getElementById('rc-save').disabled);assert.equal(await p.evaluate(()=>window.__reportWorkspace.reportCompilation?.content.includes('人工复核修订')||false),true,await p.locator('#report-audit-report .rw-status').textContent());
 const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#rc-download').click()]);assert.match(download.suggestedFilename(),/\.docx$/);const downloaded=fs.readFileSync(await download.path());
 assert.equal(downloaded.readUInt32LE(0),0x04034b50);assert.match(zipPart(downloaded,'[Content_Types].xml').toString('utf8'),/wordprocessingml/);const documentXml=zipPart(downloaded,'word/document.xml').toString('utf8');assert.match(documentXml,/人工复核修订：现金及银行存款对应关系已确认/);assert.match(documentXml,/货币资金 \| 100\.00 \| 100\.00 \| 200\.00/);assert.doesNotMatch(documentXml,/我们认为旧意见不应复制/);
 assert.equal(await p.evaluate(()=>window.__reportInputsAfter()===window.__reportSourceSnapshot),true,'source models and original numeric values unchanged');assert.deepEqual(await p.evaluate(()=>window.__evidenceCalls),['currentTB','priorReport','priorTB']);
 const out=process.env.REPORT_SIDEBAR_QA_DIR;if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'synthetic-four-source-edited-report.docx'),downloaded);await p.screenshot({path:path.join(out,'audit-four-source-generated.png'),fullPage:true});}
});
