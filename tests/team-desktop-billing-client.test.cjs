'use strict';
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {EventEmitter}=require('node:events');
const {runInNewContext}=require('node:vm');
const {test}=require('node:test');
const {APP_URL,registerDesktopBridge}=require('../desktop/bridge.cjs');
const {createBillingClient,isBillingRoute,billingErrorMessage}=require('../desktop/billing-client.cjs');
const {ClientError,createTeamClient}=require('../desktop/team-client.cjs');
const {BILLING_RPC,BILLING_BATCH_RPC,REFUND_INTAKE_RPC,WEBSITE_CHECKOUT_RPC,workpaperOldApiNames,workpaperOldChannelNames}=require('./helpers/workpaper-entry-layer.cjs');

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
const RECONCILIATION_ROUTE='/api/teams/'+TEAM+'/billing/reconciliation';
const RECONCILIATION_ROW={orderId:ID,outcome:'matched',status:'paid',paymentException:false};
const RECONCILIATION_PAGE={simulation:true,teamId:TEAM,kind:'annual',results:[RECONCILIATION_ROW],nextCursor:null};

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

test('saved-payment recovery uses fixed signed-order routes without accepting payment data',async()=>{
  const {client,calls,responses}=fixture();
  const scope={teamId:TEAM,orderId:ID,source:'recorded-payment'};
  for(const [kind,collection,order] of [['annual','orders',ANNUAL_ORDER],['seat','seat-orders',SEAT_ORDER]]){
    responses.push({simulation:true,order});
    assert.equal((await client.reconcileBillingOrder({...scope,kind})).order.status,'paid');
    assert.deepEqual(calls.at(-1),{route:'/api/teams/'+TEAM+'/billing/'+collection+'/'+ID+'/resume-fulfilment',options:{method:'POST',body:{}}});
  }
  for(const change of [{source:undefined},{source:'gateway'},{amountMinor:1},{confirmedAt:1}]){
    await assert.rejects(client.reconcileBillingOrder({...scope,kind:'annual',...change}),{code:'INVALID_INPUT'});
  }
  assert.equal(calls.length,2);
  responses.push({simulation:true,order:{...ANNUAL_ORDER,status:'payment-verified',fulfilment:null,renewalSeatGrant:null}});
  await assert.rejects(client.reconcileBillingOrder({...scope,kind:'annual'}),{code:'INVALID_RESPONSE'});
});

test('the recovery capability is independent of lookup and unavailable in managed responses',async()=>{
  const {client,responses}=fixture();
  const overview={...OVERVIEW,canReconcile:false,canResumeFulfilment:true};
  const scope={teamId:TEAM};
  responses.push(overview);
  assert.deepEqual(await client.getBillingOverview(scope),overview);
  for(const value of [false,1,'true',null]){
    responses.push({...overview,canResumeFulfilment:value});
    await assert.rejects(client.getBillingOverview(scope),{code:'INVALID_RESPONSE'});
  }
  responses.push({teamId:TEAM,simulation:false,subscription:OVERVIEW.subscription,seats:OVERVIEW.seats,canResumeFulfilment:true});
  await assert.rejects(client.getBillingOverview(scope),{code:'INVALID_RESPONSE'});
});

test('managed first-term trial metadata is accepted without admitting it to simulated billing', async () => {
  const {client,responses}=fixture();
  const subscription={...OVERVIEW.subscription,pilot:true};
  const managed={teamId:TEAM,simulation:false,subscription,seats:OVERVIEW.seats};
  responses.push(managed);
  assert.deepEqual(await client.getBillingOverview({teamId:TEAM}),managed);
  for(const invalid of [{...OVERVIEW,subscription},{...managed,subscription:{...subscription,revision:2}},
    {...managed,subscription:{...subscription,pilot:false}}]){
    responses.push(invalid);
    await assert.rejects(client.getBillingOverview({teamId:TEAM}),{code:'INVALID_RESPONSE'});
  }
});

