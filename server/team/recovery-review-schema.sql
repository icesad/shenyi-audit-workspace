-- Isolated reviewed recovery; no public/bootstrap grant route.
CREATE TABLE IF NOT EXISTS team_recovery_reviewers (
  user_id TEXT PRIMARY KEY REFERENCES team_users(user_id),
  permission TEXT NOT NULL CHECK(permission='account.recover'),
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1)
);
CREATE TABLE IF NOT EXISTS team_recovery_identity_epochs (
  user_id TEXT PRIMARY KEY REFERENCES team_users(user_id),
  version INTEGER NOT NULL CHECK(version>=1)
);
CREATE TABLE IF NOT EXISTS team_recovery_requests (
  request_id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL UNIQUE REFERENCES team_phone_challenges(challenge_id),
  target_user_id TEXT REFERENCES team_users(user_id),
  team_id TEXT REFERENCES teams(team_id),
  target_kind TEXT CHECK(target_kind IN ('employee','administrator')),
  target_stamp TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','revoked','consumed')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_by TEXT REFERENCES team_users(user_id),
  approval_stamp TEXT,
  token_hash TEXT UNIQUE CHECK(token_hash IS NULL OR length(token_hash)=64),
  consumed_at INTEGER,
  CHECK((target_user_id IS NULL AND team_id IS NULL AND target_kind IS NULL AND target_stamp IS NULL)
    OR (target_user_id IS NOT NULL AND team_id IS NOT NULL AND target_kind IS NOT NULL AND target_stamp IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS team_recovery_events (
  event_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES team_recovery_requests(request_id),
  actor_id TEXT NOT NULL REFERENCES team_users(user_id),
  action TEXT NOT NULL CHECK(action IN ('approve','reject','revoke','consume')),
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
