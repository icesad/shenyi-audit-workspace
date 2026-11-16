'use strict';
// Independent synthetic setup; grants and material publication use the signed app.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture:formalFixture,good,denied,uuid,sha,deferred,codec,migrationSource,PASSWORD,restorePasswordWork}=require('./workspace-formalization-security-fixture.cjs');
const preservation=require('./material-preservation-security-fixture.cjs');
const {createTeamClient}=require('../../desktop/team-client.cjs');
const proof=require('../../shared/device-proof.cjs');
const allFlags={read:true,import:true,review:true,close:true,maintain:true};
const target=(projectId,teamId='team-a')=>({teamId,projectId});
async function fixture(t,{confirmed=true,sameId=false,migration=false,collection={read:true,manage:true,review:true}}={}){
 const f=await formalFixture(t,{migration,flags:collection}),W=f.projectId,Q=sameId?W:uuid();
 const origin=migrationSource({id:Q,sequence:43});
 let confirmation=null;
 if(confirmed)confirmation=good(await f.confirm(f.body({source:origin})),201).receipt;
 const route=(projectId=W,teamId='team-a')=>'/api/teams/'+teamId+'/projects/'+projectId+'/materials';
 const rev=(projectId=W,teamId='team-a')=>f.revision(projectId,teamId);
 const read=(current=f.actor,scope=target(W))=>f.api(route(scope.projectId,scope.teamId),{session:current});
 const access=(current=f.actor,scope=target(W))=>f.api(route(scope.projectId,scope.teamId)+'/access',{session:current});
 async function grant({current=f.actor,userId='manager-a',flags=allFlags,scope=target(W),body={}}={}){
  const old=f.db.prepare('SELECT revision FROM team_material_grants WHERE team_id=? AND project_id=? AND user_id=?').get(scope.teamId,scope.projectId,userId);
  const maintenance=f.db.prepare('SELECT revision FROM team_material_maintenance_grants WHERE team_id=? AND project_id=? AND user_id=?').get(scope.teamId,scope.projectId,userId);
  return f.api(route(scope.projectId,scope.teamId)+'/access',{method:'POST',session:current,body:{projectRevision:rev(scope.projectId,scope.teamId),userId,memberRevision:f.epoch(userId),grantRevision:Number(old?.revision??0),maintenanceRevision:Number(maintenance?.revision??0),...Object.fromEntries(Object.keys(allFlags).map(key=>[key,!!flags[key]])),currentPassword:PASSWORD,...body}});
 }
 async function pack({id=Q,...settings}={}){const original=preservation.fixture({id,closed:false,...settings}),made=await preservation.create(original),bytes=await preservation.bytes(made.blob);return{original,made,bytes};}
 async function stage(package_,{current=f.actor,scope=target(W),requestId=uuid(),body={}}={}){
  const start=await f.api(route(scope.projectId,scope.teamId)+'/imports',{method:'POST',session:current,body:{requestId,projectRevision:rev(scope.projectId,scope.teamId),packageSha256:sha(package_.bytes),byteLength:package_.bytes.length,chunkCount:Math.ceil(package_.bytes.length/1048576),...body}});
  good(start,201);
  for(let index=0;index<Math.ceil(package_.bytes.length/1048576);index++){const bytes=package_.bytes.subarray(index*1048576,(index+1)*1048576);good(await f.api(route(scope.projectId,scope.teamId)+'/imports/'+requestId+'/chunks/'+index,{method:'PUT',session:current,body:{sha256:sha(bytes),data:bytes.toString('base64')}}));}
  return{requestId,scope,package:package_,projectRevision:rev(scope.projectId,scope.teamId)};
 }
 const commit=(staged,{current=f.actor,body={}}={})=>f.api(route(staged.scope.projectId,staged.scope.teamId)+'/imports/'+staged.requestId+'/commit',{method:'POST',session:current,body:{projectRevision:staged.projectRevision,currentPassword:PASSWORD,...body}});
 async function imported(settings={}){good(await grant(settings.grant));const package_=await pack(settings.pack),staged=await stage(package_,settings.stage);const receipt=good(await commit(staged),201);return{...package_,staged,receipt};}
 async function file(fileId,current=f.actor,scope=target(W),method='GET'){const response=await f.dispatch(f.makeRequest(route(scope.projectId,scope.teamId)+'/files/'+fileId,{session:current,method}));return{status:response.status,headers:response.headers,bytes:Buffer.from(await response.arrayBuffer())};}
 async function action(value,{current=f.actor,scope=target(W),view=null,body={}}={}){view??=good(await read(current,scope));return f.api(route(scope.projectId,scope.teamId)+'/actions',{method:'POST',session:current,body:{requestId:uuid(),projectRevision:rev(scope.projectId,scope.teamId),materialRevision:view.materialRevision,recordSha256:view.recordSha256,action:value,currentPassword:value.type==='item'?null:PASSWORD,...body}});}
 const rows=name=>{const query=f.db.prepare('SELECT * FROM "'+name+'"');query.setReadBigInts(true);return query.all().map(row=>JSON.stringify(Object.keys(row).sort().map(key=>[key,typeof row[key]==='bigint'?['int',String(row[key])]:row[key] instanceof Uint8Array?['blob',Buffer.from(row[key]).toString('base64')]:row[key]]))).sort();};
 function replaceMapping(change){f.db.exec('DROP TRIGGER workspace_formalization_no_update');const row=f.db.prepare('SELECT * FROM team_workspace_formalizations WHERE project_id=?').get(W);change(row);const names=Object.keys(row).filter(key=>!['team_id','project_id'].includes(key));f.db.prepare('UPDATE team_workspace_formalizations SET '+names.map(name=>name+'=?').join(',')+' WHERE team_id=? AND project_id=?').run(...names.map(name=>row[name]),'team-a',W);}
 return{...f,W,Q,origin,confirmation,route,rev,read,access,grant,pack,stage,commit,imported,file,action,rows,replaceMapping};
}
async function actualClient(f,t,{user='manager-a'}={}){
 await f.ready(user);const pair=f.keys.get(user),transport={trace:[],rewrite:null};
 const client=createTeamClient({now:()=>f.clock.value,deviceIdentity:{platform:'win32',displayName:'Independent material identity device',vault:{async getPublicIdentity(){return{publicKey:pair.encoded,fingerprint:sha(Buffer.from(pair.encoded,'base64url'))};},async signChallenge(fields){return crypto.sign(null,proof.challengeBytes(fields),pair.privateKey).toString('base64url');},async signRequest(fields){return crypto.sign(null,proof.requestProofBytes(fields),pair.privateKey).toString('base64url');}}},fetchImpl:async(url,settings)=>{const request=new Request(url,settings),info={method:request.method,path:new URL(url).pathname};transport.trace.push(info);const response=await f.dispatch(request);info.status=response.status;return transport.rewrite?transport.rewrite(info,response):response;}});
 await client.login({username:user,password:PASSWORD});assert.equal((await client.getDeviceStatus()).state,'ready');
 t.after(()=>client.clearSession());return{client,transport};
}
function actualManager(f,t,client,bytes){
 const {createProjectMaterialsManager}=require('../../desktop/project-materials.cjs'),io={opens:0,reads:0,dialogs:0,picker:null};
 const manager=createProjectMaterialsManager({client,window:{},dialog:{async showOpenDialog(){io.dialogs++;return io.picker?io.picker():{canceled:false,filePaths:['D:/synthetic-only/material-identity.zip']};}},fsImpl:{async open(){io.opens++;let offset=0;return{async stat(){return{isFile:()=>true,size:bytes.length};},async read(buffer,start,length){io.reads++;const count=Math.min(length,bytes.length-offset);bytes.copy(buffer,start,offset,offset+count);offset+=count;return{bytesRead:count};},async close(){}};}}});
 const choose=()=>manager.chooseProjectMaterialImport({...target(f.W),projectRevision:f.rev()}),input=selected=>({...target(f.W),projectRevision:f.rev(),handle:selected.handle,sourceSha256:selected.sha256,currentPassword:PASSWORD,confirmed:true});
 t.after(()=>manager.dispose());return{manager,io,choose,input};
}
module.exports={fixture,actualClient,actualManager,good,denied,uuid,sha,deferred,codec,migrationSource,PASSWORD,preservation,target,allFlags,restorePasswordWork};
