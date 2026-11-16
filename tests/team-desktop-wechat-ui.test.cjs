'use strict';
const {withDeviceDiagnostic}=require('./helpers/desktop-device-diagnostic.cjs');
// Synthetic bridge + actual renderer DOM. No browser, QR, SMS, or WeChat traffic.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/index.html'),'utf8');
const renderer=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/team-ui.js'),'utf8');
const SESSION={account:{id:'intern-a',displayName:'合成关联员工'},memberships:[{teamId:'team-a',role:'intern'}],expiresAt:Date.now()+3600000};
const METHODS={mode:'local-preview',desktopWechatReady:true,methods:{demoUsername:true,phonePassword:true,phoneVerification:false,wechat:true,recovery:false}};
const safe=value=>({ok:true,value});const failure=(code,message)=>({ok:false,error:{code,message}});
const deferred=()=>{let resolve;const promise=new Promise(finish=>{resolve=finish;});return {promise,resolve};};
async function until(check){for(let n=0;n<80;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,0));}assert.ok(check(),'renderer did not reach expected state');}
function fixture(t,overrides={}){
  const dom=new JSDOM(html,{url:'shenyi://app/index.html',runScripts:'outside-only'}),{window}=dom,d=window.document,calls=[],timers=new Map(),writes=[];
  const originalTimer=window.setTimeout.bind(window),originalClear=window.clearTimeout.bind(window);let next=0;
  window.setTimeout=(action,delay,...args)=>{if(delay!==2000)return originalTimer(action,delay,...args);const id={poll:++next};timers.set(id,()=>action(...args));return id;};
  window.clearTimeout=id=>{if(timers.has(id))timers.delete(id);else originalClear(id);};
  Object.defineProperty(window,'localStorage',{value:{setItem:(...args)=>writes.push(args),getItem:()=>null,removeItem:()=>{},clear:()=>{}}});
  const defaults={getAuthMethods:async()=>safe(METHODS),startWechatLogin:async()=>safe({status:'pending',expiresAt:Date.now()+300000}),pollWechatLogin:async()=>safe({status:'pending',expiresAt:Date.now()+300000}),cancelWechatLogin:async()=>safe({canceled:true}),linkWechatAccount:async()=>safe({status:'signed_in',session:SESSION}),login:async()=>safe(SESSION),loginPhone:async()=>safe(SESSION),listTasks:async()=>safe({tasks:[],hasMore:false}),logout:async()=>safe({signedOut:true})};
  window.shenyiTeam=Object.fromEntries(Object.entries({...defaults,...overrides}).map(([name,action])=>[name,typeof action==='function'?async arg=>{calls.push({name,arg});return action(arg);}:action]));
  window.shenyiTeam=withDeviceDiagnostic(window.shenyiTeam);window.eval(renderer);t.after(()=>{timers.clear();window.close();});
  return {window,d,calls,timers,writes,id:name=>d.getElementById(name),click:name=>d.getElementById(name).click(),poll(){const entry=timers.entries().next().value;assert.ok(entry,'no scheduled poll');timers.delete(entry[0]);entry[1]();}};
}
async function ready(f){await until(()=>!f.id('wechat-login').disabled);}
async function start(f){await ready(f);f.click('wechat-login');await until(()=>f.timers.size===1||!f.id('wechat-link-fields').hidden||f.id('wechat-status').textContent.includes('过期'));}
const count=(f,name)=>f.calls.filter(call=>call.name===name).length;

test('both trusted desktop readiness and all narrow methods are required',async t=>{
  for(const overrides of [{getAuthMethods:async()=>safe({...METHODS,desktopWechatReady:false})},{pollWechatLogin:undefined}]){
    const f=fixture(t,overrides);await until(()=>f.id('wechat-message').textContent.includes('桌面授权配置未就绪'));
    assert.equal(f.id('wechat-login').disabled,true);f.click('wechat-login');assert.equal(count(f,'startWechatLogin'),0);
  }
});

