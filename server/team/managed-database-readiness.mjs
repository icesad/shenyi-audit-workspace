import {REVIEWER_TABLES} from './reviewer-policy.mjs';

// The suffix makes earlier managed releases reject rehearsals during rollback too.
export const MANAGED_REHEARSAL_MARKER = 'offline-restore-rehearsal-demo';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const essentialColumns = {
  team_database_metadata: 'name, value',
  team_users: 'user_id, status',
  team_credentials: 'user_id, username, password_hash, revision',
  team_phone_credentials: 'user_id, phone, verified_at, revision',
  team_auth_limits: 'bucket, window_start, attempts',
  team_auth_limit_pools: 'prefix, active_count',
  team_auth_limit_pool_buckets: 'prefix, bucket, window_start',
  team_sessions: 'token_hash, user_id, expires_at, revoked_at',
  team_session_metadata: 'session_id, token_hash, created_at',
  team_device_bindings: 'device_id, user_id, public_key, key_fingerprint, revision, status',
  team_device_challenges: 'challenge_id, purpose, server_id, session_binding',
  team_device_leases: 'lease_id, device_id, auth_session_hash, token_hash',
  team_device_request_replays: 'lease_id, nonce_hash',
  team_device_events: 'event_id, device_id, action',
  team_device_usage: 'device_id, user_id, last_used_at',
  team_recovery_identity_epochs: 'user_id, version',
  teams: 'team_id, status',
  team_memberships: 'team_id, user_id, role, status',
  team_operators: 'team_id, user_id, role, status',
  team_administrator_business_roles: 'team_id, user_id, role, status',
  team_invitations: 'token_hash, team_id, expires_at, accepted_at',
  team_employee_invitations: 'invitation_id, team_id, expires_at, revoked_at, accepted_at',
  team_operator_employee_invitations: 'invitation_id, team_id, expires_at, revoked_at, accepted_at',
  team_subscription_heads: 'team_id, revision',
  team_subscription_events: 'team_id, revision, starts_at, ends_at',
  team_seat_capacity_grants: 'team_id, seats, starts_at, ends_at',
  team_projects: 'team_id, project_id, status',
  team_project_grants: 'team_id, project_id, user_id',
  team_collection_tasks: 'team_id, project_id, task_id, status',
  team_task_assignments: 'team_id, task_id, user_id, status',
  team_collection_workspace_creations: 'team_id, project_id, kind',
  team_workspace_formalizations: 'team_id, project_id, business_number',
  team_material_records: 'team_id, project_id, material_revision',
  team_ledger_check_heads: 'team_id, project_id, revision',
  team_workpaper_data_heads: 'team_id, project_id, revision',
};
const reviewedRecoveryColumns = {
  ...Object.fromEntries(REVIEWER_TABLES.map(table => [table, 'user_id'])),
  team_credentials: 'user_id, username, display_name, password_hash, revision',
  team_profiles: 'team_id, name',
  team_administrator_business_roles: 'team_id, user_id, role, status, member_role',
  team_phone_challenges: 'challenge_id, purpose, phone, user_id, session_hash, credential_revision, code_mac, expires_at, attempts, consumed_at, delivery_state',
  team_phone_challenge_bindings: 'challenge_id, phone_revision, verified_at',
  team_recovery_reviewers: 'user_id, permission, status, revision',
  team_recovery_requests: 'request_id, challenge_id, target_user_id, team_id, target_kind, target_stamp, status, revision, created_at, expires_at, approved_by, approval_stamp, token_hash, consumed_at',
  team_recovery_events: 'event_id, request_id, actor_id, action, revision, created_at',
};
const BOUNDED_SOURCE_PREFIXES = Object.freeze([
  'recovery-request:ip:',
  'sms:source:',
  'onboarding:preview:ip:',
  'onboarding:challenges:ip:',
  'onboarding:activate:ip:',
  'first-administrator:preview:ip:',
  'first-administrator:challenges:ip:',
  'first-administrator:activate:ip:',
]);
const wechatColumns = {
  team_wechat_identities: 'app_id, open_id, user_id, created_at',
  team_wechat_transactions: 'transaction_id, state_hash, poll_hash, code_challenge, app_id, redirect_uri, status, expires_at, open_id, user_id, credential_revision',
  team_wechat_codes: 'app_id, code_hash',
};
// An approved recovery must lose authority after a revoke and same-value regrant.
const reviewedRecoveryTriggers = {
  recovery_epoch_account_update: 'team_users',
  recovery_epoch_team_update: 'teams',
  ...Object.fromEntries([
    ...['team_credentials','team_phone_credentials','team_memberships','team_operators','team_platform_reviewers','team_recovery_reviewers']
      .map(table => [table, `recovery_epoch_${table}`]),
    ['team_administrator_business_roles', 'administrator_business_approval_epoch'],
  ].flatMap(([table, prefix]) => ['insert','update','delete'].map(operation => [`${prefix}_${operation}`, table]))),
};

