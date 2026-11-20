'use strict';
// Actual CLI against owned loopback HTTPS servers, using the same temporary
// synthetic certificates and existing OpenSSL requirement as the TLS suite.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { generateCertificates, command, childEnvironment } = require('./helpers/trusted-team-https-fixture.cjs');

const root = path.resolve(__dirname, '..');
const checker = path.join(root, 'scripts/check-team-service.mjs');
const rehearsalRoutes = [
  '/api/billing/simulation/notifications',
  '/api/billing/simulation/payment-exceptions',
  '/api/billing/simulation/order-closures',
  '/api/website-checkout/context',
  '/api/website-checkout/orders',
  '/api/website-checkout/seat-context',
  '/api/website-checkout/seat-quote',
  '/api/website-checkout/seat-orders',
];
const nativeAssets = new Map([
  ['/api/website-pay/', 'text/html; charset=utf-8'],
  ['/api/website-pay/payment.js', 'text/javascript; charset=utf-8'],
  ['/api/website-pay/payment.css', 'text/css; charset=utf-8'],
  ['/api/website-pay/base.css', 'text/css; charset=utf-8'],
  ['/api/website-pay/brand.png', 'image/png'],
]);
const nativeActions = ['order', 'code', 'check', 'close', 'quote', 'confirm'].map(action => '/api/website-pay/' + action);
const nativeNotify = '/api/billing/wechat-native/notify';
const nativeProbeMethods = new Map([
  ...[...nativeAssets.keys()].map(route => [route, 'HEAD']),
  ...[...nativeActions, nativeNotify].map(route => [route, 'GET']),
]);
const opaqueNativeResponse = 'Owned payment route response must never be printed';
const identityPass = (website = false, callback = false) => ({
  status: 'pass', rehearsalRoutesHidden: 8, nativeWebsiteMode: website ? 'enabled' : 'disabled',
  nativeCallbackMode: callback ? 'enabled' : 'disabled',
});

function nativeReply(route, fallback, website, callback) {
  if (website && nativeAssets.has(route)) {
    return { status: 200, type: nativeAssets.get(route), body: opaqueNativeResponse,
      headers: { 'cache-control': 'private, no-store, max-age=0', 'x-robots-tag': 'noindex, nofollow' } };
  }
  if ((website && nativeActions.includes(route)) || (callback && route === nativeNotify)) {
    return { status: 405, headers: { allow: 'POST' }, body: opaqueNativeResponse };
  }
  return fallback;
}

