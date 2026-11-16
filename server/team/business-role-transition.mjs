import {prepareProjectAccessRevocation,finishProjectAccessRevocation} from './project-access-policy.mjs';
import {businessRoleRevision,businessRoleIncrement,businessRoleConflict} from './business-role-policy.mjs';
import {revokeMaterialAccess} from './materials-policy.mjs';

// Internal transaction helper; caller owns membership, approval and final audit.
export function revokeBusinessRoleAccess(db,{actorId,teamId,userId,at,reason='business-role.changed'}){
 revokeMaterialAccess(db,{actorId,teamId,userId,at,reason});
 const tasks=db.prepare(`SELECT DISTINCT assignment.task_id,CAST(COALESCE(version.revision,0) AS TEXT) AS revision
 FROM team_task_assignments assignment LEFT JOIN team_task_versions version ON version.team_id=assignment.team_id AND version.task_id=assignment.task_id
 WHERE assignment.team_id=? AND assignment.user_id=? AND assignment.status='active'`).all(teamId,userId).map(row=>({...row,next:businessRoleIncrement(row.revision),revision:businessRoleRevision(row.revision)}));
 const recoveries=db.prepare("SELECT request_id,CAST(revision AS TEXT) AS revision FROM team_recovery_requests WHERE target_user_id=? AND status IN ('pending','approved')").all(userId).map(row=>({...row,revision:businessRoleRevision(row.revision,1),next:businessRoleIncrement(row.revision,1)}));
 const replacements=db.prepare("SELECT request_id,CAST(revision AS TEXT) AS revision FROM team_device_replacement_requests WHERE user_id=? AND status IN ('pending','approved')").all(userId).map(row=>({...row,revision:businessRoleRevision(row.revision,1),next:businessRoleIncrement(row.revision,1)}));
 const projectRevocations=prepareProjectAccessRevocation(db,{actorId,teamId,userId:userId,reason,at});
 db.prepare('UPDATE team_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(at,userId);
 db.prepare('UPDATE team_device_leases SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(at,userId);
 db.prepare('UPDATE team_device_challenges SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL').run(at,userId);
 for(const table of ['team_task_assignments','team_project_grants','team_attachment_grants','team_admin_grants'])db.prepare(`UPDATE ${table} SET status='revoked' WHERE team_id=? AND user_id=? AND status='active'`).run(teamId,userId);
 finishProjectAccessRevocation(db,projectRevocations);
 for(const task of tasks){const changed=db.prepare(`INSERT INTO team_task_versions(team_id,task_id,revision) VALUES (?,?,?)
 ON CONFLICT(team_id,task_id) DO UPDATE SET revision=excluded.revision WHERE team_task_versions.revision=?`).run(teamId,task.task_id,task.next,task.revision);if(changed.changes!==1)businessRoleConflict();}
 db.prepare('UPDATE team_invitations SET expires_at=MIN(expires_at,?) WHERE team_id=? AND invited_by=? AND accepted_at IS NULL').run(at,teamId,userId);
 for(const [invitations,challenges] of [['team_employee_invitations','team_employee_activation_challenges'],['team_operator_employee_invitations','team_operator_employee_activation_challenges']]){
  db.prepare(`UPDATE ${challenges} SET delivery_state='failed' WHERE consumed_at IS NULL AND invitation_id IN
   (SELECT invitation_id FROM ${invitations} WHERE team_id=? AND invited_by=? AND accepted_at IS NULL)`).run(teamId,userId);
  db.prepare(`UPDATE ${invitations} SET revoked_at=COALESCE(revoked_at,?) WHERE team_id=? AND invited_by=? AND accepted_at IS NULL`).run(at,teamId,userId);
 }
 db.prepare("UPDATE team_phone_challenges SET consumed_at=?,delivery_state='failed' WHERE user_id=? AND consumed_at IS NULL").run(at,userId);
 db.prepare("UPDATE team_wechat_transactions SET status='canceled' WHERE user_id=? AND status='ready'").run(userId);
 for(const row of recoveries)if(db.prepare("UPDATE team_recovery_requests SET status='revoked',revision=? WHERE request_id=? AND revision=? AND status IN ('pending','approved')").run(row.next,row.request_id,row.revision).changes!==1)businessRoleConflict();
 for(const row of replacements)if(db.prepare("UPDATE team_device_replacement_requests SET status='revoked',revision=? WHERE request_id=? AND revision=? AND status IN ('pending','approved')").run(row.next,row.request_id,row.revision).changes!==1)businessRoleConflict();
 db.prepare('UPDATE team_device_replacement_challenges SET revoked_at=? WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL').run(at,userId);
}
