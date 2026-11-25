'use strict';
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {generateKeyPairSync,sign,createHash,randomBytes}=require('node:crypto'),path=require('node:path'),{pathToFileURL}=require('node:url');
const proof=require('../shared/device-proof.cjs'),replacement=require('../shared/device-replacement-proof.cjs');
const source=name=>import(pathToFileURL(path.resolve(__dirname,'../server/team/'+name)).href);
const PASSWORD='ShenyiDemo!2026',NOW=Date.parse('2026-11-17T05:00:00Z'),digest=value=>createHash('sha256').update(value).digest('hex'),ROOT='/api/auth/devices/overview';
const key=()=>{const pair=generateKeyPairSync('ed25519');return {...pair,encoded:pair.publicKey.export({format:'der',type:'spki'}).toString('base64url')};};
let baseline;
async function fixture(t){
 const {initializeTeamDatabase,seedDemoTeamData}=await source('database.mjs');
 baseline??=(async()=>{const db=new DatabaseSync(':memory:');try{initializeTeamDatabase(db);await seedDemoTeamData(db);return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name+'"').all()}));}finally{db.close();}})();
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());initializeTeamDatabase(db);db.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');for(const {name,rows}of await baseline)for(const row of rows){const names=Object.keys(row);db.prepare('INSERT OR REPLACE INTO "'+name+'"('+names.join(',')+') VALUES ('+names.map(()=>'?').join(',')+')').run(...Object.values(row));}db.exec('COMMIT');
 for(const id of ['admin-core','owner-core']){db.prepare("INSERT INTO team_users VALUES (?,'active')").run(id);db.prepare("INSERT INTO team_credentials(user_id,username,display_name,password_hash) SELECT ?,?,?,password_hash FROM team_credentials WHERE user_id='manager-a'").run(id,id,id);}
 db.prepare("INSERT INTO team_operators VALUES ('team-a','admin-core','administrator','active')").run();
 db.prepare("INSERT INTO team_device_replacement_reviewers(user_id,permission,status) VALUES ('owner-core','device.replace','active')").run();
 const {handleTeamApplicationRequest}=await source('application-api.mjs'),clock={value:NOW},calls=[];
 function signed(route,session,{method='GET',body,nonce=randomBytes(32).toString('base64url'),headers={}}={}){
  const serialized=body===undefined?undefined:JSON.stringify(body),actual={Origin:'shenyi://app',Authorization:'Bearer '+session.token,...(body===undefined?{}:{'Content-Type':'application/json'})};
  if(session.lease){const url=new URL('http://127.0.0.1:8774'+route),fields={serverId:session.lease.serverId,userId:session.account.id,sessionBinding:proof.sessionBinding(session.token),deviceId:session.lease.deviceId,bindingRevision:session.device.revision,leaseId:session.lease.id,method,pathAndQuery:url.pathname+url.search,bodySha256:digest(serialized??''),nonce};Object.assign(actual,{'X-Shenyi-Device-Lease':session.lease.token,'X-Shenyi-Device-Nonce':nonce,'X-Shenyi-Device-Body-SHA256':fields.bodySha256,'X-Shenyi-Device-Signature':sign(null,proof.requestProofBytes(fields),session.key.privateKey).toString('base64url')});}
  return new Request('http://127.0.0.1:8774'+route,{method,headers:{...actual,...headers},...(serialized===undefined?{}:{body:serialized})});
 }
 async function api(route,{method='GET',session,body,headers={},raw,strict=true,options={}}={}){
  const request=raw??(session?signed(route,session,{method,body,headers}):new Request('http://127.0.0.1:8774'+route,{method,headers:{Origin:'shenyi://app',...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  const response=await handleTeamApplicationRequest(request,{db,now:()=>clock.value,identityProviders:{deviceProofRequired:strict},...options});const text=await response.text();const result={status:response.status,data:text?JSON.parse(text):null,bytes:Buffer.byteLength(text),headers:response.headers};calls.push({route,method,status:result.status});return result;
 }
 const login=async(user='intern-a')=>{const result=await api('/api/auth/login',{method:'POST',body:{username:user,password:PASSWORD}});assert.equal(result.status,200,JSON.stringify(result.data));return result.data;};
 const ready=async(user='intern-a',pair=key())=>{const boot=await login(user),c=await api('/api/auth/devices/enrollment-challenges',{method:'POST',session:boot,body:{publicKey:pair.encoded,displayName:'Synthetic '+user+' computer',platform:'win32',currentPassword:PASSWORD}});assert.equal(c.status,201,JSON.stringify(c.data));const r=await api('/api/auth/devices/enroll',{method:'POST',session:boot,body:{challengeId:c.data.challenge.challengeId,signature:sign(null,proof.challengeBytes(c.data.challenge),pair.privateKey).toString('base64url')}});assert.equal(r.status,201,JSON.stringify(r.data));return {...r.data,key:pair};};
 const prove=async(actor)=>{const boot=await login(actor.account.id),c=await api('/api/auth/devices/proof-challenges',{method:'POST',session:boot,body:{publicKey:actor.key.encoded}});assert.equal(c.status,201);const r=await api('/api/auth/devices/prove',{method:'POST',session:boot,body:{challengeId:c.data.challenge.challengeId,signature:sign(null,proof.challengeBytes(c.data.challenge),actor.key.privateKey).toString('base64url')}});assert.equal(r.status,200,JSON.stringify(r.data));return {...r.data,key:actor.key};};
 const finish=(purpose,c,session,pair)=>api('/api/auth/device-replacements/'+purpose,{method:'POST',session,body:{challengeId:c.challengeId,signature:sign(null,replacement.replacementChallengeBytes(c),pair.privateKey).toString('base64url')}});
 const request=async(old)=>{const boot=await login(old.account.id),newKey=key(),c=await api('/api/auth/device-replacements/request-challenges',{method:'POST',session:boot,body:{publicKey:newKey.encoded,displayName:'Synthetic proposed computer',platform:'darwin',currentPassword:PASSWORD}});assert.equal(c.status,201,JSON.stringify(c.data));const r=await finish('request',c.data.challenge,boot,newKey);assert.equal(r.status,201,JSON.stringify(r.data));return {old,boot,newKey,row:r.data.request};};
 const approve=async(r,admin)=>{const result=await api('/api/account/device-replacement-reviews/'+r.row.id+'/review',{method:'POST',session:admin,body:{revision:r.row.revision,decision:'approve',currentPassword:PASSWORD}});assert.equal(result.status,200,JSON.stringify(result.data));r.row=result.data.request;};
 const activate=async(r)=>{const c=await api('/api/auth/device-replacements/activate-challenges',{method:'POST',session:r.boot,body:{requestId:r.row.id,revision:r.row.revision,publicKey:r.newKey.encoded}});assert.equal(c.status,201,JSON.stringify(c.data));const result=await finish('activate',c.data.challenge,r.boot,r.newKey);assert.equal(result.status,200,JSON.stringify(result.data));return {...result.data,key:r.newKey};};
 const {currentDeviceLease}=await source('device-policy.mjs');
 const context=actor=>{const current=currentDeviceLease(db,signed(ROOT,actor),clock.value);return {userId:current.userId,deviceId:current.deviceId,bindingRevision:current.bindingRevision,leaseId:current.leaseId,stamp:current.stamp,serverId:actor.lease.serverId};};
 const usage=()=>db.prepare('SELECT device_id,user_id,last_used_at FROM team_device_usage ORDER BY device_id').all().map(row=>({...row}));
 return {db,clock,api,signed,login,ready,prove,request,approve,activate,usage,context,calls};
}
module.exports={fixture,source,key,proof,PASSWORD,NOW,ROOT,digest};
