/* Local foreground operation time. No business fields, input contents or network requests. */
(function(root){'use strict';
 const DB='hengdu.project.activity.v1',STORE='totals',TRIAL='00000000-0000-4000-8000-000000000033',IDLE_MS=5*60*1000,CHECKPOINT_MS=10000;
 function normalize(value){return typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)&&value.toLowerCase()!==TRIAL&&value!==root.AuditChecklist?.TRIAL_ID?value.toLowerCase():'';}
 function id(value){const result=normalize(value);if(!result)throw Error('请先选择正式项目；独立试用不计入项目操作时间。');return result;}
 function validTotal(value){return Number.isSafeInteger(value)&&value>=0;}
 function row(value,projectId){if(value===undefined)return{schemaVersion:1,projectId,totalMs:0};if(!value||value.schemaVersion!==1||value.projectId!==projectId||!validTotal(value.totalMs))throw Error('项目操作时间记录格式异常，原记录未覆盖。');return value;}
 function database(){return new Promise((resolve,reject)=>{let done=false,q;const fail=error=>{if(!done){done=true;reject(error);}};try{q=root.indexedDB.open(DB,1);}catch{fail(Error('浏览器不允许保存项目操作时间。'));return;}
  q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains(STORE))q.result.createObjectStore(STORE,{keyPath:'projectId'});};
  q.onblocked=()=>fail(Error('项目操作时间库被旧页面占用，请关闭旧页后重试。'));q.onerror=()=>fail(Error('项目操作时间库无法打开，时间暂未保存。'));
  q.onsuccess=()=>{if(done){q.result.close();return;}done=true;resolve(q.result);};
 });}
 async function read(projectId){projectId=id(projectId);const db=await database();try{return await new Promise((resolve,reject)=>{let total,error;const tx=db.transaction(STORE),q=tx.objectStore(STORE).get(projectId);q.onsuccess=()=>{try{total=row(q.result,projectId).totalMs;}catch(e){error=e;tx.abort();}};tx.oncomplete=()=>resolve({totalMs:total});tx.onabort=()=>reject(error||Error('读取项目操作时间失败，原记录未改变。'));});}finally{db.close();}}
 async function add(projectId,deltaMs){projectId=id(projectId);if(!Number.isSafeInteger(deltaMs)||deltaMs<=0)throw Error('项目操作时长增量无效。');const db=await database();try{return await new Promise((resolve,reject)=>{let total,error;const tx=db.transaction(STORE,'readwrite'),st=tx.objectStore(STORE),q=st.get(projectId);q.onsuccess=()=>{try{const before=row(q.result,projectId);total=before.totalMs+deltaMs;if(!validTotal(total))throw Error('项目操作时间超出范围，原记录未覆盖。');st.put({schemaVersion:1,projectId,totalMs:total,updatedAt:new Date().toISOString()});}catch(e){error=e;tx.abort();}};tx.oncomplete=()=>resolve(total);tx.onabort=()=>reject(error||Error('项目操作时间保存失败；待保存时间保留在本页，请勿关闭并稍后重试。'));});}finally{db.close();}}
 function format(ms){if(!Number.isFinite(ms)||ms<0)throw Error('操作时间无效');if(ms===0)return'0分钟';if(ms<60000)return'不足1分钟';const minutes=Math.floor(ms/60000),hours=Math.floor(minutes/60);return hours?hours+'小时 '+minutes%60+'分钟':minutes+'分钟';}
 /* Monotonic deterministic clock. take() emits integer deltas, retaining fractional milliseconds. */
 function createClock({idleMs=IDLE_MS}={}){if(!Number.isFinite(idleMs)||idleMs<=0)throw Error('闲置时间配置无效');let cursor=0,initialized=false,projectId='',foreground=false,deadline=-Infinity;const pending=new Map();
  function step(now,context={}){if(!Number.isFinite(now)||now<0)throw Error('操作时钟无效');if(initialized)now=Math.max(cursor,now);else initialized=true;
   if(projectId&&foreground&&cursor<deadline){const delta=Math.max(0,Math.min(now,deadline)-cursor);if(delta)pending.set(projectId,(pending.get(projectId)||0)+delta);}
   cursor=now;if(Object.hasOwn(context,'projectId'))projectId=normalize(context.projectId);if(Object.hasOwn(context,'foreground'))foreground=!!context.foreground;if(context.activity)deadline=now+idleMs;
  }
  function take(){const out=[];for(const [key,value]of pending){const whole=Math.floor(value);if(whole){out.push({projectId:key,deltaMs:whole});const rest=value-whole;if(rest)pending.set(key,rest);else pending.delete(key);}}return out;}
  return Object.freeze({step,take});
 }
 let mounted=null;
 function mount({resolveProject,now=()=>root.performance.now(),getForeground=()=>root.document.visibilityState==='visible'&&root.document.hasFocus()}={}){
  if(typeof resolveProject!=='function'||typeof now!=='function'||typeof getForeground!=='function')throw Error('项目操作计时组件配置无效');
  if(mounted)void mounted.stop().catch(()=>{});
  const D=root.document,clock=createClock(),pending=new Map();let stopped=false,running=null,microtask=false,suspended=false,activeProject='',wasForeground=false;
  function emit(detail){try{root.dispatchEvent(new root.CustomEvent('project-activity-updated',{detail}));}catch{}}
  function collect(){for(const {projectId,deltaMs}of clock.take())pending.set(projectId,(pending.get(projectId)||0)+deltaMs);}
  function context(activity=false){let projectId='',foreground=false;try{projectId=normalize(resolveProject());foreground=!suspended&&!!getForeground();}catch(e){emit({projectId:'',error:e.message||'无法识别当前项目，已暂停计时。'});}const changed=projectId!==activeProject||foreground!==wasForeground;clock.step(now(),{projectId,foreground,activity:activity&&foreground});collect();activeProject=projectId;wasForeground=foreground;return changed;}
  function pump(){if(running)return running;if(!pending.size)return Promise.resolve();running=(async()=>{while(pending.size){const [projectId,deltaMs]=pending.entries().next().value;pending.delete(projectId);try{const totalMs=await add(projectId,deltaMs);emit({projectId,totalMs});}catch(e){pending.set(projectId,(pending.get(projectId)||0)+deltaMs);emit({projectId,error:e.message||'项目操作时间未保存，请稍后重试。'});throw e;}}})().finally(()=>{running=null;});return running;}
  function flush(){if(!stopped)context();else collect();return pump();}
  function refreshContext(){if(stopped)return pump();context();return pump();}
  function quietFlush(){void flush().catch(()=>{});}
  function activity(){if(stopped||microtask)return;microtask=true;root.queueMicrotask(()=>{microtask=false;if(stopped)return;if(context(true))void pump().catch(()=>{});});}
  function foregroundChanged(){if(stopped)return;context();void pump().catch(()=>{});}
  function pagehide(){if(stopped)return;suspended=true;clock.step(now(),{foreground:false,projectId:''});collect();void pump().catch(()=>{});}
  function pageshow(){if(stopped)return;suspended=false;foregroundChanged();}
  const activityEvents=['pointerdown','keydown','input','change','wheel'];for(const name of activityEvents)D.addEventListener(name,activity,{capture:true,passive:true});
  D.addEventListener('visibilitychange',foregroundChanged);root.addEventListener('focus',foregroundChanged);root.addEventListener('blur',foregroundChanged);root.addEventListener('pagehide',pagehide);root.addEventListener('pageshow',pageshow);
  const timer=root.setInterval(quietFlush,CHECKPOINT_MS);
  function stop(){if(!stopped){clock.step(now(),{foreground:false,projectId:''});collect();stopped=true;root.clearInterval(timer);for(const name of activityEvents)D.removeEventListener(name,activity,true);D.removeEventListener('visibilitychange',foregroundChanged);root.removeEventListener('focus',foregroundChanged);root.removeEventListener('blur',foregroundChanged);root.removeEventListener('pagehide',pagehide);root.removeEventListener('pageshow',pageshow);if(mounted===controller)mounted=null;}return pump();}
  const controller=Object.freeze({refreshContext,flush,stop});mounted=controller;context();return controller;
 }
 root.ProjectActivity=Object.freeze({read,format,mount,createClock});
})(globalThis);
