'use strict';
// Independent desktop OAuth acceptance. Every supplier response, account and
// browser launch here is synthetic: no actual WeChat or operating-system launch.
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,createHash}=require('node:crypto');
const {createTeamClient,API_BASE}=require('../desktop/team-client.cjs');
const NOW=1794700000000;
const POLICY={appId:'wx0123456789abcdef',redirectUri:'https://login.shenyi.invalid/api/auth/wechat/callback'};
const PASSWORD='SyntheticDesktop!2026';
const PHONE='13800138000';
const SESSION={account:{id:'intern-a',displayName:'合成员工'},memberships:[{teamId:'team-a',role:'intern'}],expiresAt:NOW+3600000};
const METHODS={mode:'local-preview',methods:{demoUsername:true,phonePassword:true,phoneVerification:true,wechat:true,recovery:false}};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const hash=value=>createHash('sha256').update(value).digest('base64url');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function authUrl(state){const url=new URL('https://open.weixin.qq.com/connect/qrconnect');for(const [key,value]of Object.entries({appid:POLICY.appId,redirect_uri:POLICY.redirectUri,response_type:'code',scope:'snsapi_login',state}))url.searchParams.set(key,value);url.hash='wechat_redirect';return url.href;}
function fixture(options={}){
  const calls=[],opened=[];
  const state=randomBytes(32).toString('base64url'),pollToken=randomBytes(32).toString('base64url');
  const token=randomBytes(32).toString('base64url'),temporaryToken=randomBytes(32).toString('base64url');
  let time=NOW,status='pending',challenge;
  const expiredAt=NOW+300000;
  const start={transactionId:'synthetic-transaction-a',pollToken,authorizationUrl:authUrl(state),expiresAt:expiredAt};
  const fetchImpl=async(url,request)=>{
    assert.ok(url.startsWith(API_BASE+'/api/'),'client contacted a nonlocal service');
    assert.equal(request.redirect,'error','credentialed fetch must refuse redirects');
    assert.equal(request.headers.Origin,'shenyi://app');
    const body=request.body===undefined?undefined:JSON.parse(request.body);
    const call={url,path:new URL(url).pathname,request,body};calls.push(call);
    if(options.respond){const result=await options.respond(call,{start,token,temporaryToken,state,pollToken,SESSION});if(result!==undefined)return result;}
    if(call.path==='/api/auth/methods')return json(METHODS);
    if(call.path==='/api/auth/wechat/transactions'){challenge=body.codeChallenge;assert.equal(request.headers.Authorization,undefined);return json({...start,providerSecret:'never show'},201);}
    if(call.path.endsWith('/status')){assert.deepEqual(body,{pollToken});return json({status:time>=expiredAt?'expired':status,expiresAt:expiredAt,openId:'never show'});}
    if(call.path.endsWith('/cancel')){assert.deepEqual(body,{pollToken});status='canceled';return json({canceled:true});}
    if(call.path==='/api/auth/phone/login'){assert.deepEqual(body,{phone:PHONE,password:PASSWORD});assert.equal(request.headers.Authorization,undefined);return json({token:temporaryToken,...SESSION});}
    if(call.path.endsWith('/link')){assert.equal(request.headers.Authorization,'Bearer '+temporaryToken);assert.equal(body.currentPassword,PASSWORD);assert.equal(body.pollToken,pollToken);assert.equal(hash(body.codeVerifier),challenge);status='ready';return json({linked:true,openId:'never show'});}
    if(call.path.endsWith('/exchange')){assert.equal(request.headers.Authorization,undefined);assert.equal(body.pollToken,pollToken);assert.equal(hash(body.codeVerifier),challenge);status='consumed';return json({token,...SESSION,openId:'never show',privateScope:'never show'});}
    if(call.path==='/api/auth/logout')return json({signedOut:true});
    if(call.path==='/api/auth/session')return json(SESSION);
    if(call.path==='/api/auth/login')return json({token,...SESSION});
    throw Error('Unexpected synthetic route '+call.path);
  };
  const client=createTeamClient({fetchImpl,wechatPolicy:POLICY,openAuthorization:async url=>{opened.push(url);if(options.openAuthorization)return options.openAuthorization(url);},now:()=>time,...options.client});
  return {client,calls,opened,start,state,pollToken,token,temporaryToken,expiresAt:expiredAt,setStatus:value=>{status=value;},setTime:value=>{time=value;},getChallenge:()=>challenge};
}
function assertNoSecrets(value,f){const serialized=JSON.stringify(value);for(const secret of [f.pollToken,f.token,f.temporaryToken,f.state,f.start.transactionId,'never show'])assert.ok(!serialized.includes(secret),'renderer result leaked '+secret);assert.ok(!serialized.includes('authorizationUrl'));assert.ok(!serialized.includes('codeVerifier'));}
const routes=(f,suffix)=>f.calls.filter(call=>call.path.endsWith(suffix));

