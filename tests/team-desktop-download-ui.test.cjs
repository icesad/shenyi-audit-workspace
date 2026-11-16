'use strict';
const {withDeviceDiagnostic}=require('./helpers/desktop-device-diagnostic.cjs');
// Actual renderer and a synthetic narrow bridge; no OS save dialog or customer files.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/index.html'),'utf8'),script=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/team-ui.js'),'utf8');
const safe=value=>({ok:true,value}),failure=(code,message)=>({ok:false,error:{code,message}}),deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
const SESSION={account:{id:'collector-a',displayName:'合成采集员A'},memberships:[{teamId:'team-a',role:'intern'},{teamId:'team-b',role:'assistant'}],expiresAt:1900000000000},OTHER={...SESSION,account:{id:'collector-b',displayName:'合成采集员B'}};
async function until(check){for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,0));}assert.ok(check(),'expected renderer state was not reached');}
async function settled(){await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0));}
function fixture(t,overrides={}){
 const dom=new JSDOM(html,{url:'shenyi://app/index.html',runScripts:'outside-only'}),{window}=dom,d=window.document,calls=[],tasks={
  'task-a':{id:'task-a',title:'合成任务A',instructions:'合成要求A',status:'submitted',revision:3},
  'task-b':{id:'task-b',title:'合成任务B',instructions:'合成要求B',status:'submitted',revision:7}};
 const defaults={getAuthMethods:async()=>safe({mode:'local-preview',desktopWechatReady:false,methods:{demoUsername:true,phonePassword:true,phoneVerification:false,wechat:false,recovery:false}}),getOnboardingStatus:async()=>safe({available:false,invitationOnly:true}),login:async()=>safe(SESSION),logout:async()=>safe({signedOut:true}),listTasks:async()=>safe({tasks:Object.values(tasks),hasMore:false}),getTask:async input=>safe({task:tasks[input.taskId]}),getSubmissions:async input=>safe({revision:tasks[input.taskId].revision,submissions:[{attachmentId:input.taskId==='task-a'?'attachment-a':'attachment-b',filename:input.taskId==='task-a'?'合成原件A.txt':'合成原件B.txt',byteLength:12,sha256:'a'.repeat(64),createdAt:1794700000000}]}),getTaskSubmissionAccess:async input=>safe({canSubmit:false,revision:tasks[input.taskId].revision}),downloadAttachment:async()=>safe({canceled:false,filename:'合成原件A.txt'}),...overrides};
 window.shenyiTeam=Object.fromEntries(Object.entries(defaults).map(([name,action])=>[name,typeof action==='function'?async input=>{calls.push({name,input});return action(input,{tasks});}:action]));window.shenyiTeam=withDeviceDiagnostic(window.shenyiTeam);window.eval(script);t.after(()=>window.close());
 return {window,d,calls,tasks,id:id=>d.getElementById(id),click:id=>d.getElementById(id).click(),fire:(id,type='click')=>d.getElementById(id).dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true})),download:()=>d.querySelector('.submission-item button')};
}
const count=(f,name)=>f.calls.filter(call=>call.name===name).length;
async function login(f){await until(()=>!f.id('login-submit').disabled);f.id('username').value='synthetic-collector';f.id('password').value='ShenyiDemo!2026';f.fire('login-form','submit');await until(()=>!f.id('workspace-view').hidden&&!f.id('refresh').disabled);}
async function select(f,taskId='task-a'){[...f.d.querySelectorAll('.task-button')].find(node=>node.textContent.includes(f.tasks[taskId].title)).dispatchEvent(new f.window.Event('click'));await until(()=>f.id('task-detail').textContent.includes(f.tasks[taskId].instructions)&&!f.id('refresh').disabled&&f.download());}
async function ready(f){await login(f);await select(f);}
function startDownload(f){f.download().click();}

