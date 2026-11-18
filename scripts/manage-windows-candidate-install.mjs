#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyWindowsCandidate, inspectWindowsInstallation, resolveWindowsLaunch, rollbackWindowsInstallation } from './windows-candidate-install-core.mjs';

const operations = new Map([
  ['apply', { action: applyWindowsCandidate, fields: { '--root': 'root', '--bundle': 'bundle', '--signature': 'signature', '--public-key': 'publicKey' } }],
  ['inspect', { action: inspectWindowsInstallation, fields: { '--root': 'root', '--public-key': 'publicKey' } }],
  ['resolve-launch', { action: resolveWindowsLaunch, fields: { '--root': 'root', '--public-key': 'publicKey' } }],
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
};

function invalidArguments() {
  throw Object.assign(new Error(messages.INVALID_ARGUMENTS), { code: 'INVALID_ARGUMENTS' });
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
