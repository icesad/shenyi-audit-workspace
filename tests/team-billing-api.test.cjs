'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomBytes,randomUUID,createHmac}=require('node:crypto');
const {createBusinessRoleFixture,source}=require('./helpers/business-role-fixture.cjs');
const ROOT='/api/teams/team-a/billing',CALLBACK='/api/billing/simulation/notifications';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const offer={id:'synthetic-annual',revision:1,product:'team-annual-renewal',amountMinor:12345,currency:'CNY'};
async function fixture(t,extra={}){
 const f=await createBusinessRoleFixture(t),actor=await f.ready('administrator-demo');
 const gateway={mode:'simulation-v1',merchantId:'synthetic-merchant',signingKey:randomBytes(32),offers:[{...offer}],...extra};
 const {handleTeamApplicationRequest}=await source('application-api.mjs');
 const options={db:f.db,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true},subscriptionEnforcement:'team-management-v1',billingSimulation:gateway};
 const api=async(route,settings={})=>{
  const raw=settings.raw??f.makeRequest(route,{session:actor,...settings});
  const response=await handleTeamApplicationRequest(raw,options),bytes=Buffer.from(await response.arrayBuffer());
  return{status:response.status,data:bytes.length?JSON.parse(bytes):null,headers:response.headers};
 };
 const create=async(body={})=>api(ROOT+'/orders',{method:'POST',body:{requestId:randomUUID(),offerId:offer.id,offerRevision:1,...body}});
 const receipt=(order,extra={})=>({protocol:'shenyi-simulation-payment-v1',merchantId:gateway.merchantId,eventId:randomUUID(),transactionId:randomUUID(),orderId:order.id,product:offer.product,amountMinor:offer.amountMinor,currency:'CNY',status:'succeeded',paidAt:f.clock.value-123,...extra});
 const callback=async(value,{key=gateway.signingKey,headers={},route=CALLBACK}={})=>{
  const bytes=Buffer.from(JSON.stringify(value)),signature=createHmac('sha256',key).update('shenyi.billing.simulation.v1\0').update(bytes).digest('hex');
  return api(route,{raw:new Request('http://127.0.0.1:8774'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Shenyi-Simulation-Signature':signature,...headers},body:bytes})});
 };
 const rows=()=>Object.fromEntries(['team_annual_orders','team_annual_verified_payments','team_annual_fulfilments','team_subscription_events','team_subscription_heads'].map(n=>[n,f.db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all().map(r=>({...r}))]));
 return{...f,actor,gateway,options,api,create,receipt,callback,rows};
}
test('pure technical administrator can create and inspect own-team synthetic orders without a subscription or audit access',async t=>{
 const f=await fixture(t),input={requestId:randomUUID(),offerId:offer.id,offerRevision:1};
 const catalog=await f.api(ROOT+'/offers');assert.equal(catalog.status,200);assert.deepEqual(catalog.data,{simulation:true,offers:[offer]});
 const created=await f.create(input);assert.equal(created.status,201,JSON.stringify(created));const order=created.data.order;
 assert.equal(order.status,'pending');assert.deepEqual(order.offer,offer);assert.equal(order.simulation,true);assert.equal(order.actorId,'administrator-demo');assert.equal(order.confirmedAt,null);
 const before=f.rows(),replay=await f.create(input);assert.equal(replay.status,201);assert.deepEqual(replay.data,created.data);assert.deepEqual(f.rows(),before);
 assert.deepEqual((await f.api(ROOT+'/orders/'+order.id)).data.order,order);assert.equal((await f.api(ROOT+'/orders')).data.orders.length,1);
 assert.equal((await f.api('/api/teams/team-a/projects/project-a')).status,404);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_memberships WHERE user_id=?').get(f.actor.account.id).n,0);
 assert.equal((await f.api('/api/teams/team-b/billing/orders')).status,404);
 for(const user of ['intern-a','assistant-a','manager-a','partner-a','manager-b']){const session=await f.ready(user);assert.equal((await f.api(ROOT+'/orders',{session})).status,404,user);assert.equal((await f.api(ROOT+'/offers',{session})).status,404,user);}
 assert.deepEqual(f.rows(),before);
});
test('client amount, actor, team, success and entitlement fields cannot create or pay an order',async t=>{
 const f=await fixture(t);for(const extra of [{amountMinor:1},{actorId:'partner-a'},{teamId:'team-b'},{confirmedAt:1},{status:'succeeded'},{endsAt:9999999999999},{product:'employee-seats'}])assert.equal((await f.create(extra)).status,400);
 assert.equal((await f.create({offerRevision:2})).status,409);assert.equal((await f.create({offerId:'unknown'})).status,409);assert.equal(f.rows().team_annual_orders.length,0);
});
test('verified notification grants exactly one Beijing natural year at server confirmation, replay never grants another',async t=>{
 const f=await fixture(t),created=await f.create();assert.equal(created.status,201);const receipt=f.receipt(created.data.order,{paidAt:Date.parse('2024-01-01T00:00:00Z')}),confirmedAt=f.clock.value;
 assert.deepEqual(await f.callback(receipt).then(r=>({status:r.status,data:r.data})),{status:200,data:{accepted:true,simulation:true}});
 const paid=(await f.api(ROOT+'/orders/'+receipt.orderId)).data.order;
 assert.equal(paid.status,'paid');assert.equal(paid.confirmedAt,confirmedAt);assert.equal(paid.fulfilment.startsAt,confirmedAt);assert.equal(paid.fulfilment.endsAt,Date.parse('2027-11-15T16:00:00Z'));
 assert.equal(JSON.stringify(paid).includes(receipt.transactionId),false);const before=f.rows();f.clock.value+=1000;
 assert.equal((await f.callback(receipt)).status,200);assert.deepEqual(f.rows(),before);
});
test('forged or mismatched signed facts grant nothing; client-device signature is never a gateway signature',async t=>{
 const f=await fixture(t),made=await f.create(),order=made.data.order,before=f.rows();
 assert.equal((await f.callback(f.receipt(order),{key:randomBytes(32)})).status,403);
 for(const extra of [{amountMinor:offer.amountMinor-1},{merchantId:'another-merchant'},{currency:'USD'},{product:'employee-seats'},{status:'pending'},{orderId:randomUUID()}]){const r=await f.callback(f.receipt(order,extra));assert.ok([400,404,409].includes(r.status),JSON.stringify(r));}
 assert.equal((await f.api(CALLBACK,{method:'POST',body:f.receipt(order)})).status,403);
 assert.deepEqual(f.rows(),before);
});
test('callback keeps origin/body/path checks and only exact endpoint bypasses the user-device proof',async t=>{
 const f=await fixture(t),made=await f.create(),receipt=f.receipt(made.data.order),before=f.rows();
 assert.equal((await f.callback(receipt,{headers:{Origin:'https://untrusted.invalid'}})).status,403);
 assert.equal((await f.callback(receipt,{route:CALLBACK+'?order=1'})).status,400);
 assert.equal((await f.callback(receipt,{route:CALLBACK+'/extra'})).status,401);
 assert.equal((await f.callback(receipt,{headers:{'Content-Length':'16385'}})).status,413);
 assert.equal((await f.api(CALLBACK,{raw:new Request('http://127.0.0.1:8774'+CALLBACK)})).status,405);
 assert.deepEqual(f.rows(),before);
});
test('reconcile queries trusted source and verifies its signature; caller success body cannot repair a missing callback',async t=>{
 const lookupCalls=[];let envelope=null;const f=await fixture(t,{lookupPayment:async(order)=>{lookupCalls.push(order);return envelope;}}),made=await f.create(),order=made.data.order;
 assert.equal((await f.api(ROOT+'/orders/'+order.id+'/reconcile',{method:'POST',body:{status:'succeeded'}})).status,400);assert.equal(lookupCalls.length,0);
 const pending=await f.api(ROOT+'/orders/'+order.id+'/reconcile',{method:'POST',body:{}});assert.equal(pending.status,200);assert.equal(pending.data.order.status,'pending');
 const gateway=await source('billing-simulation.mjs');envelope=gateway.signSimulationPayment(f.receipt(order),f.gateway);
 const paid=await f.api(ROOT+'/orders/'+order.id+'/reconcile',{method:'POST',body:{}});assert.equal(paid.status,200,JSON.stringify(paid));assert.equal(paid.data.order.status,'paid');assert.equal(lookupCalls.length,2);
 const before=f.rows();assert.equal((await f.api(ROOT+'/orders/'+order.id+'/reconcile',{method:'POST',body:{}})).status,200);assert.deepEqual(f.rows(),before);
});
test('revoked technical authority during source lookup prevents reconciliation publication and response',async t=>{
 const entered=deferred(),release=deferred();let envelope;const f=await fixture(t,{lookupPayment:async()=>{entered.resolve();await release.promise;return envelope;}}),made=await f.create(),gateway=await source('billing-simulation.mjs');envelope=gateway.signSimulationPayment(f.receipt(made.data.order),f.gateway);
 t.after(()=>release.resolve());const before=f.rows(),pending=f.api(ROOT+'/orders/'+made.data.order.id+'/reconcile',{method:'POST',body:{}});await entered.promise;
 f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='administrator-demo'").run();release.resolve();const result=await pending;assert.equal(result.status,409);assert.equal(result.data.error.code,'DEVICE_STATE_CHANGED');assert.deepEqual(f.rows(),before);
});
test('idempotent request keeps original locked price after a catalog version is retired',async t=>{
 const f=await fixture(t),input={requestId:randomUUID(),offerId:offer.id,offerRevision:1},made=await f.create(input);assert.equal(made.status,201);
 f.gateway.offers=[{...offer,revision:2,amountMinor:99999}];
 const replay=await f.create(input);assert.equal(replay.status,201);assert.deepEqual(replay.data,made.data);
 assert.equal((await f.create({offerRevision:1})).status,409);assert.equal((await f.create({requestId:input.requestId,offerRevision:2})).status,409);
 assert.equal(f.rows().team_annual_orders.length,1);
});
test('last order insertion cannot commit after technical authority changes inside the publication transaction',async t=>{
 const f=await fixture(t),before=f.rows(),prepare=f.db.prepare.bind(f.db);let reached=0;
 f.db.prepare=function(sql,...rest){const statement=prepare(sql,...rest);if(sql.startsWith('INSERT INTO team_annual_orders(')){const run=statement.run.bind(statement);statement.run=(...values)=>{const result=run(...values);reached++;prepare("UPDATE team_operators SET status='revoked' WHERE user_id='administrator-demo'").run();return result;};}return statement;};
 const result=await f.create();assert.equal(reached,1);assert.equal(result.status,409);assert.equal(result.data.error.code,'DEVICE_STATE_CHANGED');assert.deepEqual(f.rows(),before);
 assert.equal(prepare("SELECT status FROM team_operators WHERE user_id='administrator-demo'").get().status,'active');
});
test('order pagination validates scoped cursor and never exposes a foreign order',async t=>{
 const f=await fixture(t);for(let n=0;n<3;n++)assert.equal((await f.create()).status,201);
 const first=await f.api(ROOT+'/orders?limit=1');assert.equal(first.status,200);assert.equal(first.data.orders.length,1);assert.equal(first.data.hasMore,true);assert.equal(first.data.nextCursor,first.data.orders[0].id);
 const second=await f.api(ROOT+'/orders?limit=1&after='+first.data.nextCursor);assert.equal(second.status,200);assert.notEqual(second.data.orders[0].id,first.data.orders[0].id);
 const store=await source('billing-store.mjs'),foreign=store.createAnnualOrder(f.db,{teamId:'team-b',actorId:'manager-b',requestId:randomUUID(),merchantId:f.gateway.merchantId,offer},{now:()=>f.clock.value});
 assert.equal((await f.api(ROOT+'/orders/'+foreign.id)).status,404);assert.equal((await f.api(ROOT+'/orders?after='+foreign.id)).status,404);
 for(const q of ['?limit=0','?limit=51','?limit=1&limit=2','?q=amount','?after='+randomUUID()])assert.ok([400,404].includes((await f.api(ROOT+'/orders'+q)).status));
});
test('revocation while the actual signed request body streams prevents creating any billing facts',async t=>{
 const f=await fixture(t),input={requestId:randomUUID(),offerId:offer.id,offerRevision:1},bytes=Buffer.from(JSON.stringify(input)),entered=deferred(),release=deferred();let pulls=0;
 const stream=new ReadableStream({pull(controller){if(pulls++===0){controller.enqueue(bytes.subarray(0,1));return;}entered.resolve();return release.promise.then(()=>{controller.enqueue(bytes.subarray(1));controller.close();});}});
 t.after(()=>release.resolve());const before=f.rows(),raw=f.makeRequest(ROOT+'/orders',{method:'POST',session:f.actor,body:input,bodyStream:stream}),pending=f.api(ROOT+'/orders',{raw});await entered.promise;
 f.db.prepare("UPDATE team_operators SET status='revoked' WHERE user_id='administrator-demo'").run();release.resolve();const result=await pending;
 assert.equal(result.status,409);assert.equal(result.data.error.code,'DEVICE_STATE_CHANGED');assert.deepEqual(f.rows(),before);
});
test('configuration defaults off and refuses enabling simulation in a non-strict or incomplete expiry scope',async t=>{
 const f=await fixture(t);f.options.billingSimulation=null;assert.equal((await f.create()).status,503);assert.equal((await f.callback(f.receipt({id:randomUUID()}))).status,503);
 for(const scope of ['disabled','business-data-v1','workspace-create-v1']){f.options.billingSimulation=f.gateway;f.options.subscriptionEnforcement=scope;assert.equal((await f.create()).status,503);}
 const {startTeamServer}=await source('dev-server.mjs');await assert.rejects(startTeamServer({...f.options,port:0,subscriptionEnforcement:'disabled'}),/Invalid billing simulation/);
 assert.equal(f.rows().team_annual_orders.length,0);
});
