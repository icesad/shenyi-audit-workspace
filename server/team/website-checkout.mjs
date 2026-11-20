import {createHmac, randomBytes, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {administratorTechnicalEligible} from './administrator-business-role-policy.mjs';
import {currentDeviceLease, deviceConflict, deviceServerId, digest} from './device-policy.mjs';
import {ApiError, ID, deny, invalid, json, readJson, transaction} from './http-utils.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {createAnnualOrderWithinTransaction, readAnnualOrder, readAnnualOrderRequest, readAnnualSeatRenewalDefaults} from './billing-store.mjs';
import {createSeatOrderWithinTransaction, readSeatOrder, readSeatOrderQuote, readSeatOrderRequest} from './seat-order-store.mjs';
import {readSubscriptionState} from './subscription-store.mjs';

const WEB_CONTEXT = '/api/website-checkout/context';
const WEB_ORDERS = '/api/website-checkout/orders';
const SEAT_CONTEXT = '/api/website-checkout/seat-context';
const SEAT_QUOTE = '/api/website-checkout/seat-quote';
const SEAT_ORDERS = '/api/website-checkout/seat-orders';
const ISSUER = /^\/api\/teams\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/billing\/website(-seat)?-handoff$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TTL_MS = 120_000;
const SEAT_QUOTE_TTL_MS = 60_000;
const MAX_OUTSTANDING = 256;
const SEAT_PRODUCT = 'team-seat-addition';
const ORDER_STATES = new Set(['pending','payment-verified','paid','closed']);
const seatRoutes = new Map([
  [SEAT_CONTEXT,['handoff']],
  [SEAT_QUOTE,['handoff','offerId','offerRevision','quantity']],
  [SEAT_ORDERS,['handoff','quoteId']],
]);
const candidates = new WeakSet();
const conflict = () => { throw new ApiError(409, 'WEBSITE_CHECKOUT_CONFLICT', '方案或订单状态已变化，请重新核对。'); };
const unavailable = () => { throw new ApiError(503, 'WEBSITE_CHECKOUT_UNAVAILABLE', '官网合成下单暂不可用。'); };
const expired = () => { throw new ApiError(403, 'WEBSITE_HANDOFF_UNAVAILABLE', '订单页授权已失效，请从客户端重新打开。'); };
const termUnavailable = () => { throw new ApiError(402, 'SUBSCRIPTION_WRITE_UNAVAILABLE', '团队订阅有效期内才能增购席位。'); };
const integer = (value, min = 0) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min;
const match = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;

export function createWebsiteCheckoutCandidate({origin} = {}) {
  if (typeof origin !== 'string' || !/^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin) ||
      new URL(origin).origin !== origin) throw new TypeError('An explicit loopback TLS checkout origin is required');
  const candidate = Object.freeze({origin});
  candidates.add(candidate);
  return candidate;
}

function syntheticCheckoutDatabase(db) {
  return db.prepare("SELECT value FROM team_database_metadata WHERE name='website-checkout-demo'").get()?.value === 'true';
}

export function initializeWebsiteCheckoutStore(db) {
  if (!syntheticCheckoutDatabase(db)) throw new Error('Website checkout requires its own explicitly marked synthetic database.');
  db.exec(readFileSync(new URL('./website-checkout-schema.sql',import.meta.url),'utf8'));
}

export function websiteCheckoutAvailable(db, options) {
  const simulation = options.billingSimulation;
  return candidates.has(options.websiteCheckout) && options.serviceMode === 'local-preview' &&
    options.identityProviders?.deviceProofRequired === true &&
    options.subscriptionEnforcement === 'team-management-v1' &&
    options.seatCapacityEnforcement === 'invitation-reservations-v1' &&
    simulation?.offers.length === 1 && integer(simulation.annualSeatUnitAmountMinor, 1) && syntheticCheckoutDatabase(db) &&
    !!db.prepare("SELECT 1 FROM main.sqlite_schema WHERE type='table' AND name='team_website_checkout_handoffs'").get();
}

export function isWebsiteCheckoutBrowserPath(path) {
  return path === WEB_CONTEXT || path === WEB_ORDERS || seatRoutes.has(path);
}

function fixedPost(url, request) {
  if (url.search || url.hash || url.href.endsWith('?')) invalid();
  if (request.method !== 'POST') return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'POST'});
}

function serverTime(options) {
  const at = options.now();
  if (!integer(at) || !integer(at + TTL_MS)) unavailable();
  return at;
}

function credentialProof(handoff, passwordHash) {
  // Only a caller already holding the raw handoff can recompute this proof.
  return createHmac('sha256',Buffer.from(handoff,'base64url'))
    .update('shenyi.website.checkout.credential.v1\0').update(passwordHash).digest('hex');
}

