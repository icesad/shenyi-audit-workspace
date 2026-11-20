'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{randomUUID,createHash}=require('node:crypto'),path=require('node:path'),{pathToFileURL}=require('node:url'),fs=require('node:fs');
const load=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href),AT=Date.parse('2028-02-29T04:34:56.789Z'),END=AT+20000,MAX=Number.MAX_SAFE_INTEGER;
const conflict=e=>e?.status===409&&e.code==='BILLING_CONFLICT',hold=e=>e?.status===409&&e.code==='BILLING_RENEWAL_SEATS_RECONCILIATION_REQUIRED',invalid=e=>e?.status===400&&e.code==='INVALID_INPUT',sha=v=>createHash('sha256').update(v).digest('hex');
const TABLES=['team_annual_orders','team_annual_order_seat_plans','team_annual_verified_payments','team_annual_fulfilments','team_seat_capacity_grants','team_subscription_events','team_subscription_heads'];
function rows(db){return TABLES.map(name=>{const q=db.prepare('SELECT * FROM '+name+' ORDER BY rowid');q.setReadBigInts(true);return{name,rows:q.all()};});}
function member(db,id,role='intern'){db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);db.prepare("INSERT INTO team_memberships VALUES ('team-a',?,?,'active')").run(id,role);}
async function fixture(t,{term=true,expired=false,seats=5}={}){
 const {initializeTeamDatabase}=await load('database.mjs'),db=new DatabaseSync(':memory:');initializeTeamDatabase(db);db.exec("INSERT INTO teams VALUES ('team-a','active');INSERT INTO team_users VALUES ('admin','active')");t.after(()=>db.close());const store=await load('billing-store.mjs'),subscription=await load('subscription-store.mjs'),capacity=await load('seat-capacity-store.mjs'),clock={value:AT},endsAt=expired?AT-1:END,startsAt=AT-30000;
 if(term)subscription.recordSubscriptionTerm(db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:0,startsAt,endsAt,sourceRef:'synthetic-prior-term'},{now:()=>AT-30000});
 if(term&&seats)capacity.recordSeatCapacityGrant(db,{grantId:randomUUID(),teamId:'team-a',seats,startsAt,endsAt,sourceRef:'synthetic-prior-paid-seats'},{now:()=>AT-30000});
 const input=(extra={})=>({teamId:'team-a',actorId:'admin',requestId:randomUUID(),merchantId:'synthetic-merchant',offer:{id:'annual-base',revision:1,product:'team-annual-renewal',amountMinor:100,currency:'CNY'},...extra});
 const create=(value=input(),selection={unitAmountMinor:10})=>store.createAnnualOrder(db,value,{now:()=>clock.value,...(selection===null?{}:{renewalSeats:selection})});
 const receipt=(order,extra={})=>({protocol:'shenyi-simulation-payment-v1',merchantId:order.merchantId,eventId:randomUUID(),transactionId:randomUUID(),orderId:order.id,product:'team-annual-renewal',amountMinor:order.offer.amountMinor,currency:'CNY',status:'succeeded',paidAt:AT,...extra});
 const record=value=>store.recordVerifiedAnnualPayment(db,value,{now:()=>clock.value}),fulfil=id=>store.fulfilAnnualOrder(db,id,{now:()=>clock.value});
 return{db,store,subscription,capacity,clock,endsAt,input,create,receipt,record,fulfil};
}

test('defaults sample paid seats at original end-1, exclude grants starting at end, and separately expose current commitments',async t=>{
 const f=await fixture(t);member(f.db,'manager-a','manager');f.capacity.recordSeatCapacityGrant(f.db,{grantId:randomUUID(),teamId:'team-a',seats:9,startsAt:END,endsAt:END+1000,sourceRef:'credible-future-grant'},{now:()=>AT});
 assert.deepEqual(f.store.readAnnualSeatRenewalDefaults(f.db,'team-a',AT),{defaultSeats:5,basisRevision:1,basisEndsAt:END,committedSeats:1});f.db.exec('BEGIN');assert.equal(f.store.readAnnualSeatRenewalDefaults(f.db,'team-a',AT).defaultSeats,5);assert.equal(f.db.isTransaction,true);f.db.exec('ROLLBACK');
 const expired=await fixture(t,{expired:true});assert.equal(expired.store.readAnnualSeatRenewalDefaults(expired.db,'team-a',AT).defaultSeats,5);const fresh=await fixture(t,{term:false});assert.deepEqual(fresh.store.readAnnualSeatRenewalDefaults(fresh.db,'team-a',AT),{defaultSeats:0,basisRevision:0,basisEndsAt:null,committedSeats:0});
});

