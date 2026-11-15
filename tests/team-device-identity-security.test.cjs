'use strict';
// Independent security acceptance: actual SQLite/application APIs and crypto.
// Expected signature bytes below intentionally do NOT use the shared codec.
// Accounts/keys are synthetic. This is not normal-desktop mandatory binding,
// real providers, OS-vault, Mac, hardware attestation or production evidence.
const nodeTest=require('node:test'),assert=require('node:assert/strict');
const test=(name,action)=>nodeTest(name,{timeout:15000},action);
const {DatabaseSync}=require('node:sqlite');
const {generateKeyPairSync,createHash,sign,createPublicKey,randomBytes,randomUUID}=require('node:crypto');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const ORIGIN='http://127.0.0.1:8774',NOW=Date.parse('2026-11-15T13:00:00Z'),PASSWORD='DeviceSynthetic!2026';
const digest=value=>createHash('sha256').update(value).digest('hex');
const CF=['purpose','serverId','userId','sessionBinding','keyFingerprint','identityEpoch','bindingRevision','approvalRequestId','challengeId','nonce','issuedAt','expiresAt'];
const RF=['serverId','userId','sessionBinding','deviceId','bindingRevision','leaseId','method','pathAndQuery','bodySha256','nonce'];
const challengePayload=value=>Buffer.concat([Buffer.from('SHENYI-DEVICE-PROOF\0v1\0','ascii'),Buffer.from(JSON.stringify(CF.map(key=>value[key])),'utf8')]);
const requestPayload=value=>Buffer.concat([Buffer.from('SHENYI-DEVICE-REQUEST\0v1\0','ascii'),Buffer.from(JSON.stringify(RF.map(key=>value[key])),'utf8')]);
const keyPair=()=>{const pair=generateKeyPairSync('ed25519'),der=pair.publicKey.export({format:'der',type:'spki'});return {...pair,der,encoded:der.toString('base64url'),fingerprint:digest(der)};};
const deferred=()=>{let resolve;return {promise:new Promise(value=>resolve=value),resolve};};
let encoded;
async function fixture(t,{strict=true}={}){
 const {initializeTeamDatabase}=await source('database.mjs'),{hashPassword}=await source('passwords.mjs'),{issueSession}=await source('auth-api.mjs'),{handleTeamApplicationRequest}=await source('application-api.mjs');encoded||=hashPassword(PASSWORD);
 const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);t.after(()=>db.close());
 for(const id of ['intern-a','intern-b','manager-a','tech-a','owner']){db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(id,id,id,await encoded);}
 for(const team of ['a','b']){db.prepare("INSERT INTO teams VALUES (?,'active')").run('team-'+team);db.prepare('INSERT INTO team_profiles VALUES (?,?)').run('team-'+team,'Synthetic '+team);db.prepare("INSERT INTO team_projects(team_id,project_id,title,status) VALUES (?,?,?,'active')").run('team-'+team,'project-'+team,'Synthetic project');db.prepare("INSERT INTO team_memberships VALUES (?,?,'intern','active')").run('team-'+team,'intern-'+team);db.prepare("INSERT INTO team_collection_tasks(team_id,task_id,project_id,title,instructions,status) VALUES (?,'task-a',?,'Synthetic task','No customer data','open')").run('team-'+team,'project-'+team);db.prepare("INSERT INTO team_task_assignments VALUES (?,'task-a',?,'active')").run('team-'+team,'intern-'+team);}
 db.prepare("INSERT INTO team_memberships VALUES ('team-a','manager-a','manager','active')").run();for(const permission of ['collection.read','collection.manage'])db.prepare("INSERT INTO team_project_grants VALUES ('team-a','project-a','manager-a',?,'active')").run(permission);db.prepare("INSERT INTO team_operators VALUES ('team-a','tech-a','administrator','active')").run();db.prepare("INSERT INTO team_access_reviewers(user_id,permission,status) VALUES ('owner','member.disable','active')").run();
 const tokens={};for(const id of ['intern-a','intern-b','manager-a','tech-a','owner'])tokens[id]=issueSession(db,id,NOW).token;
 const f={db,tokens,now:NOW,providers:{deviceProofRequired:strict},issueSession:id=>issueSession(db,id,f.now).token};
 f.send=async request=>{const response=await handleTeamApplicationRequest(request,{db,now:()=>f.now,identityProviders:f.providers}),bytes=Buffer.from(await response.arrayBuffer()),raw=bytes.toString('utf8');return {status:response.status,headers:response.headers,bytes,data:response.headers.get('Content-Type')?.startsWith('application/json')&&bytes.length?JSON.parse(raw):null,raw};};
 f.request=(route,{token,method='GET',body,rawBody,headers={}}={})=>new Request(ORIGIN+route,{method,headers:{Origin:'shenyi://app',...(token?{Authorization:'Bearer '+token}:{}),...((body!==undefined||rawBody!==undefined)?{'Content-Type':'application/json'}:{}),...headers},...((body!==undefined||rawBody!==undefined)?{body:rawBody===undefined?JSON.stringify(body):rawBody}:{})});
 f.call=(route,options)=>f.send(f.request(route,options));
 f.challenge=async(purpose,{key=keyPair(),user='intern-a',token=tokens[user],revision=1}={})=>{const r=await f.call('/api/auth/devices/'+({enroll:'enrollment',prove:'proof',revoke:'revocation'}[purpose])+'-challenges',{token,method:'POST',body:{publicKey:key.encoded,...(purpose==='enroll'?{displayName:'Synthetic device',platform:'win32',currentPassword:PASSWORD}:purpose==='revoke'?{revision,currentPassword:PASSWORD}:{})}});assert.equal(r.status,201,r.raw);return {fields:r.data.challenge,key,token,user};};
 f.complete=(challenge,{route=challenge.fields.purpose,key=challenge.key,token=challenge.token,fields=challenge.fields}={})=>f.call('/api/auth/devices/'+route,{token,method:'POST',body:{challengeId:challenge.fields.challengeId,signature:sign(null,challengePayload(fields),key.privateKey).toString('base64url')}});
 f.enroll=async(user='intern-a',key=keyPair(),token=tokens[user])=>{const c=await f.challenge('enroll',{user,key,token}),r=await f.complete(c);assert.equal(r.status,201,r.raw);return {session:r.data,key,user};};
 f.prove=async(bound,token=f.issueSession(bound.user))=>{const c=await f.challenge('prove',{user:bound.user,key:bound.key,token}),r=await f.complete(c);assert.equal(r.status,200,r.raw);return {...bound,session:r.data};};
 f.proofRequest=(route,{bound,method='GET',body,rawBody,nonce=randomBytes(32).toString('base64url'),fields:patch={},key=bound.key,headers={}})=>{
  const bytes=rawBody===undefined?Buffer.from(body===undefined?'':JSON.stringify(body)):Buffer.from(rawBody),url=new URL(ORIGIN+route),session=bound.session;
  const fields={serverId:session.lease.serverId,userId:bound.user,sessionBinding:digest(session.token),deviceId:session.device.id,bindingRevision:session.device.revision,leaseId:session.lease.id,method,pathAndQuery:url.pathname+url.search,bodySha256:digest(bytes),nonce,...patch};
  return f.request(route,{token:session.token,method,...(body!==undefined||rawBody!==undefined?{rawBody:bytes}:{}),headers:{'X-Shenyi-Device-Lease':session.lease.token,'X-Shenyi-Device-Nonce':nonce,'X-Shenyi-Device-Body-SHA256':fields.bodySha256,'X-Shenyi-Device-Signature':sign(null,requestPayload(fields),key.privateKey).toString('base64url'),...headers}});
 };
 f.protected=(route,options)=>f.send(f.proofRequest(route,options));
 return f;
}
function rejected(result,codes=[400,401,403,404,409,410,413,429,503]){assert.ok(codes.includes(result.status),result.status);assert.ok(!/password_hash|token_hash|scrypt\$|PRIVATE_|SQLITE|synthetic event failure/.test(result.raw));}
const replayCount=f=>f.db.prepare('SELECT COUNT(*) n FROM team_device_request_replays').get().n;
const bindingCount=f=>f.db.prepare('SELECT COUNT(*) n FROM team_device_bindings').get().n;
function state(f){return ['team_device_bindings','team_device_challenges','team_device_leases','team_device_request_replays','team_device_events','team_sessions','team_session_metadata','team_credentials','team_task_assignments','team_task_versions','team_collection_tasks','team_collection_attachments','team_task_submissions'].map(name=>{const rows=f.db.prepare('SELECT * FROM '+name).all();return {name,count:rows.length,hash:digest(JSON.stringify(rows.map(row=>JSON.stringify(row)).sort()))};});}
function duringPassword(t,f,mutate){const original=f.db.prepare;let hit=false;f.db.prepare=function(sql){const statement=original.call(this,sql);if(sql==='SELECT password_hash,revision FROM team_credentials WHERE user_id=?'){const get=statement.get;statement.get=function(...args){const result=get.apply(this,args);if(!hit){hit=true;queueMicrotask(mutate);}return result;};}return statement;};t.after(()=>f.db.prepare=original);return ()=>hit;}

