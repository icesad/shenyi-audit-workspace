'use strict';
// Native Node fetch over generated TLS -> actual strict HTTP adapter -> isolated
// SQLite. The synthetic vault signs real Ed25519 challenge/request bytes.
const nodeTest=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createTrustedHttpsFixture,runClientScenario,hash,deferred}=require('./helpers/trusted-team-https-fixture.cjs');
const test=(name,action)=>nodeTest(name,{timeout:60000},async t=>{const f=await createTrustedHttpsFixture({directory:process.env.SHENYI_TLS_EVIDENCE_DIR});t.after(()=>f.close());await action(t,f);});
function pass(result){assert.equal(result.exitCode,0,result.stdout+'\n'+result.stderr);assert.equal(result.result?.ok,true);return result.result.result;}
function jsonBody(answer,value){const body=Buffer.from(JSON.stringify(value)),headers={...answer.headers,'content-length':String(body.length)};delete headers['transfer-encoding'];return {...answer,headers,body};}
function onlyPublicProbes(f){assert.ok(f.events.length>0);for(const e of f.events){assert.equal(e.route,'/api/auth/methods');assert.equal(e.method,'GET');assert.equal(e.bodyBytes,0);assert.equal(e.hasAuthorization,false);assert.equal(e.hasLease,false);assert.equal(e.hasSignature,false);assert.equal(e.hasNonce,false);}assert.equal(f.counter,0);}

test('real trusted TLS allows explicit binding, signed own-task originals, and denies foreign scope',async(_t,f)=>{
 const result=pass(await runClientScenario(f,{code:`
 await ready();const tasks=await client.listTasks({teamId:'team-a',q:'Synthetic & ?',limit:5});
 const bytes=Buffer.from('Synthetic HTTPS original\\0\\r\\n原件; no customer data.');
 const upload=await client.upload({teamId:'team-a',taskId:'task-a',revision:0},{filename:'synthetic-tls.bin',bytes});
 assert.equal(upload.submission.sha256,hash(bytes));const target={teamId:'team-a',taskId:'task-a',attachmentId:upload.submission.attachmentId};
 assert.deepEqual(Buffer.from((await client.download(target)).bytes),bytes);assert.deepEqual(await client.checkAttachmentAccess(target),{canDownload:true});
 await assert.rejects(()=>client.upload({teamId:'team-a',taskId:'task-foreign',revision:0},{filename:'foreign.bin',bytes}));
 await assert.rejects(()=>client.listTasks({teamId:'team-b'}));
 return {sha256:hash(bytes),byteLength:bytes.length,attachmentId:target.attachmentId,device:(await client.getDeviceStatus()).state};` }));
 assert.equal(result.device,'ready');const row=f.db.prepare('SELECT bytes FROM team_collection_attachments WHERE attachment_id=?').get(result.attachmentId);assert.equal(hash(row.bytes),result.sha256);assert.equal(row.bytes.length,result.byteLength);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_task_submissions').get().n,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_bindings').get().n,1);
 const business=f.events.filter(e=>e.route.startsWith('/api/teams/'));assert.ok(business.length>=5);assert.ok(business.every(e=>e.hasAuthorization&&e.hasLease&&e.hasSignature&&e.hasNonce&&e.origin==='shenyi://app'));
 assert.ok(f.events.some(e=>e.method==='HEAD'&&e.bodyBytes===0));
 for(let i=0;i<f.events.length;i++){const e=f.events[i];if(e.route!=='/api/auth/methods')assert.equal(f.events[i-1]?.route,'/api/auth/methods','separate fresh probe immediately precedes each request');}
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});

