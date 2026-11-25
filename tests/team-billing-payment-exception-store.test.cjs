'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomUUID,randomBytes,createHmac}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {assertPaymentExceptionSchema,paymentExceptionSchemaLayer,withoutEmptyPaymentExceptionLayer,
  peelPaymentExceptionSchema,assertPaymentExceptionSchemaRestored}=require('./helpers/billing-payment-exception-schema-layer.cjs');

const AT=Date.parse('2028-02-29T12:00:00+08:00');
const MERCHANT='synthetic-exception-merchant';
const SIGNATURE='X-Shenyi-Simulation-Signature';
const domain='shenyi.billing.simulation.exception.v1\0';
const clock=offset=>()=>AT+offset;
const rejected=(code='BILLING_PAYMENT_EXCEPTION_CONFLICT',status=409)=>error=>error.status===status&&error.code===code;
const view=(kind,occurredAt)=>({kind,occurredAt,state:'review-required'});

async function fixture(t){
  const {initializeTeamDatabase}=await import('../server/team/database.mjs');
  const annual=await import('../server/team/billing-store.mjs');
  const seats=await import('../server/team/seat-order-store.mjs');
  const subscriptions=await import('../server/team/subscription-store.mjs');
  const {transaction}=await import('../server/team/http-utils.mjs');
  const store=await import('../server/team/billing-payment-exception-store.mjs');
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  initializeTeamDatabase(db);
  db.exec("INSERT INTO teams VALUES ('team-a','active'),('team-b','active'); INSERT INTO team_users VALUES ('synthetic-operator','active');");
  const orderInput=teamId=>({teamId,actorId:'synthetic-operator',merchantId:MERCHANT,requestId:randomUUID()});
  const annualOrder=(teamId='team-a')=>annual.createAnnualOrder(db,{...orderInput(teamId),offer:{id:'annual-catalog',revision:1,
    product:'team-annual-renewal',amountMinor:1200,currency:'CNY'}},{now:clock(0)});
  const seatOrder=()=>{
    const start=AT-5000000,end=AT+90*86400000;
    subscriptions.recordSubscriptionTerm(db,{teamId:'team-b',operationId:randomUUID(),expectedRevision:0,startsAt:start,endsAt:end,
      sourceRef:'synthetic-seat-exception-term'},{now:clock(0)});
    return transaction(db,()=>seats.createSeatOrderWithinTransaction(db,{...orderInput('team-b'),
      offer:{id:'seat-catalog',revision:1,annualUnitAmountMinor:1200,currency:'CNY'},quantity:2},{now:clock(0)}));
  };
  const exception=(order,more={})=>({protocol:'shenyi-simulation-payment-exception-v1',merchantId:MERCHANT,eventId:randomUUID(),
    originalTransactionId:randomUUID(),orderId:order.id,product:order.offer.product,amountMinor:order.offer.amountMinor,currency:'CNY',
    kind:'refund',occurredAt:AT+20,...more});
  const capture=(order,more={})=>({protocol:'shenyi-simulation-payment-v1',merchantId:MERCHANT,eventId:randomUUID(),transactionId:randomUUID(),
    orderId:order.id,product:order.offer.product,amountMinor:order.offer.amountMinor,currency:'CNY',status:'succeeded',paidAt:AT+10,...more});
  const audit=()=>db.prepare('SELECT * FROM team_billing_payment_exceptions ORDER BY event_id').all().map(row=>({...row}));
  const record=(event,now=clock(30))=>store.recordVerifiedBillingPaymentException(db,event,{now});
  return {db,initializeTeamDatabase,annual,seats,subscriptions,transaction,store,annualOrder,seatOrder,exception,capture,record,audit};
}

