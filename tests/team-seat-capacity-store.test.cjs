'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{pathToFileURL}=require('node:url'),{DatabaseSync}=require('node:sqlite'),{createHash,randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),load=name=>import(pathToFileURL(path.join(root,'server/team',name)).href),api=load('seat-capacity-store.mjs');
const AT=Date.parse('2026-11-18T00:00:00.000Z'),END=AT+10000,MAX=Number.MAX_SAFE_INTEGER,sha=v=>createHash('sha256').update(v).digest('hex');
const invalid=e=>e?.status===400&&e.code==='INVALID_INPUT',conflict=e=>e?.status===409&&e.code==='SEAT_CAPACITY_CONFLICT',notFound=e=>e?.status===404&&e.code==='NOT_FOUND';
const input=(extra={})=>({grantId:randomUUID(),teamId:'team-a',seats:5,startsAt:AT,endsAt:END,sourceRef:'synthetic-internal-capacity',...extra});
function grants(db){const s=db.prepare('SELECT * FROM team_seat_capacity_grants ORDER BY grant_id');s.setReadBigInts(true);return s.all();}
function pending(db){return['team_invitations','team_employee_invitations','team_operator_employee_invitations'].map(name=>({name,rows:db.prepare('SELECT * FROM '+name+' ORDER BY token_hash').all()}));}
async function memory(t){const {initializeTeamDatabase}=await load('database.mjs'),db=new DatabaseSync(':memory:');initializeTeamDatabase(db);db.exec("INSERT INTO teams VALUES ('team-a','active'),('team-b','active'),('team-off','disabled')");t.after(()=>db.close());return db;}
function members(db){
 for(const team of ['a','b'])for(const role of ['intern','assistant','manager','partner']){const id=role+'-'+team;db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);db.prepare("INSERT INTO team_memberships VALUES (?,?,?,'active')").run('team-'+team,id,role);}
 for(const suffix of ['a','b']){const id='operator-'+suffix;db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);db.prepare("INSERT INTO team_operators VALUES (?,?,'administrator','active')").run('team-'+suffix,id);}
}
function invite(db,source,id,{team='team-a',expires=END,accepted=null,revoked=null,inviter}={}){
 const suffix=team==='team-a'?'a':'b';inviter??=(source==='operator'?'operator-':'manager-')+suffix;const token=sha(source+':'+id),role='intern';
 if(source==='legacy')db.prepare('INSERT INTO team_invitations(token_hash,team_id,username,role,invited_by,expires_at,accepted_at) VALUES (?,?,?,?,?,?,?)').run(token,team,'synthetic-'+id,role,inviter,expires,accepted);
 else db.prepare('INSERT INTO '+(source==='employee'?'team_employee_invitations':'team_operator_employee_invitations')+'(invitation_id,token_hash,team_id,phone,role,invited_by,created_at,expires_at,revoked_at,accepted_at,accepted_by) VALUES (?,?,?,?,?,?,?,?,?,?,NULL)').run(id,token,team,'+8613800000000',role,inviter,AT-1,expires,revoked,accepted);
 return token;
}

test('fresh capacity has no implicit purchase and a frozen minimal view still reports existing overage',async t=>{
 const db=await memory(t),s=await api;assert.deepEqual(s.readSeatCapacity(db,'team-a',AT),{purchasedSeats:0,activeBusinessSeats:0,reservedInvitationSeats:0,usedSeats:0,availableSeats:0});members(db);invite(db,'legacy','old-unexpired');
 const before=pending(db),view=s.readSeatCapacity(db,'team-a',AT);assert.deepEqual(view,{purchasedSeats:0,activeBusinessSeats:4,reservedInvitationSeats:1,usedSeats:5,availableSeats:0});assert.equal(Object.isFrozen(view),true);assert.equal(typeof view.then,'undefined');assert.deepEqual(Object.keys(view),['purchasedSeats','activeBusinessSeats','reservedInvitationSeats','usedSeats','availableSeats']);assert.doesNotMatch(JSON.stringify(view),/phone|username|token|invited|sourceRef|grantId/);assert.deepEqual(pending(db),before);
});

