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
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const rows = () => db.prepare(
    'SELECT bucket,window_start,attempts FROM team_auth_limits WHERE substr(bucket,1,length(?))=? ORDER BY bucket'
  ).all(prefix, prefix);
  const before = rows();
  assert.equal(before.length, 10000);
  const fingerprint = digest(JSON.stringify(before));
  return {
    blockedAddress, invalidAddress, validAddress,
    assertUnchanged() {
      const after = rows();
      assert.equal(after.length, 10000, 'the active source pool must remain bounded');
      assert.equal(digest(JSON.stringify(after)), fingerprint,
        'full capacity must not evict or reset any active source');
    },
  };
}
module.exports = {fullSourcePool};

