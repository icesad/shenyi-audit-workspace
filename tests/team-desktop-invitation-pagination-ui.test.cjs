'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const {withDeviceDiagnostic}=require('./helpers/desktop-device-diagnostic.cjs');
const html=fs.readFileSync('desktop/team-ui/index.html','utf8'),script=fs.readFileSync('desktop/team-ui/team-ui.js','utf8');
const ok=value=>({ok:true,value}),fail=code=>({ok:false,error:{code,message:'合成读取未确认'}}),CODE='Q'.repeat(43),PHONE='13800138000';
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
async function until(check){const end=Date.now()+5000;while(!check()){assert.ok(Date.now()<end,'expected invitation UI state');await new Promise(r=>setTimeout(r,1));}}
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setTimeout(r,1));};
function row(teamId,index,changes={}){return{invitationId:'invite-'+teamId+'-'+index,teamId,phoneMasked:'+8613****'+String(index).padStart(4,'0'),role:index%2?'assistant':'intern',status:'pending',expiresAt:1890000000000,...changes};}
const cursor=(teamId,index)=>Buffer.from(JSON.stringify({teamId,boundary:index,privateMarker:'not-a-display-field'})).toString('base64url');
function device(state,epoch){return{required:true,state,epoch,device:state==='signed_out'?null:{id:'12345678-1234-4234-8234-1234567890ab',displayName:'合成电脑',platform:'win32',keyFingerprint:'a'.repeat(64),status:'active',revision:1},localFingerprint:state==='signed_out'?null:'a'.repeat(64),expiresAt:state==='signed_out'?null:Date.now()+900000};}
function fixture(t){
 const dom=new JSDOM(html,{url:'shenyi://app/index.html',runScripts:'outside-only'}),w=dom.window,d=w.document,calls=[],timers=[];
 let account={id:'manager-a',displayName:'合成管理员'},current=device('signed_out',0),allowed=true,created=0;
 const rows={'team-a':Array.from({length:125},(_,i)=>row('team-a',i)),'team-b':Array.from({length:2},(_,i)=>row('team-b',900+i))},handlers={};
 const session=()=>({account:{...account},memberships:[{teamId:'team-a',role:'intern'},{teamId:'team-b',role:'assistant'}],expiresAt:Date.now()+900000,device:current});
 const page=input=>{const start=input.after===undefined?0:input.after===cursor(input.teamId,50)?50:input.after===cursor(input.teamId,100)?100:-1;if(start<0)return fail('HTTP_400');const items=rows[input.teamId].slice(start,start+50);return ok({invitations:items,nextCursor:start+50<rows[input.teamId].length?cursor(input.teamId,start+50):null});};
 const defaults={getAuthMethods:async()=>ok({mode:'local-preview',desktopWechatReady:false,methods:{demoUsername:true,phonePassword:true,phoneVerification:false,wechat:false,recovery:false}}),getOnboardingStatus:async()=>ok({available:false,invitationOnly:true}),
  login:async()=>{current=device('ready',current.epoch+1);return ok(session());},getDeviceStatus:async()=>ok(current),getSession:async()=>ok(current.state==='signed_out'?null:session()),enrollDevice:async()=>fail('DENIED'),reconnectDevice:async()=>{current=device('ready',current.epoch+1);return ok(session());},logout:async()=>{current=device('signed_out',current.epoch+1);return ok({signedOut:true});},
  listTasks:async()=>ok({tasks:[],hasMore:false}),getInvitationAccess:async input=>handlers.access?handlers.access(input):ok({canInvite:allowed}),listEmployeeInvitations:async input=>handlers.list?handlers.list(input):page(input),
  createEmployeeInvitation:async input=>{if(handlers.create)return handlers.create(input);const added=row(input.teamId,1000+(++created),{invitationId:'created-'+created,role:input.role});rows[input.teamId].unshift(added);return ok({...added,invitationCode:CODE});},
  revokeEmployeeInvitation:async input=>{if(handlers.revoke)return handlers.revoke(input);const item=rows[input.teamId].find(x=>x.invitationId===input.invitationId);item.status='revoked';return ok({revoked:true});},
  previewEmployeeInvitation:async()=>ok({}),requestEmployeeActivation:async()=>fail('DISABLED'),activateEmployee:async()=>fail('DISABLED')
 };
 w.setInterval=(fn,ms)=>{if(ms===1000)timers.push(fn);return timers.length+1;};w.clearInterval=()=>{};
 w.shenyiTeam=withDeviceDiagnostic(Object.fromEntries(Object.entries(defaults).map(([name,fn])=>[name,async input=>{calls.push({name,input:structuredClone(input)});return structuredClone(await fn(input));}])));
 w.eval(script);t.after(()=>{w.dispatchEvent(new w.Event('beforeunload'));w.close();});
 const id=name=>d.getElementById(name),click=name=>id(name).click(),change=name=>id(name).dispatchEvent(new w.Event('change',{bubbles:true}));
 async function login(nextAccount){if(nextAccount)account=nextAccount;await until(()=>!id('login-submit').disabled);id('username').value='synthetic';id('password').value='Synthetic Password!';id('login-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!id('workspace-view').hidden&&!id('logout').disabled);}
 async function open(){await until(()=>!id('employee-invitations-panel').hidden&&!id('invitation-refresh').disabled);id('employee-invitations-panel').open=true;await settle();}
 async function navigation(name,pageNumber){click(name);await until(()=>id('invitation-page-status').textContent.startsWith('第 '+pageNumber+' 页')&&!id('invitation-refresh').disabled);}
 async function createInvitation(){id('invitation-phone').value=PHONE;id('invitation-role').value='assistant';id('employee-invitation-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!id('issued-invitation').hidden&&!id('invitation-refresh').disabled);}
 return{w,d,id,calls,rows,handlers,page,login,open,navigation,createInvitation,click,change,
  allow:value=>allowed=value,pause(){current=device('paused',current.epoch+1);for(const fn of timers)fn();},
  submit(){id('employee-invitation-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));},
  team(value){id('team-select').value=value;change('team-select');}
 };
}
const count=(f,name)=>f.calls.filter(x=>x.name===name).length,lists=f=>f.calls.filter(x=>x.name==='listEmployeeInvitations');
function cleared(f){assert.equal(f.id('employee-invitation-list').textContent,'');assert.equal(f.id('invitation-page-status').textContent,'');assert.equal(f.id('issued-invitation-code').value,'');assert.equal(f.id('invitation-phone').value,'');assert.equal(f.id('invitation-prev').disabled,true);assert.equal(f.id('invitation-next').disabled,true);}

test('next and previous replace a maximum fifty-row page and resend only opaque page input',async t=>{
 const f=fixture(t);await f.login();await f.open();assert.equal(f.id('employee-invitation-list').children.length,50);assert.match(f.id('invitation-page-status').textContent,/第 1 页.*本页 50 条/);assert.equal(f.id('invitation-prev').disabled,true);
 const first=row('team-a',0).phoneMasked;assert.ok(f.id('employee-invitation-list').textContent.includes(first));await f.navigation('invitation-next',2);assert.equal(f.id('employee-invitation-list').children.length,50);assert.ok(!f.id('employee-invitation-list').textContent.includes(first));assert.equal(lists(f).at(-1).input.after,cursor('team-a',50));assert.equal(lists(f).at(-1).input.limit,50);assert.ok(!f.d.documentElement.outerHTML.includes(cursor('team-a',50)));
 await f.navigation('invitation-prev',1);assert.equal(lists(f).at(-1).input.after,undefined);assert.equal(f.id('employee-invitation-list').children.length,50);assert.equal(f.id('invitation-prev').disabled,true);assert.ok(f.id('employee-invitation-list').textContent.includes(first));
});
test('last page reports its current count without a total and is re-read on back and next',async t=>{
 const f=fixture(t);await f.login();await f.open();await f.navigation('invitation-next',2);await f.navigation('invitation-next',3);assert.equal(f.id('employee-invitation-list').children.length,25);assert.match(f.id('invitation-page-status').textContent,/第 3 页.*本页 25 条/);assert.equal(f.id('invitation-next').disabled,true);
 await f.navigation('invitation-prev',2);assert.equal(lists(f).at(-1).input.after,cursor('team-a',50));await f.navigation('invitation-next',3);assert.equal(lists(f).at(-1).input.after,cursor('team-a',100));assert.equal(f.id('employee-invitation-list').children.length,25);
});
test('create from a later page sends once, returns home and retains only the new one-time code',async t=>{
 const f=fixture(t);await f.login();await f.open();await f.navigation('invitation-next',2);await f.createInvitation();assert.equal(count(f,'createEmployeeInvitation'),1);assert.equal(lists(f).at(-1).input.after,undefined);assert.match(f.id('invitation-page-status').textContent,/第 1 页/);assert.equal(f.id('issued-invitation-code').value,CODE);assert.equal(f.id('invitation-phone').value,'');assert.match(f.id('invitation-message').textContent,/未发送消息/);assert.ok(!f.id('employee-invitation-list').textContent.includes(CODE));assert.deepEqual([...f.id('invitation-role').options].map(x=>x.value),['intern','assistant']);
 await f.navigation('invitation-next',2);assert.equal(f.id('issued-invitation-code').value,'');assert.equal(count(f,'createEmployeeInvitation'),1);
});
for(const code of ['HTTP_429','HTTP_503']){
 test('confirmed invitation stays available when only the history read returns '+code,async t=>{
  const f=fixture(t);await f.login();await f.open();await f.navigation('invitation-next',2);
  const oldRevoke=f.id('employee-invitation-list').querySelector('button'),after=f.calls.length;
  f.handlers.list=async()=>fail(code);
  await f.createInvitation();
  assert.deepEqual(f.calls.slice(after).map(call=>call.name),['createEmployeeInvitation','getInvitationAccess','listEmployeeInvitations']);
  assert.equal(f.rows['team-a'][0].invitationId,'created-1');
  assert.equal(f.rows['team-a'][0].status,'pending');
  assert.equal(f.id('employee-invitations-panel').open,true);
  assert.equal(f.id('issued-invitation-code').value,CODE);
  assert.equal(f.id('invitation-phone').value,'');
  assert.match(f.id('invitation-message').textContent,/邀请已创建.*列表.*先.*邀请码/);
  assert.equal(f.id('employee-invitation-list').children.length,0);
  assert.equal(f.id('invitation-page-status').textContent,'');
  for(const control of ['invitation-create','invitation-prev','invitation-next'])assert.equal(f.id(control).disabled,true);
  f.submit();oldRevoke.click();
  assert.equal(count(f,'createEmployeeInvitation'),1);
  assert.equal(count(f,'revokeEmployeeInvitation'),0);
  f.handlers.list=null;f.click('invitation-refresh');
  assert.equal(f.id('issued-invitation-code').value,'');
  await until(()=>!f.id('invitation-create').disabled&&f.id('invitation-page-status').textContent.startsWith('第 1 页'));
  assert.ok(f.id('employee-invitation-list').textContent.includes(f.rows['team-a'][0].phoneMasked));
  assert.equal(count(f,'createEmployeeInvitation'),1);
 });
}

test('a created invitation is withheld when the follow-up scope or response cannot be verified',async t=>{
 for(const scenario of [
  {access:ok({canInvite:false})}, {access:fail('HTTP_503')},
  {history:fail('HTTP_404')}, {history:ok({invitations:[row('team-b',1)],nextCursor:null})}
 ]){
  const f=fixture(t);await f.login();await f.open();
  if(scenario.access)f.handlers.access=async()=>scenario.access;
  if(scenario.history)f.handlers.list=async()=>scenario.history;
  f.id('invitation-phone').value=PHONE;f.submit();
  await until(()=>f.id('employee-invitations-panel').hidden);cleared(f);
  assert.equal(f.rows['team-a'][0].status,'pending');
  assert.equal(count(f,'createEmployeeInvitation'),1);
 }
});

test('collapsing an already open and refreshed panel clears the retained receipt',async t=>{
 const f=fixture(t);await f.login();await f.open();
 const before=lists(f).length;f.click('invitation-refresh');
 await until(()=>lists(f).length>before&&!f.id('invitation-create').disabled);
 f.handlers.list=async()=>fail('HTTP_429');await f.createInvitation();
 assert.equal(f.id('issued-invitation-code').value,CODE);
 f.id('employee-invitations-panel').open=false;await settle();cleared(f);
 assert.equal(count(f,'createEmployeeInvitation'),1);
});
test('revoke sends one mutation then refreshes the current page using its same opaque cursor',async t=>{
 const f=fixture(t);await f.login();await f.open();await f.navigation('invitation-next',2);const button=f.id('employee-invitation-list').querySelector('button');button.click();button.click();await until(()=>f.id('employee-invitation-list').textContent.includes('已撤销')&&!f.id('invitation-refresh').disabled);assert.equal(count(f,'revokeEmployeeInvitation'),1);assert.equal(lists(f).at(-1).input.after,cursor('team-a',50));assert.match(f.id('invitation-page-status').textContent,/第 2 页/);assert.equal(f.id('employee-invitation-list').children.length,50);
});
test('a pending page read clears private rows and locks navigation, create and stale-row revoke',async t=>{
 const f=fixture(t);await f.login();await f.open();await f.createInvitation();const oldButton=f.id('employee-invitation-list').querySelector('button'),gate=deferred();f.handlers.list=()=>gate.promise;f.click('invitation-next');await until(()=>lists(f).at(-1).input.after===cursor('team-a',50));assert.equal(f.id('employee-invitation-list').textContent,'');assert.equal(f.id('issued-invitation-code').value,'');for(const name of ['invitation-prev','invitation-next','invitation-create'])assert.equal(f.id(name).disabled,true);f.submit();oldButton.click();assert.equal(count(f,'createEmployeeInvitation'),1);assert.equal(count(f,'revokeEmployeeInvitation'),0);
 gate.resolve(f.page({teamId:'team-a',after:cursor('team-a',50),limit:50}));await until(()=>f.id('invitation-page-status').textContent.startsWith('第 2 页'));
});
test('close clears page cursors and code, while reopening obtains a fresh first page',async t=>{
 const f=fixture(t);await f.login();await f.open();await f.createInvitation();await f.navigation('invitation-next',2);const before=lists(f).length;f.id('employee-invitations-panel').open=false;await settle();cleared(f);assert.equal(f.id('employee-invitations-panel').hidden,false);f.id('employee-invitations-panel').open=true;await until(()=>lists(f).length>before&&!f.id('invitation-refresh').disabled);assert.match(f.id('invitation-page-status').textContent,/第 1 页/);assert.equal(lists(f).at(-1).input.after,undefined);assert.equal(f.id('issued-invitation-code').value,'');
});
test('closing and reopening while next is pending rejects its late old page',async t=>{
 const f=fixture(t);await f.login();await f.open();const gate=deferred();f.handlers.list=()=>gate.promise;f.click('invitation-next');await until(()=>lists(f).length===2);f.id('employee-invitations-panel').open=false;await settle();cleared(f);f.handlers.list=null;f.id('employee-invitations-panel').open=true;await until(()=>!f.id('invitation-refresh').disabled&&f.id('invitation-page-status').textContent.startsWith('第 1 页'));const text=f.id('employee-invitation-list').textContent;gate.resolve(f.page({teamId:'team-a',after:cursor('team-a',50)}));await settle();assert.equal(f.id('employee-invitation-list').textContent,text);assert.match(f.id('invitation-page-status').textContent,/第 1 页/);
});
test('team switch rejects late prior-team page401 without clearing the new team login',async t=>{
 const f=fixture(t);await f.login();await f.open();const gate=deferred();f.handlers.list=input=>input.teamId==='team-a'&&input.after?gate.promise:f.page(input);f.click('invitation-next');await until(()=>lists(f).length===2);f.team('team-b');assert.equal(f.id('employee-invitation-list').textContent,'');await until(()=>!f.id('invitation-refresh').disabled&&f.id('employee-invitation-list').textContent.includes(row('team-b',900).phoneMasked));gate.resolve(fail('SIGN_IN_REQUIRED'));await settle();assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('invitation-team').value,'team-b');assert.match(f.id('invitation-page-status').textContent,/第 1 页/);
});
test('a late old-account page401 cannot sign out or populate a new account',async t=>{
 const f=fixture(t),gate=deferred();f.handlers.list=()=>gate.promise;await f.login();await until(()=>lists(f).length===1);f.click('logout');await until(()=>!f.id('login-submit').disabled);f.handlers.list=null;await f.login({id:'other-admin',displayName:'另一合成管理员'});await f.open();const text=f.id('employee-invitation-list').textContent;gate.resolve(fail('SIGN_IN_REQUIRED'));await settle();assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('account-name').textContent,'另一合成管理员');assert.equal(f.id('employee-invitation-list').textContent,text);
});
test('fresh permission denial on navigation removes all page metadata and prevents the next list call',async t=>{
 const f=fixture(t);await f.login();await f.open();await f.createInvitation();const before=lists(f).length;f.allow(false);f.click('invitation-next');await until(()=>f.id('employee-invitations-panel').hidden);cleared(f);assert.equal(lists(f).length,before);assert.equal(count(f,'createEmployeeInvitation'),1);
});
test('read failure or malformed paging output fails closed rather than keeping the old page',async t=>{
 for(const reply of [fail('HTTP_400'),fail('HTTP_429'),fail('HTTP_503'),ok({invitations:[row('team-a',51)]}),ok({invitations:[row('team-a',51)],nextCursor:undefined}),ok({invitations:[row('team-a',51)],nextCursor:cursor('team-a',50)})]){
  const f=fixture(t);await f.login();await f.open();f.handlers.list=async()=>reply;f.click('invitation-next');await until(()=>f.id('employee-invitations-panel').hidden);cleared(f);assert.equal(count(f,'revokeEmployeeInvitation'),0);
 }
});
test('duplicate invitation IDs from different sources remain separate and an ambiguous revoke is single-send',async t=>{
 const f=fixture(t);f.handlers.list=async()=>ok({invitations:[row('team-a',1,{invitationId:'same-id'}),row('team-a',2,{invitationId:'same-id'})],nextCursor:null});f.handlers.revoke=async()=>fail('HTTP_409');await f.login();await f.open();assert.equal(f.id('employee-invitation-list').children.length,2);assert.ok(f.id('employee-invitation-list').textContent.includes(row('team-a',1).phoneMasked));assert.ok(f.id('employee-invitation-list').textContent.includes(row('team-a',2).phoneMasked));const button=f.id('employee-invitation-list').querySelector('button');button.click();button.click();await until(()=>f.id('employee-invitations-panel').hidden);cleared(f);assert.equal(count(f,'revokeEmployeeInvitation'),1);assert.equal(f.calls.find(c=>c.name==='revokeEmployeeInvitation').input.invitationId,'same-id');
});
test('offline clears code and cursor history, and online preserves a reachable fresh first-page panel',async t=>{
 const f=fixture(t);await f.login();await f.open();await f.createInvitation();await f.navigation('invitation-next',2);f.w.dispatchEvent(new f.w.Event('offline'));cleared(f);assert.equal(f.id('employee-invitations-panel').hidden,true);const before=lists(f).length;f.w.dispatchEvent(new f.w.Event('online'));await until(()=>lists(f).length>before&&!f.id('employee-invitations-panel').hidden);await f.open();assert.equal(lists(f).at(-1).input.after,undefined);assert.match(f.id('invitation-page-status').textContent,/第 1 页/);assert.equal(f.id('issued-invitation-code').value,'');assert.equal(count(f,'createEmployeeInvitation'),1);
});
test('main device pause clears a pending page and late success does not restore it',async t=>{
 const f=fixture(t);await f.login();await f.open();const gate=deferred();f.handlers.list=()=>gate.promise;f.click('invitation-next');await until(()=>lists(f).length===2);f.pause();await until(()=>f.id('workspace-view').hidden);cleared(f);gate.resolve(f.page({teamId:'team-a',after:cursor('team-a',50)}));await settle();cleared(f);assert.equal(f.id('employee-invitations-panel').hidden,true);
});
for(const operation of ['create','revoke']){
 test('team change clears the old page during pending '+operation+' and its late acknowledgment cannot refill',async t=>{
  const f=fixture(t);await f.login();await f.open();await f.navigation('invitation-next',2);const gate=deferred();f.handlers[operation]=()=>gate.promise;
  if(operation==='create'){f.id('invitation-phone').value=PHONE;f.submit();}else f.id('employee-invitation-list').querySelector('button').click();await until(()=>count(f,operation==='create'?'createEmployeeInvitation':'revokeEmployeeInvitation')===1);
  f.team('team-b');assert.equal(f.id('employee-invitation-list').textContent,'');assert.equal(f.id('invitation-page-status').textContent,'');assert.equal(f.id('invitation-phone').value,'');assert.equal(f.id('issued-invitation-code').value,'');await until(()=>f.id('employee-invitation-list').textContent.includes(row('team-b',900).phoneMasked));assert.equal(f.id('invitation-create').disabled,true);f.submit();assert.equal(count(f,operation==='create'?'createEmployeeInvitation':'revokeEmployeeInvitation'),1);
  gate.resolve(operation==='create'?ok({...row('team-a',1001),invitationCode:CODE}):ok({revoked:true}));await until(()=>!f.id('invitation-create').disabled);assert.equal(f.id('invitation-team').value,'team-b');assert.equal(f.id('issued-invitation-code').value,'');assert.ok(!f.id('employee-invitation-list').textContent.includes(row('team-a',50).phoneMasked));assert.match(f.id('invitation-page-status').textContent,/第 1 页/);
 });
}
test('explicit refresh returns home and clears the displayed one-time code without another create',async t=>{
 const f=fixture(t);await f.login();await f.open();await f.createInvitation();assert.equal(f.id('issued-invitation-code').value,CODE);assert.match(f.id('invitation-refresh').textContent,/首页.*清除邀请码/);f.click('invitation-refresh');assert.equal(f.id('issued-invitation-code').value,'');await until(()=>!f.id('invitation-refresh').disabled);assert.equal(lists(f).at(-1).input.after,undefined);assert.equal(count(f,'createEmployeeInvitation'),1);assert.match(f.id('invitation-service-status').textContent,/短信激活服务尚未开通/);
});

for(const [code,notice]of [['SEAT_CAPACITY_EXHAUSTED','可用席位已用完。请核对待激活邀请和当前席位。'],['SUBSCRIPTION_WRITE_UNAVAILABLE','当前订阅不可创建邀请。请在订阅与席位中核对当前状态。']]){
 test('explicit '+code+' preserves the reachable first page after fresh permission and list reads',async t=>{
  const f=fixture(t);await f.login();await f.open();await f.createInvitation();
  const original=f.rows['team-a'][0],total=f.rows['team-a'].length,accessBefore=count(f,'getInvitationAccess'),listBefore=lists(f).length,callBefore=f.calls.length;
  f.handlers.create=async()=>fail(code);f.id('invitation-phone').value='13900139000';f.id('invitation-role').value='assistant';f.submit();f.submit();
  await until(()=>f.id('invitation-message').textContent===notice&&!f.id('invitation-create').disabled);
  assert.equal(count(f,'createEmployeeInvitation'),2);assert.equal(count(f,'getInvitationAccess'),accessBefore+1);assert.equal(lists(f).length,listBefore+1);
  assert.deepEqual(f.calls.slice(callBefore).map(call=>call.name),['createEmployeeInvitation','getInvitationAccess','listEmployeeInvitations']);
  assert.equal(f.id('employee-invitations-panel').hidden,false);assert.equal(f.id('employee-invitations-panel').open,true);
  assert.equal(f.id('issued-invitation-code').value,'');assert.equal(f.id('issued-invitation').hidden,true);assert.equal(f.id('invitation-phone').value,'');
  assert.equal(f.id('employee-invitation-list').children.length,50);assert.ok(f.id('employee-invitation-list').textContent.includes(original.phoneMasked));assert.equal(f.rows['team-a'].length,total);assert.equal(original.status,'pending');
  assert.equal(lists(f).at(-1).input.after,undefined);assert.match(f.id('invitation-page-status').textContent,/第 1 页/);assert.equal(count(f,'revokeEmployeeInvitation'),0);
 });
 test('explicit '+code+' cannot preserve stale invitations if fresh permission was removed',async t=>{
  const f=fixture(t);await f.login();await f.open();await f.createInvitation();const listBefore=lists(f).length,accessBefore=count(f,'getInvitationAccess');
  f.handlers.create=async()=>{f.allow(false);return fail(code);};f.id('invitation-phone').value='13900139000';f.submit();
  await until(()=>f.id('employee-invitations-panel').hidden);cleared(f);
  assert.equal(count(f,'createEmployeeInvitation'),2);assert.equal(count(f,'getInvitationAccess'),accessBefore+1);assert.equal(lists(f).length,listBefore);assert.equal(f.id('workspace-view').hidden,false);
 });
}

test('a failed list recheck after capacity denial hides the old page and never retries the create',async t=>{
 const f=fixture(t);await f.login();await f.open();await f.createInvitation();const listBefore=lists(f).length;
 f.handlers.create=async()=>fail('SEAT_CAPACITY_EXHAUSTED');f.handlers.list=async()=>fail('HTTP_503');f.id('invitation-phone').value='13900139000';f.submit();
 await until(()=>f.id('employee-invitations-panel').hidden);cleared(f);assert.equal(count(f,'createEmployeeInvitation'),2);assert.equal(lists(f).length,listBefore+1);assert.equal(f.id('invitation-message').textContent,'');
});

test('a late capacity refusal cannot overwrite a different team or trigger old-team revalidation',async t=>{
 const f=fixture(t);await f.login();await f.open();const gate=deferred();f.handlers.create=()=>gate.promise;
 f.id('invitation-phone').value='13900139000';f.submit();await until(()=>count(f,'createEmployeeInvitation')===1);
 f.team('team-b');await until(()=>f.id('employee-invitation-list').textContent.includes(row('team-b',900).phoneMasked));
 const listBefore=lists(f).length,accessBefore=count(f,'getInvitationAccess');gate.resolve(fail('SEAT_CAPACITY_EXHAUSTED'));await until(()=>!f.id('invitation-create').disabled);
 assert.equal(f.id('invitation-team').value,'team-b');assert.equal(f.id('employee-invitations-panel').hidden,false);assert.equal(f.id('issued-invitation-code').value,'');assert.equal(f.id('invitation-message').textContent,'');
 assert.equal(lists(f).length,listBefore);assert.equal(count(f,'getInvitationAccess'),accessBefore);assert.equal(count(f,'createEmployeeInvitation'),1);
});

test('unknown submission results remain closed and are not treated as explicit capacity refusals',async t=>{
 for(const code of ['HTTP_409','HTTP_503','SERVICE_UNAVAILABLE']){
  const f=fixture(t);await f.login();await f.open();await f.createInvitation();const listBefore=lists(f).length,accessBefore=count(f,'getInvitationAccess');
  f.handlers.create=async()=>fail(code);f.id('invitation-phone').value='13900139000';f.submit();await until(()=>f.id('employee-invitations-panel').hidden);cleared(f);
  assert.equal(count(f,'createEmployeeInvitation'),2);assert.equal(lists(f).length,listBefore);assert.equal(count(f,'getInvitationAccess'),accessBefore);
 }
});