test('absent desktop browser policy stays closed even if server advertises WeChat',async()=>{
  const f=fixture({client:{wechatPolicy:undefined}});
  assert.equal((await f.client.getAuthMethods()).desktopWechatReady,false);
  await assert.rejects(()=>f.client.startWechatLogin());assert.equal(f.opened.length,0);assert.equal(routes(f,'/transactions').length,0);
});

test('absent native opener cannot create a usable desktop WeChat capability',async()=>{
  const f=fixture({client:{openAuthorization:undefined}});
  assert.equal((await f.client.getAuthMethods()).desktopWechatReady,false);await assert.rejects(()=>f.client.startWechatLogin());assert.equal(f.opened.length,0);
});

test('valid start keeps verifier, transaction and polling secrets in main and opens the one verified URL',async()=>{
  const f=fixture();assert.equal((await f.client.getAuthMethods()).desktopWechatReady,true);
  const result=await f.client.startWechatLogin();assert.deepEqual(result,{status:'pending',expiresAt:f.expiresAt});assertNoSecrets(result,f);
  assert.deepEqual(f.opened,[f.start.authorizationUrl]);assert.match(f.getChallenge(),/^[A-Za-z0-9_-]{43}$/);assert.notEqual(f.getChallenge(),f.pollToken);
  const pending=await f.client.pollWechatLogin();assert.deepEqual(pending,{status:'pending',expiresAt:f.expiresAt});assertNoSecrets(pending,f);
});

const badUrls={
  'javascript protocol':()=> 'javascript:alert(1)',
  'file protocol':()=> 'file:///C:/Windows/System32/cmd.exe',
  'HTTP provider':url=>url.replace('https:','http:'),
  'provider lookalike':url=>url.replace('open.weixin.qq.com','open.weixin.qq.com.evil.invalid'),
  'embedded username':url=>url.replace('https://','https://credential@'),
  'alternate path':url=>url.replace('/connect/qrconnect','/connect/oauth2/authorize'),
  'duplicate app id':url=>url.replace('#wechat_redirect','&appid='+POLICY.appId+'#wechat_redirect'),
  'different app id':url=>url.replace(POLICY.appId,'wxffffffffffffffff'),
  'callback elsewhere':url=>{const parsed=new URL(url);parsed.searchParams.set('redirect_uri','https://evil.invalid/api/auth/wechat/callback');return parsed.href;},
  'extra query':url=>url.replace('#wechat_redirect','&next=evil#wechat_redirect'),
  'unexpected fragment':url=>url.replace('#wechat_redirect','#arbitrary'),
  'missing state':url=>{const parsed=new URL(url);parsed.searchParams.delete('state');return parsed.href;},
  'oversized URL':url=>{const parsed=new URL(url);parsed.searchParams.set('state','a'.repeat(2200));return parsed.href;},
};
for(const [name,attack]of Object.entries(badUrls))test('authorization URL rejects '+name+' without opening the OS browser',async()=>{
  const f=fixture({respond:call=>call.path==='/api/auth/wechat/transactions'?json({...f.start,authorizationUrl:attack(f.start.authorizationUrl)},201):undefined});
  await assert.rejects(()=>f.client.startWechatLogin());assert.equal(f.opened.length,0);
});

test('browser launch failure cancels the server transaction and leaves no resumable local login',async()=>{
  const f=fixture({openAuthorization:async()=>{throw Error('do not forward OS/path details');}});
  await assert.rejects(()=>f.client.startWechatLogin(),error=>!error.message.includes('OS/path'));
  assert.equal(routes(f,'/cancel').length,1);assert.equal((await f.client.pollWechatLogin()).status,'idle');assert.equal(await f.client.getSession(),null);
});

