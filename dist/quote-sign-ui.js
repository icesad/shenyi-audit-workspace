/* Quote format selection and per-file signing review. Approval is per export, never persisted. */
(function(root){
  'use strict';
  const roles=Object.freeze({company_seal:'公司公章',legal_representative_seal:'法人章',bidder_signature:'投标人签字'});
  const corners=Object.freeze({'bottom-right':'右下','bottom-left':'左下','top-right':'右上','top-left':'左上'});
  const titles={business_license:'营业执照',practice_certificate:'执业证书'};
  const create=(tag,text,cls)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;};
  const option=(value,text)=>{const x=create('option',text);x.value=value;return x;};
  const button=(text,id,primary=false)=>{const x=create('button',text,primary?'btn primary':'btn');x.type='button';if(id)x.id=id;return x;};
  const labeled=(txt,input)=>{const x=create('label',txt);x.append(input);return x;};
  function itemsFor(state){
    const out=state.formats.map(id=>{
      const f=root.QuoteLayouts.catalog.find(x=>x.id===id);return {id:'quote:'+id,name:f.title,type:'quote',formatId:id,defaultKinds:[...f.defaultKinds],templateNote:f.notes};
    });
    for(const f of state.pair)out.push({id:'cert:'+f.kind,name:f.name,type:'attachment',role:f.kind,label:titles[f.kind],mime:f.mime,file:f});
    for(const [i,f] of state.extras.entries())out.push({id:'extra:'+i,name:f.name,type:'attachment',role:'other',label:'其他附件 '+(i+1),mime:f.mime,file:f});
    return out;
  }
  function mode(item){
    if(item.type==='quote')return 'template';
    if(['application/pdf','image/png','image/jpeg'].includes(item.mime))return 'corner';
    return '';
  }
  function mount(anchor,{capture,isCurrent,apply,onChange}){
    if(!anchor||!root.QuoteLayouts)return null;
    const formatsBox=create('fieldset',undefined,'qs-formats'),controls=new Map(),options={};
    formatsBox.id='quote-format-options';formatsBox.append(create('legend','报价单格式（可多选）'));
    for(const f of root.QuoteLayouts.catalog){
      const x=create('input');x.type='checkbox';x.id='quote-layout-'+f.id;x.value=f.id;controls.set(f.id,x);
      const row=create('label',undefined,'qs-check');row.append(x,create('span',f.title));formatsBox.append(row);
      x.addEventListener('change',()=>onChange?.());
    }
    const detail=create('details',undefined,'qs-details'),extra=create('div',undefined,'qs-fields');detail.append(create('summary','版式补充信息（选填）'));
    for(const [key,label,max] of [['workDays','服务期限／现场天数',60],['validity','报价有效期',100],['costScope','食宿、交通等费用范围',200],
      ['serviceScope','服务范围',200],['authorizedPerson','授权代表姓名',80],['authorizedRole','授权代表职务',80],
      ['firmAddress','供应商地址（格式3）',160],['fax','传真（格式3）',60],['bankName','开户行（格式3，选填）',120],
      ['bankAccount','银行账号（格式3，选填）',80],['legalRepresentative','法定代表人（格式3，选填）',80]]){
      const x=create('input');x.type='text';x.maxLength=max;x.id='quote-layout-'+key;options[key]=x;extra.append(labeled(label,x));x.addEventListener('input',()=>onChange?.());
    }
    detail.append(create('p','项目、报价金额和投标方信息由当前报价带入。未填的服务期限和费用范围保留待核对；选填收款信息仅在已填写时显示。','tiny'),extra);
    const review=button('核对章签并生成副本','quote-sign-review');
    review.disabled=true;
    anchor.append(formatsBox,detail,create('p','在「预览客户报价草稿」中可下载无章 Word。选一项直接下载 .docx；多选下载 Word ZIP；不选时 Word 默认使用格式1。','tiny'),review);
    const dialog=create('dialog',undefined,'qs-dialog');dialog.id='quote-sign-dialog';dialog.setAttribute('aria-labelledby','quote-sign-title');
    const title=create('h2','逐份核对章签要求');title.id='quote-sign-title';
    const close=button('关闭','quote-sign-close'),head=create('div',undefined,'dialog-toolbar');head.append(title,close);
    const body=create('div',undefined,'qs-body'),caption=create('p',undefined,'qs-caption');
    const file=create('input');file.type='file';file.accept='.docx,.pdf,.txt';file.id='quote-sign-source';
    const useTender=button('读取已导入的发标文件','quote-sign-use-tender'),analyse=button('识别要求并更新建议','quote-sign-analyse');
    const text=create('textarea');text.id='quote-sign-text';text.maxLength=100000;text.rows=4;text.placeholder='可粘贴采购文件中有关报价函、营业执照、附件名称等的明确章签要求';
    const notice=create('p');notice.id='quote-sign-status';notice.setAttribute('role','status');
    const rows=create('div',undefined,'qs-rows');rows.id='quote-sign-rows';
    const ack=create('input');ack.type='checkbox';ack.id='quote-sign-confirmed';
    const agree=create('label',undefined,'qs-check');agree.append(ack,create('span','我已核对每份文件的章签要求和落点，并有权使用当前事务所的图样。'));
    const generate=button('确认应用章签并导出 ZIP','quote-sign-generate',true);
    const footer=create('div',undefined,'qs-confirm');footer.append(agree,generate);
    body.append(caption,create('p','识别仅作建议。没有明确对象、要求「签字或盖章」、骑缝章或电子签章时需人工核对；报价模板的图样只放到对应角色区。PDF 或图片必须选定页和位置，原件不修改；未勾选章签的附件按原件入包。','muted'),labeled('读取采购或附件要求（DOCX、PDF、TXT）',file),useTender,labeled('章签要求文字',text),analyse,notice,rows,create('p','生成的是带图片章签的待复核副本，不是审批、电子签名或自动递交。报价历史仅保留通用无章草稿与原附件；所选格式和章签副本请另存本次 ZIP。','tiny'),footer);
    dialog.append(head,body);document.body.append(dialog);
    let data=null,items=[],widgets=[],busy=false,ticket=0,sourceReadNotes=[];
    const clearAck=()=>{ack.checked=false;sync();};
    function selection(){return {formats:[...controls].filter(([,x])=>x.checked).map(([id])=>id),options:Object.fromEntries(Object.entries(options).map(([k,x])=>[k,x.value.trim()]))};}
    function setNotice(s,bad=false){notice.textContent=s;notice.classList.toggle('error',bad);}
    function sync(){
      useTender.hidden=!data?.tenderFile;
      for(const x of [close,file,useTender,text,analyse,ack])x.disabled=busy;
      for(const w of widgets)for(const x of [...w.toggles,w.page,w.position].filter(Boolean))x.disabled=busy||!w.mode;
      generate.disabled=busy||!ack.checked||!widgets.some(w=>w.mode&&w.toggles.some(x=>x.checked));
    }
    function render(suggestions=[]){
      const dict=new Map(suggestions.map(x=>[x.id,x]));
      rows.replaceChildren();widgets=[];
      for(const item of items){
        const s=dict.get(item.id),kindMode=mode(item),row=create('section',undefined,'qs-row');row.dataset.signItem=item.id;
        const headline=create('h3',item.type==='quote'?item.name:item.label+' · '+item.name);row.append(headline);
        if(item.templateNote)row.append(create('p',item.templateNote,'muted'));
        const tags=create('div',undefined,'qs-sign-kinds'),toggles=[];
        for(const [k,label] of Object.entries(roles)){
          const x=create('input');x.type='checkbox';x.value=k;x.dataset.signKind=k;x.checked=!!kindMode&&(s?.kinds||item.defaultKinds||[]).includes(k);
          const l=create('label',undefined,'qs-check');l.append(x,create('span',label));tags.append(l);toggles.push(x);x.addEventListener('change',clearAck);
        }
        row.append(tags);
        let page,position;
        if(kindMode==='corner'){
          const place=create('div',undefined,'qs-fields qs-placement');
          page=create('input');page.type='number';page.min='1';page.max='300';page.step='1';page.placeholder='填写页码';page.dataset.signPage='';
          if(item.mime!=='application/pdf'){page.value='1';page.readOnly=true;}
          position=create('select');position.dataset.signPosition='';position.append(option('','请选择落点'),...Object.entries(corners).map(([id,t])=>option(id,t)));
          place.append(labeled('页码（从1开始）',page),labeled('落点（请确认空白）',position));row.append(place);
          page.addEventListener('input',clearAck);position.addEventListener('change',clearAck);
        }else if(!kindMode)row.append(create('p','此类型附件仅识别要求，不自动修改原件。需要签章时，请先用原软件处理，或确认转成 PDF 后重新选择。','muted'));
        if(!kindMode&&s?.kinds?.length)row.append(create('p','识别建议：'+s.kinds.map(k=>roles[k]).filter(Boolean).join('、')+'（须手工处理）','qs-uncertain'));
        if(s?.uncertain)row.append(create('p','待人工核对','qs-uncertain'));
        for(const line of [...(s?.notes||[]),...(s?.evidence||[])].slice(0,8))row.append(create('p',String(line),'qs-evidence'));
        rows.append(row);widgets.push({item,mode:kindMode,toggles,page,position});
      }
      clearAck();
    }
    function requestItems(inspect){
      return items.map(x=>({id:x.id,name:x.name,type:x.type,role:x.role,defaultKinds:x.defaultKinds||[],mime:x.mime,...(inspect&&x.role==='other'?{bytes:x.file.bytes}:{})}));
    }
    async function suggest(inputFile=null){
      if(busy||!data)return;const token=++ticket;busy=true;clearAck();setNotice(inputFile?'正在本机读取采购要求…':'正在本机分析逐份文件的章签建议…');
      try{
        if(!root.QuoteSignRequirements)throw Error('章签识别组件未加载；可手工核对勾选。');
        if(inputFile){const v=await root.QuoteSignRequirements.readRequirements(inputFile);if(token!==ticket)return;
          text.value=v.text.slice(0,text.maxLength);sourceReadNotes=v.notes||[];
        }
        const result=await root.QuoteSignRequirements.review({requirementsText:text.value,items:requestItems(true)});
        if(token!==ticket)return;
        if(!isCurrent(data))throw Error('报价、事务所或附件已改变。请关闭并重新核对。');
        render(result);
        setNotice(['已更新建议，请逐项核对。',...sourceReadNotes].join(' '));
      }catch(e){if(token===ticket)setNotice(e.message||'未能识别，请手工核对。',true);}
      finally{if(token===ticket){busy=false;sync();}}
    }
    function closeReview(){if(!busy&&dialog.open)dialog.close();}
    review.addEventListener('click',()=>{
      try{
        data=capture();if(!data.formats.length)throw Error('请先在报价单勾选至少一种格式。');
        items=itemsFor(data);text.value='';file.value='';sourceReadNotes=[];caption.textContent='本次投标方：'+data.snapshot.firmName+' · 仅作用于本次所选文件';
        setNotice('下方初始勾选仅来自模板明确位置。可读取采购要求后再核对。');render();dialog.showModal();
      }catch(e){onChange?.(e.message||'当前报价尚未就绪。');}
    });
    close.addEventListener('click',closeReview);
    dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
    dialog.addEventListener('close',()=>{++ticket;busy=false;data=null;items=[];widgets=[];rows.replaceChildren();text.value='';file.value='';sourceReadNotes=[];clearAck();});
    file.addEventListener('change',()=>{const f=file.files?.[0];file.value='';if(f)suggest(f);});
    useTender.addEventListener('click',()=>{if(data?.tenderFile)suggest(data.tenderFile);});
    analyse.addEventListener('click',()=>suggest());
    text.addEventListener('input',clearAck);
    ack.addEventListener('change',sync);
    generate.addEventListener('click',async()=>{
      if(!ack.checked||busy||!data)return;
      try{
        if(!isCurrent(data))throw Error('报价、事务所或附件已改变。请关闭并重新核对。');
        const plan=[];
        for(const w of widgets){
          const kinds=w.toggles.filter(x=>x.checked&&!x.disabled).map(x=>x.value);if(!kinds.length)continue;
          if(w.mode==='corner'){
            const page=Number(w.page.value),position=w.position.value;
            if(!Number.isInteger(page)||page<1||page>300||!Object.hasOwn(corners,position))throw Error('请先确认「'+w.item.label+'」的页码和落点。');
            plan.push({id:w.item.id,kinds,page,position});
          }else plan.push({id:w.item.id,kinds});
        }
        if(!plan.length)throw Error('尚未选择任何章签。');
        busy=true;sync();setNotice('正在本机生成待复核副本，不修改原件…');
        await apply(data,plan);
        busy=false;dialog.close();
      }catch(e){busy=false;clearAck();setNotice(e.message||'未生成副本，请核对。',true);}
    });
    return Object.freeze({selection,reviewButton:review,itemsFor});
  }
  root.QuoteSignUI=Object.freeze({mount,itemsFor});
})(globalThis);
