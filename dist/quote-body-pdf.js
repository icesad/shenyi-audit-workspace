/* Local printable quotation bodies. Uses OS CJK fonts on canvas; the Word/HTML exports remain editable. */
(function(root){
  'use strict';
  const WIDTH=595.28,HEIGHT=841.89,LEFT=48,RIGHT=48,TOP=47,END=650,DRAW=WIDTH-LEFT-RIGHT,PIXELS=2;
  const BODY='"Songti SC","SimSun","Noto Serif CJK SC","PingFang SC","Microsoft YaHei",serif';
  const UI='"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
  const ROLE=new Set(['company_seal','legal_representative_seal','bidder_signature']);
  const BODY_SIGN_ROLES=Object.freeze({legal_representative_seal:'法人章',bidder_signature:'投标人签字'});
  const MAX_PAGES=36,MAX_SOURCE=20*1024*1024;
  // The complete PDF keeps the sign-off center and overlays a 42 mm box.
  // Leave enough room below its old 88 pt reference height for role labels.
  const COMPANY_SEAL_PAD=(42*72/25.4-88)/2;
  const normalize=s=>s.replace(/\s+/gu,' ').trim();
  function nodeText(n){return n?normalize(n.textContent):'';}
  function read(html,anchored){
    if(typeof html!=='string'||html.length<1||html.length>MAX_SOURCE)throw Error('报价正文不可读取或超过大小限制。');
    const template=root.document.createElement('template');
    template.innerHTML=html;
    const article=template.content.querySelector('article.ql-doc,article.quote-packet');
    if(!article||template.content.querySelectorAll('article.ql-doc,article.quote-packet').length!==1)throw Error('未找到单份可打印的报价正文。');
    const text=(selector)=>nodeText(article.querySelector(selector));
    const segments=[];
    const para=(value,opts={})=>{if(value)segments.push({kind:'para',value,...opts});};
    const table=el=>{if(!el)return;const rows=[...el.rows].map(row=>({header:[...row.cells].every(c=>c.tagName==='TH'),cells:[...row.cells].map(nodeText)}));if(rows.length)segments.push({kind:'table',rows,priceTable:el.classList.contains('ql-price-table'),responseTable:el.classList.contains('ql-response-table')});};
    const note=selector=>para(text(selector),{size:9,line:14,space:7,color:'#536363',rule:true,font:UI});
    const sectionTitle=(value)=>para(value,{size:13,line:20,space:5,bold:true,keep:21,color:'#255b52',font:UI});
    if(article.classList.contains('ql-doc')){
      const title=article.querySelector('h1'),subtitle=article.querySelector('.ql-subtitle');
      // A subtitle may be a sibling or a span inside the heading. Render it once.
      const titleCopy=title?.cloneNode(true);
      for(const n of titleCopy?.querySelectorAll('.ql-subtitle')||[])n.remove();
      para(text('.ql-recipient'),{space:7,bold:true});
      const detail=article.querySelector('.ql-body');
      for(const item of detail?.children||[]){
        if(item===subtitle)continue;
        if(item.tagName==='TABLE')table(item);
        else if(item.tagName==='H2')sectionTitle(nodeText(item));
        else if(item.tagName==='P'){
          const isMeta=item.classList.contains('ql-meta');
          para(nodeText(item),{
            ...(isMeta?{size:11,line:17,space:4,color:'#42534f',font:UI}:{}),
            indent:!isMeta&&!item.classList.contains('ql-noindent'),
            bold:item.classList.contains('ql-total')
          });
        }
      }
      const ending=[...article.querySelectorAll('.ql-close > p, .ql-unit-date > p')].map(nodeText);
      if(ending.length)segments.push({kind:'ending',values:ending});
      const figures=[...article.querySelectorAll('.ql-sign[data-sign-kind]')].flatMap(figure=>{
        const role=figure.dataset.signKind,img=figure.querySelector('img'),source=img?.getAttribute('src');
        if(!ROLE.has(role)||!source)return [];
        if(!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(source))throw Error('正文图样不可读取。');
        return [{role,source,label:nodeText(figure.querySelector('figcaption'))}];
      });
      if(figures.length)segments.push({kind:'figures',figures});
      note('.ql-note');
      return {title:nodeText(titleCopy),subtitle:nodeText(subtitle),status:text('.ql-state'),segments};
    }
    para(text('.qp-firm'),{bold:true,space:10});
    const meta=article.querySelector('.document-meta');
    for(const d of meta?.children||[])para(nodeText(d),{space:2});
    table(article.querySelector('table'));
    para([...article.querySelector('.document-total')?.children||[]].map(nodeText).join('　'),{size:17,line:25,bold:true,color:'#204b48',align:'right',space:11});
    sectionTitle(text('.document-terms h2'));
    for(const p of article.querySelectorAll('.document-terms p'))para(nodeText(p),{size:11,line:17,space:4});
    if(anchored){
      const firm=text('.qp-firm strong');
      const date=[...meta?.children||[]].find(d=>nodeText(d.querySelector('span'))==='编制日期：')?.querySelector('strong');
      const dateValue=nodeText(date);
      if(firm&&/^\d{4}-\d{2}-\d{2}$/.test(dateValue))
        segments.push({kind:'ending',values:['单位名称：'+firm,'日期：'+dateValue.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$1 年 $2 月 $3 日')]});
    }
    note('.document-note');
    return {title:text('h1'),status:text('.qp-status'),segments};
  }
  function typography(ctx,o={}){
    const size=o.size||12.5,line=o.line||20;
    ctx.font=(o.bold?'700 ':'400 ')+size+'px '+(o.font||BODY);
    ctx.fillStyle=o.color||'#202727';ctx.textBaseline='top';ctx.textAlign='left';
    return {size,line};
  }
  function wraps(ctx,txt,max,indent=0){
    if(!txt)return [''];
    const tokens=txt.match(/[A-Za-z0-9@._:+\-/¥￥,]+|\s+|./gu)||[];
    const rows=[];let current='',width=max-indent;
    const push=()=>{rows.push(current.trimEnd());current='';width=max;};
    for(const t of tokens){
      if(!current&&/^\s+$/u.test(t))continue;
      if(ctx.measureText(current+t).width<=width){current+=t;continue;}
      if(current){
        // Keep common closing CJK punctuation with the preceding line when it fits its margin.
        if(t.length===1&&/[，。！？；：、）】」》”’]/u.test(t)&&ctx.measureText(current+t).width<=width+5){current+=t;continue;}
        push();
      }
      if(/^\s+$/u.test(t))continue;
      if(ctx.measureText(t).width<=width){current=t;continue;}
      for(const c of t){
        if(current&&ctx.measureText(current+c).width>width)push();
        current+=c;
      }
    }
    if(current||!rows.length)push();
    return rows;
  }
  function canvasPage(){
    const canvas=root.document.createElement('canvas');canvas.width=Math.round(WIDTH*PIXELS);canvas.height=Math.round(HEIGHT*PIXELS);
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx)throw Error('浏览器无法绘制报价 PDF，请使用支持 Canvas 的浏览器。');
    ctx.scale(canvas.width/WIDTH,canvas.height/HEIGHT);
    ctx.fillStyle='#fff';ctx.fillRect(0,0,WIDTH,HEIGHT);
    return {canvas,ctx,y:TOP};
  }
  async function raster(canvas){
    return new Promise((ok,no)=>canvas.toBlob(b=>b?ok(b.arrayBuffer()):no(Error('无法编码报价正文页面。')),'image/png'));
  }
  function loadFigure(source){return new Promise((ok,no)=>{
    const image=new root.Image();
    image.onload=()=>image.naturalWidth&&image.naturalHeight?ok(image):no(Error('正文图样无效。'));
    image.onerror=()=>no(Error('浏览器无法解码正文图样。'));
    image.src=source;
  });}
  function line(ctx,x1,y1,x2,y2,color='#bac5c4'){
    ctx.strokeStyle=color;ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
  }
  async function renderPdf(fragments,anchored,signingKinds=[]){
    const api=root.PDFLib;
    if(!api?.PDFDocument||!root.document)throw Error('本机 PDF 正文组件未就绪，请重新打开工作台。');
    if(!Array.isArray(fragments)||fragments.length<1||fragments.length>3)throw Error('报价正文应为一至三份。');
    const pdf=await api.PDFDocument.create();pdf.setTitle('审计报价草稿');
    const roles=Object.keys(BODY_SIGN_ROLES);
    if(!Array.isArray(signingKinds)||signingKinds.length>roles.length||
      new Set(signingKinds).size!==signingKinds.length||Array.from(signingKinds).some(k=>!roles.includes(k)))
      throw Error('报价正文签署类型无效。');
    const wantsBodySigning=signingKinds.length>0;
    let total=0;const bodySealAnchors=[],bodySigningAnchors=[];
    for(const fragment of fragments){
      const doc=read(fragment,anchored);
      if(!doc.title||!doc.segments.length)throw Error('报价正文缺少标题或内容，未生成 PDF。');
      if(wantsBodySigning){
        if(doc.segments.filter(s=>s.kind==='ending').length!==1)throw Error('有一份报价正文找不到明确落款，无法放置法人章或投标人签字。');
        if(doc.segments.some(s=>s.kind==='figures'))throw Error('报价正文已经含有章签图样，请使用无章正文重新生成。');
      }
      let p=null,pageIndex=0;
      const finish=async()=>{
        if(!p)return;
        typography(p.ctx,{size:9,color:'#62716e',font:UI});
        p.ctx.fillText('正文第 '+p.absolute+' 页',LEFT,HEIGHT-52);
        const bytes=await raster(p.canvas);
        const img=await pdf.embedPng(bytes),page=pdf.addPage([WIDTH,HEIGHT]);
        page.drawImage(img,{x:0,y:0,width:WIDTH,height:HEIGHT});
        p.canvas.width=1;p.canvas.height=1;p=null;
      };
      const start=async()=>{
        if(++total>MAX_PAGES)throw Error('报价正文超过 '+MAX_PAGES+' 页，未生成 PDF。');
        await finish();pageIndex++;p=canvasPage();p.absolute=total;
        if(doc.status){typography(p.ctx,{size:10,bold:true,color:'#80581f',font:UI});p.ctx.textAlign='right';p.ctx.fillText(doc.status,WIDTH-RIGHT,p.y);}
        p.y+=20;
        const first=pageIndex===1,titleSize=first?24:17,titleLine=first?29:21;
        const heading=(value,size,line,bold)=>{
          typography(p.ctx,{size,bold,font:UI});p.ctx.textAlign='center';
          const lines=wraps(p.ctx,value,DRAW);
          if(p.y+line*lines.length>END-125)throw Error('报价标题过长，无法在一页内保留正文空间。');
          for(const row of lines){p.ctx.fillText(row,WIDTH/2,p.y);p.y+=line;}
        };
        // Preserve full project-specific titles on the first page. Prefer the
        // shorter document type on continuation pages, retaining table room.
        let runningTitle=first?doc.title:(doc.subtitle||doc.title)+'（续）';
        if(!first){
          typography(p.ctx,{size:titleSize,bold:true,font:UI});
          if(wraps(p.ctx,runningTitle,DRAW).length>2)runningTitle='报价文件（续）';
        }
        heading(runningTitle,titleSize,titleLine,true);
        if(first&&doc.subtitle){p.y+=3;heading(doc.subtitle,17,23,true);p.y+=12;}
        else p.y+=first?19:11;
      };
      const fit=async(height)=>{if(p.y+height>END)await start();if(p.y+height>END)throw Error('单段报价内容过长，未生成 PDF。');};
      const aligned=(val,y,opts,indent=0)=>{
        typography(p.ctx,opts);
        const align=opts.align||'left';
        p.ctx.textAlign=align;
        p.ctx.fillText(val,align==='right'?WIDTH-RIGHT:align==='center'?WIDTH/2:LEFT+indent,y);
      };
      const paragraph=async block=>{
        const {size,line:lh}=typography(p.ctx,block);
        const indent=block.indent?size*2:0, rows=wraps(p.ctx,block.value,DRAW,indent);
        if(block.rule){await fit(6+Math.min(rows.length,2)*lh);line(p.ctx,LEFT,p.y+1,WIDTH-RIGHT,p.y+1);p.y+=6;}
        else await fit(Math.min(rows.length,2)*lh+(block.keep||0));
        for(let i=0;i<rows.length;i++){
          await fit(lh);aligned(rows[i],p.y,block,i===0?indent:0);p.y+=lh;
        }
        p.y+=block.space??5;
      };
      const printTable=async block=>{
        const columns=block.rows[0].cells.length;
        if(columns<1||columns>6||block.rows.some(r=>r.cells.length!==columns))throw Error('报价表格结构无法用于 PDF。');
        const widths=columns===2?(block.priceTable?[DRAW*.43,DRAW*.57]:block.responseTable?[DRAW*.32,DRAW*.68]:[DRAW*.56,DRAW*.44]):columns===3?[DRAW*.40,DRAW*.36,DRAW*.24]:columns===6?[.07,.30,.16,.16,.15,.16].map(v=>DRAW*v):Array(columns).fill(DRAW/columns);
        const metrics=row=>{
          const opts={size:columns===6?10.5:11.5,bold:row.header,font:row.header?UI:BODY};
          typography(p.ctx,opts);
          const lines=row.cells.map((v,i)=>wraps(p.ctx,v,widths[i]-15));
          return {lines,opts,height:Math.max(...lines.map(t=>t.length))*17+12,header:row.header};
        };
        const rows=block.rows.map(metrics),head=rows[0].header?rows[0]:null;
        const draw=row=>{
          if(row.header||block.priceTable){p.ctx.fillStyle='#eff3f2';p.ctx.fillRect(LEFT,p.y,row.header?DRAW:widths[0],row.height);}
          let x=LEFT;
          for(let i=0;i<columns;i++){
            typography(p.ctx,row.opts);
            for(const [j,t] of row.lines[i].entries())p.ctx.fillText(t,x+7,p.y+6+j*17);
            line(p.ctx,x,p.y,x,p.y+row.height);x+=widths[i];
          }
          line(p.ctx,x,p.y,x,p.y+row.height);line(p.ctx,LEFT,p.y,WIDTH-RIGHT,p.y);
          p.y+=row.height;line(p.ctx,LEFT,p.y,WIDTH-RIGHT,p.y);
        };
        p.y+=4;
        if(head&&rows.length>1)await fit(head.height+rows[1].height);
        for(let i=0;i<rows.length;i++){
          const r=rows[i];
          if(p.y+r.height>END){
            await start();await fit(r.height+(i>0&&head?head.height:0));
            if(i>0&&head)draw(head);
          }
          draw(r);
        }
        p.y+=11;
      };
      await start();
      for(const block of doc.segments){
        if(block.kind==='para')await paragraph(block);
        else if(block.kind==='table')await printTable(block);
        else if(block.kind==='ending'){
          const opt={size:12.5,align:'right',line:20};
          typography(p.ctx,opt);
          const list=block.values.flatMap(t=>wraps(p.ctx,t,DRAW));
          // Anchor to the rendered closing, not a guessed final page or a PDF footer.
          // Reserve space around the two sign-off lines, including when a long table reflows.
          await fit((anchored?68+COMPANY_SEAL_PAD:16)+list.length*20+(wantsBodySigning?76:0));p.y+=anchored?28:16;
          const startY=p.y;
          for(const val of list){aligned(val,p.y,opt);p.y+=20;}
          if(anchored){
            const w=104,h=88,x=WIDTH-RIGHT-w-8,top=Math.max(startY-24,p.y-64);
            bodySealAnchors.push(Object.freeze({pageIndex:p.absolute-1,x,y:HEIGHT-top-h,width:w,height:h}));
            p.y=Math.max(p.y+8,top+h+8+COMPANY_SEAL_PAD);
            if(wantsBodySigning){
              // Keep two independent lanes immediately below the actual
              // closing (never over the company mark or one another).
              const height=52,top=p.y+16,width=104;
              for(const [i,kind] of roles.entries()){
                if(!signingKinds.includes(kind))continue;
                const x=WIDTH-RIGHT-232+i*128;
                typography(p.ctx,{size:10,font:UI,color:'#536363'});p.ctx.textAlign='center';
                p.ctx.fillText(BODY_SIGN_ROLES[kind],x+width/2,p.y);
                bodySigningAnchors.push(Object.freeze({pageIndex:p.absolute-1,kind,x,y:HEIGHT-top-height,width,height}));
              }
              p.y=top+height+6;
            }
          }else p.y+=8;
        }else if(block.kind==='figures'){
          const images=await Promise.all(block.figures.map(x=>loadFigure(x.source)));
          await fit(85);const width=95;
          for(let i=0;i<images.length;i++){
            const img=images[i],factor=Math.min(74/img.naturalWidth,57/img.naturalHeight),w=img.naturalWidth*factor,h=img.naturalHeight*factor,
              mid=WIDTH-RIGHT-(images.length-i-.5)*width;
            p.ctx.drawImage(img,mid-w/2,p.y+(57-h)/2,w,h);
            typography(p.ctx,{size:10,font:UI});p.ctx.textAlign='center';p.ctx.fillText(block.figures[i].label,mid,p.y+62);
          }
          p.y+=82;
        }
      }
      await finish();
    }
    const body=await pdf.save({useObjectStreams:true,addDefaultPage:false});
    return Object.freeze({body,bodySealAnchors:Object.freeze(bodySealAnchors),...(wantsBodySigning?{bodySigningAnchors:Object.freeze(bodySigningAnchors)}:{})});
  }
  async function build(fragments){return (await renderPdf(fragments,false)).body;}
  async function buildWithAnchors(fragments,signingKinds){return renderPdf(fragments,true,signingKinds);}
  root.QuoteBodyPdf=Object.freeze({build,buildWithAnchors});
})(globalThis);
