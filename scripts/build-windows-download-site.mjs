#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { publicFiles } from './website-preview.mjs';
import { checkWindowsReleaseMsi } from './check-windows-release-msi.mjs';
import { verifyWindowsCustomerInstaller } from './windows-candidate-authenticode.mjs';
import { buildWebsiteBaseline, customerDownload, windowsDownload } from './check-website-release.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const mandatory = ['filingNumber', 'msi', 'sha256', 'publisherSha256', 'publicKey', 'version', 'installedVersion', 'appPayloadSha256'];
const customerFields = ['filingNumber', 'customerExe', 'sha256', 'publisherSha256', 'version'];
const run = promisify(execFile);
const filingPattern = /^沪ICP备[0-9]{6,12}号-[1-9][0-9]{0,5}$/;
const flags = ['--output', '--release-input', '--filing-number', '--source-commit'];

function replaceOnce(text, marker, replacement) {
  if (!text.includes(marker) || text.indexOf(marker) !== text.lastIndexOf(marker)) {
    throw new Error('官网模板缺少唯一的发布标记 ' + marker);
  }
  return text.replace(marker, () => replacement);
}

function replaceSection(text, name, fragment) {
  const start = '<!-- ' + name + ' -->';
  const end = '<!-- /' + name + ' -->';
  for (const marker of [start, end]) replaceOnce(text, marker, marker);
  const first = text.indexOf(start);
  const last = text.indexOf(end);
  if (last <= first) throw new Error('官网发布区域顺序有误。');
  return text.slice(0, first) + fragment + text.slice(last + end.length);
}

function downloadType(input) {
  const customer = Boolean(input && Object.hasOwn(input, 'customerExe'));
  const required = customer ? customerFields : mandatory;
  const allowed = customer ? required : [...required, 'scratchRoot'];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !required.every(key => typeof input[key] === 'string' && input[key].length) ||
      !Object.keys(input).every(key => allowed.includes(key)) || !filingPattern.test(input.filingNumber) ||
      !(customer ? path.isAbsolute(input.customerExe) : path.isAbsolute(input.msi) && path.isAbsolute(input.publicKey)) ||
      (input.scratchRoot !== undefined && (typeof input.scratchRoot !== 'string' || !path.isAbsolute(input.scratchRoot)))) {
    throw new Error('请提供经核对的上海网站备案号及对应安装程序的独立发行参数。');
  }
  return customer ? customerDownload : windowsDownload;
}

function releasePage(template, receipt, download) {
  const details = download === customerDownload ? [
    '<p class="platform-status">Windows · v' + receipt.version + '</p>',
    '<a class="button primary" href="' + download.route + '" download>下载 Windows 客户端</a>',
    '<p>EXE · ' + (receipt.bytes / (1024 * 1024)).toFixed(1) + ' MiB</p>',
  ] : [
    '<p class="platform-status">Windows x64 · v' + receipt.version + '</p>',
    '<p>面向普通客户的一键安装包待发布。</p>',
    '<a class="button primary" href="' + windowsDownload.route + '" download>管理员下载受管部署包</a>',
    '<p>MSI · ' + (receipt.bytes / (1024 * 1024)).toFixed(1) + ' MiB。团队管理员需另行配置并激活客户端。</p>',
  ];
  details.push('<p>SHA-256 <code class="release-digest">' + receipt.sha256 + '</code></p>');
  return replaceSection(template, 'windows-release', details.join('\n'));
}

function releaseNginx(template, download) {
  const route = download.route;
  const matcher = '    ~^' + route.replace('.', '[.]') + '([?]|$) 1;';
  const location = '    location = ' + route + ' { default_type application/octet-stream; try_files ' + route + ' =404; }';
  return replaceOnce(replaceOnce(template, '    # windows-download-route', matcher), '    # windows-download-location', location);
}

