'use strict';
// Real listeners and SQLite files below are owned by this suite; no GUI is opened.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');
const configuration = require('../desktop/isolated-preview-config.cjs');
const launcher = import(pathToFileURL(path.resolve(__dirname, '../scripts/team-isolated-preview.mjs')).href);
const BASE = path.join(os.tmpdir(), 'shenyi-isolated-preview-tests');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function ownedDirectory(t) {
  await fs.mkdir(BASE, { recursive: true });
  const directory = await fs.mkdtemp(path.join(BASE, 'launcher-')), cleanup = [];
  t.after(async () => {
    for (const close of cleanup.reverse()) await close();
    const absolute = path.resolve(directory);
    assert.ok(absolute.startsWith(BASE + path.sep));
    await fs.rm(absolute, { recursive: true, force: true });
  });
  return { directory, cleanup };
}
function safeAddress(address) {
  assert.equal(address.host, '127.0.0.1');
  assert.ok(Number.isInteger(address.port) && address.port >= 1024 && address.port <= 65535);
  assert.ok(![8773, 8774].includes(address.port));
  assert.equal(address.url, 'http://127.0.0.1:' + address.port);
}
function publicMethods(address) {
  safeAddress(address);
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port: address.port,
      path: '/api/auth/methods', agent: false, headers: { Origin: 'shenyi://app' } }, response => {
      const chunks = []; let count = 0;
      response.on('data', chunk => {
        count += chunk.length;
        if (count > 1024 * 1024) { response.destroy(Error('owned public response too large')); return; }
        chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('end', () => {
        try { resolve({ status: response.statusCode, headers: response.headers,
          data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch (error) { reject(error); }
      });
    });
    request.setTimeout(3000, () => request.destroy(Error('owned public request timed out')));
    request.once('error', reject);
  });
}
function refused(address) {
  safeAddress(address);
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: address.port });
    socket.setTimeout(3000, () => { socket.destroy(); reject(Error('closed owned port did not settle')); });
    socket.once('connect', () => { socket.destroy(); reject(Error('owned candidate still accepts connections')); });
    socket.once('error', error => { socket.destroy(); if (error.code === 'ECONNREFUSED') resolve(); else reject(error); });
  });
}

test('launcher accepts only canonical Node 24.15+ releases in the 24.x series', async () => {
  const { assertNode24 } = await launcher;
  for (const version of ['24.15.0', '24.22.1', '24.99.999']) assert.doesNotThrow(() => assertNode24(version));
  for (const version of ['24.14.99', '23.99.0', '25.0.0', 'v24.22.1', '24.15.0-rc.1',
    '24.15.0+local', '24.015.0', '24.15.00', '24.15', '24.15.0 ', '', null, 24,
    { toString() { throw Error('version must not coerce'); } }]) assert.throws(() => assertNode24(version));
});

test('child environment removes inherited service, debug, TLS and proxy controls while preserving OS identity', async () => {
  const { candidateChildEnvironment } = await launcher;
  const context = Object.freeze({ configFile: path.join(BASE, 'owned-candidate.json'),
    desktopDataDirectory: path.join(BASE, 'owned-desktop-data') });
  const env = Object.freeze({ HOME: 'D:/owned-home', LOCALAPPDATA: 'C:/Users/fixture/AppData/Local',
    SystemRoot: 'C:/Windows', Path: 'D:/owned-bin', TEMP: path.join(BASE, 'tmp'),
    SHENYI_TEAM_API: 'http://example.invalid', shenyi_device_proof_required: '0',
    SHENYI_ISOLATED_PREVIEW_CONFIG: 'inherited-config', SHENYI_DESKTOP_DATA_DIR: 'inherited-profile',
    NODE_OPTIONS: '--inspect=9229 --require=untrusted.cjs', node_path: 'inherited-modules',
    NODE_EXTRA_CA_CERTS: 'inherited-ca.pem', NODE_TLS_REJECT_UNAUTHORIZED: '0',
    ELECTRON_RUN_AS_NODE: '1', SSL_CERT_FILE: 'inherited-cert.pem', SSL_CERT_DIR: 'inherited-certs',
    NODE_USE_SYSTEM_CA: '1', NODE_USE_ENV_PROXY: '1', http_proxy: 'http://example.invalid',
    HTTPS_PROXY: 'http://example.invalid', ALL_PROXY: 'http://example.invalid',
    No_Proxy: '*', GLOBAL_AGENT_HTTP_PROXY: 'http://example.invalid',
    NODE_DEBUG: 'http,net', NODE_DEBUG_NATIVE: '*', VSCODE_INSPECTOR_OPTIONS: 'debugger',
    VSCODE_JS_DEBUG_OPTIONS: 'debugger', NODE_V8_COVERAGE: 'coverage', ELECTRON_LOG_FILE: 'debug.log',
    ELECTRON_ENABLE_LOGGING: '1', ELECTRON_ENABLE_STACK_DUMPING: '1', ELECTRON_DISABLE_SANDBOX: '1',
  });
  const result = candidateChildEnvironment({ env, context });
  assert.deepEqual(result, {
    HOME: env.HOME, LOCALAPPDATA: env.LOCALAPPDATA, SystemRoot: env.SystemRoot,
    Path: env.Path, TEMP: env.TEMP,
    SHENYI_ISOLATED_PREVIEW_CONFIG: context.configFile,
    SHENYI_DESKTOP_DATA_DIR: context.desktopDataDirectory,
  });
  assert.equal(env.SHENYI_ISOLATED_PREVIEW_CONFIG, 'inherited-config');
  assert.equal(env.SHENYI_DESKTOP_DATA_DIR, 'inherited-profile');
});

