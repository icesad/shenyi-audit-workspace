import {createHmac,timingSafeEqual} from 'node:crypto';
import {types} from 'node:util';
import {ApiError,ID,invalid} from './http-utils.mjs';
import {ANNUAL_PRODUCT,SEAT_PRODUCT} from './billing-simulation.mjs';

const DOMAIN='shenyi.billing.simulation.closure.v1\0';
const MAX_BODY=16384;
const MAX_TIME=8640000000000000;
const PROTOCOL='shenyi-simulation-order-closure-v1';
const FIELDS=['protocol','merchantId','eventId','orderId','product','amountMinor','currency','status','closedAt'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SIG=/^[0-9a-f]{64}$/;
const matches=(pattern,value)=>typeof value==='string'&&pattern.exec(value)?.[0]===value;
const integer=(value,min,max)=>Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=min&&value<=max;
const requiredSignature=()=>{throw new ApiError(403,'SIMULATION_SIGNATURE_REQUIRED','无法核实模拟关单通知。');};
const tooLarge=()=>{throw new ApiError(413,'TOO_LARGE','资料超过大小限制。');};

export function validateSimulationOrderClosure(value){
  if(!value||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)invalid();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(descriptors).length!==FIELDS.length||FIELDS.some(key=>{
    const descriptor=Object.hasOwn(descriptors,key)?descriptors[key]:null;
    return !descriptor?.enumerable||!Object.hasOwn(descriptor,'value');
  }))invalid();
  const receipt=Object.fromEntries(FIELDS.map(key=>[key,descriptors[key].value]));
  const {protocol,merchantId,eventId,orderId,product,amountMinor,currency,status,closedAt}=receipt;
  if(protocol!==PROTOCOL||!matches(ID,merchantId)||!matches(UUID,eventId)||!matches(UUID,orderId)
    ||![ANNUAL_PRODUCT,SEAT_PRODUCT].includes(product)||!integer(amountMinor,1,Number.MAX_SAFE_INTEGER)
    ||currency!=='CNY'||status!=='closed'||!integer(closedAt,0,MAX_TIME))invalid();
  return Object.freeze(receipt);
}

const mac=(body,key)=>createHmac('sha256',key).update(DOMAIN).update(body).digest();

export function signSimulationOrderClosure(value,configuration){
  const body=Buffer.from(JSON.stringify(validateSimulationOrderClosure(value)));
  return Object.freeze({body,signature:mac(body,configuration.signingKey).toString('hex')});
}

export function verifySimulationOrderClosureEnvelope(body,signature,configuration){
  if(types.isProxy(body)||!Buffer.isBuffer(body)||body.length>MAX_BODY)invalid();
  if(!matches(SIG,signature)||!timingSafeEqual(mac(body,configuration.signingKey),Buffer.from(signature,'hex')))requiredSignature();
  let parsed;
  try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}
  catch{invalid();}
  const receipt=validateSimulationOrderClosure(parsed);
  if(receipt.merchantId!==configuration.merchantId||!body.equals(Buffer.from(JSON.stringify(receipt))))invalid();
  return receipt;
}

export async function readSimulationOrderClosureRequest(request,configuration){
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))throw new ApiError(415,'JSON_REQUIRED','请使用 JSON 格式。');
  const length=request.headers.get('Content-Length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY))tooLarge();
  const reader=request.body?.getReader();
  if(!reader)invalid();
  const chunks=[];
  let total=0;
  for(;;){
    const part=await reader.read();
    if(part.done)break;
    total+=part.value.byteLength;
    if(total>MAX_BODY){await reader.cancel();tooLarge();}
    chunks.push(part.value);
  }
  return verifySimulationOrderClosureEnvelope(Buffer.concat(chunks),request.headers.get('X-Shenyi-Simulation-Signature'),configuration);
}
