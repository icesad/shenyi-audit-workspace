import {REVIEWER_TABLES} from './reviewer-policy.mjs';

export function installLedgerCheckQualificationTriggers(db){
 const invalidate=where=>`SELECT CASE WHEN EXISTS(SELECT 1 FROM team_ledger_check_grants ledger_grant WHERE ledger_grant.eligible=1 AND ledger_grant.can_read=1 AND (${where}) AND ledger_grant.revision>=9007199254740991) THEN RAISE(ABORT,'LEDGER_CHECK_CONFLICT') END;
 UPDATE team_ledger_check_grants SET eligible=0,revision=revision+1 WHERE eligible=1 AND can_read=1 AND (${where.replaceAll('ledger_grant.','team_ledger_check_grants.')});`;
 for(const table of ['team_memberships','team_operators','team_administrator_business_roles'])for(const kind of ['INSERT','UPDATE','DELETE']){
  const where=kind==='INSERT'?'ledger_grant.user_id=NEW.user_id':kind==='DELETE'?'ledger_grant.user_id=OLD.user_id':'(ledger_grant.user_id=OLD.user_id OR ledger_grant.user_id=NEW.user_id)';
  const when=kind==='UPDATE'&&table!=='team_administrator_business_roles'?"WHEN OLD.team_id IS NOT NEW.team_id OR OLD.user_id IS NOT NEW.user_id OR OLD.role IS NOT NEW.role OR OLD.status IS NOT NEW.status":'';
  db.exec(`CREATE TRIGGER IF NOT EXISTS ledger_check_qualification_${table}_${kind.toLowerCase()} AFTER ${kind} ON ${table} ${when} BEGIN ${invalidate(where)} END;`);
 }
 for(const table of REVIEWER_TABLES)db.exec(`CREATE TRIGGER IF NOT EXISTS ledger_check_qualification_${table}_insert AFTER INSERT ON ${table} BEGIN ${invalidate('ledger_grant.user_id=NEW.user_id')} END;`);
 db.exec(`CREATE TRIGGER IF NOT EXISTS ledger_check_qualification_account AFTER UPDATE OF status ON team_users WHEN OLD.status IS NOT NEW.status BEGIN ${invalidate('ledger_grant.user_id=NEW.user_id')} END;`);
 db.exec(`CREATE TRIGGER IF NOT EXISTS ledger_check_qualification_team AFTER UPDATE OF status ON teams WHEN OLD.status IS NOT NEW.status BEGIN ${invalidate('ledger_grant.team_id=NEW.team_id')} END;`);
 db.exec(`CREATE TRIGGER IF NOT EXISTS ledger_check_qualification_project AFTER UPDATE OF status ON team_projects WHEN OLD.status IS NOT NEW.status AND NEW.status NOT IN ('active','frozen') BEGIN ${invalidate('ledger_grant.team_id=NEW.team_id AND ledger_grant.project_id=NEW.project_id')} END;`);
 db.exec(`CREATE TRIGGER IF NOT EXISTS ledger_check_qualification_owner_update AFTER UPDATE ON team_project_access_grants WHEN OLD.permission='project.owner' AND (OLD.status IS NOT NEW.status OR OLD.team_id IS NOT NEW.team_id OR OLD.project_id IS NOT NEW.project_id OR OLD.user_id IS NOT NEW.user_id OR OLD.permission IS NOT NEW.permission) BEGIN ${invalidate('ledger_grant.team_id=OLD.team_id AND ledger_grant.project_id=OLD.project_id AND ledger_grant.user_id=OLD.user_id')} END;`);
 db.exec(`CREATE TRIGGER IF NOT EXISTS ledger_check_qualification_owner_delete AFTER DELETE ON team_project_access_grants WHEN OLD.permission='project.owner' BEGIN ${invalidate('ledger_grant.team_id=OLD.team_id AND ledger_grant.project_id=OLD.project_id AND ledger_grant.user_id=OLD.user_id')} END;`);
}
