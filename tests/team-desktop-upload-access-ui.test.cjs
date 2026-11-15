'use strict';
const {withDeviceDiagnostic}=require('./helpers/desktop-device-diagnostic.cjs');
// Actual renderer with a synthetic narrow bridge. No native dialogs or audit data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/index.html'),'utf8'),script=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/team-ui.js'),'utf8');
const safe=value=>({ok:true,value}),failure=(code,message)=>({ok:false,error:{code,message}}),deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
const SESSION={account:{id:'collector-a',displayName:'合成采集员'},memberships:[{teamId:'team-a',role:'intern'},{teamId:'team-b',role:'assistant'}],expiresAt:1900000000000},OTHER={...SESSION,account:{id:'collector-b',displayName:'另一合成员工'}};
async function until(check){for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,0));}assert.ok(check(),'expected renderer state was not reached');}
async function settled(){await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0));}
function fixture(t,overrides={}){
 const dom=new JSDOM(html,{url:'shenyi://app/index.html',runScripts:'outside-only'}),{window}=dom,d=window.document,calls=[],tasks={
  'task-a':{id:'task-a',title:'合成采集A',instructions:'合成要求A',status:'open',revision:3,canSubmit:true},
  'task-b':{id:'task-b',title:'合成采集B',instructions:'合成要求B',status:'returned',revision:7,canSubmit:false}};
 const defaults={getAuthMethods:async()=>safe({mode:'local-preview',desktopWechatReady:false,methods:{demoUsername:true,phonePassword:true,phoneVerification:false,wechat:false,recovery:false}}),getOnboardingStatus:async()=>safe({available:false,invitationOnly:true}),login:async()=>safe(SESSION),logout:async()=>safe({signedOut:true}),listTasks:async()=>safe({tasks:Object.values(tasks).map(({id,title,instructions,status})=>({id,title,instructions,status})),hasMore:false}),getTask:async input=>{const {id,title,instructions,status}=tasks[input.taskId];return safe({task:{id,title,instructions,status}});},getSubmissions:async input=>safe({revision:tasks[input.taskId].revision,submissions:[]}),getTaskSubmissionAccess:async input=>safe({canSubmit:tasks[input.taskId].canSubmit,revision:tasks[input.taskId].revision}),chooseAndUpload:async()=>safe({canceled:true}),...overrides};
 window.shenyiTeam=Object.fromEntries(Object.entries(defaults).map(([name,action])=>[name,typeof action==='function'?async input=>{calls.push({name,input});return action(input,{tasks});}:action]));window.shenyiTeam=withDeviceDiagnostic(window.shenyiTeam);window.eval(script);t.after(()=>window.close());
 return {window,d,calls,tasks,id:id=>d.getElementById(id),click:id=>d.getElementById(id).click(),fire:(id,type='click')=>d.getElementById(id).dispatchEvent(new window.Event(type,{bubbles:true,cancelable:true}))};
}
const count=(f,name)=>f.calls.filter(call=>call.name===name).length;
async function login(f){await until(()=>!f.id('login-submit').disabled);f.id('username').value='synthetic-collector';f.id('password').value='ShenyiDemo!2026';f.fire('login-form','submit');await until(()=>!f.id('workspace-view').hidden&&!f.id('refresh').disabled);}
async function select(f,taskId='task-a'){[...f.d.querySelectorAll('.task-button')].find(node=>node.textContent.includes(f.tasks[taskId].title)).dispatchEvent(new f.window.Event('click'));await until(()=>f.id('task-detail').textContent.includes(f.tasks[taskId].instructions)&&!f.id('refresh').disabled);}
async function ready(f){await login(f);await select(f);await until(()=>f.id('task-upload')&&!f.id('task-upload').disabled);}

