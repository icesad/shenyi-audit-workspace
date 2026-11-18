'use strict';
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {EventEmitter}=require('node:events');
const {runInNewContext}=require('node:vm');
const {test}=require('node:test');
const {APP_URL,registerDesktopBridge}=require('../desktop/bridge.cjs');
const {createBillingClient,isBillingRoute,billingErrorMessage}=require('../desktop/billing-client.cjs');
const {ClientError,createTeamClient}=require('../desktop/team-client.cjs');
const {BILLING_RPC,workpaperOldApiNames,workpaperOldChannelNames}=require('./helpers/workpaper-entry-layer.cjs');

const TEAM='team-a',CREATED=100,CONFIRMED=200,RENEWAL_START=1000,END=2000;
const ID='01000000-0000-4000-8000-000000000000';
const REQUEST='02000000-0000-4000-8000-000000000000';
const FULFILMENT='03000000-0000-4000-8000-000000000000';
const OPERATION='04000000-0000-4000-8000-000000000000';
const ANNUAL_OFFER={id:'annual-test',revision:2,product:'team-annual-renewal',amountMinor:600,currency:'CNY'};
const SEAT_OFFER={id:'seat-test',revision:3,product:'team-seat-addition',annualUnitAmountMinor:100,currency:'CNY'};
const SELECTION={teamId:TEAM,requestId:REQUEST,kind:'annual',offerId:ANNUAL_OFFER.id,offerRevision:ANNUAL_OFFER.revision,selectedSeats:2};
const ACCESS={teams:[{id:TEAM,name:'审易合成团队'}]};
const OVERVIEW={teamId:TEAM,simulation:true,subscription:{state:'active',revision:1,startsAt:50,endsAt:RENEWAL_START},
  seats:{purchasedSeats:4,activeBusinessSeats:2,reservedInvitationSeats:1,usedSeats:3,availableSeats:1},
  annualOffers:[{...ANNUAL_OFFER,amountMinor:400}],renewalSeats:{defaultSeats:4,basisRevision:1,basisEndsAt:RENEWAL_START,committedSeats:3,unitAmountMinor:100,currency:'CNY'},
  seatOffer:SEAT_OFFER,canReconcile:true};
const COMMON={id:ID,teamId:TEAM,actorId:'actor-private',requestId:REQUEST,merchantId:'merchant-private',simulation:true,createdAt:CREATED};
const ANNUAL_ORDER={...COMMON,offer:ANNUAL_OFFER,status:'paid',confirmedAt:CONFIRMED,
  fulfilment:{id:FULFILMENT,orderId:ID,teamId:TEAM,operationId:OPERATION,subscriptionRevision:2,startsAt:50,endsAt:END,renewalStartsAt:RENEWAL_START,confirmedAt:CONFIRMED,fulfilledAt:CONFIRMED+1},
  renewalSeats:{defaultSeats:4,selectedSeats:2,baseAmountMinor:400,unitAmountMinor:100,basisRevision:1,basisEndsAt:RENEWAL_START},
  renewalSeatGrant:{grantId:ID,seats:2,startsAt:RENEWAL_START,endsAt:END,recordedAt:CONFIRMED+1}};
const SEAT_ORDER={...COMMON,offer:{id:SEAT_OFFER.id,revision:SEAT_OFFER.revision,product:SEAT_OFFER.product,amountMinor:123,currency:'CNY'},
  status:'paid',confirmedAt:CONFIRMED,quantity:2,annualUnitAmountMinor:100,quoteExpiresAt:300,termStartsAt:50,termEndsAt:RENEWAL_START,termRevision:1,
  grant:{grantId:ID,seats:2,startsAt:CONFIRMED,endsAt:RENEWAL_START,recordedAt:CONFIRMED+1}};

function fixture(){
  const calls=[],responses=[];
  const client=createBillingClient({failure:(...args)=>new ClientError(...args),request:async(route,options)=>{
    assert.ok(isBillingRoute(route),route);
    calls.push({route,options});
    return responses.shift();
  }});
  return {client,calls,responses};
}

