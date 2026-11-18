'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {MAX_FILE_BYTES,ClientError} = require('./team-client.cjs');
const {createTaskOriginalsExporter}=require('./task-originals-export.cjs');
const {createProjectMigrationManager}=require('./project-migration.cjs');
const {createProjectMaterialsManager}=require('./project-materials.cjs');
const {createMaterialPreviewManager}=require('./material-preview.cjs');
const {createMaterialPreviewWindow}=require('./material-preview-window.cjs');
const {createMaterialMaintenanceManager}=require('./material-maintenance.cjs');
const {createTaskSubmissionPreviewManager}=require('./task-submission-preview.cjs');
const {createCollectionWorkspaceManager}=require('./collection-workspace.cjs');
const {createWorkspaceFormalizationManager}=require('./workspace-formalization.cjs');
const {createMaterialPreservationExporter}=require('./material-preservation-export.cjs');
const {myDeviceQuery}=require('./my-device-client.cjs');
const {workspaceSourceInput}=require('./workspace-source-client.cjs');
const {createWorkspaceSourceExporter,workspaceSourceExportInput,workspaceSourceCancelInput}=require('./workspace-source-export.cjs');
const {createLedgerCheckBridge}=require('./ledger-check-bridge.cjs');
const {createWorkpaperBridge}=require('./workpaper-bridge.cjs');
const APP_URL = 'shenyi://app/index.html';
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
function input(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key=>!keys.includes(key))) throw Error('操作参数无效。');
  for (const key of ['teamId','projectId','taskId','attachmentId','submissionId','userId']) if (keys.includes(key) && (typeof value[key]!=='string'||!ID.test(value[key]))) throw Error('任务或成员标识无效。');
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
  const originalsExporter=createTaskOriginalsExporter({client,dialog,window});
  const projectMigration=createProjectMigrationManager({client,dialog,window});
  const projectMaterials=createProjectMaterialsManager({client,dialog,window});
  let materialPreview;
  let materialMaintenance;
  let submissionPreview;
  let workspaceCreation;
  let workspaceFormalization;
  let materialPreservationExport;
  let workspaceSourceExport;
  let ledgerCheckBridge;
  let workpaperBridge;
  const workpapers=()=>workpaperBridge??=createWorkpaperBridge({client,dialog,window});
  const ledgers=()=>ledgerCheckBridge??=createLedgerCheckBridge({client,dialog,window});
  const preservations=()=>materialPreservationExport??=createMaterialPreservationExporter({client,dialog,window});
  const formalizations=()=>workspaceFormalization??=createWorkspaceFormalizationManager({client,dialog,window});
  const sourceExports=()=>workspaceSourceExport??=createWorkspaceSourceExporter({client,dialog,window});
  const workspaces=()=>workspaceCreation??=createCollectionWorkspaceManager({client});
  const previews=()=>materialPreview??=(createMaterialPreviewManager({client,openWindow:hooks=>{submissionPreview?.closeAll();return createMaterialPreviewWindow({parent:window,...hooks});}}));
  const submissionPreviews=()=>submissionPreview??=(createTaskSubmissionPreviewManager({client,openWindow:hooks=>{materialPreview?.closeAll();return createMaterialPreviewWindow({parent:window,...hooks});}}));
  const maintenance=()=>materialMaintenance??=(createMaterialMaintenanceManager({client,dialog,window}));
  const closeMaterialPreview=()=>{materialPreview?.closeAll();submissionPreview?.closeAll();materialMaintenance?.closeAll();};
  const clearRendererResources=()=>{workpaperBridge?.clearAll();ledgerCheckBridge?.clearAll();materialPreservationExport?.closeAll();workspaceSourceExport?.closeAll();closeMaterialPreview();workspaceFormalization?.clearSource();};
  const parentContents=window.webContents;
  const parentNavigation=(_event,_url,_inPlace,isMainFrame)=>{if(isMainFrame!==false)clearRendererResources();};
  parentContents.on?.('did-start-navigation',parentNavigation);
  parentContents.on?.('render-process-gone',clearRendererResources);
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
  handle('project-migration-access',arg=>{noArgs(arg);return client.getProjectMigrationAccess();});
  handle('project-migration-teams',arg=>client.listProjectMigrationTeams(input(arg??{},['q','after','limit'])));
  handle('project-migration-owners',arg=>client.listProjectMigrationOwners(input(arg,['teamId','q','after','limit'])));
  handle('project-migration-source-open',arg=>{noArgs(arg);return projectMigration.chooseProjectMigrationSource();});
  handle('project-migration-approve',arg=>projectMigration.approveProjectMigration(input(arg,['handle','sourceSha256','teamId','ownerUserId','ownerRevision','read','manage','review','currentPassword','confirmed'])));
  handle('project-migration-receipt',arg=>client.getProjectMigrationReceipt(input(arg,['requestId'])));
  handle('project-migration-source-discard',arg=>projectMigration.discardProjectMigrationSource(input(arg,['handle'])));
  handle('device-status',arg=>{noArgs(arg);return client.getDeviceStatus();});
  handle('device-enroll',arg=>client.enrollDevice(input(arg,['displayName','currentPassword','confirmed'])));
  handle('device-reconnect',arg=>{noArgs(arg);return client.reconnectDevice();});
  handle('device-replacement-status',arg=>{noArgs(arg);return client.getDeviceReplacementStatus();});
  handle('device-replacement-request',arg=>client.requestDeviceReplacement(input(arg,['displayName','currentPassword','confirmed'])));
  handle('device-replacement-withdraw',arg=>client.withdrawDeviceReplacement(input(arg,['requestId','revision'])));
  handle('device-replacement-activate',async arg=>{
    let receipt;
    try{
      const value=await client.activateDeviceReplacement(input(arg,['requestId','revision','confirmed']),current=>{receipt=current;});
      receipt?.assertCurrent();return value;
    }catch(error){
      // This only clears the exact adopted login. A committed device switch
      // remains committed; never restore the old binding or clear a later actor.
      if(receipt)await receipt.rollback().catch(()=>{});throw error;
    }
  });
  handle('device-replacement-review-access',arg=>{noArgs(arg);return client.getDeviceReplacementReviewAccess();});
  handle('device-replacement-reviews',arg=>{noArgs(arg);return client.listDeviceReplacementReviews();});
  handle('device-replacement-review',arg=>client.reviewDeviceReplacement(input(arg,['requestId','revision','decision','currentPassword'])));
  handle('member-management-access',arg=>{noArgs(arg);return client.getMemberManagementAccess();});
  handle('business-role-management-access',arg=>{noArgs(arg);return client.getBusinessRoleManagementAccess();});
  handle('business-role-members',arg=>client.listBusinessRoleMembers(input(arg,['teamId','q','after','limit'])));
  handle('business-role-change',arg=>client.changeBusinessRole(input(arg,['teamId','userId','revision','role','currentPassword','confirmed'])));
  handle('administrator-business-role-access',arg=>{noArgs(arg);return client.getAdministratorBusinessRoleAccess();});
  handle('administrator-business-roles',arg=>client.listAdministratorBusinessRoles(input(arg===undefined?{}:arg,['q','after','limit'])));
  handle('administrator-business-role-change',arg=>client.changeAdministratorBusinessRole(input(arg,['userId','revision','role','currentPassword','confirmed'])));
  handle('project-access',arg=>{noArgs(arg);return client.getProjectAccess();});
  handle('project-material-access',arg=>client.getProjectMaterialAccess(input(arg,['teamId','projectId'])));
  handle('project-material-members',arg=>client.listProjectMaterialMembers(input(arg,['teamId','projectId','q','after','limit'])));
  handle('project-material-access-change',arg=>client.changeProjectMaterialAccess(input(arg,['teamId','projectId','projectRevision','userId','memberRevision','grantRevision','maintenanceRevision','read','import','review','close','maintain','currentPassword','confirmed'])));
  handle('project-material-import-open',arg=>projectMaterials.chooseProjectMaterialImport(input(arg,['teamId','projectId','projectRevision'])));
  handle('project-material-import-discard',arg=>projectMaterials.discardProjectMaterialImport(input(arg,['handle'])));
  handle('project-material-import',arg=>projectMaterials.importProjectMaterials(input(arg,['handle','teamId','projectId','projectRevision','sourceSha256','currentPassword','confirmed'])));
  handle('project-material-receipt',arg=>client.getProjectMaterialReceipt(input(arg,['teamId','projectId','requestId'])));
  handle('project-material-record',async arg=>{const target=input(arg,['teamId','projectId']),guard=client.guardSession();guard();const record=await client.getProjectMaterials(target);guard();return record;});
  handle('project-material-download',arg=>projectMaterials.downloadProjectMaterial(input(arg,['teamId','projectId','fileId'])));
  handle('project-material-preview',arg=>previews().previewProjectMaterial(input(arg,['requestId','teamId','projectId','fileId'])));
  handle('project-material-preview-close',arg=>{const value=input(arg,['previewId']);if(typeof value.previewId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.previewId))throw Error('预览标识无效。');return materialPreview?materialPreview.closeProjectMaterialPreview(value):{closed:false};});
  handle('project-material-attachment-open',arg=>maintenance().chooseProjectMaterialAttachment(input(arg,['requestId','teamId','projectId','projectRevision','materialRevision','recordSha256','nodeId','generationId'])));
  handle('project-material-attachment-discard',arg=>{const value=input(arg,['requestId']);if(typeof value.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.requestId))throw Error('原件选择标识无效。');return materialMaintenance?materialMaintenance.discardProjectMaterialAttachment(value):{discarded:false};});
  handle('project-material-attachment-commit',arg=>maintenance().commitProjectMaterialAttachment(input(arg,['requestId','teamId','projectId','projectRevision','materialRevision','recordSha256','nodeId','generationId','sha256','confirmed'])));
  handle('project-material-attachment-remove',arg=>maintenance().removeProjectMaterialAttachment(input(arg,['requestId','teamId','projectId','projectRevision','materialRevision','recordSha256','nodeId','generationId','fileId','reason','confirmed'])));
  handle('project-material-preservation-export',arg=>preservations().exportProjectMaterialPreservation(input(arg,['requestId','teamId','projectId','projectRevision','materialRevision','recordSha256','confirmed'])));
  handle('project-material-preservation-export-cancel',arg=>{const value=input(arg,['requestId']);if(Object.keys(value).length!==1||typeof value.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.requestId))throw Error('资料保全导出编号无效。');return materialPreservationExport?materialPreservationExport.cancelProjectMaterialPreservationExport(value):{canceled:false};});
  handle('project-material-change',arg=>projectMaterials.changeProjectMaterials(input(arg,['teamId','projectId','requestId','projectRevision','materialRevision','recordSha256','action','currentPassword','confirmed'])));
  handle('projects',arg=>client.listProjects(input(arg,['teamId','q','after','limit'])));
  handle('project',arg=>client.getProject(input(arg,['teamId','projectId'])));
  handle('project-members',arg=>client.listProjectMembers(input(arg,['teamId','projectId','q','after','limit'])));
  handle('project-access-change',arg=>client.changeProjectAccess(input(arg,['teamId','projectId','revision','userId','memberRevision','read','manage','review','currentPassword','confirmed'])));
  handle('project-tasks',arg=>client.listProjectTasks(input(arg,['teamId','projectId','q','after','limit'])));
  handle('project-task-create',arg=>client.createProjectTask(input(arg,['teamId','projectId','revision','title','instructions','confirmed'])));
  handle('project-submissions',arg=>client.listProjectSubmissions(input(arg,['teamId','projectId','taskId','after','limit'])));
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
  handle('invitation-list',arg=>client.listEmployeeInvitations(input(arg,['teamId','after','limit'])));
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
  handle('task-originals-export',arg=>originalsExporter.exportTaskOriginals(input(arg,['teamId','taskId','revision','submissionIds'])));
  handle('project-task-originals-export',arg=>originalsExporter.exportProjectTaskOriginals(input(arg,['teamId','projectId','taskId','revision','projectRevision','submissionIds'])));
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
  handle('project-submission-download',async arg=>{
    input(arg,['teamId','projectId','taskId','submissionId']);
    const assertSession=client.guardSession();assertSession();
    const file=await client.getProjectSubmissionFile(arg);assertSession();
    const selected=await dialog.showSaveDialog(window,{title:'保存项目采集原件副本',defaultPath:safeDownloadName(file.contentDisposition),buttonLabel:'保存副本'});
    if(selected.canceled||!selected.filePath)return {canceled:true};assertSession();
    const access=await client.authorizeProjectSubmissionDownload(arg);assertSession();
    if(access?.canDownload!==true||Object.keys(access).length!==1)throw new ClientError('INVALID_RESPONSE','无法确认资料保存权限，请刷新项目后重试。');
    // OS selection owns overwrite consent. Permission and a local write are
    // not a distributed transaction; recheck the same narrow file first.
    await fs.writeFile(selected.filePath,file.bytes);
    return {saved:true,filename:path.basename(selected.filePath),byteLength:file.bytes.length};
  });
  handle('task-submission-preview',arg=>submissionPreviews().previewTaskSubmission(input(arg,['requestId','teamId','taskId','revision','submissionId'])));
  handle('project-submission-preview',arg=>submissionPreviews().previewProjectSubmission(input(arg,['requestId','teamId','projectId','projectRevision','taskId','revision','submissionId'])));
  handle('task-submission-preview-close',arg=>{const value=input(arg,['previewId']);if(Object.keys(value).length!==1||typeof value.previewId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.previewId))throw Error('原件预览标识无效。');return submissionPreview?submissionPreview.closeTaskSubmissionPreview(value):{closed:false};});
  handle('collection-workspace-create',arg=>workspaces().createCollectionWorkspace(input(arg,['requestId','teamId','title','read','manage','review','currentPassword','confirmed'])));
  handle('collection-workspace-receipt',arg=>client.getCollectionWorkspaceReceipt(input(arg,['teamId','requestId'])));
  handle('workspace-formalization',arg=>client.getWorkspaceFormalization(input(arg,['teamId','projectId'])));
  handle('workspace-formalization-source-open',arg=>formalizations().chooseWorkspaceFormalizationSource(input(arg,['teamId','projectId','projectRevision'])));
  handle('workspace-formalization-confirm',arg=>formalizations().confirmWorkspaceFormalization(input(arg,['handle','sourceSha256','teamId','projectId','projectRevision','currentPassword','businessConfirmed','confirmed'])));
  handle('workspace-formalization-receipt',arg=>client.getWorkspaceFormalizationReceipt(input(arg,['teamId','projectId','requestId'])));
  handle('workspace-formalization-source-discard',arg=>formalizations().discardWorkspaceFormalizationSource(input(arg,['handle'])));
  handle('my-device-overview',arg=>client.getMyDeviceOverview(myDeviceQuery(arg,(code,message)=>new ClientError(code,message))));
  handle('workspace-source-access',arg=>client.getWorkspaceSourceAccess(workspaceSourceInput(arg,'access',(...args)=>new ClientError(...args))));
  handle('workspace-source-members',arg=>client.listWorkspaceSourceMembers(workspaceSourceInput(arg,'members',(...args)=>new ClientError(...args))));
  handle('workspace-source-access-change',arg=>client.changeWorkspaceSourceAccess(workspaceSourceInput(arg,'change',(...args)=>new ClientError(...args))));
  handle('workspace-source',arg=>client.getWorkspaceSource(workspaceSourceInput(arg,'access',(...args)=>new ClientError(...args))));
  handle('workspace-source-export',arg=>{const value=workspaceSourceExportInput(arg);return sourceExports().exportWorkspaceSource(value);});
  handle('workspace-source-export-cancel',arg=>{const value=workspaceSourceCancelInput(arg);return workspaceSourceExport?workspaceSourceExport.cancelWorkspaceSourceExport(value):{canceled:false};});
  handle('ledger-check-view-open',arg=>ledgers().openLedgerCheckView(arg));
  handle('ledger-check-view-close',arg=>ledgers().closeLedgerCheckView(arg));
  handle('ledger-check-projects',arg=>ledgers().listLedgerCheckProjects(arg));
  handle('ledger-check-access',arg=>ledgers().getLedgerCheckAccess(arg));
  handle('ledger-check-members',arg=>ledgers().listLedgerCheckMembers(arg));
  handle('ledger-check-access-change',arg=>ledgers().changeLedgerCheckAccess(arg));
  handle('ledger-check-history',arg=>ledgers().listLedgerCheckSnapshots(arg));
  handle('ledger-check-snapshot',arg=>ledgers().getLedgerCheckSnapshot(arg));
  handle('ledger-check-import-receipt',arg=>ledgers().getLedgerCheckImportReceipt(arg));
  handle('ledger-check-source-open',arg=>ledgers().chooseLedgerCheckSource(arg));
  handle('ledger-check-source-confirm',arg=>ledgers().confirmLedgerCheckImport(arg));
  handle('ledger-check-source-discard',arg=>ledgers().discardLedgerCheckSource(arg));
  handle('workpaper-view-open',arg=>workpapers().openWorkpaperView(arg));
  handle('workpaper-view-close',arg=>workpapers().closeWorkpaperView(arg));
  handle('workpaper-projects',arg=>workpapers().listWorkpaperProjects(arg));
  handle('workpaper-access',arg=>workpapers().getWorkpaperAccess(arg));
  handle('workpaper-members',arg=>workpapers().listWorkpaperMembers(arg));
  handle('workpaper-access-change',arg=>workpapers().changeWorkpaperAccess(arg));
  handle('workpaper-data',arg=>workpapers().getWorkpaperData(arg));
  handle('workpaper-versions',arg=>workpapers().listWorkpaperVersions(arg));
  handle('workpaper-record',arg=>workpapers().getWorkpaperRecord(arg));
  handle('workpaper-form',arg=>workpapers().getWorkpaperForm(arg));
  handle('workpaper-entries-save',arg=>workpapers().saveWorkpaperEntries(arg));
  handle('workpaper-receipt',arg=>workpapers().getWorkpaperReceipt(arg));
  handle('workpaper-source-open',arg=>workpapers().chooseWorkpaperSource(arg));
  handle('workpaper-source-confirm',arg=>workpapers().confirmWorkpaperImport(arg));
  handle('workpaper-source-resume',arg=>workpapers().resumeWorkpaperImport(arg));
  handle('workpaper-import-query',arg=>workpapers().queryWorkpaperImport(arg));
  handle('workpaper-import-cancel',arg=>workpapers().cancelWorkpaperSourceImport(arg));
  handle('workpaper-source-discard',arg=>workpapers().discardWorkpaperSource(arg));
  handle('workpaper-export',arg=>workpapers().exportWorkpapers(arg));
  handle('workpaper-export-cancel',arg=>workpapers().cancelWorkpaperExport(arg));
  handle('billing-access',arg=>client.getBillingAccess(arg));
  handle('billing-overview',arg=>client.getBillingOverview(arg));
  handle('billing-orders',arg=>client.listBillingOrders(arg));
  handle('billing-order-create',arg=>client.createBillingOrder(arg));
  handle('billing-order-reconcile',arg=>client.reconcileBillingOrder(arg));
  handle('billing-page-reconcile',arg=>client.reconcileBillingPage(arg));
  return ()=>{for(const channel of channels)ipcMain.removeHandler(channel);parentContents.removeListener?.('did-start-navigation',parentNavigation);parentContents.removeListener?.('render-process-gone',clearRendererResources);workpaperBridge?.dispose();ledgerCheckBridge?.dispose();materialPreview?.dispose();submissionPreview?.dispose();materialMaintenance?.dispose();workspaceCreation?.dispose();workspaceFormalization?.dispose();materialPreservationExport?.dispose();workspaceSourceExport?.dispose();projectMaterials.dispose();projectMigration.dispose();client.clearSession();};
}
module.exports={APP_URL,registerDesktopBridge,readChosenFile,safeDownloadName};
