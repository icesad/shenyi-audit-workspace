'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/index.html'),'utf8');
const code=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/team-ui.js'),'utf8');
const session={account:{id:'user-a',displayName:'旧账号机密姓名'},memberships:[{teamId:'team-a',role:'intern'}],expiresAt:1794717600000};
const task={id:'task-a',title:'仅此账号可见的合成任务',instructions:'仅此账号可见的资料要求',status:'open'};
async function waitFor(check){for(let i=0;i<50;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,0));}assert.ok(check(),'renderer did not reach expected state');}
function create(t,bridge){const dom=new JSDOM(html,{url:'shenyi://app/index.html',runScripts:'outside-only'});dom.window.shenyiTeam=bridge;dom.window.eval(code);t.after(()=>dom.window.close());return dom.window;}
function signIn(window){window.document.getElementById('username').value='intern-a';window.document.getElementById('password').value='ShenyiDemo!2026';window.document.getElementById('login-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));}
const ok=value=>({ok:true,value});
test('revoked session refresh clears old DOM, unlocks login controls and allows a fresh login',async t=>{
  let revoked=false,loginCount=0;
  const window=create(t,{login:async()=>{loginCount++;revoked=false;return ok(session);},listTasks:async()=>revoked?{ok:false,error:{code:'SIGN_IN_REQUIRED',message:'登录已失效。'}}:ok({tasks:[task],hasMore:false}),getTask:async()=>ok({task}),getSubmissions:async()=>ok({revision:0,submissions:[]}),logout:async()=>ok({signedOut:true})});
  const d=window.document;signIn(window);await waitFor(()=>d.querySelector('.task-button')&&!d.getElementById('refresh').disabled);d.querySelector('.task-button').click();await waitFor(()=>d.getElementById('task-detail').textContent.includes(task.instructions));
  assert.equal(d.getElementById('account-name').textContent,session.account.displayName);revoked=true;d.getElementById('refresh').click();await waitFor(()=>!d.getElementById('login-view').hidden);
  for(const id of ['username','password','login-submit'])assert.equal(d.getElementById(id).disabled,false,id+' must remain usable');
  assert.equal(d.getElementById('account-name').textContent,'');assert.equal(d.getElementById('role-label').textContent,'');assert.equal(d.getElementById('team-select').options.length,0);assert.equal(d.getElementById('task-list').children.length,0);assert.ok(!d.body.textContent.includes(task.instructions));assert.ok(!d.body.textContent.includes(session.account.displayName));
  signIn(window);await waitFor(()=>!d.getElementById('workspace-view').hidden&&d.querySelector('.task-button'));assert.equal(loginCount,2);assert.equal(d.getElementById('username').disabled,false);
});
test('task names and instructions are displayed as text rather than executable markup',async t=>{
  const unsafe={...task,title:'<img id="untrusted-node" src="x" onerror="alert(1)">',instructions:'<script>window.injected=true</script>'};
  const window=create(t,{login:async()=>ok(session),listTasks:async()=>ok({tasks:[unsafe],hasMore:false}),getTask:async()=>ok({task:unsafe}),getSubmissions:async()=>ok({revision:0,submissions:[]})});signIn(window);await waitFor(()=>window.document.querySelector('.task-button')&&!window.document.getElementById('refresh').disabled);window.document.querySelector('.task-button').click();await waitFor(()=>window.document.getElementById('task-detail').textContent.includes(unsafe.instructions));assert.equal(window.document.getElementById('untrusted-node'),null);assert.equal(window.injected,undefined);assert.ok(window.document.getElementById('task-detail').textContent.includes(unsafe.title));
});
