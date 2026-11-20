'use strict';
const {ledgerLegacyFormCount,ledgerLegacySecretCount}=require('./helpers/ledger-check-entry-layer.cjs');
const {withDeviceDiagnostic}=require('./helpers/desktop-device-diagnostic.cjs');
// Real renderer DOM, synthetic narrow bridge. No platform/SMS/account creation.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/index.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/team-ui.js'),'utf8');
const safe=value=>({ok:true,value}),fail=(code,message)=>({ok:false,error:{code,message}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const CODE='Q'.repeat(43),PHONE='13800138000',PASSWORD='SyntheticSecret!2026';
const REVIEWER={account:{id:'reviewer',displayName:'合成审核员'},memberships:[],expiresAt:Date.now()+3600000};
const ADMIN={account:{id:'administrator',displayName:'合成首管理员'},memberships:[],expiresAt:Date.now()+3600000};
const OTHER={account:{id:'other',displayName:'合成其他账号'},memberships:[{teamId:'other-team',role:'intern'}],expiresAt:Date.now()+3600000};
const REQUEST={id:'request-a',teamId:'team-new',teamName:'合成团队',phoneMasked:'+8613****8000',status:'pending',revision:1,createdAt:Date.now(),expiresAt:null};
const TARGET={teamId:REQUEST.teamId,teamName:REQUEST.teamName,phoneMasked:REQUEST.phoneMasked,expiresAt:Date.now()+3600000};
const CHALLENGE={challengeId:'challenge-first-admin',expiresAt:Date.now()+300000};
const count=(f,name)=>f.calls.filter(item=>item.name===name).length;
async function until(check){for(let i=0;i<120;i++){if(check())return;await new Promise(r=>setTimeout(r,0));}assert.ok(check(),'expected renderer state was not reached');}
function fixture(t,overrides={}, {manualDevicePoll=false}={}){
  const dom=new JSDOM(html,{url:'shenyi://app/index.html',runScripts:'outside-only'}),{window}=dom,d=window.document,calls=[],writes=[];
  let pollDevice;
  if(manualDevicePoll){
    const defaultInterval=window.setInterval.bind(window);
    window.setInterval=(action,ms,...args)=>{if(ms!==1000)return defaultInterval(action,ms,...args);pollDevice=action;return 0;};
  }
  Object.defineProperty(window,'localStorage',{value:{setItem:(...args)=>writes.push(args),getItem:()=>null,removeItem:()=>{}}});
  const defaults={getAuthMethods:async()=>safe({mode:'local-preview',desktopWechatReady:false,methods:{demoUsername:true,phonePassword:true,phoneVerification:false,wechat:false,recovery:false}}),getOnboardingStatus:async()=>safe({available:true,invitationOnly:true}),login:async()=>safe(REVIEWER),loginPhone:async()=>safe(ADMIN),logout:async()=>safe({signedOut:true}),listTasks:async()=>safe({tasks:[],hasMore:false}),getInvitationAccess:async()=>safe({canInvite:false}),listEmployeeInvitations:async()=>safe({invitations:[]}),createEmployeeInvitation:async input=>safe({invitationId:'invite-employee',teamId:input.teamId,phoneMasked:REQUEST.phoneMasked,role:input.role,status:'pending',expiresAt:Date.now()+3600000,invitationCode:CODE}),revokeEmployeeInvitation:async()=>safe({revoked:true}),getTeamProvisioningAccess:async()=>safe({canReview:true}),listTeamProvisioningRequests:async()=>safe({requests:[REQUEST]}),createTeamProvisioningRequest:async()=>safe({request:REQUEST}),reviewTeamProvisioningRequest:async input=>safe({request:{...REQUEST,status:input.decision==='approve'?'approved':input.decision==='reject'?'rejected':'revoked',revision:2,expiresAt:Date.now()+3600000},...(input.decision==='approve'?{invitationCode:CODE}:{})}),getTeamAdministration:async()=>safe({teams:[]}),previewFirstAdministrator:async()=>safe(TARGET),requestFirstAdministratorActivation:async()=>safe(CHALLENGE),activateFirstAdministrator:async()=>safe({activated:true}),previewEmployeeInvitation:async()=>safe({}),requestEmployeeActivation:async()=>safe({}),activateEmployee:async()=>safe({activated:true})};
  window.shenyiTeam=Object.fromEntries(Object.entries({...defaults,...overrides}).map(([name,fn])=>[name,typeof fn==='function'?async arg=>{calls.push({name,arg});return fn(arg);}:fn]));
  window.shenyiTeam=withDeviceDiagnostic(window.shenyiTeam);window.eval(script);t.after(()=>window.close());
  return {window,d,calls,writes,pollDevice:()=>pollDevice(),id:id=>d.getElementById(id),click:id=>d.getElementById(id).click(),submit:id=>d.getElementById(id).dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})),input:id=>d.getElementById(id).dispatchEvent(new window.Event('input',{bubbles:true})),change:id=>d.getElementById(id).dispatchEvent(new window.Event('change',{bubbles:true}))};
}
async function login(f){await until(()=>!f.id('login-submit').disabled);f.id('username').value='synthetic-user';f.id('password').value=PASSWORD;f.submit('login-form');await until(()=>!f.id('workspace-view').hidden&&!f.id('logout').disabled);}
async function openReview(f){await until(()=>!f.id('team-provisioning-panel').hidden);f.id('team-provisioning-panel').querySelector('summary').click();await until(()=>!f.id('team-provisioning-password').disabled&&f.id('team-provisioning-list').children.length>0);}
function reviewerProof(f){f.id('team-provisioning-password').value=PASSWORD;f.input('team-provisioning-password');}
async function openFirst(f){await until(()=>count(f,'getOnboardingStatus')>0);f.id('first-admin-panel').querySelector('summary').click();await until(()=>!f.id('first-admin-preview').disabled);}
function identity(f){f.id('first-admin-invitation').value=CODE;f.id('first-admin-phone').value=PHONE;f.input('first-admin-phone');}
async function preview(f){identity(f);f.click('first-admin-preview');await until(()=>!f.id('first-admin-target').hidden);}
async function proof(f){await openFirst(f);await preview(f);f.click('first-admin-send-code');await until(()=>!f.id('first-admin-code').disabled);for(const [id,value]of [['first-admin-code','123456'],['first-admin-display-name','合成首管理员'],['first-admin-password',PASSWORD],['first-admin-confirm',PASSWORD]])f.id(id).value=value;}
function consent(f){f.id('first-admin-accept').checked=true;f.change('first-admin-accept');}
function assertFirstClean(f){for(const id of ['first-admin-invitation','first-admin-phone','first-admin-code','first-admin-display-name','first-admin-password','first-admin-confirm'])assert.equal(f.id(id).value,'',id);assert.equal(f.id('first-admin-accept').checked,false);}