test('child environment requires a complete candidate context', async () => {
  const { candidateChildEnvironment } = await launcher;
  for (const context of [undefined, null, {}, { configFile: 'x' }, { desktopDataDirectory: 'x' }]) {
    assert.throws(() => candidateChildEnvironment({ env: {}, context }));
  }
});

test('two real candidate roots get distinct ports, UUIDs, databases and pinned public device-proof methods', { timeout: 20000 }, async t => {
  const { createIsolatedPreviewService } = await launcher, own = await ownedDirectory(t);
  const results = await Promise.allSettled(['root-a', 'root-b'].map(async name => {
    const value = await createIsolatedPreviewService({ rootDirectory: path.join(own.directory, name) });
    own.cleanup.push(() => value.close()); return value;
  }));
  for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.stack);
  const [first, second] = results.map(result => result.value);
  assert.notEqual(first.address.port, second.address.port);
  assert.notEqual(first.context.directory, second.context.directory);
  assert.notEqual(first.context.candidateId, second.context.candidateId);
  assert.notEqual(first.context.profile.serverId, second.context.profile.serverId);
  for (const service of [first, second]) {
    const { context, address } = service; safeAddress(address);
    assert.match(context.candidateId, UUID); assert.match(context.profile.serverId, UUID);
    assert.equal(context.profile.apiBase, address.url);
    assert.ok(Object.isFrozen(context) && Object.isFrozen(context.profile));
    assert.equal(context.desktopDataDirectory, path.join(context.directory, 'desktop-data'));
    assert.equal(context.deviceVaultDirectory, path.join(context.directory, 'device-vault'));
    assert.ok((await fs.lstat(context.desktopDataDirectory)).isDirectory(), 'launcher creates the profile before returning the context');
    const methods = await publicMethods(address);
    assert.equal(methods.status, 200);
    assert.equal(methods.headers['x-shenyi-server-id'], context.profile.serverId);
    assert.deepEqual(methods.data.deviceBinding, { required: true,
      serverId: context.profile.serverId, protocolVersion: 1 });
    assert.equal(methods.data.mode, 'local-preview'); assert.equal(methods.data.methods.demoUsername, true);
    const loaded = await configuration.loadIsolatedPreviewConfiguration({
      rootDirectory: path.dirname(context.directory), env: {
        SHENYI_ISOLATED_PREVIEW_CONFIG: context.configFile,
        SHENYI_DESKTOP_DATA_DIR: context.desktopDataDirectory,
      }, isPackaged: false,
    });
    assert.deepEqual(loaded.profile, context.profile);
    const filename = path.join(context.directory, 'team-demo.sqlite');
    assert.ok((await fs.stat(filename)).isFile());
    const db = new DatabaseSync(filename, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value, context.profile.serverId);
      assert.equal(db.prepare("SELECT value FROM team_database_metadata WHERE name='demo'").get().value, 'true');
    } finally { db.close(); }
    const started = JSON.parse(await fs.readFile(path.join(context.directory, 'started.json'), 'utf8'));
    assert.equal(started.candidateId, context.candidateId); assert.equal(started.serverId, context.profile.serverId);
    assert.equal(started.apiBase, context.profile.apiBase);
  }
});

