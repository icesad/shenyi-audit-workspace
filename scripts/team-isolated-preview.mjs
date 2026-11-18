#!/usr/bin/env node
// Each invocation owns a new synthetic DB, listener, desktop profile and device vault.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {writeFile,stat,mkdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {initializeTeamDatabase,seedDemoTeamData} from '../server/team/database.mjs';
import {startTeamServer} from '../server/team/dev-server.mjs';
import configuration from '../desktop/isolated-preview-config.cjs';
import {prepareBillingPreview,BILLING_PREVIEW_ADMIN,BILLING_PREVIEW_OWNER,BILLING_PREVIEW_PASSWORD} from './team-billing-preview-fixture.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {prepareIsolatedPreviewDirectory,writeIsolatedPreviewConfiguration}=configuration;
export function assertNode24(version=process.versions.node){if(typeof version!=='string'||!/^24\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)||Number(version.split('.')[1])<15)throw Error('请使用Node.js 24.15以上24.x启动独立候选预览。');}
const DENY=new Set(['NODE_OPTIONS','NODE_PATH','NODE_DEBUG','NODE_DEBUG_NATIVE','VSCODE_INSPECTOR_OPTIONS','VSCODE_JS_DEBUG_OPTIONS','NODE_V8_COVERAGE','ELECTRON_LOG_FILE','ELECTRON_ENABLE_LOGGING','ELECTRON_ENABLE_STACK_DUMPING','ELECTRON_DISABLE_SANDBOX','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','ELECTRON_RUN_AS_NODE','SSL_CERT_FILE','SSL_CERT_DIR','NODE_USE_SYSTEM_CA','NODE_USE_ENV_PROXY','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','GLOBAL_AGENT_HTTP_PROXY']);
export function candidateChildEnvironment({env=process.env,context}={}){
 if(!context?.configFile||!context?.desktopDataDirectory)throw Error('独立候选上下文未就绪。');
 const result={};for(const [key,value]of Object.entries(env)){const upper=key.toUpperCase();if(!upper.startsWith('SHENYI_')&&!DENY.has(upper))result[key]=value;}
 result.SHENYI_ISOLATED_PREVIEW_CONFIG=context.configFile;result.SHENYI_DESKTOP_DATA_DIR=context.desktopDataDirectory;return result;
}
async function record(directory,name,value){await writeFile(path.join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
export async function createIsolatedPreviewService({rootDirectory,billingDemo=false}={}){
 assertNode24();
 if(typeof billingDemo!=='boolean')throw Error('独立候选预览模式无效。');
 const prepared=await prepareIsolatedPreviewDirectory({rootDirectory});let db,service;
 try{
  await mkdir(prepared.desktopDataDirectory,{mode:0o700});
  db=new DatabaseSync(path.join(prepared.directory,'team-demo.sqlite'));initializeTeamDatabase(db);await seedDemoTeamData(db);
  const billing=billingDemo?await prepareBillingPreview(db):null;
  if(billing)await record(prepared.directory,'billing-demo-cases.json',billing.cases);
  const serverId=db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get()?.value;
  service=await startTeamServer({db,port:0,identityProviders:{deviceProofRequired:true},
   ...(billing?{subscriptionEnforcement:'team-management-v1',seatCapacityEnforcement:'invitation-reservations-v1',billingSimulation:billing.billingSimulation}:{})});
  const context=await writeIsolatedPreviewConfiguration({...prepared,apiBase:service.address.url,serverId}),started={schemaVersion:1,kind:'shenyi-isolated-preview-started',candidateId:context.candidateId,apiBase:context.profile.apiBase,serverId:context.profile.serverId,directory:context.directory,desktopDataDirectory:context.desktopDataDirectory,deviceVaultDirectory:context.deviceVaultDirectory,launcherPid:process.pid,startedAt:new Date().toISOString()};
  await record(context.directory,'started.json',started);let closing;
  const close=()=>closing??=(async()=>{try{service.server.closeAllConnections();await service.close();}finally{db.close();}await record(context.directory,'closed.json',{schemaVersion:1,candidateId:context.candidateId,closedAt:new Date().toISOString()});})();
  return Object.freeze({context,server:service.server,address:service.address,close,...(billing?{cases:billing.cases}:{})});
 }catch(error){service?.server.closeAllConnections();try{await service?.close();}finally{db?.close();}await record(prepared.directory,'startup-failed.json',{schemaVersion:1,candidateId:prepared.candidateId,code:typeof error?.code==='string'?error.code:'STARTUP_FAILED',failedAt:new Date().toISOString()});throw error;}
}
async function electronExecutable(){
 const require=createRequire(path.join(ROOT,'desktop/package.json'));let executable;try{executable=require('electron');}catch{throw Error('请先按desktop/README.md安装既有Electron依赖。');}
 if(typeof executable!=='string'||!(await stat(executable)).isFile())throw Error('Electron运行时未完整安装，请参见desktop/README.md。');return executable;
}
export async function launchIsolatedTeamPreview({billingDemo=false}={}){
 assertNode24();const executable=await electronExecutable(),owned=await createIsolatedPreviewService({billingDemo}),{context}=owned;let child,log;
 try{
  log=createWriteStream(path.join(context.directory,'desktop-process.log'),{flags:'wx',mode:0o600});
  await new Promise((resolve,reject)=>{log.once('open',resolve);log.once('error',reject);});
  child=spawn(executable,[path.join(ROOT,'desktop'),'--user-data-dir='+context.desktopDataDirectory],{cwd:ROOT,windowsHide:false,stdio:['ignore','pipe','pipe'],env:candidateChildEnvironment({context})});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  console.log('审易 · 独立合成候选预览；每次启动新建环境，关闭后资料保留。');
  if(owned.cases){
   console.log('模拟账务：'+BILLING_PREVIEW_ADMIN+'（技术管理员）、'+BILLING_PREVIEW_OWNER+'（退款负责人）；两者密码：'+BILLING_PREVIEW_PASSWORD+'。');
   console.log('普通成员验收可用 intern-a，采用同一合成密码。');
   console.log('预置订单清单：'+path.join(context.directory,'billing-demo-cases.json'));
  }else console.log('合成账号：manager-a、partner-a、intern-a、assistant-a；密码：ShenyiDemo!2026。');
  console.log('本机地址：'+context.profile.apiBase+'；资料目录：'+context.directory);
  console.log('请勿导入真实客户资料。原审核预览及共享库未被连接或升级。');
  let childError=false;const stop=()=>{if(child.exitCode===null)child.kill();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  child.once('error',()=>{childError=true;});
  const code=await new Promise(resolve=>child.once('close',resolve));process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  await new Promise((resolve,reject)=>log.end(error=>error?reject(error):resolve()));await owned.close();
  if(childError||code!==0)throw Error('候选桌面进程未正常启动或已异常退出；新环境已停止，合成资料保留。');
  return {directory:context.directory,closed:true};
 }catch(error){if(child&&child.exitCode===null)child.kill();log?.end();await owned.close();throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const billingDemo=process.argv.length===3&&process.argv[2]==='--billing-demo';
 if(process.argv.length!==2&&!billingDemo){console.error('独立合成候选入口仅接受可选 --billing-demo，不接受服务器或资料目录。');process.exitCode=1;}
 else launchIsolatedTeamPreview({billingDemo}).catch(error=>{console.error(error.message||'独立合成候选预览启动失败。');process.exitCode=1;});
}
