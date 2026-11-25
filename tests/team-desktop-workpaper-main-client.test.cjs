const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture,good,sha,PASSWORD,restorePasswordWork}=require('./helpers/workpaper-desktop-root-fixture.cjs');
after(restorePasswordWork);
const entriesInput=(f,overrides)=>({...f.target,...f.entryBody(overrides),sha256:f.document.sha256});
const workpaperCalls=(f,from)=>f.state.calls.slice(from).filter(c=>c.path.startsWith(f.wpRoute())).map(c=>`${c.method} ${c.path.slice(f.wpRoute().length)||'/'}`);
test('actual createTeamClient signs original-sheet read/save/history and original-ID receipt against the strict service',async t=>{const f=await fixture(t,{originalForm:true}),before=f.dataRows(),head=await f.client.getWorkpaperData(f.target),record=await f.client.getWorkpaperRecord(f.query()),form=await f.client.getWorkpaperForm({...f.query(),sha256:f.document.sha256});assert.equal(record.record.rev,7);assert.equal(form.form.sha256,f.document.sha256);const requestId=require('node:crypto').randomUUID(),receipt=await f.client.saveWorkpaperEntries({...f.target,requestId,sha256:f.document.sha256,headRevision:head.headRevision,projectRevision:head.projectRevision,grantRevision:head.grantRevision,changes:[f.change]});assert.equal(receipt.version,2);assert.equal((await f.client.getWorkpaperReceipt({...f.target,requestId})).requestId,requestId);const saved=await f.client.getWorkpaperRecord(f.query());assert.equal(saved.record.answers[f.document.sha256]['原表'].A2,f.change.value);assert.deepEqual(f.dataRows().originals,before.originals);assert.equal(f.state.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/entries/'+f.document.sha256)).length,1);});
test('entry preflight distinguishes a newer writable head from a future head, exhausted revision and revoked write grant',async t=>{
 const f=await fixture(t,{originalForm:true}),attempt=entriesInput(f),position=f.state.calls.length;
 await assert.rejects(f.client.saveWorkpaperEntries({...attempt,headRevision:attempt.headRevision+1}),{code:'WORKPAPER_CHANGED'});
 assert.deepEqual(workpaperCalls(f,position),['GET /access','GET /']);
 await f.client.saveWorkpaperEntries(entriesInput(f));
 const recorded=f.dataRows();
 let mark=f.state.calls.length;
 await assert.rejects(f.client.saveWorkpaperEntries(attempt),{code:'WORKPAPER_HEAD_CHANGED',status:409});
 assert.deepEqual(workpaperCalls(f,mark),['GET /access','GET /']);
 f.state.after=async(call,response)=>{
  if(call.path!==f.wpRoute()||call.method!=='GET')return;
  const body=await response.json();
  body.data.recordRevision=Number.MAX_SAFE_INTEGER;
  return new Response(JSON.stringify(body),{status:response.status,headers:response.headers});
 };
 mark=f.state.calls.length;
 await assert.rejects(f.client.saveWorkpaperEntries(attempt),{code:'WORKPAPER_CHANGED'});
 assert.deepEqual(workpaperCalls(f,mark),['GET /access','GET /']);
 f.state.after=null;
 await f.client.changeWorkpaperAccess({...f.target,...f.wpGrantBody(f.user,{read:true,write:false,export:true}),confirmed:true});
 mark=f.state.calls.length;
 await assert.rejects(f.client.saveWorkpaperEntries(attempt),{code:'WORKPAPER_CHANGED'});
 assert.deepEqual(workpaperCalls(f,mark),['GET /access']);
 assert.deepEqual(f.dataRows(),recorded);
});
test('a competing signed save after preflight yields one definite stale-head denial with no retry',async t=>{
 const f=await fixture(t,{originalForm:true}),partner=await f.ready('partner-a'),tail='/entries/'+f.document.sha256;
 await f.client.changeWorkpaperAccess({...f.target,...f.wpGrantBody('partner-a',{read:true,write:true}),confirmed:true});
 const attempt=entriesInput(f),newAnswer='another account saved this answer';
 let serverStatus,dispatches=0;
 f.state.before=async call=>{
  if(call.path!==f.wpRoute()+tail||call.method!=='POST')return;
  const body=f.entryBody({changes:[{...f.change,value:newAnswer}]},partner);
  good(await f.write({current:partner,body}),201);
 };
 f.state.after=(call,response)=>{
  if(call.path===f.wpRoute()+tail&&call.method==='POST')serverStatus=response.status;
 };
 const mark=f.state.calls.length;
 await assert.rejects(f.client.saveWorkpaperEntries(attempt,{onDispatch(){dispatches++;}}),{code:'WORKPAPER_HEAD_CHANGED',status:409});
 assert.equal(serverStatus,409);
 assert.equal(dispatches,1);
 assert.deepEqual(workpaperCalls(f,mark),['GET /access','GET /',`POST ${tail}`,'GET /access','GET /']);
 const saved=await f.client.getWorkpaperRecord(f.query());
 assert.equal(saved.record.answers[f.document.sha256]['原表'].A2,newAnswer);
 assert.equal(f.head(),2);
 assert.equal(f.dataRows().versions.some(v=>v.operation_id===attempt.requestId),false);
});
test('a trusted HTTP 409 distinguishes changed source and read conflict from unchanged head and rate limit',async t=>{
 const f=await fixture(t,{originalForm:true}),saved=entriesInput(f),tail='/entries/'+f.document.sha256;
 await f.client.saveWorkpaperEntries(saved);
 const attempt=entriesInput(f,{requestId:saved.requestId}),rows=f.dataRows();
 let mark=f.state.calls.length;
 await assert.rejects(f.client.saveWorkpaperEntries(attempt),{code:'HTTP_409',status:409});
 assert.deepEqual(workpaperCalls(f,mark),['GET /access','GET /',`POST ${tail}`,'GET /access','GET /']);
 let rejected=false,recheckStatus;
 f.state.after=async(call,response)=>{
  if(call.path===f.wpRoute()+tail&&call.method==='POST')rejected=response.status===409;
  if(!rejected||call.path!==f.wpRoute()||call.method!=='GET')return;
  if(recheckStatus)return new Response(JSON.stringify({error:{code:'SYNTHETIC_READ_FAILURE'}}),{status:recheckStatus,headers:response.headers});
  const body=await response.json();
  Object.assign(body.data,{sourceProjectId:randomUUID(),headRevision:attempt.headRevision+1,version:attempt.headRevision+1});
  return new Response(JSON.stringify(body),{status:response.status,headers:response.headers});
 };
 mark=f.state.calls.length;
 await assert.rejects(f.client.saveWorkpaperEntries(attempt),{code:'WORKPAPER_CHANGED',status:409});
 assert.deepEqual(workpaperCalls(f,mark),['GET /access','GET /',`POST ${tail}`,'GET /access','GET /']);
 for(const [status,code] of [[409,'WORKPAPER_CHANGED'],[429,'HTTP_409']]){
  rejected=false;recheckStatus=status;mark=f.state.calls.length;
  await assert.rejects(f.client.saveWorkpaperEntries(attempt),{code,status:409});
  assert.deepEqual(workpaperCalls(f,mark),['GET /access','GET /',`POST ${tail}`,'GET /access','GET /']);
 }
 assert.deepEqual(f.dataRows(),rows);
});
test('a session revoked during a rejected write recheck retires the old workpaper scope',async t=>{
 const f=await fixture(t,{originalForm:true}),saved=entriesInput(f),tail='/entries/'+f.document.sha256;
 await f.client.saveWorkpaperEntries(saved);
 const attempt=entriesInput(f,{requestId:saved.requestId}),rows=f.dataRows(),mark=f.state.calls.length;
 let rejected=false,recheckStatus;
 f.state.before=async call=>{
  if(!rejected||call.path!==f.wpRoute()+'/access'||call.method!=='GET')return;
  const headers=new Headers({'Content-Type':'application/json'});
  for(const name of ['Authorization','Origin'])headers.set(name,call.request.headers.get(name));
  const logout=await f.dispatch(new Request(new URL('/api/auth/logout',call.request.url),{method:'POST',headers,body:'{}'}));
  assert.equal(logout.status,200);
 };
 f.state.after=(call,response)=>{
  if(call.path===f.wpRoute()+tail&&call.method==='POST')rejected=response.status===409;
  if(rejected&&call.path===f.wpRoute()+'/access'&&call.method==='GET')recheckStatus=response.status;
 };
 await assert.rejects(f.client.saveWorkpaperEntries(attempt),{code:'WORKPAPER_CHANGED',status:409});
 assert.equal(recheckStatus,401);
 assert.equal(await f.client.getSession(),null);
 assert.deepEqual(workpaperCalls(f,mark),['GET /access','GET /',`POST ${tail}`,'GET /access']);
 assert.deepEqual(f.dataRows(),rows);
});
test('a lost signed save response never starts a conflict probe or a second write',async t=>{
 const f=await fixture(t,{originalForm:true}),attempt=entriesInput(f),tail='/entries/'+f.document.sha256,mark=f.state.calls.length;
 let serverStatus;
 f.state.after=(call,response)=>{
  if(call.path!==f.wpRoute()+tail||call.method!=='POST')return;
  serverStatus=response.status;
  throw Error('synthetic lost transport response');
 };
 await assert.rejects(f.client.saveWorkpaperEntries(attempt),{code:'SERVICE_UNAVAILABLE'});
 assert.equal(serverStatus,201);
 assert.deepEqual(workpaperCalls(f,mark),['GET /access','GET /',`POST ${tail}`]);
 assert.equal(f.dataRows().versions.filter(v=>v.operation_id===attempt.requestId).length,1);
});
test('main-process export consumes actual signed response incrementally and verifies final authorization',async t=>{const f=await fixture(t),input=await f.exportInput(),chunks=[];let headers=0;const before=f.dataRows(),result=await f.client.downloadWorkpaperExport(input,{onHeaders(meta){headers++;assert.ok(meta.byteLength>0);},async onChunk(chunk){chunks.push(Buffer.from(chunk));}});const bytes=Buffer.concat(chunks);assert.equal(headers,1);assert.equal(sha(bytes),result.sha256);assert.equal(bytes.length,result.byteLength);assert.deepEqual(f.dataRows(),before);assert.equal(f.state.calls.filter(c=>c.path.endsWith('/export')).length,1);});
test('a forged server identity never opens a local export destination and retires the business session',async t=>{const f=await fixture(t),input=await f.exportInput();f.state.after=(call,response)=>{if(!call.path.endsWith('/export'))return;const headers=new Headers(response.headers);headers.set('X-Shenyi-Server-Id','11111111-1111-4111-8111-111111111111');return new Response(response.body,{headers,status:response.status});};let opened=0;await assert.rejects(f.client.downloadWorkpaperExport(input,{onHeaders(){opened++;},onChunk(){}}));assert.equal(opened,0);assert.equal(await f.client.getSession(),null);});
test('native-picker manager plus actual TeamClient completes one signed staged import with exact original Q/bytes/freeze and receipt',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createWorkpaperSourceManager}=require('../desktop/workpaper-source.cjs'),f=await fixture(t,{imported:false}),directory=await fs.mkdtemp(path.join(process.env.SHENYI_TEST_TMPDIR??os.tmpdir(),'shenyi-workpaper-client-source-')),filename=path.join(directory,'explicit-old-workpapers.zip');t.after(()=>fs.rm(directory,{recursive:true,force:true}));await fs.writeFile(filename,f.bytes,{flag:'wx'});let opened=0;
 const manager=createWorkpaperSourceManager({client:f.client,dialog:{async showOpenDialog(){opened++;return{canceled:false,filePaths:[filename]};}}});t.after(()=>manager.dispose());const target={...f.target,projectRevision:f.dataRevision(),grantRevision:f.dataGrantRevision()},chosen=await manager.chooseWorkpaperSource(target);assert.equal(chosen.status,'selected');assert.equal(opened,1);const saved=await manager.confirmWorkpaperImport({...target,handle:chosen.handle,packageSha256:chosen.packageSha256,currentPassword:PASSWORD,sourceVerified:true,confirmed:true});assert.equal(saved.status,'imported');assert.equal(saved.receipt.version,1);assert.equal(saved.receipt.sourceProjectId,f.sourceProjectId);assert.equal(saved.receipt.sourcePackageSha256,sha(f.bytes));const record=await f.client.getWorkpaperRecord(f.query());assert.deepEqual(record.record.workpaperLocks,JSON.parse(f.dataRows().versions[0].record_json).workpaperLocks);assert.equal(Object.keys(record.record.workpaperLocks).length,1);assert.equal(f.state.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/commit')).length,1);assert.equal(Object.hasOwn(chosen,'bytes'),false);assert.equal(Object.hasOwn(chosen,'filePath'),false);
});
