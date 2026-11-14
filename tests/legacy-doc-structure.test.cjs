/* Independent, fictional Word binary structures; no customer or Word COM data. */
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../dist/legacy-doc.js'),{buildLegacyDoc}=require('./fixtures/legacy-doc-builder.cjs');
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
const out=n=>Buffer.from([0x40,0x26,n]); // sprmPOutLvl: 0..8 heading, 9 body
function stylesheet(styles){
 const header=Buffer.alloc(20);header.writeUInt16LE(18,0);header.writeUInt16LE(styles.length,2);header.writeUInt16LE(10,4);
 return Buffer.concat([header,...styles.map((s,i)=>{
  if(!s)return u16(0);
  const fixed=Buffer.alloc(10);fixed.writeUInt16LE(i,0);fixed.writeUInt16LE(1+((s.base??0xfff)<<4),2);fixed.writeUInt16LE(2,4);
  const name=Buffer.from(s.name+'\0','utf16le'),pap=Buffer.concat([u16(i),s.ops||Buffer.alloc(0)]);
  const std=Buffer.concat([fixed,u16(s.name.length),name,u16(pap.length),pap,...(pap.length%2?[Buffer.alloc(1)]:[]),u16(0)]);
  return Buffer.concat([u16(std.length),std]);
 })]);
}
function fixture(paragraphs,options={}){
 const text=paragraphs.map(p=>p.text+'\r').join(''),styles=options.styles||[{name:'Normal'}],st=stylesheet(styles);
 if(paragraphs.length>29||text.length>900||st.length>3000)throw Error('Test helper intentionally bounded');
 return buildLegacyDoc({pieces:[{text}],mutateWord:w=>{
  w.writeUInt32LE(512,162);w.writeUInt32LE(st.length,166); // stylesheet
  w.writeUInt32LE(256,154+13*8);w.writeUInt32LE(12,158+13*8);
  w.writeUInt32LE(320,154+12*8);w.writeUInt32LE(12,158+12*8);
  let fc=1024,pa=510,ca=510;w[3072+511]=paragraphs.length;w[3584+511]=paragraphs.length;
  paragraphs.forEach((p,i)=>{
   const end=fc+(p.text.length+1)*2;
   for(const page of [3072,3584]){w.writeUInt32LE(fc,page+i*4);w.writeUInt32LE(end,page+(i+1)*4);}
   const g=Buffer.concat([u16(p.style||0),p.ops||Buffer.alloc(0)]);
   const record=g.length%2?Buffer.concat([Buffer.from([(g.length+1)/2]),g]):Buffer.concat([Buffer.from([0,g.length/2]),g]);
   pa-=record.length;record.copy(w,3072+pa);w[3072+4*(paragraphs.length+1)+13*i]=pa/2;
   if(p.deleted){ca-=4;Buffer.from([3,0,8,1]).copy(w,3584+ca);w[3584+4*(paragraphs.length+1)+i]=ca/2;}
   fc=end;
  });
  if(options.mutateWord)options.mutateWord(w);
 },mutateTable:(t,meta)=>{
  st.copy(t,512);
  for(const [at,pn]of [[256,6],[320,7]]){t.writeUInt32LE(1024,at);t.writeUInt32LE(1024+text.length*2,at+4);t.writeUInt32LE(pn,at+8);}
  if(options.mutateTable)options.mutateTable(t,meta);
 }});
}
const headingStyles=()=>[{name:'Normal'},...Array.from({length:9},(_,i)=>({name:'Heading '+(i+1),base:0})),{name:'Outline parent',base:0,ops:out(2)},{name:'Outline child',base:10}];

test('structure keeps true paragraphs, empty paragraphs and manual breaks without guessing headings',()=>{
 const ps=[{text:'1. Looks like a heading'},{text:'Body first\vmanual continuation'},{text:''},{text:'一、Numbering is not an outline'}];
 const bytes=fixture(ps),result=L.extractStructure(bytes);
 assert.equal(result.source,'word-outline');
 assert.deepEqual(result.paragraphs,ps.map(p=>({text:p.text.replace(/\v/g,'\n'),level:null,styleName:'Normal'})));
 assert.equal(L.extract(bytes),ps.map(p=>p.text.replace(/\v/g,'\n')+'\n').join(''),'legacy text API remains identical');
 assert.deepEqual(Object.keys(L).sort(),['extract','extractStructure','read','readStructure']);
});

test('style inheritance, reserved heading styles and direct body/heading overrides use actual Word properties',()=>{
 const bytes=fixture([
  {text:'Built-in heading one',style:1},
  {text:'Inherited heading three',style:11},
  {text:'Direct body override',style:11,ops:out(9)},
  {text:'Direct heading five',ops:out(4)},
  {text:'Heading nine cannot be changed to body',style:9,ops:out(9)},
  {text:'Ordinary body'}
 ],{styles:headingStyles()});
 assert.deepEqual(L.extractStructure(bytes).paragraphs.map(p=>[p.text,p.level,p.styleName]),[
  ['Built-in heading one',1,'Heading 1'],['Inherited heading three',3,'Outline child'],['Direct body override',null,'Outline child'],
  ['Direct heading five',5,'Normal'],['Heading nine cannot be changed to body',9,'Heading 9'],['Ordinary body',null,'Normal']
 ]);
});

test('deleted heading text and its deleted paragraph mark do not become an upload node',()=>{
 const bytes=fixture([{text:'Kept heading',style:1},{text:'Deleted heading',style:2,deleted:true},{text:'Following body'}],{styles:headingStyles()});
 assert.deepEqual(L.extractStructure(bytes).paragraphs.map(p=>[p.text,p.level]),[['Kept heading',1],['Following body',null]]);
 assert.equal(L.extract(bytes),'Kept heading\nFollowing body\n');
});

test('piece-level Prm0 outline formatting overrides normal PAPX without naming heuristics',()=>{
 const bytes=fixture([{text:'Plainly named title'}],{mutateTable:(t,{plcStart,pieceCount})=>t.writeUInt16LE((5<<8)|(0x78<<1),plcStart+4*(pieceCount+1)+6)});
 assert.equal(L.extractStructure(bytes).paragraphs[0].level,6);
});

test('corrupt or unsupported structure fails closed rather than returning plausible outline guesses',()=>{
 const cases=[
  fixture([{text:'Body'}],{mutateWord:w=>w.writeUInt32LE(0,158+13*8)}), // no PAPX
  fixture([{text:'Body',style:1}]), // missing referenced style
  fixture([{text:'Body',style:1}],{styles:[{name:'Normal'},{name:'Cycle',base:1}]}),
  fixture([{text:'Body',ops:out(10)}]), // invalid outline value
  fixture([{text:'Body'}],{mutateWord:w=>w[3584+8]=1}), // invalid CHPX pointer must not hide revision uncertainty
  fixture([{text:'Body',ops:Buffer.from([0x46,0x66,0,0,0,0])}]), // indirect huge PAPX unsupported
  fixture([{text:'Cell\x07Body'}]),
  fixture([{text:'Body'}],{mutateTable:t=>t.writeUInt16LE(0xffff,512+20+2+10)}) // bad style name bound
 ];
 for(const bytes of cases)assert.throws(()=>L.extractStructure(bytes),/DOC/);
 assert.throws(()=>L.extractStructure(Buffer.from('not a Word file')),/DOC/);
});
