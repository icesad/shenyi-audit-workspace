'use strict';
// Independent M4A acceptance: isolated real SQLite/application, real scrypt and
// separately encoded Ed25519 proofs. Synthetic identities/files/dialogs only;
// not an OS-picker, real-provider, Mac, customer-data or production acceptance.
const nodeTest=require('node:test'),assert=require('node:assert/strict');
const test=(name,run)=>nodeTest(name,{timeout:20000},run);
const {DatabaseSync}=require('node:sqlite');
const {createHash,generateKeyPairSync,randomUUID,randomBytes,sign}=require('node:crypto');
const crypto=require('node:crypto'),{syncBuiltinESMExports}=require('node:module');
// Preserve real native scrypt work, but permit a deterministic hold of exactly
// one callback delivery to exercise final authorization after an old KDF.
const nativeScrypt=crypto.scrypt;let kdfHold=null;
crypto.scrypt=function(...args){const callback=args.pop(),hold=kdfHold;if(hold)kdfHold=null;return nativeScrypt(...args,(error,result)=>{if(!hold)return callback(error,result);hold.entered.resolve();void hold.release.promise.then(()=>callback(error,result));});};
syncBuiltinESMExports();nodeTest.after(()=>{crypto.scrypt=nativeScrypt;syncBuiltinESMExports();});
const {pathToFileURL}=require('node:url'),path=require('node:path'),fs=require('node:fs/promises');
const {createTeamClient}=require('../desktop/team-client.cjs');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-15T20:00:00Z'),PASSWORD='RoleSynthetic!2026',ORIGIN='http://127.0.0.1:8774';
const ACCESS='/api/auth/business-role-management/access',LIST='/api/teams/team-a/business-role-members';
const TASKS='/api/teams/team-a/collection/tasks';
const ROLES=['intern','assistant','manager','partner'];
const CF=['purpose','serverId','userId','sessionBinding','keyFingerprint','identityEpoch','bindingRevision','approvalRequestId','challengeId','nonce','issuedAt','expiresAt'];
const RF=['serverId','userId','sessionBinding','deviceId','bindingRevision','leaseId','method','pathAndQuery','bodySha256','nonce'];
const XF=['purpose','serverId','userId','sessionBinding','keyFingerprint','identityEpoch','oldDeviceId','oldBindingRevision','oldBindingStatus','requestId','requestRevision','challengeId','nonce','issuedAt','expiresAt'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const bytes=(domain,fields,keys)=>Buffer.concat([Buffer.from(domain+'\0v1\0','ascii'),Buffer.from(JSON.stringify(keys.map(key=>fields[key])),'utf8')]);
const challengeBytes=fields=>bytes('SHENYI-DEVICE-PROOF',fields,CF);
const requestBytes=fields=>bytes('SHENYI-DEVICE-REQUEST',fields,RF);
const replacementBytes=fields=>bytes('SHENYI-DEVICE-REPLACEMENT',fields,XF);
const pair=()=>{const key=generateKeyPairSync('ed25519'),der=key.publicKey.export({format:'der',type:'spki'});return {...key,encoded:der.toString('base64url'),fingerprint:digest(der)};};
const deferred=()=>{let resolve;return {promise:new Promise(done=>resolve=done),resolve};};
const ok=(r,statuses=[200,201])=>{assert.ok(statuses.includes(r.status),r.status+' '+r.raw);return r;};
const deny=(r,statuses=[400,401,403,404,409])=>{assert.ok(statuses.includes(r.status),r.status+' '+r.raw);assert.doesNotMatch(r.raw,/password_hash|token_hash|scrypt\$|SQLITE|Synthetic injected|private-provider/);return r;};
const rolePath=(user='intern-a',team='team-a')=>'/api/teams/'+team+'/business-role-members/'+user+'/role';
const reviewers={team_platform_reviewers:'team.provision',team_recovery_reviewers:'account.recover',team_access_reviewers:'member.disable',team_device_replacement_reviewers:'device.replace'};
let encodedPassword;
async function fixture(t){
 const [{initializeTeamDatabase},{hashPassword},{issueSession},{handleTeamApplicationRequest}]=await Promise.all([source('database.mjs'),source('passwords.mjs'),source('auth-api.mjs'),source('application-api.mjs')]);
 encodedPassword||=hashPassword(PASSWORD);const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);t.after(()=>db.close());
 for(const user of ['tech-a','tech-b','intern-a','assistant-a','manager-a','partner-a','intern-b','orphan','provision-owner','recovery-owner','access-owner','device-owner']){db.prepare("INSERT INTO team_users VALUES (?,'active')").run(user);db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(user,user,'Synthetic '+user,await encodedPassword);}
 for(const team of ['a','b']){db.prepare("INSERT INTO teams VALUES (?,'active')").run('team-'+team);db.prepare('INSERT INTO team_profiles VALUES (?,?)').run('team-'+team,'Synthetic '+team);db.prepare("INSERT INTO team_operators VALUES (?,?,'administrator','active')").run('team-'+team,'tech-'+team);db.prepare("INSERT INTO team_projects(team_id,project_id,title,financial_summary,structure_json,status) VALUES (?,?,?,?,?,'active')").run('team-'+team,'project-'+team,'Private synthetic project','PRIVATE-FINANCE','PRIVATE-TREE');}
 for(const role of ROLES)db.prepare("INSERT INTO team_memberships VALUES ('team-a',?,?,'active')").run(role+'-a',role);
 db.prepare("INSERT INTO team_memberships VALUES ('team-b','intern-b','intern','active')").run();
 for(const [table,permission]of Object.entries(reviewers))db.prepare('INSERT INTO '+table+'(user_id,permission,status) VALUES (?,?,?)').run({'team_platform_reviewers':'provision-owner','team_recovery_reviewers':'recovery-owner','team_access_reviewers':'access-owner','team_device_replacement_reviewers':'device-owner'}[table],permission,'active');
 for(const task of ['task-a','task-second']){db.prepare("INSERT INTO team_collection_tasks(team_id,task_id,project_id,title,instructions,status) VALUES ('team-a',?,'project-a',?,'Synthetic only','open')").run(task,task);db.prepare("INSERT INTO team_task_assignments VALUES ('team-a',?,'intern-a','active')").run(task);}
 db.prepare("INSERT INTO team_phone_credentials VALUES ('intern-a','+8613800138000',?,1)").run(NOW-1000);
 db.prepare("INSERT INTO team_wechat_identities VALUES ('wx0123456789abcdef','synthetic-role-open','intern-a',?)").run(NOW-1000);
 const sent=[],f={db,now:NOW,actors:new Map(),calls:[],sent,providers:{deviceProofRequired:true,reviewedRecovery:true,phonePepper:Buffer.alloc(32,11),sms:{send:async value=>sent.push({...value})},wechat:{appId:'wx0123456789abcdef',redirectUri:'https://auth.synthetic.invalid/api/auth/wechat/callback',createAuthorizationUrl({state,redirectUri}){return 'https://open.weixin.qq.com/connect/qrconnect?'+new URLSearchParams({appid:'wx0123456789abcdef',redirect_uri:redirectUri,response_type:'code',scope:'snsapi_login',state})+'#wechat_redirect';},exchangeCode:async()=>({appId:'wx0123456789abcdef',openId:'synthetic-role-open'})}}};
 f.bootstrap=user=>issueSession(db,user,f.now).token;
 f.request=(route,{token,method='GET',body,rawBody,headers={}}={})=>new Request(ORIGIN+route,{method,headers:{Origin:'shenyi://app',...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined||rawBody!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined||rawBody!==undefined?{body:rawBody===undefined?JSON.stringify(body):rawBody,...(rawBody instanceof ReadableStream?{duplex:'half'}:{})}:{})});
 f.send=async request=>{const response=await handleTeamApplicationRequest(request,{db,now:()=>f.now,identityProviders:f.providers});assert.ok(response);const rawBytes=Buffer.from(await response.arrayBuffer()),raw=rawBytes.toString('utf8'),data=rawBytes.length&&response.headers.get('content-type')?.startsWith('application/json')?JSON.parse(raw):null;f.calls.push({method:request.method,path:new URL(request.url).pathname,status:response.status});return {status:response.status,headers:response.headers,bytes:rawBytes,raw,data};};
 f.call=(route,options)=>f.send(f.request(route,options));
 f.transport=async(url,settings={})=>{let response=await handleTeamApplicationRequest(new Request(url,settings),{db,now:()=>f.now,identityProviders:f.providers});assert.ok(response);f.calls.push({method:settings.method||'GET',path:new URL(url).pathname,status:response.status});if(f.transportAfter){const next=await f.transportAfter(new URL(url).pathname,response,settings);if(next!==undefined)response=next;}return response;};
 f.bound=async(user='tech-a',key=pair())=>{if(f.actors.has(user))return f.actors.get(user);const token=f.bootstrap(user),challenge=ok(await f.call('/api/auth/devices/enrollment-challenges',{token,method:'POST',body:{publicKey:key.encoded,displayName:'Synthetic '+user,platform:'win32',currentPassword:PASSWORD}})).data.challenge;const session=ok(await f.call('/api/auth/devices/enroll',{token,method:'POST',body:{challengeId:challenge.challengeId,signature:sign(null,challengeBytes(challenge),key.privateKey).toString('base64url')}})).data;const actor={user,key,session};f.actors.set(user,actor);return actor;};
 f.prove=async(user,key)=>{const token=f.bootstrap(user),challenge=ok(await f.call('/api/auth/devices/proof-challenges',{token,method:'POST',body:{publicKey:key.encoded}})).data.challenge;const session=ok(await f.call('/api/auth/devices/prove',{token,method:'POST',body:{challengeId:challenge.challengeId,signature:sign(null,challengeBytes(challenge),key.privateKey).toString('base64url')}})).data;const actor={user,key,session};f.actors.set(user,actor);return actor;};
 f.signed=(route,{actor,method='GET',body,rawBody,serialized,headers={},nonce=randomBytes(32).toString('base64url')}={})=>{const input=Buffer.from(serialized??(rawBody===undefined?(body===undefined?'':JSON.stringify(body)):rawBody)),s=actor.session,url=new URL(ORIGIN+route),fields={serverId:s.lease.serverId,userId:actor.user,sessionBinding:digest(s.token),deviceId:s.device.id,bindingRevision:s.device.revision,leaseId:s.lease.id,method,pathAndQuery:url.pathname+url.search,bodySha256:digest(input),nonce};return f.request(route,{token:s.token,method,...(body!==undefined?{body}:{}),...(rawBody!==undefined?{rawBody}:{}),headers:{'X-Shenyi-Device-Lease':s.lease.token,'X-Shenyi-Device-Nonce':nonce,'X-Shenyi-Device-Body-SHA256':fields.bodySha256,'X-Shenyi-Device-Signature':sign(null,requestBytes(fields),actor.key.privateKey).toString('base64url'),...headers}});};
 f.protected=(route,options)=>f.send(f.signed(route,options));
 f.change=async({actor,user='intern-a',team='team-a',role='manager',revision=epoch(f,user),password=PASSWORD,extra={}}={})=>{actor??=await f.bound();return f.protected(rolePath(user,team),{actor,method:'POST',body:{revision,role,currentPassword:password,...extra}});};
 f.rows=table=>{const statement=db.prepare('SELECT * FROM "'+table.replaceAll('"','""')+'"');statement.setReadBigInts(true);return statement.all().map(row=>JSON.stringify(Object.keys(row).sort().map(key=>[key,row[key] instanceof Uint8Array?['blob',Buffer.from(row[key]).toString('base64')]:typeof row[key]==='bigint'?['int',String(row[key])]:row[key]]))).sort();};
 f.snapshot=()=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('team_auth_limits','team_device_request_replays') ORDER BY name").all().map(({name})=>[name,f.rows(name)]));
 return f;
}
const epoch=(f,user='intern-a')=>Number(f.db.prepare('SELECT CAST(version AS TEXT) version FROM team_recovery_identity_epochs WHERE user_id=?').get(user)?.version??0);
const currentRole=(f,user='intern-a')=>f.db.prepare('SELECT role FROM team_memberships WHERE user_id=?').get(user)?.role;
const eventCount=f=>f.db.prepare('SELECT COUNT(*) n FROM team_business_role_events').get().n;
const testNoChange=async(f,action,statuses)=>{const before=f.snapshot(),result=await action();deny(result,statuses);assert.deepEqual(f.snapshot(),before);return result;};