test('an audit partner is not inferred to be a platform reviewer or technical administrator',async t=>{
  const f=fixture(t,{login:async()=>safe({...OTHER,memberships:[{teamId:'other-team',role:'partner'}]}),getTeamProvisioningAccess:async()=>safe({canReview:false})});await login(f);await until(()=>count(f,'getTeamProvisioningAccess')===1);assert.equal(f.id('team-provisioning-panel').hidden,true);assert.equal(count(f,'listTeamProvisioningRequests'),0);assert.equal(f.id('employee-invitations-panel').hidden,true);
});
test('a reviewer without audit membership sees review controls and never queries collection data',async t=>{
  const f=fixture(t);await login(f);await openReview(f);assert.equal(count(f,'listTasks'),0);assert.equal(f.id('team-select').options.length,0);assert.match(f.id('role-label').textContent,/未指派/);assert.match(f.id('team-provisioning-list').textContent,/合成团队.*138000|合成团队/);assert.equal(f.id('team-provisioning-list').textContent.includes(PHONE),false);assert.equal(f.id('employee-invitations-panel').hidden,true);f.click('refresh');f.submit('search-form');assert.equal(count(f,'listTasks'),0);
});
test('missing review methods leave the privileged panel closed without inventing authority',async t=>{
  const f=fixture(t,{reviewTeamProvisioningRequest:undefined});await login(f);assert.equal(f.id('team-provisioning-panel').hidden,true);assert.equal(count(f,'getTeamProvisioningAccess'),0);assert.equal(count(f,'listTeamProvisioningRequests'),0);
});
test('manual intake records a pending request and does not approve it or send a message',async t=>{
  const f=fixture(t);await login(f);await openReview(f);f.id('team-provisioning-name').value='  合成团队  ';f.id('team-provisioning-phone').value=PHONE;f.submit('team-provisioning-form');await until(()=>f.id('team-provisioning-message').textContent.includes('待审申请已录入'));assert.deepEqual({...f.calls.find(x=>x.name==='createTeamProvisioningRequest').arg},{teamName:'  合成团队  ',adminPhone:PHONE});assert.equal(count(f,'reviewTeamProvisioningRequest'),0);assert.equal(count(f,'requestFirstAdministratorActivation'),0);assert.equal(f.id('team-provisioning-name').value,'');assert.equal(f.id('team-provisioning-phone').value,'');assert.equal(f.id('issued-first-admin').hidden,true);
});
test('review requires deliberate password proof and exact request revision',async t=>{
  const f=fixture(t);await login(f);await openReview(f);const button=f.id('team-provisioning-list').querySelector('[data-decision=approve]');assert.equal(button.disabled,true);button.click();assert.equal(count(f,'reviewTeamProvisioningRequest'),0);reviewerProof(f);button.click();await until(()=>!f.id('issued-first-admin').hidden);assert.deepEqual({...f.calls.find(x=>x.name==='reviewTeamProvisioningRequest').arg},{requestId:REQUEST.id,decision:'approve',revision:REQUEST.revision,currentPassword:PASSWORD});assert.equal(f.id('issued-first-admin-code').value,CODE);assert.equal(f.id('issued-first-admin-code').readOnly,true);assert.equal(f.id('team-provisioning-password').value,'');assert.match(f.id('team-provisioning-message').textContent,/尚未开通/);assert.equal(f.id('team-provisioning-list').textContent.includes(CODE),false);assert.deepEqual(f.writes,[]);
});
test('wrong review password clears proof but keeps the reviewer signed in for a considered retry',async t=>{
  const f=fixture(t,{reviewTeamProvisioningRequest:async()=>fail('HTTP_403','当前密码验证未通过。')});await login(f);await openReview(f);reviewerProof(f);f.id('team-provisioning-list').querySelector('[data-decision=approve]').click();await until(()=>f.id('team-provisioning-message').textContent.includes('验证未通过'));assert.equal(f.id('team-provisioning-password').value,'');assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('issued-first-admin').hidden,true);assert.equal(f.id('team-provisioning-password').disabled,false);
});
test('closing review immediately clears the one-time activation code and password',async t=>{
  const f=fixture(t);await login(f);await openReview(f);reviewerProof(f);f.id('team-provisioning-list').querySelector('[data-decision=approve]').click();await until(()=>!f.id('issued-first-admin').hidden);f.id('team-provisioning-password').value=PASSWORD;f.id('team-provisioning-panel').querySelector('summary').click();assert.equal(f.id('issued-first-admin-code').value,'');assert.equal(f.id('team-provisioning-password').value,'');assert.equal(f.id('team-provisioning-list').children.length,0);await openReview(f);assert.equal(f.id('issued-first-admin').hidden,true);assert.equal(f.id('issued-first-admin-code').value,'');
});
test('a submitted review remains single-flight across close and reopen and never restores a discarded code',async t=>{
  const wait=deferred();let row=REQUEST;
  const f=fixture(t,{reviewTeamProvisioningRequest:()=>wait.promise,listTeamProvisioningRequests:async()=>safe({requests:[row]})});await login(f);await openReview(f);reviewerProof(f);f.id('team-provisioning-list').querySelector('[data-decision=approve]').click();await until(()=>count(f,'reviewTeamProvisioningRequest')===1);f.id('team-provisioning-panel').querySelector('summary').click();assert.match(f.id('workspace-message').textContent,/仍可能完成/);f.id('team-provisioning-panel').querySelector('summary').click();await until(()=>f.id('team-provisioning-message').textContent.includes('仍在处理中'));assert.equal(f.id('team-provisioning-password').disabled,true);f.submit('team-provisioning-form');assert.equal(count(f,'createTeamProvisioningRequest'),0);row={...REQUEST,status:'approved',revision:2,expiresAt:TARGET.expiresAt};wait.resolve(safe({request:row,invitationCode:CODE}));await until(()=>!f.id('team-provisioning-password').disabled);assert.equal(f.id('issued-first-admin-code').value,'');assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
});
test('a previous reviewer late 401 cannot sign out a newly logged-in account',async t=>{
  let logins=0;const wait=deferred(),f=fixture(t,{login:async()=>safe(++logins===1?REVIEWER:OTHER),reviewTeamProvisioningRequest:()=>wait.promise});await login(f);await openReview(f);reviewerProof(f);f.id('team-provisioning-list').querySelector('[data-decision=approve]').click();f.click('logout');await until(()=>f.id('workspace-view').hidden);await login(f);wait.resolve(fail('SIGN_IN_REQUIRED','old-session-expired'));await new Promise(r=>setTimeout(r,0));assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('account-name').textContent,OTHER.account.displayName);assert.equal(f.d.body.textContent.includes('old-session-expired'),false);assert.equal(f.id('issued-first-admin-code').value,'');
});
test('uncertain review results are not described as canceled or as a definite failed approval',async t=>{
  const f=fixture(t,{reviewTeamProvisioningRequest:async()=>fail('SERVICE_UNAVAILABLE','SYNTHETIC_PRIVATE_DETAIL')});await login(f);await openReview(f);reviewerProof(f);f.id('team-provisioning-list').querySelector('[data-decision=approve]').click();await until(()=>f.id('team-provisioning-message').textContent.includes('未能确认'));assert.match(f.id('team-provisioning-message').textContent,/可能已完成/);assert.equal(f.d.body.textContent.includes('SYNTHETIC_PRIVATE_DETAIL'),false);assert.equal(f.id('issued-first-admin-code').value,'');assert.equal(f.id('team-provisioning-password').value,'');
});

