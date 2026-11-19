'use strict';
// Actual signed application/device boundary and immutable stores. Requests stay
// in-process; this is not browser UI, TCP/TLS or production checkout acceptance.
const test=require('node:test'),assert=require('node:assert/strict');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {createBusinessRoleFixture,PASSWORD,source}=require('./helpers/business-role-fixture.cjs');
const SITE='https://127.0.0.1:14443',ROOT='/api/teams/team-a/billing',WEB='/api/website-checkout';
const OFFER={id:'synthetic-website-year',revision:7,product:'team-annual-renewal',amountMinor:12345,currency:'CNY'};
const UNIT=2500,SEATS=8,DAY=86400000;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const isError=(result,status,code)=>{assert.equal(result.status,status,JSON.stringify(result.data));assert.equal(result.data.error.code,code);};

async function fixture(t){
 const f=await createBusinessRoleFixture(t),admin=await f.ready('administrator-demo');
 const {createWebsiteCheckoutCandidate,initializeWebsiteCheckoutStore}=await source('website-checkout.mjs');
 const {handleTeamApplicationRequest}=await source('application-api.mjs');
 const subscription=await source('subscription-store.mjs'),capacity=await source('seat-capacity-store.mjs');
 const at=f.clock.value,endsAt=at+365*DAY;
 subscription.recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:0,startsAt:at-1000,endsAt,sourceRef:'synthetic-website-prior-term'},{now:()=>at});
 capacity.recordSeatCapacityGrant(f.db,{teamId:'team-a',grantId:randomUUID(),seats:SEATS,startsAt:at-1000,endsAt,sourceRef:'synthetic-website-prior-capacity'},{now:()=>at});
 f.db.prepare("INSERT INTO team_database_metadata(name,value) VALUES ('website-checkout-demo','true')").run();
 initializeWebsiteCheckoutStore(f.db);
 const billingSimulation={mode:'simulation-v1',merchantId:'synthetic-website-merchant',signingKey:randomBytes(32),offers:[{...OFFER}],annualSeatUnitAmountMinor:UNIT};
 const websiteCheckout=createWebsiteCheckoutCandidate({origin:SITE});
 const restart=(origin=SITE)=>({origin,urlOrigin:origin,options:{websiteCheckout:createWebsiteCheckoutCandidate({origin})}});
 const options={db:f.db,now:()=>f.clock.value,serviceMode:'local-preview',identityProviders:{deviceProofRequired:true},subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1',billingSimulation,websiteCheckout};
 const dispatch=async(request,overrides={})=>{const response=await handleTeamApplicationRequest(request,{...options,...overrides});return {status:response.status,data:await response.json(),headers:response.headers};};
 const desktop=(route,body={},settings={})=>dispatch(f.makeRequest(route,{method:settings.method??'POST',session:settings.session??admin,body:settings.method==='GET'?undefined:body}),settings.options);
 const handoff=(settings={})=>desktop((settings.root??ROOT)+'/website-handoff',settings.body??{},settings);
 const browser=(suffix,body,settings={})=>{
  const headers={'Content-Type':'application/json',...(settings.origin===null?{}:{Origin:settings.origin??SITE}),...settings.headers};
  return dispatch(new Request((settings.urlOrigin??SITE)+WEB+suffix,{method:settings.method??'POST',headers,body:JSON.stringify(body)}),settings.options);
 };
 const context=(ticket,settings)=>browser('/context',{handoff:ticket.handoff},settings);
 const order=(ticket,change={},settings)=>browser('/orders',{handoff:ticket.handoff,offerId:OFFER.id,offerRevision:OFFER.revision,selectedSeats:SEATS,...change},settings);
 const financial=['team_annual_verified_payments','team_annual_fulfilments','team_seat_orders','team_seat_verified_payments','team_seat_order_grants','team_billing_payment_exceptions','team_billing_order_closures','team_subscription_events','team_subscription_heads','team_seat_capacity_grants','team_memberships','team_project_grants','team_admin_grants'];
 const names=new Set(f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
 const facts=()=>financial.filter(name=>names.has(name)).map(name=>{const rows=f.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all();return {name,count:rows.length,sha256:hash(JSON.stringify(rows))};});
 const orderRows=()=>['team_annual_orders','team_annual_order_seat_plans'].map(name=>({name,rows:f.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all().map(row=>({...row}))}));
 const ticket=async()=>{const result=await handoff();assert.equal(result.status,201,JSON.stringify(result.data));assert.deepEqual(Object.keys(result.data).sort(),['expiresAt','handoff']);assert.match(result.data.handoff,/^[A-Za-z0-9_-]+$/);assert.ok(result.data.expiresAt>f.clock.value&&result.data.expiresAt<=f.clock.value+120000);return result.data;};
 return {...f,admin,options,billingSimulation,websiteCheckout,restart,dispatch,desktop,handoff,browser,context,order,facts,orderRows,ticket,capacity};
}

function safeOrder(order,amountMinor,seats){
 assert.deepEqual(Object.keys(order).sort(),['amountMinor','createdAt','currency','id','seats','status']);
 assert.match(order.id,/^[a-f0-9-]{36}$/);assert.equal(order.amountMinor,amountMinor);assert.equal(order.seats,seats);
 assert.equal(order.status,'pending');assert.equal(order.currency,'CNY');assert.ok(Number.isSafeInteger(order.createdAt));
}
function noPrivateFields(value,admin){
 const serialized=JSON.stringify(value);assert.equal(serialized.includes(admin.token),false);assert.equal(serialized.includes(admin.lease.token),false);
 const forbidden=new Set(['actorId','requestId','merchantId','signingKey','token','lease','deviceId','serverId','paymentId','receipt','termOperationId']);
 function visit(node){if(!node||typeof node!=='object')return;for(const [key,part] of Object.entries(node)){assert.equal(forbidden.has(key),false,key);visit(part);}}visit(value);
}

test('held technical administrator hands off an annual website intention whose browser creates only one projected pending order',async t=>{
 const f=await fixture(t),before=f.facts(),ticket=await f.ticket();noPrivateFields(ticket,f.admin);
 const context=await f.context(ticket);assert.equal(context.status,200,JSON.stringify(context.data));
 assert.deepEqual(Object.keys(context.data).sort(),['offer','order','pricing','simulation','teamName']);assert.equal(context.data.simulation,true);
 assert.equal(typeof context.data.teamName,'string');assert.ok(context.data.teamName.length>0);assert.deepEqual(context.data.offer,OFFER);assert.equal(context.data.order,null);
 const committed=f.capacity.readSeatCapacity(f.db,'team-a',f.clock.value).usedSeats;
 assert.deepEqual(context.data.pricing,{defaultSeats:SEATS,committedSeats:committed,unitAmountMinor:UNIT});noPrivateFields(context.data,f.admin);
 const created=await f.order(ticket);assert.equal(created.status,201,JSON.stringify(created.data));assert.deepEqual(Object.keys(created.data).sort(),['order','simulation']);assert.equal(created.data.simulation,true);
 safeOrder(created.data.order,OFFER.amountMinor+UNIT*SEATS,SEATS);noPrivateFields(created.data,f.admin);
 assert.equal(created.data.order.createdAt,f.clock.value);
 const after=await f.context(ticket);assert.equal(after.status,200);assert.deepEqual(after.data.order,created.data.order);
 const raw=(await source('billing-store.mjs')).readAnnualOrder(f.db,'team-a',created.data.order.id);
 assert.equal(raw.simulation,true);assert.equal(raw.status,'pending');assert.equal(raw.confirmedAt,null);assert.equal(raw.offer.amountMinor,created.data.order.amountMinor);assert.equal(raw.renewalSeats.selectedSeats,SEATS);
 assert.deepEqual(f.facts(),before);assert.equal(f.db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('same browser intention is idempotent under concurrent posts and rejects changing seats or offer revision',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),before=f.facts();
 const [a,b]=await Promise.all([f.order(ticket),f.order(ticket)]);assert.equal(a.status,201,JSON.stringify(a.data));assert.equal(b.status,201,JSON.stringify(b.data));assert.deepEqual(a.data,b.data);
 assert.equal(f.orderRows()[0].rows.length,1);assert.equal(f.orderRows()[1].rows.length,1);
 const original=f.orderRows();
 for(const change of [{selectedSeats:SEATS+1},{offerRevision:OFFER.revision+1},{offerId:'other-synthetic-offer'}]){
  isError(await f.order(ticket,change),409,'WEBSITE_CHECKOUT_CONFLICT');assert.deepEqual(f.orderRows(),original);
 }
 assert.deepEqual(f.facts(),before);
});

test('a replacement website candidate at the same origin recovers the committed annual receipt without a second order',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),before=f.facts();
 const saved=f.db.prepare('SELECT * FROM team_website_checkout_handoffs').get();
 assert.equal(saved.handoff_hash,hash(ticket.handoff));
 assert.equal(saved.origin,SITE);
 assert.equal(saved.expires_at,ticket.expiresAt);
 const storedPassword=f.db.prepare("SELECT password_hash FROM team_credentials WHERE user_id='administrator-demo'").get().password_hash;
 const durable=JSON.stringify(saved);
 for(const secret of [ticket.handoff,f.admin.token,f.admin.lease.token,storedPassword,hash(storedPassword)]){
  assert.equal(durable.includes(secret),false);
 }
 const committed=await f.order(ticket);
 assert.equal(committed.status,201,JSON.stringify(committed.data));
 safeOrder(committed.data.order,OFFER.amountMinor+UNIT*SEATS,SEATS);
 const original=f.orderRows(),replacement=f.restart();
 assert.notEqual(replacement.options.websiteCheckout,f.websiteCheckout);
 const changes=()=>f.db.prepare('SELECT total_changes() AS count').get().count;
 const beforeRecovery=changes();
 const recovered=await f.context(ticket,replacement);
 assert.equal(recovered.status,200,JSON.stringify(recovered.data));
 assert.deepEqual(recovered.data.order,committed.data.order);
 noPrivateFields(recovered.data,f.admin);
 const replay=await f.order(ticket,{},replacement);
 assert.equal(replay.status,201,JSON.stringify(replay.data));
 assert.deepEqual(replay.data,committed.data);
 assert.equal(changes(),beforeRecovery);
 assert.equal(original[0].rows.length,1);
 assert.equal(original[1].rows.length,1);
 assert.deepEqual(f.orderRows(),original);
 assert.deepEqual(f.facts(),before);
});

