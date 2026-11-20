'use strict';
// These fixtures never open existing preview processes, listeners or databases.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  defaultIsolatedPreviewRoot, validateIsolatedPreviewProfile,
  prepareIsolatedPreviewDirectory, writeIsolatedPreviewConfiguration,
  loadIsolatedPreviewConfiguration,
} = require('../desktop/isolated-preview-config.cjs');
const { validateTrustedTeamService } = require('../desktop/team-service-config.cjs');
const BASE = path.join(os.tmpdir(), 'shenyi-isolated-preview-tests');
const PROFILE = Object.freeze({ schemaVersion: 1, apiBase: 'http://127.0.0.1:18941',
  serverId: '12345678-abcd-4bcd-8bcd-123456789abc' });
const invalid = error => error?.code === 'ISOLATED_PREVIEW_CONFIGURATION_INVALID';

async function sandbox(t) {
  await fs.mkdir(BASE, { recursive: true });
  const parent = await fs.mkdtemp(path.join(BASE, 'config-'));
  t.after(async () => {
    const absolute = path.resolve(parent);
    assert.ok(absolute.startsWith(BASE + path.sep));
    await fs.rm(absolute, { recursive: true, force: true });
  });
  return { parent, rootDirectory: path.join(parent, 'root') };
}
async function fixture(t) {
  const own = await sandbox(t);
  const prepared = await prepareIsolatedPreviewDirectory({ rootDirectory: own.rootDirectory });
  // Runtime consumers create these two fresh children; the helper returns paths.
  await fs.mkdir(prepared.desktopDataDirectory);
  await fs.mkdir(prepared.deviceVaultDirectory);
  await writeIsolatedPreviewConfiguration({ ...prepared, ...PROFILE });
  const raw = await fs.readFile(prepared.configFile);
  return { ...own, ...prepared, raw, record: JSON.parse(raw.toString('utf8')), env: {
    SHENYI_ISOLATED_PREVIEW_CONFIG: prepared.configFile,
    SHENYI_DESKTOP_DATA_DIR: prepared.desktopDataDirectory,
  } };
}
const load = (f, extra = {}) => loadIsolatedPreviewConfiguration({
  rootDirectory: f.rootDirectory, env: f.env, isPackaged: false, ...extra,
});
const encode = record => JSON.stringify(record) + '\n';

