'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{randomUUID,createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),path=require('node:path'),fs=require('node:fs');
const load=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const AT=Date.parse('2028-02-29T04:34:56.789Z'),YEAR=365*86400000,MAX=Number.MAX_SAFE_INTEGER;
const fault=(status,code)=>e=>e?.status===status&&e.code===code,conflict=fault(409,'SEAT_ORDER_CONFLICT'),reconcile=fault(409,'SEAT_ORDER_RECONCILIATION_REQUIRED'),invalid=fault(400,'INVALID_INPUT');
const sha=v=>createHash('sha256').update(v).digest('hex');
const TABLES=['team_seat_orders','team_seat_verified_payments','team_seat_capacity_grants','team_subscription_events','team_subscription_heads','team_annual_orders','team_annual_verified_payments','team_annual_fulfilments'];
function rows(db){return TABLES.map(name=>{const q=db.prepare('SELECT * FROM '+name+' ORDER BY rowid');q.setReadBigInts(true);return{name,rows:q.all()};});}
async function fixture(t,{at=AT,startsAt=at-1000,endsAt=at+YEAR/3,term=true}={}){
 const {initializeTeamDatabase}=await load('database.mjs'),db=new DatabaseSync(':memory:');initializeTeamDatabase(db);db.exec("INSERT INTO teams VALUES ('team-a','active'),('team-b','active');INSERT INTO team_users VALUES ('admin','active'),('other-admin','active')");t.after(()=>db.close());
 const store=await load('seat-order-store.mjs'),subscription=await load('subscription-store.mjs'),capacity=await load('seat-capacity-store.mjs'),clock={value:at},transaction=(await load('http-utils.mjs')).transaction;
 const setTerm=(extra={})=>subscription.recordSubscriptionTerm(db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:db.prepare("SELECT revision FROM team_subscription_heads WHERE team_id='team-a'").get()?.revision??0,startsAt,endsAt,sourceRef:'synthetic-seat-order-term',...extra},{now:()=>clock.value});
 if(term)setTerm();
 const input=(extra={})=>({teamId:'team-a',actorId:'admin',requestId:randomUUID(),merchantId:'synthetic-merchant',offer:{id:'synthetic-seat-offer',revision:1,annualUnitAmountMinor:10000,currency:'CNY'},quantity:2,...extra});
 const create=(value=input(),now=()=>clock.value)=>transaction(db,()=>store.createSeatOrderWithinTransaction(db,value,{now}));
 const receipt=(order,extra={})=>({protocol:'shenyi-simulation-payment-v1',merchantId:order.merchantId,eventId:randomUUID(),transactionId:randomUUID(),orderId:order.id,product:'team-seat-addition',amountMinor:order.offer.amountMinor,currency:'CNY',status:'succeeded',paidAt:order.createdAt,...extra});
 const record=value=>store.recordVerifiedSeatPayment(db,value,{now:()=>clock.value}),fulfil=id=>store.fulfilSeatOrder(db,id,{now:()=>clock.value});
 return{db,store,subscription,capacity,clock,setTerm,input,create,receipt,record,fulfil,initialize:()=>initializeTeamDatabase(db)};
}

test('exact remaining milliseconds prorate the whole order and ceil once, not once per seat',async t=>{
 const f=await fixture(t),value=f.input({quantity:2,offer:{id:'one-minor-unit',revision:1,annualUnitAmountMinor:1,currency:'CNY'}}),order=f.create(value);assert.equal(order.offer.amountMinor,1);assert.equal(order.offer.product,'team-seat-addition');assert.equal(order.quantity,2);assert.equal(order.annualUnitAmountMinor,1);assert.equal(order.termRevision,1);assert.equal(order.termStartsAt,AT-1000);assert.equal(order.termEndsAt,AT+YEAR/3);assert.equal(order.quoteExpiresAt,AT+900000);assert.equal(order.status,'pending');assert.equal(order.grant,null);assert.equal(Object.isFrozen(order),true);assert.equal(Object.isFrozen(order.offer),true);
 const locked={...value,termRevision:1,termStartsAt:AT-1000,termEndsAt:AT+YEAR/3,createdAt:AT};assert.equal(f.db.prepare('SELECT request_sha256 FROM team_seat_orders').get().request_sha256,sha(JSON.stringify(locked)));
 for(const key of ['receipt','receipt_json','receiptSha256','transactionId','signingKey'])assert.equal(Object.hasOwn(order,key),false);
});

