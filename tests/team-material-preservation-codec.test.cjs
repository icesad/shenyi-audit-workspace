'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {A,M,fixture,create,createTeam,source,bytes,clone,sha,canonical,unzip,zip,manifest,rewrite,ORIGIN,P,OTHER,many}=require('./helpers/team-material-preservation-codec-fixture.cjs');
const {inspectMaterialPackage}=require('../shared/material-admission.cjs');

test('v2 retains exact closed record bytes, removed and old-generation originals, and summary14',async()=>{
 const f=fixture(),before=JSON.stringify(f.record),made=await createTeam(f),read=await M.inspect(made.blob),entries=unzip(await bytes(made.blob)),{plan,origin}=source(f.record);
 assert.equal(read.manifest.schemaVersion,2);assert.deepEqual(Object.keys(read.manifest).sort(),['format','schemaVersion','packageId','createdAt','sourceNamespace','projectId','record','files','policy','origin'].sort());
 assert.deepEqual(Object.keys(read.manifest.origin).sort(),ORIGIN.slice().sort());assert.deepEqual(read.manifest.origin,origin);assert.equal(plan.projectRevision,Number.MAX_SAFE_INTEGER);assert.equal(plan.materialRevision,Number.MAX_SAFE_INTEGER);
 assert.equal(read.manifest.projectId,P);assert.equal(read.manifest.origin.projectId,OTHER);assert.equal(JSON.stringify(read.record),before);assert.equal(entries.find(e=>e.name==='record.json').data.toString(),before);assert.equal(JSON.stringify(f.record),before);
 assert.equal(read.manifest.policy.teamImported,true);assert.equal(read.manifest.policy.identityAuthenticated,false);assert.equal(read.manifest.policy.professionalApprovalClaimed,false);
 assert.equal(Object.keys(read.summary).length,14);assert.deepEqual(read.summary,made.summary);assert.equal(read.summary.closed,true);assert.equal(read.summary.fileCount,3);assert.equal(read.summary.currentFileCount,1);assert.equal(read.summary.historicalFileCount,2);
 assert.equal(read.sha256,sha(await bytes(made.blob)));assert.deepEqual(read.files.map(file=>file.metadata),f.originals.map(file=>file.metadata));for(let i=0;i<read.files.length;i++)assert.deepEqual(await bytes(read.files[i].blob),f.originals[i].data);
});
for(const kind of ['legacy','collection-workspace'])test('explicit '+kind+' allows W=Q without guessing kind',async()=>{
 const f=fixture(),{origin}=source(f.record,{resourceKind:kind,projectId:P});const made=await createTeam(f,{origin,readCurrent:async()=>({record:f.record,origin})});assert.equal((await M.inspect(made.blob)).manifest.origin.resourceKind,kind);
});
for(const schema of [1,2])test('v2 schema'+schema+' permits valid zero-original record without inventing bytes',async()=>{
 const f=schema===1?fixture({v1:true}):{record:A.createTree({quoteId:P,projectName:'合成项目',firmName:'合成机构'},[{id:'n1',parentId:'',level:1,title:'合成资料',description:''}],'历史姓名'),readFile:async()=>assert.fail('no originals')};
 const made=await createTeam(f),read=await M.inspect(made.blob);assert.equal(read.files.length,0);assert.equal(read.summary.fileCount,0);assert.equal(read.manifest.record.generationId,schema===1?null:f.record.generationId);assert.equal(unzip(await bytes(made.blob)).length,2);
});
test('old create keeps original exact options and original v1 policy and keys',async()=>{
 const f=fixture(),made=await create(f),read=await M.inspect(made.blob);assert.equal(read.manifest.schemaVersion,1);assert.equal(read.manifest.policy.teamImported,false);assert.equal(Object.hasOwn(read.manifest,'origin'),false);assert.equal(Object.keys(read.summary).length,14);
 await assert.rejects(create(f,{origin:source(f.record).origin}));await assert.rejects(create(f,{assertCurrent(){}}));await assert.rejects(createTeam(f,{record:null}));
});
for(const [label,change] of [
 ['missing origin key',o=>{delete o.serverId;}],['unknown origin key',o=>{o.extra=true;}],['legacy W/Q mismatch',o=>{o.resourceKind='legacy';}],['other source Q',o=>{o.sourceProjectId=OTHER;}],['unknown kind',o=>{o.resourceKind='workspace';}],['archived source',o=>{o.projectStatus='archived';}],['zero project revision',o=>{o.projectRevision=0;}],['unsafe material revision',o=>{o.materialRevision=Number.MAX_SAFE_INTEGER+1;}],['wrong raw record hash',o=>{o.recordSha256='0'.repeat(64);}],['wrong record byte count',o=>{o.recordByteLength++;}],['wrong metadata hash',o=>{o.filesSha256='0'.repeat(64);}],['wrong plan hash',o=>{o.planSha256='0'.repeat(64);}],['invalid service UUID',o=>{o.serverId='https://example.invalid/';}],['invalid team id',o=>{o.teamId='../other';}]
])test('creation rejects '+label+' before reading any original',async()=>{
 const f=fixture(),{origin}=source(f.record);change(origin);let reads=0;await assert.rejects(createTeam(f,{origin,readFile:async()=>{reads++;assert.fail('bad origin cannot authorize I/O');}}));assert.equal(reads,0);
});
test('origin accessors are never invoked and inputs are owned before the first await',async()=>{
 const f=fixture(),{origin}=source(f.record),initial=clone(origin),record=clone(f.record);let gets=0;
 const bad=clone(origin);Object.defineProperty(bad,'teamId',{enumerable:true,get(){gets++;return origin.teamId;}});await assert.rejects(createTeam(f,{origin:bad}));assert.equal(gets,0);
 const pending=createTeam(f,{origin,readCurrent:async()=>({record,origin:initial})});origin.teamId='changed';f.record.project.projectName='changed';const made=await pending;assert.deepEqual(made.manifest.origin,initial);assert.equal(made.summary.projectName,record.project.projectName);
});
for(const kind of ['record','origin','partial joint','extra joint'])test('final full joint snapshot rejects '+kind+' change after all original reads',async()=>{
 const f=fixture(),{origin}=source(f.record);let reads=0;
 await assert.rejects(createTeam(f,{origin,readFile:async meta=>{reads++;return f.readFile(meta);},readCurrent:async()=>{assert.equal(reads,3);if(kind==='record'){const record=clone(f.record);record.project.projectName='same revision different record';return {record,origin};}if(kind==='origin')return {record:f.record,origin:{...origin,projectRevision:1}};if(kind==='partial joint')return {record:f.record};return {record:f.record,origin,extra:true};}}));
});
test('current guard cancels after awaited file and final snapshot without returning a package',async()=>{
 for(const point of ['file','current']){const f=fixture();let allowed=true,reads=0,currents=0;await assert.rejects(createTeam(f,{assertCurrent(){if(!allowed)throw Error('synthetic revoked');},readFile:async meta=>{reads++;const result=await f.readFile(meta);if(point==='file')allowed=false;return result;},readCurrent:async()=>{currents++;allowed=false;return {record:f.record,origin:source(f.record).origin};}}),/synthetic revoked/);assert.equal(reads,point==='file'?1:3);assert.equal(currents,point==='file'?0:1);}
});
test('every createTeam guard gate can stop publication',async()=>{
 const f=fixture();let calls=0;await createTeam(f,{assertCurrent(){calls++;}});assert.ok(calls>=30);
 for(let stop=1;stop<=calls;stop++){let at=0;await assert.rejects(createTeam(f,{assertCurrent(){if(++at===stop)throw Error('synthetic revoked');}}),/synthetic revoked/);assert.equal(at,stop);}
});
test('optional inspect guard cancels each gate and legacy one-argument inspection remains valid',async()=>{
 const made=await createTeam();let count=0;await M.inspect(made.blob,{assertCurrent(){count++;}});assert.ok(count>=16);
 for(let stop=1;stop<=count;stop++){let at=0;await assert.rejects(M.inspect(made.blob,{assertCurrent(){if(++at===stop)throw Error('inspect revoked');}}),/inspect revoked/);assert.equal(at,stop);}
 for(const options of [{assertCurrent:null},{assertCurrent:1},{extra:true}])await assert.rejects(M.inspect(made.blob,options));assert.equal((await M.inspect(made.blob)).manifest.schemaVersion,2);
});
test('v2 inspection owns Buffer bytes before its first await',async()=>{
 const made=await createTeam(),input=await bytes(made.blob),pending=M.inspect(input);input.fill(0);assert.equal((await pending).sha256,made.sha256);
});
for(const [label,change] of [
 ['partial origin',m=>{delete m.origin.recordByteLength;}],['extra origin',m=>{m.origin.identityAuthenticated=true;}],['missing origin',m=>{delete m.origin;}],['v1 with origin',m=>{m.schemaVersion=1;m.policy.teamImported=false;}],['v2 false provenance policy',m=>{m.policy.teamImported=false;}],['authenticated identity claim',m=>{m.policy.identityAuthenticated=true;}],['professional approval claim',m=>{m.policy.professionalApprovalClaimed=true;}],['unsupported version',m=>{m.schemaVersion=3;}],['wrong W/kind binding',m=>{m.origin.resourceKind='legacy';}],['wrong Q',m=>{m.origin.sourceProjectId=OTHER;}],['wrong manifest Q',m=>{m.projectId=OTHER;}],['wrong files hash',m=>{m.origin.filesSha256='0'.repeat(64);}],['wrong plan hash',m=>{m.origin.planSha256='0'.repeat(64);}],['swapped history file order',m=>{m.files.reverse();}]
])test('v2 inspection rejects '+label+' even with valid ZIP CRCs',async()=>{
 const made=await createTeam();await assert.rejects(M.inspect(await rewrite(made,entries=>manifest(entries,change))));
});
test('plan digest binds record bytes even after valid record and origin hashes are recomputed',async()=>{
 const made=await createTeam(),bad=await rewrite(made,entries=>{const e=entries.find(e=>e.name==='record.json'),record=JSON.parse(e.data);record.project.firmName='同长度不同机构';e.data=Buffer.from(JSON.stringify(record));manifest(entries,m=>{m.record.sha256=sha(e.data);m.record.bytes=e.data.length;m.origin.recordSha256=m.record.sha256;m.origin.recordByteLength=m.record.bytes;});});await assert.rejects(M.inspect(bad),/计划摘要/);
});
test('metadata digest covers complete original metadata, not only inventory SHA and length',async()=>{
 const f=fixture(),made=await createTeam(f),bad=await rewrite(made,entries=>{const e=entries.find(e=>e.name==='record.json'),record=JSON.parse(e.data);function change(value){if(value&&typeof value==='object'){if(value.id===f.originals[0].metadata.id&&Object.hasOwn(value,'name'))value.name='另一个文件.txt';for(const child of Object.values(value))change(child);}}change(record);A.validate(record);e.data=Buffer.from(JSON.stringify(record));manifest(entries,m=>{m.record.sha256=sha(e.data);m.record.bytes=e.data.length;m.origin.recordSha256=m.record.sha256;m.origin.recordByteLength=m.record.bytes;});});await assert.rejects(M.inspect(bad),/元数据摘要/);
 const {origin}=source(f.record),metadata=M.filesFor(f.record);assert.notEqual(sha(Buffer.from(canonical(metadata.map(({id,size,sha256})=>({id,size,sha256}))))),origin.filesSha256);assert.equal(sha(Buffer.from(canonical(metadata))),origin.filesSha256);
});
test('internally consistent unsigned origin is only a declaration',async()=>{
 const f=fixture(),made=await createTeam(f),{origin}=source(f.record,{teamId:'different_team',projectId:P,resourceKind:'legacy',projectStatus:'active',projectRevision:1,materialRevision:1});
 const changed=await rewrite(made,entries=>manifest(entries,m=>{m.origin=origin;})),read=await M.inspect(changed);assert.equal(read.manifest.origin.teamId,'different_team');assert.equal(read.manifest.policy.identityAuthenticated,false);assert.notEqual(read.sha256,made.sha256);
});
for(const key of ['projectId','serverId'])test('self-consistent '+key+' array cannot masquerade as UUID text',async()=>{
 const f=fixture(),initial=source(f.record),{origin}=source(f.record,{[key]:[initial.origin[key]]}),made=await createTeam(f);let reads=0;
 await assert.rejects(createTeam(f,{origin,readFile:async()=>{reads++;}}));assert.equal(reads,0);await assert.rejects(M.inspect(await rewrite(made,entries=>manifest(entries,m=>{m.origin=origin;}))));
});
for(const part of ['create','inspect'])test('v2 '+part+' rejects trial records despite consistent checksums',async()=>{
 const f=fixture({id:A.TRIAL_ID}),{origin}=source(f.record);if(part==='create')await assert.rejects(createTeam(f,{origin}));else{const v1=await create(f);await assert.rejects(M.inspect(await rewrite(v1,entries=>manifest(entries,m=>{m.schemaVersion=2;m.policy.teamImported=true;m.origin=origin;}))));}
});
for(const kind of ['payload SHA','CRC','duplicate','unsafe path','extra original','too many ZIP members','oversize declaration'])test('v2 reuses strict ZIP boundary: '+kind,async()=>{
 const made=await createTeam(),entries=unzip(await bytes(made.blob));let raw;
 if(kind==='payload SHA'){entries[2].data[0]^=1;raw=zip(entries);}else if(kind==='CRC'){raw=await bytes(made.blob);const nameLength=raw.readUInt16LE(26);raw[30+nameLength]^=1;}else if(kind==='duplicate'){entries.push(entries[2]);raw=zip(entries);}else if(kind==='unsafe path'){entries[2].name='../outside.bin';raw=zip(entries);}else if(kind==='extra original'){entries.push({name:'originals/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.bin',data:Buffer.from('x')});raw=zip(entries);}else if(kind==='too many ZIP members'){raw=await bytes(made.blob);raw.writeUInt16LE(5003,raw.length-14);raw.writeUInt16LE(5003,raw.length-12);}else{raw=await bytes(made.blob);const c=raw.readUInt32LE(raw.length-6);raw.writeUInt32LE(4*1024*1024+1,c+20);raw.writeUInt32LE(4*1024*1024+1,c+24);}
 await assert.rejects(M.inspect(raw));
});
test('package and individual file limits remain unchanged for v2',async()=>{
 await assert.rejects(M.inspect(new Uint8Array(180*1024*1024+1)),/大小/);
 const f=fixture();for(const size of [12*1024*1024+1,Number.MAX_SAFE_INTEGER]){const bad=clone(f.record);function visit(v){if(v&&typeof v==='object'){if(v.id===f.originals[0].metadata.id&&Object.hasOwn(v,'size'))v.size=size;for(const child of Object.values(v))visit(child);}}visit(bad);await assert.rejects(createTeam(f,{record:bad}));}
});
test('4999 originals/5000 professional events round-trip; 5000 originals retain the old event ceiling',async()=>{
 const f=many();assert.equal(A.validate(f.record),f.record);assert.equal(f.record.events.length,5000);const made=await createTeam(f),read=await M.inspect(made.blob);assert.equal(read.files.length,4999);assert.equal(unzip(await bytes(made.blob)).length,5001);
 const invalid=many(5000);assert.throws(()=>A.validate(invalid.record),/结构/);let reads=0;await assert.rejects(createTeam(invalid,{readFile:async()=>{reads++;}}));assert.equal(reads,0);
});
test('team admission remains explicitly v1-only while v2 inspection stays readable',async()=>{
 const f=fixture(),v1=await create(f),v2=await createTeam(f);assert.equal((await inspectMaterialPackage(v1.blob)).manifest.schemaVersion,1);await assert.rejects(inspectMaterialPackage(v2.blob),/仅支持本机v1/);assert.equal((await M.inspect(v2.blob)).record.project.quoteId,P);
});

