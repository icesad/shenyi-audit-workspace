'use strict';
// Deterministic startup faults on real owned TLS/HTTP servers and SQLite.
// The harness also disposes leaked resources when exercising the old fixture.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const net=require('node:net'),https=require('node:https');
const {DatabaseSync}=require('node:sqlite');
const {EventEmitter}=require('node:events');
const {createTrustedHttpsFixture}=require('./helpers/trusted-team-https-fixture.cjs');
const {listenOnLoopback}=require('../server/team/team-http-listener.mjs');

async function ownedHarness(t,{tlsFaults=[],tlsIndex=1,permanent=false,synchronous=false,stage,cleanupFault=false}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'shenyi-tls-lifecycle-'));
 const marker=path.join(directory,'keep-parent.txt');await fs.writeFile(marker,'owned parent marker');
 const servers=new Set(),sockets=new Set(),databases=new Set(),closedDatabases=new Set(),tls=[],attempts=[],listenerCounts=[],initialListeners=new Map();
 const failure=Object.assign(new Error('synthetic setup failure'),{code:'EIO'});
 const cleanupFailure=Object.assign(new Error('synthetic close callback failure'),{code:'EIO'});
 const original={listen:net.Server.prototype.listen,close:net.Server.prototype.close,createServer:https.createServer,exec:DatabaseSync.prototype.exec,prepare:DatabaseSync.prototype.prepare,dbClose:DatabaseSync.prototype.close,mkdir:fs.mkdir};
 let injected=0;
 t.after(async()=>{
  for(const socket of sockets)socket.destroy();
  await Promise.all([...servers].map(server=>new Promise(resolve=>{
   original.close.call(server,()=>resolve());server.closeAllConnections?.();
  })));
  for(const db of databases){try{original.dbClose.call(db);}catch{}}
  await fs.rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 });
 t.mock.method(DatabaseSync.prototype,'prepare',function(...args){databases.add(this);return original.prepare.apply(this,args);});
 t.mock.method(DatabaseSync.prototype,'exec',function(...args){
  databases.add(this);if(stage==='database'&&injected++===0)throw failure;
  return original.exec.apply(this,args);
 });
 t.mock.method(DatabaseSync.prototype,'close',function(...args){const result=original.dbClose.apply(this,args);closedDatabases.add(this);return result;});
 t.mock.method(https,'createServer',function(...args){const server=original.createServer.apply(this,args);tls.push(server);initialListeners.set(server,{error:server.listeners('error'),listening:server.listeners('listening')});return server;});
 t.mock.method(net.Server.prototype,'listen',function(...args){
  if(!servers.has(this)){servers.add(this);this.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});}
  let error;
  if(stage==='backend'&&!(this instanceof https.Server))error=failure;
  const index=tls.indexOf(this)+1;
  if(index===tlsIndex&&tlsFaults.length){
   attempts.push(args[0]);const code=tlsFaults[Math.min(attempts.length-1,tlsFaults.length-1)];
   if(permanent||attempts.length<=tlsFaults.length)error=Object.assign(new Error('synthetic reserved candidate'),{code});
  }
  if(error){
   if(synchronous)throw error;
   // Native listen registers its callback even when the bind later fails.
   if(typeof args.at(-1)==='function')this.once('listening',args.at(-1));
   queueMicrotask(()=>{
    this.emit('error',error);const initial=initialListeners.get(this)??{error:[],listening:[]};
    listenerCounts.push({error:this.listeners('error').filter(listener=>!initial.error.includes(listener)).length,listening:this.listeners('listening').filter(listener=>!initial.listening.includes(listener)).length});
   });
   return this;
  }
  return original.listen.apply(this,args);
 });
 if(stage==='certificate')t.mock.method(fs,'mkdir',async function(name,...args){
  const result=await original.mkdir.call(this,name,...args);
  if(path.basename(name)==='certificates'){await fs.writeFile(path.join(name,'partial.key'),'synthetic partial key');throw failure;}
  return result;
 });
 if(cleanupFault)t.mock.method(net.Server.prototype,'close',function(callback){
  return original.close.call(this,error=>callback(this===tls[0]?cleanupFailure:error));
 });
 const assertDisposed=async()=>{
  assert.ok([...servers].every(server=>!server.listening),'every created listener must close after failed setup');
  assert.ok([...sockets].every(socket=>socket.destroyed),'every accepted socket must be destroyed');
  assert.ok([...databases].every(db=>closedDatabases.has(db)),'every initialized database must close after failed setup');
  assert.deepEqual(await fs.readdir(directory),['keep-parent.txt'],'remove the owned run directory, retain its parent');
  assert.equal(await fs.readFile(marker,'utf8'),'owned parent marker');
 };
 return {directory,servers,sockets,databases,closedDatabases,tls,attempts,listenerCounts,initialListeners,failure,cleanupFailure,assertDisposed};
}