function assertCurrent(db, ticket, handoff, at) {
  if (at < ticket.issuedAt || at >= ticket.expiresAt || deviceServerId(db) !== ticket.serverId) expired();
  const source = db.prepare(`SELECT lease.lease_id, binding.key_fingerprint, credential.revision AS credential_revision,
    credential.password_hash, COALESCE(epoch.version,0) AS identity_epoch
    FROM team_device_leases lease JOIN team_sessions session ON session.token_hash=lease.auth_session_hash
    JOIN team_users account ON account.user_id=lease.user_id AND session.user_id=account.user_id
    JOIN team_device_bindings binding ON binding.device_id=lease.device_id AND binding.user_id=account.user_id
    JOIN team_credentials credential ON credential.user_id=account.user_id
    LEFT JOIN team_recovery_identity_epochs epoch ON epoch.user_id=account.user_id
    WHERE lease.lease_id=? AND lease.auth_session_hash=? AND lease.device_id=? AND lease.user_id=?
      AND lease.binding_revision=? AND binding.revision=lease.binding_revision AND binding.status='active'
      AND lease.revoked_at IS NULL AND session.revoked_at IS NULL AND account.status='active'
      AND lease.expires_at>? AND session.expires_at>?`).get(ticket.leaseId,ticket.sessionBinding,ticket.deviceId,ticket.userId,
    ticket.bindingRevision,at,at);
  if (!source || source.key_fingerprint !== ticket.keyFingerprint || source.credential_revision !== ticket.credentialRevision ||
      source.identity_epoch !== ticket.identityEpoch || credentialProof(handoff,source.password_hash) !== ticket.credentialProof ||
      !administratorTechnicalEligible(db,ticket.userId,ticket.teamId)) expired();
}

export async function handleWebsiteCheckoutHandoff(request, options) {
  const url = new URL(request.url), route = ISSUER.exec(url.pathname);
  if (!route) return null;
  if (!websiteCheckoutAvailable(options.db,options)) unavailable();
  const methodError = fixedPost(url,request);
  if (methodError) return methodError;
  const context = options.deviceContext;
  if (!context) throw new ApiError(403,'DEVICE_PROOF_REQUIRED','请从已绑定设备打开官网订单页。');
  const body = await readJson(request,['orderId'],1024);
  const orderId = Object.hasOwn(body,'orderId') ? body.orderId : undefined;
  if (orderId !== undefined && !match(UUID,orderId)) invalid();
  const {db,websiteCheckout,billingSimulation} = options, teamId = route[1];
  return transaction(db,() => {
    const at = serverTime(options);
    const actor = currentDeviceLease(db, request, at);
    if (actor.userId !== context.userId || actor.stamp !== context.stamp || actor.leaseId !== context.leaseId ||
        actor.deviceId !== context.deviceId || actor.bindingRevision !== context.bindingRevision ||
        deviceServerId(db) !== context.serverId) deviceConflict();
    if (!administratorTechnicalEligible(db,actor.userId,teamId)) deny();
    const seat = route[2] === '-seat';
    if (orderId !== undefined) {
      existingReceipt(db,seat,teamId,orderId,billingSimulation.merchantId);
    } else if (seat) {
      if (!billingSimulation.seatOffer) unavailable();
      if (readSubscriptionState(db,teamId,at).state !== 'active') termUnavailable();
    }
    db.prepare('DELETE FROM team_website_checkout_handoffs WHERE expires_at<=?').run(at);
    const outstanding = db.prepare('SELECT count(*) AS count FROM team_website_checkout_handoffs').get().count;
    if (outstanding >= MAX_OUTSTANDING) throw new ApiError(429,'WEBSITE_HANDOFF_LIMIT','订单页授权过多，请稍后再试。');
    const handoff = randomBytes(32).toString('base64url');
    const expiresAt = Math.min(at + TTL_MS,actor.leaseExpiresAt), requestId = randomUUID();
    const scope = {
      teamId, userId:actor.userId, leaseId:actor.leaseId, sessionBinding:actor.sessionBinding,
      serverId:context.serverId, deviceId:actor.deviceId, bindingRevision:actor.bindingRevision,
      keyFingerprint:actor.keyFingerprint, credentialRevision:actor.credentialRevision, identityEpoch:actor.identityEpoch,
      credentialProof:credentialProof(handoff,actor.passwordHash), issuedAt:at, seat,
      ...(orderId === undefined ? {} : {orderId}),
    };
    assertCurrent(db,{...scope,expiresAt},handoff,at);
    db.prepare(`INSERT INTO team_website_checkout_handoffs
      (handoff_hash,origin,merchant_id,request_id,expires_at,scope_json) VALUES (?,?,?,?,?,?)`)
      .run(digest(handoff),websiteCheckout.origin,billingSimulation.merchantId,requestId,expiresAt,JSON.stringify(scope));
    return json({handoff,expiresAt},201);
  });
}

