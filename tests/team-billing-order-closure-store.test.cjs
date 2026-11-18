'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHmac,randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {mkdtempSync,unlinkSync,rmdirSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {assertOrderClosureSchema,orderClosureSchemaLayer,withoutEmptyOrderClosureLayer,peelOrderClosureSchema,
  assertOrderClosureSchemaRestored}=require('./helpers/billing-order-closure-schema-layer.cjs');

const AT=Date.parse('2028-02-29T12:00:00+08:00');
const annualProduct='team-annual-renewal',seatProduct='team-seat-addition';
const merchant='synthetic-closure-merchant';
const now=offset=>()=>AT+offset;
const conflict=error=>error.status===409&&error.code==='BILLING_ORDER_CLOSURE_CONFLICT';

function snapshot(db){
  const definitions=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name")
    .all().map(row=>({...row}));
  const tables=definitions.filter(row=>row.type==='table').map(({name})=>{
    const query=db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid');
    query.setReadBigInts(true);
    return {name,rows:query.all()};
  });
  return {definitions,tables};
}

async function fixture(t,db=new DatabaseSync(':memory:')){
  const {initializeTeamDatabase}=await import('../server/team/database.mjs');
  const {transaction}=await import('../server/team/http-utils.mjs');
  const {createAnnualOrderWithinTransaction,recordVerifiedAnnualPayment}=await import('../server/team/billing-store.mjs');
  const {createSeatOrderWithinTransaction,recordVerifiedSeatPayment}=await import('../server/team/seat-order-store.mjs');
  const {recordSubscriptionTerm}=await import('../server/team/subscription-store.mjs');
  const closure=await import('../server/team/billing-order-closure-store.mjs');
  const {recordVerifiedBillingPaymentException}=await import('../server/team/billing-payment-exception-store.mjs');
  t.after(()=>db.close());
  initializeTeamDatabase(db);
  db.exec("INSERT INTO teams VALUES ('team-a','active'),('team-b','active'); INSERT INTO team_users VALUES ('synthetic-operator','active')");
  recordSubscriptionTerm(db,{teamId:'team-b',operationId:randomUUID(),expectedRevision:0,startsAt:AT-100,
    endsAt:AT+86400000,sourceRef:'synthetic-closure'},{now:now(0)});
  const common=teamId=>({teamId,actorId:'synthetic-operator',requestId:randomUUID(),merchantId:merchant});
  const annual=(duration)=>{
    return transaction(db,()=>{
      const order=createAnnualOrderWithinTransaction(db,{...common('team-a'),
        offer:{id:'synthetic-annual',revision:1,product:annualProduct,amountMinor:1000,currency:'CNY'}},{now:now(0)});
      if(duration!==undefined)closure.recordAnnualCloseWindowWithinTransaction(db,order.id,duration);
      return order;
    });
  };
  const seat=()=>transaction(db,()=>createSeatOrderWithinTransaction(db,{...common('team-b'),quantity:2,
    offer:{id:'synthetic-seat',revision:1,annualUnitAmountMinor:16000,currency:'CNY'}},{now:now(0)}));
  const verified=(order,offset,more={})=>({protocol:'shenyi-simulation-order-closure-v1',
    merchantId:merchant,eventId:randomUUID(),orderId:order.id,product:order.offer.product,
    amountMinor:order.offer.amountMinor,currency:'CNY',status:'closed',closedAt:AT+offset,...more});
  const capture=(order,offset,more={})=>{
    const payment={protocol:'shenyi-simulation-payment-v1',merchantId:merchant,eventId:randomUUID(),transactionId:randomUUID(),
      orderId:order.id,product:order.offer.product,amountMinor:order.offer.amountMinor,
      currency:'CNY',status:'succeeded',paidAt:AT+offset,...more};
    return (order.offer.product===annualProduct?recordVerifiedAnnualPayment:recordVerifiedSeatPayment)(db,payment,{now:now(offset)});
  };
  const exception=(order,offset,more={})=>recordVerifiedBillingPaymentException(db,{
    protocol:'shenyi-simulation-payment-exception-v1',merchantId:merchant,eventId:randomUUID(),originalTransactionId:randomUUID(),
    orderId:order.id,product:order.offer.product,amountMinor:order.offer.amountMinor,
    currency:'CNY',kind:'refund',occurredAt:AT+offset,...more,
  },{now:now(offset)});
  return {db,initializeTeamDatabase,closure,annual,seat,verified,capture,exception,transaction,
    record:(receipt,offset)=>closure.recordVerifiedBillingOrderClosure(db,receipt,{now:now(offset)})};
}

