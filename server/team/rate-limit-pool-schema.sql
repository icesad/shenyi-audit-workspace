-- Bounded metadata for anonymous identity-source admission.
-- Rebuilt at database initialization from the authoritative rate-limit rows.
CREATE TABLE IF NOT EXISTS team_auth_limit_pools (
  prefix TEXT PRIMARY KEY,
  active_count INTEGER NOT NULL CHECK(active_count >= 0)
);
CREATE TABLE IF NOT EXISTS team_auth_limit_pool_buckets (
  prefix TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  PRIMARY KEY(prefix,bucket)
);
CREATE INDEX IF NOT EXISTS team_auth_limit_pool_expiry
  ON team_auth_limit_pool_buckets(prefix,window_start,bucket);

DELETE FROM team_auth_limit_pool_buckets
WHERE prefix IN (
  'recovery-request:ip:',
  'sms:source:',
  'onboarding:preview:ip:',
  'onboarding:challenges:ip:',
  'onboarding:activate:ip:',
  'first-administrator:preview:ip:',
  'first-administrator:challenges:ip:',
  'first-administrator:activate:ip:'
);
WITH bounded_prefixes(prefix) AS (VALUES
  ('recovery-request:ip:'),
  ('sms:source:'),
  ('onboarding:preview:ip:'),
  ('onboarding:challenges:ip:'),
  ('onboarding:activate:ip:'),
  ('first-administrator:preview:ip:'),
  ('first-administrator:challenges:ip:'),
  ('first-administrator:activate:ip:')
)
INSERT INTO team_auth_limit_pool_buckets(prefix,bucket,window_start)
SELECT bounded_prefixes.prefix,limits.bucket,limits.window_start
FROM bounded_prefixes
JOIN team_auth_limits AS limits
  ON limits.bucket >= bounded_prefixes.prefix
 AND limits.bucket < bounded_prefixes.prefix || char(1114111);

WITH bounded_prefixes(prefix) AS (VALUES
  ('recovery-request:ip:'),
  ('sms:source:'),
  ('onboarding:preview:ip:'),
  ('onboarding:challenges:ip:'),
  ('onboarding:activate:ip:'),
  ('first-administrator:preview:ip:'),
  ('first-administrator:challenges:ip:'),
  ('first-administrator:activate:ip:')
)
INSERT INTO team_auth_limit_pools(prefix,active_count)
SELECT bounded_prefixes.prefix,COUNT(pool_buckets.bucket)
FROM bounded_prefixes
LEFT JOIN team_auth_limit_pool_buckets AS pool_buckets
  ON pool_buckets.prefix=bounded_prefixes.prefix
GROUP BY bounded_prefixes.prefix
ON CONFLICT(prefix) DO UPDATE SET active_count=excluded.active_count;
