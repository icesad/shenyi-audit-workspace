'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{createHmac}=require('node:crypto');
const api=import(pathToFileURL(path.resolve(__dirname,'../server/team/billing-simulation.mjs')).href);
const DOMAIN=Buffer.from('shenyi.billing.simulation.v1\0'),LIMIT=16384;
const KEY=Buffer.from('only-synthetic-gateway-key-material-2026');
const options=()=>({subscriptionEnforcement:'team-management-v1',identityProviders:{deviceProofRequired:true}});
const offer=()=>({id:'annual-synthetic',revision:3,product:'team-annual-renewal',amountMinor:12345,currency:'CNY'});
const config=(extra={})=>({mode:'simulation-v1',merchantId:'synthetic-merchant',signingKey:Buffer.from(KEY),offers:[offer()],...extra});
const receipt=(extra={})=>({protocol:'shenyi-simulation-payment-v1',merchantId:'synthetic-merchant',eventId:'11111111-1111-4111-8111-111111111111',transactionId:'22222222-2222-4222-8222-222222222222',orderId:'33333333-3333-4333-8333-333333333333',product:'team-annual-renewal',amountMinor:12345,currency:'CNY',status:'succeeded',paidAt:Date.parse('2026-11-18T00:00:00.123Z'),...extra});
const bytes=value=>Buffer.from(JSON.stringify(value));
// Independent oracle: the actual payload bytes, rather than the product's
// serializer/sign helper, are domain-separated with the synthetic server key.
const hmac=(body,key=KEY,domain=DOMAIN)=>createHmac('sha256',key).update(domain).update(body).digest('hex');
const invalid=error=>error?.status===400&&error.code==='INVALID_INPUT';
const signatureError=error=>error?.status===403&&error.code==='SIMULATION_SIGNATURE_REQUIRED';
const tooLarge=error=>error?.status===413&&error.code==='TOO_LARGE';
async function setup(){const m=await api;return{...m,cfg:m.billingSimulationConfiguration(config(),options())};}
function request(body,signature,{contentType='application/json',length,...extra}={}){return new Request('http://127.0.0.1/api/billing/simulation/notifications',{method:'POST',headers:{...(contentType===null?{}:{'Content-Type':contentType}),...(signature===null?{}:{'X-Shenyi-Simulation-Signature':signature}),...(length===undefined?{}:{'Content-Length':String(length)})},body,...(body instanceof ReadableStream?{duplex:'half'}:{}),...extra});}

test('configuration is off by default and enabling simulation requires trusted strict management scope',async()=>{
 const {billingSimulationConfiguration:configure}=await api;assert.equal(configure(),null);assert.equal(configure(undefined),null);assert.equal(configure(null,{subscriptionEnforcement:'wrong'}),null);
 for(const mode of [undefined,'disabled','workspace-create-v1','business-data-v1','team-management-v2',false])assert.throws(()=>configure(config(),{subscriptionEnforcement:mode,identityProviders:{deviceProofRequired:true}}),TypeError);
 for(const providers of [undefined,{}, {deviceProofRequired:false},{deviceProofRequired:1}])assert.throws(()=>configure(config(),{subscriptionEnforcement:'team-management-v1',identityProviders:providers}),TypeError);
 for(const value of [false,{},config({mode:'production'}),config({merchantId:'bad merchant'}),config({signingKey:Buffer.alloc(31)}),config({signingKey:Buffer.alloc(129)}),config({signingKey:'a'.repeat(32)}),config({lookupPayment:true})])assert.throws(()=>configure(value,options()),TypeError);
 assert.equal(configure(config({signingKey:Buffer.alloc(32)}),options()).signingKey.length,32);assert.equal(configure(config({signingKey:Buffer.alloc(128)}),options()).signingKey.length,128);
});

