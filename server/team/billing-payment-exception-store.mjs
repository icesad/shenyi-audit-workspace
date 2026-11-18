import {createHash} from 'node:crypto';
import {ApiError,ID,deny,invalid,transaction} from './http-utils.mjs';
import {ANNUAL_PRODUCT,SEAT_PRODUCT,validateSimulationPaymentReceipt} from './billing-simulation.mjs';
import {validateSimulationPaymentException} from './billing-payment-exception.mjs';

const MAX_TIME=8640000000000000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest=value=>createHash('sha256').update(value).digest('hex');
const hasTime=value=>Number.isSafeInteger(value)&&value>=0&&value<=MAX_TIME&&!Object.is(value,-0);
const matches=(pattern,value)=>typeof value==='string'&&pattern.exec(value)?.[0]===value;
const conflict=()=>{throw new ApiError(409,'BILLING_PAYMENT_EXCEPTION_CONFLICT','模拟账务异常与原订单或收款记录不符，请核对。');};
const requireReview=()=>{throw new ApiError(409,'BILLING_PAYMENT_EXCEPTION_REVIEW_REQUIRED','已记录模拟退款或拒付，需核对该订单权益。');};
const inTransaction=db=>{if(db.isTransaction!==true)conflict();};
const kindOf=product=>product===ANNUAL_PRODUCT?'annual':'seat';

function orderFor(db,product,orderId){
  const table=`team_${kindOf(product)}_orders`;
  return db.prepare(`SELECT order_id,team_id,merchant_id,amount_minor,currency,created_at,environment
    FROM ${table} WHERE order_id=?`).get(orderId);
}

function verifyLockedOrder(order,receipt){
  if(!order||order.order_id!==receipt.orderId||!matches(ID,order.team_id)||order.merchant_id!==receipt.merchantId
    ||order.amount_minor!==receipt.amountMinor||order.currency!==receipt.currency||order.environment!=='simulation-v1'
    ||!hasTime(order.created_at)||order.created_at>receipt.occurredAt)conflict();
}

function persistedReceipt(row,validate){
  let receipt;
  try{receipt=validate(JSON.parse(row.receipt_json));}
  catch{conflict();}
  if(row.receipt_json!==JSON.stringify(receipt)||row.receipt_sha256!==digest(row.receipt_json))conflict();
  return receipt;
}

function fact(db,row){
  const value=persistedReceipt(row,validateSimulationPaymentException);
  if(row.event_id!==value.eventId||row.original_transaction_id!==value.originalTransactionId||row.order_id!==value.orderId
    ||row.product!==value.product||row.merchant_id!==value.merchantId||row.amount_minor!==value.amountMinor
    ||row.currency!==value.currency||row.kind!==value.kind||row.occurred_at!==value.occurredAt
    ||!hasTime(row.recorded_at)||row.recorded_at<value.occurredAt)conflict();
  const order=orderFor(db,value.product,value.orderId);
  verifyLockedOrder(order,value);
  if(row.team_id!==order.team_id)conflict();
  return value;
}

const project=value=>Object.freeze({kind:value.kind,occurredAt:value.occurredAt,state:'review-required'});

export function readBillingPaymentException(db,product,orderId){
  if(![ANNUAL_PRODUCT,SEAT_PRODUCT].includes(product)||!matches(UUID,orderId))invalid();
  const row=db.prepare('SELECT * FROM team_billing_payment_exceptions WHERE order_id=? AND product=?').get(orderId,product);
  return row?project(fact(db,row)):null;
}

function matchesCapture(exception,capture){
  return exception.eventId!==capture.eventId&&exception.originalTransactionId===capture.transactionId
    &&exception.orderId===capture.orderId&&exception.product===capture.product&&exception.merchantId===capture.merchantId
    &&exception.amountMinor===capture.amountMinor&&exception.currency===capture.currency&&capture.paidAt<=exception.occurredAt;
}

