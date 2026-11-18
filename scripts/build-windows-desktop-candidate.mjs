#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const manifestFile = 'candidate-manifest.json';
const defaultApp = 'resources/default_app.asar';
const samePath = (a, b) => path.relative(a, b) === '';
const archiveHashPattern = /^[a-f0-9]{64}$/;
const npmPackageName = /^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/;

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

function inside(rootDirectory, child) {
  const relative = path.relative(rootDirectory, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

async function absent(file) {
  try {
    await lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('输出目录已存在，请选择新的目录。');
}

export async function resolveBuildOutput(output, checkout = root) {
  const canonicalRoot = await realpath(checkout);
  const requested = path.resolve(output);
  if (requested === path.parse(requested).root || inside(canonicalRoot, requested)) throw new Error('输出目录必须位于仓库外。');
  const destination = path.join(await realpath(path.dirname(requested)), path.basename(requested));
  if (inside(canonicalRoot, destination)) throw new Error('输出目录的实际位置必须位于仓库外。');
  await absent(destination);
  return destination;
}

export async function fileFacts(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}

export async function verifyElectronArchive(archive, expectedHash) {
  if (!archiveHashPattern.test(expectedHash)) throw new Error('缺少所锁定 Electron 归档的官方校验值。');
  const requested = path.resolve(archive);
  const canonical = await realpath(requested);
  if (!samePath(requested, canonical) || !(await lstat(canonical)).isFile()) throw new Error('Electron 归档必须是指定位置的普通文件。');
  const facts = await fileFacts(canonical);
  if (facts.sha256 !== expectedHash) throw new Error('Electron 归档 SHA-256 与官方校验值不符。');
  return { file: canonical, ...facts };
}

async function walkFiles(directory, prefix = '') {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relative = prefix + entry.name;
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      files.push(...await walkFiles(path.join(directory, entry.name), relative + '/'));
    } else if (entry.isFile() && !entry.isSymbolicLink()) {
      files.push(relative);
    } else {
      throw new Error(`包内出现无法接受的文件类型 ${relative}`);
    }
  }
  return files.sort();
}

function exactFiles(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new Error(`${label}与已确认的清单不一致。`);
}

export async function loadBuildInventory(checkout = root, { platform = 'win32', arch = 'x64' } = {}) {
  if (!(platform === 'win32' && arch === 'x64') && !(platform === 'darwin' && ['arm64', 'x64'].includes(arch))) {
    throw new Error('桌面运行时平台或架构不受支持。');
  }
  const [allowlist, desktop, desktopLock, installedElectron, checksums, installedExtractor, appSource, appLock] = await Promise.all([
    'scripts/windows-desktop-candidate-files.json', 'desktop/package.json', 'desktop/package-lock.json',
    'desktop/node_modules/electron/package.json', 'desktop/node_modules/electron/checksums.json',
    'desktop/node_modules/@electron-internal/extract-zip/package.json', 'package.json', 'package-lock.json',
  ].map(file => json(path.join(checkout, file))));
  const electronVersion = allowlist.electronVersion;
  if (electronVersion !== desktop.devDependencies.electron || electronVersion !== desktopLock.packages[''].devDependencies.electron ||
      electronVersion !== desktopLock.packages['node_modules/electron'].version || electronVersion !== installedElectron.version ||
      installedExtractor.version !== desktopLock.packages['node_modules/@electron-internal/extract-zip'].version) {
    throw new Error('Electron、ZIP 解包器或 Windows 运行文件清单与锁文件不一致。');
  }
  const zipName = `electron-v${electronVersion}-${platform}-${arch}.zip`;
  const archiveHash = checksums[zipName];
  if (!archiveHashPattern.test(archiveHash ?? '')) throw new Error('Electron 包中没有目标平台的官方归档校验值。');
  const appPackage = {
    name: 'shenyi-team-desktop', productName: '审易', version: appSource.version, private: true,
    main: 'desktop/main.cjs', dependencies: { jsdom: appSource.dependencies.jsdom },
  };
  if (appPackage.version !== appLock.packages[''].version || Object.keys(appSource.dependencies).length !== 1 || Object.keys(appLock.packages[''].dependencies).length !== 1 ||
      appPackage.dependencies.jsdom !== appLock.packages[''].dependencies.jsdom ||
      appPackage.dependencies.jsdom !== appLock.packages['node_modules/jsdom'].version) {
    throw new Error('桌面生产依赖或版本已变化，请先更新包清单。');
  }
  const production = Object.entries(appLock.packages).filter(([name, record]) => name && !record.dev);
  for (const [name, record] of production) {
    if (!name.startsWith('node_modules/') || !npmPackageName.test(name.slice('node_modules/'.length)) || record.link ||
        !record.resolved?.startsWith('https://registry.npmjs.org/') || !/^sha512-/.test(record.integrity ?? '')) {
      throw new Error(`桌面依赖不符合固定包范围 ${name}`);
    }
  }
  const appPackageLock = {
    name: appPackage.name, version: appPackage.version, lockfileVersion: appLock.lockfileVersion, requires: true,
    packages: { '': { name: appPackage.name, version: appPackage.version, dependencies: appPackage.dependencies }, ...Object.fromEntries(production) },
  };
  const sourceFiles = allowlist.sourceFiles;
  const list = new Set(sourceFiles);
  if (new Set(sourceFiles).size !== sourceFiles.length || !list.has(appPackage.main) || !list.has('desktop/preload.cjs') ||
      sourceFiles.some(name => !/^(?:desktop|dist|shared)\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:cjs|js|css|html|png)$/.test(name))) {
    throw new Error('桌面源文件清单无效。');
  }
  const archiveFiles = [...allowlist.runtimeRootFiles, ...allowlist.electronLocales.map(locale => `locales/${locale}.pak`), defaultApp];
  return { electronVersion, zipName, archiveHash, archiveFiles, appPackage, appPackageLock, production, sourceFiles };
}

