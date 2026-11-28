/* Project closure and local archive download. Review findings remain in the package. */
(function(root){'use strict';
 const TRIAL='00000000-0000-4000-8000-000000000033';
 function mount(host,{governanceSummary,listProjects=()=>root.ProjectInitiation.listSaved()}={}){
  const d=host.ownerDocument,A=root.AuditArchive,S=root.ProjectWorkspaceStore,L=root.WorkpaperLibrary,R=root.WorkpaperRouting;
  if(!A||!S||!L||!R)throw Error('归档组件未加载，请刷新后重试。');
  const make=(t,s,cls)=>{const n=d.createElement(t);if(s!==undefined)n.textContent=s;if(cls)n.className=cls;return n;},button=(id,s)=>{const n=make('button',s,'btn');n.id=id;n.type='button';return n;};
  const box=make('section',undefined,'aa-root'),select=make('select'),refresh=button('audit-archive-refresh','刷新本项目资料'),preview=button('audit-archive-preview','生成归档核对清单'),save=button('audit-archive-save-links','保存明确的附件关联'),exportBtn=button('audit-archive-export','项目完结并下载归档资料'),status=make('p','请选择被审计单位与审计项目。','aa-status'),mapping=make('div'),summary=make('div'),confirm=make('input'),consent=make('label',undefined,'aa-consent');
  select.id='audit-archive-project';select.setAttribute('aria-label','底稿归档项目');status.id='audit-archive-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');confirm.id='audit-archive-confirm';confirm.type='checkbox';const consentText=d.createTextNode('');consent.append(confirm,consentText);
  const company=make('select');company.id='audit-archive-company';
  const field=(text,input)=>{const label=make('label',text);label.append(input);return label;};
  const actions=make('div',undefined,'aa-actions');actions.append(field('被审计单位',company),field('审计项目',select),refresh,preview);box.append(actions,status,mapping,save,summary,consent,exportBtn);host.replaceChildren(box);
  let projectId='',workspace=null,checklist=null,projects=[],currentPreview=null,prepared=null,dirty=false,busy=false,serial=0,dead=false;
  const say=(s,bad=false)=>{status.textContent=s;status.classList.toggle('error',bad);},alive=t=>!dead&&t===serial;
  const canLeave=()=>!busy&&(!dirty||typeof root.confirm==='function'&&root.confirm('附件归档关联有未保存的修改。继续离开将丢弃这些修改，原件不会改变。继续？'));
  function sync(){box.inert=busy;company.disabled=select.disabled=busy;refresh.disabled=busy;preview.disabled=busy||!projectId||dirty;save.disabled=busy||!projectId||!dirty;exportBtn.disabled=busy||!currentPreview||!confirm.checked;}
  async function run(fn,saving=false){if(busy)return;busy=true;sync();try{await fn();}catch(e){if(!dead)say((saving?root.SaveFeedback?.failed(e):null)||e.message,true);}finally{busy=false;if(!dead)sync();}}
  async function materials(key){const db=await (key===TRIAL?root.AuditChecklist.openTrial():root.AuditChecklist.open());try{const value=await db.get(key);if(value){root.AuditChecklist.validate(value);if(value.project.quoteId!==key)throw Error('资料清单归属不一致，未读取其他项目。');}return value;}finally{db.close();}}
  async function lockSummary(w){const G=root.WorkpaperGovernance,stored=w.workpaperLocks||{},snapshots=[];for(const [row,lock]of Object.entries(stored))snapshots.push({row,snapshotHash:typeof lock?.snapshotHash==='string'?lock.snapshotHash:null,valid:typeof G?.verifyLock==='function'?await G.verifyLock(lock):false});let currentBindingsValid=false;if(typeof G?.assertTransition==='function')try{currentBindingsValid=G.assertTransition(w,w)===true;}catch{}let pendingProvenance=0;const walk=v=>{if(!v||typeof v!=='object')return;if(v.pendingReview===true)pendingProvenance++;for(const x of Object.values(v))if(x&&typeof x==='object')walk(x);};walk(A.provenanceSnapshot(w));return {scope:'Individual saved local snapshot hashes and current bindings only; not a whole-project lock or audit completion assertion',allLocked:false,pendingReview:!snapshots.length||!currentBindingsValid||snapshots.some(s=>!s.valid)||pendingProvenance>0,componentAvailable:!!G,snapshots,currentBindingsValid,pendingProvenance};}
  function invalidate(){currentPreview=null;prepared=null;summary.replaceChildren();confirm.checked=false;sync();}
  function changed(){dirty=true;invalidate();say('附件关联尚未保存；请先明确保存，再生成归档核对清单。');}
  function renderMapping(){mapping.replaceChildren();const attachments=A.currentAttachments(checklist),rows=root.WorkpaperDirectory.rows.filter(r=>r.row>=6&&(r.row<267||[267,269,270].includes(r.row))&&(r.C||R.row(r.row).targets?.length));mapping.append(make('h3','明确附件 → 目录行／科目关联'),make('p','上传、文件名相似或清单已核对，都不会自动决定科目。未关联的当前附件仍单独收录在“未关联资料”，并列为待处理事项。'));
   if(!attachments.length){mapping.append(make('p','本项目当前没有层级资料附件；不会从其他项目或历史移除附件借用。'));return;}
   const table=make('table'),head=make('tr');for(const s of ['资料项与附件','核对状态','明确关联目录行','科目／关联说明'])head.append(make('th',s));table.append(head);for(const a of attachments){const tr=make('tr');tr.dataset.nodeId=a.nodeId;tr.dataset.fileId=a.fileId;const name=make('td'),state=make('td',a.status==='confirmed'?'核对通过':'尚未核对通过'),choice=make('select'),subject=make('input'),saved=(workspace.archiveLinks||[]).find(l=>l.nodeId===a.nodeId&&l.fileId===a.fileId);name.append(make('strong',a.title),make('p',a.file.name),make('small','SHA256 '+a.file.sha256));choice.dataset.archiveRow='';choice.append(new Option('未关联 · 单独收录',''));for(const r of rows)choice.append(new Option(String(r.C||r.row)+' · '+(r.B||'目录原行')+'（行'+r.row+'）',String(r.row)));choice.value=saved?String(saved.directoryRow):'';subject.dataset.archiveSubject='';subject.maxLength=150;subject.setAttribute('aria-label','附件关联说明 '+a.file.name);subject.placeholder='由你明确填写，不智能猜测';subject.value=saved?.subject||'';choice.onchange=changed;subject.oninput=changed;const cell=make('td');cell.append(choice);const s=make('td');s.append(subject);tr.append(name,state,cell,s);table.append(tr);}const wrap=make('div',undefined,'aa-table-wrap');wrap.append(table);mapping.append(wrap);
  }
  function collectedLinks(){const links=[];for(const tr of mapping.querySelectorAll('tr[data-file-id]')){const selected=tr.querySelector('[data-archive-row]').value,subject=tr.querySelector('[data-archive-subject]').value.trim();if(!selected){if(subject)throw Error('填写科目说明后须明确选择目录行，或清空说明保留未关联。');continue;}if(!subject)throw Error('请为每个关联明确填写科目说明。');links.push({nodeId:tr.dataset.nodeId,fileId:tr.dataset.fileId,directoryRow:Number(selected),subject});}return links;}
  function renderPreview(){summary.replaceChildren();const m=currentPreview.manifest;summary.append(make('h3','归档核对清单（不是最终验收）'),make('p','原件 '+currentPreview.jobs.filter(j=>j.kind==='original').length+' 份；当前附件 '+m.attachments.length+' 份；待处理 '+m.issues.length+' 项。最多180MiB／2000成员，超限整包拒绝，不下载半包。'));if(m.issues.length){const list=make('ul');for(const issue of m.issues.slice(0,150))list.append(make('li',(issue.row?'目录行'+issue.row+' '+(issue.index||'')+'：':'')+issue.message+(issue.path?' / '+issue.path:'')));summary.append(list);if(m.issues.length>150)summary.append(make('p','此处显示前150项；全部'+m.issues.length+'项均保留在ZIP归档清单中。'));}summary.append(make('p','原始ZIP整包及历史已移除附件不在本备份内，请另行保留原包。冻结与变更留痕快照会写入manifest；锁定、填写进度或技术校验均不能替代审计复核。','aa-warning'));}
  async function load(){const ticket=++serial;projectId=select.value;
   const trial=projectId===TRIAL;
   exportBtn.textContent=trial?'下载试用归档资料':'项目完结并下载归档资料';
   consentText.textContent=trial?'我已阅读归档核对清单，确认下载本次试用资料。':'我已阅读归档核对清单，确认将当前项目标记为完结并下载归档资料。待处理事项将保留在 ZIP 清单中。';
   workspace=checklist=null;dirty=false;mapping.replaceChildren();invalidate();if(!projectId){say('请选择被审计单位与审计项目。');return;}const key=projectId;const w=await S.get(key),c=await materials(key);if(!alive(ticket))return;if(w.id!==key)throw Error('工作区归属不一致。');workspace=w;checklist=c;renderMapping();say('已读取该项目本机工作区与当前资料清单。请明确附件关联，再生成归档核对清单。');}
  const companyOf=p=>p.companyName||p.source?.customerName||'';
  let selectedCompany='';
  function showProjects(preferred=projectId){
   const scoped=projects.filter(p=>!selectedCompany||companyOf(p)===selectedCompany);
   select.replaceChildren(new Option('请选择已立项项目',''),...(!selectedCompany?[new Option('独立试用（不关联正式项目）',TRIAL)]:[]),
    ...scoped.map(p=>new Option(p.form.projectName,p.quoteId)));
   select.value=Array.from(select.options).some(option=>option.value===preferred)?preferred:'';
   company.value=selectedCompany;
  }
  async function projectList(){
   const ticket=++serial,rows=await listProjects();
   if(!alive(ticket))return;
   projects=rows;
   const names=[...new Set(projects.map(companyOf).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
   if(!names.includes(selectedCompany))selectedCompany='';
   company.replaceChildren(new Option('全部被审计单位',''),...names.map(name=>new Option(name,name)));
   showProjects();await load();
  }
  company.onchange=()=>{
   if(busy||!canLeave()){company.value=selectedCompany;return;}
   selectedCompany=company.value;showProjects();void run(load);
  };
  select.onchange=()=>{if(busy||!canLeave()){select.value=projectId;return;}void run(load);};refresh.onclick=()=>{if(canLeave())void run(projectList);};save.onclick=()=>void run(async()=>{const key=projectId,ticket=serial,links=collectedLinks(),next=await S.save(key,workspace.rev,{archiveLinks:links});if(!alive(ticket))return;workspace=next;dirty=false;invalidate();say(root.SaveFeedback?.saved('已按当前项目版本保存附件关联；原件、清单核对状态与冻结记录未改变。')??('已按当前项目版本保存附件关联；原件、清单核对状态与冻结记录未改变。'));},true);
  preview.onclick=()=>void run(async()=>{if(dirty)throw Error('请先保存附件关联。');const key=projectId,ticket=serial;invalidate();const w=await S.get(key),c=await materials(key);if(!alive(ticket))return;const p=await L.prepare(w);if(!alive(ticket))return;const governance=typeof governanceSummary==='function'?await governanceSummary(w,p):await lockSummary(w);if(!alive(ticket))return;currentPreview=A.plan({projectId:key,workspace:w,checklist:c,prepared:p,directory:root.WorkpaperDirectory,routing:R,links:w.archiveLinks||[],governance});workspace=w;checklist=c;prepared=p;renderMapping();renderPreview();say('归档核对清单已生成。请核对待处理事项并勾选下方确认框。');});
  confirm.onchange=sync;
  exportBtn.onclick=()=>void run(async()=>{if(!confirm.checked||!currentPreview)throw Error('请先生成归档核对清单并勾选确认。');const key=projectId,ticket=serial,plan=currentPreview,p=prepared;
   const result=await A.build(plan,{readCurrent:async()=>({workspace:await S.get(key),checklist:await materials(key)}),hash:data=>S.hash(new Blob([data])),readOriginal:async source=>(await L.fileFor({path:source.path,sha256:source.sha256},p)).file,readAttachment:async a=>{const db=await (key===TRIAL?root.AuditChecklist.openTrial():root.AuditChecklist.open());try{const c=await db.get(key);root.AuditChecklist.validate(c);const current=A.currentAttachments(c).find(f=>f.nodeId===a.nodeId&&f.fileId===a.fileId);if(c.project.quoteId!==key||c.revision!==plan.expected.checklistRevision||current?.file.sha256!==a.file.sha256||current.generationId!==a.generationId)throw Error('当前附件或清单版本已改变，未借用历史附件。');return (await db.downloadAttachment(key,a.nodeId,a.fileId)).blob;}finally{db.close();}}});
   const latest=await S.get(key),latestChecklist=await materials(key);
   if(!alive(ticket)||host.closest('[hidden]'))return;
   if(latest.rev!==plan.expected.workspaceRevision||(latestChecklist?.revision||0)!==plan.expected.checklistRevision||
      (latestChecklist?.generationId||null)!==plan.expected.checklistGeneration){
     invalidate();throw Error('项目资料已更新，请重新生成归档核对清单。');
   }
   const trial=key===TRIAL,patch=trial?{}:root.AuditWorkflow.completionPatch(latest);
   S.download(new Blob([result.bytes],{type:'application/zip'}),'审计底稿本机备份-'+key+'.zip');
   if(Object.keys(patch).length){
     try{workspace=await S.save(key,latest.rev,patch);}
     catch(error){invalidate();throw Error('归档 ZIP 已发起下载，项目完结状态保存失败。'+error.message+' 请重新生成清单后重试。');}
     invalidate();
   }else confirm.checked=false;
   say((trial?'试用归档资料已发起下载。':'项目已标记为完结，归档资料已发起下载。')+'ZIP 共 '+result.entryCount+' 项，待处理 '+plan.manifest.issues.length+' 项。');
  });
  sync();
  const ready=run(projectList);
  return Object.freeze({
    show(){box.scrollIntoView?.({block:'start'});},
    async selectProject(id){
      await ready;
      if(projectId!==id&&!canLeave())return;
      if(id!==TRIAL&&!projects.some(p=>p.quoteId===id))await run(projectList);
      const project=projects.find(p=>p.quoteId===id);
      if(!project&&id!==TRIAL)throw Error('未找到该归档项目。');
      selectedCompany=companyOf(project||{});
      showProjects(id);
      if(projectId!==id)await run(load);
    },
    canLeave,destroy(){dead=true;++serial;workspace=checklist=currentPreview=prepared=null;box.remove();}
  });
 }
 root.AuditArchiveUI=Object.freeze({mount});
})(globalThis);
