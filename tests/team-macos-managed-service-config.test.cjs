'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { readFileSync } = require('node:fs');

const source = readFileSync(path.join(__dirname, '../desktop/team-service-config.cjs'), 'utf8');
const parents = ['/', '/Library', '/Library/Application Support'];
const directory = `${parents[2]}/ShenyiTeamDesktop`;
const configPath = `${directory}/team-service.json`;
const alternate = '/local-test/team-service.json';
const flags = { W_OK: 2, O_RDONLY: 0, O_NOFOLLOW: 0x100, O_NONBLOCK: 0x200 };
const configured = { schemaVersion: 1, apiBase: 'https://managed.example', serverId: 'aabbccdd-0000-4000-8000-ff0000000000' };
const fallback = { ...configured, apiBase: 'https://isolated.example' };
const failure = { code: 'TEAM_SERVICE_CONFIGURATION_INVALID' };

function fsError(code) { return Object.assign(new Error(code), { code }); }

function mountedFixture({ platform = 'darwin', absent = false, managed = JSON.stringify(configured) } = {}) {
  const entries = new Map();
  const buffers = new Map([[configPath, Buffer.from(managed)], [alternate, Buffer.from(JSON.stringify(fallback))]]);
  const opens = [], readOnly = [], lookedUp = [];
  function entry(name, type, mode) {
    entries.set(name, { uid: 0n, gid: 0n, mode: BigInt(mode), dev: 1n, ino: BigInt(entries.size + 1), nlink: 1n,
      mtimeNs: 1n, ctimeNs: 1n, size: BigInt(buffers.get(name)?.length ?? 0),
      isDirectory: () => type === 'dir', isFile: () => type === 'file' });
  }
  for (const name of parents) entry(name, 'dir', 0o755);
  entry(alternate, 'file', 0o644);
  if (!absent) {
    entry(directory, 'dir', 0o755);
    entry(configPath, 'file', 0o644);
  }
  const filesystem = {
    async lstat(filename) {
      lookedUp.push(filename);
      const stat = entries.get(filename);
      if (!stat) throw fsError('ENOENT');
      return { ...stat };
    },
    async realpath(filename) { return entries.get(filename).realPath ?? filename; },
    async access(filename, mask) {
      assert.equal(mask, flags.W_OK);
      readOnly.push(filename);
      const stat = entries.get(filename);
      if (!stat) throw fsError('ENOENT');
      if (!stat.writable) throw fsError('EACCES');
    },
    async open(filename, accessFlags) {
      opens.push([filename, accessFlags]);
      const stat = { ...entries.get(filename) };
      const buffer = buffers.get(filename);
      let position = 0;
      return {
        async stat(options) { return options?.bigint ? { ...stat } : { ...stat, size: Number(stat.size) }; },
        async read(destination, offset, length) {
          const count = buffer.copy(destination, offset, position, position + length);
          position += count;
          stat.onRead?.();
          return { bytesRead: count };
        },
        async close() {},
      };
    },
  };
  const dependencies = { 'node:fs/promises': filesystem, 'node:fs': { constants: flags }, 'node:path': path.posix, 'node:net': require('node:net') };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, require: name => dependencies[name], process: { platform, env: {} }, Buffer, TextDecoder, URL });
  return { entries, load: module.exports.loadTeamServiceConfiguration, lookedUp, opens, readOnly };
}

test('packaged Mac defaults to the protected site profile and never opens a competing environment path', async () => {
  const f = mountedFixture();
  f.entries.get(parents[2]).gid = 80n;
  f.entries.get(parents[2]).mode = 0o775n;
  const env = { SHENYI_TEAM_API: configured.apiBase, NODE_TLS_REJECT_UNAUTHORIZED: '1' };
  Object.defineProperty(env, 'SHENYI_TEAM_SERVICE_CONFIG', { get() { throw new Error('must not read override'); } });
  const result = await f.load({ env, isPackaged: true });
  assert.equal(JSON.stringify(result.profile), JSON.stringify(configured));
  assert.equal(result.mode, 'remote-https');
  assert.deepEqual(f.opens, [[configPath, flags.O_NOFOLLOW | flags.O_NONBLOCK]]);
  assert.ok(parents.every(name => f.readOnly.includes(name)));
});