test('only a current matching server capability enables upload and sends the displayed revision',async t=>{
 const f=fixture(t);await ready(f);assert.match(f.id('task-submission-access-message').textContent,/已核验/);f.click('task-upload');await until(()=>count(f,'chooseAndUpload')===1&&!f.id('task-upload').disabled);assert.deepEqual({...f.calls.find(call=>call.name==='chooseAndUpload').input},{teamId:'team-a',taskId:'task-a',revision:3});assert.equal(count(f,'getTaskSubmissionAccess'),2);assert.match(f.id('workspace-message').textContent,/已取消，未提交/);assert.equal(f.d.querySelectorAll('form').length,13);assert.equal(f.d.querySelectorAll('input[type=password]').length,19);
});
test('pending capability is visibly disabled even after global busy is released or a synthetic click',async t=>{
 const pending=deferred(),f=fixture(t,{getTaskSubmissionAccess:async()=>pending.promise});await login(f);await select(f);assert.equal(f.id('task-upload').disabled,true);assert.match(f.id('task-submission-access-message').textContent,/正在核验/);f.fire('task-upload');assert.equal(count(f,'chooseAndUpload'),0);pending.resolve(safe({canSubmit:true,revision:3}));await until(()=>!f.id('task-upload').disabled);
});
test('readable tasks do not imply submit permission for any audit role',async t=>{
 for(const role of ['intern','assistant','manager','partner']){const f=fixture(t,{login:async()=>safe({...SESSION,memberships:[{teamId:'team-a',role}]}),getTaskSubmissionAccess:async()=>safe({canSubmit:false,revision:3})});await login(f);await select(f);await until(()=>f.id('task-submission-access-message').textContent.includes('无本任务提交权限'));assert.equal(f.id('task-upload').disabled,true);f.fire('task-upload');assert.equal(count(f,'chooseAndUpload'),0);}
});
test('a legacy assigned manager can submit when the server explicitly grants permission',async t=>{
 const f=fixture(t,{login:async()=>safe({...SESSION,memberships:[{teamId:'team-a',role:'manager'}]})});await ready(f);f.click('task-upload');await until(()=>count(f,'chooseAndUpload')===1);assert.equal(f.id('role-label').textContent,'项目经理');
});
test('missing capability bridge fails closed without trying the native upload method',async t=>{
 const f=fixture(t,{getTaskSubmissionAccess:undefined});await login(f);await select(f);assert.equal(f.id('task-upload').disabled,true);assert.match(f.id('task-submission-access-message').textContent,/接口未更新/);f.fire('task-upload');assert.equal(count(f,'chooseAndUpload'),0);
});
test('capability errors and malformed values stay disabled with an explicit refresh instruction',async t=>{
 for(const response of [failure('HTTP_503','不可达'),safe({canSubmit:'true',revision:3}),safe({canSubmit:true,revision:-1}),safe({canSubmit:true,revision:3.5}),safe({canSubmit:true,revision:Number.MAX_SAFE_INTEGER})]){const f=fixture(t,{getTaskSubmissionAccess:async()=>response});if(response.value?.revision===Number.MAX_SAFE_INTEGER)f.tasks['task-a'].revision=Number.MAX_SAFE_INTEGER;await login(f);await select(f);await until(()=>f.id('task-submission-access-message').textContent.includes('无法核验'));assert.equal(f.id('task-upload').disabled,true);f.fire('task-upload');assert.equal(count(f,'chooseAndUpload'),0);}
});
test('permission at a different revision cannot replace the displayed history revision',async t=>{
 const f=fixture(t,{getTaskSubmissionAccess:async()=>safe({canSubmit:true,revision:4})});await login(f);await select(f);await until(()=>f.id('task-submission-access-message').textContent.includes('版本已变化'));assert.equal(f.id('task-upload').disabled,true);f.fire('task-upload');assert.equal(count(f,'chooseAndUpload'),0);
});
test('a late allowed capability for the prior task cannot enable the new task',async t=>{
 const pending=deferred(),f=fixture(t,{getTaskSubmissionAccess:async input=>input.taskId==='task-a'?pending.promise:safe({canSubmit:false,revision:7})});await login(f);await select(f);await select(f,'task-b');pending.resolve(safe({canSubmit:true,revision:3}));await settled();assert.equal(f.id('task-upload').disabled,true);assert.match(f.id('task-submission-access-message').textContent,/无本任务提交权限/);assert.match(f.id('task-detail').textContent,/合成要求B/);
});
test('team changes clear a previously granted capability before the new list resolves',async t=>{
 const pending=deferred();let reads=0;const f=fixture(t,{listTasks:async(_input,{tasks})=>++reads===1?safe({tasks:Object.values(tasks),hasMore:false}):pending.promise});await ready(f);f.id('team-select').value='team-b';f.fire('team-select','change');assert.equal(f.id('task-upload').disabled,true);f.fire('task-upload');assert.equal(count(f,'chooseAndUpload'),0);pending.resolve(safe({tasks:[f.tasks['task-a']],hasMore:false}));await until(()=>!f.id('refresh').disabled);assert.equal(f.id('task-upload'),null);
});
test('task list and login mode refreshes cannot reuse old permission while reading',async t=>{
 const pending=deferred();let reads=0;const f=fixture(t,{listTasks:async(_input,{tasks})=>++reads===1?safe({tasks:Object.values(tasks),hasMore:false}):pending.promise});await ready(f);f.fire('login-mode','change');assert.equal(f.id('task-upload').disabled,true);await select(f);await until(()=>!f.id('task-upload').disabled);f.click('refresh');assert.equal(f.id('task-upload').disabled,true);f.fire('task-upload');assert.equal(count(f,'chooseAndUpload'),0);pending.resolve(safe({tasks:[],hasMore:false}));await until(()=>f.id('task-upload')===null);
});
test('an old task capability 401 cannot clear a newly selected task',async t=>{
 const pending=deferred(),f=fixture(t,{getTaskSubmissionAccess:async input=>input.taskId==='task-a'?pending.promise:safe({canSubmit:true,revision:7})});await login(f);await select(f);await select(f,'task-b');await until(()=>!f.id('task-upload').disabled);pending.resolve(failure('SIGN_IN_REQUIRED','旧任务请求过期'));await settled();assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('task-upload').disabled,false);assert.match(f.id('task-detail').textContent,/合成要求B/);
});
test('late old-account capability errors cannot sign out a new login',async t=>{
 const pending=deferred();let logins=0,capabilities=0;const f=fixture(t,{login:async()=>safe(++logins===1?SESSION:OTHER),getTaskSubmissionAccess:async()=>++capabilities===1?pending.promise:safe({canSubmit:true,revision:3})});await login(f);await select(f);f.click('logout');await until(()=>!f.id('login-view').hidden);await ready(f);pending.resolve(failure('SIGN_IN_REQUIRED','旧账号失效'));await settled();assert.equal(f.id('account-name').textContent,OTHER.account.displayName);assert.equal(f.id('task-upload').disabled,false);
});
test('current capability 401 clears task data and leaves a usable sign-in form',async t=>{
 const f=fixture(t,{getTaskSubmissionAccess:async()=>failure('SIGN_IN_REQUIRED','当前登录失效')});await login(f);f.d.querySelector('.task-button').click();await until(()=>!f.id('login-view').hidden);assert.equal(f.id('task-upload'),null);assert.equal(f.id('task-detail').textContent,'');assert.equal(f.id('login-submit').disabled,false);
});
test('successful upload rereads task, history and capability before another upload',async t=>{
 const pending=deferred();let caps=0;const f=fixture(t,{getTaskSubmissionAccess:async(_input,{tasks})=>++caps===1?safe({canSubmit:true,revision:3}):pending.promise,chooseAndUpload:async(_input,{tasks})=>{tasks['task-a'].revision=4;tasks['task-a'].status='submitted';tasks['task-a'].canSubmit=false;return safe({revision:4});}});await ready(f);f.click('task-upload');await until(()=>caps===2);assert.equal(f.id('task-upload').disabled,true);assert.equal(count(f,'getTask'),2);assert.equal(count(f,'getSubmissions'),2);pending.resolve(safe({canSubmit:false,revision:4}));await until(()=>f.id('task-submission-access-message').textContent.includes('无本任务提交权限'));assert.equal(f.id('task-upload').disabled,true);assert.match(f.id('workspace-message').textContent,/资料已提交/);f.fire('task-upload');assert.equal(count(f,'chooseAndUpload'),1);
});
test('cancel refreshes permission and preserves the cancellation message if access was revoked',async t=>{
 let caps=0;const f=fixture(t,{getTaskSubmissionAccess:async()=>safe({canSubmit:++caps===1,revision:3})});await ready(f);f.click('task-upload');await until(()=>caps===2&&!f.id('refresh').disabled);assert.match(f.id('workspace-message').textContent,/已取消，未提交/);assert.equal(f.id('task-upload').disabled,true);assert.match(f.id('task-submission-access-message').textContent,/无本任务提交权限/);
});
test('an upload error requires a fresh capability and never retains the old allowed state',async t=>{
 const f=fixture(t,{chooseAndUpload:async()=>failure('HTTP_409','任务已更新，请刷新。')});await ready(f);f.click('task-upload');await until(()=>f.id('workspace-message').textContent.includes('任务已更新'));assert.equal(f.id('task-upload').disabled,true);f.fire('task-upload');assert.equal(count(f,'chooseAndUpload'),1);await select(f);await until(()=>!f.id('task-upload').disabled);
});
test('late prior-task upload failure cannot replace the new task message or release its busy state',async t=>{
 const upload=deferred(),read=deferred(),f=fixture(t,{chooseAndUpload:async()=>upload.promise,getTask:async(input,{tasks})=>input.taskId==='task-b'?read.promise:safe({task:tasks[input.taskId]})});await ready(f);f.click('task-upload');f.d.querySelectorAll('.task-button')[1].dispatchEvent(new f.window.Event('click'));await until(()=>count(f,'getTask')===2);upload.resolve(failure('HTTP_409','旧上传错误，不应出现'));await settled();assert.equal(f.id('refresh').disabled,true);assert.equal(f.id('workspace-message').textContent,'正在读取任务…');read.resolve(safe({task:f.tasks['task-b']}));await until(()=>!f.id('refresh').disabled);assert.match(f.id('task-detail').textContent,/合成要求B/);assert.ok(!f.id('workspace-message').textContent.includes('旧上传错误'));
});
test('late prior-task upload success does not reselect the former task or claim completion in the new view',async t=>{
 const pending=deferred(),f=fixture(t,{chooseAndUpload:async()=>pending.promise});await ready(f);f.click('task-upload');await select(f,'task-b');pending.resolve(safe({revision:4}));await settled();assert.match(f.id('task-detail').textContent,/合成要求B/);assert.equal(count(f,'getTask'),2);assert.ok(!f.id('workspace-message').textContent.includes('资料已提交'));
});
test('a pending upload keeps a single write lock across task changes, then releases only its own lock',async t=>{
 const pending=deferred(),f=fixture(t,{chooseAndUpload:async()=>pending.promise});f.tasks['task-b'].canSubmit=true;await ready(f);f.click('task-upload');await select(f,'task-b');assert.equal(f.id('task-upload').disabled,true);f.fire('task-upload');assert.equal(count(f,'chooseAndUpload'),1);pending.resolve(safe({canceled:true}));await until(()=>!f.id('task-upload').disabled);assert.match(f.id('task-detail').textContent,/合成要求B/);
});
test('late old-account upload 401 and finally cannot clear or unlock a newer account operation',async t=>{
 const oldUpload=deferred(),newUpload=deferred();let logins=0,uploads=0,expire=false;const f=fixture(t,{login:async()=>safe(++logins===1?SESSION:OTHER),listTasks:async(_input,{tasks})=>expire?(expire=false,failure('SIGN_IN_REQUIRED','当前登录已失效')):safe({tasks:Object.values(tasks),hasMore:false}),chooseAndUpload:async()=>++uploads===1?oldUpload.promise:newUpload.promise});await ready(f);f.click('task-upload');expire=true;f.fire('refresh');await until(()=>!f.id('login-view').hidden);await ready(f);f.click('task-upload');assert.equal(f.id('refresh').disabled,true);oldUpload.resolve(failure('SIGN_IN_REQUIRED','旧上传登录已失效'));await settled();assert.equal(f.id('account-name').textContent,OTHER.account.displayName);assert.equal(f.id('refresh').disabled,true);assert.equal(f.id('task-upload').disabled,true);newUpload.resolve(safe({canceled:true}));await until(()=>!f.id('refresh').disabled);assert.equal(f.id('task-upload').disabled,false);
});
function management(overrides={}){return {getTaskManagement:async(input,{tasks})=>safe({canManage:true,status:tasks[input.taskId].status,revision:tasks[input.taskId].revision,assignees:[],hasMoreAssignees:false}),listTaskAssignees:async()=>safe({members:[{id:'assistant-b',displayName:'合成可指派助理',role:'assistant'}],hasMore:false}),assignTask:async()=>safe({revision:4}),returnTask:async()=>safe({revision:4}),...overrides};}
test('a management write clears upload permission and holds the write lock until explicit refresh',async t=>{
 const pending=deferred(),f=fixture(t,management({assignTask:async()=>pending.promise}));await ready(f);await until(()=>f.id('task-management-member')&&!f.id('task-management-member').disabled);f.id('task-management-member').value='assistant-b';f.fire('task-management-member','change');f.click('task-management-assign');assert.equal(f.id('task-upload').disabled,true);f.fire('task-upload');assert.equal(count(f,'chooseAndUpload'),0);pending.resolve(failure('HTTP_409','分工已更新'));await until(()=>f.id('task-management-message').textContent.includes('重新读取后'));assert.equal(f.id('task-upload').disabled,true);f.click('task-management-refresh');await until(()=>!f.id('task-upload').disabled);assert.equal(count(f,'getTaskSubmissionAccess'),2);
});
test('management revision changes cannot silently replace the displayed history revision',async t=>{
 const f=fixture(t,management({getTaskManagement:async()=>safe({canManage:true,status:'open',revision:4,assignees:[],hasMoreAssignees:false})}));await login(f);await select(f);await until(()=>f.id('task-submission-access-message').textContent.includes('版本已变化'));assert.equal(f.id('task-upload').disabled,true);assert.equal(count(f,'getSubmissions'),1);f.fire('task-upload');assert.equal(count(f,'chooseAndUpload'),0);
});
test('a superseded capability 401 in the same task view cannot clear the refreshed permission',async t=>{
 const pending=deferred();let caps=0;const f=fixture(t,management({getTaskSubmissionAccess:async()=>++caps===1?pending.promise:safe({canSubmit:true,revision:3})}));await login(f);await select(f);await until(()=>f.id('task-management-refresh')&&!f.id('task-management-refresh').disabled);assert.equal(f.id('task-upload').disabled,true);f.click('task-management-refresh');await until(()=>caps===2&&!f.id('task-upload').disabled);pending.resolve(failure('SIGN_IN_REQUIRED','旧核验已过期'));await settled();assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('task-upload').disabled,false);
});
