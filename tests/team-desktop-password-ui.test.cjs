'use strict';
// Actual renderer DOM with a synthetic narrow bridge. No supplier or native user.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/index.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/team-ui.js'),'utf8');
const safe=value=>({ok:true,value}),fail=(code,message)=>({ok:false,error:{code,message}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const SESSION={account:{id:'employee-a',displayName:'合成员工A'},memberships:[{teamId:'team-a',role:'intern'},{teamId:'team-b',role:'assistant'}],expiresAt:Date.now()+3600000};
const SESSION_B={account:{id:'employee-b',displayName:'合成员工B'},memberships:[{teamId:'team-b',role:'assistant'}],expiresAt:Date.now()+3600000};
const CURRENT='SyntheticCurrent!2026',NEW='SyntheticReplacement!2026';
const count=(f,name)=>f.calls.filter(call=>call.name===name).length;
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,0));}assert.ok(check(),'expected renderer state was not reached');}
function fixture(t,overrides={}){
  const dom=new JSDOM(html,{url:'shenyi://app/index.html',runScripts:'outside-only'}),{window}=dom,d=window.document,calls=[],writes=[];
  Object.defineProperty(window,'localStorage',{value:new Proxy({setItem:(...args)=>writes.push(args),getItem:()=>null,removeItem:()=>{},clear:()=>{}},{set:(_target,key,value)=>{writes.push([key,value]);return true;}})});
  const defaults={getAuthMethods:async()=>safe({mode:'local-preview',desktopWechatReady:false,methods:{demoUsername:true,phonePassword:true,phoneVerification:false,wechat:false,recovery:false}}),getOnboardingStatus:async()=>safe({available:false,invitationOnly:true}),login:async()=>safe(SESSION),loginPhone:async()=>safe(SESSION),listTasks:async()=>safe({tasks:[{id:'task-a',title:'合成采集任务',instructions:'合成任务说明',status:'open'}],hasMore:false}),logout:async()=>safe({signedOut:true}),getInvitationAccess:async()=>safe({canInvite:false}),changeOwnPassword:async()=>safe({signedOut:true})};
  window.shenyiTeam=Object.fromEntries(Object.entries({...defaults,...overrides}).map(([name,fn])=>[name,typeof fn==='function'?async arg=>{calls.push({name,arg});return fn(arg);}:fn]));
  window.eval(script);t.after(()=>window.close());
  return {window,d,calls,writes,id:id=>d.getElementById(id),click:id=>d.getElementById(id).click(),submit:id=>d.getElementById(id).dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})),input:id=>d.getElementById(id).dispatchEvent(new window.Event('input',{bubbles:true}))};
}
async function login(f){await until(()=>!f.id('login-submit').disabled);f.id('username').value='synthetic-user';f.id('password').value=CURRENT;f.submit('login-form');await until(()=>!f.id('workspace-view').hidden&&!f.id('logout').disabled);}
async function open(f){f.id('password-change-panel').querySelector('summary').click();await until(()=>!f.id('password-change-current').disabled||f.id('password-change-message').textContent.includes('尚未就绪'));}
function fill(f,current=CURRENT,next=NEW,confirmation=next){for(const [id,value]of [['password-change-current',current],['password-change-new',next],['password-change-confirm',confirmation]]){f.id(id).value=value;f.input(id);}}
function assertClean(f){for(const id of ['password-change-current','password-change-new','password-change-confirm'])assert.equal(f.id(id).value,'',id);}

