#!/usr/bin/env node
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST = 'owner-review-manifest.json';
const RUNS = 'review-runs';
const MANIFEST_LIMIT = 2 * 1024 * 1024;
const FILE_LIMIT = 10_000;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const REQUIRED = ['README-Owner-Review.md', 'owner-review-runtime.json', 'runtime/node/node.exe', 'runtime/electron/electron.exe'];
const STAT_FIELDS = ['dev', 'ino', 'size', 'mode', 'nlink', 'mtimeNs', 'ctimeNs'];

class VerificationError extends Error {}

function require(condition, message) {
  if (!condition) throw new VerificationError(message);
}

function exactly(object, keys) {
  return object && Object.getPrototypeOf(object) === Object.prototype &&
    Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
}

function matches(pattern, value) {
  return typeof value === 'string' && pattern.exec(value)?.[0] === value;
}

function safeMemberName(relative) {
  const parts = relative.split('/');
  return relative.length <= 1024 && parts.length <= 32 && parts.every(part =>
    part.length <= 255 && matches(/^[A-Za-z0-9._@+ -]+$/, part) && !/[. ]$/.test(part) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(part.split('.', 1)[0].trim()));
}

function unchanged(before, after) {
  return STAT_FIELDS.every(key => before[key] === after[key]);
}

async function ordinary(filename, label, directory = false) {
  const info = await lstat(filename, { bigint: true });
  const correctType = directory ? info.isDirectory() : info.isFile() && info.nlink === 1n;
  require(correctType && !info.isSymbolicLink() && path.relative(filename, await realpath(filename)) === '',
    `文件或目录位置无效。${label}`);
  return info;
}

async function inspectFile(filename, label, inspect) {
  const before = await ordinary(filename, label);
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    require(unchanged(before, await handle.stat({ bigint: true })), `文件打开时已变化。${label}`);
    const result = await inspect(handle, before.size);
    require(unchanged(before, await handle.stat({ bigint: true })) && unchanged(before, await ordinary(filename, label)),
      `文件在校验期间发生变化。${label}`);
    return { result, before };
  } finally {
    await handle.close();
  }
}

async function readManifest(root) {
  const { result: bytes } = await inspectFile(path.join(root, MANIFEST), MANIFEST, async (handle, size) => {
    require(size > 0n && size <= BigInt(MANIFEST_LIMIT), '评审包清单大小无效。');
    const data = Buffer.alloc(Number(size) + 1);
    let position = 0;
    while (position < data.length) {
      const { bytesRead } = await handle.read(data, position, data.length - position, null);
      if (!bytesRead) break;
      position += bytesRead;
    }
    require(position === Number(size), '评审包清单在读取期间发生变化。');
    return data.subarray(0, position);
  });
  let content, text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    content = JSON.parse(text);
  } catch {
    throw new VerificationError('无法解析评审包清单。');
  }
  // The builder has a single serialization; round-tripping rejects duplicate JSON fields.
  require(text === JSON.stringify(content, null, 2) + '\n', '评审包清单格式不符。');
  return { content, digest: createHash('sha256').update(bytes).digest('hex') };
}

function expectedMembers(content) {
  require(exactly(content, ['schemaVersion', 'kind', 'version', 'syntheticOnly', 'runtime', 'files']) &&
    content.schemaVersion === 1 && content.kind === 'shenyi-owner-review-windows-x64' && content.syntheticOnly === true &&
    matches(VERSION, content.version), '此清单不属于 Windows 双人评审包。');
  const { runtime } = content;
  require(exactly(runtime, ['node', 'electron']) && Object.values(runtime).every(item =>
    exactly(item, ['version', 'archiveSha256']) && matches(VERSION, item.version) &&
    matches(SHA256, item.archiveSha256)), '评审包运行时清单无效。');
  require(content.files && Object.getPrototypeOf(content.files) === Object.prototype, '评审包文件清单无效。');
  const files = new Map(Object.entries(content.files));
  require(files.size <= FILE_LIMIT && REQUIRED.every(file => files.has(file)), '评审包文件清单缺少必要文件或超出范围。');
  const directories = new Set();
  for (const [relative, facts] of files) {
    const top = relative.split('/')[0].toLowerCase();
    require(safeMemberName(relative) && top !== MANIFEST && top !== RUNS, '评审包清单含无效路径。');
    require(exactly(facts, ['bytes', 'sha256']) && Number.isSafeInteger(facts.bytes) && facts.bytes >= 0 &&
      matches(SHA256, facts.sha256), `文件校验值无效。${relative}`);
    for (let parent = path.posix.dirname(relative); parent !== '.'; parent = path.posix.dirname(parent)) {
      directories.add(parent);
    }
  }
  const names = [...directories, ...files.keys()];
  require(new Set(names.map(name => name.toLowerCase())).size === names.length, '评审包清单路径发生冲突。');
  const bytes = [...files.values()].reduce((total, file) => total + file.bytes, 0);
  require(Number.isSafeInteger(bytes), '评审包载荷大小无效。');
  return { files, directories, bytes };
}