export async function buildWindowsDownloadSite({ output, sourceCommit, input, filingNumber: filingOnly }, {root = repository} = {}) {
  const download = input === undefined ? undefined : downloadType(input);
  if (input !== undefined) {
    if (filingOnly !== undefined) throw new Error('请选择一种官网构建模式。');
  } else if (typeof filingOnly !== 'string' || !filingPattern.test(filingOnly)) {
    throw new Error('请填写管局核准的上海网站备案号。');
  }
  if (!path.isAbsolute(output) || !/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('输出须为绝对路径，并须提供门户的 40 位 Git 提交。');
  const parent = await realpath(path.dirname(path.resolve(output)));
  const destination = path.join(parent, path.basename(path.resolve(output)));
  const project = await realpath(root);
  const relative = path.relative(project, destination);
  if (!relative || (!path.isAbsolute(relative) && !relative.startsWith('..' + path.sep) && relative !== '..')) {
    throw new Error('请选择仓库外的全新发布目录。');
  }
  try {
    await lstat(destination);
    throw new Error('发布目录已存在。');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const gitOptions = { cwd: project, windowsHide: true, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 };
  if ((await run('git', ['cat-file', '-t', sourceCommit], gitOptions)).stdout.toString().trim() !== 'commit') {
    throw new Error('门户来源必须是可读取的 Git 提交。');
  }
  const readSource = async file => (await run('git', ['cat-file', 'blob', sourceCommit + ':' + file], gitOptions)).stdout;
  const { filingNumber, ...approved } = input ?? { filingNumber: filingOnly };
  // Always verify the installer itself. A saved receipt is not a release input.
  const verify = download === customerDownload ? verifyWindowsCustomerInstaller : checkWindowsReleaseMsi;
  const receipt = download && await verify(approved);
  const stage = await mkdtemp(path.join(parent, '.shenyi-portal-'));
  const stagingId = await lstat(stage, {bigint:true});
  try {
    const site = path.join(stage, 'site');
    await mkdir(path.join(site, 'assets'), {recursive: true});
    for (const file of publicFiles) {
      await writeFile(path.join(site, file.name), await readSource(file.source), {flag: 'wx'});
    }
    const homepage = path.join(site, 'index.html');
    let html = await readFile(homepage, 'utf8');
    if (receipt) {
      const downloadFile = path.join(site, download.file);
      await mkdir(path.dirname(downloadFile));
      await copyFile(approved.customerExe ?? approved.msi, downloadFile, constants.COPYFILE_EXCL);
      html = releasePage(html, receipt, download);
    }
    html = replaceSection(html, 'filing', '<a href="https://beian.miit.gov.cn/" rel="noreferrer">' + filingNumber + '</a>');
    await writeFile(homepage, html);
    // Hash the served copy, not merely the input previously checked on Windows.
    const manifest = await buildWebsiteBaseline(site, sourceCommit, receipt, download);
    const baseline = JSON.stringify(manifest, null, 2) + '\n';
    const config = (await readSource('deploy/linux/nginx-shenyi-website.conf')).toString('utf8');
    await writeFile(path.join(stage, 'nginx-shenyi-website.conf'), receipt ? releaseNginx(config, download) : config, { flag: 'wx' });
    await writeFile(path.join(stage, 'baseline.json'), baseline, { flag: 'wx' });
    // Reserve the requested name exclusively (POSIX rename can replace an
    // existing empty directory). Make the verified HTTP root visible last.
    await mkdir(destination, {mode:0o700});
    const moved = [];
    try {
      for (const name of ['baseline.json', 'nginx-shenyi-website.conf']) {
        const target = path.join(destination, name);
        await rename(path.join(stage, name), target);
        moved.push(target);
      }
      await rename(site, path.join(destination, 'site'));
    } catch (error) {
      for (const file of moved) await unlink(file);
      await rmdir(destination);
      throw error;
    }
    return { site: path.join(destination, 'site'), version: receipt?.version, sha256: receipt?.sha256,
      baselineSha256: createHash('sha256').update(baseline).digest('hex') };
  } finally {
    const current = await lstat(stage, {bigint:true});
    if (stagingId.dev === current.dev && stagingId.ino === current.ino &&
        path.relative(stage, await realpath(stage)) === '' && path.dirname(stage) === parent) {
      await rm(stage, { recursive: true });
    }
  }
}

async function main(args) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!flags.includes(args[i]) || !args[i + 1] || options.has(args[i])) throw new Error('发行参数有误。');
    options.set(args[i], args[i + 1]);
  }
  if (options.size !== 3 || !options.has('--output') || !options.has('--source-commit')) {
    throw new Error('用法：--output 新目录 --source-commit 门户提交，加 --filing-number 备案号 或 --release-input 参数.json');
  }
  const input = options.has('--release-input')
    ? JSON.parse((await readFile(options.get('--release-input'), 'utf8')).replace(/^\uFEFF/, '')) : undefined;
  const result = await buildWindowsDownloadSite({ input, output: options.get('--output'),
    filingNumber: options.get('--filing-number'), sourceCommit: options.get('--source-commit') });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
