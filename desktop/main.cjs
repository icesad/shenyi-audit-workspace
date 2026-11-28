'use strict';
const {app,BrowserWindow,session,protocol,ipcMain,dialog,Menu,shell,safeStorage,powerMonitor} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createTeamClient,API_BASE} = require('./team-client.cjs');
const {loadTeamServiceConfiguration}=require('./team-service-config.cjs');
const {loadIsolatedPreviewConfiguration,loadOwnerReviewManagedPilotConfiguration}=require('./isolated-preview-config.cjs');
const {registerDesktopBridge,APP_URL} = require('./bridge.cjs');
const {createDeviceKeyVault}=require('./device-key-vault.cjs');
const {createNativeCheckoutIntents}=require('./native-checkout-intents.cjs');
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
  '/billing.js':{file:path.join(__dirname,'team-ui/billing.js'),mime:'text/javascript; charset=utf-8'},
  '/refund-intake.js':{file:path.join(__dirname,'team-ui/refund-intake.js'),mime:'text/javascript; charset=utf-8'},
  '/workpapers.css':{file:path.join(__dirname,'team-ui/workpapers.css'),mime:'text/css; charset=utf-8'},
  '/workpaper-sheets.js':{file:path.join(__dirname,'../dist/workpaper-sheets.js'),mime:'text/javascript; charset=utf-8'},
  '/workpaper-original-sheet.js':{file:path.join(__dirname,'../dist/workpaper-original-sheet.js'),mime:'text/javascript; charset=utf-8'},
  '/workpaper-original-word.js':{file:path.join(__dirname,'../dist/workpaper-original-word.js'),mime:'text/javascript; charset=utf-8'},
  '/brand-shenyi.png':{file:path.join(__dirname,'../dist/brand-shenyi.png'),mime:'image/png'},
});