function verifyRecordedCapture(db,order,exception){
  const identities=[exception.orderId,exception.originalTransactionId,exception.eventId];
  const captures=db.prepare(`SELECT '${ANNUAL_PRODUCT}' AS payment_product, order_id,team_id,transaction_id,event_id,receipt_json,receipt_sha256
    FROM team_annual_verified_payments WHERE order_id=? OR transaction_id=? OR event_id=?
    UNION ALL
    SELECT '${SEAT_PRODUCT}',order_id,team_id,transaction_id,event_id,receipt_json,receipt_sha256
    FROM team_seat_verified_payments WHERE order_id=? OR transaction_id=? OR event_id=?`).all(...identities,...identities);
  if(!captures.length)return;
  if(captures.length!==1)conflict();
  const row=captures[0],capture=persistedReceipt(row,validateSimulationPaymentReceipt);
  if(row.payment_product!==capture.product||row.team_id!==order.team_id||row.order_id!==capture.orderId
    ||row.transaction_id!==capture.transactionId||row.event_id!==capture.eventId||!matchesCapture(exception,capture))conflict();
}

function matchingException(db,receipt){
  inTransaction(db);
  const capture=validateSimulationPaymentReceipt(receipt);
  const rows=db.prepare(`SELECT * FROM team_billing_payment_exceptions
    WHERE order_id=? OR original_transaction_id=? OR event_id=?`).all(capture.orderId,capture.transactionId,capture.eventId);
  if(!rows.length)return null;
  if(rows.length!==1)conflict();
  const exception=fact(db,rows[0]);
  if(!matchesCapture(exception,capture))conflict();
  return exception;
}

export function assertBillingCaptureCompatible(db,receipt){
  matchingException(db,receipt);
}

export function assertBillingPaymentFulfillable(db,receipt){
  if(matchingException(db,receipt))requireReview();
}

export function recordVerifiedBillingPaymentExceptionWithinTransaction(db,receipt,{now=Date.now}={}){
  inTransaction(db);
  const value=validateSimulationPaymentException(receipt);
  if(typeof now!=='function')invalid();
  const order=orderFor(db,value.product,value.orderId);
  if(!order)deny();
  verifyLockedOrder(order,value);
  verifyRecordedCapture(db,order,value);
  const content=JSON.stringify(value),hash=digest(content);
  const prior=db.prepare(`SELECT * FROM team_billing_payment_exceptions
    WHERE order_id=? OR original_transaction_id=? OR event_id=?`).all(value.orderId,value.originalTransactionId,value.eventId);
  if(prior.length){
    if(prior.length!==1||prior[0].receipt_json!==content||prior[0].receipt_sha256!==hash)conflict();
    return project(fact(db,prior[0]));
  }
  const at=now();
  if(!hasTime(at)||at<value.occurredAt)conflict();
  const inserted=db.prepare(`INSERT INTO team_billing_payment_exceptions(
    event_id,original_transaction_id,order_id,product,team_id,merchant_id,amount_minor,currency,kind,occurred_at,recorded_at,receipt_json,receipt_sha256
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(value.eventId,value.originalTransactionId,value.orderId,value.product,
    order.team_id,value.merchantId,value.amountMinor,value.currency,value.kind,value.occurredAt,at,content,hash);
  if(inserted.changes!==1)conflict();
  const saved=db.prepare('SELECT * FROM team_billing_payment_exceptions WHERE event_id=?').get(value.eventId);
  if(!saved||saved.recorded_at!==at||saved.receipt_sha256!==hash)conflict();
  return project(fact(db,saved));
}

export function recordVerifiedBillingPaymentException(db,receipt,options){
  if(db.isTransaction===true)conflict();
  try{return transaction(db,()=>recordVerifiedBillingPaymentExceptionWithinTransaction(db,receipt,options));}
  catch(error){
    if(typeof error?.errcode==='number'&&[5,6,19].includes(error.errcode&255))conflict();
    throw error;
  }
}
