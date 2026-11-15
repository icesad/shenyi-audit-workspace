import {createHash,randomUUID} from 'node:crypto';
import {authenticated,consume,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {prepareProjectAccessRevocation,finishProjectAccessRevocation} from './project-access-policy.mjs';
import {memberAccessAuthority,memberAccessOverview,memberAccessOwner,memberAccessTarget,memberIdentityRevision,memberListQuery,listMemberAccessTargets} from './member-access-policy.mjs';
import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const conflict=()=>{throw new ApiError(409,'MEMBER_ACCESS_CONFLICT','成员或授权状态已改变，请刷新核对。');};
const method=allow=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow});
function currentActor(db,request,userId,at){const actor=authenticated(db,request,at);if(actor.userId!==userId)deny();return actor;}
function trustedIncrement(value){const revision=Number(value);if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)conflict();return revision;}
function currentState(db,request,actorId,kind,teamId,userId,at,stamp,revision){
  currentActor(db,request,actorId,at);
  const authority=memberAccessAuthority(db,actorId,kind,teamId);if(!authority)deny();if(stamp!==undefined&&authority.stamp!==stamp)conflict();
  const target=memberAccessTarget(db,actorId,kind,teamId,userId);if(!target)deny();if(target.status!=='active'||revision!==undefined&&target.revision!==revision)conflict();
  return {authority,target};
}
function disableMember(db,actorId,kind,teamId,target,at){
  const tasks=db.prepare(`SELECT DISTINCT assignment.task_id,CAST(COALESCE(version.revision,0) AS TEXT) AS revision
    FROM team_task_assignments AS assignment LEFT JOIN team_task_versions AS version
      ON version.team_id=assignment.team_id AND version.task_id=assignment.task_id
    WHERE assignment.team_id=? AND assignment.user_id=? AND assignment.status='active'`).all(teamId,target.id)
    .map(row=>({...row,revision:trustedIncrement(row.revision)}));
  const recoveries=db.prepare("SELECT request_id,CAST(revision AS TEXT) AS revision FROM team_recovery_requests WHERE target_user_id=? AND status IN ('pending','approved')").all(target.id)
    .map(row=>({...row,revision:trustedIncrement(row.revision)}));
  const membershipCount=db.prepare('SELECT COUNT(*) n FROM team_memberships WHERE team_id=? AND user_id=?').get(teamId,target.id).n;
  if(target.revision>Number.MAX_SAFE_INTEGER-(1+2*membershipCount+(kind==='administrator'?2:0)))conflict();
  const projectRevocations=prepareProjectAccessRevocation(db,{actorId,teamId,userId:target.id,reason:'member.disabled',at});
  db.prepare("UPDATE team_users SET status='disabled' WHERE user_id=? AND status='active'").run(target.id);
  db.prepare("UPDATE team_memberships SET status='disabled' WHERE team_id=? AND user_id=?").run(teamId,target.id);
  db.prepare("UPDATE team_operators SET status='revoked' WHERE team_id=? AND user_id=?").run(teamId,target.id);
  db.prepare('UPDATE team_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(at,target.id);
  for(const table of ['team_task_assignments','team_project_grants','team_attachment_grants','team_admin_grants'])db.prepare(`UPDATE ${table} SET status='revoked' WHERE team_id=? AND user_id=? AND status='active'`).run(teamId,target.id);
  finishProjectAccessRevocation(db,projectRevocations);
  for(const task of tasks){const changed=db.prepare(`INSERT INTO team_task_versions(team_id,task_id,revision) VALUES (?,?,?)
    ON CONFLICT(team_id,task_id) DO UPDATE SET revision=excluded.revision WHERE team_task_versions.revision=?`).run(teamId,task.task_id,task.revision+1,task.revision);if(changed.changes!==1)conflict();}
  db.prepare('UPDATE team_invitations SET expires_at=MIN(expires_at,?) WHERE team_id=? AND invited_by=? AND accepted_at IS NULL').run(at,teamId,target.id);
  for(const [invitations,challenges] of [['team_employee_invitations','team_employee_activation_challenges'],['team_operator_employee_invitations','team_operator_employee_activation_challenges']]){
    db.prepare(`UPDATE ${challenges} SET delivery_state='failed' WHERE consumed_at IS NULL AND invitation_id IN
      (SELECT invitation_id FROM ${invitations} WHERE team_id=? AND invited_by=? AND accepted_at IS NULL)`).run(teamId,target.id);
    db.prepare(`UPDATE ${invitations} SET revoked_at=COALESCE(revoked_at,?) WHERE team_id=? AND invited_by=? AND accepted_at IS NULL`).run(at,teamId,target.id);
  }
  db.prepare("UPDATE team_phone_challenges SET consumed_at=?,delivery_state='failed' WHERE user_id=? AND consumed_at IS NULL").run(at,target.id);
  for(const row of recoveries){const changed=db.prepare("UPDATE team_recovery_requests SET status='revoked',revision=revision+1 WHERE request_id=? AND revision=? AND status IN ('pending','approved')").run(row.request_id,row.revision);if(changed.changes!==1)conflict();}
  db.prepare("UPDATE team_wechat_transactions SET status='canceled' WHERE user_id=? AND status='ready'").run(target.id);
  // The existing identity triggers can bump more than once. Keep the resulting
  // trusted revision representable without prescribing a single increment.
  try{memberIdentityRevision(db,target.id);}catch{conflict();}
  db.prepare('INSERT INTO team_member_access_events(event_id,team_id,actor_id,target_user_id,target_kind,before_revision,created_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(),teamId,actorId,target.id,kind,target.revision,at);
}
export async function handleMemberAccessRequest(request,{db,now=Date.now}={}){
  const url=new URL(request.url),path=url.pathname,access=path==='/api/auth/member-management/access',administrators=path==='/api/administration/team-administrators';
  const business=/^\/api\/teams\/([^/]+)\/business-members$/.exec(path),disable=/^\/api\/teams\/([^/]+)\/(business-members|administrators)\/([^/]+)\/disable$/.exec(path);
  if(!access&&!administrators&&!business&&!disable)return null;
  if((access||disable)&&url.search)invalid();
  const actor=authenticated(db,request,now());
  if(access){if(request.method!=='GET')return method('GET');return json(memberAccessOverview(db,actor.userId));}
  if(administrators){if(request.method!=='GET')return method('GET');if(!memberAccessOwner(db,actor.userId))deny();return json(listMemberAccessTargets(db,actor.userId,'administrator',null,memberListQuery(url.searchParams)));}
  const teamId=(business||disable)[1];if(!ID.test(teamId))deny();
  if(business){if(request.method!=='GET')return method('GET');if(!memberAccessAuthority(db,actor.userId,'business',teamId))deny();return json(listMemberAccessTargets(db,actor.userId,'business',teamId,memberListQuery(url.searchParams)));}
  if(request.method!=='POST')return method('POST');const userId=disable[3];if(!ID.test(userId))deny();const kind=disable[2]==='business-members'?'business':'administrator';
  const before=currentState(db,request,actor.userId,kind,teamId,userId,now());
  const body=await readJson(request,['revision','currentPassword']);
  if(!Number.isSafeInteger(body.revision)||body.revision<0||typeof body.currentPassword!=='string'||!body.currentPassword||Buffer.byteLength(body.currentPassword)>512)invalid();
  if(before.target.revision!==body.revision)conflict();
  currentState(db,request,actor.userId,kind,teamId,userId,now(),before.authority.stamp,body.revision);
  consume(db,'member-disable:'+digest(actor.userId),now(),15*60000,20);
  return limitedPasswordWork(db,async()=>{
    const verified=await verifyPassword(body.currentPassword,before.authority.credential.password_hash);
    currentState(db,request,actor.userId,kind,teamId,userId,now(),before.authority.stamp,body.revision);
    if(!verified)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
    return transaction(db,()=>{const fresh=currentState(db,request,actor.userId,kind,teamId,userId,now(),before.authority.stamp,body.revision);disableMember(db,actor.userId,kind,teamId,fresh.target,now());return json({disabled:true});});
  });
}
