import {randomUUID,createHash} from 'node:crypto';
import {consume,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {projectActor,currentActor,ordinaryTeamContext,projectContext,projectScope,registerManagedProject,managedProject,projectIncrement,projectTime} from './project-access-policy.mjs';
import {COLLECTION_WORKSPACE_KIND,workspaceCreationConflict,workspaceCreationDigest,workspaceCreationRequestUsed,workspaceCreationReceipt} from './workspace-creation-policy.mjs';
import {UUID} from './device-policy.mjs';
import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';

const FIELDS=['requestId','title','read','manage','review','currentPassword'];
const receiptFields='creation.request_id,creation.team_id,creation.project_id,creation.kind,creation.title,creation.created_by,creation.can_read,creation.can_manage,creation.can_review,CAST(creation.created_project_revision AS TEXT) created_project_revision,CAST(creation.created_at AS TEXT) created_at';
const digest=value=>createHash('sha256').update(value).digest('hex');
const method=allow=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow});
function titleText(value){if(typeof value!=='string'||!value.isWellFormed()||[...value].length>300||!value.trim()||/[\p{Cc}\p{Cf}]/u.test(value))invalid();return value.trim();}
function assertUnused(db,requestId){if(workspaceCreationRequestUsed(db,requestId))workspaceCreationConflict();}
function assertResource(db,{teamId,projectId,actorId,title,requestId,requestSha256,at,read,manage,review},expectedRevision){
 const raw=db.prepare('SELECT * FROM team_projects WHERE team_id=? AND project_id=?').get(teamId,projectId),project=managedProject(db,teamId,projectId);
 if(!raw||!project||raw.title!==title||raw.status!=='active'||raw.financial_summary!==''||raw.structure_json!=='{}'||project.createdBy!==actorId||project.createdAt!==at||project.requestId!==requestId||project.requestSha256!==requestSha256||project.revision!==expectedRevision)workspaceCreationConflict();
 projectIncrement(project.revision);
 const legacy=db.prepare('SELECT user_id,permission,status FROM team_project_grants WHERE team_id=? AND project_id=? ORDER BY permission').all(teamId,projectId);
 const expectedLegacy=[...(read?['collection.read']:[]),...(manage?['collection.manage']:[])].sort();
 if(legacy.length!==expectedLegacy.length||legacy.some((row,index)=>row.user_id!==actorId||row.permission!==expectedLegacy[index]||row.status!=='active'))workspaceCreationConflict();
 const acl=db.prepare('SELECT user_id,permission,status,CAST(revision AS TEXT) revision FROM team_project_access_grants WHERE team_id=? AND project_id=? ORDER BY permission').all(teamId,projectId),expectedAcl=['project.owner',...(review?['collection.review']:[])].sort();
 if(acl.length!==expectedAcl.length||acl.some((row,index)=>row.user_id!==actorId||row.permission!==expectedAcl[index]||row.status!=='active'||row.revision!=='1'))workspaceCreationConflict();
 if(db.prepare('SELECT 1 FROM team_project_migration_provenance WHERE request_id=? OR project_id=?').get(requestId,projectId))workspaceCreationConflict();
 if(db.prepare('SELECT COUNT(*) n FROM team_projects WHERE project_id=?').get(projectId).n!==1)workspaceCreationConflict();
 for(const table of ['team_collection_tasks','team_project_access_events','team_material_grants','team_material_records','team_material_files','team_material_events','team_material_imports','team_material_import_chunks','team_material_maintenance_grants','team_material_maintenance_events']){
  if(table==='team_material_import_chunks'){
   if(db.prepare('SELECT 1 FROM team_material_import_chunks chunk JOIN team_material_imports stage ON stage.request_id=chunk.request_id WHERE stage.team_id=? AND stage.project_id=? LIMIT 1').get(teamId,projectId))workspaceCreationConflict();
  }else if(db.prepare('SELECT 1 FROM '+table+' WHERE team_id=? AND project_id=? LIMIT 1').get(teamId,projectId))workspaceCreationConflict();
 }
 return project;
}
export async function handleCollectionWorkspaceCreationRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
 const url=new URL(request.url),match=/^\/api\/teams\/([^/]+)\/collection-workspaces(?:\/receipts\/([^/]+))?$/.exec(url.pathname);if(!match)return null;
 const [,teamId,receiptId]=match;if(!ID.test(teamId)||receiptId&&!UUID.test(receiptId))deny();if(url.search)invalid();
 if(request.method!==(receiptId?'GET':'POST'))return method(receiptId?'GET':'POST');
 const options={now,identityProviders,deviceContext},actor=projectActor(db,request,options,projectTime(now())),member=ordinaryTeamContext(db,actor.userId,teamId);if(!member)deny();
 const fresh=()=>{const current=currentActor(db,request,actor,options,projectTime(now())),context=ordinaryTeamContext(db,current.userId,teamId);if(!context)deny();if(context.stamp!==member.stamp)workspaceCreationConflict();return current;};
 if(receiptId){
  const scope=projectScope(actor,{owner:true}),row=db.prepare(`SELECT ${receiptFields},CAST(metadata.revision AS TEXT) current_project_revision
   FROM team_collection_workspace_creations creation JOIN team_projects project ON project.team_id=creation.team_id AND project.project_id=creation.project_id
   JOIN team_project_access_projects metadata ON metadata.team_id=project.team_id AND metadata.project_id=project.project_id
   WHERE ${scope.sql} AND creation.team_id=? AND creation.request_id=? AND creation.created_by=?`).get(...scope.parameters,teamId,receiptId,actor.userId);
  const current=fresh();if(!row)deny();const context=projectContext(db,current,teamId,row.project_id,{owner:true});if(String(context.project.revision)!==row.current_project_revision)workspaceCreationConflict();return json({receipt:workspaceCreationReceipt(row)});
 }
 const body=await readJson(request,FIELDS,8192);fresh();
 if(Object.keys(body).length!==FIELDS.length||!UUID.test(body.requestId??'')||!['read','manage','review'].every(key=>typeof body[key]==='boolean')||!body.read&&(body.manage||body.review)||typeof body.currentPassword!=='string'||!body.currentPassword||Buffer.byteLength(body.currentPassword)>512)invalid();
 const title=titleText(body.title),requestSha256=workspaceCreationDigest({teamId,createdBy:actor.userId,title,read:body.read,manage:body.manage,review:body.review});assertUnused(db,body.requestId);
 const check=()=>{const current=fresh();assertUnused(db,body.requestId);return current;};
 consume(db,'collection-workspace:'+digest(actor.userId),projectTime(now()),15*60000,20);
 return limitedPasswordWork(db,async()=>{
  const valid=await verifyPassword(body.currentPassword,member.credential.password_hash);check();if(!valid)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
  return transaction(db,()=>{
   check();const at=projectTime(now()),projectId=randomUUID();if(db.prepare('SELECT 1 FROM team_projects WHERE project_id=?').get(projectId))workspaceCreationConflict();
   db.prepare("INSERT INTO team_projects(team_id,project_id,title,status) VALUES (?,?,?,'active')").run(teamId,projectId,title);
   registerManagedProject(db,{teamId,projectId,createdBy:actor.userId,at,requestId:body.requestId,requestSha256});
   for(const permission of ['project.owner',...(body.review?['collection.review']:[])]){projectIncrement(managedProject(db,teamId,projectId).revision);db.prepare("INSERT INTO team_project_access_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,'active')").run(teamId,projectId,actor.userId,permission);}
   for(const [permission,enabled]of [['collection.read',body.read],['collection.manage',body.manage]])if(enabled){projectIncrement(managedProject(db,teamId,projectId).revision);db.prepare("INSERT INTO team_project_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,'active')").run(teamId,projectId,actor.userId,permission);}
   const revision=managedProject(db,teamId,projectId).revision,facts={teamId,projectId,actorId:actor.userId,title,requestId:body.requestId,requestSha256,at,read:body.read,manage:body.manage,review:body.review};assertResource(db,facts,revision);
   db.prepare('INSERT INTO team_collection_workspace_creations(request_id,team_id,project_id,created_by,kind,title,request_sha256,can_read,can_manage,can_review,created_project_revision,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(body.requestId,teamId,projectId,actor.userId,COLLECTION_WORKSPACE_KIND,title,requestSha256,Number(body.read),Number(body.manage),Number(body.review),revision,at);
   fresh();const final=assertResource(db,facts,revision),row=db.prepare('SELECT * FROM team_collection_workspace_creations WHERE request_id=? AND team_id=? AND project_id=? AND created_by=?').get(body.requestId,teamId,projectId,actor.userId);
   if(!row||final.kind!==COLLECTION_WORKSPACE_KIND||row.request_sha256!==requestSha256||row.title!==title||row.can_read!==Number(body.read)||row.can_manage!==Number(body.manage)||row.can_review!==Number(body.review)||row.created_project_revision!==revision||row.created_at!==at)workspaceCreationConflict();
   return json({receipt:workspaceCreationReceipt(row)},201);
  });
 });
}
