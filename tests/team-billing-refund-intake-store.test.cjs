'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {mkdtempSync,unlinkSync,rmdirSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {assertRefundIntakeSchema,refundIntakeSchemaLayer,withoutEmptyRefundIntakeLayer,peelRefundIntakeSchema,
  assertRefundIntakeSchemaRestored}=require('./helpers/billing-refund-intake-schema-layer.cjs');

const AT=Date.parse('2028-02-29T12:00:00+08:00');
const OWNER='synthetic-refund-owner';
const OPERATOR='synthetic-operator';
const MERCHANT='synthetic-intake-merchant';
const ledger='team_billing_refund_intake_events';
const reviewers='team_billing_refund_intake_reviewers';
const clock=offset=>()=>AT+offset;
const conflict=error=>error.status===409&&error.code==='BILLING_REFUND_INTAKE_CONFLICT';
const paymentRequired=error=>error.status===409&&error.code==='BILLING_REFUND_INTAKE_PAYMENT_REQUIRED';
const denied=error=>error.status===404;

async function fixture(t,{db=new DatabaseSync(':memory:')}={}){
  const {initializeTeamDatabase}=await import('../server/team/database.mjs');
  const {transaction}=await import('../server/team/http-utils.mjs');
  const annual=await import('../server/team/billing-store.mjs');
  const seats=await import('../server/team/seat-order-store.mjs');
  const subscriptions=await import('../server/team/subscription-store.mjs');
  const store=await import('../server/team/billing-refund-intake-store.mjs');
  t.after(()=>db.close());
  initializeTeamDatabase(db);
  db.exec("INSERT INTO teams VALUES ('team-a','active'),('team-b','active')");
  db.prepare("INSERT INTO team_users VALUES (?,'active'),(?,'active')").run(OWNER,OPERATOR);
  db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)')
    .run(OWNER,OWNER,'Synthetic refund operator','synthetic-unusable-hash');
  const grant=()=>db.prepare("INSERT INTO "+reviewers+" (user_id,permission,status) VALUES (?,'billing.refund-intake','active')").run(OWNER);
  const common=teamId=>({teamId,actorId:OPERATOR,requestId:randomUUID(),merchantId:MERCHANT});
  const annualOrder=()=>annual.createAnnualOrder(db,{...common('team-a'),
    offer:{id:'synthetic-annual',revision:1,product:'team-annual-renewal',amountMinor:1000,currency:'CNY'}},{now:clock(0)});
  const seatOrder=()=>{
    subscriptions.recordSubscriptionTerm(db,{teamId:'team-b',operationId:randomUUID(),expectedRevision:0,
      startsAt:AT-100000,endsAt:AT+86400000,sourceRef:'synthetic-intake-seat'},{now:clock(0)});
    return transaction(db,()=>seats.createSeatOrderWithinTransaction(db,{...common('team-b'),quantity:2,
      offer:{id:'synthetic-seat',revision:1,annualUnitAmountMinor:16000,currency:'CNY'}},{now:clock(0)}));
  };
  const capture=(kind,order,{fulfil=true}={})=>{
    const receipt={protocol:'shenyi-simulation-payment-v1',merchantId:MERCHANT,eventId:randomUUID(),
      transactionId:randomUUID(),orderId:order.id,product:order.offer.product,amountMinor:order.offer.amountMinor,
      currency:'CNY',status:'succeeded',paidAt:AT+10};
    const saved=(kind==='annual'?annual.recordVerifiedAnnualPayment:seats.recordVerifiedSeatPayment)(db,receipt,{now:clock(11)});
    if(fulfil)(kind==='annual'?annual.fulfilAnnualOrder:seats.fulfilSeatOrder)(db,order.id,{now:clock(12)});
    return saved;
  };
  const input=(kind,order,more={})=>({kind,orderId:order.id,requestId:randomUUID(),expectedRevision:0,
    actorId:OWNER,authorityRevision:1,reason:'duplicate-payment',reference:'SYNTHETIC-1',...more});
  const append=(args,offset=30)=>transaction(db,()=>store.appendBillingRefundIntake(db,args,{now:clock(offset)}));
  return {db,store,transaction,initializeTeamDatabase,grant,annualOrder,seatOrder,capture,input,append};
}

function snapshot(db){
  const definitions=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").all()
    .map(row=>({...row}));
  const tables=definitions.filter(row=>row.type==='table').map(({name})=>{
    const query=db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid');
    query.setReadBigInts(true);
    return {name,rows:query.all()};
  });
  return {definitions,tables};
}

