import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
import {UUID,currentDeviceLease,deviceServerId,deviceConflict,deviceRequired} from './device-policy.mjs';
import {administratorTechnicalEligible,administratorTechnicalEligibilitySql} from './administrator-business-role-policy.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {createAnnualOrderWithinTransaction,readAnnualOrder,readAnnualOrderRequest,listAnnualOrders,recordVerifiedAnnualPayment,fulfilAnnualOrder,readAnnualSeatRenewalDefaults} from './billing-store.mjs';
import {createSeatOrderWithinTransaction,readSeatOrder,readSeatOrderRequest,listSeatOrders,recordVerifiedSeatPayment,fulfilSeatOrder} from './seat-order-store.mjs';
import {ANNUAL_PRODUCT,SEAT_PRODUCT,readSimulationPaymentRequest,verifySimulationPaymentEnvelope} from './billing-simulation.mjs';
import {readSimulationPaymentExceptionRequest,verifySimulationPaymentExceptionEnvelope} from './billing-payment-exception.mjs';
import {recordVerifiedBillingPaymentException,recordVerifiedBillingPaymentExceptionWithinTransaction} from './billing-payment-exception-store.mjs';
import {readSimulationOrderClosureRequest,verifySimulationOrderClosureEnvelope} from './billing-order-closure.mjs';
import {recordVerifiedBillingOrderClosure,recordVerifiedBillingOrderClosureWithinTransaction} from './billing-order-closure-store.mjs';
import {readSeatCapacity} from './seat-capacity-store.mjs';
import {readSubscriptionState} from './subscription-store.mjs';
import {currentTermIsPilot} from './pilot-approval.mjs';
import {openBillingBatchReceipt,recordBillingBatchVerification,assertBillingBatchVerification,
 finishBillingBatchItem} from './billing-batch-receipt-store.mjs';

