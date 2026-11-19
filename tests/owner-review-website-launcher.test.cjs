'use strict';
// Real native Node TLS on owned loopback servers. No Electron executable, browser,
// OS certificate installation, external network, or existing review run is used.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),https=require('node:https');
const {execFile}=require('node:child_process'),{X509Certificate,createPrivateKey,createHash,randomBytes}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite'),{pathToFileURL}=require('node:url');
const {OWNER_REVIEW_RUNTIME_MARKER}=require('../desktop/isolated-preview-config.cjs');
const ROOT=path.resolve(__dirname,'..'),DAY=86400000;
const BASE=process.platform==='win32'?'D:/codex-temp/shenyi-m5-split-checkout-20261120/test-temp':path.join(os.tmpdir(),'shenyi-owner-website-tests');
const WINDOWS={skip:process.platform!=='win32'||process.arch!=='x64'};
const moduleAt=name=>import(pathToFileURL(path.join(ROOT,'scripts',name)).href);
const digest=value=>createHash('sha256').update(value).digest('hex');

function nodes(bytes){
 const result=[];let offset=0;
 while(offset<bytes.length){
  const tag=bytes[offset++];assert.ok(offset<bytes.length);let length=bytes[offset++];
  if(length&128){const count=length&127;assert.ok(count>0&&count<=4&&offset+count<=bytes.length);length=0;for(let i=0;i<count;i++)length=length*256+bytes[offset++];}
  assert.ok(offset+length<=bytes.length);result.push({tag,value:bytes.subarray(offset,offset+length)});offset+=length;
 }
 assert.equal(offset,bytes.length);return result;
}
function extensions(cert){
 const certificate=nodes(cert.raw);assert.equal(certificate.length,1);assert.equal(certificate[0].tag,0x30);
 const tbs=nodes(certificate[0].value)[0],extensionContainer=nodes(tbs.value).find(node=>node.tag===0xa3);assert.ok(extensionContainer);
 const list=nodes(nodes(extensionContainer.value)[0].value),result=new Map();
 for(const item of list){const values=nodes(item.value);assert.equal(values[0].tag,6);assert.equal(values.at(-1).tag,4);result.set(values[0].value.toString('hex'),values.at(-1).value);}
 return result;
}
function request(url,{ca,method='GET',headers={},body,servername}={}){
 return new Promise((resolve,reject)=>{
  const req=https.request(url,{ca,method,headers,agent:false,...(servername!==undefined?{servername}:{})},response=>{
   const chunks=[],authorized=response.socket.authorized,peer=response.socket.getPeerCertificate();
   response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);
   response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,bytes:Buffer.concat(chunks),authorized,fingerprint:peer.fingerprint256}));
  });
  req.setTimeout(5000,()=>req.destroy(new Error('Owned HTTPS request timed out')));req.on('error',reject);req.end(body);
 });
}
async function tlsMaterial(certificateFile,caFile){
 const [certPem,ca]=await Promise.all([fs.readFile(certificateFile,'utf8'),fs.readFile(caFile,'utf8')]);
 assert.doesNotMatch(certPem,/PRIVATE KEY/);assert.doesNotMatch(ca,/PRIVATE KEY/);
 const cert=new X509Certificate(certPem),root=new X509Certificate(ca);
 assert.equal(cert.verify(root.publicKey),true);
 return {ca,cert,root,fingerprint:cert.fingerprint256};
}
function assertBrowserResponse(response){
 assert.equal(response.headers['x-shenyi-server-id'],undefined);
 assert.equal(response.headers['access-control-allow-origin'],undefined);
 assert.equal(response.headers['access-control-allow-credentials'],undefined);
}
async function previewFixture(t){
 const [{createOwnerReviewCheckoutCertificate},{startWebsiteCheckoutPreview},{initializeTeamDatabase}]=await Promise.all([
  moduleAt('owner-review-checkout-certificate.mjs'),moduleAt('website-checkout-preview.mjs'),import('../server/team/database.mjs'),
 ]);
 const db=new DatabaseSync(':memory:');
 let run;
 t.after(async()=>{try{await run?.close();}finally{db.close();}});
 initializeTeamDatabase(db);
 db.prepare('INSERT INTO team_database_metadata VALUES (?,?)').run('website-checkout-demo','true');
 const api=createOwnerReviewCheckoutCertificate(),shop=createOwnerReviewCheckoutCertificate();
 const billingSimulation={mode:'simulation-v1',merchantId:'legacy-website-test',signingKey:randomBytes(32),
  offers:[{id:'annual-demo',revision:1,product:'team-annual-renewal',amountMinor:128000,currency:'CNY'}],annualSeatUnitAmountMinor:20000};
 const start=async overrides=>run=await startWebsiteCheckoutPreview({db,key:api.key,cert:api.cert,billingSimulation,...overrides});
 return {start,api,shop,db};
}
async function parentFixture(t){
 await fs.mkdir(BASE,{recursive:true});const parent=await fs.mkdtemp(path.join(await fs.realpath(BASE),"package ' space-")),runs=[];
 t.after(async()=>{const closed=await Promise.allSettled(runs.map(run=>run.close()));await fs.rm(parent,{recursive:true,force:true});for(const value of closed)assert.equal(value.status,'fulfilled');});
 const app=async(marker=OWNER_REVIEW_RUNTIME_MARKER)=>{
  const appRoot=await fs.mkdtemp(path.join(parent,'app-'));await fs.mkdir(path.join(appRoot,'runtime','electron'),{recursive:true});
  await fs.writeFile(path.join(appRoot,'runtime','electron','electron.exe'),'synthetic file; never executable by this test',{flag:'wx'});
  if(marker!==null)await fs.writeFile(path.join(appRoot,'owner-review-runtime.json'),marker,{flag:'wx'});return appRoot;
 };
 return {parent,runs,app};
}

