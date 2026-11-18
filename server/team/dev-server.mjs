import http from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
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

// Finish bounded early-denied bodies without retaining or parsing their bytes.
async function discardBeforeResponse(incoming,request) {
  if(incoming.complete||incoming.destroyed||request?.body?.locked)return;
  let reader,timer;
  const expired=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1000);});
  try {
    reader=(request?.body??Readable.toWeb(incoming)).getReader();
    let remaining=17*1024*1024;
    while(remaining>0){
      const part=await Promise.race([reader.read(),expired]);
      if(part===null||part.done)break;
      remaining-=part.value.byteLength;
    }
  } catch { /* The normal response/abort path handles closed or unreadable bodies. */ }
  finally {clearTimeout(timer);reader?.releaseLock();}
}

/** Loopback-only demo listener. Tests may request port=0; no public host option. */
export async function startTeamServer({db,port=8774,now=Date.now,identityProviders={},subscriptionEnforcement='disabled',billingSimulation=null,seatCapacityEnforcement='disabled'} = {}) {
  if (!db?.prepare || !Number.isInteger(port) || port<0 || port>65535) throw new Error('Invalid local server options');
  subscriptionEnforcementMode(subscriptionEnforcement,identityProviders);
  seatCapacityMode(seatCapacityEnforcement,{subscriptionEnforcement,identityProviders});
  billingSimulation=billingSimulationConfiguration(billingSimulation,{subscriptionEnforcement,identityProviders});
  let origin;
  const server = http.createServer(async (incoming,outgoing) => {
    const controller=new AbortController(),abort=()=>controller.abort(),closed=()=>{if(!outgoing.writableEnded)abort();};
    incoming.once('aborted',abort);outgoing.once('close',closed);
    if(incoming.aborted||outgoing.destroyed)abort();
    try {
      let response,request;
      try {
        if (incoming.headers.host !== new URL(origin).host || !incoming.url.startsWith('/') || incoming.url.startsWith('//')) response=json({error:{code:'HOST_DENIED',message:'请求地址无效。'}},403);
        else if (incoming.url==='/health' && incoming.method==='GET') response=json({status:'ok',mode:'synthetic-team-demo'});
        else {
          const options={method:incoming.method,headers:incoming.headers,signal:controller.signal};
          if (!['GET','HEAD'].includes(incoming.method)) { options.body=Readable.toWeb(incoming);options.duplex='half'; }
          request=new Request(new URL(incoming.url,origin),options);
          response=await handleTeamApplicationRequest(request,{db,now,identityProviders,subscriptionEnforcement,billingSimulation,seatCapacityEnforcement});
        }
      } catch { response=json({error:{code:'SERVICE_UNAVAILABLE',message:'团队服务暂不可用。'}},503); }
      if(controller.signal.aborted||outgoing.destroyed){await response.body?.cancel();return;}
      if(response.status>=400)await discardBeforeResponse(incoming,request);
      if(controller.signal.aborted||outgoing.destroyed){await response.body?.cancel();return;}
      const writeHeaders=()=>{
        const headers=Object.fromEntries(response.headers);
        // Unread request bytes must not carry over to a persistent connection.
        if(!incoming.complete)headers.connection='close';
        outgoing.writeHead(response.status,headers);
      };
      if(response.headers.has('X-Shenyi-Workpaper-Export-Sha256')){
        writeHeaders();
        try{await pipeline(Readable.fromWeb(response.body),outgoing,{signal:controller.signal});}
        catch{outgoing.destroy();}
        return;
      }
      const bytes=incoming.method==='HEAD'?null:Buffer.from(await response.arrayBuffer());
      if(controller.signal.aborted||outgoing.destroyed)return;
      writeHeaders();
      outgoing.end(bytes);
    } finally {
      incoming.off('aborted',abort);outgoing.off('close',closed);
    }
  });
  server.requestTimeout=15000;server.headersTimeout=5000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=100;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  const bound=server.address();origin=`http://127.0.0.1:${bound.port}`;
  return {server,address:{host:'127.0.0.1',port:bound.port,url:origin},close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections();})};
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
    console.log(`审易合成团队服务 ${service.address.url}；仅本机、仅演示资料，不用于生产。`);
    const stop=async()=>{await service.close();db.close();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  } catch (error) { db.close();throw error; }
}
if (process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(()=>{console.error('团队演示服务启动失败；请检查本机端口或隔离数据目录，未改动旧业务库。');process.exitCode=1;});