export async function verifyWindowsOwnerReview(directory) {
  const root = path.resolve(directory);
  const rootInfo = await ordinary(root, '评审包根目录', true);
  const { content, digest } = await readManifest(root);
  const { files, directories, bytes } = expectedMembers(content);
  const pending = new Set(files.keys());
  const inspected = [];
  const block = Buffer.alloc(256 * 1024);
  let reviewRunsPresent = false;

  async function scan(folder, prefix, before) {
    for await (const entry of await opendir(folder)) {
      const relative = prefix + entry.name;
      const filename = path.join(folder, entry.name);
      if (relative === MANIFEST) continue;
      if (relative === RUNS) {
        await ordinary(filename, RUNS, true);
        reviewRunsPresent = true;
      } else if (directories.has(relative)) {
        await scan(filename, relative + '/', await ordinary(filename, relative, true));
      } else if (files.has(relative)) {
        const expected = files.get(relative);
        const verified = await inspectFile(filename, relative, async (handle, size) => {
          require(size === BigInt(expected.bytes), `文件字节数不符。${relative}`);
          const hash = createHash('sha256');
          let length = 0;
          for (;;) {
            const { bytesRead } = await handle.read(block, 0, block.length, null);
            if (!bytesRead) break;
            length += bytesRead;
            require(length <= expected.bytes, `文件字节数不符。${relative}`);
            hash.update(block.subarray(0, bytesRead));
          }
          require(length === expected.bytes && hash.digest('hex') === expected.sha256, `文件 SHA-256 不符。${relative}`);
        });
        inspected.push({ filename, label: relative, directory: false, before: verified.before });
        pending.delete(relative);
      } else {
        const label = safeMemberName(relative) ? relative : '路径格式无效';
        throw new VerificationError(`解压目录含清单以外的文件或目录。${label}`);
      }
    }
    inspected.push({ filename: folder, label: prefix || '评审包根目录', directory: true, before });
  }

  await scan(root, '', rootInfo);
  require(pending.size === 0, `解压目录缺少文件。${pending.values().next().value ?? ''}`);
  for (const { filename, label, directory, before } of inspected) {
    require(unchanged(before, await ordinary(filename, label, directory)), `解压目录在校验期间发生变化。${label}`);
  }
  require((await readManifest(root)).digest === digest, '评审包清单在校验期间发生变化。');
  return { version: content.version, files: files.size, bytes, manifestSha256: digest, reviewRunsPresent };
}

const script = fileURLToPath(import.meta.url);
if (process.argv[1] && path.relative(path.resolve(process.argv[1]), script) === '') {
  try {
    require(process.argv.length <= 3, '校验入口只接受一个可选的评审包目录。');
    const result = await verifyWindowsOwnerReview(process.argv[2] ?? path.join(path.dirname(script), '..'));
    console.log('评审包校验通过。');
    console.log(`版本 ${result.version}，文件数 ${result.files}，载荷字节数 ${result.bytes}。`);
    console.log(`清单 SHA-256 ${result.manifestSha256}`);
    if (result.reviewRunsPresent) console.log('已跳过本机演练目录 review-runs。');
  } catch (error) {
    console.error('评审包校验失败。' + (error instanceof VerificationError ? error.message : '请核对解压目录及读取权限。'));
    process.exitCode = 1;
  }
}
