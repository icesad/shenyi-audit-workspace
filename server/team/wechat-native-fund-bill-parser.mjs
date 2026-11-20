import {matches, parsePaymentTime} from './wechat-native-protocol.mjs';

export const MAX_WECHAT_FUND_BILL_BYTES = 32 * 1024 * 1024;
export const MAX_WECHAT_FUND_BILL_ROWS = 100_000;
const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);
const BILL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACCOUNTING_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const YUAN = /^(-?)(0|[1-9][0-9]{0,13})\.([0-9]{2})$/;
const DIRECTIONS = new Map([['收入', 'credit'], ['支出', 'debit']]);

const DETAIL_COLUMNS = [
  '记账时间', '微信支付业务单号', '资金流水单号', '业务名称', '业务类型', '收支类型', '收支金额(元)', '账户结余(元)',
  '资金变更提交申请人', '备注', '业务凭证号',
];
const SUMMARY_COLUMNS = ['资金流水总笔数', '收入笔数', '收入金额', '支出笔数', '支出金额'];
const DETAIL_HEADER = DETAIL_COLUMNS.join(',');
const SUMMARY_HEADER = SUMMARY_COLUMNS.join(',');

function invalidBill() {
  throw Object.assign(new Error('微信支付资金账单格式或汇总无法核验。'), {code: 'WECHAT_NATIVE_FUND_BILL_INVALID'});
}

function decodeBill(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_WECHAT_FUND_BILL_BYTES) invalidBill();
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    return invalidBill();
  }
}

function readLines(text) {
  let offset = 0;
  return () => {
    if (offset === text.length) return null;
    const newline = text.indexOf('\n', offset);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(offset, newline !== -1 && text[end - 1] === '\r' ? end - 1 : end);
    offset = newline === -1 ? end : end + 1;
    return line;
  };
}

function cells(line, count) {
  if (!line?.startsWith('`') || /[\r\u0000\u0001]/.test(line)) invalidBill();
  // Each wire value is marked with a backtick, including an empty value. The
  // marker distinguishes separators from ordinary commas in descriptive values.
  const fields = line.slice(1).split(',`', count + 1);
  if (fields.length !== count) invalidBill();
  return fields;
}

function minorUnits(value, signed = false) {
  const match = YUAN.exec(value);
  if (!match || match[0] !== value || (!signed && match[1])) invalidBill();
  const [, sign, yuan, cents] = match;
  const magnitude = BigInt(yuan) * 100n + BigInt(cents);
  if (magnitude > MAX_SAFE_MINOR) invalidBill();
  return sign ? -magnitude : magnitude;
}

function visibleText(value) {
  return value.trim().length > 0 && !/[\p{Cc}\p{Cf}]/u.test(value);
}

function identifier(value) {
  return value.length <= 256 && [...value].length <= 128 && visibleText(value);
}

function matchingCount(value, expected) {
  // Older documented exports also represent integer counts with exactly one zero after the decimal point.
  return value === String(expected) || value === `${expected}.0`;
}

function readRow(line, billDate) {
  const [time, businessId, flowId, businessName, businessType, rawDirection, amount, balance, , , reference] =
    cells(line, DETAIL_COLUMNS.length);
  const accountedAt = matches(ACCOUNTING_TIME, time) && time.slice(0, 10) === billDate
    ? parsePaymentTime(time.replace(' ', 'T') + '+08:00') : null;
  const direction = DIRECTIONS.get(rawDirection);
  if (accountedAt === null || !direction || !identifier(businessId) || !identifier(flowId) ||
      !visibleText(businessName) || !visibleText(businessType) || (reference !== '' && !visibleText(reference))) invalidBill();
  return {
    accountedAt, businessId, flowId, businessName, businessType, direction, amountMinor: Number(minorUnits(amount)),
    balanceMinor: Number(minorUnits(balance, true)), merchantReference: reference === '' ? null : reference,
  };
}

export function parseWechatNativeFundBill(bytes, options) {
  const {billDate} = options ?? {};
  if (!matches(BILL_DATE, billDate) || parsePaymentTime(billDate + 'T00:00:00+08:00') === null) invalidBill();
  const nextLine = readLines(decodeBill(bytes));
  if (nextLine() !== DETAIL_HEADER) invalidBill();

  const rows = [];
  const counts = {credit: 0, debit: 0};
  const amounts = {credit: 0n, debit: 0n};
  for (let line = nextLine(); line !== SUMMARY_HEADER; line = nextLine()) {
    if (line === null || rows.length === MAX_WECHAT_FUND_BILL_ROWS) invalidBill();
    const row = readRow(line, billDate);
    rows.push(row);
    counts[row.direction]++;
    amounts[row.direction] += BigInt(row.amountMinor);
    if (amounts[row.direction] > MAX_SAFE_MINOR) invalidBill();
  }

  const [rowCount, creditCount, creditAmount, debitCount, debitAmount] = cells(nextLine(), SUMMARY_COLUMNS.length);
  if (!matchingCount(rowCount, rows.length) || !matchingCount(creditCount, counts.credit) || !matchingCount(debitCount, counts.debit) ||
      minorUnits(creditAmount) !== amounts.credit || minorUnits(debitAmount) !== amounts.debit || nextLine() !== null) invalidBill();

  return {rows, summary: {rowCount: rows.length, creditCount: counts.credit, creditAmountMinor: Number(amounts.credit),
    debitCount: counts.debit, debitAmountMinor: Number(amounts.debit)}};
}
