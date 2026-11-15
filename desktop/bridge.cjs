'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {MAX_FILE_BYTES,ClientError} = require('./team-client.cjs');
const APP_URL = 'shenyi://app/index.html';
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function input(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key=>!keys.includes(key))) throw Error('操作参数无效。');
  for (const key of ['teamId','taskId','attachmentId','userId']) if (keys.includes(key) && (typeof value[key]!=='string'||!ID.test(value[key]))) throw Error('任务或成员标识无效。');
  return value;
}
async function readChosenFile(filename) {
  const handle = await fs.open(filename,'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size>MAX_FILE_BYTES) throw Error('请选择不超过12 MiB的文件。');
    const chunks=[]; let size=0;
    for (;;) { const buffer=Buffer.alloc(Math.min(65536,MAX_FILE_BYTES-size+1));const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;size+=bytesRead;if(size>MAX_FILE_BYTES)throw Error('资料超过12 MiB。');chunks.push(buffer.subarray(0,bytesRead)); }
    return {filename:path.basename(filename),bytes:Buffer.concat(chunks)};
  } finally { await handle.close(); }
}
function safeDownloadName(disposition) {
  let value='采集资料.bin';
  const match=/filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if(match)try{value=decodeURIComponent(match[1]);}catch{}
  return Array.from(path.basename(value).toWellFormed().replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,'_')).slice(0,160).join('')||'采集资料.bin';
}
function registerDesktopBridge({ipcMain,window,client,dialog}) {
  const channels=[];
  const safeError=error=>({ok:false,error:{code:error instanceof ClientError?error.code:'OPERATION_FAILED',message:error instanceof ClientError?error.message:'操作未完成，请刷新后重试。'}});
  function handle(name, action) {
    const channel='shenyi:'+name;channels.push(channel);
    ipcMain.handle(channel,async(event,arg)=>{
      if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==APP_URL)return {ok:false,error:{code:'UNTRUSTED_SENDER',message:'此页面不能访问桌面操作。'}};
      try{return {ok:true,value:await action(arg)};}catch(error){return safeError(error);}
    });
  }
  handle('login',arg=>client.login(input(arg,['username','password'])));
  handle('auth-methods',()=>client.getAuthMethods());
  handle('recovery-challenge',arg=>client.requestPasswordRecovery(input(arg,['phone'])));
  handle('recovery-complete',arg=>client.recoverPassword(input(arg,['challengeId','code','newPassword','recoveryProof'])));
  const noArgs=arg=>{if(arg!==undefined)throw Error('操作参数无效。');};
  handle('device-status',arg=>{noArgs(arg);return client.getDeviceStatus();});
  handle('device-enroll',arg=>client.enrollDevice(input(arg,['displayName','currentPassword','confirmed'])));
  handle('device-reconnect',arg=>{noArgs(arg);return client.reconnectDevice();});
  handle('member-management-access',arg=>{noArgs(arg);return client.getMemberManagementAccess();});
  handle('business-members',arg=>client.listTeamBusinessMembers(input(arg,['teamId','q','after','limit'])));
  handle('team-administrators',arg=>client.listTeamAdministrators(input(arg===undefined?{}:arg,['q','after','limit'])));
  handle('business-member-disable',arg=>client.disableTeamBusinessMember(input(arg,['teamId','userId','revision','currentPassword'])));
  handle('team-administrator-disable',arg=>client.disableTeamAdministrator(input(arg,['teamId','userId','revision','currentPassword'])));
  handle('recovery-review-status',arg=>{noArgs(arg);return client.getRecoveryReviewStatus();});
  handle('recovery-review-create',arg=>client.createRecoveryReviewRequest(input(arg,['challengeId','code'])));
  handle('recovery-review-access',arg=>{noArgs(arg);return client.getRecoveryReviewAccess();});
  handle('recovery-review-list',arg=>{noArgs(arg);return client.listRecoveryReviewRequests();});
  handle('recovery-review-decide',arg=>client.reviewRecoveryReviewRequest(input(arg,['requestId','decision','revision','currentPassword'])));
  handle('team-review-access',arg=>{noArgs(arg);return client.getTeamProvisioningAccess();});
  handle('team-review-list',arg=>{noArgs(arg);return client.listTeamProvisioningRequests();});
  handle('team-review-create',arg=>client.createTeamProvisioningRequest(input(arg,['teamName','adminPhone'])));
  handle('team-review-decide',arg=>client.reviewTeamProvisioningRequest(input(arg,['requestId','decision','revision','currentPassword'])));
  handle('team-administration',arg=>{noArgs(arg);return client.getTeamAdministration();});
  handle('first-admin-preview',arg=>client.previewFirstAdministrator(input(arg,['invitationCode','phone'])));
  handle('first-admin-challenge',arg=>client.requestFirstAdministratorActivation(input(arg,['invitationCode','phone'])));
  handle('first-admin-complete',arg=>client.activateFirstAdministrator(input(arg,['invitationCode','phone','challengeId','code','password','displayName','accept'])));
  handle('password-change',arg=>client.changeOwnPassword(input(arg,['currentPassword','newPassword'])));
  handle('account-sessions',arg=>client.listAccountSessions(input(arg===undefined?{}:arg,['limit','after'])));
  handle('account-session-revoke',arg=>client.revokeAccountSession(input(arg,['sessionId','currentPassword'])));
  handle('account-sessions-revoke-others',arg=>client.revokeOtherSessions(input(arg,['currentPassword'])));
  handle('account-sessions-revoke-all',arg=>client.revokeAllSessions(input(arg,['currentPassword'])));
  handle('onboarding-status',()=>client.getOnboardingStatus());
  handle('invitation-access',arg=>client.getInvitationAccess(input(arg,['teamId'])));
  handle('invitation-create',arg=>client.createEmployeeInvitation(input(arg,['teamId','phone','role'])));
  handle('invitation-list',arg=>client.listEmployeeInvitations(input(arg,['teamId'])));
  handle('invitation-revoke',arg=>client.revokeEmployeeInvitation(input(arg,['teamId','invitationId'])));
  handle('activation-preview',arg=>client.previewEmployeeInvitation(input(arg,['invitationCode','phone'])));
  handle('activation-challenge',arg=>client.requestEmployeeActivation(input(arg,['invitationCode','phone'])));
  handle('activation-complete',arg=>client.activateEmployee(input(arg,['invitationCode','phone','challengeId','code','password','displayName','accept'])));
  handle('phone-login',arg=>client.loginPhone(input(arg,['phone','password'])));
  handle('phone-challenge',arg=>client.requestPhoneBind(input(arg,['phone'])));
  handle('phone-bind',arg=>client.bindPhone(input(arg,['challengeId','code','currentPassword'])));
  handle('wechat-start',()=>client.startWechatLogin());
  handle('wechat-poll',()=>client.pollWechatLogin());
  handle('wechat-cancel',()=>client.cancelWechatLogin());
  handle('wechat-link',arg=>client.linkWechatAccount(input(arg,['phone','password'])));
  handle('session',()=>client.getSession());
  handle('logout',()=>client.logout());
  handle('tasks',arg=>client.listTasks(input(arg,['teamId','q','after','limit'])));
  handle('task',arg=>client.getTask(input(arg,['teamId','taskId'])));
  handle('task-submission-access',arg=>client.getTaskSubmissionAccess(input(arg,['teamId','taskId'])));
  handle('task-management',arg=>client.getTaskManagement(input(arg,['teamId','taskId'])));
  handle('task-assignees',arg=>client.listTaskAssignees(input(arg,['teamId','taskId','q','after','limit'])));
  handle('task-assign',arg=>client.assignTask(input(arg,['teamId','taskId','userId','revision'])));
  handle('task-return',arg=>client.returnTask(input(arg,['teamId','taskId','revision'])));
  handle('submissions',arg=>client.getSubmissions(input(arg,['teamId','taskId'])));
  handle('upload',async arg=>{
    input(arg,['teamId','taskId','revision']);
    if(!Number.isSafeInteger(arg.revision)||arg.revision<0||arg.revision>=Number.MAX_SAFE_INTEGER)throw Error('资料版本无效。');
    const assertSession=client.guardSession();
    async function assertSubmissionAccess(){
      assertSession();
      const access=await client.getTaskSubmissionAccess({teamId:arg.teamId,taskId:arg.taskId});
      assertSession();
      if(typeof access?.canSubmit!=='boolean'||!Number.isSafeInteger(access.revision)||access.revision<0||(access.canSubmit&&access.revision===Number.MAX_SAFE_INTEGER))throw new ClientError('INVALID_RESPONSE','资料提交权限状态无效，请刷新任务后重试。');
      if(access.revision!==arg.revision)throw new ClientError('HTTP_409','任务状态或版本已更新，请刷新后重试。',409);
      if(!access.canSubmit)throw new ClientError('UPLOAD_NOT_ALLOWED','当前任务不可提交资料，请刷新任务或联系项目负责人。',403);
    }
    // These fresh checks reduce local-file exposure; POST still authorizes and
    // performs the final version CAS because network and file IO are not atomic.
    await assertSubmissionAccess();
    const selected=await dialog.showOpenDialog(window,{title:'选择采集资料（合成演示）',properties:['openFile'],buttonLabel:'选择资料'});
    if(selected.canceled||selected.filePaths.length!==1)return {canceled:true};
    await assertSubmissionAccess();
    const file=await readChosenFile(selected.filePaths[0]);
    await assertSubmissionAccess();
    return client.upload(arg,file);
  });
  handle('download',async arg=>{
    input(arg,['teamId','taskId','attachmentId']);
    const assertSession=client.guardSession();
    assertSession();
    const file=await client.download(arg);
    assertSession();
    const selected=await dialog.showSaveDialog(window,{title:'保存采集资料副本',defaultPath:safeDownloadName(file.contentDisposition),buttonLabel:'保存副本'});
    if(selected.canceled||!selected.filePath)return {canceled:true};
    assertSession();
    const access=await client.checkAttachmentAccess(arg);
    assertSession();
    if(access?.canDownload!==true||Object.keys(access).length!==1)throw new ClientError('INVALID_RESPONSE','无法确认原件保存权限，请刷新任务后重试。');
    // The operating-system dialog owns path selection/overwrite confirmation.
    // Fresh HEAD reduces unfinished saves after revocation; network authority
    // and the subsequent local write are not one atomic transaction.
    await fs.writeFile(selected.filePath,file.bytes);
    return {saved:true,filename:path.basename(selected.filePath),byteLength:file.bytes.length};
  });
  return ()=>{for(const channel of channels)ipcMain.removeHandler(channel);client.clearSession();};
}
module.exports={APP_URL,registerDesktopBridge,readChosenFile,safeDownloadName};
