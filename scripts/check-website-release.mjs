#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { request } from 'node:https';
import path from 'node:path';

const assets = [
  { route: '/', file: 'index.html', type: 'text/html' },
  { route: '/styles.css', file: 'styles.css', type: 'text/css' },
  { route: '/assets/brand-shenyi.png', file: 'assets/brand-shenyi.png', type: 'image/png' },
];
const checkoutRoutes = ['/checkout', '/checkout/', '/checkout/seats/'];
const digestPattern = /^[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;
const maxBaselineBytes = 64 * 1024;
const maxAssetBytes = 32 * 1024 * 1024;

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function optionsOf(args, allowedNames) {
  const names = new Set(allowedNames);
  const values = new Map();
  if (args.length !== names.size * 2) fail('INVALID_ARGUMENTS');
  for (let i = 0; i < args.length; i += 2) {
    if (!names.has(args[i]) || !args[i + 1] || values.has(args[i])) fail('INVALID_ARGUMENTS');
    values.set(args[i], args[i + 1]);
  }
  return values;
}

function argumentsOf(args) {
  const values = optionsOf(args, ['--origin', '--baseline', '--baseline-sha256']);
  const rawOrigin = values.get('--origin');
  let url;
  try {
    url = new URL(rawOrigin);
  } catch {
    fail('INVALID_ORIGIN');
  }
  if (url.protocol !== 'https:' || rawOrigin !== url.origin || !url.hostname || url.hostname.endsWith('.')) {
    fail('INVALID_ORIGIN');
  }

  const baseline = values.get('--baseline');
  const baselineSha256 = values.get('--baseline-sha256');
  if (!path.isAbsolute(baseline) || !digestPattern.test(baselineSha256)) fail('INVALID_ARGUMENTS');
  return { origin: url.origin, baseline, baselineSha256 };
}

async function readBaseline(baseline, baselineSha256) {
  let data;
  try {
    const handle = await open(baseline, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > maxBaselineBytes) fail('INVALID_BASELINE');
      const buffer = Buffer.alloc(stat.size + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      if (total !== stat.size) fail('INVALID_BASELINE');
      data = buffer.subarray(0, total);
    } finally {
      await handle.close();
    }
  } catch {
    fail('INVALID_BASELINE');
  }
  if (createHash('sha256').update(data).digest('hex') !== baselineSha256) fail('BASELINE_DIGEST_MISMATCH');

  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } catch {
    fail('INVALID_BASELINE');
  }
  if (typeof manifest?.sourceCommit !== 'string' || !commitPattern.test(manifest.sourceCommit) ||
    !Array.isArray(manifest.assets) || manifest.assets.length !== assets.length) fail('INVALID_BASELINE');

  const checks = assets.map(spec => {
    const recorded = manifest.assets.find(row => row?.route === spec.route);
    if (!recorded || recorded.file !== spec.file ||
      !Number.isSafeInteger(recorded.bytes) || recorded.bytes < 1 || recorded.bytes > maxAssetBytes ||
      typeof recorded.sha256 !== 'string' || !digestPattern.test(recorded.sha256)) fail('INVALID_BASELINE');
    return { ...spec, bytes: recorded.bytes, sha256: recorded.sha256 };
  });
  return { sourceCommit: manifest.sourceCommit, checks };
}

async function assetFacts(directory, spec) {
  const file = path.join(directory, spec.file);
  try {
    if (path.relative(file, await realpath(file))) fail('INVALID_ASSET_FILE');
    const seen = await lstat(file, { bigint: true });
    if (!seen.isFile() || seen.size < 1n || seen.size > BigInt(maxAssetBytes)) fail('INVALID_ASSET_FILE');

    const handle = await open(file, 'r');
    try {
      const before = await handle.stat({ bigint: true });
      if (before.dev !== seen.dev || before.ino !== seen.ino || before.size !== seen.size ||
        before.mtimeNs !== seen.mtimeNs || !before.isFile()) fail('INVALID_ASSET_FILE');

      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        bytes += chunk.length;
        if (bytes > Number(before.size)) fail('INVALID_ASSET_FILE');
        hash.update(chunk);
      }
      const after = await handle.stat({ bigint: true });
      const listed = await lstat(file, { bigint: true });
      if (bytes !== Number(before.size) || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        listed.dev !== after.dev || listed.ino !== after.ino || listed.size !== after.size ||
        !listed.isFile() || path.relative(file, await realpath(file))) fail('INVALID_ASSET_FILE');
      return { route: spec.route, file: spec.file, bytes, sha256: hash.digest('hex') };
    } finally {
      await handle.close();
    }
  } catch {
    fail('INVALID_ASSET_FILE');
  }
}

