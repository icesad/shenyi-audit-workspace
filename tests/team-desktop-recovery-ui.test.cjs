'use strict';
const {withDeviceDiagnostic}=require('./helpers/desktop-device-diagnostic.cjs');
// Actual renderer DOM with a narrow synthetic bridge; no real SMS or recovery.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/index.html'),'utf8'),script=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/team-ui.js'),'utf8');
const PHONE='13800138000',PASSWORD='Recovered Secret!2026',PROOF='  synthetic independent proof  ',SESSION={account:{id:'synthetic-employee',displayName:'合成员工'},memberships:[{teamId:'team-a',role:'intern'}],expiresAt:Date.now()+3600000};
const safe=value=>({ok:true,value}),fail=(code,message)=>({ok:false,error:{code,message}}),deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
const count=(f,name)=>f.calls.filter(c=>c.name===name).length;
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,0));}assert.ok(check(),'renderer state not reached');}
function fixture(t,overrides={}){
  const dom=new JSDOM(html,{url:'shenyi://app/index.html',runScripts:'outside-only'}),{window}=dom,d=window.document,calls=[],writes=[];
  Object.defineProperty(window,'localStorage',{value:new Proxy({setItem:(...args)=>writes.push(args),getItem:()=>null,removeItem(){},clear(){}},{set:(_target,key,value)=>{writes.push([key,value]);return true;}})});
  const defaults={getAuthMethods:async()=>safe({mode:'local-preview',desktopWechatReady:false,methods:{demoUsername:true,phonePassword:true,phoneVerification:true,wechat:false,recovery:true}}),getOnboardingStatus:async()=>safe({available:false,invitationOnly:true}),login:async()=>safe(SESSION),loginPhone:async()=>safe(SESSION),logout:async()=>safe({signedOut:true}),listTasks:async()=>safe({tasks:[],hasMore:false}),getInvitationAccess:async()=>safe({canInvite:false}),getTeamProvisioningAccess:async()=>safe({canReview:false}),getTeamAdministration:async()=>safe({teams:[]}),requestPasswordRecovery:async()=>safe({challengeId:'recovery-challenge',expiresAt:Date.now()+300000}),recoverPassword:async()=>safe({signedOut:true})};
  window.shenyiTeam=Object.fromEntries(Object.entries({...defaults,...overrides}).map(([name,fn])=>[name,typeof fn==='function'?async arg=>{calls.push({name,arg});return fn(arg);}:fn]));window.shenyiTeam=withDeviceDiagnostic(window.shenyiTeam);window.eval(script);t.after(()=>window.close());return {window,d,calls,writes,id:id=>d.getElementById(id),click:id=>d.getElementById(id).click(),submit:id=>d.getElementById(id).dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})),input:id=>d.getElementById(id).dispatchEvent(new window.Event('input',{bubbles:true})),change:id=>d.getElementById(id).dispatchEvent(new window.Event('change',{bubbles:true}))};
}
async function open(f){await until(()=>count(f,'getAuthMethods')>0);f.id('recovery-panel').querySelector('summary').click();await until(()=>f.id('recovery-panel').open&&!f.id('recovery-status').textContent.startsWith('正在读取'));}
async function challenge(f){await open(f);await until(()=>!f.id('recovery-send-code').disabled);f.id('recovery-phone').value=PHONE;f.input('recovery-phone');f.click('recovery-send-code');await until(()=>!f.id('recovery-fields').hidden&&!f.id('recovery-fields').disabled);}
function fill(f,{code='123456',proof=PROOF,password=PASSWORD,confirmation=password}={}){for(const [id,value]of [['recovery-code',code],['recovery-proof',proof],['recovery-new',password],['recovery-confirm',confirmation]]){f.id(id).value=value;f.input(id);}}
function clean(f){for(const id of ['recovery-code','recovery-proof','recovery-new','recovery-confirm'])assert.equal(f.id(id).value,'',id);}
async function login(f){f.id('username').value='synthetic-employee';f.id('password').value='Current Secret!2026';f.submit('login-form');await until(()=>!f.id('workspace-view').hidden&&!f.id('logout').disabled);}