test('closure envelope accepts only the distinct signed canonical protocol and bounded JSON',async()=>{
  const codec=await import('../server/team/billing-order-closure.mjs');
  const orderId=randomUUID(),eventId=randomUUID();
  const configuration={merchantId:merchant,signingKey:Buffer.alloc(32,0x6a)};
  const receipt={protocol:'shenyi-simulation-order-closure-v1',merchantId:merchant,eventId,orderId,
    product:annualProduct,amountMinor:1000,currency:'CNY',status:'closed',closedAt:AT};
  const {body,signature}=codec.signSimulationOrderClosure(receipt,configuration);
  assert.equal(body.toString(),JSON.stringify(receipt));
  assert.deepEqual(codec.verifySimulationOrderClosureEnvelope(body,signature,configuration),receipt);
  const mac=(raw,domain='shenyi.billing.simulation.closure.v1\0')=>createHmac('sha256',configuration.signingKey)
    .update(domain).update(raw).digest('hex');
  assert.equal(signature,mac(body));
  assert.throws(()=>codec.verifySimulationOrderClosureEnvelope(body,mac(body,'shenyi.billing.simulation.v1\0'),configuration),
    error=>error.status===403);
  const noncanonical=Buffer.from(JSON.stringify(receipt,null,2));
  assert.throws(()=>codec.verifySimulationOrderClosureEnvelope(noncanonical,mac(noncanonical),configuration),error=>error.status===400);
  assert.throws(()=>codec.verifySimulationOrderClosureEnvelope(body,signature,{...configuration,merchantId:'another-synthetic-merchant'}),
    error=>error.status===400);
  assert.throws(()=>codec.validateSimulationOrderClosure({...receipt,status:'succeeded'}),error=>error.status===400);
  assert.throws(()=>codec.validateSimulationOrderClosure({...receipt,amountMinor:0}),error=>error.status===400);
  const request=(payload,headers)=>new Request('http://127.0.0.1/api/billing/simulation/order-closures',{
    method:'POST',headers:{'Content-Type':'application/json','X-Shenyi-Simulation-Signature':signature,...headers},body:payload,
  });
  assert.deepEqual(await codec.readSimulationOrderClosureRequest(request(body),configuration),receipt);
  await assert.rejects(codec.readSimulationOrderClosureRequest(request(body,{'Content-Type':'text/plain'}),configuration),
    error=>error.status===415);
  await assert.rejects(codec.readSimulationOrderClosureRequest(request(Buffer.alloc(16385)),configuration),error=>error.status===413);
});

test('annual deadline is immutable and a historic order has no synthetic backfill',async t=>{
  const f=await fixture(t),legacy=f.annual(),paidWindow=f.annual(60000);
  assert.equal(f.closure.readAnnualCloseDeadline(f.db,legacy.id),null);
  assert.equal(f.closure.readAnnualCloseDeadline(f.db,paidWindow.id),AT+60000);
  assert.throws(()=>f.closure.recordAnnualCloseWindowWithinTransaction(f.db,paidWindow.id,60000),conflict);
  assert.equal(f.transaction(f.db,()=>f.closure.recordAnnualCloseWindowWithinTransaction(f.db,paidWindow.id,60000)),AT+60000);
  assert.throws(()=>f.transaction(f.db,()=>f.closure.recordAnnualCloseWindowWithinTransaction(f.db,paidWindow.id,60001)),conflict);
  assert.throws(()=>f.record(f.verified(legacy,60000),60000),conflict);
  assert.throws(()=>f.record(f.verified(paidWindow,59999),60000),conflict);
  assert.throws(()=>f.record(f.verified(paidWindow,60000),59999),conflict);
  assert.throws(()=>f.record(f.verified(paidWindow,60000,{amountMinor:1001}),60000),conflict);
  assert.throws(()=>f.record(f.verified(paidWindow,60000,{merchantId:'other-synthetic'}),60000),conflict);
  const before=snapshot(f.db).tables.filter(row=>row.name!=='team_billing_order_closures');
  assert.deepEqual(f.record(f.verified(paidWindow,60000),60000),{closedAt:AT+60000,deadlineAt:AT+60000});
  assert.deepEqual(snapshot(f.db).tables.filter(row=>row.name!=='team_billing_order_closures'),before);
});

