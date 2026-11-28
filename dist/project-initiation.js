/* Browser-local initiation records from won quotes or manual registration. */
(function(root){
  'use strict';
  const DATABASE='hengdu.quote.projects.v1',STORE='projects',MAX_PROJECTS=500;
  const SOURCE_KEYS=['quoteId','wonEventNo','wonAt','projectName','issuer','customerName','firmName','auditYear','quoteDate','totalCents','projectType'];
  const FORM_KEYS=['projectName','initiationDate','manager','notes'];
  const RECORD_KEYS=['schemaVersion','quoteId','revision','source','form','createdAt','updatedAt'];
  const schemaMessage='本机立项记录结构不受支持，未覆盖原记录。';
  const staleMessage='此立项已在其他页面更新。请保留当前输入，重新打开后核对再保存。';
  const wonMessage='仅可为最新结果为「中标」的报价填写立项信息。';
  function exact(value,keys){
    if(!value||Object.getPrototypeOf(value)!==Object.prototype)throw Error(schemaMessage);
    const d=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(d);
    if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!d[k].enumerable||!Object.hasOwn(d[k],'value')))throw Error(schemaMessage);
  }
  function id(v){if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v))throw Error('报价编号无效。');return v;}
  function text(v,n,field,required=false){
    if(typeof v!=='string'||!v.isWellFormed()||v.length>n||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)||required&&!v.trim())throw Error(field+(required?'不能为空，且':'')+'不得超过 '+n+' 个字符。');
    return v;
  }
  function date(v){
    if(typeof v!=='string'||!/^\d{4}-\d\d-\d\d$/.test(v)||v.startsWith('0000')||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw Error('请填写有效日期。');
    return v;
  }
  function iso(v){
    if(typeof v!=='string'||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)throw Error(schemaMessage);
    return v;
  }
  function sourceShape(v){
    const estimate=v?.origin==='estimate',manual=v?.origin==='manual';
    exact(v,estimate||manual?[...SOURCE_KEYS,'origin']:SOURCE_KEYS);
    const validYear=(estimate||manual)&&v.auditYear===null||Number.isInteger(v.auditYear)&&v.auditYear>=1900&&v.auditYear<=9999;
    const validAmount=(estimate||manual)&&v.totalCents===null||Number.isSafeInteger(v.totalCents)&&v.totalCents>=0;
    const validOrigin=manual?v.wonEventNo===null&&v.wonAt===null&&v.quoteDate===''&&v.issuer===''&&v.firmName===''&&v.totalCents===null:
      Number.isSafeInteger(v.wonEventNo)&&v.wonEventNo>=1;
    if(!validOrigin||!validYear||!validAmount)throw Error(schemaMessage);
    return {quoteId:id(v.quoteId),wonEventNo:v.wonEventNo,wonAt:manual?null:iso(v.wonAt),projectName:text(v.projectName,300,'来源项目名称',!estimate),
      issuer:text(v.issuer,200,'发标单位'),customerName:text(v.customerName,200,'被审计单位',manual),firmName:text(v.firmName,200,'投标事务所'),
      auditYear:v.auditYear,quoteDate:manual?'':date(v.quoteDate),totalCents:v.totalCents,projectType:text(v.projectType,100,'项目类型'),...(estimate||manual?{origin:v.origin}:{})};
  }
  function sourceOf(input,quoteId){
    const entry=input?.entry||input,last=entry?.events?.at(-1),s=entry?.snapshot;
    if(!s||entry.id!==id(quoteId))throw Error('未找到这条本机报价记录。');
    if(last?.outcome!=='won')throw Error(wonMessage);
    if(last.eventNo!==entry.lastEventNo)throw Error(schemaMessage);
    return sourceShape({quoteId,wonEventNo:last.eventNo,wonAt:last.recordedAt,projectName:s.projectName,issuer:s.issuer,
      customerName:s.customerName,firmName:s.firmName,auditYear:s.auditYear,quoteDate:s.quoteDate,totalCents:s.totalCents,projectType:s.projectType,...(s.origin==='estimate'?{origin:'estimate'}:{})});
  }
  function formShape(v){
    exact(v,FORM_KEYS);
    return {projectName:text(v.projectName,300,'项目名称',true).trim(),initiationDate:date(v.initiationDate),
      manager:text(v.manager,100,'项目负责人').trim(),notes:text(v.notes,2000,'项目说明').trim()};
  }
  function stored(v){
    exact(v,RECORD_KEYS);
    if(v.schemaVersion!==1||!Number.isSafeInteger(v.revision)||v.revision<1||v.revision>=Number.MAX_SAFE_INTEGER)throw Error(schemaMessage);
    const source=sourceShape(v.source),quoteId=id(v.quoteId),createdAt=iso(v.createdAt),updatedAt=iso(v.updatedAt);
    if(source.quoteId!==quoteId||createdAt>updatedAt)throw Error(schemaMessage);
    return {schemaVersion:1,quoteId,revision:v.revision,source,form:formShape(v.form),createdAt,updatedAt};
  }
  function openDb(){
    return new Promise((resolve,reject)=>{
      let req,settled=false;
      const fail=message=>{if(!settled){settled=true;reject(Error(message));}};
      try{req=root.indexedDB.open(DATABASE,1);}catch{fail('浏览器不允许保存本机立项资料。');return;}
      req.onupgradeneeded=e=>{
        if(settled||e.oldVersion!==0||req.result.objectStoreNames.length){req.transaction.abort();return;}
        req.result.createObjectStore(STORE,{keyPath:'quoteId'});
      };
      req.onblocked=()=>fail('立项资料库被其他标签页占用，请关闭旧页面后重试。');
      req.onerror=()=>fail(req.error?.name==='VersionError'?schemaMessage:'无法打开本机立项资料库。');
      req.onsuccess=()=>{
        const db=req.result;
        if(settled){db.close();return;}
        try{
          if(db.objectStoreNames.length!==1||!db.objectStoreNames.contains(STORE))throw Error();
          const s=db.transaction(STORE).objectStore(STORE);
          if(s.keyPath!=='quoteId'||s.autoIncrement||s.indexNames.length)throw Error();
          db.onversionchange=()=>db.close();settled=true;resolve(db);
        }catch{db.close();fail(schemaMessage);}
      };
    });
  }
  function read(db,operation){
    return new Promise((resolve,reject)=>{
      let t,r;
      try{t=db.transaction(STORE,'readonly');r=operation(t.objectStore(STORE));}catch{reject(Error('无法读取本机立项资料。'));return;}
      t.oncomplete=()=>resolve(r.result);
      t.onabort=()=>reject(Error('无法读取本机立项资料。'));
    });
  }
  function commit(db,source,form,expected){
    return new Promise((resolve,reject)=>{
      let t,result,reason;
      try{t=db.transaction(STORE,'readwrite');}catch{reject(Error('无法保存本机立项资料。'));return;}
      const s=t.objectStore(STORE);
      const abort=e=>{reason=e;try{t.abort();}catch{}};
      t.onabort=()=>reject(reason||root.SaveFeedback?.storageError(t.error,'本机立项资料写入失败，原立项资料保留。')||Error('保存未完成，原立项资料保留。'));
      t.oncomplete=()=>resolve(result);
      const r=s.get(source.quoteId);
      r.onsuccess=()=>{
        try{
          const old=r.result===undefined?null:stored(r.result);
          if((old?.revision||0)!==expected)throw Error(staleMessage);
          const now=new Date().toISOString();
          result=stored({schemaVersion:1,quoteId:source.quoteId,revision:expected+1,source,form,
            createdAt:old?.createdAt||now,updatedAt:old?.updatedAt&&old.updatedAt>now?old.updatedAt:now});
          if(old){s.put(result);return;}
          const count=s.count();
          count.onsuccess=()=>{if(count.result>=MAX_PROJECTS)abort(Error('本机立项记录已达 500 条上限，未新增。'));else s.add(result);};
        }catch(e){abort(e);}
      };
    });
  }
  function today(){
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Shanghai'}).formatToParts().map(x=>[x.type,x.value]));
    return p.year+'-'+p.month+'-'+p.day;
  }
  async function createManual({customerName,projectName}){
    const source=sourceShape({origin:'manual',quoteId:root.crypto.randomUUID(),wonEventNo:null,wonAt:null,
      customerName:customerName.trim(),projectName:projectName.trim(),issuer:'',firmName:'',auditYear:null,
      quoteDate:'',totalCents:null,projectType:''});
    const db=await openDb();
    try{return await commit(db,source,{projectName:source.projectName,initiationDate:today(),manager:'',notes:''},0);}
    finally{db.close();}
  }
  function money(cents){
    if(cents===null)return '待填写';
    const n=BigInt(cents),whole=String(n/100n).replace(/\B(?=(\d{3})+(?!\d))/g,',');
    return '¥ '+whole+'.'+String(n%100n).padStart(2,'0');
  }
  function companyInitials(name){
    if(typeof root.pinyinPro?.pinyin!=='function')throw Error('拼音组件未加载，请刷新后重试。');
    const converted=root.pinyinPro.pinyin(name.normalize('NFKC'),{pattern:'first',toneType:'none',type:'array',nonZh:'consecutive'});
    if(converted.some(part=>/\p{Script=Han}/u.test(part)))throw Error('单位名称含暂无法转换的汉字，请核对后重试。');
    const initials=converted.flatMap(part=>(part.normalize('NFD').replace(/\p{M}/gu,'').match(/[a-z]+|\d+/giu)||[])
      .map(token=>/^\d/u.test(token)?token:token[0])).join('').toUpperCase();
    if(!initials)throw Error('请先填写被审计单位名称。');
    return initials;
  }
  function projectInformationDocument(groups,values,projectName,number){
    const layouts=root.QuoteLayouts;
    if(!layouts?.packOfficeParts)throw Error('Word 下载组件未加载，请刷新后重试。');
    const xml='<?xml version="1.0" encoding="UTF-8"?>';
    const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const escape=value=>String(value??'').toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu,'')
      .replace(/[&<>"']/gu,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
    function paragraph(value,{size=22,bold=false,center=false}={}){
      const text=String(value??'').split(/\r\n?|\n/u).map(line=>'<w:t xml:space="preserve">'+escape(line)+'</w:t>').join('<w:br/>');
      return '<w:p><w:pPr>'+(center?'<w:jc w:val="center"/>':'')+'</w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="宋体"/>'+
        (bold?'<w:b/>':'')+'<w:sz w:val="'+size+'"/></w:rPr>'+text+'</w:r></w:p>';
    }
    function cell(text,width,heading=false){
      return '<w:tc><w:tcPr><w:tcW w:w="'+width+'" w:type="dxa"/>'+
        (heading?'<w:shd w:fill="EDF4EF"/>':'')+'</w:tcPr>'+paragraph(text,{bold:heading})+'</w:tc>';
    }
    const border='<w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(side=>'<w:'+side+' w:val="single" w:sz="4" w:color="CBD8D0"/>').join('')+'</w:tblBorders>';
    const content=groups.map(({title,items})=>paragraph(title,{size:24,bold:true})+
      '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>'+border+'</w:tblPr><w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="6500"/></w:tblGrid>'+
      items.map(([key,label])=>'<w:tr><w:trPr><w:cantSplit/></w:trPr>'+cell(label,2500,true)+cell(values[key],6500)+'</w:tr>').join('')+'</w:tbl>').join('');
    const document=xml+'<w:document xmlns:w="'+ns+'"><w:body>'+paragraph('立项信息表',{size:36,bold:true,center:true})+
      paragraph(projectName,{size:26,bold:true})+paragraph('项目编号 '+number)+content+
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="980" w:right="1180" w:bottom="980" w:left="1180"/></w:sectPr></w:body></w:document>';
    const bytes=layouts.packOfficeParts({
      'word/document.xml':document,
      '_rels/.rels':xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      '[Content_Types].xml':xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    });
    return new root.Blob([bytes],{type:layouts.docxMime});
  }
  function mount(container,{lookup,listWon,onBack,onOpenDetails,onCheckpoint,onCommitted,summaryClearButton,summaryNewButton,summaryExportButton,summaryRecords=(records=>records),projectNameForDisplay=(name=>name)}={}){
    if(!container?.ownerDocument||typeof lookup!=='function')throw Error('立项入口未就绪。');
    const doc=container.ownerDocument;
    const el=(tag,content,cls)=>{const x=doc.createElement(tag);if(content!==undefined)x.textContent=content;if(cls)x.className=cls;return x;};
    const btn=(content,cls='btn')=>{const x=el('button',content,cls);x.type='button';return x;};
    const box=el('div',undefined,'pi-root'),status=el('p',undefined,'pi-status'),content=el('div');
    status.id='project-init-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    box.append(status,content);container.replaceChildren(box);
    let dbPromise,serial=0,editor=null,register=null,contract=null,detailsEditor=null;
    const useSummary=typeof onOpenDetails==='function'&&!!root.ProjectWorkspaceStore;
    const summaryFilters=new Map();
    if(useSummary&&summaryNewButton){
      const dialog=el('dialog',undefined,'pi-download-dialog'),form=el('form'),title=el('h2','新增项目');
      const fields=el('div',undefined,'fields pi-fields'),actions=el('div',undefined,'pi-form-actions'),error=el('p',undefined,'error');
      const cancel=btn('取消'),create=btn('新增并填写立项信息','btn primary'),inputs={};
      title.id='project-summary-new-title';dialog.setAttribute('aria-labelledby',title.id);
      for(const [key,label,limit] of [['customerName','被审计单位',200],['projectName','项目名称',300]]){
        const wrapper=el('label',label),input=el('input');input.type='text';input.required=true;input.maxLength=limit;
        inputs[key]=input;wrapper.append(input);fields.append(wrapper);
      }
      let busy=false;
      error.setAttribute('role','alert');create.type='submit';actions.append(cancel,create);
      form.append(title,fields,error,actions);dialog.append(form);box.append(dialog);
      cancel.onclick=()=>dialog.close();
      dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
      summaryNewButton.onclick=()=>{if(!busy&&!summaryNewButton.hidden){form.reset();error.textContent='';dialog.showModal();}};
      form.onsubmit=async event=>{
        event.preventDefault();if(busy||!dialog.open)return;
        busy=true;cancel.disabled=create.disabled=true;error.textContent='';
        let record;
        try{record=await createManual(Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value])));}
        catch(problem){error.textContent=root.SaveFeedback?.reason(problem)||problem.message||'新增项目失败。';}
        finally{busy=false;cancel.disabled=create.disabled=false;}
        if(record){
          dialog.close();
          summaryFilters.clear();
          try{await onOpenDetails(record.quoteId);}
          catch(problem){message('项目已新增，打开立项信息表失败。'+(problem.message||''),true);}
        }
      };
    }
    function clearRegister(){register?.destroy();register=null;contract?.destroy?.();contract=null;}
    function db(){return dbPromise||(dbPromise=openDb().catch(e=>{dbPromise=null;throw e;}));}
    function message(value='',error=false){status.textContent=value;status.classList.toggle('error',error);}
    function permit(){
      if(detailsEditor&&!detailsEditor.canLeave())return false;
      if(register?.canLeave&&!register.canLeave())return false;
      if(contract?.canLeave&&!contract.canLeave())return false;
      if(editor?.saving)return false;
      if(!editor||editor.fields.every(x=>x.value===editor.initial[x.name]))return true;
      return typeof root.confirm!=='function'||root.confirm('立项信息有未保存的修改，确定离开此表？');
    }
    function row(list,source,record){
      const item=el('li',undefined,'pi-row'),info=el('div'),name=record?.form.projectName||source.projectName;
      info.append(el('strong',name),el('p',[source.issuer||'发标单位未填',source.firmName||'投标事务所未填',record?'立项日期：'+record.form.initiationDate:'报价参考：'+money(source.totalCents)].join(' · '),'muted'));
      const b=btn(record?'查看立项信息':'填写立项信息表',record?'btn':'btn primary');b.dataset.projectOpen=source.quoteId;
      b.onclick=()=>{void open(source.quoteId);};item.append(info,b);list.append(item);
    }
    function quotedAuditees(source,entry){
      return entry?.snapshot?.quoteRows?.map(row=>row.name).join('、') || entry?.snapshot?.auditees?.join('、') || source.customerName;
    }
    function initiationComplete(workspace,record,type){
      const details=workspace?.projectInitiationDetails;
      if(!details)return false;
      const filled=value=>typeof value==='string'&&value.trim().length>0;
      const {manager,reviewer,riskLevel}=workspace.projectRegister||{},S=root.ProjectWorkspaceStore;
      return [...Object.keys(S.INITIATION_FIELDS),...Object.keys(S.INITIATION_OPTIONAL_FIELDS)].every(key=>filled(details[key]))&&
        filled(type)&&filled(riskLevel)&&filled(manager??record.form.manager)&&filled(reviewer)&&
        Number.isSafeInteger(workspace.amountCents)&&workspace.amountCents>=0&&
        filled(workspace.projectInvoice?.information)&&!!workspace.signedContract?.blob;
    }
    async function renderSummary(host,records,entries,ticket){
      const S=root.ProjectWorkspaceStore;
      const workspaces=await Promise.allSettled(records.map(record=>S.get(record.quoteId)));
      if(ticket!==serial)return false;
      const scroll=el('div',undefined,'table-scroll pi-summary-scroll'),table=el('table',undefined,'pi-summary-table');
      scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','项目汇总表');
      const head=el('thead'),headRow=el('tr'),body=el('tbody');
      const columns=[['被审计单位','company'],['项目类型','type'],['立项状态','initiationStatus'],['风险等级','riskLevel'],['项目含税金额','amountCents'],
        ['是否完结','completed'],['是否归档','archived'],['项目经理','manager'],['确认人','confirmedBy']];
      const actions=[['contract','下载合同'],['report','下载报告'],['materials','下载原始资料'],['workpapers','下载底稿']];
      const downloads=new Set();
      const projects=[];
      let amountsReadable=true;
      for(const [index,record] of records.entries()){
        const {quoteId,source}=record,entry=entries.get(quoteId),workspace=workspaces[index].value;
        const progress=workspace?.auditWorkflow;
        const lifecycle=workspace?.projectLifecycle?.status;
        const completed=progress?.completed || (lifecycle==='已完成'?'是':lifecycle==='进行中'?'否':'');
        const company=workspace?.projectInitiationDetails?.companyName??quotedAuditees(source,entry);
        const type=workspace?.projectClassification?.projectType??source.projectType;
        const initiationStatus=initiationComplete(workspace,record,type)?'已完成':'立项中';
        const riskLevel=workspace?.projectRegister?.riskLevel??entry?.snapshot.riskLevel;
        const manager=workspace?.projectRegister?.manager??record.form.manager;
        let price;
        if(workspace){
          try{price=S.projectAmount(source,workspace,entry);}
          catch{amountsReadable=false;}
        }
        const projectNumber=S.projectCode(workspace?.projectIdentity,riskLevel,type);
        projects.push({quoteId,projectNumber,number:index+1,initiationStatus,company,type:S.projectTypeLabel(type),riskLevel,amountCents:price?.amountCents,amountOrigin:price?.origin,
          completed,archived:progress?.archived,manager,confirmedBy:progress?.confirmedBy});
      }
      const clear=summaryClearButton||btn('清空筛选');
      const exportButton=summaryExportButton||btn('导出');
      let exporting=false;
      const filterValue=value=>value===null||value===undefined||value===''?'—':String(value);
      const display=(key,value)=>key==='amountCents'&&value!=='—'?money(value):value;
      const filtersUI=root.WorkspaceTableFilters.create(scroll,summaryFilters,renderRows);
      for(const [name,key] of [['序号'],['项目编号'],...columns]){
        const cell=el('th');cell.scope='col';cell.append(el('span',name));headRow.append(cell);
        if(!key)continue;
        cell.dataset.projectColumn=key;
        const values=new Set(projects.map(project=>filterValue(project[key])));
        if(summaryFilters.has(key))values.add(summaryFilters.get(key));
        const choices=[...values].sort((a,b)=>key==='amountCents'&&a!=='—'&&b!=='—'?
          Number(a)-Number(b):a.localeCompare(b,'zh-CN',{numeric:true}))
          .map(value=>[value,value==='—'?'未填写':display(key,value)]);
        cell.append(filtersUI.add(name,key,choices,['company','manager','confirmedBy'].includes(key)));
      }
      for(const [,label] of actions){
        const th=el('th');th.scope='col';th.append(el('span',label));headRow.append(th);
      }
      head.append(headRow);table.append(head,body);scroll.append(table);
      const current=()=>ticket===serial&&host.isConnected&&!host.closest('[hidden]');
      const filteredProjects=()=>projects.filter(project=>[...summaryFilters].every(([key,value])=>filterValue(project[key])===value));
      exportButton.onclick=async()=>{
        if(!current()||exporting)return;
        const visible=filteredProjects();
        if(!visible.length){root.SaveFeedback?.exportFailed('当前筛选范围没有可导出的项目。');return;}
        exporting=true;exportButton.disabled=true;
        message('正在导出项目汇总表…');
        try{
          if(!root.LedgerStandard?.workbook)throw Error('表格导出组件尚未加载，请刷新后重试。');
          const fields=columns.map(([,key])=>key),amountIndex=fields.indexOf('amountCents')+2;
          const total=visible.reduce((sum,project)=>sum+BigInt(project.amountCents??0),0n);
          const footer=Array(fields.length+2).fill(null);
          footer[0]='合计（'+visible.length+' 条）';
          if(visible.some(project=>Number.isSafeInteger(project.amountCents))){
            footer[amountIndex]=total<=BigInt(Number.MAX_SAFE_INTEGER)?Number(total)/100:
              (total/100n).toString()+'.'+(total%100n).toString().padStart(2,'0');
          }
          const bytes=await root.LedgerStandard.workbook([{
            name:'项目汇总表',columns:['序号','项目编号',...columns.map(([label])=>label)],
            rows:visible.map(project=>[project.number,project.projectNumber,...fields.map(key=>
              key==='amountCents'?Number.isSafeInteger(project[key])?project[key]/100:null:project[key]??'')]),
            footer,widths:{1:40,2:34,3:23},decimalColumns:[amountIndex]
          }]);
          if(!current())return;
          S.download(new root.Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'项目汇总表.xlsx');
          const result='已导出 '+visible.length+' 条项目记录。';
          message(result);root.SaveFeedback?.exported(result);
        }catch(error){if(current())message(root.SaveFeedback?.exportFailed(error)||error.message||'项目汇总表导出失败。',true);}
        finally{exporting=false;if(current())exportButton.disabled=false;}
      };
      function downloadCell(project,kind,label){
        const cell=el('td',undefined,'pi-download-cell'),button=btn(label);
        button.dataset.projectDownload=kind;cell.append(button);
        button.onclick=async()=>{
          const key=project.quoteId+'/'+kind;
          if(downloads.has(key)||!current())return;
          const assertContext=()=>{if(!current())throw Error('已离开项目汇总表，请重新选择项目。');};
          downloads.add(key);button.disabled=true;button.textContent='正在下载…';
          try{
            if(!root.ProjectDownloads?.download)throw Error('项目下载组件尚未加载，请刷新后重试。');
            await root.ProjectDownloads.download(project.quoteId,kind,assertContext);
            if(current())message('已下载'+label.slice(2)+'。');
          }catch(error){if(current())message(error.message||'下载失败，请重试。',true);}
          finally{downloads.delete(key);button.disabled=false;button.textContent=label;}
        };
        return cell;
      }
      function renderRows(){
        const visible=filteredProjects();
        const rows=visible.map(project=>{
          const {quoteId,number,projectNumber}=project,row=el('tr'),code=el('td'),link=el('a',projectNumber);
          row.dataset.projectRegisterId=quoteId;
          code.dataset.projectInternalId=quoteId;code.title='项目编号 '+quoteId;
          link.href='#project-initiation';link.title='查看立项信息表';
          link.onclick=event=>{event.preventDefault();void onOpenDetails(quoteId);};
          code.append(link);row.append(el('td',String(number)),code);
          for(const [,key] of columns){
            const cell=el('td',display(key,filterValue(project[key])));
            cell.dataset.projectColumn=key;
            if(key==='amountCents'&&project.amountOrigin)cell.title=project.amountOrigin;
            row.append(cell);
          }
          for(const [kind,label] of actions)row.append(downloadCell(project,kind,label));
          return row;
        });
        if(!rows.length){
          const row=el('tr'),cell=el('td',projects.length?'没有符合查询条件的项目。':'暂无已立项项目。','pi-summary-empty');
          cell.colSpan=headRow.cells.length;row.append(cell);rows.push(row);
        }
        clear.disabled=!summaryFilters.size;
        exportButton.disabled=exporting;
        filtersUI.sync();
        body.replaceChildren(...rows);
      }
      clear.onclick=()=>{filtersUI.close();summaryFilters.clear();renderRows();};
      renderRows();host.replaceChildren(scroll,filtersUI.menu);
      if(!summaryClearButton||!summaryExportButton){
        const toolbar=el('div',undefined,'pi-summary-tools');
        if(!summaryClearButton)toolbar.append(clear);
        if(!summaryExportButton)toolbar.append(exportButton);
        host.prepend(toolbar);
      }
      return amountsReadable&&workspaces.every(result=>result.status==='fulfilled');
    }
    async function show({leaveApproved=false}={}){
      if(!leaveApproved&&!permit())return false;
      if(useSummary&&summaryClearButton)summaryClearButton.disabled=true;
      if(useSummary&&summaryExportButton)summaryExportButton.disabled=true;
      const ticket=++serial;clearRegister();editor=null;detailsEditor=null;contract=null;message('正在读取本机立项信息…');
      const panel=el('section',undefined,useSummary?'panel pi-summary':'panel pi-list');
      if(!useSummary){
        const head=el('div',undefined,'pi-head');
        head.append(el('h2','项目立项'));panel.append(head,el('p','中标结果自动生成项目，可进入填写负责人、最终中标价并上传本项目合同模板。资料仅存当前浏览器。','muted'));
      }
      const lists=el('div');lists.id='project-init-list';panel.append(lists);content.replaceChildren(panel);
      let autoError='';
      const [available]=await Promise.allSettled([typeof listWon==='function'?Promise.resolve().then(listWon):Promise.resolve([])]);
      if((useSummary||root.ProjectRegister)&&available.status==='fulfilled'&&Array.isArray(available.value)){
        try{for(const raw of available.value){const e=raw?.entry||raw;if(e?.events?.at(-1)?.outcome==='won')await ensureWon(e);}}catch(e){autoError='自动生成项目未完成：'+e.message;}
      }
      const [saved]=await Promise.allSettled([db().then(d=>read(d,s=>s.getAll(undefined,MAX_PROJECTS+1))).then(all=>{if(all.length>MAX_PROJECTS)throw Error(schemaMessage);return all.map(stored);})]);
      if(ticket!==serial)return false;
      if(saved.status!=='fulfilled'){message(saved.reason?.message||'无法读取本机立项信息。',true);return false;}
      const records=saved.value.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),savedIds=new Set(records.map(x=>x.quoteId));
      const entries=new Map();
      if(available.status==='fulfilled'&&Array.isArray(available.value)){
        for(const raw of available.value){const entry=raw?.entry||raw;if(entry?.id)entries.set(entry.id,entry);}
      }
      if((useSummary||root.ProjectRegister)&&root.ProjectWorkspaceStore?.ensureProjectNumbers){
        try{
          const candidates=[];
          for(const record of records){
            const first=entries.get(record.quoteId)?.events?.find(event=>event.outcome==='won');
            candidates.push({projectId:record.quoteId,firstWonAt:first?.recordedAt??record.source.wonAt??record.createdAt});
          }
          await root.ProjectWorkspaceStore.ensureProjectNumbers(candidates,records.map(record=>record.quoteId));
        }catch(error){if(!useSummary)autoError='固定项目编号待核对：'+error.message;}
        if(ticket!==serial)return false;
      }
      if(useSummary){
        const complete=await renderSummary(lists,summaryRecords(records,entries),entries,ticket);
        if(ticket!==serial)return false;
        const error=autoError||(!complete?'部分项目资料暂无法读取。':available.status==='rejected'?'暂无法核对报价来源，已保存项目仍可查看。':'');
        message(error,!!error);
        return true;
      }
      if(root.ProjectRegister){
        panel.querySelector('h2').textContent='项目汇总表';
        panel.querySelector('p.muted').textContent='编号年度按首次中标登记的北京时间，同年四位顺序固定不复用；风险或八类项目类型未填显示待补齐，非年审类型仅作项目分类、不套用年审计算规则。人工修改请保存本行，资料仅存当前浏览器。';
        register=root.ProjectRegister.mount(lists,{records,entries:available.status==='fulfilled'?available.value:[],lookup,onOpen:open,isCurrent:()=>ticket===serial,projectNameForDisplay});
        message(autoError||(available.status==='rejected'?'暂无法读取报价结果；已保存项目仍保留，无法核对的项目仅供查看。':''),!!autoError||available.status==='rejected');return true;
      }
      const candidates=[];
      if(available.status==='fulfilled'&&Array.isArray(available.value)){
        for(const raw of available.value){
          const e=raw?.entry||raw;
          if(e?.events?.at(-1)?.outcome==='won'&&!savedIds.has(e.id)){
            try{candidates.push(sourceOf(e,e.id));}catch{}
          }
        }
      }
      function group(title,empty,items,paint){
        const heading=el('h3',title),ul=el('ul',undefined,'pi-list-items');lists.append(heading,ul);
        if(!items.length)ul.append(el('li',empty,'pi-empty muted'));
        else for(const item of items)paint(ul,item);
      }
      group('待填写的中标报价','暂无待填写的中标报价。可前往报价历史登记中标结果。',candidates,(ul,x)=>row(ul,x));
      group('已保存的立项信息','本机暂无已保存的立项信息。',records,(ul,x)=>row(ul,x.source,x));
      message(available.status==='rejected'?'暂无法读取中标报价；已保存的立项信息仍可查看。':'',available.status==='rejected');
      return true;
    }
    function renderForm(ticket,source,record,readOnlyReason){
      const panel=el('section',undefined,'panel pi-editor'),head=el('div',undefined,'pi-head');
      const list=btn('返回立项列表');list.onclick=()=>{void show();};
      head.append(el('h2','立项信息表'),list);panel.append(head);
      const details=el('dl',undefined,'pi-source');details.id='project-init-source';
      for(const [label,value] of [['来源报价项目',source.projectName],['发标单位',source.issuer],['被审计单位',source.customerName],['投标事务所',source.firmName],
        ['审计年度',source.auditYear+' 年'],['项目类型',source.projectType],['报价日期',source.quoteDate],['来源报价金额（参考）',money(source.totalCents)],['来源报价编号',source.quoteId]]){
        const wrap=el('div');wrap.append(el('dt',label),el('dd',value||'—'));details.append(wrap);
      }
      panel.append(el('p','以下信息来自报价历史，仅供参考，不会改写报价记录或代替合同金额。','muted'),details);
      const form=el('form'),grid=el('div',undefined,'fields pi-fields');form.id='project-init-form';if(!readOnlyReason)form.dataset.activityProjectId=source.quoteId;
      const values=record?.form||{projectName:source.projectName,initiationDate:today(),manager:'',notes:''};
      const fields=[];
      for(const [name,label,type,max,required] of [['projectName','项目名称','text',300,true],['initiationDate','立项日期','date',0,true],['manager','项目负责人（选填）','text',100,false],['notes','项目说明（选填）','textarea',2000,false]]){
        const x=el(type==='textarea'?'textarea':'input'),l=el('label',label);x.id='project-init-'+name;l.htmlFor=x.id;x.name=name;x.value=values[name];x.required=required;
        if(type==='textarea'){x.rows=4;l.classList.add('pi-wide');}else x.type=type;
        if(max)x.maxLength=max;if(readOnlyReason)x.readOnly=true;
        l.append(x);fields.push(x);grid.append(l);
      }
      const foot=el('div',undefined,'pi-form-actions'),save=btn('保存立项信息','btn primary');save.type='submit';save.id='project-init-save';save.disabled=!!readOnlyReason;
      foot.append(save,el('p','仅登记本机立项信息。最终中标价和合同模板在下方单独保存，不会改写原报价；人员指派、差旅费暂不自动办理。','muted'));
      form.append(grid,foot);panel.append(form);content.replaceChildren(panel);if(root.ProjectContract)contract=root.ProjectContract.mount(panel,source,{readOnly:!!readOnlyReason});
      const state={source,readOnly:!!readOnlyReason,initial:{...values},fields,saving:false,revision:record?.revision||0};editor=state;
      state.savePending=async()=>{
        if(state.saving||readOnlyReason||ticket!==serial)return false;
        let formValue;
        try{formValue=formShape(Object.fromEntries(fields.map(x=>[x.name,x.value])));}catch(e){message(root.SaveFeedback?.failed(e,'立项信息有误。')||e?.message||'立项信息有误。',true);return false;}
        state.saving=true;save.disabled=true;for(const x of fields)x.disabled=true;message('正在核对中标状态并保存…');
        try{
          const d=await db(),now=sourceOf(await lookup(source.quoteId),source.quoteId);
          if(JSON.stringify(now)!==JSON.stringify(source))throw Error('中标结果或来源报价已变化，请重新打开立项表核对，当前输入尚未保存。');
          if(ticket!==serial)return;
          const next=await commit(d,now,formValue,state.revision);
          if(ticket!==serial)return;
          state.revision=next.revision;state.initial={...next.form};for(const x of fields)x.value=next.form[x.name];
          const feedback='立项信息已保存（本机，第 '+next.revision+' 版）。报价记录未修改。';message(root.SaveFeedback?.saved(feedback)??(feedback));return true;
        }catch(e){if(ticket===serial)message(root.SaveFeedback?.failed(e,'立项保存未完成。')||e?.message||'立项保存未完成。',true);return false;}
        finally{state.saving=false;if(ticket===serial){save.disabled=false;for(const x of fields)x.disabled=false;}}
      };
      root.SaveFeedback?.invalid(form,message);
      form.onsubmit=e=>{e.preventDefault();void state.savePending();};
      message(readOnlyReason||(record?'已读取本机保存的立项信息（第 '+record.revision+' 版）。':'立项信息待填写。点击「保存立项信息」才会新增记录。'),!!readOnlyReason);
    }
    async function open(quoteId){
      // The normal app uses the approved all-project register, not the legacy card editor.
      if(root.ProjectRegister){
        try{id(quoteId);}catch(e){message(e.message,true);return false;}
        if(register?.focusProject?.(quoteId))return true;
        if(!await show())return false;
        if(register?.focusProject?.(quoteId))return true;
        message('未找到对应的已立项项目；登记表及原资料保留，请核对中标结果。',true);return false;
      }
      if(!permit())return false;
      const ticket=++serial;clearRegister();editor=null;contract=null;message('正在核对中标报价…');
      content.replaceChildren();
      try{
        id(quoteId);
        const [saved,live]=await Promise.allSettled([db().then(d=>read(d,s=>s.get(quoteId))),Promise.resolve().then(()=>lookup(quoteId)).then(x=>sourceOf(x,quoteId))]);
        if(ticket!==serial)return false;
        if(saved.status==='rejected')throw saved.reason;
        const record=saved.value===undefined?null:stored(saved.value);
        if(live.status==='rejected'){
          if(!record)throw live.reason;
          renderForm(ticket,record.source,record,'当前中标结果无法核对或已更正；仅展示此前保存的立项信息，不允许继续编辑。');return true;
        }
        const source=live.value;
        if(record){
          const prior={...record.source,wonEventNo:source.wonEventNo,wonAt:source.wonAt};
          if(JSON.stringify(prior)!==JSON.stringify(source)){
            renderForm(ticket,record.source,record,'来源报价信息已变化；此前保存的立项信息仅供查看。');return true;
          }
        }
        renderForm(ticket,source,record,'');return true;
      }catch(e){
        if(ticket!==serial)return false;
        message(e?.message||'立项信息表未能打开。',true);
        const panel=el('section',undefined,'panel pi-list'),b=btn('返回立项列表');b.onclick=()=>{void show();};
        panel.append(b);content.replaceChildren(panel);return false;
      }
    }
    async function openDetails(quoteId,{onBack:backToQuote=onBack,backLabel='返回招投标'}={}){
      if(detailsEditor?.scope.projectId===quoteId)return true;
      if(!permit())return false;
      const ticket=++serial;
      clearRegister();editor=null;detailsEditor=null;
      message('正在读取立项资料…');content.replaceChildren();
      const S=root.ProjectWorkspaceStore,back=btn(backLabel);
      back.onclick=()=>backToQuote?.();
      try{
        let entry,source,record,readOnlyReason='';
        const savedRecord=await db().then(d=>read(d,store=>store.get(id(quoteId))));
        const initialRecord=savedRecord?stored(savedRecord):null,manual=initialRecord?.source.origin==='manual';
        if(manual){
          record=initialRecord;source=record.source;
        }else try{
          const live=await lookup(quoteId);entry=live?.entry||live;
          source=sourceOf(entry,quoteId);
          record=await ensureWon(entry);
        }catch(error){
          if(!initialRecord)throw error;
          record=initialRecord;source=record.source;
          readOnlyReason='中标来源当前不可核对，已打开保存的立项信息供查看。';
        }
        if(entry?.id!==quoteId)entry=null;
        let workspace=await S.get(quoteId);
        if(manual&&!workspace.projectIdentity&&S.ensureProjectNumbers){
          try{
            await S.ensureProjectNumbers([{projectId:quoteId,firstWonAt:record.createdAt}]);
            workspace=await S.get(quoteId);
          }catch{}
        }
        if(ticket!==serial)return false;
        const frozen=JSON.stringify(source);
        const saved=workspace.projectInitiationDetails;
        if(saved)S.initiationDetails(saved);
        const quote=entry?.snapshot||{};
        const taxRates=['1','3','6'];
        const normalizeTaxRate=value=>value.replace(/^0*([136])(?:\.0{1,2})?$/u,'$1');
        const rate=/^\s*(\d{1,3}(?:\.\d{1,2})?)\s*%/.exec(quote.taxRateText||'');
        const quoteCents=readOnlyReason?workspace.amountCents??source.totalCents:S.projectAmount(source,workspace,entry).amountCents;
        const amountText=cents=>Number.isSafeInteger(cents)?money(cents).replace(/[^\d.]/g,''):'';
        const imported={companyName:quotedAuditees(source,entry),contactName:quote.contactName||'',contactInfo:quote.contactInfo||'',
          engagementFirm:quote.firmName||source.firmName,
          taxRate:rate&&Number(rate[1])<=100?normalizeTaxRate(rate[1]):'',projectType:source.projectType,riskLevel:quote.riskLevel||'',
          amount:amountText(source.totalCents)};
        const locked=new Map(readOnlyReason||manual?[]:Object.entries(imported).filter(([,value])=>value?.trim()));
        const values={...imported,...(saved||{}),
          riskLevel:workspace.projectRegister?.riskLevel??quote.riskLevel??'',
          manager:workspace.projectRegister?.manager??record.form.manager,reviewer:workspace.projectRegister?.reviewer??'',
          projectType:workspace.projectClassification?.projectType??source.projectType,
          amount:amountText(quoteCents),invoice:workspace.projectInvoice?.information||'',...Object.fromEntries(locked)};
        values.taxRate=normalizeTaxRate(values.taxRate);
        const panel=el('section',undefined,'panel pi-editor pi-detail'),head=el('div',undefined,'pi-head'),form=el('form');
        const meta=el('p',undefined,'pi-project-meta');
        meta.append(el('strong',projectNameForDisplay(source.projectName)||'项目名称待填写'),el('code',manual?'手工新增':quoteId));
        head.append(meta,back);
        if(useSummary&&root.ProjectRegister&&!manual){
          const tools=btn('登记与附件');
          tools.onclick=()=>{
            if(!permit())return;
            const toolsTicket=++serial;
            clearRegister();detailsEditor=null;
            const toolsPanel=el('section',undefined,'panel'),toolsHead=el('div',undefined,'pi-head'),registerHost=el('div');
            const closeTools=btn('返回立项信息表');
            const openForm=()=>{void openDetails(quoteId,{onBack:backToQuote,backLabel});};
            closeTools.onclick=openForm;toolsHead.append(el('h2','登记与附件'),closeTools);
            toolsPanel.append(toolsHead,registerHost);content.replaceChildren(toolsPanel);
            register=root.ProjectRegister.mount(registerHost,{records:[record],entries:entry?[entry]:[],lookup,onOpen:openForm,
              isCurrent:()=>toolsTicket===serial,projectNameForDisplay});
            message();
          };
          head.append(tools);
        }
        panel.append(head,form);form.id='project-init-form';form.dataset.activityProjectId=quoteId;
        const fields=new Map(),groups=[],yesNo=['是','否'],riskLevels=['A类','B类','C类'];
        function group(title,items){
          groups.push({title,items:items.map(([key,label])=>[key,label])});
          const fieldset=el('fieldset',undefined,'pi-detail-group'),grid=el('div',undefined,'fields pi-fields');
          fieldset.append(el('legend',title),grid);form.append(fieldset);
          for(const [key,label,type,options] of items){
            const field=el(options?'select':type==='textarea'?'textarea':'input'),wrapper=el('label',label);
            field.name=key;field.id='project-info-'+key;field.required=true;wrapper.htmlFor=field.id;
            if(options){
              const prompt=el('option','请选择');prompt.value='';prompt.disabled=true;prompt.hidden=true;field.append(prompt);
              const optionLabel=item=>key==='projectType'?S.projectTypeLabel(item):key==='taxRate'?item+'%':item;
              for(const item of options){const option=el('option',optionLabel(item));option.value=item;field.append(option);}
              if(values[key]&&!options.includes(values[key])){
                const prior=el('option',optionLabel(values[key]));prior.value=values[key];
                if(key==='taxRate')prior.disabled=prior.hidden=true;
                field.append(prior);
              }
            }else if(type==='textarea'){field.rows=3;wrapper.classList.add('pi-wide');}
            else {field.type=type==='date'?'date':'text';if(type==='decimal'||type==='numeric')field.inputMode=type;}
            const max=S.INITIATION_FIELDS[key]||S.INITIATION_OPTIONAL_FIELDS[key]||{manager:100,reviewer:100,invoice:4000,amount:24}[key];
            if(max&&!options&&type!=='date')field.maxLength=max;
            if(readOnlyReason||locked.has(key)){if(options)field.disabled=true;else field.readOnly=true;}
            if(locked.has(key))field.title='来自中标报价';
            field.value=values[key]||'';fields.set(key,field);wrapper.append(field);grid.append(wrapper);
          }
        }
        group('项目资料',[
          ['companyName','被审计单位'],['contactName','公司联系人'],['contactInfo','联系方式'],
          ['projectType','项目类型',null,S.PROJECT_TYPES],['riskLevel','风险等级',null,riskLevels],
          ['amount','项目价格（含税，元）','decimal'],['taxRate','税率（%）',null,taxRates]
        ]);
        group('人员与交付',[
          ['engagementFirm','承接事务所'],['engagementOwner','项目承接人'],['reviewer','项目复核人'],
          ['siteStart','现场开始日期','date'],['siteEnd','现场结束日期','date'],
          ['manager','项目经理'],['teamMembers','项目组成员'],['reportDate','报告出具日期','date'],['reportCopies','报告份数','numeric'],
          ['mailingAddress','邮寄地址','textarea']
        ]);
        group('选商与公司情况',[
          ['procurementMethod','选商方式',null,S.PROCUREMENT_METHODS],['regulated','是否属于受监管行业',null,yesNo],
          ['listed','是否上市',null,yesNo],['ipoPlan','是否有 IPO 计划',null,yesNo]
        ]);
        group('开票与合同',[['invoice','开票信息','textarea']]);
        const contractRow=el('div',undefined,'pi-contract-row'),fileLabel=el('label','合同上传'),file=el('input'),filename=el('span'),download=btn('下载已保存合同');
        file.type='file';file.accept='.pdf,.docx,.png,.jpg,.jpeg';file.id='project-info-contract';file.disabled=!!readOnlyReason;fileLabel.htmlFor=file.id;fileLabel.append(file);globalThis.ShenyiFileDrop?.bind(fileLabel,file,{material:'项目合同'});
        contractRow.append(fileLabel,filename,download);form.lastElementChild.append(contractRow);
        groups.at(-1).items.push(['contract','合同文件']);
        const save=btn('保存立项信息','btn primary'),draftButton=btn('暂存'),downloadForm=btn('下载立项信息表'),
          foot=el('div',undefined,'pi-form-actions'),requiredStatus=el('p',undefined,'pi-required-status');
        save.id='project-info-save';save.type='submit';draftButton.id='project-info-draft';
        requiredStatus.id='project-info-required';requiredStatus.setAttribute('role','status');
        save.setAttribute('aria-describedby',requiredStatus.id);
        downloadForm.id='project-info-download';foot.append(save,draftButton,downloadForm,requiredStatus);form.append(foot);
        const dialog=el('dialog',undefined,'pi-download-dialog'),dialogTitle=el('h2','下载立项信息表');
        const options=el('div',undefined,'pi-form-actions'),plain=btn('不加密下载'),protectedDownload=btn('加密下载'),cancel=btn('取消');
        const downloadHelp=el('p','加密下载将单位名称换成大写拼音首字母，并省略邮寄地址和开票信息。');
        const downloadStatus=el('p',undefined,'error');
        dialogTitle.id='project-info-download-title';dialog.setAttribute('aria-labelledby',dialogTitle.id);
        downloadHelp.id='project-info-download-help';dialog.setAttribute('aria-describedby',downloadHelp.id);
        downloadStatus.setAttribute('role','alert');
        options.append(plain,protectedDownload,cancel);dialog.append(dialogTitle,downloadHelp,downloadStatus,options);
        panel.append(dialog);content.replaceChildren(panel);
        const readFields=()=>Object.fromEntries([...fields].map(([key,field])=>[key,locked.get(key)??field.value]));
        let initial=readFields(),current=workspace,saving=false,drafting=false,draftContract=null;
        let checkpointed=null,checkpointedFile=null;
        const scope={kind:'project-information',projectId:quoteId};
        const dirty=()=>Object.entries(readFields()).some(([key,value])=>value!==initial[key]);
        const selectedContract=()=>file.files[0]||draftContract;
        const fieldLabels=groups.flatMap(group=>group.items);
        function missing(values){
          return fieldLabels.filter(([key])=>key==='contract'?!selectedContract()&&!current.signedContract:!values[key].trim())
            .map(([,label])=>label);
        }
        function syncForm(){
          const absent=missing(readFields());
          save.disabled=!!readOnlyReason||saving||drafting||!!absent.length;
          draftButton.disabled=!!readOnlyReason||!onCheckpoint||saving||drafting;
          file.required=!draftContract&&!current.signedContract;
          requiredStatus.textContent=!readOnlyReason&&absent.length?'待补齐 '+absent.length+' 项：'+absent.join('、')+'。可先暂存。':'';
          filename.textContent=selectedContract()?.name||current.signedContract?.name||'尚未上传合同';
          download.hidden=!current.signedContract;
        }
        function markCheckpoint(){
          checkpointed=readFields();checkpointedFile=selectedContract();syncForm();
        }
        async function prepareContract(selected){
          if(!selected.size||selected.size>12*1024*1024)throw Error('请选择 12 MiB 以内的合同文件。');
          const attachment={name:selected.name,hash:await S.hash(selected),blob:selected};
          await S.validateSignedContract(attachment);
          return attachment;
        }
        form.addEventListener('input',syncForm);
        form.addEventListener('change',syncForm);
        draftButton.onclick=async()=>{
          if(draftButton.disabled)return;
          drafting=true;syncForm();
          const selected=selectedContract(),data=readFields();
          try{
            if(await onCheckpoint(scope)&&ticket===serial&&selectedContract()===selected&&
              Object.entries(readFields()).every(([key,value])=>data[key]===value))markCheckpoint();
          }finally{drafting=false;syncForm();}
        };
        syncForm();
        download.onclick=async()=>{try{const item=current.signedContract;if(item){await S.validateSignedContract(item);S.download(item.blob,item.name);}}catch(error){message(error.message,true);}};
        downloadForm.onclick=()=>{if(!saving){downloadStatus.textContent='';dialog.showModal();}};
        cancel.onclick=()=>dialog.close();
        function exportForm(mask){
          if(ticket!==serial||saving)return;
          try{
            const data={...readFields(),contract:filename.textContent};
            data.projectType=S.projectTypeLabel(data.projectType);
            let projectName=projectNameForDisplay(source.projectName)||'',alias='';
            let rows=groups;
            if(mask){
              alias=companyInitials(data.companyName.trim());
              const names=[...new Set([data.companyName.trim(),initial.companyName.trim(),source.customerName?.trim()])]
                .filter(Boolean).sort((a,b)=>b.length-a.length);
              const redact=value=>names.reduce((text,name)=>text.replaceAll(name,alias),String(value));
              rows=groups.map(group=>({title:group.title==='开票与合同'?'合同':group.title,
                items:group.items.filter(([key])=>key!=='mailingAddress'&&key!=='invoice')}));
              for(const [key,value]of Object.entries(data))data[key]=redact(value);
              data.companyName=alias;projectName=redact(projectName);
            }
            const number=S.projectCode(current.projectIdentity,data.riskLevel,data.projectType);
            S.download(projectInformationDocument(rows,data,projectName,number),'立项信息表'+(mask?'-'+alias:'')+'.docx');
            dialog.close();
          }catch(error){downloadStatus.textContent=error.message||'立项信息表下载失败。';}
        }
        plain.onclick=()=>exportForm(false);protectedDownload.onclick=()=>exportForm(true);
        detailsEditor={
          scope,
          canLeave:()=>!saving&&!drafting&&(!dirty()&&!selectedContract()||checkpointed&&checkpointedFile===selectedContract()&&
            Object.entries(readFields()).every(([key,value])=>checkpointed[key]===value)||typeof root.confirm!=='function'||root.confirm('立项信息有未保存的修改，确定离开？')),
          async capturePending(){
            const selected=selectedContract();
            if(readOnlyReason||saving||!dirty()&&!selected)return null;
            const values={revision:current.rev,source:frozen,fields:readFields()};
            const attachment=selected?await prepareContract(selected):null;
            return {scope,values,...(attachment?{attachment}:{})};
          },
          async restorePending(draft,{attachment}={}){
            const prior=draft?.fields||{},added=['engagementFirm','engagementOwner','reviewer'];
            if(attachment)await S.validateSignedContract(attachment);
            const latest=await S.get(quoteId);
            if(ticket!==serial||readOnlyReason||dirty()||selectedContract()||saving||draft?.revision!==current.rev||draft.source!==frozen||latest.rev!==current.rev||
              Object.keys(prior).some(key=>!fields.has(key))||[...fields].some(([key,input])=>
                !Object.hasOwn(prior,key)?!added.includes(key):typeof prior[key]!=='string'||input.maxLength>0&&prior[key].length>input.maxLength))
              throw Error('立项信息的来源或版本已变化，未覆盖当前输入。');
            const draftTaxRate=normalizeTaxRate(prior.taxRate);
            if(!locked.has('taxRate')&&draftTaxRate&&draftTaxRate!==initial.taxRate&&!taxRates.includes(draftTaxRate))
              throw Error('暂存中的税率不在可选范围内，请在立项信息表选择 1%、3% 或 6%。');
            for(const [key,input] of fields)if(!locked.has(key)&&Object.hasOwn(prior,key))input.value=key==='taxRate'?draftTaxRate:prior[key];
            if(attachment)draftContract=new root.File([attachment.blob],attachment.name,{type:attachment.blob.type});
            markCheckpoint();
            return {restored:1};
          }
        };
        root.SaveFeedback?.invalid(form,message);
        form.onsubmit=async event=>{
          event.preventDefault();
          if(readOnlyReason||saving||drafting||ticket!==serial)return;
          const input=readFields(),selected=selectedContract(),absent=missing(input);
          if(absent.length){syncForm();message(root.SaveFeedback?.failed('缺少必填资料：'+absent.join('、')+'。可先暂存。')??requiredStatus.textContent,true);return;}
          saving=true;syncForm();downloadForm.disabled=file.disabled=true;for(const field of fields.values())field.disabled=true;
          try{
            const details={schemaVersion:1};
            const detailFields=[...Object.keys(S.INITIATION_FIELDS),...Object.keys(S.INITIATION_OPTIONAL_FIELDS)];
            for(const key of detailFields)details[key]=input[key].trim();
            if(details.taxRate&&details.taxRate!==initial.taxRate&&!taxRates.includes(details.taxRate))
              throw Error('请选择 1%、3% 或 6% 的税率。');
            S.initiationDetails(details);
            const amount=input.amount.trim();
            if(amount&&!/^\d+(?:\.\d{1,2})?$/.test(amount))throw Error('请填写非负项目价格，最多两位小数。');
            const cents=amount?root.QuoteCalc.money(amount):null;
            const oldRegister=current.projectRegister||{schemaVersion:1,siteTime:'',workpaperReportTime:'',preparationTime:'',preparer:'',reviewer:'',financialStatementDate:''};
            const hasSite=details.siteStart||details.siteEnd||current.projectInitiationDetails?.siteStart||current.projectInitiationDetails?.siteEnd;
            const siteTime=hasSite?[details.siteStart,details.siteEnd].filter(Boolean).join(' 至 '):oldRegister.siteTime;
            const patch={projectInitiationDetails:details,amountCents:cents,projectRegister:{...oldRegister,
              manager:input.manager.trim(),reviewer:input.reviewer.trim(),riskLevel:input.riskLevel,siteTime}};
            if(!input.projectType||S.PROJECT_TYPES.includes(input.projectType))patch.projectClassification={schemaVersion:1,projectType:input.projectType};
            if(input.invoice.trim()!==initial.invoice)patch.projectInvoice={schemaVersion:1,information:input.invoice.trim(),file:current.projectInvoice?.file||null};
            if(selected)patch.signedContract=await prepareContract(selected);
            if(manual){
              const latest=await db().then(d=>read(d,store=>store.get(quoteId)));
              if(!latest||latest.revision!==record.revision||JSON.stringify(stored(latest).source)!==frozen)throw Error(staleMessage);
            }else if(JSON.stringify(sourceOf(await lookup(quoteId),quoteId))!==frozen){
              throw Error('中标结果或来源已变化，请重新打开立项信息表。');
            }
            current=await S.save(quoteId,current.rev,patch);
            for(const [key,value] of locked)fields.get(key).value=value;
            for(const key of detailFields)fields.get(key).value=details[key];
            fields.get('manager').value=patch.projectRegister.manager;fields.get('reviewer').value=patch.projectRegister.reviewer;
            fields.get('invoice').value=input.invoice.trim();
            file.value='';draftContract=checkpointed=checkpointedFile=null;initial=readFields();
            const draftCleared=await onCommitted?.(scope);
            const result=draftCleared===false?'立项信息已保存。另有其他窗口更新的暂存，请另行核对。':'立项信息已保存。';
            message(root.SaveFeedback?.saved(result)??result);
          }catch(error){message(root.SaveFeedback?.failed(error,'立项信息未保存。')||error?.message||'立项信息未保存。',true);}
          finally{
            saving=false;downloadForm.disabled=file.disabled=false;
            for(const [key,field] of fields)field.disabled=field.tagName==='SELECT'&&locked.has(key);
            syncForm();
          }
        };
        message(readOnlyReason);return true;
      }catch(error){
        if(ticket!==serial)return false;
        message(error.message||'立项信息表未能打开。',true);content.replaceChildren(back);return false;
      }
    }
    function capturePending(){if(detailsEditor)return detailsEditor.capturePending();if(register)return register.capturePending();const pendingEditor=editor&&!editor.readOnly&&editor.fields.some(x=>x.value!==editor.initial[x.name])?{revision:editor.revision,source:JSON.stringify(editor.source),fields:Object.fromEntries(editor.fields.map(x=>[x.name,x.value]))}:null,pendingContract=contract?.capturePending?.();return pendingEditor||pendingContract?{scope:{kind:'project-initiation',projectId:editor?.source.quoteId},values:{schemaVersion:1,editor:pendingEditor,contract:pendingContract||null}}:null;}
    async function restorePending(values,{scope}={}){if(scope?.kind==='project-register'){if(!register)await show();return register.restorePending(values,{scope});}if(scope?.kind!=='project-initiation'||values?.schemaVersion!==1||!scope.projectId)throw Error('立项暂存范围无效。');if(root.ProjectRegister){if(!register)await show();throw Error('旧单项目页面的临时内容仍保留，未跨格式覆盖；当前使用原项目登记表，请核对原暂存。');}if(editor?.source.quoteId!==scope.projectId)await open(scope.projectId);if(!editor||editor.readOnly||editor.saving)throw Error('暂存项目当前不可编辑，原暂存保留。');if(values.editor){const v=values.editor;if(v.revision!==editor.revision||v.source!==JSON.stringify(editor.source)||!v.fields||Object.keys(v.fields).length!==FORM_KEYS.length||editor.fields.some(x=>typeof v.fields[x.name]!=='string'||v.fields[x.name].length>({projectName:300,initiationDate:10,manager:100,notes:2000}[x.name])||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v.fields[x.name])))throw Error('立项暂存字段或版本已变化，未回填。');}if(values.contract)await contract.restorePending(values.contract.values,{scope:values.contract.scope});if(values.editor)for(const x of editor.fields)x.value=values.editor.fields[x.name];message('已恢复本项目未提交的临时内容，请完成正式保存。');return {restored:1};}
    return Object.freeze({open,openDetails,show,isDetailsOpen:()=>!!detailsEditor||useSummary&&!!register,detailsScope:()=>detailsEditor?.scope||register?.capturePending()?.scope,canLeave:permit,capturePending,
      restorePending(values,meta){
        if(meta?.scope?.kind!=='project-information')return restorePending(values,meta);
        if(detailsEditor?.scope.projectId!==meta.scope.projectId)throw Error('暂存项目与当前立项表不符。');
        return detailsEditor.restorePending(values,meta);
      },
      async savePending(){if(register)return register.savePending();if(editor?.saving)throw Error('立项正在保存，请稍后重试。');if(editor&&editor.fields.some(x=>x.value!==editor.initial[x.name])){const ok=await editor.savePending?.();if(!ok)throw Error(status.textContent||'立项暂存未完成。');}return contract?.savePending?contract.savePending():{saved:0};}});
  }
  async function ensureWon(input){
    const e=input?.entry||input,source=sourceOf(e,e?.id),db=await openDb();
    try{const old=await read(db,s=>s.get(source.quoteId));if(old)return stored(old);
      try{return await commit(db,source,{projectName:source.projectName||'项目名称待填写',initiationDate:today(),manager:'',notes:''},0);}
      catch(e){const concurrent=await read(db,s=>s.get(source.quoteId));if(concurrent)return stored(concurrent);throw e;}
    }finally{db.close();}
  }
  async function listSaved(){
    const db=await openDb();
    try{return (await read(db,s=>s.getAll())).map(stored);}
    finally{db.close();}
  }
  root.ProjectInitiation=Object.freeze({mount,listSaved,ensureWon,validateRecord:stored});
  if(typeof module==='object'&&module.exports)module.exports=root.ProjectInitiation;
})(globalThis);
