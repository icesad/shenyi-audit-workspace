'use strict';
const assert=require('node:assert/strict'),{sign,createHash}=require('node:crypto');
const {createLedgerFixture,PASSWORD,savedSnapshot,uuid,restorePasswordWork}=require('./ledger-check-fixture.cjs');
const {createTeamClient}=require('../../desktop/team-client.cjs'),proof=require('../../shared/device-proof.cjs');
const sha=v=>createHash('sha256').update(v).digest('hex');
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
function metadata(response,url){Object.defineProperties(response,{url:{value:url,configurable:true},redirected:{value:false,configurable:true}});return response;}
async function fixture(t,{grant=true}={}){
 const f=await createLedgerFixture(t);if(grant)assert.equal((await f.ledgerGrant()).status,200);
 const pair=f.keys.get('manager-a'),serverId=f.db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value,state={calls:[],after:null,offline:false};
 const client=createTeamClient({now:()=>f.clock.value,trustedService:{schemaVersion:1,apiBase:'https://ledger.example.invalid',serverId},deviceIdentity:{platform:'win32',vault:{async getPublicIdentity(){return{publicKey:pair.encoded,fingerprint:sha(Buffer.from(pair.encoded,'base64url'))};},async signChallenge(fields){return sign(null,proof.challengeBytes(fields),pair.privateKey).toString('base64url');},async signRequest(fields){return sign(null,proof.requestProofBytes(fields),pair.privateKey).toString('base64url');}}},fetchImpl:async(url,settings)=>{
  const call={url,route:new URL(url).pathname,query:new URL(url).search,settings};state.calls.push(call);if(state.offline)throw Error('Synthetic disconnected');const response=metadata(await f.dispatch(new Request(url,settings)),url);return await state.after?.(call,response)??response;
 }});
 await client.login({username:'manager-a',password:PASSWORD});assert.equal(client.getDeviceStatus().state,'ready');t.after(()=>client.clearSession());
 const target={teamId:'team-a',projectId:f.projectId},root=f.ledgerRoute();
 const access=()=>client.getLedgerCheckAccess(target);
 async function importInput({sourceJson,...extra}={}){const a=await access();return{...target,operationId:uuid(),projectRevision:a.projectRevision,grantRevision:a.grantRevision,headRevision:a.headRevision,sourceJson:sourceJson??await savedSnapshot(f.sourceProjectId),currentPassword:PASSWORD,sourceVerified:true,confirmed:true,...extra};}
 async function importing(options){const input=await importInput(options);return {input,receipt:await client.importLedgerCheckSnapshot(input)};}
 async function readInput(snapshotId){const a=await access();return{...target,snapshotId,projectRevision:a.projectRevision,grantRevision:a.grantRevision};}
 async function change(read){const a=await access();return client.changeLedgerCheckAccess({...target,projectRevision:a.projectRevision,userId:'manager-a',memberRevision:f.epoch('manager-a'),grantRevision:a.grantRevision,read,currentPassword:PASSWORD,confirmed:true});}
 async function switchActor(){await client.login({username:'partner-a',password:PASSWORD});if(client.getDeviceStatus().state!=='ready')await client.enrollDevice({displayName:'Synthetic later ledger actor',currentPassword:PASSWORD,confirmed:true});assert.equal(client.getDeviceStatus().state,'ready');}
 return {...f,client,state,target,root,access,importInput,importing,readInput,change,switchActor};
}
module.exports={fixture,PASSWORD,savedSnapshot,uuid,sha,deferred,metadata,restorePasswordWork};