function serviceIndex(bytes,configuration,isolatedPreview=false,ownerReviewCheckout=false,ownerReviewManagedPilot=false){
  const escapeAttribute=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll("'",'&#39;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const values={'shenyi-team-service-mode':configuration.mode,'shenyi-team-service-origin':configuration.profile?.apiBase??API_BASE};
  let html=bytes.toString('utf8');
  for(const [name,value]of Object.entries(values)){
    const fixed='<meta name="'+name+'" content="'+(name==='shenyi-team-service-mode'?'local-preview':API_BASE)+'">';
    if(html.split(fixed).length!==2)throw new Error('Service metadata unavailable');
    html=html.replace(fixed,()=>'<meta name="'+name+'" content="'+escapeAttribute(value)+'">');
  }
  if(isolatedPreview){
    for(const [before,after]of [['本机合成演示</span>','独立合成候选预览</span>'],['<span id="service-mode-label">本机演示</span>','<span id="service-mode-label">独立候选预览</span>'],['使用合成账号和资料验证团队流程。','本窗口为独立合成候选预览；每次启动新建环境，关闭后合成资料保留。'],['账号：intern-a 或 assistant-a','账号：manager-a、partner-a、intern-a 或 assistant-a']]){if(html.split(before).length!==2)throw new Error('Isolated preview label unavailable');html=html.replace(before,after);}
  }
  if(ownerReviewCheckout){
    const marker='<section id="login-view"';
    if(html.split(marker).length!==2)throw new Error('Owner checkout presentation unavailable');
    html=html.replace(marker,'<div id="owner-review-checkout-notice" class="mode-notice"><span>独立官网账务走查</span><p>仅连接当前评审包新建的本地 HTTPS 合成环境。官网订单不收款；本窗口不用于真实客户资料或生产团队。</p></div>'+marker);
  }
  if(ownerReviewManagedPilot){
    const marker='<section id="login-view"';
    if(html.split(marker).length!==2)throw new Error('Owner managed pilot presentation unavailable');
    html=html.replace(marker,'<div id="owner-review-managed-pilot-notice" class="mode-notice"><span>受管试点评审</span><p>本轮使用本机合成账号、团队和原件。验证码请查看启动窗口。</p></div>'+marker);
  }
  return html;
}

async function main() {
  const isPackaged=app.isPackaged===true;
  if(isPackaged&&(Object.hasOwn(process.env,'SHENYI_DESKTOP_DATA_DIR')||app.commandLine.hasSwitch('user-data-dir'))){
    throw new Error('Packaged desktop cannot use a preview data directory');
  }
  let ownerReviewCheckout=null,ownerReviewManagedPilot=null,ownerReviewSupport=null,isolatedPreview=null,serviceConfiguration;
  const managedPilotReview=Object.hasOwn(process.env,'SHENYI_OWNER_REVIEW_MANAGED_PILOT');
  const checkoutReview=Object.hasOwn(process.env,'SHENYI_OWNER_REVIEW_WEBSITE_CHECKOUT');
  if((managedPilotReview||checkoutReview)&&['ignore-certificate-errors','ignore-certificate-errors-spki-list','allow-insecure-localhost','disable-web-security'].some(name=>app.commandLine.hasSwitch(name)))throw new Error('Owner review cannot bypass TLS verification');
  if(managedPilotReview){
    serviceConfiguration=await loadTeamServiceConfiguration({env:process.env,isPackaged});
    ownerReviewManagedPilot=await loadOwnerReviewManagedPilotConfiguration({env:process.env,isPackaged,userDataDirectory:app.commandLine.getSwitchValue('user-data-dir'),profile:serviceConfiguration.profile});
    if(!ownerReviewManagedPilot)throw new Error('Owner managed pilot activation unavailable');
    app.setPath('sessionData',ownerReviewManagedPilot.desktopDataDirectory);
  }else if(checkoutReview){
    serviceConfiguration=await loadTeamServiceConfiguration({env:process.env,isPackaged});
    ownerReviewSupport=require('./owner-review-checkout.cjs');
    ownerReviewCheckout=await ownerReviewSupport.loadOwnerReviewCheckoutConfiguration({env:process.env,isPackaged,platform:process.platform,arch:process.arch,userDataDirectory:app.commandLine.getSwitchValue('user-data-dir'),profile:serviceConfiguration.profile});
    if(!ownerReviewCheckout)throw new Error('Owner checkout activation unavailable');
    app.setPath('sessionData',ownerReviewCheckout.desktopDataDirectory);
  }else{
    isolatedPreview=await loadIsolatedPreviewConfiguration({env:process.env,isPackaged});
    if(isolatedPreview){if(app.commandLine.getSwitchValue('user-data-dir')!==isolatedPreview.desktopDataDirectory)throw new Error('Isolated startup profile mismatch');app.setPath('sessionData',isolatedPreview.desktopDataDirectory);}
    serviceConfiguration=isolatedPreview?Object.freeze({mode:'local-preview',profile:null}):await loadTeamServiceConfiguration({env:process.env,isPackaged});
  }
  const installedVault=isPackaged?resolveDeviceVaultDirectory({isPackaged}):null;
  // The packaged profile and vault share a per-machine root distinct from every preview.
  const reviewContext=ownerReviewManagedPilot??ownerReviewCheckout??isolatedPreview;
  const dataRoot=installedVault?path.join(path.dirname(installedVault),'profile'):
    reviewContext?.desktopDataDirectory||process.env.SHENYI_DESKTOP_DATA_DIR||(process.platform==='win32'?'D:/codex-temp/shenyi-desktop-preview':path.join(app.getPath('appData'),'ShenyiTeamPreview'));
  await fs.mkdir(dataRoot,{recursive:true});
  if(isPackaged)app.setPath('sessionData',dataRoot);
  app.setPath('userData',dataRoot);
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
    try{const bytes=await fs.readFile(asset.file);return new Response(url.pathname==='/index.html'?serviceIndex(bytes,isolatedPreview?{mode:'local-preview',profile:isolatedPreview.profile}:serviceConfiguration,!!isolatedPreview,!!ownerReviewCheckout,!!ownerReviewManagedPilot):bytes,{headers:{'Content-Type':asset.mime,'Content-Security-Policy':CONTENT_SECURITY_POLICY,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});}catch{return new Response('Asset unavailable',{status:503});}
  });
  const wechatPolicy={appId:process.env.SHENYI_WECHAT_APP_ID,redirectUri:process.env.SHENYI_WECHAT_REDIRECT_URI};
  const vault=createDeviceKeyVault({directory:installedVault??reviewContext?.deviceVaultDirectory??resolveDeviceVaultDirectory(),safeStorage});
  let ownerReviewWindows=null;
  const client=createTeamClient({baseUrl:API_BASE,...(serviceConfiguration.profile?{trustedService:serviceConfiguration.profile}:{}),...(isolatedPreview?{isolatedPreview:isolatedPreview.profile}:{}),wechatPolicy,openAuthorization:url=>shell.openExternal(url),openCheckoutExternal:url=>ownerReviewCheckout?ownerReviewWindows.open(url):shell.openExternal(url),
    openNativeCheckoutExternal:url=>shell.openExternal(url),nativeCheckoutIntents:createNativeCheckoutIntents(dataRoot),
    deviceIdentity:{vault,platform:process.platform,displayName:process.platform==='darwin'?'我的Mac电脑':'我的Windows电脑'}});
  const win=new BrowserWindow({width:1210,height:800,minWidth:840,minHeight:600,show:false,title:ownerReviewManagedPilot?'审迹 · 受管试点评审':'审迹 · 团队采集预览',backgroundColor:'#f5f6f2',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),session:isolated,nodeIntegration:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:!app.isPackaged}});
  if(ownerReviewCheckout)ownerReviewWindows=ownerReviewSupport.createOwnerReviewCheckoutWindows({context:ownerReviewCheckout,parent:win,BrowserWindow,session});
  if(isolatedPreview||ownerReviewCheckout||ownerReviewManagedPilot)win.on('page-title-updated',event=>event.preventDefault());
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
  win.on('closed',()=>{ownerReviewWindows?.closeAll();clearInterval(heartbeat);powerMonitor.removeListener('suspend',pauseConnection);powerMonitor.removeListener('resume',resumeConnection);dispose();vault.dispose();app.quit();});
  app.on('second-instance',()=>{if(win.isMinimized())win.restore();win.show();win.focus();});
  await win.loadURL(APP_URL);if(isolatedPreview)win.setTitle('审迹 · 独立合成候选预览 · '+isolatedPreview.candidateId.slice(0,8));if(ownerReviewCheckout)win.setTitle('审迹 · 独立官网账务评审 · '+ownerReviewCheckout.candidateId.slice(0,8));win.show();
}
main().catch(error=>{
  console.error('审迹团队客户端启动失败。请检查本机环境与配置。');
  if(app.isPackaged===true&&process.platform==='darwin'&&error?.code==='TEAM_SERVICE_CONFIGURATION_INVALID'){
    try{dialog.showErrorBox('审迹无法启动','请联系管理员检查此电脑的团队服务配置。');}catch{}
  }
  if(app.isPackaged===true||Object.hasOwn(process.env,'SHENYI_ISOLATED_PREVIEW_CONFIG')||Object.hasOwn(process.env,'SHENYI_OWNER_REVIEW_WEBSITE_CHECKOUT')||Object.hasOwn(process.env,'SHENYI_OWNER_REVIEW_MANAGED_PILOT'))app.exit(1);else app.quit();
});
app.on('window-all-closed',()=>app.quit());