test('new role routes require actual strict device proof even with the diagnostic device flag disabled',async t=>{
 const f=await fixture(t),actor=await f.bound();f.providers.deviceProofRequired=false;
 for(const [route,method,body]of [[ACCESS,'GET'],[LIST,'GET'],[rolePath(),'POST',{revision:epoch(f),role:'manager',currentPassword:PASSWORD}]]){const before=f.snapshot();deny(await f.call(route,{token:actor.session.token,method,body}),[403]);assert.deepEqual(f.snapshot(),before);}
 assert.equal(currentRole(f),'intern');assert.equal(eventCount(f),0);
});

test('bootstrap auth, forged identity headers and copied lease metadata cannot replace a real signed business session',async t=>{
 const f=await fixture(t),actor=await f.bound(),token=f.bootstrap('tech-a');
 for(const route of [ACCESS,LIST]){deny(await f.call(route,{token,headers:{'X-Shenyi-Device-Lease':actor.session.lease.token,'X-User-Id':'tech-a','X-Team-Role':'administrator'}}),[403]);}
 const request=f.signed(LIST,{actor});request.headers.set('Authorization','Bearer '+token);deny(await f.send(request),[403]);assert.equal(eventCount(f),0);
});

for(const user of ['intern-a','assistant-a','manager-a','partner-a','tech-b','provision-owner','recovery-owner','access-owner','device-owner'])test(user+' cannot inherit another team administrator role-changing authority',async t=>{
 const f=await fixture(t),actor=await f.bound(user);await testNoChange(f,()=>f.change({actor,user:'assistant-a',role:'partner'}),[404]);const list=await f.protected(LIST,{actor});deny(list,[404]);const access=ok(await f.protected(ACCESS,{actor}));assert.ok(!access.data.teams.some(team=>team.teamId==='team-a'));
});

