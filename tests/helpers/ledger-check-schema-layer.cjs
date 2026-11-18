'use strict';
const assert=require('node:assert/strict');
const {withoutEmptyRefundIntakeDefinitions}=require('./billing-refund-intake-schema-layer.cjs');
// The historical73/252 baseline remains pinned. Only this explicitly bounded
// new layer may be added to old component counts; no arbitrary offset is used.
function ledgerCheckSchemaLayer(db){
 const definitions=withoutEmptyRefundIntakeDefinitions(db,db.prepare("SELECT type,name FROM sqlite_schema WHERE name GLOB 'ledger_check_*' OR name GLOB 'team_ledger_check_*'").all());
 assert.equal(definitions.length,38);assert.equal(definitions.filter(x=>x.type==='trigger').length,33);assert.equal(definitions.filter(x=>x.type==='index').length,1);
 const tables=definitions.filter(x=>x.type==='table').map(x=>x.name).sort();assert.deepEqual(tables,['team_ledger_check_events','team_ledger_check_grants','team_ledger_check_heads','team_ledger_check_snapshots']);
 for(const name of tables)assert.equal(db.prepare('SELECT COUNT(*) n FROM '+name).get().n,0,'No default ledger grant, imported snapshot or receipt may be seeded');
 return {tables:tables.length,objects:definitions.length};
}
module.exports={ledgerCheckSchemaLayer};