test('browser authorization completes through polling without exposing or persisting secrets',async t=>{
  const f=fixture(t,{pollWechatLogin:async()=>safe({status:'signed_in',session:SESSION})});await start(f);
  assert.equal(f.id('wechat-cancel').disabled,false);assert.equal(f.id('wechat-login').disabled,true);assert.equal(f.id('wechat-link-fields').hidden,true);
  assert.equal(count(f,'pollWechatLogin'),0);f.poll();await until(()=>!f.id('workspace-view').hidden&&!f.id('logout').disabled);
  assert.equal(f.id('account-name').textContent,SESSION.account.displayName);assert.equal(f.id('role-label').textContent,'实习生');assert.equal(f.id('wechat-progress').hidden,true);assert.equal(f.timers.size,0);
  assert.deepEqual(f.calls.filter(call=>['startWechatLogin','pollWechatLogin'].includes(call.name)).map(call=>call.arg),[undefined,undefined]);
  assert.deepEqual(f.writes,[]);assert.equal(f.d.querySelector('img[alt*="二维码"]'),null);assert.equal(f.d.querySelectorAll('form').length,19);
  for(const input of f.d.querySelectorAll('input[type=password]'))assert.equal(input.value,'');
});

test('polling does not overlap and cancellation rejects a late successful response',async t=>{
  const response=deferred();const f=fixture(t,{pollWechatLogin:()=>response.promise});await start(f);f.poll();await until(()=>count(f,'pollWechatLogin')===1);
  assert.equal(f.timers.size,0);assert.equal(f.id('wechat-cancel').disabled,false);f.click('wechat-cancel');await until(()=>count(f,'cancelWechatLogin')===1);
  response.resolve(safe({status:'signed_in',session:SESSION}));await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(f.id('workspace-view').hidden,true);assert.equal(f.id('account-name').textContent,'');assert.equal(f.timers.size,0);assert.match(f.id('wechat-status').textContent,/已取消/);assert.equal(f.id('wechat-login').disabled,false);
});

test('cancel remains usable while the system browser launch is pending',async t=>{
  const response=deferred();const f=fixture(t,{startWechatLogin:()=>response.promise});await ready(f);f.click('wechat-login');assert.equal(f.id('wechat-cancel').disabled,false);f.click('wechat-cancel');
  response.resolve(safe({status:'pending',expiresAt:Date.now()+300000}));await until(()=>count(f,'cancelWechatLogin')===1);await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(f.timers.size,0);assert.equal(f.id('wechat-link-fields').hidden,true);assert.equal(f.id('workspace-view').hidden,true);assert.equal(f.id('wechat-login').disabled,false);
});

test('the active authorization keeps its confirmation and escape controls available without a second credential form',async t=>{
  const launch=deferred(),association=deferred();const f=fixture(t,{startWechatLogin:()=>launch.promise,pollWechatLogin:async()=>safe({status:'binding_required',expiresAt:Date.now()+300000}),linkWechatAccount:()=>association.promise});
  await ready(f);assert.equal(f.id('ordinary-login-fields').hidden,false);f.click('wechat-login');
  const focused=()=>{assert.equal(f.id('ordinary-login-fields').hidden,true);assert.equal(f.id('username').disabled,true);assert.equal(f.id('password').disabled,true);assert.equal(f.id('login-mode').disabled,false);assert.equal(f.id('wechat-cancel').disabled,false);assert.equal(f.id('wechat-cancel').closest('[hidden]'),null);};
  focused();launch.resolve(safe({status:'pending',expiresAt:Date.now()+300000}));await until(()=>f.timers.size===1);focused();f.poll();await until(()=>!f.id('wechat-link-fields').hidden);focused();assert.equal(f.id('wechat-link-phone').closest('[hidden]'),null);assert.equal(f.id('wechat-link-submit').disabled,false);
  f.id('wechat-link-phone').value='13800138000';f.id('wechat-link-password').value='synthetic password';f.click('wechat-link-submit');focused();f.click('wechat-cancel');assert.equal(f.id('ordinary-login-fields').hidden,false);assert.equal(f.id('username').disabled,false);assert.equal(f.id('password').disabled,false);assert.equal(f.id('login-submit').disabled,false);
  association.resolve(safe({status:'signed_in',session:SESSION}));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.id('workspace-view').hidden,true);assert.equal(f.id('ordinary-login-fields').hidden,false);
});

