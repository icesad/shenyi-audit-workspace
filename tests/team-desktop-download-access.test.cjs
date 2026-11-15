'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTeamClient,API_BASE}=require('../desktop/team-client.cjs');
const TARGET={teamId:'team-a',taskId:'task-a',attachmentId:'attachment-a'},TOKEN=Buffer.alloc(32,54).toString('base64url');
const SESSION={account:{id:'intern-a',displayName:'合成实习生'},memberships:[{teamId:'team-a',role:'intern'}],expiresAt:1900000000000};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function fixture(responder){const calls=[],client=createTeamClient({fetchImpl:async(url,options)=>{calls.push({url,options});if(url.endsWith('/api/auth/login'))return json({token:TOKEN,...SESSION});if(url.endsWith('/api/auth/session'))return json(SESSION);return responder(url,options);}});return {client,calls};}
const login=f=>f.client.login({username:'intern-a',password:'ShenyiDemo!2026'});
test('HEAD authority check requires a main session and complete exact attachment scope',async()=>{
 const f=fixture(()=>new Response(null));await assert.rejects(()=>f.client.checkAttachmentAccess(TARGET),e=>e.code==='SIGN_IN_REQUIRED');assert.equal(f.calls.length,0);await login(f);const before=f.calls.length;
 for(const value of [undefined,{}, {teamId:'team-a',taskId:'task-a'}, {...TARGET,taskId:undefined}, {...TARGET,attachmentId:'../other'}, {...TARGET,role:'partner'}, {...TARGET,path:'D:/private'}, {...TARGET,url:'https://evil.invalid'}, {...TARGET,token:TOKEN}])await assert.rejects(()=>f.client.checkAttachmentAccess(value));assert.equal(f.calls.length,before);
});
test('internal HEAD check sends fixed authenticated path and exposes only a positive capability',async()=>{
 const f=fixture(()=>new Response(null,{headers:{'Content-Length':'12345','Content-Disposition':"attachment; filename*=UTF-8''private.txt",'X-Internal-Project':'hidden'}}));await login(f);assert.deepEqual(await f.client.checkAttachmentAccess(TARGET),{canDownload:true});const {url,options}=f.calls.at(-1);assert.equal(url,API_BASE+'/api/teams/team-a/collection/tasks/task-a/attachments/attachment-a');assert.equal(options.method,'HEAD');assert.equal(options.body,undefined);assert.equal(options.headers.Authorization,'Bearer '+TOKEN);assert.equal(options.redirect,'error');
});
test('a successful HEAD carrying any unexpected bytes is not accepted as permission',async()=>{
 for(const bytes of [Buffer.from('PRIVATE_PATH'),Buffer.from([0])]){const f=fixture(()=>new Response(bytes));await login(f);await assert.rejects(()=>f.client.checkAttachmentAccess(TARGET),e=>e.code==='INVALID_RESPONSE'&&!e.message.includes('PRIVATE'));}
});
test('denied or unavailable HEAD fails without retries, raw errors or unrelated logout',async()=>{
 for(const status of [403,404,409,500,503]){const f=fixture(()=>json({private:'PRIVATE_SQL_AND_PATH'},status));await login(f);await assert.rejects(()=>f.client.checkAttachmentAccess(TARGET),e=>e.code==='HTTP_'+status&&!e.message.includes('PRIVATE'));assert.equal(f.calls.filter(c=>c.options.method==='HEAD').length,1);assert.equal((await f.client.getSession()).account.id,'intern-a');}
 const f=fixture(()=>{throw Error('PRIVATE_NETWORK_URL');});await login(f);await assert.rejects(()=>f.client.checkAttachmentAccess(TARGET),e=>e.code==='SERVICE_UNAVAILABLE'&&!e.message.includes('PRIVATE'));assert.equal(f.calls.filter(c=>c.options.method==='HEAD').length,1);
});
test('current 401 clears main authority, including an abnormal provider error body',async()=>{
 const f=fixture(()=>json({private:'PRIVATE'},401));await login(f);await assert.rejects(()=>f.client.checkAttachmentAccess(TARGET),e=>e.code==='SIGN_IN_REQUIRED'&&!e.message.includes('PRIVATE'));assert.equal(await f.client.getSession(),null);const before=f.calls.length;await assert.rejects(()=>f.client.checkAttachmentAccess(TARGET));assert.equal(f.calls.length,before);
});
test('late HEAD 200 or 401 cannot be adopted by a new login generation',async()=>{
 for(const status of [200,401]){let resolve,entered;const started=new Promise(r=>entered=r),f=fixture(()=>{entered();return new Promise(r=>resolve=r);});await login(f);const pending=f.client.checkAttachmentAccess(TARGET);await started;await login(f);resolve(new Response(null,{status}));await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED');assert.equal((await f.client.getSession()).account.id,'intern-a');}
});