test('fixed billing paths and request bodies return only renderer-safe order fields',async()=>{
  const {client,calls,responses}=fixture();
  responses.push(ACCESS,OVERVIEW,{simulation:true,order:ANNUAL_ORDER},{simulation:true,orders:[SEAT_ORDER],hasMore:false,nextCursor:null},
    {simulation:true,order:SEAT_ORDER},{simulation:true,order:SEAT_ORDER});
  assert.deepEqual(await client.getBillingAccess(),ACCESS);
  assert.deepEqual(await client.getBillingOverview({teamId:TEAM}),OVERVIEW);
  const annual=await client.createBillingOrder(SELECTION);
  assert.deepEqual(annual,{order:{id:ID,teamId:TEAM,offer:ANNUAL_OFFER,createdAt:CREATED,status:'paid',confirmedAt:CONFIRMED,
    fulfilment:{endsAt:END,renewalStartsAt:RENEWAL_START},renewalSeats:ANNUAL_ORDER.renewalSeats,
    renewalSeatGrant:{seats:2,startsAt:RENEWAL_START,endsAt:END}}});
  const seat={id:ID,teamId:TEAM,offer:SEAT_ORDER.offer,createdAt:CREATED,status:'paid',confirmedAt:CONFIRMED,
    quantity:2,annualUnitAmountMinor:100,quoteExpiresAt:300,termEndsAt:RENEWAL_START,grant:{seats:2,startsAt:CONFIRMED,endsAt:RENEWAL_START}};
  assert.deepEqual(await client.listBillingOrders({teamId:TEAM,kind:'seat'}),{orders:[seat],hasMore:false,nextCursor:null});
  assert.deepEqual(await client.createBillingOrder({teamId:TEAM,kind:'seat',requestId:REQUEST,offerId:SEAT_OFFER.id,offerRevision:SEAT_OFFER.revision,quantity:2}),{order:seat});
  assert.deepEqual(await client.reconcileBillingOrder({teamId:TEAM,kind:'seat',orderId:ID}),{order:seat});
  const root='/api/teams/'+TEAM+'/billing/';
  assert.deepEqual(calls,[
    {route:'/api/auth/billing/access',options:undefined},
    {route:root+'overview',options:undefined},
    {route:root+'orders',options:{method:'POST',body:{requestId:REQUEST,offerId:ANNUAL_OFFER.id,offerRevision:2,selectedSeats:2}}},
    {route:root+'seat-orders?limit=20',options:undefined},
    {route:root+'seat-orders',options:{method:'POST',body:{requestId:REQUEST,offerId:SEAT_OFFER.id,offerRevision:3,quantity:2}}},
    {route:root+'seat-orders/'+ID+'/reconcile',options:{method:'POST',body:{}}},
  ]);
});

test('scoping, pagination, and DTO integrity fail before any unsupported data crosses to the renderer',async()=>{
  const {client,calls,responses}=fixture();
  let reads=0;
  const accessor={get teamId(){reads++;return TEAM;}};
  const hidden=Object.defineProperty({teamId:TEAM},'url',{value:'private'});
  for(const input of [accessor,hidden,{teamId:'a/b'},{teamId:'a\n'},{teamId:TEAM,[Symbol()]:true}]){
    await assert.rejects(client.getBillingOverview(input),{code:'INVALID_INPUT'});
  }
  await assert.rejects(client.getBillingAccess({teamId:TEAM}),{code:'INVALID_INPUT'});
  await assert.rejects(client.createBillingOrder({...SELECTION,quantity:undefined}),{code:'INVALID_INPUT'});
  await assert.rejects(client.createBillingOrder({...SELECTION,selectedSeats:-0}),{code:'INVALID_INPUT'});
  await assert.rejects(client.listBillingOrders({teamId:TEAM,kind:'annual',after:ID+'?limit=2'}),{code:'INVALID_INPUT'});
  await assert.rejects(client.reconcileBillingOrder({teamId:TEAM,kind:'seat',orderId:ID,token:'extra'}),{code:'INVALID_INPUT'});
  assert.equal(reads,0);assert.equal(calls.length,0);

  const envelopes=[
    {...OVERVIEW,merchantId:'unexpected'},
    {...OVERVIEW,teamId:'team-b'},
    {...OVERVIEW,seats:{...OVERVIEW.seats,usedSeats:2}},
    {...OVERVIEW,annualOffers:[ANNUAL_OFFER,ANNUAL_OFFER]},
  ];
  for(const data of envelopes){
    responses.push(data);
    await assert.rejects(client.getBillingOverview({teamId:TEAM}),{code:'INVALID_RESPONSE'});
  }
  for(const order of [
    {...ANNUAL_ORDER,teamId:'team-b'},
    {...ANNUAL_ORDER,requestId:OPERATION},
    {...ANNUAL_ORDER,offer:{...ANNUAL_OFFER,amountMinor:Number.MAX_SAFE_INTEGER+1}},
    {...ANNUAL_ORDER,fulfilment:{...ANNUAL_ORDER.fulfilment,providerReceipt:'unexpected'}},
  ]){
    responses.push({simulation:true,order});
    await assert.rejects(client.createBillingOrder(SELECTION),{code:'INVALID_RESPONSE'});
  }
  responses.push({simulation:true,orders:[SEAT_ORDER],hasMore:true,nextCursor:ID});
  await assert.rejects(client.listBillingOrders({teamId:TEAM,kind:'seat'}),{code:'INVALID_RESPONSE'});
  responses.push({simulation:true,orders:[SEAT_ORDER],hasMore:false,nextCursor:null});
  await assert.rejects(client.listBillingOrders({teamId:TEAM,kind:'seat',after:ID}),{code:'INVALID_RESPONSE'});
  assert.match(calls.at(-1).route,/\?limit=20&after=/);
  responses.push({simulation:true,order:SEAT_ORDER});
  await assert.rejects(client.reconcileBillingOrder({teamId:TEAM,kind:'seat',orderId:OPERATION}),{code:'INVALID_RESPONSE'});
});

