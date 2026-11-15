'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createTeamClient,API_BASE}=require('../desktop/team-client.cjs'),{registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const TOKEN=Buffer.alloc(32,41).toString('base64url'),PROOF=Buffer.alloc(32,42).toString('base64url'),SESSION={account:{id:'admin-a',displayName:'Synthetic admin'},memberships:[],expiresAt:1900000000000};
const ROW={id:'request-a',teamId:'team-a',teamName:'合成团队A',displayName:'合成员工',phoneMasked:'138****8000',targetKind:'employee',status:'pending',revision:1,createdAt:1800000000000,expiresAt:1800000300000};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function fixture(respond){const calls=[];const client=createTeamClient({fetchImpl:async(url,options)=>{calls.push({url,options});if(url.endsWith('/api/auth/login'))return json({token:TOKEN,...SESSION});if(url.endsWith('/api/auth/session'))return json(SESSION);return respond(url,options);}});return {client,calls};}
const login=f=>f.client.login({username:'admin-a',password:'ShenyiDemo!2026'});
test('review capability has only booleans and never exposes provider or grant information',async()=>{
 const f=fixture(()=>json({reviewed:true,available:false,providerSecret:'hidden',reviewerId:'owner'}));assert.deepEqual(await f.client.getRecoveryReviewStatus(),{reviewed:true,available:false});assert.equal(f.calls[0].options.headers.Authorization,undefined);
 const g=fixture(()=>json({reviewed:false,available:true}));await assert.rejects(()=>g.client.getRecoveryReviewStatus(),e=>e.code==='INVALID_RESPONSE');
});
test('SMS-verified request sends no bearer or client-supplied identity and strips routing data',async()=>{
 const receipt={requestId:'request-a',status:'pending',revision:1,expiresAt:1800000300000},f=fixture(()=>json({...receipt,userId:'victim',kind:'unavailable',phone:'13800138000'}));assert.deepEqual(await f.client.createRecoveryReviewRequest({challengeId:'challenge-a',code:'123456'}),receipt);assert.equal(f.calls[0].url,API_BASE+'/api/auth/recovery-requests');assert.deepEqual(JSON.parse(f.calls[0].options.body),{challengeId:'challenge-a',code:'123456'});assert.equal(f.calls[0].options.headers.Authorization,undefined);
 for(const patch of [{userId:'victim'},{phone:'13800138000'},{approved:true},{role:'partner'},{challengeId:'../other'},{code:'12345x'}])await assert.rejects(()=>f.client.createRecoveryReviewRequest({challengeId:'challenge-a',code:'123456',...patch}));assert.equal(f.calls.length,1);
 await login(f);await assert.rejects(()=>f.client.createRecoveryReviewRequest({challengeId:'challenge-a',code:'123456'}),e=>e.code==='SIGN_OUT_REQUIRED');
});
test('review operations require main-process authentication, not a role in renderer arguments',async()=>{
 const f=fixture(()=>json({}));for(const call of [()=>f.client.getRecoveryReviewAccess(),()=>f.client.listRecoveryReviewRequests(),()=>f.client.reviewRecoveryReviewRequest({requestId:'request-a',decision:'approve',revision:1,currentPassword:'current'})])await assert.rejects(call,e=>e.status===401);assert.equal(f.calls.length,0);
});
test('review lists project minimal scoped DTOs and never return full phone, user id or proof',async()=>{
 const f=fixture(url=>url.endsWith('/access')?json({canReview:true,role:'partner'}):json({requests:[{...ROW,userId:'victim',phone:'13800138000',proof_hash:'hidden',recoveryProof:PROOF}]}));await login(f);assert.deepEqual(await f.client.getRecoveryReviewAccess(),{canReview:true});assert.deepEqual(await f.client.listRecoveryReviewRequests(),{requests:[ROW]});assert.equal(f.calls.at(-1).options.headers.Authorization,'Bearer '+TOKEN);
});
test('list validation rejects duplicates, unmasked phones, invalid status, identity and oversized pages',async()=>{
 for(const requests of [[ROW,ROW],[{...ROW,phoneMasked:'13800138000'}],[{...ROW,targetKind:'owner'}],[{...ROW,status:'issued'}],[{...ROW,revision:0}],[{...ROW,displayName:'\ud800'}],Array.from({length:51},(_,i)=>({...ROW,id:'r'+i}))]){const f=fixture(()=>json({requests}));await login(f);await assert.rejects(()=>f.client.listRecoveryReviewRequests(),e=>e.code==='INVALID_RESPONSE');}
});
test('approval submits exact password and revision and returns a once-only bounded proof',async()=>{
 const approved={...ROW,status:'approved',revision:2},f=fixture(()=>json({request:approved,recoveryProof:PROOF,token:TOKEN}));await login(f);assert.deepEqual(await f.client.reviewRecoveryReviewRequest({requestId:'request-a',decision:'approve',revision:1,currentPassword:'  Current Password!2026  '}),{request:approved,recoveryProof:PROOF});assert.deepEqual(JSON.parse(f.calls.at(-1).options.body),{decision:'approve',revision:1,currentPassword:'  Current Password!2026  '});
 for(const decision of ['reject','revoke']){const request={...ROW,status:decision==='reject'?'rejected':'revoked',revision:2},g=fixture(()=>json({request,recoveryProof:PROOF}));await login(g);assert.deepEqual(await g.client.reviewRecoveryReviewRequest({requestId:'request-a',decision,revision:1,currentPassword:'current'}),{request});}
});
test('forged review identity and malformed completion never invent successful approval',async()=>{
 const f=fixture(()=>json({}));await login(f);const before=f.calls.length;for(const patch of [{requestId:'../other'},{revision:0},{decision:'consume'},{userId:'victim'},{currentPassword:'x'.repeat(513)}])await assert.rejects(()=>f.client.reviewRecoveryReviewRequest({requestId:'request-a',decision:'approve',revision:1,currentPassword:'current',...patch}));assert.equal(f.calls.length,before);
 for(const patch of [{request:{...ROW,status:'approved',revision:1},recoveryProof:PROOF},{request:{...ROW,status:'approved',revision:2},recoveryProof:'not-a-proof'},{request:{...ROW,id:'foreign',status:'approved',revision:2},recoveryProof:PROOF}]){const g=fixture(()=>json(patch));await login(g);await assert.rejects(()=>g.client.reviewRecoveryReviewRequest({requestId:'request-a',decision:'approve',revision:1,currentPassword:'current'}),e=>e.code==='INVALID_RESPONSE');}
});
test('late reviewer response cannot show a proof or sign out a newer account generation',async()=>{
 let finish,entered;const started=new Promise(r=>entered=r),f=fixture(()=>{entered();return new Promise(r=>finish=r);});await login(f);const pending=f.client.reviewRecoveryReviewRequest({requestId:'request-a',decision:'approve',revision:1,currentPassword:'current'});await started;await login(f);finish(json({request:{...ROW,status:'approved',revision:2},recoveryProof:PROOF}));await assert.rejects(()=>pending,e=>e.code==='SESSION_CHANGED');assert.equal((await f.client.getSession()).account.id,'admin-a');
});
test('all five new IPC operations enforce exact main frame and prevent authority injection',async()=>{
 const handlers=new Map(),mainFrame={url:APP_URL},webContents={mainFrame};let calls=0;const dispose=registerDesktopBridge({ipcMain:{handle:(n,f)=>handlers.set(n,f),removeHandler:n=>handlers.delete(n)},window:{webContents},client:{clearSession(){},getRecoveryReviewAccess:async()=>{calls++;return {canReview:true};}},dialog:{}});assert.equal(handlers.size,49);
 for(const name of ['recovery-review-status','recovery-review-create','recovery-review-access','recovery-review-list','recovery-review-decide'])for(const event of [{sender:{},senderFrame:mainFrame},{sender:webContents,senderFrame:{url:APP_URL}},{sender:webContents,senderFrame:{url:'https://evil.invalid'}}])assert.equal((await handlers.get('shenyi:'+name)(event,{})).error.code,'UNTRUSTED_SENDER');const event={sender:webContents,senderFrame:mainFrame};assert.equal((await handlers.get('shenyi:recovery-review-access')(event,{role:'owner'})).ok,false);assert.equal(calls,0);dispose();assert.equal(handlers.size,0);
});
