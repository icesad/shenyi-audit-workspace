/* Five independent bid-file slots per project, with a read-only legacy template.
 * Files are archived as opaque originals; nothing is rendered as active page content. */
(function(root){
  'use strict';
  const DB='hengdu.quote.bidDocs.v1', META='metadata', FILES='originals', TEMPLATE='template', LIMIT=12*1024*1024;
  const SLOTS=[1,2,3,4,5];
  const DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  function fail(s){throw new Error(s);}
  function clean(s,max){if(typeof s!=='string'||s.length>max||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(s))return '';return s.trim();}
  function context(p){const f=['issuer','projectName','firmName'].map(k=>clean(p?.[k],500));if(f.some(v=>!v))return null;const bidder=clean(p.bidderId||'',256);if(p.bidderId&&!bidder)return null;return {scope:'project:'+JSON.stringify([clean(p.projectId||'',500),f[0],f[1],bidder?['library',bidder]:['manual',f[2]]]),caption:f.join(' · ')};}
  const key=(scope,slot)=>JSON.stringify([scope,slot]);
  function isDocx(a){
    const d=new DataView(a.buffer,a.byteOffset,a.byteLength),n=a.length,u16=i=>d.getUint16(i,true),u32=i=>d.getUint32(i,true);
    if(n<22||u32(0)!==0x04034b50)return false;
    let e=n-22;for(;e>=Math.max(0,n-65557);--e)if(u32(e)===0x06054b50&&e+22+u16(e+20)===n)break;
    if(e<Math.max(0,n-65557)||u16(e+4)||u16(e+6)||u16(e+8)!==u16(e+10))return false;
    const count=u16(e+10),entries=new Set();let i=u32(e+16);
    if(count<2||count>12000||i+u32(e+12)!==e)return false;
    const decoder=new TextDecoder();
    for(let j=0;j<count;j++){
      if(i+46>e||u32(i)!==0x02014b50||(u16(i+8)&1))return false;
      const chars=u16(i+28),end=i+46+chars,after=end+u16(i+30)+u16(i+32);
      if(!chars||after>e)return false;
      const name=decoder.decode(a.subarray(i+46,end)),off=u32(i+42);
      if(off+30>u32(e+16)||u32(off)!==0x04034b50||off+30+u16(off+26)+u16(off+28)+u32(i+20)>u32(e+16)||u16(off+26)!==chars||decoder.decode(a.subarray(off+30,off+30+chars))!==name||entries.has(name)||/vbaProject\.bin$/i.test(name))return false;
      entries.add(name);i=after;
    }
    return i===e&&entries.has('[Content_Types].xml')&&entries.has('word/document.xml');
  }
  async function inspect(file){
    const name=clean(file?.name,255);if(!name||/[\\/]/.test(name))fail('文件名无效，请重命名后再试。');
    if(!Number.isSafeInteger(file.size)||file.size<1||file.size>LIMIT)fail('文件为空或超过 12 MB。');
    const mime=/\.pdf$/i.test(name)?'application/pdf':/\.docx$/i.test(name)?DOCX:'';
    if(!mime)fail('仅支持 .docx 或 .pdf 原件。');
    if(file.type&&!['application/octet-stream',mime,...(mime===DOCX?['application/zip','application/x-zip-compressed']:[])].includes(file.type.toLowerCase()))fail('文件类型与扩展名不一致。');
    const a=new Uint8Array(await file.arrayBuffer());
    if(a.length!==file.size)fail('文件读取不完整。');
    if(mime===DOCX?!isDocx(a):!(new TextDecoder().decode(a.subarray(0,9)).match(/^%PDF-\d\.\d/) && /%%EOF\s*$/.test(new TextDecoder().decode(a.subarray(-1024)))))fail('文件内容与类型不符或文件损坏，不替换原件。');
    return {name,size:a.length,mime,blob:new Blob([a],{type:mime})};
  }
  function open(){
    return new Promise((resolve,reject)=>{
      let r,settled=false;function no(s){settled=true;reject(new Error(s));}
      try{r=root.indexedDB.open(DB,1);}catch{return no('当前浏览器无法使用本机文件库。');}
      r.onerror=()=>no('无法读取本机文件库。');r.onblocked=()=>no('请关闭其他版本的工作台后重开。');
      r.onupgradeneeded=e=>{const db=r.result;if(settled||e.oldVersion!==0){r.transaction.abort();return;}db.createObjectStore(META,{keyPath:'id'}).createIndex('scope','scope');db.createObjectStore(FILES);};
      r.onsuccess=()=>{const db=r.result;if(settled){db.close();return;}try{if(!db.objectStoreNames.contains(FILES)||!db.transaction(META).objectStore(META).indexNames.contains('scope'))throw Error();db.onversionchange=()=>db.close();resolve(db);}catch{db.close();no('标书库结构不兼容，未清除旧数据。');}};
    });
  }
  function tx(db,stores,mode,body){
    return new Promise((resolve,reject)=>{
      let out,reason;const tr=db.transaction(stores,mode);
      const guard=fn=>()=>{try{fn();}catch(e){reason=e;tr.abort();}};
      tr.oncomplete=()=>resolve(out);tr.onabort=()=>reject(reason||Error(tr.error?.name==='QuotaExceededError'?'本机存储空间不足，原文件保留。':'本机文件操作失败，请刷新重试。'));
      tr.onerror=()=>{};guard(()=>body(tr,(r,fn)=>{r.onsuccess=guard(()=>fn(r.result));},v=>out=v))();
    });
  }
  function list(db,scope){return tx(db,[META],'readonly',(tr,next,done)=>next(tr.objectStore(META).index('scope').getAll(scope),done));}
  function change(db,scope,slot,expected,patch,file){
    return tx(db,[META,FILES],'readwrite',(tr,next,done)=>{
      const meta=tr.objectStore(META),files=tr.objectStore(FILES),id=key(scope,slot);
      next(meta.get(id),old=>{if((old?.version||0)!==expected)fail('内容已在另一窗口更新；请刷新后重试。');
        const row={...old,id,scope,slot,version:expected+1,...patch};
        if(file){row.file={name:file.name,size:file.size,mime:file.mime};files.put(file.blob,id);}
        if(file===null){delete row.file;files.delete(id);}meta.put(row);done(row);
      });
    });
  }
  function original(db,scope,slot,expected){
    return tx(db,[META,FILES],'readonly',(tr,next,done)=>{
      const id=key(scope,slot);next(tr.objectStore(META).get(id),row=>{if(!row?.file||row.version!==expected)fail('原件不存在或已变更，请刷新。');
        next(tr.objectStore(FILES).get(id),b=>{if(!b||b.size!==row.file.size||b.type!==row.file.mime)fail('原件不完整，未下载。');done({blob:b,name:row.file.name});});
      });
    });
  }
  function mount(container,{project,notify}={}){
    if(!container||typeof project!=='function')fail('缺少标书挂载位置或项目读取接口。');
    const doc=container.ownerDocument;
    const make=(tag,cls,txt)=>{const e=doc.createElement(tag);if(cls)e.className=cls;if(txt)e.textContent=txt;return e;};
    const btn=(txt,cl='btn')=>{const b=make('button',cl,txt);b.type='button';return b;};
    const shell=make('div','bd-shell'),intro=make('p','muted','每个项目有 5 个独立上传位，可按需上传，不必填满。每位支持一份 DOCX 或 PDF（不超过 12 MB），仅保存在当前浏览器，不自动加入报价包。'),
      caption=make('p','bd-context'),projectBox=make('section','bd-current'),legacy=make('details','bd-legacy'),legacyRows=make('ul','bd-legacy-list'),
      msg=make('p','bd-msg'),again=btn('刷新本机标书','text-button');
    msg.setAttribute('role','status');msg.setAttribute('aria-live','polite');projectBox.setAttribute('aria-label','当前项目标书文件');legacy.hidden=true;
    legacy.append(make('summary',null,'旧版文件（仅下载）'),legacyRows);
    const buildBox=make('section','bd-build'),buildHead=make('h3',null,'生成准入标书（简版提纲）'),buildFields=make('div','bd-build-fields'),
      buildActions=make('div','bd-actions'),buildStatus=make('p','bd-build-msg'),buildBtn=btn('下载无章标书 Word','btn primary'),
      buildDetails=make('details','bd-build-details'),buildItems=make('ol'),formalLabel=make('label','bd-build-formal'),formal=make('input');
    buildHead.id='bd-build-title';buildBox.setAttribute('aria-labelledby',buildHead.id);
    buildBtn.id='bd-build-download';buildBtn.disabled=true;buildBtn.setAttribute('aria-describedby','bd-build-status');
    buildStatus.id='bd-build-status';buildStatus.setAttribute('role','status');
    formal.type='checkbox';formal.id='bd-build-formal-one';
    formalLabel.append(formal,make('span',null,'我已核对本项目要求，开标一览表使用 1 元形式报价（不带入审易议价金额）'));
    function builderField(id,label,placeholder){
      const wrap=make('label','bd-name',label),control=make('input');control.id=id;control.type='text';control.maxLength=100;control.placeholder=placeholder;
      wrap.append(control);buildFields.append(wrap);return control;
    }
    const number=builderField('bd-build-id','招标编号','按本项目文件填写'),packageName=builderField('bd-build-package','标包（选填）','如：第 1 包');
    for(const s of root.BidDraft?.sections||[])buildItems.append(make('li',null,s.replace(/^[一二三四五六七八九]、/u,'')));
    buildDetails.append(make('summary',null,'查看生成的九个章节'),buildItems);
    buildActions.append(buildBtn);buildBox.append(buildHead,make('p','muted','参照 FWE008 的投标文件格式，生成封面、目录及九章。发标方、项目、投标方与已有联系方式从本页带入；证件、业绩、凭证、技术方案、承诺与签章请在 Word 中核对补齐。'),
      buildFields,formalLabel,buildDetails,buildActions,buildStatus);
    const setBuild=(s,bad=false)=>{buildStatus.textContent=s;buildStatus.classList.toggle('error',bad);};
    let buildScope;
    function syncBuilder(c){
      if(buildScope!==c?.scope){
        buildScope=c?.scope;number.value=packageName.value='';formal.checked=false;
        setBuild(c?'可生成可编辑草稿。不会保存到下方上传位，也不会自动盖章。':'请先填写发标单位、项目名称和投标方名称。');
      }
      if(!buildStatus.textContent&&!c)setBuild('请先填写发标单位、项目名称和投标方名称。');
      number.disabled=packageName.disabled=formal.disabled=buildBtn.disabled=!c||!root.BidDraft?.build;
    }
    buildBtn.onclick=()=>{
      try{
        const p=project(),c=context(p);
        if(!c||c.scope!==buildScope){syncBuilder(c);return;}
        const result=root.BidDraft.build({...p,number:number.value,packageName:packageName.value,formalOne:formal.checked});
        saveDownload({name:result.name,blob:new Blob([result.bytes],{type:result.mime})},false);
        setBuild('已生成无章 Word；请补齐资料、核对偏差和承诺，完成规定的签署后再递交。');
      }catch(e){setBuild(e?.message||'未能生成标书。',true);}
    };
    shell.append(buildBox,intro,caption,projectBox,legacy,again,msg);container.replaceChildren(shell);
    const info=(s,error=false)=>{msg.textContent=s;msg.classList.toggle('error',error);};
    const tell=s=>{info(s);if(typeof notify==='function')notify(s);};
    let db,attempt,generation=0,active=undefined;
    const ensureDb=()=>attempt||(attempt=open().then(d=>(db=d)).catch(e=>{attempt=null;throw e;}));
    function saveDownload(o,showStatus=true){
      const a=make('a'),url=URL.createObjectURL(o.blob);
      try{a.href=url;a.download=o.name;doc.body.append(a);a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
      if(showStatus)tell('已请求下载：'+o.name);
    }
    function tile(scope,slot){
      const slotName='标书 '+slot,controlId='bd-slot-'+slot;
      const card=make('div','bd-tile'),heading=make('h3',null,slotName),badge=make('span','bd-file-status'),
        header=make('div','bd-top'),label=make('label','bd-file-label'),file=make('input'),pick=make('span',null,'选择文件'),
        description=make('p','bd-description'),actions=make('div','bd-actions'),download=btn('下载原件'),del=btn('移除文件','text-button'),
        nameLine=make('div','bd-name-row'),nameField=make('label','bd-name','自定义名称'),name=make('input'),rename=btn('保存名称','text-button');
      card.dataset.bidSlot=String(slot);heading.id=controlId+'-title';card.setAttribute('aria-labelledby',heading.id);
      header.append(heading,badge);file.type='file';file.id=controlId+'-file';file.accept='.docx,.pdf';file.setAttribute('aria-label','为'+slotName+'选择文件');label.append(pick,file);
      download.id=controlId+'-download';del.id=controlId+'-remove';
      download.setAttribute('aria-label','下载'+slotName+'原件');del.setAttribute('aria-label','移除'+slotName+'文件');actions.append(download,del);
      name.id=controlId+'-name';name.type='text';name.maxLength=60;name.placeholder=slotName;
      rename.id=controlId+'-rename';rename.setAttribute('aria-label','保存'+slotName+'的名称');
      nameField.append(name);nameLine.append(nameField,rename);
      card.append(header,nameLine,description,label,actions);projectBox.append(card);
      let busy=false,loaded=false,record=null;
      function enabled(){return !!db&&!!scope&&loaded;}
      function controls(){const lock=!enabled()||busy;file.disabled=name.disabled=rename.disabled=lock;download.disabled=del.disabled=lock||!record?.file;}
      function update(row){
        record=row||null;loaded=true;badge.textContent=row?.file?'已保存':'未上传';
        const label=clean(row?.label,60);name.value=label;heading.textContent=label?slotName+' · '+label:slotName;
        description.textContent=row?.file?row.file.name+' · '+(row.file.size/1024).toFixed(1)+' KB':'此上传位还没有保存文件。';controls();
      }
      function current(){return card.isConnected&&scope===active&&scope===context(project())?.scope;}
      async function run(fn){if(!enabled()||busy||!current())return;busy=true;controls();try{await fn();}catch(e){if(current())info(e?.message||'操作失败，未清空原件。',true);}finally{busy=false;if(current())controls();}}
      function commit(f,note,patch={}){if(!current())return;return change(db,scope,slot,record?.version||0,patch,f).then(row=>{
        if(current()){
          const pendingName=name.value,prior=clean(record?.label,60);
          update(row);if(!Object.hasOwn(patch,'label')&&pendingName!==prior)name.value=pendingName;
          tell(note);
        }
      });}
      file.addEventListener('change',()=>{const f=file.files[0];file.value='';if(!f)return;run(async()=>{
        if(record?.file&&!root.confirm('用所选文件替换「'+slotName+'」的原件？其他上传位不变。'))return;
        const checked=await inspect(f);await commit(checked,'已保存'+slotName+'：'+checked.name);
      });});
      del.onclick=()=>run(async()=>{if(root.confirm('仅移除「'+slotName+'」的文件？其他上传位、项目和报价历史不变。'))await commit(null,'已移除'+slotName+'的文件。');});
      download.onclick=()=>run(async()=>{const o=await original(db,scope,slot,record?.version||0);if(current())saveDownload(o);});
      rename.onclick=()=>run(async()=>{
        const label=clean(name.value,60);if(name.value.trim()&&!label)fail('名称过长或含不支持的字符。');
        await commit(undefined,slotName+'的位置名称已保存。',{label});
      });
      update();loaded=false;controls();return {update};
    }
    function legacyRow(row,epoch){
      const item=make('li','bd-legacy-row'),meta=make('div','bd-legacy-meta'),download=btn('下载原件');
      const title='旧版通用标书模板';
      meta.append(make('strong',null,title),make('span','bd-description',row.file.name));
      download.id='bd-template-download';
      download.setAttribute('aria-label','下载'+title+'原件');
      item.append(meta,download);legacyRows.append(item);
      const current=()=>item.isConnected&&generation===epoch;
      download.onclick=async()=>{if(!current()||download.disabled)return;download.disabled=true;
        try{const o=await original(db,TEMPLATE,0,row.version);if(current())saveDownload(o);}
        catch(e){if(current())info(e?.message||'未能下载原件。',true);}
        finally{if(current())download.disabled=false;}
      };
    }
    async function refresh(force=false){
      const c=context(project()),scope=c?.scope||null;syncBuilder(c);
      if(!force&&active===scope&&db){if(c)caption.textContent='本项目标书：'+c.caption;return;}
      const epoch=++generation;active=scope;
      // Separate UI instances keep pending reads and writes attached to the selected project.
      projectBox.replaceChildren();legacyRows.replaceChildren();legacy.hidden=true;legacy.open=false;
        const tiles=SLOTS.map(slot=>tile(scope,slot));
      caption.textContent=scope?'本项目标书：'+c.caption:'先填写发标单位、项目名称和投标方名称，再保存本项目标书。';
      info('正在读取本机标书…');try{const db=await ensureDb();const [templates,rows]=await Promise.all([list(db,TEMPLATE),scope?list(db,scope):[]]);
        if(epoch!==generation)return;
        for(const [i,slot] of SLOTS.entries())tiles[i].update(rows.find(r=>r.slot===slot));
        const template=templates.find(r=>r.slot===0&&r.file);
        if(template)legacyRow(template,epoch);
        legacy.hidden=!legacyRows.childElementCount;info('标书已更新。');
      }catch(e){if(epoch===generation)info(e?.message||'本机标书库不可用，可刷新重试。',true);}
    }
    again.onclick=()=>refresh(true);const ready=refresh();return Object.freeze({refresh,ready});
  }
  root.BidDocuments=Object.freeze({mount});
})(globalThis);
