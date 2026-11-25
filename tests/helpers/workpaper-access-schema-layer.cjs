const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {ledgerCheckSchemaLayer}=require('./ledger-check-schema-layer.cjs');
const {subscriptionSchemaLayer,withoutEmptySubscriptionLayer}=require('./subscription-schema-layer.cjs');
const {billingSchemaLayer}=require('./billing-schema-layer.cjs');
const {seatCapacitySchemaLayer}=require('./seat-capacity-schema-layer.cjs');
const {seatOrderSchemaLayer}=require('./seat-order-schema-layer.cjs');
const {annualSeatPlanSchemaLayer}=require('./annual-seat-plan-schema-layer.cjs');
const {paymentExceptionSchemaLayer}=require('./billing-payment-exception-schema-layer.cjs');
const {orderClosureSchemaLayer}=require('./billing-order-closure-schema-layer.cjs');
const {refundIntakeSchemaLayer,withoutEmptyRefundIntakeDefinitions,peelRefundIntakeSchema,
 assertRefundIntakeSchemaRestored}=require('./billing-refund-intake-schema-layer.cjs');
const {peelLedgerCheckSchema,assertLedgerCheckSchemaRestored}=require('./ledger-check-schema-peel.cjs');
const {workpaperDataSchemaLayer,peelWorkpaperDataSchema,dataDefinitions,DATA_TABLES}=require('./workpaper-data-schema-layer.cjs');
const {rateLimitPoolSchemaLayer,withoutEmptyRateLimitPoolLayer}=require('./rate-limit-pool-schema-layer.cjs');
const TABLES=Object.freeze(['team_workpaper_access_events','team_workpaper_access_grants']);
const definitions=db=>withoutEmptyRefundIntakeDefinitions(db,db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name GLOB 'workpaper_access_*' OR name GLOB 'team_workpaper_access_*' ORDER BY type,name").all().map(x=>({...x})));
function workpaperAccessSchemaLayer(db){
 const rows=definitions(db);assert.equal(rows.length,29);assert.equal(rows.filter(x=>x.type==='trigger').length,26);assert.equal(rows.filter(x=>x.type==='index').length,1);assert.deepEqual(rows.filter(x=>x.type==='table').map(x=>x.name),[...TABLES]);
 assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),'81ed73be0c51aa3f92717cb7e1d9f8faf9437a6d50891eb8b8c17fead29f6e4d','Only the reviewed exact workpaper ACL schema may be projected');
 for(const name of TABLES)assert.equal(db.prepare('SELECT COUNT(*) n FROM '+name).get().n,0,'No default workpaper authorization or audit may be seeded');return{tables:2,objects:29};
}
function laterTeamSchemaLayers(db){const ledger=ledgerCheckSchemaLayer(db),workpaper=workpaperAccessSchemaLayer(db),data=workpaperDataSchemaLayer(db),subscription=subscriptionSchemaLayer(db,{allowAbsent:true}),billing=billingSchemaLayer(db,{allowAbsent:true}),seats=seatCapacitySchemaLayer(db,{allowAbsent:true}),orders=seatOrderSchemaLayer(db,{allowAbsent:true}),plans=annualSeatPlanSchemaLayer(db,{allowAbsent:true}),exceptions=paymentExceptionSchemaLayer(db,{allowAbsent:true}),refundIntake=refundIntakeSchemaLayer(db,{allowAbsent:true}),orderClosure=orderClosureSchemaLayer(db,{allowAbsent:true}),rateLimitPool=rateLimitPoolSchemaLayer(db);return{tables:ledger.tables+workpaper.tables+data.tables+subscription.tables+billing.tables+seats.tables+orders.tables+plans.tables+exceptions.tables+refundIntake.tables+orderClosure.tables+rateLimitPool.tables,objects:ledger.objects+workpaper.objects+data.objects+subscription.objects+billing.objects+seats.objects+orders.objects+plans.objects+exceptions.objects+refundIntake.objects+orderClosure.objects+rateLimitPool.objects};}
function peelLedgerAndWorkpaperSchema(db){
 // Validate every complete empty later layer before the first DROP. Refuse active data.
 laterTeamSchemaLayers(db);const refundIntake=peelRefundIntakeSchema(db),rateLimitPool=refundIntake.orderClosure.rateLimitPool,data=peelWorkpaperDataSchema(db),workpaper=definitions(db);
 for(const row of workpaper.filter(x=>x.type!=='table'))db.exec('DROP '+row.type+' "'+row.name+'"');for(const name of TABLES)db.exec('DROP TABLE "'+name+'"');assert.deepEqual(definitions(db),[]);
 const ledger=peelLedgerCheckSchema(db);return{...ledger,tables:[...ledger.tables,...TABLES,...DATA_TABLES],names:[...ledger.names,...workpaper.map(x=>x.name),...data.map(x=>x.name)],workpaper,data,refundIntake,rateLimitPool};
}
function assertLedgerAndWorkpaperSchemaRestored(db,layer){assertRefundIntakeSchemaRestored(db,layer.refundIntake);assertLedgerCheckSchemaRestored(db,layer);assert.deepEqual(definitions(db),layer.workpaper);workpaperAccessSchemaLayer(db);assert.deepEqual(dataDefinitions(db),layer.data);workpaperDataSchemaLayer(db);}
function withoutEmptyWorkpaperLayer(db,state){
 state=withoutEmptySubscriptionLayer(db,state);
 state=withoutEmptyRateLimitPoolLayer(db,state);
 const rows=definitions(db),data=dataDefinitions(db);
 if(!rows.length&&!data.length)return state;
 workpaperAccessSchemaLayer(db);workpaperDataSchemaLayer(db);
 const names=new Set([...rows,...data].map(x=>x.name));
 return{...state,definitions:state.definitions.filter(x=>!names.has(x.name)),tables:state.tables.filter(x=>![...TABLES,...DATA_TABLES].includes(x.name))};
}
module.exports={withoutEmptyWorkpaperLayer,workpaperAccessSchemaLayer,laterTeamSchemaLayers,peelLedgerAndWorkpaperSchema,assertLedgerAndWorkpaperSchemaRestored};