function teamName(db,teamId) {
  const profile = db.prepare('SELECT name FROM team_profiles WHERE team_id=?').get(teamId);
  return safeMemberText(profile?.name,teamId);
}

function receiptStatus(order) {
  if (!ORDER_STATES.has(order.status)) conflict();
  if (order.paymentException || (order.closure && order.status === 'payment-verified')) return 'payment-review';
  return order.status;
}

function projectedOrder(order) {
  if (order.simulation !== true || order.offer.currency !== 'CNY' ||
      !integer(order.renewalSeats?.selectedSeats)) conflict();
  return {id:order.id,amountMinor:order.offer.amountMinor,seats:order.renewalSeats.selectedSeats,
    createdAt:order.createdAt,status:receiptStatus(order),currency:'CNY'};
}

function projectedSeatOrder(order) {
  if (order.simulation !== true || order.offer.product !== SEAT_PRODUCT ||
      order.offer.currency !== 'CNY') conflict();
  return {id:order.id,amountMinor:order.offer.amountMinor,seats:order.quantity,createdAt:order.createdAt,
    status:receiptStatus(order),currency:'CNY',termEndsAt:order.termEndsAt,quoteExpiresAt:order.quoteExpiresAt};
}

function existingReceipt(db, seat, teamId, orderId, merchantId) {
  const order = (seat ? readSeatOrder : readAnnualOrder)(db,teamId,orderId);
  if (!order || order.merchantId !== merchantId || (!seat && !integer(order.renewalSeats?.selectedSeats))) deny();
  return seat ? projectedSeatOrder(order) : projectedOrder(order);
}

function seatCheckout(path, body, state, options, at) {
  const {db,billingSimulation} = options, {ticket,quote,handoffHash} = state;
  const offer = billingSimulation.seatOffer;
  if (!offer) unavailable();
  const existing = readSeatOrderRequest(db,ticket.teamId,ticket.userId,ticket.requestId);
  if (path === SEAT_CONTEXT) {
    const term = readSubscriptionState(db,ticket.teamId,at);
    return json({simulation:true,teamName:teamName(db,ticket.teamId),offer:{...offer,product:SEAT_PRODUCT},
      termEndsAt:term.state === 'active' ? term.endsAt : null,order:existing?projectedSeatOrder(existing):null});
  }
  if (path === SEAT_QUOTE) {
    if (!match(ID,body.offerId) || !integer(body.offerRevision,1) ||
        !integer(body.quantity,1) || body.quantity > 1000) invalid();
    if (existing || body.offerId !== offer.id || body.offerRevision !== offer.revision) conflict();
    const price = readSeatOrderQuote(db,{teamId:ticket.teamId,offer,quantity:body.quantity},{now:()=>at});
    const value = {id:randomUUID(),seats:body.quantity,amountMinor:price.amountMinor,termEndsAt:price.termEndsAt,
      expiresAt:Math.min(at+SEAT_QUOTE_TTL_MS,ticket.expiresAt,price.quoteExpiresAt)};
    const saved = JSON.stringify({value,offer,termRevision:price.termRevision,quotedAt:at});
    if (db.prepare('UPDATE team_website_checkout_handoffs SET quote_json=? WHERE handoff_hash=?').run(saved,handoffHash).changes !== 1) conflict();
    return json({simulation:true,quote:value});
  }
  if (!match(UUID,body.quoteId)) invalid();
  if (quote?.value.id !== body.quoteId) conflict();
  if (existing) return json({simulation:true,order:projectedSeatOrder(existing)},201);
  const {seats,expiresAt,amountMinor,termEndsAt} = quote.value;
  const selection = {teamId:ticket.teamId,offer,quantity:seats};
  const price = readSeatOrderQuote(db,selection,{now:()=>at});
  if (at < quote.quotedAt || at >= expiresAt || price.termRevision !== quote.termRevision ||
      price.termEndsAt !== termEndsAt || price.amountMinor !== amountMinor || offer.id !== quote.offer.id ||
      offer.revision !== quote.offer.revision || offer.annualUnitAmountMinor !== quote.offer.annualUnitAmountMinor) conflict();
  const order = createSeatOrderWithinTransaction(db,{...selection,actorId:ticket.userId,
    requestId:ticket.requestId,merchantId:billingSimulation.merchantId},{now:()=>at});
  const confirmedAt = serverTime(options);
  if (confirmedAt < at || confirmedAt >= expiresAt) conflict();
  assertCurrent(db,ticket,body.handoff,confirmedAt);
  return json({simulation:true,order:projectedSeatOrder(order)},201);
}

