'use strict';
// Synthetic strict-app fixtures. All mutations use genuine device request signatures.
const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {createProjectAccessFixture,PASSWORD,source}=require('./project-access-fixture.cjs');
const {createProjectMigrationFixture,migrationSource,REVIEWER}=require('./project-migration-fixture.cjs');
const codec=require('../../dist/legacy-project-source.js');
const uuid=()=>randomUUID(),sha=v=>createHash('sha256').update(v).digest('hex');
const businessPattern=/^(?:teams$|team_(?:projects$|project_|collection_|task_|attachment_|activity$|workspace_|material_|workpaper_|ledger_))/;
function snapshot(db){return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().filter(r=>businessPattern.test(r.name)).map(({name})=>{const s=db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"');s.setReadBigInts(true);return{name,rows:s.all().map(row=>JSON.stringify(Object.keys(row).sort().map(k=>{const v=row[k];return[k,typeof v==='bigint'?['integer',v.toString()]:v instanceof Uint8Array?['blob',Buffer.from(v).toString('base64')]:[typeof v,v]];}))).sort()};});}
async function workflowFixture(t,kind){
 const f=kind==='migration'?await createProjectMigrationFixture(t):await createProjectAccessFixture(t,{register:kind!=='formalization'});
 const actor=await f.ready(kind==='migration'?REVIEWER:'manager-a'),{handleTeamApplicationRequest}=await source('application-api.mjs'),store=await source('subscription-store.mjs');
 const run=async(operation,{mode='business-data-v1',raw}={})=>{const request=raw??f.makeRequest(operation.route,{method:'POST',session:operation.actor,body:operation.body}),response=await handleTeamApplicationRequest(request,{db:f.db,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true},subscriptionEnforcement:mode}),bytes=Buffer.from(await response.arrayBuffer());return{status:response.status,data:bytes.length?JSON.parse(bytes):null,bytes,headers:response.headers};};
 const read=async(route,current=actor)=>{const r=await handleTeamApplicationRequest(f.makeRequest(route,{session:current}),{db:f.db,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true},subscriptionEnforcement:'business-data-v1'});const bytes=Buffer.from(await r.arrayBuffer());return{status:r.status,data:bytes.length?JSON.parse(bytes):null};};
 const term=(extra={})=>store.recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:uuid(),expectedRevision:0,startsAt:f.clock.value-1000,endsAt:f.clock.value+10000,sourceRef:'synthetic-workflow-subscription',...extra},{now:()=>f.clock.value});
 let operation,projectId='project-a',intern,uploaded;
 if(kind==='submission'||kind==='return'){
  intern=await f.ready('intern-a');
  if(kind==='return')uploaded=await f.upload(intern);
  const revision=Number(f.db.prepare("SELECT COALESCE((SELECT revision FROM team_task_versions WHERE team_id='team-a' AND task_id='task-a'),0) revision").get().revision);
  operation={route:'/api/teams/team-a/collection/tasks/task-a/'+(kind==='submission'?'submissions':'return'),actor:kind==='submission'?intern:actor,body:kind==='submission'?{filename:'synthetic-expiry.bin',contentBase64:Buffer.from('Synthetic expiry original\0原件').toString('base64'),revision}:{revision},status:kind==='submission'?201:200,marker:'INSERT INTO team_activity'};
 }else if(kind==='task')operation={route:f.route()+'/tasks',actor,body:{revision:f.revision(),title:'Synthetic subscription collection task',instructions:'Synthetic signed write'},status:201,marker:'INSERT INTO team_project_access_events'};
 else if(kind==='formalization'){
  const made=await f.api('/api/teams/team-a/collection-workspaces',{method:'POST',session:actor,body:{requestId:uuid(),title:'Synthetic pending formalization',read:true,manage:true,review:true,currentPassword:PASSWORD}});assert.equal(made.status,201,JSON.stringify(made.data));projectId=made.data.receipt.projectId;const sourceValue=migrationSource({id:uuid(),sequence:47});
  operation={route:f.route(projectId)+'/formalization',actor,body:{requestId:uuid(),source:sourceValue,sourceSha256:sha(codec.encode(sourceValue)),projectRevision:f.revision(projectId),currentPassword:PASSWORD,businessConfirmed:true},status:201,marker:'INSERT INTO team_workspace_formalizations('};
 }else if(kind==='migration')operation={route:'/api/project-migrations',actor,body:f.body({source:migrationSource({id:uuid(),sequence:48})}),status:201,marker:'INSERT INTO team_project_migration_events('};
 else throw Error('Unknown owned workflow');
 return{...f,actor,intern,uploaded,kind,operation,projectId,run,read,term,store,business:()=>snapshot(f.db)};
}
module.exports={workflowFixture,snapshot,PASSWORD,source,uuid};