test('lost approval blocks mutation until a fresh read of the exact request, including lookalike rows',async t=>{
  const lookalike={...REQUEST,id:'other-request-with-same-display',teamId:'other-team'};
  const approved={...REQUEST,status:'approved',revision:2,expiresAt:TARGET.expiresAt};
  let outcomeLost=false,readMode='unavailable';
  const f=fixture(t,{
    listTeamProvisioningRequests:async input=>{
      if(!outcomeLost)return safe({requests:[REQUEST,lookalike]});
      if(readMode==='unavailable')return fail('HTTP_503','private-upstream-list-detail');
      if(input?.after===lookalike.id)return safe({requests:[approved,{...lookalike,id:'neighbor-lookalike',teamId:'neighbor-team'}],nextCursor:null});
      return safe({requests:[lookalike],nextCursor:lookalike.id});
    },
    reviewTeamProvisioningRequest:async()=>{outcomeLost=true;return fail('SERVICE_UNAVAILABLE','private-approval-detail');},
  });
  await login(f);await openReview(f);reviewerProof(f);
  const review=f.d.querySelector('[data-request-id="'+REQUEST.id+'"] [data-decision="approve"]');
  const refresh=f.id('team-provisioning-refresh'),password=f.id('team-provisioning-password'),message=f.id('team-provisioning-message');
  const reads=count(f,'listTeamProvisioningRequests');
  review.focus();review.click();
  await until(()=>message.textContent.includes('未能确认批准'));
  assert.match(message.textContent,/可能已完成.*刷新审核记录.*request-a/);
  assert.equal(count(f,'listTeamProvisioningRequests'),reads,'an uncertain response does not retry the mutation or refresh implicitly');
  assert.equal(password.disabled,true);
  assert.equal(password.value,'');
  assert.equal(f.d.activeElement,refresh);
  assert.equal(f.id('team-provisioning-create').disabled,true);
  reviewerProof(f);
  review.dispatchEvent(new f.window.MouseEvent('click',{bubbles:true}));
  f.id('team-provisioning-name').value=REQUEST.teamName;
  f.id('team-provisioning-phone').value=PHONE;
  f.submit('team-provisioning-form');
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
  assert.equal(count(f,'createTeamProvisioningRequest'),0);

  refresh.click();
  await until(()=>message.textContent.includes('暂时无法刷新'));
  assert.equal(f.id('team-provisioning-panel').hidden,false);
  assert.equal(refresh.disabled,false);
  assert.equal(password.disabled,true);
  readMode='paginated';
  refresh.click();
  await until(()=>!f.id('team-provisioning-next').disabled);
  assert.match(message.textContent,/本页尚未核对到申请 request-a/);
  assert.equal(f.id('team-provisioning-create').disabled,true);
  assert.equal(password.disabled,true);
  f.click('team-provisioning-next');
  await until(()=>!password.disabled&&message.textContent.includes('已刷新申请 request-a'));
  const text=f.id('team-provisioning-list').textContent;
  assert.match(text,/尚未激活.*没有可用的原邀请码.*审核账号当前密码.*撤销激活凭据.*确认撤销后.*新申请/);
  const matched=f.d.querySelector('[data-request-id="'+REQUEST.id+'"]');
  assert.match(matched.textContent,/刚核对的申请 · 编号 request-a/);
  assert.doesNotMatch(f.d.querySelector('[data-request-id="neighbor-lookalike"]').textContent,/刚核对的申请/);
  assert.equal(matched.querySelector('[data-decision="approve"]'),null);
  assert.equal(matched.querySelector('[data-decision="revoke"]').disabled,true);
  assert.equal(f.id('issued-first-admin-code').value,'');
  assert.equal(f.d.body.textContent.includes('private-'),false);
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
  assert.deepEqual(f.writes,[]);
});

test('a conflicting approval can be deliberately reviewed again only after the same request still reads pending',async t=>{
  let attempts=0;
  const f=fixture(t,{reviewTeamProvisioningRequest:async()=>{
    if(++attempts===1)return fail('HTTP_409','private-conflict');
    return safe({request:{...REQUEST,status:'approved',revision:2,expiresAt:TARGET.expiresAt},invitationCode:CODE});
  }});
  await login(f);await openReview(f);reviewerProof(f);
  f.d.querySelector('[data-decision="approve"]').click();
  const password=f.id('team-provisioning-password'),message=f.id('team-provisioning-message');
  await until(()=>message.textContent.includes('申请状态已改变'));
  assert.equal(password.disabled,true);
  f.click('team-provisioning-refresh');
  await until(()=>!password.disabled&&message.textContent.includes('当前仍待审核'));
  assert.equal(password.value,'');
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
  reviewerProof(f);f.d.querySelector('[data-decision="approve"]').click();
  await until(()=>f.id('issued-first-admin-code').value===CODE);
  assert.equal(count(f,'reviewTeamProvisioningRequest'),2);
});

test('lost revocation refreshes the original older page and directs an activated team to its existing account',async t=>{
  const anchor={...REQUEST,id:'more-recent-request',teamId:'more-recent-team'};
  let item={...REQUEST,status:'approved',revision:2,expiresAt:TARGET.expiresAt};
  const f=fixture(t,{
    listTeamProvisioningRequests:async input=>input?.after===anchor.id?safe({requests:[item],nextCursor:null}):safe({requests:[anchor],nextCursor:anchor.id}),
    reviewTeamProvisioningRequest:async()=>{item={...item,status:'activated',revision:3};return fail('INVALID_RESPONSE','lost-revocation-detail');},
  });
  await login(f);await openReview(f);f.click('team-provisioning-next');
  await until(()=>f.id('team-provisioning-page-status').textContent.startsWith('第 2 页'));
  reviewerProof(f);f.d.querySelector('[data-decision="revoke"]').click();
  const password=f.id('team-provisioning-password'),message=f.id('team-provisioning-message');
  await until(()=>message.textContent.includes('未能确认撤销'));
  assert.equal(password.disabled,true);
  assert.equal(f.id('team-provisioning-prev').disabled,false);
  f.click('team-provisioning-refresh');
  await until(()=>!password.disabled&&message.textContent.includes('团队已开通'));
  assert.deepEqual({...f.calls.findLast(call=>call.name==='listTeamProvisioningRequests').arg},{after:anchor.id});
  assert.match(message.textContent,/现有手机号和密码登录本团队/);
  assert.match(f.id('team-provisioning-list').textContent,/继续使用本团队/);
  assert.equal(f.d.querySelector('[data-decision="revoke"]'),null);
  assert.equal(count(f,'createTeamProvisioningRequest'),0);
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
});

