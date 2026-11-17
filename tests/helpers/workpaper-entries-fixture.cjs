const {randomUUID}=require('node:crypto');
const {formFixture,holdOfficeResult,good,denied,sha,source,restorePasswordWork}=require('./workpaper-form-fixture.cjs');
async function entriesFixture(t,options={}){
 const f=await formFixture(t,options),head=()=>Number(f.db.prepare('SELECT revision FROM team_workpaper_data_heads WHERE team_id=? AND project_id=?').get('team-a',f.projectId).revision),change=options.kind==='docx'?{sheet:'$document',field:'native:p0',value:'saved native Word answer'}:options.kind==='doc'?{sheet:'$document',field:'p0',value:'saved legacy Word answer'}:{sheet:'原表',field:'A2',value:'saved original sheet answer'};
 const body=(fields={},current=f.actor)=>({requestId:randomUUID(),headRevision:head(),projectRevision:f.dataRevision(),grantRevision:f.dataGrantRevision(current.account.id),changes:[change],...fields});
 const write=({current=f.actor,hash=f.document.sha256,body:input=body({},current),...settings}={})=>f.api(f.wpRoute()+'/entries/'+hash,{method:'POST',session:current,body:input,...settings});
 const latest=({current=f.actor}={})=>f.dataRecord({current,version:head()});
 return{...f,head,entryBody:body,write,latest,change};
}
module.exports={entriesFixture,holdOfficeResult,good,denied,sha,source,restorePasswordWork};