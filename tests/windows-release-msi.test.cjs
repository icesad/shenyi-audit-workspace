'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const run = promisify(execFile);

test('Windows Installer reproduces the authored release source in an unregistered administrative image', {
  skip: process.platform !== 'win32' && 'Windows Installer is available only on Windows',
}, async () => {
  const { resolveSystemPowerShell } = await import('../scripts/windows-candidate-authenticode.mjs');
  const { windowsMsiAdministrativeArguments } = await import('../scripts/build-windows-release-msi.mjs');
  const windows = await resolveSystemPowerShell();
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'shenyi-release-msi-'));
  const payloadDirectory = path.join(directory, 'payload');
  const outputDirectory = path.join(directory, 'compiled');
  const extractDirectory = path.join(directory, 'admin image');
  const payload = new Map([
    ['bundle/Shenyi.exe', Buffer.from('synthetic source data, never executed')],
    ['bundle/candidate-manifest.json', Buffer.from('{"test":true}\n')],
    ['bundle/resources/app/node_modules/@scope/folder-longer-than-eight/some-file-with-long-name.cjs', Buffer.from('module.exports = {};\n')],
    ['bundle/resources/app/empty.txt', Buffer.alloc(0)],
    ['signature.ed25519', Buffer.alloc(64, 5)],
  ]);
  await fs.mkdir(outputDirectory);
  for (const [relativePath, bytes] of payload) {
    const destination = path.join(payloadDirectory, relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes, { flag: 'wx' });
  }
  const request = path.join(directory, 'request.json');
  const files = Array.from(payload, ([relativePath, bytes]) => ({ relativePath, bytes: bytes.length }));
  await fs.writeFile(request, JSON.stringify({ version: '219.63.1997', outputDirectory, payloadDirectory, files }));
  const env = { ...windows.env, TEMP: directory, TMP: directory };
  const processOptions = { cwd: directory, env, windowsHide: true, timeout: 60_000 };
  const author = path.resolve(__dirname, '../scripts/write-windows-release-msi.ps1');
  const result = await run(windows.executable, ['-NoProfile', '-NonInteractive', '-File', author, '-RequestPath', request], processOptions);
  const report = JSON.parse(result.stdout);
  assert.equal(report.fileCount, payload.size);
  assert.equal(report.customActions, false);
  const inspectProductState = "(New-Object -ComObject WindowsInstaller.Installer).ProductState($env:SHENYI_TEST_MSI_PRODUCT)";
  const productOptions = { ...processOptions, env: { ...env, SHENYI_TEST_MSI_PRODUCT: report.productCode } };
  const unregistered = async () => {
    const result = await run(windows.executable, ['-NoProfile', '-NonInteractive', '-Command', inspectProductState], productOptions);
    assert.equal(result.stdout.trim(), '-1');
  };
  await unregistered();
  const file = path.join(outputDirectory, 'shenyi-release.msi');
  assert.equal(report.msiPath, file);
  const args = windowsMsiAdministrativeArguments(file, extractDirectory, path.join(directory, 'msiexec.log'));
  await run(path.join(windows.systemDirectory, 'msiexec.exe'), args, { ...processOptions, windowsVerbatimArguments: true });
  assert.deepEqual((await fs.readdir(extractDirectory)).sort(), ['bundle', 'shenyi-release.msi', 'signature.ed25519']);
  for (const [relativePath, expected] of payload) assert.deepEqual(await fs.readFile(path.join(extractDirectory, relativePath)), expected, relativePath);
  await unregistered();
});