test('the outstanding handoff cap survives restart and issuance clears expired rows at their original boundary',async t=>{
 const f=await fixture(t),first=await f.ticket();
 const {origin,merchant_id,scope_json}=f.db.prepare('SELECT origin,merchant_id,scope_json FROM team_website_checkout_handoffs').get();
 const seed=f.db.prepare(`INSERT INTO team_website_checkout_handoffs
   (handoff_hash,origin,merchant_id,request_id,expires_at,scope_json) VALUES (?,?,?,?,?,?)`);
 // Fill the shared store without also exhausting one device's separate request quota.
 for(let count=1;count<256;count++)seed.run(hash('synthetic-other-handoff-'+count),origin,merchant_id,randomUUID(),first.expiresAt,scope_json);
 const count=()=>f.db.prepare('SELECT count(*) AS n FROM team_website_checkout_handoffs').get().n;
 assert.equal(count(),256);
 const reopened=f.restart();
 isError(await f.handoff({options:reopened.options}),429,'WEBSITE_HANDOFF_LIMIT');
 assert.equal(count(),256);

 f.clock.value=first.expiresAt;
 const fresh=await f.handoff({options:reopened.options});
 assert.equal(fresh.status,201,JSON.stringify(fresh.data));
 assert.equal(count(),1);
 assert.equal((await f.context(fresh.data,reopened)).status,200);
 isError(await f.context(first,reopened),403,'WEBSITE_HANDOFF_UNAVAILABLE');
 assert.equal(f.orderRows()[0].rows.length,0);
});

