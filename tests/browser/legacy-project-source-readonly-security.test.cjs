'use strict';
// Independent M4F acceptance. Real isolated Chromium IndexedDB only; no live
// browser profile, customer source, shared preview, or product test oracle.
const nodeTest=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const test=(name,fn)=>nodeTest(name,{timeout:35000},fn);
const PROJECT='11111111-1111-4111-8111-111111111111';
const FIRST_WON='2025-12-31T15:59:59.999Z';
const STORE=path.resolve(__dirname,'../../dist/project-workspace-store.js');

test('browser: fixed-number lookup is genuinely read-only in missing and populated isolated databases',async t=>{
 const server=http.createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});response.end('<!doctype html><title>Independent synthetic numbering read</title>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await chromium.launch({headless:true,executablePath:process.env.QUOTE_LEDGER_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});t.after(()=>browser.close());
 async function fixture(){const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.addScriptTag({path:STORE});return page;}
 await t.test('a missing fixed-number database is not created by read lookup',async()=>{
  const page=await fixture(),result=await page.evaluate(async id=>{const before=await indexedDB.databases();let rejected=false,value;try{value=await ProjectWorkspaceStore.getProjectNumber(id);}catch{rejected=true;}const after=await indexedDB.databases();return {before,after,rejected,value};},PROJECT);
  assert.deepEqual(result.before,[]);assert.deepEqual(result.after,[],'Read lookup must not create an empty numbering database on a failed export');assert.ok(result.rejected||result.value===null);
 });
 await t.test('existing number identity and all workspace rows remain byte-equivalent after present and missing lookups',async()=>{
  const page=await fixture();const result=await page.evaluate(async input=>{
   await ProjectWorkspaceStore.ensureProjectNumbers([{projectId:input.id,firstWonAt:input.firstWonAt}]);
   async function snapshot(){const result=[];for(const item of (await indexedDB.databases()).sort((a,b)=>a.name.localeCompare(b.name))){const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(item.name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{const names=Array.from(db.objectStoreNames),stores=[];for(const name of names){const value=await new Promise((resolve,reject)=>{const transaction=db.transaction(name,'readonly'),store=transaction.objectStore(name),request=store.getAll();transaction.oncomplete=()=>resolve({name,keyPath:store.keyPath,autoIncrement:store.autoIncrement,indexNames:Array.from(store.indexNames),rows:request.result});transaction.onabort=()=>reject(transaction.error);});stores.push(value);}result.push({name:item.name,version:db.version,stores});}finally{db.close();}}return JSON.stringify(result);}
   const before=await snapshot(),actual=await ProjectWorkspaceStore.getProjectNumber(input.id),missing=await ProjectWorkspaceStore.getProjectNumber('22222222-2222-4222-8222-222222222222'),after=await snapshot();return {before,after,actual,missing};
  },{id:PROJECT,firstWonAt:FIRST_WON});
  assert.equal(result.before,result.after);assert.deepEqual(result.actual,{schemaVersion:1,projectId:PROJECT,year:2025,sequence:1,firstWonAt:FIRST_WON});assert.equal(result.missing,null);
 });
});
