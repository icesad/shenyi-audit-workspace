'use strict';
// Synthetic-only outline tests. Real Word evidence is deliberately not a fixture.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const A=require('../dist/audit-outline.js');
const source=(lines)=>({paragraphs:lines.map(x=>typeof x==='string'?{text:x,level:null,styleName:''}:x),kind:'txt'});
const levels=s=>s.rows.map(x=>x.level);

test('actual outlines retain 1–9, names and manual breaks rather than guessed numbering',()=>{
  const prepared=A.prepare(source([{text:'一、首标题\n未拆的29、第二行',level:1,styleName:'自定义目录'},{text:'29、仅是正文',level:null,styleName:'正文'},{text:'深层',level:9,styleName:'自定义九级'}]),'outline');
  assert.deepEqual(levels(prepared),[1,0,9]);assert.match(prepared.warnings.join(' '),/跳跃/);
  assert.match(prepared.rows[0].text,/\n未拆的29、/);
});

test('numbered mode preserves original labels and scopes repeated 33 to its Chinese category',()=>{
  const p=A.prepare(source(['一、综合类','29、存货','29.1 明细','29.1.1 佐证','33、资产','二、业务类','33、合同','33.1 发票']),'numbered');
  assert.deepEqual(levels(p),[1,2,3,4,2,1,2,3]);
  const nodes=A.build(p.rows);assert.equal(nodes[2].parentId,'n2');assert.equal(nodes[3].parentId,'n3');assert.equal(nodes[7].parentId,'n7');
  assert.equal(nodes[6].title,'33、合同');assert.doesNotMatch(p.warnings.join(' '),/重复编号/);
});

test('missing, noncurrent and ambiguous numbered parents never attach to an unrelated predecessor',()=>{
  for(const rows of [
    ['一、分类','29、甲','33.1 缺33父号'],
    ['一、分类','29、甲','30、乙','29.1 父号已不在当前位置'],
    ['一、分类','33、甲','33、乙','33.1 重复父号']
  ]){
    const p=A.prepare(source(rows),'numbered');assert.equal(p.rows.at(-1).level,2);assert.match(p.warnings.join(' '),/父号/);
    const nodes=A.build(p.rows);assert.equal(nodes.at(-1).parentId,'n1');
  }
  const p=A.prepare(source(['一、分类','56、甲','56.1.1 缺56.1父号']),'numbered');assert.equal(p.rows[2].level,2);
});

test('without Chinese categories numeric roots start at one and preserve relative child depth',()=>{
  const p=A.prepare(source(['29、原编号','29.1 子号','56、另一个','56.1 子号','56.1.1 三级']),'numbered');
  assert.deepEqual(levels(p),[1,2,1,2,3]);assert.match(p.warnings.join(' '),/无中文一级分类/);
  assert.equal(A.build(p.rows)[4].parentId,'n4');
});

test('body text is description, leading prose is retained on first real heading and no fake material is created',()=>{
  const p=A.prepare(source(['审计资料上传','引言仅为说明','一、资料','后置说明','29、子标题','子项说明']),'numbered');
  assert.deepEqual(levels(p),[0,0,1,0,2,0]);assert.match(p.warnings.join(' '),/未归属/);
  const xs=A.build(p.rows);assert.equal(xs.length,2);assert.match(xs[0].description,/文档前置说明（不作为资料项）\n审计资料上传\n引言仅为说明/);
  assert.match(xs[0].description,/后置说明/);assert.equal(xs[1].description,'子项说明');
  const none=A.prepare(source(['没有编号的正文','2025 年度资料']),'numbered');assert.deepEqual(levels(none),[0,0]);assert.throws(()=>A.build(none.rows),/没有标题/);
});

test('soft breaks split only explicit numbered titles in numbered mode, not ordinary continuations',()=>{
  const p=A.prepare(source(['一、分类','29、甲\n这是同段落续行\n29.1 子标题\n未编号的续行']),'numbered');
  assert.deepEqual(levels(p),[1,2,3]);assert.equal(p.rows[1].text,'29、甲\n这是同段落续行');assert.equal(p.rows[2].text,'29.1 子标题\n未编号的续行');
});

