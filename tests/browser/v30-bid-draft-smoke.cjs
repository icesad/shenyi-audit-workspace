'use strict';
// Synthetic, local-only browser regression.
// node tests/browser/v30-bid-draft-smoke.cjs [dist/index.html or offline.html]
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const entry=path.resolve(process.argv[2]||path.join(__dirname,'../../dist/index.html'));
const headings=[
  '投标函','法定代表人身份证明','授权委托书','投标保证金','资格审查资料',
  '鉴证咨询方案','其他资料','偏差表','供应商准入承诺书'
];
const data={
  issuer:'虚构甲方采购机构 V30',projectName:'虚构专项 <核验&项目>',firmName:'虚构乙方事务所 V30',
  tenderId:'TEST-BID-2026-FWE008-<018>&',packageName:'虚构二标包 <A&B>',quoteDate:'2026-10-23',
  contact:'虚构投标联系人',phone:'010-00000130',email:'bid-v30@example.invalid'
};
function crc(bytes){
  let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;}
  return (n^0xffffffff)>>>0;
}
function unzip(buf){
  const end=buf.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  assert.ok(end>=0&&end+22+buf.readUInt16LE(end+20)===buf.length,'valid ZIP central directory');
  const count=buf.readUInt16LE(end+10),files=new Map();let at=buf.readUInt32LE(end+16);
  for(let i=0;i<count;i++){
    assert.equal(buf.readUInt32LE(at),0x02014b50);
    const nameLen=buf.readUInt16LE(at+28),extra=buf.readUInt16LE(at+30),comment=buf.readUInt16LE(at+32);
    const local=buf.readUInt32LE(at+42),name=buf.subarray(at+46,at+46+nameLen).toString('utf8');
    assert.ok(!files.has(name)&&!name.startsWith('/')&&!name.includes('\\')&&!name.split('/').includes('..'));
    assert.equal(buf.readUInt32LE(local),0x04034b50);
    assert.equal(buf.readUInt16LE(local+8),buf.readUInt16LE(at+10));
    const start=local+30+buf.readUInt16LE(local+26)+buf.readUInt16LE(local+28);
    const compressed=buf.subarray(start,start+buf.readUInt32LE(at+20)),method=buf.readUInt16LE(at+10);
    const bytes=method===0?compressed:method===8?zlib.inflateRawSync(compressed):null;
    assert.ok(bytes&&bytes.length===buf.readUInt32LE(at+24)&&crc(bytes)===buf.readUInt32LE(at+16),'ZIP integrity: '+name);
    files.set(name,bytes);at+=46+nameLen+extra+comment;
  }
  assert.equal(at,end);return files;
}
async function inspectWord(p,bytes){
  const files=unzip(bytes);
  assert.ok(files.has('[Content_Types].xml')&&files.has('word/document.xml'),'direct Word file, not a folder or ZIP of originals');
  assert.ok([...files.keys()].every(name=>!/(?:^|\/)(?:media|embeddings|activeX|customXml|vbaProject(?:\.bin)?)(?:\/|$)/i.test(name)),'blank Word excludes imported images, credentials, embedded files and active parts');
  for(const [name,b] of files){
    if(!/\.(?:xml|rels)$/i.test(name))continue;
    assert.doesNotMatch(b.toString('utf8'),/<w:drawing\b|<w:pict\b|<w:object\b|r:embed|data:image\/|relationships\/image|TargetMode="External"|attachedTemplate/);
  }
  const xml=files.get('word/document.xml').toString('utf8');
  return p.evaluate(xml=>{
    const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main',doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.querySelector('parsererror')||doc.documentElement.localName!=='document')throw Error('Word XML is not well formed');
    const ink=node=>[...node.getElementsByTagNameNS(ns,'t')].map(t=>t.textContent).join('');
    const paragraphs=[...doc.getElementsByTagNameNS(ns,'p')].map(p=>({
      text:ink(p),
      style:p.getElementsByTagNameNS(ns,'pStyle')[0]?.getAttributeNS(ns,'val')||'',
      bookmark:p.getElementsByTagNameNS(ns,'bookmarkStart')[0]?.getAttributeNS(ns,'name')||''
    }));
    const tables=[...doc.getElementsByTagNameNS(ns,'tbl')].map(t=>[...t.getElementsByTagNameNS(ns,'tr')].map(row=>[...row.getElementsByTagNameNS(ns,'tc')].map(cell=>ink(cell).trim())));
    const opening=tables.find(t=>t[0]?.some(c=>c.includes('投标报价'))&&t[0]?.some(c=>c.includes('投标保证金')));
    const openingPrice=opening?.[1]?.[opening[0].findIndex(c=>c.includes('投标报价'))];
    return {paragraphs,openingPrice,text:paragraphs.map(x=>x.text).join('\n')};
  },xml);
}
async function main(){
  const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true});
  const requests=[],errors=[],steps=[];
  try{
    const ctx=await browser.newContext({acceptDownloads:true,serviceWorkers:'block',viewport:{width:1440,height:1000}});
    ctx.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))requests.push(r.url());});
    await ctx.route(/^https?:/,r=>r.abort());
    const p=await ctx.newPage();p.setDefaultTimeout(10000);
    p.on('pageerror',e=>errors.push(e.message));
    await p.goto(pathToFileURL(entry).href);
    const q=s=>p.locator(s),button=q('#bd-build-download');
    const status=()=>q('#bd-build-status').textContent();
    const enabled=id=>p.waitForFunction(id=>document.querySelector(id)?.disabled===false,id);
    const download=async(selector,ext)=>{
      const [f]=await Promise.all([p.waitForEvent('download'),q(selector).click()]);
      const name=f.suggestedFilename();
      assert.ok(name.endsWith(ext)&&!/[/\\<>:"|?*]/.test(name),name);
      assert.equal(await f.failure(),null);
      return fs.readFileSync(await f.path());
    };
    await q('[data-view=quote]').click();
    const formFields=Object.fromEntries(['issuer','projectName','firmName','quoteDate'].map(key=>[key,q('#proposal-form [name="'+key+'"]')]));
    for(const k of ['issuer','projectName','firmName'])await formFields[k].fill('');
    assert.ok(await button.isVisible());assert.ok(await button.isDisabled());
    assert.match(await button.textContent(),/下载无章标书 Word/);
    await formFields.issuer.fill(data.issuer);
    await formFields.projectName.fill(data.projectName);
    assert.ok(await button.isDisabled(),'draft cannot guess the bidder name');
    await formFields.firmName.fill(data.firmName);
    await formFields.quoteDate.fill(data.quoteDate);
    await q('#bidder-contact').fill(data.contact);await q('#bidder-phone').fill(data.phone);await q('#bidder-email').fill(data.email);
    await enabled('#bd-build-download');
    assert.ok(await q('#preview').isDisabled(),'quote remains blocked without the original certificates');
    const slotIds=()=>q('#bid-files [data-bid-slot]').evaluateAll(rows=>rows.map(el=>el.dataset.bidSlot));
    assert.deepEqual(await slotIds(),['1','2','3','4','5']);
    assert.equal(await q('#bid-files input[type=file]').count(),5);
    await enabled('#bd-slot-3-file');
    const source=Buffer.from(await p.evaluate(async()=>{
      const doc=await PDFLib.PDFDocument.create();doc.addPage().drawText('SYNTHETIC EXISTING ORIGINAL ONLY - NO PRIVATE CONTENT');
      return Array.from(await doc.save({useObjectStreams:false}));
    }));
    const originalName='SYNTHETIC-V30-ORIGINAL.pdf';
    await q('#bd-slot-3-file').setInputFiles({name:originalName,mimeType:'application/pdf',buffer:source});
    await enabled('#bd-slot-3-download');
    await q('#bd-slot-3-name').fill('已上传的虚构原件');
    await q('#bd-slot-3-rename').click();await enabled('#bd-slot-3-download');
    assert.match(await q('[data-bid-slot="3"]').textContent(),/已上传的虚构原件/);
    steps.push('draft action requires actual current bidder identity; five original upload slots stay independently usable');

    const id=q('#bd-build-id'),pack=q('#bd-build-package'),formal=q('#bd-build-formal-one');
    assert.equal(await formal.isChecked(),false);
    await id.fill(data.tenderId);await pack.fill(data.packageName);
    assert.equal(await formal.isChecked(),false,'a tender identifier does not auto-enable the special price');
    const amount=q('#quote-form [name=manual]');
    await q('#quote-form [name=basis]').selectOption('manual');
    await amount.fill('428493.79');
    await p.waitForFunction(()=>document.querySelector('#final-price')?.textContent.includes('428,493.79'));
    const word=await download('#bd-build-download','.docx').catch(async e=>{
      throw Error('Word draft generation failed: '+await status(),{cause:e});
    });
    const {text,paragraphs,openingPrice}=await inspectWord(p,word);
    for(const [key,value] of Object.entries(data))if(key!=='quoteDate')assert.ok(text.includes(value),'live '+key+' is carried into Word as text');
    assert.match(text,/2026\s*(?:年|-)\s*10\s*(?:月|-)\s*23/);
    const primary=paragraphs.filter(r=>/^Heading1$/i.test(r.style));
    assert.deepEqual(primary.map(r=>r.text.replace(/^[一二三四五六七八九十]+[、.．]\s*/u,'').trim()),headings);
    assert.deepEqual(primary.map(r=>r.bookmark),headings.map((_,i)=>'chapter'+(i+1)));
    assert.equal(openingPrice,'待按本项目文件填写');
    assert.match(text,/开标一览表/);
    assert.match(text,/草稿|待审核|待复核|待核对/);
    assert.doesNotMatch(text,/428,493\.79|428493\.79|SYNTHETIC EXISTING ORIGINAL|中瑞诚|中审华|中石油/);
    steps.push('real Word has all nine ordered chapters, the open-bid table and live fields, no copied quote amount, originals or active image resources');

    await amount.fill('');
    await p.waitForFunction(()=>document.querySelector('#final-price')?.textContent.trim()==='—');
    await enabled('#bd-build-download');
    await id.fill('');await pack.fill('');
    await formal.check();
    const second=await inspectWord(p,await download('#bd-build-download','.docx'));
    assert.equal(second.openingPrice,'1','only an explicit opt-in inserts 1 in the actual opening price cell');
    assert.ok(second.text.includes(data.projectName));
    assert.ok(!second.text.includes(data.tenderId)&&!second.text.includes(data.packageName),'cleared optional draft fields do not use stale values');
    assert.deepEqual(await download('#bd-slot-3-download','.pdf'),source,'generation does not replace the uploaded original');
    for(const slot of [1,2,4,5])assert.ok(await q('#bd-slot-'+slot+'-download').isDisabled(),'slot '+slot+' remains empty');
    assert.deepEqual(await slotIds(),['1','2','3','4','5']);
    assert.equal(await p.evaluate(()=>localStorage.getItem('hengdu.audit.quote.records.v2')),null,'draft generation does not register a quote');
    steps.push('draft works with no calculated quote; only explicit opt-in inserts 1; clearing optional values is honored; original is byte-identical and four other slots remain empty');
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,entry,steps,requests,errors}));
  }catch(error){console.error(JSON.stringify({passed:false,entry,steps,requests,errors}));throw error;}
  finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
