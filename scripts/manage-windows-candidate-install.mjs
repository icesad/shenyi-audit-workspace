#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import teamService from '../desktop/team-service-config.cjs';
import { applyWindowsCandidate, inspectWindowsInstallation, resolveWindowsLaunch, rollbackWindowsInstallation } from './windows-candidate-install-core.mjs';

const operations = new Map([
  ['apply', { action: applyWindowsCandidate, fields: { '--root': 'root', '--bundle': 'bundle', '--signature': 'signature', '--public-key': 'publicKey' } }],
  ['inspect', { action: inspectWindowsInstallation, fields: { '--root': 'root', '--public-key': 'publicKey' } }],
  ['resolve-launch', { action: resolveWindowsLaunch, fields: { '--root': 'root', '--public-key': 'publicKey' } }],
  ['launch', { action: launchWindowsCandidate, fields: { '--root': 'root', '--public-key': 'publicKey', '--service-config': 'serviceConfig' } }],
  ['rollback', { action: rollbackWindowsInstallation, fields: { '--root': 'root', '--public-key': 'publicKey' } }],
]);

const messages = {
  INVALID_ARGUMENTS: '请提供完整的安装、核验、启动定位或回滚参数。',
  INSTALL_ROOT_INVALID: '安装目录必须是仓库和候选包之外的专用本地目录。',
  INSTALL_STATE_INVALID: '无法确认安装状态或已授权的版本。',
  INSTALL_BUSY: '安装目录正在执行其他操作，或上次操作需要检查。',
  INSTALL_PUBLISH_FAILED: '安装或回滚未能完成，请检查本机安装状态。',
  ROLLBACK_UNAVAILABLE: '当前没有可回滚的上一版。',
  CANDIDATE_MANIFEST_INVALID: 'Windows 候选清单不符合约定。',
  CANDIDATE_INVENTORY_INVALID: 'Windows 候选文件与清单不一致。',
  CANDIDATE_SIGNATURE_INVALID: '候选发布签名缺失、无效或与受信公钥不符。',
  CANDIDATE_VERSION_INVALID: '候选版本号无效。',
  CANDIDATE_VERSION_NOT_NEWER: '新候选版本必须高于此目录已经接受的最高版本。',
  VERIFICATION_KEY_INVALID: '无法使用独立配置的 Ed25519 公钥文件。',
  INSTALL_KEY_MISMATCH: '配置的公钥与该安装目录已经接受的公钥不符。',
  TEAM_SERVICE_CONFIGURATION_INVALID: '团队服务配置无效，请联系管理员核对。',
  WINDOWS_LAUNCH_UNAVAILABLE: '请在 Windows 中启动已安装的审易。',
  WINDOWS_LAUNCH_FAILED: '系统未能启动已验签的审易程序。',
};

function invalidArguments() {
  throw Object.assign(new Error(messages.INVALID_ARGUMENTS), { code: 'INVALID_ARGUMENTS' });
}

async function launchWindowsCandidate({ root, publicKey, serviceConfig }) {
  if (process.platform !== 'win32') throw Object.assign(new Error(messages.WINDOWS_LAUNCH_UNAVAILABLE), { code: 'WINDOWS_LAUNCH_UNAVAILABLE' });
  const invalidConfig = () => { throw Object.assign(new Error(messages.TEAM_SERVICE_CONFIGURATION_INVALID), { code: 'TEAM_SERVICE_CONFIGURATION_INVALID' }); };
  if (!/^[a-z]:[\\/]/i.test(serviceConfig) || /[\x00-\x1f\x7f:]/.test(serviceConfig.slice(2))) invalidConfig();
  const configPath = await realpath(serviceConfig).catch(invalidConfig);
  const configFromInstall = path.relative(root, configPath);
  if (path.relative(serviceConfig, configPath) !== '' || (!path.isAbsolute(configFromInstall) &&
      configFromInstall !== '..' && !configFromInstall.startsWith('..' + path.sep))) invalidConfig();
  const inheritedTlsMode = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (inheritedTlsMode !== undefined && inheritedTlsMode !== '1') invalidConfig();
  const wechatVariables = new Set(['SHENYI_WECHAT_APP_ID', 'SHENYI_WECHAT_REDIRECT_URI']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^(?:ELECTRON_|NODE_|SHENYI_|OPENSSL_|SSL_CERT_(?:FILE|DIR)$|(?:HTTPS?|ALL|NO|GLOBAL_AGENT_HTTP)_PROXY$)/i.test(name) ||
    wechatVariables.has(name.toUpperCase())));
  env.SHENYI_TEAM_SERVICE_CONFIG = configPath;
  const { profile } = await teamService.loadTeamServiceConfiguration({ env, isPackaged: true });
  // Synthetic managed HTTPS rehearsals use a child-local CA on IPv4 loopback.
  if (new URL(profile.apiBase).hostname === '127.0.0.1' && /^[a-z]:[\\/]/i.test(process.env.NODE_EXTRA_CA_CERTS ?? '')) {
    env.NODE_EXTRA_CA_CERTS = process.env.NODE_EXTRA_CA_CERTS;
  }
  const verified = await resolveWindowsLaunch({ root, publicKey });
  const pid = await new Promise((resolve, reject) => {
    const failed = () => reject(Object.assign(new Error(messages.WINDOWS_LAUNCH_FAILED), { code: 'WINDOWS_LAUNCH_FAILED' }));
    try {
      const child = spawn(verified.executablePath, [], { cwd: path.dirname(verified.executablePath), env, detached: true, stdio: 'ignore', shell: false });
      child.once('error', failed);
      child.once('spawn', () => {
        child.unref();
        resolve(child.pid);
      });
    } catch { failed(); }
  });
  return { ...verified, pid };
}

export async function runWindowsCandidateInstall(args) {
  const [command, ...rest] = args;
  const operation = operations.get(command);
  if (!operation || rest.length !== Object.keys(operation.fields).length * 2) invalidArguments();
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const [flag, value] = rest.slice(index, index + 2);
    if (!Object.hasOwn(operation.fields, flag) || typeof value !== 'string' || !value || value.startsWith('--')) invalidArguments();
    const field = operation.fields[flag];
    if (Object.hasOwn(options, field)) invalidArguments();
    options[field] = value;
  }
  const result = await operation.action(options);
  return { ok: true, ...result, operation: command };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWindowsCandidateInstall(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    const code = Object.hasOwn(messages, error.code) ? error.code : 'INSTALL_PUBLISH_FAILED';
    console.error(JSON.stringify({ ok: false, code, message: messages[code] }));
    process.exitCode = 1;
  });
}
