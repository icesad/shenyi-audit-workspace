'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{JSDOM}=require('jsdom');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const {ledgerOldApiNames,ledgerOldChannelNames,ledgerLegacyFormCount,ledgerLegacySecretCount,ledgerDomLayer}=require('./helpers/ledger-check-entry-layer.cjs');
function api(){let result;vm.runInNewContext(fs.readFileSync('desktop/preload.cjs','utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_n,v)=>{result=v;}},ipcRenderer:{invoke(){}}})});return result;}
test('legacy API projection rejects unrelated extra missing renamed or reordered methods',()=>{
 const value=api(),names=Object.keys(value);assert.equal(ledgerOldApiNames(value).length,123);
 for(const entries of [Object.entries(value).slice(1),[...Object.entries(value),['unexpected',()=>{}]],Object.entries(value).map(([k,v],i)=>[i===125?'unexpected':k,v]),[...Object.entries(value).slice(1,2),...Object.entries(value).slice(0,1),...Object.entries(value).slice(2)]])assert.throws(()=>ledgerOldApiNames(Object.fromEntries(entries)));
 assert.equal(names.length,135);
});
test('legacy channel projection requires the pinned original registration order and exact twelve additions',()=>{
 const channels=new Map(),contents=new EventEmitter();contents.mainFrame={url:APP_URL};const dispose=registerDesktopBridge({ipcMain:{handle:(n,f)=>channels.set(n,f),removeHandler:n=>channels.delete(n)},window:{webContents:contents},client:{clearSession(){}},dialog:{}});
 try{assert.equal(ledgerOldChannelNames(channels).length,123);const entries=[...channels];for(const changed of [[...entries,['unexpected',()=>{}]],[...entries.slice(1),entries[0]],entries.map(([k,v],i)=>[i===124?'unexpected':k,v])])assert.throws(()=>ledgerOldChannelNames(new Map(changed)));}finally{dispose();}
});
test('legacy UI count projection only subtracts two exact scoped forms and two masked password inputs',()=>{
 const html=fs.readFileSync('desktop/team-ui/index.html','utf8'),dom=new JSDOM(html);try{assert.equal(ledgerLegacyFormCount(dom.window.document),22);assert.equal(ledgerLegacySecretCount(dom.window.document),27);const extra=dom.window.document.createElement('form');dom.window.document.body.append(extra);assert.equal(ledgerLegacyFormCount(dom.window.document),23);}finally{dom.window.close();}
 for(const mutate of [d=>{d.getElementById('ledger-check-grant-form').id='renamed';},d=>{d.getElementById('ledger-check-panel').append(d.createElement('form'));},d=>{d.getElementById('ledger-check-grant-password').type='text';},d=>{d.getElementById('ledger-check-import-password').maxLength=1024;},d=>{const s=d.createElement('script');s.src='ledger-checks.js';d.head.append(s);}]){const candidate=new JSDOM(html);try{mutate(candidate.window.document);assert.throws(()=>ledgerDomLayer(candidate.window.document));}finally{candidate.window.close();}}
});