test('independent canonical signature vector enrolls and returns a new immutable session/lease with a 15-minute deadline',async t=>{
 const f=await fixture(t),c=await f.challenge('enroll');assert.deepEqual(Object.keys(c.fields),CF);assert.equal(c.fields.sessionBinding,digest(c.token));assert.equal(c.fields.keyFingerprint,c.key.fingerprint);assert.equal(c.fields.expiresAt-c.fields.issuedAt,120000);assert.equal(c.fields.approvalRequestId,'');const result=await f.complete(c);assert.equal(result.status,201,result.raw);const session=result.data;assert.notEqual(session.token,c.token);assert.equal(session.expiresAt,f.now+900000);assert.equal(session.expiresAt,session.lease.expiresAt);assert.equal(f.db.prepare('SELECT revoked_at FROM team_sessions WHERE token_hash=?').get(digest(c.token)).revoked_at,f.now);assert.equal(bindingCount(f),1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_leases WHERE revoked_at IS NULL').get().n,1);
 const rows=f.db.prepare('SELECT * FROM team_device_events').all();assert.equal(rows.length,1);assert.ok(!/token|password|private|body/.test(Object.keys(rows[0]).join(' ')));
});

test('DER trailing garbage and same-length X25519 keys are rejected even when Node can import them',async t=>{
 const f=await fixture(t),key=keyPair(),trailing=Buffer.concat([key.der,Buffer.from([0])]);assert.equal(createPublicKey({key:trailing,format:'der',type:'spki'}).asymmetricKeyType,'ed25519');const wrong=generateKeyPairSync('x25519').publicKey.export({format:'der',type:'spki'});assert.equal(wrong.length,44);
 for(const publicKey of [trailing.toString('base64url'),wrong.toString('base64url'),key.encoded+'=']){const result=await f.call('/api/auth/devices/enrollment-challenges',{token:f.tokens['intern-a'],method:'POST',body:{publicKey,displayName:'Synthetic',platform:'win32',currentPassword:PASSWORD}});rejected(result,[400]);}assert.equal(bindingCount(f),0);
});

test('copied public identity without its private key fails and five wrong signatures retire only that challenge',async t=>{
 const f=await fixture(t),c=await f.challenge('enroll'),wrong=keyPair();for(let n=0;n<5;n++)rejected(await f.complete(c,{key:wrong}),[403]);rejected(await f.complete(c),[409]);assert.equal(bindingCount(f),0);const row=f.db.prepare('SELECT attempts,revoked_at FROM team_device_challenges WHERE challenge_id=?').get(c.fields.challengeId);assert.equal(row.attempts,5);assert.equal(row.revoked_at,f.now);
});

for(const field of ['serverId','userId','sessionBinding','keyFingerprint','identityEpoch','bindingRevision','approvalRequestId','nonce','issuedAt','expiresAt'])test('a signature over altered challenge '+field+' cannot authorize the stored challenge',async t=>{
 const f=await fixture(t),c=await f.challenge('enroll'),patch={serverId:randomUUID(),userId:'intern-b',sessionBinding:digest(f.tokens['intern-b']),keyFingerprint:keyPair().fingerprint,identityEpoch:c.fields.identityEpoch+1,bindingRevision:1,approvalRequestId:'forged-approval',nonce:randomBytes(32).toString('base64url'),issuedAt:c.fields.issuedAt+1,expiresAt:c.fields.expiresAt+1};rejected(await f.complete(c,{fields:{...c.fields,[field]:patch[field]}}),[403]);assert.equal(bindingCount(f),0);
});

test('challenge is bound to actual user, exact bearer token and completion purpose',async t=>{
 const f=await fixture(t),c=await f.challenge('enroll'),sameUserOtherToken=f.issueSession('intern-a');for(const token of [f.tokens['intern-b'],sameUserOtherToken])rejected(await f.complete(c,{token}),[404]);rejected(await f.complete(c,{route:'prove'}),[404]);assert.equal(bindingCount(f),0);
});

test('identity ABA, server identity mutation and exact expiry invalidate stored challenge authority',async t=>{
 for(const change of ['epoch','server','expiry']){const f=await fixture(t),c=await f.challenge('enroll');if(change==='epoch'){f.db.prepare("UPDATE team_memberships SET role='assistant' WHERE user_id='intern-a'").run();f.db.prepare("UPDATE team_memberships SET role='intern' WHERE user_id='intern-a'").run();}if(change==='server')f.db.prepare("UPDATE team_database_metadata SET value=? WHERE name='device-server-id'").run(randomUUID());if(change==='expiry')f.now=c.fields.expiresAt;rejected(await f.complete(c),change==='expiry'?[410]:[409]);assert.equal(bindingCount(f),0);}
});

test('concurrent first enrollment completions create exactly one binding, lease and audit event',async t=>{
 const f=await fixture(t),c=await f.challenge('enroll'),results=await Promise.all([f.complete(c),f.complete(c)]);assert.equal(results.filter(result=>result.status===201).length,1);rejected(results.find(result=>result.status!==201),[401,409]);assert.equal(bindingCount(f),1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_leases WHERE revoked_at IS NULL').get().n,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_events').get().n,1);
});