test('a durable annual handoff cannot be used at a different branded origin, merchant or database',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),other=await fixture(t),before=f.facts();
 const elsewhere=f.restart('https://127.0.0.1:14444');
 isError(await f.context(ticket,elsewhere),403,'WEBSITE_HANDOFF_UNAVAILABLE');
 isError(await f.order(ticket,{},elsewhere),403,'WEBSITE_HANDOFF_UNAVAILABLE');
 const replacement=f.restart();
 replacement.options.billingSimulation={...f.billingSimulation,merchantId:'synthetic-different-merchant'};
 isError(await f.context(ticket,replacement),403,'WEBSITE_HANDOFF_UNAVAILABLE');
 isError(await other.context(ticket,other.restart()),403,'WEBSITE_HANDOFF_UNAVAILABLE');
 assert.equal(f.orderRows()[0].rows.length,0);
 assert.equal(other.orderRows()[0].rows.length,0);
 assert.deepEqual(f.facts(),before);
});

test('annual checkout recovers a lost order response after a trusted settlement without changing the ledger',async t=>{
 const f=await fixture(t);
 const ticket=await f.ticket();
 const created=await f.order(ticket);
 assert.equal(created.status,201);
 const original=created.data.order;
 const {signSimulationPayment}=await source('billing-simulation.mjs');
 const {body,signature}=signSimulationPayment({
  protocol:'shenyi-simulation-payment-v1',merchantId:f.billingSimulation.merchantId,
  eventId:randomUUID(),transactionId:randomUUID(),orderId:original.id,product:OFFER.product,
  amountMinor:original.amountMinor,currency:'CNY',status:'succeeded',paidAt:f.clock.value,
 },f.billingSimulation);
 const notification=()=>new Request(SITE+'/api/billing/simulation/notifications',{
  method:'POST',headers:{'Content-Type':'application/json','X-Shenyi-Simulation-Signature':signature},body,
 });
 isError(await f.dispatch(notification()),404,'NOT_FOUND');
 assert.equal((await f.dispatch(notification(),{websiteCheckout:null})).status,200);
 const {readAnnualOrder}=await source('billing-store.mjs');
 assert.equal(readAnnualOrder(f.db,'team-a',original.id).status,'paid');

 const settled=f.facts();
 const originalRows=f.orderRows();
 const changes=()=>f.db.prepare('SELECT total_changes() AS count').get().count;
 const beforeLookup=changes();
 const reopened=await f.context(ticket);
 assert.equal(reopened.status,200,JSON.stringify(reopened.data));
 assert.deepEqual(reopened.data.order,{...original,status:'paid'});
 noPrivateFields(reopened.data,f.admin);
 const retried=await f.order(ticket);
 assert.equal(retried.status,201,JSON.stringify(retried.data));
 assert.deepEqual(retried.data.order,reopened.data.order);
 isError(await f.order(ticket,{selectedSeats:SEATS+1}),409,'WEBSITE_CHECKOUT_CONFLICT');
 assert.equal(changes(),beforeLookup);

 const otherTicket=await f.ticket();
 assert.equal((await f.context(otherTicket)).data.order,null);
 assert.equal((await f.api('/api/auth/logout',{method:'POST',session:f.admin,body:{}})).status,200);
 isError(await f.context(ticket),403,'WEBSITE_HANDOFF_UNAVAILABLE');
 isError(await f.order(ticket),403,'WEBSITE_HANDOFF_UNAVAILABLE');
 assert.deepEqual(f.orderRows(),originalRows);
 assert.deepEqual(f.facts(),settled);
});

