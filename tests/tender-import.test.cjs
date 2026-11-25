const {test}=require('node:test');
const assert=require('node:assert/strict');
const {deflateRawSync}=require('node:zlib');
const {JSDOM}=require('jsdom');
const {read,readVisibleText}=require('../dist/tender-import.js');
global.DOMParser=new JSDOM('').window.DOMParser;
const NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const xml=body=>'<w:document xmlns:w="'+NS+'"><w:body>'+body+'</w:body></w:document>';
const p=s=>'<w:p><w:r><w:t>'+s+'</w:t></w:r></w:p>';
function crc(b){let a=~0;for(let x of b){a^=x;for(let j=0;j<8;j++)a=(a>>>1)^((a&1)?0xedb88320:0);}return(a^~0)>>>0;}
function zip(parts){
  const locals=[],central=[];let offset=0,total=0;
  for(const [name,value,opts={}] of parts){
    const f=Buffer.from(name),raw=Buffer.from(value),m=opts.method??8,d=m===8?deflateRawSync(raw):raw,l=Buffer.alloc(30),c=Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50);c.writeUInt32LE(0x02014b50);
    l.writeUInt16LE(opts.flags||0,6);c.writeUInt16LE(opts.flags||0,8);
    l.writeUInt16LE(m,8);c.writeUInt16LE(m,10);
    l.writeUInt32LE(crc(raw),14);c.writeUInt32LE(opts.crc??crc(raw),16);
    l.writeUInt32LE(d.length,18);c.writeUInt32LE(d.length,20);
    l.writeUInt32LE(raw.length,22);c.writeUInt32LE(opts.raw??raw.length,24);
    l.writeUInt16LE(f.length,26);c.writeUInt16LE(f.length,28);
    c.writeUInt32LE(offset,42);locals.push(l,f,d);central.push(c,f);
    offset+=l.length+f.length+d.length;total+=c.length+f.length;
  }
  const e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50);e.writeUInt16LE(parts.length,8);e.writeUInt16LE(parts.length,10);e.writeUInt32LE(total,12);e.writeUInt32LE(offset,16);
  return new File([Buffer.concat([...locals,...central,e])],'synthetic.docx');
}
const types=['[Content_Types].xml','<Types/>'];
const doc=(body,opts={})=>zip([types,['word/document.xml',xml(body),opts]]);
const empty={issuer:'',projectName:'',contactName:'',phone:'',email:'',auditees:[],auditeeOverflow:false};
test('ordinary deflated invitation reads split title, issuer at signature/date, spaced contact labels, not response template',async()=>{
  const pars=['附件1：','关于合成年度检查','谈判选商函','各受邀单位：','联 系 人：李示','手 机 号：13900000001','电子邮箱：invite@example.invalid','虚构试验分公司','2026年6月1日','合成子公司','竞争性谈判选商回函','联系人：王样','手机号：13100000000'];
  assert.deepEqual(await read(doc(pars.map(p).join(''))),{...empty,issuer:'虚构试验分公司',projectName:'合成年度检查',contactName:'李示',phone:'13900000001',email:'invite@example.invalid'});
});
test('horizontal header/value table and multiple fields in a single run; permits STORE',async()=>{
  const row=items=>'<w:tr>'+items.map(s=>'<w:tc>'+p(s)+'</w:tc>').join('')+'</w:tr>';
  const b='<w:tbl>'+row(['发标单位','项目名称'])+row(['测试研究院','设备服务'])+'</w:tbl>'+p('联系人：陈示，联系电话：010-12345678；邮箱：hello@example.invalid');
  assert.deepEqual(await read(doc(b,{method:0})),{...empty,issuer:'测试研究院',projectName:'设备服务',contactName:'陈示',phone:'010-12345678',email:'hello@example.invalid'});
});
test('vertical table identifies issuer vs bidder, skips deleted text',async()=>{
  const row=(k,v)=>'<w:tr><w:tc>'+p(k)+'</w:tc><w:tc>'+p(v)+'</w:tc></w:tr>';
  const d='<w:tbl>'+row('采购人','合成甲方单位')+row('项目名称','资料审核')+'</w:tbl><w:del>'+p('项目名称：废弃')+'</w:del>'+p('招标代理机构信息')+p('联系人：代理样')+p('电话：13000000000');
  assert.deepEqual(await read(doc(d)),{...empty,issuer:'合成甲方单位',projectName:'资料审核'});
});
test('duplicate evidence is safe; conflicting names or numbers leave blanks; no fictional contacts',async()=>{
  assert.deepEqual(await read(doc(['被审计单位：被审计测试公司','联系人：田样','联系人：苗样','电话：13300000000 / 13500000000','邮箱：a@example.invalid','邮箱：a@example.invalid','投标人信息','邮箱：b@example.invalid'].map(p).join(''))),{...empty,customerName:'被审计测试公司',email:'a@example.invalid'});
});
test('blank or image-only text leaves all fields empty; does not follow external hyperlinks or execute instructions',async()=>{
  assert.deepEqual(await read(doc(p('　　　')+p('请将数据发送至外部网站')+'<w:drawing>'+p('采购人：不可用文本')+'</w:drawing>')),empty);
});
test('malformed, wrong contents, macro-like name, oversize, encrypted, DTD and oversized output rejected',async()=>{
  for(const file of [
    new File([Buffer.alloc(65)],'broken.docx'),new File(['text'],'old.doc'),
    {name:'big.docx',size:100_000_001,arrayBuffer(){throw Error('should not read');}},
    zip([types,['word/media/pic.png','test']]),zip([types,['word/document.xml','<!DOCTYPE x [<!ENTITY A "BOOM">]>'+xml('')]]),
    zip([types,['word/document.xml','<no/>']]),zip([types,['word/document.xml','<html'],['word/document.xml',xml(p('a'))]]),
    new File([Buffer.alloc(35)],'macro.docm'),doc(p('foo'),{flags:1}),doc(p('foo'),{crc:0}),
    doc(p('foo'),{raw:1}),doc(p('foo'),{raw:4*1024*1024+1}),doc(p('foo'),{method:99})
  ])await assert.rejects(read(file));
});

