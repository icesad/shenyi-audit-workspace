'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const API_BASE='http://127.0.0.1:8774';
const MAX_CONFIGURATION_BYTES=16*1024;
const CONFIGURATION_KEYS=Object.freeze(['schemaVersion','apiBase','serverId']);

function invalid(){
  const error=new Error('团队服务配置无效，请联系管理员检查受信服务配置。');
  error.code='TEAM_SERVICE_CONFIGURATION_INVALID';
  return error;
}

function validateTrustedTeamService(value){
  try{
    if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)throw invalid();
    const keys=Reflect.ownKeys(value),fields=Object.getOwnPropertyDescriptors(value);
    if(keys.length!==CONFIGURATION_KEYS.length||keys.some(key=>typeof key!=='string'||!CONFIGURATION_KEYS.includes(key)))throw invalid();
    if(CONFIGURATION_KEYS.some(key=>!Object.hasOwn(fields,key)||!Object.hasOwn(fields[key],'value')||fields[key].enumerable!==true))throw invalid();
    const schemaVersion=fields.schemaVersion.value,apiBase=fields.apiBase.value,serverId=fields.serverId.value;
    if(schemaVersion!==1||typeof apiBase!=='string'||typeof serverId!=='string')throw invalid();
    if(!apiBase.isWellFormed()||/[\x00-\x20\x7f-\x9f\\]/.test(apiBase))throw invalid();
    const url=new URL(apiBase);
    if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(apiBase===url.origin||apiBase===url.origin+'/'))throw invalid();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(serverId))throw invalid();
    return Object.freeze({schemaVersion:1,apiBase:url.origin,serverId});
  }catch{throw invalid();}
}

function environmentValue(env,key){
  if(!Object.hasOwn(env,key))return {present:false};
  const field=Object.getOwnPropertyDescriptor(env,key);
  if(!field||!Object.hasOwn(field,'value')||typeof field.value!=='string'||field.value==='')throw invalid();
  return {present:true,value:field.value};
}

// JSON.parse validates the syntax; this also refuses ambiguous duplicate root keys.
function parseConfiguration(text){
  const value=JSON.parse(text),keys=new Set();let depth=0;
  for(let i=0;i<text.length;i++){
    if(text[i]==='{'||text[i]==='['){depth++;continue;}
    if(text[i]==='}'||text[i]===']'){depth--;continue;}
    if(text[i]!=='"')continue;
    const start=i;
    while(++i<text.length){if(text[i]==='\\'){i++;continue;}if(text[i]==='"')break;}
    if(depth!==1)continue;
    let next=i+1;while(next<text.length&&/\s/.test(text[next]))next++;
    if(text[next]!==':')continue;
    const key=JSON.parse(text.slice(start,i+1));
    if(keys.has(key))throw invalid();keys.add(key);
  }
  return value;
}

async function readConfiguration(filename){
  const file=await fs.open(filename,'r');
  try{
    const stat=await file.stat();
    if(!stat.isFile()||stat.size>MAX_CONFIGURATION_BYTES)throw invalid();
    const bytes=Buffer.alloc(MAX_CONFIGURATION_BYTES+1);let length=0;
    while(length<bytes.length){const {bytesRead}=await file.read(bytes,length,bytes.length-length,null);if(bytesRead===0)break;length+=bytesRead;}
    if(length>MAX_CONFIGURATION_BYTES)throw invalid();
    return validateTrustedTeamService(parseConfiguration(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length))));
  }finally{await file.close();}
}

async function loadTeamServiceConfiguration({env=process.env,isPackaged=false}={}){
  try{
    if(!env||typeof env!=='object'||typeof isPackaged!=='boolean')throw invalid();
    const config=environmentValue(env,'SHENYI_TEAM_SERVICE_CONFIG'),compatibility=environmentValue(env,'SHENYI_TEAM_API');
    if(!config.present){
      if(isPackaged||(compatibility.present&&compatibility.value!==API_BASE))throw invalid();
      return Object.freeze({mode:'local-preview',profile:null});
    }
    if(!config.value.isWellFormed()||/[\x00-\x1f\x7f]/.test(config.value)||!path.isAbsolute(config.value)||/^[\\/]{2}/.test(config.value))throw invalid();
    if(process.platform==='win32'&&!/^[a-zA-Z]:[\\/]/.test(config.value))throw invalid();
    const tls=environmentValue(env,'NODE_TLS_REJECT_UNAUTHORIZED');
    if(tls.present&&tls.value!=='1')throw invalid();
    const profile=await readConfiguration(config.value);
    if(compatibility.present&&compatibility.value!==profile.apiBase)throw invalid();
    return Object.freeze({mode:'remote-https',profile});
  }catch{throw invalid();}
}

module.exports={API_BASE,validateTrustedTeamService,loadTeamServiceConfiguration};
