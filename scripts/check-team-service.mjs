#!/usr/bin/env node
import { createHash, X509Certificate } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, statfs } from 'node:fs/promises';
import { Agent, request } from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';
import { checkServerIdentity } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { loadManagedServiceConfiguration } from './start-team-service.mjs';

const deadlineMs = 5000;
const maxBodyBytes = 16 * 1024;
const maxCaBytes = 1024 * 1024;
const oneDay = 86_400_000;
const methodsRoute = '/api/auth/methods';
const defaults = { '--disk-warning-bytes': '10737418240', '--certificate-warning-days': '30' };
const pass = (measurements = {}) => ({ status: 'pass', ...measurements });
const warn = (code, measurements) => ({ status: 'warning', code, ...measurements });
const fail = (code, measurements = {}) => ({ status: 'fail', code, ...measurements });

function abort(code) { throw Object.assign(new Error(code), { code }); }

function localPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^[\\/]{2}|[\x00-\x1f\x7f]/.test(value) ||
      (process.platform === 'win32' && (!/^[a-z]:[\\/]/i.test(value) || value.slice(2).includes(':')))) abort('INVALID_CONFIGURATION');
  return path.resolve(value);
}

function sameEntry(before, after, content = false) {
  if (before.dev !== after.dev || before.ino !== after.ino) return false;
  return !content || (before.size === after.size && before.nlink === after.nlink &&
    before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs);
}

async function regularFile(filename) {
  const info = await lstat(filename, { bigint: true });
  if (!info.isFile() || info.nlink !== 1n || path.relative(filename, await realpath(filename))) abort('INVALID_CONFIGURATION');
  return info;
}

async function readBackendCa(filename) {
  const listed = await regularFile(filename);
  if (listed.size <= 0n || listed.size > BigInt(maxCaBytes)) abort('INVALID_BACKEND_CA');
  const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    if (!sameEntry(listed, await file.stat({ bigint: true }), true)) abort('INVALID_BACKEND_CA');
    const buffer = Buffer.alloc(Number(listed.size) + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await file.read(buffer, filled, buffer.length - filled);
      if (!bytesRead) break;
      filled += bytesRead;
    }
    if (BigInt(filled) !== listed.size || !sameEntry(listed, await file.stat({ bigint: true }), true) ||
        !sameEntry(listed, await regularFile(filename), true)) abort('INVALID_BACKEND_CA');
    const pem = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, filled));
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\r\nA-Za-z0-9+/=]+-----END CERTIFICATE-----/g) ?? [];
    if (!blocks.length || pem.replace(/-----BEGIN CERTIFICATE-----[\r\nA-Za-z0-9+/=]+-----END CERTIFICATE-----/g, '').trim()) abort('INVALID_BACKEND_CA');
    for (const block of blocks) new X509Certificate(block);
    return blocks;
  } finally { await file.close(); }
}

async function boundedResponse(response) {
  const leaf = response.socket.getPeerX509Certificate();
  if (!leaf || !response.socket.authorized) abort('TLS_UNTRUSTED');
  let bytes = 0;
  const parts = [];
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) abort('RESPONSE_TOO_LARGE');
    parts.push(chunk);
  }
  if (!response.complete) abort('INCOMPLETE_RESPONSE');
  return { code: response.statusCode, headers: response.headersDistinct, body: Buffer.concat(parts, bytes),
    validUntil: leaf.validToDate.getTime(),
    publicKeyHash: createHash('sha256').update(leaf.publicKey.export({ type: 'spki', format: 'der' })).digest('hex') };
}

function requestFault(error) {
  const code = error?.code ?? '';
  if (error?.name === 'AbortError') return 'REQUEST_TIMEOUT';
  if (/^(?:ERR_(?:TLS|SSL)_|CERT_|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_)/.test(code)) return 'TLS_UNTRUSTED';
  if (['TLS_UNTRUSTED', 'RESPONSE_TOO_LARGE', 'INCOMPLETE_RESPONSE'].includes(code)) return code;
  return 'REQUEST_FAILED';
}

async function probe(options, endpoint) {
  try {
    return await new Promise((resolve, reject) => {
      const outgoing = request({ ...options, path: endpoint, method: 'GET', signal: AbortSignal.timeout(deadlineMs) }, response => {
        boundedResponse(response).then(resolve, reject).finally(() => response.destroy());
      });
      outgoing.once('error', reject);
      outgoing.end();
    });
  } catch (error) { return { fault: requestFault(error) }; }
}

function jsonBody(response) {
  const types = response.headers['content-type'];
  if (types?.length !== 1 || !/^application\/json(?:\s*;|$)/i.test(types[0])) return null;
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body)); }
  catch { return null; }
}

function readiness(response) {
  if (response.fault) return fail(response.fault);
  if (response.code !== 200 || jsonBody(response)?.status !== 'ready') return fail('BACKEND_NOT_READY', { httpStatus: response.code });
  return pass();
}

function identity(response, serverId) {
  if (response.fault) return fail(response.fault);
  if (response.code !== 200) return fail('AUTH_METHODS_UNAVAILABLE', { httpStatus: response.code });
  const ids = response.headers['x-shenyi-server-id'];
  const body = jsonBody(response);
  if (ids?.length !== 1 || ids[0] !== serverId || body?.deviceBinding?.serverId !== serverId) return fail('INSTANCE_MISMATCH');
  if (body.mode !== 'managed-service' || body.methods?.demoUsername !== false || body.methods?.phonePassword !== true ||
      body.deviceBinding?.required !== true || body.deviceBinding.protocolVersion !== 1) return fail('MANAGED_DEVICE_POLICY_MISMATCH');
  return pass();
}

