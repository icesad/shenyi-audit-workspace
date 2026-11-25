'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createProjectMigrationFixture,migrationSource,REVIEWER,PASSWORD,NOW,digest,source}=require('./project-migration-fixture.cjs');
const preservation=require('./material-preservation-security-fixture.cjs');
async function createTeamMaterialsFixture(t,options={}){
 const f=await createProjectMigrationFixture(t,options),reviewer=await f.ready(REVIEWER),owner=await f.ready('manager-a'),registration=await f.register(reviewer);assert.equal(registration.status,201);
 const projectId=registration.data.projectId,base='/api/teams/team-a/projects/'+projectId+'/materials',revision=()=>f.revision(projectId),access=actor=>f.api(base+'/access',{session:actor});
 const grant=async(actor,userId='manager-a',flags={read:true,import:true,review:true,close:true},extra={})=>f.api(base+'/access',{method:'POST',session:actor,body:{projectRevision:revision(),userId,memberRevision:f.epoch(userId),grantRevision:Number(f.db.prepare('SELECT revision FROM team_material_grants WHERE team_id=? AND project_id=? AND user_id=?').get('team-a',projectId,userId)?.revision??0),...flags,currentPassword:PASSWORD,...extra}});
 const pack=async({id=projectId,...settings}={})=>{const original=preservation.fixture({id,closed:false,...settings}),made=await preservation.create(original);return {original,made,bytes:Buffer.from(await made.blob.arrayBuffer())};};
 const begin=(actor,bytes,fields={})=>f.api(base+'/imports',{method:'POST',session:actor,body:{requestId:randomUUID(),projectRevision:revision(),packageSha256:digest(bytes),byteLength:bytes.length,chunkCount:Math.ceil(bytes.length/1048576),...fields}});
 const stage=async(actor,package_,fields={})=>{const result=await begin(actor,package_.bytes,fields);assert.equal(result.status,201,JSON.stringify(result.data));for(let index=0;index<Math.ceil(package_.bytes.length/1048576);index++){const bytes=package_.bytes.subarray(index*1048576,(index+1)*1048576),put=await f.api(base+'/imports/'+result.data.requestId+'/chunks/'+index,{method:'PUT',session:actor,body:{sha256:digest(bytes),data:bytes.toString('base64')}});assert.equal(put.status,200,JSON.stringify(put.data));}return result.data;};
 const commit=(actor,requestId,fields={})=>f.api(base+'/imports/'+requestId+'/commit',{method:'POST',session:actor,body:{projectRevision:revision(),currentPassword:PASSWORD,...fields}});
 const record=actor=>f.api(base,{session:actor});
 const action=async(actor,value,fields={})=>{const view=await record(actor);assert.equal(view.status,200);return f.api(base+'/actions',{method:'POST',session:actor,body:{requestId:randomUUID(),projectRevision:revision(),materialRevision:view.data.materialRevision,recordSha256:view.data.recordSha256,action:value,currentPassword:value.type==='item'?null:PASSWORD,...fields}});};
 return {...f,reviewer,owner,projectId,base,revision,access,grant,pack,begin,stage,commit,record,action};
}
module.exports={createTeamMaterialsFixture,PASSWORD,NOW,digest,source,preservation};