for(const [table,permission]of Object.entries(reviewers))for(const state of ['active','revoked'])test('target with '+state+' historical '+table+' is protected from ordinary role management',async t=>{
 const f=await fixture(t),actor=await f.bound();f.db.prepare('INSERT INTO '+table+'(user_id,permission,status) VALUES (?,?,?)').run('intern-a',permission,state);await testNoChange(f,()=>f.change({actor}),[404]);const list=ok(await f.protected(LIST,{actor}));assert.ok(!list.data.members.some(member=>member.id==='intern-a'));
});

for(const kind of ['self','foreign-member','operator-active','operator-revoked','other-history-member','disabled-member','disabled-account','disabled-team'])test('ordinary target eligibility rejects '+kind+' without mutation',async t=>{
 const f=await fixture(t),actor=await f.bound();let user='intern-a';
 if(kind==='self')user='tech-a';if(kind==='foreign-member')user='intern-b';
 if(kind==='operator-active'||kind==='operator-revoked')f.db.prepare("INSERT INTO team_operators VALUES ('team-a','intern-a','administrator',?)").run(kind==='operator-active'?'active':'revoked');
 if(kind==='other-history-member')f.db.prepare("INSERT INTO team_memberships VALUES ('team-b','intern-a','assistant','disabled')").run();
 if(kind==='disabled-member')f.db.prepare("UPDATE team_memberships SET status='disabled' WHERE user_id='intern-a'").run();
 if(kind==='disabled-account')f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='intern-a'").run();
 if(kind==='disabled-team')f.db.prepare("UPDATE teams SET status='disabled' WHERE team_id='team-a'").run();
 await testNoChange(f,()=>f.change({actor,user}),kind==='disabled-team'?[403,404,409]:[404]);
});

test('wrong password, same role and stale target epoch do not alter roles, scopes or audit',async t=>{
 const f=await fixture(t),actor=await f.bound();await testNoChange(f,()=>f.change({actor,password:'SyntheticWrong!2026'}),[403]);await testNoChange(f,()=>f.change({actor,role:'intern'}),[409]);await testNoChange(f,()=>f.change({actor,revision:epoch(f)-1}),[409]);
});