test('quote locks base plus selected seat price, and below-committed selection must first release seats without auto-increasing default',async t=>{
 const f=await fixture(t);member(f.db,'a');member(f.db,'b');const before=rows(f.db);assert.throws(()=>f.create(f.input(),{unitAmountMinor:10,selectedSeats:1}),hold);assert.deepEqual(rows(f.db),before);const order=f.create();assert.equal(order.offer.amountMinor,150);assert.deepEqual(order.renewalSeats,{defaultSeats:5,selectedSeats:5,baseAmountMinor:100,unitAmountMinor:10,basisRevision:1,basisEndsAt:END});assert.equal(order.renewalSeatGrant,null);assert.equal(Object.isFrozen(order.renewalSeats),true);
 const g=await fixture(t,{seats:1});member(g.db,'a');member(g.db,'b');assert.deepEqual(g.store.readAnnualSeatRenewalDefaults(g.db,'team-a',AT),{defaultSeats:1,basisRevision:1,basisEndsAt:END,committedSeats:2});assert.throws(()=>g.create(),hold);assert.equal(g.db.prepare('SELECT COUNT(*) n FROM team_annual_orders').get().n,0);
});

test('first-time and expired renewal use the actual confirmation window; zero selected seats issue no capacity row',async t=>{
 const fresh=await fixture(t,{term:false}),zero=fresh.create();fresh.clock.value++;fresh.record(fresh.receipt(zero));const a=fresh.fulfil(zero.id);assert.equal(a.order.renewalSeats.selectedSeats,0);assert.equal(a.order.renewalSeatGrant,null);assert.equal(a.subscription.startsAt,AT+1);assert.equal(fresh.db.prepare('SELECT COUNT(*) n FROM team_seat_capacity_grants').get().n,0);
 const expired=await fixture(t,{expired:true}),order=expired.create();expired.clock.value++;const payment=expired.record(expired.receipt(order)),b=expired.fulfil(order.id);assert.equal(b.order.renewalSeatGrant.startsAt,payment.confirmedAt);assert.equal(b.order.renewalSeatGrant.endsAt,b.subscription.endsAt);assert.equal(b.order.renewalSeatGrant.seats,5);
});

test('early renewal grants begin only at the actual renewal boundary and never immediately add duplicate current seats',async t=>{
 const f=await fixture(t),order=f.create();f.clock.value++;f.record(f.receipt(order));const done=f.fulfil(order.id),grant=done.order.renewalSeatGrant;assert.deepEqual(grant,{grantId:order.id,seats:5,startsAt:END,endsAt:done.subscription.endsAt,recordedAt:AT+1});assert.equal(f.capacity.readSeatCapacity(f.db,'team-a',AT+1).purchasedSeats,5);assert.equal(f.capacity.readSeatCapacity(f.db,'team-a',END).purchasedSeats,5);assert.equal(f.capacity.readSeatCapacity(f.db,'team-a',grant.endsAt).purchasedSeats,0);
 const prior=rows(f.db);f.clock.value=grant.endsAt+1;assert.deepEqual(f.fulfil(order.id),done);assert.deepEqual(rows(f.db),prior);
});

test('multiple verified renewals retain chronological order and grant exactly their separately purchased actual periods',async t=>{
 const f=await fixture(t),a=f.create(),b=f.create();f.clock.value++;f.record(f.receipt(a));f.clock.value++;f.record(f.receipt(b));assert.throws(()=>f.fulfil(b.id),conflict);const first=f.fulfil(a.id),second=f.fulfil(b.id);assert.equal(second.order.renewalSeatGrant.startsAt,first.subscription.endsAt);assert.equal(second.order.renewalSeats.basisRevision,1);assert.equal(second.subscription.revision,3);assert.equal(f.capacity.readSeatCapacity(f.db,'team-a',second.order.renewalSeatGrant.startsAt).purchasedSeats,5);
});

