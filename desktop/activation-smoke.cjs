'use strict';
// Legacy M2 diagnostic compatibility; this harness does not prove device binding.
// Real Electron and loopback HTTP/SQLite. SMS is an explicit in-memory capture;
// no real phone, user, message, browser profile or shared demo is used.
const {_electron:electron}=require('../node_modules/playwright');
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{randomBytes}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
async function main(){
  const directory=path.resolve(process.env.SHENYI_DESKTOP_EVIDENCE_DIR||'D:/codex-temp/shenyi-activation-20261115/real-electron-synthetic');await fs.mkdir(directory,{recursive:true});
  const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs'),{startTeamServer}=await source('dev-server.mjs');
  const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);await seedDemoTeamData(db);const sent=[];
  const service=await startTeamServer({db,port:0,identityProviders:{sms:{send:async value=>sent.push(value)},phonePepper:randomBytes(32)}});
  const bootstrap=path.join(directory,'synthetic-bootstrap.cjs');
  await fs.writeFile(bootstrap,`'use strict';const diagnosticClient=require(${JSON.stringify(path.resolve(__dirname,'../tests/helpers/desktop-m2-diagnostic-client.cjs'))}).createM2DiagnosticClient;const modulePath=${JSON.stringify(path.join(__dirname,'team-client.cjs'))};const original=require(modulePath).createTeamClient;require(modulePath).createTeamClient=options=>diagnosticClient(original,{...options,fetchImpl:(url,settings)=>fetch(${JSON.stringify(service.address.url)}+url.slice('http://127.0.0.1:8774'.length),settings)});require(${JSON.stringify(path.join(__dirname,'main.cjs'))});`);
  let app,page,stage='launch';
  try{
    app=await electron.launch({executablePath:require('electron'),args:[bootstrap],env:{...process.env,SHENYI_DESKTOP_DATA_DIR:path.join(directory,'profile')}});
    page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.locator('#login-form').waitFor();
    await page.evaluate(()=>{
      // Test-only trace records source stacks and lengths, never input secrets.
      window.__activationClearTrace=[];const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
      Object.defineProperty(HTMLInputElement.prototype,'value',{...descriptor,set(value){if(['activation-invitation','activation-phone'].includes(this.id)&&value===''&&descriptor.get.call(this))window.__activationClearTrace.push({id:this.id,stack:new Error().stack});return descriptor.set.call(this,value);}});
    });
    await page.locator('#username').fill('manager-a');await page.locator('#password').fill('ShenyiDemo!2026');await page.locator('#login-submit').click();
    await page.locator('#employee-invitations-panel:not([hidden])').waitFor();await page.locator('#employee-invitations-panel > summary').click();await page.locator('#invitation-create:enabled').waitFor();
    const phone='13800138000',password='EmployeeDemo!2026';
    async function createInvitation(){await page.locator('#invitation-phone').fill(phone);await page.locator('#invitation-role').selectOption('intern');await page.locator('#invitation-create').click();await page.locator('#issued-invitation:not([hidden])').waitFor();return page.locator('#issued-invitation-code').inputValue();}
    const revokedCode=await createInvitation();await page.locator('#employee-invitation-list').getByRole('button',{name:'撤销',exact:true}).click();
    await page.locator('#employee-invitation-list').filter({hasText:'已撤销'}).waitFor();
    const denied=await fetch(service.address.url+'/api/auth/onboarding/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitationCode:revokedCode,phone})});assert.equal(denied.status,404);
    const invitationCode=await createInvitation();assert.notEqual(invitationCode,revokedCode);
    const previewResponse=await fetch(service.address.url+'/api/auth/onboarding/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitationCode,phone})});assert.equal(previewResponse.status,200,'new invitation must be valid before opening recipient UI');
    await page.screenshot({path:path.join(directory,'manager-invitation.png'),fullPage:true});
    await page.locator('#logout').click();await page.locator('#login-view:not([hidden])').waitFor();assert.equal(await page.locator('#issued-invitation-code').inputValue(),'');assert.equal(await page.locator('#employee-invitations-panel').isVisible(),false);
    stage='recipient-preview';await page.locator('#activation-panel > summary').click();await page.locator('#activation-service-status').filter({hasText:'已配置'}).waitFor();await page.locator('#activation-invitation').fill(invitationCode);await page.locator('#activation-phone').fill(phone);await page.locator('#activation-preview').click();
    await page.locator('#activation-target:not([hidden])').waitFor();assert.match(await page.locator('#activation-target-description').textContent(),/team-a/);assert.match(await page.locator('#activation-target-description').textContent(),/实习生/);
    await page.locator('#activation-send-code').click();await page.locator('#activation-proof:not([hidden])').waitFor();assert.equal(sent.length,1);assert.equal(sent[0].purpose,'activate');
    await page.locator('#activation-code').fill(sent[0].code);await page.locator('#activation-display-name').fill('合成员工验收');await page.locator('#activation-password').fill(password);
    assert.equal(await page.locator('#activation-submit').isDisabled(),true);await page.locator('#activation-accept').check();
    await page.screenshot({path:path.join(directory,'activation-confirmation.png'),fullPage:true});
    await page.locator('#activation-submit').click();await page.locator('#activation-message').filter({hasText:'已激活'}).waitFor();
    assert.equal(await page.locator('#workspace-view').isVisible(),false);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM team_sessions WHERE revoked_at IS NULL').get().n,0);
    for(const id of ['activation-invitation','activation-phone','activation-code','activation-password'])assert.equal(await page.locator('#'+id).inputValue(),'');
    const owner=db.prepare('SELECT user_id FROM team_phone_credentials WHERE phone=?').get('+86'+phone);assert.ok(owner);
    assert.deepEqual({...db.prepare('SELECT team_id,role,status FROM team_memberships WHERE user_id=?').get(owner.user_id)},{team_id:'team-a',role:'intern',status:'active'});
    for(const table of ['team_admin_grants','team_project_grants','team_task_assignments'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE user_id=?').get(owner.user_id).n,0);
    await page.locator('#activation-cancel').click();await page.locator('#login-mode').selectOption('phone');await page.locator('#username').fill(phone);await page.locator('#password').fill(password);await page.locator('#login-submit').click();
    await page.locator('#workspace-view:not([hidden])').waitFor();await page.locator('#logout:enabled').waitFor();assert.equal(await page.locator('.task-button').count(),0);assert.equal(await page.locator('#employee-invitations-panel').isVisible(),false);
    const publicSession=await page.evaluate(()=>window.shenyiTeam.getSession());assert.equal(publicSession.value.account.id,owner.user_id);assert.equal(publicSession.value.token,undefined);
    const foreign=await page.evaluate(()=>window.shenyiTeam.listTasks({teamId:'team-b'}));assert.equal(foreign.ok,false);
    // Explicit fixture assignment demonstrates activation alone did not unlock tasks.
    db.prepare("INSERT INTO team_task_assignments VALUES ('team-a','task-a',?,'active')").run(owner.user_id);await page.locator('#refresh').click();await page.locator('.task-button').waitFor();assert.equal(await page.locator('.task-button').count(),1);
    assert.ok((await page.locator('input[type=password]').evaluateAll(items=>items.map(i=>i.value))).every(value=>value===''));
    assert.equal(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}})),'{"local":{},"session":{}}');
    await page.screenshot({path:path.join(directory,'activated-employee.png'),fullPage:true});assert.equal(errors.length,0);
    await page.locator('#logout').click();await page.locator('#login-view:not([hidden])').waitFor();
    const report={status:'PASS',electron:await app.evaluate(()=>process.versions.electron),layers:{electron:true,loopbackHttp:true,sqlite:true,sms:'synthetic capture'},adminInvitation:true,revokedInvitationRejected:true,explicitConsent:true,newAccountSameInvitedTeam:true,noAutomaticSession:true,noAutomaticTaskOrAdminGrants:true,phonePasswordLogin:true,otherTeamDenied:true,fixtureAssignmentShowsExactlyOneTask:true,rendererBearer:false,secretInputsCleared:true,pageErrors:errors,screenshots:['manager-invitation.png','activation-confirmation.png','activated-employee.png'],notVerified:['real SMS','real employee delivery','macOS','device-binding','production']};
    await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(error){
    if(page)try{await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true});const state=await page.evaluate(()=>({message:document.getElementById('activation-message').textContent,service:document.getElementById('activation-service-status').textContent,invitationLength:document.getElementById('activation-invitation').value.length,phoneLength:document.getElementById('activation-phone').value.length,previewDisabled:document.getElementById('activation-preview').disabled,clears:window.__activationClearTrace.slice(-8)}));await fs.writeFile(path.join(directory,'failure.json'),JSON.stringify({stage,error:error.message,state},null,2));}catch{}
    throw error;
  }finally{if(app)await app.close();await service.close();db.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