test('binding audit failure rolls back challenge consumption, all session revocations and lease issuance',async t=>{
 const f=await fixture(t),c=await f.challenge('enroll');f.db.exec("CREATE TRIGGER synthetic_device_event_failure BEFORE INSERT ON team_device_events BEGIN SELECT RAISE(ABORT,'synthetic event failure'); END");const before=state(f);rejected(await f.complete(c),[503]);assert.deepEqual(state(f),before);
});

test('password-only bootstrap login cannot evict the existing proved business session',async t=>{
 const f=await fixture(t),bound=await f.enroll(),logged=await f.call('/api/auth/login',{method:'POST',body:{username:'intern-a',password:PASSWORD}});assert.equal(logged.status,200);const response=await f.protected('/api/teams/team-a/collection/tasks',{bound});assert.equal(response.status,200,response.raw);const copied=f.proofRequest('/api/teams/team-a/collection/tasks',{bound});const headers=new Headers(copied.headers);headers.set('Authorization','Bearer '+logged.data.token);rejected(await f.send(new Request(copied.url,{headers})),[403]);assert.equal((await f.protected('/api/teams/team-a/collection/tasks',{bound})).status,200);
});

test('new proof rotates both auth token and lease and the old token cannot adopt a new lease',async t=>{
 const f=await fixture(t),old=await f.enroll(),next=await f.prove(old);assert.notEqual(next.session.token,old.session.token);assert.notEqual(next.session.lease.id,old.session.lease.id);rejected(await f.protected('/api/teams/team-a/collection/tasks',{bound:old}),[401]);const copied=f.proofRequest('/api/teams/team-a/collection/tasks',{bound:next}),headers=new Headers(copied.headers);headers.set('Authorization','Bearer '+old.session.token);rejected(await f.send(new Request(copied.url,{headers})),[401]);assert.equal((await f.protected('/api/teams/team-a/collection/tasks',{bound:next})).status,200);assert.throws(()=>f.db.prepare('UPDATE team_device_leases SET auth_session_hash=? WHERE lease_id=?').run(digest(f.issueSession('intern-a')),next.session.lease.id),/Immutable/);
});

