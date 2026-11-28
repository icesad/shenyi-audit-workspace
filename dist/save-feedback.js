(function(root){
  'use strict';

  function reason(error, fallback='保存未完成，请重试。'){
    const messages={
      QuotaExceededError:'本机存储空间不足，请清理空间后重试。',
      SecurityError:'浏览器拒绝访问本机存储，请检查权限后重试。',
      NotAllowedError:'浏览器未授予保存权限，请检查权限后重试。',
      InvalidStateError:'保存连接已关闭，请刷新页面后重试。',
      VersionError:'本机数据版本不兼容，请关闭旧页面并打开当前版本。',
      ReadOnlyError:'当前资料库为只读，请检查访问权限后重试。',
      NotReadableError:'所选文件无法读取，请重新选择可访问的原件。'
    };
    let cause=error;
    for(let level=0;cause&&level<4;level++,cause=cause.cause){
      if(Object.hasOwn(messages,cause.name))return messages[cause.name];
    }
    const detail=typeof error==='string'?error:error?.message;
    return typeof detail==='string'&&detail.trim()?detail.trim():fallback;
  }

  function publish(state,message,operation){
    if(root.document&&typeof root.CustomEvent==='function'){
      root.document.dispatchEvent(new root.CustomEvent('shenyi:save-result',{detail:{state,message,...(operation?{operation}:{})}}));
    }
    return message;
  }

  function saved(message){return publish('saved',message);}
  function failed(error,fallback){return publish('failed',reason(error,fallback));}
  const exported=message=>publish('saved',message,'导出');
  const exportFailed=error=>publish('failed',reason(error,'导出未完成，请重试。'),'导出');
  const drafted=message=>publish('saved',message,'暂存');
  const draftFailed=error=>publish('failed',reason(error,'暂存未完成，请重试。'),'暂存');
  const downloaded=message=>publish('saved',message,'下载');
  const downloadFailed=error=>publish('failed',reason(error,'下载未完成，请重试。'),'下载');
  function storageError(error,fallback){return Error(reason(error,fallback));}

  function invalid(form,show){
    form.addEventListener('invalid',event=>{
      const input=event.target;
      const first=Array.from(form.elements).find(field=>field.willValidate&&!field.validity.valid);
      if(input!==first)return;
      const labelNode=input.labels?.[0]?.cloneNode(true);
      labelNode?.querySelectorAll('input,select,textarea,button').forEach(node=>node.remove());
      const label=labelNode?.textContent.trim()||input.getAttribute('aria-label')||'此字段';
      const message=input.validity.valueMissing?'缺少必要资料，请填写或选择「'+label+'」。':'「'+label+'」填写有误。'+input.validationMessage;
      show(failed(message),true);
    },true);
  }

  const api=Object.freeze({reason,saved,failed,exported,exportFailed,drafted,draftFailed,downloaded,downloadFailed,storageError,invalid});
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SaveFeedback=api;
})(globalThis);
