'use strict';
const {ledgerLegacyFormCount,ledgerLegacySecretCount}=require('./helpers/ledger-check-entry-layer.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),asyncFs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {EventEmitter}=require('node:events'),{JSDOM}=require('jsdom');
const config=require('../desktop/team-service-config.cjs'),{withDeviceDiagnostic}=require('./helpers/desktop-device-diagnostic.cjs');
const {createTeamClient}=require('../desktop/team-client.cjs');
const ROOT=path.resolve(__dirname,'../desktop'),HTML=fs.readFileSync(path.join(ROOT,'team-ui/index.html'),'utf8'),UI=fs.readFileSync(path.join(ROOT,'team-ui/team-ui.js'),'utf8'),MAIN=fs.readFileSync(path.join(ROOT,'main.cjs'),'utf8');
const PROFILE={schemaVersion:1,apiBase:'https://team.example.invalid:9443',serverId:'11111111-1111-4111-8111-111111111111'},ok=value=>({ok:true,value});
async function until(check){for(let i=0;i<180;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,0));}assert.ok(check(),'expected startup or renderer state');}
async function remoteFile(t,profile=PROFILE){const directory=await asyncFs.mkdtemp(path.join(os.tmpdir(),'shenyi-desktop-service-')),filename=path.join(directory,'trusted-team.json');t.after(()=>asyncFs.rm(directory,{recursive:true,force:true}));await asyncFs.writeFile(filename,JSON.stringify(profile));return filename;}
async function start(t,{env={},isPackaged=false,commandLineProfile=false,readIndex=HTML,platform='win32',loadConfiguration=config.loadTeamServiceConfiguration}={}){
  const seen={events:[],errors:[],external:[]},app=new EventEmitter(),power=new EventEmitter(),isolated=new EventEmitter();
  Object.assign(app,{isPackaged,commandLine:{hasSwitch:name=>name==='user-data-dir'&&commandLineProfile},enableSandbox(){seen.sandbox=true;},requestSingleInstanceLock(){seen.events.push('lock');return true;},whenReady:async()=>{seen.events.push('ready');},setPath(name,value){seen.events.push(name);(seen.paths??={})[name]=value;},quit(){seen.quit=true;},exit(code){seen.exit=code;},getPath(){throw Error('unexpected profile fallback');}});
  Object.assign(isolated,{setPermissionRequestHandler(handler){seen.permission=handler;},setPermissionCheckHandler(handler){seen.permissionCheck=handler;},webRequest:{onBeforeRequest(handler){seen.networkGate=handler;}},protocol:{handle(scheme,handler){seen.handler=handler;seen.scheme=scheme;}}});
  class Window extends EventEmitter{constructor(options){super();seen.events.push('window');seen.window=this;seen.options=options;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=handler=>{seen.openHandler=handler;};}async loadURL(value){seen.url=value;}show(){seen.shown=true;}}
  const vault={dispose(){seen.disposed=true;}},client={checkDeviceConnection:async()=>{},pauseDeviceConnection(){}};
  const deps={'electron':{app,BrowserWindow:Window,session:{fromPartition:()=>isolated},protocol:{registerSchemesAsPrivileged(values){seen.schemes=values;}},ipcMain:{},dialog:{showErrorBox(title,content){seen.events.push('startup-alert');seen.alert={title,content};}},Menu:{setApplicationMenu(){}},shell:{openExternal(url){(seen.external??=[]).push(url);return Promise.resolve();}},safeStorage:{},powerMonitor:power},'node:fs/promises':{async mkdir(){seen.events.push('mkdir');},async readFile(filename){return filename===path.join(ROOT,'team-ui/index.html')?Buffer.from(readIndex):asyncFs.readFile(filename);}},'node:path':path,'./team-service-config.cjs':{async loadTeamServiceConfiguration(options){seen.events.push('config');seen.configArgs=options;const value=await loadConfiguration(options);seen.events.push('configured');seen.configuration=value;return value;}},'./team-client.cjs':{API_BASE:config.API_BASE,createTeamClient(options){seen.events.push('client');seen.clientOptions=options;return client;}},'./bridge.cjs':{APP_URL:'shenyi://app/index.html',registerDesktopBridge(){return ()=>{};}},'./device-key-vault.cjs':{createDeviceKeyVault(){seen.events.push('vault');return vault;}},'./device-key-directory.cjs':{resolveDeviceVaultDirectory(){seen.events.push('vault-directory');return 'D:/synthetic-isolated-vault';}},'./material-preview-window.cjs':{PREVIEW_SCHEME:'shenyi-preview'}};
  deps['./isolated-preview-config.cjs']=require('../desktop/isolated-preview-config.cjs');
  deps['./native-checkout-intents.cjs']=require('../desktop/native-checkout-intents.cjs');
  const context={require:name=>{assert.ok(Object.hasOwn(deps,name),name);return deps[name];},__dirname:ROOT,process:{env:{...(!isPackaged&&{SHENYI_DESKTOP_DATA_DIR:'D:/synthetic-isolated-profile'}),...env},platform},URL,Response,console:{error(value){seen.errors.push(value);}},setInterval(){return {unref(){}};},clearInterval(){}};
  vm.runInNewContext(MAIN,context);await until(()=>seen.quit||seen.exit!==undefined||seen.shown);t.after(()=>{seen.window?.emit('closed');});return {...seen,context};
}
function renderer(t,html=HTML,overrides={}){
  const dom=new JSDOM(html,{url:'shenyi://app/index.html',runScripts:'outside-only'}),{window}=dom,calls=[];
  const bridge={getAuthMethods:async()=>ok({mode:'local-preview',methods:{demoUsername:true,phonePassword:false,phoneVerification:false,wechat:false,recovery:false},desktopWechatReady:false}),getOnboardingStatus:async()=>ok({available:false,invitationOnly:true}),...overrides};
  window.shenyiTeam=withDeviceDiagnostic(Object.fromEntries(Object.entries(bridge).map(([name,action])=>[name,async(...args)=>{calls.push({name,args});return action(...args);}])));
  window.fetch=()=>{throw Error('renderer must not fetch');};window.eval(UI);t.after(()=>window.close());return {window,d:window.document,calls};
}

