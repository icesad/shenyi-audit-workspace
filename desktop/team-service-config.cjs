'use strict';
const fs=require('node:fs/promises');
const {constants}=require('node:fs');
const path=require('node:path');
const {isIP}=require('node:net');
const API_BASE='http://127.0.0.1:8774';
const MAX_CONFIGURATION_BYTES=16*1024;
const CONFIGURATION_KEYS=Object.freeze(['schemaVersion','apiBase','serverId']);
const WECHAT_CONFIGURATION_KEYS=Object.freeze([...CONFIGURATION_KEYS,'wechatAppId']);
const MAC_MANAGED_PARENTS=Object.freeze(['/','/Library','/Library/Application Support']);
const MAC_MANAGED_DIRECTORY='/Library/Application Support/ShenyiTeamDesktop';
const MAC_MANAGED_FILE=MAC_MANAGED_DIRECTORY+'/team-service.json';
const MAC_MANAGED_TLS_OVERRIDES=Object.freeze(['NODE_EXTRA_CA_CERTS','NODE_OPTIONS','SSL_CERT_FILE','SSL_CERT_DIR','OPENSSL_CONF','OPENSSL_MODULES']);

function invalid(){
  const error=new Error('团队服务配置无效，请联系管理员检查受信服务配置。');
  error.code='TEAM_SERVICE_CONFIGURATION_INVALID';
  return error;
}

function validateTrustedTeamService(value){
  try{
    if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)throw invalid();
    const keys=Reflect.ownKeys(value),fields=Object.getOwnPropertyDescriptors(value);
    const schemaVersion=fields.schemaVersion?.value;
    if(schemaVersion!==1&&schemaVersion!==2)throw invalid();
    const expected=schemaVersion===2?WECHAT_CONFIGURATION_KEYS:CONFIGURATION_KEYS;
    if(keys.length!==expected.length||expected.some(key=>!Object.hasOwn(fields,key)||!Object.hasOwn(fields[key],'value')||fields[key].enumerable!==true))throw invalid();
    const apiBase=fields.apiBase.value,serverId=fields.serverId.value;
    if(typeof apiBase!=='string'||typeof serverId!=='string')throw invalid();
    if(!apiBase.isWellFormed()||/[\x00-\x20\x7f-\x9f\\]/.test(apiBase))throw invalid();
    const url=new URL(apiBase);
    if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(apiBase===url.origin||apiBase===url.origin+'/'))throw invalid();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(serverId))throw invalid();
    const profile={schemaVersion,apiBase:url.origin,serverId};
    if(schemaVersion===2){
      const wechatAppId=fields.wechatAppId.value;
      if(typeof wechatAppId!=='string'||!/^wx[A-Za-z0-9]{16}$/.test(wechatAppId)||
        url.port||isIP(url.hostname)||url.hostname.length>253||!url.hostname.includes('.')||
        !url.hostname.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))throw invalid();
      profile.wechatAppId=wechatAppId;
    }
    return Object.freeze(profile);
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

async function configurationFromFile(file){
  const bytes=Buffer.alloc(MAX_CONFIGURATION_BYTES+1);let length=0;
  while(length<bytes.length){const {bytesRead}=await file.read(bytes,length,bytes.length-length,null);if(bytesRead===0)break;length+=bytesRead;}
  if(length>MAX_CONFIGURATION_BYTES)throw invalid();
  return validateTrustedTeamService(parseConfiguration(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length))));
}

async function readConfiguration(filename){
  const file=await fs.open(filename,'r');
  try{
    const stat=await file.stat();
    if(!stat.isFile()||stat.size>MAX_CONFIGURATION_BYTES)throw invalid();
    return await configurationFromFile(file);
  }finally{await file.close();}
}

async function requireMacPathReadOnly(filename){
  try { await fs.access(filename,constants.W_OK); }
  catch(error){
    if(['EACCES','EPERM','EROFS'].includes(error.code))return;
    throw error;
  }
  throw invalid();
}

