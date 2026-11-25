'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID,createHash,sign}=require('node:crypto');
const {createTaskSubmissionPreviewManager}=require('../desktop/task-submission-preview.cjs');
const {ClientError,createTeamClient}=require('../desktop/team-client.cjs');
const core=require('../shared/task-originals-export.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t,{automatic=true,client:provided}={}){
 const raw=Buffer.from('Synthetic selected original\0\r\n原件'),calls=[],listeners=new Set(),windows=[],intervals=new Map(),timeouts=new Map();
 const state={epoch:0,denied:false,plan:null,get:null,head:null};
 const input={requestId:randomUUID(),teamId:'team-a',taskId:'task-a',revision:2,submissionId:'submission-a'};
 const project={...input,requestId:randomUUID(),projectId:'project-a',projectRevision:5};
 function plan(selection,review=false){return core.makePlan({scope:review?{kind:'project-review',teamId:selection.teamId,taskId:selection.taskId,projectId:selection.projectId,projectRevision:selection.projectRevision}:{kind:'own',teamId:selection.teamId,taskId:selection.taskId,userId:'intern-a'},task:{id:selection.taskId,title:'Synthetic task',instructions:'Only this task',status:'returned',revision:selection.revision},files:selection.submissionIds.map(id=>({id,attachmentId:'attachment-'+id,filename:'原件.pdf',sha256:digest(raw),byteLength:raw.length,createdAt:0,...(review?{submittedBy:{id:'intern-a',displayName:'合成员工'}}:{})}))});}
 const stub={guardSession(){if(state.denied)throw new ClientError('DEVICE_NOT_READY','合成暂停');const at=state.epoch;return()=>{if(state.denied||state.epoch!==at)throw new ClientError('SESSION_CHANGED','合成上下文改变');};},onProjectMigrationContextChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},getTaskExportPlan:selection=>readPlan(selection,false),getProjectTaskExportPlan:selection=>readPlan(selection,true),download:target=>get(target,false),getProjectSubmissionFile:target=>get(target,true),checkAttachmentAccess:target=>head(target,false),authorizeProjectSubmissionDownload:target=>head(target,true)};
 async function readPlan(selection,review){calls.push({kind:'plan',review,input:structuredClone(selection)});return state.plan?state.plan(selection,review):plan(selection,review);}
 async function get(target,review){calls.push({kind:'get',review,input:structuredClone(target)});return state.get?state.get(target,review):{bytes:new Uint8Array(raw),contentDisposition:'ignored'};}
 async function head(target,review){calls.push({kind:'head',review,input:structuredClone(target)});return state.head?state.head(target,review):{canDownload:true};}
 const openWindow=hooks=>{const gate=deferred(),window={hooks,shown:gate.promise,gate,closed:0,source:null,revealed:false,close(){if(window.closed++)return;hooks.onClosed();gate.reject(new ClientError('WINDOW_CLOSED','合成阅读窗口关闭'));}};windows.push(window);if(automatic)queueMicrotask(async()=>{try{window.source=await hooks.getSource();await hooks.authorize();window.revealed=true;gate.resolve();}catch(error){gate.reject(error);}});return window;};
 const manager=createTaskSubmissionPreviewManager({client:provided??stub,openWindow,setIntervalImpl(fn,ms){assert.equal(ms,5000);const id={};intervals.set(id,fn);return id;},clearIntervalImpl:id=>intervals.delete(id),setTimeoutImpl(fn,ms){assert.equal(ms,50000);const id={};timeouts.set(id,fn);return id;},clearTimeoutImpl:id=>timeouts.delete(id)});t.after(()=>manager.dispose());
 return {manager,client:stub,state,calls,input,project,raw,plan,windows,intervals,timeouts,listeners,change(){state.epoch++;for(const fn of listeners)fn();},tick(){for(const fn of [...intervals.values()])fn();},expire(){for(const fn of [...timeouts.values()])fn();}};
}
for(const review of [false,true])test((review?'project':'own')+' selected submission opens with verified private bytes and exact narrow output',async t=>{
 const f=harness(t),input=review?f.project:f.input,result=await f.manager[review?'previewProjectSubmission':'previewTaskSubmission'](input);
 assert.deepEqual(result,{opened:true,previewId:input.requestId,filename:'原件.pdf',byteLength:f.raw.length});
 assert.deepEqual(f.calls.map(call=>call.kind),['plan','get','head','plan','head','plan','head','plan']);
 assert.ok(f.calls.every(call=>call.review===review));assert.deepEqual(f.calls[0].input,{teamId:input.teamId,taskId:input.taskId,revision:2,...(review?{projectId:input.projectId,projectRevision:5}:{}),submissionIds:[input.submissionId]});
 assert.deepEqual(f.calls[1].input,review?{teamId:'team-a',projectId:'project-a',taskId:'task-a',submissionId:input.submissionId}:{teamId:'team-a',taskId:'task-a',attachmentId:'attachment-'+input.submissionId});
 const source=f.windows[0].source;assert.deepEqual(Object.keys(source),['bytes','filename','type','sha256','byteLength']);assert.deepEqual(Buffer.from(source.bytes),f.raw);assert.equal(source.type,'application/octet-stream');assert.equal(f.windows[0].revealed,true);assert.equal(f.timeouts.size,0);assert.equal(f.intervals.size,1);
 assert.deepEqual(f.manager.closeTaskSubmissionPreview({previewId:input.requestId}),{closed:true});assert.deepEqual(f.manager.closeTaskSubmissionPreview({previewId:input.requestId}),{closed:false});assert.equal(f.intervals.size,0);
});
test('denied initial guard neither consumes the ID nor closes the current window',async t=>{
 const f=harness(t);await f.manager.previewTaskSubmission(f.input);f.state.denied=true;await assert.rejects(f.manager.previewProjectSubmission(f.project),{code:'DEVICE_NOT_READY'});assert.equal(f.windows[0].closed,0);f.state.denied=false;assert.equal((await f.manager.previewProjectSubmission(f.project)).opened,true);assert.equal(f.windows[0].closed,1);
});
test('exact inputs reject injected authority, noncanonical IDs and unsafe versions without a client request',async t=>{
 const f=harness(t);for(const extra of [{attachmentId:'attachment-a'},{userId:'partner-a'},{role:'partner'},{url:'https://untrusted.invalid'},{path:'D:/private'},{bytes:[1]},{requestId:randomUUID().toUpperCase()},{revision:-1},{revision:1.5},{revision:Number.MAX_SAFE_INTEGER+1},{submissionId:'../foreign'}])await assert.rejects(f.manager.previewTaskSubmission({...f.input,...extra}),{code:'INVALID_INPUT'});
 for(const projectRevision of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1])await assert.rejects(f.manager.previewProjectSubmission({...f.project,projectRevision}),{code:'INVALID_INPUT'});
 const getter={...f.input};Object.defineProperty(getter,'submissionId',{get(){throw Error('Getter must not run');},enumerable:true});await assert.rejects(f.manager.previewTaskSubmission(getter),{code:'INVALID_INPUT'});assert.equal(f.calls.length,0);
});
for(const mutate of [p=>({...p,sha256:'0'.repeat(64)}),p=>core.makePlan({scope:{...p.manifest.scope,teamId:'team-b'},task:p.manifest.task,files:p.manifest.files}),p=>core.makePlan({scope:p.manifest.scope,task:{...p.manifest.task,revision:3},files:p.manifest.files}),p=>core.makePlan({scope:p.manifest.scope,task:p.manifest.task,files:[{...p.manifest.files[0],id:'another-submission'}]})])test('untrusted plan cannot replace the selected scope version or file before GET',async t=>{
 const f=harness(t);f.state.plan=(input,review)=>mutate(f.plan(input,review));await assert.rejects(f.manager.previewTaskSubmission(f.input),{code:'INVALID_RESPONSE'});assert.equal(f.calls.filter(call=>call.kind==='get').length,0);assert.equal(f.windows.length,0);
});
test('project plans cannot substitute a validly hashed foreign project or project revision',async t=>{
 const f=harness(t);for(const extra of [{projectId:'project-b'},{projectRevision:6}]){f.state.plan=(input,review)=>{const p=f.plan(input,review).manifest;return core.makePlan({scope:{...p.scope,...extra},task:p.task,files:p.files});};await assert.rejects(f.manager.previewProjectSubmission({...f.project,requestId:randomUUID()}),{code:'INVALID_RESPONSE'});}assert.equal(f.calls.filter(call=>call.kind==='get').length,0);
});
test('zero-byte originals retain download semantics but are not sent to a reading window',async t=>{
 const f=harness(t);f.state.plan=(input,review)=>{const p=f.plan(input,review).manifest;return core.makePlan({scope:p.scope,task:p.task,files:[{...p.files[0],byteLength:0,sha256:digest(Buffer.alloc(0))}]});};await assert.rejects(f.manager.previewTaskSubmission(f.input),error=>error.code==='PREVIEW_EMPTY_FILE'&&/0字节/.test(error.message));assert.equal(f.calls.filter(call=>call.kind==='get').length,0);assert.equal(f.windows.length,0);
});
for(const value of [()=>({bytes:Buffer.alloc(1)}),f=>({bytes:Buffer.alloc(f.raw.length)}),()=>({bytes:[]})])test('length hash and binary-container mismatches reveal no private source',async t=>{
 const f=harness(t);f.state.get=()=>value(f);await assert.rejects(f.manager.previewTaskSubmission(f.input),{code:'PREVIEW_INTEGRITY_FAILED'});assert.equal(f.windows.length,0);
});
test('fresh HEAD must acknowledge exactly one permission field before the final plan is read',async t=>{
 const f=harness(t);for(const access of [{canDownload:false},{canDownload:true,sha256:'a'.repeat(64)},{},null]){f.state.head=()=>access;const count=f.calls.filter(call=>call.kind==='plan').length;await assert.rejects(f.manager.previewTaskSubmission({...f.input,requestId:randomUUID()}),{code:'INVALID_RESPONSE'});assert.equal(f.calls.filter(call=>call.kind==='plan').length,count+1);}assert.equal(f.windows.length,0);
});
test('HEAD is followed by a fresh entire plan hash comparison before creating any window',async t=>{
 const f=harness(t);let count=0;f.state.plan=(input,review)=>{const p=f.plan(input,review);if(++count===1)return p;return core.makePlan({scope:p.manifest.scope,task:{...p.manifest.task,title:'Changed title'},files:p.manifest.files});};await assert.rejects(f.manager.previewTaskSubmission(f.input),{code:'PREVIEW_CHANGED'});assert.deepEqual(f.calls.map(call=>call.kind),['plan','get','head','plan']);assert.equal(f.windows.length,0);
});
test('late A plan success and an exact A close cannot disturb project B',async t=>{
 const f=harness(t),held=deferred(),entered=deferred();let first=true;f.state.plan=(input,review)=>first?(first=false,entered.resolve(),held.promise):f.plan(input,review);const a=f.manager.previewTaskSubmission(f.input),rejected=assert.rejects(a,{code:'PREVIEW_CLOSED'});await entered.promise;await f.manager.previewProjectSubmission(f.project);await rejected;held.resolve(f.plan({teamId:'team-a',taskId:'task-a',revision:2,submissionIds:['submission-a']}));await flush();assert.deepEqual(f.manager.closeTaskSubmissionPreview({previewId:f.input.requestId}),{closed:false});assert.equal(f.windows[0].closed,0);assert.equal(f.windows[0].revealed,true);
});
test('an ID cannot be reused across own and project preview incarnations',async t=>{
 const f=harness(t);await f.manager.previewTaskSubmission(f.input);f.manager.closeAll();await assert.rejects(f.manager.previewProjectSubmission({...f.project,requestId:f.input.requestId}),{code:'PREVIEW_ALREADY_USED'});
});
test('context change rejects a held GET before any window exists and its late response cannot revive it',async t=>{
 const f=harness(t),held=deferred(),entered=deferred();f.state.get=()=>{entered.resolve();return held.promise;};const pending=f.manager.previewTaskSubmission(f.input),rejected=assert.rejects(pending,{code:'PREVIEW_CLOSED'});await entered.promise;f.change();await rejected;held.resolve({bytes:new Uint8Array(f.raw)});await flush();assert.equal(f.windows.length,0);assert.equal(f.intervals.size,0);
});
test('source is claimed before its HEAD await and a context change discards the held delivery',async t=>{
 const f=harness(t,{automatic:false}),pending=f.manager.previewTaskSubmission(f.input),rejected=assert.rejects(pending);await flush();const held=deferred();f.state.head=()=>held.promise;const source=f.windows[0].hooks.getSource(),sourceRejected=assert.rejects(source);await assert.rejects(f.windows[0].hooks.getSource(),{code:'PREVIEW_SOURCE_USED'});f.change();await sourceRejected;await rejected;held.resolve({canDownload:true});await flush();assert.equal(f.windows[0].closed,1);assert.equal(f.windows[0].source,null);
});
test('reveal after source rechecks scope and refuses a revoked attachment grant',async t=>{
 const f=harness(t,{automatic:false}),pending=f.manager.previewTaskSubmission(f.input),rejected=assert.rejects(pending);await flush();await f.windows[0].hooks.getSource();f.state.head=()=>Promise.reject(new ClientError('HTTP_404','合成撤权'));await assert.rejects(f.windows[0].hooks.authorize(),{code:'HTTP_404'});await rejected;assert.equal(f.windows[0].revealed,false);assert.equal(f.windows[0].closed,1);
});
test('reveal requires a delivered source and a second reveal does not run another authority check',async t=>{
 const f=harness(t,{automatic:false}),pending=f.manager.previewTaskSubmission(f.input);await flush();const w=f.windows[0];await assert.rejects(w.hooks.authorize(),{code:'PREVIEW_SOURCE_REQUIRED'});await w.hooks.getSource();await w.hooks.authorize();const count=f.calls.length;await assert.rejects(w.hooks.authorize(),{code:'PREVIEW_REVEAL_USED'});assert.equal(f.calls.length,count);w.gate.resolve();assert.equal((await pending).opened,true);
});
test('five-second monitors do not overlap and a failed A monitor or onClosed cannot close B',async t=>{
 const f=harness(t);await f.manager.previewTaskSubmission(f.input);const held=deferred();f.state.head=()=>held.promise;const before=f.calls.length;f.tick();f.tick();assert.equal(f.calls.length,before+1);f.state.head=null;await f.manager.previewProjectSubmission(f.project);f.windows[0].hooks.onClosed();held.reject(new ClientError('HTTP_404','合成旧请求撤权'));await flush();assert.equal(f.windows[1].closed,0);f.state.plan=()=>Promise.reject(new ClientError('HTTP_409','合成版本变化'));f.tick();await flush();assert.equal(f.windows[1].closed,1);assert.equal(f.intervals.size,0);
});
test('owned byte copy is stable across later fetch-container mutation and fresh-source deliveries are isolated',async t=>{
 const f=harness(t,{automatic:false}),bytes=new Uint8Array(f.raw),entered=deferred(),held=deferred();f.state.get=()=>({bytes});f.state.head=()=>{entered.resolve();return held.promise;};const pending=f.manager.previewTaskSubmission(f.input);await entered.promise;bytes.fill(0);f.state.head=null;held.resolve({canDownload:true});await flush();const source=await f.windows[0].hooks.getSource();assert.deepEqual(Buffer.from(source.bytes),f.raw);await f.windows[0].hooks.authorize();f.windows[0].gate.resolve();assert.equal((await pending).opened,true);
});
test('deadline close and disposal remove every owned timer and listener without reusing IDs',async t=>{
 const f=harness(t,{automatic:false}),pending=f.manager.previewTaskSubmission(f.input),rejected=assert.rejects(pending,{code:'PREVIEW_CLOSED'});await flush();f.expire();await rejected;assert.equal(f.windows[0].closed,1);assert.equal(f.timeouts.size,0);assert.equal(f.intervals.size,0);f.manager.dispose();f.manager.dispose();assert.equal(f.listeners.size,0);await assert.rejects(f.manager.previewTaskSubmission({...f.input,requestId:randomUUID()}),{code:'PREVIEW_CLOSED'});
});

