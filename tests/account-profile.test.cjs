'use strict';
// Independent contact-profile review. SQLite executes the actual D1 statements;
// this is not a Cloudflare D1 or platform-authentication integration test.
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const {createHash}=require('node:crypto');
const apiPromise=import(pathToFileURL(path.resolve(__dirname,'../server/profile.mjs')).href);
const ORIGIN='https://profile-review.example';
const A={userId:'platform-A',email:'not-a-profile@example.invalid'};
const B={userId:'platform-B'};
// Independent expected context: do not import the production digest implementation.
const contextFor=user=>createHash('sha256').update('shenyi.profile.v1\0'+user.userId,'utf8').digest('hex');
const body=(patch={})=>({phone:'13800138000',displayName:'核对员甲',revision:0,...patch});
function fixture(t){
  const sql=new DatabaseSync(':memory:');
  sql.exec("CREATE TABLE account_profiles(user_id TEXT PRIMARY KEY,phone TEXT NOT NULL DEFAULT '',display_name TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT '')");
  t.after(()=>sql.close());
  const trace=[];
  const db={prepare(query){
    trace.push({query,params:null});const event=trace.at(-1),statement=sql.prepare(query);
    return {bind(...params){event.params=params;return {async first(){return statement.get(...params)||null;}};}};
  }};
  return {db,trace,rows:()=>sql.prepare('SELECT * FROM account_profiles ORDER BY user_id').all().map(v=>({...v})),sql};
}
function request(method='GET',value,headers={},suffix='',contextUser=A){
  return new Request(ORIGIN+'/api/account'+suffix,{method,headers:{...(method==='PUT'?{'Origin':ORIGIN,'Content-Type':'application/json','X-Shenyi-Profile-Context':contextFor(contextUser)}:{}),...headers},...(value!==undefined?{body:typeof value==='string'?value:JSON.stringify(value)}:{})});
}
async function call(req,user,db){const {handleAccountRequest}=await apiPromise;const response=await handleAccountRequest(req,user,db);const raw=await response.text();return {response,raw,json:JSON.parse(raw)};}
function privacy(result){
  assert.match(result.response.headers.get('cache-control'),/private/);
  assert.match(result.response.headers.get('cache-control'),/no-store/);
  assert.equal(result.response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(result.response.headers.get('vary'),'Cookie');
  assert.equal(result.response.headers.get('set-cookie'),null);
  assert.equal(result.response.headers.get('access-control-allow-origin'),null);
}
function envelope(result,revision,name='',phone='',user=A){
  assert.equal(result.response.status,200);privacy(result);
  assert.deepEqual(result.json,{status:'signed-in',account:{phone,displayName:name,phoneVerified:false},revision,storage:{profile:'server',business:'device-shared'},authentication:'platform',phoneLoginEnabled:false,profileContext:contextFor(user)});
}

test('unauthenticated or malformed platform identity gets 401 before database access',async t=>{
  const f=fixture(t);
  for(const user of [null,undefined,{}, {id:'platform-A'}, {userId:''},{userId:'x y'},{userId:'x\n'},{userId:'x'.repeat(241)}]){
    const r=await call(request('PUT',body(),{},'?userId=platform-A'),user,f.db);
    assert.equal(r.response.status,401);privacy(r);assert.equal(r.json.error.code,'SIGN_IN_REQUIRED');
  }
  assert.equal(f.trace.length,0);assert.deepEqual(f.rows(),[]);
});
test('GET empty profile has no auto-created row, no provider email and explicit shared-business boundary',async t=>{
  const f=fixture(t);const r=await call(request(),A,f.db);envelope(r,0);
  assert.deepEqual(f.rows(),[]);assert.deepEqual(f.trace[0].params,[A.userId]);assert.ok(!r.raw.includes(A.userId));assert.ok(!r.raw.includes(A.email));
});
test('POST DELETE PATCH and HEAD are rejected without using the database',async t=>{
  const f=fixture(t);
  for(const method of ['POST','DELETE','PATCH','HEAD']){
    const r=await call(request(method),A,f.db);assert.equal(r.response.status,405);assert.equal(r.response.headers.get('allow'),'GET, PUT');privacy(r);
  }
  assert.equal(f.trace.length,0);
});
test('PUT requires exact same Origin and rejects cross-site fetch including on GET',async t=>{
  const f=fixture(t);
  for(const origin of ['', 'null','http://profile-review.example','https://profile-review.example:444','https://profile-review.example.evil.invalid','https://evil.invalid']){
    const r=await call(request('PUT',body(),{Origin:origin}),A,f.db);assert.equal(r.response.status,403);privacy(r);
  }
  const missing=request('PUT',body());missing.headers.delete('Origin');assert.equal((await call(missing,A,f.db)).response.status,403);
  for(const method of ['GET','PUT'])assert.equal((await call(request(method,method==='PUT'?body():undefined,{'Sec-Fetch-Site':'cross-site'}),A,f.db)).response.status,403);
  assert.equal(f.trace.length,0);
});
test('only JSON accepted; normal JSON charset suffix works',async t=>{
  const f=fixture(t);
  for(const value of ['text/plain','application/x-www-form-urlencoded','application/jsonx'])assert.equal((await call(request('PUT',body(),{'Content-Type':value}),A,f.db)).response.status,415);
  const missing=request('PUT',body());missing.headers.delete('Content-Type');assert.equal((await call(missing,A,f.db)).response.status,415);
  assert.equal(f.trace.length,0);
  envelope(await call(request('PUT',body(),{'Content-Type':'application/json; charset=utf-8'}),A,f.db),1,'核对员甲','+8613800138000');
});
test('phone normalization accepts explicit mainland variants and removal without claiming verification',async()=>{
  const {normalizeProfilePhone:n}=await apiPromise;
  for(const value of ['13800138000','+86 138-0013-8000','0086(138)00138000','＋８６ １３８００１３８０００'])assert.equal(n(value),'+8613800138000');
  for(const value of ['', '   '])assert.equal(n(value),'');
  for(const value of [null,13800138000,{},'12345678901','12800138000','+1 13800138000','138001380001','x'.repeat(65),'13800138000ext2'])assert.throws(()=>n(value));
});
test('missing keys, unknown fields, userId and verified injection are rejected without mutation',async t=>{
  const f=fixture(t);
  const absent=k=>{const v=body();delete v[k];return v;};
  for(const value of [null,[],true,7,{},...['phone','displayName','revision'].map(absent),body({userId:B.userId}),body({phoneVerified:true}),body({verified:true}),body({updated_at:'2000-01-01'}),body({role:'admin'}),body({profileContext:contextFor(A)})]){
    const r=await call(request('PUT',value),A,f.db);assert.equal(r.response.status,400);privacy(r);
  }
  assert.equal(f.trace.length,0);assert.deepEqual(f.rows(),[]);
});
test('display name NFC trim and code-point limit; bad names and revisions fail without writes',async t=>{
  const f=fixture(t);
  for(const patch of [{displayName:7},{displayName:'bad\nname'},{displayName:'\u0000'},{displayName:'甲'.repeat(61)},{displayName:'😀'.repeat(61)},{revision:-1},{revision:1.1},{revision:'0'},{revision:Number.MAX_SAFE_INTEGER+1},{phone:'1300000000'}])assert.equal((await call(request('PUT',body(patch)),A,f.db)).response.status,400);
  assert.equal(f.trace.length,0);
  envelope(await call(request('PUT',body({displayName:'  e\u0301  '})),A,f.db),1,'é','+8613800138000');
  envelope(await call(request('PUT',body({displayName:'😀'.repeat(60),revision:1,phone:''})),A,f.db),2,'😀'.repeat(60),'');
});
test('empty malformed JSON and invalid UTF-8 are rejected with no database access',async t=>{
  const f=fixture(t);
  for(const text of ['', '{','{"phone":', '{"__proto__":{},"phone":"","displayName":"","revision":0}'])assert.equal((await call(request('PUT',text),A,f.db)).response.status,400);
  assert.equal((await call(request('PUT'),A,f.db)).response.status,400);
  const bad=new Request(ORIGIN+'/api/account',{method:'PUT',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:Uint8Array.of(0xC3,0x28)});
  assert.equal((await call(bad,A,f.db)).response.status,400);assert.equal(f.trace.length,0);
});
test('declared and actual byte bounds apply, including missing or underreported Content-Length',async t=>{
  const f=fixture(t);const valid=JSON.stringify(body()),padded=valid+' '.repeat(4096-Buffer.byteLength(valid));
  for(const declared of ['4097','-1','NaN','1e4'])assert.equal((await call(request('PUT',body(),{'Content-Length':declared}),A,f.db)).response.status,413);
  for(const headers of [{},{'Content-Length':'1'}])assert.equal((await call(request('PUT',padded+' ',headers),A,f.db)).response.status,413);
  assert.equal(f.trace.length,0);envelope(await call(request('PUT',padded),A,f.db),1,'核对员甲','+8613800138000');
});
test('chunked stream overflow cancels input and leaves database untouched',async t=>{
  const f=fixture(t);let cancelled=false,pulls=0;
  const stream=new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(2048).fill(32));},cancel(){cancelled=true;}});
  const req=new Request(ORIGIN+'/api/account',{method:'PUT',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:stream,duplex:'half'});
  assert.equal((await call(req,A,f.db)).response.status,413);assert.equal(cancelled,true);assert.ok(pulls<=5);assert.equal(f.trace.length,0);
});
test('A and B profiles stay separate; query/body/provider-extra data cannot select another owner',async t=>{
  const f=fixture(t);
  envelope(await call(request('PUT',body(),{},'?userId=platform-B'),A,f.db),1,'核对员甲','+8613800138000');
  envelope(await call(request(),B,f.db),0,'','',B);
  envelope(await call(request('PUT',body({phone:'15900159000',displayName:'核对员乙'}),{},'',B),B,f.db),1,'核对员乙','+8615900159000',B);
  envelope(await call(request('GET',undefined,{},'?userId=platform-B'),A,f.db),1,'核对员甲','+8613800138000');
  assert.deepEqual(f.rows().map(x=>x.user_id),[A.userId,B.userId]);
  for(const r of f.rows())assert.ok(Number.isFinite(Date.parse(r.updated_at)));
});
test('identity and contact values are SQL parameters, not SQL syntax',async t=>{
  const f=fixture(t),user={userId:"u'OR'1'='1"};
  const name="'; DROP TABLE account_profiles; --";
  envelope(await call(request('PUT',body({displayName:name}),{},'',user),user,f.db),1,name,'+8613800138000',user);
  envelope(await call(request(),A,f.db),0);assert.equal(f.rows()[0].user_id,user.userId);
  for(const {query}of f.trace){assert.ok(!query.includes(user.userId));assert.ok(!query.includes(name));}
});
test('first-save race uses real SQLite conflict: exactly one winner, no overwritten first profile',async t=>{
  const f=fixture(t);
  const results=await Promise.all(['first','second'].map(displayName=>call(request('PUT',body({displayName})),A,f.db)));
  assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);
  const winner=results.find(r=>r.response.status===200);assert.equal(f.rows().length,1);assert.equal(f.rows()[0].display_name,winner.json.account.displayName);assert.equal(f.rows()[0].revision,1);
});
test('concurrent revision updates and stale/foreign revision refuse without overwriting',async t=>{
  const f=fixture(t);await call(request('PUT',body()),A,f.db);
  const results=await Promise.all(['next-one','next-two'].map(displayName=>call(request('PUT',body({displayName,revision:1})),A,f.db)));
  assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);
  const before=f.rows();assert.equal(before[0].revision,2);
  for(const revision of [0,1,3])assert.equal((await call(request('PUT',body({displayName:'must not overwrite',revision})),A,f.db)).response.status,409);
  assert.equal((await call(request('PUT',body({revision:2}),{},'',B),B,f.db)).response.status,409);
  assert.deepEqual(f.rows(),before);assert.equal((await call(request('PUT',body({revision:2})),A,f.db)).json.revision,3);
});
test('D1 missing/prepare/bind/first failures return generic 503 without database, SQL or identity leaks',async()=>{
  const secret="SECRET-DB account_profiles platform-A 13800138000 SQL-token";
  const bad=[undefined,{}, {prepare(){throw Error(secret);}},{prepare(){return {bind(){throw Error(secret);}};}},{prepare(){return {bind(){return {first:async()=>{throw Error(secret);}};}};}}];
  for(const db of bad)for(const method of ['GET','PUT']){
    const r=await call(request(method,method==='PUT'?body():undefined),A,db);assert.equal(r.response.status,503);privacy(r);
    for(const value of secret.split(' '))assert.ok(!r.raw.includes(value));assert.deepEqual(Object.keys(r.json),['error']);
  }
});