test('ready linked account exchanges exactly once, exposes only its existing employee and memberships',async()=>{
  const f=fixture();await f.client.startWechatLogin();f.setStatus('ready');
  const result=await f.client.pollWechatLogin();assert.deepEqual(result,{status:'signed_in',session:SESSION});assertNoSecrets(result,f);
  assert.deepEqual(await f.client.getSession(),SESSION);assert.equal(f.calls.at(-1).request.headers.Authorization,'Bearer '+f.token);
  assert.equal((await f.client.pollWechatLogin()).status,'idle');assert.equal(routes(f,'/exchange').length,1);
});

test('first association requires verified phone credentials and revokes its temporary session',async()=>{
  const f=fixture();await f.client.startWechatLogin();f.setStatus('binding_required');assert.equal((await f.client.pollWechatLogin()).status,'binding_required');
  const result=await f.client.linkWechatAccount({phone:PHONE,password:PASSWORD});assert.deepEqual(result,{status:'signed_in',session:SESSION});assertNoSecrets(result,f);
  assert.equal(routes(f,'/link').length,1);assert.equal(routes(f,'/exchange').length,1);
  const revoked=routes(f,'/logout');assert.equal(revoked.length,1);assert.equal(revoked[0].request.headers.Authorization,'Bearer '+f.temporaryToken);
  assert.deepEqual(await f.client.getSession(),SESSION);
});

test('failed first association also revokes temporary credentials and does not install their session',async()=>{
  const f=fixture({respond:call=>call.path.endsWith('/link')?json({error:{message:'supplier private detail'}},409):undefined});await f.client.startWechatLogin();f.setStatus('binding_required');await f.client.pollWechatLogin();
  await assert.rejects(()=>f.client.linkWechatAccount({phone:PHONE,password:PASSWORD}),error=>!error.message.includes('supplier private'));
  assert.equal(await f.client.getSession(),null);assert.equal(routes(f,'/exchange').length,0);assert.equal(routes(f,'/logout').length,1);
  assert.equal(routes(f,'/logout')[0].request.headers.Authorization,'Bearer '+f.temporaryToken);
});

test('link refuses wrong state and extra identity or URL fields before any password request',async()=>{
  const f=fixture();await f.client.startWechatLogin();await assert.rejects(()=>f.client.linkWechatAccount({phone:PHONE,password:PASSWORD}));assert.equal(routes(f,'/phone/login').length,0);
  f.setStatus('binding_required');await f.client.pollWechatLogin();
  for(const input of [{phone:PHONE,password:PASSWORD,role:'partner'},{phone:PHONE,password:PASSWORD,url:'https://evil.invalid'},{phone:PHONE,password:PASSWORD,token:'forged'}])await assert.rejects(()=>f.client.linkWechatAccount(input));
  assert.equal(routes(f,'/phone/login').length,0);
});

test('cancel is locally final even when network cancellation fails',async()=>{
  const f=fixture({respond:call=>{if(call.path.endsWith('/cancel'))throw Error('network canceled');}});await f.client.startWechatLogin();await f.client.cancelWechatLogin().catch(()=>{});
  assert.equal((await f.client.pollWechatLogin()).status,'idle');assert.equal(await f.client.getSession(),null);assert.equal(routes(f,'/exchange').length,0);
});

test('cancel during an in-flight transaction start never opens a late authorization URL',async()=>{
  const entered=deferred(),response=deferred();const f=fixture({respond:call=>{if(call.path==='/api/auth/wechat/transactions'){entered.resolve();return response.promise;}}});
  const operation=f.client.startWechatLogin();await entered.promise;await f.client.cancelWechatLogin();response.resolve(json(f.start,201));await assert.rejects(()=>operation);
  assert.equal(f.opened.length,0);assert.equal((await f.client.pollWechatLogin()).status,'idle');assert.equal(await f.client.getSession(),null);
});

test('canceled in-flight status cannot perform a late ready exchange',async()=>{
  const entered=deferred(),response=deferred();const f=fixture({respond:call=>{if(call.path.endsWith('/status')){entered.resolve();return response.promise;}}});await f.client.startWechatLogin();
  const operation=f.client.pollWechatLogin();await entered.promise;await f.client.cancelWechatLogin();response.resolve(json({status:'ready',expiresAt:f.expiresAt}));await assert.rejects(()=>operation);
  assert.equal(routes(f,'/exchange').length,0);assert.equal((await f.client.pollWechatLogin()).status,'idle');assert.equal(await f.client.getSession(),null);
});

