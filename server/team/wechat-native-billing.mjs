import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {administratorTechnicalEligible, administratorTechnicalEligibilitySql} from './administrator-business-role-policy.mjs';
import {ApiError, ID, deny, invalid, transaction} from './http-utils.mjs';
import {readSubscriptionState} from './subscription-store.mjs';
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
const RECEIPT_FIELDS = `p.transaction_id, p.paid_at, p.first_verified_at,
  EXISTS(SELECT 1 FROM ${EVENT} e WHERE e.order_id = o.order_id) AS from_notification,
  EXISTS(SELECT 1 FROM ${QUERY} q WHERE q.order_id = o.order_id) AS from_query`;
const conflict = () => { throw new ApiError(409, 'WECHAT_NATIVE_BILLING_CONFLICT', '微信支付订单或收款记录无法核实，请核对原订单。'); };

function requireForeignKeys(db) {
  if (db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) throw new Error('WeChat billing requires SQLite foreign keys');
}

function schemaEntries(db) {
  return db.prepare(`SELECT type, name, tbl_name, sql FROM main.sqlite_schema
    WHERE tbl_name GLOB 'team_billing_wechat_native_*' ORDER BY name`).all();
}

export function installWechatNativeBillingSchema(db) {
  requireForeignKeys(db);
  const version = db.prepare("SELECT value FROM main.team_database_metadata WHERE name = 'prototype-version'").get();
  if (version?.value !== '2') throw new Error('WeChat billing requires a provisioned team database');
  db.prepare('SELECT team_id FROM main.teams LIMIT 0').get();
  db.prepare('SELECT user_id FROM main.team_users LIMIT 0').get();
  db.prepare('SELECT team_id, revision FROM main.team_subscription_events LIMIT 0').get();
  const schema = readFileSync(new URL('./wechat-native-billing-schema.sql', import.meta.url), 'utf8');
  const expected = new DatabaseSync(':memory:');
  let manifest;
  try {
    expected.exec(schema);
    manifest = JSON.stringify(schemaEntries(expected));
  } finally {
    expected.close();
  }
  transaction(db, () => {
    if (schemaEntries(db).length === 0) db.exec(schema);
    if (JSON.stringify(schemaEntries(db)) !== manifest) throw new Error('Incompatible WeChat billing schema');
  });
}

function write(db, action) {
  if (db.isTransaction) conflict();
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

function paymentValue(row) {
  if (row.transaction_id === null) return null;
  const sources = [];
  if (row.from_notification) sources.push('notification');
  if (row.from_query) sources.push('query');
  return Object.freeze({channel: 'wechat-pay-native-v3', orderId: row.order_id, transactionId: row.transaction_id,
    amountMinor: row.amount_minor, currency: row.currency, paidAt: row.paid_at, firstVerifiedAt: row.first_verified_at,
    status: row.paid_at < row.expires_at ? 'pending_fulfilment' : 'needs_review', sources: Object.freeze(sources)});
}

/** Server-only. Callers authorize the session and quote before passing locked terms. */
export function createWechatNativeBilling({db, apiV3Key, now = Date.now, ...configuration}) {
  requireForeignKeys(db);
  const {appId, merchantId, keys} = configuration;
  const provider = createWechatNativeOrders({...configuration, now});
  const readByProviderOrder = db.prepare(`SELECT * FROM ${ORDER} WHERE merchant_id = ? AND merchant_order_id = ? AND app_id = ?`);
  const verify = createWechatNativeNotificationVerifier({
    appId, merchantId, apiV3Key, keys, now,
    readOrder: target => {
      const row = readByProviderOrder.get(target.merchantId, target.merchantOrderId, target.appId);
      return row ? orderValue(row) : null;
    },
  });
  const readById = db.prepare(`SELECT o.*, ${RECEIPT_FIELDS} FROM ${ORDER} o
    LEFT JOIN ${PAYMENT} p ON p.order_id = o.order_id WHERE o.order_id = ?`);
  const readByAdministrator = db.prepare(`SELECT o.*, ${RECEIPT_FIELDS} FROM ${ORDER} o
    JOIN main.team_operators operator ON operator.team_id = o.team_id AND operator.user_id = ?
    LEFT JOIN ${PAYMENT} p ON p.order_id = o.order_id
    WHERE o.team_id = ? AND o.order_id = ? AND o.merchant_id = ? AND o.app_id = ?
      AND ${administratorTechnicalEligibilitySql()}`);

  function readCurrentTime() {
    const at = now();
    if (!boundedInteger(at, 0, MAX_PAYMENT_TIME)) conflict();
    return at;
  }

  function readOrder({teamId, actorId, orderId}) {
    if (!matches(ID, teamId) || !matches(ID, actorId) || !matches(UUID, orderId)) invalid();
    const row = readByAdministrator.get(actorId, teamId, orderId, merchantId, appId);
    if (!row) deny();
    return {order: orderValue(row), payment: paymentValue(row)};
  }

  function assertActiveSeatTerm(order, at) {
    if (order.product !== SEAT_PRODUCT) return;
    const term = readSubscriptionState(db, order.teamId, at);
    if (term.state !== 'active' || term.revision !== order.termRevision || order.expiresAt > term.endsAt) conflict();
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
    });
  }

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
      const {order, payment} = readOrder(scope);
      if (payment) conflict();
      assertActiveSeatTerm(order, readCurrentTime());
      const code = await provider.createOrder(order);
      const current = readOrder(scope);
      const at = readCurrentTime();
      if (current.payment || at >= order.expiresAt) conflict();
      assertActiveSeatTerm(order, at);
      return code;
    },
    async queryPayment(access) {
      const scope = {...access};
      const {order} = readOrder(scope);
      const result = await provider.queryOrder(order);
      if (result.state === 'SUCCESS') capture(result, 'query');
      const current = readOrder(scope);
      return current.payment ? current : {...current, state: result.state};
    },
    async receiveNotification(input) {
      return capture(await verify(input), 'notification');
    },
  });
}