test('seat closure uses the locked quote and replay still works after later matching capture',async t=>{
  const f=await fixture(t),order=f.seat(),deadlineAt=order.quoteExpiresAt;
  const offset=deadlineAt-AT;
  const receipt=f.verified(order,offset),expected={closedAt:deadlineAt,deadlineAt};
  assert.throws(()=>f.record({...receipt,closedAt:deadlineAt-1},offset),conflict);
  assert.deepEqual(f.record(receipt,offset),expected);
  assert.deepEqual(f.closure.readBillingOrderClosure(f.db,seatProduct,order.id),expected);
  assert.throws(()=>f.transaction(f.db,()=>f.closure.assertBillingOrderOpenForFulfilment(f.db,seatProduct,order.id)),
    error=>error.status===409&&error.code==='BILLING_ORDER_CLOSED_REVIEW_REQUIRED');
  assert.throws(()=>f.transaction(f.db,()=>f.closure.assertBillingClosureEventUnused(f.db,receipt.eventId)),conflict);
  f.capture(order,offset+10);
  assert.deepEqual(f.record(receipt,offset+10),expected);
  assert.deepEqual(f.closure.readBillingOrderClosure(f.db,seatProduct,order.id),expected);
  assert.throws(()=>f.record({...receipt,eventId:randomUUID()},offset+10),conflict);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_billing_order_closures').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_seat_capacity_grants').get().n,0);
});

test('established captured or reversed evidence and globally used event IDs refuse a first close',async t=>{
  const f=await fixture(t),first=f.annual(30),second=f.annual(30),third=f.annual(30),seat=f.seat();
  const captureId=randomUUID(),exceptionId=randomUUID();
  f.capture(first,1,{eventId:captureId});
  f.exception(second,2,{eventId:exceptionId});
  assert.throws(()=>f.record(f.verified(first,30),30),conflict);
  assert.throws(()=>f.record(f.verified(second,30),30),conflict);
  assert.throws(()=>f.record(f.verified(third,30,{eventId:captureId}),30),conflict);
  assert.throws(()=>f.record(f.verified(seat,seat.quoteExpiresAt-AT,{eventId:exceptionId}),seat.quoteExpiresAt-AT),conflict);
  const saved=f.verified(third,30);
  f.record(saved,30);
  assert.throws(()=>f.record(f.verified(seat,seat.quoteExpiresAt-AT,{eventId:saved.eventId}),seat.quoteExpiresAt-AT),conflict);
  const foreign={...saved,orderId:randomUUID(),eventId:randomUUID()};
  assert.throws(()=>f.record(foreign,30),error=>error.status===404);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_billing_order_closures').get().n,1);
});

test('direct update, deletion, and replacement cannot remove either retained fact',async t=>{
  const f=await fixture(t),order=f.annual(30);
  const receipt=f.verified(order,30);
  assert.throws(()=>f.transaction(f.db,()=>{
    f.closure.recordVerifiedBillingOrderClosureWithinTransaction(f.db,receipt,{now:now(30)});
    throw Error('synthetic rollback');
  }),/synthetic rollback/);
  assert.equal(f.closure.readBillingOrderClosure(f.db,annualProduct,order.id),null);
  f.record(receipt,30);
  for(const table of ['team_billing_order_closures','team_billing_annual_close_windows']){
    for(const sql of ['DELETE FROM '+table,'UPDATE '+table+' SET order_id=order_id',
      'INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table]){
      assert.throws(()=>f.db.exec(sql),/BILLING_ORDER_CLOSURE_IMMUTABLE/);
    }
  }
  const state=snapshot(f.db);
  assert.throws(()=>peelOrderClosureSchema(f.db),/No pinned deadline or verified closure/);
  assert.deepEqual(snapshot(f.db),state);
});

test('persistent upgrade adds only the exact empty closure layer and preserves old typed order facts',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'shenyi-order-closure-layer-')),filename=join(directory,'synthetic.sqlite');
  const f=await fixture(t,new DatabaseSync(filename));
  t.after(()=>{unlinkSync(filename);rmdirSync(directory);});
  const legacy=f.annual();
  f.capture(legacy,10);
  assert.deepEqual(orderClosureSchemaLayer(f.db),{tables:2,objects:11});
  const layer=peelOrderClosureSchema(f.db),original=snapshot(f.db);
  assert.equal(original.tables.length,96);
  assert.equal(original.definitions.length,397);
  const reopened=new DatabaseSync(filename);
  try{
    assert.deepEqual(snapshot(reopened),original);
    for(let index=0;index<2;index++){
      f.initializeTeamDatabase(reopened);
      assertOrderClosureSchemaRestored(reopened,layer);
      assert.deepEqual(withoutEmptyOrderClosureLayer(reopened,snapshot(reopened)),original);
    }
    assert.equal(f.closure.readAnnualCloseDeadline(reopened,legacy.id),null);
    assert.equal(f.closure.readBillingOrderClosure(reopened,annualProduct,legacy.id),null);
    assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{reopened.close();}
  assert.equal(assertOrderClosureSchema(f.db).length,11);
});
