'use strict';
// Actual owned loopback servers and SQLite; Ed25519 keys below are test-only memory.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url'),{generateKeyPairSync,sign,randomUUID}=require('node:crypto');
const {createTeamClient,API_BASE}=require('../desktop/team-client.cjs'),proof=require('../shared/device-proof.cjs');
const BASE=path.join(os.tmpdir(),'shenyi-isolated-client-tests');
const PASSWORD='ShenyiDemo!2026';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function identity(){const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');return {platform:'win32',vault:{async getPublicIdentity(){return {publicKey,fingerprint:proof.parsePublicKey(publicKey).fingerprint};},async signChallenge(v){return sign(null,proof.challengeBytes(v),pair.privateKey).toString('base64url');},async signRequest(v){return sign(null,proof.requestProofBytes(v),pair.privateKey).toString('base64url');}}};}
async function fixture(t){
 const {createIsolatedPreviewService}=await import(pathToFileURL(path.resolve(__dirname,'../scripts/team-isolated-preview.mjs')).href);
 await fs.mkdir(BASE,{recursive:true});const parent=await fs.mkdtemp(path.join(BASE,'client-'));
 const own=await createIsolatedPreviewService({rootDirectory:path.join(parent,'root')});t.after(()=>own.close());
 const calls=[],events=[],state={after:null};own.server.on('request',req=>events.push({route:new URL(req.url,own.context.profile.apiBase).pathname,method:req.method,auth:!!req.headers.authorization,lease:!!req.headers['x-shenyi-device-lease']}));
 const client=createTeamClient({isolatedPreview:own.context.profile,deviceIdentity:identity(),fetchImpl:async(url,settings)=>{const call={url,route:new URL(url).pathname,method:settings.method,body:settings.body!==undefined,auth:!!settings.headers.Authorization};calls.push(call);const r=await fetch(url,settings);return await state.after?.(call,r,url)??r;}});
 const login=(username='intern-a')=>client.login({username,password:PASSWORD});
 const enroll=async(username='intern-a')=>{assert.equal((await login(username)).device.state,'enrollment_required');await client.enrollDevice({displayName:'合成隔离测试电脑',currentPassword:PASSWORD,confirmed:true});assert.equal(client.getDeviceStatus().state,'ready');};
 return {own,client,calls,events,state,login,enroll};
}
async function wrongIdentity(response,url){const headers=new Headers(response.headers);headers.set('X-Shenyi-Server-Id',randomUUID());const changed=new Response(await response.arrayBuffer(),{status:response.status,headers});Object.defineProperties(changed,{url:{value:url},redirected:{value:false}});return changed;}

test('isolated opt-in still refuses mixed profiles, base override and missing OS-identity interface',()=>{
 const profile={schemaVersion:1,apiBase:'http://127.0.0.1:18943',serverId:randomUUID()};
 assert.throws(()=>createTeamClient({isolatedPreview:profile,trustedService:{schemaVersion:1,apiBase:'https://team.example.invalid',serverId:randomUUID()},deviceIdentity:identity()}),{code:'INVALID_SERVER'});
 for(const baseUrl of [profile.apiBase,API_BASE+'/', 'https://team.example.invalid'])assert.throws(()=>createTeamClient({baseUrl,isolatedPreview:profile,deviceIdentity:identity()}),{code:'INVALID_SERVER'});
 assert.throws(()=>createTeamClient({isolatedPreview:profile}),{code:'DEVICE_VAULT_UNAVAILABLE'});
});
test('isolated identity mismatch sends only public probes before any credential dispatch',async t=>{
 const f=await fixture(t);f.state.after=(call,r,url)=>wrongIdentity(r,url);
 await assert.rejects(f.login(),{code:'UNTRUSTED_SERVER'});assert.equal(await f.client.getSession(),null);
 assert.ok(f.calls.length>0);for(const c of f.calls){assert.equal(c.route,'/api/auth/methods');assert.equal(c.method,'GET');assert.equal(c.auth,false);assert.equal(c.body,false);assert.equal(new URL(c.url).origin,f.own.context.profile.apiBase);}
 assert.ok(f.events.every(e=>!e.auth&&!e.lease&&e.route==='/api/auth/methods'));
});
test('normal isolated client binds and signs real business; a changed UUID closes before next business call',async t=>{
 const f=await fixture(t);await f.enroll();const tasks=await f.client.listTasks({teamId:'team-a'});assert.ok(tasks.tasks.length>0);
 const business=f.events.filter(e=>e.route.startsWith('/api/teams/'));assert.ok(business.length>0);assert.ok(business.every(e=>e.auth&&e.lease));
 const count=business.length;f.state.after=(call,r,url)=>call.route==='/api/auth/methods'?wrongIdentity(r,url):r;
 await assert.rejects(f.client.listTasks({teamId:'team-a'}),{code:'UNTRUSTED_SERVER'});assert.equal(await f.client.getSession(),null);assert.equal(f.client.getDeviceStatus().state,'signed_out');
 assert.equal(f.events.filter(e=>e.route.startsWith('/api/teams/')).length,count);
});
test('isolated bad actual login response identity never adopts its minted token',async t=>{
 const f=await fixture(t);f.state.after=(call,r,url)=>call.route==='/api/auth/login'?wrongIdentity(r,url):r;
 await assert.rejects(f.login(),{code:'UNTRUSTED_SERVER'});assert.equal(await f.client.getSession(),null);
 assert.deepEqual(f.calls.map(c=>c.route),['/api/auth/methods','/api/auth/login']);assert.equal(f.events.filter(e=>e.auth).length,0);
});
for(const bad of [false,true])test('isolated late minted token cleanup '+(bad?'refuses changed response identity':'uses its own fresh identity probe and origin'),async t=>{
 const f=await fixture(t),entered=deferred(),release=deferred();let held=false;
 f.state.after=async(call,r,url)=>{if(!held&&call.route==='/api/auth/login'){held=true;entered.resolve();await release.promise;if(bad)return wrongIdentity(r,url);}return r;};
 const stale=f.login();const rejected=assert.rejects(stale,{code:'SESSION_CHANGED'});await entered.promise;await f.enroll('assistant-a');const epoch=f.client.getDeviceStatus().epoch;release.resolve();await rejected;
 assert.equal((await f.client.getSession()).account.id,'assistant-a');assert.equal(f.client.getDeviceStatus().epoch,epoch);assert.equal(f.client.getDeviceStatus().state,'ready');
 const at=f.calls.findIndex(c=>c.route==='/api/auth/logout');if(bad)assert.equal(at,-1);else{assert.ok(at>0);assert.equal(f.calls[at-1].route,'/api/auth/methods');assert.equal(f.calls[at-1].auth,false);assert.equal(f.calls[at-1].body,false);}
 assert.ok(f.calls.every(c=>new URL(c.url).origin===f.own.context.profile.apiBase));
});
