#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, open, readdir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const architectures = new Map([['arm64', 0x0100000c], ['x64', 0x01000007]]);
const options = new Map([
  ['--app', 'app'], ['--team-id', 'teamId'], ['--bundle-id', 'bundleId'],
  ['--version', 'version'], ['--arch', 'arch'],
]);
const codesign = '/usr/bin/codesign';
const spctl = '/usr/sbin/spctl';
const candidateId = 'invalid.shenyi.audit.candidate';

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function invalidArguments() {
  fail('INVALID_ARGUMENTS', '请指定绝对 .app 路径、发行 Team ID、正式 Bundle ID、三段版本号及 arm64 或 x64。');
}

function validate({ app, teamId, bundleId, version, arch }) {
  if (!path.isAbsolute(app ?? '') || path.extname(app) !== '.app' || /[\u0000-\u001f\u007f]/.test(app) ||
      !/^[A-Z0-9]{10}$/.test(teamId ?? '') || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleId ?? '') ||
      bundleId.length > 255 || bundleId.toLowerCase() === candidateId ||
      !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version ?? '') ||
      !version.split('.').every(part => Number.isSafeInteger(Number(part))) || !architectures.has(arch)) invalidArguments();
}

function parse(args) {
  const input = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = options.get(args[index]);
    const value = args[index + 1];
    if (!key || Object.hasOwn(input, key) || !value || value.startsWith('--')) invalidArguments();
    input[key] = value;
  }
  return input;
}

async function systemCommand(program, args) {
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C', LANG: 'C' };
  if (process.env.HOME) env.HOME = process.env.HOME;
  return exec(program, args, { env, encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 });
}

async function native(run, code, program, args) {
  try {
    const { stdout, stderr } = await run(program, args);
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
  } catch {
    fail(code, '原生命令未通过，请在验收 Mac 上核对该步骤的系统诊断。');
  }
}

async function appPaths(requested) {
  const app = path.resolve(requested);
  if (!(await lstat(app)).isDirectory()) fail('APP_PATH_INVALID', '请选择实际的应用目录。');
  const canonical = await realpath(app);
  const info = path.join(canonical, 'Contents', 'Info.plist');
  const main = path.join(canonical, 'Contents', 'MacOS', 'Shenyi');
  for (const filename of [info, main]) {
    if (!(await lstat(filename)).isFile() || await realpath(filename) !== filename) {
      fail('APP_PATH_INVALID', '应用的 Info.plist 和主程序须为包内普通文件。');
    }
  }
  await access(main, constants.X_OK);
  return { app: canonical, info, main };
}

function identity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join('/');
}

export function checkLinks(nodes, links) {
  const invalidLink = () => fail('APP_LINK_INVALID', '应用树包含绝对、越界、悬空或循环符号链接。');
  for (const [source, target] of links) {
    const position = source.split('/').slice(0, -1);
    const pending = target.split('/').reverse();
    let followed = 0;
    while (pending.length) {
      const component = pending.pop();
      if (!component || component === '.') continue;
      if (component === '..') {
        if (position.length === 0) invalidLink();
        position.pop();
        continue;
      }
      position.push(component);
      const key = position.join('/');
      const kind = nodes.get(key);
      if (!kind || (kind === 'file' && pending.length)) invalidLink();
      if (kind === 'link') {
        // Bound traversal of repeated references before native tools consult the bundle.
        if (++followed > 32) invalidLink();
        position.pop();
        pending.push(...links.get(key).split('/').reverse());
      }
    }
  }
}

