-- Additive isolated identity contract. No production supplier credentials here.
CREATE TABLE IF NOT EXISTS team_phone_credentials (
  user_id TEXT PRIMARY KEY REFERENCES team_users(user_id),
  phone TEXT NOT NULL UNIQUE,
  verified_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS team_phone_challenges (
  challenge_id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK(purpose IN ('bind','reset')),
  phone TEXT NOT NULL,
  user_id TEXT REFERENCES team_users(user_id),
  session_hash TEXT,
  credential_revision INTEGER,
  code_mac TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  delivery_state TEXT NOT NULL CHECK(delivery_state IN ('sending','sent','failed'))
);
CREATE TABLE IF NOT EXISTS team_wechat_identities (
  app_id TEXT NOT NULL,
  open_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES team_users(user_id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(app_id,open_id),
  UNIQUE(app_id,user_id)
);
CREATE TABLE IF NOT EXISTS team_wechat_transactions (
  transaction_id TEXT PRIMARY KEY,
  state_hash TEXT NOT NULL UNIQUE,
  poll_hash TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  app_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','processing','binding_required','ready','consumed','canceled','failed')),
  expires_at INTEGER NOT NULL,
  open_id TEXT,
  user_id TEXT REFERENCES team_users(user_id),
  credential_revision INTEGER
);
CREATE TABLE IF NOT EXISTS team_wechat_codes (
  app_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  PRIMARY KEY(app_id,code_hash)
);
