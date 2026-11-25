const {fixture,good,denied,uuid,sha,source,PASSWORD,restorePasswordWork}=require('./workspace-formalization-security-fixture.cjs');
async function createWorkpaperAccessFixture(t,options={}){
 const f=await fixture(t,{flags:{read:false,manage:false,review:false},...options});
 const route=(id=f.projectId,teamId='team-a')=>f.route(id,teamId).replace(/\/formalization$/,'/workpapers');
 const access=({current=f.actor,id=f.projectId,teamId='team-a',query='',...settings}={})=>f.api(route(id,teamId)+'/access'+query,{session:current,...settings});
 const members=({current=f.actor,id=f.projectId,teamId='team-a',query=''}={})=>f.api(route(id,teamId)+'/members'+query,{session:current});
 const grantBody=(userId=f.user,{id=f.projectId,teamId='team-a',...fields}={})=>({projectRevision:f.revision(id,teamId),userId,memberRevision:f.epoch(userId),grantRevision:Number(f.db.prepare('SELECT revision FROM team_workpaper_access_grants WHERE team_id=? AND project_id=? AND user_id=?').get(teamId,id,userId)?.revision??0),read:true,write:false,export:false,currentPassword:PASSWORD,...fields});
 const grant=(userId=f.user,{current=f.actor,id=f.projectId,teamId='team-a',body,...fields}={})=>access({current,id,teamId,method:'POST',body:body??grantBody(userId,{id,teamId,...fields})});
 const list=({current=f.actor,teamId='team-a',query=''}={})=>f.api('/api/teams/'+teamId+'/workpaper-projects'+query,{session:current});
 const rows=()=>['team_workpaper_access_grants','team_workpaper_access_events'].map(name=>({name,rows:f.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()}));
 return {...f,wpRoute:route,wpAccess:access,wpMembers:members,wpGrantBody:grantBody,wpGrant:grant,wpList:list,wpRows:rows};
}
module.exports={createWorkpaperAccessFixture,good,denied,uuid,sha,source,PASSWORD,restorePasswordWork};
