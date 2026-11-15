import exportCodec from '../../shared/task-originals-export.cjs';
import {projectActor,currentActor,projectScope,projectTime} from './project-access-policy.mjs';
import {readTeamContext} from './repository.mjs';
import {collectionTaskScope} from './access-policy.mjs';
import {administratorBusinessEligibilitySql} from './administrator-business-role-policy.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {ApiError,ID,deny,invalid,json} from './http-utils.mjs';

const {selectionIds,makePlan,MAX_TOTAL_BYTES}=exportCodec;
const conflict=()=>{throw new ApiError(409,'TASK_EXPORT_CONFLICT','任务、项目版本或所选资料已改变，请刷新后重新选择。');};
function integer(value,minimum=0){const number=Number(value);if(!Number.isSafeInteger(number)||number<minimum)conflict();return number;}
function revision(value,minimum=0){if(typeof value!=='string'||!/^(?:0|[1-9]\d*)$/u.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<minimum)invalid();return Number(value);}
function query(url,review){
 const allowed=review?['revision','projectRevision','ids']:['revision','ids'];
 for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)invalid();
 if(url.pathname.length+url.search.length>4096)invalid();
 const raw=url.searchParams.get('ids');if(typeof raw!=='string'||!raw)invalid();
 let ids;try{ids=selectionIds(raw.split(','));}catch{invalid();}
 if(ids.join(',')!==raw)invalid();
 return {ids,revision:revision(url.searchParams.get('revision')),...(review?{projectRevision:revision(url.searchParams.get('projectRevision'),1)}:{})};
}
function routeOf(url){
 const own=/^\/api\/teams\/([^/]+)\/collection\/tasks\/([^/]+)\/export-plan$/.exec(url.pathname);
 if(own)return {kind:'own',teamId:own[1],taskId:own[2]};
 const review=/^\/api\/teams\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/export-plan$/.exec(url.pathname);
 return review?{kind:'project-review',teamId:review[1],projectId:review[2],taskId:review[3]}:null;
}
function selectionQuery(db,actor,route,ids){
 const review=route.kind==='project-review';
 const from=`FROM team_collection_tasks AS task
 JOIN team_projects AS project ON project.team_id=task.team_id AND project.project_id=task.project_id AND project.status IN ('active','frozen')
 ${review?'JOIN team_project_access_projects AS metadata ON metadata.team_id=project.team_id AND metadata.project_id=project.project_id':''}
 LEFT JOIN team_task_versions AS version ON version.team_id=task.team_id AND version.task_id=task.task_id
 JOIN team_task_submissions AS submission ON submission.team_id=task.team_id AND submission.task_id=task.task_id
 JOIN team_collection_attachments AS attachment ON attachment.team_id=submission.team_id AND attachment.task_id=submission.task_id AND attachment.attachment_id=submission.attachment_id
 ${review?'JOIN team_credentials AS submitter ON submitter.user_id=submission.submitted_by':''}`;
 let scope,where,parameters;
 if(review){
  scope=projectScope(actor,{projectAlias:'project',metadataAlias:'metadata',read:true,review:true});
  where=`${scope.sql} AND task.team_id=? AND project.project_id=? AND task.task_id=?`;
  parameters=[...scope.parameters,route.teamId,route.projectId,route.taskId];
 }else{
  const context=readTeamContext(db,actor,route.teamId);if(!context)deny();scope=collectionTaskScope(context);
  where=`${scope.sql} AND task.team_id=? AND task.task_id=? AND submission.submitted_by=?
  AND EXISTS (SELECT 1 FROM team_attachment_grants AS attachment_grant WHERE attachment_grant.team_id=attachment.team_id AND attachment_grant.attachment_id=attachment.attachment_id AND attachment_grant.user_id=? AND attachment_grant.status='active')
  AND EXISTS (SELECT 1 FROM team_memberships AS membership JOIN team_users AS account ON account.user_id=membership.user_id AND account.status='active' JOIN teams AS current_team ON current_team.team_id=membership.team_id AND current_team.status='active'
   WHERE membership.team_id=task.team_id AND membership.user_id=? AND membership.role=? AND membership.status='active' AND ${administratorBusinessEligibilitySql('membership')})`;
  parameters=[...scope.parameters,route.teamId,route.taskId,actor.userId,actor.userId,actor.userId,context.role];
 }
 where+=` AND submission.submission_id IN (${ids.map(()=>'?').join(',')})`;parameters.push(...ids);
 return {from,where,parameters,review};
}
function versions(row,expected,review){
 if(integer(row.task_revision)!==expected.revision)conflict();
 if(review&&integer(row.project_revision,1)!==expected.projectRevision)conflict();
}
function planFor(db,actor,route,expected){
 const sql=selectionQuery(db,actor,route,expected.ids);
 // No attachment bytes (or derived blob expression) are selected by a plan.
 const rows=db.prepare(`SELECT task.task_id,task.title AS task_title,task.instructions AS task_instructions,task.status AS task_status,
 CAST(COALESCE(version.revision,0) AS TEXT) AS task_revision,
 ${sql.review?'CAST(metadata.revision AS TEXT) AS project_revision,':''}
 submission.submission_id,submission.attachment_id,attachment.display_name,submission.content_sha256,
 CAST(submission.byte_length AS TEXT) AS byte_length,CAST(submission.created_at AS TEXT) AS created_at
 ${sql.review?',submission.submitted_by,submitter.display_name AS submitter_name':''}
 ${sql.from} WHERE ${sql.where} ORDER BY submission.submission_id COLLATE BINARY`).all(...sql.parameters);
 if(rows.length!==expected.ids.length||rows.some((row,index)=>row.submission_id!==expected.ids[index]))deny();
 const first=rows[0];versions(first,expected,sql.review);
 const files=rows.map(row=>({id:row.submission_id,attachmentId:row.attachment_id,filename:row.display_name,sha256:row.content_sha256,byteLength:integer(row.byte_length),createdAt:integer(row.created_at),
  ...(sql.review?{submittedBy:{id:row.submitted_by,displayName:safeMemberText(row.submitter_name,row.submitted_by)}}:{})}));
 if(files.reduce((sum,file)=>sum+file.byteLength,0)>MAX_TOTAL_BYTES)throw new ApiError(413,'EXPORT_TOO_LARGE','所选原件总量超过64 MiB，请减少本次选择。');
 return makePlan({scope:sql.review?{kind:'project-review',teamId:route.teamId,projectId:route.projectId,projectRevision:integer(first.project_revision,1),taskId:route.taskId}:{kind:'own',teamId:route.teamId,taskId:route.taskId,userId:actor.userId},
  task:{id:first.task_id,title:first.task_title,instructions:first.task_instructions,status:first.task_status,revision:integer(first.task_revision)},files});
}
function assertSelectionScope(db,actor,route,expected){
 const sql=selectionQuery(db,actor,route,expected.ids),row=db.prepare(`SELECT COUNT(*) AS export_count,CAST(COALESCE(version.revision,0) AS TEXT) AS task_revision${sql.review?',CAST(metadata.revision AS TEXT) AS project_revision':''}
 ${sql.from} WHERE ${sql.where} GROUP BY task.team_id,task.task_id`).get(...sql.parameters);
 if(!row||integer(row.export_count)!==expected.ids.length)deny();versions(row,expected,sql.review);
}
function readSnapshot(db,work){
 db.exec('BEGIN');let open=true;
 try{const result=work();db.exec('COMMIT');open=false;return result;}
 catch(error){if(open)try{db.exec('ROLLBACK');}catch{}throw error;}
}
export async function handleTaskOriginalsExportRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
 const url=new URL(request.url),route=routeOf(url);if(!route)return null;
 if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
 if(![route.teamId,route.taskId,...(route.projectId?[route.projectId]:[])].every(value=>ID.test(value)))deny();
 const expected=query(url,route.kind==='project-review'),options={identityProviders,deviceContext},actor=projectActor(db,request,options,projectTime(now()));
 const fresh=()=>currentActor(db,request,actor,options,projectTime(now()));
 const initial=readSnapshot(db,()=>planFor(db,fresh(),route,expected));
 // Release the business read snapshot before rechecking current authority.
 const current=planFor(db,fresh(),route,expected);if(current.sha256!==initial.sha256)conflict();
 assertSelectionScope(db,fresh(),route,expected);fresh();
 return json(initial);
}
