'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');

const endpoint='https://dysmsapi.aliyuncs.com/';
const nonce='7636b015-a8e7-4067-95a2-3e2d098940a8';
const syntheticToken='SyntheticToken+/-=.';
const configuration={accessKeyId:'ExampleTestAK',accessKeySecret:'exampleSmsSecret-test-only',signName:"审易 测试!'()*~",
  templates:{bind:'SMS_999001',reset:'SMS_999002',activate:'SMS_999003','first-admin':'SMS_999004'}};
const defaultMessage={phone:'+8613800009905',code:'034512',purpose:'first-admin',challengeId:'803ac4ee-b673-4ce7-a6cf-34ebf4059ff1'};
const responseOK=()=>Response.json({Code:'OK',RequestId:'synthetic-request',BizId:'synthetic-receipt'});
const now=()=>Date.parse('2026-11-18T08:09:10.123Z');
const source=import('../server/team/aliyun-sms.mjs');

test('SendSms wire format matches independent ACS3 signatures with and without the STS token',async()=>{
  const {createAliyunSms}=await source;
  const query='PhoneNumbers=13800009905&SignName=%E5%AE%A1%E6%98%93%20%E6%B5%8B%E8%AF%95%21%27%28%29%2A~&TemplateCode=SMS_999004&TemplateParam=%7B%22code%22%3A%22034512%22%7D';
  for(const useToken of [false,true]){
    let count=0;
    const sms=createAliyunSms({...configuration,...(useToken?{securityToken:syntheticToken}:{})},{now,nonce:()=>nonce,transport:async(url,options)=>{
      count++;
      assert.equal(url,endpoint+'?'+query);
      assert.equal(options.method,'POST');
      assert.equal(options.redirect,'error');
      assert.equal(options.body,undefined);
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers.host,'dysmsapi.aliyuncs.com');
      assert.equal(options.headers['x-acs-action'],'SendSms');
      assert.equal(options.headers['x-acs-date'],'2026-11-18T08:09:10Z');
      assert.equal(options.headers['x-acs-version'],'2017-05-25');
      assert.equal(options.headers['x-acs-signature-nonce'],nonce);
      assert.equal(options.headers['x-acs-content-sha256'],'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      assert.equal(options.headers['x-acs-security-token'],useToken?syntheticToken:undefined);
      const tokenHeader=useToken?'x-acs-security-token;':'';
      const signature=useToken?'54c15a5c0d38eba3b2262881253e55297f7ca9759eeee6827afb9a2f69f17f78':'f6763e299333ce4f52ef68e66d2c7bb56b64afdbb30422cf3604cfc90912b9bf';
      assert.equal(options.headers.authorization,'ACS3-HMAC-SHA256 Credential=ExampleTestAK,SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;'+tokenHeader+'x-acs-signature-nonce;x-acs-version,Signature='+signature);
      assert.ok(!url.includes(defaultMessage.challengeId));
      return responseOK();
    }});
    assert.deepEqual(Object.keys(sms),['send']);
    assert.ok(Object.isFrozen(sms));
    assert.equal(await sms.send(defaultMessage),undefined);
    assert.equal(count,1);
  }
});

test('four purposes select only their snapshotted approved templates',async()=>{
  const {createAliyunSms}=await source;
  const templates={...configuration.templates},requests=[];
  const sms=createAliyunSms({...configuration,templates},{transport:async(url,options)=>{
    requests.push({target:new URL(url),nonce:options.headers['x-acs-signature-nonce']});
    return responseOK();
  }});
  templates.bind='SMS_999999';
  for(const purpose of Object.keys(configuration.templates))await sms.send({...defaultMessage,purpose});
  assert.deepEqual(requests.map(({target})=>target.searchParams.get('TemplateCode')),Object.values(configuration.templates));
  assert.equal(new Set(requests.map(request=>request.nonce)).size,4);
  for(const {target} of requests){
    assert.deepEqual([...target.searchParams.keys()],['PhoneNumbers','SignName','TemplateCode','TemplateParam']);
    assert.equal(target.searchParams.get('TemplateParam'),'{"code":"034512"}');
  }
});

