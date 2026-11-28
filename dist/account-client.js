/* Platform-authenticated profile adapter. Never stores credentials or login flags. */
(function(root){'use strict';
 function create(options={}){
  const fetcher=options.fetch||root.fetch?.bind(root),where=options.location||root.location;let revision=null,context=null,conflicted=false;
  const offline=()=>where?.protocol==='file:';
  async function request(method,body){
   if(offline())throw Error('离线体验不提供平台账号资料服务；业务文件仍只在本机。');
   if(!fetcher)throw Error('账号资料服务不可用。');
   const writing=method==='PUT';
   if(root.navigator?.onLine===false)throw Error('网络无法联机，请恢复连接后重试。');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   try{
    let response;
    try{response=await fetcher('/api/account',{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json','X-Shenyi-Profile-Context':context||''}:{})},...(body?{body:JSON.stringify(body)}:{})});}
    catch(error){
     if(controller.signal.aborted||error?.name==='AbortError')throw error;
     if(root.navigator?.onLine===false)throw Error('网络无法联机，请恢复连接后重试。');
     throw Error(writing?'无法连接账号服务，未能确认是否已保存。请恢复网络并重新读取账号资料。':'无法连接账号服务，请检查网络后重试。');
    }
    if(response.status===401){revision=null;context=null;conflicted=false;return{status:'signed-out',account:null};}
    const {status}=response;
    if(status===409){revision=null;context=null;conflicted=true;}
    if(status>=500)throw Error('账号服务暂时异常（HTTP '+status+'），请稍后重新读取账号资料。');
    const json=response.headers.get('Content-Type')?.includes('application/json');
    let data;
    if(json){
     try{data=await response.json();}catch(error){if(controller.signal.aborted)throw error;throw Error('账号服务响应无法读取，请重新读取账号资料后核对。');}
    }
    if(!response.ok){
     const explanation=status===403?'当前账号没有修改此资料的权限，请重新登录核对。':status===409?'账号资料已被其他页面更新，请重新读取后再保存。':status===429?'账号服务请求过于频繁，请稍后重试。':'账号服务拒绝此次操作（HTTP '+status+'），请核对资料后重试。';
     throw Error(data?.error?.message||explanation);
    }
    if(!data)throw Error('账号服务尚未就绪，请稍后刷新设置页。');
    if(data.status!=='signed-in'||!data.account||typeof data.account.phone!=='string'||typeof data.account.displayName!=='string'||data.account.phoneVerified!==false||!Number.isSafeInteger(data.revision)||data.revision<0||data.authentication!=='platform'||data.phoneLoginEnabled!==false||! /^[a-f0-9]{64}$/.test(data.profileContext||''))throw Error('账号资料响应未通过校验，未采用此状态。');
    revision=data.revision;context=data.profileContext;if(method==='GET')conflicted=false;
    return{status:'signed-in',account:{phone:data.account.phone,displayName:data.account.displayName,phoneVerified:false},revision,storage:{profile:'server',business:'device-shared'}};
   }catch(error){if(controller.signal.aborted||error?.name==='AbortError')throw Error(writing?'账号保存请求超时，未能确认结果。请重新读取账号资料后再决定是否重试。':'账号资料读取超时，请检查网络后重试。');throw error;}
   finally{clearTimeout(timer);}
  }
  async function readAccountState(){
   if(offline())return{status:'unavailable',account:null,message:'离线体验无平台账号服务；不冒充手机号登录。'};
   try{return await request('GET');}catch(e){return{status:'unavailable',account:null,message:e.message};}
  }
  async function updateProfile(value){
   if(conflicted)throw Error('账号资料或平台账号已在其他页面改变。请点击重新读取账号状态，核对后再保存；未自动重试覆盖。');
   if(revision===null){const state=await readAccountState();if(state.status!=='signed-in')throw Error(state.message||'请先通过平台登录。');}
   const result=await request('PUT',{phone:value.phone,displayName:value.displayName,revision});
   if(result.status!=='signed-in')throw Error('平台登录已失效，请重新登录；未把本机资料当成登录凭证。');
   return result;
  }
  function adapter(callbacks={}){return{readAccountState,updateProfile,...(!offline()?{signInHref:'/signin-with-chatgpt?return_to=%2Findex.html',signOutHref:'/signout-with-chatgpt?return_to=%2Findex.html'}:{}),onOpenBackup:callbacks.onOpenBackup||(()=>{}),onHelp:callbacks.onHelp||(()=>{})};}
  return Object.freeze({readAccountState,updateProfile,adapter});
 }
 const client=create();root.AccountClient=Object.freeze({...client,create});
})(globalThis);