export const SIMULATION_NOTIFICATION_PATH='/api/billing/simulation/notifications';
export const SIMULATION_PAYMENT_EXCEPTION_PATH='/api/billing/simulation/payment-exceptions';
export const SIMULATION_ORDER_CLOSURE_PATH='/api/billing/simulation/order-closures';
const RECONCILIATION_PAGE_SIZE=8;
const RECEIPT_WRITE_FAILED='BILLING_RECONCILIATION_RECEIPT_FAILED';
const MS_PER_DAY=86_400_000,RENEWAL_REMINDER_DAYS=30;
const reconcilingTeams=new WeakMap();
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
function billingOverviewEnabled(options){
 return seatOrderingEnabled(options)&&(options.serviceMode==='managed-service'||!!options.billingSimulation);
}
function billingAccess(request,options){
 const {db}=options;
 return transaction(db,()=>{
  const current=heldActor(db,request,options);
  const rows=billingOverviewEnabled(options)?db.prepare(`
   SELECT operator.team_id,profile.name FROM team_operators operator
   LEFT JOIN team_profiles profile ON profile.team_id=operator.team_id
   WHERE operator.user_id=? AND ${administratorTechnicalEligibilitySql()}
   ORDER BY operator.team_id COLLATE BINARY LIMIT 50`).all(current.userId):[];
  const teams=rows.filter(row=>matches(ID,row.team_id)).map(row=>({id:row.team_id,name:safeMemberText(row.name,row.team_id)}));
  heldActor(db,request,options,current);
  return json({teams});
 });
}
function billingOverview(db,teamId,at,billingSimulation,{expiryReminder,resumeFulfilment,resumeBatch,pilotSource,websiteCheckout,nativeCheckout}){
 const current=readSubscriptionState(db,teamId,at),{state,revision,startsAt,endsAt}=current;
 const subscription={state,revision,startsAt,endsAt},remaining=endsAt-at;
 if(pilotSource&&!billingSimulation&&currentTermIsPilot(db,current))subscription.pilot=true;
 if(expiryReminder&&state==='active'&&remaining>0&&remaining<=RENEWAL_REMINDER_DAYS*MS_PER_DAY){
  subscription.renewalReminderDays=Math.ceil(remaining/MS_PER_DAY);
 }
 const summary={teamId,subscription,seats:readSeatCapacity(db,teamId,at)};
 if(!billingSimulation)return json({...summary,simulation:false,...(nativeCheckout?{nativeCheckout}:{})});
 const unitAmountMinor=billingSimulation.annualSeatUnitAmountMinor;
 const renewalSeats=unitAmountMinor===undefined?null:{
  ...readAnnualSeatRenewalDefaults(db,teamId,at),unitAmountMinor,currency:'CNY',
 };
 const seatOffer=billingSimulation.seatOffer?{...billingSimulation.seatOffer,product:SEAT_PRODUCT}:null;
 const canReconcile=typeof billingSimulation.lookupPayment==='function';
 return json({
  ...summary,simulation:true,
  annualOffers:renewalSeats?billingSimulation.offers:[],renewalSeats,seatOffer,
  canReconcile,
  ...(websiteCheckout?{websiteCheckout:true}:{}),
  ...(resumeFulfilment?{canResumeFulfilment:true}:{}),
  ...(billingSimulation.paymentExceptions&&canReconcile?{canReconcilePaymentExceptions:true}:{}),
  ...(billingSimulation.batchReconciliation&&canReconcile?{canReconcileBillingBatch:true}:{}),
  ...(resumeBatch&&billingSimulation.batchReconciliationReceipts?{canResumeBillingBatch:true}:{}),
 });
}
function renewalSeatSelectionMatches(order,selectedSeats){
 const plan=order.renewalSeats;
 if(!plan)return selectedSeats===undefined;
 return (selectedSeats??plan.defaultSeats)===plan.selectedSeats;
}
function recordCapture(db,receipt,now,options,authorize,onRecorded){
 const seat=receipt.product===SEAT_PRODUCT;
 if(seat&&!seatOrderingEnabled(options))unavailable();
 const record=seat?recordVerifiedSeatPayment:recordVerifiedAnnualPayment;
 return record(db,receipt,{now,authorize,onRecorded});
}
function fulfilCapture(db,receipt,now,authorize){
 const fulfil=receipt.product===SEAT_PRODUCT?fulfilSeatOrder:fulfilAnnualOrder;
 try{
  fulfil(db,receipt.orderId,{now,authorize});
 }catch(error){
  // These conflicts are backed by durable evidence. Acknowledge the matched
  // late capture and leave entitlement fulfilment for review.
  if(!(error instanceof ApiError&&['BILLING_PAYMENT_EXCEPTION_REVIEW_REQUIRED','BILLING_ORDER_CLOSED_REVIEW_REQUIRED'].includes(error.code)))throw error;
 }
}
function settle(db,receipt,now,options,authorize){
 recordCapture(db,receipt,now,options,authorize);
 fulfilCapture(db,receipt,now,authorize);
}
export async function handleBillingSimulationNotification(request,options={}){
 const {db,now=Date.now,billingSimulation}=options;
 const url=new URL(request.url),exception=url.pathname===SIMULATION_PAYMENT_EXCEPTION_PATH,closure=url.pathname===SIMULATION_ORDER_CLOSURE_PATH;
 if(!exception&&!closure&&url.pathname!==SIMULATION_NOTIFICATION_PATH)return null;
 if(url.search||url.hash||url.href.endsWith('?'))invalid();
 if(request.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'POST'});
 if(!billingSimulation||exception&&billingSimulation.paymentExceptions!==true||closure&&!billingSimulation.timeoutClosure)unavailable();
 if(closure){
  const receipt=await readSimulationOrderClosureRequest(request,billingSimulation);
  if(receipt.product===SEAT_PRODUCT&&!seatOrderingEnabled(options))unavailable();
  recordVerifiedBillingOrderClosure(db,receipt,{now});
 }else if(exception){
  const receipt=await readSimulationPaymentExceptionRequest(request,billingSimulation);
  if(receipt.product===SEAT_PRODUCT&&!seatOrderingEnabled(options))unavailable();
  recordVerifiedBillingPaymentException(db,receipt,{now});
 }else{
  const receipt=await readSimulationPaymentRequest(request,billingSimulation);
  settle(db,receipt,now,options);
 }
 return json({accepted:true,simulation:true});
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
function lookupEvidence(configuration,envelope,orderId,product){
 if(envelope===null)return null;
 const exception=envelope?.kind==='payment-exception';
 const closure=envelope?.kind==='order-closure';
 if(exception&&configuration.paymentExceptions!==true)unavailable();
 if(closure&&!configuration.timeoutClosure)unavailable();
 const verify=closure?verifySimulationOrderClosureEnvelope:exception?verifySimulationPaymentExceptionEnvelope:verifySimulationPaymentEnvelope;
 const receipt=verify(envelope?.body,envelope?.signature,configuration);
 if(receipt.orderId!==orderId||receipt.product!==product)invalid();
 const record=closure?recordVerifiedBillingOrderClosureWithinTransaction:exception?recordVerifiedBillingPaymentExceptionWithinTransaction:null;
 return {record,closure,receipt};
}
const rejectedWrite=error=>error instanceof ApiError&&error.status<500?'evidence-rejected':'local-failure';