test('unconfigured recovery remains disabled and cannot submit SMS alone',async t=>{
  const f=fixture(t,{getAuthMethods:async()=>safe({mode:'local-preview',methods:{demoUsername:true,phonePassword:true,phoneVerification:true,wechat:false,recovery:false}})});await open(f);await until(()=>f.id('recovery-status').textContent.includes('尚未开通'));assert.equal(f.id('recovery-send-code').disabled,true);assert.equal(f.id('recovery-submit').disabled,true);f.submit('recovery-form');assert.equal(count(f,'requestPasswordRecovery'),0);assert.equal(count(f,'recoverPassword'),0);assert.match(f.id('recovery-panel').textContent,/短信单独不能重置/);
});
test('missing desktop recovery bridge does not invent availability',async t=>{
  const f=fixture(t,{recoverPassword:undefined});await open(f);assert.match(f.id('recovery-status').textContent,/接口尚未就绪/);assert.equal(f.id('recovery-send-code').disabled,true);assert.equal(count(f,'requestPasswordRecovery'),0);
});
test('unknown identity capability disables recovery without hiding uncertainty',async t=>{
  const f=fixture(t,{getAuthMethods:async()=>fail('SERVICE_UNAVAILABLE','unavailable')});await open(f);await until(()=>f.id('recovery-status').textContent.includes('暂未确认'));assert.equal(f.id('recovery-phone').disabled,true);assert.equal(f.id('recovery-submit').disabled,true);
});
test('SMS request sends only the entered phone and presents no account-existence bit',async t=>{
  const f=fixture(t);await challenge(f);assert.deepEqual({...f.calls.find(c=>c.name==='requestPasswordRecovery').arg},{phone:PHONE});assert.match(f.id('recovery-message').textContent,/发送请求已完成/);assert.equal(f.id('recovery-message').textContent.includes('账号存在'),false);assert.equal(f.id('recovery-fields').hidden,false);
});
test('independent recovery proof is password-masked and not stored',async t=>{
  const f=fixture(t);await challenge(f);fill(f);assert.equal(f.id('recovery-proof').type,'password');assert.equal(f.id('recovery-proof').autocomplete,'off');assert.equal(f.d.querySelectorAll('form').length,18);assert.equal(f.d.querySelectorAll('input[type=password]').length,24);assert.deepEqual(f.writes,[]);
});
test('confirmation mismatch never sends reset and erases all recovery secrets',async t=>{
  const f=fixture(t);await challenge(f);fill(f,{confirmation:PASSWORD+' '});f.submit('recovery-form');assert.equal(count(f,'recoverPassword'),0);assert.match(f.id('recovery-message').textContent,/不一致/);clean(f);
});
test('all verification fields are required and SMS cannot replace independent proof',async t=>{
  const f=fixture(t);await challenge(f);for(const patch of [{proof:''},{code:'12345x'},{password:''},{confirmation:''}]){fill(f,patch);f.submit('recovery-form');assert.equal(count(f,'recoverPassword'),0);assert.match(f.id('recovery-message').textContent,/6位验证码、独立恢复授权凭据和两次新密码/);clean(f);}
});
test('new password validation counts Unicode characters and does not truncate legal emoji',async t=>{
  const f=fixture(t,{recoverPassword:async()=>fail('HTTP_400','恢复验证未通过')});await challenge(f);for(const password of ['😀'.repeat(11),'x'.repeat(129)]){fill(f,{password});f.submit('recovery-form');assert.equal(count(f,'recoverPassword'),0);assert.match(f.id('recovery-message').textContent,/12至128/);}assert.ok(f.id('recovery-new').maxLength>=256);assert.ok(f.id('recovery-confirm').maxLength>=256);fill(f,{password:'😀'.repeat(128)});f.submit('recovery-form');await until(()=>count(f,'recoverPassword')===1);assert.equal(f.calls.find(c=>c.name==='recoverPassword').arg.newPassword,'😀'.repeat(128));
});
test('successful recovery transmits exact proof and password and never signs in automatically',async t=>{
  const password='  Sensitive New Secret!2026  ',f=fixture(t);await challenge(f);fill(f,{password});f.submit('recovery-form');await until(()=>f.id('login-message').textContent.includes('密码已重设'));assert.deepEqual({...f.calls.find(c=>c.name==='recoverPassword').arg},{challengeId:'recovery-challenge',code:'123456',newPassword:password,recoveryProof:PROOF});assert.equal(count(f,'loginPhone'),0);assert.equal(f.id('workspace-view').hidden,true);assert.match(f.id('login-message').textContent,/全部旧登录已退出/);assert.equal(f.id('recovery-phone').value,'');clean(f);assert.deepEqual(f.writes,[]);
});
test('failed proof remains retryable with current challenge but every sensitive input clears',async t=>{
  const f=fixture(t,{recoverPassword:async()=>fail('HTTP_400','恢复验证未通过，请核对独立授权。')});await challenge(f);fill(f);f.submit('recovery-form');await until(()=>f.id('recovery-message').textContent.includes('恢复验证未通过'));clean(f);assert.equal(f.id('recovery-fields').hidden,false);fill(f);f.submit('recovery-form');await until(()=>count(f,'recoverPassword')===2);assert.equal(f.id('workspace-view').hidden,true);
});
test('unknown or malformed completion never reports recovery success',async t=>{
  const f=fixture(t,{recoverPassword:async()=>safe({signedOut:false})});await challenge(f);fill(f);f.submit('recovery-form');await until(()=>f.id('recovery-message').textContent.includes('未能确认'));assert.match(f.id('recovery-message').textContent,/可能已完成/);assert.equal(f.id('login-message').textContent.includes('密码已重设'),false);clean(f);
});
test('transport failure is uncertain rather than a definite unchanged-password claim',async t=>{
  const f=fixture(t,{recoverPassword:async()=>fail('SERVICE_UNAVAILABLE','PRIVATE_PATH')});await challenge(f);fill(f);f.submit('recovery-form');await until(()=>f.id('recovery-message').textContent.includes('未能确认'));assert.match(f.id('recovery-message').textContent,/可能已完成/);assert.equal(f.d.body.textContent.includes('PRIVATE_PATH'),false);assert.equal(count(f,'recoverPassword'),1);clean(f);
});
test('changing phone invalidates the old challenge and clears all proof',async t=>{
  const f=fixture(t);await challenge(f);fill(f);f.id('recovery-phone').value='13900139000';f.input('recovery-phone');assert.equal(f.id('recovery-fields').hidden,true);assert.equal(f.id('recovery-submit').disabled,true);clean(f);f.submit('recovery-form');assert.equal(count(f,'recoverPassword'),0);
});
test('expired challenge cannot be submitted even if the panel has not rerendered',async t=>{
  let expiry=Date.now()+300000;const f=fixture(t,{requestPasswordRecovery:async()=>safe({challengeId:'expiring',get expiresAt(){return expiry;}})});await challenge(f);fill(f);f.window.Date.now=()=>expiry+1;f.submit('recovery-form');assert.equal(count(f,'recoverPassword'),0);assert.match(f.id('recovery-message').textContent,/已过期/);clean(f);assert.equal(f.id('recovery-fields').hidden,true);
});
test('closing and reopening during reset retains the mutation lock and accepts one result',async t=>{
  const wait=deferred(),f=fixture(t,{recoverPassword:()=>wait.promise});await challenge(f);fill(f);f.submit('recovery-form');await until(()=>count(f,'recoverPassword')===1);f.id('recovery-panel').querySelector('summary').click();clean(f);f.id('recovery-panel').querySelector('summary').click();await new Promise(r=>setTimeout(r,0));assert.equal(f.id('recovery-send-code').disabled,true);f.submit('recovery-form');assert.equal(count(f,'recoverPassword'),1);wait.resolve(safe({signedOut:true}));await until(()=>f.id('login-message').textContent.includes('密码已重设'));assert.equal(f.id('recovery-panel').open,true);clean(f);
});
test('a closed reset completion reports login guidance without reopening the panel',async t=>{
  const wait=deferred(),f=fixture(t,{recoverPassword:()=>wait.promise});await challenge(f);fill(f);f.submit('recovery-form');await until(()=>count(f,'recoverPassword')===1);f.click('recovery-cancel');wait.resolve(safe({signedOut:true}));await until(()=>f.id('login-message').textContent.includes('密码已重设'));assert.equal(f.id('recovery-panel').open,false);clean(f);
});
test('a closed uncertain reset completion stays uncertain and does not restore passwords',async t=>{
  const wait=deferred(),f=fixture(t,{recoverPassword:()=>wait.promise});await challenge(f);fill(f);f.submit('recovery-form');await until(()=>count(f,'recoverPassword')===1);f.click('recovery-cancel');wait.resolve(fail('HTTP_503','PRIVATE_DETAIL'));await until(()=>f.id('login-message').textContent.includes('未能确认'));assert.match(f.id('login-message').textContent,/可能已完成/);assert.equal(f.id('recovery-panel').open,false);assert.equal(f.d.body.textContent.includes('PRIVATE_DETAIL'),false);clean(f);
});
test('closing and reopening an outstanding SMS request never sends a duplicate challenge',async t=>{
  const wait=deferred(),f=fixture(t,{requestPasswordRecovery:()=>wait.promise});await open(f);await until(()=>!f.id('recovery-send-code').disabled);f.id('recovery-phone').value=PHONE;f.click('recovery-send-code');await until(()=>count(f,'requestPasswordRecovery')===1);f.click('recovery-cancel');f.id('recovery-panel').querySelector('summary').click();await new Promise(r=>setTimeout(r,0));assert.equal(f.id('recovery-send-code').disabled,true);f.click('recovery-send-code');assert.equal(count(f,'requestPasswordRecovery'),1);wait.resolve(safe({challengeId:'old-challenge',expiresAt:Date.now()+300000}));await until(()=>!f.id('recovery-send-code').disabled);assert.equal(f.id('recovery-fields').hidden,true);clean(f);
});
test('late reset success cannot clear or alter a newly signed-in account',async t=>{
  const wait=deferred(),f=fixture(t,{recoverPassword:()=>wait.promise});await challenge(f);fill(f);f.submit('recovery-form');await until(()=>count(f,'recoverPassword')===1);await login(f);wait.resolve(safe({signedOut:true}));await new Promise(r=>setTimeout(r,0));assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('account-name').textContent,SESSION.account.displayName);assert.equal(f.id('login-message').textContent.includes('密码已重设'),false);clean(f);
});
test('late reset unauthorized result cannot sign out a newly logged-in account',async t=>{
  const wait=deferred(),f=fixture(t,{recoverPassword:()=>wait.promise});await challenge(f);fill(f);f.submit('recovery-form');await until(()=>count(f,'recoverPassword')===1);await login(f);wait.resolve(fail('SIGN_IN_REQUIRED','OLD_ERROR'));await new Promise(r=>setTimeout(r,0));assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.d.body.textContent.includes('OLD_ERROR'),false);clean(f);
});
test('late SMS result after a new account login is discarded',async t=>{
  const wait=deferred(),f=fixture(t,{requestPasswordRecovery:()=>wait.promise});await open(f);await until(()=>!f.id('recovery-send-code').disabled);f.id('recovery-phone').value=PHONE;f.click('recovery-send-code');await until(()=>count(f,'requestPasswordRecovery')===1);await login(f);wait.resolve(safe({challengeId:'old',expiresAt:Date.now()+300000}));await new Promise(r=>setTimeout(r,0));assert.equal(f.id('recovery-fields').hidden,true);assert.equal(f.id('account-name').textContent,SESSION.account.displayName);clean(f);
});
test('old reset release unlocks a newer signed-out flow without clearing its phone or showing old success',async t=>{
  const wait=deferred(),f=fixture(t,{recoverPassword:()=>wait.promise});await challenge(f);fill(f);f.submit('recovery-form');await until(()=>count(f,'recoverPassword')===1);await login(f);f.click('logout');await until(()=>f.id('workspace-view').hidden&&!f.id('login-submit').disabled);await open(f);f.id('recovery-phone').value='13900139000';assert.equal(f.id('recovery-send-code').disabled,true);wait.resolve(safe({signedOut:true}));await until(()=>!f.id('recovery-send-code').disabled);assert.equal(f.id('recovery-phone').value,'13900139000');assert.equal(f.id('login-message').textContent.includes('密码已重设'),false);assert.equal(f.id('recovery-fields').hidden,true);
});
test('old SMS release unlocks a newer signed-out flow without adopting its challenge',async t=>{
  const wait=deferred(),f=fixture(t,{requestPasswordRecovery:()=>wait.promise});await open(f);await until(()=>!f.id('recovery-send-code').disabled);f.id('recovery-phone').value=PHONE;f.click('recovery-send-code');await until(()=>count(f,'requestPasswordRecovery')===1);await login(f);f.click('logout');await until(()=>f.id('workspace-view').hidden&&!f.id('login-submit').disabled);await open(f);f.id('recovery-phone').value='13900139000';assert.equal(f.id('recovery-send-code').disabled,true);wait.resolve(safe({challengeId:'old',expiresAt:Date.now()+300000}));await until(()=>!f.id('recovery-send-code').disabled);assert.equal(f.id('recovery-phone').value,'13900139000');assert.equal(f.id('recovery-fields').hidden,true);assert.equal(f.id('recovery-message').textContent.includes('发送请求已完成'),false);
});
test('native queued opening preserves a just-entered phone instead of clearing it',async t=>{
  const f=fixture(t);await until(()=>count(f,'getAuthMethods')>0);f.id('recovery-panel').querySelector('summary').click();f.id('recovery-phone').value=PHONE;await until(()=>!f.id('recovery-send-code').disabled);assert.equal(f.id('recovery-phone').value,PHONE);
});
test('switching login mode clears all recovery proof and closes the flow',async t=>{
  const f=fixture(t);await challenge(f);fill(f);f.id('login-mode').value='phone';f.change('login-mode');assert.equal(f.id('recovery-panel').open,false);assert.equal(f.id('recovery-phone').value,'');clean(f);assert.equal(f.id('recovery-fields').hidden,true);
});
test('other onboarding flows clear recovery and recovery clears their local inputs',async t=>{
  const f=fixture(t);await challenge(f);fill(f);f.id('first-admin-panel').querySelector('summary').click();await until(()=>!f.id('recovery-panel').open);clean(f);f.id('first-admin-invitation').value='SYNTHETIC_INVITE';f.id('first-admin-phone').value=PHONE;f.id('recovery-panel').querySelector('summary').click();await until(()=>!f.id('first-admin-panel').open);assert.equal(f.id('first-admin-invitation').value,'');assert.equal(f.id('first-admin-phone').value,'');
});
test('unload removes local recovery proof and does not submit a reset',async t=>{
  const f=fixture(t);await challenge(f);fill(f);f.window.dispatchEvent(new f.window.Event('beforeunload'));clean(f);assert.equal(f.id('recovery-phone').value,'');assert.equal(f.id('recovery-panel').open,false);assert.equal(count(f,'recoverPassword'),0);assert.deepEqual(f.writes,[]);
});