test('real TLS coalesces only the in-flight probe while each concurrent business request has its own valid signature',async(_t,f)=>{
 const batchSize=4,held=deferred(),release=deferred(),signedRequests=[];let start,backendStart,replaysBefore;
 f.state.before=async(e,{headers})=>{
  if(start===undefined)return;
  if(e.route==='/api/auth/methods'){held.resolve();await release.promise;}
  else if(e.route.startsWith('/api/teams/'))signedRequests.push({route:e.route,nonce:hash(headers['x-shenyi-device-nonce']),signature:hash(headers['x-shenyi-device-signature']),lease:hash(headers['x-shenyi-device-lease'])});
 };
 let result;
 try{result=pass(await runClientScenario(f,{name:'concurrent-probe',code:`
 const counts={probes:0,business:0,signatures:0};let measured=false;
 const identity=vault(),signRequest=identity.signRequest;
 identity.signRequest=async(...args)=>{const signature=await signRequest(...args);if(measured)counts.signatures++;return signature;};
 const c=createTeamClient({trustedService:profile,deviceIdentity:{vault:identity,platform:'win32',displayName:'Synthetic concurrent TLS computer'},fetchImpl:(url,options)=>{
  if(measured){const path=new URL(url).pathname;if(path==='/api/auth/methods')counts.probes++;else if(path.startsWith('/api/teams/'))counts.business++;}
  return globalThis.fetch(url,options);
 }});clients.push(c);await ready(c);const epoch=(await c.getDeviceStatus()).epoch;
 await step('arm');measured=true;
 const batch=Array.from({length:${batchSize}},(_,index)=>c.listTasks({teamId:'team-a',limit:index+1}));
 // Every local signing continuation reaches transport before this event-loop
 // boundary. The real first HTTPS response stays held by the parent's gate.
 await new Promise(setImmediate);await step('in-flight',{...counts});
 for(const answer of await Promise.all(batch))assert.deepEqual(answer.tasks.map(task=>task.id),['task-a']);
 assert.deepEqual(counts,{probes:1,business:${batchSize},signatures:${batchSize}});
 assert.equal((await c.getDeviceStatus()).epoch,epoch);
 assert.deepEqual((await c.listTasks({teamId:'team-a',limit:${batchSize+1}})).tasks.map(task=>task.id),['task-a']);
 assert.deepEqual(counts,{probes:2,business:${batchSize+1},signatures:${batchSize+1}});
 assert.equal((await c.getDeviceStatus()).epoch,epoch);return counts;
 `,onStep:async(action,data)=>{
  if(action==='arm'){start=f.events.length;backendStart=f.backendEvents.length;replaysBefore=f.db.prepare('SELECT COUNT(*) n FROM team_device_request_replays').get().n;}
  if(action==='in-flight'){
   await held.promise;assert.deepEqual(data,{probes:1,business:0,signatures:batchSize});
   const window=f.events.slice(start);assert.equal(window.length,1);const probe=window[0];
   assert.equal(probe.route,'/api/auth/methods');assert.equal(probe.method,'GET');assert.equal(probe.bodyBytes,0);
   for(const field of ['hasAuthorization','hasLease','hasSignature','hasNonce'])assert.equal(probe[field],false);
   assert.equal(signedRequests.length,0);release.resolve();
  }
 }}));}finally{release.resolve();}
 assert.deepEqual(result,{probes:2,business:batchSize+1,signatures:batchSize+1});
 const events=f.events.slice(start),probes=events.filter(e=>e.route==='/api/auth/methods'),business=events.filter(e=>e.route.startsWith('/api/teams/'));
 assert.equal(probes.length,2);assert.equal(business.length,batchSize+1);assert.equal(events.length,batchSize+3);
 for(const probe of probes){assert.equal(probe.status,200);assert.equal(probe.method,'GET');assert.equal(probe.bodyBytes,0);for(const field of ['hasAuthorization','hasLease','hasSignature','hasNonce'])assert.equal(probe[field],false);}
 assert.ok(business.every(e=>e.method==='GET'&&e.status===200&&e.hasAuthorization&&e.hasLease&&e.hasSignature&&e.hasNonce&&e.origin==='shenyi://app'));
 const expectedRoutes=Array.from({length:batchSize+1},(_,index)=>'/api/teams/team-a/collection/tasks?limit='+(index+1));
 assert.deepEqual(business.map(e=>e.route).sort(),expectedRoutes.sort());
 assert.equal(signedRequests.length,batchSize+1);assert.equal(new Set(signedRequests.map(e=>e.nonce)).size,batchSize+1);assert.equal(new Set(signedRequests.map(e=>e.signature)).size,batchSize+1);assert.equal(new Set(signedRequests.map(e=>e.lease)).size,1);
 const accepted=f.backendEvents.slice(backendStart).filter(e=>e.route.startsWith('/api/teams/'));
 assert.equal(accepted.length,batchSize+1);assert.ok(accepted.every(e=>e.status===200));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_request_replays').get().n-replaysBefore,batchSize+1);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_task_submissions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_bindings').get().n,1);
});

