'use strict';
// Real SQLite authorization and loopback HTTP. No permission or query mocks.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync,constants}=require('node:sqlite');
const {createHash}=require('node:crypto'),path=require('node:path'),{pathToFileURL}=require('node:url');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const NOW=Date.parse('2026-11-15T10:00:00Z'),ORIGIN='http://127.0.0.1:8774';
const hash=value=>createHash('sha256').update(value).digest('hex');
const token=actor=>createHash('sha256').update('synthetic-head:'+actor).digest('base64url');
const filePath=(team='team-a',task='task-a',attachment='file-a')=>'/api/teams/'+team+'/collection/tasks/'+task+'/attachments/'+attachment;
const BYTES=Buffer.from('Synthetic original\0\r\n原件; no client data.');
async function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const {initializeTeamDatabase}=await source('database.mjs');initializeTeamDatabase(db);
 const run=(sql,...args)=>db.prepare(sql).run(...args);
 for(const team of ['a','b']){
  run('INSERT INTO teams VALUES (?,?)','team-'+team,'active');
  run('INSERT INTO team_projects VALUES (?,?,?,?,?,?)','team-'+team,'project-a','CONFIDENTIAL_PROJECT','DO_NOT_EXPOSE_FINANCIAL','{"DO_NOT_EXPOSE_TREE":true}','active');
  run('INSERT INTO team_collection_tasks VALUES (?,?,?,?,?,?)','team-'+team,'task-a','project-a','Synthetic task','Synthetic collection only','open');
  for(const role of ['intern','assistant','manager','partner']){
   const actor=role+'-'+team;run('INSERT INTO team_users VALUES (?,?)',actor,'active');run('INSERT INTO team_memberships VALUES (?,?,?,?)','team-'+team,actor,role,'active');run('INSERT INTO team_sessions VALUES (?,?,?,NULL)',hash(token(actor)),actor,NOW+60_000);
  }
  run('INSERT INTO team_task_assignments VALUES (?,?,?,?)','team-'+team,'task-a','intern-'+team,'active');
  run('INSERT INTO team_collection_attachments VALUES (?,?,?,?,?)','team-'+team,'task-a','file-a','原件 report.txt',team==='a'?BYTES:Buffer.from('FOREIGN_ORIGINAL'));
  run('INSERT INTO team_attachment_grants VALUES (?,?,?,?)','team-'+team,'file-a','intern-'+team,'active');
  for(const role of ['manager','partner'])run('INSERT INTO team_project_grants VALUES (?,?,?,?,?)','team-'+team,'project-a',role+'-'+team,'collection.read','active');
 }
 run('INSERT INTO team_users VALUES (?,?)','operator-a','active');run('INSERT INTO team_sessions VALUES (?,?,?,NULL)',hash(token('operator-a')),'operator-a',NOW+60_000);run('INSERT INTO team_operators VALUES (?,?,?,?)','team-a','operator-a','administrator','active');
 const {handleTeamCollectionRequest}=await source('collection-api.mjs'),{handleTeamApplicationRequest}=await source('application-api.mjs');
 const call=async({method='HEAD',actor='intern-a',pathname=filePath(),query='',headers={},application=false,now=NOW}={})=>{
  const request=new Request(ORIGIN+pathname+query,{method,headers:{...(actor?{Authorization:'Bearer '+token(actor)}:{}),...headers}});
  const response=await (application?handleTeamApplicationRequest:handleTeamCollectionRequest)(request,{db,now:()=>now});assert.ok(response);const bytes=Buffer.from(await response.arrayBuffer());
  return {status:response.status,headers:response.headers,bytes,raw:bytes.toString('utf8')};
 };
 return {db,run,call};
}
function emptyHead(result,status=200){
 assert.equal(result.status,status,result.raw);assert.equal(result.bytes.length,0);assert.equal(result.raw,'');
 assert.equal(result.headers.get('Cache-Control'),'private, no-store, max-age=0');assert.equal(result.headers.get('Vary'),'Authorization');assert.equal(result.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(result.headers.get('Referrer-Policy'),'no-referrer');
 assert.equal(result.headers.get('Set-Cookie'),null);assert.equal(result.headers.get('Access-Control-Allow-Origin'),null);
 if(status!==200)assert.equal(result.headers.get('Content-Disposition'),null);
}
async function sameAuthorization(f,options,status){emptyHead(await f.call(options),status);assert.equal((await f.call({...options,method:'GET'})).status,status);}

test('HEAD authorizes an exact attachment with the same filename and private headers as GET',async t=>{
 const f=await fixture(t),head=await f.call(),get=await f.call({method:'GET'});emptyHead(head);assert.deepEqual(get.bytes,BYTES);
 for(const header of ['Content-Type','Content-Disposition','Cache-Control','Vary','X-Content-Type-Options','Referrer-Policy'])assert.equal(head.headers.get(header),get.headers.get(header),header);
 assert.equal(head.headers.get('Content-Type'),'application/octet-stream');assert.match(head.headers.get('Content-Disposition'),/^attachment; filename="download\.bin"; filename\*=UTF-8''/);
});
test('HEAD shares task scope and the independent per-user attachment grant for every role',async t=>{
 const f=await fixture(t);for(const actor of ['assistant-a','manager-a','partner-a'])await sameAuthorization(f,{actor},404);
 for(const actor of ['manager-a','partner-a']){f.run("INSERT INTO team_attachment_grants VALUES ('team-a','file-a',?,'active')",actor);await sameAuthorization(f,{actor},200);}
 f.run("INSERT INTO team_attachment_grants VALUES ('team-a','file-a','assistant-a','active')");await sameAuthorization(f,{actor:'assistant-a'},404);
});
test('technical administration never grants business attachment scope',async t=>{
 const f=await fixture(t);await sameAuthorization(f,{actor:'operator-a'},404);
});
test('cross-team same IDs, wrong tasks and unknown attachments remain indistinguishable',async t=>{
 const f=await fixture(t);for(const options of [{actor:'intern-b'},{pathname:filePath('team-b')},{pathname:filePath('team-a','missing')},{pathname:filePath('team-a','task-a','missing')},{pathname:filePath('missing')}])await sameAuthorization(f,options,404);
 const foreign=await f.call({actor:'intern-b',pathname:filePath('team-b')});emptyHead(foreign);assert.equal((await f.call({method:'GET',actor:'intern-b',pathname:filePath('team-b')})).raw,'FOREIGN_ORIGINAL');
});
const revocations={
 attachment:{status:404,sql:"UPDATE team_attachment_grants SET status='revoked' WHERE team_id='team-a' AND attachment_id='file-a' AND user_id='intern-a'"},
 assignment:{status:404,sql:"UPDATE team_task_assignments SET status='revoked' WHERE team_id='team-a' AND task_id='task-a' AND user_id='intern-a'"},
 membership:{status:404,sql:"UPDATE team_memberships SET status='disabled' WHERE team_id='team-a' AND user_id='intern-a'"},
 team:{status:404,sql:"UPDATE teams SET status='disabled' WHERE team_id='team-a'"},
 account:{status:401,sql:"UPDATE team_users SET status='disabled' WHERE user_id='intern-a'"},
 session:{status:401,sql:"UPDATE team_sessions SET revoked_at=1 WHERE user_id='intern-a'"},
 expiry:{status:401,sql:"UPDATE team_sessions SET expires_at=1 WHERE user_id='intern-a'"},
 archive:{status:404,sql:"UPDATE team_projects SET status='archived' WHERE team_id='team-a' AND project_id='project-a'"},
};
for(const [name,{sql,status}] of Object.entries(revocations))test('HEAD and GET both apply '+name+' revocation on the next request',async t=>{
 const f=await fixture(t);await sameAuthorization(f,{},200);f.run(sql);await sameAuthorization(f,{},status);
});
test('project read grant revocation and role demotion affect HEAD exactly as GET',async t=>{
 const f=await fixture(t);f.run("INSERT INTO team_attachment_grants VALUES ('team-a','file-a','manager-a','active')");await sameAuthorization(f,{actor:'manager-a'},200);
 f.run("UPDATE team_project_grants SET status='revoked' WHERE team_id='team-a' AND user_id='manager-a'");await sameAuthorization(f,{actor:'manager-a'},404);
 f.run("UPDATE team_project_grants SET status='active' WHERE team_id='team-a' AND user_id='manager-a'");f.run("UPDATE team_memberships SET role='assistant' WHERE team_id='team-a' AND user_id='manager-a'");await sameAuthorization(f,{actor:'manager-a'},404);
});
test('frozen projects and closed tasks keep existing readable original semantics',async t=>{
 const f=await fixture(t);f.run("UPDATE team_projects SET status='frozen' WHERE team_id='team-a'");f.run("UPDATE team_collection_tasks SET status='closed' WHERE team_id='team-a'");await sameAuthorization(f,{},200);assert.deepEqual((await f.call({method:'GET'})).bytes,BYTES);
});
test('all HEAD authentication and direct cross-site failures have no response body',async t=>{
 const f=await fixture(t);emptyHead(await f.call({actor:null}),401);emptyHead(await f.call({actor:'missing'}),401);emptyHead(await f.call({headers:{Authorization:'Bearer malformed'}}),401);emptyHead(await f.call({headers:{'Sec-Fetch-Site':'cross-site'}}),403);
});
test('attachment HEAD rejects every query override and duplicate with no metadata body',async t=>{
 const f=await fixture(t);for(const query of ['?role=partner','?userId=intern-a','?fields=bytes','?download=true','?q=','?x=1&x=2'])emptyHead(await f.call({query}),400);
});
test('nonattachment resources still reject HEAD while attachment methods advertise only GET and HEAD',async t=>{
 const f=await fixture(t);for(const pathname of ['/api/teams/team-a/collection/tasks','/api/teams/team-a/collection/summary','/api/teams/team-a/collection/tasks/task-a']){const r=await f.call({pathname});emptyHead(r,405);assert.equal(r.headers.get('Allow'),'GET');}
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']){const r=await f.call({method});assert.equal(r.status,405);assert.equal(r.headers.get('Allow'),'GET, HEAD');}
});
test('HEAD filenames use the identical control-character and path-safe encoding as GET',async t=>{
 const f=await fixture(t);f.run("UPDATE team_collection_attachments SET display_name=? WHERE team_id='team-a' AND attachment_id='file-a'",'../原件\r\nX-Evil: true/quote\'().txt');const head=await f.call(),get=await f.call({method:'GET'});emptyHead(head);assert.equal(head.headers.get('Content-Disposition'),get.headers.get('Content-Disposition'));assert.equal(head.headers.get('X-Evil'),null);assert.equal(/[\r\n]/.test(head.headers.get('Content-Disposition')),false);assert.deepEqual(get.bytes,BYTES);
});
test('SQLite authorizer proves HEAD never reads the attachment bytes column',async t=>{
 const f=await fixture(t),reads=[];
 f.db.setAuthorizer((action,table,column)=>{
  if(action===constants.SQLITE_READ){reads.push({table,column});if(table==='team_collection_attachments'&&column==='bytes')return constants.SQLITE_DENY;}
  return constants.SQLITE_OK;
 });
 emptyHead(await f.call());assert.ok(reads.some(item=>item.table==='team_collection_attachments'&&item.column==='display_name'));assert.equal(reads.some(item=>item.table==='team_collection_attachments'&&item.column==='bytes'),false);
 const get=await f.call({method:'GET'});assert.equal(get.status,503);assert.ok(reads.some(item=>item.table==='team_collection_attachments'&&item.column==='bytes'));f.db.setAuthorizer(null);
});
test('HEAD is a read-only query with no row, schema or total-changes mutation',async t=>{
 const f=await fixture(t),changes=f.db.prepare('SELECT total_changes() n').get().n,schema=f.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();f.db.exec('PRAGMA query_only=ON');emptyHead(await f.call());emptyHead(await f.call({actor:'assistant-a'}),404);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,changes);assert.deepEqual(f.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all(),schema);
});
test('HEAD service failures hide SQL and original data and remain bodyless',async t=>{
 const f=await fixture(t);emptyHead(await f.call({now:-1}),503);f.db.setAuthorizer(()=>constants.SQLITE_DENY);emptyHead(await f.call(),503);f.db.setAuthorizer(null);
});
test('application-level HEAD success and early cross-site errors are bodyless',async t=>{
 const f=await fixture(t);emptyHead(await f.call({application:true}));emptyHead(await f.call({application:true,headers:{Origin:'https://untrusted.example.invalid'}}),403);emptyHead(await f.call({application:true,headers:{'Sec-Fetch-Site':'cross-site'}}),403);emptyHead(await f.call({application:true,now:-1}),503);
});
test('loopback HTTP HEAD preserves headers but sends zero success and failure bytes',async t=>{
 const f=await fixture(t),{startTeamServer}=await source('dev-server.mjs'),service=await startTeamServer({db:f.db,port:0,now:()=>NOW});t.after(()=>service.close());
 const request=async(pathname=filePath(),headers={})=>{const response=await fetch(service.address.url+pathname,{method:'HEAD',headers:{Authorization:'Bearer '+token('intern-a'),...headers}});return {status:response.status,headers:response.headers,bytes:Buffer.from(await response.arrayBuffer()),raw:''};};
 const success=await request();emptyHead(success);assert.equal(success.headers.get('Content-Disposition'),(await f.call({method:'GET'})).headers.get('Content-Disposition'));
 emptyHead(await request(filePath()+'?fields=bytes'),400);emptyHead(await request(filePath(),{Origin:'https://untrusted.example.invalid'}),403);f.run(revocations.attachment.sql);emptyHead(await request(),404);f.run(revocations.session.sql);emptyHead(await request(),401);
});
