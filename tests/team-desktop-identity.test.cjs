'use strict';
// Identity extension acceptance: actual client, IPC guard and real renderer DOM.
// Providers are synthetic; this never sends a real SMS or opens WeChat.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const {createTeamClient}=require('../desktop/team-client.cjs');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const TOKEN='a'.repeat(43);
const SESSION={account:{id:'intern-a',displayName:'合成员工'},memberships:[{teamId:'team-a',role:'intern'}],expiresAt:Date.now()+3600000};
const METHODS={mode:'local-preview',methods:{demoUsername:true,phonePassword:true,phoneVerification:false,wechat:false,recovery:false}};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const clientFixture=responder=>{const calls=[];return {calls,client:createTeamClient({fetchImpl:async(url,options)=>{calls.push({url,options});return responder(url,options);}})};};
const demoLogin=client=>client.login({username:'intern-a',password:'ShenyiDemo!2026'});
const safe=value=>({ok:true,value});
const html=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/index.html'),'utf8');
const renderer=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/team-ui.js'),'utf8');
async function waitFor(check){for(let i=0;i<80;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,0));}assert.ok(check(),'renderer did not reach expected state');}
function domFixture(t,overrides={}){
  const calls=[];const bridge={getAuthMethods:async()=>safe(METHODS),login:async value=>{calls.push({method:'login',value});return safe(SESSION);},loginPhone:async value=>{calls.push({method:'loginPhone',value});return safe(SESSION);},listTasks:async()=>safe({tasks:[],hasMore:false}),logout:async()=>safe({signedOut:true}),...overrides};
  const dom=new JSDOM(html,{url:APP_URL,runScripts:'outside-only'});const storageWrites=[];
  // jsdom treats custom app schemes as opaque. Supply an observable storage host
  // rather than claiming its SecurityError proves the renderer never persists.
  const storage=new Proxy({setItem:(...args)=>storageWrites.push(args),getItem:()=>null,removeItem:()=>{},clear:()=>{},length:0},{set:(_target,key,value)=>{storageWrites.push([key,value]);return true;}});
  Object.defineProperty(dom.window,'localStorage',{value:storage});dom.window.shenyiTeam=bridge;dom.window.eval(renderer);t.after(()=>dom.window.close());return {window:dom.window,d:dom.window.document,calls,storageWrites};
}
function submit(window,id){window.document.getElementById(id).dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));}
async function signIn(f){f.d.getElementById('username').value='intern-a';f.d.getElementById('password').value='ShenyiDemo!2026';submit(f.window,'login-form');await waitFor(()=>!f.d.getElementById('workspace-view').hidden&&!f.d.getElementById('logout').disabled);}

