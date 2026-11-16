-- Collection-only origin, immutable creation audit and permanent receipt.
CREATE TABLE IF NOT EXISTS team_collection_workspace_creations (
 request_id TEXT PRIMARY KEY NOT NULL,
 team_id TEXT NOT NULL,
 project_id TEXT NOT NULL UNIQUE,
 created_by TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind='collection-workspace'),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 300),
 request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
 can_read INTEGER NOT NULL CHECK(can_read IN (0,1)),
 can_manage INTEGER NOT NULL CHECK(can_manage IN (0,1)),
 can_review INTEGER NOT NULL CHECK(can_review IN (0,1)),
 created_project_revision INTEGER NOT NULL CHECK(typeof(created_project_revision)='integer' AND created_project_revision>=1 AND created_project_revision<=9007199254740991),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0 AND created_at<=9007199254740991),
 CHECK(can_read=1 OR (can_manage=0 AND can_review=0)),
 FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id),
 FOREIGN KEY(team_id,created_by) REFERENCES team_memberships(team_id,user_id)
);
CREATE TRIGGER IF NOT EXISTS workspace_creation_no_update BEFORE UPDATE ON team_collection_workspace_creations
BEGIN SELECT RAISE(ABORT,'Workspace creation is immutable'); END;
CREATE TRIGGER IF NOT EXISTS workspace_creation_no_delete BEFORE DELETE ON team_collection_workspace_creations
BEGIN SELECT RAISE(ABORT,'Workspace creation must be retained'); END;
CREATE TRIGGER IF NOT EXISTS workspace_creation_consistency BEFORE INSERT ON team_collection_workspace_creations
WHEN NOT EXISTS (
 SELECT 1 FROM team_project_access_projects metadata JOIN team_projects project
 ON project.team_id=metadata.team_id AND project.project_id=metadata.project_id
 WHERE metadata.team_id=NEW.team_id AND metadata.project_id=NEW.project_id
 AND metadata.created_by=NEW.created_by AND metadata.created_at=NEW.created_at
 AND metadata.request_id=NEW.request_id AND metadata.request_sha256=NEW.request_sha256
 AND metadata.revision=NEW.created_project_revision AND project.title=NEW.title AND project.status='active'
 AND EXISTS(SELECT 1 FROM team_project_access_grants acl WHERE acl.team_id=NEW.team_id AND acl.project_id=NEW.project_id AND acl.user_id=NEW.created_by AND acl.permission='project.owner' AND acl.status='active')
 AND EXISTS(SELECT 1 FROM team_project_grants grant_row WHERE grant_row.team_id=NEW.team_id AND grant_row.project_id=NEW.project_id AND grant_row.user_id=NEW.created_by AND grant_row.permission='collection.read' AND grant_row.status='active')=NEW.can_read
 AND EXISTS(SELECT 1 FROM team_project_grants grant_row WHERE grant_row.team_id=NEW.team_id AND grant_row.project_id=NEW.project_id AND grant_row.user_id=NEW.created_by AND grant_row.permission='collection.manage' AND grant_row.status='active')=NEW.can_manage
 AND EXISTS(SELECT 1 FROM team_project_access_grants acl WHERE acl.team_id=NEW.team_id AND acl.project_id=NEW.project_id AND acl.user_id=NEW.created_by AND acl.permission='collection.review' AND acl.status='active')=NEW.can_review
)
 OR (SELECT COUNT(*) FROM team_projects WHERE project_id=NEW.project_id)<>1
 OR EXISTS(SELECT 1 FROM team_project_migration_provenance WHERE request_id=NEW.request_id OR project_id=NEW.project_id)
 OR EXISTS(SELECT 1 FROM team_project_access_projects metadata WHERE metadata.request_id=NEW.request_id AND (metadata.team_id<>NEW.team_id OR metadata.project_id<>NEW.project_id))
BEGIN SELECT RAISE(ABORT,'WORKSPACE_CREATION_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workspace_creation_migration_guard BEFORE INSERT ON team_project_migration_provenance
WHEN EXISTS(SELECT 1 FROM team_collection_workspace_creations WHERE request_id=NEW.request_id OR project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'WORKSPACE_CREATION_CONFLICT'); END;
