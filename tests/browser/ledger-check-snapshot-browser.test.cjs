'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
test('saved snapshot crosses real Chrome and Node without calculation, network, storage or lost property order',async()=>{
 const {chromium}=require('playwright'),C=require('../../dist/ledger-check-snapshot.js');
 const projectId='11111111-1111-4111-8111-111111111111';
 const scope={projectId,entityId:'合成只读',currency:'CNY',unit:'元',periodStart:'2026-01-01',periodEnd:'2026-12-31',scale:2};
 const input={schemaVersion:1,scope},columnMappings={},sourceRefs={};
 for(const role of ['ledger','trialBalance','statements']){input[role]={scope:{...scope},rows:[]};columnMappings[role]={sheet:'合成',fromRow:1,toRow:1,columns:{}};sourceRefs[role]={name:role+'.xlsx',sha256:'a'.repeat(64)};}
 const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const f={projectId,workspaceRevision:3,reconciliation:{schemaVersion:1,input,columnMappings,sourceRefs,result:{schemaVersion:1,scope:{...scope},summary:{pass:0,fail:0,incomplete:1},checks:[],issues:[{message:'保留的原检查提示'}]},inputHash:hash(input),mappingHash:hash(columnMappings),calculatedAt:'2026-11-17T00:00:00.000Z'}};
 const expected=await C.serialize(await C.create(f));
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'shenyi-ledger-snapshot-')),html=path.join(temporary,'fixture.html');
 fs.writeFileSync(html,'<!doctype html><title>Snapshot codec test</title><body></body>');
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||chromium.executablePath()});
  const context=await browser.newContext(),page=await context.newPage(),requests=[],errors=[];
  page.on('request',r=>{if(/^https?:|^wss?:/i.test(r.url()))requests.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
  // An isolated file origin provides WebCrypto without loading the legacy app.
  await page.goto(pathToFileURL(html).href);
  await page.addScriptTag({content:'globalThis.AuditReconciliation={reconcile(){throw Error("calculation forbidden")}};globalThis.AuditAutoCheck={analyze(){throw Error("calculation forbidden")},collect(){throw Error("calculation forbidden")}};indexedDB.open=()=>{throw Error("storage forbidden")};Storage.prototype.setItem=()=>{throw Error("storage forbidden")};'});
  await page.addScriptTag({content:fs.readFileSync(path.resolve(__dirname,'../../dist/ledger-check-snapshot.js'),'utf8')});
  const actual=await page.evaluate(async f=>{
   const value=await LedgerCheckSnapshot.create(f),text=await LedgerCheckSnapshot.serialize(value),back=await LedgerCheckSnapshot.parse(text);
   return {text,same:JSON.stringify(back.reconciliation)===JSON.stringify(f.reconciliation),dom:document.body.childNodes.length,globals:Object.keys(LedgerCheckSnapshot)};
  },f);
  assert.equal(actual.text,expected);assert.equal(actual.same,true);assert.equal(actual.dom,0);assert.deepEqual(actual.globals,['FORMAT','LIMITS','create','serialize','parse']);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);await context.close();
 }finally{await browser?.close();fs.unlinkSync(html);fs.rmdirSync(temporary);}
});
