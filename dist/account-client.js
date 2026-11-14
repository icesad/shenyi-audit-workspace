/* Platform-authenticated profile adapter. Never stores credentials or login flags. */
(function(root){'use strict';
 function create(options={}){
  const fetcher=options.fetch||root.fetch?.bind(root),where=options.location||root.location;let revision=null,context=null,conflicted=false;
  const offline=()=>where?.protocol==='file:';
  async function request(method,body){
   if(offline())throw Error('离线体验不提供平台账号资料服务；业务文件仍只在本机。');
   if(!fetcher)throw Error('账号资料服务不可用。');
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
   try{
    const response=await fetcher('/api/account',{method,credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json','X-Shenyi-Profile-Context':context||''}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(response.status===401){revision=null;context=null;conflicted=false;return{status:'signed-out',account:null};}
    if(!response.headers.get('Content-Type')?.includes('application/json'))throw Error('账号服务尚未就绪，请稍后刷新设置页。');
    const data=await response.json();
    if(!response.ok){if(response.status===409){revision=null;context=null;conflicted=true;}throw Error(data.error?.message||'账号资料操作失败，请稍后重试。');}
    if(data.status!=='signed-in'||!data.account||typeof data.account.phone!=='string'||typeof data.account.displayName!=='string'||data.account.phoneVerified!==false||!Number.isSafeInteger(data.revision)||data.revision<0||data.authentication!=='platform'||data.phoneLoginEnabled!==false||! /^[a-f0-9]{64}$/.test(data.profileContext||''))throw Error('账号资料响应未通过校验，未采用此状态。');
    revision=data.revision;context=data.profileContext;if(method==='GET')conflicted=false;
    return{status:'signed-in',account:{phone:data.account.phone,displayName:data.account.displayName,phoneVerified:false},revision,storage:{profile:'server',business:'device-shared'}};
   }catch(e){if(e?.name==='AbortError')throw Error('账号资料读取超时，请重试；原业务资料未改变。');throw e;}
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