test('validated offers and secret key are independent copies; public receipt serialization contains no secret',async()=>{
 const {billingSimulationConfiguration:configure,simulationReceiptBytes,verifySimulationPaymentEnvelope}=await api;let called=0;const input=config({lookupPayment:()=>{called++;}}),copy=structuredClone(input.offers),cfg=configure(input,options());
 assert.equal(Object.isFrozen(cfg),true);assert.equal(Object.isFrozen(cfg.offers),true);assert.equal(Object.isFrozen(cfg.offers[0]),true);assert.notEqual(cfg.signingKey,input.signingKey);assert.notEqual(cfg.offers,input.offers);assert.notEqual(cfg.offers[0],input.offers[0]);
 input.signingKey.fill(0);input.offers[0].amountMinor=999;input.offers[0].id='changed';input.offers.push(offer());assert.deepEqual(cfg.offers,copy);assert.deepEqual(cfg.signingKey,KEY);assert.equal(called,0);
 const body=simulationReceiptBytes(receipt()),got=verifySimulationPaymentEnvelope(body,hmac(body),cfg);assert.deepEqual(got,receipt());assert.equal(Object.isFrozen(got),true);assert.equal(Object.hasOwn(got,'signingKey'),false);assert.equal(body.includes(KEY),false);assert.equal(JSON.stringify(got).includes(KEY.toString()),false);
});

test('offer definitions reject duplicate IDs, unsafe prices, malformed fields and active accessors without invoking them',async()=>{
 const {billingSimulationConfiguration:configure}=await api;let called=0;const getter=offer();Object.defineProperty(getter,'amountMinor',{enumerable:true,get(){called++;return 12345;}});
 const arrayGetter=[];Object.defineProperty(arrayGetter,'0',{enumerable:true,get(){called++;return offer();}});arrayGetter.length=1;
 const variants=[[],Array.from({length:11},(_,i)=>({...offer(),id:'annual-'+i})),[offer(),offer()],[{...offer(),revision:0}],[{...offer(),amountMinor:0}],[{...offer(),amountMinor:-0}],[{...offer(),amountMinor:1.5}],[{...offer(),amountMinor:Number.MAX_SAFE_INTEGER+1}],[{...offer(),currency:'USD'}],[{...offer(),product:'seat-upgrade'}],[{...offer(),extra:true}],[getter],arrayGetter,new Array(1),Object.assign([offer()],{extra:true}),Object.assign(Object.create(null),{0:offer(),length:1})];
 for(const offers of variants)assert.throws(()=>configure(config({offers}),options()),TypeError);assert.equal(called,0);
 const ten=Array.from({length:10},(_,i)=>({...offer(),id:'annual-'+i}));assert.equal(configure(config({offers:ten}),options()).offers.length,10);
});

test('configuration rejects proxies at every passive input boundary without running traps',async()=>{
 const {billingSimulationConfiguration:configure}=await api;let calls=0;const traps={get(){calls++;throw Error('must not execute');},getPrototypeOf(){calls++;throw Error('must not execute');},ownKeys(){calls++;throw Error('must not execute');}};
 for(const input of [new Proxy(config(),traps),config({offers:new Proxy([offer()],traps)}),config({offers:[new Proxy(offer(),traps)]}),config({signingKey:new Proxy(Buffer.from(KEY),traps)})]){assert.throws(()=>configure(input,options()),TypeError);assert.equal(calls,0);}
 const getter=config();Object.defineProperty(getter,'merchantId',{enumerable:true,get(){calls++;return 'synthetic-merchant';}});assert.throws(()=>configure(getter,options()),TypeError);assert.equal(calls,0);
});

test('independent domain HMAC verifies exact canonical bytes and matches the trusted helper',async()=>{
 const {cfg,verifySimulationPaymentEnvelope:verify,signSimulationPayment:sign,simulationReceiptBytes}=await setup(),input=receipt(),body=bytes(input),expected=hmac(body);
 assert.deepEqual(verify(body,expected,cfg),input);assert.deepEqual(simulationReceiptBytes(input),body);const signed=sign(input,cfg);assert.equal(Object.isFrozen(signed),true);assert.equal(signed.signature,expected);assert.deepEqual(signed.body,body);
});

test('wrong keys and other HMAC domains cannot authenticate the same receipt bytes',async()=>{
 const {cfg,verifySimulationPaymentEnvelope:verify}=await setup(),body=bytes(receipt());
 for(const signed of [hmac(body,Buffer.alloc(32,1)),hmac(body,KEY,Buffer.alloc(0)),hmac(body,KEY,Buffer.from('shenyi.billing.simulation.v1')),hmac(body,KEY,Buffer.from('shenyi.billing.simulation.v2\0'))])assert.throws(()=>verify(body,signed,cfg),signatureError);
});

