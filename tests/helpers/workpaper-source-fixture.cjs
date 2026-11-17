'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID,randomBytes,createHash}=require('node:crypto');
const {fixture:packageFixture,codec}=require('./workpaper-package-fixture.cjs');
const {ClientError}=require('../../desktop/team-client.cjs');
const {createWorkpaperSourceManager}=require('../../desktop/workpaper-source.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex'),deferred=()=>Promise.withResolvers();
const PASSWORD='SyntheticWorkpaperPassword!',Q='11111111-1111-4111-8111-111111111111';
async function setup(t,{bytes:given,largeBytes=0,client:providedClient,target:providedTarget,sourceProjectId=Q}={}){
 const pack=await packageFixture({id:sourceProjectId,freeze:true});
 if(largeBytes){const raw=randomBytes(largeBytes),blob=new Blob([raw],{type:'application/octet-stream'});pack.record.supplementalWorkpapers[0].file={name:'synthetic-large.bin',mime:blob.type,size:raw.length,sha256:sha(raw),blob};}
 const made=await codec.create({record:pack.record,readCurrent:async()=>pack.record}),bytes=given??Buffer.from(made.bytes),base=process.env.SHENYI_TEST_TMPDIR??path.join(os.tmpdir(),'shenyi-workpaper-source');await fs.mkdir(base,{recursive:true});const directory=await fs.mkdtemp(path.join(base,'case-')),filename=path.join(directory,'synthetic-workpapers.zip');await fs.writeFile(filename,bytes);
 const target=providedTarget??{teamId:'team-a',projectId:'project-a',projectRevision:3,grantRevision:4},state={generation:0,callbacks:new Set(),calls:[],before:null,after:null,stage:null,parts:new Map(),receipt:null,denied:false,pickers:0,opens:0,reads:0,closes:0,closed:false,picker:null,stat:null,read:null};
 const error=status=>new ClientError('HTTP_'+status,'Synthetic response',status);
 const cap=()=>({...target,sourceProjectId:Q,chunkBytes:1048576,maxPackageBytes:codec.LIMITS.packageBytes});
 const stage=()=>state.stage?{stage:{...state.stage,receivedChunks:state.stage.status==='active'?[...state.parts.keys()].sort((a,b)=>a-b):[]},...(state.stage.status==='published'?{receipt:{...state.receipt}}:{})}:null;
 async function call(name,input,options,work,mutation=false){options?.assertCurrent?.();const record={name,input:{...input},dispatched:false};state.calls.push(record);await state.before?.(record);options?.assertCurrent?.();if(mutation){options?.onDispatch?.();record.dispatched=true;}await state.work?.(record);const value=await work();await state.after?.(record,value);options?.assertCurrent?.();return value;}
 const client=providedClient??{
  guardSession(){const at=state.generation;return()=>{if(at!==state.generation)throw new ClientError('SESSION_CHANGED','Synthetic changed');};},
  onProjectMigrationContextChange(callback){state.callbacks.add(callback);return()=>state.callbacks.delete(callback);},
  getWorkpaperImportCapabilities(input,o){return call('cap',input,o,()=>{if(state.denied||state.stage?.status==='published')throw error(404);return cap();});},
  beginWorkpaperImport(input,o){return call('begin',input,o,()=>{if(state.stage)throw error(409);state.stage={requestId:input.requestId,status:'active',byteLength:input.byteLength,chunkBytes:1048576,expiresAt:1794920000000,receivedChunks:[]};return{requestId:input.requestId,chunkBytes:1048576,expiresAt:state.stage.expiresAt};},true);},
  putWorkpaperImportChunk(input,o){return call('put',input,o,()=>{if(!state.stage||state.stage.status!=='active')throw error(409);const part=Buffer.from(input.data,'base64');if(sha(part)!==input.sha256)throw error(400);state.parts.set(input.chunkIndex,part);return{requestId:input.requestId,index:input.chunkIndex,received:true};},true);},
  getWorkpaperImportStatus(input,o){return call('status',input,o,()=>{if(!state.stage||state.stage.requestId!==input.requestId)throw error(404);return stage();});},
  cancelWorkpaperImport(input,o){return call('cancel',input,o,()=>{if(!state.stage)throw error(404);if(state.stage.status==='published')throw error(409);state.stage.status='canceled';state.parts.clear();return{canceled:true};},true);},
  commitWorkpaperImport(input,o){return call('commit',input,o,async()=>{if(input.currentPassword!==PASSWORD)throw error(403);if(!state.stage||state.stage.status!=='active')throw error(409);const parts=[...state.parts].sort((a,b)=>a[0]-b[0]).map(x=>x[1]),raw=Buffer.concat(parts);if(raw.length!==state.stage.byteLength)throw error(409);const parsed=await codec.inspect(raw);state.receipt={requestId:input.requestId,version:1,recordRevision:parsed.manifest.workspaceRevision,recordSha256:parsed.manifest.record.sha256,kind:'import',actorName:'Synthetic manager',committedAt:1794920000000,sourceProjectId:parsed.manifest.sourceProjectId,sourcePackageSha256:parsed.sha256};state.stage.status='published';state.parts.clear();return{...state.receipt};},true);}
 };
 const manager=createWorkpaperSourceManager({client,window:{isDestroyed:()=>state.closed},dialog:{async showOpenDialog(){state.pickers++;return state.picker?state.picker():{canceled:false,filePaths:[filename]};}},fsImpl:{async open(...args){state.opens++;const h=await fs.open(...args);return{async stat(){const s=await h.stat();return state.stat?state.stat(s):s;},async read(...args){state.reads++;return state.read?state.read(h,args):h.read(...args);},async close(){state.closes++;return h.close();}};}}});t.after(()=>manager.dispose());
 const choose=()=>manager.chooseWorkpaperSource(target),confirmation=s=>({...target,handle:s.handle,packageSha256:s.packageSha256,currentPassword:PASSWORD,sourceVerified:true,confirmed:true}),query=s=>({teamId:target.teamId,projectId:target.projectId,requestId:s.handle});
 const invalidate=()=>{state.generation++;for(const callback of state.callbacks)callback();};
 return{pack,made,bytes,filename,directory,target,state,client,manager,choose,confirmation,query,invalidate,error,stage};
}
module.exports={setup,sha,deferred,PASSWORD,Q,codec,ClientError,randomUUID};
