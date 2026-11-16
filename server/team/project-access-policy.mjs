import {administratorBusinessEligibilitySql} from './administrator-business-role-policy.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {currentDeviceLease} from './device-policy.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {ApiError,ID,deny,invalid} from './http-utils.mjs';
import {noReviewerHistorySql} from './reviewer-policy.mjs';
import {materialVisibilitySql} from './materials-scope.mjs';
import {COLLECTION_WORKSPACE_KIND,collectionWorkspaceKind} from './workspace-creation-policy.mjs';
import {workspaceBusinessConfirmed} from './workspace-formalization-policy.mjs';
import {materialIdentity} from './materials-identity.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex'),UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const projectConflict=()=>{throw new ApiError(409,'PROJECT_ACCESS_CONFLICT','项目或授权状态已改变，请刷新核对。');};
export function projectRevision(value,min=1){const n=Number(value);if(!Number.isSafeInteger(n)||n<min)projectConflict();return n;}
export function projectIncrement(value,min=1){const n=projectRevision(value,min);if(n>=Number.MAX_SAFE_INTEGER)projectConflict();return n+1;}
export function projectTime(at){if(!Number.isSafeInteger(at)||at<0)projectConflict();return at;}
export function projectActor(db,request,{identityProviders={},deviceContext}={},at){
 if(identityProviders.deviceProofRequired!==true||!deviceContext)throw new ApiError(403,'DEVICE_PROOF_REQUIRED','请在已绑定设备上使用项目功能。');
 const actor=currentDeviceLease(db,request,projectTime(at));
 if(actor.userId!==deviceContext.userId||actor.deviceId!==deviceContext.deviceId||actor.bindingRevision!==deviceContext.bindingRevision||actor.leaseId!==deviceContext.leaseId)throw new ApiError(403,'DEVICE_PROOF_REQUIRED','当前设备状态已改变，请重新核验。');return actor;
}
export function currentActor(db,request,before,options,at){const fresh=projectActor(db,request,options,at);if(fresh.userId!==before.userId||fresh.token!==before.token||fresh.stamp!==before.stamp||fresh.leaseId!==before.leaseId)projectConflict();return fresh;}
const ORDINARY=`member.status='active' AND member.role IN ('manager','partner') AND account.status='active' AND team.status='active'
 AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=member.user_id)=1
 AND ${administratorBusinessEligibilitySql('member')}
 AND ${noReviewerHistorySql('member.user_id')}`;