test('signature syntax is exactly 64 lowercase hexadecimal characters, with no coercion or whitespace',async()=>{
 const {cfg,verifySimulationPaymentEnvelope:verify}=await setup(),body=bytes(receipt()),signed=hmac(body);let called=0;assert.match(signed,/[a-f]/);
 for(const value of [undefined,null,false,Buffer.from(signed),{toString(){called++;return signed;}},signed.toUpperCase(),signed.slice(1),signed+'0',' '+signed,signed+'\n','g'.repeat(64),'_'.repeat(64),'0'.repeat(64)])assert.throws(()=>verify(body,value,cfg),signatureError);
 assert.equal(called,0);
});

test('authenticated wrong merchant, failed status or invalid amount never become a successful receipt',async()=>{
 const {cfg,verifySimulationPaymentEnvelope:verify}=await setup();
 for(const change of [{merchantId:'another-merchant'},{status:'failed'},{status:'pending'},{amountMinor:0},{amountMinor:-1},{amountMinor:1.5},{amountMinor:Number.MAX_SAFE_INTEGER+1},{amountMinor:'12345'},{currency:'USD'},{protocol:'production-payment'},{product:'seat-upgrade'},{paidAt:-1},{paidAt:8640000000000001},{orderId:'33333333-3333-4333-8333-333333333333\n'}]){const body=bytes(receipt(change));assert.throws(()=>verify(body,hmac(body),cfg),invalid);}
});

test('authenticated noncanonical JSON, duplicate keys and numeric alternate encodings are rejected',async()=>{
 const {cfg,verifySimulationPaymentEnvelope:verify}=await setup(),input=receipt(),canonical=JSON.stringify(input);
 const variants=[' '+canonical,canonical+'\n',JSON.stringify(input,null,2),JSON.stringify(Object.fromEntries(Object.entries(input).reverse())),canonical.replace('"amountMinor":12345','"amountMinor":12345,"amountMinor":12345'),canonical.replace('"status":"succeeded"','"status":"failed","status":"succeeded"'),canonical.replace('"amountMinor":12345','"amountMinor":1.2345e4'),canonical.replace('"merchantId"','"merchant\\u0049d"')];
 for(const text of variants){const body=Buffer.from(text);assert.throws(()=>verify(body,hmac(body),cfg),invalid,text);}
});

test('correct signatures on malformed JSON, invalid UTF8, unknown fields or nonobject data still reject',async()=>{
 const {cfg,verifySimulationPaymentEnvelope:verify}=await setup(),good=bytes(receipt());
 const variants=[Buffer.from('{'),Buffer.from('null'),Buffer.from('[]'),Buffer.from('123'),Buffer.from('"value"'),Buffer.concat([good,Buffer.from([0])]),Buffer.from([0xc3,0x28]),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),good]),bytes({...receipt(),secret:'unexpected'}),bytes({...receipt(),paidAt:null})];
 for(const body of variants)assert.throws(()=>verify(body,hmac(body),cfg),invalid);
});

test('passive receipt validation rejects getters, proxies and serialization hooks without invoking them',async()=>{
 const {validateSimulationPaymentReceipt:validate,simulationReceiptBytes:serialize}=await api;let calls=0;const getter=receipt();Object.defineProperty(getter,'amountMinor',{enumerable:true,get(){calls++;return 12345;}});
 const hook=receipt();Object.defineProperty(hook,'toJSON',{get(){calls++;return()=>receipt();}});const hidden=receipt();Object.defineProperty(hidden,'paidAt',{value:1,enumerable:false});
 const proxy=new Proxy(receipt(),{getPrototypeOf(){calls++;return Object.prototype;},ownKeys(){calls++;return Object.keys(receipt());},get(){calls++;return 0;}}),revoked=Proxy.revocable(receipt(),{});revoked.revoke();
 for(const value of [getter,hook,hidden,proxy,revoked.proxy,Object.assign(Object.create({toJSON(){calls++;return receipt();}}),receipt()),Object.assign(Object.create(null),receipt()),{...receipt(),[Symbol('extra')]:1},{...receipt(),amountMinor:{valueOf(){calls++;return 12345;}}}]){assert.throws(()=>validate(value),invalid);assert.throws(()=>serialize(value),invalid);}
 assert.equal(calls,0);
});