export async function handleWebsiteCheckoutBrowser(request, options) {
  const url = new URL(request.url), methodError = fixedPost(url,request);
  if (methodError) return methodError;
  const {db,websiteCheckout,billingSimulation} = options;
  if (!websiteCheckoutAvailable(db,options)) return json({error:{code:'NOT_FOUND',message:'无法访问此资源。'}},404);
  if (request.headers.get('Origin') !== websiteCheckout.origin || url.origin !== websiteCheckout.origin) {
    throw new ApiError(403,'WEBSITE_ORIGIN_REQUIRED','请从受信官网订单页继续操作。');
  }
  const create = url.pathname === WEB_ORDERS;
  const seatKeys = seatRoutes.get(url.pathname);
  const body = await readJson(request,seatKeys ?? (create?['handoff','offerId','offerRevision','selectedSeats','expectedAmountMinor']:['handoff']),4096);
  if (!match(/^[A-Za-z0-9_-]{43}$/,body.handoff) || Buffer.from(body.handoff,'base64url').toString('base64url') !== body.handoff) expired();
  const handoffHash = digest(body.handoff);
  return transaction(db,() => {
    const at = serverTime(options);
    const row = db.prepare(`SELECT request_id,expires_at,scope_json,quote_json FROM team_website_checkout_handoffs
      WHERE handoff_hash=? AND origin=? AND merchant_id=?`).get(handoffHash,websiteCheckout.origin,billingSimulation.merchantId);
    if (!row || at >= row.expires_at) expired();
    const ticket = {...JSON.parse(row.scope_json),requestId:row.request_id,expiresAt:row.expires_at};
    if (ticket.seat !== Boolean(seatKeys)) expired();
    assertCurrent(db,ticket,body.handoff,at);
    if (ticket.orderId !== undefined) {
      if (url.pathname !== (ticket.seat ? SEAT_CONTEXT : WEB_CONTEXT)) {
        throw new ApiError(403,'WEBSITE_RECEIPT_READ_ONLY','此订单页授权仅供核对原订单。');
      }
      return json({simulation:true,teamName:teamName(db,ticket.teamId),receiptOnly:true,
        order:existingReceipt(db,ticket.seat,ticket.teamId,ticket.orderId,billingSimulation.merchantId)});
    }
    if (seatKeys) {
      const quote = row.quote_json === null ? null : JSON.parse(row.quote_json);
      return seatCheckout(url.pathname,body,{ticket,quote,handoffHash},options,at);
    }
    const offer = billingSimulation.offers[0], unitAmountMinor = billingSimulation.annualSeatUnitAmountMinor;
    const existing = readAnnualOrderRequest(db,ticket.teamId,ticket.userId,ticket.requestId);
    if (!create) {
      const defaults = readAnnualSeatRenewalDefaults(db,ticket.teamId,at);
      return json({simulation:true,teamName:teamName(db,ticket.teamId),offer,
        pricing:{defaultSeats:defaults.defaultSeats,committedSeats:defaults.committedSeats,unitAmountMinor},
        order:existing?projectedOrder(existing):null});
    }
    if (!match(ID,body.offerId) || !integer(body.offerRevision,1) || !integer(body.selectedSeats) ||
        !integer(body.expectedAmountMinor,1)) invalid();
    if (existing) {
      if (existing.offer.id !== body.offerId || existing.offer.revision !== body.offerRevision ||
          existing.renewalSeats?.selectedSeats !== body.selectedSeats || existing.offer.amountMinor !== body.expectedAmountMinor) conflict();
      return json({simulation:true,order:projectedOrder(existing)},201);
    }
    if (body.offerId !== offer.id || body.offerRevision !== offer.revision) conflict();
    const order = createAnnualOrderWithinTransaction(db,{teamId:ticket.teamId,actorId:ticket.userId,
      requestId:ticket.requestId,merchantId:billingSimulation.merchantId,offer},{now:()=>at,
      renewalSeats:{unitAmountMinor,selectedSeats:body.selectedSeats},
      closeAfterMs:billingSimulation.timeoutClosure?.annualTimeoutMs});
    if (order.offer.amountMinor !== body.expectedAmountMinor) conflict();
    assertCurrent(db,ticket,body.handoff,serverTime(options));
    return json({simulation:true,order:projectedOrder(order)},201);
  });
}
