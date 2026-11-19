'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createTeamClient,API_BASE}=require('../desktop/team-client.cjs');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const TOKEN=Buffer.alloc(32,21).toString('base64url');
const SESSION={account:{id:'manager-a',displayName:'Synthetic manager'},memberships:[{teamId:'team-a',role:'manager'}],expiresAt:Date.now()+3600000};
const ITEM={invitationId:'i-a',teamId:'team-a',role:'intern',phoneMasked:'+8613****8000',expiresAt:Date.now()+86400000,status:'pending'};
const CURSOR=Buffer.from(JSON.stringify([1,'manager-a','team-a','business',1,'i-a'])).toString('base64url');
const OTHER=Buffer.from(JSON.stringify([1,'manager-a','team-a','business',0,'i-b'])).toString('base64url');
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
      const call={route,method:options.method,status:answer.status,headers:options.headers};calls.push(call);
      return state.after?state.after(call,answer):answer;
    }});
  await client.login({username:'administrator-demo',password:PASSWORD});
  await client.enrollDevice({displayName:'Synthetic invitation computer',currentPassword:PASSWORD,confirmed:true});
  assert.equal(client.getDeviceStatus().state,'ready');
  t.after(()=>client.clearSession());
  const invite=()=>client.createEmployeeInvitation({teamId:'team-a',phone:'+8613800098001',role:'intern'});
  const invitations=()=>['team_invitations','team_employee_invitations','team_operator_employee_invitations'].map(table=>f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n);
  const enableFullCapacity=async()=>{
    const {recordSubscriptionTerm,countActiveBusinessSeats}=await source('subscription-store.mjs');
    const {recordSeatCapacityGrant}=await source('seat-capacity-store.mjs');
    const at=f.clock.value,interval={teamId:'team-a',startsAt:at-1000,endsAt:at+86400000,sourceRef:'synthetic-invitation-full-capacity'};
    recordSubscriptionTerm(f.db,{...interval,operationId:randomUUID(),expectedRevision:0},{now:()=>at});
    const seats=countActiveBusinessSeats(f.db,'team-a');assert.ok(seats>0);
    recordSeatCapacityGrant(f.db,{...interval,grantId:randomUUID(),seats},{now:()=>at});
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
});
