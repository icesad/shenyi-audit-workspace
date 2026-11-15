'use strict';
const {withDeviceDiagnostic}=require('./helpers/desktop-device-diagnostic.cjs');
// Actual renderer DOM, explicit synthetic bridge. No SMS or external messages.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/index.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/team-ui.js'),'utf8');
const safe=value=>({ok:true,value});
const fail=(code,message)=>({ok:false,error:{code,message}});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const SESSION={account:{id:'employee-a',displayName:'合成员工'},memberships:[{teamId:'team-a',role:'intern'},{teamId:'team-b',role:'assistant'}],expiresAt:Date.now()+3600000};
const INVITE={invitationId:'invite-a',teamId:'team-a',role:'assistant',phoneMasked:'+8613****8000',expiresAt:Date.now()+3600000,status:'pending'};
const CODE='S'.repeat(43),PHONE='13800138000',PASSWORD='SyntheticNewPassword!2026';
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,0));}assert.ok(check(),'expected renderer state was not reached');}
function fixture(t,overrides={}){
  const dom=new JSDOM(html,{url:'shenyi://app/index.html',runScripts:'outside-only'}),{window}=dom,d=window.document,calls=[],writes=[];
  Object.defineProperty(window,'localStorage',{value:{setItem:(...x)=>writes.push(x),getItem:()=>null,removeItem:()=>{}}});
  const defaults={getAuthMethods:async()=>safe({mode:'local-preview',desktopWechatReady:true,methods:{demoUsername:true,phonePassword:true,phoneVerification:false,wechat:true,recovery:false}}),getOnboardingStatus:async()=>safe({available:true,invitationOnly:true}),login:async()=>safe(SESSION),loginPhone:async()=>safe(SESSION),listTasks:async()=>safe({tasks:[],hasMore:false}),logout:async()=>safe({signedOut:true}),getInvitationAccess:async()=>safe({canInvite:false}),listEmployeeInvitations:async()=>safe({invitations:[INVITE]}),createEmployeeInvitation:async()=>safe({...INVITE,invitationCode:CODE}),revokeEmployeeInvitation:async()=>safe({revoked:true}),previewEmployeeInvitation:async()=>safe(INVITE),requestEmployeeActivation:async()=>safe({challengeId:'challenge-a',expiresAt:Date.now()+300000}),activateEmployee:async()=>safe({activated:true}),startWechatLogin:async()=>safe({status:'pending',expiresAt:Date.now()+300000}),pollWechatLogin:async()=>safe({status:'pending',expiresAt:Date.now()+300000}),cancelWechatLogin:async()=>safe({canceled:true}),linkWechatAccount:async()=>safe({status:'signed_in',session:SESSION})};
  window.shenyiTeam=Object.fromEntries(Object.entries({...defaults,...overrides}).map(([name,fn])=>[name,typeof fn==='function'?async arg=>{calls.push({name,arg});return fn(arg);}:fn]));
  window.shenyiTeam=withDeviceDiagnostic(window.shenyiTeam);window.eval(script);t.after(()=>window.close());
  return {window,d,calls,writes,id:x=>d.getElementById(x),click:x=>d.getElementById(x).click(),submit:x=>d.getElementById(x).dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})),change:x=>d.getElementById(x).dispatchEvent(new window.Event('change',{bubbles:true})),input:x=>d.getElementById(x).dispatchEvent(new window.Event('input',{bubbles:true}))};
}
const count=(f,name)=>f.calls.filter(x=>x.name===name).length;
async function openActivation(f){await until(()=>count(f,'getOnboardingStatus')>=1);const before=count(f,'getOnboardingStatus');f.id('activation-panel').open=true;await until(()=>count(f,'getOnboardingStatus')>before);await until(()=>!f.id('activation-preview').disabled);}
function identity(f){f.id('activation-invitation').value=CODE;f.id('activation-phone').value=PHONE;f.input('activation-phone');}
async function preview(f){identity(f);f.click('activation-preview');await until(()=>!f.id('activation-target').hidden);}
async function proof(f){await openActivation(f);await preview(f);f.click('activation-send-code');await until(()=>!f.id('activation-code').disabled);f.id('activation-code').value='123456';f.id('activation-password').value=PASSWORD;f.id('activation-display-name').value='合成员工';}
function accept(f){f.id('activation-accept').checked=true;f.change('activation-accept');}
async function login(f){await until(()=>!f.id('login-submit').disabled);f.id('username').value='intern-a';f.id('password').value='ShenyiDemo!2026';f.submit('login-form');await until(()=>!f.id('workspace-view').hidden&&!f.id('logout').disabled);}