function applyBatchLookup(result,order,context){
 const {db,options,now,product,scoped,authorize}=context;
 if(result.status==='rejected')return 'lookup-unavailable';
 let evidence;
 try{evidence=lookupEvidence(options.billingSimulation,result.value,order.id,product);}
 catch{return 'evidence-rejected';}
 if(!evidence)return 'no-evidence';
 if(evidence.record){
  try{scoped(()=>evidence.record(db,evidence.receipt,{now}));}
  catch(error){return rejectedWrite(error);}
  return evidence.closure?'inspect-closure':'awaiting-review';
 }
 try{recordCapture(db,evidence.receipt,now,options,authorize);}
 catch(error){return rejectedWrite(error);}
 try{fulfilCapture(db,evidence.receipt,now,authorize);}
 catch(error){
  // Expected settlement conflicts leave the verified fact for a review.
  return error instanceof ApiError&&error.status===409?'inspect-capture':'local-failure';
 }
 return 'inspect-capture';
}

function batchItemResult(current,outcome){
 const {id:orderId,status}=current;
 const paymentException=!!current.paymentException;
 if(outcome==='inspect-capture'){
  if(paymentException||status==='payment-verified')outcome='awaiting-review';
  else outcome=status==='paid'?'matched':'local-failure';
 }
 if(outcome==='inspect-closure'){
  if(status==='closed')outcome='closed';
  else outcome=status==='payment-verified'?'awaiting-review':'local-failure';
 }
 return {orderId,outcome,status,paymentException};
}

function writeReceiptProgress(action){
 try{return action();}
 catch{throw new ApiError(503,RECEIPT_WRITE_FAILED,'暂时无法保存对账进度，请重试原批次。');}
}

async function reconcileRecordedBatch(input,{db,teamId,options,now,scoped,authorize,list,read,product}){
 const {billingSimulation}=options,{kind,requestId}=input,after=input.after??null;
 const {scope,items,nextCursor,orders}=scoped(({userId:actorId})=>{
  const scope={teamId,actorId,requestId,kind,after,merchantId:billingSimulation.merchantId};
  const selection=openBillingBatchReceipt(db,scope,()=>list(db,teamId,{limit:RECONCILIATION_PAGE_SIZE,after}),time(now));
  const orders=selection.items.filter(item=>item.progress==='pending').map(item=>{
   const order=read(db,teamId,item.orderId);if(!order)deny();return order;
  });
  return {scope,...selection,orders};
 });
 const found=await Promise.allSettled(orders.map(order=>lookup(billingSimulation,order)));
 const evidenceByOrder=new Map(orders.map((order,index)=>[order.id,found[index]]));
 const fulfil=product===SEAT_PRODUCT?fulfilSeatOrder:fulfilAnnualOrder;
 const currentOrder=id=>{const order=read(db,teamId,id);if(!order)deny();return order;};
 const finish=(progress,order,outcome)=>{
  const result=batchItemResult(order,outcome);
  writeReceiptProgress(()=>finishBillingBatchItem(db,scope,progress,result,time(now)));
  return result;
 };
 function finishVerified(orderId,payment){
  // Check the pinned payment while each owned entitlement transaction holds its write lock.
  const guard=()=>{
   authorize();
   writeReceiptProgress(()=>assertBillingBatchVerification(db,scope,orderId,payment));
  };
  let result;
  try{
   fulfil(db,orderId,{now,authorize:guard,onFulfilled({order}){result=finish('verified',order,'inspect-capture');}});
   return result;
  }catch(error){
   if(!(error instanceof ApiError&&error.status===409))throw error;
   return scoped(()=>{
    guard();
    return finish('verified',currentOrder(orderId),'inspect-capture');
   });
  }
 }
 function finishPending(orderId,lookupResult){
  const terminal=outcome=>scoped(()=>finish('pending',currentOrder(orderId),outcome));
  if(lookupResult.status==='rejected')return terminal('lookup-unavailable');
  let evidence;
  try{evidence=lookupEvidence(billingSimulation,lookupResult.value,orderId,product);}
  catch{return terminal('evidence-rejected');}
  if(!evidence)return terminal('no-evidence');
  if(evidence.record){
   try{
    return scoped(()=>{
     evidence.record(db,evidence.receipt,{now});
     return finish('pending',currentOrder(orderId),evidence.closure?'inspect-closure':'awaiting-review');
    });
   }catch(error){
    if(error.code===RECEIPT_WRITE_FAILED)throw error;
    return terminal(rejectedWrite(error));
   }
  }
  let payment;
  try{
   recordCapture(db,evidence.receipt,now,options,authorize,({paymentId,receiptSha256,confirmedAt})=>{
    authorize();
    payment={paymentId,receiptSha256,confirmedAt};
    writeReceiptProgress(()=>recordBillingBatchVerification(db,scope,orderId,payment,time(now)));
   });
  }catch(error){
   if(error.code===RECEIPT_WRITE_FAILED)throw error;
   return terminal(rejectedWrite(error));
  }
  return finishVerified(orderId,payment);
 }
 const results=[];
 for(const item of items){
  authorize();
  if(item.progress==='complete')results.push(item.result);
  else if(item.progress==='verified')results.push(finishVerified(item.orderId,item.payment));
  else results.push(finishPending(item.orderId,evidenceByOrder.get(item.orderId)));
 }
 return scoped(()=>json({simulation:true,teamId,kind,results,nextCursor}));
}

