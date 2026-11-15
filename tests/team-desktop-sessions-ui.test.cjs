'use strict';
// Real renderer DOM, synthetic narrow bridge. No native session or supplier is touched.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/index.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/team-ui.js'),'utf8');
const safe=value=>({ok:true,value}),fail=(code,message)=>({ok:false,error:{code,message}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const CURRENT={id:'session-current',isCurrent:true,createdAt:Date.now()-60000,expiresAt:Date.now()+3600000};
const OTHER={id:'session-other',isCurrent:false,createdAt:null,expiresAt:Date.now()+3000000};
const SECOND={id:'session-next',isCurrent:false,createdAt:Date.now()-120000,expiresAt:Date.now()+2000000};
const SESSION={account:{id:'employee-a',displayName:'合成员工A'},memberships:[{teamId:'team-a',role:'intern'},{teamId:'team-b',role:'assistant'}],expiresAt:Date.now()+3600000};
const SESSION_B={account:{id:'employee-b',displayName:'合成员工B'},memberships:[{teamId:'team-b',role:'assistant'}],expiresAt:Date.now()+3600000};
const PASSWORD='SyntheticCurrentPassword!2026';
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,0));}assert.ok(check(),'expected renderer state was not reached');}
function fixture(t,overrides={}){
  const dom=new JSDOM(html,{url:'shenyi://app/index.html',runScripts:'outside-only'}),{window}=dom,d=window.document,calls=[],writes=[];
  Object.defineProperty(window,'localStorage',{value:{setItem:(...args)=>writes.push(args),getItem:()=>null,removeItem:()=>{}}});
  const defaults={getAuthMethods:async()=>safe({mode:'local-preview',desktopWechatReady:false,methods:{demoUsername:true,phonePassword:true,phoneVerification:false,wechat:false,recovery:false}}),getOnboardingStatus:async()=>safe({available:false,invitationOnly:true}),login:async()=>safe(SESSION),loginPhone:async()=>safe(SESSION),listTasks:async()=>safe({tasks:[],hasMore:false}),logout:async()=>safe({signedOut:true}),getInvitationAccess:async()=>safe({canInvite:false}),listAccountSessions:async()=>safe({sessions:[CURRENT,OTHER],hasMore:false}),revokeAccountSession:async()=>safe({revoked:true,signedOut:false}),revokeOtherSessions:async()=>safe({revokedCount:1,signedOut:false}),revokeAllSessions:async()=>safe({revokedCount:2,signedOut:true})};
  window.shenyiTeam=Object.fromEntries(Object.entries({...defaults,...overrides}).map(([name,fn])=>[name,typeof fn==='function'?async arg=>{calls.push({name,arg});return fn(arg);}:fn]));
  window.eval(script);t.after(()=>window.close());
  return {window,d,calls,writes,id:id=>d.getElementById(id),click:id=>d.getElementById(id).click(),submit:id=>d.getElementById(id).dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})),rows:()=>[...d.querySelectorAll('.account-session-item')],input:id=>d.getElementById(id).dispatchEvent(new window.Event('input',{bubbles:true}))};
}
const count=(f,name)=>f.calls.filter(call=>call.name===name).length;
async function login(f){await until(()=>!f.id('login-submit').disabled);f.id('username').value='synthetic-user';f.id('password').value=PASSWORD;f.submit('login-form');await until(()=>!f.id('workspace-view').hidden&&!f.id('logout').disabled);}
async function open(f){f.id('account-sessions-panel').querySelector('summary').click();await until(()=>f.rows().length===2&&!f.id('account-sessions-refresh').disabled);}
function password(f,value=PASSWORD){f.id('account-sessions-password').value=value;f.input('account-sessions-password');}
function rowButton(f,id){return f.rows().find(row=>row.dataset.sessionId===id).querySelector('button');}

