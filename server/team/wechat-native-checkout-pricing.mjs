import {readAnnualSeatRenewalDefaults} from './billing-store.mjs';
import {ApiError, ID, invalid} from './http-utils.mjs';
import {readSeatOrderQuote} from './seat-order-store.mjs';
import {readSubscriptionState} from './subscription-store.mjs';
import {
  MAX_AMOUNT_MINOR, MAX_PAYMENT_TIME, MAX_PAYMENT_WINDOW_MS, MIN_PAYMENT_WINDOW_MS, boundedInteger, matches, record,
} from './wechat-native-protocol.mjs';

export const ANNUAL_PRODUCT = 'team-annual-renewal';
export const SEAT_PRODUCT = 'team-seat-addition';
const MAX_SEATS = 1000;
const WEBSITE_AUTHORIZATION_LIMIT_MS = 120_000;
const SEAT_PRORATION = 'beijing-calendar-year-from-quote';

const isShape = (value, keys) => record(value) && Object.keys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(value, key));
const amount = (value, minimum = 1) => boundedInteger(value, minimum, MAX_AMOUNT_MINOR);
const offerKey = value => matches(ID, value.id) && boundedInteger(value.revision, 1, Number.MAX_SAFE_INTEGER);
const conflict = () => { throw new ApiError(409, 'WECHAT_NATIVE_QUOTE_CONFLICT', '报价或团队状态已变化，请重新报价。'); };
export const paymentWindowUnavailable = () => {
  throw new ApiError(409, 'WECHAT_NATIVE_PAYMENT_WINDOW', '剩余付款时间不足，无法生成付款码。');
};

export function validateWechatNativeCatalog(value) {
  if (value === undefined) return;
  if (!isShape(value, ['annual', 'seat', 'quoteDurationMs', 'paymentDurationMs'])) throw new TypeError('Invalid Native catalog');
  const {annual, seat, quoteDurationMs, paymentDurationMs} = value;
  if (!isShape(annual, ['id', 'revision', 'baseAmountMinor', 'unitAmountMinor']) ||
      !isShape(seat, ['id', 'revision', 'annualUnitAmountMinor', 'prorationBasis']) ||
      !offerKey(annual) || !offerKey(seat) || annual.id === seat.id ||
      !amount(annual.baseAmountMinor) || !amount(annual.unitAmountMinor, 0) || !amount(seat.annualUnitAmountMinor) ||
      seat.prorationBasis !== SEAT_PRORATION ||
      !boundedInteger(quoteDurationMs, 1000, WEBSITE_AUTHORIZATION_LIMIT_MS) ||
      !boundedInteger(paymentDurationMs, WEBSITE_AUTHORIZATION_LIMIT_MS + MIN_PAYMENT_WINDOW_MS + 1000, MAX_PAYMENT_WINDOW_MS) ||
      paymentDurationMs % 1000 !== 0) throw new TypeError('Invalid Native catalog');
  return Object.freeze({annual:Object.freeze({...annual}), seat:Object.freeze({...seat}), quoteDurationMs, paymentDurationMs});
}

function activeSeatTerm(db, teamId, at) {
  const term = readSubscriptionState(db, teamId, at);
  if (term.state !== 'active') {
    throw new ApiError(402, 'SUBSCRIPTION_WRITE_UNAVAILABLE', '团队订阅有效期内才能增购席位。');
  }
  return term;
}

export function nativeCheckoutOptions(db, teamId, product, at) {
  if (product === SEAT_PRODUCT) {
    activeSeatTerm(db, teamId, at);
    return {defaultSeats:1, minimumSeats:1, maximumSeats:MAX_SEATS};
  }
  const {defaultSeats, committedSeats} = readAnnualSeatRenewalDefaults(db, teamId, at);
  if (defaultSeats > MAX_SEATS || committedSeats > MAX_SEATS) {
    throw new ApiError(409, 'WECHAT_NATIVE_SEAT_LIMIT', '团队已有席位超出当前方案支持的范围，请联系负责人核对。');
  }
  return {defaultSeats:Math.max(defaultSeats, committedSeats), minimumSeats:committedSeats, maximumSeats:MAX_SEATS};
}

function paymentDeadline(catalog, at, termEndsAt, handoffExpiresAt) {
  const limit = Math.min(at + catalog.paymentDurationMs, termEndsAt ?? MAX_PAYMENT_TIME, MAX_PAYMENT_TIME);
  const deadline = Math.floor(limit / 1000) * 1000;
  // Every authorized click in the original checkout needs the provider's full time window.
  if (deadline < handoffExpiresAt + MIN_PAYMENT_WINDOW_MS) paymentWindowUnavailable();
  return deadline;
}

export function priceNativeCheckout(db, catalog, {teamId, product, seats, at, handoffExpiresAt}) {
  const options = nativeCheckoutOptions(db, teamId, product, at);
  if (!boundedInteger(seats, 0, options.maximumSeats)) invalid();
  if (seats < options.minimumSeats) conflict();
  const offer = product === SEAT_PRODUCT ? catalog.seat : catalog.annual;
  let amountMinor, termRevision = null, termEndsAt = null;
  if (product === SEAT_PRODUCT) {
    const price = readSeatOrderQuote(db, {
      teamId, quantity:seats, offer:{id:offer.id, revision:offer.revision, annualUnitAmountMinor:offer.annualUnitAmountMinor, currency:'CNY'},
    }, {now:() => at});
    ({amountMinor, termRevision, termEndsAt} = price);
  } else {
    amountMinor = offer.baseAmountMinor + offer.unitAmountMinor * seats;
  }
  if (!amount(amountMinor)) invalid();
  paymentDeadline(catalog, at, termEndsAt, handoffExpiresAt);
  const quoteExpiresAt = Math.min(at + catalog.quoteDurationMs, handoffExpiresAt);
  if (at >= quoteExpiresAt) conflict();
  return {options, quote:{offerId:offer.id, offerRevision:offer.revision, seats, amountMinor,
    termRevision, termEndsAt, quotedAt:at, quoteExpiresAt}};
}

export function confirmNativeCheckout(db, catalog, {teamId, product, quote, at, handoffExpiresAt}) {
  if (at < quote.quotedAt || at >= quote.quoteExpiresAt) conflict();
  if (product === SEAT_PRODUCT) {
    const term = activeSeatTerm(db, teamId, at);
    if (term.revision !== quote.termRevision || term.endsAt !== quote.termEndsAt) conflict();
  }
  // The reviewed quote fixes the amount. A new subscription revision requires a new quote.
  return paymentDeadline(catalog, at, quote.termEndsAt, handoffExpiresAt);
}
