'use strict';
// Synthetic only. node tests/browser/v22-quote-batch-smoke.cjs <extracted demo> [index or offline HTML]
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const [demo,html=path.resolve(__dirname,'../../dist/index.html')]=process.argv.slice(2);
const names=[...'甲乙丙丁戊己'].map(x=>'虚构样本'+x+'有限公司');
const amountStrings=['123.45','230.10','11.00','69.01','42.12','700.32'],amountCents=[12345,23010,1100,6901,4212,70032],sum=117600;
const docType='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function crc(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return(n^0xffffffff)>>>0;}
function unzip(b){
  const end=b.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));assert.ok(end>=0);
  const count=b.readUInt16LE(end+10),dir=b.readUInt32LE(end+16),files=new Map();let i=dir;
  for(let k=0;k<count;k++){
    assert.equal(b.readUInt32LE(i),0x02014b50);
    const nameLen=b.readUInt16LE(i+28),extra=b.readUInt16LE(i+30),comment=b.readUInt16LE(i+32),local=b.readUInt32LE(i+42);
    const name=b.subarray(i+46,i+46+nameLen).toString('utf8'),method=b.readUInt16LE(i+10),len=b.readUInt32LE(i+20);
    assert.ok(!files.has(name)&&!name.startsWith('/')&&!name.split('/').includes('..'));
    assert.equal(b.readUInt32LE(local),0x04034b50);
    const start=local+30+b.readUInt16LE(local+26)+b.readUInt16LE(local+28),compressed=b.subarray(start,start+len);
    const data=method===0?compressed:method===8?zlib.inflateRawSync(compressed):null;
    assert.ok(data);assert.equal(data.length,b.readUInt32LE(i+24));assert.equal(crc(data),b.readUInt32LE(i+16));
    files.set(name,data);i+=46+nameLen+extra+comment;
  }
  assert.equal(i,end);return files;
}
function zipStore(files){
  const locals=[],central=[];let offset=0;
  for(const [name,data]of files){
    const n=Buffer.from(name),l=Buffer.alloc(30),c=Buffer.alloc(46),checksum=crc(data);
    l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(2048,6);l.writeUInt32LE(checksum,14);
    l.writeUInt32LE(data.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(n.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(2048,8);c.writeUInt32LE(checksum,16);
    c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    locals.push(l,n,data);central.push(c,n);offset+=l.length+n.length+data.length;
  }
  const dir=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,dir,end]);
}
function sixSubjectTender(){
  const source=unzip(fs.readFileSync(path.join(demo,'01-虚构发标函-含两家被审计方.docx'))),n='word/document.xml',xml=source.get(n).toString('utf8');
  const template=[...xml.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map(m=>m[0]).find(t=>t.includes(names[0]));
  assert.ok(template,'synthetic fixture must have a first auditee table row');assert.ok(xml.includes(names[1]));
  const extra=names.slice(2).map((name,i)=>template.replace(names[0],name).replace('1200.50',String(3200+i)+'.75').replace('>-2<','>'+String(5+i)+'<')).join('');
  assert.equal(xml.split('</w:tbl>').length,2);
  source.set(n,Buffer.from(xml.replace('</w:tbl>',extra+'</w:tbl>')));
  return zipStore(source);
}
function unsignedWordXml(bytes){
  const files=unzip(bytes),xml=files.get('word/document.xml')?.toString('utf8'),rels=files.get('word/_rels/document.xml.rels')?.toString('utf8')||'';
  assert.ok(xml,'download must be a direct Word file, not a ZIP of attachments');
  assert.deepEqual([...files.keys()].filter(n=>n.startsWith('word/media/')),[]);
  assert.doesNotMatch(xml,/<w:drawing\b|<w:pict\b|r:embed|data:image\//);
  assert.doesNotMatch(rels,/relationships\/image|TargetMode="External"/);
  return xml;
}
function assertAllPrices(doc){
  for(const name of names)assert.ok(doc.includes(name),name+' included');
  for(const [i,price] of amountStrings.entries())assert.ok(doc.includes(price),'exact amount of row '+(i+1));
  assert.match(doc,/1,176\.00/);
}
function batchPacket(bytes,wordToolbar=false){
  const files=unzip(bytes),m=JSON.parse(files.get('附件清单.json'));
  assert.equal(m.snapshot.totalCents,sum);assert.equal(m.snapshot.subtotalCents+m.snapshot.taxCents,sum);
  assert.deepEqual(m.snapshot.quoteRows.map(x=>x.name),names);
  assert.deepEqual(m.snapshot.quoteRows.map(x=>x.totalCents),amountCents);
  assert.equal(m.snapshot.quoteRows[0].profit,'-2');
  const d=m.documents.find(d=>d.formatId==='format1');assert.ok(d,'quote detail letter must include format 1');
  const body=files.get(d.html.path),docx=files.get(d.docx.path);
  assert.equal(sha(body),d.html.sha256);assert.equal(sha(docx),d.docx.sha256);
  const html=body.toString('utf8'),word=unzip(docx).get('word/document.xml').toString('utf8');
  for(const doc of [html,word]){
    assertAllPrices(doc);
    assert.match(doc,/报价明细函|分户报价明细/);
    if(wordToolbar){
      assert.match(doc,/公司名称/);
      assert.doesNotMatch(doc,/净利润（万元）/);
    }else assert.match(doc,/净利润（万元）/);
  }
  return m.snapshot.quoteRows;
}
async function main(){
  assert.ok(demo,'pass the extracted synthetic 演示材料 directory');
  const steps=[],requests=[],errors=[];
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true});
  try{
    const ctx=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1440,height:900}});
    ctx.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))requests.push(r.url());});
    await ctx.route(/^https?:/,r=>r.abort());
    const p=await ctx.newPage();p.setDefaultTimeout(12000);
    p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
    await p.goto(pathToFileURL(html).href);
    const q=s=>p.locator(s),ready=(s,t)=>p.waitForFunction(([s,t])=>document.querySelector(s)?.textContent.includes(t),[s,t]);
    const wordSelector='#quote-download-unsigned-word',wordToolbar=await q(wordSelector).count()===1;
    const downloadWord=async()=>{
      assert.equal(await q(wordSelector).isVisible(),true);
      const [d]=await Promise.all([p.waitForEvent('download'),q(wordSelector).click()]);
      assert.equal(await d.failure(),null);assert.match(d.suggestedFilename(),/\.docx$/i);
      return unsignedWordXml(fs.readFileSync(await d.path()));
    };
    const download=async selector=>{const [d]=await Promise.all([p.waitForEvent('download'),q(selector).click()]);assert.equal(await d.failure(),null);return fs.readFileSync(await d.path());};
    await q('[data-view=bidders]').click();
    await q('#bidder-archive-file').setInputFiles(path.join(demo,'04-虚构投标方基础资料.zip'));
    await ready('#bidder-editor-status','已填入待核对资料');
    await q('#bidder-edit-kind').selectOption('own');await q('#bidder-save').click();
    const bidder=q('[data-bidder-edit]');await bidder.waitFor();
    await q('[data-view=quote]').click();
    await q('#tender-file').setInputFiles({name:'06-虚构六家发标函.docx',mimeType:docType,buffer:sixSubjectTender()});
    await p.waitForFunction(()=>document.querySelectorAll('[data-auditee-row]').length===6);
    await q('#bidder-picker-select').selectOption(await bidder.getAttribute('data-bidder-edit'));
    await ready('#credentials-status','两证齐全');
    assert.equal(await q('#quote-scope').inputValue(),'batch');
    assert.equal(await q('#quote-batch [data-batch-amount]').count(),6);
    const amounts=q('#quote-batch [data-batch-amount]'),factor=q('[name=pricePercent]');
    const rowAmount=i=>q('[data-batch-amount="'+i+'"]');
    if(await factor.count()){
      const getCents=()=>amounts.evaluateAll(inputs=>inputs.map(n=>Math.round(Number(n.value)*100)));
      assert.equal(await factor.inputValue(),'100');
      const expected=[1110250,1760120,2110375,2110875,2111375,2111875];
      assert.deepEqual(await getCents(),expected,'independent rates for each row with a separately labeled Shanghai fallback');
      assert.deepEqual(await amounts.evaluateAll(inputs=>inputs.map(n=>n.dataset.batchPriceOrigin)),Array(6).fill('auto'));
      assert.match(await q('[data-batch-source="0"]').textContent(),/自动测算.*河北/);
      assert.match(await q('[data-batch-source="1"]').textContent(),/暂用河北.*非当地标准/);
      assert.equal(await q('#export-current-quote').isEnabled(),true);
      await rowAmount(0).fill('88.80');
      await q('[data-auditee-select="1"]').click();
      assert.equal(await rowAmount(0).inputValue(),'88.80','active row switch does not discard overrides');
      assert.equal(await rowAmount(0).getAttribute('data-batch-price-origin'),'manual');
      for(const n of [70,120,100]){
        await factor.fill(String(n));
        assert.deepEqual(await getCents(),expected.map(c=>Number((BigInt(c)*BigInt(n)+50n)/100n)));
      }
      await rowAmount(5).fill('');
      await ready('#quote-batch-status','第 6 家');
      for(const selector of ['#preview','#preview-with-seal','#export-current-quote','#register-quote'])assert.equal(await q(selector).isEnabled(),false,selector);
      await q('[data-batch-auto="5"]').click();
      assert.deepEqual(await getCents(),expected);
      assert.equal(await q('#export-current-quote').isEnabled(),true);
      await q('[data-auditee-select="0"]').click();
      steps.push('six independent auto-prices, labeled fallback, factor 100/70/120, manual override and explicit blank/restoration');
    }else{
      assert.deepEqual(await amounts.evaluateAll(x=>x.map(n=>n.value)),Array(6).fill(''));
      for(const selector of ['#preview','#preview-with-seal','#export-current-quote','#register-quote'])assert.equal(await q(selector).isEnabled(),false,selector);
      await ready('#quote-batch-status','第 1 家');
    }
    for(const [i,v]of amountStrings.entries())await rowAmount(i).fill(v);
    await ready('#quote-batch-status','1,176.00');
    steps.push('six synthetic auditees import in batch mode and retain manually confirmed exact prices');

    // No layout selected: batch quotes still use the detailed letter (format 1).
    assert.equal(await q('#quote-layout-format1').isChecked(),false);
    await q('#preview').click();await q('#quote-dialog[open]').waitFor();
    const doc=q('#customer-preview');
    assert.match(await doc.textContent(),/报价明细函|分户报价明细/);assert.match(await doc.textContent(),/1,176\.00/);
    for(const name of names)assert.ok((await doc.textContent()).includes(name));
    let firstUnsignedWord;
    if(wordToolbar){
      firstUnsignedWord=await downloadWord();
      assertAllPrices(firstUnsignedWord);
      assert.match(firstUnsignedWord,/公司名称/);
      assert.equal((firstUnsignedWord.match(/<w:gridCol /g)||[]).length,2,'no selected format downloads the direct format 1 DOCX');
    }
    await q('#close-preview').click();
    const first=batchPacket(await download('#export-current-quote'),wordToolbar);
    if(wordToolbar){
      await q('#quote-layout-format3').check();
      await q('#preview').click();await q('#quote-dialog[open]').waitFor();
      const selected=await downloadWord();
      assertAllPrices(selected);
      assert.equal((selected.match(/<w:gridCol /g)||[]).length,6,'one explicitly selected format 3 downloads the direct six-column DOCX');
      assert.match(selected,/净利润（万元）/);
      await q('#close-preview').click();await q('#quote-layout-format3').uncheck();
      steps.push('unsigned direct Word download defaults to format 1 and respects one explicitly selected format 3');
    }
    steps.push('batch preview plus HTML and DOCX contain all six auditees, exact per-unit prices and aggregate total');

    await q('#preview-with-seal').click();await q('#quote-dialog[open]').waitFor();
    const company=q('[data-quote-page-sign-kind=company_seal]');
    if(await company.count()){
      await company.check();
      await q('#quote-page-seal').check();
      await q('#quote-preview-sealed-pdf').click();
    }
    await q('#quote-sealed-preview canvas').waitFor({state:'visible'});
    const reviewed=await q('#quote-sealed-status').textContent();
    const expectedPages=Number(reviewed?.match(/共\s*(\d+)\s*页/)?.[1]||0);
    assert.ok(expectedPages>=3,'complete signed batch includes quotation body and two certificate pages');
    const pdf=await download('#quote-download-sealed-pdf');
    const pdfPageCount=await p.evaluate(async bytes=>(await PDFLib.PDFDocument.load(Uint8Array.from(bytes))).getPageCount(),Array.from(pdf));
    assert.equal(pdfPageCount,expectedPages);
    await q('#close-preview').click();
    steps.push('batch quote opens actual sealed PDF canvas and downloads the same complete page count');

    await q('#register-quote').click();await ready('#proposal-status','本次报价已登记');
    await q('#quote-scope').selectOption('single');
    assert.equal(await q('#quote-batch [data-batch-amount]').first().isVisible(),false);
    const singleFiles=unzip(await download('#export-current-quote')),single=JSON.parse(singleFiles.get('附件清单.json'));
    assert.equal(Object.hasOwn(single.snapshot,'quoteRows'),false);
    assert.equal(single.snapshot.customerName,names[0]);
    steps.push('explicit single scope keeps legacy single-subject quote export behavior');

    await p.reload();await q('[data-view=ledger]').click();
    assert.equal(await q('#ledger-rows tr').count().then(async n=>{if(!n)await q('#ledger-rows tr').first().waitFor();return q('#ledger-rows tr').count();}),1);
    assert.match(await q('#ledger-rows').textContent(),/1,176\.00/);
    await q('#ledger-rows [data-packet-id]').click();await q('#quote-dialog[open]').waitFor();
    for(const name of names)assert.ok((await doc.textContent()).includes(name),'historical preview '+name);
    assert.deepEqual(batchPacket(await download('#download-packet'),wordToolbar),first);
    if(wordToolbar)assert.equal(await downloadWord(),firstUnsignedWord,'historical Word uses the exact immutable six-row snapshot with default format 1');
    await q('#close-preview').click();
    steps.push('registered history reopens with exact aggregate row snapshot after browser reload');

    await q('[data-view=quote]').click();
    assert.equal(await q('#bid-files input[type=file]').count(),5);
    assert.deepEqual(await q('#bid-files [data-bid-slot]').evaluateAll(x=>x.map(el=>el.dataset.bidSlot)),['1','2','3','4','5']);
    steps.push('quote area has five independent bid-file upload slots');
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,entry:html,steps,requests,errors}));
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
