import {createHash} from 'node:crypto';
import {ApiError} from './http-utils.mjs';

// Low-level facts only: project and material policies may depend on this module.
export const COLLECTION_WORKSPACE_KIND='collection-workspace';
export const workspaceCreationConflict=()=>{throw new ApiError(409,'WORKSPACE_CREATION_CONFLICT','创建标识或工作区状态已改变，请只读查询原创建回执。');};
export function collectionWorkspaceKind(db,teamId,projectId){
 const row=db.prepare('SELECT kind FROM team_collection_workspace_creations WHERE team_id=? AND project_id=?').get(teamId,projectId);
 if(row&&row.kind!==COLLECTION_WORKSPACE_KIND)throw Error('Invalid trusted workspace origin');return row?.kind??null;
}
export function collectionWorkspaceAbsentSql(projectAlias='project'){
 if(projectAlias!=='project')throw Error('Untrusted workspace SQL alias');
 return `NOT EXISTS(SELECT 1 FROM team_collection_workspace_creations collection_workspace WHERE collection_workspace.team_id=project.team_id AND collection_workspace.project_id=project.project_id)`;
}
export function workspaceCreationDigest({teamId,createdBy,title,read,manage,review}){
 const semantic={kind:COLLECTION_WORKSPACE_KIND,teamId,createdBy,title,read,manage,review};
 return createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
}
export function workspaceCreationRequestUsed(db,requestId){
 return !!(db.prepare('SELECT 1 FROM team_collection_workspace_creations WHERE request_id=?').get(requestId)
  ||db.prepare('SELECT 1 FROM team_project_migration_provenance WHERE request_id=?').get(requestId)
  ||db.prepare('SELECT 1 FROM team_project_access_projects WHERE request_id=?').get(requestId));
}
function integer(value,min){const number=Number(value);if(!Number.isSafeInteger(number)||number<min)workspaceCreationConflict();return number;}
export function workspaceCreationReceipt(row){
 if(!row||row.kind!==COLLECTION_WORKSPACE_KIND)workspaceCreationConflict();
 return {requestId:row.request_id,teamId:row.team_id,projectId:row.project_id,kind:row.kind,title:row.title,createdBy:row.created_by,
  read:row.can_read===1,manage:row.can_manage===1,review:row.can_review===1,createdProjectRevision:integer(row.created_project_revision,1),createdAt:integer(row.created_at,0)};
}
