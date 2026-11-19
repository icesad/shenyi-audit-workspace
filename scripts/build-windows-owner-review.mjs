#!/usr/bin/env node
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { fileFacts, loadBuildInventory, prepareDesktopCandidatePayload, resolveBuildOutput, verifyElectronArchive } from './build-windows-desktop-candidate.mjs';
import previewConfiguration from '../desktop/isolated-preview-config.cjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeVersion = '24.22.1';
const nodeDirectory = 'node-v' + nodeVersion + '-win-x64';
// https://nodejs.org/dist/v24.22.1/SHASUMS256.txt
const nodeZipSha256 = 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5';
const reviewFiles = new Map([
  ['scripts/team-isolated-preview.mjs', 'scripts/team-isolated-preview.mjs'],
  ['scripts/team-billing-preview-fixture.mjs', 'scripts/team-billing-preview-fixture.mjs'],
  ['scripts/team-pilot-preview-fixture.mjs', 'scripts/team-pilot-preview-fixture.mjs'],
  ['scripts/website-preview.mjs', 'scripts/website-preview.mjs'],
  ['desktop/package.json', 'desktop/package.json'],
  ['website/index.html', 'website/index.html'],
  ['website/styles.css', 'website/styles.css'],
  ['website/README.md', 'website/README.md'],
  ['docs/PILOT_OWNER_REVIEW.md', 'docs/PILOT_OWNER_REVIEW.md'],
  ['docs/TEAM_PILOT_REHEARSAL.md', 'docs/TEAM_PILOT_REHEARSAL.md'],
  ['docs/M5_LOCAL_ACCEPTANCE.md', 'docs/M5_LOCAL_ACCEPTANCE.md'],
  ['docs/PORTABLE_OWNER_REVIEW.md', 'README-Owner-Review.md'],
]);
const launches = new Map([
  ['Start-Team-Pilot-Candidate.cmd', ['team-isolated-preview.mjs', '--pilot-demo']],
  ['Start-Team-Billing-Candidate.cmd', ['team-isolated-preview.mjs', '--billing-demo']],
  ['Start-Website-Preview.cmd', ['website-preview.mjs', '--open']],
]);

const samePath = (left, right) => path.relative(left, right) === '';
const within = (parent, child) => {
  const relative = path.relative(parent, child);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
};

async function regular(filename) {
  if (!samePath(filename, await realpath(filename)) || !(await lstat(filename)).isFile()) {
    throw new Error('便携评审文件须为指定位置的普通文件。');
  }
}

async function copyRegular(source, destination) {
  await regular(source);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination, constants.COPYFILE_EXCL);
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory() && samePath(filename, await realpath(filename))) {
      files.push(...await listFiles(filename, relative + '/'));
    } else if (entry.isFile() && !entry.isSymbolicLink()) {
      files.push(relative);
    } else {
      throw new Error('便携评审包不接受链接或特殊文件。');
    }
  }
  return files.sort();
}

function commandFile([script, flag]) {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    '"%SystemRoot%\\System32\\chcp.com" 65001 >nul',
    'cd /d "%~dp0" || exit /b 1',
    'set "NODE_OPTIONS="',
    'set "NODE_PATH="',
    'set "NODE_V8_COVERAGE="',
    'set "PATH=%SystemRoot%\\System32;%SystemRoot%"',
    '"%~dp0runtime\\node\\node.exe" "%~dp0scripts\\' + script + '" ' + flag,
    'set "REVIEW_EXIT=%errorlevel%"',
    'if not "%REVIEW_EXIT%"=="0" pause',
    'exit /b %REVIEW_EXIT%',
    '',
  ].join('\r\n');
}

async function serverSources() {
  const list = JSON.parse(await readFile(path.join(checkout, 'scripts', 'owner-review-server-files.json'), 'utf8'));
  if (!Array.isArray(list) || !list.includes('server/team/dev-server.mjs') || !list.includes('server/team/schema.sql') ||
      new Set(list).size !== list.length || list.some(file => typeof file !== 'string' || !/^server\/team\/[a-z0-9-]+\.(?:mjs|sql)$/.test(file))) {
    throw new Error('合成服务运行文件清单无效。');
  }
  return list;
}

async function publishDirectory(bundle, output, working) {
  // A Windows filesystem provider may briefly still hold the newly written directory.
  for (const wait of [0, 250, 750]) {
    if (wait) await delay(wait);
    if (!samePath(bundle, await realpath(bundle)) || !samePath(working, await realpath(working)) ||
        !samePath(output, await resolveBuildOutput(output))) throw new Error('便携评审输出路径发生变化。');
    try {
      await rename(bundle, output);
      return;
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || wait === 750) throw error;
    }
  }
}

