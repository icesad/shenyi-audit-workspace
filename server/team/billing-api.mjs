import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
import {UUID,currentDeviceLease,deviceServerId,deviceConflict,deviceRequired} from './device-policy.mjs';
import {administratorTechnicalEligible} from './administrator-business-role-policy.mjs';
import {createAnnualOrderWithinTransaction,readAnnualOrder,readAnnualOrderRequest,listAnnualOrders,recordVerifiedAnnualPayment,fulfilAnnualOrder} from './billing-store.mjs';
import {readSimulationPaymentRequest,verifySimulationPaymentEnvelope} from './billing-simulation.mjs';

export const SIMULATION_NOTIFICATION_PATH='/api/billing/simulation/notifications';
const unavailable=()=>{throw new ApiError(503,'BILLING_UNAVAILABLE','模拟账务尚未配置或暂不可用。');};
const matches=(re,value)=>typeof value==='string'&&re.exec(value)?.[0]===value;
function time(now){const at=now();if(!Number.isSafeInteger(at)||Object.is(at,-0)||at<0)unavailable();return at;}
function actor(db,request,options,teamId,before){
 const context=options.deviceContext;if(options.identityProviders?.deviceProofRequired!==true||!context)deviceRequired();
 const current=currentDeviceLease(db,request,time(options.now));
 if(current.userId!==context.userId||current.deviceId!==context.deviceId||current.bindingRevision!==context.bindingRevision||current.leaseId!==context.leaseId||current.stamp!==context.stamp||deviceServerId(db)!==context.serverId)deviceConflict();
 if(before&&(current.userId!==before.userId||current.token!==before.token||current.stamp!==before.stamp||current.leaseId!==before.leaseId||current.deviceId!==before.deviceId||current.bindingRevision!==before.bindingRevision||current.keyFingerprint!==before.keyFingerprint))deviceConflict();
 if(!administratorTechnicalEligible(db,current.userId,teamId))deny();return current;
}
function settle(db,receipt,now){recordVerifiedAnnualPayment(db,receipt,{now});return fulfilAnnualOrder(db,receipt.orderId,{now});}
export async function handleBillingSimulationNotification(request,{db,now=Date.now,billingSimulation}={}){
 const url=new URL(request.url);if(url.pathname!==SIMULATION_NOTIFICATION_PATH)return null;
 if(url.search||url.hash||url.href.endsWith('?'))invalid();
 if(request.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'POST'});
 if(!billingSimulation)unavailable();
 const receipt=await readSimulationPaymentRequest(request,billingSimulation);
 settle(db,receipt,now);return json({accepted:true,simulation:true});
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
 const url=new URL(request.url),match=/^\/api\/teams\/([^/]+)\/billing\/(offers|orders)(?:\/([^/]+)(\/reconcile)?)?$/.exec(url.pathname);
 if(!match)return null;
 const [,teamId,kind,orderId,reconcile]=match;
 if(!matches(ID,teamId)||orderId&&!matches(UUID,orderId)||kind==='offers'&&orderId)deny();
 if(url.hash||url.href.endsWith('?')||(kind==='offers'||orderId)&&url.search)invalid();
 const {db,billingSimulation,now=Date.now}=options,currentOptions={...options,now};
 const initial=actor(db,request,currentOptions,teamId);if(!billingSimulation)unavailable();
 const allowed=reconcile?'POST':kind==='orders'&&!orderId?'GET, POST':'GET';
 if(!allowed.split(', ').includes(request.method))return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allowed});
 const scoped=action=>transaction(db,()=>{const current=actor(db,request,currentOptions,teamId,initial),result=action(current);actor(db,request,currentOptions,teamId,current);return result;});
 if(kind==='offers')return scoped(()=>json({simulation:true,offers:billingSimulation.offers}));
 if(reconcile){
  await readJson(request,[]);
  const order=scoped(()=>{const found=readAnnualOrder(db,teamId,orderId);if(!found)deny();return found;});
  const envelope=await lookup(billingSimulation,order);
  const receipt=envelope===null?null:verifySimulationPaymentEnvelope(envelope?.body,envelope?.signature,billingSimulation);
  if(receipt&&receipt.orderId!==orderId)invalid();
  scoped(()=>{if(!readAnnualOrder(db,teamId,orderId))deny();});
  if(receipt)settle(db,receipt,now);
  return scoped(()=>json({simulation:true,order:readAnnualOrder(db,teamId,orderId)}));
 }
 if(orderId)return scoped(()=>{const order=readAnnualOrder(db,teamId,orderId);if(!order)deny();return json({simulation:true,order});});
 if(request.method==='GET'){
  const query=page(url);return scoped(()=>{const result=listAnnualOrders(db,teamId,query);return json({simulation:true,...result,nextCursor:result.hasMore?result.orders.at(-1).id:null});});
 }
 if(url.search)invalid();
 const input=await readJson(request,['requestId','offerId','offerRevision']);
 if(!matches(UUID,input.requestId)||!matches(ID,input.offerId)||!Number.isSafeInteger(input.offerRevision)||input.offerRevision<1)invalid();
 return scoped(current=>{
  const existing=readAnnualOrderRequest(db,teamId,current.userId,input.requestId);
  if(existing){
   if(existing.offer.id!==input.offerId||existing.offer.revision!==input.offerRevision)throw new ApiError(409,'BILLING_OFFER_CHANGED','模拟方案已改变，请重新核对。');
   return json({simulation:true,order:existing},201);
  }
  const offer=billingSimulation.offers.find(x=>x.id===input.offerId&&x.revision===input.offerRevision);
  if(!offer)throw new ApiError(409,'BILLING_OFFER_CHANGED','模拟方案已改变，请重新核对。');
  const order=createAnnualOrderWithinTransaction(db,{teamId,actorId:current.userId,requestId:input.requestId,merchantId:billingSimulation.merchantId,offer},{now});
  return json({simulation:true,order},201);
 });
}
