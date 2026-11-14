'use strict';
// Synthetic, local-only browser regression.
// node tests/browser/v31-bid-original-smoke.cjs [dist/index.html or offline.html]
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const entry=path.resolve(process.argv[2]||path.join(__dirname,'../../dist/index.html'));
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const headings=['一、投标函','二、法定代表人身份证明','三、授权委托书','四、投标保证金','五、资格审查资料','六、鉴证咨询方案','七、其他资料','八、偏差表','九、供应商准入承诺书'];
const chapterTitle='第四章 投标文件格式',exactClause='测试条款：价格与保证金分别列示；未填写项由供应商核对。';
const poison={buyer:'ONLY-BUYER-CHAPTER-MARK',toc:'ONLY-TOC-ENTRY-MARK',after:'ONLY-LATER-CHAPTER-MARK',external:'https://outside.example.invalid/v31-original'};
const encode=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const xmlHead='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return (n^0xffffffff)>>>0;}
function zip(entries){
  let offset=0;const local=[],central=[];
  for(const [name,value] of entries){
    const n=Buffer.from(name,'utf8'),data=Buffer.from(value),l=Buffer.alloc(30),c=Buffer.alloc(46),checksum=crc(data);
    l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(2048,6);
    l.writeUInt32LE(checksum,14);l.writeUInt32LE(data.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(2048,8);
    c.writeUInt32LE(checksum,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    local.push(l,n,data);central.push(c,n);offset+=l.length+n.length+data.length;
  }
  const dir=Buffer.concat(central),e=Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50);e.writeUInt16LE(entries.length,8);e.writeUInt16LE(entries.length,10);e.writeUInt32LE(dir.length,12);e.writeUInt32LE(offset,16);
  return Buffer.concat([...local,dir,e]);
}
function unzip(buf){
  const end=buf.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  assert.ok(end>=0&&end+22+buf.readUInt16LE(end+20)===buf.length);
  const count=buf.readUInt16LE(end+10),files=new Map();let at=buf.readUInt32LE(end+16);
  for(let i=0;i<count;i++){
    assert.equal(buf.readUInt32LE(at),0x02014b50);
    const nameLen=buf.readUInt16LE(at+28),extra=buf.readUInt16LE(at+30),comment=buf.readUInt16LE(at+32);
    const local=buf.readUInt32LE(at+42),name=buf.subarray(at+46,at+46+nameLen).toString('utf8');
    assert.ok(!files.has(name)&&!name.startsWith('/')&&!name.includes('\\')&&!name.split('/').includes('..'));
    assert.equal(buf.readUInt32LE(local),0x04034b50);
    const start=local+30+buf.readUInt16LE(local+26)+buf.readUInt16LE(local+28);
    const compressed=buf.subarray(start,start+buf.readUInt32LE(at+20)),method=buf.readUInt16LE(at+10);
    const raw=method===0?compressed:method===8?zlib.inflateRawSync(compressed):null;
    assert.ok(raw&&raw.length===buf.readUInt32LE(at+24)&&crc(raw)===buf.readUInt32LE(at+16),name);
    files.set(name,raw);at+=46+nameLen+extra+comment;
  }
  assert.equal(at,end);return files;
}
const docPara=(value,style='',properties='')=>'<w:p>'+(style||properties?'<w:pPr>'+(style?'<w:pStyle w:val="'+style+'"/>':'')+properties+'</w:pPr>':'')+'<w:r><w:t xml:space="preserve">'+encode(value)+'</w:t></w:r></w:p>';
const tblCell=(text,merge=false)=>'<w:tc>'+(merge?'<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>':'')+docPara(text)+'</w:tc>';
const rows=[
  ['投标人','投标报价（元）','投标保证金','备注'],
  ['【待供应商填写】','1','【待按招标文件填写】','测试备注原文'],
];
const table='<w:tbl><w:tblPr><w:tblW w:w="7800" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="2100"/><w:gridCol w:w="2900"/><w:gridCol w:w="1100"/><w:gridCol w:w="1700"/></w:tblGrid>'+
  rows.map(r=>'<w:tr>'+r.map(c=>tblCell(c)).join('')+'</w:tr>').join('')+'<w:tr>'+tblCell('服务范围或计价说明',true)+tblCell('测试合并单元格')+tblCell('附注')+'</w:tr></w:tbl>';
const styledClause=docPara(exactClause,'TestClause','<w:spacing w:before="240" w:after="360"/><w:ind w:left="440"/>');
const sourceSectPr='<w:sectPr><w:footerReference w:type="default" r:id="rId12"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1250" w:right="1430" w:bottom="1320" w:left="1410" w:header="600" w:footer="600" w:gutter="0"/></w:sectPr>';
function supplierChapter(suffix='',extra=''){
  return docPara(chapterTitle,'Heading1','<w:pageBreakBefore/>')+docPara('投 标 文 件','Title')+
    docPara('项目名称：____________________')+docPara('招标编号：____________________')+docPara('投标人：____________________（盖单位章）')+
    docPara('联系人：____________________')+docPara('电话：____________________')+docPara('E-mail：____________________')+docPara('电话：原件已填写的其他用途号码')+
    docPara('目录','Title','<w:pageBreakBefore/>')+headings.map(title=>docPara(title,'TOC1')).join('')+
    headings.map((title,i)=>docPara(title,'Heading2')+
      (i===0?styledClause+docPara('开标一览表','Heading3')+table+extra:docPara('第 '+(i+1)+' 节测试固定条款'+suffix))).join('')+
    docPara('表单原有横版分节','',sourceSectPr);
}
function sample(mode='valid'){
  const styles=xmlHead+'<w:styles xmlns:w="'+W+'">'+['Normal','Title','Heading1','Heading2','Heading3','TOC1','TestClause'].map((id,i)=>
    '<w:style w:type="paragraph" w:styleId="'+id+'"><w:name w:val="'+id+'"/>'+(i>0?'<w:basedOn w:val="Normal"/>':'')+(id==='TestClause'?'<w:rPr><w:b/><w:sz w:val="23"/></w:rPr>':'')+'</w:style>').join('')+'</w:styles>';
  const toc=docPara('目录','Title')+docPara('第一章 招标公告','TOC1')+docPara(chapterTitle,'TOC1')+docPara(poison.toc,'TOC1');
  const buyer=docPara('第一章 招标公告','Heading1')+docPara(poison.buyer)+docPara('第三章 评标办法','Heading1')+docPara('买方评分标准，不得进入供应商表单');
  const hyperlink='<w:p><w:hyperlink r:id="rIdOutside"><w:r><w:t>外链显示字样</w:t></w:r></w:hyperlink></w:p>';
  const external=mode==='external',activeField='<w:p><w:fldSimple w:instr="INCLUDETEXT &quot;'+poison.external+'&quot;"><w:r><w:t>外部字段缓存文本</w:t></w:r></w:fldSimple></w:p>';
  const extra=external?hyperlink:mode==='active'?activeField:'';
  const body=toc+buyer+(mode==='missing'?'':supplierChapter('',extra))+
    (mode==='ambiguous'?supplierChapter('（重复）'):'')+
    docPara('第五章 采购补充说明','Heading1')+docPara(poison.after)+
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1250" w:right="1430" w:bottom="1320" w:left="1410" w:header="600" w:footer="600" w:gutter="0"/></w:sectPr>';
  const ct=xmlHead+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>';
  const rels=(children)=>xmlHead+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+children+'</Relationships>';
  return zip([
    ['[Content_Types].xml',ct],
    ['_rels/.rels',rels('<Relationship Id="rIdDocument" Type="'+REL+'/officeDocument" Target="word/document.xml"/>')],
    ['word/document.xml',xmlHead+'<w:document xmlns:w="'+W+'" xmlns:r="'+REL+'"><w:body>'+body+'</w:body></w:document>'],
    ['word/styles.xml',styles],
    ['word/footer1.xml',xmlHead+'<w:ftr xmlns:w="'+W+'"><w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>'],
    ['word/_rels/document.xml.rels',rels('<Relationship Id="rIdStyles" Type="'+REL+'/styles" Target="styles.xml"/><Relationship Id="rId12" Type="'+REL+'/footer" Target="footer1.xml"/>'+
      (external?'<Relationship Id="rIdOutside" Type="'+REL+'/hyperlink" Target="'+poison.external+'" TargetMode="External"/>':''))]
  ]);
}
async function inspectWord(p,bytes){
  const files=unzip(bytes);
  assert.ok(files.has('[Content_Types].xml')&&files.has('word/document.xml'));
  assert.ok([...files.keys()].every(name=>!/(?:^|\/)(?:media|embeddings|activeX|customXml|vbaProject(?:\.bin)?)(?:\/|$)/i.test(name)));
  for(const [name,b] of files){
    if(!/\.(?:xml|rels)$/i.test(name))continue;
    const t=b.toString('utf8');
    assert.doesNotMatch(t,/<w:drawing\b|<w:pict\b|<w:object\b|r:embed|data:image\/|relationships\/image|TargetMode="External"|attachedTemplate/);
    assert.ok(!t.includes(poison.external),'untrusted external target must not be packaged');
  }
  const xml=files.get('word/document.xml').toString('utf8'),styles=files.get('word/styles.xml')?.toString('utf8')||'';
  const parsed=await p.evaluate(({xml,W})=>{
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.querySelector('parsererror')||doc.documentElement.localName!=='document')throw Error('Invalid Word XML');
    const nodes=(n,l)=>[...n.getElementsByTagNameNS(W,l)];
    const attr=(n,k)=>n?.getAttributeNS(W,k)||'';
    const ink=n=>nodes(n,'t').map(el=>el.textContent).join('');
    const ps=nodes(doc,'p').map(n=>({text:ink(n),style:attr(nodes(n,'pStyle')[0],'val'),left:attr(nodes(n,'ind')[0],'left')}));
    const tables=nodes(doc,'tbl').map(n=>({grid:nodes(n,'gridCol').map(c=>attr(c,'w')),rows:nodes(n,'tr').map(row=>nodes(row,'tc').map(c=>({text:ink(c),span:attr(nodes(c,'gridSpan')[0],'val')})))}));
    const margins=nodes(doc,'pgMar').map(n=>['top','right','bottom','left'].map(k=>attr(n,k)));
    return {ps,tables,margins,text:ps.map(p=>p.text).join('\n')};
  },{xml,W});
  const footer=files.get('word/footer1.xml')?.toString('utf8')||'';
  const rels=files.get('word/_rels/document.xml.rels')?.toString('utf8')||'';
  return {...parsed,styles,xml,footer,rels};
}
async function main(){
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true});
  const steps=[],requests=[],errors=[];
  try{
    const ctx=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});
    ctx.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))requests.push(r.url());});
    await ctx.route(/^https?:/,r=>r.abort());
    const p=await ctx.newPage();p.setDefaultTimeout(10000);
    p.on('pageerror',e=>errors.push(e.message));await p.goto(pathToFileURL(entry).href);
    const q=s=>p.locator(s),file=q('#bd-original-file'),button=q('#bd-original-download'),status=q('#bd-original-status');
    const ack=q('#bd-original-ack'),fill=q('#bd-original-fill');
    await q('[data-view=quote]').click();
    for(const key of ['issuer','projectName','firmName'])await q('#proposal-form [name="'+key+'"]').fill('');
    await q('#quote-form [name=basis]').selectOption('manual');await q('#quote-form [name=manual]').fill('');
    await p.waitForFunction(()=>document.querySelector('#final-price')?.textContent.trim()==='—');
    assert.ok(await button.isVisible());assert.ok(await button.isDisabled());
    assert.equal(await q('#bid-files [data-bid-slot] input[type=file]').count(),5);
    const upload=mode=>file.setInputFiles({name:'synthetic-original-'+mode+'.docx',mimeType:MIME,buffer:sample(mode)});
    const waitReady=async()=>{
      await p.waitForFunction(()=>document.querySelector('#bd-original-ack')?.disabled===false);
      assert.ok(await button.isDisabled(),'even a validated original form requires explicit review acknowledgement');
      assert.equal(await ack.isChecked(),false,'an upload cannot reuse acknowledgement from another file');
      await ack.check();
      await p.waitForFunction(()=>document.querySelector('#bd-original-download')?.disabled===false);
    };
    const download=async()=>{const [f]=await Promise.all([p.waitForEvent('download'),button.click()]);assert.match(f.suggestedFilename(),/^[^/\\]+\.docx$/i);assert.equal(await f.failure(),null);return fs.readFileSync(await f.path());};
    const expectRejected=async(mode,pattern)=>{
      await upload(mode);
      await p.waitForFunction(([source,flags])=>new RegExp(source,flags).test(document.querySelector('#bd-original-status')?.textContent||''),[pattern.source,pattern.flags]);
      assert.ok(await button.isDisabled(),'rejected '+mode+' source must not offer any stale previous download');
    };
    await upload('valid');await waitReady().catch(async e=>{throw Error('Original-form extract not available: '+await status.textContent(),{cause:e});});
    const word=await inspectWord(p,await download());
    assert.ok(!word.text.includes(chapterTitle),'exclude buyer TOC entry and technical chapter boundary');
    assert.ok(word.text.includes('投 标 文 件'),'supplier cover is preserved');
    assert.ok(word.text.includes('投标人：____________________（盖单位章）'));
    assert.equal(await fill.isChecked(),false,'autofill must never be enabled implicitly');
    for(const value of [poison.buyer,poison.toc,poison.after])assert.ok(!word.text.includes(value),'outer chapter content must not be copied: '+value);
    assert.deepEqual(word.ps.filter(x=>x.style==='Heading2').map(x=>x.text),headings);
    assert.deepEqual(word.ps.filter(x=>x.style==='TOC1').map(x=>x.text),headings,'the chapter-local directory stays, unlike the buyer directory');
    assert.match(word.styles,/styleId="TestClause"/);
    assert.deepEqual(word.ps.find(p=>p.text===exactClause),{text:exactClause,style:'TestClause',left:'440'});
    assert.deepEqual(word.tables[0].grid,['2100','2900','1100','1700']);
    assert.deepEqual(word.tables[0].rows.slice(0,2).map(r=>r.map(c=>c.text)),rows);
    assert.deepEqual(word.tables[0].rows[2],[{text:'服务范围或计价说明',span:'2'},{text:'测试合并单元格',span:''},{text:'附注',span:''}]);
    assert.deepEqual(word.margins[0],['1250','1430','1320','1410']);
    assert.match(word.xml,/orient="landscape"/);assert.match(word.footer,/instr="PAGE"/);
    assert.match(word.rels,/Target="footer1\.xml"/);
    steps.push('no proposal or calculated quote needed; supplier-only extraction keeps chapter-local TOC, nine headings, clauses, original fixed 1, cell merges and margins');
    const firm='虚构投标事务所V31 & 公司',contact='虚构联系人 V31',phone='010-00000131',email='bid-v31@example.invalid';
    await q('#proposal-form [name=firmName]').fill(firm);
    await q('#bidder-contact').fill(contact);await q('#bidder-phone').fill(phone);await q('#bidder-email').fill(email);
    await upload('valid');await waitReady();
    const unfilled=await inspectWord(p,await download());
    for(const value of [firm,contact,phone,email])assert.ok(!unfilled.text.includes(value),'no fill before explicit opt-in: '+value);
    await fill.check();
    if(!await ack.isChecked())await ack.check();
    await p.waitForFunction(()=>document.querySelector('#bd-original-download')?.disabled===false);
    const filled=await inspectWord(p,await download());
    for(const value of [firm,contact,phone,email])assert.ok(filled.text.includes(value),'only unambiguous blank carries current value: '+value);
    assert.equal(filled.tables[0].rows[1][1].text,'1');
    assert.ok(filled.text.includes('招标编号：____________________'),'no original tender number guessed');
    assert.ok(filled.text.includes('电话：原件已填写的其他用途号码'),'explicit fill does not overwrite existing content');
    steps.push('opt-in fills only clear bidder/contact blanks, without altering the source form price or inventing tender number');
    await upload('external');await waitReady();
    const sanitized=await inspectWord(p,await download());
    assert.ok(sanitized.text.includes('外链显示字样'),'safe visible link label remains text');
    assert.doesNotMatch(sanitized.xml,/<w:hyperlink[^>]+r:id=/i);
    steps.push('external link target and relationship are stripped, and its visible label remains plain text');
    await expectRejected('active',/不支持|不安全|活动|外部|字段|无法/);
    await expectRejected('missing',/未定位|未找到|未识别|缺少|无法/);
    await upload('valid');await waitReady();
    await expectRejected('ambiguous',/不唯一|多处|多个|有歧义|无法/);
    steps.push('active fields, missing chapter and ambiguous replacements fail closed without any stale prior download');
    assert.equal(await q('#bid-files [data-bid-slot] input[type=file]').count(),5);
    assert.equal(await p.evaluate(()=>localStorage.getItem('hengdu.audit.quote.records.v2')),null);
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,entry,steps,requests,errors}));
  }catch(e){console.error(JSON.stringify({passed:false,entry,steps,requests,errors}));throw e;}
  finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
