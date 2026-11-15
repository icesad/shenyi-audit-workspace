-- Additive isolated M2 metadata, not a production/customer migration.
-- Management IDs are never bearer credentials. Legacy login time is unknown.
CREATE TABLE IF NOT EXISTS team_session_metadata (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE REFERENCES team_sessions(token_hash) ON DELETE CASCADE,
  created_at INTEGER CHECK(created_at IS NULL OR created_at >= 0)
);
