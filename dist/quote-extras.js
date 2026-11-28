/* Other attachments belong to this quote, never to the reusable firm profile. */
(function(root){
  'use strict';
  function mount(container){
    if(!container||!root.QuotePacket)throw Error('其他附件组件尚未就绪。');
    const doc=container.ownerDocument,make=(tag,cls,value)=>{const e=doc.createElement(tag);if(cls)e.className=cls;if(value)e.textContent=value;return e;};
    const section=make('div','quote-extras'),head=make('div','qe-head'),title=make('h3','','其他附件'),counter=make('span','badge neutral');
    const hint=make('p','muted','可多选，最多 10 份，不占营业执照和执业证书的名额。可选 PDF、PNG、JPG、DOCX、XLSX；每份最大 3 MiB。文件只在本机读取，在报价包中单列，不合并进打印正文。');
    const label=make('label','qe-label','选择其他附件'),input=make('input','');input.type='file';input.multiple=true;input.accept='.pdf,.png,.jpg,.jpeg,.docx,.xlsx';label.append(input);globalThis.ShenyiFileDrop?.bind(label,input,{material:'其他报价附件',limit:'单份最多 3 MiB'});
    const list=make('ol','qe-list'),status=make('p','qe-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    head.append(title,counter);section.append(head,hint,label,list,status);container.replaceChildren(section);
    let saved=[],busy=false,generation=0;
    const change=()=>{const E=doc.defaultView?.Event||root.Event;container.dispatchEvent(new E('extraschange',{bubbles:true}));};
    function render(){
      counter.textContent=saved.length+' / 10';input.disabled=busy||saved.length>=10;
      list.replaceChildren();list.hidden=!saved.length;
      saved.forEach((a,i)=>{const li=make('li',''),name=make('span','',a.name),del=make('button','text-button','移除');del.type='button';del.disabled=busy;del.setAttribute('aria-label','移除 '+a.name);
        del.addEventListener('click',()=>{if(busy)return;saved.splice(i,1);render();status.textContent='已移除 '+a.name+'。';change();});
        li.append(name,del);list.append(li);});
    }
    input.addEventListener('change',async()=>{
      const picked=Array.from(input.files||[]);input.value='';if(!picked.length||busy)return;
      if(picked.length+saved.length>10){status.textContent='最多再选 '+(10-saved.length)+' 份；本次选择未添加。';return;}
      busy=true;const ticket=++generation;render();status.textContent='正在本机核对附件…';change();
      try{
        const batch=[];for(const f of picked){if(ticket!==generation)return;batch.push(await root.QuotePacket.readExtra(f));}
        if(ticket!==generation)return;saved.push(...batch);status.textContent='已添加 '+batch.length+' 份其他附件。';
      }catch(e){if(ticket===generation)status.textContent='本次选择未添加，已有附件不变。'+(e.message||'请重新选择。');}
      finally{if(ticket===generation){busy=false;render();change();}}
    });
    render();
    return Object.freeze({
      list(){return saved.map(a=>Object.freeze({...a,bytes:new Uint8Array(a.bytes)}));},
      isPending(){return busy;},
      clear(){++generation;busy=false;saved=[];input.value='';status.textContent='';render();change();}
    });
  }
  const api=Object.freeze({mount});root.QuoteExtras=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