test('Beijing next-calendar-year denominator includes a leap day rather than a fixed365-day year',async t=>{
 const at=Date.parse('2027-03-01T00:00:00Z'),f=await fixture(t,{at,endsAt:at+YEAR}),order=f.create(f.input({quantity:1,offer:{id:'leap-denominator',revision:1,annualUnitAmountMinor:366,currency:'CNY'}}));assert.equal(order.offer.amountMinor,365);
 const short=await fixture(t,{endsAt:AT+1}),small=short.create(short.input({quantity:1000,offer:{id:'one-ms',revision:1,annualUnitAmountMinor:1,currency:'CNY'}}));assert.equal(small.offer.amountMinor,1);assert.equal(small.quoteExpiresAt,AT+1);
});

test('create only joins caller transactions, requires an active term and cannot charge an unsafe total',async t=>{
 const f=await fixture(t,{term:false}),value=f.input();assert.throws(()=>f.store.createSeatOrderWithinTransaction(f.db,value),conflict);assert.throws(()=>f.create(value),fault(402,'SUBSCRIPTION_WRITE_UNAVAILABLE'));f.setTerm({startsAt:AT+1,endsAt:AT+1000});assert.throws(()=>f.create(value),fault(402,'SUBSCRIPTION_WRITE_UNAVAILABLE'));f.clock.value=AT+1000;assert.throws(()=>f.create(value),fault(402,'SUBSCRIPTION_WRITE_UNAVAILABLE'));
 const g=await fixture(t,{endsAt:AT+YEAR});assert.throws(()=>g.create(g.input({quantity:1000,offer:{id:'overflow',revision:1,annualUnitAmountMinor:MAX,currency:'CNY'}})),conflict);assert.equal(g.db.prepare('SELECT COUNT(*) n FROM team_seat_orders').get().n,0);
 g.db.exec('BEGIN IMMEDIATE');const made=g.store.createSeatOrderWithinTransaction(g.db,g.input(),{now:()=>AT});assert.equal(g.db.isTransaction,true);g.db.exec('ROLLBACK');assert.equal(g.store.readSeatOrder(g.db,'team-a',made.id),null);
});

test('semantic replay preserves its original locked price/term/time after renewal or expiry and rejects changed request identity',async t=>{
 const f=await fixture(t),value=f.input(),order=f.create(value);f.setTerm({endsAt:order.termEndsAt+YEAR});f.clock.value=order.termEndsAt+1;const before=rows(f.db);assert.deepEqual(f.create(Object.fromEntries(Object.entries(value).reverse()),()=>{throw Error('replay clock must not run');}),order);assert.deepEqual(rows(f.db),before);
 for(const change of [{actorId:'other-admin'},{merchantId:'other-merchant'},{quantity:3},{offer:{...value.offer,annualUnitAmountMinor:1}},{offer:{...value.offer,revision:2}}])assert.throws(()=>f.create({...value,...change}),conflict);assert.deepEqual(rows(f.db),before);
});

