'use strict';
// Real Electron main/preload/renderer + ephemeral loopback HTTP + isolated SQLite.
// showOpenDialog is intercepted in main and held/released by this test. No person
// or operating-system picker interaction is claimed; only synthetic files exist.
const {_electron:electron}=require('../node_modules/playwright');
const assert=require('node:assert/strict'),{DatabaseSync,backup}=require('node:sqlite');
const {createHash}=require('node:crypto'),fs=require('node:fs/promises');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const target={teamId:'team-a',taskId:'task-a'};
async function main(){
 const directory=path.resolve(process.env.SHENYI_DESKTOP_EVIDENCE_DIR||'D:/codex-temp/shenyi-upload-preflight-20261115/real-electron-synthetic');
 const runDirectory=path.join(directory,'run-'+new Date().toISOString().replace(/[:.]/g,'-'));
 await fs.mkdir(runDirectory,{recursive:true});
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');
 const {startTeamServer}=await source('dev-server.mjs');
 const db=new DatabaseSync(path.join(runDirectory,'synthetic-team.sqlite'));
 initializeTeamDatabase(db);await seedDemoTeamData(db);
 const service=await startTeamServer({db,port:0}),requests={capabilityGet:0,submissionPost:0,assignmentPost:0};
 service.server.on('request',request=>{
  const pathname=new URL(request.url,service.address.url).pathname;
  if(request.method==='GET'&&pathname.endsWith('/submission-access'))requests.capabilityGet++;
  if(request.method==='POST'&&pathname.endsWith('/submissions'))requests.submissionPost++;
  if(request.method==='POST'&&pathname.endsWith('/assignment'))requests.assignmentPost++;
 });
 const fixture={filename:path.join(runDirectory,'synthetic-original.txt'),bytes:Buffer.from('Synthetic upload preflight original.\r\n原件\0No client data.\r\n')};
 fixture.sha256=digest(fixture.bytes);await fs.writeFile(fixture.filename,fixture.bytes);
 const bootstrap=path.join(runDirectory,'synthetic-bootstrap.cjs');
 await fs.writeFile(bootstrap,`'use strict';
const {ipcMain}=require('electron');
globalThis.__uploadEvidenceFilesystem=require('node:fs/promises');globalThis.__uploadEvidencePaths=require('node:path');
const originalHandle=ipcMain.handle.bind(ipcMain);
globalThis.__uploadEvidenceChannels=[];globalThis.__uploadEvidenceResults=[];
ipcMain.handle=(channel,listener)=>{if(channel.startsWith('shenyi:'))globalThis.__uploadEvidenceChannels.push(channel);return originalHandle(channel,async(...args)=>{const result=await listener(...args);if(channel==='shenyi:upload')globalThis.__uploadEvidenceResults.push({ok:result.ok,errorCode:result.error?.code??null,canceled:result.value?.canceled===true});return result;});};
const modulePath=${JSON.stringify(path.join(__dirname,'team-client.cjs'))};
const {createTeamClient:originalClient,API_BASE}=require(modulePath);
require(modulePath).createTeamClient=options=>originalClient({...options,baseUrl:API_BASE,fetchImpl:(url,settings)=>{if(!url.startsWith(API_BASE+'/'))throw Error('Unexpected test API origin');return fetch(${JSON.stringify(service.address.url)}+url.slice(API_BASE.length),settings);}});
require(${JSON.stringify(path.join(__dirname,'main.cjs'))});
`);
 const actors=[],pageErrors=[],cases=[],screenshots=[];let stage='launch';
 try{
  async function launch(name){
   const app=await electron.launch({executablePath:require('electron'),args:[bootstrap],env:{...process.env,SHENYI_DESKTOP_DATA_DIR:path.join(runDirectory,name+'-profile')}});
   const actor={name,app,page:await app.firstWindow()};actors.push(actor);actor.page.setDefaultTimeout(15000);
   actor.page.on('pageerror',error=>pageErrors.push({actor:name,message:error.message}));
   await app.evaluate(({dialog},filename)=>{
    const filesystem=globalThis.__uploadEvidenceFilesystem,paths=globalThis.__uploadEvidencePaths;
    const state=globalThis.__uploadEvidence={mode:'choose',dialogs:0,fileOpens:0,fileReads:0,held:false,release:null};
    const originalOpen=filesystem.open;
    filesystem.open=async function(file,...args){
     const exact=typeof file==='string'&&paths.resolve(file)===paths.resolve(filename);
     if(exact)state.fileOpens++;
     const handle=await originalOpen.call(this,file,...args);
     if(exact){const originalRead=handle.read;handle.read=function(...values){state.fileReads++;return originalRead.apply(this,values);};}
     return handle;
    };
    dialog.showOpenDialog=async()=>{
     state.dialogs++;
     if(state.mode==='cancel')return {canceled:true,filePaths:[]};
     if(state.mode==='hold'){state.held=true;return new Promise(resolve=>{state.release=value=>{state.held=false;state.release=null;resolve(value);};});}
     return {canceled:false,filePaths:[filename]};
    };
    dialog.showSaveDialog=async()=>{throw Error('Unexpected save dialog in upload preflight test');};
   },fixture.filename);
   return actor;
  }
  async function login(actor,username){
   await actor.page.locator('#username').fill(username);await actor.page.locator('#password').fill('ShenyiDemo!2026');
   await actor.page.locator('#login-submit').click();await actor.page.locator('#workspace-view:not([hidden])').waitFor();await actor.page.locator('#logout:enabled').waitFor();
  }
  async function select(actor,{refresh=false,canSubmit=true}={}){
   if(refresh){await actor.page.locator('#refresh').click();await actor.page.locator('#logout:enabled').waitFor();}
   await actor.page.locator('.task-button').filter({hasText:'收集银行对账单'}).click();
   await actor.page.locator('#task-detail h2').filter({hasText:'收集银行对账单'}).waitFor();
   await actor.page.locator('#task-submission-access-message').filter({hasText:canSubmit?'已核验本次提交权限':'当前账号无本任务提交权限'}).waitFor();
   await actor.page.locator('#logout:enabled').waitFor();
   assert.equal(await actor.page.locator('#task-upload').isEnabled(),canSubmit);
  }
  async function mode(actor,value){
   await actor.app.evaluate((_electron,next)=>{const state=globalThis.__uploadEvidence;assertNoHeld();state.mode=next;state.dialogs=0;state.fileOpens=0;state.fileReads=0;globalThis.__uploadEvidenceResults.length=0;function assertNoHeld(){if(state.held)throw Error('Previous synthetic picker is still held');}},value);
  }
  async function snapshot(actor){return actor.app.evaluate(()=>{const {dialogs,fileOpens,fileReads,held}=globalThis.__uploadEvidence;return {dialogs,fileOpens,fileReads,held,results:globalThis.__uploadEvidenceResults.slice()};});}
  async function waitHeld(actor){
   const deadline=Date.now()+10000;
   while(!(await snapshot(actor)).held){assert.ok(Date.now()<deadline,'real Electron main must reach the held picker');await new Promise(resolve=>setTimeout(resolve,30));}
  }
  async function release(actor){await actor.app.evaluate((_electron,filename)=>{const state=globalThis.__uploadEvidence;if(!state.release)throw Error('No held picker');state.release({canceled:false,filePaths:[filename]});},fixture.filename);}
  async function photograph(actor,name){const filename=path.join(runDirectory,name);await actor.page.screenshot({path:filename,fullPage:true});screenshots.push(filename);}
  function assertNoLocalReadOrPost(observed,postsBefore){assert.equal(observed.fileOpens,0);assert.equal(observed.fileReads,0);assert.equal(requests.submissionPost,postsBefore);}
  const manager=await launch('manager'),intern=await launch('intern');
  await login(manager,'manager-a');await login(intern,'intern-a');
  stage='readonly-manager';
  const managerManageGrant=db.prepare("SELECT team_id,project_id,user_id,permission,status FROM team_project_grants WHERE team_id='team-a' AND project_id='project-a' AND user_id='manager-a' AND permission='collection.manage'").get();
  assert.ok(managerManageGrant);assert.equal(managerManageGrant.status,'active');
  db.prepare("DELETE FROM team_project_grants WHERE team_id='team-a' AND project_id='project-a' AND user_id='manager-a' AND permission='collection.manage'").run();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM team_project_grants WHERE team_id='team-a' AND project_id='project-a' AND user_id='manager-a' AND permission='collection.manage'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM team_project_grants WHERE team_id='team-a' AND project_id='project-a' AND user_id='manager-a' AND permission='collection.read' AND status='active'").get().n,1);
  await select(manager,{canSubmit:false});await mode(manager,'choose');
  const readonlyManagement=await manager.page.evaluate(input=>window.shenyiTeam.getTaskManagement(input),target);assert.deepEqual(readonlyManagement,{ok:true,value:{canManage:false}});
  assert.equal(await manager.page.locator('#task-management').count(),0);
  let before=requests.submissionPost;
  const forced=await manager.page.evaluate(input=>window.shenyiTeam.chooseAndUpload(input),{...target,revision:0});
  assert.equal(forced.ok,false);assert.equal(forced.error.code,'UPLOAD_NOT_ALLOWED');
  const managerObserved=await snapshot(manager);assert.equal(managerObserved.dialogs,0);assertNoLocalReadOrPost(managerObserved,before);
  const readonlyDatabase=path.join(runDirectory,'readonly-manager-stage.sqlite');await backup(db,readonlyDatabase);
  cases.push({name:'readonly-manager-forced-rpc',result:managerObserved,uploadButtonDisabled:true,submissionPostDelta:0,hasProjectReadGrant:true,hasProjectManageGrant:false,managementCapability:readonlyManagement.value,taskManagementHidden:true,sqliteAtCase:readonlyDatabase});
  await photograph(manager,'manager-upload-disabled.png');
  // Restore exactly the removed synthetic grant only after read-only evidence.
  db.prepare('INSERT INTO team_project_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,?)').run(managerManageGrant.team_id,managerManageGrant.project_id,managerManageGrant.user_id,managerManageGrant.permission,managerManageGrant.status);
  stage='cancel';await select(intern);await mode(intern,'cancel');before=requests.submissionPost;
  await intern.page.locator('#task-upload').click();await intern.page.locator('#workspace-message').filter({hasText:'已取消，未提交资料'}).waitFor();await intern.page.locator('#task-upload:enabled').waitFor();
  const canceled=await snapshot(intern);assert.equal(canceled.dialogs,1);assertNoLocalReadOrPost(canceled,before);assert.deepEqual(canceled.results,[{ok:true,errorCode:null,canceled:true}]);
  cases.push({name:'cancel',result:canceled,submissionPostDelta:0});
  async function changeAssignment(userId,revision){
   const changed=await manager.page.evaluate(input=>window.shenyiTeam.assignTask(input),{...target,userId,revision});assert.equal(changed.ok,true,JSON.stringify(changed));assert.equal(changed.value.revision,revision+1);
  }
  async function pickerRace(name,mutate,code,message,screenshot){
   stage=name;await mode(intern,'hold');const postsBefore=requests.submissionPost;
   await intern.page.locator('#task-upload').click();await waitHeld(intern);
   assert.equal((await snapshot(intern)).fileOpens,0);await mutate();await release(intern);
   await intern.page.locator('#workspace-message').filter({hasText:message}).waitFor();await intern.page.locator('#logout:enabled').waitFor();
   const observed=await snapshot(intern);assert.equal(observed.dialogs,1);assert.equal(observed.held,false);assertNoLocalReadOrPost(observed,postsBefore);
   assert.deepEqual(observed.results,[{ok:false,errorCode:code,canceled:false}]);assert.equal(await intern.page.locator('#task-upload').isDisabled(),true);
   cases.push({name,result:observed,submissionPostDelta:0,uploadButtonDisabledAfterFailure:true,message:await intern.page.locator('#workspace-message').textContent()});
   if(screenshot)await photograph(intern,screenshot);
  }
  await pickerRace('picker-version-changed',()=>changeAssignment('intern-a',0),'HTTP_409','任务状态或版本已更新','picker-version-rejected.png');
  await select(intern,{refresh:true});
  await pickerRace('picker-assignment-revoked',()=>changeAssignment('assistant-a',1),'HTTP_404','任务不存在或当前账号无权访问','picker-revocation-rejected.png');
  await changeAssignment('intern-a',2);await select(intern,{refresh:true});
  await pickerRace('picker-project-frozen',async()=>{db.prepare("UPDATE team_projects SET status='frozen' WHERE team_id='team-a' AND project_id='project-a'").run();},'UPLOAD_NOT_ALLOWED','当前任务不可提交资料');
  db.prepare("UPDATE team_projects SET status='active' WHERE team_id='team-a' AND project_id='project-a'").run();await select(intern,{refresh:true});
  stage='successful-original';await mode(intern,'choose');before=requests.submissionPost;
  const initialAccess=await intern.page.evaluate(input=>window.shenyiTeam.getTaskSubmissionAccess(input),target);assert.deepEqual(initialAccess,{ok:true,value:{canSubmit:true,revision:3}});
  await intern.page.locator('#task-upload').click();await intern.page.locator('#workspace-message').filter({hasText:'资料已提交，原件与提交记录已保存'}).waitFor();
  await intern.page.getByText(path.basename(fixture.filename),{exact:true}).waitFor();await intern.page.locator('#logout:enabled').waitFor();
  const success=await snapshot(intern);assert.equal(success.dialogs,1);assert.equal(success.fileOpens,1);assert.ok(success.fileReads>0);assert.equal(requests.submissionPost,before+1);assert.deepEqual(success.results,[{ok:true,errorCode:null,canceled:false}]);assert.equal(await intern.page.locator('#task-upload').isDisabled(),true);
  const stored=db.prepare("SELECT submission.attachment_id,submission.content_sha256,submission.byte_length,submission.submitted_by,attachment.bytes FROM team_task_submissions AS submission JOIN team_collection_attachments AS attachment ON attachment.team_id=submission.team_id AND attachment.attachment_id=submission.attachment_id WHERE submission.team_id='team-a' AND submission.task_id='task-a'").all();
  assert.equal(stored.length,1);assert.equal(stored[0].submitted_by,'intern-a');assert.equal(stored[0].content_sha256,fixture.sha256);assert.equal(stored[0].byte_length,fixture.bytes.length);assert.deepEqual(Buffer.from(stored[0].bytes),fixture.bytes);assert.equal(digest(Buffer.from(stored[0].bytes)),fixture.sha256);
  assert.deepEqual((await intern.page.evaluate(input=>window.shenyiTeam.getTaskSubmissionAccess(input),target)).value,{canSubmit:false,revision:4});
  assert.equal((await manager.page.evaluate(input=>window.shenyiTeam.getSubmissions(input),target)).value.submissions.length,0);
  cases.push({name:'assigned-intern-original-preserved',result:success,submissionPostDelta:1,byteLength:fixture.bytes.length,sha256:fixture.sha256,finalRevision:4});
  await photograph(intern,'intern-original-preserved.png');
  stage='runtime-invariants';const invariants=[];
  for(const actor of actors){
   const apiKeys=await actor.page.evaluate(()=>Object.keys(window.shenyiTeam));assert.equal(apiKeys.length,54);assert.equal(new Set(apiKeys).size,54);assert.ok(apiKeys.includes('getTaskSubmissionAccess'));
   const ipcChannels=await actor.app.evaluate(()=>globalThis.__uploadEvidenceChannels.slice());assert.equal(ipcChannels.length,54);assert.equal(new Set(ipcChannels).size,54);
   assert.equal(await actor.page.locator('form').count(),10);const passwords=await actor.page.locator('input[type=password]').evaluateAll(fields=>fields.map(field=>field.value));assert.equal(passwords.length,16);assert.ok(passwords.every(value=>value===''));
   const session=(await actor.page.evaluate(()=>window.shenyiTeam.getSession())).value;assert.equal('token' in session,false);assert.equal(await actor.page.evaluate(()=>typeof require),'undefined');assert.equal(await actor.page.evaluate(()=>typeof process),'undefined');
   assert.equal(await actor.page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}})),'{"local":{},"session":{}}');
   const preferences=await actor.app.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {nodeIntegration:p.nodeIntegration,contextIsolation:p.contextIsolation,sandbox:p.sandbox,webSecurity:p.webSecurity};});assert.deepEqual(preferences,{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true});
   invariants.push({actor:actor.name,apiMethods:apiKeys.length,ipcChannels:ipcChannels.length,forms:10,passwordInputs:16,passwordInputsEmpty:true,rendererBearer:false,rendererNode:false,storageEmpty:true,preferences});
  }
  assert.deepEqual(pageErrors,[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(requests.submissionPost,1);
  const report={status:'PASS',runDirectory,electron:await manager.app.evaluate(()=>process.versions.electron),layers:{electronWindows:2,realMainPreloadRenderer:true,loopbackHttp:service.address.url,isolatedSqlite:path.join(runDirectory,'synthetic-team.sqlite'),filePicker:'synthetic intercepted main showOpenDialog; held/released through Electron main; no human OS picker acceptance'},readonlyManagerHasNoManageGrant:true,managerManageGrantRestoredForSyntheticRaceSetup:true,cases,invariants,requests,pageErrors,screenshots,originalBytesAndSha256Preserved:true,finalRevision:4,notVerified:['person operating the OS native picker','real client audit files','macOS','device binding','real SMS or WeChat','production']};
  await fs.writeFile(path.join(runDirectory,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }catch(error){
  const failures=[];
  for(const actor of actors){const failure={actor:actor.name};failures.push(failure);try{
   await actor.app.evaluate(()=>{const state=globalThis.__uploadEvidence;if(state?.release)state.release({canceled:true,filePaths:[]});});
   failure.screenshot=path.join(runDirectory,'failure-'+actor.name+'.png');await actor.page.screenshot({path:failure.screenshot,fullPage:true});failure.messages=await actor.page.locator('.feedback').allTextContents();failure.evidence=await actor.app.evaluate(()=>{const state=globalThis.__uploadEvidence;if(!state)return null;const {dialogs,fileOpens,fileReads,held}=state;return {dialogs,fileOpens,fileReads,held,results:globalThis.__uploadEvidenceResults};});
  }catch(failureError){failure.captureError=failureError.message;}}
  const report={status:'FAIL',stage,error:error.message,runDirectory,requests,cases,pageErrors,failures,filePicker:'synthetic intercepted main dialog; not human OS picker acceptance'};
  await fs.writeFile(path.join(runDirectory,'failure-report.json'),JSON.stringify(report,null,2));console.error(JSON.stringify(report,null,2));throw error;
 }finally{for(const actor of actors)await actor.app.close();await service.close();db.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
