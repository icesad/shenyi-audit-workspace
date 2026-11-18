'use strict';
// Actual signed application dispatch and fresh SQLite. Billing-disabled calls
// establish existing authority; policy assertions use team-management-v1.
const {test,after}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createLedgerFixture,PASSWORD,restorePasswordWork}=require('./helpers/ledger-check-fixture.cjs');
const {source}=require('./helpers/workspace-formalization-security-fixture.cjs');
after(restorePasswordWork);
const modules={
 materials:{tail:'materials',table:'team_material_grants',events:'team_material_events',keys:['read','import','review','close'],initial:{read:true,import:true,review:false,close:false},increase:{read:true,import:false,review:true,close:false},none:{read:false,import:false,review:false,close:false}},
 ledger:{tail:'ledger-checks',table:'team_ledger_check_grants',events:'team_ledger_check_events',keys:['read'],initial:{read:true},increase:{read:true},none:{read:false}},
 workpapers:{tail:'workpapers',table:'team_workpaper_access_grants',events:'team_workpaper_access_events',keys:['read','write','export'],initial:{read:true,write:false,export:true},increase:{read:false,write:true,export:false},none:{read:false,write:false,export:false}}
};
const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
function unavailable(r){assert.equal(r.status,402,JSON.stringify(r.data));assert.equal(r.data.error.code,'SUBSCRIPTION_WRITE_UNAVAILABLE');assert.deepEqual(Object.keys(r.data),['error']);}
function conflict(r){assert.equal(r.status,409,JSON.stringify(r.data));assert.equal(r.data.error.code,'SUBSCRIPTION_CONFLICT');}
function snapshot(f){
 const names=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(x=>x.name).filter(n=>/^team_(material_|ledger_check_|workpaper_access_|workpaper_data_|project_access_projects$)/.test(n));
 return names.map(name=>({name,rows:f.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()}));
}
async function fixture(t,module){
 const f=await createLedgerFixture(t),m=modules[module],route=f.projectRoute()+'/'+m.tail,app=await source('application-api.mjs'),store=await source('subscription-store.mjs');
 const api=async(path,settings={},mode='team-management-v1')=>{const response=await app.handleTeamApplicationRequest(f.makeRequest(path,{session:f.actor,...settings}),{db:f.db,now:()=>f.clock.value,identityProviders:{deviceProofRequired:true},subscriptionEnforcement:mode}),bytes=Buffer.from(await response.arrayBuffer());return{status:response.status,headers:response.headers,data:bytes.length?JSON.parse(bytes):null};};
 const row=(user='partner-a')=>f.db.prepare('SELECT * FROM '+m.table+' WHERE team_id=? AND project_id=? AND user_id=?').get('team-a',f.projectId,user);
 const maintenance=(user='partner-a')=>f.db.prepare('SELECT * FROM team_material_maintenance_grants WHERE team_id=? AND project_id=? AND user_id=?').get('team-a',f.projectId,user);
 const body=(flags=m.initial,{user='partner-a',legacy=false,...extra}={})=>({projectRevision:f.revision(),userId:user,memberRevision:f.epoch(user),grantRevision:row(user)?.revision??0,...Object.fromEntries(m.keys.map(k=>[k,false])),...(module==='materials'&&!legacy?{maintenanceRevision:maintenance(user)?.revision??0,maintain:false}:{}),...flags,currentPassword:PASSWORD,...extra});
 const grant=(flags=m.initial,{mode='team-management-v1',session=f.actor,body:input,...settings}={})=>api(route+'/access',{method:'POST',session,body:input??body(flags,settings)},mode);
 const term=(fields={})=>store.recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:f.db.prepare("SELECT revision FROM team_subscription_heads WHERE team_id='team-a'").get()?.revision??0,startsAt:f.clock.value-100,endsAt:f.clock.value+10000,sourceRef:'synthetic-module-management',...fields},{now:()=>f.clock.value});
 const count=()=>f.db.prepare('SELECT COUNT(*) n FROM '+m.events).get().n;
 return{...f,m,module,route,api,row,maintenance,body,grant,term,count};
}

