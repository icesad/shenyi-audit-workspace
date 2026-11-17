-- Independent workpaper permissions; this foundation stores no workpaper data.
CREATE TABLE IF NOT EXISTS team_workpaper_access_grants (
 team_id TEXT NOT NULL,project_id TEXT NOT NULL,user_id TEXT NOT NULL,
 can_read INTEGER NOT NULL CHECK(can_read IN (0,1)),
 can_write INTEGER NOT NULL CHECK(can_write IN (0,1)),can_export INTEGER NOT NULL CHECK(can_export IN (0,1)),eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(team_id,project_id,user_id),
 FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id),
 FOREIGN KEY(team_id,user_id) REFERENCES team_memberships(team_id,user_id)
);
CREATE INDEX IF NOT EXISTS workpaper_access_grant_user ON team_workpaper_access_grants(team_id,user_id,project_id);
CREATE TABLE IF NOT EXISTS team_workpaper_access_events (
 event_id TEXT PRIMARY KEY,team_id TEXT NOT NULL,project_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES team_users(user_id),target_user_id TEXT NOT NULL REFERENCES team_users(user_id),
 action TEXT NOT NULL CHECK(action IN ('access.changed','access.revoked')),
 before_revision INTEGER NOT NULL CHECK(typeof(before_revision)='integer' AND before_revision BETWEEN 0 AND 9007199254740990),
 after_revision INTEGER NOT NULL CHECK(typeof(after_revision)='integer' AND after_revision=before_revision+1 AND after_revision<=9007199254740991),
 write_before INTEGER NOT NULL CHECK(write_before IN (0,1)),write_after INTEGER NOT NULL CHECK(write_after IN (0,1)),
 export_before INTEGER NOT NULL CHECK(export_before IN (0,1)),export_after INTEGER NOT NULL CHECK(export_after IN (0,1)),
 eligible_before INTEGER NOT NULL CHECK(eligible_before IN (0,1)),eligible_after INTEGER NOT NULL CHECK(eligible_after IN (0,1)),
 read_before INTEGER NOT NULL CHECK(read_before IN (0,1)),read_after INTEGER NOT NULL CHECK(read_after IN (0,1)),
 project_revision INTEGER NOT NULL CHECK(typeof(project_revision)='integer' AND project_revision BETWEEN 1 AND 9007199254740991),
 reason TEXT NOT NULL,created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991),
 FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id)
);
CREATE TRIGGER IF NOT EXISTS workpaper_access_grant_no_delete BEFORE DELETE ON team_workpaper_access_grants
BEGIN SELECT RAISE(ABORT,'Workpaper grant history must be retained'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_access_grant_identity BEFORE UPDATE OF team_id,project_id,user_id ON team_workpaper_access_grants
WHEN OLD.team_id IS NOT NEW.team_id OR OLD.project_id IS NOT NEW.project_id OR OLD.user_id IS NOT NEW.user_id
BEGIN SELECT RAISE(ABORT,'Workpaper grant identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_access_grant_initial BEFORE INSERT ON team_workpaper_access_grants WHEN NEW.revision<>1 OR EXISTS(SELECT 1 FROM team_workpaper_access_grants WHERE team_id=NEW.team_id AND project_id=NEW.project_id AND user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'WORKPAPER_ACCESS_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_access_grant_monotonic BEFORE UPDATE ON team_workpaper_access_grants
WHEN OLD.revision>=9007199254740991 OR NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'WORKPAPER_ACCESS_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_access_events_no_update BEFORE UPDATE ON team_workpaper_access_events
BEGIN SELECT RAISE(ABORT,'Workpaper access audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_access_events_no_delete BEFORE DELETE ON team_workpaper_access_events
BEGIN SELECT RAISE(ABORT,'Workpaper access audit must be retained'); END;
