'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createProjectAccessFixture,PASSWORD,digest,source}=require('./project-access-fixture.cjs');
const {migrationSource}=require('./project-migration-fixture.cjs');
const preservation=require('./material-preservation-security-fixture.cjs'),codec=require('../../dist/legacy-project-source.js');
async function createWorkspaceMaterialsFixture(t,{sameIdentity=false,confirm=true,...options}={}){
 const f=await createProjectAccessFixture(t,{register:false,...options}),owner=await f.ready('manager-a');
 const created=await f.api('/api/teams/team-a/collection-workspaces',{method:'POST',session:owner,body:{requestId:randomUUID(),title:'Synthetic workspace material resource',read:false,manage:false,review:false,currentPassword:PASSWORD}});assert.equal(created.status,201,JSON.stringify(created.data));
 const projectId=created.data.receipt.projectId,sourceProjectId=sameIdentity?projectId:randomUUID(),legacy=migrationSource({id:sourceProjectId}),base='/api/teams/team-a/projects/'+projectId+'/materials',revision=()=>f.revision(projectId);
 const confirmSource=()=>f.api('/api/teams/team-a/projects/'+projectId+'/formalization',{method:'POST',session:owner,body:{requestId:randomUUID(),source:legacy,sourceSha256:digest(codec.encode(legacy)),projectRevision:revision(),currentPassword:PASSWORD,businessConfirmed:true}});
 if(confirm)assert.equal((await confirmSource()).status,201);
 const access=actor=>f.api(base+'/access',{session:actor});
 const grant=async(actor=owner,userId='manager-a',flags={read:true,import:true,review:true,close:true,maintain:true})=>f.api(base+'/access',{method:'POST',session:actor,body:{projectRevision:revision(),userId,memberRevision:f.epoch(userId),grantRevision:Number(f.db.prepare('SELECT revision FROM team_material_grants WHERE team_id=? AND project_id=? AND user_id=?').get('team-a',projectId,userId)?.revision??0),maintenanceRevision:Number(f.db.prepare('SELECT revision FROM team_material_maintenance_grants WHERE team_id=? AND project_id=? AND user_id=?').get('team-a',projectId,userId)?.revision??0),...flags,currentPassword:PASSWORD}});
 const pack=async({id=sourceProjectId,...settings}={})=>{const original=preservation.fixture({id,closed:false,...settings}),made=await preservation.create(original);return {original,made,bytes:Buffer.from(await made.blob.arrayBuffer())};};
 const stage=async(actor,package_)=>{const started=await f.api(base+'/imports',{method:'POST',session:actor,body:{requestId:randomUUID(),projectRevision:revision(),packageSha256:digest(package_.bytes),byteLength:package_.bytes.length,chunkCount:Math.ceil(package_.bytes.length/1048576)}});assert.equal(started.status,201,JSON.stringify(started.data));for(let index=0;index<Math.ceil(package_.bytes.length/1048576);index++){const part=package_.bytes.subarray(index*1048576,(index+1)*1048576),put=await f.api(base+'/imports/'+started.data.requestId+'/chunks/'+index,{method:'PUT',session:actor,body:{sha256:digest(part),data:part.toString('base64')}});assert.equal(put.status,200,JSON.stringify(put.data));}return started.data;};
 const commit=(actor,requestId)=>f.api(base+'/imports/'+requestId+'/commit',{method:'POST',session:actor,body:{projectRevision:revision(),currentPassword:PASSWORD}});
 const record=actor=>f.api(base,{session:actor});
 const action=async(actor,value)=>{const view=await record(actor);assert.equal(view.status,200);return f.api(base+'/actions',{method:'POST',session:actor,body:{requestId:randomUUID(),projectRevision:revision(),materialRevision:view.data.materialRevision,recordSha256:view.data.recordSha256,action:value,currentPassword:value.type==='item'?null:PASSWORD}});};
 return {...f,owner,projectId,sourceProjectId,legacy,base,revision,confirmSource,access,grant,pack,stage,commit,record,action};
}
module.exports={createWorkspaceMaterialsFixture,PASSWORD,digest,source,preservation};
