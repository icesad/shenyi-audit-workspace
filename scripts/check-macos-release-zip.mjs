#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { checkMacosReleaseApp, hasMacosReleaseIdentity } from './check-macos-release-app.mjs';

const exec = promisify(execFile);
const bundleName = 'Shenyi.app';
const archiveChecker = fileURLToPath(new URL('./build-macos-desktop-archive.py', import.meta.url));
const maxArchiveBytes = 1024n ** 3n;
const options = new Map([
  ['--archive', 'archive'], ['--sha256', 'sha256'], ['--python', 'python'],
  ['--app-payload-sha256', 'appPayloadSha256'],
  ['--team-id', 'teamId'], ['--bundle-id', 'bundleId'], ['--version', 'version'], ['--arch', 'arch'],
]);

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function invalidArguments() {
  fail('INVALID_ARGUMENTS', '请指定正式 ZIP、可信 SHA-256、Python 的绝对路径及获准的发行身份、版本和架构。');
}

function absolute(value) {
  return typeof value === 'string' && path.isAbsolute(value) && !/[\u0000-\u001f\u007f]/.test(value);
}

function parse(args) {
  const input = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = options.get(args[i]);
    const value = args[i + 1];
    if (!key || Object.hasOwn(input, key) || !value || value.startsWith('--')) invalidArguments();
    input[key] = value;
  }
  return input;
}

function identity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

async function inspectInput(filename) {
  try {
    const info = await lstat(filename, { bigint: true });
    if (info.isFile() && info.nlink === 1n && info.size >= 22n && info.size <= maxArchiveBytes &&
        await realpath(filename) === filename) return info;
  } catch { /* Report a single error for unreadable or noncanonical archive paths. */ }
  fail('ARCHIVE_PATH_INVALID', '请选择实际的未链接 ZIP 文件，大小须在接收范围内。');
}

async function copyApprovedArchive(filename, destination, expectedSha256) {
  const initial = await inspectInput(filename);
  const input = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (identity(await input.stat({ bigint: true })) !== identity(initial)) {
      fail('ARCHIVE_CHANGED', '归档在打开时发生变化。');
    }
    const output = await open(destination, 'wx', 0o600);
    try {
      const hash = createHash('sha256');
      let bytes = 0;
      const length = Number(initial.size);
      for await (const chunk of input.createReadStream({ autoClose: false, start: 0, end: length - 1 })) {
        bytes += chunk.length;
        hash.update(chunk);
        await output.writeFile(chunk);
      }
      if (bytes !== length || identity(await input.stat({ bigint: true })) !== identity(initial) ||
          identity(await lstat(filename, { bigint: true })) !== identity(initial) || await realpath(filename) !== filename) {
        fail('ARCHIVE_CHANGED', '归档在复制时发生变化。');
      }
      if (hash.digest('hex') !== expectedSha256) fail('ARCHIVE_DIGEST_MISMATCH', '归档 SHA-256 与获准发行记录不一致。');
      await output.chmod(0o400);
      return bytes;
    } finally { await output.close(); }
  } finally { await input.close(); }
}

async function systemCommand(program, args) {
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C', LANG: 'C' };
  if (process.env.HOME) env.HOME = process.env.HOME;
  return exec(program, args, { env, encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 });
}

async function verifyCopiedArchive(run, copy, byteLength, expected) {
  const { python, sha256, arch, bundleId, version, appPayloadSha256 } = expected;
  const payloadArgs = appPayloadSha256 === undefined ? [] : ['--app-payload-sha256', appPayloadSha256];
  let receipt;
  try {
    const { stdout } = await run(python, [
      '-I', archiveChecker, '--verify-release', copy, arch, version, '--bundle-id', bundleId, '--sha256', sha256,
      ...payloadArgs,
    ]);
    receipt = JSON.parse(stdout);
  } catch {
    fail('ARCHIVE_STRUCTURE_INVALID', '正式归档的内容核验未通过。');
  }
  const { format, archiveSha256, archiveBytes, archiveEntries, symlinks, appFiles, bundleIdentifier } = receipt ?? {};
  if (format !== 'shenyi-macos-release-zip' || archiveSha256 !== sha256 || archiveBytes !== byteLength ||
      receipt.arch !== arch || receipt.version !== version || bundleIdentifier !== bundleId ||
      ![archiveEntries, symlinks, appFiles].every(Number.isSafeInteger) || appFiles < 1 || symlinks < 0 ||
      appFiles + symlinks > archiveEntries ||
      (appPayloadSha256 !== undefined && receipt.appPayloadSha256 !== appPayloadSha256)) {
    fail('ARCHIVE_RECEIPT_MISMATCH', '归档核验回执与本次获准发行记录不一致。');
  }
  const verified = { archiveSha256, archiveBytes, archiveEntries, symlinks, appFiles };
  if (appPayloadSha256 !== undefined) verified.appPayloadSha256 = appPayloadSha256;
  return verified;
}