test('intake references verified annual and seat capture without changing any payment, entitlement or exception fact',async t=>{
  const f=await fixture(t),annual=f.annualOrder(),seat=f.seatOrder();
  f.grant();
  assert.deepEqual(f.store.readBillingRefundTarget(f.db,'annual',annual.id),{
    id:annual.id,kind:'annual',teamId:'team-a',amountMinor:1000,currency:'CNY',
    status:'pending',confirmedAt:null,paymentException:false,
  });
  assert.deepEqual(f.store.readBillingRefundIntake(f.db,'annual',annual.id),{revision:0,entries:[],nextBeforeRevision:null});
  assert.throws(()=>f.append(f.input('annual',annual)),paymentRequired);
  assert.throws(()=>f.append(f.input('seat',annual)),denied);
  const paymentA=f.capture('annual',annual),paymentB=f.capture('seat',seat,{fulfil:false});
  const targetB=f.store.readBillingRefundTarget(f.db,'seat',seat.id);
  assert.equal(targetB.status,'payment-verified');
  assert.equal(targetB.amountMinor,seat.offer.amountMinor);
  const before=snapshot(f.db).tables.filter(row=>row.name!==ledger);
  const request=f.input('annual',annual),initial=f.append(request);
  assert.deepEqual(initial,{revision:1,kind:'intake',reason:'duplicate-payment',reference:'SYNTHETIC-1',recordedAt:AT+30,recordedBy:OWNER});
  const second=f.append(f.input('seat',seat,{reason:'service-issue',reference:null}));
  assert.equal(second.revision,1);
  assert.equal(second.reference,null);
  assert.deepEqual(f.db.prepare('SELECT team_id,order_id,payment_id FROM '+ledger+' ORDER BY order_kind').all().map(row=>({...row})),[
    {team_id:'team-a',order_id:annual.id,payment_id:paymentA.paymentId},
    {team_id:'team-b',order_id:seat.id,payment_id:paymentB.paymentId},
  ]);
  assert.deepEqual(snapshot(f.db).tables.filter(row=>row.name!==ledger),before);
});

test('request replay, CAS, rollback and bounded chronological paging preserve one append-only timeline',async t=>{
  const f=await fixture(t),order=f.annualOrder();
  f.grant();f.capture('annual',order);
  const original=f.input('annual',order);
  assert.throws(()=>f.store.appendBillingRefundIntake(f.db,original),conflict);
  assert.throws(()=>f.transaction(f.db,()=>{
    f.store.appendBillingRefundIntake(f.db,original,{now:clock(30)});
    throw Error('synthetic rollback');
  }),/synthetic rollback/);
  assert.equal(f.store.readBillingRefundIntake(f.db,'annual',order.id).revision,0);
  const first=f.append(original);
  assert.deepEqual(f.append(original,31),first);
  assert.throws(()=>f.append({...original,reason:'other'}),conflict);
  assert.throws(()=>f.append(f.input('annual',order)),conflict);
  assert.throws(()=>f.append(f.input('annual',order,{expectedRevision:1,reason:'details-requested'}),29),conflict);
  for(let index=1;index<=22;index++){
    const next=f.append(f.input('annual',order,{expectedRevision:index,reason:'customer-contacted'}),30+index);
    assert.equal(next.revision,index+1);
    assert.equal(next.kind,'follow-up');
  }
  const page=f.store.readBillingRefundIntake(f.db,'annual',order.id);
  assert.equal(page.revision,23);
  assert.deepEqual(page.entries.map(row=>row.revision),Array.from({length:20},(_,index)=>23-index));
  assert.equal(page.nextBeforeRevision,4);
  const older=f.store.readBillingRefundIntake(f.db,'annual',order.id,{beforeRevision:page.nextBeforeRevision});
  assert.equal(older.revision,23);
  assert.deepEqual(older.entries.map(row=>row.revision),[3,2,1]);
  assert.equal(older.nextBeforeRevision,null);
  assert.deepEqual(f.append(original,67),first);
  assert.throws(()=>f.store.readBillingRefundIntake(f.db,'annual',order.id,{beforeRevision:24}),error=>error.status===400);
});

