'use strict';
// Independent in-process signed fixture only; no browser, external service or
// real payment. Quote arithmetic uses a known Beijing leap-day annual interval.
const test=require('node:test'),assert=require('node:assert/strict');
const {randomBytes,randomUUID,createHash}=require('node:crypto');
const {createBusinessRoleFixture,source}=require('./helpers/business-role-fixture.cjs');
const SITE='https://127.0.0.1:14443',ROOT='/api/teams/team-a/billing',WEB='/api/website-checkout';
const AT=Date.parse('2028-02-29T12:34:56.789+08:00');
const YEAR=Date.parse('2029-02-28T12:34:56.789+08:00')-AT;
const ANNUAL={id:'synthetic-site-annual',revision:1,product:'team-annual-renewal',amountMinor:12000,currency:'CNY'};
const SEAT={id:'synthetic-site-seat',revision:4,annualUnitAmountMinor:10001,currency:'CNY'};
const digest=value=>createHash('sha256').update(value).digest('hex');
const error=(result,status,code)=>{assert.equal(result.status,status,JSON.stringify(result.data));assert.equal(result.data.error.code,code);};

async function fixture(t,{remaining=YEAR/4,unit=SEAT.annualUnitAmountMinor}={}){
 const f=await createBusinessRoleFixture(t,{now:AT}),admin=await f.ready('administrator-demo');
 const {createWebsiteCheckoutCandidate}=await source('website-checkout.mjs'),{handleTeamApplicationRequest}=await source('application-api.mjs');
 const subscription=await source('subscription-store.mjs'),capacity=await source('seat-capacity-store.mjs'),termEndsAt=AT+remaining;
 subscription.recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:0,startsAt:AT-86400000,endsAt:termEndsAt,sourceRef:'synthetic-seat-checkout-prior'},{now:()=>AT});
 capacity.recordSeatCapacityGrant(f.db,{teamId:'team-a',grantId:randomUUID(),seats:8,startsAt:AT-86400000,endsAt:termEndsAt,sourceRef:'synthetic-seat-checkout-capacity'},{now:()=>AT});
 f.db.prepare("INSERT INTO team_database_metadata(name,value) VALUES ('website-checkout-demo','true')").run();
 const seatOffer={...SEAT,annualUnitAmountMinor:unit};
 const billingSimulation={mode:'simulation-v1',merchantId:'synthetic-seat-checkout',signingKey:randomBytes(32),offers:[{...ANNUAL}],annualSeatUnitAmountMinor:2000,seatOffer};
 const options={db:f.db,now:()=>f.clock.value,serviceMode:'local-preview',identityProviders:{deviceProofRequired:true},subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1',billingSimulation,websiteCheckout:createWebsiteCheckoutCandidate({origin:SITE})};
 const dispatch=async(request,overrides={})=>{const response=await handleTeamApplicationRequest(request,{...options,...overrides});return {status:response.status,data:await response.json()};};
 const desktop=(route,body={},settings={})=>dispatch(f.makeRequest(route,{method:'POST',session:settings.session??admin,body}),settings.options);
 const handoff=(settings={})=>desktop((settings.root??ROOT)+'/website-seat-handoff',settings.body??{},settings);
 const browser=(suffix,body,settings={})=>dispatch(new Request((settings.urlOrigin??SITE)+WEB+suffix,{method:'POST',headers:{'Content-Type':'application/json',...(settings.origin===null?{}:{Origin:settings.origin??SITE})},body:JSON.stringify(body)}),settings.options);
 const ticket=async()=>{const result=await handoff();assert.equal(result.status,201,JSON.stringify(result.data));assert.deepEqual(Object.keys(result.data).sort(),['expiresAt','handoff']);assert.ok(result.data.expiresAt>f.clock.value&&result.data.expiresAt<=f.clock.value+120000);return result.data;};
 const context=(ticket,settings)=>browser('/seat-context',{handoff:ticket.handoff},settings);
 const quote=(ticket,quantity=3,change={},settings)=>browser('/seat-quote',{handoff:ticket.handoff,offerId:seatOffer.id,offerRevision:seatOffer.revision,quantity,...change},settings);
 const create=(ticket,quoteId,change={},settings)=>browser('/seat-orders',{handoff:ticket.handoff,quoteId,...change},settings);
 const q=async(ticket,quantity=3)=>{const result=await quote(ticket,quantity);assert.equal(result.status,200,JSON.stringify(result.data));assert.deepEqual(Object.keys(result.data).sort(),['quote','simulation']);assert.equal(result.data.simulation,true);return result.data.quote;};
 const tables=['team_annual_orders','team_annual_order_seat_plans','team_annual_verified_payments','team_annual_fulfilments','team_seat_verified_payments','team_subscription_events','team_subscription_heads','team_seat_capacity_grants','team_memberships','team_project_grants','team_admin_grants'];
 const facts=()=>tables.map(name=>{const rows=f.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all();return {name,count:rows.length,sha256:digest(JSON.stringify(rows))};});
 const orders=()=>f.db.prepare('SELECT * FROM team_seat_orders ORDER BY rowid').all().map(row=>({...row}));
 const updateTerm=()=>subscription.recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:1,startsAt:AT-86400000,endsAt:termEndsAt,sourceRef:'synthetic-new-revision-same-window'},{now:()=>f.clock.value});
 return {...f,admin,dispatch,desktop,handoff,browser,ticket,context,quote,create,q,facts,orders,updateTerm,options,billingSimulation,seatOffer,termEndsAt};
}
function quoteView(quote,{seats,amountMinor,at=AT,termEndsAt}){
 assert.deepEqual(Object.keys(quote).sort(),['amountMinor','expiresAt','id','seats','termEndsAt']);assert.equal(typeof quote.id,'string');assert.ok(quote.id.length>0&&quote.id.length<=128);
 assert.equal(quote.seats,seats);assert.equal(quote.amountMinor,amountMinor);assert.equal(quote.termEndsAt,termEndsAt);assert.equal(quote.expiresAt,Math.min(at+60000,termEndsAt));
}
function orderView(order,{seats,amountMinor,termEndsAt,createdAt=AT}){
 assert.deepEqual(Object.keys(order).sort(),['amountMinor','createdAt','currency','id','quoteExpiresAt','seats','status','termEndsAt']);
 assert.match(order.id,/^[a-f0-9-]{36}$/);assert.equal(order.seats,seats);assert.equal(order.amountMinor,amountMinor);assert.equal(order.termEndsAt,termEndsAt);assert.equal(order.createdAt,createdAt);assert.equal(order.status,'pending');assert.equal(order.currency,'CNY');
 assert.equal(order.quoteExpiresAt,Math.min(createdAt+15*60000,termEndsAt));
}
function noPrivate(value,admin){
 const text=JSON.stringify(value);assert.equal(text.includes(admin.token),false);assert.equal(text.includes(admin.lease.token),false);
 const denied=new Set(['actorId','teamId','requestId','merchantId','signingKey','lease','token','deviceId','serverId','paymentId','receipt']);
 function visit(node){if(node&&typeof node==='object')for(const [key,part] of Object.entries(node)){assert.equal(denied.has(key),false,key);visit(part);}}visit(value);
}

