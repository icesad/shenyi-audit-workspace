import {createHash} from 'node:crypto';
import {ApiError} from './http-utils.mjs';
export const FORMALIZATION_MODE='owner-attested-local-source';
export const formalizationConflict=()=>{throw new ApiError(409,'WORKSPACE_FORMALIZATION_CONFLICT','来源、工作区或业务确认状态已改变，请只读核对原回执。');};
export const formalizationDigest=value=>createHash('sha256').update(value).digest('hex');
export function workspaceBusinessConfirmed(db,teamId,projectId){return !!db.prepare('SELECT 1 FROM team_workspace_formalizations WHERE team_id=? AND project_id=?').get(teamId,projectId);}
export function formalizationRequestUsed(db,requestId){
 return !!(db.prepare('SELECT 1 FROM team_workspace_formalizations WHERE request_id=?').get(requestId)||db.prepare('SELECT 1 FROM team_collection_workspace_creations WHERE request_id=?').get(requestId)||db.prepare('SELECT 1 FROM team_project_migration_provenance WHERE request_id=?').get(requestId)||db.prepare('SELECT 1 FROM team_project_access_projects WHERE request_id=?').get(requestId));
}
function integer(value,min){const n=Number(value);if(!Number.isSafeInteger(n)||n<min)formalizationConflict();return n;}
export function formalizationReceipt(row){
 if(!row||row.confirmation_mode!==FORMALIZATION_MODE)formalizationConflict();
 return {requestId:row.request_id,teamId:row.team_id,projectId:row.project_id,sourceProjectId:row.source_project_id,sourceTitle:row.source_title,sourceSha256:row.source_sha256,businessNumber:row.business_number,confirmedBy:row.confirmed_by,confirmedAt:integer(row.confirmed_at,0),projectRevisionBefore:integer(row.project_revision_before,1),projectRevisionAfter:integer(row.project_revision_after,2),confirmationMode:row.confirmation_mode};
}
