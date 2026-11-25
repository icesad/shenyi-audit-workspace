#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, mkdtemp, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fileFacts, resolveBuildOutput } from './build-windows-desktop-candidate.mjs';
import { resolveSystemPowerShell, verifyWindowsCandidateRelease } from './windows-candidate-authenticode.mjs';
import { readWindowsCandidateManifest } from './verify-windows-candidate-inventory.mjs';

const run = promisify(execFile);
const authorScript = fileURLToPath(new URL('./write-windows-release-msi.ps1', import.meta.url));
const inspectScript = fileURLToPath(new URL('./inspect-windows-release-msi.ps1', import.meta.url));
const msiName = 'shenyi-release.msi';
const bundleName = 'bundle';
const signatureName = 'signature.ed25519';
const manifestName = 'candidate-manifest.json';
const windowsMsiTimeout = 5 * 60_000;
const messages = {
  INVALID_ARGUMENTS: '请提供双签名候选、签名文件、可信公钥、证书指纹和新的 MSI 路径。',
  WINDOWS_MSI_REQUIRED: '请在 Windows 上构建 MSI 发行候选。',
  WINDOWS_MSI_TARGET_INVALID: 'MSI 输出须在仓库及输入包之外，且尚不存在。',
  WINDOWS_MSI_CONTENT_INVALID: 'MSI 解包或暂存内容与已验签发布包不一致。',
  WINDOWS_MSI_BUILD_FAILED: 'Windows Installer 无法生成或复验 MSI。请检查隔离构建记录。',
  AUTHENTICODE_UNTRUSTED: 'Windows 未确认指定发布者的内嵌签名和时间戳。',
  AUTHENTICODE_BUNDLE_INVALID: '候选包未通过 Authenticode 发行核验。',
  AUTHENTICODE_EXECUTABLE_MISMATCH: '候选程序的 Authenticode 证书表不符合约定。',
  CANDIDATE_SIGNATURE_INVALID: '候选发布签名缺失、无效或与受信公钥不符。',
  CANDIDATE_INVENTORY_INVALID: '候选文件与清单不一致。',
  CANDIDATE_MANIFEST_INVALID: '候选清单无效。',
  VERIFICATION_KEY_INVALID: '无法使用独立配置的 Ed25519 公钥。',
};

