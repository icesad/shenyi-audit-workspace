'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom'),{pathToFileURL}=require('node:url');
const DIST=path.resolve(__dirname,'../dist'),R=require('../dist/report-workspace.js'),P='99111111-1111-4111-8111-111111111111',OTHER='99222222-2222-4222-8222-222222222222',SHA='a'.repeat(64);
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await new Promise(ok=>setTimeout(ok,0));}assert.fail('UI did not settle');}
function tbFixture({missing=false,wrongCode=false}={}){
 const dom=new JSDOM('<main id="host"></main><div id="footer"></div>',{url:'https://report-inline.example/',runScripts:'outside-only'}),w=dom.window;w.confirm=()=>false;w.structuredClone=structuredClone;let rec={id:P,rev:1,answers:{[SHA]:{'原表一':{A1:'已保存甲项目',B1:'不得覆盖公式'}}}},saved=[],called=[],downloads=[],shown=[];
 const model={sheets:['原表一','原表二'].map(name=>({name,cells:{A1:{v:'原文字'},B1:{v:6,f:'SUM(A2:A3)'},C1:{v:'原链接',l:'[source.xls]A1'}},range:{s:{r:0,c:0},e:{r:0,c:2}},merges:[]}))},layout={range:{s:{r:0,c:0},e:{r:0,c:2}},cols:[120,100,100],rows:[30],styleTable:[{}],styles:{},merges:[]},target={id:'exact9200',path:'原包/9200.xls',sha256:SHA,sheet:'原表一',kind:'excel',available:true};
 w.ProjectWorkspaceStore={get:async id=>id===P?structuredClone(rec):{id,rev:1,answers:{[SHA]:{'原表一':{A1:'已保存乙项目'}}}},save:async(id,rev,patch)=>{if(rev!==rec.rev)throw Error('CAS conflict');saved.push({id,rev,patch});rec={...rec,...structuredClone(patch),id,rev:rev+1};return rec;},download(_file,name){downloads.push(name);}};w.WorkpaperDirectory={rows:[{row:246,C:wrongCode?'8400':'9200'}]};w.WorkpaperRouting={row:()=>({code:'9200'}),resolve:()=>({targets:missing?[]:[target]})};w.WorkpaperLibrary={prepare:async()=>({files:missing?[]:[target]}),fileFor:async t=>{called.push(t);assert.equal(t.path,'原包/9200.xls');assert.equal(t.sha256,SHA);return{name:t.path,sha256:SHA,file:new w.File(['synthetic'],'9200.xls')};},layout:async()=>({sheets:{'原表一':layout,'原表二':layout}}),importFiles:async()=>{throw Error('not used');}};w.WorkpaperSheets={read:async()=>structuredClone(model),ref:(r,c)=>String.fromCharCode(65+c)+(r+1)};w.eval(fs.readFileSync(path.join(DIST,'workpaper-original-sheet.js'),'utf8'));w.eval(fs.readFileSync(path.join(DIST,'report-inline-tb.js'),'utf8'));const ctl=w.ReportInlineTB.mount(w.document.querySelector('#host'),{footer:w.document.querySelector('#footer'),onShowTable:()=>shown.push(true)});return{dom,w,ctl,saved,called,downloads,shown,getRecord:()=>rec,setRecord:next=>{rec=next;}};
}
test('inline9200 uses original sheet geometry, one sheet/page, shared answers and locked original formulas/links',async()=>{
 const f=tbFixture();try{await f.ctl.load(P);assert.equal(f.w.document.querySelectorAll('[data-original-sheet]').length,1);assert.equal(f.w.document.querySelector('[data-original-sheet]').dataset.originalSheet,'原表一');assert.match(f.w.document.querySelector('#report-tb-sheet-page').textContent,/第 1 \/ 2 张/);assert.equal(f.w.document.querySelector('[data-cell=A1]').textContent,'已保存甲项目');assert.equal(f.w.document.querySelector('[data-cell=B1]').textContent,'6');assert.equal(f.w.document.querySelector('[data-cell=B1]').dataset.locked,'true');assert.equal(f.w.document.querySelector('[data-cell=C1]').dataset.locked,'true');
  const cell=f.w.document.querySelector('[data-cell=A1]');Object.defineProperty(cell,'innerText',{value:'本项目修改',configurable:true});cell.dispatchEvent(new f.w.Event('input'));assert.equal(f.ctl.canLeave(),false);f.w.document.querySelector('#report-tb-next').click();assert.equal(f.w.document.querySelector('[data-original-sheet]').dataset.originalSheet,'原表二');f.w.document.querySelector('#report-tb-previous').click();assert.equal(f.w.document.querySelector('[data-cell=A1]').textContent,'本项目修改');f.w.document.querySelector('#report-tb-save').click();await until(()=>f.saved.length===1);assert.equal(f.saved[0].id,P);assert.equal(f.saved[0].patch.answers[SHA]['原表一'].A1,'本项目修改');assert.equal(f.saved[0].patch.answers[SHA]['原表一'].B1,undefined);assert.equal(f.ctl.canLeave(),true);assert.ok(f.called.every(t=>t.path==='原包/9200.xls'));assert.equal(f.w.document.querySelector('th'),null);
 }finally{f.ctl.destroy();f.dom.window.close();}
});
test('inline9200 switches project answers and refreshes changes saved by audit workpapers',async()=>{
 const f=tbFixture();try{
  await f.ctl.load(P);
  const edited=f.getRecord();
  f.setRecord({...edited,rev:2,answers:{[SHA]:{'原表一':{A1:'审计程序刚保存的内容'}}}});
  await f.ctl.refreshSaved();
  assert.equal(f.w.document.querySelector('[data-cell=A1]').textContent,'审计程序刚保存的内容');
  await f.ctl.load(OTHER);
  assert.equal(f.w.document.querySelector('[data-cell=A1]').textContent,'已保存乙项目');
  assert.equal(f.w.document.querySelector('#report-tb-import'),null);
 }finally{f.ctl.destroy();f.dom.window.close();}
});
test('inline9200 rejects missing source and wrong directory code without generic-grid or8400 fallback',async()=>{
 for(const opts of [{missing:true},{wrongCode:true}]){const f=tbFixture(opts);try{await f.ctl.load(P);assert.equal(f.called.length,0);assert.equal(f.w.document.querySelectorAll('[data-original-sheet]').length,0);assert.match(f.w.document.querySelector('[role=status]').textContent,opts.missing?/底稿模板缺少试算平衡表/:/试算平衡表索引不一致/);}finally{f.ctl.destroy();f.dom.window.close();}}
});
test('editable draft validation retains exact source and confirmed opening/closing numbers',()=>{
 const fileId='99333333-3333-4333-8333-333333333333',generationId='99444444-4444-4444-8444-444444444444',record={schema:2,project:{quoteId:P},revision:3,generationId,nodes:[{id:'n1',parentId:'',kind:'material',title:'上年审计报告'}],states:{n1:{status:'confirmed'}},attachments:{n1:[{id:fileId,nodeId:'n1',generationId,name:'上年.docx',sha256:SHA}]}};
 const source=R.sourceChoices(record,P)[0],handover={projectId:P,projectName:'合成项目',source,year:2026,currency:'CNY',unit:'unit',reviewer:'合成核对人',sourceConfirmed:true,dimensionsConfirmed:true,reviewConfirmed:true,rows:[{item:'资产',priorClosing:'10',currentClosing:'20',priorEvidence:'上年第2页',currentEvidence:'本项目9200!C1',confirmed:true}]},v=R.validateDraft(handover,record),draft={schemaVersion:1,projectId:P,source:{nodeId:'n1',fileId,generationId,recordRevision:3,sha256:SHA,name:'上年.docx'},handover:{year:v.year,currency:v.currency,unit:v.unit,reviewer:v.reviewer,rows:v.rows},content:R.reportText(v,'审计报告\n一、审计意见\n上年无保留意见\n2025年旧数字88888'),generatedAt:'2026-11-12T00:00:00.000Z',updatedAt:'2026-11-12T00:00:00.000Z'};
 assert.equal(R.validateReportDraft(draft,record,P),draft);assert.match(draft.content,/上年期末 10.00；本年期初 10.00；本年审定期末 20.00/);assert.doesNotMatch(draft.content,/上年无保留意见|88888/);assert.throws(()=>R.validateReportDraft(draft,{...record,revision:4},P));assert.throws(()=>R.validateReportDraft(draft,record,OTHER));assert.throws(()=>R.validateReportDraft({...draft,handover:{...draft.handover,rows:[{...v.rows[0],currentOpening:'0.00'}]}},record,P));
});
test('real browser editable report generation, per-project CAS persistence, source-proof invalidation and independent panes',async()=>{
 const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,executablePath:process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath()});try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(path.join(DIST,'rule-catalog.js')).href);for(const name of ['quote-layouts.js','bidder-archive-vendor.js','bidder-archive.js','tender-import.js','project-workspace-store.js','audit-templates.js','workpaper-original-word.js','report-workspace.js'])await page.addScriptTag({content:fs.readFileSync(path.join(DIST,name),'utf8')});
  await page.evaluate(async({P,OTHER})=>{const e=new TextEncoder(),parts={'[Content_Types].xml':e.encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),'word/document.xml':e.encode('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>审计报告</w:t></w:r></w:p><w:p><w:r><w:t>一、审计意见</w:t></w:r></w:p><w:p><w:r><w:t>2025年原文无保留意见88888</w:t></w:r></w:p></w:body></w:document>')};globalThis.blob=new Blob([QuoteLayouts.packOfficeParts(parts)],{type:ReportWorkspace.MIME});const hash=await ProjectWorkspaceStore.hash(blob),fileId='99333333-3333-4333-8333-333333333333',generationId='99444444-4444-4444-8444-444444444444';globalThis.rec={schema:2,project:{quoteId:P},revision:3,generationId,nodes:[{id:'n1',parentId:'',kind:'material',title:'上年审计报告'}],states:{n1:{status:'confirmed'}},attachments:{n1:[{id:fileId,nodeId:'n1',generationId,name:'上年合成.docx',sha256:hash,size:blob.size,type:blob.type}]}};globalThis.ProjectInitiation={listSaved:async()=>[P,OTHER].map((quoteId,i)=>({quoteId,form:{projectName:'合成项目'+i},source:{auditYear:2026}}))};globalThis.AuditChecklist={open:async()=>({get:async key=>key===P?structuredClone(rec):null,downloadAttachment:async()=>({blob,metadata:rec.attachments.n1[0]}),close(){}}),validate(){}};const library=await AuditTemplates.open();try{await library.put(new File([blob],'合成无保留意见审计报告模板.docx',{type:ReportWorkspace.MIME}));}finally{library.close();}globalThis.confirm=()=>false;document.body.replaceChildren();globalThis.mount=()=>{globalThis.controller=ReportWorkspace.mount(document.body);};mount();},{P,OTHER});
  await page.waitForFunction(()=>document.querySelector('#report-project').options.length===4);await page.locator('#report-project').selectOption(P);await page.waitForFunction(()=>document.querySelector('#report-source').options.length===2);await page.evaluate(()=>controller.selectSection('audit-report'));assert.equal(await page.locator('#report-trial-balance').isVisible(),false);assert.equal(await page.locator('#report-audit-report').isVisible(),true);await page.locator('#report-template').selectOption({label:'合成无保留意见审计报告模板.docx'});await page.locator('.rw-report-preview').getByText('2025年原文无保留意见88888',{exact:true}).waitFor();await page.locator('#report-type').selectOption('保留意见');await page.locator('#report-source').selectOption('0');await page.locator('[role=alert]').getByText(/报告类型.*模板|模板.*报告类型/).waitFor();assert.equal(await page.locator('#report-generate').isDisabled(),true);await page.locator('#report-template').selectOption('generic');await page.locator('#report-currency').selectOption('CNY');await page.locator('#report-unit').selectOption('unit');await page.locator('#report-reviewer').fill('合成核对人');for(const selector of ['#report-source-confirmed','#report-dimensions-confirmed','#report-review-confirmed'])await page.locator(selector).check();await page.locator('#report-generate').click();await page.waitForFunction(()=>document.querySelector('#report-editable-content')&&!document.querySelector('#report-editable-content').readOnly);
  const content=await page.locator('#report-editable-content').inputValue();assert.match(content,/未签发|待签发/);assert.match(content,/报告类型：保留意见/);assert.doesNotMatch(content,/原文无保留意见|88888/);assert.match(content,/本年审定数.*待人工核对填写/);await page.locator('#report-editable-content').fill(content+'\n人工修订合成内容<script>不执行</script>');await page.locator('#report-draft-save').click();await page.waitForFunction(()=>document.querySelector('#report-status').textContent.includes('草稿已保存'));const saved=await page.evaluate(id=>ProjectWorkspaceStore.get(id),P);assert.match(saved.reportDraft.content,/人工修订合成内容/);assert.equal(saved.reportDraft.handover.rows.length,0);assert.equal((await page.evaluate(id=>ProjectWorkspaceStore.get(id),OTHER)).reportDraft,undefined);assert.equal(await page.locator('script').filter({hasText:'不执行'}).count(),0);
  await page.evaluate(()=>{controller.destroy();mount();});await page.waitForFunction(()=>document.querySelector('#report-project').options.length===4);await page.locator('#report-project').selectOption(P);await page.waitForFunction(()=>!!document.querySelector('#report-editable-content'));assert.match(await page.locator('#report-editable-content').inputValue(),/人工修订合成内容/);await page.evaluate(()=>controller.selectSection('audit-report'));await page.locator('#report-editable-content').fill('源变更后不得保存');await page.evaluate(()=>{rec.revision=4;});await page.locator('#report-draft-save').click();await page.waitForFunction(()=>document.querySelector('#report-status').textContent.includes('版本已改变'));assert.match((await page.evaluate(id=>ProjectWorkspaceStore.get(id),P)).reportDraft.content,/人工修订合成内容/);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('template-based drafts distinguish key audit matters and keep native Word layout and edits after reload',async()=>{
 const {chromium}=require('playwright');
 const browser=await chromium.launch({headless:true,executablePath:process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath()});
 try{
  const page=await browser.newPage({acceptDownloads:true});
  await page.goto(pathToFileURL(path.join(DIST,'rule-catalog.js')).href);
  for(const name of ['quote-layouts.js','bidder-archive-vendor.js','bidder-archive.js','tender-import.js','project-workspace-store.js','audit-templates.js','workpaper-original-word.js','report-workspace.js'])
   await page.addScriptTag({content:fs.readFileSync(path.join(DIST,name),'utf8')});
  const templateName='合成上市实体无保留意见.docx';
  const styleXml='<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="标题"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style></w:styles>';
  await page.evaluate(async({P,templateName,styleXml})=>{
   const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
   const types='<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
   const rels='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
   const relationship='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
   const para=line=>'<w:p><w:r><w:t>'+line+'</w:t></w:r></w:p>';
   const body='<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>模板封面</w:t></w:r></w:p>'+
    '<w:tbl><w:tr><w:tc>'+para('保留模板表格')+'</w:tc></w:tr></w:tbl>'+
    para('一、审计意见')+para('我们认为，财务报表在所有重大方面公允反映了相关情况。')+
    para('三、关键审计事项')+para('我们不对这些事项单独发表意见。')+
    '<w:p><w:fldSimple w:instr="INCLUDETEXT &quot;https://invalid.example/active&quot;"><w:r><w:t>静态结果</w:t></w:r></w:fldSimple></w:p>'+
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="853"/></w:sectPr>';
   const pkg=fragment=>({'[Content_Types].xml':types,'_rels/.rels':rels+'<Relationship Id="rId1" Type="'+relationship+'/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml':'<w:document xmlns:w="'+w+'"><w:body>'+fragment+'</w:body></w:document>'});
   const parts={...pkg(body),'word/styles.xml':styleXml,
    'word/_rels/document.xml.rels':rels+'<Relationship Id="style" Type="'+relationship+'/styles" Target="styles.xml"/><Relationship Id="external" Type="'+relationship+'/image" TargetMode="External" Target="https://invalid.example/active"/></Relationships>'};
   const original=new File([QuoteLayouts.packOfficeParts(parts)],templateName,{type:ReportWorkspace.MIME});
   const prior=new File([QuoteLayouts.packOfficeParts(pkg(para('上一年度的意见不得套用')))],'上年报告.docx',{type:ReportWorkspace.MIME});
   const generationId='99444444-4444-4444-8444-444444444444';
   const attachment={id:'99333333-3333-4333-8333-333333333333',nodeId:'n1',generationId,name:prior.name,sha256:await ProjectWorkspaceStore.hash(prior)};
   const rec={schema:2,project:{quoteId:P},revision:3,generationId,nodes:[{id:'n1',parentId:'',kind:'material',title:'上年审计报告'}],states:{n1:{status:'confirmed'}},attachments:{n1:[attachment]}};
   globalThis.ProjectInitiation={listSaved:async()=>[{quoteId:P,form:{projectName:'合成项目'},source:{auditYear:2026}}]};
   globalThis.AuditChecklist={open:async()=>({get:async()=>rec,downloadAttachment:async()=>({blob:prior,metadata:attachment}),close(){}})};
   const library=await AuditTemplates.open();try{await library.put(original);}finally{library.close();}
   document.body.replaceChildren();
   globalThis.mountReport=()=>{globalThis.controller=ReportWorkspace.mount(document.body);controller.selectSection('audit-report');};
   mountReport();
  },{P,templateName,styleXml});
  await page.locator('#report-project').selectOption(P);
  await page.locator('#report-source').selectOption('0');
  await page.locator('#report-type').selectOption('标准无保留意见');
  await page.locator('#report-template').selectOption({label:templateName});
  await page.locator('.rw-report-preview').getByText('模板封面',{exact:true}).waitFor();
  assert.equal(await page.locator('#report-generate').isEnabled(),true);
  await page.locator('#report-type').selectOption('无法表示意见');
  await page.locator('.rw-report-preview [role=alert]').getByText(/不一致/).waitFor();
  await page.locator('#report-type').selectOption('标准无保留意见');
  await page.locator('.rw-report-preview').getByText('模板封面',{exact:true}).waitFor();
  await page.locator('#report-currency').selectOption('CNY');
  await page.locator('#report-unit').selectOption('unit');
  await page.locator('#report-reviewer').fill('合成核对人');
  for(const selector of ['#report-source-confirmed','#report-dimensions-confirmed','#report-review-confirmed'])
   await page.locator(selector).check();
  await page.locator('#report-generate').click();
  const editor=page.locator('#report-editable-content');
  await editor.waitFor();
  const draft=await editor.inputValue();
  assert.match(draft,/模板封面/);
  assert.doesNotMatch(draft,/上一年度的意见/);
  await editor.fill(draft.replace('模板封面','本次报告封面')+'\n追加本次说明');
  await page.locator('#report-draft-save').click();
  await page.locator('#report-status').getByText(/草稿已保存/).waitFor();
  await page.evaluate(()=>{controller.destroy();mountReport();});
  await page.locator('#report-project').selectOption(P);
  await editor.waitFor();
  assert.match(await editor.inputValue(),/本次报告封面/);
  const fromEditor=page.waitForEvent('download');
  await page.getByRole('button',{name:'下载报告',exact:true}).click();
  const savedWord=fs.readFileSync(await (await fromEditor).path());
  const fromWorkflow=page.waitForEvent('download');
  await page.evaluate(id=>ReportWorkspace.downloadSavedDraft(id),P);
  assert.deepEqual(fs.readFileSync(await (await fromWorkflow).path()),savedWord);
  await editor.fill('未保存的替换文字');
  await page.evaluate(()=>{globalThis.confirm=()=>false;});
  await page.getByRole('button',{name:'刷新报告',exact:true}).click();
  assert.equal(await editor.inputValue(),'未保存的替换文字');
  await page.evaluate(()=>{globalThis.confirm=()=>true;});
  await page.getByRole('button',{name:'刷新报告',exact:true}).click();
  await page.getByText('已刷新本项目报告和来源资料。',{exact:true}).waitFor();
  assert.match(await editor.inputValue(),/本次报告封面/);
  assert.equal(await page.locator('#report-audit-report').isVisible(),true);
  const parts=await page.evaluate(async bytes=>{
   const saved=await ProjectWorkspaceStore.parts(new File([Uint8Array.from(bytes)],'saved.docx'));
   return Object.fromEntries(Object.entries(saved).map(([name,data])=>[name,new TextDecoder().decode(data)]));
  },[...savedWord]);
  assert.equal(parts['word/styles.xml'],styleXml);
  assert.match(parts['word/document.xml'],/本次报告封面.*保留模板表格.*追加本次说明.*w:left="853"/);
  assert.match(parts['word/document.xml'],/未签发/);
  assert.doesNotMatch(parts['word/document.xml'],/INCLUDETEXT|上一年度的意见/);
  assert.doesNotMatch(parts['word/_rels/document.xml.rels'],/https:\/\/invalid\.example/);
 }finally{await browser.close();}
});

