'use strict';
// Actual strict application + SQLite. Keys, accounts and files are synthetic.
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {generateKeyPairSync,sign,createHash,randomBytes,randomUUID}=require('node:crypto'),path=require('node:path'),{pathToFileURL}=require('node:url');
const proof=require('../shared/device-proof.cjs'),replacement=require('../shared/device-replacement-proof.cjs');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const PASSWORD='ShenyiDemo!2026',NOW=Date.parse('2026-11-15T15:00:00Z'),digest=value=>createHash('sha256').update(value).digest('hex');
const key=()=>{const pair=generateKeyPairSync('ed25519');return {...pair,encoded:pair.publicKey.export({format:'der',type:'spki'}).toString('base64url')};};
let baseline;
async function fixture(t){
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');baseline??=(async()=>{const db=new DatabaseSync(':memory:');try{initializeTeamDatabase(db);await seedDemoTeamData(db);return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name+'"').all()}));}finally{db.close();}})();
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);db.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');for(const {name,rows} of await baseline)for(const row of rows){const names=Object.keys(row);db.prepare('INSERT OR REPLACE INTO "'+name+'"('+names.join(',')+') VALUES ('+names.map(()=>'?').join(',')+')').run(...Object.values(row));}db.exec('COMMIT');
 for(const id of ['admin-core','owner-core','other-admin','recovery-core','access-core','provision-core']){db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) SELECT ?,?,?,password_hash FROM team_credentials WHERE user_id=\'manager-a\'').run(id,id,id);}
 db.prepare("INSERT INTO team_operators VALUES ('team-a','admin-core','administrator','active'),('team-b','other-admin','administrator','active')").run();
 db.prepare("INSERT INTO team_device_replacement_reviewers(user_id,permission,status) VALUES ('owner-core','device.replace','active')").run();
 db.prepare("INSERT INTO team_recovery_reviewers(user_id,permission,status) VALUES ('recovery-core','account.recover','active')").run();
 db.prepare("INSERT INTO team_access_reviewers(user_id,permission,status) VALUES ('access-core','member.disable','active')").run();
 db.prepare("INSERT INTO team_platform_reviewers(user_id,permission,status) VALUES ('provision-core','team.provision','active')").run();
 const {handleTeamApplicationRequest}=await source('application-api.mjs'),clock={value:NOW},calls=[];
 const api=async(route,{method='GET',session,body,headers={},raw}={})=>{
  const serialized=body===undefined?undefined:JSON.stringify(body),actualHeaders={Origin:'shenyi://app',...(session?{Authorization:'Bearer '+session.token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers};
  if(session?.lease){const fields={serverId:session.lease.serverId,userId:session.account.id,sessionBinding:proof.sessionBinding(session.token),deviceId:session.lease.deviceId,bindingRevision:session.lease.bindingRevision,leaseId:session.lease.id,method,pathAndQuery:route,bodySha256:digest(serialized??''),nonce:randomBytes(32).toString('base64url')};Object.assign(actualHeaders,{'X-Shenyi-Device-Lease':session.lease.token,'X-Shenyi-Device-Nonce':fields.nonce,'X-Shenyi-Device-Body-SHA256':fields.bodySha256,'X-Shenyi-Device-Signature':sign(null,proof.requestProofBytes(fields),session.key.privateKey).toString('base64url')});}
  const response=await handleTeamApplicationRequest(raw??new Request('http://127.0.0.1:8774'+route,{method,headers:actualHeaders,...(serialized===undefined?{}:{body:serialized})}),{db,now:()=>clock.value,identityProviders:{deviceProofRequired:true}});
  const value=await response.text();calls.push({route,method,status:response.status});return {status:response.status,data:value?JSON.parse(value):null,headers:response.headers};
 };
 const login=async(user='intern-a')=>{const r=await api('/api/auth/login',{method:'POST',body:{username:user,password:PASSWORD}});assert.equal(r.status,200);return r.data;};
 const ready=async(user='intern-a',pair=key())=>{const boot=await login(user),challenge=await api('/api/auth/devices/enrollment-challenges',{method:'POST',session:boot,body:{publicKey:pair.encoded,displayName:'Synthetic old computer',platform:'win32',currentPassword:PASSWORD}});assert.equal(challenge.status,201);const result=await api('/api/auth/devices/enroll',{method:'POST',session:boot,body:{challengeId:challenge.data.challenge.challengeId,signature:sign(null,proof.challengeBytes(challenge.data.challenge),pair.privateKey).toString('base64url')}});assert.equal(result.status,201);return {...result.data,key:pair};};
 const finish=async(purpose,challenge,session,pair)=>api('/api/auth/device-replacements/'+purpose,{method:'POST',session,body:{challengeId:challenge.challengeId,signature:sign(null,replacement.replacementChallengeBytes(challenge),pair.privateKey).toString('base64url')}});
 const request=async({user='intern-a',old,newKey=key(),boot}={})=>{old??=await ready(user);boot??=await login(user);const challenge=await api('/api/auth/device-replacements/request-challenges',{method:'POST',session:boot,body:{publicKey:newKey.encoded,displayName:'Synthetic replacement',platform:'darwin',currentPassword:PASSWORD}});assert.equal(challenge.status,201,JSON.stringify(challenge.data));const result=await finish('request',challenge.data.challenge,boot,newKey);assert.equal(result.status,201,JSON.stringify(result.data));return {old,newKey,boot,row:result.data.request};};
 const review=async(row,actor,decision='approve',extra={})=>api('/api/account/device-replacement-reviews/'+row.id+'/review',{method:'POST',session:actor,body:{revision:row.revision,decision,currentPassword:PASSWORD,...extra}});
 const challenge=async(purpose,r,session=r.boot,pair=r.newKey)=>api('/api/auth/device-replacements/'+purpose+'-challenges',{method:'POST',session,body:{requestId:r.row.id,revision:r.row.revision,publicKey:pair.encoded}});
 const approve=async(r,actor)=>{actor??=await ready('admin-core');const response=await review(r.row,actor);assert.equal(response.status,200,JSON.stringify(response.data));r.row=response.data.request;return actor;};
 const activate=async(r,session=r.boot)=>{const c=await challenge('activate',r,session);assert.equal(c.status,201,JSON.stringify(c.data));return finish('activate',c.data.challenge,session,r.newKey);};
 return {db,clock,api,login,ready,finish,request,review,challenge,approve,activate,calls};
}
const LIVE="SELECT * FROM team_device_leases WHERE revoked_at IS NULL";
const ownedTables=['team_credentials','team_phone_credentials','team_wechat_identities','team_memberships','team_operators','team_project_grants','team_attachment_grants','team_admin_grants','team_task_assignments','team_task_versions','team_task_submissions','team_collection_attachments'];
const rows=(db,tables)=>JSON.stringify(tables.map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));
function dto(row){assert.deepEqual(Object.keys(row).sort(),['id','teamId','teamName','displayName','targetKind','status','revision','createdAt','expiresAt','oldDevice','newDevice'].sort());assert.deepEqual(Object.keys(row.oldDevice).sort(),['id','displayName','platform','keyFingerprint','status','revision'].sort());assert.deepEqual(Object.keys(row.newDevice).sort(),['displayName','platform','keyFingerprint'].sort());for(const forbidden of ['publicKey','token','stamp','session','phone','password'])assert.ok(!JSON.stringify(row).includes('"'+forbidden+'"'));}
function cloneReplacementHistory(db,id,createdAt){
 const original=db.prepare('SELECT * FROM team_device_replacement_requests WHERE request_id=?').get(id);
 const row={...original,request_id:randomUUID(),status:'rejected',created_at:createdAt};
 const names=Object.keys(row);
 db.prepare('INSERT INTO team_device_replacement_requests('+names.join(',')+') VALUES ('+names.map(()=>'?').join(',')+')').run(...Object.values(row));
 return row.request_id;
}

