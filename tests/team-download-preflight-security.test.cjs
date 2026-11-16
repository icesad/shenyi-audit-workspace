'use strict';
// Independent download acceptance: actual application API, isolated SQLite,
// client and main bridge. Sessions, dialogs and file bytes are synthetic.
// fs.writeFile is observed without creating an export. This is not OS-picker,
// real login, provider, Mac, device binding or production acceptance.
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs/promises');
const {DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {createTeamClient}=require('../desktop/team-client.cjs');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-15T10:00:00Z'),ORIGIN='http://127.0.0.1:8774';
const BYTES=Buffer.from([0,255,128,13,10,65,228,184,173,0]);
const quote=value=>'"'+value.replaceAll('"','""')+'"';
let baseline;
async function fixture(t,actor='intern-a'){
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs'),{issueSession}=await source('auth-api.mjs'),{handleTeamApplicationRequest}=await source('application-api.mjs');
 baseline||=(async()=>{const db=new DatabaseSync(':memory:');try{initializeTeamDatabase(db);await seedDemoTeamData(db);return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM '+quote(name)).all()}));}finally{db.close();}})();
 const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);db.exec('BEGIN;PRAGMA defer_foreign_keys=ON;');try{for(const {name,rows} of await baseline)for(const row of rows){const keys=Object.keys(row);db.prepare('INSERT OR REPLACE INTO '+quote(name)+'('+keys.map(quote).join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row));}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');db.close();throw error;}
 const calls={get:0,head:0,dialog:0,write:0,routes:[],written:[]};
 const f={db,calls,beforeRequest:null,afterResponse:null,inDialog:null,canceled:false,writeError:false,blobResults:0,traceBlob:false};
 const originalPrepare=db.prepare.bind(db);
 db.prepare=sql=>{const statement=originalPrepare(sql);for(const method of ['get','all']){const original=statement[method].bind(statement);statement[method]=(...args)=>{const result=original(...args),rows=method==='all'?result:[result];if(f.traceBlob)for(const row of rows)if(row&&Object.values(row).some(value=>value instanceof Uint8Array))f.blobResults++;return result;};}return statement;};
 const sessions={};
 const client=createTeamClient({now:()=>NOW,fetchImpl:async(url,options)=>{
  const request=new Request(url,options),route=new URL(url).pathname;
  if(route==='/api/auth/login'){const {username}=await request.json();const session=issueSession(db,username,NOW);sessions[username]=session.token;return new Response(JSON.stringify(session),{headers:{'Content-Type':'application/json'}});}
  calls.routes.push({route,method:request.method,origin:request.headers.get('Origin'),hasBearer:!!request.headers.get('Authorization')});
  if(route.includes('/attachments/')){if(request.method==='GET')calls.get++;if(request.method==='HEAD')calls.head++;}
  await f.beforeRequest?.(request);
  const response=await handleTeamApplicationRequest(request,{db,now:()=>NOW});
  return await f.afterResponse?.(request,response)||response;
 }});
 f.client=client;
 await client.login({username:'intern-a',password:'synthetic-session-adoption'});
 const uploaded=await client.upload({teamId:'team-a',taskId:'task-a',revision:0},{filename:'合成原件.bin',bytes:BYTES});
 const input={teamId:'team-a',taskId:'task-a',attachmentId:uploaded.submission.attachmentId};
 if(actor!=='intern-a'){db.prepare("INSERT INTO team_attachment_grants VALUES (?,?,?,'active')").run('team-a',input.attachmentId,actor);await client.login({username:actor,password:'synthetic-session-adoption'});}
 f.input=input;f.actor=actor;f.sessions=sessions;
 f.route='/api/teams/team-a/collection/tasks/task-a/attachments/'+input.attachmentId;
 f.raw=async(route=f.route,method='HEAD',headers={})=>handleTeamApplicationRequest(new Request(ORIGIN+route,{method,headers:{Origin:'shenyi://app',Authorization:'Bearer '+sessions[actor],...headers}}),{db,now:()=>NOW});
 const handlers=new Map(),mainFrame={url:APP_URL},window={webContents:{mainFrame}};
 const event={sender:window.webContents,senderFrame:mainFrame};
 const dispose=registerDesktopBridge({ipcMain:{handle:(name,action)=>handlers.set(name,action),removeHandler:name=>handlers.delete(name)},window,client,dialog:{showSaveDialog:async()=>{calls.dialog++;await f.inDialog?.();return f.canceled?{canceled:true}:{canceled:false,filePath:'D:/synthetic-not-created/副本.bin'};}}});
 const originalWrite=fs.writeFile;
 fs.writeFile=async(filename,bytes)=>{calls.write++;calls.written.push({filename,bytes:Buffer.from(bytes)});if(f.writeError)throw Error('PRIVATE_FS_ERROR '+filename);};
 t.after(()=>{fs.writeFile=originalWrite;dispose();db.close();});
 f.handlers=handlers;f.call=(name,arg,sender=event)=>handlers.get('shenyi:'+name)(sender,arg);f.download=(arg=input)=>f.call('download',arg);
 return f;
}
function business(f){return ['team_task_assignments','team_task_versions','team_collection_tasks','team_collection_attachments','team_task_submissions','team_attachment_grants','team_activity'].map(name=>({name,rows:f.db.prepare('SELECT * FROM '+quote(name)).all()}));}
function denied(result,code){assert.equal(result.ok,false,JSON.stringify(result));if(code)assert.equal(result.error.code,code);}
function noWrite(f){assert.equal(f.calls.write,0);assert.deepEqual(f.calls.written,[]);}
const revokeAssignment=f=>f.db.prepare("UPDATE team_task_assignments SET status='revoked' WHERE team_id='team-a' AND task_id='task-a' AND user_id='intern-a'").run();
const revokeAttachment=f=>f.db.prepare("UPDATE team_attachment_grants SET status='revoked' WHERE team_id='team-a' AND user_id='intern-a'").run();
const revokeSession=f=>f.db.prepare("UPDATE team_sessions SET revoked_at=? WHERE user_id='intern-a'").run(NOW);
const disableUser=f=>f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='intern-a'").run();

for(const [label,mutate,code] of [
 ['assignment revoked',revokeAssignment,'HTTP_404'],['attachment grant revoked',revokeAttachment,'HTTP_404'],
 ['session revoked',revokeSession,'SIGN_IN_REQUIRED'],['user disabled',disableUser,'SIGN_IN_REQUIRED'],
 ['team disabled',f=>f.db.prepare("UPDATE teams SET status='disabled' WHERE team_id='team-a'").run(),'HTTP_404'],
 ['membership disabled',f=>f.db.prepare("UPDATE team_memberships SET status='disabled' WHERE team_id='team-a' AND user_id='intern-a'").run(),'HTTP_404'],
])test('fresh HEAD prevents saving when '+label+' in the synthetic save dialog',async t=>{
 const f=await fixture(t);let afterMutation;f.inDialog=()=>{mutate(f);afterMutation=business(f);};
 const result=await f.download();denied(result,code);assert.equal(f.calls.get,1);assert.equal(f.calls.dialog,1);assert.equal(f.calls.head,1);noWrite(f);assert.deepEqual(business(f),afterMutation);
});

test('fresh HEAD applies manager project read and independent attachment-grant intersection',async t=>{
 const f=await fixture(t,'manager-a');let afterMutation;
 f.inDialog=()=>{f.db.prepare("DELETE FROM team_project_grants WHERE team_id='team-a' AND project_id='project-a' AND user_id='manager-a' AND permission='collection.read'").run();afterMutation=business(f);};
 denied(await f.download(),'HTTP_404');assert.equal(f.calls.get,1);assert.equal(f.calls.dialog,1);assert.equal(f.calls.head,1);noWrite(f);assert.deepEqual(business(f),afterMutation);
});

test('cancellation performs no authorization HEAD, export or business mutation',async t=>{
 const f=await fixture(t),before=business(f);f.canceled=true;
 assert.deepEqual(await f.download(),{ok:true,value:{canceled:true}});assert.equal(f.calls.get,1);assert.equal(f.calls.dialog,1);assert.equal(f.calls.head,0);noWrite(f);assert.deepEqual(business(f),before);
});

test('authorized download preserves exact original bytes, digest, safe filename and 64 narrow IPC methods',async t=>{
 const f=await fixture(t),before=business(f),result=await f.download();
 assert.deepEqual(result,{ok:true,value:{saved:true,filename:'副本.bin',byteLength:BYTES.length}});
 assert.equal(f.calls.get,1);assert.equal(f.calls.dialog,1);assert.equal(f.calls.head,1);assert.equal(f.calls.write,1);
 assert.deepEqual(f.calls.written[0].bytes,BYTES);assert.equal(createHash('sha256').update(f.calls.written[0].bytes).digest('hex'),createHash('sha256').update(BYTES).digest('hex'));
 assert.equal(JSON.stringify(result).includes('D:/synthetic-not-created'),false);assert.equal(f.handlers.size,98);assert.ok(!f.handlers.has('shenyi:check-attachment-access'));assert.deepEqual(business(f),before);
 const requests=f.calls.routes.filter(item=>item.route===f.route);assert.deepEqual(requests.map(item=>item.method),['GET','HEAD']);assert.ok(requests.every(item=>item.hasBearer&&item.origin==='shenyi://app'));
});

test('freezing the project and closing the task do not remove already-authorized original-read semantics',async t=>{
 const f=await fixture(t);f.inDialog=()=>{f.db.prepare("UPDATE team_projects SET status='frozen' WHERE team_id='team-a' AND project_id='project-a'").run();f.db.prepare("UPDATE team_collection_tasks SET status='closed' WHERE team_id='team-a' AND task_id='task-a'").run();};
 const result=await f.download();assert.equal(result.ok,true,JSON.stringify(result));assert.equal(f.calls.head,1);assert.equal(f.calls.write,1);assert.deepEqual(f.calls.written[0].bytes,BYTES);
});

for(const phase of ['GET','HEAD'])test('session generation change while '+phase+' resolves cannot save old bytes',async t=>{
 const f=await fixture(t),before=business(f);let changed=false;
 f.afterResponse=async(request,response)=>{if(!changed&&request.method===phase&&new URL(request.url).pathname===f.route){changed=true;await f.client.login({username:'assistant-a',password:'synthetic-session-adoption'});}return response;};
 denied(await f.download(),'SESSION_CHANGED');assert.equal(changed,true);assert.equal(f.calls.dialog,phase==='GET'?0:1);assert.equal(f.calls.head,phase==='GET'?0:1);noWrite(f);assert.equal((await f.client.getSession()).account.id,'assistant-a');assert.deepEqual(business(f),before);
});

test('a generation change inside the dialog is rejected before sending HEAD',async t=>{
 const f=await fixture(t);f.inDialog=()=>f.client.login({username:'assistant-a',password:'synthetic-session-adoption'});
 denied(await f.download(),'SESSION_CHANGED');assert.equal(f.calls.dialog,1);assert.equal(f.calls.head,0);noWrite(f);assert.equal((await f.client.getSession()).account.id,'assistant-a');
});

for(const status of [401,403,404,503])test('empty-body HEAD '+status+' fails safely without retry or export',async t=>{
 const f=await fixture(t);f.afterResponse=request=>request.method==='HEAD'?new Response(null,{status}):null;
 const result=await f.download();denied(result,status===401?'SIGN_IN_REQUIRED':'HTTP_'+status);assert.equal(f.calls.head,1);noWrite(f);assert.equal(JSON.stringify(result).includes('synthetic-not-created'),false);
});

for(const label of ['network failure','timeout'])test('HEAD '+label+' does not write files or automatically retry',async t=>{
 const f=await fixture(t);f.beforeRequest=request=>{if(request.method==='HEAD')throw label==='timeout'?new DOMException('PRIVATE provider timeout','TimeoutError'):Error('PRIVATE provider route/path');};
 const result=await f.download();denied(result,'SERVICE_UNAVAILABLE');assert.equal(f.calls.get,1);assert.equal(f.calls.head,1);noWrite(f);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
});

for(const status of [200,401,404,503])test('an abnormal body on HEAD '+status+' never authorizes export or leaks provider data',async t=>{
 const f=await fixture(t);f.afterResponse=request=>request.method==='HEAD'?new Response('PRIVATE_PROVIDER_BODY D:/private/client.sqlite',{status}):null;
 const result=await f.download();denied(result,status===200?'INVALID_RESPONSE':status===401?'SIGN_IN_REQUIRED':'HTTP_'+status);assert.equal(f.calls.head,1);noWrite(f);assert.ok(!/PRIVATE|client\.sqlite/.test(JSON.stringify(result)));if(status===401)assert.equal(await f.client.getSession(),null);
});

test('internal HEAD client accepts no renderer identity, role, path, URL or extra revision',async t=>{
 const f=await fixture(t),before=f.calls.routes.length;
 for(const extra of [{userId:'intern-a'},{role:'partner'},{path:'D:/private'},{url:'https://provider.invalid'},{revision:0}])await assert.rejects(()=>f.client.checkAttachmentAccess({...f.input,...extra}),error=>error.code==='INVALID_INPUT');
 assert.equal(f.calls.routes.length,before);assert.deepEqual(await f.client.checkAttachmentAccess(f.input),{canDownload:true});assert.equal(f.calls.head,1);noWrite(f);
});

test('unknown and foreign attachments are denied before showing a save dialog',async t=>{
 const f=await fixture(t),before=business(f);
 for(const input of [{...f.input,teamId:'team-b'},{...f.input,attachmentId:'missing-attachment'}])denied(await f.download(input),'HTTP_404');
 assert.equal(f.calls.get,2);assert.equal(f.calls.dialog,0);assert.equal(f.calls.head,0);noWrite(f);assert.deepEqual(business(f),before);
});

test('untrusted renderer and injected download fields cannot invoke the transport',async t=>{
 const f=await fixture(t),before=f.calls.routes.length;
 denied(await f.call('download',f.input,{sender:{},senderFrame:{url:APP_URL}}),'UNTRUSTED_SENDER');
 denied(await f.download({...f.input,path:'D:/private'}));assert.equal(f.calls.routes.length,before);assert.equal(f.calls.dialog,0);noWrite(f);
});

test('filesystem export failure returns fixed safe guidance without the selected full path',async t=>{
 const f=await fixture(t);f.writeError=true;const result=await f.download();denied(result,'OPERATION_FAILED');assert.equal(f.calls.head,1);assert.equal(f.calls.write,1);assert.ok(!/PRIVATE|synthetic-not-created|副本/.test(JSON.stringify(result)));
});

test('HEAD success is bodyless, read-only, minimal metadata and does not materialize blob bytes in JS',async t=>{
 const f=await fixture(t),before=business(f);f.traceBlob=true;
 const response=await f.raw();assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,0);assert.equal(f.blobResults,0);f.traceBlob=false;
 assert.match(response.headers.get('Cache-Control'),/no-store/);assert.match(response.headers.get('Content-Disposition'),/filename\*/);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.deepEqual(business(f),before);
});

test('HEAD error routes also have empty bodies and nonattachment HEAD stays unsupported',async t=>{
 const f=await fixture(t);
 const cases=[
  [f.route+'?unexpected=1',{},400],[f.route,{Authorization:'Bearer invalid'},401],
  [f.route,{'Sec-Fetch-Site':'cross-site'},403],
  [f.route.replace(f.input.attachmentId,'missing-attachment'),{},404],
  ['/api/teams/team-a/collection/tasks/task-a',{},405],
 ];
 for(const [route,headers,status] of cases){const response=await f.raw(route,'HEAD',headers);assert.equal(response.status,status);assert.equal((await response.arrayBuffer()).byteLength,0,'HEAD '+status+' must not include a body');}
});

test('application-level clock and origin failures cannot attach a HEAD error body',async t=>{
 const f=await fixture(t),{handleTeamApplicationRequest}=await source('application-api.mjs');
 for(const [origin,now,status] of [['shenyi://app',-1,503],['https://foreign.invalid',NOW,403]]){
  const response=await handleTeamApplicationRequest(new Request(ORIGIN+f.route,{method:'HEAD',headers:{Origin:origin,Authorization:'Bearer '+f.sessions[f.actor]}}),{db:f.db,now:()=>now});
  assert.equal(response.status,status);assert.equal((await response.arrayBuffer()).byteLength,0);
 }
 noWrite(f);
});
