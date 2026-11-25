'use strict';
const {ledgerOldChannelNames}=require('./helpers/ledger-check-entry-layer.cjs');
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
test('provisioning pagination keeps bare first-page requests and forwards only the last-row cursor',async()=>{
  const older={...REQUEST,id:'request-older'};
  const route=API_BASE+'/api/operations/team-requests';
  const f=fixture(url=>url===route
    ?json({requests:[{...REQUEST,adminPhone:'13800138000'}],nextCursor:REQUEST.id,token:TOKEN})
    :json({requests:[older],nextCursor:null}));
  await login(f);
  assert.deepEqual(await f.client.listTeamProvisioningRequests(),{requests:[REQUEST],nextCursor:REQUEST.id});
  assert.equal(f.calls.at(-1).url,route);
  assert.deepEqual(await f.client.listTeamProvisioningRequests({after:REQUEST.id}),{requests:[older],nextCursor:null});
  assert.equal(f.calls.at(-1).url,route+'?after='+REQUEST.id);
  assert.equal(f.calls.at(-1).options.method,'GET');
  assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer '+TOKEN);
  assert.equal(f.calls.at(-1).options.body,undefined);
});
test('provisioning pagination rejects invalid boundaries and unexpected input before dispatch',async()=>{
  const older={...REQUEST,id:'request-older'};
  const f=fixture(()=>json({}));await login(f);const before=f.calls.length;
  for(const input of [{},null,[],{after:undefined},{after:'not an id'},{after:'a'.repeat(129)},{after:REQUEST.id,teamId:'team-a'}]){
    await assert.rejects(()=>f.client.listTeamProvisioningRequests(input),{code:'INVALID_INPUT'});
  }
  assert.equal(f.calls.length,before);
  for(const data of [
    {requests:[older]},
    {requests:[older],nextCursor:1},
    {requests:[older],nextCursor:'wrong-cursor'},
    {requests:[older,REQUEST],nextCursor:REQUEST.id},
    {requests:[REQUEST,older],nextCursor:older.id},
    {requests:[],nextCursor:older.id},
    {requests:[older,older],nextCursor:older.id}
  ]){
    const malformed=fixture(()=>json(data));await login(malformed);
    await assert.rejects(()=>malformed.client.listTeamProvisioningRequests({after:REQUEST.id}),{code:'INVALID_RESPONSE'});
  }
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
  const dispose=registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window:{webContents},client,dialog:{}});assert.equal(ledgerOldChannelNames(handlers).length,123);
  for(const name of ['team-review-access','team-review-list','team-review-create','team-review-decide','team-administration','first-admin-preview','first-admin-challenge','first-admin-complete'])for(const event of [{sender:{},senderFrame:mainFrame},{sender:webContents,senderFrame:{url:APP_URL}},{sender:webContents,senderFrame:{url:'https://evil.invalid'}}])assert.equal((await handlers.get('shenyi:'+name)(event,{})).error.code,'UNTRUSTED_SENDER');
  const event={sender:webContents,senderFrame:mainFrame};assert.equal((await handlers.get('shenyi:team-review-access')(event,{userId:'victim'})).ok,false);assert.equal((await handlers.get('shenyi:team-review-create')(event,{teamName:'合成团队',adminPhone:'13800138000',role:'partner'})).ok,false);assert.equal(calls,0);assert.deepEqual(await handlers.get('shenyi:team-review-access')(event),{ok:true,value:{canReview:true}});assert.equal(calls,1);dispose();assert.equal(handlers.size,0);
});

test('the provisioning list IPC forwards the optional cursor and blocks other argument shapes',async()=>{
  const handlers=new Map(),mainFrame={url:APP_URL},webContents={mainFrame},calls=[];
  const client={clearSession(){},async listTeamProvisioningRequests(...args){calls.push(args);return {requests:[]};}};
  const dispose=registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window:{webContents},client,dialog:{}});
  try{
    const list=handlers.get('shenyi:team-review-list'),event={sender:webContents,senderFrame:mainFrame};
    assert.equal((await list(event)).ok,true);
    assert.equal((await list(event,{after:REQUEST.id})).ok,true);
    for(const input of [{},null,{after:null},{after:REQUEST.id,teamId:'other-team'}])assert.equal((await list(event,input)).ok,false);
    assert.deepEqual(calls,[[],[{after:REQUEST.id}]]);
  }finally{dispose();}
});