test('missing SMS capability never pretends to send or activate, including after an invitation preview',async t=>{
  const f=fixture(t,{getOnboardingStatus:async()=>safe({available:false,invitationOnly:true})});await openActivation(f);await preview(f);
  assert.match(f.id('activation-service-status').textContent,/尚未开通/);assert.equal(f.id('activation-send-code').disabled,true);assert.equal(f.id('activation-submit').disabled,true);f.click('activation-send-code');f.submit('activation-form');assert.equal(count(f,'requestEmployeeActivation'),0);assert.equal(count(f,'activateEmployee'),0);
});

test('native summary opening does not erase identity entered before its queued toggle event',async t=>{
  const f=fixture(t);await until(()=>count(f,'getOnboardingStatus')===1);f.id('activation-panel').querySelector('summary').click();assert.equal(f.id('activation-panel').open,true);
  // A real details toggle is queued. The user may type/paste after the native
  // opening is visible but before that event is delivered to the renderer.
  identity(f);const initial=count(f,'getOnboardingStatus');await until(()=>count(f,'getOnboardingStatus')>initial);
  assert.equal(f.id('activation-invitation').value,CODE);assert.equal(f.id('activation-phone').value,PHONE);f.click('activation-preview');await until(()=>!f.id('activation-target').hidden);assert.deepEqual({...f.calls.find(x=>x.name==='previewEmployeeInvitation').arg},{invitationCode:CODE,phone:PHONE});
});

test('activation requires explicit target consent and does not auto-login or retain secrets on success',async t=>{
  const f=fixture(t);await proof(f);assert.match(f.id('activation-target-description').textContent,/team-a.*助理/);assert.equal(f.id('activation-submit').disabled,true);f.submit('activation-form');assert.equal(count(f,'activateEmployee'),0);
  accept(f);f.submit('activation-form');await until(()=>f.id('activation-message').textContent.includes('账号已激活'));
  const call=f.calls.find(x=>x.name==='activateEmployee');assert.deepEqual({...call.arg},{invitationCode:CODE,phone:PHONE,challengeId:'challenge-a',code:'123456',password:PASSWORD,displayName:'合成员工',accept:true});assert.equal(count(f,'loginPhone'),0);assert.equal(f.id('workspace-view').hidden,true);assert.equal(f.id('login-mode').value,'phone');
  for(const id of ['activation-invitation','activation-phone','activation-code','activation-password','activation-display-name'])assert.equal(f.id(id).value,'');assert.equal(f.id('activation-accept').checked,false);assert.deepEqual(f.writes,[]);
});

test('changing invitation or phone clears prior target, verification, consent and password',async t=>{
  const f=fixture(t);await proof(f);accept(f);f.id('activation-phone').value='13900139000';f.input('activation-phone');
  assert.equal(f.id('activation-target').hidden,true);assert.equal(f.id('activation-proof').hidden,true);assert.equal(f.id('activation-password').value,'');assert.equal(f.id('activation-code').value,'');assert.equal(f.id('activation-accept').checked,false);f.submit('activation-form');assert.equal(count(f,'activateEmployee'),0);assert.equal(f.id('activation-invitation').value,CODE);
});

test('canceled preview cannot restore an old target or sensitive identity inputs',async t=>{
  const wait=deferred();const f=fixture(t,{previewEmployeeInvitation:()=>wait.promise});await openActivation(f);identity(f);f.click('activation-preview');assert.equal(f.id('activation-cancel').disabled,false);f.click('activation-cancel');wait.resolve(safe(INVITE));await new Promise(r=>setTimeout(r,0));
  assert.equal(f.id('activation-panel').open,false);assert.equal(f.id('activation-target').hidden,true);assert.equal(f.id('activation-phone').value,'');assert.equal(f.id('login-view').classList.contains('onboarding-active'),false);
});

test('canceling a pending SMS request discards its late verification context',async t=>{
  const wait=deferred();const f=fixture(t,{requestEmployeeActivation:()=>wait.promise});await openActivation(f);await preview(f);f.click('activation-send-code');f.click('activation-cancel');wait.resolve(safe({challengeId:'late-challenge',expiresAt:Date.now()+300000}));await new Promise(r=>setTimeout(r,0));
  assert.equal(f.id('activation-proof').hidden,true);assert.equal(f.id('activation-submit').disabled,true);f.submit('activation-form');assert.equal(count(f,'activateEmployee'),0);
});

test('a late activation completion after cancel cannot display success or sign in',async t=>{
  const wait=deferred();const f=fixture(t,{activateEmployee:()=>wait.promise});await proof(f);accept(f);f.submit('activation-form');f.click('activation-cancel');wait.resolve(safe({activated:true}));await new Promise(r=>setTimeout(r,0));
  assert.equal(f.id('activation-message').textContent,'');assert.match(f.id('login-message').textContent,/已提交的激活可能已完成/);assert.equal(f.id('activation-password').value,'');assert.equal(f.id('workspace-view').hidden,true);assert.equal(count(f,'loginPhone'),0);
});