test('single-order reads use one fixed GET route and retain the safe projected order',async()=>{
  const {client,calls,responses}=fixture();
  for(const [kind,collection,source] of [['annual','orders',ANNUAL_ORDER],['seat','seat-orders',SEAT_ORDER]]){
    responses.push({simulation:true,order:source});
    const {order}=await client.getBillingOrder({teamId:TEAM,kind,orderId:ID});
    assert.equal(order.id,ID);
    assert.equal(order.offer.product,source.offer.product);
    assert.equal(order.offer.amountMinor,source.offer.amountMinor);
    assert.equal(order.status,source.status);
    for(const privateKey of ['actorId','merchantId','requestId'])assert.ok(!Object.hasOwn(order,privateKey));
    const route='/api/teams/'+TEAM+'/billing/'+collection+'/'+ID;
    assert.deepEqual(calls.at(-1),{route,options:undefined});
    for(const suffix of ['/','?limit=20','?','/verify','\n'])assert.equal(isBillingRoute(route+suffix),false);
  }
  assert.equal(calls.length,2);
  const input={teamId:TEAM,kind:'annual',orderId:ID};
  for(const invalid of [
    {...input,kind:undefined},{...input,kind:'seat-orders'},{...input,teamId:'team-b/orders'},
    {...input,orderId:ID+'?limit=20'},{...input,orderId:ID.replace('-4000','-3000')},{...input,token:'extra'}
  ])await assert.rejects(client.getBillingOrder(invalid),{code:'INVALID_INPUT'});
  assert.equal(calls.length,2);
});

test('single-order reads reject mismatched team, order, product and mode',async()=>{
  const {client,responses}=fixture();
  const input={teamId:TEAM,kind:'annual',orderId:ID};
  for(const payload of [
    {simulation:false,order:ANNUAL_ORDER},
    {simulation:true,order:{...ANNUAL_ORDER,teamId:'team-b'}},
    {simulation:true,order:{...ANNUAL_ORDER,id:OPERATION}},
    {simulation:true,order:SEAT_ORDER},
  ]){
    responses.push(payload);
    await assert.rejects(client.getBillingOrder(input),{code:'INVALID_RESPONSE'});
  }
});

test('managed billing overview carries only a scoped subscription and seat summary',async()=>{
  const {client,responses}=fixture();
  const overview={teamId:TEAM,simulation:false,subscription:OVERVIEW.subscription,seats:OVERVIEW.seats};
  responses.push(overview);
  assert.deepEqual(await client.getBillingOverview({teamId:TEAM}),overview);
  for(const data of [
    {...overview,simulation:true},
    {...overview,teamId:'team-b'},
    {...overview,canReconcile:false},
    {...overview,annualOffers:[]},
    {...overview,subscription:{...overview.subscription,sourceRef:'private'}},
    {...overview,seats:{...overview.seats,memberIds:[]}},
    {...overview,seats:{...overview.seats,usedSeats:2}},
  ]){
    responses.push(data);
    await assert.rejects(client.getBillingOverview({teamId:TEAM}),{code:'INVALID_RESPONSE'});
  }
});

test('renewal reminder days preserve legacy overview DTOs and only project the validated active optional field',async()=>{
  const {client,responses}=fixture();
  for(const simulation of [true,false]){
    const legacy=simulation?OVERVIEW:{teamId:TEAM,simulation:false,subscription:OVERVIEW.subscription,seats:OVERVIEW.seats};
    responses.push(legacy);
    const old=await client.getBillingOverview({teamId:TEAM});assert.deepEqual(old,legacy);assert.equal(Object.hasOwn(old.subscription,'renewalReminderDays'),false);
    for(const renewalReminderDays of [1,15,30]){
      const data={...legacy,subscription:{...legacy.subscription,renewalReminderDays}};responses.push(data);
      assert.deepEqual(await client.getBillingOverview({teamId:TEAM}),data);
    }
  }
});

test('renewal reminder rejects malformed, out-of-range and cross-state values without relaxing nested DTO checks',async()=>{
  const {client,responses}=fixture();
  const managed={teamId:TEAM,simulation:false,subscription:OVERVIEW.subscription,seats:OVERVIEW.seats};
  for(const renewalReminderDays of [undefined,null,false,true,0,-0,-1,31,1.5,'1',NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1,1n,{},[1]]){
    responses.push({...managed,subscription:{...managed.subscription,renewalReminderDays}});
    await assert.rejects(client.getBillingOverview({teamId:TEAM}),{code:'INVALID_RESPONSE'});
  }
  for(const state of ['unconfigured','scheduled','expired']){
    const subscription=state==='unconfigured'?{state,revision:0,startsAt:null,endsAt:null}:{...managed.subscription,state};
    responses.push({...managed,subscription});assert.deepEqual((await client.getBillingOverview({teamId:TEAM})).subscription,subscription);
    responses.push({...managed,subscription:{...subscription,renewalReminderDays:1}});
    await assert.rejects(client.getBillingOverview({teamId:TEAM}),{code:'INVALID_RESPONSE'});
  }
  for(const data of [
    {...managed,renewalReminderDays:1},
    {...managed,subscription:{...managed.subscription,renewalReminderDays:1,sourceRef:'private'}},
    {...managed,subscription:{...managed.subscription,renewalReminderDays:1},seats:{...managed.seats,renewalReminderDays:1}},
  ]){responses.push(data);await assert.rejects(client.getBillingOverview({teamId:TEAM}),{code:'INVALID_RESPONSE'});}
  let reads=0;
  for(const subscription of [
    Object.defineProperty({...managed.subscription},'renewalReminderDays',{enumerable:true,get(){reads++;return 1;}}),
    Object.defineProperty({...managed.subscription},'renewalReminderDays',{value:1}),
    {...managed.subscription,renewalReminderDays:1,[Symbol('private')]:true},
    new Proxy({...managed.subscription,renewalReminderDays:1},{get(){reads++;return 1;}}),
  ]){responses.push({...managed,subscription});await assert.rejects(client.getBillingOverview({teamId:TEAM}),{code:'INVALID_RESPONSE'});}
  assert.equal(reads,0);
});

