// Portable Windows review only. No demo seed, external SMS, payment or TLS bypass.
import {createServer as createReservation} from 'node:net';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import configuration from '../desktop/isolated-preview-config.cjs';
import deviceDirectories from '../desktop/device-key-directory.cjs';
import {bootstrapManagedOwner} from '../server/team/managed-owner-bootstrap.mjs';
import {startManagedTeamServer} from '../server/team/managed-service.mjs';
import {listenOnLoopback} from '../server/team/team-http-listener.mjs';
import {createOwnerReviewCheckoutCertificate} from './owner-review-checkout-certificate.mjs';

const {loadOwnerReviewRuntime}=configuration;
const {resolveDeviceVaultDirectory}=deviceDirectories;
const PACKAGE_ROOT=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const ROOT_MARKER='{"schemaVersion":1,"kind":"shenyi-managed-pilot-review-root"}\n';
const PHONE=Object.freeze({
 ownerPhone:'+8613800000991',
 adminPhone:'+8613800000992',
 assistantPhone:'+8613800000993',
 internPhone:'+8613800000994',
 managerCandidatePhone:'+8613800000996',
 partnerCandidatePhone:'+8613800000997',
});
const EMPLOYEE_PHONES=new Set([PHONE.assistantPhone,PHONE.internPhone,PHONE.managerCandidatePhone,PHONE.partnerCandidatePhone]);
const samePath=(a,b)=>a.toLowerCase()===b.toLowerCase();
const within=(parent,child)=>{const rel=path.relative(parent,child);return !path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
const sha=value=>createHash('sha256').update(value).digest('hex');
function failure(code='OWNER_REVIEW_MANAGED_PILOT_INVALID'){return Object.assign(new Error('独立受管试点评审未能安全完成；仅本轮合成环境可能已创建，请核对本轮回执。'),{code});}
function check(value){if(!value)throw failure();}
function absolute(value){
 check(typeof value==='string'&&value&&value.isWellFormed()&&!/[\x00-\x1f\x7f]/.test(value)&&/^[A-Za-z]:[\\/]/.test(value)&&!value.startsWith('\\\\'));
 check(!value.slice(3).split(/[\\/]/).some(part=>part==='.'||part==='..'||/[:*?"<>|]|[. ]$|^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part)));
 return path.resolve(value);
}
async function directoryChain(directory){
 const full=absolute(directory),root=path.parse(full).root,chain=[];let at=root;
 for(const segment of full.slice(root.length).split(path.sep).filter(Boolean)){
  at=path.join(at,segment);const info=await fs.lstat(at,{bigint:true});
  check(info.isDirectory()&&!info.isSymbolicLink()&&samePath(await fs.realpath(at),at));chain.push({filename:at,dev:info.dev,ino:info.ino});
 }
 return chain;
}
async function recheck(chain){for(const old of chain){const info=await fs.lstat(old.filename,{bigint:true});check(info.isDirectory()&&!info.isSymbolicLink()&&info.dev===old.dev&&info.ino===old.ino&&samePath(await fs.realpath(old.filename),old.filename));}}
async function readRootMarker(filename){
 let handle;try{const entry=await fs.lstat(filename,{bigint:true});check(entry.isFile()&&!entry.isSymbolicLink()&&entry.size>0n&&entry.size<4096n);
  handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const before=await handle.stat({bigint:true});
  check(before.dev===entry.dev&&before.ino===entry.ino&&before.size===entry.size);
  const bytes=await handle.readFile(),after=await handle.stat({bigint:true}),current=await fs.lstat(filename,{bigint:true});
  check(bytes.length===Number(before.size)&&[after,current].every(info=>info.isFile()&&!info.isSymbolicLink()&&info.dev===before.dev&&info.ino===before.ino&&info.size===before.size&&info.mtimeNs===before.mtimeNs&&info.ctimeNs===before.ctimeNs));
  check(bytes.equals(Buffer.from(ROOT_MARKER)));
 }finally{await handle?.close();}
}
async function publish(filename,bytes,chain){
 await recheck(chain);const temporary=path.join(path.dirname(filename),'.'+path.basename(filename)+'.'+randomUUID()+'.pending');let handle,identity;
 const sameFile=info=>info.isFile()&&!info.isSymbolicLink()&&info.dev===identity.dev&&info.ino===identity.ino;
 try{handle=await fs.open(temporary,'wx',0o600);identity=await handle.stat({bigint:true});await handle.writeFile(bytes);await handle.sync();const written=await handle.stat({bigint:true});await handle.close();handle=null;
  await recheck(chain);const listed=await fs.lstat(temporary,{bigint:true});check(sameFile(listed)&&listed.nlink===1n&&listed.size===BigInt(Buffer.byteLength(bytes))&&listed.size===written.size&&listed.mtimeNs===written.mtimeNs&&listed.ctimeNs===written.ctimeNs);
  await fs.link(temporary,filename);check(sameFile(await fs.lstat(filename,{bigint:true})));
 }finally{await handle?.close();if(identity){await recheck(chain);try{if(sameFile(await fs.lstat(temporary,{bigint:true})))await fs.unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}}
}
async function prepareExternalDirectory(portable){
 // The existing prepareIsolatedPreviewDirectory intentionally confines portable
 // runs to package/review-runs. The managed bootstrap rejects databases there.
 // This separate owner-marked root preserves both guards without a fake appRoot.
 const local=absolute(process.env.LOCALAPPDATA),root=path.join(local,'ShenyiManagedPilotReview');
 check(!within(portable.appRoot,root)&&!within(PACKAGE_ROOT,root));
 const parents=await directoryChain(local);await recheck(parents);
 try{await fs.mkdir(root,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 const rootChain=await directoryChain(root),marker=path.join(root,'managed-pilot-review-root.json');
 let present=true;try{await fs.lstat(marker);}catch(error){if(error.code==='ENOENT')present=false;else throw error;}
 if(!present){
  const names=await fs.readdir(root);
  if(names.some(name=>!/^\.managed-pilot-review-root\.json\.[a-f0-9-]{36}\.pending$/.test(name))){await readRootMarker(marker);}
  else try{await publish(marker,ROOT_MARKER,rootChain);}catch(error){if(error.code!=='EEXIST')throw error;}
 }
 // Root publication briefly has two hard links. Its retirement changes ctime;
 // retry the complete strict read once, never relax profile/owner validation.
 for(let attempt=0;;attempt++){try{await readRootMarker(marker);break;}catch(error){if(attempt)throw error;}}
 await recheck(rootChain);const candidateId=randomUUID(),directory=path.join(root,'candidate-'+candidateId);
 await fs.mkdir(directory,{mode:0o700});const chain=await directoryChain(directory);
 return {directory,candidateId,chain};
}
function originalBytes(candidateId){
 const header=Buffer.from('审易独立受管试点评审 · 合成原件\nNo real company, person, account or audit data.\nCandidate: '+candidateId+'\n','utf8');
 const line=Buffer.from('Synthetic collection rehearsal only. No professional audit conclusion or real client information.\n');
 const bytes=Buffer.alloc(2048,0x20);header.copy(bytes);for(let offset=header.length;offset<bytes.length;offset+=line.length)line.copy(bytes,offset,0,Math.min(line.length,bytes.length-offset));bytes[bytes.length-1]=10;return bytes;
}
async function record(directory,name,value,chain){await publish(path.join(directory,name),JSON.stringify(value,null,2)+'\n',chain);}

/** Create one blank managed pilot rehearsal; verification codes never persist. */
export async function createOwnerReviewManagedPilot(options={}){
 let prepared,db,service,reservation,closing,stopping=false,dbClosed=false,apiBase=null,serverId=null,databasePath=null,phase='configuration';
 let pepper;
 async function releaseReservation(){const held=reservation;reservation=null;if(held?.listening)await new Promise((resolve,reject)=>held.close(error=>error?reject(error):resolve()));}
 async function stopOwned(){
  stopping=true;let failed=false;
  try{await releaseReservation();}catch{failed=true;}
  try{if(service){const stopped=service.close();service.server.closeAllConnections();await stopped;}}catch{failed=true;}
  finally{if(db&&!dbClosed){try{db.close();dbClosed=true;}catch{failed=true;}}pepper?.fill(0);}
  if(failed)throw failure('OWNER_REVIEW_MANAGED_PILOT_CLOSE_FAILED');
 }
 async function failureReceipt(at){if(prepared)try{await record(prepared.directory,'failure.json',{schemaVersion:1,kind:'shenyi-owner-review-managed-pilot-failure',candidateId:prepared.candidateId,databasePath,apiBase,serverId,phase:at,code:'MANAGED_PILOT_REVIEW_FAILED',failedAt:new Date().toISOString()},prepared.chain);}catch{/* Preserve the original fixed failure and any already-created evidence. */}}
 try{
  check(process.platform==='win32'&&process.arch==='x64'&&/^24\.(?:1[5-9]|[2-9]\d|\d{3,})\.(?:0|[1-9]\d*)$/.test(process.versions.node));
  check(options&&Object.getPrototypeOf(options)===Object.prototype);const fields=Object.getOwnPropertyDescriptors(options);
  check(Reflect.ownKeys(fields).every(key=>typeof key==='string'&&['appRoot','onVerificationCode'].includes(key)&&Object.hasOwn(fields[key],'value')&&fields[key].enumerable));
  const appRoot=fields.appRoot?.value,onVerificationCode=fields.onVerificationCode?.value;check(typeof onVerificationCode==='function');
  check(process.env.NODE_TLS_REJECT_UNAUTHORIZED===undefined||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='1');
  const portable=await loadOwnerReviewRuntime({appRoot});check(portable);
  phase='prepare-external-directory';prepared=await prepareExternalDirectory(portable);const {directory,candidateId,chain}=prepared;
  const desktopDataDirectory=path.join(directory,'desktop-data');
  const deviceVaultDirectory=resolveDeviceVaultDirectory({platform:'win32',localAppData:path.join(directory,'local-app-data')});
  const configFile=path.join(directory,'managed-pilot-service.json'),caFile=path.join(directory,'managed-pilot-ca.pem'),originalFile=path.join(directory,'managed-pilot-original.txt');
  await recheck(chain);await fs.mkdir(desktopDataDirectory,{mode:0o700});
  const credentials=Object.freeze({...PHONE,ownerPassword:randomBytes(32).toString('base64url')});
  databasePath=path.join(directory,'managed-owner','team.sqlite');phase='bootstrap-one-synthetic-owner';
  const owner=await bootstrapManagedOwner({outputDirectory:path.join(directory,'managed-owner'),displayName:'合成产品负责人',phone:credentials.ownerPhone,password:credentials.ownerPassword,verifiedOutOfBand:true});
  check(samePath(owner.databasePath,databasePath));serverId=owner.serverId;
  const databaseInfo=await fs.lstat(databasePath,{bigint:true});check(databaseInfo.isFile()&&!databaseInfo.isSymbolicLink()&&databaseInfo.nlink===1n&&samePath(await fs.realpath(databasePath),databasePath));
  await recheck(chain);db=new DatabaseSync(path.toNamespacedPath(databasePath),{timeout:5000});db.exec('PRAGMA foreign_keys=ON');
  check(db.prepare('SELECT COUNT(*) n FROM team_users').get().n===1);
  for(const table of ['teams','team_memberships','team_operators','team_sessions','team_device_bindings','team_subscription_events','team_seat_capacity_grants'])check(db.prepare('SELECT COUNT(*) n FROM '+table).get().n===0);
  phase='ephemeral-public-ca-and-synthetic-original';const certificate=createOwnerReviewCheckoutCertificate(),original=originalBytes(candidateId);
  await publish(caFile,certificate.ca,chain);await publish(originalFile,original,chain);
  phase='reserve-loopback-port';reservation=createReservation(socket=>socket.destroy());
  const {port}=await listenOnLoopback(reservation,0,{exclusive:true});
  apiBase='https://127.0.0.1:'+port;const profile=Object.freeze({schemaVersion:1,apiBase,serverId});
  // The production factory accepts a port rather than a reserved socket. Retire
  // that owned reservation exactly once before binding the final HTTPS server.
  await releaseReservation();phase='start-production-managed-loopback-listener';pepper=randomBytes(32);
  const sms=Object.freeze({async send(value){
   check(!stopping&&value&&typeof value.code==='string'&&/^\d{6}$/.test(value.code));
   check((value.purpose==='first-admin'&&value.phone===PHONE.adminPhone)||
     (value.purpose==='activate'&&EMPLOYEE_PHONES.has(value.phone)));
   await onVerificationCode(Object.freeze({purpose:value.purpose,phone:value.phone,code:value.code}));
  }});
  service=await startManagedTeamServer({db,apiBase,port,serverId,key:certificate.key,cert:certificate.cert,sms,phonePepper:pepper});pepper.fill(0);
  const actual=service.server.address();check(service.address.host==='127.0.0.1'&&service.address.port===port&&service.address.url===apiBase&&service.apiBase===apiBase&&actual?.address==='127.0.0.1'&&actual.port===port);
  await publish(configFile,JSON.stringify(profile)+'\n',chain);phase='publish-started-receipt';
  await record(directory,'started.json',{schemaVersion:1,kind:'shenyi-owner-review-managed-pilot-started',candidateId,directory,databasePath,apiBase,serverId,desktopDataDirectory,deviceVaultDirectory,configFile,caFile,originalFile,originalBytes:original.length,originalSha256:sha(original),tlsFingerprint256:certificate.fingerprint256,tlsExpiresAt:certificate.expiresAt,launcherPid:process.pid,startedAt:new Date().toISOString(),syntheticOnly:true,initialUsers:1,initialTeams:0,initialSeatGrants:0,externalSms:false,wechat:false,billingSimulation:false},chain);
  const close=()=>closing??=(async()=>{
   try{await stopOwned();await record(directory,'closed.json',{schemaVersion:1,kind:'shenyi-owner-review-managed-pilot-closed',candidateId,databasePath,apiBase,serverId,serviceClosed:!service.server.listening,databaseClosed:dbClosed,closedAt:new Date().toISOString()},chain);}
   catch{await failureReceipt('close');throw failure('OWNER_REVIEW_MANAGED_PILOT_CLOSE_FAILED');}
  })();
  return Object.freeze({directory,candidateId,databasePath,configFile,caFile,desktopDataDirectory,deviceVaultDirectory,profile,address:Object.freeze({...service.address}),originalFile,credentials,close});
 }catch{
  const failedPhase=phase;try{await stopOwned();}catch{}await failureReceipt(failedPhase);throw failure(prepared?'OWNER_REVIEW_MANAGED_PILOT_STARTUP_FAILED':'OWNER_REVIEW_MANAGED_PILOT_INVALID');
 }
}
