'use strict';
// Legacy M2 diagnostic compatibility; this harness does not prove device binding.
// Real Electron main/preload/UI + isolated SQLite + ephemeral loopback HTTP.
// The main-process save dialog is a synthetic held/released test interception;
// this run does not claim a person operated an operating-system file picker.
const {_electron:electron}=require('../node_modules/playwright');
const assert=require('node:assert/strict'),{DatabaseSync,backup}=require('node:sqlite');
const fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function exists(filename){try{await fs.access(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function main(){
 const directory=path.resolve(process.env.SHENYI_DESKTOP_EVIDENCE_DIR||'D:/codex-temp/shenyi-download-preflight-20261115/real-electron-synthetic');
 const runDirectory=path.join(directory,'run-'+new Date().toISOString().replace(/[:.]/g,'-'));await fs.mkdir(runDirectory,{recursive:true});
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs'),{startTeamServer}=await source('dev-server.mjs');
 const db=new DatabaseSync(path.join(runDirectory,'synthetic-team.sqlite'));initializeTeamDatabase(db);await seedDemoTeamData(db);
 const service=await startTeamServer({db,port:0});
 const requests={attachmentGet:0,attachmentHead:0,submissionPost:0},httpEvents=[];
 service.server.on('request',(request,response)=>{
  const pathname=new URL(request.url,service.address.url).pathname;
  if(request.method==='POST'&&pathname.endsWith('/submissions'))requests.submissionPost++;
  if(!/\/attachments\/[^/]+$/.test(pathname))return;
  if(request.method==='GET')requests.attachmentGet++;if(request.method==='HEAD')requests.attachmentHead++;
  response.on('finish',()=>httpEvents.push({method:request.method,status:response.statusCode}));
 });
 const original={filename:'synthetic-original.bin',bytes:Buffer.from('Synthetic download original.\0\r\n原件副本; no client data.\r\n')};original.sha256=digest(original.bytes);
 const destinations=Object.fromEntries(['normal','cancel','grant-revoked','session-revoked'].map(name=>[name,path.join(runDirectory,name+'-saved-copy.bin')]));
 const bootstrap=path.join(runDirectory,'synthetic-bootstrap.cjs');
 await fs.writeFile(bootstrap,`'use strict';const diagnosticClient=require(${JSON.stringify(path.resolve(__dirname,'../tests/helpers/desktop-m2-diagnostic-client.cjs'))}).createM2DiagnosticClient;
const {ipcMain}=require('electron');
globalThis.__downloadEvidenceFs=require('node:fs/promises');globalThis.__downloadEvidencePath=require('node:path');globalThis.__downloadEvidenceCrypto=require('node:crypto');
globalThis.__downloadEvidenceChannels=[];globalThis.__downloadEvidenceResults=[];
const originalHandle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>{if(channel.startsWith('shenyi:'))globalThis.__downloadEvidenceChannels.push(channel);return originalHandle(channel,async(...args)=>{const result=await listener(...args);if(channel==='shenyi:download')globalThis.__downloadEvidenceResults.push({ok:result.ok,errorCode:result.error?.code??null,value:result.ok?result.value:null});return result;});};
const modulePath=${JSON.stringify(path.join(__dirname,'team-client.cjs'))};
const {createTeamClient:originalClient,API_BASE}=require(modulePath);
require(modulePath).createTeamClient=options=>diagnosticClient(originalClient,{...options,baseUrl:API_BASE,fetchImpl:(url,settings)=>{if(!url.startsWith(API_BASE+'/'))throw Error('Unexpected test API origin');return fetch(${JSON.stringify(service.address.url)}+url.slice(API_BASE.length),settings);}});
require(${JSON.stringify(path.join(__dirname,'main.cjs'))});
`);
 const actors=[],pageErrors=[],cases=[],screenshots=[];let stage='synthetic-upload';
 try{
  // Upload through the real HTTP application. This setup bearer stays in this
  // Node process; neither it nor the native-window bearer enters the renderer.
  const signed=await fetch(service.address.url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'intern-a',password:'ShenyiDemo!2026'})});assert.equal(signed.status,200);
  const setup=await signed.json();assert.equal(typeof setup.token,'string');
  const submitted=await fetch(service.address.url+'/api/teams/team-a/collection/tasks/task-a/submissions',{method:'POST',headers:{Authorization:'Bearer '+setup.token,'Content-Type':'application/json'},body:JSON.stringify({filename:original.filename,contentBase64:original.bytes.toString('base64'),revision:0})});assert.equal(submitted.status,201);
  const submission=await submitted.json();assert.equal(submission.submission.sha256,original.sha256);assert.equal(submission.submission.byteLength,original.bytes.length);
  const target={teamId:'team-a',taskId:'task-a',attachmentId:submission.submission.attachmentId};
  const attachmentPath='/api/teams/team-a/collection/tasks/task-a/attachments/'+target.attachmentId;
  const serviceGet=await fetch(service.address.url+attachmentPath,{headers:{Authorization:'Bearer '+setup.token}});assert.equal(serviceGet.status,200);const serviceBytes=Buffer.from(await serviceGet.arrayBuffer());assert.deepEqual(serviceBytes,original.bytes);assert.equal(digest(serviceBytes),original.sha256);
  async function launch(name){
   const app=await electron.launch({executablePath:require('electron'),args:[bootstrap],env:{...process.env,SHENYI_DESKTOP_DATA_DIR:path.join(runDirectory,name+'-profile')}});
   const actor={name,app,page:await app.firstWindow()};actors.push(actor);actor.page.setDefaultTimeout(15000);actor.page.on('pageerror',error=>pageErrors.push({actor:name,message:error.message}));
   await app.evaluate(({dialog},allowedDestinations)=>{
    const filesystem=globalThis.__downloadEvidenceFs,paths=globalThis.__downloadEvidencePath,crypto=globalThis.__downloadEvidenceCrypto;
    const allowed=new Set(allowedDestinations.map(filename=>paths.resolve(filename)));
    const state=globalThis.__downloadEvidence={mode:'cancel',destination:null,dialogs:0,writes:0,lastWrite:null,held:false,release:null,defaultPath:null};
    const originalWrite=filesystem.writeFile;
    filesystem.writeFile=async function(filename,bytes,...args){if(typeof filename==='string'&&allowed.has(paths.resolve(filename))){state.writes++;state.lastWrite={byteLength:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}return originalWrite.call(this,filename,bytes,...args);};
    dialog.showSaveDialog=async(_window,options)=>{
     state.dialogs++;state.defaultPath=options.defaultPath;
     if(state.mode==='cancel')return {canceled:true};
     if(state.mode==='hold'){state.held=true;return new Promise(resolve=>{state.release=value=>{state.held=false;state.release=null;resolve(value);};});}
     return {canceled:false,filePath:state.destination};
    };
    dialog.showOpenDialog=async()=>{throw Error('Unexpected open dialog in download preflight test');};
   },Object.values(destinations));
   return actor;
  }
  async function login(actor,username){await actor.page.locator('#username').fill(username);await actor.page.locator('#password').fill('ShenyiDemo!2026');await actor.page.locator('#login-submit').click();await actor.page.locator('#workspace-view:not([hidden])').waitFor();await actor.page.locator('#logout:enabled').waitFor();}
  async function snapshot(actor){return actor.app.evaluate(()=>{const {dialogs,writes,lastWrite,held,defaultPath}=globalThis.__downloadEvidence;return {dialogs,writes,lastWrite,held,defaultPath,results:globalThis.__downloadEvidenceResults.slice()};});}
  async function mode(actor,value,destination){assert.equal(await exists(destination),false,'each case uses a fresh destination');await actor.app.evaluate((_electron,input)=>{const state=globalThis.__downloadEvidence;if(state.held)throw Error('Previous synthetic save dialog is still held');Object.assign(state,{mode:input.mode,destination:input.destination,dialogs:0,writes:0,lastWrite:null,defaultPath:null});globalThis.__downloadEvidenceResults.length=0;},{mode:value,destination});}
  async function waitHeld(actor){const deadline=Date.now()+10000;while(!(await snapshot(actor)).held){assert.ok(Date.now()<deadline,'real Electron main must reach held save dialog');await new Promise(resolve=>setTimeout(resolve,30));}}
  async function release(actor,destination){await actor.app.evaluate((_electron,filename)=>{const state=globalThis.__downloadEvidence;if(!state.release)throw Error('No held save dialog');state.release({canceled:false,filePath:filename});},destination);}
  async function photograph(actor,name){const filename=path.join(runDirectory,name);await actor.page.screenshot({path:filename,fullPage:true});screenshots.push(filename);}
  const beforeCase=()=>({...requests,eventIndex:httpEvents.length});
  function requestDelta(before){return {attachmentGet:requests.attachmentGet-before.attachmentGet,attachmentHead:requests.attachmentHead-before.attachmentHead,submissionPost:requests.submissionPost-before.submissionPost,httpEvents:httpEvents.slice(before.eventIndex)};}
  const intern=await launch('intern'),assistant=await launch('assistant');
  const previousInternSessions=new Set(db.prepare("SELECT token_hash FROM team_sessions WHERE user_id='intern-a'").all().map(row=>row.token_hash));
  stage='native-login';await login(intern,'intern-a');await login(assistant,'assistant-a');
  const nativeSessions=db.prepare("SELECT token_hash FROM team_sessions WHERE user_id='intern-a'").all().filter(row=>!previousInternSessions.has(row.token_hash));assert.equal(nativeSessions.length,1);const nativeSessionHash=nativeSessions[0].token_hash;
  await intern.page.locator('.task-button').filter({hasText:'收集银行对账单'}).click();await intern.page.getByText(original.filename,{exact:true}).waitFor();await intern.page.getByRole('button',{name:'下载原件',exact:true}).waitFor();await intern.page.locator('#logout:enabled').waitFor();
  stage='normal-save';await mode(intern,'choose',destinations.normal);let before=beforeCase();
  await intern.page.getByRole('button',{name:'下载原件',exact:true}).click();await intern.page.locator('#workspace-message').filter({hasText:'原件副本已保存：'+path.basename(destinations.normal)}).waitFor();await intern.page.locator('#logout:enabled').waitFor();
  const normal=await snapshot(intern),normalDelta=requestDelta(before),savedBytes=await fs.readFile(destinations.normal);
  assert.equal(normal.dialogs,1);assert.equal(normal.writes,1);assert.equal(normal.defaultPath,original.filename);assert.deepEqual(normal.lastWrite,{byteLength:original.bytes.length,sha256:original.sha256});assert.deepEqual(normal.results,[{ok:true,errorCode:null,value:{saved:true,filename:path.basename(destinations.normal),byteLength:original.bytes.length}}]);
  assert.deepEqual(savedBytes,original.bytes);assert.equal(digest(savedBytes),digest(serviceBytes));assert.deepEqual(normalDelta,{attachmentGet:1,attachmentHead:1,submissionPost:0,httpEvents:[{method:'GET',status:200},{method:'HEAD',status:200}]});
  cases.push({name:'normal-save',result:normal,requests:normalDelta,destination:destinations.normal,sha256:digest(savedBytes),byteLength:savedBytes.length,serviceMainDiskBytesAndHashesEqual:true,rendererReturnsOnlyBasename:true});await photograph(intern,'normal-original-saved.png');
  stage='cancel';await mode(intern,'cancel',destinations.cancel);before=beforeCase();
  await intern.page.getByRole('button',{name:'下载原件',exact:true}).click();await intern.page.locator('#workspace-message').filter({hasText:'已取消，未保存副本'}).waitFor();await intern.page.locator('#logout:enabled').waitFor();
  const cancel=await snapshot(intern),cancelDelta=requestDelta(before);assert.equal(cancel.dialogs,1);assert.equal(cancel.writes,0);assert.equal(await exists(destinations.cancel),false);assert.deepEqual(cancel.results,[{ok:true,errorCode:null,value:{canceled:true}}]);assert.deepEqual(cancelDelta,{attachmentGet:1,attachmentHead:0,submissionPost:0,httpEvents:[{method:'GET',status:200}]});cases.push({name:'cancel',result:cancel,requests:cancelDelta,destinationAbsent:true});await photograph(intern,'save-canceled.png');
  stage='attachment-grant-revoked';await mode(intern,'hold',destinations['grant-revoked']);before=beforeCase();
  await intern.page.getByRole('button',{name:'下载原件',exact:true}).click();await waitHeld(intern);assert.equal((await snapshot(intern)).writes,0);
  const originalGrant=db.prepare("SELECT team_id,attachment_id,user_id,status FROM team_attachment_grants WHERE team_id='team-a' AND attachment_id=? AND user_id='intern-a'").get(target.attachmentId);assert.equal(originalGrant.status,'active');
  db.prepare("UPDATE team_attachment_grants SET status='revoked' WHERE team_id=? AND attachment_id=? AND user_id=?").run(originalGrant.team_id,originalGrant.attachment_id,originalGrant.user_id);
  await release(intern,destinations['grant-revoked']);await intern.page.locator('#workspace-message').filter({hasText:'任务不存在或当前账号无权访问'}).waitFor();await intern.page.locator('#logout:enabled').waitFor();
  const revoked=await snapshot(intern),revokedDelta=requestDelta(before);assert.equal(revoked.dialogs,1);assert.equal(revoked.writes,0);assert.equal(await exists(destinations['grant-revoked']),false);assert.deepEqual(revoked.results,[{ok:false,errorCode:'HTTP_404',value:null}]);assert.deepEqual(revokedDelta,{attachmentGet:1,attachmentHead:1,submissionPost:0,httpEvents:[{method:'GET',status:200},{method:'HEAD',status:404}]});
  const grantSnapshot=path.join(runDirectory,'attachment-grant-revoked-stage.sqlite');await backup(db,grantSnapshot);cases.push({name:'attachment-grant-revoked-in-save-dialog',result:revoked,requests:revokedDelta,destinationAbsent:true,sqliteAtCase:grantSnapshot});await photograph(intern,'save-grant-revocation-rejected.png');
  db.prepare('UPDATE team_attachment_grants SET status=? WHERE team_id=? AND attachment_id=? AND user_id=?').run(originalGrant.status,originalGrant.team_id,originalGrant.attachment_id,originalGrant.user_id);
  stage='server-session-revoked';await mode(intern,'hold',destinations['session-revoked']);before=beforeCase();
  await intern.page.getByRole('button',{name:'下载原件',exact:true}).click();await waitHeld(intern);assert.equal((await snapshot(intern)).writes,0);
  const revokedSession=db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').run(Date.now(),nativeSessionHash);assert.equal(revokedSession.changes,1);
  await release(intern,destinations['session-revoked']);await intern.page.locator('#login-view:not([hidden])').waitFor();await intern.page.locator('#login-message').filter({hasText:'登录已失效，请重新登录'}).waitFor();await intern.page.locator('#login-submit:enabled').waitFor();
  const session=await snapshot(intern),sessionDelta=requestDelta(before);assert.equal(session.dialogs,1);assert.equal(session.writes,0);assert.equal(await exists(destinations['session-revoked']),false);assert.deepEqual(session.results,[{ok:false,errorCode:'SIGN_IN_REQUIRED',value:null}]);assert.deepEqual(sessionDelta,{attachmentGet:1,attachmentHead:1,submissionPost:0,httpEvents:[{method:'GET',status:200},{method:'HEAD',status:401}]});
  assert.equal(await intern.page.locator('.task-button').count(),0);assert.equal(await intern.page.locator('#task-detail').textContent(),'');assert.equal(await intern.page.locator('#account-name').textContent(),'');assert.equal(await intern.page.locator('#team-select option').count(),0);assert.equal(await intern.page.locator('#username').inputValue(),'');assert.equal((await intern.page.evaluate(()=>window.shenyiTeam.getSession())).value,null);
  assert.equal((await assistant.page.evaluate(()=>window.shenyiTeam.getSession())).value.account.id,'assistant-a');assert.equal(await assistant.page.locator('#workspace-view').isVisible(),true);
  const sessionSnapshot=path.join(runDirectory,'server-session-revoked-stage.sqlite');await backup(db,sessionSnapshot);cases.push({name:'server-session-revoked-in-save-dialog',result:session,requests:sessionDelta,destinationAbsent:true,loginReturnedAndTaskIdentityCleared:true,otherWindowStillSignedIn:true,sqliteAtCase:sessionSnapshot});await photograph(intern,'save-session-revocation-returns-login.png');
  stage='runtime-invariants';const invariants=[];
  for(const actor of actors){
   const keys=await actor.page.evaluate(()=>Object.keys(window.shenyiTeam)),channels=await actor.app.evaluate(()=>globalThis.__downloadEvidenceChannels.slice());assert.equal(keys.length,98);assert.equal(new Set(keys).size,98);assert.equal(channels.length,98);assert.equal(new Set(channels).size,98);assert.equal(keys.includes('checkAttachmentAccess'),false);
   assert.equal(await actor.page.locator('form').count(),18);const passwords=await actor.page.locator('input[type=password]').evaluateAll(fields=>fields.map(field=>field.value));assert.equal(passwords.length,24);assert.ok(passwords.every(value=>value===''));
   const publicSession=(await actor.page.evaluate(()=>window.shenyiTeam.getSession())).value;assert.ok(publicSession===null||!('token' in publicSession));assert.equal(await actor.page.evaluate(()=>typeof require),'undefined');assert.equal(await actor.page.evaluate(()=>typeof process),'undefined');assert.equal(await actor.page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}})),'{"local":{},"session":{}}');
   const preferences=await actor.app.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();return {nodeIntegration:p.nodeIntegration,contextIsolation:p.contextIsolation,sandbox:p.sandbox,webSecurity:p.webSecurity};});assert.deepEqual(preferences,{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true});
   invariants.push({actor:actor.name,apiMethods:98,ipcChannels:98,forms:18,passwordInputs:24,passwordInputsEmpty:true,rendererBearer:false,rendererNode:false,storageEmpty:true,internalHeadMethodNotExposed:true,preferences});
  }
  assert.deepEqual(pageErrors,[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.deepEqual(requests,{attachmentGet:5,attachmentHead:3,submissionPost:1});
  const stored=db.prepare('SELECT content_sha256,byte_length FROM team_task_submissions WHERE attachment_id=?').get(target.attachmentId);assert.equal(stored.content_sha256,original.sha256);assert.equal(stored.byte_length,original.bytes.length);assert.deepEqual(Buffer.from(db.prepare('SELECT bytes FROM team_collection_attachments WHERE attachment_id=?').get(target.attachmentId).bytes),original.bytes);
  const report={status:'PASS',runDirectory,electron:await intern.app.evaluate(()=>process.versions.electron),layers:{electronWindows:2,realMainPreloadRenderer:true,loopbackHttp:service.address.url,isolatedSqlite:path.join(runDirectory,'synthetic-team.sqlite'),saveDialog:'synthetic intercepted main showSaveDialog held/released by test; no human OS picker acceptance'},syntheticAttachmentId:target.attachmentId,cases,invariants,requests,httpEvents,pageErrors,screenshots,original:{filename:original.filename,byteLength:original.bytes.length,sha256:original.sha256},normalCopyStillMatchesOriginalAfterRevocations:digest(await fs.readFile(destinations.normal))===original.sha256,notVerified:['person operating OS native save picker','instant revocation after the last HEAD and before local write','revocation of a previously lawful saved copy','real client audit files','macOS','device binding','real SMS or WeChat','production']};
  await fs.writeFile(path.join(runDirectory,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }catch(error){
  const failures=[];for(const actor of actors){const failure={actor:actor.name};failures.push(failure);try{await actor.app.evaluate(()=>{const state=globalThis.__downloadEvidence;if(state?.release)state.release({canceled:true});});failure.screenshot=path.join(runDirectory,'failure-'+actor.name+'.png');await actor.page.screenshot({path:failure.screenshot,fullPage:true});failure.messages=await actor.page.locator('.feedback').allTextContents();failure.evidence=await actor.app.evaluate(()=>{const state=globalThis.__downloadEvidence;if(!state)return null;const {dialogs,writes,lastWrite,held}=state;return {dialogs,writes,lastWrite,held,results:globalThis.__downloadEvidenceResults};});}catch(captureError){failure.captureError=captureError.message;}}
  const report={status:'FAIL',stage,error:error.message,runDirectory,requests,httpEvents,cases,pageErrors,failures,saveDialog:'synthetic intercepted main save dialog; no human OS picker acceptance'};await fs.writeFile(path.join(runDirectory,'failure-report.json'),JSON.stringify(report,null,2));console.error(JSON.stringify(report,null,2));throw error;
 }finally{for(const actor of actors)await actor.app.close();await service.close();db.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
