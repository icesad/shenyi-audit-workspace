import {randomUUID} from 'node:crypto';
import {projectIncrement,managedProject,projectTime} from './project-access-policy.mjs';
import {workpaperAccessGrant,workpaperAccessConflict} from './workpaper-access-policy.mjs';

export function workpaperAccessAudit(db,{teamId,projectId,actorId,userId,action,before,after,reason='',at}){
 const project=managedProject(db,teamId,projectId);if(!project)workpaperAccessConflict();
 const row={event_id:randomUUID(),team_id:teamId,project_id:projectId,actor_id:actorId,target_user_id:userId,action,before_revision:before.revision,after_revision:after.revision,
 read_before:Number(before.rawRead),read_after:Number(after.rawRead),write_before:Number(before.rawWrite),write_after:Number(after.rawWrite),export_before:Number(before.rawExport),export_after:Number(after.rawExport),eligible_before:Number(before.eligible),eligible_after:Number(after.eligible),project_revision:project.revision,reason,created_at:projectTime(at)},keys=Object.keys(row);
 db.prepare('INSERT INTO team_workpaper_access_events('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k]));
 const actual=db.prepare('SELECT * FROM team_workpaper_access_events WHERE event_id=?').get(row.event_id);if(!actual||keys.some(k=>actual[k]!==row[k]))workpaperAccessConflict();
}
export function writeWorkpaperAccessGrant(db,{teamId,projectId,userId,read,write,export:exporting,before}){
 const next=projectIncrement(before.revision,0);let result;
 if(before.exists)result=db.prepare('UPDATE team_workpaper_access_grants SET can_read=?,can_write=?,can_export=?,eligible=1,revision=? WHERE team_id=? AND project_id=? AND user_id=? AND revision=?').run(Number(read),Number(write),Number(exporting),next,teamId,projectId,userId,before.revision);
 else result=db.prepare('INSERT INTO team_workpaper_access_grants(team_id,project_id,user_id,can_read,can_write,can_export,eligible,revision) VALUES (?,?,?,?,?,?,1,1)').run(teamId,projectId,userId,Number(read),Number(write),Number(exporting));
 if(result.changes!==1)workpaperAccessConflict();const after=workpaperAccessGrant(db,teamId,projectId,userId);
 if(after.revision!==next||!after.eligible||after.rawRead!==read||after.rawWrite!==write||after.rawExport!==exporting)workpaperAccessConflict();return after;
}
export function hasWorkpaperAccessGrantFlags(db,teamId,projectId,userId){return !!db.prepare('SELECT 1 FROM team_workpaper_access_grants WHERE team_id=? AND project_id=? AND user_id=? AND (can_read=1 OR can_write=1 OR can_export=1)').get(teamId,projectId,userId);}
// Callers own the encompassing member/project/role transaction.
export function revokeWorkpaperAccess(db,{actorId,teamId,userId,projectId=null,reason,at}){
 const rows=db.prepare(`SELECT project_id FROM team_workpaper_access_grants WHERE team_id=? AND user_id=? AND (can_read=1 OR can_write=1 OR can_export=1)${projectId?' AND project_id=?':''} ORDER BY project_id COLLATE BINARY`).all(teamId,userId,...(projectId?[projectId]:[]));
 for(const row of rows){const before=workpaperAccessGrant(db,teamId,row.project_id,userId),next=projectIncrement(before.revision,0);
  if(db.prepare('UPDATE team_workpaper_access_grants SET can_read=0,can_write=0,can_export=0,eligible=0,revision=? WHERE team_id=? AND project_id=? AND user_id=? AND revision=?').run(next,teamId,row.project_id,userId,before.revision).changes!==1)workpaperAccessConflict();
  const after=workpaperAccessGrant(db,teamId,row.project_id,userId);workpaperAccessAudit(db,{teamId,projectId:row.project_id,actorId,userId,action:'access.revoked',before,after,reason,at});
  if(after.read||after.write||after.export||after.rawRead||after.rawWrite||after.rawExport||after.revision!==next||workpaperAccessGrant(db,teamId,row.project_id,userId).stamp!==after.stamp)workpaperAccessConflict();
 }return rows.length;
}
