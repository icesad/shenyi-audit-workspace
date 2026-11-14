/* Local quotation attachment copies. Import never uses this module; invoke only after
 * an operator confirmed the exact file, page, position, and signing image kinds.
 * This is placement of images, not a cryptographic signature or approval. */
(function(root){
  'use strict';
  const KINDS=Object.freeze(['company_seal','legal_representative_seal','bidder_signature']);
  const POSITIONS=Object.freeze(['bottom-right','bottom-left','top-right','top-left']);
  const PDF='application/pdf',PNG='image/png',JPG='image/jpeg';
  const LIMITS=Object.freeze({pageCount:200,objects:20000,attachmentPixels:16000000,signingPixels:4000000,outputBytes:3*1024*1024});
  const manual=msg=>{throw Error(msg+'，请人工处理该附件，不会修改原件。');};
  const invalid=msg=>{throw Error(msg);};
  function quote(){
    const api=root.QuotePacket;
    if(!api?.verifyExtras||!api?.verifyAttachment)invalid('附件校验模块未加载，请刷新后重试。');
    return api;
  }
  function lib(){
    if(!root.PDFLib?.PDFDocument)invalid('本机 PDF 处理组件未加载，请重新打开完整页面。');
    return root.PDFLib;
  }
  async function sourceOf(file){
    if(!file||![PDF,PNG,JPG].includes(file.mime))manual('外部 Word、Excel 或其他附件不能在此确定章签落点');
    return file.kind==='extra'?(await quote().verifyExtras([file]))[0]:await quote().verifyAttachment(file);
  }
  function scaledImage(bytes,mime,maxPixels){
    const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let width,height;
    if(mime===PNG){
      width=v.getUint32(16);height=v.getUint32(20);
      // Animation frames cannot be given a single, predictable output image.
      for(let p=8;p+12<=bytes.length;){
        const n=v.getUint32(p),k=v.getUint32(p+4);
        if(k===0x6163544c||k===0x6663544c||k===0x66644154)manual('不支持动画 PNG');
        p+=12+n;
      }
    }else{
      for(let p=2;p+4<=bytes.length;){
        if(bytes[p++]!==255)break;
        while(bytes[p]===255&&p<bytes.length)p++;
        const marker=bytes[p++];
        if(marker===1||marker>=208&&marker<=215)continue;
        if(marker===218||marker===217)break;
        if(p+2>bytes.length)break;
        const n=v.getUint16(p),start=p+2,end=p+n;
        if(n<2||end>bytes.length)break;
        if(marker===225&&n>=8&&v.getUint32(start)===0x45786966&&v.getUint16(start+4)===0){
          const t=start+6;
          if(t+8>end)manual('JPEG 方向元数据不完整');
          const endian=v.getUint16(t),little=endian===0x4949;
          if((!little&&endian!==0x4d4d)||v.getUint16(t+2,little)!==42)manual('JPEG 方向元数据无法确认');
          const d=t+v.getUint32(t+4,little);
          if(d<t+8||d+2>end)manual('JPEG 方向元数据不完整');
          const count=v.getUint16(d,little);
          if(d+2+count*12>end)manual('JPEG 方向元数据不完整');
          for(let i=0;i<count;i++){
            const q=d+2+i*12;
            if(v.getUint16(q,little)===0x112&&
              (v.getUint16(q+2,little)!==3||v.getUint32(q+4,little)!==1||v.getUint16(q+8,little)!==1))manual('JPEG 不是正常方向，请先用本机图片工具另存为正向图');
          }
        }
        if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&n>=11){
          height=v.getUint16(start+1);width=v.getUint16(start+3);
        }
        p=end;
      }
    }
    if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>maxPixels)
      manual('图片大小超出章签副本的处理范围');
    return {width,height};
  }
  function safePdf(doc,api){
    const objects=doc.context.enumerateIndirectObjects();
    if(objects.length>LIMITS.objects||doc.getPageCount()>LIMITS.pageCount||doc.getPageCount()<1)
      manual('PDF 页数或结构超出章签副本的处理范围');
    const noKeys=new Set(['/ByteRange','/Perms','/DSS','/AcroForm','/XFA','/OpenAction','/AA','/JS','/JavaScript','/EmbeddedFiles','/AF','/RichMediaContent','/Collection','/EF']);
    const noValues=new Set(['/Sig','/DocMDP','/JavaScript','/Launch','/SubmitForm','/ImportData','/GoToE','/RichMedia','/FileAttachment','/3D','/Movie','/Screen','/Sound']);
    const seen=new Set(),stack=[doc.catalog,...objects.map(x=>x[1])];
    let count=0;
    while(stack.length){
      const v=stack.pop();
      if(!v||seen.has(v))continue;
      seen.add(v);if(++count>180000)manual('PDF 结构超出章签副本的处理范围');
      if(v instanceof api.PDFDict){
        for(const [key,val] of v.entries()){
          if(noKeys.has(key.toString())||
             (['/S','/Subtype','/Type','/FT','/TransformMethod'].includes(key.toString())&&val instanceof api.PDFName&&noValues.has(val.toString())))
            manual('PDF 包含数字签名、表单或交互内容');
          stack.push(val);
        }
      }else if(v instanceof api.PDFArray){
        for(let i=0;i<v.size();i++)stack.push(v.get(i));
      }else if(v instanceof api.PDFStream)stack.push(v.dict);
    }
  }
  async function loadPdf(file){
    const api=lib();let doc;
    try{doc=await api.PDFDocument.load(file.bytes,{ignoreEncryption:false,throwOnInvalidObject:true,updateMetadata:false});}
    catch{manual('PDF 已加密、损坏或无法解析');}
    safePdf(doc,api);return doc;
  }
  function pdfSize(page){
    const b=page.getMediaBox(),c=page.getCropBox();
    const unit=page.node.get(lib().PDFName.of('UserUnit'));
    if(page.getRotation().angle%360!==0||b.x!==0||b.y!==0||c.x!==b.x||c.y!==b.y||c.width!==b.width||c.height!==b.height||
       (unit&&(!(unit instanceof lib().PDFNumber)||unit.asNumber()!==1)))
      manual('所选 PDF 页有旋转、裁切或自定义坐标，无法可靠定位');
    if(!Number.isFinite(b.width)||!Number.isFinite(b.height)||b.width<72||b.height<72||b.width>7200||b.height>7200)
      manual('PDF 页尺寸异常');
    return {width:b.width,height:b.height};
  }
  function geometry(position,kinds,width,height){
    let x,y,bw,bh;
    if(POSITIONS.includes(position)){
      bw=kinds.length===1?.245:kinds.length===2?.385:.52;bh=.177;
      x=position.endsWith('right')?1-.035-bw:.035;
      y=position.startsWith('bottom')?1-.035-bh:.035;
    }else if(position&&typeof position==='object'&&!Array.isArray(position)){
      ({x,y,width:bw,height:bh}=position);
      if(![x,y,bw,bh].every(Number.isFinite)||x<0||y<0||bw<.08||bh<.045||x+bw>1||y+bh>1)
        invalid('章签位置超出本页，或没有足够空间。');
    }else invalid('请确认附件章签位置。');
    const gap=Math.min(width*.012,bw*width*.06);
    const step=(bw*width-(kinds.length-1)*gap)/kinds.length;
    return kinds.map((kind,i)=>({kind,x:x*width+i*(step+gap),y:y*height,width:step,height:bh*height}));
  }
  function placed(box,width,height){
    const scale=Math.min(box.width/width,box.height/height);
    const w=width*scale,h=height*scale;
    if(w<4||h<4)invalid('所选章签位置过小，请放大或另选位置。');
    return {x:box.x+(box.width-w)/2,y:box.y+(box.height-h)/2,width:w,height:h};
  }
  async function verifiedAssets(kinds,assets){
    if(!Array.isArray(kinds)||!kinds.length||kinds.length>KINDS.length||
      new Set(kinds).size!==kinds.length||kinds.some(k=>!KINDS.includes(k)))invalid('请为该附件明确选择有效章签。');
    const ordered=KINDS.filter(k=>kinds.includes(k)),out=[];
    for(const kind of ordered){
      const matches=Array.isArray(assets)?assets.filter(a=>a?.kind===kind):[assets?.[kind]];
      if(matches.length!==1||!matches[0]||matches[0].kind!==kind||![PNG,JPG].includes(matches[0].mime))
        invalid('所选事务所缺少对应的章签图片，请先到资料库补齐。');
      const f=await quote().verifyAttachment({...matches[0],kind:'business_license'});
      out.push({...f,kind,...scaledImage(f.bytes,f.mime,LIMITS.signingPixels)});
    }
    return out;
  }
  function output(source,mime,bytes){
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>LIMITS.outputBytes)
      manual('生成的章签副本超过 3 MiB，请先缩小附件或图片');
    const ext=mime===PDF?'pdf':'png',suffix='-章签待复核.'+ext;
    const stem=source.name.slice(0,source.name.lastIndexOf('.'));
    const name=[...stem].slice(0,120-[...suffix].length).join('').replace(/[. ]+$/,'')+suffix;
    return {name,mime,bytes};
  }
  async function decode(bytes,mime){
    if(typeof root.createImageBitmap!=='function')manual('当前浏览器不能安全解码附件图片，请换新版 Chrome 或 Edge');
    try{return await root.createImageBitmap(new root.Blob([bytes],{type:mime}));}
    catch{manual('图片无法正常解码');}
  }
  async function apply(attachment,{kinds,assets,page,position}={}){
    if(!Number.isSafeInteger(page)||page<1)invalid('请确认附件章签页码（从 1 开始）。');
    const f=await sourceOf(attachment), images=await verifiedAssets(kinds,assets);
    if(f.mime===PDF){
      const doc=await loadPdf(f);
      if(page>doc.getPageCount())invalid('确认的页码超出 PDF 实际页数。');
      const p=doc.getPage(page-1),{width,height}=pdfSize(p),boxes=geometry(position,images.map(a=>a.kind),width,height);
      for(let i=0;i<images.length;i++){
        const a=images[i];let img;
        try{img=await (a.mime===PNG?doc.embedPng(a.bytes):doc.embedJpg(a.bytes));}
        catch{manual('章签图片无法嵌入 PDF');}
        if(img.width!==a.width||img.height!==a.height)manual('章签图片尺寸与文件头不一致');
        const rect=placed(boxes[i],img.width,img.height);
        p.drawImage(img,{...rect,y:height-rect.y-rect.height});
      }
      let bytes;
      try{bytes=await doc.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false});}
      catch{manual('PDF 副本无法生成');}
      return output(f,PDF,bytes);
    }
    if(page!==1)invalid('图片附件只有第 1 页。');
    const {width,height}=scaledImage(f.bytes,f.mime,LIMITS.attachmentPixels),boxes=geometry(position,images.map(a=>a.kind),width,height);
    if(!root.document?.createElement)manual('当前环境无法生成图片副本');
    const canvas=root.document.createElement('canvas');
    try{
      canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d',{alpha:true});
      if(!ctx)manual('当前浏览器不能创建图片副本');
      const original=await decode(f.bytes,f.mime);
      try{
        if(original.width!==width||original.height!==height)manual('附件图片尺寸与文件头不一致');
        ctx.drawImage(original,0,0);
      }finally{original.close?.();}
      for(let i=0;i<images.length;i++){
        const a=images[i],image=await decode(a.bytes,a.mime);
        try{
          if(image.width!==a.width||image.height!==a.height)manual('章签图片尺寸与文件头不一致');
          const r=placed(boxes[i],image.width,image.height);
          ctx.drawImage(image,r.x,r.y,r.width,r.height);
        }finally{image.close?.();}
      }
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,PNG));
      if(!blob||blob.size>LIMITS.outputBytes)manual('图片副本生成失败或超过 3 MiB');
      return output(f,PNG,new Uint8Array(await blob.arrayBuffer()));
    }finally{canvas.width=canvas.height=0;}
  }
  async function inspect(attachment){
    const f=await sourceOf(attachment);
    if(f.mime===PDF){
      const doc=await loadPdf(f),pages=doc.getPages().map((p,i)=>{
        try{return {page:i+1,...pdfSize(p),usable:true};}catch{return {page:i+1,usable:false};}
      });
      return {pageCount:pages.length,pages};
    }
    return {pageCount:1,pages:[{page:1,...scaledImage(f.bytes,f.mime,LIMITS.attachmentPixels),usable:true}]};
  }
  const api=Object.freeze({apply,inspect,POSITIONS,KINDS,LIMITS});
  root.QuoteAttachmentStamps=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