test('strict build rejects jumps and invalid edits; 500 headings and 150k characters are bounded',()=>{
  assert.throws(()=>A.build([{text:'起点',level:2}]),/层级/);
  assert.throws(()=>A.build([{text:'甲',level:1},{text:'乙',level:3}]),/层级/);
  assert.throws(()=>A.build([{text:' ',level:1}]),/不能为空/);
  assert.throws(()=>A.build([{text:'甲',level:10}]),/0–9/);
  const rows=Array.from({length:500},(_,i)=>({text:'原'+i,level:1}));assert.equal(A.build(rows).length,500);
  assert.throws(()=>A.build(rows.concat({text:'超限',level:1})),/500/);
  assert.throws(()=>A.prepare(source(['x'.repeat(150001)]),'outline'),/过长|150/);
  assert.throws(()=>A.build([{text:'甲',level:1},{text:'x'.repeat(150000),level:0}]),/150/);
  assert.throws(()=>A.prepare(source(['正文\u0000隐藏']),'outline'),/字符/);
});

test('TXT is UTF-8 only and DOC readStructure is an explicit bounded bridge',async()=>{
  const file=(name,b)=>({name,size:b.length,arrayBuffer:async()=>Uint8Array.from(b).buffer});
  const d=await A.read(file('synthetic.txt',Buffer.from('一、分类\n29、正文')));assert.equal(d.kind,'txt');assert.deepEqual(d.paragraphs.map(p=>p.level),[null,null]);
  await assert.rejects(A.read(file('bad.txt',[255])),/UTF-8/);
  await assert.rejects(A.read({name:'big.doc',size:2*1024*1024+1}),/2 MB/);
  const prior=globalThis.LegacyDoc;globalThis.LegacyDoc={readStructure:async()=>({paragraphs:[{text:'自定义标题',level:3,styleName:'中文自定义'},{text:'说明',level:null,styleName:'正文'}],source:'word-outline'})};
  try{const r=await A.read(file('synthetic.doc',[1]));assert.equal(r.kind,'doc');assert.equal(r.actualLevels[3],1);assert.equal(r.actualLevels[1],0);assert.equal(r.paragraphs[0].styleName,'中文自定义');}finally{if(prior===undefined)delete globalThis.LegacyDoc;else globalThis.LegacyDoc=prior;}
});

