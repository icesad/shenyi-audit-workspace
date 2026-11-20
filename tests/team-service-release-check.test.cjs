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

async function run(args, ca) {
  const result = await command(process.execPath, ['--dns-result-order=ipv4first', checker, ...args], {
    cwd: root, env: childEnvironment({ NODE_EXTRA_CA_CERTS: ca }), timeout: 15_000,
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
        transferEncoding: req.headers['transfer-encoding'], bodyBytes: 0 };
      events.push(event);
      req.on('data', chunk => { event.bodyBytes += chunk.length; });
      let answer = side === 'backend' && req.url === '/ready'
        ? { status: 200, body: { status: 'ready' } }
        : req.url === '/api/auth/methods'
          ? { status: 200, headers: { 'x-shenyi-server-id': serverId }, body: methods() }
          : { status: 404, body: '<html>Owned synthetic edge 404</html>', type: 'text/html' };
      answer = state[side]?.(req, answer) ?? answer;
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
  const databaseBytes = Buffer.from('Opaque synthetic metadata target; deliberately not a SQLite database.');
  await fs.writeFile(configuration.database, databaseBytes, { flag: 'wx' });
  const reset = async () => {
    delete state.backend; delete state.edge; events.length = 0;
    backend.setSecureContext(tls.backend); edge.setSecureContext(tls.edge);
    await fs.writeFile(filename, JSON.stringify(configuration));
  };
  await reset();
  const args = ['--config', filename, '--backend-ca', ca, '--disk-warning-bytes', '1', '--certificate-warning-days', '1'];
  return { directory, filename, configuration, ca, publicCa, tls, backend, edge, state, events, reset, args,
    run: () => run(args, publicCa), databaseBytes };
}

function failedCheck(result, name, code) {
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.equal(result.result.status, 'failed');
  assert.equal(result.result.checks[name].status, 'fail');
  assert.equal(result.result.checks[name].code, code);
}

test('release lifecycle CLI verifies owned TLS endpoints, boundaries, and diagnostics', { timeout: 90_000 }, async t => {
  const f = await fixture(t);
  const scenario = (name, action) => t.test(name, async () => { await f.reset(); await action(); });

  await scenario('healthy uses configured DNS identity, loopback backend, and metadata only', async () => {
    const result = await f.run();
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.result.status, 'healthy');
    assert.equal(Object.keys(result.result.checks).length, 9);
    assert.ok(Object.values(result.result.checks).every(value => value.status === 'pass'));
    for (const name of ['backendIdentity', 'publicIdentity']) {
      assert.deepEqual(result.result.checks[name], { status: 'pass', rehearsalRoutesHidden: 8 });
    }
    assert.deepEqual(f.events.map(e => `${e.side} ${e.route}`).sort(), [
      'backend /api/auth/methods', 'backend /ready', 'edge /api/auth/methods', 'edge /health', 'edge /ready',
      ...['backend', 'edge'].flatMap(side => rehearsalRoutes.map(route => `${side} ${route}`)),
    ].sort());
    for (const event of f.events) {
      assert.equal(event.method, 'GET');
      assert.equal(event.host, new URL(f.configuration.apiBase).host);
      assert.equal(event.servername, 'localhost');
      assert.equal(event.authorization, undefined);
      assert.equal(event.cookie, undefined);
      assert.equal(event.contentLength, undefined);
      assert.equal(event.transferEncoding, undefined);
      assert.equal(event.bodyBytes, 0);
    }
    assert.deepEqual(await fs.readFile(f.configuration.database), f.databaseBytes);
    await assert.rejects(fs.stat(f.configuration.tlsKey), { code: 'ENOENT' });
    await assert.rejects(fs.stat(f.configuration.tlsCertificate), { code: 'ENOENT' });
    for (const secret of [f.directory, f.configuration.serverId, 'fingerprint']) assert.equal(result.stdout.includes(secret), false);
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
        assert.deepEqual(result.result.checks[other], { status: 'pass', rehearsalRoutesHidden: 8 });
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
  });
});
