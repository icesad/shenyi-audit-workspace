import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {administratorTechnicalEligible, administratorTechnicalEligibilitySql} from './administrator-business-role-policy.mjs';
import {ApiError, ID, deny, invalid, transaction} from './http-utils.mjs';
import {annualRenewalWindow} from './renewal-calendar.mjs';
import {readSeatCapacity, recordSeatCapacityGrantWithinTransaction} from './seat-capacity-store.mjs';
import {appendSubscriptionTermWithinTransaction, readSubscriptionState} from './subscription-store.mjs';
import {createWechatNativeNotificationVerifier} from './wechat-native-notification.mjs';
import {createWechatNativeOrders} from './wechat-native-orders.mjs';
import {
  MAX_AMOUNT_MINOR, MIN_PAYMENT_WINDOW_MS, MAX_PAYMENT_WINDOW_MS, MAX_PAYMENT_TIME, SIGNATURE_TOLERANCE_MS,
  boundedInteger, matches, paidOnOrAfterCreation,
} from './wechat-native-protocol.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ANNUAL_PRODUCT = 'team-annual-renewal';
const SEAT_PRODUCT = 'team-seat-addition';
const ORDER = 'main.team_billing_wechat_native_orders';
const PAYMENT = 'main.team_billing_wechat_native_payments';
const EVENT = 'main.team_billing_wechat_native_events';
const QUERY = 'main.team_billing_wechat_native_query_confirmations';
const FULFILMENT = 'main.team_billing_wechat_native_fulfilments';
const REVIEW = 'main.team_billing_wechat_native_review_states';
const RECEIPT_FIELDS = `p.transaction_id, p.paid_at, p.first_verified_at,
  EXISTS(SELECT 1 FROM ${EVENT} e WHERE e.order_id = o.order_id) AS from_notification,
  EXISTS(SELECT 1 FROM ${QUERY} q WHERE q.order_id = o.order_id) AS from_query,
  f.subscription_revision AS granted_revision, f.seats AS granted_seats, f.starts_at AS granted_start,
  f.ends_at AS granted_end, f.fulfilled_at,
  EXISTS(SELECT 1 FROM ${REVIEW} r WHERE r.order_id = o.order_id AND r.state = 'REFUND') AS observed_refund,
  EXISTS(SELECT 1 FROM ${REVIEW} r WHERE r.order_id = o.order_id AND r.state = 'CLOSED') AS observed_closed`;
const RECEIPT_JOINS = `LEFT JOIN ${PAYMENT} p ON p.order_id = o.order_id
  LEFT JOIN ${FULFILMENT} f ON f.order_id = o.order_id AND f.team_id = o.team_id`;
const conflict = () => { throw new ApiError(409, 'WECHAT_NATIVE_BILLING_CONFLICT', '微信支付订单或收款记录无法核实，请核对原订单。'); };
const needsReview = () => { throw new ApiError(409, 'WECHAT_NATIVE_FULFILMENT_REVIEW', '收款已保存，当前条件未能兑现权益。'); };
const insufficientSeats = () => { throw new ApiError(409, 'WECHAT_NATIVE_INSUFFICIENT_SEATS', '购买的席位不足以覆盖已启用成员和邀请预留。'); };
const CALLBACK_LOCK_TIMEOUT_MS = 500;
let schemaDefinition;

function requireForeignKeys(db) {
  if (db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) throw new Error('WeChat billing requires SQLite foreign keys');
}

function schemaEntries(db) {
  return db.prepare(`SELECT type, name, tbl_name, sql FROM main.sqlite_schema
    WHERE tbl_name GLOB 'team_billing_wechat_native_*' ORDER BY name`).all();
}

function assertTeamSchema(db) {
  requireForeignKeys(db);
  const version = db.prepare("SELECT value FROM main.team_database_metadata WHERE name = 'prototype-version'").get();
  if (version?.value !== '2') throw new Error('WeChat billing requires a provisioned team database');
  db.prepare('SELECT team_id FROM main.teams LIMIT 0').get();
  db.prepare('SELECT user_id FROM main.team_users LIMIT 0').get();
  db.prepare('SELECT team_id, revision FROM main.team_subscription_events LIMIT 0').get();
  db.prepare('SELECT grant_id FROM main.team_seat_capacity_grants LIMIT 0').get();
}