test('packaged missing/invalid config and conflicting env fail before profile, vault, client or window',async t=>{
  const filename=await remoteFile(t);
  for(const options of [{isPackaged:true},{env:{SHENYI_TEAM_SERVICE_CONFIG:''}},{env:{SHENYI_TEAM_SERVICE_CONFIG:filename,SHENYI_TEAM_API:config.API_BASE}},{env:{SHENYI_TEAM_SERVICE_CONFIG:filename,NODE_TLS_REJECT_UNAUTHORIZED:'0'}},{env:{SHENYI_TEAM_API:'https://arbitrary.invalid'}}]){
    const seen=await start(t,options);assert.equal(options.isPackaged?seen.exit:seen.quit,options.isPackaged?1:true);assert.deepEqual(seen.events,['config']);assert.equal(seen.errors.length,1);assert.equal(seen.shown,undefined);assert.equal(seen.clientOptions,undefined);assert.equal(seen.paths,undefined);assert.equal(seen.errors[0].includes(filename),false);
  }
});

test('packaged startup rejects alternate preview data roots before config or profile setup',async t=>{
  const filename=await remoteFile(t);
  for(const options of [{env:{SHENYI_DESKTOP_DATA_DIR:'D:/preview'}},{commandLineProfile:true}]){
    const seen=await start(t,{isPackaged:true,...options,env:{SHENYI_TEAM_SERVICE_CONFIG:filename,...options.env}});
    assert.equal(seen.exit,1);assert.deepEqual(seen.events,[]);assert.equal(seen.paths,undefined);
  }
});

