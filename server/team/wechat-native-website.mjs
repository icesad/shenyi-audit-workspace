import {randomBytes, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {digest} from './device-policy.mjs';
import {ApiError, invalid, json, readJson, PRIVATE_HEADERS, transaction} from './http-utils.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {assertWebsiteHandoffCurrent, websiteHandoffScope} from './website-checkout.mjs';
import {
  ANNUAL_PRODUCT, SEAT_PRODUCT, confirmNativeCheckout, nativeCheckoutOptions, paymentWindowUnavailable,
  priceNativeCheckout, validateWechatNativeCatalog,
} from './wechat-native-checkout-pricing.mjs';
import {MIN_PAYMENT_WINDOW_MS} from './wechat-native-protocol.mjs';

const ROOT = '/api/website-pay/';
const ISSUER = /^\/api\/teams\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/billing\/native-website(-order)?-handoff$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_OUTSTANDING = 256;
const MIN_PROVIDER_INTERVAL_MS = 2000;
const paths = new Map([
  [ROOT, ['website/native-payment.html', 'text/html; charset=utf-8']],
  [ROOT+'payment.js', ['website/native-payment.js', 'text/javascript; charset=utf-8']],
  [ROOT+'payment.css', ['website/native-payment.css', 'text/css; charset=utf-8']],
  [ROOT+'base.css', ['website/styles.css', 'text/css; charset=utf-8']],
  [ROOT+'brand.png', ['dist/brand-shenyi.png', 'image/png']],
]);
const actions = new Map([
  [ROOT+'order',['handoff']], [ROOT+'code',['handoff']], [ROOT+'check',['handoff']],
  [ROOT+'quote',['handoff','seats']], [ROOT+'confirm',['handoff','quoteId']],
]);
const staticHeaders = {
  ...PRIVATE_HEADERS,
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Robots-Tag': 'noindex, nofollow',
};

const matches = (pattern, value) => typeof value === 'string' && pattern.exec(value)?.[0] === value;
const methodDenied = allow => json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow});
const expired = () => { throw new ApiError(403,'WEBSITE_HANDOFF_UNAVAILABLE','订单页授权已失效，请从客户端重新打开。'); };
const unavailable = () => { throw new ApiError(503,'WEBSITE_PAYMENT_UNAVAILABLE','暂时无法查询付款。'); };
const rateLimit = () => { throw new ApiError(429,'WEBSITE_PAYMENT_RATE_LIMIT','请稍后再核对订单。'); };
const notFound = () => json({error:{code:'NOT_FOUND',message:'无法访问此资源。'}},404);
const quoteConflict = () => { throw new ApiError(409,'WECHAT_NATIVE_QUOTE_CONFLICT','请核对原订单或重新报价。'); };
const previousOrderUnresolved = () => {
  throw new ApiError(409,'WECHAT_NATIVE_PREVIOUS_ORDER_UNRESOLVED','请先核对上一笔订单的付款和到账状态。');
};

export const isNativeWebsitePath = path => paths.has(path) || actions.has(path);
export const isNativeWebsiteIssuerPath = path => ISSUER.test(path);

export async function checkWechatNativeWebsiteAssets() {
  const {default:qrcode} = await import('qrcode-generator');
  const assets = new Map([...paths].map(([route,[file,type]]) =>
    [route,{bytes:readFileSync(new URL('../../'+file,import.meta.url)),type}]));
  return {qrcode,assets};
}

