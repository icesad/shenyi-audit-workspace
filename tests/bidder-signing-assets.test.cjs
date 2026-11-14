'use strict';
const {test}=require('node:test'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..','dist');
test('bidder signing images are local per-firm records, not quote attachments, with no rewrite of v1 credentials',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('no installed Playwright');}
  const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(executable))return t.skip('no installed Chromium');
  const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});let context;
  try{
    context=await browser.newContext();
    const requests=[];context.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
    const page=await context.newPage();await page.goto(pathToFileURL(path.join(root,'rule-catalog.js')).href);
    for(const n of ['rule-catalog.js','quote-packet.js','bidder-library.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,n),'utf8')});
    const result=await page.evaluate(async()=>{
      const expected=(v,label)=>{if(!v)throw Error('bidder signing assets: '+label);};
      const refused=async(fn)=>{try{await fn();return false;}catch{return true;}};
      const open=version=>new Promise((ok,no)=>{
        const r=indexedDB.open(BidderLibrary.DATABASE,version);
        r.onupgradeneeded=e=>{expected(e.oldVersion===0&&version===1,'fresh legacy fixture');for(const n of ['firms','firmCredentials'])r.result.createObjectStore(n,{keyPath:'id'});};
        r.onerror=()=>no(r.error);r.onsuccess=()=>ok(r.result);
      });
      const put=(db,row,blob)=>new Promise((ok,no)=>{
        const tx=db.transaction(['firms','firmCredentials'],'readwrite');
        tx.objectStore('firms').put(row);tx.objectStore('firmCredentials').put(blob);
        tx.oncomplete=ok;tx.onabort=()=>no(tx.error);
      });
      const fields=name=>({name,kind:'own',team:'河北',contactName:'',phone:'',email:''});
      const file=(kind,letter)=>BidderLibrary.readProfileFile(new File(['%PDF-1.4\n% SYNTHETIC '+letter+'\n%%EOF\n'],letter+'.pdf',{type:'application/pdf'}),kind);
      const image=(type,name,color)=>new Promise((ok,no)=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=20;
        const c=canvas.getContext('2d');c.fillStyle=color;c.fillRect(0,0,20,20);
        canvas.toBlob(blob=>{if(!blob){no(Error('Synthetic canvas conversion failed'));return;}ok(new File([blob],name,{type:blob.type}));},type);
      });
      const kinds=BidderLibrary.SIGNING_KINDS,license=await file('business_license','SYNTHETIC-A'),practice=await file('practice_certificate','SYNTHETIC-B');
      expected(kinds.join(',')==='company_seal,legal_representative_seal,bidder_signature','stable kind contract');
      const legacy=await open(1),id=crypto.randomUUID(),oldRow={id,version:1,...fields('Synthetic v1'),credentialKinds:[license.kind,practice.kind]};
      await put(legacy,oldRow,{id,version:1,attachments:[license,practice]});
      let closed=false;legacy.onversionchange=()=>{closed=true;legacy.close();};
      const db=await BidderLibrary.open();let another=null;
      try{
        expected(closed&&await refused(()=>open(1)),'old writers closed; no downgrade');
        const old=await db.get(id),before=(await db.list()).find(r=>r.id===id);
        expected(Object.keys(before).length===Object.keys(oldRow).length&&Object.keys(oldRow).every(k=>JSON.stringify(before[k])===JSON.stringify(oldRow[k]))&&old.attachments[0].sha256===license.sha256&&!Object.hasOwn(old,'signingAssets'),'v1 records unchanged');
        const incoming=await Promise.all([
          image('image/png','synthetic-company-seal.png','#225566').then(f=>BidderLibrary.readProfileFile(f,kinds[0])),
          image('image/png','synthetic-legal-seal.png','#442211').then(f=>BidderLibrary.readProfileFile(f,kinds[1])),
          image('image/jpeg','synthetic-bidder-signature.jpg','#113344').then(f=>BidderLibrary.readProfileFile(f,kinds[2]))
        ]);
        const stored=await db.update(id,1,fields('Synthetic v2'),[incoming[2],practice,incoming[1],license,incoming[0]]);
        expected(stored.version===2&&stored.attachments.length===2&&stored.signingAssets.length===3,'separate certs and signing images');
        expected(stored.signingKinds.join(',')===kinds.join(',')&&stored.signingAssets.map(f=>f.sha256).join(',')===incoming.map(f=>f.sha256).join(','),'stable sort and original hashes');
        const row=(await db.list()).find(r=>r.id===id);
        expected(row.credentialKinds.length===2&&row.signingKinds.length===3&&!Object.hasOwn(row,'signingAssets')&&!Object.hasOwn(row,'attachments'),'list exposes metadata only');
        expected(await refused(()=>QuotePacket.verifyAttachment(incoming[0]))&&await refused(()=>QuotePacket.verifyPair([license,incoming[1]])),'quote packet validator rejects all noncertificate kinds');
        expected((await QuotePacket.verifyPair(stored.attachments)).length===2,'the real certificate pair still exports');
        const outsider=await db.create(fields('Synthetic outside firm'),[practice]);
        expected(!Object.hasOwn(await db.get(outsider.id),'signingAssets'),'no other firm fallback');
        const kept=await db.update(id,2,fields('Metadata only'));
        expected(kept.signingAssets[2].sha256===incoming[2].sha256,'metadata-only update preserves images');
        stored.signingAssets[0].bytes.fill(0);expected((await db.get(id)).signingAssets[0].bytes[0]===137,'caller cannot mutate stored bytes');
        const pdf=new File(['%PDF-1.4\n%%EOF\n'],'bad.pdf',{type:'application/pdf'});
        const svg=new File(['<svg></svg>'],'bad.svg',{type:'image/svg+xml'});
        const spoof=new File(['<svg></svg>'],'bad.png',{type:'image/png'});
        // EXIF-shaped segment contains a fake EOI before the primary scan.
        const jpeg=incoming[2].bytes,metadata=new Uint8Array([255,225,0,12,69,120,105,102,0,0,255,217,0,0]);
        const withThumb=[jpeg.subarray(0,2),metadata,jpeg.subarray(2)];
        const makeJpeg=(...parts)=>new File(parts,'synthetic-jpeg-tail.jpg',{type:'image/jpeg'});
        const canonical=await BidderLibrary.readProfileFile(makeJpeg(...withThumb),kinds[2]);
        const trailer=new Uint8Array(24);trailer.set([0,255,217,1],4);
        const odd=makeJpeg(...withThumb,trailer),clean=await BidderLibrary.readProfileFile(odd,kinds[2]);
        expected(clean.sha256===canonical.sha256&&clean.size+24===odd.size&&clean.bytes.at(-1)===217,'real JPEG scan end and EXIF fake EOI');
        expected(await refused(()=>QuotePacket.readAttachment(odd,'business_license')),'no trimming for quote credentials');
        trailer.set([255,217],22); // A fake second EOI must not hide a trailer.
        const fakeEnd=makeJpeg(...withThumb,trailer),normalized=await BidderLibrary.readProfileFile(fakeEnd,kinds[2]);
        expected(normalized.sha256===canonical.sha256,'detect first true scan EOI even with fake end marker');
        expected(await refused(()=>BidderLibrary.readProfileFile(makeJpeg(...withThumb,new Uint8Array(257)),kinds[2])),'refuse >256 bytes outside the image');
        const forgedTail={...await QuotePacket.readAttachment(fakeEnd,'business_license'),kind:kinds[2]};
        expected(await refused(()=>db.update(id,3,fields('No unverified tails'),[forgedTail])),'storage independently rejects out-of-stream bytes');
        const wrongType={...license,kind:kinds[0]},wrongHash={...incoming[0],sha256:'0'.repeat(64)};
        expected(await refused(()=>BidderLibrary.readProfileFile(pdf,kinds[0]))&&await refused(()=>BidderLibrary.readProfileFile(svg,kinds[0]))&&await refused(()=>BidderLibrary.readProfileFile(spoof,kinds[0])),'non-image and spoofed MIME refused');
        for(const files of [[wrongType],[wrongHash],[incoming[0],incoming[0]]])expected(await refused(()=>db.update(id,3,fields('Invalid writes refused'),files)),'reject invalid image and duplicate kind');
        another=await BidderLibrary.open();const reopened=await another.get(id);
        expected(reopened.version===3&&reopened.signingAssets[0].sha256===incoming[0].sha256,'atomic failures and persistence');
        await db.remove(id,3);
        expected(await refused(()=>another.get(id))&&(await another.get(outsider.id)).attachments[0].sha256===practice.sha256,'remove only selected firm assets');
        return true;
      }finally{db.close();another?.close();}
    });assert.equal(result,true);assert.deepEqual(requests,[]);
  }finally{if(context)await context.close();await browser.close();}
});
