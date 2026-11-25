'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash,randomUUID}=require('node:crypto');
const A=require('../dist/audit-checklist.js'),P=require('../dist/material-preservation.js'),Z=require('../dist/audit-archive.js');
const ID='4a502e25-69a2-4ff6-b37f-d06a1598eb12',AT='2026-11-16T00:00:00.000Z',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const project=(id=ID)=>({quoteId:id,projectName:'合成保全项目',firmName:'合成事务所'});
const nodes=title=>[{id:'n1',parentId:'',level:1,title,description:'',kind:'material'}];
const canonical=value=>JSON.stringify((function order(v){return Array.isArray(v)?v.map(order):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(key=>[key,order(v[key])])):v;})(value));
function fixture({trial=false,closed=false}={}){
 let record=A.createTree(project(trial?A.TRIAL_ID:ID),nodes('旧代资料'),'合成导入人');const files=new Map();
 function add(text,name){const bytes=Buffer.from(text),id=randomUUID();record=A.apply(record,{type:'attachment-add',nodeId:'n1',reviewer:'合成接收人',file:{id,nodeId:'n1',generationId:record.generationId,name,size:bytes.length,type:'text/plain',sha256:sha(bytes)}});const metadata=structuredClone(record.events.at(-1).file);files.set(id,{metadata,blob:new Blob([bytes],{type:metadata.type}),bytes});return id;}
 const removed=add('Synthetic removed original\n原件甲','已移除.txt');record=A.apply(record,{type:'attachment-remove',nodeId:'n1',fileId:removed,reason:'合成明确移除','reviewer':'合成移除人'});
 const prior=add('Synthetic prior generation original\n原件乙','旧代.txt');record=A.apply(record,{type:'tree-replace',nodes:nodes('当前资料'),reason:'合成换代','reviewer':'合成导入人'});
 const current=add('Synthetic current original\n原件丙','当前.txt');
 if(closed){record=A.apply(record,{type:'item',id:'n1',status:'confirmed',evidence:'合成证据索引',reviewer:'合成核对人'});record=A.apply(record,{type:'close',reviewer:'合成关门人'});}
 return {record,files,removed,prior,current};
}
async function create(f,overrides={}){return P.create({record:f.record,readFile:async meta=>{const f1=f.files.get(meta.id);return {metadata:f1.metadata,blob:f1.blob};},readCurrent:async()=>f.record,createdAt:AT,...overrides});}
async function contents(blob){const bytes=Buffer.from(blob instanceof Uint8Array?blob:await blob.arrayBuffer()),entries=[];let at=0;while(bytes.readUInt32LE(at)===0x04034b50){const size=bytes.readUInt32LE(at+18),length=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),start=at+30+length+extra;entries.push({path:bytes.subarray(at+30,at+30+length).toString('utf8'),bytes:Uint8Array.from(bytes.subarray(start,start+size))});at=start+size;}return entries;}
const rebuild=entries=>Z.zipStore(entries);
async function alter(blob,change){const entries=await contents(blob);change(entries);return rebuild(entries);}
function editManifest(entries,change){const entry=entries.find(row=>row.path==='manifest.json'),value=JSON.parse(Buffer.from(entry.bytes));change(value);entry.bytes=Buffer.from(canonical(value));}
function positions(bytes){const b=Buffer.from(bytes),end=b.length-22,central=b.readUInt32LE(end+16),list=[];let at=central;for(let i=0;i<b.readUInt16LE(end+8);i++){list.push({central:at,local:b.readUInt32LE(at+42)});at+=46+b.readUInt16LE(at+28)+b.readUInt16LE(at+30)+b.readUInt16LE(at+32);}return {bytes:b,end,central,list};}
async function badHeader(blob,change){const p=positions(new Uint8Array(await blob.arrayBuffer()));change(p);return p.bytes;}

