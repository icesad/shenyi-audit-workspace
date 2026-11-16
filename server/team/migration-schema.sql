-- Human-approved governance registration only; never a professional import.
CREATE TABLE IF NOT EXISTS team_project_migration_reviewers (
 user_id TEXT PRIMARY KEY REFERENCES team_users(user_id),
 permission TEXT NOT NULL CHECK(permission='project.migrate'),
 status TEXT NOT NULL CHECK(status IN ('active','revoked')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1 AND revision<=9007199254740991)
);
CREATE TABLE IF NOT EXISTS team_project_migration_provenance (
 request_id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL UNIQUE,
 team_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL,
 source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
 source_json TEXT NOT NULL CHECK(length(CAST(source_json AS BLOB))<=131072),
 business_number TEXT NOT NULL,
 number_year INTEGER NOT NULL CHECK(number_year BETWEEN 1900 AND 9999),
 number_sequence INTEGER NOT NULL CHECK(number_sequence BETWEEN 1 AND 9999),
 legacy_manager_name TEXT NOT NULL,
 original_creator_known INTEGER NOT NULL DEFAULT 0 CHECK(original_creator_known=0),
 reviewed_by TEXT NOT NULL REFERENCES team_users(user_id),
 registered_at INTEGER NOT NULL CHECK(registered_at>=0 AND registered_at<=9007199254740991),
 can_read INTEGER NOT NULL CHECK(can_read IN (0,1)),
 can_manage INTEGER NOT NULL CHECK(can_manage IN (0,1)),
 can_review INTEGER NOT NULL CHECK(can_review IN (0,1)),
 CHECK(can_read=1 OR (can_manage=0 AND can_review=0)),
 UNIQUE(team_id,number_year,number_sequence),
 FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id),
 FOREIGN KEY(team_id,owner_user_id) REFERENCES team_memberships(team_id,user_id)
);
CREATE TABLE IF NOT EXISTS team_project_migration_events (
 event_id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL UNIQUE REFERENCES team_project_migration_provenance(request_id),
 team_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES team_users(user_id),
 owner_user_id TEXT NOT NULL REFERENCES team_users(user_id),
 action TEXT NOT NULL CHECK(action='registered'),
 source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
 created_at INTEGER NOT NULL CHECK(created_at>=0 AND created_at<=9007199254740991),
 FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id)
);
CREATE INDEX IF NOT EXISTS project_migration_events_actor ON team_project_migration_events(actor_id,created_at,event_id);
CREATE TRIGGER IF NOT EXISTS migration_provenance_no_update BEFORE UPDATE ON team_project_migration_provenance
BEGIN SELECT RAISE(ABORT,'Migration provenance is immutable'); END;
CREATE TRIGGER IF NOT EXISTS migration_provenance_no_delete BEFORE DELETE ON team_project_migration_provenance
BEGIN SELECT RAISE(ABORT,'Migration provenance must be retained'); END;
CREATE TRIGGER IF NOT EXISTS migration_events_no_update BEFORE UPDATE ON team_project_migration_events
BEGIN SELECT RAISE(ABORT,'Migration audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS migration_events_no_delete BEFORE DELETE ON team_project_migration_events
BEGIN SELECT RAISE(ABORT,'Migration audit must be retained'); END;
CREATE TRIGGER IF NOT EXISTS migration_reviewer_epoch_insert AFTER INSERT ON team_project_migration_reviewers BEGIN
 INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS migration_reviewer_epoch_update AFTER UPDATE ON team_project_migration_reviewers BEGIN
 INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
 INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES(NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS migration_reviewer_epoch_delete AFTER DELETE ON team_project_migration_reviewers BEGIN
 INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES(OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
