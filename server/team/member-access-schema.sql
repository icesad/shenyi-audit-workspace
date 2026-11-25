-- Additive isolated M2 authority. No public/bootstrap grant endpoint.
CREATE TABLE IF NOT EXISTS team_access_reviewers (
  user_id TEXT PRIMARY KEY REFERENCES team_users(user_id),
  permission TEXT NOT NULL CHECK(permission='member.disable'),
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1)
);
CREATE TABLE IF NOT EXISTS team_member_access_events (
  event_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  actor_id TEXT NOT NULL REFERENCES team_users(user_id),
  target_user_id TEXT NOT NULL REFERENCES team_users(user_id),
  target_kind TEXT NOT NULL CHECK(target_kind IN ('business','administrator')),
  before_revision INTEGER NOT NULL CHECK(before_revision>=0 AND before_revision<=9007199254740991),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS member_access_epoch_insert AFTER INSERT ON team_access_reviewers BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (NEW.user_id,1)
    ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS member_access_epoch_update AFTER UPDATE ON team_access_reviewers BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (OLD.user_id,1)
    ON CONFLICT(user_id) DO UPDATE SET version=version+1;
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (NEW.user_id,1)
    ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS member_access_epoch_delete AFTER DELETE ON team_access_reviewers BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (OLD.user_id,1)
    ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
