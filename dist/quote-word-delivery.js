/* One local, unsigned DOCX: existing quotation layouts, then every annex page.
 * No signing assets are accepted, looked up, or applied. Existing marks on a
 * scanned certificate remain part of that original page. Nothing is uploaded. */
(function(root){
  'use strict';
  const PDF='application/pdf',PNG='image/png',JPG='image/jpeg';
  const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG='http://schemas.openxmlformats.org/package/2006/relationships';
  const A='http://schemas.openxmlformats.org/drawingml/2006/main';
  const PIC='http://schemas.openxmlformats.org/drawingml/2006/picture';
  const WP='http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const LABELS=Object.freeze({business_license:'营业执照',practice_certificate:'执业证书'});
  const LIMITS=Object.freeze({attachments:12,pages:100,inputBytes:36*1024*1024,
    imagePixels:16000000,totalPixels:48000000,outputBytes:12*1024*1024,pageWaitMs:23000,operationMs:180000});
  const enc=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const fail=s=>{throw Error(s);};
  function abort(){const e=Error('报价已切换或操作已取消，未生成文件。');e.name='AbortError';throw e;}
  function xml(raw){
    const s=typeof raw==='string'?raw:decoder.decode(raw);
    if(/<!DOCTYPE|<!ENTITY/i.test(s))fail('Word 模板包含不支持的实体。');
    const doc=new root.DOMParser().parseFromString(s,'application/xml');
    if(doc.getElementsByTagName('parsererror').length)fail('Word 模板 XML 无法读取。');
    return doc;
  }
  const serialize=n=>new root.XMLSerializer().serializeToString(n);
  const paragraph=s=>'<w:p><w:pPr><w:spacing w:after="90" w:line="260" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">'+esc(s)+'</w:t></w:r></w:p>';
  const pageBreak='<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  function drawing(id,width,height,label){
    // Reserve room for the annex title; never stretch or crop a source page.
    const scale=Math.min(9240*635/width,12800*635/height),cx=Math.round(width*scale),cy=Math.round(height*scale);
    return '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0" w:line="240"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="'+cx+'" cy="'+cy+'"/><wp:docPr id="'+id+'" name="annex-page-'+id+'" descr="'+esc(label)+'"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="'+PIC+'"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="annex-page-'+id+'"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdAnnex'+id+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }
  function pngSize(bytes){
    if(!(bytes instanceof Uint8Array)||bytes.length<33||!new Uint8Array([137,80,78,71,13,10,26,10]).every((v,i)=>bytes[i]===v))fail('附件静态页面无法编码为 PNG。');
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=v.getUint32(16),height=v.getUint32(20);
    if(!width||!height||width>12000||height>12000||width*height>LIMITS.imagePixels)fail('附件页面尺寸超出安全范围。');
    return {width,height};
  }
  async function canvasPng(canvas,check){
    check();
    const blob=await new Promise((resolve,reject)=>{try{canvas.toBlob(b=>b?resolve(b):reject(Error('附件页图片编码失败。')),PNG);}catch(e){reject(e);}});
    check();const bytes=new Uint8Array(await blob.arrayBuffer());check();
    const size=pngSize(bytes);
    if(size.width!==canvas.width||size.height!==canvas.height)fail('附件页图片尺寸校验失败。');
    return {bytes,...size};
  }
  // PDFLib performs structural inspection only; PDF.js supplies the same local
  // static rendering used by QuoteAnnexPreview. Neither library sends files out.
  async function inspectPdf(file,check){
    const L=root.PDFLib;if(!L?.PDFDocument)fail('本机 PDF 校验组件未加载，无法完整加入附件。');
    let doc;
    try{doc=await L.PDFDocument.load(file.bytes,{ignoreEncryption:false,throwOnInvalidObject:true,updateMetadata:false});}
    catch{fail(file.name+'：PDF 已加密、损坏或无法读取。');}
    check();const count=doc.getPageCount(),objects=doc.context.enumerateIndirectObjects();
    if(count<1||count>LIMITS.pages||objects.length>20000)fail(file.name+'：PDF 页数或结构超出安全范围。');
    const keys=new Set(['/ByteRange','/Perms','/DSS','/AcroForm','/XFA','/OpenAction','/AA','/JS','/JavaScript','/EmbeddedFiles','/AF','/RichMediaContent','/Collection','/EF']);
    const values=new Set(['/Sig','/DocMDP','/JavaScript','/Launch','/SubmitForm','/ImportData','/GoToE','/RichMedia','/FileAttachment','/3D','/Movie','/Screen','/Sound']);
    const seen=new Set(),stack=[doc.catalog,...objects.map(x=>x[1])];
    while(stack.length){
      const v=stack.pop();if(!v||seen.has(v))continue;seen.add(v);
      if(seen.size>180000)fail(file.name+'：PDF 结构超出安全范围。');
      if(v instanceof L.PDFDict){for(const [key,val] of v.entries()){
        if(keys.has(key.toString())||(['S','Subtype','Type','FT','TransformMethod'].some(k=>key.toString()==='/'+k)&&val instanceof L.PDFName&&values.has(val.toString())))
          fail(file.name+'：PDF 含数字签名、交互内容或嵌入文件，请先在原软件另存为静态 PDF。');
        stack.push(val);
      }}else if(v instanceof L.PDFArray){for(let i=0;i<v.size();i++)stack.push(v.get(i));}
      else if(v instanceof L.PDFStream)stack.push(v.dict);
    }
    for(const p of doc.getPages()){
      const b=p.getMediaBox(),c=p.getCropBox(),u=p.node.get(L.PDFName.of('UserUnit'));
      const angle=((p.getRotation().angle%360)+360)%360;
      const annotations=p.node.lookupMaybe(L.PDFName.of('Annots'),L.PDFArray);
      if(annotations?.size())fail(file.name+'：PDF 含批注、链接或表单，请先转为静态 PDF，避免漏掉可见内容。');
      if(![0,90,180,270].includes(angle)||b.x!==0||b.y!==0||c.x!==0||c.y!==0||c.width!==b.width||c.height!==b.height||
        ![b.width,b.height].every(n=>Number.isFinite(n)&&n>=1&&n<=7200)||(u&&(!(u instanceof L.PDFNumber)||u.asNumber()!==1)))
        fail(file.name+'：PDF 页面尺寸、裁切或坐标异常，请先另存为完整静态 PDF。');
    }
    return count;
  }
  async function imagePage(file,check){
    if(typeof root.createImageBitmap!=='function')fail('浏览器不支持安全图片解码，请使用新版 Chrome、Edge 或 Safari。');
    if(file.mime===PNG){
      const v=new DataView(file.bytes.buffer,file.bytes.byteOffset,file.bytes.byteLength);
      for(let at=8;at+12<=file.bytes.length;){
        const type=v.getUint32(at+4);
        if([0x6163544c,0x6663544c,0x66644154].includes(type))fail(file.name+'：动画 PNG 不能只取第一帧，请先转换成静态图片或 PDF。');
        at+=12+v.getUint32(at);
      }
    }
    let bitmap,canvas;
    try{
      bitmap=await root.createImageBitmap(new root.Blob([file.bytes],{type:file.mime}),{imageOrientation:'from-image'});check();
      if(!Number.isSafeInteger(bitmap.width)||!Number.isSafeInteger(bitmap.height)||bitmap.width<1||bitmap.height<1||bitmap.width>12000||bitmap.height>12000||bitmap.width*bitmap.height>LIMITS.imagePixels)
        fail(file.name+'：图片超过 1600 万像素或尺寸异常。');
      canvas=root.document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const g=canvas.getContext('2d');if(!g)fail('浏览器无法绘制附件。');
      g.fillStyle='#fff';g.fillRect(0,0,canvas.width,canvas.height);g.drawImage(bitmap,0,0);
      return await canvasPng(canvas,check);
    }finally{bitmap?.close?.();if(canvas)canvas.width=canvas.height=0;}
  }
  async function pdfPages(file,count,check,signal,onPage){
    if(!root.QuoteAnnexPreview?.mountPdf)fail('本机 PDF 预览组件未加载，无法完整加入附件。');
    const host=root.document.createElement('div');host.hidden=true;host.setAttribute('aria-hidden','true');
    host.dataset.quoteWordRaster='';root.document.body.append(host);
    let dispose,pending,timer,expected=1,closed=false;
    const reject=e=>{clearTimeout(timer);const p=pending;pending=null;p?.reject(e);};
    const cancelled=()=>{try{check();}catch(e){reject(e);dispose?.();}};
    const wait=()=>new Promise((resolve,reject)=>{
      pending={resolve,reject};timer=setTimeout(()=>{const e=Error(file.name+'：附件页面渲染超时，未生成不完整文件。');const p=pending;pending=null;p?.reject(e);},LIMITS.pageWaitMs);
    });
    const ready=async info=>{
      if(closed||!pending)return;
      const p=pending;
      try{
        check();if(info.page!==expected||info.pageCount!==count)fail(file.name+'：PDF 页码与校验结果不一致。');
        const canvas=host.querySelector('canvas');if(!canvas)fail(file.name+'：PDF 页未完整绘制。');
        const page=await canvasPng(canvas,check);check();
        if(pending!==p)return;clearTimeout(timer);pending=null;p.resolve(page);
      }catch(e){reject(e);}
    };
    signal?.addEventListener('abort',cancelled,{once:true});
    try{
      let waiting=wait();
      dispose=root.QuoteAnnexPreview.mountPdf(host,{bytes:file.bytes,name:file.name,onReady:ready,onError:reject});
      for(let n=1;n<=count;n++){
        check();const page=await waiting;check();await onPage(page,n,count);check();
        if(n<count){
          expected=n+1;waiting=wait();
          const select=host.querySelector('select[aria-label="跳转到预览页"]');
          if(!select||select.disabled||select.options.length!==count)fail(file.name+'：无法逐页读取全部附件。');
          select.value=String(expected);select.dispatchEvent(new root.Event('change',{bubbles:true}));
        }
      }
    }finally{closed=true;clearTimeout(timer);signal?.removeEventListener('abort',cancelled);dispose?.();host.remove();}
  }
  function captureOptions(input,snapshot,Q){
    if(!input||typeof input!=='object'||Array.isArray(input))fail('报价 Word 选项无效。');
    const out={};
    for(const [k,d] of Object.entries(Object.getOwnPropertyDescriptors(input))){
      if(!Object.hasOwn(d,'value'))fail('报价 Word 选项不能包含动态取值。');
      if(/seal|sign|stamp|asset|image|confirmed/i.test(k))fail('无章 Word 不接受印章或签字素材。');
      // Legacy UI repeats the rows in options; accept only an independently
      // validated exact match, then use the snapshot's private copy exclusively.
      if(k==='quoteRows'){
        if(!snapshot.quoteRows||JSON.stringify(Q.normalizeSnapshot({...snapshot,quoteRows:d.value}).quoteRows)!==JSON.stringify(snapshot.quoteRows))
          fail('分户报价明细与报价快照不一致。');
        continue;
      }
      if(d.value!==null&&typeof d.value==='object')fail('报价 Word 选项只能使用普通字段。');
      out[k]=d.value;
    }
    return out;
  }
  async function build({snapshot,attachments,extras=[],formats=[],options={},signal,isCurrent}={}){
    const Q=root.QuotePacket,L=root.QuoteLayouts,S=root.ProjectWorkspaceStore;
    if(!Q?.verifyPair||!Q?.verifyExtras||!L?.render||!L?.packOfficeParts||!S?.parts||!root.DOMParser||!root.XMLSerializer||!root.document?.body)
      fail('本机报价 Word 组件未加载完整，请重新打开页面。');
    if(signal&&(!('aborted' in signal)||typeof signal.addEventListener!=='function'))fail('取消信号无效。');
    if(isCurrent!==undefined&&typeof isCurrent!=='function')fail('报价切换校验无效。');
    const deadline=Date.now()+LIMITS.operationMs;
    const check=()=>{if(signal?.aborted||isCurrent&&isCurrent()!==true)abort();if(Date.now()>deadline)fail('报价 Word 生成超时，请缩小附件后重试。');};
    check();
    if(!Array.isArray(formats)||formats.length>L.catalog.length||new Set(formats).size!==formats.length||formats.some(id=>!L.catalog.some(x=>x.id===id)))fail('报价格式选择无效。');
    const chosen=L.catalog.filter(x=>(formats.length?formats:[L.catalog[0].id]).includes(x.id)).map(x=>x.id);
    const s=Q.normalizeSnapshot(snapshot),o=captureOptions(options,s,Q);
    // These validators copy all binary inputs before the first digest await.
    const pairPromise=Q.verifyPair(attachments),extraPromise=Q.verifyExtras(extras);
    const [pair,other]=await Promise.all([pairPromise,extraPromise]);check();
    const all=[...pair,...other];
    if(all.length>LIMITS.attachments||all.reduce((n,a)=>n+a.size,0)>LIMITS.inputBytes)fail('附件总大小超出安全范围。');
    for(const f of all)if(![PDF,PNG,JPG].includes(f.mime))fail(f.name+'：Word、Excel 等原件不能无损嵌入报价 Word，请先转为 PDF 后重新添加；本次未生成文件。');
    let base,sect,styles,formatParts=[];
    const allowed=new Set(['[Content_Types].xml','_rels/.rels','word/styles.xml','word/document.xml','word/_rels/document.xml.rels']);
    for(const id of chosen){
      check();const generated=await L.render(s,id,[],{...o,previewOnly:false});check();
      if(!(generated.docx instanceof Uint8Array))fail('报价格式没有生成完整 Word。');
      const parts=await S.parts(new root.File([generated.docx],'quotation.docx',{type:L.docxMime}));check();
      if(Object.keys(parts).length!==allowed.size||Object.keys(parts).some(n=>!allowed.has(n)))fail('报价 Word 模板包含额外素材，已停止无章导出。');
      const rel=xml(parts['word/_rels/document.xml.rels']);
      const relations=Array.from(rel.getElementsByTagNameNS(PKG,'Relationship'));
      if(relations.length!==1||relations[0].getAttribute('Type')!==R+'/styles'||relations[0].getAttribute('Target')!=='styles.xml'||relations[0].hasAttribute('TargetMode'))fail('报价 Word 模板含外部关系或图片关系。');
      const doc=xml(parts['word/document.xml']),b=doc.getElementsByTagNameNS(W,'body');
      if(b.length!==1||doc.getElementsByTagNameNS(W,'drawing').length||doc.getElementsByTagNameNS(W,'object').length||doc.getElementsByTagNameNS(W,'altChunk').length)fail('报价 Word 模板含非无章正文内容。');
      const ss=Array.from(b[0].children).filter(n=>n.namespaceURI===W&&n.localName==='sectPr');
      if(ss.length!==1||b[0].lastElementChild!==ss[0])fail('报价 Word 模板分节结构无法合并。');
      const st=decoder.decode(parts['word/styles.xml']);
      if(styles!==undefined&&styles!==st)fail('所选报价模板样式冲突，未生成不完整文件。');
      styles=st;
      if(!base){base=parts;sect=serialize(ss[0]);}
      formatParts.push(Array.from(b[0].childNodes).filter(n=>n!==ss[0]).map(serialize).join(''));
    }
    let media=0,totalPixels=0,outputEstimate=Object.values(base).reduce((n,b)=>n+b.length,0);
    const fragments=[formatParts.join(pageBreak)],manifest=[];
    for(const [i,file] of all.entries()){
      check();const count=file.mime===PDF?await inspectPdf(file,check):1;check();
      if(media+count>LIMITS.pages)fail('全部附件超过 100 页，请分批整理后再生成。');
      const label=LABELS[file.kind]||'附加附件 '+(i-1);
      const record={kind:file.kind,name:file.name,sha256:file.sha256,size:file.size,pageCount:count,pages:[]};
      const add=async(page,n)=>{
        check();const pixels=page.width*page.height;
        if(pixels>LIMITS.imagePixels||totalPixels+pixels>LIMITS.totalPixels)fail('附件页面总像素超过安全限制，未截断输出。');
        totalPixels+=pixels;outputEstimate+=page.bytes.length;
        if(outputEstimate>LIMITS.outputBytes-65536)fail('报价 Word 超过 12 MiB，请压缩附件或降低扫描分辨率后重试。');
        const id=++media,target='media/annex-'+id+'.png';base['word/'+target]=page.bytes;
        fragments.push(pageBreak+paragraph(label+' · '+file.name+' · 第 '+n+' / '+count+' 页')+drawing(id,page.width,page.height,label+'第 '+n+' 页'));
        record.pages.push({sourcePage:n,part:'word/'+target,width:page.width,height:page.height});
      };
      if(file.mime===PDF)await pdfPages(file,count,check,signal,add);else await add(await imagePage(file,check),1);
      manifest.push(Object.freeze({...record,pages:Object.freeze(record.pages.map(Object.freeze))}));
    }
    check();
    // One document, one final section, shared unchanged quotation styles.
    base['word/document.xml']=XML+'<w:document xmlns:w="'+W+'" xmlns:r="'+R+'" xmlns:wp="'+WP+'" xmlns:a="'+A+'" xmlns:pic="'+PIC+'"><w:body>'+fragments.join('')+sect+'</w:body></w:document>';
    xml(base['word/document.xml']);
    base['word/_rels/document.xml.rels']=XML+'<Relationships xmlns="'+PKG+'"><Relationship Id="rIdStyles" Type="'+R+'/styles" Target="styles.xml"/>'+Array.from({length:media},(_,i)=>'<Relationship Id="rIdAnnex'+(i+1)+'" Type="'+R+'/image" Target="media/annex-'+(i+1)+'.png"/>').join('')+'</Relationships>';
    const bytes=L.packOfficeParts(base);check();
    if(bytes.length>LIMITS.outputBytes)fail('报价 Word 超过安全大小限制，未生成文件。');
    return Object.freeze({blob:new root.Blob([bytes],{type:L.docxMime}),bytes,name:'审迹报价单-无章含附件.docx',mime:L.docxMime,
      unsigned:true,formats:Object.freeze(chosen),attachmentPages:media,manifest:Object.freeze(manifest)});
  }
  const api=Object.freeze({build,LIMITS});
  root.QuoteWordDelivery=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
