import {createHash} from 'node:crypto';
import {currentDeviceLease,deviceServerId,deviceConflict} from './device-policy.mjs';
import {ordinaryTeamContext,managedProject,projectRevision,projectTime,safeProjectTitle} from './project-access-policy.mjs';
import {administratorBusinessEligibilitySql} from './administrator-business-role-policy.mjs';
import {noReviewerHistorySql} from './reviewer-policy.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {ApiError,ID,deny,invalid} from './http-utils.mjs';

export const workpaperAccessDigest=value=>createHash('sha256').update(value).digest('hex');
export const workpaperAccessConflict=()=>{throw new ApiError(409,'WORKPAPER_ACCESS_CONFLICT','底稿授权或项目状态已改变，请刷新核对。');};
export function workpaperAccessActor(db,request,{identityProviders={},deviceContext}={},at){
 if(identityProviders.deviceProofRequired!==true||!deviceContext)throw new ApiError(403,'DEVICE_PROOF_REQUIRED','请在当前获准电脑上核验后操作。');
 const actor=currentDeviceLease(db,request,projectTime(at));
 if(actor.userId!==deviceContext.userId||actor.deviceId!==deviceContext.deviceId||actor.bindingRevision!==deviceContext.bindingRevision||actor.leaseId!==deviceContext.leaseId||actor.stamp!==deviceContext.stamp||deviceServerId(db)!==deviceContext.serverId)deviceConflict();
 return actor;
}
export function currentWorkpaperAccessActor(db,request,before,options,at){
 const actor=workpaperAccessActor(db,request,options,at);
 if(actor.userId!==before.userId||actor.token!==before.token||actor.stamp!==before.stamp||actor.leaseId!==before.leaseId)workpaperAccessConflict();return actor;
}
export function workpaperAccessGrant(db,teamId,projectId,userId){
 const row=db.prepare('SELECT *,CAST(revision AS TEXT) revision FROM team_workpaper_access_grants WHERE team_id=? AND project_id=? AND user_id=?').get(teamId,projectId,userId);
 const eligible=row?.eligible===1,rawRead=row?.can_read===1,rawWrite=row?.can_write===1,rawExport=row?.can_export===1;
 return {exists:!!row,revision:row?projectRevision(row.revision):0,eligible,rawRead,rawWrite,rawExport,read:eligible&&rawRead,write:eligible&&rawWrite,export:eligible&&rawExport,stamp:workpaperAccessDigest(JSON.stringify(row??null))};
}
export function workpaperAccessContext(db,actor,teamId,projectId,{owner=false,read=false,write=false,export:exporting=false,active=false}={}){
 const member=ordinaryTeamContext(db,actor.userId,teamId);if(!member)deny();
 const project=managedProject(db,teamId,projectId);if(!project||!['active','frozen'].includes(project.status))deny();
 const own=db.prepare("SELECT *,CAST(revision AS TEXT) revision FROM team_project_access_grants WHERE team_id=? AND project_id=? AND user_id=? AND permission='project.owner' AND status='active'").get(teamId,projectId,actor.userId);
 if(own)projectRevision(own.revision);
 const isOwner=project.createdBy===actor.userId&&!!own,grant=workpaperAccessGrant(db,teamId,projectId,actor.userId);
 if(!isOwner&&!grant.read||owner&&!isOwner||(read||write||exporting)&&!grant.read||write&&!grant.write||exporting&&!grant.export)deny();
 if((active||write)&&project.status!=='active')workpaperAccessConflict();
 return {member,project,owner:isOwner,ownerStamp:workpaperAccessDigest(JSON.stringify(own??null)),grant};
}
export function workpaperAccessContextStamp(context,{grant=true}={}){
 return workpaperAccessDigest(JSON.stringify({member:context.member.stamp,projectRevision:context.project.revision,status:context.project.status,createdBy:context.project.createdBy,owner:context.ownerStamp,...(grant?{grant:context.grant.stamp}:{})}));
}
export function workpaperAccessQuery(params){
 for(const key of params.keys())if(!['q','after','limit'].includes(key)||params.getAll(key).length!==1)invalid();
 const q=params.get('q')??'',after=params.get('after')??'',raw=params.get('limit');
 if([...q].length>80||!q.isWellFormed()||/[\p{Cc}\p{Cf}]/u.test(q)||params.has('after')&&!ID.test(after)||raw!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(raw))invalid();
 return {q,after,limit:raw===null?20:Number(raw)};
}
export function workpaperAccessProjects(db,actor,teamId,{q,after,limit}){
 const member=ordinaryTeamContext(db,actor.userId,teamId);if(!member)deny();
 const from='FROM team_projects project JOIN team_project_access_projects metadata ON metadata.team_id=project.team_id AND metadata.project_id=project.project_id';
 const where=`project.team_id=? AND project.status IN ('active','frozen') AND (EXISTS(SELECT 1 FROM team_project_access_grants owner WHERE owner.team_id=project.team_id AND owner.project_id=project.project_id AND owner.user_id=? AND owner.user_id=metadata.created_by AND owner.permission='project.owner' AND owner.status='active') OR EXISTS(SELECT 1 FROM team_workpaper_access_grants wp WHERE wp.team_id=project.team_id AND wp.project_id=project.project_id AND wp.user_id=? AND wp.eligible=1 AND wp.can_read=1))${q?" AND project.title LIKE ? ESCAPE '\\'":''}`;
 const parameters=[teamId,actor.userId,actor.userId,...(q?['%'+q.replace(/[\\%_]/g,c=>'\\'+c)+'%']:[])];
 if(after&&!db.prepare(`SELECT 1 ${from} WHERE ${where} AND project.project_id=?`).get(...parameters,after))deny();
 const rows=db.prepare(`SELECT project.project_id,project.title,project.status,CAST(metadata.revision AS TEXT) revision ${from} WHERE ${where} AND project.project_id>? ORDER BY project.project_id COLLATE BINARY LIMIT ?`).all(...parameters,after,limit+1);
 const result={projects:rows.slice(0,limit).map(row=>({teamId,id:row.project_id,title:safeProjectTitle(row.title,row.project_id),status:row.status,revision:projectRevision(row.revision)})),hasMore:rows.length>limit};
 if(ordinaryTeamContext(db,actor.userId,teamId)?.stamp!==member.stamp)workpaperAccessConflict();return result;
}
export function workpaperAccessMembers(db,teamId,projectId,{q,after,limit}){
 const from=`FROM team_memberships member JOIN team_users account ON account.user_id=member.user_id JOIN teams team ON team.team_id=member.team_id JOIN team_credentials credential ON credential.user_id=member.user_id LEFT JOIN team_recovery_identity_epochs epoch ON epoch.user_id=member.user_id LEFT JOIN team_workpaper_access_grants wp ON wp.team_id=member.team_id AND wp.project_id=? AND wp.user_id=member.user_id`;
 const where=`member.team_id=? AND member.status='active' AND member.role IN ('manager','partner') AND account.status='active' AND team.status='active' AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=member.user_id)=1 AND ${administratorBusinessEligibilitySql('member')} AND ${noReviewerHistorySql('member.user_id')}${q?" AND credential.display_name LIKE ? ESCAPE '\\'":''}`;
 const parameters=[projectId,teamId,...(q?['%'+q.replace(/[\\%_]/g,c=>'\\'+c)+'%']:[])];
 if(after&&!db.prepare(`SELECT 1 ${from} WHERE ${where} AND member.user_id=?`).get(...parameters,after))deny();
 const rows=db.prepare(`SELECT member.user_id,member.role,credential.display_name,CAST(COALESCE(epoch.version,0) AS TEXT) member_revision,CAST(COALESCE(wp.revision,0) AS TEXT) grant_revision,wp.eligible,wp.can_read,wp.can_write,wp.can_export ${from} WHERE ${where} AND member.user_id>? ORDER BY member.user_id COLLATE BINARY LIMIT ?`).all(...parameters,after,limit+1);
 return {members:rows.slice(0,limit).map(row=>({id:row.user_id,displayName:safeMemberText(row.display_name,row.user_id),role:row.role,memberRevision:projectRevision(row.member_revision,0),grantRevision:projectRevision(row.grant_revision,0),read:row.eligible===1&&row.can_read===1,write:row.eligible===1&&row.can_write===1,export:row.eligible===1&&row.can_export===1})),hasMore:rows.length>limit};
}
export function workpaperAccessTarget(db,teamId,userId){const target=ordinaryTeamContext(db,userId,teamId);if(!target)deny();return target;}