test('passive order inputs reject accessors, proxies and price/quantity forgery before any order exists',async t=>{
 const f=await fixture(t),base=f.input();let called=0;const getter={...base};Object.defineProperty(getter,'offer',{enumerable:true,get(){called++;return base.offer;}});const proxy=new Proxy(base,{getPrototypeOf(){called++;return Object.prototype;}});
 for(const value of [getter,proxy,{...base,product:'team-seat-addition'},{...base,[Symbol('x')]:1},{...base,quantity:0},{...base,quantity:1001},{...base,quantity:1.5},{...base,quantity:'2'},{...base,offer:{...base.offer,amountMinor:1}},{...base,offer:{...base.offer,annualUnitAmountMinor:0}},{...base,offer:{...base.offer,annualUnitAmountMinor:new Number(1)}}])assert.throws(()=>f.create(value),invalid);assert.equal(called,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_seat_orders').get().n,0);
});

test('order lookup and pagination preserve team/actor/request and opaque anchor scope',async t=>{
 const f=await fixture(t),v=f.input(),a=f.create(v),b=f.create();f.subscription.recordSubscriptionTerm(f.db,{teamId:'team-b',operationId:randomUUID(),expectedRevision:0,startsAt:AT-1,endsAt:AT+YEAR,sourceRef:'foreign-synthetic'},{now:()=>AT});const foreign=f.create(f.input({teamId:'team-b'})),expected=[a,b].sort((x,y)=>x.id<y.id?-1:1);
 assert.deepEqual(f.store.readSeatOrderRequest(f.db,'team-a','admin',v.requestId),a);assert.equal(f.store.readSeatOrderRequest(f.db,'team-a','other-admin',v.requestId),null);assert.equal(f.store.readSeatOrder(f.db,'team-b',a.id),null);assert.deepEqual(f.store.listSeatOrders(f.db,'team-a',{limit:1}),{orders:[expected[0]],hasMore:true});assert.deepEqual(f.store.listSeatOrders(f.db,'team-a',{limit:1,after:expected[0].id}),{orders:[expected[1]],hasMore:false});assert.throws(()=>f.store.listSeatOrders(f.db,'team-a',{after:foreign.id}),fault(404,'NOT_FOUND'));
});

test('verified inbox persists before grant; successful fulfilment adds only the locked quantity until locked end',async t=>{
 const f=await fixture(t),order=f.create(),receipt=f.receipt(order);f.clock.value=AT+100;const payment=f.record(receipt),terms=rows(f.db).filter(x=>x.name.startsWith('team_subscription')||x.name.startsWith('team_annual'));assert.equal(payment.confirmedAt,AT+100);assert.equal(f.store.readSeatOrder(f.db,'team-a',order.id).status,'payment-verified');assert.equal(f.capacity.readSeatCapacity(f.db,'team-a',f.clock.value).purchasedSeats,0);
 f.clock.value+=50;const made=f.fulfil(order.id);assert.equal(made.order.status,'paid');assert.deepEqual(made.grant,{grantId:order.id,seats:2,startsAt:AT+100,endsAt:order.termEndsAt,recordedAt:AT+150});assert.deepEqual(made.order.grant,made.grant);assert.deepEqual(rows(f.db).filter(x=>x.name.startsWith('team_subscription')||x.name.startsWith('team_annual')),terms);assert.equal(f.capacity.readSeatCapacity(f.db,'team-a',AT+99).purchasedSeats,0);assert.equal(f.capacity.readSeatCapacity(f.db,'team-a',AT+100).purchasedSeats,2);assert.equal(f.capacity.readSeatCapacity(f.db,'team-a',order.termEndsAt).purchasedSeats,0);
 const before=rows(f.db);f.clock.value=order.termEndsAt+YEAR;assert.deepEqual(f.fulfil(order.id),made);assert.deepEqual(f.store.fulfilSeatOrder(f.db,order.id,{now:()=>{throw Error('paid replay must not reread clock');}}),made);assert.deepEqual(rows(f.db),before);
});

test('a timely payment can notify after quote expiry while term is active, with grant starting only at trusted acceptance',async t=>{
 const f=await fixture(t),order=f.create(),receipt=f.receipt(order,{paidAt:order.quoteExpiresAt-1});f.clock.value=order.quoteExpiresAt+5000;const payment=f.record(receipt),done=f.fulfil(order.id);assert.equal(done.grant.startsAt,payment.confirmedAt);assert.equal(done.grant.endsAt,order.termEndsAt);assert.equal(done.order.status,'paid');
});

test('late or exact-deadline payment remains durably verified and requires reconciliation without any grant',async t=>{
 for(const delta of [0,1]){const f=await fixture(t),order=f.create(),receipt=f.receipt(order,{paidAt:order.quoteExpiresAt+delta});f.clock.value=receipt.paidAt+1;const payment=f.record(receipt),before=rows(f.db);assert.throws(()=>f.fulfil(order.id),reconcile);assert.equal(f.store.readSeatOrder(f.db,'team-a',order.id).status,'payment-verified');assert.deepEqual(f.record(receipt),payment);assert.deepEqual(rows(f.db),before);}
});

test('exact locked-end arrival preserves inbox and never silently extends a paid seat period',async t=>{
 const f=await fixture(t,{endsAt:AT+1000}),order=f.create();f.clock.value=AT+1;const receipt=f.receipt(order),payment=f.record(receipt);f.clock.value=order.termEndsAt;const before=rows(f.db);assert.throws(()=>f.fulfil(order.id),reconcile);assert.deepEqual(f.record(receipt),payment);assert.deepEqual(rows(f.db),before);
});

test('payment timestamps must bracket creation and trusted acceptance; semantic replay never changes the first confirmation',async t=>{
 const f=await fixture(t),order=f.create(),before=rows(f.db);for(const patch of [{paidAt:AT-1},{paidAt:AT+1},{amountMinor:order.offer.amountMinor+1},{merchantId:'another-merchant'},{product:'team-annual-renewal'}])assert.throws(()=>f.record(f.receipt(order,patch)),conflict);assert.deepEqual(rows(f.db),before);
 f.clock.value=AT+100;const receipt=f.receipt(order,{paidAt:AT+50}),payment=f.record(receipt),saved=rows(f.db);assert.deepEqual(f.store.recordVerifiedSeatPayment(f.db,{...receipt},{now:()=>{throw Error('replay clock must not run');}}),payment);
 for(const patch of [{paidAt:AT+51},{eventId:randomUUID()},{transactionId:randomUUID()}])assert.throws(()=>f.record({...receipt,...patch}),conflict);assert.deepEqual(rows(f.db),saved);
});

test('annual and seat verified inboxes reject event/transaction identities in both product directions',async t=>{
 const f=await fixture(t),annual=await load('billing-store.mjs');const annualOrder=()=>annual.createAnnualOrder(f.db,{teamId:'team-a',actorId:'admin',requestId:randomUUID(),merchantId:'synthetic-merchant',offer:{id:'annual',revision:1,product:'team-annual-renewal',amountMinor:1,currency:'CNY'}},{now:()=>AT});
 const a=annualOrder(),ar={...f.receipt(a),product:'team-annual-renewal',amountMinor:1};annual.recordVerifiedAnnualPayment(f.db,ar,{now:()=>AT});const seat=f.create(),before=rows(f.db);for(const patch of [{eventId:ar.eventId},{transactionId:ar.transactionId}])assert.throws(()=>f.record(f.receipt(seat,patch)),conflict);assert.deepEqual(rows(f.db),before);
 const sr=f.receipt(seat);f.record(sr);const b=annualOrder(),saved=rows(f.db);for(const patch of [{eventId:sr.eventId},{transactionId:sr.transactionId}])assert.throws(()=>annual.recordVerifiedAnnualPayment(f.db,{...f.receipt(b),product:'team-annual-renewal',amountMinor:1,...patch},{now:()=>AT}),e=>e.status===409);assert.deepEqual(rows(f.db),saved);
});

test('a preexisting matching grant cannot acquire a later inbox, and mismatched grants never become paid',async t=>{
 const f=await fixture(t),order=f.create();f.capacity.recordSeatCapacityGrant(f.db,{grantId:order.id,teamId:'team-a',seats:order.quantity,startsAt:AT,endsAt:order.termEndsAt,sourceRef:'simulation-seat:'+order.id},{now:()=>AT});const before=rows(f.db);assert.throws(()=>f.record(f.receipt(order)),conflict);assert.throws(()=>f.store.readSeatOrder(f.db,'team-a',order.id),conflict);assert.deepEqual(rows(f.db),before);
 const g=await fixture(t),other=g.create();g.record(g.receipt(other));g.capacity.recordSeatCapacityGrant(g.db,{grantId:other.id,teamId:'team-a',seats:other.quantity+1,startsAt:AT,endsAt:other.termEndsAt,sourceRef:'simulation-seat:'+other.id},{now:()=>AT});const saved=rows(g.db);assert.throws(()=>g.fulfil(other.id),conflict);assert.deepEqual(rows(g.db),saved);
});

test('term extension is compatible without extending the grant; loss of locked coverage preserves only the inbox',async t=>{
 const f=await fixture(t),order=f.create();f.clock.value=AT+10;f.record(f.receipt(order));f.setTerm({endsAt:order.termEndsAt+YEAR});assert.equal(f.fulfil(order.id).grant.endsAt,order.termEndsAt);
 const g=await fixture(t),short=g.create();g.clock.value=AT+10;g.record(g.receipt(short));g.setTerm({endsAt:short.termEndsAt-1});const before=rows(g.db);assert.throws(()=>g.fulfil(short.id),reconcile);assert.deepEqual(rows(g.db),before);assert.equal(g.store.readSeatOrder(g.db,'team-a',short.id).status,'payment-verified');
});

test('grant SQL faults, real post-insert expiry and purchased-seat overflow roll back only fulfilment and retain the inbox',async t=>{
 for(const phase of ['sql-fault','after-insert-expiry','capacity-overflow']){
  const f=await fixture(t),order=f.create();f.clock.value=AT+10;f.record(f.receipt(order));let reached=0;
  if(phase==='sql-fault')f.db.exec("CREATE TRIGGER synthetic_grant_fault BEFORE INSERT ON team_seat_capacity_grants BEGIN SELECT RAISE(ABORT,'synthetic-grant-fault');END");
  if(phase==='after-insert-expiry'){f.db.function('synthetic_end',()=>{reached++;f.clock.value=order.termEndsAt;return 1;});f.db.exec('CREATE TRIGGER synthetic_grant_end AFTER INSERT ON team_seat_capacity_grants BEGIN SELECT synthetic_end();END');}
  if(phase==='capacity-overflow')f.capacity.recordSeatCapacityGrant(f.db,{grantId:randomUUID(),teamId:'team-a',seats:MAX,startsAt:AT,endsAt:order.termEndsAt,sourceRef:'synthetic-existing-capacity'},{now:()=>AT});
  const before=rows(f.db);assert.throws(()=>f.fulfil(order.id),phase==='after-insert-expiry'?reconcile:phase==='capacity-overflow'?fault(409,'SEAT_CAPACITY_CONFLICT'):conflict);if(phase==='after-insert-expiry')assert.equal(reached,1);assert.deepEqual(rows(f.db),before);assert.equal(f.store.readSeatOrder(f.db,'team-a',order.id).status,'payment-verified');
 }
});

test('capacity caller-owned primitive preserves standalone wrapper ownership and atomic outer rollback',async t=>{
 const f=await fixture(t),value={grantId:randomUUID(),teamId:'team-a',seats:2,startsAt:AT,endsAt:AT+1000,sourceRef:'synthetic-caller-capacity'};assert.throws(()=>f.capacity.recordSeatCapacityGrantWithinTransaction(f.db,value,{now:()=>AT}),fault(409,'SEAT_CAPACITY_CONFLICT'));
 f.db.exec('BEGIN IMMEDIATE');const receipt=f.capacity.recordSeatCapacityGrantWithinTransaction(f.db,value,{now:()=>AT});assert.equal(receipt.seats,2);assert.throws(()=>f.capacity.recordSeatCapacityGrant(f.db,{...value,grantId:randomUUID()},{now:()=>AT}),fault(409,'SEAT_CAPACITY_CONFLICT'));assert.equal(f.db.isTransaction,true);f.db.exec('ROLLBACK');assert.equal(f.capacity.readSeatCapacity(f.db,'team-a',AT).purchasedSeats,0);assert.equal(f.capacity.recordSeatCapacityGrant(f.db,value,{now:()=>AT}).grantId,value.grantId);
});

test('locked amount is independently recomputed and an unchanged request digest cannot hide a modified charge',async t=>{
 const f=await fixture(t),order=f.create();f.db.exec('DROP TRIGGER seat_orders_no_update');f.db.prepare('UPDATE team_seat_orders SET amount_minor=amount_minor+1 WHERE order_id=?').run(order.id);assert.throws(()=>f.store.readSeatOrder(f.db,'team-a',order.id),conflict);assert.throws(()=>f.record(f.receipt(order)),conflict);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_seat_verified_payments').get().n,0);
});

test('verified pending recovery and immutable grant replay survive actual SQLite close/reopen',async t=>{
 const parent=path.resolve(process.env.SHENYI_TEST_TMPDIR??require('node:os').tmpdir());fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'seat-order-')),filename=path.join(directory,'owned.sqlite');let db;const {initializeTeamDatabase}=await load('database.mjs'),store=await load('seat-order-store.mjs'),subscription=await load('subscription-store.mjs'),transaction=(await load('http-utils.mjs')).transaction;
 t.after(()=>{if(db?.isOpen)db.close();assert.ok(path.resolve(directory).startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 db=new DatabaseSync(filename);initializeTeamDatabase(db);db.exec("INSERT INTO teams VALUES ('team-a','active');INSERT INTO team_users VALUES ('admin','active')");subscription.recordSubscriptionTerm(db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:0,startsAt:AT-1,endsAt:AT+YEAR,sourceRef:'synthetic-disk-term'},{now:()=>AT});const value={teamId:'team-a',actorId:'admin',requestId:randomUUID(),merchantId:'synthetic-merchant',offer:{id:'disk-seats',revision:1,annualUnitAmountMinor:365,currency:'CNY'},quantity:2},order=transaction(db,()=>store.createSeatOrderWithinTransaction(db,value,{now:()=>AT})),receipt={protocol:'shenyi-simulation-payment-v1',merchantId:order.merchantId,eventId:randomUUID(),transactionId:randomUUID(),orderId:order.id,product:'team-seat-addition',amountMinor:order.offer.amountMinor,currency:'CNY',status:'succeeded',paidAt:AT},payment=store.recordVerifiedSeatPayment(db,receipt,{now:()=>AT+10});
 db.close();db=new DatabaseSync(filename);initializeTeamDatabase(db);assert.deepEqual(store.recordVerifiedSeatPayment(db,receipt,{now:()=>AT+100}),payment);const result=store.fulfilSeatOrder(db,order.id,{now:()=>AT+100}),saved=rows(db);db.close();db=new DatabaseSync(filename);initializeTeamDatabase(db);assert.deepEqual(store.fulfilSeatOrder(db,order.id,{now:()=>AT+YEAR+1}),result);assert.deepEqual(rows(db),saved);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
