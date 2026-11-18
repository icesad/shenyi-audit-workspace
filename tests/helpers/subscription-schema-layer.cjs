'use strict';
const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
// Test-only projection of the exact empty reviewed M5 layer. Never application code.
const TABLES=Object.freeze(['team_subscription_events','team_subscription_heads']);
const EXPECTED_DDL_SHA='aaef1ffc9ac9f763621477dc133084027d3c8404aeb8e8814e51df1c9ff19e5b';
const definitions=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND (name GLOB 'subscription_*' OR name GLOB 'team_subscription_*' OR tbl_name IN ('team_subscription_events','team_subscription_heads')) ORDER BY type,name").all().map(row=>({...row}));
function assertSubscriptionSchema(db,{empty=true,allowAbsent=false}={}){
 const rows=definitions(db);if(allowAbsent&&rows.length===0)return rows;
 assert.equal(rows.length,4,'Only the exact reviewed subscription layer may be projected');
 assert.deepEqual(rows.filter(x=>x.type==='table').map(x=>x.name),[...TABLES]);
 assert.equal(rows.filter(x=>x.type==='trigger').length,2);assert.equal(rows.filter(x=>x.type==='index').length,0);
 assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),EXPECTED_DDL_SHA,'Only the reviewed exact subscription DDL may be projected');
 if(empty)for(const name of TABLES)assert.equal(db.prepare('SELECT COUNT(*) n FROM "'+name+'"').get().n,0,'No default subscription entitlement or event may be projected');
 return rows;
}
function subscriptionSchemaLayer(db,{allowAbsent=false}={}){const rows=assertSubscriptionSchema(db,{allowAbsent});return{tables:rows.filter(x=>x.type==='table').length,objects:rows.length};}
function withoutEmptySubscriptionDefinitions(db,rows){const layer=assertSubscriptionSchema(db,{allowAbsent:true}),names=new Set(layer.map(x=>x.name));return rows.filter(x=>!names.has(x.name));}
function withoutEmptySubscriptionLayer(db,state){
 const layer=assertSubscriptionSchema(db,{allowAbsent:true});if(!layer.length)return state;const names=new Set(layer.map(x=>x.name));
 return{...state,...(state.definitions?{definitions:state.definitions.filter(x=>!names.has(x.name))}:{}),...(state.schema?{schema:state.schema.filter(x=>!names.has(x.name))}:{}),...(state.tables?{tables:state.tables.filter(x=>!TABLES.includes(typeof x==='string'?x:x.name))}:{})};
}
function peelSubscriptionSchema(db){
 const rows=assertSubscriptionSchema(db),names=rows.map(x=>x.name);
 for(const row of rows.filter(x=>x.type!=='table'))db.exec('DROP '+row.type+' "'+row.name+'"');
 for(const name of ['team_subscription_heads','team_subscription_events'])db.exec('DROP TABLE "'+name+'"');
 assert.deepEqual(definitions(db),[]);return{definitions:rows,names,tables:[...TABLES]};
}
function assertSubscriptionSchemaRestored(db,layer){assert.deepEqual(assertSubscriptionSchema(db),layer.definitions);}
module.exports={TABLES,EXPECTED_DDL_SHA,subscriptionDefinitions:definitions,assertSubscriptionSchema,subscriptionSchemaLayer,withoutEmptySubscriptionDefinitions,withoutEmptySubscriptionLayer,peelSubscriptionSchema,assertSubscriptionSchemaRestored};
