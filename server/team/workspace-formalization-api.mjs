import codec from '../../dist/legacy-project-source.js';
import {consume,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {projectActor,currentActor,projectContext,projectScope,projectIncrement,projectTime} from './project-access-policy.mjs';
import {COLLECTION_WORKSPACE_KIND} from './workspace-creation-policy.mjs';
import {formalizationConflict,formalizationDigest,formalizationReceipt,formalizationRequestUsed,FORMALIZATION_MODE} from './workspace-formalization-policy.mjs';
import {UUID} from './device-policy.mjs';
import {ApiError,ID,deny,invalid,json,readJson,transaction} from './http-utils.mjs';
const FIELDS=['requestId','source','sourceSha256','projectRevision','currentPassword','businessConfirmed'];
const RECEIPT='formal.request_id,formal.team_id,formal.project_id,formal.source_project_id,formal.source_title,formal.source_sha256,formal.business_number,formal.confirmed_by,CAST(formal.confirmed_at AS TEXT) confirmed_at,CAST(formal.project_revision_before AS TEXT) project_revision_before,CAST(formal.project_revision_after AS TEXT) project_revision_after,formal.confirmation_mode';
const method=allow=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow});
function ownerContext(db,actor,teamId,projectId){const context=projectContext(db,actor,teamId,projectId,{owner:true});if(context.project.kind!==COLLECTION_WORKSPACE_KIND)deny();return context;}
function scopedRow(db,actor,teamId,projectId,requestId){
 const scope=projectScope(actor,{owner:true});return db.prepare(`SELECT ${RECEIPT} FROM team_workspace_formalizations formal JOIN team_projects project ON project.team_id=formal.team_id AND project.project_id=formal.project_id JOIN team_project_access_projects metadata ON metadata.team_id=project.team_id AND metadata.project_id=project.project_id WHERE formal.team_id=? AND formal.project_id=? ${requestId?'AND formal.request_id=?':''} AND ${scope.sql}`).get(teamId,projectId,...(requestId?[requestId]:[]),...scope.parameters);
}
function resourceFacts(db,teamId,projectId){
 const metadata={...db.prepare('SELECT * FROM team_project_access_projects WHERE team_id=? AND project_id=?').get(teamId,projectId)};delete metadata.revision;
 return JSON.stringify({project:db.prepare('SELECT * FROM team_projects WHERE team_id=? AND project_id=?').get(teamId,projectId),metadata,creation:db.prepare('SELECT * FROM team_collection_workspace_creations WHERE team_id=? AND project_id=?').get(teamId,projectId),legacy:db.prepare('SELECT * FROM team_project_grants WHERE team_id=? AND project_id=? ORDER BY user_id,permission').all(teamId,projectId),acl:db.prepare('SELECT * FROM team_project_access_grants WHERE team_id=? AND project_id=? ORDER BY user_id,permission').all(teamId,projectId)});
}
function conflicts(db,teamId,projectId,body,source){
 const q=source.initiation.quoteId,n=source.numbering.identity;
 if(formalizationRequestUsed(db,body.requestId)||db.prepare('SELECT 1 FROM team_workspace_formalizations WHERE project_id=? OR source_project_id=? OR (team_id=? AND number_year=? AND number_sequence=?)').get(projectId,q,teamId,n.year,n.sequence)
 ||db.prepare('SELECT 1 FROM team_project_migration_provenance WHERE project_id=? OR project_id=? OR (team_id=? AND number_year=? AND number_sequence=?)').get(q,projectId,teamId,n.year,n.sequence)
 ||db.prepare('SELECT 1 FROM team_projects WHERE project_id=? AND (team_id<>? OR project_id<>?)').get(q,teamId,projectId))formalizationConflict();
}
const changes=db=>{const q=db.prepare('SELECT total_changes() n');q.setReadBigInts(true);return q.get().n;};
export async function handleWorkspaceFormalizationRequest(request,{db,now=Date.now,identityProviders={},deviceContext}={}){
 const url=new URL(request.url),match=/^\/api\/teams\/([^/]+)\/projects\/([^/]+)\/formalization(?:\/receipts\/([^/]+))?$/.exec(url.pathname);if(!match)return null;
 const [,teamId,projectId,requestId]=match;if(!ID.test(teamId)||!ID.test(projectId)||requestId&&!UUID.test(requestId))deny();if(url.search)invalid();
 if(requestId?request.method!=='GET':!['GET','POST'].includes(request.method))return method(requestId?'GET':'GET, POST');
 const options={now,identityProviders,deviceContext},actor=projectActor(db,request,options,projectTime(now())),before=ownerContext(db,actor,teamId,projectId),facts=resourceFacts(db,teamId,projectId);
 const fresh=(revision=before.project.revision)=>{const current=currentActor(db,request,actor,options,projectTime(now())),context=ownerContext(db,current,teamId,projectId);if(context.member.stamp!==before.member.stamp||context.project.revision!==revision||resourceFacts(db,teamId,projectId)!==facts)formalizationConflict();return context;};
 if(request.method==='GET'){
  const row=scopedRow(db,actor,teamId,projectId,requestId);fresh();if(requestId&&!row)deny();
  return requestId?json({receipt:formalizationReceipt(row)}):json({context:{teamId,projectId,projectRevision:before.project.revision,canConfirm:before.project.status==='active'&&before.project.revision<Number.MAX_SAFE_INTEGER&&!row,confirmation:row?formalizationReceipt(row):null}});
 }
 const body=await readJson(request,FIELDS,132*1024);fresh();
 if(Object.keys(body).length!==FIELDS.length||!UUID.test(body.requestId??'')||typeof body.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(body.sourceSha256)||!Number.isSafeInteger(body.projectRevision)||body.projectRevision<1||body.businessConfirmed!==true||typeof body.currentPassword!=='string'||!body.currentPassword||Buffer.byteLength(body.currentPassword)>512)invalid();
 if(before.project.status!=='active'||body.projectRevision!==before.project.revision)formalizationConflict();const afterRevision=projectIncrement(body.projectRevision);
 let source,sourceJson,summary;try{source=codec.validate(body.source);sourceJson=Buffer.from(codec.encode(source)).toString('utf8');summary=codec.summary(source);}catch{invalid();}
 if(formalizationDigest(sourceJson)!==body.sourceSha256)invalid();
 const check=()=>{const context=fresh();if(context.project.status!=='active')formalizationConflict();conflicts(db,teamId,projectId,body,source);return context;};check();
 consume(db,'workspace-formalization:'+formalizationDigest(actor.userId),projectTime(now()),15*60000,20);
 return limitedPasswordWork(db,async()=>{
  const valid=await verifyPassword(body.currentPassword,before.member.credential.password_hash);check();if(!valid)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
  return transaction(db,()=>{
   check();const startChanges=changes(db),at=projectTime(now()),semantic=formalizationDigest(JSON.stringify({teamId,projectId,confirmedBy:actor.userId,projectRevision:body.projectRevision,sourceSha256:body.sourceSha256,confirmationMode:FORMALIZATION_MODE}));
   if(db.prepare('UPDATE team_project_access_projects SET revision=? WHERE team_id=? AND project_id=? AND revision=?').run(afterRevision,teamId,projectId,body.projectRevision).changes!==1)formalizationConflict();
   db.prepare('INSERT INTO team_workspace_formalizations(request_id,team_id,project_id,source_project_id,source_title,source_sha256,source_json,business_number,number_year,number_sequence,first_won_at,initiation_won_at,latest_won_at,confirmed_by,confirmed_at,project_revision_before,project_revision_after,request_sha256,confirmation_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(body.requestId,teamId,projectId,summary.projectId,summary.title,body.sourceSha256,sourceJson,summary.businessNumber,source.numbering.identity.year,source.numbering.identity.sequence,summary.firstWonAt,summary.initiationWonAt,summary.latestWonAt,actor.userId,at,body.projectRevision,afterRevision,semantic,FORMALIZATION_MODE);
   fresh(afterRevision);const row=db.prepare('SELECT * FROM team_workspace_formalizations WHERE request_id=? AND team_id=? AND project_id=?').get(body.requestId,teamId,projectId);
   const expected={request_id:body.requestId,team_id:teamId,project_id:projectId,source_project_id:summary.projectId,source_title:summary.title,source_sha256:body.sourceSha256,source_json:sourceJson,business_number:summary.businessNumber,number_year:source.numbering.identity.year,number_sequence:source.numbering.identity.sequence,first_won_at:summary.firstWonAt,initiation_won_at:summary.initiationWonAt,latest_won_at:summary.latestWonAt,confirmed_by:actor.userId,confirmed_at:at,project_revision_before:body.projectRevision,project_revision_after:afterRevision,request_sha256:semantic,confirmation_mode:FORMALIZATION_MODE};
   if(!row||Object.keys(expected).some(key=>row[key]!==expected[key])||changes(db)-startChanges!==2n)formalizationConflict();
   return json({receipt:formalizationReceipt(row)},201);
  });
 });
}
