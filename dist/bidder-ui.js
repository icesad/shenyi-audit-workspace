/* Local bidder library controls. Project files and issuer contacts do not belong in this library. */
(function(root){
  'use strict';
  const CERTS=['business_license','practice_certificate'];
  const SIGNING=['company_seal','legal_representative_seal','bidder_signature'];
  const KINDS=[...CERTS];
  const labels={business_license:'营业执照',practice_certificate:'执业证书',company_seal:'公司公章',legal_representative_seal:'法人章',bidder_signature:'投标人签字',own:'本所',partner:'合作所'};
  function el(tag,text,cls){const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;}
  function option(value,text){const x=el('option',text);x.value=value;return x;}
  function button(label,id,cls){const x=el('button',label,cls||'btn');x.type='button';if(id)x.id=id;return x;}
  function status(id){const x=el('p','','muted');x.id=id;x.setAttribute('role','status');return x;}
  function labeled(id,title,element){element.id=id;const l=el('label',title);l.htmlFor=id;l.append(element);return l;}
  function connect({apply,detach}){
    const picker=document.getElementById('bidder-picker'),editor=document.getElementById('bidder-library-editor');
    if(!picker||!editor||typeof apply!=='function'||typeof detach!=='function')throw Error('投标方资料面板未就绪');
    let db=null,rows=[],current=null,files=new Map(),used=null,editorBusy=false,pickBusy=false,pickEpoch=0,listError=false,archiveBusy=false,intake=null,archiveDraft=null,loadedFromArchive=new Set(),baseline=null,editorSerial=0;
    const select=el('select'),use=button('重新带入','bidder-apply'),unlink=button('改为手工录入','bidder-unlink','text-button');
    const pickStatus=status('bidder-picker-status'),actions=el('div',undefined,'bidder-picker-actions');
    select.append(option('','请选择事务所（仅测算可不选）'));actions.append(labeled('bidder-picker-select','从投标方信息库带入',select),use,unlink);
    picker.replaceChildren(actions,pickStatus);
    const intro=el('p','仅存于本浏览器。维护本所和获授权合作所的资料。报价时带入基础信息与营业执照、执业证书。','muted');
    const list=el('div',undefined,'bidder-catalog');list.id='bidder-directory';
    const form=el('form');form.id='bidder-editor-form';const title=el('h3','新增事务所');
    const archiveCurrent=status('bidder-archive-current');archiveCurrent.hidden=true;
    const newBtn=button('新增事务所','bidder-new'),refresh=button('刷新列表','bidder-refresh');
    const toolbar=el('div',undefined,'bidder-toolbar');toolbar.append(newBtn,refresh);
    const archiveBox=el('section',undefined,'bidder-import-panel'),archiveInput=el('input');
    archiveInput.type='file';archiveInput.accept='.zip,.rar,.pdf,.docx,.doc,.txt,.rtf,.odt,.xlsx,.xls,.ods,.csv,.tsv,.png,.jpg,.jpeg,.gif,.webp,.bmp,.pptx,.ppt,.odp';
    const archiveStatus=status('bidder-import-status'),archiveRows=el('div',undefined,'bidder-import-rows');
    archiveRows.id='bidder-import-rows';
    const clearArchive=button('清除本次识别结果','bidder-import-clear','text-button');
    clearArchive.hidden=true;
    archiveBox.append(el('h3','导入基础资料'),el('p','支持 ZIP / RAR 5 资料包（最多160 MiB），或 PDF、DOCX、DOC、TXT、RTF、ODT、常见表格和图片（单份最多12 MiB，DOC最多2 MiB）。读取明确字段与可识别内嵌证照；扫描件不提供OCR。结果只填入待核对编辑稿，不自动保存或上传。','muted'),labeled('bidder-archive-file','选择基础资料文件',archiveInput),archiveStatus,archiveRows,clearArchive);
    const intakeURLs=new Set();
    function clearIntakeURLs(){for(const u of intakeURLs)root.URL.revokeObjectURL(u);intakeURLs.clear();}
    const fields=el('div',undefined,'fields client-fields'),controls={};
    const alternativesBox=el('div',undefined,'bidder-import-alternatives');alternativesBox.hidden=true;
    function showAlternatives(alternatives){
      alternativesBox.replaceChildren();alternativesBox.hidden=true;
      const grid=el('div',undefined,'fields client-fields');
      for(const [key,label]of Object.entries({team:'执行团队所在地',contactName:'本方联系人',phone:'本方联系电话',email:'本方邮箱'})){
        if(!Array.isArray(alternatives?.[key]))continue;
        const choices=alternatives[key].filter(v=>typeof v==='string'&&v.trim()).slice(0,12);
        if(!choices.length)continue;
        const pick=el('select');pick.append(option('','请选择（或在上方手填）'),...choices.map(v=>option(v,v)));
        pick.addEventListener('change',()=>{
          const x=controls[key],v=pick.value;if(!v)return;
          if(key==='team'&&!Array.from(x.options).some(o=>o.value===v))return;
          x.value=x.maxLength>0?v.slice(0,x.maxLength):v;
          editStatus.textContent='已选择「'+label+'」候选，请核对后保存。';
        });
        grid.append(labeled('bidder-candidate-'+key,label+' · 识别候选',pick));
      }
      if(grid.children.length){alternativesBox.append(el('p','以下字段识别到多个值，未自动选用。请点选正确候选，或手工填写。','muted'),grid);alternativesBox.hidden=false;}
    }
    for(const [key,label,max] of [['kind','所属类型'],['name','事务所名称',150],['team','执行团队所在地'],['contactName','本方联系人',100],['phone','本方联系电话',80],['email','本方邮箱',120]]){
      let x;
      if(key==='kind'||key==='team'){
        x=el('select');if(key==='kind'){const blank=option('','请选择本所或合作所');blank.hidden=true;x.required=true;x.append(blank,option('own','本所'),option('partner','合作所'));}else{
          x.append(option('','暂不填写'));for(const p of root.RuleCatalog?.PROVINCES||[])x.append(option(({'450000':'广西','130000':'河北','310000':'上海'})[p.code]||p.name,p.name));
        }
      }else{x=el('input');x.type=key==='email'?'email':key==='phone'?'tel':'text';x.required=key==='name';x.maxLength=max;}
      controls[key]=x;fields.append(labeled('bidder-edit-'+key,label,x));
    }
    const certGrid=el('div',undefined,'credential-grid bidder-cert-grid'),signGrid=el('div',undefined,'credential-grid bidder-cert-grid bidder-sign-grid'),certControls={};
    const openImages=new Map();
    function closeImage(k){const view=openImages.get(k);if(view){root.URL.revokeObjectURL(view);openImages.delete(k);}if(certControls[k]?.img){certControls[k].img.removeAttribute('src');certControls[k].img.hidden=true;certControls[k].look.textContent='查看图片';}}
    function readFile(file,kind){
      if(root.BidderLibrary?.readProfileFile)return root.BidderLibrary.readProfileFile(file,kind);
      if(CERTS.includes(kind))return root.QuotePacket.readAttachment(file,kind);
      throw Error('印章签字读取组件未就绪。');
    }
    for(const kind of KINDS){
      const signing=SIGNING.includes(kind),group=el('div',undefined,'bidder-file-card'),x=el('input');x.type='file';x.className='bidder-file-native';
      x.accept=signing?'.png,.jpg,.jpeg,image/png,image/jpeg':'.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';
      const s=status('bidder-file-'+kind),remove=button(signing?'移除此图片':'移除此证照','bidder-clear-'+kind,'text-button');
      const look=signing?button('查看图片','bidder-preview-'+kind,'text-button'):null,img=signing?el('img'):null;
      const pick=labeled('bidder-edit-'+kind,'',x),pickText=el('span','选择文件','btn bidder-file-pick');
      pick.className='bidder-file-label';pick.append(pickText);x.setAttribute('aria-label','选择'+labels[kind]+'文件');
      const label=el('strong',labels[kind]);
      if(signing)label.append(' ',el('small','选填','badge neutral'));
      certControls[kind]={x,s,remove,look,img,pickText};group.append(label,s,pick);
      if(signing){
        img.hidden=true;img.alt=labels[kind]+'原图';img.className='bidder-private-image';group.append(look,remove,img);
        look.addEventListener('click',()=>{
          if(openImages.has(kind)){closeImage(kind);return;}
          const a=files.get(kind);if(!a?.bytes||!root.URL?.createObjectURL)return;
          const url=root.URL.createObjectURL(new Blob([a.bytes],{type:a.mime}));openImages.set(kind,url);img.src=url;img.hidden=false;look.textContent='收起图片';
        });
      }else group.append(remove);
      (signing?signGrid:certGrid).append(group);
      x.addEventListener('change',()=>{const file=x.files&&x.files[0];if(!file)return;
        editAction(async()=>{const a=await readFile(file,kind);files.set(kind,a);loadedFromArchive.delete(kind);editStatus.textContent=labels[kind]+'已选，保存资料后生效。'+(SIGNING.includes(kind)&&Number.isInteger(a.size)&&a.size!==file.size?' 已清理 JPEG 的非图像尾部，原文件未改；请核对图片。':'');},'附件未替换；原内容保持不变。');
      });
      remove.addEventListener('click',()=>{if(editorBusy||archiveBusy)return;files.delete(kind);loadedFromArchive.delete(kind);x.value='';describe();editStatus.textContent='已从编辑稿移除，保存后生效。';});
    }
    const save=button('保存资料','bidder-save','btn primary');save.type='submit';
    const editStatus=status('bidder-editor-status');
    form.append(title,archiveCurrent,fields,alternativesBox,el('p','资料可暂缺证照。每项可选一份 PDF、PNG 或 JPEG，最大 3 MiB；出具报价单时须备齐两证。','muted'),certGrid,save);
    editor.replaceChildren(intro,toolbar,archiveBox,list,form,editStatus);

    function captureDraft(){return {values:Object.fromEntries(Object.entries(controls).map(([k,x])=>[k,x.value])),files:new Map(files)};}
    function isEditorClean(){
      if(!baseline)return false;
      const now=captureDraft();
      return Object.entries(now.values).every(([k,v])=>baseline.values[k]===v)&&
        now.files.size===baseline.files.size&&[...now.files].every(([k,v])=>baseline.files.get(k)===v);
    }
    function describe(){
      for(const kind of KINDS){
        const {x,s,remove,look,pickText}=certControls[kind],a=files.get(kind);closeImage(kind);x.value='';
        const imported=loadedFromArchive.has(kind)&&!!a;
        s.dataset.fileOrigin=imported?'archive':a?'editor':'none';
        s.textContent=a?(imported?'已从资料读入：':'编辑稿已有：')+a.name:'暂未添加';
        pickText.textContent=a?'更换文件':'选择文件';
        remove.disabled=editorBusy||archiveBusy||!a;if(look)look.disabled=editorBusy||archiveBusy||!a?.bytes||!root.URL?.createObjectURL;
      }
      archiveCurrent.hidden=!archiveDraft;
      archiveCurrent.textContent=archiveDraft?'本次资料已填入 '+loadedFromArchive.size+'/2 项。请核对下方文件名，再点击「保存资料」。未保存前不会更新库内档案。':'';
    }
    function changeEditor(row){
      editorSerial++;
      showAlternatives();archiveDraft=null;loadedFromArchive=new Set();
      current=row?{id:row.id,version:row.version}:null;
      files=new Map([...(row?.attachments||[]),...(row?.signingAssets||[])].map(a=>[a.kind,a]));
      for(const [key,x]of Object.entries(controls))x.value=row?.[key]||(key==='kind'?'own':'');
      baseline=captureDraft();title.textContent=row?'编辑 · '+row.name:'新增事务所';describe();
    }
    function lock(){
      const locked=editorBusy||archiveBusy||!db||listError;
      for(const x of [...Array.from(form.elements),...Array.from(list.querySelectorAll('button')),newBtn])x.disabled=locked;
      refresh.disabled=editorBusy||archiveBusy||!db;
      for(const k of KINDS){const c=certControls[k];c.remove.disabled=locked||!files.has(k);if(c.look)c.look.disabled=locked||!files.get(k)?.bytes||!root.URL?.createObjectURL;}
      archiveInput.disabled=locked||!root.BidderIntake||(!root.BidderIntake.readFile&&!root.BidderArchive);
      for(const x of archiveRows.querySelectorAll('button'))x.disabled=locked;
      clearArchive.disabled=editorBusy||archiveBusy;
      select.disabled=pickBusy||!db||listError;use.disabled=select.disabled||!select.value||!rows.some(r=>r.id===select.value);unlink.disabled=pickBusy;
    }
    function renderRows(){
      list.replaceChildren();select.replaceChildren(option('','请选择事务所（仅测算可不选）'));
      if(!rows.length)list.append(el('p','暂无已保存事务所，可在下方建立第一条资料。','muted'));
      for(const r of rows){
        const summary=el('div');summary.append(el('strong',r.name),el('span',labels[r.kind]+' · '+(r.team||'所在地未填')+' · 已备 '+r.credentialKinds.length+'/2 项证照','muted'));
        const edit=button('编辑'),del=button('删除');edit.dataset.bidderEdit=r.id;del.dataset.bidderRemove=r.id;edit.setAttribute('aria-label','编辑 '+r.name);del.setAttribute('aria-label','删除 '+r.name);
        edit.addEventListener('click',()=>editAction(async()=>{const row=await db.get(r.id);changeEditor(row);refreshIntakeForEditor();editStatus.textContent='正在编辑已保存资料。';controls.name.focus();}));
        del.addEventListener('click',()=>{if(!root.confirm('删除“'+r.name+'”及库内证照？已带入的草稿和已登记历史不会被修改。'))return;editAction(async()=>{await db.remove(r.id,r.version);if(current?.id===r.id){changeEditor(null);refreshIntakeForEditor();}await refreshRows();editStatus.textContent='已从资料库删除。';});});
        const g=el('div',undefined,'bidder-row-actions'),row=el('div',undefined,'bidder-row');g.append(edit,del);row.append(summary,g);list.append(row);
        select.append(option(r.id,labels[r.kind]+' · '+r.name));
      }
      if(used&&!rows.some(r=>r.id===used.id)){const historic=option(used.id,used.name+'（已从库中删除，当前草稿仍保留）');historic.disabled=true;select.append(historic);}
      select.value=used?.id||'';if(used){const latest=rows.find(r=>r.id===used.id);pickStatus.textContent='当前草稿已带入：'+used.name+'。'+(!latest?'原资料已删除。':latest.version!==used.version?'库内资料有更新，可重新带入。':'库内后续修改不会自动覆盖草稿。');}
      lock();
    }
    async function refreshRows(){try{rows=await db.list();listError=false;renderRows();}catch(e){listError=true;rows=[];renderRows();throw e;}}
    async function editAction(fn,prefix=''){if(editorBusy||archiveBusy||!db)return;editorBusy=true;lock();try{await fn();}catch(e){editStatus.textContent=prefix+(e?.message||'操作失败，请重试。');}finally{editorBusy=false;describe();lock();}}
    const clearPicker=()=>{pickEpoch++;used=null;select.value='';pickBusy=false;pickStatus.textContent='未选用库内事务所。可先手工测算；生成报价包前请选择事务所。';lock();};
    async function pick(id){
      if(pickBusy)return;const epoch=++pickEpoch;pickBusy=true;used=null;lock();pickStatus.textContent=id?'正在读取所选事务所及其证照……':'正在解除选用……';
      try{await detach();if(epoch!==pickEpoch)return;
        if(!id){select.value='';pickStatus.textContent='已改为手工录入；已清空上一家事务所资料及两证。';return;}
        const r=await db.get(id);if(epoch!==pickEpoch)return;
        const {signingAssets,signingKinds,...quoteProfile}=r;await apply(quoteProfile,{});if(epoch!==pickEpoch)return;
        used={id:r.id,name:r.name,version:r.version};select.value=r.id;pickStatus.textContent='已带入：'+r.name+'（'+labels[r.kind]+'）；已备 '+r.attachments.length+'/2 项证照。';
      }catch(e){if(epoch!==pickEpoch)return;select.value='';used=null;try{await detach();}catch{}pickStatus.textContent='未带入所选事务所，请重新选择或手工录入。'+(e?.message||'');}
      finally{if(epoch===pickEpoch){pickBusy=false;lock();}}
    }
    const firmKey=v=>String(v||'').normalize('NFKC').trim();
    const sameRows=p=>{const key=firmKey(p.fields?.name);return key?rows.filter(r=>firmKey(r.name)===key):[];};
    const pristine=()=>!current&&isEditorClean();
    const canAuto=candidate=>{
      const matches=sameRows(candidate);
      return matches.length<=1&&(pristine()||(matches.length===1&&current?.id===matches[0].id&&isEditorClean()));
    };
    const showEditor=()=>form.scrollIntoView?.({block:'start',behavior:'smooth'});
    async function fillCandidate(candidate,automatic=false){
      if(automatic&&!canAuto(candidate))return;
      const matches=sameRows(candidate);
      let target=null;
      if(matches.length>1){
        target=matches.find(r=>r.id===current?.id);
        if(!target){archiveStatus.textContent='有多条同名档案。请先点击需要补齐的那一条「编辑」，再带入识别结果。';return;}
      }else target=matches[0]||null;
      if(!automatic&&(target||!pristine())&&!root.confirm(target?'将识别结果带入同名档案的编辑稿？仅填入识别到的字段和通过校验的文件；仍须确认保存，当前未保存的编辑会被替换。':'以此候选填入一条新档案？当前未保存的编辑会被替换。'))return;
      await editAction(async()=>{
        const next=new Map(),failed=[],failedKinds=new Set(),cleaned=[];
        for(const k of KINDS){
          const f=candidate.files?.[k];if(!f)continue;
          try{
            const name=String(f.name||'').split(/[\\/]/).pop();
            const ext=name.split('.').at(-1).toLowerCase(),type={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',pdf:'application/pdf'}[ext]||'';
            const file=new File([f.bytes],name,{type}),asset=await readFile(file,k);
            next.set(k,asset);if(SIGNING.includes(k)&&Number.isInteger(asset.size)&&asset.size!==file.size)cleaned.push(labels[k]);
          }catch{failed.push(labels[k]);failedKinds.add(k);}
        }
        const prior=target?await db.get(target.id):null;
        changeEditor(prior);
        for(const k of ['name','team','contactName','phone','email']){
          const field=controls[k],v=candidate.fields?.[k];
          if(typeof v!=='string'||!v.trim()||(k==='name'&&prior))continue;
          if(k==='team'&&!Array.from(field.options).some(o=>o.value===v))continue;
          field.value=field.maxLength>0?v.slice(0,field.maxLength):v;
        }
        if(!prior)controls.kind.value='';
        showAlternatives(candidate.alternatives);
        for(const [k,v]of next){files.set(k,v);loadedFromArchive.add(k);}
        archiveDraft={candidate,verified:new Map(next),failed:failedKinds};
        title.textContent=prior?'核对资料 · '+prior.name:'核对资料 · 新增事务所';
        editStatus.textContent='已填入待核对资料。未识别字段请补填，核对后点击「保存资料」。'+(failed.length?'未带入（文件校验未通过）：'+failed.join('、')+'。':'')+(cleaned.length?' 已清理 JPEG 非图像尾部：'+cleaned.join('、')+'；原文件未改，请核对图片。':'');
        archiveStatus.textContent='已从资料读入 '+next.size+'/2 项并填入'+(prior?'同名档案的待核对编辑稿':'新增档案的待核对编辑稿')+'。'+(failed.length?'有 '+failed.length+' 项未通过校验。':'')+'请核对后保存；原档案尚未修改。';
        renderIntake();
        if(!automatic)showEditor();
      },'没有修改库内资料。');
    }
    function renderIntake(){
      archiveRows.replaceChildren();clearArchive.hidden=!intake;
      if(!intake)return;
      const {profiles,inventory,warnings}=intake;
      for(const warning of warnings||[])archiveRows.append(el('p',String(warning),'muted'));
      for(const [i,m]of (intake.materials||[]).entries()){
        const card=el('div',undefined,'bidder-file-card'),heading=el('strong',(m.original?'原件：':'内嵌资料：')+m.name),preview=button('预览'),download=button('下载原件'),choice=el('select'),assign=button('指定为所选证照');
        choice.setAttribute('aria-label','资料 '+(i+1)+' 的证照类型');choice.append(option('','请选择两证用途'),option('business_license','营业执照'),option('practice_certificate','执业证书'));
        const canAssign=['application/pdf','image/png','image/jpeg'].includes(m.mime)&&m.blob?.size<=3*1024*1024;
        card.append(heading,preview,download);
        preview.onclick=()=>{if(root.AuditAttachmentPreview?.open)root.AuditAttachmentPreview.open({blob:m.blob,name:m.name});else archiveStatus.textContent='预览组件未加载；可下载原件在本机查看。';};
        download.onclick=()=>{const u=root.URL.createObjectURL(m.blob);intakeURLs.add(u);const a=el('a');a.href=u;a.download=m.name;a.hidden=true;document.body.append(a);a.click();a.remove();};
        if(canAssign){card.append(choice,assign);assign.dataset.bidderMaterial=String(i);assign.disabled=editorBusy||archiveBusy;
          assign.onclick=()=>{
            const k=choice.value;if(!CERTS.includes(k)){archiveStatus.textContent='请先选择营业执照或执业证书。';return;}
            if(!controls.name.value.trim()){archiveStatus.textContent='请先选择正确候选或填写当前事务所名称，再指定证照。';controls.name.focus();return;}
            if(!root.confirm('确认「'+m.name+'」确为「'+controls.name.value.trim()+'」的'+labels[k]+'？将填入当前编辑稿，保存前不修改库内资料。'))return;
            editAction(async()=>{const a=await readFile(new File([m.blob],m.name,{type:m.mime}),k);files.set(k,a);loadedFromArchive.add(k);if(!archiveDraft)archiveDraft={candidate:null,verified:new Map(),failed:new Set()};archiveDraft.verified.set(k,a);archiveDraft.failed.delete(k);editStatus.textContent='已人工指定'+labels[k]+'；请核对文件后保存资料。';renderIntake();});
          };
        }else card.append(el('span','该原件可预览下载；作为两证请先转为3MiB以内的PDF、PNG或JPEG。','muted'));
        archiveRows.append(card);
      }
      for(const [index,candidate]of profiles.entries()){
        const row=el('div',undefined,'bidder-row bidder-import-result'),info=el('div');
        const applied=archiveDraft?.candidate===candidate;
        const count=KINDS.filter(k=>candidate.files?.[k]).length;
        info.append(el('strong',(index+1)+'. '+(candidate.fields?.name||'待填写事务所名称')),
          el('span',applied?'已填入待核对：'+archiveDraft.verified.size+'/2 项':'识别到 '+count+'/2 项 · 尚未填入编辑稿','muted'));
        const checklist=el('ul',undefined,'bidder-import-checklist');
        for(const k of KINDS){
          const f=candidate.files?.[k],loaded=applied&&archiveDraft.verified.get(k),bad=applied&&archiveDraft.failed.has(k);
          const line=el('li');line.dataset.importKind=k;line.dataset.importState=loaded?'filled':bad?'rejected':f?'matched':'missing';
          const name=loaded?.name||(f?String(f.name||'').split(/[\\/]/).at(-1):'');
          line.append(el('strong',labels[k]),el('span',loaded?'已读入：'+name:bad?'未通过文件校验：'+name:f?'已匹配：'+name:'未识别，请核对包内文件名'));
          checklist.append(line);
        }
        info.append(checklist);
        for(const note of candidate.notes||[])info.append(el('span',String(note),'muted'));
        const apply=button(applied?'前往核对并保存':sameRows(candidate).length?'补齐同名档案':'填入这条资料',null,applied?'btn':'btn primary');
        apply.dataset.bidderIntake=String(index);
        apply.addEventListener('click',()=>applied?showEditor():fillCandidate(candidate));
        row.append(info,apply);archiveRows.append(row);
      }
      if(inventory?.length){
        const details=el('details',undefined,'bidder-import-inventory'),ul=el('ul');
        const safeInventory=inventory.filter(n=>!/(?:公章|法人章|签字|签名)/u.test(typeof n==='string'?n:String(n?.name||'')));
        for(const n of safeInventory)ul.append(el('li',typeof n==='string'?n:String(n?.name||'')));
        details.append(el('summary','查看已读文件清单（'+safeInventory.length+' 项）'),ul);archiveRows.append(details);
      }
      lock();
    }
    function refreshIntakeForEditor(){
      if(intake?.profiles.length&&!archiveDraft)archiveStatus.textContent='已有资料识别结果，尚未填入当前编辑稿。请点击对应候选的按钮。';
      renderIntake();
    }
    clearArchive.addEventListener('click',()=>{clearIntakeURLs();intake=null;archiveInput.value='';archiveStatus.textContent='已清除识别结果；编辑稿及已保存的资料不变。';renderIntake();});
    archiveInput.addEventListener('change',async()=>{
      const file=archiveInput.files?.[0];archiveInput.value='';if(!file||archiveBusy||editorBusy||!db)return;
      clearIntakeURLs();archiveBusy=true;intake=null;renderIntake();lock();archiveStatus.textContent='正在本机读取原件和候选资料，请稍候…';
      let archive;
      try{
        if(root.BidderIntake.readFile)intake=await root.BidderIntake.readFile(file);
        else{archive=await root.BidderArchive.open(file);intake=await root.BidderIntake.read(archive);}
        archiveStatus.textContent=intake.profiles.length?'识别到 '+intake.profiles.length+' 条候选档案。请核对后保存；没有自动写入资料库。':'未识别到可带入的资料。可查看文件清单或手工填写。';
      }catch(e){intake=null;archiveStatus.textContent='未完成读取；资料库未改动。'+(e?.message||'请检查压缩包。');}
      finally{
        try{await archive?.close();}catch{}
        archiveBusy=false;renderIntake();lock();
      }
      if(intake?.profiles.length===1&&canAuto(intake.profiles[0]))await fillCandidate(intake.profiles[0],true);
      else if(intake?.profiles.length)archiveStatus.textContent='已识别 '+intake.profiles.length+' 条候选，尚未填入。'+
        (!isEditorClean()?'当前编辑稿有未保存修改。':intake.profiles.length>1?'请先核对所属事务所。':'请核对目标档案。')+
        '点击对应候选的按钮即可带入，不用逐个上传。';
    });
    select.addEventListener('change',()=>pick(select.value));use.addEventListener('click',()=>pick(select.value));unlink.addEventListener('click',()=>pick(''));
    newBtn.addEventListener('click',()=>{if(editorBusy)return;changeEditor(null);refreshIntakeForEditor();controls.name.focus();editStatus.textContent='正在新增资料。';});
    refresh.addEventListener('click',()=>editAction(async()=>{await refreshRows();editStatus.textContent='列表已刷新。';}));
    form.addEventListener('submit',e=>{e.preventDefault();if(editorBusy||archiveBusy||!db||listError||!form.reportValidity())return;
      const values=Object.fromEntries(Object.entries(controls).map(([key,x])=>[key,x.value.trim()]));const attachments=[...files.values()];const editing=current;
      editAction(async()=>{const r=editing?await db.update(editing.id,editing.version,values,attachments):await db.create(values,attachments);const fromArchive=!!archiveDraft;changeEditor(r);await refreshRows();
        if(fromArchive){archiveStatus.textContent='已保存：两证 '+r.credentialKinds.length+'/2 项。可回报价页选用或「重新带入」。';intake=null;renderIntake();}
        editStatus.textContent='已保存 '+r.name+'。';});
    });
    changeEditor(null);clearPicker();
    const ready=(async()=>{try{db=await root.BidderLibrary.open();await refreshRows();}catch(e){editStatus.textContent='资料库未就绪，仍可手工录入测算；无法从库内带入证照。'+(e?.message||'');pickStatus.textContent=editStatus.textContent;}finally{lock();}})();
    function draftScope(){return Object.freeze({kind:'bidder-editor',firmId:current?.id||'new-editor',recordId:'version:'+(current?.version||0)});}
    function pendingError(message,code='BIDDER_PENDING_INVALID'){
      editStatus.textContent=message;const e=Error(message);e.code=code;e.preserveDOM=true;throw e;
    }
    function filesUnchanged(){return !!baseline&&files.size===baseline.files.size&&[...files].every(([k,v])=>baseline.files.get(k)===v);}
    function assertPendingReady(){
      if(editorBusy||archiveBusy)pendingError('资料正在读取或保存，请等待完成；当前编辑稿和附件仍保留。','BIDDER_PENDING_BUSY');
      if(!db||listError||!baseline)pendingError('资料库尚未就绪，未暂存或恢复当前编辑稿。');
      if(!filesUnchanged())pendingError('两证或基础资料附件有未保存的变更。请先点击「保存资料」保存附件；当前页面和文件仍保留，不会只暂存文件名冒充附件已保存。','BIDDER_PENDING_FILES');
    }
    function capturePending(){
      assertPendingReady();
      const fields=Object.freeze(Object.fromEntries(Object.entries(controls).map(([k,x])=>[k,x.value])));
      return Object.freeze({scope:draftScope(),values:Object.freeze({schemaVersion:1,version:current?.version||0,fields})});
    }
    function exactPending(value,keys){
      if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))pendingError('暂存资料结构无效，当前编辑稿未修改。');
      const ds=Object.getOwnPropertyDescriptors(value),names=Reflect.ownKeys(ds);
      if(names.length!==keys.length||names.some(k=>typeof k!=='string'||!keys.includes(k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable))pendingError('暂存资料字段不完整或含动态取值，当前编辑稿未修改。');
      return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
    }
    async function restorePending(values,{scope}={}){
      assertPendingReady();
      const source=exactPending(scope,['kind','firmId','recordId']),target=draftScope(),payload=exactPending(values,['schemaVersion','version','fields']);
      if(source.kind!=='bidder-editor'||typeof source.firmId!=='string'||!Number.isSafeInteger(payload.version)||payload.version<0||payload.schemaVersion!==1||source.recordId!=='version:'+payload.version||source.firmId!==target.firmId||source.recordId!==target.recordId)
        pendingError('暂存资料属于另一事务所或其他档案版本，不能恢复到当前编辑稿。','BIDDER_PENDING_SCOPE');
      const data=exactPending(payload.fields,Object.keys(controls)),limits={kind:12,name:150,team:100,contactName:100,phone:80,email:120};
      for(const [k,v]of Object.entries(data)){
        if(typeof v!=='string'||v.length>limits[k]||!v.isWellFormed()||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v))pendingError('暂存资料含无效或过长字段，当前编辑稿未修改。');
        if((k==='kind'||k==='team')&&!Array.from(controls[k].options).some(o=>o.value===v))pendingError('暂存资料的所属类型或执行团队地区无效。');
      }
      const serial=editorSerial,before=Object.fromEntries(Object.entries(controls).map(([k,x])=>[k,x.value]));
      if(current){
        const saved=await db.get(current.id);
        if(!saved||saved.id!==source.firmId||saved.version!==payload.version)pendingError('资料库中的事务所版本已改变，请先刷新核对；未覆盖当前编辑稿。','BIDDER_PENDING_VERSION');
      }
      assertPendingReady();
      const latest=draftScope();
      if(editorSerial!==serial||latest.firmId!==source.firmId||latest.recordId!==source.recordId||Object.entries(before).some(([k,v])=>controls[k].value!==v))
        pendingError('恢复期间当前事务所或编辑内容已改变，未覆盖新编辑稿。','BIDDER_PENDING_CHANGED');
      for(const [k,v]of Object.entries(data))controls[k].value=v;
      // Do not update baseline: restored text remains an unsaved, dirty editor.
      // Native files, historical opaque assets and the quotation picker stay put.
      editStatus.textContent='已恢复本事务所的暂存文字，尚未正式保存或选用；请核对后点击「保存资料」。';
      return Object.freeze({restored:true,scope:draftScope(),fields:6});
    }
    return Object.freeze({ready,clearPicker,draftScope,capturePending,restorePending});
  }
  root.BidderUI=Object.freeze({connect});
})(globalThis);