export async function createWechatNativeWebsite({db, origin, billing, catalog:catalogValue, now = Date.now}) {
  const catalog = validateWechatNativeCatalog(catalogValue);
  const {qrcode,assets} = await checkWechatNativeWebsiteAssets();
  const handoffs = new Map(), inFlight = new Set(), recentlyUsed = new Map();
  const teamName = db.prepare('SELECT name FROM main.team_profiles WHERE team_id=?');

  function clock() {
    const at = now();
    if (!Number.isSafeInteger(at) || at < 0 || !Number.isSafeInteger(at + 120_000)) unavailable();
    return at;
  }

  function current(token) {
    const at = clock();
    const ticket = handoffs.get(digest(token));
    if (!ticket) expired();
    assertWebsiteHandoffCurrent(db,ticket,token,at);
    const actor = {teamId:ticket.teamId,actorId:ticket.userId};
    const result = ticket.purchase
      ? billing.readOrderForRequest({...actor,...ticket.purchase})
      : billing.readOrder({...actor,orderId:ticket.orderId});
    const access = result ? {...actor,orderId:result.order.id} : null;
    return {ticket,access,result,at};
  }

  function nameOf(teamId) {
    return safeMemberText(teamName.get(teamId)?.name,teamId);
  }

  function projection({order,payment,providerReviewStates}, at) {
    let status;
    if (payment?.status === 'needs_review' || payment?.providerReviewStates?.length) status = 'needs_review';
    else if (payment) status = payment.status;
    else if (providerReviewStates?.includes('REFUND')) status = 'needs_review';
    else if (providerReviewStates?.includes('CLOSED')) status = 'closed';
    else status = at >= order.expiresAt ? 'expired' : 'pending';
    return {id:order.id,product:order.product,teamName:nameOf(order.teamId),
      amountMinor:order.amountMinor,seats:order.seats,currency:order.currency,expiresAt:order.expiresAt,status};
  }

  function response(state, qr) {
    return json({order:projection(state.result,state.at),handoffExpiresInMs:state.ticket.expiresAt-state.at,
      ...(qr ? {qr} : {})});
  }

  function purchaseOptions(state, options) {
    const {teamId,purchase} = state.ticket;
    return {product:purchase.product,teamName:nameOf(teamId),
      ...(options ?? nativeCheckoutOptions(db,teamId,purchase.product,state.at))};
  }

  function assertPreviousOrderResolved(ticket) {
    const {previousRequestId,purchase,teamId,userId} = ticket;
    if (previousRequestId === undefined) return;
    let prior;
    try {
      prior = billing.readOrderForRequest({teamId,actorId:userId,product:purchase.product,requestId:previousRequestId});
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'NOT_FOUND') throw error;
      previousOrderUnresolved();
    }
    if (!prior) previousOrderUnresolved();
    const {payment,providerReviewStates} = prior;
    const fulfilled = payment?.status === 'fulfilled' && payment.fulfilment && !payment.providerReviewStates?.length;
    const closedUnpaid = !payment && providerReviewStates?.includes('CLOSED') && !providerReviewStates.includes('REFUND');
    if (!fulfilled && !closedUnpaid) previousOrderUnresolved();
  }

  function quoteResponse(seats, authorize) {
    const {state,quote,checkout} = transaction(db,() => {
      const state = authorize();
      if (state.result) quoteConflict();
      assertPreviousOrderResolved(state.ticket);
      const {teamId,purchase,expiresAt} = state.ticket;
      const {options,quote} = priceNativeCheckout(db,catalog,{teamId,product:purchase.product,
        seats,at:state.at,handoffExpiresAt:expiresAt});
      const checked = authorize();
      if (checked.at < state.at || checked.at >= quote.quoteExpiresAt) quoteConflict();
      return {state:checked,quote:{...quote,id:randomUUID()},checkout:purchaseOptions(checked,options)};
    });
    state.ticket.quote = quote;
    const {id,amountMinor,quoteExpiresAt,termEndsAt} = quote;
    return json({checkout,quote:{id,seats,amountMinor,currency:'CNY',quoteExpiresAt,
      quoteExpiresInMs:quoteExpiresAt-state.at,termEndsAt},
      handoffExpiresInMs:state.ticket.expiresAt-state.at});
  }

  function confirmResponse(body, authorize) {
    if (!matches(UUID,body.quoteId)) invalid();
    const state = transaction(db,() => {
      const state = authorize();
      const {ticket,result,at} = state;
      const {quote,teamId,purchase} = ticket;
      if (quote?.id !== body.quoteId) quoteConflict();
      const {offerId,offerRevision,seats,amountMinor,termRevision} = quote;
      if (result) {
        if (result.order.offerId !== offerId || result.order.offerRevision !== offerRevision ||
            result.order.seats !== seats || result.order.amountMinor !== amountMinor ||
            result.order.termRevision !== termRevision) quoteConflict();
        return state;
      }
      assertPreviousOrderResolved(ticket);
      const expiresAt = confirmNativeCheckout(db,catalog,{teamId,product:purchase.product,quote,at,handoffExpiresAt:ticket.expiresAt});
      billing.lockOrderWithinTransaction({teamId,actorId:ticket.userId,...purchase,
        offerId,offerRevision,seats,amountMinor,termRevision,expiresAt},at);
      const latest = authorize();
      if (latest.at < at || latest.at >= quote.quoteExpiresAt) quoteConflict();
      return latest;
    });
    return response(state);
  }

  async function fromProvider(orderId, operation, at, action) {
    // Do not issue concurrent vendor requests for the same locked order.
    for (const [id,until] of recentlyUsed) if (at >= until) recentlyUsed.delete(id);
    const key = operation + ':' + orderId;
    if (inFlight.has(orderId) || recentlyUsed.has(key) || inFlight.size >= MAX_OUTSTANDING) rateLimit();
    recentlyUsed.set(key, at + MIN_PROVIDER_INTERVAL_MS);
    inFlight.add(orderId);
    try { return await action(); }
    finally { inFlight.delete(orderId); }
  }

  return Object.freeze({
    canPurchase:catalog !== undefined,
    async issue(request, context) {
      const url = new URL(request.url), route = ISSUER.exec(url.pathname);
      if (!route || request.url !== origin + url.pathname) return notFound();
      if (request.method !== 'POST') return methodDenied('POST');
      if (!context) throw new ApiError(403,'DEVICE_PROOF_REQUIRED','请从已绑定设备打开官网订单页。');
      const buying = Boolean(route[2]);
      if (buying && !catalog) return notFound();
      const body = await readJson(request,buying ? ['product','requestId','previousRequestId'] : ['orderId'],1024);
      if (buying ? ![ANNUAL_PRODUCT,SEAT_PRODUCT].includes(body.product) || !matches(UUID,body.requestId) :
        !matches(UUID,body.orderId)) invalid();
      const {previousRequestId} = body;
      if (previousRequestId !== undefined && (!matches(UUID,previousRequestId) || previousRequestId === body.requestId)) invalid();
      const token = randomBytes(32).toString('base64url');
      const scope = transaction(db,() => {
        const at = clock();
        const ticket = websiteHandoffScope(db,request,context,{teamId:route[1],handoff:token,at});
        const actor = {teamId:ticket.teamId,actorId:ticket.userId};
        if (buying) {
          const purchase = {product:body.product,requestId:body.requestId};
          const existing = billing.readOrderForRequest({...actor,...purchase});
          const scope = {...ticket,purchase,previousRequestId};
          if (!existing) assertPreviousOrderResolved(scope);
          return scope;
        }
        billing.readOrder({...actor,orderId:body.orderId});
        return {...ticket,orderId:body.orderId};
      });
      for (const [hash,ticket] of handoffs) if (scope.issuedAt >= ticket.expiresAt) handoffs.delete(hash);
      if (handoffs.size >= MAX_OUTSTANDING) rateLimit();
      const expiresInMs = scope.expiresAt-clock();
      if (expiresInMs < 1 || expiresInMs > 120_000) expired();
      handoffs.set(digest(token),scope);
      return json({handoff:token,expiresAt:scope.expiresAt,
        ...(request.headers.get('X-Shenyi-Native-Checkout')==='native-v1'?{expiresInMs}:{})},201);
    },
    async serve(request) {
      const url = new URL(request.url), file = assets.get(url.pathname);
      if (!isNativeWebsitePath(url.pathname) || request.url !== origin + url.pathname) return notFound();
      if (file) {
        if (!['GET','HEAD'].includes(request.method)) return methodDenied('GET, HEAD');
        return new Response(request.method === 'GET' ? file.bytes : null,{
          headers:{...staticHeaders,'Content-Type':file.type},
        });
      }
      try {
        if (request.method !== 'POST') return methodDenied('POST');
        if (request.headers.get('Origin') !== origin || request.headers.has('Authorization') || request.headers.has('Cookie') ||
            [...request.headers.keys()].some(name => name.startsWith('x-shenyi-'))) expired();
        const body = await readJson(request,actions.get(url.pathname),1024);
        const {handoff} = body;
        if (!matches(/^[A-Za-z0-9_-]{43}$/,handoff) || Buffer.from(handoff,'base64url').toString('base64url') !== handoff) expired();
        const authorize = () => {
          if (request.signal.aborted) expired();
          return current(handoff);
        };
        let state = authorize();
        if (url.pathname === ROOT+'quote' || url.pathname === ROOT+'confirm') {
          if (!state.ticket.purchase) return notFound();
          return url.pathname === ROOT+'quote' ? quoteResponse(body.seats,authorize) : confirmResponse(body,authorize);
        }
        if (!state.result) {
          if (url.pathname !== ROOT+'order') quoteConflict();
          return json({checkout:purchaseOptions(state),handoffExpiresInMs:state.ticket.expiresAt-state.at});
        }
        const {access} = state;
        if (url.pathname === ROOT+'code') {
          if (projection(state.result,state.at).status === 'pending' &&
              state.result.order.expiresAt < state.at + MIN_PAYMENT_WINDOW_MS) paymentWindowUnavailable();
          const {codeUrl} = await fromProvider(access.orderId,'code',state.at,() => billing.createPaymentCode(access));
          state = authorize();
          if (projection(state.result,state.at).status !== 'pending') return response(state);
          const qr = qrcode(0,'M');
          qr.addData(codeUrl,'Byte');
          qr.make();
          return response(state,qr.createDataURL(6));
        }
        if (url.pathname === ROOT+'check' && projection(state.result,state.at).status !== 'needs_review') {
          await fromProvider(access.orderId,'check',state.at,() => billing.queryPayment(access));
          state = authorize();
          if (state.result.payment?.status === 'pending_fulfilment') {
            try {
              billing.fulfilPayment(access,{authorize});
            } catch (error) {
              if (!(error instanceof ApiError) || error.status !== 409) throw error;
            }
            state = authorize();
          }
        }
        return response(state);
      } catch (error) {
        if (error instanceof ApiError) return json({error:{code:error.code,message:error.message}},error.status);
        return json({error:{code:'WEBSITE_PAYMENT_UNAVAILABLE',message:'暂时无法查询付款。'}},503);
      }
    },
  });
}
