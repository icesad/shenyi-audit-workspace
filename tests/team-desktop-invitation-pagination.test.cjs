'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTeamClient,API_BASE}=require('../desktop/team-client.cjs');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const TOKEN=Buffer.alloc(32,21).toString('base64url');
const SESSION={account:{id:'manager-a',displayName:'Synthetic manager'},memberships:[{teamId:'team-a',role:'manager'}],expiresAt:Date.now()+3600000};
const ITEM={invitationId:'i-a',teamId:'team-a',role:'intern',phoneMasked:'+8613****8000',expiresAt:Date.now()+86400000,status:'pending'};
const CURSOR=Buffer.from(JSON.stringify([1,'manager-a','team-a','business',1,'i-a'])).toString('base64url');
const OTHER=Buffer.from(JSON.stringify([1,'manager-a','team-a','business',0,'i-b'])).toString('base64url');
const REQUEST='a1231111-2222-4333-8444-555555555555', OTHER_REQUEST='b1231111-2222-4333-9444-555555555555';
const RECEIPT_ITEM={...ITEM,invitationId:'ei-e038cc125f4799477812debca4356ce0'};
const CODE=Buffer.alloc(32,17).toString('base64url');
const CREATE={teamId:'team-a',phone:'13800138000',role:'intern'};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
async function fixture(respond=()=>json({invitations:[ITEM],nextCursor:null})){
  const calls=[];
  const client=createTeamClient({fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/api/auth/login'))return json({token:TOKEN,...SESSION});
    if(url.endsWith('/api/auth/logout'))return json({signedOut:true});
    return respond(url,options);
  }});
  await client.login({username:'manager-a',password:'Synthetic!2026'});return {client,calls};
}
test('invitation seek query is bounded, authenticated and retains the masked DTO',async()=>{
  const f=await fixture(()=>json({invitations:[{...ITEM,phone:'13800138000',invitationCode:'SECRET',source:'operator'}],nextCursor:OTHER,total:999}));
  const page=await f.client.listEmployeeInvitations({teamId:'team-a',after:CURSOR,limit:1});
  assert.deepEqual(page,{invitations:[ITEM],nextCursor:OTHER});
  assert.equal(f.calls.at(-1).url,API_BASE+'/api/teams/team-a/employee-invitations?after='+CURSOR+'&limit=1');
  assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer '+TOKEN);
});
test('only a default legacy call can normalize an absent cursor',async()=>{
  const f=await fixture(()=>json({invitations:[ITEM]}));
  assert.deepEqual(await f.client.listEmployeeInvitations({teamId:'team-a'}),{invitations:[ITEM],nextCursor:null});
  for(const input of [{teamId:'team-a',limit:50},{teamId:'team-a',after:CURSOR}])await assert.rejects(()=>f.client.listEmployeeInvitations(input),e=>e.code==='INVALID_RESPONSE');
  const modern=await fixture(()=>json({invitations:[],nextCursor:null}));
  assert.deepEqual(await modern.client.listEmployeeInvitations({teamId:'team-a',after:CURSOR,limit:50}),{invitations:[],nextCursor:null});
});
test('invalid page inputs are rejected before network, including explicit empty or undefined values',async()=>{
  const f=await fixture(),before=f.calls.length;
  for(const patch of [{after:''},{after:undefined},{after:null},{after:'bad\n'},{after:'a='},{after:'a'},{after:'a'.repeat(1025)},{after:'../../x'},{limit:undefined},{limit:'50'},{limit:0},{limit:51},{limit:1.5},{limit:NaN},{role:'partner'},{offset:50}])await assert.rejects(()=>f.client.listEmployeeInvitations({teamId:'team-a',...patch}),e=>e.code==='INVALID_INPUT');
  assert.equal(f.calls.length,before);
});
test('page replies cannot silently truncate, loop or manufacture a continuation',async()=>{
  for(const nextCursor of [undefined,'',false,12,'bad\n','a=','a','a'.repeat(1025),CURSOR]){
    const f=await fixture(()=>json({invitations:[ITEM],nextCursor}));
    await assert.rejects(()=>f.client.listEmployeeInvitations({teamId:'team-a',after:CURSOR,limit:1}),e=>e.code==='INVALID_RESPONSE');
  }
  for(const body of [{invitations:[],nextCursor:OTHER},{invitations:[ITEM,ITEM],nextCursor:null},{invitations:[{...ITEM,teamId:'team-b'}],nextCursor:null},{invitations:[{...ITEM,phoneMasked:'13800138000'}],nextCursor:null},{invitations:[{...ITEM,status:'invented'}],nextCursor:null},{invitations:null,nextCursor:null}]){
    const f=await fixture(()=>json(body));await assert.rejects(()=>f.client.listEmployeeInvitations({teamId:'team-a',after:CURSOR,limit:1}),e=>e.code==='INVALID_RESPONSE');
  }
});
test('late page data after logout is rejected before a renderer can receive it',async()=>{
  let entered,deliver;const ready=new Promise(r=>entered=r);
  const f=await fixture(()=>{entered();return new Promise(r=>deliver=r);});
  const pending=f.client.listEmployeeInvitations({teamId:'team-a',after:CURSOR,limit:1});await ready;
  await f.client.logout();deliver(json({invitations:[ITEM],nextCursor:null}));
  await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED');assert.equal(await f.client.getSession(),null);
});

