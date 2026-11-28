import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { publishWindowsCandidateDirectory, resolveBuildOutput, resolveSystemPowerShell, verifyElectronArchive } from '../../scripts/build-windows-desktop-candidate.mjs';

const run = promisify(execFile);
const shell = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(shell, '../..');
const version = '45.3.2';
// From electron@45.3.2/checksums.json, for electron-v45.3.2-win32-x64.zip.
const expectedHash = 'cd1ab0d49c2f76838c0c9ff75afefb4d9d85ca59036691932bf35be8eceba98b';
const [archive, output, ...others] = process.argv.slice(2);
if (process.platform !== 'win32' || !archive || !output || others.length) {
  throw Error('用法：node desktop/windows/build.mjs <官方 Electron Windows x64 ZIP> <仓库外新目录>');
}
const locked = JSON.parse(await readFile(path.join(root, 'desktop/package-lock.json'), 'utf8'));
if (locked.packages['node_modules/electron'].version !== version) throw Error('请先复核新版 Electron 运行时及官方校验值。');
const target = await resolveBuildOutput(output, root);
const staging = await mkdtemp(path.join(path.dirname(target), '.shenyi-local-workbench-'));
try {
  const packaged = path.join(staging, 'portable');
  const archiveCopy = path.join(staging, 'electron.zip');
  await copyFile(archive, archiveCopy);
  await verifyElectronArchive(archiveCopy, expectedHash);
  const tar = path.join((await resolveSystemPowerShell()).systemDirectory, 'tar.exe');
  const git = (args) => run('git', ['-C', root, ...args], {windowsHide: true});
  const commit = (await git(['rev-parse','HEAD'])).stdout.trim();
  const trackedDist = path.join(staging, 'dist.tar');
  await git(['archive','--format=tar','--output=' + trackedDist,commit,'dist']);
  await mkdir(packaged);
  await run(tar, ['-xf', archiveCopy, '-C', packaged], {windowsHide: true});
  if ((await readFile(path.join(packaged,'version'), 'utf8')).trim() !== version) throw Error('Electron 运行时版本不匹配。');
  const appRoot = path.join(packaged, 'resources/app');
  await mkdir(appRoot);
  await run(tar, ['-xf',trackedDist,'-C',appRoot], {windowsHide: true});
  for (const name of ['main.cjs','package.json']) await copyFile(path.join(shell,name), path.join(appRoot,name));
  await copyFile(path.join(shell,'README.md'), path.join(packaged,'使用说明.txt'));
  await writeFile(path.join(packaged,'version-info.txt'), 'Windows x64 local review\r\nBusiness source: ' + commit + '\r\nElectron: ' + version + '\r\n');
  await unlink(path.join(packaged,'resources/default_app.asar'));
  await rename(path.join(packaged,'electron.exe'), path.join(packaged,'ShenyiWorkbench.exe'));
  await rename(path.join(packaged,'electron_wer.dll'), path.join(packaged,'ShenyiWorkbench_wer.dll'));
  await publishWindowsCandidateDirectory(packaged, target, staging);
  console.log(JSON.stringify({directory:target, sourceCommit:commit, electron:version, archiveSha256:expectedHash}));
} finally {
  await rm(staging, {recursive:true,force:true});
}
