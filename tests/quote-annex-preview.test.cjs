'use strict';
const {test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const dir=path.resolve(__dirname,'..','dist');
test('both certificate PDFs open by default and stay open while additional attachments are previewed',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('no installed Playwright');}
  const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(executable))return t.skip('no installed Chromium');
  const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});
  try{
    const context=await browser.newContext({acceptDownloads:true}),remote=[],errors=[];
    context.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))remote.push(r.url());});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(dir,'rule-catalog.js')).href);
    for(const n of ['vendor-bidder-pdf.js','vendor-quote-pdf-lib.js','quote-annex-preview.js'])await page.addScriptTag({content:fs.readFileSync(path.join(dir,n),'utf8')});
    await page.addStyleTag({content:fs.readFileSync(path.join(dir,'quote-annex-preview.css'),'utf8')});
    await page.evaluate(async()=>{
      document.body.replaceChildren();
      const _revoke=URL.revokeObjectURL;globalThis.revoked=[];
      URL.revokeObjectURL=url=>{revoked.push(url);_revoke(url);};
      const pdf=await PDFLib.PDFDocument.create();
      const c1=pdf.addPage([200,280]),c2=pdf.addPage([200,280]);
      c1.drawRectangle({x:0,y:0,width:200,height:280,color:PDFLib.rgb(1,0,0)});
      c2.drawRectangle({x:0,y:0,width:200,height:280,color:PDFLib.rgb(0,0,1)});
      const bytes=await pdf.save(),c=document.createElement('canvas');c.width=30;c.height=20;c.getContext('2d').fillRect(0,0,30,20);
      const license=await PDFLib.PDFDocument.create();
      license.addPage([280,200]).drawRectangle({x:0,y:0,width:280,height:200,color:PDFLib.rgb(0,1,0)});
      const licenseBytes=await license.save();
      globalThis.printCertificateCalls=0;
      const pngBytes=new Uint8Array(await(await new Promise(resolve=>c.toBlob(resolve,'image/png'))).arrayBuffer());
      globalThis.cleanupPreview=QuoteAnnexPreview.mount(document.body,{
        pair:[{kind:'practice_certificate',name:'synthetic-practice.pdf',mime:'application/pdf',bytes},{kind:'business_license',name:'synthetic-business.pdf',mime:'application/pdf',bytes:licenseBytes}],
        extras:[
          {kind:'extra',name:'<fake>.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:Uint8Array.of(80,75,3,4,0)},
          {kind:'extra',name:'unreadable.pdf',mime:'application/pdf',bytes:new TextEncoder().encode('%PDF-1.7 invalid')},
          {kind:'extra',name:'synthetic-extra.pdf',mime:'application/pdf',bytes},
          {kind:'extra',name:'synthetic-extra.png',mime:'image/png',bytes:pngBytes}
        ],
        onPrintCertificates:()=>{printCertificateCalls++;}
      });
      globalThis.imageUrl=document.querySelector('.qa-img').src;
    });
    assert.deepEqual(await page.locator('.qa-card h4').allTextContents(),['营业执照','执业证书','附加附件 1','附加附件 2','附加附件 3','附加附件 4']);
    assert.match(await page.locator('.qa-card').nth(2).textContent(),/<fake>\.docx.*Word \/ Excel/);
    assert.equal(await page.locator('fake, iframe, embed, object').count(),0);
    assert.deepEqual(await page.locator('.qa-img').evaluate(async img=>{await img.decode();return [img.naturalWidth,img.naturalHeight];}),[30,20]);
    const lic=page.locator('.qa-card[data-annex-kind=business_license]');
    const prac=page.locator('.qa-card[data-annex-kind=practice_certificate]');
    assert.equal(await page.locator('.qa-card[data-annex-kind=extra] details[open]').count(),0);
    const pixel=card=>card.locator('canvas').evaluate(c=>[...c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data]);
    await Promise.all([lic.getByText('第 1 / 1 页',{exact:true}).waitFor(),prac.getByText('第 1 / 2 页',{exact:true}).waitFor()]);
    assert.equal(await lic.locator('details[open]').count(),1);
    assert.equal(await prac.locator('details[open]').count(),1);
    assert.deepEqual(await pixel(lic),[0,255,0,255]);
    assert.deepEqual(await pixel(prac),[255,0,0,255]);
    await prac.getByRole('button',{name:'下一页'}).click();
    await prac.getByText('第 2 / 2 页',{exact:true}).waitFor();assert.deepEqual(await pixel(prac),[0,0,255,255]);
    assert.deepEqual(await pixel(lic),[0,255,0,255]);
    const bad=page.locator('.qa-card').nth(3),extra=page.locator('.qa-card').nth(4);
    await extra.locator('summary').click();await extra.getByText('第 1 / 2 页',{exact:true}).waitFor();
    assert.deepEqual(await pixel(extra),[255,0,0,255]);
    await bad.locator('summary').click();await bad.getByText(/无法在浏览器预览/).waitFor();
    await extra.locator('canvas').waitFor({state:'detached'});assert.equal(await extra.locator('details[open]').count(),0);
    assert.equal(await lic.locator('details[open]').count(),1);
    assert.equal(await prac.locator('details[open]').count(),1);
    assert.deepEqual(await pixel(lic),[0,255,0,255]);assert.deepEqual(await pixel(prac),[0,0,255,255]);
    await page.locator('#quote-print-certificates').click();
    assert.equal(await page.evaluate(()=>printCertificateCalls),1);
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'下载附加附件 1原件'}).click()]);
    assert.deepEqual(fs.readFileSync(await download.path()),Buffer.from([80,75,3,4,0]));
    assert.equal(await page.evaluate(()=>{cleanupPreview();cleanupPreview();return revoked.includes(imageUrl)&&!document.querySelector('.qa-annex');}),true);
    assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