test('seat context, independently rounded quote and immutable pending order preserve the exact term and all existing rights',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),before=f.facts(),context=await f.context(ticket);
 assert.equal(context.status,200,JSON.stringify(context.data));assert.deepEqual(Object.keys(context.data).sort(),['offer','order','simulation','teamName','termEndsAt']);
 assert.equal(context.data.simulation,true);assert.equal(typeof context.data.teamName,'string');assert.deepEqual(context.data.offer,{...f.seatOffer,product:'team-seat-addition'});assert.equal(context.data.termEndsAt,f.termEndsAt);assert.equal(context.data.order,null);noPrivate(context.data,f.admin);
 const quoted=await f.q(ticket);quoteView(quoted,{seats:3,amountMinor:7501,termEndsAt:f.termEndsAt});
 assert.notEqual(quoted.amountMinor,Math.ceil(10001/4)*3,'round once for the whole order, not once per seat');
 assert.equal(f.orders().length,0);assert.deepEqual(f.facts(),before);noPrivate(quoted,f.admin);
 const result=await f.create(ticket,quoted.id);assert.equal(result.status,201,JSON.stringify(result.data));assert.deepEqual(Object.keys(result.data).sort(),['order','simulation']);assert.equal(result.data.simulation,true);
 orderView(result.data.order,{seats:3,amountMinor:7501,termEndsAt:f.termEndsAt});noPrivate(result.data,f.admin);
 assert.deepEqual((await f.context(ticket)).data.order,result.data.order);
 const raw=(await source('seat-order-store.mjs')).readSeatOrder(f.db,'team-a',result.data.order.id);assert.equal(raw.termRevision,1);assert.equal(raw.offer.amountMinor,7501);assert.equal(raw.status,'pending');assert.equal(raw.confirmedAt,null);assert.equal(raw.grant,null);
 assert.deepEqual(f.facts(),before);assert.equal(f.db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('seat and annual handoff scopes cannot be interchanged and a quote cannot be used by a different seat intention',async t=>{
 const f=await fixture(t),seat=await f.ticket(),annual=await f.desktop(ROOT+'/website-handoff');assert.equal(annual.status,201);
 const quoted=await f.q(seat),before=f.facts();
 for(const [suffix,body] of [['/seat-context',{handoff:annual.data.handoff}],['/seat-quote',{handoff:annual.data.handoff,offerId:SEAT.id,offerRevision:SEAT.revision,quantity:3}],['/seat-orders',{handoff:annual.data.handoff,quoteId:quoted.id}],['/context',{handoff:seat.handoff}],['/orders',{handoff:seat.handoff,offerId:ANNUAL.id,offerRevision:ANNUAL.revision,selectedSeats:8}]])error(await f.browser(suffix,body),403,'WEBSITE_HANDOFF_UNAVAILABLE');
 const another=await f.ticket();error(await f.create(another,quoted.id),409,'WEBSITE_CHECKOUT_CONFLICT');
 assert.equal(f.orders().length,0);assert.deepEqual(f.facts(),before);
});

test('quantity bounds and exact bodies deny client-controlled amounts or identities without any order write',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),before=f.facts();
 for(const quantity of [0,-1,1.5,1001,Number.MAX_SAFE_INTEGER+1])assert.equal((await f.quote(ticket,quantity)).status,400);
 for(const change of [{amountMinor:1},{currency:'USD'},{teamId:'team-b'},{merchantId:'other'},{actorId:'manager-a'}])assert.equal((await f.quote(ticket,3,change)).status,400);
 const one=await f.q(ticket,1);quoteView(one,{seats:1,amountMinor:2501,termEndsAt:f.termEndsAt});
 const thousand=await f.q(ticket,1000);quoteView(thousand,{seats:1000,amountMinor:2500250,termEndsAt:f.termEndsAt});
 assert.equal((await f.create(ticket,thousand.id,{quantity:1})).status,400);assert.equal((await f.handoff({body:{quantity:3}})).status,400);
 assert.equal(f.orders().length,0);assert.deepEqual(f.facts(),before);
});