async function reconcileBatch(request,{db,teamId,options,now,scoped,authorize}){
 const {billingSimulation}=options;
 if(billingSimulation.batchReconciliation!==true)unavailable();
 const input=await readJson(request,billingSimulation.batchReconciliationReceipts?['kind','after','requestId']:['kind','after']);
 if(!['annual','seat'].includes(input.kind)||(input.after!==undefined&&!matches(UUID,input.after))||
    (input.requestId!==undefined&&!matches(UUID,input.requestId)))invalid();
 const seat=input.kind==='seat';
 if(seat&&!seatOrderingEnabled(options))unavailable();
 const list=seat?listSeatOrders:listAnnualOrders,read=seat?readSeatOrder:readAnnualOrder;
 const product=seat?SEAT_PRODUCT:ANNUAL_PRODUCT;
 let active=reconcilingTeams.get(db);
 if(!active){active=new Set();reconcilingTeams.set(db,active);}
 // Concurrent requests from separate teams do not share a cursor or block each other.
 if(active.has(teamId))throw new ApiError(409,'BILLING_RECONCILIATION_BUSY','该团队已有一批账务正在核对。');
 active.add(teamId);
 try{
  if(input.requestId!==undefined){
   return await reconcileRecordedBatch(input,{db,teamId,options,now,scoped,authorize,list,read,product});
  }
  const {orders,hasMore}=scoped(()=>list(db,teamId,{limit:RECONCILIATION_PAGE_SIZE,after:input.after??null}));
  const found=await Promise.allSettled(orders.map(order=>lookup(billingSimulation,order)));
  const results=[];
  for(const [index,order] of orders.entries()){
   authorize();
   const outcome=applyBatchLookup(found[index],order,{db,options,now,product,scoped,authorize});
   const current=scoped(()=>read(db,teamId,order.id));
   if(!current)deny();
   results.push(batchItemResult(current,outcome));
  }
  return scoped(()=>json({simulation:true,teamId,kind:input.kind,results,nextCursor:hasMore?orders.at(-1).id:null}));
 }finally{active.delete(teamId);}
}
export async function handleBillingRequest(request,options={}){
 const url=new URL(request.url);
 if(url.pathname==='/api/auth/billing/access'){
  if(url.search||url.hash||url.href.endsWith('?'))invalid();
  if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
  return billingAccess(request,{...options,now:options.now??Date.now});
 }
 const match=/^\/api\/teams\/([^/]+)\/billing\/(offers|orders|seats|seat-offer|seat-orders|renewal-seats|overview|reconciliation|native-orders)(?:\/([^/]+)(?:\/(reconcile|resume-fulfilment))?)?$/.exec(url.pathname);
 if(!match)return null;
 const [,teamId,kind,orderId,action]=match;
 const isSeatOrder=kind==='seat-orders',isOrder=kind==='orders'||isSeatOrder,isNativeHistory=kind==='native-orders';
 if(!matches(ID,teamId)||orderId&&(!isOrder||!matches(UUID,orderId)))deny();
 if(url.hash||url.href.endsWith('?')||(!isOrder&&!isNativeHistory||orderId)&&url.search)invalid();
 const {db,billingSimulation,now=Date.now}=options,currentOptions={...options,now};
 const initial=actor(db,request,currentOptions,teamId);
 const authorize=()=>actor(db,request,currentOptions,teamId,initial);
 const scoped=action=>transaction(db,()=>{const current=authorize(),result=action(current);authorize();return result;});
 if(isNativeHistory){
  if(options.serviceMode!=='managed-service'||typeof options.nativeWebsitePayment?.listOrders!=='function')deny();
  if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
  const query=page(url);
  return scoped(current=>json(options.nativeWebsitePayment.listOrders({teamId,actorId:current.userId,...query})));
 }
 if(kind==='seats'||isSeatOrder||kind==='seat-offer'||kind==='renewal-seats'){
  if(!seatOrderingEnabled(options))unavailable();
 }
 if(kind==='overview'){
  if(!billingOverviewEnabled(options))unavailable();
 }else if(kind!=='seats'&&!billingSimulation)unavailable();
 const reconcilesExistingOrders=kind==='reconciliation'||action==='reconcile'||action==='resume-fulfilment';
 const allowed=reconcilesExistingOrders?'POST':isOrder&&!orderId?'GET, POST':'GET';
 if(!allowed.split(', ').includes(request.method))return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allowed});
 if(options.websiteCheckoutActive&&request.method==='POST'&&!reconcilesExistingOrders)throw new ApiError(403,'WEBSITE_CHECKOUT_REQUIRED','请在官网候选订单页操作。');
 if(kind==='reconciliation')return reconcileBatch(request,{db,teamId,options:currentOptions,now,scoped,authorize});
 if(kind==='seats')return scoped(()=>json({seats:readSeatCapacity(db,teamId,time(now))}));
 if(kind==='overview')return scoped(()=>billingOverview(db,teamId,time(now),billingSimulation,{
  expiryReminder:request.headers.get('X-Shenyi-Billing-View')==='expiry-reminder-v1',
  resumeFulfilment:request.headers.get('X-Shenyi-Billing-Recovery')==='recorded-payment-v1',
  resumeBatch:request.headers.get('X-Shenyi-Billing-Batch')==='resumable-v1',
  pilotSource:options.serviceMode==='managed-service'&&request.headers.get('X-Shenyi-Billing-Source')==='approved-pilot-v1',
  websiteCheckout:options.websiteCheckoutActive&&request.headers.get('X-Shenyi-Website-Checkout')==='candidate-v1',
  nativeCheckout:options.serviceMode==='managed-service'&&options.nativeWebsitePayment&&
   request.headers.get('X-Shenyi-Native-Checkout')==='native-v1'
   ?{canPurchase:options.nativeWebsitePayment.canPurchase===true,
    ...(request.headers.get('X-Shenyi-Native-Order-History')==='v1'&&typeof options.nativeWebsitePayment.listOrders==='function'
      ?{orderHistory:true}:{})}:undefined,
 }));
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
 if(action){
  await readJson(request,[]);
  if(action==='resume-fulfilment'){
   const fulfil=isSeatOrder?fulfilSeatOrder:fulfilAnnualOrder;
   // The store owns the write transaction and checks both guards inside it.
   const {order}=fulfil(db,orderId,{now,authorize(){
    authorize();
    if(!readOrder(db,teamId,orderId))deny();
   }});
   return json({simulation:true,order});
  }
  const order=scoped(()=>{const found=readOrder(db,teamId,orderId);if(!found)deny();return found;});
  const evidence=lookupEvidence(billingSimulation,await lookup(billingSimulation,order),orderId,isSeatOrder?SEAT_PRODUCT:ANNUAL_PRODUCT);
  if(evidence?.record){
   return scoped(()=>{
    if(!readOrder(db,teamId,orderId))deny();
    evidence.record(db,evidence.receipt,{now});
    return json({simulation:true,order:readOrder(db,teamId,orderId)});
   });
  }
  scoped(()=>{if(!readOrder(db,teamId,orderId))deny();});
  if(evidence)settle(db,evidence.receipt,now,options,authorize);
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
  const order=createAnnualOrderWithinTransaction(db,orderInput,{now,renewalSeats,
   closeAfterMs:billingSimulation.timeoutClosure?.annualTimeoutMs});
  return json({simulation:true,order},201);
 });
}
