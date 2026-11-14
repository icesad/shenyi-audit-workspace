'use strict';
const {test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const dir=path.resolve(__dirname,'../dist');

test('three local A4 body formats, legacy body and overflow pages preserve text without exposing attachment contents',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('no installed Playwright');}
  const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(executable))return t.skip('no installed Chromium');
  const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});
  try{
    const context=await browser.newContext({serviceWorkers:'block'}),net=[],errs=[];
    await context.route('**/*',r=>{if(/^https?:/.test(r.request().url())){net.push(r.request().url());return r.abort();}return r.continue();});
    const page=await context.newPage();page.on('pageerror',e=>errs.push(e.message));
    await page.goto(pathToFileURL(path.join(dir,'rule-catalog.js')).href);
    for(const n of ['quote-packet.js','quote-layouts.js','vendor-quote-pdf-lib.js','quote-body-pdf.js'])await page.addScriptTag({content:fs.readFileSync(path.join(dir,n),'utf8')});
    const result=await page.evaluate(async visual=>{
      const calls=[],graphics=[],ctx=CanvasRenderingContext2D.prototype,orig=ctx.fillText,draw=ctx.drawImage;
      ctx.fillText=function(s,x,y){calls.push({s,x,y});return orig.call(this,s,x,y);};
      ctx.drawImage=function(img,x,y,w,h){graphics.push({x,y,w,h});return draw.call(this,img,x,y,w,h);};
      const snapshot={firmName:'虚构会计师事务所（普通合伙）',customerName:'虚构被审计企业',auditYear:2026,location:'北京',service:'年度财务报表审计',quoteDate:'2026-11-07',issuer:'虚构采购单位',projectName:'虚构采购项目',projectType:'专项审计',contactName:'',contactInfo:'',subtotalCents:2000000,taxCents:120000,totalCents:2120000,taxRateText:'6%（演示）'};
      const fragments=await Promise.all(QuoteLayouts.catalog.map(x=>QuoteLayouts.render(snapshot,x.id,[],{previewOnly:true}).then(d=>d.html)));
      const inspect=async bytes=>{
        const doc=await PDFLib.PDFDocument.load(bytes);
        return doc.getPages().map(p=>[Math.round(p.getWidth()),Math.round(p.getHeight()),p.node.Resources().lookup(PDFLib.PDFName.of('XObject')).keys().length]);
      };
      const singleCounts=[];
      for(const fragment of fragments)singleCounts.push((await inspect(await QuoteBodyPdf.build([fragment]))).length);
      calls.splice(0);
      const first=await QuoteBodyPdf.build(fragments),three=await inspect(first),firstCalls=calls.splice(0);
      const anchored=await QuoteBodyPdf.buildWithAnchors(fragments),anchoredPages=await inspect(anchored.body),anchoredCalls=calls.splice(0);
      const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
      const g=canvas.getContext('2d');g.fillStyle='#a33';g.fillRect(0,0,16,16);
      const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
      const pair=await Promise.all(['business_license','practice_certificate'].map(k=>QuotePacket.readAttachment(new File([blob],k+'.png',{type:'image/png'}),k)));
      const genericHtml=await QuotePacket.renderDocument(snapshot,pair),generic=await inspect(await QuoteBodyPdf.build([genericHtml])),genericCalls=calls.splice(0);
      const genericAnchor=(await QuoteBodyPdf.buildWithAnchors([genericHtml])).bodySealAnchors;calls.splice(0);
      const signed=await QuoteLayouts.render(snapshot,'format1',[{...pair[0],kind:'bidder_signature'}],{previewOnly:true});
      await QuoteBodyPdf.build([signed.html]);const signedCalls=calls.splice(0),signedGraphics=graphics.splice(0);
      const longProjectName='测试长项目名称'+('长江经济带区域联合发展项目财务报表及经营成果年度审计服务'.repeat(4))+'标题结束';
      const quoteRows=Array.from({length:42},(_,i)=>({name:'测试表行第'+(i+1)+'项',assets:'151.24',revenue:'136.68',profit:'-9.15',period:'2026年',totalCents:50000}));
      const extended=(await QuoteLayouts.render({...snapshot,projectName:longProjectName,taxCents:100000,totalCents:2100000,quoteRows},'format3',[],{previewOnly:true})).html;
      const long=await inspect(await QuoteBodyPdf.build([extended])),longCalls=calls.splice(0);
      const longAnchored=await QuoteBodyPdf.buildWithAnchors([extended]),longAnchor=longAnchored.bodySealAnchors,longAnchorPages=(await inspect(longAnchored.body)).length;calls.splice(0);
      const bad=async f=>{try{await f();return false;}catch(e){return e.message;}};
      const roles=['legal_representative_seal','bidder_signature'];
      const roleBuild=await QuoteBodyPdf.buildWithAnchors([extended,...fragments.slice(0,2)],roles),roleCalls=calls.splice(0);
      const sigOnly=await QuoteBodyPdf.buildWithAnchors([genericHtml],[roles[1]]),sigOnlyCalls=calls.splice(0);
      return {three,singleCounts,generic,long,longProjectName,anchored:anchored.bodySealAnchors,anchoredPages,anchoredCalls,genericAnchor,longAnchor,longAnchorPages,firstCalls,genericCalls,signedCalls,signedGraphics,longCalls,
        roleSlots:roleBuild.bodySigningAnchors,roleClosings:roleBuild.bodySealAnchors,rolePages:(await inspect(roleBuild.body)).length,roleCalls,sigSlots:sigOnly.bodySigningAnchors,sigOnlyCalls,
        bad:await bad(()=>QuoteBodyPdf.build(['<img src="https://invalid.example/no"><p>Wrong</p>'])),
        badRole:await bad(()=>QuoteBodyPdf.buildWithAnchors([fragments[0]],['company_seal'])),
        missingClosing:await bad(()=>QuoteBodyPdf.buildWithAnchors([fragments[0].replaceAll('ql-close','x-close').replaceAll('ql-unit-date','x-date')],roles)),
        visual:visual?Array.from(first):null};
    },!!process.env.QUOTE_BODY_PDF_VISUAL);
    const shortPageCount=result.singleCounts.reduce((a,b)=>a+b,0);
    assert.deepEqual(result.three,Array(shortPageCount).fill([595,842,1]));assert.deepEqual(result.generic,[[595,842,1]]);
    assert.ok(result.singleCounts.every(n=>n>=1&&n<=2),'short examples fit within two pages per form');
    assert.ok(result.long.length>=3&&result.long.length<=8);assert.ok(result.long.every(p=>p.join()==='595,842,1'));
    assert.equal(result.anchored.length,3);
    const dates=result.anchoredCalls.filter(c=>/^日期：/.test(c.s));assert.equal(dates.length,3);
    for(const [i,anchor] of result.anchored.entries()){
      assert.ok(anchor.x>=420&&anchor.x+anchor.width<=595.28&&anchor.y>100&&anchor.y+anchor.height<841.89,'anchor is over text, not footer');
      assert.ok(dates[i].y>=841.89-anchor.y-anchor.height&&dates[i].y<=841.89-anchor.y,'actual date line inside the seal area');
      assert.ok(anchor.pageIndex<result.anchoredPages.length&&(i===0||anchor.pageIndex>result.anchored[i-1].pageIndex));
    }
    assert.equal(result.genericAnchor.length,1);
    assert.equal(result.longAnchor.length,1);assert.ok(result.longAnchor[0].pageIndex>0);assert.equal(result.longAnchor[0].pageIndex,result.longAnchorPages-1);
    const ink=(arr,s)=>arr.map(c=>c.s).join('|').includes(s);
    for(const s of ['虚构采购单位','虚构被审计企业','21,200.00','草稿 · 待审核','报价函','方案','资料分析','问题','供应商联系信息'])assert.ok(ink(result.firstCalls,s),s);
    assert.deepEqual(result.firstCalls.filter(c=>/^正文第 /.test(c.s)).map(c=>c.s),Array.from({length:shortPageCount},(_,i)=>'正文第 '+(i+1)+' 页'));
    assert.equal(result.signedGraphics.length,1);assert.ok(result.signedGraphics[0].y<650&&ink(result.signedCalls,'投标人签字'));
    assert.ok(ink(result.genericCalls,'审计服务报价单'));assert.ok(!ink(result.genericCalls,'business_license.png')&&!ink(result.genericCalls,'报价附件'));
    const longPages=[];let current=[];
    for(const c of result.longCalls){
      current.push(c);
      if(/^正文第 /.test(c.s)){longPages.push(current);current=[];}
    }
    const tablePages=longPages.filter(page=>page.some(c=>/^测试表行第/.test(c.s)));
    assert.ok(tablePages.length>=3&&tablePages.every(page=>page.filter(c=>c.s==='单位名称').length===1),'six-column table headers repeat on each page with data');
    assert.equal(new Set(result.longCalls.filter(c=>/^测试表行第/.test(c.s)).map(c=>c.s)).size,42,'every whole row rendered');
    const heading=longPages[0].filter(c=>c.x>290&&c.x<310).map(c=>c.s).join('');
    assert.equal(heading,result.longProjectName+'2026 年度专项审计报价明细','multi-line project-specific title remains complete');
    assert.ok(longPages.slice(1).every(page=>page.some(c=>c.s==='2026 年度专项审计报价明细（续）')),'long titles use concise continuation header');
    for(const c of [...result.firstCalls,...result.genericCalls,...result.longCalls])assert.ok(c.y<=650||c.x===48&&/^正文第 /.test(c.s),'blank lower-right seal space');
    assert.equal(result.roleSlots.length,6);
    for(const [i,closing] of result.roleClosings.entries()){
      const [legal,signature]=result.roleSlots.slice(i*2,i*2+2);
      assert.deepEqual([legal.kind,signature.kind],['legal_representative_seal','bidder_signature']);
      assert.equal(legal.pageIndex,closing.pageIndex);assert.equal(signature.pageIndex,closing.pageIndex);
      assert.ok(legal.x+legal.width<signature.x,'role images do not overlap');
      assert.ok(signature.y+signature.height<closing.y&&legal.y+legal.height<closing.y,'both signature lanes are immediately below the actual closing');
      assert.ok(signature.y>841.89-650&&legal.y>841.89-650,'no stamp in the reserved footer');
    }
    assert.ok(result.roleClosings[0].pageIndex>0,'long batch quote receives signing slots after continuation pages');
    assert.ok(result.roleClosings.every((a,i)=>i===0||a.pageIndex>result.roleClosings[i-1].pageIndex),'all three forms receive separate closing slots');
    assert.equal(result.roleClosings.at(-1).pageIndex,result.rolePages-1,'third form receives signing slots on the closing page');
    assert.deepEqual(result.sigSlots.map(a=>a.kind),['bidder_signature']);
    assert.ok(ink(result.sigOnlyCalls,'投标人签字')&&!ink(result.sigOnlyCalls,'法人章'));
    assert.equal(result.roleCalls.filter(c=>c.s==='法人章'||c.s==='投标人签字').length,6);
    assert.match(result.bad,/未找到单份/);assert.match(result.badRole,/签署类型无效/);assert.match(result.missingClosing,/找不到明确落款/);
    assert.deepEqual(net,[]);assert.deepEqual(errs,[]);
    if(process.env.QUOTE_BODY_PDF_VISUAL)fs.writeFileSync(process.env.QUOTE_BODY_PDF_VISUAL,Buffer.from(result.visual),{flag:'wx'});
  }finally{await browser.close();}
});
