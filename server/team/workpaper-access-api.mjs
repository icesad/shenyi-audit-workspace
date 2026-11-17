import {consume,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {projectTime} from './project-access-policy.mjs';
import {workpaperAccessActor,currentWorkpaperAccessActor,workpaperAccessContext,workpaperAccessContextStamp,workpaperAccessGrant,workpaperAccessTarget,workpaperAccessMembers,workpaperAccessProjects,workpaperAccessQuery,workpaperAccessDigest,workpaperAccessConflict} from './workpaper-access-policy.mjs';
import {writeWorkpaperAccessGrant,workpaperAccessAudit} from './workpaper-access-grant.mjs';
import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';

const FIELDS=['projectRevision','userId','memberRevision','grantRevision','read','write','export','currentPassword'];
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
const changes=db=>{const q=db.prepare('SELECT total_changes() n');q.setReadBigInts(true);return q.get().n;};
const method=allow=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow.join(', ')});
export async function handleWorkpaperAccessRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
 const url=new URL(request.url),listing=/^\/api\/teams\/([^/]+)\/workpaper-projects$/.exec(url.pathname),match=/^\/api\/teams\/([^/]+)\/projects\/([^/]+)\/workpapers\/(access|members)$/.exec(url.pathname);
 if(!listing&&!match)return null;
 const teamId=(listing??match)[1];if(!ID.test(teamId)||url.hash||url.href.endsWith('?'))invalid();
 const options={identityProviders,deviceContext},actor=workpaperAccessActor(db,request,options,projectTime(now()));
 if(listing){if(request.method!=='GET')return method(['GET']);return transaction(db,()=>{const start=changes(db),result=workpaperAccessProjects(db,actor,teamId,workpaperAccessQuery(url.searchParams));currentWorkpaperAccessActor(db,request,actor,options,projectTime(now()));if(changes(db)!==start)workpaperAccessConflict();return json(result);});}
 const projectId=match[2],tail=match[3];if(!ID.test(projectId))deny();if(tail!=='members'&&url.search)invalid();
 const allow=tail==='access'?['GET','POST']:['GET'];if(!allow.includes(request.method))return method(allow);
 const changing=request.method==='POST',permissions={...(tail==='members'||changing?{owner:true}:{}),...(changing?{active:true}:{})},before=workpaperAccessContext(db,actor,teamId,projectId,permissions);
 const fresh=(grant=true)=>{const current=currentWorkpaperAccessActor(db,request,actor,options,projectTime(now())),context=workpaperAccessContext(db,current,teamId,projectId,permissions);if(workpaperAccessContextStamp(context,{grant})!==workpaperAccessContextStamp(before,{grant}))workpaperAccessConflict();return context;};
 if(request.method==='GET')return transaction(db,()=>{
  const start=changes(db);fresh();const result=tail==='members'?workpaperAccessMembers(db,teamId,projectId,workpaperAccessQuery(url.searchParams)):{access:{teamId,projectId,projectRevision:before.project.revision,grantRevision:before.grant.revision,read:before.grant.read,write:before.grant.write,export:before.grant.export,canWrite:before.grant.read&&before.grant.write&&before.project.status==='active',canExport:before.grant.read&&before.grant.export,canManageAccess:before.owner&&before.project.status==='active'}};
  fresh();if(changes(db)!==start)workpaperAccessConflict();return json(result);
 });
 const body=await readJson(request,FIELDS,4096);fresh(false);
 if(Object.keys(body).length!==FIELDS.length||!integer(body.projectRevision,1)||typeof body.userId!=='string'||!ID.test(body.userId)||!integer(body.memberRevision)||!integer(body.grantRevision)||!['read','write','export'].every(key=>typeof body[key]==='boolean')||typeof body.currentPassword!=='string'||!body.currentPassword||Buffer.byteLength(body.currentPassword)>512)invalid();
 if(body.projectRevision!==before.project.revision)workpaperAccessConflict();
 const target=workpaperAccessTarget(db,teamId,body.userId),grant=workpaperAccessGrant(db,teamId,projectId,body.userId),any=body.read||body.write||body.export;
 if(target.identityRevision!==body.memberRevision||grant.revision!==body.grantRevision||!grant.exists&&!any||grant.exists&&grant.rawRead===body.read&&grant.rawWrite===body.write&&grant.rawExport===body.export&&(grant.eligible||!any))workpaperAccessConflict();
 const check=()=>{fresh(false);if(workpaperAccessTarget(db,teamId,body.userId).stamp!==target.stamp||workpaperAccessGrant(db,teamId,projectId,body.userId).stamp!==grant.stamp)workpaperAccessConflict();};check();
 consume(db,'workpaper-access:'+workpaperAccessDigest(actor.userId),projectTime(now()),15*60000,20);
 return limitedPasswordWork(db,async()=>{
  const valid=await verifyPassword(body.currentPassword,before.member.credential.password_hash);check();if(!valid)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
  return transaction(db,()=>{
   check();const start=changes(db),after=writeWorkpaperAccessGrant(db,{teamId,projectId,userId:body.userId,read:body.read,write:body.write,export:body.export,before:grant});
   workpaperAccessAudit(db,{teamId,projectId,actorId:actor.userId,userId:body.userId,action:'access.changed',before:grant,after,at:projectTime(now())});
   fresh(false);if(workpaperAccessTarget(db,teamId,body.userId).stamp!==target.stamp||workpaperAccessGrant(db,teamId,projectId,body.userId).stamp!==after.stamp||changes(db)-start!==2n)workpaperAccessConflict();
   return json({changed:true,projectRevision:before.project.revision});
  });
 });
}
