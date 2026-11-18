'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{createHash,randomUUID}=require('node:crypto');
const {formFixture,source,restorePasswordWork}=require('./helpers/workpaper-form-fixture.cjs');
const {TABLES,subscriptionDefinitions,assertSubscriptionSchema,withoutEmptySubscriptionLayer,withoutEmptySubscriptionDefinitions,peelSubscriptionSchema,assertSubscriptionSchemaRestored}=require('./helpers/subscription-schema-layer.cjs');
const {withoutEmptyBillingLayer,peelBillingSchema,assertBillingSchemaRestored}=require('./helpers/billing-schema-layer.cjs');
const {withoutEmptySeatCapacityLayer,peelSeatCapacitySchema,assertSeatCapacitySchemaRestored}=require('./helpers/seat-capacity-schema-layer.cjs');

const {withoutEmptySeatOrderLayer,peelSeatOrderSchema,assertSeatOrderSchemaRestored}=require('./helpers/seat-order-schema-layer.cjs');
const {withoutEmptyAnnualSeatPlanLayer,peelAnnualSeatPlanSchema,assertAnnualSeatPlanSchemaRestored}=require('./helpers/annual-seat-plan-schema-layer.cjs');
after(restorePasswordWork);
const sha=value=>createHash('sha256').update(value).digest('hex');
const schema=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({...row}));
function state(db){
 const definitions=schema(db),tables=definitions.filter(x=>x.type==='table').map(({name})=>{const statement=db.prepare('SELECT * FROM "'+name+'"');statement.setReadBigInts(true);return{name,rows:statement.all().map(row=>JSON.stringify(Object.keys(row).sort().map(key=>{const value=row[key];return[key,typeof value==='bigint'?['integer',value.toString()]:value instanceof Uint8Array?['blob',Buffer.from(value).toString('base64')]:[value===null?'null':typeof value,value]];}))).sort()};});
 return{definitions,tables};
}
const rawSubscriptionRows=db=>Object.fromEntries(TABLES.map(name=>[name,db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all().map(row=>({...row}))]));
async function database(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());const {initializeTeamDatabase}=await source('database.mjs');initializeTeamDatabase(db);db.prepare("INSERT INTO teams VALUES (?,'active')").run('schema-subscription-team');return{db,initializeTeamDatabase};}
async function term(db,{teamId='schema-subscription-team',expectedRevision=0,endsAt=2000}={}){const {recordSubscriptionTerm}=await source('subscription-store.mjs');return recordSubscriptionTerm(db,{teamId,operationId:randomUUID(),expectedRevision,startsAt:500,endsAt,sourceRef:'synthetic-schema-preservation'},{now:()=>1000});}

