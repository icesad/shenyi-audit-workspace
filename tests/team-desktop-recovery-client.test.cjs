'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTeamClient,API_BASE}=require('../desktop/team-client.cjs');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const TOKEN=Buffer.alloc(32,31).toString('base64url'),SESSION={account:{id:'intern-a',displayName:'Synthetic employee'},memberships:[{teamId:'team-a',role:'intern'}],expiresAt:1900000000000};
const CHALLENGE={challengeId:'challenge-reset',expiresAt:1900000300000},PROOF={challengeId:CHALLENGE.challengeId,code:'123456',newPassword:'RecoveredDemo!2026',recoveryProof:'synthetic-independent-proof'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function fixture(responder){const calls=[];const client=createTeamClient({fetchImpl:async(url,options)=>{calls.push({url,options});if(url.endsWith('/api/auth/login'))return json({token:TOKEN,...SESSION});if(url.endsWith('/api/auth/session'))return json(SESSION);return responder(url,options);}});return {client,calls};}
const login=f=>f.client.login({username:'intern-a',password:'ShenyiDemo!2026'});
test('password recovery challenge fixes reset purpose, strips private data and sends no bearer',async()=>{
  const f=fixture(()=>json({...CHALLENGE,code:'123456',userId:'intern-a',phone:'13800138000',accountExists:true}));assert.deepEqual(await f.client.requestPasswordRecovery({phone:' 13800138000 '}),CHALLENGE);assert.equal(f.calls[0].url,API_BASE+'/api/auth/phone/challenges');assert.deepEqual(JSON.parse(f.calls[0].options.body),{phone:'13800138000',purpose:'reset'});assert.equal(f.calls[0].options.headers.Authorization,undefined);
});
test('signed-in main-process account must sign out before either recovery operation',async()=>{
  const f=fixture(()=>json({}));await login(f);const before=f.calls.length;await assert.rejects(()=>f.client.requestPasswordRecovery({phone:'13800138000'}),e=>e.code==='SIGN_OUT_REQUIRED');await assert.rejects(()=>f.client.recoverPassword(PROOF),e=>e.code==='SIGN_OUT_REQUIRED');assert.equal(f.calls.length,before);assert.equal((await f.client.getSession()).account.id,SESSION.account.id);
});
test('recovery cannot select another purpose, identity, approval or server',async()=>{
  const f=fixture(()=>json({}));for(const patch of [{purpose:'bind'},{userId:'victim'},{approved:true},{token:TOKEN},{server:'https://evil.invalid'}])await assert.rejects(()=>f.client.requestPasswordRecovery({phone:'13800138000',...patch}));for(const patch of [{phone:'13900139000'},{userId:'victim'},{approved:true},{role:'partner'},{url:'https://evil.invalid'}])await assert.rejects(()=>f.client.recoverPassword({...PROOF,...patch}));assert.equal(f.calls.length,0);
});
test('recovery completion forwards exact secrets and does not adopt any returned identity',async()=>{
  const value={...PROOF,newPassword:'  CaseSensitiveNew!2026  ',recoveryProof:'  opaque approval proof  '},f=fixture(()=>json({signedOut:true,token:TOKEN,account:SESSION.account,memberships:SESSION.memberships}));assert.deepEqual(await f.client.recoverPassword(value),{signedOut:true});assert.deepEqual(JSON.parse(f.calls[0].options.body),value);assert.equal(f.calls[0].options.headers.Authorization,undefined);assert.equal(await f.client.getSession(),null);
});
test('malformed verification fields and oversized proof fail before dispatch',async()=>{
  const f=fixture(()=>json({}));for(const patch of [{challengeId:'../other'},{challengeId:null},{code:'12345x'},{code:123456},{recoveryProof:''},{recoveryProof:{}},{recoveryProof:'x'.repeat(1025)},{newPassword:'x'.repeat(11)},{newPassword:'😀'.repeat(129)}])await assert.rejects(()=>f.client.recoverPassword({...PROOF,...patch}),e=>e.code==='INVALID_INPUT');assert.equal(f.calls.length,0);
});
test('legal Unicode password maximum remains unmodified and is not truncated',async()=>{
  const f=fixture(()=>json({signedOut:true})),newPassword='😀'.repeat(128);assert.deepEqual(await f.client.recoverPassword({...PROOF,newPassword}),{signedOut:true});assert.equal(JSON.parse(f.calls[0].options.body).newPassword,newPassword);
});
test('missing provider and invalid extra approval expose only safe nonenumerating guidance',async()=>{
  const f=fixture(()=>json({error:{message:'PRIVATE_PHONE_MAPPING'}},503));await assert.rejects(()=>f.client.requestPasswordRecovery({phone:'13800138000'}),e=>e.status===503&&e.message.includes('尚未开通')&&!e.message.includes('PRIVATE'));
  const g=fixture(()=>json({error:{message:'USER_EXISTS_HASH'}},400));await assert.rejects(()=>g.client.recoverPassword(PROOF),e=>e.status===400&&e.message.includes('授权未通过')&&!e.message.includes('USER'));assert.equal(await g.client.getSession(),null);
});
test('late recovery success cannot clear a newer login or expose recovery credentials',async()=>{
  let finish,entered;const ready=new Promise(r=>entered=r),f=fixture(()=>{entered();return new Promise(r=>finish=r);});const pending=f.client.recoverPassword(PROOF);await ready;await login(f);finish(json({signedOut:true}));await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED');assert.equal((await f.client.getSession()).account.id,SESSION.account.id);
});
test('late recovery challenge cannot become proof for a newly signed-in account',async()=>{
  let finish,entered;const ready=new Promise(r=>entered=r),f=fixture(()=>{entered();return new Promise(r=>finish=r);});const pending=f.client.requestPasswordRecovery({phone:'13800138000'});await ready;await login(f);finish(json(CHALLENGE));await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED');assert.equal((await f.client.getSession()).account.id,SESSION.account.id);
});
test('malformed or uncertain completion neither claims success nor resends the write',async()=>{
  for(const value of [{signedOut:false},{token:TOKEN},{}]){const f=fixture(()=>json(value));await assert.rejects(()=>f.client.recoverPassword(PROOF),e=>e.code==='INVALID_RESPONSE');assert.equal(f.calls.length,1);}
  const f=fixture(()=>{throw Error('SECRET_PROVIDER_PATH');});await assert.rejects(()=>f.client.recoverPassword(PROOF),e=>e.code==='SERVICE_UNAVAILABLE'&&!e.message.includes('SECRET'));assert.equal(f.calls.length,1);
});
test('both new recovery IPC operations reject untrusted senders and extra identity options',async()=>{
  const handlers=new Map(),mainFrame={url:APP_URL},webContents={mainFrame};let calls=0;const dispose=registerDesktopBridge({ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)},window:{webContents},client:{clearSession(){},requestPasswordRecovery:async()=>{calls++;return CHALLENGE;},recoverPassword:async()=>{calls++;return {signedOut:true};}},dialog:{}});assert.equal(handlers.size,114);
  for(const name of ['recovery-challenge','recovery-complete'])for(const event of [{sender:{},senderFrame:mainFrame},{sender:webContents,senderFrame:{url:APP_URL}},{sender:webContents,senderFrame:{url:'https://evil.invalid'}}])assert.equal((await handlers.get('shenyi:'+name)(event,{})).error.code,'UNTRUSTED_SENDER');const event={sender:webContents,senderFrame:mainFrame};assert.equal((await handlers.get('shenyi:recovery-challenge')(event,{phone:'13800138000',purpose:'bind'})).ok,false);assert.equal((await handlers.get('shenyi:recovery-complete')(event,{...PROOF,userId:'victim'})).ok,false);assert.equal(calls,0);dispose();assert.equal(handlers.size,0);
});
