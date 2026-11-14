'use strict';
// Run with: node tests/browser/quote-sign-smoke.cjs "<extracted synthetic demo directory>" [offline.html]
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const [demo,html=path.resolve(__dirname,'../../dist/index.html')]=process.argv.slice(2);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const firm='虚构样本会计师事务所（普通合伙）';
const c='company_seal',l='legal_representative_seal',s='bidder_signature';
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return (n^0xffffffff)>>>0;}
function unzip(b){
  const e=b.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));assert.ok(e>=0);assert.equal(e+22+b.readUInt16LE(e+20),b.length);
  const count=b.readUInt16LE(e+10),files=new Map(),dir=b.readUInt32LE(e+16);let at=dir;
  for(let i=0;i<count;i++){
    assert.equal(b.readUInt32LE(at),0x02014b50);
    const n=b.readUInt16LE(at+28),extra=b.readUInt16LE(at+30),comment=b.readUInt16LE(at+32),local=b.readUInt32LE(at+42);
    const name=b.subarray(at+46,at+46+n).toString('utf8'),size=b.readUInt32LE(at+20),rawSize=b.readUInt32LE(at+24),method=b.readUInt16LE(at+10);
    assert.equal(b.readUInt32LE(local),0x04034b50);assert.equal(b.readUInt16LE(local+8),method);
    assert.ok(!files.has(name)&&!name.includes('..')&&!name.startsWith('/')&&!name.includes('\\'));
    const start=local+30+b.readUInt16LE(local+26)+b.readUInt16LE(local+28);
    assert.equal(b.subarray(local+30,local+30+b.readUInt16LE(local+26)).toString('utf8'),name);
    const packed=b.subarray(start,start+size),bytes=method===0?packed:method===8?zlib.inflateRawSync(packed):null;
    assert.ok(bytes&&bytes.length===rawSize&&crc(bytes)===b.readUInt32LE(at+16),'ZIP entry integrity '+name);
    files.set(name,bytes);at+=46+n+extra+comment;
  }
  assert.equal(at,e);assert.equal(at-dir,b.readUInt32LE(e+12));return files;
}
function member(files,info){const b=files.get(info.path);assert.ok(b,info.path);assert.equal(b.length,info.size);assert.equal(sha(b),info.sha256);return b;}
function packet(zip){
  const files=unzip(zip),m=JSON.parse(files.get('附件清单.json'));
  assert.equal(m.schemaVersion,2);assert.equal(m.digitalSignatureApplied,false);assert.equal(m.certificateAuthenticityVerified,false);
  assert.equal(m.snapshot.firmName,firm);assert.equal(m.status,'draft_pending_review');assert.equal(m.attachments.length,2);assert.equal(m.extras.length,2);
  assert.deepEqual(m.documents.map(d=>d.formatId),['format1','format2','format3']);
  for(const d of m.documents){
    const html=member(files,d.html).toString('utf8'),word=unzip(member(files,d.docx)),xml=word.get('word/document.xml').toString('utf8');
    assert.match(html,/待审核/);assert.match(xml,/待审核/);assert.match(html,/script-src (?:'none'|&apos;none&apos;)/);
    assert.doesNotMatch(html,/<script\b|<iframe\b|<embed\b/i);assert.doesNotMatch(html,/本所工时预算|河北历史参考|优惠幅度/);
    const htmlKinds=Array.from(html.matchAll(/<figure[^>]+data-sign-kind="([^"]+)"[^>]*>(.*?)<\/figure>/g)).filter(x=>/<img\b/.test(x[2])).map(x=>x[1]);
    assert.deepEqual(htmlKinds,d.appliedSigningKinds);
    assert.equal((xml.match(/<w:drawing>/g)||[]).length,d.appliedSigningKinds.length);
    if(html.includes('ql-unit-date')){
      assert.equal((xml.match(/<wp:anchor /g)||[]).length,d.appliedSigningKinds.length,'confirmed transparent role images use positioned foreground anchors');
      if(d.appliedSigningKinds.includes(c))assert.match(html,/class="ql-sign ql-overlay" data-sign-kind="company_seal"/);
    }
    const media=[...word.keys()].filter(n=>n.startsWith('word/media/'));
    assert.equal(media.length,d.appliedSigningKinds.length);
    for(const [i,k] of d.appliedSigningKinds.entries())assert.equal(sha(word.get(media[i])),sha(stamps[k]),k+' matched to expected DOCX image');
    for(const k of d.appliedSigningKinds)assert.ok(html.includes(stamps[k].toString('base64')),k+' matched to expected HTML image');
  }
  for(const a of [...m.attachments,...m.extras])member(files,a);
  assert.equal(files.size,11,'only six document entries, four attachments and one manifest; no raw seal or signing assets');
  return {files,m};
}
let stamps;
async function main(){
  assert.ok(demo,'Pass extracted synthetic 演示材料 directory');
  const intake=path.join(demo,'04-虚构投标方基础资料.zip');
  const fixture=unzip(fs.readFileSync(intake));
  const byBase=name=>[...fixture].find(([k])=>k.split('/').at(-1)===name)?.[1];
  stamps={[c]:byBase('公司公章（演示）.png'),[l]:byBase('法人章（演示）.png'),[s]:byBase('投标人签字（演示）.png')};
  assert.ok(Object.values(stamps).every(Boolean),'must use only bundled synthetic images');
  const license=byBase('营业执照（演示）.png'),certificate=byBase('会计师事务所执业证书（演示）.png');
  const unselected=fs.readFileSync(path.join(demo,'02-演示附件-营业执照上传位.png'));
  const steps=[],remote=[],errors=[],downloads=[];
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true});
  try{
    const ctx=await browser.newContext({acceptDownloads:true,serviceWorkers:'block'});
    ctx.on('request',r=>{if(/^(https?|wss?):/.test(r.url()))remote.push(r.url());});await ctx.route(/^https?:/,r=>r.abort());
    const p=await ctx.newPage();p.setDefaultTimeout(7000);
    p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());p.on('download',d=>downloads.push(d.suggestedFilename()));
    await p.goto(pathToFileURL(html).href);const q=x=>p.locator(x);
    const fixedSeal=await p.evaluate(()=>globalThis.QuoteCompletePdf?.COMPANY_SEAL_MM===42);
    const annexPages=fixedSeal?6:5;
    let companyPlan={pageCount:3,sealAnchors:[],roleAnchors:[]},expectedPages=companyPlan.pageCount+annexPages;
    const firstCert=()=>companyPlan.pageCount+1,firstPdf=()=>firstCert()+2,explicitPdf=()=>firstPdf()+1,lastPdf=()=>firstPdf()+(fixedSeal?2:1),lastAnnex=()=>lastPdf()+1;
    const renderedBodyPlan=async(signingKinds=[],anchor=true)=>p.evaluate(async({signingKinds,anchor})=>{
      const fragments=[...document.querySelectorAll('#customer-preview .ql-doc')].map(x=>x.outerHTML);
      const r=anchor?await QuoteBodyPdf.buildWithAnchors(fragments,signingKinds):{body:await QuoteBodyPdf.build(fragments)};
      const body=await PDFLib.PDFDocument.load(r.body);
      return {pageCount:body.getPageCount(),sealAnchors:r.bodySealAnchors||[],roleAnchors:r.bodySigningAnchors||[]};
    },{signingKinds,anchor});
    const waitText=(selector,value)=>p.waitForFunction(([s,v])=>document.querySelector(s)?.textContent.includes(v),[selector,value]);
    const download=async selector=>{const [d]=await Promise.all([p.waitForEvent('download'),q(selector).click()]);assert.equal(await d.failure(),null);return fs.readFileSync(await d.path());};
    await q('[data-view=bidders]').click();await q('#bidder-archive-file').setInputFiles(intake);
    await waitText('#bidder-editor-status','已填入待核对资料');
    assert.equal(await q('#bidder-edit-name').inputValue(),firm);
    assert.equal(await q('[data-bidder-edit]').count(),0);
    for(const [k,n] of [[c,'公司公章'],[l,'法人章'],[s,'投标人签字']])await waitText('#bidder-file-'+k,n+'（演示）.png');
    if(fixedSeal){
      const filename='公司公章-42毫米验证（虚构）.png';
      stamps[c]=Buffer.from(await p.evaluate(()=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=480;
        const x=canvas.getContext('2d');x.strokeStyle='#255ba6';x.fillStyle='#255ba6';x.lineWidth=24;
        x.beginPath();x.arc(240,240,208,0,2*Math.PI);x.stroke();
        x.font='bold 102px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText('QA',240,240);
        return canvas.toDataURL('image/png').split(',')[1];
      }),'base64');
      await q('#bidder-edit-company_seal').setInputFiles({name:filename,mimeType:'image/png',buffer:stamps[c]});
      await waitText('#bidder-file-company_seal',filename);
    }
    await q('#bidder-edit-kind').selectOption('own');await q('#bidder-save').click();await q('[data-bidder-edit]').waitFor();
    const id=await q('[data-bidder-edit]').getAttribute('data-bidder-edit');
    steps.push('v13 synthetic ZIP populates roles; explicit save as own firm');
    await q('[data-view=quote]').click();await q('#tender-file').setInputFiles(path.join(demo,'01-虚构发标函-含两家被审计方.docx'));
    await p.waitForFunction(()=>document.querySelectorAll('[data-auditee-row]').length===2&&document.querySelector('input[name=issuer]').value==='虚构样本采购有限公司');
    if(await q('#quote-scope').count())await q('#quote-scope').selectOption('single');
    await q('#bidder-picker-select').selectOption(id);
    await p.waitForFunction(n=>document.querySelector('input[name=firmName]').value===n,firm);
    const makeChinesePdf=async()=>{
      const print=await ctx.newPage();
      try{
        await print.setContent('<meta charset="UTF-8"><style>@page{size:595pt 842pt;margin:0}body{margin:0;font:12pt "Microsoft YaHei",sans-serif}.sheet{height:841pt;position:relative}.sheet:not(:last-child){break-after:page}.line{position:absolute;left:330pt;top:646pt;white-space:nowrap}</style><section class="sheet">SYNTHETIC QA PAGE 1</section><section class="sheet">SYNTHETIC QA PAGE 2<div class="line">联系人及中介机构（签章）：<br>2026 年 11 月 06 日</div></section><section class="sheet">SYNTHETIC QA PAGE 3</section>');
        return await print.pdf({preferCSSPageSize:true,printBackground:true});
      }finally{await print.close();}
    };
    const pdf=fixedSeal?await makeChinesePdf():Buffer.from(await p.evaluate(async()=>{
      const doc=await PDFLib.PDFDocument.create();const f=await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      for(let i=1;i<=2;i++){
        const page=doc.addPage([595,842]);page.drawText('SYNTHETIC QA PAGE '+i,{x:45,y:790,size:18,font:f});
        if(i===2){
          page.drawText('Company seal: Synthetic Sample CPA',{x:330,y:180,size:12,font:f});
          page.drawText('Authorized representative (signature):',{x:330,y:150,size:12,font:f});
          page.drawText('Date: 2026-11-06',{x:330,y:120,size:12,font:f});
        }
      }
      return Array.from(await doc.save({useObjectStreams:false}));
    }));
    await q('#quote-extras input[type=file]').setInputFiles([
      {name:'独立性承诺书.pdf',mimeType:'application/pdf',buffer:pdf},
      {name:'不需章签的说明.png',mimeType:'image/png',buffer:unselected}
    ]);await waitText('#quote-extras .qe-status','已添加 2 份其他附件');
    for(const i of [1,2,3])await q('#quote-layout-format'+i).check();
    const directAvailable=await q('#preview-with-seal').count()===1;
    const roleInput=k=>q('[data-quote-page-sign-kind="'+k+'"]');
    const optionalSigning=await roleInput(c).count()===1;
    const signedToolbar=q('#quote-download-signed-complete'),hasSignedToolbar=await signedToolbar.count()===1;
    const wordToolbar=q('#quote-download-unsigned-word'),hasWordToolbar=await wordToolbar.count()===1;
    const hasAttachmentPlacement=hasSignedToolbar||hasWordToolbar;
    async function checkUnsignedWordZip(){
      assert.equal(await wordToolbar.isVisible(),true);
      assert.equal(await wordToolbar.isEnabled(),true);
      const result=await download('#quote-download-unsigned-word'),name=downloads.pop();
      assert.match(name,/\.zip$/i);
      const docs=unzip(result);assert.equal(docs.size,3,'multi-format Word download contains exactly three files');
      const bodies=[];
      for(const [filename,bytes] of docs){
        assert.match(filename,/\.docx$/i);assert.doesNotMatch(filename,/[/\\]/);
        const doc=unzip(bytes);assert.ok(doc.has('word/document.xml'));
        assert.deepEqual([...doc.keys()].filter(n=>n.startsWith('word/media/')),[],'stored signing assets must not be embedded');
        const xml=doc.get('word/document.xml').toString('utf8');
        const rels=doc.get('word/_rels/document.xml.rels')?.toString('utf8')||'';
        assert.doesNotMatch(xml,/<w:drawing\b|<w:pict\b|r:embed|data:image\//);
        assert.doesNotMatch(rels,/relationships\/image|TargetMode="External"/);
        assert.match(xml,/草稿 · 待审核/);
        bodies.push(xml);
      }
      const f1=bodies.filter(x=>/公司名称/.test(x)&&/<w:tbl>/.test(x));
      assert.equal(f1.length,1,'format 1 is the two-column quote letter');
      assert.equal((f1[0].match(/<w:gridCol /g)||[]).length,2);
      const f2=bodies.filter(x=>/1\. 审计方案/.test(x)&&!/<w:tbl>/.test(x));
      assert.equal(f2.length,1,'format 2 is the no-table work-scope letter for one company');
      assert.match(f2[0],/报价明细.*1\. 审计方案.*2\. 资料分析.*3\. 现场工作与盘点.*4\. 报告与交付.*5\. 问题沟通.*上述服务的报价总额/);
      assert.doesNotMatch(f2[0],/竞争性谈判选商回函|服务团队|证书编号/,'reference package-only pages must not leak into format 2');
      assert.equal(bodies.filter(x=>/6\. 供应商联系信息/.test(x)&&!/<w:tbl>/.test(x)).length,1,'format 3 uses numbered clauses without a single-auditee table');
      return docs;
    }
    const assertToolbar=async(enabled,message)=>{
      if(!hasSignedToolbar)return;
      assert.equal(await signedToolbar.isVisible(),true,'signed complete PDF action is visible in the toolbar even before approval');
      assert.equal(await signedToolbar.isEnabled(),enabled,message);
    };
    const kinds=[c,l,s], roleColors=[[37,91,166],[157,74,31],[114,54,138]];
    const assertFreshChoice=async()=>{
      assert.equal(await q('#quote-page-sign-choices').isVisible(),true);
      for(const k of kinds)assert.equal(await roleInput(k).isChecked(),false,k+' defaults off');
      assert.equal(await q('#quote-page-seal').isChecked(),false);
      assert.equal(await q('#quote-preview-sealed-pdf').isDisabled(),true);
      assert.equal(await q('#quote-sealed-review').isVisible(),false);
      assert.equal(await q('#quote-download-sealed-pdf').isEnabled(),false);
      await assertToolbar(false,'fresh dialog cannot download a signed copy');
    };
    const waitForKinds=ks=>p.waitForFunction(ks=>ks.every(k=>{
      const node=document.querySelector('[data-quote-page-sign-kind="'+k+'"]');
      return node&&!node.disabled;
    }),ks);
    const anchoredBuild=await p.evaluate(()=>typeof window.QuoteBodyPdf?.buildWithAnchors==='function');
    const hasCompanySealPixels=(cv,placement)=>{
      const w=cv.width,h=cv.height;
      const [left,top,right,bottom]=placement==='credential'?[.32,.30,.68,.70]:placement==='anchor'?[.72,.18,1,.84]
        :placement==='extra-auto'?[.50,.65,.92,.88]:placement==='extra-manual'?[.21,.33,.36,.47]
        :placement==='extra-inset'?[.60,.44,.88,.77]:[.72,.90,1,1];
      const x=Math.floor(w*left),y=Math.floor(h*top),d=cv.getContext('2d').getImageData(x,y,Math.floor(w*right)-x,Math.floor(h*bottom)-y).data;
      let blue=0;
      for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-37)<18&&Math.abs(d[i+1]-91)<18&&Math.abs(d[i+2]-166)<18&&d[i+3]>200)blue++;
      return blue>20;
    };
    const isClosing=(n,plan=companyPlan)=>plan.sealAnchors.some(a=>a.pageIndex+1===n)||!fixedSeal&&anchoredBuild&&n===1;
    const firstClosing=(plan=companyPlan)=>plan.sealAnchors[0]?.pageIndex+1||1;
    const sealPlacement=n=>[firstCert(),firstCert()+1].includes(n)?'credential':isClosing(n)?'anchor'
      :fixedSeal&&n===lastAnnex()?'extra-inset'
      :fixedSeal&&n>=firstPdf()&&n<=lastPdf()||hasAttachmentPlacement&&n===explicitPdf()?'extra-auto':'footer';
    await q('#preview').click();await q('#quote-dialog[open]').waitFor();
    if(directAvailable){
      assert.match(await q('#preview').textContent(),/无章/);
      assert.equal(await q('#quote-sealed-review').isVisible(),false,'ordinary draft preview must remain unsigned');
    }
    await assertToolbar(false,'unsigned preview cannot download a signed copy');
    assert.equal(await q('#customer-preview .ql-doc').count(),3);
    assert.equal(await q('#customer-preview img').count(),0);
    if(hasWordToolbar)assert.equal(hasSignedToolbar,false,'unsigned Word replaces the duplicate toolbar signed PDF button');
    const wordBefore=hasWordToolbar?await checkUnsignedWordZip():null;
    const integrated=await q('#quote-complete-pdf').count()===1;
    const reviewAvailable=await q('#quote-preview-sealed-pdf').count()===1;
    if(integrated){
      const annex='#quote-preview-attachments';
      for(const name of ['营业执照（演示）.png','会计师事务所执业证书（演示）.png','独立性承诺书.pdf','不需章签的说明.png'])await waitText(annex,name);
      assert.equal(await q('#quote-annex-count').textContent(),'（4）');
      if(await q('#quote-print-certificates').count()){
        await p.evaluate(()=>{
          globalThis.printNativeOriginalCreateUrl=URL.createObjectURL;
          URL.createObjectURL=function(blob){
            const url=printNativeOriginalCreateUrl.call(URL,blob);
            if(blob.type==='application/pdf')globalThis.printNativePdf={blob,url};
            return url;
          };
        });
        let printTab;
        try{
          [printTab]=await Promise.all([ctx.waitForEvent('page',{timeout:7000}),q('#quote-print-certificates').click()]);
          await waitText(annex,'已打开两证 PDF（2 页）');
          const {pageCount,hasPdf}=await p.evaluate(async()=>{
            const value=globalThis.printNativePdf;
            const pdf=await PDFLib.PDFDocument.load(await value.blob.arrayBuffer());
            return {pageCount:pdf.getPageCount(),hasPdf:value.url.startsWith('blob:')};
          });
          assert.deepEqual({pageCount,hasPdf},{pageCount:2,hasPdf:true});
          assert.equal(downloads.length,0,'normal print path opens a PDF tab, not a download');
          steps.push('certificate print opens a new browser tab with a local two-page PDF');
        }finally{
          await printTab?.close();
          await p.evaluate(()=>{URL.createObjectURL=printNativeOriginalCreateUrl;delete globalThis.printNativeOriginalCreateUrl;delete globalThis.printNativePdf;});
        }
      }
      assert.equal(await q('#quote-page-seal').isChecked(),false);
      const pages=async bytes=>p.evaluate(async b=>{
        const pdf=await PDFLib.PDFDocument.load(Uint8Array.from(b));
        return pdf.getPages().map(pg=>{
          const d=pg.node.Resources()?.lookupMaybe(PDFLib.PDFName.of('XObject'),PDFLib.PDFDict);
          return (d?.entries()||[]).filter(([,ref])=>String(pdf.context.lookup(ref)?.dict?.get(PDFLib.PDFName.of('Subtype')))==='/Image').map(([,ref])=>String(ref));
        });
      },Array.from(bytes));
      const plain=await pages(await download('#quote-complete-pdf'));
      const plainBody=fixedSeal?(await renderedBodyPlan([],false)).pageCount:3;
      assert.equal(plain.length,plainBody+annexPages,'all body pages, two certs, extra PDF pages, and one PNG');
      if(fixedSeal){
        companyPlan=await renderedBodyPlan();
        assert.equal(companyPlan.sealAnchors.length,3,'each selected layout retains one distinct closing anchor');
        assert.equal(new Set(companyPlan.sealAnchors.map(a=>a.pageIndex)).size,3);
        expectedPages=companyPlan.pageCount+annexPages;
      }
      let sealed;
      if(reviewAvailable){
        if(optionalSigning){
          await waitForKinds(kinds);
          assert.match(await q('#quote-seal-source-status').textContent(),/公司公章/);
        }else{
          await waitText('#quote-seal-source-status','已读取公司公章');
          await waitText('#quote-seal-source-status','公司公章（演示）.png');
        }
        assert.equal(await q('#quote-preview-sealed-pdf').isDisabled(),true,'must confirm authorization before preparing the PDF');
        assert.equal(await q('#quote-download-sealed-pdf').isVisible()&&await q('#quote-download-sealed-pdf').isEnabled(),false);
        if(optionalSigning){
          await assertFreshChoice();
          await waitForKinds(kinds);
          await roleInput(c).check();
          assert.equal(await q('#quote-preview-sealed-pdf').isDisabled(),true,'choosing a company seal does not authorize use');
        }
        await q('#quote-page-seal').check();
        await assertToolbar(false,'authorizing marks alone cannot bypass the prepared signed review');
        // v17 splits ordinary downloads from the stamp action. Even after
        // opting in, the ordinary download must still be visually unsigned.
        const plainAfterAck=await pages(await download('#quote-complete-pdf'));
        assert.deepEqual(plainAfterAck,plain,'unsigned action cannot apply a mark, regardless of authorization state');
        if(optionalSigning&&!await roleInput(c).isChecked())await roleInput(c).check();
        if(!await q('#quote-page-seal').isChecked())await q('#quote-page-seal').check();
        await q('#quote-preview-sealed-pdf').click();
        const rendered='#quote-sealed-preview canvas[role=img]';
        const assertRenderedSeal=async (n,placement=sealPlacement(n))=>{
          const page=q(rendered).filter({visible:true});
          await p.waitForFunction(([selector,n])=>document.querySelector(selector)?.getAttribute('aria-label')?.includes('第 '+n+' 页'),[rendered,n]);
          assert.ok(await page.first().evaluate(hasCompanySealPixels,placement),'signed preview renders the synthetic blue company seal at '+placement+' on page '+n);
          if(placement!=='footer')assert.equal(await page.first().evaluate(hasCompanySealPixels,'footer'),false,'the overlay is not duplicated in the footer');
        };
        const goSignedPage=n=>q('#quote-sealed-preview').getByRole('combobox',{name:'跳转到预览页'}).selectOption(String(n));
        const companyClosing=firstClosing();
        if(companyClosing!==1)await goSignedPage(companyClosing);
        await assertRenderedSeal(companyClosing);
        const checkPages=fixedSeal?[firstCert(),firstCert()+1,firstPdf(),explicitPdf(),lastPdf(),lastAnnex()]
          :hasAttachmentPlacement?[4,5,6,7,8]:[4,5,8];
        for(const n of checkPages){
          await goSignedPage(n);
          await assertRenderedSeal(n);
        }
        assert.equal(downloads.length,2,'preview cannot start any download');
        const fromReview=await download('#quote-download-sealed-pdf');
        sealed=await pages(fromReview);
        if(fixedSeal){
          const geometry=await p.evaluate(async bytes=>{
            const L=PDFLib,d=await L.PDFDocument.load(Uint8Array.from(bytes));
            const N=k=>L.PDFName.of(k), identity=[1,0,0,1,0,0];
            const multiply=([a,b,c,d,x,y],[e,f,g,h,u,v])=>[a*e+c*f,b*e+d*f,a*g+c*h,b*g+d*h,a*u+c*v+x,b*u+d*v+y];
            return d.getPages().map(pg=>{
              const objs=pg.node.Resources()?.lookupMaybe(N('XObject'),L.PDFDict),images=new Map();
              for(const [name,ref] of objs?.entries()||[]){
                const im=d.context.lookup(ref),get=k=>im?.dict?.get(N(k));
                if(String(get('Subtype'))==='/Image')images.set(String(name),[get('Width').asNumber(),get('Height').asNumber()]);
              }
              const content=pg.node.Contents(),streams=content instanceof L.PDFArray?content.asArray().map(ref=>d.context.lookup(ref)):[content];
              const raw=streams.map(stream=>new TextDecoder().decode(L.decodePDFRawStream(stream).decode())).join('\n');
              const imageOperators=[];
              for(const op of raw.matchAll(/(?:^|\n)q\s+([\s\S]*?)\s+Q(?=\s|$)/g)){
                const name=op[1].match(/(\/[^\s]+)\s+Do\s*$/)?.[1],pix=images.get(name);
                if(!pix)continue;
                const matrices=[...op[1].matchAll(/^((?:[-+.\dEe]+\s+){5}[-+.\dEe]+)\s+cm$/gm)].map(m=>m[1].trim().split(/\s+/).map(Number));
                const matrix=matrices.reduce(multiply,identity);
                imageOperators.push({pix,matrix});
              }
              const seals=imageOperators.filter(i=>i.pix[0]===480&&i.pix[1]===480);
              const scans=imageOperators.filter(i=>!seals.includes(i));
              return {size:[pg.getWidth(),pg.getHeight()],seals,scans};
            });
          },Array.from(fromReview));
          const expectedPt=42*72/25.4,near=(x,y,margin=.02)=>assert.ok(Math.abs(x-y)<margin,x+' ≈ '+y);
          assert.equal(geometry.length,expectedPages);
          for(const [i,g] of geometry.entries()){
            assert.equal(g.seals.length,1,'one company image drawn on page '+(i+1));
            const [a,b,c,d,x,y]=g.seals[0].matrix;
            near(Math.hypot(a,b),expectedPt);near(Math.hypot(c,d),expectedPt);
            assert.ok(x>=0&&y>0&&x+a<=g.size[0]&&y+d<=g.size[1],'the actual stamp is inside, not touching a corner');
          }
          const center=page=>{
            const [a,b,c,d,x,y]=geometry[page-1].seals[0].matrix,[w,h]=geometry[page-1].size;
            return [(x+(a+c)/2)/w,1-(y+(b+d)/2)/h];
          };
          for(const a of companyPlan.sealAnchors){
            const [w,h]=geometry[a.pageIndex].size,[x,y]=center(a.pageIndex+1);
            near(x,(a.x+a.width/2)/w,.035);
            near(y,1-(a.y+a.height/2)/h,.035);
          }
          const anchor=center(explicitPdf());
          for(const page of [firstPdf(),lastPdf()])center(page).forEach((v,i)=>near(v,anchor[i],.001));
          assert.ok(anchor[0]>.52&&anchor[0]<.88&&anchor[1]>.70&&anchor[1]<.82,'detected Chinese label anchors inside its sign-off region');
          const last=geometry.at(-1);
          assert.equal(last.scans.length,1,'the unlabelled image attachment remains present');
          const [w,, ,h,x,y]=last.scans[0].matrix;
          const [sx,sy]=center(lastAnnex());
          near(sx*last.size[0],x+.72*w,.03);
          near((1-sy)*last.size[1],y+.27*h,.03);
          steps.push('all '+expectedPages+' PDF page transforms show exactly one 42×42 mm company seal; closing anchors retained across reflow; Chinese attachment sign-off is inherited; no-label image uses inset');
        }
        const names=['审计报价-正文和附件-待复核.pdf','审计报价-正文和附件-待复核.pdf','审计报价-正文和附件逐页盖章-待复核.pdf'];
        if(hasSignedToolbar){
          await assertToolbar(true,'preview is prepared and can be explicitly downloaded');
          assert.deepEqual(await download('#quote-download-signed-complete'),fromReview,'the toolbar and signed preview deliver the exact same PDF bytes');
          names.push(names.at(-1));
          steps.push('signed complete-PDF toolbar action remains visible, activates only after authorized preview, and downloads byte-identical output');
        }
        assert.deepEqual(downloads.splice(0),names);
        if(hasWordToolbar){
          assert.equal(await q('#quote-sealed-review').isVisible(),true,'a real signed preview is present while downloading the unsigned copy');
          assert.equal(await q('#quote-download-sealed-pdf').isEnabled(),true,'the inner signed PDF download remains separate and available');
          const wordWhileSigned=await checkUnsignedWordZip();
          assert.deepEqual(wordWhileSigned,wordBefore,'selecting and generating a signed PDF cannot alter unsigned Word bytes');
          assert.equal(await q('#quote-sealed-review').isVisible(),true,'downloading unsigned Word does not discard the signed review');
          steps.push('unsigned Word ZIP has only three clean DOCX files, unchanged even after preparing a signed review');
        }
        steps.push('identified saved company seal, unsigned always unsigned, separate visible stamped PDF review before explicit download');
        if(hasAttachmentPlacement){
          steps.push(fixedSeal?'visible company mark on Chinese sign-off, both aligned attachment pages, and inset no-label image (no corner duplicates)'
            :'attachment page with an explicit sign-off label receives the visible seal there, while pages without a label keep one footer mark');
          const pdfAnnex=q('#quote-preview-attachments [data-annex-index="3"]');
          const summary=pdfAnnex.locator('summary'),stage=pdfAnnex.locator('[data-company-seal-stage]');
          await summary.click();
          const waitAnnexPage=n=>stage.getByRole('img',{name:new RegExp('第 '+n+' 页')}).waitFor({state:'visible'});
          await waitAnnexPage(1);
          await pdfAnnex.getByRole('button',{name:'下一页'}).click();await waitAnnexPage(2);
          await pdfAnnex.locator('[data-company-seal-place]').click();
          const surface=stage.locator('canvas'),bounds=await surface.boundingBox();
          assert.ok(bounds&&bounds.width>100&&bounds.height>100);
          await surface.click({position:{x:Math.round(bounds.width*.28),y:Math.round(bounds.height*.40)}});
          const marker=pdfAnnex.locator('[data-company-seal-marker]');
          await marker.waitFor({state:'visible'});
          assert.equal(await q('#quote-page-seal').isChecked(),false,'setting a manual placement revokes previous authorization');
          assert.equal(await q('#quote-sealed-review').isVisible(),false);
          await assertToolbar(false,'manual placement invalidates existing download');
          await pdfAnnex.getByRole('button',{name:'上一页'}).click();await waitAnnexPage(1);
          assert.equal(await marker.isVisible(),false,'manual placement belongs to one page');
          await pdfAnnex.getByRole('button',{name:'下一页'}).click();await waitAnnexPage(2);
          await marker.waitFor({state:'visible'});
          await q('#quote-page-seal').check();
          await q('#quote-preview-sealed-pdf').click();
          await q(rendered).waitFor({state:'visible'});
          await goSignedPage(explicitPdf());await assertRenderedSeal(explicitPdf(),'extra-manual');
          assert.equal(await q(rendered).evaluate(hasCompanySealPixels,'extra-auto'),false,'manual placement overrides rather than duplicates auto placement');
          if(fixedSeal){
            for(const page of [firstPdf(),lastPdf()]){
              await goSignedPage(page);await assertRenderedSeal(page,'extra-auto');
              assert.equal(await q(rendered).evaluate(hasCompanySealPixels,'extra-manual'),false,'manual placement must not leak onto adjacent page '+page);
            }
          }
          await assertToolbar(true,'manual placement can be downloaded after fresh approval');
          assert.equal(downloads.length,0,'placement and renewed review cannot download automatically');
          await pdfAnnex.locator('[data-company-seal-clear]').click();
          assert.equal(await q('#quote-page-seal').isChecked(),false,'clearing placement requires another confirmation');
          await assertToolbar(false,'clearing placement disables toolbar download of prior bytes');
          steps.push('manual mark placement overrides automatic placement on one attachment page; moving or clearing it invalidates both downloads');
        }
      }else{
        await q('#quote-page-seal').check();
        sealed=await pages(await download('#quote-complete-pdf'));
        await p.waitForFunction(()=>!document.querySelector('#quote-page-seal').checked);
        await waitText('#quote-pdf-status','每页已盖公司公章');
        assert.deepEqual(downloads.splice(0,2),['审计报价-正文和附件-待复核.pdf','审计报价-正文和附件逐页盖章-待复核.pdf']);
      }
      assert.equal(sealed.length,expectedPages);
      assert.equal(sealed[0].filter(ref=>sealed.every(row=>row.includes(ref))).length,1,'same approved seal image drawn on every body and attachment page');
      assert.equal(plain[0].filter(ref=>plain.every(row=>row.includes(ref))).length,0);
      steps.push('four annexes listed; unsigned and signed combined PDFs preserve all attachment pages and one identical approved company seal ref on each of '+expectedPages+' signed pages');
    }
    await q('#close-preview').click();
    if(directAvailable&&optionalSigning){
      const entry=q('#preview-with-seal'),rendered='#quote-sealed-preview canvas[role=img]';
      assert.match(await entry.textContent(),/选择章签/);
      const markDimensions=kinds.map(k=>[stamps[k].readUInt32BE(16),stamps[k].readUInt32BE(20)]);
      const readPdfSigning=bytes=>p.evaluate(async({bytes,colors,dims})=>{
        const L=PDFLib,d=await L.PDFDocument.load(Uint8Array.from(bytes));
        return d.getPages().map(pg=>{
          const objects=pg.node.Resources()?.lookupMaybe(L.PDFName.of('XObject'),L.PDFDict),has=new Set();
          for(const [,ref] of objects?.entries()||[]){
            const im=d.context.lookup(ref),get=k=>im?.dict?.get(L.PDFName.of(k));
            const w=get('Width')?.asNumber(),h=get('Height')?.asNumber();
            if(String(get('Subtype'))!=='/Image'||!dims.some(([a,b])=>w===a&&h===b))continue;
            const rgb=L.decodePDFRawStream(im).decode();
            if(rgb.length!==w*h*3)continue;
            const hits=colors.map(()=>0);
            for(let i=0;i<rgb.length;i+=3)colors.forEach(([r,g,b],idx)=>{if(rgb[i]===r&&rgb[i+1]===g&&rgb[i+2]===b)hits[idx]++;});
            hits.forEach((n,i)=>{if(n>20)has.add(i);});
          }
          return [...has].sort();
        });
      },{bytes:Array.from(bytes),colors:roleColors,dims:markDimensions});
      for(const enabled of [[l],[s],kinds]){
        await entry.click();await q('#quote-dialog[open]').waitFor();
        await assertFreshChoice();
        assert.equal(await q('#quote-dialog').getAttribute('data-preview-mode'),'plain');
        assert.equal(await q('#customer-preview').isVisible(),true);
        assert.equal(await q('#customer-preview img').count(),0);
        assert.equal(downloads.length,0,'opening role selection cannot download or apply a stamp');
        await waitForKinds(kinds);
        for(const k of enabled)await roleInput(k).check();
        assert.equal(await q('#quote-page-seal').isChecked(),false);
        assert.equal(await q('#quote-preview-sealed-pdf').isDisabled(),true);
        await q('#quote-page-seal').check();
        await q('#quote-preview-sealed-pdf').click();
        await q(rendered).waitFor({state:'visible'}).catch(async error=>{
          throw Error('Signed PDF review failed for '+enabled.join(', ')+': '+await q('#quote-pdf-status').textContent(),{cause:error});
        });
        assert.equal(downloads.length,0,'preparing a signed review cannot start a download');
        assert.equal(await q('#quote-sealed-review').isVisible(),true);
        const signed=await download('#quote-download-sealed-pdf');
        const bodyRoles=enabled.map(k=>kinds.indexOf(k)),annexRoles=enabled.includes(c)?[0]:[];
        const plan=fixedSeal?await renderedBodyPlan(enabled.filter(k=>k!==c)):null;
        const expectedBody=plan?Array.from({length:plan.pageCount},(_,i)=>[
          ...(enabled.includes(c)?[0]:[]),...plan.roleAnchors.filter(a=>a.pageIndex===i).map(a=>kinds.indexOf(a.kind)).sort()
        ]):Array(3).fill(bodyRoles);
        if(plan)for(const k of enabled.filter(k=>k!==c))assert.equal(plan.roleAnchors.filter(a=>a.kind===k).length,3);
        assert.deepEqual(await readPdfSigning(signed),[
          ...expectedBody,...Array(annexPages).fill(annexRoles)
        ],'only selected role images are embedded, non-company choices stay in the body closings');
        assert.deepEqual(downloads.splice(0),['审计报价-章签-待复核.pdf']);
        if(enabled.length===3){
          const n=firstClosing(plan||companyPlan);
          if(n!==1){
            await q('#quote-sealed-preview').getByRole('combobox',{name:'跳转到预览页'}).selectOption(String(n));
            await p.waitForFunction(([selector,n])=>document.querySelector(selector)?.getAttribute('aria-label')?.includes('第 '+n+' 页'),[rendered,n]);
          }
          assert.ok(await q(rendered).evaluate(hasCompanySealPixels,'anchor'),'all marks retain visible company seal at first closing');
          await roleInput(s).uncheck();
          assert.equal(await q('#quote-page-seal').isChecked(),false,'role edits revoke the previously confirmed selection');
          assert.equal(await q('#quote-preview-sealed-pdf').isDisabled(),true);
          assert.equal(await q('#quote-sealed-review').isVisible(),false,'stale signed copy no longer visible');
          assert.equal(await q('#quote-download-sealed-pdf').isEnabled(),false,'stale signed copy no longer downloadable');
          await assertToolbar(false,'editing mark choices must also disable the toolbar shortcut');
        }
        await q('#close-preview').click();
      }
      steps.push('three role options default off; legal only, signature only and all three sign independently; changed choices revoke authorization and stale downloads');
    }else if(directAvailable){
      const entry=q('#preview-with-seal'),rendered='#quote-sealed-preview canvas[role=img]';
      assert.match(await entry.textContent(),/公章/);
      await entry.click();
      await q('#quote-dialog[open]').waitFor();
      assert.equal(await q('#quote-dialog').getAttribute('data-preview-mode'),'sealed');
      assert.equal(await q('#customer-preview').isVisible(),false,'sealed mode cannot silently present an ordinary draft');
      assert.equal(await q('#quote-complete-pdf').isVisible(),false,'sealed mode cannot offer a competing unsigned download');
      await waitText('#quote-seal-source-status','已读取公司公章');
      const checkDirectPage=async n=>{
        await p.waitForFunction(([selector,n])=>document.querySelector(selector)?.getAttribute('aria-label')?.includes('第 '+n+' 页'),[rendered,n]);
        assert.ok(await q(rendered).first().evaluate(hasCompanySealPixels,sealPlacement(n)),'direct stamped preview shows real synthetic seal pixels on page '+n);
      };
      await checkDirectPage(1);
      assert.equal(await q('#quote-sealed-review').isVisible(),true);
      for(const n of [4,5,8]){
        await q('#quote-sealed-preview').getByRole('combobox',{name:'跳转到预览页'}).selectOption(String(n));
        await checkDirectPage(n);
      }
      assert.equal(downloads.length,0,'direct preview never downloads');
      const direct=await download('#quote-download-sealed-pdf');
      const pages=await p.evaluate(async b=>(await PDFLib.PDFDocument.load(Uint8Array.from(b))).getPageCount(),Array.from(direct));
      assert.equal(pages,8);
      assert.deepEqual(downloads.splice(0),['审计报价-正文和附件逐页盖章-待复核.pdf']);
      await q('#close-preview').click();
      steps.push('direct stamped entry shows rendered seals on the body closing, both credential faces and the final annex footer; downloads only on request');
    }
    const ordinary=packet(await download('#export-current-quote'));
    assert.ok(ordinary.m.documents.every(d=>!d.appliedSigningKinds.length));
    for(const [entry,bytes] of ordinary.m.attachments.map(a=>[a,a.kind==='business_license'?license:certificate]).concat([[ordinary.m.extras[0],pdf],[ordinary.m.extras[1],unselected]]))assert.deepEqual(ordinary.files.get(entry.path),bytes);
    steps.push('three template previews and ZIP contain no image marks; original bytes unchanged');
    await q('#quote-sign-review').click();await q('#quote-sign-dialog[open]').waitFor();
    assert.equal(await q('#quote-sign-generate').isEnabled(),false);
    const req='格式1报价函须加盖法人章。\n格式2报价函须加盖公司公章。\n格式3报价函须由投标人签字。\n独立性承诺书须加盖公司公章和法人章，并由投标人签字。';
    await q('#quote-sign-source').setInputFiles({name:'虚构采购章签要求.txt',mimeType:'text/plain',buffer:Buffer.from(req)});
    await waitText('#quote-sign-status','已更新建议');
    const row=id=>q('[data-sign-item="'+id+'"]');
    const picked=async id=>row(id).locator('input[data-sign-kind]:checked').evaluateAll(nodes=>nodes.map(n=>n.value));
    for(const [id,kinds] of [['quote:format1',hasWordToolbar?[c,l]:[l]],['quote:format2',[c]],['quote:format3',[s]],['extra:0',[c,l,s]],['extra:1',[]],['cert:business_license',[]],['cert:practice_certificate',[]]])assert.deepEqual(await picked(id),kinds,id);
    if(hasWordToolbar){
      await row('quote:format1').locator('input[data-sign-kind][value="company_seal"]').uncheck();
      assert.deepEqual(await picked('quote:format1'),[l],'a suggested company seal remains a user-editable choice');
    }
    assert.equal(await q('#quote-sign-generate').isEnabled(),false);
    await q('#quote-sign-confirmed').check();
    await q('#quote-sign-generate').click();
    await waitText('#quote-sign-status','页码和落点');
    assert.equal(downloads.length,1,'attachment cannot be marked/exported without a page or location');
    await row('extra:0').locator('[data-sign-page]').fill('2');
    await row('extra:0').locator('[data-sign-position]').selectOption('bottom-right');
    assert.equal(await q('#quote-sign-generate').isEnabled(),false);
    await q('#quote-sign-confirmed').check();
    const signed=packet(await download('#quote-sign-generate'));await q('#quote-sign-dialog[open]').waitFor({state:'hidden'});
    assert.deepEqual(signed.m.documents.map(d=>d.appliedSigningKinds),[[l],[c],[s]]);
    assert.deepEqual(signed.m.extras[0].appliedSigningKinds,[c,l,s]);assert.deepEqual(signed.m.extras[0].placement,{page:2,position:'bottom-right'});
    assert.equal(signed.m.extras[0].source.sha256,sha(pdf));assert.notEqual(signed.m.extras[0].sha256,sha(pdf));
    const rendered=await p.evaluate(async b=>{
      const d=await PDFLib.PDFDocument.load(Uint8Array.from(b));
      return d.getPages().map(page=>page.node.Resources().lookupMaybe(PDFLib.PDFName.of('XObject'),PDFLib.PDFDict)?.keys().length||0);
    },Array.from(signed.files.get(signed.m.extras[0].path)));
    assert.deepEqual(rendered,fixedSeal?[0,3,0]:[0,3]);assert.match(signed.m.extras[0].path,/章签待复核\.pdf$/);
    for(const [entry,bytes] of signed.m.attachments.map(a=>[a,a.kind==='business_license'?license:certificate]).concat([[signed.m.extras[1],unselected]])){
      assert.deepEqual(entry.appliedSigningKinds,[]);assert.equal(entry.source,undefined);assert.deepEqual(signed.files.get(entry.path),bytes);
    }
    assert.deepEqual(downloads,['审计报价草稿-含必带附件.zip','审计报价-章签副本-待复核.zip']);
    steps.push('named requirements per file, human confirmation and explicit PDF placement, three actual images on page 2 only, untouched attachments unchanged');
    await q('#quote-sign-review').click();await q('#quote-sign-dialog[open]').waitFor();
    assert.equal(await q('#quote-sign-confirmed').isChecked(),false);
    assert.equal(await q('#quote-sign-generate').isEnabled(),false);
    await q('#quote-sign-close').click();
    const again=packet(await download('#export-current-quote'));
    assert.deepEqual(again.files,ordinary.files,'one-time confirmation cannot leak marks into subsequent ordinary ZIP');
    steps.push('signed download leaves subsequent ordinary export byte-for-byte unchanged');
    if(reviewAvailable){
      // A new preview discards prior authorization and any already prepared
      // stamped copy. A removed company mark must not borrow the legal seal.
      await q('#preview').click();await q('#quote-dialog[open]').waitFor();
      assert.equal(await q('#quote-page-seal').isChecked(),false);
      assert.equal(await q('#quote-preview-sealed-pdf').isDisabled(),true);
      assert.equal(await q('#quote-download-sealed-pdf').isVisible()&&await q('#quote-download-sealed-pdf').isEnabled(),false);
      await q('#close-preview').click();
      await q('[data-view=bidders]').click();
      await q('[data-bidder-edit="'+id+'"]').click();
      await waitText('#bidder-editor-status','正在编辑已保存资料');
      await q('#bidder-clear-company_seal').click();await q('#bidder-save').click();
      await waitText('#bidder-editor-status','已保存 ');
      await q('[data-view=quote]').click();
      if(directAvailable){
        const entry=q('#preview-with-seal');
        if(await entry.isEnabled()){
          await entry.click();await q('#quote-dialog[open]').waitFor();
          await waitText('#quote-seal-source-status','重新带入');
          assert.equal(await q('#quote-sealed-review').isVisible(),false);
          assert.equal(await q('#quote-download-sealed-pdf').isEnabled(),false);
          await assertToolbar(false,'stale bidder archive cannot generate signed bytes through the toolbar');
          await q('#close-preview').click();
        }
        steps.push('a direct preview cannot use the previously selected profile version after the library changed');
      }
      await q('#bidder-apply').click();
      await p.waitForFunction(()=>!document.querySelector('#preview').disabled);
      await q('#preview').click();await q('#quote-dialog[open]').waitFor();
      if(optionalSigning)await waitForKinds([l,s]);
      else await waitText('#quote-seal-source-status','未找到公司公章');
      assert.equal(await q('#quote-preview-sealed-pdf').isDisabled(),true);
      assert.equal(await q('#quote-sealed-review').isVisible(),false);
      if(optionalSigning){
        assert.equal(await roleInput(c).isDisabled(),true,'missing company seal must not borrow another mark');
        await waitForKinds([l,s]);
        assert.equal(await q('#preview-with-seal').isEnabled(),true,'legal/signature choices are independent of company seal availability');
        await roleInput(l).check();await q('#quote-page-seal').check();
        assert.equal(await q('#quote-preview-sealed-pdf').isEnabled(),true,'can choose a legal-only preview without a company seal');
      }else if(directAvailable)assert.equal(await q('#preview-with-seal').isDisabled(),true,'primary direct action cannot borrow another seal');
      assert.equal(await q('#quote-complete-pdf').isEnabled(),true);
      steps.push('new dialog requires fresh authorization; missing company mark is not substituted by a different mark');
      await q('#close-preview').click();
    }
    assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,entry:html,browser:browser.version(),steps,downloads,remote,errors,ordinarySha256:sha(ordinary.files.get('附件清单.json')),signedSha256:sha(signed.files.get('附件清单.json'))}));
  }catch(e){console.error(JSON.stringify({passed:false,steps,remote,errors,downloads}));throw e;}
  finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
