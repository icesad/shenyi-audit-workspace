import {randomUUID} from 'node:crypto';
import {projectIncrement,managedProject,projectTime} from './project-access-policy.mjs';
import {workspaceSourceGrant,workspaceSourceConflict} from './workspace-source-policy.mjs';
const changes=db=>{const query=db.prepare('SELECT total_changes() n');query.setReadBigInts(true);return query.get().n;};

export function workspaceSourceAudit(db,{teamId,projectId,actorId,userId,action,before,after,reason='',at}){
 const project=managedProject(db,teamId,projectId);if(!project)workspaceSourceConflict();
 const eventId=randomUUID(),row={event_id:eventId,team_id:teamId,project_id:projectId,actor_id:actorId,target_user_id:userId,action,before_revision:before.revision,after_revision:after.revision,read_before:Number(before.read),export_before:Number(before.export),read_after:Number(after.read),export_after:Number(after.export),project_revision:project.revision,reason,created_at:projectTime(at)};
 const keys=Object.keys(row);db.prepare('INSERT INTO team_workspace_source_events('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k]));
 const actual=db.prepare('SELECT * FROM team_workspace_source_events WHERE event_id=?').get(eventId);if(!actual||keys.some(k=>actual[k]!==row[k]))workspaceSourceConflict();return eventId;
}
export function writeWorkspaceSourceGrant(db,{teamId,projectId,userId,read,export:exporting,before}){
 const next=projectIncrement(before.revision,0);let result;
 if(before.exists)result=db.prepare('UPDATE team_workspace_source_grants SET can_read=?,can_export=?,eligible=1,revision=? WHERE team_id=? AND project_id=? AND user_id=? AND revision=?').run(Number(read),Number(exporting),next,teamId,projectId,userId,before.revision);
 else result=db.prepare('INSERT INTO team_workspace_source_grants(team_id,project_id,user_id,can_read,can_export,eligible,revision) VALUES (?,?,?,?,?,1,1)').run(teamId,projectId,userId,Number(read),Number(exporting));
 if(result.changes!==1)workspaceSourceConflict();const after=workspaceSourceGrant(db,teamId,projectId,userId);
 if(after.revision!==next||!after.eligible||after.read!==read||after.export!==exporting)workspaceSourceConflict();return after;
}
export function hasWorkspaceSourceGrantFlags(db,teamId,projectId,userId){return !!db.prepare('SELECT 1 FROM team_workspace_source_grants WHERE team_id=? AND project_id=? AND user_id=? AND (can_read=1 OR can_export=1)').get(teamId,projectId,userId);}
export function revokeWorkspaceSourceAccess(db,{actorId,teamId,userId,projectId=null,reason,at}){
 const rows=db.prepare(`SELECT project_id FROM team_workspace_source_grants WHERE team_id=? AND user_id=? AND (can_read=1 OR can_export=1)${projectId?' AND project_id=?':''} ORDER BY project_id COLLATE BINARY`).all(teamId,userId,...(projectId?[projectId]:[]));
 for(const row of rows){
  const before=workspaceSourceGrant(db,teamId,row.project_id,userId),revision=projectIncrement(before.revision,0),start=changes(db);
  if(db.prepare('UPDATE team_workspace_source_grants SET can_read=0,can_export=0,eligible=0,revision=? WHERE team_id=? AND project_id=? AND user_id=? AND revision=?').run(revision,teamId,row.project_id,userId,before.revision).changes!==1)workspaceSourceConflict();
  const after=workspaceSourceGrant(db,teamId,row.project_id,userId);workspaceSourceAudit(db,{teamId,projectId:row.project_id,actorId,userId,action:'access.revoked',before,after,reason,at});
  if(after.read||after.export||after.revision!==revision||workspaceSourceGrant(db,teamId,row.project_id,userId).stamp!==after.stamp||changes(db)-start!==2n)workspaceSourceConflict();
 }
 return rows.length;
}
