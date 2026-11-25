import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

const STATE_NAME = 'state.json';
const MAX_STATE_BYTES = 8192n;
const POSIX = process.platform !== 'win32';
const PRIVATE_DIRECTORY = 0o700n;
const PRIVATE_FILE = 0o600n;
const noFollow = constants.O_NOFOLLOW ?? 0;
const nonBlocking = constants.O_NONBLOCK ?? 0;
const statuses = new Set(['healthy', 'warning', 'failed']);
const probeCodes = new Set(['INVALID_ARGUMENTS', 'INVALID_BACKEND_CA', 'INVALID_CONFIGURATION']);
const requestCodes = ['REQUEST_TIMEOUT', 'REQUEST_FAILED', 'TLS_UNTRUSTED', 'RESPONSE_TOO_LARGE', 'INCOMPLETE_RESPONSE'];
const identityCodes = ['AUTH_METHODS_UNAVAILABLE', 'INSTANCE_MISMATCH', 'MANAGED_DEVICE_POLICY_MISMATCH', 'REHEARSAL_ROUTE_VISIBLE'];
const facets = new Map([
  ['backendCertificate', ['CERTIFICATE_EXPIRING', 'CERTIFICATE_NOT_CURRENT']],
  ['backendIdentity', [...identityCodes, ...requestCodes]],
  ['backendReadiness', ['BACKEND_NOT_READY', ...requestCodes]],
  ['databaseVolume', ['DATABASE_SPACE_LOW', 'DATABASE_VOLUME_UNAVAILABLE']],
  ['publicCertificate', ['CERTIFICATE_EXPIRING', 'CERTIFICATE_NOT_CURRENT']],
  ['publicHealthHidden', ['PRIVATE_ROUTE_VISIBLE', ...requestCodes]],
  ['publicIdentity', [...identityCodes, ...requestCodes]],
  ['publicReadinessHidden', ['PRIVATE_ROUTE_VISIBLE', ...requestCodes]],
  ['tlsKeySeparation', ['TLS_KEY_SEPARATION_UNCONFIRMED', 'TLS_KEY_REUSED']],
]);
const warnings = new Set(['CERTIFICATE_EXPIRING', 'DATABASE_SPACE_LOW']);

function unavailable() {
  return Object.assign(new Error('监控状态文件暂不可用。'), { code: 'MONITOR_STATE_UNAVAILABLE' });
}

function requireState(condition) {
  if (!condition) throw unavailable();
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function issueCode(facet, status, code) {
  if (facet === 'probe') return status === 'fail' && probeCodes.has(code);
  return facets.get(facet)?.includes(code) && (status === 'warning') === warnings.has(code);
}

function reportIssues(report) {
  requireState(object(report) && statuses.has(report.status) && (report.checks === undefined || object(report.checks)));
  const issues = [];
  for (const facet of facets.keys()) {
    if (!Object.hasOwn(report.checks ?? {}, facet)) continue;
    const check = report.checks[facet];
    requireState(object(check) && ['pass', 'warning', 'fail'].includes(check.status));
    if (check.status !== 'pass') {
      issues.push({ facet, status: check.status, ...(issueCode(facet, check.status, check.code) ? { code: check.code } : {}) });
    }
  }
  if (report.status === 'failed' && issueCode('probe', 'fail', report.code)) {
    issues.push({ facet: 'probe', status: 'fail', code: report.code });
  }
  requireState(consistentIssues(report.status, issues));
  return issues.sort((left, right) => left.facet < right.facet ? -1 : left.facet > right.facet ? 1 : 0);
}

function consistentIssues(status, issues) {
  if (status === 'healthy') return issues.length === 0;
  if (status === 'warning') return issues.every(issue => issue.status === 'warning');
  return true;
}

function eventFor(previous, status) {
  if (previous === null) return status === 'healthy' ? 'initialized' : 'opened';
  if (status === 'healthy') return previous === 'healthy' ? null : 'recovered';
  return previous === 'healthy' ? 'opened' : 'changed';
}

function parseState(bytes) {
  const state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  requireState(exact(state, ['schemaVersion', 'status', 'previousStatus', 'transitionId', 'changedAt', 'event', 'issues']) &&
    state.schemaVersion === 1 && statuses.has(state.status) && (state.previousStatus === null || statuses.has(state.previousStatus)) &&
    state.event !== null && state.event === eventFor(state.previousStatus, state.status) &&
    typeof state.transitionId === 'string' && state.transitionId.length === 36 &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(state.transitionId) &&
    typeof state.changedAt === 'string' && new Date(Date.parse(state.changedAt)).toISOString() === state.changedAt && Array.isArray(state.issues));
  let prior = '';
  for (const entry of state.issues) {
    requireState(object(entry) && exact(entry, Object.hasOwn(entry, 'code') ? ['facet', 'status', 'code'] : ['facet', 'status']) &&
      (facets.has(entry.facet) || entry.facet === 'probe') && entry.facet > prior && ['warning', 'fail'].includes(entry.status) &&
      (Object.hasOwn(entry, 'code') ? issueCode(entry.facet, entry.status, entry.code) : entry.facet !== 'probe'));
    prior = entry.facet;
  }
  requireState(consistentIssues(state.status, state.issues));
  return state;
}

function sameIssues(left, right) {
  return left.length === right.length && left.every((issue, index) => {
    const other = right[index];
    return issue.facet === other.facet && issue.status === other.status && issue.code === other.code;
  });
}

function privateMode(info, mode) {
  return !POSIX || (info.uid === BigInt(process.getuid()) && (info.mode & 0o7777n) === mode);
}

function sameIdentity(before, after) {
  return before.dev === after.dev && before.ino === after.ino;
}

function sameFile(before, after) {
  return sameIdentity(before, after) && before.size === after.size && before.nlink === after.nlink &&
    before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs && before.mode === after.mode &&
    before.uid === after.uid && before.gid === after.gid;
}

async function stateFile(filename) {
  const info = await lstat(filename, { bigint: true }).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (info) requireState(info.isFile() && info.nlink === 1n && privateMode(info, PRIVATE_FILE) &&
    info.size > 0n && info.size <= MAX_STATE_BYTES);
  return info;
}

async function checkPrevious(filename, previous) {
  const current = await stateFile(filename);
  requireState(previous ? current && sameFile(previous, current) : current === null);
}

async function readPrevious(filename) {
  const info = await stateFile(filename);
  if (!info) return { info: null, value: null };
  const file = await open(filename, constants.O_RDONLY | noFollow | nonBlocking);
  try {
    requireState(sameFile(info, await file.stat({ bigint: true })));
    const buffer = Buffer.alloc(Number(info.size) + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await file.read(buffer, filled, buffer.length - filled);
      if (!bytesRead) break;
      filled += bytesRead;
    }
    requireState(BigInt(filled) === info.size && sameFile(info, await file.stat({ bigint: true })));
    await checkPrevious(filename, info);
    return { info, value: parseState(buffer.subarray(0, filled)) };
  } finally {
    await file.close();
  }
}

async function openDirectory(value) {
  requireState(typeof value === 'string' && path.isAbsolute(value) && !/^[\\/]{2}|[\x00-\x1f\x7f]/.test(value) &&
    (POSIX || (/^[a-z]:[\\/]/i.test(value) && !value.slice(2).includes(':'))));
  const source = path.resolve(value);
  const directory = await realpath(source);
  const info = await lstat(directory, { bigint: true });
  requireState(info.isDirectory() && privateMode(info, PRIVATE_DIRECTORY));
  const handle = POSIX ? await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | noFollow) : null;
  return { source, directory, info, handle };
}

