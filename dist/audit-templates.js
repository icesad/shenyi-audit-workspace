/* Browser-local original templates only. No upload, Office execution, or automatic unknown-layout import. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.AuditTemplates=api;})(globalThis,function(root){'use strict';
 const DB='hengdu.audit.templates.v1',STORE='originals',TRIAL='00000000-0000-4000-8000-000000000033',MAX_FILE=1_000_000_000,MAX_RECORDS=200,SHA=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 const fail=s=>{throw Error(s);};
 function name(value){if(typeof value!=='string'||!value||value.length>200||value.trim()!==value||typeof value.isWellFormed==='function'&&!value.isWellFormed()||/[\\/:<>"|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)||/[. ]$/.test(value)||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)||!/^.+\.(?:zip|xlsx?|docx?|pdf)$/i.test(value))fail('请选择文件名安全的 ZIP、XLS、XLSX、DOC、DOCX 或 PDF 原件。');return value;}
 function validateFile(file){if(!file||typeof file.arrayBuffer!=='function'||!Number.isSafeInteger(file.size)||file.size<1||file.size>=MAX_FILE)fail('模板原件须大于 0 字节且小于 1 GB。');name(file.name);return file;}
 async function hash(blob){
  const checksum=root.QuotePacket||(typeof require==='function'?require('./quote-packet.js'):null);
  if(checksum?.sha256Blob)return checksum.sha256Blob(blob);
  if(blob.size>16*1024*1024)fail('文件校验组件未加载，请刷新页面后重试。');
  return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
 }
 function attribution(value,max){
  if(typeof value!=='string'||value.length>max||!value.isWellFormed()||/[\u0000-\u001f\u007f]/.test(value))fail('所属事务所或上传人填写无效。');
  return value.trim();
 }
 function metadata(r){return {schema:r.schema,sha256:r.sha256,name:r.name,size:r.size,type:r.type,createdAt:r.createdAt,
  ...(r.firm?{firm:r.firm}:{}),...(r.uploader?{uploader:r.uploader}:{})};}
 function validateRecord(r){if(!r||r.schema!==1||!SHA.test(r.sha256||'')||!Number.isSafeInteger(r.size)||r.size<1||r.size>=MAX_FILE||!r.blob||typeof r.blob.arrayBuffer!=='function'||r.blob.size!==r.size||typeof r.type!=='string'||r.type.length>160||/[\u0000-\u001f]/.test(r.type)||typeof r.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.createdAt)||!Number.isFinite(Date.parse(r.createdAt)))fail('本机模板记录无效，未覆盖或下载。');name(r.name);if(r.firm!==undefined)attribution(r.firm,200);if(r.uploader!==undefined)attribution(r.uploader,100);return r;}
 function inventory(rows){if(!Array.isArray(rows)||rows.length>MAX_RECORDS)fail('本机模板库超过200份或结构无效，未新增。');let total=0;const ids=new Set();for(const r of rows){validateRecord(r);if(ids.has(r.sha256))fail('本机模板身份重复，未新增。');ids.add(r.sha256);total+=r.size;}return {total,count:rows.length};}
 async function open({dbName=DB,indexedDB=root.indexedDB,hashFile=hash}={}){
  if(!indexedDB?.open)fail('当前浏览器不支持本机模板存储。');const db=await new Promise((ok,no)=>{const q=indexedDB.open(dbName,1);q.onupgradeneeded=()=>q.result.createObjectStore(STORE,{keyPath:'sha256'});q.onsuccess=()=>ok(q.result);q.onerror=()=>no(Error('本机模板库未能打开；未改写旧数据。'));q.onblocked=()=>no(Error('模板库被其他旧页面占用，请关闭旧页后重试。'));});let closed=false;
  const active=()=>{if(closed)fail('模板库已关闭。');};
  function transaction(mode,work){active();return new Promise((ok,no)=>{let result,error;const t=db.transaction(STORE,mode),st=t.objectStore(STORE);const reject=e=>{error=e;try{t.abort();}catch{}};try{work(st,v=>{result=v;},reject);}catch(e){reject(e);}t.oncomplete=()=>ok(result);t.onabort=()=>no(error||root.SaveFeedback?.storageError(t.error,'本机模板写入失败，原记录未改变。')||Error('本机模板写入失败，原记录未改变。'));t.onerror=()=>{};});}
  async function list(){return transaction('readonly',(st,done,reject)=>{const q=st.getAll(null,MAX_RECORDS+1);q.onsuccess=()=>{try{const sum=inventory(q.result);done({records:q.result.map(metadata).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.sha256.localeCompare(b.sha256)),...sum});}catch(e){reject(e);}};});}
  async function readRecord(sha256){
   if(!SHA.test(sha256||''))fail('请选择准确的模板SHA256。');
   return transaction('readonly',(st,done,reject)=>{
    const q=st.get(sha256);
    q.onsuccess=()=>{try{
     if(!q.result)fail('该原件已不在本机模板库。');
     const record=validateRecord(q.result);
     if(record.sha256!==sha256)fail('模板原件SHA256记录不一致。');
     done(record);
    }catch(error){reject(error);}};
   });
  }
  async function stat(sha256){return metadata(await readRecord(sha256));}
  async function read(sha256){
   const record=await readRecord(sha256);
   if(await hashFile(record.blob)!==sha256)fail('模板原件SHA256不一致，未下载或套用。');
   return {...metadata(record),blob:record.blob};
  }
  async function put(file,{firm='',uploader=''}={}){validateFile(file);firm=attribution(firm,200);uploader=attribution(uploader,100);const sha256=await hashFile(file);if(!SHA.test(sha256||''))fail('模板哈希计算失败。');const value={schema:1,sha256,name:file.name,size:file.size,type:typeof file.type==='string'?file.type.slice(0,160):'',createdAt:new Date().toISOString(),blob:file,...(firm?{firm}:{}),...(uploader?{uploader}:{})};validateRecord(value);const result=await transaction('readwrite',(st,done,reject)=>{const q=st.getAll(null,MAX_RECORDS+1);q.onsuccess=()=>{try{const sum=inventory(q.result),old=q.result.find(x=>x.sha256===sha256);if(old){done({record:metadata(old),duplicate:true});return;}if(sum.count>=MAX_RECORDS)fail('本机模板库已达 200 份，未新增。');st.add(value);done({record:metadata(value),duplicate:false});}catch(e){reject(e);}};});if(result.duplicate)await read(sha256);return result;}
  function remove(sha256,createdAt){
   if(!SHA.test(sha256||''))fail('请选择要删除的模板。');
   return transaction('readwrite',(st,done,reject)=>{
    const request=st.get(sha256);
    request.onsuccess=()=>{
     const record=request.result;
     if(!record){done(false);return;}
     if(record.createdAt!==createdAt){reject(Error('模板已重新保存，请刷新清单后再删除。'));return;}
     st.delete(sha256);
     done(true);
    };
   });
  }
  return Object.freeze({list,stat,read,put,remove,close(){if(!closed){closed=true;db.close();}}});
 }
 function catalog(routing=root.WorkpaperRouting){return (routing?.archives?.()||[]).map(a=>{if(!SHA.test(a.sha256||'')||typeof a.name!=='string')fail('已知原包目录无效。');return {sha256:a.sha256,name:a.name,files:a.files};});}

 const TREE=Object.freeze({id:'general',title:'一般企业审计底稿模板',children:[
  {id:'1',title:'1、初步业务活动工作底稿',archives:['58cab105fb15a3309c371f595bbe4d9a2a3db06e28c878b6ac3adf61c8911f99']},
  {id:'2',title:'2、计划及风险识别阶段工作底稿',archives:['aa98b5969896875ff04fca9b983a80342c907598ae416a04b23a15145c28e3a1','40ebe3e9810c187b47718e1b20a5153a991bd478f27b7dccde1d9a251b6ef743']},
  {id:'3',title:'3、审计执行阶段工作底稿',children:[{id:'3.1',title:'3.1执行实质性程序',archives:['efa8c1ebd044ea98d618bd79d137984940640fa7b8c586415ca9e2af55bd2853']},{id:'3.2',title:'3.2执行一般审计程序',archives:['b87650a0b85d6103e9a83434eb9a3dee0c104e6245419a40bd05b5490b00ff16']}]},
  {id:'4',title:'4、结论和报告阶段工作底稿',archives:['51c101a9bffa724c79f633bea77eb2bf109febd04cbfdb9db0b9894b8f01aae7'],children:[
   {id:'4.1',title:'4.1编制审计差异汇总表',folder:'一、编制审计差异汇总表'},
   {id:'4.2',title:'4.2编制内部控制缺陷及控制例外事项汇总表',folder:'二、编制内部控制缺陷汇总表及控制例外事项汇总表'},
   {id:'4.3',title:'4.3实施财务报表程序',folder:'三、实施财务报表程序'},
   {id:'4.4',title:'4.4编制审计总结',folder:'四、编制审计总结（2019.12修订）'},
   {id:'4.5',title:'4.5总体复核与批准',folder:'五、总体复核与批准'},
   {id:'4.6',title:'4.6编制和提交与被审计单位的沟通文档',folder:'六、编制和提交与被审计单位的沟通文档'},
   {id:'4.7',title:'4.7审计工作底稿的整理与归档',folder:'七、审计工作底稿的整理与归档'}]},
  {id:'5',title:'5、公共底稿',archives:['7efb1960d8f960d5a4310c133208e1fc88ca6fa9b4233434030e115e52192b26']},
  {id:'6',title:'6、各类账户询证函模板',pending:'待上传：暂无对应的实际原件。'}]});
 // This is a classification view over existing exact package/path/hash evidence, never a new import route.
 function directoryTree(routing=root.WorkpaperRouting,sourceCatalog=root.WorkpaperRouteCatalog){
  const originals=new Map(catalog(routing).map(a=>[a.sha256,a])),conclusion='51c101a9bffa724c79f633bea77eb2bf109febd04cbfdb9db0b9894b8f01aae7';
  function node(v){const out={id:v.id,title:v.title,originals:(v.archives||[]).map(h=>originals.get(h)).filter(Boolean)};if(v.pending)out.pending=v.pending;
   if(v.folder){const paths=new Map(),folders=new Set();let ambiguous=false;for(const row of Object.values(sourceCatalog?.rows||{}))for(const t of row?.targets||[]){if(t?.archiveId!==conclusion||!originals.has(conclusion)||!SHA.test(t.sha256||'')||typeof t.path!=='string'||!t.path||t.path.startsWith('/')||t.path.includes('\\')||t.path.split('/').some(p=>p==='..'||p==='.'||/^~\$|^\.~|^~lock\./i.test(p)))continue;const parts=t.path.split('/'),at=parts.indexOf(v.folder);if(at<0||at===parts.length-1)continue;const folder=parts.slice(0,at+1).join('/');folders.add(folder);const prior=paths.get(t.path);if(prior&&prior.sha256!==t.sha256)ambiguous=true;paths.set(t.path,{path:t.path,sha256:t.sha256});}
    if(folders.size===1&&!ambiguous){out.folder=[...folders][0];out.files=[...paths.values()].sort((a,b)=>a.path.localeCompare(b.path,'zh-CN'));}else out.pending=folders.size>1||ambiguous?'待核对：原目录索引不唯一，不关联文件。':'待核对：暂无唯一原目录索引，仅展示分类。';}
   if(v.children)out.children=v.children.map(node);if(!out.children&&!out.originals.length&&!v.folder&&!out.pending)out.pending='待上传准确原包；目录分类不会生成模板正文。';return out;}
  return node(TREE);
 }
 async function applyToProject({sha256,projectId,expectedRevision,store,workspaceStore=root.ProjectWorkspaceStore,library=root.WorkpaperLibrary,routing=root.WorkpaperRouting,projectList=()=>root.ProjectInitiation.listSaved()}){
  if(!UUID.test(projectId||'')||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('请先明确选择项目并刷新其版本。');if(projectId!==TRIAL&&!((await projectList()).some(p=>p?.quoteId===projectId&&p?.form&&typeof p.form.projectName==='string')))fail('该正式项目当前已不存在，未认领其他项目。');const original=await store.read(sha256),known=routing.identifyArchive(original.sha256);if(!known||known.sha256!==sha256||!catalog(routing).some(a=>a.sha256===sha256&&a.name===known.name))fail('自定义模板尚未配置严格在线版式，仅可保存和下载原件，不能猜测套用。');const record=await workspaceStore.get(projectId);if(record.id!==projectId||record.rev!==expectedRevision)fail('当前项目版本已改变，请刷新并重新选择；未覆盖旧记录。');const file=new root.File([original.blob],known.name,{type:original.type}),imported=await library.importFiles([file],record);if(Object.keys(imported.patch||{}).length!==1||!Object.hasOwn(imported.patch,'workpaperSources'))fail('模板导入补丁范围无效，未保存。');return workspaceStore.save(projectId,expectedRevision,imported.patch);
 }
 function mount(host,{store:providedStore=null,common=false}={}){
  if(!host?.ownerDocument)fail('模板库挂载位置无效。');
  const doc=host.ownerDocument,make=(tag,text,cls)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const button=(text,id)=>{const node=make('button',text);node.type='button';if(id)node.id=id;return node;};
  const label=(text,input)=>{const node=make('label',text);node.append(input);return node;};
  const box=make('section',undefined,'at-root'),actions=make('div',undefined,'at-actions'),status=make('p',undefined,'at-status');
  const prefix=common?'general-template':'audit-template';
  const upload=make('input'),firm=make('input'),uploader=make('input'),save=button('保存所选原件',prefix+'-save'),refresh=button('刷新本机库与项目',prefix+'-refresh');
  const listHost=make('div'),drop=make('label',undefined,'at-drop'),fileName=make('span',undefined,'at-selected');
  drop.htmlFor=prefix+'-upload';
  drop.append(upload,fileName);
  let dead=false,busy=false,pending=null,store=null;
  upload.type='file';upload.accept='.zip,.xls,.xlsx,.doc,.docx,.pdf';upload.id=prefix+'-upload';
  globalThis.ShenyiFileDrop?.present(drop,upload,{material:common?'通用模板':'审计底稿模板',before:fileName,limit:'大于 0 字节且小于 1 GB'});
  firm.maxLength=200;uploader.maxLength=100;
  status.id=prefix+'-status';status.setAttribute('role','status');
  firm.type=uploader.type='text';
  if(common){
   const section=make('section'),heading=make('h3','已保存模板');
   heading.id=prefix+'-list-title';section.setAttribute('aria-labelledby',heading.id);
   section.append(heading,listHost);
   refresh.textContent='刷新模板清单';
   actions.append(drop,save,refresh);box.append(actions,section,status);
  }else{
   actions.append(drop,label('所属事务所',firm),label('上传人',uploader),save,refresh);
   box.append(actions,listHost,status);
  }
  host.append(box);
  const say=(message,error=false)=>{if(!dead){status.textContent=message;status.classList.toggle('error',error);}};
  function sync(){
   box.inert=busy;box.setAttribute('aria-busy',String(busy));
   save.disabled=busy||!pending||!store;refresh.disabled=upload.disabled=busy||!store;
   fileName.textContent=pending?.name||'';fileName.hidden=!pending;
  }
  async function run(work,saving=false){
   if(dead||busy)return;busy=true;sync();
   try{await work();}catch(error){say(saving?(root.SaveFeedback?.failed(error)||error.message):error.message||'操作未完成，原记录未改变。',true);}finally{busy=false;if(!dead)sync();}
  }
  function canLeave(){
   if(busy){say('正在校验或写入本机模板，请稍候再离开。');return false;}
   return !pending||root.confirm('所选原件尚未保存，离开将取消选择。是否离开？');
  }
  async function usageCounts(){
   let projectList;
   try{projectList=await root.ProjectInitiation.listSaved();}catch{return null;}
   const records=await Promise.allSettled([...new Set([...projectList.map(row=>row.quoteId),TRIAL])].map(id=>root.ProjectWorkspaceStore.get(id)));
   if(records.some(result=>result.status!=='fulfilled'))return null;
   const counts=new Map();
   for(const {value:workspace} of records){
    const used=new Set([...Object.keys(workspace.workpaperSources||{}),workspace.archive?.hash,workspace.riskArchive?.hash,
     ...(workspace.auditWorkflow?.files?.template||[]).map(item=>item.sha256)].filter(Boolean));
    for(const sha of used)counts.set(sha,(counts.get(sha)||0)+1);
   }
   return counts;
  }
  const table=make('table'),head=make('thead'),headers=make('tr'),body=make('tbody');
  const titles=common?['序号','模板名称','上传时间','操作']:['序号','所属事务所','上传时间','上传人','使用次数'];
  for(const title of titles){const cell=make('th',title);cell.scope='col';headers.append(cell);}
  if(common)headers.lastElementChild.className='at-template-actions';
  head.append(headers);table.append(head,body);
  const wrap=make('div',undefined,'at-table-wrap');wrap.append(table);listHost.append(wrap);

  function templateDelete(record){
   const remove=button('');
   remove.className='at-template-delete';remove.title='删除模板 '+record.name;
   remove.setAttribute('aria-label',remove.title);
   remove.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6m4-6v6"/></svg>';
   remove.onclick=()=>void run(async()=>{
    if(!root.confirm('确认删除已保存的模板「'+record.name+'」？'))return;
    const removed=await store.remove(record.sha256,record.createdAt);
    const message=removed?'已删除模板「'+record.name+'」。':'该模板已从清单中删除。';
    try{await renderList();say(message);}catch{say(message+' 请刷新模板清单。',true);}
   });
   return remove;
  }

  async function renderList(){
   const data=await store.list(),counts=!common&&data.records.length?await usageCounts():new Map();if(dead)return;
   const rows=doc.createDocumentFragment();
   const dates=new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeStyle:'medium',timeZone:'Asia/Shanghai'});
   for(const [index,r] of data.records.entries()){
    const row=make('tr'),first=make('td');
    row.dataset.templateSha=r.sha256;
    const download=button(r.name);
    download.dataset.templateDownload=r.sha256;download.className='at-template-filename';download.setAttribute('aria-label','下载 '+r.name);
    download.onclick=()=>void run(async()=>{const value=await store.read(r.sha256);if(!dead){root.ProjectWorkspaceStore.download(value.blob,value.name);say('已下载模板原件。');}});
    first.append(make('span',String(index+1)));
    const date=make('td',dates.format(new Date(r.createdAt)));
    if(common){
     const fileCell=make('td'),operations=make('td',undefined,'at-template-actions');
     fileCell.append(download);operations.append(templateDelete(r));row.append(first,fileCell,date,operations);
    }
    else{first.append(download);row.append(first,make('td',r.firm||'—'),date,make('td',r.uploader||'—'),make('td',counts?String(counts.get(r.sha256)||0):'—'));}
    rows.append(row);
   }
   if(!data.records.length){const row=make('tr'),cell=make('td','暂无已上传模板。');cell.colSpan=titles.length;row.append(cell);rows.append(row);}
   body.replaceChildren(rows);
  }
  function choose(files){
   if(busy||!store||!files?.length)return;
   try{
    if(files.length!==1)fail('请每次选择一份模板。需要一并保存的文件可打成 ZIP。');
    pending=validateFile(files[0]);say('已选中模板，请点击「保存所选原件」。');
   }catch(error){say(error.message);}
   upload.value='';sync();
  }
  upload.setAttribute('aria-label',common?'选择通用模板':'选择底稿模板');
  upload.onchange=()=>choose(upload.files);
  drop.ondragover=event=>{
   if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;
   event.preventDefault();
   if(!upload.disabled)drop.classList.add('is-dragover');
  };
  drop.ondragleave=()=>drop.classList.remove('is-dragover');
  drop.ondrop=event=>{event.preventDefault();drop.classList.remove('is-dragover');choose(event.dataTransfer?.files);};
  save.onclick=()=>void run(async()=>{
   say('正在校验并保存模板原件…');
   const file=pending,result=await store.put(file,{firm:firm.value,uploader:uploader.value});if(dead)return;
   pending=null;upload.value='';
   const message=result.duplicate?'此模板已保存。':'模板已保存。';
   try{await renderList();say(message);}catch{say(message+' 列表刷新失败，请点击刷新。',true);}
   root.SaveFeedback?.saved(message);
  },true);
  refresh.onclick=()=>void run(async()=>{await renderList();say('已刷新。');});
  sync();void run(async()=>{store=providedStore||await open(common?{dbName:'hengdu.general.templates.v1'}:{});if(dead){store.close();return;}await renderList();});
  return Object.freeze({show(){if(store)void run(renderList);},canLeave,
   destroy(){dead=true;store?.close();pending=null;box.remove();}});
 }
 return Object.freeze({open,mount,applyToProject,catalog,directoryTree,validateFile,validateRecord,inventory,metadata,limits:Object.freeze({maxFileBytes:MAX_FILE,maxRecords:MAX_RECORDS}),DB,TRIAL});
});