test('confirmed approval retains the one-time code through a list failure and rejects a below-receipt revision',async t=>{
  const approved={...REQUEST,status:'approved',revision:2,expiresAt:TARGET.expiresAt};
  let committed=false,refreshFailed=false,readItem=REQUEST;
  const f=fixture(t,{
    listTeamProvisioningRequests:async()=>{
      if(committed&&!refreshFailed){refreshFailed=true;return fail('HTTP_429','temporary-fetch-limit');}
      return safe({requests:[readItem]});
    },
    reviewTeamProvisioningRequest:async()=>{committed=true;return safe({request:approved,invitationCode:CODE});},
  });
  await login(f);await openReview(f);reviewerProof(f);f.d.querySelector('[data-decision="approve"]').click();
  const message=f.id('team-provisioning-message'),password=f.id('team-provisioning-password');
  await until(()=>message.textContent.includes('请先转交'));
  assert.equal(f.id('issued-first-admin-code').value,CODE);
  assert.equal(f.id('issued-first-admin').hidden,false);
  assert.equal(password.value,'');
  assert.equal(password.disabled,true);
  assert.match(message.textContent,/刷新时邀请码将清除/);
  f.click('team-provisioning-refresh');
  await until(()=>message.textContent.includes('本页尚未核对到'));
  assert.equal(f.id('issued-first-admin-code').value,'');
  assert.equal(password.disabled,true);
  readItem=approved;f.click('team-provisioning-refresh');
  await until(()=>!password.disabled&&message.textContent.includes('当前已批准'));
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
  assert.equal(f.id('issued-first-admin-code').value,'');
});

test('confirmed approval discards the invitation immediately if follow-up list access has been lost',async t=>{
  let committed=false;
  const f=fixture(t,{
    listTeamProvisioningRequests:async()=>committed?fail('HTTP_404','private-access-detail'):safe({requests:[REQUEST]}),
    reviewTeamProvisioningRequest:async()=>{committed=true;return safe({request:{...REQUEST,status:'approved',revision:2,expiresAt:TARGET.expiresAt},invitationCode:CODE});},
  });
  await login(f);await openReview(f);reviewerProof(f);f.d.querySelector('[data-decision="approve"]').click();
  await until(()=>f.id('workspace-message').textContent.includes('审核权限无法确认'));
  assert.equal(f.id('team-provisioning-panel').hidden,true);
  assert.equal(f.id('team-provisioning-list').children.length,0);
  assert.equal(f.id('issued-first-admin-code').value,'');
  assert.equal(f.id('team-provisioning-password').value,'');
});

test('device suspension before a response keeps only the exact recovery across reconnect and transient probe failures',async t=>{
  const response=deferred(),fp='a'.repeat(64);
  const device={id:'reviewer-device',displayName:'合成办公电脑',platform:'win32',keyFingerprint:fp,status:'active',revision:1};
  const state=(value,epoch)=>({required:true,state:value,epoch,device:value==='signed_out'?null:device,
    localFingerprint:value==='signed_out'?null:fp,expiresAt:value==='signed_out'?null:TARGET.expiresAt});
  const anchor={...REQUEST,id:'earlier-page-boundary',teamId:'other-team'};
  const approved={...REQUEST,status:'approved',revision:2,expiresAt:TARGET.expiresAt};
  let snapshot=state('signed_out',0),reconnected=false,accessFails=true,listFails=true;
  const f=fixture(t,{
    login:async()=>safe({...REVIEWER,device:snapshot=state('ready',1)}),
    getDeviceStatus:async()=>safe(snapshot),
    reconnectDevice:async()=>{reconnected=true;return safe({...REVIEWER,device:snapshot=state('ready',3)});},
    getTeamProvisioningAccess:async()=>reconnected&&accessFails?fail('SERVICE_UNAVAILABLE','private-access-read'):safe({canReview:true}),
    listTeamProvisioningRequests:async input=>{
      if(reconnected&&listFails)return fail('HTTP_503','private-list-read');
      return input?.after===anchor.id?safe({requests:[reconnected?approved:REQUEST],nextCursor:null}):safe({requests:[anchor],nextCursor:anchor.id});
    },
    reviewTeamProvisioningRequest:()=>response.promise,
  },{manualDevicePoll:true});
  await login(f);await openReview(f);f.click('team-provisioning-next');
  await until(()=>f.id('team-provisioning-page-status').textContent.startsWith('第 2 页'));
  reviewerProof(f);f.d.querySelector('[data-decision="approve"]').click();
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
  snapshot=state('paused',2);f.pollDevice();
  await until(()=>f.id('workspace-view').hidden&&!f.id('device-retry').hidden);
  assert.equal(f.id('team-provisioning-password').value,'');
  response.resolve(safe({request:approved,invitationCode:CODE}));
  f.click('device-retry');
  await until(()=>!f.id('workspace-view').hidden&&f.id('workspace-message').textContent.includes('暂时无法核对审核权限'));
  assert.equal(f.id('team-provisioning-panel').hidden,true);
  assert.equal(f.id('issued-first-admin-code').value,'');
  accessFails=false;f.click('refresh');
  await until(()=>!f.id('team-provisioning-panel').hidden);
  f.id('team-provisioning-panel').querySelector('summary').click();
  await until(()=>f.id('team-provisioning-message').textContent.includes('暂时无法刷新申请 request-a'));
  assert.equal(f.id('team-provisioning-create').disabled,true);
  assert.equal(f.id('team-provisioning-refresh').disabled,false);
  assert.equal(f.id('team-provisioning-password').disabled,true);
  assert.equal(f.id('issued-first-admin-code').value,'');
  listFails=false;f.click('team-provisioning-refresh');
  await until(()=>!f.id('team-provisioning-password').disabled&&f.id('team-provisioning-message').textContent.includes('已刷新申请 request-a'));
  assert.deepEqual({...f.calls.findLast(call=>call.name==='listTeamProvisioningRequests').arg},{after:anchor.id});
  assert.equal(f.id('issued-first-admin-code').value,'');
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
  assert.equal(count(f,'createTeamProvisioningRequest'),0);
  assert.deepEqual(f.writes,[]);
});

