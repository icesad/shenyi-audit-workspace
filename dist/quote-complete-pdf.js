/* Build a self-contained, local copy. Never amend the source files.
 * Company seals use a fixed 42 mm box at the sign-off, credential face,
 * aligned annex point, or lower-right inset without scaling source pages.
 * Other selected marks can only use their own anchors on quote closing pages. */
(function(root){
  'use strict';
  const PDF='application/pdf',PNG='image/png',JPG='image/jpeg',COMPANY='company_seal';
  const POSITIONS=Object.freeze(['bottom-right','bottom-left']); // legacy input validation
  const COMPANY_SEAL_MM=42,COMPANY_SEAL_PT=COMPANY_SEAL_MM*72/25.4;
  const DEFAULT_SEAL_POINT=Object.freeze({x:.72,y:.73});
  const BODY_SIGN_ROLES=Object.freeze({legal_representative_seal:'法人章',bidder_signature:'投标人签字'});
  const signLabel=k=>k===COMPANY?'公司公章':BODY_SIGN_ROLES[k];
  const MIB=1024*1024,LIMITS=Object.freeze({
    attachmentCount:12,pageCount:100,bodyBytes:24*MIB,inputBytes:60*MIB,outputBytes:80*MIB,
    attachmentPixels:16000000,totalAttachmentPixels:48000000,sealPixels:4000000
  });
  const PAGE=Object.freeze([595.28,841.89]);
  const CERTS=['business_license','practice_certificate'];
  const die=s=>{throw Error(s);};
  function api(){
    if(!root.PDFLib?.PDFDocument||!root.QuoteAttachmentStamps?.inspect)die('完整 PDF 组件未加载，请重新打开页面。');
    return root.PDFLib;
  }
  const validBytes=(b,limit)=>b instanceof Uint8Array&&b.byteLength>0&&b.byteLength<=limit;
  const label=(s,fallback)=>typeof s==='string'&&s?s.slice(0,160):fallback;
  function cloneRecord(r){
    return Object.freeze({kind:r.kind,name:r.name,mime:r.mime,size:r.size,sha256:r.sha256,bytes:new Uint8Array(r.bytes)});
  }
  async function checkedFile(f,credential=false){
    // Reuse the strict SHA, image dimensions, APNG/EXIF orientation,
    // encryption/active PDF contents and page geometry validation.
    let info;
    try{info=await root.QuoteAttachmentStamps.inspect(f);}
    catch(e){if(/[\u3400-\u9fff]/.test(e?.message||''))throw e;die(f.mime===PDF?'PDF 已加密、损坏或结构无法读取。':'图片已损坏或无法解析。');}
    const invalid=info.pages.find(p=>!p.usable);
    // Quarter-turn credential PDFs have usable page geometry after the
    // dedicated validation in addPdf. inspect still enforces source safety.
    if(invalid&&!(credential&&f.mime===PDF))die('第 '+invalid.page+' 页有旋转、裁切或坐标异常，请用原软件另存正向、未裁切的 PDF。');
    return info;
  }
  async function loadPdf(bytes,L){
    let d,n;try{d=await L.PDFDocument.load(bytes,{ignoreEncryption:false,throwOnInvalidObject:true,updateMetadata:false,parseSpeed:L.ParseSpeeds.Fast});n=d.getPageCount();}
    catch{die('PDF 已加密、损坏或无法解析。');}
    if(n<1||n>LIMITS.pageCount)die('PDF 页数超出完整报价处理范围。');
    return d;
  }
  function checkedPdfPage(page,L,credential){
    // Embedding a PDF page as a form would silently omit annotations, so
    // reject even benign annotations rather than lose visible material.
    const annotKey=L.PDFName.of('Annots');
    if(page.node.has(annotKey)){
      const annots=page.node.lookupMaybe(annotKey,L.PDFArray);
      if(!annots||annots.size())die('PDF 含批注、链接或表单，请先在原软件中另存为不含交互内容的 PDF。');
    }
    const b=page.getMediaBox(),c=page.getCropBox(),u=page.node.get(L.PDFName.of('UserUnit'));
    const rotation=((page.getRotation().angle%360)+360)%360;
    if((credential?![0,90,180,270].includes(rotation):rotation!==0)||
      b.x!==0||b.y!==0||c.x!==0||c.y!==0||b.width!==c.width||b.height!==c.height||
      (u&&(!(u instanceof L.PDFNumber)||u.asNumber()!==1))||![b.width,b.height].every(n=>Number.isFinite(n)&&n>=72&&n<=7200))
      die('PDF 页面有旋转、裁切或坐标异常。');
    return [b.width,b.height,rotation];
  }
  async function image(doc,f,expected){
    if(typeof root.createImageBitmap!=='function')die('当前浏览器不能验证图片，请用新版 Chrome 或 Edge 打开。');
    let bitmap;
    try{
      bitmap=await root.createImageBitmap(new root.Blob([f.bytes],{type:f.mime}));
      if(bitmap.width!==expected.width||bitmap.height!==expected.height)die('图片的方向或尺寸不一致。');
      const im=await (f.mime===PNG?doc.embedPng(f.bytes):doc.embedJpg(f.bytes));
      if(im.width!==expected.width||im.height!==expected.height)die('图片的尺寸不一致。');
      return im;
    }catch(e){die('图片无法正常解码或嵌入。'+(e.message?.includes('不一致')?e.message:''));}
    finally{bitmap?.close?.();}
  }
  function fit(i,maxW,maxH){
    const s=Math.min(maxW/i.width,maxH/i.height);
    return {width:i.width*s,height:i.height*s};
  }
  function drawCompanySeal(page,im,L,anchor,rotation=0){
    const size=fit(im,COMPANY_SEAL_PT,COMPANY_SEAL_PT);
    if(size.width<4||size.height<4)die('公司公章图样的长宽比例不适合盖章，请更换图样。');
    // Compensate for a PDF credential's page rotation so the seal stays upright.
    const [cos,sin]=[[1,0],[0,1],[-1,0],[0,-1]][rotation/90];
    const offX=(cos*size.width-sin*size.height)/2,offY=(sin*size.width+cos*size.height)/2;
    page.drawImage(im,{...size,x:anchor.x+COMPANY_SEAL_PT/2-offX,y:anchor.y+COMPANY_SEAL_PT/2-offY,rotate:L.degrees(rotation)});
  }
  function validAnchor(a,sizes){
    return a&&Number.isInteger(a.pageIndex)&&a.pageIndex>=0&&a.pageIndex<sizes.length&&
      [a.x,a.y,a.width,a.height].every(Number.isFinite)&&a.width>=4&&a.height>=4&&
      a.width<=144&&a.height<=144&&a.x>=0&&a.y>=0&&a.x+a.width<=sizes[a.pageIndex][0]&&a.y+a.height<=sizes[a.pageIndex][1];
  }
  function anchorsFor(input,sizes){
    const map=new Map();
    if(input===undefined)return map;
    if(!Array.isArray(input)||input.length>sizes.length)die('报价落款位置无效。');
    for(const a of input){
      if(!validAnchor(a,sizes)||map.has(a.pageIndex))die('报价落款位置无效。');
      map.set(a.pageIndex,{x:a.x,y:a.y,width:a.width,height:a.height});
    }
    return map;
  }
  function signingAnchorsFor(input,sizes,closings,images){
    const map=new Map();
    if(!images.size){
      if(input!==undefined&&(!Array.isArray(input)||input.length))die('没有选中的图样，不能应用正文章签位置。');
      return map;
    }
    if(!closings.size||!Array.isArray(input)||input.length!==closings.size*images.size)
      die('报价正文缺少对应落款签署位置，未生成章签副本。');
    const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
    for(const a of input){
      if(!validAnchor(a,sizes)||!images.has(a.kind)||!closings.has(a.pageIndex))
        die('报价正文签署位置无效，未生成章签副本。');
      const list=map.get(a.pageIndex)||[];
      if(overlaps(a,closings.get(a.pageIndex))||list.some(b=>a.kind===b.kind||overlaps(a,b)))
        die('报价正文签署位置重复或重叠，未生成章签副本。');
      list.push({kind:a.kind,x:a.x,y:a.y,width:a.width,height:a.height});map.set(a.pageIndex,list);
    }
    return map;
  }
  function drawAnchor(page,im,anchor,kind){
    const size=fit(im,anchor.width,anchor.height);
    if(size.width<4||size.height<4)die(signLabel(kind)+'图样的长宽比例不适合盖章，请更换图样。');
    page.drawImage(im,{...size,x:anchor.x+(anchor.width-size.width)/2,y:anchor.y+(anchor.height-size.height)/2});
  }
  function companyBox(page,cx,cy){
    const size=COMPANY_SEAL_PT,half=size/2;
    if(page.width<size||page.height<size)die('页面尺寸不足以放下 42 × 42 毫米的公司公章，未缩小或裁切章图。');
    return {x:Math.min(page.width-size,Math.max(0,cx-half)),
      y:Math.min(page.height-size,Math.max(0,cy-half)),width:size,height:size};
  }
  function pointAnchor(page,point,content={x:0,y:0,...page}){
    // Center relative to the displayed content, but keep the full physical
    // company seal box inside the output page even on a margin-edge click.
    return companyBox(page,content.x+point.x*content.width,content.y+(1-point.y)*content.height);
  }
  function manualAttachmentAnchors(input,count,seal){
    if(!Array.isArray(input)||input.length>LIMITS.pageCount||input.length&&!seal)die('附件公章的手动位置无效。');
    const files=new Map();
    for(const a of input){
      if(!a||!Number.isInteger(a.extraIndex)||a.extraIndex<0||a.extraIndex>=count||
        !Number.isInteger(a.page)||a.page<1||a.page>LIMITS.pageCount||
        ![a.x,a.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))die('附件公章的手动位置无效。');
      const pages=files.get(a.extraIndex)||new Map();
      if(pages.has(a.page))die('同一附件页不能指定多个公章位置。');
      pages.set(a.page,{x:a.x,y:a.y});files.set(a.extraIndex,pages);
    }
    return files;
  }
  const cleanText=s=>s.normalize('NFKC').replace(/\s+/gu,'').toLowerCase();
  const organizationRole='(?:联系人及中介机构|中介机构|审计机构|会计师事务所|投标人|投标方|投标单位|报价人|报价方|报价单位|响应人|响应方|响应单位|供应商|承诺单位|委托单位|单位|公司|机构)(?:名称)?';
  const organizationSealLabel=/\((?:加盖)?(?:(?:单位|公司)?公章|盖章|签章)\)/u.source;
  const companyNoColon=new RegExp('^'+organizationRole+organizationSealLabel+'$','u');
  const explicitCompany=new RegExp('^(?:'+organizationRole+'(?:'+organizationSealLabel+':|:(?:'+organizationSealLabel+'|(?:公司|单位)?公章))|'+
    /(?:(?:公司|单位)?公章):|(?:company|corporate|bidder|supplier|organization)(?:seal:|\((?:company)?seal\):)/u.source+')','u');
  const organizationLine=new RegExp('^(?:'+organizationRole+'|(?:company|bidder|supplier|organization)(?:name)?):','u');
  const signatureLine=/^(?:(?:(?:法定代表人|法人|授权代表|授权委托人|委托代理人|负责人)(?:\((?:签字|签名|签章)\))?):|(?:authorizedrepresentative|legalrepresentative)(?:\(signature\))?:)/u;
  const dateLine=/^(?:(?:签署日期|落款日期|日期|时间|date):|年月日$|\d{4}年\d{1,2}月\d{1,2}日$|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$)/u;
  function textLines(items,h){
    const rows=[];
    for(const item of [...items].filter(t=>t.y>=0&&t.y<=h&&t.height>=3&&t.height<=60).sort((a,b)=>b.y-a.y||a.x-b.x)){
      const row=rows.at(-1);
      if(row&&Math.abs(row.y-item.y)<=Math.min(4,Math.max(1,item.height*.26)))row.items.push(item);
      else rows.push({y:item.y,items:[item]});
    }
    const lines=[];
    for(const row of rows){
      let current;
      for(const item of row.items.sort((a,b)=>a.x-b.x)){
        if(!current||item.x-current.right>Math.max(14,Math.min(30,item.height*1.5))){
          current={x:item.x,y:row.y,right:item.x+item.width,text:item.text};
          lines.push(current);
        }else{
          current.right=Math.max(current.right,item.x+item.width);current.text+=item.text;
        }
      }
    }
    return lines.map(l=>({...l,text:cleanText(l.text)}));
  }
  function autoAttachmentPoint(page,w,h){
    if(!page||!Array.isArray(page.items)||Math.abs(w-page.width)>.05||Math.abs(h-page.height)>.05)return null;
    const lines=textLines(page.items,h);
    const explicit=lines.filter(l=>explicitCompany.test(l.text));
    if(explicit.length>1)return null; // Never guess between explicit stamp blocks.
    let candidate=explicit[0];
    if(!candidate){
      const signatures=lines.filter(l=>signatureLine.test(l.text)),dates=lines.filter(l=>dateLine.test(l.text));
      const organizations=lines.filter(l=>l.y>=h*.025&&l.y<=h*.70&&(companyNoColon.test(l.text)||organizationLine.test(l.text)));
      if(!signatures.length||!dates.length||organizations.length>64||signatures.length>64||dates.length>64)return null;
      const related=(a,b,gap)=>Math.abs(a.x-b.x)<=Math.max(42,Math.min(92,w*.16))&&
        a.y-b.y>=-3&&a.y-b.y<=gap;
      const groups=organizations.filter(o=>signatures.some(s=>related(o,s,Math.min(105,h*.16))&&
        dates.some(d=>related(s,d,Math.min(90,h*.14)))));
      if(groups.length!==1)return null;
      candidate=groups[0];
    }
    // Center close to the organization label/filled name, not the signature
    // and date lines that supplied corroborating evidence.
    return {x:(candidate.x+Math.min(w*.09,Math.max(24,(candidate.right-candidate.x)*.30)))/w,
      y:Math.max(0,1-(candidate.y+5)/h)};
  }
  async function extraPdfAnchors(source,sizes,{manual,counts}){
    if([...manual.keys()].some(page=>page>sizes.length))die('手动公章位置指定的页码超出附件页数。');
    let text=null;
    if(manual.size<sizes.length&&root.BidderPdfText?.readPositioned){
      try{const result=await root.BidderPdfText.readPositioned(source);if(result.pages?.length===sizes.length)text=result.pages;}
      catch{/* An unusable text layer is not a reason to invent an anchor. */}
    }
    const map=new Map(),automatic=sizes.flatMap(([width,height],i)=>{
      // Manual overrides only affect their own page. Keep independent
      // text-layer evidence as the alignment reference for neighboring pages.
      const point=autoAttachmentPoint(text?.[i],width,height);
      return point?[{i,point}]:[];
    });
    for(const [i,[width,height]] of sizes.entries()){
      const selected=manual.get(i+1);
      let nearest=null;
      for(const a of automatic)if(!nearest||Math.abs(a.i-i)<Math.abs(nearest.i-i))nearest=a;
      const method=selected?'manual':nearest?.i===i?'auto':nearest?'aligned':'default';
      try{map.set(i,pointAnchor({width,height},selected||nearest?.point||DEFAULT_SEAL_POINT));}
      catch(e){die('第 '+(i+1)+' 页：'+e.message);}
      counts[method]++;
    }
    return map;
  }
  async function addPdf(out,source,L,seal,remaining,anchors,credential=false,signingAnchors,signingImages=new Map(),extra){
    const d=await loadPdf(source,L);
    if(d.getPageCount()>remaining)die('完整报价包最多 100 页，未生成不完整文件。');
    const sizes=d.getPages().map((p,i)=>{
      try{return checkedPdfPage(p,L,credential);}
      catch(e){die('第 '+(i+1)+' 页：'+e.message);}
    }),byPage=anchorsFor(anchors,sizes);
    if(seal){
      for(const [i,a] of byPage){
        const [width,height]=sizes[i];
        byPage.set(i,companyBox({width,height},a.x+a.width/2,a.y+a.height/2));
      }
      if(extra)for(const [i,a] of await extraPdfAnchors(source,sizes,extra))byPage.set(i,a);
    }
    const signingByPage=signingAnchorsFor(signingAnchors,sizes,byPage,signingImages);
    if(!seal&&!signingImages.size){
      for(const p of await out.copyPages(d,d.getPageIndices()))out.addPage(p);
      return sizes.length;
    }
    for(const [i,[width,height,rotation]] of sizes.entries()){
      const src=d.getPage(i),anchor=byPage.get(i),bodyMarks=signingByPage.get(i)||[];
      if(!seal&&!bodyMarks.length){out.addPage((await out.copyPages(d,[i]))[0]);continue;}
      const p=out.addPage([width,height]);
      if(rotation)p.setRotation(L.degrees(rotation));
      const contents=src.node.Contents();
      if(contents&&(!(contents instanceof L.PDFArray)||contents.size()>0)){
        const embedded=await out.embedPage(src,{left:0,bottom:0,right:width,top:height});
        p.drawPage(embedded,{width,height,x:0,y:0});
      }
      if(seal){
        try{drawCompanySeal(p,seal,L,anchor||pointAnchor({width,height},credential?{x:.5,y:.5}:DEFAULT_SEAL_POINT),rotation);}
        catch(e){die('第 '+(i+1)+' 页：'+e.message);}
      }
      for(const a of bodyMarks)drawAnchor(p,signingImages.get(a.kind),a,a.kind);
    }
    return sizes.length;
  }
  async function compose({body,bodySealAnchors,attachments,seal=null,position,bodySigningAssets=[],bodySigningAnchors,attachmentSealOverrides=[]},certificatesOnly=false){
    const L=api(),outputLabel=certificatesOnly?'两项证照 PDF':'完整 PDF';
    if(!certificatesOnly&&!validBytes(body,LIMITS.bodyBytes))die('报价正文 PDF 为空或超过 24 MiB。');
    if(!Array.isArray(attachments)||attachments.length<2||attachments.length>LIMITS.attachmentCount||
      !CERTS.every(k=>attachments.filter(a=>a?.kind===k).length===1)||
      attachments.some(a=>!a||(!CERTS.includes(a.kind)&&a.kind!=='extra')))
      die('完整 PDF 须包含营业执照、执业证书各一份，其他附件最多十份。');
    let total=certificatesOnly?0:body.byteLength;
    for(const [i,f] of attachments.entries()){
      const name=label(f.name,'第 '+(i+1)+' 份附件');
      if(![PDF,PNG,JPG].includes(f.mime))die('「'+name+'」不能直接合入 PDF，请先转为 PDF 或图片后重新选择；本次没有生成缺附件的 PDF。');
      if(!validBytes(f.bytes,3*MIB))die('「'+name+'」为空或超过 3 MiB。');
      total+=f.bytes.byteLength;
    }
    if(seal!==null){
      if(seal.kind!==COMPANY||![PNG,JPG].includes(seal.mime)||!validBytes(seal.bytes,3*MIB))die('缺少当前事务所的有效公司公章图样。');
      if(!POSITIONS.includes(position))die('请确认逐页公司公章的落点。');
      total+=seal.bytes.byteLength;
    }else if(position!==undefined&&position!==null)die('没有公司公章图样，不能应用章签。');
    const manual=manualAttachmentAnchors(attachmentSealOverrides,attachments.filter(a=>a.kind==='extra').length,seal);
    const attachmentSealPlacement={auto:0,manual:0,aligned:0,default:0};
    if(!Array.isArray(bodySigningAssets)||bodySigningAssets.length>2||
      new Set(bodySigningAssets.map(a=>a?.kind)).size!==bodySigningAssets.length||
      Array.from(bodySigningAssets).some(a=>!a||!Object.hasOwn(BODY_SIGN_ROLES,a.kind)||![PNG,JPG].includes(a.mime)||!validBytes(a.bytes,3*MIB)))
      die('正文法人章或投标人签字图样无效。');
    total+=bodySigningAssets.reduce((n,a)=>n+a.bytes.byteLength,0);
    if(total>LIMITS.inputBytes)die('完整报价输入超过 60 MiB，请适当缩小文件。');
    const bodyBytes=certificatesOnly?null:new Uint8Array(body),records=attachments.map(cloneRecord);
    const companyRecord=seal?cloneRecord(seal):null,signingRecords=bodySigningAssets.map(cloneRecord);
    const out=await L.PDFDocument.create();out.setTitle(certificatesOnly?'营业执照及执业证书':'审计报价（待复核）');out.setCreator('审迹审计报价工作台');
    const embedMark=async record=>{
      try{
        const shape=(await checkedFile({...record,kind:CERTS[0]})).pages[0];
        if(shape.width*shape.height>LIMITS.sealPixels)die(signLabel(record.kind)+'图片像素过大。');
        return await image(out,record,shape);
      }catch(e){die('当前事务所的'+signLabel(record.kind)+'无法使用：'+e.message);}
    };
    const imprint=companyRecord?await embedMark(companyRecord):null,signingImages=new Map();
    for(const record of signingRecords)signingImages.set(record.kind,await embedMark(record));
    let pageCount=0,pixels=0,extraIndex=0;
    const sections=[];
    const add=(name,n)=>{sections.push(Object.freeze({name,startPage:pageCount+1,endPage:pageCount+n}));pageCount+=n;};
    if(bodyBytes){
      try{add('报价正文',await addPdf(out,bodyBytes,L,imprint,LIMITS.pageCount,bodySealAnchors,false,bodySigningAnchors,signingImages));}
      catch(e){die('报价正文：'+e.message);}
    }
    for(const [i,f] of records.entries()){
      const name=label(f.name,'第 '+(i+1)+' 份附件');
      try{
        if(pageCount>=LIMITS.pageCount)die(outputLabel+'最多 100 页。');
        const credential=CERTS.includes(f.kind);
        const manualPages=credential?null:manual.get(extraIndex++)||new Map();
        const extra=manualPages?{manual:manualPages,counts:attachmentSealPlacement}:undefined;
        const info=await checkedFile(f,credential);
        if(f.mime===PDF){add(name,await addPdf(out,f.bytes,L,imprint,LIMITS.pageCount-pageCount,undefined,credential,undefined,undefined,extra));continue;}
        if(manualPages&&[...manualPages.keys()].some(page=>page!==1))die('手动公章位置指定的页码超出附件页数。');
        const manualPoint=manualPages?.get(1),shape=info.pages[0];
        pixels+=shape.width*shape.height;
        if(shape.width*shape.height>LIMITS.attachmentPixels||pixels>LIMITS.totalAttachmentPixels)
          die('附件图片像素过大，请先缩小图片。');
        const im=await image(out,f,shape);
        const [width,height]=PAGE,p=out.addPage(PAGE);
        const r=fit(im,width-48,height-48);
        const box={...r,x:(width-r.width)/2,y:(height-r.height)/2};
        p.drawImage(im,box);
        if(imprint){
          drawCompanySeal(p,imprint,L,pointAnchor({width,height},credential?{x:.5,y:.5}:manualPoint||DEFAULT_SEAL_POINT,box));
          if(!credential)attachmentSealPlacement[manualPoint?'manual':'default']++;
        }
        add(name,1);
      }catch(e){die('「'+name+'」无法合入'+outputLabel+'：'+e.message+' 原件未修改。');}
    }
    let bytes;
    try{bytes=await out.save({useObjectStreams:true,addDefaultPage:false,updateFieldAppearances:false});}
    catch{die('无法生成'+outputLabel+'，请核对原附件。原件未修改。');}
    if(!validBytes(bytes,LIMITS.outputBytes))die(outputLabel+'超过 80 MiB，请适当缩小文件。');
    return Object.freeze({bytes,pageCount,sections:Object.freeze(sections),attachmentSealPlacement:Object.freeze(attachmentSealPlacement)});
  }
  async function build(options={}){return compose(options);}
  async function buildCertificates(pair){
    if(!root.QuotePacket?.verifyPair)die('证照校验组件未加载，请重新打开页面。');
    const attachments=await root.QuotePacket.verifyPair(pair);
    // verifyPair returns the business license first, then the practice certificate.
    // This path never accepts or reads a quote body, extras, or seal.
    return compose({attachments},true);
  }
  const apiExport=Object.freeze({build,buildCertificates,POSITIONS,LIMITS,COMPANY_SEAL_MM});
  root.QuoteCompletePdf=apiExport;
  if(typeof module!=='undefined'&&module.exports)module.exports=apiExport;
})(globalThis);
