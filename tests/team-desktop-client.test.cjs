'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTeamClient,API_BASE,MAX_FILE_BYTES}=require('../desktop/team-client.cjs');
const token='a'.repeat(43);
const account={id:'user-a',displayName:'合成采集员'};
const session={account,memberships:[{teamId:'team-a',role:'intern'}],expiresAt:1794717600000};
const task={id:'task-a',title:'合成任务',instructions:'收集合成资料',status:'open'};
const original=Buffer.from('synthetic-original');
const submission={id:'submission-a',attachmentId:'attachment-a',filename:'合成资料.txt',sha256:require('node:crypto').createHash('sha256').update(original).digest('hex'),byteLength:original.length,createdAt:1794714000000};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function fixture(responder){const calls=[];const client=createTeamClient({fetchImpl:async(url,options)=>{calls.push({url,options});return responder?responder(url,options):json({token,...session});}});return {client,calls};}
async function login(client){return client.login({username:'intern-a',password:'ShenyiDemo!2026'});}

test('desktop client fixes the local endpoint and refuses arbitrary origins, paths and hosts',()=>{
  for(const baseUrl of ['https://evil.invalid','http://localhost:8774','http://127.0.0.1:8774/','http://127.0.0.1:8775',API_BASE+'/api'])assert.throws(()=>createTeamClient({baseUrl}));
});
test('login returns only an account/membership allowlist, retaining bearer exclusively in client closure',async()=>{
  const f=fixture(()=>json({token,...session,admin:true,password:'never show',otherTeam:'secret'}));
  const visible=await login(f.client);assert.deepEqual(visible,session);assert.ok(!JSON.stringify(visible).includes(token));assert.ok(!('token'in f.client));
  assert.equal(f.calls[0].options.redirect,'error');assert.equal(f.calls[0].options.headers.Origin,'shenyi://app');assert.equal(f.calls[0].options.headers.Authorization,undefined);
  assert.deepEqual(JSON.parse(f.calls[0].options.body),{username:'intern-a',password:'ShenyiDemo!2026'});
});
test('invalid login payloads and unlisted identity fields never reach network',async()=>{
  const f=fixture();
  for(const input of [null,[],{}, {username:'a',password:'x',role:'partner'},{username:'a',password:'x',server:'evil'}, {username:'',password:'x'},{username:'a',password:7}])await assert.rejects(()=>f.client.login(input));
  assert.equal(f.calls.length,0);
});
test('authenticated task lists use bearer but return only minimal task fields',async()=>{
  const f=fixture(url=>url.endsWith('/login')?json({token,...session}):json({tasks:[{...task,financial_summary:'private',structure_json:'private',project_id:'private'}],hasMore:false,totalProjects:99}));
  await login(f.client);const value=await f.client.listTasks({teamId:'team-a',q:'资料',limit:5});
  assert.deepEqual(value,{tasks:[task],hasMore:false});assert.equal(f.calls[1].options.headers.Authorization,'Bearer '+token);assert.ok(f.calls[1].url.includes('limit=5'));assert.ok(!JSON.stringify(value).includes('private'));
});
test('task/attachment paths and list parameters cannot become arbitrary requests',async()=>{
  const f=fixture();await login(f.client);const before=f.calls.length;
  for(const input of [{teamId:'../team-b'},{teamId:'team-a',role:'partner'},{teamId:'team-a',limit:101},{teamId:'team-a',after:'a/b'}])await assert.rejects(()=>f.client.listTasks(input));
  await assert.rejects(()=>f.client.download({teamId:'team-a',taskId:'task-a',attachmentId:'../../secret'}));assert.equal(f.calls.length,before);
});
test('expired server authentication clears local credentials and denies subsequent operations',async()=>{
  const f=fixture(url=>url.endsWith('/login')?json({token,...session}):json({error:{message:'do not forward'}},401));
  await login(f.client);await assert.rejects(()=>f.client.listTasks({teamId:'team-a'}),e=>e.code==='SIGN_IN_REQUIRED');assert.equal(await f.client.getSession(),null);
  const before=f.calls.length;await assert.rejects(()=>f.client.getTask({teamId:'team-a',taskId:'task-a'}));assert.equal(f.calls.length,before);
});
test('logout is locally final even when the server cannot be reached',async()=>{
  const f=fixture((url)=>{if(url.endsWith('/login'))return json({token,...session});throw Error('private failure');});await login(f.client);
  const guard=f.client.guardSession();await assert.rejects(()=>f.client.logout());assert.equal(await f.client.getSession(),null);assert.throws(guard,e=>e.code==='SESSION_CHANGED');
});
test('responses from the previous account are rejected after logout',async()=>{
  let resolveTask;const f=fixture(url=>url.endsWith('/login')?json({token,...session}):url.endsWith('/logout')?json({signedOut:true}):new Promise(resolve=>{resolveTask=resolve;}));
  await login(f.client);const pending=f.client.getTask({teamId:'team-a',taskId:'task-a'});await f.client.logout();resolveTask(json({task}));await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED');
});
test('upstream messages and redirects cannot leak provider details or retarget a credentialed request',async()=>{
  const f=fixture(url=>url.endsWith('/login')?json({token,...session}):json({error:{message:'SQL and token '+token}},503));await login(f.client);
  await assert.rejects(()=>f.client.listTasks({teamId:'team-a'}),e=>e.message==='团队服务暂时无法完成操作。'&&!e.message.includes(token));assert.equal(f.calls[1].options.redirect,'error');
});
test('submissions use the expected CAS revision, exact raw bytes and response allowlist',async()=>{
  const f=fixture(url=>url.endsWith('/login')?json({token,...session}):json({revision:1,submission:{...submission,path:'/private/path'}}));await login(f.client);
  const value=await f.client.upload({teamId:'team-a',taskId:'task-a',revision:0},{filename:submission.filename,bytes:original});assert.deepEqual(value,{revision:1,submission});
  const body=JSON.parse(f.calls[1].options.body);assert.deepEqual(Object.keys(body).sort(),['contentBase64','filename','revision']);assert.deepEqual(Buffer.from(body.contentBase64,'base64'),original);assert.equal(body.revision,0);
});
test('oversized uploads are rejected before network',async()=>{
  const f=fixture();await login(f.client);const before=f.calls.length;
  await assert.rejects(()=>f.client.upload({teamId:'team-a',taskId:'task-a',revision:0},{filename:'large.bin',bytes:new Uint8Array(MAX_FILE_BYTES+1)}));assert.equal(f.calls.length,before);
});
test('download requires exact task and attachment and preserves original bytes without exposing token',async()=>{
  const f=fixture(url=>url.endsWith('/login')?json({token,...session}):new Response(original,{headers:{'content-type':'application/octet-stream','content-disposition':"attachment; filename*=UTF-8''synthetic.txt"}}));await login(f.client);
  const result=await f.client.download({teamId:'team-a',taskId:'task-a',attachmentId:'attachment-a'});assert.deepEqual(Buffer.from(result.bytes),original);assert.ok(!('token'in result));
});
test('response byte limits apply even without Content-Length',async()=>{
  const f=fixture(url=>url.endsWith('/login')?json({token,...session}):new Response(new Uint8Array(MAX_FILE_BYTES+1)));await login(f.client);
  await assert.rejects(()=>f.client.download({teamId:'team-a',taskId:'task-a',attachmentId:'attachment-a'}),e=>e.code==='RESPONSE_TOO_LARGE');
});
test('malformed authenticated JSON cannot be shown as task data',async()=>{
  const f=fixture(url=>url.endsWith('/login')?json({token,...session}):new Response('not json'));await login(f.client);
  await assert.rejects(()=>f.client.listTasks({teamId:'team-a'}),e=>e.code==='INVALID_RESPONSE');
});
