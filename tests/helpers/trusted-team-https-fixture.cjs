'use strict';
// Real TLS transport fixture. Keys are generated outside the checkout; no global
// CA installation, TLS bypass, dependency, shared port, or shared database.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const https=require('node:https'),http=require('node:http');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {randomInt,createHash,X509Certificate}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'../..'),PASSWORD='ShenyiDemo!2026';
const hash=value=>createHash('sha256').update(value).digest('hex');
const source=name=>import(pathToFileURL(path.join(ROOT,'server/team',name)).href);
function deferred(){let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};}
function childEnvironment(extra={}){const env={...process.env};for(const key of ['NODE_OPTIONS','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','ELECTRON_RUN_AS_NODE','SSL_CERT_FILE','SSL_CERT_DIR','NODE_USE_SYSTEM_CA','NODE_USE_ENV_PROXY','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','GLOBAL_AGENT_HTTP_PROXY'])delete env[key];return {...env,...extra};}
async function command(executable,args,{cwd,env,timeout=30000}={}){return new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(Error('Owned fixture child timed out'));},timeout);child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',(code,signal)=>{clearTimeout(timer);resolve({executable,args,code,signal,stdout,stderr});});});}
async function findOpenSSL(){const candidates=process.env.SHENYI_TEST_OPENSSL?[process.env.SHENYI_TEST_OPENSSL]:process.platform==='win32'?['D:/Program Files/Git/usr/bin/openssl.exe','C:/Program Files/Git/usr/bin/openssl.exe','openssl.exe']:['openssl'];for(const candidate of candidates){try{const result=await command(candidate,['version']);if(result.code===0)return {executable:candidate,version:result.stdout.trim()};}catch{}}throw Error('A working existing OpenSSL CLI is required; install is not performed by tests.');}
async function generateCertificates(directory){
 await fs.mkdir(directory,{recursive:true});const openssl=await findOpenSSL(),attempts=[];
 const run=async args=>{const result=await command(openssl.executable,args,{cwd:directory});attempts.push(result);await fs.writeFile(path.join(directory,'openssl-attempts.json'),JSON.stringify(attempts,null,2));if(result.code!==0)throw Error('OpenSSL certificate generation failed; see private fixture evidence.');};
 await run(['req','-x509','-newkey','rsa:2048','-sha256','-nodes','-days','2','-keyout','root-ca.key','-out','root-ca.pem','-subj','/CN=Shenyi Synthetic TLS CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign']);
 for(const [name,cn,san,serial]of [['valid','localhost','DNS:localhost,IP:127.0.0.1','0x01'],['wrong-host','wrong.invalid','DNS:wrong.invalid','0x02']]){
  await fs.writeFile(path.join(directory,name+'-ext.cnf'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName='+san+'\n');
  await run(['req','-new','-newkey','rsa:2048','-nodes','-sha256','-keyout',name+'.key','-out',name+'.csr','-subj','/CN='+cn]);
  await run(['x509','-req','-in',name+'.csr','-CA','root-ca.pem','-CAkey','root-ca.key','-set_serial',serial,'-days','2','-sha256','-extfile',name+'-ext.cnf','-out',name+'.pem']);
 }
 await fs.mkdir(path.join(directory,'newcerts'));await fs.writeFile(path.join(directory,'index.txt'),'');await fs.writeFile(path.join(directory,'serial'),'1000\n');
 await fs.writeFile(path.join(directory,'ca-sign.cnf'),'[ca]\ndefault_ca=synthetic_ca\n[synthetic_ca]\ndir='+directory.replaceAll('\\','/')+'\ndatabase=$dir/index.txt\nnew_certs_dir=$dir/newcerts\ncertificate=$dir/root-ca.pem\nprivate_key=$dir/root-ca.key\nserial=$dir/serial\ndefault_md=sha256\ndefault_days=2\npolicy=policy_any\nunique_subject=no\n[policy_any]\ncommonName=supplied\n[leaf_ext]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
 const date=offset=>new Date(Date.now()+offset).toISOString().replace(/[-:T]/g,'').replace(/\.\d{3}Z$/,'Z');
 await run(['ca','-batch','-config','ca-sign.cnf','-in','valid.csr','-out','expired.pem','-startdate',date(-2*86400000),'-enddate',date(-86400000),'-extensions','leaf_ext','-notext']);
 const certificates={};for(const name of ['root-ca','valid','wrong-host','expired']){const cert=new X509Certificate(await fs.readFile(path.join(directory,name+'.pem')));certificates[name]={fingerprint256:cert.fingerprint256,subject:cert.subject,issuer:cert.issuer,validFrom:cert.validFrom,validTo:cert.validTo,subjectAltName:cert.subjectAltName??null};}
 await fs.writeFile(path.join(directory,'public-certificates.json'),JSON.stringify({openssl,certificates},null,2));
 return {directory,ca:path.join(directory,'root-ca.pem'),certificates,openssl};
}
async function listenHigh(server){for(let attempt=0;attempt<12;attempt++){const port=randomInt(20000,60000);try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});return 'https://127.0.0.1:'+port;}catch(error){if(error.code!=='EADDRINUSE')throw error;}}throw Error('Unable to reserve an owned random high TLS port');}
async function closeServer(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
async function createTrustedHttpsFixture({directory,seed='minimal'}={}){
 if(directory)await fs.mkdir(path.resolve(directory),{recursive:true});
 const runDirectory=directory?await fs.mkdtemp(path.join(path.resolve(directory),'run-')):await fs.mkdtemp(path.join(os.tmpdir(),'shenyi-trusted-https-'));
 const certificate=await generateCertificates(path.join(runDirectory,'certificates'));
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs'),{startTeamServer}=await source('dev-server.mjs');
 const db=new DatabaseSync(path.join(runDirectory,'synthetic-team.sqlite'));initializeTeamDatabase(db);
 if(seed==='demo')await seedDemoTeamData(db);else{
  const passwordHash=await(await source('passwords.mjs')).hashPassword(PASSWORD);
  for(const [user,team,role]of [['intern-a','team-a','intern'],['intern-b','team-a','assistant'],['intern-foreign','team-b','intern']]){db.prepare("INSERT INTO team_users VALUES (?,'active')").run(user);db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(user,user,'Synthetic '+user,passwordHash);}
  for(const team of ['team-a','team-b']){db.prepare("INSERT INTO teams VALUES (?,'active')").run(team);db.prepare('INSERT INTO team_profiles VALUES (?,?)').run(team,'Synthetic '+team);db.prepare("INSERT INTO team_projects(team_id,project_id,title,status) VALUES (?,'project-a','Synthetic project','active')").run(team);}
  for(const [user,team,role]of [['intern-a','team-a','intern'],['intern-b','team-a','assistant'],['intern-foreign','team-b','intern']])db.prepare("INSERT INTO team_memberships VALUES (?,?,?,'active')").run(team,user,role);
  for(const [task,user]of [['task-a','intern-a'],['task-foreign','intern-b']]){db.prepare("INSERT INTO team_collection_tasks(team_id,task_id,project_id,title,instructions,status) VALUES ('team-a',?,'project-a',?,'Synthetic only','open')").run(task,'Synthetic '+task);db.prepare("INSERT INTO team_task_assignments VALUES ('team-a',?,?,'active')").run(task,user);}
 }
 const serverId=db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value;
 const service=await startTeamServer({db,port:0,identityProviders:{deviceProofRequired:true}});
 const state={offline:false,before:null,after:null},events=[],backendEvents=[],servers=[],pending=new Set();let counter=0,closed=false;
 service.server.on('request',(req,res)=>{const entry={method:req.method,route:req.url};res.on('finish',()=>backendEvents.push({...entry,status:res.statusCode}));});
 const gateway=async(req,res)=>{
  const body=Buffer.concat(await Array.fromAsync(req));const headers={...req.headers};
  const entry={method:req.method,route:req.url,hasAuthorization:!!headers.authorization,hasLease:!!headers['x-shenyi-device-lease'],hasSignature:!!headers['x-shenyi-device-signature'],hasNonce:!!headers['x-shenyi-device-nonce'],bodyBytes:body.length,bodySha256:hash(body),origin:headers.origin??null};events.push(entry);
  if(state.offline){req.socket.destroy();return;}
  let answer=await state.before?.(entry,{body,headers,req,res});
  if(answer===undefined){answer=await new Promise((resolve,reject)=>{const u=new URL(service.address.url),proxy=http.request({hostname:u.hostname,port:u.port,method:req.method,path:req.url,headers:{...headers,host:u.host}},upstream=>{const chunks=[];upstream.on('data',b=>chunks.push(b));upstream.on('end',()=>resolve({status:upstream.statusCode,headers:upstream.headers,body:Buffer.concat(chunks)}));upstream.on('error',reject);});proxy.on('error',reject);proxy.end(body);});}
  answer=await state.after?.(entry,answer)??answer;if(res.destroyed)return;
  entry.status=answer.status;res.writeHead(answer.status,answer.headers);
  if(answer.holdBody){res.flushHeaders();await answer.holdBody;if(res.destroyed)return;}
  res.end(req.method==='HEAD'?undefined:answer.body);
 };
 const make=async(name)=>{const server=https.createServer({key:await fs.readFile(path.join(certificate.directory,(name==='expired'?'valid':name)+'.key')),cert:await fs.readFile(path.join(certificate.directory,name+'.pem'))},(req,res)=>{const job=gateway(req,res).catch(error=>{if(!res.destroyed)res.destroy(error);}).finally(()=>pending.delete(job));pending.add(job);});servers.push(server);return listenHigh(server);};
 const apiBase=await make('valid'),wrongHostBase=await make('wrong-host'),expiredBase=await make('expired');
 const counterServer=https.createServer({key:await fs.readFile(path.join(certificate.directory,'valid.key')),cert:await fs.readFile(path.join(certificate.directory,'valid.pem'))},(req,res)=>{counter++;res.end('unexpected redirect target');});servers.push(counterServer);const counterBase=await listenHigh(counterServer);
 const profile=Object.freeze({schemaVersion:1,apiBase,serverId});
 return {runDirectory,certificate,profile,wrongHostBase,expiredBase,counterBase,state,events,backendEvents,db,service,get counter(){return counter;},async close(){if(closed)return;closed=true;await Promise.all(servers.map(closeServer));await service.close();await Promise.allSettled([...pending]);db.close();}};
}
// Child-only startup trust. Scenario source and every terminal result remain in
// the private fixture directory; stdout exposes no bearer, lease or private key.
async function runClientScenario(f,{code,profile=f.profile,trust=true,onStep,timeout=30000,name='scenario'}={}){
 const directory=await fs.mkdtemp(path.join(f.runDirectory,name+'-')),filename=path.join(directory,'client.cjs');
 const script=`'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),proof=require(${JSON.stringify(path.join(ROOT,'shared/device-proof.cjs'))}),{createTeamClient}=require(${JSON.stringify(path.join(ROOT,'desktop/team-client.cjs'))});
const profile=${JSON.stringify(profile)},PASSWORD=${JSON.stringify(PASSWORD)},hash=value=>crypto.createHash('sha256').update(value).digest('hex');
let sequence=0;const callbacks=new Map();process.on('message',m=>{const c=callbacks.get(m.id);if(c){callbacks.delete(m.id);m.error?c.reject(Error(m.error)):c.resolve(m.result);}});
const step=(action,data)=>new Promise((resolve,reject)=>{const id=++sequence;callbacks.set(id,{resolve,reject});process.send({id,action,data});});
function vault(){const pair=crypto.generateKeyPairSync('ed25519'),der=pair.publicKey.export({format:'der',type:'spki'});return {async getPublicIdentity(){return {publicKey:der.toString('base64url'),fingerprint:hash(der)};},async signChallenge(fields){return crypto.sign(null,proof.challengeBytes(fields),pair.privateKey).toString('base64url');},async signRequest(fields){return crypto.sign(null,proof.requestProofBytes(fields),pair.privateKey).toString('base64url');},dispose(){}};}
const clients=[],makeClient=(v=vault(),p=profile)=>{const c=createTeamClient({trustedService:p,deviceIdentity:{vault:v,platform:'win32',displayName:'Synthetic TLS computer'}});clients.push(c);return c;},client=makeClient();
const ready=async(c=client,user='intern-a')=>{const s=await c.login({username:user,password:PASSWORD});if(s.device.state==='enrollment_required')await c.enrollDevice({displayName:'Synthetic TLS computer',currentPassword:PASSWORD,confirmed:true});assert.equal((await c.getDeviceStatus()).state,'ready');return c;};
(async()=>{try{const result=await(async()=>{${code}\n})();console.log('__SHENYI_TLS_RESULT__'+JSON.stringify({ok:true,result}));}catch(error){console.log('__SHENYI_TLS_RESULT__'+JSON.stringify({ok:false,error:{name:error.name,message:error.message,code:error.code,stack:error.stack}}));process.exitCode=1;}finally{for(const c of clients)c.clearSession();process.disconnect?.();}})();
`;
 await fs.writeFile(filename,script);const env=childEnvironment({...trust?{NODE_EXTRA_CA_CERTS:f.certificate.ca}:{},TEMP:directory,TMP:directory,TMPDIR:directory});
 const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[filename],{env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe','ipc']});let stdout='',stderr='',stepError;
  const timer=setTimeout(()=>{child.kill();reject(Error('Owned TLS scenario timed out: '+filename));},timeout);
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);
  child.on('message',async message=>{try{const value=await onStep?.(message.action,message.data);if(child.connected)child.send({id:message.id,result:value});}catch(error){stepError=error;if(child.connected)child.send({id:message.id,error:error.message});}});
  child.on('close',(exitCode,signal)=>{clearTimeout(timer);const line=stdout.split(/\r?\n/).find(v=>v.startsWith('__SHENYI_TLS_RESULT__'));resolve({exitCode,signal,stdout,stderr,result:line?JSON.parse(line.slice('__SHENYI_TLS_RESULT__'.length)):null,stepError:stepError?.message??null});});
 });await fs.writeFile(path.join(directory,'terminal.json'),JSON.stringify(result,null,2));return {...result,directory};
}
module.exports={ROOT,PASSWORD,hash,deferred,childEnvironment,command,findOpenSSL,generateCertificates,createTrustedHttpsFixture,runClientScenario};
