import {APP_ID, TRANSACTION_ID, matches, parsePaymentTime} from './wechat-native-protocol.mjs';

export const MAX_WECHAT_TRADE_BILL_BYTES = 32 * 1024 * 1024;
const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);
const BILL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TRADE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DIRECT_MERCHANT = /^\d{8,10}$/;
export const BILL_MERCHANT_ORDER_ID = /^[A-Za-z0-9_*|@-]{1,32}$/;
export const MERCHANT_REFUND_ID = /^[A-Za-z0-9_*|@-]{1,64}$/;
const TRADE_TYPE = /^[A-Z][A-Z0-9_-]{0,31}$/;
const CURRENCY = /^[A-Z]{3}$/;
const TRADE_STATUSES = new Set(['SUCCESS', 'REFUND', 'REVOKED']);
const REFUND_STATUSES = new Set(['SUCCESS', 'PROCESSING', 'FAIL', 'CHANGE']);
const REFUND_TYPES = new Set(['ORIGINAL', 'BALANCE', 'PLATFORM-ORIGINAL', 'PLATFORM-BALANCE']);

// Current ALL export for ordinary merchants. SUCCESS and REFUND exports have different layouts.
const HEADER_COLUMNS = [
  '交易时间', '公众账号ID', '商户号', '特约商户号', '设备号', '微信订单号', '商户订单号', '用户标识',
  '交易类型', '交易状态', '付款银行', '货币种类', '应结订单金额', '代金券金额', '微信退款单号', '商户退款单号',
  '退款金额', '充值券退款金额', '退款类型', '退款状态', '商品名称', '商户数据包', '手续费', '费率',
  '订单金额', '申请退款金额', '费率备注',
];
const HEADER = HEADER_COLUMNS.join(',');
const SUMMARY_HEADER = [
  '总交易单数', '应结订单总金额', '退款总金额', '充值券退款总金额', '手续费总金额', '订单总金额', '申请退款总金额',
].join(',');

function invalidBill() {
  throw Object.assign(new Error('微信支付交易账单格式或汇总无法核验。'), {code: 'WECHAT_NATIVE_TRADE_BILL_INVALID'});
}

function decodeBill(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_WECHAT_TRADE_BILL_BYTES) invalidBill();
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    return invalidBill();
  }
}

function readLines(content) {
  let start = 0;
  return () => {
    if (start === content.length) return null;
    const newline = content.indexOf('\n', start);
    const end = newline === -1 ? content.length : newline;
    const line = content.slice(start, newline !== -1 && content[end - 1] === '\r' ? end - 1 : end);
    start = newline === -1 ? end : end + 1;
    return line;
  };
}

function readFields(line, count) {
  if (!line?.startsWith('`') || /[\r\u0000]/.test(line)) invalidBill();
  // The field marker separates delimiters from commas in descriptive data. The documented
  // escapes are left untouched because none of those descriptive columns is projected.
  const fields = line.slice(1).split(',`', count + 1);
  if (fields.length !== count) invalidBill();
  return fields;
}

function readMinor(value, fee = false) {
  // The illustrative ALL export also shows fees with three extra zero digits.
  // Those remain exact cents; sub-cent amounts cannot satisfy this parser's contract.
  const match = /^(-?)(0|[1-9][0-9]{0,13})\.([0-9]{2})(000)?$/.exec(value);
  if (!match || match[0] !== value || (!fee && (match[1] || match[4]))) invalidBill();
  const [, sign, whole, fraction] = match;
  const magnitude = BigInt(whole) * 100n + BigInt(fraction);
  if (magnitude > MAX_SAFE_MINOR) invalidBill();
  return sign === '-' ? -magnitude : magnitude;
}

