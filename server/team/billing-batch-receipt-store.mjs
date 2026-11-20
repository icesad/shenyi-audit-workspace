import {readFileSync} from 'node:fs';
import {ApiError,ID} from './http-utils.mjs';

const MAX_TIME=8640000000000000;
const PAGE_SIZE=8;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256=/^[0-9a-f]{64}$/;
const OUTCOMES=new Set(['matched','awaiting-review','evidence-rejected','lookup-unavailable','no-evidence','local-failure','closed']);
const STATUSES=new Set(['pending','payment-verified','paid','closed']);
const matches=(pattern,value)=>typeof value==='string'&&pattern.exec(value)?.[0]===value;
const time=value=>Number.isSafeInteger(value)&&value>=0&&value<=MAX_TIME&&!Object.is(value,-0);
const conflict=()=>{throw new ApiError(409,'BILLING_RECONCILIATION_CONFLICT','本批账务核对记录与原请求或已验款事实不符，请核对。');};
const keys=scope=>[scope.teamId,scope.actorId,scope.requestId];

function exactObject(value,names){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)conflict();
  const descriptors=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(descriptors);
  if(own.length!==names.length||own.some(name=>typeof name!=='string'||!names.includes(name)
    ||!Object.hasOwn(descriptors[name],'value')||!descriptors[name].enumerable))conflict();
}

function validateScope(scope){
  exactObject(scope,['teamId','actorId','requestId','kind','after','merchantId']);
  if(!matches(ID,scope.teamId)||!matches(ID,scope.actorId)||!matches(UUID,scope.requestId)
    ||!['annual','seat'].includes(scope.kind)||(scope.after!==null&&!matches(UUID,scope.after))
    ||!matches(ID,scope.merchantId))conflict();
}

function validatePayment(payment){
  exactObject(payment,['paymentId','receiptSha256','confirmedAt']);
  if(!matches(UUID,payment.paymentId)||!matches(SHA256,payment.receiptSha256)||!time(payment.confirmedAt))conflict();
  return {paymentId:payment.paymentId,receiptSha256:payment.receiptSha256,confirmedAt:payment.confirmedAt};
}

function validateResult(result,orderId){
  exactObject(result,['orderId','outcome','status','paymentException']);
  if(result.orderId!==orderId||!matches(UUID,result.orderId)||!OUTCOMES.has(result.outcome)
    ||!STATUSES.has(result.status)||typeof result.paymentException!=='boolean')conflict();
  return {orderId:result.orderId,outcome:result.outcome,status:result.status,paymentException:result.paymentException};
}

function withinTransaction(db,scope,work){
  if(db.isTransaction!==true)conflict();
  validateScope(scope);
  try{return work();}
  catch(error){
    if(typeof error?.errcode==='number'&&[5,6,19].includes(error.errcode&255))conflict();
    throw error;
  }
}

function batch(db,scope){
  const row=db.prepare(`SELECT order_kind,after_order_id,merchant_id,item_count,next_cursor,created_at
    FROM team_billing_reconciliation_batches WHERE team_id=? AND actor_id=? AND request_id=?`).get(...keys(scope));
  if(!row)return null;
  if(row.order_kind!==scope.kind||row.after_order_id!==scope.after||row.merchant_id!==scope.merchantId
    ||!Number.isInteger(row.item_count)||row.item_count<0||row.item_count>PAGE_SIZE||!time(row.created_at)
    ||(row.next_cursor!==null&&!matches(UUID,row.next_cursor)))conflict();
  return row;
}

function itemValue(row,scope,base){
  if(!row||!matches(UUID,row.order_id)||(scope.after!==null&&row.order_id<=scope.after)
    ||!Number.isInteger(row.ordinal)||row.ordinal<0||row.ordinal>=base.item_count
    ||!['pending','verified','complete'].includes(row.progress)||!time(row.updated_at)||row.updated_at<base.created_at)conflict();
  const value={orderId:row.order_id,progress:row.progress};
  if(row.payment_id!==null||row.receipt_sha256!==null||row.confirmed_at!==null){
    value.payment=validatePayment({paymentId:row.payment_id,receiptSha256:row.receipt_sha256,confirmedAt:row.confirmed_at});
  }
  if(row.result_json!==null){
    let result;
    try{result=JSON.parse(row.result_json);}catch{conflict();}
    value.result=validateResult(result,row.order_id);
    if(JSON.stringify(value.result)!==row.result_json)conflict();
  }
  if(row.progress==='pending'&&(value.payment||value.result)
    ||row.progress==='verified'&&(!value.payment||value.result)
    ||row.progress==='complete'&&!value.result)conflict();
  return value;
}

function item(db,scope,orderId,base){
  if(!matches(UUID,orderId))conflict();
  const row=db.prepare(`SELECT order_id,ordinal,progress,payment_id,receipt_sha256,confirmed_at,result_json,updated_at
    FROM team_billing_reconciliation_items WHERE team_id=? AND actor_id=? AND request_id=? AND order_id=?`).get(...keys(scope),orderId);
  return {row,value:itemValue(row,scope,base)};
}

function readBatch(db,scope,base){
  const rows=db.prepare(`SELECT order_id,ordinal,progress,payment_id,receipt_sha256,confirmed_at,result_json,updated_at
    FROM team_billing_reconciliation_items WHERE team_id=? AND actor_id=? AND request_id=? ORDER BY ordinal`).all(...keys(scope));
  if(rows.length!==base.item_count)conflict();
  const items=rows.map((row,index)=>{
    if(row.ordinal!==index||(index>0&&rows[index-1].order_id>=row.order_id))conflict();
    return itemValue(row,scope,base);
  });
  if(base.next_cursor!==null&&base.next_cursor!==items.at(-1)?.orderId)conflict();
  return {items,nextCursor:base.next_cursor};
}