test('live grants add only over explicit half-open intervals and never renew implicitly',async t=>{
 const db=await memory(t),s=await api,first=input({seats:3}),second=input({seats:7,startsAt:AT+1,endsAt:END+1});const a=s.recordSeatCapacityGrant(db,first,{now:()=>AT-2}),b=s.recordSeatCapacityGrant(db,second,{now:()=>AT-1});assert.equal(Object.isFrozen(a),true);assert.equal(a.recordedAt,AT-2);assert.equal(b.recordedAt,AT-1);
 for(const [at,count]of [[AT-1,0],[AT,3],[AT+1,10],[END-1,10],[END,7],[END+1,0]])assert.equal(s.readSeatCapacity(db,'team-a',at).purchasedSeats,count);
 const row=grants(db).find(x=>x.grant_id===first.grantId);assert.equal(row.request_sha256,sha(JSON.stringify(first)));assert.deepEqual(a,{grantId:first.grantId,teamId:'team-a',seats:3,startsAt:AT,endsAt:END,recordedAt:AT-2,sourceRef:first.sourceRef});
});

test('semantic key-order replay returns the immutable original receipt and changed replay cannot publish another fact',async t=>{
 const db=await memory(t),s=await api,v=input(),receipt=s.recordSeatCapacityGrant(db,v,{now:()=>AT}),before=grants(db),reordered=Object.fromEntries(Object.entries(v).reverse());assert.deepEqual(s.recordSeatCapacityGrant(db,reordered,{now:()=>AT+999}),receipt);assert.deepEqual(grants(db),before);
 for(const patch of [{teamId:'team-b'},{seats:6},{startsAt:AT-1},{endsAt:END+1},{sourceRef:'other-source'}])assert.throws(()=>s.recordSeatCapacityGrant(db,{...v,...patch},{now:()=>AT}),conflict);assert.deepEqual(grants(db),before);
});

test('unexpired outstanding invitations from all three old tables reserve independently until accepted/revoked/exact expiry',async t=>{
 const db=await memory(t),s=await api;members(db);const sameId=randomUUID();for(const kind of ['legacy','employee','operator']){invite(db,kind,sameId);invite(db,kind,kind+'-expired',{expires:AT-1});invite(db,kind,kind+'-exact',{expires:AT});invite(db,kind,kind+'-accepted',{accepted:AT});if(kind!=='legacy')invite(db,kind,kind+'-revoked',{revoked:AT});invite(db,kind,kind+'-foreign',{team:'team-b'});}
 const before=pending(db);assert.equal(s.readSeatCapacity(db,'team-a',AT).reservedInvitationSeats,3);assert.equal(s.readSeatCapacity(db,'team-b',AT).reservedInvitationSeats,3);assert.equal(s.readSeatCapacity(db,'team-a',AT-1).reservedInvitationSeats,6);assert.equal(s.readSeatCapacity(db,'team-a',END).reservedInvitationSeats,0);assert.deepEqual(pending(db),before);
});

test('pending holds survive inviter eligibility loss and restoration without inventing capacity or member authority',async t=>{
 const db=await memory(t),s=await api;members(db);for(const kind of ['legacy','employee','operator'])invite(db,kind,kind+'-hold');const before=pending(db);
 db.exec("UPDATE team_memberships SET status='disabled' WHERE user_id='manager-a'; UPDATE team_operators SET status='revoked' WHERE user_id='operator-a'");let view=s.readSeatCapacity(db,'team-a',AT);assert.equal(view.activeBusinessSeats,3);assert.equal(view.reservedInvitationSeats,3);assert.equal(view.usedSeats,6);
 db.exec("UPDATE team_memberships SET status='active' WHERE user_id='manager-a'; UPDATE team_operators SET status='active' WHERE user_id='operator-a'");view=s.readSeatCapacity(db,'team-a',AT);assert.equal(view.activeBusinessSeats,4);assert.equal(view.reservedInvitationSeats,3);assert.equal(view.usedSeats,7);assert.deepEqual(pending(db),before);
});

test('an accepted reservation converts to an enabled business seat without double counting',async t=>{
 const db=await memory(t),s=await api;members(db);const token=invite(db,'legacy','conversion');s.recordSeatCapacityGrant(db,input({seats:6}),{now:()=>AT});const before=s.readSeatCapacity(db,'team-a',AT);assert.equal(before.usedSeats,5);assert.equal(before.availableSeats,1);
 db.exec('BEGIN IMMEDIATE');db.exec("INSERT INTO team_users VALUES ('new-employee','active'); INSERT INTO team_memberships VALUES ('team-a','new-employee','intern','active')");db.prepare('UPDATE team_invitations SET accepted_at=? WHERE token_hash=?').run(AT,token);const during=s.readSeatCapacity(db,'team-a',AT);assert.equal(db.isTransaction,true);assert.equal(during.activeBusinessSeats,5);assert.equal(during.reservedInvitationSeats,0);assert.equal(during.usedSeats,before.usedSeats);db.exec('ROLLBACK');assert.deepEqual(s.readSeatCapacity(db,'team-a',AT),before);
});