async function run(args, ca, monitorEnvironment = {}) {
  const env = childEnvironment({ NODE_EXTRA_CA_CERTS: ca });
  delete env.SHENYI_MONITOR_TRANSITIONS;
  delete env.STATE_DIRECTORY;
  Object.assign(env, monitorEnvironment);
  const result = await command(process.execPath, ['--dns-result-order=ipv4first', checker, ...args], {
    cwd: root, env, timeout: 15_000,
  });
  assert.equal(result.signal, null, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, result.stdout + result.stderr);
  return { ...result, result: JSON.parse(lines[0]) };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  return server.address().port;
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-release-check-'));
  const servers = [];
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
    await fs.rm(directory, { recursive: true, force: true });
  });
  // Separate native chains also prove the backend CA option is independent of
  // the public origin's process trust. No key material enters the checkout.
  const [backendCertificate, edgeCertificate] = await Promise.all([
    generateCertificates(path.join(directory, 'backend-certificates')),
    generateCertificates(path.join(directory, 'edge-certificates')),
  ]);
  const context = async (certificate, name = 'valid', key = name) => ({
    key: await fs.readFile(path.join(certificate.directory, key + '.key')),
    cert: await fs.readFile(path.join(certificate.directory, name + '.pem')),
  });
  const tls = { backend: await context(backendCertificate), edge: await context(edgeCertificate),
    wrongHost: await context(edgeCertificate, 'wrong-host'), expired: await context(backendCertificate, 'expired', 'valid') };
  const publicCa = path.join(directory, 'public-test-ca.pem');
  await fs.writeFile(publicCa, Buffer.concat([await fs.readFile(backendCertificate.ca), await fs.readFile(edgeCertificate.ca)]), { flag: 'wx' });
  const ca = backendCertificate.ca;
  const filename = path.join(directory, 'team-service.json');
  const state = {}, events = [];
  const serverId = crypto.randomUUID();
  const methods = () => ({ mode: 'managed-service', methods: { phonePassword: true, demoUsername: false },
    deviceBinding: { required: true, protocolVersion: 1, serverId } });
  function handler(side) {
    return (req, res) => {
      const event = { side, route: req.url, method: req.method, host: req.headers.host, servername: req.socket.servername,
        authorization: req.headers.authorization, cookie: req.headers.cookie, contentLength: req.headers['content-length'],
        transferEncoding: req.headers['transfer-encoding'],
        deviceHeaders: Object.keys(req.headers).filter(name => name.startsWith('x-shenyi-device-')), bodyBytes: 0 };
      events.push(event);
      req.on('data', chunk => { event.bodyBytes += chunk.length; });
      let answer = side === 'backend' && req.url === '/ready'
        ? { status: 200, body: { status: 'ready' } }
        : req.url === '/api/auth/methods'
          ? { status: 200, headers: { 'x-shenyi-server-id': serverId }, body: methods() }
          : { status: 404, body: '<html>Owned synthetic edge 404</html>', type: 'text/html' };
      answer = state[side]?.(req, answer) ?? answer;
      if (answer.disconnect) { req.socket.destroy(); return; }
      res.writeHead(answer.status, { 'content-type': answer.type ?? 'application/json; charset=utf-8', ...answer.headers });
      const body = typeof answer.body === 'string' || Buffer.isBuffer(answer.body) ? answer.body : JSON.stringify(answer.body);
      if (answer.hang) res.write(body);
      else res.end(body);
    };
  }
  const backend = https.createServer(tls.backend, handler('backend'));
  const edge = https.createServer(tls.edge, handler('edge'));
  servers.push(backend, edge);
  const backendPort = await listen(backend), edgePort = await listen(edge);
  const configuration = { schemaVersion: 1, database: path.join(directory, 'metadata-only.sqlite'), apiBase: `https://localhost:${edgePort}`,
    serverId, listenPort: backendPort, tlsCertificate: path.join(directory, 'must-not-open-server-cert.pem'), tlsKey: path.join(directory, 'must-not-open-server-key.pem') };
  const callbackProfile = path.join(directory, 'must-not-open-native-callback-profile.json');
  const websiteProfile = path.join(directory, 'must-not-open-native-website-profile.json');
  const databaseBytes = Buffer.from('Opaque synthetic metadata target; deliberately not a SQLite database.');
  await fs.writeFile(configuration.database, databaseBytes, { flag: 'wx' });
  const reset = async () => {
    delete state.backend; delete state.edge; events.length = 0;
    backend.setSecureContext(tls.backend); edge.setSecureContext(tls.edge);
    await fs.writeFile(filename, JSON.stringify(configuration));
  };
  await reset();
  const args = ['--config', filename, '--backend-ca', ca, '--disk-warning-bytes', '1', '--certificate-warning-days', '1'];
  async function configureNative({ website = false, callback = false } = {}) {
    await fs.writeFile(filename, JSON.stringify({ ...configuration,
      ...(website ? { wechatNativeWebsiteProfile: websiteProfile } : {}),
      ...(callback ? { wechatNativeCallbackProfile: callbackProfile } : {}) }));
    for (const side of ['backend', 'edge']) {
      state[side] = (req, answer) => nativeReply(req.url, answer, website, callback);
    }
  }
  return { directory, filename, configuration, ca, publicCa, tls, backend, edge, state, events, reset, args,
    configureNative, callbackProfile, websiteProfile, run: () => run(args, publicCa), databaseBytes };
}

function failedCheck(result, name, code) {
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.result.status, 'failed');
  assert.equal(result.result.checks[name].status, 'fail');
  assert.equal(result.result.checks[name].code, code);
}

function assertReadOnlyRequests(f) {
  for (const event of f.events) {
    assert.equal(event.method, nativeProbeMethods.get(event.route) ?? 'GET');
    assert.equal(event.host, new URL(f.configuration.apiBase).host);
    assert.equal(event.servername, 'localhost');
    assert.equal(event.authorization, undefined);
    assert.equal(event.cookie, undefined);
    assert.equal(event.contentLength, undefined);
    assert.equal(event.transferEncoding, undefined);
    assert.deepEqual(event.deviceHeaders, []);
    assert.equal(event.bodyBytes, 0);
  }
}

function assertNativeRequests(f) {
  const relevant = f.events.filter(event => nativeProbeMethods.has(event.route));
  assert.deepEqual(relevant.map(({ side, method, route }) => `${side} ${method} ${route}`).sort(),
    ['backend', 'edge'].flatMap(side => [...nativeProbeMethods].map(([route, method]) => `${side} ${method} ${route}`)).sort());
  assertReadOnlyRequests(f);
}

