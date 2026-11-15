import {projectActor,projectContext,projectScope,projectQuery,projectTime} from './project-access-policy.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {ID,deny,invalid,json,PRIVATE_HEADERS} from './http-utils.mjs';

const FROM=`FROM team_projects AS project
 JOIN team_project_access_projects AS metadata ON metadata.team_id=project.team_id AND metadata.project_id=project.project_id
 JOIN team_collection_tasks AS task ON task.team_id=project.team_id AND task.project_id=project.project_id
 JOIN team_task_submissions AS submission ON submission.team_id=task.team_id AND submission.task_id=task.task_id
 JOIN team_collection_attachments AS attachment ON attachment.team_id=submission.team_id
  AND attachment.task_id=submission.task_id AND attachment.attachment_id=submission.attachment_id`;
const maximumBytes=12*1024*1024;
function integer(value){const result=Number(value);if(!Number.isSafeInteger(result)||result<0)throw Error('Invalid trusted submission integer');return result;}
function rowView(row){
 const byteLength=integer(row.byte_length),createdAt=integer(row.created_at);
 if(byteLength>maximumBytes||!ID.test(row.submission_id)||!ID.test(row.attachment_id)||!ID.test(row.submitted_by)
   ||typeof row.display_name!=='string'||!row.display_name||[...row.display_name].length>180||row.display_name!==row.display_name.toWellFormed()
   ||/[\x00-\x1f\x7f/\\]/u.test(row.display_name)||!/^[a-f0-9]{64}$/.test(row.content_sha256))throw Error('Invalid trusted submission');
 return {id:row.submission_id,attachmentId:row.attachment_id,filename:row.display_name,sha256:row.content_sha256,byteLength,createdAt,
  submittedBy:{id:row.submitted_by,displayName:safeMemberText(row.submitter_name,row.submitted_by)}};
}
function disposition(name){const value=[...String(name).toWellFormed().replace(/[\x00-\x1f\x7f/\\]/g,'_')].slice(0,180).join('');return "attachment; filename=\"download.bin\"; filename*=UTF-8''"+encodeURIComponent(value).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());}

export async function handleProjectReviewRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
 const url=new URL(request.url),match=/^\/api\/teams\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/submissions(?:\/([^/]+)\/file)?$/.exec(url.pathname);
 if(!match)return null;
 const [,teamId,projectId,taskId,submissionId]=match,file=!!submissionId;
 if(![teamId,projectId,taskId,...(file?[submissionId]:[])].every(value=>ID.test(value)))deny();
 if(request.method!=='GET'&&!(file&&request.method==='HEAD'))return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:file?'GET, HEAD':'GET'});
 if(file&&url.search)invalid();
 const actor=projectActor(db,request,{identityProviders,deviceContext},projectTime(now()));
 projectContext(db,actor,teamId,projectId,{read:true,review:true});
 const scope=projectScope(actor,{projectAlias:'project',metadataAlias:'metadata',read:true,review:true});
 const where=`${scope.sql} AND project.team_id=? AND project.project_id=? AND task.task_id=?`;
 const parameters=[...scope.parameters,teamId,projectId,taskId];
 // Both an empty task history and a populated one require the same scoped task
 // existence. Unknown tasks do not become a distinguishable empty list.
 if(!file){
  const query=projectQuery(url.searchParams,{allowQ:false});
  const task=db.prepare(`SELECT 1 FROM team_projects AS project
   JOIN team_project_access_projects AS metadata ON metadata.team_id=project.team_id AND metadata.project_id=project.project_id
   JOIN team_collection_tasks AS task ON task.team_id=project.team_id AND task.project_id=project.project_id
   WHERE ${where}`).get(...parameters);if(!task)deny();
  if(query.after&&!db.prepare(`SELECT 1 ${FROM} WHERE ${where} AND submission.submission_id=?`).get(...parameters,query.after))deny();
  const rows=db.prepare(`SELECT submission.submission_id,submission.attachment_id,attachment.display_name,
   submission.content_sha256,CAST(submission.byte_length AS TEXT) AS byte_length,
   CAST(submission.created_at AS TEXT) AS created_at,submission.submitted_by,credential.display_name AS submitter_name
   ${FROM} JOIN team_credentials AS credential ON credential.user_id=submission.submitted_by
   WHERE ${where} AND submission.submission_id>? ORDER BY submission.submission_id COLLATE BINARY LIMIT ?`)
   .all(...parameters,query.after,query.limit+1);
  return json({submissions:rows.slice(0,query.limit).map(rowView),hasMore:rows.length>query.limit});
 }
 // HEAD must authorize without selecting or materializing the attachment blob.
 const fields=request.method==='HEAD'?'attachment.display_name':'attachment.display_name,attachment.bytes';
 const row=db.prepare(`SELECT ${fields} ${FROM} WHERE ${where} AND submission.submission_id=?`).get(...parameters,submissionId);if(!row)deny();
 const headers={...PRIVATE_HEADERS,'Content-Type':'application/octet-stream','Content-Disposition':disposition(row.display_name)};
 if(request.method==='HEAD')return new Response(null,{headers});
 if(!(row.bytes instanceof Uint8Array)||row.bytes.byteLength>maximumBytes)throw Error('Invalid trusted original');
 return new Response(new Uint8Array(row.bytes),{headers});
}