test('creation lookup capability is granted only with invite access and is absent for older responses',async()=>{
  let reply={canInvite:true,creationLookup:true,providerDetail:'private'};
  const f=await fixture(()=>json(reply));
  assert.deepEqual(await f.client.getInvitationAccess({teamId:'team-a'}),{canInvite:true,creationLookup:true});
  for (const [value,view] of [
    [{canInvite:true},{canInvite:true}],
    [{canInvite:true,creationLookup:false},{canInvite:true}],
    [{canInvite:false,creationLookup:true},{canInvite:false}],
    [{canInvite:false},{canInvite:false}],
  ]) {
    reply=value;
    assert.deepEqual(await f.client.getInvitationAccess({teamId:'team-a'}),view);
  }
  for (const creationLookup of [null,1,'true',{}]) {
    reply={canInvite:false,creationLookup};
    await assert.rejects(()=>f.client.getInvitationAccess({teamId:'team-a'}),{code:'INVALID_RESPONSE'});
  }
});

test('creation sends a canonical request ID only when explicit and verifies its echoed receipt',async()=>{
  const {status,...base}=RECEIPT_ITEM;
  let reply={...base,invitationCode:CODE,requestId:REQUEST,phone:CREATE.phone};
  const f=await fixture(()=>json(reply));
  assert.deepEqual(await f.client.createEmployeeInvitation({...CREATE,requestId:REQUEST}),
    {...base,invitationCode:CODE,requestId:REQUEST});
  const access=f.calls.at(-1);
  assert.equal(access.url,API_BASE+'/api/teams/team-a/employee-invitations');
  assert.equal(access.options.method,'POST');
  assert.deepEqual(JSON.parse(access.options.body),{phone:CREATE.phone,role:'intern',requestId:REQUEST});
  assert.deepEqual(await f.client.createEmployeeInvitation(CREATE),{...base,invitationCode:CODE});
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body),{phone:CREATE.phone,role:'intern'});
  for (const fields of [{requestId:undefined},{requestId:OTHER_REQUEST},{requestId:REQUEST.toUpperCase()},{invitationCode:null},
    {invitationId:ITEM.invitationId},{role:'assistant'}]) {
    reply={...base,requestId:REQUEST,invitationCode:CODE,...fields};
    await assert.rejects(()=>f.client.createEmployeeInvitation({...CREATE,requestId:REQUEST}),{code:'INVALID_RESPONSE'});
  }
});

test('exact receipt lookup uses a distinct authenticated query and exposes at most one masked invitation',async()=>{
  let reply={requestId:REQUEST,invitations:[{...RECEIPT_ITEM,phone:CREATE.phone,invitationCode:CODE,requestId:OTHER_REQUEST}],nextCursor:null};
  const f=await fixture(()=>json(reply)),input={teamId:'team-a',requestId:REQUEST};
  assert.deepEqual(await f.client.listEmployeeInvitations(input),{invitations:[RECEIPT_ITEM],nextCursor:null,requestId:REQUEST});
  const lookup=f.calls.at(-1);
  assert.equal(lookup.url,API_BASE+'/api/teams/team-a/employee-invitations?requestId='+REQUEST);
  assert.equal(lookup.options.method,'GET');
  assert.equal(lookup.options.body,undefined);
  assert.equal(lookup.options.headers.Authorization,'Bearer '+TOKEN);
  reply={requestId:REQUEST,invitations:[],nextCursor:null};
  assert.deepEqual(await f.client.listEmployeeInvitations(input),{invitations:[],nextCursor:null,requestId:REQUEST});
  assert.deepEqual(await f.client.listEmployeeInvitations({teamId:'team-a'}),{invitations:[],nextCursor:null});
  for (const fields of [
    {requestId:undefined},{requestId:OTHER_REQUEST},{nextCursor:undefined},{nextCursor:OTHER},{invitations:[RECEIPT_ITEM,RECEIPT_ITEM]},
    {invitations:[{...RECEIPT_ITEM,teamId:'team-b'}]},{invitations:[{...RECEIPT_ITEM,phoneMasked:CREATE.phone}]},
    {invitations:[ITEM]},
  ]) {
    reply={requestId:REQUEST,invitations:[RECEIPT_ITEM],nextCursor:null,...fields};
    await assert.rejects(()=>f.client.listEmployeeInvitations(input),{code:'INVALID_RESPONSE'});
  }
});