async function strictFixture(t,user='intern-a'){
 const {createProjectAccessFixture,PASSWORD}=require('./helpers/project-access-fixture.cjs'),proof=require('../shared/device-proof.cjs');
 const f=await createProjectAccessFixture(t),initial=await f.ready(),uploaded=await f.upload(initial,{filename:'read-only.txt',bytes:Buffer.from('Original body\0原件')}),actor=user==='intern-a'?initial:await f.ready(user),key=actor.key,fingerprint=proof.parsePublicKey(key.encoded).fingerprint,calls=[],transport={after:null};
 const client=createTeamClient({deviceIdentity:{platform:'win32',vault:{async getPublicIdentity(){return {publicKey:key.encoded,fingerprint};},async signChallenge(fields){return sign(null,proof.challengeBytes(fields),key.privateKey).toString('base64url');},async signRequest(fields){return sign(null,proof.requestProofBytes(fields),key.privateKey).toString('base64url');}}},now:()=>f.clock.value,fetchImpl:async(url,settings)=>{const event={path:new URL(url).pathname,method:settings.method};calls.push(event);const response=await f.dispatch(new Request(url,settings));return transport.after?transport.after(event,response):response;}});await client.login({username:user,password:PASSWORD});
 const h=harness(t,{client});return {...f,...h,client,calls,transport,uploaded,own:{requestId:randomUUID(),teamId:'team-a',taskId:'task-a',revision:uploaded.revision,submissionId:uploaded.submission.id},review:{requestId:randomUUID(),teamId:'team-a',projectId:'project-a',taskId:'task-a',revision:uploaded.revision,projectRevision:f.revision(),submissionId:uploaded.submission.id}};
}
test('real strict SQLite client previews own granted original without any business row or original-byte change',async t=>{
 const f=await strictFixture(t),before=f.db.prepare('SELECT * FROM team_task_submissions').all(),originals=f.db.prepare('SELECT attachment_id,bytes FROM team_collection_attachments').all();const result=await f.manager.previewTaskSubmission(f.own);assert.equal(result.opened,true);assert.deepEqual(Buffer.from(f.windows[0].source.bytes),f.uploaded.bytes);assert.ok(f.calls.every(call=>!['POST','PUT','DELETE'].includes(call.method)||call.path.startsWith('/api/auth/')));assert.deepEqual(f.db.prepare('SELECT * FROM team_task_submissions').all(),before);assert.deepEqual(f.db.prepare('SELECT attachment_id,bytes FROM team_collection_attachments').all(),originals);
 f.db.prepare("UPDATE team_attachment_grants SET status='revoked' WHERE attachment_id=? AND user_id='intern-a'").run(f.uploaded.submission.attachmentId);f.tick();await flush();await flush();assert.equal(f.windows[0].closed,1);
});
test('real project review uses read plus review rather than an individual attachment grant or owner alone',async t=>{
 const f=await strictFixture(t,'manager-a');assert.equal(f.db.prepare("SELECT 1 FROM team_attachment_grants WHERE user_id='manager-a'").get(),undefined);assert.equal((await f.manager.previewProjectSubmission(f.review)).opened,true);assert.deepEqual(Buffer.from(f.windows[0].source.bytes),f.uploaded.bytes);
 f.manager.closeAll();f.db.prepare("UPDATE team_project_access_grants SET status='revoked',revision=revision+1 WHERE user_id='manager-a' AND permission='collection.review'").run();await assert.rejects(f.manager.previewProjectSubmission({...f.review,requestId:randomUUID(),projectRevision:f.revision()}),{code:'HTTP_404'});assert.equal(f.windows.length,1);
});
test('real signed GET followed by attachment revocation cannot create or reveal a reading window',async t=>{
 const f=await strictFixture(t);f.transport.after=(event,response)=>{if(event.method==='GET'&&event.path.includes('/attachments/'))f.db.prepare("UPDATE team_attachment_grants SET status='revoked' WHERE attachment_id=? AND user_id='intern-a'").run(f.uploaded.submission.attachmentId);return response;};await assert.rejects(f.manager.previewTaskSubmission(f.own),{code:'HTTP_404'});assert.equal(f.windows.length,0);assert.ok(f.calls.some(call=>call.method==='HEAD'));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_task_submissions').get().n,1);
});