function billingSchemaDefinition() {
  if (schemaDefinition) return schemaDefinition;
  const schema = readFileSync(new URL('./wechat-native-billing-schema.sql', import.meta.url), 'utf8');
  const fulfilmentSchema = readFileSync(new URL('./wechat-native-fulfilment-schema.sql', import.meta.url), 'utf8');
  const expected = new DatabaseSync(':memory:');
  let baseManifest, manifest;
  try {
    expected.exec(schema);
    baseManifest = JSON.stringify(schemaEntries(expected));
    expected.exec(fulfilmentSchema);
    manifest = JSON.stringify(schemaEntries(expected));
  } finally {
    expected.close();
  }
  schemaDefinition = {schema, fulfilmentSchema, baseManifest, manifest};
  return schemaDefinition;
}

export function assertWechatNativeBillingReady(db) {
  assertTeamSchema(db);
  if (JSON.stringify(schemaEntries(db)) !== billingSchemaDefinition().manifest) throw new Error('Incompatible WeChat billing schema');
}

export function installWechatNativeBillingSchema(db) {
  assertTeamSchema(db);
  const {schema, fulfilmentSchema, baseManifest, manifest} = billingSchemaDefinition();
  transaction(db, () => {
    const entries = schemaEntries(db);
    if (entries.length === 0) db.exec(schema);
    if (entries.length === 0 || JSON.stringify(entries) === baseManifest) db.exec(fulfilmentSchema);
    if (JSON.stringify(schemaEntries(db)) !== manifest) throw new Error('Incompatible WeChat billing schema');
  });
}

export function withWechatNativeCallbackLockBudget(db, action) {
  // A JavaScript deadline cannot interrupt a synchronous SQLite lock wait.
  // Restore the connection's original policy before returning to other routes.
  const originalTimeout = db.prepare('PRAGMA busy_timeout').get().timeout;
  if (originalTimeout <= CALLBACK_LOCK_TIMEOUT_MS) return action();
  db.exec('PRAGMA busy_timeout = ' + CALLBACK_LOCK_TIMEOUT_MS);
  try { return action(); }
  finally { db.exec('PRAGMA busy_timeout = ' + originalTimeout); }
}

function write(db, action, {providerCallback = false} = {}) {
  requireForeignKeys(db);
  if (db.isTransaction) conflict();
  if (providerCallback) return withWechatNativeCallbackLockBudget(db, () => transaction(db, action));
  try {
    return transaction(db, action);
  } catch (error) {
    if (typeof error?.errcode === 'number' && [5, 6, 19].includes(error.errcode & 255)) conflict();
    throw error;
  }
}

function orderValue(row) {
  return Object.freeze({id: row.order_id, teamId: row.team_id, actorId: row.actor_id, requestId: row.request_id,
    appId: row.app_id, merchantId: row.merchant_id, merchantOrderId: row.merchant_order_id, product: row.product,
    description: row.description, offerId: row.offer_id, offerRevision: row.offer_revision, seats: row.seats,
    termRevision: row.term_revision, amountMinor: row.amount_minor, currency: row.currency,
    createdAt: row.created_at, expiresAt: row.expires_at});
}

function providerReviewStates(row) {
  const states = [];
  if (row.observed_refund) states.push('REFUND');
  if (row.observed_closed) states.push('CLOSED');
  return states.length ? Object.freeze({providerReviewStates: Object.freeze(states)}) : {};
}

function paymentValue(row) {
  if (row.transaction_id === null) return null;
  const sources = [];
  if (row.from_notification) sources.push('notification');
  if (row.from_query) sources.push('query');
  const fulfilment = row.fulfilled_at === null ? null : Object.freeze({subscriptionRevision: row.granted_revision,
    seats: row.granted_seats, startsAt: row.granted_start, endsAt: row.granted_end, fulfilledAt: row.fulfilled_at});
  return Object.freeze({channel: 'wechat-pay-native-v3', orderId: row.order_id, transactionId: row.transaction_id,
    amountMinor: row.amount_minor, currency: row.currency, paidAt: row.paid_at, firstVerifiedAt: row.first_verified_at,
    status: fulfilment ? 'fulfilled' : row.paid_at >= row.expires_at || row.observed_refund || row.observed_closed
      ? 'needs_review' : 'pending_fulfilment',
    sources: Object.freeze(sources), ...(fulfilment ? {fulfilment} : {}), ...providerReviewStates(row)});
}

/** Server-only. Callers authorize the session and quote before passing locked terms. */
export function createWechatNativeBilling(options) {
  return connectWechatNativeBilling(options, false);
}

export function createWechatNativePaymentReceiver({db, appId, merchantId, apiV3Key, keys}) {
  assertWechatNativeBillingReady(db);
  return connectWechatNativeBilling({db, appId, merchantId, apiV3Key, keys}, true).receiveNotification;
}