test('revocation retains history and fresh password login cannot become first enrollment again',async t=>{
 const f=await fixture(t),bound=await f.enroll(),challenge=await f.challenge('revoke',{key:bound.key,token:bound.session.token}),revoked=await f.complete(challenge);assert.equal(revoked.status,200,revoked.raw);const fresh=f.issueSession('intern-a'),view=await f.call('/api/auth/devices',{token:fresh});assert.equal(view.data.hasHistory,true);assert.equal(view.data.canEnroll,false);assert.equal(view.data.device.status,'revoked');rejected(await f.call('/api/auth/devices/enrollment-challenges',{token:fresh,method:'POST',body:{publicKey:keyPair().encoded,displayName:'Reinstalled',platform:'darwin',currentPassword:PASSWORD}}),[409]);assert.equal(bindingCount(f),1);
});

test('strict gate covers every protected family, alternate auth methods and HEAD without accepting a forged flag',async t=>{
 const f=await fixture(t),token=f.tokens['intern-a'];for(const [method,route] of [['GET','/api/teams/team-a/collection/tasks'],['GET','/api/teams/team-a/collection/summary'],['POST','/api/teams/team-a/collection/tasks/task-a/submissions'],['HEAD','/api/teams/team-a/collection/tasks/task-a/attachments/missing'],['GET','/api/auth/sessions'],['POST','/api/auth/password'],['POST','/api/auth/phone/bind'],['GET','/api/teams/team-a/employee-invitations'],['GET','/api/account/recovery-reviews'],['GET','/api/operations/team-requests'],['GET','/api/auth/member-management/access'],['GET','/api/administration/team-administrators'],['POST','/api/auth/session'],['GET','/api/auth/session?forged=1']]){const result=await f.call(route,{token,method,...(method==='POST'?{body:{deviceProofRequired:false}}:{}),headers:{'X-Shenyi-Device-Proof-Required':'false'}});rejected(result,[403]);if(method==='HEAD')assert.equal(result.bytes.length,0);}assert.equal((await f.call('/api/auth/methods')).status,200);assert.equal((await f.call('/api/auth/session',{token})).status,200);
});

