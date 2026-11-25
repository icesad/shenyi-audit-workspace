'use strict';

const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {pathToFileURL} = require('node:url');
const {gzipSync} = require('node:zlib');

const repository = path.join(__dirname, '..');
const cli = path.join(repository, 'scripts/check-website-release.mjs');
const sourceCommit = '9c31347d80a9b1918f549567cd58aef21b9ef89b';
const paymentRoutes = ['/checkout', '/checkout/', '/checkout/seats/'];
const excludedRoutes = ['/api/auth/methods',
  '/api/billing/simulation/notifications', '/api/billing/simulation/payment-exceptions', '/api/billing/simulation/order-closures',
  '/api/website-checkout/context', '/api/website-checkout/orders', '/api/website-checkout/seat-context',
  '/api/website-checkout/seat-quote', '/api/website-checkout/seat-orders',
  '/ready', '/health', '/index.html', '/download', '/download/Shenyi.exe'];
const assets = [
  {route:'/', file:'index.html', contentType:'text/html; charset=utf-8', source:'website/index.html'},
  {route:'/styles.css', file:'styles.css', contentType:'text/css; charset=utf-8', source:'website/styles.css'},
  {route:'/assets/brand-shenyi.png', file:'assets/brand-shenyi.png', contentType:'image/png', source:'dist/brand-shenyi.png'},
];
const routes = [...assets.map(asset => asset.route), ...paymentRoutes, ...excludedRoutes].sort();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const cleanEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(?:NODE_|SSL_CERT|OPENSSL_|(?:HTTPS?|ALL|NO|GLOBAL_AGENT_HTTP)_PROXY$)/i.test(name)));

async function runCli(args, extraEnvironment = {}) {
  const argv = ['--dns-result-order=ipv4first', cli, ...args];
  const env = {...cleanEnvironment, NODE_DISABLE_COMPILE_CACHE:'1', ...extraEnvironment};
  const result = await new Promise(resolve => execFile(process.execPath, argv, {
    cwd:__dirname, env, windowsHide:true, timeout:15000, maxBuffer:128 * 1024,
  }, (error, stdout, stderr) => resolve({error, stdout, stderr})));
  assert.ok(!result.error || Number.isInteger(result.error.code), result.error?.message);
  assert.equal(result.error?.signal ?? null, null, result.stderr);
  const verdict = JSON.parse(result.stdout);
  return {exitCode:result.error?.code ?? 0, verdict, stdout:result.stdout};
}

function run(fixture, changes = {}) {
  const {origin = fixture.origin, baseline = fixture.baselinePath, digest = fixture.baselineSha256,
    extraCa = fixture.caPath, extraEnvironment = {}} = changes;
  return runCli(['--origin', origin, '--baseline', baseline, '--baseline-sha256', digest], {
    NODE_EXTRA_CA_CERTS:extraCa, ...extraEnvironment,
  });
}

function makeBaseline(directory, commit = sourceCommit) {
  return runCli(['--make-baseline', directory, '--source-commit', commit]);
}

async function scratch(t) {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-website-release-'));
  const cleanups = [];
  t.after(async () => {
    for (const clean of cleanups.reverse()) await clean();
    await fs.rmdir(directory);
  });
  async function write(name, contents) {
    const file = path.join(directory, name);
    await fs.writeFile(file, contents, {flag:'wx'});
    cleanups.push(() => fs.rm(file, {force:true}));
    return file;
  }
  async function mkdir(name) {
    const subdir = path.join(directory, name);
    await fs.mkdir(subdir);
    cleanups.push(() => fs.rmdir(subdir));
    return subdir;
  }
  async function linkDirectory(name, relativeTarget) {
    const link = path.join(directory, name);
    const target = path.join(directory, relativeTarget);
    await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    cleanups.push(() => fs.rm(link, {force:true}));
    assert.equal(await fs.realpath(link), await fs.realpath(target));
  }
  return {write, mkdir, linkDirectory, onCleanup:fn => cleanups.push(fn)};
}

async function releaseAssets() {
  return Promise.all(assets.map(async asset => ({
    ...asset, bytes:await fs.readFile(path.join(repository, asset.source)),
  })));
}

const expectedManifest = source => ({sourceCommit, assets:source.map(asset => ({
  route:asset.route, file:asset.file, bytes:asset.bytes.length, sha256:sha256(asset.bytes),
}))});

