#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdtemp, open, readdir, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { windowsMsiAdministrativeArguments } from './build-windows-release-msi.mjs';
import { detachedSignatureFiles, detachedSignatureLength } from './detached-release-signature.mjs';
import { parseCandidateVersion, readWindowsCandidateManifest } from './verify-windows-candidate-inventory.mjs';
import { resolveSystemPowerShell, verifyWindowsCandidateRelease, verifyWindowsReleaseMsi } from './windows-candidate-authenticode.mjs';

const execute = promisify(execFile);
const inspector = fileURLToPath(new URL('./inspect-windows-release-msi.ps1', import.meta.url));
const msiName = 'shenyi-release.msi';
const signatureName = 'signature.ed25519';
const expectedImageNames = ['bundle', msiName, signatureName];
const maxMsiBytes = 2n * 1024n ** 3n;
const digestPattern = /^[a-f0-9]{64}$/i;
const guid = /^\{[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}\}$/;
const fields = new Map([
  ['--msi', 'msi'], ['--msi-sha256', 'sha256'], ['--publisher-sha256', 'publisherSha256'],
  ['--public-key', 'publicKey'], ['--version', 'version'], ['--installed-version', 'installedVersion'],
  ['--scratch-root', 'scratchRoot'],
]);
const messages = {
  INVALID_ARGUMENTS: '请提供最终 MSI、可信摘要和发布者指纹、Ed25519 公钥、发行版本及本机已接受版本。',
  WINDOWS_MSI_REQUIRED: '最终 MSI 接收核验须在 Windows 上运行。',
  MSI_PATH_INVALID: '请选择未链接的本地 MSI 文件。',
  MSI_DIGEST_MISMATCH: 'MSI 字节或 SHA-256 与获准发行记录不一致。',
  MSI_CHANGED: 'MSI 临时副本在接收核验期间发生变化。',
  MSI_SIGNATURE_RECEIPT_MISMATCH: '安装器签名回执与获准的 MSI 不一致。',
  MSI_SOURCE_POLICY_FAILED: 'MSI 结构检查未通过，请核对是否为指定版本的审易发行来源。',
  MSI_EXTRACTION_FAILED: 'Windows Installer 未能生成独立的管理映像。',
  MSI_IMAGE_INVALID: '管理映像的目录或文件与审易发行来源不一致。',
  MSI_RELEASE_MISMATCH: '解包后的双签名发布与 MSI 结构或获准版本不一致。',
  MSI_WORKSPACE_UNSAFE: '接收目录无法限制为本机用户和系统维护人员可改动，请选择受保护的本地目录。',
  MSI_WORKSPACE_CHANGED: '接收临时目录的身份发生变化，请核对该目录。',
  CANDIDATE_VERSION_NOT_NEWER: '发行版本须高于本机已接受版本。',
};

function fail(code) {
  throw Object.assign(new Error(messages[code]), { code });
}

const { localPath } = detachedSignatureFiles(fail);
const isDigest = value => typeof value === 'string' && value.length === 64 && digestPattern.test(value);
const isGuid = value => typeof value === 'string' && guid.test(value);
const isCount = value => Number.isSafeInteger(value) && value > 0;
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;
const sameState = (left, right) => sameFile(left, right) && ['mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']
  .every(key => left[key] === right[key]);

