import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { verifyWindowsOwnerReview } from './verify-windows-owner-review.mjs';

const runtimePrefix = 'runtime/electron/';
const manifestLimit = 8 * 1024 * 1024;
const noFollow = constants.O_NOFOLLOW ?? 0;
const identityFields = ['dev', 'ino', 'mode'];
const fileFields = [...identityFields, 'nlink', 'size', 'mtimeNs', 'ctimeNs'];

function requireRuntime(condition, message) {
  if (!condition) throw new Error(message);
}

function samePath(left, right) {
  return path.relative(left, right) === '';
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function absolute(filename) {
  requireRuntime(typeof filename === 'string' && path.isAbsolute(filename) && filename.isWellFormed() &&
    !/[\x00-\x1f\x7f]/.test(filename) && !/^[\\/]{2}/.test(filename) &&
    !filename.split(/[\\/]/).some(part => part === '.' || part === '..'), '评审运行时路径无效。');
  return path.resolve(filename);
}

function equalStats(left, right, fields) {
  return fields.every(name => left[name] === right[name]);
}

async function ordinary(filename, kind) {
  const info = await lstat(filename, { bigint: true });
  const expected = kind === 'directory' ? info.isDirectory() : info.isFile() && info.nlink === 1n;
  requireRuntime(expected && !info.isSymbolicLink() && samePath(filename, await realpath(filename)),
    '评审运行时文件或目录不是原位置的普通条目。');
  return info;
}

async function assertState(filename, info, kind) {
  const fields = kind === 'directory' ? identityFields : fileFields;
  requireRuntime(equalStats(info, await ordinary(filename, kind), fields), '评审运行时文件或目录在操作期间发生变化。');
}

async function readVerifiedManifest(filename, expectedDigest) {
  const before = await ordinary(filename, 'file');
  requireRuntime(before.size > 0n && before.size <= BigInt(manifestLimit), '评审运行时清单大小无效。');
  const handle = await open(filename, constants.O_RDONLY | noFollow);
  try {
    requireRuntime(equalStats(before, await handle.stat({ bigint: true }), fileFields), '评审运行时清单在打开时发生变化。');
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    requireRuntime(length === Number(before.size) &&
      createHash('sha256').update(bytes.subarray(0, length)).digest('hex') === expectedDigest &&
      equalStats(before, await handle.stat({ bigint: true }), fileFields), '评审运行时清单在校验后发生变化。');
    await assertState(filename, before, 'file');
    return { manifest: JSON.parse(bytes.subarray(0, length).toString('utf8')), info: before };
  } finally {
    await handle.close();
  }
}

async function copyRuntimeFile(source, destination, expected, buffer, files) {
  const before = await ordinary(source, 'file');
  requireRuntime(before.size === BigInt(expected.bytes), '评审运行时文件大小与清单不符。');
  const input = await open(source, constants.O_RDONLY | noFollow);
  try {
    requireRuntime(equalStats(before, await input.stat({ bigint: true }), fileFields), '评审运行时源文件在打开时发生变化。');
    const output = await open(destination, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
    const entry = { filename: destination, info: null };
    try {
      entry.info = await output.stat({ bigint: true });
      files.push(entry);
      let length = 0;
      for (;;) {
        const { bytesRead } = await input.read(buffer, 0, buffer.length, length);
        if (!bytesRead) break;
        requireRuntime(length + bytesRead <= expected.bytes, '评审运行时源文件大小发生变化。');
        let offset = 0;
        while (offset < bytesRead) {
          const { bytesWritten } = await output.write(buffer, offset, bytesRead - offset, length + offset);
          requireRuntime(bytesWritten > 0, '评审运行时副本写入不完整。');
          offset += bytesWritten;
        }
        length += bytesRead;
      }
      entry.info = await output.stat({ bigint: true });
      requireRuntime(length === expected.bytes && entry.info.size === BigInt(expected.bytes) &&
        equalStats(before, await input.stat({ bigint: true }), fileFields), '评审运行时源文件在复制期间发生变化。');
      const digest = createHash('sha256');
      let position = 0;
      for (;;) {
        const { bytesRead } = await output.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        position += bytesRead;
        requireRuntime(position <= length, '评审运行时副本大小发生变化。');
        digest.update(buffer.subarray(0, bytesRead));
      }
      requireRuntime(position === length && digest.digest('hex') === expected.sha256 &&
        equalStats(entry.info, await output.stat({ bigint: true }), fileFields), '评审运行时副本与清单不符。');
      await assertState(source, before, 'file');
      await assertState(destination, entry.info, 'file');
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}

async function cleanStage(runRoot, runInfo, directories, files) {
  await assertState(runRoot, runInfo, 'directory');
  // Validate the complete set before removing anything, then validate again at each removal.
  for (const [directory, info] of directories) await assertState(directory, info, 'directory');
  for (const entry of files) await assertState(entry.filename, entry.info, 'file');
  for (const { filename, info } of files) {
    const parent = path.dirname(filename);
    await assertState(parent, directories.get(parent), 'directory');
    await assertState(filename, info, 'file');
    await unlink(filename);
  }
  for (const [directory, info] of [...directories].reverse()) {
    await assertState(directory, info, 'directory');
    try {
      await rmdir(directory);
    } catch (error) {
      // Electron or the native picker can have added diagnostics after staging.
      if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error;
    }
  }
}

export async function stageOwnerReviewElectronRuntime(portable, runDirectory) {
  const appRoot = absolute(portable?.appRoot);
  const runtimeSource = path.join(appRoot, 'runtime', 'electron');
  requireRuntime(samePath(absolute(portable?.electronExecutable), path.join(runtimeSource, 'electron.exe')),
    '评审运行时入口位置无效。');
  const runRoot = absolute(runDirectory);
  requireRuntime(!samePath(appRoot, runRoot) && (!inside(appRoot, runRoot) || inside(path.join(appRoot, 'review-runs'), runRoot)),
    '评审运行时必须使用本轮演练目录。');
  const runInfo = await ordinary(runRoot, 'directory');
  const runtimeInfo = await ordinary(runtimeSource, 'directory');
  const { manifestSha256 } = await verifyWindowsOwnerReview(appRoot);
  const manifestFile = path.join(appRoot, 'owner-review-manifest.json');
  const { manifest, info: manifestInfo } = await readVerifiedManifest(manifestFile, manifestSha256);
  const entries = Object.entries(manifest.files).filter(([name]) => name.startsWith(runtimePrefix));
  requireRuntime(entries.some(([name]) => name === runtimePrefix + 'electron.exe'), '评审运行时清单缺少入口。');

  await assertState(runRoot, runInfo, 'directory');
  const directory = await mkdtemp(path.join(runRoot, 'electron-runtime-'));
  const directories = new Map([[directory, await ordinary(directory, 'directory')]]);
  const files = [];
  let closing;
  const close = () => closing ??= cleanStage(runRoot, runInfo, directories, files);
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    for (const [member, expected] of entries) {
      const parts = member.slice(runtimePrefix.length).split('/');
      const filename = parts.pop();
      let parent = directory;
      for (const name of parts) {
        await assertState(parent, directories.get(parent), 'directory');
        parent = path.join(parent, name);
        if (!directories.has(parent)) {
          await mkdir(parent, { mode: 0o700 });
          directories.set(parent, await ordinary(parent, 'directory'));
        }
      }
      await assertState(parent, directories.get(parent), 'directory');
      await copyRuntimeFile(path.join(runtimeSource, ...parts, filename), path.join(parent, filename), expected, buffer, files);
    }
    await assertState(runtimeSource, runtimeInfo, 'directory');
    await assertState(runRoot, runInfo, 'directory');
    await assertState(manifestFile, manifestInfo, 'file');
    await readVerifiedManifest(manifestFile, manifestSha256);
    for (const { filename, info } of files) await assertState(filename, info, 'file');
    return Object.freeze({ executable: path.join(directory, 'electron.exe'), close });
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], '评审运行时准备失败，运行副本已保留。');
    }
    throw error;
  }
}
