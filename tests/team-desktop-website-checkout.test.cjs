"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash,sign,verify}=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createTeamClient}=require('../desktop/team-client.cjs');
const {createBillingClient,isBillingRoute}=require('../desktop/billing-client.cjs');
const {createNativeCheckoutIntents}=require('../desktop/native-checkout-intents.cjs');
const {createBusinessRoleFixture,keyPair,PASSWORD}=require('./helpers/business-role-fixture.cjs');
const proof=require('../shared/device-proof.cjs');
const CODE=Buffer.alloc(32,31).toString('base64url'),ORIGIN='https://127.0.0.1:43322',TEAM='team-a';
const OVERVIEW={teamId:TEAM,simulation:true,subscription:{state:'active',revision:1,startsAt:1,endsAt:2000000000000},seats:{purchasedSeats:1,activeBusinessSeats:0,reservedInvitationSeats:0,usedSeats:0,availableSeats:1},annualOffers:[],renewalSeats:null,seatOffer:null,canReconcile:false,websiteCheckout:true};
const NATIVE_OVERVIEW={teamId:TEAM,simulation:false,subscription:OVERVIEW.subscription,seats:OVERVIEW.seats,nativeCheckout:{canPurchase:true}};
const NATIVE_HISTORY={teamId:TEAM,orders:[],hasMore:false,nextCursor:null};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function nativeStore(t){
 const parent=path.resolve(process.env.SHENYI_TEST_TMPDIR??os.tmpdir());
 await fs.mkdir(parent,{recursive:true});
 const root=await fs.mkdtemp(path.join(parent,'shenyi-desktop-intents-'));
 t.after(()=>fs.rm(root,{recursive:true}));
 return {root,intents:createNativeCheckoutIntents(root)};
}
async function fixture(t,{version=3,open,reply,nativeIntents,nativeOverview=NATIVE_OVERVIEW}={}){
 const f=await createBusinessRoleFixture(t),pair=keyPair(),fingerprint=proof.parsePublicKey(pair.encoded).fingerprint,calls=[],opened=[],signed=[];
 const serverId=f.db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value;
 const profile={schemaVersion:version,apiBase:'https://team.example.invalid',serverId,...(version===3?{checkoutOrigin:ORIGIN}:{})};
 const vault={getPublicIdentity:async()=>({publicKey:pair.encoded,fingerprint}),signChallenge:async fields=>sign(null,proof.challengeBytes(fields),pair.privateKey).toString('base64url'),signRequest:async fields=>{signed.push(fields);return sign(null,proof.requestProofBytes(fields),pair.privateKey).toString('base64url');}};
 let response=reply;
 const nativeOpened=[];
 const client=createTeamClient({now:()=>f.clock.value,trustedService:profile,deviceIdentity:{vault,platform:'win32',displayName:'Synthetic checkout device'},openCheckoutExternal:open===null?undefined:async url=>{opened.push(url);return open?.(url);},
  ...(nativeIntents?{nativeCheckoutIntents:nativeIntents,openNativeCheckoutExternal:async url=>{nativeOpened.push(url);return open?.(url);}}:{}),
  fetchImpl:async(url,settings)=>{
  const parsed=new URL(url),route=parsed.pathname;calls.push({route,pathAndQuery:route+parsed.search,...settings,headers:new Headers(settings.headers)});let result;
  if(/\/billing\/(?:website(?:-seat)?-handoff|native-website(?:-order)?-handoff)$/.test(route)){
   const value=response?await response(settings):{handoff:CODE,expiresAt:f.clock.value+120000,
    ...(route.includes('/native-website')?{expiresInMs:120000}:{})};
   result=value instanceof Response?value:Response.json(value);
  }
  else if(route.endsWith('/billing/overview'))result=Response.json(nativeIntents?nativeOverview:OVERVIEW);
  else if(route.endsWith('/billing/native-orders'))result=Response.json(NATIVE_HISTORY);
  else result=await f.dispatch(new Request(url,settings));
  result.headers.set('X-Shenyi-Server-Id',serverId);Object.defineProperty(result,'url',{value:url});return result;
 }});
 await client.login({username:'administrator-demo',password:PASSWORD});await client.enrollDevice({displayName:'Synthetic checkout device',currentPassword:PASSWORD,confirmed:true});
 t.after(()=>client.clearSession());return {client,calls,opened,nativeOpened,signed,pair,f,profile,setReply(value){response=value;}};
}
test('website handoff is one protected empty POST and only a fixed pinned URL reaches the fake shell',async t=>{
 const f=await fixture(t);assert.equal(isBillingRoute('/api/teams/'+TEAM+'/billing/website-handoff'),true);assert.equal(isBillingRoute('/api/teams/'+TEAM+'/billing/website-handoff?url=x'),false);
 assert.deepEqual(await f.client.openWebsiteCheckout({teamId:TEAM}),{opened:true});assert.deepEqual(f.opened,[ORIGIN+'/checkout/#handoff='+CODE]);const calls=f.calls.filter(x=>x.route.endsWith('/website-handoff'));assert.equal(calls.length,1);const call=calls[0];assert.equal(call.method,'POST');assert.equal(call.body,'{}');assert.ok(call.headers.get('Authorization'));assert.ok(call.headers.get('X-Shenyi-Device-Lease'));const fields=f.signed.at(-1);assert.equal(fields.pathAndQuery,'/api/teams/'+TEAM+'/billing/website-handoff');assert.ok(verify(null,proof.requestProofBytes(fields),f.pair.publicKey,Buffer.from(call.headers.get('X-Shenyi-Device-Signature'),'base64url')));assert.equal(call.headers.get('X-Shenyi-Website-Checkout'),null);
 const overview=await f.client.getBillingOverview({teamId:TEAM});assert.equal(overview.websiteCheckout,true);assert.equal(overview.websiteCheckoutReady,true);assert.equal(JSON.stringify(overview).includes(CODE),false);assert.equal(JSON.stringify(overview).includes(ORIGIN),false);
 const overviewCall=f.calls.at(-1);
 assert.equal(overviewCall.headers.get('X-Shenyi-Native-Checkout'),null);
 assert.equal(overviewCall.headers.get('X-Shenyi-Native-Order-History'),null);
});
test('unconfigured profiles or missing shell never request a ticket and candidate readiness stays explicit',async t=>{
 for(const options of [{version:1},{open:null}]){const f=await fixture(t,options);assert.equal((await f.client.getBillingOverview({teamId:TEAM})).websiteCheckoutReady,false);await assert.rejects(f.client.openWebsiteCheckout({teamId:TEAM}),{code:'WEBSITE_CHECKOUT_UNAVAILABLE'});assert.equal(f.calls.some(c=>c.route.endsWith('/website-handoff')),false);assert.deepEqual(f.opened,[]);}
});
test('handoff input and exact canonical expiring reply are validated before any shell call',async t=>{
 const f=await fixture(t);const before=f.calls.length;for(const input of [{teamId:'../foreign'},{teamId:TEAM,url:'https://evil.invalid'},{teamId:TEAM,handoff:CODE},{teamId:TEAM,checkoutOrigin:ORIGIN},{}])await assert.rejects(f.client.openWebsiteCheckout(input),{code:'INVALID_INPUT'});assert.equal(f.calls.length,before);
 for(const reply of [{handoff:CODE+'A',expiresAt:f.f.clock.value+1000},{handoff:CODE.slice(0,-1)+'_',expiresAt:f.f.clock.value+1000},{handoff:CODE,expiresAt:f.f.clock.value},{handoff:CODE,expiresAt:1.5},{handoff:CODE,expiresAt:Number.MAX_SAFE_INTEGER+1},{handoff:CODE,expiresAt:f.f.clock.value+1000,url:'https://evil.invalid'},{handoff:CODE,expiresAt:f.f.clock.value+1000,token:'private'},null]){f.setReply(()=>reply);await assert.rejects(f.client.openWebsiteCheckout({teamId:TEAM}),{code:'INVALID_RESPONSE'});}assert.deepEqual(f.opened,[]);
});
test('a late ticket after logout or replacement login cannot open a browser for the new generation',async t=>{
 const wait=deferred(),f=await fixture(t,{reply:()=>wait.promise});const pending=f.client.openWebsiteCheckout({teamId:TEAM});while(!f.calls.some(c=>c.route.endsWith('/website-handoff')))await new Promise(r=>setImmediate(r));await f.client.logout();await f.client.login({username:'administrator-demo',password:PASSWORD});wait.resolve({handoff:CODE,expiresAt:f.f.clock.value+120000});await assert.rejects(pending,{code:'SESSION_CHANGED'});assert.deepEqual(f.opened,[]);
});
test('awaiting a fake browser callback rechecks generation and masks errors without exposing its URL',async t=>{
 const wait=deferred(),f=await fixture(t,{open:()=>wait.promise});const pending=f.client.openWebsiteCheckout({teamId:TEAM});while(!f.opened.length)await new Promise(r=>setImmediate(r));await f.client.logout();wait.resolve();await assert.rejects(pending,{code:'SESSION_CHANGED'});
 const g=await fixture(t,{open:()=>{throw Error(ORIGIN+'/checkout/#handoff='+CODE);}});await assert.rejects(g.client.openWebsiteCheckout({teamId:TEAM}),e=>e.code==='WEBSITE_CHECKOUT_OPEN_FAILED'&&!e.message.includes(CODE)&&!e.message.includes(ORIGIN));
});
test('website overview capability is simulation-only and never trusts server-supplied readiness',async()=>{
 let response;const client=createBillingClient({failure:(code,message)=>Object.assign(new Error(message),{code}),request:async()=>response});response=OVERVIEW;assert.deepEqual(await client.getBillingOverview({teamId:TEAM}),{...OVERVIEW,websiteCheckoutReady:false});
 for(const patch of [{websiteCheckout:false},{websiteCheckout:'true'},{websiteCheckout:null},{websiteCheckoutReady:true},{simulation:false}]){response={...OVERVIEW,...patch};await assert.rejects(client.getBillingOverview({teamId:TEAM}),{code:'INVALID_RESPONSE'});}
});