test('first enrollment remains separate, same active key cannot request replacement, and query/method constraints stay exact',async t=>{
 const f=await fixture(t),boot=await f.login();assert.deepEqual((await f.api('/api/auth/device-replacements',{session:boot})).data,{canRequest:false,request:null});const old=await f.ready(),r=await f.api('/api/auth/device-replacements/request-challenges',{method:'POST',session:old,body:{publicKey:old.key.encoded,displayName:'Same',platform:'win32',currentPassword:PASSWORD}});assert.equal(r.status,409);
 assert.equal((await f.api('/api/auth/device-replacements?q=x',{session:old})).status,400);const wrong=await f.api('/api/auth/device-replacements',{method:'POST',session:old,body:{}});assert.equal(wrong.status,405);assert.equal(wrong.headers.get('Allow'),'GET');assert.equal((await f.api('/api/auth/device-replacements/request-challenges',{method:'POST',session:old,body:{publicKey:key().encoded,displayName:'Synthetic',platform:'win32',currentPassword:PASSWORD,confirmed:true}})).status,400);
});
test('new-key request is signed, exact minimal DTO, single open request and a 24-hour candidate',async t=>{
 const f=await fixture(t),r=await f.request();dto(r.row);assert.equal(r.row.status,'pending');assert.equal(r.row.expiresAt-r.row.createdAt,86400000);const again=await f.api('/api/auth/device-replacements/request-challenges',{method:'POST',session:r.boot,body:{publicKey:key().encoded,displayName:'Another',platform:'win32',currentPassword:PASSWORD}});assert.equal(again.status,409);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_replacement_requests').get().n,1);assert.equal((await f.api('/api/auth/devices/connection',{session:r.old})).status,200);assert.equal(f.db.prepare(LIVE).all().length,1);
});
test('own status prioritizes the current open request over a same-millisecond terminal history UUID',async t=>{
 const f=await fixture(t),old=await f.ready(),boot=await f.login(),pair=key(),crypto=require('node:crypto'),{syncBuiltinESMExports}=require('node:module');
 const create=async(requestId,challengeId)=>{const original=crypto.randomUUID,sequence=[challengeId,requestId];let response;crypto.randomUUID=()=>sequence.length?sequence.shift():original();syncBuiltinESMExports();try{response=await f.api('/api/auth/device-replacements/request-challenges',{method:'POST',session:boot,body:{publicKey:pair.encoded,displayName:'Same clock replacement',platform:'win32',currentPassword:PASSWORD}});assert.equal(sequence.length,0);}finally{crypto.randomUUID=original;syncBuiltinESMExports();}assert.equal(response.status,201);const result=await f.finish('request',response.data.challenge,boot,pair);assert.equal(result.status,201);return {old,boot,newKey:pair,row:result.data.request};};
 const first=await create('ffffffff-ffff-4fff-bfff-ffffffffffff','eeeeeeee-eeee-4eee-beee-eeeeeeeeeeee'),withdraw=await f.challenge('withdraw',first);assert.equal((await f.finish('withdraw',withdraw.data.challenge,boot,pair)).status,200);
 const pending=await create('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');assert.equal(first.row.createdAt,pending.row.createdAt);const status=await f.api('/api/auth/device-replacements',{session:boot});assert.equal(status.data.canRequest,false);assert.equal(status.data.request.id,pending.row.id);assert.equal(status.data.request.status,'pending');
});
test('approval leaves the old machine working and claim atomically replaces it while preserving all audit data',async t=>{
 const f=await fixture(t),old=await f.ready(),bytes=Buffer.from('Synthetic original replacement test\0原件');const upload=await f.api('/api/teams/team-a/collection/tasks/task-a/submissions',{method:'POST',session:old,body:{revision:0,filename:'synthetic.bin',contentBase64:bytes.toString('base64')}});assert.equal(upload.status,201);const before=rows(f.db,ownedTables),r=await f.request({old});await f.approve(r);assert.equal(r.row.status,'approved');assert.equal(r.row.expiresAt,NOW+1800000);assert.equal((await f.api('/api/auth/devices/connection',{session:old})).status,200);const claimed=await f.activate(r);assert.equal(claimed.status,200,JSON.stringify(claimed.data));assert.equal(claimed.data.lease.expiresAt,NOW+900000);assert.equal(claimed.data.expiresAt,claimed.data.lease.expiresAt);assert.notEqual(claimed.data.token,r.boot.token);assert.notEqual(claimed.data.device.id,old.device.id);assert.equal(claimed.data.device.revision,1);assert.equal((await f.api('/api/auth/devices/connection',{session:old})).status,401);assert.equal((await f.api('/api/auth/session',{session:r.boot})).status,401);const newSession={...claimed.data,key:r.newKey};assert.equal((await f.api('/api/teams/team-a/collection/tasks',{session:newSession})).status,200);assert.equal(rows(f.db,ownedTables),before);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_device_bindings WHERE user_id='intern-a'").get().n,2);assert.equal(f.db.prepare("SELECT status FROM team_device_bindings WHERE device_id=?").get(old.device.id).status,'revoked');assert.equal((await f.api('/api/auth/device-replacements',{session:newSession})).data.request.status,'claimed');assert.equal((await f.api('/api/auth/devices',{session:newSession})).data.device.id,claimed.data.device.id);
});
for(const actor of ['manager-a','partner-a','other-admin','owner-core','recovery-core','access-core','provision-core'])test(`${actor} cannot substitute an unrelated privilege for employee technical review`,async t=>{
 const f=await fixture(t),r=await f.request(),reviewer=await f.ready(actor);const response=await f.review(r.row,reviewer);assert.equal(response.status,404);assert.equal(f.db.prepare('SELECT status FROM team_device_replacement_requests').get().status,'pending');
});
test('administrator replacement requires the independent device owner and never self-review',async t=>{
 const f=await fixture(t),r=await f.request({user:'admin-core'}),owner=await f.ready('owner-core');assert.equal((await f.review(r.row,r.old)).status,404);const approved=await f.review(r.row,owner);assert.equal(approved.status,200);r.row=approved.data.request;assert.equal((await f.activate(r)).status,200);
});
test('review endpoints require a strict device context and current proof independently of credentials',async t=>{
 const f=await fixture(t),r=await f.request(),adminBoot=await f.login('admin-core');assert.equal((await f.review(r.row,adminBoot)).status,403);const {handleDeviceReplacementRequest}=await source('device-replacement-api.mjs');await assert.rejects(()=>handleDeviceReplacementRequest(new Request('http://local/api/account/device-replacement-reviews/access',{headers:{Authorization:'Bearer '+adminBoot.token}}),{db:f.db,now:()=>NOW,identityProviders:{deviceProofRequired:true}}),error=>error.status===403);
});
for(const phase of ['pending','approved'])test(`signed withdrawal in ${phase} preserves the old binding and closes its request`,async t=>{
 const f=await fixture(t),r=await f.request();if(phase==='approved')await f.approve(r);const c=await f.challenge('withdraw',r);assert.equal(c.status,201);const result=await f.finish('withdraw',c.data.challenge,r.boot,r.newKey);assert.equal(result.status,200);assert.equal(result.data.request.status,'withdrawn');assert.equal((await f.api('/api/auth/devices/connection',{session:r.old})).status,200);assert.equal((await f.finish('withdraw',c.data.challenge,r.boot,r.newKey)).status,409);
});
for(const decision of ['reject','revoke'])test(`${decision} transitions only its expected state and does not displace the old machine`,async t=>{
 const f=await fixture(t),r=await f.request(),admin=await f.ready('admin-core');if(decision==='revoke')await f.approve(r,admin);const response=await f.review(r.row,admin,decision);assert.equal(response.status,200);assert.equal(response.data.request.status,decision==='reject'?'rejected':'revoked');assert.equal((await f.review(response.data.request,admin,decision)).status,409);assert.equal((await f.api('/api/auth/devices/connection',{session:r.old})).status,200);
});
test('explicit fresh login resumes an approved request but old-token and wrong-key challenges cannot be moved',async t=>{
 const f=await fixture(t),r=await f.request();await f.approve(r);const original=await f.challenge('activate',r);assert.equal(original.status,201);const fresh=await f.login();assert.equal((await f.finish('activate',original.data.challenge,fresh,r.newKey)).status,404);assert.equal((await f.challenge('activate',r,fresh,key())).status,404);const resumed=await f.activate(r,fresh);assert.equal(resumed.status,200);assert.equal(resumed.data.device.keyFingerprint,proof.parsePublicKey(r.newKey.encoded).fingerprint);
});
test('five incorrect signatures exhaust a challenge without creating an application',async t=>{
 const f=await fixture(t),old=await f.ready(),boot=await f.login(),pair=key(),wrong=key(),response=await f.api('/api/auth/device-replacements/request-challenges',{method:'POST',session:boot,body:{publicKey:pair.encoded,displayName:'Synthetic',platform:'win32',currentPassword:PASSWORD}}),challenge=response.data.challenge;for(let i=0;i<5;i++)assert.equal((await f.finish('request',challenge,boot,wrong)).status,403);assert.equal((await f.finish('request',challenge,boot,pair)).status,409);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_replacement_requests').get().n,0);assert.equal((await f.api('/api/auth/devices/connection',{session:old})).status,200);
});
for(const mutation of ['operator','credential','binding','account'])test(`approved request becomes stale after ${mutation} authority or target ABA`,async t=>{
 const f=await fixture(t),r=await f.request(),admin=await f.approve(r);if(mutation==='operator'){f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='admin-core'").run();f.db.prepare("UPDATE team_operators SET status='active' WHERE user_id='admin-core'").run();}if(mutation==='credential')f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='intern-a'").run();if(mutation==='binding'){f.db.prepare("UPDATE team_device_bindings SET status='revoked' WHERE device_id=?").run(r.old.device.id);f.db.prepare("UPDATE team_device_bindings SET status='active' WHERE device_id=?").run(r.old.device.id);}if(mutation==='account'){f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='intern-a'").run();f.db.prepare("UPDATE team_users SET status='active' WHERE user_id='intern-a'").run();}assert.equal((await f.api('/api/auth/device-replacements',{session:r.boot})).data.request.status,'stale');assert.equal((await f.challenge('activate',r)).status,409);assert.equal(f.db.prepare("SELECT status FROM team_device_bindings WHERE device_id=?").get(r.old.device.id).status,'active');assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_device_bindings WHERE user_id='intern-a'").get().n,1);assert.equal(admin.account.id,'admin-core');
});
test('revoked history supports reviewed restoration with the same key and does not reenter first enrollment',async t=>{
 const f=await fixture(t),old=await f.ready();f.db.prepare("UPDATE team_device_bindings SET status='revoked',revision=revision+1,revoked_at=? WHERE device_id=?").run(NOW,old.device.id);f.db.prepare("UPDATE team_sessions SET revoked_at=? WHERE user_id='intern-a'").run(NOW);const r=await f.request({old,newKey:old.key});await f.approve(r);assert.equal(r.row.oldDevice.status,'revoked');assert.equal((await f.activate(r)).status,200);assert.equal(f.db.prepare('SELECT revision FROM team_device_bindings WHERE device_id=?').get(old.device.id).revision,2);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_device_bindings WHERE user_id='intern-a'").get().n,2);
});
test('expired approval is not claimable and a new request explicitly terminates its prior open row',async t=>{
 const f=await fixture(t),r=await f.request();await f.approve(r);f.clock.value=r.row.expiresAt;assert.equal((await f.challenge('activate',r)).status,410);assert.equal((await f.api('/api/auth/device-replacements',{session:r.boot})).data.request.status,'expired');const next=await f.request({old:r.old,newKey:key()});assert.notEqual(next.row.id,r.row.id);assert.equal(f.db.prepare('SELECT status FROM team_device_replacement_requests WHERE request_id=?').get(r.row.id).status,'expired');assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_device_replacement_requests WHERE status='pending'").get().n,1);
});
test('an audit insertion failure rolls the complete claim back, including sessions, binding epoch and challenge consumption',async t=>{
 const f=await fixture(t),r=await f.request();await f.approve(r);const challenge=await f.challenge('activate',r),tables=['team_device_bindings','team_device_leases','team_sessions','team_recovery_identity_epochs','team_device_replacement_requests','team_device_replacement_challenges','team_device_events','team_device_replacement_events'],before=rows(f.db,tables);f.db.exec("CREATE TRIGGER fail_replacement_claim BEFORE INSERT ON team_device_replacement_events WHEN NEW.action='claim' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");assert.equal((await f.finish('activate',challenge.data.challenge,r.boot,r.newKey)).status,503);assert.equal(rows(f.db,tables),before);assert.equal((await f.api('/api/auth/devices/connection',{session:r.old})).status,200);
});
test('two activation challenges still produce only one binding and one claimed event',async t=>{
 const f=await fixture(t),r=await f.request();await f.approve(r);const a=await f.challenge('activate',r),b=await f.challenge('activate',r);const results=await Promise.all([f.finish('activate',a.data.challenge,r.boot,r.newKey),f.finish('activate',b.data.challenge,r.boot,r.newKey)]);assert.deepEqual(results.map(row=>row.status).sort(),[200,401]);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_device_bindings WHERE user_id='intern-a' AND status='active'").get().n,1);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_device_replacement_events WHERE action='claim'").get().n,1);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_device_leases WHERE user_id='intern-a' AND revoked_at IS NULL").get().n,1);
});
for(const room of [2,3])test(`claim checks identity epoch MAX with ${room} increments of available room`,async t=>{
 const f=await fixture(t),old=await f.ready();f.db.prepare("UPDATE team_recovery_identity_epochs SET version=? WHERE user_id='intern-a'").run(Number.MAX_SAFE_INTEGER-room);const r=await f.request({old});await f.approve(r);const c=await f.challenge('activate',r);if(room===2){assert.equal(c.status,409);assert.equal(f.db.prepare("SELECT status FROM team_device_bindings WHERE device_id=?").get(old.device.id).status,'active');}else{assert.equal(c.status,201);assert.equal((await f.finish('activate',c.data.challenge,r.boot,r.newKey)).status,200);assert.equal(f.db.prepare("SELECT version FROM team_recovery_identity_epochs WHERE user_id='intern-a'").get().version,Number.MAX_SAFE_INTEGER);}
});
test('review list only projects current authorized team requests and returns a bounded exact page',async t=>{
 const f=await fixture(t),a=await f.request(),b=await f.request({user:'intern-b'}),admin=await f.ready('admin-core'),other=await f.ready('other-admin');const list=await f.api('/api/account/device-replacement-reviews',{session:admin});assert.equal(list.status,200);assert.equal(list.data.hasMore,false);assert.deepEqual(list.data.requests.map(row=>row.id),[a.row.id]);dto(list.data.requests[0]);assert.deepEqual((await f.api('/api/account/device-replacement-reviews',{session:other})).data.requests.map(row=>row.id),[b.row.id]);assert.equal((await f.api('/api/account/device-replacement-reviews?limit=50',{session:admin})).status,400);
});
test('SQL scopes foreign history before its 51-row bound and authorized history sets hasMore',async t=>{
 const f=await fixture(t),a=await f.request(),b=await f.request({user:'intern-b'}),admin=await f.ready('admin-core');
 for(let i=0;i<90;i++)cloneReplacementHistory(f.db,b.row.id,NOW+1000+i);let result=await f.api('/api/account/device-replacement-reviews',{session:admin});assert.deepEqual(result.data.requests.map(row=>row.id),[a.row.id]);assert.equal(result.data.hasMore,false);
 for(let i=0;i<51;i++)cloneReplacementHistory(f.db,a.row.id,NOW+i);const original=f.db.prepare,observed=[];f.db.prepare=function(sql){const statement=original.call(this,sql);if(sql.includes('SELECT request.* FROM team_device_replacement_requests request')){const all=statement.all;statement.all=function(...args){const rows=all.apply(this,args);observed.push({sql,count:rows.length});return rows;};}return statement;};t.after(()=>{f.db.prepare=original;});
 result=await f.api('/api/account/device-replacement-reviews',{session:admin});assert.equal(result.data.requests.length,50);assert.equal(result.data.hasMore,true);assert.ok(result.data.requests.every(row=>row.teamId==='team-a'));assert.equal(observed.length,1);assert.equal(observed[0].count,51);assert.match(observed[0].sql,/LIMIT 51/);assert.match(observed[0].sql,/request\.team_id IN/);
});

