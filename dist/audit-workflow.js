/* Per-project files and explicit progress for the audit workflow overview. */
(function(root){
  'use strict';
  const stages=[
    ['client','客户资料','资料清单与核对'],
    ['template','底稿模板','管理底稿模板'],
    ['export','全套底稿导出','下载已保存底稿'],
    ['review','项目复核','打开归档工作区'],
    ['report','报告初版（待核对）','打开报告编制']
  ];
  const labels=new Map(stages.map(([key,label])=>[key,label]));
  const visibleStage=key=>key==='print'?'review':key; // Legacy printing files are now shown under review.
  const choices=['','是','否'];
  const progressFields=[['completed','是否完成'],['archived','是否归档'],['confirmedBy','确认人']];
  const empty=()=>({schemaVersion:1,currentStage:'',completed:'',archived:'',confirmedBy:'',files:{}});
  const MiB=1024*1024;
  function validate(value){
    if(!value||value.schemaVersion!==1||Object.keys(value).length!==6||value.currentStage!==''&&!labels.has(visibleStage(value.currentStage))||
      !choices.includes(value.completed)||!choices.includes(value.archived)||typeof value.confirmedBy!=='string'||
      value.confirmedBy.length>100||!value.confirmedBy.isWellFormed()||/[\u0000-\u001f\u007f]/.test(value.confirmedBy)||
      !value.files||Object.getPrototypeOf(value.files)!==Object.prototype)throw Error('审计流程记录格式无效。');
    let total=0;
    for(const [key,files] of Object.entries(value.files)){
      if(!labels.has(visibleStage(key))||!Array.isArray(files)||files.length>10)throw Error('每个流程最多保存 10 份资料。');
      const hashes=new Set();
      for(const item of files){
        if(!item||typeof item.name!=='string'||!item.name||item.name.length>240||/[\\/\u0000-\u001f\u007f]/.test(item.name)||
          !/^[a-f0-9]{64}$/.test(item.sha256)||hashes.has(item.sha256)||!(item.blob instanceof Blob)||
          item.size!==item.blob.size||item.size<1||item.size>(root.AuditChecklist?.fileLimit?.(item.name)||12*MiB)||item.type!==item.blob.type||
          (key==='print'&&item.type!=='application/pdf'))throw Error('流程资料文件格式无效。');
        hashes.add(item.sha256);total+=item.size;
      }
    }
    if(total>150*MiB)throw Error('同一项目的流程资料最多保存 150 MiB。');
    return value;
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
    host.replaceChildren(controls,flow,summary,editor);
    let projects=[],workspaces=new Map(),loading=false,busy=false,ticket=0,editTarget=null;
    const companyOf=project=>workspaces.get(project.quoteId)?.projectInitiationDetails?.companyName||project.source.customerName||'';
    function availableProjects(selected,chooseSingle=false){
      const matching=projects.filter(project=>!companySelect.value||companyOf(project)===companySelect.value);
      options(select,[['','请选择已立项项目'],...matching.map(project=>[project.quoteId,project.form.projectName])]);
      select.value=matching.some(project=>project.quoteId===selected)?selected:chooseSingle&&matching.length===1?matching[0].quoteId:'';
    }
    let templateSelect,templateApply;
    const cards=new Map();
    const say=(message,error=false)=>{notice.textContent=message;notice.classList.toggle('error',error);};
    function stored(id){const value=workspaces.get(id)?.auditWorkflow;return value?validate(value):empty();}
    async function run(work){
      if(loading||busy)return;
      busy=true;lock();
      try{await work();}catch(error){
        const message=error.message||'流程操作未完成。';
        if(editor.open)editStatus.textContent=message;
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
        editor.close();renderSummary();say('进度已保存。');
      });
    };
    async function openWorkflowStage(key,action=key){
      const id=select.value;
      await run(async()=>{
        if(await openStage(action,id)!==true||!id)return;
        const workspace=await S.get(id),state=workspace.auditWorkflow?validate(workspace.auditWorkflow):empty();
        if(state.currentStage!==key)workspaces.set(id,await S.save(id,workspace.rev,{auditWorkflow:{...state,currentStage:key}}));
        else workspaces.set(id,workspace);
        renderSummary();
      });
    }
    async function refreshTemplates(){
      const prior=templateSelect.value;
      try{
        const store=await root.AuditTemplates.open();
        try{
          const {records}=await store.list();
          const known=records.filter(item=>root.WorkpaperRouting.identifyArchive(item.sha256));
          options(templateSelect,[['',known.length?'请选择资料库模板':'暂无可套用模板'],...known.map(item=>[item.sha256,item.name])]);
          if(known.some(item=>item.sha256===prior))templateSelect.value=prior;
        }finally{store.close();}
      }catch{options(templateSelect,[['','模板库读取失败']]);}
    }
    function applyTemplate(){
      const id=select.value,sha256=templateSelect.value;
      if(!id||!sha256)return;
      void run(async()=>{
        const workspace=await S.get(id),state=workspace.auditWorkflow?validate(workspace.auditWorkflow):empty();
        const store=await root.AuditTemplates.open();
        try{
          const next=await root.AuditTemplates.applyToProject({sha256,projectId:id,expectedRevision:workspace.rev,store,
            workspaceStore:{get:S.get,save:(key,rev,patch)=>S.save(key,rev,{...patch,auditWorkflow:{...state,currentStage:'template'}})}});
          workspaces.set(id,next);renderSummary();say('已应用所选底稿模板。');
        }finally{store.close();}
      });
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
        say(added?labels.get(key)+'已保存 '+added+' 份资料。':'所选资料已保存过。');
      });
    }
    for(const [key,title,action] of stages){
      const card=el('section',undefined,'panel af-stage'),list=el('ul',undefined,'af-files'),open=button(action);
      card.dataset.workflowStage=key;
      card.append(el('h2',title));
      let file,count,download;
      if(key==='export')open.classList.add('primary');
      else if(key==='template'){
        templateSelect=el('select',undefined,'af-template-select');
        templateSelect.setAttribute('aria-label','选择资料库模板');
        templateSelect.onchange=lock;
        options(templateSelect,[['','请选择资料库模板']]);
        templateApply=button('应用模板');templateApply.classList.add('primary');templateApply.onclick=applyTemplate;
        card.append(templateSelect,templateApply);
      }
      else if(key==='report'){
        download=button('下载报告初版');
        download.classList.add('primary');
        download.onclick=()=>void openWorkflowStage(key,'report-download');
        card.append(download);
      }else{
        const drop=el('label',undefined,'af-drop'),icon=el('span','＋','af-add');
        file=el('input');count=el('span',undefined,'af-count');
        file.type='file';file.multiple=true;
        file.accept=Object.keys(A.FILE_TYPES).map(ext=>'.'+ext).join(',');
        file.setAttribute('aria-label','上传'+title);icon.setAttribute('aria-hidden','true');
        drop.append(file,icon,el('strong','拖入或选择文件'),count);
        card.append(drop);
        file.onchange=()=>{const files=Array.from(file.files);file.value='';void upload(key,files);};
        drop.ondragover=event=>{if(!Array.from(event.dataTransfer.types).includes('Files'))return;event.preventDefault();drop.classList.add('is-dragover');};
        drop.ondragleave=()=>drop.classList.remove('is-dragover');
        drop.ondrop=event=>{event.preventDefault();drop.classList.remove('is-dragover');void upload(key,Array.from(event.dataTransfer.files));};
      }
      card.append(open,list);flow.append(card);
      cards.set(key,{file,list,open,count,download});
      open.onclick=()=>void openWorkflowStage(key);
    }
    function lock(){
      companySelect.disabled=select.disabled=loading||busy;
      refresh.disabled=loading||busy;
      cancel.disabled=save.disabled=busy;
      for(const input of editInputs.values())input.disabled=busy;
      templateSelect.disabled=loading||busy||templateSelect.options.length<2;
      templateApply.disabled=loading||busy||!select.value||!templateSelect.value;
      for(const [key,card] of cards){
        if(card.file)card.file.disabled=loading||busy||!select.value;
        if(card.download)card.download.disabled=loading||busy||!select.value;
        card.open.disabled=loading||busy||!select.value&&key==='export';
      }
      for(const button of summary.querySelectorAll('button'))button.disabled=loading||busy;
    }
    function renderCards(){
      const state=stored(select.value);
      for(const [key,card] of cards){
        const files=key==='review'?[...(state.files.review||[]),...(state.files.print||[])]:state.files[key]||[];
        if(card.count)card.count.textContent=files.length?files.length+' 份资料':'';
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
            preview.onclick=()=>root.AuditAttachmentPreview.open({blob:file.blob,name:file.name,sha256:file.sha256});
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
        const company=workspace?.projectInitiationDetails?.companyName??source.customerName;
        const number=button(workspace?.projectIdentity&&workspace.projectRegister?.riskLevel&&S.PROJECT_TYPES.includes(type)
          ?S.businessNumber(workspace.projectIdentity,workspace.projectRegister.riskLevel,type):id);
        number.className='text-button';number.title='选择项目 '+(project.form.projectName||'');
        number.disabled=loading||busy;
        number.onclick=()=>{
          if(companySelect.value&&companySelect.value!==companyOf(project))companySelect.value='';
          availableProjects(id);select.onchange();
        };
        tr.dataset.auditFlowProject=id;tr.append(el('td',String(++visible)));
        const code=el('td');code.append(number);tr.append(code,el('td',company||'—'),el('td',type||'—'));
        for(const value of [labels.get(stage),state.completed,state.archived,state.confirmedBy])tr.append(el('td',value||'—'));
        if(id===select.value){
          const edit=button('编辑进度');tr.lastChild.append(edit);
          edit.disabled=loading||busy;
          edit.onclick=()=>openProgress(id,state);
        }
        body.append(tr);
      });
      if(!visible){
        const emptyRow=el('tr'),cell=el('td',projects.length?'没有符合筛选条件的项目。':'暂无已立项项目。');
        cell.colSpan=8;emptyRow.append(cell);body.append(emptyRow);
      }
    }
    async function show(){
      if(busy)return;
      const request=++ticket,selected=select.value;
      loading=true;lock();
      try{
        const [found]=await Promise.all([listProjects(),refreshTemplates()]);
        const items=await Promise.all(found.map(async project=>[project.quoteId,await S.get(project.quoteId)]));
        if(request!==ticket)return;
        for(const [,workspace] of items)if(workspace.auditWorkflow)validate(workspace.auditWorkflow);
        projects=found;workspaces=new Map(items);
        const company=companySelect.value;
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
  root.AuditWorkflow=Object.freeze({mount,validate,stageName:key=>labels.get(visibleStage(key))||''});
})(globalThis);
