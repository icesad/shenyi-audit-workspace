import {createHash} from 'node:crypto';
import codec from '../../dist/legacy-project-source.js';
import {materialIdentity} from './materials-identity.mjs';
import {deny} from './http-utils.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const integer=value=>Number.isSafeInteger(value)&&value>=0;
export function resolveWorkspaceSource(db,teamId,projectId){
 const creation=db.prepare('SELECT * FROM team_collection_workspace_creations WHERE project_id=?').get(projectId),formal=db.prepare('SELECT * FROM team_workspace_formalizations WHERE project_id=?').get(projectId),migration=db.prepare('SELECT * FROM team_project_migration_provenance WHERE project_id=?').get(projectId);
 if(creation&&!formal){if(creation.team_id!==teamId||migration)deny();return null;}
 let row,sourceKind,sourceProjectId,stampFacts;
 if(creation||formal){
  if(!creation||!formal||migration)deny();const identity=materialIdentity(db,teamId,projectId);if(!identity.workspace)deny();
  row=formal;sourceKind='workspace-formalization';sourceProjectId=formal.source_project_id;stampFacts={creation,formal};
 }else if(migration){
  if(migration.team_id!==teamId||!UUID.test(migration.request_id??'')||!UUID.test(projectId)||!integer(migration.registered_at)||migration.original_creator_known!==0)deny();
  const metadata=db.prepare('SELECT * FROM team_project_access_projects WHERE team_id=? AND project_id=?').get(teamId,projectId);
  if(!metadata||metadata.created_by!==migration.owner_user_id||metadata.request_id!==migration.request_id||metadata.request_sha256!==migration.source_sha256||db.prepare('SELECT 1 FROM team_workspace_formalizations WHERE source_project_id=?').get(projectId))deny();
  row=migration;sourceKind='project-migration';sourceProjectId=projectId;stampFacts={migration};
 }else return null;
 let source,bytes,summary;
 try{source=codec.validate(JSON.parse(row.source_json));bytes=Buffer.from(codec.encode(source));summary=codec.summary(source);}catch{deny();}
 if(bytes.length<1||bytes.length>codec.MAX_BYTES||bytes.toString('utf8')!==row.source_json||digest(bytes)!==row.source_sha256||summary.projectId!==sourceProjectId||summary.businessNumber!==row.business_number||source.numbering.identity.year!==row.number_year||source.numbering.identity.sequence!==row.number_sequence)deny();
 if(sourceKind==='project-migration'&&summary.legacyManagerName!==row.legacy_manager_name)deny();
 return {source,bytes,sourceKind,sourceProjectId,sourceSha256:row.source_sha256,byteLength:bytes.length,stamp:digest(JSON.stringify(stampFacts))};
}