test('workpapers: new dormant flags are additions, but retaining an eligible dormant export while removing write is pure revocation',async t=>{
 for(const state of ['unconfigured','expired']){
  const f=await fixture(t,'workpapers');ok(await f.grant({read:true,write:false,export:false},{mode:'disabled'}));if(state==='expired')f.term({endsAt:f.clock.value});let before=snapshot(f);
  unavailable(await f.grant({read:false,write:false,export:true}));unavailable(await f.grant({read:false,write:true,export:false}));assert.deepEqual(snapshot(f),before);
  ok(await f.grant({read:false,write:true,export:true},{mode:'disabled'}));assert.equal(f.row().eligible,1);assert.equal(f.row().can_read,0);
  ok(await f.grant({read:false,write:false,export:true}));assert.equal(f.row().can_write,0);assert.equal(f.row().can_export,1);assert.equal(f.row().can_read,0);assert.equal(f.row().eligible,1);
  before=snapshot(f);unavailable(await f.grant({read:false,write:true,export:true}));unavailable(await f.grant({read:true,write:false,export:true}));assert.deepEqual(snapshot(f),before);
 }
});

test('materials: pinned maintenance is independent, stale readRevision needs renewal, and true subsets retain or withdraw maintenance',async t=>{
 const f=await fixture(t,'materials'),initial={read:true,import:true,review:false,close:false,maintain:true};ok(await f.grant(initial,{mode:'disabled'}));assert.equal(f.maintenance().can_maintain,1);assert.equal(f.maintenance().read_grant_revision,f.row().revision);f.term({endsAt:f.clock.value});
 // Atomically retaining existing maintenance while removing import adds nothing.
 ok(await f.grant({...initial,import:false}));assert.equal(f.maintenance().eligible,1);assert.equal(f.maintenance().read_grant_revision,f.row().revision);
 // The normal legacy path changes a read-generation and latches maintenance off.
 const flags={read:true,import:false,review:true,close:false};ok(await f.grant(flags,{legacy:true,mode:'disabled'}));assert.equal(f.maintenance().can_maintain,1);assert.equal(f.maintenance().eligible,0);assert.notEqual(f.maintenance().read_grant_revision,f.row().revision);const before=snapshot(f);
 unavailable(await f.grant({...flags,maintain:true}));assert.deepEqual(snapshot(f),before);
 const renewed=f.term();ok(await f.grant({...flags,maintain:true}));assert.equal(f.maintenance().eligible,1);assert.equal(f.maintenance().read_grant_revision,f.row().revision);
 f.clock.value=renewed.endsAt;ok(await f.grant({...flags,maintain:false}));assert.equal(f.maintenance().can_maintain,0);
});

test('materials: a standalone maintenance addition cannot use unchanged read to bypass an unconfigured subscription',async t=>{
 const f=await fixture(t,'materials'),flags={read:true,import:false,review:false,close:false};ok(await f.grant(flags,{mode:'disabled'}));const before=snapshot(f);unavailable(await f.grant({...flags,maintain:true}));assert.deepEqual(snapshot(f),before);f.term();ok(await f.grant({...flags,maintain:true}));assert.equal(f.maintenance().eligible,1);assert.equal(f.maintenance().can_maintain,1);
});
function expireAtAudit(f,endsAt){let reached=0;f.db.function('synthetic_module_subscription_expiry',()=>{reached++;f.clock.value=endsAt;return 1;});f.db.exec('CREATE TRIGGER synthetic_module_subscription_expiry AFTER INSERT ON '+f.m.events+' BEGIN SELECT synthetic_module_subscription_expiry(); END');return()=>assert.equal(reached,1);}

