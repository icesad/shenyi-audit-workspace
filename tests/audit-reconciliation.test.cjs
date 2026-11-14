'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const A = require('../dist/audit-reconciliation.js');
const clone = x => JSON.parse(JSON.stringify(x));
function valid() {
  const scope = { projectId: 'synthetic-project', entityId: 'synthetic-entity', currency: 'CNY', unit: '元', periodStart: '2025-01-01', periodEnd: '2025-12-31', scale: 2 };
  const section = () => ({ scope: { ...scope }, mappingConfirmed: true, complete: true, accountLevel: 'leaf' });
  return {
    schemaVersion: 1, scope,
    ledger: { ...section(), rows: [
      { rowId: 'L1', voucherId: '2025-记-001', lineId: '1', date: '2025-02-01', accountCode: 'asset', debit: '20.00', credit: '0.00' },
      { rowId: 'L2', voucherId: '2025-记-001', lineId: '2', date: '2025-02-01', accountCode: 'liability', debit: '0.00', credit: '20.00' }
    ] },
    trialBalance: { ...section(), rows: [
      { rowId: 'T1', accountCode: 'asset', opening: { debit: '100.00', credit: '0.00' }, periodDebit: '20.00', periodCredit: '0.00', closing: { signed: '120.00' } },
      { rowId: 'T2', accountCode: 'liability', opening: { signed: '-40.00' }, periodDebit: '0.00', periodCredit: '20.00', closing: { debit: '0.00', credit: '60.00' } },
      { rowId: 'T3', accountCode: 'equity', opening: { signed: '-60.00' }, periodDebit: '0.00', periodCredit: '0.00', closing: { signed: '-60.00' } }
    ] },
    statements: { ...section(), rows: [
      { rowId: 'S1', lineId: 'assets-total', opening: '100.00', closing: '120.00' },
      { rowId: 'S2', lineId: 'liabilities-total', opening: '40.00', closing: '60.00' },
      { rowId: 'S3', lineId: 'equity-total', opening: '60.00', closing: '60.00' }
    ] },
    statementMappings: [
      { lineId: 'assets-total', confirmed: true, terms: [{ accountCode: 'asset', sign: 1 }] },
      { lineId: 'liabilities-total', confirmed: true, terms: [{ accountCode: 'liability', sign: -1 }] },
      { lineId: 'equity-total', confirmed: true, terms: [{ accountCode: 'equity', sign: -1 }] }
    ],
    balanceEquation: { confirmed: true, assets: ['assets-total'], liabilities: ['liabilities-total'], equity: ['equity-total'] }
  };
}
const check = (r, id) => { const c = r.checks.find(c => c.id === id); assert.ok(c, id); return c; };
const issue = (r, code) => assert.ok(r.issues.some(i => i.code === code), code);
function result(mutator) { const x = valid(); mutator(x); return A.reconcile(x); }
test('complete synthetic balance is technically eligible, JSON safe, immutable, and never an audit opinion/write authority', () => {
  const x = valid(), before = clone(x), r = A.reconcile(x);
  assert.equal(r.eligibleForSuggestions, true); assert.equal(r.automaticWriteAllowed, false); assert.equal(r.auditOpinion, null);
  assert.equal(r.summary.fail, 0); assert.equal(r.summary.incomplete, 0); assert.deepEqual(r.issues, []);
  assert.deepEqual(x, before); assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  assert.equal(check(r, 'ledger.trialDebit:equity').actual, '0.00', 'complete ledger absence is a known no-movement, unlike a blank');
  assert.ok(check(r, 'ledger.trialDebit:asset').references.some(x => x.rowId === 'L1'));
  assert.ok(check(r, 'statement.mappingClosing:assets-total').references.some(x => x.rowId === 'T1'));
});
test('valid browser global has no I/O, DOM, storage, or fetch dependency', () => {
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(require.resolve('../dist/audit-reconciliation.js'), 'utf8'), context);
  assert.equal(typeof context.AuditReconciliation.reconcile, 'function'); assert.equal(context.AuditReconciliation.reconcile(valid()).eligibleForSuggestions, true);
});
test('malformed input and missing scopes return incomplete, never pass', () => {
  for (const x of [null, undefined, [], {}, { schemaVersion: 1, scope: {} }, { ...valid(), schemaVersion: 2 }]) {
    const r = A.reconcile(x); assert.equal(r.eligibleForSuggestions, false); assert.equal(check(r, 'scope').status, 'incomplete');
  }
  issue(result(x => { delete x.ledger.scope; }), 'SCOPE_MISMATCH');
});
test('blank, unknown, numeric floating, nonfinite, grouping/exponent and excessive precision never become zero', () => {
  for (const value of ['', ' ', null, undefined, '未知', 0, 0.1, NaN, Infinity, '1,000', '1e2', '0.001', '0.000']) {
    const r = result(x => { x.ledger.rows[0].debit = value; });
    issue(r, 'UNKNOWN_AMOUNT'); assert.equal(r.eligibleForSuggestions, false); assert.equal(check(r, 'ledger.balance').status, 'incomplete');
  }
});
test('BigInt remains exact beyond Number safe integer and with six decimal places', () => {
  const x = valid(); x.scope.scale = 6;
  for (const d of [x.ledger, x.trialBalance, x.statements]) d.scope.scale = 6;
  x.ledger.rows[0].debit = x.ledger.rows[1].credit = x.trialBalance.rows[0].periodDebit = x.trialBalance.rows[1].periodCredit = '9007199254740993.000001';
  x.trialBalance.rows[0].closing = { signed: '9007199254741093.000001' };
  x.trialBalance.rows[1].closing = { signed: '-9007199254741033.000001' };
  x.statements.rows[0].closing = '9007199254741093.000001'; x.statements.rows[1].closing = '9007199254741033.000001';
  const r = A.reconcile(x); assert.equal(r.eligibleForSuggestions, true);
  assert.equal(check(r, 'ledger.balance').actual, '9007199254740993.000001');
  x.statements.rows[0].closing = '9007199254741093.000002';
  assert.equal(check(A.reconcile(x), 'statement.mappingClosing:assets-total').difference, '0.000001');
});
test('integer-scale money is accepted without implicit rounding', () => {
  const x = valid(); x.scope.scale = 0;
  for (const d of [x.ledger, x.trialBalance, x.statements]) { d.scope.scale = 0; d.rows = JSON.parse(JSON.stringify(d.rows).replace(/\.00"/gu, '"')); }
  assert.equal(A.reconcile(x).eligibleForSuggestions, true);
  for (const scale of [-1, 7, 1.5, '2']) assert.equal(result(x => { x.scope.scale = scale; }).eligibleForSuggestions, false);
});
test('credit balances are negative under signed convention and negative red-letter movements are preserved', () => {
  const x = valid();
  x.ledger.rows[0].debit = x.ledger.rows[1].credit = x.trialBalance.rows[0].periodDebit = x.trialBalance.rows[1].periodCredit = '-20.00';
  x.trialBalance.rows[0].closing = { signed: '80.00' }; x.trialBalance.rows[1].closing = { signed: '-20.00' };
  x.statements.rows[0].closing = '80.00'; x.statements.rows[1].closing = '20.00';
  const r = A.reconcile(x); assert.equal(r.eligibleForSuggestions, true); assert.equal(check(r, 'ledger.balance').actual, '-20.00');
});
test('ambiguous balances and ledger both-side entries are not silently netted', () => {
  for (const v of [{ signed: '100', debit: '100' }, { debit: '120', credit: '20' }, { debit: '-100', credit: '0' }, {}]) {
    const r = result(x => { x.trialBalance.rows[0].opening = v; }); assert.equal(r.eligibleForSuggestions, false); assert.equal(check(r, 'trial.openingBalance').status, 'incomplete');
  }
  issue(result(x => { x.ledger.rows[0].credit = '1'; }), 'AMBIGUOUS_LEDGER_DIRECTION');
});
test('rollforward and balance failures retain signed exact differences', () => {
  const r = result(x => { x.trialBalance.rows[0].closing = { signed: '120.01' }; });
  assert.equal(check(r, 'trial.rollforward:T1').status, 'fail'); assert.equal(check(r, 'trial.rollforward:T1').difference, '0.01');
  assert.equal(check(r, 'trial.closingBalance').status, 'fail'); assert.equal(r.eligibleForSuggestions, false);
});
test('overall balance cannot hide unbalanced individual vouchers', () => {
  const r = result(x => { x.ledger.rows[1].voucherId = 'other-voucher'; });
  assert.equal(check(r, 'ledger.balance').status, 'pass'); assert.equal(check(r, 'ledger.voucher:2025-记-001').status, 'fail');
  assert.equal(check(r, 'ledger.voucher:other-voucher').status, 'fail'); assert.equal(r.eligibleForSuggestions, false);
});
test('equal aggregate movements cannot hide per-account differences', () => {
  const r = result(x => { [x.ledger.rows[0].accountCode, x.ledger.rows[1].accountCode] = ['liability', 'asset']; });
  assert.equal(check(r, 'ledger.balance').status, 'pass'); assert.equal(check(r, 'ledger.trialDebit:asset').status, 'fail');
  assert.equal(check(r, 'ledger.trialCredit:liability').status, 'fail');
});
test('normal repeated voucher ID is legal, duplicate voucher+line is flagged with both source references', () => {
  assert.equal(A.reconcile(valid()).eligibleForSuggestions, true);
  const r = result(x => { x.ledger.rows.push({ ...x.ledger.rows[0], rowId: 'L3' }); });
  const duplicate = r.issues.find(i => i.code === 'DUPLICATE_LEDGER_IDENTIFIER');
  assert.deepEqual(duplicate.references.map(r => r.rowId), ['L1', 'L3']); assert.equal(check(r, 'ledger.balance').status, 'incomplete');
});
test('missing voucher identity, duplicate row IDs and conflicting dates block eligibility', () => {
  issue(result(x => { x.ledger.rows[0].lineId = ''; }), 'LEDGER_ID_MISSING');
  issue(result(x => { x.ledger.rows[1].rowId = 'L1'; }), 'ROW_ID_INVALID');
  issue(result(x => { x.ledger.rows[1].date = '2025-03-01'; }), 'VOUCHER_DATE_CONFLICT');
});
test('invalid or out of period dates are incomplete, not allowed through lexicographic guessing', () => {
  for (const v of ['2025-02-29', '2024-12-31', '2026-01-01', '2025/02/01', '']) issue(result(x => { x.ledger.rows[0].date = v; }), 'LEDGER_DATE_INVALID');
  assert.equal(result(x => { x.scope.periodStart = '2025-02-29'; }).eligibleForSuggestions, false);
  assert.equal(result(x => { x.scope.periodStart = '2026-01-01'; }).eligibleForSuggestions, false);
});
test('different currency/unit/entity/project/period/scale cannot be summed or silently converted', () => {
  for (const [key, value] of Object.entries({ currency: 'USD', unit: '万元', entityId: 'other', projectId: 'other', periodStart: '2025-02-01', periodEnd: '2025-11-30', scale: 3 })) {
    const r = result(x => { x.trialBalance.scope[key] = value; }); issue(r, 'SCOPE_MISMATCH'); assert.equal(check(r, 'trial.closingBalance').status, 'incomplete');
  }
  issue(result(x => { x.ledger.rows[0].currency = 'USD'; }), 'ROW_SCOPE_MISMATCH');
  issue(result(x => { x.ledger.rows[0].scope = { ...x.scope, entityId: 'other' }; }), 'ROW_SCOPE_MISMATCH');
});
test('manual mapping and completeness are strictly boolean, never inferred from balanced figures', () => {
  for (const field of ['mappingConfirmed', 'complete']) for (const v of [false, undefined, 'true', 1]) {
    const r = result(x => { x.ledger[field] = v; }); assert.equal(r.eligibleForSuggestions, false); assert.equal(check(r, 'ledger.balance').status, 'incomplete');
  }
});
test('nonleaf, mixed totals, explicit parent+child and duplicate trial accounts are rejected', () => {
  issue(result(x => { x.trialBalance.accountLevel = 'mixed'; }), 'ACCOUNT_LEVEL_MIXED');
  for (const p of [{ isTotal: true }, { isSummary: true }, { level: 'summary' }, { parentAccountCode: 'asset' }]) issue(result(x => { Object.assign(x.trialBalance.rows[1], p); }), 'ACCOUNT_LEVEL_MIXED');
  const r = result(x => { x.trialBalance.rows.push({ ...x.trialBalance.rows[0], rowId: 'T4' }); });
  issue(r, 'DUPLICATE_TRIAL_ACCOUNT'); assert.equal(check(r, 'trial.openingBalance').status, 'incomplete');
});
test('numeric-looking account prefixes are not guessed as parent relationships', () => {
  const x = valid();
  for (const d of [x.ledger, x.trialBalance]) for (const r of d.rows) r.accountCode = ({ asset: '1001', liability: '100101', equity: '3001' })[r.accountCode];
  for (const m of x.statementMappings) for (const t of m.terms) t.accountCode = ({ asset: '1001', liability: '100101', equity: '3001' })[t.accountCode];
  assert.equal(A.reconcile(x).eligibleForSuggestions, true, 'caller must honestly attest leaf scope; account prefix is not sufficient proof');
});
test('ledger account absent from trial is incomplete instead of default zero', () => {
  const r = result(x => { x.ledger.rows[0].accountCode = 'missing'; }); issue(r, 'LEDGER_ACCOUNT_NOT_IN_TRIAL');
  assert.equal(check(r, 'ledger.trialDebit:missing').status, 'incomplete');
});
test('missing statement mapping, unknown account, unconfirmed mapping and duplicate terms block automatic eligibility', () => {
  issue(result(x => { x.statementMappings = []; }), 'STATEMENT_MAPPING_MISSING');
  issue(result(x => { x.statementMappings[0].confirmed = false; }), 'STATEMENT_MAPPING_INVALID');
  issue(result(x => { x.statementMappings[0].terms[0].accountCode = 'missing'; }), 'STATEMENT_TERM_INVALID');
  issue(result(x => { x.statementMappings[0].terms.push({ accountCode: 'asset', sign: 1 }); }), 'STATEMENT_TERM_INVALID');
  issue(result(x => { x.statementMappings[0].terms[0].sign = '-1'; }), 'STATEMENT_TERM_INVALID');
  issue(result(x => { x.statementMappings[0].terms = []; }), 'STATEMENT_TERMS_MISSING');
});
test('wrong mapping sign is a numeric failure and never absolute-valued away', () => {
  const r = result(x => { x.statementMappings[1].terms[0].sign = 1; });
  assert.equal(check(r, 'statement.mappingClosing:liabilities-total').difference, '120.00'); assert.equal(r.eligibleForSuggestions, false);
});
test('a statement line mismatch identifies the original line and has no audit conclusion', () => {
  const r = result(x => { x.statements.rows[0].closing = '121.00'; });
  assert.equal(check(r, 'statement.mappingClosing:assets-total').status, 'fail');
  assert.equal(check(r, 'statement.balanceEquationClosing').difference, '1.00');
  assert.ok(check(r, 'statement.mappingClosing:assets-total').references.some(r => r.rowId === 'S1'));
  assert.equal(r.auditOpinion, null); assert.equal(r.automaticWriteAllowed, false);
});
test('statement line identifiers and blank amounts cannot pass by matching names or zero', () => {
  issue(result(x => { x.statements.rows[1].lineId = x.statements.rows[0].lineId; }), 'STATEMENT_LINE_ID_INVALID');
  const r = result(x => { x.statements.rows[0].closing = ''; }); issue(r, 'UNKNOWN_AMOUNT'); assert.equal(check(r, 'statement.balanceEquationClosing').status, 'incomplete');
});
test('balance equation requires explicit confirmed distinct line IDs and detects double-counted underlying accounts', () => {
  issue(result(x => { delete x.balanceEquation; }), 'BALANCE_EQUATION_UNCONFIRMED');
  issue(result(x => { x.balanceEquation.assets = ['unknown']; }), 'BALANCE_EQUATION_LINE_INVALID');
  issue(result(x => { x.balanceEquation.assets.push('assets-total'); }), 'BALANCE_EQUATION_LINE_INVALID');
  const r = result(x => {
    x.statements.rows.push({ ...x.statements.rows[0], rowId: 'S4', lineId: 'asset-detail' });
    x.statementMappings.push({ lineId: 'asset-detail', confirmed: true, terms: [{ accountCode: 'asset', sign: 1 }] });
    x.balanceEquation.assets.push('asset-detail');
  }); issue(r, 'BALANCE_EQUATION_OVERLAP'); assert.equal(check(r, 'statement.balanceEquationClosing').status, 'incomplete');
});
test('empty, oversized and nonobject rows are incomplete rather than vacuous pass', () => {
  for (const rows of [[], null, [null], Array(50001).fill({})]) {
    const r = result(x => { x.ledger.rows = rows; }); assert.equal(r.eligibleForSuggestions, false); assert.equal(check(r, 'ledger.balance').status, 'incomplete');
  }
});
test('downloadable input template is intentionally incomplete and independent on every call', () => {
  const x = A.createInputTemplate(valid().scope), d = A.templateDownload(valid().scope);
  assert.equal(x.ledger.mappingConfirmed, false); assert.equal(x.ledger.complete, false); assert.equal(x.ledger.rows[0].debit, '');
  assert.equal(A.reconcile(x).eligibleForSuggestions, false); assert.deepEqual(JSON.parse(d.content), x);
  assert.match(d.filename, /\.json$/u); assert.equal(d.mimeType, 'application/json;charset=utf-8');
  x.ledger.scope.unit = '万元'; assert.equal(x.scope.unit, '元'); assert.equal(A.createInputTemplate(valid().scope).ledger.scope.unit, '元');
});