test('all roles may change only their own password without SMS or invitation privileges',async t=>{
  for(const role of ['intern','assistant','manager','partner']){const f=fixture(t,{login:async()=>safe({...SESSION,memberships:[{teamId:'team-a',role}]})});await login(f);await open(f);assert.equal(f.id('password-change-current').disabled,false);assert.equal(f.id('employee-invitations-panel').hidden,true);assert.match(f.id('password-change-guidance').textContent,/全部旧登录/);assert.match(f.id('password-change-guidance').textContent,/不是短信找回/);}
});
test('missing password bridge disables changing without reporting fake availability',async t=>{
  const f=fixture(t,{changeOwnPassword:undefined});await login(f);await open(f);assert.equal(f.id('password-change-current').disabled,true);assert.equal(f.id('password-change-submit').disabled,true);assert.match(f.id('password-change-message').textContent,/接口尚未就绪/);assert.equal(count(f,'changeOwnPassword'),0);assert.equal(f.id('workspace-view').hidden,false);
});
test('confirmation mismatch is rejected locally and clears every password proof',async t=>{
  const f=fixture(t);await login(f);await open(f);fill(f,CURRENT,NEW,NEW+' ');f.submit('password-change-form');assert.match(f.id('password-change-message').textContent,/不一致/);assert.equal(count(f,'changeOwnPassword'),0);assertClean(f);
});
test('new password length uses Unicode characters rather than UTF16 code units',async t=>{
  const f=fixture(t,{changeOwnPassword:async()=>fail('HTTP_403','当前密码验证未通过，请核对后重试。')});await login(f);await open(f);
  for(const next of ['😀'.repeat(11),'a'.repeat(129)]){fill(f,CURRENT,next);f.submit('password-change-form');assert.match(f.id('password-change-message').textContent,/12至128/);assert.equal(count(f,'changeOwnPassword'),0);assertClean(f);}
  fill(f,CURRENT,'😀'.repeat(12));f.submit('password-change-form');await until(()=>count(f,'changeOwnPassword')===1&&f.id('password-change-current').value==='');assert.equal(f.calls.find(c=>c.name==='changeOwnPassword').arg.newPassword,'😀'.repeat(12));
});
test('maximum legal Unicode password fits both input fields without truncation',async t=>{
  const next='😀'.repeat(128),f=fixture(t,{changeOwnPassword:async()=>fail('HTTP_403','当前密码验证未通过，请核对后重试。')});await login(f);await open(f);assert.ok(f.id('password-change-new').maxLength>=next.length);assert.ok(f.id('password-change-confirm').maxLength>=next.length);fill(f,CURRENT,next);f.submit('password-change-form');await until(()=>count(f,'changeOwnPassword')===1);assert.equal(f.calls.find(c=>c.name==='changeOwnPassword').arg.newPassword,next);
});
test('password bytes are passed unchanged including case and leading or trailing spaces',async t=>{
  const current='  Current Secret!2026  ',next='  Case Sensitive New!2026  ',f=fixture(t,{changeOwnPassword:async()=>fail('HTTP_403','当前密码验证未通过，请核对后重试。')});await login(f);await open(f);fill(f,current,next);f.submit('password-change-form');await until(()=>count(f,'changeOwnPassword')===1);assert.deepEqual({...f.calls.find(c=>c.name==='changeOwnPassword').arg},{currentPassword:current,newPassword:next});assert.deepEqual(f.writes,[]);
});
test('the UI does not invent an unrequested password-history or same-password rule',async t=>{
  const f=fixture(t,{changeOwnPassword:async()=>fail('HTTP_403','当前密码验证未通过，请核对后重试。')});await login(f);await open(f);fill(f,CURRENT,CURRENT);f.submit('password-change-form');await until(()=>count(f,'changeOwnPassword')===1);assert.equal(f.calls.find(c=>c.name==='changeOwnPassword').arg.newPassword,CURRENT);
});
test('wrong current password keeps account usable and can be retried with cleared fields',async t=>{
  let attempts=0;const f=fixture(t,{changeOwnPassword:async()=>++attempts===1?fail('HTTP_403','当前密码验证未通过，请核对后重试。'):safe({signedOut:true})});await login(f);await open(f);fill(f,'WrongPassword!2026');f.submit('password-change-form');await until(()=>f.id('password-change-message').textContent.includes('验证未通过'));assertClean(f);assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('password-change-current').disabled,false);
  fill(f);f.submit('password-change-form');await until(()=>f.id('workspace-view').hidden);assert.equal(count(f,'changeOwnPassword'),2);assert.match(f.id('login-message').textContent,/密码已修改/);
});
test('confirmed success clears tasks, identity and all fifteen password inputs',async t=>{
  const f=fixture(t);await login(f);await open(f);for(const input of f.d.querySelectorAll('input[type=password]'))input.value='SYNTHETIC_STALE_SECRET';fill(f);f.submit('password-change-form');await until(()=>f.id('workspace-view').hidden);
  assert.equal(f.d.querySelectorAll('form').length,10);assert.equal(f.d.querySelectorAll('input[type=password]').length,16);for(const input of f.d.querySelectorAll('input[type=password]'))assert.equal(input.value,'');assert.equal(f.id('account-name').textContent,'');assert.equal(f.id('task-list').children.length,0);assert.equal(f.id('password-change-panel').open,false);assert.match(f.id('login-message').textContent,/全部旧登录已退出/);assert.deepEqual(f.writes,[]);
});
test('closing a submitted change clears proof but a later confirmed success still signs out',async t=>{
  const wait=deferred(),f=fixture(t,{changeOwnPassword:()=>wait.promise});await login(f);await open(f);fill(f);f.submit('password-change-form');await until(()=>count(f,'changeOwnPassword')===1);f.id('password-change-panel').querySelector('summary').click();assertClean(f);assert.match(f.id('workspace-message').textContent,/已提交的请求仍可能完成/);wait.resolve(safe({signedOut:true}));await until(()=>f.id('workspace-view').hidden);assert.match(f.id('login-message').textContent,/密码已修改/);
});
test('close and reopen preserve the pending mutation lock rather than submitting twice',async t=>{
  const wait=deferred(),f=fixture(t,{changeOwnPassword:()=>wait.promise});await login(f);await open(f);fill(f);f.submit('password-change-form');await until(()=>count(f,'changeOwnPassword')===1);f.id('password-change-panel').querySelector('summary').click();f.id('password-change-panel').querySelector('summary').click();await until(()=>f.id('password-change-message').textContent.includes('仍在处理中'));fill(f);f.submit('password-change-form');assert.equal(count(f,'changeOwnPassword'),1);assert.equal(f.id('password-change-submit').disabled,true);wait.resolve(safe({signedOut:true}));await until(()=>f.id('workspace-view').hidden);
});
test('late change success cannot sign out a different new account',async t=>{
  let logins=0;const wait=deferred(),f=fixture(t,{login:async()=>safe(++logins===1?SESSION:SESSION_B),changeOwnPassword:()=>wait.promise});await login(f);await open(f);fill(f);f.submit('password-change-form');await until(()=>count(f,'changeOwnPassword')===1);f.click('logout');await until(()=>f.id('workspace-view').hidden);await login(f);wait.resolve(safe({signedOut:true}));await new Promise(r=>setTimeout(r,0));assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('account-name').textContent,SESSION_B.account.displayName);assertClean(f);
});
test('a previous login late 401 cannot sign out a new login of the same account',async t=>{
  const wait=deferred(),f=fixture(t,{changeOwnPassword:()=>wait.promise});await login(f);await open(f);fill(f);f.submit('password-change-form');await until(()=>count(f,'changeOwnPassword')===1);f.click('logout');await until(()=>f.id('workspace-view').hidden);await login(f);wait.resolve(fail('SIGN_IN_REQUIRED','Old login revoked'));await new Promise(r=>setTimeout(r,0));assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('account-name').textContent,SESSION.account.displayName);assert.ok(!f.id('login-message').textContent.includes('Old login'));
});
test('authoritative current-session 401 clears the old workspace and password proof',async t=>{
  const f=fixture(t,{changeOwnPassword:async()=>fail('SIGN_IN_REQUIRED','当前登录已失效，请重新登录。')});await login(f);await open(f);fill(f);f.submit('password-change-form');await until(()=>f.id('workspace-view').hidden);assertClean(f);assert.match(f.id('login-message').textContent,/已失效/);assert.equal(f.id('login-submit').disabled,false);
});
test('uncertain service result is not described as guaranteed cancellation or success',async t=>{
  const f=fixture(t,{changeOwnPassword:async()=>fail('SERVICE_UNAVAILABLE','SYNTHETIC_PRIVATE_DETAIL')});await login(f);await open(f);fill(f);f.submit('password-change-form');await until(()=>f.id('password-change-message').textContent.includes('未能确认'));assert.match(f.id('password-change-message').textContent,/可能已完成/);assert.ok(!f.d.body.textContent.includes('SYNTHETIC_PRIVATE_DETAIL'));assert.equal(f.id('workspace-view').hidden,false);assertClean(f);assert.equal(count(f,'changeOwnPassword'),1);
});
test('malformed success cannot fabricate a completed change or automatic sign-out',async t=>{
  const f=fixture(t,{changeOwnPassword:async()=>safe({unexpected:true})});await login(f);await open(f);fill(f);f.submit('password-change-form');await until(()=>f.id('password-change-message').textContent.includes('未能确认'));assert.equal(f.id('workspace-view').hidden,false);assertClean(f);
});
test('server error status also preserves uncertainty instead of claiming the submitted change failed',async t=>{
  const f=fixture(t,{changeOwnPassword:async()=>fail('HTTP_502','upstream response unavailable')});await login(f);await open(f);fill(f);f.submit('password-change-form');await until(()=>f.id('password-change-message').textContent.includes('未能确认'));assert.match(f.id('password-change-message').textContent,/可能已完成/);assert.equal(f.id('workspace-view').hidden,false);assertClean(f);assert.equal(count(f,'changeOwnPassword'),1);
});
test('a closed and reopened panel reports a late uncertain result without restoring passwords',async t=>{
  const wait=deferred(),f=fixture(t,{changeOwnPassword:()=>wait.promise});await login(f);await open(f);fill(f);f.submit('password-change-form');await until(()=>count(f,'changeOwnPassword')===1);f.click('password-change-clear');f.id('password-change-panel').querySelector('summary').click();wait.resolve(fail('INVALID_RESPONSE','not safe to assume failure'));await until(()=>f.id('password-change-message').textContent.includes('未能确认'));assertClean(f);assert.equal(f.id('password-change-current').disabled,false);assert.equal(count(f,'changeOwnPassword'),1);
});
test('queued native opening does not erase immediately entered password fields',async t=>{
  const f=fixture(t);await login(f);f.id('password-change-panel').querySelector('summary').click();fill(f);await until(()=>!f.id('password-change-current').disabled);assert.equal(f.id('password-change-current').value,CURRENT);assert.equal(f.id('password-change-new').value,NEW);assert.equal(f.id('password-change-confirm').value,NEW);assert.equal(count(f,'changeOwnPassword'),0);
});
test('closing, switching team and window unload clear local password fields',async t=>{
  const f=fixture(t);await login(f);await open(f);fill(f);f.id('password-change-panel').querySelector('summary').click();assertClean(f);await open(f);fill(f);f.id('team-select').value='team-b';f.id('team-select').dispatchEvent(new f.window.Event('change',{bubbles:true}));await until(()=>!f.id('logout').disabled);assert.equal(f.id('password-change-panel').open,false);assertClean(f);await open(f);fill(f);f.window.dispatchEvent(new f.window.Event('beforeunload'));assertClean(f);assert.equal(count(f,'changeOwnPassword'),0);
});