test('packaged Mac reports bad service configuration before creating a client or profile',async t=>{
  const loadConfiguration=async()=>{throw Object.assign(new Error('internal deployment details'),{code:'TEAM_SERVICE_CONFIGURATION_INVALID'});};
  const seen=await start(t,{isPackaged:true,platform:'darwin',loadConfiguration});
  assert.deepEqual(seen.events,['config','startup-alert']);
  assert.equal(seen.exit,1);
  assert.match(seen.alert.content,/联系管理员/);
  assert.ok(!JSON.stringify(seen.alert).includes('internal deployment details'));
});

test('normal main loads frozen profile before mutable startup and passes it only to private client',async t=>{
  const filename=await remoteFile(t,{...PROFILE,apiBase:PROFILE.apiBase+'/'}),seen=await start(t,{env:{SHENYI_TEAM_SERVICE_CONFIG:filename},isPackaged:true});
  assert.deepEqual(seen.events,['config','configured','vault-directory','mkdir','sessionData','userData','lock','ready','vault','client','window']);assert.deepEqual(seen.paths,{sessionData:path.join('D:/','profile'),userData:path.join('D:/','profile')});assert.ok(Object.isFrozen(seen.configuration));assert.ok(Object.isFrozen(seen.clientOptions.trustedService));assert.equal(seen.clientOptions.trustedService,seen.configuration.profile);assert.equal(seen.clientOptions.baseUrl,config.API_BASE);assert.equal(seen.configArgs.isPackaged,true);
  const response=await seen.handler({url:'shenyi://app/index.html',method:'GET'}),html=await response.text(),dom=new JSDOM(html);t.after(()=>dom.window.close());
  assert.equal(response.status,200);assert.equal(dom.window.document.querySelector('meta[name="shenyi-team-service-mode"]').content,'remote-https');assert.equal(dom.window.document.querySelector('meta[name="shenyi-team-service-origin"]').content,PROFILE.apiBase);
  assert.equal(html.includes(PROFILE.serverId),false);assert.equal(html.includes(filename),false);assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'none'/);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(dom.window.document.querySelectorAll('script:not([src])').length,0);
  assert.deepEqual({...seen.options.webPreferences,session:null},{preload:path.join(ROOT,'preload.cjs'),session:null,nodeIntegration:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:false});
  assert.equal((await seen.handler({url:'shenyi://app/../../GOAL.md',method:'GET'})).status,404);assert.equal((await seen.handler({url:'shenyi://app/index.html?override=https://evil.invalid',method:'GET'})).status,404);assert.equal((await seen.handler({url:'shenyi://app/index.html',method:'POST'})).status,404);
  let network;seen.networkGate({url:PROFILE.apiBase},value=>{network=value;});assert.equal(network.cancel,true);assert.equal(seen.permissionCheck(),false);assert.deepEqual({...seen.openHandler()},{action:'deny'});
});

test('normal unpackaged local startup preserves original fixed API and static metadata',async t=>{
  const seen=await start(t),response=await seen.handler({url:'shenyi://app/index.html',method:'GET'}),html=await response.text();
  assert.equal(html,HTML);assert.equal(seen.clientOptions.baseUrl,config.API_BASE);assert.equal(Object.hasOwn(seen.clientOptions,'trustedService'),false);assert.equal(seen.configuration.mode,'local-preview');assert.equal(seen.options.webPreferences.devTools,true);
});

test('index projection is attribute-escaped, literal and fails closed on missing/duplicate fixed metadata',async t=>{
  const seen=await start(t),unsafe='https://$&.invalid/\"><script id="injected">bad()</script>&\'';
  const projected=seen.context.serviceIndex(Buffer.from(HTML),{mode:'remote-https',profile:{apiBase:unsafe}}),dom=new JSDOM(projected);t.after(()=>dom.window.close());
  assert.equal(dom.window.document.querySelector('meta[name="shenyi-team-service-origin"]').content,unsafe);assert.equal(dom.window.document.getElementById('injected'),null);assert.equal(dom.window.document.querySelectorAll('meta[name="shenyi-team-service-origin"]').length,1);
  for(const readIndex of [HTML.replace('<meta name="shenyi-team-service-mode" content="local-preview">',''),HTML.replace('<meta name="shenyi-team-service-mode" content="local-preview">','<meta name="shenyi-team-service-mode" content="local-preview"><meta name="shenyi-team-service-mode" content="local-preview">')]){const broken=await start(t,{readIndex});assert.equal((await broken.handler({url:'shenyi://app/index.html',method:'GET'})).status,503);}
});

