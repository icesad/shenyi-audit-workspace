import {platformReviewer} from './administration-policy.mjs';
import {onboardingAvailable} from './employee-invitations-api.mjs';
import {hasSupportedPasswordHash} from './passwords.mjs';
import {normalizePhone} from './phone-api.mjs';
import {REVIEWER_TABLES} from './reviewer-policy.mjs';

const invitationColumns = 'invitation_id, token_hash, team_id, phone, role, invited_by, created_at, expires_at, revoked_at, accepted_at, accepted_by';
const challengeColumns = 'challenge_id, invitation_hash, purpose, phone, code_mac, expires_at, attempts, consumed_at, delivery_state';
const requiredColumns = {
  ...Object.fromEntries(REVIEWER_TABLES.map(table => [table, 'user_id'])),
  team_platform_reviewers: 'user_id, permission, status, revision',
  team_profiles: 'team_id, name',
  team_credentials: 'user_id, username, display_name, password_hash, revision',
  team_device_bindings: 'user_id, status',
  team_administrator_business_roles: 'team_id, user_id, role, status, member_role',
  team_provisioning_requests: 'request_id, team_id, team_name, admin_phone, status, revision, created_by, created_at, approved_by, approved_at, reviewer_revision, credential_revision, credential_fingerprint, token_hash, expires_at, activated_at, activated_by',
  team_first_administrator_challenges: challengeColumns + ', request_id',
  team_provisioning_events: 'event_id, request_id, actor_id, action, revision, created_at',
  team_activity: 'event_id, team_id, actor_id, action, task_id, created_at',
  team_employee_invitations: invitationColumns,
  team_operator_employee_invitations: invitationColumns,
  team_employee_activation_challenges: challengeColumns + ', invitation_id',
  team_operator_employee_activation_challenges: challengeColumns + ', invitation_id',
  team_subscription_events: 'operation_id, team_id, revision, starts_at, ends_at, recorded_at, source_ref, request_sha256',
  team_seat_capacity_grants: 'grant_id, team_id, seats, starts_at, ends_at, recorded_at, source_ref, request_sha256',
  team_pilot_approval_reviewers: 'user_id, permission, status, revision',
  team_subscription_pilots: 'request_id, team_id, operation_id, approved_by, request_revision, starts_at, ends_at, seats',
};
const requiredTriggers = {
  pilot_approval_no_replace: 'team_subscription_pilots',
  pilot_approval_no_update: 'team_subscription_pilots',
  pilot_approval_no_delete: 'team_subscription_pilots',
  pilot_reviewer_no_replace: 'team_pilot_approval_reviewers',
  pilot_reviewer_change_epoch: 'team_pilot_approval_reviewers',
  pilot_reviewer_no_delete: 'team_pilot_approval_reviewers',
};
const messages = {
  MANAGED_PILOT_SMS_REQUIRED: '首个试点需要开通首管理员及员工激活的短信配置。',
  MANAGED_PILOT_SCHEMA_NOT_READY: '指定数据库未通过首个试点结构检查。',
  MANAGED_PILOT_REVIEWER_NOT_READY: '指定数据库缺少可用的首个试点审核账号。',
};

function fail(code) {
  throw Object.assign(new Error(messages[code]), {code});
}

function hasFirstPilotSchema(db) {
  const objects = new Map(db.prepare("SELECT name, type, tbl_name FROM main.sqlite_schema WHERE type IN ('table','trigger')")
    .all().map(row => [row.name, row]));
  for (const [table, columns] of Object.entries(requiredColumns)) {
    if (objects.get(table)?.type !== 'table') return false;
    db.prepare(`SELECT ${columns} FROM main.${table} LIMIT 0`).get();
  }
  for (const [name, table] of Object.entries(requiredTriggers)) {
    const trigger = objects.get(name);
    if (trigger?.type !== 'trigger' || trigger.tbl_name !== table) return false;
  }

  // The two-column parent key must match the pilot receipt's foreign key.
  const index = db.prepare("PRAGMA main.index_list('team_provisioning_requests')").all()
    .find(row => row.name === 'pilot_request_team');
  if (index?.unique !== 1 || index.partial !== 0) return false;
  const columns = db.prepare("PRAGMA main.index_xinfo('pilot_request_team')").all().filter(row => row.key === 1);
  return columns.length === 2 && columns[0].name === 'request_id' && columns[1].name === 'team_id' &&
    columns.every(row => row.coll === 'BINARY');
}

function validRevision(revision) {
  return Number.isSafeInteger(revision) && revision >= 1;
}

function hasVerifiedPhone(row, now) {
  if (!validRevision(row.phone_revision) ||
      !Number.isSafeInteger(row.verified_at) || row.verified_at <= 0 || row.verified_at > now) return false;
  try { return normalizePhone(row.phone) === row.phone; } catch { return false; }
}

function hasFirstPilotReviewer(db, now) {
  if (!Number.isSafeInteger(now) || now <= 0) return false;
  // Protected reviewers can enroll their first device, but a history without
  // an active binding requires a replacement that their role cannot request.
  const candidates = db.prepare(`SELECT pilot.user_id, pilot.revision, contact.phone, contact.verified_at,
      contact.revision AS phone_revision FROM main.team_pilot_approval_reviewers AS pilot
    JOIN main.team_phone_credentials AS contact ON contact.user_id=pilot.user_id
    WHERE pilot.permission='team.pilot.approve' AND pilot.status='active'
      AND (NOT EXISTS (SELECT 1 FROM main.team_device_bindings AS history WHERE history.user_id=pilot.user_id)
        OR EXISTS (SELECT 1 FROM main.team_device_bindings AS binding
          WHERE binding.user_id=pilot.user_id AND binding.status='active'))`);
  for (const candidate of candidates.iterate()) {
    if (!validRevision(candidate.revision) || !hasVerifiedPhone(candidate, now)) continue;
    const opening = platformReviewer(db, candidate.user_id);
    if (opening && validRevision(opening.revision) && validRevision(opening.credential_revision) &&
        hasSupportedPasswordHash(opening.password_hash)) return true;
  }
  return false;
}

/** Check local prerequisites for a first pilot without signing in or sending verification codes. */
export function assertManagedFirstPilotReady(db, providers, now = Date.now()) {
  if (!onboardingAvailable(providers ?? {})) fail('MANAGED_PILOT_SMS_REQUIRED');

  let schemaReady, reviewerReady;
  try {
    schemaReady = hasFirstPilotSchema(db);
    reviewerReady = schemaReady && hasFirstPilotReviewer(db, now);
  } catch {
    fail('MANAGED_PILOT_SCHEMA_NOT_READY');
  }
  if (!schemaReady) fail('MANAGED_PILOT_SCHEMA_NOT_READY');
  if (!reviewerReady) fail('MANAGED_PILOT_REVIEWER_NOT_READY');
}