async function findNpmCli() {
  const program = path.dirname(process.execPath);
  const locations = [program, path.dirname(program), ...(process.env.PATH ?? '').split(path.delimiter).map(item => item.trim().replace(/^"|"$/g, '')).filter(Boolean)];
  for (const directory of new Set(locations.filter(name => path.isAbsolute(name)))) {
    const options = [path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js')];
    if (process.platform !== 'win32') options.push(path.resolve(directory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    for (const cli of options) {
      if ((await lstat(cli).catch(error => { if (error.code !== 'ENOENT') throw error; }))?.isFile()) return cli;
    }
  }
  throw new Error('未找到 npm-cli.js，请使用配有 npm 的 Node.js 运行环境。');
}

async function installProduction(appRoot, npmCli, cache, production) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:node_|npm_config_)/i.test(key)));
  const args = [npmCli, 'ci', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--no-bin-links', '--cache', cache,
    '--userconfig', path.join(appRoot, '.build-user-npmrc'), '--globalconfig', path.join(appRoot, '.build-global-npmrc')];
  try {
    await run(process.execPath, args, { cwd: appRoot, env, windowsHide: true });
  } catch (error) {
    throw new Error(`生产依赖离线安装未完成${error.code ? `（${error.code}）` : ''}，请核对指定的 npm 缓存。`);
  }
  const nodeModules = path.join(appRoot, 'node_modules');
  await unlink(path.join(nodeModules, '.package-lock.json')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const names = [];
  for (const entry of await readdir(nodeModules)) {
    if (entry.startsWith('@')) {
      names.push(...(await readdir(path.join(nodeModules, entry))).map(name => `node_modules/${entry}/${name}`));
    } else names.push('node_modules/' + entry);
  }
  exactFiles(names.sort(), production.map(([name]) => name), '已安装的生产依赖');
  for (const [name, record] of production) {
    const metadata = await json(path.join(appRoot, name, 'package.json'));
    if (`node_modules/${metadata.name}` !== name || metadata.version !== record.version) throw new Error(`生产依赖版本不符 ${name}`);
  }
}