test('profile context matches independent domain-separated SHA256 known vectors and is not the raw platform user ID',async t=>{
  const f=fixture(t);
  const vectors=[[A,'01dc779c0bfdd67878684b69e766da000ef5443da8e4df30e6d07c9b8c8f7d0c'],[B,'a7f662b166fbfe57ef949a7a0a10c31c5da50d3f86771e272b49554c1e718420']];
  for(const [user,expected] of vectors){
    assert.equal(contextFor(user),expected);
    const r=await call(request(),user,f.db);envelope(r,0,'','',user);
    assert.equal(r.json.profileContext,expected);assert.match(r.json.profileContext,/^[0-9a-f]{64}$/);
    assert.notEqual(r.json.profileContext,user.userId);assert.ok(!r.raw.includes(user.userId));
    assert.notEqual(r.json.profileContext,createHash('sha256').update(user.userId).digest('hex'));
  }
  assert.notEqual(vectors[0][1],vectors[1][1]);assert.deepEqual(f.rows(),[]);
});

test('missing, malformed or other-user context fails 409 before database access and cannot choose the profile owner',async t=>{
  const f=fixture(t);
  for(const value of [null,'',A.userId,contextFor(B),'f'.repeat(64),contextFor(A).toUpperCase()]){
    const req=request('PUT',body());if(value===null)req.headers.delete('X-Shenyi-Profile-Context');else req.headers.set('X-Shenyi-Profile-Context',value);
    const r=await call(req,A,f.db);assert.equal(r.response.status,409);assert.equal(r.json.error.code,'PROFILE_CONTEXT_CHANGED');privacy(r);
    assert.ok(!r.raw.includes(contextFor(A)));assert.ok(!r.raw.includes(contextFor(B)));assert.deepEqual(Object.keys(r.json),['error']);
  }
  const missing=request('PUT',body());missing.headers.delete('X-Shenyi-Profile-Context');
  assert.equal((await call(missing,A,undefined)).json.error.code,'PROFILE_CONTEXT_CHANGED');
  assert.equal(f.trace.length,0);assert.deepEqual(f.rows(),[]);
});

