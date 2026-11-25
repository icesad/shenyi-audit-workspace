#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fileFacts, resolveBuildOutput, resolveSystemPowerShell } from './build-windows-desktop-candidate.mjs';
import { readWindowsCandidateManifest, signedWindowsCandidateStatus, verifyWindowsCandidateInventory } from './verify-windows-candidate-inventory.mjs';
import { verifyWindowsCandidate } from './windows-candidate-signature.mjs';
import { detachedSignatureFiles } from './detached-release-signature.mjs';

const executableName = 'Shenyi.exe';
const manifestName = 'candidate-manifest.json';
const maxExecutableBytes = 512 * 1024 * 1024;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const run = promisify(execFile);
const messages = {
  INVALID_ARGUMENTS: '发布操作需要完整参数和可信发布者证书的 SHA-256 指纹。',
  AUTHENTICODE_WINDOWS_REQUIRED: '请在 Windows 上运行 Authenticode 发行核验。',
  AUTHENTICODE_EXECUTABLE_MISMATCH: '外签 EXE 和原构建 EXE 的内容或证书表布局不符。',
  AUTHENTICODE_UNTRUSTED: 'Windows 未确认内嵌 Authenticode 签名、时间戳或指定发布者证书。',
  AUTHENTICODE_BUNDLE_INVALID: '发行包状态、文件清单或 Ed25519 发布签名无效。',
  AUTHENTICODE_MSI_INVALID: '请提供指定位置的有效 Windows MSI 文件。',
  AUTHENTICODE_MSI_MISMATCH: '最终 MSI 的文件摘要不符合经确认的 SHA-256，或文件在核验期间发生变化。',
  AUTHENTICODE_OUTPUT_INVALID: '请在两个输入及仓库之外使用尚未存在的输出目录。',
  AUTHENTICODE_OPERATION_FAILED: 'Windows Authenticode 发行操作未完成。',
};

function fail(code) {
  throw Object.assign(new Error(messages[code]), { code });
}

function parsePe(bytes) {
  const mismatch = 'AUTHENTICODE_EXECUTABLE_MISMATCH';
  if (!Buffer.isBuffer(bytes) || bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) fail(mismatch);
  const pe = bytes.readUInt32LE(60);
  const optional = pe + 24;
  if (pe < 64 || optional + 152 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550 ||
      bytes.readUInt16LE(pe + 4) !== 0x8664 || bytes.readUInt16LE(optional) !== 0x20b) fail(mismatch);
  const optionalLength = bytes.readUInt16LE(pe + 20);
  if (optionalLength < 152 || optional + optionalLength > bytes.length || bytes.readUInt32LE(optional + 108) < 5) fail(mismatch);
  const certificateDirectory = optional + 144;
  return { checksum: optional + 64, certificateDirectory, table: bytes.readUInt32LE(certificateDirectory),
    tableLength: bytes.readUInt32LE(certificateDirectory + 4) };
}

const align8 = size => Math.ceil(size / 8) * 8;
const allZero = bytes => bytes.every(value => value === 0);

function certificateBodyLength(bytes) {
  if (bytes.length < 3 || bytes[0] !== 0x30) return 0;
  if (bytes[1] < 128) return bytes[1] > 0 ? 2 + bytes[1] : 0;
  const width = bytes[1] - 128;
  if (width < 1 || width > 4 || bytes.length < 2 + width || bytes[2] === 0) return 0;
  const body = bytes.readUIntBE(2, width);
  return body >= 128 ? body + 2 + width : 0;
}

function assertEmbeddedTable(signed, header) {
  const mismatch = 'AUTHENTICODE_EXECUTABLE_MISMATCH';
  const { table, tableLength, certificateDirectory } = header;
  if (table < certificateDirectory + 8 || table !== align8(table) || tableLength < 9 || table + tableLength !== signed.length) fail(mismatch);
  const entryLength = signed.readUInt32LE(table);
  if (entryLength < 9 || align8(entryLength) !== tableLength || signed.readUInt16LE(table + 4) !== 0x0200 ||
      signed.readUInt16LE(table + 6) !== 0x0002 || !allZero(signed.subarray(table + entryLength))) fail(mismatch);
  const certificate = signed.subarray(table + 8, table + entryLength);
  const bodyLength = certificateBodyLength(certificate);
  if (!bodyLength || bodyLength > certificate.length || align8(bodyLength + 8) !== tableLength ||
      !allZero(certificate.subarray(bodyLength))) fail(mismatch);
}