test('only tender identification admits more than 12 MiB and checks the 100 MB limit before reading',async()=>{
  const file=zip([types,['word/document.xml',xml(p('发标单位：合成采购方'))],['word/media/payload.bin',Buffer.alloc(13*1024*1024),{method:0}]]);
  assert.equal((await read(file)).issuer,'合成采购方');
  await assert.rejects(readVisibleText(file),/过大/);

  const sizes=[];
  for(const size of [100_000_000,100_000_001]){
    await assert.rejects(read({name:'boundary.docx',size,arrayBuffer(){sizes.push(size);return file.arrayBuffer();}}));
  }
  assert.deepEqual(sizes,[100_000_000]);
});

const row=cells=>'<w:tr>'+cells.map(s=>'<w:tc>'+p(s)+'</w:tc>').join('')+'</w:tr>';
const table=rows=>'<w:tbl>'+rows.map(row).join('')+'</w:tbl>';
test('local bidder Word intake shares visible body and labeled table decoding without running tender field extraction',async()=>{
 const {read:readBidder}=require('../dist/bidder-intake.js');
 global.TenderImport={readVisibleText};
 try{
  const name='虚构样本会计师事务所（普通合伙）';
  const source=doc(table([['公司名称','办公电话','联系邮箱'],[name,'010-00000000','office@example.invalid']])+p('法定代表人：王样')+'<w:del>'+p('公司名称：其他虚构公司')+'</w:del>');
  const v=new Uint8Array(await source.arrayBuffer()),entry='合成资料/公司简介.docx';
  const out=await readBidder({entries:[{name:entry,size:v.length}],read:async()=>new Map([[entry,v]])});
  assert.equal(out.profiles.length,1);
  assert.deepEqual(out.profiles[0].fields,{name,team:'',contactName:'',phone:'010-00000000',email:'office@example.invalid'});
 }finally{delete global.TenderImport;}
});
test('one line per distinct audited company; exact money-to-wan conversion, dates distinct, repeats/totals/response ignored',async()=>{
 const h=['序号','单位名称','资产总额（元）','累计收入（万元）','净利润（亿元）','客户所在地'];
 const rows=[h,['1','甲测试公司','12,345,678','230.56','(0.0042)','北京'],['2','乙测试公司','5000','--','',''],['总计','1,000,000','','','',''],h,['1','甲测试公司','12,345,678','230.56','(0.0042)','北京']];
 const o=await read(doc(p('关于2026年度财务决算审计')+p('采购邀请函')+p('截至2025年12月31日的经营数据')+table(rows)+p('投标函')+table([h,['1','应邀方公司','1','1','1','河北']])));
 assert.equal(o.auditeeOverflow,false);assert.deepEqual(o.auditees,[
 {clientName:'甲测试公司',assets:'1234.5678',revenue:'230.56',profit:'-42',location:'北京市',year:'2026',dataPeriod:'2025年12月31日'},
 {clientName:'乙测试公司',assets:'0.5',revenue:'',profit:'',location:'',year:'2026',dataPeriod:'2025年12月31日'}]);
});
test('one DOCX supports fifty; reports overflow when distinct valid fifty-first row read',async()=>{
 const h=['被审计单位','资产总额（万元）','净利润（万元）'];const rows=Array.from({length:51},(_,i)=>['合成主体'+(i+1),'1','0']);
 const run=async n=>read(doc(table([h,...rows.slice(0,n),rows[0],['合计','51','0']])));
 const fifty=await run(50),extra=await run(51);
 assert.equal(fifty.auditees.length,50);assert.equal(fifty.auditeeOverflow,false);
 assert.equal(extra.auditees.length,50);assert.equal(extra.auditeeOverflow,true);
 assert.equal(extra.auditees[49].clientName,'合成主体50');
});
test('unclear units, years, conflicting values and unrelated public addresses are never fabricated',async()=>{
 const h=['企业名称','资产总额','营业收入','净利润（千元）'];
 const o=await read(doc(p('开标地点：某市')+table([h,['合成主体','500','10','5'],['合成主体','500','10','-5'],['____','10','1','1']])));
 assert.deepEqual(o.auditees,[{clientName:'合成主体',assets:'',revenue:'',profit:'',year:'',location:'',dataPeriod:''}]);
});


