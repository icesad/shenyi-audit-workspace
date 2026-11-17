import {Worker} from 'node:worker_threads';
export function inspectWorkpaperOriginal(task,{signal}={}){
 if(signal?.aborted)return Promise.reject(new DOMException('Canceled','AbortError'));
 return new Promise((resolve,reject)=>{let worker,timer,done=false;const finish=(error,form)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(worker)void worker.terminate();error?reject(error):resolve(form);},abort=()=>finish(new DOMException('Canceled','AbortError'));
  try{signal?.addEventListener('abort',abort,{once:true});worker=new Worker(new URL('./workpaper-office-worker.mjs',import.meta.url),{workerData:task,resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32,stackSizeMb:4}});worker.once('message',result=>result?.error||!result?.form?finish(Error('Original form admission failed')):finish(null,result.form));worker.once('error',()=>finish(Error('Original form worker failed')));worker.once('exit',()=>{if(!done)finish(Error('Original form worker exited'));});timer=setTimeout(()=>finish(Error('Original form admission timed out')),45000);if(signal?.aborted)abort();}catch(error){finish(error);}
 });
}