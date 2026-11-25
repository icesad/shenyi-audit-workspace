/* Saved ledger-check data only. No calculation, database access, or write-back. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LedgerCheckSnapshot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const FORMAT = 'shenyi-ledger-check-snapshot';
  const LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024, nodes: 1000000, depth: 30, rows: 20000 });
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const HASH = /^[a-f0-9]{64}$/;
  const ROLES = ['ledger', 'trialBalance', 'statements'];
  const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
  const crypto = typeof module === 'object' && module.exports ? require('node:crypto').webcrypto : root.crypto;
  const encoder = new TextEncoder();
  function fail() { throw Error('账表校验快照格式或来源绑定无效；原记录未修改。'); }
  const plain = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
  function exact(v, keys) {
    if (!plain(v)) fail();
    const ds = Object.getOwnPropertyDescriptors(v), names = Reflect.ownKeys(ds);
    if (names.length !== keys.length || names.some(k => typeof k !== 'string' || !keys.includes(k) || !Object.hasOwn(ds[k], 'value') || !ds[k].enumerable)) fail();
  }
  function dataOnly(value) {
    let nodes = 0, bytes = 0;
    const seen = new Set();
    function visit(v, depth) {
      if (++nodes > LIMITS.nodes || depth > LIMITS.depth) fail();
      if (v === null || typeof v === 'boolean') return;
      if (typeof v === 'string') {
        if (!v.isWellFormed()) fail();
        bytes += encoder.encode(v).length;
        if (bytes > LIMITS.bytes) fail();
        return;
      }
      if (typeof v === 'number') { if (!Number.isFinite(v) || Object.is(v, -0)) fail(); return; }
      if (typeof v !== 'object' || seen.has(v)) fail();
      seen.add(v);
      const array = Array.isArray(v);
      if (array ? Object.getPrototypeOf(v) !== Array.prototype : !plain(v)) fail();
      const ds = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(ds);
      if (array && (keys.length !== v.length + 1 || keys.some(k => k !== 'length' && (typeof k !== 'string' || !/^(?:0|[1-9]\d*)$/.test(k) || Number(k) >= v.length)))) fail();
      for (const k of keys) {
        if (array && k === 'length') continue;
        if (typeof k !== 'string' || FORBIDDEN.has(k) || !Object.hasOwn(ds[k], 'value') || !ds[k].enumerable) fail();
        visit(k, depth + 1); visit(ds[k].value, depth + 1);
      }
      seen.delete(v);
    }
    visit(value, 0);
  }
  function shape(value) {
    dataOnly(value);
    exact(value, ['format', 'schemaVersion', 'sourceProjectId', 'workspaceRevision', 'reconciliation']);
    if (value.format !== FORMAT || value.schemaVersion !== 1 || typeof value.sourceProjectId !== 'string' || !UUID.test(value.sourceProjectId) || !Number.isSafeInteger(value.workspaceRevision) || value.workspaceRevision < 1) fail();
    const r = value.reconciliation;
    exact(r, ['schemaVersion', 'input', 'columnMappings', 'sourceRefs', 'result', 'inputHash', 'mappingHash', 'calculatedAt']);
    if (r.schemaVersion !== 1 || !plain(r.input) || r.input.schemaVersion !== 1 || !plain(r.input.scope) || r.input.scope.projectId !== value.sourceProjectId || !plain(r.result) || r.result.schemaVersion !== 1 || !plain(r.result.scope) || r.result.scope.projectId !== value.sourceProjectId || !plain(r.result.summary) || !Array.isArray(r.result.checks) || !Array.isArray(r.result.issues)) fail();
    exact(r.columnMappings, ROLES); exact(r.sourceRefs, ROLES);
    for (const role of ROLES) {
      if (!plain(r.input[role]) || !plain(r.input[role].scope) || r.input[role].scope.projectId !== value.sourceProjectId || !Array.isArray(r.input[role].rows) || r.input[role].rows.length > LIMITS.rows || !plain(r.columnMappings[role]) || !plain(r.sourceRefs[role])) fail();
    }
    if (typeof r.inputHash !== 'string' || !HASH.test(r.inputHash) || typeof r.mappingHash !== 'string' || !HASH.test(r.mappingHash) || typeof r.calculatedAt !== 'string' || !Number.isFinite(Date.parse(r.calculatedAt)) || new Date(r.calculatedAt).toISOString() !== r.calculatedAt) fail();
    return value;
  }
  async function digest(text) {
    if (!crypto?.subtle) fail();
    const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(text));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  }
  function textOf(value) {
    const text = JSON.stringify(value, null, 2) + '\n';
    if (encoder.encode(text).length > LIMITS.bytes) fail();
    return text;
  }
  async function verifiedCopy(value) {
    shape(value);
    // Copy before yielding, so caller mutation during digest cannot change the
    // checked or returned snapshot. Preserve property order for legacy hashes.
    const copy = JSON.parse(textOf(value)), r = copy.reconciliation;
    const [inputHash, mappingHash] = await Promise.all([digest(JSON.stringify(r.input)), digest(JSON.stringify(r.columnMappings))]);
    if (inputHash !== r.inputHash || mappingHash !== r.mappingHash) fail();
    return copy;
  }
  async function create(input) {
    exact(input, ['projectId', 'workspaceRevision', 'reconciliation']);
    return verifiedCopy({ format: FORMAT, schemaVersion: 1, sourceProjectId: input.projectId, workspaceRevision: input.workspaceRevision, reconciliation: input.reconciliation });
  }
  async function serialize(value) { return textOf(await verifiedCopy(value)); }
  async function parse(text) {
    if (typeof text !== 'string' || !text.isWellFormed() || encoder.encode(text).length > LIMITS.bytes) fail();
    let value; try { value = JSON.parse(text); } catch { fail(); }
    shape(value);
    // Only the emitted representation is accepted: duplicate keys, altered
    // number spelling, BOMs, and unrecorded whitespace cannot be hidden by parse.
    if (textOf(value) !== text) fail();
    return verifiedCopy(value);
  }
  return Object.freeze({ FORMAT, LIMITS, create, serialize, parse });
});
