-- Saved ledger checks only. No calculation or workpaper authority is stored.
CREATE TABLE IF NOT EXISTS team_ledger_check_grants (
 team_id TEXT NOT NULL,project_id TEXT NOT NULL,user_id TEXT NOT NULL,
 can_read INTEGER NOT NULL CHECK(can_read IN (0,1)),eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(team_id,project_id,user_id),
 FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id),
 FOREIGN KEY(team_id,user_id) REFERENCES team_memberships(team_id,user_id)
);
CREATE INDEX IF NOT EXISTS ledger_check_grant_user ON team_ledger_check_grants(team_id,user_id,project_id);
CREATE TABLE IF NOT EXISTS team_ledger_check_events (
 event_id TEXT PRIMARY KEY,team_id TEXT NOT NULL,project_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES team_users(user_id),target_user_id TEXT NOT NULL REFERENCES team_users(user_id),
 action TEXT NOT NULL CHECK(action IN ('access.changed','access.revoked')),
 before_revision INTEGER NOT NULL CHECK(typeof(before_revision)='integer' AND before_revision BETWEEN 0 AND 9007199254740990),
 after_revision INTEGER NOT NULL CHECK(typeof(after_revision)='integer' AND after_revision=before_revision+1 AND after_revision<=9007199254740991),
 read_before INTEGER NOT NULL CHECK(read_before IN (0,1)),read_after INTEGER NOT NULL CHECK(read_after IN (0,1)),
 project_revision INTEGER NOT NULL CHECK(typeof(project_revision)='integer' AND project_revision BETWEEN 1 AND 9007199254740991),
 reason TEXT NOT NULL,created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991),
 FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id)
);
CREATE TABLE IF NOT EXISTS team_ledger_check_heads (
 team_id TEXT NOT NULL,project_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(team_id,project_id),FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id)
);
CREATE TABLE IF NOT EXISTS team_ledger_check_snapshots (
 snapshot_id TEXT PRIMARY KEY,team_id TEXT NOT NULL,project_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991),
 operation_id TEXT NOT NULL,request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
 source_json TEXT NOT NULL CHECK(typeof(source_json)='text' AND length(source_json) BETWEEN 1 AND 33554432),
 source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
 source_project_id TEXT NOT NULL,identity_stamp TEXT NOT NULL CHECK(length(identity_stamp)=64 AND identity_stamp NOT GLOB '*[^0-9a-f]*'),
 workspace_revision INTEGER NOT NULL CHECK(typeof(workspace_revision)='integer' AND workspace_revision BETWEEN 1 AND 9007199254740991),
 calculated_at TEXT NOT NULL,imported_by TEXT NOT NULL REFERENCES team_users(user_id),importer_name TEXT NOT NULL,
 imported_at INTEGER NOT NULL CHECK(typeof(imported_at)='integer' AND imported_at BETWEEN 0 AND 9007199254740991),
 UNIQUE(team_id,project_id,version),UNIQUE(team_id,project_id,operation_id),
 FOREIGN KEY(team_id,project_id) REFERENCES team_ledger_check_heads(team_id,project_id)
);
CREATE TRIGGER IF NOT EXISTS ledger_check_grant_no_delete BEFORE DELETE ON team_ledger_check_grants
BEGIN SELECT RAISE(ABORT,'Ledger grant history must be retained'); END;
CREATE TRIGGER IF NOT EXISTS ledger_check_grant_identity BEFORE UPDATE OF team_id,project_id,user_id ON team_ledger_check_grants
WHEN OLD.team_id IS NOT NEW.team_id OR OLD.project_id IS NOT NEW.project_id OR OLD.user_id IS NOT NEW.user_id
BEGIN SELECT RAISE(ABORT,'Ledger grant identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS ledger_check_grant_initial BEFORE INSERT ON team_ledger_check_grants WHEN NEW.revision<>1
BEGIN SELECT RAISE(ABORT,'LEDGER_CHECK_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS ledger_check_grant_monotonic BEFORE UPDATE ON team_ledger_check_grants
WHEN OLD.revision>=9007199254740991 OR NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'LEDGER_CHECK_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS ledger_check_events_no_update BEFORE UPDATE ON team_ledger_check_events
BEGIN SELECT RAISE(ABORT,'Ledger access audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS ledger_check_events_no_delete BEFORE DELETE ON team_ledger_check_events
BEGIN SELECT RAISE(ABORT,'Ledger access audit must be retained'); END;
CREATE TRIGGER IF NOT EXISTS ledger_check_head_no_delete BEFORE DELETE ON team_ledger_check_heads
BEGIN SELECT RAISE(ABORT,'Ledger history must be retained'); END;
CREATE TRIGGER IF NOT EXISTS ledger_check_head_identity BEFORE UPDATE OF team_id,project_id ON team_ledger_check_heads
WHEN OLD.team_id IS NOT NEW.team_id OR OLD.project_id IS NOT NEW.project_id
BEGIN SELECT RAISE(ABORT,'Ledger head identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS ledger_check_head_initial BEFORE INSERT ON team_ledger_check_heads WHEN NEW.revision<>1
BEGIN SELECT RAISE(ABORT,'LEDGER_CHECK_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS ledger_check_head_monotonic BEFORE UPDATE ON team_ledger_check_heads
WHEN OLD.revision>=9007199254740991 OR NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'LEDGER_CHECK_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS ledger_check_snapshot_initial BEFORE INSERT ON team_ledger_check_snapshots
WHEN NEW.version<>(SELECT revision FROM team_ledger_check_heads WHERE team_id=NEW.team_id AND project_id=NEW.project_id)
 OR NEW.version<>(SELECT COALESCE(MAX(version),0)+1 FROM team_ledger_check_snapshots WHERE team_id=NEW.team_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'LEDGER_CHECK_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS ledger_check_snapshot_no_update BEFORE UPDATE ON team_ledger_check_snapshots
BEGIN SELECT RAISE(ABORT,'Saved ledger snapshot is immutable'); END;
CREATE TRIGGER IF NOT EXISTS ledger_check_snapshot_no_delete BEFORE DELETE ON team_ledger_check_snapshots
BEGIN SELECT RAISE(ABORT,'Saved ledger history must be retained'); END;
