import {captureBusinessSubscriptionGuard} from './subscription-business-policy.mjs';
import sourceCodec from '../../dist/legacy-project-source.js';
import {createHash,randomUUID} from 'node:crypto';
import {consume,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {projectActor,currentActor,projectTime,registerManagedProject,managedProject} from './project-access-policy.mjs';
import {migrationConflict,migrationInteger,migrationReviewer,migrationReviewerScope,migrationOwner,migrationQuery,listMigrationTeams,listMigrationOwners,migrationReceipt} from './migration-policy.mjs';
import {UUID} from './device-policy.mjs';
import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex'),FIELDS=['requestId','source','sourceSha256','teamId','ownerUserId','ownerRevision','read','manage','review','currentPassword'];
const RECEIPT_FIELDS='request_id,project_id,team_id,owner_user_id,business_number,source_sha256,can_read,can_manage,can_review,CAST(registered_at AS TEXT) registered_at';
const method=allow=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow});
function state(db,request,before,options,authorityStamp){
 const actor=currentActor(db,request,before,options,projectTime(options.now())),authority=migrationReviewer(db,actor.userId);if(!authority)deny();
 if(authorityStamp!==undefined&&authority.stamp!==authorityStamp)migrationConflict();return {actor,authority};
}
function registrationConflict(db,body,source){
 if(db.prepare('SELECT 1 FROM team_workspace_formalizations WHERE request_id=? OR source_project_id=? OR (team_id=? AND number_year=? AND number_sequence=?)').get(body.requestId,source.initiation.quoteId,body.teamId,source.numbering.identity.year,source.numbering.identity.sequence))migrationConflict();
 if(db.prepare('SELECT 1 FROM team_project_migration_provenance WHERE request_id=? OR project_id=? OR (team_id=? AND number_year=? AND number_sequence=?)').get(body.requestId,source.initiation.quoteId,body.teamId,source.numbering.identity.year,source.numbering.identity.sequence)
 ||db.prepare('SELECT 1 FROM team_projects WHERE project_id=?').get(source.initiation.quoteId))migrationConflict();
}
function publish(db,actor,body,source,sourceBytes,summary,at){
 registrationConflict(db,body,source);
 db.prepare("INSERT INTO team_projects(team_id,project_id,title,status) VALUES (?,?,?,'active')").run(body.teamId,summary.projectId,summary.title);
 // This anchor governs the newly registered team resource; it is NOT the
 // unknown historical creator of the local professional project.
 registerManagedProject(db,{teamId:body.teamId,projectId:summary.projectId,createdBy:body.ownerUserId,at,requestId:body.requestId,requestSha256:body.sourceSha256});
 for(const permission of ['project.owner',...(body.review?['collection.review']:[])])db.prepare("INSERT INTO team_project_access_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,'active')").run(body.teamId,summary.projectId,body.ownerUserId,permission);
 for(const [permission,enabled]of [['collection.read',body.read],['collection.manage',body.manage]])if(enabled)db.prepare("INSERT INTO team_project_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,'active')").run(body.teamId,summary.projectId,body.ownerUserId,permission);
 db.prepare(`INSERT INTO team_project_migration_provenance(request_id,project_id,team_id,owner_user_id,source_sha256,source_json,business_number,number_year,number_sequence,legacy_manager_name,reviewed_by,registered_at,can_read,can_manage,can_review)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(body.requestId,summary.projectId,body.teamId,body.ownerUserId,body.sourceSha256,sourceBytes.toString('utf8'),summary.businessNumber,source.numbering.identity.year,source.numbering.identity.sequence,summary.legacyManagerName,actor.userId,at,Number(body.read),Number(body.manage),Number(body.review));
 db.prepare("INSERT INTO team_project_migration_events(event_id,request_id,team_id,project_id,actor_id,owner_user_id,action,source_sha256,created_at) VALUES (?,?,?,?,?,?,'registered',?,?)").run(randomUUID(),body.requestId,body.teamId,summary.projectId,actor.userId,body.ownerUserId,body.sourceSha256,at);
 const project=managedProject(db,body.teamId,summary.projectId);if(!project||project.createdBy!==body.ownerUserId)migrationConflict();migrationInteger(project.revision,1);
 return migrationReceipt(db.prepare(`SELECT ${RECEIPT_FIELDS} FROM team_project_migration_provenance WHERE request_id=?`).get(body.requestId));
}
export async function handleProjectMigrationRequest(request,{db,now=Date.now,identityProviders={},deviceContext,subscriptionEnforcement='disabled'}={}){
 const url=new URL(request.url),access=url.pathname==='/api/auth/project-migration/access',teams=url.pathname==='/api/project-migrations/teams',owners=/^\/api\/project-migrations\/teams\/([^/]+)\/owners$/.exec(url.pathname),receipt=/^\/api\/project-migrations\/receipts\/([^/]+)$/.exec(url.pathname),register=url.pathname==='/api/project-migrations';
 if(!access&&!teams&&!owners&&!receipt&&!register)return null;
 if((access||receipt||register)&&url.search)invalid();if(request.method!==(register?'POST':'GET'))return method(register?'POST':'GET');
 const options={now,identityProviders,deviceContext},actor=projectActor(db,request,options,projectTime(now()));
 if(access)return json({canReview:!!migrationReviewer(db,actor.userId)});
 const authority=migrationReviewer(db,actor.userId);if(!authority)deny();const fresh=()=>state(db,request,actor,options,authority.stamp);
 if(teams||owners){if(owners&&!ID.test(owners[1]))deny();const query=migrationQuery(url.searchParams),result=teams?listMigrationTeams(db,actor.userId,query):listMigrationOwners(db,actor.userId,owners[1],query);fresh();return json(result);}
 if(receipt){if(!UUID.test(receipt[1]))deny();const scope=migrationReviewerScope(actor.userId),row=db.prepare(`SELECT ${RECEIPT_FIELDS} FROM team_project_migration_provenance provenance WHERE provenance.request_id=? AND provenance.reviewed_by=? AND ${scope.sql}`).get(receipt[1],actor.userId,...scope.parameters);fresh();if(!row)deny();return json(migrationReceipt(row));}
 const body=await readJson(request,FIELDS,132*1024);fresh();
 if(Object.keys(body).length!==FIELDS.length||!UUID.test(body.requestId??'')||!ID.test(body.teamId??'')||!ID.test(body.ownerUserId??'')||!Number.isSafeInteger(body.ownerRevision)||body.ownerRevision<0||!['read','manage','review'].every(key=>typeof body[key]==='boolean')||!body.read&&(body.manage||body.review)||typeof body.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(body.sourceSha256)||typeof body.currentPassword!=='string'||!body.currentPassword||Buffer.byteLength(body.currentPassword)>512)invalid();
 let source,sourceBytes,summary;try{source=sourceCodec.validate(body.source);sourceBytes=Buffer.from(sourceCodec.encode(source));summary=sourceCodec.summary(source);}catch{invalid();}
 if(digest(sourceBytes)!==body.sourceSha256)invalid();
 const owner=migrationOwner(db,body.teamId,body.ownerUserId); if(owner.identityRevision!==body.ownerRevision)migrationConflict();
 const subscriptionGuard=captureBusinessSubscriptionGuard(db,body.teamId,{now,identityProviders,subscriptionEnforcement});
 const current=()=>{const currentState=fresh(),target=migrationOwner(db,body.teamId,body.ownerUserId);if(target.identityRevision!==body.ownerRevision||target.stamp!==owner.stamp)migrationConflict();registrationConflict(db,body,source);subscriptionGuard?.assertCurrent();return currentState;};current();
 consume(db,'project-migration:'+digest(actor.userId),projectTime(now()),15*60000,20);
 return limitedPasswordWork(db,async()=>{
  const valid=await verifyPassword(body.currentPassword,authority.credential.password_hash);current();if(!valid)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
  return transaction(db,()=>{const final=current(),result=publish(db,final.actor,body,source,sourceBytes,summary,projectTime(now()));fresh();const target=migrationOwner(db,body.teamId,body.ownerUserId);if(target.identityRevision!==body.ownerRevision||target.stamp!==owner.stamp)migrationConflict();subscriptionGuard?.assertCurrent();return json(result,201);});
 });
}