export function assertSameWindowsExecutable(unsigned, signed) {
  const source = parsePe(unsigned);
  const result = parsePe(signed);
  const mismatch = 'AUTHENTICODE_EXECUTABLE_MISMATCH';
  if (source.table || source.tableLength || source.checksum !== result.checksum || result.table !== align8(unsigned.length) ||
      !allZero(signed.subarray(unsigned.length, result.table))) fail(mismatch);
  assertEmbeddedTable(signed, result);
  const { checksum, certificateDirectory } = source;
  const ranges = [[0, checksum], [checksum + 4, certificateDirectory], [certificateDirectory + 8, unsigned.length]];
  if (ranges.some(([start, end]) => !unsigned.subarray(start, end).equals(signed.subarray(start, end)))) fail(mismatch);
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

async function executableBytes(input) {
  const mismatch = 'AUTHENTICODE_EXECUTABLE_MISMATCH';
  if (typeof input !== 'string' || !/^[a-z]:[\\/]/i.test(input) || /[:\x00-\x1f\x7f]/.test(input.slice(2))) fail(mismatch);
  const filename = path.resolve(input);
  const before = await lstat(filename, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maxExecutableBytes) || path.relative(filename, await realpath(filename))) fail(mismatch);
  const bytes = await readFile(filename);
  const after = await lstat(filename, { bigint: true });
  if (BigInt(bytes.length) !== before.size || ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key])) fail(mismatch);
  return bytes;
}

const authenticodeProbe = `
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1')
$file = [IO.File]::Open($env:SHENYI_RELEASE_FILE, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
  $sig = Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $env:SHENYI_RELEASE_FILE
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $fileHash = [BitConverter]::ToString($sha.ComputeHash($file)).Replace('-', '').ToLowerInvariant()
    $hash = ''
    if ($sig.SignerCertificate) { $hash = [BitConverter]::ToString($sha.ComputeHash($sig.SignerCertificate.RawData)).Replace('-', '').ToLowerInvariant() }
  }
  finally { $sha.Dispose() }
  $result = [ordered]@{ status = [string]$sig.Status; type = [string]$sig.SignatureType; timestamp = ($null -ne $sig.TimeStamperCertificate); certificateSha256 = $hash; fileSha256 = $fileHash; bytes = $file.Length }
  if ($env:SHENYI_VERIFY_MSI -eq '1' -and $result.status -eq 'Valid' -and $result.type -eq 'Authenticode' -and $result.timestamp -and
      $hash -eq $env:SHENYI_EXPECTED_SIGNER -and $fileHash -eq $env:SHENYI_EXPECTED_MSI) {
    $installer = $null
    $database = $null
    $result['msiDatabase'] = $false
    try {
      $installer = New-Object -ComObject WindowsInstaller.Installer
      $database = $installer.OpenDatabase($env:SHENYI_RELEASE_FILE, 0)
      $result['msiDatabase'] = ($null -ne $database)
    }
    catch {}
    finally {
      if ($null -ne $database) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database) }
      if ($null -ne $installer) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer) }
    }
  }
  [pscustomobject]$result | ConvertTo-Json -Compress
}
finally { $file.Dispose() }
`;

export { resolveSystemPowerShell };

