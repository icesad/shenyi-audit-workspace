'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const PREVIEW_SCHEME='shenyi-preview',PREVIEW_ORIGIN=PREVIEW_SCHEME+'://document',PREVIEW_URL=PREVIEW_ORIGIN+'/index.html';
const PREVIEW_CSP="default-src 'none'; script-src 'self' blob:; style-src 'self'; img-src 'self' blob:; font-src 'self'; worker-src blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const ASSETS=Object.freeze(Object.fromEntries([
 ['/index.html','material-preview/index.html','text/html; charset=utf-8'],
 ['/preview.js','material-preview/preview.js','text/javascript; charset=utf-8'],
 ['/preview.css','material-preview/preview.css','text/css; charset=utf-8'],
 ...['bidder-archive-vendor.js','bidder-archive.js','vendor-legacy-doc.js','workpaper-xlsx-source.js','workpaper-sheets.js','vendor-bidder-pdf.js','quote-annex-preview.js','audit-preview-readers.js','audit-attachment-preview.js'].map(name=>['/'+name,'../dist/'+name,'text/javascript; charset=utf-8']),
 ...['audit-preview-ui.css','quote-annex-preview.css'].map(name=>['/'+name,'../dist/'+name,'text/css; charset=utf-8']),
 ['/brand-shenyi.png','../dist/brand-shenyi.png','image/png']
].map(([url,file,mime])=>[url,Object.freeze({file:path.join(__dirname,file),mime})])));
const headers=mime=>({'Content-Type':mime,'Content-Security-Policy':PREVIEW_CSP,'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
const failure=()=>Object.assign(new Error('本次只读预览已关闭或无法安全显示，请回工作台重新核权。'),{code:'MATERIAL_PREVIEW_CLOSED'});
function createMaterialPreviewWindow({parent,getSource,authorize,onClosed=()=>{},BrowserWindow,session,fsImpl=fs,setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout}={}){
 if(!BrowserWindow||!session){const electron=require('electron');BrowserWindow??=electron.BrowserWindow;session??=electron.session;}
 if(typeof getSource!=='function'||typeof authorize!=='function'||!parent?.webContents)throw failure();
 const isolated=session.fromPartition('shenyi-material-preview-'+randomUUID());
 let closed=false,sourceUsed=false,sourceDelivered=false,revealUsed=false,revealed=false,firstNavigation=true,sourceBytes=null,timer,resolveShown,rejectShown;
 const shown=new Promise((resolve,reject)=>{resolveShown=resolve;rejectShown=reject;});shown.catch(()=>{});
 const win=new BrowserWindow({parent,show:false,width:1180,height:840,minWidth:640,minHeight:480,title:'审易 · 资料原件只读预览',backgroundColor:'#f5f6f2',autoHideMenuBar:true,
  webPreferences:{session:isolated,nodeIntegration:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:false}});
 const listeners=[];
 function listen(target,event,fn){target.on(event,fn);listeners.push([target,event,fn]);}
 function current(){if(closed||win.isDestroyed()||parent.isDestroyed?.())throw failure();}
 function finish(){if(closed)return;closed=true;clearTimeoutImpl(timer);for(const [target,event,fn]of listeners)target.removeListener(event,fn);listeners.length=0;isolated.webRequest.onBeforeRequest(null);isolated.removeListener('will-download',blockDownload);try{isolated.protocol.unhandle(PREVIEW_SCHEME);}catch{}sourceBytes?.fill(0);sourceBytes=null;if(!revealed)rejectShown(failure());try{onClosed();}catch{}}
 function close(){if(closed)return;try{win.hide();if(!win.isDestroyed())win.destroy();}finally{finish();}}
 function blockDownload(event){event.preventDefault();}
 isolated.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));isolated.setPermissionCheckHandler(()=>false);isolated.on('will-download',blockDownload);
 function localUrl(raw){try{const u=new URL(raw);return u.protocol===PREVIEW_SCHEME+':'&&u.hostname==='document'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&(Object.hasOwn(ASSETS,u.pathname)||u.pathname==='/source'||u.pathname==='/reveal');}catch{return false;}}
 isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:closed||!(localUrl(details.url)||details.url.startsWith('blob:'+PREVIEW_ORIGIN+'/'))}));
 isolated.protocol.handle(PREVIEW_SCHEME,async request=>{
  const denied=status=>new Response('预览请求不可用。',{status,headers:headers('text/plain; charset=utf-8')});
  if(closed||!localUrl(request.url))return denied(404);
  const url=new URL(request.url);
  if(url.pathname==='/source'){
   if(request.method!=='GET'||request.headers.has('range')||sourceUsed)return denied(404);
   sourceUsed=true;
   try{const value=await getSource();current();if(!value||Object.keys(value).sort().join(',')!=='byteLength,bytes,filename,sha256,type'||!(value.bytes instanceof Uint8Array)||!Number.isSafeInteger(value.byteLength)||value.byteLength<1||value.byteLength>12*1024*1024||value.bytes.length!==value.byteLength||typeof value.filename!=='string'||!value.filename||!value.filename.isWellFormed()||typeof value.type!=='string'||!value.type.isWellFormed()||! /^[a-f0-9]{64}$/.test(value.sha256??''))throw failure();sourceBytes=new Uint8Array(value.bytes);if(createHash('sha256').update(sourceBytes).digest('hex')!==value.sha256)throw failure();current();sourceDelivered=true;return new Response(sourceBytes,{headers:{...headers('application/octet-stream'),'Content-Length':String(value.byteLength),'X-Shenyi-Filename':encodeURIComponent(value.filename),'X-Shenyi-Type':encodeURIComponent(value.type),'X-Content-SHA256':value.sha256}});}catch{close();return denied(410);}
  }
  if(url.pathname==='/reveal'){
   if(request.method!=='POST'||revealUsed||!sourceDelivered||request.headers.has('range'))return denied(404);
   revealUsed=true;
   try{const length=request.headers.get('content-length');if(length!==null&&length!=='0')throw failure();if(request.body){const reader=request.body.getReader();try{const chunk=await reader.read();if(!chunk.done)throw failure();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}current();await authorize();current();clearTimeoutImpl(timer);win.show();revealed=true;resolveShown();return new Response(null,{status:204,headers:headers('text/plain; charset=utf-8')});}catch{close();return denied(410);}
  }
  if(request.method!=='GET')return denied(404);
  const asset=ASSETS[url.pathname];if(!asset)return denied(404);
  try{const bytes=await fsImpl.readFile(asset.file);current();return new Response(bytes,{headers:headers(asset.mime)});}catch{return denied(closed?410:503);}
 });
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 listen(win.webContents,'will-navigate',event=>{event.preventDefault();close();});listen(win.webContents,'will-redirect',event=>{event.preventDefault();close();});listen(win.webContents,'will-attach-webview',event=>event.preventDefault());
 listen(win.webContents,'did-start-navigation',(_event,url,_inPlace,isMainFrame)=>{if(isMainFrame===false)return;if(firstNavigation&&url===PREVIEW_URL){firstNavigation=false;return;}close();});
 listen(win.webContents,'render-process-gone',close);listen(win.webContents,'destroyed',finish);listen(win,'unresponsive',close);listen(win,'closed',finish);
 listen(parent.webContents,'did-start-navigation',(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame!==false)close();});listen(parent.webContents,'render-process-gone',close);listen(parent.webContents,'destroyed',close);listen(parent,'closed',close);
 timer=setTimeoutImpl(close,50000);timer?.unref?.();
 Promise.resolve(win.loadURL(PREVIEW_URL)).catch(close);
 return Object.freeze({shown,close});
}
module.exports={createMaterialPreviewWindow,PREVIEW_SCHEME,PREVIEW_ORIGIN,PREVIEW_URL,PREVIEW_CSP,ASSETS};
