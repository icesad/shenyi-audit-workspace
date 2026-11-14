
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const B=require('../dist/bid-draft.js');

const WORD='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const headings=[
  '一、投标函','二、法定代表人身份证明','三、授权委托书','四、投标保证金','五、资格审查资料',
  '六、鉴证咨询方案','七、其他资料','八、偏差表','九、供应商准入承诺书'
];
const sample={
  issuer:'虚构采购单位',projectName:'虚构项目准入（仅测试）',firmName:'虚构投标事务所',
  number:'DEMO-TEST-FWE008',packageName:'虚构测试标包',date:'2026-11-10',
  contact:'虚构经办人',phone:'010-00000000',email:'test@example.invalid'
};
function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function unzip(bytes){
  assert.ok(bytes instanceof Uint8Array);
  const b=Buffer.from(bytes),entries=new Map(),end=b.length-22;
  assert.ok(end>=0);assert.equal(b.readUInt32LE(end),0x06054b50,'normal ZIP terminator');
  assert.equal(b.readUInt16LE(end+20),0,'no hidden trailing comment');
  const directory=b.readUInt32LE(end+16),count=b.readUInt16LE(end+10);
  assert.equal(directory+b.readUInt32LE(end+12),end);
  let d=directory;
  for(let i=0;i<count;i++){
    assert.equal(b.readUInt32LE(d),0x02014b50);
    const nameLen=b.readUInt16LE(d+28),extra=b.readUInt16LE(d+30),comment=b.readUInt16LE(d+32),offset=b.readUInt32LE(d+42),
      method=b.readUInt16LE(d+10),packed=b.readUInt32LE(d+20),n=b.readUInt32LE(d+24);
    const name=b.toString('utf8',d+46,d+46+nameLen);
    assert.ok(name&&!entries.has(name)&&!name.startsWith('/')&&!name.includes('..')&&!name.includes('\\'));
    assert.equal(b.readUInt32LE(offset),0x04034b50);assert.equal(b.readUInt16LE(offset+8),method);
    assert.equal(b.toString('utf8',offset+30,offset+30+b.readUInt16LE(offset+26)),name);
    const start=offset+30+b.readUInt16LE(offset+26)+b.readUInt16LE(offset+28);
    assert.ok(start+packed<=directory);assert.ok([0,8].includes(method));
    const raw=method===0?b.subarray(start,start+packed):zlib.inflateRawSync(b.subarray(start,start+packed));
    assert.equal(raw.length,n);assert.equal(crc32(raw),b.readUInt32LE(d+16));
    entries.set(name,raw.toString('utf8'));d+=46+nameLen+extra+comment;
  }
  assert.equal(d,end);assert.equal(entries.size,count);return entries;
}
const xmlDecode=s=>s.replace(/&(amp|lt|gt|quot|apos);/g,(_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[n]);
const ink=s=>[...s.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>xmlDecode(m[1])).join('');
const paragraphs=xml=>[...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(m=>ink(m[0])).filter(Boolean);
function inspection(data=sample){
  const result=B.build(data);
  assert.equal(result.mime,WORD);assert.match(result.name,/^[^/\\]+\.docx$/);
  const members=unzip(result.bytes),xml=members.get('word/document.xml');
  assert.ok(xml);return {result,members,xml};
}
function quoteCell(xml){
  const table=[...xml.matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g)].find(m=>/投标报价/.test(ink(m[0]))&&/投标保证金/.test(ink(m[0])));
  assert.ok(table,'the opening summary table exists');
  const rows=[...table[0].matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map(m=>
    [...m[0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map(cell=>ink(cell[0]).trim()));
  assert.ok(rows.length>=2);
  const column=rows[0].findIndex(c=>/投标报价/.test(c));
  assert.notEqual(column,-1);assert.match(rows[0].join('|'),/投标人.*投标报价.*投标保证金.*备注/);
  assert.ok(rows[1].length>column,'summary contains the fillable price cell');
  return rows[1][column];
}

test('vendor bid draft carries nine substantive headings in source order, without tender-side chapters',()=>{
  assert.deepEqual(B.sections,headings);
  const {xml}=inspection(),paras=paragraphs(xml);
  const actual=[...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(m=>m[0]);
  const chapterParas=actual.filter(p=>/<w:bookmarkStart\b/.test(p));
  assert.deepEqual(chapterParas.map(p=>ink(p).replace(/\s+/gu,'')),headings,'nine headings must exist in the body, not just its contents');
  for(let i=1;i<=headings.length;i++){
    assert.match(chapterParas[i-1],new RegExp('w:name="chapter'+i+'"'));
    assert.match(xml,new RegExp('<w:hyperlink w:anchor="chapter'+i+'"'));
  }
  assert.ok(paras.some(p=>/^\s*投\s*标\s*文\s*件\s*$/u.test(p)));
  assert.match(ink(xml),/草稿|待核对|待复核/);
  assert.match(ink(xml),/未.*保证金已缴纳|不表示保证金已缴纳/);
  assert.match(ink(xml),/不是已作出的承诺/);
  assert.doesNotMatch(ink(xml),/2019\s*年|2021\s*年|2023\s*年|5000\s*元/,'old proof windows and deposit amount do not become project defaults');
  assert.doesNotMatch(ink(xml),/第一章\s*招标公告|评标办法前附表|购买招标文件登记表|产权交易方案/);
});

test('formal price is exactly 1 in the actual opening table only when explicitly opted in',()=>{
  const plain=inspection().xml;
  assert.equal(quoteCell(plain),'待按本项目文件填写','a tender-number suffix cannot auto-select the special price');
  assert.equal(quoteCell(inspection({...sample,formalOne:false}).xml),'待按本项目文件填写');
  assert.equal(quoteCell(inspection({...sample,formalOne:true}).xml),'1');
  assert.equal(quoteCell(inspection({...sample,number:'DEMO-UNRELATED-99'}).xml),'待按本项目文件填写');
  for(const invalid of [1,'true','1'])assert.throws(()=>B.build({...sample,formalOne:invalid}),/形式报价.*无效/);
});

test('bidder fields are editable escaped text; output contains no media, active parts or external relationships',()=>{
  const value='虚构 & <测试> "报价"';
  const {result,members,xml}=inspection({...sample,issuer:value});
  assert.ok(members.has('[Content_Types].xml')&&members.has('_rels/.rels'));
  assert.match(xml,/虚构 &amp; &lt;测试&gt; (?:&quot;|")报价(?:&quot;|")/);
  assert.ok(ink(xml).includes(value));
  for(const key of ['projectName','firmName','number','packageName','contact','phone','email'])
    assert.ok(ink(xml).includes(sample[key]),'field not mapped: '+key);
  assert.match(ink(xml),/2026\s*[-年]\s*11\s*[-月]\s*10/);
  assert.doesNotMatch(result.name,/[/\\]/);
  assert.doesNotMatch(xml,/<测试>|<w:drawing\b|<w:object\b|<w:altChunk\b|r:embed=/);
  for(const [name,content] of members){
    assert.doesNotMatch(name,/(?:\/media\/|\/embeddings\/|\/activeX\/|vbaProject|\.bin$|\.(?:pdf|png|jpe?g)$)/i);
    if(name.endsWith('.rels'))assert.doesNotMatch(content,/TargetMode=["']External["']|Target=["'](?:https?:|file:|\/\/)/i);
    assert.doesNotMatch(content,/<w:documentProtection\b|<w:readonlyRecommended\b/);
  }
  assert.doesNotMatch(members.get('[Content_Types].xml'),/macroEnabled|vbaProject|activeX/i);
});