async function verifyEmbeddedSignature(filename, publisherCertificateSha256, expected, { msi = false } = {}) {
  const changed = msi ? 'AUTHENTICODE_MSI_MISMATCH' : 'AUTHENTICODE_BUNDLE_INVALID';
  const readFacts = () => fileFacts(filename).catch(() => fail(changed));
  if (!expected || !sameFacts(await readFacts(), expected)) fail(changed);
  let result;
  try {
    // Resolve the OS binary through Windows itself and give the verifier only its OS and input paths.
    const shell = await resolveSystemPowerShell();
    const env = { ...shell.env, SHENYI_RELEASE_FILE: filename };
    if (msi) Object.assign(env, { SHENYI_VERIFY_MSI: '1', SHENYI_EXPECTED_SIGNER: publisherCertificateSha256, SHENYI_EXPECTED_MSI: expected.sha256 });
    const { stdout } = await run(shell.executable, ['-NoProfile', '-NonInteractive', '-Command', authenticodeProbe],
      { env, cwd: shell.cwd, maxBuffer: 64 * 1024, timeout: 60_000, windowsHide: true });
    result = JSON.parse(stdout);
  } catch { fail('AUTHENTICODE_UNTRUSTED'); }
  if (result?.status !== 'Valid' || result.type !== 'Authenticode' || result.timestamp !== true ||
      result.certificateSha256 !== publisherCertificateSha256) fail('AUTHENTICODE_UNTRUSTED');
  if (!sameFacts({ sha256: result.fileSha256, bytes: result.bytes }, expected) ||
      !sameFacts(await readFacts(), expected)) fail(changed);
  if (msi && result.msiDatabase !== true) fail('AUTHENTICODE_MSI_INVALID');
}

function sameFacts(observed, expected) {
  return observed.bytes === expected.bytes && observed.sha256 === expected.sha256;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function trustedPublisher(value) {
  if (process.platform !== 'win32') fail('AUTHENTICODE_WINDOWS_REQUIRED');
  return trustedDigest(value);
}

function trustedDigest(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value) || value.length !== 64) fail('INVALID_ARGUMENTS');
  return value.toLowerCase();
}

async function finalize(options) {
  const publisher = trustedPublisher(options['--publisher-sha256']);
  const candidate = await readWindowsCandidateManifest(options['--bundle']);
  if (candidate.manifest.schemaVersion !== 1) fail('AUTHENTICODE_BUNDLE_INVALID');
  await verifyWindowsCandidateInventory(candidate);
  const destination = await resolveBuildOutput(options['--output']).catch(() => fail('AUTHENTICODE_OUTPUT_INVALID'));
  const outputParent = path.dirname(destination);
  const parentIdentity = await lstat(outputParent, { bigint: true });
  const signedInput = path.resolve(options['--signed-exe']);
  if (within(candidate.directory, destination) || within(candidate.directory, signedInput) || within(destination, signedInput)) fail('AUTHENTICODE_OUTPUT_INVALID');
  const unsigned = await executableBytes(path.join(candidate.directory, executableName));
  const unsignedFacts = candidate.manifest.files[executableName];
  if (!sameFacts({ bytes: unsigned.length, sha256: sha256(unsigned) }, unsignedFacts)) fail('AUTHENTICODE_BUNDLE_INVALID');
  const signed = await executableBytes(options['--signed-exe']);
  assertSameWindowsExecutable(unsigned, signed);
  const signedFacts = { bytes: signed.length, sha256: sha256(signed) };

  const staging = await mkdtemp(path.join(outputParent, '.shenyi-authenticode-'));
  const stagingIdentity = await lstat(staging, { bigint: true });
  const executable = path.join(staging, executableName);
  await writeFile(executable, signed, { flag: 'wx' });
  await verifyEmbeddedSignature(executable, publisher, signedFacts);
  for (const file of Object.keys(candidate.manifest.files)) {
    if (file === executableName) continue;
    const target = path.join(staging, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(candidate.directory, file), target, constants.COPYFILE_EXCL);
  }
  const manifest = { ...candidate.manifest, schemaVersion: 2, releaseStatus: signedWindowsCandidateStatus,
    files: { ...candidate.manifest.files, [executableName]: signedFacts },
    authenticode: { publisherCertificateSha256: publisher, unsignedExecutableSha256: unsignedFacts.sha256 } };
  await writeFile(path.join(staging, manifestName), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  const release = await readWindowsCandidateManifest(staging);
  await verifyWindowsCandidateInventory(release);
  const currentDestination = await resolveBuildOutput(destination).catch(() => fail('AUTHENTICODE_OUTPUT_INVALID'));
  const currentParent = await lstat(outputParent, { bigint: true });
  if (path.relative(currentDestination, destination) || !sameIdentity(parentIdentity, currentParent) ||
      !sameIdentity(stagingIdentity, await lstat(staging, { bigint: true }))) {
    fail('AUTHENTICODE_OUTPUT_INVALID');
  }
  await rename(staging, destination);
  if (!sameIdentity(stagingIdentity, await lstat(destination, { bigint: true }))) fail('AUTHENTICODE_OUTPUT_INVALID');
  const inventory = await verifyWindowsCandidateInventory({ ...release, directory: destination });
  return { output: destination, manifestSha256: release.manifestSha256, ...inventory,
    publisherCertificateSha256: publisher, osSignatureVerified: true };
}

export async function verifyWindowsCandidateRelease(options) {
  const publisher = trustedPublisher(options['--publisher-sha256']);
  const candidate = await readWindowsCandidateManifest(options['--bundle']);
  if (candidate.manifest.authenticode?.publisherCertificateSha256 !== publisher) fail('AUTHENTICODE_UNTRUSTED');
  const verified = await verifyWindowsCandidate(options);
  if (verified.manifestSha256 !== candidate.manifestSha256) fail('AUTHENTICODE_BUNDLE_INVALID');
  const executable = path.join(candidate.directory, executableName);
  const bytes = await executableBytes(executable);
  const expected = candidate.manifest.files[executableName];
  if (!sameFacts({ sha256: sha256(bytes), bytes: bytes.length }, expected)) fail('AUTHENTICODE_BUNDLE_INVALID');
  assertEmbeddedTable(bytes, parsePe(bytes));
  await verifyEmbeddedSignature(executable, publisher, expected);
  await verifyWindowsCandidateInventory(candidate);
  return { ...verified, offline: false, publisherCertificateSha256: publisher, osSignatureVerified: true };
}

export async function verifyWindowsReleaseMsi(options) {
  const publisherCertificateSha256 = trustedPublisher(options['--publisher-sha256']);
  const sha256 = trustedDigest(options['--msi-sha256']);
  const invalid = 'AUTHENTICODE_MSI_INVALID';
  const filename = detachedSignatureFiles(fail).localPath(options['--msi'], invalid);
  if (!/\.msi$/i.test(path.basename(filename))) fail(invalid);

  async function readState(code) {
    try {
      const state = await lstat(filename, { bigint: true });
      if (!state.isFile() || state.size === 0n || path.relative(filename, await realpath(filename))) fail(code);
      return state;
    } catch { fail(code); }
  }

  const changed = 'AUTHENTICODE_MSI_MISMATCH';
  const before = await readState(invalid);
  const expected = await fileFacts(filename).catch(() => fail(changed));
  if (expected.sha256 !== sha256 || BigInt(expected.bytes) !== before.size) fail(changed);
  await verifyEmbeddedSignature(filename, publisherCertificateSha256, expected, { msi: true });
  const after = await readState(changed);
  if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => before[key] !== after[key])) fail(changed);
  return { file: filename, ...expected, publisherCertificateSha256,
    installerOsSignatureVerified: true, timestampVerified: true, installerDatabaseVerified: true };
}

