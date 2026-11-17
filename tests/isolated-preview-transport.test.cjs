'use strict';
// Synthetic responses only: these tests never bind a port or use the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createIsolatedPreviewTransport } = require('../desktop/isolated-preview-transport.cjs');
const { boundedBytes, ClientError } = require('../desktop/team-client.cjs');
const PROFILE = Object.freeze({ schemaVersion: 1, apiBase: 'http://127.0.0.1:18941',
  serverId: '12345678-abcd-4bcd-8bcd-123456789abc' });
const METHODS = PROFILE.apiBase + '/api/auth/methods';
const OTHER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const capability = () => ({ mode: 'local-preview', deviceBinding: {
  required: true, serverId: PROFILE.serverId, protocolVersion: 1,
} });
const error = (code, message) => new ClientError(code, message);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function response({ body = JSON.stringify(capability()), status = 200,
  serverId = PROFILE.serverId, url = METHODS, redirected = false, headers: additions = {} } = {}) {
  const headers = new Headers(additions);
  if (serverId !== null) headers.set('X-Shenyi-Server-Id', serverId);
  const result = new Response(body, { status, headers });
  Object.defineProperties(result, { url: { value: url }, redirected: { value: redirected } });
  return result;
}
function fixture(fetchImpl = async () => response(), extras = {}) {
  return createIsolatedPreviewTransport({ profile: PROFILE, fetchImpl, boundedBytes, error, ...extras });
}
function assertPublic(call) {
  assert.equal(call.url, METHODS);
  assert.equal(call.options.method, 'GET'); assert.equal(call.options.redirect, 'error');
  assert.equal(call.options.cache, 'no-store');
  assert.deepEqual(call.options.headers, { Origin: 'shenyi://app' });
  assert.equal(call.options.body, undefined);
  assert.ok(call.options.signal instanceof AbortSignal);
  assert.equal(call.options.headers.Authorization, undefined);
  assert.equal(call.options.headers['X-Shenyi-Device-Lease'], undefined);
}

