'use strict';
const {app,BrowserWindow,session,protocol,ipcMain,dialog,Menu,shell} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createTeamClient,API_BASE} = require('./team-client.cjs');
const {registerDesktopBridge,APP_URL} = require('./bridge.cjs');

protocol.registerSchemesAsPrivileged([{scheme:'shenyi',privileges:{standard:true,secure:true}}]);
app.enableSandbox();
const CONTENT_SECURITY_POLICY="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
const ASSETS=Object.freeze({
  '/index.html':{file:path.join(__dirname,'team-ui/index.html'),mime:'text/html; charset=utf-8'},
  '/team-ui.css':{file:path.join(__dirname,'team-ui/team-ui.css'),mime:'text/css; charset=utf-8'},
  '/team-ui.js':{file:path.join(__dirname,'team-ui/team-ui.js'),mime:'text/javascript; charset=utf-8'},
  '/brand-shenyi.png':{file:path.join(__dirname,'../dist/brand-shenyi.png'),mime:'image/png'},
});

async function main() {
  // Development preview data is isolated from both the original browser and production.
  const dataRoot=process.env.SHENYI_DESKTOP_DATA_DIR || (process.platform==='win32'?'D:/codex-temp/shenyi-desktop-preview':path.join(app.getPath('appData'),'ShenyiTeamPreview'));
  await fs.mkdir(dataRoot,{recursive:true});app.setPath('userData',dataRoot);
  if(!app.requestSingleInstanceLock()){app.quit();return;}
  await app.whenReady();
  const isolated=session.fromPartition('shenyi-team-preview');
  isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  isolated.setPermissionCheckHandler(()=>false);
  isolated.on('will-download',(event)=>event.preventDefault());
  isolated.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith('shenyi://app/')}));
  isolated.protocol.handle('shenyi',async request=>{
    const url=new URL(request.url), asset=ASSETS[url.pathname];
    if(request.method!=='GET'||url.hostname!=='app'||url.port||url.username||url.password||url.search||!asset)return new Response('Not found',{status:404});
    try{return new Response(await fs.readFile(asset.file),{headers:{'Content-Type':asset.mime,'Content-Security-Policy':CONTENT_SECURITY_POLICY,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});}catch{return new Response('Asset unavailable',{status:503});}
  });
  const wechatPolicy={appId:process.env.SHENYI_WECHAT_APP_ID,redirectUri:process.env.SHENYI_WECHAT_REDIRECT_URI};
  const client=createTeamClient({baseUrl:process.env.SHENYI_TEAM_API || API_BASE,wechatPolicy,openAuthorization:url=>shell.openExternal(url)});
  const win=new BrowserWindow({width:1210,height:800,minWidth:840,minHeight:600,show:false,title:'审易 · 团队采集预览',backgroundColor:'#f5f6f2',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),session:isolated,nodeIntegration:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:!app.isPackaged}});
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!==APP_URL)event.preventDefault();});
  win.webContents.on('will-redirect',event=>event.preventDefault());
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  const dispose=registerDesktopBridge({ipcMain,window:win,client,dialog});
  win.on('closed',()=>{dispose();app.quit();});
  app.on('second-instance',()=>{if(win.isMinimized())win.restore();win.show();win.focus();});
  await win.loadURL(APP_URL);win.show();
}
main().catch(()=>{console.error('审易团队预览启动失败。请检查本机环境与配置。');app.quit();});
app.on('window-all-closed',()=>app.quit());