test('remote UI displays fixed HTTPS origin but retains synthetic identity and uncompleted production notice',async t=>{
  const filename=await remoteFile(t),main=await start(t,{env:{SHENYI_TEAM_SERVICE_CONFIG:filename}}),html=await (await main.handler({url:'shenyi://app/index.html',method:'GET'})).text(),f=renderer(t,html);
  await until(()=>f.d.getElementById('login-form-caption').textContent.includes(PROFILE.apiBase)&&f.d.getElementById('identity-methods-message').textContent.includes('合成演示账号'));
  assert.equal(f.d.getElementById('service-demo-help-title').textContent,'合成演示账号说明');assert.equal(f.d.getElementById('service-demo-help-description').textContent,'仅用于当前明确启用的合成演示服务，不是正式用户账号。');assert.equal(f.d.getElementById('service-preview-label').textContent,'HTTPS连接 · 合成预览');assert.equal(f.d.getElementById('service-mode-label').textContent,'HTTPS预览');assert.match(f.d.getElementById('service-preview-notice').textContent,/合成账号/);assert.match(f.d.getElementById('service-preview-notice').textContent,/正式商用服务尚未完成/);assert.match(f.d.getElementById('identity-methods-message').textContent,/合成演示账号/);assert.equal(ledgerLegacyFormCount(f.d),22);assert.equal(ledgerLegacySecretCount(f.d),27);
  assert.equal(f.window.require,undefined);assert.equal(f.window.process,undefined);assert.equal(f.d.documentElement.outerHTML.includes(PROFILE.serverId),false);assert.equal(f.calls.some(call=>call.args.some(arg=>JSON.stringify(arg)?.includes(PROFILE.apiBase))),false);
  f.d.querySelector('meta[name="shenyi-team-service-origin"]').content='https://changed.invalid';f.d.getElementById('login-mode').dispatchEvent(new f.window.Event('change'));assert.match(f.d.getElementById('login-form-caption').textContent,/team\.example\.invalid:9443/);
});

test('desktop capability validation requires phone and disallows demo for managed service',async()=>{
  const methods={demoUsername:false,phonePassword:true,phoneVerification:false,wechat:false,recovery:false};
  let response={mode:'managed-service',methods};
  const client=createTeamClient({fetchImpl:async url=>{
    assert.equal(url,config.API_BASE+'/api/auth/methods');
    return Response.json(response);
  }});
  assert.deepEqual(await client.getAuthMethods(),{mode:'managed-service',methods,desktopWechatReady:false});
  for(const invalid of [{...methods,demoUsername:true},{...methods,phonePassword:false},{...methods,wechat:'false'}]){
    response={mode:'managed-service',methods:invalid};
    await assert.rejects(client.getAuthMethods(),{code:'INVALID_RESPONSE'});
  }
  response={mode:'local-preview',methods:{...methods,demoUsername:true,phonePassword:false}};
  assert.deepEqual((await client.getAuthMethods()).methods,response.methods);
});