test('switching to ordinary login mode clears activation proofs and restores the login form',async t=>{
  const f=fixture(t);await proof(f);accept(f);f.id('login-mode').value='phone';f.change('login-mode');assert.equal(f.id('activation-panel').open,false);assert.equal(f.id('activation-password').value,'');assert.equal(f.id('activation-invitation').value,'');assert.equal(f.id('activation-submit').disabled,true);assert.equal(f.id('login-view').classList.contains('onboarding-active'),false);
});

test('starting WeChat authorization clears activation and leaves cancellation available',async t=>{
  const f=fixture(t);await proof(f);accept(f);f.click('wechat-login');await until(()=>count(f,'startWechatLogin')===1);
  assert.equal(f.id('activation-panel').open,false);assert.equal(f.id('activation-password').value,'');assert.equal(f.id('activation-proof').hidden,true);assert.equal(f.id('wechat-cancel').disabled,false);
});

test('failed activation clears password and SMS proof before allowing a considered retry',async t=>{
  const f=fixture(t,{activateEmployee:async()=>fail('HTTP_401','账号或验证资料无效。')});await proof(f);accept(f);f.submit('activation-form');await until(()=>f.id('activation-message').textContent.includes('无效'));
  assert.equal(f.id('activation-password').value,'');assert.equal(f.id('activation-code').value,'');assert.equal(f.id('activation-accept').checked,false);assert.equal(f.id('activation-submit').disabled,true);assert.equal(f.id('activation-target').hidden,false);
});

test('existing-account activation may send an empty new-account-only display name',async t=>{
  const f=fixture(t);await proof(f);f.id('activation-display-name').value='';accept(f);f.submit('activation-form');await until(()=>count(f,'activateEmployee')===1);assert.equal(f.calls.find(x=>x.name==='activateEmployee').arg.displayName,'');
});

test('expired verification cannot be submitted even through a programmatic form event',async t=>{
  const f=fixture(t,{requestEmployeeActivation:async()=>safe({challengeId:'expired',expiresAt:Date.now()-1})});await openActivation(f);await preview(f);f.click('activation-send-code');await until(()=>count(f,'requestEmployeeActivation')===1&&!f.id('activation-phone').disabled);accept(f);f.submit('activation-form');assert.equal(count(f,'activateEmployee'),0);assert.match(f.id('activation-message').textContent,/过期/);
});

test('an independent invite grant controls the panel regardless of business role',async t=>{
  const granted=fixture(t,{getInvitationAccess:async()=>safe({canInvite:true})});await login(granted);await until(()=>!granted.id('employee-invitations-panel').hidden);assert.equal(granted.id('role-label').textContent,'实习生');assert.equal(count(granted,'listEmployeeInvitations'),1);
  const ungranted=fixture(t,{login:async()=>safe({...SESSION,memberships:[{teamId:'team-a',role:'partner'}]})});await login(ungranted);await until(()=>count(ungranted,'getInvitationAccess')===1);assert.equal(ungranted.id('employee-invitations-panel').hidden,true);assert.equal(count(ungranted,'listEmployeeInvitations'),0);
});

test('creation exposes one transfer code only once and keeps the list masked',async t=>{
  const f=fixture(t,{getInvitationAccess:async()=>safe({canInvite:true})});await login(f);await until(()=>!f.id('employee-invitations-panel').hidden);f.id('employee-invitations-panel').open=true;f.id('invitation-phone').value=PHONE;f.id('invitation-role').value='assistant';f.submit('employee-invitation-form');await until(()=>!f.id('issued-invitation').hidden);
  assert.deepEqual([...f.id('invitation-role').options].map(x=>x.value),['intern','assistant']);assert.equal(f.id('issued-invitation-code').value,CODE);assert.equal(f.id('issued-invitation-code').readOnly,true);assert.equal(f.id('invitation-phone').value,'');assert.ok(!f.id('employee-invitation-list').textContent.includes(PHONE));assert.ok(!f.id('employee-invitation-list').textContent.includes(CODE));assert.match(f.id('invitation-message').textContent,/未发送消息/);
  f.id('employee-invitations-panel').open=false;await until(()=>f.id('issued-invitation-code').value==='');f.id('employee-invitations-panel').open=true;await new Promise(r=>setTimeout(r,0));assert.equal(f.id('issued-invitation').hidden,true);assert.deepEqual(f.writes,[]);
});