function zip(parts){
  const crc=b=>{let n=0xffffffff;for(const x of b){n^=x;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return(n^0xffffffff)>>>0;};
  const chunks=[],central=[];let offset=0;
  for(const [name,value] of parts){const n=Buffer.from(name),b=Buffer.from(value),l=Buffer.alloc(30),c=Buffer.alloc(46),hash=crc(b);
    l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(2048,6);l.writeUInt32LE(hash,14);l.writeUInt32LE(b.length,18);l.writeUInt32LE(b.length,22);l.writeUInt16LE(n.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(2048,8);c.writeUInt32LE(hash,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    chunks.push(l,n,b);central.push(c,n);offset+=l.length+n.length+b.length;}
  const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(parts.length,8);end.writeUInt16LE(parts.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,cd,end]);
}

test('real browser DOCX path resolves Chinese style inheritance, overrides, hidden/deleted text and original numbering without network',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('Existing Playwright unavailable; no install.');}
  const b=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true});
  try{
    const ctx=await b.newContext({serviceWorkers:'block'}),requests=[];ctx.on('request',r=>{if(/^https?:/u.test(r.url()))requests.push(r.url());});await ctx.route(/^https?:/u,r=>r.abort());const p=await ctx.newPage();
    await p.addScriptTag({path:path.resolve(__dirname,'../dist/tender-import.js')});await p.addScriptTag({path:path.resolve(__dirname,'../dist/audit-outline.js')});
    const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const styles='<w:styles xmlns:w="'+W+'"><w:style w:type="paragraph" w:default="1" w:styleId="normal"><w:name w:val="正文"/></w:style><w:style w:type="paragraph" w:styleId="base"><w:name w:val="中文基类"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="custom"><w:name w:val="中文自定义标题"/><w:basedOn w:val="base"/></w:style><w:style w:type="paragraph" w:styleId="body"><w:basedOn w:val="custom"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="bold"><w:name w:val="Heading 1"/><w:rPr><w:b/></w:rPr></w:style><w:style w:type="character" w:styleId="hidden"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>';
    const numbering='<w:numbering xmlns:w="'+W+'"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1、"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="29"/></w:lvlOverride></w:num></w:numbering>';
    const paragraph=(pr,r)=>'<w:p>'+(pr?'<w:pPr>'+pr+'</w:pPr>':'')+r+'</w:p>',run=s=>'<w:r><w:t>'+s+'</w:t></w:r>',style=id=>'<w:pStyle w:val="'+id+'"/>',num=i=>'<w:numPr><w:ilvl w:val="'+i+'"/><w:numId w:val="3"/></w:numPr>';
    const body=paragraph(style('custom'),run('一、标题')+'<w:r><w:br/><w:t>同段续行</w:t></w:r>')+paragraph(style('custom')+'<w:outlineLvl w:val="1"/>',run('直接二级'))+paragraph(style('custom')+'<w:outlineLvl w:val="9"/>',run('直接正文'))+paragraph(style('body'),run('继承后正文'))+paragraph(style('bold'),run('加粗但不是大纲'))+paragraph('',run('可见')+'<w:r><w:rPr><w:rStyle w:val="hidden"/></w:rPr><w:t>隐藏</w:t></w:r><w:del>'+run('删除')+'</w:del><w:moveFrom>'+run('旧位置')+'</w:moveFrom><w:r><w:instrText>外部字段指令</w:instrText><w:t>结果</w:t></w:r>')+paragraph('','<w:r><w:rPr><w:rStyle w:val="hidden"/><w:vanish w:val="0"/></w:rPr><w:t>明确显示</w:t></w:r>')+paragraph(num(0),run('自动编号标题'))+paragraph(num(1),run('自动子号'))+paragraph(num(0),run('下一个主号'))+paragraph(num(1),run('重启子号'));
    const make=(doc,st=styles,nu=numbering)=>zip([['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'],['word/document.xml',doc],['word/styles.xml',st],['word/numbering.xml',nu]]);
    const document='<w:document xmlns:w="'+W+'"><w:body>'+body+paragraph('<w:rPr><w:vanish/></w:rPr>',run('仅隐藏段落标记，文字仍可见'))+'</w:body></w:document>';
    const read=bytes=>p.evaluate(async values=>AuditOutline.read(new File([Uint8Array.from(values)],'synthetic.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})),Array.from(bytes));
    const r=await read(make(document));assert.equal(r.kind,'docx');assert.deepEqual(r.paragraphs.map(x=>x.level),[1,2,null,null,null,null,null,2,3,2,3,null]);
    assert.equal(r.paragraphs[0].styleName,'中文自定义标题');assert.equal(r.paragraphs[0].text,'一、标题\n同段续行');assert.equal(r.paragraphs[5].text,'可见结果');assert.equal(r.paragraphs[6].text,'明确显示');
    assert.deepEqual(r.paragraphs.slice(7,11).map(x=>x.text),['29、 自动编号标题','29.1 自动子号','30、 下一个主号','30.1 重启子号']);assert.equal(r.paragraphs[11].text,'仅隐藏段落标记，文字仍可见');
    assert.equal(r.actualLevels[1],1);assert.equal(r.actualLevels[2],3);assert.equal(r.actualLevels[3],2);
    await assert.rejects(read(make(document,'<!DOCTYPE styles [<!ENTITY x "bad">]>'+styles)),/XML/);
    const cycle='<w:styles xmlns:w="'+W+'"><w:style w:type="paragraph" w:styleId="custom"><w:basedOn w:val="other"/></w:style><w:style w:type="paragraph" w:styleId="other"><w:basedOn w:val="custom"/></w:style></w:styles>';
    await assert.rejects(read(make(document,cycle)),/继承循环/);assert.deepEqual(requests,[]);
  }finally{await b.close();}
});

test('character or mixed-type style chains cannot masquerade as paragraph outlines',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('Existing Playwright unavailable; no install.');}
  const b=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true});
  try{
    const p=await b.newPage();await p.addScriptTag({path:path.resolve(__dirname,'../dist/audit-outline.js')});
    const outcomes=await p.evaluate(async()=>{
      const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',styles='<w:styles xmlns:w="'+W+'"><w:style w:type="character" w:styleId="char"><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:vanish/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="para"><w:basedOn w:val="char"/></w:style></w:styles>';
      const read=async pr=>{const doc='<w:document xmlns:w="'+W+'"><w:body><w:p><w:pPr>'+pr+'</w:pPr><w:r><w:t>正文</w:t></w:r></w:p></w:body></w:document>';globalThis.TenderImport={openBidTemplate:async()=>({read:n=>n==='word/document.xml'?doc:n==='word/styles.xml'?styles:null})};try{return await AuditOutline.read(new File(['x'],'synthetic.docx'));}catch(e){return e.message;}};
      return {direct:await read('<w:pStyle w:val="char"/>'),inherited:await read('<w:pStyle w:val="para"/>')};
    });
    assert.match(outcomes.direct,/样式类型/);assert.match(outcomes.inherited,/样式类型/);
  }finally{await b.close();}
});
