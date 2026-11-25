'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {validWechatAuthorization}=require('../desktop/wechat-login.cjs');

const appId='wxAbcdef0123456789';
const appSecret='only&synthetic+secret?/#';
const redirectUri='https://team.example.invalid/api/auth/wechat/callback';
const configuration={appId,appSecret,redirectUri};
const state=Buffer.alloc(32,28).toString('base64url');
const code='synthetic+code?&=/#';
const openId='synthetic-OpenId_123';
const provisional={openid:openId,scope:'snsapi_login',access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',unionid:'synthetic-union-id',expires_in:7200};
const api=import('../server/team/wechat-open-platform.mjs');
const responseOK=()=>Response.json(provisional);

test('authorization builds exactly the official website request and passes existing server/desktop checks',async()=>{
  const {createWechatOpenPlatform}=await api;
  const {isWechatConfigured}=await import('../server/team/wechat-api.mjs');
  const transport=()=>assert.fail('authorization URL creation used a remote request');
  const provider=createWechatOpenPlatform(configuration,{transport});
  assert.ok(Object.isFrozen(provider));
  assert.deepEqual(Object.keys(provider),['appId','redirectUri','createAuthorizationUrl','exchangeCode']);
  assert.equal(provider.appSecret,undefined);
  assert.ok(isWechatConfigured({wechat:provider}));
  const value=provider.createAuthorizationUrl({state,redirectUri});
  const url=new URL(value);
  assert.equal(url.origin+url.pathname,'https://open.weixin.qq.com/connect/qrconnect');
  assert.equal(url.hash,'#wechat_redirect');
  assert.deepEqual([...url.searchParams],Object.entries({appid:appId,redirect_uri:redirectUri,response_type:'code',scope:'snsapi_login',state}));
  assert.ok(validWechatAuthorization(value,{appId,redirectUri}));
});

test('code exchange uses one fixed HTTPS GET and returns only the identity',async()=>{
  const {createWechatOpenPlatform}=await api;
  let count=0;
  const config={...configuration};
  const provider=createWechatOpenPlatform(config,{transport:async(target,options)=>{
    count++;
    const url=new URL(target);
    assert.equal(url.origin+url.pathname,'https://api.weixin.qq.com/sns/oauth2/access_token');
    assert.deepEqual([...url.searchParams],Object.entries({appid:appId,secret:appSecret,code,grant_type:'authorization_code'}));
    assert.equal(url.hash,'');
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert.equal(options.cache,'no-store');
    assert.equal(options.credentials,'omit');
    assert.equal(options.referrerPolicy,'no-referrer');
    assert.equal(options.body,undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({...provisional,scope:'snsapi_base, snsapi_login'});
  }});
  config.appSecret='changed-after-configuration';
  const identity=await provider.exchangeCode({code,redirectUri});
  assert.deepEqual(identity,{appId,openId});
  assert.ok(Object.isFrozen(identity));
  assert.equal(count,1);
});

test('invalid configuration or transaction inputs never dispatch',async()=>{
  const {createWechatOpenPlatform}=await api;
  let seen=0;
  const transport=async()=>{seen++;return responseOK();};
  for(const config of [null,{...configuration,appId:'not-wx-id'},{...configuration,appId:'wx'},{...configuration,appId:'wxa-b'},
    {...configuration,appSecret:'bad\nvalue'},{...configuration,endpoint:'https://other.invalid'},
    ...['http://team.example.invalid','https://team.example.invalid:443','https://team.example.invalid:9443','https://user@team.example.invalid',
      'https://Team.Example.Invalid','https://127.0.0.1','https://[::1]','https://team.example.invalid.','https://localhost']
      .map(host=>({...configuration,redirectUri:host+'/api/auth/wechat/callback'})),
    ...['?','?query=1','#','#target','/'].map(suffix=>({...configuration,redirectUri:redirectUri+suffix}))]){
    assert.throws(()=>createWechatOpenPlatform(config,{transport}),{code:'WECHAT_OPEN_PLATFORM_CONFIG_INVALID'});
  }
  const provider=createWechatOpenPlatform(configuration,{transport});
  for(const input of [null,{state:'A'.repeat(42)+'B',redirectUri},{state:state+'\n',redirectUri},{state,redirectUri:redirectUri+'?query'},
    {state,redirectUri,endpoint:'https://other.invalid'}]){
    assert.throws(()=>provider.createAuthorizationUrl(input),{code:'WECHAT_OPEN_PLATFORM_INPUT_INVALID'});
  }
  for(const input of [null,{code:'',redirectUri},{code:'not valid',redirectUri},{code:'x'.repeat(513),redirectUri},{code,redirectUri:redirectUri+'#other'},
    {code,redirectUri,appid:'other'}]){
    await assert.rejects(provider.exchangeCode(input),{code:'WECHAT_OPEN_PLATFORM_INPUT_INVALID'});
  }
  assert.equal(seen,0);
});

test('supplier rejects malformed credentials, failures and redirects without leaking provider material',async()=>{
  const {createWechatOpenPlatform}=await api;
  const privateFailures=[appSecret,code,provisional.access_token,provisional.refresh_token,'supplier diagnostics should stay private'];
  const attempts=[
    ()=>{throw new Error(privateFailures.join(' '));},
    ()=>Response.json({errcode:40029,errmsg:privateFailures.at(-1)}),
    ()=>Response.json({...provisional,errcode:0}),
    ()=>Response.json({...provisional,errcode:40029}),
    ()=>Response.json({...provisional,openid:'invalid @id'}),
    ()=>Response.json({...provisional,openid:''}),
    ()=>Response.json({...provisional,scope:'snsapi_base'}),
    ()=>Response.json({...provisional,scope:'snsapi_login,snsapi_unknown'}),
    ()=>Response.json({...provisional,scope:'snsapi_login\n'}),
    ()=>Response.json({...provisional,access_token:''}),
    ()=>Response.json({openid:openId,scope:'snsapi_login'}),
    ()=>Response.json(provisional,{status:429}),
    ()=>Response.redirect('https://other.invalid/'),
    ()=>Object.defineProperty(responseOK(),'url',{value:'https://other.invalid/'}),
    ()=>Object.defineProperty(responseOK(),'redirected',{value:true}),
    ()=>new Response(null,{status:204}),
    ()=>new Response('{"openid":"missing bracket"'),
    ()=>new Response(new Uint8Array([0xff])),
  ];
  for(const produce of attempts){
    let callCount=0;
    const provider=createWechatOpenPlatform(configuration,{transport:async()=>{callCount++;return produce();}});
    await assert.rejects(provider.exchangeCode({code,redirectUri}),error=>{
      assert.equal(error.code,'WECHAT_OPEN_PLATFORM_EXCHANGE_FAILED');
      assert.equal(error.message,'未能验证微信授权。');
      assert.equal(error.cause,undefined);
      assert.ok(privateFailures.every(value=>!error.stack.includes(value)));
      return true;
    });
    assert.equal(callCount,1);
  }
});

test('advertised and streaming response bounds both cancel excess bytes',async()=>{
  const {createWechatOpenPlatform}=await api;
  for(const advertised of [true,false]){
    let canceled=false;
    const transport=async()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(8193));},cancel(){canceled=true;}}),
      {headers:advertised?{'Content-Length':'16385'}:{}});
    const provider=createWechatOpenPlatform(configuration,{transport});
    await assert.rejects(provider.exchangeCode({code,redirectUri}),{code:'WECHAT_OPEN_PLATFORM_EXCHANGE_FAILED'});
    assert.equal(canceled,true);
  }
});

test('the fixed deadline bounds transport and supplier body reads without retry',async t=>{
  const {createWechatOpenPlatform}=await api;
  t.mock.timers.enable({apis:['setTimeout']});
  for(const headersDelivered of [false,true]){
    let signal,canceled=false,calls=0;
    const transport=async(_target,options)=>{
      calls++;
      signal=options.signal;
      if(!headersDelivered)return new Promise(()=>{});
      return new Response(new ReadableStream({cancel(){canceled=true;}}));
    };
    const provider=createWechatOpenPlatform(configuration,{transport});
    const pending=assert.rejects(provider.exchangeCode({code,redirectUri}),{code:'WECHAT_OPEN_PLATFORM_EXCHANGE_FAILED'});
    await Promise.resolve();
    t.mock.timers.tick(5000);
    await pending;
    assert.equal(signal.aborted,true);
    assert.equal(calls,1);
    if(headersDelivered)assert.equal(canceled,true);
  }
});
