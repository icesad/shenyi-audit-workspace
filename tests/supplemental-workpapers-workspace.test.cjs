'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const dist=path.resolve(__dirname,'../dist'),P='00000000-0000-4000-8000-000000000033',OTHER='11111111-1111-4111-8111-111111111111';

test('actual WorkpaperWorkspace stage9 guards unsaved supplements once, saves real IndexedDB and reloads unchanged originals',async t=>{
 let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('existing Playwright unavailable');}
 if(!fs.existsSync(chromium.executablePath()))return t.skip('existing Chromium unavailable');
 const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true}),page=await browser.newPage({viewport:{width:1280,height:900},acceptDownloads:true}),errors=[],remote=[];
 const out=process.env.V56_SUPPLEMENTAL_QA_DIR?path.resolve(process.env.V56_SUPPLEMENTAL_QA_DIR,'supplemental-workspace-'+Date.now()):null;if(out)fs.mkdirSync(out,{recursive:true});
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});
 try{
  await page.goto(pathToFileURL(path.join(dist,'workpaper-routing.js')).href);
  for(const name of ['project-workspace-store.js','workpaper-directory.js','workpaper-route-catalog.js','workpaper-routing.js','supplemental-workpapers.js','workpaper-stages.js','workpaper-workspace.js'])await page.addScriptTag({content:fs.readFileSync(path.join(dist,name),'utf8')});
  await page.addStyleTag({content:fs.readFileSync(path.join(dist,'supplemental-workpapers.css'),'utf8')});
  await page.evaluate(({id,other})=>{
   document.body.innerHTML='<main id="workspace"><p id="collection-fixture">资料收集合成测试入口</p></main>';
   globalThis.AuditChecklist=Object.freeze({TRIAL_ID:id});
   // Only the formal-project picker is a synthetic fixture. The workspace, module and IndexedDB store are production code.
   globalThis.ProjectInitiation={listSaved:async()=>[{quoteId:other,form:{projectName:'另一个合成项目'}}]};
   globalThis.__confirmCalls=[];globalThis.confirm=message=>{__confirmCalls.push(message);return false;};
   globalThis.__workspace=WorkpaperWorkspace.mount(document.getElementById('workspace'));
  },{id:P,other:OTHER});
  await page.waitForFunction(()=>document.querySelector('#pw-project').options.length===3);
  await page.locator('[data-audit-step="9"]').click();
  await page.waitForFunction(()=>document.querySelector('#pw-status').textContent.includes('请先选择项目'));
  await page.locator('#pw-project').selectOption(P);
  await page.waitForSelector('#supplemental-add');
  assert.deepEqual(await page.locator('.swp-root th').allTextContents(),['科目编码','科目名称','上传底稿']);
  assert.equal(await page.locator('#pw-archive').count(),0);
  assert.equal(await page.locator('[data-audit-step="9"]').getAttribute('aria-pressed'),'true');
  await page.locator('#supplemental-add').click();
  await page.locator('[data-supplemental-code]').fill('4100');await page.locator('[data-supplemental-code]').press('Tab');
  assert.equal(await page.locator('[data-supplemental-name]').inputValue(),'货币资金');
  const content=Buffer.from('SYNTHETIC workspace original attachment; bytes stay local and unchanged');
  await page.locator('[data-supplemental-upload]').setInputFiles({name:'工作区补充底稿.bin',mimeType:'application/octet-stream',buffer:content});
  await page.waitForFunction(()=>document.querySelector('#supplemental-status').textContent.includes('草稿')&&!document.querySelector('.swp-root').inert);
  assert.equal((await page.evaluate(id=>ProjectWorkspaceStore.get(id),P)).rev,0);
  await page.locator('[data-audit-step="1"]').click();
  assert.equal(await page.locator('[data-audit-step="9"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#supplemental-add').count(),1);
  assert.equal(await page.evaluate(()=>__confirmCalls.length),1,'parent guard delegates once without recursive prompts');
  await page.locator('#pw-project').selectOption(OTHER);
  assert.equal(await page.locator('#pw-project').inputValue(),P);
  assert.equal(await page.locator('[data-supplemental-name]').inputValue(),'货币资金');
  assert.equal(await page.evaluate(()=>__confirmCalls.length),2);
  await page.locator('#supplemental-save').click();
  await page.waitForFunction(()=>document.querySelector('#supplemental-status').textContent.includes('已保存本项目 1')&&!document.querySelector('.swp-root').inert);
  const saved=await page.evaluate(async id=>{const r=await ProjectWorkspaceStore.get(id),x=r.supplementalWorkpapers[0];return{rev:r.rev,code:x.subjectCode,name:x.subjectName,hash:x.file.sha256,actual:await ProjectWorkspaceStore.hash(x.file.blob),bytes:Array.from(new Uint8Array(await x.file.blob.arrayBuffer()))};},P);
  assert.equal(saved.rev,1);assert.equal(saved.code,'4100');assert.equal(saved.name,'货币资金');assert.equal(saved.hash,crypto.createHash('sha256').update(content).digest('hex'));assert.equal(saved.actual,saved.hash);assert.deepEqual(Buffer.from(saved.bytes),content);
  assert.equal(await page.evaluate(()=>__workspace.canLeave()),true);
  assert.equal(await page.evaluate(()=>__confirmCalls.length),2,'saved list leaves without another confirmation');
  await page.locator('[data-audit-step="1"]').click();
  assert.equal(await page.locator('[data-audit-step="1"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#supplemental-add').count(),0);
  await page.locator('[data-audit-step="9"]').click();await page.waitForSelector('[data-supplemental-download]');
  assert.equal(await page.locator('[data-supplemental-code]').inputValue(),'4100');
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-supplemental-download]').click()]);const stream=await download.createReadStream(),parts=[];for await(const chunk of stream)parts.push(chunk);assert.deepEqual(Buffer.concat(parts),content);
  await page.waitForFunction(()=>!document.querySelector('.swp-root').inert);
  await page.locator('#pw-project').selectOption(OTHER);await page.waitForFunction(()=>document.querySelector('.swp-root')&&document.querySelector('.swp-root tbody input')===null);
  assert.equal((await page.evaluate(id=>ProjectWorkspaceStore.get(id),OTHER)).rev,0);
  assert.equal(await page.locator('[data-supplemental-code]').count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  if(out){await page.screenshot({path:path.join(out,'workspace-stage9.png'),fullPage:true});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,actualWorkpaperWorkspace:true,realIndexedDB:true,exactThreeColumns:true,noGuardRecursion:true,unsavedLeaveBlocked:true,projectIsolation:true,rawBytesPreserved:true,errors,remote,scope:'synthetic file-origin UI integration, not business acceptance'},null,2));}
 }finally{await browser.close();}
});
