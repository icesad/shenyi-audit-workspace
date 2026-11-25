'use strict';
// Test-only historical reconstruction: never call on a database containing source grants/events.
const assert=require('node:assert/strict');
const OBJECTS=Object.freeze([{"type":"index","name":"workspace_source_grant_user"},{"type":"table","name":"team_workspace_source_events"},{"type":"table","name":"team_workspace_source_grants"},{"type":"trigger","name":"workspace_source_events_no_delete"},{"type":"trigger","name":"workspace_source_events_no_update"},{"type":"trigger","name":"workspace_source_grant_identity"},{"type":"trigger","name":"workspace_source_grant_initial"},{"type":"trigger","name":"workspace_source_grant_monotonic"},{"type":"trigger","name":"workspace_source_grant_no_delete"},{"type":"trigger","name":"workspace_source_qualification_account"},{"type":"trigger","name":"workspace_source_qualification_owner_delete"},{"type":"trigger","name":"workspace_source_qualification_owner_update"},{"type":"trigger","name":"workspace_source_qualification_project"},{"type":"trigger","name":"workspace_source_qualification_team"},{"type":"trigger","name":"workspace_source_qualification_team_access_reviewers_insert"},{"type":"trigger","name":"workspace_source_qualification_team_administrator_business_role_reviewers_insert"},{"type":"trigger","name":"workspace_source_qualification_team_administrator_business_roles_delete"},{"type":"trigger","name":"workspace_source_qualification_team_administrator_business_roles_insert"},{"type":"trigger","name":"workspace_source_qualification_team_administrator_business_roles_update"},{"type":"trigger","name":"workspace_source_qualification_team_device_replacement_reviewers_insert"},{"type":"trigger","name":"workspace_source_qualification_team_memberships_delete"},{"type":"trigger","name":"workspace_source_qualification_team_memberships_insert"},{"type":"trigger","name":"workspace_source_qualification_team_memberships_update"},{"type":"trigger","name":"workspace_source_qualification_team_operators_delete"},{"type":"trigger","name":"workspace_source_qualification_team_operators_insert"},{"type":"trigger","name":"workspace_source_qualification_team_operators_update"},{"type":"trigger","name":"workspace_source_qualification_team_platform_reviewers_insert"},{"type":"trigger","name":"workspace_source_qualification_team_project_migration_reviewers_insert"},{"type":"trigger","name":"workspace_source_qualification_team_recovery_reviewers_insert"}].map(Object.freeze));
const NAMES=Object.freeze(OBJECTS.map(x=>x.name));
const TABLES=Object.freeze(['team_workspace_source_events','team_workspace_source_grants']);
const definitions=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>({...row}));
function peelWorkspaceSourceSchema(db){
 const before=definitions(db).filter(row=>NAMES.includes(row.name));
 assert.deepEqual(before.map(({type,name})=>({type,name})),OBJECTS);
 assert.deepEqual(['table','trigger','index'].map(type=>before.filter(x=>x.type===type).length),[2,26,1]);
 for(const name of TABLES)assert.equal(db.prepare('SELECT COUNT(*) n FROM "'+name+'"').get().n,0,'Historical peel must not delete source data');
 for(const row of before.filter(x=>x.type!=='table'))db.exec('DROP '+row.type+' "'+row.name+'"');
 for(const name of TABLES)db.exec('DROP TABLE "'+name+'"');
 assert.deepEqual(definitions(db).filter(row=>NAMES.includes(row.name)),[]);
 return {definitions:before,names:NAMES,tables:TABLES};
}
function assertWorkspaceSourceSchemaRestored(db,layer){
 assert.deepEqual(definitions(db).filter(row=>NAMES.includes(row.name)),layer.definitions);
 for(const name of TABLES)assert.equal(db.prepare('SELECT COUNT(*) n FROM "'+name+'"').get().n,0);
}
module.exports={peelWorkspaceSourceSchema,assertWorkspaceSourceSchemaRestored,sourceSchemaNames:NAMES};
