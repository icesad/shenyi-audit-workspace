/* Browser-local initiation records derived from a verified won quote. */
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
    const estimate=v?.origin==='estimate';
    exact(v,estimate?[...SOURCE_KEYS,'origin']:SOURCE_KEYS);
    const validYear=estimate&&v.auditYear===null||Number.isInteger(v.auditYear)&&v.auditYear>=1900&&v.auditYear<=9999;
    const validAmount=estimate&&v.totalCents===null||Number.isSafeInteger(v.totalCents)&&v.totalCents>=0;
    if(!Number.isSafeInteger(v.wonEventNo)||v.wonEventNo<1||!validYear||!validAmount)throw Error(schemaMessage);
    return {quoteId:id(v.quoteId),wonEventNo:v.wonEventNo,wonAt:iso(v.wonAt),projectName:text(v.projectName,300,'来源项目名称',!estimate),
      issuer:text(v.issuer,200,'发标单位'),customerName:text(v.customerName,200,'被审计单位'),firmName:text(v.firmName,200,'投标事务所'),
      auditYear:v.auditYear,quoteDate:date(v.quoteDate),totalCents:v.totalCents,projectType:text(v.projectType,100,'项目类型'),...(estimate?{origin:'estimate'}:{})};
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
      t.onabort=()=>reject(reason||Error('保存未完成，原立项资料保留。'));
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
  function money(cents){
    if(cents===null)return '待填写';
    const n=BigInt(cents),whole=String(n/100n).replace(/\B(?=(\d{3})+(?!\d))/g,',');
    return '¥ '+whole+'.'+String(n%100n).padStart(2,'0');
  }
  function mount(container,{lookup,listWon,onBack,onOpenDetails,summaryClearButton,summaryRecords=(records=>records),projectNameForDisplay=(name=>name)}={}){
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
      const {manager,riskLevel}=workspace.projectRegister||{};
      return Object.keys(root.ProjectWorkspaceStore.INITIATION_FIELDS).every(key=>filled(details[key]))&&
        filled(type)&&filled(riskLevel)&&filled(manager??record.form.manager)&&
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
      const columns=[['立项状态','initiationStatus'],['被审计单位','company'],['项目类型','type'],['当前步骤','stage'],
        ['是否完结','completed'],['是否归档','archived'],['确认人','manager']];
      const projects=[];
      for(const [index,record] of records.entries()){
        const {quoteId,source}=record,entry=entries.get(quoteId),workspace=workspaces[index].value;
        const progress=workspace?.auditWorkflow;
        const lifecycle=workspace?.projectLifecycle?.status;
        const completed=progress?.completed || (lifecycle==='已完成'?'是':lifecycle==='进行中'?'否':'');
        const company=workspace?.projectInitiationDetails?.companyName??quotedAuditees(source,entry);
        const type=workspace?.projectClassification?.projectType??source.projectType;
        const initiationStatus=initiationComplete(workspace,record,type)?'已完成':'立项中';
        const stage=root.AuditWorkflow?.stageName(progress?.currentStage);
        const manager=workspace?.projectRegister?.manager??record.form.manager;
        projects.push({quoteId,number:index+1,initiationStatus,company,type,stage,completed,archived:progress?.archived,manager});
      }
      const clear=summaryClearButton||btn('清空筛选');
      const display=value=>value||'—';
      const filtersUI=root.WorkspaceTableFilters.create(scroll,summaryFilters,renderRows);
      for(const [name,key] of [['序号'],['项目编号'],...columns]){
        const cell=el('th');cell.scope='col';cell.append(el('span',name));headRow.append(cell);
        if(!key)continue;
        const values=new Set(projects.map(project=>display(project[key])));
        if(summaryFilters.has(key))values.add(summaryFilters.get(key));
        const choices=[...values].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true})).map(value=>[value,value==='—'?'未填写':value]);
        cell.append(filtersUI.add(name,key,choices,key==='company'||key==='manager'));
      }
      head.append(headRow);table.append(head,body);scroll.append(table);
      function renderRows(){
        const filters=[...summaryFilters];
        const visible=projects.filter(project=>filters.every(([key,value])=>display(project[key])===value));
        const rows=visible.map(project=>{
          const {quoteId,number}=project,row=el('tr'),code=el('td'),link=el('a',quoteId);
          row.dataset.projectRegisterId=quoteId;
          code.dataset.projectInternalId=quoteId;code.title='项目编号 '+quoteId;
          link.href='#project-initiation';link.title='查看立项信息表';
          link.onclick=event=>{event.preventDefault();void onOpenDetails(quoteId);};
          code.append(link);row.append(el('td',String(number)),code);
          for(const [,key] of columns)row.append(el('td',display(project[key]),key==='initiationStatus'?'pi-initiation-status':undefined));
          return row;
        });
        if(!rows.length){
          const row=el('tr'),cell=el('td',projects.length?'没有符合查询条件的项目。':'暂无已立项项目。','pi-summary-empty');
          cell.colSpan=headRow.cells.length;row.append(cell);rows.push(row);
        }
        clear.disabled=!filters.length;
        filtersUI.sync();
        body.replaceChildren(...rows);
      }
      clear.onclick=()=>{filtersUI.close();summaryFilters.clear();renderRows();};
      renderRows();host.replaceChildren(scroll,filtersUI.menu);
      if(!summaryClearButton){
        const toolbar=el('div',undefined,'pi-summary-tools');
        toolbar.append(clear);host.prepend(toolbar);
      }
      return workspaces.every(result=>result.status==='fulfilled');
    }
    async function show({leaveApproved=false}={}){
      if(!leaveApproved&&!permit())return false;
      if(useSummary&&summaryClearButton)summaryClearButton.disabled=true;
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
            if(first)candidates.push({projectId:record.quoteId,firstWonAt:first.recordedAt});
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
        try{formValue=formShape(Object.fromEntries(fields.map(x=>[x.name,x.value])));}catch(e){message(e.message,true);return false;}
        state.saving=true;save.disabled=true;for(const x of fields)x.disabled=true;message('正在核对中标状态并保存…');
        try{
          const d=await db(),now=sourceOf(await lookup(source.quoteId),source.quoteId);
          if(JSON.stringify(now)!==JSON.stringify(source))throw Error('中标结果或来源报价已变化，请重新打开立项表核对，当前输入尚未保存。');
          if(ticket!==serial)return;
          const next=await commit(d,now,formValue,state.revision);
          if(ticket!==serial)return;
          state.revision=next.revision;state.initial={...next.form};for(const x of fields)x.value=next.form[x.name];
          message('立项信息已保存（本机，第 '+next.revision+' 版）。报价记录未修改。');return true;
        }catch(e){if(ticket===serial)message(e?.message||'立项保存未完成。',true);return false;}
        finally{state.saving=false;if(ticket===serial){save.disabled=false;for(const x of fields)x.disabled=false;}}
      };
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
        try{
          const live=await lookup(quoteId);entry=live?.entry||live;
          source=sourceOf(entry,quoteId);
          record=await ensureWon(entry);
        }catch(error){
          const saved=await db().then(d=>read(d,store=>store.get(quoteId)));
          if(!saved)throw error;
          record=stored(saved);source=record.source;
          readOnlyReason='中标来源当前不可核对，已打开保存的立项信息供查看。';
        }
        if(entry?.id!==quoteId)entry=null;
        const workspace=await S.get(quoteId);
        if(ticket!==serial)return false;
        const frozen=JSON.stringify(source);
        const saved=workspace.projectInitiationDetails;
        if(saved)S.initiationDetails(saved);
        const quote=entry?.snapshot||{};
        const rate=/^\s*(\d{1,3}(?:\.\d{1,2})?)\s*%/.exec(quote.taxRateText||'');
        const quoteCents=readOnlyReason?workspace.amountCents??source.totalCents:S.projectAmount(source,workspace,entry).amountCents;
        const values={companyName:quotedAuditees(source,entry),contactName:quote.contactName||'',contactInfo:quote.contactInfo||'',
          taxRate:rate&&Number(rate[1])<=100?rate[1]:'',...(saved||{}),
          riskLevel:workspace.projectRegister?.riskLevel??quote.riskLevel??'',
          manager:workspace.projectRegister?.manager??record.form.manager,
          projectType:workspace.projectClassification?.projectType??source.projectType,
          amount:quoteCents===null?'':money(quoteCents).replace(/[^\d.]/g,''),
          invoice:workspace.projectInvoice?.information||''};
        const panel=el('section',undefined,'panel pi-editor pi-detail'),head=el('div',undefined,'pi-head'),form=el('form');
        const meta=el('p',undefined,'pi-project-meta');
        meta.append(el('strong',projectNameForDisplay(source.projectName)||'项目名称待填写'),el('code',quoteId));
        head.append(meta,back);
        if(useSummary&&root.ProjectRegister){
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
        const fields=new Map(),yesNo=['是','否'],riskLevels=['A类','B类','C类'];
        function group(title,items){
          const fieldset=el('fieldset',undefined,'pi-detail-group'),grid=el('div',undefined,'fields pi-fields');
          fieldset.append(el('legend',title),grid);form.append(fieldset);
          for(const [key,label,type,options] of items){
            const field=el(options?'select':type==='textarea'?'textarea':'input'),wrapper=el('label',label);
            field.name=key;field.id='project-info-'+key;wrapper.htmlFor=field.id;
            if(options){
              const prompt=el('option','请选择');prompt.value='';prompt.disabled=true;prompt.hidden=true;field.append(prompt);
              for(const item of options){const option=el('option',item);option.value=item;field.append(option);}
              if(values[key]&&!options.includes(values[key])){
                const prior=el('option',values[key]);prior.value=values[key];field.append(prior);
              }
            }else if(type==='textarea'){field.rows=3;wrapper.classList.add('pi-wide');}
            else {field.type=type==='date'?'date':'text';if(type==='decimal'||type==='numeric')field.inputMode=type;}
            const max=S.INITIATION_FIELDS[key]||{manager:100,invoice:4000,amount:24}[key];
            if(max&&!options&&type!=='date')field.maxLength=max;
            if(readOnlyReason){if(options)field.disabled=true;else field.readOnly=true;}
            field.value=values[key]||'';fields.set(key,field);wrapper.append(field);grid.append(wrapper);
          }
        }
        group('项目资料',[
          ['companyName','被审计单位'],['contactName','公司联系人'],['contactInfo','联系方式'],
          ['projectType','项目类型',null,S.PROJECT_TYPES],['riskLevel','风险等级',null,riskLevels],
          ['amount','项目价格（含税，元）','decimal'],['taxRate','税率（%）','decimal']
        ]);
        group('人员与交付',[
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
        file.type='file';file.accept='.pdf,.docx,.png,.jpg,.jpeg';file.id='project-info-contract';file.disabled=!!readOnlyReason;fileLabel.htmlFor=file.id;fileLabel.append(file);
        contractRow.append(fileLabel,filename,download);form.lastElementChild.append(contractRow);
        const save=btn('保存立项信息','btn primary'),foot=el('div',undefined,'pi-form-actions');
        save.id='project-info-save';save.type='submit';save.disabled=!!readOnlyReason;foot.append(save);form.append(foot);content.replaceChildren(panel);
        const readFields=()=>Object.fromEntries([...fields].map(([key,field])=>[key,field.value]));
        let initial=readFields(),current=workspace,saving=false;
        const scope={kind:'project-information',projectId:quoteId};
        const dirty=()=>Object.entries(readFields()).some(([key,value])=>value!==initial[key]);
        const updateFile=()=>{filename.textContent=file.files[0]?.name||current.signedContract?.name||'尚未上传合同';download.hidden=!current.signedContract;};
        updateFile();file.onchange=updateFile;
        download.onclick=async()=>{try{const item=current.signedContract;if(item){await S.validateSignedContract(item);S.download(item.blob,item.name);}}catch(error){message(error.message,true);}};
        detailsEditor={
          scope,
          canLeave:()=>!saving&&(!dirty()&&!file.files.length||typeof root.confirm!=='function'||root.confirm('立项信息有未保存的修改，确定离开？')),
          capturePending:()=>!readOnlyReason&&dirty()?{scope,values:{revision:current.rev,source:frozen,fields:readFields()}}:null,
          async restorePending(draft){
            if(readOnlyReason||dirty()||saving||draft?.revision!==current.rev||draft.source!==frozen||(await S.get(quoteId)).rev!==current.rev||Object.keys(draft.fields||{}).length!==fields.size||[...fields].some(([key,input])=>typeof draft.fields[key]!=='string'||input.maxLength>0&&draft.fields[key].length>input.maxLength))throw Error('立项信息的来源或版本已变化，未覆盖当前输入。');
            for(const [key,input] of fields)input.value=draft.fields[key];
            return {restored:1};
          }
        };
        form.onsubmit=async event=>{
          event.preventDefault();
          if(readOnlyReason||saving||ticket!==serial)return;
          const input=readFields(),selected=file.files[0];
          saving=true;save.disabled=true;file.disabled=true;for(const field of fields.values())field.disabled=true;
          try{
            const details={schemaVersion:1};
            for(const key of Object.keys(S.INITIATION_FIELDS))details[key]=input[key].trim();
            S.initiationDetails(details);
            const amount=input.amount.trim();
            if(amount&&!/^\d+(?:\.\d{1,2})?$/.test(amount))throw Error('请填写非负项目价格，最多两位小数。');
            const cents=amount?root.QuoteCalc.money(amount):null;
            const oldRegister=current.projectRegister||{schemaVersion:1,siteTime:'',workpaperReportTime:'',preparationTime:'',preparer:'',reviewer:'',financialStatementDate:''};
            const hasSite=details.siteStart||details.siteEnd||current.projectInitiationDetails?.siteStart||current.projectInitiationDetails?.siteEnd;
            const siteTime=hasSite?[details.siteStart,details.siteEnd].filter(Boolean).join(' 至 '):oldRegister.siteTime;
            const patch={projectInitiationDetails:details,amountCents:cents,projectRegister:{...oldRegister,manager:input.manager.trim(),riskLevel:input.riskLevel,siteTime}};
            if(!input.projectType||S.PROJECT_TYPES.includes(input.projectType))patch.projectClassification={schemaVersion:1,projectType:input.projectType};
            if(input.invoice.trim()!==initial.invoice)patch.projectInvoice={schemaVersion:1,information:input.invoice.trim(),file:current.projectInvoice?.file||null};
            if(selected){
              if(!selected.size||selected.size>12*1024*1024)throw Error('请选择 12 MiB 以内的合同文件。');
              patch.signedContract={name:selected.name,hash:await S.hash(selected),blob:selected};
              await S.validateSignedContract(patch.signedContract);
            }
            if(JSON.stringify(sourceOf(await lookup(quoteId),quoteId))!==frozen)throw Error('中标结果或来源已变化，请重新打开立项信息表。');
            if(typeof root.confirm==='function'&&!root.confirm('确认保存立项信息？'))return;
            current=await S.save(quoteId,current.rev,patch);
            for(const key of Object.keys(S.INITIATION_FIELDS))fields.get(key).value=details[key];
            fields.get('manager').value=patch.projectRegister.manager;fields.get('invoice').value=input.invoice.trim();
            file.value='';updateFile();initial=readFields();message('立项信息已保存。');
          }catch(error){message(error.message||'立项信息未保存。',true);}
          finally{saving=false;save.disabled=false;file.disabled=false;for(const field of fields.values())field.disabled=false;}
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
        return detailsEditor.restorePending(values);
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