for(const field of ['serverId','userId','sessionBinding','deviceId','bindingRevision','leaseId','method','pathAndQuery'])test('strict request proof cannot be transferred by altering '+field,async t=>{
 const f=await fixture(t),bound=await f.enroll(),patch={serverId:randomUUID(),userId:'intern-b',sessionBinding:digest(f.tokens['intern-b']),deviceId:randomUUID(),bindingRevision:2,leaseId:randomUUID(),method:'POST',pathAndQuery:'/api/teams/team-a/collection/tasks?limit=1'};rejected(await f.protected('/api/teams/team-a/collection/tasks',{bound,fields:{[field]:patch[field]}}),[403]);assert.equal(replayCount(f),0);
});

test('valid device proof cannot broaden the current role or cross-team resource scope',async t=>{
 const f=await fixture(t),bound=await f.enroll();rejected(await f.protected('/api/teams/team-b/collection/tasks',{bound}),[404]);rejected(await f.protected('/api/teams/team-a/business-members',{bound}),[404]);const current=await f.protected('/api/teams/team-a/collection/tasks',{bound});assert.equal(current.status,200);assert.equal(current.data.tasks.length,1);
});

test('repeated and concurrent request nonces are consumed once without repeating the dispatch',async t=>{
 const f=await fixture(t),bound=await f.enroll(),nonce=randomBytes(32).toString('base64url');const results=await Promise.all([f.protected('/api/teams/team-a/collection/tasks',{bound,nonce}),f.protected('/api/teams/team-a/collection/tasks',{bound,nonce})]);assert.equal(results.filter(result=>result.status===200).length,1);rejected(results.find(result=>result.status!==200),[409]);assert.equal(replayCount(f),1);
});

