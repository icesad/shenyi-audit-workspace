const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {createWorkpaperAccessFixture:fixture,good,denied,uuid,source,PASSWORD,restorePasswordWork}=require('./helpers/workpaper-access-fixture.cjs');
after(restorePasswordWork);

test('workpaper owner and business role grant no read, write or export by themselves',async t=>{
 const f=await fixture(t),a=good(await f.wpAccess()).access;
 assert.equal(a.read,false);assert.equal(a.write,false);assert.equal(a.export,false);assert.equal(a.canWrite,false);assert.equal(a.canExport,false);assert.equal(a.canManageAccess,true);
 const {workpaperAccessContext}=await source('workpaper-access-policy.mjs');
 for(const action of ['read','write','export'])assert.throws(()=>workpaperAccessContext(f.db,{userId:f.user},'team-a',f.projectId,{[action]:true}),e=>e.status===404);
 const before=f.snapshot();good(await f.wpAccess());good(await f.wpMembers());good(await f.wpList());assert.deepEqual(f.snapshot(),before);
 good(await f.wpGrant(f.user,{read:true,write:true,export:true}));
 const b=good(await f.wpAccess()).access;assert.equal(b.canWrite,true);assert.equal(b.canExport,true);
 assert.equal((await f.api(f.wpRoute().replace('/workpapers','')+'/materials',{session:f.actor})).status,404);
 assert.equal((await f.api(f.wpRoute().replace('/workpapers','')+'/ledger-checks',{session:f.actor})).status,404);
 const [grants,events]=f.wpRows();assert.equal(grants.rows.length,1);assert.equal(events.rows.length,1);assert.equal(events.rows[0].write_after,1);assert.equal(events.rows[0].export_after,1);assert.equal(JSON.stringify(events).includes(PASSWORD),false);
});

test('all eight independent configurations require read AND write/export for actual action predicates',async t=>{
 const f=await fixture(t),{workpaperAccessContext}=await source('workpaper-access-policy.mjs');good(await f.wpGrant(f.user,{read:true,write:true,export:true}));
 for(let mask=0;mask<8;mask++){
  const flags={read:!!(mask&1),write:!!(mask&2),export:!!(mask&4)};good(await f.wpGrant(f.user,flags));
  const a=good(await f.wpAccess()).access;for(const key of ['read','write','export'])assert.equal(a[key],flags[key]);assert.equal(a.canWrite,flags.read&&flags.write);assert.equal(a.canExport,flags.read&&flags.export);
  for(const action of ['read','write','export']){const allowed=flags.read&&(action==='read'||flags[action]);if(allowed)assert.equal(workpaperAccessContext(f.db,{userId:f.user},'team-a',f.projectId,{[action]:true}).grant.read,true);else assert.throws(()=>workpaperAccessContext(f.db,{userId:f.user},'team-a',f.projectId,{[action]:true}),e=>e.status===404);}
 }
});

test('workpaper-only senior receives only its minimal module project list and no collection/module inheritance',async t=>{
 const f=await fixture(t),partner=await f.ready('partner-a');assert.deepEqual(good(await f.wpList({current:partner})).projects,[]);
 good(await f.wpGrant('partner-a'));const result=good(await f.wpList({current:partner}));assert.equal(result.projects.length,1);assert.deepEqual(Object.keys(result.projects[0]),['teamId','id','title','status','revision']);assert.equal(result.projects[0].id,f.projectId);
 assert.deepEqual(good(await f.api('/api/teams/team-a/projects',{session:partner})).projects,[]);
 assert.equal(good(await f.wpAccess({current:partner})).access.canManageAccess,false);denied(await f.wpMembers({current:partner}));denied(await f.wpGrant(f.user,{current:partner}));denied(await f.wpList({current:partner,teamId:'team-b'}));
});

test('write-only or export-only configuration does not reveal a recipient project or bypass missing read',async t=>{
 const f=await fixture(t),partner=await f.ready('partner-a');
 for(const flags of [{read:false,write:true,export:false},{read:false,write:false,export:true},{read:false,write:true,export:true}]){good(await f.wpGrant('partner-a',flags));assert.deepEqual(good(await f.wpList({current:partner})).projects,[]);denied(await f.wpAccess({current:partner}));}
 good(await f.wpGrant('partner-a',{read:true,write:true,export:true}));assert.equal(good(await f.wpAccess({current:partner})).access.canWrite,true);
 good(await f.wpGrant('partner-a',{read:false,write:true,export:true}));denied(await f.wpAccess({current:partner}));
});

