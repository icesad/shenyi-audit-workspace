'use strict';
// Real Electron + loopback HTTP + SQLite. All identities are synthetic; these are
// login sessions, not physical devices, production users or a Mac acceptance.
const {_electron:electron}=require('../node_modules/playwright');
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
async function main(){
  const directory=path.resolve(process.env.SHENYI_DESKTOP_EVIDENCE_DIR||'D:/codex-temp/shenyi-sessions-20261115/real-electron');await fs.mkdir(directory,{recursive:true});
  const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs'),{startTeamServer}=await source('dev-server.mjs');
  const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);await seedDemoTeamData(db);const service=await startTeamServer({db,port:0});
  const PASSWORD='ShenyiDemo!2026',hash=token=>createHash('sha256').update(token).digest('hex');
  async function call(route,body,token){const response=await fetch(service.address.url+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};}
  const login=async username=>{const value=await call('/api/auth/login',{username,password:PASSWORD});assert.equal(value.status,200);return value.data;};
  const peer1=await login('intern-a'),peer2=await login('intern-a'),foreign=await login('assistant-a');
  // Explicit legacy fixture: the old token stays valid but its creation time was
  // never recorded. The list must add stable metadata without inventing a time.
  db.prepare('DELETE FROM team_session_metadata WHERE token_hash=?').run(hash(peer1.token));
  const bootstrap=path.join(directory,'synthetic-bootstrap.cjs');await fs.writeFile(bootstrap,`'use strict';const modulePath=${JSON.stringify(path.join(__dirname,'team-client.cjs'))};const original=require(modulePath).createTeamClient;require(modulePath).createTeamClient=options=>original({...options,fetchImpl:(url,settings)=>fetch(${JSON.stringify(service.address.url)}+url.slice('http://127.0.0.1:8774'.length),settings)});require(${JSON.stringify(path.join(__dirname,'main.cjs'))});`);
  let app,page,stage='launch';
  try{
    app=await electron.launch({executablePath:require('electron'),args:[bootstrap],env:{...process.env,SHENYI_DESKTOP_DATA_DIR:path.join(directory,'profile')}});page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    async function desktopLogin(){await page.locator('#username').fill('intern-a');await page.locator('#password').fill(PASSWORD);await page.locator('#login-submit').click();await page.locator('#workspace-view:not([hidden])').waitFor();await page.locator('#logout:enabled').waitFor();}
    async function openSessions(){await page.locator('#account-sessions-panel > summary').click();await page.locator('#account-sessions-refresh:enabled').waitFor();}
    const rows=()=>page.locator('#account-sessions-list > li[data-session-id]');
    async function expectRows(count){await page.waitForFunction(n=>document.querySelectorAll('#account-sessions-list > li[data-session-id]').length===n,count);}
    await desktopLogin();await openSessions();await expectRows(3);stage='list';
    assert.equal(await rows().filter({hasText:'登录时间未记录'}).count(),1);
    const first=await page.evaluate(()=>window.shenyiTeam.listAccountSessions());assert.equal(first.ok,true);assert.equal(first.value.sessions.length,3);assert.equal(first.value.sessions.filter(s=>s.isCurrent).length,1);
    for(const item of first.value.sessions)assert.deepEqual(Object.keys(item).sort(),['id','isCurrent','createdAt','expiresAt'].sort());
    const stable=await page.evaluate(()=>window.shenyiTeam.listAccountSessions());assert.deepEqual(first.value,stable.value);
    await page.screenshot({path:path.join(directory,'own-sessions.png'),fullPage:true});
    stage='password-retry';await page.locator('#account-sessions-password').fill('WrongPassword!2026');await page.getByRole('button',{name:'退出该登录',exact:true}).first().click();
    await page.locator('#account-sessions-message').filter({hasText:'验证未通过'}).waitFor();assert.equal(await page.locator('#workspace-view').isVisible(),true);await expectRows(3);assert.equal(await page.locator('#account-sessions-password').inputValue(),'');
    stage='single-peer';await page.locator('#account-sessions-password').fill(PASSWORD);await page.getByRole('button',{name:'退出该登录',exact:true}).first().click();await expectRows(2);
    const peerStatuses=[(await call('/api/auth/session',undefined,peer1.token)).status,(await call('/api/auth/session',undefined,peer2.token)).status].sort();assert.deepEqual(peerStatuses,[200,401]);assert.equal((await call('/api/auth/session',undefined,foreign.token)).status,200);
    const foreignId=db.prepare('SELECT session_id FROM team_session_metadata WHERE token_hash=?').get(hash(foreign.token)).session_id;
    const cross=await page.evaluate(({id,password})=>window.shenyiTeam.revokeAccountSession({sessionId:id,currentPassword:password}),{id:foreignId,password:PASSWORD});assert.equal(cross.ok,false);assert.equal(cross.error.code,'HTTP_404');
    const extra=await login('intern-a');await page.locator('#account-sessions-refresh').click();await expectRows(3);
    stage='others';await page.locator('#account-sessions-password').fill(PASSWORD);await page.locator('#account-sessions-revoke-others').click();await expectRows(1);assert.equal(await page.locator('#workspace-view').isVisible(),true);
    for(const peer of [peer1,peer2,extra])assert.equal((await call('/api/auth/session',undefined,peer.token)).status,401);assert.equal((await call('/api/auth/session',undefined,foreign.token)).status,200);
    await page.screenshot({path:path.join(directory,'only-current-remains.png'),fullPage:true});
    stage='self';await page.locator('#account-sessions-password').fill(PASSWORD);await page.getByRole('button',{name:'退出当前登录',exact:true}).click();await page.locator('#login-view:not([hidden])').waitFor();assert.equal((await page.evaluate(()=>window.shenyiTeam.getSession())).value,null);
    stage='all';await desktopLogin();const lastPeer=await login('intern-a');await openSessions();await expectRows(2);await page.locator('#account-sessions-password').fill(PASSWORD);await page.locator('#account-sessions-revoke-all').click();await page.locator('#login-view:not([hidden])').waitFor();assert.equal((await call('/api/auth/session',undefined,lastPeer.token)).status,401);assert.equal((await call('/api/auth/session',undefined,foreign.token)).status,200);
    stage='peer-invalidates-desktop';await desktopLogin();const peerActor=await login('intern-a');assert.equal((await call('/api/auth/sessions/revoke-others',{currentPassword:PASSWORD},peerActor.token)).status,200);await page.locator('#refresh').click();await page.locator('#login-view:not([hidden])').waitFor();
    assert.equal((await call('/api/auth/session',undefined,peerActor.token)).status,200);assert.equal((await call('/api/auth/session',undefined,foreign.token)).status,200);assert.equal(await page.locator('.task-button').count(),0);
    const values=await page.locator('input[type=password]').evaluateAll(nodes=>nodes.map(n=>n.value));assert.equal(values.length,8);assert.ok(values.every(v=>v===''));assert.equal(await page.locator('#account-sessions-list').textContent(),'');assert.equal(errors.length,0);
    assert.equal(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}})),'{"local":{},"session":{}}');await page.screenshot({path:path.join(directory,'peer-revocation-signout.png'),fullPage:true});
    const report={status:'PASS',electron:await app.evaluate(()=>process.versions.electron),layers:{electron:true,loopbackHttp:true,sqlite:true,identity:'synthetic'},ownScopeOnly:true,stableManagementIds:true,legacyTimeNotInvented:true,wrongPasswordPreservesSession:true,singlePeerRevocation:true,foreignSessionDenied:true,othersPreservesCurrent:true,selfRevocationSignsOut:true,allRevocationSignsOut:true,peerRevocationEnforcedOnNextRequest:true,otherUserPreserved:true,rendererBearer:false,secretInputsCleared:true,pageErrors:errors,screenshots:['own-sessions.png','only-current-remains.png','peer-revocation-signout.png'],notVerified:['physical devices','device binding','macOS','production']};await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(error){if(page)try{await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true});await fs.writeFile(path.join(directory,'failure.json'),JSON.stringify({stage,error:error.message},null,2));}catch{}throw error;}
  finally{if(app)await app.close();await service.close();db.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
