import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeTeamDatabase,seedDemoTeamData} from './database.mjs';
import {handleTeamApplicationRequest} from './application-api.mjs';
import {json} from './http-utils.mjs';
import {subscriptionEnforcementMode} from './subscription-configuration.mjs';
import {seatCapacityMode} from './seat-capacity-policy.mjs';
import {billingSimulationConfiguration} from './billing-simulation.mjs';
import {startLoopbackTeamListener} from './team-http-listener.mjs';

/** Loopback-only demo listener. Tests may request port=0; no public host option. */
export async function startTeamServer({db,port=8774,now=Date.now,identityProviders={},subscriptionEnforcement='disabled',billingSimulation=null,seatCapacityEnforcement='disabled'} = {}) {
  if (!db?.prepare || !Number.isInteger(port) || port<0 || port>65535) throw new Error('Invalid local server options');
  subscriptionEnforcementMode(subscriptionEnforcement,identityProviders);
  seatCapacityMode(seatCapacityEnforcement,{subscriptionEnforcement,identityProviders});
  billingSimulation=billingSimulationConfiguration(billingSimulation,{subscriptionEnforcement,identityProviders,seatCapacityEnforcement});
  return startLoopbackTeamListener({
    createServer:http.createServer, protocol:'http', port,
    resolveTarget(incoming, origin) {
      if (incoming.headers.host === new URL(origin).host && incoming.url.startsWith('/') && !incoming.url.startsWith('//')) {
        return new URL(incoming.url, origin);
      }
    },
    dispatch(request, incoming) {
      if (incoming.url === '/health' && incoming.method === 'GET') return json({status:'ok',mode:'synthetic-team-demo'});
      return handleTeamApplicationRequest(request,{db,now,identityProviders,subscriptionEnforcement,billingSimulation,seatCapacityEnforcement});
    }
  });
}

async function main() {
  const args=process.argv.slice(2), flag=args.indexOf('--data-dir');
  if (!args.includes('--demo') || flag<0 || !args[flag+1] || args.some((arg,index)=>arg!=='--demo'&&arg!=='--data-dir'&&index!==flag+1)) throw new Error('Usage: node server/team/dev-server.mjs --demo --data-dir <isolated-directory>');
  const directory=path.resolve(args[flag+1]);
  await mkdir(directory,{recursive:true});
  const db=new DatabaseSync(path.join(directory,'team-demo.sqlite'));
  try {
    initializeTeamDatabase(db);await seedDemoTeamData(db);
    const service=await startTeamServer({db});
    console.log(`审迹合成团队服务 ${service.address.url}；仅本机、仅演示资料，不用于生产。`);
    const stop=async()=>{await service.close();db.close();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  } catch (error) { db.close();throw error; }
}
if (process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(()=>{console.error('团队演示服务启动失败；请检查本机端口或隔离数据目录，未改动旧业务库。');process.exitCode=1;});