test('capability response is unauthenticated and returns only explicit boolean methods',async()=>{
  const f=clientFixture(()=>json({...METHODS,secret:'do not show',methods:{...METHODS.methods,appSecret:'do not show'}}));
  assert.deepEqual(await f.client.getAuthMethods(),{...METHODS,desktopWechatReady:false});assert.equal(f.calls[0].options.headers.Authorization,undefined);
  const broken=clientFixture(()=>json({...METHODS,methods:{...METHODS.methods,wechat:'true'}}));await assert.rejects(()=>broken.client.getAuthMethods(),e=>e.code==='INVALID_RESPONSE');
});
test('phone password login keeps bearer in main and uses the same account identity',async()=>{
  const f=clientFixture(()=>json({token:TOKEN,...SESSION,phone:'13800138000',wechatOpenId:'secret'}));
  assert.deepEqual(await f.client.loginPhone({phone:'13800138000',password:'ShenyiDemo!2026'}),SESSION);
  assert.match(f.calls[0].url,/\/api\/auth\/phone\/login$/);assert.equal(f.calls[0].options.headers.Authorization,undefined);
  assert.deepEqual(JSON.parse(f.calls[0].options.body),{phone:'13800138000',password:'ShenyiDemo!2026'});
});
test('bind challenge fixes purpose and strips provider codes and phone echoes',async()=>{
  const expiry=Date.now()+300000;const f=clientFixture(url=>url.endsWith('/login')?json({token:TOKEN,...SESSION}):json({challengeId:'challenge-a',expiresAt:expiry,code:'123456',phone:'13800138000',providerSecret:'never show'}));
  await demoLogin(f.client);assert.deepEqual(await f.client.requestPhoneBind({phone:'13800138000'}),{challengeId:'challenge-a',expiresAt:expiry});
  assert.deepEqual(JSON.parse(f.calls[1].options.body),{phone:'13800138000',purpose:'bind'});assert.equal(f.calls[1].options.headers.Authorization,'Bearer '+TOKEN);
});
test('bind result is a masked allowlist and unavailable provider text is never forwarded',async()=>{
  const f=clientFixture(url=>url.endsWith('/login')?json({token:TOKEN,...SESSION}):json({phoneVerified:true,phoneMasked:'138****8000',phone:'13800138000',code:'123456'}));
  await demoLogin(f.client);assert.deepEqual(await f.client.bindPhone({challengeId:'challenge-a',code:'123456',currentPassword:'ShenyiDemo!2026'}),{phoneVerified:true,phoneMasked:'138****8000'});
  const disabled=clientFixture(url=>url.endsWith('/login')?json({token:TOKEN,...SESSION}):json({error:{code:'SMS_UNAVAILABLE',message:'secret provider route'}},503));await demoLogin(disabled.client);
  await assert.rejects(()=>disabled.client.requestPhoneBind({phone:'13800138000'}),e=>e.status===503&&e.message.includes('短信验证服务尚未开通')&&!e.message.includes('secret'));
});
test('phone operation rejects forged purpose, role, malformed phones and verification payload before network',async()=>{
  const f=clientFixture(()=>json({token:TOKEN,...SESSION}));await demoLogin(f.client);const before=f.calls.length;
  for(const value of [{phone:'13800138000',purpose:'reset'},{phone:'13800138000',role:'partner'},{phone:13800138000},{phone:'13800138000/secret'}])await assert.rejects(()=>f.client.requestPhoneBind(value));
  await assert.rejects(()=>f.client.loginPhone({phone:'13800138000',password:'x',server:'https://evil.invalid'}));
  await assert.rejects(()=>f.client.bindPhone({challengeId:'a/b',code:'123456',currentPassword:'x'}));
  await assert.rejects(()=>f.client.bindPhone({challengeId:'challenge-a',code:'12345x',currentPassword:'x'}));assert.equal(f.calls.length,before);
});
test('late challenge after account logout cannot restore previous account proof state',async()=>{
  let finish;const f=clientFixture(url=>url.endsWith('/login')?json({token:TOKEN,...SESSION}):url.endsWith('/logout')?json({signedOut:true}):new Promise(resolve=>{finish=resolve;}));await demoLogin(f.client);
  const pending=f.client.requestPhoneBind({phone:'13800138000'});await f.client.logout();finish(json({challengeId:'old-challenge',expiresAt:Date.now()+300000,code:'123456'}));await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED');assert.equal(await f.client.getSession(),null);
});
test('IPC identity extension contains exactly forty-four narrow channels and rejects untrusted senders',async()=>{
  const handlers=new Map(),mainFrame={url:APP_URL},webContents={mainFrame},win={webContents};
  const names=['login','auth-methods','phone-login','phone-challenge','phone-bind','wechat-start','wechat-poll','wechat-cancel','wechat-link','onboarding-status','invitation-access','invitation-create','invitation-list','invitation-revoke','activation-preview','activation-challenge','activation-complete','account-sessions','account-session-revoke','account-sessions-revoke-others','account-sessions-revoke-all','password-change','recovery-review-status','recovery-review-create','recovery-review-access','recovery-review-list','recovery-review-decide','recovery-challenge','recovery-complete','team-review-access','team-review-list','team-review-create','team-review-decide','team-administration','first-admin-preview','first-admin-challenge','first-admin-complete','session','logout','tasks','task','submissions','upload','download'];
  const calls=[];const client={getAuthMethods:async()=>METHODS,loginPhone:async value=>{calls.push(value);return SESSION;},requestPhoneBind:async value=>value,bindPhone:async value=>value,clearSession:()=>{}};
  const dispose=registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window:win,client,dialog:{}});
  assert.deepEqual([...handlers.keys()].sort(),names.map(name=>'shenyi:'+name).sort());
  for(const name of ['auth-methods','phone-login','phone-challenge','phone-bind','wechat-start','wechat-poll','wechat-cancel','wechat-link','onboarding-status','invitation-access','invitation-create','invitation-list','invitation-revoke','activation-preview','activation-challenge','activation-complete','account-sessions','account-session-revoke','account-sessions-revoke-others','account-sessions-revoke-all','password-change','recovery-review-status','recovery-review-create','recovery-review-access','recovery-review-list','recovery-review-decide','recovery-challenge','recovery-complete','team-review-access','team-review-list','team-review-create','team-review-decide','team-administration','first-admin-preview','first-admin-challenge','first-admin-complete']){
    for(const event of [{sender:{},senderFrame:mainFrame},{sender:webContents,senderFrame:{url:APP_URL}},{sender:webContents,senderFrame:{url:'https://evil.invalid'}}])assert.equal((await handlers.get('shenyi:'+name)(event,{})).error.code,'UNTRUSTED_SENDER');
  }
  const event={sender:webContents,senderFrame:mainFrame};assert.equal((await handlers.get('shenyi:phone-login')(event,{phone:'13800138000',password:'x',role:'partner'})).ok,false);assert.equal(calls.length,0);dispose();assert.equal(handlers.size,0);
});
test('preload exposes only named identity methods, not raw IPC, network or bearer storage',()=>{
  let exposed;const channelCalls=[];vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/preload.cjs'),'utf8'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'shenyiTeam');exposed=value;}},ipcRenderer:{invoke:(...args)=>channelCalls.push(args)}};}});
  assert.deepEqual(Object.keys(exposed).sort(),['login','getAuthMethods','loginPhone','requestPhoneBind','bindPhone','startWechatLogin','pollWechatLogin','cancelWechatLogin','linkWechatAccount','getOnboardingStatus','getInvitationAccess','createEmployeeInvitation','listEmployeeInvitations','revokeEmployeeInvitation','previewEmployeeInvitation','requestEmployeeActivation','activateEmployee','listAccountSessions','revokeAccountSession','revokeOtherSessions','revokeAllSessions','changeOwnPassword','getRecoveryReviewStatus','createRecoveryReviewRequest','getRecoveryReviewAccess','listRecoveryReviewRequests','reviewRecoveryReviewRequest','requestPasswordRecovery','recoverPassword','getTeamProvisioningAccess','listTeamProvisioningRequests','createTeamProvisioningRequest','reviewTeamProvisioningRequest','getTeamAdministration','previewFirstAdministrator','requestFirstAdministratorActivation','activateFirstAdministrator','getSession','logout','listTasks','getTask','getSubmissions','chooseAndUpload','downloadAttachment'].sort());exposed.getAuthMethods();exposed.requestPhoneBind({phone:'13800138000'});assert.deepEqual(channelCalls.map(value=>value[0]),['shenyi:auth-methods','shenyi:phone-challenge']);assert.equal(exposed.fetch,undefined);assert.equal(exposed.token,undefined);
});
test('unconfigured providers are honest disabled states, including after login and busy transitions',async t=>{
  const f=domFixture(t);await waitFor(()=>f.d.getElementById('identity-methods-message').textContent.includes('正式方向'));
  assert.equal(f.d.getElementById('wechat-login').disabled,true);assert.match(f.d.getElementById('wechat-message').textContent,/尚未配置/);assert.equal(f.d.querySelector('img[alt*="二维码"]'),null);
  await signIn(f);assert.equal(f.d.getElementById('phone-bind-fields').disabled,true);assert.equal(f.d.getElementById('send-bind-code').disabled,true);assert.equal(f.d.getElementById('wechat-login').disabled,true);assert.match(f.d.getElementById('phone-service-status').textContent,/尚未开通/);
});
test('configured server without trusted desktop configuration remains disabled',async t=>{
  const f=domFixture(t,{getAuthMethods:async()=>safe({...METHODS,methods:{...METHODS.methods,wechat:true}})});await waitFor(()=>f.d.getElementById('wechat-message').textContent.includes('桌面授权配置未就绪'));assert.equal(f.d.getElementById('wechat-login').disabled,true);assert.match(f.d.getElementById('wechat-login').textContent,/桌面配置未就绪/);
});
test('phone mode submits phone credentials and changing mode clears previous identity inputs',async t=>{
  const f=domFixture(t);await waitFor(()=>!f.d.querySelector('#login-mode option[value=phone]').disabled);const mode=f.d.getElementById('login-mode');f.d.getElementById('username').value='intern-a';f.d.getElementById('password').value='old password';mode.value='phone';mode.dispatchEvent(new f.window.Event('change'));
  assert.equal(f.d.getElementById('username').value,'');assert.equal(f.d.getElementById('password').value,'');f.d.getElementById('username').value='13800138000';f.d.getElementById('password').value='ShenyiDemo!2026';submit(f.window,'login-form');await waitFor(()=>!f.d.getElementById('workspace-view').hidden);assert.equal(f.calls[0].method,'loginPhone');assert.deepEqual({...f.calls[0].value},{phone:'13800138000',password:'ShenyiDemo!2026'});assert.equal(f.d.getElementById('password').value,'');
});
test('configured first-bind flow uses current proof, clears secrets and displays only the masked result',async t=>{
  const proofs=[];const f=domFixture(t,{getAuthMethods:async()=>safe({...METHODS,methods:{...METHODS.methods,phoneVerification:true}}),requestPhoneBind:async value=>{assert.equal(value.phone,'13800138000');return safe({challengeId:'challenge-a',expiresAt:Date.now()+300000});},bindPhone:async value=>{proofs.push(value);return safe({phoneVerified:true,phoneMasked:'138****8000'});}});await signIn(f);await waitFor(()=>!f.d.getElementById('send-bind-code').disabled);f.d.getElementById('bind-phone').value='13800138000';f.d.getElementById('send-bind-code').click();await waitFor(()=>!f.d.getElementById('bind-phone-submit').disabled);f.d.getElementById('bind-code').value='123456';f.d.getElementById('bind-current-password').value='ShenyiDemo!2026';submit(f.window,'phone-bind-form');await waitFor(()=>f.d.getElementById('phone-bind-message').textContent.includes('138****8000'));
  assert.deepEqual({...proofs[0]},{challengeId:'challenge-a',code:'123456',currentPassword:'ShenyiDemo!2026'});for(const id of ['bind-phone','bind-code','bind-current-password'])assert.equal(f.d.getElementById(id).value,'');assert.equal(f.d.getElementById('bind-phone-submit').disabled,true);assert.deepEqual(f.storageWrites,[]);assert.ok(!f.d.getElementById('phone-bind-message').textContent.includes('13800138000'));
});
test('changing bind phone invalidates old proof; logout clears all identity fields and messages',async t=>{
  const f=domFixture(t,{getAuthMethods:async()=>safe({...METHODS,methods:{...METHODS.methods,phoneVerification:true}}),requestPhoneBind:async()=>safe({challengeId:'challenge-a',expiresAt:Date.now()+300000})});await signIn(f);await waitFor(()=>!f.d.getElementById('send-bind-code').disabled);f.d.getElementById('bind-phone').value='13800138000';f.d.getElementById('send-bind-code').click();await waitFor(()=>!f.d.getElementById('bind-phone-submit').disabled);f.d.getElementById('bind-code').value='123456';f.d.getElementById('bind-current-password').value='private current password';f.d.getElementById('bind-phone').value='13900139000';f.d.getElementById('bind-phone').dispatchEvent(new f.window.Event('input'));
  assert.equal(f.d.getElementById('bind-code').value,'');assert.equal(f.d.getElementById('bind-current-password').value,'');assert.equal(f.d.getElementById('bind-phone-submit').disabled,true);f.d.getElementById('logout').click();await waitFor(()=>!f.d.getElementById('login-view').hidden);assert.equal(f.d.getElementById('bind-phone').value,'');assert.equal(f.d.getElementById('phone-bind-message').textContent,'');assert.equal(f.d.getElementById('phone-bind-panel').open,false);assert.equal(f.d.getElementById('wechat-login').disabled,true);
});
test('a pending challenge cannot attach to a changed phone input',async t=>{
  let finish;
  const f=domFixture(t,{getAuthMethods:async()=>safe({...METHODS,methods:{...METHODS.methods,phoneVerification:true}}),requestPhoneBind:()=>new Promise(resolve=>{finish=resolve;})});
  await signIn(f);await waitFor(()=>!f.d.getElementById('send-bind-code').disabled);
  f.d.getElementById('bind-phone').value='13800138000';f.d.getElementById('send-bind-code').click();await waitFor(()=>typeof finish==='function');
  f.d.getElementById('bind-phone').value='13900139000';f.d.getElementById('bind-phone').dispatchEvent(new f.window.Event('input'));
  finish(safe({challengeId:'old-challenge',expiresAt:Date.now()+300000}));await waitFor(()=>!f.d.getElementById('send-bind-code').disabled);
  assert.equal(f.d.getElementById('bind-phone-submit').disabled,true);assert.equal(f.d.getElementById('bind-code').value,'');assert.equal(f.d.getElementById('bind-current-password').value,'');
});
test('revocation during binding clears old account proof and cannot restore account DOM',async t=>{
  const f=domFixture(t,{getAuthMethods:async()=>safe({...METHODS,methods:{...METHODS.methods,phoneVerification:true}}),requestPhoneBind:async()=>safe({challengeId:'challenge-a',expiresAt:Date.now()+300000}),bindPhone:async()=>({ok:false,error:{code:'SIGN_IN_REQUIRED',message:'登录已失效，请重新登录。'}})});
  await signIn(f);await waitFor(()=>!f.d.getElementById('send-bind-code').disabled);
  f.d.getElementById('phone-bind-panel').open=true;f.d.getElementById('bind-phone').value='13800138000';f.d.getElementById('send-bind-code').click();await waitFor(()=>!f.d.getElementById('bind-phone-submit').disabled);
  f.d.getElementById('bind-code').value='123456';f.d.getElementById('bind-current-password').value='private current password';submit(f.window,'phone-bind-form');await waitFor(()=>!f.d.getElementById('login-view').hidden);
  for(const id of ['username','password','bind-phone','bind-code','bind-current-password'])assert.equal(f.d.getElementById(id).value,'');
  for(const id of ['account-name','role-label','phone-bind-message'])assert.equal(f.d.getElementById(id).textContent,'');
  assert.equal(f.d.getElementById('workspace-view').hidden,true);assert.equal(f.d.getElementById('phone-bind-panel').open,false);assert.equal(f.d.getElementById('bind-phone-submit').disabled,true);assert.deepEqual(f.storageWrites,[]);
});
