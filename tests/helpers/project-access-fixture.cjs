'use strict';
// Explicit synthetic trusted registration; never a product project-create API.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createBusinessRoleFixture,PASSWORD,NOW,keyPair,digest,source}=require('./business-role-fixture.cjs');
async function createProjectAccessFixture(t,{register=true,...options}={}){
 const f=await createBusinessRoleFixture(t,options),{registerManagedProject}=await source('project-access-policy.mjs');
 const registerProject=(projectId='project-a',{teamId='team-a',createdBy=teamId==='team-a'?'manager-a':'manager-b',title='Synthetic managed collection project',initialize=true}={})=>{
  f.db.exec('BEGIN IMMEDIATE');try{
   if(!f.db.prepare('SELECT 1 FROM team_projects WHERE team_id=? AND project_id=?').get(teamId,projectId))f.db.prepare("INSERT INTO team_projects(team_id,project_id,title,status) VALUES (?,?,?,'active')").run(teamId,projectId,title);
   registerManagedProject(f.db,{teamId,projectId,createdBy,at:f.clock.value});
   if(initialize){for(const permission of ['project.owner','collection.review'])f.db.prepare("INSERT INTO team_project_access_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,'active')").run(teamId,projectId,createdBy,permission);for(const permission of ['collection.read','collection.manage'])f.db.prepare("INSERT INTO team_project_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,'active') ON CONFLICT(team_id,project_id,user_id,permission) DO UPDATE SET status='active'").run(teamId,projectId,createdBy,permission);}
   f.db.exec('COMMIT');return projectId;
  }catch(cause){f.db.exec('ROLLBACK');throw cause;}
 };
 if(register)registerProject();
 const revision=(projectId='project-a',teamId='team-a')=>Number(f.db.prepare('SELECT CAST(revision AS TEXT) AS revision FROM team_project_access_projects WHERE team_id=? AND project_id=?').get(teamId,projectId)?.revision);
 const route=(projectId='project-a',teamId='team-a')=>'/api/teams/'+teamId+'/projects/'+projectId;
 const grant=(actor,userId='partner-a',flags={read:true,manage:false,review:false},settings={})=>f.api(route(settings.projectId,settings.teamId)+'/access',{method:'POST',session:actor,body:{revision:revision(settings.projectId,settings.teamId),userId,memberRevision:f.epoch(userId),...flags,currentPassword:PASSWORD,...settings.body}});
 const createTask=(actor,{projectId='project-a',teamId='team-a',...body}={})=>f.api(route(projectId,teamId)+'/tasks',{method:'POST',session:actor,body:{revision:revision(projectId,teamId),title:'Synthetic collection task',instructions:'Synthetic collection instructions',...body}});
 const addMember=(userId='senior-'+randomUUID(),{teamId='team-a',role='manager',displayName=userId}={})=>{
  f.db.prepare("INSERT INTO team_users(user_id,status) VALUES (?,'active')").run(userId);f.db.prepare("INSERT INTO team_credentials(user_id,username,display_name,password_hash) SELECT ?,?,?,password_hash FROM team_credentials WHERE user_id='manager-a'").run(userId,userId,displayName);f.db.prepare("INSERT INTO team_memberships(team_id,user_id,role,status) VALUES (?,?,?,'active')").run(teamId,userId,role);return userId;
 };
 const upload=async(actor,{taskId='task-a',teamId='team-a',bytes=Buffer.from('Synthetic project review original\0原件'),filename='synthetic.bin'}={})=>{
  const revision=Number(f.db.prepare('SELECT CAST(revision AS TEXT) AS revision FROM team_task_versions WHERE team_id=? AND task_id=?').get(teamId,taskId)?.revision??0),response=await f.api('/api/teams/'+teamId+'/collection/tasks/'+taskId+'/submissions',{method:'POST',session:actor,body:{revision,filename,contentBase64:bytes.toString('base64')}});assert.equal(response.status,201);return {submission:response.data.submission,bytes,revision:response.data.revision};
 };
 return {...f,registerProject,revision,route,grant,createTask,addMember,upload};
}
module.exports={createProjectAccessFixture,PASSWORD,NOW,keyPair,digest,source};
