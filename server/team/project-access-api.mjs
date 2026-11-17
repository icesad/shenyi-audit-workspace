import {administratorBusinessEligibilitySql} from './administrator-business-role-policy.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {consume,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {projectActor,currentActor,ordinaryTeamContext,projectContext,projectScope,projectView,managedProject,projectQuery,projectRevision,projectIncrement,projectTime,projectConflict,projectAudit} from './project-access-policy.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
import {noReviewerHistorySql} from './reviewer-policy.mjs';
import {hasWorkspaceSourceGrantFlags,revokeWorkspaceSourceAccess} from './workspace-source-grant.mjs';
import {hasLedgerGrantFlags,revokeLedgerAccess} from './ledger-check-grant.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const method=allow=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow});
const like=value=>'%'+value.replace(/[\\%_]/g,char=>'\\'+char)+'%';
const FROM='FROM team_projects project JOIN team_project_access_projects metadata ON metadata.team_id=project.team_id AND metadata.project_id=project.project_id';
function sameProject(db,request,actor,options,teamId,projectId,before,revision,permissions){
 const freshActor=currentActor(db,request,actor,options,projectTime(options.now())),context=projectContext(db,freshActor,teamId,projectId,permissions);
 if(context.member.stamp!==before.member.stamp||context.project.revision!==revision||context.project.revision!==before.project.revision)projectConflict();return context;
}
function taskText(value,max,required,multiline=false){if(typeof value!=='string'||!value.isWellFormed()||[...value].length>max||required&&!value.trim())invalid();const checked=multiline?value.replace(/[\r\n\t]/g,''):value;if(/[\p{Cc}\p{Cf}]/u.test(checked))invalid();return multiline?value:value.trim();}
function targetMember(db,actorId,teamId,userId){if(userId===actorId)deny();const context=ordinaryTeamContext(db,userId,teamId);if(!context)deny();return context;}
function accessFlags(db,teamId,projectId,userId){
 const legacy=db.prepare("SELECT permission FROM team_project_grants WHERE team_id=? AND project_id=? AND user_id=? AND status='active'").all(teamId,projectId,userId),acl=db.prepare("SELECT permission FROM team_project_access_grants WHERE team_id=? AND project_id=? AND user_id=? AND status='active'").all(teamId,projectId,userId);
 return {read:legacy.some(row=>row.permission==='collection.read'),manage:legacy.some(row=>row.permission==='collection.manage'),review:acl.some(row=>row.permission==='collection.review')};
}
const CANDIDATE_FROM=`FROM team_memberships member JOIN team_users account ON account.user_id=member.user_id
 JOIN teams team ON team.team_id=member.team_id JOIN team_credentials credential ON credential.user_id=member.user_id
 LEFT JOIN team_recovery_identity_epochs epoch ON epoch.user_id=member.user_id`;
const CANDIDATE_SCOPE=`member.team_id=? AND member.user_id<>? AND member.status='active' AND member.role IN ('manager','partner') AND account.status='active' AND team.status='active'
 AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=member.user_id)=1
 AND ${administratorBusinessEligibilitySql('member')}
 AND ${noReviewerHistorySql('member.user_id')}`;