async function fingerprint(app) {
  const tree = createHash('sha256');
  const nodes = new Map();
  const links = new Map();
  async function visit(relative) {
    const filename = path.join(app, relative);
    const before = await lstat(filename, { bigint: true });
    const metadata = [relative, Number(before.mode & 0o7777n)];
    if (before.isDirectory()) {
      nodes.set(relative, 'directory');
      tree.update(JSON.stringify([...metadata, 'directory']) + '\n');
      for (const name of (await readdir(filename)).sort()) await visit(relative ? relative + '/' + name : name);
    } else if (before.isSymbolicLink()) {
      const target = await readlink(filename);
      if (!target || path.posix.isAbsolute(target) || /^[A-Za-z]:|\\/.test(target)) {
        fail('APP_LINK_INVALID', '应用内符号链接须使用相对路径。');
      }
      nodes.set(relative, 'link');
      links.set(relative, target);
      tree.update(JSON.stringify([...metadata, 'link', target]) + '\n');
    } else if (before.isFile()) {
      nodes.set(relative, 'file');
      const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        if (identity(await handle.stat({ bigint: true })) !== identity(before)) {
          fail('APP_CHANGED_DURING_CHECK', '读取应用树时文件发生变化。');
        }
        const hash = createHash('sha256');
        for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        tree.update(JSON.stringify([...metadata, 'file', before.size.toString(), hash.digest('hex')]) + '\n');
      } finally { await handle.close(); }
    } else {
      fail('APP_PATH_INVALID', '应用树包含无法核验的特殊文件。');
    }
    if (identity(await lstat(filename, { bigint: true })) !== identity(before)) {
      fail('APP_CHANGED_DURING_CHECK', '读取应用树时目录项发生变化。');
    }
  }
  await visit('');
  checkLinks(nodes, links);
  return tree.digest('hex');
}

async function checkArchitecture(main, arch) {
  const file = await open(main, 'r');
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    // The two Shenyi release artifacts each have a single 64-bit executable slice.
    if (bytesRead !== header.length || header.readUInt32LE(0) !== 0xfeedfacf ||
        header.readUInt32LE(4) !== architectures.get(arch) || header.readUInt32LE(12) !== 2) {
      fail('APP_ARCH_MISMATCH', '应用主程序的 Mach-O 架构与指定发行架构不符。');
    }
  } finally { await file.close(); }
}

function signatureDetails(output, expected) {
  function field(name) {
    const lines = output.split(/\r?\n/).filter(line => line.startsWith(name + '='));
    return lines.length === 1 ? lines[0].slice(name.length + 1).trim() : '';
  }
  const flags = output.match(/^CodeDirectory[^\r\n]*\bflags=0x([0-9a-f]+)\b/im);
  const cdHash = field('CDHash');
  const timestamp = field('Timestamp');
  if (field('Identifier') !== expected.bundleId || field('TeamIdentifier') !== expected.teamId ||
      !/^[0-9a-f]{40}$/.test(cdHash) || !timestamp || !flags || (BigInt('0x' + flags[1]) & 0x10000n) === 0n) {
    fail('SIGNING_METADATA_INVALID', '签名身份、Hardened Runtime、可信时间戳或 CodeDirectory 摘要未通过核对。');
  }
  return { cdHash, timestamp };
}

