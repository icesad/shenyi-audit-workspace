/* Extract the actual supplier forms from a local tender DOCX; never publish the source. */
(function(root){
  'use strict';
  const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    R='http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    REL='http://schemas.openxmlformats.org/package/2006/relationships',
    XMLNS='http://www.w3.org/XML/1998/namespace',
    XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const bad=msg=>{throw new Error(msg);};
  const compact=s=>s.replace(/[\s\u00a0\u3000]/gu,'');
  const nodes=(el,tag)=>Array.from(el.getElementsByTagNameNS(W,tag));
  const raw=el=>nodes(el,'t').map(x=>x.textContent).join('');
  const pText=el=>el?.namespaceURI===W&&el.localName==='p'?compact(raw(el)):'';
  const safeField=x=>/^(?:PAGE|NUMPAGES)(?:\s+\\\*\s+MERGEFORMAT)?$/iu.test(x.trim());
  const unsupported=new Set(['altChunk','subDoc','object','pict','drawing','control','contentPart','binData','footnoteReference','endnoteReference','commentReference','commentRangeStart','commentRangeEnd','ins','del','moveFrom','moveTo','delText','delInstrText','dataBinding','sdt','customXml','numPicBullet']);
  function parse(s,ns,tag){
    if(typeof s!=='string'||/<!DOCTYPE|<!ENTITY/i.test(s)||(s.match(/</g)||[]).length>150000)bad('原件 XML 不受支持或过于复杂。');
    const d=new DOMParser().parseFromString(s,'application/xml');
    if(d.getElementsByTagName('parsererror').length||d.documentElement?.namespaceURI!==ns||d.documentElement.localName!==tag)
      bad('原件缺少有效的 Word 部件。');
    return d;
  }
  function sanitize(el,out,depth=0){
    if(depth>100||el.namespaceURI!==W||unsupported.has(el.localName))bad('投标格式中含图片、嵌入对象、修订或不支持的内容。请在 Word 中核对并另存为纯表单后重试。');
    if(el.localName==='instrText'&&!safeField(el.textContent))bad('投标格式中含非页码字段，未导出。请在 Word 中将该字段转为普通文字。');
    if(el.localName==='fldSimple'&&!safeField(el.getAttributeNS(W,'instr')||''))bad('投标格式中含非页码字段，未导出。');
    const n=el.localName==='hyperlink'?out.createDocumentFragment():out.createElementNS(W,'w:'+el.localName);
    if(n.nodeType===1)for(const a of el.attributes){
      if(a.namespaceURI===W)n.setAttributeNS(W,'w:'+a.localName,a.value);
      else if(a.namespaceURI===XMLNS&&a.localName==='space')n.setAttributeNS(XMLNS,'xml:space',a.value);
      else if(a.namespaceURI===R&&a.localName==='id'&&['headerReference','footerReference'].includes(el.localName))n.setAttributeNS(R,'r:id',a.value);
    }
    for(const c of el.childNodes){
      if(c.nodeType===1)n.append(sanitize(c,out,depth+1));
      else if((c.nodeType===3||c.nodeType===4)&&c.nodeValue)n.append(out.createTextNode(c.nodeValue));
    }
    return n;
  }
  const headings=[
    /^一[、.．]?投标函$/u,/^二[、.．]?(?:法定|法人)代表人身份证明$/u,
    /^三[、.．]?授权委托书$/u,/^四[、.．]?投标保证金$/u,/^五[、.．]?资格审查资料$/u,
    /^六[、.．]?鉴证咨询方案$/u,/^七[、.．]?其他资料$/u,/^八[、.．]?偏差表$/u,/^九[、.．]?供应商准入承诺书$/u];
  function findForms(src){
    const b=nodes(src.documentElement,'body')[0];if(!b)bad('原件没有可读取的正文。');
    const ch=Array.from(b.children),forms=[];
    for(let i=0;i<ch.length;i++){
      if(!/^第(?:四|4)章[：:、]?投标文件格式$/u.test(pText(ch[i])))continue;
      let j=i+1;while(j<ch.length&&!/^第(?:[一二三四五六七八九十]+|\d+)章[：:、]?.{1,48}$/u.test(pText(ch[j])))j++;
      const list=ch.slice(i+1,j),texts=list.map(pText);
      const cover=texts.findIndex(t=>t==='投标文件'),toc=texts.findIndex((t,k)=>k>cover&&t==='目录');
      const opener=texts.findIndex((t,k)=>k>toc&&t==='开标一览表');
      if(cover<0||toc<0||opener<0)continue;
      let first=-1;for(let k=toc+1;k<opener;k++)if(headings[0].test(texts[k]))first=k;
      if(first<0)continue;
      let cursor=opener;
      if(!headings.slice(1).every(re=>{const n=texts.findIndex((t,k)=>k>cursor&&re.test(t));if(n<0)return false;cursor=n;return true;}))continue;
      const openTable=list.slice(opener+1).find(x=>x.localName==='tbl');
      if(!openTable||!compact(raw(openTable)).includes('投标报价'))continue;
      forms.push({list,openTable});
    }
    if(forms.length!==1)bad(forms.length?'发现多处完整的第四章，未自动选用。请只保留一份投标文件格式。':'未定位到 FWE008 类完整第四章（封面、目录、开标一览表、九章正文），未生成缩减版。');
    return forms[0];
  }
  const relationship=(id,kind,target)=>'<Relationship Id="'+id+'" Type="'+R+'/'+kind+'" Target="'+target+'"/>';
  const rels=items=>XML+'<Relationships xmlns="'+REL+'">'+items.join('')+'</Relationships>';
  const serializer=()=>new XMLSerializer();
  function replaceAt(p,offset,length,replacement){
    let pos=0,inserted=false;
    for(const t of nodes(p,'t')){
      const s=t.textContent,e=pos+s.length;
      if(e>offset&&pos<offset+length){
        const lo=Math.max(0,offset-pos),hi=Math.min(s.length,offset+length-pos);
        t.textContent=s.slice(0,lo)+(inserted?'':replacement)+s.slice(hi);inserted=true;
      }
      pos=e;
    }
    return inserted;
  }
  const space='[\\s＿_　]';
  function applyFields(body,input){
    const val=k=>typeof input?.[k]==='string'&&input[k].length<=500&&input[k].isWellFormed()&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufffe\uffff]/u.test(input[k])?input[k].trim():'';
    const plan=[
      [/^\s*投\s*标\s*人(?:\s*名称)?\s*[：:]/u,val('firmName')],
      [/^\s*承诺单位\s*[（(]公章[）)]\s*[：:]/u,val('firmName')],
      [/^\s*联\s*系\s*人\s*[：:]/u,val('contact')],
      [/^\s*电\s*话\s*[：:]/u,val('phone')],
      [/^\s*(?:E[-–— ]?mail|电子邮箱)\s*[：:]/iu,val('email')]
    ];
    let count=0;
    for(const p of nodes(body,'p')){
      if(p.parentElement?.localName!=='body')continue;
      const s=raw(p);
      for(const [pattern,value] of plan){
        const prefix=s.match(pattern)?.[0];if(!prefix||!value)continue;
        const tail=s.slice(prefix.length),m=tail.match(new RegExp('^('+space+'{2,})(?:[（(](?:盖单位章|盖章)[）)])?\\s*$','u'));
        if(m&&replaceAt(p,prefix.length,m[1].length,value))count++;
        break;
      }
    }
    for(const table of nodes(body,'tbl')){
      const rows=Array.from(table.children).filter(x=>x.localName==='tr');
      for(const row of rows){
        const cells=Array.from(row.children).filter(x=>x.localName==='tc');
        for(let j=0;j<cells.length-1;j++){
          const label=compact(raw(cells[j])).replace(/[：:]$/u,''),k=({'企业名称':'firmName','投标人名称':'firmName','联系电话':'phone','电子邮箱':'email'})[label],to=cells[j+1];
          if(!k||!val(k)||!new RegExp('^'+space+'*$','u').test(raw(to)))continue;
          const p=nodes(to,'p')[0];if(!p)continue;
          const t=nodes(p,'t')[0];
          if(t){t.textContent=val(k);for(const other of nodes(p,'t').slice(1))other.textContent='';}
          else{const run=body.ownerDocument.createElementNS(W,'w:r'),text=body.ownerDocument.createElementNS(W,'w:t');text.textContent=val(k);run.append(text);p.append(run);}
          count++;
        }
      }
      const header=rows[0]&&Array.from(rows[0].children).filter(x=>x.localName==='tc');
      if(header?.length===4&&compact(raw(header[0]))==='投标人名称'&&compact(raw(header[1])).startsWith('投标报价')&&val('firmName')){
        const c=rows[1]&&Array.from(rows[1].children).find(x=>x.localName==='tc'),p=c&&nodes(c,'p')[0];
        if(p&&!compact(raw(c))){
          const run=body.ownerDocument.createElementNS(W,'w:r'),t=body.ownerDocument.createElementNS(W,'w:t');t.textContent=val('firmName');run.append(t);p.append(run);count++;
        }
      }
    }
    return count;
  }
  async function prepare(file){
    const src=await root.TenderImport.openBidTemplate(file);
    const {list,openTable}=findForms(parse(await src.read('word/document.xml'),W,'document'));
    const d=parse('<w:document xmlns:w="'+W+'" xmlns:r="'+R+'"><w:body/></w:document>',W,'document'),body=nodes(d.documentElement,'body')[0];
    for(const n of list)body.append(sanitize(n,d));
    const styles=await src.read('word/styles.xml'),numbering=await src.read('word/numbering.xml');
    const references=[...nodes(body,'headerReference'),...nodes(body,'footerReference')];
    const refs=new Map(),relFile=references.length?await src.read('word/_rels/document.xml.rels'):null;
    if(references.length&&!relFile)bad('原件页眉页脚关系缺失，未生成。');
    if(relFile)for(const e of parse(relFile,REL,'Relationships').documentElement.children){
      const id=e.getAttribute('Id'),target=e.getAttribute('Target'),type=e.getAttribute('Type'),mode=e.getAttribute('TargetMode');
      if(/^rId\d{1,8}$/u.test(id||'')&&/^(?:header|footer)\d{1,3}\.xml$/u.test(target||'')&&type===R+'/'+target.match(/^[a-z]+/u)[0]&&(!mode||mode==='Internal')){
        if(refs.has(id))bad('原件含重复的页眉页脚关系。');refs.set(id,target);
      }
    }
    const safe=serializer(),parts=Object.create(null),links=[],overrides=[];
    const add=(path,kind,tag,content,id)=>{
      const tree=parse(content,W,tag),copy=sanitize(tree.documentElement,tree);
      parts['word/'+path]=XML+safe.serializeToString(copy);links.push(relationship(id,kind,path));overrides.push([path,kind]);
    };
    if(styles)add('styles.xml','styles','styles',styles,'OriginalStyles');
    if(numbering)add('numbering.xml','numbering','numbering',numbering,'OriginalNumbering');
    const loaded=new Map();
    for(const ref of references){
      const id=ref.getAttributeNS(R,'id'),kind=ref.localName==='headerReference'?'header':'footer',path=refs.get(id);
      if(!path?.startsWith(kind))bad('原件含不支持的页眉页脚引用，未生成。');
      if(loaded.has(path)){ref.setAttributeNS(R,'r:id',loaded.get(path));continue;}
      if(loaded.size>=32)bad('原件页眉页脚数量超出支持范围，未生成。');
      const xml=await src.read('word/'+path);if(!xml)bad('原件页眉页脚文件缺失，未生成。');
      const newId='OriginalHF'+loaded.size;loaded.set(path,newId);ref.setAttributeNS(R,'r:id',newId);
      add(path,kind,kind==='header'?'hdr':'ftr',xml,newId);
    }
    const opens=Array.from(openTable.children).filter(x=>x.localName==='tr'),cells=opens[1]&&Array.from(opens[1].children).filter(x=>x.localName==='tc');
    const stats=Object.freeze({chapters:9,tables:nodes(body,'tbl').length,
      landscape:nodes(body,'pgSz').filter(x=>x.getAttributeNS(W,'orient')==='landscape').length,
      hasFormalOne:compact(cells?.[1]?raw(cells[1]):'')==='1'});
    const snapshot=safe.serializeToString(d.documentElement);
    const frozen=Object.freeze(parts);
    return Object.freeze({stats,build(input=null){
      const current=parse(snapshot,W,'document'),body=nodes(current.documentElement,'body')[0],
        filled=input?applyFields(body,input):0;
      const types='application/vnd.openxmlformats-officedocument.wordprocessingml.';
      const ct=XML+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+
        [['document.xml','document.main'],...overrides].map(([file,type])=>'<Override PartName="/word/'+file+'" ContentType="'+types+type+'+xml"/>').join('')+'</Types>';
      const bytes=root.QuoteLayouts.packOfficeParts({'[Content_Types].xml':ct,'_rels/.rels':rels([relationship('Main','officeDocument','word/document.xml')]),
        'word/document.xml':XML+safe.serializeToString(current.documentElement),'word/_rels/document.xml.rels':rels(links),...frozen});
      return Object.freeze({bytes,mime:MIME,name:'投标文件-原件完整表单-无章待核对.docx',filled});
    }});
  }
  function mount(host,{project,currentTender}){
    const status=host.querySelector('#bd-original-status'),pick=host.querySelector('#bd-original-file'),use=host.querySelector('#bd-original-use'),fill=host.querySelector('#bd-original-fill'),
      ack=host.querySelector('#bd-original-ack'),download=host.querySelector('#bd-original-download');
    let epoch=0,prepared=null;
    function set(s,bad=false){status.textContent=s;status.classList.toggle('error',bad);}
    function toggle(){ack.disabled=fill.disabled=!prepared;download.disabled=!prepared||!ack.checked;}
    async function load(file){
      const ticket=++epoch;prepared=null;ack.checked=fill.checked=false;toggle();if(!file){set('请先选取招标原件 DOCX。');return;}
      set('正在本机读取第四章投标文件格式…');
      try{
        const out=await prepare(file);
        if(ticket!==epoch)return;
        prepared=out;
        const x=out.stats;
        set('已识别 '+x.chapters+' 章、'+x.tables+' 张表'+(x.landscape?'（含横版分节）':'')+'。'+
          (x.hasFormalOne?'开标一览表保留原件中的 1 元形式报价；不带入审迹议价金额。':'开标一览表照录原件，不带入审迹议价金额。'));
      }catch(e){if(ticket===epoch)set('未生成：'+e.message,true);}
      finally{if(ticket===epoch)toggle();}
    }
    pick.onchange=()=>{const f=pick.files[0];pick.value='';if(f)void load(f);};
    use.onclick=()=>void load(currentTender?.());
    ack.onchange=toggle;
    download.onclick=()=>{
      if(!prepared||!ack.checked)return;
      try{
        const f=prepared.build(fill.checked?project():null),url=URL.createObjectURL(new Blob([f.bytes],{type:f.mime})),a=host.ownerDocument.createElement('a');
        try{a.href=url;a.download=f.name;host.ownerDocument.body.append(a);a.click();}
        finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
        set('已下载完整无章 Word。'+(fill.checked?'已填 '+f.filled+' 处明确空栏。':'未填写投标方资料。')+'请在 Word 中逐项补证、复核并按招标要求签署。');
      }catch(e){set('未下载：'+e.message,true);}
    };
    toggle();
  }
  root.BidOriginal=Object.freeze({prepare,mount});
})(globalThis);