test('managed HTTPS login hides demo before and after discovery and uses only the phone path',async t=>{
  const filename=await remoteFile(t),main=await start(t,{env:{SHENYI_TEAM_SERVICE_CONFIG:filename}});
  const html=await(await main.handler({url:'shenyi://app/index.html',method:'GET'})).text();
  let deliverDiscovery;
  const discovery=new Promise(resolve=>{deliverDiscovery=resolve;});
  const methods={demoUsername:false,phonePassword:true,phoneVerification:false,wechat:false,recovery:false};
  let next=discovery;
  const f=renderer(t,html,{
    getAuthMethods:async()=>next,
    login:async()=>assert.fail('managed renderer dispatched demo login'),
    loginPhone:async()=>({ok:false,error:{code:'INVALID_CREDENTIALS',message:'请核对手机号和密码。'}})
  });
  const element=id=>f.d.getElementById(id);
  const demo=element('service-demo-help-title').closest('details');
  const demoOption=element('login-mode').querySelector('option[value="demo"]');
  const submit=()=>element('login-form').dispatchEvent(new f.window.Event('submit',{bubbles:true,cancelable:true}));
  assert.ok(demo.hidden&&demoOption.hidden&&element('login-submit').disabled);
  submit();
  assert.equal(f.calls.some(call=>['login','loginPhone'].includes(call.name)),false);
  deliverDiscovery(ok({mode:'managed-service',methods,desktopWechatReady:false}));
  await until(()=>!element('login-submit').disabled);
  assert.equal(element('login-mode').value,'phone');
  assert.equal(f.d.querySelector('label[for="username"]').textContent,'手机号');
  assert.equal(element('username').inputMode,'tel');
  assert.equal(element('service-preview-label').textContent,'受信 HTTPS 团队服务');
  assert.ok(demo.hidden&&demoOption.hidden&&demoOption.disabled);
  assert.ok(element('wechat-login').disabled&&element('send-bind-code').disabled);
  assert.match(element('service-preview-notice').textContent,/合成验收.*请勿导入真实客户资料/);
  element('login-mode').value='demo';
  element('username').value='13800000000';
  element('password').value='Synthetic-only-secret!';
  submit();
  await until(()=>element('login-message').textContent==='请核对手机号和密码。');
  assert.deepEqual({...f.calls.find(call=>call.name==='loginPhone').args[0]},{phone:'13800000000',password:'Synthetic-only-secret!'});
  assert.equal(f.calls.some(call=>call.name==='login'),false);
  assert.equal(element('password').value,'');
  next=ok({mode:'local-preview',methods:{...methods,demoUsername:true},desktopWechatReady:false});
  element('recovery-panel').open=true;
  await until(()=>element('identity-methods-message').textContent.includes('暂不可读取'));
  assert.ok(demo.hidden&&demoOption.hidden&&element('login-submit').disabled);
  assert.equal(element('login-mode').value,'phone');
});

test('static and malformed presentation metadata retain local preview without creating a service authority',async t=>{
  for(const html of [HTML,HTML.replace('content="local-preview"','content="remote-https"'),HTML.replace('content="local-preview"','content="remote-https"').replace('content="http://127.0.0.1:8774"','content="https://evil.invalid/path"')]){
    const f=renderer(t,html);await until(()=>f.d.getElementById('login-form-caption').textContent==='当前连接本机团队服务');assert.equal(f.d.getElementById('service-demo-help-title').textContent,'本机演示账号说明');assert.equal(f.d.getElementById('service-demo-help-description').textContent,'仅用于明确启用的本机合成演示服务，不是正式用户账号。');assert.equal(f.d.getElementById('service-mode-label').textContent,'本机演示');assert.equal(f.d.getElementById('service-preview-label').textContent,'本机合成演示');
  }
});

