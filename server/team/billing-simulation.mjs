import {createHmac,timingSafeEqual} from 'node:crypto';
import {types} from 'node:util';
import {ApiError,ID,invalid} from './http-utils.mjs';

// Server-only synthetic gateway. No merchant adapter, real checkout or client key.
const DOMAIN='shenyi.billing.simulation.v1\0',MAX_BODY=16384;
export const ANNUAL_PRODUCT='team-annual-renewal';
export const SEAT_PRODUCT='team-seat-addition';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECEIPT=['protocol','merchantId','eventId','transactionId','orderId','product','amountMinor','currency','status','paidAt'];
const integer=(v,min=0)=>typeof v==='number'&&Number.isSafeInteger(v)&&!Object.is(v,-0)&&v>=min;
const matches=(re,v)=>typeof v==='string'&&re.exec(v)?.[0]===v;
function fields(value,required,optional=[]){
 if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)invalid();
 const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);
 if(required.some(k=>!Object.hasOwn(ds,k))||keys.some(k=>typeof k!=='string'||![...required,...optional].includes(k)||!ds[k].enumerable||!Object.hasOwn(ds[k],'value')))invalid();
 return Object.fromEntries(keys.map(k=>[k,ds[k].value]));
}
export function billingSimulationConfiguration(value=null,{subscriptionEnforcement,identityProviders,seatCapacityEnforcement}={}){
 if(value===null)return null;
 try{
  const v=fields(value,['mode','merchantId','signingKey','offers'],['lookupPayment','seatOffer','annualSeatUnitAmountMinor','paymentExceptions','batchReconciliation','batchReconciliationReceipts','refundIntake','timeoutClosure']);
  if(v.mode!=='simulation-v1'||!matches(ID,v.merchantId)||types.isProxy(v.signingKey)||!Buffer.isBuffer(v.signingKey)||v.signingKey.length<32||v.signingKey.length>128||subscriptionEnforcement!=='team-management-v1'||identityProviders?.deviceProofRequired!==true)throw Error();
  if(!Array.isArray(v.offers)||types.isProxy(v.offers)||Object.getPrototypeOf(v.offers)!==Array.prototype||v.offers.length<1||v.offers.length>10)throw Error();
  const ds=Object.getOwnPropertyDescriptors(v.offers);
  if(Reflect.ownKeys(ds).length!==v.offers.length+1||Array.from({length:v.offers.length},(_,i)=>String(i)).some(k=>!Object.hasOwn(ds,k)||!Object.hasOwn(ds[k],'value')))throw Error();
  const offers=v.offers.map(raw=>{
   const offer=fields(raw,['id','revision','product','amountMinor','currency']);
   if(!matches(ID,offer.id)||!integer(offer.revision,1)||offer.product!=='team-annual-renewal'||!integer(offer.amountMinor,1)||offer.currency!=='CNY')throw Error();
   return Object.freeze(offer);
  });
  if(new Set(offers.map(x=>x.id)).size!==offers.length||v.lookupPayment!==undefined&&typeof v.lookupPayment!=='function')throw Error();
  let seatOffer;
  if(v.seatOffer!==undefined){
   if(seatCapacityEnforcement!=='invitation-reservations-v1')throw Error();
   const offer=fields(v.seatOffer,['id','revision','annualUnitAmountMinor','currency']);
   if(!matches(ID,offer.id)||!integer(offer.revision,1)||!integer(offer.annualUnitAmountMinor,1)||offer.currency!=='CNY')throw Error();
   seatOffer=Object.freeze(offer);
  }
  const annualSeatUnitAmountMinor=v.annualSeatUnitAmountMinor;
  if(annualSeatUnitAmountMinor!==undefined&&
     (seatCapacityEnforcement!=='invitation-reservations-v1'||!integer(annualSeatUnitAmountMinor,1)))throw Error();
  if(v.paymentExceptions!==undefined&&typeof v.paymentExceptions!=='boolean')throw Error();
  if(v.batchReconciliation!==undefined&&typeof v.batchReconciliation!=='boolean')throw Error();
  if(v.batchReconciliation===true&&typeof v.lookupPayment!=='function')throw Error();
  if(v.batchReconciliationReceipts!==undefined&&(typeof v.batchReconciliationReceipts!=='boolean'||
     v.batchReconciliationReceipts&&v.batchReconciliation!==true))throw Error();
  if(v.refundIntake!==undefined&&typeof v.refundIntake!=='boolean')throw Error();
  let timeoutClosure;
  if(v.timeoutClosure!==undefined){
   const policy=fields(v.timeoutClosure,['annualTimeoutMs']);
   if(!integer(policy.annualTimeoutMs,1)||policy.annualTimeoutMs>8640000000000000)throw Error();
   timeoutClosure=Object.freeze(policy);
  }
  return Object.freeze({mode:v.mode,merchantId:v.merchantId,signingKey:Buffer.from(v.signingKey),offers:Object.freeze(offers),
    ...(v.lookupPayment===undefined?{}:{lookupPayment:v.lookupPayment}),
    ...(seatOffer===undefined?{}:{seatOffer}),
    ...(v.paymentExceptions===true?{paymentExceptions:true}:{}),
    ...(v.batchReconciliation===true?{batchReconciliation:true}:{}),
    ...(v.batchReconciliationReceipts===true?{batchReconciliationReceipts:true}:{}),
    ...(v.refundIntake===true?{refundIntake:true}:{}),
    ...(timeoutClosure?{timeoutClosure}:{}),
    ...(annualSeatUnitAmountMinor===undefined?{}:{annualSeatUnitAmountMinor})});
 }catch{throw new TypeError('Invalid billing simulation configuration; strict management scope and synthetic offers required');}
}
export function validateSimulationPaymentReceipt(value){
 const v=fields(value,RECEIPT);
 if(v.protocol!=='shenyi-simulation-payment-v1'||!matches(ID,v.merchantId)||!matches(UUID,v.eventId)||!matches(UUID,v.transactionId)||!matches(UUID,v.orderId)||![ANNUAL_PRODUCT,SEAT_PRODUCT].includes(v.product)||!integer(v.amountMinor,1)||v.currency!=='CNY'||v.status!=='succeeded'||!integer(v.paidAt)||v.paidAt>8640000000000000)invalid();
 return Object.freeze(Object.fromEntries(RECEIPT.map(k=>[k,v[k]])));
}
export function simulationReceiptBytes(receipt){return Buffer.from(JSON.stringify(validateSimulationPaymentReceipt(receipt)));}
// Only a trusted test/source adapter should call this function with its own key.
export function signSimulationPayment(receipt,configuration){
 const body=simulationReceiptBytes(receipt);
 return Object.freeze({body,signature:createHmac('sha256',configuration.signingKey).update(DOMAIN).update(body).digest('hex')});
}
export function verifySimulationPaymentEnvelope(body,signature,configuration){
 if(types.isProxy(body)||!Buffer.isBuffer(body)||body.length>MAX_BODY)invalid();
 if(typeof signature!=='string'||signature.length!==64||!/^[0-9a-f]{64}$/.test(signature))throw new ApiError(403,'SIMULATION_SIGNATURE_REQUIRED','无法核实模拟收款通知。');
 const actual=createHmac('sha256',configuration.signingKey).update(DOMAIN).update(body).digest();
 if(!timingSafeEqual(actual,Buffer.from(signature,'hex')))throw new ApiError(403,'SIMULATION_SIGNATURE_REQUIRED','无法核实模拟收款通知。');
 let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{invalid();}
 const receipt=validateSimulationPaymentReceipt(parsed);
 if(receipt.merchantId!==configuration.merchantId||!body.equals(simulationReceiptBytes(receipt)))invalid();
 return receipt;
}
export async function readSimulationPaymentRequest(request,configuration){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))throw new ApiError(415,'JSON_REQUIRED','请使用JSON格式。');
 const length=request.headers.get('Content-Length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY))throw new ApiError(413,'TOO_LARGE','资料超过大小限制。');
 const reader=request.body?.getReader();if(!reader)invalid();
 const chunks=[];let total=0;
 for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>MAX_BODY){await reader.cancel();throw new ApiError(413,'TOO_LARGE','资料超过大小限制。');}chunks.push(part.value);}
 return verifySimulationPaymentEnvelope(Buffer.concat(chunks),request.headers.get('X-Shenyi-Simulation-Signature'),configuration);
}
