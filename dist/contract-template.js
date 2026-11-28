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
 const sourceFirm=/^(?:供应商全称|供应商名称|报价单位(?:名称)?|投标人(?:名称)?|单位名称|事务所名称)\s*[:：]\s*(.+?)(?=\s*[（(](?:盖|公章|签)|$)/u;
 const firmNamePattern=/^[\p{L}\d·（）()]{2,45}会计师事务所(?:[（(](?:特殊普通合伙|普通合伙|有限责任公司|合伙)[）)])?/u;
 const sectionKinds=[
  ['brief',/^(?:公司|事务所|企业|机构)(?:简介|概况|介绍)$/u,/简介|概况|介绍/u],
  ['business',/^(?:企业|公司)?营业执照(?:副本|复印件|扫描件)?$/u,/营业执照/u],
  ['practice',/^(?:会计师事务所)?执业(?:证书|许可证)(?:复印件|扫描件)?$/u,/事务所执业|执业许可/u],
  ['qualifications',/^(?:相关)?(?:资质证书(?:及许可经营文件)?|资格证明材料|资质材料|资格证明|资质证明)$/u,/资质|资格证明|经营许可/u],
  ['legal',/^(?:法定代表人|负责人)(?:身份|资格)证明(?:书)?$/u,/(?:法定代表人|负责人)(?:身份|资格)证明/u],
  ['authorization',/^(?:法定代表人)?(?:授权委托书|法定代表人授权书|授权书)$/u,/授权委托书|授权书/u],
  ['experience',/^(?:财务资料[、，,及和])?(?:业绩资料|业绩证明|类似项目业绩|项目业绩|近年业绩)(?:一览表)?$|^(?:财务资料|近年财务状况)$/u,/业绩|财务资料|财务状况/u],
  ['team',/^(?:服务团队|项目团队|人员汇总表|拟参与人员(?:资料)?|人员简历|项目组成员|人员配置一览表|人员资料|人员证书)$/u,/服务团队|项目团队|人员|简历|注册会计师/u],
  ['compliance',/^(?:无行政处罚(?:记录)?(?:的相关资料|证明)?|无违法违规(?:记录)?(?:证明)?|信用记录|信用查询|信用证明)$/u,/行政处罚|违法违规|信用记录|信用查询|信用证明/u]
 ];
 const plainHeading=s=>s.replace(/^[一二三四五六七八九十百\d]+[、.．、)）]\s*/u,'').replace(/[：:]\s*$/u,'').trim();
 function referenceSection(s){
  const title=plainHeading(s);
  if(/^(?:报价(?:明细)?(?:函|单|表|书)?|服务方案|技术方案|审计方案|目录|响应函|响应文件|谈判响应函|保密承诺|服务承诺|.*(?:承诺函|承诺书|声明函|声明书))$/u.test(title))return 'body';
  return sectionKinds.find(([,heading])=>heading.test(title))?.[0];
 }
 function selectedReferenceFiles(bidder){
  const credentialKinds={business_license:'business',practice_certificate:'practice'};
  const files=[];
  for(const file of bidder?.attachments||[]){
   const kind=credentialKinds[file.kind];
   if(kind)files.push({kind,name:file.name,blob:new Blob([file.bytes],{type:file.mime})});
  }
  for(const file of bidder?.materials||[]){
   if(!/\.(?:pdf|docx?|xlsx?|png|jpe?g)$/iu.test(file.name)||/公章|签名图|签字图|章样/u.test(file.name))continue;
   if(/营业执照|事务所执业|执业许可/u.test(file.name))continue;
   const category=sectionKinds.find(([kind,,pattern])=>!['business','practice'].includes(kind)&&pattern.test(file.name));
   if(category)files.push({kind:category[0],name:file.name,blob:file.blob});
  }
  return files;
 }
 function findReferenceValues(paragraphs,table){
  const labels=(pattern)=>paragraphs.map(s=>pattern.exec(s)?.[1]?.trim()).find(Boolean);
  const firm=labels(sourceFirm)||paragraphs.map(s=>firmNamePattern.exec(s)?.[0]).find(Boolean);
  const firmStem=firm?.match(/^(.+?会计师事务所)/u)?.[1];
  const issuer=labels(/^(?:发标单位|采购单位|招标单位|致)\s*[:：]\s*(.+?)\s*[:：！!]?$/u)||
   labels(/^([^：:]{4,100}(?:公司|单位|机构))\s*[:：]\s*$/u);
  const project=labels(/^项目名称\s*[:：]\s*(.+)$/u)||
   labels(/^(.{6,200}?)(?:报价明细(?:表)?|报价单|报价函)\s*$/u);
  const customer=labels(/^(?:被审计单位(?:名称)?|审计对象)\s*[:：]\s*(.+)$/u);
  const tableUnits=table?table.rows.slice(table.index+1).map(row=>wordText(wordChildren(row,'tc')[table.company]||row).trim())
   .filter(s=>s&&!/^(?:合计|总计|小计)$/u.test(s)):[];
  const year=Number((project||'').match(/((?:19|20)\d{2})\s*年度/u)?.[1])||0;
  return {firm,firmStem,issuer,project,customer,tableUnits,year};
 }
 const grossValue=String.raw`\s*(?:[：:]\s*)?(?:人民币\s*)?(?:(?:[¥￥]\s*)?\d[\d,，]*(?:\.\d+)?\s*(?:万元?|元整|圆整|圆)?|[零壹贰叁肆伍陆柒捌玖拾佰仟万亿元圆角分整正]+|[_＿]+)`;
 function replaceReferenceParagraph(p,snapshot,old,units){
  const source=text(p);
  if(!source.trim())return false;
  const contact=snapshot.bidderContact||{};
  const money=decimalPrice(snapshot.totalCents,false);
  const upper=root.QuoteLayouts.upper(snapshot.totalCents);
  const values={'事务所名称':snapshot.firmName,'报价单位':snapshot.firmName,'投标人':snapshot.firmName,'供应商全称':snapshot.firmName,
   '项目名称':snapshot.projectName,'审计年度':String(snapshot.auditYear),'发标单位':snapshot.issuer,'被审计单位':units.join('、'),
   '报价联系人':contact.name||'待补','联系电话':contact.phone||'待补','电子邮箱':contact.email||'待补',
   '含税报价':'¥ '+money+' 元','报价金额':'¥ '+money+' 元','金额大写':upper,'报价日期':snapshot.quoteDate};
  const replacements=[];
  function add(start,length,value){
   if(length>0&&!replacements.some(item=>start<item.end&&start+length>item.start))replacements.push({start,end:start+length,value});
  }
  function change(match,value,group=0){
   const segment=match[group],at=group===0?0:match[0].lastIndexOf(segment);
   add(match.index+at,segment.length,value);
  }
  for(const m of source.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/gu))if(Object.hasOwn(values,m[1]))change(m,values[m[1]]);
  const bidderField=/^(?:\s*(?:供应商|投标人|报价单位|事务所))?\s*(联系方式|报价联系人|联系人|联系电话|联系手机|手机|电话|Tel\.?|投标人地址|通信地址|联系地址|地址|邮政编码|邮编|传真|电子邮件|电子邮箱|邮箱|E[- ]?mail|社会信用代码|统一社会信用代码|开户行|开户银行|银行账号|授权代表(?:[（(]签字[）)])?|法定代表人或其委托代理人|法定代表人|法人代表)\s*[:：]\s*(.*)$/iu.exec(source);
  if(bidderField){
   const [,label,value]=bidderField;
   const key=/电话|手机|tel/iu.test(label)?'phone':/邮[箱件]|mail/iu.test(label)?'email':/联系人/u.test(label)?'name':'';
   if(value)change(bidderField,key?contact[key]||'待补':/授权代表|法定代表人|法人代表/u.test(label)?'待确认并签署':'待补',2);
  }
  const identityFields=[
   [/^\s*(?:项目名称)\s*[:：]\s*(.+)$/u,snapshot.projectName],
   [/^\s*(?:被审计单位(?:名称)?|审计对象)\s*[:：]\s*(.+)$/u,units.join('、')],
   [/^\s*(?:发标单位|采购单位|招标单位|致)\s*[:：]\s*(.+)$/u,snapshot.issuer],
   [/^\s*(?:报价日期|日期|时间)\s*[:：]\s*(.+)$/u,snapshot.quoteDate],
   [/^\s*(?:税率|增值税税率)\s*[:：]\s*(.+)$/u,snapshot.taxRateText]
  ];
  for(const [pattern,value] of identityFields){
   const match=pattern.exec(source);if(match)change(match,value,1);
  }
  const standaloneDate=/^\s*(?:(?:19|20)\d{2}\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}\s*日?)\s*$/u.exec(source);
  if(standaloneDate)change(standaloneDate,snapshot.quoteDate);
  const price=/(?:总体报价为|投标报价为|报价总额|含税报价(?:总额)?|总报价(?:为)?|报价金额|报价合计|小写)\s*(?:[（(]含税[）)])?/u.exec(source);
  if(price){
   const tailAt=price.index+price[0].length,tail=source.slice(tailAt),m=new RegExp('^'+grossValue,'u').exec(tail);
   if(m){
    const numeric=/[¥￥\d]/u.test(m[0]);
    add(tailAt,m[0].length,'：'+(numeric?'¥ '+money+' 元':upper));
    const second=/[¥￥]\s*\d[\d,，]*(?:\.\d+)?\s*元?/gu;
    for(const amount of tail.matchAll(second))if(amount.index>=m[0].length)add(tailAt+amount.index,amount[0].length,'¥ '+money+' 元');
   }
  }
  for(const m of source.matchAll(/大写\s*[:：]?\s*([人民币零壹贰叁肆伍陆柒捌玖拾佰仟万亿元圆角分整正_＿]+)/gu))change(m,upper,1);
  if(snapshot.taxRateText)for(const m of source.matchAll(/(?:税率|增值税)\s*[:：]?\s*(\d+(?:\.\d+)?[%％])/gu))change(m,snapshot.taxRateText,1);
  const currentShort=snapshot.firmName.split('会计师事务所')[0];
  const oldShort=old.firmStem?.split('会计师事务所')[0];
  const aliases=[
   [old.project,snapshot.projectName],[old.firm,snapshot.firmName],[old.firmStem,snapshot.firmName],
   [old.customer,units.join('、')],[old.issuer,snapshot.issuer],
   ...old.tableUnits.map((name,i)=>[name,units[i]||'本次被审计单位']),
   ...(oldShort&&currentShort&&oldShort.length>=2?[[oldShort,currentShort]]:[]),
   ...(old.year&&old.year!==snapshot.auditYear?[[old.year+'年度',snapshot.auditYear+'年度']]:[])
  ].filter(([before,after])=>before&&after&&before!==after).sort((a,b)=>b[0].length-a[0].length);
  for(const [before,after] of aliases)for(let at=source.indexOf(before);at>=0;at=source.indexOf(before,at+before.length))add(at,before.length,after);
  for(const item of replacements.sort((a,b)=>b.start-a.start))replace(p,item);
  return replacements.length>0;
 }
 async function fillQuotation(file,snapshot,{bidder}={}){
  if(!file||!/\.docx$/iu.test(file.name))throw Error('整套替换需要可编辑的 Word（.docx）；PDF 可查看或下载原件。');
  const parts=await root.ProjectWorkspaceStore.parts(file);
  if(!parts['[Content_Types].xml']||!parts['word/document.xml']||Object.keys(parts).some(name=>/vbaProject|activeX|\/embeddings\//iu.test(name)))throw Error('请选择可编辑且不含嵌入对象的 DOCX 报价参考文件。');
  const units=snapshot.quoteRows||[{name:snapshot.customerName,totalCents:snapshot.totalCents}];
  const serializer=new XMLSerializer(),xml=raw=>root.ProjectWorkspaceStore.xml(raw);
  const doc=xml(parts['word/document.xml']),body=doc.getElementsByTagNameNS(W,'body')[0];
  if(!body)throw Error('参考文件没有可读取的报价正文。');
  const knownTable=priceTable(body);
  const paragraphs=[...body.getElementsByTagNameNS(W,'p')].map(text);
  if(!knownTable&&!paragraphs.some(s=>quoteMoney.test(s)||/\{\{\s*(?:含税报价|报价金额)\s*\}\}/u.test(s)))
   throw Error('未找到可复用的报价金额或明细表，请在参考文件中标明「含税报价」。');
  const old=findReferenceValues(paragraphs,knownTable);
  if(knownTable)knownTable.table.replaceWith(filledPriceTable(knownTable,units,snapshot.totalCents));
  const candidates=selectedReferenceFiles(bidder),files=Object.create(null),included=new Map(),missing=new Set();
  let replaceSection=null;
  for(const node of [...body.children]){
   if(node.namespaceURI!==W||node.localName==='sectPr')continue;
   const title=node.localName==='p'?text(node).trim():'';
   const kind=title&&referenceSection(title);
   if(kind){
    replaceSection=kind==='body'?null:kind;
    if(!replaceSection)continue;
    const matches=candidates.filter(item=>item.kind===kind||(kind==='qualifications'&&item.kind==='practice'));
    if(matches.length){
     const names=[];
     for(const item of matches){
      if(!included.has(item)){
       const safe=item.name.replace(/[<>:"/\\|?*\u0000-\u001f]/gu,'_').replace(/[. ]+$/u,'')||'附件';
       const path='报价单位资料/'+String(included.size+1).padStart(2,'0')+'-'+safe;
       included.set(item,path);
       files[path]=new Uint8Array(await item.blob.arrayBuffer());
      }
      names.push(included.get(item));
     }
     const paragraph=doc.createElementNS(W,'w:p');
     node.after(setParagraph(paragraph,'本章节对应所选报价单位的原件：'+names.join('、')+'。'));
    }else{
     missing.add(plainHeading(title));
     const paragraph=doc.createElementNS(W,'w:p');
     node.after(setParagraph(paragraph,'待补：所选报价单位档案中未找到本章节对应原件。'));
    }
   }else if(replaceSection){
    // Preserve the original section break, including its layout and page setup.
    const section=node.localName==='p'?wordChildren(wordChildren(node,'pPr')[0]||node,'sectPr')[0]:null;
    if(section){
     const layout=doc.createElementNS(W,'w:p'),properties=doc.createElementNS(W,'w:pPr');
     properties.append(section.cloneNode(true));layout.append(properties);node.replaceWith(layout);
    }else node.remove();
   }
  }
  let removedGraphics=0;
  for(const part of Object.keys(parts)){
   if(/^word\/(?:document|header\d+|footer\d+)\.xml$/u.test(part)){
    const content=part==='word/document.xml'?doc:xml(parts[part]);
    for(const tag of ['drawing','pict','object','altChunk','del','moveFrom','commentRangeStart','commentRangeEnd','commentReference','footnoteReference','endnoteReference']){
     for(const node of [...content.getElementsByTagNameNS(W,tag)]){
      if(['drawing','pict','object'].includes(tag))removedGraphics++;
      node.remove();
     }
    }
    for(const link of [...content.getElementsByTagNameNS(W,'hyperlink')])if(link.hasAttributeNS(WREL,'id'))link.replaceWith(...link.childNodes);
    for(const node of [...content.getElementsByTagNameNS(W,'p')])replaceReferenceParagraph(node,snapshot,old,units.map(item=>item.name));
    if(included.size||missing.size||removedGraphics){
     if(part==='word/document.xml'){
      const notice=setParagraph(doc.createElementNS(W,'w:p'),'报价参考资料草稿。报价、承诺和签章由所选报价单位复核确认；带「待补」的章节需补充对应原件。');
      const section=wordChildren(body,'sectPr').at(-1);
      body.insertBefore(notice,section||null);
     }
    }
    parts[part]=enc.encode(serializer.serializeToString(content));
   }else if(/\.rels$/u.test(part)){
    const relationships=xml(parts[part]);
    for(const relation of [...relationships.getElementsByTagNameNS('*','Relationship')]){
     const type=relation.getAttribute('Type')||'';
     if(relation.getAttribute('TargetMode')==='External'||/\/(?:image|thumbnail|comments(?:Extended|Ids)?|people|footnotes|endnotes|customXml|core-properties|extended-properties|custom-properties|aFChunk)$/iu.test(type))relation.remove();
    }
    parts[part]=enc.encode(serializer.serializeToString(relationships));
   }else if(/^(?:word\/(?:media\/|comments[^/]*\.xml|people\.xml|footnotes\.xml|endnotes\.xml)|docProps\/|customXml\/)/iu.test(part))delete parts[part];
  }
  const types=xml(parts['[Content_Types].xml']);
  for(const override of [...types.getElementsByTagNameNS('*','Override')])if(!parts[(override.getAttribute('PartName')||'').slice(1)])override.remove();
  parts['[Content_Types].xml']=enc.encode(serializer.serializeToString(types));
  const wordName='本次报价-以往报价参考版.docx',word=root.QuoteLayouts.packOfficeParts(parts,100*1024*1024);
  const result={missing:[...missing],materials:included.size,removedGraphics};
  if(!included.size)return {...result,name:wordName,mime:root.QuoteLayouts.docxMime,bytes:word};
  return {...result,name:'本次报价-整套参考资料.zip',mime:'application/zip',
   bytes:root.QuoteLayouts.packQuoteReferenceBundle({[wordName]:word,...files})};
 }
 root.ContractTemplate=Object.freeze({inspect,fill,fillQuotation});
})(globalThis);
