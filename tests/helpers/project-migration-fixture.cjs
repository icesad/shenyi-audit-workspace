'use strict';
// Synthetic only. All requests use the existing genuine strict Ed25519 fixture.
const {randomUUID}=require('node:crypto'),C=require('../../dist/legacy-project-source.js');
const {source:legacySource}=require('./legacy-project-source-fixture.cjs');
const {createAdministratorBusinessRoleFixture,PASSWORD,NOW,keyPair,digest,source}=require('./administrator-business-role-fixture.cjs');
const REVIEWER='project-migration-reviewer-demo';
function migrationSource({id,sequence}={}){const value=legacySource();if(id){value.initiation.quoteId=id;value.initiation.source.quoteId=id;value.quote.id=id;value.numbering.identity.projectId=id;}if(sequence){value.numbering.identity.sequence=sequence;value.numbering.businessNumber='2026-B-专项审计-'+String(sequence).padStart(4,'0');}return C.validate(value);}
async function createProjectMigrationFixture(t,options={}){
 const f=await createAdministratorBusinessRoleFixture(t,options);await(await source('migration-demo.mjs')).seedProjectMigrationDemo(f.db);
 const body=({source:migration=migrationSource(),teamId='team-a',ownerUserId='manager-a',...fields}={})=>({requestId:randomUUID(),source:migration,sourceSha256:digest(C.encode(migration)),teamId,ownerUserId,ownerRevision:f.epoch(ownerUserId),read:true,manage:true,review:true,currentPassword:PASSWORD,...fields});
 const register=(actor,settings={})=>f.api('/api/project-migrations',{method:'POST',session:actor,body:body(settings)});
 return {...f,body,register,migrationSource};
}
module.exports={createProjectMigrationFixture,migrationSource,REVIEWER,PASSWORD,NOW,keyPair,digest,source};
