'use strict';
// Portable Windows owner-review checkout only. No production trust override.
const fs=require('node:fs/promises'),path=require('node:path'),{constants}=require('node:fs');
const {X509Certificate,createHash,randomUUID,timingSafeEqual}=require('node:crypto');
const {loadOwnerReviewRuntime}=require('./isolated-preview-config.cjs');
const {validateTrustedTeamService}=require('./team-service-config.cjs');
const FLAG='SHENYI_OWNER_REVIEW_WEBSITE_CHECKOUT',KIND='shenyi-owner-review-checkout-v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ROOT_MARKER='{"schemaVersion":1,"kind":"shenyi-isolated-preview-root"}\n';
const MAX_CERT_VALIDITY=8*60*60*1000+2*60*1000,MAX_FILE=16384;
const RESERVED_PREVIEW_PORTS=new Set([8773,8774,10139]);
const capabilities=new WeakMap();
const fail=()=>Object.assign(new Error('独立官网账务走查配置或窗口无法安全确认。'),{code:'OWNER_REVIEW_CHECKOUT_INVALID'});
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function isCheckoutLoopbackOrigin(origin){
 const match=/^https:\/\/127\.0\.0\.1:([1-9]\d{3,4})$/.exec(origin);
 const port=Number(match?.[1]);
 return port>=1024&&port<=65535&&!RESERVED_PREVIEW_PORTS.has(port);
}
function absolute(value){if(typeof value!=='string'||!value||!value.isWellFormed()||/[\x00-\x1f\x7f]/.test(value)||!path.isAbsolute(value)||/^[\\/]{2}/.test(value)||value.split(/[\\/]/).some(p=>p==='.'||p==='..'))throw fail();if(process.platform==='win32'&&(!/^[A-Za-z]:[\\/]/.test(value)||value.slice(3).split(/[\\/]/).some(p=>/[:*?"<>|]|[. ]$/.test(p))))throw fail();return path.resolve(value);}
function field(env,name){const d=Object.getOwnPropertyDescriptor(env,name);if(!d||!Object.hasOwn(d,'value')||!d.enumerable||typeof d.value!=='string'||!d.value)throw fail();return d.value;}
async function directories(directory,{missingLeaf=false}={}){const full=absolute(directory),root=path.parse(full).root;let at=root;const states=[];for(const part of full.slice(root.length).split(path.sep).filter(Boolean)){at=path.join(at,part);let info;try{info=await fs.lstat(at,{bigint:true});}catch(e){if(missingLeaf&&at===full&&e.code==='ENOENT')return states;throw fail();}if(!info.isDirectory()||info.isSymbolicLink())throw fail();states.push({filename:at,dev:info.dev,ino:info.ino,mode:info.mode});}return states;}
async function recheckDirectories(states){for(const old of states){const now=await fs.lstat(old.filename,{bigint:true});if(!now.isDirectory()||now.isSymbolicLink()||now.dev!==old.dev||now.ino!==old.ino||now.mode!==old.mode)throw fail();}}
async function readTrustedFile(filename){let h;try{const entry=await fs.lstat(filename,{bigint:true});if(!entry.isFile()||entry.isSymbolicLink()||entry.nlink!==1n||entry.size<1n||entry.size>BigInt(MAX_FILE)||!samePath(await fs.realpath(filename),filename))throw fail();h=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const before=await h.stat({bigint:true});const equal=s=>s.isFile()&&!s.isSymbolicLink()&&['dev','ino','size','nlink','mtimeNs','ctimeNs'].every(k=>s[k]===entry[k]);if(!equal(before))throw fail();const bytes=Buffer.alloc(MAX_FILE+1);let n=0;while(n<bytes.length){const part=await h.read(bytes,n,bytes.length-n,null);if(!part.bytesRead)break;n+=part.bytesRead;}if(BigInt(n)!==entry.size||n>MAX_FILE||!equal(await h.stat({bigint:true}))||!equal(await fs.lstat(filename,{bigint:true})))throw fail();if(n>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)throw fail();return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,n));}catch{throw fail();}finally{await h?.close();}}
function derItem(bytes,at=0){if(at<0||at+2>bytes.length)throw fail();const tag=bytes[at++];let length=bytes[at++];if(length&128){const count=length&127;if(!count||count>4||at+count>bytes.length||bytes[at]===0)throw fail();length=0;for(let i=0;i<count;i++)length=length*256+bytes[at++];if(length<128)throw fail();}if(at+length>bytes.length)throw fail();return {tag,body:bytes.subarray(at,at+length),end:at+length};}
function derChildren(bytes){const out=[];for(let at=0;at<bytes.length;){const item=derItem(bytes,at);out.push(item);at=item.end;}return out;}
function extensionValue(raw,oid){const outer=derItem(raw);if(outer.tag!==48||outer.end!==raw.length)throw fail();const tbs=derChildren(outer.body)[0];if(tbs.tag!==48)throw fail();const extensions=derChildren(tbs.body).filter(i=>i.tag===163);if(extensions.length!==1)throw fail();const sequence=derItem(extensions[0].body);if(sequence.tag!==48||sequence.end!==extensions[0].body.length)throw fail();const matches=derChildren(sequence.body).filter(extension=>{if(extension.tag!==48)throw fail();const entries=derChildren(extension.body);return entries[0]?.tag===6&&entries[0].body.equals(Buffer.from(oid));});if(matches.length!==1)throw fail();const entries=derChildren(matches[0].body),value=entries.at(-1);if(!((entries.length===2||entries.length===3&&entries[1].tag===1)&&value.tag===4))throw fail();return value.body;}
function parseCertificate(pem,at){if(typeof pem!=='string'||!/^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END CERTIFICATE-----(?:\r?\n)?$/.test(pem))throw fail();const cert=new X509Certificate(pem),startsAt=cert.validFromDate.getTime(),endsAt=cert.validToDate.getTime();if(!Number.isSafeInteger(at)||!Number.isFinite(startsAt)||!Number.isFinite(endsAt)||startsAt>at||endsAt<=at||endsAt-startsAt>MAX_CERT_VALIDITY||endsAt<=startsAt||cert.publicKey.asymmetricKeyType!=='ec'||cert.publicKey.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw fail();return {cert,startsAt,endsAt};}
function certificateFacts(pem,caPem,at){const {cert,startsAt,endsAt}=parseCertificate(pem,at),root=parseCertificate(caPem,at),ca=root.cert;
 // Check each ephemeral CA and leaf before applying either role's trust policy.
 if(ca.ca!==true||ca.subject!==ca.issuer||!ca.verify(ca.publicKey)||ca.subjectAltName!==undefined||ca.keyUsage!==undefined||!extensionValue(ca.raw,[85,29,19]).equals(Buffer.from([48,6,1,1,255,2,1,0]))||!extensionValue(ca.raw,[85,29,15]).equals(Buffer.from([3,2,2,4]))||root.startsAt!==startsAt||root.endsAt!==endsAt||cert.ca!==false||!extensionValue(cert.raw,[85,29,19]).equals(Buffer.from([48,0]))||cert.issuer!==ca.subject||!cert.checkIssued(ca)||!cert.verify(ca.publicKey)||cert.checkIP('127.0.0.1')!=='127.0.0.1'||cert.subjectAltName!=='IP Address:127.0.0.1'||!Array.isArray(cert.keyUsage)||cert.keyUsage.length!==1||cert.keyUsage[0]!=='1.3.6.1.5.5.7.3.1'||!extensionValue(cert.raw,[85,29,15]).equals(Buffer.from([3,2,7,128])))throw fail();
 return {raw:cert.raw,startsAt,endsAt,sha256:createHash('sha256').update(cert.raw).digest('hex'),keys:[cert.publicKey,ca.publicKey]};
}
async function loadOwnerReviewCheckoutConfiguration({env=process.env,isPackaged=false,platform=process.platform,arch=process.arch,userDataDirectory,profile,appRoot,now=Date.now}={}){
 if(!env||typeof env!=='object')throw fail();
 if(!Object.hasOwn(env,FLAG))return null;
 try{
  if(field(env,FLAG)!=='1'||isPackaged||platform!=='win32'||arch!=='x64'||Object.hasOwn(env,'SHENYI_ISOLATED_PREVIEW_CONFIG')||Object.hasOwn(env,'SHENYI_TEAM_API')||Object.hasOwn(env,'SHENYI_TEAM_REVIEW_DEMO')||Object.hasOwn(env,'NODE_TLS_REJECT_UNAUTHORIZED')&&field(env,'NODE_TLS_REJECT_UNAUTHORIZED')!=='1')throw fail();
  const portable=await loadOwnerReviewRuntime({...(appRoot===undefined?{}:{appRoot}),platform,arch});if(!portable)throw fail();
  const trusted=validateTrustedTeamService(profile);
  if(trusted.schemaVersion!==3||!isCheckoutLoopbackOrigin(trusted.apiBase)||!isCheckoutLoopbackOrigin(trusted.checkoutOrigin))throw fail();
  const filename=absolute(field(env,'SHENYI_TEAM_SERVICE_CONFIG')),directory=path.dirname(filename),name=path.basename(directory),candidateId=name.slice(10),root=absolute(portable.rootDirectory);
  if(path.basename(filename)!=='checkout-service.json'||name!=='candidate-'+candidateId||!UUID.test(candidateId)||!samePath(path.dirname(directory),root))throw fail();
  const desktopDataDirectory=path.join(directory,'desktop-data'),deviceVaultDirectory=path.join(directory,'device-vault'),certificateFile=path.join(directory,'checkout-tls.pem'),caFile=path.join(directory,'checkout-ca.pem');
  if(!samePath(absolute(field(env,'SHENYI_DESKTOP_DATA_DIR')),desktopDataDirectory)||!samePath(absolute(userDataDirectory),desktopDataDirectory)||!samePath(absolute(field(env,'NODE_EXTRA_CA_CERTS')),caFile))throw fail();
  const states=[...await directories(root),...await directories(directory),...await directories(desktopDataDirectory),...await directories(deviceVaultDirectory,{missingLeaf:true})];
  if(await readTrustedFile(path.join(root,'isolated-preview-root.json'))!==ROOT_MARKER)throw fail();
  const text=await readTrustedFile(filename),loaded=validateTrustedTeamService(JSON.parse(text));
  // Launcher publishes exact canonical bytes, so duplicate keys or alternate encodings cannot masquerade as the normally loaded profile.
  const canonical={schemaVersion:3,apiBase:trusted.apiBase,serverId:trusted.serverId,checkoutOrigin:trusted.checkoutOrigin};
  if(text!==JSON.stringify(canonical)+'\n'||JSON.stringify(loaded)!==JSON.stringify(canonical))throw fail();
  const at=now();
  const apiCertificate=certificateFacts(await readTrustedFile(certificateFile),await readTrustedFile(caFile),at);
  let certificate=apiCertificate;
  if(trusted.apiBase!==trusted.checkoutOrigin){
   certificate=certificateFacts(await readTrustedFile(path.join(directory,'storefront-tls.pem')),
     await readTrustedFile(path.join(directory,'storefront-ca.pem')),at);
   if(certificate.keys.some(key=>apiCertificate.keys.some(apiKey=>key.equals(apiKey))))throw fail();
  }
  await recheckDirectories(states);
  const context=Object.freeze({kind:KIND,candidateId,directory,desktopDataDirectory,deviceVaultDirectory,profile:trusted,certificateSha256:certificate.sha256,certificateValidFrom:certificate.startsAt,certificateValidTo:certificate.endsAt});capabilities.set(context,{certificate,now});return context;
 }catch{throw fail();}
}
const ASSET_PATHS=new Set(['/styles.css','/assets/brand-shenyi.png','/checkout/checkout.css','/checkout/checkout.js','/checkout/checkout-seats.js']);
const HOME_ANCHORS=new Set(['','#main','#top','#workflow','#subscription','#releases','#help']);
const API_PATHS=new Set(['/api/website-checkout/context','/api/website-checkout/orders','/api/website-checkout/seat-context','/api/website-checkout/seat-quote','/api/website-checkout/seat-orders']);
function createOwnerReviewCheckoutWindows({context,parent,BrowserWindow,session,setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout}={}){
 const authority=capabilities.get(context);if(!authority||!parent?.webContents||!BrowserWindow||!session)throw fail();const {certificate,now}=authority;let closed=false;const windows=new Set(),parentListeners=[];
 const current=()=>!closed&&!parent.isDestroyed?.()&&now()>=certificate.startsAt&&now()<certificate.endsAt;
 function closeAll(){if(closed)return;closed=true;clearTimeoutImpl(expiry);for(const close of [...windows])close();for(const [target,event,listener]of parentListeners)target.removeListener(event,listener);parentListeners.length=0;}
 function parentEvent(target,event){const listener=()=>closeAll();target.on(event,listener);parentListeners.push([target,event,listener]);}
 parentEvent(parent,'closed');parentEvent(parent.webContents,'destroyed');parentEvent(parent.webContents,'render-process-gone');
 const expiry=setTimeoutImpl(closeAll,Math.max(1,certificate.endsAt-now()));expiry?.unref?.();
 async function open(raw){
  if(!current())throw fail();let target;try{if(typeof raw!=='string')throw fail();target=new URL(raw);const code=/^#handoff=([A-Za-z0-9_-]{43})$/.exec(target.hash);if(target.origin!==context.profile.checkoutOrigin||target.username||target.password||target.search||!['/checkout/','/checkout/seats/'].includes(target.pathname)||!code||Buffer.from(code[1],'base64url').length!==32||Buffer.from(code[1],'base64url').toString('base64url')!==code[1]||target.href!==raw||raw!==target.origin+target.pathname+target.hash)throw fail();}catch{throw fail();}
  const pagePath=target.pathname,title=pagePath==='/checkout/seats/'?'审易 · 官网席位走查（合成）':'审易 · 官网年费走查（合成）',isolated=session.fromPartition('shenyi-owner-checkout-'+randomUUID(),{cache:false});
  let ended=false,departed=false,startupTimer,rejectStartup;const listeners=[];
  const listen=(object,event,handler)=>{object.on(event,handler);listeners.push([object,event,handler]);};
  const win=new BrowserWindow({parent,show:false,width:1160,height:900,minWidth:760,minHeight:640,title,backgroundColor:'#f5f6f2',autoHideMenuBar:true,webPreferences:{session:isolated,nodeIntegration:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:false}});
  // Use the foreground state before the checkout window loses its native focus.
  listen(win,'close',event=>{
    if(event.defaultPrevented||!current()||!win.isFocused()||!parent.isVisible()||parent.isMinimized()||!parent.isEnabled())return;
    parent.focus();
  });
  function finish(){if(ended)return;ended=true;clearTimeoutImpl(startupTimer);rejectStartup?.(fail());rejectStartup=null;windows.delete(close);for(const [object,event,handler]of listeners)object.removeListener(event,handler);listeners.length=0;isolated.webRequest.onBeforeRequest((_details,callback)=>callback({cancel:true}));isolated.setCertificateVerifyProc((_details,callback)=>callback(-2));isolated.removeListener('will-download',blockDownload);void Promise.resolve(isolated.closeAllConnections?.()).catch(()=>{});void Promise.resolve(isolated.clearStorageData?.()).catch(()=>{});}
  function close(){if(ended)return;try{win.hide();if(!win.isDestroyed())win.destroy();}finally{finish();}}
  function blockDownload(event){event.preventDefault();}
  windows.add(close);
  isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));isolated.setPermissionCheckHandler(()=>false);isolated.setDevicePermissionHandler?.(()=>false);isolated.on('will-download',blockDownload);
  isolated.setCertificateVerifyProc((request,callback)=>{try{const actual=new X509Certificate(request.certificate?.data);callback(!ended&&current()&&request.hostname==='127.0.0.1'&&actual.raw.length===certificate.raw.length&&timingSafeEqual(actual.raw,certificate.raw)?0:-2);}catch{callback(-2);}});
  isolated.webRequest.onBeforeRequest((details,callback)=>{
    let allowed=false;try{const u=new URL(details.url),resource=String(details.resourceType??'').toLowerCase();const base=!ended&&current()&&u.origin===context.profile.checkoutOrigin&&!u.username&&!u.password&&!u.search&&!details.url.includes('?')&&u.href===details.url;
      allowed=base&&!['subframe','websocket','serviceworker','worker'].includes(resource)&&((['GET','HEAD'].includes(details.method)&&!u.hash&&(ASSET_PATHS.has(u.pathname)||u.pathname===pagePath||u.pathname==='/'))||(details.method==='POST'&&!departed&&!u.hash&&API_PATHS.has(u.pathname)));
      // Chromium may retain the initial fragment in the main-frame event; it is never sent over HTTP.
      if(base&&resource==='mainframe'&&details.method==='GET'&&u.pathname===pagePath&&u.hash===target.hash)allowed=true;
      if(base&&resource==='mainframe'&&['GET','HEAD'].includes(details.method)&&u.pathname==='/'&&HOME_ANCHORS.has(u.hash))allowed=true;
    }catch{}callback({cancel:!allowed});
  });
  const homeNavigation=raw=>{try{const u=new URL(raw);return u.origin===context.profile.checkoutOrigin&&!u.username&&!u.password&&!u.search&&!raw.includes('?')&&u.pathname==='/'&&HOME_ANCHORS.has(u.hash)&&u.href===raw;}catch{return false;}};
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));listen(win.webContents,'will-navigate',(event,url)=>{if(!ended&&current()&&homeNavigation(url))departed=true;else event.preventDefault();});listen(win.webContents,'will-redirect',event=>event.preventDefault());listen(win.webContents,'will-attach-webview',event=>event.preventDefault());listen(win.webContents,'login',event=>event.preventDefault());listen(win,'page-title-updated',event=>event.preventDefault());listen(win.webContents,'render-process-gone',close);listen(win.webContents,'destroyed',finish);listen(win,'unresponsive',close);listen(win,'closed',finish);
  try{await new Promise((resolve,reject)=>{rejectStartup=reject;startupTimer=setTimeoutImpl(()=>{close();reject(fail());},30000);startupTimer?.unref?.();Promise.resolve(win.loadURL(raw)).then(resolve,reject);});clearTimeoutImpl(startupTimer);rejectStartup=null;if(ended||!current())throw fail();win.show();return;}catch{close();throw fail();}
 }
 return Object.freeze({open,closeAll});
}
module.exports={loadOwnerReviewCheckoutConfiguration,createOwnerReviewCheckoutWindows};
