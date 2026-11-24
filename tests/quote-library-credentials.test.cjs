'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const read=f=>fs.readFileSync(path.join(__dirname,'../dist',f),'utf8');
const kinds=['business_license','practice_certificate'];
const names=files=>Array.from(files,f=>f.name);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

function profile(id,version,count=2){
  const attachments=kinds.slice(0,count).map((kind,index)=>({
    kind,name:`${id}-v${version}-${index}.pdf`,size:128,mime:'application/pdf',sha256:(index?'b':'a').repeat(64)
  }));
  return {id,version,name:`合成${id}事务所`,kind:id==='A'?'own':'partner',team:'河北',
    contactName:'',phone:'',email:'',credentialKinds:attachments.map(f=>f.kind),attachments};
}

// Integration at the form/picker boundary. Packet validation and actual IDB transactions
// have dedicated suites; only the storage and packet interfaces are substituted here.
async function setup(t){
  const dom=new JSDOM(read('index.html'),{url:'http://localhost/',runScripts:'outside-only'});
  const w=dom.window,$=s=>w.document.querySelector(s);t.after(()=>dom.window.close());
  w.confirm=()=>true;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.URL.createObjectURL=()=> 'blob:synthetic-quote';
  w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){};
  const rows=new Map([['A',profile('A',1)],['B',profile('B',1,1)]]);
  const archive=new Map(),rendered=[];let legacyReads=0;
  const db={
    list:async()=>Array.from(rows.values(),({attachments,...r})=>r),
    get:async id=>structuredClone(rows.get(id))
  };
  w.BidderLibrary={open:async()=>db};
  w.QuoteLedger={open:async()=>({
    async getDefaultCredentials(){legacyReads++;return profile('LEGACY',2).attachments;},
    async register(s,pair){const id=String(archive.size+1);archive.set(id,structuredClone({
      entry:{snapshot:s,id,lastEventNo:0,events:[]},attachments:pair
    }));return structuredClone(archive.get(id).entry);},
    list:async()=>[...archive.values()].map(x=>structuredClone(x.entry)),
    get:async id=>structuredClone(archive.get(id))
  })};
  w.QuotePacket={
    normalizeSnapshot:s=>({...s}),
    verifyPair:async pair=>{assert.deepEqual(Array.from(pair,a=>a.kind),kinds);return pair;},
    verifyExtras:async extras=>{assert.deepEqual(Array.from(extras),[]);return extras;},
    renderDocument:async(s,pair)=>{rendered.push({firm:s.firmName,files:names(pair)});return '<article>合成预览</article>';}
  };
  w.QuoteWordDelivery={async build({snapshot,attachments}){
    rendered.push({firm:snapshot.firmName,files:names(attachments)});
    return {name:'synthetic.docx',bytes:new Uint8Array(),mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
  }};
  for(const f of ['calc.js','rule-catalog.js','regions.js','backup-restore.js','bidder-ui.js','app.js'])w.eval(read(f));
  await tick();
  const change=(sel,value,type='change')=>{const e=$(sel);e.value=value;e.dispatchEvent(new w.Event(type,{bubbles:true}));};
  const pick=async id=>{change('#bidder-picker-select',id);await tick();};
  const click=async sel=>{assert.ok($(sel),`${sel}：${$('#ledger-status').textContent}`);$(sel).click();await tick();};
  const gate=disabled=>{for(const sel of ['#preview','#register-quote'])assert.equal($(sel).disabled,disabled,sel+': '+$('#preview-status').textContent);};
  return {$,rows,db,archive,rendered,pick,click,gate,change,legacyReads:()=>legacyReads};
}
test('quotation has no duplicate certificate uploads; a typed firm name cannot adopt legacy defaults',async t=>{
  const x=await setup(t),{$}=x;
  assert.equal($('#business-license-file, #practice-certificate-file, #save-credentials'),null);
  const panel=$('#credentials-list').closest('section');
  assert.equal($('#view-bidders #bidder-edit-business_license, #view-bidders #bidder-edit-practice_certificate'),null);
  assert.ok($('#view-bidders #bidder-archive-file[type=file][multiple]'));
  assert.ok(panel.querySelector('#manage-bidder-credentials'));assert.ok($('#choose-bidder-for-quote'));
  x.change('#proposal-form [name=firmName]','合成A事务所','input');
  x.gate(true);assert.equal(x.legacyReads(),0);assert.doesNotMatch(panel.textContent,/LEGACY/);
});
test('switching, unlinking and manual rename cannot mix firms; history uses its original version',async t=>{
  const x=await setup(t),{$}=x;
  await x.pick('A');x.gate(false);
  assert.match($('#credentials-list').textContent,/A-v1-0\.pdf/);
  await x.click('#preview');assert.deepEqual(x.rendered.at(-1),{firm:'合成A事务所',files:['A-v1-0.pdf','A-v1-1.pdf']});
  $('#quote-dialog').close();
  await x.click('#register-quote');assert.deepEqual(names(x.archive.get('1').attachments),['A-v1-0.pdf','A-v1-1.pdf']);
  x.rows.set('A',profile('A',2));
  await x.click('#bidder-apply');x.gate(false);assert.match($('#credentials-list').textContent,/A-v2-0\.pdf/);
  // Picker clears A immediately, not after B's async file read completes.
  let finish;const get=x.db.get;x.db.get=id=>id==='B'?new Promise(resolve=>{finish=resolve;}):get(id);
  await x.pick('B');x.gate(true);assert.doesNotMatch($('#credentials-list').textContent,/A-v[12]-/);
  finish(profile('B',1,1));await tick();x.gate(true);
  assert.match($('#credentials-list').textContent,/B-v1-0\.pdf/);assert.match($('#preview-status').textContent,/执业证书/);
  await x.click('#register-quote');assert.equal(x.archive.size,1);
  await x.click('[data-packet-id="1"]');assert.deepEqual(x.rendered.at(-1),{firm:'合成A事务所',files:['A-v1-0.pdf','A-v1-1.pdf']});
  $('#quote-dialog').close();
  await x.pick('A');x.gate(false);await x.click('#bidder-unlink');x.gate(true);
  assert.doesNotMatch($('#credentials-list').textContent,/A-v2-/);
  await x.pick('A');x.gate(false);x.change('#proposal-form [name=firmName]','未经选用的事务所','input');x.gate(true);
  assert.doesNotMatch($('#credentials-list').textContent,/A-v2-/);
  assert.equal(x.legacyReads(),0);
});
