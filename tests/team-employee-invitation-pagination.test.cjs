'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite'),{createHash,randomBytes}=require('node:crypto');
const {pathToFileURL}=require('node:url'),path=require('node:path');
const load=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const ORIGIN='https://invitation-pagination.synthetic.invalid',BASE='/api/teams/team-a/employee-invitations',NOW=Date.parse('2026-11-18T01:00:00Z');
const hash=value=>createHash('sha256').update(value).digest('hex'),cursor=tuple=>Buffer.from(JSON.stringify(tuple)).toString('base64url');
const SOURCES=[['business','team_employee_invitations','manager-a'],['operator','team_operator_employee_invitations','operator-a']];
let encoded;
async function fixture(t){
 const {initializeTeamDatabase}=await load('database.mjs'),{hashPassword}=await load('passwords.mjs'),{handleTeamApplicationRequest}=await load('application-api.mjs');
 encoded??=hashPassword('SyntheticPagination!2026');const passwordHash=await encoded;
 const db=new DatabaseSync(':memory:');initializeTeamDatabase(db);t.after(()=>db.close());
 const f={db,now:NOW,tokens:{},route:BASE};
 for(const team of ['team-a','team-b'])db.prepare("INSERT INTO teams VALUES (?,'active')").run(team);
 for(const [id,team,role] of [['manager-a','team-a','manager'],['manager-other','team-a','partner'],['operator-a','team-a',null],['intern-a','team-a','intern'],['manager-b','team-b','manager']]){
  db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);
  db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(id,id,id,passwordHash);
  if(role){db.prepare("INSERT INTO team_memberships VALUES (?,?,?,'active')").run(team,id,role);if(role!=='intern')db.prepare("INSERT INTO team_admin_grants VALUES (?,?,'member.invite','active')").run(team,id);}
  else db.prepare("INSERT INTO team_operators VALUES (?,?,'administrator','active')").run(team,id);
  const token=randomBytes(32).toString('base64url');f.tokens[id]=token;db.prepare('INSERT INTO team_sessions VALUES (?,?,?,NULL)').run(hash(token),id,f.now+48*60*60000);
 }
 f.call=async(route=BASE,{method='GET',body,user='manager-a',db:usedDb=db}={})=>{
  const response=await handleTeamApplicationRequest(new Request(ORIGIN+route,{method,headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+f.tokens[user]}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{db:usedDb,now:()=>f.now});
  const raw=await response.text();assert.match(response.headers.get('cache-control'),/private.*no-store/);assert.equal(response.headers.get('access-control-allow-origin'),null);return {status:response.status,data:JSON.parse(raw),raw};
 };
 f.create=async(i,user='manager-a')=>{const phone='+86'+(13800010000+i),r=await f.call(BASE,{method:'POST',user,body:{phone,role:i%2?'assistant':'intern'}});assert.equal(r.status,201,r.raw);return {...r.data,phone,user};};
 f.insert=(source,id,at=NOW,offset=0)=>{
  const [name,table,inviter]=SOURCES.find(x=>x[0]===source),phone='+86'+(13900010000+offset);
  db.prepare('INSERT INTO '+table+'(invitation_id,token_hash,team_id,phone,role,invited_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)').run(id,hash(name+':'+id),'team-a',phone,'intern',inviter,at,NOW+24*60*60000);return {name,table,id,phone};
 };
 f.expected=()=>db.prepare("SELECT * FROM (SELECT invitation_id,phone,role,team_id,expires_at,created_at,'business' AS source FROM team_employee_invitations WHERE team_id='team-a' UNION ALL SELECT invitation_id,phone,role,team_id,expires_at,created_at,'operator' AS source FROM team_operator_employee_invitations WHERE team_id='team-a') ORDER BY created_at DESC,invitation_id COLLATE BINARY DESC,source COLLATE BINARY DESC").all();
 f.digest=()=>hash(JSON.stringify(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'"').all().map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,ArrayBuffer.isView(v)?Buffer.from(v).toString('hex'):v]))).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0)])));
 return f;
}
function good(r){assert.equal(r.status,200,r.raw);assert.deepEqual(Object.keys(r.data).sort(),['invitations','nextCursor']);return r.data;}
function publicRow(row,status='pending'){return {invitationId:row.invitation_id,teamId:row.team_id,role:row.role,phoneMasked:row.phone.slice(0,5)+'****'+row.phone.slice(-4),expiresAt:row.expires_at,status};}
async function traverse(f,{limit=50,user='manager-a'}={}){
 const invitations=[],pages=[],positions=new Set();let after=null;
 do{const page=good(await f.call(BASE+'?limit='+limit+(after?'&after='+after:''),{user}));pages.push(page);invitations.push(...page.invitations);after=page.nextCursor;if(after){assert.equal(typeof after,'string');assert.ok(after.length<=1024);assert.equal(positions.has(after),false);positions.add(after);}assert.ok(pages.length<200);}while(after);
 return {invitations,pages};
}

