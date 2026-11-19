import {randomBytes, randomUUID} from 'node:crypto';
import {administratorTechnicalEligible} from './administrator-business-role-policy.mjs';
import {currentDeviceLease, deviceConflict, deviceServerId, digest} from './device-policy.mjs';
import {ApiError, ID, deny, invalid, json, readJson, transaction} from './http-utils.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {createAnnualOrderWithinTransaction, readAnnualOrderRequest, readAnnualSeatRenewalDefaults} from './billing-store.mjs';

const WEB_CONTEXT = '/api/website-checkout/context';
const WEB_ORDERS = '/api/website-checkout/orders';
const ISSUER = /^\/api\/teams\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/billing\/website-handoff$/;
const TTL_MS = 120_000;
const MAX_OUTSTANDING = 256;
const candidates = new WeakMap();
const conflict = () => { throw new ApiError(409, 'WEBSITE_CHECKOUT_CONFLICT', '方案或订单状态已变化，请重新核对。'); };
const unavailable = () => { throw new ApiError(503, 'WEBSITE_CHECKOUT_UNAVAILABLE', '官网合成下单暂不可用。'); };
const expired = () => { throw new ApiError(403, 'WEBSITE_HANDOFF_UNAVAILABLE', '订单页授权已失效，请从客户端重新打开。'); };
const integer = (value, min = 0) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min;
const match = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;

export function createWebsiteCheckoutCandidate({origin} = {}) {
  if (typeof origin !== 'string' || !/^https:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin) ||
      new URL(origin).origin !== origin) throw new TypeError('An explicit loopback TLS checkout origin is required');
  const candidate = Object.freeze({origin});
  candidates.set(candidate, new Map());
  return candidate;
}

export function websiteCheckoutAvailable(db, options) {
  const simulation = options.billingSimulation;
  return candidates.has(options.websiteCheckout) && options.serviceMode === 'local-preview' &&
    options.identityProviders?.deviceProofRequired === true &&
    options.subscriptionEnforcement === 'team-management-v1' &&
    options.seatCapacityEnforcement === 'invitation-reservations-v1' &&
    simulation?.offers.length === 1 && integer(simulation.annualSeatUnitAmountMinor, 1) &&
    db.prepare("SELECT value FROM team_database_metadata WHERE name='website-checkout-demo'").get()?.value === 'true';
}

export function isWebsiteCheckoutBrowserPath(path) {
  return path === WEB_CONTEXT || path === WEB_ORDERS;
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

function assertCurrent(db, ticket, at) {
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
      source.identity_epoch !== ticket.identityEpoch || digest(source.password_hash) !== ticket.credentialHash ||
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
  await readJson(request,[],1024);
  const {db,websiteCheckout} = options, tickets = candidates.get(websiteCheckout), teamId = route[1];
  const at = serverTime(options);
  const actor = currentDeviceLease(db, request, at);
  if (actor.userId !== context.userId || actor.stamp !== context.stamp || actor.leaseId !== context.leaseId ||
      actor.deviceId !== context.deviceId || actor.bindingRevision !== context.bindingRevision ||
      deviceServerId(db) !== context.serverId) deviceConflict();
  if (!administratorTechnicalEligible(db,actor.userId,teamId)) deny();
  for (const [key,value] of tickets) {
    if (value.expiresAt <= at) tickets.delete(key);
  }
  if (tickets.size >= MAX_OUTSTANDING) throw new ApiError(429,'WEBSITE_HANDOFF_LIMIT','订单页授权过多，请稍后再试。');
  const handoff = randomBytes(32).toString('base64url');
  const expiresAt = Math.min(at + TTL_MS, actor.leaseExpiresAt);
  const ticket = {
    teamId, userId:actor.userId, leaseId:actor.leaseId, sessionBinding:actor.sessionBinding,
    serverId:context.serverId, deviceId:actor.deviceId, bindingRevision:actor.bindingRevision,
    keyFingerprint:actor.keyFingerprint, credentialRevision:actor.credentialRevision, identityEpoch:actor.identityEpoch,
    credentialHash:digest(actor.passwordHash), requestId:randomUUID(), issuedAt:at, expiresAt,
  };
  assertCurrent(db,ticket,at);
  tickets.set(digest(handoff),Object.freeze(ticket));
  return json({handoff,expiresAt},201);
}

function projectedOrder(order) {
  if (order.status !== 'pending' || order.simulation !== true || order.offer.currency !== 'CNY' ||
      !integer(order.renewalSeats?.selectedSeats)) conflict();
  return {id:order.id,amountMinor:order.offer.amountMinor,seats:order.renewalSeats.selectedSeats,
    createdAt:order.createdAt,status:'pending',currency:'CNY'};
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
  const body = await readJson(request,create?['handoff','offerId','offerRevision','selectedSeats']:['handoff'],4096);
  if (!match(/^[A-Za-z0-9_-]{43}$/,body.handoff) || Buffer.from(body.handoff,'base64url').toString('base64url') !== body.handoff) expired();
  const ticket = candidates.get(websiteCheckout).get(digest(body.handoff));
  if (!ticket) expired();
  const at = serverTime(options);
  const offer = billingSimulation.offers[0], unitAmountMinor = billingSimulation.annualSeatUnitAmountMinor;
  return transaction(db,() => {
    assertCurrent(db,ticket,at);
    const existing = readAnnualOrderRequest(db,ticket.teamId,ticket.userId,ticket.requestId);
    if (!create) {
      const defaults = readAnnualSeatRenewalDefaults(db,ticket.teamId,at);
      const profile = db.prepare('SELECT name FROM team_profiles WHERE team_id=?').get(ticket.teamId);
      return json({simulation:true,teamName:safeMemberText(profile?.name,ticket.teamId),offer,
        pricing:{defaultSeats:defaults.defaultSeats,committedSeats:defaults.committedSeats,unitAmountMinor},
        order:existing?projectedOrder(existing):null});
    }
    if (!match(ID,body.offerId) || !integer(body.offerRevision,1) || !integer(body.selectedSeats)) invalid();
    if (existing) {
      if (existing.offer.id !== body.offerId || existing.offer.revision !== body.offerRevision ||
          existing.renewalSeats?.selectedSeats !== body.selectedSeats) conflict();
      return json({simulation:true,order:projectedOrder(existing)},201);
    }
    if (body.offerId !== offer.id || body.offerRevision !== offer.revision) conflict();
    const order = createAnnualOrderWithinTransaction(db,{teamId:ticket.teamId,actorId:ticket.userId,
      requestId:ticket.requestId,merchantId:billingSimulation.merchantId,offer},{now:()=>at,
      renewalSeats:{unitAmountMinor,selectedSeats:body.selectedSeats}});
    assertCurrent(db,ticket,serverTime(options));
    return json({simulation:true,order:projectedOrder(order)},201);
  });
}
