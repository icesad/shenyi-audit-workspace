'use strict';

const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {withoutEmptyRefundIntakeDefinitions,withoutEmptyRefundIntakeLayer,peelRefundIntakeSchema,
  assertRefundIntakeSchemaRestored}=require('./billing-refund-intake-schema-layer.cjs');

const TABLE='team_billing_payment_exceptions';
const DDL_SHA='98142fd98f9b700ad61a984fffc045eaef182b95fb9f3d3b2f9ac61d4f1ad719';

function paymentExceptionDefinitions(db){
  return db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL
    AND (tbl_name=? OR name GLOB 'billing_payment_exceptions_*' OR name GLOB 'team_billing_payment_exceptions*')
    ORDER BY type,name`).all(TABLE).map(row=>({...row}));
}

function assertPaymentExceptionSchema(db,{allowAbsent=false,empty=true}={}){
  const definitions=paymentExceptionDefinitions(db);
  if(allowAbsent&&!definitions.length)return definitions;
  assert.deepEqual(definitions.map(row=>[row.type,row.name]),[
    ['table',TABLE],
    ['trigger','billing_payment_exceptions_locked_order'],
    ['trigger','billing_payment_exceptions_no_delete'],
    ['trigger','billing_payment_exceptions_no_replace'],
    ['trigger','billing_payment_exceptions_no_update'],
  ]);
  assert.equal(createHash('sha256').update(JSON.stringify(definitions)).digest('hex'),DDL_SHA,
    'Only the exact reviewed payment exception layer may be projected');
  const tables=db.prepare('PRAGMA table_list').all().filter(row=>row.name===TABLE);
  assert.equal(tables.length,1);
  assert.equal(tables[0].schema,'main');
  assert.equal(tables[0].strict,1);
  assert.equal(tables[0].wr,0);
  if(empty)assert.equal(db.prepare('SELECT count(*) n FROM main.team_billing_payment_exceptions').get().n,0,
    'No recorded payment exception may be projected');
  return definitions;
}

function paymentExceptionSchemaLayer(db,options){
  const definitions=assertPaymentExceptionSchema(db,options);
  return {tables:definitions.length?1:0,objects:definitions.length};
}

function withoutEmptyPaymentExceptionDefinitions(db,rows){
  const names=new Set(assertPaymentExceptionSchema(db,{allowAbsent:true}).map(row=>row.name));
  return withoutEmptyRefundIntakeDefinitions(db,rows).filter(row=>!names.has(row.name));
}

function withoutEmptyPaymentExceptionLayer(db,state){
  const names=new Set(assertPaymentExceptionSchema(db,{allowAbsent:true}).map(row=>row.name));
  state=withoutEmptyRefundIntakeLayer(db,state);
  if(!names.size)return state;
  const withoutLayer=rows=>rows.filter(row=>!names.has(typeof row==='string'?row:row.name));
  return {...state,...(state.definitions?{definitions:withoutLayer(state.definitions)}:{}),
    ...(state.schema?{schema:withoutLayer(state.schema)}:{}),...(state.tables?{tables:withoutLayer(state.tables)}:{})};
}

function peelPaymentExceptionSchema(db){
  const definitions=assertPaymentExceptionSchema(db);
  const refundIntake=peelRefundIntakeSchema(db);
  db.exec('DROP TABLE main.team_billing_payment_exceptions');
  assert.deepEqual(paymentExceptionDefinitions(db),[]);
  return {definitions,tables:[TABLE,...refundIntake.tables],refundIntake};
}

function assertPaymentExceptionSchemaRestored(db,layer){
  assert.deepEqual(assertPaymentExceptionSchema(db),layer.definitions);
  assertRefundIntakeSchemaRestored(db,layer.refundIntake);
}

module.exports={TABLE,paymentExceptionDefinitions,assertPaymentExceptionSchema,paymentExceptionSchemaLayer,
  withoutEmptyPaymentExceptionDefinitions,withoutEmptyPaymentExceptionLayer,peelPaymentExceptionSchema,assertPaymentExceptionSchemaRestored};
