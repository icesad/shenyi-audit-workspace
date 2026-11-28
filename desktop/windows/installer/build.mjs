import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveBuildOutput, resolveSystemPowerShell } from '../../../scripts/build-windows-desktop-candidate.mjs';

const run = promisify(execFile);
const installer = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(installer, '../../..');
const compilerSha256 = 'ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8';
const [electronZip, nsisZip, output, ...extra] = process.argv.slice(2);
if (process.platform !== 'win32' || !electronZip || !nsisZip || !output || extra.length ||
    !path.isAbsolute(output) || path.extname(output).toLowerCase() !== '.exe') {
  throw Error('用法 node desktop/windows/installer/build.mjs <Electron x64 ZIP> <NSIS 3.13 ZIP> <仓库外的新 Setup.exe 绝对路径>');
}

async function fileDigest(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

async function inventory(directory, relative = '') {
  const files = [];
  for (const entry of await readdir(path.join(directory, relative), {withFileTypes: true})) {
    if (/[$!"\r\n]/.test(entry.name)) throw Error('载荷文件名不适用于 NSIS。');
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await inventory(directory, name));
    else if (entry.isFile()) files.push(name);
    else throw Error('载荷包含特殊文件。');
  }
  return files.sort();
}

const destination = await resolveBuildOutput(output, workspace);
const staging = await mkdtemp(path.join(path.dirname(destination), '.shenyi-preview-setup-'));
try {
  if (/[$!"\r\n]/.test(staging)) throw Error('请使用普通的本地构建目录。');
  const compilerArchive = path.join(staging, 'compiler.zip');
  await copyFile(nsisZip, compilerArchive);
  if (await fileDigest(compilerArchive) !== compilerSha256) throw Error('NSIS 归档与官方 SHA-256 不符。');
  const tar = path.join((await resolveSystemPowerShell()).systemDirectory, 'tar.exe');
  await run(tar, ['-xf', compilerArchive, '-C', staging], {windowsHide: true});

  const payload = path.join(staging, 'workbench');
  await run(process.execPath, [path.join(installer, '../build.mjs'), electronZip, payload], {windowsHide: true});
  const {version} = JSON.parse(await readFile(path.join(payload, 'resources/app/package.json'), 'utf8'));
  if (!/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2}$/.test(version) ||
      version.split('.').some(n => Number(n) > 65535)) throw Error('安装版本必须由三个有效的 Windows 版本号组成。');

  const files = await inventory(payload);
  const dirs = new Set();
  const identity = createHash('sha256');
  for (const name of files) {
    identity.update(name + '\0' + await fileDigest(path.join(payload, name)) + '\n');
    for (let d = path.posix.dirname(name); d !== '.'; d = path.posix.dirname(d)) dirs.add(d);
  }
  const buildId = version + '-' + identity.digest('hex').slice(0, 16);
  // Remove only files delivered by this candidate. Unknown files prevent removal of their parent directory.
  const deletePaths = [
    ...files.filter(n => n !== 'ShenyiWorkbench.exe').map(n => {
      const target = '"$INSTDIR\\' + n.replaceAll('/', '\\') + '"';
      return ['IfFileExists ' + target + ' 0 +4', 'ClearErrors', 'Delete ' + target, 'IfErrors busy'].join('\r\n');
    }),
    ...[...dirs].sort((a, b) => b.length - a.length).map(n => 'RMDir "$INSTDIR\\' + n.replaceAll('/', '\\') + '"')
  ];
  const include = path.join(staging, 'remove-payload.nsh');
  await writeFile(include, '\ufeff' + deletePaths.join('\r\n') + '\r\n', {flag:'wx'});
  const compiled = path.join(staging, 'preview-setup.exe');
  const compiler = path.join(staging, 'nsis-3.13/makensis.exe');
  const options = ['/NOCONFIG','/INPUTCHARSET','UTF8','/V2','/DPAYLOAD=' + payload,'/DOUTPUT=' + compiled,
    '/DREMOVE_PAYLOAD=' + include,'/DBUILD_ID=' + buildId,'/DAPP_VERSION=' + version, path.join(installer,'setup.nsi')];
  try {
    await run(compiler, options, {cwd:staging, windowsHide:true});
  } catch (error) {
    throw Error('NSIS 编译失败。' + (error.stderr || error.stdout || error.message), {cause:error});
  }
  const sha256 = await fileDigest(compiled);
  await copyFile(compiled, destination, constants.COPYFILE_EXCL);
  console.log(JSON.stringify({output:destination,buildId,version,files:files.length,sha256,kind:'internal-windows-workbench-setup'}));
} finally {
  if (path.dirname(staging) !== path.dirname(destination) || !path.basename(staging).startsWith('.shenyi-preview-setup-')) {
    throw Error('构建临时目录超出范围。');
  }
  await rm(staging, {recursive:true,force:true,maxRetries:3,retryDelay:100});
}