test('canceled in-flight exchange cannot install the delayed bearer session',async()=>{
  const entered=deferred(),response=deferred();const f=fixture({respond:call=>{if(call.path.endsWith('/exchange')){entered.resolve();return response.promise;}}});await f.client.startWechatLogin();f.setStatus('ready');
  const operation=f.client.pollWechatLogin();await entered.promise;await f.client.cancelWechatLogin();response.resolve(json({token:f.token,...SESSION}));await assert.rejects(()=>operation);
  assert.equal(await f.client.getSession(),null);assert.equal((await f.client.pollWechatLogin()).status,'idle');
  assert.ok(routes(f,'/logout').some(call=>call.request.headers.Authorization==='Bearer '+f.token),'late exchanged session must be revoked instead of remaining usable');
});

test('cancel while the native browser opener is awaiting cannot revive the transaction',async()=>{
  const entered=deferred(),launched=deferred();const f=fixture({openAuthorization:async()=>{entered.resolve();await launched.promise;}});
  const operation=f.client.startWechatLogin();await entered.promise;await f.client.cancelWechatLogin();launched.resolve();await assert.rejects(()=>operation);
  assert.equal((await f.client.pollWechatLogin()).status,'idle');assert.equal(await f.client.getSession(),null);assert.ok(routes(f,'/cancel').length>=1,'canceled browser launch must revoke its server transaction');
});

test('expired transaction cannot exchange even when a supplier reports ready',async()=>{
  const f=fixture();await f.client.startWechatLogin();f.setStatus('ready');f.setTime(f.expiresAt+1);
  assert.equal((await f.client.pollWechatLogin()).status,'expired');assert.equal(routes(f,'/exchange').length,0);assert.equal(await f.client.getSession(),null);
});

test('ordinary account login invalidates an outstanding WeChat transaction',async()=>{
  const f=fixture();await f.client.startWechatLogin();await f.client.login({username:'intern-a',password:PASSWORD});f.setStatus('ready');
  assert.equal((await f.client.pollWechatLogin()).status,'idle');assert.equal(routes(f,'/exchange').length,0);assert.deepEqual(await f.client.getSession(),SESSION);
});

test('ordinary phone login invalidates an outstanding WeChat transaction',async()=>{
  const f=fixture();await f.client.startWechatLogin();await f.client.loginPhone({phone:PHONE,password:PASSWORD});f.setStatus('ready');
  assert.equal((await f.client.pollWechatLogin()).status,'idle');assert.equal(routes(f,'/exchange').length,0);assert.deepEqual(await f.client.getSession(),SESSION);
});

test('clearing the main-process account invalidates an outstanding WeChat transaction',async()=>{
  const f=fixture();await f.client.startWechatLogin();f.client.clearSession();f.setStatus('ready');
  assert.equal((await f.client.pollWechatLogin()).status,'idle');assert.equal(routes(f,'/exchange').length,0);assert.equal(await f.client.getSession(),null);
});

test('concurrent starts cannot launch two different authorization transactions',async()=>{
  const entered=deferred(),response=deferred();const f=fixture({respond:call=>{if(call.path==='/api/auth/wechat/transactions'){entered.resolve();return response.promise;}}});
  const operation=f.client.startWechatLogin();await entered.promise;await assert.rejects(()=>f.client.startWechatLogin());response.resolve(json(f.start,201));await operation;
  assert.equal(routes(f,'/transactions').length,1);assert.equal(f.opened.length,1);
});

test('concurrent polls cannot perform two exchanges for one ready transaction',async()=>{
  const entered=deferred(),response=deferred();const f=fixture({respond:call=>{if(call.path.endsWith('/status')){entered.resolve();return response.promise;}}});await f.client.startWechatLogin();
  const operation=f.client.pollWechatLogin();await entered.promise;await assert.rejects(()=>f.client.pollWechatLogin());response.resolve(json({status:'ready',expiresAt:f.expiresAt}));await operation;
  assert.equal(routes(f,'/status').length,1);assert.equal(routes(f,'/exchange').length,1);
});

