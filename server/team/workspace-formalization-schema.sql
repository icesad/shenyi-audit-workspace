-- Immutable owner-attested saved local source. Not professional sign-off or realtime quote verification.
CREATE TABLE IF NOT EXISTS team_workspace_formalizations (
 request_id TEXT PRIMARY KEY NOT NULL,
 team_id TEXT NOT NULL,project_id TEXT NOT NULL UNIQUE,source_project_id TEXT NOT NULL UNIQUE,
 source_title TEXT NOT NULL,source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
 source_json TEXT NOT NULL CHECK(length(CAST(source_json AS BLOB)) BETWEEN 1 AND 131072),
 business_number TEXT NOT NULL,number_year INTEGER NOT NULL CHECK(number_year BETWEEN 1900 AND 9999),
 number_sequence INTEGER NOT NULL CHECK(number_sequence BETWEEN 1 AND 9999),
 first_won_at TEXT NOT NULL,initiation_won_at TEXT NOT NULL,latest_won_at TEXT NOT NULL,
 confirmed_by TEXT NOT NULL,confirmed_at INTEGER NOT NULL CHECK(typeof(confirmed_at)='integer' AND confirmed_at BETWEEN 0 AND 9007199254740991),
 project_revision_before INTEGER NOT NULL CHECK(typeof(project_revision_before)='integer' AND project_revision_before BETWEEN 1 AND 9007199254740990),
 project_revision_after INTEGER NOT NULL CHECK(typeof(project_revision_after)='integer' AND project_revision_after=project_revision_before+1 AND project_revision_after<=9007199254740991),
 request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
 confirmation_mode TEXT NOT NULL CHECK(confirmation_mode='owner-attested-local-source'),
 UNIQUE(team_id,number_year,number_sequence),
 FOREIGN KEY(project_id) REFERENCES team_collection_workspace_creations(project_id),
 FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id),
 FOREIGN KEY(team_id,confirmed_by) REFERENCES team_memberships(team_id,user_id)
);
CREATE TRIGGER IF NOT EXISTS workspace_formalization_no_update BEFORE UPDATE ON team_workspace_formalizations
BEGIN SELECT RAISE(ABORT,'Workspace formalization is immutable'); END;
CREATE TRIGGER IF NOT EXISTS workspace_formalization_no_delete BEFORE DELETE ON team_workspace_formalizations
BEGIN SELECT RAISE(ABORT,'Workspace formalization must be retained'); END;
CREATE TRIGGER IF NOT EXISTS workspace_formalization_consistency BEFORE INSERT ON team_workspace_formalizations
WHEN NOT EXISTS(SELECT 1 FROM team_project_access_projects metadata JOIN team_projects project ON project.team_id=metadata.team_id AND project.project_id=metadata.project_id
 JOIN team_collection_workspace_creations creation ON creation.team_id=metadata.team_id AND creation.project_id=metadata.project_id
 WHERE metadata.team_id=NEW.team_id AND metadata.project_id=NEW.project_id AND metadata.created_by=NEW.confirmed_by AND creation.created_by=NEW.confirmed_by
 AND project.status='active' AND metadata.revision=NEW.project_revision_after AND NEW.project_revision_before>=creation.created_project_revision
 AND EXISTS(SELECT 1 FROM team_project_access_grants owner WHERE owner.team_id=NEW.team_id AND owner.project_id=NEW.project_id AND owner.user_id=NEW.confirmed_by AND owner.permission='project.owner' AND owner.status='active'))
 OR EXISTS(SELECT 1 FROM team_project_migration_provenance WHERE request_id=NEW.request_id OR project_id=NEW.source_project_id OR project_id=NEW.project_id OR (team_id=NEW.team_id AND number_year=NEW.number_year AND number_sequence=NEW.number_sequence))
 OR EXISTS(SELECT 1 FROM team_collection_workspace_creations WHERE request_id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM team_project_access_projects WHERE request_id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM team_projects WHERE project_id=NEW.source_project_id AND (team_id<>NEW.team_id OR project_id<>NEW.project_id))
BEGIN SELECT RAISE(ABORT,'WORKSPACE_FORMALIZATION_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workspace_formalization_migration_guard BEFORE INSERT ON team_project_migration_provenance
WHEN EXISTS(SELECT 1 FROM team_workspace_formalizations WHERE request_id=NEW.request_id OR source_project_id=NEW.project_id OR (team_id=NEW.team_id AND number_year=NEW.number_year AND number_sequence=NEW.number_sequence))
BEGIN SELECT RAISE(ABORT,'WORKSPACE_FORMALIZATION_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workspace_formalization_creation_guard BEFORE INSERT ON team_collection_workspace_creations
WHEN EXISTS(SELECT 1 FROM team_workspace_formalizations WHERE request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'WORKSPACE_FORMALIZATION_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workspace_formalization_project_insert BEFORE INSERT ON team_projects
WHEN EXISTS(SELECT 1 FROM team_workspace_formalizations WHERE source_project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'WORKSPACE_FORMALIZATION_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workspace_formalization_project_update BEFORE UPDATE OF team_id,project_id ON team_projects
WHEN (OLD.team_id IS NOT NEW.team_id OR OLD.project_id IS NOT NEW.project_id) AND EXISTS(SELECT 1 FROM team_workspace_formalizations WHERE source_project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'WORKSPACE_FORMALIZATION_CONFLICT'); END;
