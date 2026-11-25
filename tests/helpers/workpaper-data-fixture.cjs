const {createWorkpaperAccessFixture,good,denied,uuid,sha,source,PASSWORD,restorePasswordWork}=require('./workpaper-access-fixture.cjs');
const {fixture:packageFixture,codec}=require('./workpaper-package-fixture.cjs');
async function createWorkpaperDataFixture(t,{grant=true,freeze=true,...options}={}){
 const f=await createWorkpaperAccessFixture(t,options),formal=f.body();good(await f.confirm(formal),201);const sourceProjectId=formal.source.initiation.quoteId;
 if(grant)good(await f.wpGrant(f.user,{read:true,write:true,export:false}));
 const pack=await packageFixture({id:sourceProjectId,freeze}),output=await codec.create({record:pack.record,readCurrent:async()=>pack.record}),bytes=Buffer.from(output.bytes);
 const revision=()=>f.revision(f.projectId),grantRevision=(user=f.user)=>Number(f.db.prepare('SELECT revision FROM team_workpaper_access_grants WHERE team_id=? AND project_id=? AND user_id=?').get('team-a',f.projectId,user)?.revision??0);
 const startBody=({requestId=uuid(),input=bytes,...rest}={})=>({requestId,projectRevision:revision(),grantRevision:grantRevision(),sourceProjectId,packageSha256:sha(input),byteLength:input.length,chunkCount:Math.ceil(input.length/1048576),...rest});
 const start=(body=startBody(),{current=f.actor,...rest}={})=>f.api(f.wpRoute()+'/imports',{method:'POST',session:current,body,...rest});
 const put=(requestId,index,part=bytes.subarray(index*1048576,(index+1)*1048576),{current=f.actor,...rest}={})=>f.api(f.wpRoute()+'/imports/'+requestId+'/chunks/'+index,{method:'PUT',session:current,body:{sha256:sha(part),data:part.toString('base64')},...rest});
 const commitBody=(rest={})=>({projectRevision:revision(),grantRevision:grantRevision(),sourceVerified:true,currentPassword:PASSWORD,...rest});
 const commit=(requestId,{current=f.actor,body=commitBody(),...rest}={})=>f.api(f.wpRoute()+'/imports/'+requestId+'/commit',{method:'POST',session:current,body,...rest});
 const upload=async({input=bytes,body=startBody({input}),current=f.actor}={})=>{good(await start(body,{current}),201);for(let i=0;i<body.chunkCount;i++)good(await put(body.requestId,i,input.subarray(i*1048576,(i+1)*1048576),{current}));return body.requestId;};
 const receipt=(id,{current=f.actor}={})=>f.api(f.wpRoute()+'/receipts/'+id,{session:current});
 const query=(current=f.actor,version=1)=>'?version='+version+'&projectRevision='+revision()+'&grantRevision='+grantRevision(current.account.id);
 const record=({current=f.actor,version=1,search=query(current,version)}={})=>f.api(f.wpRoute()+'/record'+search,{session:current});
 const original=async(hash,{current=f.actor,version=1,search=query(current,version)}={})=>{const response=await f.dispatch(f.makeRequest(f.wpRoute()+'/originals/'+hash+search,{session:current})),bytes=Buffer.from(await response.arrayBuffer());return{status:response.status,headers:response.headers,bytes,...(response.status===200?{}:{data:JSON.parse(bytes.toString())})};};
 const rows=()=>Object.fromEntries(['heads','versions','originals','imports','chunks'].map(n=>[n,f.db.prepare('SELECT * FROM team_workpaper_data_'+n+' ORDER BY rowid').all()]));
 return{...f,sourceProjectId,pack,output,bytes,dataRevision:revision,dataGrantRevision:grantRevision,startBody,start,put,commitBody,commit,upload,dataReceipt:receipt,dataRecord:record,dataOriginal:original,dataRows:rows};
}
module.exports={createWorkpaperDataFixture,good,denied,uuid,sha,source,PASSWORD,codec,restorePasswordWork};