test('native queued reviewer opening preserves immediately entered password proof',async t=>{
  const f=fixture(t);await login(f);await until(()=>!f.id('team-provisioning-panel').hidden);f.id('team-provisioning-panel').querySelector('summary').click();reviewerProof(f);await until(()=>!f.id('team-provisioning-password').disabled);assert.equal(f.id('team-provisioning-password').value,PASSWORD);
});
test('technical administrator management teams stay separate from audit memberships',async t=>{
  const f=fixture(t,{login:async()=>safe(ADMIN),getTeamProvisioningAccess:async()=>safe({canReview:false}),getTeamAdministration:async()=>safe({teams:[{teamId:'managed-team',teamName:'合成管理团队'}]}),getInvitationAccess:async arg=>safe({canInvite:arg.teamId==='managed-team'})});await login(f);await until(()=>!f.id('employee-invitations-panel').hidden);assert.equal(f.id('team-select').options.length,0);assert.equal(f.id('invitation-team').value,'managed-team');assert.equal(f.id('role-label').textContent,'未指派角色');assert.equal(count(f,'listTasks'),0);assert.match(f.id('workspace-message').textContent,/可管理员工邀请/);f.id('employee-invitations-panel').open=true;f.id('invitation-phone').value=PHONE;f.submit('employee-invitation-form');await until(()=>!f.id('issued-invitation').hidden);assert.equal(f.calls.find(x=>x.name==='createEmployeeInvitation').arg.teamId,'managed-team');assert.equal(count(f,'listTasks'),0);
});
test('separate administration selector clears a late invite from a previous management team',async t=>{
  const wait=deferred(),f=fixture(t,{login:async()=>safe(ADMIN),getTeamProvisioningAccess:async()=>safe({canReview:false}),getTeamAdministration:async()=>safe({teams:[{teamId:'managed-a',teamName:'合成A'},{teamId:'managed-b',teamName:'合成B'}]}),getInvitationAccess:async()=>safe({canInvite:true}),createEmployeeInvitation:()=>wait.promise});await login(f);await until(()=>!f.id('employee-invitations-panel').hidden);f.id('employee-invitations-panel').open=true;f.id('invitation-phone').value=PHONE;f.submit('employee-invitation-form');await until(()=>count(f,'createEmployeeInvitation')===1);f.id('invitation-team').value='managed-b';f.change('invitation-team');await until(()=>f.calls.some(x=>x.name==='getInvitationAccess'&&x.arg.teamId==='managed-b')&&!f.id('employee-invitations-panel').hidden);wait.resolve(safe({teamId:'managed-a',phoneMasked:REQUEST.phoneMasked,role:'intern',expiresAt:TARGET.expiresAt,invitationCode:CODE}));await new Promise(r=>setTimeout(r,0));assert.equal(f.id('issued-invitation-code').value,'');assert.equal(f.id('invitation-team').value,'managed-b');assert.equal(f.id('team-select').options.length,0);
});
test('a stale administration response cannot grant the next account a previous management team',async t=>{
  let logins=0;const wait=deferred(),f=fixture(t,{login:async()=>safe(++logins===1?ADMIN:OTHER),getTeamAdministration:()=>logins===1?wait.promise:Promise.resolve(safe({teams:[]})),getTeamProvisioningAccess:async()=>safe({canReview:false})});await login(f);f.click('logout');await until(()=>f.id('workspace-view').hidden);await login(f);wait.resolve(safe({teams:[{teamId:'secret-old-team',teamName:'old-private-team'}]}));await new Promise(r=>setTimeout(r,0));assert.equal(f.d.body.textContent.includes('old-private-team'),false);assert.equal(f.id('invitation-team').value,'other-team');assert.equal(f.id('employee-invitations-panel').hidden,true);
});
test('missing SMS capability disables first administrator activation even after valid preview',async t=>{
  const f=fixture(t,{getOnboardingStatus:async()=>safe({available:false,invitationOnly:true})});await openFirst(f);await preview(f);assert.match(f.id('first-admin-service-status').textContent,/尚未开通/);assert.equal(f.id('first-admin-send-code').disabled,true);assert.equal(f.id('first-admin-submit').disabled,true);f.click('first-admin-send-code');f.submit('first-admin-form');assert.equal(count(f,'requestFirstAdministratorActivation'),0);assert.equal(count(f,'activateFirstAdministrator'),0);
});
test('native queued first administrator opening preserves a just-pasted invitation',async t=>{
  const f=fixture(t);await until(()=>count(f,'getOnboardingStatus')>0);f.id('first-admin-panel').querySelector('summary').click();identity(f);await until(()=>!f.id('first-admin-preview').disabled);assert.equal(f.id('first-admin-invitation').value,CODE);assert.equal(f.id('first-admin-phone').value,PHONE);f.click('first-admin-preview');await until(()=>!f.id('first-admin-target').hidden);assert.match(f.id('first-admin-target-description').textContent,/合成团队.*首管理员/);
});
test('first administrator confirmation rejects mismatched passwords before a write',async t=>{
  const f=fixture(t);await proof(f);consent(f);f.id('first-admin-confirm').value=PASSWORD+' ';f.submit('first-admin-form');assert.equal(count(f,'activateFirstAdministrator'),0);assert.match(f.id('first-admin-message').textContent,/不一致/);assert.equal(f.id('first-admin-password').value,'');assert.equal(f.id('first-admin-confirm').value,'');
});
test('first administrator activation requires explicit responsibility consent and never logs in automatically',async t=>{
  const f=fixture(t);await proof(f);f.submit('first-admin-form');assert.equal(count(f,'activateFirstAdministrator'),0);consent(f);f.submit('first-admin-form');await until(()=>f.id('first-admin-message').textContent.includes('团队管理已开通'));assert.deepEqual({...f.calls.find(x=>x.name==='activateFirstAdministrator').arg},{invitationCode:CODE,phone:PHONE,challengeId:CHALLENGE.challengeId,code:'123456',password:PASSWORD,displayName:'合成首管理员',accept:true});assert.equal(count(f,'loginPhone'),0);assert.equal(f.id('workspace-view').hidden,true);assert.match(f.id('first-admin-message').textContent,/审计资料权限须另行指派/);assertFirstClean(f);assert.deepEqual(f.writes,[]);
});
test('changing the designated phone clears first administrator target and all proof',async t=>{
  const f=fixture(t);await proof(f);consent(f);f.id('first-admin-phone').value='13900139000';f.input('first-admin-phone');assert.equal(f.id('first-admin-target').hidden,true);assert.equal(f.id('first-admin-proof').hidden,true);assert.equal(f.id('first-admin-password').value,'');assert.equal(f.id('first-admin-confirm').value,'');assert.equal(f.id('first-admin-code').value,'');assert.equal(f.id('first-admin-accept').checked,false);f.submit('first-admin-form');assert.equal(count(f,'activateFirstAdministrator'),0);
});
test('canceling a pending first administrator preview discards its late response',async t=>{
  const wait=deferred(),f=fixture(t,{previewFirstAdministrator:()=>wait.promise});await openFirst(f);identity(f);f.click('first-admin-preview');f.click('first-admin-cancel');wait.resolve(safe(TARGET));await new Promise(r=>setTimeout(r,0));assertFirstClean(f);assert.equal(f.id('first-admin-target').hidden,true);assert.equal(f.id('first-admin-panel').open,false);assert.equal(f.id('login-view').classList.contains('first-admin-active'),false);
});
test('close and reopen do not permit duplicate first administrator activation or restore its discarded result',async t=>{
  const wait=deferred(),f=fixture(t,{activateFirstAdministrator:()=>wait.promise});await proof(f);consent(f);f.submit('first-admin-form');await until(()=>count(f,'activateFirstAdministrator')===1);f.click('first-admin-cancel');assert.match(f.id('login-message').textContent,/仍可能完成/);f.id('first-admin-panel').querySelector('summary').click();await until(()=>f.id('first-admin-message').textContent.includes('仍在处理中'));f.submit('first-admin-form');assert.equal(count(f,'activateFirstAdministrator'),1);assert.equal(f.id('first-admin-preview').disabled,true);wait.resolve(safe({activated:true}));await until(()=>!f.id('first-admin-preview').disabled);assertFirstClean(f);assert.equal(f.id('first-admin-message').textContent.includes('已开通'),false);assert.equal(count(f,'loginPhone'),0);
});
test('a late first administrator success or 401 cannot replace a new logged-in account',async t=>{
  const wait=deferred(),f=fixture(t,{activateFirstAdministrator:()=>wait.promise,login:async()=>safe(OTHER),getTeamProvisioningAccess:async()=>safe({canReview:false})});await proof(f);consent(f);f.submit('first-admin-form');f.click('first-admin-cancel');await login(f);wait.resolve(fail('SIGN_IN_REQUIRED','old-public-flow'));await new Promise(r=>setTimeout(r,0));assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('account-name').textContent,OTHER.account.displayName);assert.equal(f.d.body.textContent.includes('old-public-flow'),false);assertFirstClean(f);
});
test('unload clears first administrator and reviewer secrets, including every password field',async t=>{
  const f=fixture(t);await proof(f);consent(f);f.window.dispatchEvent(new f.window.Event('beforeunload'));assertFirstClean(f);assert.equal(f.id('first-admin-panel').open,false);await login(f);await openReview(f);reviewerProof(f);f.window.dispatchEvent(new f.window.Event('beforeunload'));assert.equal(f.id('team-provisioning-password').value,'');assert.equal(f.id('issued-first-admin-code').value,'');assert.equal(f.id('team-provisioning-panel').open,false);assert.equal(ledgerLegacyFormCount(f.d),22);assert.equal(ledgerLegacySecretCount(f.d),27);
});


