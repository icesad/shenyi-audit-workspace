'use strict';
// Isolated strict SQLite/proof client integration; no real account or OS vault.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{generateKeyPairSync,sign,randomUUID}=require('node:crypto');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const {createTeamClient}=require('../desktop/team-client.cjs'),proof=require('../shared/device-proof.cjs');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const PASSWORD='ShenyiDemo!2026',NOW=Date.parse('2026-11-17T03:00:00Z');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function identity(){const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({format:'der',type:'spki'}).toString('base64url');return{platform:'win32',vault:{async getPublicIdentity(){return{publicKey,fingerprint:proof.parsePublicKey(publicKey).fingerprint};},async signChallenge(fields){return sign(null,proof.challengeBytes(fields),pair.privateKey).toString('base64url');},async signRequest(fields){return sign(null,proof.requestProofBytes(fields),pair.privateKey).toString('base64url');}}};}
function metadata(response,url){Object.defineProperties(response,{url:{value:url,configurable:true},redirected:{value:false,configurable:true}});return response;}
let baseline;
async function fixture(t){
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');
 baseline||=(async()=>{const db=new DatabaseSync(':memory:');try{initializeTeamDatabase(db);await seedDemoTeamData(db);return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name+'"').all()}));}finally{db.close();}})();
 const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);t.after(()=>db.close());db.exec('BEGIN;PRAGMA defer_foreign_keys=ON;');for(const {name,rows} of await baseline)for(const row of rows){const columns=Object.keys(row);db.prepare('INSERT OR REPLACE INTO "'+name+'"('+columns.map(k=>'"'+k+'"').join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').run(...Object.values(row));}db.exec('COMMIT;');
 const {handleTeamApplicationRequest}=await source('application-api.mjs'),clock={value:NOW},state={after:null,offline:false},calls=[],serverId=db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value;
 const client=(options={})=>createTeamClient({deviceIdentity:identity(),now:()=>clock.value,fetchImpl:async(url,settings)=>{const call={url,route:new URL(url).pathname,settings};calls.push(call);if(state.offline)throw Error('synthetic disconnected');const response=metadata(await handleTeamApplicationRequest(new Request(url,settings),{db,now:()=>clock.value,identityProviders:{deviceProofRequired:true}}),url);return await state.after?.(call,response)??response;},...options});
 const login=(c,user='intern-a')=>c.login({username:user,password:PASSWORD});
 const enroll=async(c,user='intern-a')=>{await login(c,user);return c.enrollDevice({displayName:'合成本人电脑 '+user,currentPassword:PASSWORD,confirmed:true});};
 return{db,clock,state,calls,serverId,client,login,enroll};
}
const overview=c=>c.getMyDeviceOverview({});
test('actual client requires signed-in ready proof and leaves synchronous six-key device status unchanged',async t=>{
 const f=await fixture(t),c=f.client();assert.equal(Object.keys(c.getDeviceStatus()).length,6);await assert.rejects(overview(c),{code:'SIGN_IN_REQUIRED'});assert.equal(f.calls.length,0);await f.login(c);const before=f.calls.length;await assert.rejects(overview(c),{code:'DEVICE_NOT_READY'});assert.equal(f.calls.length,before);assert.equal(c.getDeviceStatus().state,'enrollment_required');const diagnostic=f.client({deviceIdentity:undefined});await f.login(diagnostic);const at=f.calls.length;await assert.rejects(overview(diagnostic),{code:'DEVICE_NOT_READY'});assert.equal(f.calls.length,at);
});
test('actual strict overview signs a fixed GET and projects only this active device plus stored history',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);f.clock.value+=200;const value=await overview(c),row=f.db.prepare("SELECT * FROM team_device_bindings WHERE user_id='intern-a'").get(),usage=f.db.prepare('SELECT * FROM team_device_usage WHERE device_id=?').get(row.device_id),call=f.calls.at(-1);
 assert.equal(call.route,'/api/auth/devices/overview');assert.equal(call.settings.method,'GET');assert.equal(call.settings.body,undefined);for(const name of ['Authorization','X-Shenyi-Device-Lease','X-Shenyi-Device-Nonce','X-Shenyi-Device-Signature'])assert.equal(typeof call.settings.headers[name],'string');
 assert.deepEqual(value.device,{id:row.device_id,displayName:row.display_name,platform:'win32',status:'active',boundAt:row.bound_at,lastUsedAt:usage.last_used_at});assert.equal(value.device.lastUsedAt,f.clock.value);assert.equal(value.events.length,1);assert.equal(value.events[0].action,'bound');assert.equal(value.events[0].id,'D.'+f.db.prepare("SELECT event_id FROM team_device_events WHERE user_id='intern-a'").get().event_id);assert.equal(value.nextCursor,null);assert.equal(value.hasMore,false);assert.deepEqual(Object.keys(c.getDeviceStatus()).sort(),['device','epoch','expiresAt','localFingerprint','required','state']);
 for(const secret of ['publicKey','keyFingerprint','token','lease','serverId','userId','teamId','actorId','passwordHash'])assert.equal(JSON.stringify(value).includes('"'+secret+'"'),false);
});
test('zero-business-membership technical administrator still reads only its own computer',async t=>{
 const f=await fixture(t);f.db.prepare("INSERT INTO team_users(user_id,status) VALUES ('admin-self','active')").run();f.db.prepare("INSERT INTO team_credentials(user_id,username,display_name,password_hash) SELECT 'admin-self','admin-self','合成技术管理员',password_hash FROM team_credentials WHERE user_id='manager-a'").run();f.db.prepare("INSERT INTO team_operators(team_id,user_id,role,status) VALUES ('team-a','admin-self','administrator','active')").run();const c=f.client();await f.enroll(c,'admin-self');assert.deepEqual((await c.getSession()).memberships,[]);const value=await overview(c);assert.equal(value.device.displayName,'合成本人电脑 admin-self');assert.equal(value.events.every(row=>row.displayName==='合成本人电脑 admin-self'),true);
});
test('real pagination fixture stays owner-scoped and a foreign event cursor cannot select a target',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);const own=c.getDeviceStatus().device.id,insert=f.db.prepare('INSERT INTO team_device_events(event_id,user_id,device_id,action,revision,created_at) VALUES (?,?,?,?,?,?)');
 // Only the first bound event is an actual protocol event; these26 rows are explicit pagination fixtures.
 for(let i=1;i<=26;i++)insert.run(randomUUID(),'intern-a',own,'proved',1,NOW+i);
 const b=f.client();await f.enroll(b,'assistant-a');const foreign=f.db.prepare("SELECT event_id FROM team_device_events WHERE user_id='assistant-a'").get().event_id;f.clock.value=NOW+1000;
 const first=await overview(c);assert.equal(first.events.length,25);assert.equal(first.hasMore,true);const second=await c.getMyDeviceOverview({before:first.nextCursor});assert.equal(second.events.length,2);assert.equal(second.hasMore,false);assert.equal(new Set([...first.events,...second.events].map(e=>e.id)).size,27);assert.ok([...first.events,...second.events].every(e=>e.displayName==='合成本人电脑 intern-a'));
 await assert.rejects(c.getMyDeviceOverview({before:'D.'+foreign}),{code:'HTTP_404'});assert.equal(c.getDeviceStatus().state,'ready');
});
test('different-key and revoked clients cannot send an overview request',async t=>{
 const f=await fixture(t),a=f.client();await f.enroll(a);const wrong=f.client();await f.login(wrong);assert.equal(wrong.getDeviceStatus().state,'different_key');let at=f.calls.length;await assert.rejects(overview(wrong),{code:'DEVICE_NOT_READY'});assert.equal(f.calls.length,at);
 f.db.prepare("UPDATE team_device_bindings SET status='revoked',revision=revision+1,revoked_at=? WHERE user_id='intern-a'").run(NOW+1);const revoked=f.client();await f.login(revoked);assert.equal(revoked.getDeviceStatus().state,'revoked');at=f.calls.length;await assert.rejects(overview(revoked),{code:'DEVICE_NOT_READY'});assert.equal(f.calls.length,at);
});
test('actual response containing another binding or private fields cannot reach the public caller',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);let mode='foreign';f.state.after=async(call,response)=>{if(call.route!=='/api/auth/devices/overview')return response;const value=await response.json();if(mode==='foreign')value.device.id=randomUUID();else value.actorId='must-not-publish';return metadata(new Response(JSON.stringify(value),{headers:response.headers}),call.url);};
 await assert.rejects(overview(c),{code:'INVALID_RESPONSE'});mode='private';await assert.rejects(overview(c),{code:'INVALID_RESPONSE'});assert.equal(c.getDeviceStatus().state,'ready');
});
test('held overview401 from A cannot clear the later ready B account',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);const entered=deferred(),release=deferred();let held=false;f.state.after=async(call,r)=>{if(!held&&call.route==='/api/auth/devices/overview'){held=true;entered.resolve();await release.promise;return metadata(new Response(JSON.stringify({error:{code:'SIGN_IN_REQUIRED'}}),{status:401,headers:r.headers}),call.url);}return r;};
 const pending=overview(c),rejected=assert.rejects(pending,{code:'SESSION_CHANGED'});await entered.promise;await f.enroll(c,'assistant-a');const epoch=c.getDeviceStatus().epoch;release.resolve();await rejected;assert.equal(c.getDeviceStatus().epoch,epoch);assert.equal(c.getDeviceStatus().state,'ready');assert.equal((await c.getSession()).account.id,'assistant-a');
});
async function heldBody(f){const entered=deferred(),release=deferred();let held=false;f.state.after=async(call,r)=>{if(!held&&call.route==='/api/auth/devices/overview'){held=true;const body=await r.text();return metadata(new Response(new ReadableStream({async pull(controller){entered.resolve();await release.promise;controller.enqueue(Buffer.from(body));controller.close();}},{highWaterMark:0}),{headers:r.headers}),call.url);}return r;};return{entered,release};}
test('actual held body cannot publish A history into a later B login',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);const hold=await heldBody(f),pending=overview(c),rejected=assert.rejects(pending,{code:'SESSION_CHANGED'});await hold.entered.promise;await f.enroll(c,'assistant-a');const epoch=c.getDeviceStatus().epoch;hold.release.resolve();await rejected;assert.equal(c.getDeviceStatus().epoch,epoch);assert.equal((await c.getSession()).account.id,'assistant-a');
});
test('same-account pause/reconnect and new lease rejects held old history after ABA',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);const hold=await heldBody(f),pending=overview(c),rejected=assert.rejects(pending,{code:'SESSION_CHANGED'});await hold.entered.promise;c.pauseDeviceConnection();await c.reconnectDevice();const epoch=c.getDeviceStatus().epoch;hold.release.resolve();await rejected;assert.equal(c.getDeviceStatus().epoch,epoch);assert.equal(c.getDeviceStatus().state,'ready');
});
test('self revoke-all during held history discards the old body and stays signed out',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);const hold=await heldBody(f),pending=overview(c),rejected=assert.rejects(pending,{code:'SESSION_CHANGED'});await hold.entered.promise;await c.revokeAllSessions({currentPassword:PASSWORD});hold.release.resolve();await rejected;assert.equal(await c.getSession(),null);assert.equal(c.getDeviceStatus().state,'signed_out');
});
test('overview read transport loss pauses and later reconnection re-reads without a cached result',async t=>{
 const f=await fixture(t),c=f.client();await f.enroll(c);f.state.offline=true;await assert.rejects(overview(c),{code:'SERVICE_UNAVAILABLE'});assert.equal(c.getDeviceStatus().state,'paused');f.state.offline=false;await c.reconnectDevice();const value=await overview(c);assert.equal(value.device.id,c.getDeviceStatus().device.id);
});
test('malformed UTF8 and oversized body cannot reach the DTO and pause the current device',async t=>{
 for(const body of [Buffer.from([0xff]),Buffer.alloc(1024*1024+1,32)]){const f=await fixture(t),c=f.client();await f.enroll(c);f.state.after=(call,r)=>call.route==='/api/auth/devices/overview'?metadata(new Response(body,{headers:r.headers}),call.url):r;await assert.rejects(overview(c),e=>['INVALID_RESPONSE','RESPONSE_TOO_LARGE'].includes(e.code));assert.equal(c.getDeviceStatus().state,'paused');}
});
test('HTTPS pre-secret wrong identity prevents overview signature/header dispatch and clears only current actor',async t=>{
 const f=await fixture(t),c=f.client({trustedService:{schemaVersion:1,apiBase:'https://self-device.example.invalid',serverId:f.serverId}});await f.enroll(c);f.state.after=(call,r)=>{if(call.route==='/api/auth/methods'&&call.settings.cache==='no-store'){const headers=new Headers(r.headers);headers.set('X-Shenyi-Server-Id',randomUUID());return metadata(new Response(r.body,{status:r.status,headers}),call.url);}return r;};const before=f.calls.length;
 await assert.rejects(overview(c),{code:'UNTRUSTED_SERVER'});const added=f.calls.slice(before);assert.equal(added.length,1);assert.equal(added[0].route,'/api/auth/methods');assert.deepEqual(added[0].settings.headers,{Origin:'shenyi://app'});assert.equal(added[0].settings.body,undefined);assert.equal(await c.getSession(),null);
});
