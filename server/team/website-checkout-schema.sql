-- This schema is installed only in an explicitly marked synthetic checkout database.
CREATE TABLE IF NOT EXISTS team_website_checkout_handoffs (
  handoff_hash TEXT PRIMARY KEY NOT NULL CHECK(length(handoff_hash)=64),
  origin TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL CHECK(expires_at>0),
  scope_json TEXT NOT NULL CHECK(json_valid(scope_json) AND json_type(scope_json)='object'),
  quote_json TEXT CHECK(json_valid(quote_json) AND json_type(quote_json)='object')
) STRICT;
CREATE INDEX IF NOT EXISTS website_checkout_handoff_expiry
  ON team_website_checkout_handoffs(expires_at);
