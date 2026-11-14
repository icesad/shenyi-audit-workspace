'use strict';
const {test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const dir=path.resolve(__dirname,'..','dist');
const ids=['f8508b52-fae7-4694-a690-08b2519b2fd9','5d0ee28d-12c3-4707-9f7c-a59618f7e703','460673ec-3d99-47e8-91ed-7b9bd03adafd'];
test('won-only local projects require explicit save, protect concurrent revision, and preserve corrected results',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('no installed Playwright');}
  const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();
  if(!fs.existsSync(executable))return t.skip('no installed Chromium');
  const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});
  try{
    const context=await browser.newContext(),errors=[],requests=[];
    context.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))requests.push(r.url());});
    async function newPage(){
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.goto(pathToFileURL(path.join(dir,'rule-catalog.js')).href);
      await page.addScriptTag({content:fs.readFileSync(path.join(dir,'project-initiation.js'),'utf8')});
      await page.evaluate(ids=>{
        const at='2026-11-07T02:30:00.000Z',name='<img src=x onerror=alert(1)>测试项目';
        globalThis.results=ids.map((id,i)=>({id,lastEventNo:i===2?0:1,events:i===2?[]:[{outcome:i===0?'won':'lost',recordedAt:at,eventNo:1}],
          snapshot:{projectName:name,issuer:'合成采购方',customerName:'合成审计单位',firmName:'合成所',auditYear:2026,quoteDate:'2026-11-05',totalCents:2350050,projectType:'财务审计'}}));
        document.body.replaceChildren();globalThis.project=ProjectInitiation.mount(document.body,{lookup:async id=>structuredClone(results.find(r=>r.id===id)),listWon:async()=>structuredClone(results)});
        globalThis.allProjects=()=>new Promise((resolve,reject)=>{
          const req=indexedDB.open('hengdu.quote.projects.v1',1);req.onerror=()=>reject(req.error);
          req.onsuccess=()=>{const db=req.result,query=db.transaction('projects').objectStore('projects').getAll();
            query.onerror=()=>{db.close();reject(query.error);};query.onsuccess=()=>{db.close();resolve(query.result);};};
        });
      },ids);
      return page;
    }
    const a=await newPage(),b=await newPage();
    assert.ok(await a.evaluate(()=>project.show()));
    assert.equal(await a.locator('[data-project-open]').count(),1);
    assert.equal(await a.locator('img').count(),0);
    for(const wrong of ids.slice(1)){
      assert.equal(await a.evaluate(id=>project.open(id),wrong),false);
      assert.match(await a.locator('#project-init-status').textContent(),/中标/);
    }
    await a.evaluate(id=>project.open(id),ids[0]);await b.evaluate(id=>project.open(id),ids[0]);
    assert.equal(await a.locator('#project-init-projectName').inputValue(),'<img src=x onerror=alert(1)>测试项目');
    assert.match(await a.locator('#project-init-source').textContent(),/¥ 23,500\.50/);
    assert.equal((await a.evaluate(()=>allProjects())).length,0);
    await a.locator('#project-init-manager').fill('合成负责人');
    await a.locator('#project-init-save').click();
    await a.waitForFunction(()=>document.querySelector('#project-init-status').textContent.includes('立项信息已保存'));
    await b.locator('#project-init-manager').fill('过期标签页');
    await b.locator('#project-init-save').click();
    await b.waitForFunction(()=>document.querySelector('#project-init-status').textContent.includes('其他页面更新'));
    const saved=await a.evaluate(()=>allProjects());
    assert.equal(saved.length,1);assert.equal(saved[0].revision,1);assert.equal(saved[0].quoteId,ids[0]);assert.equal(saved[0].form.manager,'合成负责人');
    assert.equal(await b.locator('#project-init-manager').inputValue(),'过期标签页');
    const fresh=await newPage();
    await fresh.evaluate(id=>project.open(id),ids[0]);assert.equal(await fresh.locator('#project-init-manager').inputValue(),'合成负责人');
    await fresh.evaluate(()=>{results[0].events.push({outcome:'lost',recordedAt:'2026-11-07T02:31:00.000Z',eventNo:2});results[0].lastEventNo=2;});
    await fresh.locator('#project-init-notes').fill('不可覆盖的更正');
    await fresh.locator('#project-init-save').click();
    await fresh.waitForFunction(()=>document.querySelector('#project-init-status').textContent.includes('最新结果为'));
    fresh.once('dialog',d=>d.accept());
    assert.ok(await fresh.evaluate(id=>project.open(id),ids[0]));
    assert.match(await fresh.locator('#project-init-status').textContent(),/仅展示/);
    assert.equal(await fresh.locator('#project-init-save').isEnabled(),false);
    assert.equal((await fresh.evaluate(()=>allProjects()))[0].form.notes,'');
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  }finally{await browser.close();}
});