test('old84 nonempty typed tables and342 DDL upgrade to86 with only the exact two empty subscription tables added',async t=>{
 const f=await formFixture(t,{kind:'xlsx',freeze:true}),{initializeTeamDatabase}=await source('database.mjs');
 const data=f.dataRows(),freeze=f.record.workpaperLocks[8];assert.equal(data.originals.length,2);assert.equal(data.heads.length,1);assert.equal(data.versions.length,1);assert.ok(freeze&&/^[a-f0-9]{64}$/.test(freeze.snapshotHash));
 assert.ok(data.versions[0].record_json.includes(freeze.snapshotHash));assert.ok(f.db.prepare('SELECT COUNT(*) n FROM team_users').get().n>=9);assert.ok(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_access_grants').get().n>0);
 const sourceId=f.sourceProjectId,workspaceId=f.projectId,packageSha=sha(f.bytes),originals=data.originals.map(row=>({...row,bytes:Buffer.from(row.bytes)})),serverId=f.db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value;
 const annualPlanLayer=peelAnnualSeatPlanSchema(f.db),seatOrderLayer=peelSeatOrderSchema(f.db),seatLayer=peelSeatCapacitySchema(f.db),billingLayer=peelBillingSchema(f.db),layer=peelSubscriptionSchema(f.db),before=state(f.db);assert.equal(before.tables.length,84);assert.equal(before.definitions.length,342);assert.deepEqual(subscriptionDefinitions(f.db),[]);
 initializeTeamDatabase(f.db);assertSubscriptionSchemaRestored(f.db,layer);assertBillingSchemaRestored(f.db,billingLayer);assertSeatCapacitySchemaRestored(f.db,seatLayer);assertSeatOrderSchemaRestored(f.db,seatOrderLayer);assertAnnualSeatPlanSchemaRestored(f.db,annualPlanLayer);const completeAfter=state(f.db),after=withoutEmptyBillingLayer(f.db,withoutEmptySeatCapacityLayer(f.db,withoutEmptySeatOrderLayer(f.db,withoutEmptyAnnualSeatPlanLayer(f.db,completeAfter))));assert.equal(after.tables.length,86);assert.equal(after.definitions.length,346);assert.deepEqual(withoutEmptySubscriptionLayer(f.db,after),before);assert.deepEqual(rawSubscriptionRows(f.db),{team_subscription_events:[],team_subscription_heads:[]});
 assert.deepEqual(f.dataRows(),data);assert.deepEqual(f.dataRows().originals.map(row=>({...row,bytes:Buffer.from(row.bytes)})),originals);assert.equal(f.sourceProjectId,sourceId);assert.equal(f.projectId,workspaceId);assert.equal(sha(f.bytes),packageSha);assert.equal(f.db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value,serverId);assert.equal(f.record.workpaperLocks[8].snapshotHash,freeze.snapshotHash);
 initializeTeamDatabase(f.db);assert.deepEqual(state(f.db),completeAfter);assert.deepEqual(rawSubscriptionRows(f.db),{team_subscription_events:[],team_subscription_heads:[]});assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('nonempty persisted subscription history and latest head survive repeated initialization and cannot be projected away',async t=>{
 const {db,initializeTeamDatabase}=await database(t);await term(db);await term(db,{expectedRevision:1,endsAt:3000});const {readSubscriptionState}=await source('subscription-store.mjs'),actual=readSubscriptionState(db,'schema-subscription-team',1000),before=state(db),rows=rawSubscriptionRows(db);
 assert.equal(rows.team_subscription_events.length,2);assert.equal(rows.team_subscription_heads.length,1);assert.equal(rows.team_subscription_heads[0].revision,2);assertSubscriptionSchema(db,{empty:false});
 for(const action of [()=>withoutEmptySubscriptionDefinitions(db,schema(db)),()=>withoutEmptySubscriptionLayer(db,before),()=>peelSubscriptionSchema(db)]){assert.throws(action,/No default subscription/);assert.deepEqual(state(db),before);}
 initializeTeamDatabase(db);assert.deepEqual(state(db),before);assert.deepEqual(rawSubscriptionRows(db),rows);assert.deepEqual(readSubscriptionState(db,'schema-subscription-team',1000),actual);initializeTeamDatabase(db);assert.deepEqual(state(db),before);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

for(const kind of ['event-without-head','head-without-event'])test('retained '+kind+' is never fabricated or repaired by initialization and trusted store fails closed',async t=>{
 const {db,initializeTeamDatabase}=await database(t);await term(db);
 if(kind==='event-without-head')db.exec('DELETE FROM team_subscription_heads');else{const trigger=db.prepare("SELECT sql FROM sqlite_schema WHERE name='subscription_events_no_delete'").get().sql;db.exec('PRAGMA foreign_keys=OFF; DROP TRIGGER subscription_events_no_delete; DELETE FROM team_subscription_events');db.exec(trigger);db.exec('PRAGMA foreign_keys=ON');}
 assertSubscriptionSchema(db,{empty:false});const before=state(db),rows=rawSubscriptionRows(db),serverId=db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value;
 initializeTeamDatabase(db);assert.deepEqual(state(db),before);assert.deepEqual(rawSubscriptionRows(db),rows);assert.equal(db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value,serverId);
 const {readSubscriptionState}=await source('subscription-store.mjs');assert.throws(()=>readSubscriptionState(db,'schema-subscription-team',1000),error=>error.status===409);assert.deepEqual(state(db),before);
});

for(const kind of ['extra-object','changed-immutable-guard'])test('empty '+kind+' subscription DDL is rejected before historical projection or destructive peel',async t=>{
 const {db}=await database(t);if(kind==='extra-object')db.exec('CREATE INDEX unexpected_unprefixed_on_m5 ON team_subscription_events(team_id)');else db.exec('DROP TRIGGER subscription_events_no_delete; CREATE TRIGGER subscription_events_no_delete BEFORE DELETE ON team_subscription_events BEGIN SELECT 1; END');const before=state(db),schemaVersion=db.prepare('PRAGMA schema_version').get().schema_version,totalChanges=db.prepare('SELECT total_changes() n').get().n;
 for(const action of [()=>withoutEmptySubscriptionDefinitions(db,schema(db)),()=>withoutEmptySubscriptionLayer(db,before),()=>peelSubscriptionSchema(db)]){assert.throws(action);assert.deepEqual(state(db),before);assert.equal(db.prepare('PRAGMA schema_version').get().schema_version,schemaVersion);assert.equal(db.prepare('SELECT total_changes() n').get().n,totalChanges);}
});
