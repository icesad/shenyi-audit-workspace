#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { link, lstat, mkdir, mkdtemp, realpath, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fileFacts, loadBuildInventory, prepareDesktopCandidatePayload, resolveBuildOutput,
  verifyElectronArchive } from './build-windows-desktop-candidate.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(directory, '..');
const run = promisify(execFile);
const architectures = new Set(['arm64', 'x64']);
const releaseStatus = 'candidate-requires-macos-signing-and-native-validation';

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

export async function buildMacosDesktopCandidate({ arch, electronArchive, npmCache, output }) {
  if (!architectures.has(arch)) throw new Error('macOS 桌面候选仅支持 arm64 或 x64。');
  const canonicalCheckout = await realpath(checkout);
  const destination = await resolveBuildOutput(output, canonicalCheckout);
  const cache = await realpath(npmCache);
  if (!(await lstat(cache)).isDirectory() || inside(canonicalCheckout, cache) || inside(cache, destination)) {
    throw new Error('请指定仓库外的既有 npm 缓存与独立输出目录。');
  }
  const inventory = await loadBuildInventory(canonicalCheckout, { platform: 'darwin', arch });
  const electron = await verifyElectronArchive(electronArchive, inventory.archiveHash);
  const staging = await mkdtemp(path.join(path.dirname(destination), '.shenyi-macos-build-'));
  const payload = path.join(staging, 'payload');
  const name = `Shenyi-macos-${arch}.zip`;
  const archive = path.join(staging, name);
  const manifestName = 'candidate-manifest.json';
  const stagedManifest = path.join(staging, manifestName);
  try {
    await prepareDesktopCandidatePayload(payload, inventory, cache);
    const command = process.platform === 'win32' ? 'python' : 'python3';
    const args = ['-I', path.join(directory, 'build-macos-desktop-archive.py'),
      electron.file, payload, archive, arch, inventory.appPackage.version];
    const { stdout } = await run(command, args, { windowsHide: true });
    const archiveInventory = JSON.parse(stdout);
    if (!archiveInventory || archiveInventory.bundleIdentifier !== 'invalid.shenyi.audit.candidate' ||
      !['archiveEntries', 'symlinks', 'appFiles'].every(key => Number.isSafeInteger(archiveInventory[key]) && archiveInventory[key] > 0)) {
      throw new Error('候选归档缺少预期的 macOS 结构核验回执。');
    }
    const sourceAfter = await fileFacts(electron.file);
    if (sourceAfter.sha256 !== electron.sha256 || sourceAfter.bytes !== electron.bytes) {
      throw new Error('Electron 归档在构建过程中发生变化。');
    }
    const manifest = {
      schemaVersion: 1, kind: 'shenyi-macos-desktop-candidate', platform: 'darwin', arch, releaseStatus,
      version: inventory.appPackage.version, trustedServiceProfileIncluded: false,
      electron: { version: inventory.electronVersion, archive: inventory.zipName, bytes: electron.bytes, sha256: electron.sha256 },
      archive: { filename: name, ...await fileFacts(archive) },
      bundleIdentifier: archiveInventory.bundleIdentifier,
      archiveEntries: archiveInventory.archiveEntries, symlinkCount: archiveInventory.symlinks,
      applicationFileCount: archiveInventory.appFiles, sourceFileCount: inventory.sourceFiles.length,
      productionPackageCount: inventory.production.length,
    };
    await writeFile(stagedManifest, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    if (path.relative(staging, await realpath(staging)) || path.relative(payload, await realpath(payload)) ||
      path.relative(path.dirname(staging), await realpath(path.dirname(destination)))) {
      throw new Error('候选输出的实际路径在打包过程中发生变化。');
    }
    await rm(payload, { recursive: true });
    if (path.relative(destination, await resolveBuildOutput(output, canonicalCheckout))) {
      throw new Error('候选输出位置在打包过程中发生变化。');
    }
    // Reserve the directory exclusively. A concurrent POSIX rename could
    // otherwise replace an empty directory created after our absence check.
    await mkdir(destination, { mode: 0o700 });
    if (path.relative(destination, await realpath(destination))) throw new Error('候选输出目录发生变化。');
    const publishedArchive = path.join(destination, name);
    const publishedManifest = path.join(destination, manifestName);
    await link(archive, publishedArchive);
    await link(stagedManifest, publishedManifest);
    const result = { output: destination, archive: publishedArchive, manifest: publishedManifest };
    try {
      await unlink(archive);
      await unlink(stagedManifest);
      await rmdir(staging);
    } catch {
      // Once the manifest link commits the candidate, cleanup cannot undo it.
      result.stagingRemaining = staging;
    }
    return result;
  } catch (error) {
    const explanation = error.stderr?.trim() || error.message;
    throw new Error(`${explanation} 中间文件保留于 ${staging}`);
  }
}

export function parseMacosCandidateArguments(args) {
  const options = new Map();
  const names = ['--arch', '--electron-archive', '--npm-cache', '--output'];
  if (args.length !== names.length * 2) return null;
  for (let at = 0; at < args.length; at += 2) {
    const [key, value] = args.slice(at, at + 2);
    if (!names.includes(key) || !value || value.startsWith('--') || options.has(key)) return null;
    options.set(key, value);
  }
  const arch = options.get('--arch');
  if (!architectures.has(arch)) return null;
  return { arch, electronArchive: options.get('--electron-archive'), npmCache: options.get('--npm-cache'), output: options.get('--output') };
}

if (process.argv[1] && !path.relative(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const options = parseMacosCandidateArguments(args);
  if (options) {
    buildMacosDesktopCandidate(options).then(result => console.log(JSON.stringify(result, null, 2)))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  } else {
    console.log('用法 node scripts/build-macos-desktop-candidate.mjs --arch arm64|x64 --electron-archive 归档路径 --npm-cache 既有缓存 --output 仓库外新目录');
    process.exitCode = args.length === 1 && args[0] === '--help' ? 0 : 2;
  }
}
