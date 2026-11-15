'use strict';
const {withDeviceDiagnostic}=require('./helpers/desktop-device-diagnostic.cjs');
// Actual DOM plus narrow synthetic API; no real approver, SMS or team account.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/index.html'),'utf8'),script=fs.readFileSync(path.join(__dirname,'../desktop/team-ui/team-ui.js'),'utf8');
const SESSION={account:{id:'technical-admin',displayName:'合成管理员'},memberships:[],expiresAt:Date.now()+3600000};
const RECEIPT={requestId:'request-a',status:'pending',revision:1,expiresAt:Date.now()+300000};
const ROW={id:'request-a',teamId:'team-a',teamName:'合成团队',displayName:'合成员工',phoneMasked:'+8613****8000',targetKind:'employee',status:'pending',revision:1,createdAt:Date.now()-1000,expiresAt:Date.now()+300000};
const PROOF='a'.repeat(43),safe=value=>({ok:true,value}),fail=(code,message)=>({ok:false,error:{code,message}}),deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
const count=(f,name)=>f.calls.filter(c=>c.name===name).length;
async function until(check){for(let i=0;i<120;i++){if(check())return;await new Promise(r=>setTimeout(r,0));}assert.ok(check(),'renderer state not reached');}
function fixture(t,overrides={}){
 const dom=new JSDOM(html,{url:'shenyi://app/index.html',runScripts:'outside-only'}),{window}=dom,d=window.document,calls=[],writes=[];
 Object.defineProperty(window,'localStorage',{value:new Proxy({setItem:(...args)=>writes.push(args),getItem:()=>null,removeItem(){},clear(){}},{set:(_t,k,v)=>{writes.push([k,v]);return true;}})});
 const defaults={getAuthMethods:async()=>safe({mode:'local-preview',desktopWechatReady:false,methods:{demoUsername:true,phonePassword:true,phoneVerification:true,wechat:false,recovery:true}}),getOnboardingStatus:async()=>safe({available:false,invitationOnly:true}),getRecoveryReviewStatus:async()=>safe({reviewed:true,available:true}),createRecoveryReviewRequest:async()=>safe(RECEIPT),getRecoveryReviewAccess:async()=>safe({canReview:true}),listRecoveryReviewRequests:async()=>safe({requests:[ROW]}),reviewRecoveryReviewRequest:async input=>safe({request:{...ROW,status:input.decision==='approve'?'approved':input.decision==='reject'?'rejected':'revoked',revision:2},...(input.decision==='approve'?{recoveryProof:PROOF}:{})}),login:async()=>safe(SESSION),logout:async()=>safe({signedOut:true}),listTasks:async()=>safe({tasks:[],hasMore:false}),getInvitationAccess:async()=>safe({canInvite:false}),getTeamProvisioningAccess:async()=>safe({canReview:false}),getTeamAdministration:async()=>safe({teams:[]}),requestPasswordRecovery:async()=>safe({challengeId:'challenge-a',expiresAt:Date.now()+300000}),recoverPassword:async()=>safe({signedOut:true})};
 window.shenyiTeam=Object.fromEntries(Object.entries({...defaults,...overrides}).map(([name,fn])=>[name,typeof fn==='function'?async arg=>{calls.push({name,arg});return fn(arg);}:fn]));window.shenyiTeam=withDeviceDiagnostic(window.shenyiTeam);window.eval(script);t.after(()=>window.close());return {window,d,calls,writes,id:id=>d.getElementById(id),click:id=>d.getElementById(id).click(),input:id=>d.getElementById(id).dispatchEvent(new window.Event('input',{bubbles:true})),submit:id=>d.getElementById(id).dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}))};
}
async function openRecovery(f){await until(()=>count(f,'getAuthMethods'));f.id('recovery-panel').querySelector('summary').click();await until(()=>count(f,'getRecoveryReviewStatus')&&!f.id('recovery-send-code').disabled);}
async function challenge(f){await openRecovery(f);f.id('recovery-phone').value='13800138000';f.input('recovery-phone');f.click('recovery-send-code');await until(()=>!f.id('recovery-fields').disabled);f.id('recovery-code').value='123456';f.input('recovery-code');}
async function login(f){f.id('username').value='technical-admin';f.id('password').value='Current Secret!2026';f.submit('login-form');await until(()=>!f.id('workspace-view').hidden&&!f.id('logout').disabled);}
async function openReviews(f){await until(()=>!f.id('recovery-reviews-panel').hidden);f.id('recovery-reviews-panel').querySelector('summary').click();await until(()=>!f.id('recovery-reviews-password').disabled&&f.id('recovery-reviews-list').querySelector('li[data-request-id]'));}
function password(f,value='Current Secret!2026'){f.id('recovery-reviews-password').value=value;f.input('recovery-reviews-password');}
function decision(f,value){f.id('recovery-reviews-list').querySelector('[data-decision='+value+']').click();}

