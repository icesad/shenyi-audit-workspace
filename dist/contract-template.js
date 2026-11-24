/* Local DOCX mail merge: explicit placeholders and labelled empty fields only. */
(function(root){'use strict';
 const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',enc=new TextEncoder();
 const labels=[
  ['乙方名称','事务所名称'],['受托方名称','事务所名称'],['乙方','事务所名称'],['受托方','事务所名称'],['乙方地址','事务所地址'],['乙方联系人','事务所联系人'],['乙方电话','事务所电话'],['乙方联系电话','事务所电话'],['乙方邮箱','事务所邮箱'],['乙方开户银行','事务所开户银行'],['乙方开户行','事务所开户银行'],['乙方银行账号','事务所银行账号'],['乙方账号','事务所银行账号'],['会计师事务所地址','事务所地址'],['事务所统一社会信用代码','事务所统一社会信用代码'],['事务所开户银行','事务所开户银行'],['事务所银行账号','事务所银行账号'],['事务所联系人','事务所联系人'],['事务所联系电话','事务所电话'],['事务所电话','事务所电话'],['事务所邮箱','事务所邮箱'],['事务所地址','事务所地址'],['会计师事务所名称','事务所名称'],['事务所名称','事务所名称'],
  ['乙方（会计师事务所）','事务所名称'],['乙方(会计师事务所)','事务所名称'],['受托方（会计师事务所）','事务所名称'],['受托方(会计师事务所)','事务所名称'],['被审计单位名称','被审计单位'],['被审计单位','被审计单位'],['发标单位','发标单位'],['项目名称','项目名称'],['审计年度','审计年度'],['中标金额大写','中标金额大写'],['合同金额大写','合同金额大写'],['中标金额','中标金额'],['合同金额','合同金额']
 ];
 const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 function validateFields(fields){if(!fields||typeof fields!=='object'||Array.isArray(fields))throw Error('合同填报资料无效');for(const [k,v]of Object.entries(fields))if(typeof v!=='string'||v.length>1000||!v.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))throw Error('合同字段内容无效');}
 function texts(p){return Array.from(p.getElementsByTagNameNS(W,'t')).filter(n=>{let a=n.parentNode;while(a&&!(a.namespaceURI===W&&a.localName==='p'))a=a.parentNode;return a===p;});}
 function text(p){return texts(p).map(t=>t.textContent).join('');}
 function scan(p,part,index,fields){const s=text(p),out=[],used=[];const add=(start,end,field,label,kind)=>{if(used.some(([a,b])=>start<b&&end>a))return;used.push([start,end]);const value=Object.hasOwn(fields,field)?fields[field]:'';out.push({id:part+'#'+index+':'+start+':'+end,part,paragraph:index,start,end,field,label,kind,before:s.slice(Math.max(0,start-55),Math.min(s.length,end+55)),value,available:!!value.trim()});};
  for(const m of s.matchAll(/\{\{([^{}]+)\}\}/g))add(m.index,m.index+m[0].length,(labels.find(([label])=>label===m[1].trim())?.[1]||m[1].trim()),m[0],'placeholder');
  for(const [label,field]of labels){const re=new RegExp(esc(label)+'\\s*[:：]([\\u00a0\\u3000 ]*[_＿]{2,}|[\\u00a0\\u3000 ]{2,}|[\\u00a0\\u3000 ]*$)','g');for(const m of s.matchAll(re)){const blank=m[1];const start=m.index+m[0].length-blank.length;add(start,start+blank.length,field,label,'labelled-blank');}}
  // A known label in the immediately preceding table cell can identify an empty answer cell; never inspect unrelated rows or overwrite existing text.
  if(!s.trim()||/^[\s_＿]+$/.test(s)){const cell=p.parentElement;if(cell?.namespaceURI===W&&cell.localName==='tc'){const prev=cell.previousElementSibling;if(prev?.namespaceURI===W&&prev.localName==='tc'){const label=[...prev.getElementsByTagNameNS(W,'t')].map(t=>t.textContent).join('').trim().replace(/[:：]$/,'').trim(),field=labels.find(([name])=>name===label)?.[1],paras=[...cell.getElementsByTagNameNS(W,'p')];if(field&&paras[0]===p&&paras.every(x=>!text(x).trim()||/^[\s_＿]+$/.test(text(x))))add(0,s.length,field,label,'labelled-cell');}}}
  return out.sort((a,b)=>a.start-b.start);
 }
 async function plan(file,fields){validateFields(fields);if(!file||!file.size||file.size>12*1024*1024||! /\.docx$/i.test(file.name||''))throw Error('请选择12MiB以内的DOCX合同模板');const ps=await root.ProjectWorkspaceStore.parts(file);if(!ps['[Content_Types].xml']||!ps['word/document.xml']||Object.keys(ps).some(k=>/vbaProject/i.test(k)))throw Error('请选择有效的DOCX合同模板');root.ProjectWorkspaceStore.xml(ps['[Content_Types].xml']);const docs=[],matches=[];for(const part of Object.keys(ps))if(/^word\/(?:document|header\d+|footer\d+)\.xml$/.test(part)){const x=root.ProjectWorkspaceStore.xml(ps[part]),paras=Array.from(x.getElementsByTagNameNS(W,'p'));paras.forEach((p,i)=>matches.push(...scan(p,part,i,fields)));docs.push({part,x,paras});}return{ps,docs,matches};}
 async function inspect(file,fields){const p=await plan(file,fields);return{matches:p.matches,fillable:p.matches.filter(m=>m.available).length,missing:p.matches.filter(m=>!m.available).map(m=>m.field),notice:'只填明确字段和带标签的空位，已有内容及合同条款保持原样；未识别的空白请在Word核对。'};}
 function replace(p,m){const ts=texts(p);if(!ts.length&&m.start===0&&m.end===0){const r=p.ownerDocument.createElementNS(W,'w:r'),t=p.ownerDocument.createElementNS(W,'w:t');t.textContent=m.value;r.append(t);p.append(r);return;}let start=0,inserted=false;for(const n of ts){const s=n.textContent,end=start+s.length;if(m.start===m.end){if(!inserted&&m.start>=start&&m.start<=end){const at=m.start-start;n.textContent=s.slice(0,at)+m.value+s.slice(at);n.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');inserted=true;}}else{const a=Math.max(m.start,start),b=Math.min(m.end,end);if(a<b){n.textContent=s.slice(0,a-start)+(!inserted?m.value:'')+s.slice(b-start);n.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');inserted=true;}}start=end;}if(!inserted)throw Error('合同空位无法写入，原件未修改');}
 async function fill(file,fields,{selectedIds}={}){const p=await plan(file,fields),selected=selectedIds===undefined?null:new Set(selectedIds);if(selected&&[...selected].some(id=>!p.matches.some(m=>m.id===id&&m.available)))throw Error('合同核对选择已变化，请重新识别');const chosen=p.matches.filter(m=>m.available&&(!selected||selected.has(m.id)));if(!chosen.length)throw Error('未选中可填写的明确字段；请核对模板标签或使用 {{事务所名称}} 等标记。');for(const d of p.docs){let changed=false;for(let i=0;i<d.paras.length;i++){const ms=chosen.filter(m=>m.part===d.part&&m.paragraph===i).sort((a,b)=>b.start-a.start);for(const m of ms)replace(d.paras[i],m);if(ms.length)changed=true;}if(changed)p.ps[d.part]=enc.encode(new XMLSerializer().serializeToString(d.x));}return{bytes:root.QuoteLayouts.packOfficeParts(p.ps),count:chosen.length,filled:chosen.map(m=>({field:m.field,kind:m.kind})),missing:p.matches.filter(m=>!m.available).map(m=>m.field)};}

 const WREL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const wordChildren=(node,name)=>[...node.children].filter(child=>child.namespaceURI===W&&child.localName===name);
 const wordText=node=>[...node.getElementsByTagNameNS(W,'t')].map(item=>item.textContent).join('');
 const colKey=value=>value.normalize('NFKC').replace(/[\s():：]/gu,'');
 const quoteMoney=/(?:报价总额|含税报价(?:总额)?|总报价(?:为)?|总体报价为|投标报价为|报价金额|报价合计|小写)\s*(?:[（(]含税[）)])?\s*[:：]?\s*(?=[人民币¥￥零壹贰叁肆伍陆柒捌玖拾佰仟万\d_＿{])/u;
 function priceTable(body){
  for(const table of wordChildren(body,'tbl')){
   const rows=wordChildren(table,'tr');
   for(const [index,row] of rows.entries()){
    const headings=wordChildren(row,'tc').map(cell=>colKey(wordText(cell)));
    const company=headings.findIndex(name=>/^(?:被审计单位(?:名称)?|单位名称|公司名称|客户名称|审计对象)$/u.test(name));
    const price=headings.findIndex(name=>/^(?:含税)?(?:报价(?:金额)?|审计费用|金额)(?:含税)?(?:单位)?(?:万元|元)?$/u.test(name));
    if(company>=0&&price>=0)return {table,rows,index,headings,company,price};
   }
  }
  return null;
 }
 function setParagraph(p,value){
  // Retain the source paragraph and run formatting while dropping old text and field content.
  for(const tag of ['instrText','fldChar','del','moveFrom','footnoteReference','endnoteReference','commentRangeStart','commentRangeEnd','commentReference'])
   for(const node of [...p.getElementsByTagNameNS(W,tag)])node.remove();
  replace(p,{start:0,end:text(p).length,value});
  return p;
 }
 function setQuoteCell(cell,value){
  for(const child of [...cell.children])if(child.namespaceURI!==W||!['p','tcPr'].includes(child.localName))child.remove();
  const paragraphs=wordChildren(cell,'p');
  if(!paragraphs.length){cell.append(setParagraph(cell.ownerDocument.createElementNS(W,'w:p'),value));return;}
  paragraphs.forEach((p,i)=>setParagraph(p,i===0?value:''));
 }
 function decimalPrice(cents,wan){
  if(!wan)return root.QuoteCalc.formatMoney(cents);
  const n=BigInt(cents),fraction=String(n%1000000n).padStart(6,'0').replace(/0+$/u,'');
  return String(n/1000000n)+(fraction?'.'+fraction:'');
 }
 function actualColumn(key,row){
  const value=/^(?:资产总额|总资产)/u.test(key)?row.assets:/^(?:营业收入|累计收入|年度收入|收入)/u.test(key)?row.revenue:
   /^(?:净利润|利润)/u.test(key)?row.profit:/^(?:期间|审计期间|所属期间)/u.test(key)?row.period:'';
  if(value===''||value==null)return '—';
  if(/元$/u.test(key)&&!/万元$/u.test(key)&&/^-?\d+(?:\.\d{1,6})?$/u.test(value)){
   const amount=String(value),negative=amount.startsWith('-'),[whole,fraction='']=amount.replace(/^-/u,'').split('.');
   const cents=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
   return (negative&&cents?'-':'')+String(cents/100n)+'.'+String(cents%100n).padStart(2,'0');
  }
  return String(value);
 }
 function filledPriceTable(spec,units,total){
  const {table,rows,index,headings,company,price}=spec,output=table.cloneNode(true),copied=wordChildren(output,'tr');
  const totalFormat=rows.slice(index+1).find(row=>wordChildren(row,'tc').some(cell=>/^(?:合计|总计|小计)$/u.test(colKey(wordText(cell)))));
  const bodyFormats=rows.slice(index+1).filter(row=>row!==totalFormat&&wordChildren(row,'tc').length===headings.length);
  const model=bodyFormats[0]||rows[index];
  const wan=/万元$/u.test(headings[price]);
  copied.slice(0,index).forEach(row=>wordChildren(row,'tc').forEach(cell=>setQuoteCell(cell,'')));
  setQuoteCell(wordChildren(copied[index],'tc')[price],wan?'含税报价（万元）':'含税报价（元）');
  copied.slice(index+1).forEach(row=>row.remove());
  for(const [line,unit] of units.entries()){
   const row=(bodyFormats[line]||model).cloneNode(true);
   wordChildren(row,'tc').forEach((cell,i)=>setQuoteCell(cell,i===company?unit.name:i===price?decimalPrice(unit.totalCents,wan):headings[i]==='序号'?String(line+1):actualColumn(headings[i],unit)));
   output.append(row);
  }
  if(units.length>1||totalFormat){
   const row=model.cloneNode(true);
   wordChildren(row,'tc').forEach((cell,i)=>setQuoteCell(cell,i===company?'合计':i===price?decimalPrice(total,wan):''));
   output.append(row);
  }
  return output;
 }
 async function fillQuotation(file,snapshot){
  if(!file||!/\.docx$/i.test(file.name))throw Error('按参考版式生成报价，请上传可编辑的 Word（.docx）参考文件。');
  const parts=await root.ProjectWorkspaceStore.parts(file);
  if(!parts['[Content_Types].xml']||!parts['word/document.xml']||Object.keys(parts).some(name=>/vbaProject|activeX|\/embeddings\//i.test(name)))throw Error('请选择可编辑且不含嵌入对象的 DOCX 报价参考文件。');
  const units=snapshot.quoteRows||[{name:snapshot.customerName,totalCents:snapshot.totalCents}];
  const serializer=new XMLSerializer();
  for(const part of Object.keys(parts)){
   if(/^word\/(?:document|header\d+|footer\d+)\.xml$/u.test(part)){
    const xml=root.ProjectWorkspaceStore.xml(parts[part]);
    for(const tag of ['drawing','pict','object'])for(const node of [...xml.getElementsByTagNameNS(W,tag)])node.remove();
    for(const link of [...xml.getElementsByTagNameNS(W,'hyperlink')])if(link.hasAttributeNS(WREL,'id'))link.replaceWith(...link.childNodes);
    if(part==='word/document.xml'){
     const body=xml.getElementsByTagNameNS(W,'body')[0];
     if(!body)throw Error('参考文件没有可读取的报价正文。');
     const paragraphs=wordChildren(body,'p'),table=priceTable(body);
     const price=paragraphs.find(p=>quoteMoney.test(text(p))||/\{\{\s*(?:含税报价|报价金额)\s*\}\}/u.test(text(p)));
     if(!table&&!price)throw Error('未找到可复用的报价金额或明细表，请在参考文件中写明「含税报价」。');
     const title=paragraphs.find(p=>text(p).trim().length<100&&/报价(?:明细|单|函|表|书)(?:[（(].*?[）)])?\s*$/u.test(text(p)));
     const salutation=paragraphs.find(p=>/^(?:致\s*[：:]\s*\S|[^：:]{4,100}(?:公司|单位|机构)\s*[：:]\s*$)/u.test(text(p).trim()));
     const closing=paragraphs.find(p=>/^\s*(?:供应商全称|报价单位|投标人|单位名称|会计师事务所名称)\s*[:：]/u.test(text(p)));
     const dated=paragraphs.find(p=>/^\s*\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*$/u.test(text(p)));
     const bodyStyle=paragraphs.find(p=>/收到.*询价|根据.*询价/u.test(text(p)))||price;
     const make=(style,value)=>setParagraph(style?style.cloneNode(true):xml.createElementNS(W,'w:p'),value);
     const nodes=[
      make(title,snapshot.projectName+(title&&/报价明细|报价单/u.test(text(title))?'报价明细':'报价函')),
      make(salutation||bodyStyle,'致：'+snapshot.issuer),
      make(bodyStyle,'被审计单位：'+units.map(unit=>unit.name).join('、')),
      make(bodyStyle,'项目类型：'+snapshot.projectType+'　计价地区：'+snapshot.location),
      make(price||bodyStyle,'含税报价：¥ '+decimalPrice(snapshot.totalCents,false)+' 元（大写：'+root.QuoteLayouts.upper(snapshot.totalCents)+'）')
     ];
     if(table)nodes.push(filledPriceTable(table,units,snapshot.totalCents));
     else if(units.length>1)for(const unit of units)nodes.push(make(bodyStyle,unit.name+'：¥ '+decimalPrice(unit.totalCents,false)+' 元（含税）'));
     nodes.push(make(closing||bodyStyle,'报价单位：'+snapshot.firmName));
     const contact=snapshot.bidderContact;
     if(contact&&(contact.name||contact.phone||contact.email))nodes.push(make(bodyStyle,'报价联系人：'+[contact.name,contact.phone,contact.email].filter(Boolean).join(' / ')));
     nodes.push(make(dated||closing||bodyStyle,'报价日期：'+snapshot.quoteDate),make(bodyStyle,'本报价为待审核草稿。'));
     const section=wordChildren(body,'sectPr')[0];
     body.replaceChildren(...nodes,...(section?[section]:[]));
    }else{
     // Keep header/footer placement but do not bring along another party’s text or marks.
     xml.documentElement.replaceChildren(xml.createElementNS(W,'w:p'));
    }
    parts[part]=enc.encode(serializer.serializeToString(xml));
   }else if(/\.rels$/u.test(part)){
    const xml=root.ProjectWorkspaceStore.xml(parts[part]);
    for(const relation of [...xml.getElementsByTagNameNS('*','Relationship')]){
     const type=relation.getAttribute('Type')||'';
     if(relation.getAttribute('TargetMode')==='External'||/\/(?:image|thumbnail|comments(?:Extended|Ids)?|people|footnotes|endnotes|customXml|core-properties|extended-properties|custom-properties)$/iu.test(type))relation.remove();
    }
    parts[part]=enc.encode(serializer.serializeToString(xml));
   }else if(/^(?:word\/(?:media\/|comments[^/]*\.xml|people\.xml|footnotes\.xml|endnotes\.xml)|docProps\/|customXml\/)/iu.test(part))delete parts[part];
  }
  const types=root.ProjectWorkspaceStore.xml(parts['[Content_Types].xml']);
  for(const override of [...types.getElementsByTagNameNS('*','Override')])if(!parts[(override.getAttribute('PartName')||'').slice(1)])override.remove();
  parts['[Content_Types].xml']=enc.encode(serializer.serializeToString(types));
  return {name:'本次报价-以往报价参考版.docx',mime:root.QuoteLayouts.docxMime,bytes:root.QuoteLayouts.packOfficeParts(parts)};
 }
 root.ContractTemplate=Object.freeze({inspect,fill,fillQuotation});
})(globalThis);
