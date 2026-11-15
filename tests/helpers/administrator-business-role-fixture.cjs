'use strict';
// Synthetic only: inherited transport uses actual strict application routes and
// independent Ed25519 request signatures, never a mocked authorization mirror.
const {createProjectAccessFixture,PASSWORD,NOW,keyPair,digest,source}=require('./project-access-fixture.cjs');
const OWNER='business-role-reviewer-demo',ADMIN='administrator-demo';
async function createAdministratorBusinessRoleFixture(t,options={}){
 const f=await createProjectAccessFixture(t,options);
 await(await source('administrator-business-role-demo.mjs')).seedAdministratorBusinessRoleDemo(f.db);
 const list=(actor,query='')=>f.api('/api/administrator-business-roles'+query,{session:actor});
 const approve=(actor,userId=ADMIN,role='assistant',settings={})=>f.api('/api/administrator-business-roles/'+userId,{method:'POST',session:actor,body:{revision:f.epoch(userId),role,currentPassword:PASSWORD,...settings.body},...settings.request});
 const approval=userId=>f.db.prepare('SELECT * FROM team_administrator_business_roles WHERE user_id=?').get(userId);
 const addAdministrator=(userId,{teamId='team-a',role=null,memberStatus='active',displayName=userId}={})=>{
  if(!f.db.prepare('SELECT 1 FROM teams WHERE team_id=?').get(teamId)){f.db.prepare("INSERT INTO teams(team_id,status) VALUES (?,'active')").run(teamId);f.db.prepare('INSERT INTO team_profiles(team_id,name) VALUES (?,?)').run(teamId,'Synthetic '+teamId);}
  f.db.prepare("INSERT INTO team_users(user_id,status) VALUES (?,'active')").run(userId);
  f.db.prepare("INSERT INTO team_credentials(user_id,username,display_name,password_hash) SELECT ?,?,?,password_hash FROM team_credentials WHERE user_id='manager-a'").run(userId,userId,displayName);
  f.db.prepare("INSERT INTO team_operators(team_id,user_id,role,status) VALUES (?,?,'administrator','active')").run(teamId,userId);
  if(role!==null)f.db.prepare('INSERT INTO team_memberships(team_id,user_id,role,status) VALUES (?,?,?,?)').run(teamId,userId,role,memberStatus);
  return userId;
 };
 return {...f,list,approve,approval,addAdministrator};
}
module.exports={createAdministratorBusinessRoleFixture,OWNER,ADMIN,PASSWORD,NOW,keyPair,digest,source};