const PILOT_END='2035-06-07T08:09',PILOT_END_AT=Date.UTC(2035,5,7,0,9);
const pilotRequest=(patch={})=>({...REQUEST,status:'activated',revision:3,pilot:null,...patch});
function fillPilot(f,{ends=PILOT_END,seats='4'}={}){for(const [prefix,value]of [['team-pilot-ends-',ends],['team-pilot-seats-',seats]]){const id=prefix+REQUEST.id;f.id(id).value=value;f.input(id);}}
const pilotButton=f=>f.id('team-provisioning-list').querySelector('[data-decision="approve-pilot"]');

test('pilot controls appear only for the explicitly eligible activated row and approved values remain read-only',async t=>{
  const pilot={startsAt:Date.UTC(2035,5,1,0),endsAt:PILOT_END_AT,seats:4};const rows=[{...REQUEST,id:'legacy',status:'activated'},{...REQUEST,id:'not-activated',pilot:null},pilotRequest(),pilotRequest({id:'already-approved',pilot})];const f=fixture(t,{listTeamProvisioningRequests:async()=>safe({requests:rows})});await login(f);await openReview(f);assert.equal(f.id('team-provisioning-list').querySelectorAll('[data-decision="approve-pilot"]').length,1);assert.match(f.d.querySelector('label[for="team-pilot-ends-'+REQUEST.id+'"]').textContent,/北京时间 UTC\+8/);assert.match(f.d.querySelector('label[for="team-pilot-seats-'+REQUEST.id+'"]').textContent,/员工席位/);assert.match(f.id('team-provisioning-list').textContent,/试点已批准.*4 个员工席位/);assert.match(f.id('team-provisioning-list').textContent,/2035.*6.*7.*08:09.*北京时间/);assert.equal(ledgerLegacyFormCount(f.d),22);assert.equal(ledgerLegacySecretCount(f.d),27);
});
test('pilot approval requires valid per-row input and converts Beijing time explicitly before a single review write',async t=>{
  let row=pilotRequest();const f=fixture(t,{listTeamProvisioningRequests:async()=>safe({requests:[row]}),reviewTeamProvisioningRequest:async input=>{row=pilotRequest({revision:4,pilot:{startsAt:Date.now(),endsAt:input.endsAt,seats:input.seats}});return safe({request:row});}});await login(f);await openReview(f);reviewerProof(f);assert.equal(pilotButton(f).disabled,true);fillPilot(f);assert.equal(pilotButton(f).disabled,false);pilotButton(f).click();await until(()=>f.id('team-provisioning-message').textContent.includes('试点已批准'));assert.deepEqual({...f.calls.find(x=>x.name==='reviewTeamProvisioningRequest').arg},{requestId:REQUEST.id,decision:'approve-pilot',revision:3,currentPassword:PASSWORD,endsAt:PILOT_END_AT,seats:4});assert.equal(pilotButton(f),null);assert.match(f.id('team-provisioning-list').textContent,/试点已批准.*4 个员工席位/);assert.equal(f.id('team-provisioning-password').value,'');assert.equal(f.id('issued-first-admin').hidden,true);assert.deepEqual(f.writes,[]);
});
test('invalid pilot calendar times, nonfuture dates and unsafe seats never dispatch a review',async t=>{
  const f=fixture(t,{listTeamProvisioningRequests:async()=>safe({requests:[pilotRequest()]})});await login(f);await openReview(f);reviewerProof(f);
  for(const ends of ['', '2035-02-30T08:09','2035-13-07T08:09','2035-06-07T24:09','2035-06-07T08:60','2035-06-07T08:09Z','2000-01-01T08:09']){fillPilot(f,{ends});assert.equal(pilotButton(f).disabled,true,ends);pilotButton(f).click();}
  for(const seats of ['', '0','-1','1.5','1e2','9007199254740992']){fillPilot(f,{seats});assert.equal(pilotButton(f).disabled,true,seats);pilotButton(f).click();}assert.equal(count(f,'reviewTeamProvisioningRequest'),0);
});
test('native queued opening preserves pilot draft fields and password while a refresh completes',async t=>{
  const f=fixture(t,{listTeamProvisioningRequests:async()=>safe({requests:[pilotRequest()]})});await login(f);await until(()=>!!f.id('team-pilot-ends-'+REQUEST.id));f.id('team-provisioning-panel').querySelector('summary').click();reviewerProof(f);fillPilot(f);await until(()=>!f.id('team-provisioning-password').disabled);assert.equal(f.id('team-provisioning-password').value,PASSWORD);assert.equal(f.id('team-pilot-ends-'+REQUEST.id).value,PILOT_END);assert.equal(f.id('team-pilot-seats-'+REQUEST.id).value,'4');
});
test('wrong pilot password clears the secret, preserves the draft, and returns focus to the password field', async t => {
  const f=fixture(t,{
    listTeamProvisioningRequests:async()=>safe({requests:[pilotRequest()]}),
    reviewTeamProvisioningRequest:async()=>fail('HTTP_403','当前密码验证未通过。'),
  });
  await login(f);
  await openReview(f);
  reviewerProof(f);
  fillPilot(f);
  const button=pilotButton(f),password=f.id('team-provisioning-password');
  button.focus();
  button.click();
  await until(()=>f.id('team-provisioning-message').textContent.includes('验证未通过'));
  assert.equal(f.id('workspace-view').hidden,false);
  assert.equal(password.value,'');
  assert.equal(f.id('team-pilot-ends-'+REQUEST.id).value,PILOT_END);
  assert.equal(f.id('team-pilot-seats-'+REQUEST.id).value,'4');
  assert.ok(f.d.activeElement===password,'the password field should be focused after verification fails');
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
  reviewerProof(f);
  assert.equal(pilotButton(f).disabled,false);
});
test('failed pilot verification preserves focus when the user has moved away while waiting', async t => {
  const response=deferred();
  const f=fixture(t,{
    listTeamProvisioningRequests:async()=>safe({requests:[pilotRequest()]}),
    reviewTeamProvisioningRequest:()=>response.promise,
  });
  await login(f);
  await openReview(f);
  reviewerProof(f);
  fillPilot(f);
  const button=pilotButton(f),password=f.id('team-provisioning-password');
  button.focus();
  button.click();
  await until(()=>count(f,'reviewTeamProvisioningRequest')===1);
  const other=f.id('logout');
  other.focus();
  assert.ok(f.d.activeElement===other,'the user can leave the review while it is pending');
  other.blur();
  assert.equal(f.d.activeElement,f.d.body);
  response.resolve(fail('HTTP_403','当前密码验证未通过。'));
  await until(()=>!password.disabled && f.id('team-provisioning-message').textContent.includes('验证未通过'));
  assert.ok(f.d.activeElement===f.d.body,'the failure must not reclaim focus after the user leaves the review control');
  assert.equal(password.value,'');
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
});
test('uncertain pilot approval refreshes read-only facts without resubmitting or inventing failure',async t=>{
  let row=pilotRequest();const f=fixture(t,{listTeamProvisioningRequests:async()=>safe({requests:[row]}),reviewTeamProvisioningRequest:async input=>{row=pilotRequest({revision:4,pilot:{startsAt:Date.now(),endsAt:input.endsAt,seats:input.seats}});return fail('SERVICE_UNAVAILABLE','PRIVATE_UPSTREAM_DETAIL');}});await login(f);await openReview(f);reviewerProof(f);fillPilot(f);const before=count(f,'listTeamProvisioningRequests');pilotButton(f).click();await until(()=>f.id('team-provisioning-message').textContent.includes('试点已批准'));assert.equal(count(f,'reviewTeamProvisioningRequest'),1);assert.equal(count(f,'listTeamProvisioningRequests'),before+1);assert.equal(pilotButton(f),null);assert.match(f.id('team-provisioning-list').textContent,/试点已批准.*4 个员工席位/);assert.match(f.id('team-provisioning-message').textContent,/试点已批准/);assert.equal(f.d.body.textContent.includes('PRIVATE_UPSTREAM_DETAIL'),false);assert.equal(f.id('team-provisioning-password').value,'');
});
test('confirmed pilot result remains displayed when the following list refresh fails',async t=>{
  let committed=false;
  const f=fixture(t,{
    listTeamProvisioningRequests:async()=>committed?fail('SERVICE_UNAVAILABLE','refresh-failed'):safe({requests:[pilotRequest()]}),
    reviewTeamProvisioningRequest:async input=>{
      committed=true;
      return safe({request:pilotRequest({revision:4,pilot:{startsAt:Date.now(),endsAt:input.endsAt,seats:input.seats}})});
    },
  });
  await login(f);
  await openReview(f);
  reviewerProof(f);
  fillPilot(f);
  pilotButton(f).click();
  await until(()=>f.id('team-provisioning-message').textContent.includes('试点已批准'));
  assert.equal(pilotButton(f),null);
  assert.match(f.id('team-provisioning-list').textContent,/试点已批准/);
  assert.match(f.id('team-provisioning-message').textContent,/刷新无法确认/);
  assert.equal(f.id('team-provisioning-password').value,'');
});

