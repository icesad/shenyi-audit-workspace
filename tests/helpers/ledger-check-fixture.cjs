'use strict';
const {createHash}=require('node:crypto');
const {fixture,good,denied,uuid,PASSWORD,migrationSource,restorePasswordWork}=require('./workspace-formalization-security-fixture.cjs');
const codec=require('../../dist/ledger-check-snapshot.js'),R=require('../../dist/audit-reconciliation.js');
const sha=v=>createHash('sha256').update(v).digest('hex');
async function savedSnapshot(projectId,{workspaceRevision=7,padding=0}={}){
 const scope={projectId,entityId:'合成团队只读记录',currency:'CNY',unit:'元',periodStart:'2026-01-01',periodEnd:'2026-12-31',scale:2},input=R.createInputTemplate(scope),columnMappings={},sourceRefs={};
 for(const role of ['ledger','trialBalance','statements']){columnMappings[role]={sheet:'原保存账表',fromRow:1,toRow:1,columns:{accountCode:0}};sourceRefs[role]={id:role,nodeId:role,generationId:'saved-generation',name:role+'.xlsx',sha256:'a'.repeat(64),status:'confirmed'};}
 if(padding)sourceRefs.ledger.syntheticPadding='x'.repeat(padding);
 const reconciliation={schemaVersion:1,input,columnMappings,sourceRefs,result:R.reconcile(input),inputHash:sha(JSON.stringify(input)),mappingHash:sha(JSON.stringify(columnMappings)),calculatedAt:'2026-11-17T00:00:00.000Z'};
 return codec.serialize(await codec.create({projectId,workspaceRevision,reconciliation}));
}
async function createLedgerFixture(t,options={}){
 const f=await fixture(t,{flags:{read:false,manage:false,review:false},...options});
 const formalBody=f.body(),sourceProjectId=formalBody.source.initiation.quoteId;good(await f.confirm(formalBody),201);
 const projectRoute=(id=f.projectId,teamId='team-a')=>f.route(id,teamId).replace(/\/formalization$/,'');
 const route=(id=f.projectId,teamId='team-a')=>projectRoute(id,teamId)+'/ledger-checks';
 const access=({current=f.actor,id=f.projectId,teamId='team-a',...settings}={})=>f.api(route(id,teamId)+'/access',{session:current,...settings});
 const grantBody=(userId=f.user,{id=f.projectId,teamId='team-a',...flags}={})=>({projectRevision:f.revision(id,teamId),userId,memberRevision:f.epoch(userId),grantRevision:Number(f.db.prepare('SELECT revision FROM team_ledger_check_grants WHERE team_id=? AND project_id=? AND user_id=?').get(teamId,id,userId)?.revision??0),read:true,currentPassword:PASSWORD,...flags});
 const grant=(userId=f.user,{current=f.actor,id=f.projectId,teamId='team-a',body,...flags}={})=>access({current,id,teamId,method:'POST',body:body??grantBody(userId,{id,teamId,...flags})});
 const importBody=async({id=f.projectId,teamId='team-a',current=f.actor,sourceJson,...rest}={})=>({operationId:uuid(),projectRevision:f.revision(id,teamId),grantRevision:Number(f.db.prepare('SELECT revision FROM team_ledger_check_grants WHERE team_id=? AND project_id=? AND user_id=?').get(teamId,id,current.account.id)?.revision??0),headRevision:Number(f.db.prepare('SELECT revision FROM team_ledger_check_heads WHERE team_id=? AND project_id=?').get(teamId,id)?.revision??0),sourceJson:sourceJson??await savedSnapshot(sourceProjectId),currentPassword:PASSWORD,...rest});
 const importing=async({current=f.actor,id=f.projectId,teamId='team-a',body,...rest}={})=>f.api(route(id,teamId)+'/imports',{method:'POST',session:current,body:body??await importBody({current,id,teamId,...rest})});
 const list=({current=f.actor,id=f.projectId,teamId='team-a',query=''}={})=>f.api(route(id,teamId)+query,{session:current});
 const read=({snapshotId,current=f.actor,id=f.projectId,teamId='team-a',query}={})=>{
  query??='?projectRevision='+f.revision(id,teamId)+'&grantRevision='+Number(f.db.prepare('SELECT revision FROM team_ledger_check_grants WHERE team_id=? AND project_id=? AND user_id=?').get(teamId,id,current.account.id)?.revision??0);
  return f.api(route(id,teamId)+'/snapshots/'+snapshotId+query,{session:current});
 };
 const receipt=(operationId,{current=f.actor,id=f.projectId,teamId='team-a'}={})=>f.api(route(id,teamId)+'/imports/'+operationId,{session:current});
 function moduleRows(){return ['team_ledger_check_grants','team_ledger_check_events','team_ledger_check_heads','team_ledger_check_snapshots'].map(name=>({name,rows:f.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()}));}
 return {...f,revision:(id=f.projectId,teamId='team-a')=>f.revision(id,teamId),projectRoute,sourceProjectId,ledgerRoute:route,ledgerAccess:access,ledgerGrantBody:grantBody,ledgerGrant:grant,ledgerImportBody:importBody,ledgerImport:importing,ledgerList:list,ledgerRead:read,ledgerReceipt:receipt,moduleRows};
}
module.exports={createLedgerFixture,savedSnapshot,good,denied,uuid,sha,PASSWORD,migrationSource,restorePasswordWork};