test('seat website checkout reuses the guarded IPC and only the exact seat handoff path and pinned seat page',async t=>{
 const f=await fixture(t),{registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs'),{EventEmitter}=require('node:events');
 assert.equal(isBillingRoute('/api/teams/'+TEAM+'/billing/website-seat-handoff'),true);for(const suffix of ['?kind=seat','/','/../website-handoff','?url=https://evil.invalid'])assert.equal(isBillingRoute('/api/teams/'+TEAM+'/billing/website-seat-handoff'+suffix),false);
 const handlers=new Map(),contents=new EventEmitter();contents.mainFrame={url:APP_URL};const event={sender:contents,senderFrame:contents.mainFrame},dispose=registerDesktopBridge({ipcMain:{handle:(n,fn)=>handlers.set(n,fn),removeHandler:n=>handlers.delete(n)},window:{webContents:contents},client:f.client,dialog:{}});
 try{const channel=handlers.get('shenyi:website-checkout-open');assert.deepEqual(await channel(event,{teamId:TEAM,kind:'seat'}),{ok:true,value:{opened:true}});assert.deepEqual(f.opened,[ORIGIN+'/checkout/seats/#handoff='+CODE]);const call=f.calls.filter(c=>c.route.endsWith('/website-seat-handoff')).at(-1);assert.equal(call.method,'POST');assert.equal(call.body,'{}');assert.ok(call.headers.get('Authorization'));assert.ok(call.headers.get('X-Shenyi-Device-Lease'));assert.equal(call.headers.get('X-Shenyi-Website-Checkout'),null);const fields=f.signed.at(-1);assert.equal(fields.pathAndQuery,call.route);assert.ok(verify(null,proof.requestProofBytes(fields),f.pair.publicKey,Buffer.from(call.headers.get('X-Shenyi-Device-Signature'),'base64url')));
  const before=f.calls.length;assert.equal((await channel(event,{teamId:TEAM,kind:'seat',url:ORIGIN})).ok,false);assert.equal((await channel({sender:{},senderFrame:contents.mainFrame},{teamId:TEAM,kind:'seat'})).error.code,'UNTRUSTED_SENDER');assert.equal(f.calls.length,before);
  assert.deepEqual(await f.client.openWebsiteCheckout({teamId:TEAM,kind:'annual'}),{opened:true});assert.equal(f.opened.at(-1),ORIGIN+'/checkout/#handoff='+CODE);assert.equal(f.calls.at(-1).route,'/api/teams/'+TEAM+'/billing/website-handoff');
 }finally{dispose();assert.equal(handlers.size,0);}
});
test('optional checkout kind is strict and malformed seat replies never reach a browser',async t=>{
 const f=await fixture(t),before=f.calls.length;for(const kind of [undefined,null,false,true,'Seat','seat/other','yearly',{},['seat'],1])await assert.rejects(f.client.openWebsiteCheckout({teamId:TEAM,kind}),{code:'INVALID_INPUT'});let reads=0;const getter={teamId:TEAM};Object.defineProperty(getter,'kind',{enumerable:true,get(){reads++;return 'seat';}});await assert.rejects(f.client.openWebsiteCheckout(getter),{code:'INVALID_INPUT'});assert.equal(reads,0);assert.equal(f.calls.length,before);
 for(const reply of [{handoff:CODE+'x',expiresAt:f.f.clock.value+1000},{handoff:CODE,expiresAt:f.f.clock.value},{handoff:CODE,expiresAt:NaN},{handoff:CODE,expiresAt:f.f.clock.value+1000,url:ORIGIN},null]){f.setReply(()=>reply);await assert.rejects(f.client.openWebsiteCheckout({teamId:TEAM,kind:'seat'}),{code:'INVALID_RESPONSE'});}assert.deepEqual(f.opened,[]);
});
test('seat checkout keeps generation guards across the server wait and the fake-browser wait',async t=>{
 const serverWait=deferred(),f=await fixture(t,{reply:()=>serverWait.promise}),pending=f.client.openWebsiteCheckout({teamId:TEAM,kind:'seat'});while(!f.calls.some(c=>c.route.endsWith('/website-seat-handoff')))await new Promise(r=>setImmediate(r));await f.client.logout();await f.client.login({username:'administrator-demo',password:PASSWORD});serverWait.resolve({handoff:CODE,expiresAt:f.f.clock.value+120000});await assert.rejects(pending,{code:'SESSION_CHANGED'});assert.deepEqual(f.opened,[]);
 const browserWait=deferred(),g=await fixture(t,{open:()=>browserWait.promise}),opening=g.client.openWebsiteCheckout({teamId:TEAM,kind:'seat'});while(!g.opened.length)await new Promise(r=>setImmediate(r));assert.equal(g.opened[0],ORIGIN+'/checkout/seats/#handoff='+CODE);await g.client.logout();browserWait.resolve();await assert.rejects(opening,{code:'SESSION_CHANGED'});
});

test('existing order handoffs sign only the exact order ID and selected route through the existing IPC',async t=>{
 const f=await fixture(t),{registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs'),{EventEmitter}=require('node:events');
 const handlers=new Map(),contents=new EventEmitter();
 contents.mainFrame={url:APP_URL};
 const event={sender:contents,senderFrame:contents.mainFrame};
 const dispose=registerDesktopBridge({ipcMain:{handle:(n,fn)=>handlers.set(n,fn),removeHandler:n=>handlers.delete(n)},window:{webContents:contents},client:f.client,dialog:{}});
 t.after(dispose);
 const channel=handlers.get('shenyi:website-checkout-open');
 const before=f.calls.length;
 const orderId='abcdef01-0000-4000-8000-000000000001';
 for(const [kind,suffix,websitePath] of [['annual','website-handoff','/checkout/'],['seat','website-seat-handoff','/checkout/seats/']]){
  assert.deepEqual(await channel(event,{teamId:TEAM,kind,orderId}),{ok:true,value:{opened:true}});
  const call=f.calls.at(-1),fields=f.signed.at(-1);
  assert.equal(call.route,'/api/teams/'+TEAM+'/billing/'+suffix);
  assert.equal(call.method,'POST');
  assert.equal(call.body,JSON.stringify({orderId}));
  assert.equal(fields.pathAndQuery,call.route);
  assert.equal(fields.bodySha256,createHash('sha256').update(call.body).digest('hex'));
  assert.ok(verify(null,proof.requestProofBytes(fields),f.pair.publicKey,Buffer.from(call.headers.get('X-Shenyi-Device-Signature'),'base64url')));
  assert.equal(f.opened.at(-1),ORIGIN+websitePath+'#handoff='+CODE);
 }
 const requests=f.calls.slice(before);
 assert.deepEqual(requests.filter(call=>call.method!=='GET').map(call=>call.route),[
  '/api/teams/'+TEAM+'/billing/website-handoff','/api/teams/'+TEAM+'/billing/website-seat-handoff'
 ]);
 assert.ok(requests.filter(call=>call.method==='GET').every(call=>call.route==='/api/auth/methods'&&call.body===undefined));
 assert.equal(f.opened.length,2);
});

test('supplied order IDs must be exact lowercase UUIDs before any handoff is requested',async t=>{
 const f=await fixture(t),before=f.calls.length;
 const orderId='abcdef01-0000-4000-8000-000000000001';
 for(const value of [undefined,null,[],{},3,'',orderId.toUpperCase(),orderId+'\n',' '+orderId,orderId.replace('-4000-','-3000-'),'../'+orderId]){
  await assert.rejects(f.client.openWebsiteCheckout({teamId:TEAM,kind:'seat',orderId:value}),{code:'INVALID_INPUT'});
 }
 await assert.rejects(f.client.openWebsiteCheckout({teamId:TEAM,kind:'other',orderId}),{code:'INVALID_INPUT'});
 let reads=0;
 const getter={teamId:TEAM};
 Object.defineProperty(getter,'orderId',{enumerable:true,get(){reads++;return orderId;}});
 await assert.rejects(f.client.openWebsiteCheckout(getter),{code:'INVALID_INPUT'});
 assert.equal(reads,0);
 assert.equal(f.calls.length,before);
 assert.deepEqual(f.opened,[]);
});

test('Native order history uses only the exact signed GET and never opens the website',async t=>{
 const {intents}=await nativeStore(t);
 const f=await fixture(t,{nativeIntents:intents,nativeOverview:{...NATIVE_OVERVIEW,nativeCheckout:{canPurchase:true,orderHistory:true}}});
 assert.deepEqual((await f.client.getBillingOverview({teamId:TEAM})).nativeCheckout,{canPurchase:true,orderHistory:true});
 const limit='/api/teams/'+TEAM+'/billing/native-orders?limit=20';
 const cursor='abcdef01-0000-4000-8000-000000000001';
 for(const [input,pathAndQuery] of [[{teamId:TEAM},limit],[{teamId:TEAM,after:cursor},limit+'&after='+cursor]]){
  assert.deepEqual(await f.client.listNativeBillingOrders(input),NATIVE_HISTORY);
  const call=f.calls.at(-1),fields=f.signed.at(-1);
  assert.equal(call.pathAndQuery,pathAndQuery);
  assert.equal(call.method,'GET');
  assert.equal(call.body,undefined);
  assert.ok(call.headers.get('X-Shenyi-Device-Lease'));
  assert.equal(call.headers.get('X-Shenyi-Native-Checkout'),null);
  assert.equal(call.headers.get('X-Shenyi-Native-Order-History'),null);
  assert.equal(fields.pathAndQuery,pathAndQuery);
  assert.equal(fields.bodySha256,createHash('sha256').update('').digest('hex'));
  assert.ok(verify(null,proof.requestProofBytes(fields),f.pair.publicKey,Buffer.from(call.headers.get('X-Shenyi-Device-Signature'),'base64url')));
 }
 assert.deepEqual(f.nativeOpened,[]);
 const old=await fixture(t),before=old.calls.length;
 await assert.rejects(old.client.listNativeBillingOrders({teamId:TEAM}),{code:'WEBSITE_CHECKOUT_UNAVAILABLE'});
 assert.equal(old.calls.length,before);
});

test('Native desktop purchase persists its UUID and predecessor across retries and rejected advances',async t=>{
 const {root,intents}=await nativeStore(t);
 let failOnce=true;
 const f=await fixture(t,{nativeIntents:intents,open:()=>{if(failOnce){failOnce=false;throw Error('Synthetic opener failure');}}});
 const selection={teamId:TEAM,kind:'annual'};
 assert.deepEqual(await f.client.getBillingOverview({teamId:TEAM}),NATIVE_OVERVIEW);
 const overviewCall=f.calls.at(-1);
 assert.equal(overviewCall.method,'GET');
 assert.equal(overviewCall.headers.get('X-Shenyi-Native-Checkout'),'native-v1');
 assert.equal(overviewCall.headers.get('X-Shenyi-Native-Order-History'),'v1');
 assert.ok(overviewCall.headers.get('X-Shenyi-Device-Lease'));
 await assert.rejects(f.client.openNativeWebsiteCheckout(selection),{code:'WEBSITE_CHECKOUT_OPEN_FAILED'});
 const purchaseCall=f.calls.at(-1);
 assert.equal(purchaseCall.headers.get('X-Shenyi-Native-Checkout'),'native-v1');
 assert.equal(purchaseCall.headers.get('X-Shenyi-Native-Order-History'),null);
 const first=JSON.parse(purchaseCall.body);
 assert.deepEqual(Object.keys(first).sort(),['product','requestId']);
 assert.equal(first.product,'team-annual-renewal');
 const directory=path.join(root,'native-checkout-intents');
 const [file]=await fs.readdir(directory);
 assert.equal(await fs.readFile(path.join(directory,file),'utf8'),first.requestId);
 assert.deepEqual(await f.client.openNativeWebsiteCheckout(selection),{opened:true});
 assert.deepEqual(JSON.parse(f.calls.at(-1).body),first);
 assert.equal(f.nativeOpened.at(-1),f.profile.apiBase+'/api/website-pay/#handoff='+CODE);
 assert.deepEqual(f.opened,[]);
 f.setReply(()=>Response.json({error:{code:'WECHAT_NATIVE_PREVIOUS_ORDER_UNRESOLVED'}},{status:409}));
 await assert.rejects(f.client.openNativeWebsiteCheckout({...selection,newPurchase:true}),{code:'WECHAT_NATIVE_PREVIOUS_ORDER_UNRESOLVED'});
 assert.equal(await fs.readFile(path.join(directory,file),'utf8'),first.requestId);
 f.setReply(()=>({handoff:CODE,expiresAt:f.f.clock.value+120000,expiresInMs:120000}));
 await f.client.openNativeWebsiteCheckout({...selection,newPurchase:true});
 const second=JSON.parse(f.calls.at(-1).body);
 assert.equal(second.previousRequestId,first.requestId);
 assert.notEqual(second.requestId,first.requestId);
 assert.equal(await fs.readFile(path.join(directory,file),'utf8'),second.requestId+'\n'+first.requestId);
 await f.client.openNativeWebsiteCheckout(selection);
 assert.deepEqual(JSON.parse(f.calls.at(-1).body),second);
 const call=f.calls.at(-1),fields=f.signed.at(-1);
 assert.equal(call.route,'/api/teams/'+TEAM+'/billing/native-website-order-handoff');
 assert.equal(call.redirect,'error');
 assert.equal(fields.bodySha256,createHash('sha256').update(call.body).digest('hex'));
 assert.ok(verify(null,proof.requestProofBytes(fields),f.pair.publicKey,Buffer.from(call.headers.get('X-Shenyi-Device-Signature'),'base64url')));
});

test('catalogless original recovery signs just the order UUID and returns no ticket or browser URL through IPC',async t=>{
 const {intents}=await nativeStore(t);
 const f=await fixture(t,{nativeIntents:intents,nativeOverview:{...NATIVE_OVERVIEW,nativeCheckout:{canPurchase:false}}});
 const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs'),{EventEmitter}=require('node:events');
 const handlers=new Map(),contents=new EventEmitter();
 contents.mainFrame={url:APP_URL};
 const event={sender:contents,senderFrame:contents.mainFrame};
 t.after(registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window:{webContents:contents},client:f.client,dialog:{}}));
 const channel=handlers.get('shenyi:native-website-checkout-open');
 const orderId='abcdef01-0000-4000-8000-000000000009';
 assert.equal((await f.client.getBillingOverview({teamId:TEAM})).nativeCheckout.canPurchase,false);
 const before=f.calls.length;
 for(const input of [{teamId:TEAM,orderId:orderId.toUpperCase()},{teamId:TEAM,orderId,kind:'annual'},{teamId:TEAM,orderId,url:ORIGIN},
  {teamId:TEAM,kind:'annual',requestId:orderId},{teamId:TEAM,kind:'annual',newPurchase:false}]){
  assert.equal((await channel(event,input)).error.code,'INVALID_INPUT');
 }
 assert.equal((await channel({sender:{},senderFrame:contents.mainFrame},{teamId:TEAM,orderId})).error.code,'UNTRUSTED_SENDER');
 assert.equal(f.calls.length,before);
 assert.deepEqual(await channel(event,{teamId:TEAM,orderId}),{ok:true,value:{opened:true}});
 assert.equal(f.calls.at(-1).route,'/api/teams/'+TEAM+'/billing/native-website-handoff');
 assert.equal(f.calls.at(-1).body,JSON.stringify({orderId}));
 assert.equal(f.nativeOpened.at(-1),f.profile.apiBase+'/api/website-pay/#handoff='+CODE);
});

