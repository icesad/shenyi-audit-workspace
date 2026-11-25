'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {gzipSync} = require('node:zlib');

const parser = import('../server/team/wechat-native-fund-bill-parser.mjs');
const billDate = '2028-02-29';
const columns = ['记账时间','微信支付业务单号','资金流水单号','业务名称','业务类型','收支类型','收支金额(元)','账户结余(元)',
  '资金变更提交申请人','备注','业务凭证号'];
const detailHeader = columns.join(',');
const summaryHeader = '资金流水总笔数,收入笔数,收入金额,支出笔数,支出金额';
const applicant = 'synthetic-applicant-private';
const remark = '只存在原合成流水,含转义\\r\\n，不写入对账结果';
const mark = values => values.map(value => '`' + value).join(',');

function row(overrides = {}) {
  const values = [billDate + ' 23:59:59', 'synthetic-business-0001', 'synthetic-flow-0001', '新增资金业务,测试', '未枚举细分类别',
    '收入', '0.08', '99.40', applicant, remark, 'ref-01,原始\\r\\n标记'];
  return mark(columns.map((key,index) => overrides[key] ?? values[index]));
}

function file(rows, totals = [1,1,'0.08',0,'0.00'], {
  header = detailHeader, footer = summaryHeader, finalBreak = true, eol = '\n', bom = '',
} = {}) {
  return Buffer.from([bom + header, ...rows, footer, mark(totals), ...(finalBreak ? [''] : [])].join(eol));
}

function reject(parse, bytes, options = {billDate}) {
  assert.throws(() => parse(bytes, options), error => error instanceof Error && error.code === 'WECHAT_NATIVE_FUND_BILL_INVALID' &&
    error.message === '微信支付资金账单格式或汇总无法核验。');
}

test('projects BASIC funds, preserving exact provider order and repeated IDs using Beijing accounting times', async () => {
  const {parseWechatNativeFundBill} = await parser;
  const first = row();
  const second = row({记账时间: billDate + ' 00:00:00', 微信支付业务单号:'synthetic-business-0002', 业务类型:'手续费合成分类',
    收支类型:'支出', '收支金额(元)':'12.05', '账户结余(元)':'-0.20', 资金变更提交申请人:'', 备注:'', 业务凭证号:''});
  const bytes = file([first, second, first], [3,2,'0.16',1,'12.05'], {eol:'\r\n', bom:'\ufeff'});
  const report = parseWechatNativeFundBill(bytes, {billDate});
  const credit = {
    accountedAt:Date.parse('2028-02-29T15:59:59Z'), businessId:'synthetic-business-0001', flowId:'synthetic-flow-0001',
    businessName:'新增资金业务,测试', businessType:'未枚举细分类别', direction:'credit', amountMinor:8, balanceMinor:9940,
    merchantReference:'ref-01,原始\\r\\n标记',
  };
  assert.deepEqual(report, {
    rows:[credit, {...credit, accountedAt:Date.parse('2028-02-28T16:00:00Z'), businessId:'synthetic-business-0002',
      businessType:'手续费合成分类', direction:'debit', amountMinor:1205, balanceMinor:-20, merchantReference:null}, credit],
    summary:{rowCount:3,creditCount:2,creditAmountMinor:16,debitCount:1,debitAmountMinor:1205},
  });
  assert.equal(JSON.stringify(report).includes(applicant), false);
  assert.equal(JSON.stringify(report).includes(remark), false);
});

test('accepts exact canonical integer counts and the compatible single trailing .0', async () => {
  const {parseWechatNativeFundBill} = await parser;
  const bytes = file([row()], ['1.0',1,'0.08','0.0','0.00'], {finalBreak:false});
  const result = parseWechatNativeFundBill(new Uint8Array(bytes), {billDate});
  assert.deepEqual(result.summary, {rowCount:1,creditCount:1,creditAmountMinor:8,debitCount:0,debitAmountMinor:0});
  assert.deepEqual(parseWechatNativeFundBill(file([], [0,0,'0.00',0,'0.00']), {billDate}), {
    rows:[], summary:{rowCount:0,creditCount:0,creditAmountMinor:0,debitCount:0,debitAmountMinor:0},
  });
  for (const count of ['01', '01.0', '1.00', '1.1', '+1', '1e0', '1 ']) {
    reject(parseWechatNativeFundBill, file([row()], [count,1,'0.08',0,'0.00']));
  }
});