test('noncanonical request IDs or mixed lookup and paging never reach the service',async()=>{
  const f=await fixture(),before=f.calls.length;
  for (const requestId of [null,undefined,'',REQUEST.toUpperCase(),REQUEST+'\n',REQUEST.replace('-4333-','-1333-'),REQUEST.replace('-8444-','-7444-')]) {
    await assert.rejects(()=>f.client.createEmployeeInvitation({...CREATE,requestId}),{code:'INVALID_INPUT'});
    await assert.rejects(()=>f.client.listEmployeeInvitations({teamId:'team-a',requestId}),{code:'INVALID_INPUT'});
  }
  for (const paging of [{after:CURSOR},{limit:1},{after:undefined},{limit:undefined}]) {
    await assert.rejects(()=>f.client.listEmployeeInvitations({teamId:'team-a',requestId:REQUEST,...paging}),{code:'INVALID_INPUT'});
  }
  assert.equal(f.calls.length,before);
});

test('same existing invitation channel passes only page arguments from its exact trusted frame',async()=>{
  const handlers=new Map(),mainFrame={url:APP_URL},webContents={mainFrame},seen=[];
  const dispose=registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window:{webContents},client:{clearSession(){},listEmployeeInvitations:async arg=>{seen.push(arg);return {invitations:[],nextCursor:null};}},dialog:{}});
  const handler=handlers.get('shenyi:invitation-list'),event={sender:webContents,senderFrame:mainFrame},arg={teamId:'team-a',after:CURSOR,limit:2};
  assert.equal((await handler(event,arg)).ok,true);assert.deepEqual(seen,[arg]);
  for(const extra of [{role:'partner'},{source:'operator'},{offset:100},{userId:'victim'}])assert.equal((await handler(event,{...arg,...extra})).ok,false);
  for(const foreign of [{sender:{},senderFrame:mainFrame},{sender:webContents,senderFrame:{url:APP_URL}},{sender:webContents,senderFrame:{url:'https://untrusted.invalid'}}])assert.equal((await handler(foreign,arg)).error.code,'UNTRUSTED_SENDER');
  assert.equal(seen.length,1);dispose();assert.equal(handlers.size,0);
});

