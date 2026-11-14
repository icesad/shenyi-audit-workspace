'use strict';
const {test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const dir=path.resolve(__dirname,'..','dist');
test('complete local quote PDF: ordered, both credentials, exact originals, per-page company imprint, explicit refusal',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('no installed Playwright');}
  const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(executable))return t.skip('no installed Chromium');
  const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});
  try{
    const context=await browser.newContext(),remote=[],errors=[];context.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(path.join(dir,'rule-catalog.js')).href);
    for(const n of ['quote-packet.js','vendor-quote-pdf-lib.js','quote-attachment-stamps.js','vendor-bidder-pdf.js','bidder-pdf-text.js','quote-complete-pdf.js'])
      await page.addScriptTag({content:fs.readFileSync(path.join(dir,n),'utf8')});
    const result=await page.evaluate(async keep=>{
      const Q=QuotePacket,L=PDFLib,S=QuoteCompletePdf,PN='image/png',PDF='application/pdf',JPG='image/jpeg';
      const expect=(ok,msg)=>{if(!ok)throw Error(msg);};
      const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
      const bad=async(fn,re)=>{try{await fn();}catch(e){expect(re.test(e.message),e.message);return;}throw Error('Invalid input unexpectedly generated a PDF');};
      const file=(b,n,m)=>new File([b],n,{type:m});
      const cert=(b,n,m,k)=>Q.readAttachment(file(b,n,m),k),extra=(b,n,m)=>Q.readExtra(file(b,n,m));
      const paint=async(m,kind)=>new Promise((ok,no)=>{
        const c=document.createElement('canvas');c.width=kind==='seal'||kind==='signature'?160:kind==='legal'?72:410;c.height=kind==='seal'?160:kind==='signature'?52:kind==='legal'?72:290;
        const g=c.getContext('2d');
        if(kind==='seal'){
          g.strokeStyle='#d22324';g.fillStyle='#d22324';g.lineWidth=9;g.beginPath();g.arc(80,80,73,0,Math.PI*2);g.stroke();
          g.font='bold 24px sans-serif';g.textAlign='center';g.fillText('TEST',80,86);
        }else if(kind==='legal'||kind==='signature'){
          g.strokeStyle=kind==='legal'?'#a10c0c':'#181628';g.lineWidth=5;g.strokeRect(8,8,c.width-16,c.height-16);
        }else{
          g.fillStyle=kind==='licence'?'#e0f2e9':'#e9eaf8';g.fillRect(0,0,c.width,c.height);g.strokeStyle='#1c5146';g.lineWidth=6;g.strokeRect(3,3,c.width-6,c.height-6);
          g.font='bold 24px sans-serif';g.fillStyle='#122f29';g.textAlign='center';g.fillText('SYNTHETIC '+kind.toUpperCase(),205,95);
          g.font='16px sans-serif';g.fillText('Example only - not valid',205,145);
        }
        c.toBlob(b=>b?ok(b):no(Error('fixture creation failed')),m,.94);
      });
      const pdf=async(labels,modify)=>{
        const d=await L.PDFDocument.create(),font=await d.embedFont(L.StandardFonts.Helvetica);
        for(const [i,label] of labels.entries()){
          const p=d.addPage([595.28,841.89]);
          if(label){
            p.drawRectangle({x:16,y:12,width:563,height:818,borderColor:L.rgb(.15,.32,.27),borderWidth:2});
            p.drawText(label,{x:60,y:740,size:24,font});
            p.drawText('Source text at bottom - must not be covered',{x:50,y:27,size:12,font});
          }
          modify?.(p,d,i);
        }
        return d.save();
      };
      const body=await pdf(['Synthetic proposal 1','Synthetic proposal 2']);
      const license=await cert(await paint(PN,'licence'),'license.png',PN,'business_license');
      const practice=await cert(await pdf(['Synthetic certificate 1','Synthetic certificate 2']),'practice.pdf',PDF,'practice_certificate');
      const attachments=[license,practice,await extra(await paint(JPG,'extra'),'extra.jpg',JPG),await extra(await pdf([null]),'blank.pdf',PDF)];
      const seal={...await cert(await paint(PN,'seal'),'DEMO.png',PN,'business_license'),kind:'company_seal'};
      const l='legal_representative_seal',s='bidder_signature';
      const roleAssets=await Promise.all([[l,'legal'],[s,'signature']].map(async ([kind,style])=>({
        ...await cert(await paint(PN,style),style+'.png',PN,'business_license'),kind
      })));
      const originals=[body,...attachments.map(a=>a.bytes),seal.bytes,...roleAssets.map(a=>a.bytes)].map(b=>b.slice());
      const unsigned=await S.build({body,attachments}),signed=await S.build({body,attachments,seal,position:'bottom-right'});
      const a=await L.PDFDocument.load(unsigned.bytes),b=await L.PDFDocument.load(signed.bytes);
      const anchors=[{pageIndex:1,x:420,y:200,width:105,height:88}];
      const anchored=await L.PDFDocument.load((await S.build({body,bodySealAnchors:anchors,attachments,seal,position:'bottom-right'})).bytes);
      const ops=(pdf,index)=>{
        const x=pdf.getPage(index).node.Contents();
        const refs=x instanceof L.PDFArray?x.asArray():[x];
        return refs.map(ref=>new TextDecoder().decode(L.decodePDFRawStream(pdf.context.lookup(ref)).decode())).join('\n');
      };
      expect(ops(anchored,1).includes('1 0 0 1 0 0 cm'),'anchored body page retains original full-size positioning');
      const matrices=(doc,index)=>Array.from(ops(doc,index).matchAll(/^([-.0-9]+(?: [-.0-9]+){5}) cm$/gm),m=>m[1].split(' ').map(Number));
      const lastDraw=(doc,index)=>matrices(doc,index).slice(-4);
      const translation=(doc,index)=>lastDraw(doc,index)[0].slice(4);
      const near=(a,b)=>Math.abs(a-b)<.01;
      const side=42*72/25.4;
      expect(S.COMPANY_SEAL_MM===42,'physical seal size exposed to UI verification');
      const center=(doc,n)=>{
        const [x,y]=translation(doc,n),[w,,,h]=lastDraw(doc,n)[2];
        expect(near(w,side)&&near(h,side),'square company seal is 42 mm on page '+(n+1));
        return [x+w/2,y+h/2];
      };
      const sameCenter=(doc,n,x,y)=>{
        const at=center(doc,n);
        expect(near(at[0],x)&&near(at[1],y),'company seal positioned where expected on page '+(n+1));
      };
      sameCenter(anchored,1,472.5,244);
      for(const n of [0,6])sameCenter(anchored,n,595.28*.72,841.89*.27);
      const [[,,,,extraX,extraY],,[extraW,,,extraH]]=matrices(a,5);
      sameCenter(anchored,5,extraX+extraW*.72,extraY+extraH*.27);
      for(const n of [2,3,4])sameCenter(anchored,n,595.28/2,841.89/2);
      expect(JSON.stringify(matrices(anchored,5).slice(0,4))===JSON.stringify(matrices(a,5)),'default image content retains the unsigned scale and position');
      expect(ops(anchored,0).includes('1 0 0 1 0 0 cm'),'unanchored source remains full size without a footer');
      expect(JSON.stringify(signed.attachmentSealPlacement)===JSON.stringify({auto:0,manual:0,aligned:0,default:2}),'unrelated blank and image each get defaults');
      expect(JSON.stringify(matrices(anchored,2).slice(0,4))===JSON.stringify(matrices(a,2)),'image credential uses the unsigned full-size placement');
      for(const n of [3,4])expect(ops(anchored,n).includes('1 0 0 1 0 0 cm'),'PDF credential keeps its source placement');
      expect((ops(anchored,1).match(/ Do/g)||[]).length===2,'exactly body and one seal draw on anchored page');
      await bad(()=>S.build({body,bodySealAnchors:[...anchors,...anchors],attachments,seal,position:'bottom-right'}),/报价落款位置无效/);
      const xobjs=(d,n)=>d.getPage(n).node.Resources()?.lookupMaybe(L.PDFName.of('XObject'),L.PDFDict);
      const forms=(d,n)=>{
        const xs=xobjs(d,n);if(!xs)return [];
        return xs.entries().map(([,ref])=>d.context.lookup(ref).dict.get(L.PDFName.of('Subtype')).toString());
      };
      const signingAnchors=[{kind:l,pageIndex:1,x:288,y:104,width:96,height:52},{kind:s,pageIndex:1,x:420,y:104,width:105,height:52}];
      const composeRoles=async (roles,withSeal=false,opts={})=>L.PDFDocument.load((await S.build({
        body,bodySealAnchors:anchors,attachments,...withSeal?{seal,position:'bottom-right'}:{},
        bodySigningAssets:roleAssets.filter(a=>roles.includes(a.kind)),bodySigningAnchors:signingAnchors.filter(a=>roles.includes(a.kind)),...opts
      })).bytes);
      const legalOnly=await composeRoles([l]),sigOnly=await composeRoles([s]),allMarks=await composeRoles([l,s],true);
      for(const [doc,kind] of [[legalOnly,l],[sigOnly,s]]){
        for(let n=0;n<7;n++){
          const expected=n===1?['/Form','/Image']:forms(a,n);
          expect(JSON.stringify(forms(doc,n))===JSON.stringify(expected),'role alone marks only the sign-off page: '+kind);
        }
        const p=signingAnchors.find(a=>a.kind===kind),[x,y]=translation(doc,1),[w,,,h]=lastDraw(doc,1)[2];
        expect(near(x+w/2,p.x+p.width/2)&&near(y+h/2,p.y+p.height/2),'role uses only its declared sign-off position');
      }
      for(let n=0;n<7;n++){
        const expected=n===1?['/Form','/Image','/Image','/Image']:forms(anchored,n);
        expect(JSON.stringify(forms(allMarks,n))===JSON.stringify(expected),'all roles preserve company-only behavior away from the closing '+n);
      }
      const roleRefs=xobjs(allMarks,1).entries().slice(-2).map(([,ref])=>ref);
      expect(roleRefs.every(ref=>allMarks.context.lookup(ref).dict.has(L.PDFName.of('SMask'))),'both role PNGs keep transparency');
      expect(roleRefs.every(ref=>Array.from({length:7},(_,n)=>n).filter(n=>xobjs(allMarks,n).entries().some(([,r])=>String(r)===String(ref))).join()==='1'),'extra body marks never occur on annex pages');
      await bad(()=>composeRoles([l],false,{bodySigningAnchors:undefined}),/缺少对应落款/);
      await bad(()=>composeRoles([l],false,{bodySigningAnchors:[{...signingAnchors[0],pageIndex:0}]}),/签署位置无效/);
      await bad(()=>composeRoles([l,s],true,{bodySigningAnchors:[signingAnchors[0],{...signingAnchors[1],x:300}]}),/重叠/);
      await bad(()=>composeRoles([l,s],false,{bodySigningAssets:[roleAssets[0],roleAssets[0]]}),/图样无效/);
      await bad(()=>composeRoles([s],false,{bodySigningAssets:[{...roleAssets[1],sha256:'0'.repeat(64)}]}),/投标人签字.*SHA-256/);
      // Portable text-layer fixture: Latin fallback glyphs carry synthetic Chinese
      // via an explicit Unicode map. No project/firm data or OS font is required.
      const annexDoc=await L.PDFDocument.create(),annexFont=await annexDoc.embedFont(L.StandardFonts.Helvetica);
      const chars=new Map(),enc=t=>Array.from(t,ch=>{
        if(!chars.has(ch))chars.set(ch,String.fromCharCode(33+chars.size));
        return chars.get(ch);
      }).join('');
      const annexPage=()=>annexDoc.addPage([595.28,841.89]);
      const annexText=(p,t,x,y)=>p.drawText(enc(t),{font:annexFont,size:12,x,y});
      const one=annexPage(),two=annexPage(),three=annexPage(),four=annexPage(),five=annexPage(),six=annexPage();
      annexText(one,'单位（',332,564);annexText(one,'盖章）：合成样本',332+annexFont.widthOfTextAtSize(enc('单位（'),12),564);
      annexText(two,'投标单位：合成事务所',330,230);
      annexText(two,'授权代表（签字）：',330,205);
      annexText(two,'日期：',330,180);
      annexText(three,'单位（盖章）：',300,210);annexText(three,'投标人（盖章）：',300,140);
      annexText(four,'授权代表（签字）：',340,205);annexText(four,'日期：',340,178);
      const scan=await annexDoc.embedJpg(attachments[2].bytes);
      five.drawImage(scan,{x:0,y:0,width:595.28,height:841.89});
      annexText(six,'联系人及中介机构（签章）：',300,766);
      await annexDoc.flush();
      const entries=Array.from(chars,([a,b])=>'<'+b.charCodeAt(0).toString(16).padStart(2,'0')+'> <'+a.charCodeAt(0).toString(16).padStart(4,'0')+'>').join('\n');
      const cmap=['/CIDInit /ProcSet findresource begin','12 dict begin','begincmap',
        '/CIDSystemInfo << /Registry (Synthetic) /Ordering (Unicode) /Supplement 0 >> def',
        '/CMapName /Synthetic-UTF16 def','/CMapType 2 def','1 begincodespacerange','<00> <FF>','endcodespacerange',
        chars.size+' beginbfchar',entries,'endbfchar','endcmap','CMapName currentdict /CMap defineresource pop','end','end'].join('\n');
      annexDoc.context.lookup(annexFont.ref).set(L.PDFName.of('ToUnicode'),
        annexDoc.context.register(annexDoc.context.flateStream(new TextEncoder().encode(cmap))));
      const annexBytes=await annexDoc.save(),annex=await extra(annexBytes,'synthetic-signoffs.pdf',PDF);
      const found=await BidderPdfText.readPositioned(annexBytes);
      expect(found.pages[0]?.items.map(i=>i.text).join('').includes('单位（盖章）：'),'offline worker reads real glyph positions and CJK text');
      expect(found.pages[4]?.items.length===0,'scan has no usable text');
      const annexAttachments=[license,practice,annex,attachments[2],attachments[3]],annexCopy=annex.bytes.slice();
      const buildAnnex=opts=>S.build({body,attachments:annexAttachments,seal,position:'bottom-right',...opts});
      const auto=await buildAnnex(),autoPdf=await L.PDFDocument.load(auto.bytes);
      expect(JSON.stringify(auto.attachmentSealPlacement)===JSON.stringify({auto:3,manual:0,aligned:3,default:2}),'explicit/qualified pages anchor, unanchored same-file pages align, other files do not inherit');
      for(const [n,baseline] of [[5,564],[6,230],[10,766]]){
        const [cx,cy]=center(autoPdf,n);
        expect(cx>300&&cx<400&&near(cy,baseline+5),'company seal centers on the organization line rather than date/signature');
        expect(ops(autoPdf,n).includes('1 0 0 1 0 0 cm')&&(ops(autoPdf,n).match(/ Do/g)||[]).length===2,'anchored source is at original size and company stamp drawn once');
      }
      expect(found.pages[5]?.items.some(i=>i.text.includes('联系人及中介机构（签章）：')),'exact screenshot marker recognized even high on a later page');
      for(const [n,src] of [[7,6],[8,6],[9,10]])sameCenter(autoPdf,n,...center(autoPdf,src));
      sameCenter(autoPdf,11,extraX+extraW*.72,extraY+extraH*.27);
      sameCenter(autoPdf,12,595.28*.72,841.89*.27);
      const manual=[{extraIndex:0,page:1,x:.31,y:.42},{extraIndex:0,page:5,x:.47,y:.62},{extraIndex:1,page:1,x:.6,y:.4}];
      const manualJson=JSON.stringify(manual),repositioned=await buildAnnex({attachmentSealOverrides:manual});
      expect(JSON.stringify(repositioned.attachmentSealPlacement)===JSON.stringify({auto:2,manual:3,aligned:2,default:1}),'manual override takes priority and supports scan and standalone image');
      const manualPdf=await L.PDFDocument.load(repositioned.bytes);
      for(const [n,point] of [[5,manual[0]],[9,manual[1]]])sameCenter(manualPdf,n,595.28*point.x,841.89*(1-point.y));
      sameCenter(manualPdf,11,extraX+extraW*.6,extraY+extraH*.6);
      sameCenter(manualPdf,8,...center(autoPdf,6));
      const unanchoredAnnex=await extra(await pdf([null,null]),'manual-no-propagation.pdf',PDF);
      const manualOnly=await buildAnnex({attachments:[license,practice,unanchoredAnnex],attachmentSealOverrides:[manual[0]]});
      expect(JSON.stringify(manualOnly.attachmentSealPlacement)===JSON.stringify({auto:0,manual:1,aligned:0,default:1}),'a manual point never seeds another page');
      const soleDoc=await L.PDFDocument.create(),soleFont=await soleDoc.embedFont(L.StandardFonts.Helvetica);
      soleDoc.addPage([595.28,841.89]).drawText('Company seal: Synthetic CPA',{font:soleFont,size:12,x:250,y:300});
      soleDoc.addPage([595.28,841.89]);
      const soleAnnex=await extra(await soleDoc.save(),'sole-recognized-signoff.pdf',PDF);
      const sole=await buildAnnex({attachments:[license,practice,soleAnnex],attachmentSealOverrides:[manual[0]]});
      expect(JSON.stringify(sole.attachmentSealPlacement)===JSON.stringify({auto:0,manual:1,aligned:1,default:0}),'manual on the sole recognized page does not change the neighboring page');
      const solePdf=await L.PDFDocument.load(sole.bytes);
      sameCenter(solePdf,5,595.28*manual[0].x,841.89*(1-manual[0].y));
      const [neighborX,neighborY]=center(solePdf,6);
      expect(neighborX>250&&neighborX<310&&near(neighborY,305),'neighbor uses original detected signoff, not the clicked point');
      const rectangle={...roleAssets[1],kind:'company_seal'};
      const rectanglePdf=await L.PDFDocument.load((await S.build({body,attachments:[license,practice],seal:rectangle,position:'bottom-right'})).bytes);
      for(let n=0;n<rectanglePdf.getPageCount();n++){
        const [w,,,h]=lastDraw(rectanglePdf,n)[2];
        expect(near(w,side)&&near(h,side*52/160),'rectangular company PNG preserves aspect inside the physical box');
      }
      const smallDoc=await L.PDFDocument.create();smallDoc.addPage([110,200]);
      const small=await extra(await smallDoc.save(),'too-small.pdf',PDF);
      await bad(()=>buildAnnex({attachments:[license,practice,small]}),/too-small.pdf.*42 × 42/);
      expect(JSON.stringify(manual)===manualJson&&same(annex.bytes,annexCopy),'manual choice and attachment bytes unchanged');
      await bad(()=>buildAnnex({attachmentSealOverrides:[{...manual[0],page:7}]}),/超出附件页数/);
      await bad(()=>buildAnnex({attachmentSealOverrides:[{...manual[2],page:2}]}),/超出附件页数/);
      await bad(()=>buildAnnex({attachmentSealOverrides:[{...manual[0],x:1.01}]}),/手动位置无效/);
      await bad(()=>buildAnnex({attachmentSealOverrides:[{...manual[0],extraIndex:3}]}),/手动位置无效/);
      await bad(()=>buildAnnex({attachmentSealOverrides:[manual[0],manual[0]]}),/多个公章位置/);
      await bad(()=>buildAnnex({seal:null,position:undefined,attachmentSealOverrides:[manual[0]]}),/手动位置无效/);
      const certificateCopy=await S.buildCertificates([practice,license]);
      const c=await L.PDFDocument.load(certificateCopy.bytes);
      expect(certificateCopy.pageCount===3&&c.getPageCount()===3,'two credentials retain all three pages, without quote/extra pages');
      expect(JSON.stringify(certificateCopy.sections)===JSON.stringify([
        {name:'license.png',startPage:1,endPage:1},{name:'practice.pdf',startPage:2,endPage:3}
      ]),'license first regardless of argument order');
      expect(JSON.stringify([forms(c,0),forms(c,1),forms(c,2)])===JSON.stringify([['/Image'],[],[]]),'print copy includes no image seal or extra body');
      expect(c.getTitle()==='营业执照及执业证书','certificate print copy is identified');
      const jpgPractice=await cert(await paint(JPG,'practice'),'practice.jpg',JPG,'practice_certificate');
      const j=await L.PDFDocument.load((await S.buildCertificates([jpgPractice,license])).bytes);
      expect(j.getPageCount()===2&&forms(j,1).length===1&&forms(j,1)[0]==='/Image','JPEG credentials can be printed');
      await bad(()=>S.buildCertificates([practice]),/营业执照.*执业证书/);
      await bad(()=>S.buildCertificates([license,practice,attachments[2]]),/营业执照.*执业证书/);
      const rotatedLicense=await cert(await pdf(['Rotation 90','Rotation 180','Rotation 270'],(p,d,i)=>p.setRotation(L.degrees((i+1)*90))),'rotated-license.pdf',PDF,'business_license');
      const rotatedCopy=await L.PDFDocument.load((await S.buildCertificates([rotatedLicense,practice])).bytes);
      const rotatedSigned=await L.PDFDocument.load((await S.build({body,attachments:[rotatedLicense,practice],seal,position:'bottom-right'})).bytes);
      const unitTransforms=[[0,1,-1,0],[-1,0,0,-1],[0,-1,1,0]];
      for(let i=0;i<3;i++){
        const rotation=(i+1)*90,n=2+i;
        expect(rotatedCopy.getPage(i).getRotation().angle===rotation&&rotatedSigned.getPage(n).getRotation().angle===rotation,'both output paths preserve a normal PDF quarter-turn');
        const [[,,,,x,y],[a0,b0,c0,d0],[w,,,h]]=lastDraw(rotatedSigned,n);
        expect([a0,b0,c0,d0].every((v,j)=>near(v,unitTransforms[i][j])),'seal counteracts PDF display rotation');
        expect(near(w,side)&&near(h,side),'rotated credential company seal still 42 mm');
        expect(near(x+(a0*w+c0*h)/2,595.28/2)&&near(y+(b0*w+d0*h)/2,841.89/2),'rotated seal stays centered');
      }
      const badLicense=await cert(await pdf(['invalid geometry'],p=>{p.setRotation(L.degrees(90));p.setCropBox(0,0,400,600);}), 'cropped-license.pdf',PDF,'business_license');
      await bad(()=>S.buildCertificates([badLicense,practice]),/cropped-license\.pdf.*裁切/);
      await bad(()=>S.build({body,attachments:[badLicense,practice],seal,position:'bottom-right'}),/cropped-license\.pdf.*裁切/);
      const sections=[
        {name:'报价正文',startPage:1,endPage:2},{name:'license.png',startPage:3,endPage:3},
        {name:'practice.pdf',startPage:4,endPage:5},{name:'extra.jpg',startPage:6,endPage:6},
        {name:'blank.pdf',startPage:7,endPage:7}
      ];
      expect(JSON.stringify(signed.sections)===JSON.stringify(sections),'source page order');
      expect(signed.pageCount===7&&unsigned.pageCount===7&&a.getPageCount()===7&&b.getPageCount()===7,'both files contain every page');
      const expectedUnsigned=[[],[],['/Image'],[],[],['/Image'],[]],expectedSigned=[['/Form','/Image'],['/Form','/Image'],['/Image','/Image'],['/Form','/Image'],['/Form','/Image'],['/Image','/Image'],['/Image']];
      for(let i=0;i<7;i++){
        expect(JSON.stringify(forms(a,i))===JSON.stringify(expectedUnsigned[i]),'unsigned page '+(i+1));
        expect(JSON.stringify(forms(b,i))===JSON.stringify(expectedSigned[i]),'each signed page contains an extra image '+(i+1));
        expect(Math.abs(a.getPage(i).getWidth()-b.getPage(i).getWidth())<.01&&Math.abs(a.getPage(i).getHeight()-b.getPage(i).getHeight())<.01,'paper sizes unchanged');
      }
      const sealRef=xobjs(b,0).entries().at(-1)[1],sealRefs=Array.from({length:7},(_,i)=>xobjs(b,i).entries().at(-1)[1].toString());
      expect(new Set(sealRefs).size===1,'only one reused company seal image');
      expect(b.context.lookup(sealRef).dict.has(L.PDFName.of('SMask')),'the transparent PNG keeps its alpha as a PDF soft mask');
      expect([body,...attachments.map(f=>f.bytes),seal.bytes,...roleAssets.map(a=>a.bytes)].every((bytes,i)=>same(bytes,originals[i])),'source bytes untouched');
      await bad(()=>S.build({body,attachments,seal}),/确认.*落点/);
      await bad(()=>S.build({body,attachments,seal:{...seal,kind:'bidder_signature'},position:'bottom-right'}),/公司公章/);
      await bad(()=>S.build({body,attachments:[practice]}),/营业执照.*执业证书/);
      await bad(()=>S.build({body,attachments:[license,practice,{...attachments[2],mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',name:'manual.docx'}]}),/manual\.docx.*不能直接合入/);
      const rotated=await extra(await pdf(['rotated'],p=>p.setRotation(L.degrees(90))),'rotated.pdf',PDF);
      await bad(()=>S.build({body,attachments:[license,practice,rotated]}),/rotated\.pdf.*旋转/);
      const cropped=await extra(await pdf(['cropped'],p=>p.setCropBox(0,0,400,600)),'cropped.pdf',PDF);
      await bad(()=>S.build({body,attachments:[license,practice,cropped],seal,position:'bottom-left'}),/cropped\.pdf.*裁切/);
      const annotated=await extra(await pdf(['annotated'],(p,d)=>p.node.set(L.PDFName.of('Annots'),d.context.obj([{Type:'Annot',Subtype:'Text',Rect:[20,20,40,40]}]))),'annotated.pdf',PDF);
      await bad(()=>S.build({body,attachments:[license,practice,annotated]}),/annotated\.pdf.*批注/);
      const unparseable=await extra(new TextEncoder().encode('%PDF-1.7\nNot really a PDF.\n%%EOF\n'),'corrupt.pdf',PDF);
      await bad(()=>S.build({body,attachments:[license,practice,unparseable]}),/corrupt\.pdf.*损坏|corrupt\.pdf.*结构/);
      const altered={...practice,bytes:practice.bytes.slice()};altered.bytes[30]^=1;
      await bad(()=>S.build({body,attachments:[license,altered]}),/practice\.pdf.*SHA-256/);
      return {pages:signed.pageCount,sections,...(keep?{fixture:Array.from(signed.bytes)}:{})};
    },!!process.env.QUOTE_COMPLETE_PDF_SYNTHETIC_OUTPUT);
    if(process.env.QUOTE_COMPLETE_PDF_SYNTHETIC_OUTPUT)
      fs.writeFileSync(process.env.QUOTE_COMPLETE_PDF_SYNTHETIC_OUTPUT,Buffer.from(result.fixture),{flag:'wx'});
    assert.equal(result.pages,7);assert.equal(result.sections.length,5);assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
