/* Project-local material hierarchy and review. Operator entries are not authenticated signatures. */
(function(root){
  'use strict';
  function mount(host,{listProjects}){
    const doc=host.ownerDocument,A=root.AuditChecklist,O=root.AuditOutline,T=root.AuditMaterialTemplate,P=root.MaterialPreservation;
    const TRIAL=A.TRIAL_ID,trialProject=Object.freeze({quoteId:TRIAL,form:{projectName:'独立试用项目（不关联立项）'},source:{firmName:''}});
    const demoText='一、试用资料\n1、演示：企业基本资料\n2、演示：本期财务报表\n二、试用核对\n3、演示：合同清单';
    const el=(tag,text,cls)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
    const button=(txt,id)=>{const b=el('button',txt,'btn');b.type='button';if(id)b.id=id;return b;};
    const input=(id,placeholder,max=100)=>{const e=el('input');e.id=id;e.type='text';e.placeholder=placeholder;e.maxLength=max;return e;};
    const label=(txt,e)=>{const l=el('label',txt);l.append(e);return l;};
    const option=(v,t)=>{const o=el('option',t);o.value=v;return o;};
    const top=el('section',undefined,'panel ac-top'),selection=el('select'),refresh=button('刷新已立项项目','ac-refresh'),trialBtn=button('独立试用（无需立项）','ac-trial'),
      reviewer=input('ac-reviewer','填写本次核对人'),reason=input('ac-reason','替换清单／重新开门／移除文件时必填',1000),file=el('input'),mode=el('select'),
      status=el('p','请选择已保存的立项项目。','ac-status'),summary=el('p','尚未导入资料清单。','ac-summary'),
      close=button('确认资料关门','ac-close'),reopen=button('重新开门','ac-reopen'),exportBtn=button('导出清单与核对记录 JSON','ac-export'),
      templateBox=el('section',undefined,'ac-template-box'),templateInfo=el('p'),useTemplate=button('使用2026修正版模板','ac-use-template'),categoryNav=el('nav',undefined,'ac-category-nav'),body=el('section',undefined,'panel ac-list'),filter=el('select'),search=input('ac-search','搜索标题、说明或资料项',100),history=el('details',undefined,'ac-history'),
      pendingBox=el('div',undefined,'ac-import-pending'),pendingText=el('p'),pendingContinue=button('补齐后导入','ac-import-continue'),pendingCancel=button('取消本次导入','ac-import-cancel'),preview=el('div',undefined,'ac-outline-preview'),
      outlineStats=el('p',undefined,'tiny'),outlineCount=el('p',undefined,'ac-outline-count'),warning=el('p',undefined,'ac-outline-warning'),ack=el('input'),ackLabel=label('我已核对标题层级、正文说明的归属及末级上传项',ack),
      log=el('ol'),caption=el('p',undefined,'muted'),trialNote=el('p','独立试用 · 与正式立项分开存储，不代表真实承接、签字或审计完成。','ac-trial-note');
    const preservationExport=button('导出资料保全包','ac-preservation-export'),preservationImport=button('恢复资料保全包','ac-preservation-import'),preservationFile=el('input'),preservationBox=el('section',undefined,'ac-import-pending'),preservationSummary=el('div'),preservationNotice=el('p'),preservationAck=el('input'),preservationRestore=button('确认恢复到当前空资料区','ac-preservation-restore'),preservationCancel=button('取消本次恢复','ac-preservation-cancel'),preservationTrial=button('恢复到独立试用空资料区','ac-preservation-target-trial');
    preservationFile.id='ac-preservation-file';preservationFile.type='file';preservationFile.accept='.zip,application/zip';preservationFile.hidden=true;preservationBox.id='ac-preservation-preview';preservationBox.hidden=true;preservationSummary.id='ac-preservation-summary';preservationNotice.id='ac-preservation-notice';preservationNotice.setAttribute('role','status');preservationAck.id='ac-preservation-confirm';preservationAck.type='checkbox';preservationBox.append(el('h3','资料保全包恢复预检'),preservationSummary,preservationNotice,preservationTrial,label('我已核对同一项目UUID、正式／试用范围及空目标；仅恢复本机历史，不作为当前员工签审。',preservationAck),preservationRestore,preservationCancel);
    pendingBox.id='ac-import-pending';pendingBox.hidden=true;pendingBox.setAttribute('role','status');preview.id='ac-outline-preview';ack.type='checkbox';ack.id='ac-outline-confirm';ackLabel.className='ac-outline-ack';
    outlineCount.id="ac-outline-count";pendingBox.append(pendingText,outlineStats,outlineCount,warning,preview,ackLabel,pendingContinue,pendingCancel);
    reviewer.setAttribute('aria-required','true');trialNote.id='ac-trial-note';trialNote.hidden=true;selection.id='ac-project';file.id='ac-import';file.type='file';file.accept='.txt,.docx,.doc';status.id='ac-status';status.setAttribute('role','status');summary.id='ac-summary';
    mode.id='ac-import-mode';mode.append(option('outline','读取 Word 真实标题级别'),option('numbered','按编号整理层级（预览确认）'),option('legacy','旧版行式导入（仅兼容）'));
    for(const [v,t]of[['all','全部状态'],['pending','待提供'],['received','已收到 · 未核对'],['confirmed','核对通过'],['na','不适用'],['problem','存在问题']])filter.append(option(v,t));
    filter.id='ac-filter';history.append(el('summary','查看操作留痕'),log);
    const fields=el('div',undefined,'ac-fields');fields.append(label('正式项目 / 独立试用',selection),label('核对人（必填，人工填写）',reviewer),label('操作理由',reason));
    const actions=el('div',undefined,'ac-actions');actions.append(trialBtn,refresh,label('识别方式',mode),label('读取资料清单（TXT／DOCX／DOC）',file),exportBtn,preservationExport,preservationImport,preservationFile);
    templateBox.id='ac-template-box';templateBox.append(el('span','WORD STRUCTURE · 2026','ac-template-eyebrow'),el('h3','2026审计资料清单 · 修正版'),templateInfo,useTemplate);categoryNav.id='ac-category-nav';categoryNav.setAttribute('aria-label','资料分类导航');ackLabel.replaceChildren(ack,doc.createTextNode('我已核对标题层级、正文说明的归属及末级上传项'));
    const gates=el('div',undefined,'ac-actions');gates.append(close,reopen);
    const tools=el('div',undefined,'ac-tools');tools.append(filter,search);
    top.append(el('h2','资料清单与逐项确认'),el('p','按标题与子标题组织资料，正文说明不单独拆项。点击末级资料标题选择文件；上传只表示已收到，核对通过或有理由不适用后才可明确关门。','muted'),
      fields,templateBox,actions,pendingBox,preservationBox,el('p','资料保全包保存清单留痕所引用的全部原件，包含已移除和旧代版本；不含当初未保存的目录Word、其他模块或未被引用的孤立文件。只恢复到同UUID、同正式／试用范围的空资料区，不覆盖已有清单。','tiny'),el('p','Word 在本机读取标题与正文，不执行宏。标题样式不完整时，可按编号整理并逐项预览核对，不将推定层级冒充真实 Word 样式。','tiny'),trialNote,caption,summary,gates,status,
      el('p','这里只控制本项目的资料清单关门，不表示已执行全部审计程序或批准报告。文件只存当前浏览器、未加密；核对人尚无账号认证。请在可信电脑使用，并单独备份资料原件。','tiny'));
    body.append(categoryNav,tools,el('p','点击末级标题选择 PDF、Word/RTF/ODT、Excel/CSV/TSV/ODS、PPT/ODP、常用图片、UTF-8文本/JSON/MD/HTML/XML或ZIP/RAR。HTML/XML仅作惰性文本，DOCM/XLSM/PPTM宏类型与TIFF/HEIC暂不接收。每份最多 12 MiB，每项最多10份；本项目含历史原件总量最多150 MiB。文件只在本机保存，不自动核对或打开。','tiny'));host.replaceChildren(top,body,history);const rows=el('div');rows.id='ac-rows';body.append(rows);
    let db=null,projectDb=null,trialDb=null,projects=[],record=null,active='',serial=0,busy=false,pendingImport=null,pendingMaterial=null,pendingPreservation=null,preservationEpoch=0,preservationPhase='',preservationRecoveryTarget=false;const groupOpen=new Map();
    const names={pending:'待提供',received:'已收到 · 未核对',confirmed:'核对通过',na:'不适用',problem:'存在问题'};
    const say=(s,bad=false)=>{status.textContent=s;status.classList.toggle('error',bad);};
    const isTrial=()=>active===TRIAL,selected=()=>isTrial()?trialProject:projects.find(x=>x.quoteId===active);
    const projectOf=p=>({quoteId:p.quoteId,projectName:p.form.projectName,firmName:p.source.firmName});
    function clearPreservation(){preservationEpoch++;pendingPreservation=null;preservationFile.value='';preservationBox.hidden=true;preservationSummary.replaceChildren();preservationNotice.textContent='';preservationAck.checked=false;preservationRestore.hidden=true;preservationTrial.hidden=true;}
    function clearPending(){pendingImport=null;pendingBox.hidden=true;pendingText.textContent='';preview.replaceChildren();ack.checked=false;clearPreservation();}
    function clearUploads(){pendingMaterial=null;}
    function missingField(control,message){control.setAttribute('aria-invalid','true');say(message,true);setTimeout(()=>{if(!busy&&!control.disabled)control.focus();},0);return false;}
    function requireReviewer(){reviewer.removeAttribute('aria-invalid');return reviewer.value.trim()?true:missingField(reviewer,'请先填写「核对人」，再保存资料、核对或执行关门操作。');}
    function importFields(replacing){
      reviewer.removeAttribute('aria-invalid');reason.removeAttribute('aria-invalid');
      if(!reviewer.value.trim())return missingField(reviewer,'请填写「核对人」。已读取的清单会保留，补齐后点「补齐后导入」。');
      if(replacing&&!reason.value.trim())return missingField(reason,'替换当前清单前，请填写「操作理由」，例如：改用2026资料清单。文件已保留，不用重新选择。');
      return true;
    }
    reviewer.addEventListener('input',()=>reviewer.removeAttribute('aria-invalid'));reason.addEventListener('input',()=>reason.removeAttribute('aria-invalid'));
    async function storage(key){if(key===TRIAL)return trialDb||(trialDb=await A.openTrial());return projectDb||(projectDb=await A.open());}
    function trialOption(){if(!Array.from(selection.options).some(o=>o.value===TRIAL))selection.append(option(TRIAL,'独立试用（不关联立项）'));}
    function controls(){
      selection.disabled=refresh.disabled=trialBtn.disabled=mode.disabled=busy;file.disabled=busy||!selected()||!!record?.closed;
      useTemplate.disabled=busy||!selected()||!!record?.closed||!T;for(const b of categoryNav.querySelectorAll('button'))b.disabled=busy;
      pendingContinue.disabled=busy||!pendingImport||!!record?.closed||!!(pendingImport?.rows||pendingImport?.template)&&!ack.checked;pendingCancel.disabled=busy;
      for(const x of preview.querySelectorAll('select'))x.disabled=busy;ack.disabled=busy;
      reviewer.disabled=reason.disabled=busy;exportBtn.disabled=busy||!record;
      preservationExport.disabled=busy||!record||!preservationAvailable();preservationImport.disabled=busy||!preservationAvailable();preservationFile.disabled=busy||!preservationAvailable();const restoreReady=!!pendingPreservation&&pendingPreservation.targetKnown&&pendingPreservation.matches&&!record&&pendingPreservation.targetEmpty&&preservationCurrent(pendingPreservation.context);preservationRestore.hidden=!restoreReady;preservationRestore.disabled=busy||!restoreReady||!preservationAck.checked;preservationAck.disabled=busy||!restoreReady;preservationTrial.hidden=!pendingPreservation||!preservationIsTrial(pendingPreservation.summary)||active===TRIAL;preservationTrial.disabled=busy;preservationCancel.disabled=preservationPhase==='restore';
      const g=record?A.gate(record):null;close.disabled=busy||!g?.ready||!!record?.closed;reopen.disabled=busy||!record?.closed;
      for(const x of rows.querySelectorAll('input,select,button'))x.disabled=busy||!!record?.closed&&!x.hasAttribute('data-material-download')&&!x.hasAttribute('data-material-preview');
      for(const x of rows.querySelectorAll('[data-confirm-item],[data-reject-item]')){const id=x.dataset.confirmItem||x.dataset.rejectItem,choice=x.closest('[data-material-id]')?.querySelector('[data-item-status]');x.disabled=busy||!!record?.closed||!record?.states[id]||record.states[id].status==='na'||choice?.value==='na';}
    }
    const preservationNamespace=key=>key===TRIAL?'hengdu.audit.materials.trial.v1':'hengdu.audit.materials.v1';
    function preservationAvailable(){return !!P&&typeof P.inspect==='function';}
    function preservationContext(){return {key:active,serial,epoch:preservationEpoch};}
    function preservationCurrent(context){return context.key===active&&context.serial===serial&&context.epoch===preservationEpoch&&selection.value===active&&host.isConnected&&host.contains(top)&&!top.closest('[hidden]')&&(!active||selected()?.quoteId===active);}
    function assertPreservationContext(context){if(!preservationCurrent(context))throw Error('项目或预检视图已变化，请重新选择保全包核对。');}
    function preservationIsTrial(value){return value?.projectId===TRIAL&&value.sourceNamespace==='hengdu.audit.materials.trial.v1';}
    function preservationSummaryValid(value){const keys=['projectId','projectName','firmName','sourceNamespace','recordSchema','revision','generationId','closed','nodeCount','fileCount','currentFileCount','historicalFileCount','totalBytes','packageSha256'];return !!value&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))&&['projectId','projectName','firmName','sourceNamespace'].every(key=>typeof value[key]==='string')&&[1,2].includes(value.recordSchema)&&Number.isSafeInteger(value.revision)&&value.revision>=1&&(value.generationId===null||typeof value.generationId==='string')&&typeof value.closed==='boolean'&&['nodeCount','fileCount','currentFileCount','historicalFileCount','totalBytes'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)&&value.currentFileCount+value.historicalFileCount===value.fileCount&&typeof value.packageSha256==='string'&&/^[a-f0-9]{64}$/u.test(value.packageSha256);}
    function renderPreservation(){const job=pendingPreservation;preservationSummary.replaceChildren();if(!job){controls();return;}preservationBox.hidden=false;const s=job.summary;for(const text of ['包文件：'+job.name,'包内项目：'+s.projectName+' · '+s.firmName,'项目UUID：'+s.projectId,'来源资料区：'+(preservationIsTrial(s)?'独立试用':'正式项目'),'清单schema '+s.recordSchema+' · 修订 '+s.revision+' · 代次 '+(s.generationId||'旧版行式')+' · '+(s.closed?'原清单已关门':'原清单未关门'),'标题/资料项 '+s.nodeCount+' · 全部原件 '+s.fileCount+' · 当前原件 '+s.currentFileCount+' · 历史原件 '+s.historicalFileCount+' · 总字节 '+s.totalBytes,'包SHA-256：'+s.packageSha256])preservationSummary.append(el('p',text,'tiny'));preservationSummary.append(el('p','包内历史核对人、核对通过和关门留痕仅作为原历史保存，不认证当前员工或新增审计结论；不预览或执行附件正文。','tiny'));preservationNotice.textContent=!active?'尚未选择恢复目标。正式包须先选择既有立项，再重新选包；试用包可明确进入独立试用空资料区。':!job.matches?'所选项目UUID或正式／试用范围不匹配，不可恢复。':!job.targetKnown?'正在核对当前目标是否已有清单…':!job.targetEmpty||record?'目标已有资料清单，不能覆盖（包括已关门或损坏记录）。':'当前未见目标清单；孤立文件、全局原件ID冲突和空态将在最终恢复事务再次核验。';controls();}
    async function runPreservation(context,phase,fn){if(busy)return;busy=true;preservationPhase=phase;controls();try{await fn();}catch(error){if(preservationCurrent(context)){if(phase==='inspect'||phase==='target'){clearPreservation();preservationBox.hidden=false;preservationNotice.textContent=error?.message||'保全包预检未通过，未写入资料。';}say(error?.message||'资料保全操作未完成，请刷新核对。',true);}}finally{busy=false;preservationPhase='';controls();}}
    async function inspectPreservation(immutable,name){clearPending();clearUploads();const context=preservationContext();if(!preservationCurrent(context))return;preservationBox.hidden=false;preservationNotice.textContent='正在完整校验保全包、记录及全部原件，预检不会写库…';await runPreservation(context,'inspect',async()=>{assertPreservationContext(context);const result=await P.inspect(immutable);assertPreservationContext(context);if(!preservationSummaryValid(result?.summary)||result.sha256!==result.summary.packageSha256)throw Error('保全包摘要格式无效，未写入资料。');const job={file:immutable,name,sha256:result.sha256,summary:{...result.summary},context,targetKnown:false,targetEmpty:false,matches:!!active&&result.summary.projectId===active&&result.summary.sourceNamespace===preservationNamespace(active)};pendingPreservation=job;if(active){const store=await storage(active),target=await store.get(active);assertPreservationContext(context);record=target;job.targetKnown=true;job.targetEmpty=target===null;render();}renderPreservation();say('保全包预检已完成，尚未恢复；请核对同UUID空目标、范围和历史说明。');});}
    async function exportPreservation(){if(busy||!record||!active||!preservationAvailable())return;clearPending();const context=preservationContext(),signature=JSON.stringify(record);await runPreservation(context,'export',async()=>{const store=await storage(context.key);assertPreservationContext(context);if(typeof store.exportPreservation!=='function')throw Error('本机资料保全组件未就绪，未请求下载。');const result=await store.exportPreservation(context.key,{assertContext:()=>assertPreservationContext(context)});assertPreservationContext(context);const current=await store.get(context.key);assertPreservationContext(context);if(JSON.stringify(current)!==signature)throw Error('源资料清单已变化，请刷新后重新导出；未请求下载。');if(!preservationSummaryValid(result?.summary)||result.sha256!==result.summary.packageSha256)throw Error('保全包结果无法确认，未请求下载。');download(result.blob,'资料保全-'+context.key+'-r'+result.summary.revision+'-'+result.sha256.slice(0,12)+'.zip');say('已请求下载资料保全包：清单留痕引用的全部原件 '+result.summary.fileCount+' 份，包含已移除及旧代原件；源资料未改动。');});}
    function cancelPreservation(){if(preservationPhase==='restore'){say('恢复请求已提交，不能视为撤回；请完成后刷新目标核对。',true);return;}const wasTrial=preservationRecoveryTarget;clearPreservation();preservationRecoveryTarget=false;if(wasTrial){serial++;active='';selection.value='';record=null;render();}controls();say('已取消本次恢复预检，未发出恢复写入；不会自动创建试用模板。');}
    async function targetTrialPreservation(){const prior=pendingPreservation;if(busy||!prior||!preservationIsTrial(prior.summary)||!preservationCurrent(prior.context))return;clearPending();clearUploads();serial++;active=TRIAL;trialOption();selection.value=TRIAL;record=null;preservationRecoveryTarget=true;render();const context=preservationContext(),job={...prior,context,targetKnown:false,targetEmpty:false,matches:true};pendingPreservation=job;renderPreservation();await runPreservation(context,'target',async()=>{const store=await storage(TRIAL),target=await store.get(TRIAL);assertPreservationContext(context);record=target;job.targetKnown=true;job.targetEmpty=target===null;render();renderPreservation();say(target?'独立试用已有资料，不能覆盖。':'已明确选择独立试用恢复空目标，未自动创建模板；请核对后确认恢复。');});}
    async function restorePreservation(){const job=pendingPreservation;if(busy||!job||!job.matches||!job.targetKnown||!job.targetEmpty||record||!active||!preservationAck.checked||!preservationCurrent(job.context))return;if(!root.confirm('确认将此资料保全包恢复到同UUID、同正式／试用范围的空本机资料区？会保留包内历史与关门状态，不作为当前员工签审；不会覆盖现有资料。')){cancelPreservation();return;}const context=job.context;preservationAck.checked=false;await runPreservation(context,'restore',async()=>{const store=await storage(context.key);assertPreservationContext(context);if(typeof store.restorePreservation!=='function')throw Error('本机恢复组件未就绪，未写入资料。');const result=await store.restorePreservation(context.key,job.file,{expectedSha256:job.sha256,assertContext:()=>assertPreservationContext(context)});if(!preservationCurrent(context))return;pendingPreservation=null;preservationAck.checked=false;preservationRecoveryTarget=false;let refreshed=false;try{record=result.record;A.validate(record);render();const current=await store.get(context.key);assertPreservationContext(context);if(!current)throw Error('恢复后的清单暂未读到。');record=current;render();refreshed=true;}catch(error){if(!preservationCurrent(context))return;}clearPreservation();say(refreshed?'资料保全包已恢复到同UUID本机资料区，原修订、代次、关门及历史原件保持。':'资料保全包已恢复，但列表刷新未确认；请刷新当前项目核对，不要重复恢复。',!refreshed);});}
    preservationExport.onclick=()=>void exportPreservation();preservationImport.onclick=()=>{if(!busy&&preservationAvailable())preservationFile.click();};preservationFile.onchange=()=>{const source=preservationFile.files?.[0];preservationFile.value='';if(busy)return;if(!source){cancelPreservation();return;}if(!Number.isSafeInteger(source.size)||source.size<1||source.size>180*1024*1024||typeof source.slice!=='function'){clearPreservation();say('请选择不超过180MiB的非空资料保全ZIP包，未写入资料。',true);return;}void inspectPreservation(source.slice(0,source.size,source.type||'application/zip'),source.name);};preservationAck.onchange=controls;preservationCancel.onclick=cancelPreservation;preservationTrial.onclick=()=>void targetTrialPreservation();preservationRestore.onclick=()=>void restorePreservation();
    let preservationViewHidden=!!top.closest('[hidden]');const preservationObserver=typeof root.MutationObserver==='function'?new root.MutationObserver(()=>{const hidden=!host.contains(top)||!!top.closest('[hidden]');if(hidden&&!preservationViewHidden)clearPreservation();preservationViewHidden=hidden;if(!host.contains(top))preservationObserver.disconnect();}):null;preservationObserver?.observe(host,{subtree:true,attributes:true,attributeFilter:['hidden'],childList:true});for(let ancestor=host.parentElement;ancestor;ancestor=ancestor.parentElement)preservationObserver?.observe(ancestor,{attributes:true,attributeFilter:['hidden']});root.addEventListener?.('beforeunload',()=>{clearPreservation();preservationObserver?.disconnect();});
    const describe=(n,container)=>{if(n.description){const p=el('p',n.description,'ac-description');container.append(p);}};
    function download(blob,name){const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;doc.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
    async function commitMaterial(){
      const job=pendingMaterial;if(!job)return;if(!requireReviewer())return;
      if(job.key!==active||job.token!==serial||!record||record.schema!==2||job.revision!==record.revision){clearUploads();render();throw Error('清单或项目已变化，请重新选择资料文件；未覆盖已有核对。');}
      try{while(job.files.length){record=await db.attach(active,job.revision,job.nodeId,job.files[0],reviewer.value);job.files.shift();job.revision=record.revision;}clearUploads();say('资料已保存在该标题下，状态为「已收到 · 未核对」。请核对后再点「核对通过」。');}finally{render();}
    }
    function leafCard(item,tree=false){
      const s=record.states[item.id],card=el('article',undefined,'ac-item'+(tree?' ac-tree-leaf':''));card.dataset.materialId=item.id;card.dataset.reviewStatus=s.status;card.classList.toggle('ac-item-confirmed',s.status==='confirmed');card.classList.toggle('ac-item-rejected',s.status==='problem');
      const header=el('div',undefined,'ac-item-head'),title=tree?button(item.title):el('strong',item.number+'、'+item.text);
      if(tree){title.classList.add('ac-upload-title');title.dataset.uploadNode=item.id;title.title='点击上传此项资料，可选择多个文件';title.append(el('span','选择文件 ↗','ac-upload-hint'));}
      header.append(title);
      const state=el('select');state.setAttribute('aria-label',(tree?item.title:'第 '+item.number+' 项')+'状态');state.dataset.itemStatus=item.id;
      for(const [v,t]of [['pending','待提供'],['na','不适用']])state.append(option(v,t));
      state.value=s.status==='na'?'na':'pending';state.title='这里只选择资料是否仍需提供；实际接收与核对状态单独保留。';
      const stateArea=el('div',undefined,'ac-state-area'),recorded=el('small','记录状态：'+names[s.status],'ac-record-state');recorded.dataset.recordState=item.id;stateArea.append(state,recorded);header.append(stateArea);state.onchange=controls;card.append(header);
      if(s.status==='problem'){const feedback=el('div',undefined,'ac-rejected-feedback');feedback.dataset.rejectedFeedback=item.id;feedback.setAttribute('role','status');feedback.append(el('strong','✕ 核对不通过 · 已打回'),el('span','打回原因：'+s.reason),el('span','核对人：'+s.reviewer+' · '+new Date(s.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})),el('small','请移除错传的附件关联后补传正确资料，或补齐说明再复核。原附件和打回记录保留在历史；本项未通过，不能关门。'));card.append(feedback);}
      if(s.status==='received'){
        const events=record.events;let start=0;for(let i=0;i<events.length;i++)if(['tree-import','tree-replace','import','replace'].includes(events[i].type))start=i;
        const decision=events.slice(start).reverse().find(e=>e.type==='item'&&e.id===item.id&&['problem','confirmed','na'].includes(e.after?.status));
        if(decision?.after.status==='problem'){const feedback=el('div',undefined,'ac-recheck-feedback');feedback.dataset.recheckFeedback=item.id;feedback.append(el('strong','↻ 资料已更新 · 等待重新核对'),el('span','上次打回原因：'+decision.after.reason),el('small','补传或移除不代表问题已解决，须再次点击核对通过；此前打回记录保留。'));card.append(feedback);}
      }
      if(s.status==='confirmed'){const feedback=el('div',undefined,'ac-confirmed-feedback');feedback.dataset.confirmedFeedback=item.id;feedback.setAttribute('role','status');feedback.append(el('strong','✓ 已核对通过'),el('span','核对人：'+s.reviewer+' · '+new Date(s.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})),el('small','当前资料已通过本项核对；修改资料或核对内容并保存后，需要重新核对。'));card.append(feedback);}
      if(tree){
        describe(item,card);const picker=el('input');picker.type='file';picker.hidden=true;picker.multiple=true;picker.id='ac-file-'+item.id;picker.accept=Object.keys(A.FILE_TYPES).map(ext=>'.'+ext).join(',');card.append(picker);
        title.onclick=()=>{if(pendingMaterial&&pendingMaterial.nodeId!==item.id&&!root.confirm('另一个标题还有未保存的所选文件。放弃它们并选择本项资料？'))return;if(pendingMaterial?.nodeId!==item.id)clearUploads();picker.click();};
        picker.onchange=()=>{const fs=Array.from(picker.files||[]);picker.value='';if(!fs.length)return;
          const current=record.attachments[item.id]||[];if(fs.length+current.length>10){say('每个资料项最多 10 个附件，请减少本次选择。',true);return;}
          if(fs.some(f=>!f.size||f.size>12*1024*1024||!/\.(?:pdf|docx?|xlsx?|png|jpe?g|txt|zip|rar)$/iu.test(f.name))){say('请选择支持的非空资料文件，每份不超过 12 MiB。',true);return;}
          pendingMaterial={key:active,token:serial,revision:record.revision,nodeId:item.id,files:fs};render();void run(commitMaterial);
        };
        const files=record.attachments[item.id]||[],list=el('ul',undefined,'ac-material-files');
        for(const f of files){
          const li=el('li'),get=button('下载原件'),peek=button(f.name+' · 预览'),remove=button('移除');peek.dataset.materialPreview=f.id;peek.title='点击预览附件';peek.onclick=()=>void run(async()=>{const got=await db.downloadAttachment(active,item.id,f.id);root.AuditAttachmentPreview.open({blob:got.blob,name:got.metadata.name,sha256:got.metadata.sha256});});get.dataset.materialDownload=f.id;get.title='下载此项已保存资料';
          get.onclick=()=>void run(async()=>{const got=await db.downloadAttachment(active,item.id,f.id);download(got.blob,got.metadata.name);say('已请求下载「'+f.name+'」。');});
          remove.dataset.materialRemove=f.id;remove.onclick=()=>void run(async()=>{
            if(!requireReviewer())return;if(!reason.value.trim()){missingField(reason,'移除资料前，请在上方填写「操作理由」。');return;}
            if(!root.confirm('从当前标题移除「'+f.name+'」？此前核对将失效，历史版本保留。'))return;
            record=await db.removeAttachment(active,record.revision,item.id,f.id,reviewer.value,reason.value);render();say('已移除当前附件关联并重置核对；原文件与操作保留在历史。');
          });
          li.append(peek,get,el('small',(f.size/1024).toFixed(1)+' KiB · SHA256 '+f.sha256.slice(0,12)+'…'),remove);list.append(li);
        }
        card.append(list);if(!files.length)card.append(el('p','尚未上传文件。点击上方标题选择该项资料。','tiny'));
        if(pendingMaterial?.nodeId===item.id){
          const stage=el('div',undefined,'ac-material-pending'),keep=button('保存所选资料'),cancel=button('取消所选');
          stage.append(el('p','待保存：'+pendingMaterial.files.map(f=>f.name).join('、')+'。填写核对人后可保存。'),keep,cancel);
          keep.onclick=()=>void run(commitMaterial);cancel.onclick=()=>{clearUploads();render();say('已取消所选资料，原文件不变。');};card.append(stage);
        }
      }
      const evidence=input('ac-evidence-'+item.id,'证据文件名、底稿索引或存放位置',1000),why={value:s.reason},save=button('保存选择'),rejectItem=button('核对不通过 / 打回'),confirmItem=button('核对通过');rejectItem.dataset.rejectItem=item.id;rejectItem.classList.add('ac-reject-item');rejectItem.setAttribute('aria-pressed',String(s.status==='problem'));if(s.status==='problem')rejectItem.textContent='✕ 已打回';evidence.value=s.evidence;why.value=s.reason;save.dataset.saveItem=item.id;confirmItem.dataset.confirmItem=item.id;confirmItem.classList.add('ac-confirm-item');if(s.status==='confirmed'){confirmItem.textContent='✓ 已核对通过';confirmItem.setAttribute('aria-pressed','true');confirmItem.title='本项已经核对通过；再次点击将重新保存核对记录。';}else confirmItem.setAttribute('aria-pressed','false');
      const f=el('div',undefined,'ac-item-fields'),reviewActions=el('div',undefined,'ac-review-actions');reviewActions.append(save,confirmItem,rejectItem);f.append(label('证据索引',evidence),reviewActions);card.append(f,el('small',s.at?'上次：'+s.reviewer+' · '+new Date(s.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'未核对'));
      save.onclick=()=>void run(async()=>{
        if(!requireReviewer())return;
        if(state.value==='na'&&record.states[item.id].status!=='na'){const answer=root.prompt('请说明本项不适用的原因（取消则不保存）：','');if(answer===null)return;if(!answer.trim()){say('不适用需填写说明；本次未保存。',true);return;}why.value=answer;}
        const prior=record.states[item.id],hasFiles=record.schema===2&&record.attachments[item.id].length>0,edited=evidence.value.trim()!==prior.evidence||why.value.trim()!==prior.reason;
        let next=state.value==='na'?'na':prior.status==='na'?(hasFiles?'received':'pending'):prior.status;
        if(next==='confirmed'&&edited)next=hasFiles?'received':'pending';
        if(next===prior.status&&!edited){say('选择与记录未改变，已保留原状态、人员和时间。');return;}
        record=await db.change(active,record.revision,{type:'item',id:item.id,status:next,evidence:evidence.value,reason:why.value,reviewer:reviewer.value});render();say('已保存本项选择；不代表已关门。');
      });
      rejectItem.onclick=()=>void run(async()=>{
        if(state.value==='na'||record.states[item.id].status==='na'){say('本项为不适用，请先恢复待提供并保存后再核对。',true);return;}
        if(!requireReviewer())return;const answer=root.prompt('请填写打回原因，例如：公司章程错传营业执照，请重新提供（取消则不打回）：',record.states[item.id].status==='problem'?record.states[item.id].reason:'');if(answer===null)return;if(!answer.trim()){say('打回需填写原因；本次未保存。',true);return;}why.value=answer;
        record=await db.change(active,record.revision,{type:'item',id:item.id,status:'problem',evidence:evidence.value,reason:why.value,reviewer:reviewer.value});render();say('✕ 本项核对不通过，已打回；原因与原附件留痕保留，补传后仍需人工复核。',true);
      });
      confirmItem.onclick=()=>void run(async()=>{
        if(state.value==='na'||record.states[item.id].status==='na'){say('本项为不适用，不能核对通过；如需恢复，请先选择待提供并保存。',true);return;}
        if(!requireReviewer())return;
        record=await db.change(active,record.revision,{type:'item',id:item.id,status:'confirmed',evidence:evidence.value,reason:why.value,reviewer:reviewer.value});render();say('已保存本项核对；不代表已关门。✓ 本项已核对通过。');
      });
      return card;
    }
    function render(){
      rows.replaceChildren();log.replaceChildren();categoryNav.replaceChildren();const p=selected(),tree=record?.schema===2;
      const ts=T?.stats();templateInfo.textContent=ts?'按确认版Word的四大分类、1–4级标题和主项1–52预置：'+ts.headings+' 个标题、'+ts.materials+' 个末级资料项。第四分类保留为空组，不要求上传。'+(record?'已有清单不会自动覆盖；使用模板会建立新版本并保留历史。':'选正式项目后明确建立；或点独立试用直接体验模板。'):'模板组件尚未载入，请刷新后重试。';
      trialNote.hidden=!isTrial();trialBtn.setAttribute('aria-pressed',String(isTrial()));close.textContent=isTrial()?'确认试用资料关门':'确认资料关门';
      caption.textContent=isTrial()?'独立试用：不关联报价或立项；新建按修正版Word模板预置，所有资料均未核对。记录与资料仅存本浏览器。':p?'项目：'+p.form.projectName+' · '+p.source.firmName+' · 报价编号 '+p.quoteId:'可点「独立试用」先体验；正式项目请在「立项」保存信息后刷新。';
      if(!record){summary.textContent='本项目尚未建立资料清单。可使用上方2026修正版模板，或另选Word清单；不会自动写入正式项目。';controls();return;}
      const g=A.gate(record);summary.textContent=(isTrial()?'独立试用 · ':'')+(record.closed?'已关门':'未关门')+' · '+(tree?'末级资料 ':'旧版行式资料 ')+g.total+' 项 · 核对通过 '+g.confirmed+' · 不适用 '+g.excluded+' · 待处理 '+g.blockers.length+' · 第 '+record.revision+' 版';
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
      const eventNames={import:'导入旧版清单',replace:'替换旧版清单','tree-import':'导入标题结构','tree-replace':'替换标题结构','attachment-add':'上传资料','attachment-remove':'移除资料关联',close:'资料关门',reopen:'重新开门'};
      for(const e of record.events.slice(-100).reverse()){
        const line=el('li',(e.type==='item'?'资料 '+e.id+' → '+names[e.after.status]:(eventNames[e.type]||e.type))+(e.file?' · '+e.file.name:'')+' · '+e.reviewer+' · '+new Date(e.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+(e.reason?' · '+e.reason:''));
        if(tree&&e.type==='attachment-add'){const get=button('下载此版本');get.dataset.historyDownload=e.file.id;get.onclick=()=>void run(async()=>{const got=await db.downloadAttachment(active,e.nodeId,e.file.id);download(got.blob,got.metadata.name);say('已请求下载该历史版本资料。');});line.append(get);}log.append(line);
      }
      controls();
    }
    async function run(fn){if(busy)return;busy=true;controls();try{if(active)db=await storage(active);await fn();}catch(e){say(e?.message||'操作失败，未覆盖原记录。',true);}finally{busy=false;controls();}}
    async function loadProject(){
      preservationRecoveryTarget=false;clearPending();clearUploads();groupOpen.clear();const ticket=++serial;active=selection.value;record=null;render();if(!active)return;
      await run(async()=>{const r=await db.get(active);if(ticket!==serial)return;
        record=r;if(isTrial()&&!record){if(mode.value==='legacy')record=await db.create(projectOf(trialProject),A.parse(demoText),'系统（独立试用初始化）');else{if(!T)throw Error('模板组件未载入，请刷新后重试。');record=await db.importTree(projectOf(trialProject),T.get(),'系统（修正版模板试用初始化）','',0);}}render();
        say(isTrial()?'已进入独立试用。新试用按修正版模板组织资料；不代表真实立项、核对通过或审计完成。':record?'已载入本项目清单。':'本项目尚未导入清单。');});
    }
    async function show(){
      clearPreservation();if(busy)return;clearPending();clearUploads();serial++;
      await run(async()=>{projects=await listProjects();const old=active;selection.replaceChildren(option('','请选择已保存的立项'));trialOption();
        for(const p of projects)selection.append(option(p.quoteId,p.form.projectName+' · '+p.source.firmName));
        active=old===TRIAL||projects.some(p=>p.quoteId===old)?old:'';selection.value=active;record=active?await(await storage(active)).get(active):null;render();
        say(isTrial()?'已载入独立试用；与正式项目分开保存。':projects.length?'请选择已立项项目，或直接进入独立试用。':'暂无已保存立项，可点「独立试用（无需立项）」先体验。');});
    }
    const materialNodes=ns=>{const parents=new Set(ns.map(n=>n.parentId));return ns.filter(n=>!parents.has(n.id)&&n.kind!=='group');};
    const recognize=ns=>T?.recognize(ns)||ns;
    function updatePreviewCount(){try{const ns=pendingImport.nodes||recognize(O.build(pendingImport.rows));outlineCount.textContent=(pendingImport.template?'确认版模板：':'当前建议：')+ns.length+' 个标题，'+materialNodes(ns).length+' 个末级上传资料项。父标题及明确的空分类仅分组，不重复要求上传。';outlineCount.classList.remove('error');}catch(e){outlineCount.textContent=e.message;outlineCount.classList.add('error');}}
    useTemplate.onclick=()=>{
      if(busy)return;if(!selected()){say('请先选择已保存立项，或进入独立试用。',true);return;}if(record?.closed){say('清单已关门，请先说明理由重新开门。',true);return;}if(!T){say('模板组件未载入，请刷新后重试。',true);return;}
      clearPending();pendingImport={template:true,nodes:T.get(),name:T.label,key:active,token:serial,revision:record?.revision||0};pendingBox.hidden=false;preview.hidden=ackLabel.hidden=outlineStats.hidden=outlineCount.hidden=false;warning.hidden=true;preview.replaceChildren();ack.checked=false;
      pendingText.textContent='使用「'+T.label+'」建立本项目资料清单。请先核对结构；确认前原清单和附件不变。';
      outlineStats.textContent='四大分类 · 1–4级标题 · 主项1–52，子项随父编号。此模板不包含任何已上传附件或已核对结论。';
      for(const n of pendingImport.nodes){const line=el('div',n.title,'ac-template-preview-row');line.style.paddingLeft=(12+(n.level-1)*18)+'px';line.dataset.templateNode=n.id;if(n.kind==='group'){line.classList.add('is-group');line.append(el('small',pendingImport.nodes.some(c=>c.parentId===n.id)?'分组':'空分类 · 不要求上传'));}preview.append(line);}
      pendingContinue.textContent='按模板建立清单';updatePreviewCount();controls();say('模板结构已展开供核对；勾选确认并补齐核对人后建立。已有清单替换须另填理由。');
    };
    function previewRows(){
      const job=pendingImport;preview.replaceChildren();if(!job?.rows)return;ack.checked=false;
      const levels=Object.entries(job.source.actualLevels||{}).filter(([,n])=>n>0);outlineStats.textContent='文件实际大纲：'+(levels.length?levels.map(([k,n])=>k+'级 '+n+' 段').join('；'):'未检测到标题级别')+'。当前预览：'+(job.mode==='numbered'?'按编号建议，尚需核对':'Word 真实大纲')+'。0 表示正文说明，不是上传项。';
      warning.textContent=job.warnings.join('\n');warning.hidden=!job.warnings.length;
      for(const [i,row]of job.rows.entries()){
        const line=el('div',undefined,'ac-outline-row'),level=el('select');level.dataset.outlineLevel=String(i);level.setAttribute('aria-label','第 '+(i+1)+' 段的标题级别');
        level.append(option('0','正文说明'));for(let n=1;n<=9;n++)level.append(option(String(n),n+'级标题'));level.value=String(row.level);
        const title=el('span',row.text);title.style.paddingLeft=(Math.max(0,row.level-1)*10)+'px';level.onchange=()=>{row.level=Number(level.value);title.style.paddingLeft=(Math.max(0,row.level-1)*10)+'px';ack.checked=false;updatePreviewCount();controls();};line.append(level,title);preview.append(line);
      }
    }
    async function commitImport(){
      const job=pendingImport;if(!job)return;if(job.key!==active||job.token!==serial){clearPending();throw Error('已切换项目，请重新读取当前项目清单。');}
      if(!importFields(!!record))return;if((record?.revision||0)!==job.revision){clearPending();throw Error('当前清单已发生变化。请重新读取文件后核对，不覆盖已有修改。');}
      let ns=job.nodes||null;if(job.rows||job.template){if(!ack.checked){say('请先核对层级并勾选确认。',true);return;}if(job.rows)ns=recognize(O.build(job.rows));}
      const count=ns?materialNodes(ns).length:job.items.length;
      if(!root.confirm('本项目导入 '+count+' 个'+(ns?'末级上传资料项':'旧版行式资料项')+'。'+(record?'当前确认状态将重置，旧记录与原文件留在历史。':'不会自动确认任何资料。'))){say('已取消确认，原清单未变；本次读取结果仍保留。');return;}
      const p=selected();if(!p)throw Error('请先选择已保存立项，或进入独立试用。');
      if(ns)record=await db.importTree(projectOf(p),ns,reviewer.value,reason.value,job.revision);
      else{if(record?.schema===2)throw Error('层级资料不降级为旧版行式记录，请使用标题层级导入。');record=record?await db.change(active,job.revision,{type:'replace',items:job.items,reason:reason.value,reviewer:reviewer.value}):await db.create(projectOf(p),job.items,reviewer.value);}
      clearPending();clearUploads();groupOpen.clear();render();say('已导入 '+count+' 项，当前均为待提供。'+(ns?'点击末级资料标题即可选择文件。':''));
    }
    pendingContinue.onclick=()=>void run(commitImport);pendingCancel.onclick=()=>{if(busy)return;clearPending();controls();say('已取消本次导入，原清单未改变。');};
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
          if(!O)throw Error('标题识别组件未载入，请刷新后重试。');const source=await O.read(f),prepared=O.prepare(source,chosen);if(token!==serial||key!==active)return;
          pendingImport={name:f.name,key,token,revision,source,mode:chosen,rows:prepared.rows,warnings:prepared.warnings||[]};pendingBox.hidden=false;preview.hidden=ackLabel.hidden=outlineStats.hidden=outlineCount.hidden=false;
          pendingText.textContent='已读取「'+f.name+'」。请先核对下方层级，正文说明请选择0，不要把换行当成独立资料。';pendingContinue.textContent='补齐后导入';previewRows();updatePreviewCount();say('已读取清单。请核对层级，勾选确认，再导入。');
        }
      });
    };
    selection.onchange=()=>void loadProject();refresh.onclick=()=>void show();filter.onchange=render;search.oninput=render;
    trialBtn.onclick=()=>{trialOption();selection.value=TRIAL;filter.value='all';search.value='';void loadProject();};
    close.onclick=()=>void run(async()=>{if(!record||!requireReviewer())return;if(!root.confirm((isTrial()?'【独立试用】':'')+'确认全部末级资料已核对通过或说明不适用，执行资料关门？这不是报告审批。'))return;record=await db.change(active,record.revision,{type:'close',reviewer:reviewer.value});clearUploads();render();say('已明确执行资料关门。修改前须说明理由重新开门。');});
    reopen.onclick=()=>void run(async()=>{if(!record||!requireReviewer())return;if(!reason.value.trim()){missingField(reason,'重新开门前，请填写「操作理由」。');return;}record=await db.change(active,record.revision,{type:'reopen',reviewer:reviewer.value,reason:reason.value});render();say('已重新开门并记录理由。');});
    exportBtn.onclick=()=>{if(!record)return;download(new Blob([JSON.stringify({app:'hengdu.audit.materials',mode:isTrial()?'trial':'project',exportedAt:new Date().toISOString(),record},null,2)],{type:'application/json'}),isTrial()?'独立试用-资料核对记录.json':'审计资料清单-核对与关门记录.json');say('已请求下载清单、文件元数据与留痕 JSON。JSON 不含文件正文，请逐份下载并另存资料原件；此导出暂不自动恢复其他浏览器。');};
    render();return Object.freeze({show});
  }
  root.AuditProgram=Object.freeze({mount});
})(globalThis);