const workspaceAcl = String.raw`
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1')
$directory = $env:SHENYI_RECEIPT_WORKSPACE
$sidType = [Security.Principal.SecurityIdentifier]
$user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$control = @($user, 'S-1-5-18', 'S-1-5-32-544') | Select-Object -Unique
$trusted = @($control) + 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$rights = [Security.AccessControl.FileSystemRights]
$privileged = $rights::Delete -bor $rights::DeleteSubdirectoriesAndFiles -bor $rights::ChangePermissions -bor $rights::TakeOwnership -bor 0x10000000
for ($entry = Get-Item -LiteralPath $directory; $null -ne $entry; $entry = $entry.Parent) {
  if ($entry -isnot [IO.DirectoryInfo] -or -not $entry.Exists -or
      ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unsafe receipt path' }
  $acl = Get-Acl -LiteralPath $entry.FullName
  if ($acl.GetOwner($sidType).Value -notin $trusted) { throw 'Unsafe directory owner' }
  if ($entry.FullName -ne $directory) {
    foreach ($rule in $acl.GetAccessRules($true, $true, $sidType)) {
      if ($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $privileged) -and
          -not ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and
          $rule.IdentityReference.Value -notin $trusted) { throw 'Unsafe ancestor ACL' }
    }
  }
}
$acl = Get-Acl -LiteralPath $directory
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in $acl.GetAccessRules($true, $false, $sidType)) { $acl.RemoveAccessRuleSpecific($rule) }
foreach ($account in $control) {
  $sid = [Security.Principal.SecurityIdentifier]::new($account)
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, $rights::FullControl,
    [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
    [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $directory -AclObject $acl
$confirmed = Get-Acl -LiteralPath $directory
$actual = @($confirmed.GetAccessRules($true, $true, $sidType))
if (-not $confirmed.AreAccessRulesProtected -or $actual.Count -ne @($control).Count) { throw 'Unconfirmed workspace ACL' }
foreach ($rule in $actual) {
  if ($rule.IdentityReference.Value -notin $control -or $rule.AccessControlType -ne 'Allow' -or
      $rule.FileSystemRights -ne $rights::FullControl -or $rule.IsInherited -or
      $rule.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' -or
      $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) { throw 'Unconfirmed workspace ACL' }
}
`;

async function protectWindowsMsiWorkspace(workspace) {
  const shell = await resolveSystemPowerShell();
  await execute(shell.executable, ['-NoProfile', '-NonInteractive', '-Command', workspaceAcl], {
    cwd: shell.cwd, env: { ...shell.env, SHENYI_RECEIPT_WORKSPACE: workspace }, windowsHide: true,
    timeout: 20_000, maxBuffer: 64 * 1024,
  });
}

function parse(args) {
  const input = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = fields.get(args[i]);
    const value = args[i + 1];
    if (!key || Object.hasOwn(input, key) || !value || value.startsWith('--')) fail('INVALID_ARGUMENTS');
    input[key] = value;
  }
  return input;
}

function approvedRelease(expected) {
  const { version, installedVersion, sha256, publisherSha256 } = expected;
  const msi = localPath(expected.msi, 'INVALID_ARGUMENTS');
  const publicKey = localPath(expected.publicKey, 'INVALID_ARGUMENTS');
  if (path.extname(msi).toLowerCase() !== '.msi' || !isDigest(sha256) || !isDigest(publisherSha256)) fail('INVALID_ARGUMENTS');
  const next = parseCandidateVersion(version);
  const current = parseCandidateVersion(installedVersion);
  const different = next.findIndex((value, index) => value !== current[index]);
  if (different < 0 || next[different] < current[different]) fail('CANDIDATE_VERSION_NOT_NEWER');
  return { msi, publicKey, version, installedVersion, sha256: sha256.toLowerCase(), publisher: publisherSha256.toLowerCase() };
}

async function canonicalEntry(filename, type, code) {
  let entry;
  try {
    entry = await lstat(filename, { bigint: true });
    if ((type === 'directory' ? entry.isDirectory() : entry.isFile() && entry.nlink === 1n) &&
        path.relative(filename, await realpath(filename)) === '') return entry;
  } catch { /* Report the rejected entry without disclosing the contents. */ }
  fail(code);
}

async function scanMsi(filename, code, { sealed, output } = {}) {
  const initial = await canonicalEntry(filename, 'file', code);
  if (initial.size < 1n || initial.size > maxMsiBytes || (sealed && !sameState(initial, sealed))) fail(code);
  const input = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!sameState(await input.stat({ bigint: true }), initial)) fail(code);
    const hash = createHash('sha256');
    const bytes = Number(initial.size);
    let consumed = 0;
    for await (const chunk of input.createReadStream({ autoClose: false, start: 0, end: bytes - 1 })) {
      consumed += chunk.length;
      hash.update(chunk);
      if (output) await output.writeFile(chunk);
    }
    if (consumed !== bytes || !sameState(await input.stat({ bigint: true }), initial) ||
        !sameState(await canonicalEntry(filename, 'file', code), initial)) fail(code);
    return { bytes, sha256: hash.digest('hex') };
  } finally { await input.close(); }
}