async function macProtectedEntry(filename,kind,allowMissing=false){
  let stat;
  try{stat=await fs.lstat(filename,{bigint:true});}
  catch(error){if(allowMissing&&error.code==='ENOENT')return null;throw error;}
  const type=kind==='file'?stat.isFile():stat.isDirectory();
  if(!type||stat.uid!==0n||await fs.realpath(filename)!==filename||(stat.mode&0o002n)!==0n)throw invalid();
  // macOS uses group 0 for wheel and group 80 for admin. System parents may
  // be maintained by those groups. The client account must still lack write access.
  if((stat.mode&0o020n)!==0n&&(kind!=='system-directory'||![0n,80n].includes(stat.gid)))throw invalid();
  if(kind==='file'&&(stat.nlink!==1n||stat.size<=0n||stat.size>BigInt(MAX_CONFIGURATION_BYTES)))throw invalid();
  await requireMacPathReadOnly(filename);
  return stat;
}

function sameMacEntry(before,after,includeContent=false){
  const keys=['dev','ino','mode','uid','gid'];
  if(includeContent)keys.push('nlink','size','mtimeNs','ctimeNs');
  return keys.every(key=>before[key]===after[key]);
}

async function readMacManagedConfiguration(){
  const parents=[];
  for(const name of MAC_MANAGED_PARENTS)parents.push(await macProtectedEntry(name,'system-directory'));
  const managed=await macProtectedEntry(MAC_MANAGED_DIRECTORY,'application-directory',true);
  let profile=null;
  if(managed){
    const listed=await macProtectedEntry(MAC_MANAGED_FILE,'file');
    const file=await fs.open(MAC_MANAGED_FILE,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
      if(!sameMacEntry(listed,await file.stat({bigint:true}),true))throw invalid();
      profile=await configurationFromFile(file);
      if(!sameMacEntry(listed,await file.stat({bigint:true}),true)||
        !sameMacEntry(listed,await macProtectedEntry(MAC_MANAGED_FILE,'file'),true))throw invalid();
    }finally{await file.close();}
  }
  const latest=await macProtectedEntry(MAC_MANAGED_DIRECTORY,'application-directory',!managed);
  if(managed?!sameMacEntry(managed,latest):latest!==null)throw invalid();
  for(const [index,name] of MAC_MANAGED_PARENTS.entries()){
    if(!sameMacEntry(parents[index],await macProtectedEntry(name,'system-directory')))throw invalid();
  }
  return profile;
}

async function loadTeamServiceConfiguration({env=process.env,isPackaged=false}={}){
  try{
    if(!env||typeof env!=='object'||typeof isPackaged!=='boolean')throw invalid();
    const compatibility=environmentValue(env,'SHENYI_TEAM_API');
    const packagedMac=isPackaged&&process.platform==='darwin';
    const managed=packagedMac?await readMacManagedConfiguration():null;
    if(managed){
      const tls=environmentValue(env,'NODE_TLS_REJECT_UNAUTHORIZED');
      if((tls.present&&tls.value!=='1')||MAC_MANAGED_TLS_OVERRIDES.some(key=>Object.hasOwn(env,key))||
        (compatibility.present&&compatibility.value!==managed.apiBase))throw invalid();
      return Object.freeze({mode:'remote-https',profile:managed});
    }
    const config=environmentValue(env,'SHENYI_TEAM_SERVICE_CONFIG');
    if(!config.present){
      if(isPackaged||(compatibility.present&&compatibility.value!==API_BASE))throw invalid();
      return Object.freeze({mode:'local-preview',profile:null});
    }
    if(!config.value.isWellFormed()||/[\x00-\x1f\x7f]/.test(config.value)||!path.isAbsolute(config.value)||/^[\\/]{2}/.test(config.value))throw invalid();
    if(process.platform==='win32'&&!/^[a-zA-Z]:[\\/]/.test(config.value))throw invalid();
    const tls=environmentValue(env,'NODE_TLS_REJECT_UNAUTHORIZED');
    if(tls.present&&tls.value!=='1')throw invalid();
    const profile=await readConfiguration(config.value);
    if((compatibility.present&&compatibility.value!==profile.apiBase)||(packagedMac&&await readMacManagedConfiguration()))throw invalid();
    return Object.freeze({mode:'remote-https',profile});
  }catch{throw invalid();}
}

module.exports={API_BASE,validateTrustedTeamService,loadTeamServiceConfiguration};