test('candidate close is idempotent, refuses new connections and retains config and synthetic database', { timeout: 15000 }, async t => {
  const { createIsolatedPreviewService } = await launcher, own = await ownedDirectory(t);
  const service = await createIsolatedPreviewService({ rootDirectory: path.join(own.directory, 'root') });
  own.cleanup.push(() => service.close()); safeAddress(service.address);
  const configBefore = await fs.readFile(service.context.configFile);
  const closing = service.close(); assert.equal(service.close(), closing);
  await closing; await service.close();
  assert.equal(service.server.listening, false); assert.equal(service.server.address(), null);
  await refused(service.address);
  assert.deepEqual(await fs.readFile(service.context.configFile), configBefore);
  const filename = path.join(service.context.directory, 'team-demo.sqlite'), db = new DatabaseSync(filename, { readOnly: true });
  try { assert.equal(db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value, service.context.profile.serverId); }
  finally { db.close(); }
  const closed = JSON.parse(await fs.readFile(path.join(service.context.directory, 'closed.json'), 'utf8'));
  assert.equal(closed.schemaVersion, 1); assert.equal(closed.candidateId, service.context.candidateId);
  assert.ok(Number.isFinite(Date.parse(closed.closedAt)));
});

test('configuration-write failure closes its real listener and database while retaining failure evidence', { timeout: 15000 }, async t => {
  const { createIsolatedPreviewService } = await launcher, own = await ownedDirectory(t);
  const sentinel = Object.assign(Error('synthetic candidate configuration failure'), { code: 'SYNTHETIC_CONFIG_WRITE_FAILURE' });
  const open = fs.open.bind(fs), listen = net.Server.prototype.listen, dbClose = DatabaseSync.prototype.close;
  const servers = [], databases = []; let filename, bound;
  t.mock.method(fs, 'open', async (...args) => {
    if (path.basename(args[0]) === 'candidate.json') { filename = args[0]; throw sentinel; }
    return open(...args);
  });
  t.mock.method(net.Server.prototype, 'listen', function (...args) {
    servers.push(this); this.once('listening', () => { const value = this.address();
      bound = { host: '127.0.0.1', port: value.port, url: 'http://127.0.0.1:' + value.port }; });
    return listen.apply(this, args);
  });
  t.mock.method(DatabaseSync.prototype, 'close', function () { databases.push(this); return dbClose.call(this); });
  own.cleanup.push(async () => {
    for (const server of servers) if (server.listening) {
      server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
  await assert.rejects(createIsolatedPreviewService({ rootDirectory: path.join(own.directory, 'root') }), value => value === sentinel);
  assert.equal(servers.length, 1); assert.equal(servers[0].listening, false);
  assert.equal(databases.length, 1); assert.throws(() => databases[0].prepare('SELECT 1'));
  await refused(bound);
  const directory = path.dirname(filename), record = JSON.parse(await fs.readFile(path.join(directory, 'startup-failed.json'), 'utf8'));
  assert.equal(record.code, sentinel.code); assert.match(record.candidateId, UUID);
  await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(directory, 'started.json')), { code: 'ENOENT' });
  assert.ok((await fs.stat(path.join(directory, 'team-demo.sqlite'))).isFile());
});

async function mainStartupFailure(env) {
  const seen = { errors: [], quit: false, files: 0 }, app = new EventEmitter();
  let finish; const completed = new Promise(resolve => { finish = resolve; });
  Object.assign(app, { isPackaged: false, enableSandbox() {}, quit() { seen.quit = true; finish(); },
    exit(code) { seen.exitCode = code; finish(); } });
  const deps = {
    electron: { app, protocol: { registerSchemesAsPrivileged() {} } },
    'node:fs/promises': { mkdir() { seen.files++; throw Error('startup must already have stopped'); } },
    'node:path': path,
    './isolated-preview-config.cjs': { async loadIsolatedPreviewConfiguration() {
      if (Object.hasOwn(env, 'SHENYI_ISOLATED_PREVIEW_CONFIG')) throw Error('synthetic invalid isolated config');
      return null;
    } },
    './team-service-config.cjs': { async loadTeamServiceConfiguration() { throw Error('synthetic invalid normal config'); } },
    './team-client.cjs': {}, './bridge.cjs': {}, './device-key-vault.cjs': {}, './device-key-directory.cjs': {},
    './native-checkout-intents.cjs': require('../desktop/native-checkout-intents.cjs'),
    './material-preview-window.cjs': { PREVIEW_SCHEME: 'shenyi-preview' },
  };
  vm.runInNewContext(syncFs.readFileSync(path.resolve(__dirname, '../desktop/main.cjs'), 'utf8'), {
    require(name) { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; },
    __dirname: path.resolve(__dirname, '../desktop'), process: { env, platform: process.platform },
    console: { error(message) { seen.errors.push(message); } }, URL, Response,
  });
  await completed; return seen;
}
test('isolated main startup failures exit nonzero before file, vault or window creation', { timeout: 2000 }, async () => {
  for (const SHENYI_ISOLATED_PREVIEW_CONFIG of [path.join(BASE, 'invalid-candidate.json'), '']) {
    const seen = await mainStartupFailure({ SHENYI_ISOLATED_PREVIEW_CONFIG });
    assert.equal(seen.exitCode, 1); assert.equal(seen.quit, false);
    assert.equal(seen.files, 0); assert.equal(seen.errors.length, 1);
  }
});
test('normal main startup failure preserves the existing quit behavior', { timeout: 2000 }, async () => {
  const seen = await mainStartupFailure({});
  assert.equal(seen.quit, true); assert.equal(seen.exitCode, undefined);
  assert.equal(seen.files, 0); assert.equal(seen.errors.length, 1);
});

// This VM starts at JavaScript module execution, after native Chromium startup.
// It verifies the JS ordering contract without claiming native-cache isolation.
async function isolatedMainProfile(switchValue) {
  const candidateId = '12345678-abcd-4bcd-8bcd-123456789abc';
  const directory = path.join(BASE, 'candidate-' + candidateId);
  const context = Object.freeze({ candidateId, directory,
    desktopDataDirectory: path.join(directory, 'desktop-data'),
    deviceVaultDirectory: path.join(directory, 'device-vault'),
    configFile: path.join(directory, 'candidate.json'),
    profile: Object.freeze({ schemaVersion: 1, apiBase: 'http://127.0.0.1:18941',
      serverId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }),
  });
  const seen = { events: [], paths: [], mkdir: [], errors: [], quit: false };
  const app = new EventEmitter(), isolated = new EventEmitter(), power = new EventEmitter();
  let finish; const completed = new Promise(resolve => { finish = resolve; });
  Object.assign(app, { isPackaged: false, enableSandbox() {},
    commandLine: { getSwitchValue(name) { assert.equal(name, 'user-data-dir'); seen.events.push('cli');
      return switchValue === 'MATCH' ? context.desktopDataDirectory : switchValue; } },
    setPath(name, value) { seen.events.push('path:' + name); seen.paths.push({ name, value }); },
    requestSingleInstanceLock() { seen.events.push('lock'); return true; },
    async whenReady() { seen.events.push('ready'); },
    quit() { seen.events.push('quit'); seen.quit = true; finish(); },
    exit(code) { seen.events.push('exit:' + code); seen.exitCode = code; finish(); },
    getPath() { throw Error('isolated startup must not use a default profile'); },
  });
  Object.assign(isolated, { setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    webRequest: { onBeforeRequest() {} }, protocol: { handle() {} } });
  class Window extends EventEmitter {
    constructor() { super(); seen.events.push('window'); seen.window = this;
      this.webContents = new EventEmitter(); this.webContents.setWindowOpenHandler = () => {}; }
    async loadURL(value) { assert.equal(value, 'shenyi://app/index.html'); seen.events.push('loadURL'); }
    setTitle(value) { seen.title = value; }
    show() { seen.events.push('show'); finish(); }
  }
  const deps = {
    electron: { app, BrowserWindow: Window, powerMonitor: power, safeStorage: {},
      session: { fromPartition() { seen.events.push('session'); return isolated; } },
      protocol: { registerSchemesAsPrivileged() {} }, ipcMain: {}, dialog: {},
      Menu: { setApplicationMenu() {} }, shell: { openExternal() { throw Error('unexpected external request'); } } },
    'node:path': path,
    'node:fs/promises': { async mkdir(value, options) {
      seen.events.push('mkdir'); seen.mkdir.push({ value, recursive: options.recursive });
    } },
    './isolated-preview-config.cjs': { async loadIsolatedPreviewConfiguration() {
      seen.events.push('isolated-config-read'); seen.events.push('isolated-configured'); return context;
    } },
    './team-service-config.cjs': { async loadTeamServiceConfiguration() {
      seen.events.push('legacy-config'); throw Error('isolated startup must not use the legacy service');
    } },
    './team-client.cjs': { API_BASE: 'http://127.0.0.1:8774', createTeamClient(options) {
      seen.events.push('client'); seen.clientOptions = options;
      return { async checkDeviceConnection() {}, pauseDeviceConnection() {} };
    } },
    './bridge.cjs': { APP_URL: 'shenyi://app/index.html', registerDesktopBridge() { return () => {}; } },
    './device-key-vault.cjs': { createDeviceKeyVault(options) {
      seen.events.push('vault'); seen.vaultOptions = options; return { dispose() {} };
    } },
    './device-key-directory.cjs': { resolveDeviceVaultDirectory() {
      seen.events.push('legacy-vault'); throw Error('isolated startup must not resolve the legacy vault');
    } },
    './native-checkout-intents.cjs': require('../desktop/native-checkout-intents.cjs'),
    './material-preview-window.cjs': { PREVIEW_SCHEME: 'shenyi-preview' },
  };
  vm.runInNewContext(syncFs.readFileSync(path.resolve(__dirname, '../desktop/main.cjs'), 'utf8'), {
    require(name) { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; },
    __dirname: path.resolve(__dirname, '../desktop'), process: { platform: process.platform,
      env: { SHENYI_ISOLATED_PREVIEW_CONFIG: context.configFile,
        SHENYI_DESKTOP_DATA_DIR: context.desktopDataDirectory } },
    console: { error(value) { seen.errors.push(value); } }, URL, Response,
    setInterval() { return { unref() {} }; }, clearInterval() {},
  });
  await completed;
  return { seen, context };
}

test('isolated main matches CLI profile and sets userData plus sessionData before session, vault or window', { timeout: 2000 }, async t => {
  const { seen, context } = await isolatedMainProfile('MATCH');
  t.after(() => { seen.window?.emit('closed'); });
  assert.equal(seen.exitCode, undefined); assert.equal(seen.quit, false); assert.deepEqual(seen.errors, []);
  assert.deepEqual(seen.paths, [{ name: 'sessionData', value: context.desktopDataDirectory },
    { name: 'userData', value: context.desktopDataDirectory }]);
  assert.deepEqual(seen.mkdir, [{ value: context.desktopDataDirectory, recursive: true }]);
  for (const stage of ['session', 'vault', 'window']) {
    assert.ok(seen.events.indexOf('path:sessionData') < seen.events.indexOf(stage), stage);
    assert.ok(seen.events.indexOf('path:userData') < seen.events.indexOf(stage), stage);
  }
  assert.ok(seen.events.indexOf('isolated-configured') < seen.events.indexOf('cli'));
  assert.ok(seen.events.indexOf('cli') < seen.events.indexOf('path:sessionData'));
  assert.equal(seen.events.includes('legacy-config'), false); assert.equal(seen.events.includes('legacy-vault'), false);
  assert.equal(seen.vaultOptions.directory, context.deviceVaultDirectory);
  assert.equal(seen.clientOptions.isolatedPreview, context.profile);
  assert.equal(Object.hasOwn(seen.clientOptions, 'trustedService'), false);
  assert.equal(seen.events.at(-1), 'show');
});

test('isolated main rejects missing or mismatched CLI after config read without profile writes or legacy fallback', { timeout: 2000 }, async () => {
  for (const value of [undefined, '', path.join(BASE, 'other-desktop-data'),
    path.join(BASE, 'candidate-12345678-abcd-4bcd-8bcd-123456789abc', 'desktop-data') + path.sep]) {
    const { seen } = await isolatedMainProfile(value);
    assert.deepEqual(seen.events, ['isolated-config-read', 'isolated-configured', 'cli', 'exit:1']);
    assert.equal(seen.exitCode, 1); assert.equal(seen.quit, false);
    assert.deepEqual(seen.paths, []); assert.deepEqual(seen.mkdir, []);
    assert.equal(seen.clientOptions, undefined); assert.equal(seen.vaultOptions, undefined);
    assert.equal(seen.window, undefined); assert.equal(seen.errors.length, 1);
  }
});