test('strict origin, unknown fields, malformed query and HEAD keep fixed private error boundaries',async t=>{
 const f=await fixture(t),actor=await f.bound();
 for(const extra of [{userId:'partner-a'},{teamId:'team-b'},{confirmed:true},{token:'synthetic-secret'},{permission:'collection.manage'}])await testNoChange(f,()=>f.change({actor,extra}),[400]);
 for(const query of ['?role=partner','?limit=51','?q=a&q=b','?after=not%2Fa%2Fcursor'])deny(await f.protected(LIST+query,{actor}),[400]);
 const cross=f.signed(rolePath(),{actor,method:'POST',body:{role:'manager',revision:epoch(f),currentPassword:PASSWORD},headers:{Origin:'https://hostile.synthetic.invalid'}});deny(await f.send(cross),[403]);
 const head=await f.protected(LIST,{actor,method:'HEAD'});assert.equal(head.status,405);assert.equal(head.bytes.length,0);assert.equal(head.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(eventCount(f),0);
});

for(const beforeRole of ROLES)for(const afterRole of ROLES.filter(value=>value!==beforeRole))test(beforeRole+' to '+afterRole+' clears old scopes without disabling the employee or granting new authority',async t=>{
 const f=await fixture(t),actor=await f.bound(),user=beforeRole+'-a';
 f.db.prepare("INSERT INTO team_task_assignments VALUES ('team-a','task-a',?,'active') ON CONFLICT(team_id,task_id,user_id) DO UPDATE SET status='active'").run(user);
 for(const permission of ['collection.read','collection.manage'])f.db.prepare("INSERT INTO team_project_grants VALUES ('team-a','project-a',?,?,'active')").run(user,permission);
 f.db.prepare("INSERT INTO team_admin_grants VALUES ('team-a',?,'member.invite','active')").run(user);
 const target=await f.bound(user),binding=f.rows('team_device_bindings'),credentials=f.rows('team_credentials'),before=epoch(f,user),others=f.db.prepare('SELECT user_id,role,status FROM team_memberships WHERE user_id<>? ORDER BY user_id').all(user);
 const result=ok(await f.change({actor,user,role:afterRole,revision:before}));
 assert.deepEqual(Object.keys(result.data).sort(),['changed','revision','role']);assert.equal(result.data.changed,true);assert.equal(result.data.role,afterRole);assert.equal(result.data.revision,epoch(f,user));assert.ok(result.data.revision>before);
 assert.equal(currentRole(f,user),afterRole);assert.equal(f.db.prepare('SELECT status FROM team_users WHERE user_id=?').get(user).status,'active');assert.equal(f.db.prepare('SELECT status FROM team_memberships WHERE user_id=?').get(user).status,'active');
 assert.deepEqual(f.rows('team_device_bindings'),binding);assert.deepEqual(f.rows('team_credentials'),credentials);assert.deepEqual(f.db.prepare('SELECT user_id,role,status FROM team_memberships WHERE user_id<>? ORDER BY user_id').all(user),others);
 for(const table of ['team_task_assignments','team_project_grants','team_attachment_grants','team_admin_grants'])assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+table+" WHERE user_id=? AND status='active'").get(user).n,0,table);
 assert.equal(f.db.prepare("SELECT revision FROM team_task_versions WHERE task_id='task-a'").get().revision,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_sessions WHERE user_id=? AND revoked_at IS NULL').get(user).n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_leases WHERE user_id=? AND revoked_at IS NULL').get(user).n,0);
 deny(await f.protected(TASKS,{actor:target}),[401]);
 const fresh=await f.prove(user,target.key);assert.deepEqual(fresh.session.memberships,[{teamId:'team-a',role:afterRole}]);assert.deepEqual(ok(await f.protected(TASKS,{actor:fresh})).data.tasks,[]);assert.deepEqual(ok(await f.protected(ACCESS,{actor:fresh})).data,{teams:[]});
 const event=f.db.prepare('SELECT * FROM team_business_role_events').get();assert.deepEqual(Object.keys(event).sort(),['event_id','team_id','actor_id','target_user_id','before_role','after_role','before_revision','after_revision','created_at'].sort());assert.equal(event.actor_id,'tech-a');assert.equal(event.team_id,'team-a');assert.equal(event.target_user_id,user);assert.equal(event.before_role,beforeRole);assert.equal(event.after_role,afterRole);assert.equal(event.before_revision,before);assert.equal(event.after_revision,result.data.revision);assert.equal(event.created_at,NOW);assert.equal(eventCount(f),1);
});

test('role adjustment preserves original bytes, full submission history, identity mappings, device key and unrelated assignees',async t=>{
 const f=await fixture(t),actor=await f.bound(),target=await f.bound('intern-a'),original=Buffer.from('Synthetic role original\0\r\n原件，非客户资料');
 const upload=ok(await f.protected(TASKS+'/task-a/submissions',{actor:target,method:'POST',body:{filename:'synthetic-role.bin',contentBase64:original.toString('base64'),revision:0}})).data;
 f.db.prepare("INSERT INTO team_task_assignments VALUES ('team-a','task-a','assistant-a','active')").run();
 const kept=['team_users','team_credentials','team_phone_credentials','team_wechat_identities','team_device_bindings','team_task_submissions','team_collection_attachments','team_collection_tasks','team_projects','teams','team_profiles'];const before=Object.fromEntries(kept.map(table=>[table,f.rows(table)]));
 ok(await f.change({actor,role:'partner'}));assert.deepEqual(Object.fromEntries(kept.map(table=>[table,f.rows(table)])),before);
 const attachment=f.db.prepare('SELECT bytes FROM team_collection_attachments WHERE attachment_id=?').get(upload.submission.attachmentId);assert.deepEqual(Buffer.from(attachment.bytes),original);assert.equal(digest(attachment.bytes),upload.submission.sha256);assert.equal(upload.submission.byteLength,original.length);
 assert.equal(f.db.prepare("SELECT revision FROM team_task_versions WHERE task_id='task-a'").get().revision,2);assert.equal(f.db.prepare("SELECT revision FROM team_task_versions WHERE task_id='task-second'").get().revision,1);assert.equal(f.db.prepare("SELECT status FROM team_task_assignments WHERE user_id='assistant-a'").get().status,'active');
 const fresh=await f.prove('intern-a',target.key);deny(await f.protected(TASKS+'/task-a/attachments/'+upload.submission.attachmentId,{actor:fresh}),[404]);assert.equal((await f.protected(LIST,{actor})).status,200);
});

