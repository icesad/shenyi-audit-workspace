'use strict';
const {app,BrowserWindow,session,protocol,ipcMain,dialog,Menu,shell,safeStorage,powerMonitor} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createTeamClient,API_BASE} = require('./team-client.cjs');
const {loadTeamServiceConfiguration}=require('./team-service-config.cjs');
const {loadIsolatedPreviewConfiguration}=require('./isolated-preview-config.cjs');
const {registerDesktopBridge,APP_URL} = require('./bridge.cjs');
const {createDeviceKeyVault}=require('./device-key-vault.cjs');
const {resolveDeviceVaultDirectory}=require('./device-key-directory.cjs');
const {PREVIEW_SCHEME}=require('./material-preview-window.cjs');

protocol.registerSchemesAsPrivileged([{scheme:'shenyi',privileges:{standard:true,secure:true}},{scheme:PREVIEW_SCHEME,privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.enableSandbox();
const CONTENT_SECURITY_POLICY="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";
const ASSETS=Object.freeze({
  '/index.html':{file:path.join(__dirname,'team-ui/index.html'),mime:'text/html; charset=utf-8'},
  '/team-ui.css':{file:path.join(__dirname,'team-ui/team-ui.css'),mime:'text/css; charset=utf-8'},
  '/team-ui.js':{file:path.join(__dirname,'team-ui/team-ui.js'),mime:'text/javascript; charset=utf-8'},
  '/project-materials.js':{file:path.join(__dirname,'team-ui/project-materials.js'),mime:'text/javascript; charset=utf-8'},
  '/ledger-checks.js':{file:path.join(__dirname,'team-ui/ledger-checks.js'),mime:'text/javascript; charset=utf-8'},
  '/workpapers.js':{file:path.join(__dirname,'team-ui/workpapers.js'),mime:'text/javascript; charset=utf-8'},
  '/workpapers.css':{file:path.join(__dirname,'team-ui/workpapers.css'),mime:'text/css; charset=utf-8'},
  '/workpaper-sheets.js':{file:path.join(__dirname,'../dist/workpaper-sheets.js'),mime:'text/javascript; charset=utf-8'},
  '/workpaper-original-sheet.js':{file:path.join(__dirname,'../dist/workpaper-original-sheet.js'),mime:'text/javascript; charset=utf-8'},
  '/workpaper-original-word.js':{file:path.join(__dirname,'../dist/workpaper-original-word.js'),mime:'text/javascript; charset=utf-8'},
  '/brand-shenyi.png':{file:path.join(__dirname,'../dist/brand-shenyi.png'),mime:'image/png'},
});

function serviceIndex(bytes,configuration,isolatedPreview=false){
  const escapeAttribute=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll("'",'&#39;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const values={'shenyi-team-service-mode':configuration.mode,'shenyi-team-service-origin':configuration.profile?.apiBase??API_BASE};
  let html=bytes.toString('utf8');
  for(const [name,value]of Object.entries(values)){
    const fixed='<meta name="'+name+'" content="'+(name==='shenyi-team-service-mode'?'local-preview':API_BASE)+'">';
    if(html.split(fixed).length!==2)throw new Error('Service metadata unavailable');
    html=html.replace(fixed,()=>'<meta name="'+name+'" content="'+escapeAttribute(value)+'">');
  }
  if(isolatedPreview){
    for(const [before,after]of [['本机合成演示</span>','独立合成候选预览</span>'],['<span id="service-mode-label">本机演示</span>','<span id="service-mode-label">独立候选预览</span>'],['使用合成账号和资料验证团队流程。','本窗口为独立合成候选预览；每次启动新建环境，关闭后合成资料保留。'],['账号：intern-a 或 assistant-a<br>密码：ShenyiDemo!2026','账号：manager-a、partner-a、intern-a 或 assistant-a<br>密码：ShenyiDemo!2026']]){if(html.split(before).length!==2)throw new Error('Isolated preview label unavailable');html=html.replace(before,after);}
  }
  return html;
}

async function main() {
  const isolatedPreview=await loadIsolatedPreviewConfiguration({env:process.env,isPackaged:app.isPackaged===true});
  if(isolatedPreview){if(app.commandLine.getSwitchValue('user-data-dir')!==isolatedPreview.desktopDataDirectory)throw new Error('Isolated startup profile mismatch');app.setPath('sessionData',isolatedPreview.desktopDataDirectory);}
  const serviceConfiguration=isolatedPreview?Object.freeze({mode:'local-preview',profile:null}):await loadTeamServiceConfiguration({env:process.env,isPackaged:app.isPackaged===true});
  // Development preview data is isolated from both the original browser and production.
  const dataRoot=isolatedPreview?.desktopDataDirectory || process.env.SHENYI_DESKTOP_DATA_DIR || (process.platform==='win32'?'D:/codex-temp/shenyi-desktop-preview':path.join(app.getPath('appData'),'ShenyiTeamPreview'));
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
    try{const bytes=await fs.readFile(asset.file);return new Response(url.pathname==='/index.html'?serviceIndex(bytes,isolatedPreview?{mode:'local-preview',profile:isolatedPreview.profile}:serviceConfiguration,!!isolatedPreview):bytes,{headers:{'Content-Type':asset.mime,'Content-Security-Policy':CONTENT_SECURITY_POLICY,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});}catch{return new Response('Asset unavailable',{status:503});}
  });
  const wechatPolicy={appId:process.env.SHENYI_WECHAT_APP_ID,redirectUri:process.env.SHENYI_WECHAT_REDIRECT_URI};
  const vault=createDeviceKeyVault({directory:isolatedPreview?.deviceVaultDirectory??resolveDeviceVaultDirectory(),safeStorage});
  const client=createTeamClient({baseUrl:API_BASE,...(serviceConfiguration.profile?{trustedService:serviceConfiguration.profile}:{}),...(isolatedPreview?{isolatedPreview:isolatedPreview.profile}:{}),wechatPolicy,openAuthorization:url=>shell.openExternal(url),
    deviceIdentity:{vault,platform:process.platform,displayName:process.platform==='darwin'?'我的Mac电脑':'我的Windows电脑'}});
  const win=new BrowserWindow({width:1210,height:800,minWidth:840,minHeight:600,show:false,title:'审易 · 团队采集预览',backgroundColor:'#f5f6f2',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),session:isolated,nodeIntegration:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:!app.isPackaged}});
  if(isolatedPreview)win.on('page-title-updated',event=>event.preventDefault());
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!==APP_URL)event.preventDefault();});
  win.webContents.on('will-redirect',event=>event.preventDefault());
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  const dispose=registerDesktopBridge({ipcMain,window:win,client,dialog});
  const checkConnection=()=>{void client.checkDeviceConnection().catch(()=>{});};
  const heartbeat=setInterval(checkConnection,5000);heartbeat.unref();
  const pauseConnection=()=>client.pauseDeviceConnection();
  const resumeConnection=()=>{pauseConnection();checkConnection();};
  powerMonitor.on('suspend',pauseConnection);powerMonitor.on('resume',resumeConnection);
  win.on('closed',()=>{clearInterval(heartbeat);powerMonitor.removeListener('suspend',pauseConnection);powerMonitor.removeListener('resume',resumeConnection);dispose();vault.dispose();app.quit();});
  app.on('second-instance',()=>{if(win.isMinimized())win.restore();win.show();win.focus();});
  await win.loadURL(APP_URL);if(isolatedPreview)win.setTitle('审易 · 独立合成候选预览 · '+isolatedPreview.candidateId.slice(0,8));win.show();
}
main().catch(()=>{console.error('审易团队预览启动失败。请检查本机环境与配置。');if(Object.hasOwn(process.env,'SHENYI_ISOLATED_PREVIEW_CONFIG'))app.exit(1);else app.quit();});
app.on('window-all-closed',()=>app.quit());
