import codec from '../../dist/workpaper-package.js';
import {resolveWorkspaceSource} from './workspace-source-resolver.mjs';
import {workpaperAccessContext,workpaperAccessContextStamp,workpaperAccessDigest} from './workpaper-access-policy.mjs';
import {projectTime,projectRevision} from './project-access-policy.mjs';
import {ApiError,ID,deny,invalid} from './http-utils.mjs';
export const CHUNK_BYTES=1048576,CHUNK_BODY=1500*1024,PACKAGE_BYTES=codec.LIMITS.packageBytes,STAGING_BYTES=2*PACKAGE_BYTES,STAGE_TTL=30*60000;
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,SHA=/^[a-f0-9]{64}$/;
export const dataDigest=workpaperAccessDigest;
export const dataConflict=()=>{throw new ApiError(409,'WORKPAPER_DATA_CONFLICT','底稿版本、来源或授权已改变，请刷新或查询原操作回执。');};
export function dataHead(db,teamId,projectId){
 const row=db.prepare('SELECT team_id,project_id,revision,source_project_id,identity_stamp,source_record_revision,source_record_sha256,source_manifest_sha256,source_package_sha256,imported_by,imported_at FROM team_workpaper_data_heads WHERE team_id=? AND project_id=?').get(teamId,projectId);
 const last=db.prepare('SELECT MAX(version) version FROM team_workpaper_data_versions WHERE team_id=? AND project_id=?').get(teamId,projectId);
 if((row?.revision??0)!==(last.version??0))dataConflict();if(row)projectRevision(row.revision);return row;
}
export function dataContext(db,actor,teamId,projectId,options={}){
 const base=workpaperAccessContext(db,actor,teamId,projectId,options),source=resolveWorkspaceSource(db,teamId,projectId);if(!source)deny();
 const identity={sourceProjectId:source.sourceProjectId,stamp:source.stamp};return {...base,identity};
}
export const dataContextStamp=context=>dataDigest(JSON.stringify({access:workpaperAccessContextStamp(context),identity:context.identity}));
export function emptyData(db,teamId,projectId){if(dataHead(db,teamId,projectId)||db.prepare('SELECT 1 FROM team_workpaper_data_originals WHERE team_id=? AND project_id=? LIMIT 1').get(teamId,projectId))dataConflict();}
export function dataStage(db,actor,context,requestId,at){
 const row=db.prepare('SELECT * FROM team_workpaper_data_imports WHERE request_id=? AND team_id=? AND project_id=? AND actor_id=?').get(requestId,context.project.teamId,context.project.id,actor.userId);
 if(!row)deny();if(row.status==='expired'||row.status==='active'&&row.expires_at<=projectTime(at))throw new ApiError(410,'WORKPAPER_IMPORT_EXPIRED','临时底稿导入已到期，请重新选择。');
 if(row.status!=='active'||row.session_hash!==dataDigest(actor.token)||row.lease_id!==actor.leaseId||row.actor_stamp!==actor.stamp||row.context_stamp!==dataContextStamp(context)||row.project_revision!==context.project.revision||row.grant_revision!==context.grant.revision||row.source_project_id!==context.identity.sourceProjectId||row.identity_stamp!==context.identity.stamp)dataConflict();
 emptyData(db,context.project.teamId,context.project.id);return row;
}
export const stageStamp=row=>dataDigest(JSON.stringify(row));
export const ENTRIES_BODY=1500*1024;
export const entryHeadStamp=head=>dataDigest(JSON.stringify({revision:head.revision,sourceProjectId:head.source_project_id,identityStamp:head.identity_stamp,sourcePackageSha256:head.source_package_sha256}));
export function workpaperDataBodyPolicy(db,request,actor,prior,at){
 const entryUrl=new URL(request.url),entry=/^\/api\/teams\/([^/]+)\/projects\/([^/]+)\/workpapers\/entries\/([^/]+)$/.exec(entryUrl.pathname);
 if(entry&&request.method==='POST'){const [,teamId,projectId,hash]=entry;if(!ID.test(teamId)||!ID.test(projectId)||!SHA.test(hash)||hash.length!==64||entryUrl.search||entryUrl.hash||entryUrl.href.endsWith('?'))invalid();const context=dataContext(db,actor,teamId,projectId,{read:true,write:true,active:true}),head=dataHead(db,teamId,projectId);if(!head)deny();if(head.source_project_id!==context.identity.sourceProjectId||head.identity_stamp!==context.identity.stamp||head.revision>=Number.MAX_SAFE_INTEGER)dataConflict();return{...prior,maximum:ENTRIES_BODY,workpaperDataStamp:dataContextStamp(context),workpaperStageStamp:entryHeadStamp(head),workpaperDataPermit:'large'};}
 const url=new URL(request.url),m=/^\/api\/teams\/([^/]+)\/projects\/([^/]+)\/workpapers\/imports(?:\/([^/]+)(?:\/(commit|chunks\/([^/]+)))?)?$/.exec(url.pathname);
 if(!m||!['POST','PUT','DELETE'].includes(request.method))return prior;
 const [,teamId,projectId,requestId,tail,index]=m;if(!ID.test(teamId)||!ID.test(projectId)||url.search||requestId&&!UUID.test(requestId))invalid();
 const creating=!requestId&&request.method==='POST',committing=tail==='commit'&&request.method==='POST',chunk=index!==undefined&&request.method==='PUT',cancel=requestId&&!tail&&request.method==='DELETE';
 if(!creating&&!committing&&!chunk&&!cancel)return {...prior,maximum:4096};
 const context=dataContext(db,actor,teamId,projectId,{owner:true,read:true,...(!cancel?{write:true,active:true}:{})});
 let row;if(!cancel){emptyData(db,teamId,projectId);if(requestId)row=dataStage(db,actor,context,requestId,at);}
 if(chunk&&(!/^(?:0|[1-9]\d*)$/.test(index)||!Number.isSafeInteger(Number(index))||Number(index)>=row.chunk_count))invalid();
 return {...prior,maximum:chunk?CHUNK_BODY:4096,workpaperDataStamp:dataContextStamp(context),workpaperStageStamp:row?stageStamp(row):null,workpaperDataPermit:chunk?'body':committing?'large':null};
}
