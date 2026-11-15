'use strict';
(() => {
  const api=window.shenyiTeam, byId=id=>document.getElementById(id);
  const labels={intern:'实习生',assistant:'助理',manager:'项目经理',partner:'合伙人'};
  const statuses={open:'待提交',submitted:'已提交',returned:'已退回',closed:'已关闭'};
  let session=null,teamId='',tasks=[],selected=null,revision=0,submissions=[],hasMore=false,busy=false,viewEpoch=0,busyEpoch=0;
  let submissionAccessEpoch=0,submissionAccess=null,submissionAccessStatus='idle',taskUploadOperation=null;
  let methods={demoUsername:true,phonePassword:false,phoneVerification:false,wechat:false,recovery:false},challengeId='',challengeExpiresAt=0,challengePhone='',methodsReady=false,methodsEpoch=0;
  let desktopWechatReady=false,wechatState='idle',wechatEpoch=0,wechatExpiresAt=0,wechatTimer=null,wechatWorking=false;
  let onboardingAvailable=false,onboardingReady=false,onboardingStatusEpoch=0,activationEpoch=0,activationWorking=false,activationPreview=null,activationChallenge=null;
  let invitationEpoch=0,invitationWorking=false,invitationAllowed=false;
  let accountIdentityEpoch=0,accountSessionsEpoch=0,accountSessionRows=[],accountSessionsHasMore=false,accountSessionsLoaded=false,accountSessionsWorking=false,accountSessionsMutation=null;
  let passwordChangeEpoch=0,passwordChangeMutation=null;
  let firstAdminEpoch=0,firstAdminWorking=false,firstAdminPreview=null,firstAdminChallenge=null,firstAdminMutation=null;
  let provisioningEpoch=0,provisioningAllowed=false,provisioningWorking=false,provisioningRows=[],provisioningMutation=null,provisioningPanelOpened=false;
  let administrationTeams=[],invitationTeamId='';
  let recoveryEpoch=0,recoveryWorking=false,recoveryChallenge=null,recoveryMutation=null,recoveryRequest=null;
  let recoveryReviewMode=false,recoveryReviewAvailable=false,recoveryReviewStatusEpoch=0,recoveryReviewReceipt=null,recoveryReviewSubmission=null;
  let recoveryReviewsEpoch=0,recoveryReviewsAllowed=false,recoveryReviewsRows=[],recoveryReviewsWorking=false,recoveryReviewsMutation=null,recoveryReviewsOpened=false;
  let taskManagementEpoch=0,taskManagementState=null,taskManagementMembers=[],taskManagementHasMore=false,taskManagementQuery='',taskManagementChosen='',taskManagementWorking=false,taskManagementMutation=null,taskManagementNeedsRefresh=false,taskManagementMessage='',taskManagementError=false;
  let memberManagementAccessEpoch=0,memberManagementEpoch=0,memberManagementTeams=[],memberManagementCanReview=false,memberManagementMode='business',memberManagementTeam='',memberManagementRows=[],memberManagementHasMore=false,memberManagementQuery='',memberManagementSelected=null,memberManagementWorking=false,memberManagementMutation=null,memberManagementNeedsRefresh=true,memberManagementOpened=false;
  let deviceUiEpoch=0,deviceLastEpoch=-1,deviceSnapshot=null,deviceAccount=null,deviceLocalIssue='',deviceAction=null,devicePollOperation=null,deviceSessionRead=null,devicePollTimer=null,deviceUiClosed=false;
  let replacementOwnEpoch=0,replacementAuthEpoch=0,replacementOwn=null,replacementCanRequest=false,replacementOwnLoaded=false,replacementOwnRead=null,replacementOwnMutation=null;
  let replacementReviewEpoch=0,replacementReviewAllowed=false,replacementReviewRows=[],replacementReviewSelected=null,replacementReviewWorking=false,replacementReviewMutation=null,replacementReviewOpened=false;
  let businessRoleAccessEpoch=0,businessRoleEpoch=0,businessRoleTeams=[],businessRoleTeam='',businessRoleRows=[],businessRoleHasMore=false,businessRoleQuery='',businessRoleSelected=null,businessRoleWorking=false,businessRoleMutation=null,businessRoleNeedsRefresh=true,businessRoleOpened=false;
  function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
  function message(id,text,error=false){const node=byId(id);node.textContent=text||'';node.classList.toggle('error',error);}
  const replacementWords={pending:'待审核',approved:'已获批，尚未激活',claimed:'已激活',rejected:'已拒绝',withdrawn:'已撤回',revoked:'批准已撤销',expired:'已过期',stale:'身份、绑定或授权已变化'};
  function replacementOwnApiReady(){return ['getDeviceReplacementStatus','requestDeviceReplacement','withdrawDeviceReplacement','activateDeviceReplacement'].every(name=>typeof api?.[name]==='function');}
  function replacementOwnEligible(){return !!deviceAccount&&!session&&!deviceLocalIssue&&['different_key','revoked'].includes(deviceSnapshot?.state);}
  function replacementOwnPending(){return !!replacementOwnMutation&&replacementOwnMutation.auth===replacementAuthEpoch&&replacementOwnMutation.actor===deviceAccount?.id;}
  function resetOwnReplacement(){replacementAuthEpoch++;replacementOwnEpoch++;replacementOwn=null;replacementCanRequest=false;replacementOwnLoaded=false;replacementOwnRead=null;byId('device-replacement-own-description').textContent='';message('device-replacement-message','');}
  function ownReplacementContext(){return {auth:replacementAuthEpoch,actor:deviceAccount?.id,device:deviceUiEpoch,main:deviceSnapshot?.epoch,read:replacementOwnEpoch};}
  function currentOwnReplacement(context){return context.auth===replacementAuthEpoch&&context.actor===deviceAccount?.id&&context.device===deviceUiEpoch&&context.main===deviceSnapshot?.epoch&&context.read===replacementOwnEpoch&&replacementOwnEligible();}
  function ownReplacementMatches(){return !!replacementOwn&&replacementOwn.newDevice?.keyFingerprint===deviceSnapshot?.localFingerprint&&replacementOwn.oldDevice?.id===deviceSnapshot?.device?.id&&replacementOwn.oldDevice?.revision===deviceSnapshot?.device?.revision&&replacementOwn.oldDevice?.status===deviceSnapshot?.device?.status;}
  function validReplacementView(value){return !!value&&typeof value.id==='string'&&typeof value.teamId==='string'&&typeof value.teamName==='string'&&typeof value.displayName==='string'&&['employee','administrator'].includes(value.targetKind)&&Object.hasOwn(replacementWords,value.status)&&Number.isSafeInteger(value.revision)&&value.revision>=1&&Number.isSafeInteger(value.expiresAt)&&value.oldDevice&&typeof value.oldDevice.id==='string'&&Number.isSafeInteger(value.oldDevice.revision)&&typeof value.oldDevice.keyFingerprint==='string'&&value.newDevice&&typeof value.newDevice.displayName==='string'&&/^[a-f0-9]{64}$/.test(value.newDevice.keyFingerprint);}
  function updateReplacementControls(){
    const visible=replacementOwnEligible(),ready=visible&&replacementOwnApiReady()&&replacementOwnLoaded,locked=busy||!!deviceAction||replacementOwnPending()||!!replacementOwnRead,canRequest=ready&&replacementCanRequest,canActivate=ready&&ownReplacementMatches()&&replacementOwn.status==='approved'&&replacementOwn.revision<Number.MAX_SAFE_INTEGER,canWithdraw=ready&&ownReplacementMatches()&&['pending','approved'].includes(replacementOwn.status)&&replacementOwn.revision<Number.MAX_SAFE_INTEGER;
    byId('device-replacement-own').hidden=!visible;byId('device-replacement-refresh').disabled=!visible||!replacementOwnApiReady()||locked;byId('device-replacement-withdraw').hidden=!canWithdraw;byId('device-replacement-withdraw').disabled=!canWithdraw||locked;
    byId('device-replacement-request').hidden=!canRequest;byId('device-replacement-activate').hidden=!canActivate;byId('device-replacement-request').disabled=!canRequest||locked||!byId('device-enroll-consent').checked||!byId('device-name').value.trim()||!byId('password').value;byId('device-replacement-activate').disabled=!canActivate||locked||!byId('device-enroll-consent').checked;
    if(!visible){byId('device-consent-text').textContent='我已核对账号，确认首次绑定这台电脑。以后换机需审批。';return;}
    byId('device-replacement-own-status').textContent=!replacementOwnApiReady()?'当前客户端换机接口尚未就绪，请更新客户端。':!replacementOwnLoaded?'请读取本人换机申请后继续。':replacementOwn?'本次申请：'+replacementWords[replacementOwn.status]:'本人当前没有换机申请。';
    byId('device-replacement-own-description').textContent=replacementOwn?'申请编号 '+replacementOwn.id+' · 有效至 '+new Date(replacementOwn.expiresAt).toLocaleString('zh-CN')+'\n申请电脑：'+replacementOwn.newDevice.displayName+' · 指纹 '+replacementOwn.newDevice.keyFingerprint+(ownReplacementMatches()?'':'\n该申请与当前电脑不匹配，不能撤回或激活。'):'';
    byId('device-enrollment-fields').hidden=!canRequest&&!canActivate;byId('device-name').disabled=!canRequest||locked;byId('device-name').required=canRequest;byId('device-enroll-consent').disabled=(!canRequest&&!canActivate)||locked;byId('device-enroll-consent').required=canRequest||canActivate;byId('ordinary-password-fields').hidden=!canRequest;byId('password').required=canRequest;byId('password').maxLength=512;byId('password').disabled=!canRequest||locked;byId('password-label').textContent='重新输入当前账号密码';byId('password').placeholder='输入当前密码验证本人并提交申请';byId('device-consent-text').textContent=canActivate?'我已核对申请编号和本机指纹，确认激活此电脑并收回旧电脑绑定和旧登录。':'我已核对账号和本机指纹，确认申请更换到当前电脑；批准后仍须本人明确激活。';
    if(canActivate)byId('device-name').value=replacementOwn.newDevice.displayName;
  }
  async function loadOwnReplacement(){
    if(!replacementOwnEligible()||!replacementOwnApiReady()||replacementOwnPending()||deviceAction&&deviceAction.kind!=='login')return;const read={...ownReplacementContext(),read:++replacementOwnEpoch};replacementOwnRead=read;replacementOwnLoaded=false;replacementCanRequest=false;byId('password').value='';byId('device-enroll-consent').checked=false;updateIdentityControls();
    try{const result=await api.getDeviceReplacementStatus();if(!currentOwnReplacement(read)||replacementOwnRead!==read)return;if(!result?.ok)throw result?.error||{code:'INVALID_RESPONSE'};const value=result.value;if(typeof value?.canRequest!=='boolean'||value.request!==null&&!validReplacementView(value.request))throw {code:'INVALID_RESPONSE'};replacementOwn=value.request;replacementCanRequest=value.canRequest;replacementOwnLoaded=true;message('device-replacement-message',value.request?.status==='approved'?'申请已获批。请核对本机指纹并重新勾选确认，系统不会自动激活。':'本人申请状态已刷新。');}
    catch(error){if(currentOwnReplacement(read)){if(error.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message','登录已失效，请重新登录本人账号。',true);}else message('device-replacement-message',error.message||'本人换机申请无法确认，请手动刷新。',true);}}
    finally{if(replacementOwnRead===read)replacementOwnRead=null;updateIdentityControls();}
  }
  async function mutateOwnReplacement(kind){
    if(!replacementOwnEligible()||!replacementOwnApiReady()||!replacementOwnLoaded||deviceAction||replacementOwnPending()||replacementOwnRead)return;const item=replacementOwn,displayName=byId('device-name').value.trim(),currentPassword=byId('password').value,confirmed=byId('device-enroll-consent').checked;
    if(kind==='request'&&(!replacementCanRequest||!confirmed||!displayName||[...displayName].length>80||/[\p{Cc}\p{Cf}]/u.test(displayName)||!currentPassword||new TextEncoder().encode(currentPassword).length>512)||kind!=='request'&&(!ownReplacementMatches()||!item||item.revision>=Number.MAX_SAFE_INTEGER||!(kind==='withdraw'?['pending','approved']:['approved']).includes(item.status)||kind==='activate'&&!confirmed))return;
    const action=beginDeviceAction('replacement-'+kind),context=ownReplacementContext(),operation={...context};replacementOwnMutation=operation;replacementOwnEpoch++;context.read=replacementOwnEpoch;byId('password').value='';byId('device-enroll-consent').checked=false;updateIdentityControls();message('device-replacement-message',kind==='activate'?'正在验证本机并激活获批设备…':'正在提交本次换机操作…');let completed=false;
    try{const input=kind==='request'?{displayName,currentPassword,confirmed:true}:{requestId:item.id,revision:item.revision,...(kind==='activate'?{confirmed:true}:{})},result=await api[{request:'requestDeviceReplacement',withdraw:'withdrawDeviceReplacement',activate:'activateDeviceReplacement'}[kind]](input);if(!currentDeviceAction(action)||!currentOwnReplacement(context))return;if(!result?.ok)throw result?.error||{code:'INVALID_RESPONSE'};completed=true;if(kind==='activate'){message('login-message','');await acceptAuthenticatedSession(result.value);return;}if(!validReplacementView(result.value?.request))throw {code:'INVALID_RESPONSE'};replacementOwn=result.value.request;replacementCanRequest=false;replacementOwnLoaded=true;message('device-replacement-message',kind==='request'?'换机申请已提交，当前电脑尚未获准进入。请联系相应审核人核对申请编号。':'本次换机申请已撤回，旧电脑绑定未因此改变。');}
    catch(error){if(currentDeviceAction(action)&&currentOwnReplacement(context)){replacementOwnLoaded=false;replacementCanRequest=false;if(error.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message','登录已失效，请重新登录本人账号后刷新核对。',true);}else message('device-replacement-message',completed?'操作已完成，但结果展示无法确认，请刷新本人申请核对。':error.code==='OPERATION_UNCONFIRMED'||passwordChangeUncertain(error)?'未能确认换机操作结果；请求可能已完成，请重新登录或刷新本人申请核对，系统不会自动重试。':error.message||'换机操作未通过，请刷新本人申请核对。',true);}}
    finally{if(replacementOwnMutation===operation)replacementOwnMutation=null;if(currentDeviceAction(action)){deviceAction=null;updateIdentityControls();void pollDeviceStatus();}}
  }
  function replacementReviewApiReady(){return ['getDeviceReplacementReviewAccess','listDeviceReplacementReviews','reviewDeviceReplacement'].every(name=>typeof api?.[name]==='function');}
  function replacementReviewReady(){return !!session&&session.device?.required===true&&session.device.state==='ready'&&deviceSnapshot?.state==='ready';}
  function replacementReviewPending(){return !!replacementReviewMutation&&sameAccountSessionsActor(replacementReviewMutation.actor);}
  function replacementReviewContext(){return {actor:accountSessionsActor(),at:replacementReviewEpoch,device:deviceUiEpoch,main:session?.device?.epoch};}
  function currentReplacementReview(context){return sameAccountSessionsActor(context.actor)&&context.at===replacementReviewEpoch&&context.device===deviceUiEpoch&&context.main===session?.device?.epoch&&replacementReviewReady()&&replacementReviewAllowed&&byId('device-replacement-reviews-panel').open&&!byId('device-replacement-reviews-panel').hidden;}
  function clearReplacementReviewSelection(){replacementReviewSelected=null;byId('device-replacement-reviews-password').value='';byId('device-replacement-reviews-target').textContent='尚未选择换机申请。';}
  function resetReplacementReviews(close=true,hide=true){replacementReviewEpoch++;replacementReviewWorking=false;replacementReviewRows=[];clearReplacementReviewSelection();byId('device-replacement-reviews-list').replaceChildren();message('device-replacement-reviews-message','');if(hide){replacementReviewAllowed=false;byId('device-replacement-reviews-panel').hidden=true;}if(close){replacementReviewOpened=false;byId('device-replacement-reviews-panel').open=false;}updateReplacementReviewControls();}
  function replacementReviewSelectable(item){return !!item&&['pending','approved'].includes(item.status)&&Number.isSafeInteger(item.revision)&&item.revision>=1&&item.revision<Number.MAX_SAFE_INTEGER;}
  function updateReplacementReviewControls(){
    const ready=replacementReviewReady()&&replacementReviewAllowed&&replacementReviewApiReady()&&byId('device-replacement-reviews-panel').open&&!byId('device-replacement-reviews-panel').hidden,locked=busy||replacementReviewWorking||replacementReviewPending(),target=ready&&!locked&&replacementReviewRows.includes(replacementReviewSelected)&&replacementReviewSelectable(replacementReviewSelected);
    byId('device-replacement-reviews-refresh').disabled=!ready||locked;for(const button of byId('device-replacement-reviews-list').querySelectorAll('button'))button.disabled=!ready||locked||button.dataset.selectable!=='true';byId('device-replacement-reviews-password').disabled=!target;for(const decision of ['approve','reject','revoke'])byId('device-replacement-reviews-'+decision).disabled=!target||!byId('device-replacement-reviews-password').value||!(decision==='revoke'?replacementReviewSelected.status==='approved':replacementReviewSelected.status==='pending');
  }
  function renderReplacementReviews(){
    const list=byId('device-replacement-reviews-list');list.replaceChildren();if(!replacementReviewRows.length)list.append(el('li','当前没有可显示的换机申请。','identity-note'));
    for(const item of replacementReviewRows){const row=el('li'),description=el('div');row.dataset.requestId=item.id;description.append(el('strong',item.displayName+' · '+item.teamName+' · '+(item.targetKind==='administrator'?'团队管理员':'团队员工')),el('small','申请编号 '+item.id+' · '+replacementWords[item.status]+' · 有效至 '+new Date(item.expiresAt).toLocaleString('zh-CN')),el('small','旧电脑：'+item.oldDevice.displayName+' · '+item.oldDevice.keyFingerprint),el('small','申请电脑：'+item.newDevice.displayName+' · '+item.newDevice.keyFingerprint));const choose=el('button',replacementReviewSelected===item?'已选择此申请':'选择核对申请','button');choose.type='button';choose.dataset.selectable=String(replacementReviewSelectable(item));choose.addEventListener('click',()=>{if(busy||replacementReviewWorking||replacementReviewPending()||!replacementReviewReady()||!byId('device-replacement-reviews-panel').open||!replacementReviewRows.includes(item)||!replacementReviewSelectable(item))return;clearReplacementReviewSelection();replacementReviewSelected=item;byId('device-replacement-reviews-target').textContent='拟审核：'+item.displayName+' · '+item.teamName+' · 申请 '+item.id+' · 新电脑 '+item.newDevice.displayName+' · 指纹 '+item.newDevice.keyFingerprint;renderReplacementReviews();});row.append(description,choose);list.append(row);}updateReplacementReviewControls();
  }
  async function replacementReviewCall(name,input,current){const result=await api[name](input);if(!current())throw {code:'STALE_DEVICE_REPLACEMENT_REVIEW'};if(!result?.ok){if(result?.error?.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message','审核登录已失效，请重新登录。',true);}throw result?.error||{code:'INVALID_RESPONSE'};}return result.value;}
  async function loadReplacementReviewAccess(){
    resetReplacementReviews();if(!replacementReviewReady()||!replacementReviewApiReady())return;const context=replacementReviewContext(),current=()=>sameAccountSessionsActor(context.actor)&&context.at===replacementReviewEpoch&&context.device===deviceUiEpoch&&replacementReviewReady();
    try{const value=await replacementReviewCall('getDeviceReplacementReviewAccess',undefined,current);if(!current()||value?.canReview!==true)return;replacementReviewAllowed=true;byId('device-replacement-reviews-panel').hidden=false;updateReplacementReviewControls();}catch{if(current())resetReplacementReviews();}
  }
  async function refreshReplacementReviewRows(context){const value=await replacementReviewCall('listDeviceReplacementReviews',undefined,()=>currentReplacementReview(context));if(!Array.isArray(value?.requests)||value.requests.length>50||typeof value.hasMore!=='boolean'||!value.requests.every(validReplacementView)||new Set(value.requests.map(item=>item.id)).size!==value.requests.length)throw {code:'INVALID_RESPONSE'};replacementReviewRows=value.requests;clearReplacementReviewSelection();renderReplacementReviews();return value.hasMore;}
  async function loadReplacementReviews(){
    if(!replacementReviewReady()||!replacementReviewAllowed||!replacementReviewApiReady()||busy||replacementReviewWorking||replacementReviewPending()||!byId('device-replacement-reviews-panel').open)return;replacementReviewEpoch++;const context=replacementReviewContext();replacementReviewWorking=true;replacementReviewRows=[];clearReplacementReviewSelection();renderReplacementReviews();message('device-replacement-reviews-message','正在读取当前授权范围内的换机申请…');
    try{const more=await refreshReplacementReviewRows(context);if(currentReplacementReview(context))message('device-replacement-reviews-message',more?'仅显示最近50条有权查看的申请，请先处理或稍后刷新核对。':'请核对申请人、申请编号及新电脑指纹，再选择申请并填写当前密码。');}
    catch(error){if(currentReplacementReview(context)){replacementReviewRows=[];clearReplacementReviewSelection();renderReplacementReviews();message('device-replacement-reviews-message',error.message||'换机申请无法确认，请刷新核对。',true);}}
    finally{if(currentReplacementReview(context)){replacementReviewWorking=false;updateReplacementReviewControls();}}
  }
  async function decideReplacementReview(decision){
    const item=replacementReviewSelected,currentPassword=byId('device-replacement-reviews-password').value;if(!replacementReviewReady()||!replacementReviewAllowed||!replacementReviewApiReady()||!byId('device-replacement-reviews-panel').open||busy||replacementReviewWorking||replacementReviewPending()||!replacementReviewRows.includes(item)||!replacementReviewSelectable(item)||!currentPassword||!(decision==='revoke'?item.status==='approved':item.status==='pending')||!['approve','reject','revoke'].includes(decision))return;
    const context=replacementReviewContext(),operation={actor:context.actor};replacementReviewMutation=operation;byId('device-replacement-reviews-password').value='';updateReplacementReviewControls();message('device-replacement-reviews-message','正在验证当前密码并提交本次审核…');let completed=false;
    try{const value=await replacementReviewCall('reviewDeviceReplacement',{requestId:item.id,revision:item.revision,decision,currentPassword},()=>currentReplacementReview(context));completed=true;if(!validReplacementView(value?.request))throw {code:'INVALID_RESPONSE'};await refreshReplacementReviewRows(context);if(currentReplacementReview(context))message('device-replacement-reviews-message',decision==='approve'?'申请已批准，旧电脑尚未被替换。本人仍须在获批电脑上明确激活。':decision==='reject'?'申请已拒绝，旧电脑绑定未因此改变。':'未激活的换机批准已撤销，旧电脑绑定未因此改变。');}
    catch(error){if(currentReplacementReview(context)){replacementReviewRows=[];clearReplacementReviewSelection();renderReplacementReviews();message('device-replacement-reviews-message',completed?'审核已完成，但列表刷新无法确认，请刷新核对。':error.code==='OPERATION_UNCONFIRMED'||passwordChangeUncertain(error)?'未能确认审核结果；请求可能已完成，请刷新换机申请核对，系统不会自动重试。':error.message||'审核未通过，请刷新申请后核对。',true);}}
    finally{if(replacementReviewMutation===operation)replacementReviewMutation=null;if(sameAccountSessionsActor(context.actor)){byId('device-replacement-reviews-password').value='';updateReplacementReviewControls();if(context.at!==replacementReviewEpoch&&byId('device-replacement-reviews-panel').open)void loadReplacementReviews();}}
  }
  function closeReplacementReviews(){const pending=replacementReviewPending();replacementReviewOpened=false;resetReplacementReviews(false,false);if(pending&&session)message('workspace-message','已清除审核输入；已提交的审核仍可能完成，请刷新换机申请核对。');}
  byId('device-replacement-reviews-panel').querySelector('summary').addEventListener('click',()=>{if(byId('device-replacement-reviews-panel').open)closeReplacementReviews();else replacementReviewOpened=true;});
  byId('device-replacement-reviews-panel').addEventListener('toggle',()=>{if(byId('device-replacement-reviews-panel').open&&!byId('device-replacement-reviews-panel').hidden&&replacementReviewReady()){replacementReviewOpened=true;if(replacementReviewPending())message('device-replacement-reviews-message','换机审核仍在处理中；请稍候刷新核对。');else void loadReplacementReviews();updateReplacementReviewControls();}else if(replacementReviewOpened)closeReplacementReviews();});
  byId('device-replacement-reviews-password').addEventListener('input',updateReplacementReviewControls);byId('device-replacement-reviews-password').addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});byId('device-replacement-reviews-refresh').addEventListener('click',()=>void loadReplacementReviews());for(const decision of ['approve','reject','revoke'])byId('device-replacement-reviews-'+decision).addEventListener('click',()=>void decideReplacementReview(decision));
  byId('device-replacement-refresh').addEventListener('click',()=>void loadOwnReplacement());for(const kind of ['request','withdraw','activate'])byId('device-replacement-'+kind).addEventListener('click',()=>void mutateOwnReplacement(kind));
  function deviceApiReady(){return ['getDeviceStatus','enrollDevice','reconnectDevice'].every(name=>typeof api?.[name]==='function');}
  function validDeviceSnapshot(value){
    if(!value||Object.keys(value).length!==6||!['required','state','epoch','device','localFingerprint','expiresAt'].every(key=>Object.hasOwn(value,key))||typeof value.required!=='boolean'||!Number.isSafeInteger(value.epoch)||value.epoch<0||!['signed_out','enrollment_required','different_key','revoked','ready','paused','vault_unavailable',...(value.required?[]:['diagnostic'])].includes(value.state)||value.localFingerprint!==null&&!/^[a-f0-9]{64}$/.test(value.localFingerprint)||value.expiresAt!==null&&(!Number.isSafeInteger(value.expiresAt)||value.expiresAt<0))return false;
    if(value.device!==null&&(!value.device||typeof value.device.id!=='string'||typeof value.device.displayName!=='string'||!['win32','darwin'].includes(value.device.platform)||!/^[a-f0-9]{64}$/.test(value.device.keyFingerprint)||!['active','revoked'].includes(value.device.status)||!Number.isSafeInteger(value.device.revision)||value.device.revision<1))return false;
    return value.state!=='ready'||value.required&&value.device?.status==='active'&&value.device.keyFingerprint===value.localFingerprint&&value.expiresAt!==null;
  }
  function deviceBusinessReady(value=deviceSnapshot){return !!value&&(value.required?value.state==='ready':value.state==='diagnostic');}
  function deviceGateActive(){return !!deviceLocalIssue||!!deviceSnapshot&&deviceSnapshot.required&&!['signed_out','ready'].includes(deviceSnapshot.state);}
  function resetDevicePresentation(){resetOwnReplacement();resetReplacementReviews();deviceUiEpoch++;deviceSnapshot=null;deviceAccount=null;deviceLocalIssue='';deviceAction=null;devicePollOperation=null;deviceSessionRead=null;byId('password').value='';byId('device-name').value='';byId('device-enroll-consent').checked=false;}
  function deviceGateWords(){if(deviceLocalIssue)return deviceLocalIssue;return {enrollment_required:'账号尚未绑定电脑。请核对账号与本机指纹，再重新输入当前密码确认首次绑定。',different_key:'此账号已绑定其他设备，当前电脑不能进入。员工换机请联系团队管理员；团队管理员本人请联系产品负责人。',revoked:'此账号的设备绑定已撤销，不能重新首次绑定。员工换机请联系团队管理员；团队管理员本人请联系产品负责人。',paused:'与团队服务的连接尚未通过核验，业务已暂停。联网后请重新连接并核验；若刚提交过操作，请恢复后手动核对，系统不会自动重试。',vault_unavailable:'系统安全存储暂不可用，无法核验当前电脑。请重试或退出。'}[deviceSnapshot?.state]||'正在核验当前电脑，请稍候。';}
  function updateDeviceControls(){
    const active=deviceGateActive(),enrolling=active&&!deviceLocalIssue&&deviceSnapshot?.state==='enrollment_required',working=!!deviceAction;
    byId('login-view').classList.toggle('device-active',active);byId('device-gate').hidden=!active;byId('device-actions').hidden=!active;byId('device-enrollment-fields').hidden=!enrolling;byId('ordinary-username-fields').hidden=active;byId('username').required=!active;
    byId('login-mode-label').hidden=active;byId('login-mode').hidden=active;byId('ordinary-password-fields').hidden=active&&!enrolling;byId('password').required=!active||enrolling;byId('password').maxLength=enrolling?512:1024;byId('password-label').textContent=enrolling?'重新输入当前账号密码':'密码';byId('password').placeholder=enrolling?'输入当前密码确认绑定这台电脑':'输入密码';byId('login-submit').hidden=active;byId('device-bind-confirm').hidden=!enrolling;
    byId('login-form-title').textContent=active?(enrolling?'确认绑定当前电脑':'设备与连接核验'):'登录团队账号';byId('login-form-caption').textContent=active?'通过在线设备核验后才能进入团队工作空间':'当前连接本机团队服务';
    byId('device-account').textContent=deviceAccount?'当前账号：'+deviceAccount.displayName:'当前账号身份待核对。';byId('device-fingerprint').textContent=deviceSnapshot?.localFingerprint?'本机指纹：'+deviceSnapshot.localFingerprint:'';byId('device-gate-message').textContent=deviceGateWords();
    for(const id of ['device-name','device-enroll-consent'])byId(id).disabled=!enrolling||busy||working;byId('device-name').required=enrolling;byId('device-enroll-consent').required=enrolling;
    if(active){byId('ordinary-login-fields').hidden=false;byId('username').disabled=true;byId('login-mode').disabled=true;byId('login-submit').disabled=true;byId('wechat-login').disabled=true;byId('password').disabled=!enrolling||busy||working;}
    byId('device-bind-confirm').disabled=!enrolling||busy||working||!byId('device-enroll-consent').checked||!byId('device-name').value.trim()||!byId('password').value;
    byId('device-retry').hidden=!deviceLocalIssue&&!['paused','vault_unavailable'].includes(deviceSnapshot?.state);byId('device-retry').disabled=working;byId('device-exit').disabled=deviceAction?.kind==='exit';
    updateReplacementControls();
  }
  function deviceAccountView(value){return value?.account&&typeof value.account.id==='string'&&typeof value.account.displayName==='string'?{id:value.account.id,displayName:value.account.displayName}:null;}
  function suspendDeviceView(text=''){
    resetReplacementReviews();
    if(session&&!deviceAccount)deviceAccount=deviceAccountView(session);if(text)deviceLocalIssue=text;showLogin({keepDevice:true});byId('password').value='';byId('device-enroll-consent').checked=false;updateIdentityControls();
  }
  async function acceptAuthenticatedSession(value){
    const account=deviceAccountView(value),state=value?.device;
    if(!deviceApiReady()||!account||!Array.isArray(value.memberships)||!validDeviceSnapshot(state)||state.epoch<deviceLastEpoch||!deviceBusinessReady(state)&&value.memberships.length){deviceLastEpoch=Math.max(deviceLastEpoch,validDeviceSnapshot(state)?state.epoch:0);deviceAccount=account;deviceLocalIssue='登录返回的设备状态无法核验，请更新客户端后重试。';suspendDeviceView();return false;}
    const changed=!deviceAccount||deviceAccount.id!==account.id||deviceSnapshot?.epoch!==state.epoch;deviceAccount=account;deviceSnapshot=state;deviceLastEpoch=state.epoch;deviceLocalIssue='';
    if(deviceBusinessReady(state)){await enter(value);return true;}
    if(changed){resetOwnReplacement();byId('device-name').value='我的电脑';byId('device-enroll-consent').checked=false;}suspendDeviceView();if(replacementOwnEligible())void loadOwnReplacement();return false;
  }
  async function applyDeviceSnapshot(state,at){
    if(at!==deviceUiEpoch||wechatActive()||!validDeviceSnapshot(state)||state.epoch<deviceLastEpoch||deviceLocalIssue&&state.epoch<=deviceLastEpoch)return;
    // A local ready snapshot cannot deliver a pending/canceled authentication.
    // Only an explicit auth result may establish the account later resumed here.
    if(state.state!=='signed_out'&&state.state!=='diagnostic'&&!session&&!deviceAccount)return;
    const previous=deviceSnapshot,hadIdentity=!!session||!!deviceAccount;deviceSnapshot=state;deviceLastEpoch=state.epoch;deviceLocalIssue='';
    if(state.state==='signed_out'){if(hadIdentity){showLogin();deviceSnapshot=state;message('login-message','登录已失效，可能已在其他实例重新登录。请重新登录。',true);}updateIdentityControls();return;}
    if(!state.required&&state.state==='diagnostic'){updateIdentityControls();return;}
    if(deviceBusinessReady(state)&&session&&session.device?.epoch===state.epoch){updateIdentityControls();return;}
    if(!deviceBusinessReady(state)&&session){deviceAccount=deviceAccountView(session);suspendDeviceView();}
    if(deviceBusinessReady(state)||!deviceAccount){
      if(typeof api?.getSession!=='function'){suspendDeviceView('当前客户端无法读取已核验会话，请更新后重试。');return;}
      if(deviceSessionRead?.at===at&&deviceSessionRead.epoch===state.epoch)return;const read={at,epoch:state.epoch};deviceSessionRead=read;
      try{const result=await api.getSession();if(deviceSessionRead!==read||at!==deviceUiEpoch||deviceSnapshot?.epoch!==state.epoch)return;
        if(!result?.ok){if(result?.error?.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message','登录已失效，请重新登录。',true);}else suspendDeviceView('当前设备会话无法核验，请重新连接后重试。');return;}
        if(result.value){if(result.value.device?.epoch<state.epoch)return;await acceptAuthenticatedSession(result.value);}else if(deviceBusinessReady(state))suspendDeviceView('当前设备会话无法核验，请重新登录。');
      }finally{if(deviceSessionRead===read)deviceSessionRead=null;}
    }else if(previous?.epoch!==state.epoch){byId('password').value='';byId('device-enroll-consent').checked=false;}
    updateIdentityControls();
  }
  async function pollDeviceStatus(){
    if(deviceUiClosed||deviceAction||wechatActive()||devicePollOperation)return;if(!deviceApiReady()){suspendDeviceView('当前客户端设备接口未更新，请更新客户端后重试。');return;}const operation={at:deviceUiEpoch};devicePollOperation=operation;
    try{const result=await api.getDeviceStatus();if(devicePollOperation!==operation||operation.at!==deviceUiEpoch)return;if(!result?.ok||!validDeviceSnapshot(result.value)){suspendDeviceView('当前设备状态无法核验，请更新客户端或重新连接后重试。');return;}void applyDeviceSnapshot(result.value,operation.at).catch(()=>{if(operation.at===deviceUiEpoch&&deviceSnapshot?.epoch===result.value.epoch)suspendDeviceView('当前设备会话无法核验，请重新连接后重试。');});}
    catch{if(devicePollOperation===operation&&operation.at===deviceUiEpoch)suspendDeviceView('当前设备状态无法核验，请重新连接后重试。');}
    finally{if(devicePollOperation===operation)devicePollOperation=null;}
  }
  function beginDeviceAction(kind){const operation={kind,at:++deviceUiEpoch};deviceAction=operation;devicePollOperation=null;return operation;}
  const currentDeviceAction=operation=>deviceAction===operation&&operation.at===deviceUiEpoch;
  async function enrollCurrentDevice(){
    if(deviceAction||!deviceApiReady()||deviceSnapshot?.state!=='enrollment_required'||deviceLocalIssue)return;const displayName=byId('device-name').value.trim(),currentPassword=byId('password').value,confirmed=byId('device-enroll-consent').checked;
    if(!confirmed||!displayName||[...displayName].length>80||/[\p{Cc}\p{Cf}]/u.test(displayName)||!currentPassword||new TextEncoder().encode(currentPassword).length>512){byId('password').value='';message('login-message','请核对电脑名称、勾选首次绑定确认，并重新输入当前密码（不超过512字节）。',true);updateIdentityControls();return;}
    const operation=beginDeviceAction('enroll');byId('password').value='';setBusy(true);const owner=busyEpoch;message('login-message','正在验证密码并绑定当前电脑…');
    try{const result=await api.enrollDevice({displayName,currentPassword,confirmed:true});if(!currentDeviceAction(operation))return;if(!result?.ok)throw result?.error||{code:'INVALID_RESPONSE'};message('login-message','');await acceptAuthenticatedSession(result.value);}
    catch(error){if(currentDeviceAction(operation)){byId('device-enroll-consent').checked=false;if(error.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message','登录已失效，请重新登录。',true);}else{message('login-message',passwordChangeUncertain(error)?'未能确认绑定结果；请求可能已完成，请重新核验设备状态，避免重复操作。':error.message||'绑定未完成，请重新核对设备状态。',true);}}}
    finally{if(currentDeviceAction(operation)){deviceAction=null;if(busyEpoch===owner)setBusy(false);updateIdentityControls();void pollDeviceStatus();}}
  }
  async function reconnectCurrentDevice(){
    if(deviceAction||!deviceApiReady())return;if(!deviceAccount){message('login-message','请先退出并重新登录，再核验当前电脑。',true);return;}const operation=beginDeviceAction('reconnect');byId('password').value='';byId('device-enroll-consent').checked=false;updateIdentityControls();message('login-message','正在重新连接并核验设备…');
    try{const result=await api.reconnectDevice();if(!currentDeviceAction(operation))return;if(!result?.ok)throw result?.error||{code:'INVALID_RESPONSE'};message('login-message','');await acceptAuthenticatedSession(result.value);}
    catch(error){if(currentDeviceAction(operation)){if(error.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message','登录已失效，请重新登录。',true);}else message('login-message',error.message||'连接尚未恢复，业务仍暂停。',true);}}
    finally{if(currentDeviceAction(operation)){deviceAction=null;updateIdentityControls();void pollDeviceStatus();}}
  }
  async function exitDeviceSession(){
    if(deviceAction?.kind==='exit')return;showLogin();const operation=beginDeviceAction('exit');setBusy(true);message('login-message','正在退出账号…');
    try{const result=await api.logout();if(!currentDeviceAction(operation))return;if(!result?.ok)throw result?.error||{};showLogin();message('login-message','已退出，当前窗口中的账号和任务资料已清除。');}
    catch(error){if(currentDeviceAction(operation)){showLogin();message('login-message',error.message||'本窗口已退出，请重新登录核对。',true);}}
  }
  function wechatActive(){return ['starting','pending','binding_required','linking'].includes(wechatState);}
  function updateIdentityControls(){const active=wechatActive(),ready=methodsReady&&methods.wechat&&desktopWechatReady;byId('ordinary-login-fields').hidden=active;byId('login-view').classList.toggle('wechat-active',active);for(const id of ['username','password','login-submit'])byId(id).disabled=busy||active;byId('wechat-login').disabled=busy||!ready||wechatActive();byId('wechat-login').textContent=!methods.wechat?'微信扫码登录 · 未开通':!desktopWechatReady?'微信扫码登录 · 桌面配置未就绪':'微信扫码登录';byId('wechat-message').textContent=!methods.wechat?'尚未配置微信登录，当前不能扫码授权。':!desktopWechatReady?'服务端已配置微信能力，桌面授权配置未就绪，当前不能发起授权。':'将在系统浏览器中授权；完成后请返回此窗口。首次关联需确认本人现有员工账号。';byId('wechat-progress').hidden=wechatState==='idle';byId('wechat-link-fields').hidden=!['binding_required','linking'].includes(wechatState);byId('wechat-link-fields').disabled=busy||wechatWorking||wechatState!=='binding_required';byId('wechat-link-submit').disabled=busy||wechatWorking||wechatState!=='binding_required';byId('wechat-cancel').hidden=!wechatActive();byId('wechat-cancel').disabled=!wechatActive();for(const option of byId('login-mode').options)option.disabled=option.value==='phone'?!methods.phonePassword:!methods.demoUsername;byId('phone-bind-fields').disabled=busy||!methods.phoneVerification;byId('send-bind-code').disabled=busy||!methods.phoneVerification;byId('bind-phone-submit').disabled=busy||!methods.phoneVerification||!challengeId||challengeExpiresAt<=Date.now();byId('bind-code').disabled=busy||!methods.phoneVerification||!challengeId;byId('bind-current-password').disabled=busy||!methods.phoneVerification||!challengeId;byId('phone-service-status').textContent=methods.phoneVerification?'短信服务已配置；仍需完成本次验证码和当前账号密码验证。':'短信验证尚未开通，当前不能绑定手机号。';updateDeviceControls();}
  function setBusy(value){busyEpoch++;busy=value;for(const node of document.querySelectorAll('button,input,select'))node.disabled=value;updateIdentityControls();updateOnboardingControls();updateAccountSessionsControls();updatePasswordChangeControls();updateFirstAdminControls();updateProvisioningControls();updateRecoveryControls();updateRecoveryReviewsControls();updateTaskManagementControls();updateTaskSubmissionControls();updateMemberManagementControls();updateReplacementReviewControls();updateBusinessRoleControls();updateDeviceControls();}
  function clearPhoneProof(clearPhone=true){challengeId='';challengeExpiresAt=0;challengePhone='';byId('bind-code').value='';byId('bind-current-password').value='';if(clearPhone)byId('bind-phone').value='';updateIdentityControls();}
  function resetWechat(notify=true){const active=wechatActive();wechatEpoch++;clearTimeout(wechatTimer);wechatTimer=null;wechatState='idle';wechatWorking=false;wechatExpiresAt=0;byId('wechat-link-phone').value='';byId('wechat-link-password').value='';message('wechat-status','');if(notify&&active&&typeof api?.cancelWechatLogin==='function')void Promise.resolve().then(()=>api.cancelWechatLogin()).catch(()=>{});updateIdentityControls();}
  function showLogin({keepDevice=false}={}){if(!keepDevice)resetDevicePresentation();accountIdentityEpoch++;resetBusinessRole();resetMemberManagement();taskUploadOperation=null;resetTaskSubmissionAccess();resetTaskManagement();resetRecovery(true,true);resetAccountSessions();resetPasswordChange();resetWechat();resetActivation(true,true);resetFirstAdmin(true,true);resetProvisioning();resetRecoveryReviews();resetInvitations();administrationTeams=[];invitationTeamId='';byId('invitation-team').replaceChildren();session=null;teamId='';tasks=[];selected=null;submissions=[];revision=0;hasMore=false;viewEpoch++;byId('workspace-view').hidden=true;byId('session-actions').hidden=true;byId('login-view').hidden=false;for(const id of ['username','password','search'])byId(id).value='';for(const id of ['account-name','role-label','task-count','workspace-message','phone-bind-message'])byId(id).textContent='';clearPhoneProof();byId('phone-bind-panel').open=false;byId('task-list').replaceChildren();byId('team-select').replaceChildren();byId('task-detail').replaceChildren();setBusy(false);}
  async function call(name,arg){if(!api)throw {code:'DESKTOP_REQUIRED',message:'请使用审易桌面客户端打开此页面。'};const actorAt=accountIdentityEpoch,deviceAt=deviceUiEpoch,result=await api[name](arg);if(actorAt!==accountIdentityEpoch||deviceAt!==deviceUiEpoch)throw {code:'STALE_RESPONSE'};if(!result?.ok){if(result?.error?.code==='SIGN_IN_REQUIRED')showLogin();throw result?.error||{message:'操作未完成，请重试。'};}return result.value;}
  async function loadIdentityMethods(){const at=++methodsEpoch;if(typeof api?.getAuthMethods!=='function'){methodsReady=false;desktopWechatReady=false;message('identity-methods-message','当前桌面身份接口未更新；仍可使用明确标注的合成演示账号。');updateIdentityControls();updateRecoveryControls();return;}try{const value=await call('getAuthMethods');if(at!==methodsEpoch)return;methods=value.methods;methodsReady=true;desktopWechatReady=value.desktopWechatReady===true&&['startWechatLogin','pollWechatLogin','cancelWechatLogin','linkWechatAccount'].every(name=>typeof api[name]==='function');message('identity-methods-message',methods.phonePassword?'正式方向：手机号＋密码。需先完成手机号验证绑定；合成演示账号保持独立。':'手机号登录尚未开放；合成演示账号不代表正式身份已验证。');}catch{if(at!==methodsEpoch)return;methodsReady=false;desktopWechatReady=false;message('identity-methods-message','身份服务状态暂不可读取，未启用手机号验证或微信扫码。',true);methods={demoUsername:true,phonePassword:false,phoneVerification:false,wechat:false,recovery:false};}if(!methodsReady||!methods.recovery)resetRecovery(false);updateIdentityControls();updateRecoveryControls();}
  async function wechatCall(name,arg,at){const result=await api[name](arg);if(at!==wechatEpoch)throw {code:'STALE_WECHAT'};if(!result?.ok){if(result?.error?.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message',result.error.message||'登录已失效，请重新登录。',true);}throw result?.error||{message:'微信授权暂时无法完成，请重新开始。'};}return result.value;}
  function terminalWechat(state,text,error=false){clearTimeout(wechatTimer);wechatTimer=null;wechatState=state;wechatWorking=false;byId('wechat-link-phone').value='';byId('wechat-link-password').value='';message('wechat-status',text,error);updateIdentityControls();}
  async function applyWechatResult(result,at){if(at!==wechatEpoch)return;if(result.status==='signed_in'){resetWechat(false);message('login-message','');await acceptAuthenticatedSession(result.session);return;}if(Number.isSafeInteger(result.expiresAt))wechatExpiresAt=result.expiresAt;if(wechatExpiresAt&&wechatExpiresAt<=Date.now()){terminalWechat('expired','本次微信授权已过期，请重新开始。',true);return;}if(result.status==='binding_required'){wechatState='binding_required';wechatWorking=false;message('wechat-status','微信授权已收到。请核对并确认关联本人现有员工账号。');updateIdentityControls();byId('wechat-link-phone').focus();return;}if(result.status==='pending'){wechatState='pending';wechatWorking=false;message('wechat-status','等待浏览器中的微信授权。可随时取消本次操作。');updateIdentityControls();wechatTimer=setTimeout(()=>void pollWechat(at),2000);return;}const words={expired:'本次微信授权已过期，请重新开始。',canceled:'本次微信授权已取消，可重新开始。',failed:'微信授权未完成，请重新开始。',idle:'当前没有待完成的微信授权，请重新开始。'};terminalWechat(Object.hasOwn(words,result.status)?result.status:'failed',words[result.status]||'微信授权状态无效，请重新开始。',result.status!=='canceled');}
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
  function passwordChangeApiReady(){return typeof api?.changeOwnPassword==='function';}
  function passwordChangePending(){return !!passwordChangeMutation&&sameAccountSessionsActor(passwordChangeMutation.actor);}
  function currentPasswordChangeView(at,actor){return at===passwordChangeEpoch&&sameAccountSessionsActor(actor)&&byId('password-change-panel').open;}
  function clearPasswordChangeInputs(){for(const id of ['password-change-current','password-change-new','password-change-confirm'])byId(id).value='';}
  function updatePasswordChangeControls(){
    const ready=!!session&&passwordChangeApiReady()&&byId('password-change-panel').open,locked=busy||passwordChangePending();
    for(const id of ['password-change-current','password-change-new','password-change-confirm'])byId(id).disabled=!ready||locked;
    byId('password-change-submit').disabled=!ready||locked||['password-change-current','password-change-new','password-change-confirm'].some(id=>!byId(id).value);
    // Clearing the local form does not promise to cancel an already submitted write.
    byId('password-change-clear').disabled=false;
  }
  function resetPasswordChange(close=true){
    passwordChangeEpoch++;clearPasswordChangeInputs();message('password-change-message','');
    if(!passwordChangePending())passwordChangeMutation=null;
    if(close)byId('password-change-panel').open=false;updatePasswordChangeControls();
  }
  function passwordChangeUncertain(error){return !error?.code||['SERVICE_UNAVAILABLE','INVALID_RESPONSE','OPERATION_FAILED'].includes(error.code)||(typeof error.code==='string'&&error.code.startsWith('HTTP_5'));}
  async function submitPasswordChange(event){
    event.preventDefault();if(!session||busy||passwordChangePending()||!passwordChangeApiReady()||!byId('password-change-panel').open)return;
    const currentPassword=byId('password-change-current').value,newPassword=byId('password-change-new').value,confirmation=byId('password-change-confirm').value;
    let invalid='';
    if(!currentPassword||!newPassword||!confirmation)invalid='请填写当前密码、新密码和确认新密码。';
    else if([...newPassword].length<12||[...newPassword].length>128)invalid='新密码需12至128个字符，请重新填写。';
    else if(newPassword!==confirmation)invalid='两次输入的新密码不一致，请重新填写。';
    if(invalid){clearPasswordChangeInputs();message('password-change-message',invalid,true);updatePasswordChangeControls();return;}
    const at=passwordChangeEpoch,actor=accountSessionsActor(),operation={actor};passwordChangeMutation=operation;updatePasswordChangeControls();message('password-change-message','正在验证当前密码并修改密码…');
    let failureMessage='',failureUncertain=false;
    try{
      const result=await api.changeOwnPassword({currentPassword,newPassword});
      // A prior login's 401 or success must not clear a newer account generation.
      if(!sameAccountSessionsActor(actor))return;
      if(!result?.ok){
        if(result?.error?.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message',result.error.message||'当前登录已失效，请重新登录。',true);return;}
        throw result?.error||{code:'INVALID_RESPONSE'};
      }
      if(result.value?.signedOut!==true)throw {code:'INVALID_RESPONSE'};
      // Even a closed panel must honor a confirmed password change for this login.
      showLogin();message('login-message','密码已修改，全部旧登录已退出，请使用新密码重新登录。');
    }catch(error){
      if(!sameAccountSessionsActor(actor))return;
      failureUncertain=passwordChangeUncertain(error);
      failureMessage=failureUncertain?'未能确认改密结果；已提交的请求可能已完成，可用新密码重新登录核对。':error.message||'改密请求未通过，请核对后重试。';
      if(currentPasswordChangeView(at,actor))message('password-change-message',failureMessage,true);
    }finally{
      if(passwordChangeMutation===operation)passwordChangeMutation=null;
      if(sameAccountSessionsActor(actor)){
        clearPasswordChangeInputs();updatePasswordChangeControls();
        if(at!==passwordChangeEpoch&&failureMessage){
          if(byId('password-change-panel').open)message('password-change-message',failureMessage,true);
          else message('workspace-message',failureMessage,failureUncertain);
        }
      }
    }
  }
  function closePasswordChange(close=true){const pending=passwordChangePending();resetPasswordChange(close);if(pending&&session)message('workspace-message','已清除改密输入；已提交的请求仍可能完成，可用新密码重新登录核对。');}
  byId('password-change-panel').querySelector('summary').addEventListener('click',()=>{if(byId('password-change-panel').open)closePasswordChange(false);});
  byId('password-change-panel').addEventListener('toggle',()=>{
    if(byId('password-change-panel').open){
      // Native opening is synchronous but toggle is queued: never erase new input.
      if(passwordChangePending())message('password-change-message','改密请求仍在处理中，请稍候核对。');
      else if(!passwordChangeApiReady())message('password-change-message','当前桌面改密接口尚未就绪，请更新后重试。',true);
      updatePasswordChangeControls();
    }else closePasswordChange(false);
  });
  for(const id of ['password-change-current','password-change-new','password-change-confirm'])byId(id).addEventListener('input',updatePasswordChangeControls);
  byId('password-change-form').addEventListener('submit',event=>void submitPasswordChange(event));
  byId('password-change-clear').addEventListener('click',()=>closePasswordChange());
  // Recovery always requires the server's independent authorization strategy.
  function recoveryApiReady(){return ['requestPasswordRecovery','recoverPassword'].every(name=>typeof api?.[name]==='function');}
  function recoveryPending(){return !!recoveryMutation;}
  function clearRecoverySecrets(){for(const id of ['recovery-code','recovery-proof','recovery-new','recovery-confirm'])byId(id).value='';}
  function updateRecoveryControls(){
    const ready=!!api&&recoveryApiReady()&&methodsReady&&methods.recovery&&!session&&byId('recovery-panel').open,locked=busy||recoveryWorking||recoveryPending()||!!recoveryRequest||!!recoveryReviewSubmission,valid=!!recoveryChallenge&&recoveryChallenge.expiresAt>Date.now();
    byId('recovery-phone').disabled=!ready||locked;byId('recovery-send-code').disabled=!ready||locked;
    byId('recovery-fields').hidden=!recoveryChallenge;byId('recovery-fields').disabled=!ready||locked||!valid;
    for(const id of ['recovery-code','recovery-proof','recovery-new','recovery-confirm'])byId(id).disabled=!ready||locked||!valid;
    byId('recovery-submit').disabled=!ready||locked||!valid||['recovery-code','recovery-proof','recovery-new','recovery-confirm'].some(id=>!byId(id).value);
    byId('recovery-review-entry').hidden=!recoveryReviewMode;
    byId('recovery-review-request').disabled=!ready||locked||!valid||!recoveryReviewAvailable||typeof api?.createRecoveryReviewRequest!=='function'||!/^\d{6}$/.test(byId('recovery-code').value)||!!recoveryReviewReceipt;
    byId('recovery-cancel').disabled=false;
    byId('recovery-status').textContent=!recoveryApiReady()?'当前桌面账号恢复接口尚未就绪。':!methodsReady?'账号恢复服务状态暂未确认，当前不能重设密码。':!methods.recovery?'账号恢复服务尚未开通；须同时具备短信验证与独立恢复授权，当前不能重设密码。':'账号恢复服务已配置；仍须本人短信验证和独立恢复授权凭据，短信单独不能重设密码。';
  }
  function resetRecovery(clearPhone=true,close=false){
    recoveryEpoch++;recoveryWorking=false;recoveryChallenge=null;recoveryReviewReceipt=null;byId('recovery-review-receipt').textContent='';clearRecoverySecrets();if(clearPhone)byId('recovery-phone').value='';message('recovery-message','');if(close)byId('recovery-panel').open=false;
    byId('login-view').classList.toggle('recovery-active',byId('recovery-panel').open);updateRecoveryControls();
  }
  function closeRecovery(close=false){const submitted=recoveryPending(),sending=!!recoveryRequest,reviewing=!!recoveryReviewSubmission;resetRecovery(true,close);if(!session&&submitted)message('login-message','已清除恢复输入；已提交的重设请求仍可能完成，请用新密码登录核对。');else if(!session&&sending)message('login-message','已清除恢复输入；验证码发送请求仍可能完成，尚未重设密码。');else if(!session&&reviewing)message('login-message','已清除恢复输入；审核申请仍可能已提交，请向管理员核对，密码尚未重设。');}
  function sameRecoveryActor(actorEpoch){return actorEpoch===accountIdentityEpoch&&!session;}
  function currentRecoveryView(at,actorEpoch){return at===recoveryEpoch&&sameRecoveryActor(actorEpoch)&&byId('recovery-panel').open;}
  async function requestRecoveryCode(){
    if(busy||session||recoveryWorking||recoveryPending()||recoveryRequest||recoveryReviewSubmission||!recoveryApiReady()||!methodsReady||!methods.recovery||!byId('recovery-panel').open)return;
    const phone=byId('recovery-phone').value;if(!phone.trim()){message('recovery-message','请填写本人已绑定的手机号。',true);return;}
    resetRecovery(false);const at=recoveryEpoch,actorEpoch=accountIdentityEpoch,operation={at,actorEpoch};recoveryRequest=operation;recoveryWorking=true;updateRecoveryControls();message('recovery-message','正在请求账号恢复验证码…');
    try{const result=await api.requestPasswordRecovery({phone});if(!currentRecoveryView(at,actorEpoch))return;if(!result?.ok)throw result?.error||{code:'INVALID_RESPONSE'};recoveryChallenge=result.value;message('recovery-message','验证码发送请求已完成。请填写收到的验证码、独立恢复授权凭据及新密码。');}
    catch(error){if(currentRecoveryView(at,actorEpoch))message('recovery-message',error.message||'恢复验证码请求未完成，请核对后重试。',true);}
    finally{if(recoveryRequest===operation)recoveryRequest=null;if(sameRecoveryActor(actorEpoch))recoveryWorking=false;updateRecoveryControls();}
  }
  async function submitRecovery(event){
    event.preventDefault();if(busy||session||recoveryWorking||recoveryPending()||recoveryRequest||recoveryReviewSubmission||!recoveryApiReady()||!methodsReady||!methods.recovery||!byId('recovery-panel').open||!recoveryChallenge)return;
    if(recoveryChallenge.expiresAt<=Date.now()){resetRecovery(false);message('recovery-message','本次恢复验证已过期，请重新获取验证码。',true);return;}
    const newPassword=byId('recovery-new').value,confirmation=byId('recovery-confirm').value,recoveryProof=byId('recovery-proof').value,code=byId('recovery-code').value;let invalid='';
    if(!/^\d{6}$/.test(code)||!recoveryProof||!newPassword||!confirmation)invalid='请填写6位验证码、独立恢复授权凭据和两次新密码。';
    else if([...newPassword].length<12||[...newPassword].length>128)invalid='新密码需12至128个字符，请重新填写。';
    else if(newPassword!==confirmation)invalid='两次新密码不一致，请重新填写。';
    if(invalid){clearRecoverySecrets();message('recovery-message',invalid,true);updateRecoveryControls();return;}
    const at=recoveryEpoch,actorEpoch=accountIdentityEpoch,operation={at,actorEpoch};recoveryMutation=operation;updateRecoveryControls();message('recovery-message','正在验证本人身份和独立授权并重设密码…');
    let outcome='',uncertain=false;
    try{const result=await api.recoverPassword({challengeId:recoveryChallenge.challengeId,code,newPassword,recoveryProof});if(!sameRecoveryActor(actorEpoch))return;if(!result?.ok)throw result?.error||{code:'INVALID_RESPONSE'};if(result.value?.signedOut!==true)throw {code:'INVALID_RESPONSE'};
      outcome='密码已重设，全部旧登录已退出，请使用新密码重新登录。';resetRecovery(true);if(methods.phonePassword){byId('login-mode').value='phone';byId('username').placeholder='输入已验证绑定的手机号';byId('username').inputMode='tel';}message('login-message',outcome);if(byId('recovery-panel').open)message('recovery-message',outcome);
    }catch(error){if(!sameRecoveryActor(actorEpoch))return;uncertain=passwordChangeUncertain(error);outcome=uncertain?'未能确认重设结果；已提交的请求可能已完成，请用新密码登录核对。':error.message||'恢复验证未通过，请重新核对验证码和独立授权。';if(currentRecoveryView(at,actorEpoch))message('recovery-message',outcome,true);else if(byId('recovery-panel').open)message('recovery-message',outcome,true);else message('login-message',outcome,true);}
    finally{if(recoveryMutation===operation)recoveryMutation=null;if(sameRecoveryActor(actorEpoch))clearRecoverySecrets();updateRecoveryControls();}
  }
  byId('recovery-panel').querySelector('summary').addEventListener('click',()=>{if(byId('recovery-panel').open)closeRecovery();});
  byId('recovery-panel').addEventListener('toggle',()=>{if(byId('recovery-panel').open){resetActivation(true,true);resetFirstAdmin(true,true);resetWechat();byId('username').value='';byId('password').value='';byId('login-view').classList.add('recovery-active');void loadIdentityMethods();void loadRecoveryReviewStatus();updateRecoveryControls();if(recoveryPending())message('recovery-message','恢复请求仍在处理中，请稍候核对。');}else closeRecovery();});
  byId('recovery-phone').addEventListener('input',()=>{resetRecovery(false);message('recovery-message','手机号已改变，请重新获取恢复验证码。');});
  for(const id of ['recovery-code','recovery-proof','recovery-new','recovery-confirm'])byId(id).addEventListener('input',updateRecoveryControls);
  async function loadRecoveryReviewStatus(){
    const at=++recoveryReviewStatusEpoch,actorEpoch=accountIdentityEpoch;
    if(typeof api?.getRecoveryReviewStatus!=='function'){recoveryReviewMode=false;recoveryReviewAvailable=false;updateRecoveryControls();return;}
    try{const result=await api.getRecoveryReviewStatus();if(at!==recoveryReviewStatusEpoch||!sameRecoveryActor(actorEpoch))return;if(!result?.ok)throw result?.error||{};recoveryReviewMode=result.value.reviewed===true;recoveryReviewAvailable=result.value.available===true;message('recovery-review-status',recoveryReviewAvailable?'填写本次验证码后提交审核。员工由团队管理员审核，管理员本人由产品负责人审核。批准凭据须核实后转交。':'恢复审核尚未开通，当前不能提交审核申请。');}
    catch{if(at===recoveryReviewStatusEpoch&&sameRecoveryActor(actorEpoch)){recoveryReviewMode=true;recoveryReviewAvailable=false;message('recovery-review-status','恢复审核状态暂无法确认，当前不能提交审核申请。',true);}}
    finally{updateRecoveryControls();}
  }
  async function submitRecoveryReview(){
    if(busy||session||recoveryWorking||recoveryPending()||recoveryRequest||recoveryReviewSubmission||!recoveryReviewMode||!recoveryReviewAvailable||typeof api?.createRecoveryReviewRequest!=='function'||!methodsReady||!methods.recovery||!byId('recovery-panel').open||!recoveryChallenge||recoveryReviewReceipt)return;
    if(recoveryChallenge.expiresAt<=Date.now()){resetRecovery(false);message('recovery-message','本次恢复验证已过期，请重新获取验证码。',true);return;}
    const code=byId('recovery-code').value;if(!/^\d{6}$/.test(code)){message('recovery-message','请填写本次6位短信验证码后提交审核。',true);return;}
    const at=recoveryEpoch,actorEpoch=accountIdentityEpoch,operation={at,actorEpoch};recoveryReviewSubmission=operation;updateRecoveryControls();message('recovery-message','正在验证本次短信并提交恢复审核…');
    try{const result=await api.createRecoveryReviewRequest({challengeId:recoveryChallenge.challengeId,code});if(!currentRecoveryView(at,actorEpoch))return;if(!result?.ok)throw result?.error||{code:'INVALID_RESPONSE'};const value=result.value;if(typeof value?.requestId!=='string'||value.status!=='pending'||!Number.isSafeInteger(value.expiresAt))throw {code:'INVALID_RESPONSE'};recoveryReviewReceipt=value;byId('recovery-review-receipt').textContent='申请编号 '+value.requestId+' · 待审核 · 有效至 '+new Date(value.expiresAt).toLocaleString('zh-CN');message('recovery-message','已收到待审回执，密码尚未重设。请将申请编号交给相应审核人；获批后填写一次性恢复授权凭据。');}
    catch(error){if(currentRecoveryView(at,actorEpoch))message('recovery-message',passwordChangeUncertain(error)?'未能确认申请结果；请求可能已提交，请核对申请，避免重复操作。':error.message||'恢复申请未通过，请核对本次验证码。',true);}
    finally{if(recoveryReviewSubmission===operation)recoveryReviewSubmission=null;if(sameRecoveryActor(actorEpoch)){for(const id of ['recovery-proof','recovery-new','recovery-confirm'])byId(id).value='';}updateRecoveryControls();}
  }
  byId('recovery-review-request').addEventListener('click',()=>void submitRecoveryReview());
  byId('recovery-send-code').addEventListener('click',()=>void requestRecoveryCode());byId('recovery-form').addEventListener('submit',event=>void submitRecovery(event));byId('recovery-cancel').addEventListener('click',()=>closeRecovery(true));
  // Platform review and technical administration are independent of audit roles.
  function firstAdminApiReady(){return ['previewFirstAdministrator','requestFirstAdministratorActivation','activateFirstAdministrator'].every(name=>typeof api?.[name]==='function');}
  function firstAdminPending(){return !!firstAdminMutation;}
  function updateFirstAdminControls(){
    const ready=firstAdminApiReady(),proof=!!firstAdminChallenge&&firstAdminChallenge.expiresAt>Date.now(),locked=busy||firstAdminWorking||firstAdminPending();
    for(const id of ['first-admin-invitation','first-admin-phone'])byId(id).disabled=locked;
    byId('first-admin-preview').disabled=locked||!ready;
    byId('first-admin-send-code').disabled=locked||!ready||!onboardingReady||!onboardingAvailable||!firstAdminPreview;
    byId('first-admin-proof').hidden=!firstAdminChallenge;byId('first-admin-proof').disabled=locked||!ready||!onboardingReady||!onboardingAvailable||!proof;
    for(const id of ['first-admin-code','first-admin-display-name','first-admin-password','first-admin-confirm','first-admin-accept'])byId(id).disabled=locked||!ready||!onboardingReady||!onboardingAvailable||!proof;
    byId('first-admin-submit').disabled=locked||!ready||!onboardingReady||!onboardingAvailable||!proof||!byId('first-admin-accept').checked;
    byId('first-admin-cancel').disabled=false;
    byId('first-admin-service-status').textContent=!ready?'当前桌面首管理员激活接口尚未就绪。':onboardingReady&&onboardingAvailable?'手机号验证服务已配置；须完成审核凭据与本人验证。':'短信激活服务尚未开通，当前不能发送验证码或开通团队。';
  }
  function resetFirstAdmin(clearIdentity=true,close=false){
    firstAdminEpoch++;firstAdminWorking=false;firstAdminPreview=null;firstAdminChallenge=null;
    for(const id of ['first-admin-code','first-admin-display-name','first-admin-password','first-admin-confirm'])byId(id).value='';
    byId('first-admin-accept').checked=false;byId('first-admin-target').hidden=true;byId('first-admin-target-description').textContent='';byId('first-admin-target-expiry').textContent='';
    if(clearIdentity)for(const id of ['first-admin-invitation','first-admin-phone'])byId(id).value='';
    message('first-admin-message','');if(close)byId('first-admin-panel').open=false;
    byId('login-view').classList.toggle('first-admin-active',byId('first-admin-panel').open);updateFirstAdminControls();
  }
  function closeFirstAdmin(close=false){const submitted=firstAdminPending();resetFirstAdmin(true,close);if(submitted)message('login-message','已清除输入；已提交的团队激活仍可能完成，请用手机号登录核对。');}
  function firstAdminIdentity(){return {invitationCode:byId('first-admin-invitation').value,phone:byId('first-admin-phone').value};}
  async function firstAdminCall(name,arg,at,actorEpoch){
    const result=await api[name](arg);if(at!==firstAdminEpoch||actorEpoch!==accountIdentityEpoch||session)throw {code:'STALE_FIRST_ADMIN'};
    if(!result?.ok)throw result?.error||{code:'INVALID_RESPONSE',message:'暂时无法确认验证结果，请重新核对。'};return result.value;
  }
  async function previewFirstAdmin(){
    if(busy||session||firstAdminWorking||firstAdminPending()||!firstAdminApiReady())return;
    const identity=firstAdminIdentity();if(!identity.invitationCode.trim()||!identity.phone.trim()){message('first-admin-message','请填写首管理员邀请码和指定手机号。',true);return;}
    resetFirstAdmin(false);const at=firstAdminEpoch,actorEpoch=accountIdentityEpoch;firstAdminWorking=true;updateFirstAdminControls();message('first-admin-message','正在核对审核凭据…');
    try{const value=await firstAdminCall('previewFirstAdministrator',identity,at,actorEpoch);firstAdminPreview=value;byId('first-admin-target').hidden=false;byId('first-admin-target-description').textContent=value.teamName+' · 首管理员 · '+value.phoneMasked;byId('first-admin-target-expiry').textContent='激活凭据有效至 '+new Date(value.expiresAt).toLocaleString('zh-CN');message('first-admin-message','请核对团队和手机号，再完成本人验证。');}
    catch(error){if(at===firstAdminEpoch&&actorEpoch===accountIdentityEpoch&&!session)message('first-admin-message',error.message||'审核凭据无法使用，请联系产品负责人。',true);}
    finally{if(at===firstAdminEpoch){firstAdminWorking=false;updateFirstAdminControls();}}
  }
  async function requestFirstAdminCode(){
    if(busy||session||firstAdminWorking||firstAdminPending()||!firstAdminPreview||!onboardingReady||!onboardingAvailable)return;
    if(firstAdminPreview.expiresAt<=Date.now()){resetFirstAdmin(false);message('first-admin-message','审核凭据已过期，请联系产品负责人。',true);return;}
    const at=firstAdminEpoch,actorEpoch=accountIdentityEpoch;firstAdminChallenge=null;for(const id of ['first-admin-code','first-admin-password','first-admin-confirm'])byId(id).value='';byId('first-admin-accept').checked=false;firstAdminWorking=true;updateFirstAdminControls();message('first-admin-message','正在请求本人手机号验证码…');
    try{firstAdminChallenge=await firstAdminCall('requestFirstAdministratorActivation',firstAdminIdentity(),at,actorEpoch);message('first-admin-message','验证码发送请求已完成。请填写收到的验证码及账号密码，核对管理责任后确认。');}
    catch(error){if(at===firstAdminEpoch&&actorEpoch===accountIdentityEpoch&&!session)message('first-admin-message',error.message||'验证码请求未完成。',true);}
    finally{if(at===firstAdminEpoch){firstAdminWorking=false;updateFirstAdminControls();}}
  }
  async function submitFirstAdmin(event){
    event.preventDefault();if(busy||session||firstAdminWorking||firstAdminPending()||!firstAdminPreview||!firstAdminChallenge||!onboardingReady||!onboardingAvailable)return;
    if(firstAdminPreview.expiresAt<=Date.now()||firstAdminChallenge.expiresAt<=Date.now()){resetFirstAdmin(false);message('first-admin-message','验证或审核凭据已过期，请重新核对。',true);return;}
    if(!byId('first-admin-accept').checked){message('first-admin-message','请核对并确认首管理员身份与管理责任。',true);return;}
    const password=byId('first-admin-password').value,confirmation=byId('first-admin-confirm').value;
    if(!password||password!==confirmation){byId('first-admin-password').value='';byId('first-admin-confirm').value='';message('first-admin-message',password?'两次密码不一致，请重新填写。':'请填写账号密码和确认密码。',true);return;}
    const at=firstAdminEpoch,actorEpoch=accountIdentityEpoch,operation={at},proof={...firstAdminIdentity(),challengeId:firstAdminChallenge.challengeId,code:byId('first-admin-code').value,password,displayName:byId('first-admin-display-name').value,accept:true};
    firstAdminMutation=operation;updateFirstAdminControls();message('first-admin-message','正在验证本人并开通团队管理…');
    try{const value=await firstAdminCall('activateFirstAdministrator',proof,at,actorEpoch);if(value?.activated!==true)throw {code:'INVALID_RESPONSE'};resetFirstAdmin();if(methods.phonePassword){byId('login-mode').value='phone';byId('username').placeholder='输入已验证绑定的手机号';byId('username').inputMode='tel';}message('first-admin-message','团队管理已开通，请返回使用手机号＋密码登录。审计资料权限须另行指派。');}
    catch(error){if(at===firstAdminEpoch&&actorEpoch===accountIdentityEpoch&&!session)message('first-admin-message',passwordChangeUncertain(error)?'未能确认团队激活结果；请求可能已完成，请用手机号登录核对。':error.message||'验证未通过，请核对资料后重试。',true);}
    finally{if(firstAdminMutation===operation)firstAdminMutation=null;if(actorEpoch===accountIdentityEpoch){for(const id of ['first-admin-code','first-admin-password','first-admin-confirm'])byId(id).value='';byId('first-admin-accept').checked=false;updateFirstAdminControls();}}
  }
  byId('first-admin-panel').querySelector('summary').addEventListener('click',()=>{if(byId('first-admin-panel').open)closeFirstAdmin();});
  byId('first-admin-panel').addEventListener('toggle',()=>{if(byId('first-admin-panel').open){resetRecovery(true,true);resetActivation(true,true);resetWechat();byId('username').value='';byId('password').value='';byId('login-view').classList.add('first-admin-active');void loadOnboardingStatus();updateFirstAdminControls();if(firstAdminPending())message('first-admin-message','团队激活请求仍在处理中，请稍候核对。');}else closeFirstAdmin();});
  for(const id of ['first-admin-invitation','first-admin-phone'])byId(id).addEventListener('input',()=>{resetFirstAdmin(false);message('first-admin-message','凭据或手机号已改变，请重新核对。');});
  byId('first-admin-preview').addEventListener('click',()=>void previewFirstAdmin());byId('first-admin-send-code').addEventListener('click',()=>void requestFirstAdminCode());byId('first-admin-accept').addEventListener('change',updateFirstAdminControls);byId('first-admin-form').addEventListener('submit',event=>void submitFirstAdmin(event));byId('first-admin-cancel').addEventListener('click',()=>closeFirstAdmin(true));
  function provisioningApiReady(){return ['getTeamProvisioningAccess','listTeamProvisioningRequests','createTeamProvisioningRequest','reviewTeamProvisioningRequest'].every(name=>typeof api?.[name]==='function');}
  function provisioningPending(){return !!provisioningMutation&&sameAccountSessionsActor(provisioningMutation.actor);}
  function clearIssuedFirstAdmin(){byId('issued-first-admin').hidden=true;byId('issued-first-admin-description').textContent='';byId('issued-first-admin-code').value='';}
  function updateProvisioningControls(){
    const ready=!!session&&provisioningAllowed&&provisioningApiReady()&&byId('team-provisioning-panel').open,locked=busy||provisioningWorking||provisioningPending();
    for(const id of ['team-provisioning-name','team-provisioning-phone','team-provisioning-create','team-provisioning-password','team-provisioning-refresh'])byId(id).disabled=!ready||locked;
    for(const button of byId('team-provisioning-list').querySelectorAll('button'))button.disabled=!ready||locked||!byId('team-provisioning-password').value;
  }
  function resetProvisioning(close=true,hide=true){
    provisioningEpoch++;provisioningWorking=false;provisioningRows=[];for(const id of ['team-provisioning-name','team-provisioning-phone','team-provisioning-password'])byId(id).value='';clearIssuedFirstAdmin();byId('team-provisioning-list').replaceChildren();message('team-provisioning-message','');
    if(hide){provisioningAllowed=false;byId('team-provisioning-panel').hidden=true;}if(close){provisioningPanelOpened=false;byId('team-provisioning-panel').open=false;}updateProvisioningControls();
  }
  function currentProvisioningView(at,actor){return at===provisioningEpoch&&sameAccountSessionsActor(actor)&&provisioningAllowed;}
  function renderProvisioning(){
    const list=byId('team-provisioning-list');list.replaceChildren();const words={pending:'待审核',approved:'已批准，待本人激活',rejected:'已拒绝',revoked:'已撤销',canceled:'已撤销',activated:'团队已开通',expired:'激活凭据已过期'};
    if(!provisioningRows.length)list.append(el('li','暂无申请记录。'));
    for(const item of provisioningRows){const row=el('li'),description=el('div');row.dataset.requestId=item.id;description.append(el('strong',item.teamName+' · '+item.phoneMasked),el('small',(words[item.status]||'状态待核对')+' · 录入于 '+new Date(item.createdAt).toLocaleString('zh-CN')));if(item.expiresAt!==null)description.append(el('small','激活凭据有效至 '+new Date(item.expiresAt).toLocaleString('zh-CN')));row.append(description);const decisions=item.status==='pending'?[['approve','批准并生成凭据'],['reject','拒绝']]:item.status==='approved'?[['revoke','撤销激活凭据']]:[];if(decisions.length){const actions=el('div',undefined,'provisioning-actions');for(const [decision,label] of decisions){const button=el('button',label,'button'+(decision==='approve'?' primary':''));button.type='button';button.dataset.decision=decision;button.addEventListener('click',()=>void reviewProvisioning(item,decision));actions.append(button);}row.append(actions);}list.append(row);}
    updateProvisioningControls();
  }
  async function refreshProvisioning(at,actor){const value=await accountSessionsCall('listTeamProvisioningRequests',undefined,actor);if(!currentProvisioningView(at,actor))return;provisioningRows=value.requests;renderProvisioning();}
  async function loadProvisioningAccess(){
    resetProvisioning();if(!session||!provisioningApiReady())return;const at=provisioningEpoch,actor=accountSessionsActor();
    try{const value=await accountSessionsCall('getTeamProvisioningAccess',undefined,actor);if(at!==provisioningEpoch||!sameAccountSessionsActor(actor)||value.canReview!==true)return;provisioningAllowed=true;byId('team-provisioning-panel').hidden=false;await refreshProvisioning(at,actor);}
    catch{if(at===provisioningEpoch&&sameAccountSessionsActor(actor))resetProvisioning();}finally{updateProvisioningControls();}
  }
  async function loadProvisioning(){
    if(!session||!provisioningAllowed||busy||provisioningWorking||provisioningPending()||!byId('team-provisioning-panel').open)return;const at=provisioningEpoch,actor=accountSessionsActor();provisioningWorking=true;updateProvisioningControls();
    try{await refreshProvisioning(at,actor);if(currentProvisioningView(at,actor))message('team-provisioning-message','请核对申请和指定管理员手机号后，再填写当前密码选择审核操作。');}
    catch(error){if(currentProvisioningView(at,actor)){resetProvisioning();message('workspace-message',error.message||'审核权限或记录无法确认，请重新登录核对。',true);}}
    finally{if(currentProvisioningView(at,actor)){provisioningWorking=false;updateProvisioningControls();}}
  }
  async function createProvisioning(event){
    event.preventDefault();if(!session||!provisioningAllowed||busy||provisioningWorking||provisioningPending()||!byId('team-provisioning-panel').open)return;
    const input={teamName:byId('team-provisioning-name').value,adminPhone:byId('team-provisioning-phone').value};if(!input.teamName.trim()||!input.adminPhone.trim()){message('team-provisioning-message','请填写团队名称和指定首管理员手机号。',true);return;}
    const at=provisioningEpoch,actor=accountSessionsActor(),operation={actor};provisioningMutation=operation;clearIssuedFirstAdmin();updateProvisioningControls();message('team-provisioning-message','正在录入待审申请…');let committed=false;
    try{await accountSessionsCall('createTeamProvisioningRequest',input,actor);committed=true;if(!currentProvisioningView(at,actor)||!byId('team-provisioning-panel').open)return;byId('team-provisioning-name').value='';byId('team-provisioning-phone').value='';await refreshProvisioning(at,actor);if(currentProvisioningView(at,actor))message('team-provisioning-message','待审申请已录入，尚未批准或开通团队。');}
    catch(error){if(currentProvisioningView(at,actor))message('team-provisioning-message',committed?'申请已录入，但记录刷新失败，请刷新核对。':passwordChangeUncertain(error)?'未能确认录入结果，请刷新审核记录后核对，避免重复录入。':error.message||'录入未通过，请核对。',true);}
    finally{if(provisioningMutation===operation)provisioningMutation=null;if(sameAccountSessionsActor(actor)){byId('team-provisioning-password').value='';updateProvisioningControls();if(at!==provisioningEpoch&&byId('team-provisioning-panel').open)void loadProvisioning();}}
  }
  async function reviewProvisioning(item,decision){
    if(!session||!provisioningAllowed||busy||provisioningWorking||provisioningPending()||!byId('team-provisioning-panel').open)return;
    const currentPassword=byId('team-provisioning-password').value;if(!currentPassword){message('team-provisioning-message','请先核对申请并填写审核账号当前密码。',true);return;}
    const at=provisioningEpoch,actor=accountSessionsActor(),operation={actor};provisioningMutation=operation;clearIssuedFirstAdmin();updateProvisioningControls();message('team-provisioning-message','正在验证当前密码并提交审核结果…');let committed=false;
    try{const value=await accountSessionsCall('reviewTeamProvisioningRequest',{requestId:item.id,decision,revision:item.revision,currentPassword},actor);committed=true;if(!currentProvisioningView(at,actor)||!byId('team-provisioning-panel').open)return;
      if(decision==='approve'){if(typeof value.invitationCode!=='string'||!value.invitationCode)throw {code:'INVALID_RESPONSE'};byId('issued-first-admin-description').textContent=value.request.teamName+' · '+value.request.phoneMasked+' · 有效至 '+new Date(value.request.expiresAt).toLocaleString('zh-CN');byId('issued-first-admin-code').value=value.invitationCode;byId('issued-first-admin').hidden=false;}
      await refreshProvisioning(at,actor);if(currentProvisioningView(at,actor))message('team-provisioning-message',decision==='approve'?'审核已批准，尚未开通团队。请自行转交本次凭据，首管理员本人激活后才可管理团队。':decision==='reject'?'申请已拒绝，未开通团队。':'未使用的首管理员激活凭据已撤销。');
    }catch(error){if(currentProvisioningView(at,actor))message('team-provisioning-message',committed?'审核请求已完成，但结果展示或刷新无法确认，请刷新记录核对。一次性凭据不会重新显示。':passwordChangeUncertain(error)?'未能确认审核结果；请求可能已完成，请刷新记录核对，避免重复操作。':error.message||'审核未通过，请核对当前密码及申请状态。',true);}
    finally{if(provisioningMutation===operation)provisioningMutation=null;if(sameAccountSessionsActor(actor)){byId('team-provisioning-password').value='';updateProvisioningControls();if(at!==provisioningEpoch&&byId('team-provisioning-panel').open)void loadProvisioning();}}
  }
  function closeProvisioning(){provisioningPanelOpened=false;const submitted=provisioningPending();resetProvisioning(false,false);if(submitted&&session)message('workspace-message','已清除审核输入与凭据；已提交的请求仍可能完成，请刷新审核记录核对。');}
  byId('team-provisioning-panel').querySelector('summary').addEventListener('click',()=>{if(byId('team-provisioning-panel').open)closeProvisioning();else provisioningPanelOpened=true;});
  byId('team-provisioning-panel').addEventListener('toggle',()=>{if(byId('team-provisioning-panel').open){provisioningPanelOpened=true;if(provisioningPending())message('team-provisioning-message','审核请求仍在处理中，请稍候核对。');else void loadProvisioning();updateProvisioningControls();}else if(provisioningPanelOpened)closeProvisioning();});
  byId('team-provisioning-password').addEventListener('input',updateProvisioningControls);byId('team-provisioning-password').addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});byId('team-provisioning-form').addEventListener('submit',event=>void createProvisioning(event));byId('team-provisioning-refresh').addEventListener('click',()=>void loadProvisioning());
  function recoveryReviewsApiReady(){return ['getRecoveryReviewAccess','listRecoveryReviewRequests','reviewRecoveryReviewRequest'].every(name=>typeof api?.[name]==='function');}
  function recoveryReviewsPending(){return !!recoveryReviewsMutation&&sameAccountSessionsActor(recoveryReviewsMutation.actor);}
  function currentRecoveryReviews(at,actor){return at===recoveryReviewsEpoch&&sameAccountSessionsActor(actor)&&recoveryReviewsAllowed;}
  function clearIssuedRecoveryProof(){byId('issued-recovery-proof').hidden=true;byId('issued-recovery-description').textContent='';byId('issued-recovery-value').value='';}
  function updateRecoveryReviewsControls(){
    const ready=!!session&&recoveryReviewsAllowed&&recoveryReviewsApiReady()&&byId('recovery-reviews-panel').open,locked=busy||recoveryReviewsWorking||recoveryReviewsPending();
    for(const id of ['recovery-reviews-password','recovery-reviews-refresh'])byId(id).disabled=!ready||locked;
    for(const button of byId('recovery-reviews-list').querySelectorAll('button'))button.disabled=!ready||locked||!byId('recovery-reviews-password').value;
  }
  function resetRecoveryReviews(close=true,hide=true){
    recoveryReviewsEpoch++;recoveryReviewsWorking=false;recoveryReviewsRows=[];byId('recovery-reviews-password').value='';clearIssuedRecoveryProof();byId('recovery-reviews-list').replaceChildren();message('recovery-reviews-message','');
    if(hide){recoveryReviewsAllowed=false;byId('recovery-reviews-panel').hidden=true;}if(close){recoveryReviewsOpened=false;byId('recovery-reviews-panel').open=false;}updateRecoveryReviewsControls();
  }
  function renderRecoveryReviews(){
    const list=byId('recovery-reviews-list');list.replaceChildren();const words={pending:'待审核',approved:'已批准，待本人重设',rejected:'已拒绝',revoked:'已撤销',consumed:'已使用',expired:'已过期'};
    if(!recoveryReviewsRows.length)list.append(el('li','暂无可审核的恢复申请。'));
    for(const item of recoveryReviewsRows){const row=el('li'),description=el('div');row.dataset.requestId=item.id;description.append(el('strong',item.displayName+' · '+item.phoneMasked),el('small',item.teamName+' · '+(item.targetKind==='administrator'?'团队管理员':'团队员工')+' · '+(words[item.status]||'状态待核对')),el('small','申请编号 '+item.id+' · 有效至 '+new Date(item.expiresAt).toLocaleString('zh-CN')));row.append(description);const decisions=item.expiresAt<=Date.now()?[]:item.status==='pending'?[['approve','批准恢复'],['reject','拒绝恢复']]:item.status==='approved'?[['revoke','撤销恢复凭据']]:[];if(decisions.length){const actions=el('div',undefined,'provisioning-actions');for(const [decision,label]of decisions){const button=el('button',label,'button'+(decision==='approve'?' primary':''));button.type='button';button.dataset.decision=decision;button.addEventListener('click',()=>void decideRecoveryReview(item,decision));actions.append(button);}row.append(actions);}list.append(row);}updateRecoveryReviewsControls();
  }
  async function refreshRecoveryReviews(at,actor){const value=await accountSessionsCall('listRecoveryReviewRequests',undefined,actor);if(!currentRecoveryReviews(at,actor))return;recoveryReviewsRows=value.requests;renderRecoveryReviews();}
  async function loadRecoveryReviewsAccess(){
    resetRecoveryReviews();if(!session||!recoveryReviewsApiReady())return;const at=recoveryReviewsEpoch,actor=accountSessionsActor();
    try{const value=await accountSessionsCall('getRecoveryReviewAccess',undefined,actor);if(at!==recoveryReviewsEpoch||!sameAccountSessionsActor(actor)||value.canReview!==true)return;recoveryReviewsAllowed=true;byId('recovery-reviews-panel').hidden=false;await refreshRecoveryReviews(at,actor);}
    catch{if(at===recoveryReviewsEpoch&&sameAccountSessionsActor(actor))resetRecoveryReviews();}finally{updateRecoveryReviewsControls();}
  }
  async function loadRecoveryReviews(){
    if(!session||!recoveryReviewsAllowed||busy||recoveryReviewsWorking||recoveryReviewsPending()||!byId('recovery-reviews-panel').open)return;const at=recoveryReviewsEpoch,actor=accountSessionsActor();recoveryReviewsWorking=true;updateRecoveryReviewsControls();
    try{await refreshRecoveryReviews(at,actor);if(currentRecoveryReviews(at,actor))message('recovery-reviews-message','请核实本人和申请编号，填写当前密码后选择批准、拒绝或撤销。');}
    catch(error){if(currentRecoveryReviews(at,actor)){resetRecoveryReviews();message('workspace-message',error.message||'恢复审核权限或记录无法确认，请重新登录核对。',true);}}
    finally{if(currentRecoveryReviews(at,actor)){recoveryReviewsWorking=false;updateRecoveryReviewsControls();}}
  }
  async function decideRecoveryReview(item,decision){
    if(!session||!recoveryReviewsAllowed||busy||recoveryReviewsWorking||recoveryReviewsPending()||!byId('recovery-reviews-panel').open)return;
    const currentPassword=byId('recovery-reviews-password').value;if(!currentPassword){message('recovery-reviews-message','请先核实申请并填写审核账号当前密码。',true);return;}
    if(item.expiresAt<=Date.now()){message('recovery-reviews-message','本次申请已过期，请刷新记录核对。',true);return;}
    const at=recoveryReviewsEpoch,actor=accountSessionsActor(),operation={actor};recoveryReviewsMutation=operation;clearIssuedRecoveryProof();updateRecoveryReviewsControls();message('recovery-reviews-message','正在验证当前密码并提交恢复审核…');let committed=false;
    try{const value=await accountSessionsCall('reviewRecoveryReviewRequest',{requestId:item.id,decision,revision:item.revision,currentPassword},actor);committed=true;if(!currentRecoveryReviews(at,actor)||!byId('recovery-reviews-panel').open)return;if(decision==='approve'){if(typeof value.recoveryProof!=='string'||!value.recoveryProof)throw {code:'INVALID_RESPONSE'};byId('issued-recovery-description').textContent=value.request.displayName+' · '+value.request.phoneMasked+' · 有效至 '+new Date(value.request.expiresAt).toLocaleString('zh-CN');byId('issued-recovery-value').value=value.recoveryProof;byId('issued-recovery-proof').hidden=false;}await refreshRecoveryReviews(at,actor);if(currentRecoveryReviews(at,actor))message('recovery-reviews-message',decision==='approve'?'恢复已批准，密码尚未重设。请核实后自行转交本次凭据，本人仍须完成手机号验证和新密码设置。':decision==='reject'?'恢复申请已拒绝，密码未因此改变。':'未使用的恢复授权已撤销。');}
    catch(error){if(currentRecoveryReviews(at,actor))message('recovery-reviews-message',committed?'审核请求已完成，但结果展示或刷新无法确认，请刷新核对。一次性凭据不会重新显示。':passwordChangeUncertain(error)?'未能确认审核结果；请求可能已完成，请刷新核对，避免重复操作。':error.message||'审核未通过，请核对当前密码和申请状态。',true);}
    finally{if(recoveryReviewsMutation===operation)recoveryReviewsMutation=null;if(sameAccountSessionsActor(actor)){byId('recovery-reviews-password').value='';updateRecoveryReviewsControls();if(at!==recoveryReviewsEpoch&&byId('recovery-reviews-panel').open)void loadRecoveryReviews();}}
  }
  function closeRecoveryReviews(){recoveryReviewsOpened=false;const pending=recoveryReviewsPending();resetRecoveryReviews(false,false);if(pending&&session)message('workspace-message','已清除审核输入；已提交的审核仍可能完成，请刷新恢复申请核对。');}
  byId('recovery-reviews-panel').querySelector('summary').addEventListener('click',()=>{if(byId('recovery-reviews-panel').open)closeRecoveryReviews();else recoveryReviewsOpened=true;});
  byId('recovery-reviews-panel').addEventListener('toggle',()=>{if(byId('recovery-reviews-panel').open){recoveryReviewsOpened=true;if(recoveryReviewsPending())message('recovery-reviews-message','恢复审核仍在处理中，请稍候核对。');else void loadRecoveryReviews();updateRecoveryReviewsControls();}else if(recoveryReviewsOpened)closeRecoveryReviews();});
  byId('recovery-reviews-password').addEventListener('input',updateRecoveryReviewsControls);byId('recovery-reviews-password').addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});byId('recovery-reviews-refresh').addEventListener('click',()=>void loadRecoveryReviews());
  function businessRoleApiReady(){return ['getBusinessRoleManagementAccess','listBusinessRoleMembers','changeBusinessRole'].every(name=>typeof api?.[name]==='function');}
  function businessRoleReady(){return !!session&&session.device?.required===true&&session.device.state==='ready'&&deviceSnapshot?.state==='ready';}
  function businessRolePending(){return !!businessRoleMutation&&sameAccountSessionsActor(businessRoleMutation.actor);}
  function businessRoleContext(){return {actor:accountSessionsActor(),at:businessRoleEpoch,team:businessRoleTeam,device:deviceUiEpoch,main:session?.device?.epoch};}
  function currentBusinessRole(context){return sameAccountSessionsActor(context.actor)&&context.at===businessRoleEpoch&&context.team===businessRoleTeam&&context.device===deviceUiEpoch&&context.main===session?.device?.epoch&&businessRoleReady()&&businessRoleTeams.some(value=>value.teamId===context.team)&&byId('business-role-panel').open&&!byId('business-role-panel').hidden;}
  function businessRoleSelectable(item){return item?.status==='active'&&Object.hasOwn(labels,item.role)&&Number.isSafeInteger(item.revision)&&item.revision>=0&&item.revision<Number.MAX_SAFE_INTEGER;}
  function clearBusinessRoleSelection(){businessRoleSelected=null;byId('business-role-password').value='';byId('business-role-new').value='';byId('business-role-confirmed').checked=false;byId('business-role-target').textContent='尚未选择员工。';}
  function invalidateBusinessRole(clearQuery=false){businessRoleEpoch++;businessRoleWorking=false;businessRoleRows=[];businessRoleHasMore=false;businessRoleNeedsRefresh=true;clearBusinessRoleSelection();if(clearQuery){businessRoleQuery='';byId('business-role-search').value='';}renderBusinessRole();}
  function resetBusinessRole(close=true,hide=true){invalidateBusinessRole(true);if(hide){businessRoleAccessEpoch++;businessRoleTeams=[];businessRoleTeam='';byId('business-role-team').replaceChildren();byId('business-role-panel').hidden=true;}if(close){businessRoleOpened=false;byId('business-role-panel').open=false;}message('business-role-message','');updateBusinessRoleControls();}
  function updateBusinessRoleControls(){
    const ready=businessRoleReady()&&businessRoleApiReady()&&businessRoleTeams.some(value=>value.teamId===businessRoleTeam)&&byId('business-role-panel').open&&!byId('business-role-panel').hidden,locked=busy||businessRoleWorking||businessRolePending();
    for(const id of ['business-role-team','business-role-search','business-role-search-button','business-role-refresh'])byId(id).disabled=!ready||locked;byId('business-role-more').hidden=!businessRoleHasMore;byId('business-role-more').disabled=!ready||locked||businessRoleNeedsRefresh||!businessRoleHasMore;for(const button of byId('business-role-list').querySelectorAll('button'))button.disabled=!ready||locked||businessRoleNeedsRefresh||button.dataset.selectable!=='true';
    const target=ready&&!locked&&!businessRoleNeedsRefresh&&businessRoleRows.includes(businessRoleSelected)&&businessRoleSelectable(businessRoleSelected);for(const id of ['business-role-new','business-role-password','business-role-confirmed'])byId(id).disabled=!target;const role=byId('business-role-new').value;byId('business-role-submit').disabled=!target||!Object.hasOwn(labels,role)||role===businessRoleSelected.role||!byId('business-role-confirmed').checked||!byId('business-role-password').value;
  }
  function renderBusinessRole(){
    const list=byId('business-role-list');list.replaceChildren();if(!businessRoleRows.length)list.append(el('li',businessRoleNeedsRefresh?'请读取当前授权范围内的员工列表。':'没有匹配的可调整员工。','identity-note'));
    for(const item of businessRoleRows){const row=el('li'),description=el('div');row.dataset.userId=item.id;row.dataset.teamId=businessRoleTeam;description.append(el('strong',item.displayName+' · '+labels[item.role]),el('small',businessRoleSelectable(item)?'账号使用中':'当前版本不可调整，请联系负责人核对。'));const choose=el('button',businessRoleSelected===item?'已选择此员工':'选择调整职级','button');choose.type='button';choose.dataset.selectable=String(businessRoleSelectable(item));choose.setAttribute('aria-pressed',String(businessRoleSelected===item));choose.addEventListener('click',()=>{if(busy||businessRoleWorking||businessRolePending()||businessRoleNeedsRefresh||!businessRoleReady()||!byId('business-role-panel').open||!businessRoleRows.includes(item)||!businessRoleSelectable(item))return;clearBusinessRoleSelection();businessRoleSelected=item;byId('business-role-target').textContent='拟调整：'+item.displayName+' · 当前职级 '+labels[item.role]+' · '+(businessRoleTeams.find(value=>value.teamId===businessRoleTeam)?.teamName||businessRoleTeam);renderBusinessRole();});row.append(description,choose);list.append(row);}updateBusinessRoleControls();
  }
  async function businessRoleCall(name,input,current){const result=await api[name](input);if(!current())throw {code:'STALE_BUSINESS_ROLE'};if(!result?.ok){if(result?.error?.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message','当前登录已失效，请重新登录。',true);}throw result?.error||{code:'INVALID_RESPONSE'};}return result.value;}
  async function loadBusinessRoleAccess(){
    resetBusinessRole();if(!businessRoleReady()||!businessRoleApiReady())return;const actor=accountSessionsActor(),at=businessRoleAccessEpoch,device=deviceUiEpoch,current=()=>sameAccountSessionsActor(actor)&&at===businessRoleAccessEpoch&&device===deviceUiEpoch&&businessRoleReady();
    try{const value=await businessRoleCall('getBusinessRoleManagementAccess',undefined,current);if(!current())return;if(!Array.isArray(value?.teams)||value.teams.length>50||!value.teams.every(item=>typeof item.teamId==='string'&&item.teamId&&typeof item.teamName==='string')||new Set(value.teams.map(item=>item.teamId)).size!==value.teams.length)throw {code:'INVALID_RESPONSE'};businessRoleTeams=value.teams;businessRoleTeam=businessRoleTeams[0]?.teamId||'';byId('business-role-team').replaceChildren();for(const team of businessRoleTeams){const option=el('option',team.teamName);option.value=team.teamId;byId('business-role-team').append(option);}byId('business-role-team').value=businessRoleTeam;byId('business-role-panel').hidden=!businessRoleTeams.length;updateBusinessRoleControls();}catch{if(current())resetBusinessRole();}
  }
  async function readBusinessRolePage(context,after,append=false){const value=await businessRoleCall('listBusinessRoleMembers',{teamId:context.team,...(businessRoleQuery?{q:businessRoleQuery}:{}),...(after?{after}:{}),limit:20},()=>currentBusinessRole(context));if(!Array.isArray(value?.members)||value.members.length>20||typeof value.hasMore!=='boolean'||!value.members.every(item=>typeof item.id==='string'&&item.id&&typeof item.displayName==='string'&&item.status==='active'&&Object.hasOwn(labels,item.role)&&Number.isSafeInteger(item.revision)&&item.revision>=0))throw {code:'INVALID_RESPONSE'};const members=append?businessRoleRows.concat(value.members):value.members;if(new Set(members.map(item=>item.id)).size!==members.length)throw {code:'INVALID_RESPONSE'};businessRoleRows=members;businessRoleHasMore=value.hasMore;businessRoleNeedsRefresh=false;clearBusinessRoleSelection();renderBusinessRole();}
  async function loadBusinessRole(append=false){
    if(!businessRoleReady()||!businessRoleApiReady()||!businessRoleTeams.some(value=>value.teamId===businessRoleTeam)||!byId('business-role-panel').open||busy||businessRoleWorking||businessRolePending()||append&&(businessRoleNeedsRefresh||!businessRoleHasMore))return;if(!append)invalidateBusinessRole();const context=businessRoleContext();businessRoleWorking=true;updateBusinessRoleControls();message('business-role-message','正在读取当前授权范围内的员工…');
    try{await readBusinessRolePage(context,append?businessRoleRows.at(-1)?.id:undefined,append);if(currentBusinessRole(context))message('business-role-message','请先选择员工和不同的新职级，再核对收回旧权限并填写当前密码。');}catch(error){if(currentBusinessRole(context)){invalidateBusinessRole();message('business-role-message',error.message||'员工职级列表无法确认，请刷新核对。',true);}}finally{if(currentBusinessRole(context)){businessRoleWorking=false;updateBusinessRoleControls();}}
  }
  async function changeBusinessRole(event){
    event.preventDefault();const item=businessRoleSelected,role=byId('business-role-new').value,currentPassword=byId('business-role-password').value;if(!businessRoleReady()||!businessRoleApiReady()||!businessRoleTeams.some(value=>value.teamId===businessRoleTeam)||!byId('business-role-panel').open||busy||businessRoleWorking||businessRolePending()||businessRoleNeedsRefresh||!businessRoleRows.includes(item)||!businessRoleSelectable(item)||!Object.hasOwn(labels,role)||role===item.role||!currentPassword||new TextEncoder().encode(currentPassword).length>512||!byId('business-role-confirmed').checked)return;
    const context=businessRoleContext(),operation={actor:context.actor};businessRoleMutation=operation;byId('business-role-password').value='';byId('business-role-confirmed').checked=false;updateBusinessRoleControls();message('business-role-message','正在核验当前密码并调整员工职级…');let completed=false;
    try{const value=await businessRoleCall('changeBusinessRole',{teamId:context.team,userId:item.id,revision:item.revision,role,currentPassword,confirmed:true},()=>currentBusinessRole(context));completed=true;if(value?.changed!==true||value.role!==role||!Number.isSafeInteger(value.revision)||value.revision<=item.revision)throw {code:'INVALID_RESPONSE'};clearBusinessRoleSelection();await readBusinessRolePage(context);if(currentBusinessRole(context))message('business-role-message','员工职级已更改；员工须重新登录，并重新分配项目、任务及资料权限。');}
    catch(error){if(currentBusinessRole(context)){const uncertain=error.code==='OPERATION_UNCONFIRMED'||passwordChangeUncertain(error);if(completed||uncertain||['HTTP_409','HTTP_404'].includes(error.code)){businessRoleRows=[];businessRoleHasMore=false;businessRoleNeedsRefresh=true;clearBusinessRoleSelection();renderBusinessRole();}message('business-role-message',completed?'员工职级已更改，但列表刷新未确认；请刷新列表核对。':uncertain?'未能确认职级调整结果；请求可能已完成，请刷新员工列表核对，系统不会自动重试。':error.code==='HTTP_409'?'员工职级、版本或授权已变化，请刷新后重新选择。':error.message||'职级调整未通过，请核对员工和当前密码。',true);}}
    finally{if(businessRoleMutation===operation)businessRoleMutation=null;if(sameAccountSessionsActor(context.actor)){byId('business-role-password').value='';byId('business-role-confirmed').checked=false;updateBusinessRoleControls();if(context.at!==businessRoleEpoch&&byId('business-role-panel').open)void loadBusinessRole();}}
  }
  function closeBusinessRole(){const pending=businessRolePending();businessRoleOpened=false;resetBusinessRole(false,false);if(pending&&session)message('workspace-message','已清除职级调整输入；已提交的请求仍可能完成，请刷新员工列表核对。');}
  byId('business-role-panel').querySelector('summary').addEventListener('click',()=>{if(byId('business-role-panel').open)closeBusinessRole();else businessRoleOpened=true;});byId('business-role-panel').addEventListener('toggle',()=>{if(byId('business-role-panel').open&&!byId('business-role-panel').hidden&&businessRoleReady()){businessRoleOpened=true;if(businessRolePending())message('business-role-message','职级调整仍在处理中；请稍候刷新核对。');else void loadBusinessRole();updateBusinessRoleControls();}else if(businessRoleOpened)closeBusinessRole();});
  byId('business-role-team').addEventListener('change',()=>{const value=byId('business-role-team').value;if(!businessRoleTeams.some(item=>item.teamId===value))return;businessRoleTeam=value;invalidateBusinessRole(true);void loadBusinessRole();});byId('business-role-search').addEventListener('input',()=>{businessRoleQuery=byId('business-role-search').value;invalidateBusinessRole();});byId('business-role-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void loadBusinessRole();}});byId('business-role-search-button').addEventListener('click',()=>void loadBusinessRole());byId('business-role-refresh').addEventListener('click',()=>void loadBusinessRole());byId('business-role-more').addEventListener('click',()=>void loadBusinessRole(true));byId('business-role-form').addEventListener('submit',event=>void changeBusinessRole(event));byId('business-role-new').addEventListener('change',()=>{byId('business-role-password').value='';byId('business-role-confirmed').checked=false;updateBusinessRoleControls();});byId('business-role-password').addEventListener('input',updateBusinessRoleControls);byId('business-role-confirmed').addEventListener('change',updateBusinessRoleControls);
  function memberManagementApiReady(){return ['getMemberManagementAccess','listTeamBusinessMembers','listTeamAdministrators','disableTeamBusinessMember','disableTeamAdministrator'].every(name=>typeof api?.[name]==='function');}
  function memberManagementAllowed(){return memberManagementTeams.length>0||memberManagementCanReview;}
  function memberManagementPending(){return !!memberManagementMutation&&sameAccountSessionsActor(memberManagementMutation.actor);}
  function memberManagementSelectable(item){return item?.status==='active'&&Number.isSafeInteger(item.revision)&&item.revision>=0&&item.revision<Number.MAX_SAFE_INTEGER;}
  function memberManagementContext(){return {actor:accountSessionsActor(),at:memberManagementEpoch,mode:memberManagementMode,teamId:memberManagementTeam};}
  function currentMemberManagement(context){return sameAccountSessionsActor(context.actor)&&context.at===memberManagementEpoch&&context.mode===memberManagementMode&&context.teamId===memberManagementTeam&&memberManagementAllowed()&&!byId('member-management-panel').hidden&&byId('member-management-panel').open;}
  function clearMemberManagementSelection(){memberManagementSelected=null;byId('member-management-password').value='';byId('member-management-target').textContent='尚未选择停用对象。';}
  function invalidateMemberManagement(clearQuery=false){memberManagementEpoch++;memberManagementWorking=false;memberManagementRows=[];memberManagementHasMore=false;memberManagementNeedsRefresh=true;clearMemberManagementSelection();if(clearQuery){memberManagementQuery='';byId('member-management-search').value='';}renderMemberManagement();}
  function resetMemberManagement(close=true,hide=true){
    invalidateMemberManagement(true);if(hide){memberManagementAccessEpoch++;memberManagementTeams=[];memberManagementCanReview=false;memberManagementTeam='';memberManagementMode='business';byId('member-management-panel').hidden=true;byId('member-management-mode').replaceChildren();byId('member-management-team').replaceChildren();}if(close){memberManagementOpened=false;byId('member-management-panel').open=false;}if(!memberManagementPending())memberManagementMutation=null;message('member-management-message','');updateMemberManagementControls();
  }
  function memberManagementTargetLabel(item){const team=memberManagementMode==='administrators'?item.teamName:memberManagementTeams.find(value=>value.teamId===memberManagementTeam)?.teamName;return item.displayName+' · '+(item.role==='administrator'?'技术管理员':labels[item.role]||'岗位待核对')+' · '+(team||memberManagementTeam);}
  function updateMemberManagementControls(){
    const ready=!!session&&memberManagementApiReady()&&memberManagementAllowed()&&!byId('member-management-panel').hidden&&byId('member-management-panel').open,locked=busy||memberManagementWorking||memberManagementPending();
    for(const id of ['member-management-mode','member-management-team','member-management-search','member-management-search-button','member-management-refresh'])byId(id).disabled=!ready||locked;
    byId('member-management-more').hidden=!memberManagementHasMore;byId('member-management-more').disabled=!ready||locked||memberManagementNeedsRefresh||!memberManagementHasMore;
    for(const button of byId('member-management-list').querySelectorAll('button'))button.disabled=!ready||locked||memberManagementNeedsRefresh||button.dataset.selectable!=='true';
    const target=ready&&!locked&&!memberManagementNeedsRefresh&&memberManagementSelectable(memberManagementSelected)&&memberManagementRows.includes(memberManagementSelected);byId('member-management-password').disabled=!target;byId('member-management-disable').disabled=!target||!byId('member-management-password').value;
  }
  function renderMemberManagement(){
    const list=byId('member-management-list');list.replaceChildren();if(!memberManagementRows.length)list.append(el('li',memberManagementNeedsRefresh?'请读取当前授权范围内的成员列表。':'没有匹配的可管理成员。','identity-note'));
    for(const item of memberManagementRows){const row=el('li'),description=el('div');row.dataset.userId=item.id;row.dataset.teamId=memberManagementMode==='administrators'?item.teamId:memberManagementTeam;description.append(el('strong',memberManagementTargetLabel(item)),el('small',item.status==='disabled'?'账号已停用':memberManagementSelectable(item)?'账号使用中':'账号使用中 · 当前版本不可停用，请联系负责人核对。'));const choose=el('button',memberManagementSelected===item?'已选择此账号':'选择停用对象','button');choose.type='button';choose.dataset.selectable=String(memberManagementSelectable(item));choose.setAttribute('aria-pressed',String(memberManagementSelected===item));choose.addEventListener('click',()=>{if(busy||memberManagementWorking||memberManagementPending()||memberManagementNeedsRefresh||!byId('member-management-panel').open||!memberManagementRows.includes(item)||!memberManagementSelectable(item))return;clearMemberManagementSelection();memberManagementSelected=item;byId('member-management-target').textContent='拟停用：'+memberManagementTargetLabel(item)+' · 账号使用中。请再次核对对象。';renderMemberManagement();});row.append(description,choose);list.append(row);}updateMemberManagementControls();
  }
  function configureMemberManagementScope(){
    const mode=byId('member-management-mode');mode.replaceChildren();for(const [value,label] of [...(memberManagementTeams.length?[['business','业务成员']]:[]),...(memberManagementCanReview?[['administrators','技术管理员']]:[])]){const option=el('option',label);option.value=value;mode.append(option);}if(![...mode.options].some(option=>option.value===memberManagementMode))memberManagementMode=mode.options[0]?.value||'business';mode.value=memberManagementMode;byId('member-management-mode-field').hidden=mode.options.length<2;
    const teams=byId('member-management-team');teams.replaceChildren();for(const team of memberManagementTeams){const option=el('option',team.teamName);option.value=team.teamId;teams.append(option);}if(!memberManagementTeams.some(team=>team.teamId===memberManagementTeam))memberManagementTeam=memberManagementTeams[0]?.teamId||'';teams.value=memberManagementTeam;byId('member-management-team-field').hidden=memberManagementMode!=='business';updateMemberManagementControls();
  }
  async function memberManagementCall(name,input,current){
    const result=await api[name](input);if(!current())throw {code:'STALE_MEMBER_MANAGEMENT'};
    if(!result?.ok){if(result?.error?.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message',result.error.message||'当前登录已失效，请重新登录。',true);}throw result?.error||{code:'INVALID_RESPONSE'};}return result.value;
  }
  async function loadMemberManagementAccess(){
    resetMemberManagement();if(!session||!memberManagementApiReady())return;const actor=accountSessionsActor(),at=memberManagementAccessEpoch,current=()=>sameAccountSessionsActor(actor)&&at===memberManagementAccessEpoch;
    try{const value=await memberManagementCall('getMemberManagementAccess',undefined,current);if(!current())return;if(!Array.isArray(value?.teams)||typeof value.canReviewAdministrators!=='boolean'||!value.teams.every(item=>typeof item.teamId==='string'&&item.teamId&&typeof item.teamName==='string'))throw {code:'INVALID_RESPONSE'};memberManagementTeams=value.teams;memberManagementCanReview=value.canReviewAdministrators;configureMemberManagementScope();byId('member-management-panel').hidden=!memberManagementAllowed();updateMemberManagementControls();}
    catch{if(current())resetMemberManagement();}
  }
  async function readMemberManagementPage(context,after,append=false){
    const input={...(context.mode==='business'?{teamId:context.teamId}:{}),...(memberManagementQuery?{q:memberManagementQuery}:{}),...(after?{after}:{}),limit:20},value=await memberManagementCall(context.mode==='business'?'listTeamBusinessMembers':'listTeamAdministrators',input,()=>currentMemberManagement(context));
    if(!Array.isArray(value?.members)||typeof value.hasMore!=='boolean'||!value.members.every(item=>typeof item.id==='string'&&item.id&&typeof item.displayName==='string'&&['active','disabled'].includes(item.status)&&Number.isSafeInteger(item.revision)&&item.revision>=0&&(context.mode==='business'?Object.hasOwn(labels,item.role):item.role==='administrator'&&typeof item.teamId==='string'&&item.teamId&&typeof item.teamName==='string')))throw {code:'INVALID_RESPONSE'};
    memberManagementRows=append?memberManagementRows.concat(value.members):value.members;memberManagementHasMore=value.hasMore;memberManagementNeedsRefresh=false;renderMemberManagement();
  }
  async function loadMemberManagement(append=false){
    if(!session||!memberManagementAllowed()||!memberManagementApiReady()||busy||memberManagementWorking||memberManagementPending()||!byId('member-management-panel').open||byId('member-management-panel').hidden)return;const previous=append?memberManagementRows:[],after=append?previous.at(-1)?.id:undefined;invalidateMemberManagement();memberManagementRows=previous;const context=memberManagementContext();memberManagementWorking=true;renderMemberManagement();message('member-management-message','正在读取当前授权范围内的成员…');
    try{await readMemberManagementPage(context,after,append);if(currentMemberManagement(context))message('member-management-message','请先选择并核对停用对象，再填写你当前账号的密码。');}
    catch(error){if(currentMemberManagement(context)){invalidateMemberManagement();if(['HTTP_403','HTTP_404'].includes(error.code)){resetMemberManagement();message('workspace-message','成员管理权限无法确认，请重新登录后核对。',true);}else message('member-management-message',error.message||'成员列表无法确认，请刷新后核对。',true);}}
    finally{if(currentMemberManagement(context)){memberManagementWorking=false;updateMemberManagementControls();}}
  }
  function closeMemberManagement(){const pending=memberManagementPending();memberManagementOpened=false;resetMemberManagement(false,false);if(pending&&session)message('workspace-message','已清除成员列表与密码；已提交的停用请求仍可能完成，请稍后刷新核对。');}
  async function disableMemberManagement(event){
    event.preventDefault();if(!session||busy||memberManagementWorking||memberManagementPending()||memberManagementNeedsRefresh||!memberManagementAllowed()||!memberManagementApiReady()||!byId('member-management-panel').open)return;const target=memberManagementSelected,currentPassword=byId('member-management-password').value;if(!memberManagementSelectable(target)||!memberManagementRows.includes(target)||!currentPassword){message('member-management-message','请明确选择停用对象并填写你当前账号的密码。',true);return;}
    const context=memberManagementContext(),operation={actor:context.actor,context},input={teamId:context.mode==='business'?context.teamId:target.teamId,userId:target.id,revision:target.revision,currentPassword};memberManagementMutation=operation;byId('member-management-password').value='';updateMemberManagementControls();message('member-management-message','正在验证当前密码并停用选中账号…');let committed=false;
    try{const value=await memberManagementCall(context.mode==='business'?'disableTeamBusinessMember':'disableTeamAdministrator',input,()=>currentMemberManagement(context));if(value?.disabled!==true)throw {code:'INVALID_RESPONSE'};committed=true;clearMemberManagementSelection();memberManagementRows=[];memberManagementHasMore=false;memberManagementNeedsRefresh=true;renderMemberManagement();await readMemberManagementPage(context);if(currentMemberManagement(context))message('member-management-message','成员账号已停用，列表已更新。');}
    catch(error){if(currentMemberManagement(context)){if(committed||passwordChangeUncertain(error)||error.code==='HTTP_409'||error.code==='HTTP_404'){clearMemberManagementSelection();memberManagementRows=[];memberManagementHasMore=false;memberManagementNeedsRefresh=true;renderMemberManagement();}message('member-management-message',committed?'成员账号已停用，但列表刷新失败；请刷新核对。':passwordChangeUncertain(error)?'未能确认停用结果；请求可能已完成，请刷新列表核对，避免重复操作。':error.code==='HTTP_409'?'账号或授权状态已变化，请刷新列表后核对。':error.message||'停用请求未通过，请核对对象及当前密码。',true);}}
    finally{if(memberManagementMutation===operation)memberManagementMutation=null;if(sameAccountSessionsActor(context.actor)){byId('member-management-password').value='';updateMemberManagementControls();if(context.at!==memberManagementEpoch&&byId('member-management-panel').open)void loadMemberManagement();}}
  }
  byId('member-management-panel').querySelector('summary').addEventListener('click',()=>{if(byId('member-management-panel').open)closeMemberManagement();else memberManagementOpened=true;});
  byId('member-management-panel').addEventListener('toggle',()=>{if(byId('member-management-panel').open&&!byId('member-management-panel').hidden&&session&&memberManagementAllowed()){memberManagementOpened=true;if(memberManagementPending())message('member-management-message','停用请求仍在处理中；请稍候刷新核对。');else void loadMemberManagement();updateMemberManagementControls();}else if(memberManagementOpened)closeMemberManagement();});
  byId('member-management-mode').addEventListener('change',()=>{const value=byId('member-management-mode').value;if(value==='business'&&!memberManagementTeams.length||value==='administrators'&&!memberManagementCanReview||!['business','administrators'].includes(value))return;memberManagementMode=value;invalidateMemberManagement(true);configureMemberManagementScope();void loadMemberManagement();});
  byId('member-management-team').addEventListener('change',()=>{const value=byId('member-management-team').value;if(!memberManagementTeams.some(team=>team.teamId===value))return;memberManagementTeam=value;invalidateMemberManagement(true);void loadMemberManagement();});
  byId('member-management-search').addEventListener('input',()=>{memberManagementQuery=byId('member-management-search').value;invalidateMemberManagement();});
  byId('member-management-search').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void loadMemberManagement();}});
  byId('member-management-search-button').addEventListener('click',()=>void loadMemberManagement());byId('member-management-refresh').addEventListener('click',()=>void loadMemberManagement());byId('member-management-more').addEventListener('click',()=>void loadMemberManagement(true));byId('member-management-password').addEventListener('input',updateMemberManagementControls);byId('member-management-disable-form').addEventListener('submit',event=>void disableMemberManagement(event));
  function rebuildInvitationTeams(){
    const teams=new Map((session?.memberships||[]).map(member=>[member.teamId,{teamId:member.teamId,teamName:member.teamId}]));for(const team of administrationTeams)teams.set(team.teamId,team);
    const select=byId('invitation-team');select.replaceChildren();for(const team of teams.values()){const option=el('option',team.teamName);option.value=team.teamId;select.append(option);}if(!teams.has(invitationTeamId))invitationTeamId=teams.has(teamId)?teamId:teams.keys().next().value||'';select.value=invitationTeamId;select.hidden=teams.size<2;byId('employee-invitations-panel').querySelector('label[for=invitation-team]').hidden=teams.size<2;
  }
  async function loadTeamAdministration(){
    if(!session||typeof api?.getTeamAdministration!=='function')return;const actor=accountSessionsActor();
    try{const value=await accountSessionsCall('getTeamAdministration',undefined,actor);if(!sameAccountSessionsActor(actor))return;const previous=invitationTeamId;administrationTeams=value.teams;rebuildInvitationTeams();if(invitationTeamId!==previous)void loadInvitationAccess();if(!teamId&&administrationTeams.length)message('workspace-message','当前账号可管理员工邀请，尚未获指派审计角色或资料权限。');}
    catch{if(sameAccountSessionsActor(actor)){administrationTeams=[];rebuildInvitationTeams();}}
  }
  byId('invitation-team').addEventListener('change',()=>{invitationTeamId=byId('invitation-team').value;void loadInvitationAccess();});

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
    updateFirstAdminControls();updateProvisioningControls();
    byId('invitation-team').disabled=busy||invitationWorking;
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
  function currentInvitationView(at,target){return at===invitationEpoch&&session&&invitationTeamId===target;}
  function renderInvitations(items){
    const list=byId('employee-invitation-list');list.replaceChildren();const words={pending:'待激活',revoked:'已撤销',accepted:'已使用',expired:'已过期'};
    if(!items.length){list.append(el('li','暂无邀请记录。'));return;}
    for(const item of items){const row=el('li'),description=el('div');description.append(el('strong',item.phoneMasked+' · '+labels[item.role]+' · '+words[item.status]),el('small','有效至 '+new Date(item.expiresAt).toLocaleString('zh-CN')));row.append(description);if(item.status==='pending'){const revoke=el('button','撤销','button');revoke.type='button';revoke.addEventListener('click',()=>revokeInvitation(item.invitationId));row.append(revoke);}list.append(row);}
    updateOnboardingControls();
  }
  async function refreshInvitationList(at,target){const value=await accountSessionsCall('listEmployeeInvitations',{teamId:target},accountSessionsActor());if(currentInvitationView(at,target))renderInvitations(value.invitations);}
  async function loadInvitationAccess(){
    const open=byId('employee-invitations-panel').open,at=resetInvitations(false),target=invitationTeamId;
    if(!session||!target||!['getInvitationAccess','listEmployeeInvitations','createEmployeeInvitation','revokeEmployeeInvitation'].every(name=>typeof api?.[name]==='function'))return;
    invitationWorking=true;
    try{const result=await accountSessionsCall('getInvitationAccess',{teamId:target},accountSessionsActor());if(!currentInvitationView(at,target)||result.canInvite!==true)return;await refreshInvitationList(at,target);if(!currentInvitationView(at,target))return;invitationAllowed=true;byId('employee-invitations-panel').hidden=false;byId('employee-invitations-panel').open=open;}
    catch{if(currentInvitationView(at,target))resetInvitations();}
    finally{if(at===invitationEpoch){invitationWorking=false;updateOnboardingControls();}}
  }
  async function revokeInvitation(invitationId){
    if(busy||invitationWorking||!invitationAllowed)return;const at=invitationEpoch,target=invitationTeamId;invitationWorking=true;clearIssuedInvitation();updateOnboardingControls();
    try{await accountSessionsCall('revokeEmployeeInvitation',{teamId:target,invitationId},accountSessionsActor());if(!currentInvitationView(at,target))return;await refreshInvitationList(at,target);if(currentInvitationView(at,target))message('invitation-message','邀请状态已更新。');}
    catch{if(currentInvitationView(at,target))resetInvitations();}
    finally{if(at===invitationEpoch){invitationWorking=false;updateOnboardingControls();}}
  }
  function closeActivationInput(){const submitted=activationWorking&&!!activationChallenge;resetActivation();if(submitted)message('login-message','已清除输入；已提交的激活可能已完成，可用手机号登录核对。');}
  // Native details opening is synchronous, but toggle is queued. Never clear
  // activation inputs in that late opening event: the user may already have pasted.
  byId('activation-panel').querySelector('summary').addEventListener('click',()=>{if(byId('activation-panel').open)closeActivationInput();});
  byId('activation-panel').addEventListener('toggle',()=>{if(byId('activation-panel').open){resetRecovery(true,true);byId('login-view').classList.add('onboarding-active');resetFirstAdmin(true,true);resetWechat();byId('username').value='';byId('password').value='';void loadOnboardingStatus();}else closeActivationInput();});
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
    event.preventDefault();if(busy||invitationWorking||!invitationAllowed)return;const at=invitationEpoch,target=invitationTeamId,input={teamId:target,phone:byId('invitation-phone').value,role:byId('invitation-role').value};invitationWorking=true;clearIssuedInvitation();updateOnboardingControls();
    try{const value=await accountSessionsCall('createEmployeeInvitation',input,accountSessionsActor());if(!currentInvitationView(at,target))return;byId('invitation-phone').value='';byId('issued-invitation-description').textContent=value.phoneMasked+' · '+labels[value.role]+' · 团队 '+value.teamId+' · 有效至 '+new Date(value.expiresAt).toLocaleString('zh-CN');byId('issued-invitation-code').value=value.invitationCode;byId('issued-invitation').hidden=false;await refreshInvitationList(at,target);if(currentInvitationView(at,target))message('invitation-message','邀请已创建，未发送消息。请核对后自行转交本次邀请码。');}
    catch{if(currentInvitationView(at,target))resetInvitations();}
    finally{if(at===invitationEpoch){invitationWorking=false;updateOnboardingControls();}}
  });
  byId('employee-invitations-panel').addEventListener('toggle',()=>{if(!byId('employee-invitations-panel').open&&invitationAllowed){invitationEpoch++;invitationWorking=false;clearIssuedInvitation();byId('invitation-phone').value='';updateOnboardingControls();}});
  byId('invitation-refresh').addEventListener('click',()=>void loadInvitationAccess());
  byId('wechat-login').addEventListener('click',async()=>{if(busy||!methodsReady||!methods.wechat||!desktopWechatReady||wechatActive())return;resetRecovery(true,true);resetActivation(true,true);resetFirstAdmin(true,true);resetWechat(false);const at=wechatEpoch;wechatState='starting';wechatWorking=true;for(const id of ['username','password'])byId(id).value='';message('login-message','');message('wechat-status','正在打开系统浏览器，请稍候…');updateIdentityControls();try{await applyWechatResult(await wechatCall('startWechatLogin',undefined,at),at);}catch(error){if(at===wechatEpoch)terminalWechat('failed',error.message||'无法开始微信授权，请重试。',true);}finally{if(at===wechatEpoch){wechatWorking=false;updateIdentityControls();}}});
  byId('wechat-cancel').addEventListener('click',()=>{if(!wechatActive())return;resetDevicePresentation();resetWechat();terminalWechat('canceled','本次微信授权已取消，可重新开始。');});
  byId('wechat-link-submit').addEventListener('click',async()=>{if(busy||wechatWorking||wechatState!=='binding_required')return;if(wechatExpiresAt&&wechatExpiresAt<=Date.now()){terminalWechat('expired','本次微信授权已过期，请重新开始。',true);return;}const phone=byId('wechat-link-phone').value,password=byId('wechat-link-password').value;if(!phone.trim()||!password){message('wechat-status','请填写本人现有账号的已验证手机号和密码。',true);return;}const at=wechatEpoch;wechatState='linking';wechatWorking=true;message('wechat-status','正在验证账号并确认关联…');updateIdentityControls();try{await applyWechatResult(await wechatCall('linkWechatAccount',{phone,password},at),at);}catch(error){if(at===wechatEpoch){if(['HTTP_410','TRANSACTION_EXPIRED'].includes(error.code))terminalWechat('expired','本次微信授权已过期，请重新开始。',true);else if(error.code==='WECHAT_NOT_LINKABLE'){resetWechat();terminalWechat('failed','本次微信授权状态已改变，请重新开始。',true);}else{wechatState='binding_required';message('wechat-status',error.message||'关联未完成，请核对账号后重试或取消。',true);}}}finally{if(at===wechatEpoch){byId('wechat-link-password').value='';wechatWorking=false;updateIdentityControls();}}});
  for(const id of ['wechat-link-phone','wechat-link-password'])byId(id).addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();byId('wechat-link-submit').click();}});
  window.addEventListener('beforeunload',()=>{resetBusinessRole();deviceUiClosed=true;clearInterval(devicePollTimer);resetDevicePresentation();resetMemberManagement();resetTaskSubmissionAccess();resetTaskManagement();resetRecovery(true,true);resetAccountSessions();resetPasswordChange();resetWechat();resetActivation(true,true);resetFirstAdmin(true,true);resetProvisioning();resetRecoveryReviews();resetInvitations();});
  function taskManagementReady(){return ['getTaskManagement','listTaskAssignees','assignTask','returnTask'].every(name=>typeof api?.[name]==='function');}
  function taskManagementContext(){return session&&selected?{actor:accountSessionsActor(),teamId,taskId:selected.id,view:viewEpoch}:null;}
  function sameTaskManagement(context){return !!context&&sameAccountSessionsActor(context.actor)&&context.teamId===teamId&&context.taskId===selected?.id&&context.view===viewEpoch;}
  function taskManagementPending(){return !!taskManagementMutation&&sameAccountSessionsActor(taskManagementMutation.context.actor);}
  function sameTaskView(context){return !!context&&sameAccountSessionsActor(context.actor)&&context.teamId===teamId&&context.view===viewEpoch;}
  function taskUploadPending(){return !!taskUploadOperation&&sameAccountSessionsActor(taskUploadOperation.context.actor);}
  function resetTaskSubmissionAccess(status='idle'){submissionAccessEpoch++;submissionAccess=null;submissionAccessStatus=status;updateTaskSubmissionControls();}
  function canSubmitSelected(){return !!selected&&submissionAccessStatus==='ready'&&sameTaskManagement(submissionAccess?.context)&&submissionAccess.canSubmit===true&&Number.isSafeInteger(revision)&&revision>=0&&revision<Number.MAX_SAFE_INTEGER&&submissionAccess.revision===revision;}
  function taskSubmissionWords(){
    if(submissionAccessStatus==='pending')return '正在核验本任务提交权限…';
    if(submissionAccessStatus==='unavailable')return '当前桌面提交权限接口未更新，暂不能提交；请更新客户端并刷新任务。';
    if(submissionAccessStatus==='error')return '无法核验提交权限，请刷新任务后重试。';
    if(submissionAccessStatus==='stale'||(submissionAccessStatus==='ready'&&submissionAccess?.revision!==revision))return '任务版本已变化，请刷新任务后再提交。';
    if(submissionAccessStatus==='ready'&&submissionAccess?.canSubmit===false)return '当前账号无本任务提交权限；请联系负责人核对分工或刷新任务。';
    return canSubmitSelected()?'已核验本次提交权限；选择文件时仍会重新核验。':'提交权限需要重新核验，请刷新任务。';
  }
  function updateTaskSubmissionControls(){
    const button=byId('task-upload');if(button)button.disabled=busy||taskManagementPending()||taskUploadPending()||!canSubmitSelected();
    const note=byId('task-submission-access-message');if(note){note.textContent=taskSubmissionWords();note.classList.toggle('error',['error','stale','unavailable'].includes(submissionAccessStatus)||(submissionAccessStatus==='ready'&&submissionAccess?.revision!==revision));}
  }
  async function taskViewCall(name,input,context,current=()=>true){
    const result=await api[name](input);
    // Check actor and view before interpreting even a 401 from a previous task/login.
    if(!sameTaskView(context)||!current())throw {code:'STALE_TASK_VIEW'};
    if(!result?.ok){if(result?.error?.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message',result.error.message||'当前登录已失效，请重新登录。',true);}throw result?.error||{code:'INVALID_RESPONSE',message:'任务状态无法确认，请刷新后重试。'};}
    return result.value;
  }
  async function loadTaskSubmissionAccess(refreshHistory=false){
    const context=taskManagementContext();if(!context)return false;const at=++submissionAccessEpoch;submissionAccess=null;submissionAccessStatus='pending';updateTaskSubmissionControls();
    if(typeof api?.getTaskSubmissionAccess!=='function'){submissionAccessStatus='unavailable';updateTaskSubmissionControls();return false;}
    try{
      const input={teamId:context.teamId,taskId:context.taskId},current=()=>at===submissionAccessEpoch&&sameTaskManagement(context);
      if(refreshHistory){const history=await taskViewCall('getSubmissions',input,context,current);if(!current())return false;revision=history.revision;submissions=history.submissions;renderDetail();}
      const value=await taskViewCall('getTaskSubmissionAccess',input,context,current);if(!current())return false;
      if(typeof value?.canSubmit!=='boolean'||!Number.isSafeInteger(value.revision)||value.revision<0||(value.canSubmit&&value.revision===Number.MAX_SAFE_INTEGER))throw {code:'INVALID_RESPONSE'};
      submissionAccess={...value,context};submissionAccessStatus='ready';return true;
    }catch{if(at===submissionAccessEpoch&&sameTaskManagement(context)){submissionAccess=null;submissionAccessStatus='error';}return false;}
    finally{if(at===submissionAccessEpoch&&sameTaskManagement(context))updateTaskSubmissionControls();}
  }
  function resetTaskManagement(){taskManagementEpoch++;taskManagementState=null;taskManagementMembers=[];taskManagementHasMore=false;taskManagementQuery='';taskManagementChosen='';taskManagementWorking=false;taskManagementNeedsRefresh=false;taskManagementMessage='';taskManagementError=false;byId('task-management')?.remove();}
  function taskManagementFeedback(text,error=false){taskManagementMessage=text;taskManagementError=error;const node=byId('task-management-message');if(node){node.textContent=text;node.classList.toggle('error',error);}}
  function updateTaskManagementControls(){
    if(!byId('task-management'))return;const locked=busy||taskManagementWorking||taskManagementPending()||taskUploadPending(),ready=!!session&&!!selected&&taskManagementState?.canManage===true&&!taskManagementNeedsRefresh;
    for(const id of ['task-management-search','task-management-search-button','task-management-member'])byId(id).disabled=locked||!ready;
    byId('task-management-more').disabled=locked||!ready;byId('task-management-more').hidden=!taskManagementHasMore;
    byId('task-management-assign').disabled=locked||!ready||!taskManagementMembers.some(member=>member.id===taskManagementChosen)||taskManagementState.status==='closed';
    byId('task-management-return').disabled=locked||!ready||taskManagementState.status!=='submitted';
    byId('task-management-refresh').disabled=locked;
  }
  function fillTaskManagementMembers(){const select=byId('task-management-member');if(!select)return;select.replaceChildren();const prompt=el('option',taskManagementMembers.length?'选择接收此任务的成员':'当前没有已加载的候选成员');prompt.value='';select.append(prompt);for(const member of taskManagementMembers){const option=el('option',member.displayName+' · '+(labels[member.role]||'岗位待核对'));option.value=member.id;select.append(option);}select.value=taskManagementChosen;}
  function renderTaskManagement(){
    if(!taskManagementState?.canManage)return null;
    const panel=el('section',undefined,'task-management');panel.id='task-management';panel.setAttribute('aria-label','任务分工与退回');
    const heading=el('div',undefined,'task-management-heading'),title=el('h3','任务分工与退回'),refresh=el('button','重新读取分工','button');refresh.id='task-management-refresh';refresh.type='button';refresh.addEventListener('click',async()=>{const context=taskManagementContext();resetTaskSubmissionAccess();await loadTaskManagement();if(sameTaskManagement(context))void loadTaskSubmissionAccess(true);});heading.append(title,refresh);panel.append(heading);
    const current=el('p',undefined,'identity-note');current.id='task-management-current';current.textContent=taskManagementState.assignees.length?'当前分工：'+taskManagementState.assignees.map(member=>member.displayName+'（'+(labels[member.role]||'岗位待核对')+'）').join('、'):'当前没有有效分工。';if(taskManagementState.hasMoreAssignees)current.append(document.createTextNode(' 还有其他当前分工未列出。'));panel.append(current);
    panel.append(el('p','采集任务仅可指派给本团队实习生或助理。改派会替换本任务全部当前分工；原有附件不会自动开放给新成员。','identity-note'));
    const searchWrap=el('div',undefined,'task-management-search-row'),search=el('input');search.id='task-management-search';search.type='search';search.maxLength=80;search.value=taskManagementQuery;search.placeholder='按成员姓名查找';search.setAttribute('aria-label','查找可指派成员');const searchButton=el('button','查找成员','button');searchButton.id='task-management-search-button';searchButton.type='button';searchButton.addEventListener('click',()=>void searchTaskManagementMembers());search.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void searchTaskManagementMembers();}});search.addEventListener('input',()=>{taskManagementQuery=search.value;taskManagementChosen='';taskManagementMembers=[];taskManagementHasMore=false;fillTaskManagementMembers();updateTaskManagementControls();});searchWrap.append(search,searchButton);panel.append(searchWrap);
    const selectLabel=el('label','接收任务的成员');selectLabel.htmlFor='task-management-member';const select=el('select');select.id='task-management-member';select.setAttribute('aria-label','接收任务的成员');select.addEventListener('change',()=>{taskManagementChosen=taskManagementMembers.some(member=>member.id===select.value)?select.value:'';updateTaskManagementControls();});const more=el('button','继续加载成员','button');more.id='task-management-more';more.type='button';more.hidden=!taskManagementHasMore;more.addEventListener('click',()=>void searchTaskManagementMembers(true));panel.append(selectLabel,select,more);
    const prompt=el('option','选择接收此任务的成员');prompt.value='';select.append(prompt);for(const member of taskManagementMembers){const option=el('option',member.displayName+' · '+(labels[member.role]||'岗位待核对'));option.value=member.id;select.append(option);}select.value=taskManagementChosen;
    const actions=el('div',undefined,'task-management-actions'),assign=el('button','确认改派并替换当前分工','button primary'),returned=el('button','退回补充资料','button');assign.type=returned.type='button';assign.id='task-management-assign';returned.id='task-management-return';assign.addEventListener('click',()=>void mutateTaskManagement('assign'));returned.addEventListener('click',()=>void mutateTaskManagement('return'));actions.append(assign,returned);panel.append(actions,el('p','退回只将已提交任务改为待补充，不代表形成审计结论。','identity-note'));
    const feedback=el('p',taskManagementMessage,'feedback'+(taskManagementError?' error':''));feedback.id='task-management-message';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');panel.append(feedback);return panel;
  }
  async function taskManagementCall(name,input,context){
    const result=await api[name](input);if(!sameAccountSessionsActor(context.actor))throw {code:'STALE_TASK_MANAGEMENT'};
    if(!result?.ok&&result?.error?.code==='SIGN_IN_REQUIRED'){showLogin();message('login-message',result.error.message||'当前登录已失效，请重新登录。',true);throw result.error;}
    if(!sameTaskManagement(context))throw {code:'STALE_TASK_MANAGEMENT'};if(!result?.ok)throw result?.error||{code:'INVALID_RESPONSE'};return result.value;
  }
  async function loadTaskManagement(){
    if(!taskManagementReady())return false;const context=taskManagementContext();if(!context)return false;const at=++taskManagementEpoch;taskManagementWorking=true;taskManagementChosen='';taskManagementMembers=[];taskManagementHasMore=false;taskManagementQuery='';updateTaskManagementControls();
    try{
      const value=await taskManagementCall('getTaskManagement',{teamId:context.teamId,taskId:context.taskId},context);if(at!==taskManagementEpoch)return false;
      taskManagementState=value.canManage?value:null;taskManagementNeedsRefresh=false;taskManagementMessage='';taskManagementError=false;
      if(!value.canManage){renderDetail();return true;}selected.status=value.status;if(value.revision!==revision)resetTaskSubmissionAccess('stale');const task=tasks.find(item=>item.id===context.taskId);if(task)task.status=value.status;renderTasks();renderDetail();
      const data=await taskManagementCall('listTaskAssignees',{teamId:context.teamId,taskId:context.taskId,limit:20},context);if(at!==taskManagementEpoch)return false;
      taskManagementMembers=data.members;taskManagementHasMore=data.hasMore;renderDetail();return true;
    }catch(error){if(at===taskManagementEpoch&&sameTaskManagement(context)){taskManagementState=null;taskManagementMembers=[];taskManagementChosen='';renderDetail();message('workspace-message',error.message||'任务管理状态无法确认，请重新读取任务。',true);}return false;}
    finally{if(at===taskManagementEpoch&&sameTaskManagement(context)){taskManagementWorking=false;updateTaskManagementControls();}}
  }
  async function searchTaskManagementMembers(append=false){
    if(busy||taskManagementWorking||taskManagementPending()||taskUploadPending()||taskManagementNeedsRefresh||!taskManagementState?.canManage)return;const context=taskManagementContext();if(!context)return;const at=++taskManagementEpoch,query=taskManagementQuery;taskManagementWorking=true;taskManagementChosen='';const input={teamId:context.teamId,taskId:context.taskId,q:query,limit:20};if(append&&taskManagementMembers.length)input.after=taskManagementMembers.at(-1).id;else{taskManagementMembers=[];taskManagementHasMore=false;}updateTaskManagementControls();
    try{const data=await taskManagementCall('listTaskAssignees',input,context);if(at!==taskManagementEpoch)return;taskManagementMembers=append?taskManagementMembers.concat(data.members):data.members;taskManagementHasMore=data.hasMore;taskManagementFeedback(data.members.length?'请选择接收任务的成员，再确认改派。':'没有匹配的可指派成员。');renderDetail();}
    catch(error){if(at===taskManagementEpoch&&sameTaskManagement(context)){taskManagementMembers=[];taskManagementChosen='';taskManagementHasMore=false;taskManagementNeedsRefresh=true;taskManagementFeedback(error.message||'成员列表无法确认，请重新读取分工。',true);if(error.code==='HTTP_404')taskManagementState=null;renderDetail();}}
    finally{if(at===taskManagementEpoch&&sameTaskManagement(context)){taskManagementWorking=false;updateTaskManagementControls();}}
  }
  async function mutateTaskManagement(action){
    if(busy||taskManagementWorking||taskManagementPending()||taskUploadPending()||taskManagementNeedsRefresh||!taskManagementState?.canManage)return;
    const context=taskManagementContext();if(!context||taskManagementState.status==='closed'||(action==='return'&&taskManagementState.status!=='submitted'))return;
    const member=taskManagementMembers.find(item=>item.id===taskManagementChosen);if(action==='assign'&&!member){taskManagementFeedback('请先选择本次可指派成员。',true);return;}
    const expected=taskManagementState.revision,input={teamId:context.teamId,taskId:context.taskId,revision:expected,...(action==='assign'?{userId:member.id}:{})},operation={context};taskManagementMutation=operation;resetTaskSubmissionAccess();updateTaskManagementControls();taskManagementFeedback(action==='assign'?'正在更新任务分工…':'正在退回任务，原提交记录将保留…');let confirmed=false;
    try{
      const value=await taskManagementCall(action==='assign'?'assignTask':'returnTask',input,context);if(value?.revision!==expected+1)throw {code:'INVALID_RESPONSE'};confirmed=true;taskManagementNeedsRefresh=true;taskManagementChosen='';if(action==='return')selected.status='returned';
      const read=await loadTaskManagement();if(sameTaskManagement(context)){if(read)await loadTaskSubmissionAccess(true);if(!sameTaskManagement(context))return;taskManagementFeedback(read?(action==='assign'?'任务已改派，当前分工已重新读取。':'任务已退回补充，原提交记录保持。'):'任务已更新，但当前状态刷新失败，请刷新任务核对。',!read);message('workspace-message',read?(action==='assign'?'任务分工已更新。':'任务已退回，采集员可补充后重新提交。'):'任务已更新，但当前状态刷新失败，请刷新任务核对。',!read);}
    }catch(error){if(sameTaskManagement(context)){taskManagementChosen='';taskManagementMembers=[];taskManagementHasMore=false;taskManagementNeedsRefresh=true;const uncertain=passwordChangeUncertain(error);const text=confirmed?'任务已更新，但刷新无法确认，请重新读取任务。':uncertain?'未能确认操作结果；请求可能已完成，请重新读取任务核对，避免重复操作。':error.code==='HTTP_409'?'资料或分工已更新，请重新读取后再操作。':error.message||'任务操作未通过，请重新读取当前授权。';taskManagementFeedback(text,true);if(error.code==='HTTP_404')taskManagementState=null;renderDetail();message('workspace-message',text,true);}}
    finally{if(taskManagementMutation===operation)taskManagementMutation=null;if(sameAccountSessionsActor(context.actor))renderDetail();updateTaskManagementControls();updateTaskSubmissionControls();if(sameAccountSessionsActor(context.actor)&&context.teamId===teamId&&context.taskId===selected?.id&&context.view!==viewEpoch)void loadTaskManagement();}
  }
  function detailEmpty(){const wrap=el('div',undefined,'detail-empty');wrap.append(el('span','▤','empty-symbol'),el('h2','从左侧选择任务'),el('p','任务要求和你的提交记录将在这里显示。'));byId('task-detail').replaceChildren(wrap);}
  function statusChip(status){return el('span',statuses[status]||'状态待核对','status-chip '+status);}
  function renderTasks(){const list=byId('task-list');list.replaceChildren();byId('task-count').textContent=tasks.length?tasks.length+' 项已加载':'';byId('load-more').hidden=!hasMore;
    if(!tasks.length){list.append(el('p','当前没有可见的采集任务。','list-empty'));return;}
    for(const task of tasks){const button=el('button',undefined,'task-button'+(selected?.id===task.id?' selected':''));button.type='button';button.setAttribute('aria-pressed',String(selected?.id===task.id));button.append(statusChip(task.status),el('strong',task.title),el('small','查看任务要求与我的提交'));button.addEventListener('click',()=>selectTask(task.id));list.append(button);}}
  function renderDetail(){if(!selected){detailEmpty();return;}const heading=el('div',undefined,'detail-heading');heading.append(el('h2',selected.title),statusChip(selected.status));const label=el('p','采集要求','detail-label');const description=el('div',selected.instructions,'instructions');
    const upload=el('div',undefined,'upload-area'),words=el('div');words.append(el('strong','提交此任务所需资料'),el('p','每份不超过12 MiB；请选择合成演示文件。'));const uploadButton=el('button','选择文件并提交','button primary');uploadButton.id='task-upload';uploadButton.type='button';uploadButton.setAttribute('aria-describedby','task-submission-access-message');uploadButton.addEventListener('click',uploadSelected);const accessNote=el('p',taskSubmissionWords());accessNote.id='task-submission-access-message';accessNote.setAttribute('role','status');accessNote.setAttribute('aria-live','polite');words.append(accessNote);upload.append(words,uploadButton);
    const historyTitle=el('h3','我的提交记录'),list=el('ul',undefined,'submission-list');
    if(!submissions.length)list.append(el('li','尚无提交记录。','submission-empty'));
    for(const item of submissions){const row=el('li',undefined,'submission-item'),info=el('div');info.append(el('strong',item.filename),el('small',formatSize(item.byteLength)+' · '+new Date(item.createdAt).toLocaleString('zh-CN')),el('small','SHA-256 '+item.sha256));const download=el('button','下载原件','button');download.type='button';download.disabled=busy;download.addEventListener('click',()=>downloadItem(item.attachmentId));row.append(info,download);list.append(row);}
    const management=renderTaskManagement();byId('task-detail').replaceChildren(heading,label,description,...(management?[management]:[]),upload,historyTitle,list);updateTaskManagementControls();updateTaskSubmissionControls();}
  function formatSize(bytes){return bytes<1024?bytes+' B':bytes<1024*1024?(bytes/1024).toFixed(1)+' KiB':(bytes/1024/1024).toFixed(2)+' MiB';}
  async function loadTasks(append=false){
    if(!session||!teamId)return;if(!append)resetTaskManagement();resetTaskSubmissionAccess();const context={actor:accountSessionsActor(),teamId,view:++viewEpoch};setBusy(true);message('workspace-message','正在读取获授权任务…');
    try{const query={teamId:context.teamId,q:byId('search').value,limit:30};if(append&&tasks.length)query.after=tasks.at(-1).id;const data=await taskViewCall('listTasks',query,context);if(!sameTaskView(context))return;tasks=append?tasks.concat(data.tasks):data.tasks;hasMore=data.hasMore;if(!append){selected=null;submissions=[];revision=0;renderDetail();}else if(selected)void loadTaskSubmissionAccess();renderTasks();message('workspace-message','任务列表已更新。');}
    catch(error){if(sameTaskView(context))message('workspace-message',error.message,true);}
    finally{if(sameTaskView(context))setBusy(false);}
  }
  async function selectTask(taskId){
    if(!session||!teamId)return;resetTaskManagement();resetTaskSubmissionAccess();const context={actor:accountSessionsActor(),teamId,taskId,view:++viewEpoch};setBusy(true);message('workspace-message','正在读取任务…');
    try{const key={teamId:context.teamId,taskId};const [detail,history]=await Promise.all([taskViewCall('getTask',key,context),taskViewCall('getSubmissions',key,context)]);if(!sameTaskView(context))return;selected=detail.task;submissions=history.submissions;revision=history.revision;renderTasks();renderDetail();message('workspace-message','只展示当前任务和你的提交记录。');void loadTaskSubmissionAccess();void loadTaskManagement();return context;}
    catch(error){if(sameTaskView(context)){selected=null;submissions=[];revision=0;resetTaskSubmissionAccess();renderDetail();message('workspace-message',error.message,true);}}
    finally{if(sameTaskView(context)){setBusy(false);renderDetail();}}
  }
  async function uploadSelected(){
    if(!selected||busy||taskManagementPending()||taskUploadPending()||!canSubmitSelected())return;
    const context=taskManagementContext(),expected=revision,operation={context};taskUploadOperation=operation;resetTaskSubmissionAccess();setBusy(true);const uploadBusyEpoch=busyEpoch;message('workspace-message','请选择资料；确认后将提交至本机团队服务。');
    try{
      const result=await taskViewCall('chooseAndUpload',{teamId:context.teamId,taskId:context.taskId,revision:expected},context);if(!sameTaskManagement(context))return;
      if(result.canceled){await loadTaskSubmissionAccess();if(sameTaskManagement(context))message('workspace-message','已取消，未提交资料。');return;}
      const refreshed=await selectTask(context.taskId);if(!sameTaskManagement(refreshed))return;const updated=tasks.find(task=>task.id===context.taskId);if(updated)updated.status=selected.status;renderTasks();message('workspace-message','资料已提交，原件与提交记录已保存。');
    }catch(error){if(sameTaskManagement(context)){resetTaskSubmissionAccess();message('workspace-message',error.message||'提交结果无法确认，请刷新任务后核对。',true);}}
    finally{if(taskUploadOperation===operation)taskUploadOperation=null;if(sameTaskManagement(context)&&busyEpoch===uploadBusyEpoch)setBusy(false);if(sameAccountSessionsActor(context.actor)){updateTaskManagementControls();updateTaskSubmissionControls();}}
  }
  async function downloadItem(attachmentId){
    if(!selected||busy)return;const context=taskManagementContext();setBusy(true);const downloadBusyEpoch=busyEpoch;message('workspace-message','正在核验原件下载权限…');
    try{const result=await taskViewCall('downloadAttachment',{teamId:context.teamId,taskId:context.taskId,attachmentId},context,()=>sameTaskManagement(context));if(sameTaskManagement(context))message('workspace-message',result.canceled?'已取消，未保存副本。':'原件副本已保存：'+result.filename);}
    catch(error){if(sameTaskManagement(context))message('workspace-message',error.message||'原件保存结果无法确认，请核对后重试。',true);}
    finally{if(sameTaskManagement(context)&&busyEpoch===downloadBusyEpoch){setBusy(false);renderDetail();}}
  }
  async function enter(value){if(!deviceApiReady()||!validDeviceSnapshot(value?.device)||!deviceBusinessReady(value.device)){await acceptAuthenticatedSession(value);return;}accountIdentityEpoch++;resetBusinessRole();resetMemberManagement();taskUploadOperation=null;resetTaskSubmissionAccess();selected=null;submissions=[];revision=0;renderDetail();resetTaskManagement();resetRecovery(true,true);resetAccountSessions();resetPasswordChange();resetWechat(false);resetActivation(true,true);resetFirstAdmin(true,true);resetProvisioning();resetRecoveryReviews();resetInvitations();administrationTeams=[];session=value;viewEpoch++;clearPhoneProof();message('phone-bind-message','');byId('phone-bind-panel').open=false;byId('login-view').hidden=true;byId('workspace-view').hidden=false;byId('session-actions').hidden=false;byId('account-name').textContent=session.account.displayName;byId('password').value='';const select=byId('team-select');select.replaceChildren();for(const member of session.memberships){const option=el('option',member.teamId);option.value=member.teamId;select.append(option);}teamId=session.memberships[0]?.teamId||'';invitationTeamId=teamId;rebuildInvitationTeams();updateRole();void loadIdentityMethods();void loadOnboardingStatus();void loadInvitationAccess();void loadProvisioningAccess();void loadRecoveryReviewsAccess();void loadTeamAdministration();void loadMemberManagementAccess();void loadReplacementReviewAccess();void loadBusinessRoleAccess();if(teamId)void loadTasks();else{tasks=[];renderTasks();detailEmpty();message('workspace-message','当前账号尚未获指派审计角色或资料权限。');}}
  function updateRole(){byId('role-label').textContent=labels[session?.memberships.find(member=>member.teamId===teamId)?.role]||'未指派角色';}
  byId('login-form').addEventListener('submit',async event=>{
    event.preventDefault();if(deviceGateActive()){if(deviceSnapshot?.state==='enrollment_required'&&!deviceLocalIssue)await enrollCurrentDevice();return;}if(busy||deviceAction)return;if(!deviceApiReady()){suspendDeviceView('当前客户端设备接口未更新，请更新客户端后重试。');return;}
    resetRecovery(true,true);resetWechat();resetActivation(true,true);resetFirstAdmin(true,true);const phoneMode=byId('login-mode').value==='phone';if(phoneMode&&(!methodsReady||!methods.phonePassword)){message('login-message','手机号登录尚未开放。',true);return;}
    const operation=beginDeviceAction('login'),input=phoneMode?{phone:byId('username').value,password:byId('password').value}:{username:byId('username').value,password:byId('password').value};setBusy(true);const owner=busyEpoch;message('login-message','正在登录并核验当前电脑…');
    try{const result=await api[phoneMode?'loginPhone':'login'](input);if(!currentDeviceAction(operation))return;byId('password').value='';if(!result?.ok)throw result?.error||{code:'INVALID_RESPONSE'};message('login-message','');await acceptAuthenticatedSession(result.value);}
    catch(error){if(currentDeviceAction(operation)){byId('password').value='';message('login-message',error.message||'登录或设备核验未完成，请重试。',true);}}
    finally{if(currentDeviceAction(operation)){deviceAction=null;if(busyEpoch===owner)setBusy(false);updateIdentityControls();void pollDeviceStatus();}}
  });
  byId('login-mode').addEventListener('change',()=>{resetTaskSubmissionAccess();resetRecovery(true,true);resetWechat();resetActivation(true,true);resetFirstAdmin(true,true);byId('username').value='';byId('password').value='';clearPhoneProof();message('login-message','');byId('username').placeholder=byId('login-mode').value==='phone'?'输入已验证绑定的手机号':'输入团队账号';byId('username').inputMode=byId('login-mode').value==='phone'?'tel':'text';});
  byId('bind-phone').addEventListener('input',()=>{clearPhoneProof(false);message('phone-bind-message','手机号已改变，请重新获取验证码。');});
  byId('send-bind-code').addEventListener('click',async()=>{if(busy||!session)return;if(!methodsReady||!methods.phoneVerification){message('phone-bind-message','短信验证服务尚未开通，未发送验证码。',true);return;}const at=viewEpoch,phone=byId('bind-phone').value;clearPhoneProof(false);setBusy(true);message('phone-bind-message','正在请求短信验证…');try{const result=await call('requestPhoneBind',{phone});if(at!==viewEpoch||byId('bind-phone').value!==phone)return;challengeId=result.challengeId;challengeExpiresAt=result.expiresAt;challengePhone=phone;message('phone-bind-message','验证码发送请求已完成，请填写收到的验证码及当前账号密码。');}catch(error){if(at===viewEpoch)message('phone-bind-message',error.message,true);}finally{if(at===viewEpoch)setBusy(false);}});
  byId('phone-bind-form').addEventListener('submit',async event=>{event.preventDefault();if(busy||!session)return;if(!challengeId||challengeExpiresAt<=Date.now()||byId('bind-phone').value!==challengePhone){clearPhoneProof(false);message('phone-bind-message','本次验证码已失效，请重新获取。',true);return;}const at=viewEpoch,proof={challengeId,code:byId('bind-code').value,currentPassword:byId('bind-current-password').value};let completed=false;setBusy(true);try{const result=await call('bindPhone',proof);if(at!==viewEpoch)return;completed=true;message('phone-bind-message','手机号已验证并绑定：'+result.phoneMasked);}catch(error){if(at===viewEpoch)message('phone-bind-message',error.message,true);}finally{if(at===viewEpoch){if(completed)clearPhoneProof();else{byId('bind-code').value='';byId('bind-current-password').value='';}setBusy(false);}}});
  byId('logout').addEventListener('click',()=>void exitDeviceSession());byId('device-exit').addEventListener('click',()=>void exitDeviceSession());byId('device-retry').addEventListener('click',()=>void reconnectCurrentDevice());for(const id of ['password','device-name'])byId(id).addEventListener('input',updateDeviceControls);byId('device-enroll-consent').addEventListener('change',updateDeviceControls);
  byId('refresh').addEventListener('click',()=>{void loadInvitationAccess();loadTasks();});byId('load-more').addEventListener('click',()=>loadTasks(true));byId('team-select').addEventListener('change',()=>{resetAccountSessions();resetPasswordChange();teamId=byId('team-select').value;invitationTeamId=teamId;rebuildInvitationTeams();updateRole();void loadInvitationAccess();loadTasks();});byId('search-form').addEventListener('submit',event=>{event.preventDefault();loadTasks();});
  if(!api){message('login-message','此页面需要审易桌面客户端，请从桌面启动入口打开。',true);byId('login-submit').disabled=true;}
  updateIdentityControls();updateOnboardingControls();updateMemberManagementControls();if(api){void loadIdentityMethods();void loadOnboardingStatus();devicePollTimer=setInterval(()=>void pollDeviceStatus(),1000);void pollDeviceStatus();}
})();
