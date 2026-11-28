/* Project-local supplemental originals. No execution, conversion, or implicit subject guessing. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.SupplementalWorkpapers=api;})(globalThis,function(root){'use strict';
 const MAX_ROWS=200,MAX_FILE_BYTES=12*1024*1024,MAX_TOTAL_BYTES=64*1024*1024;
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,SHA=/^[a-f0-9]{64}$/;
 function fail(s){throw Error(s);}
 function exact(o,keys){if(!o||typeof o!=='object'||Array.isArray(o))return false;const ds=Object.getOwnPropertyDescriptors(o),names=Object.keys(ds);return names.length===keys.length&&names.every(k=>keys.includes(k)&&Object.hasOwn(ds[k],'value')&&ds[k].enumerable);}
 const text=(v,max,blank=false)=>typeof v==='string'&&v.length<=max&&(blank||!!v.trim())&&(typeof v.isWellFormed!=='function'||v.isWellFormed())&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v);
 function validateGeneration(data){
  const goodFile=item=>exact(item,['name','sha256'])&&text(item.name,240)&&SHA.test(item.sha256);
  if(!exact(data,['template','sources','filled','pending','trace'])||!goodFile(data.template)||
   !Array.isArray(data.sources)||!data.sources.length||data.sources.length>20||!data.sources.every(goodFile)||
   !Number.isSafeInteger(data.filled)||data.filled<1||data.filled>2000||!Array.isArray(data.trace)||data.trace.length!==data.filled||
   data.trace.some(item=>!exact(item,['target','field','source'])||!text(item.target,300)||!text(item.field,180)||!text(item.source,520))||
   !Array.isArray(data.pending)||data.pending.length>2000||
   data.pending.some(item=>!exact(item,['field','reason'])||!text(item.field,180)||!text(item.reason,100)))
   fail('补充底稿生成来源或待核记录格式无效。');
 }
 function validateShape(list){if(!Array.isArray(list)||list.length>MAX_ROWS)fail('补充底稿最多200条，请勿丢弃其他项目资料。');let total=0;const ids=new Set();for(const r of list){if(!exact(r,Object.hasOwn(r||{},'generation')?['id','subjectCode','subjectName','file','createdAt','generation']:['id','subjectCode','subjectName','file','createdAt'])||!UUID.test(r.id)||ids.has(r.id)||!text(r.subjectCode,30)||!text(r.subjectName,100)||r.subjectCode!==r.subjectCode.trim()||r.subjectName!==r.subjectName.trim()||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt))||new Date(r.createdAt).toISOString()!==r.createdAt)fail('补充底稿的编码、名称、记录身份或时间格式无效。');if(Object.hasOwn(r,'generation'))validateGeneration(r.generation);ids.add(r.id);const f=r.file;if(!exact(f,['name','mime','size','sha256','blob'])||!text(f.name,240)||/[\/\\]/u.test(f.name)||!text(f.mime,150,true)||!Number.isSafeInteger(f.size)||f.size<1||f.size>MAX_FILE_BYTES||!SHA.test(f.sha256)||!(f.blob instanceof root.Blob)||f.blob.size!==f.size||f.blob.type!==f.mime)fail('补充底稿原件信息无效：单份须为12MiB以内的本机文件。');total+=f.size;if(total>MAX_TOTAL_BYTES)fail('本项目补充底稿文件合计不能超过64MiB。');}return{rows:list.length,totalBytes:total};}
 async function hash(blob){if(!root.crypto?.subtle)fail('当前浏览器不支持安全文件摘要，请换用受支持的浏览器。');const b=await root.crypto.subtle.digest('SHA-256',await blob.arrayBuffer());return Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join('');}
 async function validate(list,{verifyBytes=true}={}){const frozen=structuredClone(list),stats=validateShape(frozen);if(verifyBytes)for(const r of frozen)if(await hash(r.file.blob)!==r.file.sha256)fail('补充底稿文件SHA256不一致，未保存或导出。');return stats;}
 function resolveSubject(subjectCode,directory=root.WorkpaperDirectory,routing=root.WorkpaperRouting){const code=typeof subjectCode==='string'?subjectCode.trim():'';if(!code)return{state:'unmatched',reason:'请填写科目编码'};const rows=(directory?.rows||[]).filter(r=>r.row>=6&&String(r.C||'')===code);if(rows.length!==1)return{state:'unmatched',reason:rows.length?'目录中编码不唯一，不能自动归类':'未找到此精确目录科目编码'};const row=rows[0],targets=routing?.row?.(row.row)?.targets||[];if(!targets.length)return{state:'unmatched',reason:'此目录项尚无经核对的原底稿对应关系'};return{state:'matched',row:row.row,code,subjectName:String(row.B||''),sourcePaths:[...new Set(targets.map(t=>t.path))]};}
 function mountOriginals(host,ctx){if(!host?.ownerDocument||!ctx?.key||!ctx.getRecord||!ctx.save||!ctx.run)fail('补充底稿工作区尚未就绪。');const D=host.ownerDocument,S=root.ProjectWorkspaceStore,key=ctx.key,base=ctx.getRecord();if(base?.id!==key)fail('补充底稿项目归属不一致。');validateShape(base.supplementalWorkpapers||[]);let alive=true,busy=false,dirty=false,baseRevision=base.rev,rows=structuredClone((base.supplementalWorkpapers||[]).filter(row=>!row.generation)),ticket=0;const make=(t,s,cls)=>{const n=D.createElement(t);if(s!==undefined)n.textContent=s;if(cls)n.className=cls;return n;},button=s=>{const n=make('button',s,'btn');n.type='button';return n;};
  const box=make('section',undefined,'swp-root'),actions=make('div',undefined,'swp-actions'),add=button('＋ 添加补充底稿'),save=button('保存本项目补充底稿'),summary=make('p',undefined,'swp-summary'),status=make('p','请按科目编码、科目名称上传本项目补充底稿。仅本机保存，不执行文件或改写公式。','swp-status'),wrap=make('div',undefined,'swp-table-wrap'),table=make('table'),head=make('thead'),tr=make('tr'),body=make('tbody');for(const s of ['科目编码','科目名称','上传底稿'])tr.append(make('th',s));head.append(tr);table.append(head,body);wrap.append(table);status.setAttribute('role','status');status.id='supplemental-status';add.id='supplemental-add';save.id='supplemental-save';box.append(make('h3','补充底稿'),make('p','按工作底稿目录的科目索引精确归类（如4100货币资金）。保存后，归档将把文件放进同一目录科目下；未匹配编码单独列出，不按名称猜测。每份≤12MiB，最多200份，总计≤64MiB。','swp-help'),actions,wrap,summary,status);actions.append(add,save);host.replaceChildren(box);
  const active=()=>alive&&(!ctx.isCurrent||ctx.isCurrent())&&ctx.getRecord()?.id===key&&host.contains(box),say=(s,bad=false)=>{if(!active())return;status.textContent=s;status.classList.toggle('error',bad);ctx.say?.(s,bad);},sync=()=>{if(!active())return;add.disabled=busy||rows.length>=MAX_ROWS;save.disabled=busy||!dirty;box.inert=busy;summary.textContent='当前 '+rows.filter(r=>r.file).length+' 份文件 / '+rows.length+' 行'+(dirty?' · 有未保存修改':' · 已保存内容');},changed=()=>{dirty=true;sync();};
  async function run(fn,saving=false){if(busy||!active())return;busy=true;sync();try{let started=false;await ctx.run(async()=>{started=true;try{await fn();}catch(e){say((saving?root.SaveFeedback?.failed(e):null)||e.message,true);throw e;}});if(!started)say('工作区正忙，请稍后重试。',true);}catch(e){say(e.message,true);}finally{busy=false;sync();}}
  function newRow(){if(!root.crypto?.randomUUID)fail('当前浏览器不能创建安全记录身份。');return{id:root.crypto.randomUUID(),subjectCode:'',subjectName:'',file:null,createdAt:new Date().toISOString()};}
  function draw(){if(!active())return;body.replaceChildren();if(!rows.length){const empty=make('tr'),cell=make('td','尚无补充底稿，请点击“添加补充底稿”。');cell.colSpan=3;empty.append(cell);body.append(empty);}for(const r of rows){const row=make('tr');row.dataset.supplementalId=r.id;const codeCell=make('td'),nameCell=make('td'),fileCell=make('td'),code=make('input'),name=make('input'),upload=make('input'),mapping=make('small',undefined,'swp-mapping'),fileInfo=make('p',r.file?r.file.name+' · '+r.file.size+' bytes · SHA256 '+r.file.sha256:'尚未选择文件','swp-file-info');code.type=name.type='text';code.value=r.subjectCode;name.value=r.subjectName;code.maxLength=30;name.maxLength=100;code.setAttribute('aria-label','科目编码');name.setAttribute('aria-label','科目名称');upload.type='file';upload.setAttribute('aria-label','上传底稿');upload.dataset.supplementalUpload=r.id;code.dataset.supplementalCode=r.id;name.dataset.supplementalName=r.id;
    function describe(){const match=resolveSubject(code.value);mapping.textContent=match.state==='matched'?'归档到 '+match.code+' · '+match.subjectName+(name.value.trim()&&name.value.trim()!==match.subjectName?'（填写名称与目录不同，请核对）':''):'未匹配：'+match.reason+'；归档时单列“未匹配补充底稿”。';mapping.classList.toggle('swp-unmatched',match.state!=='matched');}code.oninput=()=>{r.subjectCode=code.value;changed();describe();};code.onchange=()=>{const match=resolveSubject(code.value);if(!name.value.trim()&&match.state==='matched'){name.value=r.subjectName=match.subjectName;}r.subjectCode=code.value;changed();describe();};name.oninput=()=>{r.subjectName=name.value;changed();describe();};describe();
    upload.onchange=()=>{const file=upload.files?.[0];upload.value='';if(!file)return;const serial=++ticket;void run(async()=>{if(!Number.isSafeInteger(file.size)||file.size<1||file.size>MAX_FILE_BYTES||!text(file.name,240)||/[\/\\]/u.test(file.name)||!text(file.type,150,true))fail('请选择非空且12MiB以内的底稿原件。');const digest=await hash(file);if(!active()||serial!==ticket||!rows.includes(r))return;const candidate={name:file.name,mime:file.type,size:file.size,sha256:digest,blob:file},total=rows.reduce((n,x)=>n+(x===r?candidate.size:x.file?.size||0),0);if(total>MAX_TOTAL_BYTES)fail('本项目补充底稿文件合计不能超过64MiB。');r.file=candidate;changed();draw();say('已在本次未保存草稿中选取原件；请填写科目并点击保存。');});};
    const remove=button('移除此行');remove.dataset.supplementalRemove=r.id;remove.onclick=()=>{if(busy)return;rows=rows.filter(x=>x!==r);changed();draw();say('已从当前草稿移除此行；点击保存后才改变本项目记录。');};fileCell.append(globalThis.ShenyiFileDrop?.area(upload,'上传底稿',{material:'补充底稿原件',limit:'单份最多 12 MiB'})||upload,fileInfo);if(r.file){const download=button('核验并下载原件');download.dataset.supplementalDownload=r.id;download.onclick=()=>void run(async()=>{if(await hash(r.file.blob)!==r.file.sha256)fail('原件SHA256不一致，未下载。');if(!active())return;S.download(r.file.blob,r.file.name);say('已核验并下载本机原件；没有转换或改写公式。');});fileCell.append(download);}fileCell.append(remove);codeCell.append(code,mapping);nameCell.append(name);row.append(codeCell,nameCell,fileCell);body.append(row);}sync();}
  add.onclick=()=>{if(busy||rows.length>=MAX_ROWS)return;rows.push(newRow());changed();draw();body.querySelector('tr:last-child input')?.focus();};save.onclick=()=>void run(async()=>{const valid=rows.filter(r=>r.file||r.subjectCode.trim()||r.subjectName.trim()).map(r=>({...r,subjectCode:r.subjectCode.trim(),subjectName:r.subjectName.trim()}));await validate(valid);if(!active())return;if(ctx.getRecord().rev!==baseRevision)fail('当前项目已更新，请重新进入补充底稿后核对，未覆盖原记录。');const actual=await S.get(key);if(!active())return;if(actual.rev!==baseRevision||ctx.getRecord().rev!==baseRevision)fail('另一页面已更新本项目，请刷新后重新核对；未覆盖。');if((ctx.getRecord().supplementalWorkpapers||[]).length&&!valid.length&&root.confirm&&!root.confirm('保存后将清空本项目补充底稿清单；其他项目和原目录底稿不变。继续？'))return;await ctx.save({supplementalWorkpapers:[...valid,...(actual.supplementalWorkpapers||[]).filter(row=>row.generation)]});if(!active())return;baseRevision=ctx.getRecord().rev;rows=structuredClone(valid);dirty=false;draw();const message='已保存本项目 '+rows.length+' 份补充底稿；归档按精确科目编码归类，未匹配项另列。';say(root.SaveFeedback?.saved(message)??(message));},true);draw();
  return Object.freeze({canLeave(){return!busy&&(!dirty||typeof root.confirm==='function'&&root.confirm('补充底稿有未保存的编码、名称或文件。离开将丢弃本次未保存修改，继续？'));},destroy(){alive=false;++ticket;box.remove();}});
 }
 function renderDirectory(host,records=[],{download,empty='本项目暂无补充底稿。'}={}){
  const make=(tag,label)=>{const node=host.ownerDocument.createElement(tag);if(label!==undefined)node.textContent=label;return node;};
  const heading=make('h3','补充底稿目录'),wrap=make('div'),table=make('table'),head=make('thead'),columns=make('tr'),body=make('tbody');
  heading.id='supplemental-directory-heading';
  table.setAttribute('aria-labelledby',heading.id);
  wrap.className='swp-table-wrap';
  for(const title of ['序号','底稿名称','编制日期','下载']){
   const th=make('th',title);th.scope='col';columns.append(th);
  }
  head.append(columns);table.append(head,body);wrap.append(table);host.replaceChildren(heading,wrap);
  if(!records.length){
   const row=make('tr'),cell=make('td',empty);cell.colSpan=4;row.append(cell);body.append(row);return;
  }
  const dateFormat=new Intl.DateTimeFormat('sv-SE',{dateStyle:'short',timeZone:'Asia/Shanghai'});
  const sorted=records.slice().reverse().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  for(const [index,record] of sorted.entries()){
   const row=make('tr'),name=make('td',record.subjectName),date=make('td'),action=make('td'),button=make('button','下载');
   const generation=record.generation;
   row.dataset.supplementalEntry=record.id;
   if(generation){
    row.dataset.generatedSupplement=record.id;
    const when=make('time',dateFormat.format(new Date(record.createdAt)));when.dateTime=record.createdAt;date.append(when);
    const details=make('details'),refs=make('ul');
    details.append(make('summary','查看模板及字段来源'),
     make('p','已填 '+generation.filled+' 处'+(generation.pending.length?' · 待核 '+generation.pending.length+' 项':'')),
     make('p','模板：'+generation.template.name),make('p','资料：'+generation.sources.map(item=>item.name).join('、')));
    for(const item of generation.trace)refs.append(make('li',item.target+' · '+item.field+' ← '+item.source));
    for(const item of generation.pending)refs.append(make('li','待核：'+item.field+' · '+item.reason));
    details.append(refs);name.append(details);
   }else{
    date.textContent='未记录';
   }
   button.type='button';button.className='btn';button.setAttribute('aria-label','下载 '+record.subjectName);
   button.onclick=()=>download(record);
   action.append(button);row.append(make('td',String(index+1)),name,date,action);body.append(row);
  }
 }
 function mount(host,ctx){
  const G=root.SupplementalGenerator;
  if(!G)return mountOriginals(host,ctx);
  const D=host.ownerDocument,key=ctx.key,S=root.ProjectWorkspaceStore;
  if(ctx.getRecord()?.id!==key)fail('补充底稿项目归属不一致。');
  const make=(tag,label,classname)=>{const node=D.createElement(tag);if(label!==undefined)node.textContent=label;if(classname)node.className=classname;return node;};
  const button=label=>{const node=make('button',label,'btn');node.type='button';return node;};
  const box=make('section',undefined,'swp-generate'),form=make('div',undefined,'swp-generate-form');
  const name=make('input'),nameLabel=make('label','补充底稿名称');name.id='supplemental-document-name';name.type='text';name.maxLength=100;
  name.placeholder='输入本次补充底稿的名称';nameLabel.append(name);
  const build=button('生成并保存补充底稿');build.id='supplemental-generate';build.classList.add('primary');
  const status=make('p',undefined,'swp-status');status.id='supplemental-generate-status';status.setAttribute('role','status');status.hidden=true;
  const directory=make('section',undefined,'swp-directory'),legacy=make('details'),legacyHost=make('div');
  legacy.append(make('summary','管理已上传的底稿原件'),legacyHost);
  let template=null,materials=[],alive=true,busy=false,legacyPanel=null,controller;
  const active=()=>alive&&(!ctx.isCurrent||ctx.isCurrent())&&ctx.getRecord()?.id===key&&box.isConnected;
  const hasInput=()=>!!name.value.trim()||!!template||materials.length>0;
  const sync=()=>{build.disabled=busy||!name.value.trim()||!template||!materials.length;box.inert=busy;};
  function say(message,bad=false){if(!active())return;status.hidden=!message;status.textContent=message;status.classList.toggle('error',bad);}
  function dropZone(title,types,multiple,update){
   const area=make('label',undefined,'quote-file-drop'),input=make('input'),chosen=make('span',undefined,'swp-selected');
   input.type='file';input.multiple=multiple;input.accept=types.map(type=>'.'+type).join(',');input.setAttribute('aria-label',title);
   area.append(input,chosen);
   globalThis.ShenyiFileDrop?.present(area,input,{material:title.replace(/^拖入/u,''),before:chosen,limit:'单份最多 12 MiB'});
   chosen.hidden=true;
   function choose(list){
    const files=Array.from(list||[]);input.value='';
    if(busy||!files.length)return;
    if(!multiple&&files.length!==1||files.length>G.MAX_SOURCES||files.some(file=>!G.validFile(file,types))||
     files.reduce((n,file)=>n+file.size,0)>G.MAX_INPUT){
     say(multiple?'请选择最多 20 份支持的资料，每份 12 MiB 以内，合计 48 MiB。':'请拖入一份 XLSX 或 DOCX 模板，最多 12 MiB。',true);return;
    }
    update(files);chosen.textContent=files.map(file=>file.name).join('、');chosen.hidden=false;say('');sync();
   }
   input.onchange=()=>choose(input.files);
   area.ondragover=event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files')){event.preventDefault();area.classList.add('is-dragover');}};
   area.ondragleave=()=>area.classList.remove('is-dragover');
   area.ondrop=event=>{event.preventDefault();area.classList.remove('is-dragover');choose(event.dataTransfer?.files);};
   return {area,clear(){input.value='';chosen.textContent='';chosen.hidden=true;}};
  }
  const fileRows=make('div',undefined,'swp-generate-files');
  const templateUpload=dropZone('拖入补充底稿模板',G.templateTypes,false,files=>{template=files[0];});
  const materialUpload=dropZone('拖入补充底稿资料',G.sourceTypes,true,files=>{materials=files;});
  fileRows.append(templateUpload.area,materialUpload.area);
  form.append(nameLabel,fileRows,make('p','用模板的字段标记或可明确匹配的标签取数。有歧义或缺少资料的字段留待核对。','swp-help'),build);
  box.append(form,status,legacy,directory);host.replaceChildren(box);
  name.oninput=sync;
  legacy.ontoggle=()=>{
   if(!legacy.open||legacyPanel||busy)return;
   legacyPanel=mountOriginals(legacyHost,{...ctx,async save(patch){await ctx.save(patch);if(active())refreshDirectory();}});
  };
  function refreshDirectory(){
   renderDirectory(directory,ctx.getRecord().supplementalWorkpapers||[],{download:entry=>void ctx.run(async()=>{
    if(await hash(entry.file.blob)!==entry.file.sha256)fail('补充底稿文件摘要不一致，未下载。');
    if(active())S.download(entry.file.blob,entry.file.name);
   })});
  }
  build.onclick=()=>{
   if(busy||!active()||!template||!materials.length||!name.value.trim())return;
   if(legacyPanel&&!legacyPanel.canLeave()){say('请先处理未保存的底稿原件，再生成。',true);return;}
   legacyPanel?.destroy();legacyPanel=null;legacy.open=false;
   busy=true;sync();say('正在按模板和资料生成补充底稿…');
   controller=new AbortController();const base=ctx.getRecord(),displayName=name.value.trim();
   void ctx.run(async()=>{
    try{
     if((base.supplementalWorkpapers||[]).length>=MAX_ROWS)fail('本项目补充底稿已达 200 条。');
     const generated=await G.generate({name:displayName,template,files:materials,signal:controller.signal});
     if(!active())return;
     const digest=await hash(generated.blob),latest=await S.get(key);
     if(!active())return;
     if(latest.rev!==base.rev||ctx.getRecord()?.rev!==base.rev)fail('项目已在其他页面更新，请重新载入后再生成。');
     const record={id:root.crypto.randomUUID(),subjectCode:'未指定',subjectName:displayName,createdAt:new Date().toISOString(),
      file:{name:generated.filename,mime:generated.blob.type,size:generated.blob.size,sha256:digest,blob:generated.blob},
      generation:generated.generation};
     await ctx.save({supplementalWorkpapers:[...(base.supplementalWorkpapers||[]),record]});
     if(!active())return;
     name.value='';template=null;materials=[];templateUpload.clear();materialUpload.clear();
     refreshDirectory();
     const message='已生成并保存 1 条记录，填入 '+generated.generation.filled+' 处。'+
      (generated.generation.pending.length?'另有 '+generated.generation.pending.length+' 项待核。':'');
     say(root.SaveFeedback?.saved(message)??(message));
    }catch(error){say(root.SaveFeedback?.failed(error,'补充底稿生成或保存失败。')||error?.message||'补充底稿生成或保存失败。',true);}
   }).finally(()=>{busy=false;sync();});
  };
  sync();refreshDirectory();
  return Object.freeze({canLeave(){return !busy&&(!legacyPanel||legacyPanel.canLeave())&&
   (!hasInput()||typeof root.confirm==='function'&&root.confirm('本次补充底稿尚未生成保存，离开将清除本次选择。继续？'));},
   destroy(){alive=false;controller?.abort();legacyPanel?.destroy();box.remove();}});
 }
 return Object.freeze({mount,renderDirectory,validateShape,validate,validateGeneration,resolveSubject,MAX_ROWS,MAX_FILE_BYTES,MAX_TOTAL_BYTES});
});