function fail() {
  throw Object.assign(new Error('所选团队库无法用于受管服务。'), {code:'MANAGED_DATABASE_NOT_READY'});
}

export function assertDatabaseIdentity(db, serverId) {
  const metadata = db.prepare(`SELECT name, value FROM main.team_database_metadata
    WHERE name IN ('prototype-version', 'device-server-id', 'demo') OR name GLOB '*-demo'`).all();
  if (metadata.length !== 2 || !metadata.some(row => row.name === 'prototype-version' && row.value === '2') ||
      !metadata.some(row => row.name === 'device-server-id' && row.value === serverId)) {
    fail();
  }
}

/** Check an already provisioned database without initializing or mutating it. */
export function assertManagedDatabaseReady(db, serverId, {reviewedRecovery = false, wechatEnabled = false} = {}) {
  try {
    if (typeof reviewedRecovery !== 'boolean' || typeof wechatEnabled !== 'boolean' || typeof serverId !== 'string' || !uuid.test(serverId) || db.isTransaction ||
        db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) fail();
    assertDatabaseIdentity(db, serverId);
    const tables = new Set(db.prepare("SELECT name FROM main.sqlite_schema WHERE type = 'table'").all().map(row => row.name));
    const requiredColumns = {...essentialColumns, ...(reviewedRecovery ? reviewedRecoveryColumns : {}), ...(wechatEnabled ? wechatColumns : {})};
    for (const [table, columns] of Object.entries(requiredColumns)) {
      if (!tables.has(table)) fail();
      db.prepare(`SELECT ${columns} FROM main.${table} LIMIT 0`).get();
    }
    // Bounded source admission is used by recovery, SMS, employee onboarding
    // and first-administrator routes. Managed startup is read-only, so refuse
    // an old or partially migrated database before accepting any traffic.
    const pools=db.prepare('SELECT prefix,active_count FROM main.team_auth_limit_pools ORDER BY prefix').all();
    if(pools.length!==BOUNDED_SOURCE_PREFIXES.length)fail();
    for(let i=0;i<BOUNDED_SOURCE_PREFIXES.length;i++){
      const prefix=BOUNDED_SOURCE_PREFIXES[i],pool=pools[i];
      if(pool.prefix!==prefix||!Number.isSafeInteger(pool.active_count)||pool.active_count<0)fail();
      const members=db.prepare('SELECT COUNT(*) AS count FROM main.team_auth_limit_pool_buckets WHERE prefix=?').get(prefix).count;
      if(members!==pool.active_count)fail();
      const stale=db.prepare(`SELECT COUNT(*) AS count FROM main.team_auth_limit_pool_buckets AS pool
        LEFT JOIN main.team_auth_limits AS limits ON limits.bucket=pool.bucket
        WHERE pool.prefix=? AND (limits.bucket IS NULL OR limits.window_start<>pool.window_start)`).get(prefix).count;
      if(stale!==0)fail();
    }
    if (reviewedRecovery) {
      const triggers = new Map(db.prepare("SELECT name, tbl_name FROM main.sqlite_schema WHERE type = 'trigger'").all().map(row => [row.name,row.tbl_name]));
      for (const [name, table] of Object.entries(reviewedRecoveryTriggers)) {
        if (triggers.get(name) !== table) fail();
      }
    }
  } catch { fail(); }
}