test('member/account/team state and ordinary four roles reuse the original seat eligibility policy',async t=>{
 const db=await memory(t),s=await api;members(db);s.recordSeatCapacityGrant(db,input({seats:10}),{now:()=>AT});assert.equal(s.readSeatCapacity(db,'team-a',AT).activeBusinessSeats,4);assert.equal(s.readSeatCapacity(db,'team-b',AT).activeBusinessSeats,4);
 db.exec("UPDATE team_memberships SET status='disabled' WHERE user_id='intern-a'; UPDATE team_users SET status='disabled' WHERE user_id='assistant-a'");assert.equal(s.readSeatCapacity(db,'team-a',AT).activeBusinessSeats,2);assert.equal(s.readSeatCapacity(db,'team-b',AT).activeBusinessSeats,4);
 const before=grants(db);for(const team of ['missing-team','team-off']){assert.throws(()=>s.readSeatCapacity(db,team,AT),notFound);assert.throws(()=>s.recordSeatCapacityGrant(db,input({teamId:team}),{now:()=>AT}),notFound);}assert.deepEqual(grants(db),before);
});

test('real administrator approval counts one combined seat while pure technical and unreviewed administrators count zero',async t=>{
 const {createAdministratorBusinessRoleFixture,OWNER,ADMIN}=require('./helpers/administrator-business-role-fixture.cjs'),f=await createAdministratorBusinessRoleFixture(t),s=await api;assert.equal(s.readSeatCapacity(f.db,'team-a',f.clock.value).activeBusinessSeats,4);f.addAdministrator('capacity-unreviewed-admin',{role:'manager'});assert.equal(s.readSeatCapacity(f.db,'team-a',f.clock.value).activeBusinessSeats,4);
 const owner=await f.ready(OWNER);assert.equal((await f.approve(owner,ADMIN,'assistant')).status,200);assert.equal(s.readSeatCapacity(f.db,'team-a',f.clock.value).activeBusinessSeats,5);assert.equal((await f.approve(owner,ADMIN,'partner')).status,200);assert.equal(s.readSeatCapacity(f.db,'team-a',f.clock.value).activeBusinessSeats,5);
});

test('capacity record/read preserve all old tables and explicit safe millisecond endpoints require no Date coercion',async t=>{
 const db=await memory(t),s=await api;members(db);invite(db,'employee','preserved');const old=()=>db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'team_seat_capacity_grants' ORDER BY name").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM '+name).all()}));const before=old();
 const v=input({seats:MAX,startsAt:MAX-2,endsAt:MAX}),r=s.recordSeatCapacityGrant(db,v,{now:()=>MAX-1});assert.equal(r.recordedAt,MAX-1);assert.equal(s.readSeatCapacity(db,'team-a',MAX-1).purchasedSeats,MAX);assert.equal(s.readSeatCapacity(db,'team-a',MAX).purchasedSeats,0);assert.deepEqual(old(),before);
});

test('safe additive sums never round and overflow fails closed only where the live intervals overlap',async t=>{
 const db=await memory(t),s=await api;s.recordSeatCapacityGrant(db,input({seats:MAX}),{now:()=>AT});assert.equal(s.readSeatCapacity(db,'team-a',AT).purchasedSeats,MAX);
 s.recordSeatCapacityGrant(db,input({seats:1,startsAt:END,endsAt:END+1}),{now:()=>AT});assert.equal(s.readSeatCapacity(db,'team-a',AT).purchasedSeats,MAX);assert.equal(s.readSeatCapacity(db,'team-a',END).purchasedSeats,1);
 s.recordSeatCapacityGrant(db,input({seats:1}),{now:()=>AT});assert.throws(()=>s.readSeatCapacity(db,'team-a',AT),conflict);assert.equal(s.readSeatCapacity(db,'team-a',END).purchasedSeats,1);assert.equal(s.readSeatCapacity(db,'team-b',AT).purchasedSeats,0);
});

