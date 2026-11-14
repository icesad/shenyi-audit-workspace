/* The workbench renders certificate/attachment images locally, never as active documents. */
(function(root){
  'use strict';
  const PDF='application/pdf',PNG='image/png',JPEG='image/jpeg';
  const office=new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
  const titles={business_license:'营业执照',practice_certificate:'执业证书'};
  const LIMIT=12*1024*1024,MAX_PAGES=300,DEADLINE=20000;
  const COMPLETE_LIMIT=80*1024*1024,COMPLETE_MAX_PAGES=100;
  let displayPromise,workerScript;
  function decode(b64){
    if(typeof b64!=='string'||b64.length>2500000)throw Error();
    return Uint8Array.from(atob(b64),ch=>ch.charCodeAt(0));
  }
  async function load(){
    if(!displayPromise){
      if(!root.BidderPdfVendor||typeof root.Worker!=='function')throw Error();
      const url=URL.createObjectURL(new Blob([decode(root.BidderPdfVendor.display)],{type:'text/javascript'}));
      displayPromise=import(url).then(pdf=>{
        if(pdf.version!==root.BidderPdfVendor.version||!pdf.getDocument||!pdf.PDFWorker)throw Error();
        return pdf;
      }).finally(()=>URL.revokeObjectURL(url)).catch(e=>{displayPromise=null;throw e;});
    }
    return displayPromise;
  }
  function workerCode(){
    if(workerScript)return workerScript;
    const text=new TextDecoder('utf-8',{fatal:true}).decode(decode(root.BidderPdfVendor.worker)),tail='export{WorkerMessageHandler};';
    if((text.match(/import\.meta\.url/g)||[]).length!==2||!text.endsWith(tail))throw Error();
    // Do not permit PDF-controlled assets or parsing to make external requests.
    const offline='globalThis.fetch=()=>Promise.reject(new Error("Offline PDF preview"));for(const k of ["XMLHttpRequest","WebSocket","EventSource","importScripts"])Object.defineProperty(globalThis,k,{value:undefined,configurable:false,writable:false});\n';
    return workerScript=offline+text.slice(0,-tail.length).replaceAll('import.meta.url','globalThis.location.href');
  }
  function valid(a){
    if(!a||!(a.bytes instanceof Uint8Array)||a.bytes.length<4||a.bytes.length>LIMIT)return false;
    const b=a.bytes;
    if(a.mime===PDF)return b.length>7&&b.subarray(0,5).every((v,i)=>v===[37,80,68,70,45][i]);
    if(a.mime===PNG)return b.length>8&&b.subarray(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i]);
    if(a.mime===JPEG)return b[0]===255&&b[1]===216&&b[2]===255;
    return office.has(a.mime)&&b[0]===80&&b[1]===75&&b[2]===3&&b[3]===4;
  }
  function safeName(name){return typeof name==='string'&&name.length&&name.length<=255&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\\/]/u.test(name)?name:'附件原件';}
  async function paint(bytes,pageNum,canvas,signal,maxPages=MAX_PAGES){
    let timer,task,worker,workerURL,wrapper,rendering,docPage,stop,closed=false;
    const failure=new Promise((_,reject)=>{
      stop=()=>{closed=true;reject(Error('PDF 预览未完成'));};
      timer=setTimeout(stop,DEADLINE);signal.addEventListener('abort',stop,{once:true});
    });
    const check=()=>{if(closed||signal.aborted)throw Error();};
    const run=async()=>{
      check();const pdf=await load();check();
      workerURL=URL.createObjectURL(new Blob([workerCode()],{type:'text/javascript'}));
      worker=new Worker(workerURL,{name:'local-quote-annex'});worker.addEventListener('error',stop,{once:true});
      wrapper=new pdf.PDFWorker({port:worker});
      task=pdf.getDocument({data:bytes.slice(),worker:wrapper,
        isEvalSupported:false,enableXfa:false,disableFontFace:true,useSystemFonts:true,
        useWasm:false,useWorkerFetch:false,disableAutoFetch:true,disableStream:true,disableRange:true,
        isOffscreenCanvasSupported:false,isImageDecoderSupported:false,canvasMaxAreaInBytes:64*1024*1024,maxImageSize:32*1024*1024});
      task.onPassword=stop;
      const doc=await task.promise;check();
      if(!Number.isInteger(doc.numPages)||doc.numPages<1||doc.numPages>maxPages||pageNum<1||pageNum>doc.numPages)throw Error();
      docPage=await doc.getPage(pageNum);check();
      const v=docPage.getViewport({scale:1});
      if(!Number.isFinite(v.width)||!Number.isFinite(v.height)||v.width<1||v.height<1)throw Error();
      const vp=docPage.getViewport({scale:Math.min(900/v.width,1280/v.height,3)});
      canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
      rendering=docPage.render({canvas,canvasContext:canvas.getContext('2d'),viewport:vp,annotationMode:pdf.AnnotationMode.DISABLE,background:'#fff'});
      await rendering.promise;check();
      return doc.numPages;
    };
    try{return await Promise.race([run(),failure]);}
    finally{
      clearTimeout(timer);signal.removeEventListener('abort',stop);closed=true;
      try{rendering?.cancel();}catch{}
      try{docPage?.cleanup();}catch{}
      try{task?.destroy().catch(()=>{});}catch{}
      try{wrapper?.destroy();}catch{}
      worker?.terminate();if(workerURL)URL.revokeObjectURL(workerURL);
    }
  }
  function mount(container,{pair=[],extras=[],onPrintCertificates,onSetCompanySealPoint,onClearCompanySealPoint}={}){
    if(!container?.ownerDocument)throw Error('缺少附件预览位置');
    const doc=container.ownerDocument,urls=new Set(),stopFunctions=[],downloads=new Map();
    let closed=false,openExtraPdf=null;
    const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
    const btn=(text,cls='btn')=>{const b=el('button',text,cls);b.type='button';return b;};
    const section=el('section',undefined,'qa-annex');section.setAttribute('aria-label','报价附件');
    const heading=el('div',undefined,'qa-head'),printNote=el('p','','qa-info');
    printNote.setAttribute('role','status');printNote.setAttribute('aria-live','polite');
    heading.append(el('h3','附件与证照','qa-title'));
    section.append(heading,el('p','营业执照和执业证书默认展开，可分别翻页；其他 PDF 附件按需展开。打印两证会打开包含两份证照全部页面的无章 PDF。','qa-info'),printNote);
    const normalized=Array.from(pair).filter(a=>Object.hasOwn(titles,a?.kind)),items=[];
    for(const [kind,label] of Object.entries(titles))items.push({label,certificate:true,a:normalized.find(x=>x.kind===kind)});
    if(items.every(x=>valid(x.a))&&typeof onPrintCertificates==='function'){
      const print=btn('打印两项证照','btn primary');print.id='quote-print-certificates';
      print.onclick=async()=>{
        if(closed||print.disabled)return;print.disabled=true;
        try{await onPrintCertificates(message=>{if(!closed)printNote.textContent=message;});}
        catch(e){if(!closed)printNote.textContent=e?.message||'无法打开打印文件，请分别下载原件打印。';}
        finally{if(!closed)print.disabled=false;}
      };
      heading.append(print);
    }
    for(const [i,a] of Array.from(extras).entries())items.push({label:'附加附件 '+(i+1),a});
    function urlFor(a){
      const url=URL.createObjectURL(new Blob([a.bytes],{type:a.mime}));urls.add(url);return url;
    }
    function download(a){
      if(closed)return;
      const name=safeName(a.name);
      if(!downloads.has(a))downloads.set(a,urlFor(a));
      const link=el('a');link.href=downloads.get(a);link.download=name;link.hidden=true;
      doc.body.append(link);try{link.click();}finally{link.remove();}
    }
    function placementFor(extraIndex){
      const points=new Map(),tools=el('div',undefined,'qa-seal-tools'),stage=el('div',undefined,'qa-seal-stage'),
        marker=el('span',undefined,'qa-seal-marker'),note=el('p',undefined,'qa-status'),
        place=btn('点选公章位置','btn qa-seal-place'),clear=btn('清除本页位置','text-button');
      const canClear=typeof onClearCompanySealPoint==='function';
      let surface=null,page=0,ready=false,pending=null;
      tools.hidden=true;marker.hidden=true;marker.setAttribute('aria-hidden','true');marker.dataset.companySealMarker='';
      stage.dataset.companySealStage='';stage.tabIndex=-1;stage.setAttribute('role','group');
      place.dataset.companySealPlace='';clear.dataset.companySealClear='';
      note.setAttribute('role','status');note.setAttribute('aria-live','polite');
      tools.append(place);if(canClear)tools.append(clear);tools.append(note);
      const clamp=n=>Math.max(0,Math.min(1,n));
      const defaultNote=()=>points.has(page)?'第 '+page+' 页公章位置已选；生成盖章 PDF 时使用。':'不点选时优先本页落款，其次沿用同附件位置；否则盖在版心靠右下。公章尺寸固定 42×42 mm。';
      function draw(message){
        const point=pending||points.get(page);
        tools.hidden=!ready;
        place.disabled=!ready;clear.disabled=!ready||!points.has(page);
        place.textContent=pending?'取消点选':'点选公章位置';place.setAttribute('aria-pressed',String(!!pending));
        stage.dataset.placing=pending?'yes':'no';stage.tabIndex=pending?0:-1;
        stage.setAttribute('aria-label',pending?'附件公章位置。用方向键移动圆心，回车确认，Esc 取消。':'附件公章点选区域');
        marker.hidden=!ready||!point;
        if(ready&&point){marker.style.left=(point.x*100)+'%';marker.style.top=(point.y*100)+'%';}
        note.textContent=message??(pending?'点击本页要盖公章的位置。也可用方向键移动圆心、回车确认。':defaultNote());
      }
      function commit(point){
        if(closed||!ready||!pending)return;
        try{
          if(onSetCompanySealPoint({extraIndex,page,...point})===false)throw Error();
          points.set(page,point);pending=null;draw();
        }catch{draw('未能保存本页公章位置，请重新点选。');}
      }
      place.onclick=()=>{
        if(closed||!ready)return;
        if(pending){pending=null;draw();return;}
        pending={...(points.get(page)||{x:.5,y:.5})};draw();
        stage.focus({preventScroll:true});
      };
      clear.onclick=()=>{
        if(closed||!ready||!canClear||!points.has(page))return;
        try{
          if(onClearCompanySealPoint({extraIndex,page})===false)throw Error();
          points.delete(page);pending=null;draw('已清除第 '+page+' 页点选位置，将使用默认位置。');
          place.focus({preventScroll:true});
        }catch{draw('未能清除本页公章位置，请重试。');}
      };
      stage.onclick=e=>{
        if(closed||!ready||!pending||e.target!==surface)return;
        const bounds=surface.getBoundingClientRect();
        if(bounds.width<=0||bounds.height<=0||!Number.isFinite(e.clientX)||!Number.isFinite(e.clientY))return;
        commit({x:clamp((e.clientX-bounds.left)/bounds.width),y:clamp((e.clientY-bounds.top)/bounds.height)});
      };
      stage.onkeydown=e=>{
        if(closed||!ready||!pending)return;
        const arrows={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};
        if(!Object.hasOwn(arrows,e.key)&&!['Enter',' ','Escape'].includes(e.key))return;
        e.preventDefault();e.stopPropagation();
        if(e.key==='Escape'){pending=null;draw();place.focus({preventScroll:true});return;}
        if(e.key==='Enter'||e.key===' '){commit(pending);if(!pending)place.focus({preventScroll:true});return;}
        const [dx,dy]=arrows[e.key],step=e.shiftKey?.10:.02;
        pending={x:clamp(pending.x+dx*step),y:clamp(pending.y+dy*step)};draw();
      };
      function render(element,to,{loaded=true}={}){
        surface=element;page=to;ready=loaded;pending=null;
        stage.replaceChildren(element,marker);draw();return stage;
      }
      function imageReady(img){
        if(closed||surface!==img||!img.naturalWidth||!img.naturalHeight)return;
        // Fit before the CSS width clamp, preserving the preview aspect ratio
        // when tall scans hit the same 980px maximum as ordinary images.
        img.style.width=(img.naturalWidth*Math.min(1,980/img.naturalHeight))+'px';
        ready=true;draw();
      }
      function reset(){surface=null;page=0;ready=false;pending=null;stage.replaceChildren(marker);draw();}
      return {tools,render,imageReady,reset};
    }
    for(const [index,{label,a,certificate}] of items.entries()){
      const card=el('section',undefined,'qa-card');card.dataset.annexKind=a?.kind||'missing';card.dataset.annexIndex=index+1;
      const head=el('div',undefined,'qa-head'),meta=el('div',undefined,'qa-meta');meta.append(el('h4',label));
      card.append(head);head.append(meta);section.append(card);
      if(!a){meta.append(el('p','当前报价未带入此必备证照。','qa-info'));continue;}
      meta.append(el('p',safeName(a.name),'qa-filename'));
      if(!valid(a)){card.append(el('p','文件无法安全预览，请回到报价页核对原件。','qa-status'));continue;}
      const dl=btn('下载原件','btn qa-download');dl.setAttribute('aria-label','下载'+label+'原件');dl.onclick=()=>download(a);head.append(dl);
      if(office.has(a.mime)){card.append(el('p','Word / Excel 原件请下载后查看；转为 PDF 后可逐页预览。','qa-info'));continue;}
      const placement=!certificate&&typeof onSetCompanySealPoint==='function'?placementFor(index-2):null;
      if(a.mime!==PDF){
        const img=el('img',undefined,'qa-img');img.alt=label+'：'+safeName(a.name);img.loading='lazy';img.decoding='async';
        const view=placement?placement.render(img,1,{loaded:false}):img;
        if(placement){card.append(placement.tools);img.onload=()=>placement.imageReady(img);}
        img.onerror=()=>{if(!closed&&view.isConnected){
          placement?.reset();view.replaceWith(el('p','图片无法预览，可下载原件检查。','qa-status'));
        }};
        card.append(view);img.src=urlFor(a);continue;
      }
      const detail=el('details',undefined,'qa-pdf'),display=el('div',undefined,'qa-page-view'),toolbar=el('div',undefined,'qa-pdf-tools'),
        summary=el('summary','预览 PDF · 逐页查看'),note=el('p',undefined,'qa-status'),prev=btn('上一页'),next=btn('下一页');
      note.setAttribute('role','status');note.setAttribute('aria-live','polite');
      prev.disabled=next.disabled=true;toolbar.append(prev,note,next);detail.append(summary,toolbar);if(placement)detail.append(placement.tools);detail.append(display);card.append(detail);
      let page=1,total=0,controller;
      function cancel(){controller?.abort();controller=null;placement?.reset();display.replaceChildren();prev.disabled=next.disabled=true;}
      stopFunctions.push(cancel);
      async function show(to){
        cancel();if(closed||!detail.open)return;
        const current=new AbortController();controller=current;
        note.textContent='正在本机预览第 '+to+' 页…';
        const canvas=el('canvas',undefined,'qa-canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',label+'第 '+to+' 页');
        try{
          const count=await paint(a.bytes,to,canvas,current.signal);
          if(closed||controller!==current||!detail.open)return;
          total=count;page=to;note.textContent='第 '+page+' / '+total+' 页';display.replaceChildren(placement?placement.render(canvas,page):canvas);
          prev.disabled=page<=1;next.disabled=page>=total;
        }catch{
          if(closed||controller!==current||!detail.open)return;
          note.textContent='此页无法在浏览器预览（可能受保护、损坏或超出限制）。请下载原件查看。';
          prev.disabled=to<=1;next.disabled=!(total&&to<total);page=to;
        }
      }
      detail.addEventListener('toggle',()=>{
        if(detail.open){
          if(!certificate){
            if(openExtraPdf&&openExtraPdf.detail!==detail){openExtraPdf.cancel();openExtraPdf.detail.open=false;}
            openExtraPdf={detail,cancel};
          }
          show(page);
        }else{if(openExtraPdf?.detail===detail)openExtraPdf=null;cancel();}
      });
      prev.onclick=()=>show(page-1);next.onclick=()=>show(page+1);
      if(certificate)detail.open=true;
    }
    container.append(section);
    return function cleanup(){
      if(closed)return;closed=true;
      for(const f of stopFunctions)f();section.remove();
      for(const u of urls)URL.revokeObjectURL(u);urls.clear();downloads.clear();
    };
  }
  // Render the exact generated PDF, never a mock HTML overlay. Only one page
  // stays in memory and closing or switching pages cancels the previous worker.
  function mountPdf(container,{bytes,name,onReady,onError}={}){
    if(!container?.ownerDocument)throw Error('缺少完整 PDF 预览位置');
    const doc=container.ownerDocument;
    const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
    const btn=text=>{const b=el('button',text,'btn');b.type='button';return b;};
    const title=typeof name==='string'&&name?safeName(name):'完整报价 PDF';
    const section=el('section',undefined,'qa-annex qa-sealed-pdf'),card=el('div',undefined,'qa-card'),
      display=el('div',undefined,'qa-page-view'),bar=el('div',undefined,'qa-pdf-tools'),
      note=el('p','正在本机打开生成的 PDF…','qa-status'),prev=btn('上一页'),next=btn('下一页'),select=el('select');
    section.setAttribute('aria-label',title);
    note.setAttribute('role','status');note.setAttribute('aria-live','polite');
    select.setAttribute('aria-label','跳转到预览页');select.hidden=true;
    prev.disabled=next.disabled=true;
    bar.append(prev,note,select,next);card.append(bar,display);section.append(el('h3',title,'qa-title'),card);container.append(section);
    let closed=false,controller,page=1,total=0;
    const safeNotify=(fn,arg)=>{if(typeof fn==='function')try{fn(arg);}catch{}};
    function fail(message){
      note.textContent=message;safeNotify(onError,Error(message));
    }
    async function show(to){
      if(closed)return;
      controller?.abort();controller=null;
      display.replaceChildren();prev.disabled=next.disabled=select.disabled=true;
      if(!(bytes instanceof Uint8Array)||bytes.length<8||!bytes.subarray(0,5).every((v,i)=>v===[37,80,68,70,45][i])){
        fail('没有可预览的完整 PDF，请重新生成。');return;
      }
      if(bytes.length>COMPLETE_LIMIT){fail('完整 PDF 超过 80 MiB，浏览器内无法预览；请下载后查看。');return;}
      const current=new AbortController();controller=current;
      note.textContent='正在本机预览第 '+to+' 页…';
      const canvas=el('canvas',undefined,'qa-canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',title+'第 '+to+' 页');
      let count;
      try{count=await paint(bytes,to,canvas,current.signal,COMPLETE_MAX_PAGES);}
      catch{
        if(closed||controller!==current)return;
        page=to;select.value=String(to);prev.disabled=to<=1;next.disabled=!(total&&to<total);select.disabled=!total;
        fail('此页无法在浏览器预览（文件最多 100 页）；请下载 PDF 核对。');return;
      }
      if(closed||controller!==current)return;
      if(count!==total){
        select.replaceChildren(...Array.from({length:count},(_,i)=>{const o=el('option','第 '+(i+1)+' 页');o.value=String(i+1);return o;}));
        total=count;
      }
      page=to;select.value=String(page);select.hidden=total<2;select.disabled=false;
      note.textContent='第 '+page+' / '+total+' 页';display.append(canvas);
      prev.disabled=page<=1;next.disabled=page>=total;
      safeNotify(onReady,{page,pageCount:total});
    }
    prev.onclick=()=>show(page-1);next.onclick=()=>show(page+1);select.onchange=()=>show(Number(select.value));
    Promise.resolve().then(()=>show(1));
    return function cleanup(){
      if(closed)return;
      closed=true;controller?.abort();controller=null;bytes=null;section.remove();
    };
  }
  root.QuoteAnnexPreview=Object.freeze({mount,mountPdf});
})(globalThis);