// Actual strict synthetic app verifies each Ed25519 request before the optional
// response projection below. No real SMS, external service or live accounts.
async function signedInvitationFixture(t){
  const {sign,randomUUID}=require('node:crypto');
  const proof=require('../shared/device-proof.cjs');
  const {createBusinessRoleFixture,PASSWORD,keyPair,source}=require('./helpers/business-role-fixture.cjs');
  const f=await createBusinessRoleFixture(t),{handleTeamApplicationRequest}=await source('application-api.mjs');
  const key=keyPair(),fingerprint=proof.parsePublicKey(key.encoded).fingerprint;
  const calls=[],state={after:null};
  const vault={async getPublicIdentity(){return {publicKey:key.encoded,fingerprint};},
    async signChallenge(fields){return sign(null,proof.challengeBytes(fields),key.privateKey).toString('base64url');},
    async signRequest(fields){return sign(null,proof.requestProofBytes(fields),key.privateKey).toString('base64url');}};
  const client=createTeamClient({deviceIdentity:{vault,platform:'win32'},now:()=>f.clock.value,
    fetchImpl:async(url,options)=>{
      const request=new Request(url,options),route=new URL(url).pathname;
      const answer=await handleTeamApplicationRequest(request,{db:f.db,now:()=>f.clock.value,
        identityProviders:{deviceProofRequired:true},subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1'});
      const call={route,pathAndQuery:route+new URL(url).search,method:options.method,status:answer.status,headers:options.headers};calls.push(call);
      return state.after?state.after(call,answer):answer;
    }});
  await client.login({username:'administrator-demo',password:PASSWORD});
  await client.enrollDevice({displayName:'Synthetic invitation computer',currentPassword:PASSWORD,confirmed:true});
  assert.equal(client.getDeviceStatus().state,'ready');
  t.after(()=>client.clearSession());
  const invite=(options={})=>client.createEmployeeInvitation({teamId:'team-a',phone:'+8613800098001',role:'intern',...options});
  const invitations=()=>['team_invitations','team_employee_invitations','team_operator_employee_invitations'].map(table=>f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n);
  const enableFullCapacity=async(extraSeats=0)=>{
    const {recordSubscriptionTerm,countActiveBusinessSeats}=await source('subscription-store.mjs');
    const {recordSeatCapacityGrant}=await source('seat-capacity-store.mjs');
    const at=f.clock.value,interval={teamId:'team-a',startsAt:at-1000,endsAt:at+86400000,sourceRef:'synthetic-invitation-full-capacity'};
    recordSubscriptionTerm(f.db,{...interval,operationId:randomUUID(),expectedRevision:0},{now:()=>at});
    const seats=countActiveBusinessSeats(f.db,'team-a');assert.ok(seats>0);
    recordSeatCapacityGrant(f.db,{...interval,grantId:randomUUID(),seats:seats+extraSeats},{now:()=>at});
  };
  return {...f,client,calls,state,invite,invitations,enableFullCapacity};
}

test('signed real subscription and capacity denials retain their precise safe invitation codes without creating an invitation',async t=>{
  const f=await signedInvitationFixture(t),before=f.invitations();
  await assert.rejects(f.invite,error=>error.code==='SUBSCRIPTION_WRITE_UNAVAILABLE'&&error.status===402&&error.message==='本次邀请未创建，请核对团队订阅与席位。');
  assert.equal(f.calls.at(-1).status,402);assert.deepEqual(f.invitations(),before);
  assert.equal(f.client.getDeviceStatus().state,'ready');
  await f.enableFullCapacity();
  await assert.rejects(f.invite,error=>error.code==='SEAT_CAPACITY_EXHAUSTED'&&error.status===409&&error.message==='本次邀请未创建，请核对团队订阅与席位。');
  assert.equal(f.calls.at(-1).status,409);assert.deepEqual(f.invitations(),before);
  assert.equal(f.client.getDeviceStatus().state,'ready');
  assert.equal((await f.client.getSession()).account.id,'administrator-demo');
  const posts=f.calls.filter(call=>call.route==='/api/teams/team-a/employee-invitations'&&call.method==='POST');
  assert.equal(posts.length,2);
  for(const call of posts)for(const name of ['Authorization','X-Shenyi-Device-Lease','X-Shenyi-Device-Nonce','X-Shenyi-Device-Signature'])assert.ok(call.headers[name]);
});

test('safe invitation mapping requires exact signed POST path and matched status plus code; other errors remain generic',async t=>{
  const f=await signedInvitationFixture(t),before=f.invitations();
  const remoteMessage='Synthetic untrusted provider message must never reach the renderer';
  for(const [status,code,expected]of [
    [402,'SUBSCRIPTION_WRITE_UNAVAILABLE','SUBSCRIPTION_WRITE_UNAVAILABLE'],
    [409,'SEAT_CAPACITY_EXHAUSTED','SEAT_CAPACITY_EXHAUSTED'],
    [402,'SEAT_CAPACITY_EXHAUSTED','HTTP_402'],
    [409,'SUBSCRIPTION_WRITE_UNAVAILABLE','HTTP_409'],
    [409,'UNRELATED_CONFLICT','HTTP_409'],
    [409,'INVITATION_CREATION_ALREADY_RECORDED','HTTP_409'],
    [402,'UNRELATED_CONFLICT','HTTP_402'],
    [403,'SEAT_CAPACITY_EXHAUSTED','HTTP_403'],
  ]){
    f.state.after=(call,answer)=>call.route==='/api/teams/team-a/employee-invitations'&&call.method==='POST'?Response.json({error:{code,message:remoteMessage}},{status}):answer;
    await assert.rejects(f.invite,error=>error.code===expected&&error.status===status&&!error.message.includes(remoteMessage));
    assert.equal(f.calls.at(-1).status,402,'The real underlying request was verified and denied before its synthetic response projection');
    assert.equal(f.client.getDeviceStatus().state,'ready');assert.deepEqual(f.invitations(),before);
  }
  f.state.after=(call,answer)=>call.route.startsWith('/api/teams/')?Response.json({error:{code:'SEAT_CAPACITY_EXHAUSTED',message:remoteMessage}},{status:409}):answer;
  await assert.rejects(()=>f.client.listEmployeeInvitations({teamId:'team-a'}),{code:'HTTP_409'});
  await assert.rejects(()=>f.client.revokeEmployeeInvitation({teamId:'team-a',invitationId:'synthetic-absent-invitation'}),{code:'HTTP_409'});
  assert.deepEqual(f.invitations(),before);
  const legacy=await fixture(()=>Response.json({error:{code:'SUBSCRIPTION_WRITE_UNAVAILABLE',message:remoteMessage}},{status:402}));
  await assert.rejects(()=>legacy.client.createEmployeeInvitation({teamId:'team-a',phone:'+8613800098002',role:'intern'}),{code:'HTTP_402'});
  assert.equal(legacy.calls.at(-1).options.headers['X-Shenyi-Device-Signature'],undefined);
  f.state.after=()=>Response.json({error:{code:'INVITATION_CREATION_ALREADY_RECORDED',message:remoteMessage}},{status:402});
  await assert.rejects(()=>f.invite({requestId:REQUEST}),{code:'HTTP_402'});
  f.state.after=()=>Response.json({error:{code:'INVITATION_CREATION_ALREADY_RECORDED',message:remoteMessage}},{status:409});
  await assert.rejects(()=>f.client.listEmployeeInvitations({teamId:'team-a',requestId:REQUEST}),{code:'HTTP_409'});
  await assert.rejects(()=>f.client.revokeEmployeeInvitation({teamId:'team-a',invitationId:'synthetic-absent-invitation'}),{code:'HTTP_409'});
  const unsigned=await fixture(()=>Response.json({error:{code:'INVITATION_CREATION_ALREADY_RECORDED',message:remoteMessage}},{status:409}));
  await assert.rejects(()=>unsigned.client.createEmployeeInvitation({...CREATE,requestId:REQUEST}),{code:'HTTP_409'});
});

test('existing desktop bridge recovers a signed tracked creation without disclosing its original code',async t=>{
  const f=await signedInvitationFixture(t);
  await f.enableFullCapacity(1);
  assert.deepEqual(await f.client.getInvitationAccess({teamId:'team-a'}),{canInvite:true,creationLookup:true});
  const handlers=new Map(),mainFrame={url:APP_URL},webContents={mainFrame};
  const dispose=registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},
    window:{webContents},client:f.client,dialog:{}});
  t.after(dispose);
  const event={sender:webContents,senderFrame:mainFrame};
  const form={...CREATE,phone:'+8613800098001',requestId:REQUEST};
  const sourceBefore=f.invitations().reduce((sum,count)=>sum+count,0);
  const issued=await handlers.get('shenyi:invitation-create')(event,form);
  assert.equal(issued.ok,true);
  assert.equal(issued.value.requestId,REQUEST);
  assert.match(issued.value.invitationCode,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(f.invitations().reduce((sum,count)=>sum+count,0),sourceBefore+1);
  assert.equal(f.calls.at(-1).status,201);

  const duplicate=await handlers.get('shenyi:invitation-create')(event,form);
  assert.deepEqual(duplicate,{ok:false,error:{code:'INVITATION_CREATION_ALREADY_RECORDED',message:'该邀请请求已有记录，请按原请求编号核对。'}});
  assert.equal(f.calls.at(-1).status,409);

  const lookup={teamId:'team-a',requestId:REQUEST};
  const recovered=await handlers.get('shenyi:invitation-list')(event,lookup);
  const {invitationCode,requestId,...masked}=issued.value;
  assert.deepEqual(recovered,{ok:true,value:{invitations:[{...masked,status:'pending'}],nextCursor:null,requestId}});
  assert.ok(!JSON.stringify(recovered).includes(invitationCode));
  assert.ok(!JSON.stringify(recovered).includes(form.phone));
  const request=f.calls.at(-1);
  assert.equal(request.pathAndQuery,'/api/teams/team-a/employee-invitations?requestId='+REQUEST);
  assert.equal(request.method,'GET');
  for (const name of ['Authorization','X-Shenyi-Device-Lease','X-Shenyi-Device-Nonce','X-Shenyi-Device-Signature']) assert.ok(request.headers[name]);
  const absent=await handlers.get('shenyi:invitation-list')(event,{teamId:'team-a',requestId:OTHER_REQUEST});
  assert.deepEqual(absent,{ok:true,value:{invitations:[],nextCursor:null,requestId:OTHER_REQUEST}});
  assert.equal(f.invitations().reduce((sum,count)=>sum+count,0),sourceBefore+1);
  assert.equal(f.client.getDeviceStatus().state,'ready');
  const callCount=f.calls.length;
  assert.deepEqual(await handlers.get('shenyi:invitation-list')(event,{...lookup,limit:1}),
    {ok:false,error:{code:'INVALID_INPUT',message:'按请求编号核对邀请时不能指定分页。'}});
  assert.equal(f.calls.length,callCount);
});
