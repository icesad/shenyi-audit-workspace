'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {archiveFor,files,patchFor}=require('../dist/workpaper-stages.js');
const a=Object.freeze({name:'归档.zip',hash:'first'}),r=Object.freeze({name:'风险.zip',hash:'risk'}),initial={name:'1、初步阶段/1000合成.xlsx'},risk={name:'2、风险阶段/2000合成.xls'},other={name:'4、结论和报告阶段工作底稿/9100合成.docx'},legacy={archive:a,index:[initial,risk,other]};

test('risk stage prefers its own archive/index without modifying legacy initial and other sources',()=>{const record={...legacy,riskArchive:r,riskIndex:[{name:'2、风险阶段/2190合成.doc'}]},before=JSON.stringify(record);assert.equal(archiveFor(record,3).archive,a);assert.equal(archiveFor(record,4).archive,r);assert.equal(archiveFor(record,5).archive,a);assert.deepEqual(files(record,3),[initial]);assert.deepEqual(files(record,4),record.riskIndex);assert.deepEqual(files(record,5),[other]);assert.equal(JSON.stringify(record),before);});

test('existing complete archive remains a risk fallback until separately imported',()=>{const view=archiveFor(legacy,4);assert.equal(view.archive,a);assert.equal(view.separate,false);assert.deepEqual(files(legacy,4),[risk]);assert.deepEqual(files(legacy,3),[initial]);assert.deepEqual(files(legacy,5),[other]);});

test('risk import patch has only riskArchive/riskIndex and does not carry over original archive or answers',()=>{const before=JSON.stringify(legacy),patch=patchFor(4,r,[initial,risk,other]);assert.deepEqual(Object.keys(patch).sort(),['riskArchive','riskIndex']);assert.equal(patch.riskArchive,r);assert.deepEqual(patch.riskIndex,[risk]);assert.equal(JSON.stringify(legacy),before);});

test('wrong-stage ZIP is rejected rather than clearing the existing risk stage',()=>{assert.throws(()=>patchFor(4,r,[initial,other]),/未替换/);assert.equal(archiveFor({...legacy,riskArchive:r,riskIndex:[risk]},4).archive,r);});

test('stage prefixes accept Chinese punctuation, dot and whitespace but not letter s or slash spoofing',()=>{const data={archive:a,index:[{name:'1、初步/a.xls'},{name:'1.初步/b.doc'},{name:'1 初步/c.xls'},{name:'2、风险/d.xls'},{name:'2.风险/e.xls'},{name:'2 风险/f.doc'},{name:'2s错误/g.doc'},{name:'12、错误/h.xls'}]};assert.deepEqual(files(data,3).map(x=>x.name),data.index.slice(0,3).map(x=>x.name));assert.deepEqual(files(data,4).map(x=>x.name),data.index.slice(3,6).map(x=>x.name));});

test('empty and corrupt separated indexes do not silently fall back to another stage',()=>{assert.deepEqual(archiveFor(null,4),{archive:null,index:[]});const empty={...legacy,riskArchive:r,riskIndex:[]};assert.deepEqual(files(empty,4),[]);assert.equal(archiveFor(empty,4).archive,r);assert.throws(()=>archiveFor({...legacy,riskArchive:r,riskIndex:null},4),/无效/);});

test('legacy uploads still use original fields while archives remain identified by their untouched objects',()=>{const patch=patchFor(3,a,[initial,other]);assert.deepEqual(patch,{archive:a,index:[initial,other]});assert.equal(patch.archive,a);assert.deepEqual(archiveFor({...patch},5).index,[other]);});