test('locked replay uses locked default/selection instead of new capacity, rejects converting legacy requests and leaves legacy views unchanged',async t=>{
 const f=await fixture(t),value=f.input(),order=f.create(value);f.capacity.recordSeatCapacityGrant(f.db,{grantId:randomUUID(),teamId:'team-a',seats:2,startsAt:AT,endsAt:END,sourceRef:'later-synthetic-purchase'},{now:()=>AT});assert.equal(f.store.readAnnualSeatRenewalDefaults(f.db,'team-a',AT).defaultSeats,7);assert.deepEqual(f.create(value),order);
 const custom=f.input(),chosen=f.create(custom,{unitAmountMinor:10,selectedSeats:3});assert.throws(()=>f.create(custom),conflict);assert.deepEqual(f.create(custom,{unitAmountMinor:10,selectedSeats:3}),chosen);
 const legacyInput=f.input(),legacy=f.create(legacyInput,null);assert.equal(Object.hasOwn(legacy,'renewalSeats'),false);assert.equal(Object.hasOwn(legacy,'renewalSeatGrant'),false);const saved=rows(f.db);assert.throws(()=>f.create(legacyInput,{unitAmountMinor:10,selectedSeats:0}),conflict);assert.deepEqual(f.create(legacyInput,null),legacy);assert.deepEqual(rows(f.db),saved);
});

test('commitment growth after payment holds all fulfilment; explicit reservation release permits the identical receipt retry',async t=>{
 const f=await fixture(t);member(f.db,'manager-a','manager');member(f.db,'intern-a');const order=f.create(f.input(),{unitAmountMinor:10,selectedSeats:2});const id=randomUUID();f.db.prepare('INSERT INTO team_employee_invitations VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL)').run(id,sha(id),'team-a','+8613800000000','intern','manager-a',AT,END+100000);f.clock.value++;const receipt=f.receipt(order),payment=f.record(receipt),before=rows(f.db);assert.throws(()=>f.fulfil(order.id),hold);assert.deepEqual(rows(f.db),before);assert.equal(f.store.readAnnualOrder(f.db,'team-a',order.id).status,'payment-verified');
 f.db.prepare('UPDATE team_employee_invitations SET revoked_at=? WHERE invitation_id=?').run(f.clock.value,id);assert.deepEqual(f.record(receipt),payment);const done=f.fulfil(order.id);assert.equal(done.order.renewalSeatGrant.seats,2);assert.equal(done.order.renewalSeatGrant.startsAt,END);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM team_memberships WHERE status='active'").get().n,2);
});

test('credible future grants block overlapping paid plans including selected zero, without rewriting the retired plan or granting a future substitute',async t=>{
 for(const selectedSeats of [0,5]){const f=await fixture(t),order=f.create(f.input(),{unitAmountMinor:10,selectedSeats});f.capacity.recordSeatCapacityGrant(f.db,{grantId:randomUUID(),teamId:'team-a',seats:2,startsAt:END,endsAt:END+100000,sourceRef:'credible-future-capacity'},{now:()=>AT});f.clock.value++;f.record(f.receipt(order));const before=rows(f.db);assert.throws(()=>f.fulfil(order.id),hold);assert.deepEqual(rows(f.db),before);assert.deepEqual(f.store.readAnnualOrder(f.db,'team-a',order.id).renewalSeats,order.renewalSeats);assert.throws(()=>f.db.exec('UPDATE team_annual_order_seat_plans SET selected_seats=selected_seats'),/ANNUAL_SEAT_PLAN_IMMUTABLE/);assert.deepEqual(rows(f.db),before);}
});

test('sidecar quote failure and final fulfil/grant faults atomically preserve the original verified inbox and old entitlements',async t=>{
 const f=await fixture(t),value=f.input(),before=rows(f.db);f.db.exec("CREATE TRIGGER synthetic_plan_failure BEFORE INSERT ON team_annual_order_seat_plans BEGIN SELECT RAISE(ABORT,'synthetic-plan-failure');END");assert.throws(()=>f.create(value),conflict);assert.deepEqual(rows(f.db),before);f.db.exec('DROP TRIGGER synthetic_plan_failure');assert.equal(f.create(value).status,'pending');
 for(const table of ['team_annual_fulfilments','team_seat_capacity_grants']){const g=await fixture(t),order=g.create();g.clock.value++;g.record(g.receipt(order));const saved=rows(g.db);g.db.exec('CREATE TRIGGER synthetic_last_failure BEFORE INSERT ON '+table+" BEGIN SELECT RAISE(ABORT,'synthetic-last-failure');END");assert.throws(()=>g.fulfil(order.id),conflict);assert.deepEqual(rows(g.db),saved);assert.equal(g.store.readAnnualOrder(g.db,'team-a',order.id).status,'payment-verified');}
});