async function monitorDirectory(under) {
  const directory = await fs.mkdtemp(path.join(under, 'monitor-state-'));
  if (process.platform !== 'win32') await fs.chmod(directory, 0o700);
  return { directory, filename: path.join(directory, 'state.json') };
}

function monitorTransition(result, { code, status, previousStatus, event, issues }) {
  assert.equal(result.code, code, result.stdout + result.stderr);
  assert.equal(result.result.status, status);
  assert.equal(Object.hasOwn(result.result, 'monitorError'), false);
  const transition = result.result.monitor;
  assert.ok(transition, 'Missing transition report');
  assert.deepEqual(Object.keys(transition).sort(), ['changed', 'changedAt', 'event', 'issues', 'previousStatus', 'transitionId']);
  assert.equal(typeof transition.transitionId, 'string');
  assert.ok(transition.transitionId.length > 0);
  assert.equal(typeof transition.changedAt, 'string');
  assert.ok(Number.isFinite(Date.parse(transition.changedAt)));
  assert.deepEqual({ changed: transition.changed, event: transition.event, previousStatus: transition.previousStatus,
    issues: transition.issues }, { changed: true, event, previousStatus, issues });
  return transition;
}

test('release lifecycle CLI verifies owned TLS endpoints, boundaries, and diagnostics', { timeout: 90_000 }, async t => {
  const f = await fixture(t);
  const scenario = (name, action) => t.test(name, async () => { await f.reset(); await action(); });

  await scenario('healthy uses configured DNS identity, loopback backend, and metadata only', async () => {
    const result = await f.run();
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.result.status, 'healthy');
    assert.deepEqual(Object.keys(result.result).sort(), ['checks', 'status']);
    assert.equal(Object.keys(result.result.checks).length, 9);
    assert.ok(Object.values(result.result.checks).every(value => value.status === 'pass'));
    for (const name of ['backendIdentity', 'publicIdentity']) {
      assert.deepEqual(result.result.checks[name], identityPass());
    }
    assert.deepEqual(f.events.map(e => `${e.side} ${e.route}`).sort(), [
      'backend /api/auth/methods', 'backend /ready', 'edge /api/auth/methods', 'edge /health', 'edge /ready',
      ...['backend', 'edge'].flatMap(side => [...rehearsalRoutes, ...nativeProbeMethods.keys()].map(route => `${side} ${route}`)),
    ].sort());
    assertNativeRequests(f);
    assert.deepEqual(await fs.readFile(f.configuration.database), f.databaseBytes);
    await assert.rejects(fs.stat(f.configuration.tlsKey), { code: 'ENOENT' });
    await assert.rejects(fs.stat(f.configuration.tlsCertificate), { code: 'ENOENT' });
    for (const secret of [f.directory, f.configuration.serverId, 'fingerprint']) assert.equal(result.stdout.includes(secret), false);
  });

  for (const website of [false, true]) {
    await scenario(website ? 'Native website and callback are enabled on both TLS sides' : 'Native callback can be enabled while the website stays disabled', async () => {
      await f.configureNative({ website, callback: true });
      const result = await f.run();
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.equal(result.result.status, 'healthy');
      assert.equal(Object.keys(result.result.checks).length, 9);
      for (const name of ['backendIdentity', 'publicIdentity']) assert.deepEqual(result.result.checks[name], identityPass(website, true));
      assertNativeRequests(f);
      for (const file of [f.callbackProfile, f.websiteProfile]) await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
      for (const detail of [opaqueNativeResponse, f.callbackProfile, f.websiteProfile]) assert.ok(!result.stdout.includes(detail));
      assert.deepEqual(await fs.readFile(f.configuration.database), f.databaseBytes);
    });
  }

  for (const { side, website, callback, route, status, label } of [
    { side: 'edge', website: false, callback: false, route: '/api/website-pay/', status: 200, label: 'unexpected public checkout' },
    { side: 'edge', website: false, callback: true, route: '/api/website-pay/order', status: 405, label: 'public checkout leaks under callback-only configuration' },
    { side: 'edge', website: false, callback: true, route: nativeNotify, status: 404, label: 'configured public callback is hidden' },
    { side: 'edge', website: true, callback: true, route: '/api/website-pay/payment.js', status: 404, label: 'configured checkout asset is hidden at the edge' },
    { side: 'backend', website: true, callback: true, route: '/api/website-pay/confirm', status: 200, label: 'configured backend checkout action accepts GET' },
  ]) await scenario(label, async () => {
    await f.configureNative({ website, callback });
    const normal = f.state[side];
    f.state[side] = (req, answer) => req.url === route ? { status, body: opaqueNativeResponse } : normal(req, answer);
    const result = await f.run();
    const [failed, healthy] = side === 'edge' ? ['publicIdentity', 'backendIdentity'] : ['backendIdentity', 'publicIdentity'];
    failedCheck(result, failed, 'NATIVE_PAYMENT_ROUTE_STATUS_MISMATCH');
    assert.deepEqual(result.result.checks[failed], { status: 'fail', code: 'NATIVE_PAYMENT_ROUTE_STATUS_MISMATCH', route, httpStatus: status });
    assert.deepEqual(result.result.checks[healthy], identityPass(website, callback));
    assertNativeRequests(f);
    assert.ok(!result.stdout.includes(opaqueNativeResponse));
  });

  for (const { route, label, override } of [
    { route: '/api/website-pay/payment.js', label: 'JavaScript MIME', override: expected => ({ ...expected, type: 'text/plain; charset=utf-8' }) },
    { route: '/api/website-pay/base.css', label: 'cacheability', override: expected => ({ ...expected, headers: { ...expected.headers, 'cache-control': 'private, max-age=0' } }) },
    { route: '/api/website-pay/payment.css', label: 'duplicate no-store', override: expected => ({ ...expected, headers: { ...expected.headers, 'cache-control': ['no-store', 'no-store'] } }) },
    { route: '/api/website-pay/brand.png', label: 'missing robots exclusion', override: expected => ({ ...expected, headers: { 'cache-control': expected.headers['cache-control'] } }) },
    { route: '/api/website-pay/quote', label: 'wrong action Allow', override: expected => ({ ...expected, headers: { allow: 'GET, POST' } }) },
    { route: nativeNotify, label: 'duplicate callback Allow', override: expected => ({ ...expected, headers: { allow: ['POST', 'POST'] } }) },
  ]) await scenario(`public Native capability rejects ${label}`, async () => {
    await f.configureNative({ website: true, callback: true });
    const normal = f.state.edge;
    f.state.edge = (req, answer) => {
      const current = normal(req, answer);
      return req.url === route ? override(current) : current;
    };
    const result = await f.run();
    failedCheck(result, 'publicIdentity', 'NATIVE_PAYMENT_ROUTE_HEADERS_MISMATCH');
    assert.deepEqual(result.result.checks.publicIdentity,
      { status: 'fail', code: 'NATIVE_PAYMENT_ROUTE_HEADERS_MISMATCH', route, httpStatus: nativeAssets.has(route) ? 200 : 405 });
    assert.deepEqual(result.result.checks.backendIdentity, identityPass(true, true));
    assertNativeRequests(f);
    assert.ok(!result.stdout.includes(opaqueNativeResponse));
  });

  await scenario('a Native capability redirect is rejected and never followed', async () => {
    await f.configureNative({ website: true, callback: true });
    const normal = f.state.edge;
    f.state.edge = (req, answer) => req.url === nativeNotify
      ? { status: 302, headers: { location: f.configuration.apiBase + '/must-not-follow' }, body: opaqueNativeResponse }
      : normal(req, answer);
    const result = await f.run();
    failedCheck(result, 'publicIdentity', 'NATIVE_PAYMENT_ROUTE_STATUS_MISMATCH');
    assert.equal(result.result.checks.publicIdentity.route, nativeNotify);
    assert.equal(result.result.checks.publicIdentity.httpStatus, 302);
    assert.ok(!f.events.some(event => event.route === '/must-not-follow'));
    assertNativeRequests(f);
  });

  await scenario('a closed Native HTTP connection keeps the network failure diagnostic', async () => {
    await f.configureNative({ website: false, callback: true });
    const normal = f.state.backend;
    f.state.backend = (req, answer) => req.url === nativeNotify ? { disconnect: true } : normal(req, answer);
    const result = await f.run();
    failedCheck(result, 'backendIdentity', 'REQUEST_FAILED');
    assert.deepEqual(result.result.checks.backendIdentity, { status: 'fail', code: 'REQUEST_FAILED', route: nativeNotify });
    assert.deepEqual(result.result.checks.publicIdentity, identityPass(false, true));
    assertNativeRequests(f);
  });

  await scenario('warning exit 2 identifies certificate thresholds without failed checks', async () => {
    const args = f.args.slice(); args[args.indexOf('--certificate-warning-days') + 1] = '5';
    const result = await run(args, f.publicCa);
    assert.equal(result.code, 2, result.stdout + result.stderr);
    assert.equal(result.result.status, 'warning');
    for (const name of ['backendCertificate', 'publicCertificate']) {
      assert.equal(result.result.checks[name].code, 'CERTIFICATE_EXPIRING');
      assert.equal(result.result.checks[name].daysRemaining, 2);
    }
    assert.ok(Object.values(result.result.checks).every(value => value.status !== 'fail'));
  });

  await scenario('disk threshold measures the actual database volume available bytes', async () => {
    const stats = await fs.statfs(f.configuration.database, { bigint: true });
    const threshold = stats.bavail * stats.bsize + 1024n * 1024n * 1024n;
    const args = f.args.slice(); args[args.indexOf('--disk-warning-bytes') + 1] = threshold.toString();
    const result = await run(args, f.publicCa);
    assert.equal(result.code, 2, result.stdout + result.stderr);
    assert.equal(result.result.checks.databaseVolume.code, 'DATABASE_SPACE_LOW');
    assert.match(result.result.checks.databaseVolume.availableBytes, /^[0-9]+$/);
  });

  for (const side of ['backend', 'edge']) {
    for (const variant of ['header', 'body']) await scenario(`${side} rejects a mismatched instance ${variant}`, async () => {
      f.state[side] = (req, answer) => {
        if (req.url !== '/api/auth/methods') return answer;
        if (variant === 'header') answer.headers['x-shenyi-server-id'] = crypto.randomUUID();
        else answer.body.deviceBinding.serverId = crypto.randomUUID();
        return answer;
      };
      failedCheck(await f.run(), side === 'backend' ? 'backendIdentity' : 'publicIdentity', 'INSTANCE_MISMATCH');
    });
  }

  await scenario('duplicate identity header does not authenticate the public service', async () => {
    f.state.edge = (req, answer) => req.url === '/api/auth/methods'
      ? { ...answer, headers: { 'x-shenyi-server-id': [f.configuration.serverId, f.configuration.serverId] } } : answer;
    failedCheck(await f.run(), 'publicIdentity', 'INSTANCE_MISMATCH');
  });

  for (const variant of ['mode', 'demo', 'phone', 'device', 'protocol']) await scenario(`public managed policy rejects invalid ${variant}`, async () => {
    f.state.edge = (req, answer) => {
      if (req.url !== '/api/auth/methods') return answer;
      if (variant === 'mode') answer.body.mode = 'demo';
      if (variant === 'demo') answer.body.methods.demoUsername = true;
      if (variant === 'phone') answer.body.methods.phonePassword = false;
      if (variant === 'device') answer.body.deviceBinding.required = false;
      if (variant === 'protocol') answer.body.deviceBinding.protocolVersion = 2;
      return answer;
    };
    failedCheck(await f.run(), 'publicIdentity', 'MANAGED_DEVICE_POLICY_MISMATCH');
  });

  for (const route of ['/ready', '/health']) await scenario(`edge exposure of ${route} is a failure`, async () => {
    f.state.edge = (req, answer) => req.url === route ? { status: 200, body: { status: 'ready' } } : answer;
    failedCheck(await f.run(), route === '/ready' ? 'publicReadinessHidden' : 'publicHealthHidden', 'PRIVATE_ROUTE_VISIBLE');
  });

  for (const [side, name, other] of [['backend', 'backendIdentity', 'publicIdentity'], ['edge', 'publicIdentity', 'backendIdentity']]) {
    for (const [route, status] of [[rehearsalRoutes[0], 405], [rehearsalRoutes.at(-1), 503]]) {
      await scenario(`${side} rehearsal endpoint ${route} responding ${status} fails deployment`, async () => {
        const privateResponse = 'Synthetic rehearsal response must not appear in the report';
        f.state[side] = (req, answer) => req.url === route ? { status, body: privateResponse } : answer;
        const result = await f.run();
        failedCheck(result, name, 'REHEARSAL_ROUTE_VISIBLE');
        assert.deepEqual(result.result.checks[name], { status: 'fail', code: 'REHEARSAL_ROUTE_VISIBLE', route, httpStatus: status });
        assert.deepEqual(result.result.checks[other], identityPass());
        assert.ok(!result.stdout.includes(privateResponse));
      });
    }
  }

  await scenario('same native TLS public key on backend and edge fails separation', async () => {
    f.edge.setSecureContext(f.tls.backend);
    const result = await f.run();
    failedCheck(result, 'tlsKeySeparation', 'TLS_KEY_REUSED');
    assert.equal(result.result.checks.publicIdentity.status, 'pass');
    assert.equal(result.result.checks.backendIdentity.status, 'pass');
  });

  await scenario('hostname mismatch is rejected by native TLS before public HTTP', async () => {
    f.edge.setSecureContext(f.tls.wrongHost);
    failedCheck(await f.run(), 'publicIdentity', 'TLS_UNTRUSTED');
    assert.equal(f.events.some(event => event.side === 'edge'), false);
  });

  await scenario('expired native TLS certificate is rejected before backend HTTP', async () => {
    f.backend.setSecureContext(f.tls.expired);
    failedCheck(await f.run(), 'backendReadiness', 'TLS_UNTRUSTED');
    assert.equal(f.events.some(event => event.side === 'backend'), false);
  });

  await scenario('backend not ready fails even when identity remains valid', async () => {
    f.state.backend = (req, answer) => req.url === '/ready' ? { status: 503, body: { status: 'not-ready' } } : answer;
    failedCheck(await f.run(), 'backendReadiness', 'BACKEND_NOT_READY');
  });

  await scenario('redirects are reported without following the target', async () => {
    f.state.edge = (req, answer) => req.url === '/api/auth/methods'
      ? { status: 302, headers: { location: f.configuration.apiBase + '/must-not-follow' }, body: {} } : answer;
    failedCheck(await f.run(), 'publicIdentity', 'AUTH_METHODS_UNAVAILABLE');
    assert.equal(f.events.some(event => event.route === '/must-not-follow'), false);
  });

  await scenario('16 KiB response bound rejects an otherwise authorized HTTPS peer', async () => {
    f.state.edge = (req, answer) => req.url === '/api/auth/methods' ? { ...answer, body: Buffer.alloc(16 * 1024 + 1, 65) } : answer;
    failedCheck(await f.run(), 'publicIdentity', 'RESPONSE_TOO_LARGE');
  });

  await scenario('deadline covers a stalled body after valid TLS and response headers', async () => {
    f.state.backend = (req, answer) => req.url === '/ready' ? { status: 200, body: '{"status":', hang: true } : answer;
    const start = Date.now();
    failedCheck(await f.run(), 'backendReadiness', 'REQUEST_TIMEOUT');
    assert.ok(Date.now() - start < 12_000);
  });

  await scenario('database metadata failure gets its own diagnostic without creating a database', async () => {
    const missing = { ...f.configuration, database: path.join(f.directory, 'missing.sqlite') };
    await fs.writeFile(f.filename, JSON.stringify(missing));
    failedCheck(await f.run(), 'databaseVolume', 'DATABASE_VOLUME_UNAVAILABLE');
    await assert.rejects(fs.stat(missing.database), { code: 'ENOENT' });
  });

  await scenario('monitor records stable transitions across real TLS warning, failures, and recovery', async () => {
    const { directory, filename } = await monitorDirectory(f.directory);
    const args = [...f.args, '--monitor-state-directory', directory];
    const issue = (facet, status, code) => ({ facet, status, code });
    const runMonitor = async expected => monitorTransition(await run(args, f.publicCa), expected);
    const initial = await runMonitor({ code: 0, status: 'healthy', previousStatus: null, event: 'initialized', issues: [] });
    const stateEntry = await fs.lstat(filename);
    assert.equal(stateEntry.isFile(), true);
    assert.equal(stateEntry.nlink, 1);
    if (process.platform !== 'win32') assert.equal(stateEntry.mode & 0o777, 0o600);
    const initialBytes = await fs.readFile(filename);
    const repeated = await run(args, f.publicCa);
    assert.equal(repeated.code, 0);
    assert.deepEqual(repeated.result.monitor, { ...initial, changed: false });
    assert.deepEqual(await fs.readFile(filename), initialBytes);

    const certificateThreshold = args.indexOf('--certificate-warning-days') + 1;
    args[certificateThreshold] = '5';
    const warning = await runMonitor({ code: 2, status: 'warning', previousStatus: 'healthy', event: 'opened',
      issues: [issue('backendCertificate', 'warning', 'CERTIFICATE_EXPIRING'), issue('publicCertificate', 'warning', 'CERTIFICATE_EXPIRING')] });
    args[certificateThreshold] = '1';
    let exposedRoute = '/ready';
    let statusCode = 200;
    const privateBody = 'Synthetic monitoring response: never include this body in state or report';
    f.state.edge = (req, answer) => req.url === exposedRoute ? { status: statusCode, body: privateBody } : answer;
    const failed = await runMonitor({ code: 1, status: 'failed', previousStatus: 'warning', event: 'changed',
      issues: [issue('publicReadinessHidden', 'fail', 'PRIVATE_ROUTE_VISIBLE')] });
    const failureBytes = await fs.readFile(filename);
    statusCode = 403;
    const measuredAgain = await run(args, f.publicCa);
    failedCheck(measuredAgain, 'publicReadinessHidden', 'PRIVATE_ROUTE_VISIBLE');
    assert.equal(measuredAgain.result.checks.publicReadinessHidden.httpStatus, 403);
    assert.deepEqual(measuredAgain.result.monitor, { ...failed, changed: false });
    assert.deepEqual(await fs.readFile(filename), failureBytes);
    for (const sensitive of [f.configuration.apiBase, f.configuration.serverId, f.directory, privateBody, '/ready', 'httpStatus']) {
      assert.equal(failureBytes.toString('utf8').includes(sensitive), false);
      assert.equal(JSON.stringify(measuredAgain.result.monitor).includes(sensitive), false);
    }

    exposedRoute = '/health';
    const newFailure = await runMonitor({ code: 1, status: 'failed', previousStatus: 'failed', event: 'changed',
      issues: [issue('publicHealthHidden', 'fail', 'PRIVATE_ROUTE_VISIBLE')] });
    delete f.state.edge;
    const recovered = await runMonitor({ code: 0, status: 'healthy', previousStatus: 'failed', event: 'recovered', issues: [] });
    assert.equal(new Set([initial, warning, failed, newFailure, recovered].map(item => item.transitionId)).size, 5);
    const recoveredBytes = await fs.readFile(filename);
    const after = await run(args, f.publicCa);
    assert.equal(after.code, 0);
    assert.deepEqual(after.result.monitor, { ...recovered, changed: false });
    assert.deepEqual(await fs.readFile(filename), recoveredBytes);
    assert.deepEqual(await fs.readdir(directory), ['state.json']);
    assert.deepEqual(await fs.readFile(f.configuration.database), f.databaseBytes);
  });

  await scenario('systemd state directory is used only with an explicit transition opt-in', async () => {
    const { directory, filename } = await monitorDirectory(f.directory);
    const legacy = await run(f.args, f.publicCa, { STATE_DIRECTORY: directory });
    assert.equal(legacy.code, 0);
    assert.deepEqual(Object.keys(legacy.result).sort(), ['checks', 'status']);
    await assert.rejects(fs.lstat(filename), { code: 'ENOENT' });
    const enabled = await run(f.args, f.publicCa, { STATE_DIRECTORY: directory, SHENYI_MONITOR_TRANSITIONS: '1' });
    const initialized = monitorTransition(enabled, { code: 0, status: 'healthy', previousStatus: null, event: 'initialized', issues: [] });
    const byFlag = await run([...f.args, '--monitor-state-directory', directory], f.publicCa);
    assert.equal(byFlag.code, 0);
    assert.deepEqual(byFlag.result.monitor, { ...initialized, changed: false });
  });

  await scenario('Native capability failures retain CLI diagnoses and the existing monitor state format', async () => {
    await f.configureNative({ website: true, callback: true });
    const { directory, filename } = await monitorDirectory(f.directory);
    const args = [...f.args, '--monitor-state-directory', directory];
    const normal = f.state.edge;
    monitorTransition(await run(args, f.publicCa),
      { code: 0, status: 'healthy', previousStatus: null, event: 'initialized', issues: [] });
    let opened;
    let failureBytes;
    for (const [newAnswer, code] of [
      [{ status: 405, headers: { allow: 'GET' }, body: opaqueNativeResponse }, 'NATIVE_PAYMENT_ROUTE_HEADERS_MISMATCH'],
      [{ status: 404, body: opaqueNativeResponse }, 'NATIVE_PAYMENT_ROUTE_STATUS_MISMATCH'],
    ]) {
      f.state.edge = (req, answer) => req.url === nativeNotify ? newAnswer : normal(req, answer);
      const failure = await run(args, f.publicCa);
      failedCheck(failure, 'publicIdentity', code);
      assert.equal(failure.result.checks.publicIdentity.route, nativeNotify);
      const persisted = await fs.readFile(filename);
      if (opened) {
        assert.deepEqual(failure.result.monitor, { ...opened, changed: false });
        assert.deepEqual(persisted, failureBytes);
      } else {
        opened = monitorTransition(failure, { code: 1, status: 'failed', previousStatus: 'healthy',
          event: 'opened', issues: [{ facet: 'publicIdentity', status: 'fail' }] });
        failureBytes = persisted;
      }
      for (const detail of [nativeNotify, 'httpStatus', 'NATIVE_PAYMENT_ROUTE_', opaqueNativeResponse, f.callbackProfile, f.websiteProfile]) {
        assert.equal(persisted.toString('utf8').includes(detail), false);
        assert.equal(JSON.stringify(failure.result.monitor).includes(detail), false);
      }
    }
    f.state.edge = normal;
    monitorTransition(await run(args, f.publicCa),
      { code: 0, status: 'healthy', previousStatus: 'failed', event: 'recovered', issues: [] });
  });

  await scenario('corrupt and hard-linked monitor state are preserved, with the probe result available', async () => {
    const poison = Buffer.from('{ "synthetic-sensitive-state": "must never appear in output"');
    for (const hardLinked of [false, true]) {
      const { directory, filename } = await monitorDirectory(f.directory);
      const target = hardLinked ? path.join(f.directory, 'held-monitor-state') : filename;
      const args = [...f.args, '--monitor-state-directory', directory];
      let original;
      if (hardLinked) {
        monitorTransition(await run(args, f.publicCa), { code: 0, status: 'healthy', previousStatus: null,
          event: 'initialized', issues: [] });
        original = await fs.readFile(filename);
        await fs.link(filename, target);
      } else {
        original = poison;
        await fs.writeFile(filename, original, { flag: 'wx', mode: 0o600 });
      }
      const before = await fs.lstat(filename, { bigint: true });
      assert.equal(before.nlink, hardLinked ? 2n : 1n);
      const result = await run(args, f.publicCa);
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.equal(result.result.status, 'healthy');
      assert.equal(result.result.monitorError, 'MONITOR_STATE_UNAVAILABLE');
      assert.equal(Object.hasOwn(result.result, 'monitor'), false);
      assert.equal(Object.keys(result.result.checks).length, 9);
      assert.ok(Object.values(result.result.checks).every(check => check.status === 'pass'));
      for (const sensitive of ['synthetic-sensitive-state', f.directory, f.configuration.serverId]) {
        assert.equal(result.stdout.includes(sensitive), false);
        assert.equal(result.stderr.includes(sensitive), false);
      }
      assert.deepEqual(await fs.readFile(filename), original);
      assert.deepEqual(await fs.readFile(target), original);
      const after = await fs.lstat(filename, { bigint: true });
      assert.equal(after.ino, before.ino);
      assert.equal(after.nlink, before.nlink);
      assert.equal(after.mtimeNs, before.mtimeNs);
      assert.deepEqual(await fs.readdir(directory), ['state.json']);
    }
  });

  await scenario('invalid arguments and unsafe profile/CA paths fail before network access', async () => {
    const invalid = async (args, code) => {
      const result = await run(args, f.publicCa);
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.deepEqual(result.result, { status: 'failed', code });
      assert.equal(f.events.length, 0);
      assert.equal(result.stdout.includes(f.directory), false);
      assert.equal(result.stdout.includes('Secret marker'), false);
    };
    await invalid([], 'INVALID_ARGUMENTS');
    await invalid([...f.args, '--certificate-warning-days', '2'], 'INVALID_ARGUMENTS');
    const relative = f.args.slice(); relative[relative.indexOf('--config') + 1] = 'relative.json';
    await invalid(relative, 'INVALID_CONFIGURATION');
    const days = f.args.slice(); days[days.indexOf('--certificate-warning-days') + 1] = '366';
    await invalid(days, 'INVALID_ARGUMENTS');
    const sameFile = f.args.slice(); sameFile[sameFile.indexOf('--backend-ca') + 1] = f.configuration.database;
    await invalid(sameFile, 'INVALID_CONFIGURATION');
    const invalidCa = path.join(f.directory, 'invalid-ca.pem');
    await fs.writeFile(invalidCa, 'Secret marker must never be printed by the release checker');
    const malformed = f.args.slice(); malformed[malformed.indexOf('--backend-ca') + 1] = invalidCa;
    await invalid(malformed, 'INVALID_BACKEND_CA');
    const linkedCa = path.join(f.directory, 'hardlinked-ca.pem');
    await fs.link(f.ca, linkedCa);
    try { await invalid(f.args, 'INVALID_BACKEND_CA'); }
    finally { await fs.unlink(linkedCa); }
    await fs.writeFile(f.filename, JSON.stringify({ ...f.configuration, listenPort: 0 }));
    await invalid(f.args, 'INVALID_CONFIGURATION');
    await f.configureNative({ website: true, callback: false });
    await invalid(f.args, 'INVALID_CONFIGURATION');
  });
});