export async function checkMacosReleaseApp(expected, { platform = process.platform, run = systemCommand } = {}) {
  if (platform !== 'darwin') fail('MACOS_REQUIRED', '此发行核验须在真实 macOS 上运行。');
  validate(expected);
  const paths = await appPaths(expected.app).catch(error => {
    if (error.code === 'APP_PATH_INVALID') throw error;
    fail('APP_PATH_INVALID', '无法读取应用目录、Info.plist 或主程序。');
  });
  const originalIdentity = identity(await lstat(paths.app, { bigint: true }));
  const { app, info, main } = paths;
  const appTreeSha256 = await fingerprint(app);
  const plist = async key => (await native(run, 'PLIST_INVALID', '/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', info])).stdout.trim();
  if (await plist('CFBundleIdentifier') !== expected.bundleId ||
      await plist('CFBundleShortVersionString') !== expected.version || await plist('CFBundleVersion') !== expected.version ||
      await plist('CFBundleExecutable') !== 'Shenyi') {
    fail('APP_METADATA_MISMATCH', '应用 Bundle ID、版本或可执行文件名不匹配。');
  }
  await checkArchitecture(main, expected.arch);

  const deepVerify = ['--verify', '--deep', '--strict', '--all-architectures', app];
  await native(run, 'CODE_SIGNATURE_INVALID', codesign, deepVerify);
  // Apply the product identifier requirement to the outer bundle only; helpers have their own identifiers.
  const requirement = [
    'anchor apple generic',
    'certificate 1[field.1.2.840.113635.100.6.2.6] exists',
    'certificate leaf[field.1.2.840.113635.100.6.1.13] exists',
    'certificate leaf[subject.OU] = "' + expected.teamId + '"',
    'identifier "' + expected.bundleId + '"',
  ].join(' and ');
  await native(run, 'DEVELOPER_ID_MISMATCH', codesign, ['--verify', '--strict', '-R', '=' + requirement, app]);
  const display = async () => {
    const result = await native(run, 'SIGNING_METADATA_INVALID', codesign, ['--display', '--verbose=4', app]);
    return signatureDetails(result.stdout + '\n' + result.stderr, expected);
  };
  const signature = await display();

  const osVersion = (await native(run, 'MACOS_VERSION_UNKNOWN', '/usr/bin/sw_vers', ['-productVersion'])).stdout.trim();
  const major = Number(/^(\d+)\.\d+(?:\.\d+)?$/.exec(osVersion)?.[1]);
  if (!Number.isSafeInteger(major) || major < 13) fail('MACOS_VERSION_UNKNOWN', '请使用受支持的 macOS 13 或更新版本验收。');
  const policy = await native(run, 'GATEKEEPER_STATUS_UNKNOWN', spctl, ['--status']);
  if ((policy.stdout + '\n' + policy.stderr).trim() !== 'assessments enabled') {
    fail('GATEKEEPER_NOT_ENABLED', '该验收机未确认启用 Gatekeeper 评估。');
  }
  const assessment = major >= 14 ? 'syspolicy_check' : 'spctl';
  const assessmentCommand = major >= 14 ?
    ['/usr/bin/syspolicy_check', ['distribution', app]] :
    [spctl, ['--assess', '--type', 'execute', '--verbose=2', app]];
  const verdict = await native(run, 'DISTRIBUTION_POLICY_REJECTED', ...assessmentCommand);
  const assessmentOutput = (verdict.stdout + '\n' + verdict.stderr).split(/\r?\n/).map(line => line.trim());
  const accepted = major >= 14 ?
    assessmentOutput.includes('App passed all pre-distribution checks and is ready for distribution.') :
    assessmentOutput.includes(app + ': accepted');
  if (!accepted) fail('DISTRIBUTION_POLICY_UNKNOWN', '系统未明确确认该应用通过发行评估。');
  await native(run, 'STAPLED_TICKET_INVALID', '/usr/bin/xcrun', ['stapler', 'validate', app]);

  // Recheck the same bundle after the external assessments.
  await native(run, 'CODE_SIGNATURE_INVALID', codesign, deepVerify);
  const verified = await display();
  const finalPaths = await appPaths(expected.app);
  const finalIdentity = identity(await lstat(finalPaths.app, { bigint: true }));
  if (verified.cdHash !== signature.cdHash || signature.timestamp !== verified.timestamp ||
      paths.app !== finalPaths.app || originalIdentity !== finalIdentity || await fingerprint(app) !== appTreeSha256) {
    fail('APP_CHANGED_DURING_CHECK', '核验期间应用或签名发生变化，请在稳定的独立目录复验。');
  }
  return {
    schemaVersion: 1, kind: 'shenyi-macos-native-release-app-check', app, osVersion, hostProcessArch: process.arch, assessment,
    teamId: expected.teamId, bundleId: expected.bundleId, version: expected.version, mainExecutableArch: expected.arch,
    ...signature, appTreeSha256, archiveVerified: false, appLaunched: false, checkedAt: new Date().toISOString(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => checkMacosReleaseApp(parse(process.argv.slice(2))))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(JSON.stringify({ code: error.code ?? 'MACOS_RELEASE_CHECK_FAILED', message: error.message }));
      process.exitCode = 1;
    });
}
