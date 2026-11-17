'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),{createHash}=require('node:crypto'),{chromium}=require('playwright');
const {fixture:projectFixture}=require('../helpers/legacy-project-source-fixture.cjs');
const C=require('../../dist/ledger-check-snapshot.js'),R=require('../../dist/audit-reconciliation.js'),L=require('../../dist/legacy-project-source.js');
const DIST=path.resolve(__dirname,'../../dist');
const scripts=['quote-packet.js','quote-ledger.js','project-workspace-store.js','project-register.js','project-initiation.js','legacy-project-source.js','legacy-project-source-export.js','ledger-check-snapshot.js','ledger-check-snapshot-export.js'];
function fixture(){
 const f=projectFixture();delete f.workspace.archive;
 const scope={projectId:f.id,entityId:'合成旧记录，不重新计算',currency:'CNY',unit:'元',periodStart:'2026-01-01',periodEnd:'2026-12-31',scale:2};
 const input=R.createInputTemplate(scope),columnMappings={},sourceRefs={};
 for(const role of ['ledger','trialBalance','statements']){columnMappings[role]={sheet:'原账表',fromRow:1,toRow:1,columns:{accountCode:0}};sourceRefs[role]={id:role,nodeId:role,generationId:'saved-generation',name:role+'.xlsx',sha256:'a'.repeat(64),status:'confirmed'};}
 const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 f.workspace.reconciliation={schemaVersion:1,input,columnMappings,sourceRefs,result:R.reconcile(input),inputHash:hash(input),mappingHash:hash(columnMappings),calculatedAt:'2026-11-17T00:00:00.000Z'};
 f.workspace.answers={privateWorkpaperAnswer:'UNRELATED-WORKPAPER-DO-NOT-EXPORT'};
 return f;
}
async function fingerprint(page){return page.evaluate(async()=>{
 async function data(value){if(value instanceof Blob)return{kind:'Blob',size:value.size,type:value.type,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await value.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('')};if(Array.isArray(value))return Promise.all(value.map(data));if(value&&typeof value==='object'){const result={};for(const key of Object.keys(value))result[key]=await data(value[key]);return result;}return value;}
 const out=[];
 for(const item of (await indexedDB.databases()).sort((a,b)=>a.name.localeCompare(b.name))){const db=await new Promise((ok,no)=>{const q=indexedDB.open(item.name);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});try{const stores=[];for(const name of [...db.objectStoreNames]){const s=await new Promise((ok,no)=>{const t=db.transaction(name,'readonly'),store=t.objectStore(name),q=store.getAll();t.oncomplete=()=>ok({name,keyPath:store.keyPath,autoIncrement:store.autoIncrement,indexes:[...store.indexNames],rows:q.result});t.onabort=()=>no(t.error);});stores.push(await data(s));}out.push({name:item.name,version:item.version,stores});}finally{db.close();}}
 return JSON.stringify(out);
});}
async function seed(page,f){await page.evaluate(async f=>{
 const q=await QuoteLedger.open();q.close();await ProjectInitiation.listSaved();await ProjectWorkspaceStore.get(f.id);await ProjectWorkspaceStore.ensureProjectNumbers([{projectId:f.id,firstWonAt:f.identity.firstWonAt}],[f.id]);
 const quote={schemaVersion:1,...f.currentQuote,snapshot:{...f.currentQuote.snapshot,location:'广西壮族自治区',service:'年度财务决算审计',contactName:'合成联系人',contactInfo:'synthetic-only',subtotalCents:10000,taxCents:600,taxRateText:'6%'},attachmentRefs:['business_license','practice_certificate'].map(kind=>({kind,name:kind+'.pdf',mime:'application/pdf',size:128,sha256:'a'.repeat(64)}))};
 async function put(name,store,value){const db=await new Promise((ok,no)=>{const r=indexedDB.open(name);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});try{await new Promise((ok,no)=>{const t=db.transaction(store,'readwrite');t.objectStore(store).put(value);t.oncomplete=ok;t.onabort=()=>no(t.error);});}finally{db.close();}}
 f.workspace.archive={name:'原件保持.bin',blob:new Blob(['SYNTHETIC-ORIGINAL-MUST-STAY'])};
 await put('hengdu.quote.delivery.v1','entries',quote);await put('hengdu.quote.projects.v1','projects',f.initiation);await put('hengdu.project.numbering.v1','numbers',f.identity);await put('hengdu.project.workspace.v1','workspaces',f.workspace);
 globalThis.__ledgerPut=put;globalThis.__ledgerFixture=f;
},f);}
async function observe(page){await page.evaluate(()=>{
 globalThis.__ledgerStats={writes:[],anchors:0,urls:0,revoked:0,calculations:0,saves:0};
 const tx=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode&&mode!=='readonly')__ledgerStats.writes.push({database:this.name,stores,mode});return tx.call(this,stores,mode,...rest);};
 const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){__ledgerStats.anchors++;return click.call(this);};
 const make=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=value=>{__ledgerStats.urls++;return make(value);};URL.revokeObjectURL=value=>{__ledgerStats.revoked++;return revoke(value);};
 const forbidden=()=>{__ledgerStats.calculations++;throw Error('no calculation in export');};globalThis.AuditAutoCheck={analyze:forbidden,collect:forbidden,mount:forbidden};globalThis.AuditPreparation={mount:forbidden};globalThis.AuditReconciliation={reconcile:forbidden};
 ProjectWorkspaceStore={...ProjectWorkspaceStore,save(){__ledgerStats.saves++;throw Error('no workspace write in export');}};
});}
test('saved ledger export: real normal page, readonly data preservation and late-source refusal', {timeout:60000}, async t=>{
 const hashes=Object.fromEntries([...scripts,'index.html','project-register.js'].map(n=>[n,createHash('sha256').update(fs.readFileSync(path.join(DIST,n))).digest('hex')]));
 const server=http.createServer((req,res)=>{
  if(req.url==='/minimal.html'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><title>合成账表快照导出</title>'+scripts.map(s=>'<script src="/'+s+'"></script>').join(''));return;}
  let name;try{name=decodeURIComponent(new URL(req.url,'http://local.invalid').pathname).replace(/^\//,'')||'index.html';}catch{res.writeHead(400);res.end();return;}
  const file=path.resolve(DIST,name);if(!file.startsWith(DIST+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',name.endsWith('.html')?'text/html;charset=utf-8':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(file));
 });await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath()});t.after(()=>browser.close());
 async function pageFor(url='/minimal.html'){
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1600,height:1100}});t.after(()=>context.close());const page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/i.test(r.url())&&!r.url().startsWith(origin+'/'))external.push(r.url());});await page.goto(origin+url);await page.waitForFunction(()=>!!globalThis.LedgerCheckSnapshotExport);
  return {page,errors,external};
 }
 await t.test('missing source databases are not created by a failed read',async()=>{
  const {page,errors,external}=await pageFor();assert.deepEqual(await page.evaluate(()=>indexedDB.databases()),[]);
  const rejected=await page.evaluate(async id=>{try{await LedgerCheckSnapshotExport.read(id);return false;}catch{return true;}},fixture().id);
  assert.equal(rejected,true);assert.deepEqual(await page.evaluate(()=>indexedDB.databases()),[]);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 });
 await t.test('normal index row exports the original saved record and does not calculate or write',async()=>{
  const {page,errors,external}=await pageFor('/'),f=fixture();await seed(page,f);await page.reload();await page.locator('[data-view="project"]').first().click();
  const button=page.locator('[data-project-ledger-snapshot="'+f.id+'"]');await button.waitFor();await page.waitForFunction(id=>!document.querySelector('[data-project-ledger-snapshot="'+id+'"]')?.disabled,f.id);
  await observe(page);const before=await fingerprint(page);
  const [download]=await Promise.all([page.waitForEvent('download'),button.click()]);const file=await download.path(),bytes=await fsp.readFile(file),parsed=await C.parse(bytes.toString('utf8'));
  assert.equal(download.suggestedFilename(),'审易-已保存账表校验快照-'+f.id+'.json');assert.equal(parsed.sourceProjectId,f.id);assert.equal(parsed.workspaceRevision,7);assert.deepEqual(parsed.reconciliation,f.workspace.reconciliation);assert.equal(parsed.reconciliation.result.summary.incomplete,11);
  assert.equal(bytes.includes(Buffer.from('UNRELATED-WORKPAPER')),false);assert.equal(bytes.includes(Buffer.from('SYNTHETIC-ORIGINAL')),false);
  const after=await fingerprint(page),stats=await page.evaluate(()=>__ledgerStats);
  if(process.env.SHENYI_LEDGER_EXPORT_EVIDENCE){const output=path.join(process.env.SHENYI_LEDGER_EXPORT_EVIDENCE,'normal-index');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'databases-before.json'),before);fs.writeFileSync(path.join(output,'databases-after.json'),after);}
  assert.equal(after,before);assert.deepEqual(stats,{writes:[],anchors:1,urls:1,revoked:1,calculations:0,saves:0});assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  if(process.env.SHENYI_LEDGER_EXPORT_EVIDENCE){const output=path.join(process.env.SHENYI_LEDGER_EXPORT_EVIDENCE,'normal-index');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'exported-snapshot.json'),bytes);await page.screenshot({path:path.join(output,'readonly-export.png')});fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),stats,allDatabasesTypedAndOriginalBlobPreserved:true,realNormalIndex:true,errors,external},null,2));}
 });
 await t.test('unsaved row is refused by the real register component before any exporter call',async()=>{
  const {page,errors}=await pageFor(),f=fixture();await seed(page,f);
  await page.evaluate(async()=>{const host=document.createElement('main');document.body.append(host);const ledger=await QuoteLedger.open();try{const entries=await ledger.list();globalThis.__register=ProjectRegister.mount(host,{records:await ProjectInitiation.listSaved(),entries,lookup:async id=>entries.find(q=>q.id===id)});}finally{ledger.close();}});
  const button=page.locator('[data-project-ledger-snapshot="'+f.id+'"]');await page.waitForFunction(id=>!document.querySelector('[data-project-ledger-snapshot="'+id+'"]')?.disabled,f.id);
  await observe(page);const before=await fingerprint(page);
  await page.locator('[data-project-register-id="'+f.id+'"] [data-project-register-field="manager"]').fill('未保存输入');await button.click();await page.getByText('请先保存本行修改，再导出已保存账表校验快照。',{exact:true}).waitFor();
  assert.equal(await fingerprint(page),before);assert.deepEqual(await page.evaluate(()=>__ledgerStats),{writes:[],anchors:0,urls:0,revoked:0,calculations:0,saves:0});assert.deepEqual(errors,[]);
 });
 await t.test('the existing governance-source button still exports exactly the original legacy format',async()=>{
  const {page,errors}=await pageFor(),f=fixture();await seed(page,f);
  await page.evaluate(async()=>{const host=document.createElement('main');document.body.append(host);const ledger=await QuoteLedger.open();try{const entries=await ledger.list();globalThis.__register=ProjectRegister.mount(host,{records:await ProjectInitiation.listSaved(),entries,lookup:async id=>entries.find(q=>q.id===id)});}finally{ledger.close();}});
  const button=page.locator('[data-project-migration-source="'+f.id+'"]');await page.waitForFunction(id=>!document.querySelector('[data-project-migration-source="'+id+'"]')?.disabled,f.id);
  await observe(page);const before=await fingerprint(page),[download]=await Promise.all([page.waitForEvent('download'),button.click()]);
  const bytes=await fsp.readFile(await download.path()),expected=L.encode(L.create({initiation:f.initiation,currentQuote:f.currentQuote,identity:f.identity,workspace:f.workspace}));
  assert.deepEqual(bytes,Buffer.from(expected));assert.equal(await fingerprint(page),before);assert.deepEqual(await page.evaluate(()=>__ledgerStats),{writes:[],anchors:1,urls:1,revoked:1,calculations:0,saves:0});assert.deepEqual(errors,[]);
 });
 await t.test('missing saved result rejects without creating a file or changing any existing store',async()=>{
  const {page}=await pageFor(),f=fixture();delete f.workspace.reconciliation;await seed(page,f);await observe(page);const before=await fingerprint(page);
  const message=await page.evaluate(async id=>{try{await LedgerCheckSnapshotExport.download(id);return '';}catch(e){return e.message;}},f.id);assert.match(message,/未找到本项目已有/);assert.equal(await fingerprint(page),before);assert.deepEqual(await page.evaluate(()=>__ledgerStats),{writes:[],anchors:0,urls:0,revoked:0,calculations:0,saves:0});
 });
 for(const kind of ['workspace-revision','same-revision-data','formal-record','fixed-identity','closed-context'])await t.test('refuses '+kind+' change before publication',async()=>{
  const {page,errors}=await pageFor(),f=fixture();await seed(page,f);await observe(page);
  const outcome=await page.evaluate(async({id,kind})=>{
   const codec=LedgerCheckSnapshot;let alive=true,changed=false;
   LedgerCheckSnapshot={...codec,async serialize(value){const text=await codec.serialize(value);if(!changed){changed=true;const f=__ledgerFixture;if(kind==='workspace-revision'){f.workspace.rev++;await __ledgerPut('hengdu.project.workspace.v1','workspaces',f.workspace);}else if(kind==='same-revision-data'){f.workspace.reconciliation.sourceRefs.ledger.name='新来源.xlsx';await __ledgerPut('hengdu.project.workspace.v1','workspaces',f.workspace);}else if(kind==='formal-record'){f.initiation.form.notes='另一窗口修改的立项备注';await __ledgerPut('hengdu.quote.projects.v1','projects',f.initiation);}else if(kind==='fixed-identity'){f.identity.sequence++;await __ledgerPut('hengdu.project.numbering.v1','numbers',f.identity);}else alive=false;}return text;}};
   let rejected=false,message='';try{await LedgerCheckSnapshotExport.download(id,{assertContext(){if(!alive)throw Error('closed context');}});}catch(e){rejected=true;message=e.message;}return{rejected,message,changed,stats:__ledgerStats};
  },{id:f.id,kind});
  assert.equal(outcome.rejected,true);assert.equal(outcome.changed,true);assert.equal(outcome.stats.anchors,0);assert.equal(outcome.stats.urls,0);assert.equal(outcome.stats.calculations,0);assert.equal(outcome.stats.saves,0);assert.equal(outcome.stats.writes.length,kind==='closed-context'?0:1);assert.deepEqual(errors,[]);
 });
 await t.test('invalid stored hash is rejected and URL is revoked even if the final click fails',async()=>{
  const {page,errors}=await pageFor(),f=fixture();f.workspace.reconciliation.inputHash='b'.repeat(64);await seed(page,f);await observe(page);const before=await fingerprint(page);
  assert.equal(await page.evaluate(async id=>{try{await LedgerCheckSnapshotExport.download(id);return false;}catch{return true;}},f.id),true);assert.equal(await fingerprint(page),before);assert.equal((await page.evaluate(()=>__ledgerStats)).urls,0);
  const valid=fixture();await page.evaluate(async f=>{f.workspace.archive=__ledgerFixture.workspace.archive;await __ledgerPut('hengdu.project.workspace.v1','workspaces',f.workspace);__ledgerStats.writes=[];HTMLAnchorElement.prototype.click=function(){throw Error('synthetic final click failure');};},valid);
  const result=await page.evaluate(async id=>{let message='';try{await LedgerCheckSnapshotExport.download(id);}catch(e){message=e.message;}return{message,stats:__ledgerStats};},valid.id);assert.match(result.message,/synthetic final click/);assert.equal(result.stats.urls,1);assert.equal(result.stats.revoked,1);assert.deepEqual(result.stats.writes,[]);assert.deepEqual(errors,[]);
 });
 assert.deepEqual(Object.fromEntries([...scripts,'index.html','project-register.js'].map(n=>[n,createHash('sha256').update(fs.readFileSync(path.join(DIST,n))).digest('hex')])),hashes);
});
