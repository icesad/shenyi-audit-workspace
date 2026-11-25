'use strict';
// Independent synthetic codec attacks, without browser or product test imports.
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {A,M,P,OTHER,FIDS,NOW,NS,TRIAL_NS,sha,clone,bytes,project,nodes,fixture,create,good,canonical,crc,unzip,zip,rewrite,manifest,record,rejected}=require('./helpers/material-preservation-security-fixture.cjs');
test('independent fixture covers removed and old-generation originals, exact closed history and local names',async()=>{
  const f=fixture(),snapshot=JSON.stringify(f.record),output=await create(f),raw=await bytes(output.blob),inspected=await M.inspect(output.blob),entries=unzip(raw);
  assert.equal(JSON.stringify(f.record),snapshot);assert.equal(JSON.stringify(inspected.record),snapshot);
  assert.deepEqual(entries.map(x=>x.name).sort(),['manifest.json','record.json',...FIDS.map(id=>'originals/'+id+'.bin')].sort());
  assert.equal(entries.find(x=>x.name==='record.json').data.toString('utf8'),snapshot,'old validator order is retained, not recursively sorted');
  assert.deepEqual(M.filesFor(f.record),f.originals.map(x=>x.metadata));
  assert.deepEqual(inspected.files.map(x=>x.metadata),f.originals.map(x=>x.metadata));
  for(const item of inspected.files){const source=f.originals.find(x=>x.metadata.id===item.metadata.id);assert.deepEqual(await bytes(item.blob),source.data);assert.equal(item.blob.type,source.metadata.type);}
  assert.equal(output.sha256,sha(raw));assert.equal(inspected.sha256,sha(raw));
  assert.equal(inspected.summary.fileCount,3);assert.equal(inspected.summary.currentFileCount,1);assert.equal(inspected.summary.historicalFileCount,2);assert.equal(inspected.summary.closed,true);
  assert.equal(inspected.summary.sourceNamespace,NS);assert.equal(inspected.summary.packageSha256,sha(raw));assert.equal(inspected.summary.totalBytes,f.originals.reduce((n,x)=>n+x.data.length,0));
});
test('schema1 preserves exact history with no invented attachment or generation',async()=>{const f=fixture({v1:true}),o=await create(f),i=await M.inspect(o.blob);assert.equal(JSON.stringify(i.record),JSON.stringify(f.record));assert.deepEqual(i.files,[]);assert.equal(i.summary.fileCount,0);assert.equal(i.summary.generationId,null);assert.equal(i.summary.closed,true);});
test('independent trial gets its dedicated namespace without adopting a normal project',async()=>{const i=await M.inspect((await create(fixture({id:A.TRIAL_ID}))).blob);assert.equal(i.manifest.sourceNamespace,TRIAL_NS);assert.equal(i.manifest.projectId,A.TRIAL_ID);});
test('filesFor returns owned metadata rather than caller-owned history objects',()=>{const f=fixture(),before=JSON.stringify(f.record),list=M.filesFor(f.record);try{list[0].name='mutated.txt';list.push({id:'forged'});}catch{}assert.equal(JSON.stringify(f.record),before);assert.deepEqual(M.filesFor(f.record).map(x=>x.id),FIDS);});
test('export rejects changed source despite unchanged revision and generation',async()=>{const f=fixture();await assert.rejects(create(f,{readCurrent:async()=>{const r=clone(f.record);r.project.firmName='another source';return r;}}));});
test('export snapshots the input before the first asynchronous file read',async()=>{const f=fixture(),before=clone(f.record);let reads=0;const o=await create(f,{readFile:async meta=>{if(!reads++){f.record.project.projectName='caller changed input';}return f.readFile(meta);},readCurrent:async()=>clone(before)});assert.equal(JSON.stringify((await M.inspect(o.blob)).record),JSON.stringify(before));});
for(const [name,alter]of [
  ['wrong metadata id',x=>x.metadata.id=crypto.randomUUID()],['wrong node',x=>x.metadata.nodeId='n9'],['wrong generation',x=>x.metadata.generationId=crypto.randomUUID()],
  ['wrong MIME',x=>x.blob=new Blob(['synthetic immutable original 0\n'],{type:'application/octet-stream'})],['changed byte contents',x=>x.blob=new Blob(['X'.repeat(x.metadata.size)],{type:x.metadata.type})],['missing blob',x=>delete x.blob]
])test('export fails on '+name,async()=>{const f=fixture();await assert.rejects(create(f,{readFile:async meta=>{const x=await f.readFile(meta);alter(x);return x;}}));});
test('export missing removed original is fatal, not silently a current-only package',async()=>{const f=fixture();await assert.rejects(create(f,{readFile:async meta=>{if(meta.id===FIDS[0])throw Error('synthetic missing historical file');return f.readFile(meta);}}));});
test('inspect owns a typed-array view before asynchronous hashing',async()=>{const raw=(await good()).raw,buffer=Buffer.concat([Buffer.from('prefix'),raw,Buffer.from('suffix')]),view=new Uint8Array(buffer.buffer,buffer.byteOffset+6,raw.length),pending=M.inspect(view);view.fill(0);assert.equal((await pending).sha256,sha(raw));});

