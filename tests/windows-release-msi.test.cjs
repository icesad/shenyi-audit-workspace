'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
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
  const before = await fs.readFile(file);
  const digest = createHash('sha256').update(before).digest('hex');
  const inspector = path.resolve(__dirname, '../scripts/inspect-windows-release-msi.ps1');
  const inspect = (filename, hash, version = report.version) => run(windows.executable, [
    '-NoProfile', '-NonInteractive', '-File', inspector, '-MsiPath', filename,
    '-ExpectedVersion', version, '-ExpectedSha256', hash,
  ], processOptions);
  const policy = JSON.parse((await inspect(file, digest)).stdout);
  assert.equal(policy.sourcePolicyVerified, true);
  assert.equal(policy.sha256, digest);
  assert.equal(policy.productCode, report.productCode);
  assert.equal(policy.packageCode, report.packageCode);
  assert.equal(policy.payloadFileCount, payload.size);
  assert.equal(policy.payloadBytes, report.payloadBytes);
  assert.equal(policy.installationPerformed, false);
  assert.equal(policy.installerSignatureVerified, false);
  const policyRejected = code => error => error.code === 1 && error.stdout.trim() === '' && error.stderr.trim() === code;
  await assert.rejects(inspect(file, '0'.repeat(64)), policyRejected('MSI_SOURCE_POLICY_DIGEST'));
  await assert.rejects(inspect(file, digest, '219.63.1998'), policyRejected('MSI_SOURCE_POLICY_PROPERTIES'));

  const changed = path.join(directory, 'changed default scope.msi');
  await fs.copyFile(file, changed);
  const changeScope = '$db=(New-Object -ComObject WindowsInstaller.Installer).OpenDatabase($env:SHENYI_TEST_MSI, 1);' +
    "$view=$db.OpenView('UPDATE `Property` SET `Value` = ''2'' WHERE `Property` = ''ALLUSERS''');" +
    '$view.Execute(); $view.Close(); $db.Commit();';
  await run(windows.executable, ['-NoProfile', '-NonInteractive', '-Command', changeScope], {
    ...processOptions, env: { ...env, SHENYI_TEST_MSI: changed },
  });
  const changedDigest = createHash('sha256').update(await fs.readFile(changed)).digest('hex');
  assert.notEqual(changedDigest, digest);
  await assert.rejects(inspect(changed, changedDigest), policyRejected('MSI_SOURCE_POLICY_PROPERTIES'));
  const verifier = path.resolve(__dirname, '../scripts/windows-candidate-authenticode.mjs');
  const verify = (filename, hash, extra = []) => run(process.execPath, [
    verifier, 'verify-msi', '--msi', filename, '--msi-sha256', hash, '--publisher-sha256', 'a'.repeat(64), ...extra,
  ], processOptions);
  const rejected = code => error => error.code === 1 && JSON.parse(error.stderr).code === code;
  await assert.rejects(verify(file, digest), rejected('AUTHENTICODE_UNTRUSTED'));
  await assert.rejects(verify(file, '0'.repeat(64)), rejected('AUTHENTICODE_MSI_MISMATCH'));
  await assert.rejects(verify(path.basename(file), digest), rejected('AUTHENTICODE_MSI_INVALID'));
  await assert.rejects(verify(path.join(outputDirectory, 'shenyi-release.exe'), digest), rejected('AUTHENTICODE_MSI_INVALID'));
  await assert.rejects(verify(file, digest, ['--msi', file]), rejected('INVALID_ARGUMENTS'));
  assert.deepEqual(await fs.readFile(file), before);
  await unregistered();
  const args = windowsMsiAdministrativeArguments(file, extractDirectory, path.join(directory, 'msiexec.log'));
  await run(path.join(windows.systemDirectory, 'msiexec.exe'), args, { ...processOptions, windowsVerbatimArguments: true });
  assert.deepEqual((await fs.readdir(extractDirectory)).sort(), ['bundle', 'shenyi-release.msi', 'signature.ed25519']);
  for (const [relativePath, expected] of payload) assert.deepEqual(await fs.readFile(path.join(extractDirectory, relativePath)), expected, relativePath);
  await unregistered();
});
