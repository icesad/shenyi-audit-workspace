'use strict';
// Real Electron renderer acceptance. Requires the root lockfile's Playwright.
const {createDeviceClientFixture}=require('./device-client-smoke.cjs');
const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
async function main(){
  const fixture=await createDeviceClientFixture({directory:process.env.SHENYI_DESKTOP_EVIDENCE_DIR||'D:/codex-temp/shenyi-device-client-20261115/default-smoke'}),directory=fixture.runDirectory;
  const {app}=await fixture.launch('default-smoke');
  try{
    const page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.getByRole('heading',{name:'登录团队账号',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>typeof require),'undefined');assert.equal(await page.evaluate(()=>typeof process),'undefined');
    assert.deepEqual((await page.evaluate(()=>Object.keys(window.shenyiTeam))).sort(),['login','getSession','logout','listTasks','getTask','getSubmissions','chooseAndUpload','downloadAttachment','getAuthMethods','loginPhone','requestPhoneBind','bindPhone','startWechatLogin','pollWechatLogin','cancelWechatLogin','linkWechatAccount','getOnboardingStatus','getInvitationAccess','createEmployeeInvitation','listEmployeeInvitations','revokeEmployeeInvitation','previewEmployeeInvitation','requestEmployeeActivation','activateEmployee','listAccountSessions','revokeAccountSession','revokeOtherSessions','revokeAllSessions','changeOwnPassword','getMemberManagementAccess','listTeamBusinessMembers','listTeamAdministrators','disableTeamBusinessMember','disableTeamAdministrator','getTaskSubmissionAccess','getTaskManagement','listTaskAssignees','assignTask','returnTask','getRecoveryReviewStatus','createRecoveryReviewRequest','getRecoveryReviewAccess','listRecoveryReviewRequests','reviewRecoveryReviewRequest','requestPasswordRecovery','recoverPassword','getTeamProvisioningAccess','listTeamProvisioningRequests','createTeamProvisioningRequest','reviewTeamProvisioningRequest','getTeamAdministration','previewFirstAdministrator','requestFirstAdministratorActivation','activateFirstAdministrator','getDeviceStatus','enrollDevice','reconnectDevice'].sort());
    const preferences=await app.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {nodeIntegration:p.nodeIntegration,contextIsolation:p.contextIsolation,sandbox:p.sandbox,webSecurity:p.webSecurity};});
    assert.deepEqual(preferences,{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true});
    await page.locator('#identity-methods-message').filter({hasText:'正式方向：手机号＋密码'}).waitFor();
    const capabilities=await page.evaluate(async()=>window.shenyiTeam.getAuthMethods());assert.equal(capabilities.ok,true);
    assert.deepEqual(capabilities.value.methods,{demoUsername:true,phonePassword:true,phoneVerification:false,wechat:false,recovery:false});
    assert.equal(capabilities.value.desktopWechatReady,false);
    const onboarding=await page.evaluate(()=>window.shenyiTeam.getOnboardingStatus());assert.equal(onboarding.ok,true);assert.deepEqual(onboarding.value,{available:false,invitationOnly:true});
    await page.locator('#activation-panel > summary').click();
    await page.locator('#activation-service-status').filter({hasText:'尚未开通'}).waitFor();
    assert.equal(await page.locator('#activation-send-code').isDisabled(),true);assert.equal(await page.locator('#activation-submit').isDisabled(),true);
    await page.screenshot({path:path.join(directory,'activation-unavailable.png'),fullPage:true});
    await page.locator('#activation-panel > summary').click();
    await page.locator('#first-admin-panel > summary').click();await page.locator('#first-admin-service-status').filter({hasText:'尚未开通'}).waitFor();
    assert.equal(await page.locator('#first-admin-send-code').isDisabled(),true);assert.equal(await page.locator('#first-admin-submit').isDisabled(),true);
    await page.screenshot({path:path.join(directory,'first-admin-unavailable.png'),fullPage:true});await page.locator('#first-admin-panel > summary').click();
    await page.locator('#recovery-panel > summary').click();await page.locator('#recovery-status').filter({hasText:'尚未开通'}).waitFor();
    const reviewStatus=await page.evaluate(()=>window.shenyiTeam.getRecoveryReviewStatus());assert.equal(reviewStatus.ok,true);assert.equal(reviewStatus.value.available,false);assert.equal(typeof reviewStatus.value.reviewed,'boolean');
    assert.equal(await page.locator('#recovery-review-request').isDisabled(),true);
    for(const id of ['recovery-phone','recovery-send-code','recovery-submit'])assert.equal(await page.locator('#'+id).isDisabled(),true);
    await page.screenshot({path:path.join(directory,'recovery-unavailable.png'),fullPage:true});await page.locator('#recovery-panel > summary').click();
    assert.equal(await page.locator('#wechat-login').isDisabled(),true);assert.match(await page.locator('#wechat-login').textContent(),/未开通/);
    await page.locator('#login-mode').selectOption('phone');assert.equal(await page.locator('#username').getAttribute('placeholder'),'输入已验证绑定的手机号');
    await page.screenshot({path:path.join(directory,'phone-login.png'),fullPage:true});
    await page.locator('#login-mode').selectOption('demo');
    await page.screenshot({path:path.join(directory,'login.png'),fullPage:true});
    await page.getByLabel('账号',{exact:true}).fill('intern-a');await page.getByLabel('密码',{exact:true}).fill('ShenyiDemo!2026');
    await page.getByRole('button',{name:'登录工作空间',exact:false}).click();
    await page.locator('#device-bind-confirm:visible').waitFor();assert.equal(await page.locator('#workspace-view').isVisible(),false);assert.equal(await page.locator('#password').inputValue(),'');assert.equal(await page.locator('#device-enroll-consent').isChecked(),false);assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM team_device_bindings').get().n,0);
    await page.locator('#device-name').fill('默认严格验收合成电脑');await page.locator('#device-enroll-consent').check();await page.locator('#password').fill('ShenyiDemo!2026');await page.locator('#device-bind-confirm').click();
    await page.locator('.task-button').first().waitFor();await page.locator('.task-button').first().click();
    const device=(await page.evaluate(()=>window.shenyiTeam.getDeviceStatus())).value;assert.equal(device.required,true);assert.equal(device.state,'ready');assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM team_device_bindings').get().n,1);
    await page.getByRole('heading',{name:'我的提交记录',exact:true}).waitFor();
    assert.equal(await page.locator('#employee-invitations-panel').isVisible(),false);
    assert.equal(await page.locator('#team-provisioning-panel').isVisible(),false);
    assert.equal(await page.locator('#recovery-reviews-panel').isVisible(),false);
    assert.equal(await page.locator('#task-management').count(),0);
    assert.equal(await page.locator('#member-management-panel').isVisible(),false);
    assert.deepEqual((await page.evaluate(()=>window.shenyiTeam.getMemberManagementAccess())).value,{teams:[],canReviewAdministrators:false});
    const submissionAccess=await page.evaluate(()=>window.shenyiTeam.getTaskSubmissionAccess({teamId:'team-a',taskId:'task-a'}));assert.equal(submissionAccess.ok,true);assert.deepEqual(Object.keys(submissionAccess.value).sort(),['canSubmit','revision']);assert.equal(typeof submissionAccess.value.canSubmit,'boolean');assert.ok(Number.isSafeInteger(submissionAccess.value.revision));
    await page.locator('#task-submission-access-message').filter({hasText:/已核验|无本任务提交权限/}).waitFor();assert.equal(await page.locator('#task-upload').isDisabled(),!submissionAccess.value.canSubmit);
    assert.deepEqual((await page.evaluate(()=>window.shenyiTeam.getTaskManagement({teamId:'team-a',taskId:'task-a'}))).value,{canManage:false});
    const deniedAssignees=await page.evaluate(()=>window.shenyiTeam.listTaskAssignees({teamId:'team-a',taskId:'task-a'}));assert.equal(deniedAssignees.ok,false);assert.equal(deniedAssignees.error.code,'HTTP_404');
    const passwords=await page.locator('input[type=password]').evaluateAll(fields=>fields.map(field=>field.value));assert.equal(passwords.length,16);assert.ok(passwords.every(value=>value===''));
    const publicSession=await page.evaluate(async()=>window.shenyiTeam.getSession());assert.equal(publicSession.ok,true);assert.ok(!('token'in publicSession.value));
    assert.equal(await page.evaluate(()=>Object.values(localStorage).some(value=>value.includes('Bearer '))),false);
    await page.locator('#phone-bind-panel > summary').click();
    await page.locator('#phone-service-status').filter({hasText:'短信验证尚未开通'}).waitFor();
    for(const id of ['bind-phone','send-bind-code','bind-code','bind-current-password','bind-phone-submit'])assert.equal(await page.locator('#'+id).isDisabled(),true,id);
    await page.screenshot({path:path.join(directory,'phone-unavailable.png'),fullPage:true});
    await page.locator('#phone-bind-panel > summary').click();
    await page.screenshot({path:path.join(directory,'task.png'),fullPage:true});
    await page.locator('#account-sessions-panel > summary').click();await page.getByRole('button',{name:'退出当前登录',exact:true}).waitFor();
    const ownSessions=await page.evaluate(()=>window.shenyiTeam.listAccountSessions());assert.equal(ownSessions.ok,true);assert.equal(ownSessions.value.sessions.filter(item=>item.isCurrent).length,1);
    for(const item of ownSessions.value.sessions)assert.deepEqual(Object.keys(item).sort(),['id','isCurrent','createdAt','expiresAt'].sort());
    await page.screenshot({path:path.join(directory,'own-sessions.png'),fullPage:true});await page.locator('#account-sessions-panel > summary').click();
    await page.locator('#password-change-panel > summary').click();await page.locator('#password-change-current:enabled').waitFor();
    await page.locator('#password-change-current').fill('ShenyiDemo!2026');await page.locator('#password-change-new').fill('NoWriteDemo!2026');await page.locator('#password-change-confirm').fill('NoWriteDemo!2026');assert.equal(await page.locator('#password-change-submit').isEnabled(),true);
    // This fixture is isolated and strict. Preserve the original default-smoke
    // no-password-write check; password-smoke separately performs real writes.
    await page.locator('#password-change-clear').click();for(const id of ['password-change-current','password-change-new','password-change-confirm'])assert.equal(await page.locator('#'+id).inputValue(),'');
    await page.getByRole('button',{name:'退出账号',exact:true}).click();await page.getByRole('heading',{name:'登录团队账号',exact:true}).waitFor();
    assert.equal(await page.locator('#account-name').textContent(),'');assert.equal(await page.locator('.task-button').count(),0);assert.equal(await page.locator('#login-submit').isEnabled(),true);assert.equal(errors.length,0);
    // Attempt this last: Playwright otherwise waits for a navigation which the
    // app correctly prevented before allowing subsequent locator interactions.
    const before=page.url();await page.evaluate(()=>{location.href='https://example.com/';});await page.waitForTimeout(100);assert.equal(page.url(),before);
    assert.equal(await page.locator('form').count(),10);assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM team_device_leases WHERE revoked_at IS NULL').get().n,0);
    const report={status:'PASS',runDirectory:directory,ephemeralStrictHttp:fixture.service.address.url,isolatedFreshDatabaseAndKeyDirectory:true,sharedThirteenUsersOr8774Touched:false,explicitFirstBinding:true,apiMethods:57,electron:await app.evaluate(()=>process.versions.electron),preferences,rendererHasNode:false,tokenInRenderer:false,login:true,phoneLoginMode:true,unconfiguredIdentity:{smsDisabled:true,wechatDisabled:true,recovery:false,recoveryDisabled:true,activationDisabled:true,firstAdministratorDisabled:true},unprivilegedInvitationsHidden:true,unprivilegedReviewHidden:true,personalSessionList:true,passwordChangeReadyWithoutSms:true,passwordCloseClearsSecrets:true,scopedTasks:true,detail:true,logoutClearsDom:true,externalNavigationDenied:true,pageErrors:errors,screenshots:['login.png','phone-login.png','phone-unavailable.png','activation-unavailable.png','first-admin-unavailable.png','recovery-unavailable.png','task.png','own-sessions.png'],notVerified:['native-file-dialog','real-SMS','real-WeChat','OS-install-signature','macOS','production']};
    await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await fixture.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
