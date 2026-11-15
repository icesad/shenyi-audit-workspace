-- Isolated M3A proof-of-possession foundation; no hardware-attestation claim.
CREATE TABLE IF NOT EXISTS team_device_bindings (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES team_users(user_id),
  public_key TEXT NOT NULL CHECK(length(public_key)=59),
  key_fingerprint TEXT NOT NULL CHECK(length(key_fingerprint)=64),
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('win32','darwin')),
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  revision INTEGER NOT NULL CHECK(revision>=1 AND revision<=9007199254740991),
  bound_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS team_device_one_active_binding ON team_device_bindings(user_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS team_device_challenges (
  challenge_id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK(purpose IN ('enroll','prove','revoke')),
  server_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES team_users(user_id),
  session_binding TEXT NOT NULL CHECK(length(session_binding)=64),
  public_key TEXT NOT NULL CHECK(length(public_key)=59),
  key_fingerprint TEXT NOT NULL CHECK(length(key_fingerprint)=64),
  identity_epoch INTEGER NOT NULL CHECK(identity_epoch>=0 AND identity_epoch<=9007199254740991),
  binding_revision INTEGER NOT NULL CHECK(binding_revision>=0 AND binding_revision<=9007199254740991),
  device_id TEXT REFERENCES team_device_bindings(device_id),
  approval_request_id TEXT NOT NULL DEFAULT '' CHECK(approval_request_id=''),
  nonce TEXT NOT NULL CHECK(length(nonce)=43),
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('win32','darwin')),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at=issued_at+120000),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  consumed_at INTEGER,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS team_device_leases (
  lease_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES team_users(user_id),
  device_id TEXT NOT NULL REFERENCES team_device_bindings(device_id),
  binding_revision INTEGER NOT NULL CHECK(binding_revision>=1 AND binding_revision<=9007199254740991),
  auth_session_hash TEXT NOT NULL UNIQUE REFERENCES team_sessions(token_hash),
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS team_device_one_live_lease ON team_device_leases(user_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS team_device_request_replays (
  lease_id TEXT NOT NULL REFERENCES team_device_leases(lease_id),
  nonce_hash TEXT NOT NULL CHECK(length(nonce_hash)=64),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(lease_id,nonce_hash)
);
CREATE TABLE IF NOT EXISTS team_device_events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES team_users(user_id),
  device_id TEXT NOT NULL REFERENCES team_device_bindings(device_id),
  action TEXT NOT NULL CHECK(action IN ('bound','proved','revoked')),
  revision INTEGER NOT NULL CHECK(revision>=1 AND revision<=9007199254740991),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS device_session_revokes_lease AFTER UPDATE OF revoked_at ON team_sessions
WHEN NEW.revoked_at IS NOT NULL BEGIN
  UPDATE team_device_leases SET revoked_at=COALESCE(revoked_at,NEW.revoked_at) WHERE auth_session_hash=OLD.token_hash;
END;
CREATE TRIGGER IF NOT EXISTS device_lease_context_immutable
BEFORE UPDATE OF auth_session_hash,user_id,device_id,binding_revision ON team_device_leases
WHEN OLD.auth_session_hash<>NEW.auth_session_hash OR OLD.user_id<>NEW.user_id
  OR OLD.device_id<>NEW.device_id OR OLD.binding_revision<>NEW.binding_revision
BEGIN SELECT RAISE(ABORT,'Immutable device lease context'); END;
