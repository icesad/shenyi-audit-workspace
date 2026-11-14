/* Synthetic old binary Word upload regression, no private documents or credentials. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),{chromium}=require('playwright');
const {buildLegacyDoc}=require('../fixtures/legacy-doc-builder.cjs');
const entry=path.resolve(process.argv[2]||path.join(__dirname,'../../dist/index.html')),TRIAL='00000000-0000-4000-8000-000000000033';
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),chromiumSandbox:true}),requests=[],errors=[],steps=[];
 try{
  const ctx=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:1000}});
  ctx.on('request',r=>{if(/^(?:https?|wss?):/.test(r.url()))requests.push(r.url());});await ctx.route(/^https?:/,r=>r.abort());
  const p=await ctx.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));let agree=true;p.on('dialog',d=>agree?d.accept():d.dismiss());
  await p.goto(pathToFileURL(entry).href);const q=s=>p.locator(s);
  const wait=(s,n)=>p.waitForFunction(([s,n])=>document.querySelector(s)?.textContent.includes(n),[s,n]);
  const get=()=>p.evaluate(async id=>{const db=await AuditChecklist.openTrial();try{return await db.get(id);}finally{db.close();}},TRIAL);
  const upload=async(name,bytes,mimeType='application/msword')=>{
   await q('#ac-import').setInputFiles({name,mimeType,buffer:bytes});
   await p.waitForFunction(()=>document.querySelector('#ac-import')?.disabled===false);
  };
  await q('[data-view=home]').click();await q('[data-home-view=audit]').click();await q('#ac-import-mode').selectOption('legacy');await q('#ac-trial').click();await wait('#ac-status','已进入独立试用');
  assert.deepEqual((await q('#ac-import').getAttribute('accept')).split(',').map(x=>x.trim()).sort(),['.doc','.docx','.txt']);
  await q('#ac-reviewer').fill('虚构旧版Word核对人');await q('#ac-reason').fill('使用合成旧版Word资料清单替换试用示例');
  const pieces=[{text:'资料清单2026\r一、基础资料\r',fc:4608},{text:'9. Revenue statement\r',compressed:true,fc:2304},{text:'29. 银行函证\r① 其他资料（正文②保留）\r',fc:1024}];
  const doc=buildLegacyDoc({pieces,prc:true,table:'0Table'});
  const parsed=await p.evaluate(async bytes=>{const r=await LegacyDoc.read(new File([new Uint8Array(bytes)],'synthetic.DOC',{type:'application/msword'}));return r.lines;},Array.from(doc));
  assert.deepEqual(parsed,['资料清单2026','一、基础资料','9. Revenue statement','29. 银行函证','① 其他资料（正文②保留）']);
  agree=false;const before=await get();await upload('synthetic.DOC',doc);assert.deepEqual(await get(),before,'cancelled DOC import does not change the trial');
  agree=true;await upload('synthetic.DOC',doc);await wait('#ac-status','已导入 3 项');
  assert.deepEqual(await q('[data-material-id] strong').allTextContents(),['1、Revenue statement','2、银行函证','3、其他资料（正文②保留）']);
  assert.deepEqual(await q('#ac-rows h3').allTextContents(),['一、基础资料']);
  assert.ok(Object.values((await get()).states).every(s=>s.status==='pending'));assert.equal(await q('#ac-close').isDisabled(),true);
  steps.push('local worker reads genuine OLE/CLX binary DOC, mixed Unicode/compressed 0Table pieces and circled labels; explicit confirmation preserves cancellation semantics');

  await q('[data-item-status=i1]').selectOption('pending');await q('#ac-evidence-i1').fill('DOC-WP-01');await q('[data-confirm-item=i1]').click();await wait('#ac-status','已保存本项核对');
  const confirmed=await get();
  const invalid=[
   ['renamed-rtf.doc',Buffer.from('{\\rtf1\\ansi 1. Not a binary Word file}')],
   ['renamed-html.doc',Buffer.from('<html><body>1. Not a binary Word file</body></html>')],
   ['fake.doc',Buffer.from('1. Plain text with misleading extension')],
   ['encrypted.doc',buildLegacyDoc({encrypted:true})],
   ['old-word.doc',buildLegacyDoc({nFib:0x65})],
   ['table.doc',buildLegacyDoc({pieces:[{text:'1. 虚构甲\x07虚构乙\x07\r'}]})],
   ['truncated.doc',doc.subarray(0,256)],
   ['broken-clx.doc',buildLegacyDoc({mutateWord:w=>w.writeUInt32LE(0x7fffffff,418)})],
   ['empty.doc',Buffer.alloc(0)],
   ['oversized.doc',Buffer.alloc(2*1024*1024+1)]
  ];
  for(const [name,bytes]of invalid){
   await upload(name,bytes);assert.deepEqual(await get(),confirmed,name+' must never replace items, evidence, revisions or history');
   assert.ok(!(await q('#ac-status').textContent()).includes('已导入'),name+' has actionable rejection feedback');
   assert.equal(await q('[data-item-status=i1]').inputValue(),'pending');assert.match(await q('[data-record-state=i1]').textContent(),/核对通过/);assert.equal(await q('#ac-evidence-i1').inputValue(),'DOC-WP-01');
  }
  steps.push('RTF/HTML/fake/encrypted/unsupported/table/truncated/corrupt/empty/oversized DOC failures leave the exact prior state and evidence unchanged');

  await p.evaluate(()=>{
   window.__realDocWorker=window.Worker;window.__docWorkerTerminated=0;
   window.Worker=class{postMessage(){setTimeout(()=>this.onerror?.({message:'synthetic failure'}),0);}terminate(){window.__docWorkerTerminated++;}};
  });
  await upload('synthetic-worker-failure.doc',doc);assert.deepEqual(await get(),confirmed);
  assert.match(await q('#ac-status').textContent(),/隔离读取失败/);assert.equal(await p.evaluate(()=>window.__docWorkerTerminated),1);
  await p.evaluate(()=>{window.Worker=class{postMessage(){}terminate(){window.__docWorkerTerminated++;}};});
  const started=Date.now();await upload('synthetic-worker-timeout.doc',doc);assert.ok(Date.now()-started>=4500,'a stalled reader is terminated at the five-second bound');
  assert.deepEqual(await get(),confirmed);assert.match(await q('#ac-status').textContent(),/读取超时/);assert.equal(await p.evaluate(()=>window.__docWorkerTerminated),2);
  await p.evaluate(()=>{window.Worker=window.__realDocWorker;delete window.__realDocWorker;delete window.__docWorkerTerminated;});
  steps.push('failed or stalled isolated workers are terminated and cannot replace existing checklist state');

  const long='资料清单2026\r一、基础资料\r'+Array.from({length:105},(_,i)=>(i+19)+'. 虚构资料'+String(i+1).padStart(3,'0')+'：'+('核对内容'.repeat(10))+'\r').join('');
  await upload('synthetic-105.doc',buildLegacyDoc({pieces:[{text:long.slice(0,3072)},{text:long.slice(3072)}]}),'application/octet-stream');await wait('#ac-status','已导入 105 项');
  const full=await get();assert.equal(full.items.length,105);assert.equal(full.items.at(-1).number,105);assert.ok(full.items.at(-1).text.startsWith('虚构资料105：'));
  assert.ok(Object.values(full.states).every(s=>s.status==='pending'));assert.equal(full.events.at(-1).oldStates.i1.evidence,'DOC-WP-01');
  assert.equal(await q('#ac-close').isDisabled(),true);
  await p.reload();await q('[data-view=home]').click();await q('[data-home-view=audit]').click();await q('#ac-trial').click();await wait('#ac-status','已进入独立试用');assert.deepEqual(await get(),full);
  const counts=await p.evaluate(async id=>{const m=await AuditChecklist.open(),l=await QuoteLedger.open();try{return {main:await m.get(id),projects:(await ProjectInitiation.listSaved()).length,quotes:(await l.list()).length};}finally{m.close();l.close();}},TRIAL);
  assert.deepEqual(counts,{main:null,projects:0,quotes:0});assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  steps.push('105-item long DOC imports with continuous numbering and reset current states, preserves prior audit evidence in history and reloads without formal-project side effects');
  console.log(JSON.stringify({passed:true,entry,steps,requests,errors}));
 }catch(e){console.error(JSON.stringify({passed:false,entry,steps,requests,errors}));throw e;}
 finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