test('poll cannot race a first association and consume the same ready transaction',async()=>{
  const entered=deferred(),response=deferred();const f=fixture({respond:call=>{if(call.path==='/api/auth/phone/login'){entered.resolve();return response.promise;}}});await f.client.startWechatLogin();f.setStatus('binding_required');await f.client.pollWechatLogin();
  const operation=f.client.linkWechatAccount({phone:PHONE,password:PASSWORD});await entered.promise;await assert.rejects(()=>f.client.pollWechatLogin());await assert.rejects(()=>f.client.linkWechatAccount({phone:PHONE,password:PASSWORD}));response.resolve(json({token:f.temporaryToken,...SESSION}));
  await operation;assert.equal(routes(f,'/phone/login').length,1);assert.equal(routes(f,'/link').length,1);assert.equal(routes(f,'/exchange').length,1);assert.equal(routes(f,'/logout').length,1);
});

test('cancel while phone authentication is pending revokes its late temporary token',async()=>{
  const entered=deferred(),response=deferred();const f=fixture({respond:call=>{if(call.path==='/api/auth/phone/login'){entered.resolve();return response.promise;}}});await f.client.startWechatLogin();f.setStatus('binding_required');await f.client.pollWechatLogin();
  const operation=f.client.linkWechatAccount({phone:PHONE,password:PASSWORD});await entered.promise;await f.client.cancelWechatLogin();response.resolve(json({token:f.temporaryToken,...SESSION}));await assert.rejects(()=>operation);
  assert.equal(routes(f,'/link').length,0);assert.equal(routes(f,'/exchange').length,0);assert.equal(routes(f,'/logout').length,1);assert.equal(routes(f,'/logout')[0].request.headers.Authorization,'Bearer '+f.temporaryToken);assert.equal(await f.client.getSession(),null);
});

test('main account generation change revokes late phone authentication before it can link',async()=>{
  const entered=deferred(),response=deferred();const f=fixture({respond:call=>{if(call.path==='/api/auth/phone/login'){entered.resolve();return response.promise;}}});await f.client.startWechatLogin();f.setStatus('binding_required');await f.client.pollWechatLogin();
  const operation=f.client.linkWechatAccount({phone:PHONE,password:PASSWORD});await entered.promise;f.client.clearSession();response.resolve(json({token:f.temporaryToken,...SESSION}));await assert.rejects(()=>operation);
  assert.equal(routes(f,'/link').length,0);assert.equal(routes(f,'/exchange').length,0);assert.equal(routes(f,'/logout').length,1);assert.equal(routes(f,'/logout')[0].request.headers.Authorization,'Bearer '+f.temporaryToken);assert.equal(await f.client.getSession(),null);
});

test('main account generation change revokes an exchanged bearer delivered after clearing',async()=>{
  const entered=deferred(),response=deferred();const f=fixture({respond:call=>{if(call.path.endsWith('/exchange')){entered.resolve();return response.promise;}}});await f.client.startWechatLogin();f.setStatus('ready');
  const operation=f.client.pollWechatLogin();await entered.promise;f.client.clearSession();response.resolve(json({token:f.token,...SESSION}));await assert.rejects(()=>operation);
  assert.equal(await f.client.getSession(),null);assert.equal((await f.client.pollWechatLogin()).status,'idle');assert.ok(routes(f,'/logout').some(call=>call.request.headers.Authorization==='Bearer '+f.token));
});

test('cancel during temporary-session cleanup cannot leave an already installed final account',async()=>{
  const entered=deferred(),response=deferred();const f=fixture({respond:(call,context)=>{if(call.path==='/api/auth/logout'&&call.request.headers.Authorization==='Bearer '+context.temporaryToken){entered.resolve();return response.promise;}}});await f.client.startWechatLogin();f.setStatus('binding_required');await f.client.pollWechatLogin();
  const operation=f.client.linkWechatAccount({phone:PHONE,password:PASSWORD});await entered.promise;await f.client.cancelWechatLogin();
  const duringCleanup=await f.client.getSession();response.resolve(json({signedOut:true}));const result=await operation.then(value=>({value}),error=>({error}));
  assert.equal(duringCleanup,null,'cancel must not leave the final session installed while temporary revocation is pending');
  assert.ok(result.error,'a canceled first association must reject its late success');assert.equal(await f.client.getSession(),null);
  assert.ok(routes(f,'/logout').some(call=>call.request.headers.Authorization==='Bearer '+f.token),'canceled final session must also be revoked');
});
