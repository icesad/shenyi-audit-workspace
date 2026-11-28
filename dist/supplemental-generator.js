/* Fill only traceable fields in a project-local Office template copy. */
(function(root){'use strict';
 const WORD='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 const templateTypes=['xlsx','docx'],sourceTypes=['xls','xlsx','docx','pdf','txt','csv','tsv'];
 const MAX_FILE=12*1024*1024, MAX_INPUT=48*1024*1024, MAX_SOURCES=20, MAX_EDITS=2000;
 const ext=file=>(file?.name||'').split('.').at(-1).toLowerCase();
 const normalize=value=>String(value??'').normalize('NFKC').replace(/\s+/gu,'').replace(/[:：]$/u,'');
 const hasValue=value=>typeof value==='string'?!!value.trim():typeof value==='number'&&Number.isFinite(value);
 const markers=/\{\{\s*([^{}]{1,150}?)\s*\}\}/gu;
 const x=()=>root.ProjectWorkspaceStore;
 const encoder=new TextEncoder();
 const serializer=()=>new root.XMLSerializer();
 const filename=(name,type)=>name.replace(/[<>:"/\\|?*\u0000-\u001f]/gu,'_').replace(/[. ]+$/u,'')+'.'+type;
 const wordParts=parts=>Object.keys(parts).filter(name=>/^word\/(?:document|header\d+|footer\d+)\.xml$/u.test(name));
 const children=(node,tag)=>[...node.children].filter(child=>child.namespaceURI===WORD&&child.localName===tag);
 const runs=p=>[...p.getElementsByTagNameNS(WORD,'t')].filter(t=>{
  let node=t.parentNode;while(node&&!(node.namespaceURI===WORD&&node.localName==='p'))node=node.parentNode;
  return node===p;
 });
 const paragraph=p=>runs(p).map(run=>run.textContent).join('');
 const unsafe=parts=>Object.keys(parts).some(name=>/(?:vbaProject|activeX|\/embeddings\/|externalLinks\/)/iu.test(name));
 function validFile(file,types){
  return file&&types.includes(ext(file))&&file.size>0&&file.size<=MAX_FILE;
 }
 function index(){
  const keys=new Map();
  function add(key,value,ref){
   key=normalize(key);
   if(!key||key.length>180||!hasValue(value)||String(value).length>1500)return;
   const entries=keys.get(key)||new Map(),item=String(value);
   if(!entries.has(item))entries.set(item,{value:item,ref});
   keys.set(key,entries);
  }
  function get(key){
   const entries=keys.get(normalize(key));
   if(!entries)return {status:'未找到来源'};
   if(entries.size!==1)return {status:'不同来源存在多个值'};
   return entries.values().next().value;
  }
  return {add,get};
 }
 function readKeyValue(rows,source,registry){
  for(const [i,row] of rows.entries()){
   const [key,value]=row;
   if(row.length===2&&typeof key==='string'&&hasValue(value))
    registry.add(key,value,source+' · 第 '+(i+1)+' 行');
   for(const [j,v] of row.entries())if(hasValue(v))
    registry.add(source+'!'+root.WorkpaperSheets.ref(i,j),v,source+'!'+root.WorkpaperSheets.ref(i,j));
  }
 }
 function textRows(text,delim){
  if(!delim)return text.split(/\r?\n/u).map(line=>{
   const match=/^\s*([^：:=\t]{1,100})\s*[:：=\t]\s*(.*)$/u.exec(line);
   return match?match.slice(1):[];
  });
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
   const c=text[i];
   if(c==='"'){
    if(quoted&&text[i+1]==='"'){field+='"';i++;}
    else if(quoted||!field)quoted=!quoted;
    else field+=c;
   }else if(!quoted&&c===delim){row.push(field);field='';}
   else if(!quoted&&/[\r\n]/u.test(c)){
    row.push(field);rows.push(row);field='';row=[];
    if(c==='\r'&&text[i+1]==='\n')i++;
   }else field+=c;
  }
  if(quoted)throw Error('分隔文本包含未结束的引号。');
  if(row.length||field)rows.push([...row,field]);
  return rows;
 }
 function sheetFields(model,file,registry){
  for(const sheet of model.sheets){
   if(sheet.visibility)continue;
   const values=Object.entries(sheet.cells).filter(([,cell])=>cell.t!=='e'&&hasValue(cell.v));
   const byRow=new Map();
   for(const [address,cell]of values){
    const v=typeof cell.v==='number'&&/^0\d+$/u.test(cell.w||'')?cell.w:cell.v;
    const ref=file.name+' / '+sheet.name+'!'+address;
    registry.add(sheet.name+'!'+address,v,ref);
    registry.add(file.name+'/'+sheet.name+'!'+address,v,ref);
    const m=/^([A-Z]+)(\d+)$/u.exec(address);
    const col=[...m[1]].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1,r=Number(m[2]);
    if(!byRow.has(r))byRow.set(r,new Map());byRow.get(r).set(col,{v,ref});
   }
   for(const row of byRow.values()){
    const items=[...row.entries()].sort((a,b)=>a[0]-b[0]);
    if(items.length!==2)continue;
    const [[,key],[,value]]=items;
    if(typeof key.v==='string'&&hasValue(value.v))registry.add(key.v,value.v,value.ref);
   }
   // A single-row source table may also provide unique header -> value fields.
   const ordered=[...byRow.entries()].sort((a,b)=>a[0]-b[0]);
   if(ordered.length===2&&ordered[1][0]===ordered[0][0]+1&&ordered[0][1].size>=2&&ordered[0][1].size===ordered[1][1].size&&
    [...ordered[0][1].values()].every(item=>typeof item.v==='string')){
    for(const [i,title]of ordered[0][1]){
     const val=ordered[1][1].get(i);if(val)registry.add(title.v,val.v,val.ref);
    }
   }
  }
 }
 async function readSource(file,registry,signal){
  const type=ext(file);
  if(type==='xls'||type==='xlsx'){sheetFields(await root.WorkpaperSheets.read(file,{signal}),file,registry);return;}
  if(type==='docx'){
   const parts=await x().parts(file);
   if(!parts['word/document.xml'])throw Error('Word 资料没有可读取正文。');
   const doc=x().xml(parts['word/document.xml']);
   const ps=[...doc.getElementsByTagNameNS(WORD,'p')];
   readKeyValue(textRows(ps.map(paragraph).join('\n')),file.name,registry);
   for(const [i,tr]of [...doc.getElementsByTagNameNS(WORD,'tr')].entries()){
    const cols=children(tr,'tc').map(cell=>children(cell,'p').map(paragraph).join('\n').trim());
    if(cols.length===2&&cols.every(Boolean))registry.add(cols[0],cols[1],file.name+' · Word 表格第 '+(i+1)+' 行');
   }
   return;
  }
  if(type==='pdf'){
   const pdf=await root.BidderPdfText.read(new Uint8Array(await file.arrayBuffer()));
   if(!pdf.lines?.length)throw Error(file.name+' 没有可读取文字，请提供带文字的 PDF 或电子表格。');
   readKeyValue(textRows(pdf.lines.join('\n')),file.name,registry);return;
  }
  const text=await file.text();
  readKeyValue(textRows(text,type==='tsv'?'\t':type==='csv'?',':''),file.name,registry);
 }
 function findMatches(source,registry,record,location){
  return [...String(source).matchAll(markers)].flatMap(match=>{
   const key=match[1].trim(),entry=registry.get(key);
   if(!entry.ref){record.missing.set(key,entry.status);return [];}
   record.fills.push({target:location,field:key,source:entry.ref});
   return [{start:match.index,end:match.index+match[0].length,value:entry.value}];
  });
 }
 function substitute(text,edits){for(const {start,end,value}of edits.slice().reverse())text=text.slice(0,start)+value+text.slice(end);return text;}
 function tracked(registry,record,key,where){
  const found=registry.get(key);
  if(!found.ref)return null;
  record.fills.push({target:where,field:key,source:found.ref});
  return found.value;
 }
 function replaceRuns(ps,edits){
  for(const {start,end,value}of edits.slice().reverse()){
   let pos=0,written=false;
   for(const n of ps){
    const text=n.textContent,next=pos+text.length,a=Math.max(start,pos),b=Math.min(end,next);
    if(a<b){
     n.textContent=text.slice(0,a-pos)+(written?'':value)+text.slice(b-pos);
     n.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');written=true;
    }
    pos=next;
   }
  }
 }
 function worksheetLocked(sheet,address){
  const cell=sheet.cells[address];
  if(cell?.f||cell?.array||cell?.l||cell?.t==='e')return true;
  const m=/^([A-Z]+)(\d+)$/u.exec(address),r=Number(m[2])-1,c=[...m[1]].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;
  return (sheet.merges||[]).some(({s,e})=>r>=s.r&&r<=e.r&&c>=s.c&&c<=e.c&&(r!==s.r||c!==s.c));
 }
 async function makeWorkbook(template,registry,record,signal){
  const parts=await x().parts(template);
  if(unsafe(parts)||!parts['xl/workbook.xml'])throw Error('请选择无宏且无外部工作簿链接的 XLSX 模板。');
  const model=await root.WorkpaperSheets.read(template,{signal});
  const changes={};
  for(const sheet of model.sheets){
   if(sheet.visibility)continue;
   const targets={};
   for(const [address,cell]of Object.entries(sheet.cells)){
    if(worksheetLocked(sheet,address)||typeof cell.v!=='string')continue;
    const where=sheet.name+'!'+address;
    const matches=findMatches(cell.v,registry,record,where);
    if(matches.length){targets[address]=substitute(cell.v,matches);continue;}
    if(!cell.v.trim()||/\{\{/.test(cell.v))continue;
    const m=/^([A-Z]+)(\d+)$/u.exec(address),col=[...m[1]].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0);
    const next=root.WorkpaperSheets.ref(Number(m[2])-1,col);
    if(col>sheet.range.e.c||Object.hasOwn(targets,next)||worksheetLocked(sheet,next)||hasValue(sheet.cells[next]?.v))continue;
    const label=cell.v.trim();
    // A blank cell is writable only next to a uniquely sourced, explicit label.
    if(!/[:：]$/u.test(label)&&!Object.hasOwn(sheet.cells,next))continue;
    const v=tracked(registry,record,label,sheet.name+'!'+next);
    if(v!==null)targets[next]=v;
   }
   if(Object.keys(targets).length)changes[sheet.name]=targets;
  }
  validateFills(record);
  return root.WorkpaperSheets.exportXlsx(template,model,changes,{compressed:true});
 }
 function makeWord(parts,registry,record){
  if(unsafe(parts)||!parts['word/document.xml'])throw Error('请选择无宏且无嵌入对象的 DOCX 模板。');
  for(const file of wordParts(parts)){
   const doc=x().xml(parts[file]);
   for(const [i,p]of [...doc.getElementsByTagNameNS(WORD,'p')].entries()){
    if(['fldChar','instrText','del'].some(tag=>p.getElementsByTagNameNS(WORD,tag).length))continue;
    const ps=runs(p),text=ps.map(run=>run.textContent).join('');
    const location=file+' · 第 '+(i+1)+' 段';
    const edit=findMatches(text,registry,record,location);
    if(edit.length){replaceRuns(ps,edit);continue;}
    if(text.trim())continue;
    const cell=p.parentElement,prior=cell?.previousElementSibling;
    if(cell?.localName!=='tc'||prior?.localName!=='tc'||children(cell,'p')[0]!==p||children(cell,'p').some(s=>paragraph(s).trim()))continue;
    const key=children(prior,'p').map(paragraph).join('').trim(),value=key&&tracked(registry,record,key,location);
    if(!value&&value!=='0')continue;
    const run=doc.createElementNS(WORD,'w:r'),t=doc.createElementNS(WORD,'w:t');
    t.textContent=value;t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');
    run.append(t);p.append(run);
   }
   parts[file]=encoder.encode(serializer().serializeToString(doc));
  }
  validateFills(record);
  return root.QuoteLayouts.packCompressedOfficeParts(parts);
 }
 function validateFills(record){
  if(!record.fills.length)throw Error('模板没有与资料唯一对应的可填字段。请使用「{{字段名}}」或「{{工作表名!单元格}}」标记，核对资料后再生成。');
  if(record.fills.length>MAX_EDITS)throw Error('本次可填字段超过 '+MAX_EDITS+' 项，请按底稿拆分。');
 }
 async function generate({name,template,files,signal}){
  if(typeof name!=='string'||!name.trim()||name.trim().length>100)throw Error('请输入 100 字以内的补充底稿名称。');
  if(!validFile(template,templateTypes))throw Error('请选择 12 MiB 以内可编辑的 XLSX 或 DOCX 模板。');
  if(!Array.isArray(files)||files.length<1||files.length>MAX_SOURCES||files.some(file=>!validFile(file,sourceTypes))||
   files.reduce((n,file)=>n+file.size,0)>MAX_INPUT)throw Error('资料支持 XLS、XLSX、DOCX、PDF、TXT、CSV、TSV，最多 20 份，每份 12 MiB，合计 48 MiB。');
  const check=()=>{if(signal?.aborted)throw Error('已离开本项目，生成取消。');};
  const provenance=file=>x().hash(file).then(sha256=>({name:file.name,sha256}));
  const registry=index(),sources=[],seen=new Set();
  for(const file of files){
   check();
   const item=await provenance(file);
   if(seen.has(item.sha256))continue;
   seen.add(item.sha256);await readSource(file,registry,signal);sources.push(item);check();
  }
  const record={fills:[],missing:new Map()},type=ext(template);
  const bytes=type==='xlsx'?await makeWorkbook(template,registry,record,signal):await makeWord(await x().parts(template),registry,record);
  check();
  const mime=type==='xlsx'?XLSX:DOCX;
  return {filename:filename(name.trim(),type),blob:new Blob([bytes],{type}),
   generation:{template:await provenance(template),sources,filled:record.fills.length,pending:[...record.missing].map(([field,reason])=>({field,reason})),
    trace:record.fills}};
 }
 root.SupplementalGenerator=Object.freeze({generate,validFile,templateTypes,sourceTypes,MAX_FILE,MAX_INPUT,MAX_SOURCES,MAX_EDITS});
})(globalThis);
