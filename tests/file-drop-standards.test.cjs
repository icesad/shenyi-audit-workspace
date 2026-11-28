'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');

test('制度文件可拖入或选择，导出是唯一下载入口', async t=>{
  const executablePath=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();
  if(!fs.existsSync(executablePath))return t.skip('Existing browser unavailable');
  const browser=await chromium.launch({executablePath,headless:true});
  t.after(()=>browser.close());
  const page=await browser.newPage();
  const entry=process.env.SHENYI_APP_TEST_DIST||path.resolve(__dirname,'../dist');
  await page.goto(pathToFileURL(path.join(entry,'index.html')).href);
  const nav=page.locator('.nav-item[data-view=standards]');
  if(!await nav.isVisible())await page.locator('[data-nav-group=basics] > summary').click();
  await nav.click();
  const panel=page.locator('#standards-lookup'),zone=panel.getByRole('button',{name:'上传制度文件'});
  const pdf='%PDF-1.4\n%%EOF\n',word='synthetic unreadable legacy document';
  await zone.evaluate((node,files)=>{
    const transfer=new DataTransfer();
    for(const [name,content] of files)transfer.items.add(new File([content],name));
    node.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
  },[['资料甲.pdf',pdf],['资料乙.doc',word]]);
  await panel.getByText(/已保存 2 份制度文件/).waitFor();
  const exportButton=panel.getByRole('button',{name:'导出',exact:true});
  for(const [name,content] of [['资料甲.pdf',pdf],['资料乙.doc',word]]){
    if(!await panel.getByRole('listbox').isVisible())await panel.getByRole('button',{name:'展开具体准则'}).click();
    await panel.getByRole('option',{name,exact:true}).click();
    assert.equal(await panel.getByRole('button',{name:/下载制度/}).count(),0);
    const [download]=await Promise.all([page.waitForEvent('download'),exportButton.click()]);
    assert.equal(download.suggestedFilename(),name);
    assert.equal(fs.readFileSync(await download.path(),'utf8'),content);
  }
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),zone.click()]);
  assert.equal(chooser.isMultiple(),true);
  await chooser.setFiles([]);
  await panel.locator('#standards-category').selectOption('audit');
  await panel.getByRole('button',{name:'展开具体准则'}).click();
  await panel.getByRole('listbox').getByRole('option').first().click();
  const [standard]=await Promise.all([page.waitForEvent('download'),exportButton.click()]);
  assert.match(standard.suggestedFilename(),/\.pdf$/u);
  assert.equal(fs.readFileSync(await standard.path()).subarray(0,5).toString(),'%PDF-');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
});