test('all four roles can inspect their own personal security without invitation privileges',async t=>{
  for(const role of ['intern','assistant','manager','partner']){
    const f=fixture(t,{login:async()=>safe({...SESSION,memberships:[{teamId:'team-a',role}]})});await login(f);assert.equal(f.id('employee-invitations-panel').hidden,true);await open(f);assert.equal(count(f,'listAccountSessions'),1);assert.equal(f.rows().length,2);
  }
});
test('session list renders only time/current metadata and does not infer old login times or devices',async t=>{
  const f=fixture(t,{listAccountSessions:async()=>safe({sessions:[{...CURRENT,token:'BEARER_SECRET',token_hash:'DIGEST_SECRET',userId:'OTHER_USER_SECRET',ip:'IP_SECRET'},{...OTHER,device:'FAKE_DEVICE_SECRET'}],hasMore:false})});await login(f);await open(f);
  assert.match(f.rows()[0].textContent,/当前登录/);assert.match(f.rows()[1].textContent,/登录时间未记录/);assert.match(f.rows()[1].textContent,/有效至/);
  for(const secret of ['BEARER_SECRET','DIGEST_SECRET','OTHER_USER_SECRET','IP_SECRET','FAKE_DEVICE_SECRET'])assert.ok(!f.d.body.textContent.includes(secret));
  assert.equal(f.d.querySelectorAll('form').length,10);assert.equal(f.d.querySelectorAll('input[type=password]').length,16);assert.deepEqual(f.writes,[]);
});
test('pagination sends only the last management ID and merges the next personal page',async t=>{
  const f=fixture(t,{listAccountSessions:async arg=>safe(arg.after?{sessions:[SECOND],hasMore:false}:{sessions:[CURRENT,OTHER],hasMore:true})});await login(f);await open(f);assert.equal(f.id('account-sessions-more').hidden,false);f.click('account-sessions-more');await until(()=>f.rows().length===3);
  const calls=f.calls.filter(call=>call.name==='listAccountSessions');assert.deepEqual({...calls[0].arg},{limit:30});assert.deepEqual({...calls[1].arg},{limit:30,after:OTHER.id});assert.equal(f.id('account-sessions-more').hidden,true);
});
test('password is required before a deliberate revoke and Enter never triggers a bulk exit',async t=>{
  const f=fixture(t);await login(f);await open(f);f.click('account-sessions-revoke-all');rowButton(f,CURRENT.id).click();assert.equal(count(f,'revokeAllSessions')+count(f,'revokeAccountSession'),0);
  password(f);const event=new f.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});f.id('account-sessions-password').dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(count(f,'revokeAllSessions')+count(f,'revokeAccountSession'),0);
});
test('bad current password clears proof but preserves the account and a considered retry',async t=>{
  let attempts=0;const f=fixture(t,{revokeOtherSessions:async()=>++attempts===1?fail('PASSWORD_MISMATCH','当前密码无效，请重试。'):safe({revokedCount:1,signedOut:false})});await login(f);await open(f);password(f,'wrong password');f.click('account-sessions-revoke-others');await until(()=>f.id('account-sessions-message').textContent.includes('当前密码无效'));
  assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.rows().length,2);assert.equal(f.id('account-sessions-password').value,'');assert.equal(f.id('account-sessions-password').disabled,false);password(f);f.click('account-sessions-revoke-others');await until(()=>f.id('account-sessions-message').textContent.includes('当前登录保留'));assert.equal(attempts,2);
});
test('revoke one peer uses its management ID and refreshes without exposing password or account secrets',async t=>{
  let listed=0;const f=fixture(t,{listAccountSessions:async()=>safe({sessions:++listed===1?[CURRENT,OTHER]:[CURRENT],hasMore:false})});await login(f);await open(f);password(f);rowButton(f,OTHER.id).click();await until(()=>f.rows().length===1&&f.id('account-sessions-password').value==='');
  assert.deepEqual({...f.calls.find(call=>call.name==='revokeAccountSession').arg},{sessionId:OTHER.id,currentPassword:PASSWORD});assert.equal(f.id('workspace-view').hidden,false);assert.deepEqual(f.writes,[]);assert.ok(!f.d.body.textContent.includes(PASSWORD));
});
test('revoke others refreshes its count and keeps the current login',async t=>{
  let listed=0;const f=fixture(t,{listAccountSessions:async()=>safe({sessions:++listed===1?[CURRENT,OTHER]:[CURRENT],hasMore:false}),revokeOtherSessions:async()=>safe({revokedCount:2,signedOut:false})});await login(f);await open(f);password(f);f.click('account-sessions-revoke-others');await until(()=>f.id('account-sessions-message').textContent.includes('已退出 2 项其他登录'));
  assert.equal(f.rows().length,1);assert.match(f.rows()[0].textContent,/当前登录/);assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('account-sessions-password').value,'');
});
test('revoke all signs out and clears personal list, workspace identity and proof',async t=>{
  const f=fixture(t);await login(f);await open(f);password(f);f.click('account-sessions-revoke-all');await until(()=>f.id('workspace-view').hidden);
  assert.equal(f.rows().length,0);assert.equal(f.id('account-sessions-panel').open,false);assert.equal(f.id('account-sessions-password').value,'');assert.equal(f.id('account-name').textContent,'');assert.equal(f.id('login-submit').disabled,false);assert.match(f.id('login-message').textContent,/当前登录已退出/);
});
test('a confirmed revoke followed by refresh failure stays completed and does not display stale peers',async t=>{
  let lists=0;const f=fixture(t,{listAccountSessions:async()=>++lists===1?safe({sessions:[CURRENT,OTHER],hasMore:false}):fail('SERVICE_UNAVAILABLE','网络读取失败')});await login(f);await open(f);password(f);f.click('account-sessions-revoke-others');await until(()=>f.id('account-sessions-message').textContent.includes('退出操作已完成'));
  assert.match(f.id('account-sessions-message').textContent,/列表刷新失败/);assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.rows().length,0);assert.equal(f.id('account-sessions-password').value,'');assert.equal(f.id('account-sessions-revoke-others').disabled,true);assert.equal(f.id('account-sessions-refresh').disabled,false);assert.equal(count(f,'revokeOtherSessions'),1);
});
test('revoking the current row still signs out after its panel was closed during verification',async t=>{
  const wait=deferred();const f=fixture(t,{revokeAccountSession:()=>wait.promise});await login(f);await open(f);password(f);rowButton(f,CURRENT.id).click();await until(()=>count(f,'revokeAccountSession')===1);f.id('account-sessions-panel').querySelector('summary').click();assert.equal(f.id('account-sessions-password').value,'');assert.match(f.id('workspace-message').textContent,/已提交的退出请求仍可能完成/);
  wait.resolve(safe({revoked:true,signedOut:true}));await until(()=>f.id('workspace-view').hidden);assert.equal(f.id('account-name').textContent,'');
});
test('bulk verification remains single-flight across panel close/reopen and self sign-out wins',async t=>{
  const wait=deferred();const f=fixture(t,{revokeAllSessions:()=>wait.promise});await login(f);await open(f);password(f);f.click('account-sessions-revoke-all');await until(()=>count(f,'revokeAllSessions')===1);f.id('account-sessions-panel').querySelector('summary').click();f.id('account-sessions-panel').querySelector('summary').click();await until(()=>f.id('account-sessions-message').textContent.includes('仍在处理中'));
  f.click('account-sessions-revoke-all');f.click('account-sessions-refresh');assert.equal(count(f,'revokeAllSessions'),1);assert.equal(count(f,'listAccountSessions'),1);wait.resolve(safe({revokedCount:2,signedOut:true}));await until(()=>f.id('workspace-view').hidden);
});
test('a completed peer exit does not reopen a closed panel or restore cleared secrets',async t=>{
  const wait=deferred();const f=fixture(t,{revokeOtherSessions:()=>wait.promise});await login(f);await open(f);password(f);f.click('account-sessions-revoke-others');await until(()=>count(f,'revokeOtherSessions')===1);f.id('account-sessions-panel').querySelector('summary').click();wait.resolve(safe({revokedCount:1,signedOut:false}));await new Promise(r=>setTimeout(r,0));
  assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('account-sessions-panel').open,false);assert.equal(f.rows().length,0);assert.equal(f.id('account-sessions-password').value,'');assert.equal(count(f,'listAccountSessions'),1);
});
test('an old account late signedOut response cannot clear a newer account',async t=>{
  const wait=deferred();let logins=0;const f=fixture(t,{login:async()=>safe(++logins===1?SESSION:SESSION_B),revokeAllSessions:()=>wait.promise});await login(f);await open(f);password(f);f.click('account-sessions-revoke-all');await until(()=>count(f,'revokeAllSessions')===1);f.click('logout');await until(()=>f.id('workspace-view').hidden);await login(f);wait.resolve(safe({revokedCount:2,signedOut:true}));await new Promise(r=>setTimeout(r,0));
  assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('account-name').textContent,SESSION_B.account.displayName);assert.equal(f.id('account-sessions-panel').open,false);
});
test('a previous login late 401 cannot sign out a newer login of the same account',async t=>{
  const wait=deferred();const f=fixture(t,{listAccountSessions:()=>wait.promise});await login(f);f.id('account-sessions-panel').querySelector('summary').click();await until(()=>count(f,'listAccountSessions')===1);f.click('logout');await until(()=>f.id('workspace-view').hidden);await login(f);wait.resolve(fail('SIGN_IN_REQUIRED','Old session revoked'));await new Promise(r=>setTimeout(r,0));
  assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('account-name').textContent,SESSION.account.displayName);assert.ok(!f.id('login-message').textContent.includes('Old session'));
});
test('an authoritative current-session 401 clears all identity and explains the sign-out',async t=>{
  const f=fixture(t,{listAccountSessions:async()=>fail('SIGN_IN_REQUIRED','当前登录已被撤销，请重新登录。')});await login(f);f.id('account-sessions-panel').querySelector('summary').click();await until(()=>f.id('workspace-view').hidden);
  assert.equal(f.rows().length,0);assert.equal(f.id('account-sessions-password').value,'');assert.match(f.id('login-message').textContent,/已被撤销/);assert.equal(f.id('login-submit').disabled,false);
});
test('queued native opening preserves a just-entered password instead of resetting it',async t=>{
  const f=fixture(t);await login(f);f.id('account-sessions-panel').querySelector('summary').click();assert.equal(f.id('account-sessions-panel').open,true);password(f);await until(()=>count(f,'listAccountSessions')===1&&!f.id('account-sessions-refresh').disabled);
  assert.equal(f.id('account-sessions-password').value,PASSWORD);assert.equal(count(f,'revokeAllSessions')+count(f,'revokeOtherSessions'),0);
});
test('closing erases password and list, while reopening reads current data rather than cached rows',async t=>{
  const f=fixture(t);await login(f);await open(f);password(f);f.id('account-sessions-panel').querySelector('summary').click();assert.equal(f.id('account-sessions-password').value,'');assert.equal(f.rows().length,0);await open(f);assert.equal(count(f,'listAccountSessions'),2);
});
test('switching team clears the personal security view and never sends a team ID in session requests',async t=>{
  const f=fixture(t);await login(f);await open(f);password(f);f.id('team-select').value='team-b';f.id('team-select').dispatchEvent(new f.window.Event('change',{bubbles:true}));await until(()=>!f.id('logout').disabled);assert.equal(f.id('account-sessions-panel').open,false);assert.equal(f.id('account-sessions-password').value,'');assert.equal(f.rows().length,0);await open(f);
  for(const call of f.calls.filter(call=>call.name==='listAccountSessions'))assert.deepEqual({...call.arg},{limit:30});
});
test('a missing desktop session bridge disables actions without fabricating a device list',async t=>{
  const f=fixture(t,{listAccountSessions:undefined,revokeAccountSession:undefined,revokeOtherSessions:undefined,revokeAllSessions:undefined});await login(f);f.id('account-sessions-panel').querySelector('summary').click();await until(()=>f.id('account-sessions-message').textContent.includes('接口尚未就绪'));
  assert.equal(f.id('account-sessions-refresh').disabled,true);assert.equal(f.id('account-sessions-password').disabled,true);assert.equal(f.id('account-sessions-revoke-all').disabled,true);assert.equal(f.rows().length,0);assert.equal(f.id('workspace-view').hidden,false);
});