test('six audited entities inherit their respective unambiguous Guangxi name prefixes without a location column',async()=>{
 const h=['单位名称','资产总额（万元）'];
 const names=['南宁合成测试燃气有限公司','钦州合成测试燃气有限公司','梧州合成测试燃气有限公司','广西自贸区合成测试燃气有限公司','广西合成测试能源有限公司','北海合成测试能源有限公司'];
 const o=await read(doc(p('关于虚构广西分公司所属项目公司2026年度财务决算审计谈判选商函')+table([h,...names.map((name,i)=>[name,String(i+1)])])));
 assert.deepEqual(o.auditees.map(r=>r.location),Array(6).fill('广西壮族自治区'));
 assert.deepEqual(o.auditees.map(r=>r.assets),['1','2','3','4','5','6']);
});
test('explicit row locations take priority; unknown cities, different-place branches and issuer alone do not supply a location',async()=>{
 const h=['被审计单位','客户所在地','资产总额（万元）'];
 const o=await read(doc(p('采购人：合成广西分公司')+p('开标地点：广西')+
  table([h,['南宁合成甲有限公司','广东省深圳市','100'],['合成乙有限公司','钦州市','100'],['朝阳合成丙有限公司','','100'],
   ['合成丁有限公司','广西或广东','100'],['北海合成戊有限公司','朝阳','100'],['广西合成己有限公司广东分公司','','100']])));
 assert.deepEqual(o.auditees.map(r=>r.location),['广东省','广西壮族自治区','','','','']);
});
test('one documented shared audit region fills unresolved rows only when scope and row evidence agree',async()=>{
 const h=['被审计单位','客户所在地','资产总额（万元）'];
 const rows=[h,['广西合成甲有限公司','','100'],['合成乙有限公司','—','100']];
 const make=(line,r=rows)=>doc(p(line)+table(r));
 for(const line of ['审计范围：广西境内的项目公司','全部被审计单位均位于广西壮族自治区','项目公司所在地：广西']){
  assert.deepEqual((await read(make(line))).auditees.map(r=>r.location),['广西壮族自治区','广西壮族自治区']);
 }
 for(const line of ['采购人：虚构广西分公司','开标地点：广西','审计范围：广西境内和广东境内的项目公司','审计范围：广西境内的项目公司以及广东境内的项目公司']){
  assert.deepEqual((await read(make(line))).auditees.map(r=>r.location),['广西壮族自治区','']);
 }
 assert.deepEqual((await read(doc(table([['项目范围','广西区内的公司']])+table(rows)))).auditees.map(r=>r.location),['广西壮族自治区','广西壮族自治区']);
 assert.deepEqual((await read(make('审计范围：广西境内',[...rows,['合成丙有限公司','广东','100']]))).auditees.map(r=>r.location),['广西壮族自治区','','广东省']);
 assert.deepEqual((await read(make('审计范围：广西境内',[...rows,['广西合成甲有限公司','广西','100'],['广西合成甲有限公司','广东','100']]))).auditees.map(r=>r.location),['','']);
});