async function checkDirectory(target) {
  requireState(!path.relative(target.directory, await realpath(target.source)));
  const live = await lstat(target.directory, { bigint: true });
  requireState(live.isDirectory() && privateMode(live, PRIVATE_DIRECTORY) && sameIdentity(target.info, live));
  if (target.handle) requireState(sameIdentity(target.info, await target.handle.stat({ bigint: true })));
}

async function removeTemporary(target, filename, owned) {
  if (!owned) return;
  try {
    await checkDirectory(target);
    const live = await lstat(filename, { bigint: true });
    if (live.isFile() && live.nlink === 1n && sameIdentity(owned, live)) await unlink(filename);
  } catch {
    // A replaced path or a file already renamed must remain untouched.
  }
}

async function publish(target, filename, previous, value) {
  const temporary = path.join(target.directory, `.state-${randomUUID()}.tmp`);
  let owned;
  await checkDirectory(target);
  try {
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, Number(PRIVATE_FILE));
    try {
      owned = await file.stat({ bigint: true });
      if (POSIX) await file.chmod(Number(PRIVATE_FILE));
      const bytes = Buffer.from(JSON.stringify(value) + '\n');
      requireState(BigInt(bytes.length) <= MAX_STATE_BYTES);
      await file.writeFile(bytes);
      await file.sync();
      owned = await file.stat({ bigint: true });
    } finally {
      await file.close();
    }
    await checkDirectory(target);
    await checkPrevious(temporary, owned);
    await checkPrevious(filename, previous);
    const prepared = owned;
    await rename(temporary, filename);
    owned = null;
    await checkDirectory(target);
    const installed = await stateFile(filename);
    requireState(installed && sameIdentity(prepared, installed) && prepared.size === installed.size &&
      prepared.mtimeNs === installed.mtimeNs);
    await target.handle?.sync();
  } finally {
    await removeTemporary(target, temporary, owned);
  }
}

export async function recordTeamMonitorObservation(directory, report, now = Date.now) {
  let target;
  try {
    const issues = reportIssues(report);
    const { status } = report;
    target = await openDirectory(directory);
    await checkDirectory(target);
    const filename = path.join(target.directory, STATE_NAME);
    const { info, value: previous } = await readPrevious(filename);
    const changed = !previous || previous.status !== status || !sameIssues(previous.issues, issues);
    let state = previous;
    if (changed) {
      const time = now();
      requireState(Number.isSafeInteger(time) && time >= 0);
      const previousStatus = previous?.status ?? null;
      state = { schemaVersion: 1, status, previousStatus, transitionId: randomUUID(), changedAt: new Date(time).toISOString(),
        event: eventFor(previousStatus, status), issues };
      await publish(target, filename, info, state);
    } else {
      await checkDirectory(target);
      await checkPrevious(filename, info);
    }
    const { transitionId, changedAt, previousStatus, event } = state;
    return { transitionId, changedAt, previousStatus, changed, event, issues: state.issues };
  } catch {
    throw unavailable();
  } finally {
    await target?.handle?.close().catch(() => {});
  }
}