function canonicalPayment(db,scope,orderId,payment){
  const table=scope.kind==='annual'?'team_annual_verified_payments':'team_seat_verified_payments';
  const row=db.prepare(`SELECT payment_id,receipt_sha256,confirmed_at FROM ${table}
    WHERE team_id=? AND order_id=? AND payment_id=?`).get(scope.teamId,orderId,payment.paymentId);
  if(!row||row.payment_id!==payment.paymentId||row.receipt_sha256!==payment.receiptSha256
    ||row.confirmed_at!==payment.confirmedAt)conflict();
}

// Opt-in preview initialization is deliberately separate from the team DB initializer.
export function initializeBillingBatchReceiptStore(db){
  db.exec(readFileSync(new URL('./billing-batch-receipt-schema.sql',import.meta.url),'utf8'));
}

// `now` is an integer timestamp supplied by the caller, never an implicit clock.
export function openBillingBatchReceipt(db,scope,selectPage,now){
  return withinTransaction(db,scope,()=>{
    if(!time(now))conflict();
    const prior=batch(db,scope);
    if(prior)return readBatch(db,scope,prior);
    if(typeof selectPage!=='function')conflict();
    const selected=selectPage();
    if(db.isTransaction!==true||!selected||!Array.isArray(selected.orders)||selected.orders.length>PAGE_SIZE
      ||typeof selected.hasMore!=='boolean'||(selected.hasMore&&selected.orders.length===0))conflict();
    const ids=selected.orders.map(order=>order?.id);
    if(ids.some((id,index)=>!matches(UUID,id)||(index>0&&ids[index-1]>=id)||(scope.after!==null&&id<=scope.after)))conflict();
    const nextCursor=selected.hasMore?ids.at(-1):null;
    db.prepare(`INSERT INTO team_billing_reconciliation_batches
      (team_id,actor_id,request_id,order_kind,after_order_id,merchant_id,item_count,next_cursor,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(...keys(scope),scope.kind,scope.after,scope.merchantId,ids.length,nextCursor,now);
    const insert=db.prepare(`INSERT INTO team_billing_reconciliation_items
      (team_id,actor_id,request_id,order_id,ordinal,progress,updated_at) VALUES (?,?,?,?,?,'pending',?)`);
    ids.forEach((id,index)=>{if(insert.run(...keys(scope),id,index,now).changes!==1)conflict();});
    const saved=batch(db,scope);
    if(!saved)conflict();
    return readBatch(db,scope,saved);
  });
}

export function recordBillingBatchVerification(db,scope,orderId,payment,now){
  withinTransaction(db,scope,()=>{
    if(!time(now))conflict();
    const pin=validatePayment(payment),base=batch(db,scope);
    if(!base)conflict();
    const current=item(db,scope,orderId,base);
    if(current.value.progress!=='pending'||now<current.row.updated_at||now<pin.confirmedAt)conflict();
    canonicalPayment(db,scope,orderId,pin);
    const changed=db.prepare(`UPDATE team_billing_reconciliation_items
      SET progress='verified',payment_id=?,receipt_sha256=?,confirmed_at=?,updated_at=?
      WHERE team_id=? AND actor_id=? AND request_id=? AND order_id=? AND progress='pending'
        AND payment_id IS NULL AND receipt_sha256 IS NULL AND confirmed_at IS NULL AND result_json IS NULL`).run(
      pin.paymentId,pin.receiptSha256,pin.confirmedAt,now,...keys(scope),orderId);
    if(changed.changes!==1)conflict();
    const saved=item(db,scope,orderId,base).value;
    if(saved.progress!=='verified'||JSON.stringify(saved.payment)!==JSON.stringify(pin))conflict();
  });
}

export function assertBillingBatchVerification(db,scope,orderId,payment){
  withinTransaction(db,scope,()=>{
    const pin=validatePayment(payment),base=batch(db,scope);
    if(!base)conflict();
    const current=item(db,scope,orderId,base).value;
    if(!['verified','complete'].includes(current.progress)||JSON.stringify(current.payment)!==JSON.stringify(pin))conflict();
    canonicalPayment(db,scope,orderId,pin);
  });
}

export function finishBillingBatchItem(db,scope,previousProgress,result,now){
  withinTransaction(db,scope,()=>{
    if(!time(now)||!['pending','verified'].includes(previousProgress))conflict();
    const value=validateResult(result,result?.orderId),base=batch(db,scope);
    if(!base)conflict();
    const current=item(db,scope,value.orderId,base);
    if(current.value.progress!==previousProgress||now<current.row.updated_at)conflict();
    if(current.value.payment)canonicalPayment(db,scope,value.orderId,current.value.payment);
    const content=JSON.stringify(value);
    const changed=db.prepare(`UPDATE team_billing_reconciliation_items SET progress='complete',result_json=?,updated_at=?
      WHERE team_id=? AND actor_id=? AND request_id=? AND order_id=? AND progress=? AND result_json IS NULL`).run(
      content,now,...keys(scope),value.orderId,previousProgress);
    if(changed.changes!==1)conflict();
    const saved=item(db,scope,value.orderId,base).value;
    if(saved.progress!=='complete'||JSON.stringify(saved.result)!==content
      ||JSON.stringify(saved.payment)!==JSON.stringify(current.value.payment))conflict();
  });
}
