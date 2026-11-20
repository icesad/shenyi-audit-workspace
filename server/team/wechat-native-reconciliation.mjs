import {assertWechatNativeBillingReady} from './wechat-native-billing.mjs';
import {BILL_MERCHANT_ORDER_ID, MERCHANT_REFUND_ID} from './wechat-native-trade-bill-parser.mjs';
import {
  APP_ID, MERCHANT_ID, TRANSACTION_ID, boundedInteger, matches, parsePaymentTime,
} from './wechat-native-protocol.mjs';

const DAY_MS = 86_400_000;
const MAX_STATEMENT_ROWS = 100_000;
const invalid = () => {
  throw Object.assign(new Error('无法核实微信交易账单的格式或范围。'), {code:'WECHAT_NATIVE_TRADE_BILL_INVALID'});
};

const localFacts = `SELECT o.order_id, o.merchant_order_id, o.amount_minor, o.currency, o.expires_at,
  p.transaction_id, p.paid_at, f.fulfilled_at,
  EXISTS(SELECT 1 FROM main.team_billing_wechat_native_review_states r WHERE r.order_id=o.order_id AND r.state='REFUND') AS refund_seen,
  EXISTS(SELECT 1 FROM main.team_billing_wechat_native_review_states r WHERE r.order_id=o.order_id AND r.state='CLOSED') AS closed_seen,
  EXISTS(SELECT 1 FROM main.team_billing_wechat_native_lifecycle l WHERE l.order_id=o.order_id AND l.event='EXPIRED_UNSENT') AS expired_unsent
  FROM main.team_billing_wechat_native_orders o
  LEFT JOIN main.team_billing_wechat_native_payments p ON p.order_id=o.order_id
  LEFT JOIN main.team_billing_wechat_native_fulfilments f ON f.order_id=o.order_id AND f.team_id=o.team_id
  WHERE o.merchant_id=? AND o.app_id=?`;

function scopeDay(billDate) {
  if (!matches(/^\d{4}-\d{2}-\d{2}$/,billDate)) invalid();
  const startsAt = parsePaymentTime(billDate+'T00:00:00+08:00');
  if (startsAt === null) invalid();
  return {startsAt,endsAt:startsAt+DAY_MS};
}

function localView(row) {
  const paid = row.transaction_id !== null;
  const needsReview = paid && (row.paid_at>=row.expires_at || row.expired_unsent || row.refund_seen || row.closed_seen);
  return {orderId:row.order_id,amountMinor:row.amount_minor,transactionId:row.transaction_id,paidAt:row.paid_at,
    entitled:row.fulfilled_at!==null,refundObserved:Boolean(row.refund_seen),
    entitlementState:needsReview?'needs_review':row.fulfilled_at!==null?'fulfilled':paid?'pending':'unpaid'};
}

function paymentFindings(row, group) {
  const {local,currency} = group;
  const findings = [];
  if (!local) return ['ORDER_NOT_FOUND'];
  if (row.amountMinor !== local.amountMinor) findings.push('AMOUNT_MISMATCH');
  if (row.currency !== currency) findings.push('CURRENCY_MISMATCH');
  if (local.transactionId === null) findings.push('PAYMENT_NOT_RECORDED');
  else {
    if (row.transactionId !== local.transactionId) findings.push('TRANSACTION_ID_MISMATCH');
    // The bill's timestamps have no millisecond precision.
    if (row.occurredAt !== Math.floor(local.paidAt/1000)*1000) findings.push('PAID_AT_MISMATCH');
  }
  return findings;
}