test('HTTPS presentation survives required device gate without sending endpoint data through business input',async t=>{
  const filename=await remoteFile(t),main=await start(t,{env:{SHENYI_TEAM_SERVICE_CONFIG:filename}}),html=await(await main.handler({url:'shenyi://app/index.html',method:'GET'})).text();
  let state={required:true,state:'signed_out',epoch:0,device:null,localFingerprint:null,expiresAt:null};
  const f=renderer(t,html,{getDeviceStatus:async()=>ok(state),login:async()=>{state={...state,state:'enrollment_required',epoch:1,localFingerprint:'a'.repeat(64)};return ok({account:{id:'synthetic-a',displayName:'合成员工'},memberships:[],expiresAt:Date.now()+900000,device:state});}});
  await until(()=>!f.d.getElementById('login-submit').disabled);f.d.getElementById('username').value='synthetic-a';f.d.getElementById('password').value='Synthetic-only-secret!';f.d.getElementById('login-form').dispatchEvent(new f.window.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>!f.d.getElementById('device-gate').hidden);assert.match(f.d.getElementById('login-form-caption').textContent,/team\.example\.invalid:9443/);assert.match(f.d.getElementById('login-form-caption').textContent,/在线设备核验/);assert.equal(f.d.getElementById('workspace-view').hidden,true);assert.equal(f.d.getElementById('password').value,'');
  assert.deepEqual({...f.calls.find(call=>call.name==='login').args[0]},{username:'synthetic-a',password:'Synthetic-only-secret!'});
});

test('HTTPS task upload caption names configured service while keeping existing narrow upload input',async t=>{
  const filename=await remoteFile(t),main=await start(t,{env:{SHENYI_TEAM_SERVICE_CONFIG:filename}}),html=await(await main.handler({url:'shenyi://app/index.html',method:'GET'})).text();
  let finishUpload;const pending=new Promise(resolve=>{finishUpload=resolve;}),task={id:'task-a',title:'合成任务',instructions:'合成要求',status:'open'};
  const f=renderer(t,html,{login:async()=>ok({account:{id:'collector-a',displayName:'合成采集员'},memberships:[{teamId:'team-a',role:'intern'}],expiresAt:Date.now()+900000}),listTasks:async()=>ok({tasks:[task],hasMore:false}),getTask:async()=>ok({task}),getSubmissions:async()=>ok({revision:0,submissions:[]}),getTaskSubmissionAccess:async()=>ok({canSubmit:true,revision:0}),chooseAndUpload:async()=>pending});
  await until(()=>!f.d.getElementById('login-submit').disabled);f.d.getElementById('username').value='synthetic-a';f.d.getElementById('password').value='Synthetic-only-secret!';f.d.getElementById('login-form').dispatchEvent(new f.window.Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>f.d.querySelector('.task-button')&&!f.d.getElementById('refresh').disabled);f.d.querySelector('.task-button').click();await until(()=>f.d.getElementById('task-upload')&&!f.d.getElementById('task-upload').disabled);f.d.getElementById('task-upload').click();
  await until(()=>f.calls.some(call=>call.name==='chooseAndUpload'));assert.equal(f.d.getElementById('workspace-message').textContent,'请选择资料；确认后将提交至配置的HTTPS团队服务。');assert.deepEqual({...f.calls.find(call=>call.name==='chooseAndUpload').args[0]},{teamId:'team-a',taskId:'task-a',revision:0});finishUpload(ok({canceled:true}));await until(()=>f.d.getElementById('workspace-message').textContent.includes('已取消'));
});


test('version 3 checkout profile stays private while main injects a distinct fake-shell callback',async t=>{
  const profile={...PROFILE,schemaVersion:3,checkoutOrigin:'https://127.0.0.1:43322'},filename=await remoteFile(t,profile),seen=await start(t,{env:{SHENYI_TEAM_SERVICE_CONFIG:filename},isPackaged:true});
  assert.equal(seen.clientOptions.trustedService.checkoutOrigin,profile.checkoutOrigin);assert.equal(typeof seen.clientOptions.openCheckoutExternal,'function');assert.deepEqual(seen.external,[]);
  await seen.clientOptions.openCheckoutExternal(profile.checkoutOrigin+'/checkout/#handoff=synthetic');assert.deepEqual(seen.external,[profile.checkoutOrigin+'/checkout/#handoff=synthetic']);
  const html=await(await seen.handler({url:'shenyi://app/index.html',method:'GET'})).text();assert.equal(html.includes(profile.checkoutOrigin),false);assert.equal(html.includes(profile.serverId),false);
});