test('SQL scopes foreign and protected members before pagination, returns only minimal DTOs and keeps scoped cursors opaque',async t=>{
 const f=await fixture(t),actor=await f.bound();
 for(let i=0;i<600;i++){const id='aa-foreign-'+String(i).padStart(4,'0');f.db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);f.db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(id,id,'FOREIGN PRIVATE '+i,await encodedPassword);f.db.prepare("INSERT INTO team_memberships VALUES ('team-b',?,'partner','active')").run(id);}
 for(let i=0;i<6;i++){const id='ab-protected-'+i;f.db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);f.db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(id,id,'PROTECTED PRIVATE '+i,await encodedPassword);f.db.prepare("INSERT INTO team_memberships VALUES ('team-a',?,'manager','active')").run(id);f.db.prepare("INSERT INTO team_access_reviewers(user_id,permission,status) VALUES (?,'member.disable','revoked')").run(id);}
 const prepare=f.db.prepare,materialized=[];f.db.prepare=function(sql){const statement=prepare.call(this,sql);if(/^SELECT/i.test(sql.trim())){const all=statement.all;statement.all=function(...args){const rows=all.apply(this,args);materialized.push(rows.length);return rows;};}return statement;};t.after(()=>f.db.prepare=prepare);
 const first=ok(await f.protected(LIST+'?limit=2',{actor}));assert.equal(first.data.members.length,2);assert.equal(first.data.hasMore,true);assert.deepEqual(first.data.members.map(row=>row.id),['assistant-a','intern-a']);assert.ok(materialized.length>0);assert.ok(materialized.every(n=>n<=3),'No foreign/protected candidates may be materialized then filtered');
 for(const member of first.data.members){assert.deepEqual(Object.keys(member).sort(),['id','displayName','role','status','revision'].sort());assert.equal(member.status,'active');assert.ok(Number.isSafeInteger(member.revision));}
 assert.doesNotMatch(first.raw,/FOREIGN|PROTECTED|PRIVATE-FINANCE|PRIVATE-TREE|phone|password|token|project/i);
 const next=ok(await f.protected(LIST+'?limit=2&after=intern-a',{actor}));assert.deepEqual(next.data.members.map(row=>row.id),['manager-a','partner-a']);assert.equal(next.data.hasMore,false);
 const foreign=deny(await f.protected(LIST+'?limit=2&after=aa-foreign-0000',{actor}),[404]),unknown=deny(await f.protected(LIST+'?limit=2&after=missing-member',{actor}),[404]);assert.equal(foreign.raw,unknown.raw);
});

test('member search treats SQL wildcards literally and cannot use an out-of-search cursor',async t=>{
 const f=await fixture(t),actor=await f.bound();f.db.prepare("UPDATE team_credentials SET display_name=? WHERE user_id='intern-a'").run('Literal %_\\ name');
 const q=new URLSearchParams({q:'%_\\',limit:'1'});const result=ok(await f.protected(LIST+'?'+q,{actor}));assert.deepEqual(result.data.members.map(row=>row.id),['intern-a']);assert.equal(result.data.hasMore,false);
 deny(await f.protected(LIST+'?'+new URLSearchParams({q:'%_\\',after:'assistant-a'}),{actor}),[404]);
});

function onPassword(t,f,mutate){const prepare=f.db.prepare;let fired=false;f.db.prepare=function(sql){const statement=prepare.call(this,sql);if(/^INSERT INTO team_auth_limits/.test(sql)){const run=statement.run;statement.run=function(...args){const result=run.apply(this,args);if(!fired&&String(args[0]).startsWith('business-role:')){fired=true;queueMicrotask(mutate);}return result;};}return statement;};t.after(()=>f.db.prepare=prepare);return ()=>fired;}
function onFinalTransaction(t,f,mutate){const exec=f.db.exec;let count=0,fired=false;f.db.exec=function(sql){if(/^BEGIN IMMEDIATE/.test(sql)&&++count===2){fired=true;mutate();}return exec.call(this,sql);};t.after(()=>f.db.exec=exec);return ()=>fired;}
const races={
 'actor operator ABA':f=>{f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='tech-a'").run();f.db.prepare("UPDATE team_operators SET status='active' WHERE user_id='tech-a'").run();},
 'actor credential ABA':f=>{const row=f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='tech-a'").get();f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='tech-a'").run();f.db.prepare("UPDATE team_credentials SET password_hash=?,revision=? WHERE user_id='tech-a'").run(row.password_hash,row.revision);},
 'target role ABA':f=>{f.db.prepare("UPDATE team_memberships SET role='manager' WHERE user_id='intern-a'").run();f.db.prepare("UPDATE team_memberships SET role='intern' WHERE user_id='intern-a'").run();},
 'target credential ABA':f=>{const row=f.db.prepare("SELECT password_hash,revision FROM team_credentials WHERE user_id='intern-a'").get();f.db.prepare("UPDATE team_credentials SET revision=revision+1 WHERE user_id='intern-a'").run();f.db.prepare("UPDATE team_credentials SET password_hash=?,revision=? WHERE user_id='intern-a'").run(row.password_hash,row.revision);},
 'team disable and restore':f=>{f.db.prepare("UPDATE teams SET status='disabled' WHERE team_id='team-a'").run();f.db.prepare("UPDATE teams SET status='active' WHERE team_id='team-a'").run();},
 'actor session revocation':f=>f.db.prepare("UPDATE team_sessions SET revoked_at=? WHERE user_id='tech-a'").run(f.now),
 'target reviewer history':f=>f.db.prepare("INSERT INTO team_device_replacement_reviewers(user_id,permission,status) VALUES ('intern-a','device.replace','revoked')").run(),
 'target other-team history':f=>f.db.prepare("INSERT INTO team_memberships VALUES ('team-b','intern-a','assistant','disabled')").run(),
 'target disabled':f=>f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='intern-a'").run(),
};
for(const phase of ['KDF','final BEGIN'])for(const [name,mutate]of Object.entries(races))test(name+' during '+phase+' refuses the old role action without partial effects',async t=>{
 const f=await fixture(t),actor=await f.bound();let expected;const fired=(phase==='KDF'?onPassword:onFinalTransaction)(t,f,()=>{mutate(f);expected=f.snapshot();});
 deny(await f.change({actor}),[401,403,404,409]);assert.equal(fired(),true);assert.deepEqual(f.snapshot(),expected);assert.equal(eventCount(f),0);assert.equal(currentRole(f),'intern');
});

test('role action held in the signed body rejects target revision ABA rather than accepting restored role text',async t=>{
 const f=await fixture(t),actor=await f.bound(),body=JSON.stringify({revision:epoch(f),role:'manager',currentPassword:PASSWORD}),entered=deferred();let controller;
 const stream=new ReadableStream({start(value){controller=value;},pull(){entered.resolve();}},{highWaterMark:0});const pending=f.send(f.signed(rolePath(),{actor,method:'POST',rawBody:stream,serialized:body}));await entered.promise;races['target role ABA'](f);const before=f.snapshot();controller.enqueue(Buffer.from(body));controller.close();deny(await pending,[409]);assert.deepEqual(f.snapshot(),before);
});

