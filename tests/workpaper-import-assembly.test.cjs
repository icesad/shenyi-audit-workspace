'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {createWorkpaperDataFixture,good,sha,codec,restorePasswordWork}=require('./helpers/workpaper-data-fixture.cjs');
const CHUNK=1048576;
after(restorePasswordWork);

async function staged(t,{payloadBytes=2200000,reverse=false,omit=[],packageSha256}={}){
 const f=await createWorkpaperDataFixture(t),original=Buffer.alloc(payloadBytes,0x5a),digest=sha(original);
 f.pack.record.supplementalWorkpapers[0].file={name:'synthetic-assembly.bin',mime:'application/octet-stream',size:original.length,sha256:digest,blob:new Blob([original],{type:'application/octet-stream'})};
 const output=await codec.create({record:f.pack.record,readCurrent:async()=>f.pack.record}),bytes=Buffer.from(output.bytes),body=f.startBody({input:bytes,...(packageSha256?{packageSha256}:{})});
 assert.ok(bytes.length<=8*1024*1024,'probe package remains below 8MiB');good(await f.start(body),201);
 const indices=Array.from({length:body.chunkCount},(_,i)=>i);if(reverse)indices.reverse();
 for(const index of indices)if(!omit.includes(index))good(await f.put(body.requestId,index,bytes.subarray(index*CHUNK,(index+1)*CHUNK)));
 return{...f,bytes,body,original,digest};
}
const stage=f=>f.db.prepare('SELECT status,session_hash,lease_id FROM team_workpaper_data_imports WHERE request_id=?').get(f.body.requestId);
const chunkCount=f=>f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_chunks WHERE request_id=?').get(f.body.requestId).n;
function unpublished(f,blocks){assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_heads').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_versions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_originals').get().n,0);assert.equal(stage(f).status,'active');assert.equal(chunkCount(f),blocks);}
async function queryCancelAndReopen(f,{current=f.actor}={}){
 const query=good(await f.api(f.wpRoute()+'/imports/'+f.body.requestId,{session:current}));assert.equal(query.stage.status,'active');
 good(await f.api(f.wpRoute()+'/imports/'+f.body.requestId,{method:'DELETE',session:current}));assert.equal(stage(f).status,'canceled');assert.equal(chunkCount(f),0);
 // A validation failure must release both its SQLite cursor and data permit.
 const next=f.startBody({input:f.bytes});good(await f.start(next,{current}),201);good(await f.put(next.requestId,0,f.bytes.subarray(0,CHUNK),{current}));
 good(await f.api(f.wpRoute()+'/imports/'+next.requestId,{method:'DELETE',session:current}));
}

function boundedChunkResultBatches(db,maximum=CHUNK){
 const prepare=db.prepare,observed=[];
 // This is a resource boundary on SQLite -> JS result payload, not an SQL
 // method blacklist: get(), iterate(), and all() with a bounded result pass.
 db.prepare=function(sql,...args){const statement=prepare.call(this,sql,...args);if(!/\b(?:from|join)\s+["`\[]?team_workpaper_data_chunks\b/i.test(sql))return statement;
  const check=rows=>{const bytes=rows.reduce((n,row)=>n+(ArrayBuffer.isView(row?.bytes)?row.bytes.byteLength:0),0);observed.push(bytes);if(bytes>maximum)throw Error('Synthetic staging-row transfer budget exceeded');};
  return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
   if(key==='all')return(...values)=>{const rows=value.apply(target,values);check(rows);return rows;};
   if(key==='get')return(...values)=>{const row=value.apply(target,values);check(row?[row]:[]);return row;};
   if(key==='iterate')return function*(...values){for(const row of value.apply(target,values)){check([row]);yield row;}};
   return value.bind(target);
  }});
 };
 return{observed,restore(){db.prepare=prepare;}};
}

test('multi-block import respects a one-block SQLite result budget while preserving originals, saved entries and freeze',async t=>{
 const f=await staged(t,{payloadBytes:6*1024*1024,reverse:true}),before={...stage(f)},budget=boundedChunkResultBatches(f.db);
 let receipt;try{receipt=good(await f.commit(f.body.requestId),201).receipt;}finally{budget.restore();}
 assert.equal(receipt.sourcePackageSha256,sha(f.bytes));assert.ok(budget.observed.some(n=>n>0));assert.ok(Math.max(...budget.observed)<=CHUNK);
 assert.equal(stage(f).status,'published');assert.equal(stage(f).session_hash,before.session_hash);assert.equal(stage(f).lease_id,before.lease_id);assert.equal(chunkCount(f),0);
 const saved=good(await f.dataRecord());assert.equal(saved.id,f.sourceProjectId);assert.equal(saved.rev,f.pack.record.rev);assert.deepEqual(saved.answers,f.pack.record.answers);assert.deepEqual(saved.docAnswers,f.pack.record.docAnswers);assert.deepEqual(saved.workpaperLocks,f.pack.record.workpaperLocks);assert.equal(Object.keys(saved.workpaperLocks).length,1);
 const blob=await f.dataOriginal(f.digest);assert.equal(blob.status,200);assert.equal(blob.bytes.length,f.original.length);assert.equal(sha(blob.bytes),f.digest);
 const initial=await f.dataOriginal(f.pack.H);assert.equal(initial.status,200);assert.equal(sha(initial.bytes),sha(f.pack.raw));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_versions').get().n,1);
});

test('legitimate reverse-order arrival is assembled in canonical chunk order',async t=>{
 const f=await staged(t,{reverse:true});assert.ok(f.body.chunkCount>=3);good(await f.commit(f.body.requestId),201);assert.equal(stage(f).status,'published');assert.equal(chunkCount(f),0);assert.equal(good(await f.dataRecord()).id,f.sourceProjectId);
});

