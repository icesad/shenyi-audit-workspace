'use strict';
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');

// Populate reachable limiter state directly: 10,000 distinct, syntactically
// valid source addresses, with one source already at its 60-request limit.
// This keeps the regression about admission at capacity, rather than issuing
// 60,000 HTTP requests just to arrange the same SQLite state.
function fullSourcePool(db, prefix, now) {
  const blockedAddress = '203.0.113.240';
  const invalidAddress = '203.0.113.241';
  const validAddress = '203.0.113.242';
  const insert = db.prepare('INSERT INTO team_auth_limits(bucket,window_start,attempts) VALUES (?,?,?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    insert.run(prefix + digest(blockedAddress), now, 60);
    for (let i = 0; i < 9999; i++) {
      const address = '198.18.' + Math.floor(i / 256) + '.' + (i % 256);
      insert.run(prefix + digest(address), now, 1);
    }
    const poolRows=db.prepare(`SELECT bucket,window_start FROM team_auth_limits
      WHERE bucket>=? AND bucket<? ORDER BY bucket`).all(prefix,prefix+'\uFFFF');
    const insertMembership=db.prepare('INSERT INTO team_auth_limit_pool_buckets(prefix,bucket,window_start) VALUES (?,?,?)');
    for(const row of poolRows)insertMembership.run(prefix,row.bucket,row.window_start);
    db.prepare(`INSERT INTO team_auth_limit_pools(prefix,active_count) VALUES (?,?)
      ON CONFLICT(prefix) DO UPDATE SET active_count=excluded.active_count`).run(prefix,poolRows.length);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const rows = () => db.prepare(
    'SELECT bucket,window_start,attempts FROM team_auth_limits WHERE bucket>=? AND bucket<? ORDER BY bucket'
  ).all(prefix, prefix+String.fromCharCode(0xFFFF));
  const before = rows();
  assert.equal(before.length, 10000);
  const fingerprint = digest(JSON.stringify(before));
  const poolCount=()=>db.prepare('SELECT active_count FROM team_auth_limit_pools WHERE prefix=?').get(prefix)?.active_count;
  const memberCount=()=>db.prepare('SELECT COUNT(*) AS n FROM team_auth_limit_pool_buckets WHERE prefix=?').get(prefix).n;
  assert.equal(poolCount(),10000);
  assert.equal(memberCount(),10000);
  return {
    blockedAddress, invalidAddress, validAddress,
    assertUnchanged() {
      const after = rows();
      assert.equal(after.length, 10000, 'the active source pool must remain bounded');
      assert.equal(digest(JSON.stringify(after)), fingerprint,
        'full capacity must not evict or reset any active source');
      assert.equal(poolCount(),10000,'the indexed counter must remain consistent');
      assert.equal(memberCount(),10000,'pool membership must remain consistent');
    },
  };
}
module.exports = {fullSourcePool};

