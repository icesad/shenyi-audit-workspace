'use strict';
// Test-only reconstruction of an older isolated database. Nonempty ledger
// data is rejected before any DROP; ordinary application code never imports it.
const assert=require('node:assert/strict');
const {ledgerCheckSchemaLayer}=require('./ledger-check-schema-layer.cjs');
const {withoutEmptyRefundIntakeDefinitions}=require('./billing-refund-intake-schema-layer.cjs');
const TABLES=Object.freeze(['team_ledger_check_snapshots','team_ledger_check_heads','team_ledger_check_events','team_ledger_check_grants']);
const definitions=db=>withoutEmptyRefundIntakeDefinitions(db,db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name GLOB 'ledger_check_*' OR name GLOB 'team_ledger_check_*' ORDER BY type,name").all().map(row=>({...row})));
function peelLedgerCheckSchema(db){
 ledgerCheckSchemaLayer(db);
 const before=definitions(db),names=before.map(row=>row.name);
 for(const row of before.filter(row=>row.type!=='table'))db.exec('DROP '+row.type+' "'+row.name+'"');
 for(const name of TABLES)db.exec('DROP TABLE "'+name+'"');
 assert.deepEqual(definitions(db),[]);
 return {definitions:before,names,tables:TABLES};
}
function assertLedgerCheckSchemaRestored(db,layer){
 assert.deepEqual(definitions(db),layer.definitions);
 ledgerCheckSchemaLayer(db);
}
module.exports={peelLedgerCheckSchema,assertLedgerCheckSchemaRestored};
