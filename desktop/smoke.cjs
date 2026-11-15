'use strict';
// Real Electron renderer acceptance. Requires the root lockfile's Playwright.
const { _electron: electron }=require('../node_modules/playwright');
const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
async function main(){
  const directory=path.resolve(process.env.SHENYI_DESKTOP_EVIDENCE_DIR||'D:/codex-temp/shenyi-desktop-runtime');
  await fs.mkdir(directory,{recursive:true});
  const app=await electron.launch({executablePath:require('electron'),args:[__dirname],env:{...process.env,SHENYI_DESKTOP_DATA_DIR:path.join(directory,'profile')}});
  try{
    const page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.getByRole('heading',{name:'登录团队账号',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>typeof require),'undefined');assert.equal(await page.evaluate(()=>typeof process),'undefined');
    assert.deepEqual((await page.evaluate(()=>Object.keys(window.shenyiTeam))).sort(),['login','getSession','logout','listTasks','getTask','getSubmissions','chooseAndUpload','downloadAttachment'].sort());
    const preferences=await app.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {nodeIntegration:p.nodeIntegration,contextIsolation:p.contextIsolation,sandbox:p.sandbox,webSecurity:p.webSecurity};});
    assert.deepEqual(preferences,{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true});
    await page.screenshot({path:path.join(directory,'login.png')});
    await page.getByLabel('账号',{exact:true}).fill('intern-a');await page.getByLabel('密码',{exact:true}).fill('ShenyiDemo!2026');
    await page.getByRole('button',{name:'登录工作空间',exact:false}).click();
    await page.locator('.task-button').first().waitFor();await page.locator('.task-button').first().click();
    await page.getByRole('heading',{name:'我的提交记录',exact:true}).waitFor();
    assert.equal(await page.locator('input[type=password]').inputValue(),'');
    const publicSession=await page.evaluate(async()=>window.shenyiTeam.getSession());assert.equal(publicSession.ok,true);assert.ok(!('token'in publicSession.value));
    assert.equal(await page.evaluate(()=>Object.values(localStorage).some(value=>value.includes('Bearer '))),false);
    await page.screenshot({path:path.join(directory,'task.png')});
    await page.getByRole('button',{name:'退出账号',exact:true}).click();await page.getByRole('heading',{name:'登录团队账号',exact:true}).waitFor();
    assert.equal(await page.locator('#account-name').textContent(),'');assert.equal(await page.locator('.task-button').count(),0);assert.equal(await page.locator('#login-submit').isEnabled(),true);assert.equal(errors.length,0);
    // Attempt this last: Playwright otherwise waits for a navigation which the
    // app correctly prevented before allowing subsequent locator interactions.
    const before=page.url();await page.evaluate(()=>{location.href='https://example.com/';});await page.waitForTimeout(100);assert.equal(page.url(),before);
    const report={status:'PASS',electron:await app.evaluate(()=>process.versions.electron),preferences,rendererHasNode:false,tokenInRenderer:false,login:true,scopedTasks:true,detail:true,logoutClearsDom:true,externalNavigationDenied:true,pageErrors:errors,screenshots:['login.png','task.png'],notVerified:['native-file-dialog','OS-install-signature','device-binding','macOS','production']};
    await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await app.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
