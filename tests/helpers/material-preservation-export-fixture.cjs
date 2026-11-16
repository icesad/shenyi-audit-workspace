'use strict';
const assert=require('node:assert/strict');
const {createWorkspaceMaterialsFixture,digest,preservation,source}=require('./workspace-material-identity-fixture.cjs');
const {createTeamMaterialsFixture}=require('./team-materials-fixture.cjs');
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
async function createMaterialPreservationExportFixture(t,{legacy=false,sameIdentity=false,empty=false,v1=false,closed=true,...options}={}){
 const f=legacy?await createTeamMaterialsFixture(t,options):await createWorkspaceMaterialsFixture(t,{sameIdentity,...options});
 assert.equal((await f.grant(f.owner)).status,200);
 let pkg;
 if(!empty){pkg=await f.pack({closed,v1});const staged=await f.stage(f.owner,pkg);assert.equal((await f.commit(f.owner,staged.requestId)).status,201);}
 const plan=(actor=f.owner,suffix='')=>f.api(f.base+'/export-plan'+suffix,{session:actor});
 const packageRoute=plan=>f.base+'/export-package?'+new URLSearchParams(Object.fromEntries(['projectRevision','materialRevision','recordSha256','planSha256'].map(key=>[key,String(plan[key])])));
 const binary=async(plan,actor=f.owner,options={})=>{
  const request=options.request??f.makeRequest(packageRoute(plan),{session:actor});
  const response=await f.dispatch(request),bytes=Buffer.from(await response.arrayBuffer());
  return {response,status:response.status,headers:response.headers,bytes,data:response.headers.get('Content-Type')?.startsWith('application/json')?JSON.parse(bytes.toString()):null};
 };
 const businessSnapshot=()=>Object.fromEntries(f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().filter(row=>!['team_auth_limits','team_device_request_replays'].includes(row.name)).map(({name})=>[name,f.db.prepare('SELECT * FROM "'+name+'"').all()]));
 return {...f,pkg,plan,binary,packageRoute,businessSnapshot,sourceProjectId:f.sourceProjectId??f.projectId};
}
module.exports={createMaterialPreservationExportFixture,digest,preservation,canonical,source};