for(const code of ['EACCES','EADDRINUSE'])test('owned TLS startup retries temporary '+code+' without retaining attempt listeners',{timeout:30000},async t=>{
 const h=await ownedHarness(t,{tlsFaults:[code]});
 const f=await createTrustedHttpsFixture({directory:h.directory});
 assert.ok(h.attempts.length>=2&&h.attempts.length<=12,'temporary port errors may require additional retries, bounded by listenHigh');
 assert.ok(h.attempts.every(port=>Number.isInteger(port)&&port>=20000&&port<60000));
 assert.deepEqual(h.listenerCounts,[{error:0,listening:0}]);
 assert.equal(h.tls.length,4);assert.ok(h.tls.every(server=>server.listening));
 await f.close();await f.close();
 assert.ok([...h.servers].every(server=>!server.listening));
 assert.ok([...h.databases].every(db=>h.closedDatabases.has(db)));
 assert.ok((await fs.stat(f.runDirectory)).isDirectory(),'successful fixture close preserves requested evidence');
});

test('owned TLS retry exhaustion closes earlier TLS/backend listeners, SQLite and partial files',{timeout:30000},async t=>{
 const h=await ownedHarness(t,{tlsFaults:['EACCES'],tlsIndex:2,permanent:true});
 await assert.rejects(()=>createTrustedHttpsFixture({directory:h.directory}),error=>(error.cause??error).code==='EACCES');
 assert.equal(h.attempts.length,12,'automatic candidates have a finite retry budget');
 assert.ok(h.listenerCounts.every(count=>count.error===0&&count.listening===0));
 assert.equal(h.tls.length,2);assert.equal(h.databases.size,1);
 await h.assertDisposed();
});

for(const synchronous of [false,true])test('owned TLS '+(synchronous?'synchronous':'asynchronous')+' non-port failure is not retried and rolls setup back',{timeout:30000},async t=>{
 const h=await ownedHarness(t,{tlsFaults:['EIO'],tlsIndex:3,permanent:true,synchronous});
 await assert.rejects(()=>createTrustedHttpsFixture({directory:h.directory}),{code:'EIO'});
 assert.equal(h.attempts.length,1);assert.equal(h.tls.length,3);
 assert.deepEqual(h.tls[2].listeners('error'),h.initialListeners.get(h.tls[2]).error);
 assert.deepEqual(h.tls[2].listeners('listening'),h.initialListeners.get(h.tls[2]).listening);
 await h.assertDisposed();
});

for(const stage of ['certificate','database','backend'])test('owned TLS '+stage+' setup failure removes all resources already created',{timeout:30000},async t=>{
 const h=await ownedHarness(t,{stage});
 await assert.rejects(()=>createTrustedHttpsFixture({directory:h.directory}),error=>error===h.failure);
 assert.equal(h.databases.size,stage==='certificate'?0:1);
 await h.assertDisposed();
});

test('owned TLS setup cleanup continues after one listener reports a close error',{timeout:30000},async t=>{
 const h=await ownedHarness(t,{tlsFaults:['EIO'],tlsIndex:3,permanent:true,cleanupFault:true});
 await assert.rejects(()=>createTrustedHttpsFixture({directory:h.directory}),error=>error instanceof AggregateError&&error.errors.includes(h.cleanupFailure)&&error.cause.code==='EIO');
 await h.assertDisposed();
});

test('fixed-port permission errors and unrelated ephemeral errors remain failures',async()=>{
 class RefusedServer extends EventEmitter{
  attempts=0;
  constructor(code){super();this.code=code;}
  listen(){this.attempts++;queueMicrotask(()=>this.emit('error',Object.assign(new Error('synthetic refusal'),{code:this.code})));}
 }
 for(const [port,code]of [[45555,'EACCES'],[45555,'EADDRINUSE'],[0,'EIO']]){
  const server=new RefusedServer(code);await assert.rejects(()=>listenOnLoopback(server,port),{code});
  assert.equal(server.attempts,1);assert.equal(server.listenerCount('error'),0);assert.equal(server.listenerCount('listening'),0);
 }
});
