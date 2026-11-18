'use strict';
// Synthetic in-memory databases, strict signed Requests and a fake SMS adapter.
// Setup deliberately uses the original disabled mode; the tested request uses M5C.
const assert=require('node:assert/strict'),{randomUUID,randomBytes}=require('node:crypto');
const {createBusinessRoleFixture,PASSWORD,source}=require('./business-role-fixture.cjs');
const {OWNER,ADMIN}=require('./administrator-business-role-fixture.cjs');
const PHONE='+8613800000081',NEW_PASSWORD='SyntheticIdentityStaff!2026';
const technical=new Set(['team_auth_limits','team_device_request_replays','team_device_usage','team_subscription_heads','team_subscription_events','team_employee_activation_challenges','team_operator_employee_activation_challenges']);
function snapshot(db){return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().filter(row=>!technical.has(row.name)).map(({name})=>{const s=db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"');s.setReadBigInts(true);return{name,rows:s.all().map(row=>JSON.stringify(Object.keys(row).sort().map(key=>{const v=row[key];return[key,typeof v==='bigint'?['integer',v.toString()]:v instanceof Uint8Array?['blob',Buffer.from(v).toString('base64')]:[typeof v,v]];}))).sort()};});}
async function identityFixture(t,kind,{existing=false,operator=false}={}){
 const f=await createBusinessRoleFixture(t),sent=[],smsState={hold:null};
 const providers={deviceProofRequired:true,phonePepper:randomBytes(32),sms:{send:async value=>{sent.push({...value});if(smsState.hold){smsState.hold.entered.resolve();await smsState.hold.release.promise;}}}};
 const {handleTeamApplicationRequest}=await source('application-api.mjs'),store=await source('subscription-store.mjs');
 const run=async(operation,{mode='team-management-v1',raw}={})=>{const request=raw??f.makeRequest(operation.route,{method:operation.method??'POST',session:operation.actor,body:operation.body});const response=await handleTeamApplicationRequest(request,{db:f.db,now:()=>f.clock.value,identityProviders:providers,subscriptionEnforcement:mode});const bytes=Buffer.from(await response.arrayBuffer());return{status:response.status,data:bytes.length?JSON.parse(bytes):null,headers:response.headers};};
 const term=(extra={})=>store.recordSubscriptionTerm(f.db,{teamId:'team-a',operationId:randomUUID(),expectedRevision:0,startsAt:f.clock.value-1000,endsAt:f.clock.value+10000,sourceRef:'synthetic-identity-management',...extra},{now:()=>f.clock.value});
 let actor,operation,invite,challenge;
 if(kind==='administrator-role'){
  await(await source('administrator-business-role-demo.mjs')).seedAdministratorBusinessRoleDemo(f.db);actor=await f.ready(OWNER);
  operation={route:'/api/administrator-business-roles/'+ADMIN,actor,body:{revision:f.epoch(ADMIN),role:'manager',currentPassword:PASSWORD},status:200,marker:'INSERT INTO team_administrator_business_role_events'};
 }else if(kind==='ordinary-role'){
  actor=await f.ready(ADMIN);operation={route:'/api/teams/team-a/business-role-members/intern-a/role',actor,body:{revision:f.epoch('intern-a'),role:'assistant',currentPassword:PASSWORD},status:200,marker:'INSERT INTO team_business_role_events'};
 }else{
  actor=await f.ready(operator?ADMIN:'manager-a');
  if(kind==='legacy-create')operation={route:'/api/teams/team-a/invitations',actor,body:{username:'invitee-a',role:'assistant'},status:201,marker:'INSERT INTO team_invitations'};
  else if(kind==='legacy-accept'){
   const made=await run({route:'/api/teams/team-a/invitations',actor,body:{username:'invitee-a',role:'assistant'}},{mode:'disabled'});assert.equal(made.status,201,JSON.stringify(made));invite=made.data;actor=await f.ready('invitee-a');
   operation={route:'/api/auth/invitations/accept',actor,body:{invitationToken:invite.invitationToken},status:200,marker:'UPDATE team_invitations SET accepted_at'};
  }else if(kind==='employee-create')operation={route:'/api/teams/team-a/employee-invitations',actor,body:{phone:PHONE,role:'assistant'},status:201,marker:'INSERT INTO '+(operator?'team_operator_employee_invitations':'team_employee_invitations')+'('};
  else if(['challenge','activate','revoke','preview'].includes(kind)){
   if(existing)f.db.prepare('INSERT INTO team_phone_credentials(user_id,phone,verified_at) VALUES (?,?,?)').run('invitee-a',PHONE,f.clock.value-1);
   const made=await run({route:'/api/teams/team-a/employee-invitations',actor,body:{phone:PHONE,role:'assistant'}},{mode:'disabled'});assert.equal(made.status,201,JSON.stringify(made));invite=made.data;
   if(kind==='activate'){
    const madeChallenge=await run({route:'/api/auth/onboarding/challenges',body:{invitationCode:invite.invitationCode,phone:PHONE}},{mode:'disabled'});assert.equal(madeChallenge.status,202,JSON.stringify(madeChallenge));challenge={...madeChallenge.data,code:sent.find(s=>s.challengeId===madeChallenge.data.challengeId).code};
    operation={route:'/api/auth/onboarding/activate',body:{invitationCode:invite.invitationCode,phone:PHONE,challengeId:challenge.challengeId,code:challenge.code,password:existing?PASSWORD:NEW_PASSWORD,displayName:'合成身份订阅员工',accept:true},status:200,marker:'INSERT INTO team_activity'};
   }else if(kind==='revoke')operation={route:'/api/teams/team-a/employee-invitations/'+invite.invitationId+'/revoke',actor,body:{},status:200};
   else operation={route:'/api/auth/onboarding/'+(kind==='preview'?'preview':'challenges'),body:{invitationCode:invite.invitationCode,phone:PHONE},status:kind==='preview'?200:202,marker:"SET delivery_state='sent'"};
  }else throw Error('Unknown identity fixture kind');
 }
 const usableChallenges=()=>f.db.prepare("SELECT COUNT(*) n FROM (SELECT delivery_state,consumed_at FROM team_employee_activation_challenges UNION ALL SELECT delivery_state,consumed_at FROM team_operator_employee_activation_challenges) WHERE delivery_state='sent' AND consumed_at IS NULL").get().n;
 return{...f,kind,actor,operation,invite,challenge,providers,sent,smsState,run,term,store,business:()=>snapshot(f.db),usableChallenges};
}
module.exports={identityFixture,snapshot,PASSWORD,NEW_PASSWORD,PHONE,OWNER,ADMIN,source};