test('all seat browser endpoints independently require the pinned URL origin and Origin header',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),quoted=await f.q(ticket),before=f.facts();
 for(const settings of [{origin:null},{origin:'https://untrusted.invalid'},{urlOrigin:'https://127.0.0.1:14444'}]){
  error(await f.context(ticket,settings),403,'WEBSITE_ORIGIN_REQUIRED');error(await f.quote(ticket,3,{},settings),403,'WEBSITE_ORIGIN_REQUIRED');error(await f.create(ticket,quoted.id,{},settings),403,'WEBSITE_ORIGIN_REQUIRED');
 }
 assert.equal(f.orders().length,0);assert.deepEqual(f.facts(),before);
});

test('seat issuance remains own-team bound technical authority and needs a configured seat offer',async t=>{
 const f=await fixture(t),before=f.facts();
 for(const id of ['intern-a','manager-a'])error(await f.handoff({session:await f.ready(id)}),404,'NOT_FOUND');
 error(await f.handoff({root:'/api/teams/team-b/billing'}),404,'NOT_FOUND');
 const {seatOffer,...noSeat}=f.billingSimulation;error(await f.handoff({options:{billingSimulation:noSeat}}),503,'WEBSITE_CHECKOUT_UNAVAILABLE');
 const unsigned=new Request('http://127.0.0.1:8774'+ROOT+'/website-seat-handoff',{method:'POST',headers:{Origin:'shenyi://app','Content-Type':'application/json',Authorization:'Bearer '+f.admin.token},body:'{}'});assert.equal((await f.dispatch(unsigned)).status,403);
 assert.equal(f.orders().length,0);assert.deepEqual(f.facts(),before);
});

test('only the latest live quote may create an order, and stale quote expiry leaves no write',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),before=f.facts(),old=await f.q(ticket,1),current=await f.q(ticket,3);
 error(await f.create(ticket,old.id),409,'WEBSITE_CHECKOUT_CONFLICT');assert.equal(f.orders().length,0);
 error(await f.create(ticket,randomUUID()),409,'WEBSITE_CHECKOUT_CONFLICT');
 f.clock.value=current.expiresAt;assert.ok(f.clock.value<ticket.expiresAt);error(await f.create(ticket,current.id),409,'WEBSITE_CHECKOUT_CONFLICT');
 assert.equal(f.orders().length,0);assert.deepEqual(f.facts(),before);
});

