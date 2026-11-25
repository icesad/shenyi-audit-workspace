'use strict';
// Legacy M2 diagnostic compatibility; this harness does not prove device binding.
// Real Electron + real loopback HTTP/SQLite, with explicit SYNTHETIC provider.
// The test bootstrap intercepts the OS browser opener; it never contacts WeChat,
// opens a fake QR page, or changes the production/default app configuration.
const {_electron:electron}=require('../node_modules/playwright');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs/promises'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
async function main(){
  const directory=path.resolve(process.env.SHENYI_DESKTOP_EVIDENCE_DIR||'D:/codex-temp/shenyi-wechat-desktop-20261115/real-electron-synthetic');
  await fs.mkdir(directory,{recursive:true});
  const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');
  const {startTeamServer}=await source('dev-server.mjs');
  const {handleTeamApplicationRequest}=await source('application-api.mjs');
  const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);await seedDemoTeamData(db);
  const appId='wx0123456789abcdef',redirectUri='https://login.shenyi.invalid/api/auth/wechat/callback';
  const wechat={appId,redirectUri,
    createAuthorizationUrl:({state})=>'https://open.weixin.qq.com/connect/qrconnect?'+new URLSearchParams({appid:appId,redirect_uri:redirectUri,response_type:'code',scope:'snsapi_login',state})+'#wechat_redirect',
    exchangeCode:async()=>({appId,openId:'synthetic-electron-open-id',access_token:'SYNTHETIC_SUPPLIER_SECRET'})};
  const identityProviders={wechat};let clock=Date.now();
  const service=await startTeamServer({db,port:0,identityProviders,now:()=>clock});
  db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('intern-a','+8613800138000',clock);
  const bootstrap=path.join(directory,'synthetic-bootstrap.cjs');
  // Only this test entry changes constructor dependencies. The real main/preload,
  // IPC, renderer and service execute unchanged, with strict provider URL policy.
  await fs.writeFile(bootstrap,`'use strict';const diagnosticClient=require(${JSON.stringify(path.resolve(__dirname,'../tests/helpers/desktop-m2-diagnostic-client.cjs'))}).createM2DiagnosticClient;
const modulePath=${JSON.stringify(path.join(__dirname,'team-client.cjs'))};
const original=require(modulePath).createTeamClient;
globalThis.__syntheticWechatOpened=[];
require(modulePath).createTeamClient=options=>diagnosticClient(original,{...options,
  fetchImpl:(url,settings)=>fetch(${JSON.stringify(service.address.url)}+url.slice('http://127.0.0.1:8774'.length),settings),
  openAuthorization:async url=>{globalThis.__syntheticWechatOpened.push(url);}
});
require(${JSON.stringify(path.join(__dirname,'main.cjs'))});
`);
  let app;
  try{
    app=await electron.launch({executablePath:require('electron'),args:[bootstrap],env:{...process.env,SHENYI_DESKTOP_DATA_DIR:path.join(directory,'profile'),SHENYI_WECHAT_APP_ID:appId,SHENYI_WECHAT_REDIRECT_URI:redirectUri}});
    const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    await page.locator('#wechat-login:enabled').waitFor();
    let opened=0,code=0;
    async function begin(){
      await page.locator('#wechat-login').click();
      await page.locator('#wechat-progress:not([hidden])').waitFor();
      // Await an observed opener receipt instead of inferring from a rendered button.
      for(let i=0;i<100;i++){const urls=await app.evaluate(()=>globalThis.__syntheticWechatOpened);if(urls.length>opened){opened=urls.length;return urls.at(-1);}await page.waitForTimeout(20);}
      throw Error('Synthetic browser opener receipt missing');
    }
    async function callback(url){
      const state=new URL(url).searchParams.get('state');
      const response=await handleTeamApplicationRequest(new Request(redirectUri+'?'+new URLSearchParams({state,code:'synthetic-electron-code-'+(++code)}),{headers:{'Sec-Fetch-Site':'cross-site'}}),{db,identityProviders,now:()=>clock});
      return response;
    }
    const initialMemberships=db.prepare('SELECT COUNT(*) AS n FROM team_memberships').get().n;
    const authorization=await begin();assert.equal((await callback(authorization)).status,200);
    await page.locator('#wechat-link-fields:not([hidden])').waitFor();
    await page.screenshot({path:path.join(directory,'first-association.png'),fullPage:true});
    await page.locator('#wechat-link-phone').fill('13800138000');await page.locator('#wechat-link-password').fill('ShenyiDemo!2026');
    await page.locator('#wechat-link-submit').click();await page.locator('.task-button').waitFor();
    assert.equal(await page.locator('.task-button').count(),1);
    assert.equal(db.prepare('SELECT user_id FROM team_wechat_identities').get().user_id,'intern-a');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM team_memberships').get().n,initialMemberships);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM team_sessions WHERE revoked_at IS NULL').get().n,1);
    assert.ok((await page.locator('input[type=password]').evaluateAll(items=>items.map(i=>i.value))).every(value=>value===''));
    const publicSession=await page.evaluate(()=>window.shenyiTeam.getSession());assert.equal(publicSession.value.account.id,'intern-a');assert.equal(publicSession.value.token,undefined);
    assert.equal(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}})),'{"local":{},"session":{}}');
    await page.screenshot({path:path.join(directory,'associated-workspace.png'),fullPage:true});
    await page.locator('#logout').click();await page.locator('#login-view:not([hidden])').waitFor();
    const second=await begin();assert.equal((await callback(second)).status,200);await page.locator('.task-button').waitFor();
    assert.equal(await page.locator('#wechat-link-fields').isVisible(),false);
    await page.locator('#logout').click();await page.locator('#login-view:not([hidden])').waitFor();
    const canceled=await begin();await page.locator('#wechat-cancel').click();await page.locator('#wechat-status').filter({hasText:'已取消'}).waitFor();
    assert.equal((await callback(canceled)).status,404);assert.equal(await page.locator('#workspace-view').isVisible(),false);
    await begin();clock+=6*60000;
    await page.locator('#wechat-status').filter({hasText:'过期'}).waitFor();
    await page.screenshot({path:path.join(directory,'expired.png'),fullPage:true});
    assert.equal(await page.locator('#workspace-view').isVisible(),false);assert.equal(errors.length,0);
    const report={status:'PASS',electron:await app.evaluate(()=>process.versions.electron),layers:{electron:true,loopbackHttp:true,sqlite:true,provider:'synthetic',callback:'direct HTTPS Request dispatch',browser:'intercepted opener receipt'},firstAssociation:true,linkedLogin:true,temporarySessionRevoked:true,noMembershipEscalation:true,oneScopedTask:true,canceledCallbackRejected:true,expired:true,rendererSecrets:false,pageErrors:errors,screenshots:['first-association.png','associated-workspace.png','expired.png'],notVerified:['actual OS browser handoff','real WeChat','real SMS','macOS','production']};
    await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{if(app)await app.close();await service.close();db.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
