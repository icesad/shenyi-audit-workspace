'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTeamClient,API_BASE}=require('../desktop/team-client.cjs');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const TOKEN=Buffer.alloc(32,21).toString('base64url'),INVITE=Buffer.alloc(32,22).toString('base64url');
const SESSION={account:{id:'reviewer-demo',displayName:'Synthetic reviewer'},memberships:[],expiresAt:1900000000000};
const REQUEST={id:'request-a',teamId:'new-team-a',teamName:'合成团队',phoneMasked:'138****8000',status:'pending',revision:1,createdAt:1800000000000,expiresAt:null};
const PREVIEW={teamId:REQUEST.teamId,teamName:REQUEST.teamName,phoneMasked:REQUEST.phoneMasked,expiresAt:1800000300000};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function fixture(respond){const calls=[];const client=createTeamClient({fetchImpl:async(url,options)=>{calls.push({url,options});if(url.endsWith('/api/auth/login'))return json({token:TOKEN,...SESSION});if(url.endsWith('/api/auth/session'))return json(SESSION);return respond(url,options);}});return {client,calls};}
const login=f=>f.client.login({username:'reviewer-demo',password:'ShenyiDemo!2026'});

test('review and own-administration operations require an existing main-process session',async()=>{
  const f=fixture(()=>json({}));for(const action of [()=>f.client.getTeamProvisioningAccess(),()=>f.client.listTeamProvisioningRequests(),()=>f.client.createTeamProvisioningRequest({teamName:'合成团队',adminPhone:'13800138000'}),()=>f.client.reviewTeamProvisioningRequest({requestId:'r',decision:'approve',revision:1,currentPassword:'current'}),()=>f.client.getTeamAdministration()])await assert.rejects(action,e=>e.status===401);assert.equal(f.calls.length,0);
});
test('reviewer access is a boolean projection and list strips full phone, hashes and tokens',async()=>{
  const f=fixture(url=>url.endsWith('/access')?json({canReview:true,role:'partner',token:TOKEN}):json({requests:[{...REQUEST,adminPhone:'13800138000',token_hash:'secret',invitationCode:INVITE}]}));await login(f);
  assert.deepEqual(await f.client.getTeamProvisioningAccess(),{canReview:true});assert.deepEqual(await f.client.listTeamProvisioningRequests(),{requests:[REQUEST]});assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer '+TOKEN);
});
test('request creation sends only normalized team name and phone, never supplied privileges',async()=>{
  const f=fixture(()=>json({request:{...REQUEST,token:TOKEN}}));await login(f);assert.deepEqual(await f.client.createTeamProvisioningRequest({teamName:'  合成团队  ',adminPhone:' 13800138000 '}),{request:REQUEST});
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body),{teamName:'合成团队',adminPhone:'13800138000'});
  const before=f.calls.length;for(const extra of [{role:'partner'},{approved:true},{reviewerId:'another'},{server:'https://evil.invalid'}])await assert.rejects(()=>f.client.createTeamProvisioningRequest({teamName:'合成团队',adminPhone:'13800138000',...extra}));assert.equal(f.calls.length,before);
});
test('request creation rejects invalid team names before the network',async()=>{
  const f=fixture(()=>json({}));await login(f);const before=f.calls.length;for(const teamName of ['', '  ', 'x'.repeat(81),'a\nb','\ud800',{},null])await assert.rejects(()=>f.client.createTeamProvisioningRequest({teamName,adminPhone:'13800138000'}),e=>e.code==='INVALID_INPUT');assert.equal(f.calls.length,before);
});
test('review includes exact revision and unmodified password, approval code returned once only',async()=>{
  const approved={...REQUEST,status:'approved',revision:2,expiresAt:1800086400000};const f=fixture(()=>json({request:approved,invitationCode:INVITE,token:TOKEN,adminPhone:'13800138000'}));await login(f);
  assert.deepEqual(await f.client.reviewTeamProvisioningRequest({requestId:REQUEST.id,decision:'approve',revision:1,currentPassword:'  current password  '}),{request:approved,invitationCode:INVITE});assert.equal(f.calls.at(-1).url,API_BASE+'/api/operations/team-requests/request-a/review');assert.deepEqual(JSON.parse(f.calls.at(-1).options.body),{decision:'approve',revision:1,currentPassword:'  current password  '});
  for(const decision of ['reject','revoke']){const row={...REQUEST,status:decision==='reject'?'rejected':'revoked',revision:2},g=fixture(()=>json({request:row,invitationCode:INVITE}));await login(g);assert.deepEqual(await g.client.reviewTeamProvisioningRequest({requestId:REQUEST.id,decision,revision:1,currentPassword:'current'}),{request:row});}
});
test('review prevents path, identity, stale revision and action injection before dispatch',async()=>{
  const f=fixture(()=>json({}));await login(f);const before=f.calls.length;for(const patch of [{requestId:'../victim'},{decision:'activate'},{revision:0},{revision:-1},{revision:1.5},{revision:'1'},{currentPassword:'x'.repeat(513)},{userId:'victim'},{token:TOKEN}])await assert.rejects(()=>f.client.reviewTeamProvisioningRequest({requestId:REQUEST.id,decision:'approve',revision:1,currentPassword:'current',...patch}));assert.equal(f.calls.length,before);
});
test('malformed or mismatched review completion cannot invent approval',async()=>{
  for(const patch of [{id:'wrong'},{revision:1},{status:'activated'},{expiresAt:'tomorrow'}]){const f=fixture(()=>json({request:{...REQUEST,status:'approved',revision:2,expiresAt:1800086400000,...patch},invitationCode:INVITE}));await login(f);await assert.rejects(()=>f.client.reviewTeamProvisioningRequest({requestId:REQUEST.id,decision:'approve',revision:1,currentPassword:'current'}),e=>e.code==='INVALID_RESPONSE');}
});
test('list and own-team DTOs reject duplicates, oversized lists and unmasked numbers',async()=>{
  for(const requests of [[REQUEST,REQUEST],Array.from({length:51},(_,i)=>({...REQUEST,id:'r'+i})),[{...REQUEST,phoneMasked:'13800138000'}],[{...REQUEST,status:'invented'}],[{...REQUEST,teamName:'\ud800'}]]){const f=fixture(()=>json({requests}));await login(f);await assert.rejects(()=>f.client.listTeamProvisioningRequests(),e=>e.code==='INVALID_RESPONSE');}
  const own={teamId:'team-own',teamName:'本人管理团队'},f=fixture(()=>json({teams:[{...own,role:'partner',fullProjects:['secret'],phone:'13800138000'}]}));await login(f);assert.deepEqual(await f.client.getTeamAdministration(),{teams:[own]});
  const g=fixture(()=>json({teams:[own,own]}));await login(g);await assert.rejects(()=>g.client.getTeamAdministration(),e=>e.code==='INVALID_RESPONSE');
});
test('first-admin preview and SMS challenge strip secrets and never send a bearer',async()=>{
  const f=fixture(url=>url.endsWith('/preview')?json({...PREVIEW,invitationCode:INVITE,phone:'13800138000',token:TOKEN}):json({challengeId:'challenge-a',expiresAt:1800000300000,code:'123456',providerSecret:'hidden'}));
  assert.deepEqual(await f.client.previewFirstAdministrator({invitationCode:INVITE,phone:'13800138000'}),PREVIEW);assert.deepEqual(await f.client.requestFirstAdministratorActivation({invitationCode:INVITE,phone:'13800138000'}),{challengeId:'challenge-a',expiresAt:1800000300000});for(const call of f.calls){assert.equal(call.options.headers.Authorization,undefined);assert.deepEqual(JSON.parse(call.options.body),{invitationCode:INVITE,phone:'13800138000'});}
});
test('first-admin activation requires explicit acceptance and never adopts an upstream token',async()=>{
  const proof={invitationCode:INVITE,phone:'13800138000',challengeId:'challenge-a',code:'123456',password:'  Synthetic Secret!2026  ',displayName:' 合成管理员 ',accept:true};const f=fixture(()=>json({activated:true,token:TOKEN,memberships:[{teamId:'foreign',role:'partner'}]}));
  assert.deepEqual(await f.client.activateFirstAdministrator(proof),{activated:true});assert.equal(await f.client.getSession(),null);assert.deepEqual(JSON.parse(f.calls[0].options.body),{...proof,displayName:'合成管理员'});
  const before=f.calls.length;for(const patch of [{accept:false},{code:'12345x'},{challengeId:'../x'},{displayName:'\ud800'},{role:'partner'},{teamId:'victim'}])await assert.rejects(()=>f.client.activateFirstAdministrator({...proof,...patch}));assert.equal(f.calls.length,before);
});
test('signed-in accounts must sign out before using a first-admin invitation',async()=>{
  const f=fixture(()=>json({}));await login(f);const before=f.calls.length;for(const fn of ['previewFirstAdministrator','requestFirstAdministratorActivation','activateFirstAdministrator'])await assert.rejects(()=>f.client[fn]({invitationCode:INVITE,phone:'13800138000'}),e=>e.code==='SIGN_OUT_REQUIRED');assert.equal(f.calls.length,before);
});
test('late approval cannot expose its code to a newly logged-in account',async()=>{
  let deliver,entered;const started=new Promise(r=>entered=r),f=fixture(()=>{entered();return new Promise(r=>deliver=r);});await login(f);const pending=f.client.reviewTeamProvisioningRequest({requestId:REQUEST.id,decision:'approve',revision:1,currentPassword:'current'});await started;await login(f);deliver(json({request:{...REQUEST,status:'approved',revision:2,expiresAt:1800086400000},invitationCode:INVITE}));await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED');assert.equal((await f.client.getSession()).account.id,SESSION.account.id);
});
test('provider failure and wrong password reveal no upstream details or fake completion',async()=>{
  const f=fixture(()=>json({error:{message:'PRIVATE_PROVIDER_ROUTE'}},503));await assert.rejects(()=>f.client.requestFirstAdministratorActivation({invitationCode:INVITE,phone:'13800138000'}),e=>e.code==='HTTP_503'&&e.message.includes('尚未开通')&&!e.message.includes('PRIVATE'));
  const g=fixture(()=>json({error:{message:'HASH_SECRET'}},403));await login(g);await assert.rejects(()=>g.client.reviewTeamProvisioningRequest({requestId:REQUEST.id,decision:'approve',revision:1,currentPassword:'wrong'}),e=>e.code==='HTTP_403'&&!e.message.includes('HASH'));assert.equal((await g.client.getSession()).account.id,SESSION.account.id);
});
test('all eight new IPC methods enforce trusted main-frame origin and exact arguments',async()=>{
  const handlers=new Map(),mainFrame={url:APP_URL},webContents={mainFrame};let calls=0;const client={clearSession(){},getTeamProvisioningAccess:async()=>{calls++;return {canReview:true};},createTeamProvisioningRequest:async()=>{calls++;return {};}};
  const dispose=registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window:{webContents},client,dialog:{}});assert.equal(handlers.size,81);
  for(const name of ['team-review-access','team-review-list','team-review-create','team-review-decide','team-administration','first-admin-preview','first-admin-challenge','first-admin-complete'])for(const event of [{sender:{},senderFrame:mainFrame},{sender:webContents,senderFrame:{url:APP_URL}},{sender:webContents,senderFrame:{url:'https://evil.invalid'}}])assert.equal((await handlers.get('shenyi:'+name)(event,{})).error.code,'UNTRUSTED_SENDER');
  const event={sender:webContents,senderFrame:mainFrame};assert.equal((await handlers.get('shenyi:team-review-access')(event,{userId:'victim'})).ok,false);assert.equal((await handlers.get('shenyi:team-review-create')(event,{teamName:'合成团队',adminPhone:'13800138000',role:'partner'})).ok,false);assert.equal(calls,0);assert.deepEqual(await handlers.get('shenyi:team-review-access')(event),{ok:true,value:{canReview:true}});assert.equal(calls,1);dispose();assert.equal(handlers.size,0);
});
