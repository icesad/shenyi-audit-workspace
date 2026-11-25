'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto'),{DatabaseSync}=require('node:sqlite'),{pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'..'),source=name=>import(pathToFileURL(path.join(ROOT,'server/team',name)).href);
const BASE=process.env.SHENYI_HTTP_EARLY_RESPONSE_EVIDENCE_DIR||(path.join(os.tmpdir(),'shenyi-team-http-early-response'));
async function fixture(t,name){
 const directory=path.join(BASE,name+'-'+randomUUID());await fs.mkdir(directory,{recursive:true});
 const db=new DatabaseSync(':memory:'),agent=new http.Agent({keepAlive:true,maxSockets:1,maxFreeSockets:1}),requests=new Set(),events=[];let service,closing;
 const close=()=>closing??=(async()=>{for(const request of requests)request.destroy();agent.destroy();service?.server.closeAllConnections();if(service)await service.close();db.close();await fs.writeFile(path.join(directory,'cleanup.json'),JSON.stringify({serverClosed:!service?.server.listening,dbClosed:true,requestsDestroyed:[...requests].every(r=>r.destroyed),onlyOwnedSyntheticResources:true,events},null,2)+'\n',{flag:'wx'});})();
 t.after(close);
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');initializeTeamDatabase(db);await seedDemoTeamData(db);const {startTeamServer}=await source('dev-server.mjs');service=await startTeamServer({db,port:0,identityProviders:{deviceProofRequired:true}});
 service.server.on('request',(incoming,outgoing)=>{const item={method:incoming.method,route:incoming.url,completeAtRequest:incoming.complete};events.push(item);outgoing.once('finish',()=>Object.assign(item,{status:outgoing.statusCode,completeAtResponseFinish:incoming.complete}));});
 return{directory,db,agent,events,requests,address:service.address,service,close};
}
function request(f,{method='GET',route='/health',headers={},body,partial=false}={}){
 return new Promise((resolve,reject)=>{let settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const req=http.request({host:'127.0.0.1',port:f.address.port,path:route,method,headers,agent:f.agent},res=>{const chunks=[];res.on('data',part=>chunks.push(part));res.once('error',error=>finish(error));res.once('end',()=>finish(null,{status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks),socket:req.socket,requestEnded:req.writableEnded,responseComplete:res.complete}));});
  f.requests.add(req);req.once('error',error=>finish(error));const timer=setTimeout(()=>{req.destroy();finish(Error('Owned early-response HTTP request timed out'));},5000);
  if(partial){req.write(body);req.flushHeaders();}else req.end(body);
 });
}
for(const framing of ['content-length','chunked'])test('incomplete '+framing+' request receives early denial with Connection close', {timeout:20000},async t=>{
 const f=await fixture(t,framing),headers={Origin:'https://foreign.example.invalid','Content-Type':'application/json',...(framing==='content-length'?{'Content-Length':1048576}:{'Transfer-Encoding':'chunked'})};
 const result=await request(f,{method:'POST',route:'/api/auth/login',headers,body:Buffer.from('{"username":"intern-a",'),partial:true});
 await fs.writeFile(path.join(f.directory,'observation.json'),JSON.stringify({status:result.status,headers:result.headers,requestEnded:result.requestEnded,responseComplete:result.responseComplete,declaredBodyBytes:framing==='content-length'?1048576:null,partialBodyBytes:23,noRequestEndSent:true},null,2)+'\n',{flag:'wx'});
 assert.equal(result.status,403);assert.equal(JSON.parse(result.body).error.code,'CROSS_SITE_DENIED');assert.equal(result.requestEnded,false);assert.equal(result.responseComplete,true);assert.equal(result.headers.connection,'close','an incomplete early-denied body must not leave this HTTP connection reusable');
});
test('complete login and two synchronous health responses preserve keep-alive and the same socket', {timeout:20000},async t=>{
 const f=await fixture(t,'complete'),body=Buffer.from(JSON.stringify({username:'intern-a',password:'ShenyiDemo!2026'}));
 const login=await request(f,{method:'POST',route:'/api/auth/login',headers:{Origin:'shenyi://app','Content-Type':'application/json','Content-Length':body.length},body});
 assert.equal(login.status,200);const value=JSON.parse(login.body);assert.equal(value.account.id,'intern-a');assert.equal(typeof value.token,'string');assert.equal(login.requestEnded,true);assert.equal(login.headers.connection,'keep-alive');
 const first=await request(f),second=await request(f);for(const response of [first,second]){assert.equal(response.status,200);assert.equal(response.headers.connection,'keep-alive');assert.equal(JSON.parse(response.body).status,'ok');assert.equal(response.requestEnded,true);assert.equal(response.responseComplete,true);assert.equal(response.socket,login.socket,'all complete responses must reuse the one owned Agent socket');}
 await fs.writeFile(path.join(f.directory,'observation.json'),JSON.stringify({loginStatus:login.status,healthStatuses:[first.status,second.status],connectionHeaders:[login.headers.connection,first.headers.connection,second.headers.connection],sameSocketForAllThree:true,loginResponseTokenPersisted:false},null,2)+'\n',{flag:'wx'});
});
test('native fetch receives the early denial for a fully sent large body without a socket reset', {timeout:20000},async t=>{
 const f=await fixture(t,'native-fetch-large'),body='x'.repeat(1398400);
 const response=await fetch(f.address.url+'/api/auth/login',{method:'POST',headers:{Origin:'https://foreign.example.invalid','Content-Type':'application/json'},body,signal:AbortSignal.timeout(5000)});
 assert.equal(response.status,403);assert.equal(response.url,f.address.url+'/api/auth/login');assert.equal(response.headers.get('X-Shenyi-Server-Id'),f.db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value);
 assert.equal((await response.json()).error.code,'CROSS_SITE_DENIED');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_sessions').get().n,0);
 const health=await fetch(f.address.url+'/health',{signal:AbortSignal.timeout(5000)});assert.equal(health.status,200);assert.equal((await health.json()).status,'ok');
 await fs.writeFile(path.join(f.directory,'observation.json'),JSON.stringify({nativeFetchUsed:true,fetchReplaced:false,requestBodyBytes:body.length,status:response.status,connection:response.headers.get('Connection'),responseUUIDPinned:true,subsequentHealthStatus:health.status,newSessions:0,bodyPersisted:false},null,2)+'\n',{flag:'wx'});
});
