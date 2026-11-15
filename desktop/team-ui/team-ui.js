'use strict';
(() => {
  const api=window.shenyiTeam, byId=id=>document.getElementById(id);
  const labels={intern:'实习生',assistant:'助理',manager:'项目经理',partner:'合伙人'};
  const statuses={open:'待提交',submitted:'已提交',returned:'已退回',closed:'已关闭'};
  let session=null,teamId='',tasks=[],selected=null,revision=0,submissions=[],hasMore=false,busy=false,viewEpoch=0;
  let methods={demoUsername:true,phonePassword:false,phoneVerification:false,wechat:false,recovery:false},challengeId='',challengeExpiresAt=0,challengePhone='',methodsReady=false,methodsEpoch=0;
  let desktopWechatReady=false,wechatState='idle',wechatEpoch=0,wechatExpiresAt=0,wechatTimer=null,wechatWorking=false;
  let onboardingAvailable=false,onboardingReady=false,onboardingStatusEpoch=0,activationEpoch=0,activationWorking=false,activationPreview=null,activationChallenge=null;
  let invitationEpoch=0,invitationWorking=false,invitationAllowed=false;
  let accountIdentityEpoch=0,accountSessionsEpoch=0,accountSessionRows=[],accountSessionsHasMore=false,accountSessionsLoaded=false,accountSessionsWorking=false,accountSessionsMutation=null;
  function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
  function message(id,text,error=false){const node=byId(id);node.textContent=text||'';node.classList.toggle('error',error);}
  function wechatActive(){return ['starting','pending','binding_required','linking'].includes(wechatState);}
  function updateIdentityControls(){const active=wechatActive(),ready=methodsReady&&methods.wechat&&desktopWechatReady;byId('ordinary-login-fields').hidden=active;byId('login-view').classList.toggle('wechat-active',active);for(const id of ['username','password','login-submit'])byId(id).disabled=busy||active;byId('wechat-login').disabled=busy||!ready||wechatActive();byId('wechat-login').textContent=!methods.wechat?'微信扫码登录 · 未开通':!desktopWechatReady?'微信扫码登录 · 桌面配置未就绪':'微信扫码登录';byId('wechat-message').textContent=!methods.wechat?'尚未配置微信登录，当前不能扫码授权。':!desktopWechatReady?'服务端已配置微信能力，桌面授权配置未就绪，当前不能发起授权。':'将在系统浏览器中授权；完成后请返回此窗口。首次关联需确认本人现有员工账号。';byId('wechat-progress').hidden=wechatState==='idle';byId('wechat-link-fields').hidden=!['binding_required','linking'].includes(wechatState);byId('wechat-link-fields').disabled=busy||wechatWorking||wechatState!=='binding_required';byId('wechat-link-submit').disabled=busy||wechatWorking||wechatState!=='binding_required';byId('wechat-cancel').hidden=!wechatActive();byId('wechat-cancel').disabled=!wechatActive();for(const option of byId('login-mode').options)option.disabled=option.value==='phone'?!methods.phonePassword:!methods.demoUsername;byId('phone-bind-fields').disabled=busy||!methods.phoneVerification;byId('send-bind-code').disabled=busy||!methods.phoneVerification;byId('bind-phone-submit').disabled=busy||!methods.phoneVerification||!challengeId||challengeExpiresAt<=Date.now();byId('bind-code').disabled=busy||!methods.phoneVerification||!challengeId;byId('bind-current-password').disabled=busy||!methods.phoneVerification||!challengeId;byId('phone-service-status').textContent=methods.phoneVerification?'短信服务已配置；仍需完成本次验证码和当前账号密码验证。':'短信验证尚未开通，当前不能绑定手机号。';}
  function setBusy(value){busy=value;for(const node of document.querySelectorAll('button,input,select'))node.disabled=value;updateIdentityControls();updateOnboardingControls();updateAccountSessionsControls();}
  function clearPhoneProof(clearPhone=true){challengeId='';challengeExpiresAt=0;challengePhone='';byId('bind-code').value='';byId('bind-current-password').value='';if(clearPhone)byId('bind-phone').value='';updateIdentityControls();}
  function resetWechat(notify=true){const active=wechatActive();wechatEpoch++;clearTimeout(wechatTimer);wechatTimer=null;wechatState='idle';wechatWorking=false;wechatExpiresAt=0;byId('wechat-link-phone').value='';byId('wechat-link-password').value='';message('wechat-status','');if(notify&&active&&typeof api?.cancelWechatLogin==='function')void Promise.resolve().then(()=>api.cancelWechatLogin()).catch(()=>{});updateIdentityControls();}
  function showLogin(){accountIdentityEpoch++;resetAccountSessions();resetWechat();resetActivation(true,true);resetInvitations();session=null;teamId='';tasks=[];selected=null;submissions=[];revision=0;hasMore=false;viewEpoch++;byId('workspace-view').hidden=true;byId('session-actions').hidden=true;byId('login-view').hidden=false;for(const id of ['username','password','search'])byId(id).value='';for(const id of ['account-name','role-label','task-count','workspace-message','phone-bind-message'])byId(id).textContent='';clearPhoneProof();byId('phone-bind-panel').open=false;byId('task-list').replaceChildren();byId('team-select').replaceChildren();byId('task-detail').replaceChildren();setBusy(false);}
  async function call(name,arg){if(!api)throw {code:'DESKTOP_REQUIRED',message:'请使用审易桌面客户端打开此页面。'};const result=await api[name](arg);if(!result?.ok){if(result?.error?.code==='SIGN_IN_REQUIRED')showLogin();throw result?.error||{message:'操作未完成，请重试。'};}return result.value;}
  async function loadIdentityMethods(){const at=++methodsEpoch;if(typeof api?.getAuthMethods!=='function'){methodsReady=false;desktopWechatReady=false;message('identity-methods-message','当前桌面身份接口未更新；仍可使用明确标注的合成演示账号。');updateIdentityControls();return;}try{const value=await call('getAuthMethods');if(at!==methodsEpoch)return;methods=value.methods;methodsReady=true;desktopWechatReady=value.desktopWechatReady===true&&['startWechatLogin','pollWechatLogin','cancelWechatLogin','linkWechatAccount'].every(name=>typeof api[name]==='function');message('identity-methods-message',methods.phonePassword?'正式方向：手机号＋密码。需先完成手机号验证绑定；合成演示账号保持独立。':'手机号登录尚未开放；合成演示账号不代表正式身份已验证。');}catch{if(at!==methodsEpoch)return;methodsReady=false;desktopWechatReady=false;message('identity-methods-message','身份服务状态暂不可读取，未启用手机号验证或微信扫码。',true);methods={demoUsername:true,phonePassword:false,phoneVerification:false,wechat:false,recovery:false};}updateIdentityControls();}
  async function wechatCall(name,arg,at){const result=await api[name](arg);if(at!==wechatEpoch)throw {code:'STALE_WECHAT'};if(!result?.ok){if(result?.error?.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message',result.error.message||'登录已失效，请重新登录。',true);}throw result?.error||{message:'微信授权暂时无法完成，请重新开始。'};}return result.value;}
  function terminalWechat(state,text,error=false){clearTimeout(wechatTimer);wechatTimer=null;wechatState=state;wechatWorking=false;byId('wechat-link-phone').value='';byId('wechat-link-password').value='';message('wechat-status',text,error);updateIdentityControls();}
  async function applyWechatResult(result,at){if(at!==wechatEpoch)return;if(result.status==='signed_in'){resetWechat(false);message('login-message','');await enter(result.session);return;}if(Number.isSafeInteger(result.expiresAt))wechatExpiresAt=result.expiresAt;if(wechatExpiresAt&&wechatExpiresAt<=Date.now()){terminalWechat('expired','本次微信授权已过期，请重新开始。',true);return;}if(result.status==='binding_required'){wechatState='binding_required';wechatWorking=false;message('wechat-status','微信授权已收到。请核对并确认关联本人现有员工账号。');updateIdentityControls();byId('wechat-link-phone').focus();return;}if(result.status==='pending'){wechatState='pending';wechatWorking=false;message('wechat-status','等待浏览器中的微信授权。可随时取消本次操作。');updateIdentityControls();wechatTimer=setTimeout(()=>void pollWechat(at),2000);return;}const words={expired:'本次微信授权已过期，请重新开始。',canceled:'本次微信授权已取消，可重新开始。',failed:'微信授权未完成，请重新开始。',idle:'当前没有待完成的微信授权，请重新开始。'};terminalWechat(Object.hasOwn(words,result.status)?result.status:'failed',words[result.status]||'微信授权状态无效，请重新开始。',result.status!=='canceled');}
  async function pollWechat(at){if(at!==wechatEpoch||wechatState!=='pending'||wechatWorking)return;wechatTimer=null;wechatWorking=true;try{await applyWechatResult(await wechatCall('pollWechatLogin',undefined,at),at);}catch(error){if(at===wechatEpoch){if(error.code==='WECHAT_BUSY'&&wechatExpiresAt>Date.now()){message('wechat-status','授权验证处理中，请稍候；也可取消本次操作。');wechatTimer=setTimeout(()=>void pollWechat(at),2000);}else if(['HTTP_410','TRANSACTION_EXPIRED'].includes(error.code))terminalWechat('expired','本次微信授权已过期，请重新开始。',true);else terminalWechat('failed',error.message||'无法读取微信授权状态，请重新开始。',true);}}finally{if(at===wechatEpoch){wechatWorking=false;updateIdentityControls();}}}
  function accountSessionsApiReady(){return ['listAccountSessions','revokeAccountSession','revokeOtherSessions','revokeAllSessions'].every(name=>typeof api?.[name]==='function');}
  function accountSessionsActor(){return {id:session?.account.id,epoch:accountIdentityEpoch};}
  function sameAccountSessionsActor(actor){return !!session&&actor.id===session.account.id&&actor.epoch===accountIdentityEpoch;}
  function currentAccountSessionsView(at,actor){return at===accountSessionsEpoch&&sameAccountSessionsActor(actor)&&byId('account-sessions-panel').open;}
  function accountSessionsPending(){return !!accountSessionsMutation&&sameAccountSessionsActor(accountSessionsMutation.actor);}
  function updateAccountSessionsControls(){
    const ready=!!session&&accountSessionsApiReady()&&byId('account-sessions-panel').open,locked=busy||accountSessionsWorking||accountSessionsPending();
    byId('account-sessions-refresh').disabled=!ready||locked;
    byId('account-sessions-password').disabled=!ready||locked||!accountSessionsLoaded;
    const proof=ready&&!locked&&accountSessionsLoaded&&!!byId('account-sessions-password').value;
    for(const id of ['account-sessions-revoke-others','account-sessions-revoke-all'])byId(id).disabled=!proof;
    for(const button of byId('account-sessions-list').querySelectorAll('button'))button.disabled=!proof;
    byId('account-sessions-more').hidden=!accountSessionsHasMore;
    byId('account-sessions-more').disabled=!ready||locked||!accountSessionsHasMore;
  }
  function resetAccountSessions(close=true){
    accountSessionsEpoch++;accountSessionRows=[];accountSessionsHasMore=false;accountSessionsLoaded=false;accountSessionsWorking=false;
    if(!accountSessionsPending())accountSessionsMutation=null;
    byId('account-sessions-password').value='';byId('account-sessions-count').textContent='';byId('account-sessions-list').replaceChildren();message('account-sessions-message','');
    if(close)byId('account-sessions-panel').open=false;updateAccountSessionsControls();
  }
  async function accountSessionsCall(name,arg,actor){
    const result=await api[name](arg);
    // A previous account's late 401 or signedOut must not clear a newer login.
    if(!sameAccountSessionsActor(actor))throw {code:'STALE_ACCOUNT_SESSIONS'};
    if(!result?.ok){if(result?.error?.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message',result.error.message||'登录已失效，请重新登录。',true);}throw result?.error||{message:'登录会话操作未完成，请刷新后重试。'};}
    return result.value;
  }
  function renderAccountSessions(){
    const list=byId('account-sessions-list');list.replaceChildren();byId('account-sessions-count').textContent=accountSessionRows.length?'已加载 '+accountSessionRows.length+' 项有效登录':'';
    if(!accountSessionRows.length)list.append(el('li',accountSessionsLoaded?'当前没有可显示的有效登录，请刷新核对。':'登录列表待刷新，请重新读取后核对。','account-session-empty'));
    for(const item of accountSessionRows){
      const row=el('li',undefined,'account-session-item'),description=el('div');row.dataset.sessionId=item.id;
      const title=el('strong',item.createdAt===null?'登录时间未记录':'登录于 '+new Date(item.createdAt).toLocaleString('zh-CN'));
      if(item.isCurrent)title.append(el('span','当前登录','account-session-current'));
      description.append(title,el('small','有效至 '+new Date(item.expiresAt).toLocaleString('zh-CN')));
      const button=el('button',item.isCurrent?'退出当前登录':'退出该登录','button');button.type='button';button.addEventListener('click',()=>void revokeAccountSessions('revokeAccountSession',item.id));
      row.append(description,button);list.append(row);
    }
    updateAccountSessionsControls();
  }
  function acceptAccountSessionsPage(data,append){
    const rows=data.sessions.map(item=>({id:item.id,isCurrent:item.isCurrent,createdAt:item.createdAt,expiresAt:item.expiresAt}));
    accountSessionRows=append?[...new Map(accountSessionRows.concat(rows).map(item=>[item.id,item])).values()]:rows;
    accountSessionsHasMore=data.hasMore;accountSessionsLoaded=true;renderAccountSessions();
  }
  async function loadAccountSessions(append=false){
    if(!session||busy||accountSessionsWorking||accountSessionsPending()||!byId('account-sessions-panel').open)return;
    if(!accountSessionsApiReady()){message('account-sessions-message','当前桌面会话接口尚未就绪，请更新后重试。',true);updateAccountSessionsControls();return;}
    const at=accountSessionsEpoch,actor=accountSessionsActor();accountSessionsWorking=true;updateAccountSessionsControls();message('account-sessions-message','正在读取你的有效登录…');
    try{const query={limit:30};if(append&&accountSessionRows.length)query.after=accountSessionRows.at(-1).id;const data=await accountSessionsCall('listAccountSessions',query,actor);if(!currentAccountSessionsView(at,actor))return;acceptAccountSessionsPage(data,append);message('account-sessions-message','仅显示你的有效登录；退出其他登录会保留当前登录。');}
    catch(error){if(currentAccountSessionsView(at,actor))message('account-sessions-message',error.message||'登录列表读取失败，请刷新重试。',true);}
    finally{if(currentAccountSessionsView(at,actor)){accountSessionsWorking=false;updateAccountSessionsControls();}}
  }
  async function revokeAccountSessions(method,sessionId){
    if(!session||busy||accountSessionsWorking||accountSessionsPending()||!accountSessionsLoaded||!accountSessionsApiReady())return;
    const currentPassword=byId('account-sessions-password').value;if(!currentPassword){message('account-sessions-message','请先填写当前账号密码，再选择退出操作。',true);return;}
    const at=accountSessionsEpoch,actor=accountSessionsActor(),operation={actor};let committed=false;accountSessionsMutation=operation;updateAccountSessionsControls();message('account-sessions-message','正在验证密码并退出所选登录…');
    try{
      const result=await accountSessionsCall(method,{...(sessionId?{sessionId}:{}),currentPassword},actor);
      committed=true;
      if(result.signedOut){showLogin();message('login-message','当前登录已退出，请重新登录。');return;}
      if(!currentAccountSessionsView(at,actor))return;
      accountSessionRows=[];accountSessionsHasMore=false;accountSessionsLoaded=false;renderAccountSessions();
      const data=await accountSessionsCall('listAccountSessions',{limit:30},actor);if(!currentAccountSessionsView(at,actor))return;
      acceptAccountSessionsPage(data,false);message('account-sessions-message',method==='revokeOtherSessions'?'已退出 '+result.revokedCount+' 项其他登录，当前登录保留。':'所选登录已退出，列表已更新。');
    }catch(error){if(currentAccountSessionsView(at,actor))message('account-sessions-message',committed?'退出操作已完成，但登录列表刷新失败，请刷新核对。':error.message||'未能确认退出结果，请刷新核对。',true);}
    finally{
      if(accountSessionsMutation===operation)accountSessionsMutation=null;
      if(sameAccountSessionsActor(actor)){
        byId('account-sessions-password').value='';updateAccountSessionsControls();
        if(at!==accountSessionsEpoch&&byId('account-sessions-panel').open)void loadAccountSessions();
      }
    }
  }
  byId('account-sessions-panel').querySelector('summary').addEventListener('click',()=>{
    if(byId('account-sessions-panel').open){const pending=accountSessionsPending();resetAccountSessions(false);if(pending)message('workspace-message','已清除密码与列表；已提交的退出请求仍可能完成。');}
  });
  byId('account-sessions-panel').addEventListener('toggle',()=>{
    if(byId('account-sessions-panel').open){if(accountSessionsPending())message('account-sessions-message','退出请求仍在处理中，请稍候核对。');else void loadAccountSessions();}
    else{const pending=accountSessionsPending();resetAccountSessions(false);if(pending&&session)message('workspace-message','已清除密码与列表；已提交的退出请求仍可能完成。');}
  });
  byId('account-sessions-password').addEventListener('input',updateAccountSessionsControls);
  byId('account-sessions-password').addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});
  byId('account-sessions-refresh').addEventListener('click',()=>void loadAccountSessions());
  byId('account-sessions-more').addEventListener('click',()=>void loadAccountSessions(true));
  byId('account-sessions-revoke-others').addEventListener('click',()=>void revokeAccountSessions('revokeOtherSessions'));
  byId('account-sessions-revoke-all').addEventListener('click',()=>void revokeAccountSessions('revokeAllSessions'));
  function onboardingApiReady(){return ['getOnboardingStatus','previewEmployeeInvitation','requestEmployeeActivation','activateEmployee'].every(name=>typeof api?.[name]==='function');}
  function updateOnboardingControls(){
    const ready=onboardingReady&&onboardingApiReady(),proof=!!activationChallenge&&activationChallenge.expiresAt>Date.now();
    for(const id of ['activation-invitation','activation-phone'])byId(id).disabled=busy||activationWorking;
    byId('activation-preview').disabled=busy||activationWorking||!onboardingApiReady();
    byId('activation-send-code').disabled=busy||activationWorking||!ready||!onboardingAvailable||!activationPreview;
    byId('activation-proof').hidden=!activationChallenge;byId('activation-proof').disabled=busy||activationWorking||!ready||!onboardingAvailable||!proof;
    for(const id of ['activation-code','activation-display-name','activation-password','activation-accept'])byId(id).disabled=busy||activationWorking||!ready||!onboardingAvailable||!proof;
    byId('activation-submit').disabled=busy||activationWorking||!ready||!onboardingAvailable||!proof||!byId('activation-accept').checked;
    byId('activation-cancel').disabled=false;
    byId('employee-invitation-fields').disabled=busy||invitationWorking||!invitationAllowed;
    for(const id of ['invitation-phone','invitation-role','invitation-create','invitation-refresh'])byId(id).disabled=busy||invitationWorking||!invitationAllowed;
    for(const button of byId('employee-invitation-list').querySelectorAll('button'))button.disabled=busy||invitationWorking||!invitationAllowed;
    byId('invitation-service-status').textContent=onboardingAvailable?'员工需本人完成手机号验证并确认加入。':'短信激活服务尚未开通。创建邀请不会发送消息，员工暂不能完成激活。';
  }
  function resetActivation(clearIdentity=true,close=false){
    activationEpoch++;activationWorking=false;activationPreview=null;activationChallenge=null;
    for(const id of ['activation-code','activation-password','activation-display-name'])byId(id).value='';
    byId('activation-accept').checked=false;byId('activation-target').hidden=true;
    byId('activation-target-description').textContent='';byId('activation-target-expiry').textContent='';byId('activation-accept-label').textContent='确认加入邀请指定的团队与岗位';
    if(clearIdentity)for(const id of ['activation-invitation','activation-phone'])byId(id).value='';
    message('activation-message','');if(close)byId('activation-panel').open=false;
    byId('login-view').classList.toggle('onboarding-active',byId('activation-panel').open);updateOnboardingControls();
  }
  async function loadOnboardingStatus(){
    const at=++onboardingStatusEpoch;onboardingReady=false;onboardingAvailable=false;updateOnboardingControls();
    if(!onboardingApiReady()){message('activation-service-status','当前桌面激活接口尚未就绪，不能发送验证码或激活账号。');return;}
    try{const result=await call('getOnboardingStatus');if(at!==onboardingStatusEpoch)return;onboardingReady=result.invitationOnly===true;onboardingAvailable=onboardingReady&&result.available===true;message('activation-service-status',onboardingAvailable?'手机号验证服务已配置；仍须核对邀请、本人验证码及加入确认。':'短信激活服务尚未开通，当前不能发送验证码或激活账号。');}
    catch{if(at!==onboardingStatusEpoch)return;message('activation-service-status','激活服务状态暂不可读取，当前不能发送验证码或激活账号。',true);}
    finally{if(at===onboardingStatusEpoch)updateOnboardingControls();}
  }
  function activationIdentity(){return {invitationCode:byId('activation-invitation').value,phone:byId('activation-phone').value};}
  async function previewActivation(){
    if(busy||activationWorking||!onboardingApiReady())return;const identity=activationIdentity();if(!identity.invitationCode.trim()||!identity.phone.trim()){message('activation-message','请填写邀请码和受邀手机号。',true);return;}
    resetActivation(false);const at=activationEpoch;activationWorking=true;updateOnboardingControls();message('activation-message','正在核对邀请…');
    try{const result=await call('previewEmployeeInvitation',identity);if(at!==activationEpoch)return;activationPreview=result;byId('activation-target').hidden=false;byId('activation-target-description').textContent='加入团队 '+result.teamId+' · '+labels[result.role]+' · '+result.phoneMasked;byId('activation-target-expiry').textContent='邀请有效至 '+new Date(result.expiresAt).toLocaleString('zh-CN');byId('activation-accept-label').textContent='本人确认以'+labels[result.role]+'身份加入团队 '+result.teamId;message('activation-message','请核对团队与岗位，再获取本人手机号验证码。');}
    catch(error){if(at===activationEpoch)message('activation-message',error.message||'邀请无法使用，请联系管理员。',true);}
    finally{if(at===activationEpoch){activationWorking=false;updateOnboardingControls();}}
  }
  function clearIssuedInvitation(){byId('issued-invitation').hidden=true;byId('issued-invitation-description').textContent='';byId('issued-invitation-code').value='';}
  function resetInvitations(close=true){invitationEpoch++;invitationWorking=false;invitationAllowed=false;byId('employee-invitations-panel').hidden=true;if(close)byId('employee-invitations-panel').open=false;clearIssuedInvitation();byId('invitation-phone').value='';byId('invitation-role').value='intern';byId('employee-invitation-list').replaceChildren();message('invitation-message','');updateOnboardingControls();return invitationEpoch;}
  function currentInvitationView(at,target){return at===invitationEpoch&&session&&teamId===target;}
  function renderInvitations(items){
    const list=byId('employee-invitation-list');list.replaceChildren();const words={pending:'待激活',revoked:'已撤销',accepted:'已使用',expired:'已过期'};
    if(!items.length){list.append(el('li','暂无邀请记录。'));return;}
    for(const item of items){const row=el('li'),description=el('div');description.append(el('strong',item.phoneMasked+' · '+labels[item.role]+' · '+words[item.status]),el('small','有效至 '+new Date(item.expiresAt).toLocaleString('zh-CN')));row.append(description);if(item.status==='pending'){const revoke=el('button','撤销','button');revoke.type='button';revoke.addEventListener('click',()=>revokeInvitation(item.invitationId));row.append(revoke);}list.append(row);}
    updateOnboardingControls();
  }
  async function refreshInvitationList(at,target){const value=await call('listEmployeeInvitations',{teamId:target});if(currentInvitationView(at,target))renderInvitations(value.invitations);}
  async function loadInvitationAccess(){
    const open=byId('employee-invitations-panel').open,at=resetInvitations(false),target=teamId;
    if(!session||!target||!['getInvitationAccess','listEmployeeInvitations','createEmployeeInvitation','revokeEmployeeInvitation'].every(name=>typeof api?.[name]==='function'))return;
    invitationWorking=true;
    try{const result=await call('getInvitationAccess',{teamId:target});if(!currentInvitationView(at,target)||result.canInvite!==true)return;await refreshInvitationList(at,target);if(!currentInvitationView(at,target))return;invitationAllowed=true;byId('employee-invitations-panel').hidden=false;byId('employee-invitations-panel').open=open;}
    catch{if(currentInvitationView(at,target))resetInvitations();}
    finally{if(at===invitationEpoch){invitationWorking=false;updateOnboardingControls();}}
  }
  async function revokeInvitation(invitationId){
    if(busy||invitationWorking||!invitationAllowed)return;const at=invitationEpoch,target=teamId;invitationWorking=true;clearIssuedInvitation();updateOnboardingControls();
    try{await call('revokeEmployeeInvitation',{teamId:target,invitationId});if(!currentInvitationView(at,target))return;await refreshInvitationList(at,target);if(currentInvitationView(at,target))message('invitation-message','邀请状态已更新。');}
    catch{if(currentInvitationView(at,target))resetInvitations();}
    finally{if(at===invitationEpoch){invitationWorking=false;updateOnboardingControls();}}
  }
  function closeActivationInput(){const submitted=activationWorking&&!!activationChallenge;resetActivation();if(submitted)message('login-message','已清除输入；已提交的激活可能已完成，可用手机号登录核对。');}
  // Native details opening is synchronous, but toggle is queued. Never clear
  // activation inputs in that late opening event: the user may already have pasted.
  byId('activation-panel').querySelector('summary').addEventListener('click',()=>{if(byId('activation-panel').open)closeActivationInput();});
  byId('activation-panel').addEventListener('toggle',()=>{if(byId('activation-panel').open){byId('login-view').classList.add('onboarding-active');resetWechat();byId('username').value='';byId('password').value='';void loadOnboardingStatus();}else closeActivationInput();});
  for(const id of ['activation-invitation','activation-phone'])byId(id).addEventListener('input',()=>{resetActivation(false);message('activation-message','邀请码或手机号已改变，请重新核对邀请。');});
  byId('activation-preview').addEventListener('click',()=>void previewActivation());
  byId('activation-send-code').addEventListener('click',async()=>{
    if(busy||activationWorking||!activationPreview||!onboardingReady||!onboardingAvailable)return;if(activationPreview.expiresAt<=Date.now()){resetActivation(false);message('activation-message','邀请已过期，请联系管理员。',true);return;}
    const at=activationEpoch;activationChallenge=null;byId('activation-code').value='';byId('activation-password').value='';byId('activation-accept').checked=false;activationWorking=true;updateOnboardingControls();message('activation-message','正在请求本人手机号验证码…');
    try{const value=await call('requestEmployeeActivation',activationIdentity());if(at!==activationEpoch)return;activationChallenge=value;message('activation-message','验证码发送请求已完成。请填写收到的验证码，核对并确认加入。');}
    catch(error){if(at===activationEpoch)message('activation-message',error.message||'验证码请求未完成。',true);}
    finally{if(at===activationEpoch){activationWorking=false;updateOnboardingControls();}}
  });
  byId('activation-accept').addEventListener('change',updateOnboardingControls);
  byId('activation-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||activationWorking||!activationPreview||!onboardingAvailable||!activationChallenge)return;
    if(activationChallenge.expiresAt<=Date.now()||activationPreview.expiresAt<=Date.now()){resetActivation(false);message('activation-message','验证或邀请已过期，请重新核对。',true);return;}
    if(!byId('activation-accept').checked){message('activation-message','请先核对并确认加入指定团队与岗位。',true);return;}
    const at=activationEpoch,proof={...activationIdentity(),challengeId:activationChallenge.challengeId,code:byId('activation-code').value,password:byId('activation-password').value,displayName:byId('activation-display-name').value,accept:true};
    activationWorking=true;updateOnboardingControls();message('activation-message','正在验证本人账号并确认加入…');
    try{await call('activateEmployee',proof);if(at!==activationEpoch)return;resetActivation();if(methods.phonePassword){byId('login-mode').value='phone';byId('username').placeholder='输入已验证绑定的手机号';byId('username').inputMode='tel';}message('activation-message','账号已激活，请返回使用手机号＋密码登录。');}
    catch(error){if(at===activationEpoch)message('activation-message',error.message||'激活未完成，请核对资料或联系管理员。',true);}
    finally{if(at===activationEpoch){byId('activation-password').value='';byId('activation-code').value='';byId('activation-accept').checked=false;activationWorking=false;updateOnboardingControls();}}
  });
  byId('activation-cancel').addEventListener('click',()=>{const submitted=activationWorking&&!!activationChallenge;resetActivation(true,true);if(submitted)message('login-message','已清除输入；已提交的激活可能已完成，可用手机号登录核对。');});
  byId('employee-invitation-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||invitationWorking||!invitationAllowed)return;const at=invitationEpoch,target=teamId,input={teamId:target,phone:byId('invitation-phone').value,role:byId('invitation-role').value};invitationWorking=true;clearIssuedInvitation();updateOnboardingControls();
    try{const value=await call('createEmployeeInvitation',input);if(!currentInvitationView(at,target))return;byId('invitation-phone').value='';byId('issued-invitation-description').textContent=value.phoneMasked+' · '+labels[value.role]+' · 团队 '+value.teamId+' · 有效至 '+new Date(value.expiresAt).toLocaleString('zh-CN');byId('issued-invitation-code').value=value.invitationCode;byId('issued-invitation').hidden=false;await refreshInvitationList(at,target);if(currentInvitationView(at,target))message('invitation-message','邀请已创建，未发送消息。请核对后自行转交本次邀请码。');}
    catch{if(currentInvitationView(at,target))resetInvitations();}
    finally{if(at===invitationEpoch){invitationWorking=false;updateOnboardingControls();}}
  });
  byId('employee-invitations-panel').addEventListener('toggle',()=>{if(!byId('employee-invitations-panel').open&&invitationAllowed){invitationEpoch++;invitationWorking=false;clearIssuedInvitation();byId('invitation-phone').value='';updateOnboardingControls();}});
  byId('invitation-refresh').addEventListener('click',()=>void loadInvitationAccess());
  byId('wechat-login').addEventListener('click',async()=>{if(busy||!methodsReady||!methods.wechat||!desktopWechatReady||wechatActive())return;resetActivation(true,true);resetWechat(false);const at=wechatEpoch;wechatState='starting';wechatWorking=true;for(const id of ['username','password'])byId(id).value='';message('login-message','');message('wechat-status','正在打开系统浏览器，请稍候…');updateIdentityControls();try{await applyWechatResult(await wechatCall('startWechatLogin',undefined,at),at);}catch(error){if(at===wechatEpoch)terminalWechat('failed',error.message||'无法开始微信授权，请重试。',true);}finally{if(at===wechatEpoch){wechatWorking=false;updateIdentityControls();}}});
  byId('wechat-cancel').addEventListener('click',()=>{if(!wechatActive())return;resetWechat();terminalWechat('canceled','本次微信授权已取消，可重新开始。');});
  byId('wechat-link-submit').addEventListener('click',async()=>{if(busy||wechatWorking||wechatState!=='binding_required')return;if(wechatExpiresAt&&wechatExpiresAt<=Date.now()){terminalWechat('expired','本次微信授权已过期，请重新开始。',true);return;}const phone=byId('wechat-link-phone').value,password=byId('wechat-link-password').value;if(!phone.trim()||!password){message('wechat-status','请填写本人现有账号的已验证手机号和密码。',true);return;}const at=wechatEpoch;wechatState='linking';wechatWorking=true;message('wechat-status','正在验证账号并确认关联…');updateIdentityControls();try{await applyWechatResult(await wechatCall('linkWechatAccount',{phone,password},at),at);}catch(error){if(at===wechatEpoch){if(['HTTP_410','TRANSACTION_EXPIRED'].includes(error.code))terminalWechat('expired','本次微信授权已过期，请重新开始。',true);else if(error.code==='WECHAT_NOT_LINKABLE'){resetWechat();terminalWechat('failed','本次微信授权状态已改变，请重新开始。',true);}else{wechatState='binding_required';message('wechat-status',error.message||'关联未完成，请核对账号后重试或取消。',true);}}}finally{if(at===wechatEpoch){byId('wechat-link-password').value='';wechatWorking=false;updateIdentityControls();}}});
  for(const id of ['wechat-link-phone','wechat-link-password'])byId(id).addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();byId('wechat-link-submit').click();}});
  window.addEventListener('beforeunload',()=>{resetAccountSessions();resetWechat();resetActivation(true,true);resetInvitations();});
  function detailEmpty(){const wrap=el('div',undefined,'detail-empty');wrap.append(el('span','▤','empty-symbol'),el('h2','从左侧选择任务'),el('p','任务要求和你的提交记录将在这里显示。'));byId('task-detail').replaceChildren(wrap);}
  function statusChip(status){return el('span',statuses[status]||'状态待核对','status-chip '+status);}
  function renderTasks(){const list=byId('task-list');list.replaceChildren();byId('task-count').textContent=tasks.length?tasks.length+' 项已加载':'';byId('load-more').hidden=!hasMore;
    if(!tasks.length){list.append(el('p','当前没有可见的采集任务。','list-empty'));return;}
    for(const task of tasks){const button=el('button',undefined,'task-button'+(selected?.id===task.id?' selected':''));button.type='button';button.setAttribute('aria-pressed',String(selected?.id===task.id));button.append(statusChip(task.status),el('strong',task.title),el('small','查看任务要求与我的提交'));button.addEventListener('click',()=>selectTask(task.id));list.append(button);}}
  function renderDetail(){if(!selected){detailEmpty();return;}const heading=el('div',undefined,'detail-heading');heading.append(el('h2',selected.title),statusChip(selected.status));const label=el('p','采集要求','detail-label');const description=el('div',selected.instructions,'instructions');
    const upload=el('div',undefined,'upload-area'),words=el('div');words.append(el('strong','提交此任务所需资料'),el('p','每份不超过12 MiB；请选择合成演示文件。'));const uploadButton=el('button','选择文件并提交','button primary');uploadButton.type='button';uploadButton.disabled=busy||!['open','returned'].includes(selected.status);uploadButton.addEventListener('click',uploadSelected);upload.append(words,uploadButton);
    if(!['open','returned'].includes(selected.status))words.append(el('p','当前任务不可追加，待负责人退回后可重新提交。'));
    const historyTitle=el('h3','我的提交记录'),list=el('ul',undefined,'submission-list');
    if(!submissions.length)list.append(el('li','尚无提交记录。','submission-empty'));
    for(const item of submissions){const row=el('li',undefined,'submission-item'),info=el('div');info.append(el('strong',item.filename),el('small',formatSize(item.byteLength)+' · '+new Date(item.createdAt).toLocaleString('zh-CN')),el('small','SHA-256 '+item.sha256));const download=el('button','下载原件','button');download.type='button';download.disabled=busy;download.addEventListener('click',()=>downloadItem(item.attachmentId));row.append(info,download);list.append(row);}
    byId('task-detail').replaceChildren(heading,label,description,upload,historyTitle,list);}
  function formatSize(bytes){return bytes<1024?bytes+' B':bytes<1024*1024?(bytes/1024).toFixed(1)+' KiB':(bytes/1024/1024).toFixed(2)+' MiB';}
  async function loadTasks(append=false){const at=++viewEpoch;setBusy(true);message('workspace-message','正在读取获授权任务…');try{const query={teamId,q:byId('search').value,limit:30};if(append&&tasks.length)query.after=tasks.at(-1).id;const data=await call('listTasks',query);if(at!==viewEpoch)return;tasks=append?tasks.concat(data.tasks):data.tasks;hasMore=data.hasMore;if(!append){selected=null;submissions=[];renderDetail();}renderTasks();message('workspace-message','任务列表已更新。');}catch(error){if(at===viewEpoch)message('workspace-message',error.message,true);}finally{if(at===viewEpoch)setBusy(false);}}
  async function selectTask(taskId){const at=++viewEpoch;setBusy(true);message('workspace-message','正在读取任务…');try{const key={teamId,taskId};const [detail,history]=await Promise.all([call('getTask',key),call('getSubmissions',key)]);if(at!==viewEpoch)return;selected=detail.task;submissions=history.submissions;revision=history.revision;renderTasks();renderDetail();message('workspace-message','只展示当前任务和你的提交记录。');}catch(error){if(at===viewEpoch){selected=null;submissions=[];renderDetail();message('workspace-message',error.message,true);}}finally{if(at===viewEpoch){setBusy(false);renderDetail();}}}
  async function uploadSelected(){if(!selected||busy)return;const taskId=selected.id,at=viewEpoch;setBusy(true);message('workspace-message','请选择资料；确认后将提交至本机团队服务。');try{const result=await call('chooseAndUpload',{teamId,taskId,revision});if(at!==viewEpoch)return;if(result.canceled){message('workspace-message','已取消，未提交资料。');return;}await selectTask(taskId);if(selected){const updated=tasks.find(task=>task.id===taskId);if(updated)updated.status=selected.status;renderTasks();}message('workspace-message','资料已提交，原件与提交记录已保存。');}catch(error){message('workspace-message',error.message,true);}finally{setBusy(false);renderDetail();}}
  async function downloadItem(attachmentId){if(!selected||busy)return;setBusy(true);message('workspace-message','正在核验原件下载权限…');try{const result=await call('downloadAttachment',{teamId,taskId:selected.id,attachmentId});message('workspace-message',result.canceled?'已取消，未保存副本。':'原件副本已保存：'+result.filename);}catch(error){message('workspace-message',error.message,true);}finally{setBusy(false);renderDetail();}}
  async function enter(value){accountIdentityEpoch++;resetAccountSessions();resetWechat(false);resetActivation(true,true);resetInvitations();session=value;viewEpoch++;clearPhoneProof();message('phone-bind-message','');byId('phone-bind-panel').open=false;byId('login-view').hidden=true;byId('workspace-view').hidden=false;byId('session-actions').hidden=false;byId('account-name').textContent=session.account.displayName;byId('password').value='';const select=byId('team-select');select.replaceChildren();for(const member of session.memberships){const option=el('option',member.teamId);option.value=member.teamId;select.append(option);}teamId=session.memberships[0]?.teamId||'';updateRole();void loadIdentityMethods();void loadOnboardingStatus();void loadInvitationAccess();if(teamId)await loadTasks();else{tasks=[];renderTasks();detailEmpty();message('workspace-message','当前账号尚未加入可用团队。');}}
  function updateRole(){byId('role-label').textContent=labels[session?.memberships.find(member=>member.teamId===teamId)?.role]||'未指派角色';}
  byId('login-form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;resetWechat();resetActivation(true,true);const phoneMode=byId('login-mode').value==='phone';if(phoneMode&&(!methodsReady||!methods.phonePassword)){message('login-message','手机号登录尚未开放。',true);return;}setBusy(true);message('login-message','正在登录…');try{const value=await call(phoneMode?'loginPhone':'login',phoneMode?{phone:byId('username').value,password:byId('password').value}:{username:byId('username').value,password:byId('password').value});message('login-message','');await enter(value);}catch(error){message('login-message',error.message,true);}finally{byId('password').value='';setBusy(false);}});
  byId('login-mode').addEventListener('change',()=>{resetWechat();resetActivation(true,true);byId('username').value='';byId('password').value='';clearPhoneProof();message('login-message','');byId('username').placeholder=byId('login-mode').value==='phone'?'输入已验证绑定的手机号':'输入团队账号';byId('username').inputMode=byId('login-mode').value==='phone'?'tel':'text';});
  byId('bind-phone').addEventListener('input',()=>{clearPhoneProof(false);message('phone-bind-message','手机号已改变，请重新获取验证码。');});
  byId('send-bind-code').addEventListener('click',async()=>{if(busy||!session)return;if(!methodsReady||!methods.phoneVerification){message('phone-bind-message','短信验证服务尚未开通，未发送验证码。',true);return;}const at=viewEpoch,phone=byId('bind-phone').value;clearPhoneProof(false);setBusy(true);message('phone-bind-message','正在请求短信验证…');try{const result=await call('requestPhoneBind',{phone});if(at!==viewEpoch||byId('bind-phone').value!==phone)return;challengeId=result.challengeId;challengeExpiresAt=result.expiresAt;challengePhone=phone;message('phone-bind-message','验证码发送请求已完成，请填写收到的验证码及当前账号密码。');}catch(error){if(at===viewEpoch)message('phone-bind-message',error.message,true);}finally{if(at===viewEpoch)setBusy(false);}});
  byId('phone-bind-form').addEventListener('submit',async event=>{event.preventDefault();if(busy||!session)return;if(!challengeId||challengeExpiresAt<=Date.now()||byId('bind-phone').value!==challengePhone){clearPhoneProof(false);message('phone-bind-message','本次验证码已失效，请重新获取。',true);return;}const at=viewEpoch,proof={challengeId,code:byId('bind-code').value,currentPassword:byId('bind-current-password').value};let completed=false;setBusy(true);try{const result=await call('bindPhone',proof);if(at!==viewEpoch)return;completed=true;message('phone-bind-message','手机号已验证并绑定：'+result.phoneMasked);}catch(error){if(at===viewEpoch)message('phone-bind-message',error.message,true);}finally{if(at===viewEpoch){if(completed)clearPhoneProof();else{byId('bind-code').value='';byId('bind-current-password').value='';}setBusy(false);}}});
  byId('logout').addEventListener('click',async()=>{if(busy)return;setBusy(true);try{await call('logout');showLogin();message('login-message','已退出，当前窗口中的账号和任务资料已清除。');}catch(error){showLogin();message('login-message',error.message,true);}finally{setBusy(false);}});
  byId('refresh').addEventListener('click',()=>{void loadInvitationAccess();loadTasks();});byId('load-more').addEventListener('click',()=>loadTasks(true));byId('team-select').addEventListener('change',()=>{resetAccountSessions();teamId=byId('team-select').value;updateRole();void loadInvitationAccess();loadTasks();});byId('search-form').addEventListener('submit',event=>{event.preventDefault();loadTasks();});
  if(!api){message('login-message','此页面需要审易桌面客户端，请从桌面启动入口打开。',true);byId('login-submit').disabled=true;}
  updateIdentityControls();updateOnboardingControls();if(api){void loadIdentityMethods();void loadOnboardingStatus();}
})();