function readRow(line, expectedMerchant, expectedDate) {
  const [tradeTime, appId, merchantId, subMerchant, , transactionId, merchantOrderId, , tradeType, status, , currency,
    settled, coupon, refundId, merchantRefundId, refunded, rechargeCouponRefund, refundType, refundStatus,
    , , fee, , gross, requestedRefund] = readFields(line, HEADER_COLUMNS.length);
  const occurredAt = matches(TRADE_TIME, tradeTime) && tradeTime.slice(0, 10) === expectedDate
    ? parsePaymentTime(tradeTime.replace(' ', 'T') + '+08:00') : null;
  if (occurredAt === null || !matches(APP_ID, appId) || merchantId !== expectedMerchant || subMerchant !== '0' ||
      !matches(TRANSACTION_ID, transactionId) || transactionId === '0' || !matches(BILL_MERCHANT_ORDER_ID, merchantOrderId) ||
      !matches(TRADE_TYPE, tradeType) || !TRADE_STATUSES.has(status) || !matches(CURRENCY, currency) ||
      (status === 'REVOKED' && tradeType !== 'MICROPAY')) invalidBill();

  const settledAmount = readMinor(settled);
  const couponAmount = readMinor(coupon);
  const refundAmount = readMinor(refunded);
  const rechargeCouponRefundAmount = readMinor(rechargeCouponRefund);
  const feeAmount = readMinor(fee, true);
  const amount = readMinor(gross);
  const requestedRefundAmount = readMinor(requestedRefund);
  const success = status === 'SUCCESS';
  if (success) {
    if (refundId !== '0' || merchantRefundId !== '0' || refundType || refundStatus || refundAmount !== 0n ||
        rechargeCouponRefundAmount !== 0n || requestedRefundAmount !== 0n || settledAmount > amount || couponAmount > amount ||
        feeAmount < 0n) invalidBill();
  } else if (!matches(TRANSACTION_ID, refundId) || refundId === '0' || !matches(MERCHANT_REFUND_ID, merchantRefundId) ||
      merchantRefundId === '0' || !REFUND_TYPES.has(refundType) || !REFUND_STATUSES.has(refundStatus) ||
      settledAmount !== 0n || couponAmount !== 0n || amount !== 0n || feeAmount > 0n ||
      refundAmount > requestedRefundAmount || rechargeCouponRefundAmount > refundAmount) invalidBill();

  return {
    row: {appId, merchantId, merchantOrderId, transactionId, tradeType, status, occurredAt, amountMinor: Number(amount), currency,
      refundId: success ? null : refundId, merchantRefundId: success ? null : merchantRefundId,
      refundAmountMinor: Number(requestedRefundAmount), refundStatus: success ? null : refundStatus},
    amounts: [settledAmount, refundAmount, rechargeCouponRefundAmount, feeAmount, amount, requestedRefundAmount],
  };
}

function readSummary(line, rowCount, observed) {
  const [count, ...amounts] = readFields(line, 7);
  if (count !== String(rowCount) || amounts.some((amount, index) => readMinor(amount, index === 3) !== observed[index])) invalidBill();
  const [settledAmountMinor, refundAmountMinor, rechargeCouponRefundAmountMinor, feeAmountMinor, amountMinor, requestedRefundAmountMinor] =
    observed.map(Number);
  return {rowCount, settledAmountMinor, refundAmountMinor, rechargeCouponRefundAmountMinor, feeAmountMinor, amountMinor, requestedRefundAmountMinor};
}

export function parseWechatNativeTradeBill(bytes, options) {
  const {billDate, merchantId} = options ?? {};
  if (!matches(BILL_DATE, billDate) || parsePaymentTime(billDate + 'T00:00:00+08:00') === null ||
      !matches(DIRECT_MERCHANT, merchantId)) invalidBill();
  const line = readLines(decodeBill(bytes));
  if (line() !== HEADER) invalidBill();

  const rows = [];
  const observed = [0n, 0n, 0n, 0n, 0n, 0n];
  for (let item = line(); item !== SUMMARY_HEADER; item = line()) {
    if (item === null) invalidBill();
    const {row, amounts} = readRow(item, merchantId, billDate);
    rows.push(row);
    for (let index = 0; index < amounts.length; index++) observed[index] += amounts[index];
  }
  const summary = readSummary(line(), rows.length, observed);
  if (line() !== null) invalidBill();
  return {rows, summary};
}
