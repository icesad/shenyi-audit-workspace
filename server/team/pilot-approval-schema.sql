-- A reviewed pilot is a non-payment origin for the team's first term and seat grant.
CREATE TABLE IF NOT EXISTS team_pilot_approval_reviewers (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES team_platform_reviewers(user_id),
  permission TEXT NOT NULL CHECK(permission='team.pilot.approve'),
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS pilot_request_team
  ON team_provisioning_requests(request_id,team_id);

CREATE TABLE IF NOT EXISTS team_subscription_pilots (
  request_id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT UNIQUE NOT NULL REFERENCES teams(team_id),
  operation_id TEXT UNIQUE NOT NULL REFERENCES team_subscription_events(operation_id)
    REFERENCES team_seat_capacity_grants(grant_id),
  approved_by TEXT NOT NULL REFERENCES team_pilot_approval_reviewers(user_id),
  request_revision INTEGER NOT NULL CHECK(request_revision BETWEEN 1 AND 9007199254740990),
  starts_at INTEGER NOT NULL CHECK(starts_at BETWEEN 0 AND 8640000000000000),
  ends_at INTEGER NOT NULL CHECK(ends_at BETWEEN 0 AND 8640000000000000 AND ends_at>starts_at),
  seats INTEGER NOT NULL CHECK(seats BETWEEN 1 AND 9007199254740991),
  FOREIGN KEY(request_id,team_id) REFERENCES team_provisioning_requests(request_id,team_id)
) STRICT;

CREATE TRIGGER IF NOT EXISTS pilot_approval_no_replace BEFORE INSERT ON team_subscription_pilots
WHEN EXISTS (SELECT 1 FROM team_subscription_pilots WHERE request_id=NEW.request_id
  OR team_id=NEW.team_id OR operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'PILOT_APPROVAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS pilot_approval_no_update BEFORE UPDATE ON team_subscription_pilots
BEGIN SELECT RAISE(ABORT,'PILOT_APPROVAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS pilot_approval_no_delete BEFORE DELETE ON team_subscription_pilots
BEGIN SELECT RAISE(ABORT,'PILOT_APPROVAL_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS pilot_reviewer_no_replace BEFORE INSERT ON team_pilot_approval_reviewers
WHEN EXISTS (SELECT 1 FROM team_pilot_approval_reviewers WHERE user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'PILOT_REVIEWER_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS pilot_reviewer_change_epoch BEFORE UPDATE ON team_pilot_approval_reviewers
WHEN OLD.user_id<>NEW.user_id OR OLD.permission<>NEW.permission OR NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'PILOT_REVIEWER_REVISION'); END;
CREATE TRIGGER IF NOT EXISTS pilot_reviewer_no_delete BEFORE DELETE ON team_pilot_approval_reviewers
BEGIN SELECT RAISE(ABORT,'PILOT_REVIEWER_IMMUTABLE'); END;
