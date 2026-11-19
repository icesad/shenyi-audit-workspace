"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sign,verify}=require('node:crypto');
const {createTeamClient}=require('../desktop/team-client.cjs');
const {createBillingClient,isBillingRoute}=require('../desktop/billing-client.cjs');
const {createBusinessRoleFixture,keyPair,PASSWORD}=require('./helpers/business-role-fixture.cjs');
const proof=require('../shared/device-proof.cjs');
const CODE=Buffer.alloc(32,31).toString('base64url'),ORIGIN='https://127.0.0.1:43322',TEAM='team-a';
const OVERVIEW={teamId:TEAM,simulation:true,subscription:{state:'active',revision:1,startsAt:1,endsAt:2000000000000},seats:{purchasedSeats:1,activeBusinessSeats:0,reservedInvitationSeats:0,usedSeats:0,availableSeats:1},annualOffers:[],renewalSeats:null,seatOffer:null,canReconcile:false,websiteCheckout:true};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,{version=3,open,reply}={}){
 const f=await createBusinessRoleFixture(t),pair=keyPair(),fingerprint=proof.parsePublicKey(pair.encoded).fingerprint,calls=[],opened=[],signed=[];
 const serverId=f.db.prepare("SELECT value FROM team_database_metadata WHERE name='device-server-id'").get().value;
 const profile={schemaVersion:version,apiBase:'https://team.example.invalid',serverId,...(version===3?{checkoutOrigin:ORIGIN}:{})};
 const vault={getPublicIdentity:async()=>({publicKey:pair.encoded,fingerprint}),signChallenge:async fields=>sign(null,proof.challengeBytes(fields),pair.privateKey).toString('base64url'),signRequest:async fields=>{signed.push(fields);return sign(null,proof.requestProofBytes(fields),pair.privateKey).toString('base64url');}};
 let response=reply??(()=>({handoff:CODE,expiresAt:f.clock.value+120000}));
 const client=createTeamClient({now:()=>f.clock.value,trustedService:profile,deviceIdentity:{vault,platform:'win32',displayName:'Synthetic checkout device'},openCheckoutExternal:open===null?undefined:async url=>{opened.push(url);return open?.(url);},fetchImpl:async(url,settings)=>{
  const route=new URL(url).pathname;calls.push({route,...settings,headers:new Headers(settings.headers)});let result;
  if(route.endsWith('/billing/website-handoff'))result=Response.json(await response());
  else if(route.endsWith('/billing/overview'))result=Response.json(OVERVIEW);
  else result=await f.dispatch(new Request(url,settings));
  result.headers.set('X-Shenyi-Server-Id',serverId);Object.defineProperty(result,'url',{value:url});return result;
 }});
 await client.login({username:'administrator-demo',password:PASSWORD});await client.enrollDevice({displayName:'Synthetic checkout device',currentPassword:PASSWORD,confirmed:true});
 t.after(()=>client.clearSession());return {client,calls,opened,signed,pair,f,profile,setReply(value){response=value;}};
}
test('website handoff is one protected empty POST and only a fixed pinned URL reaches the fake shell',async t=>{
 const f=await fixture(t);assert.equal(isBillingRoute('/api/teams/'+TEAM+'/billing/website-handoff'),true);assert.equal(isBillingRoute('/api/teams/'+TEAM+'/billing/website-handoff?url=x'),false);
 assert.deepEqual(await f.client.openWebsiteCheckout({teamId:TEAM}),{opened:true});assert.deepEqual(f.opened,[ORIGIN+'/checkout/#handoff='+CODE]);const calls=f.calls.filter(x=>x.route.endsWith('/website-handoff'));assert.equal(calls.length,1);const call=calls[0];assert.equal(call.method,'POST');assert.equal(call.body,'{}');assert.ok(call.headers.get('Authorization'));assert.ok(call.headers.get('X-Shenyi-Device-Lease'));const fields=f.signed.at(-1);assert.equal(fields.pathAndQuery,'/api/teams/'+TEAM+'/billing/website-handoff');assert.ok(verify(null,proof.requestProofBytes(fields),f.pair.publicKey,Buffer.from(call.headers.get('X-Shenyi-Device-Signature'),'base64url')));assert.equal(call.headers.get('X-Shenyi-Website-Checkout'),null);
 const overview=await f.client.getBillingOverview({teamId:TEAM});assert.equal(overview.websiteCheckout,true);assert.equal(overview.websiteCheckoutReady,true);assert.equal(JSON.stringify(overview).includes(CODE),false);assert.equal(JSON.stringify(overview).includes(ORIGIN),false);
});
test('unconfigured profiles or missing shell never request a ticket and candidate readiness stays explicit',async t=>{
 for(const options of [{version:1},{open:null}]){const f=await fixture(t,options);assert.equal((await f.client.getBillingOverview({teamId:TEAM})).websiteCheckoutReady,false);await assert.rejects(f.client.openWebsiteCheckout({teamId:TEAM}),{code:'WEBSITE_CHECKOUT_UNAVAILABLE'});assert.equal(f.calls.some(c=>c.route.endsWith('/website-handoff')),false);assert.deepEqual(f.opened,[]);}
});
test('handoff input and exact canonical expiring reply are validated before any shell call',async t=>{
 const f=await fixture(t);const before=f.calls.length;for(const input of [{teamId:'../foreign'},{teamId:TEAM,url:'https://evil.invalid'},{teamId:TEAM,handoff:CODE},{teamId:TEAM,checkoutOrigin:ORIGIN},{}])await assert.rejects(f.client.openWebsiteCheckout(input),{code:'INVALID_INPUT'});assert.equal(f.calls.length,before);
 for(const reply of [{handoff:CODE+'A',expiresAt:f.f.clock.value+1000},{handoff:CODE.slice(0,-1)+'_',expiresAt:f.f.clock.value+1000},{handoff:CODE,expiresAt:f.f.clock.value},{handoff:CODE,expiresAt:1.5},{handoff:CODE,expiresAt:Number.MAX_SAFE_INTEGER+1},{handoff:CODE,expiresAt:f.f.clock.value+1000,url:'https://evil.invalid'},{handoff:CODE,expiresAt:f.f.clock.value+1000,token:'private'},null]){f.setReply(()=>reply);await assert.rejects(f.client.openWebsiteCheckout({teamId:TEAM}),{code:'INVALID_RESPONSE'});}assert.deepEqual(f.opened,[]);
});
test('a late ticket after logout or replacement login cannot open a browser for the new generation',async t=>{
 const wait=deferred(),f=await fixture(t,{reply:()=>wait.promise});const pending=f.client.openWebsiteCheckout({teamId:TEAM});while(!f.calls.some(c=>c.route.endsWith('/website-handoff')))await new Promise(r=>setImmediate(r));await f.client.logout();await f.client.login({username:'administrator-demo',password:PASSWORD});wait.resolve({handoff:CODE,expiresAt:f.f.clock.value+120000});await assert.rejects(pending,{code:'SESSION_CHANGED'});assert.deepEqual(f.opened,[]);
});
test('awaiting a fake browser callback rechecks generation and masks errors without exposing its URL',async t=>{
 const wait=deferred(),f=await fixture(t,{open:()=>wait.promise});const pending=f.client.openWebsiteCheckout({teamId:TEAM});while(!f.opened.length)await new Promise(r=>setImmediate(r));await f.client.logout();wait.resolve();await assert.rejects(pending,{code:'SESSION_CHANGED'});
 const g=await fixture(t,{open:()=>{throw Error(ORIGIN+'/checkout/#handoff='+CODE);}});await assert.rejects(g.client.openWebsiteCheckout({teamId:TEAM}),e=>e.code==='WEBSITE_CHECKOUT_OPEN_FAILED'&&!e.message.includes(CODE)&&!e.message.includes(ORIGIN));
});
test('website overview capability is simulation-only and never trusts server-supplied readiness',async()=>{
 let response;const client=createBillingClient({failure:(code,message)=>Object.assign(new Error(message),{code}),request:async()=>response});response=OVERVIEW;assert.deepEqual(await client.getBillingOverview({teamId:TEAM}),{...OVERVIEW,websiteCheckoutReady:false});
 for(const patch of [{websiteCheckout:false},{websiteCheckout:'true'},{websiteCheckout:null},{websiteCheckoutReady:true},{simulation:false}]){response={...OVERVIEW,...patch};await assert.rejects(client.getBillingOverview({teamId:TEAM}),{code:'INVALID_RESPONSE'});}
});