export function safeProjectTitle(value,fallback){return [...String(value??'').toWellFormed().replace(/[\p{Cc}\p{Cf}]/gu,'').trim()].slice(0,300).join('')||[...fallback].slice(0,300).join('');}
export function ordinaryTeamContext(db,userId,teamId){
 const row=db.prepare(`SELECT member.role,credential.password_hash,CAST(credential.revision AS TEXT) AS credential_revision,
 CAST(COALESCE(epoch.version,0) AS TEXT) AS identity_revision FROM team_memberships member
 JOIN team_users account ON account.user_id=member.user_id JOIN teams team ON team.team_id=member.team_id
 JOIN team_credentials credential ON credential.user_id=member.user_id LEFT JOIN team_recovery_identity_epochs epoch ON epoch.user_id=member.user_id
 WHERE member.team_id=? AND member.user_id=? AND ${ORDINARY}`).get(teamId,userId);if(!row)return null;
 const identityRevision=projectRevision(row.identity_revision,0),credentialRevision=projectRevision(row.credential_revision);
 return {userId,teamId,role:row.role,identityRevision,credential:{password_hash:row.password_hash,revision:credentialRevision},
 stamp:digest(JSON.stringify({userId,teamId,role:row.role,identityRevision,credentialRevision,passwordHash:digest(row.password_hash)}))};
}
export function projectScope(actor,{projectAlias='project',metadataAlias='metadata',read=false,manage=false,review=false,owner=false}={}){
 if(projectAlias!=='project'||metadataAlias!=='metadata')throw Error('Untrusted project SQL aliases');
 const parameters=[actor.userId],identity=`EXISTS (SELECT 1 FROM team_memberships member JOIN team_users account ON account.user_id=member.user_id
 JOIN teams team ON team.team_id=member.team_id JOIN team_credentials credential ON credential.user_id=member.user_id
 WHERE member.team_id=project.team_id AND member.user_id=? AND ${ORDINARY})`;
 const grant=permission=>{parameters.push(actor.userId);return `EXISTS (SELECT 1 FROM team_project_grants scope_grant WHERE scope_grant.team_id=project.team_id AND scope_grant.project_id=project.project_id AND scope_grant.user_id=? AND scope_grant.permission='${permission}' AND scope_grant.status='active')`;};
 const acl=permission=>{parameters.push(actor.userId);return `EXISTS (SELECT 1 FROM team_project_access_grants scope_acl WHERE scope_acl.team_id=project.team_id AND scope_acl.project_id=project.project_id AND scope_acl.user_id=? AND scope_acl.permission='${permission}' AND scope_acl.status='active'${permission==='project.owner'?' AND scope_acl.user_id=metadata.created_by':''})`;};
 let permission;
 if(owner){permission=acl('project.owner');if(read||manage||review)permission+=' AND '+grant('collection.read');if(manage)permission+=' AND '+grant('collection.manage');if(review)permission+=' AND '+acl('collection.review');}
 else if(read||manage||review){permission=grant('collection.read');if(manage)permission+=' AND '+grant('collection.manage');if(review)permission+=' AND '+acl('collection.review');}
 else{const governance=acl('project.owner'),collection=grant('collection.read');parameters.push(actor.userId);permission='('+governance+' OR '+collection+' OR '+materialVisibilitySql('?')+')';}
 return {sql:`metadata.team_id=project.team_id AND metadata.project_id=project.project_id AND project.status IN ('active','frozen') AND ${identity} AND (${permission})`,parameters};
}
export function managedProject(db,teamId,projectId){
 const row=db.prepare(`SELECT project.project_id,project.title,project.status,metadata.created_by,metadata.created_at,metadata.request_id,metadata.request_sha256,
 CAST(metadata.revision AS TEXT) AS revision FROM team_projects project JOIN team_project_access_projects metadata
 ON metadata.team_id=project.team_id AND metadata.project_id=project.project_id WHERE project.team_id=? AND project.project_id=?`).get(teamId,projectId);
 return row?{teamId,id:row.project_id,title:safeProjectTitle(row.title,row.project_id),status:row.status,revision:projectRevision(row.revision),createdBy:row.created_by,createdAt:projectTime(row.created_at),requestId:row.request_id,requestSha256:row.request_sha256,...(collectionWorkspaceKind(db,teamId,projectId)?{kind:COLLECTION_WORKSPACE_KIND,...(workspaceBusinessConfirmed(db,teamId,projectId)?{businessConfirmed:true}:{})}:{})}:null;
}
export function projectContext(db,actor,teamId,projectId,{read=false,manage=false,review=false,owner=false,active=false}={}){
 const member=ordinaryTeamContext(db,actor.userId,teamId);if(!member)deny();const project=managedProject(db,teamId,projectId);if(!project||!['active','frozen'].includes(project.status))deny();
 const legacy=db.prepare("SELECT permission FROM team_project_grants WHERE team_id=? AND project_id=? AND user_id=? AND status='active'").all(teamId,projectId,actor.userId);
 const own=db.prepare("SELECT permission,CAST(revision AS TEXT) AS revision FROM team_project_access_grants WHERE team_id=? AND project_id=? AND user_id=? AND status='active'").all(teamId,projectId,actor.userId);for(const row of own)projectRevision(row.revision);
 const context={member,project,read:legacy.some(row=>row.permission==='collection.read'),manage:legacy.some(row=>row.permission==='collection.manage'),review:own.some(row=>row.permission==='collection.review'),owner:project.createdBy===actor.userId&&own.some(row=>row.permission==='project.owner')};
 let materialVisible=false;if(db.prepare('SELECT 1 FROM team_material_grants WHERE team_id=? AND project_id=? AND user_id=? AND eligible=1 AND can_read=1').get(teamId,projectId,actor.userId)){try{materialVisible=!!materialIdentity(db,teamId,projectId);}catch(error){if(!(error instanceof ApiError)||error.status!==404)throw error;}}
 if(!context.read&&!context.owner&&!materialVisible||owner&&!context.owner||(read||manage||review)&&!context.read||manage&&!context.manage||review&&!context.review)deny();if(active&&project.status!=='active')projectConflict();return context;
}
export const canReadProject=context=>!!context?.read;
export const canManageProject=context=>!!context?.read&&!!context?.manage;
export const canReviewProject=context=>!!context?.read&&!!context?.review;
export const canOwnProject=context=>!!context?.owner;
export function projectView(context){return {id:context.project.id,title:context.project.title,status:context.project.status,revision:context.project.revision,
 canRead:canReadProject(context),canManageAccess:context.project.status==='active'&&context.project.revision<Number.MAX_SAFE_INTEGER&&canOwnProject(context),canCreateTask:context.project.status==='active'&&context.project.revision<Number.MAX_SAFE_INTEGER&&canManageProject(context),canReview:canReviewProject(context),...(context.project.kind===COLLECTION_WORKSPACE_KIND?{kind:COLLECTION_WORKSPACE_KIND,...(context.project.businessConfirmed===true?{businessConfirmed:true}:{})}:{})};}
