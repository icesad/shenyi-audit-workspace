'use strict';
const {test}=require('node:test'), fs=require('node:fs'), path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..','dist');
test('bidder data is not coupled to delivery history, existing credential defaults, or the network',()=>{
  const s=fs.readFileSync(path.join(root,'bidder-library.js'),'utf8');assert.doesNotMatch(s,/\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|WebSocket|QuoteLedger)\b/);assert.match(s,/hengdu\.quote\.bidders\.v1/);
});
test('real bidder directory: partial files, isolation, CAS and persistence',async t=>{
  let chromium;try{({chromium}=require('playwright'));}catch{return t.skip('no installed Playwright');}
  const executable=process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath();if(!fs.existsSync(executable))return t.skip('no installed Chromium');
  const browser=await chromium.launch({headless:true,executablePath:executable,chromiumSandbox:true});let context;
  try{context=await browser.newContext();const page=await context.newPage();
    // Load only the data layer on a local secure origin without starting the full UI.
    await page.goto(pathToFileURL(path.join(root,'rule-catalog.js')).href);
    for(const n of ['rule-catalog.js','quote-packet.js','bidder-library.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,n),'utf8')});
    const result=await page.evaluate(async()=>{
      const a=await BidderLibrary.open(),b=await BidderLibrary.open();
      const fields=(name,kind='own')=>({name,kind,team:'河北',contactName:'',phone:'',email:''});
      const make=(kind,letter)=>QuotePacket.readAttachment(new File(['%PDF-1.4\n% SYNTHETIC '+letter+'\n%%EOF\n'],letter+'.pdf',{type:'application/pdf'}),kind);
      const checked=async(p,code)=>{try{await p;return false;}catch(e){return !code||e.code===code;}};
      const expected=(v,label)=>{if(!v)throw Error('bidder: '+label);};
      try{
        const one=await make('business_license','A'),two=await make('practice_certificate','B'),other=await make('business_license','C');
        const A=await a.create(fields('Synthetic A'),[one,two]), B=await b.create(fields('Synthetic B','partner'),[other],
          [{name:'合成基础资料.txt',blob:new Blob(['Synthetic original'])}]), C=await b.create(fields('Synthetic draft'));
        expected(A.id!==B.id&&A.version===1&&C.attachments.length===0,'identity and incomplete draft');
        expected((await a.list()).every(r=>r.id&&r.credentialKinds&&!Object.hasOwn(r,'attachments')),'metadata only');
        const obtained=await a.get(B.id);expected(obtained.attachments.length===1&&obtained.attachments[0].sha256===other.sha256,'per-firm bytes');
        obtained.attachments[0].bytes.fill(0);expected((await a.get(B.id)).attachments[0].bytes[0]===37,'isolated owned bytes');
        expected(await checked(a.update(B.id,1,fields('bad'),[one,other])),'reject duplicate typed attachments');
        const corrupt={...one,bytes:new Uint8Array(one.bytes)};corrupt.bytes[10]^=1;expected(await checked(a.update(B.id,1,fields('bad'),[corrupt])),'reject bad hash');
        const race=await Promise.allSettled([a.update(A.id,1,fields('first'),[two]),b.update(A.id,1,fields('second'))]);expected(race.filter(r=>r.status==='fulfilled').length===1&&race.find(r=>r.status==='rejected').reason.code==='BIDDER_CONFLICT','real compare/swap');
        const changed=await b.get(A.id);expected(changed.version===2&&changed.attachments.some(f=>f.sha256===two.sha256),'atomic metadata and files');
        const kept=await b.update(B.id,1,fields('Synthetic B v2','partner'));expected(kept.attachments[0].sha256===other.sha256&&kept.version===2,'retained own files');
        expected(await checked(a.remove(B.id,1),'BIDDER_CONFLICT'),'reject stale delete');
        await a.remove(A.id,2);expected(await checked(b.get(A.id),'BIDDER_MISSING'),'deleted firm only');
        expected((await a.get(B.id)).attachments[0].sha256===other.sha256&&(await a.list()).length===2,'other firms intact');
        expected((await a.update(B.id,2,fields('B later','partner'),[])).attachments.length===0,'explicit removal');
        expected(await checked(a.create({...fields('invalid'),team:'nonprovince'}),'BIDDER_INVALID'),'invalid team');
        const c=await BidderLibrary.open();try{
          const list=await c.list(),saved=await c.get(B.id);
          return list.length===2&&list.find(row=>row.id===B.id).materialCount===1&&saved.version===3&&
            saved.materials[0].name==='合成基础资料.txt'&&await saved.materials[0].blob.text()==='Synthetic original';
        }finally{c.close();}
      }finally{a.close();b.close();}
    });assert.equal(result,true);
  }finally{if(context)await context.close();await browser.close();}
});