async function build({ nodeArchive, electronArchive, npmCache, output }) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('请在 Windows x64 上构建便携评审包。');
  const destination = await resolveBuildOutput(output);
  const cache = await realpath(npmCache);
  if (!(await lstat(cache)).isDirectory() || within(checkout, cache) || within(cache, destination)) {
    throw new Error('请指定仓库外的既有 npm 缓存与独立输出目录。');
  }
  const nodeZip = path.resolve(nodeArchive);
  await regular(nodeZip);
  const nodeFacts = await fileFacts(nodeZip);
  if (nodeFacts.sha256 !== nodeZipSha256) throw new Error('Node.js ZIP 与官方固定 SHA-256 不符。');
  const inventory = await loadBuildInventory();
  const electron = await verifyElectronArchive(electronArchive, inventory.archiveHash);
  const serviceFiles = await serverSources();
  const { extract } = createRequire(path.join(checkout, 'desktop/package.json'))('@electron-internal/extract-zip');
  const working = await mkdtemp(path.join(path.dirname(destination), '.shenyi-owner-review-'));
  try {
    const bundle = path.join(working, 'bundle');
    await prepareDesktopCandidatePayload(bundle, inventory, cache);
    const electronOutput = path.join(bundle, 'runtime', 'electron');
    const nodeScratch = path.join(working, 'node-source');
    await mkdir(electronOutput, { recursive: true });
    await mkdir(nodeScratch);
    await Promise.all([extract(electron.file, { dir: electronOutput }), extract(nodeZip, { dir: nodeScratch })]);
    const [nodeAfter, electronAfter] = await Promise.all([fileFacts(nodeZip), fileFacts(electron.file)]);
    if (nodeAfter.sha256 !== nodeFacts.sha256 || electronAfter.sha256 !== electron.sha256) throw new Error('运行时归档在解包期间发生变化。');
    if (JSON.stringify(await listFiles(electronOutput)) !== JSON.stringify([...inventory.archiveFiles].sort())) {
      throw new Error('已解包 Electron 运行文件与清单不符。');
    }

    for (const filename of ['node.exe', 'LICENSE']) {
      await copyRegular(path.join(nodeScratch, nodeDirectory, filename), path.join(bundle, 'runtime', 'node', filename));
    }
    for (const [source, target] of [...reviewFiles, ...serviceFiles.map(file => [file, file])]) {
      await copyRegular(path.join(checkout, source), path.join(bundle, target));
    }
    for (const [filename, command] of launches) {
      await writeFile(path.join(bundle, filename), commandFile(command), { flag: 'wx' });
    }
    await writeFile(path.join(bundle, 'owner-review-runtime.json'), previewConfiguration.OWNER_REVIEW_RUNTIME_MARKER, { flag: 'wx' });

    const files = {};
    for (const file of await listFiles(bundle)) files[file] = await fileFacts(path.join(bundle, file));
    const manifest = {
      schemaVersion: 1, kind: 'shenyi-owner-review-windows-x64', version: inventory.appPackage.version, syntheticOnly: true,
      runtime: {
        node: { version: nodeVersion, archiveSha256: nodeFacts.sha256 },
        electron: { version: inventory.electronVersion, archiveSha256: electron.sha256 },
      },
      files,
    };
    const manifestName = 'owner-review-manifest.json';
    await writeFile(path.join(bundle, manifestName), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    if (!samePath(working, path.dirname(await realpath(nodeScratch))) || !samePath(nodeScratch, await realpath(nodeScratch))) {
      throw new Error('解包临时目录位置发生变化。');
    }
    await rm(nodeScratch, { recursive: true });
    await publishDirectory(bundle, destination, working);
    await rmdir(working).catch(() => {});
    return { output: destination, manifest: path.join(destination, manifestName), files: Object.keys(files).length };
  } catch (error) {
    throw new Error(error.message + ' 构建临时目录保留于 ' + working);
  }
}

function parse(args) {
  const required = new Map([['--node-archive', 'nodeArchive'], ['--electron-archive', 'electronArchive'], ['--npm-cache', 'npmCache'], ['--output', 'output']]);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = required.get(args[index]);
    const value = args[index + 1];
    if (!name || Object.hasOwn(options, name) || !value || value.startsWith('--')) throw new Error('便携评审包构建参数无效。');
    options[name] = value;
  }
  if (Object.keys(options).length !== required.size) throw new Error('请提供 Node ZIP、Electron ZIP、离线 npm 缓存和输出目录。');
  return options;
}

if (process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  Promise.resolve().then(() => build(parse(process.argv.slice(2)))).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
