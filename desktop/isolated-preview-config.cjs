'use strict';
// Unpackaged synthetic previews only; production HTTPS validation stays separate.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{constants}=require('node:fs'),{randomUUID,X509Certificate}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const KIND='shenyi-isolated-preview-v1',ROOT_MARKER=JSON.stringify({schemaVersion:1,kind:'shenyi-isolated-preview-root'})+'\n',MAX=4096;
const OWNER_REVIEW_RUNTIME_MARKER='{"schemaVersion":1,"kind":"shenyi-owner-review-windows-x64"}\n';
const APP_ROOT=path.resolve(__dirname,'..');
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
  if(!entry.isDirectory()||entry.isSymbolicLink())throw invalid();
 }
}
async function readRegular(filename,{singleLink=false}={}){
 let h;try{const entry=await fs.lstat(filename,{bigint:true});if(!entry.isFile()||entry.isSymbolicLink()||entry.size<1n||entry.size>BigInt(MAX)||singleLink&&entry.nlink!==1n)throw invalid();h=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const before=await h.stat({bigint:true});if(!before.isFile()||before.dev!==entry.dev||before.ino!==entry.ino||before.size>BigInt(MAX)||singleLink&&before.nlink!==1n)throw invalid();const bytes=Buffer.alloc(MAX+1);let n=0;while(n<bytes.length){const {bytesRead}=await h.read(bytes,n,bytes.length-n,null);if(!bytesRead)break;n+=bytesRead;}const after=await h.stat({bigint:true}),current=await fs.lstat(filename,{bigint:true});if(n>MAX||BigInt(n)!==before.size||after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs||after.dev!==before.dev||after.ino!==before.ino||current.dev!==before.dev||current.ino!==before.ino||current.isSymbolicLink()||singleLink&&(after.nlink!==1n||current.nlink!==1n))throw invalid();if(n>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)throw invalid();return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,n));}catch{throw invalid();}finally{await h?.close();}
}
async function loadOwnerReviewRuntime({appRoot=APP_ROOT,platform=process.platform,arch=process.arch}={}){
 try{
  const root=absolute(appRoot),marker=path.join(root,'owner-review-runtime.json');
  try{await fs.lstat(marker);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(platform!=='win32'||arch!=='x64')throw invalid();
  await noLinks(root);if(await readRegular(marker,{singleLink:true})!==OWNER_REVIEW_RUNTIME_MARKER)throw invalid();
  const electronExecutable=path.join(root,'runtime','electron','electron.exe');await noLinks(path.dirname(electronExecutable));
  const executable=await fs.lstat(electronExecutable,{bigint:true});
  if(!executable.isFile()||executable.isSymbolicLink()||executable.nlink!==1n)throw invalid();
  return Object.freeze({appRoot:root,rootDirectory:path.join(root,'review-runs'),electronExecutable});
 }catch{throw invalid();}
}
async function rootIdentity(root){
 // Retiring the publisher's temporary hard link changes ctime once. Retry the
 // complete strict read; profiles and the owner-review marker are never retried.
 for(let attempt=0;attempt<2;attempt++){
  try{await noLinks(root);if(await readRegular(path.join(root,'isolated-preview-root.json'))!==ROOT_MARKER)throw invalid();return;}
  catch(error){if(attempt===1)throw error;}
 }
}
async function initializeOwnerReviewRoot(root){
 await noLinks(root,true);await fs.mkdir(root,{recursive:true,mode:0o700});await noLinks(root);
 const marker=path.join(root,'isolated-preview-root.json');
 try{await fs.lstat(marker);await rootIdentity(root);return;}catch(e){if(e.code!=='ENOENT')throw e;}
 const names=await fs.readdir(root);
 if(names.includes('isolated-preview-root.json')){await rootIdentity(root);return;}
 if(names.some(name=>!/^\.isolated-preview-root-[a-f0-9-]{36}\.pending$/.test(name))){
  // Directory enumeration may span another launch publishing its marker and
  // candidate. Only a now-present, strictly valid marker can explain that case.
  await rootIdentity(root);return;
 }
 // Publish complete bytes without overwriting another first launch's marker.
 const temporary=path.join(root,'.isolated-preview-root-'+randomUUID()+'.pending');let handle,identity;
 try{
  handle=await fs.open(temporary,'wx',0o600);identity=await handle.stat({bigint:true});await handle.writeFile(ROOT_MARKER,'utf8');await handle.sync();await handle.close();handle=undefined;
  try{await fs.link(temporary,marker);}catch(e){if(e.code!=='EEXIST')throw e;}
  await rootIdentity(root);
 }finally{
  await handle?.close();
  if(identity){try{const current=await fs.lstat(temporary,{bigint:true});if(current.dev===identity.dev&&current.ino===identity.ino)await fs.unlink(temporary);}catch(e){if(e.code!=='ENOENT')throw e;}}
 }
}
function paths(directory,candidateId){return Object.freeze({directory,candidateId,desktopDataDirectory:path.join(directory,'desktop-data'),deviceVaultDirectory:path.join(directory,'device-vault'),configFile:path.join(directory,'candidate.json')});}
async function prepareIsolatedPreviewDirectory({rootDirectory,appRoot}={}){
 const portable=await loadOwnerReviewRuntime({appRoot});
 if(portable&&rootDirectory!==undefined&&!samePath(absolute(rootDirectory),portable.rootDirectory))throw invalid();
 const root=absolute(portable?.rootDirectory??rootDirectory??defaultIsolatedPreviewRoot());
 if(portable)await initializeOwnerReviewRoot(root);
 else{await noLinks(root,true);let exists=true;try{await fs.lstat(root);}catch(e){if(e.code!=='ENOENT')throw invalid();exists=false;}
 if(!exists){await fs.mkdir(root,{recursive:true,mode:0o700});await noLinks(root);await fs.writeFile(path.join(root,'isolated-preview-root.json'),ROOT_MARKER,{flag:'wx',mode:0o600});}}
 await rootIdentity(root);const candidateId=randomUUID(),directory=path.join(root,'candidate-'+candidateId);await fs.mkdir(directory,{mode:0o700});await noLinks(directory);return paths(directory,candidateId);
}
async function writeIsolatedPreviewConfiguration({directory,candidateId,apiBase,serverId}={}){
 directory=absolute(directory);if(typeof candidateId!=='string'||!UUID.test(candidateId)||path.basename(directory)!=='candidate-'+candidateId)throw invalid();await rootIdentity(path.dirname(directory));await noLinks(directory);const profile=validateIsolatedPreviewProfile({schemaVersion:1,apiBase,serverId}),value={schemaVersion:1,kind:KIND,candidateId,...profile},p=paths(directory,candidateId);let h;
 try{h=await fs.open(p.configFile,'wx',0o600);await h.writeFile(JSON.stringify(value)+'\n','utf8');await h.sync();}finally{await h?.close();}return Object.freeze({...p,profile});
}
function field(env,name){if(!Object.hasOwn(env,name))return undefined;const d=Object.getOwnPropertyDescriptor(env,name);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='string'||!d.value)throw invalid();return d.value;}
async function loadIsolatedPreviewConfiguration({env=process.env,isPackaged=false,rootDirectory,appRoot}={}){
 try{
  if(!env||typeof env!=='object'||typeof isPackaged!=='boolean')throw invalid();const raw=field(env,'SHENYI_ISOLATED_PREVIEW_CONFIG');
  if(isPackaged){if(raw!==undefined)throw invalid();return null;}
  const portable=await loadOwnerReviewRuntime({appRoot});
  if(raw===undefined){if(portable)throw invalid();return null;}
  if(isPackaged||['SHENYI_TEAM_API','SHENYI_TEAM_SERVICE_CONFIG','SHENYI_TEAM_REVIEW_DEMO'].some(k=>Object.hasOwn(env,k)))throw invalid();
  if(Object.hasOwn(env,'NODE_TLS_REJECT_UNAUTHORIZED')&&field(env,'NODE_TLS_REJECT_UNAUTHORIZED')!=='1')throw invalid();
  if(portable&&rootDirectory!==undefined&&!samePath(absolute(rootDirectory),portable.rootDirectory))throw invalid();
  const root=absolute(portable?.rootDirectory??rootDirectory??defaultIsolatedPreviewRoot()),filename=absolute(raw);if(filename!==raw||path.basename(filename)!=='candidate.json')throw invalid();
  const directory=path.dirname(filename),candidateId=path.basename(directory).slice('candidate-'.length);if(!samePath(path.dirname(directory),root)||path.basename(directory)!=='candidate-'+candidateId||!UUID.test(candidateId))throw invalid();
  const p=paths(directory,candidateId);if(field(env,'SHENYI_DESKTOP_DATA_DIR')!==p.desktopDataDirectory)throw invalid();await rootIdentity(root);await noLinks(directory);await noLinks(p.desktopDataDirectory,true);await noLinks(p.deviceVaultDirectory,true);
  const text=await readRegular(filename),v=JSON.parse(text);exact(v,['schemaVersion','kind','candidateId','apiBase','serverId']);if(v.kind!==KIND||v.candidateId!==candidateId)throw invalid();const profile=validateIsolatedPreviewProfile({schemaVersion:v.schemaVersion,apiBase:v.apiBase,serverId:v.serverId});
  if(text!==JSON.stringify({schemaVersion:1,kind:KIND,candidateId,...profile})+'\n')throw invalid();return Object.freeze({...p,profile});
 }catch{throw invalid();}
}
async function loadOwnerReviewManagedPilotConfiguration({env=process.env,isPackaged=false,platform=process.platform,arch=process.arch,userDataDirectory,profile,appRoot}={}){
 try{
  if(!env||typeof env!=='object')throw invalid();
  const flag='SHENYI_OWNER_REVIEW_MANAGED_PILOT';if(!Object.hasOwn(env,flag))return null;
  if(field(env,flag)!=='1'||isPackaged!==false||platform!=='win32'||arch!=='x64')throw invalid();
  for(const name of ['SHENYI_ISOLATED_PREVIEW_CONFIG','SHENYI_TEAM_API','SHENYI_TEAM_REVIEW_DEMO','SHENYI_OWNER_REVIEW_WEBSITE_CHECKOUT','SHENYI_TEAM_BILLING_DEMO','SHENYI_TEAM_PILOT_DEMO'])if(Object.hasOwn(env,name))throw invalid();
  if(Object.hasOwn(env,'NODE_TLS_REJECT_UNAUTHORIZED')&&field(env,'NODE_TLS_REJECT_UNAUTHORIZED')!=='1')throw invalid();
  for(const name of ['NODE_OPTIONS','SSL_CERT_FILE','SSL_CERT_DIR','OPENSSL_CONF','OPENSSL_MODULES','NODE_USE_SYSTEM_CA','NODE_USE_ENV_PROXY','ELECTRON_DISABLE_SANDBOX'])if(Object.hasOwn(env,name))throw invalid();
  if(process.argv.some(value=>/^--(?:ignore-certificate-errors(?:-spki-list)?|allow-insecure-localhost|disable-web-security|no-sandbox|disable-setuid-sandbox)(?:=|$)/.test(value)))throw invalid();
  const portable=await loadOwnerReviewRuntime({appRoot,platform,arch});if(!portable)throw invalid();
  const ownedPath=value=>{const full=absolute(value);if(!/^[A-Za-z]:[\\/]/.test(value)||value.slice(3).split(/[\\/]/).some(part=>/[:*?"<>|]|[. ]$|^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part)))throw invalid();return full;};
  const filename=ownedPath(field(env,'SHENYI_TEAM_SERVICE_CONFIG')),directory=path.dirname(filename),name=path.basename(directory),candidateId=name.slice('candidate-'.length),root=path.dirname(directory);
  const inside=(parent,child)=>{const relative=path.relative(parent,child);return !path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
  if(path.basename(filename)!=='managed-pilot-service.json'||name!=='candidate-'+candidateId||!UUID.test(candidateId)||path.basename(root)!=='ShenyiManagedPilotReview'||inside(portable.appRoot,directory)||inside(APP_ROOT,directory))throw invalid();
  await noLinks(root);await noLinks(directory);
  if(await readRegular(path.join(root,'managed-pilot-review-root.json'),{singleLink:true})!=='{"schemaVersion":1,"kind":"shenyi-managed-pilot-review-root"}\n')throw invalid();
  const descriptor=exact(profile,['schemaVersion','apiBase','serverId']),apiBase=descriptor.apiBase.value,serverId=descriptor.serverId.value,match=typeof apiBase==='string'&&/^https:\/\/127\.0\.0\.1:([1-9]\d{3,4})$/.exec(apiBase);
  if(descriptor.schemaVersion.value!==1||typeof serverId!=='string'||!UUID.test(serverId)||!match||Number(match[1])<1024||Number(match[1])>65535||[8773,8774].includes(Number(match[1]))||new URL(apiBase).origin!==apiBase)throw invalid();
  const trusted=Object.freeze({schemaVersion:1,apiBase,serverId}),configText=await readRegular(filename,{singleLink:true});if(configText!==JSON.stringify(trusted)+'\n')throw invalid();
  const desktopDataDirectory=path.join(directory,'desktop-data'),localAppDataDirectory=path.join(directory,'local-app-data'),roamingAppDataDirectory=path.join(directory,'roaming-app-data'),temporaryDirectory=path.join(directory,'temp');
  const deviceVaultDirectory=path.join(localAppDataDirectory,'ShenyiTeamPreview','device-vault'),caFile=path.join(directory,'managed-pilot-ca.pem'),databasePath=path.join(directory,'managed-owner','team.sqlite'),originalFile=path.join(directory,'managed-pilot-original.txt');
  for(const [variable,expected]of [['SHENYI_DESKTOP_DATA_DIR',desktopDataDirectory],['LOCALAPPDATA',localAppDataDirectory],['APPDATA',roamingAppDataDirectory],['TEMP',temporaryDirectory],['TMP',temporaryDirectory],['TMPDIR',temporaryDirectory],['NODE_EXTRA_CA_CERTS',caFile]])if(!samePath(ownedPath(field(env,variable)),expected))throw invalid();
  if(!samePath(ownedPath(userDataDirectory),desktopDataDirectory))throw invalid();
  for(const required of [desktopDataDirectory,localAppDataDirectory,roamingAppDataDirectory,temporaryDirectory,path.dirname(databasePath)])await noLinks(required);
  await noLinks(deviceVaultDirectory,true);
  const receiptText=await readRegular(path.join(directory,'started.json'),{singleLink:true}),receipt=JSON.parse(receiptText);
  exact(receipt,['schemaVersion','kind','candidateId','directory','databasePath','apiBase','serverId','desktopDataDirectory','deviceVaultDirectory','configFile','caFile','originalFile','originalBytes','originalSha256','tlsFingerprint256','tlsExpiresAt','launcherPid','startedAt','syntheticOnly','initialUsers','initialTeams','initialSeatGrants','externalSms','wechat','billingSimulation']);
  if(receiptText!==JSON.stringify(receipt,null,2)+'\n'||receipt.schemaVersion!==1||receipt.kind!=='shenyi-owner-review-managed-pilot-started'||receipt.candidateId!==candidateId||receipt.apiBase!==apiBase||receipt.serverId!==serverId||receipt.syntheticOnly!==true||receipt.initialUsers!==1||receipt.initialTeams!==0||receipt.initialSeatGrants!==0||receipt.externalSms!==false||receipt.wechat!==false||receipt.billingSimulation!==false||receipt.originalBytes!==2048||typeof receipt.originalSha256!=='string'||!/^[a-f0-9]{64}$/.test(receipt.originalSha256)||typeof receipt.tlsFingerprint256!=='string'||!/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(receipt.tlsFingerprint256)||!Number.isSafeInteger(receipt.launcherPid)||receipt.launcherPid<1||!Number.isSafeInteger(receipt.tlsExpiresAt))throw invalid();
  for(const [key,expected]of Object.entries({directory,databasePath,desktopDataDirectory,deviceVaultDirectory,configFile:filename,caFile,originalFile}))if(!samePath(ownedPath(receipt[key]),expected))throw invalid();
  const pem=await readRegular(caFile,{singleLink:true});if(!/^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----(?:\r?\n)?$/.test(pem))throw invalid();
  const ca=new X509Certificate(pem),at=Date.now(),startsAt=ca.validFromDate.getTime(),endsAt=ca.validToDate.getTime(),startedAt=typeof receipt.startedAt==='string'?Date.parse(receipt.startedAt):NaN;
  if(ca.ca!==true||ca.subject!==ca.issuer||!ca.verify(ca.publicKey)||ca.publicKey.asymmetricKeyType!=='ec'||ca.publicKey.asymmetricKeyDetails?.namedCurve!=='prime256v1'||ca.subjectAltName!==undefined||ca.keyUsage!==undefined||!Number.isFinite(startsAt)||!Number.isFinite(endsAt)||startsAt>at||endsAt<=at||endsAt-startsAt>8*60*60*1000+2*60*1000||endsAt<=startsAt||receipt.tlsExpiresAt!==endsAt||!Number.isFinite(startedAt)||new Date(startedAt).toISOString()!==receipt.startedAt||startedAt<startsAt||startedAt>at+60000)throw invalid();
  await noLinks(directory);await noLinks(deviceVaultDirectory,true);
  return Object.freeze({kind:'shenyi-owner-review-managed-pilot-v1',candidateId,directory,configFile:filename,caFile,databasePath,originalFile,desktopDataDirectory,deviceVaultDirectory,localAppDataDirectory,roamingAppDataDirectory,temporaryDirectory,profile:trusted});
 }catch{throw invalid();}
}
module.exports={OWNER_REVIEW_RUNTIME_MARKER,loadOwnerReviewRuntime,defaultIsolatedPreviewRoot,validateIsolatedPreviewProfile,prepareIsolatedPreviewDirectory,writeIsolatedPreviewConfiguration,loadIsolatedPreviewConfiguration,loadOwnerReviewManagedPilotConfiguration};
