'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');

const grants = {
  team_platform_reviewers: 'team.provision',
  team_recovery_reviewers: 'account.recover',
  team_access_reviewers: 'member.disable',
  team_device_replacement_reviewers: 'device.replace',
  team_administrator_business_role_reviewers: 'administrator.business-role',
  team_project_migration_reviewers: 'project.migrate',
  team_billing_refund_intake_reviewers: 'billing.refund-intake',
  team_pilot_approval_reviewers: 'team.pilot.approve',
};

async function fixture() {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-managed-owner-'));
  const outputDirectory = path.join(directory, 'initialized');
  const owner = { displayName: '合成负责人', phone: '13800001234', password: randomBytes(24).toString('base64url'), verifiedOutOfBand: true };
  return { directory, outputDirectory, owner, args: ['--output-dir', outputDirectory] };
}

function pipe(value) {
  return Readable.from([Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')]);
}

async function checksum(filename) {
  return createHash('sha256').update(await fs.readFile(filename)).digest('hex');
}

test('bootstrap creates one phone account with confirmed review scope and no business role', async () => {
  const { runManagedOwnerBootstrap } = await import('../scripts/bootstrap-managed-team.mjs');
  const { assertManagedDatabaseReady } = await import('../server/team/managed-service.mjs');
  const { verifyPassword } = await import('../server/team/passwords.mjs');
  const { args, owner, outputDirectory } = await fixture();
  const result = await runManagedOwnerBootstrap(args, pipe(owner));
  assert.deepEqual(Object.keys(result).sort(), ['databasePath', 'ok', 'ownerUserId', 'reviewPermissions', 'serverId']);
  assert.deepEqual(result.reviewPermissions, Object.values(grants));
  assert.equal(result.databasePath, path.join(outputDirectory, 'team.sqlite'));
  const output = JSON.stringify(result);
  for (const value of [owner.password, owner.phone, owner.displayName]) assert.equal(output.includes(value), false);
  assert.deepEqual(await fs.readdir(outputDirectory), ['team.sqlite']);
  const db = new DatabaseSync(result.databasePath, { readOnly: true });
  try {
    assertManagedDatabaseReady(db, result.serverId);
    const account = db.prepare('SELECT user_id,status FROM team_users').get();
    assert.equal(account.user_id, result.ownerUserId);
    assert.equal(account.status, 'active');
    const credential = db.prepare('SELECT user_id, username, password_hash FROM team_credentials').get();
    assert.equal(credential.user_id, account.user_id);
    assert.equal(credential.username.includes(owner.phone), false);
    assert.notEqual(credential.password_hash, owner.password);
    assert.equal(await verifyPassword(owner.password, credential.password_hash), true);
    const phone = db.prepare('SELECT user_id,phone,verified_at FROM team_phone_credentials').get();
    assert.equal(phone.user_id, account.user_id);
    assert.equal(phone.phone, '+86' + owner.phone);
    assert.ok(Number.isSafeInteger(phone.verified_at) && phone.verified_at > 0);
    for (const [table, permission] of Object.entries(grants)) {
      const rows = db.prepare(`SELECT user_id,permission,status FROM ${table}`).all();
      assert.equal(rows.length, 1, table);
      assert.deepEqual({ ...rows[0] }, { user_id: account.user_id, permission, status: 'active' });
    }
    for (const table of ['teams', 'team_memberships', 'team_operators', 'team_sessions', 'team_device_bindings', 'team_phone_challenges', 'team_provisioning_requests']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total, 0, table);
    }
    assert.equal(db.prepare("SELECT value FROM team_database_metadata WHERE name='managed-owner-bootstrap'").get()?.value, 'manual-phone-verification-v1');
  } finally {
    db.close();
  }
  const original = await checksum(result.databasePath);
  await assert.rejects(runManagedOwnerBootstrap(args, pipe(owner)), { code: 'BOOTSTRAP_TARGET_INVALID' });
  assert.equal(await checksum(result.databasePath), original);
});

test('invalid or ambiguous stdin is rejected before the output directory exists', async () => {
  const { runManagedOwnerBootstrap } = await import('../scripts/bootstrap-managed-team.mjs');
  const { args, owner, outputDirectory } = await fixture();
  const malformed = JSON.stringify(owner).replace('"verifiedOutOfBand":true', '"verifiedOutOfBand":false,"verifiedOutOf\\u0042and":true');
  for (const value of [malformed, { ...owner, verifiedOutOfBand: false }, { ...owner, scopes: ['team.provision'] }, { ...owner, phone: 'not-a-phone' }, { ...owner, password: 'short' }, ' '.repeat(8193)]) {
    await assert.rejects(runManagedOwnerBootstrap(args, pipe(value)), { code: 'BOOTSTRAP_INPUT_INVALID' });
    await assert.rejects(fs.lstat(outputDirectory), { code: 'ENOENT' });
  }
});