export function projectQuery(params,{qLimit=100,allowQ=true}={}){
 for(const name of params.keys())if(!['after','limit',...(allowQ?['q']:[])].includes(name)||params.getAll(name).length!==1)invalid();
 const q=params.get('q')??'',after=params.get('after')??'',limit=params.get('limit');if(q.length>qLimit||!q.isWellFormed()||/[\p{Cc}\p{Cf}]/u.test(q)||params.has('after')&&!ID.test(after)||limit!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit))invalid();return {q,after,limit:limit===null?20:Number(limit)};
}
export function projectAudit(db,{teamId,projectId,actorId,targetUserId=null,taskId=null,action,reason='',beforeRevision,afterRevision,at}){
 const before=projectRevision(beforeRevision),after=projectRevision(afterRevision);if(after<=before)projectConflict();
 db.prepare('INSERT INTO team_project_access_events(event_id,team_id,project_id,actor_id,target_user_id,task_id,action,reason,before_revision,after_revision,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),teamId,projectId,actorId,targetUserId,taskId,action,reason,before,after,projectTime(at));
}
export function registerManagedProject(db,{teamId,projectId,createdBy,at,createdAt=at,requestId=null,requestSha256=null}){
 if(!ID.test(teamId??'')||!ID.test(projectId??'')||!ID.test(createdBy??'')||requestId!==null&&(!UUID.test(requestId)||typeof requestSha256!=='string'||!/^[a-f0-9]{64}$/.test(requestSha256))||requestId===null&&requestSha256!==null)invalid();
 if(!ordinaryTeamContext(db,createdBy,teamId)||!db.prepare("SELECT 1 FROM team_projects WHERE team_id=? AND project_id=? AND status='active'").get(teamId,projectId))deny();
 if(db.prepare('SELECT 1 FROM team_project_access_projects WHERE team_id=? AND project_id=?').get(teamId,projectId))projectConflict();
 db.prepare('INSERT INTO team_project_access_projects(team_id,project_id,created_by,created_at,request_id,request_sha256) VALUES (?,?,?,?,?,?)').run(teamId,projectId,createdBy,projectTime(createdAt),requestId,requestSha256);return managedProject(db,teamId,projectId);
}
export function prepareProjectAccessRevocation(db,{actorId,teamId,userId,reason,at}){
 const rows=db.prepare(`SELECT metadata.project_id,CAST(metadata.revision AS TEXT) AS revision FROM team_project_access_projects metadata WHERE metadata.team_id=? AND
 (EXISTS (SELECT 1 FROM team_project_access_grants acl WHERE acl.team_id=metadata.team_id AND acl.project_id=metadata.project_id AND acl.user_id=? AND acl.status='active')
 OR EXISTS (SELECT 1 FROM team_project_grants legacy WHERE legacy.team_id=metadata.team_id AND legacy.project_id=metadata.project_id AND legacy.user_id=? AND legacy.status='active'))`).all(teamId,userId,userId);
 for(const row of rows){const revision=projectRevision(row.revision),acl=db.prepare("SELECT permission,CAST(revision AS TEXT) AS revision FROM team_project_access_grants WHERE team_id=? AND project_id=? AND user_id=? AND status='active'").all(teamId,row.project_id,userId),legacy=db.prepare("SELECT COUNT(*) n FROM team_project_grants WHERE team_id=? AND project_id=? AND user_id=? AND status='active'").get(teamId,row.project_id,userId).n;
  if(revision>Number.MAX_SAFE_INTEGER-acl.length-legacy)projectConflict();for(const item of acl)projectIncrement(item.revision);
 }
 for(const row of rows)db.prepare("UPDATE team_project_access_grants SET status='revoked',revision=revision+1 WHERE team_id=? AND project_id=? AND user_id=? AND status='active'").run(teamId,row.project_id,userId);
 return {actorId,teamId,userId,reason:String(reason??''),at:projectTime(at),projects:rows.map(row=>({projectId:row.project_id,beforeRevision:projectRevision(row.revision)}))};
}
export function finishProjectAccessRevocation(db,prepared){
 for(const item of prepared.projects){const project=managedProject(db,prepared.teamId,item.projectId);if(!project)projectConflict();projectAudit(db,{teamId:prepared.teamId,projectId:item.projectId,actorId:prepared.actorId,targetUserId:prepared.userId,action:'access.revoked',reason:prepared.reason,beforeRevision:item.beforeRevision,afterRevision:project.revision,at:prepared.at});}
}
