'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {withoutEmptyOrderClosureLayer,peelOrderClosureSchema,assertOrderClosureSchemaRestored}=require('./billing-order-closure-schema-layer.cjs');

const TABLES=Object.freeze(['team_billing_refund_intake_events','team_billing_refund_intake_reviewers']);
const DDL_SHA='38cbe82d16c7f5ebb57fb45e8271cc9e4ec132398707f80639105929575ac2c2';
function definitions(db){
  return db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND (
    name GLOB 'billing_refund_intake_*' OR name GLOB 'team_billing_refund_intake_*' OR tbl_name IN (?,?)
  ) ORDER BY type,name`).all(...TABLES).map(row=>({...row}));
}

function assertRefundIntakeSchema(db,{allowAbsent=false,empty=true}={}){
  const layer=definitions(db);
  if(allowAbsent&&!layer.length)return layer;
  assert.deepEqual(layer.filter(row=>row.type==='table').map(row=>row.name),[...TABLES]);
  assert.equal(layer.length,20);
  assert.equal(layer.filter(row=>row.type==='trigger').length,18);
  assert.equal(createHash('sha256').update(JSON.stringify(layer)).digest('hex'),DDL_SHA,
    'Only the exact reviewed refund intake DDL may be projected');
  for(const name of TABLES){
    const table=db.prepare('PRAGMA table_list').all().find(row=>row.schema==='main'&&row.name===name);
    assert.equal(table.strict,1);
    assert.equal(table.wr,0);
    if(empty)assert.equal(db.prepare('SELECT COUNT(*) n FROM main.'+name).get().n,0,
      'No refund intake record or reviewer history may be projected');
  }
  return layer;
}

function refundIntakeSchemaLayer(db,options){
  const layer=assertRefundIntakeSchema(db,options);
  return {tables:layer.filter(row=>row.type==='table').length,objects:layer.length};
}

function withoutEmptyRefundIntakeDefinitions(db,rows){
  const names=new Set(assertRefundIntakeSchema(db,{allowAbsent:true}).map(row=>row.name));
  return withoutEmptyOrderClosureLayer(db,{definitions:rows}).definitions.filter(row=>!names.has(row.name));
}

function withoutEmptyRefundIntakeLayer(db,state){
  const layer=assertRefundIntakeSchema(db,{allowAbsent:true});
  state=withoutEmptyOrderClosureLayer(db,state);
  if(!layer.length)return state;
  const names=new Set(layer.map(row=>row.name));
  const without=rows=>rows.filter(row=>!names.has(typeof row==='string'?row:row.name));
  return {...state,...(state.definitions?{definitions:without(state.definitions)}:{}),
    ...(state.schema?{schema:without(state.schema)}:{}),...(state.tables?{tables:without(state.tables)}:{})};
}

function peelRefundIntakeSchema(db){
  const layer=assertRefundIntakeSchema(db,{allowAbsent:true});
  const orderClosure=peelOrderClosureSchema(db);
  if(!layer.length)return {definitions:[],tables:orderClosure.tables,orderClosure};
  for(const row of layer.filter(row=>row.type==='trigger'))db.exec('DROP TRIGGER main."'+row.name+'"');
  for(const name of TABLES)db.exec('DROP TABLE main."'+name+'"');
  assert.deepEqual(definitions(db),[]);
  return {definitions:layer,tables:[...TABLES,...orderClosure.tables],orderClosure};
}

function assertRefundIntakeSchemaRestored(db,layer){
  if(layer?.definitions.length)assert.deepEqual(assertRefundIntakeSchema(db),layer.definitions);
  assertOrderClosureSchemaRestored(db,layer?.orderClosure);
}

module.exports={assertRefundIntakeSchema,refundIntakeSchemaLayer,withoutEmptyRefundIntakeDefinitions,
  withoutEmptyRefundIntakeLayer,peelRefundIntakeSchema,assertRefundIntakeSchemaRestored};
