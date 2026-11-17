'use strict';
const {validateIsolatedPreviewProfile}=require('./isolated-preview-config.cjs');
// Private opt-in transport for an unpackaged synthetic loopback preview.
function createIsolatedPreviewTransport({profile,fetchImpl,boundedBytes,error}){
 let fixed;try{fixed=validateIsolatedPreviewProfile(profile);if(process.versions.electron&&require('electron').app?.isPackaged!==false)throw Error();}catch{throw error('INVALID_SERVER','独立合成预览仅支持未打包的受限本机配置。');}
 const mismatch=()=>error('UNTRUSTED_SERVER','独立合成预览身份无法确认，请重新启动该候选环境。');
 function url(route){if(typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')||/[\\#\x00-\x20\x7f]/.test(route))throw mismatch();const part=route.split('?')[0],target=fixed.apiBase+route,parsed=new URL(target);if(part.includes('%')||parsed.origin!==fixed.apiBase||parsed.pathname!==part)throw mismatch();return target;}
 function responseIdentity(response,target){if(response?.redirected!==false||typeof response.url!=='string'||response.url!==target||response.headers?.get('X-Shenyi-Server-Id')!==fixed.serverId)throw mismatch();}
 function methodsIdentity(data){const pd=data&&typeof data==='object'?Object.getOwnPropertyDescriptor(data,'deviceBinding'):null,v=pd&&Object.hasOwn(pd,'value')?pd.value:null,keys=['required','serverId','protocolVersion'];if(!v||Object.getPrototypeOf(v)!==Object.prototype)throw mismatch();const ds=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(ds).length!==keys.length||keys.some(k=>!Object.hasOwn(ds,k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable)||ds.required.value!==true||ds.serverId.value!==fixed.serverId||ds.protocolVersion.value!==1)throw mismatch();}
 async function probe(check=()=>{},callerSignal){
  check();const target=url('/api/auth/methods'),timeout=AbortSignal.timeout(15000),signal=callerSignal?AbortSignal.any([timeout,callerSignal]):timeout;let response;
  try{response=await fetchImpl(target,{method:'GET',redirect:'error',cache:'no-store',signal,headers:{Origin:'shenyi://app'}});check();responseIdentity(response,target);if(!response.ok)throw mismatch();const bytes=await boundedBytes(response,1024*1024);check();let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw mismatch();}methodsIdentity(data);check();}
  finally{if(response?.body&&!response.bodyUsed)void response.body.cancel().catch(()=>{});}
 }
 return Object.freeze({url,responseIdentity,methodsIdentity,probe});
}
module.exports={createIsolatedPreviewTransport};
