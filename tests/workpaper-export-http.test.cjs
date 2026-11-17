const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {fixture,route,request,unpack,source,restorePasswordWork}=require('./helpers/workpaper-export-fixture.cjs');
after(restorePasswordWork);
test('real loopback HTTP transfers the signed ZIP with length/SHA/CRC without server arrayBuffer buffering',async t=>{
 const f=await fixture(t),{startTeamServer}=await source('dev-server.mjs'),server=await startTeamServer({db:f.db,port:0,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true}});t.after(()=>server.close());
 const original=Response.prototype.arrayBuffer;let intercepted=0;Response.prototype.arrayBuffer=function(...args){if(this.type==='default'&&this.headers.has('X-Shenyi-Workpaper-Export-Sha256')){intercepted++;throw Error('server must stream');}return original.apply(this,args);};t.after(()=>{Response.prototype.arrayBuffer=original;});
 const path=route(f),raw=f.makeRequest(path,{session:f.actor}),response=await fetch(server.address.url+path,{headers:raw.headers});const out=await unpack(response);assert.equal(out.manifest.scope.projectId,f.projectId);assert.equal(intercepted,0);assert.equal(response.headers.get('X-Shenyi-Server-Id'),f.actor.lease.serverId);Response.prototype.arrayBuffer=original;await unpack(await request(f));
});
test('real TCP disconnect stops a multi-megabyte ZIP and releases its large permit',async t=>{
 const f=await fixture(t,{extraOriginalBytes:6*1024*1024}),{startTeamServer}=await source('dev-server.mjs'),server=await startTeamServer({db:f.db,port:0,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true}});t.after(()=>server.close());const path=route(f),raw=f.makeRequest(path,{session:f.actor}),response=await fetch(server.address.url+path,{headers:raw.headers});assert.equal(response.status,200);const reader=response.body.getReader(),first=await reader.read();assert.ok(first.value.length<Number(response.headers.get('Content-Length')));await reader.cancel();
 let released=false;for(let i=0;i<30;i++){const next=await request(f);if(next.status===200){await next.body.cancel();released=true;break;}assert.equal(next.status,429);await next.arrayBuffer();await new Promise(resolve=>setTimeout(resolve,50));}assert.equal(released,true);
});
