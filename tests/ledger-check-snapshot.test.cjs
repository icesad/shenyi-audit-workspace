'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const C=require('../dist/ledger-check-snapshot.js'),R=require('../dist/audit-reconciliation.js');
const Q='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(){
 const scope={projectId:Q,entityId:'合成校验记录',currency:'CNY',unit:'元',periodStart:'2026-01-01',periodEnd:'2026-12-31',scale:2};
 const input=R.createInputTemplate(scope),columnMappings={},sourceRefs={};
 for(const role of ['ledger','trialBalance','statements']){
  columnMappings[role]={sheet:'账表',fromRow:1,toRow:1,columns:{accountCode:0}};
  sourceRefs[role]={id:role+'-synthetic',nodeId:role,generationId:'saved-generation',sha256:'a'.repeat(64),name:role+'.xlsx',status:'confirmed'};
 }
 return {projectId:Q,workspaceRevision:7,reconciliation:{schemaVersion:1,input,columnMappings,sourceRefs,result:R.reconcile(input),inputHash:hash(input),mappingHash:hash(columnMappings),calculatedAt:'2026-11-17T00:00:00.000Z'}};
}
test('preserves an actual legacy saved result, full inputs and property order without repairing incomplete checks',async()=>{
 const f=fixture(),before=JSON.stringify(f),snapshot=await C.create(f),text=await C.serialize(snapshot),parsed=await C.parse(text);
 assert.deepEqual(parsed.reconciliation,f.reconciliation);assert.equal(parsed.reconciliation.result.summary.incomplete,11);
 assert.equal(JSON.stringify(parsed.reconciliation.input),JSON.stringify(f.reconciliation.input));
 assert.equal(parsed.sourceProjectId,Q);assert.equal(parsed.workspaceRevision,7);assert.equal(JSON.stringify(f),before);
 assert.equal(await C.serialize(parsed),text);assert.deepEqual(Object.keys(C),['FORMAT','LIMITS','create','serialize','parse']);
});
test('copies before asynchronous hashing and never returns caller-owned nested objects',async()=>{
 const f=fixture(),pending=C.create(f);f.reconciliation.input.scope.entityId='late mutation';
 const saved=await pending;assert.equal(saved.reconciliation.input.scope.entityId,'合成校验记录');
 saved.reconciliation.sourceRefs.ledger.name='copy only';assert.equal(f.reconciliation.sourceRefs.ledger.name,'ledger.xlsx');
});
for(const [label,mutate]of [
 ['another project at the envelope',f=>f.projectId=OTHER],
 ['another project in a dataset',f=>{f.reconciliation.input.ledger.scope.projectId=OTHER;}],
 ['another project in the saved result',f=>{f.reconciliation.result.scope.projectId=OTHER;}],
 ['missing saved result scope',f=>{delete f.reconciliation.result.scope;}],
 ['array-coerced project identity',f=>{f.projectId=[Q];f.reconciliation.input.scope.projectId=f.projectId;}],
 ['unsaved workspace revision',f=>f.workspaceRevision=0],
 ['unsafe workspace revision',f=>f.workspaceRevision=Number.MAX_SAFE_INTEGER+1],
 ['changed input binding',f=>{f.reconciliation.input.scope.entityId='altered';}],
 ['changed mapping binding',f=>{f.reconciliation.columnMappings.ledger.fromRow=2;}],
 ['missing source role',f=>{delete f.reconciliation.sourceRefs.ledger;}],
 ['unknown saved field',f=>{f.reconciliation.answers={secret:'not part of this snapshot'};}],
 ['invalid calculation time',f=>{f.reconciliation.calculatedAt='not a date';}],
 ['more than the legacy row cap',f=>{f.reconciliation.input.ledger.rows=Array.from({length:20001},()=>({rowId:'x'}));}],
 ['undefined data loss',f=>{f.reconciliation.sourceRefs.ledger.extra=undefined;}],
 ['nonfinite numeric data',f=>{f.reconciliation.sourceRefs.ledger.extra=Infinity;}],
 ['negative zero serialization loss',f=>{f.reconciliation.sourceRefs.ledger.extra=-0;}],
 ['Date object conversion',f=>{f.reconciliation.sourceRefs.ledger.extra=new Date();}],
 ['sparse array conversion',f=>{f.reconciliation.sourceRefs.ledger.extra=Array(2);}],
 ['prototype property in JSON',f=>{f.reconciliation.sourceRefs.ledger.extra=JSON.parse('{"__proto__":{"polluted":true}}');}],
 ['excessive nesting',f=>{let x=f.reconciliation.sourceRefs.ledger;for(let i=0;i<32;i++){x.extra={};x=x.extra;}}],
 ['cyclic data',f=>{f.reconciliation.sourceRefs.ledger.extra=f;}],
])test('rejects '+label+' without modifying the saved source',async()=>{
 const f=fixture();mutate(f);await assert.rejects(C.create(f),/快照格式或来源绑定无效/);assert.equal({}.polluted,undefined);
});
test('does not invoke getters or accept non-enumerable saved values',async()=>{
 let calls=0;const f=fixture();Object.defineProperty(f.reconciliation.sourceRefs.ledger,'extra',{enumerable:true,get(){calls++;throw Error('must not run');}});
 await assert.rejects(C.create(f),/快照格式或来源绑定无效/);assert.equal(calls,0);
 const hidden=fixture();Object.defineProperty(hidden.reconciliation.sourceRefs.ledger,'extra',{value:1,enumerable:false});
 await assert.rejects(C.create(hidden),/快照格式或来源绑定无效/);
});
test('rejects duplicate JSON keys, BOM and altered spelling rather than silently normalizing them',async()=>{
 const text=await C.serialize(await C.create(fixture()));
 for(const changed of [text.replace('"workspaceRevision": 7','"workspaceRevision": 1, "workspaceRevision": 7'),'\ufeff'+text,text.trim(),text.replace('"workspaceRevision": 7','"workspaceRevision": 7.0')])await assert.rejects(C.parse(changed),/快照格式或来源绑定无效/);
});
test('format and input hashes do not pretend to authenticate the stored arithmetic result',async()=>{
 const f=fixture();f.reconciliation.result.checks[0].status='untrusted-stored-label';
 const parsed=await C.parse(await C.serialize(await C.create(f)));
 assert.equal(parsed.reconciliation.result.checks[0].status,'untrusted-stored-label');
 // Import policy and a read-only view must label the source; this codec never
 // reruns arithmetic, grants permission or converts the result into an opinion.
 assert.equal(parsed.reconciliation.inputHash,f.reconciliation.inputHash);
});
test('rejects oversized serialized input before JSON parsing and does not replace malformed Unicode',async()=>{
 await assert.rejects(C.parse(' '.repeat(C.LIMITS.bytes+1)),/快照格式或来源绑定无效/);
 const f=fixture();f.reconciliation.sourceRefs.ledger.name='bad-\ud800.xlsx';
 await assert.rejects(C.create(f),/快照格式或来源绑定无效/);
});
module.exports={fixture};