async function main(args) {
  const [command, ...rest] = args;
  const common = ['--bundle', '--publisher-sha256'];
  const required = command === 'finalize' ? [...common, '--signed-exe', '--output'] :
    command === 'verify' ? [...common, '--signature', '--public-key', '--installed-version'] :
    command === 'verify-msi' ? ['--msi', '--publisher-sha256', '--msi-sha256'] : [];
  if (!required.length || rest.length !== 2 * required.length) fail('INVALID_ARGUMENTS');
  const options = Object.create(null);
  for (let index = 0; index < rest.length; index += 2) {
    const [name, value] = rest.slice(index, index + 2);
    if (!required.includes(name) || Object.hasOwn(options, name) || !value || value.startsWith('--')) fail('INVALID_ARGUMENTS');
    options[name] = value;
  }
  const runCommand = command === 'finalize' ? finalize : command === 'verify' ? verifyWindowsCandidateRelease : verifyWindowsReleaseMsi;
  const result = await runCommand(options);
  console.log(JSON.stringify({ ok: true, operation: command, ...result }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    const code = Object.hasOwn(messages, error.code) ? error.code :
      error.code?.startsWith('CANDIDATE_') ? 'AUTHENTICODE_BUNDLE_INVALID' : 'AUTHENTICODE_OPERATION_FAILED';
    console.error(JSON.stringify({ ok: false, code, message: messages[code] }));
    process.exitCode = 1;
  });
}
