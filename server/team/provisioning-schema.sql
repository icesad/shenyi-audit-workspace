-- Additive M2 manual-review experiment; no public privilege bootstrap.
CREATE TABLE IF NOT EXISTS team_platform_reviewers (
  user_id TEXT PRIMARY KEY REFERENCES team_users(user_id),
  permission TEXT NOT NULL CHECK(permission='team.provision'),
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1)
);
CREATE TABLE IF NOT EXISTS team_profiles (
  team_id TEXT PRIMARY KEY REFERENCES teams(team_id),
  name TEXT NOT NULL
);
-- Technical administration deliberately does not reference audit membership.
CREATE TABLE IF NOT EXISTS team_operators (
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  user_id TEXT NOT NULL UNIQUE REFERENCES team_users(user_id),
  role TEXT NOT NULL CHECK(role='administrator'),
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  PRIMARY KEY(team_id,user_id)
);
CREATE TABLE IF NOT EXISTS team_provisioning_requests (
  request_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL UNIQUE,
  team_name TEXT NOT NULL,
  admin_phone TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','revoked','activated')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  created_by TEXT NOT NULL REFERENCES team_platform_reviewers(user_id),
  created_at INTEGER NOT NULL,
  approved_by TEXT REFERENCES team_platform_reviewers(user_id),
  approved_at INTEGER,
  reviewer_revision INTEGER,
  credential_revision INTEGER,
  credential_fingerprint TEXT,
  token_hash TEXT UNIQUE CHECK(token_hash IS NULL OR length(token_hash)=64),
  expires_at INTEGER,
  activated_at INTEGER,
  activated_by TEXT REFERENCES team_users(user_id)
);
CREATE TABLE IF NOT EXISTS team_first_administrator_challenges (
  challenge_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES team_provisioning_requests(request_id),
  invitation_hash TEXT NOT NULL CHECK(length(invitation_hash)=64),
  purpose TEXT NOT NULL CHECK(purpose='first-admin'),
  phone TEXT NOT NULL,
  code_mac TEXT NOT NULL CHECK(length(code_mac)=64),
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  consumed_at INTEGER,
  delivery_state TEXT NOT NULL CHECK(delivery_state IN ('sending','sent','failed'))
);
CREATE TABLE IF NOT EXISTS team_provisioning_events (
  event_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES team_provisioning_requests(request_id),
  actor_id TEXT NOT NULL REFERENCES team_users(user_id),
  action TEXT NOT NULL CHECK(action IN ('create','approve','reject','revoke','activate')),
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS team_operator_employee_invitations (
  invitation_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  phone TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('intern','assistant')),
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  accepted_at INTEGER,
  accepted_by TEXT REFERENCES team_users(user_id),
  FOREIGN KEY(team_id,invited_by) REFERENCES team_operators(team_id,user_id)
);
CREATE TABLE IF NOT EXISTS team_operator_employee_activation_challenges (
  challenge_id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES team_operator_employee_invitations(invitation_id),
  invitation_hash TEXT NOT NULL CHECK(length(invitation_hash)=64),
  purpose TEXT NOT NULL CHECK(purpose='activate'),
  phone TEXT NOT NULL,
  code_mac TEXT NOT NULL CHECK(length(code_mac)=64),
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  consumed_at INTEGER,
  delivery_state TEXT NOT NULL CHECK(delivery_state IN ('sending','sent','failed'))
);