test('history enumeration includes removed and prior-generation originals, owns metadata and never changes the old record',()=>{
 const f=fixture(),before=JSON.stringify(f.record),files=P.filesFor(f.record);assert.deepEqual(files.map(file=>file.id),[f.removed,f.prior,f.current]);assert.equal(files[0].generationId,files[1].generationId);assert.notEqual(files[1].generationId,files[2].generationId);files[0].name='不可污染.txt';assert.equal(JSON.stringify(f.record),before);assert.equal(A.validate(f.record),f.record);
});
for(const trial of [false,true])for(const closed of [false,true])test(`complete ${trial?'trial':'formal'} preservation keeps old generations, removed bytes, closed=${closed} and exact record order`,async()=>{
 const f=fixture({trial,closed}),before=JSON.stringify(f.record),made=await create(f),read=await P.inspect(made.blob);assert.equal(made.blob.type,'application/zip');assert.equal(JSON.stringify(read.record),before);assert.equal(JSON.stringify(f.record),before);assert.equal(A.validate(read.record),read.record);assert.equal(read.sha256,made.sha256);assert.equal(read.sha256,sha(Buffer.from(await made.blob.arrayBuffer())));assert.deepEqual(Object.keys(read).sort(),['manifest','record','files','sha256','summary'].sort());assert.deepEqual(Object.keys(made).sort(),['blob','manifest','sha256','summary'].sort());assert.deepEqual(read.summary,made.summary);assert.deepEqual(read.summary,{projectId:f.record.project.quoteId,projectName:f.record.project.projectName,firmName:f.record.project.firmName,sourceNamespace:trial?'hengdu.audit.materials.trial.v1':'hengdu.audit.materials.v1',recordSchema:2,revision:f.record.revision,generationId:f.record.generationId,closed,nodeCount:1,fileCount:3,currentFileCount:1,historicalFileCount:2,totalBytes:[...f.files.values()].reduce((sum,file)=>sum+file.bytes.length,0),packageSha256:read.sha256});assert.deepEqual(read.files.map(file=>file.metadata.id),[f.removed,f.prior,f.current]);for(const file of read.files){const original=f.files.get(file.metadata.id);assert.deepEqual(file.metadata,original.metadata);assert.equal(file.blob.type,original.metadata.type);assert.deepEqual(Buffer.from(await file.blob.arrayBuffer()),original.bytes);}const entries=await contents(made.blob);assert.equal(Buffer.from(entries.find(row=>row.path==='record.json').bytes).toString(),before);assert.equal(Buffer.from(entries[0].bytes).toString(),canonical(made.manifest));assert.equal(read.manifest.policy.teamImported,false);assert.equal(read.manifest.policy.identityAuthenticated,false);assert.equal(read.manifest.policy.professionalApprovalClaimed,false);
 if(closed){assert.throws(()=>A.apply(read.record,{type:'item',id:'n1',status:'received',reviewer:'合成人'}),/关门/);assert.equal(A.apply(read.record,{type:'reopen',reason:'合成重新核对理由',reviewer:'合成人'}).closed,null);}
});
test('v1 has no saved original body and preserves closed history without inventing a generation',async()=>{
 let record=A.create(project(),A.parse('合成旧清单资料'),'合成导入人');record=A.apply(record,{type:'item',id:'i1',status:'confirmed',evidence:'合成索引',reviewer:'合成核对人'});record=A.apply(record,{type:'close',reviewer:'合成关门人'});let fileReads=0;const made=await P.create({record,readFile:async()=>{fileReads++;throw Error('No v1 original body')},readCurrent:async()=>record,createdAt:AT}),read=await P.inspect(made.blob);assert.equal(fileReads,0);assert.equal(JSON.stringify(read.record),JSON.stringify(record));assert.equal(read.summary.fileCount,0);assert.equal(read.summary.generationId,null);assert.equal(read.summary.closed,true);assert.equal(read.manifest.policy.includesOriginalChecklistDocument,false);assert.deepEqual((await contents(made.blob)).map(row=>row.path),['manifest.json','record.json']);
});
test('create owns its input record and metadata before asynchronous callbacks can mutate caller data',async()=>{
 const f=fixture(),source=structuredClone(f.record),before=JSON.stringify(source),seen=[];const pending=create(f,{readCurrent:async()=>source,readFile:async meta=>{const stored=f.files.get(meta.id);seen.push(meta.id);meta.name='仅回调持有.txt';return {blob:stored.blob,metadata:stored.metadata};}});f.record.project.projectName='调用者后来修改';const made=await pending;assert.equal(JSON.stringify((await P.inspect(made.blob)).record),before);assert.deepEqual(seen,[f.removed,f.prior,f.current]);assert.ok([...f.files.values()].every(file=>file.metadata.name!=='仅回调持有.txt'));
});
for(const kind of ['same-revision-project','revision','closed','event-text'])test(`the final full-record recheck rejects ${kind} changes after original reads`,async()=>{
 const f=fixture();let reads=0;await assert.rejects(create(f,{readFile:async meta=>{reads++;const stored=f.files.get(meta.id);if(reads===3){if(kind==='same-revision-project')f.record.project.projectName='同版本不同项目名';if(kind==='revision')f.record=A.apply(f.record,{type:'item',id:'n1',status:'problem',reason:'合成待补',reviewer:'合成人'});if(kind==='closed'){f.record=A.apply(f.record,{type:'item',id:'n1',status:'confirmed',evidence:'合成索引',reviewer:'合成人'});f.record=A.apply(f.record,{type:'close',reviewer:'合成人'});}if(kind==='event-text')f.record.events[0].reason='同版本导入理由变化';}return {blob:stored.blob,metadata:stored.metadata};}}),/源记录.*改变/);assert.equal(reads,3);
});
for(const kind of ['missing','metadata','bytes','mime','size'])test(`export refuses ${kind} corruption of a removed historical original`,async()=>{
 const f=fixture();await assert.rejects(create(f,{readFile:async meta=>{const stored=f.files.get(meta.id);if(meta.id!==f.removed)return {blob:stored.blob,metadata:stored.metadata};if(kind==='missing')throw Error('Synthetic missing old original');if(kind==='metadata')return {blob:stored.blob,metadata:{...stored.metadata,reviewer:'另一个人'}};if(kind==='bytes')return {blob:new Blob([Buffer.alloc(stored.bytes.length)],{type:stored.metadata.type}),metadata:stored.metadata};if(kind==='mime')return {blob:new Blob([stored.bytes],{type:'application/pdf'}),metadata:stored.metadata};return {blob:new Blob(['short'],{type:stored.metadata.type}),metadata:stored.metadata};}}));
});
test('inspection owns Uint8Array and Buffer input synchronously before its first await',async()=>{
 const made=await create(fixture());for(const input of [new Uint8Array(await made.blob.arrayBuffer()),Buffer.from(await made.blob.arrayBuffer())]){const pending=P.inspect(input);input.fill(0);const read=await pending;assert.equal(read.sha256,made.sha256);assert.equal(read.files.length,3);}
});
test('JSON source accessors, executable values, cycles and sparse arrays are rejected without invoking getters',async()=>{
 const f=fixture();let gets=0;const bad=structuredClone(f.record);Object.defineProperty(bad,'project',{enumerable:true,get(){gets++;return f.record.project;}});assert.throws(()=>P.filesFor(bad));assert.equal(gets,0);const cyclic=structuredClone(f.record);cyclic.cycle=cyclic;assert.throws(()=>P.filesFor(cyclic));for(const value of [()=>{},new Date(),{...f.record,nodes:[,]},null])assert.throws(()=>P.filesFor(value));let fileGetter=0;await assert.rejects(create(f,{readFile:async()=>Object.defineProperty({metadata:f.files.get(f.removed).metadata},'blob',{enumerable:true,get(){fileGetter++;return f.files.get(f.removed).blob;}})}));assert.equal(fileGetter,0);
});
for(const [name,mutate] of [
 ['encryption',p=>{p.bytes.writeUInt16LE(0x801,p.list[0].local+6);p.bytes.writeUInt16LE(0x801,p.list[0].central+8);}],
 ['deflate',p=>{p.bytes.writeUInt16LE(8,p.list[0].local+8);p.bytes.writeUInt16LE(8,p.list[0].central+10);}],
 ['ZIP64 version',p=>{p.bytes.writeUInt16LE(45,p.list[0].local+4);p.bytes.writeUInt16LE(45,p.list[0].central+6);}],
 ['symlink attributes',p=>{p.bytes.writeUInt16LE(0x0314,p.list[0].central+4);p.bytes.writeUInt32LE(0xa1ff0000,p.list[0].central+38);}],
 ['local-only CRC change',p=>p.bytes.writeUInt32LE(0,p.list[0].local+14)],
 ['both bad CRCs',p=>{p.bytes.writeUInt32LE(0,p.list[0].local+14);p.bytes.writeUInt32LE(0,p.list[0].central+16);}],
 ['local name mismatch',p=>{p.bytes[p.list[0].local+30]^=1;}],
 ['central compressed size',p=>p.bytes.writeUInt32LE(1,p.list[0].central+20)],
 ['overlapping local regions',p=>p.bytes.writeUInt32LE(p.list[0].local,p.list[1].central+42)],
 ['local gap',p=>p.bytes.writeUInt32LE(p.list[1].local+1,p.list[1].central+42)],
 ['extra field',p=>p.bytes.writeUInt16LE(1,p.list[0].central+30)],
 ['local extra field',p=>p.bytes.writeUInt16LE(1,p.list[0].local+28)],
 ['member comment',p=>p.bytes.writeUInt16LE(1,p.list[0].central+32)],
 ['archive comment',p=>p.bytes.writeUInt16LE(1,p.end+20)],
 ['multidisk',p=>p.bytes.writeUInt16LE(1,p.end+4)],
 ['entry disk',p=>p.bytes.writeUInt16LE(1,p.list[0].central+34)],
 ['entry count',p=>p.bytes.writeUInt16LE(1,p.end+8)],
 ['central offset',p=>p.bytes.writeUInt32LE(p.central+1,p.end+16)],
 ['central length',p=>p.bytes.writeUInt32LE(1,p.end+12)],
 ['record declared above24MiB',p=>{p.bytes.writeUInt32LE(24*1024*1024+1,p.list[1].central+20);p.bytes.writeUInt32LE(24*1024*1024+1,p.list[1].central+24);}],
 ['manifest declared above4MiB',p=>{p.bytes.writeUInt32LE(4*1024*1024+1,p.list[0].central+20);p.bytes.writeUInt32LE(4*1024*1024+1,p.list[0].central+24);}],
 ['original declared above12MiB',p=>{p.bytes.writeUInt32LE(12*1024*1024+1,p.list[2].central+20);p.bytes.writeUInt32LE(12*1024*1024+1,p.list[2].central+24);}]
])test(`ZIP structural validation rejects ${name}`,async()=>{const made=await create(fixture());await assert.rejects(P.inspect(await badHeader(made.blob,mutate)));});
for(const name of ['trailing','truncated','leading'])test(`ZIP rejects ${name} bytes and never accepts an appended second package`,async()=>{const made=await create(fixture()),bytes=Buffer.from(await made.blob.arrayBuffer());await assert.rejects(P.inspect(name==='truncated'?bytes.subarray(0,bytes.length-1):name==='leading'?Buffer.concat([Buffer.from([0]),bytes]):Buffer.concat([bytes,Buffer.from([0])])));if(name==='trailing')await assert.rejects(P.inspect(Buffer.concat([bytes,bytes])));});
for(const name of ['missing-original','extra-original','unknown-member','missing-record'])test(`the exact member inventory rejects ${name}`,async()=>{
 const f=fixture(),made=await create(f),bytes=await alter(made.blob,entries=>{if(name==='missing-original')entries.splice(2,1);if(name==='missing-record')entries.splice(1,1);if(name==='extra-original')entries.push({path:'originals/'+randomUUID()+'.bin',bytes:Buffer.from('extra')});if(name==='unknown-member')entries.push({path:'extra.txt',bytes:Buffer.from('unknown')});});await assert.rejects(P.inspect(bytes));
});
for(const caseName of ['duplicate','traversal','absolute','backslash'])test(`member names reject ${caseName} aliases`,async()=>{
 const made=await create(fixture()),p=positions(new Uint8Array(await made.blob.arrayBuffer())),target=p.list[2],other=p.list[3],nameBytes=p.bytes.subarray(target.local+30,target.local+30+p.bytes.readUInt16LE(target.local+26)),name=nameBytes.toString();
 // Preserve every offset and payload while changing both header name copies.
 const cases={duplicate:p.bytes.subarray(other.local+30,other.local+30+p.bytes.readUInt16LE(other.local+26)).toString(),traversal:'../'+name.slice(3),absolute:'/'+name.slice(1),backslash:name.replace('/','\\')},replacement=cases[caseName];
 assert.equal(Buffer.byteLength(replacement),nameBytes.length);
 Buffer.from(replacement).copy(p.bytes,target.local+30);Buffer.from(replacement).copy(p.bytes,target.central+46);
 await assert.rejects(P.inspect(p.bytes));
});
for(const name of ['namespace','project','record-revision','record-hash','policy','unknown-policy','unknown-field','wrong-file-id','wrong-file-size','wrong-file-hash'])test(`manifest semantic validation rejects ${name} with valid ZIP CRCs`,async()=>{
 const made=await create(fixture()),bytes=await alter(made.blob,entries=>editManifest(entries,m=>{if(name==='namespace')m.sourceNamespace='hengdu.audit.materials.trial.v1';if(name==='project')m.projectId=randomUUID();if(name==='record-revision')m.record.revision++;if(name==='record-hash')m.record.sha256='0'.repeat(64);if(name==='policy')m.policy.professionalApprovalClaimed=true;if(name==='unknown-policy')m.policy.extra=false;if(name==='unknown-field')m.extra='not allowed';if(name==='wrong-file-id')m.files[0].id=randomUUID();if(name==='wrong-file-size')m.files[0].bytes++;if(name==='wrong-file-hash')m.files[0].sha256='0'.repeat(64);}));await assert.rejects(P.inspect(bytes));
});
for(const [name,change] of [
 ['manifest duplicate key',text=>text.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1')],
 ['manifest escaped duplicate key',text=>text.replace('"schemaVersion":1','"schemaVersion":1,"\\u0073chemaVersion":1')],
 ['manifest leading whitespace',text=>' '+text],
 ['manifest BOM',text=>'\ufeff'+text]
])test(`canonical JSON rejects ${name}`,async()=>{const made=await create(fixture()),bytes=await alter(made.blob,entries=>{const e=entries[0];e.bytes=Buffer.from(change(Buffer.from(e.bytes).toString()));});await assert.rejects(P.inspect(bytes));});
for(const name of ['duplicate','whitespace','BOM','reordered'])test(`record JSON rejects ${name} without weakening legacy validation`,async()=>{
 const made=await create(fixture()),bytes=await alter(made.blob,entries=>{const entry=entries.find(e=>e.path==='record.json'),text=Buffer.from(entry.bytes).toString();entry.bytes=Buffer.from(name==='duplicate'?text.replace('"schema":2','"schema":2,"schema":2'):name==='whitespace'?text+'\n':name==='BOM'?'\ufeff'+text:canonical(JSON.parse(text)));editManifest(entries,m=>{m.record.bytes=entry.bytes.length;m.record.sha256=sha(entry.bytes);});});await assert.rejects(P.inspect(bytes));
});
test('payload SHA256 is checked even after an attacker recomputes valid ZIP CRCs',async()=>{const made=await create(fixture()),bytes=await alter(made.blob,entries=>{entries[2].bytes[0]^=1;});await assert.rejects(P.inspect(bytes),/SHA256/);});
test('input limits reject real oversize typed arrays before copying and malformed non-file inputs',async()=>{await assert.rejects(P.inspect(new Uint8Array(180*1024*1024+1)),/大小/);for(const input of [null,{},new Uint16Array(10),new Blob([])])await assert.rejects(P.inspect(input));});