async function makeBaseline(args) {
  const values = optionsOf(args, ['--make-baseline', '--source-commit']);
  const requested = values.get('--make-baseline');
  const sourceCommit = values.get('--source-commit');
  if (!path.isAbsolute(requested) || !commitPattern.test(sourceCommit)) fail('INVALID_ARGUMENTS');
  const directory = path.resolve(requested);
  try {
    if (path.relative(directory, await realpath(directory)) || !(await lstat(directory)).isDirectory()) {
      fail('INVALID_STATIC_DIRECTORY');
    }
  } catch {
    fail('INVALID_STATIC_DIRECTORY');
  }
  const files = await Promise.all(assets.map(spec => assetFacts(directory, spec)));
  console.log(JSON.stringify({ sourceCommit, assets: files }, null, 2));
}

function probe(origin, spec) {
  const { route } = spec;
  return new Promise(resolve => {
    let finished = false;
    function finish(result, response) {
      if (finished) return;
      finished = true;
      resolve({ path: route, ...result });
      response?.destroy();
    }

    const deadline = AbortSignal.timeout(5000);
    const req = request(new URL(route, origin), {
      method: 'GET',
      agent: false,
      rejectUnauthorized: true,
      signal: deadline,
      headers: { 'Accept-Encoding': 'identity' },
    }, response => {
      const httpStatus = response.statusCode;
      const leaf = response.socket.getPeerCertificate()?.fingerprint256;
      const transport = { httpStatus, tlsFingerprint256: leaf };
      if (!response.socket.authorized || !leaf) {
        finish({ status: 'failed', code: 'TLS_NOT_VERIFIED', ...transport }, response);
        return;
      }
      const interrupted = () => finish({ status: 'failed',
        code: deadline.aborted ? 'HTTPS_TIMEOUT' : 'RESPONSE_INTERRUPTED', ...transport });
      response.on('error', interrupted);
      response.on('aborted', interrupted);

      if (spec.denied) {
        finish(httpStatus === 404 ? { status: 'verified', ...transport }
          : { status: 'failed', code: 'CHECKOUT_STATUS_MISMATCH', ...transport }, response);
        return;
      }
      if (httpStatus !== 200) {
        finish({ status: 'failed', code: 'ASSET_STATUS_MISMATCH', ...transport }, response);
        return;
      }

      const type = response.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
      const encoding = response.headers['content-encoding'];
      const contentTypeMatches = response.headersDistinct['content-type']?.length === 1 && type === spec.type;
      if (!contentTypeMatches || (encoding !== undefined && encoding.toLowerCase() !== 'identity')) {
        finish({ status: 'failed', code: !contentTypeMatches ? 'CONTENT_TYPE_MISMATCH' : 'CONTENT_ENCODING_MISMATCH',
          ...transport }, response);
        return;
      }

      const hash = createHash('sha256');
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > spec.bytes) {
          finish({ status: 'failed', code: 'BODY_LENGTH_MISMATCH', ...transport }, response);
          return;
        }
        hash.update(chunk);
      });
      response.on('end', () => {
        const sha256 = hash.digest('hex');
        if (bytes !== spec.bytes || sha256 !== spec.sha256) {
          finish({ status: 'failed', code: bytes !== spec.bytes ? 'BODY_LENGTH_MISMATCH' : 'BODY_DIGEST_MISMATCH',
            ...transport, bytes, sha256 });
          return;
        }
        finish({ status: 'verified', ...transport, bytes, sha256 });
      });
    });
    req.on('error', error => {
      const transportCode = typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
        ? error.code : 'UNKNOWN';
      finish({ status: 'failed', code: deadline.aborted ? 'HTTPS_TIMEOUT' : 'HTTPS_REQUEST_FAILED',
        transportCode });
    });
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--make-baseline')) {
    await makeBaseline(args);
    return;
  }
  const { origin, baseline, baselineSha256 } = argumentsOf(args);
  const { sourceCommit, checks: expectedAssets } = await readBaseline(baseline, baselineSha256);
  const specs = [...expectedAssets, ...checkoutRoutes.map(route => ({ route, denied: true }))];
  const checks = await Promise.all(specs.map(spec => probe(origin, spec)));
  const verified = checks.every(check => check.status === 'verified');
  process.exitCode = verified ? 0 : 1;
  console.log(JSON.stringify({
    status: verified ? 'verified' : 'failed',
    mode: 'static-website',
    origin,
    sourceCommit,
    baselineSha256,
    completedAt: new Date().toISOString(),
    checks,
  }));
}

main().catch(error => {
  const expected = ['INVALID_ARGUMENTS', 'INVALID_ORIGIN', 'INVALID_BASELINE', 'BASELINE_DIGEST_MISMATCH',
    'INVALID_STATIC_DIRECTORY', 'INVALID_ASSET_FILE'];
  process.exitCode = 1;
  console.log(JSON.stringify({ status: 'failed', code: expected.includes(error.code) ? error.code : 'CHECK_FAILED' }));
});