test('passive exact grant inputs reject getters, proxies, hooks and unknown server-clock fields without executing them',async t=>{
 const db=await memory(t),s=await api;let calls=0;const getter=input();Object.defineProperty(getter,'seats',{enumerable:true,get(){calls++;return 5;}});const hook=input();Object.defineProperty(hook,'toJSON',{get(){calls++;return()=>input();}});const hidden=input();Object.defineProperty(hidden,'endsAt',{value:END,enumerable:false});
 const proxy=new Proxy(input(),{getPrototypeOf(){calls++;return Object.prototype;},ownKeys(){calls++;return[];}}),revoked=Proxy.revocable(input(),{});revoked.revoke();
 const variants=[getter,hook,hidden,proxy,revoked.proxy,Object.assign(Object.create(null),input()),Object.assign(Object.create({toJSON(){calls++;return{};}}),input()),input({recordedAt:AT}),input({extra:true}),input({[Symbol('extra')]:1}),input({seats:{valueOf(){calls++;return 5;}}}),input({sourceRef:{toString(){calls++;return'opaque';}}})];
 for(const value of variants)assert.throws(()=>s.recordSeatCapacityGrant(db,value,{now:()=>AT}),invalid);assert.equal(calls,0);assert.deepEqual(grants(db),[]);
});

test('invalid primitive fields and asynchronous or coercible server clocks cannot publish a capacity fact',async t=>{
 const db=await memory(t),s=await api;let calls=0;for(const patch of [{grantId:'ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF'},{grantId:randomUUID()+'\n'},{teamId:'team-a\n'},{seats:0},{seats:-0},{seats:1.5},{seats:'5'},{seats:1n},{seats:MAX+1},{startsAt:-1},{startsAt:new Date(AT)},{endsAt:AT},{endsAt:AT-1},{endsAt:MAX+1},{sourceRef:''},{sourceRef:'\n'},{sourceRef:'x\u200b'},{sourceRef:'\ud800'},{sourceRef:'😀'.repeat(129)}])assert.throws(()=>s.recordSeatCapacityGrant(db,input(patch),{now:()=>AT}),invalid);
 for(const clock of [NaN,Infinity,-1,-0,MAX+1,Promise.resolve(AT),{valueOf(){calls++;return AT;}}])assert.throws(()=>s.recordSeatCapacityGrant(db,input(),{now:()=>clock}),conflict);assert.equal(calls,0);assert.throws(()=>s.recordSeatCapacityGrant(db,input(),{now:AT}),invalid);
 for(const at of [-1,-0,NaN,Infinity,MAX+1,'0',1n,new Date(AT),{valueOf(){calls++;return AT;}}])assert.throws(()=>s.readSeatCapacity(db,'team-a',at),invalid);assert.equal(calls,0);assert.deepEqual(grants(db),[]);
 const ref='😀'.repeat(128),r=s.recordSeatCapacityGrant(db,input({sourceRef:ref}),{now:()=>AT});assert.equal(r.sourceRef,ref);
});

test('record rejects nested transactions without rolling back or committing the caller, while read stays inside them',async t=>{
 const db=await memory(t),s=await api;db.exec("BEGIN IMMEDIATE; INSERT INTO team_users VALUES ('caller-owned','active')");assert.throws(()=>s.recordSeatCapacityGrant(db,input(),{now:()=>AT}),conflict);assert.equal(db.isTransaction,true);assert.ok(db.prepare("SELECT 1 FROM team_users WHERE user_id='caller-owned'").get());assert.equal(s.readSeatCapacity(db,'team-a',AT).usedSeats,0);assert.equal(db.isTransaction,true);db.exec('ROLLBACK');assert.equal(db.prepare("SELECT 1 FROM team_users WHERE user_id='caller-owned'").get(),undefined);assert.deepEqual(grants(db),[]);
});

test('a final active-team failure rolls back an already inserted grant and its triggering side effects',async t=>{
 const db=await memory(t),s=await api,v=input();db.exec("CREATE TRIGGER synthetic_capacity_team_disable AFTER INSERT ON team_seat_capacity_grants BEGIN UPDATE teams SET status='disabled' WHERE team_id=NEW.team_id; END");assert.throws(()=>s.recordSeatCapacityGrant(db,v,{now:()=>AT}),notFound);assert.deepEqual(grants(db),[]);assert.equal(db.prepare("SELECT status FROM teams WHERE team_id='team-a'").get().status,'active');assert.equal(db.isTransaction,false);db.exec('DROP TRIGGER synthetic_capacity_team_disable');assert.equal(s.recordSeatCapacityGrant(db,v,{now:()=>AT}).grantId,v.grantId);
});