function reportFromSnapshot(db, {billDate,merchantId,appId,sha1,rows,summary}, {startsAt,endsAt}) {
  const byOrder = db.prepare(localFacts+' AND o.merchant_order_id=?');
  const paidOnDay = db.prepare(localFacts+' AND p.paid_at>=? AND p.paid_at<?');
  const groups = new Map(), transactions = new Set(), refunds = new Set(), merchantRefunds = new Set();
  const counts = {statementRows:summary.rowCount,scopedRows:0,excludedRows:0,matchedPayments:0,refundRows:0,ordersWithFindings:0};

  function groupFor(merchantOrderId,currency,row) {
    if (!groups.has(merchantOrderId)) {
      if (groups.size >= MAX_STATEMENT_ROWS) invalid();
      groups.set(merchantOrderId,{merchantOrderId,currency:row?.currency??currency,local:row?localView(row):null,
        statementPayments:[],statementRefunds:[],findings:new Set()});
    }
    return groups.get(merchantOrderId);
  }

  for (const row of rows) {
    if (!row || row.merchantId!==merchantId || !matches(BILL_MERCHANT_ORDER_ID,row.merchantOrderId) ||
        !matches(TRANSACTION_ID,row.transactionId) || !boundedInteger(row.occurredAt,startsAt,endsAt-1) ||
        row.occurredAt%1000!==0) invalid();
    const scoped = row.appId===appId && row.tradeType==='NATIVE';
    const ledger = byOrder.get(merchantId,appId,row.merchantOrderId);
    if (!scoped) {
      counts.excludedRows++;
      if (ledger) groupFor(row.merchantOrderId,row.currency,ledger).findings.add('ORDER_SCOPE_MISMATCH');
      continue;
    }
    counts.scopedRows++;
    const group = groupFor(row.merchantOrderId,row.currency,ledger);
    if (row.status==='SUCCESS') {
      if (!boundedInteger(row.amountMinor,1,Number.MAX_SAFE_INTEGER) || group.statementPayments.length || transactions.has(row.transactionId)) invalid();
      transactions.add(row.transactionId);
      group.statementPayments.push({transactionId:row.transactionId,occurredAt:row.occurredAt,amountMinor:row.amountMinor,currency:row.currency});
      const findings = paymentFindings(row,group);
      if (!findings.length) counts.matchedPayments++;
      for (const finding of findings) group.findings.add(finding);
    } else if (row.status==='REFUND') {
      if (!matches(TRANSACTION_ID,row.refundId) || !matches(MERCHANT_REFUND_ID,row.merchantRefundId) ||
          !boundedInteger(row.refundAmountMinor,1,Number.MAX_SAFE_INTEGER) ||
          refunds.has(row.refundId) || merchantRefunds.has(row.merchantRefundId)) invalid();
      refunds.add(row.refundId);
      merchantRefunds.add(row.merchantRefundId);
      counts.refundRows++;
      group.statementRefunds.push({transactionId:row.transactionId,refundId:row.refundId,merchantRefundId:row.merchantRefundId,
        occurredAt:row.occurredAt,amountMinor:row.refundAmountMinor,status:row.refundStatus,currency:row.currency});
      group.findings.add('REFUND_REQUIRES_REVIEW');
      if (!group.local) group.findings.add('ORDER_NOT_FOUND');
      else {
        if (group.local.transactionId===null) group.findings.add('PAYMENT_NOT_RECORDED');
        else if (group.local.transactionId!==row.transactionId) group.findings.add('TRANSACTION_ID_MISMATCH');
        if (row.currency!==group.currency) group.findings.add('CURRENCY_MISMATCH');
        if (row.refundAmountMinor>group.local.amountMinor) group.findings.add('REFUND_AMOUNT_EXCEEDS_ORDER');
      }
    } else invalid();
  }

  for (const row of paidOnDay.iterate(merchantId,appId,startsAt,endsAt)) {
    const group = groupFor(row.merchant_order_id,row.currency,row);
    if (group.statementPayments.length===0) group.findings.add('PAYMENT_MISSING_FROM_STATEMENT');
  }
  const orders = [];
  for (const number of [...groups.keys()].sort()) {
    const group = groups.get(number);
    if (group.local?.entitlementState==='needs_review') group.findings.add('LOCAL_PAYMENT_REQUIRES_REVIEW');
    if (group.local?.entitlementState==='pending') group.findings.add('ENTITLEMENT_PENDING');
    if (group.findings.size) counts.ordersWithFindings++;
    group.statementRefunds.sort((left,right)=>left.occurredAt-right.occurredAt || (left.refundId<right.refundId?-1:1));
    orders.push({...group,findings:[...group.findings].sort()});
  }
  return {schemaVersion:1,billDate,merchantId,appId,statementSha1:sha1,counts,orders};
}

const FUNDS_PAYMENTS = new Map([['交易','payment'], ['扣除交易手续费','payment_fee']]);