test('an empty or stale read cannot hide confirmed pilot terms or unlock review',async t=>{
  const original=pilotRequest();
  let approved, rows=[original];
  const f=fixture(t,{
    listTeamProvisioningRequests:async()=>safe({requests:rows}),
    reviewTeamProvisioningRequest:async input=>{
      approved=pilotRequest({revision:4,pilot:{startsAt:Date.UTC(2035,5,1),endsAt:input.endsAt,seats:input.seats}});
      rows=[];
      return safe({request:approved});
    },
  });
  await login(f);
  await openReview(f);
  reviewerProof(f);
  fillPilot(f);
  const refresh=f.id('team-provisioning-refresh'), password=f.id('team-provisioning-password');
  const message=f.id('team-provisioning-message');
  const before=count(f,'listTeamProvisioningRequests');
  pilotButton(f).click();
  await until(()=>count(f,'listTeamProvisioningRequests')>before&&!refresh.disabled);
  assert.equal(password.disabled,true);
  assert.equal(password.value,'');
  assert.match(message.textContent,/截止.*2035.*6.*7.*08:09/);
  assert.match(message.textContent,/员工席位\s*4\s*个|4\s*个员工席位/);

  for(const conflicting of [original,{...approved,pilot:{...approved.pilot,seats:5}},
    {...approved,pilot:{...approved.pilot,endsAt:PILOT_END_AT+60000}}]){
    rows=[conflicting];
    const reads=count(f,'listTeamProvisioningRequests');
    refresh.click();
    await until(()=>count(f,'listTeamProvisioningRequests')>reads&&!refresh.disabled);
    assert.equal(password.disabled,true);
    assert.match(message.textContent,/截止.*2035.*6.*7.*08:09/);
    assert.match(message.textContent,/员工席位\s*4\s*个|4\s*个员工席位/);
    pilotButton(f)?.dispatchEvent(new f.window.MouseEvent('click',{bubbles:true}));
    assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
  }

  rows=[approved];
  refresh.click();
  await until(()=>!password.disabled&&f.id('team-provisioning-list').textContent.includes('试点已批准'));
  assert.equal(pilotButton(f),null);
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
});

for(const [label,automaticRead] of [['unavailable',fail('HTTP_503','private-read-failure')],['empty',safe({requests:[]})]])
test(`lost pilot approval with ${label} refresh requires a current read of the exact team`,async t=>{
  const original=pilotRequest();
  let approved, readResult=safe({requests:[original]});
  const f=fixture(t,{
    listTeamProvisioningRequests:async()=>readResult,
    reviewTeamProvisioningRequest:async input=>{
      approved=pilotRequest({revision:4,pilot:{startsAt:Date.UTC(2035,5,1),endsAt:input.endsAt,seats:input.seats}});
      readResult=automaticRead;
      return fail('SERVICE_UNAVAILABLE','private-approval-failure');
    },
  });
  await login(f);
  await openReview(f);
  reviewerProof(f);
  fillPilot(f);
  const refresh=f.id('team-provisioning-refresh'), password=f.id('team-provisioning-password');
  const before=count(f,'listTeamProvisioningRequests');
  pilotButton(f).click();
  await until(()=>count(f,'listTeamProvisioningRequests')>before&&!refresh.disabled);
  assert.equal(password.value,'');
  assert.equal(password.disabled,true);
  assert.equal(pilotButton(f)?.disabled??true,true);

  for(const requests of [[],[pilotRequest({revision:2})],[{...approved,teamId:'another-team'}],[{...approved,id:'another-request'}]]){
    readResult=safe({requests});
    const reads=count(f,'listTeamProvisioningRequests');
    refresh.click();
    await until(()=>count(f,'listTeamProvisioningRequests')>reads&&!refresh.disabled);
    assert.equal(password.disabled,true);
    assert.equal(f.id('team-provisioning-create').disabled,true);
    pilotButton(f)?.dispatchEvent(new f.window.MouseEvent('click',{bubbles:true}));
    assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
  }

  readResult=safe({requests:[approved]});
  refresh.click();
  await until(()=>!password.disabled&&f.id('team-provisioning-list').textContent.includes('试点已批准'));
  const text=f.id('team-provisioning-list').textContent;
  assert.match(text,/试点已批准.*4 个员工席位/);
  assert.match(text,/截止.*2035.*6.*7.*08:09.*北京时间/);
  assert.equal(pilotButton(f),null);
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
  assert.doesNotMatch(f.d.body.textContent,/private-(read|approval)-failure/);
});

