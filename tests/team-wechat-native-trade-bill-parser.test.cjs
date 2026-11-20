'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {gzipSync} = require('node:zlib');

const parser = import('../server/team/wechat-native-trade-bill-parser.mjs');
const billDate = '2028-02-29';
const merchantId = '1900123400';
const appId = 'wxsynthetictradebill';
const transactionId = '4200000000202802290000000000';
const merchantOrderId = 'audit_order_1234';
const refundId = '5000000000202802290000000001';
const merchantRefundId = 'refund_audit_@1234';
const keys = [
  '交易时间', '公众账号ID', '商户号', '特约商户号', '设备号', '微信订单号', '商户订单号', '用户标识',
  '交易类型', '交易状态', '付款银行', '货币种类', '应结订单金额', '代金券金额', '微信退款单号', '商户退款单号',
  '退款金额', '充值券退款金额', '退款类型', '退款状态', '商品名称', '商户数据包', '手续费', '费率',
  '订单金额', '申请退款金额', '费率备注',
];
const header = keys.join(',');
const footer = '总交易单数,应结订单总金额,退款总金额,充值券退款总金额,手续费总金额,订单总金额,申请退款总金额';
const prefixed = cells => cells.map(cell => '`' + cell).join(',');
const zeroes = ['0.00', '0.00', '0.00', '0.00', '0.00', '0.00'];
const successTotals = ['8.40', '0.00', '0.00', '0.05', '9.99', '0.00'];

function success(changes = {}) {
  const cells = [`${billDate} 00:00:00`, appId, merchantId, '0', '前台,云台', transactionId, merchantOrderId, 'PRIVATE_OPENID',
    'NATIVE', 'SUCCESS', 'OTHERS', 'CNY', '8.40', '1.59', '0', '0', '0.00', '0.00', '', '',
    '续费,项目\\n明细', 'PRIVATE_ATTACH\\ 备注,分隔', '0.05000', '0.60%', '9.99', '0.00', '试点,续费'];
  return prefixed(keys.map((key, index) => changes[key] ?? cells[index]));
}

function refund(changes = {}) {
  return success({
    交易时间: `${billDate} 23:59:59`, 公众账号ID: 'wxothersynthetic', 交易类型: 'JSAPI', 交易状态: 'REFUND',
    应结订单金额: '0.00', 代金券金额: '0.00', 微信退款单号: refundId, 商户退款单号: merchantRefundId, 退款金额: '1.20',
    充值券退款金额: '0.20', 退款类型: 'ORIGINAL', 退款状态: 'PROCESSING', 手续费: '-0.02', 订单金额: '0.00', 申请退款金额: '1.50',
    ...changes,
  });
}

function bill(rows, totals, {lineBreak = '\n', finalBreak = true, count = rows.length, billHeader = header, billFooter = footer} = {}) {
  return Buffer.from([billHeader, ...rows, billFooter, prefixed([count, ...totals]), ...(finalBreak ? [''] : [])].join(lineBreak));
}

function invalid(write) {
  assert.throws(write, error => error instanceof Error && error.code === 'WECHAT_NATIVE_TRADE_BILL_INVALID' &&
    error.message === '微信支付交易账单格式或汇总无法核验。');
}

test('projects current ALL detail rows for the whole direct merchant and verifies all footer totals', async () => {
  const {parseWechatNativeTradeBill} = await parser;
  const input = bill([success(), refund()], ['8.40', '1.20', '0.20', '0.03000', '9.99', '1.50'], {lineBreak: '\r\n'});
  const actual = parseWechatNativeTradeBill(input, {billDate, merchantId});
  assert.deepEqual(actual, {
    rows: [
      {appId, merchantId, merchantOrderId, transactionId, tradeType:'NATIVE', status:'SUCCESS',
        occurredAt:Date.parse('2028-02-28T16:00:00Z'), amountMinor:999, currency:'CNY', refundId:null,
        merchantRefundId:null, refundAmountMinor:0, refundStatus:null},
      {appId:'wxothersynthetic', merchantId, merchantOrderId, transactionId, tradeType:'JSAPI', status:'REFUND',
        occurredAt:Date.parse('2028-02-29T15:59:59Z'), amountMinor:0, currency:'CNY', refundId,
        merchantRefundId, refundAmountMinor:150, refundStatus:'PROCESSING'},
    ],
    summary: {rowCount:2, settledAmountMinor:840, refundAmountMinor:120, rechargeCouponRefundAmountMinor:20,
      feeAmountMinor:3, amountMinor:999, requestedRefundAmountMinor:150},
  });
  assert.doesNotMatch(JSON.stringify(actual), /PRIVATE_OPENID|PRIVATE_ATTACH|前台|试点/);
});