test('review TLS chain has an eight-hour P-256 pathLen-zero CA and a signed server-only 127.0.0.1 leaf',async()=>{
 const {createOwnerReviewCheckoutCertificate}=await moduleAt('owner-review-checkout-certificate.mjs');
 const at=Math.floor(Date.now()/1000)*1000,a=createOwnerReviewCheckoutCertificate({now:()=>at}),b=createOwnerReviewCheckoutCertificate({now:()=>at});
 const cert=new X509Certificate(a.cert),ca=new X509Certificate(a.ca),privateKey=createPrivateKey(a.key);
 assert.equal(privateKey.asymmetricKeyType,'ec');assert.equal(privateKey.asymmetricKeyDetails.namedCurve,'prime256v1');
 assert.equal(cert.ca,false);assert.equal(ca.ca,true);assert.notEqual(cert.subject,cert.issuer);assert.equal(ca.subject,ca.issuer);
 assert.equal(ca.verify(ca.publicKey),true);assert.equal(cert.checkIssued(ca),true);assert.equal(cert.verify(ca.publicKey),true);
 assert.equal(cert.verify(cert.publicKey),false);assert.equal(cert.checkPrivateKey(privateKey),true);assert.equal(ca.checkPrivateKey(privateKey),false);
 assert.equal(ca.publicKey.asymmetricKeyDetails.namedCurve,'prime256v1');
 assert.equal(cert.checkIP('127.0.0.1'),'127.0.0.1');assert.equal(cert.checkIP('127.0.0.2'),undefined);assert.equal(cert.checkHost('localhost'),undefined);
 assert.equal(Date.parse(cert.validFrom),at-60000);assert.equal(Date.parse(cert.validTo),at+8*60*60000);assert.equal(a.expiresAt,Date.parse(cert.validTo));
 assert.equal(ca.validFrom,cert.validFrom);assert.equal(ca.validTo,cert.validTo);assert.notEqual(a.ca,b.ca);
 assert.equal(a.fingerprint256,cert.fingerprint256);assert.notEqual(a.fingerprint256,b.fingerprint256);
 const ext=extensions(cert);assert.deepEqual(nodes(ext.get('551d0f')),[{tag:3,value:Buffer.from([7,0x80])}]);
 assert.deepEqual(nodes(nodes(ext.get('551d25'))[0].value),[{tag:6,value:Buffer.from('2b06010505070301','hex')}]);
 assert.deepEqual(nodes(nodes(ext.get('551d11'))[0].value),[{tag:0x87,value:Buffer.from([127,0,0,1])}]);
 const rootExt=extensions(ca);
 assert.deepEqual(nodes(nodes(rootExt.get('551d13'))[0].value),[{tag:1,value:Buffer.from([0xff])},{tag:2,value:Buffer.from([0])}]);
 assert.deepEqual(nodes(rootExt.get('551d0f')),[{tag:3,value:Buffer.from([2,0x04])}]);
 assert.equal(rootExt.has('551d25'),false);assert.equal(rootExt.has('551d11'),false);
 assert.throws(()=>createOwnerReviewCheckoutCertificate({now:()=>NaN}));
});

