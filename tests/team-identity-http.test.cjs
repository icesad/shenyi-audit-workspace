'use strict';
// Real loopback HTTP and SQLite; suppliers are explicitly synthetic captures.
// The HTTPS WeChat callback is dispatched directly, NOT a live WeChat/TLS test.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createHash,randomBytes}=require('node:crypto');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const PASSWORD='ShenyiDemo!2026';
async function fixture(t,identityProviders={}){
  const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');
  const {startTeamServer}=await source('dev-server.mjs');
  const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);await seedDemoTeamData(db);
  const service=await startTeamServer({db,port:0,identityProviders});
  t.after(async()=>{await service.close();db.close();});
  async function call(route,body,token){
    const response=await fetch(service.address.url+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const raw=await response.text();return {response,raw,data:JSON.parse(raw)};
  }
  const login=async username=>(await call('/api/auth/login',{username,password:PASSWORD})).data;
  return {db,call,login,url:service.address.url};
}
test('HTTP advertises absent suppliers truthfully and never leaks provider configuration',async t=>{
  const f=await fixture(t);
  const methods=await f.call('/api/auth/methods');assert.equal(methods.response.status,200);
  assert.deepEqual(methods.data,{mode:'local-preview',methods:{demoUsername:true,phonePassword:true,phoneVerification:false,wechat:false,recovery:false}});
  assert.equal((await f.call('/api/auth/phone/challenges',{phone:'13800138000',purpose:'bind'})).response.status,503);
  assert.equal((await f.call('/api/auth/wechat/transactions',{codeChallenge:createHash('sha256').update('v'.repeat(43)).digest('base64url')})).response.status,503);
  const foreign=await fetch(f.url+'/api/auth/methods',{headers:{Origin:'https://untrusted.invalid'}});assert.equal(foreign.status,403);
  assert.equal(methods.response.headers.get('access-control-allow-origin'),null);
  assert.match(methods.response.headers.get('cache-control'),/no-store/);
});
test('HTTP phone verification and password login keep the same internal employee and task scope',async t=>{
  const sent=[];
  const f=await fixture(t,{sms:{send:async value=>sent.push(value)},phonePepper:randomBytes(32)});
  const old=await f.login('intern-a');
  const challenge=await f.call('/api/auth/phone/challenges',{phone:'+86 13800138000',purpose:'bind'},old.token);
  assert.equal(challenge.response.status,202);assert.equal(sent.length,1);assert.ok(!challenge.raw.includes(sent[0].code));
  const bound=await f.call('/api/auth/phone/bind',{challengeId:challenge.data.challengeId,code:sent[0].code,currentPassword:PASSWORD},old.token);
  assert.equal(bound.response.status,200);assert.equal(bound.data.phoneVerified,true);
  const phone=await f.call('/api/auth/phone/login',{phone:'008613800138000',password:PASSWORD});
  assert.equal(phone.response.status,200);assert.equal(phone.data.account.id,'intern-a');
  assert.deepEqual(phone.data.memberships,[{teamId:'team-a',role:'intern'}]);
  const tasks=await f.call('/api/teams/team-a/collection/tasks',undefined,phone.data.token);
  assert.deepEqual(tasks.data.tasks.map(value=>value.id),['task-a']);
  assert.equal((await f.call('/api/teams/team-b/collection/tasks',undefined,phone.data.token)).response.status,404);
  assert.equal((await f.call('/api/auth/phone/reset',{challengeId:challenge.data.challengeId,code:sent[0].code,newPassword:'AnotherDemo!2026',recoveryProof:'unapproved'})).response.status,503);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM team_memberships').get().n,8);
});
test('hybrid synthetic WeChat callback plus real HTTP exchange requires initiating desktop proof',async t=>{
  const verifier=randomBytes(32).toString('base64url'),appId='synthetic-wx';
  const redirectUri='https://auth.synthetic.invalid/api/auth/wechat/callback';
  const wechat={appId,redirectUri,createAuthorizationUrl({state}){return 'https://open.weixin.qq.com/connect/qrconnect?'+new URLSearchParams({appid:appId,redirect_uri:redirectUri,response_type:'code',scope:'snsapi_login',state})+'#wechat_redirect';},exchangeCode:async()=>({appId,openId:'synthetic-open-id',access_token:'SUPPLIER_SECRET_NOT_FOR_CLIENT'})};
  const f=await fixture(t,{wechat});
  f.db.prepare('INSERT INTO team_wechat_identities VALUES (?,?,?,?)').run(appId,'synthetic-open-id','intern-a',Date.now());
  const started=await f.call('/api/auth/wechat/transactions',{codeChallenge:createHash('sha256').update(verifier).digest('base64url')});assert.equal(started.response.status,201);
  const state=new URL(started.data.authorizationUrl).searchParams.get('state');
  const {handleTeamApplicationRequest}=await source('application-api.mjs');
  const callback=await handleTeamApplicationRequest(new Request(redirectUri+'?'+new URLSearchParams({state,code:'synthetic-code'}),{headers:{'Sec-Fetch-Site':'cross-site'}}),{db:f.db,identityProviders:{wechat}});
  assert.equal(callback.status,200);assert.ok(!(await callback.text()).includes('SUPPLIER_SECRET'));
  const prefix='/api/auth/wechat/transactions/'+started.data.transactionId;
  const status=await f.call(prefix+'/status',{pollToken:started.data.pollToken});assert.equal(status.data.status,'ready');
  const denied=await f.call(prefix+'/exchange',{pollToken:started.data.pollToken,codeVerifier:'x'.repeat(43)});assert.equal(denied.response.status,404);
  const exchanged=await f.call(prefix+'/exchange',{pollToken:started.data.pollToken,codeVerifier:verifier});assert.equal(exchanged.response.status,200);
  assert.equal(exchanged.data.account.id,'intern-a');assert.ok(!exchanged.raw.includes('synthetic-open-id'));assert.ok(!exchanged.raw.includes('SUPPLIER_SECRET'));
  assert.equal((await f.call(prefix+'/exchange',{pollToken:started.data.pollToken,codeVerifier:verifier})).response.status,404);
});