test('overview opt-ins are fixed by the protected transport and never sent on login, access or order operations',async t=>{
  const {createBusinessRoleFixture,keyPair,PASSWORD}=require('./helpers/business-role-fixture.cjs');
  const {sign}=require('node:crypto'),proof=require('../shared/device-proof.cjs');
  const f=await createBusinessRoleFixture(t),pair=keyPair(),fingerprint=proof.parsePublicKey(pair.encoded).fingerprint,calls=[];
  const vault={
    getPublicIdentity:async()=>({publicKey:pair.encoded,fingerprint}),
    signChallenge:async fields=>sign(null,proof.challengeBytes(fields),pair.privateKey).toString('base64url'),
    signRequest:async fields=>sign(null,proof.requestProofBytes(fields),pair.privateKey).toString('base64url'),
  };
  const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  const client=createTeamClient({now:()=>f.clock.value,deviceIdentity:{vault,platform:'win32',displayName:'合成提醒测试电脑'},fetchImpl:async(url,settings)=>{
    const parsed=new URL(url),route=parsed.pathname+parsed.search;calls.push({route,...settings,headers:new Headers(settings.headers)});
    if(route==='/api/auth/billing/access')return json(ACCESS);
    if(route==='/api/teams/'+TEAM+'/billing/overview')return json({...OVERVIEW,subscription:{...OVERVIEW.subscription,renewalReminderDays:30}});
    if(route==='/api/teams/'+TEAM+'/billing/orders?limit=20')return json({simulation:true,orders:[],hasMore:false,nextCursor:null});
    if(route==='/api/teams/'+TEAM+'/billing/orders')return json({simulation:true,order:ANNUAL_ORDER});
    if(route===RECONCILIATION_ROUTE)return json(RECONCILIATION_PAGE);
    return f.dispatch(new Request(url,settings));
  }});
  await client.login({username:'administrator-demo',password:PASSWORD});
  await client.enrollDevice({displayName:'合成提醒测试电脑',currentPassword:PASSWORD,confirmed:true});
  assert.deepEqual(await client.getBillingAccess(),ACCESS);
  assert.equal((await client.getBillingOverview({teamId:TEAM})).subscription.renewalReminderDays,30);
  assert.deepEqual(await client.listBillingOrders({teamId:TEAM,kind:'annual'}),{orders:[],hasMore:false,nextCursor:null});
  await client.createBillingOrder(SELECTION);await client.reconcileBillingPage({teamId:TEAM,kind:'annual'});
  const overviews=calls.filter(call=>call.route==='/api/teams/'+TEAM+'/billing/overview');assert.equal(overviews.length,1);
  assert.equal(overviews[0].method,'GET');assert.equal(overviews[0].body,undefined);assert.ok(overviews[0].headers.get('X-Shenyi-Device-Signature'));
  assert.ok(calls.some(call=>call.route==='/api/auth/login'));assert.ok(calls.some(call=>call.route.endsWith('/orders')&&call.method==='POST'));
  for(const call of calls){
    assert.equal(call.headers.get('X-Shenyi-Billing-View'),call===overviews[0]?'expiry-reminder-v1':null,call.route);
    assert.equal(call.headers.get('X-Shenyi-Billing-Recovery'),call===overviews[0]?'recorded-payment-v1':null,call.route);
    assert.equal(call.headers.get('X-Shenyi-Billing-Batch'),call===overviews[0]?'resumable-v1':null,call.route);
    assert.equal(call.headers.get('X-Shenyi-Website-Checkout'),call===overviews[0]?'candidate-v1':null,call.route);
  }
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
    {...OVERVIEW,canReconcilePaymentExceptions:'true'},
    {...OVERVIEW,canReconcile:false,canReconcilePaymentExceptions:true},
    {...OVERVIEW,canReconcileBillingBatch:false},
    {...OVERVIEW,canReconcileBillingBatch:'true'},
    {...OVERVIEW,canReconcile:false,canReconcileBillingBatch:true},
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
    ...[
      null,
      {kind:'unknown',occurredAt:CONFIRMED,state:'review-required'},
      {kind:'refund',occurredAt:CREATED-1,state:'review-required'},
      {kind:'refund',occurredAt:8640000000000001,state:'review-required'},
      {kind:'refund',occurredAt:CONFIRMED,state:'complete'},
      {kind:'refund',occurredAt:CONFIRMED,state:'review-required',originalTransactionId:OPERATION},
      {kind:'refund',occurredAt:CONFIRMED,state:'review-required',amountMinor:600},
    ].map(paymentException=>({...ANNUAL_ORDER,paymentException})),
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

test('both products project review evidence independently of fulfilment and keep old DTOs compatible',async()=>{
  const {client,responses}=fixture();
  const refund={kind:'refund',occurredAt:CONFIRMED+20,state:'review-required'};
  const chargeback={kind:'chargeback',occurredAt:CREATED+20,state:'review-required'};
  for(const capability of [undefined,false,true]){
    const overview=capability===undefined?OVERVIEW:{...OVERVIEW,canReconcilePaymentExceptions:capability};
    responses.push(overview);
    assert.deepEqual(await client.getBillingOverview({teamId:TEAM}),overview);
  }
  responses.push({simulation:true,order:{...ANNUAL_ORDER,paymentException:refund}});
  const {order:annual}=await client.reconcileBillingOrder({teamId:TEAM,kind:'annual',orderId:ID});
  assert.deepEqual(annual.paymentException,refund);
  assert.equal(annual.status,'paid');
  assert.equal(annual.fulfilment.endsAt,END);
  assert.equal(annual.renewalSeatGrant.seats,2);
  for(const status of ['pending','payment-verified']){
    const confirmedAt=status==='pending'?null:CONFIRMED;
    responses.push({simulation:true,orders:[{...SEAT_ORDER,status,confirmedAt,grant:null,paymentException:chargeback}],hasMore:false,nextCursor:null});
    const {orders:[seat]}=await client.listBillingOrders({teamId:TEAM,kind:'seat'});
    assert.deepEqual(seat.paymentException,chargeback);
    assert.equal(seat.status,status);
    assert.equal(seat.confirmedAt,confirmedAt);
    assert.equal(seat.grant,null);
  }
});

test('trusted closure DTOs distinguish unpaid closed orders from late verified receipts',async()=>{
  const {client,responses}=fixture();
  const scope={teamId:TEAM,kind:'annual',orderId:ID};
  const closure={deadlineAt:300,closedAt:301};
  const pending={...ANNUAL_ORDER,status:'pending',confirmedAt:null,fulfilment:null,renewalSeatGrant:null,paymentDeadlineAt:300};
  const closed={...pending,status:'closed',closure};
  responses.push({simulation:true,order:pending});
  const annualPending=(await client.reconcileBillingOrder(scope)).order;
  assert.equal(annualPending.paymentDeadlineAt,300);
  assert.equal(annualPending.status,'pending');
  assert.equal(Object.hasOwn(annualPending,'closure'),false);
  responses.push({simulation:true,order:closed});
  const annualClosed=(await client.reconcileBillingOrder(scope)).order;
  assert.equal(annualClosed.status,'closed');
  assert.equal(annualClosed.confirmedAt,null);
  assert.deepEqual(annualClosed.closure,closure);
  assert.equal(annualClosed.fulfilment,null);
  assert.equal(annualClosed.renewalSeatGrant,null);

  const paymentException={kind:'refund',occurredAt:350,state:'review-required'};
  const lateSeat={...SEAT_ORDER,status:'payment-verified',confirmedAt:400,grant:null,closure,paymentException};
  responses.push({simulation:true,orders:[lateSeat],hasMore:false,nextCursor:null});
  const {orders:[seat]}=await client.listBillingOrders({teamId:TEAM,kind:'seat'});
  assert.equal(seat.status,'payment-verified');
  assert.equal(seat.confirmedAt,400);
  assert.equal(seat.grant,null);
  assert.deepEqual(seat.closure,closure);
  assert.deepEqual(seat.paymentException,paymentException);

  for(const order of [
    {...pending,paymentDeadlineAt:CREATED},
    {...pending,paymentDeadlineAt:null},
    {...pending,closure},
    {...closed,confirmedAt:400},
    {...closed,paymentDeadlineAt:undefined},
    {...closed,closure:undefined},
    {...closed,closure:{...closure,closeCode:'private'}},
    {...closed,closure:{deadlineAt:300,closedAt:299}},
    {...closed,closure:{deadlineAt:299,closedAt:301}},
    {...closed,status:'payment-verified',confirmedAt:300},
    {...closed,fulfilment:ANNUAL_ORDER.fulfilment},
    {...ANNUAL_ORDER,paymentDeadlineAt:300,closure},
  ]){
    responses.push({simulation:true,order});
    await assert.rejects(client.reconcileBillingOrder(scope),{code:'INVALID_RESPONSE'});
  }
  for(const order of [
    {...lateSeat,closure:{...closure,deadlineAt:299}},
    {...lateSeat,paymentDeadlineAt:300},
    {...lateSeat,grant:SEAT_ORDER.grant},
  ]){
    responses.push({simulation:true,orders:[order],hasMore:false,nextCursor:null});
    await assert.rejects(client.listBillingOrders({teamId:TEAM,kind:'seat'}),{code:'INVALID_RESPONSE'});
  }
});

test('batch reconciliation projects bounded ordered pages from a fixed signed-request route',async()=>{
  const {client,calls,responses}=fixture();
  const overview={...OVERVIEW,canReconcileBillingBatch:true};
  responses.push(overview);
  assert.deepEqual(await client.getBillingOverview({teamId:TEAM}),overview);

  const expected=[
    {outcome:'no-evidence',status:'paid',paymentException:false},
    {outcome:'matched',status:'paid',paymentException:false},
    {outcome:'awaiting-review',status:'pending',paymentException:true},
    {outcome:'awaiting-review',status:'payment-verified',paymentException:false},
    {outcome:'lookup-unavailable',status:'pending',paymentException:false},
    {outcome:'evidence-rejected',status:'paid',paymentException:true},
    {outcome:'local-failure',status:'payment-verified',paymentException:false},
    {outcome:'no-evidence',status:'payment-verified',paymentException:true},
  ];
  const results=expected.map((result,index)=>({
    ...result,orderId:String(index+1).padStart(8,'0')+'-0000-4000-8000-000000000000',
  }));
  const nextCursor=results.at(-1).orderId;
  responses.push({...RECONCILIATION_PAGE,results,nextCursor},RECONCILIATION_PAGE,
    {...RECONCILIATION_PAGE,kind:'seat',results:[]});
  assert.deepEqual(await client.reconcileBillingPage({teamId:TEAM,kind:'annual'}),{results,nextCursor});
  assert.deepEqual(await client.reconcileBillingPage({teamId:TEAM,kind:'annual',after:nextCursor}),{
    results:[RECONCILIATION_ROW],nextCursor:null,
  });
  assert.deepEqual(await client.reconcileBillingPage({teamId:TEAM,kind:'seat'}),{results:[],nextCursor:null});
  assert.deepEqual(calls.slice(1),[
    {route:RECONCILIATION_ROUTE,options:{method:'POST',body:{kind:'annual'}}},
    {route:RECONCILIATION_ROUTE,options:{method:'POST',body:{kind:'annual',after:nextCursor}}},
    {route:RECONCILIATION_ROUTE,options:{method:'POST',body:{kind:'seat'}}},
  ]);
});

test('batch reconciliation projects trusted closure and rejects a conflicting closure outcome',async()=>{
  const {client,responses}=fixture();
  const scope={teamId:TEAM,kind:'annual'};
  const closed={...RECONCILIATION_ROW,outcome:'closed',status:'closed'};
  const lookupFailed={...closed,orderId:REQUEST,outcome:'lookup-unavailable'};
  const lateReceipt={...closed,orderId:OPERATION,outcome:'awaiting-review',status:'payment-verified'};
  const results=[closed,lookupFailed,lateReceipt];
  responses.push({...RECONCILIATION_PAGE,results});
  assert.deepEqual(await client.reconcileBillingPage(scope),{results,nextCursor:null});
  for(const status of ['pending','paid','payment-verified']){
    responses.push({...RECONCILIATION_PAGE,results:[{...closed,status}]});
    await assert.rejects(client.reconcileBillingPage(scope),{code:'INVALID_RESPONSE'});
  }
});

test('resumable batch capability is optional and requires the existing simulated batch authority',async()=>{
  const {client,responses}=fixture();
  const legacy={...OVERVIEW,canReconcileBillingBatch:true};
  responses.push(legacy,{...legacy,canResumeBillingBatch:true});
  assert.deepEqual(await client.getBillingOverview({teamId:TEAM}),legacy);
  assert.deepEqual(await client.getBillingOverview({teamId:TEAM}),{...legacy,canResumeBillingBatch:true});
  for(const response of [
    ...[false,null,undefined,'true',1].map(canResumeBillingBatch=>({...legacy,canResumeBillingBatch})),
    {...OVERVIEW,canResumeBillingBatch:true},
    {...legacy,canReconcile:false,canResumeBillingBatch:true},
    {teamId:TEAM,simulation:false,subscription:OVERVIEW.subscription,seats:OVERVIEW.seats,canResumeBillingBatch:true},
  ]){responses.push(response);await assert.rejects(client.getBillingOverview({teamId:TEAM}),{code:'INVALID_RESPONSE'});}
});

test('batch request IDs are canonical optional UUIDs without changing the existing response projection',async()=>{
  const {client,calls,responses}=fixture();
  responses.push(RECONCILIATION_PAGE,{...RECONCILIATION_PAGE,kind:'seat',results:[]});
  assert.deepEqual(await client.reconcileBillingPage({teamId:TEAM,kind:'annual',requestId:REQUEST}),{results:[RECONCILIATION_ROW],nextCursor:null});
  assert.deepEqual(await client.reconcileBillingPage({teamId:TEAM,kind:'seat',after:ID,requestId:OPERATION}),{results:[],nextCursor:null});
  assert.deepEqual(calls,[
    {route:RECONCILIATION_ROUTE,options:{method:'POST',body:{kind:'annual',requestId:REQUEST}}},
    {route:RECONCILIATION_ROUTE,options:{method:'POST',body:{kind:'seat',after:ID,requestId:OPERATION}}},
  ]);
  for(const requestId of [undefined,null,'',1,REQUEST+'\n',REQUEST.replace('-4000-','-1000-'),'ABCDEF01-0000-4000-8000-000000000000',REQUEST+'/reconcile']){
    await assert.rejects(client.reconcileBillingPage({teamId:TEAM,kind:'annual',requestId}),{code:'INVALID_INPUT'});
  }
  assert.equal(calls.length,2);
});

test('batch selectors and result rows reject unexpected fields, stale cursors and contradictory order states',async()=>{
  const {client,calls,responses}=fixture();
  const scope={teamId:TEAM,kind:'annual'};
  for(const input of [
    {...scope,teamId:'team-a/billing'},{...scope,kind:'capture'},{...scope,after:undefined},
    {...scope,after:null},{...scope,after:ID+'/reconcile'},{...scope,orderIds:[ID]},
  ])await assert.rejects(client.reconcileBillingPage(input),{code:'INVALID_INPUT'});
  assert.equal(calls.length,0);
  for(const route of [RECONCILIATION_ROUTE+'?after='+ID,RECONCILIATION_ROUTE+'/',RECONCILIATION_ROUTE+'\n',
    'https://example.invalid'+RECONCILIATION_ROUTE,RECONCILIATION_ROUTE+'#key'])assert.equal(isBillingRoute(route),false);

  for(const page of [
    {...RECONCILIATION_PAGE,teamId:'team-b'},
    {...RECONCILIATION_PAGE,kind:'seat'},
    {...RECONCILIATION_PAGE,simulation:false},
    {...RECONCILIATION_PAGE,merchantId:'secret'},
    {...RECONCILIATION_PAGE,nextCursor:ID},
    {...RECONCILIATION_PAGE,nextCursor:undefined},
    {...RECONCILIATION_PAGE,results:Array(9).fill(RECONCILIATION_ROW)},
    {...RECONCILIATION_PAGE,results:[RECONCILIATION_ROW,RECONCILIATION_ROW]},
    {...RECONCILIATION_PAGE,results:[{...RECONCILIATION_ROW,orderId:OPERATION},RECONCILIATION_ROW]},
    ...[
      {originalTransactionId:REQUEST},{orderId:'arbitrary'},{outcome:'confirmed'},{status:'fulfilled'},
      {status:'payment-verified'},{paymentException:true},{paymentException:'false'},
      {outcome:'awaiting-review',status:'pending'},
    ].map(changes=>({...RECONCILIATION_PAGE,results:[{...RECONCILIATION_ROW,...changes}]})),
  ]){
    responses.push(page);
    await assert.rejects(client.reconcileBillingPage(scope),{code:'INVALID_RESPONSE'});
  }
  responses.push(RECONCILIATION_PAGE);
  await assert.rejects(client.reconcileBillingPage({...scope,after:ID}),{code:'INVALID_RESPONSE'});
});

test('billing preload actions and guarded bridge channels are exact and have no arbitrary pass-through',async()=>{
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
    const operations=[...BILLING_RPC,...BILLING_BATCH_RPC,...REFUND_INTAKE_RPC,...WEBSITE_CHECKOUT_RPC];
    assert.deepEqual(Object.keys(api).slice(-operations.length),operations.map(([name])=>name));
    assert.deepEqual([...handlers.keys()].slice(-operations.length),operations.map(([,channel])=>'shenyi:'+channel));
    for(const [,operation] of operations){
      const run=handlers.get('shenyi:'+operation);
      for(const context of [{sender:{},senderFrame:event.senderFrame},{sender:event.sender,senderFrame:{url:APP_URL}}]){
        assert.equal((await run(context,{teamId:TEAM})).error.code,'UNTRUSTED_SENDER');
      }
      contents.mainFrame.url='shenyi-preview://document/index.html';
      assert.equal((await run(event,{})).error.code,'UNTRUSTED_SENDER');
      contents.mainFrame.url=APP_URL;
    }
    assert.equal(calls.length,0);
    responses.push(ACCESS,RECONCILIATION_PAGE,{simulation:true,order:ANNUAL_ORDER});
    assert.deepEqual(await api.getBillingAccess(),{ok:true,value:ACCESS});
    assert.deepEqual(await api.reconcileBillingPage({teamId:TEAM,kind:'annual'}),{
      ok:true,value:{results:[RECONCILIATION_ROW],nextCursor:null},
    });
    assert.equal((await api.createBillingOrder({...SELECTION,signature:'extra'})).error.code,'INVALID_INPUT');
    const lookup=await api.getBillingOrder({teamId:TEAM,kind:'annual',orderId:ID});
    assert.equal(lookup.ok,true);
    assert.equal(lookup.value.order.id,ID);
    assert.equal(calls.length,3);
    assert.equal(api.invoke,undefined);assert.equal(api.billingSecret,undefined);
  }finally{dispose();assert.equal(handlers.size,0);}
});

test('billing signed transport requires login and only forwards locally fixed error messages',async()=>{
  let count=0;
  const client=createTeamClient({fetchImpl:async()=>{count++;throw Error('Unexpected transport');}});
  await assert.rejects(client.getBillingAccess(),{code:'SIGN_IN_REQUIRED'});
  await assert.rejects(client.getBillingOrder({teamId:TEAM,kind:'annual',orderId:ID}),{code:'SIGN_IN_REQUIRED'});
  await assert.rejects(client.reconcileBillingPage({teamId:TEAM,kind:'annual'}),{code:'SIGN_IN_REQUIRED'});
  await assert.rejects(client.getRefundIntakeAccess(),{code:'SIGN_IN_REQUIRED'});
  await assert.rejects(client.getRefundIntake({kind:'annual',orderId:ID}),{code:'SIGN_IN_REQUIRED'});
  assert.equal(count,0);
  assert.equal(billingErrorMessage(409,'BILLING_CONFLICT'),'模拟订单或收款状态需要核对，请保留原订单。');
  assert.equal(billingErrorMessage(403,'BILLING_CONFLICT'),undefined);
  assert.equal(billingErrorMessage(409,'toString'),undefined);
  assert.equal(billingErrorMessage(409,'arbitrary gateway error'),undefined);
  assert.match(billingErrorMessage(409,'BILLING_RECONCILIATION_CONFLICT'),/已保存记录/);
  assert.match(billingErrorMessage(409,'BILLING_RECONCILIATION_BUSY'),/稍后重试本批/);
  assert.match(billingErrorMessage(503,'BILLING_RECONCILIATION_RECEIPT_FAILED'),/沿用原请求/);
  assert.equal(billingErrorMessage(403,'BILLING_RECONCILIATION_CONFLICT'),undefined);
});

const INTAKE_ROUTE='/api/platform/billing/refund-intakes/annual/'+ID;
const INTAKE_SELECTION={kind:'annual',orderId:ID,requestId:REQUEST,expectedRevision:0,reason:'duplicate-payment',
  reference:'case-23.A',currentPassword:'synthetic-current-password'};
const INTAKE_ORDER={id:ID,kind:'annual',teamId:TEAM,teamName:'合成团队甲',amountMinor:9000,
  currency:'CNY',status:'paid',confirmedAt:CONFIRMED,paymentException:true};
const INTAKE_ENTRY={revision:1,kind:'intake',reason:'duplicate-payment',reference:'case-23.A',recordedAt:CONFIRMED+1,recordedBy:'owner-demo'};
const INTAKE_RESULT={order:INTAKE_ORDER,revision:1,entries:[INTAKE_ENTRY],nextBeforeRevision:null};

test('refund intake projects closed and late verified orders under the existing role-scoped route',async()=>{
  const {client,responses}=fixture();
  const scope={kind:'annual',orderId:ID};
  const closure={deadlineAt:180,closedAt:190};
  const closed={...INTAKE_ORDER,status:'closed',confirmedAt:null,closure};
  const late={...INTAKE_ORDER,status:'payment-verified',closure};
  const closedResult={...INTAKE_RESULT,order:closed,revision:0,entries:[]};
  const lateResult={...INTAKE_RESULT,order:late};
  responses.push(closedResult,lateResult,lateResult);
  assert.deepEqual(await client.getRefundIntake(scope),closedResult);
  assert.deepEqual(await client.getRefundIntake(scope),lateResult);
  assert.deepEqual(await client.recordRefundIntake(INTAKE_SELECTION),lateResult);
  for(const value of [
    {...closedResult,order:{...closed,closure:undefined}},
    {...closedResult,order:{...closed,confirmedAt:CONFIRMED}},
    {...lateResult,order:{...late,confirmationReceipt:'private'}},
    {...lateResult,order:{...late,confirmedAt:189}},
    {...lateResult,order:{...late,status:'paid'}},
    {...lateResult,order:closed},
  ]){
    responses.push(value);
    await assert.rejects(client.getRefundIntake(scope),{code:'INVALID_RESPONSE'});
  }
});

test('refund intake transport uses exact held-device routes and returns only the bounded order and event fields',async()=>{
 const {client,calls,responses}=fixture();
 responses.push({canReview:true},{...INTAKE_RESULT,revision:0,entries:[]},INTAKE_RESULT,INTAKE_RESULT);
 assert.deepEqual(await client.getRefundIntakeAccess(),{canReview:true});
 assert.deepEqual(await client.getRefundIntake({kind:'annual',orderId:ID}),{...INTAKE_RESULT,revision:0,entries:[]});
 assert.deepEqual(await client.getRefundIntake({kind:'annual',orderId:ID,beforeRevision:2}),INTAKE_RESULT);
 assert.deepEqual(await client.recordRefundIntake(INTAKE_SELECTION),INTAKE_RESULT);
 assert.deepEqual(calls,[
  {route:'/api/auth/refund-intake/access',options:undefined},
  {route:INTAKE_ROUTE,options:undefined},
  {route:INTAKE_ROUTE+'?beforeRevision=2',options:undefined},
  {route:INTAKE_ROUTE,options:{method:'POST',body:{requestId:REQUEST,expectedRevision:0,
   reason:'duplicate-payment',reference:'case-23.A',currentPassword:INTAKE_SELECTION.currentPassword}}},
 ]);
 assert.ok(!JSON.stringify(INTAKE_RESULT).includes('synthetic-current-password'));
 for(const route of ['/api/auth/refund-intake/access?other=1',INTAKE_ROUTE+'?beforeRevision=01',
  INTAKE_ROUTE+'?beforeRevision=9007199254740992',INTAKE_ROUTE+'?beforeRevision=2&more=true',
  INTAKE_ROUTE+'/payments',INTAKE_ROUTE+'\n',INTAKE_ROUTE.replace('annual','all')])assert.equal(isBillingRoute(route),false,route);
});

test('refund intake transport rejects arbitrary order, refund amount, bad reason and private response fields',async()=>{
 const {client,calls,responses}=fixture();
 for(const selection of [
  {...INTAKE_SELECTION,kind:'other'}, {...INTAKE_SELECTION,orderId:'team-a'}, {...INTAKE_SELECTION,amountMinor:10},
  {...INTAKE_SELECTION,reason:'customer-contacted'}, {...INTAKE_SELECTION,reference:'contains spaces'},
  {...INTAKE_SELECTION,reference:'x\n'}, {...INTAKE_SELECTION,currentPassword:''},
  {...INTAKE_SELECTION,currentPassword:'核'.repeat(180)}, {...INTAKE_SELECTION,expectedRevision:1},
 ])await assert.rejects(client.recordRefundIntake(selection),{code:'INVALID_INPUT'});
 assert.equal(calls.length,0);
 for(const value of [
  {...INTAKE_RESULT,order:{...INTAKE_ORDER,teamId:'other',secret:'token'}},
  {...INTAKE_RESULT,order:{...INTAKE_ORDER,id:REQUEST}},
  {...INTAKE_RESULT,entries:[{...INTAKE_ENTRY,privateNote:'internal'}]}, {...INTAKE_RESULT,entries:[{...INTAKE_ENTRY,recordedAt:CREATED}]},
  {...INTAKE_RESULT,nextBeforeRevision:1}, {...INTAKE_RESULT,revision:2}, {...INTAKE_RESULT,currentPassword:'leak'},
 ]) {
  responses.push(value);
  await assert.rejects(client.getRefundIntake({kind:'annual',orderId:ID}),{code:'INVALID_RESPONSE'});
 }
 responses.push({...INTAKE_RESULT,entries:[{...INTAKE_ENTRY,reason:'other'}]});
 await assert.rejects(client.recordRefundIntake(INTAKE_SELECTION),{code:'INVALID_RESPONSE'});
});
