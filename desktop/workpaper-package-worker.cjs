'use strict';
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const codec=require('../dist/workpaper-package.js');
const TIMEOUT_MS=120000;
function wipe(bytes){try{bytes?.fill(0);}catch{}}

if(!isMainThread){
 void(async()=>{
  const bytes=workerData?.bytes;
  try{
   if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>codec.LIMITS.packageBytes)throw Error('Invalid bytes');
   const value=await codec.inspect(bytes),summary={sourceProjectId:value.manifest.sourceProjectId,workspaceRevision:value.manifest.workspaceRevision,recordSha256:value.manifest.record.sha256,packageSha256:value.sha256,byteLength:bytes.length,originalCount:value.summary.originalCount,originalBytes:value.summary.originalBytes,freezeCount:value.summary.freezeCount};
   parentPort.postMessage({ok:true,summary,bytes},[bytes.buffer]);
  }catch{wipe(bytes);parentPort.postMessage({ok:false});}
  finally{parentPort.close();}
 })();
}

// Transfer ownership, rather than copying a potentially large source again.
// The byte buffer is private to this main-process manager and this worker.
function inspectWorkpaperPackage(bytes,{signal,assertCurrent=()=>{}}={}){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>codec.LIMITS.packageBytes||bytes.byteOffset!==0||bytes.byteLength!==bytes.buffer.byteLength||typeof assertCurrent!=='function')return Promise.reject(Error('Invalid source buffer'));
 return new Promise((resolve,reject)=>{
  let worker,timer,done=false;
  const finish=async(error,result)=>{
   if(done){wipe(result?.bytes);return;}done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   try{await worker?.terminate();}catch{}
   if(!error)try{assertCurrent();}catch(cause){error=cause;}
   if(error){wipe(result?.bytes);reject(error);}else resolve(result);
  };
  const abort=()=>{void finish(Error('Workpaper package inspection canceled'));};
  try{
   assertCurrent();if(signal?.aborted)throw Error('Canceled');
   worker=new Worker(__filename,{workerData:{bytes},transferList:[bytes.buffer],resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:32,stackSizeMb:4}});
   worker.once('message',value=>{if(!value?.ok||!(value.bytes instanceof Uint8Array))void finish(Error('Workpaper package invalid'));else void finish(null,value);});
   worker.once('error',()=>{void finish(Error('Workpaper package worker failed'));});
   worker.once('exit',()=>{if(!done)void finish(Error('Workpaper package worker exited'));});
   timer=setTimeout(()=>{void finish(Error('Workpaper package inspection timed out'));},TIMEOUT_MS);
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  }catch(error){void finish(error);}
 });
}
module.exports={inspectWorkpaperPackage,TIMEOUT_MS};
