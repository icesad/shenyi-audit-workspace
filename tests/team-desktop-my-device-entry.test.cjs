'use strict';
const {ledgerOldApiNames,ledgerOldChannelNames}=require('./helpers/ledger-check-entry-layer.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createHash}=require('node:crypto');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const UUID='11111111-1111-4111-8111-111111111111';
function fixture(){const handlers=new Map(),contents=new EventEmitter();contents.mainFrame={url:APP_URL};const window={webContents:contents},calls=[],client={clearSession(){},async getMyDeviceOverview(input){calls.push(input);return{safe:true};}};const dispose=registerDesktopBridge({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},window,client,dialog:{}});return{handlers,contents,window,calls,dispose,event:{sender:contents,senderFrame:contents.mainFrame}};}
test('one new channel preserves the original116 channel order and adds no generic access',()=>{
 const f=fixture();assert.equal(ledgerOldChannelNames(f.handlers).length,123);assert.equal([...ledgerOldChannelNames(f.handlers)].at(116),'shenyi:my-device-overview');for(const forbidden of ['fetch','sql','token','raw-ipc','device-rebind','device-rename'])assert.equal(f.handlers.has('shenyi:'+forbidden),false);f.dispose();assert.equal(f.handlers.size,0);
});
test('new channel rejects foreign windows, subframes and origins before reading input or client',async()=>{
 const f=fixture();try{for(const event of [{sender:{},senderFrame:f.contents.mainFrame},{sender:f.contents,senderFrame:{url:APP_URL}},{sender:f.contents,senderFrame:{url:'https://evil.invalid'}}])assert.equal((await f.handlers.get('shenyi:my-device-overview')(event,{before:'D.'+UUID})).error.code,'UNTRUSTED_SENDER');const original=f.contents.mainFrame.url;f.contents.mainFrame.url='shenyi-preview://document/index.html';assert.equal((await f.handlers.get('shenyi:my-device-overview')(f.event,{})).error.code,'UNTRUSTED_SENDER');f.contents.mainFrame.url=original;assert.equal(f.calls.length,0);}finally{f.dispose();}
});
test('bridge parses only optional typed before and refuses target, path, credential or hidden fields before client',async()=>{
 const f=fixture();try{const call=value=>f.handlers.get('shenyi:my-device-overview')(f.event,value);let getter=0;const accessor={};Object.defineProperty(accessor,'before',{enumerable:true,get(){getter++;return'D.'+UUID;}});const hidden={};Object.defineProperty(hidden,'token',{value:'secret'});
 for(const value of [null,[],1,'before',{before:undefined},{before:[UUID]},accessor,hidden,{[Symbol('extra')]:true},...['userId','teamId','deviceId','url','path','token','limit','currentPassword'].map(key=>({[key]:'secret'}))])assert.equal((await call(value)).error.code,'INVALID_INPUT');assert.equal(f.calls.length,0);assert.equal(getter,0);
 assert.equal((await call()).ok,true);assert.equal((await call({})).ok,true);assert.equal((await call({before:'R.'+UUID})).ok,true);assert.deepEqual(f.calls,[{},{},{before:'R.'+UUID}]);
 }finally{f.dispose();}
});
test('preload appends only the new typed method and keeps the entire old public API order',async()=>{
 let exposed;const calls=[];
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../desktop/preload.cjs'),'utf8'),{
  require(name){
   assert.equal(name,'electron');
   return {
    contextBridge:{exposeInMainWorld(name,api){assert.equal(name,'shenyiTeam');exposed=api;}},
    ipcRenderer:{invoke(channel,input){calls.push({channel,input});return Promise.resolve({ok:true,value:{}});}}
   };
  }
 });
 // The full public-key order of the committed M3D preload, pinned without a local artifact dependency.
 const priorOrderSha256='e05fa014fc8b0822fcc5bdceb5c8f4f93814879dea92baa97c635a9a288a57dd';
 assert.ok(Object.isFrozen(exposed));assert.equal(ledgerOldApiNames(exposed).length,123);assert.equal(createHash('sha256').update(ledgerOldApiNames(exposed).slice(0,116).join('\n')).digest('hex'),priorOrderSha256);assert.equal(ledgerOldApiNames(exposed).at(116),'getMyDeviceOverview');const query={before:'D.'+UUID};await exposed.getMyDeviceOverview(query);assert.deepEqual(calls,[{channel:'shenyi:my-device-overview',input:query}]);for(const name of ['fetch','sql','token','privateKey','invoke','setDevice'])assert.equal(exposed[name],undefined);
});
