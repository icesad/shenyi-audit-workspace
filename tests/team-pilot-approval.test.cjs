'use strict';
// Real managed application requests and independent Ed25519 proofs; all identities,
// passwords and SMS deliveries are isolated synthetic test data, not vendors.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {randomUUID,randomBytes,createHash,generateKeyPairSync,sign}=require('node:crypto');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const {readFileSync}=require('node:fs');
const proof=require('../shared/device-proof.cjs');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const PASSWORD='SyntheticPilot!2026',AT=Date.parse('2026-11-19T08:00:00Z');
const BASE='/api/operations/team-requests',FIRST='/api/auth/first-administrator';
const digest=value=>createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
let passwordHash;

async function fixture(t){
 const {initializeTeamDatabase}=await source('database.mjs'),{hashPassword}=await source('passwords.mjs');
 const {handleTeamApplicationRequest}=await source('application-api.mjs');
 passwordHash??=hashPassword(PASSWORD);
 const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);t.after(()=>db.close());
 db.exec(readFileSync(path.resolve(__dirname,'../server/team/pilot-approval-schema.sql'),'utf8'));
 for(const [i,id] of ['pilot-owner','pilot-other-owner','pilot-open-only','pilot-junior'].entries()){
  db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);
  db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(id,id,'Synthetic '+id,await passwordHash);
  db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run(id,'+861380000080'+i,AT-1000);
  db.prepare("INSERT INTO team_platform_reviewers(user_id,permission,status) VALUES (?,'team.provision','active')").run(id);
  if(id!=='pilot-open-only')db.prepare("INSERT INTO team_pilot_approval_reviewers(user_id,permission,status) VALUES (?,'team.pilot.approve','active')").run(id);
 }
 db.exec("INSERT INTO teams VALUES ('junior-team','active');INSERT INTO team_memberships VALUES ('junior-team','pilot-junior','intern','active')");
 const f={db,clock:{value:AT},sent:[],requests:[],readyActors:new Map(),nextPhone:0};
 const identityProviders={deviceProofRequired:true,phonePepper:randomBytes(32),sms:{send:async value=>{f.sent.push({...value});}}};
 f.options={db,now:()=>f.clock.value,serviceMode:'managed-service',identityProviders,subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1'};
 f.call=async(route,{method='POST',body,session,options={},unsigned=false,headers:extraHeaders={}}={})=>{
  const serialized=body===undefined?undefined:JSON.stringify(body),headers={Origin:'shenyi://app',...(serialized===undefined?{}:{'Content-Type':'application/json'}),...(session?{Authorization:'Bearer '+session.token}:{}),...extraHeaders};
  if(session?.lease&&!unsigned){
   const fields={serverId:session.lease.serverId,userId:session.account.id,sessionBinding:proof.sessionBinding(session.token),deviceId:session.lease.deviceId,bindingRevision:session.lease.bindingRevision,leaseId:session.lease.id,method,pathAndQuery:route,bodySha256:digest(serialized??''),nonce:randomBytes(32).toString('base64url')};
   Object.assign(headers,{'X-Shenyi-Device-Lease':session.lease.token,'X-Shenyi-Device-Nonce':fields.nonce,'X-Shenyi-Device-Body-SHA256':fields.bodySha256,'X-Shenyi-Device-Signature':sign(null,proof.requestProofBytes(fields),session.key.privateKey).toString('base64url')});
  }
  const response=await handleTeamApplicationRequest(new Request('https://team.shenyi.example'+route,{method,headers,...(serialized===undefined?{}:{body:serialized})}),{...f.options,...options});
  const text=await response.text(),data=text?JSON.parse(text):null;f.requests.push({route,method,status:response.status,signed:!!session?.lease&&!unsigned});
  return {status:response.status,data};
 };
 f.ready=async id=>{
  if(f.readyActors.has(id))return f.readyActors.get(id);
  const phone=db.prepare('SELECT phone FROM team_phone_credentials WHERE user_id=?').get(id).phone;
  const login=await f.call('/api/auth/phone/login',{body:{phone,password:PASSWORD}});assert.equal(login.status,200,JSON.stringify(login.data));
  const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'der'}).toString('base64url');
  const challenge=await f.call('/api/auth/devices/enrollment-challenges',{session:login.data,body:{publicKey,displayName:'Synthetic pilot device',platform:'win32',currentPassword:PASSWORD}});assert.equal(challenge.status,201,JSON.stringify(challenge.data));
  const held=await f.call('/api/auth/devices/enroll',{session:login.data,body:{challengeId:challenge.data.challenge.challengeId,signature:sign(null,proof.challengeBytes(challenge.data.challenge),pair.privateKey).toString('base64url')}});assert.equal(held.status,201,JSON.stringify(held.data));
  const result={...held.data,key:pair};f.readyActors.set(id,result);return result;
 };
 f.owner=await f.ready('pilot-owner');
 f.list=async(options={},session=f.owner)=>{const result=await f.call(BASE,{method:'GET',session,options});assert.equal(result.status,200,JSON.stringify(result.data));return result.data.requests;};
 f.open=async()=>{
  const phone='+86139000009'+String(10+f.nextPhone++);
  const created=await f.call(BASE,{session:f.owner,body:{teamName:'Synthetic reviewed pilot '+f.nextPhone,adminPhone:phone}});assert.equal(created.status,201,JSON.stringify(created.data));
  const approved=await f.call(BASE+'/'+created.data.request.id+'/review',{session:f.owner,body:{decision:'approve',revision:created.data.request.revision,currentPassword:PASSWORD}});assert.equal(approved.status,200,JSON.stringify(approved.data));
  const challenge=await f.call(FIRST+'/challenges',{body:{invitationCode:approved.data.invitationCode,phone}});assert.equal(challenge.status,202,JSON.stringify(challenge.data));
  const sent=f.sent.find(row=>row.challengeId===challenge.data.challengeId);assert.ok(sent);assert.equal(sent.purpose,'first-admin');
  const activated=await f.call(FIRST+'/activate',{body:{invitationCode:approved.data.invitationCode,phone,challengeId:challenge.data.challengeId,code:sent.code,password:PASSWORD,displayName:'Synthetic first administrator',accept:true}});assert.equal(activated.status,200,JSON.stringify(activated.data));
  const request=(await f.list()).find(row=>row.id===created.data.request.id);assert.equal(request.status,'activated');
  const target=db.prepare('SELECT activated_by FROM team_provisioning_requests WHERE request_id=?').get(request.id).activated_by;
  return {request,adminId:target,phone};
 };
 f.body=(request,extra={})=>({decision:'approve-pilot',revision:request.revision,currentPassword:PASSWORD,endsAt:f.clock.value+60000,seats:1,...extra});
 f.approve=(request,extra={},settings={})=>f.call(BASE+'/'+request.id+'/review',{session:f.owner,body:f.body(request,extra),...settings});
 const business=['team_provisioning_requests','team_subscription_pilots','team_subscription_events','team_subscription_heads','team_seat_capacity_grants','team_memberships','team_operators','team_project_grants','team_admin_grants','team_activity','team_operator_employee_invitations'];
 f.facts=()=>business.map(name=>{const rows=db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all();return {name,count:rows.length,sha256:digest(JSON.stringify(rows))};});
 f.count=(table,teamId)=>Number(db.prepare('SELECT COUNT(*) AS n FROM '+table+(teamId?' WHERE team_id=?':'')).get(...(teamId?[teamId]:[])).n);
 return f;
}

