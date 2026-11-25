'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{JSDOM}=require('jsdom');
const {createHash}=require('node:crypto');
const {registerDesktopBridge,APP_URL}=require('../desktop/bridge.cjs');
const {ADDED_RPC,workpaperOldApiNames,workpaperOldApi,workpaperOldChannelNames,workpaperDomLayer,refundIntakeDomLayer}=require('./helpers/workpaper-entry-layer.cjs');

function capturePreload(){
 const channels=[];
 let api;
 vm.runInNewContext(fs.readFileSync('desktop/preload.cjs','utf8'),{require:()=>({
  contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'shenyiTeam');assert.equal(api,undefined);api=value;}},
  ipcRenderer:{invoke(channel){channels.push(channel);}},
 })});
 return {api,channels};
}

function captureBridge(){
 const handlers=new Map(),webContents=new EventEmitter();
 webContents.mainFrame={url:APP_URL};
 const dispose=registerDesktopBridge({
  ipcMain:{handle(channel,action){assert.equal(handlers.has(channel),false,channel);handlers.set(channel,action);},removeHandler(channel){handlers.delete(channel);}},
  window:{webContents},client:{clearSession(){}},dialog:{},
 });
 return {handlers,dispose};
}

test('API projection retains the original 135 and the exact ordered desktop additions',()=>{
 const {api:value}=capturePreload();
 const entries=Object.entries(value);
 assert.equal(entries.length,135+ADDED_RPC.length);
 assert.equal(workpaperOldApiNames(value).length,135);
 assert.deepEqual(entries.slice(135).map(([method])=>method),ADDED_RPC.map(([method])=>method));
 for(const changed of [entries.slice(1),entries.slice(0,-1),[...entries,['unexpected',()=>{}]],entries.map(([k,v],i)=>[i===134?'renamed':k,v]),entries.map(([k,v],i)=>[i===135?'renamed':k,v]),[...entries.slice(0,135),...entries.slice(136),entries[135]]])assert.throws(()=>workpaperOldApiNames(Object.fromEntries(changed)));
 assert.throws(()=>workpaperOldApiNames(workpaperOldApi(value)));assert.equal(workpaperOldApiNames(workpaperOldApi(value),{allowHistorical:true}).length,135);
});
test('channel projection checks complete old135 fingerprint and exact ordered new channels',()=>{
 const {handlers,dispose}=captureBridge();
 try{
  assert.equal(handlers.size,135+ADDED_RPC.length);
  assert.equal(workpaperOldChannelNames(handlers).length,135);
  const entries=[...handlers];
  assert.deepEqual(entries.slice(135).map(([channel])=>channel),ADDED_RPC.map(([,channel])=>'shenyi:'+channel));
  for(const changed of [entries.slice(0,-1),[...entries,['unexpected',()=>{}]],entries.map(([k,v],i)=>[i===134?'renamed':k,v]),entries.map(([k,v],i)=>[i===135?'renamed':k,v]),[...entries.slice(0,135),...entries.slice(136),entries[135]]])assert.throws(()=>workpaperOldChannelNames(new Map(changed)));
 }finally{dispose();assert.equal(handlers.size,0);}
});

test('each preload method invokes its established IPC channel exactly once',()=>{
 const {api,channels}=capturePreload();
 const {handlers,dispose}=captureBridge();
 try{
  const mappings=Object.entries(api).map(([method,invoke])=>{
   const start=channels.length;
   invoke();
   assert.equal(channels.length,start+1,method);
   return [method,channels[start]];
  });
  assert.deepEqual([...channels].sort(),[...handlers.keys()].sort());
  // Captured from the complete 135-method preload in 77d71f8.
  const historical=mappings.slice(0,135).map(pair=>pair.join('\t')).join('\n');
  assert.equal(createHash('sha256').update(historical).digest('hex'),'b12d49c70d5704c2682dd4b88e5aa11b905d0975a3b0999bc029dc7068854d43');
  assert.deepEqual(mappings.slice(135),ADDED_RPC.map(([method,channel])=>[method,'shenyi:'+channel]));
 }finally{dispose();assert.equal(handlers.size,0);}
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
