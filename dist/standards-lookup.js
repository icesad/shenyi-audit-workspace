/* The bundled catalogue is read locally. Source links are only opened on request. */
(function(root){'use strict';
 const categories={
  audit:'审计准则',enterprise:'会计准则',small:'小企业会计准则',government:'政府会计准则',custom:'自传制度文件'
 };
 const prefixes={audit:'中国注册会计师审计准则',enterprise:'企业会计准则',government:'政府会计准则'};
 const normalize=value=>value.normalize('NFKC').toLowerCase().replace(/[\s\p{Punctuation}]/gu,'');
 function mount(host){
  const d=host.ownerDocument;
  const el=(tag,text,cls)=>{const node=d.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const label=(title,id)=>{const node=el('label',title);node.htmlFor=id;return node;};
  const panel=el('section',undefined,'panel standards-panel'),fields=el('div',undefined,'standards-fields');
  const category=el('select'),input=el('input'),drop=el('button','▾','standards-toggle'),options=el('ul',undefined,'standards-options');
  const result=el('article',undefined,'standards-result'),empty=el('p','请选择或输入具体准则。','standards-empty');
  const group=el('div'),picker=el('div',undefined,'standards-picker');
  const actions=el('div',undefined,'standards-actions'),exportPdf=el('button','导出','btn primary'),
    upload=el('button','上传制度文件','btn'),filePicker=el('input'),status=el('p',undefined,'standards-edition standards-status');
  exportPdf.type=upload.type='button';exportPdf.disabled=true;filePicker.type='file';filePicker.multiple=true;filePicker.hidden=true;
  filePicker.accept='.pdf,.doc,.docx';filePicker.setAttribute('aria-label','选择制度文件');status.setAttribute('role','status');
  globalThis.ShenyiFileDrop?.bind(upload,filePicker,{material:'制度文件'});
  actions.append(exportPdf,upload,filePicker);
  const source=root.ShenyiStandards||[];
  const catalogue=source.map((entry,index)=>{
   const title=entry.number?prefixes[entry.category]+'第'+entry.number+'号——'+entry.title:
    entry.category==='small'?entry.title:prefixes[entry.category]+'——'+entry.title;
   const display=title+(entry.edition?'（'+entry.edition+'）':'');
   const keys=[title,entry.title,entry.number,entry.edition,...(entry.keywords||[])].filter(Boolean).map(normalize);
   return {...entry,index,title,display,keys};
  });
  category.id='standards-category';input.id='standards-item';options.id='standards-options';
  for(const [key,title]of Object.entries(categories))category.add(new Option(title,key));
  input.type='text';input.autocomplete='off';input.placeholder='输入编号、名称或关键词';
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');
  input.setAttribute('aria-controls',options.id);input.setAttribute('aria-expanded','false');
  drop.type='button';drop.setAttribute('aria-label','展开具体准则');drop.tabIndex=-1;
  options.hidden=true;options.setAttribute('role','listbox');options.setAttribute('aria-label','可选准则');
  group.append(label('适用准则',category.id),category);
  picker.append(label('具体准则',input.id),input,drop,options);
  fields.append(group,picker,actions);panel.append(fields,status,result);result.append(empty);host.replaceChildren(panel);
  let selected=null,matches=[],highlight=-1,exporting=false,uploading=false,storePromise=null;
  const custom=new Map(),chapter=/^第[一二三四五六七八九十百零〇两\d]+[章节]/u;
  const isPdf=entry=>/\.pdf$/iu.test(entry?.file?.name||'');
  function store(){
   return storePromise||(storePromise=root.AuditTemplates.open({dbName:'hengdu.standards.policies.v1'}).catch(error=>{storePromise=null;throw error;}));
  }
  function say(message,bad=false){status.textContent=message;status.classList.toggle('error',bad);}
  function lock(){exportPdf.disabled=exporting||!selected||!(selected.text||isPdf(selected)||selected.file&&selected.indexed);upload.disabled=uploading;}
  function clearSelection(){selected=null;result.replaceChildren(empty);lock();}
  function hide(){
   options.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');highlight=-1;
  }
  function filter(query){
   const words=query.trim().split(/\s+/u).map(normalize).filter(Boolean);
   return catalogue.filter(entry=>entry.category===category.value&&words.every(word=>entry.keys.some(key=>key.includes(word))));
  }
  function select(entry){
   selected=entry;input.value=entry.display;hide();result.replaceChildren(el('h2',entry.title));
   lock();
   if(entry.edition)result.append(el('p',entry.edition,'standards-edition'));
   if(entry.notice)result.append(el('p',entry.notice,'standards-notice'));
   const links=el('p',undefined,'standards-sources');
   const link=(label,url)=>{const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
   if(entry.file){
    if(!entry.text)result.append(el('p',entry.indexed?'未提取到正文，可按文件名查找，点击「导出」可下载原件。':'正在提取制度正文。','standards-edition'));
   }else{
    links.append(link('查看官方原文',entry.source));
    if(entry.sourceBody&&entry.sourceBody!==entry.source)links.append(link('查看官方附件',entry.sourceBody));
   }
   if(links.childElementCount)result.append(links);
   const prose=el('div',undefined,'standards-prose');
   for(const line of (entry.text||'').split('\n')){
    if(!line.trim())continue;
    prose.append(el(chapter.test(line)?'h3':'p',line));
   }
   result.append(prose);
  }
  function show(query){
   matches=filter(query);highlight=-1;input.removeAttribute('aria-activedescendant');options.replaceChildren();
   for(const entry of matches){
    const option=el('li',entry.display);option.id='standards-choice-'+entry.index;
    option.setAttribute('role','option');option.setAttribute('aria-selected',String(entry===selected));
    option.onpointerdown=event=>event.preventDefault();option.onclick=()=>select(entry);
    options.append(option);
   }
   if(!matches.length){const noMatch=el('li','未找到匹配的准则。');noMatch.setAttribute('role','presentation');options.append(noMatch);}
   options.hidden=false;input.setAttribute('aria-expanded','true');
  }
  function move(index){
   if(!matches.length)return;
   highlight=(index+matches.length)%matches.length;
   for(const [i,option]of [...options.children].entries())option.setAttribute('aria-selected',String(i===highlight));
   const option=options.children[highlight];input.setAttribute('aria-activedescendant',option.id);
   option.scrollIntoView({block:'nearest'});
  }
  category.onchange=()=>{input.value='';hide();clearSelection();};
  input.oninput=()=>{if(selected)clearSelection();show(input.value);};
  input.onclick=()=>{if(options.hidden)show(selected?'':input.value);};
  input.onkeydown=event=>{
   if(event.key==='Escape'){hide();return;}
   if(event.key==='Tab'){hide();return;}
   if(!['ArrowDown','ArrowUp','Enter'].includes(event.key)||event.isComposing)return;
   event.preventDefault();
   if(options.hidden)show(selected?'':input.value);
   if(event.key==='ArrowDown')move(highlight+1);
   else if(event.key==='ArrowUp')move(highlight<0?matches.length-1:highlight-1);
   else{
    const entry=matches[highlight]||(matches.length===1?matches[0]:null);
    if(entry)select(entry);
   }
  };
  drop.onclick=()=>{input.focus();if(options.hidden)show(selected?'':input.value);else hide();};
  d.addEventListener('pointerdown',event=>{if(!picker.contains(event.target))hide();});
  function include(meta){
   if(custom.has(meta.sha256))return custom.get(meta.sha256);
   const entry={file:meta,category:'custom',index:catalogue.length,title:meta.name,display:meta.name,keys:[normalize(meta.name)],text:'',indexed:false};
   custom.set(meta.sha256,entry);catalogue.push(entry);
   return entry;
  }
  async function index(entry){
   if(entry.indexed||entry.indexing)return;
   entry.indexing=true;
   try{
    const {blob,name}=await (await store()).read(entry.file.sha256),file=new root.File([blob],name);
    let data;
    if(/\.pdf$/iu.test(name)&&file.size<=32*1024*1024)data=await root.BidderPdfText.readReadingCopy(new Uint8Array(await file.arrayBuffer()));
    else if(/\.docx$/iu.test(name))data=await root.TenderImport.readVisibleText(file);
    else if(/\.doc$/iu.test(name))data=await root.LegacyDoc.read(file);
    entry.text=data?.lines.join('\n')||'';
    if(entry.text)entry.keys.push(normalize(entry.text));
   }catch{}
   finally{
    entry.indexed=true;entry.indexing=false;
    if(selected===entry)select(entry);
    else if(category.value==='custom'&&!options.hidden)show(input.value);
   }
  }
  async function load(){
   const records=(await (await store()).list()).records;
   for(const meta of records)include(meta);
   if(category.value==='custom'&&!options.hidden)show(input.value);
   for(const entry of custom.values())await index(entry);
  }
  upload.onclick=()=>filePicker.click();
  filePicker.onchange=async()=>{
   const files=Array.from(filePicker.files);filePicker.value='';
   if(uploading||!files.length)return;
   uploading=true;lock();say('正在保存制度文件并提取正文…');
   let saved=0;const failures=[];
   try{
    const db=await store();
    for(const file of files){
     try{
      if(!/\.(?:pdf|docx?)$/iu.test(file.name))throw Error('请选择 PDF、DOC 或 DOCX。');
      const {record}=await db.put(file),entry=include(record);
      saved++;await index(entry);
     }catch(error){failures.push(file.name+'：'+error.message);}
    }
    if(saved){category.value='custom';category.onchange();input.focus();show('');}
    say((saved?'已保存 '+saved+' 份制度文件。可按名称或已提取的正文查找。':'')+failures.join(' '),!!failures.length);
   }catch(error){say(error.message,true);}
   finally{uploading=false;lock();}
  };
  exportPdf.onclick=async()=>{
   const entry=selected;
   if(!entry||exporting)return;
   exporting=true;lock();say('正在导出…');
   try{
    let blob,name;
    if(entry.file&&(isPdf(entry)||!entry.text)){
     const saved=await (await store()).read(entry.file.sha256);
     blob=saved.blob;name=saved.name;
    }else{
     const paragraphs=[entry.edition,entry.notice,...entry.text.split('\n'),entry.source?'来源：'+entry.source:'']
      .filter(Boolean).map(text=>({text,heading:chapter.test(text)}));
     const bytes=await root.QuoteBodyPdf.buildReadingCopy(entry.title,paragraphs);
     blob=new root.Blob([bytes],{type:'application/pdf'});
     name=entry.title.replace(/\.(doc|docx)$/iu,'').replace(/[\\/:*?"<>|]/gu,'_').slice(0,120)+'.pdf';
    }
    if(selected!==entry||host.closest('[hidden]'))throw Error('当前查询已切换，请重新选择文件后导出。');
    root.ProjectWorkspaceStore.download(blob,name);
    say('已导出 '+name+'。');
   }catch(error){say(error.message||'文件导出失败。',true);}
   finally{exporting=false;lock();}
  };
  void load().catch(error=>say(error.message,true));
  return Object.freeze({opened:true});
 }
 root.StandardsLookup=Object.freeze({mount});
})(globalThis);
