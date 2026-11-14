/* Local outline suggestions only. Users must review levels before creating material nodes. */
(function(root){
  'use strict';
  const LIMIT=150000,MAX_NODES=500,MAX_ROWS=5000,MAX_FILE=2*1024*1024;
  const WORD=['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main'];
  const fail=s=>{throw Error(s);};
  function text(value,max=LIMIT){
    if(typeof value!=='string'||!value.isWellFormed()||value.length>max||/[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value))fail('大纲文字过长或含不支持的字符。');
    return value.replace(/\r\n?|[\u000b\u000c]/gu,'\n').trim();
  }
  function paragraphs(xs){
    if(!Array.isArray(xs)||xs.length>MAX_ROWS)fail('大纲段落过多，最多 5000 段。');
    let chars=0;
    return xs.map(p=>{
      if(!p||typeof p!=='object'||p.level!==null&&(!Number.isInteger(p.level)||p.level<1||p.level>9))fail('大纲层级无效。');
      const s=text(p.text);chars+=s.length;if(chars>LIMIT)fail('大纲最多 150,000 字符。');
      return {text:s,level:p.level,styleName:p.styleName==null?'':text(p.styleName,200)};
    }).filter(p=>p.text);
  }
  const result=(xs,kind)=>{
    const ps=paragraphs(xs),actualLevels=Object.fromEntries(Array.from({length:9},(_,i)=>[i+1,0]));
    for(const p of ps)if(p.level!==null)actualLevels[p.level]++;
    return {paragraphs:ps,actualLevels,kind};
  };
  function xml(raw,name,max){
    if(raw==null||raw==='')return null;
    if(typeof raw!=='string'||raw.length>max||/<!DOCTYPE|<!ENTITY/iu.test(raw)||(raw.match(/</gu)||[]).length>60000)fail('DOCX 大纲 XML 过大或不受支持。');
    if(typeof root.DOMParser!=='function')fail('当前环境不能读取 DOCX 大纲。');
    const doc=new root.DOMParser().parseFromString(raw,'application/xml'),top=doc.documentElement;
    if(!top||!WORD.includes(top.namespaceURI)||top.localName!==name||doc.getElementsByTagName('parsererror').length)fail('DOCX 大纲 XML 无效。');
    return top;
  }
  const kids=(e,n)=>e?Array.from(e.children||[]).filter(x=>x.namespaceURI===e.namespaceURI&&x.localName===n):[];
  const child=(e,n)=>kids(e,n)[0]||null;
  const attr=(e,n)=>e?.getAttributeNS(e.namespaceURI,n)||'';
  const on=e=>e&&!['0','false','off'].includes(attr(e,'val'));
  function outline(pr){
    const e=child(pr,'outlineLvl');if(!e)return undefined;
    const v=attr(e,'val');if(!/^[0-9]$/u.test(v))fail('DOCX 大纲级别无效。');return v==='9'?null:Number(v)+1;
  }
  function hidden(pr){const out={};for(const k of ['vanish','webHidden']){const e=child(pr,k);if(e)out[k]=!!on(e);}return out;}
  function numProps(pr){
    const n=child(pr,'numPr');if(!n)return {};
    const out={};for(const k of ['numId','ilvl']){const v=attr(child(n,k),'val');if(v){if(!/^\d{1,8}$/u.test(v))fail('DOCX 编号属性无效。');out[k]=Number(v);}}
    if(out.ilvl>8)fail('DOCX 编号层级无效。');return out;
  }
  function styleReader(top){
    const styles=new Map();let defaultId='';
    for(const e of kids(top,'style')){
      const id=attr(e,'styleId');if(!id||id.length>128||styles.has(id))fail('DOCX 样式重复或无效。');
      const type=attr(e,'type')||'paragraph',p=type==='paragraph'?child(e,'pPr'):null;
      styles.set(id,{id,type,name:attr(child(e,'name'),'val'),base:attr(child(e,'basedOn'),'val'),level:outline(p),hidden:hidden(child(e,'rPr')),num:numProps(p)});
      if(attr(e,'type')==='paragraph'&&['1','true','on'].includes(attr(e,'default')))defaultId=id;
    }
    const defaults=child(child(child(top,'docDefaults'),'pPrDefault'),'pPr');
    const defaultRun=hidden(child(child(child(top,'docDefaults'),'rPrDefault'),'rPr'));
    const cache=new Map();
    function get(id,expected='paragraph',trail=[]){
      if(!id||!styles.has(id))return {name:id||'',level:undefined,hidden:{},num:{}};
      const s=styles.get(id);if(s.type!==expected)fail('DOCX 样式类型不匹配，不能把字符样式作为段落大纲。');
      if(cache.has(id))return cache.get(id);
      if(trail.includes(id)||trail.length>=128)fail('DOCX 样式继承循环或过深。');
      const b=get(s.base,expected,trail.concat(id)),v={name:s.name||id,level:s.level===undefined?b.level:s.level,hidden:{...b.hidden,...s.hidden},num:{...b.num,...s.num}};
      cache.set(id,v);return v;
    }
    return {get,defaultId,defaultLevel:outline(defaults),defaultRun};
  }
  function numberingReader(top){
    const abstracts=new Map(),nums=new Map(),counters=new Map();
    function level(e){
      const start=attr(child(e,'start'),'val'),fmt=attr(child(e,'numFmt'),'val')||'decimal',pattern=attr(child(e,'lvlText'),'val');
      if(start&&!/^\d{1,8}$/u.test(start)||pattern.length>1000||fmt.length>80)fail('DOCX 编号起点或格式无效。');
      return {start:start?Number(start):1,fmt,pattern,outline:outline(child(e,'pPr'))};
    }
    for(const a of kids(top,'abstractNum')){
      const id=attr(a,'abstractNumId');if(abstracts.has(id))fail('DOCX 编号定义重复。');
      const ls=new Map();for(const l of kids(a,'lvl')){const i=attr(l,'ilvl');if(!/^[0-8]$/u.test(i)||ls.has(Number(i)))fail('DOCX 编号级别无效。');ls.set(Number(i),level(l));}abstracts.set(id,ls);
    }
    for(const n of kids(top,'num')){
      const id=attr(n,'numId'),ls=new Map(abstracts.get(attr(child(n,'abstractNumId'),'val'))||[]);if(nums.has(id))fail('DOCX 编号实例重复。');
      for(const o of kids(n,'lvlOverride')){const i=attr(o,'ilvl');if(!/^[0-8]$/u.test(i))fail('DOCX 编号覆盖无效。');const k=Number(i),l=child(o,'lvl'),v=l?level(l):ls.get(k),start=attr(child(o,'startOverride'),'val');if(v){if(start&&!/^\d{1,8}$/u.test(start))fail('DOCX 编号覆盖无效。');ls.set(k,{...v,...(start?{start:Number(start)}:{})});}}
      nums.set(id,ls);
    }
    function format(n,f){
      if(f==='decimalZero')return String(n).padStart(2,'0');
      if(f==='upperLetter'||f==='lowerLetter'){let s='';for(let k=n;k>0;k=Math.floor((k-1)/26))s=String.fromCharCode(65+(k-1)%26)+s;return f==='lowerLetter'?s.toLowerCase():s;}
      if(f==='upperRoman'||f==='lowerRoman'){let s='',k=n;for(const [v,t] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]){while(k>=v&&s.length<1000){s+=t;k-=v;}}return f==='lowerRoman'?s.toLowerCase():s;}
      if(['chineseCounting','chineseCountingThousand','ideographTraditional'].includes(f)&&n>0&&n<100){const digits='零一二三四五六七八九';return n<10?digits[n]:(n<20?'':digits[Math.floor(n/10)])+'十'+(n%10?digits[n%10]:'');}
      return String(n);
    }
    return function(props){
      if(!props.numId)return {prefix:'',level:undefined};const ls=nums.get(String(props.numId)),i=props.ilvl||0,l=ls?.get(i);if(!l)return {prefix:'',level:undefined};
      const cs=counters.get(props.numId)||[];cs[i]=cs[i]===undefined?l.start:cs[i]+1;for(let j=i+1;j<9;j++)cs[j]=undefined;counters.set(props.numId,cs);
      const prefix=l.pattern.replace(/%([1-9])/gu,(_,s)=>{const k=Number(s)-1,v=ls.get(k);return format(cs[k]===undefined?(v?.start||1):cs[k],v?.fmt||'decimal');});
      return {prefix:prefix?prefix+' ':'',level:l.outline};
    };
  }
  function docxParagraphs(document,styles,numbering){
    const body=child(document,'body');if(!body)fail('DOCX 缺少正文。');const out=[];let chars=0;
    function contents(p,defaults){
      let s='';
      function visit(n,depth,hide){
        if(depth>128)fail('DOCX 内容嵌套过深。');
        if(n.nodeType!==1)return;
        if(n.namespaceURI!==p.namespaceURI){for(const c of Array.from(n.children||[]))visit(c,depth+1,hide);return;}
        const k=n.localName;if(['del','moveFrom','delText','instrText','txbxContent','pPr','rPr'].includes(k)||n!==p&&k==='p')return;
        if(k==='r'){
          const pr=child(n,'rPr'),st=styles.get(attr(child(pr,'rStyle'),'val'),'character'),h={...defaults,...st.hidden,...hidden(pr)};hide=h.vanish||h.webHidden;
        }
        if(!hide){if(k==='t')s+=n.textContent;else if(k==='tab')s+='\t';else if(k==='br'||k==='cr')s+='\n';else if(k==='noBreakHyphen')s+='\u2011';else if(k==='softHyphen')s+='\u00ad';}
        if(k!=='t')for(const c of Array.from(n.children||[]))visit(c,depth+1,hide);
      }
      visit(p,0,defaults.vanish||defaults.webHidden);return s;
    }
    function walk(n,depth){
      if(depth>128)fail('DOCX 内容嵌套过深。');
      if(n.namespaceURI===document.namespaceURI&&['del','moveFrom','txbxContent'].includes(n.localName))return;
      if(n.namespaceURI===document.namespaceURI&&n.localName==='p'){
        const pr=child(n,'pPr'),id=attr(child(pr,'pStyle'),'val')||styles.defaultId,st=styles.get(id),num=numbering({...st.num,...numProps(pr)}),direct=outline(pr);
        const level=direct!==undefined?direct:st.level!==undefined?st.level:num.level!==undefined?num.level:styles.defaultLevel;
        // pPr/rPr formats only the paragraph mark, not the visible text runs.
        const s=contents(n,{...styles.defaultRun,...st.hidden});
        if(s.trim()){chars+=num.prefix.length+s.length;if(chars>LIMIT)fail('大纲最多 150,000 字符。');out.push({text:num.prefix+s,level:level===undefined?null:level,styleName:st.name});}if(out.length>MAX_ROWS)fail('大纲段落过多。');return;
      }
      for(const c of Array.from(n.children||[]))walk(c,depth+1);
    }
    walk(body,0);return out;
  }
  async function read(file){
    if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_FILE||typeof file.name!=='string')fail('请选择不超过 2 MB 的 DOC、DOCX 或 UTF-8 TXT。');
    const kind=/\.docx$/iu.test(file.name)?'docx':/\.doc$/iu.test(file.name)?'doc':/\.txt$/iu.test(file.name)?'txt':null;
    if(!kind)fail('请选择 DOC、DOCX 或 UTF-8 TXT。');
    if(kind==='txt'){
      let s;try{const bytes=await file.arrayBuffer();if(bytes.byteLength!==file.size||bytes.byteLength>MAX_FILE)fail('大小无效');s=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('TXT 必须是有效 UTF-8 且大小有效。');}
      return result(s.replace(/^\ufeff/u,'').split(/\r\n|[\r\n]/u).map(s=>({text:s,level:null,styleName:''})),kind);
    }
    if(kind==='doc'){
      if(!root.LegacyDoc?.readStructure)fail('旧版 DOC 大纲组件未载入，请刷新或另存为 DOCX。');
      const s=await root.LegacyDoc.readStructure(file);return result(s?.paragraphs,kind);
    }
    if(!root.TenderImport?.openBidTemplate)fail('DOCX 读取组件未载入。');
    const pkg=await root.TenderImport.openBidTemplate(file),[d,s,n]=await Promise.all(['word/document.xml','word/styles.xml','word/numbering.xml'].map(p=>pkg.read(p)));
    const document=xml(d,'document',8*1024*1024);if(!document)fail('DOCX 缺少正文。');
    return result(docxParagraphs(document,styleReader(xml(s,'styles',512*1024)),numberingReader(xml(n,'numbering',512*1024))),kind);
  }
  function token(s){
    if(/^[一二三四五六七八九十百零〇两]+[、.．]\s*\S/u.test(s))return {kind:'category'};
    const m=/^(\d{1,4}(?:[.．]\d{1,4})*)([、.．:：)）]|\s+)?/u.exec(s);
    if(!m||!m[2]&&!/[.．]/u.test(m[1]))return null;
    if(/^\d{4}$/u.test(m[1])&&Number(m[1])>=1800&&Number(m[1])<=2199&&/^\s+$/u.test(m[2]||'')&&/^年/u.test(s.slice(m[0].length)))return null;
    const parts=m[1].split(/[.．]/u).map(x=>String(Number(x)));if(parts.length>8||!s.slice(m[0].length).trim())return null;
    return {kind:'number',parts,key:parts.join('.')};
  }
  function prepare(source,mode){
    if(!source||!['outline','numbered'].includes(mode))fail('请选择实际大纲或按编号整理。');
    const ps=paragraphs(source.paragraphs),rows=[],warnings=[],warn=s=>{if(!warnings.includes(s))warnings.push(s);};
    if(mode==='outline'){
      for(const p of ps)rows.push({text:p.text,level:p.level||0});
      if(!rows.some(r=>r.level))warn('未识别到实际 Word 大纲标题；正文保留为说明，请在预览中指定标题，或明确选择按编号整理。');
    }else{
      warn('按编号整理仅为建议，原编号不改写；请在预览逐行确认标题层级与说明。');
      let category=false,base=1,seen=new Map(),path=[];
      const segments=[];
      for(const p of ps){let current='';for(const line of p.text.split('\n')){if(current&&token(line.trim())){segments.push(current);current=line;}else current+=(current?'\n':'')+line;}if(current.trim())segments.push(current.trim());}
      for(const s of segments){
        const t=token(s.split('\n')[0]);let level=0;
        if(t?.kind==='category'){category=true;base=2;seen=new Map();path=[];level=1;}
        else if(t?.kind==='number'){
          if(!category)warn('存在无中文一级分类的编号；主编号暂建议为一级，相对子编号相应下移，请核对。');
          level=base+t.parts.length-1;const parent=t.parts.slice(0,-1).join('.');
          if(t.parts.length>1&&(!seen.get(parent)||path[t.parts.length-2]!==parent)){
            warn('编号「'+t.key+'」未找到当前唯一父号「'+parent+'」，已提升为独立待核对标题，未挂到其他编号。');level=base;
          }
          if(seen.has(t.key)){seen.set(t.key,false);warn('当前分类存在重复编号「'+t.key+'」，保留各标题；其子号须人工核对。');}
          else seen.set(t.key,true);
          if(level===base&&t.parts.length>1){path=[];seen.set(t.key,false);}else{path.length=t.parts.length;path[t.parts.length-1]=t.key;}
        }
        rows.push({text:s,level});
      }
      if(!rows.some(r=>r.level))warn('没有识别到明确编号标题；未编号正文保留为说明，不自动生成资料项。');
    }
    if(rows.length>MAX_ROWS||rows.filter(r=>r.level).length>MAX_NODES)fail('标题最多 500 项，段落最多 5000 段。');
    let previous=0,first=true,leading=false;
    for(const r of rows){
      if(!r.level){if(first)leading=true;continue;}
      if(r.text.length>1000)warn('标题「'+r.text.slice(0,30)+'」超过 1000 字符，请在预览拆分或改为说明。');
      if(first&&r.level!==1||r.level>previous+1)warn('标题「'+r.text.slice(0,50)+'」存在层级跳跃，请在预览修正后导入。');previous=r.level;first=false;
    }
    if(leading)warn('文档开头有未归属的正文，预览保留为说明；导入时附在首标题说明中，不作为独立资料项。');
    return {rows,warnings};
  }
  function build(rows){
    if(!Array.isArray(rows)||rows.length>MAX_ROWS)fail('大纲预览行无效或过多。');
    const out=[],stack=[],leading=[];let current=null,chars=0;
    for(const row of rows){
      if(!row||!Number.isInteger(row.level)||row.level<0||row.level>9)fail('预览层级必须为 0–9。');
      const s=text(row.text);chars+=s.length;if(chars>LIMIT)fail('大纲最多 150,000 字符。');if(!s){if(row.level)fail('标题不能为空。');continue;}
      if(!row.level){if(current)current.description+=(current.description?'\n':'')+s;else leading.push(s);continue;}
      if(out.length>=MAX_NODES)fail('大纲最多 500 个标题。');if(s.length>1000)fail('单个标题超过 1000 字符，请在预览改为说明。');
      const l=row.level;if(l>stack.length+1||!out.length&&l!==1)fail('标题层级跳跃；请先指定一级标题并在预览补齐父级。');
      stack.length=l-1;const parent=l>1?stack[l-2]:null;if(l>1&&!parent)fail('标题缺少父级，请在预览修正。');
      current={id:'n'+(out.length+1),parentId:parent?.id||'',level:l,title:s,description:''};
      if(!out.length&&leading.length)current.description='文档前置说明（不作为资料项）\n'+leading.join('\n');
      out.push(current);stack.push(current);
    }
    if(!out.length)fail('没有标题，请先在预览指定至少一个一级标题；正文不能自动作为上传项。');
    if(out.some(n=>n.description.length>20000))fail('单个标题说明超过 20,000 字符，请在预览拆分归属。');
    if(out.reduce((n,x)=>n+x.title.length+x.description.length,0)>LIMIT)fail('大纲最多 150,000 字符（含说明）。');
    return out;
  }
  const api=Object.freeze({read,prepare,build});if(typeof module==='object'&&module.exports)module.exports=api;else root.AuditOutline=api;
})(globalThis);