async function stage(files, payload, {missing, externalAssets = false} = {}) {
  const staged = await files.mkdir('staged site');
  if (externalAssets) {
    await files.mkdir('outside assets');
    await files.linkDirectory('staged site/assets', 'outside assets');
  } else {
    await files.mkdir('staged site/assets');
  }
  for (const asset of payload) {
    if (asset.route === missing) continue;
    const name = externalAssets && asset.file.startsWith('assets/')
      ? asset.file.replace('assets/', 'outside assets/') : `staged site/${asset.file}`;
    await files.write(name, asset.bytes);
  }
  return staged;
}

async function fixture(t, files = null) {
  files ??= await scratch(t);
  const {createOwnerReviewCheckoutCertificate} = await import(pathToFileURL(
    path.join(repository, 'scripts/owner-review-checkout-certificate.mjs')).href);
  const certificate = createOwnerReviewCheckoutCertificate();
  const alternative = createOwnerReviewCheckoutCertificate();
  const requests = [];
  const changes = new Map();
  let tcpConnections = 0;
  const [caPath, alternativeCa] = await Promise.all([
    files.write('review-ca.pem', certificate.ca), files.write('wrong-ca.pem', alternative.ca),
  ]);
  const payload = await releaseAssets();
  const baselineData = expectedManifest(payload);
  baselineData.scope = 'Only the selected static assets matter';
  baselineData.assets[0].extraReleaseNote = true;
  const baseline = Buffer.from(JSON.stringify(baselineData));
  const baselinePath = await files.write('expected-baseline.json', baseline);
  const localAssets = new Map(payload.map(asset => [asset.route, {
    status:200, contentType:asset.contentType, bytes:asset.bytes,
  }]));
  const server = https.createServer({key:certificate.key, cert:certificate.cert}, (request, response) => {
    requests.push({route:request.url, method:request.method, headers:request.headers});
    const answer = changes.get(request.url) ?? localAssets.get(request.url) ?? {
      status:404, contentType:'text/plain', bytes:Buffer.from('not public'),
    };
    response.writeHead(answer.status, {'Content-Type':answer.contentType, 'Content-Length':answer.bytes.length,
      ...(answer.location && {Location:answer.location}), ...answer.headers});
    if (answer.stallAfter) response.write(answer.bytes.subarray(0, answer.stallAfter));
    else response.end(answer.bytes);
  });
  files.onCleanup(async () => {
    if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  });
  server.on('connection', () => { tcpConnections++; });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const port = server.address().port;
  return {port, origin:`https://127.0.0.1:${port}`, caPath, alternativeCa, requests, changes, localAssets,
    write:files.write, baselinePath, baselineSha256:sha256(baseline), baselineData, payload,
    connectionCount:() => tcpConnections};
}

function checkFailure(result, {route, code, transportCode} = {}) {
  assert.equal(result.exitCode, 1, JSON.stringify(result.verdict));
  assert.equal(result.verdict.status, 'failed');
  const check = route ? result.verdict.checks.find(check => check.path === route) : result.verdict;
  if (code) assert.equal(check.code, code, JSON.stringify(check));
  if (transportCode) assert.equal(check.transportCode, transportCode, JSON.stringify(check));
}

test('valid baseline verifies the three static GETs and fixed excluded routes', async t => {
  const f = await fixture(t);
  const result = await run(f);
  assert.equal(result.exitCode, 0, JSON.stringify(result.verdict));
  assert.equal(result.verdict.status, 'verified');
  assert.equal(result.verdict.origin, f.origin);
  assert.equal(result.verdict.sourceCommit, f.baselineData.sourceCommit);
  assert.equal(result.verdict.baselineSha256, f.baselineSha256);
  assert.deepEqual(f.requests.map(request => request.route).sort(), routes);
  for (const request of f.requests) {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.host, `127.0.0.1:${f.port}`);
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers['content-length'], undefined);
  }
});

test('a baseline generated from staged files verifies the same publication over TLS', async t => {
  const files = await scratch(t);
  const f = await fixture(t, files);
  const staged = await stage(files, f.payload);
  const generated = await makeBaseline(staged);
  assert.equal(generated.exitCode, 0, JSON.stringify(generated.verdict));
  assert.equal(generated.verdict.sourceCommit, sourceCommit);
  assert.deepEqual(generated.verdict.assets, expectedManifest(f.payload).assets);
  const baseline = await files.write('generated-baseline.json', generated.stdout);
  const result = await run(f, {baseline, digest:sha256(generated.stdout)});
  assert.equal(result.exitCode, 0, JSON.stringify(result.verdict));
  assert.equal(result.verdict.status, 'verified');
  assert.equal(result.verdict.sourceCommit, sourceCommit);
  assert.deepEqual(f.requests.map(request => request.route).sort(), routes);
});

