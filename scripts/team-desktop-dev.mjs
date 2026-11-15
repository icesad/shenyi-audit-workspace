#!/usr/bin/env node
// Local synthetic development launcher, not an installer or production service.
import path from 'node:path';
import os from 'node:os';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {initializeTeamDatabase,seedDemoTeamData} from '../server/team/database.mjs';
import {startTeamServer} from '../server/team/dev-server.mjs';
import {seedProvisioningDemo} from '../server/team/provisioning-demo.mjs';
import {seedRecoveryReviewDemo} from '../server/team/recovery-review-demo.mjs';
import {seedMemberDeactivationDemo} from '../server/team/member-access-demo.mjs';
import {seedDeviceReplacementDemo} from '../server/team/device-replacement-demo.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function main() {
  if (!/^24\./.test(process.versions.node) || Number(process.versions.node.split('.')[1])<15) throw new Error('请使用Node.js 24.15以上24.x启动。');
  if (process.argv.length>2) throw new Error('此入口不接受生产服务器或客户资料参数。');
  const require=createRequire(path.join(root,'desktop/package.json'));
  let electron;
  try { electron=require('electron'); } catch { throw new Error('请先在desktop目录按锁文件安装Electron依赖，参见desktop/README.md。'); }
  if (typeof electron!=='string'||!existsSync(electron)) throw new Error('Electron运行时未完整安装，请参见desktop/README.md。');
  const reviewDemo=process.env.SHENYI_TEAM_REVIEW_DEMO==='1';
  if(process.env.SHENYI_TEAM_REVIEW_DEMO!==undefined&&!reviewDemo)throw new Error('审核演示开关无效；仅支持显式值1。');
  const demoName=reviewDemo?'shenyi-team-review-preview':'shenyi-team-preview';
  const directory=process.platform==='win32'?'D:/codex-temp/'+demoName:path.join(os.homedir(),'.local/share',demoName);
  await mkdir(directory,{recursive:true});
  const db=new DatabaseSync(path.join(directory,'team-demo.sqlite'));
  let service;
  try {
    initializeTeamDatabase(db);await seedDemoTeamData(db);if(reviewDemo){await seedProvisioningDemo(db);await seedRecoveryReviewDemo(db);await seedMemberDeactivationDemo(db);await seedDeviceReplacementDemo(db);}
    service=await startTeamServer({db,identityProviders:{deviceProofRequired:true,...(reviewDemo?{reviewedRecovery:true}:{})}});
  } catch (error) { db.close();if(error.code==='EADDRINUSE')throw new Error('本机8774端口已占用。未切换端口或结束已有进程；请核对已有团队服务。');throw error; }
  console.log('审易团队采集：纯合成演示，本机8774；不读原浏览器资料，不用于生产。');
  if(reviewDemo)console.log('独立人工开通演示：reviewer-demo / ShenyiDemo!2026；无短信供应商，不能完成手机号激活。');
  if(reviewDemo)console.log('恢复审核演示：recovery-reviewer-demo / ShenyiDemo!2026；无短信供应商，不能申请或完成恢复。');
  if(reviewDemo)console.log('成员停用演示：administrator-demo（团队管理）、access-reviewer-demo（管理员停用审核） / ShenyiDemo!2026；仅合成账号，无审计资料权限。');
  if(reviewDemo)console.log('换机审核演示：device-reviewer-demo / ShenyiDemo!2026；仅独立设备审核权限，无审计资料权限，不自动绑定设备。');
  const child=spawn(electron,[path.join(root,'desktop')],{cwd:root,windowsHide:false,stdio:['ignore','inherit','inherit'],env:{...process.env,SHENYI_TEAM_API:service.address.url,SHENYI_DESKTOP_DATA_DIR:path.join(directory,'desktop-data')}});
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;await service.close();db.close();};
  process.once('SIGINT',()=>{child.kill();void stop();});process.once('SIGTERM',()=>{child.kill();void stop();});
  child.once('error',async()=>{await stop();process.exitCode=1;console.error('桌面进程启动失败，团队演示服务已停止。');});
  child.once('exit',async code=>{await stop();process.exitCode=code===0?0:1;});
}
main().catch(error=>{console.error(error.message||'团队演示启动失败。');process.exitCode=1;});