test('first association requires explicit account confirmation, clears failed proof and can retry',async t=>{
  let attempts=0;const f=fixture(t,{pollWechatLogin:async()=>safe({status:'binding_required',expiresAt:Date.now()+300000}),linkWechatAccount:async()=>++attempts===1?failure('HTTP_401','手机号或密码无效。'):safe({status:'signed_in',session:SESSION})});
  await start(f);f.poll();await until(()=>!f.id('wechat-link-fields').hidden);assert.equal(f.timers.size,0);assert.match(f.id('wechat-link-fields').textContent,/不会新建员工或加入其他团队/);
  f.click('wechat-link-submit');assert.equal(count(f,'linkWechatAccount'),0);assert.match(f.id('wechat-status').textContent,/请填写/);
  f.id('wechat-link-phone').value='13800138000';f.id('wechat-link-password').value='wrong proof';f.click('wechat-link-submit');await until(()=>f.id('wechat-status').textContent.includes('手机号或密码无效'));
  assert.equal(f.id('wechat-link-password').value,'');assert.equal(f.id('wechat-link-submit').disabled,false);assert.equal(f.id('workspace-view').hidden,true);
  f.id('wechat-link-password').value='synthetic current password';f.click('wechat-link-submit');await until(()=>!f.id('workspace-view').hidden&&!f.id('logout').disabled);
  const links=f.calls.filter(call=>call.name==='linkWechatAccount');assert.deepEqual({...links[1].arg},{phone:'13800138000',password:'synthetic current password'});assert.equal(f.id('wechat-link-phone').value,'');assert.equal(f.id('wechat-link-password').value,'');assert.deepEqual(f.writes,[]);
});

test('cancel during association clears credentials and ignores its late result',async t=>{
  const response=deferred();const f=fixture(t,{pollWechatLogin:async()=>safe({status:'binding_required',expiresAt:Date.now()+300000}),linkWechatAccount:()=>response.promise});await start(f);f.poll();await until(()=>!f.id('wechat-link-fields').hidden);
  f.id('wechat-link-phone').value='13800138000';f.id('wechat-link-password').value='private proof';f.click('wechat-link-submit');assert.equal(f.id('wechat-link-submit').disabled,true);assert.equal(f.id('wechat-cancel').disabled,false);f.click('wechat-cancel');
  response.resolve(safe({status:'signed_in',session:SESSION}));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.id('wechat-link-phone').value,'');assert.equal(f.id('wechat-link-password').value,'');assert.equal(f.id('workspace-view').hidden,true);
});

test('changing the ordinary login mode cancels polling and clears identity inputs',async t=>{
  const f=fixture(t);await start(f);f.id('wechat-link-password').value='previous proof';f.id('username').value='previous user';f.id('password').value='previous password';f.id('login-mode').value='phone';f.id('login-mode').dispatchEvent(new f.window.Event('change'));
  await until(()=>count(f,'cancelWechatLogin')===1);assert.equal(f.timers.size,0);assert.equal(f.id('wechat-progress').hidden,true);for(const name of ['username','password','wechat-link-phone','wechat-link-password'])assert.equal(f.id(name).value,'');
});

test('ordinary login supersedes a pending poll and a late 401 cannot log out the new account',async t=>{
  const response=deferred();const f=fixture(t,{pollWechatLogin:()=>response.promise});await start(f);f.poll();f.id('username').value='intern-a';f.id('password').value='synthetic password';f.id('login-form').dispatchEvent(new f.window.Event('submit',{cancelable:true,bubbles:true}));await until(()=>!f.id('workspace-view').hidden&&!f.id('logout').disabled);
  response.resolve(failure('SIGN_IN_REQUIRED','旧账号已失效。'));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('account-name').textContent,SESSION.account.displayName);assert.equal(f.timers.size,0);assert.equal(count(f,'cancelWechatLogin'),1);
});

test('expired, canceled and failed transactions stop polling and allow a fresh attempt',async t=>{
  for(const state of ['expired','canceled','failed','idle']){
    const f=fixture(t,{pollWechatLogin:async()=>safe({status:state,expiresAt:Date.now()+300000})});await start(f);f.poll();await until(()=>!f.id('wechat-login').disabled);
    assert.equal(f.timers.size,0);assert.equal(f.id('wechat-cancel').hidden,true);assert.equal(f.id('wechat-link-fields').hidden,true);assert.equal(f.id('workspace-view').hidden,true);
    f.click('wechat-login');await until(()=>f.timers.size===1);assert.equal(count(f,'startWechatLogin'),2);
  }
});

test('expired start cannot reveal an association form or schedule polling',async t=>{
  const f=fixture(t,{startWechatLogin:async()=>safe({status:'pending',expiresAt:Date.now()-1})});await start(f);assert.match(f.id('wechat-status').textContent,/已过期/);assert.equal(f.id('wechat-link-fields').hidden,true);assert.equal(f.timers.size,0);assert.equal(f.id('wechat-login').disabled,false);
});