test('baseline generation refuses invalid commit IDs', async t => {
  const files = await scratch(t);
  const staged = await stage(files, await releaseAssets());
  for (const commit of ['b'.repeat(39), 'B'.repeat(40), '0'.repeat(39)+'g']) {
    checkFailure(await makeBaseline(staged, commit), {code:'INVALID_ARGUMENTS'});
  }
});

test('baseline generation refuses a staged tree missing a required file', async t => {
  const files = await scratch(t);
  const staged = await stage(files, await releaseAssets(), {missing:'/styles.css'});
  checkFailure(await makeBaseline(staged), {code:'INVALID_ASSET_FILE'});
});

test('baseline generation refuses a required asset reached through a directory link outside staging', async t => {
  const files = await scratch(t);
  const staged = await stage(files, await releaseAssets(), {externalAssets:true});
  checkFailure(await makeBaseline(staged), {code:'INVALID_ASSET_FILE'});
});

test('same-length content change is rejected over an otherwise trusted route', async t => {
  const f = await fixture(t);
  const correct = f.localAssets.get('/styles.css');
  const bytes = Buffer.from(correct.bytes);
  bytes[0] ^= 1;
  f.changes.set('/styles.css', {...correct, bytes});
  checkFailure(await run(f), {route:'/styles.css', code:'BODY_DIGEST_MISMATCH'});
  assert.ok(f.requests.some(request => request.route === '/styles.css'));
});

test('matching bytes with a wrong MIME type are rejected', async t => {
  const f = await fixture(t);
  const correct = f.localAssets.get('/assets/brand-shenyi.png');
  f.changes.set('/assets/brand-shenyi.png', {...correct, contentType:'text/html'});
  checkFailure(await run(f), {route:'/assets/brand-shenyi.png', code:'CONTENT_TYPE_MISMATCH'});
  assert.ok(f.requests.some(request => request.route === '/assets/brand-shenyi.png'));
});

test('trusted response with fewer or more bytes than the baseline is rejected', async t => {
  const f = await fixture(t);
  const correct = f.localAssets.get('/styles.css');
  for (const bytes of [correct.bytes.subarray(0, -1), Buffer.concat([correct.bytes, Buffer.alloc(64 * 1024)])]) {
    f.changes.set('/styles.css', {...correct, bytes});
    checkFailure(await run(f), {route:'/styles.css', code:'BODY_LENGTH_MISMATCH'});
  }
});

test('gzip encoding is rejected even when its decoded body matches the baseline', async t => {
  const f = await fixture(t);
  const correct = f.localAssets.get('/styles.css');
  f.changes.set('/styles.css', {...correct, bytes:gzipSync(correct.bytes), headers:{'Content-Encoding':'gzip'}});
  checkFailure(await run(f), {route:'/styles.css', code:'CONTENT_ENCODING_MISMATCH'});
});

test('a response stalls after a valid partial body and is stopped at the overall deadline', async t => {
  const f = await fixture(t);
  const correct = f.localAssets.get('/styles.css');
  f.changes.set('/styles.css', {...correct, stallAfter:128});
  const started = performance.now();
  checkFailure(await run(f), {route:'/styles.css', code:'HTTPS_TIMEOUT'});
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs >= 4500 && elapsedMs < 10000, `unexpected elapsed time: ${elapsedMs} ms`);
  assert.deepEqual(f.requests.map(request => request.route).sort(), routes);
});

for (const route of paymentRoutes) {
  test(`checkout must remain closed at ${route}`, async t => {
    const f = await fixture(t);
    f.changes.set(route, {status:200, contentType:'text/html', bytes:Buffer.from('unexpected simulated checkout')});
    checkFailure(await run(f), {route, code:'CHECKOUT_STATUS_MISMATCH'});
    assert.ok(f.requests.some(request => request.route === route));
  });
}