test('cached A profile cannot first-save or update B after platform switch even when both revisions match',async t=>{
  const f=fixture(t),aEmpty=await call(request(),A,f.db),bEmpty=await call(request(),B,f.db);
  assert.equal(aEmpty.json.revision,bEmpty.json.revision);
  const aDraft=body({displayName:'A cached draft',revision:aEmpty.json.revision});
  let before=f.rows(),queries=f.trace.length;
  let rejected=await call(request('PUT',aDraft,{'X-Shenyi-Profile-Context':aEmpty.json.profileContext}),B,f.db);
  assert.equal(rejected.response.status,409);assert.equal(rejected.json.error.code,'PROFILE_CONTEXT_CHANGED');assert.deepEqual(f.rows(),before);assert.equal(f.trace.length,queries);
  await call(request('PUT',body()),A,f.db);
  await call(request('PUT',body({displayName:'B original',phone:'15900159000'}),{},'',B),B,f.db);
  const a=await call(request(),A,f.db),b=await call(request(),B,f.db);assert.equal(a.json.revision,1);assert.equal(a.json.revision,b.json.revision);
  before=f.rows();queries=f.trace.length;
  rejected=await call(request('PUT',body({displayName:'A must not overwrite B',revision:a.json.revision}),{'X-Shenyi-Profile-Context':a.json.profileContext},'?userId=platform-A'),B,f.db);
  assert.equal(rejected.response.status,409);assert.equal(rejected.json.error.code,'PROFILE_CONTEXT_CHANGED');privacy(rejected);assert.deepEqual(f.rows(),before);assert.equal(f.trace.length,queries);
  const freshB=await call(request(),B,f.db);
  envelope(await call(request('PUT',body({displayName:'B deliberate edit',phone:'15900159000',revision:freshB.json.revision}),{'X-Shenyi-Profile-Context':freshB.json.profileContext},'',B),B,f.db),2,'B deliberate edit','+8615900159000',B);
  assert.deepEqual(f.rows().find(r=>r.user_id===A.userId),before.find(r=>r.user_id===A.userId));
});

test('auth, CSRF, content type and invalid body retain precedence over context rejection',async t=>{
  const f=fixture(t),noContext=(value=body(),headers={})=>{const r=request('PUT',value,headers);r.headers.delete('X-Shenyi-Profile-Context');return r;};
  assert.equal((await call(noContext(),null,f.db)).response.status,401);
  assert.equal((await call(noContext(body(),{Origin:'https://other.invalid'}),A,f.db)).response.status,403);
  assert.equal((await call(noContext(body(),{'Content-Type':'text/plain'}),A,f.db)).response.status,415);
  assert.equal((await call(noContext('{'),A,f.db)).response.status,400);
  assert.equal((await call(noContext(body({profileContext:contextFor(A)})),A,f.db)).response.status,400);
  assert.equal(f.trace.length,0);assert.deepEqual(f.rows(),[]);
});