test('isolated profile snapshots and freezes only the three identity fields', () => {
  const input = { ...PROFILE }, actual = validateIsolatedPreviewProfile(input);
  assert.deepEqual(actual, PROFILE); assert.notEqual(actual, input);
  assert.ok(Object.isFrozen(actual));
  assert.deepEqual(Reflect.ownKeys(actual), ['schemaVersion', 'apiBase', 'serverId']);
  input.apiBase = 'http://127.0.0.1:18942';
  assert.equal(actual.apiBase, PROFILE.apiBase);
  assert.throws(() => { actual.serverId = 'changed'; }, TypeError);
});
test('canonical loopback range is inclusive without relaxing the HTTPS validator', () => {
  for (const port of [1024, 18941, 65535]) {
    const value = { ...PROFILE, apiBase: 'http://127.0.0.1:' + port };
    assert.deepEqual(validateIsolatedPreviewProfile(value), value);
    assert.throws(() => validateTrustedTeamService(value), { code: 'TEAM_SERVICE_CONFIGURATION_INVALID' });
  }
});
test('isolated profile rejects shared ports, other hosts and URL normalization', () => {
  for (const apiBase of [
    'http://127.0.0.1:8773', 'http://127.0.0.1:8774', 'http://127.0.0.1:1023',
    'http://127.0.0.1:65536', 'http://127.0.0.1:0', 'http://127.0.0.1:018941',
    'http://127.0.0.1', 'http://localhost:18941', 'http://[::1]:18941',
    'http://127.1:18941', 'http://2130706433:18941', 'http://0x7f000001:18941',
    'http://127.0.0.2:18941', 'http://example.invalid:18941', 'https://127.0.0.1:18941',
    'HTTP://127.0.0.1:18941', PROFILE.apiBase + '/', PROFILE.apiBase + '/..',
    PROFILE.apiBase + '?', PROFILE.apiBase + '#', PROFILE.apiBase + '/api',
    'http://user:pass@127.0.0.1:18941', 'http://@127.0.0.1:18941',
    ' ' + PROFILE.apiBase, PROFILE.apiBase + '\n', PROFILE.apiBase + '\u0085',
    'http:\\127.0.0.1:18941', null, 18941, [PROFILE.apiBase],
    { toString() { throw Error('must not coerce'); } },
  ]) assert.throws(() => validateIsolatedPreviewProfile({ ...PROFILE, apiBase }), invalid);
});
test('isolated profile refuses wrong schema and noncanonical UUID identities', () => {
  for (const schemaVersion of [0, 2, '1', true, null, [1], NaN]) {
    assert.throws(() => validateIsolatedPreviewProfile({ ...PROFILE, schemaVersion }), invalid);
  }
  for (const serverId of [PROFILE.serverId.toUpperCase(),
    PROFILE.serverId.replace('-4bcd-', '-1bcd-'), PROFILE.serverId.replace('-8bcd-', '-7bcd-'),
    PROFILE.serverId + ' ', [PROFILE.serverId], null, 1,
    { toString() { return PROFILE.serverId; } },
  ]) assert.throws(() => validateIsolatedPreviewProfile({ ...PROFILE, serverId }), invalid);
});
test('isolated profile rejects getters, inherited, hidden, symbolic and extra fields', () => {
  let getters = 0;
  const accessor = { ...PROFILE };
  Object.defineProperty(accessor, 'apiBase', { enumerable: true, get() { getters++; return PROFILE.apiBase; } });
  const hidden = { ...PROFILE };
  Object.defineProperty(hidden, 'serverId', { value: PROFILE.serverId, enumerable: false });
  for (const value of [undefined, null, [], Object.assign(Object.create(null), PROFILE),
    Object.assign(Object.create({ inherited: true }), PROFILE), accessor, hidden,
    { ...PROFILE, [Symbol('private')]: true }, { ...PROFILE, extra: true },
    { ...PROFILE, rejectUnauthorized: false }, { schemaVersion: 1, apiBase: PROFILE.apiBase },
  ]) assert.throws(() => validateIsolatedPreviewProfile(value), invalid);
  assert.equal(getters, 0);
});
test('absence of opt-in returns null without inspecting any directory', async () => {
  for (const isPackaged of [false, true]) {
    assert.equal(await loadIsolatedPreviewConfiguration({ env: {}, isPackaged, rootDirectory: '\0never-open' }), null);
  }
});
test('default root selection is deterministic without creating a directory', () => {
  const actual = defaultIsolatedPreviewRoot();
  assert.equal(actual, defaultIsolatedPreviewRoot());
  assert.equal(typeof actual, 'string'); assert.ok(path.isAbsolute(actual));
});
test('prepare creates fresh UUID candidates with separate data and vault directories', async t => {
  const f = await sandbox(t);
  const first = await prepareIsolatedPreviewDirectory({ rootDirectory: f.rootDirectory });
  const second = await prepareIsolatedPreviewDirectory({ rootDirectory: f.rootDirectory });
  assert.notEqual(first.candidateId, second.candidateId); assert.notEqual(first.directory, second.directory);
  for (const value of [first, second]) {
    assert.match(value.candidateId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(value.directory, path.join(f.rootDirectory, 'candidate-' + value.candidateId));
    assert.equal(value.desktopDataDirectory, path.join(value.directory, 'desktop-data'));
    assert.equal(value.deviceVaultDirectory, path.join(value.directory, 'device-vault'));
    assert.equal(value.configFile, path.join(value.directory, 'candidate.json'));
    assert.ok((await fs.lstat(value.directory)).isDirectory());
    assert.ok(!(await fs.lstat(value.directory)).isSymbolicLink());
    await assert.rejects(fs.stat(value.configFile), { code: 'ENOENT' });
    await fs.mkdir(value.desktopDataDirectory);
    await fs.mkdir(value.deviceVaultDirectory);
  }
  await fs.writeFile(path.join(first.desktopDataDirectory, 'owned-sentinel'), 'first');
  assert.deepEqual(await fs.readdir(second.desktopDataDirectory), []);
});
test('unmarked existing root is refused without adopting or changing its contents', async t => {
  const f = await sandbox(t); await fs.mkdir(f.rootDirectory);
  await assert.rejects(async () => prepareIsolatedPreviewDirectory({ rootDirectory: f.rootDirectory }), invalid);
  assert.deepEqual(await fs.readdir(f.rootDirectory), []);
  const sentinel = path.join(f.rootDirectory, 'unknown-owner.txt');
  await fs.writeFile(sentinel, 'do not adopt');
  await assert.rejects(async () => prepareIsolatedPreviewDirectory({ rootDirectory: f.rootDirectory }), invalid);
  assert.deepEqual(await fs.readdir(f.rootDirectory), ['unknown-owner.txt']);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'do not adopt');
});
test('canonical candidate loads a frozen profile with exact private locations', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.record, { schemaVersion: 1, kind: 'shenyi-isolated-preview-v1',
    candidateId: f.candidateId, apiBase: PROFILE.apiBase, serverId: PROFILE.serverId });
  assert.equal(f.raw.toString('utf8'), encode(f.record));
  const actual = await load(f); assert.deepEqual(actual.profile, PROFILE);
  for (const key of ['directory', 'candidateId', 'desktopDataDirectory', 'deviceVaultDirectory']) {
    assert.equal(actual[key], f[key]);
  }
  assert.ok(Object.isFrozen(actual.profile));
  await fs.writeFile(f.configFile, 'invalid after load'); assert.deepEqual(actual.profile, PROFILE);
});
test('write never replaces an existing candidate record', async t => {
  const f = await fixture(t);
  await assert.rejects(async () => writeIsolatedPreviewConfiguration({ ...f, ...PROFILE }), error => error?.code === 'EEXIST' || invalid(error));
  assert.deepEqual(await fs.readFile(f.configFile), f.raw);
});
test('invalid write inputs cannot leave a candidate record', async t => {
  const f = await sandbox(t), prepared = await prepareIsolatedPreviewDirectory({ rootDirectory: f.rootDirectory });
  for (const patch of [{ apiBase: 'http://127.0.0.1:8774' }, { apiBase: PROFILE.apiBase + '/' },
    { serverId: PROFILE.serverId.toUpperCase() }, { candidateId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }]) {
    await assert.rejects(async () => writeIsolatedPreviewConfiguration({ ...prepared, ...PROFILE, ...patch }), invalid);
    await assert.rejects(fs.stat(prepared.configFile), { code: 'ENOENT' });
  }
});
test('packaged opt-in and either legacy service override fail closed', async t => {
  const f = await fixture(t); await assert.rejects(load(f, { isPackaged: true }), invalid);
  for (const [key, value] of [['SHENYI_TEAM_API', PROFILE.apiBase], ['SHENYI_TEAM_API', ''],
    ['SHENYI_TEAM_SERVICE_CONFIG', f.configFile], ['SHENYI_TEAM_SERVICE_CONFIG', '']]) {
    await assert.rejects(load(f, { env: { ...f.env, [key]: value } }), invalid);
  }
});
test('desktop data location is required and must exactly match the candidate directory', async t => {
  const f = await fixture(t), absent = { ...f.env }; delete absent.SHENYI_DESKTOP_DATA_DIR;
  await assert.rejects(load(f, { env: absent }), invalid);
  for (const value of ['', null, [f.desktopDataDirectory], f.directory, f.deviceVaultDirectory,
    f.desktopDataDirectory + path.sep, path.join(f.directory, 'desktop-data', '..')]) {
    await assert.rejects(load(f, { env: { ...f.env, SHENYI_DESKTOP_DATA_DIR: value } }), invalid);
  }
});
test('config environment values cannot coerce or execute accessors', async t => {
  const f = await fixture(t);
  for (const value of ['', undefined, null, [f.configFile], 1, 'relative.json', 'C:relative.json',
    '\\relative.json', '//host/share/candidate.json', f.configFile + '\n', f.configFile + '\0']) {
    await assert.rejects(load(f, { env: { ...f.env, SHENYI_ISOLATED_PREVIEW_CONFIG: value } }), invalid);
  }
  let count = 0; const env = { ...f.env };
  Object.defineProperty(env, 'SHENYI_ISOLATED_PREVIEW_CONFIG', { get() { count++; return f.configFile; } });
  await assert.rejects(load(f, { env }), invalid); assert.equal(count, 0);
});
test('canonical JSON refuses duplicate or escaped fields, whitespace, invalid UTF8 and reordered keys', async t => {
  const f = await fixture(t), canonical = f.raw.toString('utf8');
  const reordered = { serverId: f.record.serverId, apiBase: f.record.apiBase,
    candidateId: f.candidateId, kind: f.record.kind, schemaVersion: 1 };
  for (const [label, body] of Object.entries({ empty: '', syntax: '{', null: 'null', array: '[]',
    trailingSpace: canonical + ' ', BOM: '\ufeff' + canonical,
    pretty: JSON.stringify(f.record, null, 2), reordered: encode(reordered),
    duplicate: canonical.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    escapedDuplicate: canonical.replace('"apiBase":', '"api\\u0042ase":"http://127.0.0.1:18942","apiBase":'),
    escapedKey: canonical.replace('"serverId":', '"server\\u0049d":'),
    invalidUTF8: Buffer.from([0xff, 0xfe, 0x7b, 0x7d]),
  })) { await fs.writeFile(f.configFile, body); await assert.rejects(load(f), invalid, label); }
});
test('candidate record rejects unknown fields, wrong kind, mismatched candidate and invalid profile', async t => {
  const f = await fixture(t);
  for (const patch of [{ extra: true }, { kind: 'different' }, { schemaVersion: 2 },
    { candidateId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
    { apiBase: 'http://127.0.0.1:8774' }, { serverId: PROFILE.serverId.toUpperCase() }]) {
    await fs.writeFile(f.configFile, encode({ ...f.record, ...patch })); await assert.rejects(load(f), invalid);
  }
});
test('candidate config respects the 4096-byte limit and must be a regular file', async t => {
  const f = await fixture(t); await fs.writeFile(f.configFile, Buffer.alloc(4097, 32));
  const open = fs.open.bind(fs); let candidateOpens = 0;
  t.mock.method(fs, 'open', (...args) => { if (args[0] === f.configFile) candidateOpens++; return open(...args); });
  await assert.rejects(load(f), invalid);
  assert.equal(candidateOpens, 0, 'oversize rejection precedes opening and parsing the candidate');
  await fs.unlink(f.configFile); await fs.mkdir(f.configFile); await assert.rejects(load(f), invalid);
});
test('a file growing after stat remains bounded and its file handle is closed', async t => {
  const f = await fixture(t), open = fs.open.bind(fs);
  let grew = false, requested = 0, bytesRead = 0, closed = 0;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    if (args[0] !== f.configFile) return handle;
    const read = handle.read.bind(handle), close = handle.close.bind(handle);
    handle.read = async (...readArgs) => {
      if (!grew) { grew = true; await fs.appendFile(f.configFile, Buffer.alloc(50000, 32)); }
      requested += readArgs[2];
      const result = await read(...readArgs); bytesRead += result.bytesRead; return result;
    };
    handle.close = async () => { closed++; return close(); };
    return handle;
  });
  await assert.rejects(load(f), invalid);
  assert.equal(grew, true); assert.ok(bytesRead <= 4097); assert.ok(requested <= 4097);
  assert.equal(closed, 1);
});
test('candidate config cannot be renamed, placed outside its root or addressed through dot aliases', async t => {
  const f = await fixture(t), alternate = path.join(f.directory, 'other.json'), outside = path.join(f.parent, 'candidate.json');
  await fs.writeFile(alternate, f.raw); await fs.writeFile(outside, f.raw);
  for (const filename of [alternate, outside, f.directory + path.sep + '.' + path.sep + 'candidate.json',
    f.directory + path.sep + 'desktop-data' + path.sep + '..' + path.sep + 'candidate.json']) {
    await assert.rejects(load(f, { env: { ...f.env, SHENYI_ISOLATED_PREVIEW_CONFIG: filename } }), invalid);
  }
});
test('fixed ownership marker is required and tampering cannot be adopted by load or prepare', async t => {
  const f = await fixture(t), marker = path.join(f.rootDirectory, 'isolated-preview-root.json');
  assert.equal(await fs.readFile(marker, 'utf8'), encode({ schemaVersion: 1, kind: 'shenyi-isolated-preview-root' }));
  await fs.writeFile(marker, '{"kind":"unknown-owner"}\n');
  await assert.rejects(load(f), invalid);
  await assert.rejects(async () => prepareIsolatedPreviewDirectory({ rootDirectory: f.rootDirectory }), invalid);
  await fs.unlink(marker); await assert.rejects(load(f), invalid);
});
for (const linkAt of ['root', 'candidate', 'desktop-data', 'device-vault']) {
  test('load refuses an owned ' + linkAt + ' directory reached through symlink or junction', async t => {
    const f = await fixture(t), link = linkAt === 'root' ? f.rootDirectory : linkAt === 'candidate' ? f.directory
      : linkAt === 'desktop-data' ? f.desktopDataDirectory : f.deviceVaultDirectory;
    const backing = path.join(f.parent, 'backing-' + linkAt); await fs.rename(link, backing);
    // Directory junctions do not require Windows file-symlink privilege.
    await fs.symlink(backing, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.ok((await fs.lstat(link)).isSymbolicLink()); await assert.rejects(load(f), invalid);
  });
}