function snapshot(db){
  const definitions=db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema
    WHERE sql IS NOT NULL ORDER BY type,name`).all().map(row=>({...row}));
  const tables=definitions.filter(row=>row.type==='table').map(({name})=>{
    const select=db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid');
    select.setReadBigInts(true);
    return {name,rows:select.all()};
  });
  return {definitions,tables};
}

test('exception signature domain, canonical JSON, scoped merchant and bounded raw body are enforced',async t=>{
  const f=await fixture(t),order=f.annualOrder(),receipt=f.exception(order);
  const codec=await import('../server/team/billing-payment-exception.mjs');
  const captureCodec=await import('../server/team/billing-simulation.mjs');
  const cfg={merchantId:MERCHANT,signingKey:randomBytes(32)};
  const {body,signature}=codec.signSimulationPaymentException(receipt,cfg);
  const sign=(bytes,purpose=domain)=>createHmac('sha256',cfg.signingKey).update(purpose).update(bytes).digest('hex');
  assert.equal(signature,sign(body));
  assert.deepEqual(codec.verifySimulationPaymentExceptionEnvelope(body,signature,cfg),receipt);
  assert.throws(()=>codec.verifySimulationPaymentExceptionEnvelope(body,sign(body,'shenyi.billing.simulation.v1\0'),cfg),
    rejected('SIMULATION_SIGNATURE_REQUIRED',403));
  assert.throws(()=>captureCodec.verifySimulationPaymentEnvelope(body,signature,cfg),rejected('SIMULATION_SIGNATURE_REQUIRED',403));
  assert.throws(()=>codec.verifySimulationPaymentExceptionEnvelope(body,signature,{...cfg,merchantId:'synthetic-foreign'}),rejected('INVALID_INPUT',400));
  const duplicate=Buffer.from(body.toString().replace('{','{"kind":"refund",'));
  for(const invalidBody of [Buffer.concat([body,Buffer.from(' ')]),duplicate,Buffer.concat([body,Buffer.from([0xff])])]){
    assert.throws(()=>codec.verifySimulationPaymentExceptionEnvelope(invalidBody,sign(invalidBody),cfg),rejected('INVALID_INPUT',400));
  }
  const request=(data,headers={},options={})=>new Request('http://127.0.0.1:1/synthetic',{method:'POST',body:data,
    headers:{'Content-Type':'application/json',[SIGNATURE]:signature,...headers},...options});
  assert.deepEqual(await codec.readSimulationPaymentExceptionRequest(request(body),cfg),receipt);
  await assert.rejects(codec.readSimulationPaymentExceptionRequest(request(body,{'Content-Length':'16385'}),cfg),rejected('TOO_LARGE',413));
  await assert.rejects(codec.readSimulationPaymentExceptionRequest(request(body,{'Content-Type':'application/octet-stream'}),cfg),rejected('JSON_REQUIRED',415));
  let cancelled=false;
  const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(17000));},cancel(){cancelled=true;}});
  await assert.rejects(codec.readSimulationPaymentExceptionRequest(request(stream,{}, {duplex:'half'}),cfg),rejected('TOO_LARGE',413));
  assert.equal(cancelled,true);
});

test('out of order verified reversal gets one immutable fact and can only pair with the original capture',async t=>{
  const f=await fixture(t),order=f.annualOrder();
  const receipt=f.exception(order),paid=f.capture(order,{transactionId:receipt.originalTransactionId});
  assert.equal(f.store.readBillingPaymentException(f.db,receipt.product,order.id),null);
  const expected=view('refund',receipt.occurredAt);
  assert.deepEqual(f.record(receipt),expected);
  const before=f.audit();
  assert.deepEqual(f.record(receipt,clock(300)),expected);
  assert.deepEqual(f.audit(),before);
  assert.equal(before[0].recorded_at,AT+30);
  assert.deepEqual(f.store.readBillingPaymentException(f.db,receipt.product,order.id),expected);
  assert.equal(f.subscriptions.readSubscriptionState(f.db,order.teamId,AT+30).revision,0);
  assert.throws(()=>f.store.assertBillingCaptureCompatible(f.db,paid),rejected());
  f.transaction(f.db,()=>{
    assert.doesNotThrow(()=>f.store.assertBillingCaptureCompatible(f.db,paid));
    assert.throws(()=>f.store.assertBillingPaymentFulfillable(f.db,paid),rejected('BILLING_PAYMENT_EXCEPTION_REVIEW_REQUIRED'));
    assert.throws(()=>f.record(receipt),rejected());
  });
  for(const extra of [{transactionId:randomUUID()},{paidAt:receipt.occurredAt+1},{eventId:receipt.eventId}]){
    assert.throws(()=>f.transaction(f.db,()=>f.store.assertBillingCaptureCompatible(f.db,{...paid,...extra})),rejected());
  }
  assert.deepEqual(f.audit(),before);
});

test('locked full amount, timeline and cross-product transaction and event identity must agree',async t=>{
  const f=await fixture(t),annual=f.annualOrder(),seat=f.seatOrder();
  const paid=f.capture(seat);
  f.seats.recordVerifiedSeatPayment(f.db,paid,{now:clock(12)});
  const valid=f.exception(seat,{kind:'chargeback',originalTransactionId:paid.transactionId});
  for(const extra of [{merchantId:'synthetic-foreign'},{amountMinor:valid.amountMinor-1},{occurredAt:AT-1},
    {occurredAt:paid.paidAt-1},{occurredAt:AT+31},{originalTransactionId:randomUUID()},{eventId:paid.eventId}]){
    assert.throws(()=>f.record({...valid,...extra}),rejected());
  }
  assert.throws(()=>f.record(f.exception(annual,{originalTransactionId:paid.transactionId})),rejected());
  assert.throws(()=>f.record(f.exception(annual,{eventId:paid.eventId})),rejected());
  assert.deepEqual(f.audit(),[]);
  assert.deepEqual(f.record(valid),view('chargeback',valid.occurredAt));
  const prior=f.audit();
  assert.throws(()=>f.record({...valid,eventId:randomUUID()}),rejected());
  for(const extra of [{eventId:valid.eventId},{transactionId:valid.originalTransactionId}]){
    const other=f.capture(annual,extra);
    assert.throws(()=>f.transaction(f.db,()=>f.store.assertBillingCaptureCompatible(f.db,other)),rejected());
  }
  assert.deepEqual(f.audit(),prior);
});

test('schema upgrade preserves paid order history and only the exact empty layer can be projected',async t=>{
  const f=await fixture(t),order=f.annualOrder();
  const captured=f.capture(order);
  f.annual.recordVerifiedAnnualPayment(f.db,captured,{now:clock(11)});
  f.annual.fulfilAnnualOrder(f.db,order.id,{now:clock(12)});
  const paid=f.annual.readAnnualOrder(f.db,'team-a',order.id);
  assert.equal(paid.status,'paid');
  assert.deepEqual(paymentExceptionSchemaLayer(f.db),{tables:1,objects:5});
  const layer=peelPaymentExceptionSchema(f.db),old=snapshot(f.db);
  assert.equal(old.tables.length,93);
  assert.equal(old.definitions.length,372);
  f.initializeTeamDatabase(f.db);
  assertPaymentExceptionSchemaRestored(f.db,layer);
  assert.deepEqual(withoutEmptyPaymentExceptionLayer(f.db,snapshot(f.db)),old);
  assert.deepEqual(f.annual.readAnnualOrder(f.db,'team-a',order.id),paid);
  const event=f.exception(order,{originalTransactionId:captured.transactionId});
  assert.throws(()=>f.store.recordVerifiedBillingPaymentExceptionWithinTransaction(f.db,event,{now:clock(30)}),rejected());
  assert.throws(()=>f.transaction(f.db,()=>{
    f.store.recordVerifiedBillingPaymentExceptionWithinTransaction(f.db,event,{now:clock(30)});
    throw Error('synthetic outer rollback');
  }),/synthetic outer rollback/);
  assert.deepEqual(f.audit(),[]);
  f.record(event);
  assertPaymentExceptionSchema(f.db,{empty:false});
  const history=snapshot(f.db);
  for(const attempt of [()=>peelPaymentExceptionSchema(f.db),()=>withoutEmptyPaymentExceptionLayer(f.db,history)]){
    assert.throws(attempt,/No recorded payment exception/);
    assert.deepEqual(snapshot(f.db),history);
  }
  f.initializeTeamDatabase(f.db);
  assert.deepEqual(snapshot(f.db),history);
  assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('direct UPDATE, DELETE and REPLACE retain the fact, and a damaged stored digest fails closed',async t=>{
  const f=await fixture(t),order=f.annualOrder(),event=f.exception(order);
  f.record(event);
  const before=f.audit();
  for(const sql of ["UPDATE team_billing_payment_exceptions SET kind='chargeback'",'DELETE FROM team_billing_payment_exceptions',
    'INSERT OR REPLACE INTO team_billing_payment_exceptions SELECT * FROM team_billing_payment_exceptions']){
    assert.throws(()=>f.db.exec(sql),/BILLING_PAYMENT_EXCEPTION_IMMUTABLE/);
  }
  assert.deepEqual(f.audit(),before);
  f.db.exec("DROP TRIGGER billing_payment_exceptions_no_update; UPDATE team_billing_payment_exceptions SET receipt_sha256=printf('%064d',0)");
  assert.throws(()=>f.store.readBillingPaymentException(f.db,event.product,event.orderId),rejected());
  assert.throws(()=>f.record(event),rejected());
  const paid=f.capture(order,{transactionId:event.originalTransactionId});
  assert.throws(()=>f.transaction(f.db,()=>f.store.assertBillingPaymentFulfillable(f.db,paid)),rejected());
});
