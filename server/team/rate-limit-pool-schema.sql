-- Bounded metadata for anonymous recovery-source admission.
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

DELETE FROM team_auth_limit_pool_buckets WHERE prefix='recovery-request:ip:';
INSERT INTO team_auth_limit_pool_buckets(prefix,bucket,window_start)
SELECT 'recovery-request:ip:',bucket,window_start
FROM team_auth_limits
WHERE bucket >= 'recovery-request:ip:'
  AND bucket < 'recovery-request:ip:' || char(1114111);

INSERT INTO team_auth_limit_pools(prefix,active_count)
SELECT 'recovery-request:ip:',COUNT(*)
FROM team_auth_limit_pool_buckets
WHERE prefix='recovery-request:ip:'
ON CONFLICT(prefix) DO UPDATE SET active_count=excluded.active_count;