test('low roles, technical or protected reviewers, foreign teams and forged identity cannot gain workpaper access',async t=>{
 const f=await fixture(t);
 for(const user of ['intern-a','assistant-a','manager-b','administrator-demo','reviewer-demo']){
  const actor=await f.ready(user);denied(await f.wpAccess({current:actor}));denied(await f.wpGrant(user));
  if(['intern-a','assistant-a'].includes(user))f.db.prepare('INSERT INTO team_workpaper_access_grants VALUES (?,?,?,1,1,1,1,1)').run('team-a',f.projectId,user);
  denied(await f.wpAccess({current:actor}));denied(await f.wpList({current:actor}));
 }
 denied(await f.wpAccess({id:uuid()}));denied(await f.wpAccess({teamId:'team-b'}));denied(await f.api(f.wpRoute()+'/access',{headers:{'X-Shenyi-User-Id':f.user}}),401);
});

test('password, exact fields and project/member/grant CAS protect authorization with no partial grant writes',async t=>{
 const f=await fixture(t),before=f.wpRows();denied(await f.wpGrant(f.user,{currentPassword:'wrong'}),403);assert.deepEqual(f.wpRows(),before);
 for(const fields of [{role:'partner'},{review:true},{write:1},{export:'true'},{userId:[]},{currentPassword:'x'.repeat(513)},{memberRevision:-1}]){denied(await f.wpGrant(f.user,{body:{...f.wpGrantBody(),...fields}}),400);assert.deepEqual(f.wpRows(),before);}
 for(const fields of [{projectRevision:f.revision(f.projectId)+1},{memberRevision:f.epoch(f.user)+1},{grantRevision:1}])denied(await f.wpGrant(f.user,{body:{...f.wpGrantBody(),...fields}}),409);
 const missing=f.wpGrantBody();delete missing.write;denied(await f.wpGrant(f.user,{body:missing}),400);good(await f.wpGrant());denied(await f.wpGrant(),409);
});

test('candidate search/paging exposes only minimal eligible personnel and validates authorized cursors',async t=>{
 const f=await fixture(t),result=good(await f.wpMembers({query:'?limit=1'}));assert.equal(result.members.length,1);assert.equal(result.hasMore,true);
 const keys=['id','displayName','role','memberRevision','grantRevision','read','write','export'];assert.deepEqual(Object.keys(result.members[0]),keys);
 const all=good(await f.wpMembers()).members;assert.ok(all.some(x=>x.id===f.user));assert.ok(all.some(x=>x.id==='partner-a'));assert.ok(all.every(x=>['manager','partner'].includes(x.role)&&!['administrator-demo','reviewer-demo'].includes(x.id)));
 const second=good(await f.wpMembers({query:'?after='+result.members[0].id+'&limit=1'}));assert.ok(second.members[0].id>result.members[0].id);
 denied(await f.wpMembers({query:'?after=manager-b'}));for(const query of ['?limit=0','?limit=51','?q=x&q=y','?extra=1','?after=','?q=%00'])denied(await f.wpMembers({query}),400);
 assert.deepEqual(good(await f.wpMembers({query:'?q=%25'})).members,[]);assert.deepEqual(good(await f.wpList({query:'?q=%25'})).projects,[]);
 denied(await f.wpList({query:'?after=project-b'}));denied(await f.wpAccess({query:'?q=x'}),400);
});

test('frozen project keeps existing read/export but rejects grant edits and write capability',async t=>{
 const f=await fixture(t),{workpaperAccessContext}=await source('workpaper-access-policy.mjs');good(await f.wpGrant(f.user,{read:true,write:true,export:true}));f.db.prepare("UPDATE team_projects SET status='frozen' WHERE project_id=?").run(f.projectId);
 const a=good(await f.wpAccess()).access;assert.equal(a.read,true);assert.equal(a.canExport,true);assert.equal(a.canWrite,false);assert.equal(a.canManageAccess,false);
 assert.equal(workpaperAccessContext(f.db,{userId:f.user},'team-a',f.projectId,{export:true}).grant.export,true);assert.throws(()=>workpaperAccessContext(f.db,{userId:f.user},'team-a',f.projectId,{write:true}),e=>e.status===409);
 denied(await f.wpGrant('partner-a'),409);
});

test('foundation rejects data/import/edit/export/review routes until actual workpaper adaptation exists',async t=>{
 const f=await fixture(t);good(await f.wpGrant(f.user,{read:true,write:true,export:true}));
 for(const suffix of ['', '/import','/save','/export','/review','/unfreeze','/freeze'])for(const method of ['GET','POST']){const r=await f.api(f.wpRoute()+suffix,{session:f.actor,method,...(method==='POST'?{body:{}}:{})});denied(r,method==='GET'?404:405);if(method==='POST')assert.equal(r.headers.get('Allow'),'GET');}
 assert.equal((await f.wpAccess({method:'DELETE'})).status,405);denied(await f.wpAccess({strict:false}),403);
});