async function uiFixture(t,made,{targetId=P,existing=null}={}){
 const {JSDOM}=require('jsdom'),{readFileSync}=require('node:fs'),dom=new JSDOM('<section id="view"><main id="host"></main></section>',{url:'https://synthetic.invalid/',runScripts:'outside-only'}),w=dom.window,d=w.document,calls=[];let stored=existing;
 w.Blob=Blob;w.File=File;w.confirm=text=>{calls.push({kind:'confirm',text});return true;};
 const store={get:async()=>stored,restorePreservation:async(key,blob,options)=>{options.assertContext();calls.push({kind:'restore',key,blob,options});assert.equal(stored,null);const result=await M.inspect(blob);stored=result.record;return {record:stored,summary:result.summary,sha256:result.sha256};},close(){}};
 w.AuditChecklist={...A,open:async()=>store,openTrial:async()=>store};w.AuditMaterialTemplate={get:()=>[],stats:()=>({headings:0,materials:0}),label:'合成模板'};w.MaterialPreservation=M;
 w.eval(readFileSync(require.resolve('../dist/audit-program.js'),'utf8'));const controller=w.AuditProgram.mount(d.getElementById('host'),{listProjects:async()=>[{quoteId:targetId,form:{projectName:'合成目标'},source:{firmName:'合成机构'}}]});
 t.after(()=>{w.dispatchEvent(new w.Event('beforeunload'));w.close();});
 const id=name=>d.getElementById(name),fire=(name,type='click')=>id(name).dispatchEvent(new w.Event(type,{bubbles:true,cancelable:true}));
 async function until(check){for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,2));}assert.ok(check(),'expected synthetic legacy UI state');}
 await controller.show();id('ac-project').value=targetId;fire('ac-project','change');await until(()=>!id('ac-refresh').disabled);
 const file=new File([await bytes(made.blob)],'synthetic-v2.zip',{type:'application/zip'});Object.defineProperty(id('ac-preservation-file'),'files',{value:[file],configurable:true});fire('ac-preservation-file','change');
 await until(()=>!id('ac-refresh').disabled&&id('ac-preservation-summary').textContent.includes('包SHA-256'));
 return {id,fire,calls,until,get stored(){return stored;}};
}
test('legacy UI displays v2 W/Q unsigned origin separately and explicitly restores only the same-Q empty target',async t=>{
 const original=fixture(),made=await createTeam(original),f=await uiFixture(t,made),text=f.id('ac-preservation-summary').textContent;
 assert.match(text,/团队来源声明（未验签）/);assert.ok(text.includes(OTHER));assert.ok(text.includes(P));assert.match(text,/来源声明不认证服务器或员工身份/);assert.match(text,/不继承团队权限/);assert.match(text,/请另留原v2包，本机以后再导出不保留团队来源/);assert.equal(f.id('ac-preservation-summary').querySelectorAll('img,script,iframe').length,0);
 assert.equal(f.calls.some(call=>call.kind==='restore'),false);f.id('ac-preservation-confirm').checked=true;f.fire('ac-preservation-confirm','change');f.fire('ac-preservation-restore');
 await f.until(()=>f.id('ac-status').textContent.includes('团队来源未写入本机记录'));const call=f.calls.find(call=>call.kind==='restore');assert.equal(call.key,P);assert.deepEqual(Object.keys(call.options).sort(),['assertContext','expectedSha256']);assert.equal(call.options.expectedSha256,made.sha256);assert.equal(await call.blob.text(),await made.blob.text());assert.equal(JSON.stringify(f.stored),JSON.stringify(original.record));assert.equal(Object.hasOwn(f.stored,'origin'),false);
 assert.match(f.calls.find(call=>call.kind==='confirm').text,/不继承团队权限/);assert.match(f.id('ac-status').textContent,/请另留原v2包/);assert.equal(f.id('ac-preservation-preview').hidden,true);
});
test('legacy v2 preview never treats W as Q or enables overwriting an existing record',async t=>{
 const original=fixture(),made=await createTeam(original);for(const options of [{targetId:OTHER},{existing:original.record}]){const f=await uiFixture(t,made,options);assert.equal(f.id('ac-preservation-restore').hidden,true);f.id('ac-preservation-confirm').checked=true;f.fire('ac-preservation-confirm','change');f.fire('ac-preservation-restore');assert.equal(f.calls.some(call=>call.kind==='restore'),false);assert.match(f.id('ac-preservation-notice').textContent,options.existing?/目标已有资料清单/:/不匹配/);}
});
