import governance from '../../dist/workpaper-governance.js';
import {workpaperAccessActor,currentWorkpaperAccessActor} from './workpaper-access-policy.mjs';
import {dataContext,dataContextStamp,dataConflict,SHA} from './workpaper-data-policy.mjs';
import {changeCount,checkedDataHead,checkedDataVersion} from './workpaper-data-store.mjs';
import {workpaperFormTask} from './workpaper-form-source.mjs';
import {inspectWorkpaperOriginal} from './workpaper-office.mjs';
import {acquireWorkpaperDataPermit} from './workpaper-data-budget.mjs';
import {projectTime} from './project-access-policy.mjs';
import {ApiError,ID,deny,invalid,json,transaction} from './http-utils.mjs';
export async function handleWorkpaperFormRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
 const url=new URL(request.url),match=/^\/api\/teams\/([^/]+)\/projects\/([^/]+)\/workpapers\/forms\/([^/]+)$/.exec(url.pathname);if(!match)return null;const [,teamId,projectId,hash]=match;if(!ID.test(teamId)||!ID.test(projectId)||url.hash)invalid();if(!SHA.test(hash))deny();if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});
 const at=()=>projectTime(now()),options={identityProviders,deviceContext},actor=workpaperAccessActor(db,request,options,at()),context=dataContext(db,actor,teamId,projectId,{read:true}),stamp=dataContextStamp(context);
 const fresh=()=>{const current=currentWorkpaperAccessActor(db,request,actor,options,at()),next=dataContext(db,current,teamId,projectId,{read:true});if(dataContextStamp(next)!==stamp)dataConflict();return next;};
 const readOnly=work=>transaction(db,()=>{const start=changeCount(db);fresh();const value=work();fresh();if(changeCount(db)!==start)dataConflict();return value;});
 const keys=['version','projectRevision','grantRevision'],query={};if(url.searchParams.size!==3||[...url.searchParams.keys()].some(k=>!keys.includes(k)||url.searchParams.getAll(k).length!==1))invalid();for(const key of keys){const raw=url.searchParams.get(key);if(!/^[1-9][0-9]*$/.test(raw??'')||!Number.isSafeInteger(Number(raw)))invalid();query[key]=Number(raw);}if(query.projectRevision!==context.project.revision||query.grantRevision!==context.grant.revision)dataConflict();
 const release=acquireWorkpaperDataPermit(db,actor.userId,{large:true});try{
  const initial=readOnly(()=>{const value=checkedDataVersion(db,context,query.version);return{value,task:workpaperFormTask(db,context,value,hash)};});let form;
  try{form=await inspectWorkpaperOriginal(initial.task,{signal:request.signal});}catch{fresh();throw new ApiError(422,'WORKPAPER_FORM_UNAVAILABLE','原表格式、来源或版式未通过核验，未开放填写位置；原件仍保留。');}
  return readOnly(()=>{const value=checkedDataVersion(db,context,query.version),head=checkedDataHead(db,context);if(value.row.record_sha256!==initial.value.row.record_sha256||form.sha256!==hash)dataConflict();
   if(form.kind==='excel')for(const sheet of form.sheets){sheet.frozen=!!governance.isLocked(value.record,hash,sheet.name);sheet.readOnly=sheet.readOnly||sheet.frozen;}
   else{form.frozen=!!governance.isLocked(value.record,hash);form.readOnly=form.frozen;if(form.frozen)form.editable=[];}
   return json({form,version:query.version,headRevision:head.revision,recordRevision:value.row.record_revision,recordSha256:value.row.record_sha256,sourceProjectId:head.source_project_id,projectRevision:context.project.revision,grantRevision:context.grant.revision});
  });
 }finally{release();}
}