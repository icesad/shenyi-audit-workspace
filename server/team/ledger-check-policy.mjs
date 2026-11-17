import {createHash} from 'node:crypto';
import {currentDeviceLease,deviceServerId,deviceConflict} from './device-policy.mjs';
import {ordinaryTeamContext,managedProject,projectRevision,projectTime} from './project-access-policy.mjs';
import {resolveWorkspaceSource} from './workspace-source-resolver.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {administratorBusinessEligibilitySql} from './administrator-business-role-policy.mjs';
import {noReviewerHistorySql} from './reviewer-policy.mjs';
import {ApiError,ID,deny,invalid} from './http-utils.mjs';

export const LEDGER_IMPORT_MAX=64*1024*1024+16384;
export const LEDGER_IMPORT_PATH=/^\/api\/teams\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/ledger-checks\/imports$/;
export const ledgerDigest=value=>createHash('sha256').update(value).digest('hex');
export const ledgerConflict=()=>{throw new ApiError(409,'LEDGER_CHECK_CONFLICT','账表来源、授权或版本已改变，请刷新或查询原操作回执。');};
export function ledgerActor(db,request,{identityProviders={},deviceContext}={},at){
 if(identityProviders.deviceProofRequired!==true||!deviceContext)throw new ApiError(403,'DEVICE_PROOF_REQUIRED','请在当前获准电脑上核验后操作。');
 const actor=currentDeviceLease(db,request,projectTime(at));
 if(actor.userId!==deviceContext.userId||actor.deviceId!==deviceContext.deviceId||actor.bindingRevision!==deviceContext.bindingRevision||actor.leaseId!==deviceContext.leaseId||actor.stamp!==deviceContext.stamp||deviceServerId(db)!==deviceContext.serverId)deviceConflict();
 return actor;
}
export function currentLedgerActor(db,request,before,options,at){const actor=ledgerActor(db,request,options,at);if(actor.userId!==before.userId||actor.token!==before.token||actor.stamp!==before.stamp||actor.leaseId!==before.leaseId)ledgerConflict();return actor;}
export function ledgerGrant(db,teamId,projectId,userId){
 const row=db.prepare('SELECT *,CAST(revision AS TEXT) revision FROM team_ledger_check_grants WHERE team_id=? AND project_id=? AND user_id=?').get(teamId,projectId,userId);
 return {exists:!!row,revision:row?projectRevision(row.revision):0,eligible:row?.eligible===1,rawRead:row?.can_read===1,read:row?.eligible===1&&row.can_read===1,stamp:ledgerDigest(JSON.stringify(row??null))};
}
export function ledgerContext(db,actor,teamId,projectId,{owner=false,read=false,active=false,source=false}={}){
 const member=ordinaryTeamContext(db,actor.userId,teamId);if(!member)deny();
 const project=managedProject(db,teamId,projectId);if(!project||!['active','frozen'].includes(project.status))deny();
 const own=db.prepare("SELECT *,CAST(revision AS TEXT) revision FROM team_project_access_grants WHERE team_id=? AND project_id=? AND user_id=? AND permission='project.owner' AND status='active'").get(teamId,projectId,actor.userId);
 if(own)projectRevision(own.revision);
 const isOwner=project.createdBy===actor.userId&&!!own,grant=ledgerGrant(db,teamId,projectId,actor.userId);
 if(!isOwner&&!grant.read||owner&&!isOwner||read&&!grant.read)deny();if(active&&project.status!=='active')ledgerConflict();
 const resolved=resolveWorkspaceSource(db,teamId,projectId),identity=resolved?{sourceProjectId:resolved.sourceProjectId,stamp:resolved.stamp}:null;
 if(source&&!identity)deny();return {member,project,owner:isOwner,ownerStamp:ledgerDigest(JSON.stringify(own??null)),grant,identity};
}
export function ledgerContextStamp(context){return ledgerDigest(JSON.stringify({member:context.member.stamp,projectRevision:context.project.revision,status:context.project.status,createdBy:context.project.createdBy,owner:context.ownerStamp,grant:context.grant.stamp,identity:context.identity?.stamp??null}));}
// Invoked only after device-signature authentication and before reading the
// import body. The captured stamp survives dispatch, preventing body-time ABA.
export function ledgerRequestBodyPolicy(db,request,userId,defaultMaximum){
 const url=new URL(request.url),match=LEDGER_IMPORT_PATH.exec(url.pathname);
 if(request.method!=='POST'||url.search||!match)return {maximum:defaultMaximum};
 const context=ledgerContext(db,{userId},match[1],match[2],{owner:true,read:true,active:true,source:true});
 return {maximum:LEDGER_IMPORT_MAX,ledgerImportStamp:ledgerContextStamp(context)};
}
export function ledgerHead(db,teamId,projectId){
 const row=db.prepare('SELECT CAST(revision AS TEXT) revision FROM team_ledger_check_heads WHERE team_id=? AND project_id=?').get(teamId,projectId);
 const latest=db.prepare('SELECT CAST(MAX(version) AS TEXT) revision FROM team_ledger_check_snapshots WHERE team_id=? AND project_id=?').get(teamId,projectId);
 const revision=row?projectRevision(row.revision):0;if(revision!==(latest.revision===null?0:projectRevision(latest.revision)))ledgerConflict();return revision;
}
export function ledgerListQuery(params,{version=false}={}){
 for(const key of params.keys())if(!['q','after','limit'].includes(key)||params.getAll(key).length!==1)invalid();
 const q=params.get('q')??'',after=params.get('after')??'',raw=params.get('limit');
 if([...q].length>80||!q.isWellFormed()||/[\p{Cc}\p{Cf}]/u.test(q)||raw!==null&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(raw)||version&&q)invalid();
 if(params.has('after')&&(version?!/^[1-9][0-9]*$/.test(after)||!Number.isSafeInteger(Number(after)):!ID.test(after)))invalid();
 return {q,after:version&&after?Number(after):after,limit:raw===null?20:Number(raw)};
}
export function ledgerMembers(db,teamId,projectId,{q,after,limit}){
 const from=`FROM team_memberships member JOIN team_users account ON account.user_id=member.user_id JOIN teams team ON team.team_id=member.team_id JOIN team_credentials credential ON credential.user_id=member.user_id LEFT JOIN team_recovery_identity_epochs epoch ON epoch.user_id=member.user_id LEFT JOIN team_ledger_check_grants ledger_grant ON ledger_grant.team_id=member.team_id AND ledger_grant.project_id=? AND ledger_grant.user_id=member.user_id`;
 const where=`member.team_id=? AND member.status='active' AND member.role IN ('manager','partner') AND account.status='active' AND team.status='active' AND (SELECT COUNT(*) FROM team_memberships WHERE user_id=member.user_id)=1 AND ${administratorBusinessEligibilitySql('member')} AND ${noReviewerHistorySql('member.user_id')}${q?" AND credential.display_name LIKE ? ESCAPE '\\'":''}`;
 const parameters=[projectId,teamId,...(q?['%'+q.replace(/[\\%_]/g,c=>'\\'+c)+'%']:[])];
 if(after&&!db.prepare(`SELECT 1 ${from} WHERE ${where} AND member.user_id=?`).get(...parameters,after))deny();
 const rows=db.prepare(`SELECT member.user_id,member.role,credential.display_name,CAST(COALESCE(epoch.version,0) AS TEXT) member_revision,CAST(COALESCE(ledger_grant.revision,0) AS TEXT) grant_revision,ledger_grant.eligible,ledger_grant.can_read ${from} WHERE ${where} AND member.user_id>? ORDER BY member.user_id COLLATE BINARY LIMIT ?`).all(...parameters,after,limit+1);
 return {members:rows.slice(0,limit).map(row=>({id:row.user_id,displayName:safeMemberText(row.display_name,row.user_id),role:row.role,memberRevision:projectRevision(row.member_revision,0),grantRevision:projectRevision(row.grant_revision,0),read:row.eligible===1&&row.can_read===1})),hasMore:rows.length>limit};
}
export function ledgerTarget(db,teamId,userId){const target=ordinaryTeamContext(db,userId,teamId);if(!target)deny();return target;}
