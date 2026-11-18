import {createHash} from 'node:crypto';
import {ApiError,ID,deny,invalid,transaction} from './http-utils.mjs';
import {ANNUAL_PRODUCT,SEAT_PRODUCT} from './billing-simulation.mjs';
import {validateSimulationOrderClosure} from './billing-order-closure.mjs';

const MAX_TIME=8640000000000000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const digest=value=>createHash('sha256').update(value).digest('hex');
const matches=(pattern,value)=>typeof value==='string'&&pattern.exec(value)?.[0]===value;
const integer=(value,min,max)=>Number.isSafeInteger(value)&&!Object.is(value,-0)&&value>=min&&value<=max;
const conflict=()=>{throw new ApiError(409,'BILLING_ORDER_CLOSURE_CONFLICT','关单结果与原订单或已有账务记录不符，请核对。');};
const inTransaction=db=>{if(db.isTransaction!==true)conflict();};

function requireOrderRef(product,orderId){
  if(![ANNUAL_PRODUCT,SEAT_PRODUCT].includes(product)||!matches(UUID,orderId))invalid();
}

function lockedOrder(db,product,orderId){
  requireOrderRef(product,orderId);
  const annual=product===ANNUAL_PRODUCT;
  const row=db.prepare(`SELECT order_id,team_id,merchant_id,amount_minor,currency,environment,created_at,request_sha256,
    ${annual?'NULL':'quote_expires_at'} AS quote_expires_at FROM ${annual?'team_annual_orders':'team_seat_orders'} WHERE order_id=?`).get(orderId);
  if(!row)return null;
  if(row.order_id!==orderId||!matches(ID,row.team_id)||!matches(ID,row.merchant_id)||row.environment!=='simulation-v1'
    ||row.currency!=='CNY'||!matches(SHA,row.request_sha256)||!integer(row.amount_minor,1,Number.MAX_SAFE_INTEGER)
    ||!integer(row.created_at,0,MAX_TIME)||(!annual&&!integer(row.quote_expires_at,row.created_at+1,MAX_TIME)))conflict();
  return row;
}

function readPinnedDeadline(db,orderId,order){
  const row=db.prepare(`SELECT order_id,team_id,order_created_at,order_request_sha256,duration_ms,deadline_at
    FROM team_billing_annual_close_windows WHERE order_id=?`).get(orderId);
  if(!row)return null;
  const original=order??lockedOrder(db,ANNUAL_PRODUCT,orderId);
  if(!original||row.order_id!==original.order_id||row.team_id!==original.team_id||row.order_created_at!==original.created_at
    ||row.order_request_sha256!==original.request_sha256||!integer(row.duration_ms,1,MAX_TIME-original.created_at)
    ||row.deadline_at!==original.created_at+row.duration_ms)conflict();
  return row.deadline_at;
}

export function readAnnualCloseDeadline(db,orderId){
  requireOrderRef(ANNUAL_PRODUCT,orderId);
  return readPinnedDeadline(db,orderId);
}

function conflictingEvidence(db,orderId,eventId=null){
  return !!db.prepare(`SELECT 1 FROM team_annual_verified_payments WHERE order_id=? OR event_id=?
    UNION ALL SELECT 1 FROM team_seat_verified_payments WHERE order_id=? OR event_id=?
    UNION ALL SELECT 1 FROM team_billing_payment_exceptions WHERE order_id=? OR event_id=? LIMIT 1`)
    .get(orderId,eventId,orderId,eventId,orderId,eventId);
}

export function recordAnnualCloseWindowWithinTransaction(db,orderId,durationMs){
  inTransaction(db);
  if(!integer(durationMs,1,MAX_TIME))invalid();
  const order=lockedOrder(db,ANNUAL_PRODUCT,orderId);
  if(!order)deny();
  if(durationMs>MAX_TIME-order.created_at)conflict();
  const deadlineAt=order.created_at+durationMs;
  const prior=readPinnedDeadline(db,orderId,order);
  if(prior!==null){
    if(prior!==deadlineAt)conflict();
    return prior;
  }
  if(conflictingEvidence(db,orderId))conflict();
  const inserted=db.prepare(`INSERT INTO team_billing_annual_close_windows(
    order_id,team_id,order_created_at,order_request_sha256,duration_ms,deadline_at
  ) VALUES (?,?,?,?,?,?)`).run(orderId,order.team_id,order.created_at,order.request_sha256,durationMs,deadlineAt);
  if(inserted.changes!==1||readPinnedDeadline(db,orderId,order)!==deadlineAt)conflict();
  return deadlineAt;
}