for(const [name,options]of [['untrusted certificate',{trust:false}],['wrong hostname',{base:'wrongHostBase'}],['expired certificate',{base:'expiredBase'}]])test(`real TLS rejects ${name} before any HTTP or password`,async(_t,f)=>{
 pass(await runClientScenario(f,{trust:options.trust!==false,profile:{...f.profile,...options.base?{apiBase:f[options.base]}:{}},code:`await assert.rejects(()=>client.login({username:'intern-a',password:PASSWORD}));assert.equal(await client.getSession(),null);return {closed:true};`}));
 assert.equal(f.events.length,0);assert.equal(f.backendEvents.length,0);assert.equal(f.counter,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_sessions').get().n,0);
});

test('a well-formed different expected UUID sends only the nonsecret identity probe',async(_t,f)=>{
 pass(await runClientScenario(f,{profile:{...f.profile,serverId:randomUUID()},code:`await assert.rejects(()=>client.login({username:'intern-a',password:PASSWORD}),e=>e.code==='UNTRUSTED_SERVER');return {closed:true};`}));onlyPublicProbes(f);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_sessions').get().n,0);
});

for(const variant of ['missing','wrong','duplicate'])test(`a ${variant} identity header closes the pre-secret probe`,async(_t,f)=>{
 f.state.after=async(e,a)=>{if(e.route!=='/api/auth/methods')return a;const headers={...a.headers};if(variant==='missing')delete headers['x-shenyi-server-id'];else headers['x-shenyi-server-id']=variant==='wrong'?randomUUID():[f.profile.serverId,f.profile.serverId];return {...a,headers};};
 pass(await runClientScenario(f,{code:`await assert.rejects(()=>client.login({username:'intern-a',password:PASSWORD}),e=>e.code==='UNTRUSTED_SERVER');return {closed:true};`}));onlyPublicProbes(f);
});

for(const variant of ['missing','optional','wrong-uuid','wrong-protocol','extra-key'])test(`a ${variant} device capability body closes the pre-secret probe`,async(_t,f)=>{
 f.state.after=async(e,a)=>{if(e.route!=='/api/auth/methods')return a;const data=JSON.parse(a.body);if(variant==='missing')delete data.deviceBinding;else if(variant==='optional')data.deviceBinding.required=false;else if(variant==='wrong-uuid')data.deviceBinding.serverId=randomUUID();else if(variant==='wrong-protocol')data.deviceBinding.protocolVersion=2;else data.deviceBinding.extra=true;return jsonBody(a,data);};
 pass(await runClientScenario(f,{code:`await assert.rejects(()=>client.login({username:'intern-a',password:PASSWORD}),e=>e.code==='UNTRUSTED_SERVER');return {closed:true};`}));onlyPublicProbes(f);
});

test('a real redirect is rejected and the owned destination receives no request',async(_t,f)=>{
 f.state.before=async()=>({status:302,headers:{'x-shenyi-server-id':f.profile.serverId,location:f.counterBase+'/never','content-length':'0'},body:Buffer.alloc(0)});
 pass(await runClientScenario(f,{code:`await assert.rejects(()=>client.login({username:'intern-a',password:PASSWORD}));return {closed:true};`}));onlyPublicProbes(f);assert.equal(f.backendEvents.length,0);
});

test('identity is rechecked for every signed call and mismatch clears the current actor before business dispatch',async(_t,f)=>{
 let businessAtChange;
 pass(await runClientScenario(f,{code:`await ready();await step('change');await assert.rejects(()=>client.listTasks({teamId:'team-a'}),e=>e.code==='UNTRUSTED_SERVER');assert.equal(await client.getSession(),null);assert.equal((await client.getDeviceStatus()).state,'signed_out');return {closed:true};`,onStep:async()=>{businessAtChange=f.events.filter(e=>e.route.startsWith('/api/teams/')).length;f.state.after=async(e,a)=>e.route==='/api/auth/methods'?{...a,headers:{...a.headers,'x-shenyi-server-id':randomUUID()}}:a;}}));
 assert.equal(f.events.filter(e=>e.route.startsWith('/api/teams/')).length,businessAtChange);assert.equal(f.events.at(-1).hasAuthorization,false);
});

test('a bad response identity after login never adopts or forwards its returned token',async(_t,f)=>{
 f.state.after=async(e,a)=>e.route==='/api/auth/login'?{...a,headers:{...a.headers,'x-shenyi-server-id':randomUUID()}}:a;
 pass(await runClientScenario(f,{code:`await assert.rejects(()=>client.login({username:'intern-a',password:PASSWORD}),e=>e.code==='UNTRUSTED_SERVER');assert.equal(await client.getSession(),null);return {closed:true};`}));
 assert.deepEqual(f.events.map(e=>e.route),['/api/auth/methods','/api/auth/login']);assert.equal(f.events.filter(e=>e.hasAuthorization).length,0);assert.equal(f.counter,0);
});

test('actual signed JSON tampering is rejected by the strict backend before any submission',async(_t,f)=>{
 f.state.before=async(e,{body})=>{if(e.route.endsWith('/submissions')&&e.method==='POST'){const at=body.indexOf('synthetic.bin');assert.ok(at>=0);body[at]='S'.charCodeAt(0);}return undefined;};
 pass(await runClientScenario(f,{code:`await ready();await assert.rejects(()=>client.upload({teamId:'team-a',taskId:'task-a',revision:0},{filename:'synthetic.bin',bytes:Buffer.from('signed original')}),e=>e.code==='DEVICE_BODY_MISMATCH');assert.equal((await client.getDeviceStatus()).state,'paused');return {tamperRejected:true};`}));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_task_submissions').get().n,0);assert.equal(f.events.filter(e=>e.route.endsWith('/submissions')).length,1);
});

test('actual disconnect at identity probe pauses business and online proof restores it',async(_t,f)=>{
 pass(await runClientScenario(f,{code:`await ready();await step('offline');await assert.rejects(()=>client.listTasks({teamId:'team-a'}));assert.equal((await client.getDeviceStatus()).state,'paused');await step('online');await client.reconnectDevice();assert.equal((await client.getDeviceStatus()).state,'ready');assert.equal((await client.listTasks({teamId:'team-a'})).tasks.length,1);return {restored:true};`,onStep:async action=>{f.state.offline=action==='offline';}}));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_device_bindings').get().n,1);
});

test('late wrong probe identity cannot clear or pause the later account',async(_t,f)=>{
 const held=deferred(),release=deferred();let arm=false;
 f.state.after=async(e,a)=>{if(arm&&e.route==='/api/auth/methods'){arm=false;held.resolve();await release.promise;return {...a,headers:{...a.headers,'x-shenyi-server-id':randomUUID()}};}return a;};
 try{pass(await runClientScenario(f,{code:`await ready();await step('arm');const old=client.listTasks({teamId:'team-a'}).then(()=>({ok:true}),e=>({code:e.code}));await step('held');await ready(client,'intern-b');await step('release');assert.equal((await old).code,'SESSION_CHANGED');assert.equal((await client.getDeviceStatus()).state,'ready');const s=await client.getSession();assert.equal(s.account.id,'intern-b');return {laterAccount:s.account.id};`,onStep:async action=>{if(action==='arm')arm=true;if(action==='held')await held.promise;if(action==='release')release.resolve();}}));}finally{release.resolve();}
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_device_bindings WHERE user_id='intern-b'").get().n,1);
});

test('late real body cannot publish old task data or pause the later account',async(_t,f)=>{
 const held=deferred(),release=deferred();let arm=false;
 f.state.after=async(e,a)=>{if(arm&&e.route.startsWith('/api/teams/')&&e.method==='GET'){arm=false;held.resolve();return {...a,holdBody:release.promise};}return a;};
 try{pass(await runClientScenario(f,{code:`await ready();await step('arm');const old=client.listTasks({teamId:'team-a'}).then(()=>({ok:true}),e=>({code:e.code}));await step('held');await ready(client,'intern-b');await step('release');assert.equal((await old).code,'SESSION_CHANGED');assert.equal((await client.getDeviceStatus()).state,'ready');assert.equal((await client.getSession()).account.id,'intern-b');return {lateBodyRejected:true};`,onStep:async action=>{if(action==='arm')arm=true;if(action==='held')await held.promise;if(action==='release')release.resolve();}}));}finally{release.resolve();}
});

test('real self revocation during a held original body discards bytes and signs out',async(_t,f)=>{
 const held=deferred(),release=deferred();let arm=false;
 f.state.after=async(e,a)=>{if(arm&&e.route.includes('/attachments/')&&e.method==='GET'){arm=false;held.resolve();return {...a,holdBody:release.promise};}return a;};
 try{pass(await runClientScenario(f,{code:`await ready();const u=await client.upload({teamId:'team-a',taskId:'task-a',revision:0},{filename:'synthetic.bin',bytes:Buffer.from('revocation original')});await step('arm');const old=client.download({teamId:'team-a',taskId:'task-a',attachmentId:u.submission.attachmentId}).then(()=>({ok:true}),e=>({code:e.code}));await step('held');assert.equal((await client.revokeAllSessions({currentPassword:PASSWORD})).signedOut,true);await step('release');assert.equal((await old).code,'SESSION_CHANGED');assert.equal(await client.getSession(),null);return {revoked:true};`,onStep:async action=>{if(action==='arm')arm=true;if(action==='held')await held.promise;if(action==='release')release.resolve();}}));}finally{release.resolve();}
 assert.ok(f.backendEvents.some(e=>e.route==='/api/auth/sessions/revoke-all'&&e.status===200));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_sessions WHERE revoked_at IS NULL').get().n,0);
});

test('strict app applies UUID to real successful, error and HEAD responses without HEAD bytes',async(_t,f)=>{
 // Node itself is deliberately not granted the fixture CA. Its isolated child
 // performs every HTTPS request using native global fetch instead.
 pass(await runClientScenario(f,{code:`const a=await fetch(profile.apiBase+'/api/auth/methods',{redirect:'error'});assert.equal(a.headers.get('x-shenyi-server-id'),profile.serverId);const b=await fetch(profile.apiBase+'/api/no-such-route',{redirect:'error'});assert.equal(b.status,401);assert.equal(b.headers.get('x-shenyi-server-id'),profile.serverId);const h=await fetch(profile.apiBase+'/api/no-such-route',{method:'HEAD',redirect:'error'});assert.equal(h.headers.get('x-shenyi-server-id'),profile.serverId);assert.equal((await h.arrayBuffer()).byteLength,0);return {headerBoundary:true};`}));
});
