'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTeamClient,API_BASE}=require('../desktop/team-client.cjs');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const TOKEN=Buffer.alloc(32,11).toString('base64url'),OTHER_TOKEN=Buffer.alloc(32,12).toString('base64url');
const ACCOUNT={account:{id:'intern-a',displayName:'Synthetic intern'},memberships:[{teamId:'team-a',role:'intern'}],expiresAt:1900000000000};
const OTHER={...ACCOUNT,account:{id:'assistant-a',displayName:'Synthetic assistant'},memberships:[{teamId:'team-a',role:'assistant'}]};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function fixture(change){const calls=[];let current=ACCOUNT;const client=createTeamClient({fetchImpl:async(url,options)=>{calls.push({url,options});if(url.endsWith('/api/auth/login')){current=JSON.parse(options.body).username==='assistant-a'?OTHER:ACCOUNT;return json({token:current===OTHER?OTHER_TOKEN:TOKEN,...current});}if(url.endsWith('/api/auth/session'))return json(current);return change(url,options);}});return {client,calls};}
const login=(f,username='intern-a')=>f.client.login({username,password:'ShenyiDemo!2026'});

test('personal password change requires a main-process account and cannot impersonate another user',async()=>{
  const f=fixture(()=>json({signedOut:true}));await assert.rejects(()=>f.client.changeOwnPassword({currentPassword:'current password',newPassword:'NewPassword!2026'}),e=>e.status===401);assert.equal(f.calls.length,0);
  await login(f);const before=f.calls.length;for(const patch of [{userId:'victim'},{role:'partner'},{token:OTHER_TOKEN},{server:'https://evil.invalid'}])await assert.rejects(()=>f.client.changeOwnPassword({currentPassword:'current password',newPassword:'NewPassword!2026',...patch}));assert.equal(f.calls.length,before);
});
test('confirmed change sends only the two exact secrets and clears local session without adopting returned credentials',async()=>{
  const f=fixture(()=>json({signedOut:true,token:OTHER_TOKEN,password:'SHOULD_NOT_RETURN'}));await login(f);assert.deepEqual(await f.client.changeOwnPassword({currentPassword:'current password',newPassword:'NewPassword!2026'}),{signedOut:true});
  const call=f.calls.at(-1);assert.equal(call.url,API_BASE+'/api/auth/password');assert.equal(call.options.method,'POST');assert.equal(call.options.headers.Authorization,'Bearer '+TOKEN);assert.deepEqual(JSON.parse(call.options.body),{currentPassword:'current password',newPassword:'NewPassword!2026'});assert.equal(await f.client.getSession(),null);
});
test('Unicode length boundaries and whitespace are preserved instead of normalized or silently trimmed',async()=>{
  for(const password of ['🙂'.repeat(12),'🙂'.repeat(128),'  New Password!2026  ']){const f=fixture(()=>json({signedOut:true}));await login(f);await f.client.changeOwnPassword({currentPassword:'  current password  ',newPassword:password});assert.deepEqual(JSON.parse(f.calls.at(-1).options.body),{currentPassword:'  current password  ',newPassword:password});}
  const f=fixture(()=>json({signedOut:true}));await login(f);const before=f.calls.length;for(const password of ['a'.repeat(11),'🙂'.repeat(129),null,{},'a'.repeat(129)])await assert.rejects(()=>f.client.changeOwnPassword({currentPassword:'current password',newPassword:password}),e=>e.code==='INVALID_INPUT');assert.equal(f.calls.length,before);
});
test('wrong current password remains retryable and never forwards raw upstream errors',async()=>{
  const f=fixture(()=>json({error:{code:'VERIFICATION_FAILED',message:'PRIVATE_HASH_OR_PATH'}},403));await login(f);await assert.rejects(()=>f.client.changeOwnPassword({currentPassword:'wrong',newPassword:'NewPassword!2026'}),e=>e.code==='HTTP_403'&&e.message.includes('验证未通过')&&!e.message.includes('PRIVATE'));assert.equal((await f.client.getSession()).account.id,'intern-a');
});
test('invalid current password types or oversized bytes fail before network',async()=>{
  const f=fixture(()=>json({signedOut:true}));await login(f);const before=f.calls.length;for(const currentPassword of ['',{},'x'.repeat(513),'界'.repeat(171)])await assert.rejects(()=>f.client.changeOwnPassword({currentPassword,newPassword:'NewPassword!2026'}),e=>e.code==='INVALID_INPUT');assert.equal(f.calls.length,before);
});
test('late confirmed password change cannot sign out a newer different account',async()=>{
  let deliver,entered;const started=new Promise(r=>{entered=r;});const f=fixture(()=>{entered();return new Promise(r=>{deliver=r;});});await login(f);const pending=f.client.changeOwnPassword({currentPassword:'current password',newPassword:'NewPassword!2026'});await started;await login(f,'assistant-a');deliver(json({signedOut:true}));await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED');assert.equal((await f.client.getSession()).account.id,'assistant-a');
});
test('transport uncertainty sends once, exposes no private exception and does not invent success',async()=>{
  const f=fixture(()=>{throw Error('SECRET_PROVIDER_PATH');});await login(f);await assert.rejects(()=>f.client.changeOwnPassword({currentPassword:'current password',newPassword:'NewPassword!2026'}),e=>e.code==='SERVICE_UNAVAILABLE'&&!e.message.includes('SECRET'));assert.equal(f.calls.filter(c=>c.url.endsWith('/api/auth/password')).length,1);assert.equal((await f.client.getSession()).account.id,'intern-a');
});
test('malformed completion cannot claim a password was changed or expose a new bearer',async()=>{
  for(const value of [{signedOut:false},{token:OTHER_TOKEN},{}]){const f=fixture(()=>json(value));await login(f);await assert.rejects(()=>f.client.changeOwnPassword({currentPassword:'current password',newPassword:'NewPassword!2026'}),e=>e.code==='INVALID_RESPONSE');assert.equal((await f.client.getSession()).account.id,'intern-a');}
});
test('password IPC is origin checked and does not admit identity or arbitrary route arguments',async()=>{
  const handlers=new Map(),mainFrame={url:APP_URL},webContents={mainFrame};let invoked=0;const dispose=registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window:{webContents},client:{clearSession(){},changeOwnPassword:async()=>{invoked++;return {signedOut:true};}},dialog:{}});
  const action=handlers.get('shenyi:password-change');for(const event of [{sender:{},senderFrame:mainFrame},{sender:webContents,senderFrame:{url:APP_URL}},{sender:webContents,senderFrame:{url:'https://untrusted.invalid'}}])assert.equal((await action(event,{})).error.code,'UNTRUSTED_SENDER');assert.equal(invoked,0);
  const event={sender:webContents,senderFrame:mainFrame};assert.equal((await action(event,{currentPassword:'current',newPassword:'NewPassword!2026',userId:'victim'})).ok,false);assert.equal(invoked,0);dispose();assert.equal(handlers.size,0);
});
