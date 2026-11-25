'use strict';
// Synthetic strict application requests and actual file-backed SQLite only.
// Gateway HMACs are constructed here; recovery must not call that gateway.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createHmac,randomBytes,randomUUID}=require('node:crypto');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createBusinessRoleFixture,source}=require('./helpers/business-role-fixture.cjs');
const ROOT='/api/teams/team-a/billing',CAPTURE='/api/billing/simulation/notifications';
const EXCEPTION='/api/billing/simulation/payment-exceptions',CLOSURE='/api/billing/simulation/order-closures';
const ANNUAL={id:'recovery-annual',revision:1,product:'team-annual-renewal',amountMinor:9000,currency:'CNY'};
const SEAT={id:'recovery-seat',revision:1,annualUnitAmountMinor:36500,currency:'CNY'};
const DAY=86400000;
const base=kind=>ROOT+'/'+(kind==='annual'?'orders':'seat-orders');
const route=(kind,id)=>base(kind)+'/'+id+'/resume-fulfilment';
const quote=name=>'"'+name.replaceAll('"','""')+'"';

async function fixture(t,{seatTerm=false,lookup='throw',closeAfterMs,actors=[]}={}){
 const f=await createBusinessRoleFixture(t),actor=await f.ready('administrator-demo');
 const otherActors={};for(const user of actors)otherActors[user]=await f.ready(user);
 const temporaryRoot=path.resolve(os.tmpdir()),directory=await fs.mkdtemp(path.join(temporaryRoot,'shenyi-payment-recovery-'));
 const filename=path.join(directory,'synthetic.sqlite');
 f.db.prepare('VACUUM INTO ?').run(filename);
 let db=new DatabaseSync(filename),open=true,lookupCalls=0;
 t.after(async()=>{if(open)db.close();assert.equal(path.dirname(directory),temporaryRoot);await fs.rm(directory,{recursive:true,force:true});});
 const {handleTeamApplicationRequest}=await source('application-api.mjs'),now=()=>f.clock.value;
 const configuration={mode:'simulation-v1',merchantId:'synthetic-recovery',signingKey:randomBytes(32),offers:[ANNUAL],seatOffer:SEAT,paymentExceptions:true,
  ...(closeAfterMs===undefined?{}:{timeoutClosure:{annualTimeoutMs:closeAfterMs}}),
  ...(lookup==='absent'?{}:{lookupPayment:async()=>{lookupCalls++;throw Error('Synthetic gateway is unreachable');}})};
 const options={now,identityProviders:{deviceProofRequired:true},subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1',billingSimulation:configuration};
 if(seatTerm)(await source('subscription-store.mjs')).recordSubscriptionTerm(db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:0,startsAt:now()-1000,endsAt:now()+30*DAY,sourceRef:'synthetic-recovery-base'},{now});
 async function api(target,settings={},overrides={}){
  const response=await handleTeamApplicationRequest(settings.raw??f.makeRequest(target,{session:actor,...settings}),{...options,db,...overrides});
  const bytes=await response.text();return{status:response.status,body:bytes?JSON.parse(bytes):null};
 }
 async function create(kind){const offer=kind==='annual'?ANNUAL:SEAT;
  const result=await api(base(kind),{method:'POST',body:{requestId:randomUUID(),offerId:offer.id,offerRevision:offer.revision,...(kind==='seat'?{quantity:2}:{})}});
  assert.equal(result.status,201,JSON.stringify(result));return result.body.order;
 }
 function receipt(order,extra={}){return{protocol:'shenyi-simulation-payment-v1',merchantId:configuration.merchantId,eventId:randomUUID(),transactionId:randomUUID(),orderId:order.id,product:order.offer.product,amountMinor:order.offer.amountMinor,currency:'CNY',status:'succeeded',paidAt:now(),...extra};}
 function notice(target,value,key=configuration.signingKey){
  const bytes=Buffer.from(JSON.stringify(value)),domain=target===EXCEPTION?'shenyi.billing.simulation.exception.v1\0':target===CLOSURE?'shenyi.billing.simulation.closure.v1\0':'shenyi.billing.simulation.v1\0';
  const signature=createHmac('sha256',key).update(domain).update(bytes).digest('hex');
  return api(target,{raw:new Request('http://127.0.0.1:8774'+target,{method:'POST',body:bytes,headers:{'Content-Type':'application/json','X-Shenyi-Simulation-Signature':signature}})});
 }
 function rows(){
  const names=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND (name GLOB 'team_annual_*' OR name GLOB 'team_seat_*' OR name GLOB 'team_subscription_*' OR name GLOB 'team_billing_*') ORDER BY name").all().map(row=>row.name);
  return Object.fromEntries(names.map(name=>{const columns=db.prepare('PRAGMA table_info('+quote(name)+')').all().map(row=>quote(row.name));return[name,db.prepare('SELECT * FROM '+quote(name)+' ORDER BY '+columns.join(',')).all().map(row=>({...row}))];}));
 }
 function reopen(){db.close();open=false;db=new DatabaseSync(filename);open=true;}
 function fault(kind){const table=kind==='annual'?'team_annual_fulfilments':'team_seat_capacity_grants';db.exec('CREATE TRIGGER synthetic_recovery_failure BEFORE INSERT ON '+table+" BEGIN SELECT RAISE(ABORT,'synthetic-last-publication');END");}
 function removeFault(){db.exec('DROP TRIGGER synthetic_recovery_failure');}
 const savedPayment=kind=>db.prepare('SELECT * FROM '+(kind==='annual'?'team_annual_verified_payments':'team_seat_verified_payments')+' ORDER BY payment_id').all().map(row=>({...row}));
 const resume=(kind,id,settings={})=>api(route(kind,id),{method:'POST',body:{},...settings});
 return{...f,actor,otherActors,configuration,options,filename,api,create,receipt,notice,rows,reopen,fault,removeFault,savedPayment,resume,get persistent(){return db;},get lookupCalls(){return lookupCalls;}};
}

