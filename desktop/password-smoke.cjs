'use strict';
// Legacy M2 diagnostic compatibility; this harness does not prove device binding.
// Real Electron + HTTP/SQLite with synthetic credentials and a verified-phone
// fixture. No SMS, real employee, shared preview password or customer data used.
const {_electron:electron}=require('../node_modules/playwright');
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
async function main(){
  const directory=path.resolve(process.env.SHENYI_DESKTOP_EVIDENCE_DIR||'D:/codex-temp/shenyi-password-20261115/real-electron');await fs.mkdir(directory,{recursive:true});
  const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs'),{startTeamServer}=await source('dev-server.mjs');
  const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);await seedDemoTeamData(db);const service=await startTeamServer({db,port:0});
  const oldPassword='ShenyiDemo!2026',newPassword='ChangedDemo!2026',phone='13800138000';let changeRequests=0;
  service.server.on('request',request=>{if(request.url==='/api/auth/password')changeRequests++;});
  db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('intern-a','+86'+phone,Date.now());
  const phoneBefore=JSON.stringify(db.prepare('SELECT * FROM team_phone_credentials').all()),membersBefore=JSON.stringify(db.prepare('SELECT * FROM team_memberships').all());
  const initialRevision=db.prepare("SELECT revision FROM team_credentials WHERE user_id='intern-a'").get().revision;
  async function call(route,body,token){const response=await fetch(service.address.url+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};}
  const usernameLogin=async username=>{const value=await call('/api/auth/login',{username,password:oldPassword});assert.equal(value.status,200);return value.data;};
  const peerUsername=await usernameLogin('intern-a'),foreign=await usernameLogin('assistant-a');
  const peerPhone=await call('/api/auth/phone/login',{phone,password:oldPassword});assert.equal(peerPhone.status,200);
  const bootstrap=path.join(directory,'synthetic-bootstrap.cjs');await fs.writeFile(bootstrap,`'use strict';const diagnosticClient=require(${JSON.stringify(path.resolve(__dirname,'../tests/helpers/desktop-m2-diagnostic-client.cjs'))}).createM2DiagnosticClient;const modulePath=${JSON.stringify(path.join(__dirname,'team-client.cjs'))};const original=require(modulePath).createTeamClient;require(modulePath).createTeamClient=options=>diagnosticClient(original,{...options,fetchImpl:(url,settings)=>fetch(${JSON.stringify(service.address.url)}+url.slice('http://127.0.0.1:8774'.length),settings)});require(${JSON.stringify(path.join(__dirname,'main.cjs'))});`);
  let app,page,stage='launch';
  try{
    app=await electron.launch({executablePath:require('electron'),args:[bootstrap],env:{...process.env,SHENYI_DESKTOP_DATA_DIR:path.join(directory,'profile')}});page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    async function desktopPhoneLogin(password){await page.waitForFunction(()=>!document.querySelector('#login-mode option[value=phone]').disabled);await page.locator('#login-mode').selectOption('phone');await page.locator('#username').fill(phone);await page.locator('#password').fill(password);await page.locator('#login-submit').click();}
    async function fillChange(current,next,confirm=next){await page.locator('#password-change-current').fill(current);await page.locator('#password-change-new').fill(next);await page.locator('#password-change-confirm').fill(confirm);}
    await desktopPhoneLogin(oldPassword);await page.locator('#workspace-view:not([hidden])').waitFor();await page.locator('#logout:enabled').waitFor();assert.equal(await page.locator('.task-button').count(),1);
    await page.locator('#password-change-panel > summary').click();await page.locator('#password-change-current:enabled').waitFor();
    stage='confirmation-mismatch';await fillChange(oldPassword,newPassword,'DifferentDemo!2026');await page.locator('#password-change-submit').click();await page.locator('#password-change-message').filter({hasText:'不一致'}).waitFor();assert.equal(changeRequests,0);assert.equal(db.prepare("SELECT revision FROM team_credentials WHERE user_id='intern-a'").get().revision,initialRevision);
    stage='wrong-current-password';await fillChange('WrongDemo!2026',newPassword);await page.locator('#password-change-submit').click();await page.locator('#password-change-message').filter({hasText:'验证未通过'}).waitFor();assert.equal(changeRequests,1);assert.equal(await page.locator('#workspace-view').isVisible(),true);
    for(const id of ['password-change-current','password-change-new','password-change-confirm'])assert.equal(await page.locator('#'+id).inputValue(),'');
    for(const token of [peerUsername.token,peerPhone.data.token,foreign.token])assert.equal((await call('/api/auth/session',undefined,token)).status,200);
    await page.screenshot({path:path.join(directory,'password-retry.png'),fullPage:true});
    stage='confirmed-change';await fillChange(oldPassword,newPassword);await page.locator('#password-change-submit').click();await page.locator('#login-view:not([hidden])').waitFor();assert.equal(changeRequests,2);assert.equal((await page.evaluate(()=>window.shenyiTeam.getSession())).value,null);
    for(const token of [peerUsername.token,peerPhone.data.token])assert.equal((await call('/api/auth/session',undefined,token)).status,401);assert.equal((await call('/api/auth/session',undefined,foreign.token)).status,200);
    assert.equal(db.prepare("SELECT revision FROM team_credentials WHERE user_id='intern-a'").get().revision,initialRevision+1);assert.equal(JSON.stringify(db.prepare('SELECT * FROM team_phone_credentials').all()),phoneBefore);assert.equal(JSON.stringify(db.prepare('SELECT * FROM team_memberships').all()),membersBefore);assert.equal(await page.locator('.task-button').count(),0);
    const values=await page.locator('input[type=password]').evaluateAll(nodes=>nodes.map(n=>n.value));assert.equal(values.length,24);assert.ok(values.every(v=>v===''));
    await page.screenshot({path:path.join(directory,'password-changed-signout.png'),fullPage:true});
    stage='old-password-rejected';await desktopPhoneLogin(oldPassword);await page.locator('#login-message').filter({hasText:'账号或密码无效'}).waitFor();assert.equal(await page.locator('#workspace-view').isVisible(),false);assert.equal(await page.locator('#password').inputValue(),'');
    stage='new-password-login';await desktopPhoneLogin(newPassword);await page.locator('#workspace-view:not([hidden])').waitFor();await page.locator('#logout:enabled').waitFor();assert.equal(await page.locator('.task-button').count(),1);
    const session=await page.evaluate(()=>window.shenyiTeam.getSession());assert.equal(session.value.account.id,'intern-a');assert.deepEqual(session.value.memberships,[{teamId:'team-a',role:'intern'}]);assert.equal(session.value.token,undefined);assert.equal((await call('/api/auth/session',undefined,foreign.token)).status,200);
    assert.ok((await page.locator('input[type=password]').evaluateAll(nodes=>nodes.map(n=>n.value))).every(v=>v===''));assert.equal(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}})),'{"local":{},"session":{}}');assert.equal(errors.length,0);
    await page.screenshot({path:path.join(directory,'new-phone-password-login.png'),fullPage:true});await page.locator('#logout').click();await page.locator('#login-view:not([hidden])').waitFor();
    const report={status:'PASS',electron:await app.evaluate(()=>process.versions.electron),layers:{electron:true,loopbackHttp:true,sqlite:true,identity:'synthetic verified-phone fixture'},confirmationMismatchNeverSubmitted:true,wrongCurrentPasswordKeepsSessions:true,confirmedChangeRevokesAllOldSessions:true,otherUserPreserved:true,oldPhonePasswordRejected:true,newPhonePasswordSameUserAndScope:true,phoneAndMembershipUnchanged:true,secretInputsCleared:true,rendererBearer:false,changeRequests,pageErrors:errors,screenshots:['password-retry.png','password-changed-signout.png','new-phone-password-login.png'],notVerified:['real phone verification','real SMS or WeChat','device binding','macOS','production']};await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(error){if(page)try{await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true});const message=await page.locator('#password-change-message').textContent();await fs.writeFile(path.join(directory,'failure.json'),JSON.stringify({stage,error:error.message,message,changeRequests},null,2));}catch{}throw error;}
  finally{if(app)await app.close();await service.close();db.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