test('a busy main process is polled again without overlapping or hiding cancellation',async t=>{
  let attempts=0;const f=fixture(t,{pollWechatLogin:async()=>++attempts===1?failure('WECHAT_BUSY','正在验证。'):safe({status:'signed_in',session:SESSION})});await start(f);f.poll();await until(()=>f.id('wechat-status').textContent.includes('授权验证处理中'));
  assert.equal(f.timers.size,1);assert.equal(f.id('wechat-cancel').disabled,false);f.poll();await until(()=>!f.id('workspace-view').hidden);assert.equal(count(f,'pollWechatLogin'),2);
});

test('an association that expires in the main process becomes terminal and clears proof',async t=>{
  const f=fixture(t,{pollWechatLogin:async()=>safe({status:'binding_required',expiresAt:Date.now()+300000}),linkWechatAccount:async()=>failure('HTTP_410','操作未完成。')});await start(f);f.poll();await until(()=>!f.id('wechat-link-fields').hidden);f.id('wechat-link-phone').value='13800138000';f.id('wechat-link-password').value='synthetic password';f.click('wechat-link-submit');await until(()=>f.id('wechat-status').textContent.includes('已过期'));
  assert.equal(f.id('wechat-link-fields').hidden,true);assert.equal(f.id('wechat-link-password').value,'');assert.equal(f.id('wechat-link-phone').value,'');assert.equal(f.id('wechat-login').disabled,false);assert.equal(f.timers.size,0);
});

test('an authoritative session expiry clears the association form and explains the login state',async t=>{
  const f=fixture(t,{pollWechatLogin:async()=>safe({status:'binding_required',expiresAt:Date.now()+300000}),linkWechatAccount:async()=>failure('SIGN_IN_REQUIRED','账号已失效，请重新登录。')});await start(f);f.poll();await until(()=>!f.id('wechat-link-fields').hidden);f.id('wechat-link-phone').value='13800138000';f.id('wechat-link-password').value='synthetic password';f.click('wechat-link-submit');await until(()=>f.id('login-message').textContent.includes('账号已失效'));
  assert.equal(f.id('wechat-progress').hidden,true);assert.equal(f.id('wechat-link-phone').value,'');assert.equal(f.id('wechat-link-password').value,'');assert.equal(f.id('workspace-view').hidden,true);
});

test('an un-linkable transaction is terminal rather than an endless confirmation retry',async t=>{
  const f=fixture(t,{pollWechatLogin:async()=>safe({status:'binding_required',expiresAt:Date.now()+300000}),linkWechatAccount:async()=>failure('WECHAT_NOT_LINKABLE','请先扫码。')});await start(f);f.poll();await until(()=>!f.id('wechat-link-fields').hidden);f.id('wechat-link-phone').value='13800138000';f.id('wechat-link-password').value='synthetic password';f.click('wechat-link-submit');await until(()=>f.id('wechat-status').textContent.includes('状态已改变'));
  assert.equal(f.id('wechat-link-fields').hidden,true);assert.equal(f.id('wechat-link-phone').value,'');assert.equal(f.id('wechat-link-password').value,'');assert.equal(f.id('wechat-login').disabled,false);await until(()=>count(f,'cancelWechatLogin')===1);
});

test('Enter in association proof confirms only that association and never submits the demo form',async t=>{
  const f=fixture(t,{pollWechatLogin:async()=>safe({status:'binding_required',expiresAt:Date.now()+300000})});await start(f);f.poll();await until(()=>!f.id('wechat-link-fields').hidden);f.id('wechat-link-phone').value='13800138000';f.id('wechat-link-password').value='synthetic password';
  const event=new f.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});f.id('wechat-link-password').dispatchEvent(event);await until(()=>!f.id('workspace-view').hidden);assert.equal(event.defaultPrevented,true);assert.equal(count(f,'linkWechatAccount'),1);assert.equal(count(f,'login'),0);
});

test('window unload cancels active authorization, clears proof and stops future polls',async t=>{
  const f=fixture(t);await start(f);f.id('wechat-link-phone').value='13800138000';f.id('wechat-link-password').value='private proof';f.window.dispatchEvent(new f.window.Event('beforeunload'));await until(()=>count(f,'cancelWechatLogin')===1);assert.equal(f.timers.size,0);assert.equal(f.id('wechat-progress').hidden,true);assert.equal(f.id('wechat-link-phone').value,'');assert.equal(f.id('wechat-link-password').value,'');
});
