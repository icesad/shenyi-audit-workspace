import {createHash} from 'node:crypto';
import {currentDeviceLease,deviceServerId,deviceConflict} from './device-policy.mjs';
import {ordinaryTeamContext,projectContext,projectRevision,projectTime} from './project-access-policy.mjs';
import {administratorBusinessEligibilitySql} from './administrator-business-role-policy.mjs';
import {noReviewerHistorySql} from './reviewer-policy.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {ApiError,ID,deny,invalid} from './http-utils.mjs';

export const workspaceSourceConflict=()=>{throw new ApiError(409,'WORKSPACE_SOURCE_CONFLICT','项目、来源或授权已改变，请刷新核对。');};
const digest=value=>createHash('sha256').update(value).digest('hex');
export function workspaceSourceActor(db,request,{identityProviders={},deviceContext}={},at){
 if(identityProviders.deviceProofRequired!==true||!deviceContext)throw new ApiError(403,'DEVICE_PROOF_REQUIRED','请在当前获准电脑上核验后操作。');
 const actor=currentDeviceLease(db,request,projectTime(at));
 if(actor.userId!==deviceContext.userId||actor.deviceId!==deviceContext.deviceId||actor.bindingRevision!==deviceContext.bindingRevision||actor.leaseId!==deviceContext.leaseId||actor.stamp!==deviceContext.stamp||deviceServerId(db)!==deviceContext.serverId)deviceConflict();
 return actor;
}
export function currentWorkspaceSourceActor(db,request,before,options,at){
 const actor=workspaceSourceActor(db,request,options,at);
 if(actor.userId!==before.userId||actor.token!==before.token||actor.stamp!==before.stamp||actor.leaseId!==before.leaseId)workspaceSourceConflict();return actor;
}
export function workspaceSourceGrant(db,teamId,projectId,userId){
 const row=db.prepare('SELECT *,CAST(revision AS TEXT) revision FROM team_workspace_source_grants WHERE team_id=? AND project_id=? AND user_id=?').get(teamId,projectId,userId);
 const revision=row?projectRevision(row.revision,1):0,eligible=row?.eligible===1;
 return {exists:!!row,revision,eligible,rawRead:row?.can_read===1,rawExport:row?.can_export===1,read:eligible&&row.can_read===1,export:eligible&&row.can_export===1,stamp:digest(JSON.stringify(row??null))};
}
export function workspaceSourceContext(db,actor,teamId,projectId,{owner=false,read=false,export:exporting=false,active=false}={}){
 const context=projectContext(db,actor,teamId,projectId,{owner,active}),grant=workspaceSourceGrant(db,teamId,projectId,actor.userId);
 if((read||exporting)&&!grant.read||exporting&&!grant.export)deny();return {...context,grant};
}
export function workspaceSourceQuery(params){
 for(const key of params.keys())if(!['q','after','limit'].includes(key)||params.getAll(key).length!==1)invalid();
 const q=params.get('q')??'',after=params.get('after')??'',limit=params.get('limit');
 if([...q].length>80||!q.isWellFormed()||/[\p{Cc}\p{Cf}]/u.test(q)||params.has('after')&&!ID.test(after)||limit!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit))invalid();
 return {q,after,limit:limit===null?20:Number(limit)};
}
export function workspaceSourceMembers(db,teamId,projectId,{q,after,limit}){
 const from=`FROM team_memberships member JOIN team_users account ON account.user_id=member.user_id JOIN teams team ON team.team_id=member.team_id JOIN team_credentials credential ON credential.user_id=member.user_id LEFT JOIN team_recovery_identity_epochs epoch ON epoch.user_id=member.user_id LEFT JOIN team_workspace_source_grants source_grant ON source_grant.team_id=member.team_id AND source_grant.project_id=? AND source_grant.user_id=member.user_id`;
 const where=`member.team_id=? AND member.status='active' AND member.role IN ('manager','partner') AND account.status='active' AND team.status='active' AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=member.user_id)=1 AND ${administratorBusinessEligibilitySql('member')} AND ${noReviewerHistorySql('member.user_id')}${q?" AND credential.display_name LIKE ? ESCAPE '\\'":''}`;
 const parameters=[projectId,teamId,...(q?['%'+q.replace(/[\\%_]/g,c=>'\\'+c)+'%']:[])];
 if(after&&!db.prepare(`SELECT 1 ${from} WHERE ${where} AND member.user_id=?`).get(...parameters,after))deny();
 const rows=db.prepare(`SELECT member.user_id,member.role,credential.display_name,CAST(COALESCE(epoch.version,0) AS TEXT) member_revision,CAST(COALESCE(source_grant.revision,0) AS TEXT) grant_revision,source_grant.eligible,source_grant.can_read,source_grant.can_export ${from} WHERE ${where} AND member.user_id>? ORDER BY member.user_id COLLATE BINARY LIMIT ?`).all(...parameters,after,limit+1);
 return {members:rows.slice(0,limit).map(row=>({id:row.user_id,displayName:safeMemberText(row.display_name,row.user_id),role:row.role,memberRevision:projectRevision(row.member_revision,0),grantRevision:projectRevision(row.grant_revision,0),read:row.eligible===1&&row.can_read===1,export:row.eligible===1&&row.can_export===1})),hasMore:rows.length>limit};
}
export function workspaceSourceTarget(db,teamId,userId){const target=ordinaryTeamContext(db,userId,teamId);if(!target)deny();return target;}