function orderDeadline(db,product,order){
  return product===ANNUAL_PRODUCT?readPinnedDeadline(db,order.order_id,order):order.quote_expires_at;
}

function verifyReceiptOrder(order,receipt){
  if(!order||order.order_id!==receipt.orderId||order.merchant_id!==receipt.merchantId
    ||order.amount_minor!==receipt.amountMinor||order.currency!==receipt.currency)conflict();
}

function storedClosure(db,row){
  let receipt;
  try{receipt=validateSimulationOrderClosure(JSON.parse(row.receipt_json));}
  catch{conflict();}
  const body=JSON.stringify(receipt);
  if(row.receipt_json!==body||row.receipt_sha256!==digest(body)||row.event_id!==receipt.eventId||row.order_id!==receipt.orderId
    ||row.product!==receipt.product||row.merchant_id!==receipt.merchantId||row.amount_minor!==receipt.amountMinor
    ||row.currency!==receipt.currency||row.closed_at!==receipt.closedAt||!integer(row.recorded_at,row.closed_at,MAX_TIME))conflict();
  const order=lockedOrder(db,receipt.product,receipt.orderId);
  verifyReceiptOrder(order,receipt);
  const deadlineAt=orderDeadline(db,receipt.product,order);
  if(deadlineAt===null||row.deadline_at!==deadlineAt||row.closed_at<deadlineAt||row.team_id!==order.team_id
    ||row.order_request_sha256!==order.request_sha256)conflict();
  return Object.freeze({closedAt:receipt.closedAt,deadlineAt});
}

export function readBillingOrderClosure(db,product,orderId){
  requireOrderRef(product,orderId);
  const row=db.prepare('SELECT * FROM team_billing_order_closures WHERE order_id=? AND product=?').get(orderId,product);
  return row?storedClosure(db,row):null;
}

export function assertBillingOrderOpenForFulfilment(db,product,orderId){
  inTransaction(db);
  if(readBillingOrderClosure(db,product,orderId)){
    throw new ApiError(409,'BILLING_ORDER_CLOSED_REVIEW_REQUIRED','原订单已超时关闭，后到的收款须单独复核。');
  }
}

export function assertBillingClosureEventUnused(db,eventId){
  inTransaction(db);
  if(!matches(UUID,eventId))invalid();
  if(db.prepare('SELECT 1 FROM team_billing_order_closures WHERE event_id=?').get(eventId))conflict();
}

export function recordVerifiedBillingOrderClosureWithinTransaction(db,receipt,{now=Date.now}={}){
  inTransaction(db);
  const value=validateSimulationOrderClosure(receipt);
  if(typeof now!=='function')invalid();
  const order=lockedOrder(db,value.product,value.orderId);
  if(!order)deny();
  verifyReceiptOrder(order,value);
  const content=JSON.stringify(value),hash=digest(content);
  const prior=db.prepare('SELECT * FROM team_billing_order_closures WHERE event_id=? OR order_id=?').all(value.eventId,value.orderId);
  if(prior.length){
    if(prior.length!==1||prior[0].receipt_json!==content||prior[0].receipt_sha256!==hash)conflict();
    // Once recorded, exact replay remains harmless even if a late capture is on file.
    return storedClosure(db,prior[0]);
  }
  const deadlineAt=orderDeadline(db,value.product,order),recordedAt=now();
  if(deadlineAt===null||value.closedAt<deadlineAt||!integer(recordedAt,value.closedAt,MAX_TIME)
    ||conflictingEvidence(db,value.orderId,value.eventId))conflict();
  const inserted=db.prepare(`INSERT INTO team_billing_order_closures(
    event_id,order_id,product,team_id,merchant_id,amount_minor,currency,order_request_sha256,
    deadline_at,closed_at,recorded_at,receipt_json,receipt_sha256
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(value.eventId,value.orderId,value.product,order.team_id,value.merchantId,
    value.amountMinor,value.currency,order.request_sha256,deadlineAt,value.closedAt,recordedAt,content,hash);
  if(inserted.changes!==1)conflict();
  const saved=db.prepare('SELECT * FROM team_billing_order_closures WHERE event_id=?').get(value.eventId);
  if(!saved||saved.recorded_at!==recordedAt||saved.receipt_sha256!==hash)conflict();
  return storedClosure(db,saved);
}

export function recordVerifiedBillingOrderClosure(db,receipt,options){
  if(db.isTransaction===true)conflict();
  try{return transaction(db,()=>recordVerifiedBillingOrderClosureWithinTransaction(db,receipt,options));}
  catch(error){
    if(typeof error?.errcode==='number'&&[5,6,19].includes(error.errcode&255))conflict();
    throw error;
  }
}
