'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const dist=path.resolve(__dirname,'..','dist');

test('one unsigned quotation Word includes ordered unchanged layouts and every local annex page',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('Playwright unavailable');}
  const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();
  if(!fs.existsSync(executable))return t.skip('Chromium unavailable');
  const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});
  try{
    const context=await browser.newContext(),remote=[],errors=[];
    context.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))remote.push(r.url());});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(dist,'rule-catalog.js')).href);
    for(const n of ['quote-packet.js','quote-layouts.js','vendor-quote-pdf-lib.js','vendor-bidder-pdf.js','quote-annex-preview.js','bidder-archive-vendor.js','bidder-archive.js','project-workspace-store.js','quote-word-delivery.js'])
      await page.addScriptTag({content:fs.readFileSync(path.join(dist,n),'utf8')});
    const result=await page.evaluate(async()=>{
      document.body.replaceChildren();
      const Q=QuotePacket,L=QuoteLayouts,D=QuoteWordDelivery,P=PDFLib;
      const checks=[],ok=(v,msg)=>{if(!v)throw Error(msg);checks.push(msg);};
      const bad=async(fn,re)=>{let e;try{await fn();}catch(x){e=x;}ok(e&&re.test(e.message),'refusal '+re);};
      const s={firmName:'合成事务所',customerName:'合成被审计单位',auditYear:2026,location:'北京市',service:'年度财务报表审计',quoteDate:'2026-11-12',issuer:'合成采购单位',projectName:'合成演示项目',projectType:'专项审计',contactName:'',contactInfo:'',subtotalCents:100000,taxCents:6000,totalCents:106000,taxRateText:'6%（合成测试）',bidderContact:{name:'合成人员',phone:'010-00000000',email:'demo@example.invalid'}};
      const png=async(color,w=160,h=100)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle=color;g.fillRect(0,0,w,h);const b=await new Promise(r=>c.toBlob(r,'image/png'));c.width=c.height=0;return b;};
      const pdf=async(colors,mutate)=>{const p=await P.PDFDocument.create();for(const [i,color]of colors.entries()){const pg=p.addPage([200,280]);if(color)pg.drawRectangle({x:0,y:0,width:200,height:280,color:P.rgb(...color)});mutate?.(pg,p,i);}return p.save();};
      const make=(bytes,name,type)=>new File([bytes],name,{type});
      const a=await Q.readAttachment(make(await png('#56a171'),'synthetic-license.png','image/png'),'business_license');
      const b=await Q.readAttachment(make(await pdf([[1,0,0],[0,0,1],null],(p,d,i)=>{if(i===1)p.setRotation(P.degrees(90));}),'synthetic-practice.pdf','application/pdf'),'practice_certificate');
      const extra=await Q.readExtra(make(await pdf([[0,1,0],[1,1,0]]),'synthetic-extra.pdf','application/pdf'));
      const originalA=a.bytes.slice(),originalB=b.bytes.slice(),originalExtra=extra.bytes.slice();
      // Importing/looking up a seal is forbidden in this flow, even when a library exists.
      globalThis.QuoteAttachmentStamps=new Proxy({}, {get(){throw Error('Must never access a stamping module');}});
      const build=opts=>D.build({snapshot:s,attachments:[a,b],...opts});
      const out=await build({formats:['format3','format1','format2'],extras:[extra]});
      ok(out.mime===L.docxMime&&out.blob.type===L.docxMime&&out.name.endsWith('.docx')&&out.unsigned,'single unsigned DOCX, not ZIP/PDF');
      ok(JSON.stringify(out.formats)===JSON.stringify(['format1','format2','format3']),'catalog order with multiple formats');
      ok(out.attachmentPages===6&&out.manifest.map(x=>x.pageCount).join(',')==='1,3,2','all pages including rotated and blank source pages');
      ok(out.manifest[0].sha256===a.sha256&&out.manifest[1].sha256===b.sha256,'original SHA in local manifest');
      const parts=await ProjectWorkspaceStore.parts(make(out.bytes,'output.docx',out.mime));
      const parse=x=>new DOMParser().parseFromString(new TextDecoder().decode(x),'application/xml');
      const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',PKG='http://schemas.openxmlformats.org/package/2006/relationships';
      const doc=parse(parts['word/document.xml']),text=doc.documentElement.textContent,rels=parse(parts['word/_rels/document.xml.rels']);
      ok(!doc.querySelector('parsererror')&&doc.getElementsByTagNameNS(W,'sectPr').length===1,'valid namespace XML and exactly one section');
      ok(doc.getElementsByTagNameNS(W,'drawing').length===6&&Object.keys(parts).filter(n=>n.startsWith('word/media/')).length===6,'exactly six static annex images, no signing assets');
      ok(doc.getElementsByTagNameNS(W,'altChunk').length===0&&doc.getElementsByTagNameNS(W,'object').length===0,'no active OLE or alternative document chunks');
      const rs=[...rels.getElementsByTagNameNS(PKG,'Relationship')];
      ok(rs.length===7&&rs.every(x=>!x.hasAttribute('TargetMode')),'only local styles and image relationships');
      for(const im of doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','blip'))
        ok(rs.some(r=>r.getAttribute('Id')===im.getAttributeNS(R,'embed')&&parts['word/'+r.getAttribute('Target')]),'image relationship resolves');
      for(const id of out.formats){
        const expected=await L.render(s,id,[]);const ep=await ProjectWorkspaceStore.parts(make(expected.docx,'source.docx',L.docxMime));
        const en=parse(ep['word/document.xml']);
        for(const n of en.getElementsByTagNameNS(W,'t'))ok(text.includes(n.textContent),'kept template text '+id);
      }
      ok((text.match(/无章|不含章签/g)||[]).length>=3,'unsigned notices retained');
      const same=(x,y)=>x.length===y.length&&x.every((v,i)=>v===y[i]);
      ok(same(originalA,a.bytes)&&same(originalB,b.bytes)&&same(originalExtra,extra.bytes),'original attachments unchanged');
      ok(!document.querySelector('[data-quote-word-raster]'),'hidden renderer disposed after success');
      const colorAt=async(part)=>{const bm=await createImageBitmap(new Blob([parts[part]],{type:'image/png'})),c=document.createElement('canvas');c.width=bm.width;c.height=bm.height;c.getContext('2d').drawImage(bm,0,0);const q=[...c.getContext('2d').getImageData(c.width/2|0,c.height/2|0,1,1).data];bm.close();c.width=c.height=0;return q;};
      const red=await colorAt(out.manifest[1].pages[0].part),blue=await colorAt(out.manifest[1].pages[1].part),white=await colorAt(out.manifest[1].pages[2].part);
      ok(red[0]>240&&red[2]<10&&blue[2]>240&&blue[0]<10&&white.slice(0,3).every(v=>v===255),'distinct PDF pages rendered, including white blank page');
      await bad(()=>D.build({snapshot:s,attachments:[a]}),/营业执照|执业证书/);
      await bad(()=>build({formats:['format1','format1']}),/格式/);
      await bad(()=>build({snapshot:{...s,totalCents:106001}}),/合计/);
      await bad(()=>build({options:{company_seal:a}}),/印章|签字/);
      await bad(()=>build({attachments:[{...a,sha256:'0'.repeat(64)},b]}),/SHA/);
      await bad(()=>build({extras:Array(11).fill(extra)}),/10/);
      const office=await Q.readExtra(make((await L.render(s,'format1',[])).docx,'synthetic-source.docx',L.docxMime));
      await bad(()=>build({extras:[office]}),/先转为 PDF/);
      const pdfForm=await Q.readExtra(make(await pdf([null],(pg,p)=>{p.getForm().createTextField('Synthetic').addToPage(pg,{x:10,y:10,width:30,height:20});}),'synthetic-form.pdf','application/pdf'));
      await bad(()=>build({extras:[pdfForm]}),/交互|表单/);
      const crop=await Q.readExtra(make(await pdf([null],pg=>pg.setCropBox(10,10,100,180)),'synthetic-crop.pdf','application/pdf'));
      await bad(()=>build({extras:[crop]}),/裁切/);
      const huge=await Q.readAttachment(make(await png('#fff',5000,4000),'synthetic-large.png','image/png'),'business_license');
      await bad(()=>build({attachments:[huge,b]}),/1600 万|像素/);
      const chunk=new Uint8Array(20),view=new DataView(chunk.buffer);view.setUint32(0,8);chunk.set(new TextEncoder().encode('acTL'),4);view.setUint32(8,2);
      let crc=0xffffffff;for(const v of chunk.subarray(4,16)){crc^=v;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}view.setUint32(16,(crc^0xffffffff)>>>0);
      const animatedBytes=new Uint8Array(a.bytes.length+20);animatedBytes.set(a.bytes.subarray(0,33));animatedBytes.set(chunk,33);animatedBytes.set(a.bytes.subarray(33),53);
      const animated=await Q.readAttachment(make(animatedBytes,'synthetic-animation.png','image/png'),'business_license');
      await bad(()=>build({attachments:[animated,b]}),/动画 PNG/);
      const controller=new AbortController();controller.abort();
      await bad(()=>build({signal:controller.signal}),/取消/);
      let current=true;const stale=build({isCurrent:()=>current});current=false;await bad(()=>stale,/切换|取消/);
      const real=QuoteAnnexPreview;
      globalThis.QuoteAnnexPreview={mountPdf(host,opts){return real.mountPdf(host,{...opts,onReady(info){if(info.page===2)opts.onError(Error('合成第二页解码失败'));else opts.onReady(info);}});}};
      await bad(()=>build(),/第二页/);
      globalThis.QuoteAnnexPreview=real;
      ok(!document.querySelector('[data-quote-word-raster]'),'hidden renderer disposed on later-page failure');
      const cancelled=new AbortController(),interrupted=build({signal:cancelled.signal});setTimeout(()=>cancelled.abort(),10);
      await bad(()=>interrupted,/取消/);
      ok(!document.querySelector('[data-quote-word-raster]'),'hidden renderer disposed after abort');
      const batchRows=Array.from({length:6},(_,i)=>({name:'合成分户单位'+(i+1),assets:'10.01',revenue:'5.01',profit:i===2?'':'1.01',period:'2026年10月',totalCents:10000+i}));
      const batchTotal=batchRows.reduce((n,r)=>n+r.totalCents,0),batchSnapshot={...s,subtotalCents:batchTotal,taxCents:0,totalCents:batchTotal,quoteRows:batchRows};
      const batch=await build({snapshot:batchSnapshot,formats:['format1','format2','format3'],options:{quoteRows:batchRows}});
      const batchParts=await ProjectWorkspaceStore.parts(make(batch.bytes,'batch.docx',batch.mime));
      const batchText=parse(batchParts['word/document.xml']).documentElement.textContent;
      for(const row of batchRows)ok((batchText.match(new RegExp(row.name,'g'))||[]).length===3,'each of six entities survives all three selected formats');
      ok(batchText.includes('未填处以「—」表示'),'missing financial metric remains missing, not zero');
      await bad(()=>build({snapshot:batchSnapshot,options:{quoteRows:batchRows.map((r,i)=>i? r:{...r,name:'错误单位'})}}),/不一致/);
      const privateA={...a,bytes:a.bytes.slice()},copy=build({attachments:[privateA,b]});privateA.bytes.fill(0);const copied=await copy;
      ok(copied.attachmentPages===4,'private byte snapshot resists caller mutation after hash starts');
      return {checks:checks.length,attachmentPages:out.attachmentPages,byteLength:out.bytes.length,remote:[],sample:Array.from(out.bytes)};
    });
    assert.ok(result.checks>70);assert.equal(result.attachmentPages,6);assert.ok(result.byteLength>10000);
    assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);
    if(process.env.QUOTE_WORD_QA_DIR){fs.mkdirSync(process.env.QUOTE_WORD_QA_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.QUOTE_WORD_QA_DIR,'synthetic-quotation-with-annexes.docx'),Buffer.from(result.sample));}
  }finally{await browser.close();}
});
