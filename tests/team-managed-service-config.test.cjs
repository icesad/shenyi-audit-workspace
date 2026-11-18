'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

async function fixture() {
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-managed-config-'));
  const filename = path.join(directory, 'service.json');
  const configuration = {
    schemaVersion: 1, database: path.join(directory, 'team.sqlite'), apiBase: 'https://127.0.0.1:9443',
    serverId: randomUUID(), listenPort: 9443, tlsCertificate: path.join(directory, 'server.pem'), tlsKey: path.join(directory, 'server-key.pem'),
  };
  return { directory, filename, configuration };
}

test('managed config accepts only an exact HTTPS profile and distinct absolute external paths', async () => {
  const { loadManagedServiceConfiguration } = await import('../scripts/start-team-service.mjs');
  const { filename, configuration } = await fixture();
  await fs.writeFile(filename, JSON.stringify(configuration, null, 2), { flag: 'wx' });
  assert.deepEqual(await loadManagedServiceConfiguration(filename), configuration);
  const invalid = { code: 'MANAGED_SERVICE_CONFIGURATION_INVALID' };
  for (const change of [
    { database: 'relative.sqlite' }, { tlsKey: configuration.tlsCertificate }, { tlsKey: path.join(__dirname, 'team-managed-service-config.test.cjs') },
    { apiBase: 'http://127.0.0.1:9443' }, { apiBase: 'https://127.0.0.1:9443/path' }, { apiBase: 'https://account@127.0.0.1:9443' },
    { serverId: 'unknown' }, { listenPort: 65536 }, { mode: 'demo' },
  ]) {
    await fs.writeFile(filename, JSON.stringify({ ...configuration, ...change }));
    await assert.rejects(loadManagedServiceConfiguration(filename), invalid);
  }
  const duplicate = JSON.stringify(configuration).replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1');
  await fs.writeFile(filename, duplicate);
  await assert.rejects(loadManagedServiceConfiguration(filename), invalid);
});

test('configured service refuses an absent database without creating it', async () => {
  const { openConfiguredTeamService } = await import('../scripts/start-team-service.mjs');
  const { filename, configuration } = await fixture();
  await fs.writeFile(filename, JSON.stringify(configuration), { flag: 'wx' });
  await fs.writeFile(configuration.tlsCertificate, 'synthetic placeholder', { flag: 'wx' });
  await fs.writeFile(configuration.tlsKey, 'synthetic placeholder', { flag: 'wx' });
  await assert.rejects(openConfiguredTeamService(filename), { code: 'MANAGED_DATABASE_NOT_READY' });
  await assert.rejects(fs.stat(configuration.database), { code: 'ENOENT' });
});

test('managed SMS is opt-in through a distinct absolute profile and fails before database access on invalid data', async () => {
  const { loadManagedServiceConfiguration, openConfiguredTeamService } = await import('../scripts/start-team-service.mjs');
  const { directory, filename, configuration } = await fixture();
  const smsProfile = path.join(directory, 'sms-private.json');
  const write = value => fs.writeFile(filename, JSON.stringify(value));
  await write(configuration);
  assert.equal(Object.hasOwn(await loadManagedServiceConfiguration(filename), 'smsProfile'), false);
  for (const value of ['relative.json', configuration.tlsKey, null]) {
    await write({ ...configuration, smsProfile: value });
    await assert.rejects(loadManagedServiceConfiguration(filename), { code: 'MANAGED_SERVICE_CONFIGURATION_INVALID' });
  }
  await write({ ...configuration, smsProfile });
  assert.equal((await loadManagedServiceConfiguration(filename)).smsProfile, smsProfile);
  const sendError = { code: 'MANAGED_SMS_INVALID', message: '短信服务配置无效。请检查独立配置文件及模板。' };
  await assert.rejects(openConfiguredTeamService(filename), sendError);
  const profile = { schemaVersion: 1, provider: 'aliyun', accessKeyId: 'synthetic-key', accessKeySecret: 'synthetic-only',
    phonePepper: Buffer.alloc(32, 42).toString('base64url'), signName: '合成测试',
    templates: { bind: 'SMS_1001', reset: 'SMS_1002', activate: 'SMS_1003', 'first-admin': 'SMS_1004' },
  };
  const validProfile = JSON.stringify(profile);
  await fs.writeFile(smsProfile, validProfile, { flag: 'wx' });
  await assert.rejects(openConfiguredTeamService(filename), { code: 'MANAGED_TLS_INVALID' });
  const ambiguous = validProfile.replace('"bind":"SMS_1001"', '"bind":"SMS_1002","b\\u0069nd":"SMS_1001"');
  await fs.writeFile(smsProfile, ambiguous);
  await assert.rejects(openConfiguredTeamService(filename), sendError);
  await assert.rejects(fs.stat(configuration.database), { code: 'ENOENT' });
});
