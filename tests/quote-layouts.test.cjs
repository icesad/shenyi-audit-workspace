'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const L=require('../dist/quote-layouts.js');
const snap={firmName:'虚构演示事务所',customerName:'虚构被审计单位',auditYear:2026,location:'北京市',service:'年度财务报表审计',quoteDate:'2026-11-07',issuer:'虚构采购单位',projectName:'虚构采购项目',projectType:'专项审计',contactName:'发标人非投标方',contactInfo:'010-00009999',subtotalCents:3012705,taxCents:16450,totalCents:3029155,taxRateText:'按确认口径（演示）',bidderContact:{name:'虚构投标方联系人',phone:'010-00000000',email:'demo@example.invalid'}};
const role=['company_seal','legal_representative_seal','bidder_signature'];
const makeCrc=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
function png(red){const head=Buffer.alloc(13);head.writeUInt32BE(1,0);head.writeUInt32BE(1,4);head[8]=8;head[9]=6;const chunk=(n,d)=>{const b=Buffer.alloc(d.length+12);b.writeUInt32BE(d.length);b.write(n,4,4,'ascii');d.copy(b,8);b.writeUInt32BE(makeCrc(b.subarray(4,-4)),b.length-4);return b;};return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',zlib.deflateSync(Buffer.from([0,red,15,70,255]))),chunk('IEND',Buffer.alloc(0))]);}
const images=role.map((kind,i)=>{const bytes=png(24+i*27);return {kind,name:'synthetic-'+i+'.png',mime:'image/png',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:Uint8Array.from(bytes)};});
function unpack(bytes){const buf=Buffer.from(bytes),out=new Map();let pos=0;
 while(buf.readUInt32LE(pos)===0x04034b50){const n=buf.readUInt16LE(pos+26),x=buf.readUInt16LE(pos+28),start=pos+30+n+x,end=start+buf.readUInt32LE(pos+18),path=buf.toString('utf8',pos+30,pos+30+n),b=buf.subarray(start,end);assert.equal(makeCrc(b),buf.readUInt32LE(pos+14));assert.ok(!out.has(path));out.set(path,b);pos=end;}
 let end=buf.length-22;assert.equal(buf.readUInt32LE(end),0x06054b50);assert.equal(buf.readUInt16LE(end+10),out.size);assert.equal(buf.readUInt32LE(end+16),pos);return out;
}
test('three ordered catalog entries; company seal is suggested for the first two samples',()=>{
 assert.deepEqual(L.catalog.map(t=>t.id),['format1','format2','format3']);
 assert.deepEqual(L.catalog.map(t=>t.defaultKinds),[['company_seal'],['company_seal'],[]]);
 for(const n of [0,6,55,100,101,100000001,999999999999999])assert.match(L.upper(n),/^[零壹贰叁肆伍陆柒捌玖拾佰仟万亿元角分整]+$/);
 assert.equal(L.upper(3000000),'叁万元整');assert.equal(L.upper(100000001),'壹佰万元零壹分');assert.equal(L.upper(10000000100),'壹亿零壹元整');
});
test('single-auditee formats follow the supplied reference order without reusing sampled facts',async()=>{
 const [one,two,three]=await Promise.all(L.catalog.map(t=>L.render(snap,t.id)));
 const xml=x=>unpack(x.docx).get('word/document.xml').toString('utf8');
 const clauses=x=>[...x.html.matchAll(/> *([1-6])[.．、]\s*/g)].map(m=>Number(m[1]));
 for(const x of [one,two,three]){
  for(const doc of [x.html,xml(x)]){
    assert.match(doc,/草稿 · 待审核/);assert.match(doc,/30,291\.55/);assert.match(doc,/虚构采购单位/);
    assert.doesNotMatch(doc,/审计结果保证|法定责任|中审华|中石油|四川隆景轩|中华人民共和国合同法|2025|15\s*日|6%|src=/);
  }
  assert.ok(x.docx instanceof Uint8Array);
 }
 assert.match(one.html,/<h1>报价函<\/h1>/);
 assert.match(one.html,/class="ql-table ql-price-table"/);
 assert.match(one.html,/公司名称.*报价（单位：元）.*虚构被审计单位/);
 assert.equal((xml(one).match(/<w:gridCol /g)||[]).length,2);
 assert.deepEqual(clauses(one),[1,2,3,4,5]);
 assert.match(one.html,/单位名称：虚构演示事务所/);
 assert.match(one.html,/公司公章（待盖章）/);
 assert.doesNotMatch(one.html,/发标人非投标方/);
 for(const x of [two,three]){
   assert.doesNotMatch(x.html,/<table\b/);assert.doesNotMatch(xml(x),/<w:tbl>/);
   assert.match(x.html,/虚构采购项目/);assert.match(x.html,/虚构演示事务所/);
 }
 assert.match(two.html,/<h1>虚构被审计单位<\/h1><p class="ql-subtitle">2026 年度专项审计报价明细<\/p>/);
 assert.match(xml(two),/虚构被审计单位.*2026 年度专项审计报价明细/);
 assert.deepEqual(clauses(two),[1,2,3,4,5]);
 for(const field of [/方案/,/资料分析/,/现场.*盘点/,/报告.*交付/,/问题.*沟通/]){
   assert.match(two.html,field);assert.match(xml(two),field);
 }
 assert.ok(two.html.indexOf('30,291.55')>two.html.indexOf('问题'),'Format 2 presents the total after the five scopes');
 assert.match(three.html,/<h1>虚构采购项目<\/h1><p class="ql-subtitle">2026 年度专项审计报价明细<\/p>/);
 assert.match(xml(three),/虚构采购项目.*2026 年度专项审计报价明细/);
 assert.deepEqual(clauses(three),[1,2,3,4,5,6]);
 assert.doesNotMatch(three.html,/开户行：|银行账号：/,'optional bank details are omitted when unfilled');
 assert.match(three.html,/供应商全称：虚构演示事务所/);
 assert.match(three.html,/虚构投标方联系人/);
 assert.doesNotMatch(three.html,/发标人非投标方/);
 const extras={workDays:'经确认的20天',validity:'虚构有效期',firmAddress:'虚构地址',bankName:'虚构开户银行',bankAccount:'DEMO-ACCT-0000',fax:'010-00000001',legalRepresentative:'虚构法定代表',authorizedPerson:'虚构授权人',costScope:'虚构食宿交通范围',serviceScope:'虚构业务服务范围'};
 const q=await L.render(snap,'format3',[],extras);
 for(const [key,value] of Object.entries(extras))for(const doc of [q.html,xml(q)])assert.ok(doc.includes(value),key);
 const alreadyNamed=await L.render({...snap,projectName:'示例报价单'},'format3');
 assert.match(alreadyNamed.html,/示例报价单/);assert.doesNotMatch(alreadyNamed.html,/报价单报价单/);
 const adjusted=await L.render(snap,'format1',[],{workDays:extras.workDays,serviceScope:extras.serviceScope});
 assert.match(adjusted.html,/经确认的20天/);assert.match(xml(adjusted),/虚构业务服务范围/);
 assert.equal((await L.render(snap,'format2',[],{previewOnly:true})).docx,undefined);
});
test('Word-only export defaults to Format 1, supports a chosen document, and ZIPs only selected unsigned DOCX files',async()=>{
 const docxml=bytes=>{
   const members=unpack(bytes);
   assert.ok(members.has('[Content_Types].xml')&&members.has('word/document.xml'));
   assert.ok([...members.keys()].every(n=>!n.startsWith('word/media/')&&!/\.(?:png|jpe?g|pdf|vba|bin)$/i.test(n)),'unsigned document must have no stamp or attachment parts');
   const xml=members.get('word/document.xml').toString('utf8');
   const rels=members.get('word/_rels/document.xml.rels').toString('utf8');
   assert.match(xml,/草稿 · 待审核/);assert.doesNotMatch(xml,/<w:drawing>|r:embed=|<w:object/);
   assert.doesNotMatch(rels,/relationships\/image|TargetMode="External"/);
   return xml;
 };
 const a=await L.buildUnsignedWord(snap),b=await L.buildUnsignedWord(snap,['format2']);
 for(const file of [a,b]){
   assert.equal(file.mime,L.docxMime);assert.match(file.name,/\.docx$/u);
   assert.ok(file.bytes instanceof Uint8Array);
 }
 const expected={};
 for(const {id} of L.catalog)expected[id]=docxml((await L.render(snap,id)).docx);
 assert.equal(docxml(a.bytes),expected.format1);
 assert.equal(docxml(b.bytes),expected.format2);
 const combined=await L.buildUnsignedWord(snap,['format3','format1']);
 assert.equal(combined.mime,'application/zip');assert.match(combined.name,/\.zip$/u);
 const docs=unpack(combined.bytes);
 assert.equal(docs.size,2);
 for(const [n] of docs)assert.match(n,/^[^/\\]+\.docx$/u);
 assert.deepEqual(new Set([...docs.values()].map(docxml)),new Set([expected.format1,expected.format3]));
 const customized=await L.buildUnsignedWord(snap,['format3'],{validity:'虚构有效期',previewOnly:true});
 assert.match(docxml(customized.bytes),/虚构有效期/,'Word export accepts options and is not a preview');
 await assert.rejects(()=>L.buildUnsignedWord(snap,['format4']),/版式|格式|未知/);
 await assert.rejects(()=>L.buildUnsignedWord(snap,['format1','format1']),/版式|格式|未知/);
});

test('exactly the confirmed role assets are embedded with original verified bytes, no cross-role bleed',async()=>{
 for(const [i,id]of L.catalog.map(t=>t.id).entries()){
  const art=await L.render(snap,id,[images[i]]),records=unpack(art.docx),xml=records.get('word/document.xml').toString('utf8');
  assert.equal((art.html.match(/<img /g)||[]).length,1);assert.match(art.html,new RegExp('data-sign-kind="'+role[i]+'"[^>]*><img'));
  assert.ok(art.html.includes('data:image/png;base64,'+Buffer.from(images[i].bytes).toString('base64')));
  assert.equal([...records.keys()].filter(p=>p.startsWith('word/media/')).length,1);assert.deepEqual(records.get('word/media/image-1.png'),Buffer.from(images[i].bytes));
  assert.match(xml,/r:embed="rIdImage1"/);assert.doesNotMatch(records.get('word/_rels/document.xml.rels').toString('utf8'),/TargetMode="External"/);
  assert.match(xml,/草稿 · 待审核/);
 }
 await assert.rejects(()=>L.render(snap,'format4',[]),/未知/);
 await assert.rejects(()=>L.render(snap,'format2',[images[0],images[0]]),/章签/);
 await assert.rejects(()=>L.render(snap,'format2',[{...images[0],sha256:'f'.repeat(64)}]),/SHA-256/);
 await assert.rejects(()=>L.render(snap,'format2',[{...images[0],mime:'image/svg+xml'}]),/章签/);
});
test('HTML and XML escape untrusted field text; draft only, no active content or external resources',async()=>{
 const fake='<img src=x onerror=alert(1)>&"';
 const r=await L.render({...snap,projectName:fake},'format3',[],{negotiationNo:fake});
 assert.doesNotMatch(r.html,/<script|<img|<link|<iframe/i);assert.match(r.html,/&lt;img src=x onerror=alert\(1\)&gt;&amp;&quot;/);
 const records=unpack(r.docx);assert.equal(records.size,5);const xml=records.get('word/document.xml').toString('utf8');
 assert.match(xml,/&lt;img src=x onerror=alert\(1\)&gt;&amp;&quot;/);assert.doesNotMatch(xml,/<img|vbaProject|TargetMode="External"/);
});

test('a six-auditee detail is one printable HTML/Word letter, with exact totals in every format',async()=>{
 const quoteRows=[
   {name:'合成一号单位',assets:'0.100001',revenue:'12.34',profit:'-0.31',period:'2026-10-31',totalCents:501001},
   {name:'合成二号单位',assets:'0.200002',revenue:'1.01',profit:'0.21',period:'2026-10-31',totalCents:479002},
   {name:'合成三号单位',assets:'12.34',revenue:'0.10',profit:'0.01',period:'2026-10-31',totalCents:367003},
   {name:'合成四号单位',assets:'2.35',revenue:'0.20',profit:'0.02',period:'2026-10-31',totalCents:500004},
   {name:'合成五号单位',assets:'3.29',revenue:'0.30',profit:'0.03',period:'2026-10-31',totalCents:390005},
   {name:'合成六号单位',assets:'4.56',revenue:'0.40',profit:'0.04',period:'2026-10-31',totalCents:792140},
 ];
 const total=quoteRows.reduce((a,b)=>a+b.totalCents,0);
 assert.equal(total,snap.totalCents);
 for(const {id} of L.catalog){
   const q=await L.render({...snap,quoteRows},id),xml=unpack(q.docx).get('word/document.xml').toString('utf8');
   assert.equal((q.html.match(/<article /g)||[]).length,1);
   assert.equal((q.html.match(/<table /g)||[]).length,1);
   assert.equal((q.html.match(/<tr[ >]/g)||[]).length,8);
   assert.equal((xml.match(/<w:tr>/g)||[]).length,8);
   assert.equal((xml.match(/<w:gridCol /g)||[]).length,({format1:2,format2:6,format3:6})[id]);
   const amounts=quoteRows.map(r=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(r.totalCents/100));
   const details=id==='format1'?quoteRows.map(r=>L.upper(r.totalCents)):['财务数据期间：2026-10-31','22.840003','14.35','0.00'];
   for(const str of ['分户报价明细（共 6 家）','30,291.55',...quoteRows.map(r=>r.name),...amounts,...details]){
     assert.ok(q.html.includes(str),id+' HTML missing '+str);
     assert.ok(xml.includes(str),id+' Word missing '+str);
   }
   if(id==='format1'){
     for(const doc of [q.html,xml])assert.doesNotMatch(doc,/资产总额（万元）|净利润（万元）|财务数据期间/);
     assert.match(q.html,/class="ql-table ql-price-table"/);
   }
   if(id!=='format1')assert.match(q.html,/class="ql-table ql-batch-table"/);
   if(id==='format2')assert.match(q.html,/<h1>虚构采购单位<\/h1>/,'multi-subject format 2 uses project issuer as its title, not the active subject');
   assert.doesNotMatch(q.html.match(/<table .*?<\/table>/u)[0],/虚构被审计单位/,'only actual batch rows occur in the quote table');
 }
});

test('missing values do not fabricate totals; mixed periods are preserved; mismatched totals are rejected',async()=>{
 const quoteRows=[
   {name:'<虚构一号 & 财务>',assets:'',revenue:'1',profit:'-1.2',period:'2026-01-01',totalCents:3029154},
   {name:'虚构二号',assets:'100',revenue:'2',profit:'0.20',period:'2026-01-02',totalCents:1}
 ];
 const r=await L.render(snap,'format3',[],{quoteRows});
 assert.match(r.html,/&lt;虚构一号 &amp; 财务&gt;（财务数据期间：2026-01-01）/);
 assert.match(r.html,/虚构二号（财务数据期间：2026-01-02）/);
 assert.ok(r.html.includes('<tr class="ql-sum"><td></td><td>合计</td><td>—</td><td>3.00</td><td>-1.00</td><td>30,291.55</td></tr>'));
 assert.match(r.html,/存在缺项的指标不计算合计/);
 await assert.rejects(()=>L.render(snap,'format3',[],{quoteRows:[quoteRows[0]]}),/不一致/);
 await assert.rejects(()=>L.render(snap,'format3',[],{quoteRows:[{...quoteRows[0],assets:'NaN'},quoteRows[1]]}),/财务数据无效/);
});

test('verified snapshot supplies aggregate rows without options and conflicting overrides fail closed',async()=>{
 const quoteRows=[
   {name:'虚构一号',assets:'0.10',revenue:'0.00',profit:'0',period:'',totalCents:2000055},
   {name:'虚构二号',assets:'0.20',revenue:'',profit:'',period:'',totalCents:1029100}
 ];
 const fixed={...snap,quoteRows};
 const {html}=await L.render(fixed,'format1');
 assert.match(html,/虚构二号/);assert.match(html,/30,291\.55/);
 const identicalAmounts=[{...quoteRows[0],assets:'0.100'},quoteRows[1]];
 const equal=await L.render(fixed,'format1',[],{quoteRows:identicalAmounts});
 assert.equal(equal.html,html);
 await assert.rejects(()=>L.render(fixed,'format1',[],{quoteRows:[{...quoteRows[0],name:'错配单位'},quoteRows[1]]}),/报价快照不一致/);
});
