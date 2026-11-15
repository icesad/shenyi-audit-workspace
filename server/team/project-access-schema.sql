-- Managed collection authorization sidecars only. Legacy projects stay untouched.
CREATE TABLE IF NOT EXISTS team_project_access_projects (
 team_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL CHECK(created_at>=0 AND created_at<=9007199254740991),
 request_id TEXT,
 request_sha256 TEXT CHECK(request_sha256 IS NULL OR length(request_sha256)=64),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1 AND revision<=9007199254740991),
 PRIMARY KEY(team_id,project_id),
 FOREIGN KEY(team_id,project_id) REFERENCES team_projects(team_id,project_id),
 FOREIGN KEY(team_id,created_by) REFERENCES team_memberships(team_id,user_id),
 CHECK((request_id IS NULL AND request_sha256 IS NULL) OR (request_id IS NOT NULL AND request_sha256 IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS team_project_access_creation_request
 ON team_project_access_projects(team_id,created_by,request_id) WHERE request_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS team_project_access_grants (
 team_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 permission TEXT NOT NULL CHECK(permission IN ('project.owner','collection.review')),
 status TEXT NOT NULL CHECK(status IN ('active','revoked')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1 AND revision<=9007199254740991),
 PRIMARY KEY(team_id,project_id,user_id,permission),
 FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id),
 FOREIGN KEY(team_id,user_id) REFERENCES team_memberships(team_id,user_id)
);
CREATE TABLE IF NOT EXISTS team_project_access_events (
 event_id TEXT PRIMARY KEY,
 team_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES team_users(user_id),
 target_user_id TEXT REFERENCES team_users(user_id),
 task_id TEXT,
 action TEXT NOT NULL CHECK(action IN ('task.created','access.changed','access.revoked')),
 reason TEXT NOT NULL DEFAULT '',
 before_revision INTEGER NOT NULL CHECK(before_revision>=1 AND before_revision<=9007199254740991),
 after_revision INTEGER NOT NULL CHECK(after_revision>before_revision AND after_revision<=9007199254740991),
 created_at INTEGER NOT NULL CHECK(created_at>=0 AND created_at<=9007199254740991),
 FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id),
 FOREIGN KEY(team_id,task_id) REFERENCES team_collection_tasks(team_id,task_id),
 CHECK((action='task.created' AND task_id IS NOT NULL) OR (action IN ('access.changed','access.revoked') AND task_id IS NULL))
);
CREATE INDEX IF NOT EXISTS team_project_access_events_project ON team_project_access_events(team_id,project_id,created_at,event_id);
CREATE TRIGGER IF NOT EXISTS project_access_metadata_immutable BEFORE UPDATE OF team_id,project_id,created_by,created_at,request_id,request_sha256 ON team_project_access_projects
WHEN OLD.team_id<>NEW.team_id OR OLD.project_id<>NEW.project_id OR OLD.created_by<>NEW.created_by OR OLD.created_at<>NEW.created_at
 OR OLD.request_id IS NOT NEW.request_id OR OLD.request_sha256 IS NOT NEW.request_sha256
BEGIN SELECT RAISE(ABORT,'Immutable project creation identity'); END;
CREATE TRIGGER IF NOT EXISTS project_access_metadata_no_delete BEFORE DELETE ON team_project_access_projects
BEGIN SELECT RAISE(ABORT,'Project creation history must be retained'); END;
CREATE TRIGGER IF NOT EXISTS project_access_owner_insert BEFORE INSERT ON team_project_access_grants
WHEN NEW.permission='project.owner' AND NOT EXISTS (SELECT 1 FROM team_project_access_projects WHERE team_id=NEW.team_id AND project_id=NEW.project_id AND created_by=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'Project owner must match immutable creator'); END;
CREATE TRIGGER IF NOT EXISTS project_access_owner_update BEFORE UPDATE ON team_project_access_grants
WHEN NEW.permission='project.owner' AND NOT EXISTS (SELECT 1 FROM team_project_access_projects WHERE team_id=NEW.team_id AND project_id=NEW.project_id AND created_by=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'Project owner must match immutable creator'); END;
CREATE TRIGGER IF NOT EXISTS project_access_acl_insert AFTER INSERT ON team_project_access_grants BEGIN
 UPDATE team_project_access_projects SET revision=revision+1 WHERE team_id=NEW.team_id AND project_id=NEW.project_id;
END;
CREATE TRIGGER IF NOT EXISTS project_access_acl_update AFTER UPDATE ON team_project_access_grants BEGIN
 UPDATE team_project_access_projects SET revision=revision+1 WHERE (team_id=OLD.team_id AND project_id=OLD.project_id) OR (team_id=NEW.team_id AND project_id=NEW.project_id);
END;
CREATE TRIGGER IF NOT EXISTS project_access_acl_delete AFTER DELETE ON team_project_access_grants BEGIN
 UPDATE team_project_access_projects SET revision=revision+1 WHERE team_id=OLD.team_id AND project_id=OLD.project_id;
END;
CREATE TRIGGER IF NOT EXISTS project_access_legacy_grant_insert AFTER INSERT ON team_project_grants BEGIN
 UPDATE team_project_access_projects SET revision=revision+1 WHERE team_id=NEW.team_id AND project_id=NEW.project_id;
END;
CREATE TRIGGER IF NOT EXISTS project_access_legacy_grant_update AFTER UPDATE ON team_project_grants BEGIN
 UPDATE team_project_access_projects SET revision=revision+1 WHERE (team_id=OLD.team_id AND project_id=OLD.project_id) OR (team_id=NEW.team_id AND project_id=NEW.project_id);
END;
CREATE TRIGGER IF NOT EXISTS project_access_legacy_grant_delete AFTER DELETE ON team_project_grants BEGIN
 UPDATE team_project_access_projects SET revision=revision+1 WHERE team_id=OLD.team_id AND project_id=OLD.project_id;
END;
CREATE TRIGGER IF NOT EXISTS project_access_project_update AFTER UPDATE ON team_projects BEGIN
 UPDATE team_project_access_projects SET revision=revision+1 WHERE (team_id=OLD.team_id AND project_id=OLD.project_id) OR (team_id=NEW.team_id AND project_id=NEW.project_id);
END;