function reconcileBasicFunds(db, report, {rows,summary,sha1,sha256}) {
  const payment = db.prepare(`SELECT o.merchant_order_id AS merchantOrderId, p.paid_at AS paidAt
    FROM main.team_billing_wechat_native_payments p
    JOIN main.team_billing_wechat_native_orders o ON o.order_id=p.order_id AND o.merchant_id=p.merchant_id
    WHERE p.merchant_id=? AND p.transaction_id=? AND o.app_id=?`);
  const {merchantId,appId} = report;
  const refundsById = new Map(), refundsByReference = new Map();
  for (const order of report.orders) {
    if (order.currency!=='CNY' || order.findings.includes('ORDER_SCOPE_MISMATCH')) continue;
    for (const refund of order.statementRefunds) {
      if (order.local?.transactionId!==refund.transactionId || refund.currency!=='CNY' ||
          refund.occurredAt<Math.floor(order.local.paidAt/1000)*1000 ||
          refund.amountMinor>order.local.amountMinor) continue;
      const candidate = {...refund,merchantOrderId:order.merchantOrderId};
      refundsById.set(refund.refundId,candidate);
      refundsByReference.set(refund.merchantRefundId,candidate);
    }
  }
  const entries = [];
  for (const {accountedAt,businessId,flowId,businessName,businessType,direction,amountMinor,merchantReference} of rows) {
    const paymentKind = businessName==='交易' && FUNDS_PAYMENTS.get(businessType);
    const isRefund = businessName==='退款' && businessType==='退款' && direction==='debit';
    if (paymentKind && direction===(paymentKind==='payment'?'credit':'debit') && matches(TRANSACTION_ID,businessId)) {
      const order = payment.get(merchantId,businessId,appId);
      if (order && accountedAt>=Math.floor(order.paidAt/1000)*1000 &&
          merchantReference===order.merchantOrderId) {
        entries.push({kind:paymentKind,accountedAt,flowId,direction,amountMinor,
          merchantOrderId:order.merchantOrderId,transactionId:businessId});
      }
    } else if (isRefund) {
      const byId = refundsById.get(businessId);
      const byReference = refundsByReference.get(merchantReference);
      // A refund posting can carry either the refund ID or the original payment ID.
      const candidate = byId ?? (byReference?.transactionId===businessId ? byReference : null);
      if (candidate && candidate===byReference && accountedAt>=candidate.occurredAt) {
        const {merchantOrderId,transactionId,refundId,merchantRefundId} = candidate;
        entries.push({kind:'refund',accountedAt,flowId,direction,amountMinor,merchantOrderId,
          transactionId,refundId,merchantRefundId});
      }
    }
  }
  return {accountType:'BASIC',statementSha1:sha1,statementSha256:sha256,summary,linkedRows:entries.length,
    unlinkedRows:summary.rowCount-entries.length,entries};
}

function refundOutsideScope() {
  throw Object.assign(new Error('这笔退款缺少可与微信核对的本地原单或可信交易记录。'),
    {code:'WECHAT_NATIVE_REFUND_NOT_IN_SCOPE'});
}

/** Selects one refund from the verified bill and ties it to the read-only ledger snapshot. */
export function selectWechatNativeRefundQuery(report, rows, merchantRefundId) {
  const selected = rows.filter(row => row.status==='REFUND' && row.merchantRefundId===merchantRefundId);
  if (selected.length!==1) refundOutsideScope();
  const [row] = selected;
  if (row.merchantId!==report.merchantId || row.appId!==report.appId || row.tradeType!=='NATIVE') refundOutsideScope();

  const group = report.orders.find(order => order.merchantOrderId===row.merchantOrderId);
  const local = group?.local;
  // Statement timestamps have second precision. A refund cannot precede the local verified payment.
  if (!local || group.findings.includes('ORDER_SCOPE_MISMATCH') || local.transactionId!==row.transactionId ||
      !Number.isSafeInteger(local.paidAt) || Math.floor(local.paidAt/1000)*1000>row.occurredAt ||
      group.currency!=='CNY' || row.currency!==group.currency || row.refundAmountMinor>local.amountMinor) refundOutsideScope();
  return {
    merchantRefundId, refundId:row.refundId, merchantOrderId:row.merchantOrderId, transactionId:row.transactionId,
    amountMinor:local.amountMinor, refundAmountMinor:row.refundAmountMinor, currency:row.currency,
    refundCreatedAt:row.occurredAt,statementStatus:row.refundStatus,
  };
}

/** Builds a private operator report against a single SQLite read snapshot. */
export function reconcileWechatNativeTradeBill(db, input) {
  const {billDate,merchantId,appId,sha1,rows,summary} = input;
  if (!matches(MERCHANT_ID,merchantId) || !matches(APP_ID,appId) || !matches(/^[a-f0-9]{40}$/,sha1) ||
      !Array.isArray(rows) || rows.length>MAX_STATEMENT_ROWS || summary?.rowCount!==rows.length || db.isTransaction) invalid();
  const day = scopeDay(billDate);
  db.exec('BEGIN');
  try {
    assertWechatNativeBillingReady(db);
    const report = reportFromSnapshot(db,input,day);
    if (input.basicFunds) report.basicFunds = reconcileBasicFunds(db,report,input.basicFunds);
    db.exec('COMMIT');
    return report;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
