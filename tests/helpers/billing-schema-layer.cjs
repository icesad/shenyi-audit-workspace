'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
// Test-only exact empty M5D projection; never application code or a generic name filter.
const TABLES=Object.freeze(['team_annual_fulfilments','team_annual_orders','team_annual_verified_payments']);
const EXPECTED_DDL_SHA='2ab22adad96455f932d639b4c0dc0d3c61a777ef7d0afea942d281608cc2cde8';
const definitions=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND (name GLOB 'annual_*' OR name GLOB 'team_annual_*' OR tbl_name IN ('team_annual_orders','team_annual_verified_payments','team_annual_fulfilments')) ORDER BY type,name").all().map(row=>({...row}));
function assertBillingSchema(db,{empty=true,allowAbsent=false}={}){
 const rows=definitions(db);if(allowAbsent&&rows.length===0)return rows;
 assert.equal(rows.length,9,'Only the exact reviewed billing layer may be projected');
 assert.deepEqual(rows.filter(row=>row.type==='table').map(row=>row.name),[...TABLES]);
 assert.equal(rows.filter(row=>row.type==='trigger').length,6);assert.equal(rows.filter(row=>row.type==='index').length,0);
 assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),EXPECTED_DDL_SHA,'Only the reviewed exact billing DDL may be projected');
 const actual=db.prepare('PRAGMA table_list').all().filter(row=>TABLES.includes(row.name));assert.equal(actual.length,3);assert.ok(actual.every(row=>row.schema==='main'&&row.type==='table'&&row.strict===1),'Billing tables must remain STRICT');
 if(empty)for(const name of TABLES)assert.equal(db.prepare('SELECT COUNT(*) n FROM "'+name+'"').get().n,0,'No billing order, verified payment or fulfilment history may be projected');
 return rows;
}
function billingSchemaLayer(db,{allowAbsent=false}={}){const rows=assertBillingSchema(db,{allowAbsent});return{tables:rows.filter(row=>row.type==='table').length,objects:rows.length};}
function withoutEmptyBillingDefinitions(db,rows){const layer=assertBillingSchema(db,{allowAbsent:true}),names=new Set(layer.map(row=>row.name));return rows.filter(row=>!names.has(row.name));}
function withoutEmptyBillingLayer(db,state){
 const layer=assertBillingSchema(db,{allowAbsent:true});if(!layer.length)return state;const names=new Set(layer.map(row=>row.name));
 return{...state,...(state.definitions?{definitions:state.definitions.filter(row=>!names.has(row.name))}:{}),...(state.schema?{schema:state.schema.filter(row=>!names.has(row.name))}:{}),...(state.tables?{tables:state.tables.filter(row=>!TABLES.includes(typeof row==='string'?row:row.name))}:{})};
}
function peelBillingSchema(db){
 const rows=assertBillingSchema(db),names=rows.map(row=>row.name);
 for(const row of rows.filter(row=>row.type!=='table'))db.exec('DROP '+row.type+' "'+row.name+'"');
 for(const name of ['team_annual_fulfilments','team_annual_verified_payments','team_annual_orders'])db.exec('DROP TABLE "'+name+'"');
 assert.deepEqual(definitions(db),[]);return{definitions:rows,names,tables:[...TABLES]};
}
function assertBillingSchemaRestored(db,layer){assert.deepEqual(assertBillingSchema(db),layer.definitions);}
module.exports={TABLES,EXPECTED_DDL_SHA,billingDefinitions:definitions,assertBillingSchema,billingSchemaLayer,withoutEmptyBillingDefinitions,withoutEmptyBillingLayer,peelBillingSchema,assertBillingSchemaRestored};