test('a fresh read of an unapproved pilot permits only a deliberate new review',async t=>{
  const original=pilotRequest();
  let listRow=original, submissions=0;
  const f=fixture(t,{
    listTeamProvisioningRequests:async()=>safe({requests:[listRow]}),
    reviewTeamProvisioningRequest:async input=>{
      if(++submissions===1){
        listRow=pilotRequest({revision:2});
        return fail('SERVICE_UNAVAILABLE','private-approval-failure');
      }
      listRow=pilotRequest({revision:4,pilot:{startsAt:Date.UTC(2035,5,1),endsAt:input.endsAt,seats:input.seats}});
      return safe({request:listRow});
    },
  });
  await login(f);
  await openReview(f);
  reviewerProof(f);
  fillPilot(f);
  const refresh=f.id('team-provisioning-refresh'), password=f.id('team-provisioning-password');
  const before=count(f,'listTeamProvisioningRequests');
  pilotButton(f).click();
  await until(()=>count(f,'listTeamProvisioningRequests')>before&&!refresh.disabled);
  assert.equal(password.disabled,true);
  assert.equal(password.value,'');
  assert.equal(pilotButton(f)?.disabled,true);
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);

  listRow=original;
  refresh.click();
  await until(()=>!password.disabled);
  assert.equal(password.value,'');
  assert.equal(pilotButton(f)?.disabled,true);
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
  reviewerProof(f);
  fillPilot(f,{seats:'5'});
  pilotButton(f).click();
  await until(()=>f.id('team-provisioning-list').textContent.includes('5 个员工席位'));
  const reviews=f.calls.filter(call=>call.name==='reviewTeamProvisioningRequest');
  assert.equal(reviews.length,2);
  assert.deepEqual({...reviews[1].arg},{requestId:REQUEST.id,decision:'approve-pilot',revision:3,currentPassword:PASSWORD,endsAt:PILOT_END_AT,seats:5});
});

test('pilot approval remains single-flight across close and reopening and clears discarded fields',async t=>{
  const wait=deferred();let row=pilotRequest();const f=fixture(t,{listTeamProvisioningRequests:async()=>safe({requests:[row]}),reviewTeamProvisioningRequest:()=>wait.promise});await login(f);await openReview(f);reviewerProof(f);fillPilot(f);const button=pilotButton(f);button.click();button.click();assert.equal(count(f,'reviewTeamProvisioningRequest'),1);assert.equal(f.id('team-pilot-ends-'+REQUEST.id).disabled,true);f.id('team-provisioning-panel').querySelector('summary').click();assert.equal(f.id('team-provisioning-list').children.length,0);assert.equal(f.id('team-provisioning-password').value,'');f.id('team-provisioning-panel').querySelector('summary').click();await until(()=>f.id('team-provisioning-message').textContent.includes('仍在处理中'));assert.equal(count(f,'reviewTeamProvisioningRequest'),1);row=pilotRequest({revision:4,pilot:{startsAt:Date.now(),endsAt:PILOT_END_AT,seats:4}});wait.resolve(safe({request:row}));await until(()=>f.id('team-provisioning-list').textContent.includes('试点已批准'));assert.equal(pilotButton(f),null);assert.equal(f.id('team-provisioning-password').value,'');assert.equal(f.id('issued-first-admin-code').value,'');
});

test('older pilot can be approved on the next page and its fresh receipt stays on that page',async t=>{
  const first=Array.from({length:50},(_,i)=>({...REQUEST,id:'newer-'+i,teamName:'较新申请 '+i}));
  const boundary=first.at(-1).id;
  let older=pilotRequest({teamName:'较早已开通团队'});
  const f=fixture(t,{
    listTeamProvisioningRequests:async input=>input?.after===boundary?safe({requests:[older],nextCursor:null}):safe({requests:first,nextCursor:boundary}),
    reviewTeamProvisioningRequest:async input=>{
      older={...older,revision:4,pilot:{startsAt:Date.now(),endsAt:input.endsAt,seats:input.seats}};
      return safe({request:older});
    },
  });
  await login(f);await openReview(f);
  assert.equal(f.id('team-provisioning-list').children.length,50);
  assert.equal(f.id('team-provisioning-prev').disabled,true);
  assert.equal(pilotButton(f),null);
  reviewerProof(f);
  const staleApprove=f.id('team-provisioning-list').querySelector('[data-decision="approve"]');
  assert.equal(staleApprove.disabled,false);
  f.click('team-provisioning-next');
  assert.equal(f.id('team-provisioning-password').value,'');
  await until(()=>!f.id('team-provisioning-password').disabled&&f.id('team-provisioning-page-status').textContent==='第 2 页 · 本页 1 条');
  assert.deepEqual({...f.calls.findLast(call=>call.name==='listTeamProvisioningRequests').arg},{after:boundary});
  assert.equal(f.id('team-provisioning-next').disabled,true);
  assert.equal(f.id('team-provisioning-prev').disabled,false);
  reviewerProof(f);staleApprove.click();
  assert.equal(count(f,'reviewTeamProvisioningRequest'),0);
  fillPilot(f);pilotButton(f).click();
  await until(()=>f.id('team-provisioning-message').textContent.includes('试点已批准'));
  assert.equal(f.calls.find(call=>call.name==='reviewTeamProvisioningRequest').arg.requestId,REQUEST.id);
  assert.equal(f.calls.findLast(call=>call.name==='listTeamProvisioningRequests').arg.after,boundary);
  assert.match(f.id('team-provisioning-list').textContent,/较早已开通团队.*试点已批准/);
  f.click('team-provisioning-prev');
  await until(()=>!f.id('team-provisioning-next').disabled&&f.id('team-provisioning-page-status').textContent==='第 1 页 · 本页 50 条');
  assert.equal(f.calls.findLast(call=>call.name==='listTeamProvisioningRequests').arg,undefined);
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
  assert.deepEqual(f.writes,[]);
});

test('opening another page clears a confirmed first administrator credential before the next read',async t=>{
  const boundary=REQUEST.id, pending=deferred();
  const f=fixture(t,{
    listTeamProvisioningRequests:async input=>input?.after?pending.promise:safe({requests:[REQUEST],nextCursor:boundary}),
  });
  await login(f);await openReview(f);reviewerProof(f);
  f.id('team-provisioning-list').querySelector('[data-decision="approve"]').click();
  await until(()=>!f.id('team-provisioning-next').disabled&&!f.id('issued-first-admin').hidden);
  assert.equal(f.id('issued-first-admin-code').value,CODE);
  const summary=f.id('team-provisioning-panel').querySelector('summary');
  f.click('team-provisioning-next');
  assert.equal(f.id('issued-first-admin-code').value,'');
  assert.equal(f.id('team-provisioning-list').children.length,0);
  assert.equal(f.id('team-provisioning-create').disabled,true);
  summary.click();summary.click();
  await until(()=>!f.id('team-provisioning-next').disabled);
  pending.resolve(fail('SIGN_IN_REQUIRED','stale read'));await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(f.id('workspace-view').hidden,false);
  assert.equal(f.id('team-provisioning-page-status').textContent,'第 1 页 · 本页 1 条');
  assert.equal(f.id('issued-first-admin-code').value,'');
  assert.equal(count(f,'reviewTeamProvisioningRequest'),1);
});