test('SQLite UPDATE DELETE and REPLACE cannot rewrite immutable facts or bypass semantic replay',async t=>{
 const db=await memory(t),s=await api,v=input();s.recordSeatCapacityGrant(db,v,{now:()=>AT});const before=grants(db);for(const sql of ['UPDATE team_seat_capacity_grants SET seats=seats','DELETE FROM team_seat_capacity_grants','INSERT OR REPLACE INTO team_seat_capacity_grants SELECT * FROM team_seat_capacity_grants']){assert.throws(()=>db.exec(sql),/SEAT_CAPACITY_GRANTS_IMMUTABLE/);assert.deepEqual(grants(db),before);}
});

test('damaged historical or scheduled digests fail closed, including replay and reads already inside caller transactions',async t=>{
 const db=await memory(t),s=await api,v=input();s.recordSeatCapacityGrant(db,v,{now:()=>AT});db.exec('DROP TRIGGER seat_capacity_grants_no_update');db.prepare('UPDATE team_seat_capacity_grants SET request_sha256=? WHERE grant_id=?').run('0'.repeat(64),v.grantId);const before=grants(db);
 for(const at of [AT-1,AT,END])assert.throws(()=>s.readSeatCapacity(db,'team-a',at),conflict);assert.throws(()=>s.recordSeatCapacityGrant(db,v,{now:()=>AT}),conflict);assert.deepEqual(grants(db),before);
 db.exec("BEGIN IMMEDIATE; INSERT INTO team_users VALUES ('caller-retained','active')");assert.throws(()=>s.readSeatCapacity(db,'team-a',AT),conflict);assert.equal(db.isTransaction,true);assert.ok(db.prepare("SELECT 1 FROM team_users WHERE user_id='caller-retained'").get());db.exec('ROLLBACK');assert.deepEqual(grants(db),before);
});

test('typed stored values reject unsafe integer and metadata corruption even if a matching digest is supplied',async t=>{
 for(const patch of [{column:'seats',value:MAX+1,request:{seats:MAX+1}},{column:'recorded_at',value:-1,request:{}},{column:'source_ref',value:'bad\nref',request:{sourceRef:'bad\nref'}}]){
  const db=await memory(t),s=await api,v=input();s.recordSeatCapacityGrant(db,v,{now:()=>AT});db.exec('DROP TRIGGER seat_capacity_grants_no_update; PRAGMA ignore_check_constraints=ON');db.prepare('UPDATE team_seat_capacity_grants SET '+patch.column+'=?,request_sha256=? WHERE grant_id=?').run(patch.value,sha(JSON.stringify({...v,...patch.request})),v.grantId);db.exec('PRAGMA ignore_check_constraints=OFF');assert.throws(()=>s.readSeatCapacity(db,'team-a',AT),conflict);
 }
});

test('actual SQLite close/reopen and a second connection preserve grant bytes and idempotence',async t=>{
 const parent=path.resolve(process.env.SHENYI_TEST_TMPDIR??os.tmpdir());fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'seat-capacity-store-')),filename=path.join(directory,'synthetic.sqlite'),handles=[],{initializeTeamDatabase}=await load('database.mjs'),s=await api;
 const open=()=>{const db=new DatabaseSync(filename),entry={db,closed:false,close(){if(!entry.closed){db.close();entry.closed=true;}}};handles.push(entry);initializeTeamDatabase(db);db.exec("INSERT OR IGNORE INTO teams VALUES ('team-a','active'),('team-b','active')");return entry;};
 t.after(()=>{for(const h of handles.reverse())h.close();assert.ok(path.resolve(directory).startsWith(parent+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 const a=open(),v=input(),receipt=s.recordSeatCapacityGrant(a.db,v,{now:()=>AT}),before=grants(a.db);a.close();const b=open(),c=open();assert.deepEqual(grants(b.db),before);assert.deepEqual(s.recordSeatCapacityGrant(c.db,{...v},{now:()=>AT+1}),receipt);assert.deepEqual(grants(b.db),before);assert.equal(s.readSeatCapacity(b.db,'team-a',AT).purchasedSeats,5);assert.equal(b.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(b.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
