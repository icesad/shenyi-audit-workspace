import {randomUUID,createHash} from 'node:crypto';
import {consume,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {currentDeviceLease} from './device-policy.mjs';
import {revokeBusinessRoleAccess} from './business-role-transition.mjs';
import {memberListQuery} from './member-access-policy.mjs';
import {businessRoles,businessRoleConflict,businessRoleRevision,businessRoleIncrement,businessRoleEpoch,businessRoleTime,businessRoleAuthority,businessRoleAccess,businessRoleTarget,listBusinessRoleTargets} from './business-role-policy.mjs';
import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const method=allow=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow});
function deviceActor(db,request,providers,context,at){
 if(providers.deviceProofRequired!==true||!context)throw new ApiError(403,'DEVICE_PROOF_REQUIRED','请在已绑定设备上完成管理操作。');
 const actor=currentDeviceLease(db,request,at);
 if(actor.userId!==context.userId||actor.deviceId!==context.deviceId||actor.bindingRevision!==context.bindingRevision||actor.leaseId!==context.leaseId)throw new ApiError(403,'DEVICE_PROOF_REQUIRED','当前设备状态已改变，请重新核验。');
 return actor;
}
function currentState(db,request,before,providers,context,teamId,userId,at,expected={}){
 const actor=deviceActor(db,request,providers,context,at);
 if(actor.userId!==before.userId||actor.token!==before.token||actor.stamp!==before.stamp||actor.leaseId!==before.leaseId)businessRoleConflict();
 const authority=businessRoleAuthority(db,actor.userId,teamId);if(!authority)deny();if(expected.authority!==undefined&&authority.stamp!==expected.authority)businessRoleConflict();
 const target=businessRoleTarget(db,actor.userId,teamId,userId);if(!target)deny();
 if(expected.revision!==undefined&&target.revision!==expected.revision||expected.role!==undefined&&target.role!==expected.role||expected.target!==undefined&&target.stamp!==expected.target)businessRoleConflict();
 return {authority,target};
}
function changeRole(db,actorId,teamId,target,role,at){
 if(db.prepare("UPDATE team_memberships SET role=? WHERE team_id=? AND user_id=? AND status='active' AND role=?").run(role,teamId,target.id,target.role).changes!==1)businessRoleConflict();
 revokeBusinessRoleAccess(db,{actorId,teamId,userId:target.id,at});
 const revision=businessRoleEpoch(db,target.id);if(revision<=target.revision)businessRoleConflict();
 db.prepare('INSERT INTO team_business_role_events(event_id,team_id,actor_id,target_user_id,before_role,after_role,before_revision,after_revision,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),teamId,actorId,target.id,target.role,role,target.revision,revision,at);
 return {changed:true,role,revision};
}
export async function handleBusinessRoleRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
 const url=new URL(request.url),access=url.pathname==='/api/auth/business-role-management/access',list=/^\/api\/teams\/([^/]+)\/business-role-members$/.exec(url.pathname),change=/^\/api\/teams\/([^/]+)\/business-role-members\/([^/]+)\/role$/.exec(url.pathname);
 if(!access&&!list&&!change)return null;if((access||change)&&url.search)invalid();if(request.method!==(change?'POST':'GET'))return method(change?'POST':'GET');
 const actor=deviceActor(db,request,identityProviders,deviceContext,businessRoleTime(now()));if(access)return json(businessRoleAccess(db,actor.userId));
 const teamId=(list||change)[1];if(!ID.test(teamId)||!businessRoleAuthority(db,actor.userId,teamId))deny();
 if(list)return json(listBusinessRoleTargets(db,actor.userId,teamId,memberListQuery(url.searchParams)));
 const userId=change[2];if(!ID.test(userId))deny();const before=currentState(db,request,actor,identityProviders,deviceContext,teamId,userId,businessRoleTime(now()));
 const body=await readJson(request,['revision','role','currentPassword']);if(!Number.isSafeInteger(body.revision)||body.revision<0||!businessRoles.includes(body.role)||typeof body.currentPassword!=='string'||!body.currentPassword||Buffer.byteLength(body.currentPassword)>512)invalid();
 const expected={authority:before.authority.stamp,target:before.target.stamp,revision:body.revision,role:before.target.role};
 const fresh=()=>currentState(db,request,actor,identityProviders,deviceContext,teamId,userId,businessRoleTime(now()),expected);fresh();if(body.role===before.target.role)businessRoleConflict();
 consume(db,'business-role:'+digest(actor.userId),businessRoleTime(now()),15*60000,20);
 return limitedPasswordWork(db,async()=>{const valid=await verifyPassword(body.currentPassword,before.authority.credential.password_hash);fresh();if(!valid)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
  return transaction(db,()=>{const state=fresh();return json(changeRole(db,actor.userId,teamId,state.target,body.role,businessRoleTime(now())));});
 });
}