function assertFacts(facts, expected, code) {
  if (facts?.bytes !== expected.bytes || facts.sha256 !== expected.sha256) fail(code);
}

async function inspectSource(run, shell, copy, approved, options) {
  let receipt;
  try {
    const { stdout } = await run(shell.executable, ['-NoProfile', '-NonInteractive', '-File', inspector,
      '-MsiPath', copy, '-ExpectedVersion', approved.version, '-ExpectedSha256', approved.sha256], options);
    receipt = JSON.parse(stdout);
  } catch { fail('MSI_SOURCE_POLICY_FAILED'); }
  if (receipt?.ok !== true || receipt.sourcePolicyVerified !== true || receipt.arch !== 'x64' ||
      receipt.sha256 !== approved.sha256 || receipt.version !== approved.version ||
      receipt.machineScope !== true || receipt.installationPerformed !== false ||
      receipt.releaseSourceDirectory !== `ProgramFiles64Folder/Shenyi/ReleaseSource/${approved.version}` ||
      !isGuid(receipt.productCode) || !isGuid(receipt.packageCode) ||
      !isCount(receipt.payloadFileCount) || !isCount(receipt.payloadBytes)) fail('MSI_SOURCE_POLICY_FAILED');
  return receipt;
}

export async function checkWindowsReleaseMsi(expected, {
  platform = process.platform, temporaryRoot = expected?.scratchRoot ?? homedir(), protectWorkspace = protectWindowsMsiWorkspace,
  verifyInstaller = verifyWindowsReleaseMsi,
  verifyRelease = verifyWindowsCandidateRelease, readManifest = readWindowsCandidateManifest,
  resolveShell = resolveSystemPowerShell, run = execute,
} = {}) {
  if (platform !== 'win32') fail('WINDOWS_MSI_REQUIRED');
  const approved = approvedRelease(expected ?? {});
  const { msi, publicKey, version, installedVersion, sha256, publisher } = approved;
  const root = localPath(temporaryRoot, 'MSI_WORKSPACE_UNSAFE');
  await canonicalEntry(root, 'directory', 'MSI_WORKSPACE_UNSAFE');
  const workspace = await mkdtemp(path.join(root, 'shenyi-msi-receive-'));
  const workspaceOrigin = await canonicalEntry(workspace, 'directory', 'MSI_WORKSPACE_CHANGED');
  try {
    try { await protectWorkspace(workspace); } catch { fail('MSI_WORKSPACE_UNSAFE'); }
    if (!sameFile(workspaceOrigin, await canonicalEntry(workspace, 'directory', 'MSI_WORKSPACE_CHANGED'))) fail('MSI_WORKSPACE_CHANGED');
    const copy = path.join(workspace, msiName);
    const output = await open(copy, 'wx', 0o600);
    let copied;
    try { copied = await scanMsi(msi, 'MSI_PATH_INVALID', { output }); }
    finally { await output.close(); }
    if (copied.sha256 !== sha256) fail('MSI_DIGEST_MISMATCH');
    const sealed = await canonicalEntry(copy, 'file', 'MSI_CHANGED');
    const checkCopy = async () => assertFacts(await scanMsi(copy, 'MSI_CHANGED', { sealed }), copied, 'MSI_CHANGED');
    await checkCopy();

    const outer = await verifyInstaller({ '--msi': copy, '--msi-sha256': sha256, '--publisher-sha256': publisher });
    assertFacts(outer, copied, 'MSI_SIGNATURE_RECEIPT_MISMATCH');
    if (typeof outer.file !== 'string' || path.relative(copy, outer.file) || outer.publisherCertificateSha256 !== publisher ||
        outer.installerOsSignatureVerified !== true || outer.timestampVerified !== true ||
        outer.installerDatabaseVerified !== true) fail('MSI_SIGNATURE_RECEIPT_MISMATCH');
    await checkCopy();

    const shell = await resolveShell();
    const options = { cwd: workspace, env: { ...shell.env, TEMP: workspace, TMP: workspace }, windowsHide: true,
      timeout: 5 * 60_000, maxBuffer: 1024 * 1024 };
    const source = await inspectSource(run, shell, copy, approved, options);
    await checkCopy();

    const image = path.join(workspace, 'administrative-image');
    const log = path.join(workspace, 'msiexec.log');
    try {
      await run(path.join(shell.systemDirectory, 'msiexec.exe'), windowsMsiAdministrativeArguments(copy, image, log),
        { ...options, windowsVerbatimArguments: true });
    } catch { fail('MSI_EXTRACTION_FAILED'); }
    await checkCopy();
    await canonicalEntry(image, 'directory', 'MSI_IMAGE_INVALID');
    const names = (await readdir(image)).sort();
    if (names.length !== expectedImageNames.length || names.some((name, index) => name !== expectedImageNames[index])) {
      fail('MSI_IMAGE_INVALID');
    }
    const bundle = path.join(image, 'bundle');
    const signature = path.join(image, signatureName);
    await canonicalEntry(bundle, 'directory', 'MSI_IMAGE_INVALID');
    await canonicalEntry(path.join(image, msiName), 'file', 'MSI_IMAGE_INVALID');
    const signatureEntry = await canonicalEntry(signature, 'file', 'MSI_IMAGE_INVALID');
    if (signatureEntry.size !== BigInt(detachedSignatureLength)) fail('MSI_IMAGE_INVALID');

    const release = await verifyRelease({ '--bundle': bundle, '--signature': signature, '--public-key': publicKey,
      '--publisher-sha256': publisher, '--installed-version': installedVersion });
    const manifest = await readManifest(bundle);
    if (release?.osSignatureVerified !== true || release.version !== version || release.platform !== 'win32' ||
        release.arch !== 'x64' || release.installedVersion !== installedVersion || release.publisherCertificateSha256 !== publisher ||
        ![release.manifestSha256, release.signatureSha256, release.publicKeySha256].every(isDigest) ||
        release.manifestSha256 !== manifest?.manifestSha256 || !Buffer.isBuffer(manifest.bytes) ||
        !isCount(release.fileCount) || !isCount(release.totalBytes) || source.payloadFileCount !== release.fileCount + 2 ||
        source.payloadBytes !== release.totalBytes + manifest.bytes.length + detachedSignatureLength) fail('MSI_RELEASE_MISMATCH');
    await checkCopy();
    return { schemaVersion: 1, kind: 'shenyi-windows-final-msi-receipt', msi, ...copied, version, installedVersion,
      platform: 'win32', arch: 'x64', publisherCertificateSha256: publisher, productCode: source.productCode,
      packageCode: source.packageCode, releaseSourceDirectory: source.releaseSourceDirectory,
      releaseManifestSha256: release.manifestSha256, releaseSignatureSha256: release.signatureSha256,
      publicKeySha256: release.publicKeySha256, releaseFileCount: release.fileCount, releaseBytes: release.totalBytes,
      installerOsSignatureVerified: true, timestampVerified: true, installerDatabaseVerified: true,
      sourcePolicyVerified: true, administrativeExtractionVerified: true, releaseOsSignatureVerified: true,
      systemInstallPerformed: false };
  } finally {
    const current = await canonicalEntry(workspace, 'directory', 'MSI_WORKSPACE_CHANGED');
    if (!sameFile(current, workspaceOrigin)) fail('MSI_WORKSPACE_CHANGED');
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkWindowsReleaseMsiFromCli().catch(error => {
    console.error(JSON.stringify({ ok: false, code: error.code ?? 'MSI_RECEIPT_FAILED', message: error.message }));
    process.exitCode = 1;
  });
}

async function checkWindowsReleaseMsiFromCli() {
  const result = await checkWindowsReleaseMsi(parse(process.argv.slice(2)));
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}
