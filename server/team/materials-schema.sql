CREATE TABLE IF NOT EXISTS team_material_grants (
 team_id TEXT NOT NULL,project_id TEXT NOT NULL,user_id TEXT NOT NULL,
 can_read INTEGER NOT NULL CHECK(can_read IN (0,1)),can_import INTEGER NOT NULL CHECK(can_import IN (0,1)),can_review INTEGER NOT NULL CHECK(can_review IN (0,1)),can_close INTEGER NOT NULL CHECK(can_close IN (0,1)),
 eligible INTEGER NOT NULL DEFAULT 1 CHECK(eligible IN (0,1)),revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(team_id,project_id,user_id),FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id),FOREIGN KEY(team_id,user_id) REFERENCES team_memberships(team_id,user_id),
 CHECK(can_read=1 OR (can_import=0 AND can_review=0 AND can_close=0))
);
CREATE TABLE IF NOT EXISTS team_material_records (
 team_id TEXT NOT NULL,project_id TEXT NOT NULL,material_revision INTEGER NOT NULL CHECK(material_revision BETWEEN 1 AND 9007199254740991),
 record_json TEXT NOT NULL,record_sha256 TEXT NOT NULL CHECK(length(record_sha256)=64),source_record_json TEXT NOT NULL,source_record_sha256 TEXT NOT NULL CHECK(length(source_record_sha256)=64),source_record_revision INTEGER NOT NULL,
 package_sha256 TEXT NOT NULL CHECK(length(package_sha256)=64),imported_at INTEGER NOT NULL,imported_by TEXT NOT NULL REFERENCES team_users(user_id),
 PRIMARY KEY(team_id,project_id),FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id)
);
CREATE TABLE IF NOT EXISTS team_material_files (
 team_id TEXT NOT NULL,project_id TEXT NOT NULL,file_id TEXT NOT NULL,generation_id TEXT NOT NULL,node_id TEXT NOT NULL,metadata_json TEXT NOT NULL,filename TEXT NOT NULL,mime TEXT NOT NULL,byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 12582912),sha256 TEXT NOT NULL CHECK(length(sha256)=64),bytes BLOB NOT NULL,
 PRIMARY KEY(team_id,project_id,file_id),FOREIGN KEY(team_id,project_id) REFERENCES team_material_records(team_id,project_id)
);
CREATE TABLE IF NOT EXISTS team_material_events (
 event_id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,team_id TEXT NOT NULL,project_id TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES team_users(user_id),target_user_id TEXT REFERENCES team_users(user_id),
 kind TEXT NOT NULL CHECK(kind IN ('access.changed','access.revoked','import','item','close','reopen')),project_revision INTEGER NOT NULL,before_revision INTEGER NOT NULL,after_revision INTEGER NOT NULL,
 material_revision INTEGER,record_sha256 TEXT,package_sha256 TEXT,source_record_revision INTEGER,record_revision INTEGER,source_before_revision INTEGER,details_json TEXT NOT NULL DEFAULT '{}',committed_at INTEGER NOT NULL,
 FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id)
);
CREATE TABLE IF NOT EXISTS team_material_imports (
 request_id TEXT PRIMARY KEY,team_id TEXT NOT NULL,project_id TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES team_users(user_id),session_hash TEXT NOT NULL,lease_id TEXT NOT NULL,actor_stamp TEXT NOT NULL,project_revision INTEGER NOT NULL,
 package_sha256 TEXT NOT NULL CHECK(length(package_sha256)=64),byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 188743680),chunk_count INTEGER NOT NULL CHECK(chunk_count BETWEEN 1 AND 180),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','published','canceled','expired')),
 FOREIGN KEY(team_id,project_id) REFERENCES team_project_access_projects(team_id,project_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS material_one_active_import ON team_material_imports(actor_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS team_material_import_chunks (
 request_id TEXT NOT NULL REFERENCES team_material_imports(request_id) ON DELETE CASCADE,chunk_index INTEGER NOT NULL,sha256 TEXT NOT NULL CHECK(length(sha256)=64),bytes BLOB NOT NULL,PRIMARY KEY(request_id,chunk_index)
);
CREATE TRIGGER IF NOT EXISTS material_original_record_immutable BEFORE UPDATE OF source_record_json,source_record_sha256,source_record_revision,package_sha256,imported_at,imported_by,team_id,project_id ON team_material_records
BEGIN SELECT RAISE(ABORT,'Material source is immutable'); END;
CREATE TRIGGER IF NOT EXISTS material_files_no_update BEFORE UPDATE ON team_material_files BEGIN SELECT RAISE(ABORT,'Material original is immutable'); END;
CREATE TRIGGER IF NOT EXISTS material_record_no_delete BEFORE DELETE ON team_material_records BEGIN SELECT RAISE(ABORT,'Material source must be retained'); END;
CREATE TRIGGER IF NOT EXISTS material_files_no_delete BEFORE DELETE ON team_material_files BEGIN SELECT RAISE(ABORT,'Material original must be retained'); END;
CREATE TRIGGER IF NOT EXISTS material_events_no_update BEFORE UPDATE ON team_material_events BEGIN SELECT RAISE(ABORT,'Material audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS material_events_no_delete BEFORE DELETE ON team_material_events BEGIN SELECT RAISE(ABORT,'Material audit must be retained'); END;
CREATE TRIGGER IF NOT EXISTS material_grant_insert BEFORE INSERT ON team_material_grants BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM team_project_access_projects WHERE team_id=NEW.team_id AND project_id=NEW.project_id AND revision>=9007199254740991) THEN RAISE(ABORT,'MATERIAL_REVISION_MAX') END;
END;
CREATE TRIGGER IF NOT EXISTS material_grant_insert_revision AFTER INSERT ON team_material_grants BEGIN UPDATE team_project_access_projects SET revision=revision+1 WHERE team_id=NEW.team_id AND project_id=NEW.project_id; END;
CREATE TRIGGER IF NOT EXISTS material_grant_update BEFORE UPDATE ON team_material_grants BEGIN
 SELECT CASE WHEN OLD.revision>=9007199254740991 OR EXISTS(SELECT 1 FROM team_project_access_projects WHERE team_id=OLD.team_id AND project_id=OLD.project_id AND revision>=9007199254740991) THEN RAISE(ABORT,'MATERIAL_REVISION_MAX') END;
END;
CREATE TRIGGER IF NOT EXISTS material_grant_update_revision AFTER UPDATE ON team_material_grants BEGIN UPDATE team_project_access_projects SET revision=revision+1 WHERE team_id=OLD.team_id AND project_id=OLD.project_id; END;
CREATE TRIGGER IF NOT EXISTS material_grant_no_delete BEFORE DELETE ON team_material_grants BEGIN SELECT RAISE(ABORT,'Material grants retain revocation history'); END;
CREATE TRIGGER IF NOT EXISTS material_grant_identity_immutable BEFORE UPDATE OF team_id,project_id,user_id ON team_material_grants BEGIN SELECT RAISE(ABORT,'Material grant identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS material_stage_no_delete BEFORE DELETE ON team_material_imports BEGIN SELECT RAISE(ABORT,'Material request identity must be retained'); END;
CREATE TRIGGER IF NOT EXISTS material_stage_context_immutable BEFORE UPDATE OF request_id,team_id,project_id,actor_id,session_hash,lease_id,actor_stamp,project_revision,package_sha256,byte_length,chunk_count,created_at,expires_at ON team_material_imports
BEGIN SELECT RAISE(ABORT,'Material staging context is immutable'); END;
CREATE TRIGGER IF NOT EXISTS material_stage_terminal BEFORE UPDATE OF status ON team_material_imports
WHEN OLD.status<>'active' OR NEW.status='active' BEGIN SELECT RAISE(ABORT,'Material staging is terminal'); END;
