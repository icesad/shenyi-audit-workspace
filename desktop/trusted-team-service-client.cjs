'use strict';
// Main-process only. The deployment profile fixes both transport and database
// identity; no bearer, device lease or caller-provided address enters the probe.
const {addAbortListener}=require('node:events');
const {validateTrustedTeamService}=require('./team-service-config.cjs');
const METHODS='/api/auth/methods';
function createTrustedTeamServiceTransport({profile,fetchImpl,boundedBytes,error}){
  const trusted=validateTrustedTeamService(profile);
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED!==undefined&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='1')throw error('INVALID_SERVER','受信团队服务需要正常TLS证书校验。');
  const mismatch=()=>error('UNTRUSTED_SERVER','团队服务身份无法确认，请核对受信服务配置后重新登录。');
  function url(route){
    if(typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')||/[\\#\x00-\x20\x7f]/.test(route))throw mismatch();
    const value=trusted.apiBase+route;
    if(new URL(value).origin!==trusted.apiBase)throw mismatch();
    return value;
  }
  function responseIdentity(response,target){
    if(response?.redirected!==false||typeof response.url!=='string'||response.url!==target||response.headers?.get('X-Shenyi-Server-Id')!==trusted.serverId)throw mismatch();
  }
  function methodsIdentity(data){
    const value=data?.deviceBinding,keys=['required','serverId','protocolVersion'];
    if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key))||value.required!==true||typeof value.serverId!=='string'||value.serverId!==trusted.serverId||value.protocolVersion!==1)throw mismatch();
  }
  async function verifyProbe(check=()=>{},callerSignal){
    check();const target=url(METHODS),timeout=AbortSignal.timeout(15000);
    const signal=callerSignal?AbortSignal.any([timeout,callerSignal]):timeout;
    let response;
    try{
      response=await fetchImpl(target,{method:'GET',redirect:'error',cache:'no-store',signal,headers:{Origin:'shenyi://app'}});
      check();responseIdentity(response,target);
      if(!response.ok)throw mismatch();
      const bytes=await boundedBytes(response,1024*1024);check();
      let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw mismatch();}
      methodsIdentity(data);check();
    }finally{if(response?.body&&!response.bodyUsed)void response.body.cancel().catch(()=>{});}
  }
  let pendingProbe;
  async function probe(check=()=>{},callerSignal,scope){
    if(scope===undefined)return verifyProbe(check,callerSignal);
    check();callerSignal?.throwIfAborted();
    if(pendingProbe?.scope!==scope){
      // The public probe has its own deadline. No caller can abort it for others.
      const flight={scope,result:verifyProbe()};
      pendingProbe=flight;
      const clear=()=>{if(pendingProbe===flight)pendingProbe=undefined;};
      flight.result.then(clear,clear);
    }
    const {result}=pendingProbe;
    let subscription;
    try{
      if(!callerSignal)await result;
      else await Promise.race([result,new Promise((_,reject)=>{
        subscription=addAbortListener(callerSignal,()=>reject(callerSignal.reason));
      })]);
    }finally{
      subscription?.[Symbol.dispose]();
      check();callerSignal?.throwIfAborted();
    }
  }
  const wechatPolicy=trusted.schemaVersion===2?Object.freeze({
    appId:trusted.wechatAppId,
    redirectUri:url('/api/auth/wechat/callback'),
  }):undefined;
  return Object.freeze({url,responseIdentity,methodsIdentity,probe,wechatPolicy});
}
module.exports={createTrustedTeamServiceTransport};