test('opt-in review pages preserve tied order and reach the older open request after an insert',async t=>{
 const f=await fixture(t),older=await f.request(),admin=await f.ready('admin-core');
 const route='/api/account/device-replacement-reviews',options={session:admin};
 const history=Array.from({length:55},()=>cloneReplacementHistory(f.db,older.row.id,NOW+1)).sort().reverse();
 const business=['team_device_replacement_requests','team_device_replacement_events','team_device_replacement_challenges','team_device_bindings',...ownedTables];
 let before=rows(f.db,business);
 const first=await f.api(route+'?paging=1',options),legacy=await f.api(route,options);
 assert.equal(first.status,200);
 assert.deepEqual(first.data.requests.map(row=>row.id),history.slice(0,50));
 assert.equal(first.data.nextCursor,history[49]);
 assert.equal(first.data.hasMore,true);
 assert.deepEqual(legacy.data,{requests:first.data.requests,hasMore:true});
 assert.equal(rows(f.db,business),before);
 const inserted=cloneReplacementHistory(f.db,older.row.id,NOW+2);
 before=rows(f.db,business);
 const second=await f.api(route+'?paging=1&after='+first.data.nextCursor,options);
 assert.equal(second.status,200);
 assert.deepEqual(second.data.requests.map(row=>row.id),[...history.slice(50),older.row.id]);
 assert.equal(second.data.requests.at(-1).status,'pending');
 assert.equal(second.data.hasMore,false);
 assert.equal(second.data.nextCursor,null);
 second.data.requests.forEach(dto);
 assert.deepEqual((await f.api(route+'?paging=1&after='+older.row.id,options)).data,{requests:[],hasMore:false,nextCursor:null});
 assert.equal((await f.api(route+'?paging=1',options)).data.requests[0].id,inserted);
 assert.equal(rows(f.db,business),before);
});