test('a team switch cannot receive a late invitation list belonging to the previous team',async t=>{
  const wait=deferred();const f=fixture(t,{getInvitationAccess:async()=>safe({canInvite:true}),listEmployeeInvitations:arg=>arg.teamId==='team-a'?wait.promise:Promise.resolve(safe({invitations:[]}))});await login(f);await until(()=>count(f,'listEmployeeInvitations')===1);f.id('team-select').value='team-b';f.change('team-select');await until(()=>count(f,'getInvitationAccess')===2&&!f.id('employee-invitations-panel').hidden);wait.resolve(safe({invitations:[INVITE]}));await new Promise(r=>setTimeout(r,0));assert.ok(!f.id('employee-invitation-list').textContent.includes(INVITE.phoneMasked));assert.match(f.id('employee-invitation-list').textContent,/暂无/);
});

test('permission loss on refresh removes the old list and issued code',async t=>{
  let allowed=true;const f=fixture(t,{getInvitationAccess:async()=>safe({canInvite:allowed})});await login(f);await until(()=>!f.id('employee-invitations-panel').hidden);f.id('employee-invitations-panel').open=true;f.id('invitation-phone').value=PHONE;f.submit('employee-invitation-form');await until(()=>!f.id('issued-invitation').hidden);allowed=false;f.click('invitation-refresh');await until(()=>f.id('employee-invitations-panel').hidden);assert.equal(f.id('issued-invitation-code').value,'');assert.equal(f.id('employee-invitation-list').textContent,'');assert.equal(f.id('invitation-phone').value,'');
});

test('a failed authoritative invitation read hides all previously granted metadata',async t=>{
  let denied=false;const f=fixture(t,{getInvitationAccess:async()=>safe({canInvite:true}),listEmployeeInvitations:async()=>denied?fail('HTTP_404','无法访问此资源。'):safe({invitations:[INVITE]})});await login(f);await until(()=>!f.id('employee-invitations-panel').hidden);denied=true;f.click('invitation-refresh');await until(()=>f.id('employee-invitations-panel').hidden);assert.equal(f.id('employee-invitation-list').textContent,'');assert.equal(f.id('issued-invitation-code').value,'');
});

test('revoking a pending invitation refreshes only the current team list',async t=>{
  let revoked=false;const f=fixture(t,{getInvitationAccess:async()=>safe({canInvite:true}),listEmployeeInvitations:async()=>safe({invitations:[{...INVITE,status:revoked?'revoked':'pending'}]}),revokeEmployeeInvitation:async()=>{revoked=true;return safe({revoked:true});}});await login(f);await until(()=>!f.id('employee-invitations-panel').hidden);f.id('employee-invitation-list').querySelector('button').click();await until(()=>f.id('employee-invitation-list').textContent.includes('已撤销'));assert.deepEqual({...f.calls.find(x=>x.name==='revokeEmployeeInvitation').arg},{teamId:'team-a',invitationId:'invite-a'});assert.equal(f.id('employee-invitation-list').querySelector('button'),null);
});

test('logout discards a late newly-created invitation and its transfer code',async t=>{
  const wait=deferred();const f=fixture(t,{getInvitationAccess:async()=>safe({canInvite:true}),createEmployeeInvitation:()=>wait.promise});await login(f);await until(()=>!f.id('employee-invitations-panel').hidden);f.id('employee-invitations-panel').open=true;f.id('invitation-phone').value=PHONE;f.submit('employee-invitation-form');f.click('logout');await until(()=>f.id('workspace-view').hidden);wait.resolve(safe({...INVITE,invitationCode:CODE}));await new Promise(r=>setTimeout(r,0));assert.equal(f.id('issued-invitation-code').value,'');assert.equal(f.id('employee-invitations-panel').hidden,true);assert.equal(f.id('employee-invitation-list').textContent,'');
});

test('an expired authenticated invitation operation clears the entire old workspace',async t=>{
  const f=fixture(t,{getInvitationAccess:async()=>safe({canInvite:true}),createEmployeeInvitation:async()=>fail('SIGN_IN_REQUIRED','登录已失效，请重新登录。')});await login(f);await until(()=>!f.id('employee-invitations-panel').hidden);f.id('invitation-phone').value=PHONE;f.submit('employee-invitation-form');await until(()=>f.id('workspace-view').hidden);assert.equal(f.id('account-name').textContent,'');assert.equal(f.id('issued-invitation-code').value,'');assert.equal(f.id('employee-invitation-list').textContent,'');assert.equal(f.id('login-submit').disabled,false);
});

test('closing the activation panel or unloading the window clears all entered proofs',async t=>{
  const f=fixture(t);await proof(f);accept(f);f.id('activation-panel').open=false;await until(()=>f.id('activation-password').value==='');assert.equal(f.id('activation-code').value,'');assert.equal(f.id('activation-accept').checked,false);
  await proof(f);f.window.dispatchEvent(new f.window.Event('beforeunload'));assert.equal(f.id('activation-invitation').value,'');assert.equal(f.id('activation-password').value,'');assert.equal(f.id('activation-panel').open,false);
});