test('protected grant and journal refuse reassign, revision ABA, deletion, replacement and damaged audit',async t=>{
  const f=await fixture(t),order=f.annualOrder();
  f.grant();f.capture('annual',order);f.append(f.input('annual',order));
  for(const sql of [
    'UPDATE '+ledger+' SET reason=reason','DELETE FROM '+ledger,
    'INSERT OR REPLACE INTO '+ledger+' SELECT * FROM '+ledger,
    'UPDATE '+reviewers+" SET status='revoked'",'DELETE FROM '+reviewers,
    'INSERT OR REPLACE INTO '+reviewers+' SELECT * FROM '+reviewers,
  ])assert.throws(()=>f.db.exec(sql),/BILLING_REFUND_INTAKE_(?:IMMUTABLE|AUTHORITY)/);
  f.db.prepare("UPDATE "+reviewers+" SET status='revoked',revision=2 WHERE user_id=?").run(OWNER);
  assert.throws(()=>f.append(f.input('annual',order,{expectedRevision:1,reason:'payment-checked'})),denied);
  assert.throws(()=>f.db.prepare("INSERT INTO team_memberships VALUES ('team-a',?,'assistant','active')").run(OWNER),/BILLING_REFUND_INTAKE_AUTHORITY/);
  assert.throws(()=>f.db.prepare("INSERT INTO team_operators VALUES ('team-b',?,'administrator','active')").run(OWNER),/BILLING_REFUND_INTAKE_AUTHORITY/);
  f.db.prepare("INSERT INTO team_operators VALUES ('team-b',?,'administrator','active')").run(OPERATOR);
  assert.throws(()=>f.db.prepare("INSERT INTO "+reviewers+" VALUES (?,'billing.refund-intake','active',1)").run(OPERATOR),/BILLING_REFUND_INTAKE_AUTHORITY/);
  f.db.prepare("UPDATE "+reviewers+" SET status='active',revision=3 WHERE user_id=?").run(OWNER);
  const next=f.append(f.input('annual',order,{expectedRevision:1,reason:'payment-checked',authorityRevision:3}));
  assert.equal(next.revision,2);
  f.db.exec("DROP TRIGGER billing_refund_intake_event_no_update; UPDATE "+ledger+" SET record_sha256=printf('%064d',0) WHERE revision=1");
  assert.throws(()=>f.store.readBillingRefundIntake(f.db,'annual',order.id),conflict);
});

test('persistent upgrade adds the exact empty layer to an old database and retains all original typed facts',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'shenyi-refund-layer-')),filename=join(directory,'synthetic.sqlite');
  const f=await fixture(t,{db:new DatabaseSync(filename)}),order=f.annualOrder();
  f.capture('annual',order);
  assert.deepEqual(refundIntakeSchemaLayer(f.db),{tables:2,objects:20});
  const layer=peelRefundIntakeSchema(f.db),old=snapshot(f.db);
  assert.equal(old.tables.length,94);
  assert.equal(old.definitions.length,377);
  const copy=new DatabaseSync(filename);
  try{
    assert.deepEqual(snapshot(copy),old);
    f.initializeTeamDatabase(copy);assertRefundIntakeSchemaRestored(copy,layer);
    assert.deepEqual(withoutEmptyRefundIntakeLayer(copy,snapshot(copy)),old);
    f.initializeTeamDatabase(copy);assertRefundIntakeSchemaRestored(copy,layer);
    assert.deepEqual(withoutEmptyRefundIntakeLayer(copy,snapshot(copy)),old);
    assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{copy.close();}
  f.grant();f.append(f.input('annual',order));
  assertRefundIntakeSchema(f.db,{empty:false});
  const retained=snapshot(f.db);
  assert.throws(()=>peelRefundIntakeSchema(f.db),/No refund intake record or reviewer history/);
  assert.deepEqual(snapshot(f.db),retained);
  t.after(()=>{unlinkSync(filename);rmdirSync(directory);});
});

for(const retained of ['reviewer','event'])test('existing '+retained+' history prevents regenerating a missing device server ID',async t=>{
  const f=await fixture(t);
  f.grant();
  if(retained==='event'){
    const order=f.annualOrder();
    f.capture('annual',order);f.append(f.input('annual',order));
    const guard=f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='billing_refund_intake_reviewer_no_delete'").get().sql;
    f.db.exec('PRAGMA foreign_keys=OFF; DROP TRIGGER billing_refund_intake_reviewer_no_delete; DELETE FROM '+reviewers);
    f.db.exec(guard);f.db.exec('PRAGMA foreign_keys=ON');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+ledger).get().n,1);
  }
  f.db.prepare("DELETE FROM team_database_metadata WHERE name='device-server-id'").run();
  const before=snapshot(f.db);
  assert.throws(()=>f.initializeTeamDatabase(f.db),/Device history has no server identity/);
  assert.deepEqual(snapshot(f.db),before);
});
