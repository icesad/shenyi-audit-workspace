'use strict';
const {ledgerOldChannelNames}=require('./helpers/ledger-check-entry-layer.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),{createTeamClient,API_BASE}=require('../desktop/team-client.cjs'),{registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const TOKEN=Buffer.alloc(32,51).toString('base64url'),SESSION={account:{id:'manager-a',displayName:'合成经理'},memberships:[{teamId:'team-a',role:'manager'}],expiresAt:1900000000000},TARGET={teamId:'team-a',taskId:'task-a'},MEMBER={id:'assistant-a',displayName:'合成助理',role:'assistant'},STATE={canManage:true,revision:3,status:'submitted',assignees:[MEMBER],hasMoreAssignees:false};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function fixture(responder){const calls=[];const client=createTeamClient({fetchImpl:async(url,options)=>{calls.push({url,options});if(url.endsWith('/api/auth/login'))return json({token:TOKEN,...SESSION});if(url.endsWith('/api/auth/session'))return json(SESSION);return responder(url,options);}});return {client,calls};}
const login=f=>f.client.login({username:'manager-a',password:'ShenyiDemo!2026'});
test('management requires main-process session and cannot accept renderer authority or arbitrary paths',async()=>{
 const f=fixture(()=>json(STATE));await assert.rejects(()=>f.client.getTaskManagement(TARGET),e=>e.status===401);assert.equal(f.calls.length,0);await login(f);const before=f.calls.length;for(const patch of [{role:'partner'},{token:TOKEN},{server:'https://evil.invalid'},{taskId:'../other'}])await assert.rejects(()=>f.client.getTaskManagement({...TARGET,...patch}));assert.equal(f.calls.length,before);
});
test('unavailable management strips every personnel field and authorized state projects a minimal DTO',async()=>{
 const f=fixture(()=>json({canManage:false,assignees:[MEMBER],revision:3,phone:'13800138000'}));await login(f);assert.deepEqual(await f.client.getTaskManagement(TARGET),{canManage:false});const g=fixture(()=>json({...STATE,projectId:'hidden',token:TOKEN,assignees:[{...MEMBER,phone:'13800138000',password_hash:'hidden'}]}));await login(g);assert.deepEqual(await g.client.getTaskManagement(TARGET),STATE);assert.equal(g.calls.at(-1).options.headers.Authorization,'Bearer '+TOKEN);
});
test('malformed state or duplicate current assignments cannot be displayed as trustworthy management',async()=>{
 for(const patch of [{revision:-1},{status:'approved'},{assignees:[MEMBER,MEMBER]},{hasMoreAssignees:true},{assignees:[{...MEMBER,role:'admin'}]},{assignees:[{...MEMBER,displayName:'\ud800'}]}]){const f=fixture(()=>json({...STATE,...patch}));await login(f);await assert.rejects(()=>f.client.getTaskManagement(TARGET),e=>e.code==='INVALID_RESPONSE');}
});
test('candidate search is a bounded, scoped query and strips private identity data',async()=>{
 const f=fixture(()=>json({members:[{...MEMBER,phone:'13800138000'}],hasMore:false,totalAllEmployees:1000}));await login(f);assert.deepEqual(await f.client.listTaskAssignees({...TARGET,q:'%_合成',after:'intern-a',limit:20}),{members:[MEMBER],hasMore:false});const url=new URL(f.calls.at(-1).url);assert.equal(url.pathname,'/api/teams/team-a/collection/tasks/task-a/assignees');assert.equal(url.searchParams.get('q'),'%_合成');assert.equal(url.searchParams.get('after'),'intern-a');assert.equal(url.searchParams.get('limit'),'20');
});
test('invalid query/cursor/limits and injected scope never reach the transport',async()=>{
 const f=fixture(()=>json({}));await login(f);const before=f.calls.length;for(const patch of [{q:'x'.repeat(81)},{q:'a\nb'},{q:{}},{limit:0},{limit:51},{limit:1.5},{after:'../foreign'},{userId:'victim'},{projectId:'other'}])await assert.rejects(()=>f.client.listTaskAssignees({...TARGET,...patch}));assert.equal(f.calls.length,before);
});
test('candidate pages reject duplicates, oversize pages and dishonest continuation flags',async()=>{
 for(const data of [{members:[MEMBER,MEMBER],hasMore:false},{members:[],hasMore:true},{members:[MEMBER],hasMore:true},{members:Array.from({length:21},(_,i)=>({...MEMBER,id:'id-'+i})),hasMore:false}]){const f=fixture(()=>json(data));await login(f);await assert.rejects(()=>f.client.listTaskAssignees({...TARGET,limit:20}),e=>e.code==='INVALID_RESPONSE');}
});
test('assignment and return send exact current revision and require exactly one revision advance',async()=>{
 const f=fixture(()=>json({revision:4,private:'hidden'}));await login(f);assert.deepEqual(await f.client.assignTask({...TARGET,userId:'assistant-a',revision:3}),{revision:4});assert.equal(f.calls.at(-1).url,API_BASE+'/api/teams/team-a/collection/tasks/task-a/assignment');assert.deepEqual(JSON.parse(f.calls.at(-1).options.body),{userId:'assistant-a',revision:3});assert.deepEqual(await f.client.returnTask({...TARGET,revision:3}),{revision:4});assert.deepEqual(JSON.parse(f.calls.at(-1).options.body),{revision:3});
 for(const revision of [3,5,-1,'4']){const g=fixture(()=>json({revision}));await login(g);await assert.rejects(()=>g.client.returnTask({...TARGET,revision:3}),e=>e.code==='INVALID_RESPONSE');}
});
test('missing, malformed or unincrementable version never submits a management mutation',async()=>{
 const f=fixture(()=>json({}));await login(f);const before=f.calls.length;for(const revision of [undefined,null,-1,1.5,'3',Number.MAX_SAFE_INTEGER])for(const name of ['assignTask','returnTask'])await assert.rejects(()=>f.client[name]({...TARGET,...(name==='assignTask'?{userId:'assistant-a'}:{}),revision}),e=>e.code==='INVALID_INPUT');await assert.rejects(()=>f.client.assignTask({...TARGET,userId:'assistant-a',revision:3,role:'partner'}));assert.equal(f.calls.length,before);
});
test('stale revision remains a safe conflict without automatic retries or signing out the manager',async()=>{
 const f=fixture(()=>json({error:{message:'PRIVATE_SQL_OR_VERSION'}},409));await login(f);await assert.rejects(()=>f.client.returnTask({...TARGET,revision:3}),e=>e.code==='HTTP_409'&&!e.message.includes('PRIVATE'));assert.equal(f.calls.filter(call=>call.url.endsWith('/return')).length,1);assert.equal((await f.client.getSession()).account.id,'manager-a');
});
test('late task-management write cannot change or expose scope in a newer login',async()=>{
 let finish,entered;const started=new Promise(r=>entered=r),f=fixture(()=>{entered();return new Promise(r=>finish=r);});await login(f);const pending=f.client.assignTask({...TARGET,userId:'assistant-a',revision:3});await started;await login(f);finish(json({revision:4}));await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED');assert.equal((await f.client.getSession()).account.id,'manager-a');
});
test('uncertain return result sends once and never claims a completed task state',async()=>{
 const f=fixture(()=>{throw Error('PRIVATE_PATH');});await login(f);await assert.rejects(()=>f.client.returnTask({...TARGET,revision:3}),e=>e.code==='SERVICE_UNAVAILABLE'&&!e.message.includes('PRIVATE'));assert.equal(f.calls.filter(call=>call.url.endsWith('/return')).length,1);
});
test('four new IPC methods enforce main-frame origin and exact argument whitelist',async()=>{
 const handlers=new Map(),mainFrame={url:APP_URL},webContents={mainFrame};let calls=0;const dispose=registerDesktopBridge({ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)},window:{webContents},client:{clearSession(){},returnTask:async()=>{calls++;return {revision:4};}},dialog:{}});assert.equal(ledgerOldChannelNames(handlers).length,123);for(const name of ['task-management','task-assignees','task-assign','task-return'])for(const event of [{sender:{},senderFrame:mainFrame},{sender:webContents,senderFrame:{url:APP_URL}},{sender:webContents,senderFrame:{url:'https://evil.invalid'}}])assert.equal((await handlers.get('shenyi:'+name)(event,{})).error.code,'UNTRUSTED_SENDER');assert.equal((await handlers.get('shenyi:task-return')({sender:webContents,senderFrame:mainFrame},{...TARGET,revision:3,userId:'victim'})).ok,false);assert.equal(calls,0);dispose();assert.equal(handlers.size,0);
});
