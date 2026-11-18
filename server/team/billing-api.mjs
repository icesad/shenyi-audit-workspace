import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
import {UUID,currentDeviceLease,deviceServerId,deviceConflict,deviceRequired} from './device-policy.mjs';
import {administratorTechnicalEligible,administratorTechnicalEligibilitySql} from './administrator-business-role-policy.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {createAnnualOrderWithinTransaction,readAnnualOrder,readAnnualOrderRequest,listAnnualOrders,recordVerifiedAnnualPayment,fulfilAnnualOrder,readAnnualSeatRenewalDefaults} from './billing-store.mjs';
import {createSeatOrderWithinTransaction,readSeatOrder,readSeatOrderRequest,listSeatOrders,recordVerifiedSeatPayment,fulfilSeatOrder} from './seat-order-store.mjs';
import {ANNUAL_PRODUCT,SEAT_PRODUCT,readSimulationPaymentRequest,verifySimulationPaymentEnvelope} from './billing-simulation.mjs';
import {readSeatCapacity} from './seat-capacity-store.mjs';
import {readSubscriptionState} from './subscription-store.mjs';

export const SIMULATION_NOTIFICATION_PATH='/api/billing/simulation/notifications';
const unavailable=()=>{throw new ApiError(503,'BILLING_UNAVAILABLE','模拟账务尚未配置或暂不可用。');};
const matches=(re,value)=>typeof value==='string'&&re.exec(value)?.[0]===value;
function time(now){const at=now();if(!Number.isSafeInteger(at)||Object.is(at,-0)||at<0)unavailable();return at;}
function heldActor(db,request,options,before){
 const context=options.deviceContext;if(options.identityProviders?.deviceProofRequired!==true||!context)deviceRequired();
 const current=currentDeviceLease(db,request,time(options.now));
 if(current.userId!==context.userId||current.deviceId!==context.deviceId||current.bindingRevision!==context.bindingRevision||current.leaseId!==context.leaseId||current.stamp!==context.stamp||deviceServerId(db)!==context.serverId)deviceConflict();
 if(before&&(current.userId!==before.userId||current.token!==before.token||current.stamp!==before.stamp||current.leaseId!==before.leaseId||current.deviceId!==before.deviceId||current.bindingRevision!==before.bindingRevision||current.keyFingerprint!==before.keyFingerprint))deviceConflict();
 return current;
}
function actor(db,request,options,teamId,before){
 const current=heldActor(db,request,options,before);
 if(!administratorTechnicalEligible(db,current.userId,teamId))deny();
 return current;
}
function seatOrderingEnabled(options){
 return options.seatCapacityEnforcement==='invitation-reservations-v1';
}
function billingAccess(request,options){
 const {db,billingSimulation}=options;
 return transaction(db,()=>{
  const current=heldActor(db,request,options);
  const rows=billingSimulation&&seatOrderingEnabled(options)?db.prepare(`
   SELECT operator.team_id,profile.name FROM team_operators operator
   LEFT JOIN team_profiles profile ON profile.team_id=operator.team_id
   WHERE operator.user_id=? AND ${administratorTechnicalEligibilitySql()}
   ORDER BY operator.team_id COLLATE BINARY LIMIT 50`).all(current.userId):[];
  const teams=rows.filter(row=>matches(ID,row.team_id)).map(row=>({id:row.team_id,name:safeMemberText(row.name,row.team_id)}));
  heldActor(db,request,options,current);
  return json({teams});
 });
}
function billingOverview(db,teamId,at,billingSimulation){
 const {state,revision,startsAt,endsAt}=readSubscriptionState(db,teamId,at);
 const unitAmountMinor=billingSimulation.annualSeatUnitAmountMinor;
 const renewalSeats=unitAmountMinor===undefined?null:{
  ...readAnnualSeatRenewalDefaults(db,teamId,at),unitAmountMinor,currency:'CNY',
 };
 const seatOffer=billingSimulation.seatOffer?{...billingSimulation.seatOffer,product:SEAT_PRODUCT}:null;
 return json({
  teamId,simulation:true,subscription:{state,revision,startsAt,endsAt},
  seats:readSeatCapacity(db,teamId,at),
  annualOffers:renewalSeats?billingSimulation.offers:[],renewalSeats,seatOffer,
  canReconcile:typeof billingSimulation.lookupPayment==='function',
 });
}
function renewalSeatSelectionMatches(order,selectedSeats){
 const plan=order.renewalSeats;
 if(!plan)return selectedSeats===undefined;
 return (selectedSeats??plan.defaultSeats)===plan.selectedSeats;
}
function settle(db,receipt,now,options){
 if(receipt.product===SEAT_PRODUCT){
  if(!seatOrderingEnabled(options))unavailable();
  recordVerifiedSeatPayment(db,receipt,{now});
  return fulfilSeatOrder(db,receipt.orderId,{now});
 }
 recordVerifiedAnnualPayment(db,receipt,{now});
 return fulfilAnnualOrder(db,receipt.orderId,{now});
}
export async function handleBillingSimulationNotification(request,options={}){
 const {db,now=Date.now,billingSimulation}=options;
 const url=new URL(request.url);if(url.pathname!==SIMULATION_NOTIFICATION_PATH)return null;
 if(url.search||url.hash||url.href.endsWith('?'))invalid();
 if(request.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'POST'});
 if(!billingSimulation)unavailable();
 const receipt=await readSimulationPaymentRequest(request,billingSimulation);
 settle(db,receipt,now,options);return json({accepted:true,simulation:true});
}
function page(url){
 for(const name of url.searchParams.keys())if(!['after','limit'].includes(name)||url.searchParams.getAll(name).length!==1)invalid();
 const after=url.searchParams.get('after'),raw=url.searchParams.get('limit');
 if(after!==null&&!matches(UUID,after)||raw!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(raw))invalid();
 return{after,limit:raw===null?20:Number(raw)};
}
async function lookup(configuration,order){
 if(typeof configuration.lookupPayment!=='function')unavailable();
 const controller=new AbortController();let timer;
 try{return await Promise.race([
  Promise.resolve().then(()=>configuration.lookupPayment(Object.freeze({...order}),{signal:controller.signal})),
  new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Gateway timeout'));},5000);}),
 ]);}catch{unavailable();}finally{clearTimeout(timer);}
}
export async function handleBillingRequest(request,options={}){
 const url=new URL(request.url);
 if(url.pathname==='/api/auth/billing/access'){
  if(url.search||url.hash||url.href.endsWith('?'))invalid();
  if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
  return billingAccess(request,{...options,now:options.now??Date.now});
 }
 const match=/^\/api\/teams\/([^/]+)\/billing\/(offers|orders|seats|seat-offer|seat-orders|renewal-seats|overview)(?:\/([^/]+)(\/reconcile)?)?$/.exec(url.pathname);
 if(!match)return null;
 const [,teamId,kind,orderId,reconcile]=match;
 const isSeatOrder=kind==='seat-orders',isOrder=kind==='orders'||isSeatOrder;
 if(!matches(ID,teamId)||orderId&&(!isOrder||!matches(UUID,orderId)))deny();
 if(url.hash||url.href.endsWith('?')||(!isOrder||orderId)&&url.search)invalid();
 const {db,billingSimulation,now=Date.now}=options,currentOptions={...options,now};
 const initial=actor(db,request,currentOptions,teamId);
 if(kind==='seats'||isSeatOrder||kind==='seat-offer'||kind==='renewal-seats'||kind==='overview'){
  if(!seatOrderingEnabled(options))unavailable();
 }
 if(kind!=='seats'&&!billingSimulation)unavailable();
 const allowed=reconcile?'POST':isOrder&&!orderId?'GET, POST':'GET';
 if(!allowed.split(', ').includes(request.method))return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allowed});
 const scoped=action=>transaction(db,()=>{const current=actor(db,request,currentOptions,teamId,initial),result=action(current);actor(db,request,currentOptions,teamId,current);return result;});
 if(kind==='seats')return scoped(()=>json({seats:readSeatCapacity(db,teamId,time(now))}));
 if(kind==='overview')return scoped(()=>billingOverview(db,teamId,time(now),billingSimulation));
 if(kind==='offers')return scoped(()=>json({simulation:true,offers:billingSimulation.offers}));
 if(kind==='renewal-seats')return scoped(()=>{
  const unitAmountMinor=billingSimulation.annualSeatUnitAmountMinor;
  if(unitAmountMinor===undefined)unavailable();
  const defaults=readAnnualSeatRenewalDefaults(db,teamId,time(now));
  return json({simulation:true,renewalSeats:{...defaults,unitAmountMinor,currency:'CNY'}});
 });
 if(kind==='seat-offer')return scoped(()=>{
  if(!billingSimulation.seatOffer)unavailable();
  return json({simulation:true,offer:{...billingSimulation.seatOffer,product:SEAT_PRODUCT}});
 });
 const readOrder=isSeatOrder?readSeatOrder:readAnnualOrder;
 const readOrderRequest=isSeatOrder?readSeatOrderRequest:readAnnualOrderRequest;
 const listOrders=isSeatOrder?listSeatOrders:listAnnualOrders;
 if(reconcile){
  await readJson(request,[]);
  const order=scoped(()=>{const found=readOrder(db,teamId,orderId);if(!found)deny();return found;});
  const envelope=await lookup(billingSimulation,order);
  const receipt=envelope===null?null:verifySimulationPaymentEnvelope(envelope?.body,envelope?.signature,billingSimulation);
  if(receipt&&(receipt.orderId!==orderId||receipt.product!==(isSeatOrder?SEAT_PRODUCT:ANNUAL_PRODUCT)))invalid();
  scoped(()=>{if(!readOrder(db,teamId,orderId))deny();});
  if(receipt)settle(db,receipt,now,options);
  return scoped(()=>json({simulation:true,order:readOrder(db,teamId,orderId)}));
 }
 if(orderId)return scoped(()=>{const order=readOrder(db,teamId,orderId);if(!order)deny();return json({simulation:true,order});});
 if(request.method==='GET'){
  const query=page(url);return scoped(()=>{const result=listOrders(db,teamId,query);return json({simulation:true,...result,nextCursor:result.hasMore?result.orders.at(-1).id:null});});
 }
 if(url.search)invalid();
 const input=await readJson(request,['requestId','offerId','offerRevision',isSeatOrder?'quantity':'selectedSeats']);
 if(!matches(UUID,input.requestId)||!matches(ID,input.offerId)||!Number.isSafeInteger(input.offerRevision)||input.offerRevision<1)invalid();
 if(isSeatOrder&&(!Number.isSafeInteger(input.quantity)||input.quantity<1||input.quantity>1000))invalid();
 if(!isSeatOrder&&input.selectedSeats!==undefined&&
    (!Number.isSafeInteger(input.selectedSeats)||input.selectedSeats<0||Object.is(input.selectedSeats,-0)))invalid();
 return scoped(current=>{
  const existing=readOrderRequest(db,teamId,current.userId,input.requestId);
  if(existing){
   const selectionMatches=isSeatOrder?existing.quantity===input.quantity:renewalSeatSelectionMatches(existing,input.selectedSeats);
   if(existing.offer.id!==input.offerId||existing.offer.revision!==input.offerRevision||!selectionMatches)throw new ApiError(409,'BILLING_OFFER_CHANGED','模拟方案已改变，请重新核对。');
   return json({simulation:true,order:existing},201);
  }
  const offer=isSeatOrder?billingSimulation.seatOffer:billingSimulation.offers.find(x=>x.id===input.offerId&&x.revision===input.offerRevision);
  if(!offer||offer.id!==input.offerId||offer.revision!==input.offerRevision)throw new ApiError(409,'BILLING_OFFER_CHANGED','模拟方案已改变，请重新核对。');
  const orderInput={teamId,actorId:current.userId,requestId:input.requestId,merchantId:billingSimulation.merchantId,offer};
  if(isSeatOrder){
   const order=createSeatOrderWithinTransaction(db,{...orderInput,quantity:input.quantity},{now});
   return json({simulation:true,order},201);
  }
  const unitAmountMinor=billingSimulation.annualSeatUnitAmountMinor;
  if(input.selectedSeats!==undefined&&unitAmountMinor===undefined)unavailable();
  const renewalSeats=unitAmountMinor===undefined?undefined:{unitAmountMinor,
   ...(input.selectedSeats===undefined?{}:{selectedSeats:input.selectedSeats})};
  const order=createAnnualOrderWithinTransaction(db,orderInput,{now,renewalSeats});
  return json({simulation:true,order},201);
 });
}