test('review page anchors recheck scope and unavailable anchors have the same response',async t=>{
 const f=await fixture(t),own=await f.request(),foreign=await f.request({user:'intern-b'}),admin=await f.ready('admin-core');
 const route='/api/account/device-replacement-reviews',options={session:admin};
 const pageAfter=id=>f.api(route+'?paging=1&after='+id,options);
 const missing=await pageAfter(randomUUID()),differentTeam=await pageAfter(foreign.row.id);
 assert.equal(missing.status,404);
 assert.equal(differentTeam.status,404);
 assert.deepEqual(differentTeam.data,missing.data);
 assert.equal((await pageAfter(own.row.id)).status,200);
 f.db.prepare('UPDATE team_device_bindings SET revision=revision+1 WHERE device_id=?').run(own.old.device.id);
 const stale=(await f.api(route+'?paging=1',options)).data.requests[0];
 assert.equal(stale.id,own.row.id);
 assert.equal(stale.status,'stale');
 assert.equal((await pageAfter(stale.id)).status,200);
 f.db.prepare("UPDATE team_memberships SET status='disabled' WHERE user_id='intern-a'").run();
 const noLongerAvailable=await pageAfter(own.row.id);
 assert.equal(noLongerAvailable.status,404);
 assert.deepEqual(noLongerAvailable.data,missing.data);
 for(const query of ['paging=2','paging=1&paging=1','paging=1&after=','paging=1&after=invalid','paging=1&after='+own.row.id+'&after='+own.row.id,'paging=1&limit=50','after='+own.row.id]){
  assert.equal((await f.api(route+'?'+query,options)).status,400,query);
 }
 assert.equal((await f.api(route+'/access?paging=1',options)).status,400);
 assert.equal((await f.api(route+'?paging=1',{...options,method:'POST',body:{}})).status,400);
 assert.equal((await f.api(route+'?paging=1&after='+own.row.id,{session:foreign.old})).status,404);
});