test('pilot projection distinguishes legacy, eligible and approved activated requests without exposing extra facts',async()=>{
  const activated={...REQUEST,status:'activated',revision:3},pilot={startsAt:1800000001000,endsAt:1800600000000,seats:4};
  for(const row of [activated,{...activated,pilot:null},{...activated,pilot}]){const f=fixture(()=>json({requests:[{...row,password_hash:'private',adminPhone:'13800138000'}]}));await login(f);assert.deepEqual(await f.client.listTeamProvisioningRequests(),{requests:[row]});}
});
test('pilot projection rejects malformed or cross-state additions rather than broadening the DTO',async()=>{
  const valid={startsAt:1800000001000,endsAt:1800600000000,seats:4};
  for(const patch of [{status:'pending',pilot:null},{status:'approved',pilot:valid},...[
    false,[],{}, {...valid,startsAt:-1},{...valid,endsAt:valid.startsAt},{...valid,endsAt:Number.MAX_SAFE_INTEGER+1},{...valid,seats:0},{...valid,seats:1.5},{...valid,seats:'4'},{...valid,seats:Number.MAX_SAFE_INTEGER+1},{...valid,token:'private'},
  ].map(pilot=>({status:'activated',pilot}))]){const f=fixture(()=>json({requests:[{...REQUEST,...patch}]}));await login(f);await assert.rejects(()=>f.client.listTeamProvisioningRequests(),e=>e.code==='INVALID_RESPONSE');}
});
test('pilot approval uses the existing review route and preserves only the matched approved result',async()=>{
  const endsAt=1900000000000,seats=6,pilot={startsAt:1800000001000,endsAt,seats},row={...REQUEST,status:'activated',revision:4,pilot};
  const f=fixture(()=>json({request:{...row,adminPhone:'13800138000'},invitationCode:INVITE,token:TOKEN}));await login(f);
  const input={requestId:REQUEST.id,decision:'approve-pilot',revision:3,currentPassword:'  unchanged password  ',endsAt,seats};assert.deepEqual(await f.client.reviewTeamProvisioningRequest(input),{request:row});assert.equal(f.calls.at(-1).url,API_BASE+'/api/operations/team-requests/request-a/review');assert.deepEqual(JSON.parse(f.calls.at(-1).options.body),{decision:'approve-pilot',revision:3,currentPassword:input.currentPassword,endsAt,seats});
  const handlers=new Map(),mainFrame={url:APP_URL},webContents={mainFrame};const dispose=registerDesktopBridge({ipcMain:{handle:(n,fn)=>handlers.set(n,fn),removeHandler:n=>handlers.delete(n)},window:{webContents},client:f.client,dialog:{}});assert.equal(ledgerOldChannelNames(handlers).length,123);assert.deepEqual(await handlers.get('shenyi:team-review-decide')({sender:webContents,senderFrame:mainFrame},input),{ok:true,value:{request:row}});dispose();
});
test('pilot approval rejects unsafe fields, extra authority and wrong reply binding before accepting completion',async()=>{
  const input={requestId:REQUEST.id,decision:'approve-pilot',revision:3,currentPassword:'current',endsAt:1900000000000,seats:2},f=fixture(()=>json({}));await login(f);const before=f.calls.length;
  for(const patch of [{endsAt:undefined},{endsAt:0},{endsAt:1.5},{endsAt:'1900000000000'},{endsAt:Number.MAX_SAFE_INTEGER+1},{seats:undefined},{seats:0},{seats:-1},{seats:2.5},{seats:'2'},{seats:Number.MAX_SAFE_INTEGER+1},{revision:Number.MAX_SAFE_INTEGER},{startsAt:1},{role:'partner'},{token:TOKEN}])await assert.rejects(()=>f.client.reviewTeamProvisioningRequest({...input,...patch}),e=>e.code==='INVALID_INPUT');
  for(const decision of ['approve','reject','revoke'])await assert.rejects(()=>f.client.reviewTeamProvisioningRequest({...input,decision}),e=>e.code==='INVALID_INPUT');assert.equal(f.calls.length,before);
  for(const patch of [{id:'foreign'},{revision:3},{revision:5},{status:'approved'},{pilot:null},{pilot:{startsAt:1,endsAt:input.endsAt,seats:3}},{pilot:{startsAt:1,endsAt:input.endsAt+1,seats:2}}]){const g=fixture(()=>json({request:{...REQUEST,status:'activated',revision:4,pilot:{startsAt:1,endsAt:input.endsAt,seats:2},...patch}}));await login(g);await assert.rejects(()=>g.client.reviewTeamProvisioningRequest(input),e=>e.code==='INVALID_RESPONSE');}
});
