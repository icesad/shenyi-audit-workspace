const {fixture,good,denied,uuid,sha,deferred,codec,migrationSource,PASSWORD,source,restorePasswordWork}=require('./workspace-formalization-security-fixture.cjs');
async function createWorkspaceSourceFixture(t,options={}){
 const f=await fixture(t,options),sourceRoute=(id=f.projectId,teamId='team-a')=>f.route(id,teamId).replace(/\/formalization$/,'/initiation-source');
 const access=({current=f.actor,id=f.projectId,teamId='team-a',...request}={})=>f.api(sourceRoute(id,teamId)+'/access',{session:current,...request});
 const members=({current=f.actor,id=f.projectId,teamId='team-a',query='',...request}={})=>f.api(sourceRoute(id,teamId)+'/members'+query,{session:current,...request});
 const read=({current=f.actor,id=f.projectId,teamId='team-a',...request}={})=>f.api(sourceRoute(id,teamId),{session:current,...request});
 const exportSource=async({current=f.actor,id=f.projectId,teamId='team-a',query,raw,...request}={})=>{
  query??='?projectRevision='+f.revision(id,teamId)+'&grantRevision='+Number(f.db.prepare('SELECT revision FROM team_workspace_source_grants WHERE team_id=? AND project_id=? AND user_id=?').get(teamId,id,current.account.id)?.revision??0);
  const response=await f.dispatch(raw??f.makeRequest(sourceRoute(id,teamId)+'/export'+query,{session:current,...request})),bytes=Buffer.from(await response.arrayBuffer());
  return {status:response.status,headers:response.headers,bytes,...(response.status===200?{}:{data:JSON.parse(bytes.toString('utf8'))})};
 };
 const grantBody=(userId=f.user,{id=f.projectId,teamId='team-a',...fields}={})=>({projectRevision:f.revision(id,teamId),userId,memberRevision:f.epoch(userId),grantRevision:Number(f.db.prepare('SELECT revision FROM team_workspace_source_grants WHERE team_id=? AND project_id=? AND user_id=?').get(teamId,id,userId)?.revision??0),read:true,export:false,currentPassword:PASSWORD,...fields});
 const grant=(userId=f.user,{current=f.actor,id=f.projectId,teamId='team-a',body,...fields}={})=>access({current,id,teamId,method:'POST',body:body??grantBody(userId,{id,teamId,...fields})});
 const sourceSnapshot=()=>['team_workspace_source_grants','team_workspace_source_events'].map(name=>({name,rows:f.db.prepare('SELECT * FROM '+name+' ORDER BY '+(name.endsWith('grants')?'team_id,project_id,user_id':'event_id')).all()}));
 return {...f,sourceRoute,access,members,read,exportSource,grantBody,sourceGrant:grant,sourceSnapshot};
}
module.exports={createWorkspaceSourceFixture,good,denied,uuid,sha,deferred,codec,migrationSource,PASSWORD,source,restorePasswordWork};
