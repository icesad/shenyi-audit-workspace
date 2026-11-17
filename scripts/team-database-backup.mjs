#!/usr/bin/env node
// Offline synthetic backup/rehearsal only. No listener or online restore mode.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertOfflineBackupRuntime,createOfflineBackup,verifyOfflineBackup,rehearseOfflineRestore,OfflineBackupError} from '../server/team/offline-backup.mjs';
export function parseOfflineBackupArguments(args){
 if(!Array.isArray(args)||!args.length)throw new OfflineBackupError('INVALID_INPUT');
 const [command,...rest]=args,allowed=command==='create'?['--source','--output-root']:command==='verify'?['--bundle']:command==='rehearse'?['--bundle','--output-root']:null;
 if(!allowed||rest.length%2)throw new OfflineBackupError('INVALID_INPUT');const fields={};
 for(let i=0;i<rest.length;i+=2){const key=rest[i],value=rest[i+1];if(!allowed.includes(key)||Object.hasOwn(fields,key)||typeof value!=='string'||!value||value.startsWith('--'))throw new OfflineBackupError('INVALID_INPUT');fields[key]=value;}
 const required=command==='create'?'--source':'--bundle';if(!Object.hasOwn(fields,required))throw new OfflineBackupError('INVALID_INPUT');
 const options={...(command==='create'?{sourceDatabase:fields['--source']}:{bundleDirectory:fields['--bundle']}),...(fields['--output-root']!==undefined?{outputRoot:fields['--output-root']}:{})};return {command,options};
}
export async function runOfflineBackupCommand(args){
 assertOfflineBackupRuntime();const {command,options}=parseOfflineBackupArguments(args);
 if(command==='create'){
  let previousAt=0,reportedComplete=false;
  return createOfflineBackup({...options,onProgress(progress){
   const at=Date.now(),complete=progress.remainingPages===0;
   if(previousAt===0||at-previousAt>=1000||complete&&!reportedComplete){console.error(JSON.stringify({type:'progress',operation:'create',...progress,offlineOnly:true}));previousAt=at;if(complete)reportedComplete=true;}
  }});
 }
 return command==='verify'?verifyOfflineBackup(options):rehearseOfflineRestore(options);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runOfflineBackupCommand(process.argv.slice(2)).then(result=>console.log(JSON.stringify({ok:true,...result}))).catch(error=>{
  console.error(JSON.stringify({ok:false,code:error instanceof OfflineBackupError?error.code:'OFFLINE_OPERATION_FAILED',message:error instanceof OfflineBackupError?error.message:'离线操作未完成。',offlineOnly:true,onlineCutoverSupported:false}));process.exitCode=1;
 });
}
