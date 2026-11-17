import {randomUUID} from 'node:crypto';
import {projectIncrement,managedProject,projectTime} from './project-access-policy.mjs';
import {ledgerGrant,ledgerConflict} from './ledger-check-policy.mjs';
export function ledgerAudit(db,{teamId,projectId,actorId,userId,action,before,after,reason='',at}){
 const project=managedProject(db,teamId,projectId);if(!project)ledgerConflict();
 const row={event_id:randomUUID(),team_id:teamId,project_id:projectId,actor_id:actorId,target_user_id:userId,action,before_revision:before.revision,after_revision:after.revision,read_before:Number(before.read),read_after:Number(after.read),project_revision:project.revision,reason,created_at:projectTime(at)},keys=Object.keys(row);
 db.prepare('INSERT INTO team_ledger_check_events('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k]));
 const actual=db.prepare('SELECT * FROM team_ledger_check_events WHERE event_id=?').get(row.event_id);if(!actual||keys.some(k=>actual[k]!==row[k]))ledgerConflict();
}
export function writeLedgerGrant(db,{teamId,projectId,userId,read,before}){
 const next=projectIncrement(before.revision,0);let result;
 if(before.exists)result=db.prepare('UPDATE team_ledger_check_grants SET can_read=?,eligible=1,revision=? WHERE team_id=? AND project_id=? AND user_id=? AND revision=?').run(Number(read),next,teamId,projectId,userId,before.revision);
 else result=db.prepare('INSERT INTO team_ledger_check_grants VALUES (?,?,?, ?,1,1)').run(teamId,projectId,userId,Number(read));
 if(result.changes!==1)ledgerConflict();const after=ledgerGrant(db,teamId,projectId,userId);if(after.revision!==next||!after.eligible||after.read!==read)ledgerConflict();return after;
}
export function hasLedgerGrantFlags(db,teamId,projectId,userId){return !!db.prepare('SELECT 1 FROM team_ledger_check_grants WHERE team_id=? AND project_id=? AND user_id=? AND can_read=1').get(teamId,projectId,userId);}
export function revokeLedgerAccess(db,{actorId,teamId,userId,projectId=null,reason,at}){
 const rows=db.prepare(`SELECT project_id FROM team_ledger_check_grants WHERE team_id=? AND user_id=? AND can_read=1${projectId?' AND project_id=?':''} ORDER BY project_id COLLATE BINARY`).all(teamId,userId,...(projectId?[projectId]:[]));
 for(const row of rows){const before=ledgerGrant(db,teamId,row.project_id,userId),next=projectIncrement(before.revision,0);
  if(db.prepare('UPDATE team_ledger_check_grants SET can_read=0,eligible=0,revision=? WHERE team_id=? AND project_id=? AND user_id=? AND revision=?').run(next,teamId,row.project_id,userId,before.revision).changes!==1)ledgerConflict();
  const after=ledgerGrant(db,teamId,row.project_id,userId);ledgerAudit(db,{teamId,projectId:row.project_id,actorId,userId,action:'access.revoked',before,after,reason,at});if(after.read||after.rawRead||after.revision!==next||ledgerGrant(db,teamId,row.project_id,userId).stamp!==after.stamp)ledgerConflict();
 }return rows.length;
}
