-- Isolated business-role audit; no automatic role, identity or grant changes.
CREATE TABLE IF NOT EXISTS team_business_role_events (
  event_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  actor_id TEXT NOT NULL REFERENCES team_users(user_id),
  target_user_id TEXT NOT NULL REFERENCES team_users(user_id),
  before_role TEXT NOT NULL CHECK(before_role IN ('intern','assistant','manager','partner')),
  after_role TEXT NOT NULL CHECK(after_role IN ('intern','assistant','manager','partner') AND after_role<>before_role),
  before_revision INTEGER NOT NULL CHECK(before_revision>=0 AND before_revision<=9007199254740991),
  after_revision INTEGER NOT NULL CHECK(after_revision>before_revision AND after_revision<=9007199254740991),
  created_at INTEGER NOT NULL CHECK(created_at>=0 AND created_at<=9007199254740991)
);
CREATE INDEX IF NOT EXISTS team_business_role_events_target
  ON team_business_role_events(team_id,target_user_id,created_at,event_id);
