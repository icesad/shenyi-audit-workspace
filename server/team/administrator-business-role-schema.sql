-- Independent product-owner approval. No existing administrator is enrolled.
CREATE TABLE IF NOT EXISTS team_administrator_business_role_reviewers (
  user_id TEXT PRIMARY KEY REFERENCES team_users(user_id),
  permission TEXT NOT NULL CHECK(permission='administrator.business-role'),
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1 AND revision<=9007199254740991)
);
CREATE TABLE IF NOT EXISTS team_administrator_business_roles (
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  user_id TEXT NOT NULL UNIQUE REFERENCES team_users(user_id),
  role TEXT CHECK(role IS NULL OR role IN ('intern','assistant','manager','partner')),
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1 AND revision<=9007199254740991),
  member_role TEXT NOT NULL CHECK(member_role IN ('intern','assistant','manager','partner')),
  reviewed_by TEXT NOT NULL REFERENCES team_users(user_id),
  reviewed_at INTEGER NOT NULL CHECK(reviewed_at>=0 AND reviewed_at<=9007199254740991),
  PRIMARY KEY(team_id,user_id),
  CHECK(role IS NULL OR role=member_role)
);
CREATE TABLE IF NOT EXISTS team_administrator_business_role_events (
  event_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  actor_id TEXT NOT NULL REFERENCES team_users(user_id),
  target_user_id TEXT NOT NULL REFERENCES team_users(user_id),
  before_role TEXT CHECK(before_role IS NULL OR before_role IN ('intern','assistant','manager','partner')),
  after_role TEXT CHECK(after_role IS NULL OR after_role IN ('intern','assistant','manager','partner')),
  before_revision INTEGER NOT NULL CHECK(before_revision>=0 AND before_revision<=9007199254740991),
  after_revision INTEGER NOT NULL CHECK(after_revision>before_revision AND after_revision<=9007199254740991),
  created_at INTEGER NOT NULL CHECK(created_at>=0 AND created_at<=9007199254740991),
  CHECK(actor_id<>target_user_id)
);
CREATE INDEX IF NOT EXISTS administrator_business_role_events_target
  ON team_administrator_business_role_events(team_id,target_user_id,created_at,event_id);

CREATE TRIGGER IF NOT EXISTS administrator_business_reviewer_epoch_insert AFTER INSERT ON team_administrator_business_role_reviewers BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_reviewer_epoch_update AFTER UPDATE ON team_administrator_business_role_reviewers BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_reviewer_epoch_delete AFTER DELETE ON team_administrator_business_role_reviewers BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_approval_epoch_insert AFTER INSERT ON team_administrator_business_roles BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_approval_epoch_update AFTER UPDATE ON team_administrator_business_roles BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (NEW.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_approval_epoch_delete AFTER DELETE ON team_administrator_business_roles BEGIN
  INSERT INTO team_recovery_identity_epochs(user_id,version) VALUES (OLD.user_id,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1;
END;

-- Only real qualification changes invalidate a completed approval. The rows and
-- their revisions survive a revoke/regrant or delete/recreate qualification ABA.
CREATE TRIGGER IF NOT EXISTS administrator_business_member_insert AFTER INSERT ON team_memberships BEGIN
  UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE status='active' AND user_id=NEW.user_id;
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_member_update AFTER UPDATE ON team_memberships
WHEN OLD.team_id IS NOT NEW.team_id OR OLD.user_id IS NOT NEW.user_id OR OLD.role IS NOT NEW.role OR OLD.status IS NOT NEW.status BEGIN
  UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE status='active' AND (user_id=OLD.user_id OR user_id=NEW.user_id);
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_member_delete AFTER DELETE ON team_memberships BEGIN
  UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE status='active' AND user_id=OLD.user_id;
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_operator_insert AFTER INSERT ON team_operators BEGIN
  UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE status='active' AND user_id=NEW.user_id;
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_operator_update AFTER UPDATE ON team_operators
WHEN OLD.team_id IS NOT NEW.team_id OR OLD.user_id IS NOT NEW.user_id OR OLD.role IS NOT NEW.role OR OLD.status IS NOT NEW.status BEGIN
  UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE status='active' AND (user_id=OLD.user_id OR user_id=NEW.user_id);
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_operator_delete AFTER DELETE ON team_operators BEGIN
  UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE status='active' AND user_id=OLD.user_id;
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_account_insert AFTER INSERT ON team_users BEGIN
  UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE status='active' AND user_id=NEW.user_id;
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_account_update AFTER UPDATE ON team_users
WHEN OLD.user_id IS NOT NEW.user_id OR OLD.status IS NOT NEW.status BEGIN
  UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE status='active' AND (user_id=OLD.user_id OR user_id=NEW.user_id);
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_account_delete AFTER DELETE ON team_users BEGIN
  UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE status='active' AND user_id=OLD.user_id;
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_team_insert AFTER INSERT ON teams BEGIN
  UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE status='active' AND team_id=NEW.team_id;
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_team_update AFTER UPDATE ON teams
WHEN OLD.team_id IS NOT NEW.team_id OR OLD.status IS NOT NEW.status BEGIN
  UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE status='active' AND (team_id=OLD.team_id OR team_id=NEW.team_id);
END;
CREATE TRIGGER IF NOT EXISTS administrator_business_team_delete AFTER DELETE ON teams BEGIN
  UPDATE team_administrator_business_roles SET status='revoked',revision=revision+1 WHERE status='active' AND team_id=OLD.team_id;
END;
