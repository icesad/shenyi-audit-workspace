'use strict';
// Real isolated Chromium IndexedDB. No customer profile, mocked database or team service.
const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {A,M,P,OTHER,FIDS,NOW,NS,TRIAL_NS,sha,clone,bytes,project,nodes,fixture,create,good,canonical,crc,unzip,zip,rewrite,manifest,record,rejected}=require('../helpers/material-preservation-security-fixture.cjs');
let browserPromise;
async function browser(){if(!browserPromise){const {chromium}=require('playwright'),executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();assert.ok(fs.existsSync(executable),'real Chromium is required for independent transaction acceptance');browserPromise=chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});}return browserPromise;}
after(async()=>{if(browserPromise)await(await browserPromise).close();});
async function inPage(work,arg){const context=await(await browser()).newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[],network=[];
  page.on('pageerror',e=>errors.push(e.message));context.on('request',r=>{if(/^(https?|wss?):/.test(r.url()))network.push(r.url());});
  try{await page.goto(pathToFileURL(path.join(__dirname,'../../dist/rule-catalog.js')).href);for(const file of ['audit-checklist.js','material-preservation.js'])await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../../dist',file),'utf8')});await page.evaluate(async()=>{const bootstrap=await AuditChecklist.open();bootstrap.close();});
    await page.evaluate(()=>{window.sec={
      async raw(){return new Promise((ok,no)=>{const q=indexedDB.open('hengdu.audit.materials.v1');q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});},
      async hash(blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');},
      async snapshot(){const db=await this.raw();try{const values=await new Promise((ok,no)=>{const tx=db.transaction(['checklists','materialFiles']),a=tx.objectStore('checklists').getAll(),b=tx.objectStore('materialFiles').getAll();tx.oncomplete=()=>ok({records:a.result,files:b.result});tx.onabort=()=>no(tx.error);});return {version:db.version,stores:[...db.objectStoreNames],records:values.records,files:await Promise.all(values.files.map(async row=>({...row,blob:{type:row.blob?.type,size:row.blob?.size,sha256:row.blob?await this.hash(row.blob):null}})))};}finally{db.close();}},
      async put(store,row){const db=await this.raw();try{await new Promise((ok,no)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(row);tx.oncomplete=ok;tx.onabort=()=>no(tx.error);});}finally{db.close();}},
      async rejected(p){try{await p;return false;}catch{return true;}},
      blob(raw){return new Blob([new Uint8Array(raw)],{type:'application/zip'});}
    };});
    const result=await page.evaluate(work,arg);assert.deepEqual(errors,[]);assert.deepEqual(network,[]);return result;
  }finally{await context.close();}
}
async function browserPackage(){const {raw,result}=await good();return {raw:[...raw],digest:result.sha256,id:P,other:OTHER,fileIds:FIDS};}