test('signature is checked before streaming a body, then actual bytes must match the signed hash',async t=>{
 const f=await fixture(t),bound=await f.enroll();let pulls=0,controller;const stream=new ReadableStream({start(value){controller=value;},pull(){pulls++;}},{highWaterMark:0}),template=f.proofRequest('/api/teams/team-a/collection/tasks/task-a/submissions',{bound,method:'POST',body:{revision:0}}),headers=new Headers(template.headers);headers.set('X-Shenyi-Device-Signature',randomBytes(64).toString('base64url'));rejected(await f.send(new Request(template.url,{method:'POST',headers,body:stream,duplex:'half'})),[403]);assert.equal(pulls,0);controller.close();rejected(await f.protected('/api/teams/team-a/collection/tasks/task-a/submissions',{bound,method:'POST',body:{revision:0},fields:{bodySha256:digest('different')}}),[403]);assert.equal(replayCount(f),0);
});

test('authenticated body is rebuilt byte-for-byte for the real upload parser and original digest',async t=>{
 const f=await fixture(t),bound=await f.enroll(),bytes=Buffer.from('Synthetic original\0\r\n原件'),body={revision:0,filename:'合成原件.bin',contentBase64:bytes.toString('base64')};const result=await f.protected('/api/teams/team-a/collection/tasks/task-a/submissions',{bound,method:'POST',body});assert.equal(result.status,201,result.raw);assert.equal(result.data.submission.sha256,digest(bytes));const attachment=await f.protected('/api/teams/team-a/collection/tasks/task-a/attachments/'+result.data.submission.attachmentId,{bound});assert.equal(attachment.status,200);assert.deepEqual(attachment.bytes,bytes);const head=await f.protected('/api/teams/team-a/collection/tasks/task-a/attachments/'+result.data.submission.attachmentId,{bound,method:'HEAD'});assert.equal(head.status,200);assert.equal(head.bytes.length,0);
});

test('oversized signed body is bounded at 17 MiB and never reaches a business mutation',async t=>{
 const f=await fixture(t),bound=await f.enroll();const result=await f.protected('/api/teams/team-a/collection/tasks/task-a/submissions',{bound,method:'POST',rawBody:Buffer.alloc(17*1024*1024+1,32)});rejected(result,[413]);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_task_submissions').get().n,0);assert.equal(replayCount(f),0);
});

test('new proof while an old signed body is held revokes its token before any upload can commit',async t=>{
 const f=await fixture(t),old=await f.enroll(),raw=Buffer.from(JSON.stringify({revision:0,filename:'synthetic.bin',contentBase64:Buffer.from('synthetic').toString('base64')})),template=f.proofRequest('/api/teams/team-a/collection/tasks/task-a/submissions',{bound:old,method:'POST',rawBody:raw}),seen=deferred();let controller;const body=new ReadableStream({start(value){controller=value;},pull(){seen.resolve();}},{highWaterMark:0}),pending=f.send(new Request(template.url,{method:'POST',headers:template.headers,body,duplex:'half'}));await seen.promise;const next=await f.prove(old);controller.enqueue(raw);controller.close();rejected(await pending,[401,409]);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_task_submissions').get().n,0);assert.equal((await f.protected('/api/teams/team-a/collection/tasks',{bound:next})).status,200);
});