test('a packaged Mac can load a version 2 WeChat profile from the protected Finder path', async () => {
  const profile = {...configured, schemaVersion: 2, wechatAppId: 'wx0123456789abcdef'};
  const f = mountedFixture({managed: JSON.stringify(profile)});
  const result = await f.load({env: {}, isPackaged: true});
  assert.equal(JSON.stringify(result.profile), JSON.stringify(profile));
  assert.ok(Object.isFrozen(result.profile));
  assert.deepEqual(f.opens, [[configPath, flags.O_NOFOLLOW | flags.O_NONBLOCK]]);

  const incomplete = mountedFixture({managed: JSON.stringify({...configured, schemaVersion: 2})});
  await assert.rejects(incomplete.load({env: {SHENYI_TEAM_SERVICE_CONFIG: alternate}, isPackaged: true}), failure);
  assert.deepEqual(incomplete.opens, [[configPath, flags.O_NOFOLLOW | flags.O_NONBLOCK]]);
});

test('an absent directory permits explicit test configuration only under a trusted parent on packaged Mac', async () => {
  const f = mountedFixture({ absent: true });
  const env = { SHENYI_TEAM_SERVICE_CONFIG: alternate };
  await assert.rejects(f.load({ isPackaged: true }), failure);
  assert.equal((await f.load({ env, isPackaged: true })).profile.apiBase, fallback.apiBase);
  f.entries.get(parents[2]).writable = true;
  await assert.rejects(f.load({ env, isPackaged: true }), failure);
  assert.deepEqual(f.opens, [[alternate, 'r']]);
  const duringRead = mountedFixture({ absent: true });
  const deployment = mountedFixture();
  duringRead.entries.get(alternate).onRead = () => {
    for (const name of [directory, configPath]) duringRead.entries.set(name, deployment.entries.get(name));
  };
  await assert.rejects(duringRead.load({ env, isPackaged: true }), failure);

  const preview = mountedFixture();
  assert.equal((await preview.load({ env: {} })).mode, 'local-preview');
  assert.deepEqual(preview.lookedUp, []);
});

test('an invalid managed profile fails closed without trying an explicit config file', async () => {
  const env = { SHENYI_TEAM_SERVICE_CONFIG: alternate };
  const invalidCases = [
    f => f.entries.delete(configPath),
    f => { f.entries.get(configPath).uid = 501n; },
    f => { f.entries.get(configPath).nlink = 2n; },
    f => { f.entries.get(configPath).writable = true; },
    f => { f.entries.get(configPath).realPath = alternate; },
    f => { f.entries.get(directory).mode = 0o775n; },
    f => { f.entries.get(configPath).onRead = () => { f.entries.get(configPath).ino++; }; },
    f => { f.entries.get(configPath).onRead = () => { f.entries.get(directory).ino++; }; },
  ];
  for (const change of invalidCases) {
    const f = mountedFixture();
    change(f);
    await assert.rejects(f.load({ env, isPackaged: true }), failure);
    assert.ok(f.opens.every(([filename]) => filename === configPath));
  }
  await assert.rejects(mountedFixture({ managed: '{}' }).load({ env, isPackaged: true }), failure);
  for (const key of ['NODE_EXTRA_CA_CERTS', 'NODE_OPTIONS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'OPENSSL_CONF', 'OPENSSL_MODULES']) {
    await assert.rejects(mountedFixture().load({ env: { ...env, [key]: '' }, isPackaged: true }), failure);
  }
  await assert.rejects(mountedFixture().load({ env: { ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, isPackaged: true }), failure);
  await assert.rejects(mountedFixture().load({ env: { ...env, SHENYI_TEAM_API: fallback.apiBase }, isPackaged: true }), failure);
});