test('61 API-created invitations across both sources expose the old pending ticket and permit its existing revoke action',async t=>{
 const f=await fixture(t),issued=[];
 for(let i=0;i<61;i++){if(i&&i%20===0)f.now+=15*60000+1;f.now++;issued.push(await f.create(i,i%2?'operator-a':'manager-a'));}
 const before=f.digest(),expected=f.expected(),{invitations,pages}=await traverse(f);
 assert.deepEqual(pages.map(p=>p.invitations.length),[50,11]);assert.deepEqual(invitations,expected.map(r=>publicRow(r)));assert.equal(f.digest(),before);
 const oldest=issued[0];assert.ok(!pages[0].invitations.some(x=>x.invitationId===oldest.invitationId));assert.ok(pages[1].invitations.some(x=>x.invitationId===oldest.invitationId&&x.status==='pending'));
 assert.equal((await f.call(BASE+'/'+oldest.invitationId+'/revoke',{method:'POST',body:{}})).status,200);
 assert.equal(f.db.prepare('SELECT revoked_at FROM team_employee_invitations WHERE invitation_id=?').get(oldest.invitationId).revoked_at,f.now);
 const refresh=await traverse(f);assert.equal(refresh.invitations.find(x=>x.invitationId===oldest.invitationId).status,'revoked');
});
test('130 equal-time rows including same IDs in both sources cross 50/100 boundaries without dedup, omissions or unstable ordering',async t=>{
 const f=await fixture(t);
 for(let i=0;i<65;i++)for(const [si,[source]] of SOURCES.entries())f.insert(source,'tie-'+String(i).padStart(3,'0'),NOW,si*1000+i);
 const before=f.digest(),expected=f.expected(),all=await traverse(f);
 assert.deepEqual(all.pages.map(p=>p.invitations.length),[50,50,30]);assert.deepEqual(all.invitations,expected.map(r=>publicRow(r)));assert.equal(all.invitations.length,130);assert.equal(new Set(all.invitations.map(x=>x.invitationId)).size,65);assert.equal(f.digest(),before);
 const first=good(await f.call(BASE+'?limit=1')),tuple=JSON.parse(Buffer.from(first.nextCursor,'base64url').toString('utf8'));
 assert.deepEqual(tuple,[1,'manager-a','team-a','operator',NOW,'tie-064']);
 const second=good(await f.call(BASE+'?limit=1&after='+first.nextCursor));assert.equal(second.invitations[0].invitationId,'tie-064');assert.equal(JSON.parse(Buffer.from(second.nextCursor,'base64url').toString('utf8'))[3],'business');
 const digest=f.digest();assert.equal((await f.call(BASE+'/tie-064/revoke',{method:'POST',body:{}})).status,404);assert.equal(f.digest(),digest);
});
test('binary ID case and punctuation ordering matches SQL and accepts the default and maximum page sizes',async t=>{
 const f=await fixture(t);for(const [i,id] of ['a','Z','A','z','id_','id-','id0'].entries())f.insert('business',id,NOW,i);
 const expected=f.expected().map(r=>publicRow(r));assert.deepEqual(good(await f.call()).invitations,expected);assert.equal(good(await f.call(BASE+'?limit=50')).nextCursor,null);
 assert.deepEqual((await traverse(f,{limit:1})).invitations,expected);
});
test('status precedence, masking and the six invitation fields remain unchanged and listing performs no writes',async t=>{
 const f=await fixture(t);for(const [i,id] of ['pending','expired','revoked','accepted'].entries())f.insert(i%2?'operator':'business',id,NOW+i,i);
 f.db.prepare('UPDATE team_operator_employee_invitations SET expires_at=? WHERE invitation_id=?').run(NOW,'expired');
 f.db.prepare('UPDATE team_employee_invitations SET revoked_at=? WHERE invitation_id=?').run(NOW,'revoked');
 f.db.prepare('UPDATE team_operator_employee_invitations SET accepted_at=?,accepted_by=?,revoked_at=? WHERE invitation_id=?').run(NOW,'intern-a',NOW,'accepted');
 const before=f.digest(),page=good(await f.call()),states=Object.fromEntries(page.invitations.map(r=>[r.invitationId,r.status]));assert.deepEqual(states,{accepted:'accepted',revoked:'revoked',expired:'expired',pending:'pending'});
 for(const item of page.invitations){assert.deepEqual(Object.keys(item).sort(),['expiresAt','invitationId','phoneMasked','role','status','teamId']);assert.match(item.phoneMasked,/^\+8613\*{4}\d{4}$/);assert.equal(JSON.stringify(item).includes('139000'),false);}assert.equal(f.digest(),before);
});
for(const value of ['', '0','51','-1','01','+1','1.0','1e1','Infinity','NaN',' 1','1 ','9007199254740992'])test('reject noncanonical or out-of-range limit '+JSON.stringify(value),async t=>{
 const f=await fixture(t),before=f.digest(),r=await f.call(BASE+'?limit='+encodeURIComponent(value));assert.equal(r.status,400,r.raw);assert.equal(f.digest(),before);
});
test('unknown and duplicate query parameters are rejected, including an empty after',async t=>{
 const f=await fixture(t);for(const q of ['other=x','limit=1&limit=2','after=a&after=b','after=','limit=1&other=x','limit=1&after='])assert.equal((await f.call(BASE+'?'+q)).status,400,q);
});
test('only the exact GET list accepts query parameters',async t=>{
 const f=await fixture(t);f.insert('business','known');
 for(const [route,method,body] of [[BASE,'POST',{phone:'+8613800099999',role:'intern'}],[BASE+'/access','GET'],[BASE+'/known/revoke','POST',{}],['/api/auth/onboarding/capabilities','GET'],['/api/auth/onboarding/preview','POST',{}]]){
  const r=await f.call(route+'?limit=1',{method,...(body===undefined?{}:{body})});assert.equal(r.status,400,method+' '+route+' '+r.raw);
 }
 assert.equal(good(await f.call(BASE+'?limit=1')).invitations.length,1);
});
test('cursor requires canonical encoding, exact tuple, actor/team binding and a matching source-table anchor',async t=>{
 const f=await fixture(t);f.insert('business','anchor',NOW);f.insert('business','older',NOW-1);
 const tuple=[1,'manager-a','team-a','business',NOW,'anchor'],valid=cursor(tuple);assert.equal((await f.call(BASE+'?after='+valid)).status,200);
 const malformed=['!',valid+'=',valid+'\n','x'.repeat(1025),Buffer.from(' '+JSON.stringify(tuple)).toString('base64url'),Buffer.from(JSON.stringify(tuple)+'\n').toString('base64url'),Buffer.from([0xff,0xfe]).toString('base64url'),cursor({a:1}),cursor(tuple.concat('extra'))];
 for(const [i,value] of [[0,2],[1,'manager-other'],[1,['manager-a']],[2,'team-b'],[2,['team-a']],[3,'missing'],[3,'operator'],[4,-1],[4,0.5],[4,Number.MAX_SAFE_INTEGER+1],[4,true],[4,NOW+1],[5,42],[5,'bad id'],[5,'missing']]){const copy=[...tuple];copy[i]=value;malformed.push(cursor(copy));}
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';for(const ch of alphabet){const alternative=valid.slice(0,-1)+ch;if(alternative!==valid&&Buffer.from(alternative,'base64url').equals(Buffer.from(valid,'base64url'))){malformed.push(alternative);break;}}
 const before=f.digest();for(const value of malformed){const r=await f.call(BASE+'?after='+encodeURIComponent(value));assert.equal(r.status,400,'cursor '+value+' '+r.raw);}assert.equal(f.digest(),before);
 assert.equal((await f.call(BASE+'?after='+valid,{user:'manager-other'})).status,400);
 assert.equal((await f.call('/api/teams/team-b/employee-invitations?after='+valid,{user:'manager-b'})).status,400);
 f.db.prepare('DELETE FROM team_employee_invitations WHERE invitation_id=?').run('anchor');assert.equal((await f.call(BASE+'?after='+valid)).status,400);
});
test('MAX safe timestamp is issued and accepted as a canonical cursor only for its exact anchor',async t=>{
 const f=await fixture(t);f.insert('operator','max-safe',Number.MAX_SAFE_INTEGER);f.insert('business','older',NOW);
 const first=good(await f.call(BASE+'?limit=1'));assert.deepEqual(JSON.parse(Buffer.from(first.nextCursor,'base64url').toString('utf8')),[1,'manager-a','team-a','operator',Number.MAX_SAFE_INTEGER,'max-safe']);
 const next=good(await f.call(BASE+'?after='+first.nextCursor));assert.equal(next.invitations.length,1);assert.equal(next.invitations[0].invitationId,'older');assert.equal(next.nextCursor,null);
});
test('zero is a valid cursor timestamp when its exact anchor exists',async t=>{
 const f=await fixture(t);f.insert('business','zero',0);const r=good(await f.call(BASE+'?after='+cursor([1,'manager-a','team-a','business',0,'zero'])));assert.deepEqual(r,{invitations:[],nextCursor:null});
});
const revokeCases=[['invite grant',f=>f.db.prepare("UPDATE team_admin_grants SET status='revoked' WHERE user_id='manager-a'").run(),404],['membership',f=>f.db.prepare("UPDATE team_memberships SET status='disabled' WHERE user_id='manager-a'").run(),404],['account',f=>f.db.prepare("UPDATE team_users SET status='disabled' WHERE user_id='manager-a'").run(),401],['team',f=>f.db.prepare("UPDATE teams SET status='disabled' WHERE team_id='team-a'").run(),404],['session',f=>f.db.prepare('UPDATE team_sessions SET revoked_at=? WHERE token_hash=?').run(f.now,hash(f.tokens['manager-a'])),401],['actor swap',f=>f.db.prepare('UPDATE team_sessions SET user_id=? WHERE token_hash=?').run('manager-other',hash(f.tokens['manager-a'])),404]];
for(const [label,revoke,status] of revokeCases)test('fresh post-query '+label+' change rejects an already-read page',async t=>{
 const f=await fixture(t);f.insert('business','one');f.insert('operator','two');let injected=0;
 const db={prepare(sql){const stmt=f.db.prepare(sql);if(sql.startsWith('SELECT * FROM team_operator_employee_invitations WHERE'))return {all(...params){const rows=stmt.all(...params);injected++;revoke(f);return rows;}};return stmt;}};
 const r=await f.call(BASE,{db});assert.equal(injected,1);assert.equal(r.status,status,r.raw);assert.equal('invitations'in r.data,false);
});
test('a prior cursor grants no access after invite authority is revoked, and lower/foreign/anonymous accounts remain denied',async t=>{
 const f=await fixture(t);f.insert('business','one');f.insert('operator','two');const first=good(await f.call(BASE+'?limit=1'));
 for(const user of ['intern-a','manager-b',null])assert.ok([401,404].includes((await f.call(BASE+'?after='+first.nextCursor,{user})).status));
 f.db.prepare("UPDATE team_admin_grants SET status='revoked' WHERE user_id='manager-a'").run();const r=await f.call(BASE+'?after='+first.nextCursor);assert.equal(r.status,404,r.raw);
});
