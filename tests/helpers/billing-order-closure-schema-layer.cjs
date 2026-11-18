'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');

const TABLES=Object.freeze(['team_billing_annual_close_windows','team_billing_order_closures']);
const DDL_SHA='396c8542d22201ba43e19324913f67296940a57a8764ef282ca5b324fe94b491';

function definitions(db){
  return db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND (
    name GLOB 'billing_annual_close_windows*' OR name GLOB 'billing_order_closures*' OR tbl_name IN (?,?)
  ) ORDER BY type,name`).all(...TABLES).map(row=>({...row}));
}

function assertOrderClosureSchema(db,{allowAbsent=false,empty=true}={}){
  const layer=definitions(db);
  if(allowAbsent&&!layer.length)return layer;
  assert.equal(layer.length,11);
  assert.equal(layer.filter(row=>row.type==='trigger').length,9);
  assert.deepEqual(layer.filter(row=>row.type==='table').map(row=>row.name),TABLES);
  assert.equal(createHash('sha256').update(JSON.stringify(layer)).digest('hex'),DDL_SHA,
    'Only the exact reviewed order closure DDL may be projected');
  for(const name of TABLES){
    const table=db.prepare('PRAGMA table_list').all().find(row=>row.schema==='main'&&row.name===name);
    assert.equal(table.strict,1);
    assert.equal(table.wr,0);
    if(empty)assert.equal(db.prepare('SELECT COUNT(*) n FROM main.'+name).get().n,0,
      'No pinned deadline or verified closure may be projected');
  }
  return layer;
}

function orderClosureSchemaLayer(db,options){
  const layer=assertOrderClosureSchema(db,options);
  return {tables:layer.filter(row=>row.type==='table').length,objects:layer.length};
}

function withoutEmptyOrderClosureLayer(db,state){
  const layer=assertOrderClosureSchema(db,{allowAbsent:true});
  if(!layer.length)return state;
  const names=new Set(layer.map(row=>row.name));
  const without=rows=>rows.filter(row=>!names.has(typeof row==='string'?row:row.name));
  return {...state,...(state.definitions?{definitions:without(state.definitions)}:{}),
    ...(state.schema?{schema:without(state.schema)}:{}),...(state.tables?{tables:without(state.tables)}:{})};
}

function peelOrderClosureSchema(db){
  const layer=assertOrderClosureSchema(db,{allowAbsent:true});
  if(!layer.length)return {definitions:[],tables:[]};
  for(const row of layer.filter(row=>row.type==='trigger'))db.exec('DROP TRIGGER main."'+row.name+'"');
  for(const name of [...TABLES].reverse())db.exec('DROP TABLE main."'+name+'"');
  assert.deepEqual(definitions(db),[]);
  return {definitions:layer,tables:[...TABLES]};
}

function assertOrderClosureSchemaRestored(db,layer){
  if(layer?.definitions.length)assert.deepEqual(assertOrderClosureSchema(db),layer.definitions);
}

module.exports={assertOrderClosureSchema,orderClosureSchemaLayer,withoutEmptyOrderClosureLayer,
  peelOrderClosureSchema,assertOrderClosureSchemaRestored};