test('real IndexedDB restore preserves record byte semantics, all three original wrappers and closed rules',async()=>{
  const input=await browserPackage(),out=await inPage(async x=>{const api=await AuditChecklist.open();try{const restored=await api.restorePreservation(x.id,sec.blob(x.raw),{expectedSha256:x.digest}),current=await api.get(x.id),snapshot=await sec.snapshot(),exported=await api.exportPreservation(x.id),inspect=await MaterialPreservation.inspect(exported.blob);const blocked=await sec.rejected(api.change(x.id,current.revision,{type:'item',id:'n2',status:'pending',reviewer:'not authorized by old name'}));const reopened=await api.change(x.id,current.revision,{type:'reopen',reason:'明确的合成重新核对理由',reviewer:'新的本机人工姓名'});return {restored:!!restored,current,snapshot,exportRecord:inspect.record,blocked,reopened:reopened.closed===null,reopenPrior:reopened.events.at(-1).priorClose};}finally{api.close();}},input);
  const {f}=await good();assert.equal(JSON.stringify(out.current),JSON.stringify(f.record));assert.equal(JSON.stringify(out.exportRecord),JSON.stringify(f.record));assert.equal(out.snapshot.version,2);assert.deepEqual(out.snapshot.stores,['checklists','materialFiles']);assert.equal(out.snapshot.records.length,1);assert.equal(out.snapshot.files.length,3);for(const item of out.snapshot.files){const expected=f.originals.find(x=>x.metadata.id===item.id);assert.ok(expected);assert.equal(item.quoteId,P);assert.deepEqual(item.metadata,expected.metadata);assert.equal(item.blob.sha256,sha(expected.data));assert.equal(item.generationId,expected.metadata.generationId);assert.equal(item.nodeId,'n2');}assert.equal(out.blocked,true);assert.equal(out.reopened,true);assert.deepEqual(out.reopenPrior,f.record.closed);
});
for(const kind of ['valid existing record','corrupt existing row','orphan target file','foreign file UUID'])test('real restore rejects '+kind+' with zero writes',async()=>{
  const input=await browserPackage(),out=await inPage(async x=>{const api=await AuditChecklist.open();try{if(x.kind==='valid existing record')await api.create({quoteId:x.id,projectName:'existing',firmName:''},AuditChecklist.parse('existing'),'old');else if(x.kind==='corrupt existing row')await sec.put('checklists',{quoteId:x.id,record:{broken:true}});else await sec.put('materialFiles',{id:x.kind==='foreign file UUID'?x.fileIds[1]:crypto.randomUUID(),quoteId:x.kind==='foreign file UUID'?x.other:x.id,blob:new Blob(['existing untouched bytes']),metadata:{untrusted:'preserve exactly'}});const before=await sec.snapshot(),denied=await sec.rejected(api.restorePreservation(x.id,sec.blob(x.raw),{expectedSha256:x.digest})),after=await sec.snapshot();return {before,after,denied};}finally{api.close();}},{...input,kind});assert.equal(out.denied,true);assert.deepEqual(out.after,out.before);
});
for(const kind of ['missing confirmation hash','wrong confirmation hash','foreign target UUID','trial through formal','formal through trial'])test('real restore rejects '+kind+' before adding data',async()=>{
  const input=await browserPackage();if(kind==='trial through formal'){const p=await create(fixture({id:A.TRIAL_ID}));input.raw=[...await bytes(p.blob)];input.digest=p.sha256;input.id=A.TRIAL_ID;}
  const out=await inPage(async x=>{const api=await(x.kind==='formal through trial'?AuditChecklist.openTrial():AuditChecklist.open());try{const before=await sec.snapshot(),options=x.kind==='missing confirmation hash'?{}:{expectedSha256:x.kind==='wrong confirmation hash'?'0'.repeat(64):x.digest},denied=await sec.rejected(api.restorePreservation(x.kind==='foreign target UUID'?x.other:x.id,sec.blob(x.raw),options)),after=await sec.snapshot();return {denied,before,after};}finally{api.close();}},{...input,kind});assert.equal(out.denied,true);assert.deepEqual(out.after,out.before);
});
test('real mid-second-file DataClone failure rolls back earlier original and record writes',async()=>{
  const out=await inPage(async x=>{const api=await AuditChecklist.open(),original=IDBObjectStore.prototype.add;let calls=0;try{const before=await sec.snapshot();IDBObjectStore.prototype.add=function(...args){if(this.name==='materialFiles'&&++calls===2)throw new DOMException('synthetic second-file failure','DataCloneError');return original.apply(this,args);};const denied=await sec.rejected(api.restorePreservation(x.id,sec.blob(x.raw),{expectedSha256:x.digest}));IDBObjectStore.prototype.add=original;return {denied,calls,before,after:await sec.snapshot()};}finally{IDBObjectStore.prototype.add=original;api.close();}},await browserPackage());assert.equal(out.denied,true);assert.equal(out.calls,2);assert.deepEqual(out.after,out.before);
});
test('real last collision-read context loss prevents the final atomic writes',async()=>{
  const out=await inPage(async x=>{const api=await AuditChecklist.open(),original=IDBObjectStore.prototype.get,add=IDBObjectStore.prototype.add;let writes=0,checks=0,lost=false;try{const before=await sec.snapshot();IDBObjectStore.prototype.get=function(...args){const request=original.apply(this,args);if(this.name==='materialFiles'&&args[0]===x.fileIds.at(-1))request.addEventListener('success',()=>{lost=true;});return request;};IDBObjectStore.prototype.add=function(...args){writes++;return add.apply(this,args);};const denied=await sec.rejected(api.restorePreservation(x.id,sec.blob(x.raw),{expectedSha256:x.digest,assertContext(){checks++;if(lost)throw Error('synthetic project/view changed at last asynchronous read');}}));IDBObjectStore.prototype.get=original;IDBObjectStore.prototype.add=add;return {denied,writes,checks,lost,before,after:await sec.snapshot()};}finally{IDBObjectStore.prototype.get=original;IDBObjectStore.prototype.add=add;api.close();}},await browserPackage());assert.equal(out.lost,true);assert.equal(out.denied,true);assert.equal(out.writes,0);assert.ok(out.checks>1);assert.deepEqual(out.after,out.before);
});
test('real two connections race: exactly one restore commits and the second cannot overwrite',async()=>{
  const out=await inPage(async x=>{const a=await AuditChecklist.open(),b=await AuditChecklist.open();try{const results=await Promise.allSettled([a.restorePreservation(x.id,sec.blob(x.raw),{expectedSha256:x.digest}),b.restorePreservation(x.id,sec.blob(x.raw),{expectedSha256:x.digest})]);return {statuses:results.map(r=>r.status),snapshot:await sec.snapshot()};}finally{a.close();b.close();}},await browserPackage());assert.deepEqual(out.statuses.sort(),['fulfilled','rejected']);assert.equal(out.snapshot.records.length,1);assert.equal(out.snapshot.files.length,3);
});
test('two real browser pages share the restore CAS and cannot both commit',async()=>{
  const context=await(await browser()).newContext({serviceWorkers:'block'});try{const pages=await Promise.all([context.newPage(),context.newPage()]);for(const page of pages){await page.goto(pathToFileURL(path.join(__dirname,'../../dist/rule-catalog.js')).href);for(const file of ['audit-checklist.js','material-preservation.js'])await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../../dist',file),'utf8')});}
    const x=await browserPackage(),restore=async page=>page.evaluate(async x=>{const a=await AuditChecklist.open();try{try{await a.restorePreservation(x.id,new Blob([new Uint8Array(x.raw)]),{expectedSha256:x.digest});return 'committed';}catch{return 'rejected';}}finally{a.close();}},x),results=await Promise.all(pages.map(restore));assert.deepEqual(results.sort(),['committed','rejected']);
    const state=await pages[0].evaluate(async()=>{const a=await AuditChecklist.open();a.close();const db=await new Promise((ok,no)=>{const q=indexedDB.open('hengdu.audit.materials.v1');q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});try{return await new Promise((ok,no)=>{const t=db.transaction(['checklists','materialFiles']),r=t.objectStore('checklists').count(),f=t.objectStore('materialFiles').count();t.oncomplete=()=>ok([r.result,f.result]);t.onabort=()=>no(t.error);});}finally{db.close();}});assert.deepEqual(state,[1,3]);
  }finally{await context.close();}
});
test('real export rejects context changes while preserving all originals and source record',async()=>{
  const out=await inPage(async x=>{const api=await AuditChecklist.open();try{await api.restorePreservation(x.id,sec.blob(x.raw),{expectedSha256:x.digest});let changed=false;const denied=await sec.rejected(api.exportPreservation(x.id,{assertContext(){if(changed)throw Error('synthetic context changed');changed=true;}}));return {denied,snapshot:await sec.snapshot()};}finally{api.close();}},await browserPackage());assert.equal(out.denied,true);assert.equal(out.snapshot.records.length,1);assert.equal(out.snapshot.files.length,3);assert.equal(JSON.stringify(out.snapshot.records[0].record),JSON.stringify((await good()).f.record));
});
test('real export notices an actual second-connection source change with the same revision',async()=>{
  const out=await inPage(async x=>{const api=await AuditChecklist.open(),original=Blob.prototype.arrayBuffer;let changed=false;try{await api.restorePreservation(x.id,sec.blob(x.raw),{expectedSha256:x.digest});Blob.prototype.arrayBuffer=async function(){if(!changed){changed=true;const r=await api.get(x.id);r.project.firmName='synthetic concurrent source change';await sec.put('checklists',{quoteId:x.id,record:r});}return original.call(this);};const denied=await sec.rejected(api.exportPreservation(x.id));Blob.prototype.arrayBuffer=original;return {denied,changed,snapshot:await sec.snapshot()};}finally{Blob.prototype.arrayBuffer=original;api.close();}},await browserPackage());assert.equal(out.changed,true);assert.equal(out.denied,true);assert.equal(out.snapshot.files.length,3);assert.equal(out.snapshot.records[0].record.project.firmName,'synthetic concurrent source change');assert.equal(out.snapshot.records[0].record.revision,(await good()).f.record.revision);
});

// File admission is checked at the database boundary, independently of the
// preservation codec's structural/CRC/SHA verification. These are inert bytes;
// no attachment is opened, previewed, executed or submitted to a network.
const DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function officeBytes({macro=false}={}){
  const entries=[{name:'[Content_Types].xml',data:Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')},{name:'word/document.xml',data:Buffer.from('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>synthetic harmless Office data</w:t></w:r></w:p></w:body></w:document>')}];
  if(macro)entries.push({name:'word/vbaProject.bin',data:Buffer.from('synthetic format-policy marker; no executable content')});
  return zip(entries);
}
async function parityPackage(spec,index=0){
  const f=fixture(),original=f.originals[index],changes={name:spec.name,type:spec.type,size:spec.data.length,sha256:sha(spec.data)},id=original.metadata.id;
  function update(value){if(!value||typeof value!=='object')return;if(value.id===id&&Object.hasOwn(value,'generationId')&&Object.hasOwn(value,'sha256'))Object.assign(value,changes);for(const child of Object.values(value))if(child&&typeof child==='object')update(child);}
  update(f.record);original.data=Buffer.from(spec.data);original.metadata=clone(f.record.events.find(event=>event.type==='attachment-add'&&event.file.id===id).file);A.validate(f.record);
  const made=await create(f),raw=await bytes(made.blob),inspected=await M.inspect(raw);assert.equal(inspected.files.length,3);assert.equal(inspected.sha256,made.sha256);
  return {raw:[...raw],digest:made.sha256,id:P,other:OTHER,fileIds:FIDS,index,sourceFileId:id,name:spec.name,type:spec.type,data:[...spec.data],expectedHash:changes.sha256,expectedRecord:JSON.stringify(f.record)};
}
async function admissionParity(input){return inPage(async x=>{
  const api=await AuditChecklist.open(),add=IDBObjectStore.prototype.add,put=IDBObjectStore.prototype.put,transaction=IDBDatabase.prototype.transaction;
  let phase='setup';const calls={normal:{writes:0,readwrite:0},restore:{writes:0,readwrite:0}};
  try{
    const control=await api.importTree({quoteId:x.other,projectName:'Synthetic normal upload control',firmName:''},[{id:'n1',parentId:'',level:1,title:'group',description:'',kind:'group'},{id:'n2',parentId:'n1',level:2,title:'material',description:'',kind:'material'}],'Synthetic operator');
    IDBObjectStore.prototype.add=function(...args){if(calls[phase])calls[phase].writes++;return add.apply(this,args);};
    IDBObjectStore.prototype.put=function(...args){if(calls[phase])calls[phase].writes++;return put.apply(this,args);};
    IDBDatabase.prototype.transaction=function(...args){if(calls[phase]&&args[1]==='readwrite')calls[phase].readwrite++;return transaction.apply(this,args);};
    const beforeNormal=await sec.snapshot();phase='normal';let normalError='',normalResult;
    try{normalResult=await api.attach(x.other,control.revision,'n2',new File([new Uint8Array(x.data)],x.name,{type:x.type}),'Synthetic operator');}catch(error){normalError=error.message;}
    phase='snapshot';const afterNormal=await sec.snapshot(),beforeRestore=afterNormal;phase='restore';let restoreError='',restored;
    try{restored=await api.restorePreservation(x.id,sec.blob(x.raw),{expectedSha256:x.digest});}catch(error){restoreError=error.message;}
    phase='snapshot';const afterRestore=await sec.snapshot();return {normalError,restoreError,normalAccepted:!!normalResult,restored:!!restored,calls,beforeNormal,afterNormal,beforeRestore,afterRestore,normalName:normalResult?.attachments.n2[0]?.name};
  }finally{IDBObjectStore.prototype.add=add;IDBObjectStore.prototype.put=put;IDBDatabase.prototype.transaction=transaction;api.close();}
},input);}
const badFormats=[
  {label:'fake PNG signature',name:'synthetic.png',type:'image/png',data:Buffer.from('synthetic text; not PNG')},
  {label:'invalid UTF8 text',name:'synthetic.txt',type:'text/plain',data:Buffer.from([0xff,0xfe,0xf8])},
  {label:'invalid JSON syntax',name:'synthetic.json',type:'application/json',data:Buffer.from('{invalid synthetic json')},
  {label:'XML entity declaration',name:'synthetic.xml',type:'application/xml',data:Buffer.from('<!DOCTYPE root [<!ENTITY synthetic "inert">]><root>&synthetic;</root>')},
  {label:'Office macro entry',name:'synthetic.docx',type:DOCX,data:officeBytes({macro:true})}
];
for(const spec of badFormats)test('normal upload and restore both reject '+spec.label+' in a removed historical attachment with zero business writes',async()=>{
  const out=await admissionParity(await parityPackage(spec,0));assert.equal(out.normalAccepted,false);assert.equal(out.restored,false);assert.ok(out.normalError);assert.equal(out.restoreError,out.normalError);assert.deepEqual(out.calls.normal,{writes:0,readwrite:0});assert.deepEqual(out.calls.restore,{writes:0,readwrite:0});assert.deepEqual(out.afterNormal,out.beforeNormal);assert.deepEqual(out.afterRestore,out.beforeRestore);
});
for(const [index,label] of [[1,'prior generation'],[2,'current generation']])test('restore applies normal format admission to '+label+' attachments, not only removed history',async()=>{
  const out=await admissionParity(await parityPackage(badFormats[0],index));assert.equal(out.normalAccepted,false);assert.equal(out.restored,false);assert.equal(out.restoreError,out.normalError);assert.deepEqual(out.calls.restore,{writes:0,readwrite:0});assert.deepEqual(out.afterRestore,out.beforeRestore);
});
test('valid Office passes normal upload and historical restore with identical container bytes and original record semantics',async()=>{
  const input=await parityPackage({name:'synthetic.docx',type:DOCX,data:officeBytes()},1),out=await admissionParity(input);assert.equal(out.normalAccepted,true);assert.equal(out.restored,true);assert.equal(out.normalError,'');assert.equal(out.restoreError,'');assert.ok(out.calls.normal.writes>0);assert.equal(out.calls.restore.writes,4);assert.equal(out.calls.restore.readwrite,1);const restored=out.afterRestore.records.find(row=>row.quoteId===P);assert.equal(JSON.stringify(restored.record),input.expectedRecord);const original=out.afterRestore.files.find(file=>file.id===input.sourceFileId),normal=out.afterRestore.files.find(file=>file.quoteId===OTHER);assert.ok(original);assert.ok(normal);assert.equal(original.blob.sha256,input.expectedHash);assert.equal(normal.blob.sha256,input.expectedHash);assert.equal(original.blob.size,input.data.length);assert.equal(normal.blob.size,input.data.length);assert.equal(original.blob.type,DOCX);assert.equal(out.afterRestore.files.filter(file=>file.quoteId===P).length,3);assert.deepEqual(out.afterRestore.files.filter(file=>file.quoteId===OTHER),out.beforeRestore.files.filter(file=>file.quoteId===OTHER));
});
test('normal filename normalization cannot silently rename a historical original during restore',async()=>{
  const out=await admissionParity(await parityPackage({name:'CON.txt',type:'text/plain',data:Buffer.from('synthetic reserved-name original')},0));assert.equal(out.normalAccepted,true);assert.equal(out.normalName,'_CON.txt');assert.equal(out.restored,false);assert.match(out.restoreError,/保全元数据/);assert.deepEqual(out.calls.restore,{writes:0,readwrite:0});assert.deepEqual(out.afterRestore,out.beforeRestore);
});
test('an asynchronous context change during valid Office admission prevents any restore transaction or write',async()=>{
  const input=await parityPackage({name:'synthetic.docx',type:DOCX,data:officeBytes()},0),out=await inPage(async x=>{
    const api=await AuditChecklist.open(),arrayBuffer=Blob.prototype.arrayBuffer,add=IDBObjectStore.prototype.add,put=IDBObjectStore.prototype.put,transaction=IDBDatabase.prototype.transaction;let changed=false,reads=0,writes=0,readwrite=0,checks=0;
    try{
      const before=await sec.snapshot();Blob.prototype.arrayBuffer=async function(){const result=await arrayBuffer.call(this);if(this.type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'&&!changed){reads++;await Promise.resolve();changed=true;}return result;};
      IDBObjectStore.prototype.add=function(...args){writes++;return add.apply(this,args);};IDBObjectStore.prototype.put=function(...args){writes++;return put.apply(this,args);};IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')readwrite++;return transaction.apply(this,args);};
      let error='';try{await api.restorePreservation(x.id,sec.blob(x.raw),{expectedSha256:x.digest,assertContext(){checks++;if(changed)throw Error('synthetic view changed during file admission');}});}catch(cause){error=cause.message;}
      return {before,after:await sec.snapshot(),changed,reads,writes,readwrite,checks,error};
    }finally{Blob.prototype.arrayBuffer=arrayBuffer;IDBObjectStore.prototype.add=add;IDBObjectStore.prototype.put=put;IDBDatabase.prototype.transaction=transaction;api.close();}
  },input);assert.equal(out.changed,true);assert.equal(out.reads,1);assert.match(out.error,/view changed during file admission/);assert.ok(out.checks>1);assert.equal(out.writes,0);assert.equal(out.readwrite,0);assert.deepEqual(out.after,out.before);
});