test('missing sidecar cannot downgrade a planned order to legacy, and a paid plan missing its capacity fact fails closed',async t=>{
 const f=await fixture(t),order=f.create();f.db.exec('DROP TRIGGER annual_seat_plans_no_delete');f.db.prepare('DELETE FROM team_annual_order_seat_plans WHERE order_id=?').run(order.id);assert.throws(()=>f.store.readAnnualOrder(f.db,'team-a',order.id),conflict);assert.throws(()=>f.record(f.receipt(order)),conflict);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_annual_verified_payments').get().n,0);
 const g=await fixture(t),paid=g.create();g.clock.value++;g.record(g.receipt(paid));g.fulfil(paid.id);g.db.exec('DROP TRIGGER seat_capacity_grants_no_delete');g.db.prepare('DELETE FROM team_seat_capacity_grants WHERE grant_id=?').run(paid.id);const before=rows(g.db);assert.throws(()=>g.store.readAnnualOrder(g.db,'team-a',paid.id),conflict);assert.throws(()=>g.fulfil(paid.id),conflict);assert.deepEqual(rows(g.db),before);
});

test('safe total overflow and passive option violations leave no order and never execute getters',async t=>{
 const f=await fixture(t,{seats:MAX});assert.throws(()=>f.create(),conflict);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_annual_orders').get().n,0);let called=0;const getter={unitAmountMinor:10};Object.defineProperty(getter,'selectedSeats',{enumerable:true,get(){called++;return 0;}});const proxy=new Proxy({unitAmountMinor:10},{getPrototypeOf(){called++;return Object.prototype;}});
 for(const option of [getter,proxy,{unitAmountMinor:0},{unitAmountMinor:10,selectedSeats:-1},{unitAmountMinor:10,selectedSeats:0.5},{unitAmountMinor:10,extra:true}])assert.throws(()=>f.create(f.input(),option),invalid);assert.equal(called,0);
});

test('verified recovery and historical renewal seat grant survive actual close/reopen with exact plan and receipt preservation',async t=>{
 const parent=path.resolve(process.env.SHENYI_TEST_TMPDIR??require('node:os').tmpdir());fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'annual-seat-')),filename=path.join(directory,'owned.sqlite');let db;const {initializeTeamDatabase}=await load('database.mjs'),store=await load('billing-store.mjs'),subscription=await load('subscription-store.mjs'),capacity=await load('seat-capacity-store.mjs');t.after(()=>{if(db?.isOpen)db.close();assert.ok(path.resolve(directory).startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 db=new DatabaseSync(filename);initializeTeamDatabase(db);db.exec("INSERT INTO teams VALUES ('team-a','active');INSERT INTO team_users VALUES ('admin','active')");subscription.recordSubscriptionTerm(db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:0,startsAt:AT-1,endsAt:END,sourceRef:'synthetic-disk-term'},{now:()=>AT});capacity.recordSeatCapacityGrant(db,{grantId:randomUUID(),teamId:'team-a',seats:5,startsAt:AT-1,endsAt:END,sourceRef:'synthetic-disk-seats'},{now:()=>AT});const input={teamId:'team-a',actorId:'admin',requestId:randomUUID(),merchantId:'synthetic-merchant',offer:{id:'annual',revision:1,product:'team-annual-renewal',amountMinor:100,currency:'CNY'}},order=store.createAnnualOrder(db,input,{now:()=>AT,renewalSeats:{unitAmountMinor:10,selectedSeats:3}}),receipt={protocol:'shenyi-simulation-payment-v1',merchantId:order.merchantId,eventId:randomUUID(),transactionId:randomUUID(),orderId:order.id,product:'team-annual-renewal',amountMinor:130,currency:'CNY',status:'succeeded',paidAt:AT},payment=store.recordVerifiedAnnualPayment(db,receipt,{now:()=>AT+1});
 db.close();db=new DatabaseSync(filename);initializeTeamDatabase(db);assert.deepEqual(store.recordVerifiedAnnualPayment(db,receipt,{now:()=>AT+100}),payment);const done=store.fulfilAnnualOrder(db,order.id,{now:()=>AT+100}),saved=rows(db);db.close();db=new DatabaseSync(filename);initializeTeamDatabase(db);assert.deepEqual(store.fulfilAnnualOrder(db,order.id,{now:()=>done.subscription.endsAt+1}),done);assert.deepEqual(rows(db),saved);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
