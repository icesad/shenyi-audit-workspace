/* Bounded PDF text only. No render, links, annotation actions, JavaScript, OCR or network assets. */
(function(root){
  'use strict';
  const MiB=1024*1024, LIMIT=12*MiB, PAGE_LIMIT=35, ITEM_LIMIT=30000, TEXT_LIMIT=160000, DEADLINE=14000;
  let displayPromise=null;
  const unavailable=()=>new Error('PDF 文字提取不可用，文件仍保留在资料清单。');
  function blobBytes(base64){
    if(typeof base64!=='string'||base64.length>2500000)throw unavailable();
    const raw=atob(base64),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    return bytes;
  }
  async function load(){
    if(!displayPromise){
      if(!root.BidderPdfVendor||typeof Worker!=='function')throw unavailable();
      const url=URL.createObjectURL(new Blob([blobBytes(root.BidderPdfVendor.display)],{type:'text/javascript'}));
      displayPromise=import(url).then(pdf=>{
        if(pdf.version!==root.BidderPdfVendor.version||typeof pdf.getDocument!=='function'||typeof pdf.PDFWorker!=='function')throw unavailable();
        return pdf;
      }).finally(()=>URL.revokeObjectURL(url)).catch(err=>{displayPromise=null;throw err;});
    }
    return displayPromise;
  }
  // The worker parses in isolation and cannot make requests from PDF-controlled inputs.
  const lockNetwork='globalThis.fetch=()=>Promise.reject(new Error("Network unavailable in PDF text worker")); for(const k of ["XMLHttpRequest","WebSocket","EventSource","importScripts"])Object.defineProperty(globalThis,k,{value:undefined,configurable:false,writable:false});\n';
  function classicWorker(){
    // Chromium file:// may reject a blob ESM Worker. This single upstream build
    // is self-contained and has no static import. Adapt only its two base-URL
    // expressions and final export to a classic blob worker for the offline page.
    const script=new TextDecoder('utf-8',{fatal:true}).decode(blobBytes(root.BidderPdfVendor.worker));
    const tail='export{WorkerMessageHandler};';
    if((script.match(/import\.meta\.url/g)||[]).length!==2||!script.endsWith(tail))throw unavailable();
    return lockNetwork+script.slice(0,-tail.length).replaceAll('import.meta.url','globalThis.location.href');
  }
  async function read(bytes,positioned=false){
    if(!(bytes instanceof Uint8Array)||bytes.byteLength<8||bytes.byteLength>LIMIT||
       !bytes.subarray(0,5).every((b,i)=>b==='%PDF-'.charCodeAt(i)))throw unavailable();
    let timer,task,worker,workerURL,wrapper,closed=false,fail;
    const limit=new Promise((_,reject)=>{fail=()=>{closed=true;reject(unavailable());};timer=setTimeout(fail,positioned?5000:DEADLINE);});
    const check=()=>{if(closed)throw unavailable();};
    const parse=async()=>{
      const pdf=await load();check();
      workerURL=URL.createObjectURL(new Blob([classicWorker()],{type:'text/javascript'}));
      worker=new Worker(workerURL,{name:'local-pdf-text'});
      worker.addEventListener('error',fail,{once:true});
      wrapper=new pdf.PDFWorker({port:worker});
      task=pdf.getDocument({
        data:bytes.slice(),worker:wrapper,isEvalSupported:false,enableXfa:false,disableFontFace:true,
        useSystemFonts:false,useWasm:false,useWorkerFetch:false,disableAutoFetch:true,disableStream:true,disableRange:true,
        disableWorkerRendering:true,isOffscreenCanvasSupported:false,isImageDecoderSupported:false
      });
      task.onPassword=fail; // no password prompt, no attempt to decrypt
      const document=await task.promise;check();
      if(!Number.isInteger(document.numPages)||document.numPages<1||document.numPages>(positioned?100:PAGE_LIMIT))throw unavailable();
      const lines=[],pages=[];let chars=0,count=0;
      for(let i=1;i<=document.numPages;i++){
        check();const page=await document.getPage(i),reader=page.streamTextContent({includeMarkedContent:false}).getReader();
        const items=[],view=page.view;
        const usable=positioned&&page.rotate===0&&page.userUnit===1&&Array.isArray(view)&&view.length===4&&
          view[0]===0&&view[1]===0&&[view[2],view[3]].every(n=>Number.isFinite(n)&&n>0);
        let current='',lastY=null;
        const flush=()=>{const line=current.trim();current='';if(line)lines.push(line);};
        try{
          for(;;){
            const {value,done}=await reader.read();check();if(done)break;
            for(const item of value.items){
              if(typeof item.str!=='string')continue;
              if(++count>ITEM_LIMIT||(chars+=item.str.length)>TEXT_LIMIT)throw unavailable();
              if(positioned){
                const t=item.transform,w=item.width,h=item.height;
                if(usable&&item.str.trim()&&Array.isArray(t)&&t.length===6&&t.every(Number.isFinite)&&
                   t[0]>0&&t[3]>0&&Math.abs(t[1])<.01&&Math.abs(t[2])<.01&&Number.isFinite(w)&&Number.isFinite(h)&&
                   w>=0&&h>0&&t[4]>=0&&t[4]+w<=view[2]+1&&t[5]>=0&&t[5]<=view[3])
                  items.push({text:item.str,x:t[4],y:t[5],width:w,height:h});
                continue;
              }
              const y=Number(item.transform?.[5]),lineHeight=Math.max(2,Math.min(5,Number(item.height)*0.55||3));
              if(lastY!==null&&Number.isFinite(y)&&Math.abs(lastY-y)>lineHeight)flush();
              current+=item.str;lastY=Number.isFinite(y)?y:lastY;
              if(item.hasEOL){flush();lastY=null;}
            }
          }
        }catch(err){reader.cancel().catch(()=>{});throw err;}finally{reader.releaseLock();}
        if(positioned)pages.push(usable?{width:view[2],height:view[3],items}:null);
        else flush();
        page.cleanup();
      }
      return positioned?{pages}:{lines};
    };
    try{return await Promise.race([parse(),limit]);}
    catch{throw unavailable();}
    finally{
      clearTimeout(timer);closed=true;
      // Do not wait indefinitely for a stalled worker's acknowledgement.
      try{task?.destroy().catch(()=>{});}catch{}
      try{wrapper?.destroy();}catch{}
      worker?.terminate();
      if(workerURL)URL.revokeObjectURL(workerURL);
    }
  }
  root.BidderPdfText=Object.freeze({read:bytes=>read(bytes),readPositioned:bytes=>read(bytes,true)});
})(globalThis);

