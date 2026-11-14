'use strict';
const {test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const dir=path.resolve(__dirname,'..','dist');
test('locally confirmed attachment copies: visual image, three PDF XObjects, exact selected page and refusal gates',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('no installed Playwright');}
  const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(executable))return t.skip('no installed Chromium');
  const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});
  try{
    const context=await browser.newContext();const remote=[],errors=[];context.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(path.join(dir,'rule-catalog.js')).href);
    for(const n of ['quote-packet.js','bidder-library.js','vendor-quote-pdf-lib.js','quote-attachment-stamps.js'])await page.addScriptTag({content:fs.readFileSync(path.join(dir,n),'utf8')});
    const result=await page.evaluate(async()=>{
      const Q=QuotePacket,L=PDFLib,S=QuoteAttachmentStamps,kinds=S.KINDS,extras=(b,n,m)=>Q.readExtra(new File([b],n,{type:m})),same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
      const expect=(ok,msg)=>{if(!ok)throw Error(msg);};
      const bad=async(fn,re)=>{try{await fn();}catch(e){return re.test(e.message);}return false;};
      const canvasBlob=(w,h,color,mime='image/png')=>new Promise((resolve,reject)=>{
        const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,w,h);c.toBlob(x=>x?resolve(x):reject(Error('fixture failed')),mime,1);
      });
      const colors=['#ca211d','#186652','#193dac'];
      const assets=await Promise.all(kinds.map(async(k,i)=>{
        const type=i===2?'image/jpeg':'image/png',blob=await canvasBlob(i===2?42:32,32,colors[i],type);
        return BidderLibrary.readProfileFile(new File([blob],'synthetic-'+i+(i===2?'.jpg':'.png'),{type}),k);
      }));
      const pdf=await L.PDFDocument.create();pdf.addPage([595,842]);pdf.addPage([595,842]);
      const bytes=await pdf.save({useObjectStreams:true}),original=await extras(bytes,'sample.pdf','application/pdf');
      const originalSig=original.bytes.slice(),info=await S.inspect(original);
      expect(info.pageCount===2&&info.pages.every(p=>p.usable),'PDF identify usable geometry');
      const opts={kinds:[kinds[2],kinds[0],kinds[1]],assets,page:2,position:'bottom-right'};
      const signed=await S.apply(original,opts);
      expect(signed.mime==='application/pdf'&&signed.name==='sample-章签待复核.pdf'&&!same(signed.bytes,originalSig),'PDF output is distinct');
      expect(same(original.bytes,originalSig)&&same(bytes,originalSig),'PDF source exact bytes untouched');
      const check=await L.PDFDocument.load(signed.bytes),resources=n=>check.getPage(n).node.Resources()?.lookup(L.PDFName.of('XObject'));
      expect(check.getPageCount()===2&&!resources(0)&&resources(1).keys().length===3,'three XObjects only on page 2');
      expect((await extras(signed.bytes,signed.name,signed.mime)).sha256!==original.sha256,'real quote ZIP accepts derived PDF with new hash');
      const one=await S.apply(original,{...opts,kinds:[kinds[2]],page:1,position:{x:.10,y:.1,width:.22,height:.11}});
      const reload=await L.PDFDocument.load(one.bytes);
      const x=reload.getPage(0).node.Resources().lookup(L.PDFName.of('XObject'));
      expect(x.keys().length===1&&!reload.getPage(1).node.Resources()?.lookup(L.PDFName.of('XObject')),'explicit custom placement; no unselected images');
      expect(await bad(()=>S.apply(original,{...opts,page:3}),/超出.*页数/),'invalid page rejected');
      expect(await bad(()=>S.apply(original,{...opts,position:undefined}),/确认.*位置/),'no implicit position');
      expect(await bad(()=>S.apply(original,{...opts,kinds:[kinds[1],kinds[1]]}),/明确选择/),'duplicate kind refused');
      expect(await bad(()=>S.apply(original,{...opts,assets:[assets[0],assets[2]]}),/缺少/),'missing selected asset refused');
      const altered={...assets[0],bytes:assets[0].bytes.slice()};altered.bytes[33]^=1;
      expect(await bad(()=>S.apply(original,{...opts,assets:[altered,assets[1],assets[2]]}),/校验|无效|SHA/),'tampered asset refused');
      expect(await bad(()=>S.apply({...original,mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},opts),/人工处理/),'external Office documents not guessed');
      const rot=await L.PDFDocument.create();rot.addPage([595,842]).setRotation(L.degrees(90));
      const rotated=await extras(await rot.save(),'rotated.pdf','application/pdf');
      expect(!(await S.inspect(rotated)).pages[0].usable,'inspect rotated PDF marks page unsafe');
      expect(await bad(()=>S.apply(rotated,{...opts,page:1}),/旋转.*人工/),'rotated PDF cannot be stamped');
      const docmdp=await L.PDFDocument.create();docmdp.addPage([595,842]);
      docmdp.catalog.set(L.PDFName.of('Perms'),docmdp.context.obj({DocMDP:'synthetic certification marker'}));
      const protectedFile=await extras(await docmdp.save(),'signature-certificate.pdf','application/pdf');
      expect(await bad(()=>S.apply(protectedFile,{...opts,page:1}),/数字签名.*人工/),'protected PDF not re-signed');
      const png=await canvasBlob(300,200,'#ffffff','image/jpeg'),source=await extras(png,'attachment.jpg','image/jpeg'),raw=source.bytes.slice();
      const graphic=await S.apply(source,{...opts,page:1,position:'top-left'});
      expect(graphic.mime==='image/png'&&graphic.name==='attachment-章签待复核.png'&&same(source.bytes,raw),'original JPEG unchanged; PNG copy');
      const image=await createImageBitmap(new Blob([graphic.bytes],{type:graphic.mime}));
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const g=c.getContext('2d');g.drawImage(image,0,0);image.close();
      expect(c.width===300&&c.height===200,'dimensions preserved');
      const color=(x,y)=>Array.from(g.getImageData(x,y,1,1).data).slice(0,3);
      const points=[color(35,24),color(88,24),color(141,24),color(230,170)];
      expect(points[0][0]>180&&points[0][1]<50&&points[1][1]>80&&points[1][0]<40&&points[2][2]>140&&points[2][0]<45&&points[3].every(x=>x>250),'independent position/color for all three kinds');
      expect(await bad(()=>S.apply(source,{...opts,page:2}),/只有第 1 页/),'image wrong page refused');
      return {pdfPageCount:check.getPageCount(),pngSize:[c.width,c.height],pdfHasThree:true,allGates:true};
    });
    assert.deepEqual(result,{pdfPageCount:2,pngSize:[300,200],pdfHasThree:true,allGates:true});assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
