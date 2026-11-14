'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=path.join(__dirname,'..','dist','workpaper-file-tree.js'),{build}=require(script);

test('mixed files and folders follow zh-CN numeric filename order, not archive or folders-first order',()=>{
  const parent='1、合成初步业务活动',entries=[
    '1500合成能力评价.xls',
    '1200-1合成业务风险.docx',
    '1100合成接触评价—A部分（修订） .xls',
    '1200合成首次评价—B部分.xls',
    '1300合成保持评价.xls',
    '1200-5合成小组意见.docx',
    '1000合成活动程序.xlsx',
    '1200-3合成沟通/1200-3-10合成函.doc',
    '1200-3合成沟通/1200-3-2合成函.doc',
    '1200-3合成沟通/1200-3-1合成函.doc',
    '1400合成独立性/1400-3-2合成声明.doc'
  ].map(name=>({name:parent+'/'+name,size:100}));
  const roots=build(entries);
  assert.equal(roots.length,1);
  assert.deepEqual({type:roots[0].type,name:roots[0].name,path:roots[0].path,key:roots[0].key},
    {type:'folder',name:parent,path:parent,key:parent});
  assert.deepEqual(roots[0].children.map(n=>[n.type,n.name]),[
    ['file','1000合成活动程序.xlsx'],
    ['file','1100合成接触评价—A部分（修订） .xls'],
    ['file','1200-1合成业务风险.docx'],
    ['folder','1200-3合成沟通'],
    ['file','1200-5合成小组意见.docx'],
    ['file','1200合成首次评价—B部分.xls'],
    ['file','1300合成保持评价.xls'],
    ['folder','1400合成独立性'],
    ['file','1500合成能力评价.xls']
  ]);
  const folder=roots[0].children[3];
  assert.equal(folder.key,parent+'/1200-3合成沟通');
  assert.deepEqual(folder.children.map(n=>n.name),[
    '1200-3-1合成函.doc','1200-3-2合成函.doc','1200-3-10合成函.doc'
  ]);
  assert.equal(folder.children[0].path,parent+'/1200-3合成沟通/1200-3-1合成函.doc');
  assert.equal(folder.children[0].key,folder.children[0].path);
  assert.equal(folder.children[0].file,entries[9]);
});

test('exact whitespace, punctuation, case and Unicode names remain unchanged and distinct',()=>{
  const paths=[
    '  合成 文件夹  /  原名—（草稿） .xls ',
    '甲/同名.docx',
    '乙/同名.docx',
    'Unicode/e\u0301.docx',
    'Unicode/é.docx',
    'Unicode/A.docx',
    'Unicode/a.docx',
    '__proto__/constructor/toString.xls'
  ],tree=build(paths),leaves=[];
  const visit=nodes=>nodes.forEach(n=>n.type==='folder'?visit(n.children):leaves.push(n));
  visit(tree);
  assert.deepEqual(leaves.map(n=>n.path).sort(),paths.slice().sort());
  assert.deepEqual(leaves.map(n=>n.key).sort(),paths.slice().sort());
  assert.equal(new Set(leaves.map(n=>n.key)).size,paths.length);
  assert.equal(tree.find(n=>n.name==='  合成 文件夹  ').children[0].name,'  原名—（草稿） .xls ');
  assert.equal(leaves.find(n=>n.path==='Unicode/e\u0301.docx').name,'e\u0301.docx');
  assert.equal(leaves.find(n=>n.path==='Unicode/é.docx').name,'é.docx');
});

test('duplicate paths and file/folder collisions are rejected in either input order',()=>{
  for(const entries of [
    ['甲/文件.xls','甲/文件.xls'],
    [{name:'甲/文件.xls',size:1},{name:'甲/文件.xls',size:2}],
    ['甲','甲/文件.xls'],
    ['甲/文件.xls','甲'],
    ['甲/乙','甲/乙/文件.docx'],
    ['甲/乙/文件.docx','甲/乙']
  ])assert.throws(()=>build(entries),/重复|冲突/);
  assert.doesNotThrow(()=>build(['甲/相同.xls','乙/相同.xls']));
});

test('invalid lists and non-relative or ambiguous path components are rejected without normalization',()=>{
  for(const input of [undefined,null,{},'甲/文件.xls',[null],[{}],[{name:123}],Array(1)]){
    assert.throws(()=>build(input),/清单|路径/);
  }
  for(const name of [
    '', '/绝对/文件.xls', '甲//文件.xls', '甲/./文件.xls', '甲/../文件.xls',
    './文件.xls', '../文件.xls', '甲/', '甲\\文件.xls', 'C:/文件.xls',
    '甲/坏\u0000名.xls','甲/坏\n名.xls','甲/坏\u007f名.xls','甲/坏\u202e名.xls'
  ])assert.throws(()=>build([{name}]),/路径|目录名/);
});

test('source arrays and entries are never sorted, renamed or mutated',()=>{
  const first=Object.freeze({name:'甲/10合成.xls',size:10}),second=Object.freeze({name:'甲/2合成.xls',size:20});
  const entries=Object.freeze([first,second]),before=JSON.stringify(entries),one=build(entries),two=build(entries);
  assert.equal(JSON.stringify(entries),before);
  assert.equal(entries[0],first);
  assert.equal(entries[1],second);
  assert.deepEqual(one[0].children.map(n=>n.name),['2合成.xls','10合成.xls']);
  assert.equal(one[0].children[0].file,second);
  one[0].children.reverse();
  assert.deepEqual(two[0].children.map(n=>n.name),['2合成.xls','10合成.xls']);
  assert.deepEqual(build([]),[]);
});

test('locale-equivalent numeric names receive a deterministic exact-name tiebreak',()=>{
  const paths=['甲/1合成.xls','甲/01合成.xls','甲/001合成.xls'];
  assert.deepEqual(build(paths)[0].children.map(n=>n.name),['001合成.xls','01合成.xls','1合成.xls']);
  assert.deepEqual(build(paths.slice().reverse()),build(paths));
});

test('browser script exposes the same build API without DOM or CommonJS dependencies',()=>{
  const context=vm.createContext({});
  vm.runInContext(fs.readFileSync(script,'utf8'),context);
  assert.equal(typeof context.WorkpaperFileTree.build,'function');
  assert.equal(Object.isFrozen(context.WorkpaperFileTree),true);
  assert.equal(JSON.stringify(context.WorkpaperFileTree.build(['目录/2合成.xls','目录/1合成.xls'])),
    JSON.stringify(build(['目录/2合成.xls','目录/1合成.xls'])));
});