test('Native desktop rejects forged response fields, serializes handoffs and discards late replies after logout',async t=>{
 const {intents}=await nativeStore(t);
 const f=await fixture(t,{nativeIntents:intents});
 const selection={teamId:TEAM,kind:'seat'};
 for(const reply of [{handoff:CODE,expiresAt:1,expiresInMs:120000,url:ORIGIN},
  {handoff:CODE.slice(0,-1)+'_',expiresAt:1,expiresInMs:120000},{handoff:CODE,expiresAt:0,expiresInMs:120000},
  {handoff:CODE,expiresAt:1},{handoff:CODE,expiresAt:1,expiresInMs:120001},null]){
  f.setReply(()=>reply);
  await assert.rejects(f.client.openNativeWebsiteCheckout(selection),{code:'INVALID_RESPONSE'});
 }
 f.setReply(async()=>{await new Promise(resolve=>setTimeout(resolve,12));return {handoff:CODE,expiresAt:1,expiresInMs:1};});
 await assert.rejects(f.client.openNativeWebsiteCheckout(selection),{code:'INVALID_RESPONSE'});
 assert.equal(f.nativeOpened.length,0);
 const wait=deferred();
 f.setReply(()=>wait.promise);
 const before=f.calls.length;
 const pending=f.client.openNativeWebsiteCheckout(selection);
 while(!f.calls.slice(before).some(call=>call.route.endsWith('/native-website-order-handoff')))await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(f.client.openNativeWebsiteCheckout(selection),{code:'WEBSITE_CHECKOUT_IN_PROGRESS'});
 await f.client.logout();
 wait.resolve({handoff:CODE,expiresAt:f.f.clock.value+120000,expiresInMs:120000});
 await assert.rejects(pending,{code:'SESSION_CHANGED'});
 assert.equal(f.nativeOpened.length,0);
});