test('generic initialization remains compatible without installing or granting the optional pilot capability',async t=>{
 const {initializeTeamDatabase}=await source('database.mjs'),{deviceServerId}=await source('device-policy.mjs');
 const {assertManagedDatabaseReady}=await source('managed-database-readiness.mjs');
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name IN ('team_pilot_approval_reviewers','team_subscription_pilots')").get().n,0);
 assertManagedDatabaseReady(db,deviceServerId(db));
});

test('managed signed owner explicitly approves first pilot, then first administrator can invite within seats and expiry',async t=>{
 const f=await fixture(t),{request,adminId}=await f.open(),teamId=request.teamId;
 assert.equal(request.pilot,null);
 for(const name of ['team_subscription_pilots','team_subscription_events','team_subscription_heads','team_seat_capacity_grants'])assert.equal(f.count(name,teamId),0);
 const admin=await f.ready(adminId),invite='/api/teams/'+teamId+'/employee-invitations';
 assert.equal((await f.call(invite,{session:admin,body:{phone:'+8613900010001',role:'intern'}})).status,402);
 const body=f.body(request),approved=await f.approve(request);assert.equal(approved.status,200,JSON.stringify(approved.data));
 assert.equal(approved.data.request.status,'activated');assert.equal(approved.data.request.revision,request.revision+1);
 assert.deepEqual(approved.data.request.pilot,{startsAt:AT,endsAt:body.endsAt,seats:1});
 assert.deepEqual((await f.list()).find(row=>row.id===request.id),approved.data.request);
 const overview='/api/teams/'+teamId+'/billing/overview';
 const legacyOverview=await f.call(overview,{method:'GET',session:admin});assert.equal(legacyOverview.status,200,JSON.stringify(legacyOverview.data));
 assert.equal(Object.hasOwn(legacyOverview.data.subscription,'pilot'),false);
 const pilotOverview=await f.call(overview,{method:'GET',session:admin,headers:{'X-Shenyi-Billing-Source':'approved-pilot-v1'}});
 assert.equal(pilotOverview.status,200,JSON.stringify(pilotOverview.data));assert.equal(pilotOverview.data.simulation,false);
 assert.deepEqual(pilotOverview.data.subscription,{...legacyOverview.data.subscription,pilot:true});
 const beforeReplay=f.facts();assert.deepEqual(await f.approve(request),approved);assert.deepEqual(f.facts(),beforeReplay);
 const first=await f.call(invite,{session:admin,body:{phone:'+8613900010001',role:'intern'}});assert.equal(first.status,201,JSON.stringify(first.data));
 assert.equal((await f.call(invite,{session:admin,body:{phone:'+8613900010002',role:'assistant'}})).status,409);
 assert.equal(f.count('team_operator_employee_invitations',teamId),1);
 assert.equal(f.count('team_memberships',teamId),0,'technical administrator receives no audit role');
 f.clock.value=body.endsAt;
 assert.equal((await f.call(invite,{session:admin,body:{phone:'+8613900010003',role:'intern'}})).status,402);
 assert.equal(f.count('team_operator_employee_invitations',teamId),1);
 for(const table of ['team_annual_orders','team_annual_verified_payments','team_seat_orders','team_seat_verified_payments'])assert.equal(f.count(table),0);
 assert.equal(f.db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('pilot approval requires independent permission and valid held owner proof, not opening permission or a junior grant',async t=>{
 const f=await fixture(t),{request}=await f.open(),before=f.facts();
 for(const id of ['pilot-open-only','pilot-junior']){
  const actor=await f.ready(id),result=await f.approve(request,{}, {session:actor});assert.equal(result.status,404,JSON.stringify(result.data));assert.deepEqual(f.facts(),before);
 }
 const missing=await f.approve(request,{}, {unsigned:true});assert.equal(missing.status,403);assert.deepEqual(f.facts(),before);
 f.db.prepare("UPDATE team_platform_reviewers SET status='revoked',revision=revision+1 WHERE user_id='pilot-owner'").run();
 const denied=await f.approve(request);assert.equal(denied.status,404,JSON.stringify(denied.data));assert.deepEqual(f.facts(),before);
});

test('unsupported service or schema omits pilot DTO and rejects approval without business writes',async t=>{
 const f=await fixture(t),{request}=await f.open(),before=f.facts();
 for(const options of [{serviceMode:'local-preview'},{subscriptionEnforcement:'disabled',seatCapacityEnforcement:'disabled'},{seatCapacityEnforcement:'disabled'}]){
  assert.equal(Object.hasOwn((await f.list(options)).find(row=>row.id===request.id),'pilot'),false);
  const result=await f.approve(request,{}, {options});assert.equal(result.status,403);assert.equal(result.data.error.code,'PILOT_APPROVAL_UNAVAILABLE');assert.deepEqual(f.facts(),before);
 }
 f.db.exec('DROP TABLE team_subscription_pilots');
 assert.equal(Object.hasOwn((await f.list()).find(row=>row.id===request.id),'pilot'),false);
 const result=await f.approve(request);assert.equal(result.status,403);assert.equal(result.data.error.code,'PILOT_APPROVAL_UNAVAILABLE');
 assert.equal(f.count('team_subscription_events'),0);assert.equal(f.count('team_seat_capacity_grants'),0);
});

test('pilot expiry, seats and current password bounds reject without committing rights',async t=>{
 const f=await fixture(t),{request}=await f.open(),before=f.facts();
 for(const [change,status,code] of [
  ...[{seats:0},{seats:-1},{seats:1.5},{seats:Number.MAX_SAFE_INTEGER+1},{endsAt:8640000000000001}].map(change=>[change,400,'INVALID_INPUT']),
  [{endsAt:AT-1},409,'PILOT_APPROVAL_CONFLICT'],[{endsAt:AT},409,'PILOT_APPROVAL_CONFLICT'],
  [{currentPassword:'WrongSyntheticPassword!2026'},403,'VERIFICATION_FAILED'],
 ]){
  const result=await f.approve(request,change);assert.equal(result.status,status,JSON.stringify(result.data));assert.equal(result.data.error.code,code);assert.deepEqual(f.facts(),before);
 }
});

test('prior term history or capacity prevents first-pilot approval even after old terms expire',async t=>{
 const f=await fixture(t),subscription=await source('subscription-store.mjs'),capacity=await source('seat-capacity-store.mjs');
 for(const kind of ['active-term','expired-term','capacity']){
  const {request}=await f.open(),teamId=request.teamId;
  if(kind==='capacity')capacity.recordSeatCapacityGrant(f.db,{teamId,grantId:randomUUID(),seats:1,startsAt:AT-1000,endsAt:AT+1000,sourceRef:'synthetic-prior-capacity'},{now:()=>AT});
  else subscription.recordSubscriptionTerm(f.db,{teamId,operationId:randomUUID(),expectedRevision:0,startsAt:AT-2000,endsAt:kind==='expired-term'?AT-1000:AT+1000,sourceRef:'synthetic-prior-term'},{now:()=>AT});
  const before=f.facts(),result=await f.approve(request);assert.equal(result.status,409,JSON.stringify(result.data));assert.deepEqual(f.facts(),before);
  assert.equal(Object.hasOwn((await f.list()).find(row=>row.id===request.id),'pilot'),false);
 }
});

test('concurrent exact approvals return one original receipt and one immutable entitlement pair',async t=>{
 const f=await fixture(t),{request}=await f.open();
 const [a,b]=await Promise.all([f.approve(request),f.approve(request)]);assert.equal(a.status,200,JSON.stringify(a.data));assert.deepEqual(a,b);
 for(const table of ['team_subscription_pilots','team_subscription_events','team_subscription_heads','team_seat_capacity_grants'])assert.equal(f.count(table,request.teamId),1);
 const before=f.facts();assert.equal((await f.approve(request,{seats:2})).status,409);assert.deepEqual(f.facts(),before);
 const other=await f.ready('pilot-other-owner');assert.equal((await f.approve(request,{}, {session:other})).status,409);assert.deepEqual(f.facts(),before);
 for(const operation of ['UPDATE team_subscription_pilots SET seats=2','DELETE FROM team_subscription_pilots'])assert.throws(()=>f.db.exec(operation),/PILOT_APPROVAL_IMMUTABLE/);
});

test('concurrent different approvals publish only the winner and reject the stale decision',async t=>{
 const f=await fixture(t),{request}=await f.open();
 const results=await Promise.all([f.approve(request,{seats:1}),f.approve(request,{seats:2})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const winner=results.find(r=>r.status===200).data.request;
 assert.deepEqual((await f.list()).find(row=>row.id===request.id),winner);
 assert.equal(f.count('team_subscription_pilots',request.teamId),1);assert.equal(f.count('team_subscription_events',request.teamId),1);
 assert.equal(f.db.prepare('SELECT seats FROM team_seat_capacity_grants WHERE team_id=?').get(request.teamId).seats,winner.pilot.seats);
});

test('actual final pilot-audit INSERT failure rolls back term, seats and request revision, allowing a clean retry',async t=>{
 const f=await fixture(t),{request}=await f.open(),before=f.facts();
 f.db.exec("CREATE TRIGGER synthetic_pilot_last_insert BEFORE INSERT ON team_subscription_pilots BEGIN SELECT RAISE(ABORT,'SYNTHETIC_PILOT_LAST_INSERT'); END");
 const failed=await f.approve(request);assert.equal(failed.status,409,JSON.stringify(failed.data));assert.equal(failed.data.error.code,'PILOT_APPROVAL_CONFLICT');assert.deepEqual(f.facts(),before);
 f.db.exec('DROP TRIGGER synthetic_pilot_last_insert');
 const retried=await f.approve(request);assert.equal(retried.status,200,JSON.stringify(retried.data));assert.equal(f.count('team_subscription_pilots',request.teamId),1);
});

function afterAuthorityRead(t,db){
 const prepare=db.prepare,entered=deferred();let active=true;
 const restore=()=>{if(active){active=false;db.prepare=prepare;}};t.after(restore);
 db.prepare=function(sql){const statement=prepare.call(this,sql);if(active&&sql.includes('SELECT revision FROM team_pilot_approval_reviewers')){const get=statement.get;statement.get=function(...args){const result=get.apply(this,args);restore();entered.resolve();return result;};}return statement;};
 return entered.promise;
}
for(const change of ['independent-authority','password','device','target'])test('approval rechecks '+change+' after real asynchronous password work before committing',{timeout:15000},async t=>{
 const f=await fixture(t),{request,adminId}=await f.open(),before=f.facts(),entered=afterAuthorityRead(t,f.db);
 const pending=f.approve(request);await entered;
 if(change==='independent-authority')f.db.prepare("UPDATE team_pilot_approval_reviewers SET revision=revision+1 WHERE user_id='pilot-owner'").run();
 if(change==='password')f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='pilot-owner'").run();
 if(change==='device')f.db.prepare("UPDATE team_device_leases SET revoked_at=? WHERE user_id='pilot-owner' AND revoked_at IS NULL").run(AT);
 if(change==='target')f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id=?").run(adminId);
 const result=await pending;assert.equal(result.status,change==='device'?403:409,JSON.stringify(result.data));
 assert.equal(result.data.error.code,change==='device'?'DEVICE_PROOF_REQUIRED':change==='password'?'DEVICE_STATE_CHANGED':'PILOT_APPROVAL_CONFLICT');
 assert.deepEqual(f.facts(),before);
});