test('website never accepts client prices, identities, currency or alternate seat-product fields',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),before=f.facts(),orders=f.orderRows();
 for(const change of [{amountMinor:1},{merchantId:'another-merchant'},{actorId:'manager-a'},{teamId:'team-b'},{currency:'USD'},{quantity:1},{selectedSeats:-1},{selectedSeats:1.5}]){
  const result=await f.order(ticket,change);assert.equal(result.status,400,JSON.stringify(result.data));assert.deepEqual(f.orderRows(),orders);
 }
 assert.equal((await f.browser('/context',{handoff:ticket.handoff,teamId:'team-b'})).status,400);
 assert.equal((await f.handoff({body:{teamId:'team-b'}})).status,400);
 assert.deepEqual(f.facts(),before);
});

test('browser capability needs both pinned Request URL origin and exact Origin header',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),before=f.facts(),orders=f.orderRows();
 for(const settings of [{origin:null},{origin:'https://untrusted.invalid'},{urlOrigin:'https://127.0.0.1:14444'},{urlOrigin:'http://127.0.0.1:14443'}]){
  isError(await f.context(ticket,settings),403,'WEBSITE_ORIGIN_REQUIRED');isError(await f.order(ticket,{},settings),403,'WEBSITE_ORIGIN_REQUIRED');
 }
 assert.equal((await f.browser('/context?extra=1',{handoff:ticket.handoff})).status,400);
 assert.deepEqual(f.orderRows(),orders);assert.deepEqual(f.facts(),before);
});

test('handoffs are technical-own-team and proof scoped rather than ordinary audit role privileges',async t=>{
 const f=await fixture(t),before=f.facts();
 for(const user of ['intern-a','manager-a'])isError(await f.handoff({session:await f.ready(user)}),404,'NOT_FOUND');
 isError(await f.handoff({root:'/api/teams/team-b/billing'}),404,'NOT_FOUND');
 const unsigned=new Request('http://127.0.0.1:8774'+ROOT+'/website-handoff',{method:'POST',headers:{Origin:'shenyi://app','Content-Type':'application/json',Authorization:'Bearer '+f.admin.token},body:'{}'});
 assert.equal((await f.dispatch(unsigned)).status,403);
 isError(await f.context({handoff:'not-a-valid-handoff'}),403,'WEBSITE_HANDOFF_UNAVAILABLE');assert.deepEqual(f.facts(),before);assert.equal(f.orderRows()[0].rows.length,0);
});

