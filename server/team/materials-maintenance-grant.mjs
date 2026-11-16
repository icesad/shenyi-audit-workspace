import {projectRevision} from './project-access-policy.mjs';
export function maintenanceGrant(db,teamId,projectId,userId,readGrant){
 const row=db.prepare('SELECT *,CAST(revision AS TEXT) revision,CAST(read_grant_revision AS TEXT) read_grant_revision FROM team_material_maintenance_grants WHERE team_id=? AND project_id=? AND user_id=?').get(teamId,projectId,userId);
 return {revision:row?projectRevision(row.revision):0,readRevision:row?projectRevision(row.read_grant_revision):0,maintain:!!row&&row.can_maintain===1&&row.eligible===1&&readGrant.read&&projectRevision(row.read_grant_revision)===readGrant.revision};
}
export function materialRequestUsed(db,requestId,{activeImport=null}={}){
 return !!db.prepare(`SELECT 1 FROM team_material_events WHERE request_id=? UNION ALL SELECT 1 FROM team_material_maintenance_events WHERE request_id=? UNION ALL SELECT 1 FROM team_material_imports WHERE request_id=? ${activeImport?'AND NOT(request_id=? AND team_id=? AND project_id=? AND actor_id=? AND status=\'active\')':''} LIMIT 1`).get(requestId,requestId,requestId,...(activeImport?[requestId,activeImport.teamId,activeImport.projectId,activeImport.actorId]:[]));
}
