import {workpaperAccessActor,currentWorkpaperAccessActor} from './workpaper-access-policy.mjs';
import {dataContext,dataContextStamp,dataConflict,dataDigest} from './workpaper-data-policy.mjs';
import {changeCount,checkedDataHead,checkedDataVersion} from './workpaper-data-store.mjs';
import {acquireWorkpaperDataPermit} from './workpaper-data-budget.mjs';
import {planWorkpaperExport} from './workpaper-export-package.mjs';
import {projectTime} from './project-access-policy.mjs';
import {ApiError,ID,PRIVATE_HEADERS,invalid,json,transaction} from './http-utils.mjs';

export async function handleWorkpaperExportRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
 const url=new URL(request.url),match=/^\/api\/teams\/([^/]+)\/projects\/([^/]+)\/workpapers\/export$/.exec(url.pathname);if(!match)return null;const [,teamId,projectId]=match;
 if(!ID.test(teamId)||!ID.test(projectId)||url.hash||url.href.endsWith('?'))invalid();if(request.method!=='GET')return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:'GET'});

 const at=()=>projectTime(now()),options={identityProviders,deviceContext},actor=workpaperAccessActor(db,request,options,at()),permissions={read:true,export:true},context=dataContext(db,actor,teamId,projectId,permissions),stamp=dataContextStamp(context);
 const keys=['version','projectRevision','grantRevision'],query={};if(url.searchParams.size!==3||[...url.searchParams.keys()].some(k=>!keys.includes(k)||url.searchParams.getAll(k).length!==1))invalid();for(const key of keys){const raw=url.searchParams.get(key);if(!/^[1-9][0-9]*$/.test(raw??'')||!Number.isSafeInteger(Number(raw))||String(Number(raw))!==raw)invalid();query[key]=Number(raw);}
 if(query.projectRevision!==context.project.revision||query.grantRevision!==context.grant.revision)dataConflict();
 const fresh=()=>{if(request.signal.aborted)throw new ApiError(409,'WORKPAPER_EXPORT_INTERRUPTED','导出已中断，请重新核对。');const current=currentWorkpaperAccessActor(db,request,actor,options,at()),next=dataContext(db,current,teamId,projectId,permissions);if(dataContextStamp(next)!==stamp)dataConflict();};
 const readOnly=work=>transaction(db,()=>{const count=changeCount(db);fresh();const result=work();fresh();if(changeCount(db)!==count)dataConflict();return result;});
 const release=acquireWorkpaperDataPermit(db,actor.userId,{large:true});let streaming=false;
 try{
  const initial=readOnly(()=>{const value=checkedDataVersion(db,context,query.version),source=db.prepare('SELECT source_manifest_json,source_manifest_sha256 FROM team_workpaper_data_heads WHERE team_id=? AND project_id=?').get(teamId,projectId);if(!source||dataDigest(source.source_manifest_json)!==source.source_manifest_sha256)dataConflict();return{value,source};});
  const current=()=>{fresh();const head=checkedDataHead(db,context);if(head.revision!==initial.value.head.revision||head.source_package_sha256!==initial.value.head.source_package_sha256||head.source_manifest_sha256!==initial.source.source_manifest_sha256)dataConflict();};
  const readOriginal=hash=>readOnly(()=>{current();const ref=initial.value.references.get(hash),file=db.prepare('SELECT byte_length,bytes FROM team_workpaper_data_originals WHERE team_id=? AND project_id=? AND sha256=?').get(teamId,projectId,hash);if(!ref||!file||file.byte_length!==ref.bytes||file.bytes.length!==ref.bytes||dataDigest(file.bytes)!==hash)dataConflict();return file.bytes;});
  const {head,row}=initial.value,plan=await planWorkpaperExport({scope:{teamId,projectId,sourceProjectId:head.source_project_id,version:row.version,recordRevision:row.record_revision,recordSha256:row.record_sha256},source:{packageSha256:head.source_package_sha256,recordSha256:head.source_record_sha256,manifestSha256:head.source_manifest_sha256,importedAt:head.imported_at},sourceManifestJson:initial.source.source_manifest_json,recordJson:row.record_json,originals:[...initial.value.references].map(([sha256,ref])=>({sha256,bytes:ref.bytes})).sort((a,b)=>a.sha256<b.sha256?-1:a.sha256>b.sha256?1:0),readOriginal,assertCurrent:()=>readOnly(current),createdAt:new Date(at()).toISOString()});
  readOnly(()=>{current();const final=checkedDataVersion(db,context,query.version);if(final.row.record_json!==row.record_json||final.row.record_sha256!==row.record_sha256)dataConflict();});
  const response=new Response(plan.stream({signal:request.signal,onClose:release}),{headers:{...PRIVATE_HEADERS,'Content-Type':'application/zip','Content-Length':String(plan.byteLength),'Content-Disposition':'attachment; filename="shenyi-team-workpapers-v'+row.version+'.zip"','X-Shenyi-Workpaper-Export-Sha256':plan.sha256,'X-Shenyi-Workpaper-Version':String(row.version),'X-Shenyi-Workpaper-Record-Sha256':row.record_sha256,'X-Shenyi-Workpaper-Source-Project-Id':head.source_project_id,'X-Shenyi-Project-Revision':String(context.project.revision),'X-Shenyi-Workpaper-Grant-Revision':String(context.grant.revision)}});streaming=true;return response;
 }finally{if(!streaming)release();}
}
