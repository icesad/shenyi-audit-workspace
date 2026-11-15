'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTeamClient,API_BASE}=require('../desktop/team-client.cjs');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const CODE=Buffer.alloc(32,17).toString('base64url'),TOKEN=Buffer.alloc(32,21).toString('base64url'),PHONE='13800138000';
const SESSION={account:{id:'manager-a',displayName:'Synthetic manager'},memberships:[{teamId:'team-a',role:'manager'}],expiresAt:Date.now()+3600000};
const INVITE={teamId:'team-a',role:'intern',phoneMasked:'+8613****8000',expiresAt:Date.now()+86400000};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function fixture(respond=()=>json({})){const calls=[];const client=createTeamClient({fetchImpl:async(url,options)=>{calls.push({url,options});return respond(url,options);}});return {client,calls};}
const login=f=>f.client.login({username:'manager-a',password:'ShenyiDemo!2026'});
const signed=(route,response)=>fixture((url,options)=>url.endsWith('/api/auth/login')?json({token:TOKEN,...SESSION}):url.endsWith('/api/auth/logout')?json({signedOut:true}):response(url,options));

test('onboarding capability exposes only availability and invitation-only policy',async()=>{
  const f=fixture(()=>json({available:false,invitationOnly:true,providerSecret:'NEVER_EXPOSE'}));
  assert.deepEqual(await f.client.getOnboardingStatus(),{available:false,invitationOnly:true});assert.equal(f.calls[0].url,API_BASE+'/api/auth/onboarding/capabilities');assert.equal(f.calls[0].options.headers.Authorization,undefined);
});
test('employee management requires main session before any request',async()=>{
  const f=fixture();for(const action of [()=>f.client.getInvitationAccess({teamId:'team-a'}),()=>f.client.createEmployeeInvitation({teamId:'team-a',phone:PHONE,role:'intern'}),()=>f.client.listEmployeeInvitations({teamId:'team-a'}),()=>f.client.revokeEmployeeInvitation({teamId:'team-a',invitationId:'i-a'})])await assert.rejects(action,e=>e.status===401);assert.equal(f.calls.length,0);
});
test('management DTOs preserve masked list, reject extra response fields, and expose code only at creation',async()=>{
  const f=signed('',(url)=>url.endsWith('/access')?json({canInvite:true,role:'partner'}):json({invitations:[{...INVITE,invitationId:'i-a',status:'pending',phone:PHONE,invitationCode:CODE}]}));await login(f);
  assert.deepEqual(await f.client.getInvitationAccess({teamId:'team-a'}),{canInvite:true});
  assert.deepEqual(await f.client.listEmployeeInvitations({teamId:'team-a'}),{invitations:[{...INVITE,invitationId:'i-a',status:'pending'}]});
  assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer '+TOKEN);
  const created=signed('',()=>json({...INVITE,invitationId:'i-a',invitationCode:CODE,phone:PHONE,token:TOKEN}));await login(created);
  const value=await created.client.createEmployeeInvitation({teamId:'team-a',phone:PHONE,role:'intern'});assert.deepEqual(value,{...INVITE,invitationId:'i-a',invitationCode:CODE});
});
test('forged employee roles, paths and extra identity fields fail before network',async()=>{
  const f=signed('',()=>json({}));await login(f);const before=f.calls.length;
  for(const input of [{teamId:'team-a',phone:PHONE,role:'partner'},{teamId:'../team-b',phone:PHONE,role:'intern'},{teamId:'team-a',phone:PHONE,role:'intern',userId:'victim'}])await assert.rejects(()=>f.client.createEmployeeInvitation(input));
  await assert.rejects(()=>f.client.revokeEmployeeInvitation({teamId:'team-a',invitationId:'i-a',permission:'all'}));assert.equal(f.calls.length,before);
});
test('invalid invitations and activation without explicit consent never reach network',async()=>{
  const f=fixture();await assert.rejects(()=>f.client.previewEmployeeInvitation({invitationCode:'bad',phone:PHONE}));
  for(const patch of [{accept:false},{code:'not-six'},{role:'partner'},{displayName:'invalid\nname'}])await assert.rejects(()=>f.client.activateEmployee({invitationCode:CODE,phone:PHONE,challengeId:'challenge-a',code:'123456',password:'EmployeePass!2026',displayName:'Synthetic employee',accept:true,...patch}));
  assert.equal(f.calls.length,0);
});
test('activation projects success without adopting an injected bearer or auto-joining the desktop session',async()=>{
  const f=fixture(()=>json({activated:true,token:TOKEN,...SESSION}));
  const value=await f.client.activateEmployee({invitationCode:CODE,phone:PHONE,challengeId:'challenge-a',code:'123456',password:'EmployeePass!2026',displayName:'Synthetic employee',accept:true});
  assert.deepEqual(value,{activated:true});assert.equal(await f.client.getSession(),null);assert.equal(f.calls[0].options.headers.Authorization,undefined);
});
test('existing-account activation can leave the new-account display name blank',async()=>{
  const f=fixture(()=>json({activated:true}));await f.client.activateEmployee({invitationCode:CODE,phone:PHONE,challengeId:'challenge-a',code:'123456',password:'ExistingPass!2026',accept:true});assert.equal(JSON.parse(f.calls[0].options.body).displayName,'');
});
test('signed-in account cannot activate another employee through its login view',async()=>{
  const f=signed('',()=>json({}));await login(f);const before=f.calls.length;await assert.rejects(()=>f.client.previewEmployeeInvitation({invitationCode:CODE,phone:PHONE}),e=>e.code==='SIGN_OUT_REQUIRED');assert.equal(f.calls.length,before);
});
test('late management response after logout cannot reveal old account invitation secrets',async()=>{
  let deliver,started;const entered=new Promise(r=>{started=r;});const f=signed('',()=>{started();return new Promise(r=>{deliver=r;});});await login(f);
  const pending=f.client.createEmployeeInvitation({teamId:'team-a',phone:PHONE,role:'intern'});await entered;await f.client.logout();deliver(json({...INVITE,invitationId:'i-a',invitationCode:CODE}));await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED');assert.equal(await f.client.getSession(),null);
});
test('management refuses raw phones, cross-team DTOs and unbounded lists',async()=>{
  for(const invitations of [[{...INVITE,invitationId:'i-a',status:'pending',phoneMasked:PHONE}],[{...INVITE,teamId:'team-b',invitationId:'i-a',status:'pending'}],Array.from({length:51},()=>({...INVITE,invitationId:'i-a',status:'pending'}))]){
    const f=signed('',()=>json({invitations}));await login(f);await assert.rejects(()=>f.client.listEmployeeInvitations({teamId:'team-a'}),e=>e.code==='INVALID_RESPONSE');
  }
});
test('onboarding bridge channels reject foreign windows, frames and extra fields',async()=>{
  const handlers=new Map(),mainFrame={url:APP_URL},webContents={mainFrame};const client={clearSession(){}};
  const dispose=registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window:{webContents},client,dialog:{}});
  for(const name of ['onboarding-status','invitation-access','invitation-create','invitation-list','invitation-revoke','activation-preview','activation-challenge','activation-complete'])for(const event of [{sender:{},senderFrame:mainFrame},{sender:webContents,senderFrame:{url:APP_URL}},{sender:webContents,senderFrame:{url:'https://untrusted.invalid'}}])assert.equal((await handlers.get('shenyi:'+name)(event,{})).error.code,'UNTRUSTED_SENDER');
  assert.equal((await handlers.get('shenyi:activation-complete')({sender:webContents,senderFrame:mainFrame},{admin:true})).ok,false);dispose();assert.equal(handlers.size,0);
});
