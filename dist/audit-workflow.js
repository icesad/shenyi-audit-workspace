/* Per-project files and explicit progress for the audit workflow overview. */
(function(root){
  'use strict';
  const stages=[
    ['initial','初步业务活动及风险评估','初步业务活动'],
    ['client','客户资料','资料收集'],
    ['ledger','账表校验','校验'],
    ['confirmation','函证制作模板','下载函证'],
    ['export','全套底稿上传','上传已编制底稿'],
    ['report','报告出具','打开报告编制']
  ];
  const labels=new Map(stages.map(([key,label])=>[key,label]));
  labels.set('initial','初步业务活动');labels.set('risk','风险评估');
  labels.set('template','底稿模板');labels.set('review','项目复核');
  const visibleStage=key=>key==='print'?'review':key; // Legacy printing files are now shown under review.
  const choices=['','是','否'];
  const progressFields=[['completed','是否完成'],['archived','是否归档'],['confirmedBy','确认人']];
  const empty=()=>({schemaVersion:1,currentStage:'',completed:'',archived:'',confirmedBy:'',files:{}});
  function completionPatch(workspace){
    const patch={};
    const progress=workspace.auditWorkflow||empty();
    if(progress.completed!=='是')patch.auditWorkflow={...progress,completed:'是'};
    const lifecycle=workspace.projectLifecycle;
    if(lifecycle?.status!=='已完成'&&lifecycle?.status!=='已取消'){
      patch.projectLifecycle={schemaVersion:1,paymentReceived:'',...lifecycle,status:'已完成'};
    }
    return patch;
  }
  const MiB=1024*1024;
  const reportFiles=new Map([['signedTables','审定表盖章版 PDF'],['finalReport','最终版全套报告 PDF']]);
  const reportFileMax=100*MiB;
  const confirmationChoice='shenyi.confirmation-template.active.v1';
  const confirmationFiles=new Map([['confirmationControl','函证控制信息表'],['confirmationLedger','三栏账']]);
  const isTemplateReference=(key,item)=>key==='template'&&item?.kind==='template-library';
  const isTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  function canDownload(workspace){
    const compilation=workspace?.auditWorkflow?.compilation;
    return Boolean(compilation&&isTime(compilation.startedAt)&&isTime(compilation.completedAt)&&compilation.completedAt>=compilation.startedAt&&root.WorkpaperPackage?.hasCompiledWorkpapers(workspace));
  }
  function validate(value){
    if(!value||value.schemaVersion!==1||Object.keys(value).length!==(Object.hasOwn(value,'compilation')?7:6)||value.currentStage!==''&&!labels.has(visibleStage(value.currentStage))||
      !choices.includes(value.completed)||!choices.includes(value.archived)||typeof value.confirmedBy!=='string'||
      value.confirmedBy.length>100||!value.confirmedBy.isWellFormed()||/[\u0000-\u001f\u007f]/.test(value.confirmedBy)||
      !value.files||Object.getPrototypeOf(value.files)!==Object.prototype)throw Error('审计流程记录格式无效。');
    if(Object.hasOwn(value,'compilation')){
      const c=value.compilation;
      if(!c||Object.keys(c).length!==2||!isTime(c.startedAt)||c.completedAt!==null&&(!isTime(c.completedAt)||c.completedAt<c.startedAt))throw Error('底稿编制时间记录无效。');
    }
    let total=0;
    for(const [key,files] of Object.entries(value.files)){
      const reportFile=reportFiles.has(key);
      if(!reportFile&&!confirmationFiles.has(key)&&!labels.has(visibleStage(key))||!Array.isArray(files)||files.length>(reportFile||key==='confirmationControl'?1:confirmationFiles.has(key)?200:10))
        throw Error('流程资料数量或类别无效。');
      const hashes=new Set();
      for(const item of files){
        if(!item||typeof item.name!=='string'||!item.name||item.name.length>240||/[\\/\u0000-\u001f\u007f]/.test(item.name)||
          !/^[a-f0-9]{64}$/.test(item.sha256)||hashes.has(item.sha256))throw Error('流程资料文件格式无效。');
        hashes.add(item.sha256);
        if(isTemplateReference(key,item)){
          if(!Number.isSafeInteger(item.size)||item.size<1||item.size>=root.AuditTemplates.limits.maxFileBytes||
            typeof item.type!=='string'||item.type.length>160||Object.hasOwn(item,'blob'))throw Error('流程模板关联格式无效。');
          continue;
        }
        const maxSize=reportFile?reportFileMax:key==='template'?24*MiB:root.AuditChecklist?.fileLimit?.(item.name)||12*MiB;
        if(!(item.blob instanceof Blob)||item.size!==item.blob.size||item.size<1||item.size>maxSize||item.type!==item.blob.type||
          (reportFile&&(!/\.pdf$/iu.test(item.name)||item.type!=='application/pdf'))||
          (key==='print'&&item.type!=='application/pdf')||
          (confirmationFiles.has(key)&&!(/\.xlsx?$/iu.test(item.name)||key==='confirmationLedger'&&/\.zip$/iu.test(item.name))))throw Error('流程资料文件格式无效。');
        total+=item.size;
      }
    }
    if(total>150*MiB)throw Error('同一项目的流程资料最多保存 150 MiB。');
    return value;
  }
  async function prepareReportPdf(file){
    if(!/\.pdf$/iu.test(file.name)||file.name.length>240||/[\\/\u0000-\u001f\u007f]/u.test(file.name)||
      !file.size||file.size>reportFileMax)throw Error('请选择非空、100 MiB 以内的 PDF 文件。');
    if(!root.PDFLib?.PDFDocument)throw Error('PDF 校验组件尚未加载，请刷新后重试。');
    try{
      const pdf=await root.PDFLib.PDFDocument.load(await file.arrayBuffer(),{updateMetadata:false});
      if(!pdf.getPageCount())throw Error('PDF 无页面。');
    }catch{throw Error('PDF 无法读取，请核对文件是否损坏或加密：'+file.name);}
    const blob=file.slice(0,file.size,'application/pdf');
    return {name:file.name,blob,type:blob.type,size:blob.size,sha256:await root.ProjectWorkspaceStore.hash(blob)};
  }
  function confirmationTemplate({company,firm}){
    const layouts=root.QuoteLayouts;
    if(!layouts?.packOfficeParts)throw Error('Word 生成组件尚未加载，请刷新后重试。');
    const xml='<?xml version="1.0" encoding="UTF-8"?>',ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const escape=value=>String(value).toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu,'')
      .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const paragraph=(value,title=false)=>'<w:p><w:pPr><w:spacing w:after="140"/>'+
      (title?'<w:jc w:val="center"/>':'')+'</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="宋体"/>'+
      (title?'<w:b/><w:sz w:val="32"/>':'<w:sz w:val="22"/>')+'</w:rPr><w:t xml:space="preserve">'+escape(value)+'</w:t></w:r></w:p>';
    const tableRows=[['函证项目','截至日期','币种','贵单位欠我方','我方欠贵单位','备注'],['','','','','',''],['','','','','',''],['','','','','','']];
    const table='<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>'+
      ['top','left','bottom','right','insideH','insideV'].map(side=>'<w:'+side+' w:val="single" w:sz="4" w:color="888888"/>').join('')+
      '</w:tblBorders></w:tblPr><w:tblGrid>'+tableRows[0].map(()=>'<w:gridCol w:w="1500"/>').join('')+'</w:tblGrid>'+
      tableRows.map((row,index)=>'<w:tr>'+(index===0?'<w:trPr><w:tblHeader/></w:trPr>':'')+
        row.map(value=>'<w:tc><w:tcPr><w:tcW w:w="1500" w:type="dxa"/></w:tcPr>'+paragraph(value)+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>';
    const contents=paragraph('企业往来款项询证函',true)+
      ['函证编号：________________','致被询证单位：________________','被审计单位：'+(company||'________________'),
       '因财务报表审计需要，请核对下表及其他询证事项。无论相符或存在差异，均请填写回函意见，并将签章后的回函直接送交下列会计师事务所。',
       '回函接收方：'+(firm||'________________'),'联系地址或指定回函渠道：________________','联系人及电话：________________'].map(line=>paragraph(line)).join('')+table+
      ['其他询证事项：________________________________________________','发函单位（盖章）：________________    日期：________________',
       '回函意见（请勾选）','□ 相符    □ 不符。差异金额或事项及说明：____________________________',
       '回函单位（盖章）：________________    经办人及联系方式：________________','回函日期：________________'].map(line=>paragraph(line)).join('');
    const bytes=layouts.packOfficeParts({
      'word/document.xml':xml+'<w:document xmlns:w="'+ns+'"><w:body>'+contents+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1100" w:right="1250" w:bottom="1100" w:left="1250"/></w:sectPr></w:body></w:document>',
      '_rels/.rels':xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      '[Content_Types].xml':xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    });
    return new root.Blob([bytes],{type:layouts.docxMime});
  }
  function mount(host,{listProjects,openStage}){
    const doc=host.ownerDocument,S=root.ProjectWorkspaceStore,A=root.AuditChecklist;
    const el=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
    const button=(text)=>{const node=el('button',text,'btn');node.type='button';return node;};
    const options=(node,items)=>node.replaceChildren(...items.map(([key,label])=>{const option=el('option',label);option.value=key;return option;}));
    const controls=el('div',undefined,'panel af-project'),select=el('select'),label=el('label','审计项目'),refresh=button('刷新项目'),notice=el('p',undefined,'af-notice');
    select.id='audit-flow-project';label.htmlFor=select.id;label.append(select);
    const companySelect=el('select'),companyLabel=el('label','被审计单位');
    companySelect.id='audit-flow-company';companyLabel.htmlFor=companySelect.id;companyLabel.append(companySelect);
    notice.id='audit-flow-status';notice.setAttribute('role','status');
    controls.append(companyLabel,label,refresh,notice);
    const flow=el('div',undefined,'af-stages'),summary=el('section',undefined,'panel af-summary'),table=el('table'),head=el('thead'),row=el('tr'),body=el('tbody'),scroll=el('div',undefined,'table-scroll');
    const filters=new Map();
    const filtersUI=root.WorkspaceTableFilters.create(scroll,filters,renderSummary);
    for(const [title,field] of [['序号'],['项目编号'],['被审计单位'],['项目类型'],['当前步骤','currentStage'],['是否完成','completed'],['是否归档','archived'],['确认人']]){
      const th=el('th',title);th.scope='col';row.append(th);
      if(!field)continue;
      const choices=[['','未填写'],...(field==='currentStage'?labels:[['是','是'],['否','否']])];
      th.append(filtersUI.add(title,field,choices));
    }
    head.append(row);table.append(head,body);scroll.append(table);
    summary.append(el('h2','底稿编制进度统计表'),scroll,filtersUI.menu);
    const editor=el('dialog',undefined,'af-progress-editor'),editForm=el('form'),editTitle=el('h2','编辑进度'),editStatus=el('p',undefined,'af-notice error');
    editTitle.id='audit-flow-edit-title';editor.setAttribute('aria-labelledby',editTitle.id);editStatus.setAttribute('role','status');
    editForm.append(editTitle);
    const editInputs=new Map();
    for(const [key,title] of progressFields){
      const field=el('label',title),input=el(key==='confirmedBy'?'input':'select');
      if(key==='confirmedBy')input.maxLength=100;
      else options(input,choices.map(value=>[value,value||'未填写']));
      editInputs.set(key,input);field.append(input);editForm.append(field);
    }
    const editActions=el('div',undefined,'af-progress-actions'),cancel=button('取消'),save=button('保存进度');
    save.type='submit';save.classList.add('primary');cancel.onclick=()=>editor.close();
    editor.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    editActions.append(cancel,save);editForm.append(editStatus,editActions);editor.append(editForm);
    const reportEditor=el('dialog',undefined,'af-progress-editor af-report-editor'),reportForm=el('form'),
      reportTitle=el('h2','上传审定表盖章版'),reportStatus=el('p',undefined,'af-notice error'),
      reportActions=el('div',undefined,'af-progress-actions'),reportCancel=button('取消'),reportSave=button('保存所选 PDF');
    reportTitle.id='audit-flow-report-title';reportEditor.setAttribute('aria-labelledby',reportTitle.id);reportStatus.setAttribute('role','status');
    reportForm.append(reportTitle);
    const signedLabel=el('label',reportFiles.get('signedTables')),signedInput=el('input'),signedName=el('small',undefined,'muted');
    signedInput.type='file';signedInput.accept='.pdf,application/pdf';
    signedLabel.append(signedInput,signedName);globalThis.ShenyiFileDrop?.bind(signedLabel,signedInput,{material:'审定表盖章版'});
    reportForm.append(signedLabel);
    reportCancel.onclick=()=>reportEditor.close();reportSave.type='submit';reportSave.classList.add('primary');
    reportActions.append(reportCancel,reportSave);reportForm.append(reportStatus,reportActions);reportEditor.append(reportForm);
    reportEditor.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    host.replaceChildren(controls,flow,summary,editor,reportEditor);
    let projects=[],workspaces=new Map(),loading=false,busy=false,ticket=0,editTarget=null,reportTarget=null;
    const companyOf=project=>workspaces.get(project.quoteId)?.projectInitiationDetails?.companyName||project.source.customerName||'';
    function availableProjects(selected,chooseSingle=false){
      const matching=projects.filter(project=>!companySelect.value||companyOf(project)===companySelect.value);
      options(select,[['','请选择已立项项目'],...matching.map(project=>[project.quoteId,project.form.projectName])]);
      select.value=matching.some(project=>project.quoteId===selected)?selected:chooseSingle&&matching.length===1?matching[0].quoteId:'';
    }
    function selectProgressProject(project){
      companySelect.value=companyOf(project);
      availableProjects(project.quoteId);
      select.onchange();
    }
    const cards=new Map();
    const say=(message,error=false)=>{notice.textContent=message;notice.classList.toggle('error',error);};
    function stored(id){const value=workspaces.get(id)?.auditWorkflow;return value?validate(value):empty();}
    async function run(work,saving=false){
      if(loading||busy)return;
      busy=true;lock();
      try{await work();}catch(error){
        const message=(saving?root.SaveFeedback?.failed(error):null)||error.message||'流程操作未完成。';
        if(editor.open)editStatus.textContent=message;
        else if(reportEditor.open)reportStatus.textContent=message;
        else say(message,true);
      }
      finally{busy=false;lock();}
    }
    function openProgress(id,state){
      if(loading||busy)return;
      editTarget={id,state};
      for(const [key,input] of editInputs)input.value=state[key];
      editStatus.textContent='';editor.showModal();
    }
    editForm.onsubmit=event=>{
      event.preventDefault();
      if(!editor.open||!editTarget)return;
      void run(async()=>{
        const {id,state}=editTarget;
        const fields=Object.fromEntries([...editInputs].map(([key,input])=>[key,input.value.trim()]));
        const latest=await S.get(id),current=latest.auditWorkflow?validate(latest.auditWorkflow):empty();
        if(progressFields.some(([key])=>current[key]!==state[key]))throw Error('项目进度已更新，请关闭后刷新项目再编辑。');
        const next=validate({...current,...fields});
        workspaces.set(id,await S.save(id,latest.rev,{auditWorkflow:next}));
        editor.close();renderSummary();say(root.SaveFeedback?.saved('进度已保存。')??('进度已保存。'));
      },true);
    };
    function openReportUpload(){
      if(loading||busy||!select.value)return;
      const id=select.value,state=stored(id);
      reportTarget={id,hash:state.files.signedTables?.[0]?.sha256};
      signedInput.value='';signedName.textContent=state.files.signedTables?.[0]?.name||'尚未上传';
      reportStatus.textContent='';reportEditor.showModal();
    }
    reportForm.onsubmit=event=>{
      event.preventDefault();
      if(!reportEditor.open||!reportTarget)return;
      const {id,hash}=reportTarget,file=signedInput.files[0];
      void run(async()=>{
        if(!file)throw Error('请选择要保存的审定表盖章版 PDF。');
        const signedTables=[await prepareReportPdf(file)];
        const workspace=await S.get(id),state=workspace.auditWorkflow?validate(workspace.auditWorkflow):empty();
        if(state.files.signedTables?.[0]?.sha256!==hash)
          throw Error('本项目报告资料已更新，请关闭后重新打开。');
        const next=validate({...state,currentStage:'report',files:{...state.files,signedTables}});
        workspaces.set(id,await S.save(id,workspace.rev,{auditWorkflow:next}));
        reportEditor.close();renderCards();renderSummary();
        say(root.SaveFeedback?.saved('所选 PDF 已保存到本项目。')??'所选 PDF 已保存到本项目。');
      },true);
    };
    async function openWorkflowStage(key,action=key){
      const id=select.value;
      await run(async()=>{
        const recordStep=async()=>{
          const workspace=await S.get(id),state=workspace.auditWorkflow?validate(workspace.auditWorkflow):empty();
          workspaces.set(id,state.currentStage===key?workspace:await S.save(id,workspace.rev,{auditWorkflow:{...state,currentStage:key}}));
        };
        // Open editable workpapers against the revision that includes this progress change.
        const opensWorkpaper=['initial','risk','ledger'].includes(key);
        if(await openStage(action,id,opensWorkpaper?recordStep:undefined)!==true||!id)return;
        if(!opensWorkpaper)await recordStep();
        renderSummary();
      });
    }
    function openProgressStage(project,key){
      selectProgressProject(project);
      if(key==='confirmation'||key==='export'){
        cards.get(key).open.focus();
        return;
      }
      void run(()=>openStage(key||'client',project.quoteId));
    }
    async function upload(key,files){
      if(!files.length)return;
      const id=select.value;
      if(!id){say('请先选择审计项目。',true);return;}
      await run(async()=>{
        if(files.length>10)throw Error('每次最多可选择 10 份资料。');
        const items=[];
        for(const file of files)items.push(await A.prepareFile(file));
        const workspace=await S.get(id),state=workspace.auditWorkflow?validate(workspace.auditWorkflow):empty();
        const original=state.files[key]||[],merged=new Map(original.map(file=>[file.sha256,file]));
        for(const file of items)if(!merged.has(file.sha256))merged.set(file.sha256,file);
        const added=merged.size-original.length;
        if(added){
          const value={...state,currentStage:key,files:{...state.files,[key]:[...merged.values()]}};
          workspaces.set(id,await S.save(id,workspace.rev,{auditWorkflow:value}));
        }
        renderCards();renderSummary();
        const message=added?labels.get(key)+'已保存 '+added+' 份资料。':'所选资料已保存过。';
        say(root.SaveFeedback?.saved(message)??(message));
      },true);
    }
    for(const [key,title,action] of stages){
      const card=el('section',undefined,'panel af-stage'),list=el('ul',undefined,'af-files'),open=button(action);
      card.dataset.workflowStage=key;
      const heading=el('h2',title);
      if(key==='initial')heading.replaceChildren('初步业务活动',el('wbr'),el('span','及风险评估','af-heading-group'));
      card.append(heading);
      let download,approvedActions=[];
      if(key==='initial'){
        const risk=button('风险评估');
        open.classList.add('primary');
        open.onclick=()=>void openWorkflowStage('initial');
        risk.onclick=()=>void openWorkflowStage('risk');
        card.append(open,risk);flow.append(card);cards.set(key,{open,approvedActions:[risk]});
        continue;
      }
      if(key==='client'){
        open.classList.add('primary');
        open.onclick=()=>void openWorkflowStage('client');
        download=button('下载全部资料');
        download.onclick=()=>void run(async()=>{
          const id=select.value;
          if(!id)throw Error('请先选择审计项目。');
          const name=await root.ProjectDownloads.download(id,'materials',()=>{
            if(select.value!==id||!host.isConnected||host.closest('[hidden]'))throw Error('项目或页面已切换，请重新下载。');
          });
          say('已发起下载：'+name);
        });
        card.append(open,download);flow.append(card);cards.set(key,{open,download});
        continue;
      }
      if(key==='confirmation'){
        const choose=button('上传/选择函证模板'),picker=el('dialog',undefined,'af-progress-editor'),
          heading=el('h2','上传/选择函证模板'),current=el('p',undefined,'af-notice'),
          upload=button('上传'),useBuiltIn=button('使用内置模板'),close=button('关闭'),
          controls=el('div',undefined,'af-progress-actions'),input=el('input');
        heading.id='confirmation-template-title';picker.setAttribute('aria-labelledby',heading.id);
        current.setAttribute('role','status');input.type='file';input.hidden=true;
        input.accept='.doc,.docx,.xls,.xlsx,.pdf';input.setAttribute('aria-label','选择函证模板文件');
        controls.append(upload,useBuiltIn,close);globalThis.ShenyiFileDrop?.bind(upload,input,{material:'函证模板',title:'上传函证模板'});picker.append(heading,current,input,controls);
        globalThis.ShenyiFileDrop?.bind(choose,input,{material:'函证模板',beforeDrop:()=>{
          showCurrent('');picker.showModal();return true;
        }});
        const choice=()=>root.localStorage.getItem(confirmationChoice);
        async function templateStore(work){
          const db=await root.AuditTemplates.open({dbName:'shenyi.confirmation-templates.v1'});
          try{return await work(db);}finally{db.close();}
        }
        const showCurrent=(text,bad=false)=>{current.textContent=text;current.classList.toggle('error',bad);};
        async function selectionTask(work){
          await run(async()=>{try{await work();}catch(error){showCurrent(error.message||'函证模板操作失败。',true);}});
        }
        choose.onclick=()=>{
          showCurrent('');picker.showModal();
          void selectionTask(async()=>{
            const sha=choice();
            const active=sha?await templateStore(db=>db.stat(sha)):null;
            showCurrent('当前模板：'+(active?.name||'内置往来款项询证函'));
          });
        };
        picker.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
        upload.onclick=()=>input.click();close.onclick=()=>picker.close();
        useBuiltIn.onclick=()=>void selectionTask(async()=>{
          root.localStorage.removeItem(confirmationChoice);
          showCurrent('当前模板：内置往来款项询证函');
        });
        input.onchange=()=>{
          const file=input.files[0];input.value='';
          if(!file)return;
          void selectionTask(async()=>{
            if(!/\.(?:docx?|xlsx?|pdf)$/iu.test(file.name))throw Error('请选择 Word、Excel 或 PDF 函证模板。');
            const data=await A.prepareFile(file);
            const saved=await templateStore(db=>db.put(new root.File([data.blob],data.name,{type:data.type})));
            root.localStorage.setItem(confirmationChoice,saved.record.sha256);
            showCurrent('已上传并选用：'+saved.record.name);
          });
        };
        const sourceButton=button('函证控制信息表与三栏账'),sources=el('dialog',undefined,'af-progress-editor'),sourceHeading=el('h2',sourceButton.textContent);
        sourceHeading.id='confirmation-sources-heading';sources.setAttribute('aria-labelledby',sourceHeading.id);
        const form=el('form'),sourceStatus=el('p',undefined,'af-notice'),sourceInputs=new Map();
        sourceStatus.setAttribute('role','status');form.append(sourceHeading);
        for(const [role,title] of confirmationFiles){
          const label=el('label',title),input=el('input'),names=el('small',undefined,'muted');
          input.type='file';input.multiple=role==='confirmationLedger';input.accept=input.multiple?'.xls,.xlsx,.zip':'.xls,.xlsx';
          input.setAttribute('aria-label',role==='confirmationLedger'?'函证用三栏账':title);label.append(input,names);globalThis.ShenyiFileDrop?.bind(label,input,{material:title});form.append(label);sourceInputs.set(role,{input,names});
        }
        const sourceActions=el('div',undefined,'af-progress-actions'),cancelSources=button('取消'),saveSources=button('上传资料');
        saveSources.type='submit';saveSources.classList.add('primary');cancelSources.onclick=()=>sources.close();
        sourceActions.append(cancelSources,saveSources);form.append(sourceStatus,sourceActions);sources.append(form);
        let sourceId='',originalFiles;
        sourceButton.onclick=()=>{
          sourceId=select.value;originalFiles=stored(sourceId).files;
          for(const [role,{input,names}] of sourceInputs){
            input.value='';names.textContent=(originalFiles[role]||[]).map(f=>f.name).join('、')||'尚未上传';
          }
          sourceStatus.textContent='';sources.showModal();
        };
        sources.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
        form.onsubmit=e=>{
          e.preventDefault();
          void run(async()=>{
            try{
              const patch={};
              for(const [role,{input}] of sourceInputs){
                if(!input.files.length)continue;
                const unique=new Map();
                for(const file of input.files){
                  const item=await A.prepareFile(file);unique.set(item.sha256,item);
                }
                patch[role]=[...unique.values()];
              }
              if(!Object.keys(patch).length)throw Error('请选择要上传的函证控制信息表或三栏账。');
              const latest=await S.get(sourceId),state=latest.auditWorkflow||empty();
              const hashes=files=>(files||[]).map(f=>f.sha256).join(',');
              if(Object.keys(patch).some(role=>hashes(state.files[role])!==hashes(originalFiles[role])))
                throw Error('函证资料已更新，请关闭窗口并刷新项目后重新选择。');
              workspaces.set(sourceId,await S.save(sourceId,latest.rev,{auditWorkflow:{...state,currentStage:'confirmation',files:{...state.files,...patch}}}));
              sources.close();renderSummary();say('本项目函证资料已保存。');
            }catch(error){sourceStatus.textContent=error.message;}
          });
        };
        open.classList.add('primary');
        open.onclick=()=>void run(async()=>{
          const id=select.value,project=projects.find(item=>item.quoteId===id),sha=choice(),latest=await S.get(id);
          const files=latest.auditWorkflow?.files||{};
          if(!files.confirmationControl?.length||!files.confirmationLedger?.length)throw Error('请先上传本项目的函证控制信息表和三栏账。');
          const company=latest.projectInitiationDetails?.companyName||project.source.customerName,firm=latest.projectInitiationDetails?.engagementFirm||project.source.firmName;
          let template;
          if(sha){
            const saved=await templateStore(db=>db.read(sha));
            template=new File([saved.blob],saved.name);
          }else template=new File([confirmationTemplate({company:'{{被审计单位}}',firm:'{{事务所}}'})],'企业往来款项询证函.docx');
          say('正在核对函证控制信息表与三栏账并编制函证…');
          const result=await root.ConfirmationLetters.compile({company,firm,template,control:files.confirmationControl[0],ledgers:files.confirmationLedger});
          const current=await S.get(id);
          if(choice()!==sha||id!==select.value||current.rev!==latest.rev||host.closest('[hidden]'))throw Error('项目、资料或函证模板已切换，请重新下载。');
          S.download(result.blob,company+'-函证.pdf');say('已编制 '+result.count+' 份函证，已发起 PDF 下载。');
        });
        card.append(choose,sourceButton,open,picker,sources);flow.append(card);
        cards.set(key,{open,approvedActions:[sourceButton],templateActions:[choose,upload,useBuiltIn,close,cancelSources,saveSources]});
        continue;
      }
      if(key==='export'){
        open.classList.add('primary');
        const file=el('input');file.type='file';file.multiple=true;file.hidden=true;
        file.accept='.zip,.rar,.xlsx,.xls,.docx,.doc,.pdf';
        file.setAttribute('aria-label','上传已编制底稿文件');
        file.onchange=()=>{const files=Array.from(file.files);file.value='';void upload(key,files);};
        open.onclick=()=>file.click();globalThis.ShenyiFileDrop?.bind(open,file,{material:'已编制底稿'});card.append(file,open);flow.append(card);
        cards.set(key,{file,open});
        continue;
      }
      else if(key==='ledger')open.classList.add('primary');
      else if(key==='report'){
        download=button('下载报告初版');
        download.classList.add('primary');
        download.onclick=()=>void openWorkflowStage(key,'report-download');
        const uploadApproved=button('上传审定表盖章版'),downloadFinal=button('下载最终版全套报告');
        uploadApproved.onclick=openReportUpload;
        globalThis.ShenyiFileDrop?.bind(uploadApproved,signedInput,{material:'审定表盖章版',echoSelection:false,beforeDrop:()=>{openReportUpload();return reportEditor.open;}});
        downloadFinal.onclick=()=>{
          const id=select.value;
          if(!id)return;
          void run(async()=>{
            if(!root.ProjectDownloads?.download)throw Error('报告下载组件尚未加载，请刷新后重试。');
            const name=await root.ProjectDownloads.download(id,'finalReport',()=>{
              if(select.value!==id||!host.isConnected||host.closest('[hidden]'))throw Error('项目或页面已切换，请重试。');
            });
            say('已发起下载：'+name);
          });
        };
        card.append(download,open,uploadApproved,downloadFinal);
        approvedActions=[uploadApproved,downloadFinal];
      }
      if(key!=='report')card.append(open);
      card.append(list);flow.append(card);
      cards.set(key,{list,open,download,approvedActions});
      open.onclick=()=>void openWorkflowStage(key);
    }
    function lock(){
      companySelect.disabled=select.disabled=loading||busy;
      refresh.disabled=loading||busy;
      cancel.disabled=save.disabled=busy;
      reportCancel.disabled=reportSave.disabled=busy;
      signedInput.disabled=busy;
      for(const input of editInputs.values())input.disabled=busy;
      for(const [key,card] of cards){
        if(card.file)card.file.disabled=loading||busy||!select.value;
        if(card.download)card.download.disabled=loading||busy||!select.value;
        for(const action of card.approvedActions||[])action.disabled=loading||busy||!select.value;
        for(const action of card.templateActions||[])action.disabled=loading||busy;
        card.open.disabled=loading||busy||(['initial','ledger','export','confirmation'].includes(key)&&!select.value);
      }
      for(const button of table.querySelectorAll('button'))button.disabled=loading||busy;
    }
    function renderCards(){
      const state=stored(select.value);
      for(const [key,card] of cards){
        if(!card.list)continue;
        const files=state.files[key]||[];
        card.list.replaceChildren();
        for(const file of files){
          const item=el('li'),name=el('span',file.name),download=button('下载');
          download.setAttribute('aria-label','下载 '+file.name);
          download.onclick=()=>void run(async()=>{
            if(await S.hash(file.blob)!==file.sha256)throw Error('原件校验失败。');
            S.download(file.blob,file.name);
          });
          if(root.AuditAttachmentPreview){
            const preview=button('预览');preview.setAttribute('aria-label','预览 '+file.name);
            const open=blob=>root.AuditAttachmentPreview.open({blob,name:file.name,sha256:file.sha256});
            preview.onclick=()=>open(file.blob);
            item.append(name,preview,download);
          }else item.append(name,download);
          card.list.append(item);
        }
        card.list.hidden=!files.length;
      }
    }
    function renderSummary(){
      body.replaceChildren();
      let visible=0;
      projects.forEach(project=>{
        const id=project.quoteId,source=project.source,workspace=workspaces.get(id),state=stored(id),tr=el('tr');
        const stage=visibleStage(state.currentStage);
        if([...filters].some(([key,value])=>(key==='currentStage'?stage:state[key])!==value))return;
        const type=workspace?.projectClassification?.projectType??source.projectType;
        const company=companyOf(project);
        const number=button(S.projectCode(workspace?.projectIdentity,workspace?.projectRegister?.riskLevel??source.riskLevel,type));
        number.className='text-button af-project-number';number.title='选择项目 '+(project.form.projectName||'');
        number.disabled=loading||busy;
        number.onclick=()=>{
          selectProgressProject(project);
          select.focus();
        };
        const companyLink=button(company||'—'),step=labels.get(stage),stepCell=el('td',step?undefined:'—');
        companyLink.className='text-button';companyLink.disabled=loading||busy;
        companyLink.title=project.form.projectName;
        companyLink.onclick=()=>openProgressStage(project,stage);
        if(step){
          const stepLink=button(step);
          stepLink.className='text-button';stepLink.disabled=loading||busy;
          stepLink.onclick=()=>openProgressStage(project,stage);
          stepCell.append(stepLink);
        }
        tr.dataset.auditFlowProject=id;tr.append(el('td',String(++visible)));
        const code=el('td'),companyCell=el('td');
        code.append(number);companyCell.append(companyLink);
        tr.append(code,companyCell,el('td',S.projectTypeLabel(type)||'—'),stepCell,el('td',state.completed||'—'),el('td',state.archived||'—'));
        const confirmer=el('td');
        tr.append(confirmer);
        if(id===select.value){
          const actions=el('div',undefined,'af-confirmer-actions'),edit=button('编辑进度');
          actions.append(el('span',state.confirmedBy||'—'),edit);confirmer.append(actions);
          edit.disabled=loading||busy;
          edit.onclick=()=>openProgress(id,state);
        }else confirmer.textContent=state.confirmedBy||'—';
        body.append(tr);
      });
      if(!visible){
        const emptyRow=el('tr'),cell=el('td',projects.length?'没有符合筛选条件的项目。':'暂无已立项项目。');
        cell.colSpan=8;emptyRow.append(cell);body.append(emptyRow);
      }
    }
    async function show(projectId){
      if(busy)return;
      const request=++ticket,selected=projectId??select.value;
      loading=true;lock();
      try{
        const found=await listProjects();
        const items=await Promise.all(found.map(async project=>[project.quoteId,await S.get(project.quoteId)]));
        if(request!==ticket)return;
        for(const [,workspace] of items)if(workspace.auditWorkflow)validate(workspace.auditWorkflow);
        projects=found;workspaces=new Map(items);
        const target=projectId&&projects.find(project=>project.quoteId===projectId);
        const company=projectId===undefined?companySelect.value:target?companyOf(target):'';
        const names=[...new Set(projects.map(companyOf).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
        options(companySelect,[['','全部被审计单位'],...names.map(name=>[name,name])]);
        companySelect.value=names.includes(company)?company:'';
        availableProjects(selected);
        renderCards();renderSummary();say('');
      }catch(error){if(request===ticket)say(error.message||'无法读取项目。',true);}
      finally{if(request===ticket){loading=false;lock();}}
    }
    select.onchange=()=>{renderCards();renderSummary();lock();say('');};
    companySelect.onchange=()=>{availableProjects(select.value,!!companySelect.value);select.onchange();};
    refresh.onclick=()=>void show();
    options(companySelect,[['','全部被审计单位']]);availableProjects('');renderCards();renderSummary();lock();
    return Object.freeze({show,selectedProject:()=>select.value});
  }
  root.AuditWorkflow=Object.freeze({mount,validate,canDownload,completionPatch,stageName:key=>labels.get(visibleStage(key))||''});
})(globalThis);
