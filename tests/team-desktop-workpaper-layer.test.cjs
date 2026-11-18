'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{JSDOM}=require('jsdom');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const {RPC,BILLING_RPC,BILLING_BATCH_RPC,REFUND_INTAKE_RPC,workpaperOldApiNames,workpaperOldApi,workpaperOldChannelNames,workpaperDomLayer,refundIntakeDomLayer}=require('./helpers/workpaper-entry-layer.cjs');
const additions=[...RPC,...BILLING_RPC,...BILLING_BATCH_RPC,...REFUND_INTAKE_RPC];
function api(){let result;vm.runInNewContext(fs.readFileSync('desktop/preload.cjs','utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_n,v)=>{result=v;}},ipcRenderer:{invoke(){}}})});return result;}
test('API projection retains all original 135 and exact ordered workpaper and billing additions',()=>{
 const value=api(),entries=Object.entries(value);assert.equal(entries.length,164);assert.equal(workpaperOldApiNames(value).length,135);assert.deepEqual(entries.slice(135).map(x=>x[0]),additions.map(x=>x[0]));
 for(const changed of [entries.slice(1),entries.slice(0,-1),[...entries,['unexpected',()=>{}]],entries.map(([k,v],i)=>[i===134?'renamed':k,v]),entries.map(([k,v],i)=>[i===135?'renamed':k,v]),[...entries.slice(0,135),...entries.slice(136),entries[135]]])assert.throws(()=>workpaperOldApiNames(Object.fromEntries(changed)));
 assert.throws(()=>workpaperOldApiNames(workpaperOldApi(value)));assert.equal(workpaperOldApiNames(workpaperOldApi(value),{allowHistorical:true}).length,135);
});
test('channel projection checks complete old135 fingerprint and exact ordered new channels',()=>{
 const channels=new Map(),contents=new EventEmitter();contents.mainFrame={url:APP_URL};const dispose=registerDesktopBridge({ipcMain:{handle:(n,f)=>channels.set(n,f),removeHandler:n=>channels.delete(n)},window:{webContents:contents},client:{clearSession(){}},dialog:{}});
 try{assert.equal(channels.size,164);assert.equal(workpaperOldChannelNames(channels).length,135);const entries=[...channels];assert.deepEqual(entries.slice(135).map(([name])=>name),additions.map(([,name])=>'shenyi:'+name));for(const changed of [entries.slice(0,-1),[...entries,['unexpected',()=>{}]],entries.map(([k,v],i)=>[i===134?'renamed':k,v]),entries.map(([k,v],i)=>[i===135?'renamed':k,v]),[...entries.slice(0,135),...entries.slice(136),entries[135]]])assert.throws(()=>workpaperOldChannelNames(new Map(changed)));}finally{dispose();assert.equal(channels.size,0);}
});
test('the refund intake UI contributes only its masked password field to the old compatibility census',()=>{
 const html=fs.readFileSync('desktop/team-ui/index.html','utf8');
 for(const change of [null,doc=>doc.getElementById('refund-intake-password').type='text',
  doc=>doc.head.querySelector('script[src="refund-intake.js"]').remove(),
  doc=>doc.getElementById('refund-intake-panel').append(doc.createElement('form'))]){
  const dom=new JSDOM(html);
  try{
   if(!change)assert.equal(refundIntakeDomLayer(dom.window.document),1);
   else {change(dom.window.document);assert.throws(()=>refundIntakeDomLayer(dom.window.document,{allowAbsent:true}));}
  }finally{dom.window.close();}
 }
});
test('UI compatibility excludes only complete scoped workpaper forms and masked password fields',()=>{
 const html=fs.readFileSync('desktop/team-ui/index.html','utf8'),dom=new JSDOM(html);try{assert.deepEqual(workpaperDomLayer(dom.window.document),{forms:2,passwords:2});}finally{dom.window.close();}
 for(const mutate of [d=>d.getElementById('workpaper-panel').remove(),d=>{d.getElementById('workpaper-grant-form').id='renamed';},d=>d.getElementById('workpaper-panel').append(d.createElement('form')),d=>{d.getElementById('workpaper-grant-password').type='text';},d=>{d.getElementById('workpaper-import-password').maxLength=1024;},d=>{d.querySelector('script[src="workpapers.js"]').remove();},d=>{const s=d.createElement('script');s.src='workpaper-original-sheet.js';d.head.append(s);},d=>d.getElementById('workpaper-import-password').setAttribute('form','workpaper-grant-form'),d=>d.getElementById('workpaper-grant-fields').append(d.getElementById('workpaper-import-password')),d=>{const n=d.createElement('input');n.id='workpaper-import-password';n.type='text';d.body.prepend(n);},d=>{const s=d.createElement('script');s.src='workpaper-unexpected.js';d.head.append(s);}]){const candidate=new JSDOM(html);try{mutate(candidate.window.document);assert.throws(()=>workpaperDomLayer(candidate.window.document,{allowAbsent:true}));}finally{candidate.window.close();}}
});
