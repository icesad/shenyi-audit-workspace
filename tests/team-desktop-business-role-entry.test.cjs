'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const PASSWORD='SyntheticEntry!2026';
const mapping={getBusinessRoleManagementAccess:'business-role-management-access',listBusinessRoleMembers:'business-role-members',changeBusinessRole:'business-role-change'};
function fixture(){const handlers=new Map(),calls=[],frame={url:APP_URL},webContents={mainFrame:frame},client={clearSession(){}};for(const [name,channel] of Object.entries(mapping))client[name]=async input=>{calls.push({name,channel,input});return {safe:true};};const dispose=registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window:{webContents},client,dialog:{}});const event={sender:webContents,senderFrame:frame};return {handlers,calls,event,dispose,call:(name,arg,other=event)=>handlers.get('shenyi:'+name)(other,arg)};}

test('business-role RPCs require the current main frame before any client capability',async()=>{
  const f=fixture();assert.equal(f.handlers.size,114);for(const channel of Object.values(mapping))for(const event of [{sender:{},senderFrame:f.event.senderFrame},{sender:f.event.sender,senderFrame:{url:APP_URL}},{sender:f.event.sender,senderFrame:{url:'https://evil.invalid'}}])assert.equal((await f.call(channel,{},event)).error.code,'UNTRUSTED_SENDER');assert.equal(f.calls.length,0);f.dispose();assert.equal(f.handlers.size,0);
});
test('business-role RPC input contracts do not permit injected identity, authority, path or generic writes',async()=>{
  const f=fixture(),valid={getBusinessRoleManagementAccess:undefined,listBusinessRoleMembers:{teamId:'team-a',q:'合成',after:'member-a',limit:20},changeBusinessRole:{teamId:'team-a',userId:'employee-a',revision:3,role:'manager',currentPassword:PASSWORD,confirmed:true}};
  for(const [name,input] of Object.entries(valid)){const response=await f.call(mapping[name],input);assert.deepEqual(response,{ok:true,value:{safe:true}});assert.deepEqual(f.calls.at(-1),{name,channel:mapping[name],input});assert.equal(JSON.stringify(response).includes(PASSWORD),false);}
  const count=f.calls.length;for(const [name,input] of Object.entries(valid))for(const extra of [{actorId:'other'},{isAdministrator:true},{permission:'team.provision'},{url:'https://evil.invalid'},{path:'D:/private'},{token:'forged'},{sql:'UPDATE team_users'}])assert.equal((await f.call(mapping[name],{...(input??{}),...extra})).ok,false);assert.equal(f.calls.length,count);f.dispose();
});
test('preload exposes only the three named role methods and no identity or privilege primitive',()=>{
  let exposed;const calls=[];vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../desktop/preload.cjs'),'utf8'),{require(name){assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld(key,value){assert.equal(key,'shenyiTeam');exposed=value;}},ipcRenderer:{invoke(channel,input){calls.push({channel,input});return Promise.resolve({ok:true,value:{safe:true}});}}};}});
  assert.equal(Object.keys(exposed).length,114);for(const [name,channel] of Object.entries(mapping)){exposed[name](undefined);assert.equal(calls.at(-1).channel,'shenyi:'+channel);}for(const forbidden of ['setMembership','grantRole','createProject','setOperator','fetch','request','token','privateKey'])assert.equal(exposed[forbidden],undefined);
});
