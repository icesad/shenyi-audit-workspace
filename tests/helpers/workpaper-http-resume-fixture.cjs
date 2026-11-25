'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createWorkpaperDataFixture,good,sha,source,PASSWORD,codec,restorePasswordWork}=require('./workpaper-data-fixture.cjs');
const {excel,zip}=require('./workpaper-office-fixture.cjs');
const {createTeamClient}=require('../../desktop/team-client.cjs'),proof=require('../../shared/device-proof.cjs');

// Synthetic setup may use the existing direct-app fixture. From client login
// onward, every tested request uses the unchanged real loopback HTTP listener.
async function fixture(t,{directory:parent}={}){
 let client,service,directory,closed=false;
 const state={calls:[],wire:[],before:null,after:null,dropCommitResponseOnce:false,closed:false},wireCloseEvents=new WeakMap();
 async function close(){
  if(closed)return;closed=true;client?.clearSession();
  if(service){await service.close();assert.equal(service.server.listening,false);}
  state.closed=true;
  if(directory)await fs.writeFile(path.join(directory,'http-cleanup.json'),JSON.stringify({serverClosed:!service?.server.listening,ownedAddress:service?.address.url??null,wireResponses:state.wire},null,2)+'\n');
 }
 // Register before the inherited fixture's db.close hook: HTTP must stop first.
 t.after(close);
 const f=await createWorkpaperDataFixture(t,{freeze:false});
 good(await f.wpGrant(f.user,{read:true,write:true,export:true}));
 directory=await fs.mkdtemp(path.join(parent??process.env.SHENYI_TEST_TMPDIR??os.tmpdir(),'shenyi-http-resume-'));
 const document=excel(),name='初步活动/有效原表.xlsx',raw=zip([{name,data:document.bytes}]);
 const archive={name:'合成有效原表原包.zip',hash:sha(raw),blob:new Blob([raw],{type:'application/zip'})};
 const index=[{name,path:name,sha256:document.sha256,size:document.bytes.length}];
 const record={...f.pack.record,archive,index,riskArchive:null,riskIndex:[],workpaperSources:{},answers:{[document.sha256]:{'原表':{A2:'saved valid original sheet answer'}}},docAnswers:{},workpaperLocks:{},supplementalWorkpapers:[]};
 const bytes=Buffer.from((await codec.create({record,readCurrent:async()=>record})).bytes),filename=path.join(directory,'synthetic-valid-workpapers.zip');
 await fs.writeFile(filename,bytes,{flag:'wx'});
 const {startTeamServer}=await source('dev-server.mjs');
 service=await startTeamServer({db:f.db,port:0,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true}});
 const serverId=f.db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value;
 service.server.on('request',(request,response)=>{
  // Observe metadata only. Never attach a second body reader to IncomingMessage.
  const entry={method:request.method,route:request.url,hasAuthorization:!!request.headers.authorization,hasLease:!!request.headers['x-shenyi-device-lease'],hasSignature:!!request.headers['x-shenyi-device-signature'],hasNonce:!!request.headers['x-shenyi-device-nonce'],localPort:request.socket.localPort,remoteAddress:request.socket.remoteAddress,finished:false,closed:false};state.wire.push(entry);
  response.once('finish',()=>{entry.finished=true;entry.status=response.statusCode;});
  wireCloseEvents.set(entry,new Promise(resolve=>response.once('close',()=>{entry.closed=true;resolve();})));
  const end=response.end;
  response.end=function(...args){
   if(state.dropCommitResponseOnce&&request.method==='POST'&&request.url.endsWith('/commit')){
    state.dropCommitResponseOnce=false;entry.responseDroppedAfterCommit=true;
    entry.headCountBeforeDrop=f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_heads').get().n;
    // The application has committed and called end, but the real socket closes
    // before its HTTP response is sent. No fetch stub or response fabrication.
    response.destroy();return response;
   }
   return end.apply(this,args);
  };
 });
 const pair=f.keys.get(f.user),realFetch=globalThis.fetch;
 client=createTeamClient({isolatedPreview:{schemaVersion:1,apiBase:service.address.url,serverId},now:()=>f.clock.value,deviceIdentity:{platform:'win32',displayName:'Synthetic HTTP workpaper computer',vault:{async getPublicIdentity(){return{publicKey:pair.encoded,fingerprint:sha(Buffer.from(pair.encoded,'base64url'))};},async signChallenge(fields){return crypto.sign(null,proof.challengeBytes(fields),pair.privateKey).toString('base64url');},async signRequest(fields){return crypto.sign(null,proof.requestProofBytes(fields),pair.privateKey).toString('base64url');}}},fetchImpl:async(url,settings)=>{
  assert.equal(new URL(url).origin,service.address.url,'all tested traffic targets only this owned listener');
  const parsed=new URL(url),headers=new Headers(settings?.headers),entry={method:settings?.method??'GET',path:parsed.pathname,route:parsed.pathname+parsed.search,origin:parsed.origin,hasAuthorization:headers.has('Authorization'),hasLease:headers.has('X-Shenyi-Device-Lease'),hasSignature:headers.has('X-Shenyi-Device-Signature'),hasNonce:headers.has('X-Shenyi-Device-Nonce')};state.calls.push(entry);
  await state.before?.(entry);
  try{entry.realFetchInvoked=true;const response=await realFetch(url,settings);Object.assign(entry,{status:response.status,responseURL:response.url,responseServerId:response.headers.get('X-Shenyi-Server-Id')});const answer=await state.after?.(entry,response);if(answer!==undefined&&answer!==response)entry.responseReplacedByHook=true;return answer??response;}
  catch(error){entry.networkError=error?.cause?.code??error?.name??'FETCH_FAILED';throw error;}
 }});
 await client.login({username:f.user,password:PASSWORD});assert.equal(client.getDeviceStatus().state,'ready');
 const target={teamId:'team-a',projectId:f.projectId},bucket='device-request:'+sha(f.user);
 const businessAttempts=()=>f.db.prepare('SELECT attempts FROM team_auth_limits WHERE bucket=?').get(bucket)?.attempts??0;
 const revisions=()=>({...target,projectRevision:f.dataRevision(),grantRevision:f.dataGrantRevision()});
 async function fillBusinessTo(n=117){assert.ok(Number.isInteger(n)&&n>=businessAttempts()&&n<=120);while(businessAttempts()<n)await client.getWorkpaperImportCapabilities(target);assert.equal(businessAttempts(),n);}
 async function waitForWireClose(entry){const event=wireCloseEvents.get(entry);assert.ok(event,'the observed response belongs to this fixture');let timer;try{await Promise.race([event,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned HTTP response did not close within 3 seconds')),3000);})]);}finally{clearTimeout(timer);}}
 async function recordEvidence(report){await fs.writeFile(path.join(directory,'http-evidence.json'),JSON.stringify({address:service.address.url,serverId,sourceSha256:sha(bytes),sourceBytes:bytes.length,networkListenerStarted:true,clientURLRewritten:false,fetchStubbed:false,responseReplacementHookUsed:state.calls.some(x=>x.responseReplacedByHook===true),nativePickerPathInjected:true,nativeOrTLSClaimed:false,...report,clientCalls:state.calls,wire:state.wire},null,2)+'\n');}
 return{...f,client,target,bytes,document,record,directory,filename,serverId,service,address:service.address.url,state,revisions,businessAttempts,fillBusinessTo,close,waitForWireClose,recordEvidence};
}
module.exports={fixture,PASSWORD,sha,restorePasswordWork};
