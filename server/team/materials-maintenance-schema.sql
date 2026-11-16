CREATE TABLE IF NOT EXISTS team_material_maintenance_grants (
 team_id TEXT NOT NULL,project_id TEXT NOT NULL,user_id TEXT NOT NULL,
 can_maintain INTEGER NOT NULL CHECK(can_maintain IN (0,1)),eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),read_grant_revision INTEGER NOT NULL CHECK(read_grant_revision BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(team_id,project_id,user_id),FOREIGN KEY(team_id,project_id,user_id) REFERENCES team_material_grants(team_id,project_id,user_id)
);
CREATE TABLE IF NOT EXISTS team_material_maintenance_events (
 event_id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,team_id TEXT NOT NULL,project_id TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES team_users(user_id),
 kind TEXT NOT NULL CHECK(kind IN ('attachment-add','attachment-remove')),file_id TEXT NOT NULL,node_id TEXT NOT NULL,generation_id TEXT NOT NULL,
 project_revision INTEGER NOT NULL,before_revision INTEGER NOT NULL,material_revision INTEGER NOT NULL,record_sha256 TEXT NOT NULL,
 package_sha256 TEXT NOT NULL,source_record_revision INTEGER NOT NULL,record_revision INTEGER NOT NULL,reason TEXT NOT NULL,committed_at INTEGER NOT NULL,
 FOREIGN KEY(team_id,project_id) REFERENCES team_material_records(team_id,project_id),FOREIGN KEY(team_id,project_id,file_id) REFERENCES team_material_files(team_id,project_id,file_id)
);
CREATE TRIGGER IF NOT EXISTS material_maintenance_grant_insert BEFORE INSERT ON team_material_maintenance_grants BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM team_project_access_projects WHERE team_id=NEW.team_id AND project_id=NEW.project_id AND revision>=9007199254740991) THEN RAISE(ABORT,'MATERIAL_REVISION_MAX') END;
END;
CREATE TRIGGER IF NOT EXISTS material_maintenance_grant_insert_revision AFTER INSERT ON team_material_maintenance_grants BEGIN UPDATE team_project_access_projects SET revision=revision+1 WHERE team_id=NEW.team_id AND project_id=NEW.project_id; END;
CREATE TRIGGER IF NOT EXISTS material_maintenance_grant_update BEFORE UPDATE ON team_material_maintenance_grants BEGIN
 SELECT CASE WHEN OLD.revision>=9007199254740991 OR NEW.revision<=OLD.revision OR EXISTS(SELECT 1 FROM team_project_access_projects WHERE team_id=OLD.team_id AND project_id=OLD.project_id AND revision>=9007199254740991) THEN RAISE(ABORT,'MATERIAL_REVISION_MAX') END;
END;
CREATE TRIGGER IF NOT EXISTS material_maintenance_grant_update_revision AFTER UPDATE ON team_material_maintenance_grants BEGIN UPDATE team_project_access_projects SET revision=revision+1 WHERE team_id=OLD.team_id AND project_id=OLD.project_id; END;
CREATE TRIGGER IF NOT EXISTS material_maintenance_grant_no_delete BEFORE DELETE ON team_material_maintenance_grants BEGIN SELECT RAISE(ABORT,'Material maintenance grant history must be retained'); END;
CREATE TRIGGER IF NOT EXISTS material_maintenance_grant_identity BEFORE UPDATE OF team_id,project_id,user_id ON team_material_maintenance_grants BEGIN SELECT RAISE(ABORT,'Material maintenance grant identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS material_maintenance_read_change_guard BEFORE UPDATE ON team_material_grants
 WHEN OLD.revision IS NOT NEW.revision OR OLD.can_read IS NOT NEW.can_read OR OLD.eligible IS NOT NEW.eligible BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM team_material_maintenance_grants maintenance JOIN team_project_access_projects project ON project.team_id=maintenance.team_id AND project.project_id=maintenance.project_id
 WHERE maintenance.team_id=OLD.team_id AND maintenance.project_id=OLD.project_id AND maintenance.user_id=OLD.user_id AND maintenance.can_maintain=1 AND maintenance.eligible=1 AND (maintenance.revision>=9007199254740991 OR project.revision>9007199254740989)) THEN RAISE(ABORT,'MATERIAL_REVISION_MAX') END;
END;
CREATE TRIGGER IF NOT EXISTS material_maintenance_read_change AFTER UPDATE ON team_material_grants
 WHEN OLD.revision IS NOT NEW.revision OR OLD.can_read IS NOT NEW.can_read OR OLD.eligible IS NOT NEW.eligible BEGIN
 UPDATE team_material_maintenance_grants SET eligible=0,revision=revision+1 WHERE team_id=OLD.team_id AND project_id=OLD.project_id AND user_id=OLD.user_id AND can_maintain=1 AND eligible=1;
END;
CREATE TRIGGER IF NOT EXISTS material_maintenance_events_no_update BEFORE UPDATE ON team_material_maintenance_events BEGIN SELECT RAISE(ABORT,'Material maintenance audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS material_maintenance_events_no_delete BEFORE DELETE ON team_material_maintenance_events BEGIN SELECT RAISE(ABORT,'Material maintenance audit must be retained'); END;
CREATE TRIGGER IF NOT EXISTS material_maintenance_request_slot BEFORE INSERT ON team_material_maintenance_events BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM team_material_events WHERE request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM team_material_imports WHERE request_id=NEW.request_id) THEN RAISE(ABORT,'MATERIAL_REQUEST_USED') END;
END;
CREATE TRIGGER IF NOT EXISTS material_events_maintenance_request_slot BEFORE INSERT ON team_material_events BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM team_material_maintenance_events WHERE request_id=NEW.request_id) OR (EXISTS(SELECT 1 FROM team_material_imports WHERE request_id=NEW.request_id) AND NOT(NEW.kind='import' AND EXISTS(SELECT 1 FROM team_material_imports WHERE request_id=NEW.request_id AND team_id=NEW.team_id AND project_id=NEW.project_id AND actor_id=NEW.actor_id AND status='active'))) THEN RAISE(ABORT,'MATERIAL_REQUEST_USED') END;
END;
CREATE TRIGGER IF NOT EXISTS material_imports_maintenance_request_slot BEFORE INSERT ON team_material_imports BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM team_material_events WHERE request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM team_material_maintenance_events WHERE request_id=NEW.request_id) THEN RAISE(ABORT,'MATERIAL_REQUEST_USED') END;
END;