test('all five preload actions and guarded bridge channels are exact and have no arbitrary pass-through',async()=>{
  const {client,calls,responses}=fixture(),handlers=new Map(),contents=new EventEmitter();
  contents.mainFrame={url:APP_URL};
  const event={sender:contents,senderFrame:contents.mainFrame};
  const dispose=registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},
    window:{webContents:contents},client:{...client,clearSession(){}},dialog:{}});
  let api;
  runInNewContext(readFileSync('desktop/preload.cjs','utf8'),{require(name){
    assert.equal(name,'electron');
    return {contextBridge:{exposeInMainWorld(name,value){assert.equal(name,'shenyiTeam');api=value;}},
      ipcRenderer:{invoke:(channel,input)=>handlers.get(channel)(event,input)}};
  }});
  try{
    assert.equal(workpaperOldApiNames(api).length,135);assert.equal(workpaperOldChannelNames(handlers).length,135);
    assert.deepEqual(Object.keys(api).slice(-5),BILLING_RPC.map(([name])=>name));
    assert.deepEqual([...handlers.keys()].slice(-5),BILLING_RPC.map(([,channel])=>'shenyi:'+channel));
    for(const [,operation] of BILLING_RPC){
      const run=handlers.get('shenyi:'+operation);
      for(const context of [{sender:{},senderFrame:event.senderFrame},{sender:event.sender,senderFrame:{url:APP_URL}}]){
        assert.equal((await run(context,{teamId:TEAM})).error.code,'UNTRUSTED_SENDER');
      }
      contents.mainFrame.url='shenyi-preview://document/index.html';
      assert.equal((await run(event,{})).error.code,'UNTRUSTED_SENDER');
      contents.mainFrame.url=APP_URL;
    }
    assert.equal(calls.length,0);
    responses.push(ACCESS);
    assert.deepEqual(await api.getBillingAccess(),{ok:true,value:ACCESS});
    assert.equal((await api.createBillingOrder({...SELECTION,signature:'extra'})).error.code,'INVALID_INPUT');
    assert.equal(calls.length,1);
    assert.equal(api.invoke,undefined);assert.equal(api.billingSecret,undefined);
  }finally{dispose();assert.equal(handlers.size,0);}
});

test('billing signed transport requires login and only forwards locally fixed error messages',async()=>{
  let count=0;
  const client=createTeamClient({fetchImpl:async()=>{count++;throw Error('Unexpected transport');}});
  await assert.rejects(client.getBillingAccess(),{code:'SIGN_IN_REQUIRED'});
  assert.equal(count,0);
  assert.equal(billingErrorMessage(409,'BILLING_CONFLICT'),'模拟订单或收款状态需要核对，请保留原订单。');
  assert.equal(billingErrorMessage(403,'BILLING_CONFLICT'),undefined);
  assert.equal(billingErrorMessage(409,'toString'),undefined);
  assert.equal(billingErrorMessage(409,'arbitrary gateway error'),undefined);
});