test('the raw envelope requires a real bounded Buffer and rejects Buffer proxies without triggering traps',async()=>{
 const {cfg,verifySimulationPaymentEnvelope:verify}=await setup(),body=bytes(receipt());
 for(const value of [new Uint8Array(body),body.toString(),undefined,null,Buffer.alloc(LIMIT+1)])assert.throws(()=>verify(value,hmac(body),cfg),invalid);
 let calls=0;const proxy=new Proxy(body,{get(){calls++;throw Error('must not execute');},getPrototypeOf(){calls++;throw Error('must not execute');}});let error;try{verify(proxy,hmac(body),cfg);}catch(e){error=e;}assert.equal(calls,0);assert.ok(invalid(error));
});

test('the request reader accepts a real split stream and enforces JSON content type',async()=>{
 const {cfg,readSimulationPaymentRequest:read}=await setup(),body=bytes(receipt()),parts=[body.subarray(0,1),body.subarray(1,17),body.subarray(17)],stream=new ReadableStream({pull(c){if(parts.length)c.enqueue(parts.shift());else c.close();}});
 assert.deepEqual(await read(request(stream,hmac(body),{contentType:'APPLICATION/JSON; charset=utf-8'}),cfg),receipt());
 assert.deepEqual(await read(request(body,hmac(body),{length:body.length}),cfg),receipt());
 for(const contentType of [null,'text/plain','application/jsonp','application/octet-stream'])await assert.rejects(read(request(body,hmac(body),{contentType}),cfg),error=>error.status===415&&error.code==='JSON_REQUIRED');
 await assert.rejects(read(new Request('http://127.0.0.1/api/billing/simulation/notifications',{method:'POST',headers:{'Content-Type':'application/json','X-Shenyi-Simulation-Signature':hmac(body)}}),cfg),invalid);
});

test('Content-Length admission rejects malformed or oversized declarations and actual stream length remains bounded independently',async()=>{
 const {cfg,readSimulationPaymentRequest:read}=await setup(),body=bytes(receipt());
 for(const length of ['not-a-number','-1','1.5','',String(LIMIT+1),'999999999999999999999999999999'])await assert.rejects(read(request(body,hmac(body),{length}),cfg),tooLarge);
 // A declared small size cannot bypass counting actual bytes supplied by a stream.
 const oversized=Buffer.alloc(LIMIT+1,0x20);await assert.rejects(read(request(oversized,hmac(oversized),{length:1}),cfg),tooLarge);
 const exact=Buffer.concat([body,Buffer.alloc(LIMIT-body.length,0x20)]);assert.equal(exact.length,LIMIT);await assert.rejects(read(request(exact,hmac(exact),{length:LIMIT}),cfg),invalid);
});

test('stream overflow cancels after the first byte beyond 16KiB and does not wait for an unended body',async()=>{
 const {cfg,readSimulationPaymentRequest:read}=await setup();let pulls=0,cancels=0;const stream=new ReadableStream({pull(c){pulls++;c.enqueue(Buffer.alloc(pulls===1?LIMIT:1,0x20));},cancel(){cancels++;}},{highWaterMark:0});
 await assert.rejects(read(request(stream,'0'.repeat(64)),cfg),tooLarge);assert.equal(pulls,2);assert.equal(cancels,1);
});

test('tampering after signing invalidates authentication and mutating the source receipt never rewrites signed bytes',async()=>{
 const {cfg,verifySimulationPaymentEnvelope:verify,signSimulationPayment:sign}=await setup(),input=receipt(),signed=sign(input,cfg),original=Buffer.from(signed.body);input.amountMinor=99999;input.orderId='44444444-4444-4444-8444-444444444444';assert.deepEqual(signed.body,original);assert.deepEqual(verify(signed.body,signed.signature,cfg),receipt());
 const changed=bytes(input);assert.throws(()=>verify(changed,signed.signature,cfg),signatureError);signed.body[0]^=1;assert.throws(()=>verify(signed.body,signed.signature,cfg),signatureError);
 const unsigned=bytes(receipt({amountMinor:12346}));assert.throws(()=>verify(unsigned,hmac(original),cfg),signatureError);
});
