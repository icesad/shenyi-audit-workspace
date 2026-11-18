'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const C=require('../dist/ledger-check-snapshot.js');
const Q='11111111-1111-4111-8111-111111111111';
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const scope={projectId:Q,entityId:'合成被动快照',currency:'CNY'},input={schemaVersion:1,scope},columnMappings={},sourceRefs={};
 for(const role of ['ledger','trialBalance','statements']){input[role]={scope:{...scope},rows:[]};columnMappings[role]={columns:{accountCode:0}};sourceRefs[role]={name:role+'.xlsx'};}
 return {format:C.FORMAT,schemaVersion:1,sourceProjectId:Q,workspaceRevision:7,reconciliation:{schemaVersion:1,input,columnMappings,sourceRefs,result:{schemaVersion:1,scope:{...scope},summary:{incomplete:1},checks:[],issues:[]},inputHash:sha(JSON.stringify(input)),mappingHash:sha(JSON.stringify(columnMappings)),calculatedAt:'2026-11-17T00:00:00.000Z'}};
}
const entrypoints={create:value=>C.create({projectId:value.sourceProjectId,workspaceRevision:value.workspaceRevision,reconciliation:value.reconciliation}),serialize:value=>C.serialize(value)};
const variants={
 'inherited toJSON method':(array,observed)=>Object.setPrototypeOf(array,{toJSON(){observed.method++;return [];}}),
 'inherited toJSON getter':(array,observed)=>Object.setPrototypeOf(array,Object.create(Array.prototype,{toJSON:{get(){observed.getter++;return function(){observed.method++;return [];};}}})),
 'Array subclass':(_array,observed)=>new(class extends Array{toJSON(){observed.method++;return [];}})(),
 'null array prototype':array=>Object.setPrototypeOf(array,null)
};
for(const [name,invoke] of Object.entries(entrypoints))for(const [label,make] of Object.entries(variants))test(name+' rejects '+label+' before inherited hooks execute',async()=>{
 const value=fixture(),observed={method:0,getter:0},array=make(value.reconciliation.result.issues,observed);value.reconciliation.result.issues=array;
 const descriptors=Object.getOwnPropertyDescriptors(array),prototype=Object.getPrototypeOf(array);
 let rejected=false;try{await invoke(value);}catch(error){assert.match(error.message,/快照格式或来源绑定无效/);rejected=true;}
 assert.deepEqual(observed,{method:0,getter:0});assert.equal(rejected,true);
 assert.equal(value.reconciliation.result.issues,array);assert.equal(Object.getPrototypeOf(array),prototype);assert.deepEqual(Object.getOwnPropertyDescriptors(array),descriptors);
});
test('ordinary JSON arrays preserve canonical bytes, input order, hashes and caller data',async()=>{
 const value=fixture(),text=JSON.stringify(value,null,2)+'\n',hash=sha(text),before=JSON.stringify(value);
 const created=await entrypoints.create(value);assert.equal(await C.serialize(created),text);assert.deepEqual(await C.parse(text),value);
 assert.equal(await C.serialize(await C.parse(text)),text);assert.equal(sha(await C.serialize(created)),hash);assert.equal(JSON.stringify(value),before);
 assert.equal(created.reconciliation.inputHash,value.reconciliation.inputHash);assert.equal(created.reconciliation.mappingHash,value.reconciliation.mappingHash);
});
test('structuredClone restores a normal array without running inherited hooks and preserves emitted bytes',async()=>{
 const value=fixture(),text=JSON.stringify(value,null,2)+'\n';let calls=0;
 Object.setPrototypeOf(value.reconciliation.result.issues,{toJSON(){calls++;return ['untrusted'];}});
 const cloned=structuredClone(value);assert.equal(Object.getPrototypeOf(cloned.reconciliation.result.issues),Array.prototype);
 assert.equal(await C.serialize(cloned),text);assert.equal(calls,0);assert.equal(value.reconciliation.result.issues.length,0);
});