test('portable factory isolates API and storefront TLS identities, routes, and shutdown per run',WINDOWS,async t=>{
 const f=await parentFixture(t),{createOwnerReviewWebsiteCheckout}=await moduleAt('team-website-checkout-owner-review.mjs');
 const at=Date.now(),appRoot=await f.app(),a=await createOwnerReviewWebsiteCheckout({appRoot,now:()=>at});f.runs.push(a);
 const b=await createOwnerReviewWebsiteCheckout({appRoot,now:()=>at});f.runs.push(b);
 assert.notEqual(a.candidateId,b.candidateId);assert.notEqual(a.profile.serverId,b.profile.serverId);
 assert.notEqual(a.desktopDataDirectory,b.desktopDataDirectory);assert.notEqual(a.deviceVaultDirectory,b.deviceVaultDirectory);
 assert.equal(new Set([a.address,a.checkoutAddress,b.address,b.checkoutAddress].map(address=>address.port)).size,4);
 const [apiA,shopA,apiB,shopB]=await Promise.all([
  tlsMaterial(a.certificateFile,a.caFile),tlsMaterial(a.storefrontCertificateFile,a.storefrontCaFile),
  tlsMaterial(b.certificateFile,b.caFile),tlsMaterial(b.storefrontCertificateFile,b.storefrontCaFile),
 ]);
 const identities=[apiA,shopA,apiB,shopB];
 assert.equal(new Set(identities.map(identity=>identity.fingerprint)).size,4);
 assert.equal(new Set(identities.map(identity=>identity.root.fingerprint256)).size,4);
 for(const leaf of identities)for(const issuer of identities)assert.equal(leaf.cert.verify(issuer.root.publicKey),leaf===issuer);
 const databaseBefore=new Map();
 for(const [run,api,shop] of [[a,apiA,shopA],[b,apiB,shopB]]){
  for(const address of [run.address,run.checkoutAddress]){
   assert.equal(address.host,'127.0.0.1');assert.equal(address.url,`https://127.0.0.1:${address.port}`);
   assert.ok(address.port>0&&address.port<=65535);assert.equal([8773,8774,10139].includes(address.port),false);
  }
  assert.equal(path.dirname(run.directory),path.join(appRoot,'review-runs'));assert.equal(path.basename(run.directory),'candidate-'+run.candidateId);
  assert.deepEqual(Object.keys(run.profile).sort(),['apiBase','checkoutOrigin','schemaVersion','serverId']);assert.equal(run.profile.schemaVersion,3);
  assert.equal(run.profile.apiBase,run.address.url);assert.equal(run.profile.checkoutOrigin,run.checkoutAddress.url);
  for(const [file,name] of [[run.configFile,'checkout-service.json'],[run.certificateFile,'checkout-tls.pem'],
    [run.caFile,'checkout-ca.pem'],[run.storefrontCertificateFile,'storefront-tls.pem'],[run.storefrontCaFile,'storefront-ca.pem']]){
   assert.equal(file,path.join(run.directory,name));
  }
  assert.deepEqual(JSON.parse(await fs.readFile(run.configFile,'utf8')),run.profile);
  const started=JSON.parse(await fs.readFile(path.join(run.directory,'started.json'),'utf8'));
  assert.equal(started.candidateId,run.candidateId);assert.equal(started.launcherPid,process.pid);
  assert.equal(started.apiBase,run.address.url);assert.equal(started.checkoutOrigin,run.checkoutAddress.url);
  assert.equal(started.tlsFingerprint256,api.fingerprint);assert.equal(started.checkoutTlsFingerprint256,shop.fingerprint);
  const dbFile=path.join(run.directory,'team-demo.sqlite'),db=new DatabaseSync(dbFile,{readOnly:true});
  try{
   assert.equal(db.prepare("SELECT value FROM team_database_metadata WHERE name='website-checkout-demo'").get().value,'true');
   assert.equal(db.prepare("SELECT COUNT(*) AS n FROM team_operators WHERE user_id='billing-admin-demo' AND team_id='team-a' AND status='active'").get().n,1);
   assert.equal(db.prepare("SELECT COUNT(*) AS n FROM team_memberships WHERE user_id='billing-admin-demo'").get().n,0);
   const term=db.prepare("SELECT starts_at,ends_at FROM team_subscription_events WHERE team_id='team-a'").get();assert.equal(term.starts_at,at-DAY);assert.ok([365*DAY,366*DAY].includes((term.ends_at-at)*2));
   assert.equal(db.prepare("SELECT seats FROM team_seat_capacity_grants WHERE team_id='team-a'").get().seats,8);
   for(const table of ['team_annual_orders','team_seat_orders','team_annual_verified_payments','team_seat_verified_payments'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
  }finally{db.close();}
  databaseBefore.set(run.directory,digest(await fs.readFile(dbFile)));
 }
 const apiOrigin=a.address.url,shopOrigin=a.checkoutAddress.url,methodsPath='/api/auth/methods';
 const methods=await request(apiOrigin+methodsPath,{ca:apiA.ca});
 assert.equal(methods.status,200);assert.equal(methods.authorized,true);assert.equal(methods.fingerprint,apiA.fingerprint);
 assert.equal(methods.headers['x-shenyi-server-id'],a.profile.serverId);
 const body=JSON.parse(methods.bytes);assert.equal(body.mode,'local-preview');assert.equal(body.deviceBinding.required,true);assert.equal(body.deviceBinding.serverId,a.profile.serverId);
 assert.equal(body.methods.phoneVerification,false);
 for(const [origin,route,identity,otherOrigin,wrongIdentities] of [
  [apiOrigin,methodsPath,apiA,shopOrigin,[shopA,apiB,shopB]],
  [shopOrigin,'/checkout/',shopA,apiOrigin,[apiA,apiB,shopB]],
 ]){
  for(const ca of [undefined,...wrongIdentities.map(wrong=>wrong.ca)]){
   await assert.rejects(request(origin+route,{ca}),e=>/^(DEPTH_|CERT_|UNABLE_|SELF_SIGNED_|ERR_TLS_)/.test(e.code));
  }
  await assert.rejects(request(origin+route,{ca:identity.ca,servername:'localhost'}),{code:'ERR_TLS_CERT_ALTNAME_INVALID'});
  for(const Host of ['untrusted.invalid',new URL(otherOrigin).host]){
   const response=await request(origin+route,{ca:identity.ca,servername:'',headers:{Host}});
   assert.equal(response.authorized,true);assert.equal(response.fingerprint,identity.fingerprint);assert.equal(response.status,403);
   assert.equal(JSON.parse(response.bytes).error.code,'HOST_DENIED');
  }
 }
 for(const route of ['/','/checkout/','/checkout/seats/','/assets/brand-shenyi.png']){
  const response=await request(shopOrigin+route,{ca:shopA.ca});assert.equal(response.status,200);
  assert.equal(response.authorized,true);assert.equal(response.fingerprint,shopA.fingerprint);assertBrowserResponse(response);
  assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['referrer-policy'],'no-referrer');
  assert.match(response.headers['content-security-policy'],/connect-src 'self'/);
  const apiResponse=await request(apiOrigin+route,{ca:apiA.ca});assert.equal(apiResponse.status,404);assert.equal(apiResponse.bytes.length,0);
 }
 const contextPaths=['/api/website-checkout/context','/api/website-checkout/seat-context'];
 for(const route of contextPaths){
  const post=(origin,headers={})=>({method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify({handoff:'a'.repeat(43)})});
  for(const origin of [apiOrigin,shopOrigin]){
   const response=await request(apiOrigin+route,{ca:apiA.ca,...post(origin)});
   assert.equal(response.status,404);assert.equal(response.bytes.length,0);assert.equal(response.headers['cache-control'],'no-store');
  }
  const response=await request(shopOrigin+route,{ca:shopA.ca,...post(shopOrigin)});
  assert.equal(response.status,403);assert.equal(JSON.parse(response.bytes).error.code,'WEBSITE_HANDOFF_UNAVAILABLE');assertBrowserResponse(response);
  const wrongOrigin=await request(shopOrigin+route,{ca:shopA.ca,...post(apiOrigin)});
  assert.equal(wrongOrigin.status,403);assert.equal(JSON.parse(wrongOrigin.bytes).error.code,'WEBSITE_ORIGIN_REQUIRED');assertBrowserResponse(wrongOrigin);
  for(const header of [{Authorization:'Bearer synthetic'},{Cookie:'test=synthetic'},{'X-Shenyi-Device-Id':'synthetic'}]){
   const credentialDenied=await request(shopOrigin+route,{ca:shopA.ca,...post(shopOrigin,header)});
   assert.equal(credentialDenied.status,403);assert.equal(credentialDenied.bytes.length,0);assertBrowserResponse(credentialDenied);
  }
  const preflight=await request(shopOrigin+route,{ca:shopA.ca,method:'OPTIONS',headers:{Origin:apiOrigin,'Access-Control-Request-Method':'POST'}});
  assert.equal(preflight.status,405);assertBrowserResponse(preflight);
 }
 for(const [method,route] of [['GET',methodsPath],['POST','/api/auth/login'],['GET','/api/teams/team-a/billing/overview'],
   ['POST','/api/teams/team-a/billing/website-handoff'],['POST','/api/teams/team-a/billing/website-seat-handoff']]){
  const response=await request(shopOrigin+route,{ca:shopA.ca,method,headers:{Origin:apiOrigin}});
  assert.equal(response.status,404);assert.equal(response.bytes.length,0);assertBrowserResponse(response);
 }
 for(const [origin,identity] of [[apiOrigin,apiA],[shopOrigin,shopA]]){
  for(const route of ['/checkout-service.json','/checkout-tls.pem','/checkout-ca.pem','/storefront-tls.pem','/storefront-ca.pem','/team-demo.sqlite','/started.json']){
   assert.equal((await request(origin+route,{ca:identity.ca})).status,404);
  }
  for(const suffix of ['notifications','payment-exceptions','order-closures']){
   assert.equal((await request(origin+'/api/billing/simulation/'+suffix,{ca:identity.ca,method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
  }
 }
 assert.equal(digest(await fs.readFile(path.join(a.directory,'team-demo.sqlite'))),databaseBefore.get(a.directory));
 await a.close();await a.close();assert.equal(a.server.listening,false);assert.equal(b.server.listening,true);
 assert.equal(JSON.parse(await fs.readFile(path.join(a.directory,'closed.json'),'utf8')).candidateId,a.candidateId);
 await assert.rejects(request(apiOrigin+methodsPath,{ca:apiA.ca}),{code:'ECONNREFUSED'});
 await assert.rejects(request(shopOrigin+'/checkout/',{ca:shopA.ca}),{code:'ECONNREFUSED'});
 const otherMethods=await request(b.address.url+methodsPath,{ca:apiB.ca}),otherShop=await request(b.checkoutAddress.url+'/checkout/',{ca:shopB.ca});
 assert.equal(otherMethods.status,200);assert.equal(otherMethods.fingerprint,apiB.fingerprint);
 assert.equal(otherShop.status,200);assert.equal(otherShop.fingerprint,shopB.fingerprint);
 for(const run of [a,b])assert.equal(digest(await fs.readFile(path.join(run.directory,'team-demo.sqlite'))),databaseBefore.get(run.directory));
});

test('the preview helper still serves its single-origin synthetic fixture when checkout TLS is omitted',async t=>{
 const {start,api}=await previewFixture(t),run=await start();
 assert.equal(run.checkoutAddress,undefined);
 assert.equal(run.profile.apiBase,run.address.url);assert.equal(run.profile.checkoutOrigin,run.address.url);
 for(const route of ['/api/auth/methods','/checkout/','/checkout/seats/']){
  const response=await request(run.address.url+route,{ca:api.ca});
  assert.equal(response.status,200);assert.equal(response.authorized,true);assert.equal(response.fingerprint,api.fingerprint256);
 }
});

test('preview startup validates identity and rolls back a partially started split listener',async t=>{
 const {start,api,shop,db}=await previewFixture(t),listening=[];
 const nativeListen=https.Server.prototype.listen;
 const observe=t.mock.method(https.Server.prototype,'listen',function(...args){
  this.once('listening',()=>listening.push({server:this,...this.address()}));
  return nativeListen.apply(this,args);
 });
 try{
  await assert.rejects(start({checkoutTLS:api}),/Separate checkout TLS credentials/);
  assert.equal(listening.length,0);
  await assert.rejects(start({checkoutTLS:shop,key:shop.key}),{code:'ERR_OSSL_X509_KEY_VALUES_MISMATCH'});
  assert.equal(listening.length,1);
  const [{address,port}]=listening;
  assert.equal(address,'127.0.0.1');
  await assert.rejects(request(`https://${address}:${port}/checkout/`,{ca:shop.ca}),{code:'ECONNREFUSED'});
  db.prepare('UPDATE team_database_metadata SET value=? WHERE name=?').run('invalid-test-identity','device-server-id');
  await assert.rejects(start(),/Invalid device server identity/);
  assert.equal(listening.length,1,'a rejected legacy startup must never bind a port');
 }finally{
  observe.mock.restore();
  for(const {server} of listening)if(server.listening)await new Promise(resolve=>server.close(resolve));
 }
});

test('portable website service rejects absent or malformed runtime markers before creating a review run',WINDOWS,async t=>{
 const f=await parentFixture(t),{createOwnerReviewWebsiteCheckout}=await moduleAt('team-website-checkout-owner-review.mjs');
 for(const marker of [null,OWNER_REVIEW_RUNTIME_MARKER.trimEnd()]){
  const appRoot=await f.app(marker);await assert.rejects(createOwnerReviewWebsiteCheckout({appRoot}));
  await assert.rejects(fs.stat(path.join(appRoot,'review-runs')),{code:'ENOENT'});
 }
});

test('website one-click CLI rejects caller addresses or directories before any application launch',WINDOWS,async t=>{
 const f=await parentFixture(t),appRoot=await f.app(),launcher=path.join(ROOT,'scripts/team-website-checkout-owner-review.mjs');
 const original=await fs.readdir(appRoot);
 for(const args of [['--api-base','https://127.0.0.1:14443'],['--directory',path.join(appRoot,'caller-directory')]]){
  const result=await new Promise(resolve=>execFile(process.execPath,['--disable-warning=ExperimentalWarning',launcher,...args],{cwd:appRoot,windowsHide:true,timeout:15000,maxBuffer:65536},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
  assert.equal(result.error?.code,1);assert.equal(result.error?.signal??null,null);assert.equal(result.stdout,'');assert.match(result.stderr,/不接收参数/);
  assert.deepEqual(await fs.readdir(appRoot),original);await assert.rejects(fs.stat(path.join(appRoot,'review-runs')),{code:'ENOENT'});
 }
});

test('failed isolated startup retains only a fixed failure receipt and never a started service',WINDOWS,async t=>{
 const f=await parentFixture(t),appRoot=await f.app(),{createOwnerReviewWebsiteCheckout}=await moduleAt('team-website-checkout-owner-review.mjs');
 await assert.rejects(createOwnerReviewWebsiteCheckout({appRoot,now:()=>NaN}));
 const root=path.join(appRoot,'review-runs'),names=(await fs.readdir(root)).filter(name=>name.startsWith('candidate-'));assert.equal(names.length,1);
 const directory=path.join(root,names[0]),receipt=JSON.parse(await fs.readFile(path.join(directory,'startup-failed.json'),'utf8'));
 assert.deepEqual(Object.keys(receipt).sort(),['candidateId','code','failedAt','schemaVersion']);assert.equal(receipt.code,'CHECKOUT_STARTUP_FAILED');
 assert.equal(receipt.candidateId,names[0].slice('candidate-'.length));await assert.rejects(fs.stat(path.join(directory,'started.json')),{code:'ENOENT'});
 assert.equal(JSON.stringify(receipt).includes('PRIVATE KEY'),false);
});