test('allows a marker-safe legacy fee, an empty verified summary, and exact safe integer cents', async () => {
  const {parseWechatNativeTradeBill} = await parser;
  const empty = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bill([], zeroes, {finalBreak: false})]);
  assert.deepEqual(parseWechatNativeTradeBill(empty, {billDate, merchantId}).rows, []);
  const amount = '90071992547409.91';
  const large = bill([success({应结订单金额: amount, 代金券金额: '0.00', 手续费: '0.00000', 订单金额: amount})],
    [amount, '0.00', '0.00', '0.00', amount, '0.00']);
  const parsed = parseWechatNativeTradeBill(new Uint8Array(large), {billDate, merchantId});
  assert.equal(parsed.rows[0].amountMinor, Number.MAX_SAFE_INTEGER);
  assert.equal(parsed.summary.amountMinor, Number.MAX_SAFE_INTEGER);
  const revoked = bill([refund({交易类型: 'MICROPAY', 交易状态: 'REVOKED', 退款状态: 'SUCCESS'})],
    ['0.00', '1.20', '0.20', '-0.02', '0.00', '1.50']);
  const nativeRevoked = parseWechatNativeTradeBill(revoked, {billDate, merchantId});
  assert.equal(nativeRevoked.rows[0].status, 'REVOKED');
  assert.equal(nativeRevoked.summary.feeAmountMinor, -2);
});

test('rejects wrong date, merchant, direct payment scope and unsupported detail state', async () => {
  const {parseWechatNativeTradeBill} = await parser;
  const check = (changes, totals = successTotals) => invalid(() => parseWechatNativeTradeBill(
    bill([success(changes)], totals), {billDate, merchantId}));
  for (const changes of [
    {交易时间: '2028-02-28 23:59:59'}, {交易时间: `${billDate} 24:00:00`}, {交易时间: `${billDate} 00:00:00.1`},
    {商户号: '1900123401'}, {特约商户号: '1900123401'}, {特约商户号: ''}, {微信订单号: '0'}, {商户订单号: ' id'},
    {交易状态: 'CLOSED'}, {交易状态: 'REVOKED'}, {货币种类: 'cny'}, {公众账号ID: 'app,id'},
    {微信退款单号: refundId}, {退款状态: 'SUCCESS'}, {订单金额: '8.39'}, {代金券金额: '10.00'},
  ]) check(changes);
  invalid(() => parseWechatNativeTradeBill(bill([], zeroes), {billDate:'2027-02-29', merchantId}));
  invalid(() => parseWechatNativeTradeBill(bill([], zeroes), {billDate, merchantId:'19001234000'}));
});

test('rejects numeric precision loss, arithmetic differences and malformed summary structure', async () => {
  const {parseWechatNativeTradeBill} = await parser;
  const reject = input => invalid(() => parseWechatNativeTradeBill(input, {billDate, merchantId}));
  for (const changes of [
    {应结订单金额: '8.401'}, {订单金额: '90071992547409.92'}, {订单金额: '9.99e0'}, {订单金额: '+9.99'},
    {手续费: '0.05001'}, {手续费: '-0.05'}, {退款金额: '0.001'}, {退款金额: '-0.00'},
  ]) reject(bill([success(changes)], successTotals));
  reject(bill([refund({退款金额:'1.60'})], ['0.00','1.60','0.20','-0.02','0.00','1.50']));
  reject(bill([refund({退款状态:'CLOSED'})], ['0.00','1.20','0.20','-0.02','0.00','1.50']));
  for (let column = 0; column < successTotals.length; column++) {
    const wrong = [...successTotals];
    wrong[column] = '0.01';
    reject(bill([success()], wrong));
  }
  reject(bill([success()], successTotals, {count: 2}));
  reject(bill([success()], successTotals, {count: '01'}));
  reject(bill([success()], successTotals, {billFooter: footer.replace('退款总金额', '退款合计')}));
  reject(bill([success()], successTotals, {billHeader: header.replace('应结订单金额', '总金额')}));
  reject(bill([success()], successTotals, {billHeader: '`' + header}));
});

test('rejects unsupported bytes, extra records, and missing receipt structure without leaking input', async () => {
  const {parseWechatNativeTradeBill, MAX_WECHAT_TRADE_BILL_BYTES} = await parser;
  const reject = input => invalid(() => parseWechatNativeTradeBill(input, {billDate, merchantId}));
  const valid = bill([success()], successTotals);
  for (const bytes of [
    valid.toString(), Buffer.alloc(0), new Uint8Array(MAX_WECHAT_TRADE_BILL_BYTES + 1), gzipSync(valid),
    Buffer.concat([valid, Buffer.from([0xff])]), Buffer.concat([valid, Buffer.from('\n')]),
    Buffer.concat([valid, Buffer.from(success())]), Buffer.from(header), Buffer.from(header + '\n' + success()),
    bill([success().slice(1)], successTotals), bill([success({商户数据包:'PRIVATE,PAYLOAD,`unexpected'})], successTotals),
  ]) reject(bytes);
});
