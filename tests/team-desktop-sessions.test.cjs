'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTeamClient,API_BASE}=require('../desktop/team-client.cjs');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const TOKEN=Buffer.alloc(32,13).toString('base64url'),PEER=Buffer.alloc(32,14).toString('base64url');
const ID='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const ACCOUNT={account:{id:'intern-a',displayName:'Synthetic intern'},memberships:[{teamId:'team-a',role:'intern'}],expiresAt:1900000000000};
const ROW={id:ID,isCurrent:true,createdAt:null,expiresAt:1900000000000};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function fixture(respond=()=>json({})){const calls=[];const client=createTeamClient({fetchImpl:async(url,options)=>{const call={url,options};calls.push(call);if(url.endsWith('/api/auth/login'))return json({token:TOKEN,...ACCOUNT});if(url.endsWith('/api/auth/session'))return json(ACCOUNT);return respond(call);}});return {client,calls};}
const login=f=>f.client.login({username:'intern-a',password:'ShenyiDemo!2026'});

test('sessions require a main-process account before contacting the service',async()=>{
  const f=fixture();for(const act of [()=>f.client.listAccountSessions(),()=>f.client.revokeAccountSession({sessionId:ID,currentPassword:'test password'}),()=>f.client.revokeOtherSessions({currentPassword:'test password'}),()=>f.client.revokeAllSessions({currentPassword:'test password'})])await assert.rejects(act,e=>e.status===401);assert.equal(f.calls.length,0);
});
test('session list has a strict privacy DTO and never returns bearer, digest or device guesses',async()=>{
  const f=fixture(()=>json({sessions:[{...ROW,token:TOKEN,token_hash:'f'.repeat(64),userId:'someone',device:'untrusted',ip:'SYNTHETIC'}],hasMore:false,total:400}));await login(f);
  assert.deepEqual(await f.client.listAccountSessions(),{sessions:[ROW],hasMore:false});assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer '+TOKEN);assert.equal(f.calls.at(-1).url,API_BASE+'/api/auth/sessions');
});
test('pagination permits only bounded limit and opaque management cursor',async()=>{
  const f=fixture(()=>json({sessions:[ROW],hasMore:false}));await login(f);await f.client.listAccountSessions({limit:2,after:OTHER});assert.equal(new URL(f.calls.at(-1).url).search,'?limit=2&after='+OTHER);
  const before=f.calls.length;for(const input of [{limit:0},{limit:51},{after:'../escape'},{after:TOKEN},{userId:'victim'},{role:'partner'}])await assert.rejects(()=>f.client.listAccountSessions(input));assert.equal(f.calls.length,before);
});
test('malformed, duplicate, over-limit and contradictory session responses are rejected',async()=>{
  for(const data of [{sessions:[{...ROW,createdAt:ROW.expiresAt+1}],hasMore:false},{sessions:[{...ROW,id:TOKEN}],hasMore:false},{sessions:[ROW,ROW],hasMore:false},{sessions:[ROW,{...ROW,id:OTHER}],hasMore:false},{sessions:[],hasMore:true},{sessions:[ROW],hasMore:'yes'}]){
    const f=fixture(()=>json(data));await login(f);await assert.rejects(()=>f.client.listAccountSessions(),e=>e.code==='INVALID_RESPONSE');
  }
  const f=fixture(()=>json({sessions:[ROW,{...ROW,id:OTHER,isCurrent:false}],hasMore:false}));await login(f);await assert.rejects(()=>f.client.listAccountSessions({limit:1}),e=>e.code==='INVALID_RESPONSE');
});
test('one-session revoke sends only current password and a validated management ID',async()=>{
  const f=fixture(()=>json({revoked:true,signedOut:false,token:PEER}));await login(f);assert.deepEqual(await f.client.revokeAccountSession({sessionId:OTHER,currentPassword:'current secret'}),{revoked:true,signedOut:false});
  const call=f.calls.at(-1);assert.equal(call.url,API_BASE+'/api/auth/sessions/'+OTHER+'/revoke');assert.deepEqual(JSON.parse(call.options.body),{currentPassword:'current secret'});assert.equal((await f.client.getSession()).account.id,'intern-a');
});
test('wrong password is retryable and does not clear an otherwise valid account',async()=>{
  const f=fixture(()=>json({error:{code:'PASSWORD_MISMATCH',message:'UPSTREAM_PRIVATE'}},403));await login(f);await assert.rejects(()=>f.client.revokeOtherSessions({currentPassword:'wrong'}),e=>e.code==='HTTP_403'&&!e.message.includes('UPSTREAM_PRIVATE'));assert.equal((await f.client.getSession()).account.id,'intern-a');
});
test('revoke-others preserves current account while revoke-all clears it synchronously',async()=>{
  const f=fixture(call=>call.url.endsWith('/revoke-all')?json({revokedCount:1,signedOut:true}):json({revokedCount:2,signedOut:false}));await login(f);
  assert.deepEqual(await f.client.revokeOtherSessions({currentPassword:'current secret'}),{revokedCount:2,signedOut:false});assert.equal((await f.client.getSession()).account.id,'intern-a');
  assert.deepEqual(await f.client.revokeAllSessions({currentPassword:'current secret'}),{revokedCount:1,signedOut:true});assert.equal(await f.client.getSession(),null);
});
test('self revoke clears main secrets and rejects subsequent authenticated access',async()=>{
  const f=fixture(()=>json({revoked:true,signedOut:true}));await login(f);await f.client.revokeAccountSession({sessionId:ID,currentPassword:'current secret'});assert.equal(await f.client.getSession(),null);await assert.rejects(()=>f.client.listAccountSessions(),e=>e.status===401);
});
test('invalid password payloads and role or token injection fail before network',async()=>{
  const f=fixture();await login(f);const before=f.calls.length;
  for(const input of [{sessionId:TOKEN,currentPassword:'secret'},{sessionId:ID,currentPassword:'secret',userId:'victim'},{sessionId:ID,currentPassword:'secret',token:PEER},{sessionId:ID,currentPassword:'x'.repeat(513)}])await assert.rejects(()=>f.client.revokeAccountSession(input));
  await assert.rejects(()=>f.client.revokeAllSessions({currentPassword:'secret',exceptCurrent:true}));assert.equal(f.calls.length,before);
});
test('a late successful self revoke cannot clear a new desktop account generation',async()=>{
  let deliver,entered;const started=new Promise(r=>{entered=r;});const f=fixture(()=>{entered();return new Promise(r=>{deliver=r;});});await login(f);
  const pending=f.client.revokeAccountSession({sessionId:ID,currentPassword:'current secret'});await started;await login(f);deliver(json({revoked:true,signedOut:true}));await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED');assert.equal((await f.client.getSession()).account.id,'intern-a');
});
test('bulk result must match its documented signout behavior',async()=>{
  for(const data of [{revokedCount:-1,signedOut:true},{revokedCount:0,signedOut:true},{revokedCount:2,signedOut:false}]){const f=fixture(()=>json(data));await login(f);await assert.rejects(()=>f.client.revokeAllSessions({currentPassword:'current secret'}),e=>e.code==='INVALID_RESPONSE');}
});
test('every new session IPC rejects foreign origins and unlisted argument keys',async()=>{
  const handlers=new Map(),mainFrame={url:APP_URL},webContents={mainFrame};const dispose=registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window:{webContents},client:{clearSession(){}},dialog:{}});
  for(const name of ['account-sessions','account-session-revoke','account-sessions-revoke-others','account-sessions-revoke-all'])for(const event of [{sender:{},senderFrame:mainFrame},{sender:webContents,senderFrame:{url:APP_URL}},{sender:webContents,senderFrame:{url:'https://untrusted.invalid'}}])assert.equal((await handlers.get('shenyi:'+name)(event,{})).error.code,'UNTRUSTED_SENDER');
  assert.equal((await handlers.get('shenyi:account-sessions')({sender:webContents,senderFrame:mainFrame},{userId:'victim'})).ok,false);dispose();assert.equal(handlers.size,0);
});
