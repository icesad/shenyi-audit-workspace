#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {mkdir, open, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import configuration from '../desktop/isolated-preview-config.cjs';
import {createOwnerReviewManagedPilot} from './owner-review-managed-pilot-service.mjs';
import {candidateChildEnvironment} from './team-isolated-preview.mjs';
import {stageOwnerReviewElectronRuntime} from './owner-review-electron-runtime.mjs';

const {loadOwnerReviewRuntime} = configuration;

async function desktopEnvironment(run) {
  const env = candidateChildEnvironment({context: run});
  delete env.SHENYI_ISOLATED_PREVIEW_CONFIG;
  // Replace these case-insensitively. Windows treats the inherited names as aliases.
  const owned = {
    LOCALAPPDATA: path.join(run.directory, 'local-app-data'),
    APPDATA: path.join(run.directory, 'roaming-app-data'),
    TEMP: path.join(run.directory, 'temp'),
  };
  for (const name of Object.keys(env)) {
    if (Object.hasOwn(owned, name.toUpperCase()) || ['TMP', 'TMPDIR'].includes(name.toUpperCase())) delete env[name];
  }
  await Promise.all(Object.values(owned).map(directory => mkdir(directory, {mode: 0o700})));
  return {...env, ...owned, TMP: owned.TEMP, TMPDIR: owned.TEMP,
    SHENYI_OWNER_REVIEW_MANAGED_PILOT: '1', SHENYI_TEAM_SERVICE_CONFIG: run.configFile, NODE_EXTRA_CA_CERTS: run.caFile};
}

async function launch() {
  const portable = await loadOwnerReviewRuntime();
  if (!portable) throw new Error('请在完整的 Windows 双人评审包内双击受管试点演练入口。');
  const run = await createOwnerReviewManagedPilot({onVerificationCode({purpose, phone, code}) {
    const label = purpose === 'first-admin' ? '首管理员激活' : '受邀员工激活';
    console.log('本轮验证码 '+phone+' '+label+' '+code);
  }});
  let log, desktop, exited, runtime;
  const stop = () => {
    if (desktop && desktop.exitCode === null && desktop.signalCode === null && !desktop.killed) desktop.kill();
  };
  try {
    const env = await desktopEnvironment(run);
    log = await open(path.join(run.directory, 'desktop-process.log'), 'wx', 0o600);
    runtime = await stageOwnerReviewElectronRuntime(portable, run.directory);
    desktop = spawn(runtime.executable, [path.join(portable.appRoot, 'desktop'), '--user-data-dir='+run.desktopDataDirectory],
      {cwd: portable.appRoot, windowsHide: false, stdio: ['ignore', log.fd, log.fd], env});
    const started = new Promise((resolve, reject) => {
      desktop.once('spawn', resolve);
      desktop.once('error', reject);
    });
    exited = new Promise(resolve => desktop.once('close', (code, signal) => resolve({code, signal})));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await started;
    await writeFile(path.join(run.directory, 'desktop-launch.json'), JSON.stringify({
      schemaVersion: 1, candidateId: run.candidateId, desktopPid: desktop.pid,
    })+'\n', {flag: 'wx', mode: 0o600});

    const {ownerPhone, ownerPassword, adminPhone, assistantPhone, internPhone,
      managerCandidatePhone, partnerCandidatePhone} = run.credentials;
    console.log('审易 · 受管试点演练。请使用本轮合成资料。');
    console.log('合成产品负责人 '+ownerPhone);
    console.log('本轮负责人密码 '+ownerPassword);
    console.log('合成首管理员 '+adminPhone+'，合成助理 '+assistantPhone+'，合成实习生 '+internPhone+'。');
    console.log('四席演练另有两名候选员工 '+managerCandidatePhone+'（拟任经理）、'+partnerCandidatePhone+'（拟任合伙人），均先按助理邀请。');
    console.log('需要验证码时，请查看本窗口对应号码的新消息。');
    console.log('本轮演练目录 '+run.directory);
    console.log('本轮合成原件 '+run.originalFile);
    console.log('请在同一轮完成开通、席位审批、指派和核对。关闭桌面后停止本轮服务。');
    const result = await exited;
    if (result.code !== 0) throw new Error('受管试点桌面未正常退出，请查看本轮桌面日志。');
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    try {
      stop();
      await exited;
      await log?.close();
    } finally {
      try { await run.close(); } finally { await runtime?.close(); }
    }
  }
}

if (process.argv[1] && path.relative(path.resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '') {
  if (process.argv.length !== 2) {
    console.error('受管试点演练入口不接收参数。');
    process.exitCode = 1;
  } else launch().catch(() => {
    console.error('受管试点演练启动或退出未完成，请核对完整评审包和本轮日志。');
    process.exitCode = 1;
  });
}