async function copySources(appRoot, sourceFiles) {
  for (const file of sourceFiles) {
    const source = path.join(root, file);
    if (!samePath(source, await realpath(source)) || !(await lstat(source)).isFile()) throw new Error(`源文件位置无效 ${file}`);
    const destination = path.join(appRoot, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  }
}

export async function prepareDesktopCandidatePayload(appRoot, inventory, npmCache, npmCli) {
  await mkdir(appRoot);
  await writeJson(path.join(appRoot, 'package.json'), inventory.appPackage);
  await writeJson(path.join(appRoot, 'package-lock.json'), inventory.appPackageLock);
  await copySources(appRoot, inventory.sourceFiles);
  await installProduction(appRoot, npmCli ?? await findNpmCli(), npmCache, inventory.production);
}

export async function buildWindowsDesktopCandidate({ electronArchive, npmCache, output }) {
  if (process.platform !== 'win32') throw new Error('此命令仅用于 Windows x64 便携候选。');
  const destination = await resolveBuildOutput(output);
  const cache = await realpath(npmCache);
  if (!(await lstat(cache)).isDirectory() || inside(root, cache) || inside(cache, destination)) {
    throw new Error('请指定仓库外的既有 npm 缓存与独立输出目录。');
  }
  const [inventory, npmCli] = await Promise.all([loadBuildInventory(), findNpmCli()]);
  const archive = await verifyElectronArchive(electronArchive, inventory.archiveHash);
  const desktopRequire = createRequire(path.join(root, 'desktop/package.json'));
  const { extract } = desktopRequire('@electron-internal/extract-zip');
  const staging = await mkdtemp(path.join(path.dirname(destination), '.shenyi-windows-build-'));
  try {
    await extract(archive.file, { dir: staging });
    const after = await fileFacts(archive.file);
    if (after.sha256 !== archive.sha256 || after.bytes !== archive.bytes) throw new Error('Electron 归档在解包过程中发生变化。');
    exactFiles(await walkFiles(staging), inventory.archiveFiles, '官方 Electron 运行文件');
    await rename(path.join(staging, 'electron.exe'), path.join(staging, 'Shenyi.exe'));
    await rename(path.join(staging, 'electron_wer.dll'), path.join(staging, 'Shenyi_wer.dll'));
    await unlink(path.join(staging, defaultApp));
    const appRoot = path.join(staging, 'resources', 'app');
    await prepareDesktopCandidatePayload(appRoot, inventory, cache, npmCli);
    const entries = await walkFiles(staging);
    const files = {};
    for (const file of entries) files[file] = await fileFacts(path.join(staging, file));
    const manifest = {
      schemaVersion: 1, kind: 'shenyi-windows-desktop-candidate', platform: 'win32', arch: 'x64',
      releaseStatus: 'unsigned-portable-candidate', version: inventory.appPackage.version, trustedServiceProfileIncluded: false,
      electron: { version: inventory.electronVersion, archive: inventory.zipName, bytes: archive.bytes, sha256: archive.sha256 },
      sourceFileCount: inventory.sourceFiles.length, productionPackageCount: inventory.production.length, files,
    };
    await writeJson(path.join(staging, manifestFile), manifest);
    if (!samePath(staging, await realpath(staging)) || !samePath(path.dirname(destination), await realpath(path.dirname(destination)))) {
      throw new Error('候选输出路径在打包过程中发生变化。');
    }
    await absent(destination);
    await rename(staging, destination);
    return { output: destination, manifest: path.join(destination, manifestFile), files: entries.length };
  } catch (error) {
    throw new Error(`${error.message} 中间文件保留于 ${staging}`);
  }
}

function parseArguments(args) {
  const options = new Map();
  const names = ['--electron-archive', '--npm-cache', '--output'];
  for (let at = 0; at < args.length; at += 2) {
    const [key, value] = args.slice(at, at + 2);
    if (!names.includes(key) || !value || value.startsWith('--') || options.has(key)) return null;
    options.set(key, value);
  }
  if (options.size !== names.length) return null;
  return { electronArchive: options.get('--electron-archive'), npmCache: options.get('--npm-cache'), output: options.get('--output') };
}

async function main(args) {
  const options = parseArguments(args);
  if (!options || args[0] === '--help') {
    console.log('用法 node scripts/build-windows-desktop-candidate.mjs --electron-archive 归档路径 --npm-cache 既有缓存 --output 仓库外新目录');
    if (args.length !== 1 || args[0] !== '--help') process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify(await buildWindowsDesktopCandidate(options), null, 2));
}

if (process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
