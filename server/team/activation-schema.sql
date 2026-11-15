-- Additive M2 experiment only. Never run on customer/platform databases.
CREATE TABLE IF NOT EXISTS team_employee_invitations (
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
  FOREIGN KEY(team_id,invited_by) REFERENCES team_memberships(team_id,user_id)
);
CREATE TABLE IF NOT EXISTS team_employee_activation_challenges (
  challenge_id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES team_employee_invitations(invitation_id),
  invitation_hash TEXT NOT NULL CHECK(length(invitation_hash)=64),
  purpose TEXT NOT NULL CHECK(purpose='activate'),
  phone TEXT NOT NULL,
  code_mac TEXT NOT NULL CHECK(length(code_mac)=64),
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  consumed_at INTEGER,
  delivery_state TEXT NOT NULL CHECK(delivery_state IN ('sending','sent','failed'))
);
