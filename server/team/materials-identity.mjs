import {createHash} from 'node:crypto';
import codec from '../../dist/legacy-project-source.js';
import {deny} from './http-utils.mjs';

// Resource identity is always the route's team/project. Only validated source
// content uses the historical quote identity. This module has no ACL dependency.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/,MODE='owner-attested-local-source';
const digest=value=>createHash('sha256').update(value).digest('hex');
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
export function materialIdentitySql(projectAlias='project'){
 if(projectAlias!=='project')throw Error('Untrusted material identity SQL alias');
 const absent=`NOT EXISTS(SELECT 1 FROM team_collection_workspace_creations identity_creation WHERE identity_creation.project_id=project.project_id) AND NOT EXISTS(SELECT 1 FROM team_workspace_formalizations identity_formal WHERE identity_formal.project_id=project.project_id)`;
 const confirmed=`EXISTS(SELECT 1 FROM team_collection_workspace_creations identity_creation JOIN team_workspace_formalizations identity_formal ON identity_formal.team_id=identity_creation.team_id AND identity_formal.project_id=identity_creation.project_id JOIN team_project_access_projects identity_metadata ON identity_metadata.team_id=identity_creation.team_id AND identity_metadata.project_id=identity_creation.project_id
 WHERE identity_creation.team_id=project.team_id AND identity_creation.project_id=project.project_id AND identity_creation.kind='collection-workspace'
 AND identity_creation.created_by=identity_metadata.created_by AND identity_creation.created_at=identity_metadata.created_at AND identity_creation.request_id=identity_metadata.request_id AND identity_creation.request_sha256=identity_metadata.request_sha256
 AND identity_formal.confirmed_by=identity_creation.created_by AND identity_formal.confirmation_mode='owner-attested-local-source' AND identity_formal.project_revision_before>=identity_creation.created_project_revision AND identity_formal.project_revision_after=identity_formal.project_revision_before+1 AND identity_metadata.revision>=identity_formal.project_revision_after
 AND NOT EXISTS(SELECT 1 FROM team_project_migration_provenance identity_migration WHERE identity_migration.project_id=project.project_id OR identity_migration.project_id=identity_formal.source_project_id)
 AND CASE WHEN json_valid(identity_formal.source_json) THEN json_extract(identity_formal.source_json,'$.initiation.quoteId')=identity_formal.source_project_id AND json_extract(identity_formal.source_json,'$.quote.id')=identity_formal.source_project_id AND json_extract(identity_formal.source_json,'$.numbering.identity.projectId')=identity_formal.source_project_id AND json_extract(identity_formal.source_json,'$.numbering.businessNumber')=identity_formal.business_number AND json_extract(identity_formal.source_json,'$.numbering.identity.year')=identity_formal.number_year AND json_extract(identity_formal.source_json,'$.numbering.identity.sequence')=identity_formal.number_sequence ELSE 0 END)`;
 return `((${absent}) OR ${confirmed})`;
}
export function materialIdentity(db,teamId,projectId,{importing=false}={}){
 const creation=db.prepare('SELECT * FROM team_collection_workspace_creations WHERE project_id=?').get(projectId),formal=db.prepare('SELECT * FROM team_workspace_formalizations WHERE project_id=?').get(projectId);
 if(!creation&&!formal){
  if(importing&&!db.prepare('SELECT 1 FROM team_project_migration_provenance WHERE team_id=? AND project_id=?').get(teamId,projectId))deny();
  return {workspace:false,sourceProjectId:projectId,stamp:digest(JSON.stringify({teamId,projectId,kind:'legacy'}))};
 }
 if(!creation||!formal||creation.team_id!==teamId||formal.team_id!==teamId||creation.kind!=='collection-workspace'||formal.confirmation_mode!==MODE||!UUID.test(formal.source_project_id??'')||!UUID.test(formal.request_id??'')||!SHA.test(formal.source_sha256??'')||!SHA.test(formal.request_sha256??''))deny();
 const metadata=db.prepare('SELECT * FROM team_project_access_projects WHERE team_id=? AND project_id=?').get(teamId,projectId);
 if(!metadata||metadata.created_by!==creation.created_by||metadata.created_at!==creation.created_at||metadata.request_id!==creation.request_id||metadata.request_sha256!==creation.request_sha256||formal.confirmed_by!==creation.created_by
 ||!integer(creation.created_project_revision,1)||!integer(formal.project_revision_before,1)||!integer(formal.project_revision_after,2)||formal.project_revision_after!==formal.project_revision_before+1||formal.project_revision_before<creation.created_project_revision||!integer(metadata.revision,1)||metadata.revision<formal.project_revision_after||!integer(formal.confirmed_at)
 ||db.prepare('SELECT 1 FROM team_project_migration_provenance WHERE project_id=? OR project_id=?').get(projectId,formal.source_project_id))deny();
 let source,encoded,summary;
 try{source=codec.validate(JSON.parse(formal.source_json));encoded=Buffer.from(codec.encode(source)).toString('utf8');summary=codec.summary(source);}catch{deny();}
 if(encoded!==formal.source_json||digest(encoded)!==formal.source_sha256||summary.projectId!==formal.source_project_id||summary.title!==formal.source_title||summary.businessNumber!==formal.business_number||source.numbering.identity.year!==formal.number_year||source.numbering.identity.sequence!==formal.number_sequence||summary.firstWonAt!==formal.first_won_at||summary.initiationWonAt!==formal.initiation_won_at||summary.latestWonAt!==formal.latest_won_at)deny();
 const semantic=digest(JSON.stringify({teamId,projectId,confirmedBy:formal.confirmed_by,projectRevision:formal.project_revision_before,sourceSha256:formal.source_sha256,confirmationMode:MODE}));if(semantic!==formal.request_sha256)deny();
 // No current account/owner/credential facts belong to this historical stamp.
 return {workspace:true,sourceProjectId:formal.source_project_id,stamp:digest(JSON.stringify({creation,formal}))};
}
export function materialRecordIdentity(record,identity){if(!record||record.project?.quoteId!==identity.sourceProjectId)deny();return record;}