for(const kind of ['annual','seat'])test(kind+' resumes its recorded payment after a real publication rollback and SQLite close/reopen without any gateway call',async t=>{
 const f=await fixture(t,{seatTerm:kind==='seat',lookup:kind==='annual'?'throw':'absent'}),order=await f.create(kind);
 f.clock.value+=123;const payment=f.receipt(order),confirmedAt=f.clock.value;
 const unpaid=f.rows();f.fault(kind);
 const callback=await f.notice(CAPTURE,payment);assert.equal(callback.status,409,JSON.stringify(callback));
 const saved=f.savedPayment(kind);assert.equal(saved.length,1);assert.equal(saved[0].confirmed_at,confirmedAt);
 const failed=f.rows();
 for(const table of ['team_subscription_events','team_subscription_heads','team_seat_capacity_grants','team_annual_fulfilments'])assert.deepEqual(failed[table],unpaid[table]);
 assert.equal((await f.api(base(kind)+'/'+order.id)).body.order.status,'payment-verified');
 f.removeFault();f.reopen();assert.deepEqual(f.savedPayment(kind),saved);
 f.clock.value+=5000;
 const resumed=await f.resume(kind,order.id);assert.equal(resumed.status,200,JSON.stringify(resumed));assert.equal(resumed.body.simulation,true);assert.equal(resumed.body.order.status,'paid');assert.equal(resumed.body.order.confirmedAt,confirmedAt);assert.equal(f.lookupCalls,0);
 assert.deepEqual(f.savedPayment(kind),saved);
 if(kind==='annual'){
  assert.equal(resumed.body.order.fulfilment.startsAt,confirmedAt);
  assert.equal(resumed.body.order.fulfilment.endsAt,Date.parse('2027-11-15T16:00:00.123Z'));
  assert.equal(f.persistent.prepare("SELECT COUNT(*) n FROM team_subscription_events WHERE team_id='team-a'").get().n,1);
 }else{
  assert.equal(resumed.body.order.grant.startsAt,confirmedAt);assert.equal(resumed.body.order.grant.endsAt,order.termEndsAt);assert.equal(resumed.body.order.grant.seats,2);
  assert.equal(f.persistent.prepare('SELECT event.ends_at FROM team_subscription_heads head JOIN team_subscription_events event ON event.team_id=head.team_id AND event.revision=head.revision WHERE head.team_id=?').get('team-a').ends_at,order.termEndsAt);
 }
 const paid=f.rows();f.reopen();
 assert.deepEqual(await f.resume(kind,order.id),resumed);assert.deepEqual(f.rows(),paid);assert.deepEqual(f.savedPayment(kind),saved);assert.equal(f.lookupCalls,0);
 assert.deepEqual(f.persistent.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(f.persistent.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('unverified orders and forged or wrong-amount notices cannot obtain rights through payment recovery',async t=>{
 const f=await fixture(t,{seatTerm:true});
 for(const kind of ['annual','seat']){
  const order=await f.create(kind),before=f.rows();
  assert.equal((await f.notice(CAPTURE,f.receipt(order),randomBytes(32))).status,403);
  assert.equal((await f.notice(CAPTURE,f.receipt(order,{amountMinor:order.offer.amountMinor+1}))).status,409);
  const result=await f.resume(kind,order.id);assert.equal(result.status,409);assert.equal(result.body.error.code,kind==='annual'?'BILLING_CONFLICT':'SEAT_ORDER_CONFLICT');
  assert.deepEqual(f.rows(),before);assert.equal(f.savedPayment(kind).length,0);
 }
 assert.equal(f.lookupCalls,0);
});

for(const [kind,adverse]of [['annual','refund'],['seat','chargeback']])test(kind+' recorded payment with '+adverse+' remains pending review without publishing rights',async t=>{
 const f=await fixture(t,{seatTerm:kind==='seat'}),order=await f.create(kind);f.clock.value++;
 const payment=f.receipt(order);f.fault(kind);assert.equal((await f.notice(CAPTURE,payment)).status,409);f.removeFault();
 const exception={protocol:'shenyi-simulation-payment-exception-v1',merchantId:payment.merchantId,eventId:randomUUID(),originalTransactionId:payment.transactionId,orderId:payment.orderId,product:payment.product,amountMinor:payment.amountMinor,currency:'CNY',kind:adverse,occurredAt:++f.clock.value};
 assert.equal((await f.notice(EXCEPTION,exception)).status,200);const before=f.rows(),saved=f.savedPayment(kind);f.reopen();
 const result=await f.resume(kind,order.id);assert.equal(result.status,409);assert.equal(result.body.error.code,'BILLING_PAYMENT_EXCEPTION_REVIEW_REQUIRED');assert.deepEqual(f.rows(),before);assert.deepEqual(f.savedPayment(kind),saved);assert.equal(f.lookupCalls,0);
});

test('a closed annual order retains its late verified capture but payment recovery cannot fulfil it',async t=>{
 const f=await fixture(t,{closeAfterMs:1000}),order=await f.create('annual');f.clock.value+=1000;
 const closed={protocol:'shenyi-simulation-order-closure-v1',merchantId:f.configuration.merchantId,eventId:randomUUID(),orderId:order.id,product:ANNUAL.product,amountMinor:order.offer.amountMinor,currency:'CNY',status:'closed',closedAt:f.clock.value};
 assert.equal((await f.notice(CLOSURE,closed)).status,200);f.clock.value++;
 assert.equal((await f.notice(CAPTURE,f.receipt(order))).status,200);
 const before=f.rows();f.reopen();const result=await f.resume('annual',order.id);
 assert.equal(result.status,409);assert.equal(result.body.error.code,'BILLING_ORDER_CLOSED_REVIEW_REQUIRED');assert.deepEqual(f.rows(),before);assert.equal(f.lookupCalls,0);
});

test('recovery has exact own-team device authorization and opt-in overview discovery while managed billing stays off',async t=>{
 const f=await fixture(t,{actors:['intern-a']}),order=await f.create('annual'),target=route('annual',order.id),before=f.rows();
 for(const headers of [{},{'X-Shenyi-Billing-Recovery':'wrong-version'}])assert.equal(Object.hasOwn((await f.api(ROOT+'/overview',{headers})).body,'canResumeFulfilment'),false);
 const advertised=await f.api(ROOT+'/overview',{headers:{'X-Shenyi-Billing-Recovery':'recorded-payment-v1'}});assert.equal(advertised.status,200);assert.equal(advertised.body.canResumeFulfilment,true);assert.equal(advertised.body.canReconcile,true);
 assert.equal((await f.resume('annual',order.id,{session:{token:f.actor.token}})).status,403);
 assert.ok([403,404].includes((await f.resume('annual',order.id,{session:f.otherActors['intern-a']})).status));
 assert.equal((await f.api(target.replace('/team-a/','/team-b/'),{method:'POST',body:{}})).status,404);
 assert.equal((await f.api(route('seat',order.id),{method:'POST',body:{}})).status,404);
 assert.equal((await f.api(target,{method:'GET'})).status,405);
 for(const body of [{amountMinor:1},{confirmedAt:f.clock.value},{receipt:{}},{success:true}])assert.equal((await f.resume('annual',order.id,{body})).status,400);
 const managed=await f.api(target,{method:'POST',body:{}},{serviceMode:'managed-service',billingSimulation:null});assert.equal(managed.status,503);
 assert.deepEqual(f.rows(),before);assert.equal(f.lookupCalls,0);
});

for(const kind of ['annual','seat'])test(kind+' final publication revocation rolls back both entitlement and the injected authority change',async t=>{
 const f=await fixture(t,{seatTerm:kind==='seat'}),order=await f.create(kind);f.clock.value++;
 f.fault(kind);assert.equal((await f.notice(CAPTURE,f.receipt(order))).status,409);f.removeFault();const before=f.rows();
 const table=kind==='annual'?'team_annual_fulfilments':'team_seat_capacity_grants';
 f.persistent.exec('CREATE TRIGGER synthetic_recovery_revoke AFTER INSERT ON '+table+" BEGIN UPDATE team_operators SET status='revoked' WHERE user_id='administrator-demo'; END");
 const denied=await f.resume(kind,order.id);assert.equal(denied.status,409);assert.equal(denied.body.error.code,'DEVICE_STATE_CHANGED');assert.deepEqual(f.rows(),before);
 assert.equal(f.persistent.prepare("SELECT status FROM team_operators WHERE user_id='administrator-demo'").get().status,'active');
 f.persistent.exec('DROP TRIGGER synthetic_recovery_revoke');assert.equal((await f.resume(kind,order.id)).body.order.status,'paid');assert.equal(f.lookupCalls,0);
});
