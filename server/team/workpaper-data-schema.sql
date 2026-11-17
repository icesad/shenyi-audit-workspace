-- Immutable first-import provenance, original bytes and version history.
CREATE TABLE IF NOT EXISTS team_workpaper_data_heads (
 team_id TEXT NOT NULL,project_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 source_project_id TEXT NOT NULL CHECK(length(source_project_id)=36),identity_stamp TEXT NOT NULL CHECK(length(identity_stamp)=64 AND identity_stamp NOT GLOB '*[^0-9a-f]*'),
 source_record_revision INTEGER NOT NULL CHECK(typeof(source_record_revision)='integer' AND source_record_revision BETWEEN 1 AND 9007199254740991),
 source_record_json TEXT NOT NULL CHECK(length(CAST(source_record_json AS BLOB)) BETWEEN 1 AND 33554432),source_record_sha256 TEXT NOT NULL CHECK(length(source_record_sha256)=64 AND source_record_sha256 NOT GLOB '*[^0-9a-f]*'),
 source_manifest_json TEXT NOT NULL CHECK(length(CAST(source_manifest_json AS BLOB)) BETWEEN 1 AND 1048576),source_manifest_sha256 TEXT NOT NULL CHECK(length(source_manifest_sha256)=64 AND source_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
 source_package_sha256 TEXT NOT NULL CHECK(length(source_package_sha256)=64 AND source_package_sha256 NOT GLOB '*[^0-9a-f]*'),
 imported_by TEXT NOT NULL REFERENCES team_users(user_id),imported_at INTEGER NOT NULL CHECK(typeof(imported_at)='integer' AND imported_at BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY(team_id,project_id),FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id)
);
CREATE TABLE IF NOT EXISTS team_workpaper_data_versions (
 team_id TEXT NOT NULL,project_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991),
 operation_id TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK((version=1 AND kind='import') OR (version>1 AND kind='entries')),
 request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),actor_id TEXT NOT NULL REFERENCES team_users(user_id),actor_name TEXT NOT NULL,
 record_revision INTEGER NOT NULL CHECK(typeof(record_revision)='integer' AND record_revision BETWEEN 1 AND 9007199254740991),record_json TEXT NOT NULL CHECK(length(CAST(record_json AS BLOB)) BETWEEN 1 AND 33554432),
 record_sha256 TEXT NOT NULL CHECK(length(record_sha256)=64 AND record_sha256 NOT GLOB '*[^0-9a-f]*'),committed_at INTEGER NOT NULL CHECK(typeof(committed_at)='integer' AND committed_at BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY(team_id,project_id,version),FOREIGN KEY(team_id,project_id) REFERENCES team_workpaper_data_heads(team_id,project_id)
);
CREATE TABLE IF NOT EXISTS team_workpaper_data_originals (
 team_id TEXT NOT NULL,project_id TEXT NOT NULL,sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 byte_length INTEGER NOT NULL CHECK(typeof(byte_length)='integer' AND byte_length BETWEEN 1 AND 25165824),bytes BLOB NOT NULL CHECK(typeof(bytes)='blob' AND length(bytes)=byte_length),
 PRIMARY KEY(team_id,project_id,sha256),FOREIGN KEY(team_id,project_id) REFERENCES team_workpaper_data_heads(team_id,project_id)
);
CREATE TABLE IF NOT EXISTS team_workpaper_data_imports (
 request_id TEXT PRIMARY KEY,team_id TEXT NOT NULL,project_id TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES team_users(user_id),
 session_hash TEXT NOT NULL,lease_id TEXT NOT NULL,actor_stamp TEXT NOT NULL,context_stamp TEXT NOT NULL,
 project_revision INTEGER NOT NULL CHECK(typeof(project_revision)='integer' AND project_revision BETWEEN 1 AND 9007199254740991),grant_revision INTEGER NOT NULL CHECK(typeof(grant_revision)='integer' AND grant_revision BETWEEN 1 AND 9007199254740991),
 source_project_id TEXT NOT NULL,identity_stamp TEXT NOT NULL,package_sha256 TEXT NOT NULL CHECK(length(package_sha256)=64 AND package_sha256 NOT GLOB '*[^0-9a-f]*'),
 byte_length INTEGER NOT NULL CHECK(typeof(byte_length)='integer' AND byte_length BETWEEN 1 AND 555745280),chunk_count INTEGER NOT NULL CHECK(typeof(chunk_count)='integer' AND chunk_count BETWEEN 1 AND 530),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at BETWEEN 0 AND 9007199254740991),expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at>created_at AND expires_at<=9007199254740991),
 status TEXT NOT NULL CHECK(status IN ('active','published','canceled','expired')),
 FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS workpaper_data_one_active_import ON team_workpaper_data_imports(actor_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS team_workpaper_data_chunks (
 request_id TEXT NOT NULL REFERENCES team_workpaper_data_imports(request_id),chunk_index INTEGER NOT NULL CHECK(typeof(chunk_index)='integer' AND chunk_index BETWEEN 0 AND 529),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),bytes BLOB NOT NULL CHECK(typeof(bytes)='blob' AND length(bytes) BETWEEN 1 AND 1048576),PRIMARY KEY(request_id,chunk_index)
);
CREATE TRIGGER IF NOT EXISTS workpaper_data_head_initial BEFORE INSERT ON team_workpaper_data_heads
WHEN NEW.revision<>1 OR EXISTS(SELECT 1 FROM team_workpaper_data_heads WHERE team_id=NEW.team_id AND project_id=NEW.project_id)
BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_head_monotonic BEFORE UPDATE ON team_workpaper_data_heads
WHEN OLD.revision>=9007199254740991 OR NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_version_append BEFORE INSERT ON team_workpaper_data_versions
WHEN NEW.version<>COALESCE((SELECT MAX(version)+1 FROM team_workpaper_data_versions WHERE team_id=NEW.team_id AND project_id=NEW.project_id),1)
 OR NEW.version<>(SELECT revision FROM team_workpaper_data_heads WHERE team_id=NEW.team_id AND project_id=NEW.project_id)
 OR (NEW.version=1 AND (NEW.record_json<>(SELECT source_record_json FROM team_workpaper_data_heads WHERE team_id=NEW.team_id AND project_id=NEW.project_id)
 OR NEW.record_sha256<>(SELECT source_record_sha256 FROM team_workpaper_data_heads WHERE team_id=NEW.team_id AND project_id=NEW.project_id)
 OR NEW.record_revision<>(SELECT source_record_revision FROM team_workpaper_data_heads WHERE team_id=NEW.team_id AND project_id=NEW.project_id)))
 OR (NEW.version>1 AND NEW.record_revision<>(SELECT record_revision+1 FROM team_workpaper_data_versions WHERE team_id=NEW.team_id AND project_id=NEW.project_id AND version=NEW.version-1))
BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_stage_initial BEFORE INSERT ON team_workpaper_data_imports
WHEN NEW.status<>'active' OR EXISTS(SELECT 1 FROM team_workpaper_data_imports WHERE request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_stage_terminal BEFORE UPDATE OF status ON team_workpaper_data_imports
WHEN OLD.status<>'active' OR NEW.status='active'
BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_chunk_insert BEFORE INSERT ON team_workpaper_data_chunks
WHEN COALESCE((SELECT status FROM team_workpaper_data_imports WHERE request_id=NEW.request_id),'')<>'active'
 OR EXISTS(SELECT 1 FROM team_workpaper_data_chunks WHERE request_id=NEW.request_id AND chunk_index=NEW.chunk_index)
 OR NEW.chunk_index>=(SELECT chunk_count FROM team_workpaper_data_imports WHERE request_id=NEW.request_id)
 OR length(NEW.bytes)<>MIN(1048576,(SELECT byte_length FROM team_workpaper_data_imports WHERE request_id=NEW.request_id)-NEW.chunk_index*1048576)
BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_chunks_no_update BEFORE UPDATE ON team_workpaper_data_chunks BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_chunks_active_no_delete BEFORE DELETE ON team_workpaper_data_chunks
WHEN (SELECT status FROM team_workpaper_data_imports WHERE request_id=OLD.request_id)='active' BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_heads_no_delete BEFORE DELETE ON team_workpaper_data_heads BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_versions_no_delete BEFORE DELETE ON team_workpaper_data_versions BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_originals_no_delete BEFORE DELETE ON team_workpaper_data_originals BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_imports_no_delete BEFORE DELETE ON team_workpaper_data_imports BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_versions_no_update BEFORE UPDATE ON team_workpaper_data_versions BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_originals_no_update BEFORE UPDATE ON team_workpaper_data_originals BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_heads_context_immutable BEFORE UPDATE ON team_workpaper_data_heads WHEN OLD.team_id IS NOT NEW.team_id OR OLD.project_id IS NOT NEW.project_id OR OLD.source_project_id IS NOT NEW.source_project_id OR OLD.identity_stamp IS NOT NEW.identity_stamp OR OLD.source_record_revision IS NOT NEW.source_record_revision OR OLD.source_record_json IS NOT NEW.source_record_json OR OLD.source_record_sha256 IS NOT NEW.source_record_sha256 OR OLD.source_manifest_json IS NOT NEW.source_manifest_json OR OLD.source_manifest_sha256 IS NOT NEW.source_manifest_sha256 OR OLD.source_package_sha256 IS NOT NEW.source_package_sha256 OR OLD.imported_by IS NOT NEW.imported_by OR OLD.imported_at IS NOT NEW.imported_at BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_imports_context_immutable BEFORE UPDATE ON team_workpaper_data_imports WHEN OLD.request_id IS NOT NEW.request_id OR OLD.team_id IS NOT NEW.team_id OR OLD.project_id IS NOT NEW.project_id OR OLD.actor_id IS NOT NEW.actor_id OR OLD.session_hash IS NOT NEW.session_hash OR OLD.lease_id IS NOT NEW.lease_id OR OLD.actor_stamp IS NOT NEW.actor_stamp OR OLD.context_stamp IS NOT NEW.context_stamp OR OLD.project_revision IS NOT NEW.project_revision OR OLD.grant_revision IS NOT NEW.grant_revision OR OLD.source_project_id IS NOT NEW.source_project_id OR OLD.identity_stamp IS NOT NEW.identity_stamp OR OLD.package_sha256 IS NOT NEW.package_sha256 OR OLD.byte_length IS NOT NEW.byte_length OR OLD.chunk_count IS NOT NEW.chunk_count OR OLD.created_at IS NOT NEW.created_at OR OLD.expires_at IS NOT NEW.expires_at BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS workpaper_data_original_initial BEFORE INSERT ON team_workpaper_data_originals WHEN EXISTS(SELECT 1 FROM team_workpaper_data_originals WHERE team_id=NEW.team_id AND project_id=NEW.project_id AND sha256=NEW.sha256) BEGIN SELECT RAISE(ABORT,'WORKPAPER_DATA_CONFLICT'); END;
