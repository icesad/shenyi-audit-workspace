/* Project-bound report handoff only: no OCR, opinion, source rewrite or formula recalculation. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ReportWorkspace=api;})(globalThis,function(root){'use strict';
 const MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document',TRIAL='00000000-0000-4000-8000-000000000033';
 const REPORT_TYPES=['标准无保留意见','否定意见','保留意见','无法表示意见'];
 const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
 const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const DRAFT_NOTICE='审计报告编辑草稿（未签发）';
 function templateOpinion(name,content){
  const compact=String(content||'').normalize('NFKC').replace(/\s+/gu,'');
  const label=String(name||'').normalize('NFKC');
  const types=text=>REPORT_TYPES.filter(type=>type==='标准无保留意见'?/无保留意见/u.test(text):
    type==='保留意见'?/(?<!无)保留意见/u.test(text):text.includes(type));
  const named=types(label);
  const textTypes=types([...compact.matchAll(/形成(无保留意见|保留意见|否定意见|无法表示意见)的基础/gu)].map(m=>m[1]).join(' '));
  // A statement about not expressing a separate opinion on key audit matters is not a disclaimer.
  if(/我们(?:(?:不|无法|不能)对[^。；，,]{0,80}财务报表发表(?:任何|审计)?意见|(?:无法|不能)发表审计意见)/u.test(compact))textTypes.push('无法表示意见');
  if(/(?:我们认为[^。]{0,180})?(?:没有|未能)在所有重大方面(?:按照|公允反映)/u.test(compact))textTypes.push('否定意见');
  if(/我们认为[，,:：]?除[^。]{0,180}(?:影响|可能产生的影响)外/u.test(compact))textTypes.push('保留意见');
  if(!textTypes.length&&/我们认为[^。]{0,240}在所有重大方面[^。]{0,130}公允反映/u.test(compact))textTypes.push('标准无保留意见');
  const detected=[...new Set([...named,...textTypes])];
  return detected.length===1?detected[0]:'';
 }
 const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(x);
 const text=(x,n,required=false)=>{if(typeof x!=='string'||!x.isWellFormed()||x.length>n||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(x)||required&&!x.trim())throw Error('请完整填写核对内容，不要输入控制字符或过长文字。');return x.trim();};
 function amount(raw){if(typeof raw!=='string'||raw.length>25||! /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(raw))throw Error('金额须明确填写数字（最多两位小数）；空白不当作0，不接受公式或自动换算。');const negative=raw.startsWith('-'),[whole,fraction='']=raw.replace(/^-/u,'').split('.'),cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));return (negative&&cents?'-':'')+String(cents/100n)+'.'+String(cents%100n).padStart(2,'0');}
 function sourceChoices(record,projectId){
  if(!uuid(projectId)||!record||record.project?.quoteId!==projectId)throw Error('资料项目归属不一致，未读取其他项目。');
  if(record.schema!==2)return [];
  const nodes=record.nodes||[],parents=new Set(nodes.map(n=>n.parentId).filter(Boolean)),map=new Map(nodes.map(n=>[n.id,n]));
  return nodes.filter(n=>n.kind!=='group'&&!parents.has(n.id)).flatMap(n=>{let label=n.title||'',parent=n.parentId,seen=new Set();while(parent&&map.has(parent)&&!seen.has(parent)){seen.add(parent);const p=map.get(parent);label=p.title+' / '+label;parent=p.parentId;}if(!/审计报告/u.test(label+' '+(n.description||'')))return [];
   return (record.attachments?.[n.id]||[]).filter(f=>f.nodeId===n.id&&f.generationId===record.generationId&&uuid(f.id)&&/^[a-f0-9]{64}$/u.test(f.sha256||'')).map(f=>({projectId,nodeId:n.id,fileId:f.id,generationId:record.generationId,recordRevision:record.revision,title:label,file:{...f},state:{...(record.states?.[n.id]||{status:'pending'})}}));});
 }
 function verifySource(record,projectId,source){if(!source||source.projectId!==projectId)throw Error('请明确选择本项目上年审计报告附件。');const current=sourceChoices(record,projectId).find(s=>s.nodeId===source.nodeId&&s.fileId===source.fileId);if(!current||current.generationId!==source.generationId||current.recordRevision!==source.recordRevision||current.file.sha256!==source.file.sha256)throw Error('源附件或资料清单版本已改变，请重新载入并核对；未套用旧数据。');return current;}
 function validateDraft(draft,record,{allowEmpty=false}={}){
  if(!uuid(draft?.projectId))throw Error('请先选择项目或独立试用。');const source=verifySource(record,draft.projectId,draft.source);
  if(source.state.status!=='confirmed')throw Error('上年报告资料项尚未核对通过。上传或预览不等于核对，请先在该项目资料清单完成核对。');
  if(!draft.sourceConfirmed||!draft.dimensionsConfirmed||!draft.reviewConfirmed)throw Error('须明确核对源报告归属、年度、币种、单位和全部衔接行。');
  const year=Number(draft.year);if(!/^\d{4}$/u.test(String(draft.year))||year<1901||year>9999)throw Error('请明确本年审计年度，不自动猜测或改写原表年度。');
  if(!['CNY','HKD','USD','EUR','OTHER'].includes(draft.currency)||!['unit','thousand','ten-thousand'].includes(draft.unit))throw Error('请明确币种与金额单位；本页不自动折算。');
  const reviewer=text(draft.reviewer,80,true);if(!Array.isArray(draft.rows)||draft.rows.length<(allowEmpty?0:1)||draft.rows.length>20)throw Error('请填写1至20项需要核对的衔接行。');
  const rows=draft.rows.map(r=>{if(!r.confirmed)throw Error('每一行均须独立核对确认；修改数字或依据后须重新确认。');return {item:text(r.item,120,true),priorClosing:amount(r.priorClosing),currentOpening:amount(r.priorClosing),priorEvidence:text(r.priorEvidence,240,true),currentClosing:amount(r.currentClosing),currentEvidence:text(r.currentEvidence,240,true)};});
  return {projectId:draft.projectId,projectName:text(draft.projectName,300,true),year,currency:draft.currency,unit:draft.unit,reviewer,source,rows,trial:draft.projectId===TRIAL};
 }
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 function wordParts(value){const p=s=>'<w:p><w:r><w:t xml:space="preserve">'+escape(s)+'</w:t></w:r></w:p>',cell=s=>'<w:tc>'+p(s)+'</w:tc>',row=xs=>'<w:tr>'+xs.map(cell).join('')+'</w:tr>',s=value.source;
  const body=[p('审计报告数据衔接核对表 — 无章草稿'),p('仅为手工数据衔接核对表，不是正式审计报告；未生成审计意见、报告日期、签字或印章。'),p('项目：'+value.projectName+'；稳定项目ID：'+value.projectId+(value.trial?'（独立试用，非正式立项）':'')),p('本年审计年度：'+value.year+'；币种：'+value.currency+'；单位：'+({unit:'货币单位',thousand:'千货币单位','ten-thousand':'万货币单位'}[value.unit])),p('来源：本项目资料清单 / '+s.title+' / '+s.file.name),p('源附件SHA256：'+s.file.sha256),p('源附件ID：'+s.fileId+'；资料树版本：'+s.generationId+'；清单修订：'+s.recordRevision+'；资料项状态：核对通过'),p('原则：上年期末＝本年期初；本年期末仅填写本年已确认审计结果。未自动抽取、重算、换算或调整原报表。'),'<w:tbl>'+row(['项目/科目','上年期末','本年期初','上年原件定位','本年审定期末','本年审计依据'])+value.rows.map(r=>row([r.item,r.priorClosing,r.currentOpening,r.priorEvidence,r.currentClosing,r.currentEvidence])).join('')+'</w:tbl>',p('手工核对人（自填，非平台身份签名）：'+value.reviewer),p('尚需：真实报告结构与数表映射、期初差异调节、报告复核与批准、正式报告模板及签发。本表不替代上述程序；源文件和原公式未改变。')].join('');
  const enc=s=>new TextEncoder().encode(s);return {'[Content_Types].xml':enc('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),'_rels/.rels':enc('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),'word/document.xml':enc('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body+'<w:sectPr><w:pgSz w:w="16838" w:h="11906"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>')};
 }
 const binding=s=>({nodeId:s.nodeId,fileId:s.fileId,generationId:s.generationId,recordRevision:s.recordRevision,sha256:s.file.sha256,name:s.file.name});
 function validateReportDraft(value,record,projectId){
  if(!value||![1,2].includes(value.schemaVersion)||value.projectId!==projectId||!uuid(projectId))throw Error('报告草稿项目归属或版本无效。');
  if(value.schemaVersion===2)checkTemplateBinding(value.template);
  const selected=sourceChoices(record,projectId).find(s=>s.nodeId===value.source?.nodeId&&s.fileId===value.source?.fileId);if(!selected||Object.entries(binding(selected)).some(([k,v])=>value.source[k]!==v)||selected.state.status!=='confirmed')throw Error('草稿来源附件、核对状态或清单版本已变化，旧稿仅供查阅，请重新核对生成。');
  if(typeof value.content!=='string'||!value.content.trim()||value.content.length>150000||!value.content.isWellFormed()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value.content))throw Error('报告草稿内容为空、过长或含不支持字符。');
  const h=value.handover;if(!h)throw Error('缺少已核对的报告衔接信息。');const check=validateDraft({projectId,projectName:'草稿来源校验',source:selected,...h,sourceConfirmed:true,dimensionsConfirmed:true,reviewConfirmed:true,rows:h.rows.map(r=>({...r,confirmed:true}))},record,{allowEmpty:true});if(check.rows.some((r,i)=>r.currentOpening!==h.rows[i].currentOpening))throw Error('报告期初衔接与已核对的上年期末不一致。');
  if(![value.generatedAt,value.updatedAt].every(v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v)||value.updatedAt<value.generatedAt)throw Error('报告草稿时间格式无效。');return value;
 }
 function checkTemplateBinding(template){
  if(!template||Object.keys(template).sort().join(',')!=='name,opinion,sha256'||!/^[a-f0-9]{64}$/u.test(template.sha256||'')||
     typeof template.name!=='string'||template.name.length>200||!/\.docx?$/iu.test(template.name)||!REPORT_TYPES.includes(template.opinion))
   throw Error('报告草稿模板信息无效，请重新生成。');
 }
 function reportTemplateText(projectName,type){
  return ['审计报告（待核对）',projectName?'项目：'+projectName:'项目：[待填写]','报告类型：'+(type||'[待选择]'),
   '致：[报告收件人]',
   '一、审计意见','[填写经复核的审计意见正文]',
   '二、形成审计意见的基础','[填写审计依据、相关事项及其影响]',
   '三、其他报告事项','[按本项目适用情况填写]',
   '四、管理层和治理层对财务报表的责任','[填写项目适用的责任说明]',
   '五、注册会计师对财务报表审计的责任','[填写项目适用的责任说明]',
   '事务所：[待填写]','注册会计师：[待签署]','报告日期：[待填写]',
   '附：财务报表及附注','[附本项目经核对的财务报表及附注]'].join('\n\n');
 }
 function reportText(value,priorText,reportType=''){
  const headings=priorText.split(/\r?\n/).map(s=>s.trim()).filter(s=>s.length<=180&&/^(?:[一二三四五六七八九十]+[、.．]|第.{1,8}[章部分节]|审计报告|资产负债表|利润表|现金流量表|所有者权益变动表|财务报表附注)/u.test(s)).slice(0,30);
  return ['审计报告编辑草稿（未签发）','本稿仅供人工编制与复核，不能直接作为正式审计报告。未提供经核定的真实完整报告样本，当前不保证还原其版式或全部章节。','项目：'+value.projectName,...(REPORT_TYPES.includes(reportType)?['报告类型：'+reportType]:[]),'审计年度：'+value.year+'；币种：'+value.currency+'；金额单位：'+value.unit,'来源：'+value.source.file.name+'；SHA256：'+value.source.file.sha256,'一、上年报告结构参考（只作参考，不将上年意见当作本年意见）',...(headings.length?headings:['[源报告未识别到可靠章节标题，请对照原件补充结构]']),'二、已人工核对的数据衔接',...(value.rows.length?value.rows.map(r=>r.item+'：上年期末 '+r.priorClosing+'；本年期初 '+r.currentOpening+'；本年审定期末 '+r.currentClosing+'。上年依据：'+r.priorEvidence+'；本年依据：'+r.currentEvidence):['[本年审定数与报表映射待人工核对填写；空白不当作0]']),'三、本年审计报告正文','[审计范围、财务报表名称及适用编制基础待核对填写]','[审计意见类型及意见正文待注册会计师判断、复核和批准，不自动生成]','[形成审计意见的基础及其他适用章节待人工编制]','[完整财务报表、附注及期初差异调节待逐项核对，未自动改写原报告数字或年度]','事务所：[待核对填写]','注册会计师签字：[待签发]','报告日期：[待签发]','本稿无签字、无印章；下载和保存均不代表签发。'].join('\n\n');
 }
 function plainReportParts(projectName,draft,source){
  const parts=wordParts({projectId:draft.projectId,projectName,...draft.handover,source,trial:draft.projectId===TRIAL});
  const paragraphs=draft.content.split(/\r?\n/).map(line=>'<w:p><w:r><w:t xml:space="preserve">'+escape(line)+'</w:t></w:r></w:p>').join('');
  parts['word/document.xml']=new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+paragraphs+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440"/></w:sectPr></w:body></w:document>');
  return parts;
 }
 async function readTemplate(sha256){
  const library=await root.AuditTemplates.open();
  try{return await library.read(sha256);}finally{library.close();}
 }
 const wordNodes=(node,name)=>[...node.getElementsByTagNameNS(W,name)];
 const wordElement=(doc,tag)=>doc.createElementNS(W,'w:'+tag);
 const xmlBytes=doc=>new TextEncoder().encode(new XMLSerializer().serializeToString(doc));
 const runs=p=>wordNodes(p,'t').filter(t=>{
  let parent=t.parentElement;
  while(parent&&(parent.namespaceURI!==W||parent.localName!=='p'))parent=parent.parentElement;
  return parent===p;
 });
 function paragraphText(p){return runs(p).map(t=>t.textContent).join('').replace(/[\r\n]+/g,' ');}
 function newParagraph(doc,line){
  const p=wordElement(doc,'p'),r=wordElement(doc,'r'),t=wordElement(doc,'t');
  t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');
  t.textContent=line;r.append(t);p.append(r);return p;
 }
 function updateParagraph(p,line){
  const ts=runs(p);
  const original=ts.map(t=>t.textContent).join('');
  if(paragraphText(p)===line)return;
  if(!ts.length){p.append(...newParagraph(p.ownerDocument,line).children);return;}
  let from=0,end=original.length,last=line.length;
  while(from<end&&from<last&&original[from]===line[from])from++;
  while(end>from&&last>from&&original[end-1]===line[last-1]){end--;last--;}
  let offset=0,inserted=false;
  for(const t of ts){
   const value=t.textContent,next=offset+value.length;
   if(next>=from&&offset<=end){
    const left=Math.max(0,from-offset),right=Math.max(0,end-offset);
    t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');
    t.textContent=value.slice(0,left)+(inserted?'':line.slice(from,last))+value.slice(right);
    inserted=true;
   }
   offset=next;
  }
 }
 function keepPageFields(doc){
  const isPageField=value=>/^(?:PAGE|NUMPAGES|SECTIONPAGES)(?:\s|$)/iu.test(value.trim());
  const stack=[];
  for(const node of [...doc.getElementsByTagNameNS(W,'*')]){
   if(node.localName==='fldSimple'&&!isPageField(node.getAttributeNS(W,'instr')||''))node.replaceWith(...node.childNodes);
   if(node.localName==='instrText'){
    const current=stack.at(-1);
    if(current){current.code+=node.textContent;current.nodes.push(node);}else node.remove();
   }
   if(node.localName!=='fldChar')continue;
   const type=node.getAttributeNS(W,'fldCharType');
   if(type==='begin'){stack.push({code:'',nodes:[node]});continue;}
   const current=stack.at(-1);
   if(!current){node.remove();continue;}
   current.nodes.push(node);
   if(type==='end'&&!isPageField(stack.pop().code))current.nodes.forEach(n=>n.remove());
  }
  for(const field of stack)field.nodes.forEach(n=>n.remove());
 }
 function editableWordXML(bytes){
  const doc=root.ProjectWorkspaceStore.xml(bytes);
  for(const tag of ['altChunk','object','control','dataBinding','attachedTemplate','mailMerge','subDoc','del','moveFrom','updateFields',
                    'commentReference','commentRangeStart','commentRangeEnd','documentProtection','writeProtection'])
   for(const node of wordNodes(doc,tag))node.remove();
  for(const node of wordNodes(doc,'hyperlink'))if(node.hasAttributeNS(REL,'id'))node.replaceWith(...node.childNodes);
  for(const node of [...doc.getElementsByTagName('*')])node.removeAttributeNS(REL,'link');
  keepPageFields(doc);
  return doc;
 }
 function retainWordParts(parts){
  const keep=/^(?:\[Content_Types\]\.xml|_rels\/\.rels|word\/(?:(?:document|styles(?:WithEffects)?|settings|fontTable|numbering|footnotes|endnotes|header\d+|footer\d+)\.xml|(?:_rels\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml\.rels)|theme\/theme\d+\.xml|media\/[^/]+\.(?:png|jpe?g|gif|bmp|tiff?|emf|wmf)))$/iu;
  for(const name of Object.keys(parts))if(!keep.test(name))delete parts[name];
  for(const [name,bytes] of Object.entries(parts)){
   if(!name.endsWith('.rels'))continue;
   const doc=root.ProjectWorkspaceStore.xml(bytes);
   const base=name==='_rels/.rels'?'https://document.invalid/':'https://document.invalid/word/';
   for(const relation of [...doc.getElementsByTagNameNS('*','Relationship')]){
    const type=(relation.getAttribute('Type')||'').split('/').at(-1);
    if(!['officeDocument','styles','stylesWithEffects','settings','fontTable','numbering','footnotes','endnotes','header','footer','theme','image'].includes(type)||
       relation.getAttribute('TargetMode')?.toLowerCase()==='external'){relation.remove();continue;}
    try{
     const target=new URL(relation.getAttribute('Target')||'',base);
     if(target.origin!=='https://document.invalid'||!Object.hasOwn(parts,decodeURIComponent(target.pathname.slice(1))))relation.remove();
    }catch{relation.remove();}
   }
   parts[name]=xmlBytes(doc);
  }
  const types=root.ProjectWorkspaceStore.xml(parts['[Content_Types].xml']);
  for(const part of [...types.getElementsByTagNameNS('*','Override')])
   if(!Object.hasOwn(parts,(part.getAttribute('PartName')||'').slice(1)))part.remove();
  parts['[Content_Types].xml']=xmlBytes(types);
  for(const name of Object.keys(parts).filter(n=>/^word\/(?:settings|header\d+|footer\d+|footnotes|endnotes)\.xml$/u.test(n)))
   parts[name]=xmlBytes(editableWordXML(parts[name]));
 }
 async function prepareTemplateDraft(projectName,draft,source){
  const original=await readTemplate(draft.template.sha256);
  if(original.name!==draft.template.name)throw Error('报告模板版本已变化，请重新选择模板生成。');
  const file=new File([original.blob],original.name,{type:original.type});
  const legacy=/\.doc$/iu.test(file.name);
  let parts;
  if(legacy){
   const content=await root.WorkpaperDocs.read(file);
   parts=plainReportParts(projectName,{...draft,content},source);
  }else{
   parts=await root.ProjectWorkspaceStore.parts(file);
   if(!parts['[Content_Types].xml']||!parts['word/document.xml']||
      Object.keys(parts).some(name=>/vbaProject|activeX/i.test(name)))throw Error('请使用无宏的 Word 报告模板。');
   retainWordParts(parts);
  }
  const doc=editableWordXML(parts['word/document.xml']),body=wordNodes(doc,'body')[0];
  if(!body)throw Error('未读到报告模板正文。');
  const templateText=wordNodes(body,'p').map(paragraphText).join('\n');
  if(templateOpinion(original.name,templateText)!==draft.template.opinion)throw Error('无法核对报告模板的意见类型，请重新选择模板。');
  const notice=newParagraph(doc,DRAFT_NOTICE+' · 报告类型：'+draft.template.opinion);
  body.prepend(notice);
  if(draft.handover.rows.length){
   const section=[...body.children].findLast(node=>node.namespaceURI===W&&node.localName==='sectPr')||null;
   body.insertBefore(newParagraph(doc,'项目数据衔接（待核对）'),section);
   for(const row of draft.handover.rows)
    body.insertBefore(newParagraph(doc,row.item+'：上年期末 '+row.priorClosing+'；本年期初 '+row.currentOpening+'；本年审定期末 '+row.currentClosing+
      '。上年依据：'+row.priorEvidence+'；本年依据：'+row.currentEvidence),section);
  }
  const paragraphs=wordNodes(body,'p').filter(p=>paragraphText(p).trim());
  return {parts,doc,body,notice,paragraphs,content:paragraphs.map(paragraphText).join('\n')};
 }
 function paragraphMatches(before,after){
  const prefix=[],suffix=[];
  let start=0,end=before.length,last=after.length;
  while(start<end&&start<last&&before[start]===after[start]){prefix.push([start,start]);start++;}
  while(end>start&&last>start&&before[end-1]===after[last-1])suffix.push([--end,--last]);
  const n=end-start,m=last-start,width=m+1;
  if(n*m>4000000)return prefix.concat(suffix.reverse());
  const lengths=new Uint16Array((n+1)*width);
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--){
   const k=i*width+j;
   lengths[k]=before[start+i]===after[start+j]?1+lengths[k+width+1]:Math.max(lengths[k+width],lengths[k+1]);
  }
  for(let i=0,j=0;i<n&&j<m;){
   if(before[start+i]===after[start+j]){prefix.push([start+i,start+j]);i++;j++;}
   else if(lengths[(i+1)*width+j]>=lengths[i*width+j+1])i++;
   else j++;
  }
  return prefix.concat(suffix.reverse());
 }
 function applyTemplateEdits(model,content){
  const {doc,body,notice,paragraphs}=model,before=paragraphs.map(paragraphText),after=content.split(/\r?\n/);
  const anchors=paragraphMatches(before,after);
  const section=[...body.children].findLast(node=>node.namespaceURI===W&&node.localName==='sectPr')||null;
  let from=0,to=0;
  for(const [nextFrom,nextTo] of anchors.concat([[before.length,after.length]])){
   while(from<nextFrom&&to<nextTo)updateParagraph(paragraphs[from++],after[to++]);
   while(from<nextFrom)updateParagraph(paragraphs[from++],'');
   const anchor=paragraphs[nextFrom]||section;
   while(to<nextTo)(anchor?.parentElement||body).insertBefore(newParagraph(doc,after[to++]),anchor);
   from=nextFrom+1;to=nextTo+1;
  }
  if(!paragraphText(notice).includes(DRAFT_NOTICE))body.prepend(newParagraph(doc,DRAFT_NOTICE));
 }
 async function buildReportDocument(projectName,draft,source){
  let parts;
  if(draft.schemaVersion===2){
   const model=await prepareTemplateDraft(projectName,draft,source);
   applyTemplateEdits(model,draft.content);
   parts=model.parts;parts['word/document.xml']=xmlBytes(model.doc);
  }else parts=plainReportParts(projectName,draft,source);
  const entries=Object.entries(parts).map(([path,bytes])=>({path,bytes}));
  const bytes=root.AuditArchive?.zipStore?root.AuditArchive.zipStore(entries):root.QuoteLayouts.packOfficeParts(parts);
  return new Blob([bytes],{type:MIME});
 }
 async function downloadSavedDraft(projectId,assertContext=()=>{}){
  if(!uuid(projectId)||projectId===TRIAL)throw Error('请选择已立项的审计项目。');
  const store=root.ProjectWorkspaceStore;
  const project=(await root.ProjectInitiation.listSaved()).find(item=>item.quoteId===projectId);
  if(!project)throw Error('未找到该报告项目。');
  const {rev,reportDraft:draft}=await store.get(projectId);
  if(!draft)throw Error('本项目尚未保存报告初版，请先打开报告编制。');
  const db=await root.AuditChecklist.open();
  try{
   const record=await db.get(projectId);
   validateReportDraft(draft,record,projectId);
   const source=sourceChoices(record,projectId).find(item=>item.nodeId===draft.source.nodeId&&item.fileId===draft.source.fileId);
   const file=await db.downloadAttachment(projectId,source.nodeId,source.fileId);
   if(file.metadata.generationId!==source.generationId||file.metadata.sha256!==source.file.sha256||await store.hash(file.blob)!==source.file.sha256)throw Error('报告来源文件已变化，请重新核对生成。');
   const report=await buildReportDocument(project.form.projectName,draft,source);
   if((await store.get(projectId)).rev!==rev)throw Error('项目资料已更新，请重新下载报告初版。');
   validateReportDraft(draft,await db.get(projectId),projectId);
   assertContext();
   store.download(report,'报告初版（待核对）.docx');
  }finally{db.close();}
 }
 async function readPriorText(file){const name=file.metadata.name,blob=file.blob;if(!root.ProjectWorkspaceStore?.hash||await root.ProjectWorkspaceStore.hash(blob)!==file.metadata.sha256)throw Error('上年报告实际字节与SHA256不一致，未生成草稿。');const original=new File([blob],name);let out='';if(/\.docx$/iu.test(name)){const src=await root.TenderImport.openBidTemplate(original),x=root.ProjectWorkspaceStore.xml(await src.read('word/document.xml')),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';out=Array.from(x.getElementsByTagNameNS(W,'p'),p=>Array.from(p.getElementsByTagNameNS(W,'t'),n=>n.textContent).join('')).join('\n');}else if(/\.pdf$/iu.test(name)){if(!root.BidderPdfText)throw Error('PDF文字读取组件未加载。');out=(await root.BidderPdfText.read(new Uint8Array(await blob.arrayBuffer()))).lines.join('\n');}else if(/\.doc$/iu.test(name))out=await root.WorkpaperDocs.read(original);else throw Error('生成草稿请使用可读取文字的PDF或Word上年报告。');if(!out.trim()||out.length>150000)throw Error('未读取到完整可用文字；扫描件请先提供可读取文字的PDF或Word，不猜测报告内容。');return out;}
 function mount(host,adapter={}){
  if(!host?.ownerDocument)throw Error('报告工作区尚未就绪。');const d=host.ownerDocument,el=(t,s,cls)=>{const n=d.createElement(t);if(s!==undefined)n.textContent=s;if(cls)n.className=cls;return n;},button=s=>{const n=el('button',s,'btn');n.type='button';return n;};
  const box=el('div',undefined,'rw-root'),toolbar=el('div',undefined,'panel af-project rw-toolbar');
  const companySelect=el('select'),companyLabel=el('label','被审计单位');
  const select=el('select'),projectLabel=el('label','审计项目'),refresh=button('刷新项目'),status=el('p',undefined,'rw-status');
  companySelect.id='report-company';companySelect.setAttribute('aria-label',companyLabel.textContent);companyLabel.htmlFor=companySelect.id;companyLabel.append(companySelect);
  select.id='report-project';select.setAttribute('aria-label',projectLabel.textContent);projectLabel.htmlFor=select.id;projectLabel.append(select);
  status.id='report-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  toolbar.append(companyLabel,projectLabel,refresh);box.append(toolbar,status);host.replaceChildren(box);
  const cards=el('div',undefined,'rw-cards'),tb=el('section',undefined,'rw-card'),audit=el('section',undefined,'rw-card');tb.id='report-trial-balance';audit.id='report-audit-report';tb.append(el('h3','9200 · TB试算平衡表'),el('p','进入所选项目工作底稿目录的9200原表。目录实际行246，原包与文件哈希由底稿目录再次核验，多工作表须明确选择；不会把8400或其他项目当9200。'));const tbOpen=button('进入本项目9200原表'),tbStatus=el('p','请选择项目；本页不会重新计算或改写原公式。');tbOpen.id='report-open-9200';tb.append(tbOpen,tbStatus);audit.append(el('h3','资料与数据衔接'));const sourceSelect=el('select'),preview=button('只读预览所选源附件'),sourceStatus=el('p'),form=el('div',undefined,'rw-draft');sourceSelect.id='report-source';sourceSelect.setAttribute('aria-label','本项目审计报告源附件');preview.id='report-preview-source';sourceStatus.id='report-source-provenance';audit.append(sourceSelect,preview,sourceStatus,form);cards.append(tb,audit);box.append(cards);
  const tbInline=el('div'),generatedPanel=el('div',undefined,'rw-generated-panel');tb.append(tbInline);const inline=root.ReportInlineTB?.mount(tbInline)||null;if(inline){tbOpen.hidden=true;tbStatus.hidden=true;tb.querySelector('p').textContent='在本页逐张显示本项目目录9200的原工作表，保持原格式；上一张表、下一张表翻页，公式与链接只读且不重算。';}
  let section='trial-balance';
  function refreshActiveSection(){
   if(section==='trial-balance')void inline?.refreshSaved?.();
   else void refreshReportSources();
  }
  function selectSection(name='trial-balance'){
   section=name==='audit-report'||name==='report-audit-report'?'audit-report':'trial-balance';
   tb.hidden=section!=='trial-balance';audit.hidden=!tb.hidden;
   status.hidden=!!inline&&!tb.hidden;
   refreshActiveSection();
   adapter.onSectionChange?.(section);return true;
  }
  selectSection();
  let projects=[],project=null,record=null,candidates=[],source=null,serial=0,dirty=false,dead=false,previewHandle=null,workspace=null,generated=null,reportDirty=false,reportBusy=false,handoverApi=null,handoverChanged=false;
  let sourcesReady=false,sourceRefresh=null,syncHandover=null;
  let projectCompanies=new Map(),companyFilter='';
  const alive=t=>!dead&&t===serial;const say=(s,bad=false)=>{status.textContent=s;status.classList.toggle('error',bad);};
  const refreshingSources=()=>sourceRefresh?.ticket===serial;
  const reportTypeSelect=el('select'),reportTemplateSelect=el('select'),reportControls=el('div',undefined,'rw-report-controls');
  const reportPreview=el('section',undefined,'rw-report-preview'),reportBody=el('div'),sourcePane=el('section');
  const reportChoices=new Map();let libraryTemplates=[],reportTemplateTicket=0,templateBlock='';
  reportTypeSelect.id='report-type';reportTemplateSelect.id='report-template';
  const prompt=new Option('请选择','');prompt.disabled=true;prompt.hidden=true;
  reportTypeSelect.append(prompt,...REPORT_TYPES.map(type=>new Option(type,type)));
  for(const [name,input] of [['报告类型',reportTypeSelect],['报告模板',reportTemplateSelect]]){
   const label=el('label',name);label.append(input);reportControls.append(label);
  }
  reportPreview.append(el('h3','报告模板正文'),reportBody);
  sourcePane.append(...Array.from(audit.childNodes));
  audit.append(reportControls,reportPreview,generatedPanel,sourcePane);
  function syncReportTemplate(){
   const choice=reportChoices.get(project?.quoteId||'');
   reportTypeSelect.value=choice?.type||'';
   reportTemplateSelect.replaceChildren(new Option('通用审计报告模板','generic'),...libraryTemplates.map(item=>new Option(item.name,item.sha256)));
   reportTemplateSelect.value=libraryTemplates.some(item=>item.sha256===choice?.template)?choice.template:'generic';
   void renderReportTemplate();
   renderGenerated();
  }
  async function loadReportTemplates(){
   if(!root.AuditTemplates?.open){syncReportTemplate();return;}
   try{
    const library=await root.AuditTemplates.open();
    try{libraryTemplates=(await library.list()).records.filter(item=>/\.docx?$/i.test(item.name));}
    finally{library.close();}
   }catch{libraryTemplates=[];}
   if(!dead)syncReportTemplate();
  }
  async function renderReportTemplate(){
   const ticket=++reportTemplateTicket,template=reportTemplateSelect.value;
   const current=()=>!dead&&ticket===reportTemplateTicket;
   function setBlock(message){
    templateBlock=message;
    syncHandover?.();
   }
   if(template==='generic'){
    setBlock('');
    reportBody.replaceChildren(el('pre',reportTemplateText(project?.form.projectName,reportTypeSelect.value),'rw-report-text'));
    return;
   }
   setBlock('正在核对报告模板的意见类型。');
   reportBody.replaceChildren(el('p','正在读取报告模板…'));
   try{
    const original=await readTemplate(template);
    if(!current())return;
    const file=new File([original.blob],original.name,{type:original.type}),rendered=el('div');
    if(!await root.WorkpaperOriginalWord?.render({container:rendered,file,readOnly:true})){
     if(!/\.doc$/i.test(file.name)||!root.WorkpaperDocs?.read)throw Error('该报告模板暂无法预览。');
     rendered.append(el('pre',await root.WorkpaperDocs.read(file),'rw-report-text'));
    }
    if(!current())return;
    const opinion=templateOpinion(original.name,rendered.textContent);
    if(!opinion&&reportTypeSelect.value)throw Error('无法确认模板的意见类型。请选择与报告类型一致的模板，或改用通用模板。');
    if(opinion&&reportTypeSelect.value&&reportTypeSelect.value!==opinion)
      throw Error('模板为「'+opinion+'」，与所选「'+reportTypeSelect.value+'」不一致。请更换模板或报告类型。');
    if(opinion&&!reportTypeSelect.value){
     reportTypeSelect.value=opinion;
     reportChoices.set(project?.quoteId||'',{type:opinion,template});
    }
    setBlock('');reportBody.replaceChildren(rendered);
   }catch(error){if(current()){const message=error.message||'报告模板读取失败。';setBlock(message);const notice=el('p',message,'error');notice.setAttribute('role','alert');reportBody.replaceChildren(notice);}}
  }
  function changeReportTemplate(){
   reportChoices.set(project?.quoteId||'',{type:reportTypeSelect.value,template:reportTemplateSelect.value});
   renderGenerated();
   void renderReportTemplate();
  }
  reportTypeSelect.onchange=reportTemplateSelect.onchange=changeReportTemplate;
  syncReportTemplate();
  function canLeave(){if(reportBusy||inline&&!inline.canLeave())return false;if(reportDirty&&!(typeof root.confirm==='function'&&root.confirm('审计报告草稿有未保存修改，确定离开并丢弃？')))return false;return !dirty||typeof root.confirm==='function'&&root.confirm('数据衔接表仅暂存在当前页面，尚未保存。请先导出核对表；继续离开或切换将丢弃未导出的修改。确定继续？');}
  async function read(key){const api=root.AuditChecklist;if(!api)throw Error('资料清单模块未加载，请刷新后重试。');const db=await (key===TRIAL?api.openTrial():api.open());try{const r=await db.get(key);if(r){api.validate?.(r);if(r.project?.quoteId!==key)throw Error('资料项目归属不一致，未读取。');}return r;}finally{db.close();}}
  function showSourceOptions(){
   const chosen=candidates.indexOf(source);
   sourceSelect.replaceChildren(new Option('请选择本项目上年审计报告附件',''),
    ...candidates.map((item,i)=>new Option(item.title+' / '+item.file.name,String(i))));
   sourceSelect.value=chosen<0?'':String(chosen);
  }
  async function refreshReportSources(){
   const key=project?.quoteId,ticket=serial;
   if(!key||!sourcesReady||reportBusy||refreshingSources())return;
   const request={ticket};
   sourceRefresh=request;
   sourceInfo();syncHandover?.();
   let changed=false;
   try{
    const next=await read(key);
    if(!alive(ticket)||sourceRefresh!==request)return;
    if(next?.revision===record?.revision&&next?.generationId===record?.generationId&&next?.schema===record?.schema)return;
    const previous=source;
    candidates=next?sourceChoices(next,key):[];
    if(previous){
     source=candidates.find(item=>item.nodeId===previous.nodeId&&item.fileId===previous.fileId&&
      item.generationId===previous.generationId&&item.file.sha256===previous.file.sha256)||null;
     if(!source){
      previewHandle?.close();previewHandle=null;form.inert=true;
     }
    }
    record=next;changed=true;showSourceOptions();
    say(previous&&!source?'原上年报告附件已移除或更换，请重新选择。':'已更新本项目上年报告资料。');
   }catch(error){if(alive(ticket))say(error.message||'读取上年报告核对状态失败。',true);}
   finally{
    if(sourceRefresh===request){
     sourceRefresh=null;
     if(!dead){sourceInfo();syncHandover?.();if(changed)renderGenerated();}
    }
   }
  }
  function clearDraft(){previewHandle?.close();previewHandle=null;source=null;dirty=false;sourceSelect.value='';renderDraft();}
  function sourceInfo(){sourceStatus.textContent=!project?'':!record?'暂无资料清单。':!candidates.length?'暂无上年审计报告附件。':!source?'':'项目ID：'+source.projectId+'\n资料项：'+source.title+'\n文件：'+source.file.name+'\nSHA256：'+source.file.sha256+'\n资料清单修订：'+source.recordRevision+'；状态：'+({confirmed:'核对通过',received:'已接收，尚未核对',pending:'待收集',problem:'存在问题',na:'不适用'}[source.state.status]||'待核对');preview.disabled=!source||refreshingSources();tbOpen.disabled=!project;}
  function matchingProjects(company=companyFilter){return projects.filter(item=>!company||projectCompanies.get(item.quoteId)===company);}
  function showProjectOptions(selected,matching=matchingProjects()){
   select.replaceChildren(new Option('请选择已立项项目',''));
   if(!companyFilter)select.append(new Option('独立试用（非正式立项）',TRIAL));
   for(const item of matching)select.append(new Option(item.form.projectName,item.quoteId));
   select.value=[...select.options].some(option=>option.value===selected)?selected:'';
  }
  function setCompanyFilter(company){
   companySelect.value=company;
   companyFilter=companySelect.value;
  }
  async function loadProjects(keep=false){
   const ticket=++serial,previous=keep?project?.quoteId:'';
   const list=await root.ProjectInitiation.listSaved();
   if(!alive(ticket))return;
   const workspaces=await Promise.allSettled(list.map(async item=>root.ProjectWorkspaceStore?.get?.(item.quoteId)));
   if(!alive(ticket))return;
   projects=list;
   projectCompanies=new Map(list.map((item,i)=>[item.quoteId,
    (workspaces[i].value?.projectInitiationDetails?.companyName||item.source?.customerName||'').trim()]));
   const names=[...new Set(projectCompanies.values())].filter(Boolean).sort((a,b)=>a.localeCompare(b,'zh-CN'));
   const company=keep&&companyFilter&&projectCompanies.has(previous)?projectCompanies.get(previous):keep?companyFilter:'';
   companySelect.replaceChildren(new Option('全部被审计单位',''),...names.map(name=>new Option(name,name)));
   setCompanyFilter(names.includes(company)?company:'');
   showProjectOptions(previous);
   await loadProject();
  }
  async function loadProject(){const ticket=++serial,key=select.value;sourcesReady=false;project=null;record=null;workspace=null;generated=null;reportDirty=false;handoverChanged=false;candidates=[];clearDraft();renderGenerated();syncReportTemplate();if(inline)void inline.load('');sourceSelect.replaceChildren(new Option('请选择本项目上年审计报告附件',''));sourceInfo();if(!key){say('');return;}const saved=key===TRIAL?{quoteId:TRIAL,form:{projectName:'独立试用'},source:{}}:projects.find(p=>p.quoteId===key);if(!saved){say('该项目已不在已保存立项列表中，未自动选择其他项目。',true);return;}project=saved;if(inline)void inline.load(key);syncReportTemplate();sourceInfo();try{const next=await read(key);if(!alive(ticket))return;record=next;if(root.ProjectWorkspaceStore?.get){const savedWorkspace=await root.ProjectWorkspaceStore.get(key);if(!alive(ticket))return;workspace=savedWorkspace;generated=workspace.reportDraft||null;if(generated?.template&&!reportChoices.has(key)){reportChoices.set(key,{type:generated.template.opinion,template:generated.template.sha256});syncReportTemplate();}}candidates=next?sourceChoices(next,key):[];if(generated){source=candidates.find(s=>s.nodeId===generated.source?.nodeId&&s.fileId===generated.source?.fileId)||null;if(source)renderDraft();renderGenerated();}sourcesReady=true;showSourceOptions();sourceInfo();say('');}catch(e){if(alive(ticket))say(e.message,true);}}
  async function currentFile(snapshot,ticket){const fresh=await read(snapshot.projectId);if(!alive(ticket))throw Error('项目或源文件已经切换，未沿用旧来源。');verifySource(fresh,snapshot.projectId,snapshot);const db=await (snapshot.projectId===TRIAL?root.AuditChecklist.openTrial():root.AuditChecklist.open());try{const result=await db.downloadAttachment(snapshot.projectId,snapshot.nodeId,snapshot.fileId);if(!alive(ticket))throw Error('项目或源文件已经切换，未打开旧附件。');if(result.metadata.sha256!==snapshot.file.sha256||result.metadata.generationId!==snapshot.generationId)throw Error('源附件版本不一致，未打开。');return {record:fresh,...result};}finally{db.close();}}
  function renderGenerated(){generatedPanel.replaceChildren();if(!generated)return;let reason='';try{validateReportDraft(generated,record,project?.quoteId);if(handoverChanged)throw Error('数据衔接内容已有修改，请重新生成后再保存或导出当前稿。');if(generated.template&&(reportTypeSelect.value!==generated.template.opinion||reportTemplateSelect.value!==generated.template.sha256))throw Error('当前草稿使用「'+generated.template.name+'」。要使用新选项，请重新生成。');}catch(e){reason=e.message;}
   const heading=el('h3','审计报告正文 · 可编辑未签发草稿'),editor=el('textarea'),save=button('保存审计报告草稿'),download=button(generated.template?'下载审计报告草稿（Word）':'下载审计报告草稿（无章Word）');editor.id='report-editable-content';editor.setAttribute('aria-label','审计报告正文（未签发草稿）');editor.rows=30;editor.maxLength=150000;editor.value=generated.content;editor.readOnly=!!reason||reportBusy;save.id='report-draft-save';download.id='report-draft-download';save.disabled=download.disabled=!!reason||reportBusy;editor.oninput=()=>{generated={...generated,content:editor.value};reportDirty=true;};generatedPanel.append(heading);if(reason)generatedPanel.append(el('p',reason,'error'));if(generated.template)generatedPanel.append(el('p','模板：'+generated.template.name));generatedPanel.append(el('p','来源：'+generated.source.name+' · SHA256 '+generated.source.sha256+' · 清单修订 '+generated.source.recordRevision),editor,save,download);
   async function checkedGenerated(){const candidate=candidates.find(s=>s.nodeId===generated.source.nodeId&&s.fileId===generated.source.fileId);if(!candidate)throw Error('草稿来源已不存在，未保存或导出。');const fresh=await currentFile(candidate,serial);validateReportDraft(generated,fresh.record,project.quoteId);if(await root.ProjectWorkspaceStore.hash(fresh.blob)!==generated.source.sha256)throw Error('源报告实际SHA256已变化，未保存或导出。');return fresh;}
   save.onclick=async()=>{if(reportBusy)return;const ticket=serial,key=project?.quoteId;reportBusy=true;editor.readOnly=true;save.disabled=download.disabled=true;try{if(!workspace||!root.ProjectWorkspaceStore?.save)throw Error('项目草稿保存组件未加载，请刷新。');await checkedGenerated();if(!alive(ticket))return;const next={...generated,updatedAt:new Date().toISOString()};validateReportDraft(next,record,key);const saved=await root.ProjectWorkspaceStore.save(key,workspace.rev,{reportDraft:next});if(!alive(ticket))return;workspace=saved;generated=next;reportDirty=dirty=false;say('本项目审计报告编辑草稿已保存。原报告、原底稿公式均未修改，未签发。');}catch(e){if(alive(ticket))say(e.message,true);}finally{reportBusy=false;if(alive(ticket))renderGenerated();}};
   download.onclick=async()=>{if(reportBusy)return;const ticket=serial;reportBusy=true;editor.readOnly=true;save.disabled=download.disabled=true;try{await checkedGenerated();if(!alive(ticket))return;const draft=generated,f=await buildReportDocument(project.form.projectName,draft,candidates.find(s=>s.fileId===draft.source.fileId));if(!alive(ticket))return;validateReportDraft(draft,await read(draft.projectId),draft.projectId);if(!alive(ticket))return;root.ProjectWorkspaceStore.download(f,draft.template?'审计报告-编辑草稿-待核对.docx':'审计报告-编辑草稿-未签发无章.docx');say('已下载待核对的 Word 草稿。');}catch(e){if(alive(ticket))say(e.message,true);}finally{reportBusy=false;if(alive(ticket))renderGenerated();}};
  }
  function renderDraft(){handoverApi=syncHandover=null;form.replaceChildren();form.inert=false;if(!source)return;const draft={projectId:project.quoteId,projectName:project.form.projectName,source,year:String(project.source?.auditYear||''),currency:'',unit:'',reviewer:'',sourceConfirmed:false,dimensionsConfirmed:false,reviewConfirmed:false,rows:[]};
   const fields=el('div',undefined,'rw-fields'),year=el('input'),currency=el('select'),unit=el('select'),reviewer=el('input');year.id='report-year';year.inputMode='numeric';year.maxLength=4;year.value=draft.year;currency.id='report-currency';unit.id='report-unit';reviewer.id='report-reviewer';reviewer.maxLength=80;currency.append(new Option('请选择币种',''),...['CNY','HKD','USD','EUR','OTHER'].map(x=>new Option(x,x)));unit.append(new Option('请选择金额单位',''),new Option('货币单位','unit'),new Option('千货币单位','thousand'),new Option('万货币单位','ten-thousand'));for(const [name,input]of [['本年审计年度',year],['币种（不折算）',currency],['金额单位（不折算）',unit],['手工核对人（自填，非签名）',reviewer]]){const l=el('label',name);l.append(input);fields.append(l);}form.append(fields);
   const consent=(id,label)=>{const l=el('label',undefined,'rw-consent'),input=el('input');input.type='checkbox';input.id=id;l.append(input,d.createTextNode(label));form.append(l);return input;};const sourceConfirmed=consent('report-source-confirmed','我已核对该项目、该附件确为上年度审计报告；不是其他年度或其他单位的文件。'),dimensions=consent('report-dimensions-confirmed','我已核对上年期末与本年期初的年度、币种、单位一致；差异应先人工调节，本页不自动换算。');
   const table=el('table'),header=el('tr'),body=el('tbody');table.className='rw-table';for(const s of ['项目/科目','上年期末','本年期初','上年原件页码/表格/单元格','本年已确认审定期末','本年审计依据/原表定位','本行已核对'])header.append(el('th',s));const thead=el('thead');thead.append(header);table.append(thead,body);const wrap=el('div',undefined,'rw-table-wrap');wrap.append(table);form.append(wrap);const add=button('＋ 添加衔接行（最多20项）');add.id='report-add-row';form.append(add);const final=consent('report-review-confirmed','我已逐行核对手工数字和依据，理解导出仅为数据衔接核对表，无审计意见、报告日期、签字和印章。'),exportBtn=button('导出数据衔接核对表 · 无章Word草稿');exportBtn.id='report-export';const generate=button('生成审计报告');generate.id='report-generate';form.append(generate,exportBtn);
   function changed(){dirty=true;handoverChanged=true;if(generated)renderGenerated();draft.reviewConfirmed=false;final.checked=false;exportBtn.disabled=true;}
   function opening(row){try{return dimensions.checked?amount(row.priorClosing):'待核对对应关系';}catch{return '待填写';}}
   function sync(){draft.source=source;draft.year=year.value;draft.currency=currency.value;draft.unit=unit.value;draft.reviewer=reviewer.value;draft.sourceConfirmed=sourceConfirmed.checked;draft.dimensionsConfirmed=dimensions.checked;draft.reviewConfirmed=final.checked;for(const tr of body.rows)tr.querySelector('[data-opening]').textContent=opening(draft.rows[Number(tr.dataset.row)]);try{validateDraft(draft,record);exportBtn.disabled=refreshingSources();}catch{exportBtn.disabled=true;}add.disabled=draft.rows.length>=20;generate.disabled=!source||refreshingSources()||reportBusy||!!templateBlock;}
   syncHandover=sync;
   function addRow(){const row={item:'',priorClosing:'',priorEvidence:'',currentClosing:'',currentEvidence:'',confirmed:false},index=draft.rows.push(row)-1,tr=el('tr');tr.dataset.row=index;for(const [key,label]of [['item','项目/科目'],['priorClosing','上年期末'],['opening','本年期初'],['priorEvidence','上年原件定位'],['currentClosing','本年审定期末'],['currentEvidence','本年审计依据'],['confirmed','本行已核对']]){const td=el('td');if(key==='opening'){const s=el('span','待填写');s.dataset.opening='';td.append(s);}else{const i=el('input');i.setAttribute('aria-label',label+' 第'+(index+1)+'行');i.dataset.field=key;if(key==='confirmed'){i.type='checkbox';i.onchange=()=>{changed();row.confirmed=i.checked;sync();};}else{i.maxLength=['priorClosing','currentClosing'].includes(key)?25:key==='item'?120:240;i.oninput=()=>{changed();row[key]=i.value;row.confirmed=false;tr.querySelector('[data-field=confirmed]').checked=false;sync();};}td.append(i);}tr.append(td);}body.append(tr);sync();}
   for(const input of [year,currency,unit,reviewer,sourceConfirmed,dimensions])input.addEventListener('change',()=>{changed();if(input!==reviewer){for(const row of draft.rows)row.confirmed=false;for(const i of body.querySelectorAll('[data-field=confirmed]'))i.checked=false;}sync();});for(const input of [year,reviewer])input.addEventListener('input',()=>{changed();sync();});final.onchange=()=>{dirty=true;sync();};add.onclick=()=>{changed();addRow();};exportBtn.onclick=async()=>{const snapshot=source,ticket=serial;if(!snapshot||refreshingSources())return;exportBtn.disabled=true;try{const current=await currentFile(snapshot,ticket);const validated=validateDraft(draft,current.record);if(!root.QuoteLayouts?.packOfficeParts||!root.ProjectWorkspaceStore?.download)throw Error('Word打包或本机下载组件未加载，未生成替代文件。');const bytes=root.QuoteLayouts.packOfficeParts(wordParts(validated));if(!alive(ticket))return;root.ProjectWorkspaceStore.download(new Blob([bytes],{type:MIME}),'审计报告数据衔接核对表-无章草稿.docx');dirty=false;say('已导出本项目数据衔接核对表；不是正式审计报告。源附件与原公式未改动。');}catch(e){if(alive(ticket))say(e.message,true);}finally{if(alive(ticket))sync();}};
   handoverApi=()=>{sync();const rows=draft.rows.filter(r=>[r.item,r.priorClosing,r.priorEvidence,r.currentClosing,r.currentEvidence].some(v=>String(v).trim()));return validateDraft({...draft,rows},record,{allowEmpty:true});};
   generate.onclick=async()=>{
    if(!source||refreshingSources()||reportBusy||templateBlock)return;
    if(reportDirty&&!(typeof root.confirm==='function'&&root.confirm('重新生成将替换未保存的报告编辑内容，确定继续？')))return;
    const snapshot=source,ticket=serial,reportType=reportTypeSelect.value,templateTicket=reportTemplateTicket;
    const templateId=reportTemplateSelect.value;
    reportBusy=true;generate.disabled=true;
    try{
     const handover=handoverApi(),file=await currentFile(snapshot,ticket);
     if(!alive(ticket))return;
     validateDraft({...draft,rows:draft.rows.filter(r=>[r.item,r.priorClosing,r.priorEvidence,r.currentClosing,r.currentEvidence].some(v=>String(v).trim()))},file.record,{allowEmpty:true});
     const stamp=new Date().toISOString();
     const next={schemaVersion:1,projectId:handover.projectId,source:binding(handover.source),
      handover:{year:handover.year,currency:handover.currency,unit:handover.unit,reviewer:handover.reviewer,rows:handover.rows},generatedAt:stamp,updatedAt:stamp};
     if(templateId==='generic'){
      next.content=reportText(handover,await readPriorText(file),reportType);
     }else{
      if(await root.ProjectWorkspaceStore.hash(file.blob)!==handover.source.file.sha256)throw Error('上年报告实际字节与SHA256不一致，未生成草稿。');
      const selected=libraryTemplates.find(item=>item.sha256===templateId);
      next.schemaVersion=2;
      next.template={sha256:templateId,name:selected?.name,opinion:reportType};
      checkTemplateBinding(next.template);
      next.content=(await prepareTemplateDraft(handover.projectName,next,snapshot)).content;
     }
     if(!alive(ticket))return;
     if(templateTicket!==reportTemplateTicket||templateBlock)throw Error('报告类型或模板已变化，请重新生成。');
     if(JSON.stringify(handoverApi())!==JSON.stringify(handover))throw Error('数据衔接内容在生成中已变化，请重新核对生成。');
     validateReportDraft(next,await read(next.projectId),next.projectId);
     if(!alive(ticket)||templateTicket!==reportTemplateTicket)return;
     handoverChanged=false;generated=next;reportDirty=true;renderGenerated();
     say(next.template?'已生成所选模板的可编辑报告草稿，待核对。':'已生成可编辑审计报告草稿。未签发，未自动形成意见、签字、日期或改写源报告。请编辑并保存。');
    }catch(e){if(alive(ticket))say(e.message,true);}
    finally{reportBusy=false;if(alive(ticket)){sync();renderGenerated();}}
   };
   addRow();if(generated&&generated.source.sha256===source.file.sha256&&generated.source.fileId===source.fileId){const h=generated.handover;year.value=String(h.year);currency.value=h.currency;unit.value=h.unit;reviewer.value=h.reviewer;sourceConfirmed.checked=dimensions.checked=final.checked=true;if(h.rows.length){body.replaceChildren();draft.rows=[];for(const r of h.rows){addRow();const i=draft.rows.length-1;Object.assign(draft.rows[i],r,{confirmed:true});for(const input of body.rows[i].querySelectorAll('[data-field]')){const key=input.dataset.field;if(key==='confirmed')input.checked=true;else input.value=r[key]||'';}}}}sync();
  }
  select.onchange=()=>{if(!canLeave()){select.value=project?.quoteId||'';return;}void loadProject();};refresh.onclick=()=>{if(canLeave())void loadProjects(true).catch(e=>say(e.message,true));};sourceSelect.onchange=()=>{const selected=sourceSelect.value===''?null:candidates[Number(sourceSelect.value)]||null;if(selected===source)return;if(!canLeave()){sourceSelect.value=String(candidates.indexOf(source));return;}++serial;previewHandle?.close();previewHandle=null;source=selected;dirty=false;handoverChanged=!!generated;sourceInfo();renderDraft();renderGenerated();};preview.onclick=async()=>{const snapshot=source,ticket=serial;if(!snapshot||refreshingSources())return;try{const file=await currentFile(snapshot,ticket);if(!root.AuditAttachmentPreview?.open)throw Error('只读附件预览组件尚未加载。');if(alive(ticket))previewHandle=root.AuditAttachmentPreview.open({blob:file.blob,name:file.metadata.name,sha256:file.metadata.sha256});}catch(e){if(alive(ticket))say(e.message,true);}};
  tbOpen.onclick=async()=>{const key=project?.quoteId;if(!key)return;if(!canLeave())return;const ticket=serial;try{if(typeof adapter.openTrialBalance!=='function')throw Error('9200原表入口尚未接通，请从本项目底稿目录选择9200。');const result=await adapter.openTrialBalance({projectId:key,index:'9200'});if(!alive(ticket))return;const labels={ready:'已进入本项目9200原表。',missing:'本项目原包尚未导入或不匹配；请在该项目目录导入准确原包，未改开其他表。',ambiguous:'已进入本项目9200目录，请明确选择原工作表；未自动挑选。',unmapped:'9200没有唯一可靠的原表对应，未猜测打开。',cancelled:'已取消进入，当前项目与未保存内容保持不变。'};if(!result||!Object.hasOwn(labels,result.state))throw Error('原表入口未返回可核对状态，请从底稿目录检查。');tbStatus.textContent=labels[result.state];}catch(e){if(alive(ticket))say(e.message,true);}};
  sourceInfo();
  companySelect.append(new Option('全部被审计单位',''));
  showProjectOptions('');
  companySelect.onchange=()=>{
   const company=companySelect.value,current=select.value;
   const matching=matchingProjects(company);
   const next=matching.some(item=>item.quoteId===current)||(!company&&current===TRIAL)?current:
    company&&matching.length===1?matching[0].quoteId:'';
   if(next!==current&&!canLeave()){setCompanyFilter(companyFilter);return;}
   setCompanyFilter(company);
   showProjectOptions(next,matching);
   if(next!==current)void loadProject();
  };
  void loadReportTemplates();
  const ready=loadProjects().catch(e=>say(e.message,true));
  return Object.freeze({
    show:selectSection,selectSection,refreshActiveSection,
    async selectProject(id){
      await ready;
      if(project?.quoteId!==id&&!canLeave())return;
      if(id&&id!==TRIAL&&!projectCompanies.has(id))await loadProjects(true);
      if(id&&id!==TRIAL&&!projectCompanies.has(id))throw Error('未找到该报告项目。');
      setCompanyFilter(projectCompanies.get(id)||'');
      showProjectOptions(id);
      if(project?.quoteId!==id)await loadProject();
    },
    canLeave,destroy(){dead=true;++serial;++reportTemplateTicket;previewHandle?.close();inline?.destroy();project=record=source=null;candidates=[];box.remove();}
  });
 }
 return Object.freeze({mount,amount,sourceChoices,verifySource,validateDraft,validateReportDraft,reportText,wordParts,downloadSavedDraft,MIME});
});
