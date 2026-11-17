const assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {ledgerCheckSchemaLayer}=require('./ledger-check-schema-layer.cjs');
const {peelLedgerCheckSchema,assertLedgerCheckSchemaRestored}=require('./ledger-check-schema-peel.cjs');
const TABLES=Object.freeze(['team_workpaper_access_events','team_workpaper_access_grants']);
const definitions=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name GLOB 'workpaper_access_*' OR name GLOB 'team_workpaper_access_*' ORDER BY type,name").all().map(x=>({...x}));
function workpaperAccessSchemaLayer(db){
 const rows=definitions(db);assert.equal(rows.length,29);assert.equal(rows.filter(x=>x.type==='trigger').length,26);assert.equal(rows.filter(x=>x.type==='index').length,1);assert.deepEqual(rows.filter(x=>x.type==='table').map(x=>x.name),[...TABLES]);
 assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),'81ed73be0c51aa3f92717cb7e1d9f8faf9437a6d50891eb8b8c17fead29f6e4d','Only the reviewed exact workpaper ACL schema may be projected');
 for(const name of TABLES)assert.equal(db.prepare('SELECT COUNT(*) n FROM '+name).get().n,0,'No default workpaper authorization or audit may be seeded');return{tables:2,objects:29};
}
function laterTeamSchemaLayers(db){const ledger=ledgerCheckSchemaLayer(db),workpaper=workpaperAccessSchemaLayer(db);return{tables:ledger.tables+workpaper.tables,objects:ledger.objects+workpaper.objects};}
function peelLedgerAndWorkpaperSchema(db){
 // Validate both complete empty layers before the first DROP. Refuse active data.
 laterTeamSchemaLayers(db);const workpaper=definitions(db);
 for(const row of workpaper.filter(x=>x.type!=='table'))db.exec('DROP '+row.type+' "'+row.name+'"');for(const name of TABLES)db.exec('DROP TABLE "'+name+'"');assert.deepEqual(definitions(db),[]);
 const ledger=peelLedgerCheckSchema(db);return{...ledger,names:[...ledger.names,...workpaper.map(x=>x.name)],workpaper};
}
function assertLedgerAndWorkpaperSchemaRestored(db,layer){assertLedgerCheckSchemaRestored(db,layer);assert.deepEqual(definitions(db),layer.workpaper);workpaperAccessSchemaLayer(db);}
function withoutEmptyWorkpaperLayer(db,state){
 const rows=definitions(db);if(!rows.length)return state;workpaperAccessSchemaLayer(db);const names=new Set(rows.map(x=>x.name));return{...state,definitions:state.definitions.filter(x=>!names.has(x.name)),tables:state.tables.filter(x=>!TABLES.includes(x.name))};
}
module.exports={withoutEmptyWorkpaperLayer,workpaperAccessSchemaLayer,laterTeamSchemaLayers,peelLedgerAndWorkpaperSchema,assertLedgerAndWorkpaperSchemaRestored};