function hidden(response) {
  if (response.fault) return fail(response.fault);
  return response.code === 404 ? pass() : fail('PRIVATE_ROUTE_VISIBLE', { httpStatus: response.code });
}

function expiration(response, now, warningDays) {
  const remaining = response.validUntil - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return fail('CERTIFICATE_NOT_CURRENT');
  const measurements = { daysRemaining: Math.ceil(remaining / oneDay) };
  return remaining <= warningDays * oneDay ? warn('CERTIFICATE_EXPIRING', measurements) : pass(measurements);
}

function separatedKeys(backend, edge) {
  if (!backend.publicKeyHash || !edge.publicKeyHash) return fail('TLS_KEY_SEPARATION_UNCONFIRMED');
  return backend.publicKeyHash === edge.publicKeyHash ? fail('TLS_KEY_REUSED') : pass();
}

async function databaseVolume(database, threshold) {
  try {
    const before = await regularFile(database);
    const stats = await statfs(database, { bigint: true });
    if (stats.bsize <= 0n || stats.bavail < 0n || !sameEntry(before, await regularFile(database))) return fail('DATABASE_VOLUME_UNAVAILABLE');
    const available = stats.bavail * stats.bsize;
    const measurements = { availableBytes: available.toString() };
    return available < threshold ? warn('DATABASE_SPACE_LOW', measurements) : pass(measurements);
  } catch { return fail('DATABASE_VOLUME_UNAVAILABLE'); }
}

async function checkService(profile, ca, diskWarningBytes, certificateWarningDays) {
  const origin = new URL(profile.apiBase);
  const hostname = origin.hostname.replace(/^\[|\]$/g, '');
  const agent = new Agent({ keepAlive: false, maxCachedSessions: 0 });
  const options = { agent, rejectUnauthorized: true, minVersion: 'TLSv1.2', hostname,
    ...(isIP(hostname) ? {} : { servername: hostname }),
    checkServerIdentity: (_host, certificate) => checkServerIdentity(hostname, certificate),
    headers: { Host: origin.host, Accept: 'application/json' } };
  const backend = { ...options, hostname: '127.0.0.1', port: profile.listenPort, ca };
  const edge = { ...options, port: origin.port || 443 };
  try {
    const [ready, local, publicMethods, publicReady, publicHealth, volume] = await Promise.all([
      probe(backend, '/ready'), probe(backend, methodsRoute), probe(edge, methodsRoute),
      probe(edge, '/ready'), probe(edge, '/health'), databaseVolume(profile.database, diskWarningBytes),
    ]);
    const now = Date.now();
    return { backendReadiness: readiness(ready), backendIdentity: identity(local, profile.serverId),
      publicIdentity: identity(publicMethods, profile.serverId), publicReadinessHidden: hidden(publicReady), publicHealthHidden: hidden(publicHealth),
      backendCertificate: expiration(ready, now, certificateWarningDays), publicCertificate: expiration(publicMethods, now, certificateWarningDays),
      tlsKeySeparation: separatedKeys(ready, publicMethods), databaseVolume: volume };
  } finally { agent.destroy(); }
}

function parseArguments(args) {
  const values = Object.create(null);
  const allowed = ['--config', '--backend-ca', ...Object.keys(defaults)];
  for (let index = 0; index < args.length; index += 2) {
    const [name, value] = args.slice(index, index + 2);
    if (!allowed.includes(name) || Object.hasOwn(values, name) || !value || value.startsWith('--')) abort('INVALID_ARGUMENTS');
    values[name] = value;
  }
  if (!values['--config'] || !values['--backend-ca']) abort('INVALID_ARGUMENTS');
  const disk = values['--disk-warning-bytes'] ?? defaults['--disk-warning-bytes'];
  const days = values['--certificate-warning-days'] ?? defaults['--certificate-warning-days'];
  if (!/^[1-9][0-9]{0,18}$/.test(disk) || !/^[1-9][0-9]{0,2}$/.test(days) || Number(days) > 365) abort('INVALID_ARGUMENTS');
  return { configuration: localPath(values['--config']), backendCa: localPath(values['--backend-ca']), diskWarningBytes: BigInt(disk), certificateWarningDays: Number(days) };
}

async function main(args) {
  const options = parseArguments(args);
  const profile = await loadManagedServiceConfiguration(options.configuration);
  if (!profile.listenPort || [profile.database, profile.tlsKey, options.configuration].some(file => !path.relative(file, options.backendCa))) {
    abort('INVALID_CONFIGURATION');
  }
  let ca;
  try { ca = await readBackendCa(options.backendCa); } catch { abort('INVALID_BACKEND_CA'); }
  const checks = await checkService(profile, ca, options.diskWarningBytes, options.certificateWarningDays);
  const statuses = Object.values(checks).map(result => result.status);
  const status = statuses.includes('fail') ? 'failed' : statuses.includes('warning') ? 'warning' : 'healthy';
  console.log(JSON.stringify({ status, checks }));
  process.exitCode = status === 'failed' ? 1 : status === 'warning' ? 2 : 0;
}

if (process.argv[1] && !path.relative(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => {
    let code = 'INVALID_CONFIGURATION';
    if (['INVALID_ARGUMENTS', 'INVALID_BACKEND_CA'].includes(error?.code)) code = error.code;
    console.log(JSON.stringify({ status: 'failed', code }));
    process.exitCode = 1;
  });
}
