import {createHash} from 'node:crypto';
import {consume,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {projectTime} from './project-access-policy.mjs';
import {workspaceSourceActor,currentWorkspaceSourceActor,workspaceSourceContext,workspaceSourceGrant,workspaceSourceMembers,workspaceSourceQuery,workspaceSourceTarget,workspaceSourceConflict} from './workspace-source-policy.mjs';
import {resolveWorkspaceSource} from './workspace-source-resolver.mjs';
import {writeWorkspaceSourceGrant,workspaceSourceAudit} from './workspace-source-grant.mjs';
import {ApiError,ID,PRIVATE_HEADERS,deny,invalid,json,readJson,transaction} from './http-utils.mjs';

const FIELDS=['projectRevision','userId','memberRevision','grantRevision','read','export','currentPassword'];
// Confirmed is a main-process UI acknowledgement, never a server authority field.
const integer=(value,min=0)=>Number.isSafeInteger(value)&&value>=min;
const digest=value=>createHash('sha256').update(value).digest('hex');
const changes=db=>{const q=db.prepare('SELECT total_changes() n');q.setReadBigInts(true);return q.get().n;};
export async function handleWorkspaceSourceRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
 const url=new URL(request.url),match=/^\/api\/teams\/([^/]+)\/projects\/([^/]+)\/initiation-source(?:\/(access|members|export))?$/.exec(url.pathname);if(!match)return null;
 const [,teamId,projectId,tail]=match;if(!ID.test(teamId)||!ID.test(projectId))deny();if(url.hash||url.href.endsWith('?')||!['members','export'].includes(tail)&&url.search)invalid();
 const methods=tail==='access'?['GET','POST']:['GET'];if(!methods.includes(request.method))return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:methods.join(', ')});
 const options={now,identityProviders,deviceContext},actor=workspaceSourceActor(db,request,options,projectTime(now())),permissions={...(tail==='members'||request.method==='POST'?{owner:true}:{}),...(request.method==='POST'?{active:true}:{}),...(!tail?{read:true}:{}),...(tail==='export'?{read:true,export:true}:{})},before=workspaceSourceContext(db,actor,teamId,projectId,permissions);
 const fresh=(checkGrant=true)=>{const current=currentWorkspaceSourceActor(db,request,actor,options,projectTime(now())),context=workspaceSourceContext(db,current,teamId,projectId,permissions);if(context.member.stamp!==before.member.stamp||context.project.revision!==before.project.revision||context.project.status!==before.project.status||context.owner!==before.owner||checkGrant&&context.grant.stamp!==before.grant.stamp)workspaceSourceConflict();return context;};
 if(request.method==='GET'){
  if(tail==='members'){const result=workspaceSourceMembers(db,teamId,projectId,workspaceSourceQuery(url.searchParams));fresh(false);return json(result);}
  if(tail==='export'){
   if(url.searchParams.size!==2||[...url.searchParams.keys()].some(key=>!['projectRevision','grantRevision'].includes(key)||url.searchParams.getAll(key).length!==1))invalid();
   const versions={};for(const key of ['projectRevision','grantRevision']){const value=url.searchParams.get(key);if(!/^[1-9][0-9]*$/.test(value??'')||!integer(Number(value),1))invalid();versions[key]=Number(value);}
   if(versions.projectRevision!==before.project.revision||versions.grantRevision!==before.grant.revision)workspaceSourceConflict();
   // No asynchronous byte work or writes occur inside this snapshot. Keep the
   // captured device, actor, grant and immutable source facts through COMMIT.
   return transaction(db,()=>{
    fresh();const source=resolveWorkspaceSource(db,teamId,projectId);fresh();const finalSource=resolveWorkspaceSource(db,teamId,projectId);if(!source||source.stamp!==finalSource?.stamp)deny();fresh();
    return new Response(source.bytes,{status:200,headers:{...PRIVATE_HEADERS,'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="shenyi-initiation-source.json"','Content-Length':String(source.byteLength),
     'X-Shenyi-Source-Sha256':source.sourceSha256,'X-Shenyi-Source-Project-Id':source.sourceProjectId,'X-Shenyi-Source-Kind':source.sourceKind,'X-Shenyi-Project-Revision':String(before.project.revision),'X-Shenyi-Source-Grant-Revision':String(before.grant.revision)}});
   });
  }
  const source=resolveWorkspaceSource(db,teamId,projectId);fresh();const finalSource=resolveWorkspaceSource(db,teamId,projectId);if(source?.stamp!==finalSource?.stamp)workspaceSourceConflict();fresh();
  if(tail==='access')return json({access:{teamId,projectId,projectRevision:before.project.revision,grantRevision:before.grant.revision,canManageAccess:before.owner&&before.project.status==='active',sourceAvailable:!!source,read:before.grant.read,export:before.grant.export}});
  if(!source)deny();return json({source:source.source,metadata:{teamId,projectId,projectRevision:before.project.revision,grantRevision:before.grant.revision,sourceKind:source.sourceKind,sourceProjectId:source.sourceProjectId,sourceSha256:source.sourceSha256,byteLength:source.byteLength}});
 }
 const body=await readJson(request,FIELDS,4096);fresh(false);
 if(Object.keys(body).length!==FIELDS.length||typeof body.userId!=='string'||!ID.test(body.userId)||!integer(body.projectRevision,1)||!integer(body.memberRevision)||!integer(body.grantRevision)||!['read','export'].every(k=>typeof body[k]==='boolean')||typeof body.currentPassword!=='string'||!body.currentPassword||Buffer.byteLength(body.currentPassword)>512)invalid();
 if(body.projectRevision!==before.project.revision)workspaceSourceConflict();
 const target=workspaceSourceTarget(db,teamId,body.userId),grant=workspaceSourceGrant(db,teamId,projectId,body.userId);
 if(target.identityRevision!==body.memberRevision||grant.revision!==body.grantRevision)workspaceSourceConflict();
 if(!grant.exists&&!body.read&&!body.export||grant.exists&&grant.rawRead===body.read&&grant.rawExport===body.export&&(grant.eligible||!body.read&&!body.export))workspaceSourceConflict();
 const check=()=>{const context=fresh(false),member=workspaceSourceTarget(db,teamId,body.userId),current=workspaceSourceGrant(db,teamId,projectId,body.userId);if(member.stamp!==target.stamp||current.stamp!==grant.stamp)workspaceSourceConflict();return context;};check();
 consume(db,'workspace-source:'+digest(actor.userId),projectTime(now()),15*60000,20);
 return limitedPasswordWork(db,async()=>{
  const valid=await verifyPassword(body.currentPassword,before.member.credential.password_hash);check();if(!valid)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
  return transaction(db,()=>{
   check();const start=changes(db),after=writeWorkspaceSourceGrant(db,{teamId,projectId,userId:body.userId,read:body.read,export:body.export,before:grant});
   workspaceSourceAudit(db,{teamId,projectId,actorId:actor.userId,userId:body.userId,action:'access.changed',before:grant,after,at:projectTime(now())});
   const context=fresh(false),member=workspaceSourceTarget(db,teamId,body.userId),final=workspaceSourceGrant(db,teamId,projectId,body.userId);
   if(member.stamp!==target.stamp||final.stamp!==after.stamp||changes(db)-start!==2n)workspaceSourceConflict();
   return json({changed:true,projectRevision:context.project.revision});
  });
 });
}
