import {REVIEWER_TABLES} from './reviewer-policy.mjs';

// Leaf module: project policy may import this without importing source policy.
export function workspaceSourceVisibilitySql(userExpression,projectAlias='project'){
 if(!['?','member.user_id'].includes(userExpression)||projectAlias!=='project')throw Error('Untrusted source visibility alias');
 return `EXISTS(SELECT 1 FROM team_workspace_source_grants source_visibility WHERE source_visibility.team_id=project.team_id AND source_visibility.project_id=project.project_id AND source_visibility.user_id=${userExpression} AND source_visibility.eligible=1 AND (source_visibility.can_read=1 OR source_visibility.can_export=1))`;
}
export function installWorkspaceSourceQualificationTriggers(db){
 const invalidate=where=>`SELECT CASE WHEN EXISTS(SELECT 1 FROM team_workspace_source_grants source_grant WHERE source_grant.eligible=1 AND (source_grant.can_read=1 OR source_grant.can_export=1) AND (${where}) AND source_grant.revision>=9007199254740991) THEN RAISE(ABORT,'SOURCE_REVISION_CONFLICT') END;
 UPDATE team_workspace_source_grants SET eligible=0,revision=revision+1 WHERE eligible=1 AND (can_read=1 OR can_export=1) AND (${where.replaceAll('source_grant.','team_workspace_source_grants.')});`;
 for(const table of ['team_memberships','team_operators','team_administrator_business_roles'])for(const kind of ['INSERT','UPDATE','DELETE']){
  const where=kind==='INSERT'?'source_grant.user_id=NEW.user_id':kind==='DELETE'?'source_grant.user_id=OLD.user_id':'(source_grant.user_id=OLD.user_id OR source_grant.user_id=NEW.user_id)';
  const when=kind==='UPDATE'&&table!=='team_administrator_business_roles'?"WHEN OLD.team_id IS NOT NEW.team_id OR OLD.user_id IS NOT NEW.user_id OR OLD.role IS NOT NEW.role OR OLD.status IS NOT NEW.status":'';
  db.exec(`CREATE TRIGGER IF NOT EXISTS workspace_source_qualification_${table}_${kind.toLowerCase()} AFTER ${kind} ON ${table} ${when} BEGIN ${invalidate(where)} END;`);
 }
 // Reviewer history excludes business permanently. INSERT latches once; later
 // reviewer UPDATE/DELETE need no redundant source trigger.
 for(const table of REVIEWER_TABLES)db.exec(`CREATE TRIGGER IF NOT EXISTS workspace_source_qualification_${table}_insert AFTER INSERT ON ${table} BEGIN ${invalidate('source_grant.user_id=NEW.user_id')} END;`);
 db.exec(`CREATE TRIGGER IF NOT EXISTS workspace_source_qualification_account AFTER UPDATE OF status ON team_users WHEN OLD.status IS NOT NEW.status BEGIN ${invalidate('source_grant.user_id=NEW.user_id')} END;`);
 db.exec(`CREATE TRIGGER IF NOT EXISTS workspace_source_qualification_team AFTER UPDATE OF status ON teams WHEN OLD.status IS NOT NEW.status BEGIN ${invalidate('source_grant.team_id=NEW.team_id')} END;`);
 db.exec(`CREATE TRIGGER IF NOT EXISTS workspace_source_qualification_project AFTER UPDATE OF status ON team_projects WHEN OLD.status IS NOT NEW.status AND NEW.status NOT IN ('active','frozen') BEGIN ${invalidate('source_grant.team_id=NEW.team_id AND source_grant.project_id=NEW.project_id')} END;`);
 db.exec(`CREATE TRIGGER IF NOT EXISTS workspace_source_qualification_owner_update AFTER UPDATE ON team_project_access_grants WHEN OLD.permission='project.owner' AND (OLD.status IS NOT NEW.status OR OLD.team_id IS NOT NEW.team_id OR OLD.project_id IS NOT NEW.project_id OR OLD.user_id IS NOT NEW.user_id OR OLD.permission IS NOT NEW.permission) BEGIN ${invalidate('source_grant.team_id=OLD.team_id AND source_grant.project_id=OLD.project_id AND source_grant.user_id=OLD.user_id')} END;`);
 db.exec(`CREATE TRIGGER IF NOT EXISTS workspace_source_qualification_owner_delete AFTER DELETE ON team_project_access_grants WHEN OLD.permission='project.owner' BEGIN ${invalidate('source_grant.team_id=OLD.team_id AND source_grant.project_id=OLD.project_id AND source_grant.user_id=OLD.user_id')} END;`);
}
