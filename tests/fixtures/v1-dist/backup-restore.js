/* v0.1 backup merge preview: no storage access and no network. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QuoteBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 10 * 1024 * 1024, MAX_RECORDS = 5000, MAX_DEPTH = 30;
  const badKey = new Set(['__proto__', 'prototype', 'constructor']);
  const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const string = (v, max = 10000) => typeof v === 'string' && v.length <= max;
  const cents = n => Number.isSafeInteger(n) && n >= 0;
  const fail = message => { throw new Error(message); };
  function size(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(s, 'utf8');
    return unescape(encodeURIComponent(s)).length;
  }
  function parse(raw, name, allowBom) {
    if (typeof raw !== 'string' || size(raw) > MAX_BYTES) fail(name + '为空、过大或不是文本');
    let result;
    try { result = JSON.parse(allowBom && raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw); }
    catch { fail(name + '不是有效 JSON'); }
    inspect(result, 0);
    return result;
  }
  function inspect(v, depth) {
    if (depth > MAX_DEPTH) fail('JSON 嵌套层级过深');
    if (typeof v === 'number' && !Number.isFinite(v)) fail('JSON 数值无效');
    if (v === null || ['string','boolean','number'].includes(typeof v)) return;
    if (Array.isArray(v)) { if (v.length > MAX_RECORDS) fail('数组过长'); for (const x of v) inspect(x, depth + 1); return; }
    if (!plain(v)) fail('JSON 结构无效');
    const keys = Object.keys(v); if (keys.length > 1000) fail('对象字段过多');
    for (const key of keys) { if (badKey.has(key)) fail('包含禁止的字段名'); inspect(v[key], depth + 1); }
  }
  function requiredStrings(v, keys) { return plain(v) && keys.every(k => string(v[k])); }
  function validateRecord(r) {
    if (!plain(r) || !string(r.id, 200) || !r.id.trim() || !string(r.savedAt, 100) || !Number.isFinite(Date.parse(r.savedAt)) ||
        !cents(r.totalCents) || r.appVersion !== '0.1' || !plain(r.snapshot) || r.snapshot.schema !== 1) fail('记录版本或基本字段无效');
    const s = r.snapshot;
    if (!requiredStrings(s.client, ['clientName','location','team','year','service','assets','revenue','profit']) ||
        !requiredStrings(s.quote, ['basis','manual','discount','extra','tax','reason'])) fail('报价快照字段无效');
    if (!Array.isArray(s.budget) || !s.budget.every(row => requiredStrings(row,['role','hours','rateYuan']))) fail('工时快照无效');
    if (!Array.isArray(s.rules) || !s.rules.every(rule => plain(rule) && string(rule.id,200) && rule.id.trim() && string(rule.name,200) &&
        string(rule.mode,50) && string(rule.basis,50) && Array.isArray(rule.tiers) && rule.tiers.every(plain))) fail('规则快照无效');
    if (!plain(r.calculation) || !plain(r.calculation.regions) || !plain(r.calculation.quote) ||
        !cents(r.calculation.quote.totalCents) || r.calculation.quote.totalCents !== r.totalCents ||
        !(r.calculation.budget === null || plain(r.calculation.budget))) fail('计算快照无效');
  }
  function validateRecords(records, label) {
    if (!Array.isArray(records) || records.length > MAX_RECORDS) fail(label + '数量或格式无效');
    const ids = new Set();
    for (const record of records) { validateRecord(record); if (ids.has(record.id)) fail(label + '包含重复记录编号'); ids.add(record.id); }
  }
  // Stable canonicalization compares object keys independent of JSON key order, but preserves arrays.
  function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (plain(v)) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canonical(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  function freeze(v) {
    if (v && typeof v === 'object') { for (const child of Object.values(v)) freeze(child); Object.freeze(v); }
    return v;
  }
  /**
   * Compare an exported envelope against the raw current localStorage value.
   * null means no existing key, not malformed storage. Returned data is detached
   * and recursively frozen. Caller must perform separate user consent and save.
   */
  function previewBackup(backupText, currentRaw) {
    if (currentRaw !== null && typeof currentRaw !== 'string') fail('当前存储必须是原始文本或 null');
    const backup = parse(backupText, '备份', true);
    if (!plain(backup) || backup.app !== 'hengdu-audit-quote' || backup.schema !== 1 ||
        !string(backup.exportedAt,100) || !Number.isFinite(Date.parse(backup.exportedAt))) fail('备份格式或版本不受支持');
    validateRecords(backup.records, '备份');
    const existing = currentRaw === null ? [] : parse(currentRaw, '当前存储', false);
    validateRecords(existing, '当前存储');
    const byId = new Map(existing.map(r => [r.id, canonical(r)]));
    const added = []; let skipped = 0;
    for (const record of backup.records) {
      if (byId.has(record.id)) { if (byId.get(record.id) !== canonical(record)) fail('记录编号冲突，未覆盖现有记录：' + record.id); skipped++; }
      else added.push(record);
    }
    if (existing.length + added.length > MAX_RECORDS) fail('合并后记录过多');
    const merged = [...existing, ...added];
    if (size(JSON.stringify(merged)) > MAX_BYTES) fail('合并后数据过大');
    return freeze({ expectedCurrentRaw: currentRaw, existingCount: existing.length, incomingCount: backup.records.length,
      addedCount: added.length, identicalCount: skipped, mergedRecords: merged });
  }
  return Object.freeze({ previewBackup, MAX_BYTES, MAX_RECORDS });
});
