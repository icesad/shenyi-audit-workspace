'use strict';
// All requests below use newly owned loopback services and in-memory test keys.
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {generateKeyPairSync,sign,createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {createTeamClient}=require('../desktop/team-client.cjs');
const proof=require('../shared/device-proof.cjs');
const BASE=process.platform==='win32'?'D:/codex-temp/shenyi-m7-pilot-rehearsal-20261118/service-tests':path.join(os.tmpdir(),'shenyi-pilot-service-tests');
const PASSWORD='ShenyiDemo!2026';
const ORIGINAL=Buffer.from('审易合成验收资料\n银行对账说明\n本文件用于练习采集和核对，全部数据为演练内容。\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const launcher=path.resolve(__dirname,'../scripts/team-isolated-preview.mjs');

async function parentDirectory(){
  await fs.mkdir(BASE,{recursive:true});
  return fs.mkdtemp(path.join(BASE,'pilot-'));
}
async function service(t,parent,name,options={}){
  const {createIsolatedPreviewService}=await import('../scripts/team-isolated-preview.mjs');
  const own=await createIsolatedPreviewService({rootDirectory:path.join(parent,name),...options});
  t.after(()=>own.close());
  return own;
}
function readDatabase(own,read){
  const db=new DatabaseSync(path.join(own.context.directory,'team-demo.sqlite'),{readOnly:true});
  try{return read(db);}finally{db.close();}
}
function originalFacts(own){
  return readDatabase(own,db=>({
    attachments:db.prepare('SELECT team_id,task_id,attachment_id,display_name,hex(bytes) AS bytes FROM team_collection_attachments ORDER BY attachment_id').all(),
    submissions:db.prepare('SELECT * FROM team_task_submissions ORDER BY submission_id').all(),
    grants:db.prepare('SELECT * FROM team_attachment_grants ORDER BY team_id,attachment_id,user_id').all(),
  }));
}
function identity(){
  const pair=generateKeyPairSync('ed25519');
  const publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');
  return {platform:process.platform,vault:{
    async getPublicIdentity(){return {publicKey,fingerprint:proof.parsePublicKey(publicKey).fingerprint};},
    async signChallenge(fields){return sign(null,proof.challengeBytes(fields),pair.privateKey).toString('base64url');},
    async signRequest(fields){return sign(null,proof.requestProofBytes(fields),pair.privateKey).toString('base64url');},
  }};
}
async function clientFor(own,username){
  const client=createTeamClient({isolatedPreview:own.context.profile,deviceIdentity:identity(),fetchImpl:async(url,options)=>{
    assert.equal(new URL(url).origin,own.address.url,'client must never leave its newly owned listener');
    return fetch(url,options);
  }});
  const initial=await client.login({username,password:PASSWORD});
  assert.equal(initial.account.id,username);
  assert.equal(initial.device.state,'enrollment_required');
  await client.enrollDevice({displayName:'Synthetic pilot '+username,currentPassword:PASSWORD,confirmed:true});
  assert.equal(client.getDeviceStatus().state,'ready');
  return client;
}

test('pilot mode requires explicit boolean opt-in, excludes billing mode and refuses CLI path overrides',async()=>{
  const {createIsolatedPreviewService}=await import('../scripts/team-isolated-preview.mjs');
  const parent=await parentDirectory();
  const invalid=[{pilotDemo:'true'},{pilotDemo:null},{pilotDemo:1},{pilotDemo:{}},{pilotDemo:true,billingDemo:true}];
  for(const [index,options]of invalid.entries()){
    const rootDirectory=path.join(parent,'invalid-'+index);
    await assert.rejects(createIsolatedPreviewService({rootDirectory,...options}),/独立候选预览模式无效/);
    await assert.rejects(fs.access(rootDirectory),{code:'ENOENT'});
  }
  for(const args of [['--pilot-demo','--billing-demo'],['--pilot-demo','--data-dir',path.join(parent,'forbidden-caller-data')]]){
    const result=spawnSync(process.execPath,[launcher,...args],{encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(result.status,1,result.stderr);
    assert.equal(result.stdout,'');
    assert.match(result.stderr,/--pilot-demo/);
  }
  await assert.rejects(fs.access(path.join(parent,'forbidden-caller-data')),{code:'ENOENT'});
});

test('ordinary, billing and pilot previews keep separate databases, credentials, reports, ports and vaults',{timeout:60000},async t=>{
  const parent=await parentDirectory();
  const ordinary=await service(t,parent,'ordinary',{pilotDemo:false});
  const billing=await service(t,parent,'billing',{billingDemo:true});
  const pilot=await service(t,parent,'pilot',{pilotDemo:true});
  assert.equal(new Set([ordinary,billing,pilot].map(own=>own.address.port)).size,3);
  for(const field of ['directory','desktopDataDirectory','deviceVaultDirectory']){
    assert.equal(new Set([ordinary,billing,pilot].map(own=>own.context[field])).size,3,field);
  }
  assert.equal(new Set([ordinary,billing,pilot].map(own=>own.context.profile.serverId)).size,3);
  assert.equal(ordinary.cases,undefined);
  assert.equal(ordinary.pilotCases,undefined);
  assert.equal(billing.pilotCases,undefined);
  assert.deepEqual(Object.keys(billing.cases).sort(),['annualRenewal','refundSeat','seatAddition','timedOutAnnual']);
  assert.equal(pilot.cases,undefined);
  for(const own of [ordinary,billing]){
    await assert.rejects(fs.access(path.join(own.context.directory,'pilot-demo-cases.json')),{code:'ENOENT'});
    await assert.rejects(fs.access(path.join(own.context.directory,'pilot-follow-up.txt')),{code:'ENOENT'});
    assert.equal(readDatabase(own,db=>db.prepare("SELECT COUNT(*) n FROM team_collection_tasks WHERE task_id='pilot-review-task'").get().n),0);
  }
  await assert.rejects(fs.access(path.join(pilot.context.directory,'billing-demo-cases.json')),{code:'ENOENT'});
  const report=JSON.parse(await fs.readFile(path.join(pilot.context.directory,'pilot-demo-cases.json'),'utf8'));
  assert.deepEqual(report,pilot.pilotCases);
  assert.equal(report.teamId,'team-a');assert.equal(report.projectId,'project-a');
  assert.deepEqual(report.task,{id:'pilot-review-task',title:'银行对账说明（已提交示例）'});
  assert.deepEqual(report.actors,{submitter:'intern-a',otherCollector:'assistant-a',reviewer:'manager-a',otherManager:'partner-a'});
  assert.equal(report.original.filename,'合成银行对账说明.txt');
  assert.equal(report.original.sha256,sha(ORIGINAL));
  assert.equal(report.original.byteLength,ORIGINAL.length);
  assert.equal(report.followUpFile,'pilot-follow-up.txt');
  assert.match(await fs.readFile(path.join(pilot.context.directory,report.followUpFile),'utf8'),/合成验收资料[\s\S]*补充件/);
  assert.equal(readDatabase(pilot,db=>db.prepare("SELECT COUNT(*) n FROM team_users WHERE user_id IN ('billing-admin-demo','refund-owner-demo')").get().n),0);
  assert.equal(readDatabase(pilot,db=>db.prepare('SELECT COUNT(*) n FROM team_annual_orders').get().n),0);
  assert.equal(readDatabase(pilot,db=>db.prepare('SELECT COUNT(*) n FROM team_seat_orders').get().n),0);
  const original=originalFacts(pilot);
  assert.equal(original.attachments.length,1);assert.equal(original.submissions.length,1);
  assert.equal(original.attachments[0].bytes,ORIGINAL.toString('hex').toUpperCase());
  assert.deepEqual(original.grants.map(row=>row.user_id),['intern-a']);
  for(const own of [ordinary,billing,pilot]){
    const response=await fetch(own.address.url+'/api/auth/methods'),methods=await response.json();
    assert.equal(response.status,200);assert.equal(methods.deviceBinding.required,true);
    assert.equal(methods.deviceBinding.serverId,own.context.profile.serverId);
  }
});

test('four signed pilot roles obey task, review and original scopes and explicit review grant/revoke',{timeout:60000},async t=>{
  const parent=await parentDirectory(),own=await service(t,parent,'pilot',{pilotDemo:true});
  const report=own.pilotCases,events=[];
  own.server.on('request',request=>events.push({route:new URL(request.url,own.address.url).pathname,method:request.method,
    auth:!!request.headers.authorization,lease:!!request.headers['x-shenyi-device-lease'],signed:!!request.headers['x-shenyi-device-signature']}));
  const intern=await clientFor(own,report.actors.submitter),assistant=await clientFor(own,report.actors.otherCollector);
  const manager=await clientFor(own,report.actors.reviewer),partner=await clientFor(own,report.actors.otherManager);
  const project={teamId:report.teamId,projectId:report.projectId},task={teamId:report.teamId,taskId:report.task.id};
  const review={...project,taskId:report.task.id},file={...review,submissionId:report.original.submissionId};
  const assigned={intern:['pilot-review-task','task-a'],assistant:['task-assistant'],manager:['pilot-review-task','task-a','task-assistant'],partner:['pilot-review-task','task-a','task-assistant']};
  for(const [name,client]of Object.entries({intern,assistant,manager,partner})){
    assert.deepEqual((await client.listTasks({teamId:report.teamId})).tasks.map(row=>row.id).sort(),assigned[name]);
    await assert.rejects(client.listTasks({teamId:'team-b'}),{code:'HTTP_404'});
  }
  await assert.rejects(intern.getTask({teamId:report.teamId,taskId:'task-assistant'}),{code:'HTTP_404'});
  await assert.rejects(assistant.getTask(task),{code:'HTTP_404'});
  for(const client of [intern,assistant]){
    assert.deepEqual(await client.getProjectAccess(),{teams:[]});
    await assert.rejects(client.getProject(project),{code:'HTTP_404'});
    await assert.rejects(client.listProjectSubmissions(review),{code:'HTTP_404'});
    await assert.rejects(client.getProjectSubmissionFile(file),{code:'HTTP_404'});
  }
  const managerProject=(await manager.getProject(project)).project,partnerProject=(await partner.getProject(project)).project;
  assert.equal(managerProject.canManageAccess,true);assert.equal(managerProject.canReview,true);
  assert.equal(partnerProject.canCreateTask,true);assert.equal(partnerProject.canManageAccess,false);assert.equal(partnerProject.canReview,false);
  const facts=originalFacts(own);
  const records=await manager.listProjectSubmissions(review);
  assert.equal(records.hasMore,false);assert.equal(records.submissions.length,1);
  assert.deepEqual({...records.submissions[0],createdAt:0},{id:report.original.submissionId,attachmentId:report.original.attachmentId,
    filename:report.original.filename,sha256:sha(ORIGINAL),byteLength:ORIGINAL.length,createdAt:0,
    submittedBy:{id:report.actors.submitter,displayName:report.actors.submitter}});
  assert.deepEqual(await manager.authorizeProjectSubmissionDownload(file),{canDownload:true});
  assert.deepEqual(Buffer.from((await manager.getProjectSubmissionFile(file)).bytes),ORIGINAL);
  for(const method of ['listProjectSubmissions','getProjectSubmissionFile','authorizeProjectSubmissionDownload']){
    await assert.rejects(partner[method](method==='listProjectSubmissions'?review:file),{code:'HTTP_404'});
  }
  const attachment={...task,attachmentId:report.original.attachmentId};
  assert.deepEqual(Buffer.from((await intern.download(attachment)).bytes),ORIGINAL);
  await assert.rejects(assistant.download(attachment),{code:'HTTP_404'});
  await assert.rejects(partner.download(attachment),{code:'HTTP_404'});
  assert.equal((await intern.getSubmissions(task)).submissions[0].id,report.original.submissionId);
  assert.deepEqual(originalFacts(own),facts);

  const grantReview=async reviewFlag=>{
    const current=(await manager.getProject(project)).project;
    const target=(await manager.listProjectMembers(project)).members.find(row=>row.id===report.actors.otherManager);
    assert.ok(target);
    return manager.changeProjectAccess({...project,revision:current.revision,userId:target.id,memberRevision:target.revision,
      read:true,manage:true,review:reviewFlag,currentPassword:PASSWORD,confirmed:true});
  };
  await grantReview(true);
  await assert.rejects(partner.listProjectSubmissions(review),{code:'SIGN_IN_REQUIRED'});
  assert.equal((await partner.login({username:report.actors.otherManager,password:PASSWORD})).device.state,'ready');
  assert.equal((await partner.listProjectSubmissions(review)).submissions.length,1);
  assert.deepEqual(Buffer.from((await partner.getProjectSubmissionFile(file)).bytes),ORIGINAL);
  await grantReview(false);
  await assert.rejects(partner.listProjectSubmissions(review),{code:'SIGN_IN_REQUIRED'});
  assert.equal((await partner.login({username:report.actors.otherManager,password:PASSWORD})).device.state,'ready');
  await assert.rejects(partner.listProjectSubmissions(review),{code:'HTTP_404'});
  await assert.rejects(partner.getProjectSubmissionFile(file),{code:'HTTP_404'});
  assert.equal((await manager.listProjectSubmissions(review)).submissions.length,1);
  assert.deepEqual(originalFacts(own),facts,'review access changes must not replace or rewrite the original');
  const business=events.filter(event=>event.route.startsWith('/api/teams/'));
  assert.ok(business.length>30);
  assert.ok(business.every(event=>event.auth&&event.lease&&event.signed),'all role operations traversed strict real signed HTTP');
});
