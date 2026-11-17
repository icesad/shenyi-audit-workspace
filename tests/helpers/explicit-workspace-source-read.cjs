'use strict';
// Explicit synthetic prerequisite for selected historical source-receipt positives only.
const assert=require('node:assert/strict');
const {PASSWORD}=require('./project-access-fixture.cjs');
async function grantSourceRead(f,{actor=f.actor,projectId=f.projectId??f.w?.projectId,teamId='team-a',userId='manager-a'}={}){
 assert.ok(actor&&projectId);const root='/api/teams/'+teamId+'/projects/'+projectId+'/initiation-source';
 const access=await f.api(root+'/access',{session:actor});assert.equal(access.status,200,JSON.stringify(access.data));
 const page=await f.api(root+'/members?limit=50',{session:actor});assert.equal(page.status,200,JSON.stringify(page.data));
 const member=page.data.members.find(x=>x.id===userId);assert.ok(member);
 const result=await f.api(root+'/access',{method:'POST',session:actor,body:{projectRevision:access.data.access.projectRevision,userId,memberRevision:member.memberRevision,grantRevision:member.grantRevision,read:true,export:false,currentPassword:PASSWORD}});
 assert.equal(result.status,200,JSON.stringify(result.data));assert.deepEqual(result.data,{changed:true,projectRevision:access.data.access.projectRevision});return result;
}
module.exports={grantSourceRead};