for(const value of [Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER-1,Number.MAX_SAFE_INTEGER+1,1.5])test('unsafe or exhausted identity epoch '+value+' rolls back role and all revocations',async t=>{
 const f=await fixture(t),actor=await f.bound();f.db.prepare('UPDATE team_recovery_identity_epochs SET version=? WHERE user_id=?').run(value,'intern-a');await testNoChange(f,()=>f.change({actor,revision:value}),[400,409]);assert.equal(currentRole(f),'intern');
});

test('the final representable epoch is returned exactly after a valid two-trigger role change',async t=>{
 const f=await fixture(t),actor=await f.bound(),before=Number.MAX_SAFE_INTEGER-2;f.db.prepare("UPDATE team_recovery_identity_epochs SET version=? WHERE user_id='intern-a'").run(before);const result=ok(await f.change({actor,revision:before}));assert.equal(result.data.revision,Number.MAX_SAFE_INTEGER);assert.equal(String(f.db.prepare("SELECT CAST(version AS TEXT) version FROM team_recovery_identity_epochs WHERE user_id='intern-a'").get().version),String(Number.MAX_SAFE_INTEGER));
});

for(const value of [Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,1.5])test('affected task version '+value+' rejects the entire role transaction',async t=>{
 const f=await fixture(t),actor=await f.bound();f.db.prepare("INSERT INTO team_task_versions VALUES ('team-a','task-second',?)").run(value);await testNoChange(f,()=>f.change({actor}),[409]);assert.equal(currentRole(f),'intern');
});

for(const fault of ['task-CAS','audit','grant-write'])test('forced '+fault+' failure atomically preserves role, sessions, leases and all old data',async t=>{
 const f=await fixture(t),actor=await f.bound();await f.bound('intern-a');
 if(fault==='task-CAS'){f.db.prepare("INSERT INTO team_task_versions VALUES ('team-a','task-a',0)").run();f.db.exec("CREATE TRIGGER synthetic_role_cas BEFORE UPDATE ON team_task_versions BEGIN SELECT RAISE(IGNORE); END");}
 if(fault==='audit')f.db.exec("CREATE TRIGGER synthetic_role_audit BEFORE INSERT ON team_business_role_events BEGIN SELECT RAISE(ABORT,'Synthetic injected private-provider audit error'); END");
 if(fault==='grant-write'){f.db.prepare("INSERT INTO team_project_grants VALUES ('team-a','project-a','intern-a','collection.read','active')").run();f.db.exec("CREATE TRIGGER synthetic_role_grant BEFORE UPDATE ON team_project_grants BEGIN SELECT RAISE(ABORT,'Synthetic injected private-provider grant error'); END");}
 await testNoChange(f,()=>f.change({actor}),fault==='task-CAS'?[409]:[503]);assert.equal(currentRole(f),'intern');assert.equal(eventCount(f),0);
});

test('a real old password KDF finishing after role adjustment cannot commit a credential mutation',async t=>{
 const f=await fixture(t),admin=await f.bound(),target=await f.bound('intern-a'),before=f.rows('team_credentials'),hold={entered:deferred(),release:deferred()};t.after(()=>hold.release.resolve());
 kdfHold=hold;const pending=f.protected('/api/auth/password',{actor:target,method:'POST',body:{currentPassword:PASSWORD,newPassword:'NeverCommittedNew!2026'}});await hold.entered.promise;
 ok(await f.change({actor:admin,role:'manager'}));hold.release.resolve();deny(await pending,[401]);assert.deepEqual(f.rows('team_credentials'),before);assert.equal(currentRole(f),'manager');assert.equal(eventCount(f),1);
});

test('a held old signed upload body cannot submit after role adjustment and no original is created',async t=>{
 const f=await fixture(t),admin=await f.bound(),target=await f.bound('intern-a'),raw=JSON.stringify({filename:'synthetic.bin',contentBase64:Buffer.from('synthetic').toString('base64'),revision:0}),entered=deferred();let controller;
 const body=new ReadableStream({start(value){controller=value;},pull(){entered.resolve();}},{highWaterMark:0}),pending=f.send(f.signed(TASKS+'/task-a/submissions',{actor:target,method:'POST',rawBody:body,serialized:raw}));await entered.promise;ok(await f.change({actor:admin}));controller.enqueue(Buffer.from(raw));controller.close();deny(await pending,[401,409]);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_task_submissions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_collection_attachments').get().n,0);
});

async function phoneResetChallenge(f,phone='+8613800138000'){
 const result=ok(await f.call('/api/auth/phone/challenges',{method:'POST',body:{phone,purpose:'reset'}}),[202]);return {...result.data,code:f.sent.find(value=>value.challengeId===result.data.challengeId).code};
}
async function reviewedRecovery(f,admin,status='approved'){
 const challenge=await phoneResetChallenge(f),request=ok(await f.call('/api/auth/recovery-requests',{method:'POST',body:{challengeId:challenge.challengeId,code:challenge.code}}),[201]).data;
 if(status==='pending')return {challenge,request};
 const approved=ok(await f.protected('/api/account/recovery-reviews/'+request.requestId+'/review',{actor:admin,method:'POST',body:{decision:'approve',revision:request.revision,currentPassword:PASSWORD}})).data;return {challenge,request,approved};
}

for(const state of ['pending','approved'])test('actual '+state+' recovery, SMS proof and old identity remain unusable after changing role',async t=>{
 const f=await fixture(t),admin=await f.bound(),recovery=await reviewedRecovery(f,admin,state),before=f.rows('team_credentials'),phones=f.rows('team_phone_credentials');
 ok(await f.change({actor:admin}));assert.equal(f.db.prepare('SELECT status FROM team_recovery_requests WHERE request_id=?').get(recovery.request.requestId).status,'revoked');const challenge=f.db.prepare('SELECT consumed_at,delivery_state FROM team_phone_challenges WHERE challenge_id=?').get(recovery.challenge.challengeId);assert.equal(challenge.consumed_at,NOW);assert.equal(challenge.delivery_state,'failed');
 if(recovery.approved){const rejected=deny(await f.call('/api/auth/phone/reset',{method:'POST',body:{challengeId:recovery.challenge.challengeId,code:recovery.challenge.code,recoveryProof:recovery.approved.recoveryProof,newPassword:'NeverRecoveredNew!2026'}}),[400]);assert.equal(rejected.data.error.code,'INVALID_CHALLENGE');}
 assert.deepEqual(f.rows('team_credentials'),before);assert.deepEqual(f.rows('team_phone_credentials'),phones);
});