test('invalid configuration and SMS inputs are rejected without dispatch',async()=>{
  const {createAliyunSms}=await source;
  let sent=0;
  const transport=async()=>{sent++;return responseOK();};
  for(const invalid of [null,{...configuration,endpoint:'https://other.invalid'},
    {...configuration,accessKeyId:'AK,Signature=bad'},{...configuration,securityToken:'a\r\nb'},
    {...configuration,signName:' invalid '},{...configuration,templates:{...configuration.templates,bind:'not-a-template'}},
    {...configuration,templates:{bind:'SMS_999001'}},{...configuration,templates:{...configuration.templates,bonus:'SMS_999005'}}]){
    assert.throws(()=>createAliyunSms(invalid,{transport}),{code:'ALIYUN_SMS_CONFIG_INVALID'});
  }
  const sms=createAliyunSms(configuration,{transport});
  for(const invalid of [null,{...defaultMessage,phone:'13800009905'},{...defaultMessage,phone:'+8613800009905,+8613800000001'},
    {...defaultMessage,code:'034512\n'},{...defaultMessage,code:34512},{...defaultMessage,purpose:'unknown'},
    {...defaultMessage,challengeId:'not-a-challenge'},{...defaultMessage,extra:'unknown'}]){
    await assert.rejects(sms.send(invalid),{code:'ALIYUN_SMS_INPUT_INVALID'});
  }
  assert.equal(sent,0);
});

test('network, HTTP and provider failures are redacted and never retried',async()=>{
  const {createAliyunSms}=await source;
  const confidential='synthetic phone, code and provider body';
  const behaviors=[
    ()=>{throw new Error(confidential);},
    ()=>Response.json({Code:'OK',Message:confidential},{status:403}),
    ()=>Response.json({Code:'BUSINESS_LIMIT_CONTROL',Message:confidential}),
    ()=>Response.redirect('https://other.invalid/'),
    ()=>new Response('{"Code":"OK"',{status:200}),
    ()=>new Response(new Uint8Array([0xff]),{status:200}),
    ()=>Object.defineProperty(responseOK(),'redirected',{value:true}),
    ()=>Object.defineProperty(responseOK(),'url',{value:'https://other.invalid/'}),
  ];
  for(const behavior of behaviors){
    let sent=0;
    const sms=createAliyunSms(configuration,{transport:async()=>{sent++;return behavior();}});
    await assert.rejects(sms.send(defaultMessage),error=>{
      assert.equal(error.code,'ALIYUN_SMS_SEND_FAILED');
      assert.equal(error.message,'短信服务未确认受理。');
      assert.equal(error.cause,undefined);
      assert.equal(error.stack.includes(confidential),false);
      return true;
    });
    assert.equal(sent,1);
  }
});

test('stream and advertised response limits reject and cancel the oversized body',async()=>{
  const {createAliyunSms}=await source;
  for(const advertised of [true,false]){
    let canceled=false;
    const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(8193));},cancel(){canceled=true;}});
    const sms=createAliyunSms(configuration,{transport:async()=>new Response(stream,{headers:advertised?{'Content-Length':'16385'}:{}})});
    await assert.rejects(sms.send(defaultMessage),{code:'ALIYUN_SMS_SEND_FAILED'});
    assert.equal(canceled,true);
  }
});

test('the same fixed deadline covers transport and response reads',async t=>{
  const {createAliyunSms}=await source;
  t.mock.timers.enable({apis:['setTimeout']});
  for(const stream of [false,true]){
    let signal, canceled=false, sent=0;
    const sms=createAliyunSms(configuration,{transport:async(_url,options)=>{
      signal=options.signal;
      sent++;
      if(!stream)return new Promise(()=>{});
      return new Response(new ReadableStream({cancel(){canceled=true;}}));
    }});
    const pending=assert.rejects(sms.send(defaultMessage),{code:'ALIYUN_SMS_SEND_FAILED'});
    await Promise.resolve();
    t.mock.timers.tick(5000);
    await pending;
    assert.equal(signal.aborted,true);
    assert.equal(sent,1);
    if(stream)assert.equal(canceled,true);
  }
});