test('a missing middle chunk is rejected without publication and remains queryable/cancelable',async t=>{
 const f=await staged(t,{omit:[1]});assert.equal((await f.commit(f.body.requestId)).status,409);unpublished(f,f.body.chunkCount-1);await queryCancelAndReopen(f);
});

for(const corruption of ['extra','gap','length','digest'])test('corrupt staging '+corruption+' cannot publish and does not leak cursor or permit',async t=>{
 const f=await staged(t);assert.ok(f.body.chunkCount>=3);
 // Deliberately corrupt this private synthetic SQLite copy after successful
 // signed PUTs. The production immutable-stage guards remain unchanged.
 if(corruption==='extra'){
  f.db.exec('DROP TRIGGER workpaper_data_chunk_insert');const bytes=Buffer.alloc(CHUNK,0x41);f.db.prepare('INSERT INTO team_workpaper_data_chunks(request_id,chunk_index,sha256,bytes) VALUES (?,?,?,?)').run(f.body.requestId,f.body.chunkCount,sha(bytes),bytes);
 }else{
  f.db.exec('DROP TRIGGER workpaper_data_chunks_no_update');
  if(corruption==='gap')f.db.prepare('UPDATE team_workpaper_data_chunks SET chunk_index=? WHERE request_id=? AND chunk_index=1').run(f.body.chunkCount,f.body.requestId);
  if(corruption==='length')f.db.prepare('UPDATE team_workpaper_data_chunks SET bytes=? WHERE request_id=? AND chunk_index=1').run(Buffer.alloc(CHUNK-1,0x5a),f.body.requestId);
  if(corruption==='digest')f.db.prepare('UPDATE team_workpaper_data_chunks SET sha256=? WHERE request_id=? AND chunk_index=1').run('0'.repeat(64),f.body.requestId);
 }
 assert.equal((await f.commit(f.body.requestId)).status,409);unpublished(f,f.body.chunkCount+(corruption==='extra'?1:0));await queryCancelAndReopen(f);
});

test('a false whole-package hash is rejected after valid per-chunk hashes without deleting the stage',async t=>{
 const f=await staged(t,{packageSha256:'0'.repeat(64)});assert.equal((await f.commit(f.body.requestId)).status,400);unpublished(f,f.body.chunkCount);await queryCancelAndReopen(f);
});

test('an empty maximum-size reservation rejects missing chunks before any package-sized allocation',async t=>{
 const f=await createWorkpaperDataFixture(t),body=f.startBody({byteLength:codec.LIMITS.packageBytes,chunkCount:530});good(await f.start(body),201);
 const originals={alloc:Buffer.alloc,allocUnsafe:Buffer.allocUnsafe,allocUnsafeSlow:Buffer.allocUnsafeSlow,Uint8Array:globalThis.Uint8Array},large=[];
 const admitted=size=>{if(typeof size==='number'&&size>=16*1024*1024){large.push(size);throw Error('Synthetic unadmitted package allocation');}};
 for(const name of ['alloc','allocUnsafe','allocUnsafeSlow'])Buffer[name]=function(size,...args){admitted(size);return originals[name].call(this,size,...args);};
 globalThis.Uint8Array=new Proxy(originals.Uint8Array,{construct(target,args,newTarget){admitted(args[0]);return Reflect.construct(target,args,newTarget);}});
 let response;try{response=await f.commit(body.requestId);}finally{for(const name of ['alloc','allocUnsafe','allocUnsafeSlow'])Buffer[name]=originals[name];globalThis.Uint8Array=originals.Uint8Array;}
 assert.equal(response.status,409);assert.deepEqual(large,[]);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_heads').get().n,0);assert.equal(f.db.prepare('SELECT status FROM team_workpaper_data_imports WHERE request_id=?').get(body.requestId).status,'active');
});

test('a replacement session cannot resume the old stage lease or publish its bytes',async t=>{
 const f=await staged(t),bound={...stage(f)},replacement=await f.ready(f.user);
 assert.equal((await f.commit(f.body.requestId)).status,401);assert.equal((await f.commit(f.body.requestId,{current:replacement})).status,409);assert.deepEqual({...stage(f)},bound);unpublished(f,f.body.chunkCount);await queryCancelAndReopen(f,{current:replacement});
});


test('a corrupted length/count pair cannot validate synthesized zero padding as received bytes',async t=>{
 const f=await createWorkpaperDataFixture(t),first=Buffer.alloc(CHUNK,0x41),body=f.startBody({input:first});good(await f.start(body),201);good(await f.put(body.requestId,0,first));
 const padded=Buffer.alloc(CHUNK+1);first.copy(padded);
 f.db.exec('DROP TRIGGER workpaper_data_imports_context_immutable');f.db.prepare('UPDATE team_workpaper_data_imports SET byte_length=?,package_sha256=? WHERE request_id=?').run(padded.length,sha(padded),body.requestId);
 const response=await f.commit(body.requestId);assert.equal(response.status,400);assert.equal(response.data.error.code,'INVALID_INPUT','length inconsistency must reject before format inspection of synthetic padding');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_heads').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_versions').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_workpaper_data_chunks WHERE request_id=?').get(body.requestId).n,1);assert.equal(f.db.prepare('SELECT status FROM team_workpaper_data_imports WHERE request_id=?').get(body.requestId).status,'active');
 const current=good(await f.api(f.wpRoute()+'/imports/'+body.requestId,{session:f.actor}));assert.equal(current.stage.status,'active');good(await f.api(f.wpRoute()+'/imports/'+body.requestId,{method:'DELETE',session:f.actor}));
});