test('MAX pending recovery revision rejects and rolls back the role transaction',async t=>{
 const f=await fixture(t),admin=await f.bound(),recovery=await reviewedRecovery(f,admin,'pending');f.db.prepare('UPDATE team_recovery_requests SET revision=? WHERE request_id=?').run(Number.MAX_SAFE_INTEGER,recovery.request.requestId);await testNoChange(f,()=>f.change({actor:admin}),[409]);
});

test('an actual ready WeChat login cannot exchange into a new session after the role change',async t=>{
 const f=await fixture(t),admin=await f.bound(),verifier='r'.repeat(43),started=ok(await f.call('/api/auth/wechat/transactions',{method:'POST',body:{codeChallenge:createHash('sha256').update(verifier).digest('base64url')}}),[201]).data;
 const state=new URL(started.authorizationUrl).searchParams.get('state');assert.equal((await f.send(new Request(f.providers.wechat.redirectUri+'?'+new URLSearchParams({state,code:'synthetic-provider-code'})))).status,200);assert.equal(f.db.prepare('SELECT status FROM team_wechat_transactions WHERE transaction_id=?').get(started.transactionId).status,'ready');
 const mappings=f.rows('team_wechat_identities');ok(await f.change({actor:admin}));assert.equal(f.db.prepare('SELECT status FROM team_wechat_transactions WHERE transaction_id=?').get(started.transactionId).status,'canceled');deny(await f.call('/api/auth/wechat/transactions/'+started.transactionId+'/exchange',{method:'POST',body:{pollToken:started.pollToken,codeVerifier:verifier}}),[404]);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_sessions WHERE user_id='intern-a' AND revoked_at IS NULL").get().n,0);assert.deepEqual(f.rows('team_wechat_identities'),mappings);
});

test('downgrade and later promotion with a fresh invite grant never resurrect legacy or phone invitation tickets',async t=>{
 const f=await fixture(t),admin=await f.bound(),manager=await f.bound('manager-a'),orphan=await f.bound('orphan'),phone='+8613800000099';f.db.prepare("INSERT INTO team_admin_grants VALUES ('team-a','manager-a','member.invite','active')").run();
 const legacy=ok(await f.protected('/api/teams/team-a/invitations',{actor:manager,method:'POST',body:{username:'orphan',role:'intern'}})).data;
 const invitation=ok(await f.protected('/api/teams/team-a/employee-invitations',{actor:manager,method:'POST',body:{phone,role:'assistant'}})).data;
 const activation=ok(await f.call('/api/auth/onboarding/challenges',{method:'POST',body:{invitationCode:invitation.invitationCode,phone}}),[202]).data;
 const other=ok(await f.protected('/api/teams/team-a/employee-invitations',{actor:admin,method:'POST',body:{phone:'+8613800000088',role:'intern'}})).data,otherBefore=f.db.prepare('SELECT * FROM team_operator_employee_invitations WHERE invitation_id=?').get(other.invitationId);
 ok(await f.change({actor:admin,user:'manager-a',role:'intern'}));ok(await f.change({actor:admin,user:'manager-a',role:'partner'}));f.db.prepare("UPDATE team_admin_grants SET status='active' WHERE user_id='manager-a'").run();const fresh=await f.prove('manager-a',manager.key);
 deny(await f.protected('/api/auth/invitations/accept',{actor:orphan,method:'POST',body:{invitationToken:legacy.invitationToken}}),[404]);deny(await f.call('/api/auth/onboarding/preview',{method:'POST',body:{invitationCode:invitation.invitationCode,phone}}),[404]);
 const proof=f.db.prepare('SELECT consumed_at,delivery_state FROM team_employee_activation_challenges WHERE challenge_id=?').get(activation.challengeId);assert.equal(proof.delivery_state,'failed');assert.equal(proof.consumed_at,null);assert.ok(f.db.prepare('SELECT revoked_at FROM team_employee_invitations WHERE invitation_id=?').get(invitation.invitationId).revoked_at!==null);
 assert.deepEqual(f.db.prepare('SELECT * FROM team_operator_employee_invitations WHERE invitation_id=?').get(other.invitationId),otherBefore);
 ok(await f.protected('/api/teams/team-a/invitations',{actor:fresh,method:'POST',body:{username:'orphan',role:'intern'}}));assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_memberships WHERE user_id='orphan'").get().n,0);assert.equal(eventCount(f),2);
});

async function replacement(f,admin,status='approved'){
 const old=await f.bound('intern-a'),key=pair(),token=f.bootstrap('intern-a'),challenge=ok(await f.call('/api/auth/device-replacements/request-challenges',{token,method:'POST',body:{publicKey:key.encoded,displayName:'Synthetic replacement',platform:'darwin',currentPassword:PASSWORD}}),[201]).data.challenge;
 let request=ok(await f.call('/api/auth/device-replacements/request',{token,method:'POST',body:{challengeId:challenge.challengeId,signature:sign(null,replacementBytes(challenge),key.privateKey).toString('base64url')}}),[201]).data.request;
 if(status==='approved')request=ok(await f.protected('/api/account/device-replacement-reviews/'+request.id+'/review',{actor:admin,method:'POST',body:{decision:'approve',revision:request.revision,currentPassword:PASSWORD}})).data.request;
 const kind=status==='approved'?'activate':'withdraw',pending=ok(await f.call('/api/auth/device-replacements/'+kind+'-challenges',{token,method:'POST',body:{requestId:request.id,revision:request.revision,publicKey:key.encoded}}),[201]).data.challenge;
 return {old,key,token,request,pending,kind};
}