test('normal download submits only the current narrow identifiers and reports the saved filename',async t=>{
 const f=fixture(t);await ready(f);assert.equal(f.id('task-upload').disabled,true);startDownload(f);await until(()=>f.id('workspace-message').textContent.includes('原件副本已保存'));assert.deepEqual({...f.calls.find(call=>call.name==='downloadAttachment').input},{teamId:'team-a',taskId:'task-a',attachmentId:'attachment-a'});assert.equal(f.id('workspace-message').textContent,'原件副本已保存：合成原件A.txt');assert.equal(f.download().disabled,false);assert.equal(count(f,'downloadAttachment'),1);assert.equal(f.d.querySelectorAll('form').length,18);assert.equal(f.d.querySelectorAll('input[type=password]').length,24);
});
test('save cancellation stays distinct from completion and releases only the current busy state',async t=>{
 const pending=deferred(),f=fixture(t,{downloadAttachment:async()=>pending.promise});await ready(f);startDownload(f);assert.equal(f.id('refresh').disabled,true);assert.equal(f.download().disabled,true);pending.resolve(safe({canceled:true}));await until(()=>!f.id('refresh').disabled);assert.equal(f.id('workspace-message').textContent,'已取消，未保存副本。');assert.equal(count(f,'downloadAttachment'),1);assert.ok(!f.id('workspace-message').textContent.includes('已保存：'));
});
test('a current download failure is shown once and leaves the history usable without retrying',async t=>{
 const f=fixture(t,{downloadAttachment:async()=>failure('HTTP_404','无法访问本原件，请刷新后核对。')});await ready(f);startDownload(f);await until(()=>f.id('workspace-message').classList.contains('error'));assert.equal(f.id('workspace-message').textContent,'无法访问本原件，请刷新后核对。');assert.equal(f.download().disabled,false);assert.match(f.id('task-detail').textContent,/合成原件A/);await settled();assert.equal(count(f,'downloadAttachment'),1);
});
test('transport rejection keeps a clear failure and does not start another download',async t=>{
 const f=fixture(t,{downloadAttachment:async()=>{throw new Error('合成网络不可达');}});await ready(f);startDownload(f);await until(()=>f.id('workspace-message').textContent==='合成网络不可达');assert.equal(f.id('refresh').disabled,false);assert.equal(f.id('workspace-message').classList.contains('error'),true);assert.equal(count(f,'downloadAttachment'),1);
});
test('current-session expiry clears original filenames and returns to an enabled login form',async t=>{
 const f=fixture(t,{downloadAttachment:async()=>failure('SIGN_IN_REQUIRED','当前登录已失效')});await ready(f);startDownload(f);await until(()=>!f.id('login-view').hidden);assert.equal(f.id('task-detail').textContent,'');assert.ok(!f.d.body.textContent.includes('合成原件A.txt'));assert.equal(f.id('login-submit').disabled,false);assert.equal(f.id('login-message').textContent,'当前登录已失效');assert.equal(count(f,'downloadAttachment'),1);
});
test('duplicate synthetic clicks cannot launch another download while the current request is pending',async t=>{
 const pending=deferred(),f=fixture(t,{downloadAttachment:async()=>pending.promise});await ready(f);const button=f.download();button.click();button.dispatchEvent(new f.window.Event('click'));assert.equal(count(f,'downloadAttachment'),1);pending.resolve(safe({canceled:true}));await until(()=>!f.id('refresh').disabled);
});
for(const [name,response] of [['success',safe({canceled:false,filename:'旧任务文件.txt'})],['cancel',safe({canceled:true})],['failure',failure('HTTP_404','旧任务下载错误')],['401',failure('SIGN_IN_REQUIRED','旧任务登录失效')]]){
 test('late old-task download '+name+' cannot change a new task or unlock its in-flight read',async t=>{
  const pending=deferred(),read=deferred(),f=fixture(t,{downloadAttachment:async()=>pending.promise,getTask:async(input,{tasks})=>input.taskId==='task-b'?read.promise:safe({task:tasks[input.taskId]})});await ready(f);startDownload(f);f.d.querySelectorAll('.task-button')[1].dispatchEvent(new f.window.Event('click'));await until(()=>count(f,'getTask')===2);pending.resolve(response);await settled();assert.equal(f.id('refresh').disabled,true);assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('workspace-message').textContent,'正在读取任务…');read.resolve(safe({task:f.tasks['task-b']}));await until(()=>!f.id('refresh').disabled);assert.match(f.id('task-detail').textContent,/合成要求B/);assert.match(f.id('task-detail').textContent,/合成原件B/);assert.ok(!f.id('workspace-message').textContent.includes('旧任务'));assert.equal(count(f,'downloadAttachment'),1);
 });
}
test('reselecting the same task creates a new view so a prior download 401 is ignored',async t=>{
 const pending=deferred(),f=fixture(t,{downloadAttachment:async()=>pending.promise});await ready(f);startDownload(f);await select(f);assert.equal(f.id('workspace-message').textContent,'只展示当前任务和你的提交记录。');pending.resolve(failure('SIGN_IN_REQUIRED','旧视图失效'));await settled();assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('workspace-message').textContent,'只展示当前任务和你的提交记录。');assert.equal(f.download().disabled,false);assert.equal(count(f,'getTask'),2);
});
test('a team switch drops late download success and leaves the new scoped task list intact',async t=>{
 const pending=deferred(),f=fixture(t,{downloadAttachment:async()=>pending.promise});await ready(f);startDownload(f);f.id('team-select').value='team-b';f.fire('team-select','change');await until(()=>!f.id('refresh').disabled&&f.download()===null);pending.resolve(safe({canceled:false,filename:'原团队副本.txt'}));await settled();assert.equal(f.id('team-select').value,'team-b');assert.equal(f.id('workspace-message').textContent,'任务列表已更新。');assert.equal(f.download(),null);assert.equal(f.id('refresh').disabled,false);
});
for(const [name,response] of [['success',safe({canceled:false,filename:'旧账号文件.txt'})],['cancel',safe({canceled:true})],['failure',failure('HTTP_404','旧账号下载错误')],['401',failure('SIGN_IN_REQUIRED','旧账号失效')]]){
 test('late old-account download '+name+' cannot sign out or unlock a newer account download',async t=>{
  const oldDownload=deferred(),newDownload=deferred();let logins=0,downloads=0,expire=false;const f=fixture(t,{login:async()=>safe(++logins===1?SESSION:OTHER),listTasks:async(_input,{tasks})=>expire?(expire=false,failure('SIGN_IN_REQUIRED','当前登录已失效')):safe({tasks:Object.values(tasks),hasMore:false}),downloadAttachment:async()=>++downloads===1?oldDownload.promise:newDownload.promise});await ready(f);startDownload(f);expire=true;f.fire('refresh');await until(()=>!f.id('login-view').hidden);await ready(f);startDownload(f);assert.equal(f.id('refresh').disabled,true);oldDownload.resolve(response);await settled();assert.equal(f.id('account-name').textContent,OTHER.account.displayName);assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('refresh').disabled,true);assert.equal(f.download().disabled,true);assert.equal(f.id('workspace-message').textContent,'正在核验原件下载权限…');newDownload.resolve(safe({canceled:false,filename:'新账号文件.txt'}));await until(()=>!f.id('refresh').disabled);assert.equal(f.id('workspace-message').textContent,'原件副本已保存：新账号文件.txt');assert.equal(count(f,'downloadAttachment'),2);
 });
}
test('download result filenames are rendered as text rather than executable markup',async t=>{
 const filename='<img id="untrusted-download" src=x onerror=alert(1)>.txt',f=fixture(t,{downloadAttachment:async()=>safe({canceled:false,filename})});await ready(f);startDownload(f);await until(()=>f.id('workspace-message').textContent.includes(filename));assert.equal(f.id('untrusted-download'),null);assert.equal(f.id('workspace-message').classList.contains('error'),false);assert.equal(f.id('workspace-message').textContent,'原件副本已保存：'+filename);
});
