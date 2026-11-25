-- Additive phone-ownership snapshot for newly issued recovery challenges.
-- Legacy reset challenges without this snapshot must be re-issued.
CREATE TABLE IF NOT EXISTS team_phone_challenge_bindings (
  challenge_id TEXT PRIMARY KEY REFERENCES team_phone_challenges(challenge_id),
  phone_revision INTEGER NOT NULL CHECK(phone_revision>=1),
  verified_at INTEGER NOT NULL CHECK(verified_at>0)
);
