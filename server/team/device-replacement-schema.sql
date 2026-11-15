-- Independent replacement approvals. Existing enrollment proofs stay closed.
CREATE TABLE IF NOT EXISTS team_device_replacement_reviewers (
  user_id TEXT PRIMARY KEY REFERENCES team_users(user_id),
  permission TEXT NOT NULL CHECK(permission='device.replace'),
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1 AND revision<=9007199254740991)
);
CREATE TABLE IF NOT EXISTS team_device_replacement_requests (
  request_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES team_users(user_id),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  target_kind TEXT NOT NULL CHECK(target_kind IN ('employee','administrator')),
  team_name TEXT NOT NULL,
  target_display_name TEXT NOT NULL,
  target_stamp TEXT NOT NULL CHECK(length(target_stamp)=64),
  identity_epoch INTEGER NOT NULL CHECK(identity_epoch>=0 AND identity_epoch<=9007199254740991),
  old_device_id TEXT NOT NULL REFERENCES team_device_bindings(device_id),
  old_binding_revision INTEGER NOT NULL CHECK(old_binding_revision>=1 AND old_binding_revision<=9007199254740991),
  old_binding_status TEXT NOT NULL CHECK(old_binding_status IN ('active','revoked')),
  old_binding_stamp TEXT NOT NULL CHECK(length(old_binding_stamp)=64),
  old_snapshot TEXT NOT NULL,
  public_key TEXT NOT NULL CHECK(length(public_key)=59),
  key_fingerprint TEXT NOT NULL CHECK(length(key_fingerprint)=64),
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('win32','darwin')),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','claimed','rejected','withdrawn','revoked','expired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1 AND revision<=9007199254740991),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_by TEXT REFERENCES team_users(user_id),
  approval_stamp TEXT CHECK(approval_stamp IS NULL OR length(approval_stamp)=64),
  claimed_device_id TEXT REFERENCES team_device_bindings(device_id),
  claimed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS team_device_replacement_one_open
  ON team_device_replacement_requests(user_id) WHERE status IN ('pending','approved');
CREATE TABLE IF NOT EXISTS team_device_replacement_challenges (
  challenge_id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK(purpose IN ('request','withdraw','activate')),
  server_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES team_users(user_id),
  session_binding TEXT NOT NULL CHECK(length(session_binding)=64),
  public_key TEXT NOT NULL CHECK(length(public_key)=59),
  key_fingerprint TEXT NOT NULL CHECK(length(key_fingerprint)=64),
  identity_epoch INTEGER NOT NULL CHECK(identity_epoch>=0 AND identity_epoch<=9007199254740991),
  old_device_id TEXT NOT NULL REFERENCES team_device_bindings(device_id),
  old_binding_revision INTEGER NOT NULL CHECK(old_binding_revision>=1 AND old_binding_revision<=9007199254740991),
  old_binding_status TEXT NOT NULL CHECK(old_binding_status IN ('active','revoked')),
  request_id TEXT NOT NULL,
  request_revision INTEGER NOT NULL CHECK(request_revision>=0 AND request_revision<=9007199254740991),
  nonce TEXT NOT NULL CHECK(length(nonce)=43),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at=issued_at+120000),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  target_kind TEXT NOT NULL CHECK(target_kind IN ('employee','administrator')),
  team_name TEXT NOT NULL,
  target_display_name TEXT NOT NULL,
  target_stamp TEXT NOT NULL CHECK(length(target_stamp)=64),
  old_binding_stamp TEXT NOT NULL CHECK(length(old_binding_stamp)=64),
  old_snapshot TEXT NOT NULL,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('win32','darwin')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  consumed_at INTEGER,
  revoked_at INTEGER,
  CHECK((purpose='request' AND request_revision=0) OR (purpose<>'request' AND request_revision>=1))
);
CREATE TABLE IF NOT EXISTS team_device_replacement_events (
  event_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES team_device_replacement_requests(request_id),
  actor_id TEXT NOT NULL REFERENCES team_users(user_id),
  action TEXT NOT NULL CHECK(action IN ('request','approve','reject','revoke','withdraw','claim','expire','stale')),
  revision INTEGER NOT NULL CHECK(revision>=1 AND revision<=9007199254740991),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS device_replacement_reviewer_epoch_insert AFTER INSERT ON team_device_replacement_reviewers BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS device_replacement_reviewer_epoch_update AFTER UPDATE ON team_device_replacement_reviewers BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS device_replacement_reviewer_epoch_delete AFTER DELETE ON team_device_replacement_reviewers BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS device_replacement_binding_epoch_insert AFTER INSERT ON team_device_bindings BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS device_replacement_binding_epoch_update AFTER UPDATE ON team_device_bindings BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS device_replacement_binding_epoch_delete AFTER DELETE ON team_device_bindings BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
