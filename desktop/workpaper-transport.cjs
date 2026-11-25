'use strict';
const {createHash}=require('node:crypto');
const EXPORT_MAX_BYTES=532*1024*1024,HASH=/^[a-f0-9]{64}$/;
const matches=(re,v)=>typeof v==='string'&&re.exec(v)?.[0]===v;
function workpaperHooks(value,failure){
 const ds=value&&Object.getPrototypeOf(value)===Object.prototype?Object.getOwnPropertyDescriptors(value):null,keys=ds?Reflect.ownKeys(ds):[],allowed=['kind','assertCurrent','signal','onHeaders','onChunk'];
 const bad=()=>{throw failure('INVALID_INPUT','底稿请求上下文无效。');};
 if(!ds||keys.some(k=>typeof k!=='string'||!allowed.includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))bad();
 const v=Object.fromEntries(keys.map(k=>[k,ds[k].value]));if(!['json','record','original','form','export'].includes(v.kind)||typeof v.assertCurrent!=='function'||v.signal!==undefined&&!(v.signal instanceof AbortSignal))bad();
 if(v.kind==='export'){if(typeof v.onHeaders!=='function'||typeof v.onChunk!=='function')bad();}
 else if(Object.hasOwn(v,'onHeaders')||Object.hasOwn(v,'onChunk'))bad();return Object.freeze(v);
}
function workpaperExportTransportValid(route,{method,binary,body}){
 const id='[A-Za-z0-9][A-Za-z0-9_-]{0,127}',re=new RegExp('^/api/teams/'+id+'/projects/'+id+'/workpapers/export\\?version=[1-9]\\d*&projectRevision=[1-9]\\d*&grantRevision=[1-9]\\d*$');
 return method==='GET'&&binary===true&&body===undefined&&matches(re,route);
}
// Budget only already-qualified workpaper operations; ordinary control routes
// retain the existing15s cap. The Office worker itself may need45s.
function workpaperTimeoutMilliseconds(route,{kind,method='GET'}={}){
 const id='[A-Za-z0-9][A-Za-z0-9_-]{0,127}',hash='[a-f0-9]{64}',uuid='[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',base='/api/teams/'+id+'/projects/'+id+'/workpapers',version='\\?version=[1-9]\\d*&projectRevision=[1-9]\\d*&grantRevision=[1-9]\\d*';
 if(kind==='export'&&workpaperExportTransportValid(route,{method,binary:true}))return 1800000;
 const suffix={record:'/record',original:'/originals/'+hash,form:'/forms/'+hash}[kind];
 if(method==='GET'&&suffix&&matches(new RegExp('^'+base+suffix+version+'$'),route))return 90000;
 if(method==='POST'&&kind==='json'&&matches(new RegExp('^'+base+'/entries/'+hash+'$'),route))return 90000;
 if(method==='POST'&&kind==='json'&&matches(new RegExp('^'+base+'/imports/'+uuid+'/commit$'),route))return 180000;
 return 15000;
}
function workpaperBinaryMetadata(response){const get=k=>response.headers.get(k);return{contentType:get('content-type'),contentLength:get('content-length'),cacheControl:get('cache-control'),contentDisposition:get('content-disposition'),nosniff:get('x-content-type-options'),version:get('x-shenyi-workpaper-version'),recordRevision:get('x-shenyi-workpaper-record-revision'),recordSha256:get('x-shenyi-workpaper-record-sha256'),sourceProjectId:get('x-shenyi-workpaper-source-project-id'),projectRevision:get('x-shenyi-project-revision'),grantRevision:get('x-shenyi-workpaper-grant-revision'),originalSha256:get('x-shenyi-workpaper-original-sha256'),sha256:get('x-shenyi-workpaper-export-sha256')};}
async function abortable(work,signal,failure){
 let remove;if(signal.aborted)throw failure('WORKPAPER_CANCELED','本次底稿保存已停止。');
 const aborted=new Promise((_,reject)=>{const stop=()=>reject(failure('WORKPAPER_CANCELED','本次底稿保存已停止。'));signal.addEventListener('abort',stop,{once:true});remove=()=>signal.removeEventListener('abort',stop);});
 try{return await Promise.race([Promise.resolve().then(work),aborted]);}finally{remove?.();}
}
async function streamedWorkpaperExport(response,{check,signal,onHeaders,onChunk},failure){
 const bad=()=>{throw failure('INVALID_RESPONSE','底稿导出响应未通过完整性核验，未发布文件。');},meta=workpaperBinaryMetadata(response),length=Number(meta.contentLength),cache=meta.cacheControl?.toLowerCase().split(',').map(x=>x.trim());
 let reader,complete=false,size=0;const digest=createHash('sha256');
 const current=()=>{check();if(signal.aborted)throw failure('WORKPAPER_CANCELED','本次底稿保存已停止。');};
 const cancel=()=>{if(reader)void reader.cancel().catch(()=>{});else void response.body?.cancel().catch(()=>{});};
 signal.addEventListener('abort',cancel,{once:true});
 try{
  current();if(meta.contentType!=='application/zip'||!matches(/^[1-9]\d*$/,meta.contentLength)||!Number.isSafeInteger(length)||length>EXPORT_MAX_BYTES||!matches(HASH,meta.sha256)||meta.nosniff!=='nosniff'||!cache?.includes('private')||!cache.includes('no-store')||!response.body)bad();
  await onHeaders(Object.freeze({...meta,byteLength:length}));current();reader=response.body.getReader();
  for(;;){
   current();const part=await abortable(()=>reader.read(),signal,failure);current();
   if(part.done)break;if(!(part.value instanceof Uint8Array)||part.value.length>length-size)bad();
   // Bound each sink write even when a custom transport coalesces a large read.
   for(let at=0;at<part.value.length;at+=65536){current();const chunk=Uint8Array.from(part.value.subarray(at,at+65536));try{digest.update(chunk);await onChunk(chunk);current();size+=chunk.length;}finally{chunk.fill(0);}}
  }
  current();if(size!==length||digest.digest('hex')!==meta.sha256)bad();complete=true;return Object.freeze({...meta,byteLength:size});
 }finally{signal.removeEventListener('abort',cancel);if(!complete)cancel();}
}
module.exports={workpaperHooks,workpaperExportTransportValid,workpaperBinaryMetadata,streamedWorkpaperExport,workpaperTimeoutMilliseconds,EXPORT_MAX_BYTES};