async function assertPrivateArchiveUnchanged(copy, sealed, expectedSha256, byteLength) {
  const changed = () => fail('ARCHIVE_CHANGED', '临时归档在接收核验期间发生变化。');
  if (identity(await lstat(copy, { bigint: true })) !== sealed || await realpath(copy) !== copy) changed();
  const handle = await open(copy, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (identity(await handle.stat({ bigint: true })) !== sealed) changed();
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, start: 0, end: byteLength - 1 })) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    if (bytes !== byteLength || hash.digest('hex') !== expectedSha256 ||
        identity(await handle.stat({ bigint: true })) !== sealed ||
        identity(await lstat(copy, { bigint: true })) !== sealed || await realpath(copy) !== copy) changed();
  } finally { await handle.close(); }
}

export async function checkMacosReleaseZip(expected, {
  platform = process.platform, run = systemCommand, checkApp = checkMacosReleaseApp, temporaryRoot = tmpdir(),
} = {}) {
  if (platform !== 'darwin') fail('MACOS_REQUIRED', '最终 ZIP 的 Apple 签名核验须在真实 macOS 上运行。');
  const { archive, sha256, python, teamId, bundleId, version, arch, appPayloadSha256 } = expected ?? {};
  if (!absolute(archive) || path.resolve(archive) !== archive || path.extname(archive).toLowerCase() !== '.zip' ||
      !absolute(python) || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256) ||
      (appPayloadSha256 !== undefined && (typeof appPayloadSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(appPayloadSha256))) ||
      !hasMacosReleaseIdentity({ teamId, bundleId, version, arch })) invalidArguments();

  const workspace = await mkdtemp(path.join(await realpath(temporaryRoot), 'shenyi-release-zip-'));
  const workspaceOrigin = await lstat(workspace, { bigint: true });
  try {
    await chmod(workspace, 0o700);
    const copy = path.join(workspace, 'approved.zip');
    const byteLength = await copyApprovedArchive(archive, copy, sha256);
    const sealed = identity(await lstat(copy, { bigint: true }));
    const receipt = await verifyCopiedArchive(run, copy, byteLength, expected);
    await assertPrivateArchiveUnchanged(copy, sealed, sha256, byteLength);
    const extracted = path.join(workspace, 'app');
    await mkdir(extracted, { mode: 0o700 });
    try { await run('/usr/bin/ditto', ['-x', '-k', '--rsrc', copy, extracted]); }
    catch { fail('ARCHIVE_EXTRACTION_FAILED', 'macOS 归档工具未能展开已核验的 ZIP。'); }
    await assertPrivateArchiveUnchanged(copy, sealed, sha256, byteLength);

    const names = await readdir(extracted);
    const candidate = path.join(extracted, bundleName);
    if (names.length !== 1 || names[0] !== bundleName || !(await lstat(candidate)).isDirectory() ||
        await realpath(candidate) !== candidate) {
      fail('ARCHIVE_EXTRACTION_INVALID', '解包结果须仅包含实际的 Shenyi.app。');
    }
    const result = await checkApp({ app: candidate, teamId, bundleId, version, arch });
    if (result?.kind !== 'shenyi-macos-native-release-app-check' || result.app !== candidate ||
        result.teamId !== teamId || result.bundleId !== bundleId || result.version !== version ||
        result.mainExecutableArch !== arch || result.appLaunched !== false) {
      fail('APP_RECEIPT_MISMATCH', 'Apple 签名与公证核验回执和解包结果不一致。');
    }
    await assertPrivateArchiveUnchanged(copy, sealed, sha256, byteLength);
    const { app, ...appReceipt } = result;
    return { ...appReceipt, ...receipt, kind: 'shenyi-macos-native-release-zip-check', archive, archiveVerified: true };
  } finally {
    const current = await lstat(workspace, { bigint: true });
    if (!current.isDirectory() || current.dev !== workspaceOrigin.dev || current.ino !== workspaceOrigin.ino ||
        await realpath(workspace) !== workspace) {
      fail('WORKSPACE_CHANGED', '收件临时目录发生变化，请核对路径。');
    }
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => checkMacosReleaseZip(parse(process.argv.slice(2))))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(JSON.stringify({ code: error.code ?? 'MACOS_RELEASE_ZIP_CHECK_FAILED', message: error.message }));
      process.exitCode = 1;
    });
}