for(const [name,alter]of [
  ['missing removed original',es=>es.splice(es.findIndex(x=>x.name==='originals/'+FIDS[0]+'.bin'),1)],
  ['extra member',es=>es.push({name:'extra.txt',data:Buffer.from('extra')})],
  ['duplicate member',es=>es.push({...es[0]})],
  ['parent path',es=>es[2].name='../original.bin'],['absolute path',es=>es[2].name='/original.bin'],['Windows path',es=>es[2].name='C:\\original.bin'],
  ['changed original with valid CRC',es=>es[2].data=Buffer.from('tampered original')],
  ['manifest unknown field',es=>manifest(es,m=>m.untrusted=true)],['manifest foreign namespace',es=>manifest(es,m=>m.sourceNamespace=TRIAL_NS)],
  ['manifest foreign project',es=>manifest(es,m=>m.projectId=OTHER)],['manifest bad record hash',es=>manifest(es,m=>m.record.sha256='0'.repeat(64))],
  ['manifest file-id duplication',es=>manifest(es,m=>m.files[1]={...m.files[0]})],['manifest path disagreement',es=>manifest(es,m=>m.files[0].entry='originals/'+FIDS[1]+'.bin')],
  ['manifest file size disagreement',es=>manifest(es,m=>m.files[0].bytes++)],['manifest missing historical reference',es=>manifest(es,m=>m.files.pop())],
  ['record unknown field with recomputed hash',es=>record(es,r=>r.claimedCurrentSigner='not trusted')],
  ['record invalid state with recomputed hash',es=>record(es,r=>r.states.n2.status='approved')],
  ['record inconsistent history with recomputed hash',es=>record(es,r=>r.events[1].file.sha256='f'.repeat(64))],
  ['record foreign UUID with recomputed hash',es=>record(es,r=>r.project.quoteId=OTHER)],
  ['record leading whitespace with recomputed hash',es=>{const e=es.find(x=>x.name==='record.json');e.data=Buffer.concat([Buffer.from(' '),e.data]);manifest(es,m=>{m.record.bytes=e.data.length;m.record.sha256=sha(e.data);});}],
  ['record duplicate JSON key with recomputed hash',es=>{const e=es.find(x=>x.name==='record.json');e.data=Buffer.from(e.data.toString().replace('{','{"schema":2,'));manifest(es,m=>{m.record.bytes=e.data.length;m.record.sha256=sha(e.data);});}],
  ['manifest duplicate JSON key',es=>{const e=es.find(x=>x.name==='manifest.json');e.data=Buffer.from(e.data.toString().replace('{','{"format":"shenyi-material-preservation",'));}],
  ['manifest BOM',es=>{const e=es.find(x=>x.name==='manifest.json');e.data=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),e.data]);}]
])test('archive semantics reject '+name,async()=>rejected(await rewrite(alter)));

for(const [name,alter]of [
  ['trailing garbage',b=>Buffer.concat([b,Buffer.from([0])])],['prepended garbage',b=>Buffer.concat([Buffer.from([0]),b])],
  ['CRC mismatch',b=>{const e=unzip(b)[2];b[e.dataOffset]^=1;return b;}],
  ['local-central mismatch',b=>{b.writeUInt32LE(1,unzip(b)[0].o+14);return b;}],
  ['encrypted flag',b=>{const e=unzip(b)[0];b.writeUInt16LE(0x801,e.o+6);b.writeUInt16LE(0x801,e.c+8);return b;}],
  ['data descriptor flag',b=>{const e=unzip(b)[0];b.writeUInt16LE(0x808,e.o+6);b.writeUInt16LE(0x808,e.c+8);return b;}],
  ['compression method',b=>{const e=unzip(b)[0];b.writeUInt16LE(8,e.o+8);b.writeUInt16LE(8,e.c+10);return b;}],
  ['unsupported version',b=>{const e=unzip(b)[0];b.writeUInt16LE(45,e.o+4);b.writeUInt16LE(45,e.c+6);return b;}],
  ['symlink attributes',b=>{const e=unzip(b)[0];b.writeUInt32LE(0xa1ff0000,e.c+38);return b;}],
  ['multi-disk EOCD',b=>{b.writeUInt16LE(1,b.length-18);return b;}],
  ['EOCD member count mismatch',b=>{b.writeUInt16LE(1,b.length-12);return b;}],
  ['ZIP64 size',b=>{const e=unzip(b)[0];b.writeUInt32LE(0xffffffff,e.c+24);return b;}],
  ['central offset overlap',b=>{const es=unzip(b);b.writeUInt32LE(es[0].o,es[1].c+42);return b;}],
  ['out-of-bounds local offset',b=>{const e=unzip(b)[0];b.writeUInt32LE(b.length+1,e.c+42);return b;}],
  ['EOCD comment',b=>{b.writeUInt16LE(1,b.length-2);return b;}],
  ['oversized declared record',b=>{const e=unzip(b)[1];b.writeUInt32LE(25*1024*1024,e.o+18);b.writeUInt32LE(25*1024*1024,e.o+22);b.writeUInt32LE(25*1024*1024,e.c+20);b.writeUInt32LE(25*1024*1024,e.c+24);return b;}]
])test('ZIP32 structure rejects '+name,async()=>rejected(alter(Buffer.from((await good()).raw))));
