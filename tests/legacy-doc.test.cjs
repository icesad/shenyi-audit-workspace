/* All binary fixtures are generated locally and contain fictional content only. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../dist/legacy-doc.js'),{buildLegacyDoc,compoundFile}=require('./fixtures/legacy-doc-builder.cjs');
const normalize=s=>s.replace(/\r\n?/g,'\n');
const extract=bytes=>normalize(L.extract(bytes));

test('Word97 OLE main text is read as Unicode without treating bytes as raw UTF-8',()=>{
  const text='资料清单2026\r一、基础资料\r9. 营业执照\r29. 银行函证\r';
  assert.equal(extract(buildLegacyDoc({pieces:[{text}]})),normalize(text));
  assert.equal(extract(new Uint8Array(buildLegacyDoc({pieces:[{text}]}))),normalize(text));
});

test('CLX order, not physical offsets, controls mixed compressed and UTF-16 pieces',()=>{
  const pieces=[{text:'资料清单2026\r一、基础资料\r',fc:4608},{text:'9. Revenue statement\r',compressed:true,fc:2304},{text:'29. 银行函证及😀附件\r',fc:1024}];
  assert.equal(extract(buildLegacyDoc({pieces,prc:true,table:'0Table'})),normalize(pieces.map(x=>x.text).join('')));
});

test('CFB mini streams are read using MiniFAT rather than normal stream offsets',()=>{
  const text='资料清单2026\r一、试用资料\r1. 虚构资料甲\r2. 虚构资料乙\r';
  assert.equal(extract(buildLegacyDoc({mini:true,pieces:[{text}],prc:true})),normalize(text));
});

test('long fragmented main stories cross sectors; non-main story text is not imported',()=>{
  const main='一、基础资料\r'+Array.from({length:105},(_,i)=>`${i+9}. 虚构资料${i+1}：${'核对事项'.repeat(9)}\r`).join('');
  const pieces=[{text:main.slice(0,2048)},{text:main.slice(2048)},{text:'不属于正文的页眉及附注\r'}];
  assert.ok(Buffer.byteLength(main,'utf16le')>4096);
  assert.equal(extract(buildLegacyDoc({pieces,mainLength:main.length})),normalize(main));
});

test('compressed text follows MS-DOC FcCompressed punctuation mappings',()=>{
  const text='1. \x91Quoted\x92 \x96 details\r';
  assert.equal(extract(buildLegacyDoc({pieces:[{text,compressed:true}]})),'1. ‘Quoted’ – details\n');
});

test('RTF, HTML, plain text, OOXML ZIP and unrelated compound files cannot masquerade as binary Word',()=>{
  for(const bytes of [Buffer.from('{\\rtf1\\ansi 1. fake}'),Buffer.from('<html><body>1. fake</body></html>'),Buffer.from('1. not binary Word'),Buffer.from('504b030400000000','hex'),Buffer.alloc(4096),compoundFile([['OtherStream',Buffer.alloc(4096)]])])
    assert.throws(()=>L.extract(bytes));
});

test('encrypted/obfuscated and unsupported old Word versions fail closed',()=>{
  for(const opts of [{encrypted:true},{encrypted:true,obfuscated:true},{nFib:0x65},{nFib:0xffff}])assert.throws(()=>L.extract(buildLegacyDoc(opts)));
  assert.throws(()=>L.extract(buildLegacyDoc({mutateWord:w=>w.writeUInt16LE(0,0)})));
  assert.throws(()=>L.extract(buildLegacyDoc({mutateWord:w=>w.writeUInt16LE(w.readUInt16LE(10)&~0x200,10)})),'missing selected Table stream is not silently substituted');
});

test('truncated, cyclic and out-of-range CFB chains never emit partial plausible content',()=>{
  const good=buildLegacyDoc();
  for(const b of [good.subarray(0,256),good.subarray(0,good.length-513),buildLegacyDoc({mutateCfb:b=>b.writeUInt32LE(0x7ffffffe,48)}),buildLegacyDoc({mutateCfb:b=>{const fat=b.readUInt32LE(76);b.writeUInt32LE(0,512+fat*512);}})])assert.throws(()=>L.extract(b));
});

test('invalid CLX boundaries, CP order and piece offsets reject rather than truncate',()=>{
  const cases=[
    {mutateWord:w=>w.writeUInt32LE(0x7fffffff,418)},
    {mutateWord:w=>w.writeUInt32LE(0,422)},
    {mutateTable:(t,{clxStart})=>t[clxStart]=0x7f},
    {mutateTable:(t,{clxStart})=>t.writeUInt32LE(0x7fffffff,clxStart+1)},
    {pieces:[{text:'1. first\r'},{text:'2. second\r'}],mutateTable:(t,{plcStart})=>t.writeUInt32LE(0,plcStart+4)},
    {mutateTable:(t,{plcStart,pieceCount})=>t.writeUInt32LE(0x3ffffff0,plcStart+4*(pieceCount+1)+2)}
  ];
  for(const opts of cases)assert.throws(()=>L.extract(buildLegacyDoc(opts)));
});

test('empty documents and bounded input/output cannot become material checklists',()=>{
  assert.throws(()=>L.extract(buildLegacyDoc({pieces:[{text:'\r\r'}]})));
  assert.throws(()=>L.extract(Buffer.alloc(2*1024*1024+1)));
  assert.equal(L.extract(buildLegacyDoc({pieces:[{text:'x'.repeat(150000),compressed:true}]})).length,150000);
  assert.throws(()=>L.extract(buildLegacyDoc({pieces:[{text:'x'.repeat(150001),compressed:true}]})));
});

test('DOC cells and tabs are not silently flattened into a line-per-item material checklist',()=>{
  for(const text of ['1. 甲\t乙\r','1. 甲\x07乙\x07\r'])assert.throws(()=>L.extract(buildLegacyDoc({pieces:[{text}]})),/表格|制表符/);
});


test('duplicate formatting pages and excessive style declarations are rejected before vendor allocation',()=>{
  const fixtures=[];
  for(const index of [12,13])fixtures.push(buildLegacyDoc({
    mutateWord:w=>{w.writeUInt32LE(128,154+index*8);w.writeUInt32LE(20,154+index*8+4);},
    mutateTable:t=>{[1024,1100,1200,6,6].forEach((v,i)=>t.writeUInt32LE(v,128+i*4));}
  }));
  fixtures.push(buildLegacyDoc({
    mutateWord:w=>{w.writeUInt32LE(256,162);w.writeUInt32LE(6,166);},
    mutateTable:t=>{t.writeUInt16LE(4,256);t.writeUInt16LE(4097,258);}
  }));
  const vendorPath=require.resolve('../dist/vendor-legacy-doc.js'),original=require(vendorPath);let invoked=0;
  require.cache[vendorPath].exports=()=>{invoked++;throw Error('vendor must not see rejected auxiliary metadata');};
  try{for(const bytes of fixtures)assert.throws(()=>L.extract(bytes),/DOC 内容损坏/);assert.equal(invoked,0);}
  finally{require.cache[vendorPath].exports=original;}
});

test('formatting page counts, page ranges and FKP run layouts are checked before allocation',()=>{
  const fixtures=[];
  for(const index of [12,13]){
    fixtures.push(buildLegacyDoc({mutateWord:w=>{w.writeUInt32LE(128,154+index*8);w.writeUInt32LE(4+9*8,154+index*8+4);}})); // Nine pages cannot exist in an eight-page Word stream.
    fixtures.push(buildLegacyDoc({
      mutateWord:w=>{w.writeUInt32LE(128,154+index*8);w.writeUInt32LE(12,154+index*8+4);},
      mutateTable:t=>{t.writeUInt32LE(1024,128);t.writeUInt32LE(1200,132);t.writeUInt32LE(99,136);}
    }));
    fixtures.push(buildLegacyDoc({
      mutateWord:w=>{w.writeUInt32LE(128,154+index*8);w.writeUInt32LE(12,154+index*8+4);w[6*512+511]=index===12?102:30;},
      mutateTable:t=>{t.writeUInt32LE(1024,128);t.writeUInt32LE(1200,132);t.writeUInt32LE(6,136);}
    }));
  }
  for(const bytes of fixtures)assert.throws(()=>L.extract(bytes),/DOC 内容损坏/);
});
