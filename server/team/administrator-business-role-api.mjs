import {randomUUID,createHash} from 'node:crypto';
import {consume,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {currentDeviceLease} from './device-policy.mjs';
import {revokeBusinessRoleAccess} from './business-role-transition.mjs';
import {administratorBusinessRoles,administratorBusinessConflict,administratorBusinessRevision,administratorBusinessIncrement,administratorBusinessTime,administratorBusinessReviewer,administratorBusinessTarget,administratorBusinessQuery,listAdministratorBusinessTargets,approvedAdministratorBusiness} from './administrator-business-role-policy.mjs';
import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const method=allow=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow});
function deviceActor(db,request,providers,context,at){
 if(providers.deviceProofRequired!==true||!context)throw new ApiError(403,'DEVICE_PROOF_REQUIRED','请在已绑定设备上完成审核操作。');
 const actor=currentDeviceLease(db,request,at);
 if(actor.userId!==context.userId||actor.deviceId!==context.deviceId||actor.bindingRevision!==context.bindingRevision||actor.leaseId!==context.leaseId)throw new ApiError(403,'DEVICE_PROOF_REQUIRED','当前设备状态已改变，请重新核验。');
 return actor;
}
function currentReviewer(db,request,before,options,expected){
 const actor=deviceActor(db,request,options.identityProviders,options.deviceContext,administratorBusinessTime(options.now()));
 if(actor.userId!==before.userId||actor.token!==before.token||actor.stamp!==before.stamp||actor.leaseId!==before.leaseId)administratorBusinessConflict();
 const authority=administratorBusinessReviewer(db,actor.userId);if(!authority)deny();
 if(expected!==undefined&&authority.stamp!==expected)administratorBusinessConflict();
 return {actor,authority};
}
function currentState(db,request,actor,options,userId,expected={}){
 const {authority}=currentReviewer(db,request,actor,options,expected.authority);
 const target=administratorBusinessTarget(db,actor.userId,userId);if(!target)deny();
 if(expected.revision!==undefined&&target.revision!==expected.revision||expected.target!==undefined&&target.stamp!==expected.target)administratorBusinessConflict();
 return {authority,target};
}
function publishRole(db,actor,target,role,at){
 const memberRole=role??target.member?.role;if(!memberRole)administratorBusinessConflict();
 const status=role===null?'disabled':'active',memberChanged=!target.member||target.member.role!==memberRole||target.member.status!==status;
 administratorBusinessIncrement(target.revision,0);
 if(target.approval){const steps=target.approval.status==='active'&&memberChanged?2:1;if(target.approval.revision>Number.MAX_SAFE_INTEGER-steps)administratorBusinessConflict();}
 if(!target.member)db.prepare("INSERT INTO team_memberships(team_id,user_id,role,status) VALUES (?,?,?,'active')").run(target.teamId,target.id,memberRole);
 else if(memberChanged&&db.prepare('UPDATE team_memberships SET role=?,status=? WHERE team_id=? AND user_id=? AND role=? AND status=?').run(memberRole,status,target.teamId,target.id,target.member.role,target.member.status).changes!==1)administratorBusinessConflict();
 revokeBusinessRoleAccess(db,{actorId:actor.userId,teamId:target.teamId,userId:target.id,at,reason:'administrator.business-role.changed'});
 const previous=db.prepare('SELECT CAST(revision AS TEXT) AS revision FROM team_administrator_business_roles WHERE team_id=? AND user_id=?').get(target.teamId,target.id);
 if(previous){const revision=administratorBusinessRevision(previous.revision,1),next=administratorBusinessIncrement(revision);if(db.prepare(`UPDATE team_administrator_business_roles SET role=?,status='active',revision=?,member_role=?,reviewed_by=?,reviewed_at=? WHERE team_id=? AND user_id=? AND revision=?`).run(role,next,memberRole,actor.userId,at,target.teamId,target.id,revision).changes!==1)administratorBusinessConflict();}
 else db.prepare("INSERT INTO team_administrator_business_roles(team_id,user_id,role,status,member_role,reviewed_by,reviewed_at) VALUES (?,?,?,'active',?,?,?)").run(target.teamId,target.id,role,memberRole,actor.userId,at);
 const fresh=administratorBusinessTarget(db,actor.userId,target.id);
 if(!fresh||fresh.teamId!==target.teamId||fresh.role!==role||fresh.approvalStatus!==(role===null?'withdrawn':'approved')||fresh.revision<=target.revision||!approvedAdministratorBusiness(db,target.id,target.teamId,{technical:true}))administratorBusinessConflict();
 db.prepare('INSERT INTO team_administrator_business_role_events(event_id,team_id,actor_id,target_user_id,before_role,after_role,before_revision,after_revision,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),target.teamId,actor.userId,target.id,target.role,role,target.revision,fresh.revision,at);
 return {changed:true,role,revision:fresh.revision};
}
export async function handleAdministratorBusinessRoleRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
 const url=new URL(request.url),access=url.pathname==='/api/auth/administrator-business-role/access',list=url.pathname==='/api/administrator-business-roles',change=/^\/api\/administrator-business-roles\/([^/]+)$/.exec(url.pathname);
 if(!access&&!list&&!change)return null;if((access||change)&&url.search)invalid();if(request.method!==(change?'POST':'GET'))return method(change?'POST':'GET');
 const options={now,identityProviders,deviceContext},actor=deviceActor(db,request,identityProviders,deviceContext,administratorBusinessTime(now()));
 if(access)return json({canReview:!!administratorBusinessReviewer(db,actor.userId)});
 const authority=administratorBusinessReviewer(db,actor.userId);if(!authority)deny();
 if(list){const result=listAdministratorBusinessTargets(db,actor.userId,administratorBusinessQuery(url.searchParams));currentReviewer(db,request,actor,options,authority.stamp);return json(result);}
 const userId=change[1];if(!ID.test(userId))deny();const before=currentState(db,request,actor,options,userId);
 const body=await readJson(request,['revision','role','currentPassword']);
 if(!Number.isSafeInteger(body.revision)||body.revision<0||body.role!==null&&!administratorBusinessRoles.includes(body.role)||typeof body.currentPassword!=='string'||!body.currentPassword||Buffer.byteLength(body.currentPassword)>512)invalid();
 const expected={authority:before.authority.stamp,target:before.target.stamp,revision:body.revision},fresh=()=>currentState(db,request,actor,options,userId,expected);fresh();
 if(body.role===before.target.role&&['approved','withdrawn'].includes(before.target.approvalStatus)||body.role===null&&!before.target.member)administratorBusinessConflict();
 consume(db,'administrator-business-role:'+digest(actor.userId),administratorBusinessTime(now()),15*60000,20);
 return limitedPasswordWork(db,async()=>{
  const valid=await verifyPassword(body.currentPassword,before.authority.credential.password_hash);fresh();if(!valid)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
  return transaction(db,()=>{const state=fresh(),result=publishRole(db,actor,state.target,body.role,administratorBusinessTime(now()));currentReviewer(db,request,actor,options,expected.authority);
   const final=administratorBusinessTarget(db,actor.userId,userId);if(!final||final.revision!==result.revision||final.role!==body.role||final.approvalStatus!==(body.role===null?'withdrawn':'approved'))administratorBusinessConflict();return json(result);});
 });
}
