'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{crc32}=require('node:zlib');
const format=require('../shared/task-originals-export.cjs');
const sha=value=>createHash('sha256').update(value).digest('hex'),clone=value=>structuredClone(value);
function fixture({review=false,ids=['submission-a','submission-b'],bodies=[Buffer.from('123456789'),Buffer.from([0,255,1,254])]}={}){
  const scope=review?{kind:'project-review',teamId:'team-a',projectId:'project-a',projectRevision:7,taskId:'task-a'}:{kind:'own',teamId:'team-a',taskId:'task-a',userId:'user-a'};
  const task={id:'task-a',title:'合成采集任务',instructions:'第一行\n第二行\t原样',status:'closed',revision:9};
  const files=ids.map((id,index)=>({id,attachmentId:'attachment-'+index,filename:'同名原件.xlsx',sha256:sha(bodies[index]),byteLength:bodies[index].length,createdAt:1794700000000+index,...(review?{submittedBy:{id:'employee-'+index,displayName:'合成人员'+index}}:{})}));
  const plan=format.makePlan({scope,task,files});return {scope,task,files,plan,originals:ids.map((id,index)=>({id,bytes:bodies[index]}))};
}
// Independent reader uses Node's native zlib CRC, central-directory lengths and
// offsets. It never calls the production ZIP writer, parser or hash validator.
function readZip(bytes){
  const end=bytes.length-22;assert.equal(bytes.readUInt32LE(end),0x06054b50);assert.equal(bytes.readUInt16LE(end+20),0);
  const count=bytes.readUInt16LE(end+10);assert.equal(bytes.readUInt16LE(end+8),count);assert.equal(bytes.readUInt16LE(end+4),0);assert.equal(bytes.readUInt16LE(end+6),0);
  const start=bytes.readUInt32LE(end+16),directorySize=bytes.readUInt32LE(end+12);assert.equal(start+directorySize,end);
  const entries=new Map();let at=start,lastEnd=0;
  for(let i=0;i<count;i++){
    assert.equal(bytes.readUInt32LE(at),0x02014b50);assert.equal(bytes.readUInt16LE(at+8),0x800);assert.equal(bytes.readUInt16LE(at+10),0);assert.equal(bytes.readUInt16LE(at+14),0x21);
    const checksum=bytes.readUInt32LE(at+16),packed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24),length=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42);
    assert.equal(packed,size);assert.equal(extra,0);assert.equal(comment,0);assert.equal(bytes.readUInt32LE(at+38),0);assert.equal(offset,lastEnd);
    const name=bytes.subarray(at+46,at+46+length).toString('utf8');assert.ok(!entries.has(name));
    assert.equal(bytes.readUInt32LE(offset),0x04034b50);assert.equal(bytes.readUInt16LE(offset+6),0x800);assert.equal(bytes.readUInt16LE(offset+8),0);assert.equal(bytes.readUInt16LE(offset+12),0x21);
    assert.equal(bytes.readUInt32LE(offset+14),checksum);assert.equal(bytes.readUInt32LE(offset+18),size);assert.equal(bytes.readUInt32LE(offset+22),size);assert.equal(bytes.readUInt16LE(offset+26),length);assert.equal(bytes.readUInt16LE(offset+28),0);
    assert.equal(bytes.subarray(offset+30,offset+30+length).toString('utf8'),name);
    const body=bytes.subarray(offset+30+length,offset+30+length+size);assert.equal(body.length,size);assert.equal(crc32(body),checksum);
    entries.set(name,Buffer.from(body));lastEnd=offset+30+length+size;at+=46+length;
  }
  assert.equal(lastEnd,start);assert.equal(at,end);return entries;
}
test('selected source identities, duplicate filenames, arbitrary originals and closed history survive a standard ZIP',()=>{
  const f=fixture(),out=format.create(f.plan,[...f.originals].reverse()),members=readZip(out.bytes);
  assert.equal(members.size,3);assert.equal(out.fileCount,2);assert.equal(out.sha256,sha(out.bytes));assert.equal(out.planSha256,f.plan.sha256);assert.equal(out.filename,'shenyi-task-task-a.zip');
  const raw=members.get('manifest.json'),manifest=JSON.parse(raw);assert.equal(sha(raw),f.plan.sha256);assert.deepEqual(manifest,f.plan.manifest);
  for(const [index,file]of manifest.files.entries())assert.deepEqual(members.get('originals/'+String(index+1).padStart(4,'0')+'-'+file.id+'.bin'),f.originals.find(x=>x.id===file.id).bytes);
  assert.equal(crc32(members.get('originals/0001-submission-a.bin')),0xcbf43926);
  assert.equal(manifest.task.status,'closed');assert.equal(manifest.task.revision,9);assert.equal(manifest.task.instructions,f.task.instructions);
  assert.deepEqual(manifest.policy,{selectionOnly:true,completeTaskHistory:false,restorableBackup:false,professionalApprovalClaimed:false});
  assert.equal(Object.hasOwn(manifest.scope,'projectId'),false);assert.ok(manifest.files.every(file=>!Object.hasOwn(file,'submittedBy')));
});
test('project-review pack retains only explicitly exposed submitter facts and captured project revision',()=>{
  const f=fixture({review:true}),out=format.create(f.plan,f.originals),manifest=JSON.parse(readZip(out.bytes).get('manifest.json'));
  assert.equal(manifest.scope.projectRevision,7);assert.equal(manifest.scope.kind,'project-review');assert.deepEqual(manifest.files.map(file=>file.submittedBy),f.files.map(file=>file.submittedBy));
});
test('selection and manifest sorting are deterministic and do not alter caller objects',()=>{
  const f=fixture(),before=clone({scope:f.scope,task:f.task,files:f.files}),opposite=format.makePlan({scope:f.scope,task:f.task,files:[...f.files].reverse()});
  assert.deepEqual(opposite,f.plan);assert.deepEqual({scope:f.scope,task:f.task,files:f.files},before);assert.deepEqual(format.create(f.plan,f.originals).bytes,format.create(opposite,[...f.originals].reverse()).bytes);
  const ids=['z','a'];assert.deepEqual(format.selectionIds(ids),['a','z']);assert.deepEqual(ids,['z','a']);
});
test('internal ordinal paths preserve distinct case-sensitive IDs and Windows device-like IDs without collision',()=>{
  const f=fixture({ids:['CON','con'],bodies:[Buffer.from('first'),Buffer.from('second')]}),members=readZip(format.create(f.plan,f.originals).bytes);
  assert.deepEqual([...members.keys()],['manifest.json','originals/0001-CON.bin','originals/0002-con.bin']);
  assert.equal(new Set([...members.keys()].map(name=>name.toLowerCase())).size,3);
  assert.deepEqual(JSON.parse(members.get('manifest.json')).files.map(file=>file.id),['CON','con']);
});
test('existing zero-length originals remain zero-length and valid',()=>{
  const f=fixture({ids:['empty'],bodies:[Buffer.alloc(0)]}),members=readZip(format.create(f.plan,f.originals).bytes);assert.equal(members.get('originals/0001-empty.bin').length,0);
});
test('returned plan and package own their data independently of original inputs',()=>{
  const f=fixture(),validated=format.validatePlan(f.plan),out=format.create(f.plan,f.originals),before=Buffer.from(out.bytes);
  validated.manifest.files[0].filename='changed.txt';f.files[0].filename='other.txt';f.originals[0].bytes.fill(0);f.plan.manifest.task.title='later';
  assert.deepEqual(out.bytes,before);assert.equal(sha(out.bytes),out.sha256);assert.equal(JSON.parse(readZip(out.bytes).get('manifest.json')).task.title,'合成采集任务');
});
for(const [name,ids]of [['none',[]],['duplicate',['a','a']],['too many',Array.from({length:21},(_,i)=>'s-'+i)],['path',['../x']],['encoded separator',['a%2Fb']],['wrong primitive',[1]],['sparse',Array(1)]]){
  test('selection rejects '+name,()=>assert.throws(()=>format.selectionIds(ids)));
}
for(const [name,mutate]of [
  ['unknown manifest field',p=>{p.manifest.secret='not allowed';}],
  ['full history claim',p=>{p.manifest.policy.completeTaskHistory=true;}],
  ['professional approval claim',p=>{p.manifest.policy.professionalApprovalClaimed=true;}],
  ['wrong format',p=>{p.manifest.format='shenyi-material-preservation';}],
  ['unapproved schema',p=>{p.manifest.schemaVersion=2;}],
  ['wrong hash',p=>{p.sha256='0'.repeat(64);}],
  ['unsafe revision',p=>{p.manifest.task.revision=Number.MAX_SAFE_INTEGER+1;}],
  ['wrong task identity',p=>{p.manifest.task.id='other-task';}],
  ['hidden project identity in own lane',p=>{p.manifest.scope.projectId='hidden-project';}],
  ['submitter in own lane',p=>{p.manifest.files[0].submittedBy={id:'other-user',displayName:'other'};}],
  ['unsafe filename',p=>{p.manifest.files[0].filename='../original.txt';}],
  ['ill-formed filename',p=>{p.manifest.files[0].filename='bad\ud800';}],
  ['file control character',p=>{p.manifest.files[0].filename='bad\u0000.txt';}],
  ['missing selected original metadata',p=>{p.manifest.files.pop();}],
  ['duplicate metadata',p=>{p.manifest.files[1]=clone(p.manifest.files[0]);}],
  ['unsorted selection',p=>{p.manifest.files.reverse();}],
  ['negative bytes',p=>{p.manifest.files[0].byteLength=-1;}],
  ['over file limit',p=>{p.manifest.files[0].byteLength=format.MAX_FILE_BYTES+1;}],
  ['unknown plan field',p=>{p.token='never allowed';}],
])test('validated plan rejects '+name,()=>{const plan=fixture().plan;mutate(plan);assert.throws(()=>format.validatePlan(plan));});
test('aggregate metadata at exactly64MiB is admitted but one more byte is refused before originals allocate',()=>{
  const f=fixture(),sizes=[12,12,12,12,12,4].map(n=>n*1024*1024),files=sizes.map((byteLength,i)=>({...f.files[0],id:'s-'+i,attachmentId:'a-'+i,byteLength}));
  assert.equal(format.makePlan({scope:f.scope,task:f.task,files}).manifest.files.reduce((n,file)=>n+file.byteLength,0),format.MAX_TOTAL_BYTES);
  files.at(-1).byteLength++;assert.throws(()=>format.makePlan({scope:f.scope,task:f.task,files}));
});
test('data getters are never executed while validating a plan',()=>{
  const f=fixture();let calls=0;Object.defineProperty(f.plan.manifest.task,'title',{get(){calls++;return 'unexpected';},enumerable:true});
  assert.throws(()=>format.validatePlan(f.plan));assert.equal(calls,0);
});
test('extra array properties and non-plain records cannot pass the data contract',()=>{
  const f=fixture(),ids=['a'];ids.extra='b';assert.throws(()=>format.selectionIds(ids));
  const polluted=clone(f.plan);Object.setPrototypeOf(polluted.manifest.scope,{role:'partner'});assert.throws(()=>format.validatePlan(polluted));
});
for(const [name,mutate]of [
  ['missing',items=>items.pop()],['duplicate',items=>{items[1]=items[0];}],['foreign',items=>{items[0].id='foreign';}],
  ['short body',items=>{items[0].bytes=Buffer.from('x');}],['same-length changed body',items=>{items[0].bytes.fill(2);}],
  ['text in place of bytes',items=>{items[0].bytes='123456789';}],['extra body field',items=>{items[0].path='not allowed';}],
])test('package refuses '+name+' selected body without partial output',()=>{const f=fixture();mutate(f.originals);assert.throws(()=>format.create(f.plan,f.originals));});
test('shared-memory originals are refused to prevent body changing during package validation',()=>{
  const f=fixture({ids:['shared'],bodies:[Buffer.from([0])]}),bytes=new Uint8Array(new SharedArrayBuffer(1));assert.throws(()=>format.create(f.plan,[{id:'shared',bytes}]));
});
test('maximal supported metadata fits the explicit manifest budget and preserves Unicode',()=>{
  const bodies=Array.from({length:20},()=>Buffer.from('x')),ids=Array.from({length:20},(_,i)=>String(i).padStart(3,'0')+'a'.repeat(125)),f=fixture({review:true,ids,bodies});
  f.task.instructions='🙂'.repeat(4000);for(const file of f.files){file.filename='🙂'.repeat(175)+'.xlsx';file.submittedBy.displayName='🙂'.repeat(100);}
  const plan=format.makePlan({scope:f.scope,task:f.task,files:f.files}),members=readZip(format.create(plan,f.originals).bytes);
  assert.equal(members.size,21);assert.ok(members.get('manifest.json').length<=format.MAX_MANIFEST_BYTES);assert.equal(JSON.parse(members.get('manifest.json')).task.instructions,f.task.instructions);
});
