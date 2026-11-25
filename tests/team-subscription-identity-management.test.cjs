'use strict';
const {test:nodeTest,after}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{syncBuiltinESMExports}=require('node:module');
const test=(name,run)=>nodeTest(name,{timeout:60000},run),deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
// Preserve genuine native scrypt; hold only its already-computed callback result.
const nativeScrypt=crypto.scrypt;let nextHold;
crypto.scrypt=function(...args){const callback=args.pop(),hold=nextHold;nextHold=undefined;return nativeScrypt(...args,(error,value)=>{if(!hold)return callback(error,value);hold.entered.resolve();void hold.release.promise.then(()=>callback(error,value));});};syncBuiltinESMExports();after(()=>{crypto.scrypt=nativeScrypt;syncBuiltinESMExports();});
const {identityFixture,PASSWORD,PHONE,OWNER,ADMIN,source}=require('./helpers/subscription-identity-management-fixture.cjs');
const kinds=['ordinary-role','administrator-role','legacy-create','legacy-accept','employee-create','challenge','activate'];
const unavailable=result=>{assert.equal(result.status,402,JSON.stringify(result.data));assert.equal(result.data.error.code,'SUBSCRIPTION_WRITE_UNAVAILABLE');};
for(const kind of kinds)test(kind+' active term permits its original valid mutation',async t=>{const f=await identityFixture(t,kind);f.term();const before=f.business(),r=await f.run(f.operation);assert.equal(r.status,f.operation.status,JSON.stringify(r));if(kind==='challenge')assert.equal(f.usableChallenges(),1);else assert.notDeepEqual(f.business(),before);});
for(const state of ['missing','expired','scheduled'])for(const kind of kinds)test(kind+' '+state+' term publishes no identity or invitation business change',async t=>{
 const f=await identityFixture(t,kind);if(state==='expired')f.term({startsAt:f.clock.value-1000,endsAt:f.clock.value});if(state==='scheduled')f.term({startsAt:f.clock.value+1,endsAt:f.clock.value+10000});
 const before=f.business(),usable=f.usableChallenges(),sends=f.sent.length;unavailable(await f.run(f.operation));assert.deepEqual(f.business(),before);assert.equal(f.usableChallenges(),usable);assert.equal(f.sent.length,sends);
});
for(const kind of kinds)test(kind+' body held until expiry cannot publish',async t=>{
 const f=await identityFixture(t,kind),term=f.term(),before=f.business(),entered=deferred(),release=deferred(),bytes=Buffer.from(JSON.stringify(f.operation.body));let pulls=0;
 const stream=new ReadableStream({pull(controller){if(pulls++===0){controller.enqueue(bytes.subarray(0,1));return;}entered.resolve();return release.promise.then(()=>{controller.enqueue(bytes.subarray(1));controller.close();});}});t.after(()=>release.resolve());
 const raw=f.makeRequest(f.operation.route,{method:'POST',session:f.operation.actor,body:f.operation.body,bodyStream:stream}),pending=f.run(f.operation,{raw});await entered.promise;f.clock.value=term.endsAt;release.resolve();unavailable(await pending);assert.deepEqual(f.business(),before);
});
for(const change of ['expiry','revision'])for(const spec of [['ordinary-role',false],['administrator-role',false],['activate',false],['activate',true]])test(spec[0]+(spec[1]?' existing credential':'')+' real KDF rechecks '+change,async t=>{
 const f=await identityFixture(t,spec[0],{existing:spec[1]}),term=f.term(),before=f.business(),hold={entered:deferred(),release:deferred()};assert.equal(nextHold,undefined);nextHold=hold;t.after(()=>{nextHold=undefined;hold.release.resolve();});
 const pending=f.run(f.operation);await hold.entered.promise;if(change==='expiry')f.clock.value=term.endsAt;else f.term({expectedRevision:1,startsAt:term.startsAt,endsAt:term.endsAt+1000});hold.release.resolve();const r=await pending;
 if(change==='expiry')unavailable(r);else{assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.data.error.code,'SUBSCRIPTION_CONFLICT');}assert.deepEqual(f.business(),before);
});
for(const change of ['expiry','revision'])test('fake SMS completing after '+change+' never publishes a usable challenge and preserves the error',async t=>{
 const f=await identityFixture(t,'challenge'),term=f.term(),before=f.business(),hold={entered:deferred(),release:deferred()};f.smsState.hold=hold;t.after(()=>hold.release.resolve());
 const pending=f.run(f.operation);await hold.entered.promise;if(change==='expiry')f.clock.value=term.endsAt;else f.term({expectedRevision:1,startsAt:term.startsAt,endsAt:term.endsAt+1000});hold.release.resolve();const r=await pending;
 if(change==='expiry')unavailable(r);else{assert.equal(r.status,409,JSON.stringify(r));assert.equal(r.data.error.code,'SUBSCRIPTION_CONFLICT');}assert.equal(f.usableChallenges(),0);assert.equal(f.sent.length,1);assert.equal(f.db.prepare('SELECT delivery_state FROM team_employee_activation_challenges').get().delivery_state,'failed');assert.deepEqual(f.business(),before);
});
for(const kind of kinds)test(kind+' expiry at its real final SQL rolls back prior business writes',async t=>{
 const f=await identityFixture(t,kind),term=f.term(),before=f.business(),prepare=f.db.prepare.bind(f.db);let reached=0;
 t.mock.method(f.db,'prepare',function(sql,...args){const s=prepare(sql,...args);if(sql.includes(f.operation.marker)){const run=s.run.bind(s);s.run=(...values)=>{const r=run(...values);reached++;f.clock.value=term.endsAt;return r;};}return s;});
 unavailable(await f.run(f.operation));assert.equal(reached,1,'actual SQL marker must execute');assert.deepEqual(f.business(),before);if(kind==='challenge')assert.equal(f.usableChallenges(),0);
});
for(const kind of kinds)test(kind+' active term cannot grant missing role, foreign-team identity or invalid invitation ownership',async t=>{
 const f=await identityFixture(t,kind);f.term();
 if(['challenge','activate'].includes(kind)){const before=f.business(),r=await f.run({...f.operation,body:{...f.operation.body,phone:'+8613800000099'}});assert.equal(r.status,404,JSON.stringify(r));assert.deepEqual(f.business(),before);return;}
 for(const user of ['intern-b','manager-b']){const actor=await f.ready(user),before=f.business(),r=await f.run({...f.operation,actor});assert.equal(r.status,404,user+JSON.stringify(r));assert.deepEqual(f.business(),before);}
});
for(const mode of ['business-data-v1','workspace-create-v1'])for(const kind of kinds)test(kind+' retains the old '+mode+' management scope with no term',async t=>{const f=await identityFixture(t,kind),r=await f.run(f.operation,{mode});assert.equal(r.status,f.operation.status,JSON.stringify(r));});
test('employee invitation revoke and preview preserve their original expired-term rules',async t=>{
 const f=await identityFixture(t,'preview');f.term({startsAt:f.clock.value-1000,endsAt:f.clock.value});const before=f.business();assert.equal((await f.run(f.operation)).status,200);assert.deepEqual(f.business(),before);
 const r=await f.run({route:'/api/teams/team-a/employee-invitations/'+f.invite.invitationId+'/revoke',actor:f.actor,body:{}});assert.equal(r.status,200,JSON.stringify(r));assert.ok(f.db.prepare('SELECT revoked_at FROM team_employee_invitations').get().revoked_at!==null);assert.equal(f.usableChallenges(),0);
});
test('administrator role=null revocation does not even read the expired subscription ledger',async t=>{
 const f=await identityFixture(t,'administrator-role');assert.equal((await f.run(f.operation,{mode:'disabled'})).status,200);f.term({startsAt:f.clock.value-1000,endsAt:f.clock.value});
 const {constants}=require('node:sqlite');let reads=0;f.db.setAuthorizer((action,table)=>{if(action===constants.SQLITE_READ&&['team_subscription_heads','team_subscription_events'].includes(table)){reads++;return constants.SQLITE_DENY;}return constants.SQLITE_OK;});
 try{const r=await f.run({...f.operation,body:{...f.operation.body,revision:f.epoch(ADMIN),role:null}});assert.equal(r.status,200,JSON.stringify(r));assert.equal(reads,0);assert.equal(f.db.prepare('SELECT status FROM team_memberships WHERE user_id=?').get(ADMIN).status,'disabled');}finally{f.db.setAuthorizer(null);}
});
test('expired ordinary member and technical administrator disable keep original safety authority',async t=>{
 for(const [target,kind,who]of [['intern-a','business-members',ADMIN],[ADMIN,'administrators','access-reviewer-demo']]){const f=await identityFixture(t,'employee-create');f.term({startsAt:f.clock.value-1000,endsAt:f.clock.value});const actor=await f.ready(who),r=await f.run({route:'/api/teams/team-a/'+kind+'/'+target+'/disable',actor,body:{revision:f.epoch(target),currentPassword:PASSWORD}});assert.equal(r.status,200,JSON.stringify(r));assert.equal(f.db.prepare('SELECT status FROM team_users WHERE user_id=?').get(target).status,'disabled');}
});
test('ordinary same-role no-op and administrator role no-op preserve original conflict before subscription',async t=>{
 const ordinary=await identityFixture(t,'ordinary-role'),r=await ordinary.run({...ordinary.operation,body:{...ordinary.operation.body,role:'intern'}});assert.equal(r.status,409);assert.equal(r.data.error.code,'BUSINESS_ROLE_CONFLICT');
 const admin=await identityFixture(t,'administrator-role');assert.equal((await admin.run(admin.operation,{mode:'disabled'})).status,200);const noOp=await admin.run({...admin.operation,body:{...admin.operation.body,revision:admin.epoch(ADMIN)}});assert.equal(noOp.status,409);assert.equal(noOp.data.error.code,'ADMINISTRATOR_BUSINESS_ROLE_CONFLICT');
});
test('administrator nonnull restoration and ordinary role reductions still need an active term',async t=>{
 const f=await identityFixture(t,'administrator-role');assert.equal((await f.run(f.operation,{mode:'disabled'})).status,200);assert.equal((await f.run({...f.operation,body:{...f.operation.body,revision:f.epoch(ADMIN),role:null}})).status,200);const before=f.business();unavailable(await f.run({...f.operation,body:{...f.operation.body,revision:f.epoch(ADMIN)}}));assert.deepEqual(f.business(),before);
 const lower=await identityFixture(t,'ordinary-role');lower.db.prepare("UPDATE team_memberships SET role='manager' WHERE user_id='intern-a'").run();const lowerBefore=lower.business();unavailable(await lower.run({...lower.operation,body:{...lower.operation.body,revision:lower.epoch('intern-a'),role:'intern'}}));assert.deepEqual(lower.business(),lowerBefore);
});
test('technical operator employee invitations use the same active term gate',async t=>{for(const active of [false,true]){const f=await identityFixture(t,'employee-create',{operator:true});if(active)f.term();const before=f.business(),r=await f.run(f.operation);if(active){assert.equal(r.status,201,JSON.stringify(r));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM team_operator_employee_invitations').get().n,1);}else{unavailable(r);assert.deepEqual(f.business(),before);}}});
test('expiry immediately before fake SMS send keeps its technical failure row without sending',async t=>{
 const f=await identityFixture(t,'challenge'),term=f.term(),before=f.business(),prepare=f.db.prepare.bind(f.db);let reached=0;
 t.mock.method(f.db,'prepare',function(sql,...args){const s=prepare(sql,...args);if(sql.startsWith('INSERT INTO team_employee_activation_challenges(')){const run=s.run.bind(s);s.run=(...values)=>{const r=run(...values);reached++;f.clock.value=term.endsAt;return r;};}return s;});
 unavailable(await f.run(f.operation));assert.equal(reached,1);assert.equal(f.sent.length,0);assert.equal(f.usableChallenges(),0);assert.equal(f.db.prepare('SELECT delivery_state FROM team_employee_activation_challenges').get().delivery_state,'failed');assert.deepEqual(f.business(),before);
});
test('operator-source challenge and activation enforce the same missing versus active term policy',async t=>{
 for(const kind of ['challenge','activate'])for(const active of [false,true]){const f=await identityFixture(t,kind,{operator:true});if(active)f.term();const before=f.business(),r=await f.run(f.operation);if(active)assert.equal(r.status,f.operation.status,JSON.stringify(r));else{unavailable(r);assert.deepEqual(f.business(),before);}}
});
test('expired subscription preserves genuine password change and old-session revocation',async t=>{
 const f=await identityFixture(t,'employee-create');f.term({startsAt:f.clock.value-1000,endsAt:f.clock.value});const actor=await f.ready('intern-a'),newPassword='SyntheticChangedSafely!2026';
 const r=await f.run({route:'/api/auth/password',actor,body:{currentPassword:PASSWORD,newPassword}});assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.signedOut,true);
 const stale=await f.run({route:'/api/auth/session',actor,method:'GET'});assert.equal(stale.status,401);const login=await f.run({route:'/api/auth/login',body:{username:'intern-a',password:newPassword}});assert.equal(login.status,200,JSON.stringify(login));
});
test('expired subscription preserves original device replacement request approval and activation',async t=>{
 const f=await identityFixture(t,'employee-create');f.term({startsAt:f.clock.value-1000,endsAt:f.clock.value});const actor=await f.ready('intern-a'),admin=await f.ready(ADMIN),{keyPair}=require('./helpers/business-role-fixture.cjs'),pair=keyPair(),replacement=require('../shared/device-replacement-proof.cjs');
 const challenge=await f.run({route:'/api/auth/device-replacements/request-challenges',actor,body:{publicKey:pair.encoded,displayName:'Synthetic expired replacement',platform:'darwin',currentPassword:PASSWORD}});assert.equal(challenge.status,201,JSON.stringify(challenge));
 const sign=fields=>crypto.sign(null,replacement.replacementChallengeBytes(fields),pair.privateKey).toString('base64url');
 const requested=await f.run({route:'/api/auth/device-replacements/request',actor,body:{challengeId:challenge.data.challenge.challengeId,signature:sign(challenge.data.challenge)}});assert.equal(requested.status,201,JSON.stringify(requested));
 const approved=await f.run({route:'/api/account/device-replacement-reviews/'+requested.data.request.id+'/review',actor:admin,body:{revision:requested.data.request.revision,decision:'approve',currentPassword:PASSWORD}});assert.equal(approved.status,200,JSON.stringify(approved));
 const activation=await f.run({route:'/api/auth/device-replacements/activate-challenges',actor,body:{requestId:approved.data.request.id,revision:approved.data.request.revision,publicKey:pair.encoded}});assert.equal(activation.status,201,JSON.stringify(activation));
 const activated=await f.run({route:'/api/auth/device-replacements/activate',actor,body:{challengeId:activation.data.challenge.challengeId,signature:sign(activation.data.challenge)}});assert.equal(activated.status,200,JSON.stringify(activated));assert.equal(f.db.prepare("SELECT public_key FROM team_device_bindings WHERE user_id='intern-a' AND status='active'").get().public_key,pair.encoded);
});
test('expired subscription preserves fake-SMS recovery request original review and genuine password reset',async t=>{
 const f=await identityFixture(t,'employee-create');f.term({startsAt:f.clock.value-1000,endsAt:f.clock.value});f.providers.reviewedRecovery=true;f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('intern-a',PHONE,f.clock.value-1);const admin=await f.ready(ADMIN);
 const challenge=await f.run({route:'/api/auth/phone/challenges',body:{phone:PHONE,purpose:'reset'}});assert.equal(challenge.status,202,JSON.stringify(challenge));const sms=f.sent.at(-1);
 const request=await f.run({route:'/api/auth/recovery-requests',body:{challengeId:challenge.data.challengeId,code:sms.code}});assert.equal(request.status,201,JSON.stringify(request));
 const approval=await f.run({route:'/api/account/recovery-reviews/'+request.data.requestId+'/review',actor:admin,body:{decision:'approve',revision:request.data.revision,currentPassword:PASSWORD}});assert.equal(approval.status,200,JSON.stringify(approval));
 const newPassword='SyntheticRecoveredSafely!2026',reset=await f.run({route:'/api/auth/phone/reset',body:{challengeId:challenge.data.challengeId,code:sms.code,newPassword,recoveryProof:approval.data.recoveryProof}});assert.equal(reset.status,200,JSON.stringify(reset));
 const login=await f.run({route:'/api/auth/phone/login',body:{phone:PHONE,password:newPassword}});assert.equal(login.status,200,JSON.stringify(login));assert.equal(login.data.account.id,'intern-a');
});
