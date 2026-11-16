'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{createHash}=require('node:crypto');
const {prepareMaterialFile}=require('../shared/material-admission.cjs');
const F=require('./helpers/material-preservation-security-fixture.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
function file(name,data,type=''){const bytes=Buffer.from(data);return {name,type,size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};}
function docx(macro=false){const parts=[{name:'[Content_Types].xml',data:Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')},{name:'word/document.xml',data:Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>合成维护原件</w:t></w:r></w:p></w:body></w:document>')}];if(macro)parts.push({name:'word/vbaProject.bin',data:Buffer.from('Inert synthetic macro marker')});return F.zip(parts);}
const originals=[
 ['原件.txt',Buffer.from('合成维护资料\n'),'text/plain'],
 ['original.json',Buffer.from('{"synthetic":true,"amount":777}'),'application/json'],
 ['original.xml',Buffer.from('<root><item>合成资料</item></root>'),'application/xml'],
 ['original.svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>'),'image/svg+xml'],
 ['original.docx',docx(),'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
];
for(const [name,data,type] of originals)test('new original actual legacy body admission preserves bytes and SHA: '+name,async()=>{const snapshot=Buffer.from(data),input=file(name,data,type),result=await prepareMaterialFile(input);assert.equal(result.name,name);assert.equal(result.type,type);assert.equal(result.size,snapshot.length);assert.equal(result.sha256,sha(snapshot));assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()),snapshot);data.fill(0);assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()),snapshot,'admitted Blob must retain immutable admitted bytes');});
test('empty platform MIME uses the original extension MIME after actual text admission',async()=>{const data=Buffer.from('A'),result=await prepareMaterialFile(file('one.txt',data));assert.equal(result.type,'text/plain');assert.equal(result.sha256,sha(data));});
test('single-file exact 12MiB upper boundary is admitted without truncation',async()=>{const data=Buffer.alloc(12*1048576,0x61),result=await prepareMaterialFile(file('boundary.txt',data));assert.equal(result.size,data.length);assert.equal(result.blob.size,data.length);assert.equal(result.sha256,sha(data));assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()),data);});
for(const size of [0,12*1048576+1])test('declared invalid byte length '+size+' is rejected before body read',async()=>{let reads=0;await assert.rejects(prepareMaterialFile({name:'size.txt',type:'text/plain',size,arrayBuffer:async()=>{reads++;return new ArrayBuffer(1);}}));assert.equal(reads,0);});
const invalidBodies=[
 ['fake.png',Buffer.from('signature-invalid PNG'),'image/png'],
 ['broken.json',Buffer.from('{"broken":'),'application/json'],
 ['broken.xml',Buffer.from('<root><child></root>'),'application/xml'],
 ['entity.xml',Buffer.from('<!DOCTYPE root [<!ENTITY x SYSTEM "file:///not-read">]><root>&x;</root>'),'application/xml'],
 ['namespace.svg',Buffer.from('<svg xmlns="urn:wrong"/>'),'image/svg+xml'],
 ['macro.docx',docx(true),'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
 ['mime.txt',Buffer.from('valid text body'),'application/pdf'],
 ['invalid-utf8.txt',Buffer.from([0xc3,0x28]),'text/plain'],
];
for(const [name,data,type] of invalidBodies)test('new original legacy gate rejects '+name,async()=>{const before=Buffer.from(data);await assert.rejects(prepareMaterialFile(file(name,data,type)));assert.deepEqual(data,before);});
test('claimed length mismatch cannot produce admitted source',async()=>{const input=file('mismatch.txt',Buffer.from('actual'));input.size++;await assert.rejects(prepareMaterialFile(input));});
test('context denied before admission performs zero body reads',async()=>{let reads=0;const input=file('context.txt',Buffer.from('synthetic'));input.arrayBuffer=async()=>{reads++;return new ArrayBuffer(1);};await assert.rejects(prepareMaterialFile(input,{assertCurrent(){throw Error('context revoked');}}),/context revoked/);assert.equal(reads,0);});
test('context revoked during actual body read cannot return an admitted original',async()=>{let current=true,checks=0;const input=file('context.txt',Buffer.from('synthetic')),read=input.arrayBuffer;input.arrayBuffer=async()=>{const bytes=await read();current=false;return bytes;};await assert.rejects(prepareMaterialFile(input,{assertCurrent(){checks++;if(!current)throw Error('context changed');}}),/context changed/);assert.equal(checks,2);});
test('guard must be executable rather than a truthy caller-provided marker',async()=>{await assert.rejects(prepareMaterialFile(file('guard.txt',Buffer.from('A')),{assertCurrent:true}),/guard/);});
test('HTML admission stays inert and does not request local network resources',async t=>{let requests=0;const marker='__shenyiMaintenanceAdmissionExecuted';delete globalThis[marker];const server=http.createServer((_req,res)=>{requests++;res.end('not executed');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const url='http://127.0.0.1:'+server.address().port+'/inert',body=Buffer.from('<html><body><script>globalThis.'+marker+'=true</script><script src="'+url+'"></script><img src="'+url+'"></body></html>'),result=await prepareMaterialFile(file('inert.html',body,'text/html'));assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()),body);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(requests,0);assert.equal(globalThis[marker],undefined);});
