#!/usr/bin/env node
// Offline backup and rehearsal for synthetic and managed databases.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertOfflineBackupRuntime,createOfflineBackup,verifyOfflineBackup,rehearseOfflineRestore,sealOfflineBackup,rehearseSealedOfflineRestore,createManagedSealedBackup,rehearseManagedSealedRestore,compareManagedSealedBackup,OfflineBackupError} from '../server/team/offline-backup.mjs';

const serverIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const commandOptions = new Map([
 ['create', {required:{'--source':'sourceDatabase'}, optional:{'--output-root':'outputRoot'}}],
 ['verify', {required:{'--bundle':'bundleDirectory'}}],
 ['rehearse', {required:{'--bundle':'bundleDirectory'}, optional:{'--output-root':'outputRoot'}}],
 ['seal', {required:{'--bundle':'bundleDirectory','--key-file':'keyFile'}, optional:{'--output-root':'outputRoot'}}],
 ['rehearse-sealed', {required:{'--bundle':'bundleDirectory','--key-file':'keyFile'}, optional:{'--output-root':'outputRoot'}}],
 ['create-managed-sealed', {required:{'--source':'sourceDatabase','--server-id':'serverId','--key-file':'keyFile','--output-root':'outputRoot'}}],
 ['rehearse-managed-sealed', {required:{'--bundle':'bundleDirectory','--server-id':'serverId','--key-file':'keyFile','--output-root':'outputRoot'}}],
 ['compare-managed-sealed', {required:{'--source':'sourceDatabase','--bundle':'bundleDirectory','--server-id':'serverId','--key-file':'keyFile'}}],
]);

export function parseOfflineBackupArguments(args){
 if(!Array.isArray(args)||!args.length)throw new OfflineBackupError('INVALID_INPUT');
 const [command,...rest]=args;
 const fields=commandOptions.get(command);
 if(!fields||rest.length%2)throw new OfflineBackupError('INVALID_INPUT');
 const allowed={...fields.required,...fields.optional},options={};
 for(let i=0;i<rest.length;i+=2){
  const [key,value]=rest.slice(i,i+2);
  if(typeof key!=='string'||!Object.hasOwn(allowed,key)||Object.hasOwn(options,allowed[key])||typeof value!=='string'||!value||value.startsWith('--'))throw new OfflineBackupError('INVALID_INPUT');
  options[allowed[key]]=value;
 }
 if(!Object.values(fields.required).every(key=>Object.hasOwn(options,key)))throw new OfflineBackupError('INVALID_INPUT');
 if(Object.hasOwn(options,'serverId')&&!serverIdPattern.test(options.serverId))throw new OfflineBackupError('INVALID_INPUT');
 return {command,options};
}
export async function runOfflineBackupCommand(args){
 assertOfflineBackupRuntime();const {command,options}=parseOfflineBackupArguments(args);
 if(command==='create'||command==='create-managed-sealed'){
  const create=command==='create'?createOfflineBackup:createManagedSealedBackup;
  let previousAt=0,reportedComplete=false;
  return create({...options,onProgress(progress){
   const at=Date.now(),complete=progress.remainingPages===0;
   if(previousAt===0||at-previousAt>=1000||complete&&!reportedComplete){console.error(JSON.stringify({type:'progress',operation:command,...progress,offlineOnly:true}));previousAt=at;if(complete)reportedComplete=true;}
  }});
 }
 if(command==='verify')return verifyOfflineBackup(options);
 if(command==='rehearse')return rehearseOfflineRestore(options);
 if(command==='seal')return sealOfflineBackup(options);
 if(command==='rehearse-managed-sealed')return rehearseManagedSealedRestore(options);
 if(command==='compare-managed-sealed')return compareManagedSealedBackup(options);
 return rehearseSealedOfflineRestore(options);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runOfflineBackupCommand(process.argv.slice(2)).then(result=>{
  console.log(JSON.stringify({ok:true,...result}));
  if(result.status==='different')process.exitCode=2;
 }).catch(error=>{
  console.error(JSON.stringify({ok:false,code:error instanceof OfflineBackupError?error.code:'OFFLINE_OPERATION_FAILED',message:error instanceof OfflineBackupError?error.message:'离线操作未完成。',offlineOnly:true,onlineCutoverSupported:false}));process.exitCode=1;
 });
}
