'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');

const run = promisify(execFile);
const windowsOnly = { skip: process.platform !== 'win32' && 'Uses native Windows PowerShell and Shell Link.' };

async function setup(t) {
  const { resolveSystemPowerShell } = await import('../scripts/windows-candidate-authenticode.mjs');
  const windows = await resolveSystemPowerShell();
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "shenyi shortcut's test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const launcher = path.join(directory, 'start-windows-managed-desktop.ps1');
  const cli = path.join(directory, 'manage-windows-candidate-install.mjs');
  const root = path.join(directory, 'install source');
  const key = path.join(directory, 'trusted key.pem');
  const config = path.join(directory, 'trusted config.json');
  const shortcut = path.join(directory, 'Shenyi managed.lnk');
  const pin = 'a'.repeat(64);
  await fs.mkdir(root);
  await fs.copyFile(path.resolve(__dirname, '../scripts/start-windows-managed-desktop.ps1'), launcher);
  await fs.writeFile(key, 'test key');
  await fs.writeFile(config, '{}');
  const flags = ['-NodePath', process.execPath, '-InstallationRoot', root, '-PublicKey', key,
    '-PublisherSha256', pin.toUpperCase(), '-ServiceConfig', config];
  const execute = (args, extraEnv = {}) => run(windows.executable, ['-NoProfile', '-NonInteractive', ...args], {
    env: { ...process.env, ...windows.env, ...extraEnv }, cwd: directory, windowsHide: true, timeout: 30_000,
  });
  const invoke = (args, extraEnv) => execute(['-File', launcher, ...flags, ...args], extraEnv);
  return { directory, launcher, cli, root, key, config, shortcut, pin, windows, execute, invoke };
}

test('managed launch isolates the environment before Node starts and preserves Windows arguments', windowsOnly, async t => {
  const f = await setup(t);
  await fs.writeFile(f.cli, `
    const names = ['NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'ELECTRON_RUN_AS_NODE', 'SHENYI_DESKTOP_DATA_DIR',
      'SHENYI_WECHAT_APP_ID', 'SHENYI_WECHAT_REDIRECT_URI', 'OPENSSL_CONF', 'HTTPS_PROXY', 'VSCODE_INSPECTOR_OPTIONS'];
    const args = process.argv.slice(2);
    console.log(JSON.stringify({ ok: true, operation: 'launch', osSignatureVerified: true, pid: 1,
      publisherCertificateSha256: args[args.indexOf('--publisher-sha256') + 1], args,
      inherited: names.filter(name => Object.hasOwn(process.env, name)), localAppData: process.env.LOCALAPPDATA }));
  `);
  const inherited = {
    NODE_OPTIONS: '--invalid-option-for-shenyi-test', NODE_EXTRA_CA_CERTS: f.key, ELECTRON_RUN_AS_NODE: '1',
    SHENYI_DESKTOP_DATA_DIR: f.directory, SHENYI_WECHAT_APP_ID: 'untrusted-test-override', OPENSSL_CONF: f.key,
    SHENYI_WECHAT_REDIRECT_URI: 'https://example.invalid/',
    HTTPS_PROXY: 'http://127.0.0.1:1', VSCODE_INSPECTOR_OPTIONS: 'synthetic', LOCALAPPDATA: f.directory,
  };
  const result = JSON.parse((await f.invoke([], inherited)).stdout);
  assert.deepEqual(result.inherited, []);
  assert.equal(result.localAppData, f.directory);
  assert.deepEqual(result.args, ['launch', '--root', f.root, '--public-key', f.key,
    '--publisher-sha256', f.pin, '--service-config', f.config]);
});

test('managed launch requires a positive dual-signed process receipt', windowsOnly, async t => {
  const f = await setup(t);
  await fs.writeFile(f.cli, `console.log(JSON.stringify({ ok: true, operation: 'launch', pid: 12,
    osSignatureVerified: false, publisherCertificateSha256: '${f.pin}' }));`);
  await assert.rejects(f.invoke([]), { code: 1, stdout: '', stderr: /did not confirm a dual-signed desktop process/ });
});

test('shortcut generation publishes a fixed native link and preserves an existing output', windowsOnly, async t => {
  const f = await setup(t);
  await fs.writeFile(f.cli, 'throw new Error("the installer CLI must not run while generating a shortcut");');
  const args = ['-ShortcutPath', f.shortcut];
  assert.deepEqual(JSON.parse((await f.invoke(args)).stdout), { ok: true, shortcut: f.shortcut, applicationLaunched: false });
  const metadata = JSON.parse((await f.execute(['-Command', `
    $link=(New-Object -ComObject WScript.Shell).CreateShortcut($env:SHENYI_TEST_SHORTCUT)
    @{ target=$link.TargetPath; args=$link.Arguments; workingDirectory=$link.WorkingDirectory } | ConvertTo-Json -Compress
  `], { SHENYI_TEST_SHORTCUT: f.shortcut })).stdout);
  assert.equal(metadata.target.toLowerCase(), f.windows.executable.toLowerCase());
  assert.equal(metadata.workingDirectory, f.directory);
  assert.ok(metadata.args.startsWith('-NoProfile -NonInteractive -WindowStyle Hidden -File '));
  for (const value of [f.launcher, f.root, f.key, f.config, f.pin, '-FromShortcut']) assert.ok(metadata.args.includes('"' + value + '"'), value);
  const original = await fs.readFile(f.shortcut);
  await assert.rejects(f.invoke(args), { code: 1, stderr: /Existing files are kept/ });
  assert.deepEqual(await fs.readFile(f.shortcut), original);
});