test('reading a handoff does not extend its maximum two-minute expiry',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),before=f.facts();
 f.clock.value=ticket.expiresAt-1;assert.equal((await f.context(ticket,f.restart())).status,200);
 f.clock.value=ticket.expiresAt;const replacement=f.restart();
 isError(await f.context(ticket,replacement),403,'WEBSITE_HANDOFF_UNAVAILABLE');isError(await f.order(ticket,{},replacement),403,'WEBSITE_HANDOFF_UNAVAILABLE');
 assert.equal(f.orderRows()[0].rows.length,0);assert.deepEqual(f.facts(),before);
});

for(const change of ['role','lease','logout','credential'])test('replacement website candidate denies a previously valid handoff after '+change+' revocation',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),before=f.facts();
 assert.equal((await f.context(ticket)).status,200);
 if(change==='role')f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='administrator-demo'").run();
 if(change==='lease')f.db.prepare("UPDATE team_device_leases SET revoked_at=? WHERE user_id='administrator-demo' AND revoked_at IS NULL").run(f.clock.value);
 if(change==='logout')assert.equal((await f.api('/api/auth/logout',{method:'POST',session:f.admin,body:{}})).status,200);
 if(change==='credential')assert.equal((await f.api('/api/auth/password',{method:'POST',session:f.admin,body:{currentPassword:PASSWORD,newPassword:'SyntheticChangedForCheckout!2026'}})).status,200);
 const replacement=f.restart();
 isError(await f.context(ticket,replacement),403,'WEBSITE_HANDOFF_UNAVAILABLE');isError(await f.order(ticket,{},replacement),403,'WEBSITE_HANDOFF_UNAVAILABLE');
 assert.equal(f.orderRows()[0].rows.length,0);assert.deepEqual(f.facts(),before);
});

test('candidate feature is absent in default or managed mode and requires its isolated database marker',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),before=f.facts();
 for(const options of [{websiteCheckout:null},{serviceMode:'managed-service',billingSimulation:null},
  {billingSimulation:{...f.billingSimulation,offers:[{...OFFER},{...OFFER,id:'another-website-year'}]}}]){
  isError(await f.handoff({options}),503,'WEBSITE_CHECKOUT_UNAVAILABLE');isError(await f.context(ticket,{options}),404,'NOT_FOUND');
 }
 f.db.prepare("DELETE FROM team_database_metadata WHERE name='website-checkout-demo'").run();
 isError(await f.handoff(),503,'WEBSITE_CHECKOUT_UNAVAILABLE');isError(await f.context(ticket),404,'NOT_FOUND');
 assert.equal(f.orderRows()[0].rows.length,0);assert.deepEqual(f.facts(),before);
});

test('opted-in candidate disables desktop purchase and all simulated event routes but default desktop creation remains available',async t=>{
 const f=await fixture(t),before=f.facts(),body={requestId:randomUUID(),offerId:OFFER.id,offerRevision:OFFER.revision,selectedSeats:SEATS};
 isError(await f.desktop(ROOT+'/orders',body),403,'WEBSITE_CHECKOUT_REQUIRED');
 for(const suffix of ['notifications','payment-exceptions','order-closures']){
  const response=await f.dispatch(new Request('http://127.0.0.1:8774/api/billing/simulation/'+suffix,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));isError(response,404,'NOT_FOUND');
 }
 assert.equal(f.orderRows()[0].rows.length,0);
 const normal=await f.desktop(ROOT+'/orders',body,{options:{websiteCheckout:null}});assert.equal(normal.status,201,JSON.stringify(normal.data));assert.equal(normal.data.order.status,'pending');
 assert.deepEqual(f.facts(),before);
});

test('a real final seat-plan INSERT failure leaves no partial order or consumed intention and retry creates one pending order',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),before=f.facts(),orders=f.orderRows();
 f.db.exec("CREATE TRIGGER synthetic_website_final_plan BEFORE INSERT ON team_annual_order_seat_plans BEGIN SELECT RAISE(ABORT,'SYNTHETIC_WEBSITE_FINAL_PLAN'); END");
 const failed=await f.order(ticket);assert.ok([409,503].includes(failed.status),JSON.stringify(failed.data));assert.deepEqual(f.orderRows(),orders);assert.deepEqual(f.facts(),before);
 f.db.exec('DROP TRIGGER synthetic_website_final_plan');
 const retry=await f.order(ticket);assert.equal(retry.status,201,JSON.stringify(retry.data));safeOrder(retry.data.order,OFFER.amountMinor+UNIT*SEATS,SEATS);
 assert.deepEqual((await f.order(ticket)).data,retry.data);assert.equal(f.orderRows()[0].rows.length,1);assert.deepEqual(f.facts(),before);
});