function fail(code) {
  throw Object.assign(new Error(messages[code]), { code });
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

async function resolveMsiOutput(value, bundle) {
  const invalid = 'WINDOWS_MSI_TARGET_INVALID';
  if (!/^[a-z]:[\\/]/i.test(value) || /[:\x00-\x1f\x7f]/.test(value.slice(2)) || !/^[^.][^<>:"/\\|?*]*\.msi$/i.test(path.basename(value))) fail(invalid);
  const destination = await resolveBuildOutput(value).catch(() => fail(invalid));
  if (within(bundle, destination)) fail(invalid);
  return destination;
}

function compareRelease(received, expected) {
  const identity = ['version', 'manifestSha256', 'signatureSha256', 'publicKeySha256', 'publisherCertificateSha256', 'fileCount', 'totalBytes'];
  if (received.osSignatureVerified !== true || identity.some(key => received[key] !== expected[key])) fail('WINDOWS_MSI_CONTENT_INVALID');
}

function verifyDelivery(options, directory) {
  return verifyWindowsCandidateRelease({ ...options, '--installed-version': '0.0.0',
    ...(directory ? { '--bundle': path.join(directory, bundleName), '--signature': path.join(directory, signatureName) } : {}) });
}

async function copyRelease(source, signature, destination) {
  const bundle = path.join(destination, bundleName);
  for (const relative of Object.keys(source.manifest.files)) {
    const filename = path.join(bundle, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await copyFile(path.join(source.directory, relative), filename, constants.COPYFILE_EXCL);
  }
  await copyFile(path.join(source.directory, manifestName), path.join(bundle, manifestName), constants.COPYFILE_EXCL);
  await copyFile(signature, path.join(destination, signatureName), constants.COPYFILE_EXCL);
  return [
    ...Object.entries(source.manifest.files).map(([name, info]) => ({ relativePath: bundleName + '/' + name, bytes: info.bytes })),
    { relativePath: bundleName + '/' + manifestName, bytes: source.bytes.length },
    { relativePath: signatureName, bytes: 64 },
  ];
}

export function windowsMsiAdministrativeArguments(msi, target, log) {
  const [installer, image, transcript] = [msi, target, log].map(value => {
    const absolute = path.resolve(value);
    if (/["\x00-\x1f]/.test(absolute) || absolute === path.parse(absolute).root) fail('WINDOWS_MSI_TARGET_INVALID');
    return `"${absolute}"`;
  });
  // MSI properties require quoted values rather than quoting the whole NAME=value argument.
  return ['/a', installer, '/qn', '/norestart', `TARGETDIR=${image}`, '/L*V', transcript];
}

async function executeTool(executable, arguments_, environment, workingDirectory, logPrefix, windowsVerbatimArguments = false) {
  const options = { cwd: workingDirectory, env: environment, windowsHide: true, windowsVerbatimArguments, maxBuffer: 1024 * 1024, timeout: windowsMsiTimeout };
  try {
    const result = await run(executable, arguments_, options);
    await writeFile(`${logPrefix}.stdout.txt`, result.stdout, { flag: 'wx' });
    await writeFile(`${logPrefix}.stderr.txt`, result.stderr, { flag: 'wx' });
    return result.stdout;
  } catch (error) {
    await writeFile(`${logPrefix}.failure.txt`, JSON.stringify({ exit: error.code, stdout: error.stdout, stderr: error.stderr }), { flag: 'wx' });
    fail('WINDOWS_MSI_BUILD_FAILED');
  }
}

function identity(left, right) {
  return left.ino === right.ino && left.dev === right.dev;
}

async function publishMsi(workingMsi, output, parentIdentity, expected) {
  const invalid = 'WINDOWS_MSI_TARGET_INVALID';
  const resolved = await resolveBuildOutput(output).catch(() => fail(invalid));
  if (path.relative(resolved, output) || !identity(parentIdentity, await lstat(path.dirname(output), { bigint: true }))) fail(invalid);
  const source = await lstat(workingMsi, { bigint: true });
  if (!source.isFile() || source.nlink !== 1n || !source.size) fail('WINDOWS_MSI_BUILD_FAILED');
  try { await link(workingMsi, output); } catch { fail(invalid); }
  try {
    if (!identity(source, await lstat(output, { bigint: true }))) fail(invalid);
    const published = await fileFacts(output);
    if (published.sha256 !== expected.sha256 || published.bytes !== expected.bytes) fail('WINDOWS_MSI_CONTENT_INVALID');
    await unlink(workingMsi);
    return published;
  } catch (error) {
    const current = await lstat(output, { bigint: true }).catch(() => null);
    if (current && identity(source, current)) await unlink(output).catch(() => {});
    throw error;
  }
}

async function buildMsi(options) {
  if (process.platform !== 'win32') fail('WINDOWS_MSI_REQUIRED');
  const verified = await verifyDelivery(options);
  const source = await readWindowsCandidateManifest(options['--bundle']);
  if (source.manifestSha256 !== verified.manifestSha256) fail('WINDOWS_MSI_CONTENT_INVALID');
  const output = await resolveMsiOutput(options['--output'], source.directory);
  const parent = path.dirname(output);
  const parentIdentity = await lstat(parent, { bigint: true });
  const working = await mkdtemp(path.join(parent, '.shenyi-msi-build-'));
  try {
    const payloadDirectory = path.join(working, 'payload');
    const outputDirectory = path.join(working, 'compiled');
    await mkdir(outputDirectory);
    const files = await copyRelease(source, options['--signature'], payloadDirectory);
    compareRelease(await verifyDelivery(options, payloadDirectory), verified);

    const request = path.join(working, 'request.json');
    await writeFile(request, JSON.stringify({ version: verified.version, payloadDirectory, outputDirectory, files }, null, 2), { flag: 'wx' });
    const windows = await resolveSystemPowerShell();
    // Windows Installer and MakeCab only receive a temporary directory owned by this build.
    const env = { ...windows.env, TEMP: working, TMP: working };
    await executeTool(windows.executable, ['-NoProfile', '-NonInteractive', '-File', authorScript, '-RequestPath', request], env, working, path.join(working, 'author'));

    const msi = path.join(outputDirectory, msiName);
    const archive = await fileFacts(msi);
    const inspected = await executeTool(windows.executable, ['-NoProfile', '-NonInteractive', '-File', inspectScript,
      '-MsiPath', msi, '-ExpectedVersion', verified.version, '-ExpectedSha256', archive.sha256], env, working, path.join(working, 'source-policy'));
    const sourcePolicy = JSON.parse(inspected);
    const payloadBytes = files.reduce((bytes, file) => bytes + file.bytes, 0);
    if (sourcePolicy?.sourcePolicyVerified !== true || sourcePolicy.sha256 !== archive.sha256 ||
        sourcePolicy.version !== verified.version || sourcePolicy.payloadFileCount !== files.length ||
        sourcePolicy.payloadBytes !== payloadBytes) fail('WINDOWS_MSI_CONTENT_INVALID');
    const extracted = path.join(working, 'administrative-image');
    const log = path.join(working, 'msiexec.log');
    await executeTool(path.join(windows.systemDirectory, 'msiexec.exe'), windowsMsiAdministrativeArguments(msi, extracted, log),
      env, working, path.join(working, 'extract'), true);
    if (JSON.stringify((await readdir(extracted)).sort()) !== JSON.stringify([bundleName, msiName, signatureName].sort())) fail('WINDOWS_MSI_CONTENT_INVALID');
    compareRelease(await verifyDelivery(options, extracted), verified);
    const confirmed = await fileFacts(msi);
    if (confirmed.sha256 !== archive.sha256 || confirmed.bytes !== archive.bytes) fail('WINDOWS_MSI_CONTENT_INVALID');

    const published = await publishMsi(msi, output, parentIdentity, archive);
    return { output, workingDirectory: working, version: verified.version, packageArch: 'x64',
      bytes: published.bytes, sha256: published.sha256, releaseManifestSha256: verified.manifestSha256,
      releaseFileCount: verified.fileCount, releaseOsSignatureVerified: true, installerOsSignatureVerified: false,
      sourcePolicyVerified: true, productCode: sourcePolicy.productCode, packageCode: sourcePolicy.packageCode,
      administrativeExtractionVerified: true };
  } catch (error) {
    throw Object.assign(error, { workingDirectory: working });
  }
}

function parseOptions(args) {
  const required = new Set(['--bundle', '--signature', '--public-key', '--publisher-sha256', '--output']);
  if (args.length !== required.size * 2) fail('INVALID_ARGUMENTS');
  const options = Object.create(null);
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = args.slice(index, index + 2);
    if (!required.delete(flag) || typeof value !== 'string' || !value || value.startsWith('--')) fail('INVALID_ARGUMENTS');
    options[flag] = value;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const result = await buildMsi(parseOptions(process.argv.slice(2)));
    console.log(JSON.stringify({ ok: true, ...result }));
  })().catch(error => {
    const code = Object.hasOwn(messages, error.code) ? error.code : 'WINDOWS_MSI_BUILD_FAILED';
    console.error(JSON.stringify({ ok: false, code, message: messages[code], workingDirectory: error.workingDirectory }));
    process.exitCode = 1;
  });
}
