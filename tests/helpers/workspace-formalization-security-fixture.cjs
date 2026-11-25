'use strict';
// Independent synthetic setup. Authorization always traverses the real signed app.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {syncBuiltinESMExports}=require('node:module');
const {createProjectAccessFixture,PASSWORD,source}=require('./project-access-fixture.cjs');
const {migrationSource,REVIEWER}=require('./project-migration-fixture.cjs');
const codec=require('../../dist/legacy-project-source.js');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createTeamClient}=require('../../desktop/team-client.cjs'),proof=require('../../shared/device-proof.cjs');
const {createWorkspaceFormalizationManager}=require('../../desktop/workspace-formalization.cjs');
const uuid=()=>crypto.randomUUID(),sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return{promise,resolve,reject};};
const nativeScrypt=crypto.scrypt;let nextHold=null;
crypto.scrypt=function(...args){const callback=args.pop(),hold=nextHold;nextHold=null;return nativeScrypt(...args,(error,value)=>{if(!hold)return callback(error,value);hold.entered.resolve();void hold.release.promise.then(()=>callback(error,value));});};
syncBuiltinESMExports();
function restorePasswordWork(){crypto.scrypt=nativeScrypt;syncBuiltinESMExports();}
function good(response,status=200){assert.equal(response.status,status,JSON.stringify(response.data));return response.data;}
function denied(response,status=404){assert.equal(response.status,status,JSON.stringify(response.data));assert.ok(response.data?.error);assert.equal(Object.hasOwn(response.data,'receipt'),false);assert.doesNotMatch(JSON.stringify(response.data),/password_hash|token_hash|scrypt\$|SQLITE|privateKey/);return response;}
async function fixture(t,{user='manager-a',flags={read:true,manage:true,review:true},migration=false}={}){
 const f=await createProjectAccessFixture(t,{register:false});
 if(migration){await(await source('administrator-business-role-demo.mjs')).seedAdministratorBusinessRoleDemo(f.db);await(await source('migration-demo.mjs')).seedProjectMigrationDemo(f.db);}
 const actor=await f.ready(user);
 const create=async({current=actor,teamId='team-a',requestId=uuid(),title='Independent collection workspace',...permissions}={})=>f.api('/api/teams/'+teamId+'/collection-workspaces',{method:'POST',session:current,body:{requestId,title,read:true,manage:true,review:true,currentPassword:PASSWORD,...permissions}});
 const creation=good(await create(flags),201).receipt,projectId=creation.projectId;
 const route=(id=projectId,teamId='team-a')=>f.route(id,teamId)+'/formalization';
 const body=(fields={})=>{const value=fields.source??migrationSource({id:uuid(),sequence:43});return{requestId:uuid(),source:value,sourceSha256:sha(codec.encode(value)),projectRevision:f.revision(projectId),currentPassword:PASSWORD,businessConfirmed:true,...fields};};
 const confirm=(value=body(),{current=actor,id=projectId,teamId='team-a',...request}={})=>f.api(route(id,teamId),{method:'POST',session:current,body:value,...request});
 const context=({current=actor,id=projectId,teamId='team-a'}={})=>f.api(route(id,teamId),{session:current});
 const receipt=(requestId,{current=actor,id=projectId,teamId='team-a'}={})=>f.api(route(id,teamId)+'/receipts/'+requestId,{session:current});
 const view=(id=projectId,current=actor,teamId='team-a')=>f.api(f.route(id,teamId),{session:current});
 function snapshot({resourcesOnly=false,omit=[],revisionOf=null}={}){
  const names=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name).filter(n=>!['team_auth_limits','team_device_request_replays',...omit].includes(n)&&(!resourcesOnly||/^team_(?:projects$|project_|collection_|task_|attachment_|material_|workspace_)/.test(n)));
  return names.map(name=>{const q=f.db.prepare('SELECT * FROM "'+name+'"');q.setReadBigInts(true);return{name,rows:q.all().map(row=>{if(name==='team_project_access_projects'&&revisionOf&&row.project_id===revisionOf)row.revision='TARGET_REVISION';return JSON.stringify(Object.keys(row).sort().map(k=>[k,typeof row[k]==='bigint'?['integer',String(row[k])]:row[k] instanceof Uint8Array?['blob',Buffer.from(row[k]).toString('base64')]:row[k]]));}).sort()};});
 }
 function passwordHold(){assert.equal(nextHold,null);const h={entered:deferred(),release:deferred()};nextHold=h;t.after(()=>{if(nextHold===h)nextHold=null;h.release.resolve();});return h;}
 function roleABA(current=user){const role=f.db.prepare('SELECT role FROM team_memberships WHERE user_id=?').get(current).role;f.db.prepare("UPDATE team_memberships SET role='intern' WHERE user_id=?").run(current);f.db.prepare('UPDATE team_memberships SET role=? WHERE user_id=?').run(role,current);}
 async function register({current,teamId='team-a',source:value=migrationSource({id:uuid(),sequence:44}),requestId=uuid()}={}){assert.ok(migration);current??=await f.ready(REVIEWER);return f.api('/api/project-migrations',{method:'POST',session:current,body:{requestId,source:value,sourceSha256:sha(codec.encode(value)),teamId,ownerUserId:teamId==='team-a'?'manager-a':'manager-b',ownerRevision:f.epoch(teamId==='team-a'?'manager-a':'manager-b'),read:true,manage:true,review:true,currentPassword:PASSWORD}});}
 return{...f,actor,user,creation,projectId,create,route,body,confirm,context,receipt,view,snapshot,passwordHold,roleABA,register};
}
async function actualClient(f,t){
 const pair=f.keys.get('manager-a'),transport={trace:[],holds:[],rewrite:null};
 const client=createTeamClient({now:()=>f.clock.value,deviceIdentity:{platform:'win32',displayName:'Independent formalization device',vault:{async getPublicIdentity(){return{publicKey:pair.encoded,fingerprint:sha(Buffer.from(pair.encoded,'base64url'))};},async signChallenge(fields){return crypto.sign(null,proof.challengeBytes(fields),pair.privateKey).toString('base64url');},async signRequest(fields){return crypto.sign(null,proof.requestProofBytes(fields),pair.privateKey).toString('base64url');}}},fetchImpl:async(url,settings)=>{
  const request=new Request(url,settings),info={method:request.method,path:new URL(url).pathname};if(info.method==='POST'&&info.path.endsWith('/formalization')){const body=JSON.parse(await request.clone().text());info.bodyKeys=Object.keys(body).sort();info.requestId=body.requestId;info.sourceSha256=body.sourceSha256;}transport.trace.push(info);
  for(const phase of ['before','after']){if(phase==='after'){info.response=await f.dispatch(request);info.status=info.response.status;}const i=transport.holds.findIndex(h=>h.phase===phase&&h.match(info));if(i>=0){const h=transport.holds.splice(i,1)[0];h.entered.resolve(info);await h.release.promise;}}
  return transport.rewrite?transport.rewrite(info,info.response):info.response;
 }});
 await client.login({username:'manager-a',password:PASSWORD});assert.equal((await client.getDeviceStatus()).state,'ready');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'shenyi-formal-security-')),filename=path.join(directory,'saved-formal-source.json'),value=migrationSource({id:uuid(),sequence:43});await fs.writeFile(filename,codec.encode(value),{flag:'wx'});
 const io={opens:0,reads:0,dialogCalls:0,picker:null},manager=createWorkspaceFormalizationManager({client,window:{},dialog:{async showOpenDialog(){io.dialogCalls++;return io.picker?io.picker():{canceled:false,filePaths:[filename]};}},fsImpl:{async open(...args){io.opens++;const handle=await fs.open(...args);return{stat:()=>handle.stat(),close:()=>handle.close(),async read(...readArgs){io.reads++;return handle.read(...readArgs);}};}}});
 t.after(async()=>{manager.dispose();client.clearSession();for(const h of transport.holds)h.release.resolve();await fs.rm(directory,{recursive:true,force:true});});
 const target=()=>({teamId:'team-a',projectId:f.projectId,projectRevision:f.revision(f.projectId)}),choose=()=>manager.chooseWorkspaceFormalizationSource(target());
 const input=selected=>({...target(),handle:selected.handle,sourceSha256:selected.sourceSha256,currentPassword:PASSWORD,businessConfirmed:true,confirmed:true});
 function hold(phase='after',match=i=>i.method==='POST'&&i.path.endsWith('/formalization')){const h={phase,match,entered:deferred(),release:deferred()};transport.holds.push(h);t.after(()=>h.release.resolve());return h;}
 return{client,manager,transport,io,filename,value,choose,input,target,hold,posts:()=>transport.trace.filter(i=>i.method==='POST'&&i.path.endsWith('/formalization'))};
}
module.exports={fixture,actualClient,good,denied,uuid,sha,deferred,codec,migrationSource,PASSWORD,source,restorePasswordWork};
