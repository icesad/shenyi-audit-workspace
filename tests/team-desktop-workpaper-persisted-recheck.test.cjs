'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {inspectWorkpaperExportFile:inspect}=require('../desktop/workpaper-export-file.cjs');
const {make,opened,sha,unzip}=require('./helpers/workpaper-export-file-fixture.cjs');
const {fixture,restorePasswordWork}=require('./helpers/workpaper-desktop-root-fixture.cjs');
const {createWorkpaperExporter}=require('../desktop/workpaper-export.cjs');
after(restorePasswordWork);
const invalid={code:'WORKPAPER_EXPORT_FILE_INVALID'};
async function sameTimes(handle){const first=await handle.stat({bigint:true});return async(...args)=>{const s=await handle.stat(...args);return{...s,mtimeNs:first.mtimeNs,ctimeNs:first.ctimeNs,isFile:()=>s.isFile()};};}
for(const kind of ['local header','original body','central directory'])test('persisted byte identity rejects a late '+kind+' change with unchanged time stamps',async t=>{
 const f=await make(),{handle}=await opened(t,f.bytes),stat=await sameTimes(handle);let ends=0,changed=false;
 const offset=kind==='local header'?0:kind==='original body'?unzip(f.bytes).find(e=>e.name.startsWith('originals/')).dataOffset:f.bytes.readUInt32LE(f.bytes.length-6);
 const wrapped={stat,async read(...args){const value=await handle.read(...args);if(args[3]===f.bytes.length-22&&++ends===2){await handle.write(Buffer.from([f.bytes[offset]^1]),0,1,offset);await handle.sync();changed=true;}return value;}};
 await assert.rejects(inspect({handle:wrapped,byteLength:f.bytes.length,sha256:sha(f.bytes),expected:f.expected,assertCurrent(){}}),invalid);assert.equal(changed,true);assert.equal(ends,2);const actual=Buffer.alloc(f.bytes.length);await handle.read(actual,0,actual.length,0);assert.notEqual(sha(actual),sha(f.bytes));
});
test('unchanged valid files with stable time stamps retain bounded reads and handle ownership',async t=>{
 const f=await make({supplementBytes:Buffer.alloc(2*65536,7)}),{handle}=await opened(t,f.bytes),stat=await sameTimes(handle),reads=[];
 const summary=await inspect({handle:{stat,async read(...args){reads.push({position:args[3],length:args[2]});return handle.read(...args);},close(){assert.fail('inspection does not own close');}},byteLength:f.bytes.length,sha256:sha(f.bytes),expected:f.expected,assertCurrent(){}});
 assert.equal(summary.sha256,sha(f.bytes));assert.ok(reads.every(x=>x.length<=65536));assert.ok(reads.reduce((n,x)=>n+x.length,0)>=f.bytes.length);const b=Buffer.alloc(1);assert.equal((await handle.read(b,0,1,null)).bytesRead,0);
});
test('cancellation during the persisted-content recheck propagates before any success receipt',async t=>{
 const f=await make({supplementBytes:Buffer.alloc(2*65536,9)}),{handle}=await opened(t,f.bytes),retired=Object.assign(Error('synthetic retired'),{code:'RETIRED'});let recheck=false,zeroReads=0;
 const wrapped={stat:(...a)=>handle.stat(...a),async read(...a){const r=await handle.read(...a);if(a[3]===0&&++zeroReads===2)recheck=true;return r;}};
 await assert.rejects(inspect({handle:wrapped,byteLength:f.bytes.length,sha256:sha(f.bytes),expected:f.expected,assertCurrent(){if(recheck)throw retired;}}),e=>e===retired);assert.equal(recheck,true);
});
test('actual signed export rejects late corruption before replacing a previous destination',async t=>{
 const f=await fixture(t),target=await f.exportInput(),seed=await make(),owned=await opened(t,seed.bytes),filename=path.join(path.dirname(owned.filename),'previous-export.zip'),old=Buffer.from('previous lawful synthetic export');await fs.writeFile(filename,old);
 let mutated=false,ends=0,stamp=null,bytes=0,renames=0;const fsImpl={...fs,async rename(...a){renames++;return fs.rename(...a);},async open(file,...args){const h=await fs.open(file,...args);if(!String(file).endsWith('.tmp'))return h;return{write:(...a)=>h.write(...a),sync:()=>h.sync(),close:()=>h.close(),async stat(...a){const s=await h.stat(...a);if(s.size>0n&&typeof s.mtimeNs==='bigint'){stamp??={mtimeNs:s.mtimeNs,ctimeNs:s.ctimeNs};bytes=Number(s.size);}return stamp?{...s,...stamp,isFile:()=>s.isFile()}:s;},async read(...a){const r=await h.read(...a);if(a[3]===bytes-22&&++ends===2){const first=Buffer.alloc(1);await h.read(first,0,1,0);first[0]^=1;await h.write(first,0,1,0);await h.sync();mutated=true;}return r;}};}};
 const exporter=createWorkpaperExporter({client:f.client,window:{},dialog:{async showSaveDialog(){return{canceled:false,filePath:filename};}},fsImpl});t.after(()=>exporter.dispose());
 await assert.rejects(exporter.exportWorkpapers({...target,requestId:randomUUID(),confirmed:true}),{code:'WORKPAPER_EXPORT_FAILED'});assert.equal(mutated,true);assert.equal(f.client.getDeviceStatus().state,'ready');assert.equal(renames,0);assert.equal(sha(await fs.readFile(filename)),sha(old));assert.equal((await fs.readdir(path.dirname(filename))).filter(x=>x!==path.basename(owned.filename)&&x.endsWith('.tmp')).length,0);
});
