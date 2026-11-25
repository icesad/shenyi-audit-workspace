'use strict';
// Synthetic setup only. All client requests traverse the actual strict app and
// carry fresh independently constructed Ed25519 device request signatures.
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{generateKeyPairSync,sign,createHash,randomBytes}=require('node:crypto');
const path=require('node:path'),{pathToFileURL}=require('node:url');
const proof=require('../../shared/device-proof.cjs'),replacement=require('../../shared/device-replacement-proof.cjs');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../../server/team/'+name)).href);
const PASSWORD='ShenyiDemo!2026',NOW=Date.parse('2026-11-15T16:00:00Z'),digest=value=>createHash('sha256').update(value).digest('hex');
const keyPair=()=>{const pair=generateKeyPairSync('ed25519');return {...pair,encoded:pair.publicKey.export({format:'der',type:'spki'}).toString('base64url')};};
let baseline;
async function createBusinessRoleFixture(t,options={}){
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');baseline??=(async()=>{const db=new DatabaseSync(':memory:');try{initializeTeamDatabase(db);await seedDemoTeamData(db);await(await source('provisioning-demo.mjs')).seedProvisioningDemo(db);await(await source('recovery-review-demo.mjs')).seedRecoveryReviewDemo(db);await(await source('member-access-demo.mjs')).seedMemberDeactivationDemo(db);await(await source('device-replacement-demo.mjs')).seedDeviceReplacementDemo(db);return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name+'"').all()}));}finally{db.close();}})();
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);db.exec('BEGIN; PRAGMA defer_foreign_keys=ON');for(const {name,rows} of await baseline)for(const row of rows){const names=Object.keys(row);db.prepare('INSERT OR REPLACE INTO "'+name+'"('+names.join(',')+') VALUES ('+names.map(()=>'?').join(',')+')').run(...Object.values(row));}db.exec('COMMIT');
 const {handleTeamApplicationRequest}=await source('application-api.mjs'),clock={value:options.now??NOW},state={strict:options.strict??true,before:null,after:null},calls=[],keys=new Map();
 const makeRequest=(route,{method='GET',session,body,headers={},bodyStream}={})=>{
  const serialized=body===undefined?undefined:JSON.stringify(body),actualHeaders={Origin:'shenyi://app',...(session?{Authorization:'Bearer '+session.token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers};
  if(session?.lease){const fields={serverId:session.lease.serverId,userId:session.account.id,sessionBinding:proof.sessionBinding(session.token),deviceId:session.lease.deviceId,bindingRevision:session.lease.bindingRevision,leaseId:session.lease.id,method,pathAndQuery:route,bodySha256:digest(serialized??''),nonce:randomBytes(32).toString('base64url')};Object.assign(actualHeaders,{'X-Shenyi-Device-Lease':session.lease.token,'X-Shenyi-Device-Nonce':fields.nonce,'X-Shenyi-Device-Body-SHA256':fields.bodySha256,'X-Shenyi-Device-Signature':sign(null,proof.requestProofBytes(fields),session.key.privateKey).toString('base64url')});}
  return new Request('http://127.0.0.1:8774'+route,{method,headers:actualHeaders,...(bodyStream?{body:bodyStream,duplex:'half'}:serialized===undefined?{}:{body:serialized})});
 };
 const dispatch=async(request,{strict=state.strict}={})=>handleTeamApplicationRequest(request,{db,now:()=>clock.value,identityProviders:{...options.identityProviders,deviceProofRequired:strict}});
 const api=async(route,settings={})=>{const request=settings.raw??makeRequest(route,settings);if(state.before)await state.before({route,settings,request});let response=await dispatch(request,settings);if(state.after){const changed=await state.after({route,settings,request},response);if(changed)response=changed;}const text=await response.text(),result={status:response.status,data:text?JSON.parse(text):null,headers:response.headers};calls.push({route,method:request.method,status:response.status});return result;};
 const login=async(user='intern-a')=>{const result=await api('/api/auth/login',{method:'POST',body:{username:user,password:PASSWORD}});assert.equal(result.status,200);return result.data;};
 const ready=async(user='intern-a',pair=keys.get(user)??keyPair())=>{
  const boot=await login(user),history=db.prepare('SELECT 1 FROM team_device_bindings WHERE user_id=?').get(user),purpose=history?'prove':'enroll',challenge=await api('/api/auth/devices/'+(history?'proof-challenges':'enrollment-challenges'),{method:'POST',session:boot,body:{publicKey:pair.encoded,...(history?{}:{displayName:'Synthetic '+user,platform:'win32',currentPassword:PASSWORD})}});assert.equal(challenge.status,201);
  const fields=challenge.data.challenge,result=await api('/api/auth/devices/'+purpose,{method:'POST',session:boot,body:{challengeId:fields.challengeId,signature:sign(null,proof.challengeBytes(fields),pair.privateKey).toString('base64url')}});assert.equal(result.status,history?200:201);keys.set(user,pair);return {...result.data,key:pair};
 };
 const epoch=user=>Number(db.prepare('SELECT CAST(version AS TEXT) AS version FROM team_recovery_identity_epochs WHERE user_id=?').get(user)?.version??0);
 const members=(actor,teamId='team-a',suffix='')=>api('/api/teams/'+teamId+'/business-role-members'+suffix,{session:actor});
 const change=(actor,userId,role,settings={})=>api('/api/teams/'+(settings.teamId??'team-a')+'/business-role-members/'+userId+'/role',{method:'POST',session:actor,body:{revision:epoch(userId),role,currentPassword:PASSWORD,...settings.body},...settings.request});
 const replacementRequest=async(user='intern-a',pair=keyPair())=>{const boot=await login(user),challenge=await api('/api/auth/device-replacements/request-challenges',{method:'POST',session:boot,body:{publicKey:pair.encoded,displayName:'Synthetic pending replacement',platform:'darwin',currentPassword:PASSWORD}});assert.equal(challenge.status,201);const fields=challenge.data.challenge,result=await api('/api/auth/device-replacements/request',{method:'POST',session:boot,body:{challengeId:fields.challengeId,signature:sign(null,replacement.replacementChallengeBytes(fields),pair.privateKey).toString('base64url')}});assert.equal(result.status,201);return {boot,pair,request:result.data.request};};
 return {db,clock,state,calls,keys,api,dispatch,makeRequest,login,ready,epoch,members,change,replacementRequest};
}
module.exports={createBusinessRoleFixture,PASSWORD,NOW,digest,keyPair,source};