function members(db,actorId,teamId,projectId,{q,after,limit}){
 const ownerScope=projectScope({userId:actorId},{owner:true}),from=`${CANDIDATE_FROM} JOIN team_projects project ON project.team_id=member.team_id AND project.project_id=?
 JOIN team_project_access_projects metadata ON metadata.team_id=project.team_id AND metadata.project_id=project.project_id`,search=q?" AND credential.display_name LIKE ? ESCAPE '\\'":'',parameters=[projectId,teamId,actorId,...ownerScope.parameters,...(q?[like(q)]:[])],where=`${CANDIDATE_SCOPE} AND ${ownerScope.sql}`;
 if(after&&!db.prepare(`SELECT 1 ${from} WHERE ${where}${search} AND member.user_id=?`).get(...parameters,after))deny();
 const rows=db.prepare(`SELECT member.user_id,member.role,account.status,credential.display_name,CAST(COALESCE(epoch.version,0) AS TEXT) AS revision
 ${from} WHERE ${where}${search} AND member.user_id>? ORDER BY member.user_id COLLATE BINARY LIMIT ?`).all(...parameters,after,limit+1);
 projectContext(db,{userId:actorId},teamId,projectId,{owner:true});
 return {members:rows.slice(0,limit).map(row=>({id:row.user_id,displayName:safeMemberText(row.display_name,row.user_id),role:row.role,status:row.status,revision:projectRevision(row.revision,0),...accessFlags(db,teamId,projectId,row.user_id)})),hasMore:rows.length>limit};
}
function accessOperations(db,teamId,projectId,userId,desired){
 const operations=[];
 for(const permission of ['collection.read','collection.manage']){const row=db.prepare('SELECT status FROM team_project_grants WHERE team_id=? AND project_id=? AND user_id=? AND permission=?').get(teamId,projectId,userId,permission),active=row?.status==='active',want=desired[permission==='collection.read'?'read':'manage'];if(active!==want)operations.push({table:'team_project_grants',permission,row,want});}
 const acl=db.prepare('SELECT permission,status,CAST(revision AS TEXT) AS revision FROM team_project_access_grants WHERE team_id=? AND project_id=? AND user_id=?').all(teamId,projectId,userId);
 if(!desired.read){for(const row of acl)if(row.status==='active'){projectIncrement(row.revision);operations.push({table:'team_project_access_grants',permission:row.permission,row,want:false});}}
 else{const row=acl.find(item=>item.permission==='collection.review');if((row?.status==='active')!==desired.review){if(row)projectIncrement(row.revision);operations.push({table:'team_project_access_grants',permission:'collection.review',row,want:desired.review});}}
 return operations;
}
function revokeTasks(db,teamId,projectId,userId){
 return db.prepare(`SELECT DISTINCT task.task_id,CAST(COALESCE(version.revision,0) AS TEXT) AS revision
 FROM team_collection_tasks task JOIN team_task_assignments assignment ON assignment.team_id=task.team_id AND assignment.task_id=task.task_id
 LEFT JOIN team_task_versions version ON version.team_id=task.team_id AND version.task_id=task.task_id
 WHERE task.team_id=? AND task.project_id=? AND assignment.user_id=? AND assignment.status='active'`).all(teamId,projectId,userId).map(row=>({...row,revision:projectRevision(row.revision,0),next:projectIncrement(row.revision,0)}));
}
function changeAccess(db,actor,context,target,desired,at){
 const {teamId,id:projectId,revision:beforeRevision}=context.project,userId=target.userId,operations=accessOperations(db,teamId,projectId,userId,desired),tasks=desired.read?[]:revokeTasks(db,teamId,projectId,userId),attachments=desired.read?0:db.prepare(`SELECT COUNT(*) n FROM team_attachment_grants grant_row
 JOIN team_collection_attachments attachment ON attachment.team_id=grant_row.team_id AND attachment.attachment_id=grant_row.attachment_id
 JOIN team_collection_tasks task ON task.team_id=attachment.team_id AND task.task_id=attachment.task_id
 WHERE task.team_id=? AND task.project_id=? AND grant_row.user_id=? AND grant_row.status='active'`).get(teamId,projectId,userId).n;
 const sourceAffected=!desired.read&&hasWorkspaceSourceGrantFlags(db,teamId,projectId,userId),ledgerAffected=!desired.read&&hasLedgerGrantFlags(db,teamId,projectId,userId);
 if(!operations.length&&!tasks.length&&!attachments&&!sourceAffected&&!ledgerAffected)projectConflict();
 // Full removal can change only task/attachment scope, which also needs a
 // project revision even when no project-wide grant happened to exist.
 const explicitBump=operations.length?0:1;if(beforeRevision>Number.MAX_SAFE_INTEGER-operations.length-explicitBump)projectConflict();
 for(const operation of operations){if(operation.table==='team_project_grants'){
   if(operation.want)db.prepare("INSERT INTO team_project_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,'active') ON CONFLICT(team_id,project_id,user_id,permission) DO UPDATE SET status='active'").run(teamId,projectId,userId,operation.permission);
   else db.prepare("UPDATE team_project_grants SET status='revoked' WHERE team_id=? AND project_id=? AND user_id=? AND permission=? AND status='active'").run(teamId,projectId,userId,operation.permission);
  }else if(operation.want)db.prepare("INSERT INTO team_project_access_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,'active') ON CONFLICT(team_id,project_id,user_id,permission) DO UPDATE SET status='active',revision=team_project_access_grants.revision+1").run(teamId,projectId,userId,operation.permission);
  else db.prepare("UPDATE team_project_access_grants SET status='revoked',revision=revision+1 WHERE team_id=? AND project_id=? AND user_id=? AND permission=? AND status='active'").run(teamId,projectId,userId,operation.permission);
 }
 if(!desired.read){
  db.prepare("UPDATE team_task_assignments SET status='revoked' WHERE team_id=? AND user_id=? AND status='active' AND task_id IN (SELECT task_id FROM team_collection_tasks WHERE team_id=? AND project_id=?)").run(teamId,userId,teamId,projectId);
  db.prepare("UPDATE team_attachment_grants SET status='revoked' WHERE team_id=? AND user_id=? AND status='active' AND attachment_id IN (SELECT attachment.attachment_id FROM team_collection_attachments attachment JOIN team_collection_tasks task ON task.team_id=attachment.team_id AND task.task_id=attachment.task_id WHERE task.team_id=? AND task.project_id=?)").run(teamId,userId,teamId,projectId);
  for(const task of tasks)if(db.prepare(`INSERT INTO team_task_versions(team_id,task_id,revision) VALUES (?,?,?)
   ON CONFLICT(team_id,task_id) DO UPDATE SET revision=excluded.revision WHERE team_task_versions.revision=?`).run(teamId,task.task_id,task.next,task.revision).changes!==1)projectConflict();
 }
 if(explicitBump&&db.prepare('UPDATE team_project_access_projects SET revision=revision+1 WHERE team_id=? AND project_id=? AND revision=?').run(teamId,projectId,beforeRevision).changes!==1)projectConflict();
 if(!desired.read)revokeLedgerAccess(db,{actorId:actor.userId,teamId,projectId,userId,reason:'project-access.removed',at});
 if(!desired.read)revokeWorkspaceSourceAccess(db,{actorId:actor.userId,teamId,projectId,userId,reason:'project-access.removed',at});
 db.prepare('UPDATE team_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(at,userId);
 db.prepare('UPDATE team_device_leases SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(at,userId);
 db.prepare('UPDATE team_device_challenges SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL').run(at,userId);
 const revision=managedProject(db,teamId,projectId)?.revision;if(revision===undefined||revision<=beforeRevision)projectConflict();
 projectAudit(db,{teamId,projectId,actorId:actor.userId,targetUserId:userId,action:'access.changed',beforeRevision,afterRevision:revision,at});return {changed:true,revision};
}
export async function handleProjectAccessRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
 const url=new URL(request.url),access=url.pathname==='/api/auth/project-access',list=/^\/api\/teams\/([^/]+)\/projects$/.exec(url.pathname),detail=/^\/api\/teams\/([^/]+)\/projects\/([^/]+)(?:\/(members|access|tasks))?$/.exec(url.pathname);
 if(!access&&!list&&!detail)return null;
 // Creating projects has not been authorized. It is not an alias for task
 // creation or trusted server-only metadata registration.
 if(list&&request.method==='POST')deny();const action=detail?.[3];if((access||detail&&!['members','tasks'].includes(action))&&url.search)invalid();
 const expected=action==='access'?'POST':action==='tasks'?'GET, POST':'GET';if(!expected.split(', ').includes(request.method))return method(expected);
 const options={identityProviders,deviceContext,now},actor=projectActor(db,request,options,projectTime(now()));
 if(access){const rows=db.prepare("SELECT member.team_id,profile.name FROM team_memberships member LEFT JOIN team_profiles profile ON profile.team_id=member.team_id WHERE member.user_id=? AND member.status='active' AND member.role IN ('manager','partner') ORDER BY member.team_id COLLATE BINARY LIMIT 50").all(actor.userId);return json({teams:rows.filter(row=>ordinaryTeamContext(db,actor.userId,row.team_id)).map(row=>({teamId:row.team_id,teamName:safeMemberText(row.name,row.team_id)}))});}
 const teamId=(list||detail)[1];if(!ID.test(teamId)||!ordinaryTeamContext(db,actor.userId,teamId))deny();
 if(list){const query=projectQuery(url.searchParams),scope=projectScope(actor),search=query.q?" AND project.title LIKE ? ESCAPE '\\'":'',parameters=[teamId,...scope.parameters,...(query.q?[like(query.q)]:[])];if(query.after&&!db.prepare(`SELECT 1 ${FROM} WHERE project.team_id=? AND ${scope.sql}${search} AND project.project_id=?`).get(...parameters,query.after))deny();const rows=db.prepare(`SELECT project.project_id ${FROM} WHERE project.team_id=? AND ${scope.sql}${search} AND project.project_id>? ORDER BY project.project_id COLLATE BINARY LIMIT ?`).all(...parameters,query.after,query.limit+1);return json({projects:rows.slice(0,query.limit).map(row=>projectView(projectContext(db,actor,teamId,row.project_id))),hasMore:rows.length>query.limit});}
 const projectId=detail[2];if(!ID.test(projectId))deny();
 if(!action)return json({project:projectView(projectContext(db,actor,teamId,projectId))});
 if(action==='members'){projectContext(db,actor,teamId,projectId,{owner:true});return json(members(db,actor.userId,teamId,projectId,projectQuery(url.searchParams,{qLimit:80})));}
 if(action==='tasks'&&request.method==='GET'){
  projectContext(db,actor,teamId,projectId,{read:true});const query=projectQuery(url.searchParams),scope=projectScope(actor,{read:true}),search=query.q?" AND (task.title LIKE ? ESCAPE '\\' OR task.instructions LIKE ? ESCAPE '\\')":'',parameters=[teamId,projectId,...scope.parameters,...(query.q?[like(query.q),like(query.q)]:[])],from=`${FROM} JOIN team_collection_tasks task ON task.team_id=project.team_id AND task.project_id=project.project_id`;
  if(query.after&&!db.prepare(`SELECT 1 ${from} WHERE project.team_id=? AND project.project_id=? AND ${scope.sql}${search} AND task.task_id=?`).get(...parameters,query.after))deny();const rows=db.prepare(`SELECT task.task_id,task.title,task.instructions,task.status,CAST(COALESCE(version.revision,0) AS TEXT) AS revision ${from}
   LEFT JOIN team_task_versions version ON version.team_id=task.team_id AND version.task_id=task.task_id WHERE project.team_id=? AND project.project_id=? AND ${scope.sql}${search} AND task.task_id>? ORDER BY task.task_id COLLATE BINARY LIMIT ?`).all(...parameters,query.after,query.limit+1);
  return json({tasks:rows.slice(0,query.limit).map(row=>({id:row.task_id,title:row.title,instructions:row.instructions,status:row.status,revision:projectRevision(row.revision,0)})),hasMore:rows.length>query.limit});
 }
 if(action==='tasks'){
  if(url.search)invalid();const before=projectContext(db,actor,teamId,projectId,{read:true,manage:true,active:true}),body=await readJson(request,['revision','title','instructions']);if(!Number.isSafeInteger(body.revision)||body.revision<1)invalid();const title=taskText(body.title,160,true),instructions=taskText(body.instructions,4000,false,true);
  sameProject(db,request,actor,options,teamId,projectId,before,body.revision,{read:true,manage:true,active:true});
  return transaction(db,()=>{const fresh=sameProject(db,request,actor,options,teamId,projectId,before,body.revision,{read:true,manage:true,active:true}),at=projectTime(now()),next=projectIncrement(fresh.project.revision),id=randomUUID();
   if(db.prepare('UPDATE team_project_access_projects SET revision=? WHERE team_id=? AND project_id=? AND revision=?').run(next,teamId,projectId,fresh.project.revision).changes!==1)projectConflict();
   db.prepare("INSERT INTO team_collection_tasks(team_id,task_id,project_id,title,instructions,status) VALUES (?,?,?,?,?,'open')").run(teamId,id,projectId,title,instructions);db.prepare('INSERT INTO team_task_versions(team_id,task_id,revision) VALUES (?,?,0)').run(teamId,id);
   projectAudit(db,{teamId,projectId,actorId:actor.userId,taskId:id,action:'task.created',beforeRevision:fresh.project.revision,afterRevision:next,at});return json({task:{id,title,instructions,status:'open',revision:0},revision:next},201);
  });
 }
 const before=projectContext(db,actor,teamId,projectId,{owner:true,active:true}),body=await readJson(request,['revision','userId','memberRevision','read','manage','review','currentPassword']);
 if(!Number.isSafeInteger(body.revision)||body.revision<1||typeof body.userId!=='string'||!ID.test(body.userId)||!Number.isSafeInteger(body.memberRevision)||body.memberRevision<0||!['read','manage','review'].every(name=>typeof body[name]==='boolean')||!body.read&&(body.manage||body.review)||typeof body.currentPassword!=='string'||!body.currentPassword||Buffer.byteLength(body.currentPassword)>512)invalid();
 const target=targetMember(db,actor.userId,teamId,body.userId);if(body.userId===before.project.createdBy)deny();if(target.identityRevision!==body.memberRevision)projectConflict();
 const fresh=()=>{const context=sameProject(db,request,actor,options,teamId,projectId,before,body.revision,{owner:true,active:true}),current=targetMember(db,actor.userId,teamId,body.userId);if(current.stamp!==target.stamp||current.identityRevision!==body.memberRevision)projectConflict();return {context,target:current};};fresh();
 const operations=accessOperations(db,teamId,projectId,body.userId,body);if(!operations.length&&body.read)projectConflict();if(!operations.length&&!body.read&&!revokeTasks(db,teamId,projectId,body.userId).length&&!db.prepare(`SELECT 1 FROM team_attachment_grants grant_row JOIN team_collection_attachments attachment ON attachment.team_id=grant_row.team_id AND attachment.attachment_id=grant_row.attachment_id JOIN team_collection_tasks task ON task.team_id=attachment.team_id AND task.task_id=attachment.task_id WHERE task.team_id=? AND task.project_id=? AND grant_row.user_id=? AND grant_row.status='active' LIMIT 1`).get(teamId,projectId,body.userId)&&!hasWorkspaceSourceGrantFlags(db,teamId,projectId,body.userId)&&!hasLedgerGrantFlags(db,teamId,projectId,body.userId))projectConflict();
 consume(db,'project-access:'+digest(actor.userId),projectTime(now()),15*60000,20);
 return limitedPasswordWork(db,async()=>{const valid=await verifyPassword(body.currentPassword,before.member.credential.password_hash);fresh();if(!valid)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');return transaction(db,()=>{const current=fresh();return json(changeAccess(db,actor,current.context,current.target,body,projectTime(now())));});});
}
