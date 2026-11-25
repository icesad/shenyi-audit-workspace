'use strict';
// One synthetic database and confirmed W/Q; business grants/imports use strict APIs.
const assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {formFixture,good,denied,restorePasswordWork}=require('./workpaper-form-fixture.cjs');
const materials=require('./material-preservation-security-fixture.cjs');
const {savedSnapshot,PASSWORD}=require('./ledger-check-fixture.cjs');
const MODULES=Object.freeze(['materials','source','ledger','workpaper']);
const READ_FLAGS=Object.freeze({materials:{read:true,import:false,review:false,close:false,maintain:false},source:{read:true,export:true},ledger:{read:true},workpaper:{read:true,write:false,export:true}});
const ALL_FLAGS=Object.freeze({materials:{read:true,import:false,review:false,close:false,maintain:false},source:{read:true,export:true},ledger:{read:true},workpaper:{read:true,write:true,export:true}});
const FIELDS={materials:['read','import','review','close','maintain'],source:['read','export'],ledger:['read'],workpaper:['read','write','export']};
const TABLES={materials:'team_material_grants',source:'team_workspace_source_grants',ledger:'team_ledger_check_grants',workpaper:'team_workpaper_access_grants'};
const sha=value=>createHash('sha256').update(value).digest('hex');
const typed=v=>typeof v==='bigint'?['integer',String(v)]:ArrayBuffer.isView(v)?['blob',Buffer.from(v).toString('base64')]:v===null?['null']:[''+typeof v,v];
async function createCompositeFixture(t){
 const f=await formFixture(t,{kind:'xlsx',freeze:true}),W=f.projectId,Q=f.sourceProjectId,target={teamId:'team-a',projectId:W},owner=f.actor;
 const prefix='/api/teams/team-a/projects/'+W,routes={materials:prefix+'/materials',source:prefix+'/initiation-source',ledger:prefix+'/ledger-checks',workpaper:prefix+'/workpapers'};
 const grantRow=(module,userId='partner-a')=>f.db.prepare('SELECT * FROM '+TABLES[module]+' WHERE team_id=? AND project_id=? AND user_id=?').get('team-a',W,userId);
 function rawFlags(module,userId='partner-a'){
  const row=grantRow(module,userId),out=Object.fromEntries(FIELDS[module].filter(k=>k!=='maintain').map(k=>[k,row?.['can_'+k]===1]));
  if(module==='materials'){const m=f.db.prepare('SELECT * FROM team_material_maintenance_grants WHERE team_id=? AND project_id=? AND user_id=?').get('team-a',W,userId);out.maintain=!!(m?.eligible===1&&m.can_maintain===1&&row?.eligible===1&&row.can_read===1&&m.read_grant_revision===row.revision);}
  return out;
 }
 function grantBody(module,userId='partner-a',flags={}){
  assert.ok(MODULES.includes(module));const row=grantRow(module,userId),body={projectRevision:f.revision(W),userId,memberRevision:f.epoch(userId),grantRevision:Number(row?.revision??0),...Object.fromEntries(FIELDS[module].map(k=>[k,false])),...flags,currentPassword:PASSWORD};
  if(module==='materials')body.maintenanceRevision=Number(f.db.prepare('SELECT revision FROM team_material_maintenance_grants WHERE team_id=? AND project_id=? AND user_id=?').get('team-a',W,userId)?.revision??0);
  return body;
 }
 const configureModule=(module,userId='partner-a',flags={},options={})=>f.api(routes[module]+'/access',{method:'POST',session:options.current??owner,body:grantBody(module,userId,flags)});
 async function setGrants(desired={},userId='partner-a'){
  for(const module of MODULES){const flags={...Object.fromEntries(FIELDS[module].map(k=>[k,false])),...(desired[module]===true?READ_FLAGS[module]:desired[module]||{})};if(FIELDS[module].some(k=>rawFlags(module,userId)[k]!==flags[k]))good(await configureModule(module,userId,flags));}
 }
 function tableRows(name,where=''){
  const q=f.db.prepare('SELECT * FROM '+name+where+' ORDER BY rowid');q.setReadBigInts(true);return q.all().map(row=>JSON.stringify(Object.keys(row).sort().map(k=>[k,typed(row[k])]))).sort();
 }
 const businessSnapshot=()=>Object.fromEntries(['team_workspace_formalizations','team_material_records','team_material_files','team_ledger_check_heads','team_ledger_check_snapshots','team_workpaper_data_heads','team_workpaper_data_versions','team_workpaper_data_originals','team_workpaper_data_imports','team_workpaper_data_chunks'].map(name=>[name,tableRows(name)]).concat([['team_material_business_events',tableRows('team_material_events'," WHERE kind NOT IN ('access.changed','access.revoked')")]]));
 const grantSnapshot=()=>Object.fromEntries(['team_material_grants','team_material_maintenance_grants','team_material_events','team_workspace_source_grants','team_workspace_source_events','team_ledger_check_grants','team_ledger_check_events','team_workpaper_access_grants','team_workpaper_access_events','team_project_access_projects'].map(name=>[name,tableRows(name)]));
 good(await configureModule('workpaper',f.user,{read:true,write:true,export:true}));
 good(await configureModule('materials',f.user,{read:true,import:true,review:false,close:false,maintain:false}));
 const materialInput=materials.fixture({id:Q,closed:true}),materialMade=await materials.create(materialInput),materialBytes=Buffer.from(await materialMade.blob.arrayBuffer()),materialRequestId=randomUUID();
 good(await f.api(routes.materials+'/imports',{method:'POST',session:owner,body:{requestId:materialRequestId,projectRevision:f.revision(W),packageSha256:sha(materialBytes),byteLength:materialBytes.length,chunkCount:Math.ceil(materialBytes.length/1048576)}}),201);
 for(let index=0;index<Math.ceil(materialBytes.length/1048576);index++){const part=materialBytes.subarray(index*1048576,(index+1)*1048576);good(await f.api(routes.materials+'/imports/'+materialRequestId+'/chunks/'+index,{method:'PUT',session:owner,body:{sha256:sha(part),data:part.toString('base64')}}));}
 good(await f.api(routes.materials+'/imports/'+materialRequestId+'/commit',{method:'POST',session:owner,body:{projectRevision:f.revision(W),currentPassword:PASSWORD}}),201);
 good(await configureModule('source',f.user,{read:true,export:true}));
 good(await configureModule('ledger',f.user,{read:true}));
 const ledgerJson=await savedSnapshot(Q),ledgerOperation=randomUUID(),ledgerReceipt=good(await f.api(routes.ledger+'/imports',{method:'POST',session:owner,body:{operationId:ledgerOperation,projectRevision:f.revision(W),grantRevision:Number(grantRow('ledger',f.user).revision),headRevision:0,sourceJson:ledgerJson,currentPassword:PASSWORD}}),201).receipt;
 const formal=f.db.prepare('SELECT * FROM team_workspace_formalizations WHERE team_id=? AND project_id=?').get('team-a',W),wpHead=f.db.prepare('SELECT * FROM team_workpaper_data_heads WHERE team_id=? AND project_id=?').get('team-a',W),wpVersion=f.db.prepare('SELECT * FROM team_workpaper_data_versions WHERE team_id=? AND project_id=? AND version=1').get('team-a',W),wpOriginals=f.db.prepare('SELECT * FROM team_workpaper_data_originals WHERE team_id=? AND project_id=? ORDER BY sha256').all('team-a',W);
 const expected={source:{json:formal.source_json,sha256:formal.source_sha256},materials:{record:materialInput.record,recordSha256:materialMade.manifest.record.sha256,originals:materialInput.originals.map(x=>({id:x.metadata.id,sha256:x.metadata.sha256,bytes:Buffer.from(x.data)})),packageBytes:materialBytes,requestId:materialRequestId},ledger:{json:ledgerJson,sha256:sha(ledgerJson),receipt:ledgerReceipt},workpaper:{recordJson:wpVersion.record_json,recordSha256:wpVersion.record_sha256,originals:wpOriginals.map(x=>({sha256:x.sha256,bytes:Buffer.from(x.bytes)})),sourcePackageSha256:wpHead.source_package_sha256,freeze:JSON.parse(wpVersion.record_json).workpaperLocks,version:1}};
 assert.equal(formal.source_project_id,Q);assert.equal(JSON.parse(formal.source_json).initiation.quoteId,Q);assert.equal(expected.materials.record.project.quoteId,Q);assert.equal(JSON.parse(ledgerJson).sourceProjectId,Q);assert.equal(wpHead.source_project_id,Q);assert.equal(Object.keys(expected.workpaper.freeze).length,1);assert.equal(wpOriginals.length,2);
 const partner=await f.ready('partner-a');
 const grantRevision=(module,current)=>Math.max(1,Number(grantRow(module,current.account.id)?.revision??0));
 const query=(module,current,{version=false}={})=>'?'+new URLSearchParams({...version?{version:'1'}:{},projectRevision:String(f.revision(W)),grantRevision:String(grantRevision(module,current))});
 const readModule=(module,current=partner)=>f.api(module==='ledger'?routes.ledger+'/snapshots/'+ledgerReceipt.snapshotId+query(module,current):module==='workpaper'?routes.workpaper+'/record'+query(module,current,{version:true}):routes[module],{session:current});
 async function raw(route,current=partner,method='GET'){
  const response=await f.dispatch(f.makeRequest(route,{session:current,method})),bytes=Buffer.from(await response.arrayBuffer());return {status:response.status,bytes,headers:response.headers,...(response.ok?{}:{data:bytes.length?JSON.parse(bytes.toString()):null})};
 }
 const materialPlan=(current=partner)=>f.api(routes.materials+'/export-plan',{session:current});
 const materialBinaryUsingPlan=(plan,current=partner)=>{const q=new URLSearchParams(Object.fromEntries(['projectRevision','materialRevision','recordSha256','planSha256'].map(k=>[k,String(plan[k])])));return raw(routes.materials+'/export-package?'+q,current);};
 // A known owner plan constructs a direct binary negative; it proves no subject-plan access.
 const materialBinaryUsingOwnerPlan=async(current=partner)=>materialBinaryUsingPlan(good(await materialPlan(owner)),current);
 async function binaryModule(module,current=partner,{kind='export'}={}){
  if(module==='materials'){
   if(kind==='original')return raw(routes.materials+'/files/'+expected.materials.originals[0].id,current);
   return materialBinaryUsingOwnerPlan(current);
  }
  if(module==='source')return raw(routes.source+'/export'+query(module,current),current);
  if(module==='ledger')return raw(routes.ledger+'/snapshots/'+ledgerReceipt.snapshotId+query(module,current),current);
  const q=query(module,current,{version:true});return raw(kind==='original'?routes.workpaper+'/originals/'+expected.workpaper.originals[0].sha256+q:routes.workpaper+'/export'+q,current);
 }
 return {...f,W,Q,target,owner,partner,routes,grantBody,configureModule,setGrants,rawFlags,grantRow,grantRevision,readModule,binaryModule,expected,businessSnapshot,grantSnapshot,query,raw,materialPlan,materialBinaryUsingPlan,materialBinaryUsingOwnerPlan};
}
module.exports={createCompositeFixture,MODULES,READ_FLAGS,ALL_FLAGS,PASSWORD,sha,good,denied,restorePasswordWork};