for(const state of ['pending','approved'])test('actual '+state+' replacement and its unconsumed proof are revoked while the original device key remains valid',async t=>{
 const f=await fixture(t),admin=await f.bound(),r=await replacement(f,admin,state),before=f.rows('team_device_bindings');
 ok(await f.change({actor:admin,role:'partner'}));assert.equal(f.db.prepare('SELECT status FROM team_device_replacement_requests WHERE request_id=?').get(r.request.id).status,'revoked');assert.ok(f.db.prepare('SELECT revoked_at FROM team_device_replacement_challenges WHERE challenge_id=?').get(r.pending.challengeId).revoked_at!==null);assert.deepEqual(f.rows('team_device_bindings'),before);
 deny(await f.call('/api/auth/device-replacements/'+r.kind,{token:r.token,method:'POST',body:{challengeId:r.pending.challengeId,signature:sign(null,replacementBytes(r.pending),r.key.privateKey).toString('base64url')}}),[401]);
 const fresh=await f.prove('intern-a',r.old.key);assert.equal(fresh.session.device.id,r.old.session.device.id);const bootstrap=f.bootstrap('intern-a'),status=ok(await f.call('/api/auth/device-replacements',{token:bootstrap}));assert.equal(status.data.canRequest,true);assert.equal(status.data.request.status,'revoked');
});

test('an unused ordinary proof challenge is explicitly retired and cannot survive role round trips',async t=>{
 const f=await fixture(t),admin=await f.bound(),target=await f.bound('intern-a'),token=f.bootstrap('intern-a'),challenge=ok(await f.call('/api/auth/devices/proof-challenges',{token,method:'POST',body:{publicKey:target.key.encoded}}),[201]).data.challenge;
 ok(await f.change({actor:admin,role:'manager'}));ok(await f.change({actor:admin,role:'intern'}));assert.ok(f.db.prepare('SELECT revoked_at FROM team_device_challenges WHERE challenge_id=?').get(challenge.challengeId).revoked_at!==null);deny(await f.call('/api/auth/devices/prove',{token,method:'POST',body:{challengeId:challenge.challengeId,signature:sign(null,challengeBytes(challenge),target.key.privateKey).toString('base64url')}}),[401]);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_device_bindings WHERE user_id='intern-a'").get().n,1);
});

function memoryVault(key){return {async getPublicIdentity(){return {publicKey:key.encoded,fingerprint:key.fingerprint};},async signChallenge(fields,context){for(const name of ['purpose','serverId','userId','bindingRevision'])assert.equal(fields[name],context[name]);assert.equal(fields.sessionBinding,digest(context.sessionToken));assert.equal(fields.keyFingerprint,key.fingerprint);return sign(null,challengeBytes(fields),key.privateKey).toString('base64url');},async signRequest(fields,context){for(const name of ['serverId','userId','deviceId','bindingRevision','leaseId'])assert.equal(fields[name],context[name]);assert.equal(fields.sessionBinding,digest(context.sessionToken));return sign(null,requestBytes(fields),key.privateKey).toString('base64url');},dispose(){}};}
function normalClient(t,f,key){const client=createTeamClient({fetchImpl:f.transport,now:()=>f.now,deviceIdentity:{vault:memoryVault(key),platform:'win32',displayName:'Synthetic role boundary'}});t.after(()=>client.clearSession());return client;}
function desktopBridge(t,client,dialog={}){const handlers=new Map(),frame={url:APP_URL},window={webContents:{mainFrame:frame}},dispose=registerDesktopBridge({ipcMain:{handle:(name,action)=>handlers.set(name,action),removeHandler:name=>handlers.delete(name)},window,client,dialog:{showOpenDialog:async()=>({canceled:true,filePaths:[]}),showSaveDialog:async()=>({canceled:true}),...dialog}});t.after(dispose);const event={sender:window.webContents,senderFrame:frame};return {call:(name,input)=>handlers.get('shenyi:'+name)(event,input),handlers,event};}

for(const phase of ['open-dialog','file-read','save-dialog'])test('role adjustment while '+phase+' is held blocks the next actual file boundary',async t=>{
 const f=await fixture(t),admin=await f.bound(),target=await f.bound('intern-a'),client=normalClient(t,f,target.key);assert.equal((await client.login({username:'intern-a',password:PASSWORD})).device.state,'ready');let attachmentId,opens=0,reads=0,writes=0,closed=false;
 if(phase==='save-dialog')attachmentId=(await client.upload({teamId:'team-a',taskId:'task-a',revision:0},{filename:'synthetic.txt',bytes:Buffer.from('synthetic original')})).submission.attachmentId;
 t.mock.method(fs,'open',async()=>{opens++;if(phase!=='file-read')throw Error('Must not open source');return {stat:async()=>({isFile:()=>true,size:9}),read:async buffer=>{reads++;if(reads===1){Buffer.from('synthetic').copy(buffer);ok(await f.change({actor:admin}));return {bytesRead:9};}return {bytesRead:0};},close:async()=>{closed=true;}};});t.mock.method(fs,'writeFile',async()=>{writes++;});
 const bridge=desktopBridge(t,client,{showOpenDialog:async()=>{if(phase==='open-dialog')ok(await f.change({actor:admin}));return {canceled:false,filePaths:['D:/synthetic-only-role.txt']};},showSaveDialog:async()=>{ok(await f.change({actor:admin}));return {canceled:false,filePath:'D:/synthetic-role-never-written.txt'};}}),postsBefore=f.calls.filter(item=>item.path.endsWith('/submissions')&&item.method==='POST').length;
 const result=phase==='save-dialog'?await bridge.call('download',{teamId:'team-a',taskId:'task-a',attachmentId}):await bridge.call('upload',{teamId:'team-a',taskId:'task-a',revision:0});assert.equal(result.ok,false);assert.equal(writes,0);assert.equal(f.calls.filter(item=>item.path.endsWith('/submissions')&&item.method==='POST').length,postsBefore);if(phase==='open-dialog')assert.equal(opens,0);if(phase==='file-read'){assert.ok(reads>0);assert.equal(closed,true);}assert.equal(client.getDeviceStatus().state,'signed_out');
});