test('footer mirrors 9200 navigation and save while the 9200 toolbar keeps its own download and refresh',async()=>{
 const f=tbFixture();try{
  await f.ctl.load(P);
  const buttons=Object.fromEntries([...f.w.document.querySelectorAll('[data-report-tb-footer]')].map(item=>[item.dataset.reportTbFooter,item]));
  assert.deepEqual(Object.values(buttons).map(b=>b.textContent),['上一张表','下一张表','保存本表填写']);
  assert.ok(buttons.previous.disabled);
  buttons.next.click();
  assert.equal(f.w.document.querySelector('[data-original-sheet]').dataset.originalSheet,'原表二');
  assert.ok(buttons.next.disabled);
  buttons.previous.click();
  assert.equal(f.w.document.querySelector('[data-original-sheet]').dataset.originalSheet,'原表一');
  buttons.save.click();
  await until(()=>f.saved.length===1&&!buttons.save.disabled);
  const toolbar=[...f.w.document.querySelectorAll('#host .rw-tb-toolbar button')];
  toolbar.find(b=>b.textContent==='下载原件').click();
  assert.deepEqual(f.downloads,['9200.xls']);
  const current=f.getRecord();
  f.setRecord({...current,rev:current.rev+1,answers:{[SHA]:{'原表一':{A1:'刷新后的已保存数据'}}}});
  toolbar.find(b=>b.textContent==='刷新试算平衡表').click();
  await until(()=>f.w.document.querySelector('[data-cell=A1]')?.textContent==='刷新后的已保存数据');
  assert.equal(f.shown.length,3);
 }finally{f.ctl.destroy();f.dom.window.close();}
});