test('natural lease expiry during real password KDF is also an auth-session expiry before final commit',async t=>{
 const f=await fixture(t),bound=await f.enroll(),before=f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='intern-a'").get(),hit=duringPassword(t,f,()=>{f.now=bound.session.lease.expiresAt;});const result=await f.protected('/api/auth/password',{bound,method:'POST',body:{currentPassword:PASSWORD,newPassword:'DeviceReplacement!2026'}});rejected(result,[401]);assert.equal(hit(),true);assert.deepEqual(f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='intern-a'").get(),before);
});

test('replacing a lease while real password KDF is pending cannot let its old authenticated token commit',async t=>{
 const f=await fixture(t),old=await f.enroll(),bootstrap=f.issueSession('intern-a'),challenge=await f.challenge('prove',{key:old.key,token:bootstrap}),before=f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='intern-a'").get();let rotated;
 const hit=duringPassword(t,f,()=>{rotated=f.complete(challenge);});const result=await f.protected('/api/auth/password',{bound:old,method:'POST',body:{currentPassword:PASSWORD,newPassword:'DeviceReplacement!2026'}});assert.ok(rotated);assert.equal((await rotated).status,200);rejected(result,[401]);assert.equal(hit(),true);assert.deepEqual(f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='intern-a'").get(),before);
});

test('missing stable server metadata with any device history cannot create another server identity',async t=>{
 const f=await fixture(t);await f.challenge('enroll');f.db.prepare("DELETE FROM team_database_metadata WHERE name='device-server-id'").run();const {ensureDeviceServerId}=await source('device-policy.mjs');assert.throws(()=>ensureDeviceServerId(f.db));assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_database_metadata WHERE name='device-server-id'").get().n,0);
});

test('revocation at the maximum binding revision fails atomically instead of overflowing history',async t=>{
 const f=await fixture(t),bound=await f.enroll(),bootstrap=f.issueSession('intern-a');f.db.prepare('UPDATE team_device_bindings SET revision=? WHERE device_id=?').run(Number.MAX_SAFE_INTEGER,bound.session.device.id);const before=state(f);rejected(await f.call('/api/auth/devices/revocation-challenges',{token:bootstrap,method:'POST',body:{publicKey:bound.key.encoded,revision:Number.MAX_SAFE_INTEGER,currentPassword:PASSWORD}}),[409]);assert.deepEqual(state(f),before);
});

test('diagnostic mode is explicit legacy behavior and never disables cryptographic checks on device endpoints',async t=>{
 const f=await fixture(t,{strict:false});assert.equal((await f.call('/api/teams/team-a/collection/tasks',{token:f.tokens['intern-a']})).status,200);const c=await f.challenge('enroll');rejected(await f.complete(c,{key:keyPair()}),[403]);assert.equal(bindingCount(f),0);f.providers.deviceProofRequired=true;rejected(await f.call('/api/teams/team-a/collection/tasks',{token:f.tokens['intern-a'],headers:{'X-Shenyi-Offline-License':'true','X-Shenyi-Device-Proof-Required':'false'}}),[403]);
});

test('database uniqueness and immutable lease context defend against a second active binding or lease',async t=>{
 const f=await fixture(t),bound=await f.enroll(),key=keyPair();assert.throws(()=>f.db.prepare("INSERT INTO team_device_bindings(device_id,user_id,public_key,key_fingerprint,display_name,platform,status,revision,bound_at) VALUES (?,'intern-a',?,?,'Synthetic duplicate','darwin','active',1,?)").run(randomUUID(),key.encoded,key.fingerprint,f.now),/UNIQUE/);
 const otherToken=f.issueSession('intern-a');assert.throws(()=>f.db.prepare("INSERT INTO team_device_leases(lease_id,user_id,device_id,binding_revision,auth_session_hash,token_hash,created_at,expires_at) VALUES (?,'intern-a',?,1,?,?,?,?)").run(randomUUID(),bound.session.device.id,digest(otherToken),digest(randomBytes(32)),f.now,f.now+900000),/UNIQUE/);assert.equal(bindingCount(f),1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_leases WHERE revoked_at IS NULL').get().n,1);
});

test('lease storage failure after new-session issuance restores the prior proved token and unconsumed challenge',async t=>{
 const f=await fixture(t),bound=await f.enroll(),bootstrap=f.issueSession('intern-a'),challenge=await f.challenge('prove',{key:bound.key,token:bootstrap});f.db.exec("CREATE TRIGGER synthetic_lease_failure BEFORE INSERT ON team_device_leases BEGIN SELECT RAISE(ABORT,'synthetic event failure'); END");const before=state(f);rejected(await f.complete(challenge),[503]);assert.deepEqual(state(f),before);assert.equal((await f.protected('/api/teams/team-a/collection/tasks',{bound})).status,200);
});

test('active replay metadata is bounded and revoked old-lease rows are pruned on the next valid request',async t=>{
 const f=await fixture(t),old=await f.enroll();const insert=f.db.prepare('INSERT INTO team_device_request_replays VALUES (?,?,?)');for(let index=0;index<2048;index++)insert.run(old.session.lease.id,digest('synthetic-nonce-'+index),f.now);rejected(await f.protected('/api/teams/team-a/collection/tasks',{bound:old}),[429]);assert.equal(replayCount(f),2048);const next=await f.prove(old);assert.equal((await f.protected('/api/teams/team-a/collection/tasks',{bound:next})).status,200);assert.equal(replayCount(f),1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_request_replays WHERE lease_id=?').get(old.session.lease.id).n,0);
});

test('a valid-device user rate window closes before consuming any new nonce beyond its quota',async t=>{
 const f=await fixture(t),bound=await f.enroll();f.db.prepare('INSERT INTO team_auth_limits VALUES (?,?,?)').run('device-request:'+digest('intern-a'),f.now,120);rejected(await f.protected('/api/teams/team-a/collection/tasks',{bound}),[429]);assert.equal(replayCount(f),0);
});

test('the actual 121st correctly signed request is still rate limited after moving user quota behind verification',async t=>{
 const f=await fixture(t),bound=await f.enroll();for(let index=0;index<120;index++)assert.equal((await f.protected('/api/teams/team-a/collection/tasks',{bound})).status,200);rejected(await f.protected('/api/teams/team-a/collection/tasks',{bound}),[429]);assert.equal(replayCount(f),120);
});

test('a copied bearer and lease without the private key cannot exhaust the real device user request quota',async t=>{
 const f=await fixture(t),bound=await f.enroll(),wrong=keyPair();for(let index=0;index<120;index++)rejected(await f.protected('/api/teams/team-a/collection/tasks',{bound,key:wrong}),[403]);
 const legitimate=await f.protected('/api/teams/team-a/collection/tasks',{bound});assert.equal(legitimate.status,200,'invalid signatures must not consume the proved user quota');assert.equal(replayCount(f),1);
});

test('canonical low-order public encodings cannot register by a universal identity-point signature',async t=>{
 const f=await fixture(t),prefix=Buffer.from('302a300506032b6570032100','hex'),forged=Buffer.alloc(64);forged[0]=1;
 for(const point of [Buffer.alloc(32),Buffer.concat([Buffer.from([1]),Buffer.alloc(31)])]){
  const der=Buffer.concat([prefix,point]),key={encoded:der.toString('base64url'),fingerprint:digest(der)};assert.equal(createPublicKey({key:der,format:'der',type:'spki'}).asymmetricKeyType,'ed25519');const challenge=await f.challenge('enroll',{key});
  for(let attempt=0;attempt<5;attempt++)rejected(await f.call('/api/auth/devices/enroll',{token:challenge.token,method:'POST',body:{challengeId:challenge.fields.challengeId,signature:forged.toString('base64url')}}),[403]);
  rejected(await f.call('/api/auth/devices/enroll',{token:challenge.token,method:'POST',body:{challengeId:challenge.fields.challengeId,signature:forged.toString('base64url')}}),[409]);
 }
 assert.equal(bindingCount(f),0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_leases').get().n,0);
});
