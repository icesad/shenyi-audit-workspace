'use strict';
// Explicit local synthetic-service exercise. Never points at an arbitrary origin.
const assert=require('node:assert/strict');const {createHash}=require('node:crypto');
const {createTeamClient}=require('./team-client.cjs');
async function main(){
  if(!process.argv.includes('--local-demo'))throw Error('Use --local-demo against the isolated synthetic service only.');
  const client=createTeamClient();
  try{
    const account=await client.login({username:'assistant-b',password:'ShenyiDemo!2026'});
    const teamId=account.memberships[0].teamId;
    const tasks=await client.listTasks({teamId});
    const candidate=tasks.tasks.find(task=>['open','returned'].includes(task.status));
    if(!candidate)throw Error('No writable synthetic assistant-b task; use a fresh isolated demo data directory.');
    const taskId=candidate.id,history=await client.getSubmissions({teamId,taskId});
    const bytes=Buffer.from('Shenyi desktop main-client synthetic original\r\n\0\u4e2d\u6587','utf8');
    const result=await client.upload({teamId,taskId,revision:history.revision},{filename:'桌面联调合成资料.txt',bytes});
    const saved=await client.getSubmissions({teamId,taskId});
    assert.equal(saved.revision,result.revision);assert.ok(saved.submissions.some(item=>item.id===result.submission.id));
    const copy=await client.download({teamId,taskId,attachmentId:result.submission.attachmentId});
    assert.deepEqual(Buffer.from(copy.bytes),bytes);assert.equal(result.submission.sha256,createHash('sha256').update(bytes).digest('hex'));
    const detail=await client.getTask({teamId,taskId});assert.equal(detail.task.status,'submitted');
    await client.logout();assert.equal(await client.getSession(),null);
    console.log(JSON.stringify({status:'PASS',scope:'real-loopback-main-client',login:true,scopedTasks:tasks.tasks.length,upload:true,submissionHistory:true,originalBytes:true,sha256:true,submittedState:true,logout:true,notVerified:['native-dialog','desktop-runtime','devices','production']},null,2));
  }finally{client.clearSession();}
}
main().catch(()=>{console.error('Local synthetic client smoke failed; check service and isolated demo data.');process.exitCode=1;});