test('isolated transport snapshots its identity and keeps canonical encoded search queries', () => {
  const profile = { ...PROFILE }, transport = fixture(undefined, { profile });
  profile.apiBase = 'http://127.0.0.1:18942'; profile.serverId = OTHER_ID;
  assert.equal(transport.url('/api/auth/methods'), METHODS);
  const route = '/api/teams/team-a/tasks?q=%E4%B8%AD%E6%96%87&page=2';
  assert.equal(transport.url(route), PROFILE.apiBase + route); assert.ok(Object.isFrozen(transport));
});
test('transport rejects a malformed profile before fetch', () => {
  let calls = 0;
  for (const patch of [{ apiBase: 'http://127.0.0.1:8774' }, { apiBase: 'https://team.example.invalid' },
    { apiBase: PROFILE.apiBase + '/' }, { serverId: OTHER_ID.toUpperCase() }, { schemaVersion: 2 }, { extra: true }]) {
    assert.throws(() => fixture(() => { calls++; }, { profile: { ...PROFILE, ...patch } }), { code: 'INVALID_SERVER' });
  }
  assert.equal(calls, 0);
});
test('fixed URL rejects origin, slash, fragment, control and encoded-path ambiguity', () => {
  const transport = fixture();
  for (const route of [undefined, null, {}, ['api'], 'api/auth/methods', '', '//other.invalid/path',
    'https://other.invalid/path', '/\\other.invalid', '/api#fragment', '/api\n', '/api x', '/api\u007f',
    '/api/../auth/methods', '/api/./auth/methods', '/api/%2e%2e/auth/methods', '/api/%2F%2Fother', '/api/%5cother']) {
    assert.throws(() => transport.url(route), { code: 'UNTRUSTED_SERVER' });
  }
});
test('successful probe sends exactly one fixed public GET without credentials or body', async () => {
  const calls = []; let reads = 0;
  const transport = fixture(async (url, options) => { calls.push({ url, options }); return response(); }, {
    boundedBytes: async (res, limit) => { reads++; assert.equal(limit, 1024 * 1024); return boundedBytes(res, limit); },
  });
  await transport.probe(); assert.equal(calls.length, 1); assert.equal(reads, 1); assertPublic(calls[0]);
});
for (const [name, patch] of [
  ['missing identity', { serverId: null }], ['wrong UUID', { serverId: OTHER_ID }],
  ['uppercase UUID', { serverId: PROFILE.serverId.toUpperCase() }],
  ['duplicate identity', { serverId: PROFILE.serverId + ', ' + PROFILE.serverId }],
  ['different origin', { url: 'http://127.0.0.1:18942/api/auth/methods' }],
  ['different path', { url: PROFILE.apiBase + '/api/auth/login' }],
  ['empty response URL', { url: '' }], ['redirected response', { redirected: true }],
]) test('probe rejects ' + name + ' before reading response data', async () => {
  const calls = []; let reads = 0;
  const transport = fixture(async (url, options) => { calls.push({ url, options }); return response(patch); }, {
    boundedBytes: async () => { reads++; throw Error('identity failure must precede body read'); },
  });
  await assert.rejects(transport.probe(), { code: 'UNTRUSTED_SERVER' });
  assert.equal(calls.length, 1); assertPublic(calls[0]); assert.equal(reads, 0);
});
test('actual response identity is required for every HTTP status', () => {
  const transport = fixture();
  for (const status of [200, 401, 403, 500, 503]) {
    assert.doesNotThrow(() => transport.responseIdentity(response({ status }), METHODS));
    assert.throws(() => transport.responseIdentity(response({ status, serverId: null }), METHODS), { code: 'UNTRUSTED_SERVER' });
  }
  for (const value of [null, {}, { redirected: false, url: METHODS }, { redirected: undefined, url: METHODS, headers: new Headers() }]) {
    assert.throws(() => transport.responseIdentity(value, METHODS), { code: 'UNTRUSTED_SERVER' });
  }
});
test('non-successful methods response fails before body consumption', async () => {
  for (const status of [301, 401, 403, 500]) {
    let read = false;
    const transport = fixture(async () => response({ status }), { boundedBytes: async () => { read = true; } });
    await assert.rejects(transport.probe(), { code: 'UNTRUSTED_SERVER' }); assert.equal(read, false);
  }
});
test('methods capability is exact protocol 1 and needs the configured string UUID', () => {
  const transport = fixture(); assert.doesNotThrow(() => transport.methodsIdentity(capability()));
  for (const deviceBinding of [undefined, null, [], {},
    { required: false, serverId: PROFILE.serverId, protocolVersion: 1 },
    { required: true, serverId: [PROFILE.serverId], protocolVersion: 1 },
    { required: true, serverId: OTHER_ID, protocolVersion: 1 },
    { required: true, serverId: PROFILE.serverId, protocolVersion: '1' },
    { required: true, serverId: PROFILE.serverId, protocolVersion: 2 },
    { required: true, serverId: PROFILE.serverId, protocolVersion: 1, extra: true },
    Object.assign(Object.create({ extra: true }), capability().deviceBinding),
  ]) assert.throws(() => transport.methodsIdentity({ deviceBinding }), { code: 'UNTRUSTED_SERVER' });
});
test('methods identity refuses accessors, hidden and symbolic fields without executing getters', () => {
  const transport = fixture(); let getters = 0;
  const accessor = { ...capability().deviceBinding };
  Object.defineProperty(accessor, 'serverId', { enumerable: true, get() { getters++; return PROFILE.serverId; } });
  const hidden = { ...capability().deviceBinding };
  Object.defineProperty(hidden, 'serverId', { value: PROFILE.serverId, enumerable: false });
  const dataAccessor = {};
  Object.defineProperty(dataAccessor, 'deviceBinding', { get() { getters++; return capability().deviceBinding; } });
  for (const value of [{ deviceBinding: accessor }, { deviceBinding: hidden }, dataAccessor,
    { deviceBinding: { ...capability().deviceBinding, [Symbol('untrusted')]: true } }]) {
    assert.throws(() => transport.methodsIdentity(value), { code: 'UNTRUSTED_SERVER' });
  }
  assert.equal(getters, 0);
});
test('invalid JSON or malformed UTF8 cannot establish methods identity', async () => {
  for (const body of ['{', '', 'null', '[]', JSON.stringify({ deviceBinding: null }), Buffer.from([0xff, 0xfe])]) {
    await assert.rejects(fixture(async () => response({ body })).probe(), { code: 'UNTRUSTED_SERVER' });
  }
});
test('probe keeps an inclusive 1 MiB cap and cancels declared oversize without pulling', async () => {
  const json = JSON.stringify(capability());
  await fixture(async () => response({ body: json + ' '.repeat(1024 * 1024 - Buffer.byteLength(json)) })).probe();
  let pulled = 0, canceled = 0;
  const body = new ReadableStream({ pull() { pulled++; }, cancel() { canceled++; } }, { highWaterMark: 0 });
  await assert.rejects(fixture(async () => response({ body, headers: { 'Content-Length': String(1024 * 1024 + 1) } })).probe(), { code: 'RESPONSE_TOO_LARGE' });
  assert.equal(pulled, 0); assert.equal(canceled, 1);
});
test('streamed oversize is bounded and cancels its reader', async () => {
  let canceled = 0;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel() { canceled++; } }, { highWaterMark: 0 });
  await assert.rejects(fixture(async () => response({ body })).probe(), { code: 'RESPONSE_TOO_LARGE' });
  assert.equal(canceled, 1);
});
test('identity failure cancels an unconsumed body', async () => {
  let canceled = 0;
  const body = new ReadableStream({ cancel() { canceled++; } }, { highWaterMark: 0 });
  await assert.rejects(fixture(async () => response({ body, serverId: OTHER_ID })).probe(), { code: 'UNTRUSTED_SERVER' });
  assert.equal(canceled, 1);
});
test('guard failure before dispatch prevents fetch', async () => {
  const sentinel = error('SESSION_CHANGED', 'old session'); let calls = 0;
  const transport = fixture(async () => { calls++; return response(); });
  await assert.rejects(transport.probe(() => { throw sentinel; }), value => value === sentinel); assert.equal(calls, 0);
});
test('guard after fetch wins over stale identity and cancels its body', async () => {
  const sentinel = error('SESSION_CHANGED', 'new session'); let checks = 0, reads = 0, canceled = 0;
  const body = new ReadableStream({ cancel() { canceled++; } }, { highWaterMark: 0 });
  const transport = fixture(async () => response({ body, serverId: OTHER_ID }), { boundedBytes: async () => { reads++; } });
  await assert.rejects(transport.probe(() => { if (++checks === 2) throw sentinel; }), value => value === sentinel);
  assert.equal(reads, 0); assert.equal(canceled, 1);
});
test('guard after body read wins over stale methods identity', async () => {
  const entered = deferred(), release = deferred(), sentinel = error('SESSION_CHANGED', 'new session');
  let current = true;
  const transport = fixture(async () => response(), { boundedBytes: async () => {
    entered.resolve(); await release.promise;
    return Buffer.from(JSON.stringify({ deviceBinding: { required: true, serverId: OTHER_ID, protocolVersion: 1 } }));
  } });
  const pending = transport.probe(() => { if (!current) throw sentinel; });
  const rejected = assert.rejects(pending, value => value === sentinel);
  await entered.promise; current = false; release.resolve(); await rejected;
});
test('final guard runs after a successful methods identity check', async () => {
  const sentinel = error('SESSION_CHANGED', 'final session guard'); let checks = 0;
  await assert.rejects(fixture().probe(() => { if (++checks === 4) throw sentinel; }), value => value === sentinel);
  assert.equal(checks, 4);
});
test('caller abort reaches fetch without dispatching a retry', async () => {
  const controller = new AbortController(), entered = deferred(), calls = [];
  const transport = fixture(async (url, options) => {
    calls.push({ url, options }); entered.resolve();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  });
  const pending = transport.probe(() => {}, controller.signal);
  const rejected = assert.rejects(pending, cause => cause?.name === 'AbortError');
  await entered.promise; controller.abort(); await rejected;
  assert.equal(calls.length, 1); assertPublic(calls[0]); assert.equal(calls[0].options.signal.aborted, true);
});
test('a pre-aborted caller signal cannot complete a probe', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const transport = fixture(async (_url, options) => { calls++; assert.ok(options.signal.aborted); throw options.signal.reason; });
  await assert.rejects(transport.probe(() => {}, controller.signal), cause => cause?.name === 'AbortError'); assert.ok(calls <= 1);
});
test('public probe has an actual 15 second timeout without retry', { timeout: 22000 }, async () => {
  const keepAlive = setTimeout(() => {}, 21000), calls = [];
  try {
    const transport = fixture(async (url, options) => {
      calls.push({ url, options });
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    });
    const started = Date.now(); await assert.rejects(transport.probe(), cause => cause?.name === 'TimeoutError');
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 14000 && elapsed < 20000, 'probe timeout remains bounded: ' + elapsed);
    assert.equal(calls.length, 1); assertPublic(calls[0]);
  } finally { clearTimeout(keepAlive); }
});