function connectWechatNativeBilling({db, apiV3Key, now = Date.now, ...configuration}, providerCallback) {
  requireForeignKeys(db);
  const {appId, merchantId, keys} = configuration;
  const readByProviderOrder = db.prepare(`SELECT * FROM ${ORDER} WHERE merchant_id = ? AND merchant_order_id = ? AND app_id = ?`);
  const verify = createWechatNativeNotificationVerifier({
    appId, merchantId, apiV3Key, keys, now,
    readOrder: target => {
      const read = () => readByProviderOrder.get(target.merchantId, target.merchantOrderId, target.appId);
      const row = providerCallback ? withWechatNativeCallbackLockBudget(db, read) : read();
      return row ? orderValue(row) : null;
    },
  });
  const readById = db.prepare(`SELECT o.*, ${RECEIPT_FIELDS} FROM ${ORDER} o
    ${RECEIPT_JOINS} WHERE o.order_id = ?`);
  function readCurrentTime() {
    const at = now();
    if (!boundedInteger(at, 0, MAX_PAYMENT_TIME)) conflict();
    return at;
  }

  function readOrder({teamId, actorId, orderId}) {
    if (!matches(ID, teamId) || !matches(ID, actorId) || !matches(UUID, orderId)) invalid();
    const row = readByAdministrator.get(actorId, teamId, orderId, merchantId, appId);
    if (!row) deny();
    const payment = paymentValue(row);
    return {order: orderValue(row), payment, ...(payment ? {} : providerReviewStates(row))};
  }

  function assertActiveSeatTerm(order, at) {
    if (order.product !== SEAT_PRODUCT) return;
    const term = readSubscriptionState(db, order.teamId, at);
    if (term.state !== 'active' || term.revision !== order.termRevision || order.expiresAt > term.endsAt) conflict();
  }

  function assertOrderCanBePaid({order, payment, providerReviewStates: reviewStates}, at) {
    if (payment || reviewStates || at >= order.expiresAt) conflict();
    if (order.product === ANNUAL_PRODUCT && readSeatCapacity(db, order.teamId, at).usedSeats > order.seats) insufficientSeats();
    assertActiveSeatTerm(order, at);
  }

  function assertAnnualCapacity(teamId, seats, at) {
    if (readSeatCapacity(db, teamId, at).usedSeats > seats) needsReview();
  }

  function annualEntitlement(order, payment, current, at) {
    const queue = db.prepare(`SELECT 1 FROM ${ORDER} o JOIN ${PAYMENT} p ON p.order_id = o.order_id
      LEFT JOIN ${FULFILMENT} f ON f.order_id = o.order_id
      WHERE o.team_id = ? AND o.product = ? AND p.paid_at < o.expires_at
      AND ((f.order_id IS NULL AND (p.first_verified_at, o.order_id) < (?, ?)
          AND NOT EXISTS (SELECT 1 FROM ${REVIEW} r WHERE r.order_id = o.order_id))
        OR (f.order_id IS NOT NULL AND p.first_verified_at > ?)) LIMIT 1`);
    if (queue.get(order.teamId, ANNUAL_PRODUCT, payment.firstVerifiedAt, order.id, payment.firstVerifiedAt)) needsReview();
    const term = current.revision ? {startsAt: current.startsAt, endsAt: current.endsAt} : null;
    const window = annualRenewalWindow(term, payment.firstVerifiedAt);
    assertAnnualCapacity(order.teamId, order.seats, at);
    if (window.endsAt <= at || db.prepare(`SELECT 1 FROM main.team_seat_capacity_grants
      WHERE team_id = ? AND starts_at < ? AND ends_at > ? LIMIT 1`)
      .get(order.teamId, window.endsAt, window.renewalStartsAt)) needsReview();
    if (db.prepare('SELECT 1 FROM main.team_subscription_events WHERE operation_id = ?').get(order.id)) conflict();
    const next = appendSubscriptionTermWithinTransaction(db, {
      teamId: order.teamId, operationId: order.id, expectedRevision: current.revision, startsAt: window.startsAt,
      endsAt: window.endsAt, sourceRef: 'wechat-native-annual:' + order.id,
    }, {now: () => at});
    return {subscriptionRevision: next.revision, startsAt: window.renewalStartsAt, endsAt: window.endsAt};
  }

  function seatEntitlement(order, payment, current, at) {
    const original = db.prepare(`SELECT starts_at, ends_at FROM main.team_subscription_events
      WHERE team_id = ? AND revision = ?`).get(order.teamId, order.termRevision);
    if (!original || current.state !== 'active' || current.revision < order.termRevision ||
        current.startsAt > original.starts_at || current.endsAt < original.ends_at ||
        original.starts_at > order.createdAt || order.expiresAt > original.ends_at ||
        at >= original.ends_at) needsReview();
    return {subscriptionRevision: order.termRevision, startsAt: payment.firstVerifiedAt, endsAt: original.ends_at};
  }

  function capture(verified, source) {
    return write(db, () => {
      const row = readById.get(verified.orderId);
      const at = readCurrentTime();
      if (!row || verified.channel !== 'wechat-pay-native-v3' || row.app_id !== verified.appId ||
          row.merchant_id !== verified.merchantId || row.merchant_order_id !== verified.merchantOrderId ||
          row.amount_minor !== verified.amountMinor || row.currency !== verified.currency || at < row.created_at ||
          !boundedInteger(verified.paidAt, 0, Math.min(at + SIGNATURE_TOLERANCE_MS, MAX_PAYMENT_TIME)) ||
          !paidOnOrAfterCreation(verified.paidAt, row.created_at)) conflict();
      const prior = db.prepare(`SELECT order_id, transaction_id, paid_at FROM ${PAYMENT}
        WHERE order_id = ? OR (merchant_id = ? AND transaction_id = ?)`).all(row.order_id, merchantId, verified.transactionId);
      if (prior.length === 0) {
        db.prepare(`INSERT INTO ${PAYMENT} (order_id, merchant_id, transaction_id, paid_at, first_verified_at)
          VALUES (?, ?, ?, ?, ?)`).run(row.order_id, merchantId, verified.transactionId, verified.paidAt, at);
      } else if (prior.length !== 1 || prior[0].order_id !== row.order_id ||
          prior[0].transaction_id !== verified.transactionId || prior[0].paid_at !== verified.paidAt) {
        conflict();
      }

      if (source === 'notification') {
        const existing = db.prepare(`SELECT order_id FROM ${EVENT} WHERE merchant_id = ? AND event_id = ?`).get(merchantId, verified.eventId);
        if (existing && existing.order_id !== row.order_id) conflict();
        if (!existing) db.prepare(`INSERT INTO ${EVENT} (merchant_id, event_id, order_id, verified_at)
          VALUES (?, ?, ?, ?)`).run(merchantId, verified.eventId, row.order_id, at);
      } else if (!row.from_query) {
        db.prepare(`INSERT INTO ${QUERY} (order_id, verified_at) VALUES (?, ?)`).run(row.order_id, at);
      }
      return paymentValue(readById.get(row.order_id));
    }, {providerCallback});
  }

  function recordProviderReview(orderId, state) {
    write(db, () => {
      const recorded = db.prepare(`SELECT 1 FROM ${REVIEW} WHERE order_id = ? AND state = ?`).get(orderId, state);
      if (!recorded) db.prepare(`INSERT INTO ${REVIEW} (order_id, state, observed_at) VALUES (?, ?, ?)`)
        .run(orderId, state, readCurrentTime());
    });
  }

  const receiveNotification = async input => capture(await verify(input), 'notification');
  if (providerCallback) return {receiveNotification};

  const provider = createWechatNativeOrders({...configuration, now});
  const readByAdministrator = db.prepare(`SELECT o.*, ${RECEIPT_FIELDS} FROM ${ORDER} o
    JOIN main.team_operators operator ON operator.team_id = o.team_id AND operator.user_id = ?
    ${RECEIPT_JOINS}
    WHERE o.team_id = ? AND o.order_id = ? AND o.merchant_id = ? AND o.app_id = ?
      AND ${administratorTechnicalEligibilitySql()}`);
  return Object.freeze({
    lockOrder(input) {
      const {teamId, actorId, requestId, product, offerId, offerRevision, seats, termRevision, amountMinor, expiresAt} = input;
      if (!matches(ID, teamId) || !matches(ID, actorId) || !matches(UUID, requestId) || !matches(ID, offerId) ||
          !boundedInteger(offerRevision, 1, Number.MAX_SAFE_INTEGER) || !boundedInteger(amountMinor, 1, MAX_AMOUNT_MINOR) ||
          !boundedInteger(expiresAt, 0, MAX_PAYMENT_TIME) || expiresAt % 1000 !== 0 ||
          !boundedInteger(seats, product === SEAT_PRODUCT ? 1 : 0, 1000) ||
          !(product === ANNUAL_PRODUCT ? termRevision === null :
            product === SEAT_PRODUCT && boundedInteger(termRevision, 1, Number.MAX_SAFE_INTEGER))) invalid();
      return write(db, () => {
        if (!administratorTechnicalEligible(db, actorId, teamId)) deny();
        const existing = db.prepare(`SELECT * FROM ${ORDER} WHERE team_id = ? AND request_id = ?`).get(teamId, requestId);
        if (existing) {
          const locked = orderValue(existing);
          if (locked.actorId !== actorId || locked.appId !== appId || locked.merchantId !== merchantId ||
              locked.product !== product || locked.offerId !== offerId || locked.offerRevision !== offerRevision ||
              locked.seats !== seats || locked.termRevision !== termRevision || locked.amountMinor !== amountMinor ||
              locked.expiresAt !== expiresAt) conflict();
          return locked;
        }
        const at = readCurrentTime();
        if (!boundedInteger(expiresAt, at + MIN_PAYMENT_WINDOW_MS, at + MAX_PAYMENT_WINDOW_MS)) invalid();
        assertActiveSeatTerm({product, teamId, termRevision, expiresAt}, at);
        if (product === ANNUAL_PRODUCT && readSeatCapacity(db, teamId, at).usedSeats > seats) insufficientSeats();
        const id = randomUUID();
        const description = product === ANNUAL_PRODUCT ? '审易团队年订阅' : '审易团队席位增购';
        return orderValue(db.prepare(`INSERT INTO ${ORDER}
          (order_id, team_id, actor_id, request_id, app_id, merchant_id, product, description, offer_id, offer_revision,
            seats, term_revision, amount_minor, currency, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CNY', ?, ?) RETURNING *`)
          .get(id, teamId, actorId, requestId, appId, merchantId, product, description, offerId, offerRevision,
            seats, termRevision, amountMinor, at, expiresAt));
      });
    },
    readOrder,
    async createPaymentCode(access) {
      const scope = {...access};
      const locked = readOrder(scope);
      assertOrderCanBePaid(locked, readCurrentTime());
      const code = await provider.createOrder(locked.order);
      assertOrderCanBePaid(readOrder(scope), readCurrentTime());
      return code;
    },
    async queryPayment(access) {
      const scope = {...access};
      const {order} = readOrder(scope);
      const result = await provider.queryOrder(order);
      if (result.state === 'SUCCESS') capture(result, 'query');
      if (result.state === 'REFUND' || result.state === 'CLOSED') recordProviderReview(order.id, result.state);
      const current = readOrder(scope);
      return current.payment ? current : {...current, state: result.state};
    },
    receiveNotification,
    fulfilPayment(access) {
      const scope = {...access};
      return write(db, () => {
        const result = readOrder(scope);
        const {order, payment} = result;
        if (!payment) conflict();
        if (payment.fulfilment) return result;
        const at = readCurrentTime();
        if (payment.status !== 'pending_fulfilment' || at < Math.max(payment.firstVerifiedAt, payment.paidAt) ||
            payment.sources.length === 0) needsReview();
        if (db.prepare('SELECT 1 FROM main.team_seat_capacity_grants WHERE grant_id = ?').get(order.id)) conflict();
        const current = readSubscriptionState(db, order.teamId, at);
        const annual = order.product === ANNUAL_PRODUCT;
        const {subscriptionRevision, startsAt, endsAt} = annual
          ? annualEntitlement(order, payment, current, at) : seatEntitlement(order, payment, current, at);
        if (order.seats > 0) recordSeatCapacityGrantWithinTransaction(db, {
          grantId: order.id, teamId: order.teamId, seats: order.seats, startsAt, endsAt,
          sourceRef: (annual ? 'wechat-native-annual-seats:' : 'wechat-native-seat:') + order.id,
        }, {now: () => at});
        const inserted = db.prepare(`INSERT INTO ${FULFILMENT}
          (order_id, team_id, subscription_revision, seats, starts_at, ends_at, fulfilled_at, grant_id) VALUES (?,?,?,?,?,?,?,?)`)
          .run(order.id, order.teamId, subscriptionRevision, order.seats, startsAt, endsAt, at, order.seats ? order.id : null);
        if (inserted.changes !== 1) conflict();
        readSeatCapacity(db, order.teamId, startsAt);
        const finalTime = readCurrentTime();
        if (finalTime < at || finalTime >= endsAt) needsReview();
        if (annual) assertAnnualCapacity(order.teamId, order.seats, finalTime);
        else readSeatCapacity(db, order.teamId, finalTime);
        const saved = readOrder(scope);
        if (saved.payment?.fulfilment?.fulfilledAt !== at) conflict();
        return saved;
      });
    },
  });
}