test('one intention concurrently creates once and exact replay survives preview quote expiry while the capability remains valid',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),quoted=await f.q(ticket),before=f.facts();
 const [a,b]=await Promise.all([f.create(ticket,quoted.id),f.create(ticket,quoted.id)]);assert.equal(a.status,201,JSON.stringify(a.data));assert.equal(b.status,201,JSON.stringify(b.data));assert.deepEqual(a.data,b.data);assert.equal(f.orders().length,1);
 const original=f.orders();f.clock.value=quoted.expiresAt+1;assert.ok(f.clock.value<ticket.expiresAt);
 const replay=await f.create(ticket,quoted.id);assert.equal(replay.status,201,JSON.stringify(replay.data));assert.deepEqual(replay.data,a.data);assert.deepEqual(f.orders(),original);
 error(await f.quote(ticket,3),409,'WEBSITE_CHECKOUT_CONFLICT');error(await f.create(ticket,randomUUID()),409,'WEBSITE_CHECKOUT_CONFLICT');
 assert.deepEqual(f.facts(),before);
});

test('a changed term revision invalidates the quote even if its end and recomputed price remain identical',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),quoted=await f.q(ticket);f.updateTerm();const before=f.facts();
 error(await f.create(ticket,quoted.id),409,'WEBSITE_CHECKOUT_CONFLICT');assert.equal(f.orders().length,0);assert.deepEqual(f.facts(),before);
});

test('server confirmation recomputes the exact current amount and rejects a one-fen drift inside the live quote window',async t=>{
 const f=await fixture(t,{unit:YEAR}),ticket=await f.ticket(),quoted=await f.q(ticket,1),before=f.facts();
 assert.equal(quoted.amountMinor,YEAR/4);f.clock.value=AT+1;assert.ok(f.clock.value<quoted.expiresAt);
 error(await f.create(ticket,quoted.id),409,'WEBSITE_CHECKOUT_CONFLICT');assert.equal(f.orders().length,0);assert.deepEqual(f.facts(),before);
});

test('a changed trusted offer price cannot silently alter a previously quoted amount',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),quoted=await f.q(ticket),before=f.facts();
 const billingSimulation={...f.billingSimulation,seatOffer:{...f.seatOffer,annualUnitAmountMinor:f.seatOffer.annualUnitAmountMinor+1}};
 error(await f.create(ticket,quoted.id,{}, {options:{billingSimulation}}),409,'WEBSITE_CHECKOUT_CONFLICT');assert.equal(f.orders().length,0);assert.deepEqual(f.facts(),before);
});

test('subscription expiry denies issuance, quoting and uncommitted confirmation without changing any rights',async t=>{
 const f=await fixture(t,{remaining:30000}),ticket=await f.ticket(),quoted=await f.q(ticket),before=f.facts();
 assert.equal(quoted.expiresAt,f.termEndsAt);f.clock.value=f.termEndsAt;assert.ok(f.clock.value<ticket.expiresAt);
 error(await f.handoff(),402,'SUBSCRIPTION_WRITE_UNAVAILABLE');error(await f.quote(ticket),402,'SUBSCRIPTION_WRITE_UNAVAILABLE');error(await f.create(ticket,quoted.id),402,'SUBSCRIPTION_WRITE_UNAVAILABLE');
 assert.equal(f.orders().length,0);assert.deepEqual(f.facts(),before);
});

for(const kind of ['role','lease','ticket-expiry'])test('live seat quote cannot be confirmed after '+kind+' revocation',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),quoted=await f.q(ticket),before=f.facts();
 if(kind==='role')f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='administrator-demo'").run();
 if(kind==='lease')f.db.prepare("UPDATE team_device_leases SET revoked_at=? WHERE user_id='administrator-demo' AND revoked_at IS NULL").run(AT);
 if(kind==='ticket-expiry')f.clock.value=ticket.expiresAt;
 error(await f.create(ticket,quoted.id),403,'WEBSITE_HANDOFF_UNAVAILABLE');assert.equal(f.orders().length,0);assert.deepEqual(f.facts(),before);
});

test('an actual seat-order INSERT abort rolls back and preserves the current quote for one successful retry',async t=>{
 const f=await fixture(t),ticket=await f.ticket(),quoted=await f.q(ticket),before=f.facts();
 f.db.exec("CREATE TRIGGER synthetic_site_seat_insert BEFORE INSERT ON team_seat_orders BEGIN SELECT RAISE(ABORT,'SYNTHETIC_SITE_SEAT_INSERT'); END");
 const failed=await f.create(ticket,quoted.id);assert.ok([409,503].includes(failed.status),JSON.stringify(failed.data));assert.equal(f.orders().length,0);assert.deepEqual(f.facts(),before);
 f.db.exec('DROP TRIGGER synthetic_site_seat_insert');const retried=await f.create(ticket,quoted.id);assert.equal(retried.status,201,JSON.stringify(retried.data));
 orderView(retried.data.order,{seats:3,amountMinor:7501,termEndsAt:f.termEndsAt});assert.equal(f.orders().length,1);assert.deepEqual(f.facts(),before);
});
