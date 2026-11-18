import {randomUUID} from 'node:crypto';
import snapshotCodec from '../../dist/ledger-check-snapshot.js';
import {captureBusinessSubscriptionGuard} from './subscription-business-policy.mjs';
import {captureManagementSubscriptionGuard,addsEffectiveAuthority} from './subscription-management-policy.mjs';
import {consume,limitedPasswordWork} from './auth-api.mjs';
import {verifyPassword} from './passwords.mjs';
import {ordinaryTeamContext,projectIncrement,projectRevision,projectTime,safeProjectTitle} from './project-access-policy.mjs';
import {safeMemberText} from './member-access-policy.mjs';
import {ledgerActor,currentLedgerActor,ledgerContext,ledgerContextStamp,ledgerGrant,ledgerHead,ledgerTarget,ledgerMembers,ledgerListQuery,ledgerDigest,ledgerConflict,LEDGER_IMPORT_MAX} from './ledger-check-policy.mjs';
import {writeLedgerGrant,ledgerAudit} from './ledger-check-grant.mjs';
import {ApiError,ID,PRIVATE_HEADERS,deny,invalid,json,readJson,transaction} from './http-utils.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ACCESS=['projectRevision','userId','memberRevision','grantRevision','read','currentPassword'];
const IMPORT=['operationId','projectRevision','grantRevision','headRevision','sourceJson','currentPassword'];
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
const method=allow=>json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持此操作。'}},405,{Allow:allow.join(', ')});
const changes=db=>{const q=db.prepare('SELECT total_changes() n');q.setReadBigInts(true);return q.get().n;};
const exact=(value,keys)=>Object.keys(value).length===keys.length;
const password=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=512;
const receipt=row=>({operationId:row.operation_id,snapshotId:row.snapshot_id,version:row.version,sourceSha256:row.source_sha256,importedAt:row.imported_at});
const metadata=row=>({id:row.snapshot_id,version:row.version,sourceProjectId:row.source_project_id,sourceSha256:row.source_sha256,workspaceRevision:row.workspace_revision,calculatedAt:row.calculated_at,confirmedBy:row.importer_name,importedAt:row.imported_at});
const META='snapshot_id,version,source_project_id,source_sha256,workspace_revision,calculated_at,importer_name,imported_at';
const operation=(db,teamId,projectId,id)=>db.prepare('SELECT * FROM team_ledger_check_snapshots WHERE team_id=? AND project_id=? AND operation_id=?').get(teamId,projectId,id);
function checkedOperation(row,actor,requestHash){if(!row)return null;if(row.imported_by!==actor.userId||requestHash!==undefined&&row.request_sha256!==requestHash)ledgerConflict();return row;}
function sameContext(a,b,{grant=true}={}){
 if(a.member.stamp!==b.member.stamp||a.project.revision!==b.project.revision||a.project.status!==b.project.status||a.project.createdBy!==b.project.createdBy||a.owner!==b.owner||a.ownerStamp!==b.ownerStamp||a.identity?.stamp!==b.identity?.stamp||grant&&a.grant.stamp!==b.grant.stamp)ledgerConflict();
}
function projects(db,actor,teamId,query){
 const member=ordinaryTeamContext(db,actor.userId,teamId);if(!member)deny();const {q,after,limit}=query;
 const from='FROM team_projects project JOIN team_project_access_projects metadata ON metadata.team_id=project.team_id AND metadata.project_id=project.project_id';
 const where=`project.team_id=? AND project.status IN ('active','frozen') AND (EXISTS(SELECT 1 FROM team_project_access_grants owner WHERE owner.team_id=project.team_id AND owner.project_id=project.project_id AND owner.user_id=? AND owner.user_id=metadata.created_by AND owner.permission='project.owner' AND owner.status='active') OR EXISTS(SELECT 1 FROM team_ledger_check_grants ledger WHERE ledger.team_id=project.team_id AND ledger.project_id=project.project_id AND ledger.user_id=? AND ledger.eligible=1 AND ledger.can_read=1))${q?" AND project.title LIKE ? ESCAPE '\\'":''}`;
 const parameters=[teamId,actor.userId,actor.userId,...(q?['%'+q.replace(/[\\%_]/g,c=>'\\'+c)+'%']:[])];
 if(after&&!db.prepare(`SELECT 1 ${from} WHERE ${where} AND project.project_id=?`).get(...parameters,after))deny();
 const rows=db.prepare(`SELECT project.project_id,project.title,project.status,CAST(metadata.revision AS TEXT) revision ${from} WHERE ${where} AND project.project_id>? ORDER BY project.project_id COLLATE BINARY LIMIT ?`).all(...parameters,after,limit+1);
 const result={projects:rows.slice(0,limit).map(row=>({teamId,id:row.project_id,title:safeProjectTitle(row.title,row.project_id),status:row.status,revision:projectRevision(row.revision)})),hasMore:rows.length>limit};
 if(ordinaryTeamContext(db,actor.userId,teamId)?.stamp!==member.stamp)ledgerConflict();return result;
}
export async function handleLedgerCheckRequest(request,{db,now=Date.now,identityProviders={},deviceContext,subscriptionEnforcement='disabled'}={}){
 const url=new URL(request.url),listing=/^\/api\/teams\/([^/]+)\/ledger-check-projects$/.exec(url.pathname),match=/^\/api\/teams\/([^/]+)\/projects\/([^/]+)\/ledger-checks(?:\/(access|members|imports|snapshots)(?:\/([^/]+))?)?$/.exec(url.pathname);
 if(!listing&&!match)return null;
 const teamId=(listing??match)[1];if(!ID.test(teamId)||url.hash||url.href.endsWith('?'))invalid();
 const options={identityProviders,deviceContext},actor=ledgerActor(db,request,options,projectTime(now()));
 if(listing){if(request.method!=='GET')return method(['GET']);return transaction(db,()=>{const start=changes(db),result=projects(db,actor,teamId,ledgerListQuery(url.searchParams));currentLedgerActor(db,request,actor,options,projectTime(now()));if(changes(db)!==start)ledgerConflict();return json(result);});}
 const [, ,projectId,tail,itemId]=match;if(!ID.test(projectId))deny();
 if(itemId&&(!['imports','snapshots'].includes(tail)||!UUID.test(itemId))||tail==='snapshots'&&!itemId)deny();
 if(url.search&&!(tail==='members'||!tail||tail==='snapshots'))invalid();
 const methods=tail==='access'?['GET','POST']:tail==='imports'&&!itemId?['POST']:['GET'];if(!methods.includes(request.method))return method(methods);
 const importing=tail==='imports'&&!itemId,changing=tail==='access'&&request.method==='POST';
 const permissions={...(tail==='members'||changing||tail==='imports'?{owner:true}:{}),...(!tail||tail==='snapshots'||tail==='imports'?{read:true}:{}),...(changing||importing?{active:true}:{}),...(tail==='snapshots'||tail==='imports'?{source:true}:{})};
 const before=ledgerContext(db,actor,teamId,projectId,permissions);
 if(importing&&deviceContext.ledgerImportStamp!==ledgerContextStamp(before))ledgerConflict();
 const subscriptionGuard=importing?captureBusinessSubscriptionGuard(db,teamId,{now,identityProviders,subscriptionEnforcement}):null;
 const fresh=(grant=true)=>{const current=currentLedgerActor(db,request,actor,options,projectTime(now())),context=ledgerContext(db,current,teamId,projectId,permissions);sameContext(before,context,{grant});subscriptionGuard?.assertCurrent();return context;};
 if(request.method==='GET'){
  if(tail==='access'){const head=before.grant.read?ledgerHead(db,teamId,projectId):null;fresh();return json({access:{teamId,projectId,projectRevision:before.project.revision,grantRevision:before.grant.revision,read:before.grant.read,canManageAccess:before.owner&&before.project.status==='active',canImport:before.owner&&before.grant.read&&before.project.status==='active'&&!!before.identity,sourceAvailable:!!before.identity,...(before.grant.read?{sourceProjectId:before.identity?.sourceProjectId??null,headRevision:head}:{})}});}
  if(tail==='members'){const result=ledgerMembers(db,teamId,projectId,ledgerListQuery(url.searchParams));fresh();return json(result);}
  if(tail==='imports'){const row=operation(db,teamId,projectId,itemId);if(!row||row.imported_by!==actor.userId)deny();fresh();return json({receipt:receipt(row)});}
  if(tail==='snapshots'){
   if(url.searchParams.size!==2||[...url.searchParams.keys()].some(k=>!['projectRevision','grantRevision'].includes(k)||url.searchParams.getAll(k).length!==1))invalid();
   for(const k of ['projectRevision','grantRevision']){const raw=url.searchParams.get(k);if(!/^[1-9][0-9]*$/.test(raw??'')||!integer(Number(raw),1))invalid();if(Number(raw)!==(k==='projectRevision'?before.project.revision:before.grant.revision))ledgerConflict();}
   const row=db.prepare('SELECT * FROM team_ledger_check_snapshots WHERE team_id=? AND project_id=? AND snapshot_id=?').get(teamId,projectId,itemId);if(!row)deny();
   let source;try{source=await snapshotCodec.parse(row.source_json);}catch{ledgerConflict();}
   if(ledgerDigest(row.source_json)!==row.source_sha256||source.sourceProjectId!==before.identity.sourceProjectId||source.sourceProjectId!==row.source_project_id||row.identity_stamp!==before.identity.stamp||source.workspaceRevision!==row.workspace_revision||source.reconciliation.calculatedAt!==row.calculated_at)ledgerConflict();fresh();
   return transaction(db,()=>{const start=changes(db);fresh();const actual=db.prepare('SELECT * FROM team_ledger_check_snapshots WHERE team_id=? AND project_id=? AND snapshot_id=?').get(teamId,projectId,itemId);if(!actual||Object.keys(actual).length!==Object.keys(row).length||Object.keys(row).some(k=>actual[k]!==row[k]))ledgerConflict();ledgerHead(db,teamId,projectId);fresh();if(changes(db)!==start)ledgerConflict();return new Response(row.source_json,{headers:{...PRIVATE_HEADERS,'Content-Type':'application/json; charset=utf-8','Content-Length':String(Buffer.byteLength(row.source_json)),'X-Shenyi-Ledger-Sha256':row.source_sha256,'X-Shenyi-Ledger-Snapshot-Id':row.snapshot_id,'X-Shenyi-Ledger-Version':String(row.version),'X-Shenyi-Ledger-Source-Project-Id':row.source_project_id,'X-Shenyi-Project-Revision':String(before.project.revision),'X-Shenyi-Ledger-Grant-Revision':String(before.grant.revision)}});});
  }
  return transaction(db,()=>{const start=changes(db);fresh();const query=ledgerListQuery(url.searchParams,{version:true}),head=ledgerHead(db,teamId,projectId);if(head&&!before.identity)deny();
  if(query.after&&!db.prepare('SELECT 1 FROM team_ledger_check_snapshots WHERE team_id=? AND project_id=? AND version=?').get(teamId,projectId,query.after))deny();
  const rows=db.prepare(`SELECT ${META} FROM team_ledger_check_snapshots WHERE team_id=? AND project_id=?${query.after?' AND version<?':''} ORDER BY version DESC LIMIT ?`).all(teamId,projectId,...(query.after?[query.after]:[]),query.limit+1);fresh();
  if(changes(db)!==start)ledgerConflict();return json({snapshots:rows.slice(0,query.limit).map(metadata),hasMore:rows.length>query.limit,headRevision:head,projectRevision:before.project.revision,grantRevision:before.grant.revision});});
 }
 if(changing){
  const body=await readJson(request,ACCESS,4096);fresh(false);
  if(!exact(body,ACCESS)||!integer(body.projectRevision,1)||!ID.test(body.userId??'')||typeof body.userId!=='string'||!integer(body.memberRevision)||!integer(body.grantRevision)||typeof body.read!=='boolean'||!password(body.currentPassword))invalid();
  if(body.projectRevision!==before.project.revision)ledgerConflict();const target=ledgerTarget(db,teamId,body.userId),grant=ledgerGrant(db,teamId,projectId,body.userId);
  if(target.identityRevision!==body.memberRevision||grant.revision!==body.grantRevision||!grant.exists&&!body.read||grant.exists&&grant.rawRead===body.read&&(grant.eligible||!body.read))ledgerConflict();
  let managementGuard=null;
  const check=()=>{fresh(false);const current=ledgerTarget(db,teamId,body.userId);if(current.stamp!==target.stamp||ledgerGrant(db,teamId,projectId,body.userId).stamp!==grant.stamp)ledgerConflict();managementGuard?.assertCurrent();};check();
   if(addsEffectiveAuthority(grant,body,['read']))managementGuard=captureManagementSubscriptionGuard(db,teamId,{now,identityProviders,subscriptionEnforcement});
  consume(db,'ledger-access:'+ledgerDigest(actor.userId),projectTime(now()),15*60000,20);
  return limitedPasswordWork(db,async()=>{const valid=await verifyPassword(body.currentPassword,before.member.credential.password_hash);check();if(!valid)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');return transaction(db,()=>{check();const start=changes(db),after=writeLedgerGrant(db,{teamId,projectId,userId:body.userId,read:body.read,before:grant});ledgerAudit(db,{teamId,projectId,actorId:actor.userId,userId:body.userId,action:'access.changed',before:grant,after,at:projectTime(now())});fresh(false);if(ledgerTarget(db,teamId,body.userId).stamp!==target.stamp||ledgerGrant(db,teamId,projectId,body.userId).stamp!==after.stamp||changes(db)-start!==2n)ledgerConflict();managementGuard?.assertCurrent();return json({changed:true,projectRevision:before.project.revision});});});
 }
 const body=await readJson(request,IMPORT,LEDGER_IMPORT_MAX);fresh();
 if(!exact(body,IMPORT)||!UUID.test(body.operationId??'')||typeof body.operationId!=='string'||!integer(body.projectRevision,1)||!integer(body.grantRevision,1)||!integer(body.headRevision)||typeof body.sourceJson!=='string'||!password(body.currentPassword))invalid();
 consume(db,'ledger-import:'+ledgerDigest(actor.userId),projectTime(now()),15*60000,20);
 let source;try{source=await snapshotCodec.parse(body.sourceJson);}catch{invalid();}fresh();if(source.sourceProjectId!==before.identity.sourceProjectId)deny();
 const sourceHash=ledgerDigest(body.sourceJson),requestHash=ledgerDigest(JSON.stringify({teamId,projectId,actorId:actor.userId,operationId:body.operationId,projectRevision:body.projectRevision,grantRevision:body.grantRevision,headRevision:body.headRevision,sourceHash}));
 const previous=checkedOperation(operation(db,teamId,projectId,body.operationId),actor,requestHash);
 const check=()=>{fresh();const completed=checkedOperation(operation(db,teamId,projectId,body.operationId),actor,requestHash);if(!completed&&(body.projectRevision!==before.project.revision||body.grantRevision!==before.grant.revision||ledgerHead(db,teamId,projectId)!==body.headRevision))ledgerConflict();return completed;};check();
 return limitedPasswordWork(db,async()=>{
  const valid=await verifyPassword(body.currentPassword,before.member.credential.password_hash);check();if(!valid)throw new ApiError(403,'VERIFICATION_FAILED','当前密码验证未通过，请核对后重试。');
  return transaction(db,()=>{
   const completed=check();if(completed)return json({receipt:receipt(completed)});
   const version=projectIncrement(body.headRevision,0),start=changes(db);let result;
   if(body.headRevision===0)result=db.prepare('INSERT INTO team_ledger_check_heads VALUES (?,?,1)').run(teamId,projectId);
   else result=db.prepare('UPDATE team_ledger_check_heads SET revision=? WHERE team_id=? AND project_id=? AND revision=?').run(version,teamId,projectId,body.headRevision);
   if(result.changes!==1)ledgerConflict();
   const label=db.prepare('SELECT display_name FROM team_credentials WHERE user_id=?').get(actor.userId)?.display_name;
   const row={snapshot_id:randomUUID(),team_id:teamId,project_id:projectId,version,operation_id:body.operationId,request_sha256:requestHash,source_json:body.sourceJson,source_sha256:sourceHash,source_project_id:source.sourceProjectId,identity_stamp:before.identity.stamp,workspace_revision:source.workspaceRevision,calculated_at:source.reconciliation.calculatedAt,imported_by:actor.userId,importer_name:safeMemberText(label,actor.userId),imported_at:projectTime(now())};
   const keys=Object.keys(row);if(db.prepare('INSERT INTO team_ledger_check_snapshots('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k])).changes!==1)ledgerConflict();
   fresh();const actual=operation(db,teamId,projectId,body.operationId);if(!actual||keys.some(k=>actual[k]!==row[k])||ledgerHead(db,teamId,projectId)!==version||changes(db)-start!==2n)ledgerConflict();
   fresh();return json({receipt:receipt(row)},previous?200:201);
  });
 });
}
