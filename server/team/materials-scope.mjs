import {REVIEWER_TABLES} from './reviewer-policy.mjs';
export function materialVisibilitySql(userExpression,projectAlias='project'){
 if(!['?','member.user_id'].includes(userExpression)||projectAlias!=='project')throw Error('Untrusted material visibility aliases');
 return `EXISTS (SELECT 1 FROM team_material_grants material_visibility WHERE material_visibility.team_id=project.team_id AND material_visibility.project_id=project.project_id AND material_visibility.user_id=${userExpression} AND material_visibility.eligible=1 AND material_visibility.can_read=1)`;
}
export function installMaterialQualificationTriggers(db){
 const invalidate=where=>`SELECT CASE WHEN EXISTS(SELECT 1 FROM team_material_grants material JOIN team_project_access_projects project ON project.team_id=material.team_id AND project.project_id=material.project_id WHERE material.eligible=1 AND material.can_read=1 AND (${where}) AND (material.revision>=9007199254740991 OR project.revision>=9007199254740991)) THEN RAISE(ABORT,'MATERIAL_REVISION_MAX') END;
 UPDATE team_material_grants SET eligible=0,revision=revision+1 WHERE eligible=1 AND can_read=1 AND (${where.replaceAll('material.','team_material_grants.')});`;
 const userTables=['team_memberships','team_operators','team_administrator_business_roles',...REVIEWER_TABLES];
 for(const table of userTables)for(const kind of ['INSERT','UPDATE','DELETE']){
  const where=kind==='INSERT'?'material.user_id=NEW.user_id':kind==='DELETE'?'material.user_id=OLD.user_id':'(material.user_id=OLD.user_id OR material.user_id=NEW.user_id)';
  const when=kind==='UPDATE'&&table==='team_memberships'?"WHEN OLD.team_id IS NOT NEW.team_id OR OLD.user_id IS NOT NEW.user_id OR OLD.role IS NOT NEW.role OR OLD.status IS NOT NEW.status":kind==='UPDATE'&&table==='team_operators'?"WHEN OLD.team_id IS NOT NEW.team_id OR OLD.user_id IS NOT NEW.user_id OR OLD.role IS NOT NEW.role OR OLD.status IS NOT NEW.status":'';
  db.exec(`CREATE TRIGGER IF NOT EXISTS material_qualification_${table}_${kind.toLowerCase()} AFTER ${kind} ON ${table} ${when} BEGIN ${invalidate(where)} END;`);
 }
 db.exec(`CREATE TRIGGER IF NOT EXISTS material_qualification_account AFTER UPDATE OF status ON team_users WHEN OLD.status IS NOT NEW.status BEGIN ${invalidate('material.user_id=NEW.user_id')} END;`);
 db.exec(`CREATE TRIGGER IF NOT EXISTS material_qualification_team AFTER UPDATE OF status ON teams WHEN OLD.status IS NOT NEW.status BEGIN ${invalidate('material.team_id=NEW.team_id')} END;`);
}
