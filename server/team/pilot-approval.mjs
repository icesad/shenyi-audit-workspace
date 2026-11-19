import {randomUUID} from 'node:crypto';
import {canOperateTeam, platformReviewer} from './administration-policy.mjs';
import {currentDeviceLease, deviceConflict, deviceServerId, UUID} from './device-policy.mjs';
import {ApiError, deny, invalid, transaction} from './http-utils.mjs';
import {appendSubscriptionTermWithinTransaction, readSubscriptionState} from './subscription-store.mjs';
import {readSeatCapacity, recordSeatCapacityGrantWithinTransaction} from './seat-capacity-store.mjs';
import {limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';

const MAX_DATE = 8640000000000000;
const conflict = () => { throw new ApiError(409, 'PILOT_APPROVAL_CONFLICT', '试点权益或团队状态已改变，请刷新审核记录核对。'); };
const unavailable = () => { throw new ApiError(403, 'PILOT_APPROVAL_UNAVAILABLE', '此服务暂未开放试点审批。'); };
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const sourceRef = requestId => 'approved-pilot:' + requestId;

function configured(db, options) {
  if (options.serviceMode !== 'managed-service' || options.identityProviders?.deviceProofRequired !== true ||
      options.subscriptionEnforcement !== 'team-management-v1' || options.seatCapacityEnforcement !== 'invitation-reservations-v1') return false;
  return db.prepare(`SELECT count(*) AS n FROM main.sqlite_schema WHERE type='table'
    AND name IN ('team_pilot_approval_reviewers','team_subscription_pilots')`).get().n === 2;
}

function authority(db, actorId) {
  const opening = platformReviewer(db, actorId);
  if (!opening) return;
  const pilot = db.prepare(`SELECT revision FROM team_pilot_approval_reviewers
    WHERE user_id=? AND permission='team.pilot.approve' AND status='active'`).get(actorId);
  if (!pilot || !integer(pilot.revision, 1)) return;
  return {opening, pilotRevision: pilot.revision};
}

function hasNoPriorEntitlement(db, teamId) {
  return !db.prepare(`SELECT 1 FROM team_subscription_events WHERE team_id=?
    UNION ALL SELECT 1 FROM team_seat_capacity_grants WHERE team_id=? LIMIT 1`).get(teamId, teamId);
}

function eligibleTarget(db, row) {
  return row.status === 'activated' && integer(row.activated_at) &&
    canOperateTeam(db, row.activated_by, row.team_id) && hasNoPriorEntitlement(db, row.team_id);
}

function storedPilot(db, row) {
  const saved = db.prepare('SELECT * FROM team_subscription_pilots WHERE request_id=?').get(row.request_id);
  if (!saved) return;
  const event = db.prepare('SELECT * FROM team_subscription_events WHERE operation_id=?').get(saved.operation_id);
  const grant = db.prepare('SELECT * FROM team_seat_capacity_grants WHERE grant_id=?').get(saved.operation_id);
  if (!event || !grant || row.status !== 'activated' || saved.team_id !== row.team_id ||
      row.revision !== saved.request_revision + 1 || event.revision !== 1 ||
      event.team_id !== row.team_id || grant.team_id !== row.team_id ||
      event.starts_at !== saved.starts_at || grant.starts_at !== saved.starts_at ||
      event.ends_at !== saved.ends_at || grant.ends_at !== saved.ends_at || grant.seats !== saved.seats ||
      event.source_ref !== sourceRef(row.request_id) || grant.source_ref !== event.source_ref ||
      event.recorded_at !== saved.starts_at || grant.recorded_at !== saved.starts_at) conflict();
  return saved;
}

function view(saved) {
  return {startsAt: saved.starts_at, endsAt: saved.ends_at, seats: saved.seats};
}

export function pilotApprovalReader(db, actorId, options) {
  if (options.deviceContext?.userId !== actorId || !configured(db, options) || !authority(db, actorId)) return;
  return row => {
    if (row.status !== 'activated') return;
    const saved = storedPilot(db, row);
    if (saved) return view(saved);
    if (eligibleTarget(db, row)) return null;
  };
}

export function currentTermIsPilot(db, subscription) {
  if (subscription.revision !== 1 || !db.prepare(`SELECT 1 FROM main.sqlite_schema
    WHERE type='table' AND name='team_subscription_pilots'`).get()) return false;
  const row = db.prepare(`SELECT request.* FROM team_subscription_pilots pilot
    JOIN team_provisioning_requests request ON request.request_id=pilot.request_id
    WHERE pilot.team_id=?`).get(subscription.teamId);
  if (!row) return false;
  const saved = storedPilot(db, row);
  if (!saved || saved.starts_at !== subscription.startsAt || saved.ends_at !== subscription.endsAt) conflict();
  return true;
}

function heldReviewer(db, request, options, before) {
  const context = options.deviceContext;
  if (!context) throw new ApiError(403, 'DEVICE_PROOF_REQUIRED', '请在已绑定设备上批准试点。');
  const at = options.now();
  if (!integer(at, 0, MAX_DATE)) conflict();
  const actor = currentDeviceLease(db, request, at);
  if (actor.userId !== context.userId || actor.stamp !== context.stamp ||
      actor.leaseId !== context.leaseId || actor.deviceId !== context.deviceId ||
      actor.bindingRevision !== context.bindingRevision || deviceServerId(db) !== context.serverId ||
      before && (actor.token !== before.actor.token || actor.keyFingerprint !== before.actor.keyFingerprint || at < before.at)) {
    deviceConflict();
  }
  const source = authority(db, actor.userId);
  if (!source) deny();
  if (before && (source.pilotRevision !== before.source.pilotRevision ||
      source.opening.revision !== before.source.opening.revision ||
      source.opening.credential_revision !== before.source.opening.credential_revision ||
      source.opening.password_hash !== before.source.opening.password_hash)) conflict();
  return {actor, source, at};
}

export async function approvePilot(db, request, requestId, body, options) {
  if (!configured(db, options)) unavailable();
  if (!UUID.test(requestId) || !integer(body.revision, 1, Number.MAX_SAFE_INTEGER - 1) ||
      !integer(body.endsAt, 1, MAX_DATE) || !integer(body.seats, 1)) invalid();
  const before = heldReviewer(db, request, options);
  return limitedPasswordWork(db, async () => {
    if (!await verifyPassword(body.currentPassword, before.source.opening.password_hash)) {
      throw new ApiError(403, 'VERIFICATION_FAILED', '当前密码验证未通过，请核对后重试。');
    }
    try {
      return transaction(db, () => {
        const {actor, at} = heldReviewer(db, request, options, before);
        const row = db.prepare('SELECT * FROM team_provisioning_requests WHERE request_id=?').get(requestId);
        if (!row) deny();
        const saved = storedPilot(db, row);
        if (saved) {
          if (saved.approved_by !== actor.userId || saved.request_revision !== body.revision ||
              saved.ends_at !== body.endsAt || saved.seats !== body.seats) conflict();
          return {row, pilot: view(saved)};
        }
        if (row.revision !== body.revision || !eligibleTarget(db, row) ||
            row.activated_at > at || body.endsAt <= at) conflict();
        const term = {teamId: row.team_id, startsAt: at, endsAt: body.endsAt, sourceRef: sourceRef(requestId)};
        if (readSeatCapacity(db, row.team_id, at).usedSeats > body.seats) conflict();
        const operationId = randomUUID();
        appendSubscriptionTermWithinTransaction(db, {...term, operationId, expectedRevision: 0}, {now: () => at});
        recordSeatCapacityGrantWithinTransaction(db, {...term, grantId: operationId, seats: body.seats}, {now: () => at});
        if (db.prepare(`UPDATE team_provisioning_requests SET revision=revision+1
          WHERE request_id=? AND revision=? AND status='activated'`).run(requestId, body.revision).changes !== 1) conflict();
        if (db.prepare(`INSERT INTO team_subscription_pilots
          (request_id,team_id,operation_id,approved_by,request_revision,starts_at,ends_at,seats)
          VALUES (?,?,?,?,?,?,?,?)`).run(requestId, row.team_id, operationId, actor.userId,
          body.revision, at, body.endsAt, body.seats).changes !== 1) conflict();
        const published = heldReviewer(db, request, options, {...before, at});
        if (published.at >= body.endsAt) conflict();
        const finalRow = db.prepare('SELECT * FROM team_provisioning_requests WHERE request_id=?').get(requestId);
        const receipt = storedPilot(db, finalRow);
        const subscription = readSubscriptionState(db, row.team_id, published.at);
        if (!receipt || receipt.operation_id !== operationId || subscription.state !== 'active' || subscription.revision !== 1 ||
            readSeatCapacity(db, row.team_id, published.at).purchasedSeats !== body.seats ||
            !canOperateTeam(db, finalRow.activated_by, finalRow.team_id)) conflict();
        return {row: finalRow, pilot: view(receipt)};
      });
    } catch (error) {
      if (typeof error?.errcode === 'number' && [5, 6, 19].includes(error.errcode & 255)) conflict();
      throw error;
    }
  });
}