test('converts only exact bounded cents and rejects overflow totals even when each entry is valid', async () => {
  const {parseWechatNativeFundBill} = await parser;
  const max = '90071992547409.91';
  const high = row({'收支金额(元)':max, '账户结余(元)':'-' + max});
  const exact = parseWechatNativeFundBill(file([high], [1,1,max,0,'0.00']), {billDate});
  assert.equal(exact.rows[0].amountMinor, Number.MAX_SAFE_INTEGER);
  assert.equal(exact.rows[0].balanceMinor, -Number.MAX_SAFE_INTEGER);
  assert.equal(exact.summary.creditAmountMinor, Number.MAX_SAFE_INTEGER);
  reject(parseWechatNativeFundBill, file([high, row({'收支金额(元)':'0.01'})], [2,2,max,0,'0.00']));
  reject(parseWechatNativeFundBill, file([row({收支类型:'支出', '收支金额(元)':max}), row({收支类型:'支出', '收支金额(元)':'0.01'})],
    [2,0,'0.00',2,max]));
  for (const amount of ['90071992547409.92', '0.081', '0.080', '0.8', '8e-2', ' 0.08', '+0.08', '-0.08']) {
    reject(parseWechatNativeFundBill, file([row({'收支金额(元)':amount})]));
  }
  reject(parseWechatNativeFundBill, file([row({'账户结余(元)':'-90071992547409.92'})]));
});

test('enforces the requested Beijing calendar day and the documented ID widths without guessing classifications', async () => {
  const {parseWechatNativeFundBill} = await parser;
  const unicodeId = '𠮷'.repeat(128);
  const report = parseWechatNativeFundBill(file([row({微信支付业务单号:unicodeId, 资金流水单号:'0', 业务名称:'其他平台新类'})]), {billDate});
  assert.equal(report.rows[0].businessId, unicodeId);
  assert.equal(report.rows[0].flowId, '0');
  for (const fields of [
    {记账时间:'2028-02-28 23:59:59'}, {记账时间:'2028-03-01 00:00:00'}, {记账时间:billDate + ' 24:00:00'},
    {记账时间:billDate + ' 00:00:00.1'}, {微信支付业务单号:''}, {微信支付业务单号:unicodeId + 'a'},
    {资金流水单号:'x'.repeat(129)}, {资金流水单号:'   '}, {收支类型:'credit'}, {收支类型:'其他'},
  ]) reject(parseWechatNativeFundBill, file([row(fields)]));
  reject(parseWechatNativeFundBill, file([]), {billDate:'2027-02-29'});
  reject(parseWechatNativeFundBill, file([]), {billDate:billDate + '\n'});
});

test('bounds the number of rows independently of the download size', async () => {
  const {parseWechatNativeFundBill, MAX_WECHAT_FUND_BILL_BYTES, MAX_WECHAT_FUND_BILL_ROWS} = await parser;
  const detail = row({'收支金额(元)':'0.01'});
  const lastAllowed = MAX_WECHAT_FUND_BILL_ROWS;
  const limit = file(Array(lastAllowed).fill(detail),[lastAllowed,lastAllowed,'1000.00',0,'0.00']);
  assert.equal(parseWechatNativeFundBill(limit,{billDate}).summary.rowCount,lastAllowed);
  const next = lastAllowed+1;
  const over = file(Array(next).fill(detail),[next,next,'1000.01',0,'0.00']);
  assert.ok(over.byteLength < MAX_WECHAT_FUND_BILL_BYTES);
  reject(parseWechatNativeFundBill,over);
});

test('rejects incomplete or structurally altered detail and footer without exposing input', async () => {
  const {parseWechatNativeFundBill, MAX_WECHAT_FUND_BILL_BYTES} = await parser;
  const bytes = file([row()]);
  const debit = row({收支类型:'支出', '收支金额(元)':'2.05'});
  for (const candidate of [
    bytes.toString(), Buffer.alloc(0), new Uint8Array(MAX_WECHAT_FUND_BILL_BYTES + 1), gzipSync(bytes),
    Buffer.concat([bytes,Buffer.from([0xff])]), Buffer.concat([bytes,Buffer.from('\n')]),
    Buffer.concat([bytes,Buffer.from('unexpected synthetic row')]), Buffer.from(detailHeader + '\n' + row()),
    file([row().slice(1)]), file([row({备注:'unmarked\u0001legacy'})]), file([row({备注:'raw\nnewline'})]),
    file([row({备注:'synthetic,`ambiguous delimiter'})]),
    file([row()], undefined, {header:detailHeader.replace('收支金额(元)','收支金额（元）')}),
    file([row()], undefined, {footer:summaryHeader.replace('支出笔数','其他笔数')}),
    file([row()], [1,1,'0.08',0]), file([row()], [1,1,'0.08',0,'0.00','extra']),
    file([row(),debit], [1,1,'0.08',1,'2.05']), file([row(),debit], [2,0,'0.08',2,'2.05']),
    file([row(),debit], [2,1,'0.07',1,'2.05']), file([row(),debit], [2,1,'0.08',1,'2.06']),
  ]) reject(parseWechatNativeFundBill, candidate);
});