for(const module of Object.keys(modules)){
 test(module+': active independent authority grants publish once without altering sibling modules',async t=>{
  const f=await fixture(t,module),before=snapshot(f);f.term();const prior=f.count(),result=ok(await f.grant());assert.equal(result.changed,true);assert.equal(f.count(),prior+1);const row=f.row();assert.equal(row.eligible,1);for(const key of f.m.keys)assert.equal(row['can_'+key],Number(f.m.initial[key]));
  const after=snapshot(f),allow=new Set([f.m.table,f.m.events,...(module==='materials'?['team_project_access_projects']:[])]);assert.deepEqual(after.filter(x=>!allow.has(x.name)),before.filter(x=>!allow.has(x.name)));
 });
 test(module+': unconfigured, scheduled and expired additions publish no authority or audit rows',async t=>{
  const f=await fixture(t,module),before=snapshot(f);unavailable(await f.grant());f.term({startsAt:f.clock.value+100,endsAt:f.clock.value+200});unavailable(await f.grant());f.clock.value+=200;unavailable(await f.grant());assert.deepEqual(snapshot(f),before);
 });
 test(module+': pure revocation works unconfigured and expired; mixed independent increases still require renewal',async t=>{
  const f=await fixture(t,module);ok(await f.grant(f.m.initial,{mode:'disabled'}));ok(await f.grant(f.m.none));for(const k of f.m.keys)assert.equal(f.row()['can_'+k],0);
  ok(await f.grant(f.m.initial,{mode:'disabled'}));f.term({endsAt:f.clock.value});const before=snapshot(f);
  if(module!=='ledger'){unavailable(await f.grant(f.m.increase));assert.deepEqual(snapshot(f),before);}
  ok(await f.grant(f.m.none));assert.equal(f.row().eligible,1);for(const k of f.m.keys)assert.equal(f.row()['can_'+k],0);
 });
 test(module+': a role-latched eligible-zero SQL bit cannot be revived for free',async t=>{
  const f=await fixture(t,module);ok(await f.grant(f.m.initial,{mode:'disabled'}));f.roleABA('partner-a');assert.equal(f.row().eligible,0);assert.equal(f.row().can_read,1);const before=snapshot(f);unavailable(await f.grant());f.term({endsAt:f.clock.value});unavailable(await f.grant());assert.deepEqual(snapshot(f),before);
 });
 test(module+': actual KDF cannot outlive expiry or changed terms, while pure revocation ignores subscription changes',async t=>{
  for(const change of ['expiry','revision','revoke-revision']){const f=await fixture(t,module);if(change==='revoke-revision')ok(await f.grant(f.m.initial,{mode:'disabled'}));const term=f.term(),before=snapshot(f),hold=f.passwordHold(),pending=f.grant(change==='revoke-revision'?f.m.none:f.m.initial);await hold.entered.promise;
   if(change==='expiry')f.clock.value=term.endsAt;else f.term({endsAt:term.endsAt+1000});hold.release.resolve();const result=await pending;
   if(change==='revoke-revision'){ok(result);for(const k of f.m.keys)assert.equal(f.row()['can_'+k],0);}else{change==='expiry'?unavailable(result):conflict(result);assert.deepEqual(snapshot(f),before);}
  }
 });
 test(module+': expiry after the final real audit INSERT rolls back additions but never blocks a pure revoke',async t=>{
  const f=await fixture(t,module),term=f.term(),before=snapshot(f),reached=expireAtAudit(f,term.endsAt);unavailable(await f.grant());reached();assert.deepEqual(snapshot(f),before);
  f.db.exec('DROP TRIGGER synthetic_module_subscription_expiry');ok(await f.grant(f.m.initial,{mode:'disabled'}));const calls=f.count();ok(await f.grant(f.m.none));assert.equal(f.count(),calls+1);for(const k of f.m.keys)assert.equal(f.row()['can_'+k],0);
 });
 test(module+': owner, target, CAS, role and team checks still precede subscription admission',async t=>{
  const f=await fixture(t,module),before=snapshot(f);const stale=f.body(f.m.initial,{grantRevision:1});assert.equal((await f.grant(undefined,{body:stale})).status,409);
  assert.equal((await f.grant(undefined,{body:f.body(f.m.initial,{currentPassword:3})})).status,400);
  for(const user of ['intern-a','administrator-demo','manager-b','partner-a']){const session=await f.ready(user);assert.equal((await f.grant(undefined,{session})).status,404);}
  assert.equal((await f.grant(undefined,{user:'manager-b'})).status,404);assert.deepEqual(snapshot(f),before);
 });
}
