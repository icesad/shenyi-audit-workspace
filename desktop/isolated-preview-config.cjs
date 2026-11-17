'use strict';
// Unpackaged synthetic previews only; production HTTPS validation stays separate.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{constants}=require('node:fs'),{randomUUID}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KIND='shenyi-isolated-preview-v1',ROOT_MARKER=JSON.stringify({schemaVersion:1,kind:'shenyi-isolated-preview-root'})+'\n',MAX=4096;
function invalid(){const e=new Error('独立合成预览配置无效；未连接原团队预览或生产服务。');e.code='ISOLATED_PREVIEW_CONFIGURATION_INVALID';return e;}
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype)throw invalid();const ds=Object.getOwnPropertyDescriptors(v),names=Reflect.ownKeys(ds);if(names.length!==keys.length||keys.some(k=>!Object.hasOwn(ds,k)||!Object.hasOwn(ds[k],'value')||!ds[k].enumerable)||names.some(k=>typeof k!=='string'||!keys.includes(k)))throw invalid();return ds;}
function validateIsolatedPreviewProfile(v){
 try{const d=exact(v,['schemaVersion','apiBase','serverId']),schemaVersion=d.schemaVersion.value,apiBase=d.apiBase.value,serverId=d.serverId.value;if(schemaVersion!==1||typeof apiBase!=='string'||typeof serverId!=='string'||!UUID.test(serverId))throw invalid();const m=/^http:\/\/127\.0\.0\.1:([1-9]\d{3,4})$/.exec(apiBase);if(!m||Number(m[1])<1024||Number(m[1])>65535||[8773,8774].includes(Number(m[1]))||new URL(apiBase).origin!==apiBase)throw invalid();return Object.freeze({schemaVersion:1,apiBase,serverId});}catch{throw invalid();}
}
function defaultIsolatedPreviewRoot({platform=process.platform,home=os.homedir()}={}){
 if(platform==='win32')return path.win32.resolve('D:/codex-temp/shenyi-team-isolated-preview');
 if(platform==='darwin'&&typeof home==='string'&&home.startsWith('/')&&!home.startsWith('//')&&home.isWellFormed()&&!/[\x00-\x1f\x7f\\]/.test(home)&&!home.split('/').some(p=>p==='.'||p==='..'))return path.posix.join(home,'Library','Application Support','ShenyiIsolatedTeamPreview');
 throw invalid();
}
function absolute(v){if(typeof v!=='string'||!v||!v.isWellFormed()||/[\x00-\x1f\x7f]/.test(v)||!path.isAbsolute(v)||/^[\\/]{2}/.test(v)||v.split(/[\\/]/).some(p=>p==='.'||p==='..'))throw invalid();return path.resolve(v);}
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
async function noLinks(directory,allowMissing=false){
 const full=absolute(directory),parsed=path.parse(full);let at=parsed.root;
 for(const part of full.slice(parsed.root.length).split(path.sep).filter(Boolean)){
  at=path.join(at,part);let entry;try{entry=await fs.lstat(at);}catch(e){if(e.code==='ENOENT'&&allowMissing)return;throw invalid();}
  if(!entry.isDirectory()||entry.isSymbolicLink()||!samePath(await fs.realpath(at),at))throw invalid();
 }
}
async function readRegular(filename){
 let h;try{const entry=await fs.lstat(filename,{bigint:true});if(!entry.isFile()||entry.isSymbolicLink()||entry.size<1n||entry.size>BigInt(MAX))throw invalid();h=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const before=await h.stat({bigint:true});if(!before.isFile()||before.dev!==entry.dev||before.ino!==entry.ino||before.size>BigInt(MAX))throw invalid();const bytes=Buffer.alloc(MAX+1);let n=0;while(n<bytes.length){const {bytesRead}=await h.read(bytes,n,bytes.length-n,null);if(!bytesRead)break;n+=bytesRead;}const after=await h.stat({bigint:true}),current=await fs.lstat(filename,{bigint:true});if(n>MAX||BigInt(n)!==before.size||after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs||after.dev!==before.dev||after.ino!==before.ino||current.dev!==before.dev||current.ino!==before.ino||current.isSymbolicLink())throw invalid();if(n>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)throw invalid();return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,n));}catch{throw invalid();}finally{await h?.close();}
}
async function rootIdentity(root){await noLinks(root);if(await readRegular(path.join(root,'isolated-preview-root.json'))!==ROOT_MARKER)throw invalid();}
function paths(directory,candidateId){return Object.freeze({directory,candidateId,desktopDataDirectory:path.join(directory,'desktop-data'),deviceVaultDirectory:path.join(directory,'device-vault'),configFile:path.join(directory,'candidate.json')});}
async function prepareIsolatedPreviewDirectory({rootDirectory}={}){
 const root=absolute(rootDirectory??defaultIsolatedPreviewRoot());await noLinks(root,true);let exists=true;try{await fs.lstat(root);}catch(e){if(e.code!=='ENOENT')throw invalid();exists=false;}
 if(!exists){await fs.mkdir(root,{recursive:true,mode:0o700});await noLinks(root);await fs.writeFile(path.join(root,'isolated-preview-root.json'),ROOT_MARKER,{flag:'wx',mode:0o600});}
 await rootIdentity(root);const candidateId=randomUUID(),directory=path.join(root,'candidate-'+candidateId);await fs.mkdir(directory,{mode:0o700});await noLinks(directory);return paths(directory,candidateId);
}
async function writeIsolatedPreviewConfiguration({directory,candidateId,apiBase,serverId}={}){
 directory=absolute(directory);if(typeof candidateId!=='string'||!UUID.test(candidateId)||path.basename(directory)!=='candidate-'+candidateId)throw invalid();await rootIdentity(path.dirname(directory));await noLinks(directory);const profile=validateIsolatedPreviewProfile({schemaVersion:1,apiBase,serverId}),value={schemaVersion:1,kind:KIND,candidateId,...profile},p=paths(directory,candidateId);let h;
 try{h=await fs.open(p.configFile,'wx',0o600);await h.writeFile(JSON.stringify(value)+'\n','utf8');await h.sync();}finally{await h?.close();}return Object.freeze({...p,profile});
}
function field(env,name){if(!Object.hasOwn(env,name))return undefined;const d=Object.getOwnPropertyDescriptor(env,name);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string'||!d.value)throw invalid();return d.value;}
async function loadIsolatedPreviewConfiguration({env=process.env,isPackaged=false,rootDirectory}={}){
 try{
  if(!env||typeof env!=='object'||typeof isPackaged!=='boolean')throw invalid();const raw=field(env,'SHENYI_ISOLATED_PREVIEW_CONFIG');if(raw===undefined)return null;
  if(isPackaged||['SHENYI_TEAM_API','SHENYI_TEAM_SERVICE_CONFIG','SHENYI_TEAM_REVIEW_DEMO'].some(k=>Object.hasOwn(env,k)))throw invalid();
  if(Object.hasOwn(env,'NODE_TLS_REJECT_UNAUTHORIZED')&&field(env,'NODE_TLS_REJECT_UNAUTHORIZED')!=='1')throw invalid();
  const root=absolute(rootDirectory??defaultIsolatedPreviewRoot()),filename=absolute(raw);if(filename!==raw||path.basename(filename)!=='candidate.json')throw invalid();
  const directory=path.dirname(filename),candidateId=path.basename(directory).slice('candidate-'.length);if(!samePath(path.dirname(directory),root)||path.basename(directory)!=='candidate-'+candidateId||!UUID.test(candidateId))throw invalid();
  const p=paths(directory,candidateId);if(field(env,'SHENYI_DESKTOP_DATA_DIR')!==p.desktopDataDirectory)throw invalid();await rootIdentity(root);await noLinks(directory);await noLinks(p.desktopDataDirectory,true);await noLinks(p.deviceVaultDirectory,true);
  const text=await readRegular(filename),v=JSON.parse(text);exact(v,['schemaVersion','kind','candidateId','apiBase','serverId']);if(v.kind!==KIND||v.candidateId!==candidateId)throw invalid();const profile=validateIsolatedPreviewProfile({schemaVersion:v.schemaVersion,apiBase:v.apiBase,serverId:v.serverId});
  if(text!==JSON.stringify({schemaVersion:1,kind:KIND,candidateId,...profile})+'\n')throw invalid();return Object.freeze({...p,profile});
 }catch{throw invalid();}
}
module.exports={defaultIsolatedPreviewRoot,validateIsolatedPreviewProfile,prepareIsolatedPreviewDirectory,writeIsolatedPreviewConfiguration,loadIsolatedPreviewConfiguration};
