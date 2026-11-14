/* Deterministic, local arithmetic checks only. Not audit evidence, an opinion, or write authority. */
(function (root) {
  'use strict';
  const VERSION = 1, MAX_ROWS = 50000, MAX_TERMS = 2000;
  const SCOPE_KEYS = ['projectId', 'entityId', 'currency', 'unit', 'periodStart', 'periodEnd', 'scale'];
  const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string' && v.length > 0 && v.length <= 300 && v.trim() === v && !/[\u0000-\u001f\u007f]/u.test(v);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function date(v) {
    return typeof v === 'string' && /^\d{4}-\d\d-\d\d$/u.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
  }
  function scopeOK(s) {
    return object(s) && SCOPE_KEYS.slice(0, 4).every(k => text(s[k])) && /^[A-Z]{3}$/u.test(s.currency) && date(s.periodStart) && date(s.periodEnd) && s.periodStart <= s.periodEnd && Number.isInteger(s.scale) && s.scale >= 0 && s.scale <= 6;
  }
  function scopeCopy(s) { return Object.fromEntries(SCOPE_KEYS.map(k => [k, s[k]])); }
  function exactMoney(value, scale) {
    if (typeof value !== 'string' || !/^[+-]?\d{1,30}(?:\.\d{1,6})?$/u.test(value)) return null;
    const negative = value[0] === '-', parts = value.replace(/^[+-]/u, '').split('.');
    if ((parts[1] || '').length > scale) return null;
    const n = BigInt(parts[0] + (parts[1] || '').padEnd(scale, '0'));
    return negative ? -n : n;
  }
  function moneyText(value, scale) {
    const sign = value < 0n ? '-' : '', digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0');
    return sign + (scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits);
  }
  function reconcile(input) {
    const checks = [], issues = [];
    const scope = object(input) && scopeOK(input.scope) ? scopeCopy(input.scope) : null;
    const ref = (dataset, row, index, field) => ({ dataset, rowId: object(row) && text(row.rowId) ? row.rowId : null, rowIndex: index, ...(field ? { field } : {}) });
    function issue(code, message, references = [], severity = 'incomplete') { issues.push({ code, severity, message, references }); }
    function check(id, label, actual, expected, references = [], ready = true) {
      const status = !ready || actual === null || expected === null ? 'incomplete' : actual === expected ? 'pass' : 'fail';
      const c = { id, label, status, references };
      if (status !== 'incomplete') Object.assign(c, { actual: moneyText(actual, scope.scale), expected: moneyText(expected, scope.scale), difference: moneyText(actual - expected, scope.scale) });
      checks.push(c); return c;
    }
    function finish() {
      const summary = { pass: 0, fail: 0, incomplete: 0 };
      for (const c of checks) summary[c.status]++;
      return { schemaVersion: VERSION, scope, checks, issues, summary, eligibleForSuggestions: checks.length > 0 && summary.fail === 0 && summary.incomplete === 0 && issues.length === 0, automaticWriteAllowed: false, auditOpinion: null };
    }
    if (!object(input) || input.schemaVersion !== VERSION || !scope) {
      issue('INVALID_INPUT_SCOPE', '需要版本 1 及明确的项目、主体、币种、金额单位、期间和小数位（0 至 6）。');
      check('scope', '数据范围', null, null); return finish();
    }
    function parseAmount(v, references) {
      const n = exactMoney(v, scope.scale);
      if (n === null) issue('UNKNOWN_AMOUNT', '金额必须是明确的十进制字符串；空白、未知、浮点数、千分号、指数或超出精度均不视为零。', references);
      return n;
    }
    function balance(v, references) {
      if (!object(v)) { issue('UNKNOWN_BALANCE', '余额需明确 signed（借正贷负）或 debit/credit 两列。', references); return null; }
      if (Object.keys(v).length === 1 && own(v, 'signed')) return parseAmount(v.signed, references);
      if (Object.keys(v).length !== 2 || !own(v, 'debit') || !own(v, 'credit')) { issue('AMBIGUOUS_BALANCE', '余额不得混用带符号值与借贷列。', references); return null; }
      const d = parseAmount(v.debit, references), c = parseAmount(v.credit, references);
      if (d === null || c === null) return null;
      if (d < 0n || c < 0n || (d !== 0n && c !== 0n)) { issue('AMBIGUOUS_BALANCE_DIRECTION', '借贷余额列须为非负且至多一方非零；负余额请明确使用 signed。', references); return null; }
      return d - c;
    }
    function dataset(name, leaf) {
      const value = input[name], start = issues.length;
      if (!object(value)) { issue('MISSING_DATASET', '缺少 ' + name + ' 数据集。'); return { value: {}, ready: false, rows: [] }; }
      if (!scopeOK(value.scope) || SCOPE_KEYS.some(k => value.scope[k] !== scope[k])) issue('SCOPE_MISMATCH', name + ' 项目/主体/币种/单位/期间/小数位须完全一致；本工具不换算或合并。');
      if (value.mappingConfirmed !== true) issue('MAPPING_UNCONFIRMED', name + ' 列映射尚未人工确认。');
      if (value.complete !== true) issue('DATASET_INCOMPLETE', name + ' 数据完整性尚未人工确认。');
      if (leaf && value.accountLevel !== 'leaf') issue('ACCOUNT_LEVEL_MIXED', name + ' 必须仅包含人工确认的末级科目，不得混加总账、汇总或小计。');
      if (!Array.isArray(value.rows) || value.rows.length === 0 || value.rows.length > MAX_ROWS) { issue('INVALID_ROWS', name + ' 需有 1 至 ' + MAX_ROWS + ' 行。'); return { value, ready: false, rows: [] }; }
      const rowIds = new Set(), accounts = new Set(value.rows.filter(object).map(r => r.accountCode));
      value.rows.forEach((r, index) => {
        const references = [ref(name, r, index)];
        if (!object(r)) { issue('INVALID_ROW', '数据行必须是对象。', references); return; }
        if (!text(r.rowId) || rowIds.has(r.rowId)) issue('ROW_ID_INVALID', '每个数据集的原 rowId 必须明确且唯一。', references);
        rowIds.add(r.rowId);
        if (own(r, 'scope') && (!scopeOK(r.scope) || SCOPE_KEYS.some(k => r.scope[k] !== scope[k]))) issue('ROW_SCOPE_MISMATCH', '行级范围与项目范围冲突。', references);
        for (const key of SCOPE_KEYS) if (own(r, key) && r[key] !== scope[key]) issue('ROW_SCOPE_MISMATCH', '行级 ' + key + ' 与项目范围冲突。', references);
        if (leaf && ((own(r, 'level') && r.level !== 'leaf') || r.isTotal === true || r.isSummary === true || (text(r.parentAccountCode) && accounts.has(r.parentAccountCode)))) issue('ACCOUNT_LEVEL_MIXED', '包含汇总/非末级行，或同一集合包含父科目及子科目。', references);
      });
      return { value, rows: value.rows, ready: issues.length === start };
    }
    const ledger = dataset('ledger', true), trial = dataset('trialBalance', true), statement = dataset('statements', false);
    check('scope', '三个数据集的范围、列映射及完整性声明', ledger.ready && trial.ready && statement.ready ? 0n : null, 0n);
    const ledgerStart = issues.length, ids = new Map(), vouchers = new Map(), movements = new Map();
    let ld = 0n, lc = 0n;
    ledger.rows.forEach((r, i) => {
      if (!object(r)) return;
      const references = [ref('ledger', r, i)];
      if (!text(r.accountCode) || !text(r.voucherId) || !text(r.lineId)) issue('LEDGER_ID_MISSING', '需明确科目编码、期间内唯一的凭证 identifier 和凭证内行 identifier。', references);
      if (!date(r.date) || r.date < scope.periodStart || r.date > scope.periodEnd) issue('LEDGER_DATE_INVALID', '序时账日期无效或不在确认期间内。', references);
      const key = JSON.stringify([r.voucherId, r.lineId]);
      if (ids.has(key)) issue('DUPLICATE_LEDGER_IDENTIFIER', '重复的凭证及行 identifier，无法排除重复导入。', [...ids.get(key), ...references], 'error');
      else ids.set(key, references);
      const d = parseAmount(r.debit, [ref('ledger', r, i, 'debit')]), c = parseAmount(r.credit, [ref('ledger', r, i, 'credit')]);
      if (d === null || c === null) return;
      if (d !== 0n && c !== 0n) issue('AMBIGUOUS_LEDGER_DIRECTION', '同一序时账行借贷同时非零；请核实列映射或拆分为原始行。', references);
      const v = vouchers.get(r.voucherId) || { debit: 0n, credit: 0n, date: r.date, refs: [] };
      if (v.date !== r.date) issue('VOUCHER_DATE_CONFLICT', '同一凭证 identifier 对应不同日期，需补全凭证唯一键。', references);
      v.debit += d; v.credit += c; v.refs.push(...references); vouchers.set(r.voucherId, v);
      const a = movements.get(r.accountCode) || { debit: 0n, credit: 0n, refs: [] };
      a.debit += d; a.credit += c; a.refs.push(...references); movements.set(r.accountCode, a); ld += d; lc += c;
    });
    ledger.ready = ledger.ready && issues.length === ledgerStart;
    check('ledger.balance', '序时账期间借贷合计相等', ld, lc, [], ledger.ready);
    for (const [id, v] of vouchers) check('ledger.voucher:' + id, '凭证借贷相等：' + id, v.debit, v.credit, v.refs, ledger.ready);
    const trialStart = issues.length, accounts = new Map();
    let openingTotal = 0n, closingTotal = 0n, td = 0n, tc = 0n;
    trial.rows.forEach((r, i) => {
      if (!object(r)) return;
      const references = [ref('trialBalance', r, i)];
      if (!text(r.accountCode)) issue('ACCOUNT_CODE_MISSING', '科目余额表必须有明确科目编码。', references);
      if (accounts.has(r.accountCode)) issue('DUPLICATE_TRIAL_ACCOUNT', '同一范围内科目余额表科目重复，不能重复加总。', [...accounts.get(r.accountCode).refs, ...references], 'error');
      const opening = balance(r.opening, [ref('trialBalance', r, i, 'opening')]), closing = balance(r.closing, [ref('trialBalance', r, i, 'closing')]);
      const debit = parseAmount(r.periodDebit, [ref('trialBalance', r, i, 'periodDebit')]), credit = parseAmount(r.periodCredit, [ref('trialBalance', r, i, 'periodCredit')]);
      accounts.set(r.accountCode, { opening, closing, debit, credit, refs: references });
      check('trial.rollforward:' + r.rowId, '期末 = 期初 + 本期借方 − 本期贷方：' + r.accountCode, closing, opening === null || debit === null || credit === null ? null : opening + debit - credit, references, trial.ready);
      if (opening !== null) openingTotal += opening;
      if (closing !== null) closingTotal += closing;
      if (debit !== null) td += debit;
      if (credit !== null) tc += credit;
    });
    trial.ready = trial.ready && issues.length === trialStart;
    check('trial.openingBalance', '科目余额表期初借贷平衡', openingTotal, 0n, [], trial.ready);
    check('trial.closingBalance', '科目余额表期末借贷平衡', closingTotal, 0n, [], trial.ready);
    check('trial.movementBalance', '科目余额表本期借贷发生额平衡', td, tc, [], trial.ready);
    for (const code of new Set([...accounts.keys(), ...movements.keys()])) {
      const a = accounts.get(code), m = movements.get(code), references = [...(a ? a.refs : []), ...(m ? m.refs : [])];
      if (!a) issue('LEDGER_ACCOUNT_NOT_IN_TRIAL', '序时账科目 ' + code + ' 未在末级科目余额表中找到。', references);
      // Absence of a movement is a known zero ONLY in an explicitly complete, validated ledger.
      check('ledger.trialDebit:' + code, '序时账与余额表借方发生额：' + code, m ? m.debit : 0n, a ? a.debit : null, references, ledger.ready && trial.ready);
      check('ledger.trialCredit:' + code, '序时账与余额表贷方发生额：' + code, m ? m.credit : 0n, a ? a.credit : null, references, ledger.ready && trial.ready);
    }
    const statementStart = issues.length, lines = new Map();
    statement.rows.forEach((r, i) => {
      if (!object(r)) return;
      const references = [ref('statements', r, i)];
      if (!text(r.lineId) || lines.has(r.lineId)) issue('STATEMENT_LINE_ID_INVALID', '财报行 lineId 必须明确且唯一。', references);
      lines.set(r.lineId, { opening: parseAmount(r.opening, [ref('statements', r, i, 'opening')]), closing: parseAmount(r.closing, [ref('statements', r, i, 'closing')]), refs: references });
    });
    statement.ready = statement.ready && issues.length === statementStart;
    const maps = new Map();
    if (!Array.isArray(input.statementMappings) || input.statementMappings.length === 0 || input.statementMappings.length > MAX_ROWS) issue('STATEMENT_MAPPING_MISSING', '需人工逐行确认财报到科目余额表的显式科目映射。');
    else for (const m of input.statementMappings) {
      const start = issues.length, line = object(m) ? lines.get(m.lineId) : null, references = line ? [...line.refs] : [];
      if (!object(m) || !text(m.lineId) || maps.has(m.lineId) || !line || m.confirmed !== true) {
        issue('STATEMENT_MAPPING_INVALID', '财报映射需唯一 lineId、存在的财报行及人工确认。', references); continue;
      }
      const used = new Set(); let opening = 0n, closing = 0n, valid = true;
      if (!Array.isArray(m.terms) || m.terms.length === 0 || m.terms.length > MAX_TERMS) { issue('STATEMENT_TERMS_MISSING', '映射需明确 1 至 ' + MAX_TERMS + ' 个末级科目及正负方向。', references); valid = false; }
      else for (const term of m.terms) {
        const a = object(term) ? accounts.get(term.accountCode) : null;
        if (!object(term) || !text(term.accountCode) || ![1, -1].includes(term.sign) || used.has(term.accountCode) || !a) {
          issue('STATEMENT_TERM_INVALID', '映射包含未知/重复科目或不明确的正负方向。', references); valid = false; continue;
        }
        used.add(term.accountCode); references.push(...a.refs);
        if (a.opening === null || a.closing === null) valid = false;
        else { opening += a.opening * BigInt(term.sign); closing += a.closing * BigInt(term.sign); }
      }
      valid = valid && issues.length === start;
      maps.set(m.lineId, { valid, accounts: used });
      check('statement.mappingOpening:' + m.lineId, '财报期初与明确科目映射：' + m.lineId, line.opening, opening, references, valid && statement.ready && trial.ready);
      check('statement.mappingClosing:' + m.lineId, '财报期末与明确科目映射：' + m.lineId, line.closing, closing, references, valid && statement.ready && trial.ready);
    }
    for (const [id, line] of lines) if (!maps.has(id)) {
      issue('STATEMENT_MAPPING_MISSING', '财报行 ' + id + ' 尚无人工确认的映射。', line.refs);
      check('statement.mapping:' + id, '财报映射缺失：' + id, null, null, line.refs);
    }
    const eq = input.balanceEquation, eqRefs = [], eqLines = new Set(), eqAccounts = new Set();
    let eqReady = statement.ready, eqOpening = 0n, eqClosing = 0n;
    if (!object(eq) || eq.confirmed !== true) { issue('BALANCE_EQUATION_UNCONFIRMED', '资产负债恒等式必须由用户明确确认行号；不按名称猜测。'); eqReady = false; }
    for (const [category, sign] of [['assets', 1n], ['liabilities', -1n], ['equity', -1n]]) {
      const items = object(eq) ? eq[category] : null;
      if (!Array.isArray(items) || items.length === 0 || items.length > MAX_TERMS) { issue('BALANCE_EQUATION_LINES_MISSING', category + ' 必须明确选择互不重复的财报行。'); eqReady = false; continue; }
      for (const id of items) {
        const line = lines.get(id), mapping = maps.get(id);
        if (!text(id) || eqLines.has(id) || !line) { issue('BALANCE_EQUATION_LINE_INVALID', '恒等式含重复或不存在的行号。'); eqReady = false; continue; }
        eqLines.add(id); eqRefs.push(...line.refs);
        if (!mapping || !mapping.valid) eqReady = false;
        else for (const code of mapping.accounts) {
          if (eqAccounts.has(code)) { issue('BALANCE_EQUATION_OVERLAP', '恒等式选择的行包含重复科目，可能同时加总总计和明细。', line.refs); eqReady = false; }
          eqAccounts.add(code);
        }
        if (line.opening === null || line.closing === null) eqReady = false;
        else { eqOpening += sign * line.opening; eqClosing += sign * line.closing; }
      }
    }
    check('statement.balanceEquationOpening', '财报期初资产 = 负债 + 权益', eqOpening, 0n, eqRefs, eqReady);
    check('statement.balanceEquationClosing', '财报期末资产 = 负债 + 权益', eqClosing, 0n, eqRefs, eqReady);
    return finish();
  }
  function createInputTemplate(scope) {
    const s = scopeOK(scope) ? scopeCopy(scope) : { projectId: '', entityId: '', currency: 'CNY', unit: '元', periodStart: '', periodEnd: '', scale: 2 };
    const section = leaf => ({ scope: { ...s }, mappingConfirmed: false, complete: false, ...(leaf ? { accountLevel: 'leaf' } : {}) });
    return {
      schemaVersion: VERSION, scope: s,
      ledger: { ...section(true), rows: [{ rowId: 'ledger:1', voucherId: '', lineId: '', date: '', accountCode: '', debit: '', credit: '' }] },
      trialBalance: { ...section(true), rows: [{ rowId: 'trial:1', accountCode: '', opening: { signed: '' }, periodDebit: '', periodCredit: '', closing: { signed: '' } }] },
      statements: { ...section(false), rows: [{ rowId: 'statement:1', lineId: '', opening: '', closing: '' }] },
      statementMappings: [{ lineId: '', confirmed: false, terms: [{ accountCode: '', sign: 1 }] }],
      balanceEquation: { confirmed: false, assets: [], liabilities: [], equity: [] }
    };
  }
  function templateDownload(scope) { return { filename: '审易-账表校验-人工映射输入模板.json', mimeType: 'application/json;charset=utf-8', content: JSON.stringify(createInputTemplate(scope), null, 2) + '\n' }; }
  const api = Object.freeze({ schemaVersion: VERSION, reconcile, createInputTemplate, templateDownload });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AuditReconciliation = api;
})(typeof globalThis === 'object' ? globalThis : this);
