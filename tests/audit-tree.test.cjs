/* Schema-2 hierarchy and atomic local materials; synthetic data only. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const A=require('../dist/audit-checklist.js'),ID='4a502e25-69a2-4ff6-b37f-d06a1598eb12';
const project={quoteId:ID,projectName:'虚构标题资料项目',firmName:'虚构所'};
const nodes=[{id:'n1',parentId:'',level:1,title:'一、基础资料',description:'分组说明，不拆项'},
 {id:'n2',parentId:'n1',level:2,title:'（一）营业执照',description:'正文两行\n仍属于本标题'},
 {id:'n3',parentId:'n1',level:2,title:'（二）银行资料',description:''}];
const tree=()=>A.createTree(project,nodes,'虚构导入人');
const review=(r,id,status,extra={})=>A.apply(r,{type:'item',id,status,evidence:'',reason:'',reviewer:'虚构核对人',...extra});
function metadata(r,id='n2',size=10){return {id:crypto.randomUUID(),nodeId:id,generationId:r.generationId,name:'synthetic.txt',size,type:'text/plain',sha256:'a'.repeat(64)};}
const attach=(r,id='n2',size=10)=>A.apply(r,{type:'attachment-add',nodeId:id,file:metadata(r,id,size),reviewer:'虚构上传人'});

test('schema2 leaf-only gate keeps title hierarchy and descriptions without extra material items',()=>{
 const r=tree();assert.equal(r.schema,2);assert.deepEqual(Object.keys(r.states),['n2','n3']);assert.deepEqual(Object.keys(r.attachments),['n2','n3']);
 assert.deepEqual(A.leafNodes(r).map(x=>x.id),['n2','n3']);assert.equal(A.gate(r).total,2);assert.deepEqual(A.gate(r).blockers,['n2','n3']);
 assert.throws(()=>review(r,'n1','confirmed',{evidence:'WP-01'}),/叶标题/);assert.throws(()=>attach(r,'n1'),/叶标题/);
 assert.equal(r.nodes[1].description,'正文两行\n仍属于本标题');assert.equal(nodes[0].description,r.nodes[0].description);
});

test('invalid trees and forged schema2 current state or event history are rejected',()=>{
 for(const edit of [n=>n[1].parentId='n3',n=>n[1].parentId='n2',n=>n[2].id='n2',n=>n[1].level=1,n=>n[1].level=10,n=>n[1].extra=true,n=>n[1].title='']){const n=structuredClone(nodes);edit(n);assert.throws(()=>A.createTree(project,n,'虚构人员'));}
 assert.throws(()=>A.createTree(project,[],'虚构人员'));assert.throws(()=>A.createTree(project,Array(501).fill(nodes[0]),'虚构人员'));
 const r=attach(tree());
 for(const edit of [r=>r.nodes[1].title='改标题未留痕',r=>r.states.n1=r.states.n2,r=>r.attachments.n2[0].sha256='bad',r=>r.events[1].file.generationId=crypto.randomUUID(),r=>r.revision++,r=>r.events[0].nodes[1].title=' '+r.events[0].nodes[1].title]){const b=structuredClone(r);edit(b);assert.throws(()=>A.validate(b));}
});

test('schema1 stays exact and readable; explicit conversion retains original state and all history',()=>{
 let old=A.create(project,A.parse('一、原资料\n9. 原始资料'),'虚构人员');old=review(old,'i1','confirmed',{evidence:'OLD-WP'});
 const before=JSON.stringify(old);assert.equal(A.validate(old),old);const r=A.createTree(project,nodes,'虚构人员','按标题重整',old);
 assert.equal(JSON.stringify(old),before);assert.deepEqual(r.legacy,old);assert.equal(r.revision,old.revision+1);assert.equal(A.gate(r).ready,false);
 assert.equal(r.legacy.states.i1.evidence,'OLD-WP');assert.throws(()=>A.createTree(project,nodes,'虚构人员','',old));
 const closed=A.apply(old,{type:'close',reviewer:'虚构人员'});assert.throws(()=>A.createTree(project,nodes,'虚构人员','不能越过关门',closed),/关门/);
});

test('uploads always reset reviewed/NA leaves to received and removal resets received or pending',()=>{
 let r=review(tree(),'n2','na',{reason:'原不适用'});r=attach(r);assert.equal(r.states.n2.status,'received');assert.equal(r.attachments.n2.length,1);
 r=review(r,'n2','confirmed',{evidence:'FILE-WP'});r=attach(r);assert.equal(r.states.n2.status,'received');assert.equal(r.attachments.n2.length,2);
 const first=r.attachments.n2[0].id;r=A.apply(r,{type:'attachment-remove',nodeId:'n2',fileId:first,reviewer:'虚构人员',reason:'解除旧版关联'});assert.equal(r.states.n2.status,'received');
 r=A.apply(r,{type:'attachment-remove',nodeId:'n2',fileId:r.attachments.n2[0].id,reviewer:'虚构人员',reason:'解除第二版关联'});assert.equal(r.states.n2.status,'pending');assert.equal(r.attachments.n2.length,0);assert.equal(r.events.filter(x=>x.type==='attachment-add').length,2);
});

test('reimport preserves explicit complete old nodes/states/attachments and new generation starts unreviewed',()=>{
 let r=attach(tree());r=review(r,'n2','confirmed',{evidence:'WP'});const old=structuredClone(r);
 const next=A.apply(r,{type:'tree-replace',nodes:[{id:'n1',parentId:'',level:1,title:'新的同名叶标题',description:''}],reviewer:'虚构人员',reason:'重新整理结构'}),e=next.events.at(-1);
 assert.deepEqual(e.oldNodes,old.nodes);assert.deepEqual(e.oldStates,old.states);assert.deepEqual(e.oldAttachments,old.attachments);assert.notEqual(next.generationId,old.generationId);
 assert.equal(next.states.n1.status,'pending');assert.deepEqual(next.attachments.n1,[]);assert.equal(JSON.stringify(r),JSON.stringify(old));
 const tampered=structuredClone(next);tampered.events.at(-1).oldAttachments.n2=[];assert.throws(()=>A.validate(tampered));
});

test('explicit close considers all leaves and freezes files/tree until reasoned reopen',()=>{
 let r=tree();r=review(r,'n2','confirmed',{evidence:'WP2'});assert.throws(()=>A.apply(r,{type:'close',reviewer:'虚构人员'}),/未核对/);
 r=review(r,'n3','na',{reason:'无此业务'});assert.equal(A.gate(r).ready,true);assert.equal(r.closed,null);r=A.apply(r,{type:'close',reviewer:'虚构人员'});
 for(const cmd of [{type:'item',id:'n2',status:'received'},{type:'attachment-add',nodeId:'n2',file:metadata(r)},{type:'tree-replace',nodes,reason:'不能绕过'}])assert.throws(()=>A.apply(r,{...cmd,reviewer:'虚构人员'}),/关门/);
 assert.throws(()=>A.apply(r,{type:'reopen',reviewer:'虚构人员',reason:''}));const open=A.apply(r,{type:'reopen',reviewer:'虚构人员',reason:'收到新版资料'});assert.equal(open.closed,null);assert.equal(attach(open).states.n2.status,'received');
});

test('per-leaf count and total historical bytes limits cannot be bypassed with removals/reimports',()=>{
 let r=tree();for(let i=0;i<10;i++)r=attach(r);assert.throws(()=>attach(r),/10/);
 const big=12*1024*1024;let s=tree();for(let i=0;i<12;i++){s=attach(s,'n2',big);s=A.apply(s,{type:'attachment-remove',nodeId:'n2',fileId:s.attachments.n2[0].id,reviewer:'虚构人员',reason:'保留旧版但解除当前关联'});}
 assert.throws(()=>attach(s,'n2',big),/150/);const next=A.apply(s,{type:'tree-replace',nodes,reviewer:'虚构人员',reason:'重新整理但不能重置总量'});assert.throws(()=>attach(next,'n2',big),/150/);
});

test('v1 IndexedDB upgrade preserves exact legacy bytes; attachment CAS, rollback and historical downloads are atomic and isolated',async t=>{
 let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('Playwright unavailable');}const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(executable))return t.skip('Chromium unavailable');
 const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});
 try{
  const ctx=await browser.newContext({serviceWorkers:'block'}),p=await ctx.newPage();await p.goto(pathToFileURL(path.join(__dirname,'../dist/rule-catalog.js')).href);await p.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../dist/audit-checklist.js'),'utf8')});
  const result=await p.evaluate(async({project,nodes})=>{
   const A=AuditChecklist,id=project.quoteId,trial=A.TRIAL_ID,error=async p=>{try{await p;return '';}catch(e){return e.message;}},legacy=A.create(project,A.parse('旧资料'),'虚构人员');
   const seed=await new Promise((ok,no)=>{const q=indexedDB.open('hengdu.audit.materials.v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('checklists',{keyPath:'quoteId'});q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});
   await new Promise((ok,no)=>{const tx=seed.transaction('checklists','readwrite');tx.objectStore('checklists').put({quoteId:id,record:legacy});tx.oncomplete=ok;tx.onabort=()=>no(tx.error);});seed.close();
   const a=await A.open(),b=await A.open(),tr=await A.openTrial();
   async function rawRows(){const d=await new Promise(ok=>{const q=indexedDB.open('hengdu.audit.materials.v1');q.onsuccess=()=>ok(q.result);});try{return await new Promise(ok=>{const q=d.transaction('materialFiles').objectStore('materialFiles').getAll();q.onsuccess=()=>ok(q.result);});}finally{d.close();}}
   try{
    const preserved=JSON.stringify(await a.get(id))===JSON.stringify(legacy),v2=await a.importTree(project,nodes,'虚构人员','按标题整理',legacy.revision);
    const file=()=>new File(['fictional file bytes'],'../synthetic\nfile.txt',{type:'application/octet-stream'});
    const races=await Promise.allSettled([a.attach(id,v2.revision,'n2',file(),'虚构甲'),b.attach(id,v2.revision,'n2',file(),'虚构乙')]);
    let r=await a.get(id);const f=r.attachments.n2[0],download=await a.downloadAttachment(id,'n2',f.id),before=JSON.stringify(r),storedBefore=(await rawRows()).length;
    const stale=await error(a.attach(id,v2.revision,'n2',file(),'虚构甲')),parent=await error(a.attach(id,r.revision,'n1',file(),'虚构甲'));
    const bypass=await error(a.change(id,r.revision,{type:'attachment-add',nodeId:'n2',reviewer:'虚构甲',file:f}));
    const unsupported=await error(a.attach(id,r.revision,'n2',new File(['oops'],'fake.pdf',{type:'application/pdf'}),'虚构甲'));
    const afterFailed=JSON.stringify(await a.get(id))===before,filesAfterFailed=(await rawRows()).length===storedBefore;
    r=await a.removeAttachment(id,r.revision,'n2',f.id,'虚构人员','解除关联但保留历史');const detached=await a.downloadAttachment(id,'n2',f.id);
    r=await a.importTree(project,[{id:'n1',parentId:'',level:1,title:'新版标题',description:''}],'虚构人员','重新导入',r.revision);const historical=await a.downloadAttachment(id,'n2',f.id);
    const cross=await error(tr.downloadAttachment(id,'n2',f.id));const wrongNode=await error(a.downloadAttachment(id,'n3',f.id));
    // Inject a storage failure after Blob.add has been issued; IDB abort rolls both stores back.
    const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='checklists')throw new DOMException('synthetic quota','QuotaExceededError');return original.apply(this,args);};
    let quota;try{quota=await error(a.attach(id,r.revision,'n1',file(),'虚构人员'));}finally{IDBObjectStore.prototype.put=original;}
    const rolledBack=JSON.stringify(await a.get(id))===JSON.stringify(r)&&(await rawRows()).length===storedBefore;
    r=await a.change(id,r.revision,{type:'item',id:'n1',status:'na',reason:'虚构业务不适用',reviewer:'虚构人员'});r=await a.change(id,r.revision,{type:'close',reviewer:'虚构人员'});
    const closedFileBlocked=!!await error(a.attach(id,r.revision,'n1',file(),'虚构人员'))&&(await rawRows()).length===storedBefore,closedDownload=await (await a.downloadAttachment(id,'n2',f.id)).blob.text()==='fictional file bytes';
    const trialRecord=await tr.importTree({quoteId:trial,projectName:'独立试用',firmName:''},nodes,'虚构人员','',0);await tr.attach(trial,trialRecord.revision,'n2',new File(['trial bytes'],'trial.txt'),'虚构人员');
    const noTrialInMain=await a.get(trial)===null,crossCreate=await error(a.importTree({quoteId:trial,projectName:'非法混用',firmName:''},nodes,'虚构人员','',0));
    return {preserved,legacySaved:JSON.stringify(v2.legacy)===JSON.stringify(legacy),success:races.filter(x=>x.status==='fulfilled').length,rejected:races.filter(x=>x.status==='rejected').length,
     bytes:await download.blob.text(),sameHistorical:await detached.blob.text()===await historical.blob.text(),safeName:f.name==='_synthetic_file.txt',stale:!!stale,parent:!!parent,bypass:!!bypass,unsupported:!!unsupported,afterFailed,filesAfterFailed,cross:!!cross,wrongNode:!!wrongNode,quota:!!quota,rolledBack,closedFileBlocked,closedDownload,noTrialInMain,crossCreate:!!crossCreate};
   }finally{a.close();b.close();tr.close();}
  },{project,nodes});
  assert.deepEqual(result,{preserved:true,legacySaved:true,success:1,rejected:1,bytes:'fictional file bytes',sameHistorical:true,safeName:true,stale:true,parent:true,bypass:true,unsupported:true,afterFailed:true,filesAfterFailed:true,cross:true,wrongNode:true,quota:true,rolledBack:true,closedFileBlocked:true,closedDownload:true,noTrialInMain:true,crossCreate:true});
 }finally{await browser.close();}
});


test('explicit node kinds exclude empty groups while preserving legacy five-field leaf semantics',()=>{
 const typed=nodes.map((n,i)=>({...n,kind:i?'material':'group'})).concat([{id:'n4',parentId:'',level:1,title:'四、审计中取得的其他资料',description:'',kind:'group'}]);
 const r=A.createTree(project,typed,'虚构人员');assert.deepEqual(r.nodes,typed);assert.deepEqual(Object.keys(r.states),['n2','n3']);assert.deepEqual(Object.keys(r.attachments),['n2','n3']);assert.deepEqual(A.leafNodes(r).map(n=>n.id),['n2','n3']);assert.equal(A.gate(r).total,2);
 assert.throws(()=>review(r,'n4','na',{reason:'空组不能确认'}),/叶标题/);assert.throws(()=>attach(r,'n4'),/叶标题/);
 let done=review(r,'n2','na',{reason:'不适用'});done=review(done,'n3','confirmed',{evidence:'WP-03'});assert.equal(A.gate(done).ready,true);assert.ok(A.apply(done,{type:'close',reviewer:'虚构人员'}).closed);
 const oldNode={id:'n1',parentId:'',level:1,title:'旧版无子节点标题',description:''},legacy=A.createTree(project,[oldNode],'虚构人员');const before=JSON.stringify(legacy);
 assert.equal(A.gate(legacy).total,1);assert.deepEqual(Object.keys(legacy.states),['n1']);assert.equal(A.validate(legacy),legacy);assert.equal(JSON.stringify(legacy),before);assert.ok(!Object.hasOwn(legacy.nodes[0],'kind'));assert.ok(!Object.hasOwn(legacy.events[0].nodes[0],'kind'));
});

test('kind must be exact, material cannot be a parent, and forged all-group close cannot bypass the gate',()=>{
 for(const kind of ['','folder','leaf',null,undefined,0])assert.throws(()=>A.createTree(project,[{id:'n1',parentId:'',level:1,title:'类型错误',description:'',kind}],'虚构人员'),/类型/);
 assert.throws(()=>A.createTree(project,nodes.map((n,i)=>i?{...n,kind:'material'}:{...n,kind:'material'}),'虚构人员'),/不能含子标题/);
 const groups=[{id:'n1',parentId:'',level:1,title:'空分类',description:'',kind:'group'},{id:'n2',parentId:'n1',level:2,title:'子空组',description:'',kind:'group'}],r=A.createTree(project,groups,'虚构人员');
 assert.deepEqual(r.states,{});assert.deepEqual(r.attachments,{});assert.deepEqual(A.leafNodes(r),[]);assert.deepEqual(A.gate(r),{ready:false,total:0,confirmed:0,excluded:0,blockers:[],closed:false});assert.throws(()=>A.apply(r,{type:'close',reviewer:'虚构人员'}),/未核对/);
 const forged=structuredClone(r),at=r.events[0].at;forged.revision=2;forged.closed={at,reviewer:'伪造',revision:2};forged.events.push({type:'close',at,reviewer:'伪造',revision:2});assert.throws(()=>A.validate(forged),/不能关门/);
 const fakeState=structuredClone(r);fakeState.states.n2={status:'na',evidence:'',reason:'不能伪造空组通过',reviewer:'伪造',at};assert.throws(()=>A.validate(fakeState));
 const mixed=A.createTree(project,[nodes[0],{...nodes[1],kind:'material'},{...nodes[2],kind:'material'}],'虚构人员');assert.ok(!Object.hasOwn(mixed.nodes[0],'kind'));assert.equal(A.gate(mixed).total,2);
});

test('stored schema2 five-field history and files read unchanged; explicit kind import preserves historical versions and DB version',async t=>{
 let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('Playwright unavailable');}const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(executable))return t.skip('Chromium unavailable');
 const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});
 try{
  const ctx=await browser.newContext({serviceWorkers:'block'}),p=await ctx.newPage(),requests=[],errors=[];ctx.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))requests.push(r.url());});p.on('pageerror',e=>errors.push(e.message));
  await p.goto(pathToFileURL(path.join(__dirname,'../dist/rule-catalog.js')).href);await p.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../dist/audit-checklist.js'),'utf8')});
  const result=await p.evaluate(async project=>{
   const A=AuditChecklist,id=project.quoteId,error=async p=>{try{await p;return false;}catch{return true;}},oldNodes=[{id:'n1',parentId:'',level:1,title:'旧版空分类实际按叶项核对',description:'旧状态不能自动改变'}];
   let a=await A.open();let r=await a.importTree(project,oldNodes,'虚构旧人员','',0);r=await a.attach(id,r.revision,'n1',new File(['V36-original-bytes'],'v36-original.txt'),'虚构旧人员');const oldFile=r.attachments.n1[0];r=await a.change(id,r.revision,{type:'item',id:'n1',status:'confirmed',evidence:'OLD-WP',reviewer:'虚构旧人员'});const oldSnapshot=JSON.stringify(r);a.close();
   async function raw(){const d=await new Promise((ok,no)=>{const q=indexedDB.open('hengdu.audit.materials.v1');q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});try{return await new Promise((ok,no)=>{const q=d.transaction('checklists').objectStore('checklists').get(id);q.onsuccess=()=>ok({record:JSON.stringify(q.result.record),dbVersion:d.version,stores:Array.from(d.objectStoreNames)});q.onerror=()=>no(q.error);});}finally{d.close();}}
   const before=await raw();a=await A.open();
   try{
    const loaded=await a.get(id),unchanged=JSON.stringify(loaded)===oldSnapshot&&(await raw()).record===before.record,oldKindsAbsent=loaded.nodes.every(n=>!Object.hasOwn(n,'kind'))&&loaded.events[0].nodes.every(n=>!Object.hasOwn(n,'kind')),oldGate=A.gate(loaded).total;
    const explicit=[{id:'n1',parentId:'',level:1,title:'四、明确空组',description:'',kind:'group'},{id:'n2',parentId:'',level:1,title:'资料项',description:'',kind:'material'}];
    r=await a.importTree(project,explicit,'虚构新人员','明确分组与资料，不静默迁移',loaded.revision);const event=r.events.at(-1),historyExact=JSON.stringify(event.oldNodes)===JSON.stringify(loaded.nodes)&&JSON.stringify(event.oldStates)===JSON.stringify(loaded.states)&&JSON.stringify(event.oldAttachments)===JSON.stringify(loaded.attachments);
    const currentOnlyMaterial=JSON.stringify(Object.keys(r.states))==='["n2"]'&&JSON.stringify(Object.keys(r.attachments))==='["n2"]',gateTotal=A.gate(r).total;
    const groupAttachBlocked=await error(a.attach(id,r.revision,'n1',new File(['not allowed'],'blocked.txt'),'虚构人员')),groupReviewBlocked=await error(a.change(id,r.revision,{type:'item',id:'n1',status:'na',reason:'不能跳过子项',reviewer:'虚构人员'}));
    const historical=await a.downloadAttachment(id,'n1',oldFile.id);r=await a.attach(id,r.revision,'n2',new File(['v37-current-bytes'],'v37-current.txt'),'虚构人员');const currentFile=r.attachments.n2[0];r=await a.change(id,r.revision,{type:'item',id:'n2',status:'confirmed',evidence:'NEW-WP',reviewer:'虚构人员'});r=await a.change(id,r.revision,{type:'close',reviewer:'虚构人员'});
    const oneMaterialCanClose=!!r.closed&&A.gate(r).total===1,oldBytesWhileClosed=await(await a.downloadAttachment(id,'n1',oldFile.id)).blob.text();r=await a.change(id,r.revision,{type:'reopen',reason:'验证全为空组不得关门',reviewer:'虚构人员'});
    r=await a.importTree(project,[{id:'n1',parentId:'',level:1,title:'只有空组',description:'',kind:'group'}],'虚构人员','保留所有文件历史但没有当前资料项',r.revision);const allGroupsGate=A.gate(r),allGroupsBefore=JSON.stringify(r),emptyCloseBlocked=await error(a.change(id,r.revision,{type:'close',reviewer:'虚构人员'}));
    const stillUnchanged=JSON.stringify(await a.get(id))===allGroupsBefore,historicalCurrentBytes=await(await a.downloadAttachment(id,'n2',currentFile.id)).blob.text(),after=await raw();
    return {unchanged,oldKindsAbsent,oldGate,historyExact,currentOnlyMaterial,gateTotal,groupAttachBlocked,groupReviewBlocked,historical:await historical.blob.text(),oneMaterialCanClose,oldBytesWhileClosed,allGroupsGate,emptyCloseBlocked,stillUnchanged,historicalCurrentBytes,dbVersion:after.dbVersion,stores:after.stores};
   }finally{a.close();}
  },project);
  assert.deepEqual(result,{unchanged:true,oldKindsAbsent:true,oldGate:1,historyExact:true,currentOnlyMaterial:true,gateTotal:1,groupAttachBlocked:true,groupReviewBlocked:true,historical:'V36-original-bytes',oneMaterialCanClose:true,oldBytesWhileClosed:'V36-original-bytes',allGroupsGate:{ready:false,total:0,confirmed:0,excluded:0,blockers:[],closed:false},emptyCloseBlocked:true,stillUnchanged:true,historicalCurrentBytes:'v37-current-bytes',dbVersion:2,stores:['checklists','materialFiles']});assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 }finally{await browser.close();}
});