test('static publication refuses a cohosted API, health, direct index or download response', async t => {
  const f = await fixture(t);
  const redirected = '/download';
  const target = '/unexpected-download-target';
  const bytes = Buffer.from('private fixture must not appear in the report');
  const statuses = new Map([
    ['/api/billing/simulation/notifications', 405],
    ['/api/website-checkout/orders', 503],
    [redirected, 302],
  ]);
  for (const route of excludedRoutes) {
    f.changes.set(route, {status:statuses.get(route) ?? 200, contentType:'text/plain', bytes,
      location:route === redirected ? target : undefined});
  }
  const result = await run(f);
  checkFailure(result);
  assert.deepEqual(f.requests.map(request => request.route).sort(), routes);
  assert.ok(!f.requests.some(request => request.route === target));
  assert.ok(!result.stdout.includes(bytes.toString()));
  for (const check of result.verdict.checks) {
    if (!excludedRoutes.includes(check.path)) {
      assert.equal(check.status, 'verified', JSON.stringify(check));
      continue;
    }
    assert.equal(check.status, 'failed');
    assert.equal(check.code, 'EXCLUDED_ROUTE_STATUS_MISMATCH');
    assert.equal(check.httpStatus, statuses.get(check.path) ?? 200);
    assert.equal(check.bytes, undefined);
    assert.equal(check.sha256, undefined);
  }
});

test('redirected asset fails without following even a trusted same-origin Location', async t => {
  const f = await fixture(t);
  const trap = '/unexpected-redirect-target';
  f.changes.set('/styles.css', {status:302, contentType:'text/plain', bytes:Buffer.alloc(0), location:f.origin+trap});
  f.changes.set(trap, f.localAssets.get('/styles.css'));
  checkFailure(await run(f), {route:'/styles.css', code:'ASSET_STATUS_MISMATCH'});
  assert.ok(f.requests.some(request => request.route === '/styles.css'));
  assert.ok(!f.requests.some(request => request.route === trap));
});

test('an independent CA rejects the TLS handshake without delivering an HTTP request', async t => {
  const f = await fixture(t);
  checkFailure(await run(f, {extraCa:f.alternativeCa}), {route:'/', code:'HTTPS_REQUEST_FAILED'});
  assert.ok(f.connectionCount() > 0);
  assert.deepEqual(f.requests, []);
});

test('trusted issuer does not make a wrong certificate hostname valid', async t => {
  const f = await fixture(t);
  checkFailure(await run(f, {origin:`https://localhost:${f.port}`}), {
    route:'/', code:'HTTPS_REQUEST_FAILED', transportCode:'ERR_TLS_CERT_ALTNAME_INVALID',
  });
  assert.ok(f.connectionCount() > 0);
  assert.deepEqual(f.requests, []);
});

test('NODE_TLS_REJECT_UNAUTHORIZED cannot make an untrusted server pass', async t => {
  const f = await fixture(t);
  checkFailure(await run(f, {extraCa:f.alternativeCa, extraEnvironment:{NODE_TLS_REJECT_UNAUTHORIZED:'0'}}));
  assert.deepEqual(f.requests, []);
});

test('wrong trusted baseline digest stops before opening any connection', async t => {
  const f = await fixture(t);
  checkFailure(await run(f, {digest:'0'.repeat(64)}), {code:'BASELINE_DIGEST_MISMATCH'});
  assert.equal(f.connectionCount(), 0);
  assert.deepEqual(f.requests, []);
});

test('rehashed but invalid baselines are rejected before opening any connection', async t => {
  const f = await fixture(t);
  const variants = [
    data => { data.assets[0].route = '/unexpected-request'; },
    data => { data.assets[1].route = data.assets[0].route; },
    data => { data.assets[1].file = '../styles.css'; },
    data => { data.assets[2].bytes = -1; },
    data => { data.assets[2].sha256 = data.assets[2].sha256.toUpperCase(); },
    data => { data.assets.pop(); },
  ];
  for (const [index, mutate] of variants.entries()) {
    const invalid = structuredClone(f.baselineData);
    mutate(invalid);
    const bytes = Buffer.from(JSON.stringify(invalid));
    const baseline = await f.write(`invalid-${index}.json`, bytes);
    checkFailure(await run(f, {baseline, digest:sha256(bytes)}), {code:'INVALID_BASELINE'});
    assert.equal(f.connectionCount(), 0, `invalid baseline case ${index}`);
    assert.deepEqual(f.requests, []);
  }
});
