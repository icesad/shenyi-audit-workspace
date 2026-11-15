'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTeamClient,API_BASE}=require('../desktop/team-client.cjs');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const TARGET={teamId:'team-a',taskId:'task-a'},TOKEN=Buffer.alloc(32,52).toString('base64url');
const SESSION={account:{id:'intern-a',displayName:'合成实习生'},memberships:[{teamId:'team-a',role:'intern'}],expiresAt:1900000000000};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function fixture(responder){const calls=[],client=createTeamClient({fetchImpl:async(url,options)=>{calls.push({url,options});if(url.endsWith('/api/auth/login'))return json({token:TOKEN,...SESSION});if(url.endsWith('/api/auth/session'))return json(SESSION);return responder(url,options);}});return {client,calls};}
const login=f=>f.client.login({username:'intern-a',password:'ShenyiDemo!2026'});
test('submission access needs an active main session and a complete exact task target',async()=>{
 const f=fixture(()=>json({canSubmit:true,revision:0}));await assert.rejects(()=>f.client.getTaskSubmissionAccess(TARGET),e=>e.code==='SIGN_IN_REQUIRED');assert.equal(f.calls.length,0);await login(f);const before=f.calls.length;
 for(const input of [undefined,{}, {teamId:'team-a'}, {taskId:'task-a'}, {...TARGET,taskId:'../private'}, {...TARGET,role:'partner'}, {...TARGET,userId:'victim'}, {...TARGET,revision:0}, {...TARGET,token:TOKEN}, {...TARGET,url:'https://evil.invalid'}])await assert.rejects(()=>f.client.getTaskSubmissionAccess(input));assert.equal(f.calls.length,before);
});
test('capability transport is fixed GET with main bearer and returns only boolean and revision',async()=>{
 for(const canSubmit of [true,false]){const f=fixture(()=>json({canSubmit,revision:7,assignees:[{id:'private'}],projectId:'hidden',phone:'13800138000',token:TOKEN}));await login(f);assert.deepEqual(await f.client.getTaskSubmissionAccess(TARGET),{canSubmit,revision:7});const {url,options}=f.calls.at(-1);assert.equal(url,API_BASE+'/api/teams/team-a/collection/tasks/task-a/submission-access');assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.headers.Authorization,'Bearer '+TOKEN);assert.equal(options.redirect,'error');}
});
test('malformed or nonincrementable affirmative capabilities fail closed',async()=>{
 for(const data of [null,{}, {canSubmit:1,revision:0}, {canSubmit:'true',revision:0}, {canSubmit:true,revision:-1}, {canSubmit:true,revision:0.5}, {canSubmit:true,revision:'0'}, {canSubmit:false,revision:Number.MAX_SAFE_INTEGER+1}, {canSubmit:true,revision:Number.MAX_SAFE_INTEGER}]){const f=fixture(()=>json(data));await login(f);await assert.rejects(()=>f.client.getTaskSubmissionAccess(TARGET),e=>e.code==='INVALID_RESPONSE');}
 const f=fixture(()=>json({canSubmit:false,revision:Number.MAX_SAFE_INTEGER}));await login(f);assert.deepEqual(await f.client.getTaskSubmissionAccess(TARGET),{canSubmit:false,revision:Number.MAX_SAFE_INTEGER});
});
test('safe transport errors neither reveal provider messages nor retry access queries',async()=>{
 for(const status of [403,404,409,500]){const f=fixture(()=>json({message:'PRIVATE_PATH_OR_SQL'},status));await login(f);await assert.rejects(()=>f.client.getTaskSubmissionAccess(TARGET),e=>e.code==='HTTP_'+status&&!e.message.includes('PRIVATE'));assert.equal(f.calls.filter(c=>c.url.endsWith('/submission-access')).length,1);assert.equal((await f.client.getSession()).account.id,'intern-a');}
});
test('a late old-account 401 cannot log out the newer identity generation',async()=>{
 let resolve,started;const ready=new Promise(r=>started=r),f=fixture(()=>{started();return new Promise(r=>resolve=r);});await login(f);const pending=f.client.getTaskSubmissionAccess(TARGET);await ready;await login(f);resolve(json({},401));await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED');assert.equal((await f.client.getSession()).account.id,'intern-a');
});
test('current-account 401 invalidates the main session and blocks further capability requests',async()=>{
 const f=fixture(()=>json({},401));await login(f);await assert.rejects(()=>f.client.getTaskSubmissionAccess(TARGET),e=>e.code==='SIGN_IN_REQUIRED');const before=f.calls.length;assert.equal(await f.client.getSession(),null);await assert.rejects(()=>f.client.getTaskSubmissionAccess(TARGET));assert.equal(f.calls.length,before);
});
test('new IPC validates complete target and trusted top frame before calling client',async()=>{
 const handlers=new Map(),mainFrame={url:APP_URL},webContents={mainFrame};let calls=0;
 const dispose=registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window:{webContents},dialog:{},client:{clearSession(){},getTaskSubmissionAccess:async()=>{calls++;return {canSubmit:false,revision:0};}}});
 const invoke=(event,arg)=>handlers.get('shenyi:task-submission-access')(event,arg),event={sender:webContents,senderFrame:mainFrame};
 for(const foreign of [{sender:{},senderFrame:mainFrame},{sender:webContents,senderFrame:{url:APP_URL}},{sender:webContents,senderFrame:{url:'https://evil.invalid'}}])assert.equal((await invoke(foreign,TARGET)).error.code,'UNTRUSTED_SENDER');
 for(const input of [{teamId:'team-a'}, {...TARGET,role:'partner'}, {...TARGET,taskId:'../x'}, {...TARGET,path:'D:/secret'}])assert.equal((await invoke(event,input)).ok,false);assert.equal(calls,0);assert.deepEqual(await invoke(event,TARGET),{ok:true,value:{canSubmit:false,revision:0}});assert.equal(calls,1);dispose();assert.equal(handlers.size,0);
});
