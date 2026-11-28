/* Offline output of confirmation letters from Word/Excel layouts and PDF form templates. */
(function(root){
  'use strict';
  const normalize=text=>String(text??'').normalize('NFKC').replace(/\s+/gu,'').replace(/[:：]$/u,'');
  const token=/\{\{\s*([^{}]+?)\s*\}\}/gu;
  const coreParty=/^(?:致)?(?:被询证单位(?:名称)?|被询证者(?:名称)?|发函对象|收函单位|询证单位|往来单位(?:名称)?|对方单位|客商名称|客户(?:名称)?|供应商(?:名称)?|银行名称|开户银行)$/u;
  const coreAmount=/^(?:函证金额|询证金额|发函金额|账面余额|期末余额|余额|金额|(?:期末)?[借贷]方余额|贵单位欠我方|我方欠贵单位)$/u;
  const children=(node,name)=>[...node.children].filter(n=>n.localName===name);
  const wordText=node=>[...node.getElementsByTagNameNS('*','t')].map(n=>n.textContent).join('');
  async function blocksOf(file){
    if(/\.docx$/iu.test(file.name)){
      const parts=await root.ProjectWorkspaceStore.parts(file),xml=root.ProjectWorkspaceStore.xml(parts['word/document.xml']);
      const body=xml.getElementsByTagNameNS('*','body')[0];
      if(!body)throw Error('函证模板未读取到 Word 正文。');
      return [...body.children].flatMap(node=>{
        if(node.localName==='p')return [{text:wordText(node)}];
        if(node.localName==='tbl')return [{table:children(node,'tr').map(r=>children(r,'tc').map(c=>children(c,'p').map(wordText).join('\n')))}];
        return [];
      });
    }
    if(/\.doc$/iu.test(file.name)){
      const data=await root.LegacyDoc.readStructure(file);
      return data.paragraphs.map(p=>({text:p.text}));
    }
    const book=await root.WorkpaperSheets.read(file),blocks=[];
    for(const sheet of book.sheets.filter(s=>!s.visibility)){
      const rows=new Map();
      for(const [address,cell] of Object.entries(sheet.cells)){
        if(!String(cell.v??'').trim())continue;
        const [,letters,num]=/^([A-Z]+)(\d+)$/u.exec(address);
        let c=0;for(const ch of letters)c=c*26+ch.charCodeAt(0)-64;
        if(!rows.has(+num))rows.set(+num,[]);
        rows.get(+num)[c-1]=String(cell.w||cell.v);
      }
      let table=[];
      const flush=()=>{if(table.length){blocks.push({table});table=[];}};
      for(const [,row] of [...rows].sort((a,b)=>a[0]-b[0])){
        const cells=Array.from(row,v=>v||''),nonempty=cells.filter(Boolean);
        if(nonempty.length===1&&!table.length)blocks.push({text:nonempty[0]});
        else table.push(cells);
      }
      flush();
    }
    return blocks;
  }
  function bindings(values){
    const used=new Set();
    function get(name){
      const k=normalize(name);
      if(!values.has(k))throw Error('函证模板字段「'+name+'」在控制信息表或三栏账中没有来源。');
      used.add(k);return values.get(k);
    }
    function fill(text){
      if(text.includes('{{'))return text.replace(token,(_,name)=>get(name));
      return text.replace(/([^：:\n]+?)[：:]\s*[_＿]{2,}/gu,(all,label)=>{
        const k=normalize(label);
        return values.has(k)?label+'：'+get(k):all;
      });
    }
    function verify(){
      if(![...used].some(k=>coreParty.test(k))||![...used].some(k=>coreAmount.test(k)&&values.get(k)!==''))
        throw Error('模板未能填入被询证单位和函证金额。请在对应位置设置 {{被询证单位}} 和 {{函证金额}}，或使用内置模板。');
    }
    return {values,get,fill,verify,used};
  }
  function letterBlocks(blocks,items){
    const bindingsList=items.map(bindings),first=bindingsList[0],result=[];
    let amountTable=false;
    for(const block of blocks){
      if(!block.table){result.push({text:first.fill(block.text)});continue;}
      const rows=[];
      for(let i=0;i<block.table.length;i++){
        const row=block.table[i],keys=row.map(normalize);
        if(row.filter(Boolean).length>=2&&keys.some(k=>coreAmount.test(k))&&keys.every(k=>!k||first.values.has(k)||k==='备注')){
          rows.push(row);const next=block.table[i+1];
          if(next?.some(s=>s.includes('{{'))){for(const b of bindingsList)rows.push(next.map(s=>b.fill(s)));i++;}
          else for(const b of bindingsList)rows.push(keys.map(k=>b.values.has(k)?b.get(k):''));
          while(i+1<block.table.length&&!block.table[i+1].some(s=>s.trim()))i++;
          amountTable=true;continue;
        }
        const filled=row.map(s=>first.fill(s));
        for(let c=0;c<row.length-1;c++)if(!row[c+1]&&first.values.has(keys[c]))filled[c+1]=first.get(keys[c]);
        rows.push(filled);
      }
      result.push({table:rows});
    }
    first.verify();
    if(items.length>1&&!amountTable)return items.flatMap(item=>[{break:true},...letterBlocks(blocks,[item])]).slice(1);
    return result;
  }
  const width=595,height=842,margin=43,inner=width-2*margin;
  const font='"SimSun","Songti SC","Microsoft YaHei",serif';
  function wrap(ctx,text,limit){
    const lines=[];
    for(const part of String(text).split(/\r?\n/u)){
      let line='';
      for(const c of part){if(line&&ctx.measureText(line+c).width>limit){lines.push(line);line='';}line+=c;}
      lines.push(line);
    }
    return lines;
  }
  function canvas(w,h){
    const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(w*2));c.height=Math.max(1,Math.ceil(h*2));
    const ctx=c.getContext('2d');ctx.scale(2,2);ctx.textBaseline='top';ctx.fillStyle='#151515';return {c,ctx};
  }
  const png=c=>new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b.arrayBuffer()):reject(Error('函证 PDF 页面生成失败。')),'image/png'));
  async function drawLetter(pdf,blocks){
    let sheet,y,first=true;
    function start(){sheet=canvas(width,height);sheet.ctx.fillStyle='white';sheet.ctx.fillRect(0,0,width,height);sheet.ctx.fillStyle='#151515';y=margin;}
    async function finish(){
      const image=await pdf.embedPng(await png(sheet.c));pdf.addPage([width,height]).drawImage(image,{x:0,y:0,width,height});
      sheet.c.width=1;sheet.c.height=1;
    }
    async function room(h){if(y+h>height-margin){await finish();start();}}
    start();
    for(const block of blocks){
      if(block.break){await finish();start();first=true;continue;}
      if(!block.table){
        if(!block.text.trim()){if(!first)y+=5;continue;}
        const title=first&&block.text.length<=42,style=(title?'bold 19':'11.5')+'px '+font,line=title?28:18;
        sheet.ctx.font=style;
        const lines=wrap(sheet.ctx,block.text,inner);
        for(const text of lines){
          await room(line);sheet.ctx.font=style;sheet.ctx.textAlign=title?'center':'left';
          sheet.ctx.fillText(text,title?width/2:margin,y);y+=line;
        }
        y+=title?14:5;first=false;continue;
      }
      first=false;
      const columns=Math.max(...block.table.map(r=>r.length),1),cellWidth=inner/columns;
      if(cellWidth<23)throw Error('函证模板表格过宽，请调整列数或改用可填写的 PDF 模板。');
      for(const [index,row] of block.table.entries()){
        const style=(index?'':'bold ')+'10.5px '+font;sheet.ctx.font=style;
        const cells=Array.from({length:columns},(_,c)=>wrap(sheet.ctx,row[c]||'',cellWidth-8));
        const count=Math.max(...cells.map(c=>c.length));
        for(let offset=0;offset<count;){
          await room(23);
          const length=Math.min(count-offset,Math.floor((height-margin-y-8)/15)),h=length*15+8;
          const ctx=sheet.ctx;ctx.font=style;ctx.textAlign='left';ctx.strokeStyle='#666';ctx.lineWidth=.6;
          for(const [c,lines] of cells.entries()){
            const x=margin+c*cellWidth;ctx.strokeRect(x,y,cellWidth,h);
            lines.slice(offset,offset+length).forEach((s,n)=>ctx.fillText(s,x+4,y+4+n*15));
          }
          y+=h;offset+=length;
        }
      }
      y+=9;
    }
    await finish();
  }
  async function fieldImage(pdf,text,w,h){
    const {c,ctx}=canvas(w,h);ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.fillStyle='#111';
    const size=Math.min(h*.75,12);ctx.font=size+'px '+font;
    let rows=wrap(ctx,text,w-2),line=size*1.12;
    if(rows.length*line>h){const fitted=Math.min(size,(w-2)*size/Math.max(1,ctx.measureText(text).width));
      if(fitted<6&&text)throw Error('PDF 模板字段过窄，无法完整填写「'+text+'」。');
      ctx.font=fitted+'px '+font;rows=[text];line=fitted*1.12;
    }
    rows.forEach((s,i)=>ctx.fillText(s,1,(h-rows.length*line)/2+i*line));
    return pdf.embedPng(await png(c));
  }
  async function fillPdf(output,bytes,groups){
    const {PDFDocument,PDFTextField,rgb}=root.PDFLib,base=await PDFDocument.load(bytes),fields=base.getForm().getFields();
    const positions=fields.length?null:(await root.BidderPdfText.readPositioned(new Uint8Array(bytes))).pages;
    for(const group of groups)for(const values of group){
      const b=bindings(values),doc=await PDFDocument.load(bytes),form=doc.getForm();
      if(fields.length){
        for(const field of form.getFields()){
          const k=normalize(field.getName().replace(/^\{\{|\}\}$/gu,''));
          if(!(field instanceof PDFTextField)||!values.has(k))continue;
          const rect=field.acroField.getWidgets()[0].getRectangle();
          field.setImage(await fieldImage(doc,b.get(k),rect.width,rect.height));
        }
        form.flatten({updateFieldAppearances:false});
      }else{
        for(const [i,page] of (positions||[]).entries())for(const item of page?.items||[]){
          if(!item.text.includes('{{'))continue;
          const text=b.fill(item.text),target=doc.getPage(i),h=item.height*1.25,y=item.y-item.height*.2;
          target.drawRectangle({x:item.x,y,width:item.width,height:h,color:rgb(1,1,1)});
          target.drawImage(await fieldImage(doc,text,item.width,h),{x:item.x,y,width:item.width,height:h});
        }
      }
      b.verify();
      for(const page of await output.copyPages(doc,doc.getPageIndices()))output.addPage(page);
    }
  }
  async function build(template,groups){
    const output=await root.PDFLib.PDFDocument.create();output.setTitle('函证');
    if(/\.pdf$/iu.test(template.name))await fillPdf(output,await template.arrayBuffer(),groups);
    else{
      const blocks=await blocksOf(template);
      for(const group of groups)await drawLetter(output,letterBlocks(blocks,group));
    }
    return output.save();
  }
  root.ConfirmationPdf=Object.freeze({build});
})(globalThis);
