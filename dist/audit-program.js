/* Project-local material hierarchy and review. Operator entries are not authenticated signatures. */
(function(root){
  'use strict';
  function mount(host,{listProjects,onProjectReady,compact=false}){
    const doc=host.ownerDocument,A=root.AuditChecklist,O=root.AuditOutline,T=root.AuditMaterialTemplate,P=root.MaterialPreservation;
    const TRIAL=A.TRIAL_ID,trialProject=Object.freeze({quoteId:TRIAL,form:{projectName:'独立试用项目（不关联立项）'},source:{firmName:''}});
    const demoText='一、试用资料\n1、演示：企业基本资料\n2、演示：本期财务报表\n二、试用核对\n3、演示：合同清单';
    const el=(tag,text,cls)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
    const button=(txt,id)=>{const b=el('button',txt,'btn');b.type='button';if(id)b.id=id;return b;};
    const input=(id,placeholder,max=100)=>{const e=el('input');e.id=id;e.type='text';e.placeholder=placeholder;e.maxLength=max;return e;};
    const label=(txt,e)=>{const l=el('label',txt);l.append(e);return l;};
    const option=(v,t)=>{const o=el('option',t);o.value=v;return o;};
    const top=el('section',undefined,'panel ac-top'),company=el('select'),selection=el('select'),refresh=button('刷新已立项项目','ac-refresh'),
      reviewer=input('ac-reviewer','填写本次核对人'),reason=input('ac-reason','替换清单／移除文件时必填',1000),file=el('input'),mode=el('select'),
      status=el('p','请选择已保存的立项项目。','ac-status'),summary=el('p','尚未导入资料清单。','ac-summary'),
      exportBtn=button('导出清单与核对记录 JSON','ac-export'),
      templateBox=el('section',undefined,'ac-template-box'),templateInfo=el('p'),useTemplate=button('使用2026修正版模板','ac-use-template'),categoryNav=el('nav',undefined,'ac-category-nav'),body=el('section',undefined,'panel ac-list'),filter=el('select'),search=input('ac-search','搜索标题、说明或资料项',100),
      pendingBox=el('div',undefined,'ac-import-pending'),pendingText=el('p'),pendingContinue=button('补齐后导入','ac-import-continue'),pendingCancel=button('取消本次导入','ac-import-cancel'),preview=el('div',undefined,'ac-outline-preview'),
      outlineStats=el('p',undefined,'tiny'),outlineCount=el('p',undefined,'ac-outline-count'),warning=el('p',undefined,'ac-outline-warning'),ack=el('input'),ackLabel=label('我已核对标题层级、正文说明的归属及末级上传项',ack),
      caption=el('p',undefined,'muted'),trialNote=el('p','独立试用','ac-trial-note');
    const preservationExport=button('导出资料保全包','ac-preservation-export'),preservationImport=button('恢复资料保全包','ac-preservation-import'),preservationFile=el('input'),preservationBox=el('section',undefined,'ac-import-pending'),preservationSummary=el('div'),preservationNotice=el('p'),preservationAck=el('input'),preservationRestore=button('确认恢复到当前空资料区','ac-preservation-restore'),preservationCancel=button('取消本次恢复','ac-preservation-cancel'),preservationTrial=button('恢复到独立试用空资料区','ac-preservation-target-trial');
    preservationFile.id='ac-preservation-file';preservationFile.type='file';preservationFile.accept='.zip,application/zip';preservationFile.hidden=true;preservationBox.id='ac-preservation-preview';preservationBox.hidden=true;preservationSummary.id='ac-preservation-summary';preservationNotice.id='ac-preservation-notice';preservationNotice.setAttribute('role','status');preservationAck.id='ac-preservation-confirm';preservationAck.type='checkbox';preservationBox.append(el('h3','资料保全包恢复预检'),preservationSummary,preservationNotice,preservationTrial,label('我已核对同一项目UUID、正式／试用范围及空目标；仅恢复本机历史，不作为当前员工签审。',preservationAck),preservationRestore,preservationCancel);
    pendingBox.id='ac-import-pending';pendingBox.hidden=true;pendingBox.setAttribute('role','status');preview.id='ac-outline-preview';ack.type='checkbox';ack.id='ac-outline-confirm';ackLabel.className='ac-outline-ack';
    outlineCount.id="ac-outline-count";pendingBox.append(pendingText,outlineStats,outlineCount,warning,preview,ackLabel,pendingContinue,pendingCancel);
    reviewer.setAttribute('aria-required','true');trialNote.id='ac-trial-note';trialNote.hidden=true;company.id='ac-company';selection.id='ac-project';file.id='ac-import';file.type='file';file.accept='.txt,.docx,.doc';status.id='ac-status';status.setAttribute('role','status');summary.id='ac-summary';
    mode.id='ac-import-mode';mode.append(option('auto','自动识别资料清单'),option('outline','读取 Word 真实标题级别'),option('numbered','按编号整理层级（预览确认）'),option('legacy','旧版行式导入（仅兼容）'));
    for(const [v,t]of[['all','全部状态'],['pending','待提供'],['received','已收到 · 未核对'],['confirmed','核对通过'],['na','不适用'],['problem','存在问题']])filter.append(option(v,t));
    filter.id='ac-filter';
    const projectFields=el('div',undefined,'ac-fields'),fields=el('div',undefined,'ac-fields');
    projectFields.append(label('被审计单位',company),label(compact?'审计项目名称':'审计项目',selection));
    fields.append(label('核对人（必填，人工填写）',reviewer),label('操作理由',reason));
    const actions=el('div',undefined,'ac-actions');actions.append(refresh,label('识别方式',mode),label('读取资料清单（TXT／DOCX／DOC）',file),exportBtn,preservationExport,preservationImport,preservationFile);
    templateBox.id='ac-template-box';templateBox.append(el('span','WORD STRUCTURE · 2026','ac-template-eyebrow'),el('h3','2026审计资料清单 · 修正版'),templateInfo,useTemplate);categoryNav.id='ac-category-nav';categoryNav.setAttribute('aria-label','资料分类导航');ackLabel.replaceChildren(ack,doc.createTextNode('我已核对标题层级、正文说明的归属及末级上传项'));
    const tools=el('div',undefined,'ac-tools');tools.append(filter,search);
    const templateDialog=compact?el('dialog',undefined,'ac-template-dialog'):null;
    const uploadCustom=button('上传自制清单','ac-upload-custom'),reviewImport=input('ac-import-reviewer','填写本次核对人');
    const importError=el('p',undefined,'ac-status'),previewTitle=el('h2');
    if(compact){
      projectFields.classList.add('ac-project-fields');
      file.hidden=true;file.accept='.doc,.docx,.txt,.xls,.xlsx';file.setAttribute('aria-label','选择自制清单文件');
      uploadCustom.onclick=()=>file.click();
      globalThis.ShenyiFileDrop?.bind(uploadCustom,file,{material:'自制清单'});
      projectFields.append(label('核对人',reviewer),uploadCustom,file);
      status.textContent='';
      previewTitle.id='ac-template-dialog-title';templateDialog.setAttribute('aria-labelledby',previewTitle.id);
      importError.setAttribute('role','status');templateDialog.append(previewTitle,label('本次核对人',reviewImport),pendingBox,importError);
      templateDialog.addEventListener('cancel',event=>{event.preventDefault();pendingCancel.click();});
      top.append(el('h2','资料清单与逐项确认'),projectFields,status,templateDialog);
      body.append(summary);
    }else{
      globalThis.ShenyiFileDrop?.bind(preservationImport,preservationFile,{material:'资料保全包'});
      globalThis.ShenyiFileDrop?.bind(file.parentElement,file,{material:'资料清单'});
      top.append(el('h2','资料清单与逐项确认'),projectFields,fields,templateBox,actions,pendingBox,preservationBox,trialNote,caption,summary,status);
    }
    body.append(categoryNav,tools);host.replaceChildren(top,body);const rows=el('div');rows.id='ac-rows';body.append(rows);
    let db=null,projectDb=null,trialDb=null,projects=[],record=null,active='',serial=0,busy=false,pendingImport=null,pendingMaterial=null,pendingPreservation=null,preservationEpoch=0,preservationPhase='',preservationRecoveryTarget=false;const groupOpen=new Map();
    const names={pending:'待提供',received:'已收到 · 未核对',confirmed:'核对通过',na:'不适用',problem:'存在问题'};
    const say=(s,bad=false)=>{status.textContent=s;status.classList.toggle('error',bad);};
    const isTrial=()=>active===TRIAL,selected=()=>isTrial()?trialProject:projects.find(x=>x.quoteId===active);
    const projectOf=p=>({quoteId:p.quoteId,projectName:p.form.projectName,firmName:p.source.firmName});
    const rejectDialog=el('dialog',undefined,'af-progress-editor'),rejectForm=el('form'),rejectHeading=el('h2','打回资料'),
      rejectSubject=el('p'),rejectReviewer=input('ac-reject-reviewer','填写本次核对人'),rejectReason=el('textarea'),
      rejectError=el('p',undefined,'ac-status'),rejectActions=el('div',undefined,'af-progress-actions'),
      rejectCancel=button('取消'),rejectSubmit=button('确认打回');
    let rejectTarget=null;
    rejectHeading.id='ac-reject-title';rejectDialog.setAttribute('aria-labelledby',rejectHeading.id);
    rejectReason.maxLength=1000;rejectReason.required=rejectReviewer.required=true;rejectError.setAttribute('role','status');
    rejectSubmit.type='submit';rejectSubmit.classList.add('primary');rejectCancel.onclick=()=>rejectDialog.close();
    rejectDialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
    rejectDialog.addEventListener('close',()=>{rejectTarget=null;});
    rejectActions.append(rejectCancel,rejectSubmit);rejectForm.append(rejectHeading,rejectSubject,label('核对人',rejectReviewer),
      label('打回原因',rejectReason),rejectError,rejectActions);rejectDialog.append(rejectForm);top.append(rejectDialog);
    rejectForm.onsubmit=e=>{
      e.preventDefault();
      const target=rejectTarget;if(!target||!rejectDialog.open)return;
      const operator=rejectReviewer.value.trim(),explanation=rejectReason.value.trim();
      if(!operator||!explanation){rejectError.textContent=operator?'请填写打回原因。':'请填写核对人。';(operator?rejectReason:rejectReviewer).focus();return;}
      void run(async()=>{
        try{
          if(active!==target.project||record?.revision!==target.rev||record.closed)throw Error('资料清单已更新，请关闭后重新打开该资料项。');
          const result=await db.change(active,target.rev,{type:'item',id:target.id,status:'problem',evidence:target.evidence,reason:explanation,reviewer:operator});
          record=result;reviewer.value=operator;rejectDialog.close();render();say('本项资料已打回。');
        }catch(error){rejectError.textContent=error.message||'打回未保存，请重试。';}
      });
    };
    const companyName=p=>p.companyName||p.source.customerName||'未填写被审计单位';
    function projectOptions(current,chooseSingle=false){
      const filtered=projects.filter(project=>!company.value||companyName(project)===company.value);
      selection.replaceChildren(option('','请选择已保存的立项'));
      if(!company.value)trialOption();
      for(const project of filtered)selection.append(option(project.quoteId,project.form.projectName));
      selection.value=current&&Array.from(selection.options).some(item=>item.value===current)?current:
        chooseSingle&&filtered.length===1?filtered[0].quoteId:'';
    }
    function clearPreservation(){preservationEpoch++;pendingPreservation=null;preservationFile.value='';preservationBox.hidden=true;preservationSummary.replaceChildren();preservationNotice.textContent='';preservationAck.checked=false;preservationRestore.hidden=true;preservationTrial.hidden=true;}
    function clearPending(){pendingImport=null;pendingBox.hidden=true;pendingText.textContent='';preview.replaceChildren();ack.checked=false;templateDialog?.close();clearPreservation();}
    function clearUploads(){pendingMaterial=null;}
    function missingField(control,message){control.setAttribute('aria-invalid','true');say(message,true);setTimeout(()=>{if(!busy&&!control.disabled)control.focus();},0);return false;}
    function requireReviewer(){reviewer.removeAttribute('aria-invalid');return reviewer.value.trim()?true:missingField(reviewer,'请先填写「核对人」，再保存或核对资料。');}
    function importFields(replacing){
      reviewer.removeAttribute('aria-invalid');reason.removeAttribute('aria-invalid');
      if(!reviewer.value.trim())return missingField(reviewer,'请填写「核对人」。已读取的清单会保留，补齐后点「补齐后导入」。');
      if(!compact&&replacing&&!reason.value.trim())return missingField(reason,'替换当前清单前，请填写「操作理由」，例如：改用2026资料清单。文件已保留，不用重新选择。');
      return true;
    }
    reviewer.addEventListener('input',()=>reviewer.removeAttribute('aria-invalid'));reason.addEventListener('input',()=>reason.removeAttribute('aria-invalid'));
    async function storage(key){if(key===TRIAL)return trialDb||(trialDb=await A.openTrial());return projectDb||(projectDb=await A.open());}
    function trialOption(){if(!Array.from(selection.options).some(o=>o.value===TRIAL))selection.append(option(TRIAL,'独立试用（不关联立项）'));}
    function controls(){
      company.disabled=selection.disabled=refresh.disabled=mode.disabled=busy;file.disabled=busy||!selected()||!!record?.closed;
      useTemplate.disabled=busy||!selected()||!!record?.closed||!T;for(const b of categoryNav.querySelectorAll('button'))b.disabled=busy;
      pendingContinue.disabled=busy||!pendingImport||!!record?.closed||!!(pendingImport?.rows||pendingImport?.template)&&!ack.checked;pendingCancel.disabled=busy;
      for(const x of preview.querySelectorAll('select'))x.disabled=busy;ack.disabled=busy;
      reviewer.disabled=reason.disabled=busy;exportBtn.disabled=busy||!record;
      uploadCustom.disabled=file.disabled;reviewImport.disabled=busy;
      rejectSubmit.disabled=rejectCancel.disabled=rejectReason.disabled=rejectReviewer.disabled=busy;
      preservationExport.disabled=busy||!record||!preservationAvailable();preservationImport.disabled=busy||!preservationAvailable();preservationFile.disabled=busy||!preservationAvailable();const restoreReady=!!pendingPreservation&&pendingPreservation.targetKnown&&pendingPreservation.matches&&!record&&pendingPreservation.targetEmpty&&preservationCurrent(pendingPreservation.context);preservationRestore.hidden=!restoreReady;preservationRestore.disabled=busy||!restoreReady||!preservationAck.checked;preservationAck.disabled=busy||!restoreReady;preservationTrial.hidden=!pendingPreservation||!preservationIsTrial(pendingPreservation.summary)||active===TRIAL;preservationTrial.disabled=busy;preservationCancel.disabled=preservationPhase==='restore';
      for(const x of rows.querySelectorAll('input,select,button'))x.disabled=busy||!!record?.closed&&!x.hasAttribute('data-material-download')&&!x.hasAttribute('data-material-preview');
      for(const x of rows.querySelectorAll('[data-approved-attachment]'))x.disabled=true;
      for(const x of rows.querySelectorAll('[data-confirm-item],[data-reject-item]')){const id=x.dataset.confirmItem||x.dataset.rejectItem,choice=x.closest('[data-material-id]')?.querySelector('[data-item-status]');x.disabled=busy||!!record?.closed||!record?.states[id]||record.states[id].status==='na'||choice?.value==='na';}
      if(compact)for(const x of rows.querySelectorAll('[data-confirm-item][aria-pressed=true]')){x.disabled=true;x.title='本项资料已核对通过。';}
    }
    const preservationNamespace=key=>key===TRIAL?'hengdu.audit.materials.trial.v1':'hengdu.audit.materials.v1';
    function preservationAvailable(){return !!P&&typeof P.inspect==='function';}
    function preservationContext(){return {key:active,serial,epoch:preservationEpoch};}
    function preservationCurrent(context){return context.key===active&&context.serial===serial&&context.epoch===preservationEpoch&&selection.value===active&&host.isConnected&&host.contains(top)&&!top.closest('[hidden]')&&(!active||selected()?.quoteId===active);}
    function assertPreservationContext(context){if(!preservationCurrent(context))throw Error('项目或预检视图已变化，请重新选择保全包核对。');}
    function preservationIsTrial(value){return value?.projectId===TRIAL&&value.sourceNamespace==='hengdu.audit.materials.trial.v1';}
    function preservationSummaryValid(value){const keys=['projectId','projectName','firmName','sourceNamespace','recordSchema','revision','generationId','closed','nodeCount','fileCount','currentFileCount','historicalFileCount','totalBytes','packageSha256'];return !!value&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))&&['projectId','projectName','firmName','sourceNamespace'].every(key=>typeof value[key]==='string')&&[1,2].includes(value.recordSchema)&&Number.isSafeInteger(value.revision)&&value.revision>=1&&(value.generationId===null||typeof value.generationId==='string')&&typeof value.closed==='boolean'&&['nodeCount','fileCount','currentFileCount','historicalFileCount','totalBytes'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)&&value.currentFileCount+value.historicalFileCount===value.fileCount&&typeof value.packageSha256==='string'&&/^[a-f0-9]{64}$/u.test(value.packageSha256);}
    function preservationOrigin(result){if(result?.manifest?.schemaVersion!==2)return null;const value=result.manifest.origin,keys=['teamId','projectId','sourceProjectId','resourceKind','projectStatus','projectRevision','materialRevision','recordSha256','recordByteLength','filesSha256','serverId','planSha256'];if(!value||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key))||value.sourceProjectId!==result.summary.projectId||result.summary.sourceNamespace!=='hengdu.audit.materials.v1'||result.manifest.policy?.teamImported!==true)throw Error('团队保全包来源摘要无效，未写入资料。');return {...value};}
    function renderPreservation(){const job=pendingPreservation;preservationSummary.replaceChildren();if(!job){controls();return;}preservationBox.hidden=false;const s=job.summary;for(const text of ['包文件：'+job.name,'包内项目：'+s.projectName+' · '+s.firmName,'项目UUID：'+s.projectId,'来源资料区：'+(preservationIsTrial(s)?'独立试用':'正式项目'),'清单schema '+s.recordSchema+' · 修订 '+s.revision+' · 代次 '+(s.generationId||'旧版行式')+' · '+(s.closed?'原清单已关门':'原清单未关门'),'标题/资料项 '+s.nodeCount+' · 全部原件 '+s.fileCount+' · 当前原件 '+s.currentFileCount+' · 历史原件 '+s.historicalFileCount+' · 总字节 '+s.totalBytes,'包SHA-256：'+s.packageSha256])preservationSummary.append(el('p',text,'tiny'));if(job.origin){const o=job.origin;for(const text of ['团队来源声明（未验签）：服务器 '+o.serverId+' · 团队 '+o.teamId,'团队资料区W：'+o.projectId+' · 原项目Q：'+o.sourceProjectId,'来源类型 '+o.resourceKind+' · 状态 '+o.projectStatus+' · 项目版本 '+o.projectRevision+' · 材料版本 '+o.materialRevision,'来源声明不认证服务器或员工身份，不证明当前团队授权或专业签发。','仅恢复同Q空本机资料区的原记录与原件，不继承团队权限；团队来源不会写入本机记录。请另留原v2包，本机以后再导出不保留团队来源。'])preservationSummary.append(el('p',text,'tiny'));}preservationSummary.append(el('p','包内历史核对人、核对通过和关门留痕仅作为原历史保存，不认证当前员工或新增审计结论；不预览或执行附件正文。','tiny'));preservationNotice.textContent=!active?'尚未选择恢复目标。正式包须先选择既有立项，再重新选包；试用包可明确进入独立试用空资料区。':!job.matches?'所选项目UUID或正式／试用范围不匹配，不可恢复。':!job.targetKnown?'正在核对当前目标是否已有清单…':!job.targetEmpty||record?'目标已有资料清单，不能覆盖（包括已关门或损坏记录）。':'当前未见目标清单；孤立文件、全局原件ID冲突和空态将在最终恢复事务再次核验。';controls();}
    async function runPreservation(context,phase,fn){if(busy)return;busy=true;preservationPhase=phase;controls();try{await fn();}catch(error){if(preservationCurrent(context)){if(phase==='inspect'||phase==='target'){clearPreservation();preservationBox.hidden=false;preservationNotice.textContent=error?.message||'保全包预检未通过，未写入资料。';}say(error?.message||'资料保全操作未完成，请刷新核对。',true);}}finally{busy=false;preservationPhase='';controls();}}
    async function inspectPreservation(immutable,name){clearPending();clearUploads();const context=preservationContext();if(!preservationCurrent(context))return;preservationBox.hidden=false;preservationNotice.textContent='正在完整校验保全包、记录及全部原件，预检不会写库…';await runPreservation(context,'inspect',async()=>{assertPreservationContext(context);const result=await P.inspect(immutable,{assertCurrent:()=>assertPreservationContext(context)});assertPreservationContext(context);if(!preservationSummaryValid(result?.summary)||result.sha256!==result.summary.packageSha256)throw Error('保全包摘要格式无效，未写入资料。');const job={file:immutable,name,sha256:result.sha256,summary:{...result.summary},origin:preservationOrigin(result),context,targetKnown:false,targetEmpty:false,matches:!!active&&result.summary.projectId===active&&result.summary.sourceNamespace===preservationNamespace(active)};pendingPreservation=job;if(active){const store=await storage(active),target=await store.get(active);assertPreservationContext(context);record=target;job.targetKnown=true;job.targetEmpty=target===null;render();}renderPreservation();say('保全包预检已完成，尚未恢复；请核对同UUID空目标、范围和历史说明。');});}
    async function exportPreservation(){if(busy||!record||!active||!preservationAvailable())return;clearPending();const context=preservationContext(),signature=JSON.stringify(record);await runPreservation(context,'export',async()=>{const store=await storage(context.key);assertPreservationContext(context);if(typeof store.exportPreservation!=='function')throw Error('本机资料保全组件未就绪，未请求下载。');const result=await store.exportPreservation(context.key,{assertContext:()=>assertPreservationContext(context)});assertPreservationContext(context);const current=await store.get(context.key);assertPreservationContext(context);if(JSON.stringify(current)!==signature)throw Error('源资料清单已变化，请刷新后重新导出；未请求下载。');if(!preservationSummaryValid(result?.summary)||result.sha256!==result.summary.packageSha256)throw Error('保全包结果无法确认，未请求下载。');download(result.blob,'资料保全-'+context.key+'-r'+result.summary.revision+'-'+result.sha256.slice(0,12)+'.zip');say('已请求下载资料保全包：清单留痕引用的全部原件 '+result.summary.fileCount+' 份，包含已移除及旧代原件；源资料未改动。');});}
    function cancelPreservation(){if(preservationPhase==='restore'){say('恢复请求已提交，不能视为撤回；请完成后刷新目标核对。',true);return;}const wasTrial=preservationRecoveryTarget;clearPreservation();preservationRecoveryTarget=false;if(wasTrial){serial++;active='';selection.value='';record=null;render();}controls();say('已取消本次恢复预检，未发出恢复写入；不会自动创建试用模板。');}
    async function targetTrialPreservation(){const prior=pendingPreservation;if(busy||!prior||!preservationIsTrial(prior.summary)||!preservationCurrent(prior.context))return;clearPending();clearUploads();serial++;active=TRIAL;company.value='';projectOptions(TRIAL);record=null;preservationRecoveryTarget=true;render();const context=preservationContext(),job={...prior,context,targetKnown:false,targetEmpty:false,matches:true};pendingPreservation=job;renderPreservation();await runPreservation(context,'target',async()=>{const store=await storage(TRIAL),target=await store.get(TRIAL);assertPreservationContext(context);record=target;job.targetKnown=true;job.targetEmpty=target===null;render();renderPreservation();say(target?'独立试用已有资料，不能覆盖。':'已明确选择独立试用恢复空目标，未自动创建模板；请核对后确认恢复。');});}
    async function restorePreservation(){const job=pendingPreservation;if(busy||!job||!job.matches||!job.targetKnown||!job.targetEmpty||record||!active||!preservationAck.checked||!preservationCurrent(job.context))return;if(!root.confirm('确认将此资料保全包恢复到同UUID、同正式／试用范围的空本机资料区？会保留包内历史与关门状态，不作为当前员工签审；不会覆盖现有资料。'+(job.origin?' 团队来源不会写入本机记录，不继承团队权限；请另留原v2包，本机再导出不保留团队来源。':''))){cancelPreservation();return;}const context=job.context;preservationAck.checked=false;await runPreservation(context,'restore',async()=>{const store=await storage(context.key);assertPreservationContext(context);if(typeof store.restorePreservation!=='function')throw Error('本机恢复组件未就绪，未写入资料。');const result=await store.restorePreservation(context.key,job.file,{expectedSha256:job.sha256,assertContext:()=>assertPreservationContext(context)});if(!preservationCurrent(context))return;pendingPreservation=null;preservationAck.checked=false;preservationRecoveryTarget=false;let refreshed=false;try{record=result.record;A.validate(record);render();const current=await store.get(context.key);assertPreservationContext(context);if(!current)throw Error('恢复后的清单暂未读到。');record=current;render();refreshed=true;}catch(error){if(!preservationCurrent(context))return;}clearPreservation();say((refreshed?'资料保全包已恢复到同UUID本机资料区，原修订、代次、关门及历史原件保持。':'资料保全包已恢复，但列表刷新未确认；请刷新当前项目核对，不要重复恢复。')+(job.origin?' 团队来源未写入本机记录，不继承团队权限；请另留原v2包，本机以后再导出不保留团队来源。':''),!refreshed);});}
    preservationExport.onclick=()=>void exportPreservation();preservationImport.onclick=()=>{if(!busy&&preservationAvailable())preservationFile.click();};preservationFile.onchange=()=>{const source=preservationFile.files?.[0];preservationFile.value='';if(busy)return;if(!source){cancelPreservation();return;}if(!Number.isSafeInteger(source.size)||source.size<1||source.size>180*1024*1024||typeof source.slice!=='function'){clearPreservation();say('请选择不超过180MiB的非空资料保全ZIP包，未写入资料。',true);return;}void inspectPreservation(source.slice(0,source.size,source.type||'application/zip'),source.name);};preservationAck.onchange=controls;preservationCancel.onclick=cancelPreservation;preservationTrial.onclick=()=>void targetTrialPreservation();preservationRestore.onclick=()=>void restorePreservation();
    let preservationViewHidden=!!top.closest('[hidden]');const preservationObserver=typeof root.MutationObserver==='function'?new root.MutationObserver(()=>{const hidden=!host.contains(top)||!!top.closest('[hidden]');if(hidden&&!preservationViewHidden)clearPreservation();preservationViewHidden=hidden;if(!host.contains(top))preservationObserver.disconnect();}):null;preservationObserver?.observe(host,{subtree:true,attributes:true,attributeFilter:['hidden'],childList:true});for(let ancestor=host.parentElement;ancestor;ancestor=ancestor.parentElement)preservationObserver?.observe(ancestor,{attributes:true,attributeFilter:['hidden']});root.addEventListener?.('beforeunload',()=>{clearPreservation();preservationObserver?.disconnect();});
    const describe=(n,container)=>{if(n.description){const p=el('p',n.description,'ac-description');container.append(p);}};
    function download(blob,name){const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
    async function commitMaterial(){
      const job=pendingMaterial;if(!job)return;if(!requireReviewer())return;
      if(job.key!==active||job.token!==serial||!record||record.schema!==2||job.revision!==record.revision){clearUploads();render();throw Error('清单或项目已变化，请重新选择资料文件；未覆盖已有核对。');}
      try{while(job.files.length){record=await db.attach(active,job.revision,job.nodeId,job.files[0],reviewer.value);job.files.shift();job.revision=record.revision;}clearUploads();say(root.SaveFeedback?.saved('资料已保存在该标题下，状态为「已收到 · 未核对」。请核对后再点「核对通过」。')??('资料已保存在该标题下，状态为「已收到 · 未核对」。请核对后再点「核对通过」。'));}finally{render();}
    }
    function leafCard(item,tree=false){
      const s=record.states[item.id],card=el('article',undefined,'ac-item'+(tree?' ac-tree-leaf':''));card.dataset.materialId=item.id;card.dataset.reviewStatus=s.status;card.classList.toggle('ac-item-confirmed',s.status==='confirmed');card.classList.toggle('ac-item-rejected',s.status==='problem');
      const header=el('div',undefined,'ac-item-head'),title=tree?button(item.title):el('strong',item.number+'、'+item.text);
      if(tree){title.classList.add('ac-upload-title');title.dataset.uploadNode=item.id;title.title='拖入或点击选择此项资料，可多选';}
      header.append(title);
      const state=el('select');state.setAttribute('aria-label',(tree?item.title:'第 '+item.number+' 项')+'状态');state.dataset.itemStatus=item.id;
      const displayedStatus={confirmed:'已通过',received:'待审核',problem:'未通过',pending:'待提供',na:'不适用'};
      for(const [v,t]of [['pending',compact&&s.status!=='na'?displayedStatus[s.status]:'待提供'],['na','不适用']])state.append(option(v,t));
      state.value=s.status==='na'?'na':'pending';state.title='这里只选择资料是否仍需提供；实际接收与核对状态单独保留。';
      const stateArea=el('div',undefined,'ac-state-area'),recorded=el('small','记录状态：'+names[s.status],'ac-record-state');recorded.dataset.recordState=item.id;stateArea.append(state);if(!compact)stateArea.append(recorded);header.append(stateArea);state.onchange=controls;card.append(header);
      if(!compact&&s.status==='confirmed'){const feedback=el('div',undefined,'ac-confirmed-feedback');feedback.dataset.confirmedFeedback=item.id;feedback.setAttribute('role','status');feedback.append(el('strong','✓ 已核对通过'),el('span','核对人：'+s.reviewer+' · '+new Date(s.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})),el('small','当前资料已通过本项核对；修改资料或核对内容并保存后，需要重新核对。'));card.append(feedback);}
      let previewRow=null;
      if(tree){
        describe(item,card);const picker=el('input');picker.type='file';picker.hidden=true;picker.multiple=true;picker.id='ac-file-'+item.id;picker.accept=Object.keys(A.FILE_TYPES).map(ext=>'.'+ext).join(',');card.append(picker);
        const canChoose=()=>{
          if(pendingMaterial&&pendingMaterial.nodeId!==item.id&&!root.confirm('另一个标题还有未保存的所选文件。放弃它们并选择本项资料？'))return false;
          if(pendingMaterial?.nodeId!==item.id)clearUploads();
          return true;
        };
        title.onclick=()=>{if(canChoose())picker.click();};
        globalThis.ShenyiFileDrop?.bind(title,picker,{material:item.title,beforeDrop:canChoose,title:'上传'+item.title,limit:'压缩包 100 MiB，其他文件 12 MiB'});
        picker.onchange=()=>{const fs=Array.from(picker.files||[]);picker.value='';if(!fs.length)return;
          const current=record.attachments[item.id]||[];if(fs.length+current.length>10){say('每个资料项最多 10 个附件，请减少本次选择。',true);return;}
          if(fs.some(f=>!f.size||f.size>A.fileLimit(f.name)||!/\.(?:pdf|docx?|xlsx?|png|jpe?g|txt|zip|rar)$/iu.test(f.name))){say('请选择支持的非空资料文件。ZIP／RAR 单份不超过 100 MiB，其他资料不超过 12 MiB。',true);return;}
          pendingMaterial={key:active,token:serial,revision:record.revision,nodeId:item.id,files:fs};render();void run(commitMaterial);
        };
        const files=record.attachments[item.id]||[],list=el('ul',undefined,'ac-material-files');
        for(const f of files){
          const li=el('li'),get=button('下载原件'),peek=button(f.name+' · 预览'),remove=button('移除');peek.dataset.materialPreview=f.id;peek.title='点击预览附件';peek.onclick=()=>void run(async()=>{const got=await db.downloadAttachment(active,item.id,f.id);root.AuditAttachmentPreview.open({blob:got.blob,name:got.metadata.name,sha256:got.metadata.sha256});});get.dataset.materialDownload=f.id;get.title='下载此项已保存资料';
          get.onclick=()=>void run(async()=>{const got=await db.downloadAttachment(active,item.id,f.id);download(got.blob,got.metadata.name);say('已请求下载「'+f.name+'」。');});
          if(A.approvedAttachment(record,item.id,f.id)){remove.dataset.approvedAttachment='true';remove.title='请先打回，再移除附件。';}
          remove.dataset.materialRemove=f.id;remove.onclick=()=>void run(async()=>{
            if(!requireReviewer())return;if(!compact&&!reason.value.trim()){missingField(reason,'移除资料前，请在上方填写「操作理由」。');return;}
            if(!await confirmOperation('从当前标题移除「'+f.name+'」？此前核对将失效，历史版本保留。','确认移除'))return;
            record=await db.removeAttachment(active,record.revision,item.id,f.id,reviewer.value,compact?'核对人确认移除附件「'+f.name+'」':reason.value);render();say('已移除当前附件关联并重置核对；原文件与操作保留在历史。');
          });
          li.append(peek,get,el('small',(f.size/1024).toFixed(1)+' KiB · SHA256 '+f.sha256.slice(0,12)+'…'),remove);list.append(li);
        }
        previewRow=list.firstElementChild;
        card.append(list);if(!files.length)card.append(el('p','尚未上传文件。可将文件拖入上方对应资料项。','tiny'));
        if(pendingMaterial?.nodeId===item.id){
          const stage=el('div',undefined,'ac-material-pending'),keep=button('保存所选资料'),cancel=button('取消所选');
          stage.append(el('p','待保存：'+pendingMaterial.files.map(f=>f.name).join('、')+'。填写核对人后可保存。'),keep,cancel);
          keep.onclick=()=>void run(commitMaterial,true);cancel.onclick=()=>{clearUploads();render();say('已取消所选资料，原文件不变。');};card.append(stage);
        }
      }
      const evidence=input('ac-evidence-'+item.id,'证据文件名、底稿索引或存放位置',1000),why={value:s.reason},save=button('保存选择'),rejectItem=button('核对不通过 / 打回'),confirmItem=button('核对通过');rejectItem.dataset.rejectItem=item.id;rejectItem.classList.add('ac-reject-item');rejectItem.setAttribute('aria-pressed',String(s.status==='problem'));if(s.status==='problem')rejectItem.textContent='✕ 已打回';evidence.value=s.evidence;why.value=s.reason;save.dataset.saveItem=item.id;confirmItem.dataset.confirmItem=item.id;confirmItem.classList.add('ac-confirm-item');if(s.status==='confirmed'){confirmItem.textContent='✓ 已核对通过';confirmItem.setAttribute('aria-pressed','true');confirmItem.title='本项已经核对通过；再次点击将重新保存核对记录。';}else confirmItem.setAttribute('aria-pressed','false');
      const f=el('div',undefined,'ac-item-fields'),reviewActions=el('div',undefined,'ac-review-actions');reviewActions.append(save,confirmItem,rejectItem);
      reviewActions.setAttribute('role','group');
      reviewActions.setAttribute('aria-label','本资料项核对操作');
      if(!compact)f.append(label('证据索引',evidence));
      if(previewRow)previewRow.querySelector('[data-material-download]').after(reviewActions);
      else f.append(reviewActions);
      if(f.childElementCount)card.append(f);
      if(!compact)card.append(el('small',s.at?'上次：'+s.reviewer+' · '+new Date(s.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未核对'));
      save.onclick=()=>void run(async()=>{
        if(!requireReviewer()){root.SaveFeedback?.failed('请先填写「核对人」。');return;}
        if(state.value==='na'&&record.states[item.id].status!=='na'){const answer=root.prompt('请说明本项不适用的原因（取消则不保存）：','');if(answer===null)return;if(!answer.trim()){say(root.SaveFeedback?.failed('不适用需填写说明；本次未保存。')||'不适用需填写说明；本次未保存。',true);return;}why.value=answer;}
        const prior=record.states[item.id],hasFiles=record.schema===2&&record.attachments[item.id].length>0,edited=evidence.value.trim()!==prior.evidence||why.value.trim()!==prior.reason;
        let next=state.value==='na'?'na':prior.status==='na'?(hasFiles?'received':'pending'):prior.status;
        if(next==='confirmed'&&edited)next=hasFiles?'received':'pending';
        if(next===prior.status&&!edited){say(root.SaveFeedback?.failed('选择与记录未改变，已保留原状态、人员和时间。')||'选择与记录未改变，已保留原状态、人员和时间。');return;}
        record=await db.change(active,record.revision,{type:'item',id:item.id,status:next,evidence:evidence.value,reason:why.value,reviewer:reviewer.value});render();say(root.SaveFeedback?.saved('已保存本项选择。')??('已保存本项选择。'));
      },true);
      rejectItem.onclick=()=>{
        if(busy||!record||record.closed||state.value==='na'||record.states[item.id].status==='na')return;
        rejectTarget={project:active,rev:record.revision,id:item.id,evidence:evidence.value};
        rejectSubject.textContent=(item.title||item.text)+(s.status==='confirmed'?' · 确认打回后将撤销本次核对通过。':'');
        rejectReviewer.value=reviewer.value;rejectReason.value=s.status==='problem'?s.reason:'';
        rejectError.textContent='';rejectDialog.showModal();(rejectReviewer.value.trim()?rejectReason:rejectReviewer).focus();
      };
      confirmItem.onclick=()=>void run(async()=>{
        if(state.value==='na'||record.states[item.id].status==='na'){say('本项为不适用，不能核对通过；如需恢复，请先选择待提供并保存。',true);return;}
        if(!requireReviewer())return;
        if(compact&&!evidence.value.trim()){say('请先上传本项资料，再核对通过。',true);return;}
        record=await db.change(active,record.revision,{type:'item',id:item.id,status:'confirmed',evidence:evidence.value,reason:why.value,reviewer:reviewer.value});render();say('本项资料已核对通过。');
      });
      return card;
    }
    function render(){
      rows.replaceChildren();categoryNav.replaceChildren();const p=selected(),tree=record?.schema===2;
      if(compact)body.hidden=!record;
      templateInfo.hidden=!!T;
      templateInfo.textContent=T?'':'模板未载入，请刷新重试。';
      trialNote.hidden=!isTrial();
      caption.hidden=isTrial()||!p;
      caption.textContent=p&&!isTrial()?'项目：'+p.form.projectName+' · '+p.source.firmName+' · 项目编码 '+p.quoteId:'';
      if(!record){summary.textContent=p?'尚未建立资料清单。':'请选择项目。';controls();return;}
      const g=A.gate(record);summary.textContent=(isTrial()?'独立试用 · ':'')+(record.closed?'历史清单已关闭（只读） · ':'')+(tree?'末级资料 ':'旧版行式资料 ')+g.total+' 项 · 核对通过 '+g.confirmed+' · 不适用 '+g.excluded+' · 待处理 '+g.blockers.length+' · 第 '+record.revision+' 版';
      const query=search.value.trim().toLowerCase();
      const matches=n=>(filter.value==='all'||record.states[n.id]?.status===filter.value)&&(!query||(n.title||n.text).toLowerCase().includes(query)||(n.description||'').toLowerCase().includes(query));
      if(tree){
        const children=new Map();for(const n of record.nodes){if(!children.has(n.parentId))children.set(n.parentId,[]);children.get(n.parentId).push(n);}
        const selectedNodes=new Set();
        for(const n of record.nodes.filter(n=>!n.parentId)){
          const leaves=A.leafNodes(record).filter(leaf=>{let cur=leaf;while(cur&&cur.id!==n.id)cur=record.nodes.find(x=>x.id===cur.parentId);return !!cur;});
          const done=leaves.filter(x=>['confirmed','na'].includes(record.states[x.id].status)).length,b=button(n.title);b.dataset.auditCategory=n.id;b.append(el('small',leaves.length?done+'/'+leaves.length+' 项已核对／不适用':'空分类 · 待补资料项'));b.onclick=()=>{filter.value='all';search.value='';groupOpen.set(n.id,true);render();rows.querySelector('[data-tree-group='+n.id+'],[data-material-id='+n.id+']')?.scrollIntoView({behavior:'smooth',block:'start'});};categoryNav.append(b);
        }
        for(const n of record.nodes)if(n.kind==='group'&&!children.has(n.id)&&filter.value==='all'&&(!query||(n.title+' '+n.description).toLowerCase().includes(query))){let cur=n;while(cur){selectedNodes.add(cur.id);cur=record.nodes.find(x=>x.id===cur.parentId);}}
        for(const n of A.leafNodes(record))if(matches(n)){let cur=n;while(cur){selectedNodes.add(cur.id);cur=record.nodes.find(x=>x.id===cur.parentId);}}
        // A matching parent also reveals all descendants, without bypassing status filtering.
        if(query)for(const n of record.nodes)if(children.has(n.id)&&(n.title+' '+n.description).toLowerCase().includes(query)){for(const leaf of A.leafNodes(record)){let cur=leaf;while(cur&&cur.id!==n.id)cur=record.nodes.find(x=>x.id===cur.parentId);if(cur&&(filter.value==='all'||record.states[leaf.id].status===filter.value)){cur=leaf;while(cur){selectedNodes.add(cur.id);cur=record.nodes.find(x=>x.id===cur.parentId);}}}}
        function appendBranch(parent,container){for(const n of children.get(parent)||[]){if(!selectedNodes.has(n.id))continue;
          if(children.has(n.id)||n.kind==='group'){const group=el('details',undefined,'ac-tree-group');group.open=!!query||filter.value!=='all'||(groupOpen.has(n.id)?groupOpen.get(n.id):!!n.parentId||n.id===record.nodes.find(x=>!x.parentId)?.id);group.dataset.treeGroup=n.id;group.ontoggle=()=>{if(group.isConnected&&!search.value.trim()&&filter.value==='all')groupOpen.set(n.id,group.open);};
            const leaves=A.leafNodes(record).filter(leaf=>{let q=leaf;while(q&&q.parentId!==n.id)q=record.nodes.find(x=>x.id===q.parentId);return !!q;});
            const done=leaves.filter(x=>['confirmed','na'].includes(record.states[x.id].status)).length;
            group.append(el('summary',n.title+' · '+(leaves.length?done+'/'+leaves.length+' 项已核对／不适用':'暂无预设资料项')));describe(n,group);if(!leaves.length)group.append(el('p','此分类暂未设置资料项，仅保留分类结构，不要求上传，也不作为待核对资料项。','ac-empty-group'));const inner=el('div',undefined,'ac-tree-children');appendBranch(n.id,inner);group.append(inner);container.append(group);
          }else container.append(leafCard(n,true));
        }}appendBranch('',rows);
        if(!selectedNodes.size)rows.append(el('p','没有符合筛选条件的资料。','muted'));
      }else{
        rows.append(el('p','这是旧版行式记录，原确认状态仍保留。请用新 Word 按标题层级预览导入后，点击末级标题上传；不会静默转换或重置旧记录。','ac-legacy-note'));let lastSection='';
        for(const item of record.items){if(!matches(item))continue;if(item.section!==lastSection){rows.append(el('h3',item.section));lastSection=item.section;}rows.append(leafCard(item));}
      }
      controls();
    }
    async function run(fn,saving=false){if(busy)return;busy=true;controls();try{if(active)db=await storage(active);await fn();}catch(e){say((saving?root.SaveFeedback?.failed(e):null)||e?.message||'操作失败，未覆盖原记录。',true);}finally{busy=false;controls();}}
    async function readChecklist(store,key){
      const existing=await store.get(key);
      if(existing||!compact||key===TRIAL)return existing;
      const project=projects.find(p=>p.quoteId===key);
      if(!project)return null;
      if(!T)throw Error('内置资料清单未载入，请刷新后重试。');
      try{
        return await store.importTree(projectOf(project),T.get(),'系统（内置清单初始化）','',0);
      }catch(error){
        const concurrent=await store.get(key);
        if(concurrent)return concurrent;
        throw error;
      }
    }
    async function loadProject(){
      preservationRecoveryTarget=false;clearPending();clearUploads();groupOpen.clear();const ticket=++serial;
      if(active&&active!==selection.value)reviewer.value=reason.value=search.value='';
      active=selection.value;record=null;render();if(!active)return;
      let loaded=false;
      await run(async()=>{const r=await readChecklist(db,active);if(ticket!==serial)return;
        record=r;if(isTrial()&&!record){if(mode.value==='legacy')record=await db.create(projectOf(trialProject),A.parse(demoText),'系统（独立试用初始化）');else{if(!T)throw Error('模板组件未载入，请刷新后重试。');record=await db.importTree(projectOf(trialProject),T.get(),'系统（修正版模板试用初始化）','',0);}}render();
        loaded=true;say(compact?'':isTrial()?'已进入独立试用。':record?'已载入本项目清单。':'');});
      if(loaded&&ticket===serial)await onProjectReady?.(active);
    }
    async function show(){
      clearPreservation();if(busy)return;clearPending();clearUploads();serial++;
      await run(async()=>{projects=await listProjects();const selectedCompany=company.value,old=active;
        const names=[...new Set(projects.map(companyName))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
        company.replaceChildren(option('','全部被审计单位'),...names.map(name=>option(name,name)));
        company.value=names.includes(selectedCompany)?selectedCompany:'';
        projectOptions(old);active=selection.value;record=active?await readChecklist(await storage(active),active):null;render();
        say(compact?'':isTrial()?'已载入独立试用；与正式项目分开保存。':projects.length?'请选择已立项项目。':'暂无已保存立项。');});
      if(active)await onProjectReady?.(active);
    }
    const materialNodes=ns=>{const parents=new Set(ns.map(n=>n.parentId));return ns.filter(n=>!parents.has(n.id)&&n.kind!=='group');};
    const recognize=ns=>T?.recognize(ns)||ns;
    function updatePreviewCount(){try{const ns=pendingImport.nodes||recognize(O.build(pendingImport.rows));outlineCount.textContent=(pendingImport.template?'确认版模板：':'当前建议：')+ns.length+' 个标题，'+materialNodes(ns).length+' 个末级上传资料项。父标题及明确的空分类仅分组，不重复要求上传。';outlineCount.classList.remove('error');}catch(e){outlineCount.textContent=e.message;outlineCount.classList.add('error');}}
    useTemplate.onclick=()=>{
      if(busy)return;if(!selected()){say('请先选择已保存立项，或进入独立试用。',true);return;}if(record?.closed){say('该历史清单已关闭，仅可查看或导出。',true);return;}if(!T){say('模板组件未载入，请刷新后重试。',true);return;}
      if(!record){
        const project=selected(),key=active,ticket=serial;
        clearPending();clearUploads();
        void run(async()=>{
          if(key!==active||ticket!==serial)return;
          const created=await db.importTree(projectOf(project),T.get(),reviewer.value.trim()||'系统（内置清单初始化）','',0);
          if(key!==active||ticket!==serial)return;
          record=created;groupOpen.clear();render();
          const result='已使用2026修正版资料清单，'+materialNodes(record.nodes).length+' 项待提供。';
          say(root.SaveFeedback?.saved(result)??result);
        },true);
        return;
      }
      clearPending();pendingImport={template:true,nodes:T.get(),name:T.label,key:active,token:serial,revision:record?.revision||0};pendingBox.hidden=false;preview.hidden=ackLabel.hidden=outlineStats.hidden=outlineCount.hidden=false;warning.hidden=true;preview.replaceChildren();ack.checked=false;
      pendingText.textContent='使用「'+T.label+'」建立本项目资料清单。请先核对结构；确认前原清单和附件不变。';
      outlineStats.textContent='四大分类 · 1–4级标题 · 主项1–52，子项随父编号。此模板不包含任何已上传附件或已核对结论。';
      for(const n of pendingImport.nodes){const line=el('div',n.title,'ac-template-preview-row');line.style.paddingLeft=(12+(n.level-1)*18)+'px';line.dataset.templateNode=n.id;if(n.kind==='group'){line.classList.add('is-group');line.append(el('small',pendingImport.nodes.some(c=>c.parentId===n.id)?'分组':'空分类 · 不要求上传'));}preview.append(line);}
      pendingContinue.textContent=compact?'确认替换清单':'按模板建立清单';updatePreviewCount();controls();say('模板结构已展开供核对。');
      showImportPreview('使用内置资料清单');
    };
    function showImportPreview(title){
      if(!compact)return;
      previewTitle.textContent=title;reviewImport.value=reviewer.value;importError.textContent='';
      if(record)pendingText.append(doc.createTextNode(' 确认替换后将重置当前核对状态，原清单和附件保留在历史中。'));
      templateDialog.showModal();
    }
    function confirmOperation(message,title){
      if(!compact)return Promise.resolve(root.confirm(message));
      return new Promise(resolve=>{
        const modal=el('dialog',undefined,'af-progress-editor'),cancel=button('取消'),ok=button(title),actions=el('div',undefined,'af-progress-actions');
        modal.setAttribute('aria-label',title);ok.classList.add('primary');actions.append(cancel,ok);
        modal.append(el('h2',title),el('p',message),actions);top.append(modal);
        cancel.onclick=()=>modal.close();ok.onclick=()=>modal.close('yes');
        modal.onclose=()=>{const accepted=modal.returnValue==='yes';modal.remove();resolve(accepted);};modal.showModal();cancel.focus();
      });
    }
    function previewRows(){
      const job=pendingImport;preview.replaceChildren();if(!job?.rows)return;ack.checked=false;
      const levels=Object.entries(job.source.actualLevels||{}).filter(([,n])=>n>0);outlineStats.textContent='文件实际大纲：'+(levels.length?levels.map(([k,n])=>k+'级 '+n+' 段').join('；'):'未检测到标题级别')+'。当前预览：'+(job.automatic?'自动选用':'')+(job.mode==='numbered'?'按编号整理，尚需核对':'Word 真实大纲')+'。0 表示正文说明，不是上传项。';
      if(job.source.kind==='spreadsheet')outlineStats.textContent='请核对资料分类、名称及说明，可逐行调整层级。';
      warning.textContent=job.warnings.join('\n');warning.hidden=!job.warnings.length;
      for(const [i,row]of job.rows.entries()){
        const line=el('div',undefined,'ac-outline-row'),level=el('select');level.dataset.outlineLevel=String(i);level.setAttribute('aria-label','第 '+(i+1)+' 段的标题级别');
        level.append(option('0','正文说明'));for(let n=1;n<=9;n++)level.append(option(String(n),n+'级标题'));level.value=String(row.level);
        const title=el('span',row.text);title.style.paddingLeft=(Math.max(0,row.level-1)*10)+'px';level.onchange=()=>{row.level=Number(level.value);title.style.paddingLeft=(Math.max(0,row.level-1)*10)+'px';ack.checked=false;updatePreviewCount();controls();};line.append(level,title);preview.append(line);
      }
    }
    async function commitImport(){
      const job=pendingImport;if(!job)return;if(job.key!==active||job.token!==serial){clearPending();throw Error('已切换项目，请重新读取当前项目清单。');}
      if(compact){
        if(!reviewImport.value.trim()){importError.textContent='请填写本次核对人。';return;}
        reviewer.value=reviewImport.value.trim();
      }
      if(!importFields(!!record))return;if((record?.revision||0)!==job.revision){clearPending();throw Error('当前清单已发生变化。请重新读取文件后核对，不覆盖已有修改。');}
      let ns=job.nodes||null;if(job.rows||job.template){if(!ack.checked){say('请先核对层级并勾选确认。',true);return;}if(job.rows)ns=recognize(O.build(job.rows));}
      const count=ns?materialNodes(ns).length:job.items.length;
      if(!compact&&!root.confirm('本项目导入 '+count+' 个'+(ns?'末级上传资料项':'旧版行式资料项')+'。'+(record?'当前确认状态将重置，旧记录与原文件留在历史。':'不会自动确认任何资料。'))){say('已取消确认，原清单未变；本次读取结果仍保留。');return;}
      const p=selected();if(!p)throw Error('请先选择已保存立项，或进入独立试用。');
      if(ns)record=await db.importTree(projectOf(p),ns,reviewer.value,compact?(record?'核对人确认替换清单「'+job.name+'」':''):reason.value,job.revision);
      else{if(record?.schema===2)throw Error('层级资料不降级为旧版行式记录，请使用标题层级导入。');record=record?await db.change(active,job.revision,{type:'replace',items:job.items,reason:reason.value,reviewer:reviewer.value}):await db.create(projectOf(p),job.items,reviewer.value);}
      clearPending();clearUploads();groupOpen.clear();render();say('已导入 '+count+' 项，当前均为待提供。'+(ns?'点击末级资料标题即可选择文件。':''));
    }
    pendingContinue.onclick=()=>void run(async()=>{try{await commitImport();}catch(e){if(templateDialog?.open)importError.textContent=e.message;else throw e;}});pendingCancel.onclick=()=>{if(busy)return;clearPending();controls();say('已取消本次导入，原清单未改变。');};
    ack.onchange=controls;mode.onchange=()=>{clearPending();controls();say('已切换识别方式，请重新选择清单文件。');};
    file.onchange=()=>{const f=file.files[0];file.value='';if(!f)return;clearPending();const token=serial,key=active,revision=record?.revision||0,chosen=mode.value;
      void run(async()=>{
        if(f.size<1||f.size>2*1024*1024)throw Error('清单为空或超过 2 MB。');
        if(chosen==='legacy'){
          let text;if(/\.txt$/iu.test(f.name))text=new TextDecoder('utf-8',{fatal:true}).decode(await f.arrayBuffer());
          else if(/\.doc$/iu.test(f.name))text=(await root.LegacyDoc.read(f)).lines.join('\n');
          else if(/\.docx$/iu.test(f.name)){const source=await root.TenderImport.readVisibleText(f);if(source.tables.length)throw Error('旧版行式导入不支持表格。');text=source.lines.join('\n');}else throw Error('请选择 TXT、DOCX 或 DOC。');
          const items=A.parse(text);if(token!==serial||key!==active)return;pendingImport={items,name:f.name,key,token,revision};pendingBox.hidden=false;preview.hidden=ackLabel.hidden=outlineStats.hidden=outlineCount.hidden=warning.hidden=true;
          pendingText.textContent='已读取「'+f.name+'」，共 '+items.length+' 项。旧版兼容导入仍按行拆分，不是新的标题结构；补齐核对人'+(record?'和操作理由':'')+'后可继续导入。';pendingContinue.textContent='补齐后导入';await commitImport();
        }else{
          if(!O)throw Error('标题识别组件未载入，请刷新后重试。');
          const source=/\.xlsx?$/iu.test(f.name)?await O.spreadsheet(f):await O.read(f);
          const prepared=source.kind==='spreadsheet'?O.prepare(source,'outline'):chosen==='auto'?O.suggest(source):O.prepare(source,chosen);
          if(token!==serial||key!==active)return;
          pendingImport={name:f.name,key,token,revision,source,mode:prepared.mode||chosen,automatic:prepared.automatic,rows:prepared.rows,warnings:prepared.warnings||[]};pendingBox.hidden=false;preview.hidden=ackLabel.hidden=outlineStats.hidden=outlineCount.hidden=false;
          pendingText.textContent='已读取「'+f.name+'」。请先核对下方层级，正文说明请选择0，不要把换行当成独立资料。';pendingContinue.textContent='补齐后导入';previewRows();updatePreviewCount();say('已读取清单。请核对层级，勾选确认，再导入。');
          if(compact){pendingContinue.textContent=record?'确认替换清单':'确认导入清单';showImportPreview('上传自制清单');}
        }
      });
    };
    company.onchange=()=>{if(!busy){projectOptions(active,true);if(selection.value!==active)void loadProject();}};
    selection.onchange=()=>void loadProject();refresh.onclick=()=>void show();filter.onchange=render;search.oninput=render;
    exportBtn.onclick=()=>{if(!record)return;download(new Blob([JSON.stringify({app:'hengdu.audit.materials',mode:isTrial()?'trial':'project',exportedAt:new Date().toISOString(),record},null,2)],{type:'application/json'}),isTrial()?'独立试用-资料核对记录.json':'审计资料清单-核对与关门记录.json');say('已请求下载清单、文件元数据与留痕 JSON。JSON 不含文件正文，请逐份下载并另存资料原件；此导出暂不自动恢复其他浏览器。');};
    async function selectProject(id){
      if(id!==TRIAL&&!projects.some(project=>project.quoteId===id))await show();
      const project=projects.find(item=>item.quoteId===id);
      if(project)company.value=companyName(project);
      else if(id===TRIAL)company.value='';
      projectOptions(id);
      if(selection.value!==id)throw Error('未找到该立项项目。');
      if(active!==id)await loadProject();
    }
    async function exportChecklist(mode){
      if(!['all','missing'].includes(mode))throw Error('请选择要导出的资料清单。');
      if(busy)throw Error('资料正在读取或保存，请稍后导出。');
      if(!active)throw Error('请先选择被审计单位和审计项目。');
      if(!root.LedgerStandard?.workbook)throw Error('Excel 导出组件未加载。');
      const key=active,ticket=serial;
      busy=true;controls();
      try{
        const store=await storage(key),latest=await store.get(key);
        if(!latest)throw Error('该项目尚无资料清单，请先使用内置清单或导入清单。');
        const tree=latest.schema===2,nodes=new Map((latest.nodes||[]).map(node=>[node.id,node]));
        const items=tree?A.leafNodes(latest):latest.items;
        const rows=[];
        for(const [i,item] of items.entries()){
          const state=latest.states[item.id],files=latest.attachments?.[item.id]||[];
          if(mode==='missing'&&(files.length||state.status==='na'))continue;
          const path=[];
          for(let parent=nodes.get(item.parentId);parent;parent=nodes.get(parent.parentId))path.unshift(parent.title);
          rows.push([i+1,tree?path.join(' / '):item.section,item.title||item.text,item.description||'',
            names[state.status]||state.status,files.length,files.map(file=>file.name).join('、')]);
        }
        const title=mode==='missing'?'未上传清单':'全部清单';
        const bytes=await root.LedgerStandard.workbook([{name:title,columns:['序号','资料分类','资料名称','说明','核对状态','已上传份数','原件名称'],
          rows,widths:{1:32,2:44,3:48,6:38}}]);
        if(key!==active||ticket!==serial||top.closest('[hidden]')||(await store.get(key))?.revision!==latest.revision)
          throw Error('当前项目或资料清单已变更，请重新导出。');
        if(key!==active||ticket!==serial||top.closest('[hidden]'))throw Error('当前项目已切换，请重新导出。');
        root.ProjectWorkspaceStore.download(new root.Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),
          (selected()?.form.projectName||'项目').replace(/[\\/:*?"<>|]/gu,'_').slice(0,110)+'-'+title+'.xlsx');
        return rows.length;
      }finally{busy=false;controls();}
    }
    render();return Object.freeze({show,selectProject,exportChecklist});
  }
  root.AuditProgram=Object.freeze({mount});
})(globalThis);
