'use strict';
/* Independent scoped review: synthetic local data only, production files untouched. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const DIST=path.resolve(__dirname,'../dist');
async function browserCase(run){
 const {chromium}=require('playwright'),browser=await chromium.launch({headless:true,executablePath:process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath()});
 try{const page=await browser.newPage(),errors=[],remote=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});
  await page.goto(pathToFileURL(path.join(DIST,'rule-catalog.js')).href);
  for(const file of ['quote-layouts.js','bidder-archive-vendor.js','bidder-archive.js','tender-import.js','project-workspace-store.js','contract-template.js','project-contract.js'])await page.addScriptTag({content:fs.readFileSync(path.join(DIST,file),'utf8')});
  await page.evaluate(()=>{
   document.body.replaceChildren();globalThis.source={quoteId:'99111111-1111-4111-8111-111111111111',projectName:'独立合成项目',issuer:'独立合成委托方',customerName:'独立合成单位',firmName:'独立甲所',auditYear:2026,quoteDate:'2026-11-12',totalCents:10600,projectType:'财务审计'};
   globalThis.live={id:source.quoteId,snapshot:Object.fromEntries(Object.entries(source).filter(([k])=>k!=='quoteId')),events:[{outcome:'won',eventNo:1}],lastEventNo:1};
   globalThis.QuoteLedger={open:async()=>({list:async()=>[structuredClone(live)],close(){}})};
   globalThis.BidderLibrary={open:async()=>({list:async()=>[{id:'fixture-firm-a',name:'独立甲所',contactName:'甲联系人',phone:'01000000001',email:'a@example.invalid'},{id:'fixture-firm-b',name:'独立乙所',contactName:'乙联系人',phone:'01000000002',email:'b@example.invalid'}],close(){}})};
   globalThis.field=key=>[...document.querySelectorAll('.pw-contract label')].find(l=>l.firstChild?.textContent===key)?.querySelector('input');
  });
  await run(page);assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
 }finally{await browser.close();}
}
test('contract firm picker clears previous firm address, credit code and banking details',()=>browserCase(async page=>{
 await page.evaluate(async()=>{await ProjectWorkspaceStore.save(source.quoteId,0,{amountCents:10600,firm:{'事务所名称':'独立甲所','事务所地址':'甲所旧地址','事务所统一社会信用代码':'OLD-A-CODE','事务所开户银行':'甲所旧银行','事务所银行账号':'OLD-A-ACCOUNT'}});globalThis.ui=ProjectContract.mount(document.body,source);});
 await page.waitForFunction(()=>!document.querySelector('#project-final-price').disabled);
 await page.locator('.pw-contract select').selectOption('fixture-firm-b');
 const values=await page.evaluate(()=>Object.fromEntries(['事务所名称','事务所联系人','事务所地址','事务所统一社会信用代码','事务所开户银行','事务所银行账号','项目名称'].map(k=>[k,field(k).value])));
 assert.equal(values['事务所名称'],'独立乙所');assert.equal(values['事务所联系人'],'乙联系人');assert.equal(values['项目名称'],'独立合成项目');
 for(const key of ['事务所地址','事务所统一社会信用代码','事务所开户银行','事务所银行账号'])assert.equal(values[key],'',key+' must not retain another firm\'s value');
}));
test('contract refresh actually discards unsaved fields absent from the saved record',()=>browserCase(async page=>{
 await page.evaluate(()=>{globalThis.ui=ProjectContract.mount(document.body,source);});await page.waitForFunction(()=>!document.querySelector('#project-final-price').disabled);
 await page.evaluate(()=>{field('事务所名称').value='未保存错误名称';field('事务所地址').value='未保存旧地址';field('事务所地址').dispatchEvent(new Event('input',{bubbles:true}));});
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'刷新本项目合同资料',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#project-final-price').disabled);
 assert.deepEqual(await page.evaluate(()=>({name:field('事务所名称').value,address:field('事务所地址').value})),{name:'独立甲所',address:''});
 assert.equal((await page.evaluate(()=>ProjectWorkspaceStore.get(source.quoteId))).rev,0);
}));
test('contract save refuses stale won result without touching either project workspace',()=>browserCase(async page=>{
 await page.evaluate(()=>{globalThis.ui=ProjectContract.mount(document.body,source);});await page.waitForFunction(()=>!document.querySelector('#project-final-price').disabled);
 await page.locator('#project-final-price').fill('1200.00');await page.evaluate(()=>{live.events.push({outcome:'lost',eventNo:2});live.lastEventNo=2;});
 await page.getByRole('button',{name:'保存最终中标价与合同资料',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#project-contract-status').textContent.includes('中标结果或来源已变化'));
 assert.equal((await page.evaluate(()=>ProjectWorkspaceStore.get(source.quoteId))).rev,0);assert.equal((await page.evaluate(()=>ProjectWorkspaceStore.get('99222222-2222-4222-8222-222222222222'))).rev,0);
}));
test('contract textbox paragraphs are merged exactly once, without double-applying nested text',()=>browserCase(async page=>{
 const result=await page.evaluate(async()=>{
  const e=new TextEncoder(),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const parts={'[Content_Types].xml':e.encode('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),'word/document.xml':e.encode('<w:document xmlns:w="'+W+'"><w:body><w:p><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>事务所名称：____</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p></w:body></w:document>')};
  const file=new File([QuoteLayouts.packOfficeParts(parts)],'独立文本框模板.docx'),fields={'事务所名称':'独立合成会计师事务所'};
  const plan=await ContractTemplate.inspect(file,fields),made=await ContractTemplate.fill(file,fields),ps=await ProjectWorkspaceStore.parts(new File([made.bytes],'filled.docx'));
  return {fillable:plan.fillable,count:made.count,text:ProjectWorkspaceStore.xml(ps['word/document.xml']).documentElement.textContent};
 });
 assert.equal(result.fillable,1);assert.equal(result.count,1);assert.equal(result.text,'事务所名称：独立合成会计师事务所');
}));