test('reviewed recovery submits only SMS challenge proof and displays a neutral pending receipt',async t=>{
 const f=fixture(t);await challenge(f);assert.equal(f.id('recovery-review-entry').hidden,false);f.click('recovery-review-request');await until(()=>f.id('recovery-review-receipt').textContent.includes('request-a'));assert.deepEqual({...f.calls.find(c=>c.name==='createRecoveryReviewRequest').arg},{challengeId:'challenge-a',code:'123456'});assert.match(f.id('recovery-review-receipt').textContent,/待审核/);assert.match(f.id('recovery-message').textContent,/密码尚未重设/);assert.equal(f.id('recovery-review-request').disabled,true);assert.equal(count(f,'recoverPassword'),0);assert.equal(f.d.body.textContent.includes('账号存在'),false);assert.deepEqual(f.writes,[]);
});
test('invalid SMS code or absent challenge cannot create an approval request',async t=>{
 const f=fixture(t);await openRecovery(f);f.click('recovery-review-request');assert.equal(count(f,'createRecoveryReviewRequest'),0);await challengeAfterOpen(f);for(const code of ['','12345x']){f.id('recovery-code').value=code;f.input('recovery-code');assert.equal(f.id('recovery-review-request').disabled,true);f.click('recovery-review-request');}assert.equal(count(f,'createRecoveryReviewRequest'),0);
});
async function challengeAfterOpen(f){f.id('recovery-phone').value='13800138000';f.click('recovery-send-code');await until(()=>!f.id('recovery-fields').disabled);}
test('external recovery mode hides approval submission while retaining the existing proof flow',async t=>{
 const f=fixture(t,{getRecoveryReviewStatus:async()=>safe({reviewed:false,available:false})});await challenge(f);assert.equal(f.id('recovery-review-entry').hidden,true);assert.equal(f.id('recovery-proof').disabled,false);assert.equal(count(f,'createRecoveryReviewRequest'),0);
});
test('an older bridge without approval methods remains compatible with external recovery',async t=>{
 const f=fixture(t,{getRecoveryReviewStatus:undefined,createRecoveryReviewRequest:undefined});await until(()=>count(f,'getAuthMethods'));f.id('recovery-panel').querySelector('summary').click();await until(()=>!f.id('recovery-send-code').disabled);await challengeAfterOpen(f);assert.equal(f.id('recovery-review-entry').hidden,true);assert.equal(f.id('recovery-proof').disabled,false);
});
test('missing SMS disables the whole recovery flow even when review mode exists',async t=>{
 const f=fixture(t,{getAuthMethods:async()=>safe({mode:'local-preview',methods:{demoUsername:true,phonePassword:true,phoneVerification:false,wechat:false,recovery:false}}),getRecoveryReviewStatus:async()=>safe({reviewed:true,available:false})});await until(()=>count(f,'getAuthMethods'));f.id('recovery-panel').querySelector('summary').click();await until(()=>count(f,'getRecoveryReviewStatus'));assert.equal(f.id('recovery-send-code').disabled,true);assert.equal(f.id('recovery-review-request').disabled,true);assert.equal(f.id('recovery-submit').disabled,true);
});
test('unknown review capability never pretends that requests can be accepted',async t=>{
 const f=fixture(t,{getRecoveryReviewStatus:async()=>fail('SERVICE_UNAVAILABLE','PRIVATE')});await challenge(f);assert.equal(f.id('recovery-review-request').disabled,true);assert.match(f.id('recovery-review-status').textContent,/暂无法确认/);assert.equal(f.d.body.textContent.includes('PRIVATE'),false);
});
test('a recovery request is single flight across close and reopen',async t=>{
 const pending=deferred(),f=fixture(t,{createRecoveryReviewRequest:()=>pending.promise});await challenge(f);f.click('recovery-review-request');await until(()=>count(f,'createRecoveryReviewRequest')===1);f.click('recovery-cancel');f.id('recovery-panel').querySelector('summary').click();await new Promise(r=>setTimeout(r,0));assert.equal(f.id('recovery-send-code').disabled,true);f.click('recovery-review-request');assert.equal(count(f,'createRecoveryReviewRequest'),1);pending.resolve(safe(RECEIPT));await until(()=>!f.id('recovery-send-code').disabled);assert.equal(f.id('recovery-review-receipt').textContent,'');assert.equal(f.id('recovery-fields').hidden,true);
});
test('request completion never inserts a receipt into a newer account',async t=>{
 const pending=deferred(),f=fixture(t,{createRecoveryReviewRequest:()=>pending.promise});await challenge(f);f.click('recovery-review-request');await until(()=>count(f,'createRecoveryReviewRequest'));await login(f);pending.resolve(safe(RECEIPT));await new Promise(r=>setTimeout(r,0));assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('recovery-review-receipt').textContent,'');assert.equal(f.id('recovery-message').textContent.includes('已收到'),false);
});
test('uncertain request result is not called a rejection and never automatically retried',async t=>{
 const f=fixture(t,{createRecoveryReviewRequest:async()=>fail('HTTP_503','PRIVATE')});await challenge(f);f.click('recovery-review-request');await until(()=>f.id('recovery-message').textContent.includes('未能确认'));assert.match(f.id('recovery-message').textContent,/可能已提交/);assert.equal(count(f,'createRecoveryReviewRequest'),1);assert.equal(f.d.body.textContent.includes('PRIVATE'),false);
});
test('phone changes and closing erase the approval receipt',async t=>{
 const f=fixture(t);await challenge(f);f.click('recovery-review-request');await until(()=>f.id('recovery-review-receipt').textContent);f.id('recovery-phone').value='13900139000';f.input('recovery-phone');assert.equal(f.id('recovery-review-receipt').textContent,'');assert.equal(f.id('recovery-fields').hidden,true);f.click('recovery-cancel');assert.equal(f.id('recovery-phone').value,'');
});
test('review access comes only from the API, never audit rank or membership presence',async t=>{
 for(const role of ['intern','assistant','manager','partner']){const f=fixture(t,{login:async()=>safe({...SESSION,memberships:[{teamId:'team-a',role}]}),getRecoveryReviewAccess:async()=>safe({canReview:false})});await login(f);await until(()=>count(f,'getRecoveryReviewAccess'));assert.equal(f.id('recovery-reviews-panel').hidden,true);assert.equal(count(f,'listRecoveryReviewRequests'),0);}
 const f=fixture(t);await login(f);await openReviews(f);assert.equal(f.id('recovery-reviews-panel').hidden,false);assert.equal(count(f,'listTasks'),0);assert.equal(f.id('role-label').textContent.includes('合伙人'),false);
});
test('review rows render minimal metadata as text and hide terminal or expired actions',async t=>{
 const rows=[{...ROW,displayName:'<img src=x onerror=alert(1)>'},...['rejected','revoked','consumed','expired'].map((status,i)=>({...ROW,id:'terminal-'+i,status})),{...ROW,id:'past',expiresAt:Date.now()-1}],f=fixture(t,{listRecoveryReviewRequests:async()=>safe({requests:rows})});await login(f);await openReviews(f);assert.equal(f.id('recovery-reviews-list').querySelector('img'),null);assert.equal(f.id('recovery-reviews-list').querySelectorAll('button').length,2);assert.equal(f.id('recovery-reviews-list').textContent.includes('<img'),true);assert.equal(f.id('recovery-reviews-list').textContent.includes('团队员工'),true);
});
test('a review requires the current password and Enter does not submit an action',async t=>{
 const f=fixture(t);await login(f);await openReviews(f);assert.equal(f.id('recovery-reviews-list').querySelector('button').disabled,true);password(f);const event=new f.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});f.id('recovery-reviews-password').dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(count(f,'reviewRecoveryReviewRequest'),0);
});
test('approval transmits exact revision and password and shows the one-time proof only from its response',async t=>{
 const f=fixture(t);await login(f);await openReviews(f);password(f,'  Exact Current Secret!2026  ');decision(f,'approve');await until(()=>!f.id('issued-recovery-proof').hidden);assert.deepEqual({...f.calls.find(c=>c.name==='reviewRecoveryReviewRequest').arg},{requestId:ROW.id,decision:'approve',revision:1,currentPassword:'  Exact Current Secret!2026  '});assert.equal(f.id('issued-recovery-value').value,PROOF);assert.equal(f.id('recovery-reviews-password').value,'');assert.match(f.id('recovery-reviews-message').textContent,/密码尚未重设/);assert.deepEqual(f.writes,[]);assert.equal(f.d.querySelectorAll('form').length,10);assert.equal(f.d.querySelectorAll('input[type=password]').length,17);
});
test('reject and revoke never display an accidental upstream recovery proof',async t=>{
 for(const decisionName of ['reject','revoke']){const f=fixture(t,{listRecoveryReviewRequests:async()=>safe({requests:[{...ROW,status:decisionName==='revoke'?'approved':'pending'}]}),reviewRecoveryReviewRequest:async()=>safe({request:{...ROW,status:'revoked',revision:2},recoveryProof:PROOF})});await login(f);await openReviews(f);password(f);decision(f,decisionName);await until(()=>count(f,'reviewRecoveryReviewRequest')===1&&f.id('recovery-reviews-password').value==='');assert.equal(f.id('issued-recovery-proof').hidden,true);assert.equal(f.id('issued-recovery-value').value,'');}
});
test('wrong review password clears proof and allows a considered retry',async t=>{
 const f=fixture(t,{reviewRecoveryReviewRequest:async()=>fail('HTTP_403','当前密码验证未通过。')});await login(f);await openReviews(f);password(f);decision(f,'approve');await until(()=>f.id('recovery-reviews-message').textContent.includes('验证未通过'));assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('recovery-reviews-password').value,'');password(f);decision(f,'approve');await until(()=>count(f,'reviewRecoveryReviewRequest')===2);
});
test('closing clears approval proof, rows and password immediately',async t=>{
 const f=fixture(t);await login(f);await openReviews(f);password(f);decision(f,'approve');await until(()=>!f.id('issued-recovery-proof').hidden);f.id('recovery-reviews-panel').querySelector('summary').click();assert.equal(f.id('issued-recovery-value').value,'');assert.equal(f.id('recovery-reviews-password').value,'');assert.equal(f.id('recovery-reviews-list').children.length,0);
});
test('review mutation stays single flight across panel close and does not restore a closed proof',async t=>{
 const pending=deferred(),f=fixture(t,{reviewRecoveryReviewRequest:()=>pending.promise});await login(f);await openReviews(f);password(f);decision(f,'approve');await until(()=>count(f,'reviewRecoveryReviewRequest')===1);f.id('recovery-reviews-panel').querySelector('summary').click();f.id('recovery-reviews-panel').querySelector('summary').click();await new Promise(r=>setTimeout(r,0));assert.equal(f.id('recovery-reviews-password').disabled,true);pending.resolve(safe({request:{...ROW,status:'approved',revision:2},recoveryProof:PROOF}));await until(()=>!f.id('recovery-reviews-password').disabled);assert.equal(count(f,'reviewRecoveryReviewRequest'),1);assert.equal(f.id('issued-recovery-value').value,'');
});
test('a late approval or late 401 cannot reveal proof or sign out a newer login',async t=>{
 for(const result of [safe({request:{...ROW,status:'approved',revision:2},recoveryProof:PROOF}),fail('SIGN_IN_REQUIRED','OLD_LOGIN')]){const pending=deferred(),f=fixture(t,{reviewRecoveryReviewRequest:()=>pending.promise});await login(f);await openReviews(f);password(f);decision(f,'approve');await until(()=>count(f,'reviewRecoveryReviewRequest')===1);f.click('logout');await until(()=>f.id('workspace-view').hidden&&!f.id('login-submit').disabled);await login(f);pending.resolve(result);await new Promise(r=>setTimeout(r,0));assert.equal(f.id('workspace-view').hidden,false);assert.equal(f.id('issued-recovery-value').value,'');assert.equal(f.d.body.textContent.includes('OLD_LOGIN'),false);}
});
test('unknown review outcome is shown as uncertain without fake rollback or retry',async t=>{
 const f=fixture(t,{reviewRecoveryReviewRequest:async()=>fail('HTTP_503','PRIVATE')});await login(f);await openReviews(f);password(f);decision(f,'approve');await until(()=>f.id('recovery-reviews-message').textContent.includes('未能确认'));assert.match(f.id('recovery-reviews-message').textContent,/可能已完成/);assert.equal(count(f,'reviewRecoveryReviewRequest'),1);assert.equal(f.d.body.textContent.includes('PRIVATE'),false);
});
test('a confirmed review followed by refresh failure never claims it was rolled back',async t=>{
 let pages=0;const f=fixture(t,{listRecoveryReviewRequests:async()=>++pages>2?fail('SERVICE_UNAVAILABLE','refresh failed'):safe({requests:[ROW]})});await login(f);await openReviews(f);password(f);decision(f,'approve');await until(()=>f.id('recovery-reviews-message').textContent.includes('已完成'));assert.match(f.id('recovery-reviews-message').textContent,/刷新无法确认/);assert.equal(f.id('issued-recovery-value').value,PROOF);
});
test('queued opening preserves a just-entered review password',async t=>{
 const f=fixture(t);await login(f);await until(()=>!f.id('recovery-reviews-panel').hidden);f.id('recovery-reviews-panel').querySelector('summary').click();f.id('recovery-reviews-password').value='Immediately typed secret';await new Promise(r=>setTimeout(r,0));assert.equal(f.id('recovery-reviews-password').value,'Immediately typed secret');
});
test('logout and unload clear the reviewer secret and one-time response',async t=>{
 const f=fixture(t);await login(f);await openReviews(f);password(f);decision(f,'approve');await until(()=>!f.id('issued-recovery-proof').hidden);f.window.dispatchEvent(new f.window.Event('beforeunload'));assert.equal(f.id('issued-recovery-value').value,'');assert.equal(f.id('recovery-reviews-password').value,'');assert.equal(f.id('recovery-reviews-panel').open,false);assert.deepEqual(f.writes,[]);
});
